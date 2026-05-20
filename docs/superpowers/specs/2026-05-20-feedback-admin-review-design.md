# 오류 제보 관리자 검토 & 삭제 기능 설계

**날짜:** 2026-05-20  
**범위:** 오류 제보(/feedback) 페이지

## 목표

1. 관리자가 피드백 항목을 삭제할 수 있도록 UI 제공
2. 피드백 접수 시 AI 초안 자동 생성을 제거하고, 관리자가 원본을 검토·수정한 뒤 직접 AI에 초안 요청하는 흐름으로 변경
3. `document_id` 없는 피드백에서 관리자가 관련 문서를 검색·연결할 수 있도록 UI 제공

## 현재 흐름 vs 변경 후 흐름

**현재**
```
사용자 제보 → create_feedback → generate_correction(자동) → ApprovalRequest 생성
```

**변경 후**
```
사용자 제보 → create_feedback(저장만) → 관리자 검토·수정 → request-draft → generate_correction → ApprovalRequest 생성
```

---

## 섹션 1: 데이터 모델 & API

### DB 변경

`feedback_reports` 테이블에 컬럼 추가:

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `reviewed_text` | TEXT \| NULL | 관리자가 수정한 피드백 텍스트. NULL이면 미검토 |

### 백엔드 변경

**1. `POST /api/feedback` 수정**
- `generate_correction()` 자동 호출 제거
- 피드백 저장 + 알림 전송만 수행

**2. `POST /api/feedback/{id}/request-draft` 신규**
- Request body: `{ reviewed_text: string }`
- `FeedbackReport.reviewed_text` 저장
- `generate_correction()`을 `reviewed_text` 기반으로 호출
- `ApprovalRequest` 생성 후 결과 반환
- Response: `FeedbackWithProposalResponse`

**3. `generate_correction` 수정**
- AI 프롬프트에서 `feedback_text` 대신 `reviewed_text`(있으면) 우선 사용

**4. `PATCH /api/feedback/{id}/link-document` 신규**
- Request body: `{ document_id: UUID }`
- `FeedbackReport.document_id` 업데이트
- 이미 `document_id`가 있거나 초안이 존재하면 400 반환
- Response: `FeedbackReportResponse`

**5. `DELETE /api/feedback/{id}`**
- 이미 존재, 변경 없음
- 연결된 `ProposedDocumentChange`, `ApprovalRequest` cascade 삭제 (기존 동작 유지)

### 스키마 변경

`FeedbackReportResponse`에 `reviewed_text: str | None` 필드 추가.

`RequestDraftBody` 스키마 신규:
```python
class RequestDraftBody(BaseModel):
    reviewed_text: str
```

`LinkDocumentBody` 스키마 신규:
```python
class LinkDocumentBody(BaseModel):
    document_id: uuid.UUID
```

---

## 섹션 2: 프론트엔드 UX

### 삭제 버튼

- `FeedbackDetail` 헤더 우측에 "삭제" 버튼 추가
- 클릭 → confirm 다이얼로그 → `DELETE /api/feedback/{id}` → 목록 refetch + 상세 패널 초기화

### "요청 정보" 탭 하단 — 문서 연결 UI (`document_id` 없을 때)

```
┌─────────────────────────────────────────────────┐
│ 관련 문서                                         │
│ 연결된 문서가 없습니다.                             │
│ ┌─────────────────────────────────────────────┐  │
│ │ 문서 검색...                🔍               │  │
│ └─────────────────────────────────────────────┘  │
│ [검색 결과 드롭다운 — 문서 제목 목록]               │
│                              [문서 연결]           │
└─────────────────────────────────────────────────┘
```

- `GET /api/documents?q=<검색어>` 로 실시간 검색 (debounce 300ms)
- 문서 선택 후 "문서 연결" 클릭 → `PATCH /api/feedback/{id}/link-document` 호출
- 연결 성공 시 `item` 상태 업데이트 → 하단 관리자 편집 영역 노출

### "요청 정보" 탭 하단 — 관리자 편집 영역

`document_id`가 있는 피드백에만 노출 (문서 연결 후 포함):

```
┌─────────────────────────────────────────────────┐
│ 제보 내용 (읽기 전용)                              │
│ [원본 feedback_text]                              │
│                                                  │
│ 관리자 검토 내용                                   │
│ ┌─────────────────────────────────────────────┐  │
│ │ textarea — 초기값: reviewed_text 또는        │  │
│ │            feedback_text(원본 복제)          │  │
│ └─────────────────────────────────────────────┘  │
│                          [AI 초안 요청 →]         │
└─────────────────────────────────────────────────┘
```

**상태별 동작:**
- 초안 없음: textarea 편집 가능, "AI 초안 요청" 버튼 활성
- 초안 있음: textarea 비활성화, "초안이 생성되었습니다" 안내 + "AI 수정 초안" 탭으로 이동 링크
- "AI 초안 요청" 클릭 → 로딩 → 완료 시 "AI 수정 초안" 탭으로 자동 전환

### "변경 이력" 탭

기존 `ChangeHistoryTimeline`에 원본 텍스트(`feedback_text`)와 관리자 수정본(`reviewed_text`) 비교 항목 표시.

---

## 섹션 3: 상태 흐름 & 엣지 케이스

### 피드백 상태 흐름

```
접수(pending) → [관리자 편집 + AI 요청] → 초안 생성됨 → [승인 처리] → 완료(processed)
```

### 엣지 케이스

| 케이스 | 처리 |
|---|---|
| `document_id` 없는 피드백 | 문서 연결 UI 표시. 연결 전까지 관리자 편집 영역 비노출 |
| 문서 연결 후 | 관리자 편집 영역 노출, AI 초안 요청 가능 상태로 전환 |
| 이미 `document_id` 있는 피드백에 link-document 요청 | 백엔드 400 반환 |
| 이미 초안 있는 상태에서 재요청 | "AI 초안 요청" 버튼 비활성화 (덮어쓰기 방지) |
| 삭제 시 연결 데이터 | cascade 삭제 — 백엔드에서 기존 처리 중 |

---

## 변경 파일 요약

**백엔드**
- `backend/app/routers/feedback.py` — create 자동호출 제거, request-draft 엔드포인트 추가
- `backend/app/services/feedback_service.py` — generate_correction reviewed_text 우선 사용
- `backend/app/schemas/feedback.py` — reviewed_text 필드, RequestDraftBody 추가
- `backend/app/models/feedback.py` — reviewed_text 컬럼 추가
- `backend/alembic/versions/` — 마이그레이션 파일 신규

**프론트엔드**
- `frontend/src/pages/Feedback.tsx` — 삭제 버튼, 문서 연결 UI, 관리자 편집 영역
- `frontend/src/lib/api.ts` — deleteFeedback, requestDraft, linkDocument API 함수 추가
