# 오류 제보 상세 버그 수정 Design

**Date:** 2026-05-21  
**Scope:** `FeedbackDetail` 컴포넌트 UI 텍스트 수정, 반영 안함 이력 기록, 반영 후 스테일 경고 오표시 수정

---

## 배경

오류 제보 상세(`FeedbackDetail`) 컴포넌트에서 3가지 문제 확인:

1. 버튼 텍스트가 "피드백"으로 표기됨 — 메뉴 용어는 "오류 제보"
2. "반영 안함" 클릭 시 변경 이력에 아무 기록도 남지 않음
3. "문서에 반영" 성공 후 스테일 경고("초안 생성 이후 문서가 변경되었습니다")가 표시됨 — 문서는 실제로 반영됐으나 `get_proposal` 재조회 시 `is_stale=True` 잘못 반환

---

## 변경 파일

- `backend/app/routers/feedback.py`
- `frontend/src/pages/Feedback.tsx`

---

## 상세 설계

### Fix 1 — 텍스트 수정 (`Feedback.tsx`)

| 위치 | 기존 | 변경 |
|------|------|------|
| `handleDelete` confirm 메시지 | `"이 피드백을 삭제하시겠습니까?"` | `"이 오류 제보를 삭제하시겠습니까?"` |
| 삭제 버튼 텍스트 | `이 피드백 삭제` | `오류제보 삭제` |

### Fix 2 — 반영 안함 이력 기록 (`feedback.py`)

원인: `apply_draft` 엔드포인트에서 `review_approval` 호출 후 `history_service.log_event` 미호출.

수정: `apply_draft` 엔드포인트에서 action별 이력 기록 추가.

- `action == "apply"` 또는 `action == "edit_and_approve"`:
  - `event_type="feedback_applied"`, `detail="AI 수정 초안이 문서에 반영되었습니다."`
- `action == "reject"`:
  - `event_type="feedback_rejected"`, `detail="오류 제보를 검토하였으나 문서에 반영하지 않기로 결정했습니다."`

entity: `entity_type="feedback"`, `entity_id=feedback_id`

### Fix 3 — 반영 후 스테일 오표시 (`feedback.py` + `Feedback.tsx`)

원인: `apply_draft` 성공 → `create_new_version` 호출 → `doc.current_version_id` 업데이트 → `get_proposal` 재조회 시 `proposal.document_version_id != doc.current_version_id` → `is_stale=True` 반환.

**백엔드 수정 (`get_proposal`):**  
`proposal.status in ("approved", "rejected")` 이면 `is_stale` 계산 스킵 → `False` 반환.

```python
is_stale = False
if proposal.status not in ("approved", "rejected"):
    if proposal.document_version_id and proposal.document_id:
        doc = ...
        if doc and doc.current_version_id != proposal.document_version_id:
            is_stale = True
```

**프론트엔드 수정 (`Feedback.tsx` draft 탭):**  
proposal.status에 따라 완료 상태 메시지 표시:

- `status === "approved"`: 초록 배너 "✓ 문서에 반영 완료"
- `status === "rejected"`: 회색 배너 "반영 안함으로 처리되었습니다."

---

## 테스트 시나리오

1. 삭제 버튼 클릭 → confirm 텍스트에 "오류 제보" 포함 확인
2. AI 초안 생성 후 "반영 안함" 클릭 → 변경 이력 탭에 `feedback_rejected` 이벤트 표시 확인
3. "문서에 반영" 클릭 후 → 스테일 경고 미표시, 초록 "반영 완료" 배너 표시, 변경 이력에 `feedback_applied` 이벤트 표시 확인
