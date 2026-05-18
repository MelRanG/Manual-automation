import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.sr import WebhookDeliveryLog
from app.schemas.sr import SRDraftCreate, SRDraftListResponse, SRDraftResponse, SRDraftUpdate, SRGenerateRequest
from app.services import sr_service

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
    from app.models.sr import SRDraft
    sr_result = await db.execute(select(SRDraft).where(SRDraft.id == log.sr_draft_id))
    draft = sr_result.scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="SR draft not found")
    webhook_result = await sr_service.deliver_webhook(db, draft)
    await db.commit()
    return webhook_result
