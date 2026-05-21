# Manual Automation

웹 애플리케이션 프로젝트.

## Language

- 모든 응답은 한국어로 작성한다.

## Tech Stack

- **Frontend**: React + Vite (TypeScript)
- **Backend**: Python FastAPI
- **Package Manager**: pnpm (frontend), uv (backend)

## Project Structure

```text
frontend/    - React + Vite SPA
backend/     - FastAPI server
infra/       - AWS/Terraform deployment
```

## Development Commands

```bash
# Frontend
cd frontend && pnpm dev
cd frontend && pnpm build
cd frontend && pnpm lint
cd frontend && pnpm typecheck

# Backend
cd backend && uv run fastapi dev
cd backend && uv run pytest
cd backend && uv run ruff check
cd backend && uv run mypy .
```

## Deployment

- GitHub Actions workflow: `.github/workflows/deploy-aws.yml`
- Push to `main`, `master`, or `aws` triggers AWS deployment.
- Terraform stack: `infra/terraform`
- Runtime: AWS ECS Fargate behind an ALB.
- Images are built from the root `Dockerfile` and pushed to ECR.
- Terraform also manages RDS PostgreSQL, S3 uploads bucket, Secrets Manager, IAM, logs, and networking.
- Latest deployed URL is recorded in `infra/terraform/last-deployment-url.txt`.

## Storage and DB Notes

- Document uploads must be stored in S3. There is no local upload fallback.
- `UPLOADS_S3_BUCKET` is required for upload handling.
- `UPLOADS_S3_PREFIX` defaults to `uploads`.
- DB migrations include pgvector support for `document_chunks.embedding`.
- Production Bedrock embeddings use `BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v1` to match the 1536-dimension pgvector column.

## Harness Policy

모든 비자명한 작업은 `HARNESS.md`의 실행 루프를 따른다.
DESIGN -> PLAN -> BUILD -> VERIFY -> SHIP

## Conventions

- Commit messages: imperative mood, concise
- Branch naming: `feat/`, `fix/`, `refactor/` prefixes
- Frontend: functional components, hooks pattern
- Backend: async endpoints, Pydantic models for validation
- Tests required for business logic

## Coding Guidelines

- 최소 변경으로 요청한 문제만 해결한다.
- 기존 스타일과 구조를 우선한다.
- 관련 없는 리팩터링이나 포맷 변경은 하지 않는다.
- 불확실한 점이 배포나 데이터에 영향을 주면 먼저 명확히 확인한다.
- 변경 후 가능한 범위에서 빌드, 테스트, 또는 배포 상태를 검증한다.
