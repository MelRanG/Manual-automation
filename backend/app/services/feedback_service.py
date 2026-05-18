import uuid
import difflib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentVersion, DocumentChunk
from app.models.feedback import FeedbackReport, ProposedDocumentChange
from app.schemas.feedback import FeedbackReportCreate
from app.services.llm_service import get_llm_provider

CORRECTION_SYSTEM_PROMPT = """You are a documentation correction assistant.
Given a user's error report and the original text, propose a corrected version.
Return ONLY the corrected text, nothing else. Keep the same structure and style."""


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

    original_text = version.content

    if feedback.chunk_id:
        chunk_result = await db.execute(
            select(DocumentChunk).where(DocumentChunk.id == feedback.chunk_id)
        )
        chunk = chunk_result.scalar_one_or_none()
        if chunk:
            original_text = chunk.content

    llm = get_llm_provider()
    proposed_text = await llm.generate(
        CORRECTION_SYSTEM_PROMPT,
        f"Error report: {feedback.feedback_text}\n\nOriginal text:\n{original_text}",
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
        reasoning=f"AI correction based on feedback: {feedback.feedback_text[:200]}",
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
    db: AsyncSession, document_id: uuid.UUID | None = None
) -> list["FeedbackReportResponse"]:
    from app.schemas.feedback import FeedbackReportResponse

    stmt = select(FeedbackReport).order_by(FeedbackReport.created_at.desc())
    if document_id:
        stmt = stmt.where(FeedbackReport.document_id == document_id)
    result = await db.execute(stmt)
    reports = list(result.scalars().all())

    doc_ids = {r.document_id for r in reports if r.document_id}
    title_map: dict = {}
    if doc_ids:
        doc_result = await db.execute(
            select(Document.id, Document.title).where(Document.id.in_(doc_ids))
        )
        title_map = {row.id: row.title for row in doc_result}

    return [
        FeedbackReportResponse.model_validate(r, from_attributes=True).model_copy(
            update={"document_title": title_map.get(r.document_id)}
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
