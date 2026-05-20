# Jira SR 페이지 개선 설계

**날짜:** 2026-05-21
**스코프:** `/sr` 페이지 검토 흐름 개선 — 5개 항목 (3,4,5,6,7번)
**제외:** 1번(Jira 이슈 링크), 2번(Jira webhook 동작) — 코드가 아닌 환경/설정 진단 영역, 별도로 처리

---

## 1. 배경

`/sr` (Jira SR) 페이지에 다음 문제가 있다:

| # | 문제 | 카테고리 |
|---|------|---------|
| 3 | 완료 처리 버튼 클릭 시 `/change-impact`로 navigate → 존재하지 않는 페이지로 이동 | UI 흐름 |
| 4 | 검토 1단계 옵션이 '신규 문서 작성' / '기존 문서 수정' 두 가지뿐. '문서 수정 없음' 케이스 없음 | UX 누락 |
| 5 | 사용자가 어떤 옵션을 선택할지 가이드 없음. SR 내용 기반 AI 추천이 필요 | UX 강화 |
| 6 | 검토 2단계 문서 선택 UI에서 무엇을 선택했는지 한눈에 드러나지 않음 | UI 명확성 |
| 7 | 초안 생성 후 탭 전환/새로고침 시 AI 수정 제안이 사라짐 — proposal 상태가 React state로만 보존됨 | 버그 |

승인 관리 페이지(`/approvals`)의 Jira SR 탭은 사용하지 않기로 결정. 개선 흐름은 `/sr` 페이지의 검토 탭 하나로 통합한다.

---

## 2. 목표

1. `/sr` 검토 탭이 SR의 문서 작업 의사결정을 완결적으로 처리한다 (신규/기존/없음 3선택지 + AI 추천 + 초안 + 승인).
2. 검토 진입 시점에 이전 상태(추천, 선택, 초안)를 복원한다.
3. 외부 페이지 이동 없이 같은 페이지에서 흐름이 이어진다.

## 3. 비목표

- 승인 관리 페이지(`/approvals`) 변경
- 다중 문서 동시 수정
- Jira 이슈 링크 정상화 (1번) — 별도 환경 진단
- Jira webhook 수신 정상화 (2번) — 별도 환경 진단

---

## 4. 아키텍처

### 4.1 단일 흐름

`/sr` 페이지의 좌측 SR 리스트에서 SR 선택 → 우측 `SRDetail` 컴포넌트의 "검토" 탭에서 모든 의사결정이 일어난다. 페이지 이동 없음.

### 4.2 변경 영역

| 영역 | 변경 |
|------|------|
| 백엔드 모델 | `sr_drafts.ai_doc_recommendation` JSONB nullable 추가 |
| 백엔드 endpoint | 신규 3개 (추천 GET/POST + latest-proposal GET) |
| 백엔드 서비스 | LLM 추천 함수 |
| 백엔드 상태 전이 | `update_sr_draft` 전이 화이트리스트 추가 |
| 프론트 컴포넌트 | `ServiceRequests.tsx` `SRDetail`/`SRReview` 수정 |
| 프론트 API | `api.ts`에 새 메서드 3개 |
| Alembic | 마이그레이션 1개 |
| 테스트 | pytest 신규/확장, Playwright E2E 신규 |

### 4.3 데이터 플로우

```
사용자 /sr → SR 선택 → 검토 탭 진입
  └─ SRReview mount
     ├─ GET /api/sr/drafts/{id}/ai-doc-recommendation
     │    └─ null이면 POST → LLM 호출 → DB 저장 → 응답
     └─ GET /api/sr/drafts/{id}/latest-proposal
          └─ 있으면 step=3 jump, proposal/docMode 복원

step 1: 옵션 3개 (신규/기존/없음) + AI 추천 배너
  ├─ '신규' → step 3
  ├─ '기존' → step 2 → 문서 선택 → step 3
  └─ '없음' → 확인 다이얼로그 → PATCH status=done_no_proposal → 종료

step 3: AI 초안 생성/표시 → 승인 → status=done_synced
```

### 4.4 SR 상태 머신

```
draft → submitted → jira_created → (Jira webhook done) → pending_doc_review
                                                              │
                                  ┌── 신규 작성 → 초안 → 승인 ─┤
                                  ├── 기존 수정 → 초안 → 승인 ─┼─→ done_synced
                                  └── 수정 없음 (확인) ────────┴─→ done_no_proposal
```

---

## 5. 데이터 모델

### 5.1 SRDraft 신규 칼럼

`backend/app/models/sr.py`:

```python
ai_doc_recommendation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

**JSONB 스키마:**

```json
{
  "recommendation": "new" | "existing" | "none",
  "reason": "1-3줄 한국어 설명",
  "suggested_document_id": "uuid" | null,
  "model": "bedrock-claude-3-sonnet",
  "created_at": "2026-05-21T10:00:00Z"
}
```

`suggested_document_id`는 `recommendation == "existing"`일 때만 의미가 있다. LLM이 추천한 문서가 실제 DB에 존재하지 않으면 저장 시 `null`로 강등.

### 5.2 마이그레이션

신규 파일: `backend/alembic/versions/<rev>_add_sr_ai_doc_recommendation.py`

```python
def upgrade():
    op.add_column(
        "sr_drafts",
        sa.Column("ai_doc_recommendation", postgresql.JSONB, nullable=True),
    )

def downgrade():
    op.drop_column("sr_drafts", "ai_doc_recommendation")
```

---

## 6. 백엔드 API

### 6.1 신규 endpoint

| 메서드 | 경로 | 동작 |
|--------|------|------|
| GET | `/api/sr/drafts/{sr_id}/ai-doc-recommendation` | 캐시된 추천 반환. 없으면 `null` |
| POST | `/api/sr/drafts/{sr_id}/ai-doc-recommendation?force=false` | 캐시 없으면 LLM 호출 → 저장 → 반환. `force=true`이면 무조건 재계산 |
| GET | `/api/sr/drafts/{sr_id}/latest-proposal` | 가장 최근 `ChangeImpactAnalysis` + 마지막 `DocumentChangeProposal` 묶어 반환. 없으면 `null` |

**`/latest-proposal` 응답 스키마:**

```json
{
  "impact_analysis": { "id": "...", "recommended_strategy": "update", "reasoning": "...", "created_at": "..." },
  "proposal": { "id": "...", "document_id": "...", "original_content": "...", "proposed_content": "...", "diff": "...", "status": "pending" } | null,
  "doc_mode_hint": "new" | "existing"
}
```

`doc_mode_hint`는 `proposal.document_id` 존재 여부로 결정.

### 6.2 LLM 추천 서비스

`backend/app/services/sr_service.py`에 추가:

```python
async def recommend_doc_strategy(db: AsyncSession, sr_draft: SRDraft) -> dict:
    """
    1. SR title/description/target_url 수집
    2. 모든 문서 메타데이터 가져오기 (id, title, description, tags) — limit 50
    3. LLM 호출:
         프롬프트 — "이 SR의 변경에 대해 문서 작업 전략을 추천하라.
                    선택지: new / existing / none.
                    existing이면 어떤 문서? document_id 함께.
                    이유 1-3줄 한국어."
         응답 형식 — JSON
    4. 응답 검증:
         - recommendation in {"new","existing","none"}
         - suggested_document_id 존재 시 DB에 실제 있는지 확인 → 없으면 null
    5. SRDraft.ai_doc_recommendation 갱신
    6. 반환
    """
```

LLM provider: 기존 `settings.llm_provider` 사용 (Bedrock 기본).

### 6.3 상태 전이 화이트리스트

`backend/app/services/sr_service.py` `update_sr_draft`:

```python
ALLOWED_TRANSITIONS = {
    "draft": {"submitted", "draft"},
    "submitted": {"jira_created", "draft"},
    "jira_created": {"pending_doc_review"},
    "pending_doc_review": {"done_synced", "done_no_proposal", "pending_doc_review"},
    # ...
}
```

위반 시 `ValueError("Invalid status transition: {from} → {to}")` → 라우터에서 HTTP 400.

### 6.4 4번 '문서 수정 없음' API

신규 endpoint 추가 없음. 기존 `PATCH /api/sr/drafts/{sr_id}`로 `{"status": "done_no_proposal"}` 전송.

---

## 7. 프론트엔드

### 7.1 `api.ts` 신규 메서드

```typescript
type AiDocRecommendation = {
  recommendation: "new" | "existing" | "none"
  reason: string
  suggested_document_id: string | null
  model: string
  created_at: string
}

type LatestProposalResponse = {
  impact_analysis: ImpactAnalysis
  proposal: ChangeProposal | null
  doc_mode_hint: "new" | "existing"
} | null

getAiDocRecommendation(srId): Promise<AiDocRecommendation | null>
postAiDocRecommendation(srId, force?: boolean): Promise<AiDocRecommendation>
getLatestProposal(srId): Promise<LatestProposalResponse>
```

### 7.2 3번 — 완료 처리 navigate 제거

`ServiceRequests.tsx` `SRDetail.handleLocalComplete`:

```typescript
// 기존
navigate("/change-impact")

// 변경
setActiveSection("review")
```

`useNavigate` import 다른 곳에서 더 안 쓰면 제거.

### 7.3 4번 — '문서 수정 없음' 옵션 카드

`SRReview` step 1: 옵션 카드 2개 → 3개. `DocMode` 타입을 `"new" | "existing" | "none" | null`로 확장.

세 번째 카드 클릭 동작:

1. 확인 다이얼로그: "이 SR을 문서 수정 없이 종료 처리합니까?"
2. 확인 → `api.updateSRDraft(sr.id, { status: "done_no_proposal" })`
3. 성공 → `onRefetch()` → 상태 배지 갱신

UI: 카드 아이콘 `block` 또는 `description_off`, grayscale 톤.

### 7.4 5번 — AI 추천 배너

`SRReview`에 신규 state: `recommendation: AiDocRecommendation | null`, `recError: string | null`, `recLoading: boolean`.

**mount 시점의 두 fetch (5번 추천 + 7번 latest-proposal)는 하나의 useEffect로 통합**해 순서 보장:

```typescript
useEffect(() => {
  if (sr.status !== "pending_doc_review") return
  let ignore = false
  ;(async () => {
    // 1. latest-proposal 먼저 — 있으면 step 3로 점프, selectedDocId 결정
    const latest = await api.getLatestProposal(sr.id)
    if (ignore) return
    let restoredDocId: string | null = null
    if (latest) {
      setDocMode(latest.doc_mode_hint)
      if (latest.proposal?.document_id) {
        setSelectedDocId(latest.proposal.document_id)
        restoredDocId = latest.proposal.document_id
      }
      if (latest.proposal) setProposal(latest.proposal)
      setStep(3)
    }

    // 2. 추천 fetch (이미 step 3로 점프했더라도 카드 표기는 필요할 수 있음 — 일관 표시)
    setRecLoading(true)
    let rec = await api.getAiDocRecommendation(sr.id)
    if (!rec) {
      try { rec = await api.postAiDocRecommendation(sr.id) }
      catch (e) {
        if (!ignore) setRecError("AI 추천 사용 불가")
        rec = null
      }
    }
    if (ignore) return
    setRecLoading(false)
    setRecommendation(rec)

    // latest-proposal로 이미 docId가 결정됐다면 그것 우선. 아니면 추천값으로 채움.
    if (!restoredDocId && rec?.recommendation === "existing" && rec.suggested_document_id) {
      setSelectedDocId(rec.suggested_document_id)
    }
  })()
  return () => { ignore = true }
}, [sr.id, sr.status])
```

**우선순위 규칙:** `latest-proposal`의 `document_id`가 있으면 그것이 권위. 추천은 step 1 옵션 강조 + 배너용으로만 사용.

step 1 옵션 카드 위 배너:

```
┌─────────────────────────────────────┐
│ ✨ AI 추천: 기존 문서 수정           │
│ 이 SR은 'API 인증 가이드' 문서의    │
│ 토큰 갱신 절차 업데이트가 필요합니다.│
│ [재생성]                             │
└─────────────────────────────────────┘
```

추천된 옵션 카드는 `border-[#4a4bdc]` + 우상단 `✨ AI 추천` 배지로 강조.

추천 로딩 중 — "AI 분석 중..." 텍스트. 실패 시 — "AI 추천 사용 불가" + 재시도 버튼. 옵션은 정상 동작.

### 7.5 6번 — 문서 선택 체크박스 UI

step 2 문서 리스트 항목:

```tsx
<button
  onClick={() => setSelectedDocId(doc.id)}
  className={`flex items-center gap-3 w-full text-left px-4 py-3 transition-colors ${
    selectedDocId === doc.id
      ? "bg-[#eef2ff] border-l-4 border-l-[#00288e]"
      : "hover:bg-[#f7f9fb] border-l-4 border-l-transparent"
  }`}
>
  <span
    className={`material-symbols-outlined text-base ${
      selectedDocId === doc.id ? "text-[#00288e]" : "text-[#9a9bad]"
    }`}
  >
    {selectedDocId === doc.id ? "radio_button_checked" : "radio_button_unchecked"}
  </span>
  <div className="flex-1">
    <p className="font-medium text-[#191c1e]">{doc.title}</p>
    {doc.description && <p className="text-xs text-[#757684] truncate">{doc.description}</p>}
  </div>
  {recommendation?.suggested_document_id === doc.id && (
    <span className="text-[10px] text-[#4a4bdc]">✨ 추천</span>
  )}
  {selectedDocId === doc.id && (
    <span className="text-[10px] font-semibold text-[#00288e] bg-[#e8f0fe] px-2 py-0.5 rounded-full">선택됨</span>
  )}
</button>
```

### 7.6 7번 — 검토 상태 복원

별도 useEffect로 두지 않고 7.4의 통합 useEffect 첫 단계에서 `getLatestProposal`을 처리한다 (위 코드 참조). 별도 effect였을 때 두 setter 간 경합이 생길 수 있어 한 effect로 묶는다.

다시 처음부터 시작하려면 step 3의 "← 뒤로" 버튼으로 step 1/2로 이동.

### 7.7 컴포넌트 분리 가이드

`SRReview`가 약 300줄 이상이 되면 다음으로 분리:

- `ReviewStepIndicator` — 진행 단계 표시
- `AiRecommendationBanner` — 추천 카드
- `DocModeOptionGrid` — step 1 옵션
- `DocumentPickerList` — step 2 단일 선택 리스트
- `ProposalPreview` — step 3 diff/제안

같은 파일 내 일단 진행, 400줄 초과 시 분리. 분리 자체는 별도 PR 권장.

---

## 8. 에러 처리

### 8.1 LLM 호출 실패

| 상황 | 동작 |
|------|------|
| LLM provider 오류 / 응답 JSON 파싱 실패 / 유효하지 않은 recommendation 값 | HTTP 502 `{ "detail": "AI 추천 생성 실패: <reason>" }`, SR 상태 변경 없음, 캐시 변경 없음 |
| 프론트 수신 | 배너에 "AI 추천 사용 불가. 직접 선택해주세요" + [재시도]. 옵션 카드 정상 동작 |

### 8.2 동시 LLM 호출 경합

사용자 A·B가 거의 동시에 검토 탭 진입 → 둘 다 캐시 없음 → 둘 다 LLM 호출.

완화: `POST /ai-doc-recommendation`에서 트랜잭션 시작 시 `SELECT ... FOR UPDATE`로 `sr_drafts` row lock + `ai_doc_recommendation` 재조회. 이미 채워졌으면 LLM 스킵, 기존 값 반환 (`force=true` 아닐 때).

### 8.3 SR 상태 비정상 전이

`update_sr_draft` 상태 화이트리스트 (6.3 참조) 위반 시 HTTP 400. 프론트 에러 토스트.

### 8.4 mount useEffect 경합

`sr.id` 빠른 토글 시 stale response가 새 state 덮을 위험 → `ignore` 플래그 (7.4, 7.6 참조).

### 8.5 '문서 수정 없음' 후 되돌리기

`done_no_proposal`은 종료 상태. 되돌리기 버튼 없음. 확인 다이얼로그가 1차 방어.

검토 탭 진입 가드 메시지를 상태별로 분기:

```typescript
if (sr.status === "done_no_proposal") return <Message>이 SR은 문서 수정 없이 종료되었습니다.</Message>
if (sr.status === "done_synced" || sr.status === "done") return <Message>이 SR은 이미 완료되었습니다.</Message>
if (sr.status !== "pending_doc_review") return <Message>Jira 이슈가 완료된 후 검토 단계가 활성화됩니다.</Message>
```

### 8.6 추천이 'none'인데 사용자가 다른 옵션 선택

자유. 추천은 가이드일 뿐 강제 아님. 추천 결과는 변경 없이 카드에 남김 (감사 추적).

### 8.7 추천된 문서가 삭제됨

POST 저장 시점에 1차 검증 (6.2 참조). 이후 캐시된 추천을 step 2에 표시 시 문서 목록에서 존재 확인 → 없으면 highlight skip, 정상 선택 흐름.

### 8.8 빈 문서 목록

step 2 진입 시 `docs.length === 0`이면 "등록된 문서가 없습니다. 신규 문서 작성을 선택해주세요" + step 1로 돌아가기 버튼.

### 8.9 `generateProposalForDocument` 실패

기존 코드는 silent fail. 변경: 에러 메시지 + [재시도] 버튼 표시. step 3 유지.

### 8.10 webhook 트리거 전 검토 탭 진입

기존 가드 유지: `sr.status !== "pending_doc_review"` → "Jira 이슈가 완료된 후 검토 단계가 활성화됩니다."

---

## 9. 테스트

### 9.1 백엔드 단위 테스트

신규 파일 `backend/tests/test_ai_doc_recommendation.py`:

- `test_get_recommendation_returns_null_when_none_cached`
- `test_post_recommendation_calls_llm_and_persists`
- `test_post_recommendation_returns_cached_without_force`
- `test_post_recommendation_force_recomputes`
- `test_post_recommendation_invalid_llm_json_returns_502`
- `test_post_recommendation_invalid_recommendation_value_returns_502`
- `test_post_recommendation_nonexistent_suggested_doc_id_strips_to_null`

신규 파일 `backend/tests/test_latest_proposal.py`:

- `test_latest_proposal_returns_null_when_no_analysis`
- `test_latest_proposal_returns_doc_mode_hint_existing`
- `test_latest_proposal_returns_doc_mode_hint_new`
- `test_latest_proposal_returns_latest_when_multiple`

확장 `backend/tests/test_sr.py`:

- `test_update_sr_to_done_no_proposal_from_pending_doc_review`
- `test_update_sr_to_done_no_proposal_from_draft_rejects`

LLM은 monkeypatch로 mock.

### 9.2 프론트엔드 E2E (Playwright)

신규 파일 `frontend/e2e/jira-sr-review.spec.ts`:

- 검토 탭 진입 → AI 추천 배너 + 옵션 강조
- '문서 수정 없음' → 다이얼로그 → `done_no_proposal` 전환
- step 2 단일 선택 → 라디오 토글 + "선택됨" 배지
- 초안 생성 후 다른 SR 클릭 → 돌아오기 → step 3 + 초안 그대로
- 완료 처리 버튼 → URL 변화 없음 + 검토 탭 활성화

### 9.3 수동 검증 체크리스트

1. `cd backend && uv run alembic upgrade head`
2. `cd backend && uv run pytest`
3. `cd backend && uv run ruff check && uv run mypy .`
4. `cd frontend && pnpm typecheck && pnpm lint`
5. `docker compose up --build` 후 `/sr`:
   - SR 생성 → status=pending_doc_review (시뮬레이터)
   - 검토 탭 → 배너 + 옵션 3개
   - '없음' 흐름 → done_no_proposal 배지
   - '기존' → 체크박스 UI → 초안 생성
   - 탭 전환 후 돌아오기 → 초안 유지
   - 완료 처리 버튼 → 같은 페이지 + 검토 탭

---

## 10. 출시 후 모니터링

별도 알람 없음. LLM 호출 비용은 기존 `llm_invocations` 로그(있으면)로 확인.

추천 정확도 (사용자가 추천과 다른 옵션 고른 비율 등)는 이번 스펙 범위 외.
