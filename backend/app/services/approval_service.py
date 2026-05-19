import asyncio
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

    if approval.approval_type == "doc_review":
        raise ValueError("doc_review 타입은 /doc-review 엔드포인트를 사용하세요")

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

            prefix = "Playwright auto-generated manual for "
            url_part = change.reasoning[len(prefix):] if change.reasoning.startswith(prefix) else change.reasoning
            title = f"사용자 매뉴얼 - {url_part[:40]}"
            doc = Document(
                id=uuid.uuid4(),
                title=title,
                description="Playwright 자동 생성 후 승인된 매뉴얼",
                owner_id=reviewer_id,
                status="active",
                priority="medium",
                trust_score=1.0,
                document_type="user_manual",
                source_type="playwright",
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

        elif change.source_type == "jira_sr" and "[create_new_doc]" in (change.reasoning or ""):
            # Jira SR 전략이 create_new_doc인 경우 — 신규 문서 생성
            from app.models.document import Document, DocumentVersion

            title = f"SR 기반 신규 문서 - {change.reasoning[len('[create_new_doc] '):][:50]}"
            doc = Document(
                id=uuid.uuid4(),
                title=title,
                description="Jira SR 완료 시 자동 생성된 문서",
                owner_id=reviewer_id,
                status="active",
                priority="medium",
                trust_score=1.0,
                document_type="operation_guide",
                source_type="jira_sr",
            )
            db.add(doc)
            await db.flush()

            version = DocumentVersion(
                id=uuid.uuid4(),
                document_id=doc.id,
                version_number=1,
                content=final_content,
                created_by=reviewer_id,
                change_summary="Jira SR 완료로 자동 생성된 문서 (승인됨)",
            )
            db.add(version)
            await db.flush()
            doc.current_version_id = version.id

        else:
            if action == "edit_and_approve":
                summary_prefix = f"Applied with reviewer edits: {comment or ''}"
            else:
                summary_prefix = "Applied approved correction: "
            change_summary = f"{summary_prefix}{change.reasoning[:100]}"
            await create_new_version(
                db,
                change.document_id,
                final_content,
                change_summary=change_summary,
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
    db: AsyncSession, status: str = "pending", skip: int = 0, limit: int = 20
) -> tuple[list[ApprovalRequest], int]:
    from sqlalchemy import func

    status_map = {
        "processing": ["pending", "needs_review"],
        "completed": ["approved", "rejected"],
        "all": None,
        "pending": ["pending"],
        "needs_review": ["pending", "needs_review"],
    }
    statuses = status_map.get(status, ["pending"])

    base = select(ApprovalRequest)
    if statuses is not None:
        base = base.where(ApprovalRequest.status.in_(statuses))

    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        base
        .options(selectinload(ApprovalRequest.proposed_change))
        .order_by(ApprovalRequest.created_at.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all()), total


async def get_approval(db: AsyncSession, approval_id: uuid.UUID) -> ApprovalRequest | None:
    result = await db.execute(
        select(ApprovalRequest)
        .options(selectinload(ApprovalRequest.proposed_change))
        .where(ApprovalRequest.id == approval_id)
    )
    return result.scalar_one_or_none()


async def review_doc_review_approval(
    db: AsyncSession,
    approval_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    action: str,
    target_url: str | None = None,
) -> ApprovalRequest:
    """doc_review 타입 승인 처리.
    action: "reject" | "approve_doc" | "approve_manual"
    """
    from app.models.sr import SRDraft

    valid_actions = ("reject", "approve_doc", "approve_manual")
    if action not in valid_actions:
        raise ValueError(f"action must be one of {valid_actions}")

    result = await db.execute(
        select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise ValueError("Approval not found")
    if approval.approval_type != "doc_review":
        raise ValueError("This approval is not a doc_review type")
    if approval.status != "pending":
        raise ValueError("Approval already reviewed")

    sr_result = await db.execute(
        select(SRDraft).where(SRDraft.id == approval.sr_draft_id)
    )
    draft = sr_result.scalar_one_or_none()

    approval.reviewer_id = reviewer_id
    approval.reviewed_at = datetime.now(timezone.utc).isoformat()

    if action == "reject":
        approval.status = "rejected"
        if draft:
            draft.status = "done_no_proposal"

    elif action in ("approve_doc", "approve_manual"):
        approval.status = "approved"
        await db.flush()

        if draft:
            from app.schemas.sr import CompletedSREvent
            from app.services.sr_service import process_completed_sr
            from app.db import SessionLocal

            event = CompletedSREvent(
                source="approval",
                external_issue_key=draft.jira_issue_key,
                status="Done",
                title=draft.title,
                description=draft.description,
            )

            async def _run():
                async with SessionLocal() as session:
                    await process_completed_sr(session, event)

            asyncio.create_task(_run())

        if action == "approve_manual" and draft:
            from app.services import manual_service
            from app.db import SessionLocal

            url = target_url or draft.target_url
            if url:
                async def _run_manual():
                    async with SessionLocal() as session:
                        job = await manual_service.create_job(
                            session,
                            user_id=reviewer_id,
                            target_url=url,
                            source_sr_id=draft.id,
                        )
                        await manual_service.run_generation(session, job.id)

                asyncio.create_task(_run_manual())

    await db.commit()

    refreshed = await db.execute(
        select(ApprovalRequest)
        .options(selectinload(ApprovalRequest.proposed_change))
        .where(ApprovalRequest.id == approval_id)
    )
    return refreshed.scalar_one()
