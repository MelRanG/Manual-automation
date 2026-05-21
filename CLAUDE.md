# Manual Automation

웹 애플리케이션 프로젝트.

## Language

- 모든 응답은 한국어로 작성한다.

## Tech Stack

- **Frontend**: React + Vite (TypeScript)
- **Backend**: Python FastAPI
- **Package Manager**: pnpm (frontend), uv (backend)

## Project Structure

```
frontend/    — React + Vite SPA
backend/     — FastAPI server
```

## Development Commands

```bash
# Frontend
cd frontend && pnpm dev        # dev server (port 5173)
cd frontend && pnpm build      # production build
cd frontend && pnpm lint       # eslint
cd frontend && pnpm typecheck  # tsc --noEmit

# Backend
cd backend && uv run fastapi dev  # dev server (port 8000)
cd backend && uv run pytest       # tests
cd backend && uv run ruff check   # lint
cd backend && uv run mypy .       # type check
```

## Docker

```bash
docker compose up --build          # 로컬 전체 실행
docker compose up backend          # 백엔드만
docker build -t ma-backend ./backend
docker build -t ma-frontend ./frontend
```

## Deployment (ECS Fargate)

- ECR 리포: `manual-automation-backend`, `manual-automation-frontend`
- Task definition 템플릿: `infra/task-definition.json`
- ACCOUNT_ID, REGION 플레이스홀더를 실제 값으로 교체 후 사용

## Harness Policy

모든 비자명한 작업은 `HARNESS.md`의 실행 루프를 따른다.
DESIGN → PLAN → BUILD → VERIFY → SHIP

## Conventions

- Commit messages: imperative mood, concise
- Branch naming: `feat/`, `fix/`, `refactor/` prefixes
- Frontend: functional components, hooks pattern
- Backend: async endpoints, Pydantic models for validation
- Tests required for business logic


Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Current AWS Deployment

- GitHub Actions workflow: `.github/workflows/deploy-aws.yml`
- Push to `main`, `master`, or `aws` deploys through Terraform to ECS Fargate.
- Terraform stack lives in `infra/terraform` and manages ECS, ECR, RDS PostgreSQL, S3 uploads, Secrets Manager, IAM, logs, and networking.
- Document uploads are S3-only. `UPLOADS_S3_BUCKET` is required; there is no local upload fallback.
- DB migrations include pgvector support for `document_chunks.embedding`.
- Production Bedrock embeddings use `BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v1` to match the 1536-dimension pgvector column.
- Latest deployed ALB URL is stored in `infra/terraform/last-deployment-url.txt`.
