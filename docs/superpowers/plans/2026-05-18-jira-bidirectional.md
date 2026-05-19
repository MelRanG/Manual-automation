# Jira 양방향 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SR 제출 시 Jira REST API로 이슈를 생성하고 이슈 키를 저장하며, Jira에서 이슈가 Done 상태로 전환되면 연결된 문서에 피드백 워크플로우를 자동 트리거한다.

**Architecture:** Jira REST API(Basic Auth)로 이슈 생성 후 SR에 이슈 키를 저장한다. Jira 웹훅 콜백을 `POST /api/jira/webhook`에서 수신하여 `statusCategory.key == "done"` (또는 관리자 지정 상태명) 판정 후 `feedback_service.create_feedback()`을 호출한다. Jira 연동 설정은 `jira_configs` DB 테이블에 저장하며 `/webhook-logs` 관리 화면에서 편집한다.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, aiohttp, React + TypeScript, Tailwind CSS

---

## 파일 맵

### 생성
- `backend/app/models/jira.py` — JiraConfig, JiraCallbackLog ORM 모델
- `backend/app/schemas/jira.py` — Pydantic 요청/응답 스키마
- `backend/app/services/jira_service.py` — Jira REST API 호출, 설정 조회
- `backend/app/routers/jira.py` — `/api/jira/*` 엔드포인트
- `backend/tests/test_jira.py` — Jira 라우터/서비스 테스트

### 수정
- `backend/app/models/sr.py` — SRDraft에 `jira_issue_key`, `jira_issue_url` 추가
- `backend/app/schemas/sr.py` — SRDraftResponse에 신규 필드 추가
- `backend/app/services/sr_service.py` — `submit_sr()` Jira API 연동
- `backend/app/main.py` — jira 라우터 등록
- `frontend/src/lib/api.ts` — Jira 설정/로그 API 함수 및 타입 추가
- `frontend/src/pages/WebhookLogs.tsx` — 설정 카드 + 탭 UI 추가
- `frontend/src/pages/ServiceRequests.tsx` — SR 카드에 Jira 이슈 키 배지 추가

### 마이그레이션 생성
- `backend/alembic/versions/<hash>_add_jira_tables.py`

---

## Task 1: DB 모델 — JiraConfig, JiraCallbackLog, SRDraft 컬럼 추가

**Files:**
- Create: `backend/app/models/jira.py`
- Modify: `backend/app/models/sr.py`

- [ ] **Step 1: `backend/app/models/jira.py` 생성**

```python
from sqlalchemy import Boolean, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class JiraConfig(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "jira_configs"

    base_url: Mapped[str] = mapped_column(String(500))
    user_email: Mapped[str] = mapped_column(String(255))
    api_token: Mapped[str] = mapped_column(Text)
    project_key: Mapped[str] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    trigger_status_names: Mapped[list | None] = mapped_column(JSONB, nullable=True)


class JiraCallbackLog(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "jira_callback_logs"

    jira_issue_key: Mapped[str] = mapped_column(String(50))
    event_type: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict] = mapped_column(JSONB)
    sr_draft_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
```

- [ ] **Step 2: `backend/app/models/sr.py`의 SRDraft에 필드 추가**

`SRDraft` 클래스의 `created_by_ai` 줄 아래에 추가:

```python
    jira_issue_key: Mapped[str | None] = mapped_column(String(50), nullable=True)
    jira_issue_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
```

- [ ] **Step 3: Alembic 마이그레이션 생성**

```bash
cd backend
uv run alembic revision --autogenerate -m "add jira tables and sr jira fields"
```

생성된 파일 확인 후 `upgrade()` 함수에 아래 내용이 포함되어 있는지 확인:
- `jira_configs` 테이블 생성
- `jira_callback_logs` 테이블 생성
- `sr_drafts`에 `jira_issue_key`, `jira_issue_url` 컬럼 추가

- [ ] **Step 4: 마이그레이션 적용**

```bash
cd backend
uv run alembic upgrade head
```

Expected: `Running upgrade ... -> <hash>, add jira tables and sr jira fields`

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/jira.py backend/app/models/sr.py backend/alembic/versions/
git commit -m "feat: JiraConfig, JiraCallbackLog 모델 및 SRDraft jira 필드 추가"
```

---

## Task 2: Pydantic 스키마

**Files:**
- Create: `backend/app/schemas/jira.py`
- Modify: `backend/app/schemas/sr.py`

- [ ] **Step 1: `backend/app/schemas/jira.py` 생성**

```python
import uuid
from datetime import datetime

from pydantic import BaseModel


class JiraConfigUpsert(BaseModel):
    base_url: str
    user_email: str
    api_token: str
    project_key: str
    is_active: bool = True
    trigger_status_names: list[str] | None = None


class JiraConfigResponse(BaseModel):
    id: uuid.UUID
    base_url: str
    user_email: str
    api_token_masked: str  # "****" + 마지막 4자
    project_key: str
    is_active: bool
    trigger_status_names: list[str] | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class JiraCallbackLogResponse(BaseModel):
    id: uuid.UUID
    jira_issue_key: str
    event_type: str
    sr_draft_id: str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class JiraConnectionTestResult(BaseModel):
    success: bool
    message: str
```

- [ ] **Step 2: `backend/app/schemas/sr.py`의 SRDraftResponse에 필드 추가**

`SRDraftResponse` 클래스의 `created_by_ai` 줄 아래에 추가:

```python
    jira_issue_key: str | None = None
    jira_issue_url: str | None = None
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/jira.py backend/app/schemas/sr.py
git commit -m "feat: Jira 스키마 및 SRDraftResponse jira 필드 추가"
```

---

## Task 3: jira_service.py — 설정 조회, 이슈 생성, 연결 테스트

**Files:**
- Create: `backend/app/services/jira_service.py`

- [ ] **Step 1: 테스트 파일 먼저 작성 (`backend/tests/test_jira.py`)**

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.services import jira_service
from app.models.jira import JiraConfig


def make_config():
    cfg = JiraConfig()
    cfg.base_url = "https://test.atlassian.net"
    cfg.user_email = "test@example.com"
    cfg.api_token = "token123"
    cfg.project_key = "TEST"
    cfg.is_active = True
    cfg.trigger_status_names = None
    return cfg


@pytest.mark.asyncio
async def test_is_done_status_category():
    cfg = make_config()
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "완료됨",
                    "statusCategory": {"key": "done"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is True


@pytest.mark.asyncio
async def test_is_done_custom_status_names_match():
    cfg = make_config()
    cfg.trigger_status_names = ["배포됨", "Done"]
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "배포됨",
                    "statusCategory": {"key": "indeterminate"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is True


@pytest.mark.asyncio
async def test_is_done_custom_status_names_no_match():
    cfg = make_config()
    cfg.trigger_status_names = ["Done"]
    payload = {
        "issue": {
            "fields": {
                "status": {
                    "name": "In Progress",
                    "statusCategory": {"key": "indeterminate"},
                }
            }
        }
    }
    assert jira_service.is_done_transition(cfg, payload) is False


@pytest.mark.asyncio
async def test_mask_token():
    assert jira_service.mask_token("abcdefgh") == "****efgh"
    assert jira_service.mask_token("ab") == "****"
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend
uv run pytest tests/test_jira.py -v
```

Expected: FAIL with `ModuleNotFoundError` 또는 `ImportError`

- [ ] **Step 3: `backend/app/services/jira_service.py` 구현**

```python
import uuid
from base64 import b64encode

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.jira import JiraConfig, JiraCallbackLog
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
        select(JiraConfig).where(JiraConfig.is_active == True).limit(1)
    )
    return result.scalar_one_or_none()


async def upsert_config(db: AsyncSession, data: dict) -> JiraConfig:
    existing = await db.execute(select(JiraConfig).limit(1))
    config = existing.scalar_one_or_none()
    if config is None:
        config = JiraConfig(id=uuid.uuid4())
        db.add(config)
    for key, value in data.items():
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
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd backend
uv run pytest tests/test_jira.py -v
```

Expected: 4개 테스트 모두 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/jira_service.py backend/tests/test_jira.py
git commit -m "feat: jira_service — 설정 조회, 이슈 생성, Done 판정, 연결 테스트"
```

---

## Task 4: sr_service.py — submit_sr Jira API 연동

**Files:**
- Modify: `backend/app/services/sr_service.py`

- [ ] **Step 1: `submit_sr()` 수정**

`backend/app/services/sr_service.py`의 `submit_sr()` 함수를 아래로 교체:

```python
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
```

- [ ] **Step 2: 기존 SR 제출 테스트 실행**

```bash
cd backend
uv run pytest tests/test_sr.py -v
```

Expected: 기존 테스트 모두 PASS (Jira 설정 없으므로 webhook fallback 경로)

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/sr_service.py
git commit -m "feat: SR 제출 시 Jira API로 이슈 생성, fallback 유지"
```

---

## Task 5: routers/jira.py — 설정, 테스트, 웹훅, 로그 엔드포인트

**Files:**
- Create: `backend/app/routers/jira.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: `backend/app/routers/jira.py` 생성**

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.jira import JiraCallbackLog
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
        updated_at=config.updated_at,
    )


@router.post("/config/test", response_model=JiraConnectionTestResult)
async def test_config(data: JiraConfigUpsert, db: AsyncSession = Depends(get_db)):
    from app.models.jira import JiraConfig
    temp = JiraConfig(
        base_url=data.base_url,
        user_email=data.user_email,
        api_token=data.api_token,
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

    log.sr_draft_id = str(draft.id)

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
    return list(result.scalars().all())
```

- [ ] **Step 2: `backend/app/main.py`에 jira 라우터 등록**

`from app.routers import ...` 줄을 수정하여 `jira` 추가:

```python
from app.routers import auth, documents, users, chat, feedback, approvals, trust, sr, change_impact, manual, widget, notifications, jira
```

그리고 `app.include_router(sr.router)` 아래에 추가:

```python
app.include_router(jira.router)
```

- [ ] **Step 3: 웹훅 엔드포인트 테스트 작성 후 실행**

`backend/tests/test_jira.py`에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_webhook_skipped_no_config(client):
    payload = {
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "key": "TEST-999",
            "fields": {
                "status": {
                    "name": "Done",
                    "statusCategory": {"key": "done"},
                }
            },
        },
    }
    resp = await client.post("/api/jira/webhook", json=payload)
    assert resp.status_code == 200
    assert resp.json()["status"] == "skipped"
```

```bash
cd backend
uv run pytest tests/test_jira.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/jira.py backend/app/main.py backend/tests/test_jira.py
git commit -m "feat: /api/jira/* 엔드포인트 — 설정 CRUD, 연결 테스트, 웹훅 수신, 콜백 로그"
```

---

## Task 6: 프론트엔드 — api.ts 타입 및 함수 추가

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: api.ts 타입 추가**

파일 맨 아래 타입 목록에 추가:

```typescript
export interface JiraConfig {
  id: string
  base_url: string
  user_email: string
  api_token_masked: string
  project_key: string
  is_active: boolean
  trigger_status_names: string[] | null
  updated_at: string
}

export interface JiraCallbackLog {
  id: string
  jira_issue_key: string
  event_type: string
  sr_draft_id: string | null
  status: string
  created_at: string
}
```

`SRDraft` 인터페이스에 필드 추가:

```typescript
export interface SRDraft { id: string; user_id: string; title: string; description: string; priority: string; status: string; created_by_ai: boolean; jira_issue_key: string | null; jira_issue_url: string | null; created_at: string }
```

- [ ] **Step 2: api.ts에 Jira API 함수 추가**

`api` 객체의 `// Notifications` 섹션 위에 추가:

```typescript
  // Jira
  getJiraConfig: () => request<JiraConfig | null>('/jira/config'),
  saveJiraConfig: (data: { base_url: string; user_email: string; api_token: string; project_key: string; is_active: boolean; trigger_status_names: string[] | null }) =>
    request<JiraConfig>('/jira/config', { method: 'PUT', body: JSON.stringify(data) }),
  testJiraConfig: (data: { base_url: string; user_email: string; api_token: string; project_key: string; is_active: boolean; trigger_status_names: string[] | null }) =>
    request<{ success: boolean; message: string }>('/jira/config/test', { method: 'POST', body: JSON.stringify(data) }),
  listJiraCallbackLogs: () => request<JiraCallbackLog[]>('/jira/callback-logs'),
```

- [ ] **Step 3: 타입 체크**

```bash
cd frontend
pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: api.ts — Jira 설정/로그 API 함수 및 타입 추가"
```

---

## Task 7: 프론트엔드 — WebhookLogs.tsx 재구성

**Files:**
- Modify: `frontend/src/pages/WebhookLogs.tsx`

- [ ] **Step 1: WebhookLogs.tsx 전체 교체**

```tsx
import { useState, useEffect } from "react"
import { api, JiraConfig, JiraCallbackLog } from "@/lib/api"

interface WebhookLog {
  id: string
  sr_draft_id: string
  target_url: string
  payload_summary: string
  response_status: number | null
  status: string
  created_at: string
}

export function WebhookLogs() {
  const [tab, setTab] = useState<"inbound" | "outbound">("inbound")

  // 설정
  const [config, setConfig] = useState<JiraConfig | null>(null)
  const [form, setForm] = useState({ base_url: "", user_email: "", api_token: "", project_key: "", trigger_status_names: "", is_active: true })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // 로그
  const [callbackLogs, setCallbackLogs] = useState<JiraCallbackLog[]>([])
  const [outboundLogs, setOutboundLogs] = useState<WebhookLog[]>([])
  const [retrying, setRetrying] = useState<string | null>(null)

  useEffect(() => {
    api.getJiraConfig().then(cfg => {
      if (cfg) {
        setConfig(cfg)
        setForm({
          base_url: cfg.base_url,
          user_email: cfg.user_email,
          api_token: "",
          project_key: cfg.project_key,
          trigger_status_names: (cfg.trigger_status_names ?? []).join(", "),
          is_active: cfg.is_active,
        })
      }
    }).catch(() => {})
    fetchLogs()
  }, [])

  const fetchLogs = () => {
    api.listJiraCallbackLogs().then(setCallbackLogs).catch(() => {})
    fetch('/api/sr/webhook-logs').then(r => r.json()).then(setOutboundLogs).catch(() => {})
  }

  const parseStatusNames = (): string[] | null => {
    const trimmed = form.trigger_status_names.trim()
    if (!trimmed) return null
    return trimmed.split(",").map(s => s.trim()).filter(Boolean)
  }

  const handleSave = async () => {
    setSaving(true)
    setTestResult(null)
    try {
      const cfg = await api.saveJiraConfig({
        base_url: form.base_url,
        user_email: form.user_email,
        api_token: form.api_token || config?.api_token_masked || "",
        project_key: form.project_key,
        is_active: form.is_active,
        trigger_status_names: parseStatusNames(),
      })
      setConfig(cfg)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testJiraConfig({
        base_url: form.base_url,
        user_email: form.user_email,
        api_token: form.api_token || config?.api_token_masked || "",
        project_key: form.project_key,
        is_active: form.is_active,
        trigger_status_names: parseStatusNames(),
      })
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  const handleRetry = async (logId: string) => {
    setRetrying(logId)
    try {
      await fetch(`/api/sr/webhook-logs/${logId}/retry`, { method: 'POST' })
      fetchLogs()
    } finally {
      setRetrying(null)
    }
  }

  const getCallbackStatusStyle = (status: string) => {
    if (status === "processed") return "bg-[#d5e3fc] text-[#16a34a]"
    if (status === "skipped") return "bg-[#e6e8ea] text-[#444653]"
    return "bg-[#ffdad6] text-[#93000a]"
  }

  const getOutboundStatusStyle = (status: string) => {
    if (status === "delivered") return "bg-[#d5e3fc] text-[#16a34a]"
    if (status === "skipped") return "bg-[#e6e8ea] text-[#444653]"
    return "bg-[#ffdad6] text-[#93000a]"
  }

  const connectionStatus = config
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#d5e3fc] text-[#16a34a]"><span className="w-1.5 h-1.5 rounded-full bg-current" />연결됨</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#e6e8ea] text-[#444653]"><span className="w-1.5 h-1.5 rounded-full bg-current" />미설정</span>

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">Jira 연동 관리</h2>
          <p className="text-sm text-[#444653] mt-1">Jira 연동 설정 및 웹훅 이력을 관리합니다.</p>
        </div>
        <button onClick={fetchLogs} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
          <span className="material-symbols-outlined text-base">refresh</span>
          새로고침
        </button>
      </div>

      {/* 설정 카드 */}
      <div className="bg-white border border-[#c4c5d5] rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#191c1e]">Jira 연동 설정</h3>
          {connectionStatus}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-xs font-medium text-[#444653] mb-1 block">Base URL</label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="https://yourcompany.atlassian.net"
              value={form.base_url}
              onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">이메일</label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="admin@yourcompany.com"
              value={form.user_email}
              onChange={e => setForm(f => ({ ...f, user_email: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">API 토큰</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder={config ? config.api_token_masked : "API 토큰 입력"}
              value={form.api_token}
              onChange={e => setForm(f => ({ ...f, api_token: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">프로젝트 키</label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="DOCOPS"
              value={form.project_key}
              onChange={e => setForm(f => ({ ...f, project_key: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#444653] mb-1 block">Done 트리거 상태명 <span className="text-[#757684] font-normal">(쉼표 구분, 비우면 done 카테고리 전체)</span></label>
            <input
              className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
              placeholder="Done, 배포됨"
              value={form.trigger_status_names}
              onChange={e => setForm(f => ({ ...f, trigger_status_names: e.target.value }))}
            />
          </div>
        </div>

        {testResult && (
          <div className={`text-sm px-3 py-2 rounded-lg ${testResult.success ? "bg-[#d5e3fc] text-[#16a34a]" : "bg-[#ffdad6] text-[#93000a]"}`}>
            {testResult.message}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
            {saving ? "저장 중..." : "저장"}
          </button>
          <button onClick={handleTest} disabled={testing} className="px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] disabled:opacity-50 transition-colors">
            {testing ? "테스트 중..." : "연결 테스트"}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="border-b border-[#e0e3e5]">
        <div className="flex gap-1">
          {(["inbound", "outbound"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}
            >
              {t === "inbound" ? "수신 로그 (Jira → DocOps)" : "전송 로그 (DocOps → Jira)"}
            </button>
          ))}
        </div>
      </div>

      {/* 수신 로그 */}
      {tab === "inbound" && (
        callbackLogs.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">webhook</span>
            <p className="mt-4 text-sm text-[#757684]">Jira에서 수신된 콜백이 없습니다</p>
          </div>
        ) : (
          <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">이슈 키</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">이벤트</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">연결 SR</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">처리 결과</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">시간</th>
                </tr>
              </thead>
              <tbody>
                {callbackLogs.map(log => (
                  <tr key={log.id} className="border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                    <td className="px-6 py-3">
                      <span className="text-sm font-mono font-semibold text-[#00288e]">{log.jira_issue_key}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#757684]">{log.event_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#757684] font-mono">{log.sr_draft_id ? log.sr_draft_id.slice(0, 8) + "..." : "-"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getCallbackStatusStyle(log.status)}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {log.status === "processed" ? "처리됨" : log.status === "skipped" ? "건너뜀" : log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#757684]">
                      {new Date(log.created_at).toLocaleString("ko-KR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* 전송 로그 */}
      {tab === "outbound" && (
        outboundLogs.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">webhook</span>
            <p className="mt-4 text-sm text-[#757684]">아직 웹훅 전송 기록이 없습니다</p>
          </div>
        ) : (
          <div className="bg-white border border-[#c4c5d5] rounded-xl overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e0e3e5] bg-[#f7f9fb]">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-[#444653]">내용</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">대상 URL</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">HTTP</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">상태</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[#444653]">시간</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {outboundLogs.map(log => (
                  <tr key={log.id} className="border-b border-[#e0e3e5] last:border-0 hover:bg-[#f7f9fb] transition-colors">
                    <td className="px-6 py-3">
                      <p className="text-sm font-medium text-[#191c1e]">{log.payload_summary || "SR Delivery"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#757684] font-mono truncate max-w-[200px] block">{log.target_url}</span>
                    </td>
                    <td className="px-4 py-3">
                      {log.response_status ? (
                        <span className={`text-xs font-semibold ${log.response_status < 400 ? "text-[#16a34a]" : "text-[#ba1a1a]"}`}>
                          {log.response_status}
                        </span>
                      ) : <span className="text-xs text-[#757684]">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getOutboundStatusStyle(log.status)}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {log.status === "delivered" ? "전송됨" : log.status === "skipped" ? "건너뜀" : "실패"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#757684]">
                      {new Date(log.created_at).toLocaleString("ko-KR")}
                    </td>
                    <td className="px-4 py-3">
                      {(log.status === "failed" || log.status === "error") && (
                        <button
                          onClick={() => handleRetry(log.id)}
                          disabled={retrying === log.id}
                          className="text-xs text-[#00288e] hover:text-[#1e40af] font-medium disabled:opacity-50"
                        >
                          {retrying === log.id ? "..." : "재시도"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd frontend
pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/WebhookLogs.tsx
git commit -m "feat: WebhookLogs 페이지 — Jira 설정 카드 + 수신/전송 로그 탭"
```

---

## Task 8: 프론트엔드 — ServiceRequests.tsx에 Jira 이슈 키 배지 추가

**Files:**
- Modify: `frontend/src/pages/ServiceRequests.tsx`

- [ ] **Step 1: SR 카드에 Jira 이슈 키 배지 추가**

`ServiceRequests.tsx`에서 SR 카드 내 `sr.created_by_ai` 배지 바로 아래에 추가:

```tsx
                    {sr.jira_issue_key && sr.jira_issue_url && (
                      <a
                        href={sr.jira_issue_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e8f0fe] text-[#1a56db] hover:bg-[#c7d7fb] transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <span className="material-symbols-outlined text-[12px]">link</span>
                        {sr.jira_issue_key}
                      </a>
                    )}
```

- [ ] **Step 2: 타입 체크**

```bash
cd frontend
pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ServiceRequests.tsx
git commit -m "feat: SR 카드에 Jira 이슈 키 배지 및 링크 추가"
```

---

## Task 9: 전체 검증

- [ ] **Step 1: 백엔드 전체 테스트**

```bash
cd backend
uv run pytest -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 2: 백엔드 lint**

```bash
cd backend
uv run ruff check .
```

Expected: 오류 없음

- [ ] **Step 3: 프론트엔드 lint + 타입 체크**

```bash
cd frontend
pnpm lint && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: 개발 서버 기동 후 수동 확인**

```bash
# 터미널 1
cd backend && uv run uvicorn app.main:app --reload --port 8000

# 터미널 2
cd frontend && pnpm dev
```

확인 항목:
1. `/webhook-logs` — Jira 설정 카드 렌더링 확인
2. 설정 입력 후 "저장" 버튼 동작 확인
3. "연결 테스트" 버튼 클릭 시 결과 메시지 표시 확인
4. 탭 전환 (수신/전송) 동작 확인
5. `/sr` — SR 카드 정상 렌더링 확인 (기존 SR에 jira_issue_key 없으므로 배지 미표시가 정상)

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: Jira 양방향 연동 구현 완료"
```
