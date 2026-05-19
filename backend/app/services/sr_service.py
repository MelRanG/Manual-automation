import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.sr import SRDraft, WebhookDeliveryLog
from app.schemas.sr import SRDraftCreate
from app.services.llm_service import get_llm_provider

logger = logging.getLogger(__name__)

SR_GENERATION_PROMPT = """You are a service request generator for documentation issues.
Given a document context and issue description, generate a clear, actionable service request.
Format your response as:
Title: [concise title]
Priority: [low/medium/high/critical]
Description: [detailed description of what needs to be done]"""


async def create_sr_draft(db: AsyncSession, data: SRDraftCreate) -> SRDraft:
    draft = SRDraft(
        id=uuid.uuid4(),
        user_id=data.user_id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        related_document_ids=[str(d) for d in data.related_document_ids] if data.related_document_ids else None,
        status="draft",
        created_by_ai=False,
        target_url=data.target_url,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


async def generate_sr_draft(
    db: AsyncSession,
    user_id: uuid.UUID,
    document_id: uuid.UUID,
    issue_description: str,
) -> SRDraft:
    llm = get_llm_provider()
    result = await llm.generate(
        SR_GENERATION_PROMPT,
        f"Issue: {issue_description}\nDocument ID: {document_id}",
    )

    title = f"SR: {issue_description[:80]}"
    priority = "medium"
    description = result

    for line in result.split("\n"):
        if line.startswith("Title:"):
            title = line[6:].strip()
        elif line.startswith("Priority:"):
            p = line[9:].strip().lower()
            if p in ("low", "medium", "high", "critical"):
                priority = p
        elif line.startswith("Description:"):
            description = line[12:].strip()

    draft = SRDraft(
        id=uuid.uuid4(),
        user_id=user_id,
        title=title,
        description=description,
        priority=priority,
        related_document_ids=[str(document_id)],
        status="draft",
        created_by_ai=True,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


async def submit_sr(db: AsyncSession, sr_id: uuid.UUID) -> dict:
    result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise ValueError("SR draft not found")

    draft.status = "submitted"

    from app.services import jira_service
    config = await jira_service.get_active_config(db)

    if config:
        try:
            issue = await jira_service.create_jira_issue(config, draft)
            draft.jira_issue_key = issue["key"]
            draft.jira_issue_url = issue["url"]
            draft.status = "jira_created"
            log = WebhookDeliveryLog(
                id=uuid.uuid4(),
                sr_draft_id=draft.id,
                target_url=f"{config.base_url.rstrip('/')}/rest/api/3/issue",
                payload={"summary": draft.title, "project": config.project_key},
                response_status=201,
                response_body=f"Jira issue created: {issue['key']}",
                status="delivered",
            )
            db.add(log)
            await db.commit()
            return {"sr_id": str(sr_id), "status": "jira_created", "jira_issue_key": issue["key"]}
        except Exception as e:
            logger.error(f"Jira issue creation failed: {e}")
            # fallback: webhook 시도
            webhook_result = await deliver_webhook(db, draft)
            await db.commit()
            return {"sr_id": str(sr_id), "status": "submitted", "webhook": webhook_result}
    else:
        webhook_result = await deliver_webhook(db, draft)
        await db.commit()
        return {"sr_id": str(sr_id), "status": "submitted", "webhook": webhook_result}


async def deliver_webhook(db: AsyncSession, draft: SRDraft) -> dict:
    target_url = settings.jira_webhook_url
    payload = {
        "fields": {
            "project": {"key": "DOCOPS"},
            "summary": draft.title,
            "description": draft.description,
            "priority": {"name": draft.priority.capitalize()},
            "issuetype": {"name": "Task"},
            "labels": ["docops-ai", "auto-generated"],
        }
    }

    if not target_url:
        logger.info(f"Webhook not configured. SR {draft.id} logged internally.")
        log = WebhookDeliveryLog(
            id=uuid.uuid4(),
            sr_draft_id=draft.id,
            target_url="(not configured)",
            payload=payload,
            response_status=None,
            response_body="Webhook URL not configured - logged internally",
            status="skipped",
        )
        db.add(log)
        return {"status": "skipped", "reason": "JIRA_WEBHOOK_URL not configured"}

    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(target_url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                body = await resp.text()
                log = WebhookDeliveryLog(
                    id=uuid.uuid4(),
                    sr_draft_id=draft.id,
                    target_url=target_url,
                    payload=payload,
                    response_status=resp.status,
                    response_body=body[:1000],
                    status="delivered" if resp.status < 400 else "failed",
                )
                db.add(log)
                return {"status": "delivered", "response_status": resp.status}
    except Exception as e:
        log = WebhookDeliveryLog(
            id=uuid.uuid4(),
            sr_draft_id=draft.id,
            target_url=target_url,
            payload=payload,
            response_status=None,
            response_body=str(e)[:1000],
            status="error",
        )
        db.add(log)
        return {"status": "error", "error": str(e)}


async def update_sr_draft(db: AsyncSession, sr_id: uuid.UUID, data: dict) -> SRDraft:
    result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise ValueError("SR draft not found")
    if draft.status != "draft":
        raise ValueError("SR is not in draft status")
    for key, value in data.items():
        setattr(draft, key, value)
    await db.commit()
    await db.refresh(draft)
    return draft


STATUS_MAP = {
    "draft": ["draft"],
    "active": ["submitted", "jira_created"],
    "done": ["done_synced", "done_no_proposal"],
}


async def list_sr_drafts(
    db: AsyncSession,
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 20,
) -> tuple[list[SRDraft], int]:
    from sqlalchemy import func
    stmt = select(SRDraft)
    if user_id:
        stmt = stmt.where(SRDraft.user_id == user_id)
    if status is not None:
        statuses = STATUS_MAP.get(status)
        if statuses is None:
            raise ValueError(f"Invalid status filter: {status}")
        stmt = stmt.where(SRDraft.status.in_(statuses))
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()
    stmt = stmt.order_by(SRDraft.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all()), total
