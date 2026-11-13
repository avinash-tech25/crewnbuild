import uuid
from pathlib import Path

import pytest
from legacy import JPEG_CAPTURE, bearer, handoff_token, new_password, refresh_technician, set_cookies, valid_aadhaar
from sqlalchemy import text

from app.core.runtime import settings
from app.core.security.data_encryption import decrypt
from app.core.security.password_hashing import PASSWORD_RULE_MESSAGE

TRADES = ["PAINTER", "PLUMBER", "ELECTRICIAN", "CARPENTER"]
INVALID_CREDENTIALS = "Invalid email or password."


def send_signup(client, email):
    return client.post("/auth/signup/send-code", json={"email": email})


# ---------------------------------------------------------------- the full sign-up


@pytest.mark.parametrize("trade", TRADES)
def test_full_signup_with_password_then_logout_and_password_login(client, connection, mailbox, trade):
    from app.core.security.password_hashing import verify_secret

    email = f"new-{uuid.uuid4().hex[:8]}@example.com"

    # 1-3: email, mobile, email code
    sent = send_signup(client, email)
    assert sent.status_code == 200
    code = mailbox.last_code(email)
    assert code not in sent.text  # the code is only in the email
    verified = client.post("/auth/signup/verify-code", json={"email": email, "phone": "98765 43210", "code": code})
    assert verified.status_code == 200, verified.text
    auth = verified.json()
    headers = bearer(auth["access_token"])
    assert auth["session_type"] == "onboarding"
    assert (auth["user"]["status"], auth["user"]["onboarding"]["step"], auth["user"]["phone"]) == (
        "ONBOARDING",
        "FACE",
        "9876543210",
    )
    uuid.UUID(auth["user"]["id"])
    # The dashboard is closed until registration is finished, and steps cannot be skipped.
    assert client.get("/technicians/me/dashboard", headers=headers).status_code == 403
    assert (
        client.post(
            "/onboarding/profile",
            headers=headers,
            json={
                "name": "Ravi",
                "technician_type": trade,
                "address": "Door 4, Market",
                "pincode": "000405",
                "area": "Alpha Main",
                "password": new_password(),
            },
        ).status_code
        == 409
    )

    # 4: face -- consent is required; submission is PENDING, never VERIFIED
    no_consent = client.post(
        "/onboarding/face",
        headers=headers,
        data={"consent": "false"},
        files={"capture": ("face.jpg", JPEG_CAPTURE, "image/jpeg")},
    )
    assert no_consent.status_code == 422
    not_an_image = client.post(
        "/onboarding/face",
        headers=headers,
        data={"consent": "true"},
        files={"capture": ("face.jpg", b"GIF89a....", "image/jpeg")},
    )
    assert not_an_image.status_code == 422
    face = client.post(
        "/onboarding/face",
        headers=headers,
        data={"consent": "true"},
        files={"capture": ("face.jpg", JPEG_CAPTURE, "image/jpeg")},
    )
    assert face.status_code == 200
    assert (face.json()["onboarding"]["face_status"], face.json()["onboarding"]["step"]) == ("PENDING", "AADHAAR")

    # 5: Aadhaar -- checksum-validated, stored encrypted, only ever shown masked
    aadhaar_number = valid_aadhaar()
    bad = client.post(
        "/onboarding/aadhaar",
        headers=headers,
        json={"aadhaar_number": aadhaar_number[:-1] + str((int(aadhaar_number[-1]) + 1) % 10), "consent": True},
    )
    assert bad.status_code == 422 and aadhaar_number[:8] not in bad.text
    aadhaar = client.post(
        "/onboarding/aadhaar", headers=headers, json={"aadhaar_number": aadhaar_number, "consent": True}
    )
    assert aadhaar.status_code == 200
    body = aadhaar.json()["onboarding"]
    assert (body["aadhaar_status"], body["aadhaar_masked"], body["step"]) == (
        "PENDING_VERIFICATION",
        f"XXXX XXXX {aadhaar_number[-4:]}",
        "PROFILE",
    )
    assert aadhaar_number not in aadhaar.text

    # 6-7: details + password complete the account. A weak password is refused and never echoed.
    details = {
        "name": "Ravi Kumar",
        "technician_type": trade,
        "address": "Door 4, Market Street",
        "pincode": "000405",
        "area": "Alpha Main",
        "experience_years": 5,
        "is_available": True,
    }
    for weak in (
        "",
        "Short1!",
        "alllowercase1!",
        "ALLUPPERCASE1!",
        "NoNumberHere!",
        "NoSymbolHere12",
        "Aa1!" + "x" * 70,
    ):
        refused = client.post("/onboarding/profile", headers=headers, json={**details, "password": weak})
        assert (refused.status_code, refused.json()["detail"]) == (422, PASSWORD_RULE_MESSAGE)
        assert not weak or weak not in refused.text
    assert client.get("/auth/me", headers=headers).json()["onboarding"]["step"] == "PROFILE"
    password = new_password()
    profile = client.post("/onboarding/profile", headers=headers, json={**details, "password": password})
    assert profile.status_code == 200, profile.text
    user = profile.json()
    assert (
        user["status"],
        user["technician_type"],
        user["onboarding"]["step"],
        user["onboarding"]["can_receive_jobs"],
    ) == ("ACTIVE", trade, "COMPLETE", True)
    assert password not in profile.text and "password" not in profile.text

    row = (
        connection.execute(
            text(
                """
        SELECT u.id, p.id AS profile_id, i.id AS identity_id, u.password_hash, i.aadhaar_ciphertext, i.aadhaar_key_version, i.aadhaar_last4,
               i.face_provider_reference, u.email_verified_at IS NOT NULL AS email_verified
          FROM partner.technicians u JOIN partner.technician_profiles p ON p.technician_id = u.id
          JOIN partner.technician_identity_verifications i ON i.technician_id = u.id WHERE u.email = :email
        """
            ),
            {"email": email},
        )
        .mappings()
        .one()
    )
    assert all(isinstance(row[key], uuid.UUID) for key in ("id", "profile_id", "identity_id"))
    assert row["email_verified"]
    # Only an Argon2id hash of the password is stored (bcrypt before the restructure).
    assert (
        row["password_hash"].startswith("$argon2id$")
        and password not in row["password_hash"]
        and verify_secret(password, row["password_hash"])
    )
    assert aadhaar_number.encode() not in bytes(row["aadhaar_ciphertext"])
    assert decrypt(bytes(row["aadhaar_ciphertext"]), row["aadhaar_key_version"]).decode() == aadhaar_number
    capture = Path(settings.face_capture_directory) / f"{row['face_provider_reference']}.bin"
    assert capture.exists() and not capture.read_bytes().startswith(b"\xff\xd8")  # encrypted at rest

    # Creating the account hands back the dashboard session it has just earned, so a
    # new technician lands on their own dashboard instead of a sign-in form.
    assert user["session_type"] == "partner"
    fresh_headers = bearer(user["access_token"])
    assert client.get("/auth/me", headers=fresh_headers).json()["session_type"] == "partner"
    assert client.get("/technicians/me/dashboard", headers=fresh_headers).status_code == 200

    # The registration session itself is unchanged: it still cannot open the dashboard.
    assert client.get("/auth/me", headers=headers).json()["session_type"] == "onboarding"
    blocked = client.get("/technicians/me/dashboard", headers=headers)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "PASSWORD_SIGN_IN_REQUIRED"

    # Logout is client-side; signing in again is email + password, and never sends a code.
    emails_before = len(mailbox.sent)
    wrong = client.post("/auth/login", json={"email": email, "password": password + "x"})
    assert (wrong.status_code, wrong.json()["detail"]) == (401, INVALID_CREDENTIALS)
    login = client.post("/auth/login", json={"email": email.upper(), "password": password})
    assert login.status_code == 200, login.text
    session = login.json()
    assert session["session_type"] == "partner" and password not in login.text and "password_hash" not in login.text
    partner_headers = bearer(session["access_token"])
    assert client.get("/auth/me", headers=partner_headers).json()["session_type"] == "partner"
    assert client.get("/technicians/me/dashboard", headers=partner_headers).status_code == 200
    assert len(mailbox.sent) == emails_before


# ---------------------------------------------------------------- mobile number rule


@pytest.mark.parametrize("phone", ["5544556677", "7766556677", "9876543210", "1234567890"])
def test_signup_accepts_any_ten_digit_mobile(client, mailbox, phone):
    email = f"mobile-{uuid.uuid4().hex[:8]}@example.com"
    assert send_signup(client, email).status_code == 200
    verified = client.post(
        "/auth/signup/verify-code", json={"email": email, "phone": phone, "code": mailbox.last_code(email)}
    )
    assert verified.status_code == 200, verified.text
    assert (verified.json()["user"]["phone"], verified.json()["user"]["onboarding"]["step"]) == (phone, "FACE")


@pytest.mark.parametrize("phone", ["123456789", "12345678901", "5544abc677", "55445@6677", "+915544556677"])
def test_signup_rejects_mobile_that_is_not_exactly_ten_digits(client, mailbox, phone):
    email = f"mobile-{uuid.uuid4().hex[:8]}@example.com"
    assert send_signup(client, email).status_code == 200
    code = mailbox.last_code(email)
    rejected = client.post("/auth/signup/verify-code", json={"email": email, "phone": phone, "code": code})
    assert (rejected.status_code, rejected.json()["detail"]) == (422, "Enter a valid 10 digit mobile number.")
    # The number is checked before the email code, so the code is still usable.
    assert (
        client.post("/auth/signup/verify-code", json={"email": email, "phone": "5544556677", "code": code}).status_code
        == 200
    )


# ---------------------------------------------------------------- one-time code rules


def test_codes_are_single_use_expire_and_lock_after_attempts(client, connection, mailbox):
    email = f"otp-{uuid.uuid4().hex[:8]}@example.com"
    send_signup(client, email)
    code = mailbox.last_code(email)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(settings.otp_max_attempts):
        assert (
            client.post(
                "/auth/signup/verify-code", json={"email": email, "phone": "9876543210", "code": wrong}
            ).status_code
            == 400
        )
    locked = client.post("/auth/signup/verify-code", json={"email": email, "phone": "9876543210", "code": code})
    assert locked.status_code == 429

    other = f"otp-{uuid.uuid4().hex[:8]}@example.com"
    send_signup(client, other)
    connection.execute(
        text("UPDATE partner.email_otp_codes SET expires_at = now() - interval '1 minute' WHERE email = :e"),
        {"e": other},
    )
    assert (
        client.post(
            "/auth/signup/verify-code", json={"email": other, "phone": "9876543210", "code": mailbox.last_code(other)}
        ).status_code
        == 400
    )

    third = f"otp-{uuid.uuid4().hex[:8]}@example.com"
    send_signup(client, third)
    first_use = client.post(
        "/auth/signup/verify-code", json={"email": third, "phone": "9876543210", "code": mailbox.last_code(third)}
    )
    assert first_use.status_code == 200
    reuse = client.post(
        "/auth/signup/verify-code", json={"email": third, "phone": "9876543210", "code": mailbox.last_code(third)}
    )
    assert reuse.status_code == 400  # consumed


def test_resend_cooldown_and_hourly_cap(client, connection, mailbox):
    email = f"resend-{uuid.uuid4().hex[:8]}@example.com"
    assert send_signup(client, email).status_code == 200
    assert send_signup(client, email).status_code == 429  # cooldown
    for _ in range(settings.otp_max_sends_per_hour - 1):
        connection.execute(
            text("UPDATE partner.email_otp_codes SET last_sent_at = now() - interval '5 minutes' WHERE email = :e"),
            {"e": email},
        )
        assert send_signup(client, email).status_code == 200
    connection.execute(
        text("UPDATE partner.email_otp_codes SET last_sent_at = now() - interval '5 minutes' WHERE email = :e"),
        {"e": email},
    )
    assert send_signup(client, email).status_code == 429  # hourly cap
    assert mailbox.last_code(email) in mailbox.sent[-1]["body"]


# ---------------------------------------------------------------- sign-in and sessions


def test_password_login_does_not_reveal_accounts_and_blocks_suspended(client, connection, mailbox, onboard):
    auth = onboard("PLUMBER")
    email, password = auth["user"]["email"], auth["password"]
    emails_before = len(mailbox.sent)

    unknown = client.post("/auth/login", json={"email": "nobody-here@example.com", "password": password})
    wrong = client.post("/auth/login", json={"email": email, "password": new_password()})
    empty = client.post("/auth/login", json={"email": email, "password": ""})
    assert unknown.status_code == wrong.status_code == empty.status_code == 401
    assert unknown.json() == wrong.json() == empty.json() == {"detail": INVALID_CREDENTIALS}
    assert len(mailbox.sent) == emails_before  # signing in never sends a code
    # Email one-time codes are no longer a way to sign in.
    assert client.post("/auth/login/send-code", json={"email": email}).status_code == 404
    assert client.post("/auth/login/verify-code", json={"email": email, "code": "123456"}).status_code == 404

    connection.execute(
        text("UPDATE partner.technicians SET status = 'SUSPENDED' WHERE id = :id"), {"id": auth["user"]["id"]}
    )
    assert client.post("/auth/login", json={"email": email, "password": password}).status_code == 403
    assert client.get("/auth/me", headers=bearer(auth["access_token"])).status_code == 403


def test_a_password_is_matched_in_full_never_by_its_first_72_bytes(client, connection, onboard):
    from app.core.security.password_hashing import hash_secret

    auth = onboard("PAINTER")
    longest = new_password().ljust(72, "z")  # the longest password the rule allows
    connection.execute(
        text("UPDATE partner.technicians SET password_hash = :hash WHERE id = :id"),
        {"hash": hash_secret(longest), "id": auth["user"]["id"]},
    )
    assert client.post("/auth/login", json={"email": auth["user"]["email"], "password": longest}).status_code == 200
    extended = client.post("/auth/login", json={"email": auth["user"]["email"], "password": longest + "anything"})
    assert (extended.status_code, extended.json()["detail"]) == (401, INVALID_CREDENTIALS)


def test_unfinished_registration_cannot_sign_in_with_a_password(client, onboard):
    partial = onboard("PAINTER", stop_after="aadhaar")
    refused = client.post("/auth/login", json={"email": partial["user"]["email"], "password": new_password()})
    assert (refused.status_code, refused.json()["detail"]) == (401, INVALID_CREDENTIALS)
    assert client.get("/technicians/me/jobs", headers=bearer(partial["access_token"])).status_code == 403


def test_registered_email_cannot_sign_up_again_but_onboarding_can_resume(client, mailbox, onboard):
    active = onboard("ELECTRICIAN")
    assert send_signup(client, active["user"]["email"]).status_code == 409

    partial = onboard("CARPENTER", stop_after="face")
    assert send_signup(client, partial["user"]["email"]).status_code == 200
    resumed = client.post(
        "/auth/signup/verify-code",
        json={
            "email": partial["user"]["email"],
            "phone": "9876543211",
            "code": mailbox.last_code(partial["user"]["email"]),
        },
    )
    assert resumed.status_code == 200
    assert (
        resumed.json()["user"]["id"],
        resumed.json()["user"]["onboarding"]["step"],
        resumed.json()["session_type"],
    ) == (partial["user"]["id"], "AADHAAR", "onboarding")


def test_onboarding_steps_are_enforced_in_order_on_the_server(client, onboard):
    auth = onboard("PAINTER", stop_after="email")
    headers = bearer(auth["access_token"])
    face = {"data": {"consent": "true"}, "files": {"capture": ("face.jpg", JPEG_CAPTURE, "image/jpeg")}}

    # Aadhaar cannot come before the face step.
    early = client.post(
        "/onboarding/aadhaar", headers=headers, json={"aadhaar_number": valid_aadhaar(), "consent": True}
    )
    assert early.status_code == 409
    assert client.get("/auth/me", headers=headers).json()["onboarding"]["aadhaar_status"] == "NOT_SUBMITTED"

    assert client.post("/onboarding/face", headers=headers, **face).status_code == 200
    # A finished step is not reopened by posting to it again.
    assert client.post("/onboarding/face", headers=headers, **face).status_code == 409
    assert (
        client.post(
            "/onboarding/aadhaar", headers=headers, json={"aadhaar_number": valid_aadhaar(), "consent": True}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/onboarding/aadhaar", headers=headers, json={"aadhaar_number": valid_aadhaar(), "consent": True}
        ).status_code
        == 409
    )
    assert client.get("/auth/me", headers=headers).json()["onboarding"]["step"] == "PROFILE"


def test_tokens_from_before_password_sign_in_and_unverified_legacy_accounts_are_refused(client, connection):
    """A token issued before sessions had a scope never restores anyone's session, and a
    first-release account whose email was never verified cannot sign in with its old password."""
    from app.core.runtime import settings
    from app.core.security.access_tokens import TOKEN_ACCESS, _encode, new_refresh_token
    from app.core.security.password_hashing import hash_secret

    legacy_password = new_password()
    email = f"legacy-{uuid.uuid4().hex[:8]}@example.com"
    user_id = connection.execute(
        text(
            "INSERT INTO partner.technicians (email, phone, password_hash, status) VALUES (:email, '9876543210', :hash, 'ACTIVE') RETURNING id"
        ),
        {"email": email, "hash": hash_secret(legacy_password)},
    ).scalar()
    # Correctly signed, but naming no server-side session.
    unscoped = bearer(_encode(settings, user_id, TOKEN_ACCESS, uuid.uuid4(), uuid.uuid4()))

    assert client.get("/auth/me", headers=unscoped).status_code == 401
    assert client.get("/technicians/me/dashboard", headers=unscoped).status_code == 401
    assert (
        client.post(
            "/onboarding/face",
            headers=unscoped,
            data={"consent": "true"},
            files={"capture": ("face.jpg", JPEG_CAPTURE, "image/jpeg")},
        ).status_code
        == 401
    )
    assert refresh_technician(client, new_refresh_token()).status_code == 401
    refused = client.post("/auth/login", json={"email": email, "password": legacy_password})
    assert (refused.status_code, refused.json()["detail"]) == (401, INVALID_CREDENTIALS)


def test_only_a_password_session_opens_the_dashboard_and_renewal_keeps_the_scope(client, onboard):
    auth = onboard("CARPENTER")
    registration = auth["registration_session"]
    body = auth["user"]
    assert auth["session_type"] == "partner"
    assert (
        body["status"],
        body["onboarding"]["step"],
        body["onboarding"]["face_status"],
        body["onboarding"]["aadhaar_status"],
    ) == ("ACTIVE", "COMPLETE", "PENDING", "PENDING_VERIFICATION")
    assert client.get("/technicians/me/dashboard", headers=bearer(auth["access_token"])).status_code == 200
    assert client.get("/technicians/me/dashboard", headers=bearer(registration["access_token"])).status_code == 403

    renewed_registration = refresh_technician(client, registration["refresh_token"])
    assert renewed_registration.json()["session_type"] == "onboarding"
    assert (
        client.get("/technicians/me/jobs", headers=bearer(renewed_registration.json()["access_token"])).status_code
        == 403
    )
    renewed = refresh_technician(client, auth["refresh_token"])
    assert renewed.json()["session_type"] == "partner"
    assert client.get("/technicians/me/dashboard", headers=bearer(renewed.json()["access_token"])).status_code == 200
    # Signing up again with a completed email is refused, so onboarding cannot restart.
    assert send_signup(client, body["email"]).status_code == 409


def test_each_session_sees_only_its_own_account(client, onboard):
    first = onboard("PAINTER", name="First Technician")
    second = onboard("PAINTER", name="Second Technician")
    for auth, other in ((first, second), (second, first)):
        me = client.get("/auth/me", headers=bearer(auth["access_token"])).json()
        assert (me["id"], me["email"], me["name"]) == (auth["user"]["id"], auth["user"]["email"], auth["user"]["name"])
        assert (
            other["user"]["email"]
            not in client.get("/technicians/me/dashboard", headers=bearer(auth["access_token"])).text
        )


def test_account_finished_before_passwords_sets_one_on_the_server(client, connection, onboard):
    from sqlalchemy.orm import Session

    from app.scripts.set_password import set_initial_password

    auth = onboard("PAINTER")
    email = auth["user"]["email"]
    connection.execute(text("UPDATE partner.technicians SET password_hash = NULL WHERE email = :e"), {"e": email})
    assert client.post("/auth/login", json={"email": email, "password": auth["password"]}).status_code == 401

    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        with pytest.raises(SystemExit):
            set_initial_password(session, email, "too-weak")
        password = new_password()
        set_initial_password(session, email.upper(), password)
        with pytest.raises(SystemExit):  # an existing password is never replaced by the script
            set_initial_password(session, email, new_password())
    finally:
        session.close()
    assert client.post("/auth/login", json={"email": email, "password": password}).status_code == 200


# ---------------------------------------------------------------- identity data safety


def test_one_aadhaar_cannot_be_linked_to_two_accounts(client, onboard):
    number = valid_aadhaar()
    first = onboard("PAINTER", stop_after="face")
    second = onboard("PAINTER", stop_after="face")
    assert (
        client.post(
            "/onboarding/aadhaar",
            headers=bearer(first["access_token"]),
            json={"aadhaar_number": number, "consent": True},
        ).status_code
        == 200
    )
    duplicate = client.post(
        "/onboarding/aadhaar", headers=bearer(second["access_token"]), json={"aadhaar_number": number, "consent": True}
    )
    assert duplicate.status_code == 409 and number not in duplicate.text
    no_consent = client.post(
        "/onboarding/aadhaar",
        headers=bearer(second["access_token"]),
        json={"aadhaar_number": valid_aadhaar(), "consent": False},
    )
    assert no_consent.status_code == 422


def test_validation_errors_never_echo_submitted_values(client, onboard):
    auth = onboard("PAINTER", stop_after="face")
    secretish = 123456789012
    response = client.post(
        "/onboarding/aadhaar",
        headers=bearer(auth["access_token"]),
        json={"aadhaar_number": secretish, "consent": "maybe"},
    )
    assert response.status_code == 422
    assert str(secretish) not in response.text and "maybe" not in response.text
    long_password = "Aa1!" + "z" * 300
    login = client.post("/auth/login", json={"email": auth["user"]["email"], "password": long_password})
    assert login.status_code == 422 and long_password not in login.text


def test_review_decision_deletes_capture_and_expired_captures_are_purged(client, connection, onboard):
    from sqlalchemy.orm import Session

    from app.modules.technicians.identity_service import decide_face, purge_expired_face_captures
    from app.modules.technicians.models import IdentityVerification

    reviewed = onboard("PAINTER", stop_after="face")
    expired = onboard("PAINTER", stop_after="face")
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        first = session.query(IdentityVerification).filter_by(user_id=uuid.UUID(reviewed["user"]["id"])).one()
        capture = Path(settings.face_capture_directory) / f"{first.face_provider_reference}.bin"
        assert capture.exists()
        decide_face(session, first, verified=True)
        assert (first.face_status, first.face_provider_reference, capture.exists()) == ("VERIFIED", None, False)

        second = session.query(IdentityVerification).filter_by(user_id=uuid.UUID(expired["user"]["id"])).one()
        old_capture = Path(settings.face_capture_directory) / f"{second.face_provider_reference}.bin"
        session.execute(
            text(
                "UPDATE partner.technician_identity_verifications SET face_capture_expires_at = now() - interval '1 day' WHERE id = :id"
            ),
            {"id": second.id},
        )
        session.expire_all()
        assert purge_expired_face_captures(session) >= 1
        session.refresh(second)
        assert (second.face_provider_reference, old_capture.exists(), second.face_status) == (None, False, "PENDING")
    finally:
        session.close()


def test_token_types_are_not_interchangeable(client, onboard, make_requester_account):
    auth = onboard("PAINTER")
    owner_id = make_requester_account()
    assert client.get("/auth/me", headers=bearer(auth["refresh_token"])).status_code == 401
    assert client.get("/auth/me", headers=bearer(handoff_token(owner_id))).status_code == 401
    assert client.get("/requester/me", headers=bearer(auth["access_token"])).status_code == 401
    assert refresh_technician(client, auth["refresh_token"]).status_code == 200
    assert refresh_technician(client, auth["access_token"]).status_code == 401


def test_creating_the_account_hands_back_a_dashboard_session(client, onboard):
    """Finishing registration opens the technician's own dashboard.

    The last step sets the password, activates the account and completes
    onboarding on a request already authenticated as that account -- everything
    /auth/login checks -- so it returns the same dashboard session rather than
    sending the technician to a sign-in form to retype what they just chose.
    """
    session = onboard("ELECTRICIAN", "000405")
    # The `onboard` fixture signs in afterwards, so read the registration session it kept.
    registration = bearer(session["registration_session"]["access_token"])

    # Submitting the finished form again is not a registration: it mints no session.
    details = {
        "name": "Ravi Kumar",
        "technician_type": "ELECTRICIAN",
        "address": "Door 4, Market Street",
        "pincode": "000405",
        "area": "Alpha Main",
        "experience_years": 5,
        "is_available": True,
    }
    again = client.post("/onboarding/profile", headers=registration, json={**details, "password": session["password"]})
    assert again.status_code == 200, again.text
    assert not set_cookies(again), "no session cookies"
    assert "access_token" not in again.json() and "refresh_token" not in again.json()
    assert again.json()["session_type"] is None and again.json()["csrf_token"] is None

    # And that registration session still cannot open the dashboard on its own.
    blocked = client.get("/technicians/me/dashboard", headers=registration)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "PASSWORD_SIGN_IN_REQUIRED"
