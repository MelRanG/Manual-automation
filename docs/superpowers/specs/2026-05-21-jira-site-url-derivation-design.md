# Jira Site URL 기반 base_url 자동 derive 설계

**Date:** 2026-05-21
**Status:** Draft — pending user review
**Branch context:** `feat/manual-ai-draft-review-inline` (현 작업 브랜치, 별도 브랜치에서 진행)

## Problem

Jira SR 화면에서 이슈 키(`SCRUM-178`) 클릭 시 잘못된 URL로 이동.

- 현재 `JiraConfig.base_url` = `https://api.atlassian.com/ex/jira/7b4ffc68-2983-46cb-b50f-5f2ef43a6a57`
  (service account 가 사용하는 OAuth proxy API URL).
- `backend/app/services/jira_service.py:87-89` 에서 `issue_url = f"{base_url}/browse/{key}"` 로 조합 →
  결과 URL = `https://api.atlassian.com/ex/jira/.../browse/SCRUM-178`.
- 브라우저로 그 URL 열면 Atlassian 이 `login.jsp?permissionViolation=true...` 로 리다이렉트
  (해당 endpoint 는 OAuth 헤더가 있는 API 호출 전용이며 브라우저 세션과 무관).

원하는 동작: 이슈 링크가 사람용 site URL (`https://manual-automation.atlassian.net/browse/SCRUM-178`)
로 가야 함.

## Goal

사용자가 Atlassian site URL (`https://manual-automation.atlassian.net`) 만 입력하면
backend 가 자동으로 cloudId 를 조회해 service account 용 base_url 을 derive 하고,
SR 응답의 jira 이슈 링크는 항상 site URL 기준으로 동적 조합되도록 만든다.

## Non-Goals

- 기존 service-account 외의 인증 방식 (personal API token 으로 site URL 직접 호출,
  OAuth 3-legged flow 등) 신규 지원은 이 스펙 범위 밖.
- 멀티 site / 멀티 config 동시 활성화 지원은 범위 밖 (현재처럼 단일 active config).
- 기존 SR 의 `sr_drafts.jira_issue_url` 컬럼 값을 DB 마이그레이션으로 일괄 교체하지 않는다
  (응답 시점 동적 조합으로 우회).

## Design

### 1. Data model & 설정 의미 변경

**DB (`backend/app/models/jira.py` 의 `JiraConfig`):**

| 필드 | 변경 |
|---|---|
| `site_url` | **신규** — `Mapped[str \| None] = mapped_column(String(500), nullable=True)` |
| `base_url` | 의미 변경 — 사용자가 직접 입력하지 않음. backend 가 derive 한 값. 컬럼 정의 자체는 그대로. |
| 그 외 필드 | 변경 없음 (`user_email`, `api_token`, `project_key`, `is_active`, `trigger_status_names`) |

**Alembic migration:**

- `site_url` column 추가 (nullable, 길이 500).
- 기존 row backfill:
  - `base_url LIKE 'https://api.atlassian.com/%'` → `site_url` 은 NULL 그대로 유지
    (사용자가 settings 화면에서 채워야 이슈 링크가 살아남).
  - 그 외 (`*.atlassian.net` 등 일반 site URL 직접 저장 케이스) → `site_url = base_url` 로 복사.

**Pydantic schemas (`backend/app/schemas/jira.py`):**

- `JiraConfigUpsert`: `base_url` 필드 **제거**, `site_url: str` 필드 추가 (필수).
- `JiraConfigResponse`: `site_url` (입력값), `base_url` (derive 결과, read-only) 둘 다 노출.
  `api_token_masked` 처리는 기존 그대로.

### 2. Site URL → cloudId derive 로직

**Atlassian endpoint:** `GET https://<site>.atlassian.net/_edge/tenant_info`
응답 예: `{"cloudId": "7b4ffc68-2983-46cb-b50f-5f2ef43a6a57", "cloudName": "manual-automation"}`.
인증 불필요한 public endpoint.

**새 service 함수 (`backend/app/services/jira_service.py`):**

```python
async def resolve_cloud_id(site_url: str) -> str:
    """
    {site_url}/_edge/tenant_info 호출하여 cloudId 반환.
    실패 시 ValueError 발생 (HTTP != 200, timeout, JSON parse 실패, cloudId 누락).
    """

def derive_base_url(cloud_id: str) -> str:
    return f"https://api.atlassian.com/ex/jira/{cloud_id}"

def normalize_site_url(raw: str) -> str:
    """trailing slash 제거, scheme 누락 시 https 강제."""
```

- `normalize_site_url` 은 입력의 trailing `/` 제거, scheme 없으면 `https://` 부착.
- `resolve_cloud_id` timeout = 10s (기존 `test_connection` 과 동일).

**호출 시점:**

- `POST /api/jira/config` (upsert): `site_url` 받음 → normalize → `resolve_cloud_id` →
  `derive_base_url` → DB 에 `site_url`, `base_url` 둘 다 저장.
- `POST /api/jira/config/test`: 동일하게 derive 후, derive 된 `base_url` 로 기존
  `/rest/api/3/myself` 테스트. 성공 메시지에 cloudId 포함:
  `"연결됨: {displayName} (cloudId: {cloud_id})"`.

**오류 처리:**

- `resolve_cloud_id` 실패 시 router 에서 `HTTPException(400, "site URL 에서 cloudId 를
  가져올 수 없음: {원인}")` 변환.
- `/myself` 호출 실패는 기존 동작 유지.

### 3. Issue URL 동적 조합 (응답 시점)

**원칙:** `sr_drafts.jira_issue_url` DB 컬럼 값은 응답에서 신뢰하지 않는다.
SR response 만들 때 active config 의 `site_url` 과 `jira_issue_key` 로 매번 재구성.

**Helper (`backend/app/services/jira_service.py`):**

```python
def build_jira_issue_url(jira_issue_key: str | None, config: JiraConfig | None) -> str | None:
    if not jira_issue_key or not config or not config.site_url:
        return None
    if jira_issue_key.startswith("LOCAL-"):  # 시뮬레이션 키
        return None
    return f"{config.site_url.rstrip('/')}/browse/{jira_issue_key}"
```

**호출:** SR list/detail/upsert 응답 변환부에서 호출. `SRDraft.jira_issue_url`
응답 필드는 항상 이 함수 결과로 덮어씀. 정확한 위치 (router 또는 service 레이어)
는 구현 단계에서 기존 패턴 확인 후 한 곳으로 고정.

**DB 컬럼 처리:**

- `sr_drafts.jira_issue_url` 컬럼은 그대로 유지 (drop 안 함).
- 새 SR 생성 시에도 굳이 채우지 않는다 (`NULL` 저장 허용) — 응답 시 동적 조합으로 충분.
- 기존 row 의 broken URL 은 응답 변환에서 자동으로 올바른 URL 로 덮여 사용자에게 안 보임.

**Frontend 영향:** `frontend/src/pages/ServiceRequests.tsx` 의 `isRealJiraLink` 및
`<a href={sr.jira_issue_url}>` 로직 변경 불필요. 응답이 올바르면 자동으로 작동.

**Edge case — site_url NULL 인 기존 row:** active config 의 `site_url` 이 NULL
(backfill 으로 채워지지 않은 service-account 케이스) 이고 사용자가 settings 에서
아직 채우지 않은 경우, helper 가 `None` 반환 → 프론트에서 `isRealJiraLink === false`
로 평가되어 `"{issue_key} (시뮬레이션)"` 텍스트가 표시된다. 실제로는 시뮬레이션이
아니라 site URL 미설정 상태인데 시뮬레이션처럼 보이는 한계. 사용자가 settings 에서
site URL 을 채우는 즉시 정상 링크로 복구되므로 이 한계는 수용하고 별도 UI 분기는
추가하지 않는다.

### 4. Frontend Config UX

**파일:** Jira 설정 화면 (구현 시 `frontend/src/pages/` 에서 Jira config 컴포넌트 위치 확인).

**필드 변경:**

- 기존 `base_url` 입력 필드 → **제거**.
- 신규 `site_url` 입력 필드 추가.
  - Label: `Atlassian Site URL`
  - Placeholder: `https://your-site.atlassian.net`
  - Helper text: `예: https://manual-automation.atlassian.net — service account 사용 시 cloudId 자동 추출`
- 나머지 필드 (`user_email`, `api_token`, `project_key`, `is_active`,
  `trigger_status_names`) 변경 없음.

**Read-only 보조 표시:**

저장/연결 테스트 성공 후, derive 된 `base_url` 을 화면 한 켠에 read-only 텍스트로 노출.
예시 표시: `내부 API URL: https://api.atlassian.com/ex/jira/<cloudId>`.

**검증:**

- 클라이언트 측: `site_url` 비면 submit 막음, scheme (https) 시작 정도만 가볍게 체크.
- 진짜 검증은 서버 (`resolve_cloud_id`) 에서 수행.

**연결 테스트 버튼:**

기존 "테스트" 버튼 → `POST /api/jira/config/test` 호출. 응답 메시지:

- 성공: `"연결됨: {displayName} (cloudId: {cloud_id})"`.
- 실패: 기존 형식 유지.

### 5. Test plan

**Backend unit tests (`backend/tests/`):**

- `test_jira_service.py::test_resolve_cloud_id_success` — `_edge/tenant_info` 200 응답 mock → cloudId 반환.
- `test_jira_service.py::test_resolve_cloud_id_missing_field` — 응답에 cloudId 누락 → `ValueError`.
- `test_jira_service.py::test_resolve_cloud_id_http_error` — HTTP 404/500 → `ValueError`.
- `test_jira_service.py::test_resolve_cloud_id_timeout` — timeout → `ValueError`.
- `test_jira_service.py::test_derive_base_url` — cloud_id → 올바른 API URL.
- `test_jira_service.py::test_normalize_site_url_*` — trailing slash 제거, scheme 보강.
- `test_jira_service.py::test_build_jira_issue_url_*` — key/config null, `LOCAL-` prefix,
  정상 케이스, trailing slash 정리.

**Backend integration tests:**

- `test_jira_router.py::test_upsert_config_derives_base_url` — `site_url` 만 보내 POST →
  DB 에 `site_url`, `base_url` 둘 다 저장됨 확인.
- `test_jira_router.py::test_upsert_config_invalid_site` — tenant_info mock 실패 → 400 반환.
- `test_jira_router.py::test_test_endpoint_returns_cloud_id` — 성공 메시지에 cloudId 포함.
- `test_sr_router.py::test_sr_response_jira_url` — `site_url` 설정된 active config + SR 있을 때
  응답의 `jira_issue_url == f"{site_url}/browse/{key}"`.
- `test_sr_router.py::test_sr_response_jira_url_local_key` — `LOCAL-` 키는 `None` 반환.

**Migration test:**

- `test_migration.py` (또는 기존 migration test 위치) — `base_url` 이 `api.atlassian.com`
  인 row → `site_url` NULL backfill, `*.atlassian.net` 인 row → `site_url` 복사 검증.

**Manual verification (HARNESS.md VERIFY 단계):**

1. Settings 화면에서 `https://manual-automation.atlassian.net` 입력 → 저장.
2. derive 된 `base_url` 이 `https://api.atlassian.com/ex/jira/7b4ffc68-...` 로 read-only
   표시되는지 확인.
3. 연결 테스트 → `"연결됨: ... (cloudId: 7b4ffc68-...)"` 성공 응답.
4. 기존 SR 화면에서 SCRUM-178 클릭 → `https://manual-automation.atlassian.net/browse/SCRUM-178`
   로 이동 + Jira 로그인 페이지 정상 노출 (이전 login violation 메시지 없음).

**Frontend tests:** `ServiceRequests.tsx` 로직 변화 없으므로 신규 테스트 없음.
설정 화면 컴포넌트는 입력 변경분에 한해 가벼운 컴포넌트 테스트만 추가.

## Files to change (예상)

- `backend/app/models/jira.py` — `site_url` 컬럼 추가.
- `backend/app/schemas/jira.py` — `JiraConfigUpsert` / `JiraConfigResponse` 갱신.
- `backend/app/services/jira_service.py` — `resolve_cloud_id`, `derive_base_url`,
  `normalize_site_url`, `build_jira_issue_url` 추가. 기존 `create_jira_issue` 의
  `issue_url` 조합 제거 (응답 동적 조합으로 이관).
- `backend/app/routers/jira.py` — upsert / test endpoint 에서 derive 호출.
- `backend/app/services/sr_service.py` 또는 `backend/app/routers/sr.py` —
  SR 응답 변환에 `build_jira_issue_url` 호출 추가.
- `backend/alembic/versions/<new>.py` — `site_url` 컬럼 추가 + backfill.
- `frontend/src/pages/...` (Jira 설정 컴포넌트) — 입력 필드 변경 + derive 결과 표시.
- `frontend/src/lib/api.ts` — `JiraConfigUpsert` / `JiraConfigResponse` 타입 갱신.
- 위에 명시된 backend 테스트 파일들.
