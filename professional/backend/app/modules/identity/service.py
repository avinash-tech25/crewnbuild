"""Sign-up and sign-in (password and WhatsApp code), and the account summary every
session answer carries. Ported from the old app/shared/auth/services/auth_service.py
with the same rules and messages.

Changes against the old code:
* Passwords are Argon2id; an old bcrypt hash is verified and replaced after the next
  successful password sign-in.
* An unknown sign-in identifier spends the time of one password check, so the answer
  time does not reveal which identifiers exist.
* The Builder role is stored as BUILDER; sign-up still accepts CONTRACTOR for it.
* Every account is an India account (country_code IN).
"""

import logging
import secrets
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.password_hashing import (
    hash_secret,
    needs_rehash,
    password_is_strong,
    verify_against_unknown_account,
    verify_secret,
)
from app.integrations.email.email_sender import EmailSender
from app.modules.accounts.models import BuilderProfile, EngineerProfile, OwnerProfile, SupplierProfile
from app.modules.accounts.profile_completion import profile_complete, profile_completion
from app.modules.billing.signup_checkout import pending_checkout, remember_signup_plan
from app.modules.identity.email_verification_service import EmailVerificationService
from app.modules.identity.models import (
    ADMIN_ROLES,
    COUNTRY_INDIA,
    MARKETPLACE_ROLES,
    ROLE_BUILDER,
    ROLE_ENGINEER,
    ROLE_GLOBAL_SUPER_ADMIN,
    ROLE_OWNER,
    ROLE_SUPPLIER,
    User,
)
from app.modules.identity.phone_verification_service import (
    NOT_REGISTERED_MESSAGE,
    PHONE_IN_USE_MESSAGE,
    PhoneVerificationService,
    phone_in_use,
)
from app.modules.identity.policies import GLOBAL_ADMIN_USE_WHATSAPP, ensure_may_sign_in
from app.modules.identity.repository import UserRepository
from app.modules.identity.schemas import SignupRequest

logger = logging.getLogger(__name__)

PHONE_MIN_DIGITS = 8
PHONE_MAX_DIGITS = 15
# The old role name for Builder, still accepted at sign-up and in the OAuth start link.
LEGACY_BUILDER_ROLE = "CONTRACTOR"

USE_USER_LOGIN = "Sign in with your mobile number and the WhatsApp code."
USE_ADMIN_LOGIN = "Administrators sign in with the mobile number saved on their administrator account."
AUTH_UNAVAILABLE_MESSAGE = "Sign-in is temporarily unavailable. Please try again shortly."
AMBIGUOUS_NUMBER_MESSAGE = "This mobile number cannot be used to sign in. Please contact CREWNBUILD support."
INVALID_CREDENTIALS = "Invalid username/email or password"

PHONE_UNIQUE_INDEXES = ("uq_users__country_code_phone", "uq_admin_profiles__phone")


def normalize_role(value: str | None) -> str:
    role = (value or "").upper().strip()
    return ROLE_BUILDER if role == LEGACY_BUILDER_ROLE else role


def normalize_phone(value: str, max_digits: int = 10) -> str:
    digits = "".join(character for character in value if character.isdigit())
    return digits[-max_digits:] if len(digits) > max_digits else digits


def country_is_india(value: str | None) -> bool:
    return (value or "India").strip().upper() == "INDIA"


def is_phone_unique_violation(error: IntegrityError) -> bool:
    diag = getattr(getattr(error, "orig", None), "diag", None)
    return getattr(diag, "constraint_name", None) in PHONE_UNIQUE_INDEXES


def dev_account_recovery_on(settings: Settings) -> bool:
    return settings.dev_account_recovery_enabled and settings.is_development()


def user_response(user: User, database: Session, include_created_at: bool = False) -> dict[str, Any]:
    """The account summary of every session answer; the old field names. The accounts
    endpoints also return `created_at`, as they did; the session answers never did."""
    payload: dict[str, Any] = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "email_verified": user.email_verified,
        "phone": user.phone,
        "role": user.role,
        "address": user.address,
        "pincode": user.pincode,
        "location": user.location,
        "country_of_residence": "India",
        "rating": user.rating,
        "profile_image_url": user.profile_image_url,
        "profile_complete": profile_complete(user),
        "profile_completion": profile_completion(user),
        "owner_profile": None,
        "contractor_profile": None,
        "supplier_profile": None,
        "engineer_profile": None,
        "subscription_checkout": pending_checkout(user, database),
    }
    if include_created_at:
        payload["created_at"] = user.created_at.isoformat() if user.created_at else None
    owner = user.owner_profile
    if owner:
        payload["owner_profile"] = {
            "building_type": owner.building_type,
            "construction_type": owner.construction_type,
            "budget": float(owner.budget_amount or 0),
            "land_area": owner.land_area,
            "floors": owner.floors,
            "floor_type": owner.floor_type,
            "project_title": owner.project_title,
            "project_description": owner.project_description,
            "site_status": owner.site_status,
            "start_timeline": owner.start_timeline,
            "design_status": owner.design_status,
            "contact_preference": owner.contact_preference,
        }
    if user.contractor_profile:
        payload["contractor_profile"] = {"company_name": user.contractor_profile.company_name}
    if user.supplier_profile:
        payload["supplier_profile"] = {"store_name": user.supplier_profile.store_name}
    engineer = user.engineer_profile
    if engineer:
        payload["engineer_profile"] = {
            "qualification": engineer.qualification,
            "specialization": engineer.specialization,
            "experience_years": engineer.experience_years,
            "license_number": engineer.license_number,
            "about": engineer.about,
            "profile_image_url": engineer.profile_image_url,
        }
    return payload


class AuthService:
    def __init__(
        self,
        database: Session,
        settings: Settings,
        email: EmailSender,
        email_verifications: EmailVerificationService,
        phone_verifications: PhoneVerificationService,
    ) -> None:
        self.database = database
        self.settings = settings
        self.users = UserRepository(database)
        self.email = email
        self.email_verifications = email_verifications
        self.phone_verifications = phone_verifications

    def session_response(self, user: User, csrf_token: str) -> dict[str, Any]:
        return {"user": user_response(user, self.database), "csrf_token": csrf_token}

    def user_response(self, user: User) -> dict[str, Any]:
        return user_response(user, self.database)

    # ---- sign-up ----

    def signup(self, payload: SignupRequest) -> User:
        try:
            return self._signup(payload)
        except SQLAlchemyError:
            self.database.rollback()
            logger.exception("Sign-up failed on a database error")
            raise HTTPException(status_code=503, detail=AUTH_UNAVAILABLE_MESSAGE) from None

    def _signup(self, payload: SignupRequest) -> User:
        email = (payload.email or "").strip().lower()
        # Phone-first sign-up: no e-mail and no password, only where the WhatsApp check is on.
        phone_first = not email
        if phone_first and not self.phone_verifications.required():
            raise HTTPException(status_code=422, detail="Enter a valid email address.")
        role = normalize_role(payload.role)
        name = payload.name.strip()
        address = payload.address.strip()

        if role not in MARKETPLACE_ROLES:
            raise HTTPException(status_code=400, detail="Choose a valid account role.")
        if len(name) < 2 or len(name) > 120:
            raise HTTPException(status_code=422, detail="Enter a name between 2 and 120 characters.")
        if address and (len(address) < 5 or len(address) > 500):
            raise HTTPException(status_code=422, detail="Enter a complete address (5 to 500 characters).")
        if not phone_first:
            if not password_is_strong(payload.password or ""):
                raise HTTPException(
                    status_code=422, detail="Password must have 10+ characters with upper, lower, number, and symbol."
                )
            if self.users.get_by_email(email):
                raise HTTPException(status_code=409, detail="Email already registered")
            self.email_verifications.require_verified(email)

        phone_check = None
        if self.phone_verifications.required():
            phone_check = self.phone_verifications.require_verified(payload.phone, payload.phone_verification_token)

        phone = phone_check.phone if phone_check else normalize_phone(payload.phone, PHONE_MAX_DIGITS)
        pincode = "".join(character for character in payload.pincode if character.isdigit())
        residence_country = (payload.country_of_residence or "").strip()
        if not phone:
            pass  # collected on the Complete Profile screen
        elif not residence_country:
            if len(phone) < PHONE_MIN_DIGITS or len(phone) > PHONE_MAX_DIGITS:
                raise HTTPException(status_code=422, detail="Enter a valid phone number (8 to 15 digits).")
        elif country_is_india(residence_country):
            if len(phone) != 10:
                raise HTTPException(status_code=422, detail="Enter a valid 10 digit phone number.")
            if pincode and len(pincode) != 6:
                raise HTTPException(status_code=422, detail="Enter a valid 6 digit pincode.")
        else:
            if len(phone) < PHONE_MIN_DIGITS or len(phone) > PHONE_MAX_DIGITS:
                raise HTTPException(status_code=422, detail="Enter a valid phone number for your country.")
            if pincode and (len(pincode) < 3 or len(pincode) > 10):
                raise HTTPException(status_code=422, detail="Enter a valid postal code for your country.")

        if phone and phone_in_use(self.database, phone):
            raise HTTPException(status_code=409, detail=PHONE_IN_USE_MESSAGE)

        user = User(
            name=name,
            email=email or None,
            email_verified_at=datetime.now(UTC) if email else None,
            phone=phone,
            # A phone-first account has no password: a random one nobody knows.
            password_hash=hash_secret(secrets.token_urlsafe(32) if phone_first else (payload.password or "")),
            role=role,
            address=payload.address,
            pincode=pincode,
            country_code=COUNTRY_INDIA,
        )
        try:
            self.database.add(user)
            self.database.flush()
            self.add_role_profile(user, payload)
            if email:
                self.email_verifications.consume(email)
            if phone_check:
                self.phone_verifications.consume(phone_check)
            self.database.commit()
        except IntegrityError as error:
            self.database.rollback()
            if is_phone_unique_violation(error):
                raise HTTPException(status_code=409, detail=PHONE_IN_USE_MESSAGE) from None
            raise
        self.database.refresh(user)
        if user.email:
            self.email.send_welcome_email(user.email, user.name)
        return user

    def add_role_profile(self, user: User, payload: SignupRequest) -> None:
        if user.role == ROLE_OWNER:
            self.database.add(
                OwnerProfile(
                    user_id=user.id,
                    building_type=payload.building_type or "RESIDENTIAL",
                    construction_type=payload.construction_type or "CONTRACTOR",
                    budget_amount=Decimal(str(payload.budget or 0)),
                    land_area=payload.land_area or 0,
                    floors=payload.floors or 1,
                )
            )
        elif user.role == ROLE_BUILDER:
            builder = BuilderProfile(
                user_id=user.id,
                company_name=payload.company_name or payload.name,
                license_number=payload.license_number,
                experience_years=payload.experience_years or 0,
            )
            remember_signup_plan(builder, payload.plan_code, payload.duration_code)
            self.database.add(builder)
        elif user.role == ROLE_SUPPLIER:
            self.database.add(
                SupplierProfile(
                    user_id=user.id, store_name=payload.store_name or payload.name, categories=payload.categories or ""
                )
            )
        elif user.role == ROLE_ENGINEER:
            self.database.add(
                EngineerProfile(
                    user_id=user.id,
                    qualification=payload.qualification,
                    specialization=payload.specialization,
                    experience_years=payload.experience_years or 0,
                    license_number=payload.license_number,
                    about=payload.about,
                )
            )

    # ---- refresh ----

    def require_session_user(self, user_id: uuid.UUID) -> User:
        """The account a session belongs to, if it may still hold one (checked before a
        refresh rotates the session)."""
        user = self.users.get(user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
        return ensure_may_sign_in(user)

    # ---- password sign-in ----

    def login(self, identifier: str, password: str) -> User:
        try:
            return self._login(identifier, password)
        except SQLAlchemyError:
            self.database.rollback()
            logger.exception("Login failed on a database error")
            raise HTTPException(status_code=503, detail=AUTH_UNAVAILABLE_MESSAGE) from None

    def _login(self, identifier: str, password: str) -> User:
        user = self.users.get_by_email_or_name(identifier)
        if user is None:
            verify_against_unknown_account(password)
            raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS)
        if not verify_secret(password, user.password_hash):
            raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS)
        # Both checks run after the password, so neither reveals which accounts exist.
        ensure_may_sign_in(user)
        self.ensure_password_sign_in_allowed(user)
        if needs_rehash(user.password_hash):
            user.password_hash = hash_secret(password)
            self.database.commit()
        return user

    def ensure_password_sign_in_allowed(self, user: User) -> None:
        """Where WhatsApp sign-in is on, password sign-in is for administrators (other
        than the Global Super Admin) and the development-only recovery page."""
        if user.role == ROLE_GLOBAL_SUPER_ADMIN:
            raise HTTPException(status_code=403, detail=GLOBAL_ADMIN_USE_WHATSAPP)
        if user.role in ADMIN_ROLES:
            return
        if not self.phone_verifications.required():
            return
        if dev_account_recovery_on(self.settings):
            return
        raise HTTPException(status_code=403, detail=USE_USER_LOGIN)

    # ---- WhatsApp sign-in ----

    def login_with_phone(self, raw_phone: str, raw_code: str) -> User:
        try:
            return self._login_with_phone(raw_phone, raw_code)
        except SQLAlchemyError:
            self.database.rollback()
            logger.exception("WhatsApp login failed on a database error")
            raise HTTPException(status_code=503, detail=AUTH_UNAVAILABLE_MESSAGE) from None

    def _login_with_phone(self, raw_phone: str, raw_code: str) -> User:
        """The code is checked first; only a correct one looks the account up, so a wrong
        code never says whether the number is registered."""
        if not self.phone_verifications.required():
            raise HTTPException(status_code=404, detail="WhatsApp sign-in is not enabled.")
        record = self.phone_verifications.verify_login_code(raw_phone, raw_code)
        # The code is spent whatever happens next: one code, one attempt to sign in.
        self.database.commit()
        user = self.login_account_for_phone(record.phone)
        self.phone_verifications.check_test_account(record.phone, user)
        return user

    def login_account_for_phone(self, phone: str) -> User:
        """The one account a number signs in, or the refusal. Administrators are found by
        their admin profile's number, everyone else by users.phone."""
        admin = self.users.get_admin_by_phone(phone)
        member = self.users.get_by_phone(phone)
        if admin and member and admin.id != member.id:
            logger.error("A WhatsApp sign-in number is held by an administrator and another account; refused")
            raise HTTPException(status_code=409, detail=AMBIGUOUS_NUMBER_MESSAGE)
        user = admin or member
        if not user:
            raise HTTPException(status_code=404, detail=NOT_REGISTERED_MESSAGE)
        ensure_may_sign_in(user)
        if user.role in ADMIN_ROLES and admin is None:
            raise HTTPException(status_code=403, detail=USE_ADMIN_LOGIN)
        return user
