# Approvals 페이지 — 상태 필터 + 페이지네이션 + Feedback 이동 개선 설계

## 배경

Approvals 페이지는 현재 `pending` 상태만 조회하고 페이지네이션이 없다.
Feedback 페이지의 이동 아이콘은 항상 `/approvals`로 이동하는데, 승인 완료된 항목은 기본 뷰에서 보이지 않아 사용자가 빈 화면을 마주한다.

## 결정 사항

- **상태 필터**: 전체 / 처리 중(pending+needs_review) / 완료(approved+rejected) 3개 pill
- **레이아웃**: 기존 소스 탭(오류 제보 / Playwright) 아래에 상태 필터 pill 바 배치
- **페이지네이션**: 10 / 20 / 50개씩, 기본 20
- **Feedback 이동**: 수정안 상태에 따라 필터 자동 선택

## 1. 백엔드 변경

### GET /api/approvals 파라미터 추가

기존:
```
GET /api/approvals?status=pending
→ list[ApprovalRequestResponse]
```

변경 후:
```
GET /api/approvals?status=pending&skip=0&limit=20
→ { items: ApprovalRequestResponse[], total: int }
```

**status 파라미터 값:**
- `pending` (기본) → `ApprovalRequest.status IN ('pending')`
- `processing` → `ApprovalRequest.status IN ('pending', 'needs_review')`
- `completed` → `ApprovalRequest.status IN ('approved', 'rejected')`
- `all` → 전체

**신규 응답 스키마:**
```python
class ApprovalListResponse(BaseModel):
    items: list[ApprovalRequestResponse]
    total: int
```

### FeedbackReport API에 proposed_change_status 추가

`GET /api/feedback` 응답의 각 항목에 `proposed_change_status: str | None` 필드 추가.

- `document_id`가 있고 `status = "processed"`인 경우 연결된 `ProposedDocumentChange.status` 값 반환
- 없으면 `null`

`feedback_service.list_feedback()`에서 `ProposedDocumentChange` 조인 추가.

## 2. 프론트엔드 변경

### api.ts 타입 업데이트

```ts
// FeedbackReport에 필드 추가
export interface FeedbackReport {
  ...
  proposed_change_status: string | null  // 추가
}

// ApprovalRequest 목록 응답 래핑
export interface ApprovalListResponse {
  items: ApprovalRequest[]
  total: number
}

// listApprovals 시그니처 변경
listApprovals: (params?: { status?: string; skip?: number; limit?: number }) =>
  request<ApprovalListResponse>(...)
```

### Approvals.tsx 변경

**상태:**
```ts
const [statusFilter, setStatusFilter] = useState<"all" | "processing" | "completed">("all")
const [page, setPage] = useState(1)
const [pageSize, setPageSize] = useState(20)
```

URL 파라미터로 초기 상태 설정:
- `?status=processing` → `statusFilter = "processing"`
- `?status=completed` → `statusFilter = "completed"`

**상태 필터 pill 레이아웃** (소스 탭 아래):
```
[ 전체 N ] [ 처리 중 N ] [ 완료 N ]
```
- 각 건수는 현재 소스 탭(feedback/playwright)에 맞게 필터된 결과 기준

**페이지네이션** (목록 하단):
```
총 N건          [10개씩 ▾]  ‹ 1 2 3 › 
```

**데이터 조회:**
- `statusFilter`, `page`, `pageSize`, `tab` 변경 시 `useApi` 재호출
- `skip = (page - 1) * pageSize`

**소스 탭 건수 배지:**
- 현재 statusFilter 기준 건수로 업데이트

### Feedback.tsx 변경

이동 아이콘 클릭 시 `proposed_change_status` 기준으로 URL 파라미터 포함 이동:
```ts
const target = (fb.proposed_change_status === "approved" || fb.proposed_change_status === "rejected")
  ? "/approvals?status=completed"
  : "/approvals?status=processing"
navigate(target)
```

## 3. 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/routers/approvals.py` | skip/limit 파라미터 추가, 응답 타입 변경 |
| `backend/app/schemas/approval.py` | `ApprovalListResponse` 스키마 추가 |
| `backend/app/services/approval_service.py` | pagination + `processing`/`completed` 상태 그룹 지원 |
| `backend/app/schemas/feedback.py` | `FeedbackReportResponse`에 `proposed_change_status` 추가 |
| `backend/app/services/feedback_service.py` | `list_feedback`에서 `ProposedDocumentChange` 조인 |
| `frontend/src/lib/api.ts` | 타입 및 `listApprovals` 시그니처 업데이트 |
| `frontend/src/pages/Approvals.tsx` | 상태 필터 pill + 페이지네이션 추가, URL 파라미터 읽기 |
| `frontend/src/pages/Feedback.tsx` | 이동 아이콘 동작 변경 |

## 4. 엣지 케이스

- 필터 변경 시 page를 1로 리셋
- 소스 탭 변경 시 page를 1로 리셋
- 전체 건수가 pageSize 이하이면 페이지네이션 UI 숨김
- `proposed_change_status`가 null인 피드백(document_id 없는 경우)은 이동 아이콘 비표시 유지
