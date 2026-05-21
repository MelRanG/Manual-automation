import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.sr import SRDraft, WebhookDeliveryLog, ChangeImpactAnalysis
from app.schemas.sr import SRDraftCreate, CompletedSREvent, SRDraftResponse
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
            # jira_issue_url is no longer persisted; SR responses derive it from config.site_url
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
            return {"sr_id": str(sr_id), "status": "jira_created", "webhook": {"status": "skipped", "reason": "jira_created"}, "jira_issue_key": issue["key"]}
        except Exception as e:
            logger.error(f"Jira issue creation failed: {e}")
            # fallback: webhook 시도
            webhook_result = await deliver_webhook(db, draft)
            draft.jira_issue_key = f"LOCAL-{str(uuid.uuid4())[:8].upper()}"
            draft.status = "jira_created"
            await db.commit()
            return {"sr_id": str(sr_id), "status": "jira_created", "webhook": webhook_result, "jira_issue_key": draft.jira_issue_key}
    else:
        webhook_result = await deliver_webhook(db, draft)
        draft.jira_issue_key = f"LOCAL-{str(uuid.uuid4())[:8].upper()}"
        draft.status = "jira_created"
        await db.commit()
        return {"sr_id": str(sr_id), "status": "jira_created", "webhook": webhook_result, "jira_issue_key": draft.jira_issue_key}


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


ALLOWED_STATUS_TRANSITIONS = {
    "draft": {"draft", "submitted"},
    "submitted": {"submitted", "jira_created"},
    "jira_created": {"jira_created", "pending_doc_review"},
    "pending_doc_review": {"pending_doc_review", "done_synced", "done_no_proposal"},
    "pending_document_selection": {"pending_document_selection", "pending_doc_review"},
    "done_synced": {"done_synced"},
    "done_no_proposal": {"done_no_proposal"},
}

EDITABLE_FIELDS_IN_DRAFT = {"title", "description", "priority", "target_url"}


async def update_sr_draft(db: AsyncSession, sr_id: uuid.UUID, data: dict) -> SRDraft:
    result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise ValueError("SR draft not found")

    new_status = data.get("status")
    if new_status is not None:
        allowed = ALLOWED_STATUS_TRANSITIONS.get(draft.status, set())
        if new_status not in allowed:
            raise ValueError(f"Invalid status transition: {draft.status} → {new_status}")

    # status 외 필드는 draft 상태에서만 수정 허용
    non_status_changes = {k: v for k, v in data.items() if k != "status"}
    if non_status_changes:
        if draft.status != "draft":
            raise ValueError("SR is not in draft status")
        for key in non_status_changes:
            if key not in EDITABLE_FIELDS_IN_DRAFT:
                raise ValueError(f"Field {key} is not editable")

    for key, value in data.items():
        setattr(draft, key, value)
    await db.commit()
    await db.refresh(draft)
    return draft


STATUS_MAP = {
    "draft": ["draft"],
    "active": ["submitted", "jira_created", "pending_document_selection"],
    "done": ["done_synced", "done_no_proposal", "pending_doc_review"],
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


async def process_completed_sr(db: AsyncSession, event: CompletedSREvent):
    if not event.external_issue_key:
        logger.warning("CompletedSREvent lacks external_issue_key")
        return

    result = await db.execute(select(SRDraft).where(SRDraft.jira_issue_key == event.external_issue_key))
    draft = result.scalar_one_or_none()

    if not draft:
        logger.warning(f"No SR found for issue {event.external_issue_key}")
        return

    if draft.status in ("done_synced", "done_no_proposal", "pending_document_selection"):
        logger.info(f"SR {draft.id} already processed or processing")
        return

    # description 또는 title에서 URL 추출해 target_url 저장 (없는 경우만)
    if not draft.target_url:
        import re as _re
        url_match = _re.search(r'https?://[^\s,\]）)]+', draft.description or "")
        if not url_match:
            url_match = _re.search(r'https?://[^\s,\]）)]+', draft.title or "")
        if url_match:
            draft.target_url = url_match.group(0).rstrip(".")
            await db.commit()

    llm = get_llm_provider()

    prompt = f"""서비스 요청(SR)이 완료되었습니다.
이 변경사항이 사용자 매뉴얼, 화면, 메뉴, 정책 등 시스템 문서 업데이트를 요구하는지 판단하세요.
- 단순 코드 정리, 내부 인프라, 단순 버그(화면/기능 변화 없음)면 False.
- 새로운 화면, 메뉴, 동작 방식의 변경, 새로운 제약조건 등이면 True.

SR 제목: {draft.title}
SR 설명: {draft.description}
완료 내용: {event.completion_summary or event.description}

결과는 다음 JSON 형식으로 출력하세요.
{{"needs_update": true/false, "reason": "이유 설명"}}
"""
    try:
        decision_text = await llm.generate(
            "당신은 문서화 필요성을 판단하는 분석가입니다. 오직 JSON만 출력하세요.",
            prompt,
        )
        import re
        match = re.search(r'\{.*\}', decision_text, re.DOTALL)
        decision = json.loads(match.group(0)) if match else {"needs_update": True, "reason": "parsing failed"}
    except Exception as e:
        logger.warning(f"AI judgment failed: {e}")
        decision = {"needs_update": True, "reason": "fallback"}

    if not decision.get("needs_update"):
        draft.status = "done_no_proposal"
        await db.commit()
        return

    from app.services.jira_service import _find_related_documents
    query = f"{draft.title} {draft.description} {event.completion_summary or ''}"
    related_docs = await _find_related_documents(db, query)

    if not related_docs:
        draft.status = "done_no_proposal"
        await db.commit()
        return

    analysis = ChangeImpactAnalysis(
        id=uuid.uuid4(),
        source_type="jira_sr",
        source_id=draft.id,
        related_document_ids=[str(d["document_id"]) for d in related_docs],
        recommended_strategy="pending",
        reasoning=decision.get("reason", ""),
        confidence=0.8,
        status="pending_document_selection",
    )
    db.add(analysis)

    draft.status = "pending_document_selection"
    await db.commit()


async def build_sr_response(db: AsyncSession, draft: SRDraft) -> SRDraftResponse:
    """Convert an SRDraft ORM instance to a response with a freshly computed jira_issue_url."""
    from app.services import jira_service
    config = await jira_service.get_active_config(db)
    response = SRDraftResponse.model_validate(draft)
    response.jira_issue_url = jira_service.build_jira_issue_url(draft.jira_issue_key, config)
    return response


async def build_sr_responses(db: AsyncSession, drafts: list[SRDraft]) -> list[SRDraftResponse]:
    """Same as build_sr_response but fetches config once for a batch."""
    from app.services import jira_service
    config = await jira_service.get_active_config(db)
    out: list[SRDraftResponse] = []
    for draft in drafts:
        response = SRDraftResponse.model_validate(draft)
        response.jira_issue_url = jira_service.build_jira_issue_url(draft.jira_issue_key, config)
        out.append(response)
    return out

