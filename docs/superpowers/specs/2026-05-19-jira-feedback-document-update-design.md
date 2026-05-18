# Jira 완료 → 문서 자동 현행화 설계

**날짜:** 2026-05-19
**상태:** 확정
**선행 스펙:** `2026-05-18-jira-bidirectional-design.md`

---

## 개요

기존 Jira 양방향 연동(`2026-05-18-jira-bidirectional-design.md`)에서 Jira 완료 웹훅 수신 시 `SR.related_document_ids`를 직접 읽어 피드백을 생성했다. 그러나 이 필드는 항상 비어 있어 실제로 동작하지 않았다.

이번 스펙은 **Jira 완료 시점에 AI가 SR 내용을 기반으로 관련 문서를 자동 탐색**하고, 선택적으로 Playwright로 대상 URL을 캡처해 수정안을 생성하는 파이프라인을 구현한다.

오류 제보(feedback) 파이프라인은 Jira와 무관하게 유지한다.

---

## 데이터 모델 변경

### SRDraft에 target_url 추가

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `target_url` | `String(1000) \| None` | 위젯이 설치된 사이트 URL. Playwright 캡처 대상 |

`related_document_ids`는 Jira 완료 시점에 AI가 채운다. SR 생성 시 사전 입력 불필요.

### JiraCallbackLog에 error_message 추가

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `error_message` | `Text \| None` | 처리 실패 시 원인 기록 |

WebhookLogs 페이지에서 관리자가 실패 원인 확인 가능.

### BedrockEmbeddingProvider 추가

`embedding_service.py`에 Bedrock 임베딩 provider 추가.

- 모델: `amazon.titan-embed-text-v2:0`
- `settings.embedding_model == "bedrock"` 일 때 선택
- 기존 mock/openai provider 변경 없음

---

## 처리 플로우

### 변경 전 (기존)

```
Jira 완료 웹훅
  → SR.related_document_ids 직접 읽기 (항상 비어있음 → 아무것도 안 됨)
  → 피드백 생성 시도
```

### 변경 후

```
Jira 완료 웹훅
  → JiraCallbackLog DB 기록 → 즉시 200 응답
  → BackgroundTasks: process_jira_done(sr_id, log_id)
      1. SR 제목+설명으로 벡터 검색 → 유사 문서 top-3
         실패 시: 제목 키워드 매칭으로 폴백
      2. 관련 문서 없으면 log.status = "skipped_no_docs" → 종료
      3. SR.target_url 있으면 Playwright로 페이지 캡처
         실패 시: 스킵 (오류 아님)
      4. 각 문서마다:
         [문서 원문 + SR 내용 + 캡처 텍스트(있으면)] → LLM → proposed_text
         ProposedDocumentChange(source_type="jira_sr") 생성
         ApprovalRequest 생성
      5. 관리자에게 알림
      6. SR.related_document_ids 업데이트
      7. log.status = "processed" | "failed"
```

승인 후 문서 버전 업데이트는 기존 `approval_service.review_approval()` → `create_new_version()` 그대로 재사용.

---

## 에러 처리

각 단계 실패는 다음 단계를 막지 않는다.

| 단계 | 실패 시 동작 |
|---|---|
| 벡터 검색 | 제목 키워드 매칭으로 폴백 |
| Playwright 캡처 | 스킵, SR 텍스트만으로 수정안 생성 |
| LLM 수정안 생성 | 해당 문서 스킵, 경고 로그 |
| 전체 프로세스 | log.status = "failed", error_message 기록 |
| 관련 문서 0건 | log.status = "skipped_no_docs", 종료 |

---

## 테스트

기존 pytest + mock LLM 패턴 유지.

```
test_is_done_status_category
test_is_done_custom_status_names_match / no_match
test_mask_token
test_webhook_skipped_no_config
test_process_jira_done_no_related_docs → log.status == "skipped_no_docs"
test_process_jira_done_creates_proposals → ProposedChange + ApprovalRequest 생성 확인
test_process_jira_done_no_playwright_without_target_url → capture_screenshots 미호출 확인
test_get_provider_bedrock → BedrockEmbeddingProvider 반환 확인
```

---

## 미래 확장 (이번 범위 외)

- 위젯 채팅에서 SR 작성 보조: 연결된 앱의 라우터/콘솔로그를 참고해 오류 상황, 기능 개선 방향, 테스트 시나리오 자동 제안
- `target_url` 이미 추가되므로 위 기능 연결 시 추가 모델 변경 불필요
