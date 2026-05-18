import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.feedback import ProposedDocumentChange, ApprovalRequest
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

    result = await db.execute(
        select(ApprovalRequest)
        .options(selectinload(ApprovalRequest.proposed_change))
        .where(ApprovalRequest.id == request.id)
    )
    return result.scalar_one()


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

    if action in ("approved", "edit_and_approve") and change:
        if action == "edit_and_approve" and not edited_content:
            raise ValueError("edited_content is required for edit_and_approve")
        final_content = edited_content if (action == "edit_and_approve" and edited_content) else change.proposed_text
        approval.status = "approved"
        change.status = "approved"
        await db.flush()

        if change.source_type == "playwright":
            # 신규 Document 생성
            from app.models.document import Document, DocumentVersion
            from app.models.manual import ManualGenerationJob
            from sqlalchemy import select as _select

            doc = Document(
                id=uuid.uuid4(),
                title=f"사용자 매뉴얼 - {change.reasoning.replace('Playwright auto-generated manual for ', '')[:40]}",
                description="Playwright 자동 생성 후 승인된 매뉴얼",
                owner_id=reviewer_id,
                status="active",
                priority="medium",
                trust_score=1.0,
            )
            db.add(doc)
            await db.flush()

            version = DocumentVersion(
                id=uuid.uuid4(),
                document_id=doc.id,
                version_number=1,
                content=final_content,
                created_by=reviewer_id,
                change_summary="Approved Playwright auto-generated manual",
            )
            db.add(version)
            await db.flush()
            doc.current_version_id = version.id

            # ManualJob.output_document_id 업데이트
            if change.manual_job_id:
                job_result = await db.execute(
                    _select(ManualGenerationJob).where(
                        ManualGenerationJob.id == change.manual_job_id
                    )
                )
                job = job_result.scalar_one_or_none()
                if job:
                    job.output_document_id = doc.id
        else:
            await create_new_version(
                db,
                change.document_id,
                final_content,
                change_summary=f"Applied {'with reviewer edits: ' + (comment or '') if action == 'edit_and_approve' else 'approved correction: '}{change.reasoning[:100]}",
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

    refreshed = await db.execute(
        select(ApprovalRequest)
        .options(selectinload(ApprovalRequest.proposed_change))
        .where(ApprovalRequest.id == approval_id)
    )
    return refreshed.scalar_one()


async def list_pending_approvals(
    db: AsyncSession, status: str = "pending"
) -> list[ApprovalRequest]:
    if status == "all":
        stmt = (
            select(ApprovalRequest)
            .options(selectinload(ApprovalRequest.proposed_change))
            .order_by(ApprovalRequest.created_at.asc())
        )
    else:
        statuses = ["pending", "needs_review"] if status == "needs_review" else ["pending"]
        stmt = (
            select(ApprovalRequest)
            .options(selectinload(ApprovalRequest.proposed_change))
            .where(ApprovalRequest.status.in_(statuses))
            .order_by(ApprovalRequest.created_at.asc())
        )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_approval(db: AsyncSession, approval_id: uuid.UUID) -> ApprovalRequest | None:
    result = await db.execute(
        select(ApprovalRequest)
        .options(selectinload(ApprovalRequest.proposed_change))
        .where(ApprovalRequest.id == approval_id)
    )
    return result.scalar_one_or_none()
