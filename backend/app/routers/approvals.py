import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.document import Document
from app.models.feedback import FeedbackReport, ProposedDocumentChange
from app.routers.notifications import create_notification
from app.schemas.approval import ApprovalAction, ApprovalRequestResponse, ApprovalListResponse
from app.services import approval_service

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


@router.post("/{proposed_change_id}", response_model=ApprovalRequestResponse, status_code=201)
async def create_approval_request(
    proposed_change_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await approval_service.create_approval_request(db, proposed_change_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/{approval_id}/review", response_model=ApprovalRequestResponse)
async def review_approval(
    approval_id: uuid.UUID,
    data: ApprovalAction,
    db: AsyncSession = Depends(get_db),
):
    valid_actions = ("approved", "rejected", "edit_and_approve", "request_review")
    if data.action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Action must be one of: {valid_actions}")
    try:
        result = await approval_service.review_approval(
            db, approval_id, data.reviewer_id, data.action, data.comment, data.edited_content
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 승인/반려 시 제안자(피드백 작성자)에게 알림
    if data.action in ("approved", "rejected", "edit_and_approve"):
        change_result = await db.execute(
            select(ProposedDocumentChange).where(
                ProposedDocumentChange.id == result.proposed_change_id
            )
        )
        change = change_result.scalar_one_or_none()
        if change:
            feedback_result = await db.execute(
                select(FeedbackReport).where(FeedbackReport.id == change.feedback_report_id)
            )
            feedback = feedback_result.scalar_one_or_none()

            doc_result = await db.execute(
                select(Document).where(Document.id == change.document_id)
            )
            doc = doc_result.scalar_one_or_none()

            if feedback and doc:
                is_approved = data.action in ("approved", "edit_and_approve")
                status_text = "승인" if is_approved else "반려"
                notif_type = "approval_approved" if is_approved else "approval_rejected"
                await create_notification(
                    db,
                    user_id=feedback.user_id,
                    type=notif_type,
                    title=f"오류 제보가 {status_text}되었습니다",
                    message=f"'{doc.title}' 문서에 대한 수정 제안이 {status_text}되었습니다." + (f" 사유: {data.comment}" if data.comment else ""),
                    document_id=change.document_id,
                )

    return result


@router.get("", response_model=ApprovalListResponse)
async def list_pending_approvals(
    status: str = "pending",
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    items, total = await approval_service.list_pending_approvals(db, status=status, skip=skip, limit=limit)
    return ApprovalListResponse(items=items, total=total)


@router.get("/{approval_id}", response_model=ApprovalRequestResponse)
async def get_approval(
    approval_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    approval = await approval_service.get_approval(db, approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval
