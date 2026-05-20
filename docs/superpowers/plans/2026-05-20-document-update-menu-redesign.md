# 문서 현행화 메뉴 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분산된 문서 현행화 프로세스를 매뉴얼 생성 / 오류 제보 / Jira SR 3개 메뉴로 통합하고, 각 메뉴에 탭·상세 패널·변경 이력 타임라인을 추가한다.

**Architecture:** 프론트엔드 전용 리팩터. 백엔드 API는 기존 그대로 사용하되, change_history 타임라인을 위한 백엔드 테이블·API를 신규 추가한다. 기존 Approvals·ChangeImpact 페이지는 제거하고, 각 페이지 내에서 검토·승인 흐름을 완결한다.

**Tech Stack:** React + TypeScript (Vite), Tailwind CSS, FastAPI, SQLAlchemy async, Alembic

---

## 파일 구조

### 신규 생성
- `frontend/src/pages/ManualGenerator.tsx` — 완전 재작성 (탭 + 목록 + 상세 패널)
- `frontend/src/pages/Feedback.tsx` — 완전 재작성 (탭 + 목록 + 상세 패널)
- `frontend/src/pages/ServiceRequests.tsx` — 완전 재작성 (탭 5개 + 출처 필터 + 상세 패널)
- `frontend/src/components/ChangeHistoryTimeline.tsx` — 공통 타임라인 컴포넌트

### 수정
- `frontend/src/components/Layout.tsx` — 네비게이션 섹션명·메뉴 변경, Approvals/ChangeImpact 제거
- `frontend/src/App.tsx` — /approvals, /change-impact 라우트 제거
- `frontend/src/lib/api.ts` — change_history API 메서드 추가, feedback list params 추가
- `backend/app/models/history.py` — 신규: ChangeHistory 모델
- `backend/app/schemas/history.py` — 신규: ChangeHistoryResponse
- `backend/app/routers/history.py` — 신규: GET /api/history/{entity_type}/{entity_id}
- `backend/app/services/history_service.py` — 신규: log_event, list_events
- `backend/app/main.py` — history 라우터 등록
- `backend/app/routers/feedback.py` — list_feedback에 status 필터 파라미터 추가
- `backend/app/routers/approvals.py` — feedback·manual 승인 처리 엔드포인트 확인
- `backend/alembic/versions/` — change_history 테이블 마이그레이션

---

## Task 1: 네비게이션 및 라우팅 변경

**Files:**
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Layout.tsx — navSections 변경**

`frontend/src/components/Layout.tsx`의 `navSections` 배열에서 아래와 같이 수정:

```tsx
// 변경 전
{
  heading: "변경 관리",
  items: [
    { to: "/sr", icon: Ticket, label: "서비스 요청" },
    { to: "/change-impact", icon: GitMerge, label: "변경 영향" },
    { to: "/approvals", icon: CheckCircle, label: "승인 관리" },
  ],
},
```

```tsx
// 변경 후 — "문서" 섹션에서 매뉴얼 생성 제거, "문서 현행화" 섹션 신설
{
  heading: "문서",
  items: [
    { to: "/documents", icon: FileText, label: "문서 관리" },
  ],
},
{
  heading: "문서 현행화",
  items: [
    { to: "/manuals", icon: BookOpen, label: "매뉴얼 생성" },
    { to: "/feedback", icon: LifeBuoy, label: "오류 제보" },
    { to: "/sr", icon: Ticket, label: "Jira SR" },
  ],
},
```

또한 import에서 `GitMerge`, `CheckCircle` 제거 (사용 안 함).

- [ ] **Step 2: App.tsx — 라우트 제거**

`frontend/src/App.tsx`에서 아래 두 줄 제거:
```tsx
// 제거
<Route path="/approvals" element={<Approvals />} />
<Route path="/change-impact" element={<ChangeImpact />} />
```

import에서도 `Approvals`, `ChangeImpact` 제거:
```tsx
// 제거
import { Approvals } from "@/pages/Approvals"
import { ChangeImpact } from "@/pages/ChangeImpact"
```

- [ ] **Step 3: 개발 서버 실행 후 네비게이션 확인**

```bash
cd frontend && pnpm dev
```

브라우저에서 확인:
- 사이드바에 "문서 현행화" 섹션 + 3개 메뉴 표시
- /approvals, /change-impact 접속 시 404 또는 빈 화면 (라우트 없음)
- 기존 /manuals, /feedback, /sr 정상 접속

- [ ] **Step 4: 타입체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음 (또는 Approvals/ChangeImpact import 관련 오류만 → 이미 제거했으므로 없어야 함)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/Layout.tsx frontend/src/App.tsx
git commit -m "feat: 네비게이션을 문서 현행화 3개 메뉴로 재편"
```

---

## Task 2: 백엔드 — change_history 테이블 및 API

**Files:**
- Create: `backend/app/models/history.py`
- Create: `backend/app/schemas/history.py`
- Create: `backend/app/services/history_service.py`
- Create: `backend/app/routers/history.py`
- Modify: `backend/app/main.py`
- Create: `backend/alembic/versions/<timestamp>_add_change_history.py`

- [ ] **Step 1: 모델 생성**

`backend/app/models/history.py` 신규 생성:

```python
import uuid
from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, UUIDMixin


class ChangeHistory(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "change_history"

    entity_type: Mapped[str] = mapped_column(String(50))   # "sr" | "feedback" | "manual"
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    event_type: Mapped[str] = mapped_column(String(50))    # "created" | "ai_draft" | "edited" | "status_changed" | "approved" | "applied"
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 2: 스키마 생성**

`backend/app/schemas/history.py` 신규 생성:

```python
import uuid
from pydantic import BaseModel


class ChangeHistoryResponse(BaseModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    event_type: str
    actor_id: uuid.UUID | None
    actor_name: str | None
    detail: str | None
    created_at: str

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: 서비스 생성**

`backend/app/services/history_service.py` 신규 생성:

```python
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.history import ChangeHistory


async def log_event(
    db: AsyncSession,
    entity_type: str,
    entity_id: uuid.UUID,
    event_type: str,
    actor_id: uuid.UUID | None = None,
    actor_name: str | None = None,
    detail: str | None = None,
) -> ChangeHistory:
    event = ChangeHistory(
        entity_type=entity_type,
        entity_id=entity_id,
        event_type=event_type,
        actor_id=actor_id,
        actor_name=actor_name,
        detail=detail,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def list_events(
    db: AsyncSession,
    entity_type: str,
    entity_id: uuid.UUID,
) -> list[ChangeHistory]:
    result = await db.execute(
        select(ChangeHistory)
        .where(
            ChangeHistory.entity_type == entity_type,
            ChangeHistory.entity_id == entity_id,
        )
        .order_by(ChangeHistory.created_at.asc())
    )
    return list(result.scalars().all())
```

- [ ] **Step 4: 라우터 생성**

`backend/app/routers/history.py` 신규 생성:

```python
import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.schemas.history import ChangeHistoryResponse
from app.services import history_service

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("/{entity_type}/{entity_id}", response_model=list[ChangeHistoryResponse])
async def get_history(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await history_service.list_events(db, entity_type, entity_id)
```

- [ ] **Step 5: main.py에 라우터 등록**

`backend/app/main.py`에서 history 라우터 추가:

```python
from app.routers import auth, documents, users, chat, feedback, approvals, trust, sr, change_impact, manual, widget, notifications, jira, history
# ...
app.include_router(history.router)
```

- [ ] **Step 6: Alembic 마이그레이션 생성**

```bash
cd backend && uv run alembic revision --autogenerate -m "add_change_history"
```

생성된 파일에서 `upgrade()` 함수 내용 확인 — `change_history` 테이블 생성 구문이 있어야 함.

- [ ] **Step 7: 마이그레이션 적용**

```bash
cd backend && uv run alembic upgrade head
```

Expected: 오류 없이 완료

- [ ] **Step 8: 백엔드 서버 실행 후 API 확인**

```bash
cd backend && uv run fastapi dev
```

```bash
curl http://localhost:8000/api/history/sr/00000000-0000-0000-0000-000000000001
# Expected: [] (빈 배열, 오류 없음)
```

- [ ] **Step 9: 커밋**

```bash
git add backend/app/models/history.py backend/app/schemas/history.py backend/app/services/history_service.py backend/app/routers/history.py backend/app/main.py backend/alembic/versions/
git commit -m "feat: change_history 테이블 및 API 추가"
```

---

## Task 3: 백엔드 — feedback list에 status 필터 추가

**Files:**
- Modify: `backend/app/routers/feedback.py`
- Modify: `backend/app/services/feedback_service.py`

기존 `list_feedback`는 `document_id`로만 필터링 가능. 탭 구현을 위해 `status` 필터 추가 필요.

- [ ] **Step 1: feedback_service.py list_feedback 수정**

`backend/app/services/feedback_service.py`의 `list_feedback` 함수 시그니처와 쿼리 수정:

```python
async def list_feedback(
    db: AsyncSession,
    document_id: uuid.UUID | None = None,
    status: str | None = None,
) -> list[dict]:
    stmt = select(FeedbackReport).order_by(FeedbackReport.created_at.desc())
    if document_id:
        stmt = stmt.where(FeedbackReport.document_id == document_id)
    if status:
        stmt = stmt.where(FeedbackReport.status == status)
    # 나머지 기존 로직 유지 (proposed_change_status join 등)
```

기존 함수 내부의 나머지 로직(proposed_change_status 조회 부분)은 그대로 유지.

- [ ] **Step 2: feedback router list_feedback 수정**

`backend/app/routers/feedback.py`의 `list_feedback` 엔드포인트:

```python
@router.get("", response_model=list[FeedbackReportResponse])
async def list_feedback(
    document_id: uuid.UUID | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await feedback_service.list_feedback(db, document_id, status)
```

- [ ] **Step 3: 백엔드 lint**

```bash
cd backend && uv run ruff check app/routers/feedback.py app/services/feedback_service.py
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add backend/app/routers/feedback.py backend/app/services/feedback_service.py
git commit -m "feat: feedback list에 status 필터 파라미터 추가"
```

---

## Task 4: 프론트엔드 — api.ts에 신규 메서드 추가

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: ChangeHistory 타입 추가**

`frontend/src/lib/api.ts` 하단 인터페이스 목록에 추가:

```typescript
export interface ChangeHistory {
  id: string
  entity_type: string
  entity_id: string
  event_type: string
  actor_id: string | null
  actor_name: string | null
  detail: string | null
  created_at: string
}
```

- [ ] **Step 2: api 객체에 메서드 추가**

`frontend/src/lib/api.ts`의 `api` 객체에 추가:

```typescript
// History
listHistory: (entityType: string, entityId: string) =>
  request<ChangeHistory[]>(`/history/${entityType}/${entityId}`),

// Feedback (status 필터 추가)
listFeedbackByStatus: (status?: string) => {
  const params = new URLSearchParams()
  if (status) params.set("status", status)
  return request<FeedbackReport[]>(`/feedback?${params.toString()}`)
},
```

- [ ] **Step 3: 타입체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: api.ts에 history, feedbackByStatus 메서드 추가"
```

---

## Task 5: 공통 컴포넌트 — ChangeHistoryTimeline

**Files:**
- Create: `frontend/src/components/ChangeHistoryTimeline.tsx`

- [ ] **Step 1: 컴포넌트 생성**

`frontend/src/components/ChangeHistoryTimeline.tsx`:

```tsx
import { useApi } from "@/hooks/useApi"
import { api, type ChangeHistory } from "@/lib/api"

const EVENT_LABELS: Record<string, string> = {
  created: "생성",
  ai_draft: "AI 초안",
  edited: "수정",
  status_changed: "상태 변경",
  approved: "승인",
  applied: "문서 반영",
  rejected: "반려",
}

const EVENT_COLORS: Record<string, string> = {
  created: "bg-[#e8f4fd] text-[#00288e]",
  ai_draft: "bg-[#f0f0ff] text-[#4a4bdc]",
  edited: "bg-[#fff3dc] text-[#92600a]",
  status_changed: "bg-[#f2f4f6] text-[#444653]",
  approved: "bg-[#dcfce7] text-[#15803d]",
  applied: "bg-[#dcfce7] text-[#15803d]",
  rejected: "bg-[#ffdad6] text-[#ba1a1a]",
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

interface Props {
  entityType: "sr" | "feedback" | "manual"
  entityId: string
}

export function ChangeHistoryTimeline({ entityType, entityId }: Props) {
  const { data: events, loading } = useApi(
    () => api.listHistory(entityType, entityId),
    [entityType, entityId]
  )

  if (loading) {
    return <div className="text-xs text-[#757684] py-4">이력 로딩 중...</div>
  }

  if (!events || events.length === 0) {
    return <div className="text-xs text-[#757684] py-4">이력이 없습니다.</div>
  }

  return (
    <div className="space-y-0">
      {events.map((ev, i) => (
        <div key={ev.id} className="flex gap-3 relative">
          {/* 타임라인 선 */}
          {i < events.length - 1 && (
            <div className="absolute left-[11px] top-6 bottom-0 w-px bg-[#e0e3e5]" />
          )}
          {/* 도트 */}
          <div className="mt-1 w-6 h-6 rounded-full bg-[#f2f4f6] border border-[#e0e3e5] flex items-center justify-center shrink-0 z-10">
            <div className="w-2 h-2 rounded-full bg-[#9a9bad]" />
          </div>
          {/* 내용 */}
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${EVENT_COLORS[ev.event_type] ?? "bg-[#f2f4f6] text-[#444653]"}`}>
                {EVENT_LABELS[ev.event_type] ?? ev.event_type}
              </span>
              {ev.actor_name && (
                <span className="text-xs text-[#444653] font-medium">{ev.actor_name}</span>
              )}
              <span className="text-[11px] text-[#9a9bad]">{formatDate(ev.created_at)}</span>
            </div>
            {ev.detail && (
              <p className="text-xs text-[#757684] mt-1">{ev.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 타입체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/ChangeHistoryTimeline.tsx
git commit -m "feat: ChangeHistoryTimeline 공통 컴포넌트 추가"
```

---

## Task 6: 매뉴얼 생성 페이지 재작성

**Files:**
- Modify: `frontend/src/pages/ManualGenerator.tsx` (전체 재작성)

현재 ManualGenerator는 URL 입력 폼만 있음. 탭(전체/검토요청/완료) + 목록 + 상세 패널 구조로 재작성.

manual job status 매핑:
- `pending` / `running` → 전체 탭에만 표시 (진행 중)
- `completed` + proposed_change.status=`pending` → 검토요청
- `completed` + proposed_change.status=`approved`/`applied` → 완료
- `failed` → 전체 탭에만

- [ ] **Step 1: ManualGenerator.tsx 재작성**

```tsx
import { useState } from "react"
import { api, type ManualJob } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { useManualJob } from "@/contexts/ManualJobContext"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"

type Tab = "all" | "review" | "done"

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-[#fff3dc] text-[#92600a]",
  running: "bg-[#d5e3fc] text-[#00288e]",
  completed: "bg-[#dcfce7] text-[#15803d]",
  failed: "bg-[#ffdad6] text-[#ba1a1a]",
}
const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  running: "생성 중",
  completed: "완료",
  failed: "실패",
}

function jobTabCategory(job: ManualJob): Tab {
  if (job.status === "completed") return "done"
  return "all"
}

export function ManualGenerator() {
  const { user } = useAuth()
  const { runningJob, startJob, clearJob } = useManualJob()
  const [tab, setTab] = useState<Tab>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  // 폼 상태
  const [targetUrl, setTargetUrl] = useState("")
  const [loginUrl, setLoginUrl] = useState("")
  const [loginId, setLoginId] = useState("")
  const [loginPw, setLoginPw] = useState("")
  const [steps, setSteps] = useState<string[]>([])
  const [stepInput, setStepInput] = useState("")
  const [errorMsg, setErrorMsg] = useState("")

  const { data: jobs, refetch } = useApi(
    () => api.listManualJobs(user?.id),
    [user?.id]
  )

  const allJobs = jobs ?? []

  const filtered = allJobs.filter(j => {
    if (tab === "all") return true
    if (tab === "review") return j.status === "completed" && !j.output_document_id  // 문서 미반영 = 검토 필요
    if (tab === "done") return j.status === "completed" && !!j.output_document_id
    return true
  })

  const selected = allJobs.find(j => j.id === selectedId) ?? null

  const reviewCount = allJobs.filter(j => j.status === "completed" && !j.output_document_id).length

  const normalizeUrl = (url: string) => {
    const v = url.trim()
    if (!v || v.startsWith("http://") || v.startsWith("https://")) return v
    return `https://${v}`
  }

  const addStep = () => {
    const t = stepInput.trim()
    if (t) { setSteps(prev => [...prev, t]); setStepInput("") }
  }

  const handleSubmit = async () => {
    const url = normalizeUrl(targetUrl)
    if (!url) return
    setErrorMsg("")
    try {
      const job = await api.createManualJob({
        user_id: user?.id || "00000000-0000-0000-0000-000000000001",
        target_url: url,
        login_id: loginId || undefined,
        login_pw: loginPw || undefined,
        login_url: normalizeUrl(loginUrl) || undefined,
        scenario_steps: steps.length > 0 ? steps : undefined,
      })
      startJob(job)
      setShowForm(false)
      setTargetUrl(""); setLoginUrl(""); setLoginId(""); setLoginPw(""); setSteps([])
      refetch()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "요청 실패")
    }
  }

  return (
    <div className="flex h-full">
      {/* 좌측: 목록 */}
      <div className="w-[380px] border-r border-[#e0e3e5] flex flex-col shrink-0">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#191c1e]">매뉴얼 생성</h2>
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              신규 요청
            </button>
          </div>
          {/* 탭 */}
          <div className="flex gap-1 border-b border-[#e0e3e5]">
            {([["all", "전체"], ["review", "검토요청"], ["done", "완료"]] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedId(null) }}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? "border-[#00288e] text-[#00288e]"
                    : "border-transparent text-[#757684] hover:text-[#191c1e]"
                }`}
              >
                {label}
                {t === "review" && reviewCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#00288e] text-white text-[10px] font-bold">
                    {reviewCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 신규 요청 폼 */}
        {showForm && (
          <div className="mx-4 mb-3 p-4 border border-[#c4c5d5] rounded-xl bg-white space-y-3 text-sm">
            {errorMsg && <div className="text-xs text-[#ba1a1a] bg-[#ffdad6] px-3 py-2 rounded-lg">{errorMsg}</div>}
            <div>
              <label className="text-xs font-medium text-[#191c1e]">대상 URL *</label>
              <input className="mt-1 w-full px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" placeholder="https://example.com" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-medium text-[#191c1e]">로그인 URL</label>
                <input className="mt-1 w-full px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" value={loginUrl} onChange={e => setLoginUrl(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-[#191c1e]">아이디</label>
                <input className="mt-1 w-full px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" value={loginId} onChange={e => setLoginId(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-[#191c1e]">비밀번호</label>
                <input type="password" className="mt-1 w-full px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" value={loginPw} onChange={e => setLoginPw(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#191c1e]">클릭 단계</label>
              <div className="flex gap-1 mt-1">
                <input className="flex-1 px-2 py-1.5 border border-[#c4c5d5] rounded-lg text-xs outline-none focus:border-[#00288e]" placeholder="예: 뉴스 클릭" value={stepInput} onChange={e => setStepInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addStep()} />
                <button onClick={addStep} className="px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs hover:bg-[#f2f4f6]">추가</button>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-1 mt-1 text-xs">
                  <span className="text-[#757684] w-4">{i + 1}.</span>
                  <span className="flex-1">{s}</span>
                  <button onClick={() => setSteps(p => p.filter((_, j) => j !== i))} className="text-[#9a9bad] hover:text-[#ba1a1a]">✕</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs hover:bg-[#f2f4f6]">취소</button>
              <button onClick={handleSubmit} disabled={!targetUrl.trim()} className="px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] disabled:opacity-50">생성 시작</button>
            </div>
          </div>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            filtered.map(job => (
              <button
                key={job.id}
                onClick={() => setSelectedId(job.id)}
                className={`w-full text-left px-5 py-4 hover:bg-[#f7f9fb] transition-colors ${selectedId === job.id ? "bg-[#eef2ff]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#191c1e] truncate flex-1">{job.target_url}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[job.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </div>
                <p className="text-xs text-[#9a9bad] mt-1">{new Date(job.created_at).toLocaleDateString("ko-KR")}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 우측: 상세 패널 */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <ManualDetail job={selected} onRefetch={refetch} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function ManualDetail({ job, onRefetch }: { job: ManualJob; onRefetch: () => void }) {
  const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">("info")

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1 truncate">{job.target_url}</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          job.status === "completed" ? "bg-[#dcfce7] text-[#15803d]" :
          job.status === "running" ? "bg-[#d5e3fc] text-[#00288e]" :
          job.status === "failed" ? "bg-[#ffdad6] text-[#ba1a1a]" :
          "bg-[#fff3dc] text-[#92600a]"
        }`}>{job.status === "completed" ? "완료" : job.status === "running" ? "생성 중" : job.status === "failed" ? "실패" : "대기"}</span>
      </div>

      {/* 섹션 탭 */}
      <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
        {([["info", "요청 정보"], ["draft", "AI 초안"], ["history", "변경 이력"]] as ["info" | "draft" | "history", string][]).map(([s, label]) => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeSection === s ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}>
            {label}
          </button>
        ))}
      </div>

      {activeSection === "info" && (
        <div className="space-y-3 text-sm">
          <div><span className="text-[#757684] w-24 inline-block">대상 URL</span><a href={job.target_url} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline">{job.target_url}</a></div>
          <div><span className="text-[#757684] w-24 inline-block">요청 일시</span><span className="text-[#191c1e]">{new Date(job.created_at).toLocaleString("ko-KR")}</span></div>
          {job.screenshots && job.screenshots.length > 0 && (
            <div>
              <span className="text-[#757684] block mb-2">스크린샷 ({job.screenshots.length})</span>
              <div className="space-y-1">
                {job.screenshots.map((s, i) => (
                  <div key={i} className="text-xs text-[#444653]">{i + 1}. {s.description}</div>
                ))}
              </div>
            </div>
          )}
          {job.error_message && (
            <div className="p-3 bg-[#ffdad6] rounded-lg text-xs text-[#ba1a1a]">{job.error_message}</div>
          )}
        </div>
      )}

      {activeSection === "draft" && (
        <div>
          {job.output_document_id ? (
            <div className="text-sm text-[#444653]">
              <p className="mb-2 text-[#15803d] font-medium">문서가 생성되었습니다.</p>
              <a href={`/documents/${job.output_document_id}`} className="text-[#00288e] hover:underline text-sm">생성된 문서 보기 →</a>
            </div>
          ) : job.status === "completed" ? (
            <div className="p-4 bg-[#fff3dc] rounded-xl text-sm text-[#92600a]">
              AI 초안 검토 기능은 승인 관리에서 이동 예정입니다. 현재는 생성된 문서를 직접 확인하세요.
            </div>
          ) : (
            <div className="text-sm text-[#9a9bad]">매뉴얼 생성이 완료된 후 초안을 확인할 수 있습니다.</div>
          )}
        </div>
      )}

      {activeSection === "history" && (
        <ChangeHistoryTimeline entityType="manual" entityId={job.id} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 타입체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 3: 브라우저에서 /manuals 확인**

개발 서버 실행 상태에서:
- 탭 전체/검토요청/완료 전환 동작
- 신규 요청 버튼 클릭 → 폼 표시
- 목록 항목 클릭 → 우측 상세 패널 표시
- 변경 이력 탭 클릭 → 타임라인 표시 (데이터 없으면 "이력이 없습니다")

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/ManualGenerator.tsx
git commit -m "feat: 매뉴얼 생성 페이지 탭+목록+상세 패널 구조로 재작성"
```

---

## Task 7: 오류 제보 페이지 재작성

**Files:**
- Modify: `frontend/src/pages/Feedback.tsx` (전체 재작성)

현재 Feedback 페이지는 피드백 생성 폼 중심. 탭(전체/검토요청/완료) + 목록 + 상세 패널로 재작성.

feedback status 매핑: `pending` → 검토요청, `processed` → 완료

- [ ] **Step 1: Feedback.tsx 재작성**

```tsx
import { useState } from "react"
import { api, type FeedbackReport } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"

type Tab = "all" | "review" | "done"

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-[#fff3dc] text-[#92600a]",
  processed: "bg-[#dcfce7] text-[#15803d]",
}
const STATUS_LABEL: Record<string, string> = {
  pending: "검토요청",
  processed: "완료",
}

export function Feedback() {
  const [tab, setTab] = useState<Tab>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: allItems, loading, refetch } = useApi(
    () => api.listFeedbackByStatus(),
    []
  )

  const items = allItems ?? []

  const filtered = items.filter(f => {
    if (tab === "all") return true
    if (tab === "review") return f.status === "pending"
    if (tab === "done") return f.status === "processed"
    return true
  })

  const selected = items.find(f => f.id === selectedId) ?? null
  const reviewCount = items.filter(f => f.status === "pending").length

  return (
    <div className="flex h-full">
      {/* 좌측: 목록 */}
      <div className="w-[380px] border-r border-[#e0e3e5] flex flex-col shrink-0">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-bold text-[#191c1e] mb-3">오류 제보</h2>
          <div className="flex gap-1 border-b border-[#e0e3e5]">
            {([["all", "전체"], ["review", "검토요청"], ["done", "완료"]] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedId(null) }}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  tab === t ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"
                }`}
              >
                {label}
                {t === "review" && reviewCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#00288e] text-white text-[10px] font-bold">{reviewCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">로딩 중...</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            filtered.map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full text-left px-5 py-4 hover:bg-[#f7f9fb] transition-colors ${selectedId === item.id ? "bg-[#eef2ff]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#191c1e] truncate flex-1 leading-snug">
                    {item.feedback_text.slice(0, 60)}{item.feedback_text.length > 60 ? "…" : ""}
                  </p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[item.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                {item.document_title && (
                  <p className="text-xs text-[#9a9bad] mt-1 truncate">{item.document_title}</p>
                )}
                <p className="text-xs text-[#9a9bad] mt-0.5">{new Date(item.created_at).toLocaleDateString("ko-KR")}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 우측: 상세 패널 */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <FeedbackDetail item={selected} onRefetch={refetch} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function FeedbackDetail({ item, onRefetch }: { item: FeedbackReport; onRefetch: () => void }) {
  const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">("info")
  const { data: proposal } = useApi(
    () => api.getFeedbackProposal(item.id),
    [item.id]
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">오류 제보 상세</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          item.status === "processed" ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fff3dc] text-[#92600a]"
        }`}>{item.status === "processed" ? "완료" : "검토요청"}</span>
      </div>

      <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
        {([["info", "요청 정보"], ["draft", "AI 수정 초안"], ["history", "변경 이력"]] as ["info" | "draft" | "history", string][]).map(([s, label]) => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeSection === s ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}>
            {label}
          </button>
        ))}
      </div>

      {activeSection === "info" && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-[#757684] mb-1">제보 내용</p>
            <p className="text-[#191c1e] whitespace-pre-wrap bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{item.feedback_text}</p>
          </div>
          {item.document_title && (
            <div><span className="text-[#757684] w-24 inline-block text-xs">관련 문서</span><span className="text-[#191c1e]">{item.document_title}</span></div>
          )}
          <div><span className="text-[#757684] w-24 inline-block text-xs">제보 일시</span><span className="text-[#191c1e]">{new Date(item.created_at).toLocaleString("ko-KR")}</span></div>
        </div>
      )}

      {activeSection === "draft" && (
        <div>
          {proposal ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정 근거</p>
                <p className="text-sm text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{proposal.reasoning}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-2">기존 내용</p>
                <pre className="text-xs text-[#444653] bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5] whitespace-pre-wrap overflow-auto max-h-48">{proposal.original_text}</pre>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-2">수정 제안</p>
                <pre className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap overflow-auto max-h-48">{proposal.proposed_text}</pre>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#757684]">
                <span>신뢰도</span>
                <div className="flex-1 bg-[#e0e3e5] rounded-full h-1.5">
                  <div className="bg-[#00288e] h-1.5 rounded-full" style={{ width: `${Math.round(proposal.confidence * 100)}%` }} />
                </div>
                <span>{Math.round(proposal.confidence * 100)}%</span>
              </div>
              <p className="text-xs text-[#9a9bad]">승인은 승인 관리 페이지에서 처리됩니다.</p>
            </div>
          ) : (
            <div className="text-sm text-[#9a9bad]">AI 수정 초안이 없습니다.</div>
          )}
        </div>
      )}

      {activeSection === "history" && (
        <ChangeHistoryTimeline entityType="feedback" entityId={item.id} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: api.ts에 getFeedbackProposal 확인**

`frontend/src/lib/api.ts`에서 `getFeedbackProposal` 메서드 확인:

```typescript
// 이미 존재하는지 확인
getFeedbackProposal: (feedbackId: string) =>
  request<ProposedChange>(`/feedback/${feedbackId}/proposal`),
```

없으면 추가.

- [ ] **Step 3: 타입체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: 브라우저에서 /feedback 확인**

- 탭 전체/검토요청/완료 전환
- 목록 항목 클릭 → 우측 상세 패널
- AI 수정 초안 탭 → proposal 표시

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/Feedback.tsx
git commit -m "feat: 오류 제보 페이지 탭+목록+상세 패널 구조로 재작성"
```

---

## Task 8: Jira SR 페이지 재작성

**Files:**
- Modify: `frontend/src/pages/ServiceRequests.tsx` (전체 재작성)

탭 5개(전체/SR요청대기/SR진행중/검토/완료) + 출처 태그 필터 + 상세 패널 + 검토 Step 1~3.

SR status 매핑:
- `draft` → SR요청 대기
- `active` → SR 진행중
- `pending_doc_review` → 검토
- `done` → 완료

출처 태그: `created_by_ai=false` → "직접생성", `created_by_ai=true` → "챗봇"

- [ ] **Step 1: ServiceRequests.tsx 재작성**

```tsx
import { useState } from "react"
import { api, type SRDraft, type Document } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"
import { ChangeHistoryTimeline } from "@/components/ChangeHistoryTimeline"

type Tab = "all" | "draft" | "active" | "pending_doc_review" | "done"
type SourceFilter = "all" | "direct" | "chatbot"

const TAB_LABELS: Record<Tab, string> = {
  all: "전체",
  draft: "SR요청 대기",
  active: "SR 진행중",
  pending_doc_review: "검토",
  done: "완료",
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-[#f2f4f6] text-[#444653]",
  active: "bg-[#d5e3fc] text-[#00288e]",
  pending_doc_review: "bg-[#fff3dc] text-[#92600a]",
  done: "bg-[#dcfce7] text-[#15803d]",
}

type ReviewStep = 1 | 2 | 3
type DocMode = "new" | "existing" | null

export function ServiceRequests() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>("all")
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // 신규 SR 폼
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("medium")
  const [targetUrl, setTargetUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const userId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  const { data: result, refetch } = useApi(
    () => api.listSRDrafts({ status: tab === "all" ? undefined : tab, skip: 0, limit: 500 }),
    [tab]
  )

  const allItems = result?.items ?? []

  const filtered = allItems.filter(sr => {
    if (sourceFilter === "direct") return !sr.created_by_ai
    if (sourceFilter === "chatbot") return sr.created_by_ai
    return true
  })

  const selected = allItems.find(s => s.id === selectedId) ?? null

  const tabCount = (t: Tab) => {
    if (t === "all") return allItems.length
    return allItems.filter(s => s.status === t).length
  }

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      const normalizedUrl = targetUrl.trim()
        ? (targetUrl.trim().startsWith("http") ? targetUrl.trim() : `https://${targetUrl.trim()}`)
        : undefined
      await api.createSRDraft({ user_id: userId, title, description, priority, target_url: normalizedUrl })
      setTitle(""); setDescription(""); setTargetUrl(""); setShowCreate(false)
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* 좌측: 목록 */}
      <div className="w-[400px] border-r border-[#e0e3e5] flex flex-col shrink-0">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#191c1e]">Jira SR</h2>
            <button
              onClick={() => setShowCreate(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              신규 SR
            </button>
          </div>

          {/* 탭 */}
          <div className="flex gap-0.5 border-b border-[#e0e3e5] overflow-x-auto">
            {(["all", "draft", "active", "pending_doc_review", "done"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedId(null) }}
                className={`px-2.5 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  tab === t ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"
                }`}
              >
                {TAB_LABELS[t]}
                {t !== "all" && tabCount(t) > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${t === "pending_doc_review" ? "bg-[#92600a] text-white" : "bg-[#e0e3e5] text-[#444653]"}`}>
                    {tabCount(t)}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 출처 필터 */}
          <div className="flex gap-1.5 mt-2">
            {([["all", "전체"], ["direct", "직접생성"], ["chatbot", "챗봇"]] as [SourceFilter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  sourceFilter === f ? "bg-[#00288e] text-white" : "bg-[#f2f4f6] text-[#757684] hover:bg-[#e0e3e5]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 신규 SR 폼 */}
        {showCreate && (
          <div className="mx-4 mb-3 p-4 border border-[#c4c5d5] rounded-xl bg-white space-y-3 text-sm">
            <input className="w-full px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e]" placeholder="제목 *" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea className="w-full px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e] resize-none" rows={3} placeholder="내용 *" value={description} onChange={e => setDescription(e.target.value)} />
            <div className="flex gap-2">
              <select className="flex-1 px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">낮음</option>
                <option value="medium">보통</option>
                <option value="high">높음</option>
              </select>
              <input className="flex-1 px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e]" placeholder="관련 URL (선택)" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 border border-[#c4c5d5] rounded-lg text-xs hover:bg-[#f2f4f6]">취소</button>
              <button onClick={handleCreate} disabled={!title.trim() || !description.trim() || submitting} className="px-3 py-1.5 bg-[#00288e] text-white rounded-lg text-xs font-medium hover:bg-[#1e40af] disabled:opacity-50">
                {submitting ? "제출 중..." : "SR 생성"}
              </button>
            </div>
          </div>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f2f4f6]">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#9a9bad]">항목이 없습니다</div>
          ) : (
            filtered.map(sr => (
              <button
                key={sr.id}
                onClick={() => setSelectedId(sr.id)}
                className={`w-full text-left px-5 py-4 hover:bg-[#f7f9fb] transition-colors ${selectedId === sr.id ? "bg-[#eef2ff]" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#191c1e] truncate flex-1">{sr.title}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[sr.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
                    {TAB_LABELS[sr.status as Tab] ?? sr.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${sr.created_by_ai ? "bg-[#f0f0ff] text-[#4a4bdc]" : "bg-[#f2f4f6] text-[#757684]"}`}>
                    {sr.created_by_ai ? "챗봇" : "직접생성"}
                  </span>
                  {sr.jira_issue_key && (
                    <span className="text-[10px] text-[#757684] font-mono">{sr.jira_issue_key}</span>
                  )}
                  <span className="text-[10px] text-[#9a9bad] ml-auto">{new Date(sr.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 우측: 상세 패널 */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <SRDetail sr={selected} onRefetch={refetch} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[#9a9bad]">
            목록에서 항목을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}

function SRDetail({ sr, onRefetch }: { sr: SRDraft; onRefetch: () => void }) {
  const { user } = useAuth()
  const [activeSection, setActiveSection] = useState<"info" | "review" | "history">("info")
  const [reviewStep, setReviewStep] = useState<ReviewStep>(1)
  const [docMode, setDocMode] = useState<DocMode>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState(false)

  const { data: docData } = useApi(() => api.listDocuments(0, 500), [])
  const docs = docData?.documents ?? []

  const handleSubmitSR = async () => {
    setSubmittingId(true)
    try {
      await api.submitSR(sr.id)
      onRefetch()
    } finally {
      setSubmittingId(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h3 className="text-lg font-bold text-[#191c1e] flex-1">{sr.title}</h3>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_BADGE[sr.status] ?? "bg-[#f2f4f6] text-[#757684]"}`}>
          {TAB_LABELS[sr.status as Tab] ?? sr.status}
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${sr.created_by_ai ? "bg-[#f0f0ff] text-[#4a4bdc]" : "bg-[#f2f4f6] text-[#757684]"}`}>
          {sr.created_by_ai ? "챗봇" : "직접생성"}
        </span>
      </div>

      <div className="flex gap-1 border-b border-[#e0e3e5] mb-5">
        {([["info", "요청 정보"], ["review", "검토"], ["history", "변경 이력"]] as ["info" | "review" | "history", string][]).map(([s, label]) => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeSection === s ? "border-[#00288e] text-[#00288e]" : "border-transparent text-[#757684] hover:text-[#191c1e]"}`}>
            {label}
            {s === "review" && sr.status === "pending_doc_review" && (
              <span className="ml-1.5 w-2 h-2 rounded-full bg-[#f59e0b] inline-block" />
            )}
          </button>
        ))}
      </div>

      {activeSection === "info" && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-[#757684] mb-1">내용</p>
            <p className="text-[#191c1e] whitespace-pre-wrap bg-[#f7f9fb] p-3 rounded-lg border border-[#e0e3e5]">{sr.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-[#757684] text-xs">우선순위</span><p className="text-[#191c1e] mt-0.5 capitalize">{sr.priority}</p></div>
            <div><span className="text-[#757684] text-xs">요청 일시</span><p className="text-[#191c1e] mt-0.5">{new Date(sr.created_at).toLocaleString("ko-KR")}</p></div>
            {sr.jira_issue_key && (
              <div><span className="text-[#757684] text-xs">Jira 이슈</span>
                {sr.jira_issue_url ? (
                  <a href={sr.jira_issue_url} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline block mt-0.5">{sr.jira_issue_key}</a>
                ) : (
                  <p className="text-[#191c1e] mt-0.5">{sr.jira_issue_key}</p>
                )}
              </div>
            )}
            {sr.target_url && (
              <div><span className="text-[#757684] text-xs">대상 URL</span><a href={sr.target_url} target="_blank" rel="noopener noreferrer" className="text-[#00288e] hover:underline block mt-0.5 truncate">{sr.target_url}</a></div>
            )}
          </div>
          {sr.status === "draft" && (
            <div className="pt-2">
              <button onClick={handleSubmitSR} disabled={submittingId} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50">
                {submittingId ? "제출 중..." : "SR 제출"}
              </button>
            </div>
          )}
        </div>
      )}

      {activeSection === "review" && (
        <SRReview sr={sr} docs={docs} onRefetch={onRefetch} />
      )}

      {activeSection === "history" && (
        <ChangeHistoryTimeline entityType="sr" entityId={sr.id} />
      )}
    </div>
  )
}

function SRReview({ sr, docs, onRefetch }: { sr: SRDraft; docs: Document[]; onRefetch: () => void }) {
  const [step, setStep] = useState<ReviewStep>(1)
  const [docMode, setDocMode] = useState<DocMode>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [docQuery, setDocQuery] = useState("")
  const [generating, setGenerating] = useState(false)
  const [proposal, setProposal] = useState<{ original: string; proposed: string } | null>(null)
  const [applying, setApplying] = useState(false)

  if (sr.status !== "pending_doc_review") {
    return (
      <div className="text-sm text-[#9a9bad] py-4">
        {sr.status === "done"
          ? "이 SR은 이미 완료되었습니다."
          : "Jira 이슈가 완료된 후 검토 단계가 활성화됩니다."}
      </div>
    )
  }

  const filteredDocs = docs.filter(d => d.title.toLowerCase().includes(docQuery.toLowerCase()))

  return (
    <div className="space-y-6">
      {/* 스텝 인디케이터 */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as ReviewStep[]).map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              step > s ? "bg-[#15803d] text-white" : step === s ? "bg-[#00288e] text-white" : "bg-[#e0e3e5] text-[#9a9bad]"
            }`}>{step > s ? "✓" : s}</div>
            {s < 3 && <div className={`h-px w-8 ${step > s ? "bg-[#15803d]" : "bg-[#e0e3e5]"}`} />}
          </div>
        ))}
        <span className="ml-2 text-xs text-[#757684]">
          {step === 1 ? "반영 방식 선택" : step === 2 ? "문서 선택" : "AI 초안 검토"}
        </span>
      </div>

      {/* Step 1: 신규 작성 vs 기존 수정 */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-[#191c1e]">문서 반영 방식을 선택하세요</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setDocMode("new"); setStep(3) }}
              className="p-4 border-2 border-[#c4c5d5] rounded-xl text-left hover:border-[#00288e] transition-colors group"
            >
              <p className="text-sm font-semibold text-[#191c1e] group-hover:text-[#00288e]">신규 문서 작성</p>
              <p className="text-xs text-[#757684] mt-1">새 문서를 생성합니다</p>
            </button>
            <button
              onClick={() => { setDocMode("existing"); setStep(2) }}
              className="p-4 border-2 border-[#c4c5d5] rounded-xl text-left hover:border-[#00288e] transition-colors group"
            >
              <p className="text-sm font-semibold text-[#191c1e] group-hover:text-[#00288e]">기존 문서 수정</p>
              <p className="text-xs text-[#757684] mt-1">기존 문서에 반영합니다</p>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: 문서 선택 (기존 수정 선택 시) */}
      {step === 2 && docMode === "existing" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(1)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 뒤로</button>
            <p className="text-sm font-medium text-[#191c1e]">반영할 문서를 선택하세요</p>
          </div>
          <input
            className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm outline-none focus:border-[#00288e]"
            placeholder="문서 검색..."
            value={docQuery}
            onChange={e => setDocQuery(e.target.value)}
          />
          <div className="max-h-60 overflow-y-auto border border-[#e0e3e5] rounded-lg divide-y divide-[#f2f4f6]">
            {filteredDocs.map(doc => (
              <button
                key={doc.id}
                onClick={() => setSelectedDocId(doc.id)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-[#f7f9fb] transition-colors ${selectedDocId === doc.id ? "bg-[#eef2ff]" : ""}`}
              >
                <p className="font-medium text-[#191c1e]">{doc.title}</p>
                {doc.description && <p className="text-xs text-[#757684] mt-0.5 truncate">{doc.description}</p>}
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep(3)}
            disabled={!selectedDocId}
            className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50"
          >
            다음: AI 초안 생성
          </button>
        </div>
      )}

      {/* Step 3: AI 초안 확인 */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(docMode === "new" ? 1 : 2)} className="text-xs text-[#757684] hover:text-[#191c1e]">← 뒤로</button>
            <p className="text-sm font-medium text-[#191c1e]">
              {docMode === "new" ? "신규 문서 AI 초안" : `'${docs.find(d => d.id === selectedDocId)?.title}' 수정 초안`}
            </p>
          </div>
          {!proposal ? (
            <div className="text-center py-8">
              <p className="text-sm text-[#757684] mb-4">AI가 SR 내용을 바탕으로 문서 초안을 생성합니다.</p>
              <button
                onClick={async () => {
                  setGenerating(true)
                  try {
                    const result = await api.analyzeImpact({
                      source_type: "jira_sr",
                      source_id: sr.id,
                      related_document_ids: selectedDocId ? [selectedDocId] : undefined,
                    })
                    setProposal({ original: "기존 내용", proposed: result.reasoning })
                  } catch (e) {
                    // 에러 무시, UI에서 재시도 가능
                  } finally {
                    setGenerating(false)
                  }
                }}
                disabled={generating}
                className="px-5 py-2 bg-[#4a4bdc] text-white rounded-lg text-sm font-medium hover:bg-[#3b3cd0] disabled:opacity-50"
              >
                {generating ? "생성 중..." : "AI 초안 생성"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-[#757684] mb-2">AI 수정 제안</p>
                <pre className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap overflow-auto max-h-64">{proposal.proposed}</pre>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setApplying(true)
                    try {
                      await api.updateSRDraft(sr.id, { status: "done" })
                      onRefetch()
                    } finally {
                      setApplying(false)
                    }
                  }}
                  disabled={applying}
                  className="px-4 py-2 bg-[#15803d] text-white rounded-lg text-sm font-medium hover:bg-[#166534] disabled:opacity-50"
                >
                  {applying ? "반영 중..." : "문서에 반영"}
                </button>
                <button onClick={() => setProposal(null)} className="px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm hover:bg-[#f2f4f6]">
                  다시 생성
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: api.ts에 updateSRDraft status 필드 추가**

`frontend/src/lib/api.ts`에서 기존 `updateSRDraft` 시그니처를 찾아 `status` 필드 추가:

```typescript
// 기존 (153번 줄 근처)
updateSRDraft: (id: string, data: { title?: string; description?: string; priority?: string }) =>

// 변경 후
updateSRDraft: (id: string, data: { title?: string; description?: string; priority?: string; status?: string }) =>
```

- [ ] **Step 3: 타입체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 4: 브라우저에서 /sr 확인**

- 탭 5개 전환 동작
- 출처 필터 직접생성/챗봇 전환
- 항목 클릭 → 상세 패널
- draft 상태 항목 → "SR 제출" 버튼 동작
- pending_doc_review 상태 항목 → 검토 탭 활성화 → Step 1~3 흐름

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/ServiceRequests.tsx
git commit -m "feat: Jira SR 페이지 탭5개+출처필터+상세패널+검토스텝 구조로 재작성"
```

---

## Task 9: 린트·타입체크 최종 확인

**Files:** 없음 (검증 단계)

- [ ] **Step 1: 프론트엔드 전체 타입체크**

```bash
cd frontend && pnpm typecheck
```

Expected: 오류 없음

- [ ] **Step 2: 프론트엔드 린트**

```bash
cd frontend && pnpm lint
```

Expected: 오류 없음

- [ ] **Step 3: 백엔드 린트**

```bash
cd backend && uv run ruff check .
```

Expected: 오류 없음

- [ ] **Step 4: 백엔드 타입체크**

```bash
cd backend && uv run mypy app/models/history.py app/schemas/history.py app/services/history_service.py app/routers/history.py
```

Expected: 오류 없음 또는 알려진 무시 가능한 경고만

- [ ] **Step 5: 최종 커밋**

```bash
git add -A
git commit -m "chore: 문서 현행화 메뉴 재설계 최종 린트·타입 정리"
```

---

## 구현 요약

| Task | 내용 | 파일 수 |
|---|---|---|
| 1 | 네비게이션·라우팅 변경 | 2 |
| 2 | change_history 백엔드 | 5 |
| 3 | feedback status 필터 | 2 |
| 4 | api.ts 신규 메서드 | 1 |
| 5 | ChangeHistoryTimeline 컴포넌트 | 1 |
| 6 | 매뉴얼 생성 페이지 재작성 | 1 |
| 7 | 오류 제보 페이지 재작성 | 1 |
| 8 | Jira SR 페이지 재작성 | 1 |
| 9 | 최종 린트·타입체크 | 0 |
