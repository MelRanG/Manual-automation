# Demo Widget Logged-In Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/demo-widget-before` 와 `/demo-widget-after` 두 데모 페이지가 로그인된 사용자처럼 동작해 질문하기/변경요청 탭이 모두 노출되고, 변경요청 시에는 참조 문서를 숨기고 LLM 이 추가 질문 없이 SR 초안을 채워 자동으로 Jira 로 발행한다.

**Architecture:** 프론트엔드는 `DemoWidget` 에 `loggedIn` prop 을 추가해 widget 세션 생성 시 고정 데모 유저 ID 를 전달하고 어댑터에 동일 ID 를 주입한다 (이로써 백엔드의 기존 `allow_sr_draft` 조건과 어댑터의 `submitSR`/`submitFeedback` 노출이 자동으로 켜진다). `useChatSession` 은 메시지별로 어느 모드에서 보낸 응답인지 기록하고, 변경요청 모드에서는 응답 직후 SR draft 를 자동 전송한다. 백엔드는 `RAG_SYSTEM_PROMPT` 의 change_request 분기를 "되묻지 말고 무조건 SR 초안 emit" 로 수정한다.

**Tech Stack:** React + Vite (TypeScript), FastAPI, 기존 widget/SR/Jira 파이프라인 재사용.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `frontend/src/pages/DemoWidget.tsx` | 데모 위젯 본체 — props/state, 세션 생성, 어댑터 구성 | Modify |
| `frontend/src/pages/DemoWidgetBefore.tsx` | Before 페이지 thin wrapper | Modify |
| `frontend/src/pages/DemoWidgetAfter.tsx` | After 페이지 thin wrapper | Modify |
| `frontend/src/hooks/useChatSession.ts` | 채팅 세션 상태, 메시지별 모드 트래킹, change_request 시 SR 자동 전송 | Modify |
| `frontend/src/components/chat/ChatPanel.tsx` | 메시지 렌더링 시 모드 기반 citations 게이팅 | Modify |
| `backend/app/services/chat_service.py` | LLM system prompt — change_request 분기에서 되묻기 금지 | Modify |

---

## Task 1: Frontend — DemoWidget `loggedIn` prop 와 세션/어댑터 분기

**Files:**
- Modify: `frontend/src/pages/DemoWidget.tsx`
- Modify: `frontend/src/pages/DemoWidgetBefore.tsx`
- Modify: `frontend/src/pages/DemoWidgetAfter.tsx`

- [ ] **Step 1: `DemoWidget.tsx` 에 `DEMO_USER_ID` 상수와 `loggedIn` prop 추가**

`frontend/src/pages/DemoWidget.tsx` 상단 (`import` 직후) 에 상수 추가:

```ts
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"
```

`DemoWidgetProps` 인터페이스에 `loggedIn` 추가:

```ts
export interface DemoWidgetProps {
  allowAllReasons: boolean
  onSaveBehavior: "none" | "weather-modal"
  showEtcInput: boolean
  loggedIn: boolean
}
```

함수 시그니처에서도 받아오게 변경:

```ts
export function DemoWidget({ allowAllReasons, onSaveBehavior, showEtcInput, loggedIn }: DemoWidgetProps) {
```

- [ ] **Step 2: 어댑터 생성 시 `loggedIn` 분기**

`DemoWidget.tsx` 안의 `const adapter = useMemo(...)` 부분을 다음으로 교체:

```ts
const adapter = useMemo(
  () => buildWidgetAdapter(loggedIn ? DEMO_USER_ID : null),
  [loggedIn]
)
```

`useChatSession` 호출의 `userId` 도 동일하게 전달:

```ts
const chat = useChatSession({
  sessionId,
  userId: loggedIn ? DEMO_USER_ID : null,
  api: adapter,
})
```

- [ ] **Step 3: `ensureSession` POST body 의 `user_id` 분기**

`DemoWidget.tsx` 의 `ensureSession` 함수에서 body 의 `user_id` 를 `loggedIn` 에 따라 채움:

```ts
async function ensureSession(): Promise<string> {
  if (sessionId) return sessionId
  const res = await fetch("/api/widget/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site_id: "demo_courier",
      anonymous_id: "demo_courier_user",
      user_id: loggedIn ? DEMO_USER_ID : null,
    }),
  })
  const data = await res.json()
  const id = data.id as string
  setSessionId(id)
  return id
}
```

- [ ] **Step 4: Before / After 페이지에서 `loggedIn={true}` 전달**

`frontend/src/pages/DemoWidgetBefore.tsx` 전체 교체:

```tsx
import { DemoWidget } from "./DemoWidget"

export function DemoWidgetBefore() {
  return (
    <DemoWidget
      allowAllReasons={false}
      onSaveBehavior="none"
      showEtcInput={false}
      loggedIn={true}
    />
  )
}
```

`frontend/src/pages/DemoWidgetAfter.tsx` 전체 교체:

```tsx
import { DemoWidget } from "./DemoWidget"

export function DemoWidgetAfter() {
  return (
    <DemoWidget
      allowAllReasons={true}
      onSaveBehavior="weather-modal"
      showEtcInput={true}
      loggedIn={true}
    />
  )
}
```

- [ ] **Step 5: 타입 체크**

Run: `cd frontend && pnpm typecheck`
Expected: 에러 없음 (0 errors).

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/pages/DemoWidget.tsx frontend/src/pages/DemoWidgetBefore.tsx frontend/src/pages/DemoWidgetAfter.tsx
git commit -m "feat(demo-widget): add loggedIn prop, wire demo user id to widget session"
```

---

## Task 2: Frontend — `useChatSession` 에 메시지별 모드 트래킹 + change_request 시 SR 자동 전송

**Files:**
- Modify: `frontend/src/hooks/useChatSession.ts`

- [ ] **Step 1: 인터페이스에 `modesByMessage` 추가**

`frontend/src/hooks/useChatSession.ts` 의 `ChatSessionState` 인터페이스 안에 `messages` 바로 아래에 다음 줄을 추가:

```ts
modesByMessage: Record<string, ChatMode>
```

- [ ] **Step 2: state 선언 추가**

`useChatSession` 함수 본문, 다른 `useState` 선언들 근처에 추가:

```ts
const [modesByMessage, setModesByMessage] = useState<Record<string, ChatMode>>({})
```

`resetAll` 콜백 안에도 reset 호출 추가 (다른 setter 들과 함께):

```ts
setModesByMessage({})
```

- [ ] **Step 3: `send()` 안의 `done` 이벤트에서 모드 기록 + SR 자동 전송**

`send` 콜백의 `for await (const event of api.askStream(...))` 루프 안의 `event.type === "done"` 분기를 다음으로 교체:

```ts
} else if (event.type === "done") {
  messageId = event.messageId || ""
  srDraft = event.sr_draft
  if (messageId) {
    setModesByMessage(prev => ({ ...prev, [messageId]: chatMode }))
  }
  if (messageId && responseCitations.length) {
    setCitationsByMessage(prev => ({ ...prev, [messageId]: responseCitations }))
  }
  if (srDraft && messageId) {
    const draftToStore = srDraft
    setSrDraftsByMessage(prev => ({ ...prev, [messageId]: draftToStore }))
  }
}
```

- [ ] **Step 4: change_request 자동 SR 전송 — `send()` 의 `finally` 직전에 추가**

`send` 콜백의 `try` 블록 내 `setMessages(prev => prev.map(m => m.id === "streaming" ? ...))` 호출 바로 다음, `} catch {` 직전에 다음 블록 삽입:

```ts
if (srDraft && chatMode === "change_request" && api.submitSR) {
  const autoDraft = srDraft
  // 사용자 클릭 없이 즉시 Jira 전송 — 데모 변경요청 흐름.
  void sendSRRef.current(autoDraft)
}
```

`sendSRRef` 는 다음 스텝에서 도입.

- [ ] **Step 5: `sendSR` 최신 참조용 ref 추가**

`useChatSession` 본문 상단, 다른 ref 선언 근처에 추가:

```ts
const sendSRRef = useRef<(draft: SRDraftCreated) => Promise<void>>(async () => {})
```

`sendSR` 콜백 정의 직후에 ref 동기화:

```ts
useEffect(() => {
  sendSRRef.current = sendSR
}, [sendSR])
```

`SRDraftCreated` 는 파일 상단 import 에 이미 포함되어 있음 — 별도 추가 불필요.

- [ ] **Step 6: 반환 객체에 `modesByMessage` 포함**

`useChatSession` 의 마지막 `return` 객체에 추가:

```ts
return {
  messages, modesByMessage, citations, citationsByMessage, warnings, loading,
  input, setInput, send,
  chatMode, setChatMode,
  srDraftsByMessage, srSentById, srSendingId, srSendErrorById, sendSR,
  feedbackFor, feedbackText, feedbackSubmitting, feedbackSuccess, feedbackNotice,
  openFeedback, cancelFeedback, setFeedbackText, submitFeedback,
  canSubmitSR, canSubmitFeedback,
  resetAll,
}
```

- [ ] **Step 7: 타입 체크**

Run: `cd frontend && pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/hooks/useChatSession.ts
git commit -m "feat(chat): track per-message mode and auto-submit SR for change_request"
```

---

## Task 3: Frontend — `ChatPanel` 에서 change_request 메시지의 citations 숨김

**Files:**
- Modify: `frontend/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: 각 메시지 렌더 시 `modesByMessage` 기반으로 citations 게이팅**

`frontend/src/components/chat/ChatPanel.tsx` 의 `chat.messages.map((msg) => ...)` 블록 안의 `citations` prop 계산식을 다음으로 교체:

```tsx
citations={
  chat.modesByMessage[msg.id] === "change_request"
    ? []
    : (msg.citations?.length
        ? msg.citations
        : chat.citationsByMessage[msg.id]
          || (msg === chat.messages[chat.messages.length - 1] ? chat.citations : []))
}
```

`ChatMessageView` 의 출처 렌더는 이미 `citations.length > 0` 가드를 가지고 있으므로 빈 배열을 전달하면 자동 숨김됨 (별도 변경 불필요).

- [ ] **Step 2: 타입 체크**

Run: `cd frontend && pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/chat/ChatPanel.tsx
git commit -m "feat(chat): hide citations on change_request messages"
```

---

## Task 4: Backend — `RAG_SYSTEM_PROMPT` change_request 분기에서 되묻기 금지

**Files:**
- Modify: `backend/app/services/chat_service.py`

- [ ] **Step 1: `RAG_SYSTEM_PROMPT` 교체**

`backend/app/services/chat_service.py` 의 `RAG_SYSTEM_PROMPT` 정의(파일 상단) 전체를 다음으로 교체:

```python
RAG_SYSTEM_PROMPT = """당신은 DocOps AI 문서 관리 시스템의 AI 어시스턴트입니다.
문서 컨텍스트를 기반으로 질문에 답변합니다.

사용자 메시지가 "[변경 요청]"으로 시작하면, 이것은 문서/시스템 변경 요청입니다.
이 경우 사용자에게 추가 질문을 하지 마세요. 사용자가 제공한 내용만으로 SR 초안을 즉시 만드세요.

다음 항목을 채우세요. 사용자가 제공한 내용에서 채울 수 있는 부분은 채우고,
알 수 없는 항목은 "확인 필요" 로 표시합니다.
- 요청 부서/요청자 맥락
- 현행 상태
- 요구사항
- 기대 효과
- 문서/매뉴얼 현행화 필요 여부

답변 본문에서는 위 항목을 간결히 정리해 보여주고, 답변 맨 끝에 반드시 아래 SR 제안 블록을 포함하세요:

```sr_proposal
{"is_change_request": true, "title": "간결한 SR 제목", "description": "구체적인 변경 내용 설명", "priority": "medium", "target_document": "관련 문서 제목"}
```

priority: high(긴급)/medium(보통)/low(낮음)

"[변경 요청]"으로 시작하지 않는 일반 질문에는 SR 블록 없이 답변만 하세요.
답변은 반드시 한국어로 작성합니다."""
```

- [ ] **Step 2: 기존 테스트 회귀 확인**

Run: `cd backend && uv run pytest -q`
Expected: 모든 테스트 통과 (LLM 응답에 의존하는 새 단위 테스트는 추가하지 않음 — 기존 패턴 유지).

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/chat_service.py
git commit -m "feat(chat): force SR draft emission on change_request, drop clarifying questions"
```

---

## Task 5: 수동 검증 (Manual QA)

**Files:** 없음 (실행만)

- [ ] **Step 1: 백엔드 + 프론트엔드 동시 실행**

두 개의 터미널에서:

```bash
# 터미널 A
cd backend && uv run fastapi dev
# 터미널 B
cd frontend && pnpm dev
```

- [ ] **Step 2: `/demo-widget-before` 검증**

브라우저: `http://localhost:5173/demo-widget-before`

확인 항목:
- 오른쪽 하단 챗봇 버튼 클릭 → 입력창 위에 "질문하기 / 변경 요청" 탭 두 개 노출.
- "질문하기" 탭에서 임의 질문 → 응답 + 출처(참고 문서) 카드 표시.
- "변경 요청" 탭에서 임의 요청 (예: "우천 시 정시 배송률 페널티 면제 부탁드립니다") → 응답에 SR 초안 카드 노출, **참고 문서 영역 미노출**, "SR 전송 완료 (JIRA-xxx 또는 LOCAL-xxx)" 배지 자동 표시.

- [ ] **Step 3: `/demo-widget-after` 검증**

브라우저: `http://localhost:5173/demo-widget-after`
Step 2 와 동일한 항목 확인.

- [ ] **Step 4: 회귀 — anonymous 진입점 (있을 경우)**

`loggedIn` 을 명시하지 않거나 `false` 로 호출하는 진입점이 다른 곳에 있는지:

```bash
grep -rn "<DemoWidget" frontend/src
```

기대: `loggedIn` prop 이 모든 호출지점에 명시되어 있음. (Before/After 두 곳만 호출 — anonymous 진입점은 더 이상 없음.)

---

## Self-Review

- **Spec coverage:**
  - 로그인 가정 → Task 1 ✓
  - 질문하기/변경 요청 탭 노출 → Task 1 (어댑터에 `submitSR` 노출 시 `ChatInput` 의 `showModeTabs` 자동 활성) ✓
  - 변경요청 시 참조 문서 숨김 → Task 3 ✓
  - 재질문 없이 채워서 SR 발행 → Task 4 (백엔드 프롬프트) + Task 2 (auto-sendSR) ✓
- **Placeholder scan:** TBD/TODO/"적절한" 등 없음 ✓
- **Type consistency:** `modesByMessage`, `sendSRRef`, `DEMO_USER_ID` 명칭 일관 ✓

---

Plan complete and saved to `docs/superpowers/plans/2026-05-22-demo-widget-loggedin.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 작업당 fresh subagent 디스패치, 사이사이 리뷰, 빠른 반복.
2. **Inline Execution** — 이 세션에서 executing-plans 로 일괄 진행, 체크포인트마다 리뷰.

Which approach?