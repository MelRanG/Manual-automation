import uuid
from base64 import b64encode

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jira import JiraConfig
from app.models.sr import SRDraft


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
            "priority": {"name": draft.priority.capitalize()},
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
