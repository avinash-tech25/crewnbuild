"""Marketplace accounts and administrator accounts (ported from the old
app/admin/services/account_service.py, same rules).

The hierarchy:

    Global Super Admin    creates Location Super Admins, and Managers if needed
    Location Super Admin  creates Managers, in its own country only
    Manager               creates nobody

Nobody creates a Global Super Admin through the API (only app/seeds/seed_admin_account.py
does). A Location Super Admin cannot choose the scope of whom it creates, and nobody can
grant a permission it does not itself hold.
"""

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.security.password_hashing import hash_secret, password_is_strong
from app.modules.accounts.models import ADMIN_SCOPES, SCOPE_GLOBAL, AdminProfile
from app.modules.accounts.profile_completion import profile_complete
from app.modules.admin import project_links
from app.modules.admin.admin_identity import PERMISSIONS, AdminIdentity, account_locality
from app.modules.admin.audit_log import (
    ACTION_ADMIN_CREATED,
    ACTION_ADMIN_DEACTIVATED,
    ACTION_ADMIN_REACTIVATED,
    ACTION_ADMIN_UPDATED,
    ACTION_USER_REACTIVATED,
    ACTION_USER_SUSPENDED,
    record,
)
from app.modules.admin.schemas import AdministratorCreate, AdministratorUpdate, StatusChange
from app.modules.admin.scope import assert_user_in_scope, load_suspendable_user, refuse_kuwait, scope_users, viewing
from app.modules.admin.verification_service import current_record, current_records_for, is_verified, profile_documents
from app.modules.identity.models import (
    ADMIN_ROLES,
    DEFAULT_COUNTRY,
    ROLE_BUILDER,
    ROLE_GLOBAL_SUPER_ADMIN,
    ROLE_LOCATION_SUPER_ADMIN,
    ROLE_MANAGER,
    ROLE_SUPPLIER,
    STATUS_ACTIVE,
    STATUS_SUSPENDED,
    User,
)
from app.modules.identity.repository import UserRepository
from app.modules.identity.service import LEGACY_BUILDER_ROLE

CREATABLE_ROLES = {
    ROLE_GLOBAL_SUPER_ADMIN: (ROLE_LOCATION_SUPER_ADMIN, ROLE_MANAGER),
    ROLE_LOCATION_SUPER_ADMIN: (ROLE_MANAGER,),
    ROLE_MANAGER: (),
}


def stored_role(role: str) -> str:
    """A role as stored; the console's old CONTRACTOR is the stored BUILDER."""
    wanted = role.upper().strip()
    return ROLE_BUILDER if wanted == LEGACY_BUILDER_ROLE else wanted


def resolve_scope(admin: AdminIdentity, requested_scope: str | None) -> str:
    """A location administrator always gets its own scope, whatever it asks for."""
    refuse_kuwait(requested_scope)
    if not admin.is_global:
        return admin.scope
    scope = (requested_scope or "").strip().upper()
    if scope not in ADMIN_SCOPES:
        raise HTTPException(status_code=400, detail="Choose a valid scope: GLOBAL or IN.")
    if scope == SCOPE_GLOBAL:
        raise HTTPException(status_code=403, detail="Global administrators cannot be created through the application.")
    return scope


def resolve_permissions(admin: AdminIdentity, role: str, requested: list[str] | None) -> str:
    """Super Admins hold everything by role (stored grant empty); a Manager's grant is
    explicit and never exceeds its creator's."""
    if role in (ROLE_GLOBAL_SUPER_ADMIN, ROLE_LOCATION_SUPER_ADMIN):
        return ""
    wanted = {p.strip() for p in (requested or []) if p and p.strip()}
    if not wanted:
        raise HTTPException(status_code=400, detail="Select at least one permission for this manager.")
    unknown = sorted(wanted - set(PERMISSIONS))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown permission: {', '.join(unknown)}")
    beyond = sorted(wanted - admin.permissions)
    if beyond:
        raise HTTPException(
            status_code=403, detail=f"You cannot grant a permission you do not hold: {', '.join(beyond)}"
        )
    if "admins.manage" in wanted:
        raise HTTPException(status_code=403, detail="Managers cannot be given administrator management.")
    return ",".join(sorted(wanted))


def granted(profile: AdminProfile) -> list[str]:
    return sorted(p.strip() for p in (profile.permissions or "").split(",") if p.strip())


def create_administrator(database: Session, admin: AdminIdentity, payload: AdministratorCreate) -> User:
    role = (payload.role or "").strip().upper()
    if role not in CREATABLE_ROLES.get(admin.user.role, ()):
        raise HTTPException(status_code=403, detail=f"Your role cannot create a {role or 'account'}.")
    email = (payload.email or "").strip().lower()
    name = (payload.name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Enter the administrator's name.")
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if UserRepository(database).get_by_email(email):
        raise HTTPException(status_code=409, detail="That email already has an account.")
    if not password_is_strong(payload.password or ""):
        raise HTTPException(
            status_code=422, detail="Password must have 10+ characters with upper, lower, number and symbol."
        )
    scope = resolve_scope(admin, payload.scope)
    permissions = resolve_permissions(admin, role, payload.permissions)
    user = User(
        name=name,
        email=email,
        phone="",
        password_hash=hash_secret(payload.password),
        role=role,
        address="CREWNBUILD administration",
        pincode="",
        country_code=DEFAULT_COUNTRY,
        status=STATUS_ACTIVE,
    )
    database.add(user)
    database.flush()
    database.add(AdminProfile(user_id=user.id, scope=scope, permissions=permissions, created_by_id=admin.user.id))
    database.flush()
    return user


def load_manageable_administrator(
    database: Session, admin: AdminIdentity, user_id: uuid.UUID
) -> tuple[User, AdminProfile]:
    target = database.get(User, user_id)
    profile = database.scalars(select(AdminProfile).where(AdminProfile.user_id == user_id)).first() if target else None
    if not target or not profile:
        raise HTTPException(status_code=404, detail="Administrator not found")
    if target.id == admin.user.id:
        raise HTTPException(status_code=400, detail="You cannot change your own account here.")
    if target.role == ROLE_GLOBAL_SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Global administrators cannot be changed through the application.")
    if not admin.is_global:
        if profile.scope != admin.scope:
            raise HTTPException(status_code=403, detail="That administrator belongs to another scope.")
        if target.role == ROLE_LOCATION_SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="You cannot change another Super Admin.")
    return target, profile


def update_administrator(
    admin: AdminIdentity, target: User, profile: AdminProfile, payload: AdministratorUpdate
) -> list[str]:
    """Change scope and/or permissions under the creation rules; what changed, for the
    audit entry."""
    changes: list[str] = []
    if payload.scope is not None:
        resolved = resolve_scope(admin, payload.scope)
        if resolved != profile.scope:
            changes.append(f"scope {profile.scope} -> {resolved}")
            profile.scope = resolved
            target.country_code = DEFAULT_COUNTRY
    if payload.permissions is not None:
        resolved = resolve_permissions(admin, target.role, payload.permissions)
        if resolved != (profile.permissions or ""):
            changes.append(f"permissions {profile.permissions or '(none)'} -> {resolved or '(none)'}")
            profile.permissions = resolved
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing was changed.")
    return changes


class AdminAccountService:
    def __init__(self, database: Session) -> None:
        self.database = database

    # ---- marketplace accounts ----

    def fetch_users(
        self,
        admin: AdminIdentity,
        *,
        role: str | None,
        status_filter: str | None,
        country: str | None,
        search: str | None,
        limit: int,
        offset: int,
    ) -> dict[str, Any]:
        viewer = viewing(admin, country)
        # Marketplace accounts only: administrators are managed under Administrators.
        statement: Select[Any] = scope_users(select(User), viewer).where(User.role.notin_(ADMIN_ROLES))
        if role:
            statement = statement.where(User.role == stored_role(role))
        if status_filter:
            statement = statement.where(User.status == status_filter.upper().strip())
        if search:
            term = f"%{search.strip()}%"
            statement = statement.where(or_(User.name.ilike(term), User.email.ilike(term), User.phone.ilike(term)))
        total = self.database.scalar(select(func.count()).select_from(statement.subquery())) or 0
        rows = self.database.scalars(
            statement.options(selectinload(User.supplier_profile))
            .order_by(User.created_at.desc())
            .offset(offset)
            .limit(limit)
        ).all()
        decisions = current_records_for(self.database, [user.id for user in rows])
        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "scope": admin.scope,
            "users": [
                {
                    "id": user.id,
                    "name": user.name,
                    "email": user.email,
                    "phone": user.phone,
                    "role": user.role,
                    "supplier_category": user.supplier_profile.supplier_category if user.supplier_profile else None,
                    "status": user.status,
                    "country": user.country_code,
                    "locality": account_locality(user),
                    "pincode": user.pincode,
                    "profile_complete": profile_complete(user),
                    # Only builders and suppliers submit documents; null for the rest.
                    "verification_status": (
                        (decisions[user.id].status if user.id in decisions else "PENDING")
                        if user.role in (ROLE_BUILDER, ROLE_SUPPLIER)
                        else None
                    ),
                    "verified": is_verified(decisions.get(user.id)),
                    "rating": user.rating,
                    "created_at": user.created_at,
                }
                for user in rows
            ],
        }

    def fetch_user_detail(self, user_id: uuid.UUID, admin: AdminIdentity) -> dict[str, Any]:
        target = self.database.get(User, user_id)
        if not target or target.role in ADMIN_ROLES:
            raise HTTPException(status_code=404, detail="Account not found")
        assert_user_in_scope(target, admin)
        decision = current_record(self.database, target.id)
        profile: dict[str, Any] | None = None
        if target.contractor_profile:
            builder = target.contractor_profile
            profile = {
                "company_name": builder.company_name,
                "license_number": builder.license_number,
                "experience_years": builder.experience_years,
                "about": builder.about,
                "service_locations": builder.service_locations,
                "services_offered": builder.services_offered,
                "gstin": builder.gstin,
                "pan": builder.pan,
            }
        elif target.supplier_profile:
            supplier = target.supplier_profile
            profile = {"store_name": supplier.store_name, "categories": supplier.categories, "about": supplier.about}
        elif target.owner_profile:
            owner = target.owner_profile
            profile = {"building_type": owner.building_type, "budget": float(owner.budget_amount or 0)}
        return {
            "id": target.id,
            "name": target.name,
            "email": target.email,
            "phone": target.phone,
            "role": target.role,
            "supplier_category": target.supplier_profile.supplier_category if target.supplier_profile else None,
            "status": target.status,
            "country": target.country_code,
            "address": target.address,
            "pincode": target.pincode,
            "rating": target.rating,
            "profile_complete": profile_complete(target),
            "created_at": target.created_at,
            "profile": profile,
            "documents": profile_documents(target),
            "verification": {
                "status": decision.status if decision else "PENDING",
                "verified": is_verified(decision),
                "reviewer_email": decision.reviewer_email if decision else None,
                "reviewed_at": decision.created_at if decision else None,
                "notes": decision.notes if decision else None,
                "expires_on": decision.expires_on if decision else None,
            },
            "projects_owned": project_links.pending_projects_owned_by(self.database, target.id),
            "projects_building": project_links.pending_projects_built_by(self.database, target.id),
        }

    def suspend_user(self, user_id: uuid.UUID, payload: StatusChange, admin: AdminIdentity) -> dict[str, Any]:
        target = load_suspendable_user(self.database, admin, user_id)
        reason = (payload.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Give a reason for suspending this account.")
        target.status = STATUS_SUSPENDED
        record(
            self.database,
            admin,
            ACTION_USER_SUSPENDED,
            target_type="user",
            target_id=target.id,
            summary=f"Suspended {target.role} {target.email}",
            reason=reason,
        )
        self.database.commit()
        return {"user_id": target.id, "status": target.status}

    def reactivate_user(self, user_id: uuid.UUID, payload: StatusChange, admin: AdminIdentity) -> dict[str, Any]:
        target = load_suspendable_user(self.database, admin, user_id)
        target.status = STATUS_ACTIVE
        record(
            self.database,
            admin,
            ACTION_USER_REACTIVATED,
            target_type="user",
            target_id=target.id,
            summary=f"Reactivated {target.role} {target.email}",
            reason=payload.reason,
        )
        self.database.commit()
        return {"user_id": target.id, "status": target.status}

    # ---- administrators ----

    def fetch_administrators(self, admin: AdminIdentity, country: str | None) -> dict[str, Any]:
        viewer = viewing(admin, country)
        statement = select(AdminProfile, User).join(User, AdminProfile.user_id == User.id)
        if not viewer.is_global:
            # A Global Super Admin narrowed to one country still administers it, so the
            # GLOBAL accounts stay in that country's list; a location admin sees its own.
            scopes = [viewer.scope, SCOPE_GLOBAL] if admin.is_global else [viewer.scope]
            statement = statement.where(AdminProfile.scope.in_(scopes))
        rows = self.database.execute(statement.order_by(AdminProfile.created_at.desc())).all()
        return {
            "scope": admin.scope,
            "admins": [
                {
                    "id": profile.id,
                    "user_id": user.id,
                    "name": user.name,
                    "email": user.email,
                    "role": user.role,
                    "scope": profile.scope,
                    "status": user.status,
                    "permissions": granted(profile),
                    "created_at": profile.created_at,
                }
                for profile, user in rows
            ],
        }

    def create_administrator(self, payload: AdministratorCreate, admin: AdminIdentity) -> dict[str, Any]:
        user = create_administrator(self.database, admin, payload)
        profile = self.database.scalars(select(AdminProfile).where(AdminProfile.user_id == user.id)).one()
        record(
            self.database,
            admin,
            ACTION_ADMIN_CREATED,
            target_type="admin",
            target_id=user.id,
            summary=f"Created {user.role} {user.email} with scope {profile.scope}",
        )
        self.database.commit()
        self.database.refresh(user)
        return {
            "id": profile.id,
            "user_id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "scope": profile.scope,
            "status": user.status,
            "permissions": sorted(p for p in (profile.permissions or "").split(",") if p),
        }

    def update_administrator(
        self, user_id: uuid.UUID, payload: AdministratorUpdate, admin: AdminIdentity
    ) -> dict[str, Any]:
        target, profile = load_manageable_administrator(self.database, admin, user_id)
        changes = update_administrator(admin, target, profile, payload)
        record(
            self.database,
            admin,
            ACTION_ADMIN_UPDATED,
            target_type="admin",
            target_id=target.id,
            summary=f"Updated {target.role} {target.email}: {'; '.join(changes)}",
            reason=payload.reason,
        )
        self.database.commit()
        return {
            "user_id": target.id,
            "scope": profile.scope,
            "permissions": [p for p in (profile.permissions or "").split(",") if p],
        }

    def set_administrator_status(
        self, user_id: uuid.UUID, payload: StatusChange, admin: AdminIdentity, *, active: bool
    ) -> dict[str, Any]:
        """Deactivate (suspend) or reactivate an administrator. The account survives, so
        the audit trail keeps a name to point at; only its access stops."""
        target, profile = load_manageable_administrator(self.database, admin, user_id)
        target.status = STATUS_ACTIVE if active else STATUS_SUSPENDED
        verb = "Reactivated" if active else "Deactivated"
        record(
            self.database,
            admin,
            ACTION_ADMIN_REACTIVATED if active else ACTION_ADMIN_DEACTIVATED,
            target_type="admin",
            target_id=target.id,
            summary=f"{verb} {target.role} {target.email} (scope {profile.scope})",
            reason=payload.reason,
        )
        self.database.commit()
        return {"user_id": target.id, "status": target.status}
