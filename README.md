# DocOps AI

문서 관리 + AI 자동화 플랫폼. 사내 문서를 등록하고, AI 챗봇으로 질의응답, 오류 제보 → AI 수정 제안 → 승인 워크플로우, 웹사이트 기반 매뉴얼 자동 생성 기능을 제공한다.

---

## 빠른 시작

```bash
# DB 실행
docker compose up db -d

# 백엔드 (포트 8000)
cd backend && uv sync && uv run alembic upgrade head && uv run uvicorn app.main:app --reload --port 8000

# 프론트엔드 (포트 5173)
cd frontend && pnpm install && pnpm dev
```

브라우저에서 `http://localhost:5173` 접속 → 이메일 입력으로 로그인 (`admin@docops.ai` 권장).

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS 4 |
| Backend | Python FastAPI + SQLAlchemy (async) + Alembic |
| DB | PostgreSQL 16 + pgvector (벡터 검색) |
| LLM | AWS Bedrock (기본값) / Anthropic API / OpenAI / Mock |
| 패키지 관리 | pnpm (frontend), uv (backend) |
| 배포 | Docker → AWS ECS Fargate |

---

## 환경 변수 (`.env` — 프로젝트 루트)

```env
DATABASE_URL=postgresql+asyncpg://docops:docops_dev@localhost:5600/docops

# LLM: bedrock | anthropic | openai | mock
LLM_PROVIDER=bedrock

# Bedrock (AWS IAM 또는 키 직접 입력)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6-20251101-v1:0

# 직접 API 키 쓸 경우
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# 임베딩: bedrock | mock
# bedrock: amazon.titan-embed-text-v2:0 (AWS_ACCESS_KEY_ID 등 Bedrock 설정 필요)
EMBEDDING_MODEL=mock
SECRET_KEY=dev-secret-key-change-in-production
```

키가 없으면 `LLM_PROVIDER=mock` 으로 설정하면 실제 LLM 없이 동작한다.

---

## 프로젝트 구조

```
Manual-automation/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 앱 진입점, 라우터 등록
│   │   ├── config.py        # 환경변수 (pydantic-settings)
│   │   ├── db.py            # DB 세션
│   │   ├── seed.py          # 서버 시작 시 데모 데이터 자동 생성
│   │   ├── models/          # SQLAlchemy ORM 모델
│   │   ├── schemas/         # Pydantic 요청/응답 스키마
│   │   ├── routers/         # API 엔드포인트
│   │   └── services/        # 비즈니스 로직
│   ├── alembic/             # DB 마이그레이션
│   └── tests/               # pytest
├── frontend/
│   └── src/
│       ├── App.tsx          # 라우팅 (react-router)
│       ├── contexts/        # AuthContext (로그인 상태)
│       ├── pages/           # 페이지 컴포넌트
│       ├── components/      # 공통 컴포넌트 (Layout, Toast, NotificationBell)
│       ├── hooks/           # useApi, useNotifications
│       └── lib/api.ts       # 백엔드 API 호출 함수 모음
├── .env                     # 환경변수 (gitignore 대상)
└── docker-compose.yml       # DB + backend + frontend
```

---

## 인증

JWT 없음. **이메일만 입력**하면 로그인.

- `POST /api/auth/login { email }` → User 객체 반환
- User 객체를 `localStorage['docops_user']`에 JSON으로 저장
- 모든 API 요청에 `X-User-Id: {uuid}` 헤더 자동 첨부 (`frontend/src/lib/api.ts`)

---

## 주요 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 이메일 로그인 (없으면 자동 생성) |
| GET | `/api/documents` | 문서 목록 |
| POST | `/api/documents/upload` | 파일 업로드 (현재 텍스트만 정상 처리, DOCX/XLSX 미구현) |
| POST | `/api/chat/sessions` | 채팅 세션 생성 |
| POST | `/api/chat/sessions/{id}/ask-stream` | SSE 스트리밍 답변 |
| DELETE | `/api/chat/sessions/{id}` | 세션 삭제 |
| POST | `/api/feedback` | 오류 제보 (AI 수정안 자동 생성) |
| DELETE | `/api/feedback/{id}` | 제보 삭제 |
| POST | `/api/approvals/{proposed_change_id}` | 승인 요청 생성 |
| POST | `/api/approvals/{id}/review` | 승인/반려 처리 |
| POST | `/api/manuals/jobs` | 매뉴얼 생성 잡 등록 |
| GET | `/api/notifications` | 알림 목록 |
| GET | `/api/notifications/stream` | SSE 실시간 알림 |
| GET | `/api/jira/config` | Jira 연동 설정 조회 |
| PUT | `/api/jira/config` | Jira 연동 설정 저장 |
| POST | `/api/jira/config/test` | Jira 연결 테스트 |
| POST | `/api/jira/webhook` | Jira Done 웹훅 수신 → 문서 자동 현행화 |
| GET | `/api/jira/callback-logs` | Jira 웹훅 수신 로그 목록 |

전체 Swagger: `http://localhost:8000/docs`

---

## 알림 시스템

SSE(Server-Sent Events) 기반 실시간 알림. `EventSource` 대신 custom fetch로 구현 (헤더 전송 필요).

**트리거:**
- 오류 제보 접수 → 해당 문서 소유자에게 알림
- 승인/반려 결정 → 피드백 작성자에게 알림

**구현 위치:**
- 백엔드: `app/routers/notifications.py` — in-memory `asyncio.Queue` 기반 pub/sub
- 프론트: `src/hooks/useNotifications.ts` → `src/components/NotificationBell.tsx` + `Toast.tsx`

---

## LLM 연동

`backend/app/services/llm_service.py`에서 provider 추상화.

| `LLM_PROVIDER` 값 | 클래스 | 비고 |
|-------------------|--------|------|
| `bedrock` | `BedrockLLMProvider` | AWS Bedrock, boto3 기반 |
| `anthropic` | `AnthropicLLMProvider` | Anthropic API 직접 |
| `openai` | `OpenAILLMProvider` | GPT-4o |
| `mock` | `MockLLMProvider` | API 키 없이 테스트용 |

새 provider 추가 시 `LLMProvider` ABC를 상속하고 `get_llm_provider()`에 분기 추가.

---

## DB 마이그레이션

```bash
cd backend

# 현재 상태 확인
uv run alembic current

# 최신으로 적용
uv run alembic upgrade head

# 새 마이그레이션 생성 (모델 변경 후)
uv run alembic revision --autogenerate -m "설명"
```

---

## 시드 데이터

서버 시작 시 `app/seed.py`가 자동 실행된다.

- 데모 유저: `admin@docops.ai` (role: admin)
- 한국어 문서 10개 (사용자 메뉴얼, 요구사항 정의서, API 명세서 등)
- 채팅 세션 1개 (신뢰도 점수 관련 예시 대화)
- 피드백 3개 (운영 가이드, 보안 정책, API 명세 관련)

이미 존재하는 경우 스킵하므로 중복 생성 없음.

---

## 프론트엔드 페이지 목록

| 경로 | 컴포넌트 | 설명 |
|------|----------|------|
| `/login` | Login | 이메일 로그인 |
| `/` | Dashboard | 통계 대시보드 |
| `/documents` | Documents | 문서 목록 + 업로드 |
| `/documents/:id` | DocumentDetail | 문서 상세 + 버전 이력 |
| `/chat` | Chat | RAG 기반 Q&A 챗봇 |
| `/feedback` | Feedback | 오류 제보 목록 + 등록 |
| `/approvals` | Approvals | AI 수정 제안 승인/반려 |
| `/trust` | TrustScores | 문서 신뢰도 점수 |
| `/sr` | ServiceRequests | 서비스 요청 (SR) 관리 |
| `/change-impact` | ChangeImpact | 변경 영향 분석 |
| `/manuals` | ManualGenerator | URL 기반 매뉴얼 자동 생성 |
| `/webhook-logs` | WebhookLogs | 외부 연동 로그 |
| `/widget-conversations` | WidgetConversations | 임베드 위젯 대화 이력 |

---

## 알려진 미구현 / TODO

- **DOCX/XLSX/PPTX 파일 업로드**: 현재 바이너리를 UTF-8로 디코딩해서 저장 → 깨짐. 뷰어 미구현.
  - 방향: mammoth.js(DOCX) + SheetJS(XLSX) 클라이언트 렌더링, PPTX는 서버 변환 또는 미지원
- **임베딩/벡터 검색**: 기본값 `EMBEDDING_MODEL=mock` — AWS 배포 시 `bedrock`으로 변경 (Titan Embed v2 사용)
- **위젯**: `frontend/src/widget/` 에 embeddable 챗봇 위젯 코드 존재, 별도 번들 빌드

---

## 배포

```bash
# 전체 Docker 빌드
docker compose up --build

# ECS Fargate 배포
# infra/task-definition.json의 ACCOUNT_ID, REGION 플레이스홀더 교체 후 사용
# ECR 리포: manual-automation-backend, manual-automation-frontend
```
