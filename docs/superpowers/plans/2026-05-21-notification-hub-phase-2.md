# 알림 허브 Phase 2 — /notifications 페이지 + AI 초안 탭 자동 오픈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**전제:** Phase 1 (`docs/superpowers/plans/2026-05-21-notification-hub-phase-1.md`)이 머지/배포 완료된 상태에서 시작. Phase 1이 발행한 매뉴얼 완료 알림의 `link_path` 형식 `/manuals?job=<id>&tab=draft`이 본 Phase에서 활성화된다.

**Goal:** `/notifications` 알림 허브 페이지 신설로 종류별/읽음별 필터링 + 페이지네이션을 제공하고, `ManualGenerator`가 query string을 해석해 알림 클릭 즉시 해당 job의 AI 초안 탭을 자동 오픈하도록 한다.

**Architecture:** 백엔드는 기존 `GET /api/notifications`에 `type` / `unread_only` / `skip` / `limit` query 추가 + 응답 페이지네이션 구조로 확장. 프론트엔드는 신규 `Notifications.tsx` 페이지가 좌측 필터/상단 토글/페이지 본문으로 구성된다. `ManualGenerator`는 `useSearchParams()`로 URL → state 단방향 동기화.

**Tech Stack:** FastAPI · SQLAlchemy · React + Vite (TypeScript) · React Router 7

**Spec:** `docs/superpowers/specs/2026-05-21-notification-hub-design.md`

---

## File Structure

**Backend (modify):**
- `backend/app/routers/notifications.py` — `list_notifications` 시그니처 + 응답 모델 확장
- `backend/tests/test_notifications_list_filters.py` — 신규

**Frontend (create):**
- `frontend/src/pages/Notifications.tsx`

**Frontend (modify):**
- `frontend/src/App.tsx` — 라우트 추가
- `frontend/src/lib/api.ts` — `listNotifications` 시그니처 + `NotificationListResponse` 타입
- `frontend/src/hooks/useNotifications.ts` — 기존 사용처 영향 최소화로 갱신
- `frontend/src/components/NotificationBell.tsx` — 드롭다운 하단 "전체 보기" 링크
- `frontend/src/pages/ManualGenerator.tsx` — `useSearchParams` 해석

---

## Task 1: 백엔드 `GET /api/notifications` 필터/페이지네이션

**Files:**
- Modify: `backend/app/routers/notifications.py:92-103`
- Test: `backend/tests/test_notifications_list_filters.py` (신규)

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_notifications_list_filters.py` 생성:

```python
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User


@pytest.mark.asyncio
async def test_list_filters_by_type_and_unread(
    db_session: AsyncSession, async_client: AsyncClient
):
    user = User(
        id=uuid.uuid4(), email="u@e.com", name="u", role="admin", password_hash="x"
    )
    db_session.add(user)
    for i in range(3):
        db_session.add(
            Notification(
                user_id=user.id,
                type="manual_completed",
                title=f"m{i}",
                message="x",
                is_read=(i == 0),
            )
        )
    for i in range(2):
        db_session.add(
            Notification(
                user_id=user.id,
                type="document_converted",
                title=f"d{i}",
                message="x",
            )
        )
    await db_session.commit()

    headers = {"X-User-Id": str(user.id)}

    r = await async_client.get(
        "/api/notifications?type=manual_completed", headers=headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert all(n["type"] == "manual_completed" for n in body["items"])

    r = await async_client.get(
        "/api/notifications?unread_only=true", headers=headers
    )
    body = r.json()
    assert body["total"] == 4  # 2 unread manual + 2 unread doc
    assert all(n["is_read"] is False for n in body["items"])

    r = await async_client.get(
        "/api/notifications?skip=0&limit=2", headers=headers
    )
    body = r.json()
    assert len(body["items"]) == 2
    assert body["total"] == 5
```

`async_client` fixture는 기존 `backend/tests/conftest.py`에 있는 형태 사용. 없으면 conftest에서 정의된 동등한 클라이언트 사용 (e.g. `test_documents.py`에서 어떻게 호출하는지 참고).

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && uv run pytest tests/test_notifications_list_filters.py -v`
Expected: FAIL (응답이 list[Notification]이라 `body["total"]`이 KeyError 또는 422 query 미지원)

- [ ] **Step 3: `list_notifications` 시그니처 + 응답 모델 갱신**

`backend/app/routers/notifications.py` 의 다음 영역들을 변경.

`NotificationResponse` 정의 직후 (line 67 부근) 다음 응답 모델 추가:

```python
class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total: int
```

`list_notifications` 함수 (line 92-103) 전체를 다음으로 교체:

```python
@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    type: str | None = None,
    unread_only: bool = False,
    skip: int = 0,
    limit: int = 50,
    user_id: str = Depends(_get_user_id),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import func

    base = select(Notification).where(Notification.user_id == uuid.UUID(user_id))
    if type:
        base = base.where(Notification.type == type)
    if unread_only:
        base = base.where(Notification.is_read.is_(False))

    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    items_stmt = (
        base.order_by(Notification.is_read.asc(), Notification.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(items_stmt)
    items = [_serialize(n) for n in result.scalars().all()]

    return NotificationListResponse(items=items, total=total)
```

요점:
- 응답이 `{items, total}` 구조로 변경 — frontend 호출부도 함께 갱신해야 함 (Task 2에서 처리)
- query 4개 추가, 모두 기본값 있음 → backward compatibility는 응답 구조 변경에 의해 깨지므로 호출부 동시 갱신 전제

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && uv run pytest tests/test_notifications_list_filters.py -v`
Expected: PASS

- [ ] **Step 5: 기존 알림 테스트 회귀 확인**

Run: `cd backend && uv run pytest tests/ -k notification -v`
Expected: 기존 테스트도 PASS. 만약 `test_notifications_link_path.py`나 다른 테스트가 응답 구조 변경 영향 받으면 그 테스트도 함께 수정.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/notifications.py backend/tests/test_notifications_list_filters.py
git commit -m "feat(backend): paginate and filter GET /api/notifications

type, unread_only, skip, limit query params. Response shape changes
to { items, total } - frontend updated in same release."
```

---

## Task 2: 프론트 `listNotifications` 시그니처 + 응답 타입

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/hooks/useNotifications.ts`

- [ ] **Step 1: 응답 타입 + 호출 시그니처 갱신**

`frontend/src/lib/api.ts:268` 의 `listNotifications` 한 줄을 다음으로 교체:

```typescript
  listNotifications: (opts?: { type?: string; unread_only?: boolean; skip?: number; limit?: number }) => {
    const params = new URLSearchParams()
    if (opts?.type) params.set('type', opts.type)
    if (opts?.unread_only) params.set('unread_only', 'true')
    if (opts?.skip !== undefined) params.set('skip', String(opts.skip))
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return request<NotificationListResponse>(`/notifications${qs ? `?${qs}` : ''}`)
  },
```

타입 정의 영역(line 346 부근)에 다음 추가:

```typescript
export interface NotificationListResponse { items: Notification[]; total: number }
```

- [ ] **Step 2: `useNotifications` 호출부 갱신**

`frontend/src/hooks/useNotifications.ts:18-26` 의 `loadNotifications`을 다음으로 교체:

```typescript
  const loadNotifications = useCallback(async () => {
    if (!userId) return
    try {
      const data = await api.listNotifications({ limit: 50 })
      setNotifications(data.items)
    } catch {
      // 인증 실패 등 무시
    }
  }, [userId])
```

요점: `data` → `data.items`. 다른 사용처는 없음(NotificationBell은 prop으로 받음).

- [ ] **Step 3: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 4: 수동 회귀 — 벨 드롭다운**

dev 서버 기동 후 로그인 → 우측 상단 벨 클릭 → 기존 알림 미리보기 정상 표시 (응답 구조 변경 흡수 확인).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/useNotifications.ts
git commit -m "feat(frontend): adapt to paginated listNotifications response

NotificationListResponse { items, total } absorbed in useNotifications."
```

---

## Task 3: 신규 `Notifications.tsx` 페이지

**Files:**
- Create: `frontend/src/pages/Notifications.tsx`

- [ ] **Step 1: 파일 생성**

`frontend/src/pages/Notifications.tsx` 생성:

```typescript
import { useEffect, useMemo, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Bell, Clock, CheckCheck } from "lucide-react"
import { api, type Notification } from "@/lib/api"

type TypeFilter = "all" | "manual" | "feedback" | "jira_sr" | "other"

const PAGE_SIZE = 20

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "전체",
  manual: "매뉴얼",
  feedback: "오류 제보",
  jira_sr: "Jira SR",
  other: "기타",
}

function classify(t: string): Exclude<TypeFilter, "all"> {
  if (t.startsWith("manual")) return "manual"
  if (t.startsWith("feedback") || t === "conversion_failed" || t === "document_converted") return "feedback"
  if (t.startsWith("jira")) return "jira_sr"
  return "other"
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "방금"
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

export function Notifications() {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [counts, setCounts] = useState<Record<TypeFilter, number>>({
    all: 0, manual: 0, feedback: 0, jira_sr: 0, other: 0,
  })

  const load = useCallback(async () => {
    const data = await api.listNotifications({
      unread_only: unreadOnly,
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    })
    setItems(data.items)
    setTotal(data.total)
  }, [unreadOnly, page])

  const loadCounts = useCallback(async () => {
    const all = await api.listNotifications({ limit: 500 })
    const next: Record<TypeFilter, number> = { all: 0, manual: 0, feedback: 0, jira_sr: 0, other: 0 }
    next.all = all.total
    for (const n of all.items) {
      const k = classify(n.type)
      next[k] += 1
    }
    setCounts(next)
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadCounts() }, [loadCounts])

  const filtered = useMemo(() => {
    if (typeFilter === "all") return items
    return items.filter(n => classify(n.type) === typeFilter)
  }, [items, typeFilter])

  const handleClick = async (n: Notification) => {
    if (!n.is_read) {
      await api.markNotificationRead(n.id)
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    }
    if (n.link_path) navigate(n.link_path)
  }

  const markAll = async () => {
    await api.markAllNotificationsRead()
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex h-full">
      {/* Left filter sidebar */}
      <aside className="w-[220px] border-r border-[#e0e3e5] shrink-0 p-5 space-y-1">
        <h3 className="text-xs font-semibold text-[#444653] uppercase tracking-wider mb-3">종류</h3>
        {(Object.keys(TYPE_LABELS) as TypeFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
              typeFilter === f
                ? "bg-[#dde1ff] text-[#00288e] font-medium"
                : "text-[#444653] hover:bg-[#f7f9fb]"
            }`}
          >
            <span>{TYPE_LABELS[f]}</span>
            <span className="text-xs text-[#757684]">{counts[f]}</span>
          </button>
        ))}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#e0e3e5]">
          <div>
            <h2 className="text-2xl font-bold text-[#191c1e]">알림</h2>
            <p className="text-sm text-[#444653] mt-1">전체 알림을 종류별로 검토합니다.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-[#f2f4f6] rounded-lg p-0.5">
              <button
                onClick={() => { setUnreadOnly(false); setPage(0) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  !unreadOnly ? "bg-white text-[#191c1e] shadow-sm" : "text-[#757684]"
                }`}
              >전체</button>
              <button
                onClick={() => { setUnreadOnly(true); setPage(0) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  unreadOnly ? "bg-white text-[#191c1e] shadow-sm" : "text-[#757684]"
                }`}
              >미읽음</button>
            </div>
            <button
              onClick={markAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#00288e] hover:bg-[#dde1ff] rounded-lg transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              전체 읽음
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#757684]">
              <Bell className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">알림이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left bg-white border rounded-xl p-4 transition-shadow hover:shadow-md ${
                    n.is_read ? "border-[#e0e3e5] opacity-70" : "border-[#c4c5d5]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {!n.is_read && <div className="w-2 h-2 rounded-full bg-[#00288e] mt-2 shrink-0" />}
                    <div className={`flex-1 min-w-0 ${n.is_read ? "pl-5" : ""}`}>
                      <p className="text-sm font-semibold text-[#191c1e] truncate">{n.title}</p>
                      <p className="text-xs text-[#444653] mt-0.5 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-1 mt-2 text-[10px] text-[#757684]">
                        <Clock className="h-3 w-3" />
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-8 py-3 border-t border-[#e0e3e5]">
            <span className="text-xs text-[#757684]">총 {total}건</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40"
              >‹</button>
              <span className="text-xs text-[#444653] px-2">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => p + 1 < totalPages ? p + 1 : p)}
                disabled={page + 1 >= totalPages}
                className="px-2 py-1 text-xs border border-[#c4c5d5] rounded disabled:opacity-40"
              >›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

요점:
- 좌측: 종류 필터 (카운트 배지)
- 상단 우측: 전체/미읽음 토글 + 전체 읽음 버튼
- 본문: 알림 카드 리스트, 클릭 시 `markRead` + `navigate(link_path)`
- 페이지네이션: skip/limit 기반, "‹ / 1 / 2 / ›"

- [ ] **Step 2: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Notifications.tsx
git commit -m "feat(frontend): add /notifications hub page

종류별 필터, 미읽음 토글, 페이지네이션, 카드 클릭 → link_path 이동.
좌측 필터는 클라이언트 측 카운트, 본문은 backend pagination 사용."
```

---

## Task 4: 라우트 등록

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 라우트 추가**

`frontend/src/App.tsx`의 import에 다음 한 줄 추가 (다른 page import들 사이):

```typescript
import { Notifications } from "@/pages/Notifications"
```

`ProtectedRoutes` 안 라우트 목록에 다음 한 줄 추가 (line 50의 `/manuals` 이후, `/widget-conversations` 이전 권장):

```typescript
            <Route path="/notifications" element={<Notifications />} />
```

- [ ] **Step 2: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 3: 수동 검증**

브라우저에서 `/notifications` 진입 → 페이지 정상 렌더링. 좌측 필터 클릭 → 카운트와 본문 갱신.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): register /notifications route"
```

---

## Task 5: `NotificationBell` 드롭다운에 "전체 보기" 링크

**Files:**
- Modify: `frontend/src/components/NotificationBell.tsx`

- [ ] **Step 1: 드롭다운 하단에 링크 추가**

`frontend/src/components/NotificationBell.tsx` 의 알림 목록 `</div>` (line 116 정도, `</div>` 닫는 부분) 직전, 즉 `notifications` 맵 렌더링 직후 다음 블록을 추가:

먼저 import에 `Link` 추가:

```typescript
import { Link } from "react-router-dom"
```

드롭다운 컨테이너 닫기 직전(line 117 부근, `</div>` 직전)에 다음 추가:

```typescript
          {/* 전체 보기 풋터 */}
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center px-4 py-2.5 text-xs font-medium text-[#00288e] hover:bg-[#dde1ff] border-t border-[#e8e9ef]"
          >
            전체 알림 보기 →
          </Link>
```

최종 드롭다운 모습 (요지):

```tsx
{open && (
  <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-[#c4c5d5] rounded-xl shadow-xl z-50 overflow-hidden">
    {/* 헤더 */}
    <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8e9ef]">...</div>
    {/* 알림 목록 */}
    <div className="max-h-80 overflow-y-auto">...</div>
    {/* 전체 보기 풋터 */}
    <Link to="/notifications" onClick={() => setOpen(false)} className="...">
      전체 알림 보기 →
    </Link>
  </div>
)}
```

- [ ] **Step 2: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 3: 수동 검증**

벨 클릭 → 드롭다운 하단에 "전체 알림 보기 →" 노출 → 클릭 시 `/notifications` 이동, 드롭다운 닫힘.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/NotificationBell.tsx
git commit -m "feat(frontend): add 전체 알림 보기 link in NotificationBell"
```

---

## Task 6: `ManualGenerator` query string 해석 (AI 초안 탭 자동 오픈)

**Files:**
- Modify: `frontend/src/pages/ManualGenerator.tsx`

- [ ] **Step 1: 실패 테스트 작성 (RTL)**

이 프로젝트는 `pnpm test`/Vitest 셋업이 없으므로 RTL unit 대신 **Playwright e2e**로 검증. `frontend/e2e/manual-generator-deeplink.spec.ts` 신규:

```typescript
import { test, expect } from "@playwright/test"

test("ManualGenerator opens with job selected and draft tab when url has ?job=&tab=draft", async ({ page, request }) => {
  // 로그인 흐름 — 기존 테스트의 helpers 재사용. 없으면 다음과 동등:
  await page.goto("/login")
  await page.getByLabel(/email/i).fill("admin@example.com")
  await page.getByLabel(/password/i).fill("admin")
  await page.getByRole("button", { name: /login|로그인/ }).click()

  // 사전 조건: 최소 1건의 완료된 job이 필요. 기존 fixture/seed가 없으면 이 테스트는 skip 가능.
  // 본 테스트는 deeplink 해석 자체에 집중.
  const res = await request.get("/api/manual-jobs", { headers: { "X-User-Id": "00000000-0000-0000-0000-000000000001" } }).catch(() => null)
  test.skip(!res || !res.ok(), "no manual job fixture available")

  const jobs = await res!.json()
  const target = jobs.find((j: any) => j.status === "completed") ?? jobs[0]
  test.skip(!target, "no manual job to test deeplink against")

  await page.goto(`/manuals?job=${target.id}&tab=draft`)

  // 우측 상세 패널에서 선택된 job target_url이 헤더에 표시되는지
  await expect(page.getByRole("heading", { level: 3 })).toContainText(target.target_url)
  // "AI 초안" 탭이 활성화된 상태인지 (active 라벨 검출은 컬러 클래스로)
  const draftTab = page.getByRole("button", { name: "AI 초안" })
  await expect(draftTab).toBeVisible()
  await expect(draftTab).toHaveClass(/text-\[#00288e\]/)
})
```

이 테스트는 fixture 부재 시 skip되도록 작성. 진짜 검증은 수동 회귀가 주.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && pnpm exec playwright test e2e/manual-generator-deeplink.spec.ts -x`
Expected: FAIL (selectedId 미적용으로 "목록에서 항목을 선택하세요" 노출 또는 다른 selector 실패). fixture 없으면 skip.

- [ ] **Step 3: `useSearchParams` 통합 구현**

`frontend/src/pages/ManualGenerator.tsx` 의 import 상단에 추가:

```typescript
import { useSearchParams } from "react-router-dom"
```

`ManualGenerator` 함수 시작부(line 28-33 부근, `useState` 선언 직후)에 다음 추가하고, 기존 `useState<string | null>(null)` 라인은 그 위에 그대로 둠:

```typescript
  const [searchParams] = useSearchParams()
  const initialJobFromUrl = searchParams.get("job")
  const initialTabFromUrl = searchParams.get("tab")
```

기존 `useState`를 다음으로 교체:

```typescript
  const [selectedId, setSelectedId] = useState<string | null>(initialJobFromUrl)
```

`useEffect`로 jobs 로드 완료 후 URL에 명시된 job이 존재하는지 검증 (jobs 못 받은 상태에서 selectedId 만 채워두면 detail panel이 못 찾음). `useApi`로 받는 `jobs` 변경 시 보정:

`allJobs` 정의 직후에 다음 추가:

```typescript
  useEffect(() => {
    if (initialJobFromUrl && allJobs.some(j => j.id === initialJobFromUrl)) {
      setSelectedId(initialJobFromUrl)
    }
  }, [initialJobFromUrl, allJobs])
```

`ManualDetail` 컴포넌트에 `initialSection` prop을 받도록 시그니처 변경:

```typescript
function ManualDetail({ job, onRefetch, initialSection }: { job: ManualJob; onRefetch: () => void; initialSection?: "info" | "draft" | "history" }) {
```

함수 본체 첫 줄(line 219)을 다음으로 교체:

```typescript
  const [activeSection, setActiveSection] = useState<"info" | "draft" | "history">(initialSection ?? "info")
```

부모에서 `ManualDetail` 호출부(line 206)를 다음으로 교체:

```typescript
        {selected ? (
          <ManualDetail
            key={selected.id}
            job={selected}
            onRefetch={refetch}
            initialSection={initialTabFromUrl === "draft" ? "draft" : undefined}
          />
        ) : (
```

요점: `key={selected.id}`로 job 변경 시 컴포넌트 리마운트 → `initialSection`이 다시 적용됨. URL 단방향 동기화 — 사용자가 탭/job 직접 변경 시 URL은 갱신 안 함.

- [ ] **Step 4: 테스트 통과 확인 (fixture 있을 시)**

Run: `cd frontend && pnpm exec playwright test e2e/manual-generator-deeplink.spec.ts`
Expected: PASS (또는 fixture 없으면 skip)

- [ ] **Step 5: 수동 회귀**

1. 완료된 매뉴얼 job 1건 있는 상태에서 알림 발행
2. 다른 페이지(`/`)에서 우측 상단 벨의 알림 클릭 → URL이 `/manuals?job=<id>&tab=draft`로 이동
3. ManualGenerator 좌측 목록에서 해당 job이 선택 상태(`bg-[#eef2ff]`)
4. 우측 패널에 해당 job 상세 노출 + "AI 초안" 탭이 active로 표시
5. 패널의 다른 탭 클릭해도 URL은 그대로 (단방향)

- [ ] **Step 6: 타입 + 린트 확인**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/pages/ManualGenerator.tsx frontend/e2e/manual-generator-deeplink.spec.ts
git commit -m "feat(frontend): deep-link /manuals?job=&tab=draft to selected job + AI draft tab

URL → state 단방향 동기화. 알림 클릭 흐름의 종착점."
```

---

## 통합 검증 (모든 task 완료 후)

- [ ] **A. 백엔드 전체 테스트 통과**

Run: `cd backend && uv run pytest`
Expected: 모두 PASS

- [ ] **B. 프론트엔드 typecheck + lint 통과**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: 에러 없음

- [ ] **C. e2e 통과 (fixture 가능 시)**

Run: `cd frontend && pnpm exec playwright test`
Expected: PASS 또는 적절한 skip

- [ ] **D. 로컬 통합 시나리오**

1. 백엔드 + 프론트 dev 서버 기동
2. 로그인 후 매뉴얼 1건 생성, 다른 페이지로 이동
3. 백엔드 완료 처리 후 우측 하단 토스트 노출
4. 토스트 클릭 → `/manuals?job=<id>&tab=draft`로 이동, 해당 job 선택 + "AI 초안" 탭 active 자동 오픈
5. `/notifications` 직접 진입 → 알림 목록 + 종류 필터 + 미읽음 토글 동작
6. 좌측 필터 "매뉴얼" 선택 → 본문에 매뉴얼 알림만 노출, 카운트 일치
7. "전체 읽음" 클릭 → 모든 알림 회색 처리

- [ ] **E. PR 생성**

```bash
git push -u origin <branch>
gh pr create --title "feat: notification hub Phase 2 — /notifications page + manual draft deep-link" --body "$(cat <<'EOF'
## Summary
- /notifications 알림 허브 페이지 신설 (종류 필터, 미읽음 토글, 페이지네이션)
- GET /api/notifications에 type/unread_only/skip/limit query + { items, total } 응답
- ManualGenerator가 ?job=&tab=draft query 해석으로 알림 클릭 흐름 완성
- NotificationBell 드롭다운에 "전체 보기" 링크 추가

## Spec
docs/superpowers/specs/2026-05-21-notification-hub-design.md

## Test plan
- [ ] backend pytest 통과 (신규 필터 테스트 포함)
- [ ] frontend typecheck + lint 통과
- [ ] /notifications 종류별 필터 + 페이지네이션 동작
- [ ] 매뉴얼 완료 알림 클릭 → 해당 job + AI 초안 탭 자동 오픈
- [ ] 벨 드롭다운 "전체 보기" 클릭 → /notifications 이동

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done 정의

- Phase 2 task 1~6 모두 커밋됨
- 통합 검증 A~D 모두 PASS
- 알림 클릭 종착점이 의도된 위치(`/manuals` + job + draft 탭)에 정확히 도달
