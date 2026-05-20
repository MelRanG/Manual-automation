# 매뉴얼 생성 페이지 AI 초안 인라인 검토 기능 설계

- **작성일**: 2026-05-21
- **브랜치**: `feat/jira-sr-improvements`
- **범위**: `ManualGenerator` (매뉴얼 생성 메뉴) AI 초안 탭에 검토/편집/반려 UI 인라인 추가, `/approval` 페이지의 Playwright 탭은 제거(통합 이동)

## 배경

매뉴얼 생성 메뉴에서 Playwright로 자동 생성된 AI 초안의 검토는 현재 `/approval` 페이지의 Playwright 탭에서만 가능하다. AI 초안 탭은 거의 비어 있고 "문서 관리 메뉴에서 확인하세요" 안내만 표시한다. 사용자는 자기가 만든 매뉴얼을 검토하기 위해 페이지를 옮겨야 한다.

검토 동선을 매뉴얼 생성 페이지로 통합한다. `/approval`의 Playwright 탭은 제거한다 (UI 중복 제거, 흐름 단일화).

## 목표

- ManualGenerator의 "AI 초안" 탭에서 생성된 초안 본문을 확인 → 승인 / 편집 후 승인 / 반려 / 추가 확인 요청 액션 모두 수행 가능
- `/approval` Playwright 탭 제거
- 검토 UI 코드 중복 방지: 공유 컴포넌트로 추출
- 사이드바 필터/카운트가 approval 상태와 정합

## 비목표

- 신규 액션/워크플로 추가 (재생성 버튼 등) 없음
- WYSIWYG 마크다운 에디터 도입 없음 (기존 textarea 유지)
- Feedback / Jira SR 검토 흐름 변경 없음

## 데이터 모델 컨텍스트

기존 1:1:1 체인:

```
ManualGenerationJob (1) ─ manual_job_id ─> ProposedDocumentChange (1) ─ proposed_change_id ─> ApprovalRequest (1)
                          source_type="playwright"                       status=pending|needs_review|approved|rejected
```

`manual_service.run_generation` 완료 시 위 3개가 자동 생성된다 (`backend/app/services/manual_service.py:58-83`).

## 결정 사항 요약

| 결정 | 선택 |
|------|------|
| Playwright 탭 위치 | `/approval`에서 제거, ManualGenerator로 단일화 |
| AI 초안 탭 UI 패턴 | 인라인 패널 (Approvals 카드와 동일 4액션) |
| 검토 UI 노출 | 항목 선택 시 자동 펼침 (별도 "검토" 버튼 X) |
| 액션 버튼 | 승인 / 편집 후 승인 / 반려 / 추가 확인 요청 4개 (Approvals와 동일) |
| 승인 후 표시 | 생성된 문서 본문 인라인 + 문서 관리 링크 |
| 코드 구조 | `ApprovalReviewPanel` 공유 컴포넌트 추출 (양쪽이 사용) |
| 백엔드 fetch 전략 | `ManualJobResponse`에 `proposed_change`/`approval` 임베드 (신규 endpoint 없음) |

## 아키텍처 개요

```
ManualJob (1) ─── manual_job_id ───> ProposedDocumentChange (1) ─── proposed_change_id ───> ApprovalRequest (1)
                  source_type=playwright                              status=pending|needs_review|approved|rejected
```

변경 포인트:

- **백엔드**: `ManualJobResponse`에 `proposed_change`/`approval` 임베드 → 프론트가 1회 fetch로 검토 가능
- **프론트 공유 컴포넌트**: `components/ApprovalReviewPanel.tsx` 신규. **카드 본문 + 4액션만** 추출 (헤더/카드 래퍼 제외). Approvals + ManualGenerator 양쪽이 사용
- **ManualGenerator AI 초안 탭**: 패널 임베드, job 상태에 따라 5분기 (생성중/실패/검토대기/승인완료/반려)
- **Approvals**: Playwright 탭과 관련 분기 제거, 나머지 tabs (feedback/jira_sr)는 동일 패널 사용

## §1 백엔드 변경

### 스키마 (`backend/app/schemas/manual.py`)

```python
class ProposedChangeBrief(BaseModel):
    id: uuid.UUID
    proposed_text: str
    reasoning: str
    confidence: float
    source_type: str
    status: str
    model_config = {"from_attributes": True}


class ApprovalBrief(BaseModel):
    id: uuid.UUID
    status: str            # pending | needs_review | approved | rejected
    approval_type: str
    comment: str | None
    reviewer_id: uuid.UUID | None
    reviewed_at: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class ManualJobResponse(BaseModel):
    # ... 기존 필드 ...
    proposed_change: ProposedChangeBrief | None = None
    approval: ApprovalBrief | None = None
    model_config = {"from_attributes": True}
```

### 모델 관계 (`backend/app/models/manual.py`, `backend/app/models/feedback.py`)

- `ManualGenerationJob.proposed_change`: `relationship("ProposedDocumentChange", back_populates="manual_job", uselist=False)` — `manual_job_id` 기준
- `ProposedDocumentChange.manual_job`: `relationship("ManualGenerationJob", back_populates="proposed_change")`
- `ProposedDocumentChange.approval`: `relationship("ApprovalRequest", back_populates="proposed_change", uselist=False, order_by="ApprovalRequest.created_at.desc()")`
- `ApprovalRequest.proposed_change`: 기존 관계 유지 (필요 시 `back_populates="approval"` 추가)

이론적으로 1:N 가능하나 매뉴얼 케이스에서는 1:1로 운용. `order_by`로 다중 생성 시 가장 최근만 노출.

### 서비스 (`backend/app/services/manual_service.py`)

`list_jobs` / `get_job` 모두에 다음 옵션 추가:

```python
stmt = (
    select(ManualGenerationJob)
    .options(
        selectinload(ManualGenerationJob.proposed_change)
        .selectinload(ProposedDocumentChange.approval),
    )
    .order_by(ManualGenerationJob.created_at.desc())
)
```

`selectinload`로 N+1 회피.

### 라우터 (`backend/app/routers/manual.py`)

`response_model=ManualJobResponse`가 자동으로 새 필드 직렬화. 신규 endpoint 없음.

## §2 프론트 공유 컴포넌트 추출

### 신규 파일: `frontend/src/components/ApprovalReviewPanel.tsx`

추출 범위 = 현재 `Approvals.tsx`의 `ApprovalCard` 내부 `{isReviewing && ...}` 블록 전체 (메타 정보 + Diff/마크다운 뷰 + 4액션 + 액션 선택 후 textarea + 제출).

**제외**: 카드 헤더(타이틀/상태배지/생성일)와 "검토" 토글 버튼. 페이지 컨텍스트이므로 호출자에 위임.

**Props**:

```ts
// 패널이 실제로 읽는 최소 필드. 호출자(ApprovalCard, ManualGenerator)는 각자 보유한 shape에서 필요한 부분만 묶어서 전달
interface ApprovalReviewPanelInput {
  id: string
  status: string
  approval_type: string
  comment: string | null
  proposed_change: ProposedChange | ProposedChangeBrief | null
}

interface ApprovalReviewPanelProps {
  approval: ApprovalReviewPanelInput
  reviewerId: string
  variant: "feedback" | "playwright" | "jira_sr"
  onReviewed: () => void                  // 액션 성공 후 호출 (refetch)
  showReasoning?: boolean                 // 기본 true
}
```

이렇게 좁히면 `ApprovalBrief`/`ApprovalRequest` 어느 쪽에서 만들든 캐스팅 없이 통과한다.

**내부 state** (현재 Approvals page-level에서 가져옴):

```ts
const [reviewMode, setReviewMode] = useState<ReviewMode>(null)
const [comment, setComment] = useState("")
const [editedContent, setEditedContent] = useState(approval.proposed_change?.proposed_text ?? "")
const [submitting, setSubmitting] = useState(false)
```

**분기**:

- `variant === "feedback"` + `original_text` 존재 → 좌우 diff 뷰
- 그 외 → 단일 마크다운 뷰 (`ReactMarkdown + remarkGfm`)
- `variant === "feedback"` → AI 신뢰도 박스 표시, 그 외 숨김

**제출 핸들러**: 현재 `Approvals.handleSubmit` 로직 이동. 성공 시 `onReviewed()` 호출.

**마운트 키**: 호출자는 `<ApprovalReviewPanel key={approval.id} ... />`로 마운트 — 외부 refetch가 다른 approval로 바뀌면 내부 state 격리.

### Approvals.tsx 적용

- `ApprovalCard` 내부의 검토 블록을 `<ApprovalReviewPanel variant={tab} ... />`로 교체
- page-level state 중 `reviewMode`/`comment`/`editedContent`/`submitting` 제거
- `reviewingId`만 카드 펼침 토글용으로 유지 ("검토" 버튼 토글)
- `openReview` / `closeReview` / `handleSubmit` 제거 (패널이 자체 처리)
- `onReviewed` = `refetch()` 그대로

## §3 ManualGenerator AI 초안 탭 통합

### 5분기 매트릭스 (`ManualGenerator.tsx` ManualDetail의 `activeSection === "draft"`)

| job.status | approval.status | output_document_id | 화면 |
|------------|-----------------|--------------------|------|
| `pending` / `running` | — | — | 생성 중 안내 + 스피너 |
| `failed` | — | — | `error_message` 박스 |
| `completed` | `pending` / `needs_review` | null | `<ApprovalReviewPanel variant="playwright" />` 자동 펼침 |
| `completed` | `approved` | uuid | 승인 완료 배지 + 마크다운 본문 인라인 (`change.proposed_text`) + "문서 관리에서 열기" 링크 |
| `completed` | `rejected` | null | 반려 배지 + `approval.comment` 표시 + 본문 read-only 마크다운 |

### 렌더링 골격

```tsx
{activeSection === "draft" && (() => {
  if (job.status === "pending" || job.status === "running") {
    return <DraftRunning />
  }
  if (job.status === "failed") {
    return <DraftFailed message={job.error_message} />
  }
  const a = job.approval
  const c = job.proposed_change
  if (!a || !c) {
    return <p className="text-sm text-[#9a9bad]">AI 초안 데이터가 없습니다.</p>
  }
  if (a.status === "pending" || a.status === "needs_review") {
    return (
      <ApprovalReviewPanel
        key={a.id}
        approval={{ id: a.id, status: a.status, approval_type: a.approval_type, comment: a.comment, proposed_change: c }}
        reviewerId={user?.id ?? "00000000-0000-0000-0000-000000000001"}
        variant="playwright"
        onReviewed={onRefetch}
      />
    )
  }
  if (a.status === "approved") {
    return <DraftApproved change={c} documentId={job.output_document_id} />
  }
  if (a.status === "rejected") {
    return <DraftRejected change={c} comment={a.comment} />
  }
  return null
})()}
```

`DraftRunning` / `DraftFailed` / `DraftApproved` / `DraftRejected` 4개 보조 컴포넌트는 동일 파일 내 작은 함수 컴포넌트로 정의 (스코프 좁음, 별도 파일 X).

### onRefetch 전달

현재 `ManualDetail`의 `onRefetch` prop은 정의만 되어 있고 호출되지 않는다. AI 초안 탭에서 패널 액션 후 `onRefetch()` 호출 → 좌측 리스트와 우측 디테일 모두 갱신.

## §4 사이드바 필터 + 카운트 정확화

### 현재 로직의 문제 (`ManualGenerator.tsx:45-53`)

```ts
"검토요청": completed && !output_document_id  // rejected도 포함
"완료":     completed && output_document_id   // rejected 누락
```

### 개선

```ts
const isPendingReview = (j: ManualJob) =>
  j.approval?.status === "pending" || j.approval?.status === "needs_review"

const isClosed = (j: ManualJob) =>
  j.approval?.status === "approved" || j.approval?.status === "rejected"
```

탭 필터:

| 탭 | 조건 |
|----|------|
| 전체 | all jobs |
| 검토요청 | `isPendingReview(j)` |
| 완료 | `isClosed(j)` |

`reviewCount = allJobs.filter(isPendingReview).length`.

### 상태 배지

좌측 리스트 + 우측 상단의 배지가 approval 상태를 반영하도록 변경:

```ts
function jobBadgeLabel(j: ManualJob): { label: string; cls: string } {
  if (j.status === "running" || j.status === "pending") return { label: "생성 중", cls: "bg-[#d5e3fc] text-[#00288e]" }
  if (j.status === "failed") return { label: "실패", cls: "bg-[#ffdad6] text-[#ba1a1a]" }
  const a = j.approval?.status
  if (a === "pending") return { label: "검토 대기", cls: "bg-[#fff3dc] text-[#92600a]" }
  if (a === "needs_review") return { label: "추가 확인", cls: "bg-[#e8f0fe] text-[#1a56db]" }
  if (a === "approved") return { label: "승인 완료", cls: "bg-[#dcfce7] text-[#15803d]" }
  if (a === "rejected") return { label: "반려", cls: "bg-[#fce4ec] text-[#c62828]" }
  return { label: STATUS_LABEL[j.status] ?? j.status, cls: STATUS_BADGE[j.status] ?? "" }
}
```

기존 `STATUS_BADGE` / `STATUS_LABEL` 맵은 폴백용으로 축소.

## §5 Approvals Playwright 탭 제거

### `frontend/src/pages/Approvals.tsx`

```ts
type Tab = "feedback" | "jira_sr"   // playwright 제거
```

**제거 대상**:

- `playwrightProcessingCount` 계산 (33행)
- `playwrightApprovals` 필터 (48행)
- `currentList` 삼항 분기 중 playwright 분기 (66-68 → 두 갈래로 축소)
- 탭 버튼 JSX (140-155행, "Playwright 매뉴얼" 버튼 블록 전체)
- `ApprovalCard` 내부 `playwrightTitle` 계산 (331-337)
- 카드 헤더 아이콘 분기 `tab === "feedback" ? "rate_review" : "smart_toy"` → feedback이면 `rate_review`, jira_sr이면 `task`로
- 카드 타이틀 삼항에서 playwright 분기 제거
- diff 뷰의 `tab === "feedback"` 외 분기는 마크다운 뷰로 유지 (jira_sr 케이스에 그대로 쓰임)

**유의**: 백엔드는 playwright source_type ProposedChange/Approval을 계속 생성한다 (manual_service에서). Approvals 페이지에서 노출되지 않을 뿐 — 의도된 동작이다. 데이터는 ManualGenerator를 통해 조회·처리된다.

## §6 API 클라이언트 타입

### `frontend/src/lib/api.ts`

```ts
export interface ProposedChangeBrief {
  id: string
  proposed_text: string
  reasoning: string
  confidence: number
  source_type: "feedback" | "playwright" | "jira_sr"
  status: string
}

export interface ApprovalBrief {
  id: string
  status: string
  approval_type: string
  comment: string | null
  reviewer_id: string | null
  reviewed_at: string | null
  created_at: string
}

export interface ManualJob {
  // ... 기존 필드 ...
  proposed_change: ProposedChangeBrief | null
  approval: ApprovalBrief | null
}
```

신규 API 메서드 X. 기존 `listManualJobs` / `getManualJob`이 확장된 응답을 자동 수신.

## §7 엣지 케이스 + 에러

| 케이스 | 처리 |
|--------|------|
| job 생성 중 새로고침 → approval/change 아직 없음 | `!approval \|\| !change` 가드 → 안내 메시지 |
| 다른 사용자가 이미 처리한 approval (status 이미 종결) | API 400/409 → 패널 내 에러 토스트 + `onReviewed()` 호출해 새 상태 반영 |
| `edit_and_approve` 빈 내용 | 제출 버튼 disabled (기존 로직 유지) |
| `request_review` 빈 코멘트 | 제출 버튼 disabled |
| 백엔드 임베드 N+1 우려 | `selectinload`로 회피 |
| ManualJob 생성 실패 후 부분 데이터 | `proposed_change` null이면 검토 UI 숨김, error_message 우선 표시 |
| 외부 refetch가 패널 state 리셋 위험 | `<ApprovalReviewPanel key={approval.id} />`로 마운트 격리 |
| approval 없이 `completed`인 레거시 job | 안내 메시지만, 리스트 분류는 "전체"에만 |

## §8 테스트

### 백엔드 (`backend/tests/`)

- `test_manual_jobs_response_embeds_approval`: completed + pending approval → 응답에 `proposed_change`/`approval` 포함 확인
- `test_manual_jobs_response_no_approval`: running 상태 job → 두 필드 null
- `test_list_manual_jobs_no_n_plus_one`: 다수 job 조회 시 쿼리 횟수가 N+1이 아님 (선택, 회귀 방지용)
- 기존 `test_review_approval_playwright` 회귀 검증

### 프론트엔드 (수동 검증)

- 새 매뉴얼 요청 → 사이드바 "검토요청" 카운트 ↑
- AI 초안 탭 자동 펼침 → 4액션 노출
- 승인 → 사이드바에서 "완료" 탭으로 이동, AI 초안 탭에 본문 인라인 + 문서 링크
- 반려 → "완료" 탭, 반려 배지 + 코멘트 표시
- 편집 후 승인 → 편집한 내용으로 문서 생성됨 (`DocumentVersion.content` 확인)
- /approval 페이지 → playwright 탭 없음, feedback/jira_sr 탭만 표시

## 마이그레이션 영향

- DB 스키마 변경 없음 (관계만 추가, alembic 마이그레이션 불필요)
- 기존 ManualJob 레코드는 새 응답 포맷에서 `proposed_change`/`approval` null 가능 → 프론트 가드로 처리
- /approval Playwright 탭 사라짐 → 기존 진행 중이던 playwright 검토 건은 매뉴얼 생성 페이지로 자동 이동 (동일 데이터)

## 구현 순서 (writing-plans에 위임)

대략적인 순서. 상세는 plan 단계에서 확정:

1. 백엔드 모델 관계 + 스키마 + 서비스 쿼리 변경
2. 백엔드 테스트
3. 프론트 `ApprovalReviewPanel` 컴포넌트 추출
4. `Approvals.tsx` 패널 사용으로 리팩터, playwright 탭 제거
5. `lib/api.ts` 타입 확장
6. `ManualGenerator.tsx` AI 초안 탭 5분기 구현
7. 사이드바 필터/카운트/배지 정확화
8. 수동 검증
