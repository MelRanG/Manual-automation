# SR 초안 인라인 편집 설계

**Goal:** `draft` 상태의 SR 카드에서 인라인으로 제목·설명·우선순위를 수정할 수 있게 한다.

---

## 백엔드

### 새 스키마 — `SRDraftUpdate`
`backend/app/schemas/sr.py`에 추가:
```python
class SRDraftUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
```

### 새 서비스 함수 — `update_sr_draft`
`backend/app/services/sr_service.py`에 추가:
- `SRDraft.status == "draft"` 인 경우에만 수정 허용, 아니면 `ValueError` 발생
- `None`이 아닌 필드만 업데이트

### 새 엔드포인트
`backend/app/routers/sr.py`에 추가:
```
PATCH /api/sr/drafts/{sr_id}
```
- `draft` 상태가 아니면 HTTP 400 반환
- 성공 시 `SRDraftResponse` 반환

---

## 프론트엔드

### `api.ts`
`updateSRDraft(id: string, data: { title?: string; description?: string; priority?: string })` 함수 추가 — `PATCH /api/sr/drafts/{id}` 호출.

### `ServiceRequests.tsx`
- `editingId: string | null` 상태 추가 — 현재 편집 중인 SR id
- `editForm: { title: string; description: string; priority: string }` 상태 추가
- `draft` 상태 카드 우측에 편집 아이콘 버튼(`edit` 아이콘) 추가, 제출 버튼과 나란히 배치
- 편집 아이콘 클릭 시 `editingId = sr.id`, `editForm`을 현재 SR 값으로 초기화
- 편집 모드 카드: 제목 input, 설명 textarea, 우선순위 select + 저장/취소 버튼
- 저장: `api.updateSRDraft()` 호출 → 성공 시 `editingId = null`, `refetch()`
- 취소: `editingId = null`

---

## 제약

- `draft` 상태가 아닌 SR(제출됨, Jira 생성됨 등)은 편집 버튼 미노출
- 저장 중에는 버튼 비활성화
