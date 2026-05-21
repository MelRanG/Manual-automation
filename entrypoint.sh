#!/bin/bash
set -e

# One-off 작업 모드: ECS run-task에서 containerOverrides.command로 호출.
# 예) ["reembed", "--batch-size", "32"]
if [ "$1" = "reembed" ]; then
  shift
  cd /app
  exec /app/.venv/bin/python scripts/reembed_chunks.py "$@"
fi

export BACKEND_HOST=127.0.0.1

envsubst '${BACKEND_HOST}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

rm -f /etc/nginx/sites-enabled/default

cd /app
/app/.venv/bin/alembic upgrade head

exec supervisord -c /etc/supervisord.conf
