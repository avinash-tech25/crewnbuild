"""The old Partner repository base (app/utils/base_repository.py): one Session call per
operation; services decide when a transaction ends."""

from typing import Any, Generic, TypeVar

from sqlalchemy.orm import Session

ModelType = TypeVar("ModelType")


class BaseRepository(Generic[ModelType]):
    def __init__(self, database: Session, model: type[ModelType]):
        self.database = database
        self.model = model

    def get(self, item_id: Any) -> ModelType | None:
        return self.database.get(self.model, item_id)

    def create(self, values: dict[str, Any]) -> ModelType:
        item = self.model(**values)
        self.database.add(item)
        self.database.flush()
        return item

    def update(self, item: ModelType, values: dict[str, Any]) -> ModelType:
        for key, value in values.items():
            setattr(item, key, value)
        self.database.add(item)
        self.database.flush()
        return item

    # Plain unit-of-work operations, each exactly one Session call. Services
    # decide when a transaction ends; these only carry the decision out, so the
    # flush/commit points stay where the service already had them.
    def add(self, item: Any) -> None:
        self.database.add(item)

    def add_all(self, items) -> None:
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

    def expire_all(self) -> None:
        self.database.expire_all()
