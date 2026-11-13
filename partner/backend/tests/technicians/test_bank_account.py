"""The technician's payout bank account (Profile / Settings).

Runs through the real API inside the shared rolled-back transaction, with the
per-test encryption key conftest sets up.
"""

import logging

import pytest
from legacy import bearer
from pydantic import SecretStr
from sqlalchemy import text

from app.core.runtime import settings
from app.core.security.data_encryption import decrypt

NUMBER = "123456789012"
OTHER_NUMBER = "987654321098765"
URL = "/technicians/me/bank-account"


def account(**overrides):
    body = {
        "account_holder_name": "Ravi Kumar",
        "bank_name": "State Bank of India",
        "account_number": NUMBER,
        "confirm_account_number": NUMBER,
        "ifsc": "SBIN0001234",
    }
    body.update(overrides)
    return body


def put(client, technician, **overrides):
    return client.put(URL, headers=bearer(technician["access_token"]), json=account(**overrides))


def get(client, technician):
    return client.get(URL, headers=bearer(technician["access_token"]))


def stored(connection, technician):
    return (
        connection.execute(
            text("SELECT * FROM partner.technician_payout_accounts WHERE technician_id = :t"),
            {"t": technician["user"]["id"]},
        )
        .mappings()
        .all()
    )


# ------------------------------------------------------------------ add and read


def test_no_account_yet_reads_as_null(client, onboard):
    technician = onboard()
    response = get(client, technician)
    assert response.status_code == 200 and response.json() is None


def test_adding_an_account_returns_it_masked_and_unverified(client, onboard):
    technician = onboard()
    saved = put(
        client,
        technician,
        account_holder_name="  Ravi   Kumar ",
        ifsc=" sbin0001234 ",
        account_number="1234 5678 9012",
        confirm_account_number="123456789012",
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["account_holder_name"] == "Ravi Kumar"
    assert body["ifsc_code"] == "SBIN0001234"  # normalised to upper case
    assert body["account_number_last4"] == "9012"
    assert body["account_number_masked"] == "••••••9012"
    assert body["verification_status"] == "UNVERIFIED"  # nothing verified it
    assert set(body) == {
        "account_holder_name",
        "bank_name",
        "account_number_masked",
        "account_number_last4",
        "ifsc_code",
        "verification_status",
        "created_at",
        "updated_at",
    }
    assert get(client, technician).json() == body


def test_the_full_number_never_appears_in_any_response(client, onboard):
    technician = onboard()
    for response in (
        put(client, technician),
        get(client, technician),
        client.get("/auth/me", headers=bearer(technician["access_token"])),
    ):
        assert NUMBER not in response.text
        assert "encrypted" not in response.text


# ---------------------------------------------------------------- stored safely


def test_the_number_is_encrypted_at_rest_and_nowhere_in_plaintext(client, onboard, connection):
    technician = onboard()
    assert put(client, technician).status_code == 200
    rows = stored(connection, technician)
    assert len(rows) == 1
    row = rows[0]
    ciphertext = bytes(row["account_number_ciphertext"])
    assert NUMBER.encode() not in ciphertext
    # Encrypted with the versioned key from settings, and that version is stored with it.
    assert row["account_number_key_version"] == settings.data_encryption_key_version
    assert decrypt(ciphertext, row["account_number_key_version"]).decode() == NUMBER
    assert row["account_number_last4"] == "9012"
    # No column of the row, rendered as text, holds the full number.
    as_text = connection.execute(
        text("SELECT b::text FROM partner.technician_payout_accounts b WHERE technician_id = :t"),
        {"t": technician["user"]["id"]},
    ).scalar()
    assert NUMBER not in as_text
    # The confirm field is never stored: there is no column for it.
    columns = set(row.keys())
    assert not any("confirm" in column for column in columns)
    assert "account_number" not in columns


def test_saving_never_writes_the_number_to_the_logs(client, onboard, caplog):
    technician = onboard()
    with caplog.at_level(logging.DEBUG):
        put(client, technician)
        put(client, technician, confirm_account_number="000011112222")
        get(client, technician)
    assert NUMBER not in caplog.text


def test_without_an_encryption_key_nothing_is_stored(client, onboard, connection, monkeypatch):
    technician = onboard()
    monkeypatch.setattr(settings, "data_encryption_key", SecretStr(""))
    response = put(client, technician)
    assert response.status_code == 503
    assert stored(connection, technician) == []


# ------------------------------------------------------------------ validation


def test_mismatched_confirmation_is_refused_without_echoing_the_numbers(client, onboard, connection):
    technician = onboard()
    response = put(client, technician, confirm_account_number="123456789013")
    assert response.status_code == 422
    assert response.json()["detail"] == "The account numbers do not match."
    assert NUMBER not in response.text and "123456789013" not in response.text
    assert stored(connection, technician) == []


@pytest.mark.parametrize(
    "number", ["12345678", "1234567890123456789", "12345678901A", "0000000000", "12-3456-7890", ""]
)
def test_invalid_account_numbers_are_refused(client, onboard, number):
    technician = onboard()
    response = put(client, technician, account_number=number, confirm_account_number=number)
    assert response.status_code == 422
    assert "9 to 18 digits" in response.json()["detail"]
    if number:
        assert number not in response.text


@pytest.mark.parametrize("ifsc", ["SBIN1001234", "SBI0001234", "SBIN00012345", "1BIN0001234", "SBIN000123$", ""])
def test_invalid_ifsc_codes_are_refused(client, onboard, ifsc):
    technician = onboard()
    response = put(client, technician, ifsc=ifsc)
    assert response.status_code == 422 and "IFSC" in response.json()["detail"]


@pytest.mark.parametrize(
    "field, value",
    [
        ("account_holder_name", ""),
        ("account_holder_name", "R"),
        ("account_holder_name", "Ravi 123"),
        ("bank_name", ""),
        ("bank_name", "12345"),
        ("bank_name", "Bank<script>"),
    ],
)
def test_invalid_names_are_refused(client, onboard, field, value):
    technician = onboard()
    assert put(client, technician, **{field: value}).status_code == 422


def test_ordinary_names_are_accepted(client, onboard):
    technician = onboard()
    response = put(
        client, technician, account_holder_name="M. S. D'Souza-Rao", bank_name="HDFC Bank Ltd. (Main Branch)"
    )
    assert response.status_code == 200, response.text


def test_oversized_input_is_refused_without_echoing_it(client, onboard):
    technician = onboard()
    long_number = "4" * 41
    response = put(client, technician, account_number=long_number, confirm_account_number=long_number)
    assert response.status_code == 422
    assert long_number not in response.text


# -------------------------------------------------------------------- updating


def test_updating_replaces_the_one_account_and_resets_verification(client, onboard, connection):
    technician = onboard()
    assert put(client, technician).status_code == 200
    connection.execute(
        text("UPDATE partner.technician_payout_accounts SET verification_status = 'VERIFIED' WHERE technician_id = :t"),
        {"t": technician["user"]["id"]},
    )

    # Saving the very same details leaves a verified account verified.
    unchanged = put(client, technician, ifsc="sbin0001234")
    assert unchanged.json()["verification_status"] == "VERIFIED"

    changed = put(client, technician, account_number=OTHER_NUMBER, confirm_account_number=OTHER_NUMBER)
    assert changed.status_code == 200
    assert changed.json()["account_number_last4"] == "8765"
    assert changed.json()["verification_status"] == "UNVERIFIED"
    assert len(stored(connection, technician)) == 1

    connection.execute(
        text("UPDATE partner.technician_payout_accounts SET verification_status = 'VERIFIED' WHERE technician_id = :t"),
        {"t": technician["user"]["id"]},
    )
    for change in ({"ifsc": "HDFC0000001"}, {"account_holder_name": "Ravi K"}, {"bank_name": "HDFC Bank"}):
        details = {"account_number": OTHER_NUMBER, "confirm_account_number": OTHER_NUMBER, **change}
        assert put(client, technician, **details).json()["verification_status"] == "UNVERIFIED", change
        connection.execute(
            text(
                "UPDATE partner.technician_payout_accounts SET verification_status = 'VERIFIED' WHERE technician_id = :t"
            ),
            {"t": technician["user"]["id"]},
        )


def test_a_rejected_account_that_is_corrected_becomes_unverified(client, onboard, connection):
    technician = onboard()
    put(client, technician)
    connection.execute(
        text("UPDATE partner.technician_payout_accounts SET verification_status = 'REJECTED' WHERE technician_id = :t"),
        {"t": technician["user"]["id"]},
    )
    assert get(client, technician).json()["verification_status"] == "REJECTED"
    assert put(client, technician, ifsc="HDFC0000001").json()["verification_status"] == "UNVERIFIED"


# --------------------------------------------------------------- who may see it


def test_each_technician_sees_only_their_own_account(client, onboard):
    first, second = onboard(), onboard()
    put(client, first)
    put(
        client,
        second,
        account_holder_name="Second Person",
        account_number=OTHER_NUMBER,
        confirm_account_number=OTHER_NUMBER,
    )
    mine, theirs = get(client, first).json(), get(client, second).json()
    assert mine["account_holder_name"] == "Ravi Kumar" and mine["account_number_last4"] == "9012"
    assert theirs["account_holder_name"] == "Second Person" and theirs["account_number_last4"] == "8765"
    assert "Second Person" not in get(client, first).text and "8765" not in get(client, first).text
    # Saving never touches another technician's row.
    put(client, first, account_holder_name="Changed Name")
    assert get(client, second).json()["account_holder_name"] == "Second Person"


def test_signed_out_and_registration_sessions_are_refused(client, onboard):
    assert client.get(URL).status_code == 401
    assert client.put(URL, json=account()).status_code == 401
    unfinished = onboard(stop_after="aadhaar")
    assert client.get(URL, headers=bearer(unfinished["access_token"])).status_code == 403
    finished = onboard()
    registration = bearer(finished["registration_session"]["access_token"])
    assert client.put(URL, headers=registration, json=account()).status_code == 403
