import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.jira import JiraCallbackLog, JiraConfig
from app.models.sr import SRDraft
from app.schemas.jira import (
    JiraCallbackLogResponse,
    JiraConfigResponse,
    JiraConfigUpsert,
    JiraConnectionTestResult,
)
from app.models.feedback import ApprovalRequest as ApprovalRequestModel
from app.services import jira_service

router = APIRouter(prefix="/api/jira", tags=["jira"])


@router.get("/config", response_model=JiraConfigResponse | None)
async def get_config(db: AsyncSession = Depends(get_db)):
    config = await jira_service.get_active_config(db)
    if not config:
        return None
    return JiraConfigResponse(
        id=config.id,
        site_url=config.site_url,
        base_url=config.base_url,
        user_email=config.user_email,
        api_token_masked=jira_service.mask_token(config.api_token),
        project_key=config.project_key,
        is_active=config.is_active,
        trigger_status_names=config.trigger_status_names,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


@router.put("/config", response_model=JiraConfigResponse)
async def save_config(data: JiraConfigUpsert, db: AsyncSession = Depends(get_db)):
    site_url = jira_service.normalize_site_url(data.site_url)
    try:
        cloud_id = await jira_service.resolve_cloud_id(site_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    derived_base_url = jira_service.derive_base_url(cloud_id)

    payload = data.model_dump()
    payload["site_url"] = site_url
    payload["base_url"] = derived_base_url
    config = await jira_service.upsert_config(db, payload)

    return JiraConfigResponse(
        id=config.id,
        site_url=config.site_url,
        base_url=config.base_url,
        user_email=config.user_email,
        api_token_masked=jira_service.mask_token(config.api_token),
        project_key=config.project_key,
        is_active=config.is_active,
        trigger_status_names=config.trigger_status_names,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


@router.post("/config/test", response_model=JiraConnectionTestResult)
async def test_config(data: JiraConfigUpsert, db: AsyncSession = Depends(get_db)):
    api_token = data.api_token
    if not api_token:
        existing = await jira_service.get_active_config(db)
        if existing:
            api_token = existing.api_token
    temp = JiraConfig(
        base_url=data.base_url,
        user_email=data.user_email,
        api_token=api_token,
        project_key=data.project_key,
    )
    result = await jira_service.test_connection(temp)
    return JiraConnectionTestResult(**result)


@router.post("/webhook")
async def receive_jira_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    issue_key = payload.get("issue", {}).get("key", "unknown")
    event_type = payload.get("webhookEvent", "unknown")

    log = JiraCallbackLog(
        id=uuid.uuid4(),
        jira_issue_key=issue_key,
        event_type=event_type,
        payload=payload,
        status="pending",
    )
    db.add(log)

    config = await jira_service.get_active_config(db)

    if not config or not jira_service.is_done_transition(config, payload):
        log.status = "skipped"
        await db.commit()
        return {"status": "skipped"}

    sr_result = await db.execute(
        select(SRDraft)
        .where(SRDraft.jira_issue_key == issue_key)
        .order_by(SRDraft.created_at.desc())
        .limit(1)
    )
    draft = sr_result.scalar_one_or_none()

    if not draft:
        log.status = "skipped"
        await db.commit()
        return {"status": "skipped", "reason": "no SR found for issue key"}

    if draft.status in ("done_synced", "done_no_proposal", "pending_doc_review", "pending_document_selection"):
        log.status = "skipped"
        await db.commit()
        return {"status": "skipped", "reason": "SR already processed"}

    log.sr_draft_id = draft.id
    log.status = "processed"
    await db.commit()

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


@router.get("/callback-logs", response_model=list[JiraCallbackLogResponse])
async def list_callback_logs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(JiraCallbackLog).order_by(JiraCallbackLog.created_at.desc()).limit(50)
    )
    logs = result.scalars().all()

    sr_ids = [log.sr_draft_id for log in logs if log.sr_draft_id]
    sr_titles: dict = {}
    if sr_ids:
        sr_result = await db.execute(
            select(SRDraft.id, SRDraft.title).where(SRDraft.id.in_(sr_ids))
        )
        sr_titles = {row.id: row.title for row in sr_result}

    items = []
    for log in logs:
        payload = log.payload or {}
        issue_fields = payload.get("issue", {}).get("fields", {})
        status_obj = issue_fields.get("status", {})
        items.append(JiraCallbackLogResponse(
            id=log.id,
            jira_issue_key=log.jira_issue_key,
            event_type=log.event_type,
            sr_draft_id=log.sr_draft_id,
            sr_title=sr_titles.get(log.sr_draft_id) if log.sr_draft_id else None,
            jira_issue_summary=issue_fields.get("summary"),
            jira_issue_status=status_obj.get("name"),
            jira_issue_status_category=status_obj.get("statusCategory", {}).get("key"),
            status=log.status,
            created_at=log.created_at,
        ))
    return items
