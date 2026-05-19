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


async def recommend_strategy_for_document(db: AsyncSession, analysis_id: uuid.UUID, document_id: uuid.UUID) -> dict:
    analysis_result = await db.execute(select(ChangeImpactAnalysis).where(ChangeImpactAnalysis.id == analysis_id))
    analysis = analysis_result.scalar_one_or_none()
    if not analysis: raise ValueError("Analysis not found")

    from app.models.sr import SRDraft
    sr_result = await db.execute(select(SRDraft).where(SRDraft.id == analysis.source_id))
    sr = sr_result.scalar_one_or_none()
    
    doc_result = await db.execute(select(Document).where(Document.id == document_id))
    doc = doc_result.scalar_one_or_none()
    
    version_result = await db.execute(select(DocumentVersion).where(DocumentVersion.id == doc.current_version_id))
    version = version_result.scalar_one_or_none()
    
    llm = get_llm_provider()
    prompt = f"""서비스 요청(SR)의 완료 내용을 바탕으로 문서 업데이트 전략을 추천하세요.
SR 제목: {sr.title if sr else 'N/A'}
SR 설명: {sr.description if sr else 'N/A'}
문서 제목: {doc.title if doc else 'N/A'}

전략 옵션:
1. partial_update: 기존 문서 일부 수정 (구조 유지 가능)
2. overwrite: 기존 문서를 새 버전으로 전체 교체 (절차 대부분 변경)
3. create_new: 완전히 새로운 독립 문서 생성
4. hold: 판단 불가, 보류

결과는 반드시 다음 JSON 형식으로 출력하세요.
{{"recommended_strategy": "옵션 중 택 1", "confidence": 0.0~1.0, "reasoning": "설명"}}
"""
    try:
        import json, re
        decision_text = await llm.generate("당신은 기술 문서 전략가입니다. JSON만 반환하세요.", prompt)
        match = re.search(r'\{.*\}', decision_text, re.DOTALL)
        res = json.loads(match.group(0)) if match else {"recommended_strategy": "hold", "confidence": 0.5, "reasoning": "Parse failed"}
    except Exception as e:
        res = {"recommended_strategy": "hold", "confidence": 0.0, "reasoning": str(e)}
        
    return res

async def generate_change_proposal_with_strategy(
    db: AsyncSession, analysis_id: uuid.UUID, document_id: uuid.UUID, strategy: str
) -> DocumentChangeProposal:
    analysis_result = await db.execute(select(ChangeImpactAnalysis).where(ChangeImpactAnalysis.id == analysis_id))
    analysis = analysis_result.scalar_one_or_none()
    
    doc_result = await db.execute(select(Document).where(Document.id == document_id))
    doc = doc_result.scalar_one_or_none()
    
    version_result = await db.execute(select(DocumentVersion).where(DocumentVersion.id == doc.current_version_id))
    version = version_result.scalar_one_or_none()
    
    from app.models.sr import SRDraft
    sr_result = await db.execute(select(SRDraft).where(SRDraft.id == analysis.source_id))
    sr = sr_result.scalar_one_or_none()

    if strategy == "add_section":
        action_prompt = "기존 문서 끝에 새 섹션을 추가하여 SR 내용을 반영하세요. 기존 내용은 그대로 유지합니다."
    elif strategy == "create_new" or strategy == "create_new_doc":
        action_prompt = "SR 내용을 바탕으로 완전히 새로운 문서를 작성하세요. 기존 문서와 별개의 독립 문서입니다."
    elif strategy == "overwrite":
        action_prompt = "기존 문서의 틀을 완전히 새로 작성하여 SR 내용을 반영하세요."
    else:
        action_prompt = "기존 문서 내용을 SR 완료 사항에 맞게 부분 수정하세요. 변경된 부분만 업데이트하고 나머지는 유지합니다."

    prompt = f"""다음 서비스 요청(SR)이 완료되었습니다.
SR 제목: {sr.title if sr else 'N/A'}
SR 설명: {sr.description if sr else 'N/A'}

현재 문서 내용:
{version.content if version else 'N/A'}

작업 지시: {action_prompt}

위 내용을 반영한 전체 문서를 마크다운으로 작성하세요."""

    llm = get_llm_provider()
    proposed_content = await llm.generate("당신은 기술 문서 작가입니다. SR 완료 내용을 반영해 문서를 현행화합니다.", prompt)

    diff = "\n".join(difflib.unified_diff(
        (version.content if version else "").splitlines(),
        proposed_content.splitlines(),
        lineterm="",
        fromfile="original",
        tofile="proposed",
    ))

    proposal = DocumentChangeProposal(
        id=uuid.uuid4(),
        impact_analysis_id=analysis.id,
        document_id=document_id,
        original_content=version.content if version else "",
        proposed_content=proposed_content,
        diff=diff or "(no difference)",
        status="pending",
    )
    db.add(proposal)

    analysis.status = "pending_review"
    if sr:
        sr.status = "done_synced"

    await db.commit()
    await db.refresh(proposal)
    return proposal


async def apply_proposal(db: AsyncSession, proposal_id: uuid.UUID) -> dict:
    from app.services.document_service import create_new_version

    result = await db.execute(select(DocumentChangeProposal).where(DocumentChangeProposal.id == proposal_id))
    proposal = result.scalar_one_or_none()
    if not proposal:
        raise ValueError("Proposal not found")
    if proposal.status != "pending":
        raise ValueError("Proposal already processed")

    await create_new_version(
        db,
        proposal.document_id,
        proposal.proposed_content,
        change_summary="SR 완료 후 자동 생성된 수정안 적용",
    )
    proposal.status = "applied"
    await db.commit()
    return {"status": "applied", "document_id": str(proposal.document_id)}

async def list_analyses(db: AsyncSession) -> list[ChangeImpactAnalysis]:
    result = await db.execute(
        select(ChangeImpactAnalysis).order_by(ChangeImpactAnalysis.created_at.desc())
    )
    return list(result.scalars().all())
