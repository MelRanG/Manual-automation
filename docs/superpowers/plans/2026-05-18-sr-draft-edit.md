# SR 초안 인라인 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `draft` 상태의 SR에 대해 인라인 편집(제목·설명·우선순위)을 백엔드 PATCH 엔드포인트와 프론트 카드 편집 UI로 구현한다.

**Architecture:** 백엔드에 `SRDraftUpdate` 스키마, `update_sr_draft` 서비스 함수, `PATCH /api/sr/drafts/{sr_id}` 엔드포인트를 추가한다. 프론트는 `ServiceRequests.tsx`에서 `editingId` 상태로 편집 모드를 관리하고, 카드가 인라인 폼으로 전환된다.

**Tech Stack:** FastAPI, SQLAlchemy async, Pydantic, React, TypeScript, Tailwind CSS

---

## 파일 구조

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/schemas/sr.py` | `SRDraftUpdate` 스키마 추가 |
| `backend/app/services/sr_service.py` | `update_sr_draft()` 함수 추가 |
| `backend/app/routers/sr.py` | `PATCH /api/sr/drafts/{sr_id}` 엔드포인트 추가 |
| `backend/tests/test_sr.py` | 편집 관련 테스트 추가 |
| `frontend/src/lib/api.ts` | `updateSRDraft()` 함수 추가 |
| `frontend/src/pages/ServiceRequests.tsx` | 인라인 편집 UI 추가 |

---

### Task 1: 백엔드 — 스키마, 서비스, 엔드포인트 (TDD)

**Files:**
- Modify: `backend/app/schemas/sr.py`
- Modify: `backend/app/services/sr_service.py`
- Modify: `backend/app/routers/sr.py`
- Test: `backend/tests/test_sr.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_sr.py` 끝에 추가:

```python
@pytest.mark.asyncio(loop_scope="session")
async def test_update_sr_draft(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "Original Title",
        "description": "Original description",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/sr/drafts/{sr_id}", json={
        "title": "Updated Title",
        "priority": "high",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Updated Title"
    assert data["priority"] == "high"
    assert data["description"] == "Original description"


@pytest.mark.asyncio(loop_scope="session")
async def test_update_submitted_sr_fails(client: AsyncClient, test_user: dict):
    create_resp = await client.post("/api/sr/drafts", json={
        "user_id": test_user["id"],
        "title": "To Submit",
        "description": "desc",
        "priority": "low",
    })
    sr_id = create_resp.json()["id"]
    await client.post(f"/api/sr/drafts/{sr_id}/submit")

    resp = await client.patch(f"/api/sr/drafts/{sr_id}", json={"title": "New Title"})
    assert resp.status_code == 400
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd backend && uv run pytest tests/test_sr.py::test_update_sr_draft tests/test_sr.py::test_update_submitted_sr_fails -v
```

Expected: FAIL with `404 Not Found` (엔드포인트 없음)

- [ ] **Step 3: `SRDraftUpdate` 스키마 추가**

`backend/app/schemas/sr.py`에 추가:

```python
class SRDraftUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
```

- [ ] **Step 4: `update_sr_draft` 서비스 함수 추가**

`backend/app/services/sr_service.py`에 추가 (`list_sr_drafts` 함수 앞):

```python
async def update_sr_draft(db: AsyncSession, sr_id: uuid.UUID, data: dict) -> SRDraft:
    result = await db.execute(select(SRDraft).where(SRDraft.id == sr_id))
    draft = result.scalar_one_or_none()
    if not draft:
        raise ValueError("SR draft not found")
    if draft.status != "draft":
        raise PermissionError("Only draft status SR can be edited")
    for key, value in data.items():
        if value is not None:
            setattr(draft, key, value)
    await db.commit()
    await db.refresh(draft)
    return draft
```

- [ ] **Step 5: PATCH 엔드포인트 추가**

`backend/app/routers/sr.py`에서 `from app.schemas.sr import SRDraftCreate, SRDraftResponse, SRGenerateRequest`를 아래로 변경:

```python
from app.schemas.sr import SRDraftCreate, SRDraftResponse, SRDraftUpdate, SRGenerateRequest
```

그리고 `submit_sr` 엔드포인트 아래에 추가:

```python
@router.patch("/drafts/{sr_id}", response_model=SRDraftResponse)
async def update_sr_draft(
    sr_id: uuid.UUID,
    data: SRDraftUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await sr_service.update_sr_draft(db, sr_id, data.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd backend && uv run pytest tests/test_sr.py -v
```

Expected: 모든 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/app/schemas/sr.py backend/app/services/sr_service.py backend/app/routers/sr.py backend/tests/test_sr.py
git commit -m "feat: SR 초안 PATCH 엔드포인트 추가 (draft 상태만 수정 가능)"
```

---

### Task 2: 프론트엔드 — api.ts 함수 추가 및 인라인 편집 UI

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/ServiceRequests.tsx`

- [ ] **Step 1: `api.ts`에 `updateSRDraft` 추가**

`frontend/src/lib/api.ts`에서 `submitSR` 함수를 찾아 그 아래에 추가:

```typescript
updateSRDraft: async (id: string, data: { title?: string; description?: string; priority?: string }): Promise<SRDraft> => {
  const res = await fetch(`/api/sr/drafts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
},
```

- [ ] **Step 2: `ServiceRequests.tsx` 상태 및 핸들러 추가**

파일 상단 `const [submitting, setSubmitting] = useState(false)` 아래에 추가:

```typescript
const [editingId, setEditingId] = useState<string | null>(null)
const [editForm, setEditForm] = useState({ title: "", description: "", priority: "medium" })
const [saving, setSaving] = useState(false)
```

`handleSubmit` 함수 아래에 추가:

```typescript
const handleEditStart = (sr: { id: string; title: string; description: string; priority: string }) => {
  setEditingId(sr.id)
  setEditForm({ title: sr.title, description: sr.description, priority: sr.priority })
}

const handleEditSave = async () => {
  if (!editingId) return
  setSaving(true)
  try {
    await api.updateSRDraft(editingId, editForm)
    setEditingId(null)
    refetch()
  } finally {
    setSaving(false)
  }
}
```

- [ ] **Step 3: 카드 렌더링에 편집 모드 분기 추가**

`ServiceRequests.tsx`에서 카드 부분(`{drafts.map((sr) => (` 안)을 아래로 교체:

```tsx
{drafts.map((sr) => (
  <div key={sr.id} className="bg-white border border-[#c4c5d5] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
    {editingId === sr.id ? (
      <div className="space-y-3">
        <input
          className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none"
          value={editForm.title}
          onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
        />
        <textarea
          className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none resize-none"
          rows={3}
          value={editForm.description}
          onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
        />
        <select
          className="w-full px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm focus:border-[#00288e] focus:ring-1 focus:ring-[#00288e] outline-none bg-white"
          value={editForm.priority}
          onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}
        >
          <option value="low">낮음</option>
          <option value="medium">보통</option>
          <option value="high">높음</option>
          <option value="critical">긴급</option>
        </select>
        <div className="flex gap-2">
          <button onClick={handleEditSave} disabled={saving} className="px-4 py-2 bg-[#00288e] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] disabled:opacity-50 transition-colors">
            {saving ? "저장 중..." : "저장"}
          </button>
          <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm text-[#444653] hover:bg-[#f2f4f6] rounded-lg transition-colors">취소</button>
        </div>
      </div>
    ) : (
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-lg bg-[#dde1ff] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-lg text-[#00288e]">confirmation_number</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-[#191c1e]">{sr.title}</p>
              {sr.created_by_ai && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#dde1ff] text-[#00288e]">
                  <span className="material-symbols-outlined text-[12px]">auto_awesome</span>
                  AI
                </span>
              )}
              {sr.jira_issue_key && sr.jira_issue_url && (
                <a
                  href={sr.jira_issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e8f0fe] text-[#1a56db] hover:bg-[#c7d7fb] transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  <span className="material-symbols-outlined text-[12px]">link</span>
                  {sr.jira_issue_key}
                </a>
              )}
            </div>
            <p className="text-xs text-[#444653] mt-1 line-clamp-2">{sr.description}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${getPriorityStyle(sr.priority)}`}>
                {sr.priority === "critical" ? "긴급" : sr.priority === "high" ? "높음" : sr.priority === "medium" ? "보통" : "낮음"}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                sr.status === "done_synced" ? "bg-[#d5e3fc] text-[#16a34a]" :
                sr.status === "jira_created" ? "bg-[#e8f0fe] text-[#1a56db]" :
                sr.status === "submitted" ? "bg-[#d5e3fc] text-[#16a34a]" : "bg-[#e6e8ea] text-[#444653]"
              }`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {sr.status === "done_synced" ? "완료 동기화됨" : sr.status === "jira_created" ? "Jira 생성됨" : sr.status === "submitted" ? "제출됨" : "초안"}
              </span>
              <span className="text-[11px] text-[#757684]">{new Date(sr.created_at).toLocaleDateString("ko-KR")}</span>
            </div>
          </div>
        </div>
        {sr.status === "draft" && (
          <div className="flex items-center gap-2">
            <button onClick={() => handleEditStart(sr)} className="flex items-center gap-1 px-3 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#444653] hover:bg-[#f2f4f6] transition-colors">
              <span className="material-symbols-outlined text-base">edit</span>
            </button>
            <button onClick={() => handleSubmit(sr.id)} className="flex items-center gap-2 px-4 py-2 border border-[#c4c5d5] rounded-lg text-sm text-[#191c1e] hover:bg-[#f2f4f6] transition-colors">
              <span className="material-symbols-outlined text-base">send</span>
              제출
            </button>
          </div>
        )}
      </div>
    )}
  </div>
))}
```

- [ ] **Step 4: 타입 체크 및 lint 확인**

```bash
cd frontend && npx tsc -b && npx eslint src/pages/ServiceRequests.tsx src/lib/api.ts
```

Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/ServiceRequests.tsx
git commit -m "feat: SR 초안 인라인 편집 UI 추가"
```
