import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.document import Document
from app.models.feedback import FeedbackReport, ProposedDocumentChange
from app.routers.notifications import create_notification
from app.schemas.feedback import (
    FeedbackReportCreate,
    FeedbackReportResponse,
    ProposedChangeResponse,
    FeedbackWithProposalResponse,
)
from app.services import feedback_service, approval_service

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("", response_model=FeedbackWithProposalResponse, status_code=201)
async def create_feedback(
    data: FeedbackReportCreate,
    db: AsyncSession = Depends(get_db),
):
    report = await feedback_service.create_feedback(db, data)
    proposal = None
    approval = None
    if data.document_id:
        proposal = await feedback_service.generate_correction(db, report.id)
        if proposal:
            approval = await approval_service.create_approval_request(db, proposal.id)
        await db.refresh(report)

        # 문서 소유자에게 알림
        doc_result = await db.execute(select(Document).where(Document.id == data.document_id))
        doc = doc_result.scalar_one_or_none()
        if doc and doc.owner_id:
            short_text = data.feedback_text[:80] + ("..." if len(data.feedback_text) > 80 else "")
            await create_notification(
                db,
                user_id=doc.owner_id,
                type="feedback_received",
                title=f"'{doc.title}' 문서에 오류가 제보되었습니다",
                message=short_text,
                document_id=data.document_id,
            )

    return FeedbackWithProposalResponse(
        feedback=report,
        proposed_change=proposal,
        approval_id=approval.id if approval else None,
    )


@router.get("", response_model=list[FeedbackReportResponse])
async def list_feedback(
    document_id: uuid.UUID | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await feedback_service.list_feedback(db, document_id, status)


@router.get("/{feedback_id}/proposal", response_model=ProposedChangeResponse)
async def get_proposal(
    feedback_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    proposal = await feedback_service.get_proposed_change(db, feedback_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="No proposal found")
    return proposal


@router.delete("/{feedback_id}", status_code=204)
async def delete_feedback(
    feedback_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    await db.execute(delete(ProposedDocumentChange).where(ProposedDocumentChange.feedback_report_id == feedback_id))
    await db.execute(delete(FeedbackReport).where(FeedbackReport.id == feedback_id))
    await db.commit()
