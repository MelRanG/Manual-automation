# Jira 양방향 연동 설계

**날짜:** 2026-05-18  
**상태:** 확정

---

## 개요

SR 제출 시 Jira REST API로 이슈를 직접 생성하고 이슈 키를 저장한다. Jira에서 이슈가 Done/Resolved 상태로 전환되면 웹훅 콜백을 수신하여 연결된 문서에 피드백 워크플로우(AI 수정안 생성 → 승인 대기)를 자동 트리거한다.

---

## 데이터 모델

### SRDraft 컬럼 추가

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `jira_issue_key` | `String(50) \| None` | Jira 이슈 키 (예: `DOCOPS-42`) |
| `jira_issue_url` | `String(500) \| None` | Jira 이슈 브라우저 URL |

**status 흐름:**
```
draft → submitted → jira_created → done_synced
```
- `jira_created`: Jira 이슈 생성 완료, 이슈 키 저장됨
- `done_synced`: Jira Done 콜백 수신, 피드백 생성 완료

### JiraConfig 테이블 (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID PK | |
| `base_url` | String(500) | `https://yourcompany.atlassian.net` |
| `user_email` | String(255) | Jira 계정 이메일 |
| `api_token` | Text | Jira API 토큰 (저장 시 마스킹) |
| `project_key` | String(50) | 이슈 생성 대상 프로젝트 키 |
| `is_active` | Boolean | 연동 활성화 여부 |
| `trigger_status_names` | JSONB \| None | Done 트리거할 상태 이름 목록 (예: `["Done", "배포됨"]`). 비어있으면 `statusCategory.key == "done"` 전체 적용 |
| `created_at` / `updated_at` | DateTime | |

레코드는 항상 1개만 유지 (upsert).

### JiraCallbackLog 테이블 (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID PK | |
| `jira_issue_key` | String(50) | 콜백에서 추출한 이슈 키 |
| `event_type` | String(100) | Jira 이벤트 타입 (예: `jira:issue_updated`) |
| `payload` | JSONB | 수신된 전체 payload |
| `sr_draft_id` | UUID \| None | 매핑된 SR (없으면 None) |
| `status` | String(50) | `processed` / `skipped` / `error` |
| `created_at` | DateTime | |

---

## 백엔드

### 신규 파일: `app/services/jira_service.py`

- `get_jira_config(db)` — DB에서 활성 설정 조회
- `create_jira_issue(config, draft)` — REST API `POST /rest/api/3/issue` 호출, 이슈 키/URL 반환
- `test_jira_connection(config)` — `GET /rest/api/3/myself` 호출로 연결 확인

### 수정: `app/services/sr_service.py`

`submit_sr()` 변경:
1. Jira 설정 조회
2. 설정 있으면 `jira_service.create_jira_issue()` 호출 → `jira_issue_key`, `jira_issue_url` 저장, status = `jira_created`
3. 설정 없으면 기존 `deliver_webhook()` fallback 실행

### 신규 파일: `app/routers/jira.py`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/jira/config` | 현재 설정 조회 (api_token은 마스킹) |
| `PUT` | `/api/jira/config` | 설정 저장 (upsert) |
| `POST` | `/api/jira/config/test` | 연결 테스트 |
| `POST` | `/api/jira/webhook` | Jira 콜백 수신 |
| `GET` | `/api/jira/callback-logs` | 수신 로그 목록 |

### 콜백 처리 로직 (`POST /api/jira/webhook`)

```
1. payload 파싱 → issue key, status 추출
2. JiraCallbackLog 기록 (항상)
3. status가 Done/Resolved/Closed가 아니면 → status="skipped" 종료
4. jira_issue_key로 SRDraft 조회
5. SR의 related_document_ids 순회 → feedback_service.create_feedback() 호출
   - feedback 내용: "Jira 이슈 {key}가 완료되어 문서 업데이트가 필요합니다."
6. SRDraft.status = "done_synced"
7. JiraCallbackLog.status = "processed"
```

Done 판정 기준:
- `trigger_status_names`가 설정된 경우: `status.name`이 목록에 포함되는지 확인
- 미설정인 경우: `status.statusCategory.key == "done"` (Jira 표준, 회사별 커스텀 상태명과 무관하게 동작)

---

## 프론트엔드 (`/webhook-logs`)

페이지를 3개 섹션으로 재구성한다.

### 섹션 1 — Jira 연동 설정 카드 (상단)

- 입력: Base URL, 이메일, API 토큰(비밀번호 타입), 프로젝트 키
- 트리거 상태 이름: 쉼표 구분 입력 (예: `Done, 배포됨`). 비워두면 done 카테고리 전체 적용
- 버튼: "저장", "연결 테스트"
- 상태 배지: 미설정 / 연결됨 / 오류

### 섹션 2 — 탭 (중단 + 하단)

**탭 A: 수신 로그 (Jira → DocOps)**
- 이슈 키, 이벤트 타입, 처리 결과(processed/skipped/error), 시간

**탭 B: 전송 로그 (DocOps → Jira)**
- 기존 테이블 그대로 유지

### SR 목록 (`/sr`) 변경

- SR 카드에 `jira_issue_key` 배지 표시 (있는 경우)
- Jira 이슈 링크 클릭 시 새 탭으로 이동

---

## Alembic 마이그레이션

1. `sr_drafts` 테이블: `jira_issue_key`, `jira_issue_url` 컬럼 추가
2. `jira_configs` 테이블 신규 생성
3. `jira_callback_logs` 테이블 신규 생성

---

## 미설정 시 동작

`JiraConfig`가 없거나 `is_active=False`이면:
- SR 제출 시 기존 `JIRA_WEBHOOK_URL` 환경변수 fallback
- `/api/jira/webhook` 엔드포인트는 항상 열려 있음 (설정 없이도 로그 기록)

---

## 환경변수 (선택)

기존 `JIRA_WEBHOOK_URL`은 fallback용으로 유지. DB 설정이 우선순위 높음.
