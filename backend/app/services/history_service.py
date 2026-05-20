import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.history import ChangeHistory


async def log_event(
    db: AsyncSession,
    entity_type: str,
    entity_id: uuid.UUID,
    event_type: str,
    actor_id: uuid.UUID | None = None,
    actor_name: str | None = None,
    detail: str | None = None,
) -> ChangeHistory:
    event = ChangeHistory(
        entity_type=entity_type,
        entity_id=entity_id,
        event_type=event_type,
        actor_id=actor_id,
        actor_name=actor_name,
        detail=detail,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def list_events(
    db: AsyncSession,
    entity_type: str,
    entity_id: uuid.UUID,
) -> list[ChangeHistory]:
    result = await db.execute(
        select(ChangeHistory)
        .where(
            ChangeHistory.entity_type == entity_type,
            ChangeHistory.entity_id == entity_id,
        )
        .order_by(ChangeHistory.created_at.asc())
    )
    return list(result.scalars().all())
