# 빈 대화 미저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat 페이지와 Widget 에서 메시지가 한 건도 없는 `chat_sessions` row 가 생성되지 않도록 한다 (lazy create). 기존 빈 세션은 마이그레이션으로 정리하고, 회귀 방어를 위해 list 엔드포인트에 `EXISTS message` 필터를 추가한다.

**Architecture:** 클라이언트가 첫 메시지 전송 직전까지 `POST /sessions` 호출을 미룬다. 백엔드는 1회성 cleanup 마이그레이션과 list 쿼리 필터만 추가. 엔드포인트 시그니처는 그대로.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async) + Alembic, React + Vite + TypeScript, pytest-asyncio (loop_scope="session"), pnpm.

**Spec:** `docs/superpowers/specs/2026-05-21-empty-conversations-design.md`

---

## File Structure

**Backend (modify):**
- `backend/app/services/chat_service.py` — `list_sessions` 쿼리에 `EXISTS message` 필터 추가
- `backend/app/routers/widget.py` — `admin_list_widget_sessions` 쿼리에 동일 필터
- `backend/tests/test_chat.py` — `test_list_sessions_excludes_empty` 추가
- `backend/tests/test_widget.py` — `test_widget_admin_list_excludes_empty` 추가

**Backend (create):**
- `backend/alembic/versions/<rev>_drop_empty_chat_sessions.py` — 1회성 cleanup migration

**Frontend (modify):**
- `frontend/src/lib/chatAdapters.ts` — `ChatApiAdapter` 에 `ensureSession?` 추가, `buildChatAdapter` 에 구현
- `frontend/src/hooks/useChatSession.ts` — `send()` 안에서 sessionId null 이면 `ensureSession()` 호출, `onSessionCreated` 콜백 prop
- `frontend/src/pages/Chat.tsx` — `createSession()` → `startDraft()` 로 교체, `isDrafting` state, `onSessionCreated` 핸들러
- `frontend/src/widget/main.ts` — `initSession()` 에서 POST 제거, `send()` 안에서 lazy `createSession()`, `loadHistory()` 404 처리

---

## Task 1: Backend — `list_sessions` 빈 세션 제외 필터 (TDD)

**Files:**
- Modify: `backend/app/services/chat_service.py:88-94`
- Modify: `backend/tests/test_chat.py` (테스트 추가)

- [ ] **Step 1: Write the failing test**

`backend/tests/test_chat.py` 끝에 다음 테스트 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_list_sessions_excludes_empty(client: AsyncClient, test_user: dict):
    # 메시지가 없는 빈 세션 생성
    empty_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
        "title": "Empty Session",
    })
    assert empty_resp.status_code == 201
    empty_id = empty_resp.json()["id"]

    # 메시지가 있는 세션 생성 (문서 등록 후 ask)
    await client.post("/api/documents", json={
        "title": "Leave Policy",
        "description": "HR",
        "owner_id": test_user["id"],
    }, params={"content": "Employees get 20 days paid leave."})
    sess_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
        "title": "Has Message",
    })
    sess_id = sess_resp.json()["id"]
    ask_resp = await client.post(f"/api/chat/sessions/{sess_id}/ask", json={
        "question": "How many leave days?",
    })
    assert ask_resp.status_code == 200

    # list 응답에서 빈 세션은 없어야 함
    list_resp = await client.get("/api/chat/sessions", params={"user_id": test_user["id"]})
    assert list_resp.status_code == 200
    ids = [s["id"] for s in list_resp.json()]
    assert sess_id in ids
    assert empty_id not in ids
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/test_chat.py::test_list_sessions_excludes_empty -v
```

Expected: FAIL — assertion `empty_id not in ids` fails because current `list_sessions` returns all sessions.

- [ ] **Step 3: Add EXISTS filter to `list_sessions`**

`backend/app/services/chat_service.py` 의 `list_sessions` 함수 교체:

```python
async def list_sessions(db: AsyncSession, user_id: uuid.UUID) -> list[ChatSession]:
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user_id)
        .where(
            select(ChatMessage.id)
            .where(ChatMessage.session_id == ChatSession.id)
            .exists()
        )
        .order_by(ChatSession.created_at.desc())
    )
    return list(result.scalars().all())
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && uv run pytest tests/test_chat.py::test_list_sessions_excludes_empty -v
```

Expected: PASS. 함께 기존 `test_list_chat_sessions` 가 깨질 수 있음 — 그 테스트는 빈 세션을 만든 후 list 로 검증하므로 수정 필요.

- [ ] **Step 5: Fix existing `test_list_chat_sessions`**

해당 테스트는 빈 세션 하나만 만든 후 `len(...) >= 1` 을 단언한다. 빈 세션 제외 정책상 list 는 비어있을 수 있다. 테스트를 다음과 같이 수정:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_list_chat_sessions(client: AsyncClient, test_user: dict):
    # 문서 + ask 로 메시지 있는 세션 보장
    await client.post("/api/documents", json={
        "title": "Doc for list",
        "description": "x",
        "owner_id": test_user["id"],
    }, params={"content": "content"})
    sess_resp = await client.post("/api/chat/sessions", json={
        "user_id": test_user["id"],
    })
    sess_id = sess_resp.json()["id"]
    await client.post(f"/api/chat/sessions/{sess_id}/ask", json={
        "question": "anything?",
    })
    resp = await client.get("/api/chat/sessions", params={"user_id": test_user["id"]})
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert sess_id in ids
```

- [ ] **Step 6: Run full chat tests**

```bash
cd backend && uv run pytest tests/test_chat.py -v
```

Expected: 모든 케이스 PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/chat_service.py backend/tests/test_chat.py
git commit -m "feat(chat): exclude empty sessions from list_sessions"
```

---

## Task 2: Backend — Widget admin list 빈 세션 제외 필터 (TDD)

**Files:**
- Modify: `backend/app/routers/widget.py:102-142`
- Modify: `backend/tests/test_widget.py` (테스트 추가)

- [ ] **Step 1: Inspect existing `test_widget.py` for fixtures/style**

```bash
cd backend && head -40 tests/test_widget.py
```

기존 테스트 패턴을 따라야 한다. 핵심: `client: AsyncClient` fixture + `pytest.mark.asyncio(loop_scope="session")`.

- [ ] **Step 2: Write the failing test**

`backend/tests/test_widget.py` 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_widget_admin_list_excludes_empty(client: AsyncClient):
    # 메시지 없는 widget 세션 1개 생성
    empty_resp = await client.post("/api/widget/sessions", json={
        "site_id": "test-site",
        "anonymous_id": "anon-empty",
    })
    assert empty_resp.status_code == 201
    empty_id = empty_resp.json()["id"]

    # 메시지 있는 widget 세션 1개 생성 + ask
    await client.post("/api/documents", json={
        "title": "Widget Doc",
        "description": "x",
        "owner_id": "00000000-0000-0000-0000-000000000099",  # widget user
    }, params={"content": "Widget content for RAG."})
    full_resp = await client.post("/api/widget/sessions", json={
        "site_id": "test-site",
        "anonymous_id": "anon-full",
    })
    full_id = full_resp.json()["id"]
    # widget ask-stream 은 SSE 라 호출만으로 충분
    async with client.stream("POST", f"/api/widget/sessions/{full_id}/ask-stream",
                              json={"question": "what?"}) as resp:
        async for _ in resp.aiter_bytes():
            pass

    admin_resp = await client.get("/api/widget/admin/sessions")
    assert admin_resp.status_code == 200
    ids = [s["id"] for s in admin_resp.json()]
    assert full_id in ids
    assert empty_id not in ids
```

만약 widget 의 `owner_id` 가 widget user 가 아니라 문서 owner 검증이 까다롭다면, 위 `/api/documents` 부분을 기존 fixture 의 test_user 로 만들고 widget 답변은 RAG context 없어도 통과하도록 단순화한다. 본 plan 상으로는 widget admin list 가 메시지 row 존재 여부만 보면 되므로, 문서 등록은 생략 가능. **단순안 (권장):**

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_widget_admin_list_excludes_empty(client: AsyncClient):
    empty_resp = await client.post("/api/widget/sessions", json={
        "site_id": "site-empty",
        "anonymous_id": "anon-empty",
    })
    empty_id = empty_resp.json()["id"]

    full_resp = await client.post("/api/widget/sessions", json={
        "site_id": "site-full",
        "anonymous_id": "anon-full",
    })
    full_id = full_resp.json()["id"]
    # DB 에 직접 메시지 row 만들어 "메시지 있음" 상태 만듦
    from app.models.chat import ChatMessage
    from app.db import async_session_maker
    import uuid as _uuid
    async with async_session_maker() as db:
        db.add(ChatMessage(id=_uuid.uuid4(), session_id=_uuid.UUID(full_id),
                            role="user", content="hi"))
        await db.commit()

    admin_resp = await client.get("/api/widget/admin/sessions")
    ids = [s["id"] for s in admin_resp.json()]
    assert full_id in ids
    assert empty_id not in ids
```

**주의:** `async_session_maker` 이름이 다를 수 있음. `backend/app/db.py` 의 실제 export 이름 확인 후 사용 (예: `AsyncSessionLocal`).

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && uv run pytest tests/test_widget.py::test_widget_admin_list_excludes_empty -v
```

Expected: FAIL — empty_id 가 admin list 에 포함됨.

- [ ] **Step 4: Add EXISTS filter to `admin_list_widget_sessions`**

`backend/app/routers/widget.py` 의 `admin_list_widget_sessions` 쿼리에 필터 추가:

```python
@router.get("/admin/sessions", response_model=list[WidgetSessionAdmin])
async def admin_list_widget_sessions(
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.title.like("widget:%"))
        .where(
            select(ChatMessage.id)
            .where(ChatMessage.session_id == ChatSession.id)
            .exists()
        )
        .order_by(ChatSession.created_at.desc())
        .limit(50)
    )
    sessions = result.scalars().all()
    # 이하 기존 로직 동일
    ...
```

이미 import 된 `select`, `ChatMessage` 사용. 나머지 본문은 그대로.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && uv run pytest tests/test_widget.py::test_widget_admin_list_excludes_empty -v
```

Expected: PASS.

- [ ] **Step 6: Run full widget tests**

```bash
cd backend && uv run pytest tests/test_widget.py -v
```

Expected: 모두 PASS. 기존 widget 테스트가 빈 세션 list 를 단언하면 수정 필요.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/widget.py backend/tests/test_widget.py
git commit -m "feat(widget): exclude empty sessions from admin list"
```

---

## Task 3: Backend — Cleanup migration

**Files:**
- Create: `backend/alembic/versions/e1f2a3b4c5d6_drop_empty_chat_sessions.py`

- [ ] **Step 1: Verify migration head**

```bash
cd backend && uv run alembic heads
```

Expected: `7de9b05a3c28 (head)` 가 단일 head 로 나옴. 만약 다른 head 가 있으면 작업 중단하고 사용자에게 보고.

- [ ] **Step 2: Create migration file**

`backend/alembic/versions/e1f2a3b4c5d6_drop_empty_chat_sessions.py`:

```python
"""drop empty chat sessions

Revision ID: e1f2a3b4c5d6
Revises: 7de9b05a3c28
Create Date: 2026-05-21 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "7de9b05a3c28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM chat_sessions
         WHERE id NOT IN (
           SELECT DISTINCT session_id FROM chat_messages
            WHERE session_id IS NOT NULL
         )
        """
    )


def downgrade() -> None:
    # Irreversible cleanup; nothing to restore.
    pass
```

- [ ] **Step 3: Apply migration locally**

```bash
cd backend && uv run alembic upgrade head
```

Expected: 실패 없이 head 가 `e1f2a3b4c5d6` 로 이동. `alembic current` 로 확인.

- [ ] **Step 4: Verify deletion**

```bash
cd backend && uv run python -c "
import asyncio
from sqlalchemy import select, func
from app.db import async_session_maker
from app.models.chat import ChatSession, ChatMessage

async def main():
    async with async_session_maker() as db:
        total = (await db.execute(select(func.count(ChatSession.id)))).scalar()
        empties = (await db.execute(
            select(func.count(ChatSession.id)).where(
                ~select(ChatMessage.id).where(ChatMessage.session_id == ChatSession.id).exists()
            )
        )).scalar()
        print(f'sessions={total} empties={empties}')

asyncio.run(main())
"
```

Expected: `empties=0`. `async_session_maker` 이름이 다르면 실제 export 이름으로 교체.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/e1f2a3b4c5d6_drop_empty_chat_sessions.py
git commit -m "feat(db): drop empty chat sessions migration"
```

---

## Task 4: Frontend — `useChatSession` lazy create 지원

**Files:**
- Modify: `frontend/src/lib/chatAdapters.ts` (interface + buildChatAdapter)
- Modify: `frontend/src/hooks/useChatSession.ts` (send + new prop)

- [ ] **Step 1: Add `ensureSession` to adapter interface**

`frontend/src/lib/chatAdapters.ts` 의 `ChatApiAdapter` 인터페이스 수정:

```typescript
import { api, type ChatMessage, type StreamEvent, type ChatSession } from "@/lib/api"
// ...

export interface ChatApiAdapter {
  getMessages(sessionId: string): Promise<ChatMessage[]>
  askStream(sessionId: string, question: string): AsyncIterable<StreamEvent>
  /** Lazy-create a session on first send. Returns the created session. */
  ensureSession?(): Promise<ChatSession>
  submitSR?(draftId: string): Promise<{ jira_issue_key?: string }>
  submitFeedback?(payload: FeedbackPayload): Promise<FeedbackResult>
}
```

- [ ] **Step 2: Implement `ensureSession` in `buildChatAdapter`**

같은 파일 `buildChatAdapter` 수정:

```typescript
export function buildChatAdapter(userId: string): ChatApiAdapter {
  return {
    getMessages: (id) => api.getMessages(id),
    askStream: (id, q) => api.askQuestionStream(id, q),
    ensureSession: () => api.createSession(userId),
    submitSR: (draftId) => api.submitSR(draftId),
    submitFeedback: (payload) =>
      api.createFeedback({ ...payload, user_id: userId }) as Promise<FeedbackResult>,
  }
}
```

Widget adapter 는 자체 path 사용하므로 미구현 (optional).

- [ ] **Step 3: Verify `ChatSession` is exported from `@/lib/api`**

```bash
grep -n "export.*ChatSession" frontend/src/lib/api.ts
```

Expected: `ChatSession` 타입이 export 됨. 없으면 export 추가.

- [ ] **Step 4: Add `onSessionCreated` to `useChatSession`**

`frontend/src/hooks/useChatSession.ts:9-15` 의 `UseChatSessionArgs` 수정:

```typescript
import type { ChatSession, ... } from "@/lib/api"  // ChatSession 추가

export interface UseChatSessionArgs {
  sessionId: string | null
  userId: string | null
  api: ChatApiAdapter
  /** Called after lazy-create. Parent must reflect this in sidebar + activeSession. */
  onSessionCreated?: (session: ChatSession) => void
}
```

함수 시그니처에 prop 받기:

```typescript
export function useChatSession({ sessionId, api, onSessionCreated }: UseChatSessionArgs): ChatSessionState {
```

- [ ] **Step 5: Add `isCreating` guard and lazy create in `send`**

`useChatSession.ts:52-58` 에 state 추가:

```typescript
const [isCreating, setIsCreating] = useState(false)
```

`send` callback 의 시작부 수정 (기존 `if (!input.trim() || !sessionId) return` 교체):

```typescript
const send = useCallback(async () => {
  if (!input.trim() || isCreating) return
  let activeSessionId = sessionId
  if (!activeSessionId) {
    if (!api.ensureSession) return
    setIsCreating(true)
    try {
      const created = await api.ensureSession()
      activeSessionId = created.id
      onSessionCreated?.(created)
    } catch {
      setIsCreating(false)
      return
    } finally {
      setIsCreating(false)
    }
  }
  inFlightRef.current = true
  // ... 이하 기존 로직, 단 sessionId 대신 activeSessionId 사용
```

`send` 내부 모든 `sessionId` 참조를 `activeSessionId` 로 교체 (userMsg/botMsg 의 `session_id`, `api.askStream(sessionId, question)`). 의존성 배열 업데이트:

```typescript
}, [input, sessionId, chatMode, api, isCreating, onSessionCreated])
```

- [ ] **Step 6: Typecheck**

```bash
cd frontend && pnpm typecheck
```

Expected: 통과. 에러 시 import 누락 / 타입 미스 수정.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/chatAdapters.ts frontend/src/hooks/useChatSession.ts
git commit -m "feat(chat): lazy-create session on first send"
```

---

## Task 5: Frontend — `Chat.tsx` draft 상태

**Files:**
- Modify: `frontend/src/pages/Chat.tsx`

- [ ] **Step 1: Replace `createSession` with `startDraft` and add `isDrafting` state**

`Chat.tsx:8-12` 에 state 추가:

```typescript
const [isDrafting, setIsDrafting] = useState(false)
```

`createSession` 함수 (`Chat.tsx:31-37`) 를 다음으로 교체:

```typescript
const startDraft = () => {
  setActiveSession(null)
  setIsDrafting(true)
  chat.resetAll()
}
```

- [ ] **Step 2: Wire `onSessionCreated` into `useChatSession`**

`Chat.tsx:19-23` 의 `useChatSession` 호출 수정:

```typescript
const chat = useChatSession({
  sessionId: activeSession,
  userId: user?.id ?? null,
  api: adapter,
  onSessionCreated: (session) => {
    setSessions(prev => [session, ...prev])
    setActiveSession(session.id)
    setIsDrafting(false)
  },
})
```

- [ ] **Step 3: Update sidebar "new chat" button + start CTA**

`Chat.tsx:113-114` (사이드바 edit_square 버튼) 의 `onClick={createSession}` 를 `onClick={startDraft}` 로 교체.

`Chat.tsx:142-147` (empty state "새 대화 시작" 버튼) 의 `onClick={createSession}` 도 `onClick={startDraft}` 로 교체.

- [ ] **Step 4: Update right-pane render branch**

`Chat.tsx:139-151` 의 조건 분기 교체:

```tsx
{!activeSession && !isDrafting ? (
  <div className="flex-1 flex flex-col items-center justify-center bg-[#f7f9fb] py-8">
    {emptyState}
    <button
      onClick={startDraft}
      className="mt-6 bg-[#00288e] text-white text-sm font-semibold rounded-lg px-5 py-2.5 hover:bg-[#1e40af] transition-colors shadow-sm flex items-center gap-2"
    >
      <span className="material-symbols-outlined text-base">add</span>새 대화 시작
    </button>
  </div>
) : (
  <ChatPanel chat={chat} variant="full" emptyState={emptyState} />
)}
```

- [ ] **Step 5: Discard draft on session select**

`Chat.tsx:79` 의 사이드바 entry `onClick={() => setActiveSession(s.id)}` 를:

```typescript
onClick={() => {
  setActiveSession(s.id)
  setIsDrafting(false)
}}
```

- [ ] **Step 6: Discard draft on session delete (active match)**

`Chat.tsx:45-48` `deleteSession` 내 `if (activeSession === sessionId)` 블록에 `setIsDrafting(false)` 추가:

```typescript
if (activeSession === sessionId) {
  setActiveSession(null)
  setIsDrafting(false)
  chat.resetAll()
}
```

- [ ] **Step 7: Typecheck + lint**

```bash
cd frontend && pnpm typecheck && pnpm lint
```

Expected: 통과.

- [ ] **Step 8: Manual verification — Chat page**

```bash
cd backend && uv run fastapi dev &
cd frontend && pnpm dev
```

브라우저 `http://localhost:5173/chat` 접속. DevTools Network 탭 열고:

1. 사이드바 "edit_square" 클릭 → POST `/api/chat/sessions` **호출 없음** 확인. 우측 패널에 입력창 노출.
2. 메시지 입력 후 send → POST `/api/chat/sessions` + POST `/api/chat/sessions/{id}/ask-stream` 둘 다 발생. 사이드바 최상단에 새 entry 표시.
3. 다른 세션 클릭 → 입력창 비워지고 해당 세션 메시지 표시. draft 폐기.
4. 새 대화 → 메시지 입력 없이 다른 세션 클릭 → 사이드바에 빈 entry 미생성 확인.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Chat.tsx
git commit -m "feat(chat): draft state for empty conversations"
```

---

## Task 6: Frontend — Widget lazy create

**Files:**
- Modify: `frontend/src/widget/main.ts`

- [ ] **Step 1: Add `isCreating` field and remove POST from `initSession`**

`widget/main.ts:53-69` (`WidgetApp` 클래스) 에 필드 추가:

```typescript
private isCreating = false
```

`initSession` 메서드 (`main.ts:138-150`) 를 다음으로 교체:

```typescript
private startDraft() {
  this.messages = []
  this.renderMessages()
  this.addBotMessage("안녕하세요! 무엇을 도와드릴까요?")
}
```

- [ ] **Step 2: Update `toggle()` to use `startDraft` + `loadHistory`**

`main.ts:127-136` 의 `toggle` 메서드를:

```typescript
private async toggle() {
  this.isOpen = !this.isOpen
  this.panel!.classList.toggle("hidden", !this.isOpen)

  if (!this.isOpen) return
  if (this.sessionId && this.messages.length === 0) {
    await this.loadHistory()
  } else if (!this.sessionId && this.messages.length === 0) {
    this.startDraft()
  }
}
```

- [ ] **Step 3: Lazy create in `send`**

`main.ts:161-194` `send` 메서드 시작부 교체:

```typescript
private async send() {
  const question = this.inputEl!.value.trim()
  if (!question || this.isStreaming || this.isCreating) return

  if (!this.sessionId) {
    this.isCreating = true
    try {
      const anonymousId = localStorage.getItem(`docops_anon_${this.config.siteId}`)
        || Math.random().toString(36).slice(2, 10)
      localStorage.setItem(`docops_anon_${this.config.siteId}`, anonymousId)
      const session = await createSession(this.config, anonymousId)
      this.sessionId = session.id
      this.saveSession()
    } catch {
      this.addBotMessage("연결에 실패했습니다. 잠시 후 다시 시도해주세요.")
      this.isCreating = false
      return
    } finally {
      this.isCreating = false
    }
  }

  this.inputEl!.value = ""
  this.isStreaming = true
  // ... 이하 기존 로직 그대로 (this.messages.push user/bot, askStream 루프)
```

`send` 내부 `this.sessionId` 참조는 lazy create 이후 보장되므로 변경 없음 (non-null 단언 `!` 필요 시 사용).

- [ ] **Step 4: Handle 404 in `loadHistory`**

`main.ts:152-159` `loadHistory` 메서드를:

```typescript
private async loadHistory() {
  if (!this.sessionId) return
  try {
    const msgs = await getMessages(this.config, this.sessionId)
    this.messages = msgs
    this.renderMessages()
    if (msgs.length === 0) {
      this.addBotMessage("안녕하세요! 무엇을 도와드릴까요?")
    }
  } catch {
    // Session was cleaned up server-side. Reset and restart as draft.
    localStorage.removeItem(`docops_widget_${this.config.siteId}`)
    this.sessionId = null
    this.messages = []
    this.startDraft()
  }
}
```

**참고:** `widget/api.ts` 의 `getMessages` 가 404 에 throw 하는지 확인 필요. 만약 throw 안 하면 명시 처리 추가:

```bash
grep -n "getMessages\|res.ok" frontend/src/widget/api.ts
```

- [ ] **Step 5: Typecheck + build**

```bash
cd frontend && pnpm typecheck && pnpm build
```

Expected: 통과.

- [ ] **Step 6: Manual verification — Widget**

backend + frontend dev 서버 띄우고 `http://localhost:5173/widget-demo` (또는 widget script embed 페이지) 접속:

1. 위젯 토글 열기 → POST `/api/widget/sessions` **호출 없음** 확인 (Network 탭). greeting 표시.
2. 메시지 입력 → send → POST `/api/widget/sessions` + POST `/api/widget/sessions/{id}/ask-stream` 둘 다 발생. 응답 정상.
3. 페이지 새로고침 → 위젯 다시 열기 → `GET /api/widget/sessions/{id}/messages` 호출 + 메시지 복원.
4. localStorage 에서 sessionId 수동 변경 (존재하지 않는 UUID) → 새로고침 → 위젯 열기 → 404 → greeting 으로 복귀, localStorage 초기화 확인.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/widget/main.ts
git commit -m "feat(widget): lazy-create session on first message"
```

---

## Task 7: Verification & wrap-up

- [ ] **Step 1: Run backend full test suite**

```bash
cd backend && uv run pytest tests/test_chat.py tests/test_widget.py tests/test_chat_service.py -v
```

Expected: 모두 PASS.

- [ ] **Step 2: Run lint/typecheck**

```bash
cd backend && uv run ruff check && uv run mypy .
cd frontend && pnpm lint && pnpm typecheck
```

Expected: 모두 통과.

- [ ] **Step 3: Verify migration applied + no empty sessions remain**

```bash
cd backend && uv run alembic current
```

Expected: `e1f2a3b4c5d6 (head)`.

- [ ] **Step 4: Verify list/admin endpoints**

```bash
# 빈 세션 강제 생성
curl -s -X POST http://localhost:8000/api/chat/sessions \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"<test-uuid>","title":"manual empty"}'

# list 응답에 미포함 확인
curl -s "http://localhost:8000/api/chat/sessions?user_id=<test-uuid>" | jq '.[] | .title'
```

Expected: "manual empty" 미포함.

- [ ] **Step 5: Final commit (if any pending)**

이 시점에 미커밋 변경이 없어야 정상.

```bash
git status
```

Expected: clean working tree.

---

## Self-Review

**Spec coverage:**
- Frontend Chat.tsx draft 상태 → Task 5 ✓
- Frontend useChatSession ensureSession → Task 4 ✓
- Frontend widget lazy create + 404 처리 → Task 6 ✓
- Backend list_sessions EXISTS 필터 → Task 1 ✓
- Backend admin widget list 필터 → Task 2 ✓
- 1회성 migration → Task 3 ✓
- 엣지케이스 1 (LLM 실패) — 별도 코드 변경 없이 EXISTS 필터로 자동 흡수 ✓
- 엣지케이스 2 (race) → Task 4 `isCreating`, Task 6 `isCreating` ✓
- 엣지케이스 3 (stale sessionId) → Task 6 step 4 ✓
- 엣지케이스 4 (draft 폐기) → Task 5 step 5 ✓

**Placeholder scan:** 모든 코드 블록 완전. `async_session_maker` 이름은 step 안에서 검증하도록 명시.

**Type consistency:** `ensureSession()` 반환 타입 `ChatSession` 일관. `onSessionCreated` 시그니처 일관. `isCreating`/`isStreaming` 명명 일관.
