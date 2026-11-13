"""A technician's payout bank account -- added and changed from Profile / Settings.

Stored the way the Aadhaar number is (identity_service.py): Fernet-encrypted with
DATA_ENCRYPTION_KEY, with the last four digits kept for display. The full number
is decrypted only here, only to tell whether a save changed it, and never logged,
returned or put into an error message. "Confirm account number" is compared and
discarded.

Nothing verifies an account with a bank yet, so a saved account is UNVERIFIED,
and any change to the details sends it back to UNVERIFIED -- a VERIFIED mark can
never carry over to details nobody checked.
"""

import hmac
import logging
import re

from fastapi import HTTPException

from app.core.security import data_encryption
from app.database.types import naive_utc_now
from app.modules.identity.models import Technician
from app.modules.technicians.models import BANK_UNVERIFIED, IFSC_PATTERN, TechnicianBankAccount
from app.modules.technicians.repository import BankAccountRepository
from app.modules.technicians.schemas import BankAccountResponse, BankAccountUpdateRequest

logger = logging.getLogger(__name__)

ACCOUNT_NUMBER = re.compile(r"^[0-9]{9,18}$")
IFSC = re.compile(IFSC_PATTERN)
# Letters of any script, spaces and the punctuation names and bank names use.
HOLDER_NAME = re.compile(r"^[^\W\d_]+(?:[ .'\-]{1,2}[^\W\d_]+)*\.?$")  # "M. S. Dhoni", "D'Souza"
BANK_NAME = re.compile(r"^[\w .,'&()\-]+$")
UNAVAILABLE = "Bank details cannot be saved right now. Please try again later."
MASK = "••••••"


def _require_key() -> None:
    if not data_encryption.encryption_configured():
        raise HTTPException(status_code=503, detail=UNAVAILABLE)


def _collapse(value: str) -> str:
    return " ".join((value or "").split())


def clean_holder_name(value: str) -> str:
    name = _collapse(value)
    if not 2 <= len(name) <= 120 or not HOLDER_NAME.match(name):
        raise HTTPException(
            status_code=422, detail="Enter the account holder's name as it appears on the bank account."
        )
    return name


def clean_bank_name(value: str) -> str:
    name = _collapse(value)
    if not 2 <= len(name) <= 120 or not BANK_NAME.match(name) or not any(ch.isalpha() for ch in name):
        raise HTTPException(status_code=422, detail="Enter the name of the bank.")
    return name


def clean_account_number(value: str) -> str:
    # Spaces are how people group digits when typing; nothing else is accepted.
    number = (value or "").replace(" ", "")
    if not ACCOUNT_NUMBER.match(number) or set(number) == {"0"}:
        raise HTTPException(status_code=422, detail="Enter a valid bank account number (9 to 18 digits).")
    return number


def clean_ifsc(value: str) -> str:
    code = (value or "").strip().upper()
    if not IFSC.match(code):
        raise HTTPException(status_code=422, detail="Enter a valid 11-character IFSC code, e.g. SBIN0001234.")
    return code


def bank_account_response(account: TechnicianBankAccount) -> BankAccountResponse:
    return BankAccountResponse(
        account_holder_name=account.account_holder_name,
        bank_name=account.bank_name,
        account_number_masked=f"{MASK}{account.account_number_last4}",
        account_number_last4=account.account_number_last4,
        ifsc_code=account.ifsc_code,
        verification_status=account.verification_status,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


class BankAccountService:
    def __init__(self, repository: BankAccountRepository):
        self.repository = repository

    def _account_of(self, technician: Technician, *, lock: bool = False) -> TechnicianBankAccount | None:
        return self.repository.find_by_technician(technician.id, lock=lock)

    def read(self, technician: Technician) -> BankAccountResponse | None:
        account = self._account_of(technician)
        return bank_account_response(account) if account else None

    def save(self, technician: Technician, payload: BankAccountUpdateRequest) -> BankAccountResponse:
        holder = clean_holder_name(payload.account_holder_name)
        bank = clean_bank_name(payload.bank_name)
        number = clean_account_number(payload.account_number)
        if not hmac.compare_digest(number, (payload.confirm_account_number or "").replace(" ", "")):
            raise HTTPException(status_code=422, detail="The account numbers do not match.")
        ifsc = clean_ifsc(payload.ifsc)
        _require_key()

        account = self._account_of(technician, lock=True)
        if account is not None:
            try:
                same_number = hmac.compare_digest(
                    data_encryption.decrypt(
                        account.account_number_ciphertext, account.account_number_key_version
                    ).decode(),
                    number,
                )
            except data_encryption.DecryptionError:
                same_number = False  # stored under another key: treat as a change
            if same_number and (account.account_holder_name, account.bank_name, account.ifsc_code) == (
                holder,
                bank,
                ifsc,
            ):
                self.repository.rollback()
                return bank_account_response(account)  # nothing changed: status stays as it is
        else:
            account = TechnicianBankAccount(technician_id=technician.id, created_at=naive_utc_now())
            self.repository.add(account)

        account.account_holder_name = holder
        account.bank_name = bank
        account.account_number_ciphertext, account.account_number_key_version = data_encryption.encrypt(number.encode())
        account.account_number_last4 = number[-4:]
        account.ifsc_code = ifsc
        # New or changed details have not been checked by anybody.
        account.verification_status = BANK_UNVERIFIED
        account.updated_at = naive_utc_now()
        self.repository.commit()
        return bank_account_response(account)
