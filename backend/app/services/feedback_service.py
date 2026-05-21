import uuid
import difflib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentVersion, DocumentChunk
from app.models.feedback import FeedbackReport, ProposedDocumentChange
from app.schemas.feedback import FeedbackReportCreate, FeedbackReportResponse
from app.services.llm_service import get_llm_provider

CORRECTION_SYSTEM_PROMPT = """You are a documentation correction assistant.
Given a user's error report and the original document, return a corrected version of the ENTIRE document.
If a focus area is specified, only modify content within that area and leave the rest of the document unchanged.
Return ONLY the corrected document text, no commentary. Preserve original structure, formatting, and style."""


async def create_feedback(
    db: AsyncSession, data: FeedbackReportCreate
) -> FeedbackReport:
    report = FeedbackReport(
        id=uuid.uuid4(),
        user_id=data.user_id,
        document_id=data.document_id,
        chunk_id=data.chunk_id,
        chat_message_id=data.chat_message_id,
        feedback_text=data.feedback_text,
        status="pending",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


async def generate_correction(
    db: AsyncSession, feedback_id: uuid.UUID
) -> ProposedDocumentChange | None:
    result = await db.execute(
        select(FeedbackReport).where(FeedbackReport.id == feedback_id)
    )
    feedback = result.scalar_one_or_none()
    if not feedback or not feedback.document_id:
        return None

    doc_result = await db.execute(
        select(Document).where(Document.id == feedback.document_id)
    )
    doc = doc_result.scalar_one_or_none()
    if not doc or not doc.current_version_id:
        return None

    version_result = await db.execute(
        select(DocumentVersion).where(DocumentVersion.id == doc.current_version_id)
    )
    version = version_result.scalar_one_or_none()
    if not version:
        return None

    original_text = version.content or ""

    # version.content 가 비어있거나 변환 실패 마커면 chunks 로 복원 시도
    if not original_text.strip() or original_text.startswith("[변환 실패"):
        chunks_result = await db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == feedback.document_id)
            .order_by(DocumentChunk.chunk_index)
        )
        chunks = list(chunks_result.scalars().all())
        if chunks:
            joined = "\n\n".join(c.content for c in chunks if c.content)
            if joined.strip():
                original_text = joined

    # 그래도 비면 document description 으로 fallback
    if not original_text.strip():
        original_text = doc.description or ""

    if not original_text.strip():
        # 원본 텍스트 자체가 없으면 의미 있는 AI 수정안 불가 → proposal 생성 skip
        return None

    focus_section: str | None = None
    if feedback.chunk_id:
        chunk_result = await db.execute(
            select(DocumentChunk).where(DocumentChunk.id == feedback.chunk_id)
        )
        chunk = chunk_result.scalar_one_or_none()
        if chunk:
            focus_section = chunk.content

    report_text = feedback.reviewed_text or feedback.feedback_text

    if focus_section:
        user_prompt = (
            f"Error report: {report_text}\n\n"
            f"Original document:\n{original_text}\n\n"
            f"Focus area (only modify content within this section; return the FULL document with edits applied):\n{focus_section}"
        )
    else:
        user_prompt = (
            f"Error report: {report_text}\n\n"
            f"Original document:\n{original_text}"
        )

    llm = get_llm_provider()
    proposed_text = await llm.generate(
        CORRECTION_SYSTEM_PROMPT,
        user_prompt,
    )

    diff = "\n".join(
        difflib.unified_diff(
            original_text.splitlines(),
            proposed_text.splitlines(),
            lineterm="",
            fromfile="original",
            tofile="proposed",
        )
    )

    proposal = ProposedDocumentChange(
        id=uuid.uuid4(),
        feedback_report_id=feedback.id,
        document_id=feedback.document_id,
        document_version_id=version.id,
        original_text=original_text,
        proposed_text=proposed_text,
        diff=diff or "(no difference detected)",
        reasoning=f"AI correction based on feedback: {report_text[:200]}",
        confidence=0.8,
        source_type="feedback",
        status="pending",
    )
    db.add(proposal)

    feedback.status = "processed"
    await db.commit()
    await db.refresh(proposal)
    return proposal


async def list_feedback(
    db: AsyncSession,
    document_id: uuid.UUID | None = None,
    status: str | None = None,
) -> list[FeedbackReportResponse]:
    stmt = select(FeedbackReport).order_by(FeedbackReport.created_at.desc())
    if document_id:
        stmt = stmt.where(FeedbackReport.document_id == document_id)
    if status:
        stmt = stmt.where(FeedbackReport.status == status)
    result = await db.execute(stmt)
    reports = list(result.scalars().all())

    doc_ids = {r.document_id for r in reports if r.document_id}
    title_map: dict[uuid.UUID, str] = {}
    if doc_ids:
        doc_result = await db.execute(
            select(Document.id, Document.title).where(Document.id.in_(doc_ids))
        )
        title_map = {row.id: row.title for row in doc_result}

    report_ids = [r.id for r in reports]
    change_map: dict[uuid.UUID, str] = {}
    if report_ids:
        change_result = await db.execute(
            select(
                ProposedDocumentChange.feedback_report_id,
                ProposedDocumentChange.status,
            ).where(ProposedDocumentChange.feedback_report_id.in_(report_ids))
        )
        change_map = {row.feedback_report_id: row.status for row in change_result}

    return [
        FeedbackReportResponse.model_validate(r, from_attributes=True).model_copy(
            update={
                "document_title": title_map.get(r.document_id),
                "proposed_change_status": change_map.get(r.id),
            }
        )
        for r in reports
    ]


async def get_proposed_change(
    db: AsyncSession, feedback_id: uuid.UUID
) -> ProposedDocumentChange | None:
    result = await db.execute(
        select(ProposedDocumentChange).where(
            ProposedDocumentChange.feedback_report_id == feedback_id
        )
    )
    return result.scalar_one_or_none()
