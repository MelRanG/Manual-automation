import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback import ProposedDocumentChange, ApprovalRequest
from app.models.document import Document, DocumentVersion
from app.services.document_service import create_new_version


async def create_approval_request(
    db: AsyncSession, proposed_change_id: uuid.UUID
) -> ApprovalRequest:
    existing = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.proposed_change_id == proposed_change_id
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("Approval request already exists")

    request = ApprovalRequest(
        id=uuid.uuid4(),
        proposed_change_id=proposed_change_id,
        status="pending",
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request


async def review_approval(
    db: AsyncSession,
    approval_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    action: str,
    comment: str | None = None,
    edited_content: str | None = None,
) -> ApprovalRequest:
    valid_actions = ("approved", "rejected", "edit_and_approve", "request_review")
    if action not in valid_actions:
        raise ValueError(f"Invalid action. Must be one of: {valid_actions}")

    result = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise ValueError("Approval request not found")

    if approval.status not in ("pending", "needs_review"):
        raise ValueError("Approval already reviewed")

    approval.reviewer_id = reviewer_id
    approval.comment = comment
    approval.reviewed_at = datetime.now(timezone.utc).isoformat()

    change_result = await db.execute(
        select(ProposedDocumentChange).where(
            ProposedDocumentChange.id == approval.proposed_change_id
        )
    )
    change = change_result.scalar_one_or_none()

    if action == "approved" and change:
        approval.status = "approved"
        change.status = "approved"
        await db.flush()
        await create_new_version(
            db,
            change.document_id,
            change.proposed_text,
            change_summary=f"Applied approved correction: {change.reasoning[:100]}",
            created_by=reviewer_id,
        )
    elif action == "edit_and_approve" and change:
        if not edited_content:
            raise ValueError("edited_content is required for edit_and_approve")
        approval.status = "approved"
        change.status = "approved"
        change.proposed_text = edited_content
        await db.flush()
        await create_new_version(
            db,
            change.document_id,
            edited_content,
            change_summary=f"Applied with reviewer edits: {comment or change.reasoning[:100]}",
            created_by=reviewer_id,
        )
    elif action == "request_review":
        approval.status = "needs_review"
        if change:
            change.status = "needs_review"
    elif action == "rejected" and change:
        approval.status = "rejected"
        change.status = "rejected"
    else:
        approval.status = action

    await db.commit()
    await db.refresh(approval)
    return approval


async def list_pending_approvals(db: AsyncSession) -> list[ApprovalRequest]:
    result = await db.execute(
        select(ApprovalRequest)
        .where(ApprovalRequest.status == "pending")
        .order_by(ApprovalRequest.created_at.asc())
    )
    return list(result.scalars().all())


async def get_approval(db: AsyncSession, approval_id: uuid.UUID) -> ApprovalRequest | None:
    result = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )
    return result.scalar_one_or_none()
