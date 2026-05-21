# Jira SR done 검토 흐름 개선 Design

**Goal:** Jira webhook 으로 SR 이 done 처리될 때 (1) AI 추천 사전 생성, (2) 검토 결정 전 자동 완료 차단, (3) 검토 후 내역 표시, (4) AI 초안 본문 reviewer 수정 후 승인 기능, (5) 시뮬레이터 버튼 제거.

**Architecture overview:**

```
[Jira] --webhook done--> [POST /api/jira/webhook]
                              │
                              ├─ sync: status=pending_doc_review, approval_request 생성, 알림
                              └─ asyncio.create_task: prefetch_recommendation(sr_id)
                                                          └─ recommend_doc_strategy → ai_doc_recommendation 저장

[Frontend] /sr?tab=pending_doc_review → 카드 클릭
              ├─ GET ai-doc-recommendation (대부분 캐시 hit, 즉시 표시)
              ├─ step 1: 추천 + 모드 선택 (new/existing/none)
              ├─ step 2: 문서 선택 (existing 모드)
              └─ step 3: "AI 초안 생성" → analyze_impact + generate_proposal (LLM)
                         └─ proposal 본문 표시 (textarea 편집 가능, auto-grow)
                         └─ 승인 | 수정 후 승인 | 다시 생성

[승인 액션] → review_doc_review_approval → done_synced (approve/edit_and_approve) | done_no_proposal (reject)
                                              │
                                              └─ pending_doc_review → done_* 은 이 경로만 허용

[완료 SR 카드 클릭] → GET /sr/drafts/{id}/review-history → 검토 내역 섹션
```

**Tech Stack:** React + Vite (TypeScript), Python FastAPI

---

## 핵심 원칙

1. **추천만** webhook 시점 백그라운드 사전 생성. **초안 본문**은 사용자 모드/문서 선택 후 명시 LLM 호출
2. `pending_doc_review → done_*` 전이는 `review_doc_review_approval` 경로 1개만 허용. 다른 경로 차단/제거
3. 완료 SR 검토 내역 조회 API + UI 추가
4. AI 초안 본문 reviewer textarea 편집 가능, "수정 후 승인" 액션으로 적용
5. 프로덕션 UI 에서 "완료 처리 (시뮬레이터)" 버튼 제거 (백엔드 endpoint 는 테스트 픽스처용으로 유지)

---

## 변경 파일

### 백엔드
- Modify: `backend/app/routers/jira.py` — webhook 핸들러에 prefetch task 추가
- Modify: `backend/app/services/sr_service.py` — `prefetch_recommendation` 함수 추가, status transition 가드 강화
- Modify: `backend/app/services/approval_service.py` — `review_doc_review_approval` 에 `edit_and_approve` 지원
- Modify: `backend/app/schemas/approval.py` — `DocReviewAction` 확장
- Add: `backend/app/routers/sr.py` — `GET /drafts/{id}/review-history` 엔드포인트
- Add: `backend/app/schemas/sr.py` — `SRReviewHistoryResponse` 스키마

### 프론트엔드
- Modify: `frontend/src/pages/ServiceRequests.tsx` — proposal textarea 편집/수정승인, ReviewHistoryView 컴포넌트, 시뮬레이터 버튼 제거, status 직접 변경 호출 제거
- Modify: `frontend/src/lib/api.ts` — `reviewDocApproval` 시그니처 확장, `getSRReviewHistory` 추가, `completeSRLocal` 제거
- Modify: `frontend/src/types.ts` — `SRReviewHistory`, `ReviewHistoryAction` 타입 추가

### 테스트
- Modify: `backend/tests/test_jira.py` — prefetch task, status 검증 확장
- Add: `backend/tests/test_approval_service.py` (또는 기존 확장) — `edit_and_approve`, 가드 시나리오
- Add: `backend/tests/test_sr_transition_guard.py` — `update_sr_draft` API 우회 차단 검증
- Modify: `backend/tests/test_sr.py` — `/review-history` 엔드포인트 케이스 추가

---

## 백엔드 상세

### 1. Webhook 핸들러 (jira.py)

`POST /api/jira/webhook` — done 분기에서 approval_request 생성·commit 직후:

```python
import asyncio
from app.db import SessionLocal
from app.services.sr_service import prefetch_recommendation

asyncio.create_task(prefetch_recommendation(draft.id))
```

prefetch 는 별도 세션으로 실행. 실패해도 webhook 200.

### 2. prefetch_recommendation (sr_service.py)

```python
async def prefetch_recommendation(sr_id: uuid.UUID) -> None:
    """webhook 백그라운드용. 실패해도 진입 시 fallback 이 처리."""
    async with SessionLocal() as session:
        result = await session.execute(select(SRDraft).where(SRDraft.id == sr_id))
        draft = result.scalar_one_or_none()
        if not draft or draft.ai_doc_recommendation:
            return
        try:
            await ai_recommendation_service.recommend_doc_strategy(session, draft)
        except Exception as e:
            logger.warning(f"prefetch recommendation 실패 sr={sr_id}: {e}")
```

### 3. review_doc_review_approval 확장 (approval_service.py)

```python
async def review_doc_review_approval(
    db, approval_id, reviewer_id, action,
    target_url=None, edited_content=None, comment=None,
):
    """doc_review 타입 승인 처리.
    action: "reject" | "approve_doc" | "approve_manual" | "edit_and_approve"
    """
    valid_actions = ("reject", "approve_doc", "approve_manual", "edit_and_approve")
    ...
    if action == "edit_and_approve":
        if not edited_content:
            raise ValueError("edited_content required for edit_and_approve")
        # proposed_change.proposed_text = edited_content 적용 후 approve_doc 와 동일 처리
        approval.status = "approved"
        approval.comment = comment
        # 가장 최신 DocumentChangeProposal 찾아 proposed_text 교체
        proposal = await _get_latest_proposal_for_sr(db, draft.id)
        if proposal:
            proposal.proposed_text = edited_content
        draft.status = "done_synced"
        # process_completed_sr 또는 직접 적용 로직
    ...
```

기존 `approve_doc` / `approve_manual` 분기에도 `comment` 저장 추가.

### 4. Status transition 가드 (sr_service.py)

`update_sr_draft` 의 STATUS_MAP 에서 `pending_doc_review → done_synced/done_no_proposal` 허용 제거. 또는 API 경로(`PATCH /drafts/{id}`)에서 사용자가 `status` 필드를 done_* 로 변경하려고 하면 400 반환:

```python
async def update_sr_draft(db, sr_id, data: dict):
    draft = ...
    if "status" in data:
        new_status = data["status"]
        if draft.status == "pending_doc_review" and new_status in ("done_synced", "done_no_proposal"):
            raise ValueError("pending_doc_review must transition via review action")
    ...
```

내부 호출(`review_doc_review_approval` 등)은 ORM 직접 변경하므로 영향 없음.

### 5. GET /drafts/{id}/review-history (sr.py + schemas)

```python
@router.get("/drafts/{sr_id}/review-history", response_model=SRReviewHistoryResponse | None)
async def get_review_history(sr_id, db):
    draft = ...
    if draft.status == "pending_doc_review":
        return SRReviewHistoryResponse(status="in_review", message="검토 진행 중")

    # approval(doc_review, sr_draft_id=sr_id) 최신 1건
    # 최신 ChangeImpactAnalysis + DocumentChangeProposal
    # 선택된 문서 정보
    # ai_doc_recommendation
    # selected_doc_mode 추론:
    #   - proposal 없음 + approval.action=reject → "none"
    #   - proposal.document_id 있음 → "existing"
    #   - proposal.document_id 없음 (있지만 신규) → "new"
    return SRReviewHistoryResponse(
        status=draft.status,  # done_synced | done_no_proposal | in_review
        ai_recommendation=draft.ai_doc_recommendation,
        selected_doc_mode=...,
        selected_document_id=...,
        selected_document_title=...,
        final_proposal={
            "proposed_content": proposal.proposed_text if proposal else None,
            "original_content": proposal.original_text if proposal else None,
            "diff": proposal.diff if proposal else None,
        },
        reviewer_id=approval.reviewer_id,
        reviewer_name=...,
        reviewed_at=approval.reviewed_at,
        action=approval.action,  # approved/edit_and_approve/rejected
        comment=approval.comment,
        edited_content=...,  # edit_and_approve 인 경우 proposed_text 와 동일
    )
```

스키마는 `backend/app/schemas/sr.py` 에 추가.

---

## 프론트엔드 상세

### 1. ServiceRequests.tsx — DocReviewPanel

**step 3 textarea 편집 (line 766-806 영역):**

```tsx
const [editedContent, setEditedContent] = useState<string>("")
const taRef = useRef<HTMLTextAreaElement>(null)

useEffect(() => {
  if (proposal) setEditedContent(proposal.proposed_content)
}, [proposal])

const handleAutoGrow = () => {
  const el = taRef.current
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${el.scrollHeight}px`
}

useEffect(handleAutoGrow, [editedContent])

// 우측 textarea
<textarea
  ref={taRef}
  value={editedContent}
  onChange={(e) => { setEditedContent(e.target.value); handleAutoGrow() }}
  onInput={handleAutoGrow}
  className="text-xs text-[#191c1e] bg-[#f0fdf4] p-3 rounded-lg border border-[#bbf7d0] whitespace-pre-wrap min-h-[12rem] w-full font-mono resize-none overflow-hidden"
/>

// 버튼
<div className="flex gap-2">
  <button onClick={() => handleApprove({ edited: false })} disabled={applying}>
    {applying ? "반영 중..." : "승인"}
  </button>
  <button
    onClick={() => handleApprove({ edited: true })}
    disabled={applying || editedContent === proposal.proposed_content}
  >
    수정 후 승인
  </button>
  <button onClick={() => setProposal(null)}>다시 생성</button>
</div>
```

`handleApprove`:

```typescript
const handleApprove = async ({ edited }: { edited: boolean }) => {
  if (!approvalId) return
  setApplying(true)
  try {
    await api.reviewDocApproval(approvalId, {
      action: edited ? "edit_and_approve" : "approve_doc",
      edited_content: edited ? editedContent : undefined,
    })
    onRefetch()
  } finally {
    setApplying(false)
  }
}
```

→ `api.updateSRDraft({status: "done_synced"})` 호출 제거.

**"문서 변경 없음" 처리 (line 475-486):**

```typescript
const handleConfirmNone = async () => {
  ...
  await api.reviewDocApproval(approvalId, { action: "reject", comment: "문서 변경 불필요" })
  // status 직접 변경 X
  onRefetch()
  ...
}
```

→ `api.updateSRDraft({status: "done_no_proposal"})` 호출 제거. 백엔드는 `reject` 시 `done_no_proposal` 로 전이 중.

**시뮬레이터 버튼 제거:**
- `ServiceRequests.tsx:261` `handleSubmit` 내 `await api.completeSRLocal(sr.id)` 라인 삭제
- 관련 버튼 `ServiceRequests.tsx:383` "완료 처리 (시뮬레이터)" 제거
- `submittingId` state 가 다른 데 쓰이면 유지, 단순 시뮬용이면 제거

**완료 SR 검토 내역 — ReviewHistoryView:**

```tsx
function ReviewHistoryView({ srId, status }: { srId: string; status: string }) {
  const [history, setHistory] = useState<SRReviewHistory | null>(null)
  useEffect(() => {
    api.getSRReviewHistory(srId).then(setHistory)
  }, [srId])
  if (!history) return <div>...</div>

  const actionLabel: Record<ReviewHistoryAction, string> = {
    approve_doc: "승인",
    approve_manual: "매뉴얼 생성 승인",
    edit_and_approve: "수정 후 승인",
    reject: "문서 변경 없음",
  }

  return (
    <div className="space-y-4">
      {/* 1. 결정 헤더 */}
      <div className="flex items-center gap-2">
        <span className="badge">{history.action ? actionLabel[history.action] : ""}</span>
        <span>{history.reviewer_name} · {history.reviewed_at}</span>
      </div>
      {/* 2. AI 추천 */}
      <section>
        <h4>AI 추천</h4>
        <p>{history.ai_recommendation.recommendation} · {history.ai_recommendation.reason}</p>
      </section>
      {/* 3. 선택 결과 */}
      <section>
        <h4>선택</h4>
        <p>{history.selected_doc_mode} · {history.selected_document_title}</p>
      </section>
      {/* 4. 적용 본문 (approve_doc/edit_and_approve 만) */}
      {history.final_proposal?.proposed_content && (
        <section>
          <h4>적용된 본문</h4>
          <div className="grid grid-cols-2 gap-3">
            <pre>{history.final_proposal.original_content}</pre>
            <pre>{history.final_proposal.proposed_content}</pre>
          </div>
        </section>
      )}
      {/* 5. 코멘트 */}
      {history.comment && (
        <section>
          <h4>검토 코멘트</h4>
          <p>{history.comment}</p>
        </section>
      )}
    </div>
  )
}
```

기존 `if (sr.status !== "pending_doc_review")` 분기를 `<ReviewHistoryView srId={sr.id} status={sr.status} />` 로 교체.

### 2. api.ts

```typescript
reviewDocApproval: (approvalId: string, body: { action: "approve_doc" | "approve_manual" | "reject" | "edit_and_approve"; target_url?: string; edited_content?: string; comment?: string }) =>
  request(`/approvals/${approvalId}/doc-review`, { method: "POST", body: JSON.stringify(body) }),

getSRReviewHistory: (srId: string) =>
  request<SRReviewHistory | null>(`/sr/drafts/${srId}/review-history`),

// completeSRLocal 제거
```

### 3. 타입 (types.ts)

```typescript
export type ReviewHistoryAction = "approve_doc" | "approve_manual" | "edit_and_approve" | "reject"

export interface SRReviewHistory {
  status: string  // done_synced | done_no_proposal | in_review
  ai_recommendation: AiDocRecommendation | null
  selected_doc_mode: "new" | "existing" | "none" | null
  selected_document_id: string | null
  selected_document_title: string | null
  final_proposal: { proposed_content: string | null; original_content: string | null; diff: string | null } | null
  reviewer_id: string | null
  reviewer_name: string | null
  reviewed_at: string | null
  action: ReviewHistoryAction | null
  comment: string | null
  edited_content: string | null
}
```

---

## 데이터 흐름

### 시나리오 A: webhook done → 검토 → 수정 후 승인

1. Jira webhook done → status=pending_doc_review, approval_request 생성, prefetch task 스케줄
2. 백그라운드: recommend_doc_strategy → ai_doc_recommendation 저장
3. 사용자 진입 → GET latest-proposal (null) + GET ai-doc-recommendation (캐시 hit) → step 1 즉시 표시
4. 사용자 모드/문서 선택 → step 3 "AI 초안 생성" 클릭 → analyze_impact + generate_proposal (LLM)
5. proposal 본문 textarea 표시, reviewer 편집
6. "수정 후 승인" → POST /approvals/{id}/doc-review {action: "edit_and_approve", edited_content}
7. 백엔드: approval.status=approved, proposal.proposed_text=edited_content, draft.status=done_synced, 문서 적용
8. 프론트 refetch → 완료탭

### 시나리오 B: 완료 SR 검토 내역 조회
- 완료탭 → 카드 클릭 → GET /sr/drafts/{id}/review-history → ReviewHistoryView 렌더

### 시나리오 C: 추천 prefetch 실패
- webhook 백그라운드 prefetch 실패 → ai_doc_recommendation 미저장
- 진입 시 GET 캐시 미스 → 자동 POST 동기 재생성
- 실패 시 step 1 에러 + 재시도 버튼 (현 UI 유지)

### 시나리오 D: 자동 transition 차단
- `PATCH /sr/drafts/{id}` 로 status=done_synced 시도 → 400 에러
- review action 외 경로 차단

---

## 에러 처리

- webhook prefetch 실패 → warning log, 응답 200, jira_callback_logs 정상
- 추천 생성 실패 → step 1 에러 + 재시도 버튼
- 초안 생성 실패 → step 3 에러 + 다시 생성 버튼
- 검토 동시 호출 → `approval.status != "pending"` 으로 400
- `edit_and_approve` + edited_content 누락 → 400
- 적용 실패 → 롤백, 500, 사용자 재시도
- transition 가드 위반 → 400 `"pending_doc_review must transition via review action"`
- review-history: pending_doc_review → `{status: "in_review"}`, SR 없음 → 404, partial 데이터 → warning log
- Race: 동일 webhook 중복 → 기존 status 체크로 skip. 동시 추천 POST → `with_for_update` 락

---

## 테스트

### 백엔드

**test_jira.py:**
- webhook done 시 status, approval_request, 알림 link_path 검증
- prefetch task 스케줄 검증 (mock `recommend_doc_strategy`)
- prefetch 실패해도 webhook 200
- 중복 webhook skip

**test_approval_service.py (확장):**
- `approve_doc` → draft.status=done_synced, proposed_text 유지
- `edit_and_approve` (edited_content 포함) → proposed_text=edited_content, status=done_synced
- `edit_and_approve` + edited_content=None → ValueError
- `reject` + comment → status=done_no_proposal, comment 저장
- 이미 reviewed → ValueError

**test_sr_transition_guard.py (신규):**
- pending_doc_review 상태에서 `PATCH /drafts/{id}` status=done_synced → 400
- status=done_no_proposal → 400
- 다른 필드(title 등) 변경은 허용

**test_sr.py (확장):**
- GET /review-history:
  - pending_doc_review → `{status: "in_review"}`
  - done_synced + edit_and_approve → 전체 필드 반환, edited_content 일치
  - done_no_proposal (reject) → proposal null, comment 포함
  - SR 없음 → 404

### 프론트엔드 수동 검증

1. backend dev + `pnpm dev` 실행
2. Jira webhook 시뮬레이션 (curl `POST /api/jira/webhook`)
3. `/sr?tab=pending_doc_review` → 카드 표시, 클릭 → step 1 추천 즉시 표시
4. 모드/문서 선택 → step 3 AI 초안 생성 → textarea 표시
5. textarea 내용 추가 입력 시 Enter 입력으로 창 자동 늘어남 확인
6. "수정 후 승인" → 완료탭 이동, 문서 페이지에서 edited_content 적용 확인
7. 완료 SR 카드 클릭 → ReviewHistoryView 전부 표시
8. 거부(문서 변경 없음) → 완료탭, 본문 없이 사유만
9. "완료 처리 (시뮬레이터)" 버튼 보이지 않음

### 자동
- `pnpm typecheck`, `pnpm lint` 통과
- `uv run pytest`, `uv run ruff check`, `uv run mypy .` 통과

### 회귀
- feedback approval (`review_approval`) 영향 X
- Approvals.tsx Jira SR 탭 4필터 카운트 영향 X
- SR 페이지 다른 탭 카운트 변동 없음
