# 알림 허브 + /approvals 라우터 부재 복구 설계

작성일: 2026-05-21
상태: 사용자 검토 대기

## 배경

`/approvals` 페이지는 한때 피드백/매뉴얼/Jira SR 승인을 한 곳에서 검토하는 통합 화면이었다. 이후 각 도메인(`/manuals`, `/feedback`, `/sr`)이 자체 승인 카드를 가지면서 `/approvals`는 기능 중복이 되었고, 라우트가 `App.tsx`에서 빠졌다. 그러나 다음 세 곳이 여전히 `/approvals`로 보냄:

- `ManualJobContext.tsx:56` — 매뉴얼 자동 생성 완료 직후 `navigate("/approvals")` → 흰 화면
- `Dashboard.tsx:80` — "대기 중 승인" 메트릭 카드 링크 → 흰 화면
- `ChangeImpact.tsx:322` — `pending_review` 상태의 "승인 관리로 이동" 버튼 → 흰 화면

별도로 백엔드 매뉴얼 자동화(`manual_service.py`의 `capture_screenshots`)가 Docker 이미지에 Chromium이 설치되지 않아 동작하지 않는다 (`backend/Dockerfile`에 `playwright install chromium` 누락).

이 스펙은 두 단계로 해결한다.

- **Phase 1 (핫픽스, 배포 우선)**: 흰 화면 회귀 차단 + 매뉴얼 자동화 복구 + 완료 토스트 안내. 알림 모델 일반화(`link_path` 필드).
- **Phase 2 (신기능, 배포 후)**: `/notifications` 알림 허브 페이지 + 알림 클릭 시 `/manuals` 진입과 동시에 해당 job 선택 + AI 초안 탭 자동 오픈.

별도로 프론트 e2e 캡처 옵션 PR은 Phase 무관하게 진행.

## 비-범위

- `Approvals.tsx` 파일/`lib/api.ts`의 approvals API 삭제 (다른 진입점 가능성, 보존)
- 새 알림 종류 추가(SR/피드백 등) — 본 스펙은 기존 발행 지점에 `link_path`만 보강
- Dashboard 카드의 Phase 2 후속 재정렬(알림 페이지 카드 추가 등) — Phase 2 구현 중 UX 보고 결정

## Phase 1 — 핫픽스

### 1.1 프론트엔드

| 파일 | 변경 |
|---|---|
| `src/contexts/ManualJobContext.tsx:56` | `navigate("/approvals")` 제거 → 분기 안에서 `clearJob()` 호출만 |
| `src/pages/Dashboard.tsx:80` "대기 중 승인" 카드 | 라벨 "매뉴얼 검토 대기", 링크 `/manuals?tab=review`. stat은 신규 state `manualReviewCount` — `useEffect` 안에서 `api.listManualJobs(user?.id)` 결과를 `j.approval?.status in {pending, needs_review}`로 필터한 length. 기존 `stats.approvals` 필드는 다른 카드 없어지므로 제거 가능 |
| `src/pages/Dashboard.tsx` "오래된 문서" 카드 (line 107~) | "Jira SR" 카드로 교체. 아이콘 `task`, 링크 `/sr`. stat은 기존 `stats.sr` 그대로 사용(이미 `useEffect`에서 `api.listSRDrafts()` 호출 중). 기존 stale 데이터 표시는 다른 영역에서 사용 중이면 그대로 유지(라인 114에서만 표시) |
| `src/pages/ChangeImpact.tsx:318-329` | `normalized === "pending_review"` 분기에서 버튼 제거, 안내문 "수정안이 생성되었습니다"만 남김 |
| `src/pages/Approvals.tsx` | **삭제 안 함**. 라우트 부재 그대로 |
| `src/components/NotificationBell.tsx:38-42` `handleNotifClick` | `if (n.link_path) navigate(n.link_path)`로 일반화. `document_id` 분기 제거 |
| `src/components/Toast.tsx` | `onClick?: () => void` prop 추가. 클릭 시 cursor pointer, hover 효과. `Toast` 본체에서 onClick 호출 후 `onClose` |
| `src/components/Toast.tsx` `ToastContainer` | `toasts: { id; title; message; onClick?: () => void }[]` 로 확장 |
| `src/components/Layout.tsx:77-85` 토스트 큐 등록부 | 토스트 추가 시 `newNotification.link_path` 캡처. 클릭 핸들러 = `() => { markRead(newNotification.id); if (link_path) navigate(link_path); }` |
| `src/lib/api.ts:346` `Notification` 타입 | `link_path: string \| null` 필드 추가 |

### 1.2 백엔드

| 파일 | 변경 |
|---|---|
| `backend/app/models/notification.py` | `link_path: Mapped[str \| None] = mapped_column(String, nullable=True)` 추가 |
| `backend/alembic/versions/<new>_add_link_path_to_notifications.py` | upgrade: `op.add_column("notifications", sa.Column("link_path", sa.String(), nullable=True))`. downgrade: drop column |
| `backend/app/routers/notifications.py` `create_notification` | 시그니처에 `link_path: str \| None = None` 인자 추가. `Notification(... link_path=link_path)` 저장. SSE payload에 `"link_path"` 키 포함 |
| `backend/app/routers/notifications.py` `NotificationResponse` / `_serialize` | `link_path: str \| None` 필드 추가 |
| `backend/app/services/manual_service.py` `run_generation` 완료 분기 (line 90 직후) | `try: await create_notification(db, user_id=job.user_id, type="manual_completed", title="매뉴얼 작성 완료", message=job.target_url, link_path=f"/manuals?job={job.id}&tab=draft") except Exception as e: logger.warning(...)` — 알림 실패가 매뉴얼 완료 자체에 영향 주지 않도록 try/except |
| `backend/app/services/document_service.py:293,310` `create_notification` 호출 | `link_path=f"/documents/{document_id}"` 인자 추가 |
| `backend/app/services/jira_service.py:365-372` `create_notification` 호출 | 알림 의도에 맞는 `link_path` 추가 (`/sr` 또는 `/documents/{id}` — 발행 시점 컨텍스트 확인 후 결정. 본 스펙은 "발행 지점에서 채운다" 규약만 정의) |
| `backend/Dockerfile` | `uv sync` 직후 `COPY app/` 이전에 `RUN uv run playwright install --with-deps chromium` 추가 |

### 1.3 문서 갱신

- `CLAUDE.md` 또는 `HARNESS.md`에 로컬 셋업 안내 1줄: `cd backend && uv run playwright install chromium`

### 1.4 호환성 / 안전성

- `link_path`는 nullable. 기존 row는 NULL → `if (n.link_path)` 분기로 자연스럽게 navigate 없음 → 회귀 없음.
- NotificationBell의 `document_id` 분기 제거는 발행 지점 4곳(`document_service.py` 2회, `jira_service.py` 1회 등)에 `link_path` 동반 추가가 전제. 동반 추가 안 하면 회귀(클릭해도 안 감).
- 마이그는 컬럼 추가만, 다운그레이드 안전.

## Phase 2 — 신기능

### 2.1 신규 페이지 `/notifications`

| 항목 | 사양 |
|---|---|
| 라우트 | `src/App.tsx` ProtectedRoutes 안에 `<Route path="/notifications" element={<Notifications />} />` 추가 |
| 파일 | `src/pages/Notifications.tsx` 신규 |
| 좌측 사이드바 | 종류 필터: "전체 / 매뉴얼 / 오류 제보 / Jira SR / 기타". `n.type` 매핑(`manual_completed`→매뉴얼, `feedback_*`→오류 제보, `jira_*`→Jira SR, 그 외→기타). 카운트 배지 |
| 상단 토글 | "전체 / 미읽음" |
| 본문 | 알림 카드 리스트. 카드 = 아이콘(종류별) + 제목 + 메시지 + 상대시간. 미읽음 dot. 우측 상단 "전체 읽음" 버튼 |
| 클릭 동작 | `markRead(n.id)` + `if (n.link_path) navigate(n.link_path)` |
| 빈 상태 | "알림이 없습니다" |
| 페이지네이션 | 20개씩, "더 보기" 버튼 |

### 2.2 NotificationBell 드롭다운

- 드롭다운 하단에 "전체 보기 →" 링크 추가 → `/notifications` 이동
- 드롭다운은 상위 N개 미리보기만 유지

### 2.3 ManualGenerator query string 해석

| 파일 | 변경 |
|---|---|
| `src/pages/ManualGenerator.tsx` | `useSearchParams()` 사용. `searchParams.get("job")` 있으면 jobs 로드 완료 후 `setSelectedId(job_id)`. `searchParams.get("tab") === "draft"`면 `ManualDetail` 마운트 시 `activeSection` 초기값 "draft" |
| `ManualDetail` | `initialSection?: "info" \| "draft" \| "history"` prop 받음. 없으면 "info" |
| 동기화 방향 | URL → state 단방향. 사용자가 직접 탭 변경 시 URL 갱신 안 함 |

### 2.4 백엔드

| 파일 | 변경 |
|---|---|
| `backend/app/routers/notifications.py` GET `/api/notifications` | query `?type=<str>&unread_only=<bool>&skip=<int>&limit=<int>` 지원. 응답을 `NotificationListResponse { items: [...], total: int }` 로 |
| `src/lib/api.ts` `listNotifications` | 옵션 인자(type/unread_only/skip/limit) 추가. 반환 타입 변경 |
| `src/hooks/useNotifications.ts` | `loadNotifications`는 기존 형태(전체 최신 N개) 유지. 페이지네이션은 신규 Notifications 페이지가 별도 호출 |

### 2.5 Dashboard 카드 후속

- Phase 1에서 임시 지정한 카드(`/manuals?tab=review`, `/sr`)를 그대로 둘지 알림 페이지 카드로 통합할지는 Phase 2 구현 중 결정. 본 스펙은 변경 없음으로 명시.

## 별도 PR — 프론트 e2e 캡처 (Phase 무관)

| 파일 | 변경 |
|---|---|
| `frontend/playwright.config.ts` `use` 블록 | `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`, `video: 'retain-on-failure'` 추가 |
| `frontend/.gitignore` | `test-results/`, `playwright-report/` 무시 확인/추가 |

## 배포 순서

1. **Phase 1 핫픽스 PR**
   - 백엔드: 마이그(link_path) + create_notification 시그니처 + manual_service 알림 발행 + Dockerfile chromium + 발행 지점 4곳 `link_path` 동반
   - 프론트: navigate 제거 + Dashboard 카드 라벨/링크 + ChangeImpact 버튼 + Notification 타입 + Bell/Toast 일반화
2. 머지 → 자동 배포 (`.github/workflows/deploy-aws.yml`)
3. 마이그 자동 실행 (Dockerfile CMD의 `alembic upgrade head`)
4. **Phase 2 PR** — 알림 페이지 + ManualGenerator query 해석 + 페이지네이션 backend
5. **별도 PR** — e2e 캡처 옵션 (언제든)

## 테스트 전략

### Phase 1

- `backend/tests/test_notifications.py` — `create_notification`이 `link_path` 인자를 저장/직렬화하는지 (assertion ~3개)
- `backend/tests/test_manual_service.py` — `run_generation` 완료 분기에서 `create_notification`이 `type="manual_completed"`, `link_path` 채워서 호출되는지 (mock 활용)
- 수동 회귀:
  - Dashboard 카드 4개 모두 정상 페이지로 이동
  - ChangeImpact `pending_review` 카드 안내문 출력, 깨진 버튼 없음
  - 매뉴얼 1건 생성 → 토스트 표시 + 벨에 알림 row 출력
  - ECS 배포 후 매뉴얼 생성 → `screenshots` 필드에 캡처 데이터 들어옴

### Phase 2

- `Notifications.tsx` 필터 동작 e2e 1개
- ManualGenerator query string 해석 RTL unit: `?job=<id>&tab=draft` 진입 시 selectedId/activeSection 초기값

## 리스크 / 알려진 한계

| 리스크 | 완화 |
|---|---|
| Dockerfile chromium 설치로 이미지 ~300MB+ 증가 | 받아들임. 매뉴얼 자동화 본질 |
| Phase 1과 Phase 2 사이 알림 클릭 시 `/manuals`만 도달, 자동 선택 X | 사용자 수용한 한계. Phase 2 도입으로 해소 |
| `create_notification` 실패가 매뉴얼 완료 자체에 영향 주지 않도록 | try/except로 감쌈 (1.2 manual_service 변경에 명시) |
| 발행 지점 4곳의 `link_path` 누락 시 클릭 회귀 | Phase 1 PR에 동반 변경 필수, 리뷰 체크리스트에 포함 |
