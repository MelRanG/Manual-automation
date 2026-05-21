import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.chat import ChatSession, ChatMessage, AnswerCitation
from app.models.feedback import FeedbackReport, ProposedDocumentChange, ApprovalRequest
from app.schemas.chat import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatMessageResponse,
    AskQuestionRequest,
    AskQuestionResponse,
)
from app.services import chat_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/sessions", response_model=ChatSessionResponse, status_code=201)
async def create_session(
    data: ChatSessionCreate,
    db: AsyncSession = Depends(get_db),
):
    return await chat_service.create_session(db, data.user_id, data.title)


@router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_sessions(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await chat_service.list_sessions(db, user_id)


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
async def get_messages(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return await chat_service.get_messages(db, session_id)


@router.post("/sessions/{session_id}/ask", response_model=AskQuestionResponse)
async def ask_question(
    session_id: uuid.UUID,
    data: AskQuestionRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await chat_service.ask_question(db, session_id, data.question)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/sessions/{session_id}/ask-stream")
async def ask_question_stream(
    session_id: uuid.UUID,
    data: AskQuestionRequest,
    db: AsyncSession = Depends(get_db),
):
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return StreamingResponse(
        chat_service.ask_question_stream(db, session_id, data.question),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select as sa_select
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    msg_ids_result = await db.execute(sa_select(ChatMessage.id).where(ChatMessage.session_id == session_id))
    msg_ids = msg_ids_result.scalars().all()
    if msg_ids:
        fb_ids_result = await db.execute(
            sa_select(FeedbackReport.id).where(FeedbackReport.chat_message_id.in_(msg_ids))
        )
        fb_ids = fb_ids_result.scalars().all()
        if fb_ids:
            pc_ids_result = await db.execute(
                sa_select(ProposedDocumentChange.id).where(ProposedDocumentChange.feedback_report_id.in_(fb_ids))
            )
            pc_ids = pc_ids_result.scalars().all()
            if pc_ids:
                await db.execute(delete(ApprovalRequest).where(ApprovalRequest.proposed_change_id.in_(pc_ids)))
                await db.execute(delete(ProposedDocumentChange).where(ProposedDocumentChange.id.in_(pc_ids)))
        await db.execute(delete(AnswerCitation).where(AnswerCitation.chat_message_id.in_(msg_ids)))
        await db.execute(delete(FeedbackReport).where(FeedbackReport.chat_message_id.in_(msg_ids)))
    await db.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
    await db.execute(delete(ChatSession).where(ChatSession.id == session_id))
    await db.commit()
