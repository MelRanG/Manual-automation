# DocOps AI 서비스 스펙 프롬프트

이 문서는 LLM 또는 Claude Code가 DocOps AI 서비스를 이해하고 구현할 때 참조하기 위한 서비스 스펙이다.

## 1. 서비스 정체성

우리는 단순한 사내 문서 RAG 챗봇을 만들지 않는다.

우리가 만들 서비스는 **DocOps AI**다.

DocOps AI는 사내 문서를 기반으로 업무 질문에 답변하고, 답변 오류 제보, AI 수정안 생성, 문서 담당자 승인, 문서 버전 업데이트, SR 생성, SR 완료 후 문서 반영 전략 추천, 사용자 매뉴얼 자동 생성까지 연결하는 **문서 생명주기 자동화 플랫폼**이다.

핵심 차별점은 다음이다.

```text
기존 RAG:
문서 업로드 → 질문 → 답변

DocOps AI:
문서 업로드 → 질문 → 답변 → 오류 제보 → AI 수정안 → 담당자 승인 → 문서 업데이트 → RAG 인덱스 갱신
SR 생성 → SR 완료 → 문서 영향 분석 → 문서 반영 전략 추천 → 담당자 승인 → 문서 업데이트
```

챗봇은 입구일 뿐이고, 제품의 본질은 **문서 최신화와 문서 신뢰도 관리**다.

---

## 2. 개발 원칙

- 단순 RAG 챗봇으로 끝내지 않는다.
- 모든 AI 답변은 출처 문서를 포함해야 한다.
- 문서 근거가 부족하면 추측하지 않는다.
- AI는 문서를 직접 수정하지 않는다.
- 문서 수정은 담당자 승인 후 새 버전으로 저장한다.
- 기존 문서를 덮어쓰지 말고 DocumentVersion을 생성한다.
- 오류 제보, SR 완료, 문서 수정, 승인 이력은 모두 추적 가능해야 한다.
- MVP는 작게 만들되, 문서 최신화 루프는 반드시 포함한다.
- 사용자의 워크플로우는 “질문 → 오류 제보 → 수정 승인 → 문서 업데이트”가 자연스럽게 이어져야 한다.

---

## 3. 핵심 기능 목록

### 3.1 문서함

사용자는 문서를 업로드하고 웹에서 바로 볼 수 있어야 한다.

필수 기능:

- 문서 업로드
- 문서 목록 조회
- 문서 상세 조회
- 문서 버전 이력
- 문서 담당자 지정
- 문서 신뢰도 점수 표시

MVP 지원 포맷:

- txt
- md
- pdf

---

### 3.2 문서 기반 AI 문의

사용자는 챗봇에서 업무 질문을 할 수 있다.

AI는 내부 문서함에서 관련 내용을 찾아 답변한다.

필수 조건:

- 답변에는 출처 문서가 포함되어야 한다.
- 가능하면 문서 버전과 문서 chunk도 함께 연결한다.
- 문서 근거가 부족하면 “문서에서 확인되지 않음”이라고 답한다.
- 오래되었거나 신뢰도 낮은 문서를 참조하면 경고를 표시한다.

---

### 3.3 답변 오류 제보

사용자는 챗봇 답변이 실제와 다를 경우 오류를 제보할 수 있다.

흐름:

1. 사용자가 챗봇 답변을 받는다.
2. “실제와 달라요” 버튼을 누른다.
3. 사용자가 자연어로 오류 내용을 입력한다.
4. 시스템은 오류 제보를 해당 답변, 출처 문서, 문서 chunk와 연결한다.
5. AI는 수정 방향과 수정안을 생성한다.
6. 문서 담당자에게 승인 요청을 보낸다.

---

### 3.4 AI 수정안 생성

오류 제보가 들어오면 AI는 기존 문서 내용과 사용자의 제보를 비교해 수정안을 만든다.

AI 출력:

- 기존 문서 내용
- 수정 제안 내용
- diff
- 변경 이유
- confidence
- 추가 확인 필요 여부

AI는 문서를 직접 수정하지 않는다.  
담당자 승인 후에만 새 문서 버전을 생성한다.

---

### 3.5 문서 담당자 승인 워크플로우

문서 담당자는 AI 수정안을 보고 다음 중 하나를 선택한다.

- 승인
- 반려
- 직접 수정 후 승인
- 추가 확인 요청

승인되면:

1. 새 DocumentVersion 생성
2. Document의 current_version 갱신
3. RAG index 갱신
4. 오류 제보 상태를 resolved로 변경
5. 변경 이력 저장

---

### 3.6 문서 신뢰도 점수

문서별 신뢰도를 계산한다.

예시 기준:

- 오래된 문서 감점
- 오류 제보가 많은 문서 감점
- 승인 대기 수정안이 많은 문서 감점
- 답변 불만족이 많은 문서 감점
- 담당자가 없는 문서 감점
- 최근 검토된 문서 가점
- 오류 제보가 해결된 문서 가점

문서 상태 예시:

- high
- medium
- low
- stale
- needs_review

관리자 대시보드에는 다음을 보여준다.

- 신뢰도 낮은 문서
- 오류 제보 많은 문서
- 승인 대기 문서
- 많이 조회된 문서
- 오래된 문서
- 담당자 없는 문서

---

### 3.7 SR 요청 자동 생성

사용자는 자연어로 SR 요청을 보낼 수 있다.

AI는 내부 문서와 SR 양식을 참고해 SR 초안을 작성한다.

사용자 입력 예시:

```text
정산 조회 화면에 정산상태 필터를 추가해달라고 요청하고 싶어.
```

AI 출력 예시:

```text
제목:
정산 조회 화면 정산상태 필터 추가 요청

요청 배경:
현재 정산 조회 시 정산상태별 필터링이 불가능하여 담당자가 수작업으로 상태를 분류하고 있습니다.

요청 내용:
1. 정산 조회 화면에 정산상태 필터 추가
2. 필터 값: 전체, 정산대기, 정산완료, 오류
3. 엑셀 다운로드 시 필터 조건 반영

기대 효과:
정산 담당자의 수작업 분류 시간을 줄이고 조회 정확도를 높일 수 있습니다.

우선순위:
중간

관련 화면:
정산관리 > 정산조회

확인 필요 사항:
- 기존 검색 성능 영향 여부
- 엑셀 다운로드 결과 반영 여부
```

전송 옵션:

- 검토 후 전송
- 즉시 전송
- 승인 후 전송

---

### 3.8 Jira/Webhook 연동

SR 초안은 외부 시스템으로 전송 가능해야 한다.

MVP에서는 Jira 실제 연동 대신 Webhook mock으로 구현해도 된다.

전송 payload 예시:

```json
{
  "title": "정산 조회 화면 정산상태 필터 추가 요청",
  "description": "...",
  "priority": "medium",
  "requester": "user_id",
  "relatedDocuments": ["doc_123"],
  "createdByAI": true
}
```

---

### 3.9 Change Merge Assistant

SR 또는 업무 변경 요청이 완료되면, AI가 해당 변경사항을 기존 문서에 어떻게 반영해야 하는지 추천한다.

추천 전략:

1. `partial_update`: 기존 문서 일부 수정
2. `overwrite`: 기존 문서 전체 교체
3. `create_new`: 새 문서 생성
4. `hold`: 반영 보류 및 담당자 확인

판단 기준:

- SR 완료 내용과 기존 문서의 유사도
- 변경 범위
- 화면 변경 여부
- 정책 변경 여부
- 기존 문서 최신성
- 사용자용 문서인지 운영자용 문서인지
- SR 완료 내용의 명확성
- 관련 문서 수

출력:

- 관련 문서 후보
- 추천 전략
- 추천 이유
- 변경 영향 범위
- 수정안 diff
- confidence

승인되면 새 DocumentVersion으로 저장하고 RAG index를 갱신한다.

---

### 3.10 사용자 매뉴얼 자동 생성

완료된 SR과 웹 화면을 기반으로 사용자 매뉴얼을 자동 생성한다.

MVP에서는 완전 자동 탐색이 아니라, 사용자가 시나리오를 입력하는 반자동 방식으로 구현한다.

흐름:

1. 완료된 SR 선택
2. 사용자 시나리오 입력
3. Playwright로 화면 이동
4. 주요 화면 캡처
5. 캡처 위치 마킹
6. 단계별 설명 생성
7. Word, PDF, Markdown 중 하나로 출력

시나리오 예시:

```text
1. 로그인한다.
2. 정산관리 메뉴를 클릭한다.
3. 정산조회 화면으로 이동한다.
4. 정산상태 필터를 선택한다.
5. 조회 버튼을 클릭한다.
6. 엑셀 다운로드 버튼을 클릭한다.
```

---

## 4. 추천 MVP 범위

반드시 포함:

1. 문서 업로드
2. 문서 웹 뷰어
3. 문서 chunking
4. 챗봇 질의응답
5. 답변 출처 표시
6. 오류 제보
7. AI 수정안 생성
8. 담당자 승인/반려
9. 문서 버전 업데이트
10. 문서 신뢰도 점수
11. SR 초안 생성
12. Webhook mock 전송
13. Change Merge Assistant 기본형

나중에 추가:

1. Jira 실제 연동
2. Playwright 기반 화면 캡처
3. Word/PDF 매뉴얼 생성
4. 문서 담당자 자동 추천
5. 권한 체계 고도화

---

## 5. 추천 데이터 모델

### User

```text
id
name
email
role
department
created_at
updated_at
```

### Document

```text
id
title
description
owner_id
current_version_id
status
trust_score
created_at
updated_at
last_reviewed_at
```

### DocumentVersion

```text
id
document_id
version_number
content
source_file_url
created_by
change_summary
created_at
```

### DocumentChunk

```text
id
document_version_id
chunk_index
content
embedding
metadata
created_at
```

### ChatSession

```text
id
user_id
title
created_at
updated_at
```

### ChatMessage

```text
id
session_id
role
content
created_at
```

### AnswerCitation

```text
id
chat_message_id
document_id
document_version_id
chunk_id
quote
created_at
```

### FeedbackReport

```text
id
user_id
chat_message_id
document_id
chunk_id
feedback_text
status
created_at
updated_at
```

### ProposedDocumentChange

```text
id
feedback_report_id
document_id
document_version_id
original_text
proposed_text
diff
reasoning
confidence
status
created_at
updated_at
```

### ApprovalRequest

```text
id
target_type
target_id
reviewer_id
status
comment
created_at
reviewed_at
```

### SRDraft

```text
id
user_id
title
description
priority
related_document_ids
status
created_by_ai
created_at
updated_at
```

### WebhookDeliveryLog

```text
id
sr_draft_id
target_url
payload
response_status
response_body
status
created_at
```

### ChangeImpactAnalysis

```text
id
source_type
source_id
related_document_ids
recommended_strategy
reasoning
confidence
status
created_at
updated_at
```

### DocumentChangeProposal

```text
id
impact_analysis_id
document_id
original_content
proposed_content
diff
status
reviewer_id
reviewed_at
created_at
```

### ManualGenerationJob

```text
id
source_sr_id
user_id
scenario_steps
status
output_file_url
created_at
completed_at
```

---

## 6. 추천 화면

1. 문서함
2. 문서 상세/버전 이력
3. AI 문의 챗봇
4. 오류 제보함
5. 수정 검토함
6. SR 생성
7. Webhook 전송 로그
8. 변경 반영 검토
9. 관리자 대시보드
10. 매뉴얼 생성

---

## 7. 개발 순서

1. 프로젝트 기본 구조 생성
2. 문서 업로드/저장 구현
3. 문서 chunking 구현
4. 문서 검색 구현
5. 챗봇 답변 생성 구현
6. 답변 출처 표시 구현
7. 오류 제보 구현
8. AI 수정안 생성 구현
9. 승인/반려 구현
10. 문서 버전 업데이트 구현
11. 문서 신뢰도 점수 구현
12. SR 초안 생성 구현
13. Webhook mock 전송 구현
14. Change Merge Assistant 구현
15. 관리자 대시보드 구현
16. 매뉴얼 생성 기능 구현

---

## 8. LLM 응답 규칙

서비스 내 AI는 다음 원칙을 지켜야 한다.

- 문서 근거 없는 답변을 하지 않는다.
- 출처를 항상 표시한다.
- 문서와 사용자 제보가 충돌하면 충돌을 명시한다.
- confidence가 낮으면 담당자 확인을 요청한다.
- 문서 수정은 제안만 하고 직접 반영하지 않는다.
- SR 초안 생성 시 불명확한 항목은 “확인 필요”로 표시한다.
- Change Merge Assistant는 덮어쓰기보다 부분 수정 또는 보류를 우선 검토한다.
- 민감하거나 확정할 수 없는 내용은 담당자 검토 대상으로 보낸다.

---

## 9. 핵심 포지셔닝 문장

```text
DocOps AI는 사내 문서에 답변하는 챗봇이 아니다.
문서 오류 제보와 SR 완료 변경사항을 문서 업데이트로 되돌려 보내는 문서 생명주기 자동화 플랫폼이다.
```

```text
기존 RAG의 문제는 원본 문서가 틀리면 답변도 틀린다는 점이다.
DocOps AI는 사용자의 오류 제보와 업무 변경사항을 AI 수정안과 담당자 승인 흐름으로 연결해 문서를 계속 최신 상태로 유지한다.
```
