# Jira SR 승인 탭 통합 설계

**날짜:** 2026-05-20
**상태:** 승인됨

---

## 1. 목표

승인 관리 페이지에서 "Jira SR 반영"과 "문서 작성 검토" 탭을 **"Jira SR"** 단일 탭으로 통합한다. 같은 SR에서 시작하는 두 단계(문서화 필요 여부 결정 → AI 초안 검토)를 한 탭 안에서 상태 필터로 구분해 사용자가 흐름을 자연스럽게 파악할 수 있도록 한다.

---

## 2. 배경

두 탭은 같은 Jira SR에서 시작하는 순차적 단계다:

1. `complete-local` 시뮬레이터 완료 → `ApprovalRequest(approval_type="doc_review")` 생성 — "이 SR에 문서가 필요한가?" 결정
2. "문서 작성 승인" 선택 → `process_completed_sr()` 실행 → `ProposedDocumentChange(source_type="jira_sr")` + `ApprovalRequest` 생성 — AI가 쓴 초안 검토

별도 탭으로 분리되어 있어 같은 SR의 진행 상태를 추적하기 어려웠다.

---

## 3. 변경 내용

### 3-1. 탭 구조

| 전 | 후 |
|---|---|
| Jira SR 반영 | **Jira SR** (통합) |
| 문서 작성 검토 | *(제거)* |
| 오류 제보 수정안 | 유지 |
| Playwright 매뉴얼 | 유지 |

### 3-2. 필터 배지 (4개)

기존 "처리 중 / 완료" 2버튼 → 아래 4버튼으로 교체.

| 배지 이름 | 필터 조건 |
|---|---|
| 전체 | 두 타입 모두 |
| 문서화 필요 여부 | `approval_type === "doc_review"` && `status === "pending"` |
| AI 초안 검토 | `proposed_change.source_type === "jira_sr"` && `status IN ("pending", "needs_review")` |
| 완료 | `status IN ("approved", "rejected")` (두 타입 모두) |

### 3-3. 카드 상단 배지

| 상태 | 배지 텍스트 | 색상 |
|---|---|---|
| `doc_review` + `pending` | 문서화 필요 여부 | 주황 `bg-[#fff3dc] text-[#92600a]` |
| `jira_sr` + `pending`/`needs_review` | AI 초안 검토 | 파랑 `bg-[#e8f0fe] text-[#1a56db]` |
| `approved` | 문서 수정 완료 | 초록 `bg-[#e8f5e9] text-[#2e7d32]` |
| `rejected` | 종료 | 빨강 `bg-[#fce4ec] text-[#c62828]` |

---

## 4. 변경 범위

- **수정:** `frontend/src/pages/Approvals.tsx`
  - `Tab` 타입에서 `"doc_review"` 제거, `"jira_sr"` 탭이 두 타입을 모두 담당
  - 필터 상태 타입: `"all" | "doc_review_pending" | "jira_sr_pending" | "done"`
  - 탭 배지 카운트: `jiraSrProcessingCount = docReviewProcessingCount + jiraSrProcessingCount`
  - `currentList` 필터 로직 수정
  - `doc_review` 카드 UI를 `jira_sr` 탭 내에서 조건부 렌더링

- **변경 없음:** 백엔드 API, 모델, 서비스 로직

---

## 5. Out of Scope

- 카드 내 액션 버튼/검토 UI 변경 없음
- 다른 탭(오류 제보, Playwright) 변경 없음
- 페이지네이션 로직 변경 없음
