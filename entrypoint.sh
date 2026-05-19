#!/bin/bash
set -e

export BACKEND_HOST=127.0.0.1

envsubst '${BACKEND_HOST}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

rm -f /etc/nginx/sites-enabled/default

cd /app
/app/.venv/bin/alembic upgrade head

exec supervisord -c /etc/supervisord.conf
