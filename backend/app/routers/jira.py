import uuid

from fastapi import APIRouter, Depends
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
from app.services import jira_service
from app.services.feedback_service import create_feedback, generate_correction
from app.schemas.feedback import FeedbackReportCreate

router = APIRouter(prefix="/api/jira", tags=["jira"])


@router.get("/config", response_model=JiraConfigResponse | None)
async def get_config(db: AsyncSession = Depends(get_db)):
    config = await jira_service.get_active_config(db)
    if not config:
        return None
    return JiraConfigResponse(
        id=config.id,
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
    config = await jira_service.upsert_config(db, data.model_dump())
    return JiraConfigResponse(
        id=config.id,
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
async def receive_jira_webhook(payload: dict, db: AsyncSession = Depends(get_db)):
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
        select(SRDraft).where(SRDraft.jira_issue_key == issue_key)
    )
    draft = sr_result.scalar_one_or_none()

    if not draft:
        log.status = "skipped"
        await db.commit()
        return {"status": "skipped", "reason": "no SR found for issue key"}

    log.sr_draft_id = draft.id

    # 연결된 문서마다 피드백 생성
    doc_ids = draft.related_document_ids or []
    SYSTEM_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
    for doc_id in doc_ids:
        feedback_data = FeedbackReportCreate(
            user_id=SYSTEM_USER_ID,
            document_id=uuid.UUID(str(doc_id)),
            feedback_text=f"Jira 이슈 {issue_key}가 완료되어 문서 업데이트가 필요합니다.",
        )
        report = await create_feedback(db, feedback_data)
        await generate_correction(db, report.id)

    draft.status = "done_synced"
    log.status = "processed"
    await db.commit()
    return {"status": "processed", "sr_id": str(draft.id), "feedbacks_created": len(doc_ids)}


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
