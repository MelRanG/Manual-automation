# Demo Widget Logged-In Mode — Design

**Date:** 2026-05-22
**Topic:** `/demo-widget-before` + `/demo-widget-after` 로그인 상태 시뮬레이션
**Status:** Approved

## Goal

데모 페이지 `/demo-widget-before`, `/demo-widget-after` 가 로그인된 사용자 상태로 동작하도록 변경한다. 그 결과:

1. 챗봇에서 **질문하기** 와 **변경 요청** 모드 탭이 모두 보인다 (현재는 anonymous 라 숨김).
2. **변경 요청** 모드에서는 참조 문서(citations) 를 화면에 표시하지 않는다.
3. 변경 요청 시 LLM 이 사용자에게 추가 정보를 되묻지 않고, 사용자가 제공한 내용으로 채울 수 있는 부분만 채워서 SR 초안을 즉시 만들고 **자동으로 Jira issue 를 발행** 한다.

## Non-Goals

- 실제 인증 플로우(SSO/OAuth) 구현. 데모 목적이므로 고정 데모 유저로 mock.
- Widget 의 비로그인 모드 동작 변경 (그대로 유지).
- 채팅 외 영역(배송 폼, 사진, 모달 등) 동작 변경.

## Architecture

### Frontend

#### 1. `DemoWidgetBefore.tsx`, `DemoWidgetAfter.tsx`

`<DemoWidget>` 호출 시 `loggedIn={true}` 추가.

#### 2. `DemoWidget.tsx`

- Props 에 `loggedIn: boolean` 추가.
- `loggedIn` 일 때:
  - `ensureSession()` POST body 에 `user_id = DEMO_USER_ID` (`"00000000-0000-0000-0000-000000000001"`, seed 에서 이미 생성) 포함.
  - `adapter = buildWidgetAdapter(DEMO_USER_ID)` — 기존 로직이 `submitSR` 와 `submitFeedback` 메서드를 어댑터에 부여 → `useChatSession` 의 `canSubmitSR=true` → `ChatInput` 의 mode 탭이 자동 노출.
- 상수 `DEMO_USER_ID` 는 widget 컴포넌트 안에 선언 (백엔드 `WIDGET_USER_ID` 패턴과 동일).

#### 3. `useChatSession.ts`

- 새 상태: `modesByMessage: Record<string, ChatMode>` — 메시지 ID 별로 어느 모드에서 보낸 사용자 메시지에 대한 응답인지 기록.
- `send()` 안의 `done` 이벤트 처리부에서 `messageId` 확정 직후 `modesByMessage[messageId] = chatMode` 저장.
- `done` 이벤트에서 `sr_draft && chatMode === "change_request"` 이면 즉시 `sendSR(srDraft)` 호출 (사용자 클릭 없이 자동 전송).
- 반환 객체에 `modesByMessage` 추가.

#### 4. `ChatPanel.tsx` / `ChatMessageView`

- 메시지 렌더 시 `modesByMessage[msg.id] === "change_request"` 면 citations prop 을 빈 배열로 전달 → 참조 문서 영역 숨김.
- 그 외 동작 동일.

### Backend

#### `chat_service.py` — `RAG_SYSTEM_PROMPT`

기존 change_request 분기:
- 정보 부족 시 1~3 개의 후속 질문을 던지도록 지시되어 있음 → 제거.
- 항상 SR 초안을 생성하도록 변경. 채울 수 있는 항목은 사용자 입력에서 채우고, 모르는 항목은 `"확인 필요"` 로 표시.
- `sr_proposal` JSON 블록 emission 은 무조건 수행.

변경 후 핵심 지시 (요약):
> `[변경 요청]` 으로 시작하면 **되묻지 말고** 사용자가 준 내용으로 최선을 다해 다음 필드를 채워라. 부족한 항목은 `"확인 필요"` 로 표시. 답변 끝에 항상 `sr_proposal` 블록을 포함하라.

기존 `extract_sr_proposal`, `submit_sr` 흐름은 그대로 사용.

## Data Flow (change_request)

```
사용자 입력 ("우천시에도 정시 배송률 페널티 면제 부탁드립니다")
  → DemoWidget send() (chatMode=change_request, logged_in session)
  → POST /api/widget/sessions/{id}/ask-stream { question: "[변경 요청] ..." }
  → chat_service: allow_sr_draft=true (user_id != WIDGET_USER_ID)
  → LLM stream → answer + sr_proposal block ("확인 필요" 포함 best-effort)
  → SR draft INSERT, done event emits { message_id, sr_draft }
  → useChatSession: modesByMessage[id]=change_request, auto sendSR(draft.id)
  → POST /api/sr/drafts/{id}/submit → Jira publish → jira_issue_key
  → UI: 메시지 옆 "SR 전송 완료 (JIRA-xxx)" 배지, citations 영역 숨김
```

## Components Touched

| Layer | File | Change |
|---|---|---|
| FE page | `frontend/src/pages/DemoWidgetBefore.tsx` | `loggedIn={true}` 추가 |
| FE page | `frontend/src/pages/DemoWidgetAfter.tsx` | `loggedIn={true}` 추가 |
| FE widget | `frontend/src/pages/DemoWidget.tsx` | `loggedIn` prop, 세션 생성 payload + adapter 분기 |
| FE hook | `frontend/src/hooks/useChatSession.ts` | `modesByMessage` 추가, auto-sendSR on done |
| FE chat | `frontend/src/components/chat/ChatPanel.tsx` | `modesByMessage` 받아 citations 게이트 |
| FE chat | `frontend/src/components/chat/ChatMessage.tsx` | 변경 없음 — `citations.length > 0` 가드가 이미 존재하므로 빈 배열만 전달하면 됨 |
| BE | `backend/app/services/chat_service.py` | `RAG_SYSTEM_PROMPT` change_request 분기 수정 |

## Error Handling

- LLM 이 `sr_proposal` 블록을 누락 → 기존 동작과 동일하게 SR draft 생성 안 됨. 사용자가 다시 시도. (희귀 케이스, 보강하지 않음.)
- Jira 발행 실패 → `srSendErrorById` 에 메시지 저장, UI 에 에러 표시 (기존 로직 재사용).
- 세션 생성 시 `DEMO_USER_ID` 가 DB 에 없으면 widget POST 가 404 — seed 가 항상 생성하므로 정상 환경에서는 발생하지 않음.

## Testing

- 수동: 두 페이지에서 챗봇 열기 → 모드 탭 보임 확인 → 변경 요청 모드로 임의 메시지 전송 → 참조 문서 숨김 + SR 전송 완료 배지 확인.
- 자동: 백엔드 `RAG_SYSTEM_PROMPT` 변경에 대한 단위 테스트는 LLM 응답에 의존하므로 추가하지 않음 (기존 패턴 유지).
- 회귀: anonymous 위젯 (다른 진입점 있으면) 그대로 동작 — `loggedIn` 미지정 시 기존 흐름.

## Open Questions

없음.
