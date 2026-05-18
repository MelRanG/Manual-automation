import logging
import uuid
from base64 import b64encode
from contextlib import asynccontextmanager

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jira import JiraConfig, JiraCallbackLog
from app.models.sr import SRDraft
from app.services.search_service import search_similar_chunks

logger = logging.getLogger(__name__)

DISTANCE_THRESHOLD = 0.6


def mask_token(token: str) -> str:
    if len(token) <= 4:
        return "****"
    return "****" + token[-4:]


def is_done_transition(config: JiraConfig, payload: dict) -> bool:
    status = payload.get("issue", {}).get("fields", {}).get("status", {})
    status_name = status.get("name", "")
    category_key = status.get("statusCategory", {}).get("key", "")

    if config.trigger_status_names:
        return status_name in config.trigger_status_names
    return category_key == "done"


def _auth_header(config: JiraConfig) -> str:
    credentials = f"{config.user_email}:{config.api_token}"
    return "Basic " + b64encode(credentials.encode()).decode()


async def get_active_config(db: AsyncSession) -> JiraConfig | None:
    result = await db.execute(
        select(JiraConfig).where(JiraConfig.is_active).limit(1)
    )
    return result.scalar_one_or_none()


async def upsert_config(db: AsyncSession, data: dict) -> JiraConfig:
    existing = await db.execute(select(JiraConfig).order_by(JiraConfig.created_at).limit(1))
    config = existing.scalar_one_or_none()
    if config is None:
        config = JiraConfig(id=uuid.uuid4())
        db.add(config)
    for key, value in data.items():
        if key == "api_token" and not value:
            continue  # 빈 토큰은 기존 값 유지
        setattr(config, key, value)
    await db.commit()
    await db.refresh(config)
    return config


async def create_jira_issue(config: JiraConfig, draft: SRDraft) -> dict:
    url = f"{config.base_url.rstrip('/')}/rest/api/3/issue"
    headers = {
        "Authorization": _auth_header(config),
        "Content-Type": "application/json",
    }
    payload = {
        "fields": {
            "project": {"key": config.project_key},
            "summary": draft.title,
            "description": {
                "type": "doc",
                "version": 1,
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": draft.description}]}],
            },
            "priority": {"name": {"critical": "Highest", "high": "High", "medium": "Medium", "low": "Low", "lowest": "Lowest"}.get(draft.priority, "Medium")},
            "issuetype": {"name": "Task"},
            "labels": ["docops-ai", "auto-generated"],
        }
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            body = await resp.json()
            if resp.status not in (200, 201):
                raise RuntimeError(f"Jira API error {resp.status}: {body}")
            issue_key = body["key"]
            issue_url = f"{config.base_url.rstrip('/')}/browse/{issue_key}"
            return {"key": issue_key, "url": issue_url}


async def test_connection(config: JiraConfig) -> dict:
    url = f"{config.base_url.rstrip('/')}/rest/api/3/myself"
    headers = {"Authorization": _auth_header(config)}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {"success": True, "message": f"연결됨: {data.get('displayName', config.user_email)}"}
                return {"success": False, "message": f"인증 실패 (HTTP {resp.status})"}
    except Exception as e:
        return {"success": False, "message": str(e)}


async def _find_related_documents(db: AsyncSession, query: str) -> list[dict]:
    """벡터 검색으로 관련 문서 탐색. 실패 시 제목 키워드 매칭으로 폴백."""
    from app.models.document import Document
    from sqlalchemy import or_

    try:
        chunks = await search_similar_chunks(db, query, top_k=10)
        seen: set[str] = set()
        docs = []
        for c in chunks:
            if c["distance"] is not None and c["distance"] > DISTANCE_THRESHOLD:
                continue
            doc_id = str(c["document_id"])
            if doc_id not in seen:
                seen.add(doc_id)
                docs.append(c)
                if len(docs) >= 3:
                    break
        if docs:
            return docs
    except Exception as e:
        logger.warning(f"벡터 검색 실패, 키워드 폴백: {e}")

    keywords = query.split()[:5]
    if not keywords:
        return []
    conditions = [Document.title.ilike(f"%{kw}%") for kw in keywords]
    result = await db.execute(
        select(Document)
        .where(Document.status == "active")
        .where(or_(*conditions))
        .limit(3)
    )
    fallback_docs = result.scalars().all()
    return [
        {"document_id": d.id, "document_title": d.title, "content": "", "distance": None}
        for d in fallback_docs
    ]


async def process_jira_done(
    sr_id: uuid.UUID,
    log_id: uuid.UUID,
    db: AsyncSession | None = None,
) -> None:
    from app.db import SessionLocal

    @asynccontextmanager
    async def _get_db():
        if db is not None:
            yield db
        else:
            async with SessionLocal() as session:
                yield session

    async with _get_db() as session:
        sr_result = await session.execute(select(SRDraft).where(SRDraft.id == sr_id))
        sr = sr_result.scalar_one_or_none()
        log_result = await session.execute(select(JiraCallbackLog).where(JiraCallbackLog.id == log_id))
        log = log_result.scalar_one_or_none()
        if not sr or not log:
            return

        try:
            query = f"{sr.title} {sr.description}"
            related_docs = await _find_related_documents(session, query)

            if not related_docs:
                log.status = "skipped_no_docs"
                await session.commit()
                return

            sr.related_document_ids = [str(d["document_id"]) for d in related_docs]
            await session.flush()

            # 이후 단계 (Task 4에서 구현)
            log.status = "processed"
            await session.commit()

        except Exception as e:
            logger.error(f"process_jira_done 실패 sr={sr_id}: {e}")
            log.status = "failed"
            log.error_message = str(e)[:500]
            await session.commit()
