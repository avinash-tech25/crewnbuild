"""Projects: the House Owner's projects and the builder's board, creating, reading,
editing and deleting a project, its site photos and the daily activity timeline (ported
from the old project_service.py, same rules and answers).
"""

import uuid
from datetime import date as date_value
from datetime import datetime
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.modules.admin.scope import refuse_kuwait
from app.modules.files.models import File
from app.modules.files.upload_service import SITE_IMAGE, UploadService
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, User
from app.modules.projects.access import (
    ensure_engineer_project_write_access,
    ensure_project_activity_read_access,
    ensure_role,
    project_progress_fields,
)
from app.modules.projects.award_service import (
    CONSTRUCTION_STAGES,
    contract_fields,
    planned_start_notice,
    project_award_states,
    project_started_reason,
    project_work_started_reason,
)
from app.modules.projects.daily_window import daily_record_is_open, ensure_daily_record_open
from app.modules.projects.models import EscrowMilestone, Project, ProjectImage, ProjectTimeline
from app.modules.projects.notices import create_notification
from app.modules.projects.pending_links import (
    BUILDER_CALENDAR,
    BUILDER_PHOTOS,
    pending_daily_register_status,
    pending_project_feature_allowed,
    pending_require_project_feature,
)
from app.modules.projects.project_repository import ProjectRepository
from app.modules.projects.schemas import ProjectCreate, ProjectProgressUpdate

LOCALITY_INDIA = "IN"


def resolve_project_country(project: Any) -> str:
    """The country the site is in. India is the only country served, so every project
    resolves to it (the old resolve_project_country)."""
    return "India"


def project_locality(project: Any) -> str:
    return LOCALITY_INDIA


def file_id_of(url: str | None) -> uuid.UUID | None:
    """The files row behind a "/files/{id}" address, or None."""
    tail = str(url or "").rsplit("/", 1)[-1]
    try:
        return uuid.UUID(tail)
    except ValueError:
        return None


def save_database_upload_file(upload: UploadFile | None, uploads: UploadService, **options: Any) -> str | None:
    return uploads.save_and_address(upload, **options)


def save_upload_files(
    project_id: uuid.UUID,
    timeline_id: uuid.UUID,
    images: list[UploadFile],
    database: Session,
    uploads: UploadService,
    owner_id: uuid.UUID | None = None,
    module: str = "general",
    locality: str | None = None,
    category: str = SITE_IMAGE,
) -> list[str]:
    """Store site media for a project, filed under the project's country."""
    image_urls = []
    for image in images:
        image_url = save_database_upload_file(
            image, uploads, owner_id=owner_id, module=module, category=category, locality=locality
        )
        if image_url:
            database.add(ProjectImage(project_id=project_id, timeline_id=timeline_id, image_url=image_url))
            image_urls.append(image_url)
    return image_urls


def serialize_cost_entry(entry: Any) -> dict[str, Any]:
    """Every column of a row by its attribute name, as the old answers had it: dates and
    times as ISO text exactly as stored, numbers (and, as before, booleans) as numbers."""
    payload = {}
    for attribute in inspect(entry).mapper.column_attrs:
        value = getattr(entry, attribute.key)
        if hasattr(value, "isoformat"):
            value = value.isoformat()
        elif hasattr(value, "as_integer_ratio"):
            numeric = float(value)
            value = int(numeric) if numeric.is_integer() else numeric
        payload[attribute.key] = value
    return payload


def serialize_project_media(database: Session, images: list[Any]) -> list[dict[str, Any]]:
    """Project attachments, each tagged image or video by its stored file's type."""
    file_ids = [file_id for file_id in (file_id_of(image.image_url) for image in images) if file_id]
    content_types: dict[uuid.UUID, str] = {}
    if file_ids:
        for file_id, content_type in database.execute(
            select(File.id, File.content_type).where(File.id.in_(file_ids))
        ).all():
            content_types[file_id] = content_type
    payload = []
    for image in images:
        file_id = file_id_of(image.image_url)
        content_type = content_types.get(file_id) if file_id else None
        payload.append(
            {
                **serialize_cost_entry(image),
                "content_type": content_type,
                "media_type": "video" if str(content_type or "").startswith("video/") else "image",
            }
        )
    return payload


def purge_project(database: Session, project: Project) -> None:
    """Remove a project with everything scoped to it (the old purge_project_records): its
    photos, timeline, requests, awards, assignments, reviews and escrow go with it
    (ON DELETE CASCADE), and the files rows of its photos and cover are removed."""
    image_urls = list(database.scalars(select(ProjectImage.image_url).where(ProjectImage.project_id == project.id)))
    if project.cover_image_url:
        image_urls.append(project.cover_image_url)
    file_ids = [file_id for file_id in (file_id_of(url) for url in image_urls) if file_id]
    database.delete(project)
    database.flush()
    if file_ids:
        for stored in database.scalars(select(File).where(File.id.in_(file_ids))).all():
            database.delete(stored)


_PUBLIC_ACCOUNT = {User: lambda account: {"id": str(account.id), "name": account.name}}


def project_json(project: Project) -> dict:
    payload = jsonable_encoder(project, custom_encoder=_PUBLIC_ACCOUNT)
    # created_at is a naive UTC instant (datetime.utcnow); send it with its offset.
    # start_date / end_date are calendar dates and stay exactly as stored.
    payload["created_at"] = local_iso(project.created_at)
    # Not in the old answer: updated_at and deleted_at are new columns.
    payload.pop("updated_at", None)
    payload.pop("deleted_at", None)
    return payload


def fetch_latest_owner_project(database: Session, owner_id: uuid.UUID, pincode: str | None = None) -> Project | None:
    return ProjectRepository(database).find_latest_owner_project(owner_id, pincode)


def add_project_launch_records(database: Session, project: Project, payload: ProjectCreate) -> None:
    """Add the standard escrow milestones and notify matching nearby users.

    Self-construction projects reach nearby suppliers; every other construction
    type reaches nearby builders. The caller owns the transaction (no commit).
    """
    repository = ProjectRepository(database)
    repository.add_all(
        [
            EscrowMilestone(
                project_id=project.id,
                name=stage_name,
                amount=(payload.budget or 0) * stage_share,
                status="pending",
                sort_order=position,
            )
            for position, (stage_name, stage_share) in enumerate(CONSTRUCTION_STAGES)
        ]
    )
    if payload.construction_type == "SELF_CONSTRUCTION":
        nearby_suppliers = repository.list_nearby_suppliers(payload.pincode)
        for supplier in nearby_suppliers:
            create_notification(
                database,
                supplier.id,
                "New self-construction project",
                f"Supplier opportunity: {payload.title} is available in {payload.pincode}.",
                category="PROJECT",
            )
    else:
        nearby_contractors = repository.list_nearby_contractors(payload.pincode)
        for contractor in nearby_contractors:
            create_notification(
                database,
                contractor.id,
                "New builder project",
                f"Builder opportunity: {payload.title} is available in {payload.pincode}.",
                category="PROJECT",
            )


def assignment_schedule_fields(database: Session, project: Project) -> dict:
    """Whether work has actually started -- the rule that closes the project's
    builder assignment decisions -- and, while it has not, a warning when the
    planned start date has arrived ('today' / 'passed'). A planned date alone
    never blocks."""
    work_started = project_work_started_reason(database, project) is not None
    return {
        "work_started": work_started,
        "planned_start_notice": None if work_started else planned_start_notice(project),
    }


def check_project_schedule(start_date: date_value | None, end_date: date_value | None) -> None:
    """Both dates are required and the end may not be before the start.

    A 422 here instead of letting ck_projects_schedule_order reject the row."""
    if start_date is None or end_date is None:
        raise HTTPException(status_code=422, detail="Enter both the project start date and end date")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before the start date")


def create_project_record(
    payload: ProjectCreate, user: User, database: Session, cover_image_url: str | None = None
) -> Project:
    repository = ProjectRepository(database)
    ensure_role(user, "OWNER")
    check_project_schedule(payload.start_date, payload.end_date)
    # The budget the owner typed always wins. With none typed, an accepted
    # estimate's total becomes the budget; with neither, it stays 0 ("Not set").
    # Resolved here, before the escrow milestones are sized from payload.budget,
    # so the project and its milestones use the same figure.
    if not payload.budget and payload.estimated_cost and payload.estimated_cost > 0:
        payload = payload.model_copy(update={"budget": payload.estimated_cost})
    project_data = payload.model_dump()
    # The project country comes from the project's own location. The owner's
    # residence is deliberately not consulted.
    project_data["project_country"] = resolve_project_country(payload)
    project = Project(owner_id=user.id, **project_data, cover_image_url=cover_image_url)
    repository.add(project)
    repository.flush()
    add_project_launch_records(database, project, payload)
    repository.commit()
    repository.refresh(project)
    return project


def create_owner_profile_project_if_missing(database: Session, user: User) -> Project | None:
    repository = ProjectRepository(database)
    if user.role != ROLE_OWNER:
        return None
    if repository.find_owner_project_id(user.id):
        return None
    profile = user.owner_profile
    if not profile or not profile.project_title or not profile.project_description:
        return None
    if not user.address or not user.pincode:
        return None

    project_payload = ProjectCreate(
        title=profile.project_title,
        description=profile.project_description,
        address=user.address,
        pincode=user.pincode,
        building_type=profile.building_type or "RESIDENTIAL",
        construction_type=profile.construction_type or "CONTRACTOR",
        budget=float(profile.budget_amount or 0),
        land_area=float(profile.land_area or 0),
        floors=profile.floors or 1,
        floor_type=profile.floor_type,
    )
    # The site address is the owner's own address here, but the country still
    # comes from that location rather than from the account.
    project_data = project_payload.model_dump()
    project_data["project_country"] = resolve_project_country(project_payload)
    project = Project(owner_id=user.id, **project_data)
    repository.add(project)
    repository.flush()
    add_project_launch_records(database, project, project_payload)
    return project


class ProjectService:
    def __init__(self, repository: ProjectRepository):
        self.repository = repository
        # Still handed to other domains' helpers that take a session.
        self.database = repository.database

    def fetch_owner_projects(self, user: User):
        # Reading the list no longer seeds a project from the owner's profile.
        #
        # It used to, and that is what made deleting a project look broken: the
        # owner deleted their only project, the row really was removed, and then
        # this endpoint — the one the dashboard refreshes with immediately after —
        # saw an owner with no projects and recreated it from owner_profiles. The
        # card came straight back with a new id, so a genuine deletion read as a
        # false success, and refreshing never helped because every read re-seeded.
        #
        # The seeding still happens where it belongs, in the Complete Profile
        # handler, which is the moment an owner's stated requirement first becomes
        # a project. An owner who wants another one uses Create New Project.
        #
        # Owners see their own projects. A builder's projects are the ones
        # actually awarded to them, which is what `contractor_id` records.
        #
        # This used to also include every project where the builder merely held
        # an *accepted request* — but an accepted request is a quotation, not an
        # award. Several builders quote the same project and all of them hold an
        # accepted request at once, so that clause put one owner's project into
        # every one of their dashboards as an "upcoming project" before the
        # owner had chosen anyone. Choosing a quotation is what sets
        # `contractor_id` (see assign_project_builder), and that is the only
        # thing that should put a project on a builder's board.
        # No other role has a project list here: only the Owner and Builder
        # dashboards call this endpoint. It used to hand any other role every
        # project in its pincode (address, budget, contract values).
        if user.role not in (ROLE_OWNER, ROLE_BUILDER):
            return []
        projects = self.repository.list_visible_projects(
            user.role == ROLE_OWNER, user.role == ROLE_BUILDER, user.id, user.pincode
        )
        # Fetch owner names directly so we don't depend on relationship serialization.
        owner_ids = list({p.owner_id for p in projects if p.owner_id})
        owner_rows = self.repository.list_user_names(owner_ids) if owner_ids else []
        owner_name_map = {row.id: row.name for row in owner_rows}
        award_states = project_award_states(self.database, projects)
        return [
            {
                **project_json(project),
                "owner_name": owner_name_map.get(project.owner_id),
                # Calculated progress replaces the stored manual figure: the same
                # fields every other project endpoint returns.
                **project_progress_fields(project),
                **contract_fields(project, award_states.get(project.id)),
                # Whether the project has started (start date reached, progress or
                # work recorded). Read-only: computed from stored data.
                "started": project_started_reason(self.database, project) is not None,
                **assignment_schedule_fields(self.database, project),
            }
            for project in projects
        ]

    def create_project_request(self, payload: ProjectCreate, user: User):
        return create_project_record(payload, user, self.database)

    def create_project_with_image(
        self,
        title: str,
        description: str,
        address: str,
        pincode: str,
        building_type: str,
        construction_type: str,
        budget: float,
        land_area: float,
        floors: int,
        floor_type: str | None,
        project_country: str,
        project_state: str,
        project_city: str,
        estimated_cost: float | None,
        estimated_duration_days: int | None,
        material_estimate: float | None,
        labour_estimate: float | None,
        start_date: date_value | None,
        end_date: date_value | None,
        image: UploadFile | None,
        user: User,
        uploads: UploadService,
    ):
        refuse_kuwait(project_country)
        # Build the payload first: the cover image is site data, so it is stored
        # against the project's own country and not the uploader's.
        payload = ProjectCreate(
            title=title,
            description=description,
            address=address,
            pincode=pincode,
            building_type=building_type,
            construction_type=construction_type,
            budget=budget,
            land_area=land_area,
            floors=floors,
            floor_type=floor_type,
            project_country=project_country or None,
            project_state=project_state or None,
            project_city=project_city or None,
            estimated_cost=estimated_cost,
            estimated_duration_days=estimated_duration_days,
            material_estimate=material_estimate,
            labour_estimate=labour_estimate,
            start_date=start_date,
            end_date=end_date,
        )
        # Checked before the cover image is stored, so a refused project leaves no file.
        check_project_schedule(payload.start_date, payload.end_date)
        cover_image_url = save_database_upload_file(
            image,
            uploads,
            owner_id=user.id,
            module=user.role.lower(),
            category=SITE_IMAGE,
            locality=project_locality(payload),
        )
        return create_project_record(payload, user, self.database, cover_image_url=cover_image_url)

    def fetch_project_details(self, project_id: uuid.UUID, user: User):
        project = self.repository.find_project_with_timelines(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        ensure_project_activity_read_access(self.database, project_id, user)
        # The same payload FastAPI produced from the row, plus the contract fields.
        payload = {
            **project_json(project),
            **contract_fields(project, project_award_states(self.database, [project]).get(project.id)),
        }
        # The timelines carry the calendar and its photo addresses: a builder without
        # the calendar, or the owner or Site Engineer while the project's builder's
        # access is paused, gets the project without them.
        if not pending_project_feature_allowed(self.database, user, project, BUILDER_CALENDAR):
            payload.pop("timelines", None)
        return payload
        return {
            **project_json(project),
            **contract_fields(project, project_award_states(self.database, [project]).get(project.id)),
            **project_progress_fields(project),
        }

    def delete_owner_project(self, project_id: uuid.UUID, user: User):
        ensure_role(user, "OWNER")
        project = self.repository.get(project_id)
        if not project or project.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Project not found")

        # Started by the app's one rule (work recorded on site; the planned
        # start date alone does not count), checked first so it names the reason.
        if project_work_started_reason(self.database, project) is not None:
            raise HTTPException(status_code=409, detail="This project has already started and cannot be deleted.")
        if project.contractor_id:
            raise HTTPException(status_code=409, detail="This project has an assigned builder and cannot be deleted.")
        active_engineer = self.repository.find_active_project_engineer_id(project_id)
        if active_engineer:
            raise HTTPException(
                status_code=409, detail="This project has an assigned Site Engineer and cannot be deleted."
            )
        accepted_contractor_request = self.repository.find_accepted_contractor_request_id(project_id)
        if accepted_contractor_request:
            raise HTTPException(
                status_code=409,
                detail="This project has an accepted builder request that is still in progress and cannot be deleted.",
            )
        has_cost_records = self.repository.find_cost_register_id(project_id)
        if has_cost_records:
            raise HTTPException(
                status_code=409, detail="This project has construction cost records and cannot be deleted."
            )

        purge_project(self.database, project)
        self.repository.commit()
        return {"deleted": True, "project_id": project_id}

    def update_project_progress(self, project_id: uuid.UUID, payload: ProjectProgressUpdate, user: User):
        # Overall progress is calculated by the system (progress_service) and is
        # no longer typed in. The access check still runs first, so a caller
        # without write access gets the same 403/404 as before; anyone else is
        # told the value cannot be set. Nothing is written.
        ensure_engineer_project_write_access(self.database, project_id, user)
        raise HTTPException(
            status_code=410,
            detail="Overall project progress is calculated automatically and can no longer be entered manually.",
        )

    def update_project_requirement(self, project_id: uuid.UUID, payload: ProjectCreate, user: User):
        project = self.repository.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Only the project owner can edit requirements")
        project.title = payload.title or project.title
        project.description = payload.description or project.description
        project.address = payload.address or project.address
        project.pincode = payload.pincode or project.pincode
        project.building_type = payload.building_type or project.building_type
        project.construction_type = payload.construction_type or project.construction_type
        project.budget = payload.budget if payload.budget is not None else project.budget
        project.land_area = payload.land_area if payload.land_area is not None else project.land_area
        project.floors = payload.floors if payload.floors is not None else project.floors
        if payload.floor_type is not None:
            project.floor_type = payload.floor_type
        # The dates change only when the request sends them, so every existing
        # caller that does not know about them leaves them as they are. When sent,
        # the resulting schedule must be complete and in order.
        sent = payload.model_fields_set
        if "start_date" in sent or "end_date" in sent:
            start_date = payload.start_date if "start_date" in sent else project.start_date
            end_date = payload.end_date if "end_date" in sent else project.end_date
            check_project_schedule(start_date, end_date)
            project.start_date = start_date
            project.end_date = end_date
        self.repository.commit()
        self.repository.refresh(project)
        return {**project_json(project), **project_progress_fields(project)}

    def fetch_project_photos(self, project_id: uuid.UUID, user: User):
        project = self.repository.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if user.role == ROLE_OWNER:
            if project.owner_id != user.id:
                raise HTTPException(status_code=403, detail="Project photo access denied")
        else:
            ensure_project_activity_read_access(self.database, project_id, user)
        # The builder's view needs a plan or the free trial; the owner's and the Site
        # Engineer's follow the project's builder (the engineer's daily screen does
        # not use this list; it reads the open days from the timeline entries).
        pending_require_project_feature(self.database, user, project, BUILDER_PHOTOS)
        images = self.repository.list_project_images(project_id)
        media = serialize_project_media(self.database, images)
        return [
            {
                **row,
                "work_date": image.timeline.date.date().isoformat() if image.timeline and image.timeline.date else None,
            }
            for row, image in zip(media, images)
        ]

    def delete_project_photo(self, photo_id: uuid.UUID, user: User, uploads: UploadService):
        photo = self.repository.get_image(photo_id)
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")
        timeline = self.repository.get_timeline(photo.timeline_id)
        # Site Engineer only, and only their own upload. The builder and the house
        # owner view the calendar; they never edit its records on any plan.
        if user.role != ROLE_ENGINEER or not timeline or timeline.created_by_id != user.id:
            raise HTTPException(status_code=403, detail="Only the Site Engineer who uploaded this photo can delete it")
        selected_date = timeline.date.date() if timeline.date else None
        if not selected_date:
            raise HTTPException(status_code=400, detail="Photo has no valid activity date")
        register_status = pending_daily_register_status(self.database, photo.project_id, user.id, selected_date)
        if not register_status or register_status in {"COMPLETED", "CLOSED"}:
            raise HTTPException(status_code=409, detail="This day is completed and cannot be edited")
        ensure_daily_record_open(selected_date)
        file_part = photo.image_url or ""
        file_id = file_id_of(file_part) if "/" in file_part else None
        stored_object = None
        if file_id is not None:
            stored_file = self.repository.get_uploaded_file(file_id)
            if stored_file:
                stored_object = SimpleNamespace(
                    id=stored_file.id, bucket=stored_file.bucket, storage_key=stored_file.storage_key
                )
                self.repository.remove(stored_file)
        self.repository.remove(photo)
        self.repository.commit()
        # The stored object goes too, once the rows are gone (it used to be left
        # in the bucket with nothing pointing at it). Never fails the delete.
        if stored_object is not None and stored_object.bucket:
            try:
                uploads.delete_object(stored_object)
            except Exception:
                pass
        return {"deleted": True}

    def save_timeline_update(
        self,
        project_id: uuid.UUID,
        title: str,
        description: str,
        date: str,
        completion_status: str,
        images: list[UploadFile],
        user: User,
        uploads: UploadService,
    ):
        project = ensure_engineer_project_write_access(self.database, project_id, user)
        try:
            activity_date = datetime.fromisoformat(date)
        except ValueError:
            # Crash fixed: an unreadable date used to fail with a 500.
            raise HTTPException(status_code=422, detail="Enter a valid activity date") from None
        ensure_daily_record_open(activity_date.date())
        timeline = ProjectTimeline(
            project_id=project_id,
            created_by_id=user.id,
            title=title,
            description=description,
            date=activity_date,
            completion_status=completion_status,
        )
        self.repository.add(timeline)
        self.repository.flush()
        save_upload_files(
            project_id,
            timeline.id,
            images,
            self.database,
            uploads,
            owner_id=user.id,
            module=user.role.lower(),
            locality=project_locality(project),
        )
        if project.contractor_id:
            create_notification(
                self.database,
                project.contractor_id,
                "Project timeline updated",
                f"{user.name} added timeline update: {title}.",
                category="PROJECT",
            )
        self.repository.commit()
        self.repository.refresh(timeline)
        return {
            **serialize_cost_entry(timeline),
            "created_by_name": user.name,
            "images": [serialize_cost_entry(image) for image in timeline.images],
        }

    def fetch_project_timeline_entries(self, project_id: uuid.UUID, user: User):
        project = ensure_project_activity_read_access(self.database, project_id, user)
        if user.role != ROLE_ENGINEER:
            pending_require_project_feature(self.database, user, project, BUILDER_CALENDAR)  # builder and owner
        entries = self.repository.list_timeline_entries(project_id)
        if user.role == ROLE_ENGINEER and not pending_project_feature_allowed(
            self.database, user, project, BUILDER_CALENDAR
        ):
            # The engineer's daily screen loads this together with its form, so it is
            # never refused: while the builder's access is paused only the days still
            # open for reporting come back (today's entries and photos), not the history.
            entries = [entry for entry in entries if entry.date and daily_record_is_open(entry.date.date())]
        return [
            {
                **serialize_cost_entry(entry),
                "created_by_name": entry.created_by.name if entry.created_by else "",
                "images": serialize_project_media(self.database, entry.images),
            }
            for entry in entries
        ]
