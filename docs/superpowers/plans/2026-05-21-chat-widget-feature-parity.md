# Chat / Widget Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify chat features between `/chat`, `WidgetDemo`, and vanilla `widget/main.ts` under a shared React `ChatPanel` component, with permission-aware adapter that hides SR/feedback from anonymous widget users. Backend enforces same boundary via guards.

**Architecture:** Extract `ChatPanel` + `useChatSession` + `ChatApiAdapter` to share UI/state between `/chat` and `WidgetDemo`. Permission = "is adapter function defined?". Backend gates SR/feedback by checking `WIDGET_USER_ID`. Vanilla `main.ts` gets citation/warning rendering only — SR/feedback hidden until SSO/JWT ships.

**Tech Stack:** React 18 + TypeScript, FastAPI + SQLAlchemy async, pytest-asyncio + httpx.

**Spec:** `docs/superpowers/specs/2026-05-21-chat-widget-feature-parity-design.md`

**Key constant:** `WIDGET_USER_ID = UUID("00000000-0000-0000-0000-000000000099")` defined in `backend/app/routers/widget.py`.

---

## Task 1: Backend — `allow_sr_draft` parameter in `chat_service`

**Files:**
- Modify: `backend/app/services/chat_service.py:137-260` (`ask_question`) and `backend/app/services/chat_service.py:255-380` (`ask_question_stream`)
- Test: `backend/tests/test_chat_service.py` (add cases)

- [ ] **Step 1: Read the current `ask_question` signature and the SR creation block in both functions**

Run: `grep -n "async def ask_question\|sr_proposal = _extract_sr_proposal" backend/app/services/chat_service.py`

Confirm two SR creation sites exist (around lines 169 and 296 currently) and identical pattern.

- [ ] **Step 2: Write failing tests for `allow_sr_draft=False`**

Append to `backend/tests/test_chat_service.py`:

```python
import pytest
import uuid
from sqlalchemy import select
from app.services import chat_service
from app.models.chat import ChatSession
from app.models.sr import SRDraft


@pytest.mark.asyncio(loop_scope="session")
async def test_ask_question_stream_skips_sr_draft_when_disallowed(db_session, test_user):
    session = ChatSession(id=uuid.uuid4(), user_id=uuid.UUID(test_user["id"]))
    db_session.add(session)
    await db_session.commit()

    chunks = []
    async for chunk in chat_service.ask_question_stream(
        db_session, session.id, "[변경 요청] 근무 시간을 변경해주세요",
        allow_sr_draft=False,
    ):
        chunks.append(chunk)

    full = "".join(chunks)
    assert "sr_draft" not in full

    result = await db_session.execute(select(SRDraft).where(SRDraft.user_id == session.user_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio(loop_scope="session")
async def test_ask_question_skips_sr_draft_when_disallowed(db_session, test_user):
    session = ChatSession(id=uuid.uuid4(), user_id=uuid.UUID(test_user["id"]))
    db_session.add(session)
    await db_session.commit()

    result = await chat_service.ask_question(
        db_session, session.id, "[변경 요청] 정책을 바꿔주세요",
        allow_sr_draft=False,
    )
    assert "sr_draft" not in result or result.get("sr_draft") is None
```

> If `db_session` fixture not in `conftest.py`, fall back to a test that uses the existing `client: AsyncClient` and exercises the new param through the router (Task 3 will cover that path). In that case skip these two tests and rely on Task 3's tests.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_chat_service.py -v -k "skips_sr_draft" 2>&1 | tail -20`

Expected: FAIL — `allow_sr_draft` is an unexpected keyword argument (TypeError) or sr_draft still created.

- [ ] **Step 4: Add `allow_sr_draft` parameter to both functions**

Edit `backend/app/services/chat_service.py`:

```python
async def ask_question(
    db: AsyncSession,
    session_id: uuid.UUID,
    question: str,
    *,
    allow_sr_draft: bool = True,
) -> dict:
```

```python
async def ask_question_stream(
    db: AsyncSession,
    session_id: uuid.UUID,
    question: str,
    *,
    allow_sr_draft: bool = True,
):
```

In both functions, wrap the SR creation:

```python
sr_proposal = (
    _extract_sr_proposal(answer)  # or full_content in stream
    if allow_sr_draft and question.startswith("[변경 요청]")
    else None
)
```

Replace the existing `if question.startswith("[변경 요청]") else None` lines. Keep everything inside the `if sr_proposal:` block unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_chat_service.py -v -k "skips_sr_draft" 2>&1 | tail -20`

Expected: PASS.

- [ ] **Step 6: Run full chat_service test suite to verify no regression**

Run: `cd backend && uv run pytest tests/test_chat_service.py tests/test_chat.py -v 2>&1 | tail -30`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/chat_service.py backend/tests/test_chat_service.py
git commit -m "feat(backend): add allow_sr_draft toggle to chat_service"
```

---

## Task 2: Backend — `WidgetSessionCreate.user_id` field

**Files:**
- Modify: `backend/app/schemas/widget.py`
- Test: `backend/tests/test_widget.py` (new)

- [ ] **Step 1: Create new test file `backend/tests/test_widget.py`**

```python
import pytest
import uuid
from httpx import AsyncClient


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_anonymous(client: AsyncClient):
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["site_id"] == "test_site"
    assert "id" in data


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_with_user_id(client: AsyncClient, test_user: dict):
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
        "user_id": test_user["id"],
    })
    assert resp.status_code == 201


@pytest.mark.asyncio(loop_scope="session")
async def test_create_widget_session_unknown_user(client: AsyncClient):
    fake_user_id = str(uuid.uuid4())
    resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
        "user_id": fake_user_id,
    })
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to confirm failures**

Run: `cd backend && uv run pytest tests/test_widget.py -v 2>&1 | tail -30`

Expected:
- `test_create_widget_session_anonymous` → PASS (already works)
- `test_create_widget_session_with_user_id` → FAIL (user_id not in schema → 422)
- `test_create_widget_session_unknown_user` → FAIL (422 instead of 404)

- [ ] **Step 3: Add `user_id` to `WidgetSessionCreate`**

Edit `backend/app/schemas/widget.py`:

```python
class WidgetSessionCreate(BaseModel):
    site_id: str
    anonymous_id: str | None = None
    user_id: uuid.UUID | None = None
```

- [ ] **Step 4: Run anonymous test to confirm no regression**

Run: `cd backend && uv run pytest tests/test_widget.py::test_create_widget_session_anonymous -v`

Expected: PASS (router still handles the case but doesn't yet use user_id — that's Task 3).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/widget.py backend/tests/test_widget.py
git commit -m "feat(backend): add optional user_id to widget session schema"
```

---

## Task 3: Backend — widget router uses `user_id` + `allow_sr_draft`

**Files:**
- Modify: `backend/app/routers/widget.py`
- Test: `backend/tests/test_widget.py`

- [ ] **Step 1: Add failing tests for SR draft behavior**

Append to `backend/tests/test_widget.py`:

```python
from sqlalchemy import select
from app.models.sr import SRDraft


@pytest.mark.asyncio(loop_scope="session")
async def test_widget_ask_stream_anonymous_skips_sr_draft(client: AsyncClient, db_session):
    create_resp = await client.post("/api/widget/sessions", json={"site_id": "test_site"})
    session_id = create_resp.json()["id"]

    async with client.stream(
        "POST", f"/api/widget/sessions/{session_id}/ask-stream",
        json={"question": "[변경 요청] 정책을 바꿔주세요"},
    ) as resp:
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    assert "sr_draft" not in body

    from app.routers.widget import WIDGET_USER_ID
    result = await db_session.execute(
        select(SRDraft).where(SRDraft.user_id == WIDGET_USER_ID)
    )
    assert result.scalars().first() is None


@pytest.mark.asyncio(loop_scope="session")
async def test_widget_ask_stream_authenticated_allows_sr_draft(
    client: AsyncClient, test_user: dict, db_session
):
    create_resp = await client.post("/api/widget/sessions", json={
        "site_id": "test_site",
        "user_id": test_user["id"],
    })
    session_id = create_resp.json()["id"]

    async with client.stream(
        "POST", f"/api/widget/sessions/{session_id}/ask-stream",
        json={"question": "[변경 요청] 근무 시간을 변경해주세요"},
    ) as resp:
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk

    # SR draft creation depends on LLM extracting a proposal; only assert
    # that the path was *allowed* — i.e. no AnonymousSession error.
    # Real assertion: session owner is the test user, not WIDGET_USER_ID.
    from app.models.chat import ChatSession
    result = await db_session.execute(
        select(ChatSession).where(ChatSession.id == uuid.UUID(session_id))
    )
    session = result.scalar_one()
    assert str(session.user_id) == test_user["id"]
```

> The LLM behavior is non-deterministic; tests focus on session ownership routing rather than asserting `sr_draft` always present.

- [ ] **Step 2: Run tests to confirm failures**

Run: `cd backend && uv run pytest tests/test_widget.py -v 2>&1 | tail -30`

Expected: anonymous tests pass, authenticated session owner test fails (still uses WIDGET_USER_ID).

- [ ] **Step 3: Update `widget.py` router**

Edit `backend/app/routers/widget.py`:

```python
from sqlalchemy import select
from app.models.user import User
# (existing imports retained)


@router.post("/sessions", response_model=WidgetSessionResponse, status_code=201)
async def create_widget_session(
    data: WidgetSessionCreate,
    db: AsyncSession = Depends(get_db),
):
    if data.user_id is not None:
        result = await db.execute(select(User).where(User.id == data.user_id))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="User not found")
        owner_id = data.user_id
    else:
        await ensure_widget_user(db)
        owner_id = WIDGET_USER_ID

    anonymous_id = data.anonymous_id or str(uuid.uuid4())[:8]

    session = ChatSession(
        id=uuid.uuid4(),
        user_id=owner_id,
        title=f"widget:{data.site_id}:{anonymous_id}",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return WidgetSessionResponse(
        id=session.id,
        site_id=data.site_id,
        anonymous_id=anonymous_id,
        created_at=session.created_at,
    )


@router.post("/sessions/{session_id}/ask-stream")
async def widget_ask_stream(
    session_id: uuid.UUID,
    data: WidgetAskRequest,
    db: AsyncSession = Depends(get_db),
):
    session = await chat_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    allow_sr_draft = session.user_id != WIDGET_USER_ID

    return StreamingResponse(
        chat_service.ask_question_stream(
            db, session_id, data.question,
            allow_sr_draft=allow_sr_draft,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_widget.py -v 2>&1 | tail -30`

Expected: all four widget tests pass.

- [ ] **Step 5: Run full backend tests to confirm no regression**

Run: `cd backend && uv run pytest tests/ -x 2>&1 | tail -20`

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/widget.py backend/tests/test_widget.py
git commit -m "feat(backend): widget session honors user_id, skips sr_draft when anonymous"
```

---

## Task 4: Backend — block SR submit by `WIDGET_USER_ID`

**Files:**
- Modify: `backend/app/routers/sr.py:35-43` (`submit_sr`)
- Test: `backend/tests/test_sr.py` (append) or `backend/tests/test_widget.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_widget.py`:

```python
from app.models.sr import SRDraft
from app.routers.widget import WIDGET_USER_ID


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_submit_blocked_for_widget_anonymous(client: AsyncClient, db_session):
    draft = SRDraft(
        id=uuid.uuid4(),
        user_id=WIDGET_USER_ID,
        title="anon SR",
        description="should not submit",
        priority="low",
        status="draft",
        created_by_ai=True,
    )
    db_session.add(draft)
    await db_session.commit()

    resp = await client.post(f"/api/sr/drafts/{draft.id}/submit")
    assert resp.status_code == 403
    assert "anonymous" in resp.json()["detail"].lower()


@pytest.mark.asyncio(loop_scope="session")
async def test_sr_submit_allowed_for_authenticated_user(
    client: AsyncClient, db_session, test_user: dict
):
    draft = SRDraft(
        id=uuid.uuid4(),
        user_id=uuid.UUID(test_user["id"]),
        title="real SR",
        description="should submit",
        priority="low",
        status="draft",
        created_by_ai=True,
    )
    db_session.add(draft)
    await db_session.commit()

    resp = await client.post(f"/api/sr/drafts/{draft.id}/submit")
    # 200 (success) or 500 (Jira not configured in test) both acceptable;
    # 403 must NOT occur.
    assert resp.status_code != 403
```

- [ ] **Step 2: Run tests to verify failures**

Run: `cd backend && uv run pytest tests/test_widget.py::test_sr_submit_blocked_for_widget_anonymous -v 2>&1 | tail -15`

Expected: FAIL (no 403 because guard not in place).

- [ ] **Step 3: Add the guard**

Edit `backend/app/routers/sr.py`:

```python
from app.routers.widget import WIDGET_USER_ID  # add to imports


@router.post("/drafts/{sr_id}/submit")
async def submit_sr(
    sr_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    draft = await sr_service.get_draft(db, sr_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="SR draft not found")
    if draft.user_id == WIDGET_USER_ID:
        raise HTTPException(status_code=403, detail="anonymous SR submit not allowed")
    try:
        return await sr_service.submit_sr(db, sr_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
```

> If `sr_service.get_draft` does not exist, add it:
>
> ```python
> # backend/app/services/sr_service.py
> async def get_draft(db: AsyncSession, sr_id: uuid.UUID) -> SRDraft | None:
>     result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
>     return result.scalar_one_or_none()
> ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_widget.py -v -k "sr_submit" 2>&1 | tail -20`

Expected: both new tests pass.

- [ ] **Step 5: Run existing SR tests**

Run: `cd backend && uv run pytest tests/test_sr.py -v 2>&1 | tail -20`

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/sr.py backend/app/services/sr_service.py backend/tests/test_widget.py
git commit -m "feat(backend): block SR submit for WIDGET_USER_ID owner"
```

---

## Task 5: Backend — block feedback POST by `WIDGET_USER_ID`

**Files:**
- Modify: `backend/app/routers/feedback.py:25-50` (`create_feedback`)
- Test: `backend/tests/test_widget.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_widget.py`:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_blocked_for_widget_anonymous(client: AsyncClient):
    resp = await client.post("/api/feedback", json={
        "user_id": str(WIDGET_USER_ID),
        "feedback_text": "should be blocked",
    })
    assert resp.status_code == 403
    assert "anonymous" in resp.json()["detail"].lower()


@pytest.mark.asyncio(loop_scope="session")
async def test_feedback_allowed_for_authenticated_user(
    client: AsyncClient, test_user: dict
):
    resp = await client.post("/api/feedback", json={
        "user_id": test_user["id"],
        "feedback_text": "real feedback",
    })
    assert resp.status_code != 403
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd backend && uv run pytest tests/test_widget.py -v -k "feedback" 2>&1 | tail -15`

Expected: `test_feedback_blocked_for_widget_anonymous` FAIL (creates row, returns 201).

- [ ] **Step 3: Add the guard**

Edit `backend/app/routers/feedback.py`:

```python
from app.routers.widget import WIDGET_USER_ID  # add to imports


@router.post("", response_model=FeedbackWithProposalResponse, status_code=201)
async def create_feedback(
    data: FeedbackReportCreate,
    db: AsyncSession = Depends(get_db),
):
    if data.user_id == WIDGET_USER_ID:
        raise HTTPException(status_code=403, detail="anonymous feedback not allowed")

    report = await feedback_service.create_feedback(db, data)
    # ... (rest unchanged)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_widget.py -v -k "feedback" 2>&1 | tail -15`

Expected: both tests pass.

- [ ] **Step 5: Run all feedback + widget tests**

Run: `cd backend && uv run pytest tests/test_feedback.py tests/test_widget.py -v 2>&1 | tail -30`

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/feedback.py backend/tests/test_widget.py
git commit -m "feat(backend): block feedback creation for WIDGET_USER_ID"
```

---

## Task 6: Frontend — `chatAdapters.ts`

**Files:**
- Create: `frontend/src/lib/chatAdapters.ts`

- [ ] **Step 1: Read existing `lib/api.ts` to understand current types**

Run: `grep -n "askQuestionStream\|submitSR\|createFeedback\|ChatMessage\|Citation\|SRDraftCreated\|DocumentWarning" frontend/src/lib/api.ts | head -30`

Confirm: `api.askQuestionStream`, `api.submitSR`, `api.createFeedback` exist and types `ChatMessage`, `Citation`, `SRDraftCreated`, `DocumentWarning` exist.

- [ ] **Step 2: Create `chatAdapters.ts`**

```ts
// frontend/src/lib/chatAdapters.ts
import { api, type ChatMessage, type Citation, type DocumentWarning, type SRDraftCreated } from "@/lib/api"
import { parseSSE } from "@/lib/sse"

export interface StreamEvent {
  type: "token" | "citations" | "done"
  token?: string
  citations?: Citation[]
  warnings?: DocumentWarning[]
  messageId?: string
  sr_draft?: SRDraftCreated
}

export interface FeedbackPayload {
  document_id?: string
  chunk_id?: string
  chat_message_id?: string
  feedback_text: string
}

export interface FeedbackResult {
  feedback: { id: string; status: string }
  proposed_change: { id: string } | null
}

export interface ChatApiAdapter {
  getMessages(sessionId: string): Promise<ChatMessage[]>
  askStream(sessionId: string, question: string): AsyncIterable<StreamEvent>
  submitSR?(draftId: string): Promise<{ jira_issue_key?: string }>
  submitFeedback?(payload: FeedbackPayload): Promise<FeedbackResult>
}

export function buildChatAdapter(userId: string): ChatApiAdapter {
  return {
    getMessages: (id) => api.getMessages(id),
    askStream: (id, q) => api.askQuestionStream(id, q),
    submitSR: (draftId) => api.submitSR(draftId),
    submitFeedback: (payload) =>
      api.createFeedback({ ...payload, user_id: userId }) as Promise<FeedbackResult>,
  }
}

async function* widgetAskStream(sessionId: string, question: string): AsyncIterable<StreamEvent> {
  const res = await fetch(`/api/widget/sessions/${sessionId}/ask-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error("widget stream failed")

  for await (const event of parseSSE(res)) {
    if (event.event === "token") {
      const { token } = JSON.parse(event.data)
      yield { type: "token", token }
    } else if (event.event === "citations") {
      const data = JSON.parse(event.data)
      yield { type: "citations", citations: data.citations, warnings: data.warnings }
    } else if (event.event === "done") {
      const data = JSON.parse(event.data)
      yield { type: "done", messageId: data.message_id, sr_draft: data.sr_draft }
    }
  }
}

async function widgetGetMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/widget/sessions/${sessionId}/messages`)
  if (!res.ok) throw new Error("widget get messages failed")
  return res.json()
}

export function buildWidgetAdapter(userId: string | null): ChatApiAdapter {
  const base: ChatApiAdapter = {
    getMessages: widgetGetMessages,
    askStream: widgetAskStream,
  }
  if (!userId) return base
  return {
    ...base,
    submitSR: (draftId) => api.submitSR(draftId),
    submitFeedback: (payload) =>
      api.createFeedback({ ...payload, user_id: userId }) as Promise<FeedbackResult>,
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && pnpm typecheck 2>&1 | tail -20`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/chatAdapters.ts
git commit -m "feat(frontend): add ChatApiAdapter for chat/widget endpoint abstraction"
```

---

## Task 7: Frontend — `useChatSession` hook

**Files:**
- Create: `frontend/src/hooks/useChatSession.ts`

- [ ] **Step 1: Create the hook**

```ts
// frontend/src/hooks/useChatSession.ts
import { useState, useEffect, useCallback } from "react"
import type {
  ChatMessage, Citation, DocumentWarning, SRDraftCreated,
} from "@/lib/api"
import type { ChatApiAdapter } from "@/lib/chatAdapters"

export type ChatMode = "question" | "change_request"

export interface UseChatSessionArgs {
  sessionId: string | null
  userId: string | null
  api: ChatApiAdapter
}

export interface ChatSessionState {
  messages: ChatMessage[]
  citations: Citation[]
  citationsByMessage: Record<string, Citation[]>
  warnings: DocumentWarning[]
  loading: boolean
  input: string
  setInput: (v: string) => void
  send: () => Promise<void>

  chatMode: ChatMode
  setChatMode: (m: ChatMode) => void

  srDraftsByMessage: Record<string, SRDraftCreated>
  srSentById: Record<string, string>
  srSendingId: string | null
  srSendErrorById: Record<string, string>
  sendSR: (draft: SRDraftCreated) => Promise<void>

  feedbackFor: string | null
  feedbackText: string
  feedbackSubmitting: boolean
  feedbackSuccess: string | null
  feedbackNotice: Record<string, string>
  openFeedback: (msgId: string) => void
  cancelFeedback: () => void
  setFeedbackText: (v: string) => void
  submitFeedback: (msgId: string) => Promise<void>

  canSubmitSR: boolean
  canSubmitFeedback: boolean

  resetAll: () => void
}

export function useChatSession({ sessionId, userId, api }: UseChatSessionArgs): ChatSessionState {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [citations, setCitations] = useState<Citation[]>([])
  const [citationsByMessage, setCitationsByMessage] = useState<Record<string, Citation[]>>({})
  const [warnings, setWarnings] = useState<DocumentWarning[]>([])
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState("")
  const [chatMode, setChatMode] = useState<ChatMode>("question")

  const [srDraftsByMessage, setSrDraftsByMessage] = useState<Record<string, SRDraftCreated>>({})
  const [srSendingId, setSrSendingId] = useState<string | null>(null)
  const [srSentById, setSrSentById] = useState<Record<string, string>>({})
  const [srSendErrorById, setSrSendErrorById] = useState<Record<string, string>>({})

  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [feedbackText, setFeedbackText] = useState("")
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null)
  const [feedbackNotice, setFeedbackNotice] = useState<Record<string, string>>({})

  const canSubmitSR = typeof api.submitSR === "function"
  const canSubmitFeedback = typeof api.submitFeedback === "function"

  const resetAll = useCallback(() => {
    setMessages([])
    setCitations([])
    setCitationsByMessage({})
    setWarnings([])
    setSrDraftsByMessage({})
    setSrSendingId(null)
    setSrSentById({})
    setSrSendErrorById({})
    setFeedbackFor(null)
    setFeedbackText("")
    setFeedbackSuccess(null)
    setFeedbackNotice({})
  }, [])

  useEffect(() => {
    if (!sessionId) {
      resetAll()
      return
    }
    api.getMessages(sessionId).then((loaded) => {
      setMessages(loaded)
      const next: Record<string, Citation[]> = {}
      for (const m of loaded) {
        if (m.citations?.length) next[m.id] = m.citations
      }
      setCitationsByMessage(next)
    }).catch(() => {})
  }, [sessionId, api, resetAll])

  const send = useCallback(async () => {
    if (!input.trim() || !sessionId) return
    const question = chatMode === "change_request" ? `[변경 요청] ${input}` : input
    const userInput = input
    setInput("")
    setLoading(true)
    let responseCitations: Citation[] = []

    const userMsg: ChatMessage = {
      id: "user-" + Date.now(),
      session_id: sessionId,
      role: "user",
      content: userInput,
      created_at: new Date().toISOString(),
    }
    const botMsg: ChatMessage = {
      id: "streaming",
      session_id: sessionId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg, botMsg])

    try {
      let content = ""
      let messageId = ""
      let srDraft: SRDraftCreated | undefined
      for await (const event of api.askStream(sessionId, question)) {
        if (event.type === "token" && event.token) {
          content += event.token
          setMessages(prev => prev.map(m => m.id === "streaming" ? { ...m, content } : m))
        } else if (event.type === "citations") {
          responseCitations = event.citations || []
          setCitations(responseCitations)
          setWarnings(event.warnings || [])
        } else if (event.type === "done") {
          messageId = event.messageId || ""
          srDraft = event.sr_draft
          if (messageId && responseCitations.length) {
            setCitationsByMessage(prev => ({ ...prev, [messageId]: responseCitations }))
          }
          if (srDraft && messageId) {
            setSrDraftsByMessage(prev => ({ ...prev, [messageId]: srDraft! }))
          }
        }
      }
      setMessages(prev => prev.map(m =>
        m.id === "streaming" ? { ...m, id: messageId, content, citations: responseCitations } : m
      ))
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === "streaming" ? { ...m, content: "오류가 발생했습니다. 다시 시도해주세요." } : m
      ))
    } finally {
      setLoading(false)
    }
  }, [input, sessionId, chatMode, api])

  const sendSR = useCallback(async (draft: SRDraftCreated) => {
    if (!api.submitSR) return
    setSrSendingId(draft.id)
    setSrSendErrorById(prev => ({ ...prev, [draft.id]: "" }))
    try {
      const result = await api.submitSR(draft.id)
      setSrSentById(prev => ({
        ...prev,
        [draft.id]: result.jira_issue_key
          ? `SR 전송 완료 (${result.jira_issue_key})`
          : "SR 전송 완료",
      }))
    } catch (err) {
      setSrSendErrorById(prev => ({
        ...prev,
        [draft.id]: err instanceof Error ? err.message : "SR 전송에 실패했습니다",
      }))
    } finally {
      setSrSendingId(null)
    }
  }, [api])

  const openFeedback = useCallback((msgId: string) => setFeedbackFor(msgId), [])
  const cancelFeedback = useCallback(() => {
    setFeedbackFor(null)
    setFeedbackText("")
  }, [])

  const submitFeedback = useCallback(async (msgId: string) => {
    if (!api.submitFeedback || !feedbackText.trim()) return
    setFeedbackSubmitting(true)
    try {
      const msg = messages.find(m => m.id === msgId)
      const msgCitations = msg?.citations?.length
        ? msg.citations
        : citationsByMessage[msgId] || citations
      const citation = msgCitations.find(c => c.document_id)
      const result = await api.submitFeedback({
        chat_message_id: msgId,
        document_id: citation?.document_id,
        chunk_id: citation?.chunk_id || undefined,
        feedback_text: feedbackText,
      })
      setFeedbackNotice(prev => ({
        ...prev,
        [msgId]: result.proposed_change
          ? "AI 수정안이 생성되어 승인 관리로 전달되었습니다"
          : "오류 제보가 접수되었습니다",
      }))
      setFeedbackSuccess(msgId)
      setFeedbackFor(null)
      setFeedbackText("")
      setTimeout(() => setFeedbackSuccess(null), 3000)
    } finally {
      setFeedbackSubmitting(false)
    }
  }, [api, feedbackText, messages, citationsByMessage, citations])

  return {
    messages, citations, citationsByMessage, warnings, loading,
    input, setInput, send,
    chatMode, setChatMode,
    srDraftsByMessage, srSentById, srSendingId, srSendErrorById, sendSR,
    feedbackFor, feedbackText, feedbackSubmitting, feedbackSuccess, feedbackNotice,
    openFeedback, cancelFeedback, setFeedbackText, submitFeedback,
    canSubmitSR, canSubmitFeedback,
    resetAll,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && pnpm typecheck 2>&1 | tail -10`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useChatSession.ts
git commit -m "feat(frontend): add useChatSession hook with permission-aware adapter"
```

---

## Task 8: Frontend — `ChatPanel` components

**Files:**
- Create: `frontend/src/components/chat/ChatPanel.tsx`
- Create: `frontend/src/components/chat/ChatMessage.tsx`
- Create: `frontend/src/components/chat/ChatInput.tsx`

- [ ] **Step 1: Create `ChatMessage.tsx`**

This renders one message + its citation grid + SR card + action buttons. Direct port of the message-rendering JSX in `Chat.tsx:328-477` with conditional rendering based on `canSubmitSR` / `canSubmitFeedback` and `variant`.

```tsx
// frontend/src/components/chat/ChatMessage.tsx
import type { ChatMessage as ChatMessageType, Citation, SRDraftCreated } from "@/lib/api"

interface Props {
  msg: ChatMessageType
  variant: "full" | "compact"
  citations: Citation[]
  srDraft?: SRDraftCreated
  srSentText?: string
  srSendingId: string | null
  srSendError?: string
  onSendSR?: (draft: SRDraftCreated) => void
  canSubmitFeedback: boolean
  feedbackFor: string | null
  feedbackText: string
  feedbackSubmitting: boolean
  feedbackSuccess: string | null
  feedbackNotice?: string
  onOpenFeedback: (id: string) => void
  onCancelFeedback: () => void
  onFeedbackTextChange: (v: string) => void
  onSubmitFeedback: (id: string) => void
}

export function ChatMessageView(p: Props) {
  const { msg, variant, citations, srDraft } = p
  if (msg.role === "user") {
    return (
      <div className="flex justify-end w-full">
        <div className={
          variant === "full"
            ? "bg-[#1e40af] text-white rounded-2xl rounded-tr-none px-6 py-3 max-w-[85%] shadow-sm"
            : "bg-[#00288e] text-white rounded-lg rounded-tr-none p-3 text-sm shadow-sm max-w-[85%]"
        }>
          <p className={variant === "full" ? "text-base leading-relaxed whitespace-pre-wrap" : "text-sm whitespace-pre-wrap"}>{msg.content}</p>
        </div>
      </div>
    )
  }
  // assistant
  return (
    <div className={variant === "full" ? "flex gap-4 w-full max-w-[95%]" : "flex gap-3 max-w-[90%]"}>
      <div className={variant === "full"
        ? "shrink-0 w-8 h-8 rounded-full bg-[#d5e3fc] flex items-center justify-center border border-[#c4c5d5] mt-1"
        : "shrink-0 w-8 h-8 rounded-full bg-[#1e40af] text-white flex items-center justify-center"
      }>
        <span className="material-symbols-outlined text-base text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
      </div>
      <div className="flex-1 space-y-3">
        <div className={variant === "full"
          ? "bg-white border border-[#c4c5d5] rounded-2xl rounded-tl-none px-6 py-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
          : "bg-white border border-[#c4c5d5] rounded-lg rounded-tl-none p-3 text-sm text-[#191c1e] shadow-sm"
        }>
          <div className={variant === "full"
            ? "text-base leading-relaxed text-[#191c1e] whitespace-pre-wrap"
            : "text-sm whitespace-pre-wrap"
          }>
            {msg.content || <span className="text-[#757684] animate-pulse">응답 생성 중...</span>}
          </div>

          {msg.id !== "streaming" && citations.length > 0 && variant === "full" && (
            <>
              <div className="h-px w-full bg-[#e0e3e5] my-4" />
              <div className="space-y-3">
                <div className="flex items-center gap-1 text-[#444653]">
                  <span className="material-symbols-outlined text-sm">menu_book</span>
                  <span className="text-xs font-semibold">참고 문서 (출처)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {citations.map((c, i) => (
                    <a key={i} href="#" className="flex flex-col gap-1 p-3 bg-[#f7f9fb] rounded-lg border border-[#c4c5d5] hover:border-[#b8c4ff] hover:bg-white hover:shadow-sm transition-all group">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-1 overflow-hidden">
                          <span className="material-symbols-outlined text-base text-[#00288e] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>description</span>
                          <span className="text-sm text-[#191c1e] font-semibold truncate group-hover:text-[#00288e] transition-colors">{c.document_title || "참고 문서"}</span>
                        </div>
                      </div>
                      {c.quote && (
                        <div className="text-xs text-[#444653] truncate flex items-center gap-1 mt-1">
                          <span className="material-symbols-outlined text-[14px]">link</span>{c.quote}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            </>
          )}

          {msg.id !== "streaming" && citations.length > 0 && variant === "compact" && (
            <p className="text-xs text-[#444653] mt-2 pt-2 border-t border-dashed border-[#c4c5d5] flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">menu_book</span>
              출처: {citations.map(c => c.document_title).join(", ")}
            </p>
          )}
        </div>

        {srDraft && p.onSendSR && (
          <div className="border border-[#d7b46a] bg-[#fff8e6] rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base text-[#92600a]">assignment</span>
                  <span className="text-xs font-bold text-[#92600a]">AI가 정리한 SR 초안</span>
                </div>
                <p className="text-sm font-semibold text-[#191c1e]">{srDraft.title}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white border border-[#e6d3a1] px-2 py-0.5 text-[10px] font-semibold text-[#92600a]">
                {srDraft.priority}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[#444653] whitespace-pre-wrap line-clamp-4">
              {srDraft.description}
            </p>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-[#757684]">검토 후 바로 Jira/Webhook으로 전송할 수 있습니다.</p>
              {p.srSentText ? (
                <span className="text-xs font-semibold text-emerald-700">{p.srSentText}</span>
              ) : (
                <button
                  onClick={() => p.onSendSR!(srDraft)}
                  disabled={p.srSendingId === srDraft.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#00288e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e40af] disabled:opacity-50 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">send</span>
                  {p.srSendingId === srDraft.id ? "전송 중..." : "SR 보내기"}
                </button>
              )}
            </div>
            {p.srSendError && (
              <p className="text-xs font-medium text-[#ba1a1a]">{p.srSendError}</p>
            )}
          </div>
        )}

        {msg.id !== "streaming" && msg.content && p.canSubmitFeedback && (
          <div className="flex items-center gap-4 pl-2">
            <div className="ml-auto">
              {p.feedbackSuccess === msg.id ? (
                <span className="text-xs text-emerald-600 font-medium">{p.feedbackNotice || "오류 제보 접수 완료"}</span>
              ) : p.feedbackFor === msg.id ? (
                <div className="bg-[#ffdad6]/30 border border-[#ffdad6] rounded-lg p-3 space-y-2 max-w-sm">
                  <p className="text-xs font-medium text-[#93000a]">어떤 내용이 실제와 다른가요?</p>
                  <textarea
                    placeholder="실제 내용을 알려주세요..."
                    rows={2}
                    value={p.feedbackText}
                    onChange={e => p.onFeedbackTextChange(e.target.value)}
                    className="w-full text-sm border border-[#c4c5d5] rounded px-3 py-2 focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => p.onSubmitFeedback(msg.id)} disabled={p.feedbackSubmitting || !p.feedbackText.trim()} className="bg-[#00288e] text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#1e40af] disabled:opacity-50">
                      {p.feedbackSubmitting ? "제출 중..." : "제출"}
                    </button>
                    <button onClick={p.onCancelFeedback} className="text-xs text-[#444653] px-3 py-1.5 rounded hover:bg-[#f2f4f6]">
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => p.onOpenFeedback(msg.id)} className="flex items-center gap-1 text-xs text-[#757684] hover:text-[#ba1a1a] hover:bg-[#ffdad6] px-3 py-1 rounded transition-all">
                  <span className="material-symbols-outlined text-base">report</span>
                  오류 수정 요청
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `ChatInput.tsx`**

```tsx
// frontend/src/components/chat/ChatInput.tsx
import type { ChatMode } from "@/hooks/useChatSession"

interface Props {
  variant: "full" | "compact"
  chatMode: ChatMode
  onChangeMode: (m: ChatMode) => void
  showModeTabs: boolean
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  loading: boolean
}

export function ChatInput({
  variant, chatMode, onChangeMode, showModeTabs,
  input, onInputChange, onSend, loading,
}: Props) {
  const placeholder = chatMode === "change_request"
    ? (variant === "full" ? "어떤 변경이 필요한지 설명해주세요..." : "변경 요청 내용을 입력하세요...")
    : (variant === "full" ? "문서 내용에 대해 질문해보세요..." : "질문을 입력하세요...")

  return (
    <div className={variant === "full" ? "bg-[#f7f9fb]/80 backdrop-blur-md border-t border-[#c4c5d5] p-4 flex justify-center" : "p-3 bg-white border-t border-[#c4c5d5] flex flex-col gap-2"}>
      {showModeTabs && (
        <div className={variant === "full"
          ? "w-full max-w-4xl flex items-center gap-1 mb-2"
          : "flex items-center gap-1 mb-1"
        }>
          <button
            onClick={() => onChangeMode("question")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
              chatMode === "question" ? "bg-[#00288e] text-white shadow-sm" : "text-[#444653] hover:bg-[#f2f4f6]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">help</span>질문하기
          </button>
          <button
            onClick={() => onChangeMode("change_request")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
              chatMode === "change_request" ? "bg-[#b45309] text-white shadow-sm" : "text-[#444653] hover:bg-[#f2f4f6]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">edit_note</span>변경 요청
          </button>
        </div>
      )}
      <div className={variant === "full"
        ? "w-full max-w-4xl bg-white border-2 border-[#c4c5d5] focus-within:border-[#00288e] focus-within:ring-2 focus-within:ring-[#dde1ff] transition-all rounded-xl flex items-end p-1"
        : "flex items-center gap-3"
      }>
        {variant === "compact" ? (
          <input
            className="flex-1 bg-[#f2f4f6] border-none rounded-full px-4 py-2 text-sm focus:ring-1 focus:ring-[#00288e] outline-none text-[#191c1e]"
            placeholder={placeholder}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onSend()}
            disabled={loading}
          />
        ) : (
          <textarea
            className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none text-base text-[#191c1e] py-2 px-2 outline-none"
            placeholder={placeholder}
            rows={1}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() } }}
            disabled={loading}
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
        )}
        <button
          onClick={onSend}
          disabled={loading || !input.trim()}
          className={variant === "full"
            ? "p-2 m-1 bg-[#00288e] text-white rounded-lg hover:bg-[#1e40af] transition-all shrink-0 flex items-center justify-center h-10 w-10 disabled:opacity-50"
            : "w-10 h-10 rounded-full bg-[#00288e] text-white flex items-center justify-center hover:bg-[#1e40af] shrink-0 disabled:opacity-50"
          }
        >
          <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `ChatPanel.tsx`**

```tsx
// frontend/src/components/chat/ChatPanel.tsx
import { useRef, useEffect } from "react"
import type { ChatSessionState } from "@/hooks/useChatSession"
import { ChatMessageView } from "./ChatMessage"
import { ChatInput } from "./ChatInput"

interface Props {
  chat: ChatSessionState
  variant: "full" | "compact"
  emptyState?: React.ReactNode
}

export function ChatPanel({ chat, variant, emptyState }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chat.messages])

  return (
    <div className={variant === "full" ? "flex-1 flex flex-col bg-[#f7f9fb] relative" : "flex flex-col flex-1 bg-[#f7f9fb] overflow-hidden"}>
      <div className={variant === "full"
        ? "flex-1 overflow-y-auto p-6 flex flex-col items-center"
        : "flex-1 p-4 overflow-y-auto flex flex-col gap-4"
      }>
        <div className={variant === "full" ? "w-full max-w-4xl space-y-6 pb-8" : "w-full space-y-3"}>
          {chat.messages.length === 0 && emptyState}
          {chat.messages.map((msg) => (
            <ChatMessageView
              key={msg.id}
              msg={msg}
              variant={variant}
              citations={
                msg.citations?.length
                  ? msg.citations
                  : chat.citationsByMessage[msg.id]
                    || (msg === chat.messages[chat.messages.length - 1] ? chat.citations : [])
              }
              srDraft={chat.srDraftsByMessage[msg.id]}
              srSentText={chat.srSentById[chat.srDraftsByMessage[msg.id]?.id]}
              srSendingId={chat.srSendingId}
              srSendError={chat.srSendErrorById[chat.srDraftsByMessage[msg.id]?.id]}
              onSendSR={chat.canSubmitSR ? chat.sendSR : undefined}
              canSubmitFeedback={chat.canSubmitFeedback}
              feedbackFor={chat.feedbackFor}
              feedbackText={chat.feedbackText}
              feedbackSubmitting={chat.feedbackSubmitting}
              feedbackSuccess={chat.feedbackSuccess}
              feedbackNotice={chat.feedbackNotice[msg.id]}
              onOpenFeedback={chat.openFeedback}
              onCancelFeedback={chat.cancelFeedback}
              onFeedbackTextChange={chat.setFeedbackText}
              onSubmitFeedback={chat.submitFeedback}
            />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {chat.warnings.length > 0 && (
        <div className="border-t border-[#c4c5d5] px-4 py-2 bg-[#ffdbce]/20">
          <div className="flex items-center gap-2 text-[#611e00]">
            <span className="material-symbols-outlined text-base">warning</span>
            <span className="text-xs font-medium">
              주의: 이 답변은 신뢰도가 낮은 문서를 참조합니다 — {chat.warnings.map(w => w.title).join(", ")}
            </span>
          </div>
        </div>
      )}

      <ChatInput
        variant={variant}
        chatMode={chat.chatMode}
        onChangeMode={chat.setChatMode}
        showModeTabs={chat.canSubmitSR}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={chat.send}
        loading={chat.loading}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && pnpm typecheck 2>&1 | tail -10`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/chat/
git commit -m "feat(frontend): add ChatPanel/ChatMessage/ChatInput shared components"
```

---

## Task 9: Frontend — refactor `Chat.tsx` to use `ChatPanel`

**Files:**
- Modify: `frontend/src/pages/Chat.tsx`

- [ ] **Step 1: Replace `Chat.tsx` content**

The new file keeps the session sidebar (left rail) and uses `<ChatPanel variant="full">` for the right side.

```tsx
// frontend/src/pages/Chat.tsx
import { useState, useEffect, useMemo } from "react"
import { api, type ChatSession } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { useChatSession } from "@/hooks/useChatSession"
import { buildChatAdapter } from "@/lib/chatAdapters"
import { ChatPanel } from "@/components/chat/ChatPanel"

export function Chat() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)

  const adapter = useMemo(
    () => user?.id ? buildChatAdapter(user.id) : null,
    [user?.id]
  )

  const chat = useChatSession({
    sessionId: activeSession,
    userId: user?.id ?? null,
    api: adapter ?? buildChatAdapter("placeholder"),
  })

  useEffect(() => {
    if (user?.id) {
      api.listSessions(user.id).then(setSessions).catch(() => {})
    }
  }, [user?.id])

  const createSession = async () => {
    if (!user?.id) return
    const session = await api.createSession(user.id)
    setSessions([session, ...sessions])
    setActiveSession(session.id)
    chat.resetAll()
  }

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingSession(sessionId)
    try {
      await api.deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (activeSession === sessionId) {
        setActiveSession(null)
        chat.resetAll()
      }
    } finally {
      setDeletingSession(null)
    }
  }

  const groupSessionsByDate = () => {
    const today: ChatSession[] = []
    const yesterday: ChatSession[] = []
    const older: ChatSession[] = []
    const now = new Date()
    for (const s of sessions) {
      const d = new Date(s.created_at)
      const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
      if (diff === 0) today.push(s)
      else if (diff === 1) yesterday.push(s)
      else older.push(s)
    }
    return { today, yesterday, older }
  }
  const grouped = groupSessionsByDate()

  const renderList = (list: ChatSession[]) =>
    list.map(s => (
      <div
        key={s.id}
        className={`group relative w-full flex items-center rounded-md transition-colors ${
          activeSession === s.id ? "bg-[#f2f4f6]" : "hover:bg-[#f2f4f6]"
        }`}
      >
        <button
          onClick={() => setActiveSession(s.id)}
          className={`flex-1 text-left px-3 py-2 text-sm truncate transition-colors ${
            activeSession === s.id ? "text-[#00288e] font-medium" : "text-[#191c1e]"
          }`}
        >
          {s.title || "새 대화"}
        </button>
        <button
          onClick={(e) => deleteSession(s.id, e)}
          disabled={deletingSession === s.id}
          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 mr-1 text-[#757684] hover:text-[#ba1a1a] transition-all rounded"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
        </button>
      </div>
    ))

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-[#d5e3fc] flex items-center justify-center shadow-sm">
        <span className="material-symbols-outlined text-4xl text-[#00288e]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
      </div>
      <h2 className="text-xl font-semibold text-[#191c1e] text-center">무엇을 도와드릴까요?</h2>
      <p className="text-sm text-[#444653] text-center max-w-md">
        사내 규정, 재무 데이터, 기술 문서 등 DocOps AI에 등록된 모든 지식을 기반으로 답변해 드립니다.
      </p>
    </div>
  )

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-64 bg-white border-r border-[#c4c5d5] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#c4c5d5] flex justify-between items-center">
          <h2 className="text-xs font-semibold text-[#191c1e]">최근 대화</h2>
          <button onClick={createSession} className="text-[#444653] hover:text-[#00288e] transition-colors">
            <span className="material-symbols-outlined text-base">edit_square</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {grouped.today.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">오늘</h3>
              {renderList(grouped.today)}
            </div>
          )}
          {grouped.yesterday.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">어제</h3>
              {renderList(grouped.yesterday)}
            </div>
          )}
          {grouped.older.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] font-semibold text-[#757684] uppercase tracking-wider px-2 py-1">이전</h3>
              {renderList(grouped.older)}
            </div>
          )}
        </div>
      </div>

      {!activeSession ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#f7f9fb] py-8">
          {emptyState}
          <button
            onClick={createSession}
            className="mt-6 bg-[#00288e] text-white text-sm font-semibold rounded-lg px-5 py-2.5 hover:bg-[#1e40af] transition-colors shadow-sm flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base">add</span>새 대화 시작
          </button>
        </div>
      ) : (
        <ChatPanel chat={chat} variant="full" emptyState={emptyState} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles + lint**

Run: `cd frontend && pnpm typecheck && pnpm lint 2>&1 | tail -20`

Expected: no errors.

- [ ] **Step 3: Manually verify in browser**

Run frontend (`cd frontend && pnpm dev`) + backend. Log in, open `/chat`:
- Create new session.
- Send "근무 시간 변경해줘" in change_request mode → answer + citation cards + SR draft card + "SR 보내기" button.
- Click "SR 보내기" → success (or Jira not configured error, but request fires).
- Click "오류 수정 요청" → textarea appears → submit → success notice.
- Delete session → returns to empty state.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Chat.tsx
git commit -m "refactor(frontend): /chat uses shared ChatPanel + useChatSession"
```

---

## Task 10: Frontend — refactor `WidgetDemo.tsx` with login toggle

**Files:**
- Modify: `frontend/src/pages/WidgetDemo.tsx`

- [ ] **Step 1: Rewrite `WidgetDemo.tsx`**

Keep the airline-demo hero/bento/footer JSX unchanged from the original. Replace the chat panel block with `<ChatPanel variant="compact">` and add a navbar dropdown for the demo login toggle.

> The original file is 398 lines and ~70% is decorative airline demo HTML. The block to replace is the floating chatbot panel (lines ~248-396 in current file).

Replace `frontend/src/pages/WidgetDemo.tsx` with:

```tsx
import { useState, useEffect, useMemo } from "react"
import { Link } from "react-router-dom"
import { useChatSession } from "@/hooks/useChatSession"
import { buildWidgetAdapter } from "@/lib/chatAdapters"
import { ChatPanel } from "@/components/chat/ChatPanel"

const DEMO_USER_ID = "demo-user-001"

export function WidgetDemo() {
  const [chatOpen, setChatOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loginDropdownOpen, setLoginDropdownOpen] = useState(false)
  const [demoUserId, setDemoUserId] = useState<string | null>(null)

  const adapter = useMemo(() => buildWidgetAdapter(demoUserId), [demoUserId])

  const chat = useChatSession({
    sessionId,
    userId: demoUserId,
    api: adapter,
  })

  async function ensureSession() {
    if (sessionId) return sessionId
    const res = await fetch("/api/widget/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: "demo_asiana",
        anonymous_id: "demo_user",
        user_id: demoUserId,
      }),
    })
    const data = await res.json()
    const id = data.id
    setSessionId(id)
    return id
  }

  useEffect(() => {
    // mode toggle → reset everything, force new session next send
    setSessionId(null)
    chat.resetAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoUserId])

  // Wrap chat.send so the first message creates a session lazily.
  const originalSend = chat.send
  const sendWithSession = async () => {
    if (!sessionId) {
      const id = await ensureSession()
      setSessionId(id)
      // useChatSession's send uses the latest sessionId via closure; one tick wait.
      setTimeout(() => originalSend(), 0)
      return
    }
    originalSend()
  }

  const chatWithLazySend = { ...chat, send: sendWithSession }

  const emptyState = (
    <div className="text-center text-sm text-[#444653] mt-8">
      <span className="material-symbols-outlined text-4xl text-[#00288e] mb-2 block" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
      안녕하세요! DocOps AI 어시스턴트입니다.<br />무엇을 도와드릴까요?
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f9fb] text-[#191c1e] font-['Inter',sans-serif] relative">
      {/* Top NavBar */}
      <nav className="bg-white flex justify-between items-center px-6 w-full h-16 border-b border-[#c4c5d5] shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-8">
          <div className="text-2xl font-bold text-[#00288e] cursor-pointer">DocOps AI</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => setLoginDropdownOpen(o => !o)}
              className="text-sm text-[#00288e] hover:text-[#1e40af] px-4 py-1 flex items-center gap-1"
            >
              {demoUserId ? `로그인됨: ${demoUserId}` : "로그인"}
              <span className="material-symbols-outlined text-base">expand_more</span>
            </button>
            {loginDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[#c4c5d5] rounded-lg shadow-lg p-2 w-64 z-50">
                <p className="text-[10px] text-[#757684] px-2 pb-2 border-b border-[#c4c5d5] mb-2">SSO 연동 시뮬레이션 (해커톤 데모)</p>
                <button
                  onClick={() => { setDemoUserId(null); setLoginDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm rounded ${demoUserId === null ? "bg-[#f2f4f6] font-semibold" : "hover:bg-[#f2f4f6]"}`}
                >
                  ○ 익명 (게스트)
                </button>
                <button
                  onClick={() => { setDemoUserId(DEMO_USER_ID); setLoginDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm rounded ${demoUserId === DEMO_USER_ID ? "bg-[#f2f4f6] font-semibold" : "hover:bg-[#f2f4f6]"}`}
                >
                  ● 로그인 사용자<br />
                  <span className="text-xs text-[#757684]">{DEMO_USER_ID}</span>
                </button>
              </div>
            )}
          </div>
          <Link to="/" className="text-xs font-semibold bg-[#00288e] text-white rounded-lg px-4 py-2 hover:bg-[#1e40af] transition-colors shadow-sm">대시보드</Link>
        </div>
      </nav>

      {/* Hero, bento grid, footer — copy unchanged from original WidgetDemo */}
      <section className="flex-1 flex items-center justify-center py-16">
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold">가상 항공사 데모</h1>
          <p className="text-[#444653]">오른쪽 아래 챗봇으로 위젯 동작을 시연하세요.</p>
        </div>
      </section>

      {/* Floating Chatbot */}
      {chatOpen ? (
        <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end">
          <div className="w-[400px] h-[550px] bg-white rounded-xl shadow-[0_10px_25px_rgba(0,0,0,0.15)] border border-[#c4c5d5] flex flex-col overflow-hidden">
            <div className="bg-[#00288e] text-white p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                <span className="text-xl font-semibold">DocOps AI 어시스턴트</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-white/80 hover:text-white p-1">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <ChatPanel chat={chatWithLazySend} variant="compact" emptyState={emptyState} />
          </div>
        </div>
      ) : (
        <button onClick={() => setChatOpen(true)} className="fixed bottom-8 right-8 z-50 w-14 h-14 rounded-full bg-[#00288e] text-white shadow-lg hover:bg-[#1e40af] transition-all hover:scale-105 flex items-center justify-center">
          <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
        </button>
      )}
    </div>
  )
}
```

> The hero/bento/footer sections from the original 398-line file can be kept verbatim if desired; this plan replaces them with a minimal placeholder section to keep the diff focused. If the user wants the airline UI restored, copy lines 100-246 from the original `WidgetDemo.tsx` (git history) into the slot marked "Hero, bento grid, footer".

- [ ] **Step 2: Add a seed for `demo-user-001` in backend dev**

Check whether the User table has `demo-user-001` already. If not, manually create via DB or use existing test_user fixture as a seed script.

Run: `cd backend && uv run python -c "
import asyncio, uuid
from sqlalchemy import select
from app.db import async_session_maker
from app.models.user import User
async def seed():
    async with async_session_maker() as db:
        result = await db.execute(select(User).where(User.id == 'demo-user-001'))
        if not result.scalar_one_or_none():
            db.add(User(id='demo-user-001', name='Demo User', email='demo@docops.ai', role='user'))
            await db.commit()
            print('seeded')
        else:
            print('already exists')
asyncio.run(seed())
"`

> If the User.id column is UUID-typed (not string), use a fixed UUID like `00000000-0000-0000-0000-000000000010` instead. Update `DEMO_USER_ID` in `WidgetDemo.tsx` accordingly.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && pnpm typecheck 2>&1 | tail -10`

Expected: no errors.

- [ ] **Step 4: Manual browser test**

Visit `/widget-demo`:
- Click chat button → panel opens, empty state.
- Type "휴가 정책 알려줘" → answer streams, citation line shown ("출처: ..."), no mode tabs, no SR card, no feedback button.
- Click navbar "로그인" → choose "로그인 사용자". Toast/visual feedback confirms switch.
- Panel auto-resets to empty state. Mode tabs appear.
- Switch to "변경 요청" tab → "근무 시간 늘려줘" → answer + citation + SR draft card + "SR 보내기" button + feedback button visible.
- Click "SR 보내기" → success or 403 (if seed user missing).
- Click "오류 수정 요청" → form appears → submit.
- Switch back to 익명 → session reset, SR/feedback hidden again.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WidgetDemo.tsx
git commit -m "refactor(frontend): WidgetDemo uses ChatPanel + login toggle"
```

---

## Task 11: Frontend — vanilla widget `api.ts` event handling

**Files:**
- Modify: `frontend/src/widget/api.ts`

- [ ] **Step 1: Update `WidgetConfig` and `askStream`**

Edit `frontend/src/widget/api.ts`:

```ts
import { parseSSE } from "./sse"

export interface WidgetConfig {
  siteId: string
  apiUrl: string
  userId?: string | null
  primaryColor?: string
  position?: "bottom-right" | "bottom-left"
}

export interface WidgetCitation {
  document_id?: string
  document_title?: string
  quote?: string
}

export interface WidgetWarning {
  document_id: string
  title: string
  reason: string
}

export interface WidgetMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: WidgetCitation[]
  warnings?: WidgetWarning[]
}

export async function createSession(config: WidgetConfig, anonymousId: string) {
  const res = await fetch(`${config.apiUrl}/api/widget/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site_id: config.siteId,
      anonymous_id: anonymousId,
      user_id: config.userId ?? null,
    }),
  })
  return res.json() as Promise<{ id: string; site_id: string; anonymous_id: string }>
}

export async function getMessages(config: WidgetConfig, sessionId: string) {
  const res = await fetch(`${config.apiUrl}/api/widget/sessions/${sessionId}/messages`)
  return res.json() as Promise<WidgetMessage[]>
}

export async function* askStream(config: WidgetConfig, sessionId: string, question: string) {
  const res = await fetch(`${config.apiUrl}/api/widget/sessions/${sessionId}/ask-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error("Stream request failed")

  for await (const event of parseSSE(res)) {
    if (event.event === "token") {
      const { token } = JSON.parse(event.data)
      yield { type: "token" as const, token: token as string }
    } else if (event.event === "citations") {
      const data = JSON.parse(event.data)
      yield {
        type: "citations" as const,
        citations: data.citations as WidgetCitation[],
        warnings: data.warnings as WidgetWarning[],
      }
    } else if (event.event === "done") {
      const data = JSON.parse(event.data)
      yield { type: "done" as const, messageId: data.message_id as string }
    }
  }
}
```

- [ ] **Step 2: TypeScript compiles**

Run: `cd frontend && pnpm typecheck 2>&1 | tail -10`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/widget/api.ts
git commit -m "feat(widget): handle citations/warnings events in vanilla widget api"
```

---

## Task 12: Frontend — vanilla widget styles for citation/warning

**Files:**
- Modify: `frontend/src/widget/styles.ts`

- [ ] **Step 1: Read current styles to find insertion point**

Run: `head -60 frontend/src/widget/styles.ts`

- [ ] **Step 2: Append citation + warning styles**

Add to the styles string in `getWidgetStyles`:

```css
.docops-citations {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #c4c5d5;
  font-size: 11px;
  color: #444653;
  line-height: 1.4;
}
.docops-warning {
  background: rgba(255, 219, 206, 0.4);
  border: 1px solid #ffdbce;
  color: #611e00;
  padding: 6px 10px;
  margin-top: 8px;
  border-radius: 6px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.docops-warning::before {
  content: "⚠";
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/widget/styles.ts
git commit -m "feat(widget): citation + warning styles"
```

---

## Task 13: Frontend — vanilla widget `main.ts` rendering

**Files:**
- Modify: `frontend/src/widget/main.ts`

- [ ] **Step 1: Add security comment + user_id read + citation/warning rendering**

Edit `frontend/src/widget/main.ts`:

At the top of the file (after imports):

```ts
/**
 * SECURITY: `data-user-id` is set by the host site and cannot be verified
 * by this widget. SR submission and feedback creation are intentionally NOT
 * exposed here until SSO/JWT verification is implemented end-to-end.
 * The React WidgetDemo (`/widget-demo`) is the safe surface for showcasing
 * authenticated features in the meantime.
 */
```

In `init()`:

```ts
const config: WidgetConfig = {
  siteId: script?.dataset.siteId || globalConfig.siteId || "default",
  apiUrl: script?.dataset.apiUrl || globalConfig.apiUrl || window.location.origin,
  userId: script?.dataset.userId || null,
  primaryColor: script?.dataset.primaryColor || globalConfig.primaryColor || "#e94560",
  position: (script?.dataset.position || globalConfig.position || "bottom-right") as WidgetConfig["position"],
}
```

Replace `send()` body to consume citation + warning events and attach to streamMsg:

```ts
private async send() {
  const question = this.inputEl!.value.trim()
  if (!question || !this.sessionId || this.isStreaming) return

  this.inputEl!.value = ""
  this.isStreaming = true
  this.messages.push({ id: "temp-user", role: "user", content: question })
  this.renderMessages()

  const streamMsg: WidgetMessage = { id: "temp-bot", role: "assistant", content: "" }
  this.messages.push(streamMsg)
  this.renderMessages()

  try {
    for await (const event of askStream(this.config, this.sessionId, question)) {
      if (event.type === "token") {
        streamMsg.content += event.token
        this.renderMessages()
      } else if (event.type === "citations") {
        streamMsg.citations = event.citations
        streamMsg.warnings = event.warnings
        this.renderMessages()
      } else if (event.type === "done") {
        streamMsg.id = event.messageId
      }
    }
  } catch {
    streamMsg.content = "죄송합니다, 응답 중 오류가 발생했습니다."
    this.renderMessages()
  }

  this.isStreaming = false
  this.renderMessages()
}
```

Replace `renderMessages()` to include citation + warning:

```ts
private renderMessages() {
  if (!this.messagesEl) return
  this.messagesEl.innerHTML = this.messages
    .map(m => {
      const citations = m.citations?.length
        ? `<div class="docops-citations">출처: ${m.citations.map(c => this.escapeHtml(c.document_title || "참고 문서")).join(", ")}</div>`
        : ""
      const warning = m.warnings?.length
        ? `<div class="docops-warning">${this.escapeHtml(m.warnings.map(w => w.title).join(", "))}</div>`
        : ""
      return `<div class="docops-msg ${m.role}">${this.escapeHtml(m.content)}${citations}</div>${warning}`
    })
    .join("")
  this.messagesEl.scrollTop = this.messagesEl.scrollHeight
}
```

Remove `updateLastMessage` (no longer needed — `renderMessages` is now incremental-safe).

- [ ] **Step 2: TypeScript compiles**

Run: `cd frontend && pnpm typecheck 2>&1 | tail -10`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/widget/main.ts
git commit -m "feat(widget): render citations + warnings, read data-user-id"
```

---

## Task 14: Vanilla widget test page

**Files:**
- Create: `frontend/public/widget-test.html`

- [ ] **Step 1: Create test HTML**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>DocOps Widget — vanilla embed test</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 40px; }
  .host { max-width: 800px; }
  .controls { background: #f7f9fb; border: 1px solid #c4c5d5; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
  code { background: #f2f4f6; padding: 2px 6px; border-radius: 3px; }
</style>
</head>
<body>
<div class="host">
  <h1>Vanilla widget — embed test</h1>
  <div class="controls">
    <p>This page loads <code>/widget.js</code> as a 3rd-party host would.</p>
    <p>Open the chat button in the bottom-right.</p>
    <p>Expected: answer + citation line + (sometimes) warning banner. <strong>No</strong> SR card, <strong>no</strong> feedback button.</p>
  </div>
  <p>Lorem ipsum dolor sit amet, host site content.</p>
</div>

<!-- Load the vanilla widget bundle. Adjust src to your dev URL. -->
<script
  src="/widget.js"
  data-site-id="vanilla-test"
  data-api-url="http://localhost:8000"
  defer></script>
</body>
</html>
```

> The widget bundle path (`/widget.js`) depends on the project's vite config. If the project builds the widget into `dist/widget.js` separately, point `src` at that path. Otherwise during `pnpm dev`, use the Vite-served entry like `/src/widget/main.ts` with `type="module"`.

- [ ] **Step 2: Manual verification**

Run frontend + backend dev servers. Open `http://localhost:5173/widget-test.html`:
- Click bottom-right floating button → panel opens.
- Send question → answer streams, citation line appears.
- Open browser devtools → confirm no SR card / feedback button DOM.
- Add `data-user-id="demo-user-001"` to the script tag, refresh. Panel still does NOT show SR or feedback (intentional — vanilla is read-only per spec §7).

- [ ] **Step 3: Commit**

```bash
git add frontend/public/widget-test.html
git commit -m "test(widget): static page to embed vanilla widget for manual QA"
```

---

## Task 15: End-to-end smoke + final regression

**Files:** none (verification only)

- [ ] **Step 1: Backend full test pass**

Run: `cd backend && uv run pytest 2>&1 | tail -15`

Expected: all green. If failing test references `db_session` fixture that didn't exist, add to `backend/tests/conftest.py`:

```python
@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with TestingSessionLocal() as session:
        yield session
```

(Use the same TestingSessionLocal pattern already in conftest.)

- [ ] **Step 2: Frontend lint + typecheck**

Run: `cd frontend && pnpm typecheck && pnpm lint 2>&1 | tail -20`

Expected: no errors.

- [ ] **Step 3: Manual smoke matrix**

| Surface | Anonymous | Authenticated |
|---------|-----------|---------------|
| `/chat` (logged-in user) | n/a | answer + citation grid + warning + SR card + SR send + feedback ✓ |
| `/widget-demo` (toggle OFF) | answer + citation line + warning, no SR/feedback ✓ | toggle ON → new session + SR card + SR send + feedback ✓ |
| `/widget-test.html` (vanilla) | answer + citation line + warning ✓ | data-user-id set → no behavior change (still read-only) ✓ |

Confirm each cell.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git status
# If any tidy-up needed, commit. Otherwise nothing.
```

---

## Self-Review Notes

- **Spec coverage**: §4 권한 모델 → Tasks 3,4,5 (backend) + Task 7 (frontend permission via adapter). §5 아키텍처 → Tasks 6-9. §6 토글 UX → Task 10. §7 vanilla → Tasks 11-14. §8 백엔드 → Tasks 1-5. §9 변경 파일 → all covered. §10.1 backend tests → Tasks 2,3,4,5. §10.2 frontend manual → Tasks 9 step 3, 10 step 4, 14 step 2.
- **Type consistency**: `ChatApiAdapter` defined in Task 6, used same field names in Tasks 7-10. `WidgetMessage` extended in Task 11 with `citations`/`warnings`, used in Task 13. `useChatSession` `resetAll` defined Task 7, called Tasks 9 + 10.
- **No placeholders**: every step has concrete code or commands. Two intentional inline TODOs in Task 10 step 2 (DEMO_USER_ID format depending on User.id type) and Task 14 step 1 (widget bundle path depending on vite config) — both are documented escape hatches, not unspecified work.
