import logging
import uuid
from base64 import b64encode
from contextlib import asynccontextmanager

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jira import JiraConfig, JiraCallbackLog
from app.models.sr import SRDraft
from app.services.manual_service import capture_screenshots
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

            # Playwright 캡처 (target_url 있을 때만)
            page_context = ""
            if sr.target_url:
                try:
                    from app.models.manual import ManualGenerationJob
                    mock_job = ManualGenerationJob(
                        target_url=sr.target_url,
                        user_id=sr.user_id,
                        login_id=None, login_pw=None,
                        login_url=None, scenario_steps=None,
                    )
                    screenshots = await capture_screenshots(mock_job)
                    page_context = "\n".join(
                        s.get("page_text", "")[:500]
                        for s in screenshots if s.get("page_text")
                    )
                except Exception as e:
                    logger.warning(f"Playwright 캡처 스킵 (sr={sr_id}): {e}")

            # 각 문서마다 수정안 생성
            from app.services.llm_service import get_llm_provider
            from app.models.feedback import ProposedDocumentChange, ApprovalRequest
            from app.models.document import Document, DocumentVersion

            llm = get_llm_provider()
            proposals_created = 0

            for doc_info in related_docs:
                try:
                    doc_id = uuid.UUID(str(doc_info["document_id"]))
                    ver_result = await session.execute(
                        select(DocumentVersion)
                        .join(Document, Document.current_version_id == DocumentVersion.id)
                        .where(Document.id == doc_id)
                    )
                    version = ver_result.scalar_one_or_none()
                    if not version:
                        continue
                    original = version.content

                    prompt = f"""다음 서비스 요청(SR)이 Jira에서 완료되었습니다.
SR 제목: {sr.title}
SR 설명: {sr.description}

현재 문서 내용:
{original[:3000]}
"""
                    if page_context:
                        prompt += f"\n현재 시스템 화면 텍스트:\n{page_context[:1000]}"
                    prompt += "\n\n위 SR 내용을 반영해 문서를 수정한 전체 내용을 작성하세요."

                    proposed_text = await llm.generate(
                        "당신은 기술 문서 작가입니다. SR 완료 내용을 반영해 문서를 현행화합니다.",
                        prompt,
                    )

                    change = ProposedDocumentChange(
                        id=uuid.uuid4(),
                        feedback_report_id=None,
                        document_id=doc_id,
                        document_version_id=version.id,
                        manual_job_id=None,
                        original_text=original,
                        proposed_text=proposed_text,
                        diff="",
                        reasoning=f"Jira SR 완료: {sr.title}",
                        confidence=0.8,
                        source_type="jira_sr",
                        status="pending",
                    )
                    session.add(change)
                    await session.flush()

                    approval = ApprovalRequest(
                        id=uuid.uuid4(),
                        proposed_change_id=change.id,
                        status="pending",
                    )
                    session.add(approval)
                    proposals_created += 1

                except Exception as e:
                    logger.warning(f"문서 {doc_info['document_id']} 수정안 생성 실패: {e}")

            if proposals_created > 0:
                try:
                    from app.routers.notifications import create_notification
                    from app.models.user import User
                    admin_result = await session.execute(
                        select(User).where(User.role == "admin").limit(1)
                    )
                    admin = admin_result.scalar_one_or_none()
                    if admin:
                        await create_notification(
                            session,
                            user_id=admin.id,
                            type="jira_sr_proposals_ready",
                            title=f"SR '{sr.title}' 완료 — 문서 수정안 {proposals_created}건 생성",
                            message="Approvals 페이지에서 검토하세요.",
                            document_id=None,
                        )
                except Exception as e:
                    logger.warning(f"알림 전송 실패 (sr={sr_id}): {e}")

            sr.status = "done_synced" if proposals_created > 0 else "done_no_proposal"
            log.status = "processed"
            await session.commit()

        except Exception as e:
            logger.error(f"process_jira_done 실패 sr={sr_id}: {e}")
            log.status = "failed"
            log.error_message = str(e)[:500]
            await session.commit()
