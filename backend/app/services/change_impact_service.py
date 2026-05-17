import difflib
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentVersion
from app.models.sr import ChangeImpactAnalysis, DocumentChangeProposal
from app.services.llm_service import get_llm_provider
from app.services.search_service import search_similar_chunks

IMPACT_ANALYSIS_PROMPT = """You are a change impact analyst for documentation.
Given a change description and related documents, analyze what other documents might need updates.
Respond with:
Strategy: [update_all / selective_update / no_action]
Reasoning: [your analysis]"""

MERGE_PROPOSAL_PROMPT = """You are a documentation update assistant.
Given the original document content and a description of changes that have occurred,
produce an updated version of the document that reflects those changes.
Return ONLY the updated document content."""


async def analyze_impact(
    db: AsyncSession,
    source_type: str,
    source_id: uuid.UUID,
    related_document_ids: list[uuid.UUID] | None = None,
) -> ChangeImpactAnalysis:
    llm = get_llm_provider()

    context_parts = []
    if related_document_ids:
        for doc_id in related_document_ids[:5]:
            doc_result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = doc_result.scalar_one_or_none()
            if doc:
                context_parts.append(f"Document: {doc.title}")

    result = await llm.generate(
        IMPACT_ANALYSIS_PROMPT,
        f"Source: {source_type} (ID: {source_id})\nRelated docs: {', '.join(context_parts) or 'none identified'}",
    )

    strategy = "selective_update"
    reasoning = result

    for line in result.split("\n"):
        if line.startswith("Strategy:"):
            s = line[9:].strip().lower().replace(" ", "_")
            if s in ("update_all", "selective_update", "no_action"):
                strategy = s
        elif line.startswith("Reasoning:"):
            reasoning = line[10:].strip()

    analysis = ChangeImpactAnalysis(
        id=uuid.uuid4(),
        source_type=source_type,
        source_id=source_id,
        related_document_ids=[str(d) for d in related_document_ids] if related_document_ids else None,
        recommended_strategy=strategy,
        reasoning=reasoning,
        confidence=0.75,
        status="completed",
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)
    return analysis


async def generate_change_proposals(
    db: AsyncSession, analysis_id: uuid.UUID
) -> list[DocumentChangeProposal]:
    analysis_result = await db.execute(
        select(ChangeImpactAnalysis).where(ChangeImpactAnalysis.id == analysis_id)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis or not analysis.related_document_ids:
        return []

    llm = get_llm_provider()
    proposals = []

    for doc_id_str in analysis.related_document_ids[:5]:
        doc_id = uuid.UUID(doc_id_str)
        doc_result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = doc_result.scalar_one_or_none()
        if not doc or not doc.current_version_id:
            continue

        version_result = await db.execute(
            select(DocumentVersion).where(DocumentVersion.id == doc.current_version_id)
        )
        version = version_result.scalar_one_or_none()
        if not version:
            continue

        proposed_content = await llm.generate(
            MERGE_PROPOSAL_PROMPT,
            f"Change context: {analysis.reasoning}\n\nOriginal content:\n{version.content}",
        )

        diff = "\n".join(difflib.unified_diff(
            version.content.splitlines(),
            proposed_content.splitlines(),
            lineterm="",
            fromfile="original",
            tofile="proposed",
        ))

        proposal = DocumentChangeProposal(
            id=uuid.uuid4(),
            impact_analysis_id=analysis.id,
            document_id=doc_id,
            original_content=version.content,
            proposed_content=proposed_content,
            diff=diff or "(no difference)",
            status="pending",
        )
        db.add(proposal)
        proposals.append(proposal)

    await db.commit()
    return proposals


async def list_analyses(db: AsyncSession) -> list[ChangeImpactAnalysis]:
    result = await db.execute(
        select(ChangeImpactAnalysis).order_by(ChangeImpactAnalysis.created_at.desc())
    )
    return list(result.scalars().all())
