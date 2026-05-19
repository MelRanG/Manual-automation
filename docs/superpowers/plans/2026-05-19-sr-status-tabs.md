# SR 상태 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SR 목록 페이지를 초안/진행중/완료 탭으로 분리하고 Approvals와 동일한 패턴으로 페이지네이션을 추가한다.

**Architecture:** 백엔드 `list_sr_drafts()`에 status 필터와 페이지네이션을 추가하고, 프론트엔드 `ServiceRequests.tsx`를 Approvals와 동일한 탭+배지+페이지네이션 패턴으로 재구성한다.

**Tech Stack:** Python FastAPI, SQLAlchemy async, pytest, React + TypeScript, Tailwind CSS

---

## 파일 구조

| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `backend/app/services/sr_service.py` | 수정 | `list_sr_drafts()` — status 필터, skip/limit, total 반환 |
| `backend/app/routers/sr.py` | 수정 | `GET /api/sr/drafts` — 파라미터 추가, 응답 형식 변경 |
| `backend/tests/test_sr.py` | 수정 | 필터/페이지네이션 테스트 5개 추가 |
| `frontend/src/lib/api.ts` | 수정 | `listSRDrafts` 시그니처 변경, `SRListResponse` 타입 추가 |
| `frontend/src/pages/ServiceRequests.tsx` | 수정 | 탭 3개 + 배지 + 페이지네이션 추가 |

---

### Task 1: 백엔드 — list_sr_drafts에 필터/페이지네이션 추가

**Files:**
- Modify: `backend/app/services/sr_service.py:195-200`
- Modify: `backend/app/routers/sr.py:59-64`
- Test: `backend/tests/test_sr.py`

- [ ] **Step 1: 테스트 작성**

`backend/tests/test_sr.py` 파일 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_status_filter_draft(client: AsyncClient, test_user: dict):
    await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Draft Filter Test",
        "description": "desc",
        "priority": "medium",
    })
    resp = await client.get("/api/sr/drafts", params={"status": "draft"})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert all(item["status"] == "draft" for item in data["items"])


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_status_filter_active(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Active Filter Test",
        "description": "desc",
        "priority": "medium",
    })
    sr_id = create_resp.json()["id"]
    await client.post(f"/api/sr/drafts/{sr_id}/submit")

    resp = await client.get("/api/sr/drafts", params={"status": "active"})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert all(item["status"] in ("submitted", "jira_created") for item in data["items"])


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_status_filter_done(client: AsyncClient, test_user: dict):
    resp = await client.get("/api/sr/drafts", params={"status": "done"})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert all(item["status"] in ("done_synced", "done_no_proposal") for item in data["items"])


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_pagination(client: AsyncClient, test_user: dict):
    resp = await client.get("/api/sr/drafts", params={"skip": 0, "limit": 2})
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert len(data["items"]) <= 2


@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts_total_count(client: AsyncClient, test_user: dict):
    resp_all = await client.get("/api/sr/drafts")
    total = resp_all.json()["total"]
    resp_p1 = await client.get("/api/sr/drafts", params={"skip": 0, "limit": 1})
    assert resp_p1.json()["total"] == total
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd backend
uv run pytest tests/test_sr.py::test_list_sr_drafts_status_filter_draft -v
```

Expected: FAIL — `assert "items" in data` (현재 응답이 list이므로)

- [ ] **Step 3: sr_service.py — list_sr_drafts 수정**

`backend/app/services/sr_service.py`의 `list_sr_drafts` 함수를 아래로 교체:

```python
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
        if statuses:
            stmt = stmt.where(SRDraft.status.in_(statuses))
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()
    stmt = stmt.order_by(SRDraft.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all()), total
```

파일 상단 `from sqlalchemy import select` 줄을 확인 — 이미 있으면 추가 불필요.

- [ ] **Step 4: sr.py — 엔드포인트 수정**

`backend/app/routers/sr.py`의 `list_sr_drafts` 엔드포인트를 아래로 교체:

```python
@router.get("/drafts")
async def list_sr_drafts(
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    items, total = await sr_service.list_sr_drafts(db, user_id, status, skip, limit)
    return {"items": items, "total": total}
```

기존 `response_model=list[SRDraftResponse]` 제거 (dict 반환이므로).

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
cd backend
uv run pytest tests/test_sr.py -v
```

Expected: 기존 테스트 + 신규 5개 모두 PASS

> 주의: 기존 `test_list_sr_drafts` 테스트가 `list` 응답을 기대하고 있으면 `resp.json()["items"]`로 수정 필요.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/sr_service.py backend/app/routers/sr.py backend/tests/test_sr.py
git commit -m "feat: SR 목록 API — status 필터, skip/limit, total 응답 추가"
```

---

### Task 2: 프론트엔드 — api.ts 타입 및 함수 수정

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: SRListResponse 타입 추가 및 listSRDrafts 수정**

`frontend/src/lib/api.ts`에서 `SRDraft` 타입 선언 아래에 추가:

```ts
export interface SRListResponse { items: SRDraft[]; total: number }
```

`listSRDrafts` 함수를 아래로 교체:

```ts
listSRDrafts: (params?: { status?: string; skip?: number; limit?: number; userId?: string }) => {
  const query = new URLSearchParams()
  if (params?.userId) query.set('user_id', params.userId)
  if (params?.status) query.set('status', params.status)
  if (params?.skip !== undefined) query.set('skip', String(params.skip))
  if (params?.limit !== undefined) query.set('limit', String(params.limit))
  const qs = query.toString()
  return request<SRListResponse>(`/sr/drafts${qs ? `?${qs}` : ''}`)
},
```

- [ ] **Step 2: 빌드 확인**

```bash
cd frontend
pnpm typecheck
```

Expected: 에러 없음. (ServiceRequests.tsx에서 `api.listSRDrafts()` 반환값을 `SRDraft[]`로 쓰고 있으면 타입 에러 발생 — Task 3에서 수정)

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: api.ts — listSRDrafts 파라미터/반환타입 변경"
```

---

### Task 3: 프론트엔드 — ServiceRequests.tsx 탭/배지/페이지네이션 추가

**Files:**
- Modify: `frontend/src/pages/ServiceRequests.tsx`

Approvals.tsx 패턴을 그대로 따른다. 탭은 `draft | active | done` 3개, 배지는 `active` 건수만 별도 쿼리.

- [ ] **Step 1: ServiceRequests.tsx 전체 교체**

`frontend/src/pages/ServiceRequests.tsx`를 아래 내용으로 교체:

```tsx
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { api, type SRDraft } from "@/lib/api"
import { useApi } from "@/hooks/useApi"
import { useAuth } from "@/contexts/AuthContext"

type Tab = "draft" | "active" | "done"

export function ServiceRequests() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab")
    return (t === "active" || t === "done") ? t : "draft"
  })
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("medium")
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: "", description: "", priority: "medium" })
  const [saving, setSaving] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const userId = user?.id ?? "00000000-0000-0000-0000-000000000001"

  // 탭 배지용: active 건수 항상 별도 조회
  const { data: activeData, refetch: refetchCount } = useApi(
    () => api.listSRDrafts({ status: "active", skip: 0, limit: 500 }),
    []
  )
  const activeCount = activeData?.total ?? 0

  const { data: result, refetch: refetchMain } = useApi(
    () => api.listSRDrafts({ status: tab, skip: (page - 1) * pageSize, limit: pageSize }),
    [tab, page]
  )

  const items = result?.items ?? []
  const total = result?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  const refetch = () => { refetchMain(); refetchCount() }

  const handleTabChange = (t: Tab) => {
    setTab(t)
    setPage(1)
    setEditingId(null)
    setSearchParams({ tab: t })
  }

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      await api.createSRDraft({ user_id: userId, title, description, priority })
      setTitle("")
      setDescription("")
      setShowCreate(false)
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (id: string) => {
    setSubmittingId(id)
    try {
      await api.submitSR(id)
      refetch()
    } finally {
      setSubmittingId(null)
    }
  }

  const handleEditStart = (sr: SRDraft) => {
    setEditingId(sr.id)
    setEditForm({ title: sr.title, description: sr.description, priority: sr.priority })
  }

  const handleEditSave = async () => {
    if (!editingId) return
    if (!editForm.title.trim() || !editForm.description.trim()) return
    setSaving(true)
    try {
      await api.updateSRDraft(editingId, editForm)
      setEditingId(null)
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const getPriorityStyle = (p: string) => {
    if (p === "critical") return "bg-[#ffdad6] text-[#93000a]"
    if (p === "high") return "bg-[#ffdbce] text-[#611e00]"
    return "bg-[#e6e8ea] text-[#444653]"
  }

  const getStatusLabel = (s: string) => {
    if (s === "done_synced") return "완료 동기화됨"
    if (s === "done_no_proposal") return "완료 (문서 없음)"
    if (s === "jira_created") return "Jira 생성됨"
    if (s === "submitted") return "제출됨"
    return "초안"
  }

  const getStatusStyle = (s: string) => {
    if (s === "done_synced") return "bg-[#d5e3fc] text-[#16a34a]"
    if (s === "done_no_proposal") return "bg-[#e6e8ea] text-[#444653]"
    if (s === "jira_created") return "bg-[#e8f0fe] text-[#1a56db]"
    if (s === "submitted") return "bg-[#d5e3fc] text-[#16a34a]"
    return "bg-[#e6e8ea] text-[#444653]"
  }

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: "draft", label: "초안" },
    { key: "active", label: "진행중" },
    { key: "done", label: "완료" },
  ]

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#191c1e]">서비스 요청</h2>
          <p className="text-sm text-[#444653] mt-1">Jira SR 초안을 생성하고 관리합니다.</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors shadow-sm"
        >
          <span className="material-symbols-outlined text-base">add</span>
          새 SR
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-[#00288e]/30 rounded-xl p-6 shadow-sm space-y-4">
          <input
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
            placeholder="SR 제목"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
            placeholder="상세 설명..."
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <select
            className="w-full px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none bg-white"
            value={priority}
            onChange={e => setPriority(e.target.value)}
          >
            <option value="lowest">최저</option>
            <option value="low">낮음</option>
            <option value="medium">보통</option>
            <option value="high">높음</option>
            <option value="critical">긴급</option>
          </select>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
              {submitting ? "생성 중..." : "초안 생성"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1 border-b border-[#e6e8ea]">
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-[#00288e] text-[#00288e]"
                : "border-transparent text-[#757684] hover:text-[#191c1e]"
            }`}
          >
            {label}
            {key === "active" && activeCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-[#00288e] text-white">
                {activeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SR 목록 */}
      {items.length === 0 ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-[#c4c5d5]">confirmation_number</span>
          <p className="mt-4 text-sm text-[#757684]">
            {tab === "draft" ? "작성 중인 SR이 없습니다" : tab === "active" ? "진행 중인 SR이 없습니다" : "완료된 SR이 없습니다"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((sr) => (
            <div key={sr.id} className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              {editingId === sr.id ? (
                <div className="space-y-3">
                  <input
                    className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  />
                  <textarea
                    className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
                    rows={3}
                    value={editForm.description}
                    onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  />
                  <select
                    className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none bg-white"
                    value={editForm.priority}
                    onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="lowest">최저</option>
                    <option value="low">낮음</option>
                    <option value="medium">보통</option>
                    <option value="high">높음</option>
                    <option value="critical">긴급</option>
                  </select>
                  <div className="flex gap-2">
                    <button onClick={handleEditSave} disabled={saving} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
                      {saving ? "저장 중..." : "저장"}
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-[#dde1ff] flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-lg text-[#00288e]">confirmation_number</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#191c1e]">{sr.title}</p>
                        {sr.created_by_ai && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#dde1ff] text-[#00288e]">
                            <span className="material-symbols-outlined text-[12px]">auto_awesome</span>
                            AI
                          </span>
                        )}
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
                      </div>
                      <p className="text-xs text-[#444653] mt-1 line-clamp-2">{sr.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${getPriorityStyle(sr.priority)}`}>
                          {sr.priority === "critical" ? "긴급" : sr.priority === "high" ? "높음" : sr.priority === "medium" ? "보통" : "낮음"}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusStyle(sr.status)}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {getStatusLabel(sr.status)}
                        </span>
                        <span className="text-[11px] text-[#757684]">{new Date(sr.created_at).toLocaleDateString("ko-KR")}</span>
                      </div>
                    </div>
                  </div>
                  {sr.status === "draft" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleEditStart(sr)} className="flex items-center gap-1 px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#444653] hover:bg-[#f2f4f6] transition-colors">
                        <span className="material-symbols-outlined text-base">edit</span>
                      </button>
                      <button
                        onClick={() => handleSubmit(sr.id)}
                        disabled={submittingId === sr.id}
                        className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-base">send</span>
                        {submittingId === sr.id ? "제출 중..." : "제출"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-[#757684]">전체 {total}건</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-[#c4c5d5] rounded-lg disabled:opacity-40 hover:bg-[#f2f4f6] transition-colors"
            >
              이전
            </button>
            <span className="text-sm text-[#444653]">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border border-[#c4c5d5] rounded-lg disabled:opacity-40 hover:bg-[#f2f4f6] transition-colors"
            >
              다음
            </button>
          </div>
        </div>
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

Expected: 에러 없음

- [ ] **Step 3: 린트**

```bash
cd frontend
pnpm lint
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/ServiceRequests.tsx
git commit -m "feat: SR 목록 — 초안/진행중/완료 탭, 배지, 페이지네이션 추가"
```

---

### Task 4: 기존 test_list_sr_drafts 호환성 수정

기존 테스트가 `list` 응답을 기대하므로 `items` 키로 접근하도록 수정.

**Files:**
- Modify: `backend/tests/test_sr.py`

- [ ] **Step 1: 기존 test_list_sr_drafts 수정**

`test_list_sr_drafts` 함수에서 응답 접근 방식 확인 후 수정:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_list_sr_drafts(client: AsyncClient, test_user: dict):
    await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "List Test",
        "description": "desc",
        "priority": "medium",
    })
    resp = await client.get("/api/sr/drafts")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert any(item["title"] == "List Test" for item in data["items"])
```

- [ ] **Step 2: 전체 테스트 실행**

```bash
cd backend
uv run pytest tests/test_sr.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 3: 커밋**

```bash
git add backend/tests/test_sr.py
git commit -m "fix: test_list_sr_drafts — items/total 응답 구조에 맞게 수정"
```
