# 오류 제보 페이지 개선 설계

**날짜:** 2026-05-21  
**범위:** `frontend/src/pages/Feedback.tsx`, `backend/app/routers/feedback.py`, `backend/app/services/feedback_service.py`, `backend/app/schemas/feedback.py`

---

## 배경

오류 제보(`/feedback`) 페이지에서 UX 문제 5가지 식별. 관리자가 피드백을 검토하고 AI 초안을 생성한 뒤 문서에 반영하는 전체 플로우를 개선한다.

---

## 개선 항목

### 1. 요청 정보 탭 — 관리자 검토 내용 항상 표시

**현재 동작:** `proposal`이 존재하면 관리자 검토 textarea를 숨기고 "초안이 생성되었습니다" 링크만 표시.

**변경 동작:**
- `proposal` 존재 여부와 무관하게 `reviewed_text`(없으면 `feedback_text`)를 읽기전용 텍스트블록으로 항상 표시.
- "AI 초안 보기" 링크는 하단에 유지.
- 조건: `proposal`이 없을 때만 textarea + "AI 초안 요청" 버튼 표시.

**파일:** `Feedback.tsx` — `FeedbackDetail` 내 `activeSection === "info"` 분기

---

### 2. 수정 제안 편집 + 원본 문서 반영 여부

**현재 동작:** `proposed_text`를 읽기전용 `<pre>`로 표시. 반영 액션 없음.

**변경 동작:**

프론트엔드:
- `proposed_text` → 편집 가능 `<textarea>` (로컬 state `editedText` 관리)
- 버튼 2개 추가:
  - **문서에 반영** (primary): `editedText !== proposal.proposed_text`면 `edit_and_approve`, 동일하면 `approved`
  - **반영 안함** (secondary, destructive): `reject`
- 반영/거절 후: `refetchProposal()` + `onRefetch()` 호출, 버튼 비활성화

백엔드 — 신규 엔드포인트:
```
POST /api/feedback/{feedback_id}/apply-draft
Body: { action: "apply" | "reject", edited_text?: str }
Response: FeedbackWithProposalResponse
```
구현:
1. feedback → proposal → approval_request 순서로 조회
2. `action == "apply"`:
   - `edited_text` 있으면 `review_approval(…, "edit_and_approve", edited_content=edited_text)`
   - 없으면 `review_approval(…, "approved")`
3. `action == "reject"`: `review_approval(…, "rejected")`
4. stale 감지 (항목 5 참조): stale이면 `409 Conflict` 반환

**파일:**
- `Feedback.tsx` — draft 탭
- `backend/app/routers/feedback.py` — 엔드포인트 추가
- `frontend/src/lib/api.ts` — `applyFeedbackDraft` 함수 추가

---

### 3. 상태 배지 vs 삭제 버튼 혼동 해소

**현재 동작:** 헤더에 `[제목] [rounded-full 상태chip] [삭제button]` 나란히 — 시각적으로 유사해 혼동.

**변경 동작:**
- 상태 배지: `rounded-full` → `rounded` + `border-l-2` 왼쪽 accent 스타일 (버튼처럼 보이지 않게)
- 삭제 버튼: 헤더에서 제거 → "요청 정보" 탭 하단 `border-t` 구분선 아래로 이동. `text-[#dc2626] underline text-xs` 텍스트 링크 스타일.

**파일:** `Feedback.tsx` — `FeedbackDetail` 헤더 + info 탭 하단

---

### 4. 탭 비활성화

**조건:**
- "AI 수정 초안" 탭: `!proposalLoading && !proposal`
- "변경 이력" 탭: `!historyLoading && history.length === 0`

**구현:**
- `FeedbackDetail`에서 `useApi(api.listHistory("feedback", item.id), [item.id])` 직접 호출
- `ChangeHistoryTimeline`에 `events` prop 추가 — 중복 fetch 제거
- 탭 버튼에 `disabled` 조건 추가, 비활성화 스타일: `opacity-40 cursor-not-allowed pointer-events-none`
- 비활성 탭 클릭 시 `setActiveSection` 호출 안 함

**파일:** `Feedback.tsx`, `ChangeHistoryTimeline.tsx`

---

### 5. 동일 문서 중복 피드백 — 충돌 설계

**문제:**
같은 문서 v1 기반 초안 A·B 존재 → A 반영으로 v2 생성 → B 반영 시 v1 기반 내용으로 v2 덮어씀 → 데이터 유실.

**설계 (필수):**

**5-1. Stale 감지 (백엔드)**
- `ProposedChangeResponse` 스키마에 `is_stale: bool` 필드 추가 (DB 컬럼 불필요)
- `get_proposed_change` 서비스에서 `proposal` 조회 후 `document.current_version_id != proposal.document_version_id` 비교해 계산

**5-2. apply-draft stale 차단**
- `apply-draft` 엔드포인트에서 stale이면 `409 Conflict` + `detail: "문서가 수정되어 초안이 만료되었습니다. 초안을 재생성하세요."`

**5-3. 프론트엔드 stale 처리**
- `proposal.is_stale === true`면 draft 탭에 경고 배너 표시:
  > "이 초안은 생성 이후 문서가 변경되었습니다."
- **초안 재생성** 버튼: 기존 proposal 삭제(`DELETE /feedback/{id}/proposal`) + `handleRequestDraft()` 재호출
- "문서에 반영" 버튼 비활성화

**5-4. 목록 충돌 배지 (nice-to-have, 분리 가능)**
- `list_feedback` 서비스에서 같은 `document_id`에 pending proposal 2개 이상이면 `has_conflict: true` 필드 반환
- 목록 아이템에 `⚠` 배지 표시

**필수:** 5-1, 5-2, 5-3 / **선택:** 5-4

**신규 엔드포인트 (5-3용):**
```
DELETE /api/feedback/{feedback_id}/proposal
```
- `ProposedDocumentChange` 삭제, `FeedbackReport.status = "pending"` 리셋

**파일:**
- `backend/app/schemas/feedback.py` — `ProposedChangeResponse`에 `is_stale` 추가
- `backend/app/services/feedback_service.py` — stale 계산
- `backend/app/routers/feedback.py` — apply-draft stale 체크, DELETE proposal 엔드포인트
- `Feedback.tsx` — stale 배너 + 재생성 버튼
- `api.ts` — `deleteProposal` 함수 추가

---

## 영향 받는 파일 요약

| 파일 | 변경 |
|------|------|
| `frontend/src/pages/Feedback.tsx` | 1, 2, 3, 4, 5 |
| `frontend/src/components/ChangeHistoryTimeline.tsx` | 4 |
| `frontend/src/lib/api.ts` | 2, 5 |
| `backend/app/routers/feedback.py` | 2, 5 |
| `backend/app/services/feedback_service.py` | 5 |
| `backend/app/schemas/feedback.py` | 5 |

---

## 테스트 요구사항

- proposal 있을 때 요청 정보 탭에 `reviewed_text` 표시 확인
- `apply-draft` apply/reject 각각 문서 버전 생성 여부 확인
- stale proposal에 apply-draft 호출 → 409 반환 확인
- stale 재생성 후 정상 반영 플로우 확인
- 탭 비활성화: proposal/history 없는 초기 상태, 생성 후 활성화 확인
