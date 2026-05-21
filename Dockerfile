##############################################
# Stage 1: Frontend build
##############################################
FROM node:22-slim AS frontend-build

WORKDIR /app
ENV CI=true
RUN corepack enable pnpm
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile || (pnpm approve-builds --all && pnpm install --frozen-lockfile)
COPY frontend/ .
RUN pnpm build

##############################################
# Stage 2: Runtime (Python + Nginx + Supervisor)
##############################################
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx curl supervisor gettext-base \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

RUN uv run playwright install --with-deps chromium chromium-headless-shell

COPY backend/app/ app/
COPY backend/alembic/ alembic/
COPY backend/alembic.ini ./
COPY backend/scripts/ scripts/
RUN mkdir -p uploads

COPY --from=frontend-build /app/dist /usr/share/nginx/html

COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENV LLM_PROVIDER=bedrock \
    EMBEDDING_MODEL=bedrock \
    AWS_REGION=us-east-1

ENTRYPOINT ["/entrypoint.sh"]
