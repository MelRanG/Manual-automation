import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentVersion
from app.models.feedback import FeedbackReport, ProposedDocumentChange


async def calculate_trust_score(db: AsyncSession, document_id: uuid.UUID) -> float:
    doc_result = await db.execute(select(Document).where(Document.id == document_id))
    doc = doc_result.scalar_one_or_none()
    if not doc:
        return 0.0

    score = 1.0

    version_count = await db.execute(
        select(func.count(DocumentVersion.id)).where(
            DocumentVersion.document_id == document_id
        )
    )
    num_versions = version_count.scalar_one()
    if num_versions > 1:
        score += min(num_versions * 0.02, 0.1)

    feedback_count = await db.execute(
        select(func.count(FeedbackReport.id)).where(
            FeedbackReport.document_id == document_id
        )
    )
    num_feedback = feedback_count.scalar_one()
    if num_feedback > 0:
        score -= min(num_feedback * 0.05, 0.3)

    resolved_count = await db.execute(
        select(func.count(FeedbackReport.id)).where(
            FeedbackReport.document_id == document_id,
            FeedbackReport.status == "processed",
        )
    )
    num_resolved = resolved_count.scalar_one()
    if num_resolved > 0:
        score += min(num_resolved * 0.03, 0.15)

    if doc.last_reviewed_at:
        try:
            reviewed = datetime.fromisoformat(doc.last_reviewed_at)
            days_since = (datetime.now(timezone.utc) - reviewed).days
            if days_since > 90:
                score -= min((days_since - 90) * 0.002, 0.2)
        except (ValueError, TypeError):
            pass

    score = max(0.0, min(1.0, score))

    doc.trust_score = round(score, 3)
    await db.commit()
    return doc.trust_score


async def get_trust_scores(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Document.id, Document.title, Document.trust_score)
        .order_by(Document.trust_score.asc())
    )
    return [
        {"id": str(row[0]), "title": row[1], "trust_score": row[2]}
        for row in result.all()
    ]
