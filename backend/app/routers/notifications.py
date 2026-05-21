import asyncio
import json
import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.notification import Notification

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# in-memory pub/sub: user_id -> list of queues
_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)


async def push_notification(user_id: str, notification: dict) -> None:
    for q in _subscribers.get(user_id, []):
        await q.put(notification)


async def create_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    type: str,
    title: str,
    message: str,
    document_id: uuid.UUID | None = None,
    link_path: str | None = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        document_id=document_id,
        link_path=link_path,
    )
    db.add(notif)
    await db.commit()
    await db.refresh(notif)

    payload = {
        "id": str(notif.id),
        "type": notif.type,
        "title": notif.title,
        "message": notif.message,
        "document_id": str(notif.document_id) if notif.document_id else None,
        "link_path": notif.link_path,
        "is_read": notif.is_read,
        "created_at": notif.created_at.isoformat(),
    }
    await push_notification(str(user_id), payload)
    return notif


class NotificationResponse(BaseModel):
    id: str
    type: str
    title: str
    message: str
    document_id: str | None
    link_path: str | None
    is_read: bool
    created_at: str

    model_config = {"from_attributes": True}


def _serialize(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=str(n.id),
        type=n.type,
        title=n.title,
        message=n.message,
        document_id=str(n.document_id) if n.document_id else None,
        link_path=n.link_path,
        is_read=n.is_read,
        created_at=n.created_at.isoformat(),
    )


def _get_user_id(x_user_id: str | None = Header(default=None, alias="X-User-Id")) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="인증이 필요합니다")
    try:
        uuid.UUID(x_user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="유효하지 않은 사용자 ID")
    return x_user_id


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    user_id: str = Depends(_get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == uuid.UUID(user_id))
        .order_by(Notification.is_read.asc(), Notification.created_at.desc())
        .limit(50)
    )
    return [_serialize(n) for n in result.scalars().all()]


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: uuid.UUID,
    user_id: str = Depends(_get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == uuid.UUID(user_id))
        .values(is_read=True)
    )
    await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    user_id: str = Depends(_get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == uuid.UUID(user_id), Notification.is_read == False)  # noqa: E712
        .values(is_read=True)
    )
    await db.commit()
    return {"ok": True}


@router.get("/stream")
async def notification_stream(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="인증이 필요합니다")

    queue: asyncio.Queue = asyncio.Queue()
    _subscribers[x_user_id].append(queue)

    async def event_generator():
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    notification = await asyncio.wait_for(queue.get(), timeout=30.0)
                    data = json.dumps(notification, ensure_ascii=False)
                    yield f"event: notification\ndata: {data}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            if queue in _subscribers[x_user_id]:
                _subscribers[x_user_id].remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
