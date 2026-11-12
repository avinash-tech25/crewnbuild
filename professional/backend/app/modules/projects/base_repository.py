"""The unit-of-work helpers the ported project repositories are built on (the old
utils/base_repository.py): each call is one Session call, and the services decide when a
transaction ends."""

from collections.abc import Iterable
from typing import Any

from sqlalchemy.orm import Session


class BaseRepository[ModelType]:
    def __init__(self, database: Session, model: type[ModelType]) -> None:
        self.database = database
        self.model = model

    def get(self, item_id: Any) -> ModelType | None:
        return self.database.get(self.model, item_id)

    def add(self, item: Any) -> None:
        self.database.add(item)

    def add_all(self, items: Iterable[Any]) -> None:
        self.database.add_all(items)

    def remove(self, item: Any) -> None:
        self.database.delete(item)

    def flush(self) -> None:
        self.database.flush()

    def commit(self) -> None:
        self.database.commit()

    def rollback(self) -> None:
        self.database.rollback()

    def refresh(self, item: Any) -> None:
        self.database.refresh(item)
