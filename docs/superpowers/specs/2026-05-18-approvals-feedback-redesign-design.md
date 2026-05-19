# Approvals & Feedback 페이지 개선 설계

**날짜:** 2026-05-18  
**상태:** 승인됨

## 목표

- Feedback 페이지에서 AI 수정안 내용이 보이지 않는 문제 해결
- Approvals 페이지에서 실제 데이터 없이 하드코딩된 정보 표시 문제 해결
- Playwright 매뉴얼을 승인 흐름으로 통합 (생성 즉시 저장 → 승인 후 저장)
- 두 종류의 수정안을 Approvals 한 페이지에서 통합 검토

## 아키텍처

```
Feedback 페이지  → 제보 작성 + 제보 목록 (현황 조회만)
Approvals 페이지 → 모든 수정안 검토/승인/반려 (탭 2개)
  ├── 탭 1: 오류 제보 수정안   (source_type="feedback")
  └── 탭 2: Playwright 매뉴얼  (source_type="playwright")
```

## 데이터 흐름

### 오류 제보 수정안 (기존 흐름 유지, UI 개선)

1. 사용자 제보 → `FeedbackReport` 생성
2. AI가 `ProposedDocumentChange` 생성 (`source_type="feedback"`)
3. `ApprovalRequest` 자동 생성
4. Approvals 탭1에 표시
5. 승인 시 문서 새 버전으로 저장

### Playwright 매뉴얼 (흐름 변경)

**기존:** 생성 완료 → 즉시 `Document` 저장  
**변경:** 생성 완료 → `ProposedDocumentChange` 생성 (`source_type="playwright"`, `original_text=""`, `proposed_text`=생성 내용) → `ApprovalRequest` 생성 → 승인 시 `Document` 신규 생성

## 백엔드 변경

### DB 마이그레이션

- `proposed_document_changes` 테이블에 `source_type VARCHAR(50)` 컬럼 추가
  - 허용값: `"feedback"`, `"playwright"`
  - 기존 데이터 기본값: `"feedback"`

### API 변경

**`GET /api/approvals`**
- 응답에 `ProposedDocumentChange` 전체 데이터 포함 (현재는 `proposed_change_id`만 반환)
- `status` 쿼리 파라미터 추가: `pending`(기본), `needs_review`, `all`

**`ApprovalRequestResponse` 스키마 확장**
```python
class ApprovalRequestResponse(BaseModel):
    id: uuid.UUID
    proposed_change_id: uuid.UUID
    proposed_change: ProposedChangeResponse | None  # 추가
    reviewer_id: uuid.UUID | None
    status: str
    comment: str | None
    reviewed_at: str | None
    created_at: datetime
```

### Playwright 서비스 변경

`manual_service.run_generation()` 완료 시:
- 기존: `Document` 즉시 생성
- 변경: `ProposedDocumentChange` + `ApprovalRequest` 생성, `output_document_id` 미설정
- 승인(`approval_service.review_approval()`) 시 `Document` 신규 생성, `ManualJob.output_document_id` 업데이트

### 에러 처리

- Playwright 생성 실패 시: `ProposedChange` 미생성, `error_message` 필드 기록 (기존과 동일)
- 승인 중 DB 오류: 기존 롤백 로직 유지

## 프론트엔드 변경

### Feedback 페이지 (`/feedback`)

- 목록 테이블: 문서 UUID 대신 문서 제목 표시 — `FeedbackReportResponse`에 `document_title: str | None` 필드 추가 필요
- 수정안 생성 여부 배지 추가 (`processed` 상태 시 "수정안 생성됨")
- "수정안 보기" 버튼 → `/approvals` 이동

### Approvals 페이지 (`/approvals`)

**탭 구조**
- `오류 제보 수정안` 탭: `source_type="feedback"` 항목
- `Playwright 매뉴얼` 탭: `source_type="playwright"` 항목

**카드 표시 정보**

| 오류 제보 탭 | Playwright 탭 |
|---|---|
| 제보 내용 (feedback_text) | 생성 URL (target_url) |
| 대상 문서 제목 | 생성 일시 |
| AI 신뢰도 (실제 confidence 값) | 스크린샷 수 |
| 변경 사유 (reasoning) | 생성된 매뉴얼 제목 |

**카드 펼치면 diff 뷰**
- 오류 제보: 좌측 원문 / 우측 제안문 (side-by-side)
- Playwright: 생성된 전체 내용 표시 (원문 없음)

**편집 모드**
- 텍스트에어리어에 `proposed_text` 미리 채워진 채로 수정 가능

**API 타입 변경**
```typescript
export interface ApprovalRequest {
  id: string
  proposed_change_id: string
  proposed_change: ProposedChange | null  // 추가
  reviewer_id: string | null
  status: string
  comment: string | null
  reviewed_at: string | null
  created_at: string
}

export interface ProposedChange {
  // 기존 필드 유지
  source_type: "feedback" | "playwright"  // 추가
}
```

## 테스트 계획

- 백엔드: `source_type` 마이그레이션 검증, Playwright 승인 흐름 pytest 추가
- 프론트엔드: `pnpm lint`, `pnpm typecheck` 통과, 브라우저에서 탭 전환·승인·반려 동작 직접 확인
