# 해커톤 시연 데이터 정리 — 삭제 기능 + Q&A 버그 fix

## 배경

해커톤 시연을 앞두고 누적된 테스트 데이터를 화면에서 직접 정리해야 한다.
현재 대부분 메뉴에 삭제 UI가 없고, Q&A 챗봇은 삭제 버튼이 있으나 동작하지 않는다.

## 범위

작업 4건. 시연 직전 한정 작업이므로 단건 hard delete + 행 hover 휴지통 UI로 통일한다.

| # | 항목 | 백엔드 | 프론트엔드 |
|---|------|--------|-----------|
| 1 | Q&A 챗봇 삭제 버그 fix | `DELETE /api/chat/sessions/{id}` 보강 | `api.deleteSession` ok 체크 |
| 2 | 메뉴얼 생성 요청 삭제 | `DELETE /api/manual/jobs/{job_id}` | `ManualGenerator.tsx` 행 hover 휴지통 |
| 3 | 지라 SR 삭제 | `DELETE /api/sr/{sr_id}` | `ServiceRequests.tsx` 행 hover 휴지통 |
| 4 | 위젯 대화 삭제 | `DELETE /api/widget/admin/sessions/{session_id}` | `WidgetConversations.tsx` 행 hover 휴지통 |

## 1. Q&A 챗봇 삭제 버그

### 원인

두 가지 결함이 겹쳐 사용자에게 "안 없어진다"고 보인다.

1. **백엔드 — feedback FK 누락.** `routers/chat.py` `delete_session`은 `AnswerCitation`과 `ChatMessage`만 정리한다. 그러나 `FeedbackReport.chat_message_id`(`models/feedback.py:16`)가 `ChatMessage`를 참조한다. 메시지에 피드백이 달려 있으면 `ChatMessage` 삭제 시 IntegrityError → 500 → rollback.
2. **프론트엔드 — 응답 ok 미체크.** `lib/api.ts`의 `deleteSession`은 `fetch(...)` 반환값을 그대로 돌려준다. 500이 와도 reject가 아니므로 `Chat.tsx` `deleteSession`은 `setSessions filter`를 그대로 실행한다. UI에선 잠시 사라진 듯 보이다가 새로고침 시 다시 나타난다.

### 수정

- 백엔드: `delete_session`에서 `ChatMessage` 삭제 전에 `FeedbackReport`의 `chat_message_id IN (msg_ids)` 행을 먼저 정리한다. (cascade 옵션은 마이그레이션 위험 회피 위해 미사용)
- 프론트엔드: `api.deleteSession`을 `request` 헬퍼와 동일하게 `response.ok` 체크 + 실패 시 throw하도록 한다.

### 검증

- `pytest backend/tests/test_chat.py` — 기존 테스트 유지
- 피드백 달린 메시지의 세션 삭제 → 204 반환 + DB에서 세션/메시지/시테이션/피드백 모두 제거 확인 (수동 또는 신규 단위 테스트)

## 2~4. 삭제 기능 공통 규칙

- **권한**: 시연 한정. ownership 체크 생략 (기존 chat delete와 일관).
- **확인 다이얼로그**: `window.confirm("…을(를) 삭제하시겠습니까?")` 단순 처리.
- **UI**: 각 행을 `group` 컨테이너로 감싸고, hover 시 우측에 `material-symbols-outlined: delete` 휴지통 버튼을 표시. `Chat.tsx`의 기존 패턴과 동일하게 유지.
- **상태 갱신**: 성공 시 클라이언트 state에서 해당 행 제거. 별도 refetch 불필요.
- **자식 row 처리**: cascade 옵션 신설 대신 라우터에서 명시 삭제 (마이그레이션 회피).

## 2. 메뉴얼 생성 요청 삭제

### 백엔드

`DELETE /api/manual/jobs/{job_id}` 추가. 자식 row 정리 순서:

1. `ProposedDocumentChange`(manual_job_id) → 그리고 그 자식 `ApprovalRequest`/리뷰 관련 행 (구현 시 모델 확인 후 결정)
2. `ManualGenerationJob` 본체

`output_document_id`로 연결된 `Document`는 시연 시 의도적으로 남길 수 있으므로 **삭제하지 않는다**. 단 화면 상 "메뉴얼 생성 요청" 리스트에서만 사라지면 충분.

### 프론트엔드

`ManualGenerator.tsx`의 요청 카드/행에 휴지통. 삭제 후 목록 state에서 제거.

## 3. 지라 SR 삭제

### 백엔드

`DELETE /api/sr/{sr_id}` 추가. 자식 row 정리 순서:

1. `WebhookDeliveryLog`(sr_draft_id)
2. `ManualGenerationJob.source_sr_id` 가 가리키는 경우 → FK nullable 이므로 SET NULL 대신 명시적으로 `source_sr_id = NULL` 업데이트 (관련 manual job은 보존)
3. `SRDraft` 본체

지라 원본 이슈는 외부 시스템이므로 손대지 않는다.

### 프론트엔드

`ServiceRequests.tsx`의 SR 카드/행에 휴지통.

## 4. 위젯 대화 삭제

### 백엔드

`DELETE /api/widget/admin/sessions/{session_id}` 추가. 자식 row 정리 순서:

1. 위젯 메시지(`WidgetMessage` 류) → 모델명은 구현 시 `models/` 확인
2. 위젯 세션 본체

### 프론트엔드

`WidgetConversations.tsx`의 세션 행 hover 휴지통. 삭제 후 선택 상태가 그 세션이면 해제하고 메시지 패널 비우기.

## 작업 순서

1. Q&A 챗봇 버그 fix → 사용자가 시연 환경에서 직접 확인
2. 위 확인 후 2~4번 삭제 기능 순차 구현

## Non-goals

- Soft delete / 휴지통 / 복구
- 일괄 선택 / 전체 비우기
- 권한·감사 로그
- 위젯 익명 사용자의 자기 대화 삭제 (관리자 화면 한정)
