# 빈 대화 미저장 — Chat 페이지 & Widget

## 목적

메시지가 단 한 건도 없는 채팅 세션 (`chat_sessions` row with no `chat_messages`) 이 DB 와 사이드바·관리자 목록에 남는 현상을 제거한다. Chat 페이지의 "새 대화" 버튼, Widget 의 첫 토글 오픈만으로 세션이 생성되어 빈 row 가 누적되는 문제를 해결한다.

## 원칙

- **Lazy create**: 사용자가 실제로 첫 메시지를 전송하기 전까지 `chat_sessions` row 를 만들지 않는다.
- API 시그니처는 그대로. 클라이언트가 세션 생성 시점을 첫 send 로 미룬다 (two-call: `POST /sessions` → `POST /sessions/{id}/ask-stream`).
- 기존 빈 세션은 1회성 Alembic migration 으로 정리한다.
- 회귀 방어: list 엔드포인트에 `EXISTS message` 필터를 추가해 빈 세션이 노출되지 않도록 한다.

## 영향 범위

### Frontend

#### `frontend/src/pages/Chat.tsx`

- `createSession()` → `startDraft()`: API 호출 제거. `setActiveSession(null)`, `setIsDrafting(true)`, `chat.resetAll()` 만 수행.
- 신규 state `isDrafting: boolean`. 우측 패널 렌더 분기:
  - `!activeSession && !isDrafting` → 기존 빈 상태 (env: 무엇을 도와드릴까요 + 새 대화 시작 버튼)
  - `!activeSession && isDrafting` → ChatPanel 표시 (입력창 노출, 메시지 0개)
  - `activeSession` → ChatPanel 표시 (기존 로직)
- 다른 세션 클릭 시 draft 폐기 (`isDrafting=false`). 사이드바에는 draft entry 미표시.
- 첫 메시지 전송 성공 후 신규 session 을 sidebar 최상단에 push: `setSessions(prev => [newSession, ...prev])`, `setActiveSession(newSession.id)`, `setIsDrafting(false)`.

#### `frontend/src/hooks/useChatSession.ts` + `frontend/src/lib/chatAdapters.ts`

- adapter 인터페이스에 `ensureSession(): Promise<ChatSession>` 추가. Chat 어댑터 구현: `api.createSession(userId)`. (Widget 은 별도 경로 — `widget/main.ts` 에서 직접 처리, 본 hook 미사용.)
- `useChatSession.send(question)` 진입 시 `sessionId` 가 null 이면 `adapter.ensureSession()` 호출 → 반환된 session 으로 `setSessionId` 및 부모 콜백 `onSessionCreated?.(session)` 발화.
- 신규 flag `isCreating` 으로 race 방지 (`isStreaming || isCreating` 이면 send 무시).

#### `frontend/src/widget/main.ts`

- `initSession()` 분리:
  - 토글 오픈 시 sessionId 가 없으면 greeting 만 로컬 표시 (`addBotMessage("안녕하세요! 무엇을 도와드릴까요?")`). **POST 호출 없음.**
  - 기존 sessionId 가 있으면 `loadHistory()` 만 호출.
- `send()` 진입:
  - `sessionId === null` 이면 `createSession(config, anonymousId)` 호출 → 받은 id 로 `saveSession()` → 그 후 `askStream` 진행.
  - `isStreaming || isCreating` 중복 send 무시.
- `loadHistory()` 가 404 (cleanup 으로 사라진 세션) 를 만나면:
  - `localStorage.removeItem("docops_widget_${siteId}")`
  - `this.sessionId = null`, `this.messages = []`
  - greeting 다시 표시 → draft 상태 진입.

### Backend

#### 엔드포인트

변경 없음. `POST /api/chat/sessions`, `POST /api/widget/sessions`, `POST .../ask-stream` 그대로 동작.

#### `backend/app/services/chat_service.py`

- `list_sessions(db, user_id)` 쿼리에 빈 세션 제외 필터 추가:

```python
from sqlalchemy import exists
stmt = (
    select(ChatSession)
    .where(ChatSession.user_id == user_id)
    .where(exists().where(ChatMessage.session_id == ChatSession.id))
    .order_by(ChatSession.created_at.desc())
)
```

#### `backend/app/routers/widget.py`

- `admin_list_widget_sessions` 쿼리에 동일 `EXISTS` 필터 추가. 이미 `msg_count` 를 계산하므로 `HAVING msg_count > 0` 도 가능하지만, 일관성 위해 `EXISTS` 사용.

#### 마이그레이션 — `alembic/versions/<rev>_drop_empty_chat_sessions.py`

```sql
DELETE FROM chat_sessions
 WHERE id NOT IN (
   SELECT DISTINCT session_id FROM chat_messages WHERE session_id IS NOT NULL
 );
```

- `upgrade()`: 위 SQL 실행.
- `downgrade()`: no-op (irreversible cleanup; 명시 주석).

### Tests

- backend pytest (기존 `backend/tests/test_chat.py` 확장 또는 신규 모듈):
  - `test_list_sessions_excludes_empty` — 동일 user 로 빈 세션 + 메시지 있는 세션 2개 생성 → list 결과는 1건.
  - `test_widget_admin_list_excludes_empty` — widget 빈 세션 + 메시지 세션 → admin list 1건.
- 프론트엔드: 자동 테스트 인프라 없음. 수동 확인:
  - Chat: "새 대화" 클릭 시 Network 탭에 POST 미발생 → 첫 메시지 시 POST `/sessions` + POST `.../ask-stream` 둘 다 발생, 사이드바 상단에 추가됨.
  - Widget: 토글 열기 시 POST 미발생, 토큰 stream 정상 → 첫 send 시 POST 발생. 새로고침 후 widget 재오픈 → history 복원. cleanup 으로 사라진 세션은 greeting 으로 복귀.

## 엣지케이스 결정

1. **첫 메시지 LLM 실패** — `chat_service.ask_question_stream` 의 기존 `db.rollback()` 으로 `user_msg` 도 롤백되지만, 그 직전에 client 가 만든 빈 세션 row 는 별도 commit 으로 이미 영속화돼 있어 남는다. 해당 row 는 `EXISTS` 필터로 list 에서 숨겨지므로 사용자 경험에는 노출되지 않는다. 주기적 cleanup 은 본 작업 범위 밖.
2. **빠른 더블 send race** — frontend `isCreating` flag 와 send 버튼 `disabled` 로 방지. backend 가드는 추가하지 않는다.
3. **stale `sessionId` (cleanup 으로 사라진 세션)** — widget `loadHistory()` 404 catch 에서 localStorage 초기화 + greeting 복귀. Chat 페이지에서는 sidebar list 가 server source 라 자동 정합.
4. **draft 중 다른 세션 클릭** — draft 즉시 폐기. 사이드바 entry 없음. 사용자가 다시 "새 대화" 클릭하면 새 draft 시작.

## 비-목표

- 세션 자동 정리 cron / 백그라운드 잡 (실패 후 남은 세션 row).
- Widget 의 SSO/JWT 인증 강화.
- Chat 페이지 사이드바 draft pinning UI (Q3 옵션 B).
- 메시지 0개 세션 외의 다른 정리 기준 (예: 30일 이상 빈 메시지 세션).

## 마이그레이션 / 롤백

- migration 적용 후 staging 에서 list 엔드포인트 응답 확인.
- 롤백 필요 시: 코드 revert + DB 마이그레이션 downgrade (no-op). 데이터 복구 불가.
