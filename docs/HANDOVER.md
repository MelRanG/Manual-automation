# Handover — 2026-05-20

## 실행 방법

```bash
docker compose up --build -d   # 전체 빌드 및 실행
```

- 프론트: http://localhost (포트 80, **반드시 Docker로 실행할 것**)
- 백엔드: http://localhost:8000
- DB: localhost:5600 (pgvector, user/pw: docops/docops_dev)

---

## 목표 플로우 (전체 완성 목표)

```
1. 사용자가 챗봇에서 SR 요청을 보낸다
2. SR 요청이 Jira 또는 Webhook으로 자동 등록된다
3. 사용자가 Jira에서 업무를 수행하고 완료 처리한다
4. 완료된 SR이 문서 반영 필요 여부를 AI(또는 Jira 티켓 필드)가 판정한다
5. 문서 반영이 필요하면 관련 기존 문서를 RAG 검색으로 찾는다
6. 기존 문서 수정인지 신규 문서 생성인지 Jira 티켓(수정건/신규건)으로 판단한다
7. 사용자 매뉴얼이 필요한 경우 Playwright로 화면 캡처 + 설명 자동 생성
8. 생성된 문서를 문서함에 자동 등록한다
9. 등록된 문서는 청킹/임베딩되어 RAG 검색 대상이 된다
```

---

## 남은 구현 업무 (우선순위 순)

### 1. 챗봇 SR 생성 플로우 완성

**현재 상태**: SR 메뉴 선택 후 채팅은 되지만 자동 SR 생성 기준이 불명확.

**목표**:
- 챗봇에서 SR 메뉴 선택 → 챗봇이 SR 형식에 맞춰 사용자에게 정보 수집 (대화형)
- 사용자가 필수 항목(제목, 내용, 우선순위 등)을 형식에 맞게 입력했을 때만 SR 생성
- SR 메뉴 선택했다고 무조건 SR이 생성되면 안 됨 — AI가 정보 충족 여부 판단 후 생성
- SR 생성 후 Jira 자동 등록 확인 (현재 Jira 미연동이므로 임시 시뮬레이터로 테스트)

**관련 파일**:
- `backend/app/services/chat_service.py` — SR 생성 판단 로직 추가 필요
- `backend/app/services/sr_service.py` — SR → Jira 연동
- `frontend/src/pages/Chat.tsx`

---

### 2. Jira 문서작성 필요 여부 판단 및 완료 처리

**현재 상태**: Jira 웹훅 수신은 구현됨. 완료 처리 시 문서 반영 플로우 미구현.

**목표**:
- Jira 이슈에 "문서 작성 필요 여부" 커스텀 필드 추가 (사람이 판단해서 입력)
- Jira 이슈 완료 시 웹훅 콜백 수신 → 문서 작성 필요 여부 확인
- 필요하면 자동으로 문서 작성 플로우 진입

**관련 파일**:
- `backend/app/routers/jira.py` — 웹훅 수신 처리
- `backend/app/services/jira_service.py`

---

### 3. 완료된 SR → 문서 자동 등록

**현재 상태**: Change Impact 분석 → 수정안 생성 → 적용까지 구현됨. 자동 트리거 미연결.

**목표**:
- Jira 완료 웹훅 수신 → 문서 작성 필요 판정 → 관련 문서 자동 검색 → 수정/신규 판단 → 수정안 생성 → 자동 등록 또는 승인 큐 대기
- 등록된 문서는 즉시 청킹/임베딩 → RAG 검색 대상으로 포함

**관련 파일**:
- `backend/app/services/change_impact_service.py`
- `backend/app/services/sr_service.py` — `process_completed_sr()` 함수

---

### 3-1. 사용자 매뉴얼 자동 생성 (Playwright 연동)

**현재 상태**: 수동으로 URL 입력 시 Playwright 캡처 가능. 자동 트리거 미연결.

**목표**:
- Jira 티켓에 "사용자 매뉴얼 필요 여부" 구분 필드 추가 (또는 처음 SR 생성 시 포함 여부 결정)
- 필요 시 Playwright로 화면 캡처 + AI 매뉴얼 자동 생성 → 문서함 자동 등록

**판단 필요 사항**:
- 사용자 매뉴얼 필요 여부를 SR 생성 시점에 포함할지, Jira 티켓 완료 시 판단할지 기획 결정 필요

**관련 파일**:
- `backend/app/services/manual_service.py`
- `backend/app/routers/manuals.py` (또는 sr.py에서 트리거)

---

## ⚠️ Jira 실제 연동 후 제거 필요 항목

| 위치 | 내용 |
|------|------|
| `frontend/src/pages/ServiceRequests.tsx` | "완료 처리 (시뮬레이터)" 버튼 — Jira 없이 SR 강제 완료하는 테스트용 |
| `backend/app/routers/sr.py` | `POST /api/sr/drafts/{id}/complete-local` 엔드포인트 |
| `frontend/src/lib/api.ts` | `completeSRLocal()` 메서드 |

---

## 이번 세션 완료한 변경사항

### 문서 태그 시스템
- `documents.tags` JSONB 컬럼 추가 (`bde2f709c53d` 마이그레이션)
- 태그 형식: `/` 구분 계층 구조, 최대 depth 3. 예: `업무/재무/정산`
- AI 추천 API: `POST /api/documents/{id}/suggest-tags`, `POST /api/documents/suggest-tags-for-content`
- `TagEditor` 컴포넌트: AI 추천 + 수동 입력, depth별 색상 구분
- 문서 편집/생성/상세/목록 전체에 통합

### 문서 목록 — 태그별 폴더 뷰
- 최상위 태그 기준 폴더 구조, 접기/펼치기
- 태그 없는 문서 → "미분류" 자동 분류
- 검색: 문서명 + 태그명 동시

### 파일 업로드 — 태그 설정 모달
- 파일 선택 시 즉시 업로드 X → 태그 편집 모달 먼저 표시
- 파일별 AI 태그 추천 가능
- 백엔드 `/api/documents/upload`에 `tags` form 필드 추가

### 업로드 502 타임아웃 해결
- `convert_to_markdown()` → `asyncio.to_thread()`
- 청킹/임베딩 → `asyncio.create_task(_embed_in_background())` 백그라운드 분리
- `frontend/Dockerfile`: `pnpm install --ignore-scripts` 추가

### 매뉴얼 생성 → 승인 큐
- 생성 완료 시 문서 직접 등록 X → `ProposedDocumentChange` + `ApprovalRequest` 생성 후 승인 대기

### 매뉴얼 생성 진행상태 유지
- `ManualJobContext`: localStorage 기반 상태 유지, 상단 배너 표시, 완료 시 승인 관리로 이동

### Playwright 개선
- `target="_blank"` 링크: `page.goto()` 처리
- `--no-sandbox --disable-dev-shm-usage` 플래그 추가

---

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/models/document.py` | `tags: JSONB` 컬럼 |
| `backend/app/schemas/document.py` | `tags` 필드 (Create/Update/Response) |
| `backend/app/services/document_service.py` | `suggest_tags()`, `_embed_in_background()`, 임베딩 백그라운드화 |
| `backend/app/routers/documents.py` | suggest-tags 엔드포인트, upload `tags` 파라미터, `asyncio.to_thread` |
| `backend/alembic/versions/bde2f709c53d_*.py` | tags 컬럼 마이그레이션 |
| `backend/app/services/manual_service.py` | ProposedDocumentChange+ApprovalRequest 생성, Playwright 개선 |
| `frontend/src/components/TagEditor.tsx` | 신규 — 태그 편집 컴포넌트 |
| `frontend/src/contexts/ManualJobContext.tsx` | 신규 — 매뉴얼 생성 상태 전역 관리 |
| `frontend/src/pages/Documents.tsx` | 태그별 폴더 뷰, 업로드 태그 모달 |
| `frontend/src/pages/DocumentEdit.tsx` | TagEditor 통합 |
| `frontend/src/pages/DocumentDetail.tsx` | 태그 배지 표시 |
| `frontend/src/components/Layout.tsx` | 매뉴얼 생성 진행 배너 |
| `frontend/src/App.tsx` | ManualJobProvider 추가 |
| `frontend/Dockerfile` | `--ignore-scripts` 추가 |
