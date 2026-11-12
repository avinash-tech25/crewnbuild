"""A House Owner's first project, made from the project details on their profile.

The old complete-profile save called create_owner_profile_project_if_missing: when a
House Owner's profile carries a project title and description, and the account has an
address and pincode, and the owner has no project yet, a project is created from those
details. NOT PORTED YET: the projects table comes with the projects module, which
replaces this function with the real one. Until then no project is created here.
"""

from sqlalchemy.orm import Session

from app.modules.identity.models import User


def create_owner_profile_project_if_missing(database: Session, user: User) -> None:
    return None
