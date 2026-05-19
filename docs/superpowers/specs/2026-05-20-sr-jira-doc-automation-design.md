# SR → Jira → 문서 자동화 플로우 설계

## 목표

챗봇 SR 생성 플로우 완성, Jira 완료 시 앱 내 승인 큐를 통한 문서 작성 여부 판단, 승인 후 문서 자동 등록 및 사용자 매뉴얼 선택 생성.

---

## 아키텍처 개요

```
[챗봇 change_request 모드]
  사용자 메시지 → chat_service (프롬프트 개선)
    → 정보 부족: 추가 질문 응답 (sr_proposal 블록 없음)
    → 정보 충족: sr_proposal 생성 → SR DB 저장 → Jira 등록(or 시뮬레이터)

[Jira 완료 웹훅]
  POST /api/jira/webhook
    → is_done_transition 확인
    → ApprovalRequest 생성 (type: "doc_review", sr_draft_id 연결)
    → process_completed_sr() 호출 제거 (승인 후 호출로 이동)

[승인 큐 — 문서 작성 검토]
  사람이 Approvals 페이지에서 검토
    → 거부: SR status = "done_no_proposal"
    → 문서 승인: process_completed_sr() → change impact → 문서 등록
    → 매뉴얼 포함 승인: 위 + manual_service Playwright 트리거

[문서 등록 완료]
  → 청킹/임베딩 → RAG 검색 대상
```

---

## 백엔드

### 1. `chat_service.py` — change_request 프롬프트 개선

- `RAG_SYSTEM_PROMPT`의 `[변경 요청]` 처리 지시 수정
- LLM이 필수 정보(제목, 내용, 우선순위) 충족 여부 판단
- 부족 시: `sr_proposal` 블록 없이 추가 질문만 응답
- 충족 시: 기존대로 `sr_proposal` 블록 생성

### 2. `jira.py` — 웹훅 수신 처리 변경

- `receive_jira_webhook()`에서 `background_tasks.add_task(_bg_task, event)` 제거
- 대신 `ApprovalRequest` 생성 (type: `"doc_review"`, sr_draft_id 포함)
- SR status → `"pending_doc_review"` 로 업데이트

### 3. `approval_service.py` — doc_review 타입 승인 처리 추가

| action | 처리 |
|--------|------|
| `"reject"` | SR status = `"done_no_proposal"` |
| `"approve_doc"` | `process_completed_sr()` 호출 |
| `"approve_manual"` | `process_completed_sr()` + `manual_service` Playwright 트리거 |

### 4. `ApprovalRequest` 모델

- `type: "doc_review"` 값 지원 확인 (없으면 추가)
- `sr_draft_id: UUID` 필드 확인 (없으면 추가)

---

## 프론트엔드

### 1. `Chat.tsx`

변경 없음. 백엔드 프롬프트 수정만으로 동작 변경됨.

### 2. `Approvals.tsx` — doc_review 타입 UI 추가

- `doc_review` 타입 항목 표시 시 연결된 SR 정보(제목, 설명) 표시
- 세 개 액션 버튼:
  - **거부** → `action: "reject"`
  - **문서 작성 승인** → `action: "approve_doc"`
  - **사용자 매뉴얼 포함 승인** → `action: "approve_manual"`

---

## 구현 순서

1. 챗봇 SR 생성 프롬프트 개선 (`chat_service.py`)
2. Jira 웹훅 → ApprovalRequest 생성 (`jira.py`, `approval_service.py`, 모델)
3. 승인 큐 UI 및 승인 처리 (`Approvals.tsx`, `approval_service.py`)
4. 승인 후 문서 자동 등록 연결 (`process_completed_sr()` 트리거)
5. 매뉴얼 포함 승인 시 Playwright 자동 트리거 (`manual_service.py`)

---

## 제거 예정 항목 (Jira 실제 연동 후)

| 위치 | 내용 |
|------|------|
| `frontend/src/pages/ServiceRequests.tsx` | "완료 처리 (시뮬레이터)" 버튼 |
| `backend/app/routers/sr.py` | `POST /api/sr/drafts/{id}/complete-local` |
| `frontend/src/lib/api.ts` | `completeSRLocal()` |
