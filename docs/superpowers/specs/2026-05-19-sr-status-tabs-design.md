# SR 상태 탭 설계

**날짜:** 2026-05-19  
**상태:** 확정  
**선행 스펙:** `2026-05-18-jira-bidirectional-design.md`, `2026-05-19-jira-feedback-document-update-design.md`

---

## 개요

서비스 요청(SR) 목록 페이지를 Approvals와 동일한 패턴으로 상태별 탭으로 분리한다.

현재는 전체 SR을 단일 리스트로 표시하고 있어 건수가 많아질 경우 가독성이 떨어진다. 탭으로 나누면 작업 흐름(초안 작성 → 진행 중 → 완료)이 명확해진다.

---

## 탭 구성

| 탭 | label | 포함 status | 배지 |
|---|---|---|---|
| 초안 | 초안 | `draft` | 없음 |
| 진행중 | 진행중 | `submitted`, `jira_created` | 건수 (항상 최신) |
| 완료 | 완료 | `done_synced`, `done_no_proposal` | 없음 |

---

## 백엔드 변경

### `GET /api/sr/drafts` 파라미터 추가

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `status` | `draft` \| `active` \| `done` | 없음 (전체) | 탭 필터 |
| `skip` | int | 0 | 페이지네이션 오프셋 |
| `limit` | int | 20 | 페이지 크기 |

status 매핑:
- `draft` → `["draft"]`
- `active` → `["submitted", "jira_created"]`
- `done` → `["done_synced", "done_no_proposal"]`
- 미지정 → 전체 (기존 동작 유지)

응답 형식 변경: `list[SRDraftResponse]` → `{ items: list[SRDraftResponse], total: int }`

### `app/services/sr_service.py`

`list_sr_drafts()` 시그니처 변경:

```python
async def list_sr_drafts(
    db: AsyncSession,
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 20,
) -> tuple[list[SRDraft], int]:
```

status 매핑 딕셔너리:
```python
STATUS_MAP = {
    "draft": ["draft"],
    "active": ["submitted", "jira_created"],
    "done": ["done_synced", "done_no_proposal"],
}
```

### `app/routers/sr.py`

`list_sr_drafts` 엔드포인트:
```python
@router.get("/drafts")
async def list_sr_drafts(
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
```

응답: `{ "items": [...], "total": N }`

---

## 프론트엔드 변경

### `frontend/src/lib/api.ts`

`listSRDrafts` 시그니처 변경:

```ts
listSRDrafts(params?: { status?: string; skip?: number; limit?: number })
  → Promise<{ items: SRDraft[]; total: number }>
```

### `frontend/src/pages/ServiceRequests.tsx`

Approvals와 동일한 패턴 적용:

- `tab` state: `"draft" | "active" | "done"`, 기본값 `"draft"`
- `page` state: 탭 전환 시 1로 리셋
- `pageSize` state: 기본값 20
- URL searchParams: `?tab=active` 반영 (뒤로가기 지원)
- 탭 배지용 별도 쿼리: `active` 건수만 항상 조회 (`skip=0, limit=500`)

탭별 동작:
- **초안 탭:** 수정/제출 버튼 표시 (기존 동작 유지)
- **진행중/완료 탭:** 읽기 전용, 버튼 없음

페이지네이션: Approvals와 동일한 컴포넌트 패턴 (이전/다음 버튼 + 페이지 표시)

---

## 테스트

기존 `test_sr.py` 패턴 유지.

```
test_list_sr_drafts_status_filter_draft   → draft 상태만 반환
test_list_sr_drafts_status_filter_active  → submitted, jira_created 반환
test_list_sr_drafts_status_filter_done    → done_synced, done_no_proposal 반환
test_list_sr_drafts_pagination            → skip/limit 동작 확인
test_list_sr_drafts_total_count           → total 필드 정확성 확인
```

---

## 미변경 사항

- SR 생성/수정/제출/삭제 로직 변경 없음
- `done_no_proposal` 상태는 완료 탭에 포함 (Jira 완료 후 관련 문서 없음)
- 기존 `jira_issue_key` 배지, AI 배지 표시 유지
