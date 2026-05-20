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
    RequestDraftBody,
    LinkDocumentBody,
    ApplyDraftBody,
)
from app.services import feedback_service, approval_service

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("", response_model=FeedbackWithProposalResponse, status_code=201)
async def create_feedback(
    data: FeedbackReportCreate,
    db: AsyncSession = Depends(get_db),
):
    report = await feedback_service.create_feedback(db, data)

    if data.document_id:
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
        proposed_change=None,
        approval_id=None,
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

    is_stale = False
    if proposal.document_version_id and proposal.document_id:
        doc_result = await db.execute(select(Document).where(Document.id == proposal.document_id))
        doc = doc_result.scalar_one_or_none()
        if doc and doc.current_version_id != proposal.document_version_id:
            is_stale = True

    return ProposedChangeResponse.model_validate(proposal, from_attributes=True).model_copy(
        update={"is_stale": is_stale}
    )


@router.post("/{feedback_id}/request-draft", response_model=FeedbackWithProposalResponse)
async def request_draft(
    feedback_id: uuid.UUID,
    body: RequestDraftBody,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if not feedback.document_id:
        raise HTTPException(status_code=400, detail="Feedback has no linked document")

    existing = await feedback_service.get_proposed_change(db, feedback_id)
    if existing:
        raise HTTPException(status_code=400, detail="Draft already exists")

    feedback.reviewed_text = body.reviewed_text
    await db.commit()
    await db.refresh(feedback)

    proposal = await feedback_service.generate_correction(db, feedback_id)
    if not proposal:
        raise HTTPException(status_code=500, detail="Failed to generate draft")

    approval = await approval_service.create_approval_request(db, proposal.id)

    return FeedbackWithProposalResponse(
        feedback=feedback,
        proposed_change=proposal,
        approval_id=approval.id if approval else None,
    )


@router.patch("/{feedback_id}/link-document", response_model=FeedbackReportResponse)
async def link_document(
    feedback_id: uuid.UUID,
    body: LinkDocumentBody,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FeedbackReport).where(FeedbackReport.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if feedback.document_id:
        raise HTTPException(status_code=400, detail="Feedback already has a linked document")

    doc_result = await db.execute(select(Document).where(Document.id == body.document_id))
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    feedback.document_id = body.document_id
    await db.commit()
    await db.refresh(feedback)

    return FeedbackReportResponse.model_validate(
        feedback, from_attributes=True
    ).model_copy(update={"document_title": doc.title})


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
