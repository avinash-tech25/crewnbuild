"""The rows the award workflow reads and locks (ported from the old builder
award_repository.py)."""

import uuid

from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from app.modules.identity.models import User
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import (
    AWARD_ACTIVE_STATUSES,
    AWARD_CANCELLED,
    AWARD_DECLINED,
    OFFER_OPEN,
    AwardOffer,
    EscrowMilestone,
    Project,
    ProjectAward,
    ProjectRequest,
    ProjectTimeline,
)


class AwardRepository(BaseRepository[ProjectAward]):
    """Builder awards (ProjectAward), their offers (AwardOffer), and the project
    rows the award workflow reads and locks."""

    def __init__(self, database: Session):
        super().__init__(database, ProjectAward)

    # ------------------------------------------------------------- awards
    def list_active_awards(self, project_ids):
        return (
            self.database.query(ProjectAward)
            .filter(ProjectAward.project_id.in_(project_ids), ProjectAward.status.in_(AWARD_ACTIVE_STATUSES))
            .all()
        )

    def lock_award(self, award_id: uuid.UUID):
        return (
            self.database.query(ProjectAward)
            .filter(ProjectAward.id == award_id)
            .populate_existing()
            .with_for_update()
            .first()
        )

    def query_project_awards(self, project_id: uuid.UUID):
        """The project's awards as a query, for the caller to narrow."""
        return self.database.query(ProjectAward).filter(ProjectAward.project_id == project_id)

    def find_active_or_latest_award(self, query):
        return (
            query.filter(ProjectAward.status.in_(AWARD_ACTIVE_STATUSES)).first()
            or query.order_by(desc(ProjectAward.created_at), desc(ProjectAward.id)).first()
        )

    def list_ended_request_awards(self, request_id: uuid.UUID, builder_id, exclude_award_id: uuid.UUID):
        """Earlier negotiation rounds on one request with one builder: the
        cancelled or declined awards, oldest first."""
        return (
            self.database.query(ProjectAward)
            .filter(
                ProjectAward.request_id == request_id,
                ProjectAward.builder_id == builder_id,
                ProjectAward.id != exclude_award_id,
                ProjectAward.status.in_((AWARD_CANCELLED, AWARD_DECLINED)),
            )
            .order_by(ProjectAward.created_at, ProjectAward.id)
            .all()
        )

    def find_last_agreed_ended_award(self, request_id: uuid.UUID, builder_id, exclude_award_id: uuid.UUID):
        """The most recent ended round (cancelled or declined) on this request
        with this builder that had an agreed offer, or None."""
        return (
            self.database.query(ProjectAward)
            .filter(
                ProjectAward.request_id == request_id,
                ProjectAward.builder_id == builder_id,
                ProjectAward.id != exclude_award_id,
                ProjectAward.status.in_((AWARD_CANCELLED, AWARD_DECLINED)),
                ProjectAward.agreed_offer_id.isnot(None),
            )
            .order_by(desc(ProjectAward.created_at), desc(ProjectAward.id))
            .first()
        )

    def list_declined_award_request_ids(self, project_id: uuid.UUID):
        return (
            self.database.query(ProjectAward.request_id)
            .filter(ProjectAward.project_id == project_id, ProjectAward.status == AWARD_DECLINED)
            .all()
        )

    # ------------------------------------------------------------- offers
    def get_offer(self, offer_id: uuid.UUID):
        return self.database.get(AwardOffer, offer_id)

    def lock_offer(self, offer_id: uuid.UUID):
        return (
            self.database.query(AwardOffer)
            .filter(AwardOffer.id == offer_id)
            .populate_existing()
            .with_for_update()
            .first()
        )

    def find_open_offer(self, award_id: uuid.UUID, lock: bool = False):
        query = self.database.query(AwardOffer).filter(AwardOffer.award_id == award_id, AwardOffer.status == OFFER_OPEN)
        if lock:
            query = query.populate_existing().with_for_update()
        return query.first()

    def list_open_offers(self, award_id: uuid.UUID):
        return (
            self.database.query(AwardOffer)
            .filter(AwardOffer.award_id == award_id, AwardOffer.status == OFFER_OPEN)
            .all()
        )

    def list_offers(self, award_id: uuid.UUID):
        return (
            self.database.query(AwardOffer)
            .filter(AwardOffer.award_id == award_id)
            .order_by(AwardOffer.created_at, AwardOffer.id)
            .all()
        )

    # ------------------------------------------------- related project rows
    def get_project(self, project_id: uuid.UUID):
        return self.database.get(Project, project_id)

    def lock_project(self, project_id: uuid.UUID):
        return (
            self.database.query(Project).filter(Project.id == project_id).populate_existing().with_for_update().first()
        )

    def get_request(self, request_id: uuid.UUID):
        return self.database.get(ProjectRequest, request_id)

    def get_user(self, user_id):
        return self.database.get(User, user_id)

    def list_escrow_milestones(self, project_id: uuid.UUID):
        return (
            self.database.query(EscrowMilestone)
            .filter(EscrowMilestone.project_id == project_id)
            .order_by(EscrowMilestone.sort_order)
            .all()
        )

    def find_project_record_id(self, model, project_id: uuid.UUID):
        return self.database.query(model.id).filter(model.project_id == project_id).first()

    def find_site_activity_id(self, project_id: uuid.UUID):
        return (
            self.database.query(ProjectTimeline.id)
            .filter(
                ProjectTimeline.project_id == project_id,
                or_(ProjectTimeline.completion_status.is_(None), ProjectTimeline.completion_status != "FULFILLED"),
            )
            .first()
        )
