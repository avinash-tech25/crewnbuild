"""A House Owner's first project, made from the project details on their profile (the
old create_owner_profile_project_if_missing, called by the complete-profile save, which
commits). The function itself lives with the other project writes."""

from app.modules.projects.project_service import create_owner_profile_project_if_missing

__all__ = ["create_owner_profile_project_if_missing"]
