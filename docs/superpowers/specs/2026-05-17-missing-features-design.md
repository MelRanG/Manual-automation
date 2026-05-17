# DocOps AI 누락 기능 설계

## 개요

스펙(`docops_ai_llm_service_prompt.md`) 대비 누락된 기능을 구현한다.
페르소나: 도메인/개발 지식 없는 현업 + 매뉴얼 작성이 귀찮은 PM

---

## 1. 챗봇 → 오류 제보 연결

### 요구사항
- AI 답변 버블에 "실제와 달라요" 버튼 추가
- 클릭 시 해당 답변의 citation(출처 문서, chunk)과 연결된 오류 제보 폼이 인라인으로 열림
- 제출하면 FeedbackReport가 chat_message_id, document_id, chunk_id와 함께 생성됨
- AI 수정안이 자동 생성되고 결과를 채팅 내에 표시

### 구현
- `Chat.tsx`: 각 assistant 메시지 아래에 "실제와 달라요" 버튼
- 클릭 시 텍스트 입력 + Submit UI 노출
- `POST /api/feedback` 호출 시 `chat_message_id` 포함
- 응답의 `proposed_change` 존재 시 "수정안이 생성되었습니다" 알림

---

## 2. 승인 4개 옵션

### 요구사항
스펙 3.5:
- 승인 (approve)
- 반려 (reject)
- 직접 수정 후 승인 (edit_and_approve)
- 추가 확인 요청 (request_review)

### 구현

**백엔드:**
- `POST /api/approvals/{id}/review` action 필드 확장: `approve`, `reject`, `edit_and_approve`, `request_review`
- `edit_and_approve`: `edited_content` 필드 필수 → 해당 내용으로 새 DocumentVersion 생성
- `request_review`: status를 `needs_review`로 변경, comment 필수

**프론트엔드 (Approvals.tsx):**
- Review 클릭 시 모달/패널에 4개 버튼 표시
- "직접 수정 후 승인" 선택 시 텍스트 에디터 노출
- "추가 확인 요청" 선택 시 코멘트 입력 필수

---

## 3. 관리자 대시보드 확장

### 요구사항
스펙 3.6 — 다음 섹션을 대시보드에 표시:
- 신뢰도 낮은 문서 (이미 있음)
- 오류 제보 많은 문서
- 승인 대기 문서
- 많이 조회된 문서
- 오래된 문서
- 담당자 없는 문서

### 구현

**백엔드:**
- `GET /api/documents/stats/dashboard` — 각 카테고리별 문서 목록 반환
- Document 모델에 `view_count: int = 0` 필드 추가
- 문서 상세 조회 시 view_count 증가

**프론트엔드 (Dashboard.tsx):**
- 기존 "Recent Documents" + "Low Trust Documents" 유지
- 추가 섹션: 탭 또는 그리드로 배치
- 각 섹션은 문서 5개까지, "더보기" 링크

---

## 4. 문서 상태 & 중요도

### 요구사항
- 문서 상태: `active`, `stale`, `needs_review`, `archived`
- 문서 중요도(priority): `critical`, `high`, `medium`, `low`

### 구현

**백엔드:**
- Document 모델: `priority` 필드 추가 (String, default "medium")
- Trust score 계산 시 상태를 자동 판별:
  - 90일 이상 업데이트 없음 → `stale`
  - 미처리 피드백 2건 이상 → `needs_review`
  - 그 외 → `active`
- API: 문서 생성/수정 시 priority 설정 가능

**프론트엔드:**
- 문서 목록에 중요도 뱃지 표시 (critical=빨강, high=주황, medium=파랑, low=회색)
- 문서 상세에서 중요도 변경 드롭다운
- 문서 상태는 자동 계산이므로 뱃지로만 표시

---

## 5. 신뢰도 낮은 문서 참조 시 경고

### 요구사항
스펙 3.2: 오래되었거나 신뢰도 낮은 문서를 참조하면 경고를 표시한다.

### 구현

**백엔드:**
- `POST /api/chat/messages` 응답에 `warnings` 배열 추가
- citation 문서의 trust_score < 0.6 또는 status = "stale" → 경고 생성
- 경고 형식: `{"document_id": "...", "title": "...", "reason": "trust_score_low" | "stale"}`

**프론트엔드:**
- 답변 아래 citations 영역에 경고 배너 표시
- "이 답변은 신뢰도가 낮은 문서를 참조합니다" + 해당 문서명

---

## 6. 사용자 매뉴얼 자동 생성

### 요구사항
- PM이 완료된 SR을 선택하고 "매뉴얼 생성" 클릭
- 외부 URL + (선택) 로그인 정보(ID/PW) 입력
- 사용자가 시나리오 단계를 입력 (필수 아님 — 빈 칸이면 AI가 SR 내용 기반으로 추천)
- Playwright가 해당 URL 접속 → 로그인(필요 시) → 페이지 캡처
- 각 단계별 스크린샷 + 설명 생성
- 마크다운 문서로 출력 → DocOps 문서로 등록

### 핵심 원칙
- **강제 아님**: SR 완료 = 매뉴얼 생성이 아님. PM이 판단해서 트리거
- **시나리오 없이도 가능**: SR 설명 기반으로 AI가 단계 추천

### 구현

**DB 모델: ManualGenerationJob**
```
id: UUID
source_sr_id: UUID (nullable)
user_id: UUID
target_url: str
login_id: str (nullable, encrypted)
login_pw: str (nullable, encrypted)
login_url: str (nullable)
scenario_steps: JSON (nullable)
status: str (pending/running/completed/failed)
output_document_id: UUID (nullable)
screenshots: JSON (nullable - [{step, filename, description}])
created_at
completed_at
```

**백엔드:**
- `POST /api/manuals/generate` — job 생성 + 비동기 실행
- `GET /api/manuals/jobs` — 목록
- `GET /api/manuals/jobs/{id}` — 상태/결과
- Worker: Playwright headless 실행 → 스크린샷 저장 → LLM으로 설명 생성 → 마크다운 조합 → Document 생성

**프론트엔드:**
- SR 상세에 "매뉴얼 생성" 버튼 (status=submitted인 SR에만)
- 매뉴얼 생성 폼: URL, 로그인 정보(선택), 시나리오 단계(선택)
- 생성 중 상태 표시, 완료 후 문서 링크 제공
- 사이드바에 "Manual Generator" 메뉴 추가

**시연용 데모:**
- 기본 URL: 아시아나항공 홈페이지 또는 한진정보통신 홈페이지
- 로그인 없는 공개 페이지로 시연

---

## 7. Webhook 전송 로그 화면

### 요구사항
스펙 추천 화면 7번: Webhook 전송 로그

### 구현
- `GET /api/sr/webhook-logs` — 전체 로그 목록
- 프론트엔드: SR 페이지 내 "Webhook Logs" 탭 또는 별도 페이지
- 각 로그: 대상 URL, payload 요약, 응답 status, 전송 시각, 결과(delivered/failed/skipped)
- 실패한 건 재전송 버튼

---

## 8. 추가 개선 (스펙 준수)

### 8.1 답변 출처에 문서 chunk 정보 표시
- 현재 citation에 document_id만 표시 → chunk 내용(quote) 노출

### 8.2 문서 근거 부족 시 "문서에서 확인되지 않음" 응답
- RAG 검색 결과 유사도 < threshold 시 LLM에게 "근거 부족" 지시
- 프론트에서 해당 응답에 별도 스타일 적용

---

## 구현 순서

1. DB 마이그레이션 (view_count, priority, ManualGenerationJob)
2. 백엔드 API 확장
3. 챗봇 오류 제보 연결
4. 승인 4개 옵션
5. 대시보드 확장
6. 문서 상태/중요도
7. 신뢰도 경고
8. 매뉴얼 자동 생성
9. Webhook 로그 화면
10. E2E 테스트 + 브라우저 상호작용 검증
