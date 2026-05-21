# Chat / Widget Feature Parity Design

**Date**: 2026-05-21
**Status**: Draft — awaiting user review

## 1. 배경

`/chat` 페이지(`Chat.tsx`)와 위젯 데모(`WidgetDemo.tsx`)가 같은 백엔드 챗봇을 호출함에도 UI 기능 격차가 큼.

| 기능 | `/chat` | `WidgetDemo` (React) | vanilla `main.ts` |
|------|---------|----------------------|-------------------|
| 답변 + token 스트리밍 | ✓ | ✓ | ✓ |
| Citation 카드 | ✓ (그리드) | ✓ (한 줄) | ✗ |
| Warning (신뢰도 낮은 문서) | ✓ | ✗ | ✗ |
| 질문/변경 요청 모드 탭 | ✓ | ✓ | ✗ |
| SR 초안 카드 | ✓ | ✓ (제목만) | ✗ |
| SR Jira 전송 버튼 | ✓ | ✗ | ✗ |
| 오류 제보 (피드백) | ✓ | ✗ | ✗ |

백엔드 `chat_service.ask_question_stream`은 `/api/chat`과 `/api/widget` 둘 다에서 호출되며 동일 SSE 이벤트(`token`/`citations`/`done`+`sr_draft`)를 발생시킴. 프론트엔드가 이 데이터를 일부만 활용 중.

## 2. 목표

1. **기능 동등화**: `/chat`과 widget(데모 + vanilla 임베드) 채팅 기능을 권한 모델 안에서 정렬.
2. **익명/로그인 권한 분리**: 임베드 위젯의 익명 사용자가 SR/Jira 티켓 생성·피드백 무한 등록하는 것을 방지.
3. **향후 SSO 연동 대비**: 외부 사이트에서 임베드 시 호스트 사이트의 로그인 사용자 ID를 우리 시스템에 전달할 인터페이스 자리 마련 (해커톤에서 검증은 구현 안 함).
4. **데모 시연 가능성**: `WidgetDemo` 한 페이지에서 익명·로그인 두 권한을 토글로 시연 가능.
5. **유지보수성**: React 두 화면(`Chat.tsx`/`WidgetDemo.tsx`)의 채팅 UI 중복 제거.

## 3. 비목표

- 실제 SSO/JWT 검증 구현 (해커톤 이후).
- 백엔드 `chat_service` 핵심 로직 재작성.
- 위젯 세션 데이터 마이그레이션.
- `/chat`의 사이드바·세션 그룹화 변경.

## 4. 권한 모델

3단 상태:

| 상태 | 진입 경로 | userId | citation | warning | SR 카드/전송 | 피드백 |
|------|----------|--------|----------|---------|---------------|--------|
| `anonymous` | widget 익명 (data-user-id 없음, WidgetDemo 토글 OFF) | `null` | ✓ | ✓ | ✗ | ✗ |
| `authenticated-widget` | widget 로그인 (WidgetDemo 토글 ON) | host 사용자 ID | ✓ | ✓ | ✓ | ✓ |
| `authenticated-main` | `/chat` (메인 앱 useAuth) | user.id | ✓ | ✓ | ✓ | ✓ |

권한은 **API 어댑터에 함수가 정의되어 있는지 여부**로 표현. 컴포넌트는 권한 자체를 모름.

**vanilla `main.ts` 예외**: 임베드 위젯은 `data-user-id` 유무와 상관없이 항상 읽기 전용(citation + warning). SR/피드백은 SSO/JWT 검증 구현 전까지 노출 안 함 (§7 참조). 위 권한표의 `authenticated-widget` 행은 **WidgetDemo(React) 채널에만** 해당.

## 5. 아키텍처

### 5.1 폴더 구조

```
frontend/src/
├── components/
│   └── chat/
│       ├── ChatPanel.tsx          # 메시지 리스트 + input + 모드 탭 (공유)
│       ├── ChatMessage.tsx        # 메시지 + citation + SR 카드 + 액션
│       └── ChatInput.tsx          # 입력 영역 + 모드 탭
├── hooks/
│   └── useChatSession.ts          # 세션/메시지/SSE/SR/피드백 상태 관리
├── lib/
│   ├── api.ts                     # 기존 main app API (변경 거의 없음)
│   └── chatAdapters.ts            # ChatApiAdapter 빌더 (신규)
├── pages/
│   ├── Chat.tsx                   # 사이드바 + <ChatPanel variant="full"/>
│   └── WidgetDemo.tsx             # 네비바 토글 + floating <ChatPanel variant="compact"/>
└── widget/
    ├── main.ts                    # vanilla, citation/warning만 추가
    ├── api.ts                     # askStream에 citations/done.sr_draft 이벤트 처리 추가
    └── styles.ts                  # citation/warning 스타일 추가
```

### 5.2 데이터 흐름

```
ChatPanel (presentation)
   ▲
   │ chat 객체 (상태 + 핸들러)
   │
useChatSession (state + side effects)
   ▲
   │ ChatApiAdapter (endpoint 추상화)
   │
chatApiAdapter | widgetApiAdapter
   │
   ▼
/api/chat/*  |  /api/widget/*  |  /api/sr/*  |  /api/feedback
```

`useChatSession` 안에 모든 상태(messages, citations, warnings, srDrafts, feedback)와 핸들러(send, sendSR, submitFeedback) 집중. ChatPanel은 표현만.

### 5.3 ChatApiAdapter 인터페이스

```ts
interface ChatApiAdapter {
  getMessages(sessionId: string): Promise<ChatMessage[]>
  askStream(sessionId: string, question: string): AsyncIterable<StreamEvent>
  submitSR?(draftId: string): Promise<{ jira_issue_key?: string }>
  submitFeedback?(data: FeedbackPayload): Promise<FeedbackResult>
}

// submitSR / submitFeedback가 undefined면 ChatPanel은 해당 UI 비표시.
// 권한 분기 = "함수 존재 여부".
```

빌더:

```ts
// chatAdapters.ts
function buildChatAdapter(userId: string): ChatApiAdapter
function buildWidgetAdapter(userId: string | null): ChatApiAdapter
// userId=null → submitSR/submitFeedback 미정의 → 익명 UI
// userId 있음 → 전체 정의
```

### 5.4 useChatSession 시그니처

```ts
interface UseChatSessionArgs {
  sessionId: string | null
  userId: string | null
  api: ChatApiAdapter
  onSessionAutoCreate?: () => Promise<string>   // widget 자동 세션 생성용
}

function useChatSession(args: UseChatSessionArgs): ChatSessionState
```

ChatSessionState는 messages/citations/citationsByMessage/warnings/loading/input/setInput/send + chatMode/setChatMode + srDraftsByMessage/srSentById/srSendingId/srSendErrorById/sendSR + feedbackFor/feedbackText/feedbackSubmitting/feedbackSuccess/feedbackNotice/openFeedback/cancelFeedback/setFeedbackText/submitFeedback.

### 5.5 ChatPanel props

```tsx
interface ChatPanelProps {
  chat: ChatSessionState
  variant: "full" | "compact"     // full = /chat 전체화면, compact = floating panel
  emptyState?: React.ReactNode    // 메시지 없을 때 placeholder
}
```

variant에 따라 패딩/max-width/citation 카드 그리드 vs 한 줄 결정.

## 6. WidgetDemo 토글 UX

데모 페이지 네비바의 "로그인" 버튼을 드롭다운으로 hijack.

```
┌──────────────────────────────────────────────────────────┐
│ DocOps AI  메뉴 …       [로그인 ▼]  [대시보드]           │
└──────────────────────────────────┬───────────────────────┘
                                   │
                            ┌──────┴───────────┐
                            │ ○ 익명           │
                            │ ● 로그인 사용자  │
                            │   demo-user-001  │
                            └──────────────────┘
```

- 가상 user_id = `demo-user-001` (DB에 미리 시드되거나 첫 호출 시 자동 생성).
- 모드 전환 시 **기존 세션 폐기, 새 세션 생성**. 토스트로 "새 대화가 시작되었습니다" 안내.
- floating panel 안 ChatPanel은 `useMemo(() => buildWidgetAdapter(demoUser), [demoUser])`로 어댑터 재생성.

## 7. vanilla main.ts 처리

scope: **citation + warning만** 추가. SR/피드백은 자리만 코드에 둠.

근거:
- `data-user-id`는 외부 호스트가 임의 주입 가능 → SSO/JWT 검증 없는 상태에서 SR/피드백 활성화 = 무인증 mutation API 노출.
- CORS·번들 크기·XSS 위험·유지보수 부담 모두 증가.
- 시연은 WidgetDemo로 충분 (가짜 항공사 페이지가 외부 임베드 대역).

### 7.1 config 확장

```ts
// widget/api.ts
export interface WidgetConfig {
  siteId: string
  apiUrl: string
  userId?: string | null      // 신규. data-user-id에서 읽음
  primaryColor?: string
  position?: "bottom-right" | "bottom-left"
}
```

### 7.2 init 변경

```ts
// widget/main.ts
const config: WidgetConfig = {
  siteId: script?.dataset.siteId || ...,
  apiUrl: script?.dataset.apiUrl || ...,
  userId: script?.dataset.userId || null,
  ...
}
```

### 7.3 SSE 이벤트 확장

`askStream`이 `citations`/`done.sr_draft` 이벤트도 yield. 단, vanilla 측에서 sr_draft는 무시(렌더링 안 함).

```ts
for await (const event of parseSSE(res)) {
  if (event.event === "token") yield { type: "token", token }
  else if (event.event === "citations") yield { type: "citations", citations, warnings }
  else if (event.event === "done") yield { type: "done", messageId, sr_draft }
}
```

### 7.4 메시지 렌더 변경

assistant 메시지 아래에 citation 한 줄(`출처: 문서A, 문서B`)과 warning 배너(있을 때만) 추가.

```ts
private renderMessage(m: WidgetMessage): string {
  const citations = m.citations?.length
    ? `<div class="docops-citations">출처: ${m.citations.map(c => this.escapeHtml(c.document_title)).join(", ")}</div>`
    : ""
  const warning = m.warning
    ? `<div class="docops-warning">⚠ ${this.escapeHtml(m.warning)}</div>`
    : ""
  return `<div class="docops-msg ${m.role}">${this.escapeHtml(m.content)}${citations}${warning}</div>`
}
```

### 7.5 SR/피드백 자리

```ts
// main.ts
private renderSRSlot(m: WidgetMessage): string {
  // TODO(post-hackathon): SSO/JWT 검증 후 활성화
  // if (!this.config.userId || !this.config.ssoVerified) return ""
  return ""
}
```

코드 자리만 명시. 실제 노출 X.

### 7.6 보안 코멘트

```ts
// main.ts 상단
// SECURITY: data-user-id는 호스트 사이트가 임의로 설정 가능.
// SSO/JWT 검증 구현 전까지 SR 제출·피드백 등 mutation API는
// vanilla widget에서 노출하지 않음. WidgetDemo(React)에서만 시연.
```

## 8. 백엔드 변경

### 8.1 schema (`backend/app/schemas/widget.py`)

```python
class WidgetSessionCreate(BaseModel):
    site_id: str
    anonymous_id: Optional[str] = None
    user_id: Optional[str] = None    # 신규
```

### 8.2 widget router (`backend/app/routers/widget.py`)

- `create_widget_session`:
  - `data.user_id` 있으면 해당 User 존재 검증 (없으면 404). 세션 owner = data.user_id.
  - 없으면 기존대로 `WIDGET_USER_ID` owner.
- `widget_ask_stream`:
  - 세션 조회 후 `allow_sr_draft = (session.user_id != WIDGET_USER_ID)`.
  - `chat_service.ask_question_stream(..., allow_sr_draft=allow_sr_draft)` 호출.

### 8.3 chat_service (`backend/app/services/chat_service.py`)

```python
async def ask_question_stream(
    db, session_id, question,
    *, allow_sr_draft: bool = True,
):
    ...
    if allow_sr_draft and looks_like_change_request:
        sr_draft = SRDraft(...)
        db.add(sr_draft)
        sr_draft_data = {...}
    # 익명 widget 호출 = allow_sr_draft=False → SRDraft DB row 미생성.
```

`/api/chat/*`는 변경 없음 (default True 사용).

### 8.4 SR submit 가드 (`backend/app/routers/sr.py`)

```python
@router.post("/drafts/{sr_id}/submit")
async def submit_sr(sr_id, db, ...):
    draft = await sr_service.get_draft(db, sr_id)
    # SRDraft가 user_id 컬럼 직접 가지면 그 값 사용, 없으면 session.user_id로 역추적
    owner_user_id = draft.user_id or draft.session.user_id
    if owner_user_id == WIDGET_USER_ID:
        raise HTTPException(403, "anonymous SR submit not allowed")
    ...
```

> 구현 시 SRDraft 모델 필드 확인 후 정확한 owner 경로 결정.

### 8.5 Feedback 가드 (`backend/app/routers/feedback.py`)

```python
@router.post("")
async def create_feedback(data, db, ...):
    if str(data.user_id) == str(WIDGET_USER_ID):
        raise HTTPException(403, "anonymous feedback not allowed")
    ...
```

## 9. 변경 파일 목록

**신규**:
- `frontend/src/components/chat/ChatPanel.tsx`
- `frontend/src/components/chat/ChatMessage.tsx`
- `frontend/src/components/chat/ChatInput.tsx`
- `frontend/src/hooks/useChatSession.ts`
- `frontend/src/lib/chatAdapters.ts`

**수정**:
- `frontend/src/pages/Chat.tsx` — 사이드바만 유지, 나머지는 ChatPanel + useChatSession.
- `frontend/src/pages/WidgetDemo.tsx` — 네비바 로그인 토글, ChatPanel 통합.
- `frontend/src/widget/main.ts` — citation/warning 렌더, data-user-id 읽기.
- `frontend/src/widget/api.ts` — WidgetConfig.userId, askStream 이벤트 확장.
- `frontend/src/widget/styles.ts` — citation/warning 스타일.
- `backend/app/schemas/widget.py` — WidgetSessionCreate.user_id.
- `backend/app/routers/widget.py` — user_id 처리, allow_sr_draft 분기.
- `backend/app/routers/sr.py` — submit 가드.
- `backend/app/routers/feedback.py` — POST 가드.
- `backend/app/services/chat_service.py` — allow_sr_draft 파라미터.

## 10. 테스트 계획

### 10.1 Backend (pytest)

| 테스트 | 검증 |
|--------|------|
| `test_widget_session_create_anonymous` | user_id 없이 생성 → session.user_id == WIDGET_USER_ID |
| `test_widget_session_create_authenticated` | user_id 전달 → session.user_id == 해당 ID |
| `test_widget_session_create_unknown_user` | 존재 안 하는 user_id → 404 |
| `test_widget_ask_stream_anonymous_no_sr_draft` | 익명 세션 변경요청 → SSE done.sr_draft 없음 + DB SRDraft 없음 |
| `test_widget_ask_stream_authenticated_creates_sr_draft` | 로그인 widget 세션 → sr_draft 포함 |
| `test_sr_submit_blocks_widget_user` | WIDGET_USER_ID 소유 draft submit → 403 |
| `test_feedback_blocks_widget_user` | user_id=WIDGET_USER_ID → 403 |
| `test_chat_route_unchanged` | `/api/chat/*` 호출은 기존 동작 (회귀) |

### 10.2 Frontend (수동)

- `/chat` (로그인 사용자)
  - 메시지 송수신, citation 카드, warning, SR 초안+전송, 피드백 — 모두 회귀 없음.
- `/widget-demo` 익명 모드
  - 답변 + citation + warning 표시.
  - SR 카드·SR 보내기 버튼·오류 제보 버튼 **비표시**.
- `/widget-demo` 로그인 모드 (네비바 토글 ON)
  - 토글 시 세션 리셋 + 새 대화 토스트.
  - 변경 요청 → SR 초안 카드 + "SR 보내기" 표시.
  - "SR 보내기" 클릭 → Jira 키 표시.
  - 오류 제보 폼 동작.
- vanilla widget 임베드: `frontend/public/widget-test.html`(이 spec 범위에서 신규 생성하는 정적 테스트 HTML)에 `<script src="/widget.js" data-site-id="test" data-api-url="http://localhost:8000"></script>` 삽입하여 확인.
  - 답변 + citation 한 줄 + warning 배너 표시.
  - data-user-id 유무 무관하게 SR/피드백 미노출.
  - `data-user-id="demo-user-001"`로 시도 → 세션 생성은 성공하지만 UI는 동일 (자리만 마련됨).

### 10.3 회귀 확인

- 기존 `/api/widget/sessions` 호출 (user_id 필드 없음) → 익명 세션 정상 생성.
- 기존 `/api/chat/*` 흐름 변경 없음.

## 11. 마이그레이션

- DB 스키마 변경 없음 (WIDGET_USER_ID는 이미 존재).
- 기존 익명 widget 세션 그대로 사용 가능.
- 환경변수 추가 없음.

## 12. 리스크 / 오픈 이슈

| 항목 | 위험 | 완화 |
|------|------|------|
| SRDraft 모델의 owner 표현 방식 | `user_id` 컬럼 유무에 따라 가드 로직 위치 달라짐 | 구현 단계 첫 단추로 모델 확인 후 결정 |
| chat_service.ask_question_stream의 sr_draft 생성 위치 두 곳 (line 169·296) | allow_sr_draft 분기 둘 다 적용해야 회귀 없음 | 구현 시 두 함수 모두 시그니처 변경 + 테스트 양쪽 호출 경로 |
| WidgetDemo 토글 시 기존 세션 폐기 | 사용자가 입력 중인 텍스트 손실 가능 | 토글 직전 input 비어있지 않으면 confirm 다이얼로그 (추후 개선) |
| vanilla widget의 citation 인용 문장 link | 현재 `href="#"` placeholder. 진짜 문서 URL 미연동 | 별도 작업 (이 spec 범위 외) |
| SSO 미구현 상태에서 WidgetDemo 토글이 "실제 동작처럼" 보임 | 시연 후 외부에 "이미 SSO 작동" 오해 가능 | 데모 토글 옆에 "SSO 연동 시뮬레이션" 라벨 표시 |
