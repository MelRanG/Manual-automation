# 알림 허브 Phase 1 — /approvals 핫픽스 + 매뉴얼 자동화 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/approvals` 라우터 부재로 인한 흰화면 회귀를 차단하고, Notification 모델에 일반 `link_path` 컬럼을 추가하며, 매뉴얼 자동화(Playwright Chromium)를 복구한다. 매뉴얼 생성 완료 시 사용자에게 토스트/벨 알림을 표시한다.

**Architecture:** 백엔드는 `notifications.link_path` 컬럼 1개 추가 마이그 + `create_notification` 시그니처 확장으로 일반화된다. 프론트엔드는 `NotificationBell`/`Toast`/`Layout`이 모두 `link_path`로 동일 동작한다. 매뉴얼 완료 시 백엔드가 알림을 발행하면 기존 SSE → 토스트/벨 인프라가 자동으로 받는다. Approvals 페이지 파일 자체는 보존(Phase 2까지).

**Tech Stack:** FastAPI · SQLAlchemy · Alembic · React + Vite (TypeScript) · React Router 7 · Playwright (Python)

**Spec:** `docs/superpowers/specs/2026-05-21-notification-hub-design.md`

---

## File Structure

**Backend (modify):**
- `backend/app/models/notification.py` — `link_path` 컬럼 추가
- `backend/alembic/versions/<new>_add_link_path_to_notifications.py` — 마이그 (신규)
- `backend/app/routers/notifications.py` — `create_notification` 시그니처, `NotificationResponse`, `_serialize`, SSE payload
- `backend/app/services/document_service.py:293,310` — `link_path` 동반
- `backend/app/services/jira_service.py:365-381` — `link_path` 동반 + 메시지 문구 갱신
- `backend/app/services/manual_service.py:90` 직후 — 완료 알림 발행
- `backend/Dockerfile` — Chromium 설치 단계
- `CLAUDE.md` — 로컬 셋업 1줄

**Backend (test):**
- `backend/tests/test_notifications_link_path.py` — 신규
- `backend/tests/test_manual_completion_notification.py` — 신규

**Frontend (modify):**
- `frontend/src/lib/api.ts:346` — `Notification` 타입에 `link_path` 추가
- `frontend/src/components/NotificationBell.tsx:38-42` — `handleNotifClick` 일반화
- `frontend/src/components/Toast.tsx` — `onClick` prop, `ToastContainer` 시그니처 확장
- `frontend/src/components/Layout.tsx:65, 77-85` — 토스트 큐에 클릭 핸들러 매핑
- `frontend/src/contexts/ManualJobContext.tsx:54-58` — `navigate("/approvals")` 제거
- `frontend/src/pages/Dashboard.tsx:24, 28-40, 80-88, 107-115` — "대기 중 승인"/"오래된 문서" 카드 교체
- `frontend/src/pages/ChangeImpact.tsx:318-329` — `pending_review` 버튼 제거

---

## Task 1: Notification 모델 + 마이그

**Files:**
- Modify: `backend/app/models/notification.py`
- Create: `backend/alembic/versions/<auto>_add_link_path_to_notifications.py`

- [ ] **Step 1: 모델에 `link_path` 컬럼 추가**

`backend/app/models/notification.py:18` 의 `message` 컬럼 직후, `document_id` 이전에 다음 한 줄 추가:

```python
    link_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
```

전체 컬럼 구역 모습:

```python
class Notification(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    link_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True
    )
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["User"] = relationship("User")  # noqa: F821
```

- [ ] **Step 2: alembic 마이그 자동 생성**

Run: `cd backend && uv run alembic revision --autogenerate -m "add_link_path_to_notifications"`
Expected: `backend/alembic/versions/<해시>_add_link_path_to_notifications.py` 생성됨

- [ ] **Step 3: 마이그 파일 내용 검증/수정**

생성된 파일을 열고 `upgrade()` 함수가 다음과 동등한지 확인:

```python
def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("link_path", sa.String(length=500), nullable=True),
    )


def down_grade() -> None:  # 또는 def downgrade()
    op.drop_column("notifications", "link_path")
```

autogenerate가 다른 무관한 변경(예: 다른 테이블 alter)을 함께 만들면 그 부분은 삭제. 본 작업은 `link_path` 추가만.

- [ ] **Step 4: 마이그 적용 + 롤백 검증**

Run:
```bash
cd backend && uv run alembic upgrade head
uv run alembic downgrade -1
uv run alembic upgrade head
```
Expected: 세 명령 모두 에러 없이 통과

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models/notification.py backend/alembic/versions/
git commit -m "feat(backend): add link_path column to notifications

Phase 1 of notification hub design. Generic link path for click
navigation, decouples from document_id-only assumption."
```

---

## Task 2: `create_notification` 시그니처 + 응답 직렬화

**Files:**
- Modify: `backend/app/routers/notifications.py`
- Test: `backend/tests/test_notifications_link_path.py` (신규)

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_notifications_link_path.py` 생성:

```python
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.notifications import create_notification, _serialize
from app.models.user import User


@pytest.mark.asyncio
async def test_create_notification_saves_link_path(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="t@example.com",
        name="t",
        role="admin",
        password_hash="x",
    )
    db_session.add(user)
    await db_session.commit()

    notif = await create_notification(
        db_session,
        user_id=user.id,
        type="manual_completed",
        title="t",
        message="m",
        link_path="/manuals?job=abc&tab=draft",
    )

    assert notif.link_path == "/manuals?job=abc&tab=draft"


@pytest.mark.asyncio
async def test_serialize_includes_link_path(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="t2@example.com",
        name="t2",
        role="admin",
        password_hash="x",
    )
    db_session.add(user)
    await db_session.commit()

    notif = await create_notification(
        db_session,
        user_id=user.id,
        type="t",
        title="t",
        message="m",
        link_path="/sr",
    )
    resp = _serialize(notif)
    assert resp.link_path == "/sr"


@pytest.mark.asyncio
async def test_link_path_defaults_to_none(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="t3@example.com",
        name="t3",
        role="admin",
        password_hash="x",
    )
    db_session.add(user)
    await db_session.commit()

    notif = await create_notification(
        db_session,
        user_id=user.id,
        type="t",
        title="t",
        message="m",
    )
    assert notif.link_path is None
```

`db_session` fixture는 `backend/tests/conftest.py`에 기존 정의를 사용. 실제 fixture명이 다르면 그 이름 사용.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && uv run pytest tests/test_notifications_link_path.py -v`
Expected: FAIL ("TypeError: create_notification() got an unexpected keyword argument 'link_path'" 또는 `NotificationResponse` AttributeError)

- [ ] **Step 3: `create_notification` 시그니처 + 저장 갱신**

`backend/app/routers/notifications.py:26-55` 의 `create_notification` 함수를 다음으로 교체:

```python
async def create_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    type: str,
    title: str,
    message: str,
    document_id: uuid.UUID | None = None,
    link_path: str | None = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        document_id=document_id,
        link_path=link_path,
    )
    db.add(notif)
    await db.commit()
    await db.refresh(notif)

    payload = {
        "id": str(notif.id),
        "type": notif.type,
        "title": notif.title,
        "message": notif.message,
        "document_id": str(notif.document_id) if notif.document_id else None,
        "link_path": notif.link_path,
        "is_read": notif.is_read,
        "created_at": notif.created_at.isoformat(),
    }
    await push_notification(str(user_id), payload)
    return notif
```

- [ ] **Step 4: `NotificationResponse` + `_serialize` 갱신**

`backend/app/routers/notifications.py:58-79` 의 두 곳을 다음으로 교체:

```python
class NotificationResponse(BaseModel):
    id: str
    type: str
    title: str
    message: str
    document_id: str | None
    link_path: str | None
    is_read: bool
    created_at: str

    model_config = {"from_attributes": True}


def _serialize(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=str(n.id),
        type=n.type,
        title=n.title,
        message=n.message,
        document_id=str(n.document_id) if n.document_id else None,
        link_path=n.link_path,
        is_read=n.is_read,
        created_at=n.created_at.isoformat(),
    )
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd backend && uv run pytest tests/test_notifications_link_path.py -v`
Expected: PASS 3개

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/notifications.py backend/tests/test_notifications_link_path.py
git commit -m "feat(backend): add link_path to create_notification and response

Phase 1 of notification hub design. link_path is the generic click
target carried through SSE payload and serialization."
```

---

## Task 3: 기존 발행 지점에 `link_path` 동반

**Files:**
- Modify: `backend/app/services/document_service.py:293-300, 310-317`
- Modify: `backend/app/services/jira_service.py:372-379`

- [ ] **Step 1: `document_service.py` 변환 완료/실패 알림에 `link_path` 추가**

`backend/app/services/document_service.py:293-300` 의 첫 `create_notification` 호출을 다음으로 교체:

```python
                await create_notification(
                    notif_db,
                    user_id=owner_id,
                    type="document_converted",
                    title="문서 변환 완료",
                    message=f"'{doc_title}' 파일 변환이 완료되었습니다.",
                    document_id=document_id,
                    link_path=f"/documents/{document_id}",
                )
```

같은 파일 line 310-317 의 두 번째 호출:

```python
                await create_notification(
                    notif_db,
                    user_id=owner_id,
                    type="conversion_failed",
                    title="문서 변환 실패",
                    message=f"파일 변환 중 오류가 발생했습니다: {filename}",
                    document_id=document_id,
                    link_path=f"/documents/{document_id}",
                )
```

- [ ] **Step 2: `jira_service.py` SR 완료 알림 갱신**

`backend/app/services/jira_service.py:372-379` 의 `create_notification` 호출을 다음으로 교체. 메시지 문구도 "Approvals 페이지"가 더 이상 없으므로 "SR 페이지"로 갱신.

```python
                        await create_notification(
                            session,
                            user_id=admin.id,
                            type="jira_sr_proposals_ready",
                            title=f"SR '{sr.title}' 완료 — 문서 수정안 {proposals_created}건 생성",
                            message="SR 페이지에서 검토하세요.",
                            document_id=None,
                            link_path="/sr",
                        )
```

- [ ] **Step 3: 기존 테스트 회귀 확인**

Run: `cd backend && uv run pytest tests/test_documents.py tests/test_jira.py tests/test_sr.py -v`
Expected: 기존 테스트 모두 PASS (signature 추가는 backward compatible)

- [ ] **Step 4: 커밋**

```bash
git add backend/app/services/document_service.py backend/app/services/jira_service.py
git commit -m "feat(backend): populate link_path at all notification emit sites

document conversion, SR completion. Required to keep click navigation
working after NotificationBell switches to link_path-based dispatch."
```

---

## Task 4: 매뉴얼 완료 시 알림 발행

**Files:**
- Modify: `backend/app/services/manual_service.py:90-92`
- Test: `backend/tests/test_manual_completion_notification.py` (신규)

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_manual_completion_notification.py` 생성:

```python
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual import ManualGenerationJob
from app.models.user import User
from app.services import manual_service


@pytest.mark.asyncio
async def test_completed_job_emits_notification(db_session: AsyncSession):
    user = User(
        id=uuid.uuid4(),
        email="m@example.com",
        name="m",
        role="admin",
        password_hash="x",
    )
    db_session.add(user)
    job = ManualGenerationJob(
        id=uuid.uuid4(),
        user_id=user.id,
        target_url="https://example.com",
        status="pending",
    )
    db_session.add(job)
    await db_session.commit()

    with patch.object(
        manual_service, "capture_screenshots", new=AsyncMock(return_value=[])
    ), patch.object(
        manual_service, "generate_markdown", new=AsyncMock(return_value="# manual")
    ), patch(
        "app.routers.notifications.create_notification",
        new=AsyncMock(),
    ) as mock_notif:
        await manual_service.run_generation(db_session, job.id)

    assert mock_notif.await_count >= 1
    kwargs = mock_notif.await_args.kwargs
    assert kwargs["type"] == "manual_completed"
    assert kwargs["link_path"] == f"/manuals?job={job.id}&tab=draft"
    assert kwargs["user_id"] == user.id


@pytest.mark.asyncio
async def test_notification_failure_does_not_break_completion(
    db_session: AsyncSession,
):
    user = User(
        id=uuid.uuid4(),
        email="m2@example.com",
        name="m2",
        role="admin",
        password_hash="x",
    )
    db_session.add(user)
    job = ManualGenerationJob(
        id=uuid.uuid4(),
        user_id=user.id,
        target_url="https://example.com",
        status="pending",
    )
    db_session.add(job)
    await db_session.commit()

    with patch.object(
        manual_service, "capture_screenshots", new=AsyncMock(return_value=[])
    ), patch.object(
        manual_service, "generate_markdown", new=AsyncMock(return_value="# manual")
    ), patch(
        "app.routers.notifications.create_notification",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        result = await manual_service.run_generation(db_session, job.id)

    assert result.status == "completed"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && uv run pytest tests/test_manual_completion_notification.py -v`
Expected: FAIL (`mock_notif.await_count == 0` 또는 job.status != completed)

- [ ] **Step 3: `run_generation` 완료 분기에 알림 발행 추가**

`backend/app/services/manual_service.py:90-92` (현재 `job.status = "completed"` 분기) 직후, `await db.commit()` 다음에 다음 블록 추가. 최종 코드:

```python
        job.status = "completed"
        job.screenshots = screenshots
        await db.commit()

        try:
            from app.routers.notifications import create_notification
            await create_notification(
                db,
                user_id=job.user_id,
                type="manual_completed",
                title="매뉴얼 작성 완료",
                message=job.target_url,
                link_path=f"/manuals?job={job.id}&tab=draft",
            )
        except Exception as e:
            logger.warning(f"매뉴얼 완료 알림 발행 실패 (job={job.id}): {e}")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && uv run pytest tests/test_manual_completion_notification.py -v`
Expected: PASS 2개

- [ ] **Step 5: 기존 매뉴얼 테스트 회귀 확인**

Run: `cd backend && uv run pytest tests/test_manual_jobs_embed.py -v`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/manual_service.py backend/tests/test_manual_completion_notification.py
git commit -m "feat(backend): emit notification on manual generation completion

Phase 1 of notification hub design. SSE-driven toast/bell receives
manual_completed events with link_path=/manuals?job=...&tab=draft.
Notification failures are logged but never fail the job."
```

---

## Task 5: 백엔드 Dockerfile에 Chromium 설치 + 로컬 가이드

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Dockerfile에 Chromium 설치 추가**

`backend/Dockerfile` 전체를 다음으로 교체. `uv sync` 직후 `COPY app/` 이전에 `playwright install --with-deps chromium` 추가.

```dockerfile
FROM python:3.12-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

RUN uv run playwright install --with-deps chromium

COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini ./

RUN mkdir -p uploads

EXPOSE 8000

CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

- [ ] **Step 2: 로컬 도커 빌드 검증**

Run: `cd backend && docker build -t ma-backend-test .`
Expected: 성공. 마지막 단계가 정상 완료. 이미지 크기는 ~1GB대 (Chromium + deps 포함). 처음 빌드 시 ~5분.

빌드 로그에서 `playwright install` 단계가 `Downloading Chromium ...` 출력 후 정상 종료하는지 육안 확인.

- [ ] **Step 3: 컨테이너 안에서 Chromium 실행 확인**

Run:
```bash
docker run --rm ma-backend-test sh -c 'uv run python -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); b = p.chromium.launch(); print(\"ok\"); b.close(); p.stop()"'
```
Expected: stdout에 `ok` 출력. 에러 메시지 없음.

- [ ] **Step 4: 로컬 dev 가이드 갱신**

`CLAUDE.md` 의 `## Development Commands` 섹션, `# Backend` 블록 마지막 줄에 다음 추가:

```bash
cd backend && uv run playwright install chromium  # 매뉴얼 자동화 1회 셋업
```

블록 전체 모습:

```bash
# Backend
cd backend && uv run fastapi dev  # dev server (port 8000)
cd backend && uv run pytest       # tests
cd backend && uv run ruff check   # lint
cd backend && uv run mypy .       # type check
cd backend && uv run playwright install chromium  # 매뉴얼 자동화 1회 셋업
```

- [ ] **Step 5: 커밋**

```bash
git add backend/Dockerfile CLAUDE.md
git commit -m "fix(backend): install Playwright Chromium in Docker image

매뉴얼 자동화의 capture_screenshots는 Chromium 바이너리와 시스템
의존성(libnss3, libatk 등)이 필요. python:3.12-slim 베이스에 없어
launch()가 실패하고 있었음. --with-deps로 둘 다 설치.
이미지 ~300MB 증가는 받아들임 — 매뉴얼 자동화 본질."
```

---

## Task 6: 프론트 `Notification` 타입에 `link_path` 추가

**Files:**
- Modify: `frontend/src/lib/api.ts:346`

- [ ] **Step 1: 타입 정의 갱신**

`frontend/src/lib/api.ts:346` 의 한 줄을 다음으로 교체:

```typescript
export interface Notification { id: string; type: string; title: string; message: string; document_id: string | null; link_path: string | null; is_read: boolean; created_at: string }
```

- [ ] **Step 2: 타입 체크 통과 확인**

Run: `cd frontend && pnpm typecheck`
Expected: 에러 없음 (Notification을 사용하는 다른 파일들이 `link_path` 부재로 안 깨지는지 확인). 만약 어딘가에서 객체 리터럴로 `Notification`을 만들고 `link_path`를 빠뜨려서 에러 나면 다음 Task에서 해당 부분도 수정. 현재 코드베이스는 SSE/REST에서 받기만 하므로 통과 예상.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): add link_path to Notification type

Phase 1 of notification hub design. Mirrors backend response field."
```

---

## Task 7: `NotificationBell` 클릭을 `link_path` 기반으로 일반화

**Files:**
- Modify: `frontend/src/components/NotificationBell.tsx:38-42`

- [ ] **Step 1: 클릭 핸들러 일반화**

`frontend/src/components/NotificationBell.tsx:38-42` 의 `handleNotifClick` 함수를 다음으로 교체:

```typescript
  const handleNotifClick = (n: Notification) => {
    if (!n.is_read) onMarkRead(n.id)
    setOpen(false)
    if (n.link_path) navigate(n.link_path)
  }
```

`document_id` 분기는 완전히 사라짐. 클릭 동작은 `link_path`만 본다. Task 3에서 모든 발행 지점이 `link_path`를 채우도록 변경했으므로 회귀 없음.

- [ ] **Step 2: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/NotificationBell.tsx
git commit -m "refactor(frontend): dispatch notification click via link_path

document_id-only branch removed. All emit sites now populate link_path."
```

---

## Task 8: `Toast`에 `onClick` prop 추가

**Files:**
- Modify: `frontend/src/components/Toast.tsx`

- [ ] **Step 1: `Toast` 컴포넌트 시그니처 + 본체 갱신**

`frontend/src/components/Toast.tsx` 전체를 다음으로 교체:

```typescript
import { useEffect, useState } from "react"
import { X, Bell } from "lucide-react"

interface ToastProps {
  title: string
  message: string
  onClose: () => void
  onClick?: () => void
  durationMs?: number
}

export function Toast({ title, message, onClose, onClick, durationMs = 4000 }: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 10)
    const t2 = setTimeout(() => {
      setVisible(false)
      setTimeout(onClose, 300)
    }, durationMs)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [durationMs, onClose])

  const interactive = !!onClick
  const handleBodyClick = () => {
    if (!interactive) return
    onClick?.()
    setVisible(false)
    setTimeout(onClose, 300)
  }

  return (
    <div
      onClick={handleBodyClick}
      className={`pointer-events-auto w-80 bg-white border border-[#c4c5d5] rounded-xl shadow-lg p-4 transition-all duration-300 ${interactive ? "cursor-pointer hover:shadow-xl" : ""}`}
      style={{
        transform: visible ? "translateX(0)" : "translateX(110%)",
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[#00288e]/10 flex items-center justify-center shrink-0">
          <Bell className="h-4 w-4 text-[#00288e]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#191c1e] leading-tight mb-0.5 truncate">
            {title}
          </p>
          <p className="text-xs text-[#444653] leading-relaxed line-clamp-2">{message}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setVisible(false)
            setTimeout(onClose, 300)
          }}
          className="p-1 rounded hover:bg-[#f7f9fb] transition-colors text-[#757684] shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

interface ToastItem {
  id: string
  title: string
  message: string
  onClick?: () => void
}

interface ToastContainerProps {
  toasts: ToastItem[]
  onClose: (id: string) => void
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          title={t.title}
          message={t.message}
          onClick={t.onClick}
          onClose={() => onClose(t.id)}
        />
      ))}
    </div>
  )
}
```

요점:
- `onClick` prop은 선택적
- 토스트 본체 클릭 시 핸들러 실행 + 닫기 애니메이션
- X 버튼은 `stopPropagation`으로 본체 클릭과 분리
- 인터랙티브 시 cursor pointer + hover 그림자

- [ ] **Step 2: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음 (Layout이 ToastItem 타입을 사용하므로 다음 Task에서 그쪽도 갱신)

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/Toast.tsx
git commit -m "feat(frontend): add onClick prop to Toast for navigation

Toast body click invokes optional onClick, then closes with animation.
X button stops propagation to remain pure-dismiss."
```

---

## Task 9: `Layout` 토스트 큐에 클릭 핸들러 매핑

**Files:**
- Modify: `frontend/src/components/Layout.tsx:65, 77-87`

- [ ] **Step 1: `ToastItem` 인터페이스에 `onClick` 추가**

`frontend/src/components/Layout.tsx:65` 의 한 줄을 다음으로 교체:

```typescript
interface ToastItem { id: string; title: string; message: string; onClick?: () => void }
```

- [ ] **Step 2: 토스트 등록 시 클릭 핸들러 구성**

`frontend/src/components/Layout.tsx:77-85` 의 `useEffect` 블록을 다음으로 교체:

```typescript
  // 새 알림이 오면 토스트 표시
  useEffect(() => {
    if (!newNotification) return
    const notif = newNotification
    const handleClick = () => {
      void markRead(notif.id)
      if (notif.link_path) navigate(notif.link_path)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToasts((prev) => [
      ...prev,
      { id: notif.id + Date.now(), title: notif.title, message: notif.message, onClick: handleClick },
    ])
    clearNew()
  }, [newNotification, clearNew, markRead, navigate])
```

- [ ] **Step 3: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 4: 수동 검증 (개발 서버)**

Run: 두 터미널에서
```bash
cd backend && uv run fastapi dev
cd frontend && pnpm dev
```

브라우저 5173 접속 → 매뉴얼 1건 생성 → 백엔드 완료 후 토스트가 우측 하단에 뜨고 클릭 가능. 클릭 → `/manuals` (Phase 2 전이므로 query 자동 선택은 안 되지만 페이지 도달 확인).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat(frontend): wire SSE notifications to clickable toasts

Toast bodies now navigate to link_path on click and mark the source
notification as read."
```

---

## Task 10: `ManualJobContext`의 깨진 `navigate` 제거

**Files:**
- Modify: `frontend/src/contexts/ManualJobContext.tsx:48-64`

- [ ] **Step 1: completed 분기에서 navigate 제거**

`frontend/src/contexts/ManualJobContext.tsx:48-64` 의 `startPolling` 함수 본체를 다음으로 교체:

```typescript
  const startPolling = useCallback((jobId: string) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(async () => {
      try {
        const updated = await api.getManualJob(jobId)
        setCurrentStatus(updated.status)
        if (updated.status === "completed") {
          clearJob()
        } else if (updated.status === "failed") {
          clearJob()
        }
      } catch {
        // 일시적 오류 무시
      }
    }, 2000)
  }, [clearJob])
```

요점:
- `navigate("/approvals")` 제거 — Task 9의 토스트가 완료 안내 담당
- `useCallback` deps에서 `navigate` 제거. 파일 상단의 `import { useNavigate } from "react-router-dom"` 및 `const navigate = useNavigate()` 도 더 이상 사용 안 됨 → 제거

전체 파일 수정 후 import 정리:

```typescript
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { api, type ManualJob } from "@/lib/api"
```

`useNavigate` import 라인 삭제. `ManualJobProvider` 본체에서도 `const navigate = useNavigate()` 라인 삭제.

- [ ] **Step 2: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음. 미사용 import 경고 없음.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/contexts/ManualJobContext.tsx
git commit -m "fix(frontend): drop dead navigate(/approvals) from ManualJobContext

/approvals route was removed. Manual completion is now signalled
via the SSE-driven toast wired up in Layout."
```

---

## Task 11: Dashboard 카드 라벨/링크/stat 교체

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx:24, 28-40, 80-88, 107-115`

- [ ] **Step 1: stat 계산용 헬퍼 import 및 state 추가**

`frontend/src/pages/Dashboard.tsx:24-26` 영역을 다음으로 교체:

```typescript
  const [stats, setStats] = useState({ docs: 0, manualReview: 0, feedback: 0, sr: 0 })
  const [recentDocs, setRecentDocs] = useState<Document[]>([])
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null)
  const { user } = useAuth()
```

현재 `Dashboard.tsx`는 `useAuth`를 import하지 않음. 파일 상단에 다음 import 추가:

```typescript
import { useAuth } from "@/contexts/AuthContext"
```

`stats.approvals` 키는 제거됨 — 카드 갈아엎으므로.

- [ ] **Step 2: useEffect fetch 갱신**

`frontend/src/pages/Dashboard.tsx:28-40` 을 다음으로 교체:

```typescript
  useEffect(() => {
    Promise.all([
      api.listDocuments(0, 5),
      api.listManualJobs(user?.id),
      api.listFeedback(),
      api.listSRDrafts(),
      fetch('/api/documents/stats/dashboard').then(r => r.json()),
    ]).then(([docs, manuals, feedback, sr, dashData]) => {
      const manualReview = manuals.filter(
        (j) => j.approval?.status === "pending" || j.approval?.status === "needs_review"
      ).length
      setStats({ docs: docs.total, manualReview, feedback: feedback.length, sr: sr.total })
      setRecentDocs(docs.documents.slice(0, 5))
      setDashboard(dashData)
    }).catch(() => {})
  }, [user?.id])
```

요점:
- `api.listApprovals()` 호출 제거 — Phase 1에선 안 씀
- `api.listManualJobs(user?.id)` 추가 — 매뉴얼 검토 대기 수
- `stats.approvals` → `stats.manualReview`
- deps `[user?.id]` 추가

- [ ] **Step 3: "대기 중 승인" 카드를 "매뉴얼 검토 대기"로 교체**

`frontend/src/pages/Dashboard.tsx:80-88` 의 카드 JSX를 다음으로 교체:

```typescript
        {/* Manual Review */}
        <Link to="/manuals?tab=review" className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#444653]">매뉴얼 검토 대기</span>
            <div className="w-9 h-9 rounded-lg bg-[#ffdbce] flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-[#611e00]">fact_check</span>
            </div>
          </div>
          <span className="text-3xl font-bold text-[#191c1e]">{stats.manualReview}</span>
        </Link>
```

- [ ] **Step 4: "오래된 문서" 카드를 "Jira SR"로 교체**

`frontend/src/pages/Dashboard.tsx:107-115` 의 카드 JSX를 다음으로 교체:

```typescript
        {/* Jira SR */}
        <Link to="/sr" className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#444653]">Jira SR</span>
            <div className="w-9 h-9 rounded-lg bg-[#d5e3fc] flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-[#1a56db]">task</span>
            </div>
          </div>
          <span className="text-3xl font-bold text-[#191c1e]">{stats.sr}</span>
        </Link>
```

- [ ] **Step 5: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 6: 수동 검증**

브라우저에서 `/` 진입 → 카드 4개 모두 정상 표시:
- 전체 문서 신뢰도 → `/trust`
- 매뉴얼 검토 대기 → `/manuals?tab=review`
- 오류 제보 → `/feedback`
- Jira SR → `/sr`

모든 카드 클릭 → 정상 페이지 도달. 흰화면 없음.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat(frontend): replace broken /approvals cards with manual review + SR

대기 중 승인 카드 → 매뉴얼 검토 대기 (/manuals?tab=review).
오래된 문서 카드 → Jira SR (/sr).
stat 소스는 listManualJobs / listSRDrafts 기존 호출 재사용."
```

---

## Task 12: ChangeImpact의 깨진 버튼 제거

**Files:**
- Modify: `frontend/src/pages/ChangeImpact.tsx:318-329`

- [ ] **Step 1: pending_review 분기에서 버튼 제거**

`frontend/src/pages/ChangeImpact.tsx:318-329` 를 다음으로 교체:

```typescript
                      {normalized === "pending_review" && (
                        <div className="border-t border-[#e0e3e5] pt-3">
                          <p className="text-sm text-[#444653]">수정안이 생성되었습니다. 알림에서 확인하세요.</p>
                        </div>
                      )}
```

요점:
- "승인 관리로 이동" 버튼 제거
- 안내문 "수정안이 생성되었습니다. 알림에서 확인하세요."로 변경 (Phase 2 알림 페이지 도래 예고)

`useNavigate` 더 이상 안 쓰면 import + 변수 제거. 다만 `frontend/src/pages/ChangeImpact.tsx`의 다른 곳에서 navigate 쓰는지 확인. (line 322만이 사용처라면 제거)

- [ ] **Step 2: navigate 사용처 잔여 확인**

Run: `grep -n "navigate(" frontend/src/pages/ChangeImpact.tsx`
Expected: line 322가 유일했다면 출력 없음 → import + `const navigate = useNavigate()` 제거. 다른 사용처가 있다면 그대로 유지.

- [ ] **Step 3: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 4: 수동 검증**

ChangeImpact 페이지에서 `pending_review` 상태 카드 노출 시 안내문만 표시되고 버튼 없음. 다른 normalized 분기는 회귀 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/ChangeImpact.tsx
git commit -m "fix(frontend): drop broken /approvals button from ChangeImpact

pending_review 분기는 이제 안내문만 노출. Phase 2의 알림 페이지가
실제 검토 진입점을 담당."
```

---

## 통합 검증 (모든 task 완료 후)

- [ ] **A. 백엔드 전체 테스트 통과**

Run: `cd backend && uv run pytest`
Expected: 모두 PASS. 신규 테스트 2개 + 기존 회귀 없음.

- [ ] **B. 프론트엔드 타입/린트 통과**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **C. 도커 빌드 + Chromium 동작 검증**

Run:
```bash
cd backend && docker build -t ma-backend-phase1 .
docker run --rm ma-backend-phase1 sh -c 'uv run python -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); b = p.chromium.launch(); print(\"ok\"); b.close(); p.stop()"'
```
Expected: stdout에 `ok`

- [ ] **D. 로컬 통합 시나리오**

1. 백엔드 + 프론트 dev 서버 기동
2. 로컬 DB에 마이그 적용: `cd backend && uv run alembic upgrade head`
3. 로그인 후 `/manuals`에서 매뉴얼 1건 생성
4. 다른 탭(`/documents` 등)으로 이동
5. 백엔드가 완료 처리 시 우측 하단 토스트 표시
6. 토스트 클릭 → `/manuals` 도달 (Phase 2 이후엔 해당 job + AI초안 탭 자동 오픈)
7. 우측 상단 벨에 신규 알림 row 표시. 벨 안의 알림 클릭도 동일 동작
8. Dashboard 진입 → 카드 4개 모두 정상 페이지로 이동

- [ ] **E. PR 생성**

브랜치 `feat/chat-widget-parity` 위에서 작업 중이면 별도 핫픽스 브랜치로 빼는 게 안전. 다만 사용자 지시 따름.

```bash
git push -u origin <branch>
gh pr create --title "fix: notification hub Phase 1 hotfix + manual automation recovery" --body "$(cat <<'EOF'
## Summary
- /approvals 라우터 부재로 인한 흰화면 회귀 차단 (ManualJobContext, Dashboard, ChangeImpact)
- Notification 모델에 link_path 컬럼 + 발행 지점 4곳에 동반 (마이그 1회)
- 매뉴얼 완료 시 SSE 알림 발행 → 토스트/벨 자동 표시 + 클릭으로 페이지 이동
- backend Dockerfile에 Playwright Chromium 설치 (매뉴얼 자동화 복구)

## Spec
docs/superpowers/specs/2026-05-21-notification-hub-design.md

## Test plan
- [ ] backend pytest 통과
- [ ] frontend typecheck + lint 통과
- [ ] docker build 후 Chromium launch 동작
- [ ] Dashboard 카드 4개 흰화면 없이 정상 이동
- [ ] 매뉴얼 생성 후 토스트 표시 + 클릭으로 /manuals 도달

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done 정의

- Phase 1 task 1~12 모두 커밋됨
- 통합 검증 A~D 모두 PASS
- Phase 2 plan 시작 가능 (사용자 검토 후)
