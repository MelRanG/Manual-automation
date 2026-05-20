import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.sr import ChangeImpactAnalysis, DocumentChangeProposal, SRDraft, WebhookDeliveryLog
from app.schemas.sr import AiDocRecommendationResponse, ImpactAnalysisSummary, LatestProposalResponse, ProposalSummary, SRDraftCreate, SRDraftListResponse, SRDraftResponse, SRDraftUpdate, SRGenerateRequest
from app.services import ai_recommendation_service, sr_service

router = APIRouter(prefix="/api/sr", tags=["service-requests"])


@router.post("/drafts", response_model=SRDraftResponse, status_code=201)
async def create_sr_draft(
    data: SRDraftCreate,
    db: AsyncSession = Depends(get_db),
):
    return await sr_service.create_sr_draft(db, data)


@router.post("/generate", response_model=SRDraftResponse, status_code=201)
async def generate_sr_draft(
    data: SRGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    return await sr_service.generate_sr_draft(
        db, data.user_id, data.document_id, data.issue_description
    )


@router.post("/drafts/{sr_id}/submit")
async def submit_sr(
    sr_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await sr_service.submit_sr(db, sr_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/drafts/{sr_id}", response_model=SRDraftResponse)
async def update_sr_draft(
    sr_id: uuid.UUID,
    data: SRDraftUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await sr_service.update_sr_draft(db, sr_id, data.model_dump(exclude_none=True))
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.get("/drafts", response_model=SRDraftListResponse)
async def list_sr_drafts(
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    try:
        items, total = await sr_service.list_sr_drafts(db, user_id, status, skip, limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"items": items, "total": total}


@router.get("/webhook-logs")
async def list_webhook_logs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WebhookDeliveryLog).order_by(WebhookDeliveryLog.created_at.desc()).limit(50)
    )
    logs = result.scalars().all()
    return [
        {
            "id": str(log.id),
            "sr_draft_id": str(log.sr_draft_id),
            "target_url": log.target_url,
            "payload_summary": log.payload.get("fields", {}).get("summary", "") if isinstance(log.payload, dict) else "",
            "response_status": log.response_status,
            "status": log.status,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]


@router.post("/webhook-logs/{log_id}/retry")
async def retry_webhook(log_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WebhookDeliveryLog).where(WebhookDeliveryLog.id == log_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    sr_result = await db.execute(select(SRDraft).where(SRDraft.id == log.sr_draft_id))
    draft = sr_result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="SR draft not found")
    webhook_result = await sr_service.deliver_webhook(db, draft)
    await db.commit()
    return webhook_result


@router.post("/drafts/{sr_id}/complete-local")
async def complete_sr_local(sr_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    from app.models.feedback import ApprovalRequest as ApprovalRequestModel

    result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="SR draft not found")

    if draft.status not in ("submitted", "jira_created", "draft"):
        raise HTTPException(status_code=400, detail="Cannot complete SR in current status")

    if not draft.jira_issue_key:
        draft.jira_issue_key = f"LOCAL-{str(uuid.uuid4())[:8].upper()}"

    approval = ApprovalRequestModel(
        id=uuid.uuid4(),
        approval_type="doc_review",
        sr_draft_id=draft.id,
        status="pending",
    )
    db.add(approval)
    draft.status = "pending_doc_review"
    await db.commit()
    return {"status": "pending_doc_review", "sr_id": str(draft.id), "approval_id": str(approval.id)}


@router.get(
    "/drafts/{sr_id}/ai-doc-recommendation",
    response_model=AiDocRecommendationResponse | None,
)
async def get_ai_doc_recommendation(sr_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="SR draft not found")
    return draft.ai_doc_recommendation


@router.post(
    "/drafts/{sr_id}/ai-doc-recommendation",
    response_model=AiDocRecommendationResponse,
)
async def create_ai_doc_recommendation(
    sr_id: uuid.UUID,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SRDraft).where(SRDraft.id == sr_id).with_for_update()
    )
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="SR draft not found")

    if draft.ai_doc_recommendation and not force:
        return draft.ai_doc_recommendation

    try:
        payload = await ai_recommendation_service.recommend_doc_strategy(db, draft)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 추천 생성 실패: {e}")
    return payload


@router.get(
    "/drafts/{sr_id}/latest-proposal",
    response_model=LatestProposalResponse | None,
)
async def get_latest_proposal(sr_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="SR draft not found")

    analysis_result = await db.execute(
        select(ChangeImpactAnalysis)
        .where(
            ChangeImpactAnalysis.source_type == "jira_sr",
            ChangeImpactAnalysis.source_id == sr_id,
        )
        .order_by(ChangeImpactAnalysis.created_at.desc())
        .limit(1)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis:
        return None

    proposal_result = await db.execute(
        select(DocumentChangeProposal)
        .where(DocumentChangeProposal.impact_analysis_id == analysis.id)
        .order_by(DocumentChangeProposal.created_at.desc())
        .limit(1)
    )
    proposal = proposal_result.scalar_one_or_none()

    doc_mode_hint = "existing" if proposal and proposal.document_id else "new"

    return LatestProposalResponse(
        impact_analysis=ImpactAnalysisSummary.model_validate(analysis),
        proposal=ProposalSummary.model_validate(proposal) if proposal else None,
        doc_mode_hint=doc_mode_hint,
    )
