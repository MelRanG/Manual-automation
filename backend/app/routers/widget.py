import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.chat import ChatSession, ChatMessage
from app.models.user import User
from app.schemas.widget import WidgetSessionCreate, WidgetSessionResponse, WidgetAskRequest, WidgetSessionAdmin
from app.services import chat_service

router = APIRouter(prefix="/api/widget", tags=["widget"])

WIDGET_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000099")


async def ensure_widget_user(db: AsyncSession):
    stmt = pg_insert(User).values(
        id=WIDGET_USER_ID,
        name="Widget Anonymous",
        email="widget@docops.ai",
        role="widget",
    ).on_conflict_do_nothing()
    await db.execute(stmt)
    await db.commit()


@router.post("/sessions", response_model=WidgetSessionResponse, status_code=201)
async def create_widget_session(
    data: WidgetSessionCreate,
    db: AsyncSession = Depends(get_db),
):
    if data.user_id is not None:
        result = await db.execute(select(User).where(User.id == data.user_id))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="User not found")
        owner_id = data.user_id
    else:
        await ensure_widget_user(db)
        owner_id = WIDGET_USER_ID

    anonymous_id = data.anonymous_id or str(uuid.uuid4())[:8]

    session = ChatSession(
        id=uuid.uuid4(),
        user_id=owner_id,
        title=f"widget:{data.site_id}:{anonymous_id}",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return WidgetSessionResponse(
        id=session.id,
        site_id=data.site_id,
        anonymous_id=anonymous_id,
        created_at=session.created_at,
    )


@router.post("/sessions/{session_id}/ask-stream")
async def widget_ask_stream(
    session_id: uuid.UUID,
    data: WidgetAskRequest,
    db: AsyncSession = Depends(get_db),
):
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    allow_sr_draft = session.user_id != WIDGET_USER_ID

    return StreamingResponse(
        chat_service.ask_question_stream(
            db, session_id, data.question,
            allow_sr_draft=allow_sr_draft,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/sessions/{session_id}/messages")
async def widget_get_messages(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = await chat_service.get_messages(db, session_id)
    return [
        {"id": str(m["id"]), "role": m["role"], "content": m["content"], "created_at": m["created_at"].isoformat()}
        for m in messages
    ]


@router.get("/admin/sessions", response_model=list[WidgetSessionAdmin])
async def admin_list_widget_sessions(
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.title.like("widget:%"))
        .where(
            select(ChatMessage.id)
            .where(ChatMessage.session_id == ChatSession.id)
            .exists()
        )
        .order_by(ChatSession.created_at.desc())
        .limit(50)
    )
    sessions = result.scalars().all()

    admin_sessions = []
    for s in sessions:
        parts = (s.title or "").split(":", 2)
        site_id = parts[1] if len(parts) > 1 else "unknown"
        anonymous_id = parts[2] if len(parts) > 2 else "unknown"

        msg_result = await db.execute(
            select(func.count(ChatMessage.id)).where(ChatMessage.session_id == s.id)
        )
        msg_count = msg_result.scalar() or 0

        last_msg_result = await db.execute(
            select(ChatMessage.content)
            .where(ChatMessage.session_id == s.id)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        last_msg = last_msg_result.scalar_one_or_none()

        admin_sessions.append(WidgetSessionAdmin(
            id=s.id,
            site_id=site_id,
            anonymous_id=anonymous_id,
            last_message=last_msg[:100] if last_msg else None,
            message_count=msg_count,
            created_at=s.created_at,
        ))

    return admin_sessions
