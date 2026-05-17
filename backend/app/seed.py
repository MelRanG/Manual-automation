"""Seed the database with demo data for development."""
import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models.chat import ChatSession, ChatMessage
from app.models.document import Document, DocumentVersion
from app.models.feedback import FeedbackReport
from app.models.user import User

DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

SEED_DOCUMENTS = [
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000001"),
        "title": "DocOps AI 플랫폼 사용자 메뉴얼",
        "description": "DocOps AI 플랫폼의 전체 기능을 설명하는 사용자 메뉴얼입니다.",
        "trust_score": 0.92,
        "status": "active",
        "priority": "high",
        "last_reviewed_at": "2026-05-10",
        "content": """# DocOps AI 플랫폼 사용자 메뉴얼

## 1. 개요

DocOps AI 플랫폼은 기업의 문서 관리 및 운영 자동화를 위한 통합 솔루션입니다. AI 기반 문서 분석, Q&A 챗봇, 자동 매뉴얼 생성 등의 기능을 제공합니다.

### 1.1 주요 기능

- **문서 관리**: 문서 업로드, 버전 관리, 신뢰도 점수 자동 계산
- **Q&A 챗봇**: 문서 내용 기반 질의응답, 출처 인용
- **오류 제보**: 문서 오류 신고 및 AI 기반 수정 제안
- **승인 관리**: 수정 제안 검토 및 승인/반려 워크플로우
- **매뉴얼 자동 생성**: 웹사이트 URL 기반 사용자 매뉴얼 자동 생성

## 2. 시작하기

### 2.1 대시보드

로그인 후 첫 화면인 대시보드에서는 다음 정보를 확인할 수 있습니다.

- **전체 문서 신뢰도**: 등록된 모든 문서의 평균 신뢰도 점수
- **대기 중 승인**: 검토가 필요한 수정 제안 건수
- **오류 제보**: 접수된 오류 제보 건수
- **오래된 문서**: 최근 6개월 이상 검토되지 않은 문서 수

### 2.2 문서 등록

1. 좌측 사이드바에서 **문서 관리** 클릭
2. 우상단 **새 문서** 버튼 클릭
3. 문서 제목, 설명, 내용 입력 후 **문서 생성** 클릭
4. 또는 **업로드** 버튼으로 파일(.txt, .md) 직접 업로드 가능

## 3. 문서 관리

### 3.1 신뢰도 점수

신뢰도 점수는 0~1 사이의 값으로, 다음 기준으로 산정됩니다.

| 점수 범위 | 상태 | 의미 |
|-----------|------|------|
| 0.9 이상 | 우수 | 최신 정보, 오류 없음 |
| 0.7~0.9 | 양호 | 일부 검토 권장 |
| 0.7 미만 | 주의 | 즉시 검토 필요 |

### 3.2 버전 관리

문서를 수정하면 자동으로 새 버전이 생성됩니다. 버전 히스토리에서 이전 버전 내용을 확인하고 비교할 수 있습니다.

## 4. Q&A 챗봇

### 4.1 질문하기

1. 좌측 사이드바에서 **Q&A 챗봇** 클릭
2. **새 대화 시작** 버튼 클릭
3. 하단 입력창에 질문 입력 후 전송

### 4.2 응답 이해하기

- AI 응답에는 참조한 문서 출처가 표시됩니다
- 응답이 실제와 다를 경우 **실제와 달라요** 버튼으로 오류 제보 가능
- 좋아요/싫어요 버튼으로 응답 품질 평가 가능

## 5. 오류 제보

### 5.1 오류 제보 방법

1. 좌측 사이드바에서 **오류 제보** 클릭
2. **오류 제보** 버튼 클릭
3. 오류 내용 상세히 입력 후 **제보 제출** 클릭
4. AI가 자동으로 수정 제안을 생성합니다

## 6. 알림

문서 관련 이벤트 발생 시 화면 우상단 알림 아이콘에 표시됩니다.

- 내 문서에 오류가 제보된 경우
- 수정 제안이 승인/반려된 경우

## 7. 문의

기술 지원: support@docops.ai
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000002"),
        "title": "DocOps AI 플랫폼 요구사항 정의서",
        "description": "시스템 기능 및 비기능 요구사항을 정의한 문서입니다.",
        "trust_score": 0.78,
        "status": "active",
        "priority": "high",
        "last_reviewed_at": "2026-04-15",
        "content": """# DocOps AI 플랫폼 요구사항 정의서

## 1. 프로젝트 개요

### 1.1 배경 및 목적

현업 부서의 문서 관리 비효율성을 해결하고, AI를 활용하여 문서 품질 관리 및 운영 자동화를 구현합니다.

### 1.2 범위

본 시스템은 문서 저장·검색, AI 기반 Q&A, 오류 수정 제안, 승인 워크플로우를 포함합니다.

## 2. 기능 요구사항

### 2.1 문서 관리 (FR-001)

| 요구사항 ID | 설명 | 우선순위 |
|------------|------|---------|
| FR-001-01 | 사용자는 텍스트 또는 파일로 문서를 등록할 수 있어야 한다 | 필수 |
| FR-001-02 | 문서 수정 시 자동으로 버전이 생성되어야 한다 | 필수 |
| FR-001-03 | 문서 제목으로 검색이 가능해야 한다 | 필수 |
| FR-001-04 | 문서 신뢰도 점수가 자동 계산되어야 한다 | 권장 |

### 2.2 AI Q&A (FR-002)

| 요구사항 ID | 설명 | 우선순위 |
|------------|------|---------|
| FR-002-01 | 사용자는 자연어로 문서 내용을 질의할 수 있어야 한다 | 필수 |
| FR-002-02 | AI 응답에 참조 출처가 표시되어야 한다 | 필수 |
| FR-002-03 | 대화 히스토리가 세션별로 저장되어야 한다 | 권장 |

### 2.3 오류 제보 (FR-003)

| 요구사항 ID | 설명 | 우선순위 |
|------------|------|---------|
| FR-003-01 | 사용자는 문서 오류를 제보할 수 있어야 한다 | 필수 |
| FR-003-02 | AI가 제보 내용을 분석하여 수정 제안을 생성해야 한다 | 필수 |
| FR-003-03 | 오류 제보 시 문서 소유자에게 알림이 발송되어야 한다 | 필수 |

### 2.4 승인 관리 (FR-004)

| 요구사항 ID | 설명 | 우선순위 |
|------------|------|---------|
| FR-004-01 | 관리자는 수정 제안을 승인 또는 반려할 수 있어야 한다 | 필수 |
| FR-004-02 | 승인/반려 결정 시 제안자에게 알림이 발송되어야 한다 | 필수 |
| FR-004-03 | 승인된 수정 내용이 자동으로 문서에 반영되어야 한다 | 필수 |

## 3. 비기능 요구사항

### 3.1 성능

- 문서 검색 응답 시간: 2초 이내
- AI Q&A 첫 토큰 응답: 3초 이내
- 동시 사용자: 100명 이상 지원

### 3.2 보안

- JWT 기반 사용자 인증
- 모든 API 통신 HTTPS 암호화
- 사용자별 문서 접근 권한 관리

### 3.3 가용성

- 서비스 가용성 99.5% 이상
- 장애 복구 시간 4시간 이내

## 4. 제약사항

- 백엔드: Python FastAPI
- 프론트엔드: React + TypeScript
- 데이터베이스: PostgreSQL
- AI 모델: Anthropic Claude API

## 5. 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|---------|------|
| 1.0 | 2026-03-01 | 초안 작성 | 기획팀 |
| 2.0 | 2026-04-15 | 알림 요구사항 추가 | 개발팀 |
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000003"),
        "title": "DocOps AI REST API 명세서",
        "description": "백엔드 API 엔드포인트 전체 명세입니다.",
        "trust_score": 0.95,
        "status": "active",
        "priority": "high",
        "last_reviewed_at": "2026-05-15",
        "content": """# DocOps AI REST API 명세서

## 기본 정보

- **Base URL**: `https://api.docops.ai`
- **인증**: Bearer JWT Token
- **Content-Type**: `application/json`

## 인증 API

### POST /api/auth/login

이메일로 로그인합니다. 사용자가 없으면 자동 생성됩니다.

**Request Body**
```json
{
  "email": "user@example.com"
}
```

**Response 200**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "사용자명"
  }
}
```

### GET /api/auth/me

현재 로그인한 사용자 정보를 반환합니다.

**Headers**: `Authorization: Bearer <token>`

**Response 200**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "사용자명",
  "role": "user",
  "department": "Engineering"
}
```

## 문서 API

### POST /api/documents

새 문서를 생성합니다.

**Request Body**
```json
{
  "title": "문서 제목",
  "description": "문서 설명",
  "owner_id": "user-uuid"
}
```

**Query Parameters**: `content` (string) - 문서 내용

**Response 201**
```json
{
  "id": "uuid",
  "title": "문서 제목",
  "trust_score": 1.0,
  "status": "active",
  "version_number": 1,
  "created_at": "2026-05-17T00:00:00Z"
}
```

### GET /api/documents

문서 목록을 조회합니다.

**Query Parameters**
- `skip` (int, default 0): 건너뛸 개수
- `limit` (int, default 20): 최대 조회 수

**Response 200**
```json
{
  "items": [...],
  "total": 42,
  "skip": 0,
  "limit": 20
}
```

### GET /api/documents/{id}

특정 문서를 조회합니다.

**Response 200** - Document 객체 반환

## 알림 API

### GET /api/notifications

현재 사용자의 알림 목록을 조회합니다.

**Headers**: `Authorization: Bearer <token>`

**Response 200**
```json
[
  {
    "id": "uuid",
    "type": "feedback_received",
    "title": "오류 제보 접수",
    "message": "'사용자 메뉴얼'에 오류가 제보되었습니다.",
    "is_read": false,
    "created_at": "2026-05-17T10:00:00Z"
  }
]
```

### POST /api/notifications/{id}/read

알림을 읽음 처리합니다.

### GET /api/notifications/stream

SSE 스트림으로 실시간 알림을 수신합니다.

**Response**: `text/event-stream`

## 오류 코드

| 코드 | 설명 |
|------|------|
| 400 | 잘못된 요청 |
| 401 | 인증 필요 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 (중복 등) |
| 500 | 서버 오류 |
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000004"),
        "title": "DocOps AI 시스템 운영 가이드",
        "description": "서버 운영, 모니터링, 장애 대응 절차를 안내합니다.",
        "trust_score": 0.61,
        "status": "active",
        "priority": "medium",
        "last_reviewed_at": "2026-01-20",
        "content": """# DocOps AI 시스템 운영 가이드

> ⚠️ 이 문서는 2026년 1월 이후 업데이트되지 않았습니다. 일부 내용이 현재 시스템과 다를 수 있습니다.

## 1. 시스템 아키텍처 개요

DocOps AI는 다음 구성 요소로 이루어집니다.

- **프론트엔드**: React SPA (Vite, Nginx 서빙)
- **백엔드**: Python FastAPI (uvicorn)
- **데이터베이스**: PostgreSQL 16
- **컨테이너**: Docker + ECS Fargate
- **CDN**: AWS CloudFront

## 2. 배포 환경

### 2.1 개발 환경

```bash
# 프론트엔드
cd frontend && pnpm dev

# 백엔드
cd backend && uv run fastapi dev
```

### 2.2 프로덕션 배포

```bash
# Docker 빌드
docker build -t ma-backend ./backend
docker build -t ma-frontend ./frontend

# ECR 푸시
aws ecr get-login-password | docker login --username AWS ...
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/manual-automation-backend
```

## 3. 모니터링

### 3.1 헬스체크

- 백엔드: `GET /health` → `{"status": "ok"}`
- 데이터베이스 연결 확인은 `/health/db` 엔드포인트 사용 (추가 예정)

### 3.2 로그 확인

```bash
# 로컬
docker compose logs -f backend

# ECS
aws logs tail /ecs/docops-backend --follow
```

## 4. 장애 대응

### 4.1 백엔드 응답 없음

1. ECS 태스크 상태 확인
2. 필요 시 태스크 강제 재시작
3. 데이터베이스 연결 상태 확인

### 4.2 데이터베이스 연결 실패

1. RDS 인스턴스 상태 확인
2. 보안 그룹 인바운드 규칙 확인
3. 환경변수 `DATABASE_URL` 값 검증

## 5. 백업 정책

- 데이터베이스: 매일 자동 스냅샷 (7일 보관)
- 업로드 파일: S3 Cross-Region Replication

## 6. 연락처

- 운영 담당: ops@docops.ai
- 긴급 연락: 010-XXXX-XXXX (야간/주말)
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000005"),
        "title": "시스템 아키텍처 설계서",
        "description": "DocOps AI 플랫폼의 전체 시스템 아키텍처를 설명합니다.",
        "trust_score": 0.85,
        "status": "active",
        "priority": "high",
        "last_reviewed_at": "2026-05-01",
        "content": """# 시스템 아키텍처 설계서

## 1. 아키텍처 개요

DocOps AI는 3-tier 아키텍처로 구성되며, 마이크로서비스 패턴을 일부 적용합니다.

```
[클라이언트 (브라우저)]
         ↕ HTTPS
[CloudFront CDN]
         ↕
[Nginx (React SPA)]
         ↕ API 호출
[FastAPI 백엔드]
    ↕          ↕
[PostgreSQL]  [Anthropic API]
```

## 2. 프론트엔드 아키텍처

### 2.1 기술 스택

- **빌드**: Vite 8 + TypeScript 6
- **UI 프레임워크**: React 19
- **스타일링**: Tailwind CSS 4.3
- **컴포넌트**: Radix UI (접근성)
- **라우팅**: React Router 7
- **아이콘**: Material Symbols Outlined

### 2.2 상태 관리

전역 상태: AuthContext (JWT 토큰, 사용자 정보)
로컬 상태: 각 페이지 컴포넌트의 useState

### 2.3 실시간 통신

- **채팅 스트리밍**: SSE (Server-Sent Events) via fetch + ReadableStream
- **알림 스트리밍**: SSE via EventSource

## 3. 백엔드 아키텍처

### 3.1 기술 스택

- **프레임워크**: FastAPI 0.136
- **런타임**: Python 3.12
- **ASGI 서버**: Uvicorn
- **ORM**: SQLAlchemy 2.0 (비동기)
- **마이그레이션**: Alembic
- **패키지 관리**: uv

### 3.2 레이어 구조

```
app/
├── routers/      # HTTP 엔드포인트 (요청/응답 처리)
├── services/     # 비즈니스 로직
├── models/       # SQLAlchemy ORM 모델
├── schemas/      # Pydantic 검증 스키마
└── db.py         # 데이터베이스 세션 관리
```

### 3.3 AI 통합

LLM 서비스는 Provider 패턴으로 추상화됩니다.

```python
class LLMProvider(ABC):
    async def generate(self, prompt: str) -> str: ...

class AnthropicLLMProvider(LLMProvider): ...
class MockLLMProvider(LLMProvider): ...
```

환경변수 `LLM_PROVIDER`로 프로바이더 선택:
- `anthropic`: Claude API 사용
- `mock`: 개발/테스트용 모의 응답

## 4. 데이터베이스 설계

### 4.1 주요 테이블

- `users`: 사용자 계정
- `documents`: 문서 메타데이터
- `document_versions`: 문서 버전 내용
- `document_chunks`: 임베딩 벡터 (pgvector)
- `chat_sessions`, `chat_messages`: 대화 기록
- `feedback_reports`: 오류 제보
- `proposed_document_changes`: AI 수정 제안
- `approval_requests`: 승인 요청
- `notifications`: 사용자 알림

### 4.2 벡터 검색

pgvector 확장을 사용하여 1536차원 임베딩 벡터를 저장하고 코사인 유사도 검색을 수행합니다.

## 5. 보안

- JWT 토큰 기반 인증 (7일 만료)
- HTTPS 강제 (CloudFront HTTPS Only)
- CORS 화이트리스트 관리
- 환경변수로 민감 정보 관리 (.env 파일 미커밋)
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000006"),
        "title": "컨테이너 배포 가이드",
        "description": "Docker 및 AWS ECS Fargate 배포 절차를 안내합니다.",
        "trust_score": 0.88,
        "status": "active",
        "priority": "medium",
        "last_reviewed_at": "2026-05-05",
        "content": """# 컨테이너 배포 가이드

## 1. 사전 요구사항

- AWS CLI 설치 및 자격증명 설정
- Docker Desktop 설치
- 적절한 IAM 권한 (ECR, ECS, CloudFormation)

## 2. 로컬 환경 실행

### 2.1 전체 스택 실행

```bash
docker compose up --build
```

서비스 접근:
- 프론트엔드: http://localhost:5173
- 백엔드 API: http://localhost:8000
- API 문서: http://localhost:8000/docs

### 2.2 백엔드만 실행

```bash
docker compose up backend
```

### 2.3 환경변수 설정

`backend/.env` 파일을 생성하고 다음 값을 설정합니다.

```
DATABASE_URL=postgresql+asyncpg://docops:docops_dev@localhost:5600/docops
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxx
```

## 3. AWS ECR 이미지 빌드 및 푸시

```bash
ACCOUNT_ID=123456789012
REGION=ap-northeast-2

# ECR 로그인
aws ecr get-login-password --region $REGION | \
  docker login --username AWS \
  --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# 백엔드 이미지
docker build -t ma-backend ./backend
docker tag ma-backend:latest \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/manual-automation-backend:latest
docker push \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/manual-automation-backend:latest

# 프론트엔드 이미지
docker build -t ma-frontend ./frontend
docker tag ma-frontend:latest \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/manual-automation-frontend:latest
docker push \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/manual-automation-frontend:latest
```

## 4. ECS 태스크 정의 업데이트

```bash
# task-definition.json의 플레이스홀더 치환
sed -i "s/ACCOUNT_ID/$ACCOUNT_ID/g" infra/task-definition.json
sed -i "s/REGION/$REGION/g" infra/task-definition.json

# 태스크 정의 등록
aws ecs register-task-definition \
  --cli-input-json file://infra/task-definition.json
```

## 5. 데이터베이스 마이그레이션

배포 전 마이그레이션을 실행합니다.

```bash
# 로컬
cd backend && uv run alembic upgrade head

# 컨테이너에서
docker run --env-file backend/.env ma-backend \
  uv run alembic upgrade head
```

## 6. 롤백 절차

문제 발생 시 이전 버전으로 롤백합니다.

```bash
# 이전 태스크 정의 버전 확인
aws ecs list-task-definitions --family docops-backend

# 서비스 업데이트 (이전 버전으로)
aws ecs update-service \
  --cluster docops-cluster \
  --service docops-backend \
  --task-definition docops-backend:N  # N은 이전 버전 번호
```
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000007"),
        "title": "데이터베이스 스키마 설계서",
        "description": "PostgreSQL 데이터베이스 테이블 구조 및 관계를 정의합니다.",
        "trust_score": 0.73,
        "status": "active",
        "priority": "medium",
        "last_reviewed_at": "2026-03-10",
        "content": """# 데이터베이스 스키마 설계서

## 1. 개요

DocOps AI는 PostgreSQL 16을 사용하며, pgvector 확장을 통해 벡터 검색을 지원합니다.

## 2. ERD 개요

```
users
  ├── documents (owner_id)
  │     └── document_versions (document_id)
  │           └── document_chunks (document_version_id)
  ├── chat_sessions (user_id)
  │     └── chat_messages (session_id)
  │           └── answer_citations (message_id)
  └── feedback_reports (user_id)
        └── proposed_document_changes (feedback_report_id)
              └── approval_requests (proposed_change_id)
```

## 3. 테이블 상세

### 3.1 users

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | UUID | PK | 사용자 고유 ID |
| created_at | TIMESTAMPTZ | NOT NULL | 생성 시각 |
| updated_at | TIMESTAMPTZ | NOT NULL | 수정 시각 |
| name | VARCHAR(255) | NOT NULL | 이름 |
| email | VARCHAR(255) | UNIQUE, INDEX | 이메일 |
| role | VARCHAR(50) | DEFAULT 'user' | 역할 |
| department | VARCHAR(255) | NULL | 부서 |

### 3.2 documents

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | UUID | PK | 문서 ID |
| title | VARCHAR(500) | NOT NULL | 제목 |
| description | TEXT | NULL | 설명 |
| owner_id | UUID | FK(users) | 소유자 |
| current_version_id | UUID | FK(document_versions) | 현재 버전 |
| status | VARCHAR(50) | DEFAULT 'active' | 상태 |
| priority | VARCHAR(20) | DEFAULT 'medium' | 우선순위 |
| trust_score | FLOAT | DEFAULT 1.0 | 신뢰도 점수 |
| view_count | INT | DEFAULT 0 | 조회 수 |
| last_reviewed_at | VARCHAR(50) | NULL | 최근 검토일 |

### 3.3 document_versions

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | UUID | PK | 버전 ID |
| document_id | UUID | FK(documents), INDEX | 문서 ID |
| version_number | INT | NOT NULL | 버전 번호 |
| content | TEXT | NOT NULL | 내용 |
| created_by | UUID | NULL | 작성자 |
| change_summary | TEXT | NULL | 변경 요약 |

### 3.4 document_chunks

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | UUID | PK | 청크 ID |
| document_version_id | UUID | FK, INDEX | 버전 ID |
| chunk_index | INT | NOT NULL | 청크 순서 |
| content | TEXT | NOT NULL | 청크 내용 |
| embedding | VECTOR(1536) | NULL | 임베딩 벡터 |
| metadata | JSONB | NULL | 메타데이터 |

### 3.5 notifications

| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | UUID | PK | 알림 ID |
| user_id | UUID | FK(users), INDEX | 수신자 |
| type | VARCHAR(50) | NOT NULL | 알림 유형 |
| title | VARCHAR(255) | NOT NULL | 알림 제목 |
| message | TEXT | NOT NULL | 알림 내용 |
| document_id | UUID | NULL | 관련 문서 |
| is_read | BOOLEAN | DEFAULT FALSE | 읽음 여부 |

## 4. 인덱스 전략

- `documents.owner_id`: 사용자별 문서 조회
- `document_versions.document_id`: 문서 버전 히스토리
- `document_chunks.document_version_id`: 청크 검색
- `document_chunks.embedding`: IVFFlat (코사인 거리)
- `notifications.user_id`: 사용자별 알림 조회

## 5. 마이그레이션 관리

Alembic을 사용하여 스키마 변경을 관리합니다.

```bash
# 새 마이그레이션 생성
alembic revision --autogenerate -m "add notifications table"

# 마이그레이션 실행
alembic upgrade head

# 롤백
alembic downgrade -1
```
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000008"),
        "title": "보안 정책 및 가이드라인",
        "description": "DocOps AI 플랫폼의 보안 정책, 접근 제어, 취약점 관리 절차입니다.",
        "trust_score": 0.96,
        "status": "active",
        "priority": "high",
        "last_reviewed_at": "2026-05-16",
        "content": """# 보안 정책 및 가이드라인

## 1. 개요

본 문서는 DocOps AI 플랫폼의 보안 정책 및 개발자/운영자 준수 사항을 정의합니다.

## 2. 인증 및 권한 관리

### 2.1 JWT 토큰 정책

- 토큰 유효기간: 7일
- 알고리즘: HS256 (최소 256비트 시크릿 키)
- 토큰에 포함할 클레임: `sub` (user_id), `email`, `role`, `exp`
- **민감 정보 토큰 미포함**: 비밀번호 해시, 개인식별정보 금지

### 2.2 시크릿 키 관리

```bash
# 안전한 시크릿 키 생성
python -c "import secrets; print(secrets.token_hex(32))"
```

- `.env` 파일은 절대 Git에 커밋하지 않음
- 프로덕션 시크릿은 AWS Secrets Manager 또는 환경변수로 주입
- 키 순환: 6개월마다 (또는 유출 의심 시 즉시)

### 2.3 역할 기반 접근 제어 (RBAC)

| 역할 | 권한 |
|------|------|
| admin | 전체 문서 읽기/쓰기, 승인, 사용자 관리 |
| user | 본인 문서 읽기/쓰기, 오류 제보, Q&A |
| viewer | 문서 읽기 전용 |

## 3. API 보안

### 3.1 입력 검증

- 모든 입력은 Pydantic 스키마로 검증
- SQL Injection 방지: SQLAlchemy ORM 사용 (파라미터 바인딩)
- XSS 방지: 응답 데이터 이스케이프

### 3.2 HTTPS 적용

- 모든 프로덕션 트래픽은 HTTPS 강제
- TLS 1.2 이상 사용
- HSTS 헤더 설정

### 3.3 CORS 정책

```python
# 프로덕션: 허용 도메인 명시
allow_origins=["https://docops.yourcompany.com"]

# 개발: 모든 출처 허용 (프로덕션에서 절대 금지)
allow_origins=["*"]
```

## 4. 데이터 보호

### 4.1 민감 데이터 처리

- 비밀번호: bcrypt 해시 (현재 비밀번호 없는 로그인이므로 불필요)
- API 키: 환경변수 또는 Secrets Manager, 로그 미출력
- 개인정보: 최소 수집 원칙

### 4.2 데이터 암호화

- 전송 중: TLS 1.3
- 저장 시: RDS 암호화 활성화, S3 SSE-S3

## 5. 취약점 관리

### 5.1 의존성 업데이트

```bash
# Python 의존성 취약점 확인
pip-audit

# Node.js 의존성 취약점 확인
pnpm audit
```

### 5.2 보안 점검 주기

- 의존성 취약점: 주 1회 자동 스캔
- 코드 리뷰: 모든 PR에 보안 체크리스트
- 침투 테스트: 분기 1회

## 6. 인시던트 대응

1. 보안 이슈 발견 → security@docops.ai 즉시 보고
2. 영향 범위 평가 (30분 이내)
3. 긴급 패치 또는 서비스 중단 결정
4. 사후 분석 보고서 작성
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000009"),
        "title": "품질 보증 테스트 계획서",
        "description": "단위 테스트, 통합 테스트, E2E 테스트 전략 및 기준을 정의합니다.",
        "trust_score": 0.82,
        "status": "active",
        "priority": "medium",
        "last_reviewed_at": "2026-04-28",
        "content": """# 품질 보증 테스트 계획서

## 1. 테스트 전략 개요

DocOps AI는 3계층 테스트 전략을 적용합니다.

```
E2E 테스트 (Playwright)       ← 사용자 시나리오 검증
      ↑
통합 테스트 (pytest + httpx)   ← API 엔드포인트 검증
      ↑
단위 테스트 (pytest)           ← 서비스/유틸리티 로직
```

## 2. 백엔드 테스트

### 2.1 단위 테스트

테스트 대상:
- `chunking_service.split_text()`: 텍스트 청킹 로직
- `trust_service.calculate_trust_score()`: 신뢰도 계산
- Pydantic 스키마 검증

실행:
```bash
cd backend && uv run pytest tests/ -v
```

### 2.2 통합 테스트

테스트 대상:
- 모든 API 엔드포인트 (CRUD)
- 데이터베이스 트랜잭션
- 인증/인가 흐름

테스트 환경:
- 격리된 테스트 데이터베이스 (SQLite in-memory)
- Mock LLM Provider

```python
@pytest.mark.asyncio
async def test_create_document(client, test_user):
    response = await client.post("/api/documents", json={
        "title": "테스트 문서",
        "owner_id": str(test_user["id"])
    }, params={"content": "테스트 내용"})
    assert response.status_code == 201
    assert response.json()["title"] == "테스트 문서"
```

## 3. 프론트엔드 E2E 테스트

### 3.1 Playwright 설정

```bash
# 테스트 실행
cd frontend && pnpm exec playwright test

# UI 모드
pnpm exec playwright test --ui

# 특정 파일만
pnpm exec playwright test e2e/documents.spec.ts
```

### 3.2 테스트 시나리오

| 파일 | 시나리오 |
|------|---------|
| `navigation.spec.ts` | 사이드바 네비게이션, 대시보드 로드 |
| `documents.spec.ts` | 문서 생성, 검색, 상세 보기 |
| `chat.spec.ts` | 챗 세션 생성, 메시지 전송 |
| `ux-walkthrough.spec.ts` | PM/현업 사용자 전체 플로우 |

### 3.3 테스트 데이터 관리

E2E 테스트는 실제 백엔드 API를 호출합니다. 테스트 격리를 위해:
- 각 테스트에서 고유한 제목 생성 (`Date.now()` 포함)
- 인증이 필요한 테스트는 `beforeEach`에서 localStorage에 토큰 주입

```typescript
test.beforeEach(async ({ page }) => {
  // JWT 토큰 주입으로 로그인 페이지 스킵
  await page.goto('/login')
  await page.evaluate((token) => {
    localStorage.setItem('auth_token', token)
  }, process.env.TEST_TOKEN || 'demo-token')
})
```

## 4. 커버리지 목표

| 레이어 | 목표 커버리지 |
|--------|-------------|
| 백엔드 서비스 | 80% 이상 |
| API 엔드포인트 | 90% 이상 |
| E2E 핵심 플로우 | 100% |

## 5. CI/CD 통합

```yaml
# GitHub Actions (예시)
- name: Backend Tests
  run: cd backend && uv run pytest

- name: Frontend E2E
  run: |
    cd frontend && pnpm exec playwright install --with-deps
    pnpm exec playwright test
```
""",
    },
    {
        "id": uuid.UUID("10000000-0000-0000-0000-000000000010"),
        "title": "문서 변경 이력 관리 절차서",
        "description": "문서 수정, 버전 관리, 변경 승인 프로세스를 정의합니다.",
        "trust_score": 0.69,
        "status": "active",
        "priority": "low",
        "last_reviewed_at": "2026-02-14",
        "content": """# 문서 변경 이력 관리 절차서

## 1. 목적

본 절차서는 DocOps AI 플랫폼 내 문서의 변경 이력을 체계적으로 관리하여 정보의 정확성과 추적성을 확보하는 것을 목적으로 합니다.

## 2. 용어 정의

| 용어 | 정의 |
|------|------|
| 버전 | 문서의 특정 시점 스냅샷 |
| 수정 제안 | AI 또는 사용자가 제안하는 문서 변경 내용 |
| 승인 요청 | 수정 제안의 반영을 위한 검토 요청 |
| 오류 제보 | 문서의 잘못된 정보에 대한 신고 |

## 3. 변경 관리 프로세스

### 3.1 일반 수정 (작성자 직접 수정)

```
문서 작성자가 내용 수정
        ↓
시스템이 자동으로 새 버전 생성 (버전 번호 +1)
        ↓
변경 내용이 버전 히스토리에 기록됨
        ↓
문서 신뢰도 점수 재계산
```

### 3.2 오류 제보 기반 수정

```
사용자가 오류 제보 제출
        ↓
AI가 오류를 분석하여 수정 제안 생성
        ↓
문서 소유자에게 알림 발송
        ↓
관리자가 수정 제안 검토
        ↓
승인: 새 버전에 자동 반영
반려: 제보자에게 사유 전달
```

## 4. 버전 번호 체계

버전은 단순 증가 정수를 사용합니다 (1, 2, 3, ...).

주요 변경 시에는 `change_summary` 필드에 변경 내용을 기록합니다.

```
v1: 최초 작성
v2: 2.3절 신규 기능 추가 (알림 시스템)
v3: 오타 수정 - "완룔" → "완료"
```

## 5. 보존 정책

- 모든 버전 영구 보존 (삭제 불가)
- 30개 이상 버전은 아카이브 처리 (조회 가능, 기본 미표시)

## 6. 감사 추적

다음 사항은 시스템 로그에 자동 기록됩니다.

- 문서 생성 (작성자, 일시)
- 버전 생성 (수정자, 일시, 변경 요약)
- 승인/반려 이력 (결정자, 일시, 사유)
- 오류 제보 (제보자, 일시, 내용)

## 7. 검토 주기

| 문서 유형 | 검토 주기 | 담당자 |
|---------|---------|------|
| 사용자 메뉴얼 | 분기 1회 | 서비스팀 |
| 기술 문서 | 반기 1회 | 개발팀 |
| 정책 문서 | 연 1회 | 관리팀 |
| 긴급 공지 | 수시 | 운영팀 |

6개월 이상 검토되지 않은 문서는 신뢰도 점수에 패널티가 적용됩니다.

## 8. 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|------|---------|
| 1.0 | 2026-02-14 | 운영팀 | 최초 작성 |
""",
    },
]


async def seed_documents(db: AsyncSession) -> None:
    for doc_data in SEED_DOCUMENTS:
        existing = await db.execute(
            select(Document).where(Document.id == doc_data["id"])
        )
        if existing.scalar_one_or_none():
            continue

        doc_id = doc_data["id"]
        version_id = uuid.uuid4()

        doc = Document(
            id=doc_id,
            title=doc_data["title"],
            description=doc_data["description"],
            owner_id=DEMO_USER_ID,
            status=doc_data["status"],
            priority=doc_data["priority"],
            trust_score=doc_data["trust_score"],
            last_reviewed_at=doc_data["last_reviewed_at"],
        )
        db.add(doc)
        await db.flush()

        version = DocumentVersion(
            id=version_id,
            document_id=doc_id,
            version_number=1,
            content=doc_data["content"],
            created_by=DEMO_USER_ID,
            change_summary="최초 작성",
        )
        db.add(version)
        await db.flush()

        doc.current_version_id = version_id
        await db.commit()

        print(f"  Created document: {doc_data['title']}")


SEED_CHAT_SESSION_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")
SEED_FEEDBACK_IDS = [
    uuid.UUID("30000000-0000-0000-0000-000000000001"),
    uuid.UUID("30000000-0000-0000-0000-000000000002"),
    uuid.UUID("30000000-0000-0000-0000-000000000003"),
]


async def seed_chat(db: AsyncSession) -> None:
    existing = await db.execute(select(ChatSession).where(ChatSession.id == SEED_CHAT_SESSION_ID))
    if existing.scalar_one_or_none():
        return

    session = ChatSession(
        id=SEED_CHAT_SESSION_ID,
        user_id=DEMO_USER_ID,
        title="신뢰도 점수 계산 방식 문의",
    )
    db.add(session)
    await db.flush()

    messages = [
        ChatMessage(
            id=uuid.UUID("20000000-0000-0000-0000-000000000011"),
            session_id=SEED_CHAT_SESSION_ID,
            role="user",
            content="신뢰도 점수는 어떻게 계산되나요?",
        ),
        ChatMessage(
            id=uuid.UUID("20000000-0000-0000-0000-000000000012"),
            session_id=SEED_CHAT_SESSION_ID,
            role="assistant",
            content="신뢰도 점수는 0~1 사이의 값으로, 문서의 최근성(last_reviewed_at 기준), 오류 제보 반영 여부, 버전 업데이트 빈도를 종합하여 산출됩니다. 0.8 이상이면 신뢰할 수 있는 문서, 0.7 미만이면 검토가 필요한 문서로 간주합니다.",
        ),
        ChatMessage(
            id=uuid.UUID("20000000-0000-0000-0000-000000000013"),
            session_id=SEED_CHAT_SESSION_ID,
            role="user",
            content="신뢰도가 낮은 문서는 어떻게 처리하나요?",
        ),
        ChatMessage(
            id=uuid.UUID("20000000-0000-0000-0000-000000000014"),
            session_id=SEED_CHAT_SESSION_ID,
            role="assistant",
            content="신뢰도 0.7 미만 문서는 Q&A 답변 시 '주의' 경고가 표시됩니다. 문서 관리 페이지에서 해당 문서를 선택 후 '신뢰도 재계산' 버튼을 클릭하거나, 오류 제보를 통해 수정 후 승인하면 점수가 자동 갱신됩니다.",
        ),
    ]
    for msg in messages:
        db.add(msg)

    await db.commit()
    print("  Created seed chat session")


async def seed_feedback(db: AsyncSession) -> None:
    existing = await db.execute(select(FeedbackReport).where(FeedbackReport.id == SEED_FEEDBACK_IDS[0]))
    if existing.scalar_one_or_none():
        return

    doc_id_1 = uuid.UUID("10000000-0000-0000-0000-000000000004")
    doc_id_2 = uuid.UUID("10000000-0000-0000-0000-000000000008")

    feedbacks = [
        FeedbackReport(
            id=SEED_FEEDBACK_IDS[0],
            user_id=DEMO_USER_ID,
            document_id=doc_id_1,
            feedback_text="운영 가이드에서 Docker 배포 명령어가 최신 버전과 맞지 않습니다. `docker push` 이전에 `docker tag` 명령도 필요한데 누락되어 있습니다.",
            status="processed",
        ),
        FeedbackReport(
            id=SEED_FEEDBACK_IDS[1],
            user_id=DEMO_USER_ID,
            document_id=doc_id_2,
            feedback_text="보안 정책 문서의 세션 만료 시간이 '24시간'으로 기재되어 있는데 실제 구현은 7일(168시간)입니다. 문서를 수정해주세요.",
            status="pending",
        ),
        FeedbackReport(
            id=SEED_FEEDBACK_IDS[2],
            user_id=DEMO_USER_ID,
            document_id=None,
            feedback_text="전반적으로 API 명세서에 페이지네이션 관련 파라미터 설명이 부족합니다. skip/limit 외에도 정렬 옵션이 있으면 좋겠습니다.",
            status="pending",
        ),
    ]
    for fb in feedbacks:
        db.add(fb)

    await db.commit()
    print("  Created seed feedback reports")


async def seed():
    async with SessionLocal() as db:
        result = await db.execute(select(User).where(User.id == DEMO_USER_ID))
        user = result.scalar_one_or_none()
        if not user:
            user = User(
                id=DEMO_USER_ID,
                name="Demo Admin",
                email="admin@docops.ai",
                role="admin",
                department="Engineering",
            )
            db.add(user)
            await db.commit()
            print(f"Created demo user: admin@docops.ai")
        else:
            print("Demo user already exists")

    async with SessionLocal() as db:
        print("Seeding documents...")
        await seed_documents(db)

    async with SessionLocal() as db:
        print("Seeding chat history...")
        await seed_chat(db)

    async with SessionLocal() as db:
        print("Seeding feedback reports...")
        await seed_feedback(db)

    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
