#!/usr/bin/env bash
set -euo pipefail

[[ "${RENDER_EXTERNAL_URL:-}" =~ ^https://[a-z0-9-]+\.onrender\.com$ ]]
[[ "${APP_KEY:-}" =~ ^base64:[A-Za-z0-9+/=]{44}$ ]]
[[ "${NOBTEEK_QA_ENTRY_CODE:-}" =~ ^[A-Za-z0-9_-]{16,64}$ ]]
[[ "${NOBTEEK_QA_PATIENT_PASSWORD:-}" =~ ^[A-Za-z0-9_-]{16,64}$ ]]
[[ "${NOBTEEK_BROWSER_PASSWORD:-}" =~ ^[A-Za-z0-9_-]{24,64}$ ]]
[[ "${NOBTEEK_BROWSER_MFA_SECRET:-}" =~ ^[A-Z2-7]{32}$ ]]
[[ "${PORT:-10000}" =~ ^[0-9]{4,5}$ ]]
export PORT="${PORT:-10000}"

export APP_URL="$RENDER_EXTERNAL_URL" APP_ENV=testing APP_DEBUG=false
export NOBTEEK_CONNECTED_PREVIEW_ORIGIN="$APP_URL"
export NOBTEEK_COMMUNITY_ENABLED=true NOBTEEK_DEMO_SEED=true
export DB_CONNECTION=pgsql DB_DATABASE=nobteek_test_browser DB_HOST=/run/postgresql
export DB_PORT=5432 DB_USERNAME=www-data DB_PASSWORD= DB_URL=
export SESSION_DRIVER=file SESSION_SECURE_COOKIE=true CACHE_STORE=file QUEUE_CONNECTION=sync MAIL_MAILER=array
export NOBTEEK_BILLING_PILOT=false NOBTEEK_BILLING_ENFORCE_ACCESS=false NOBTEEK_MANUAL_BILLING=false
export LOG_CHANNEL=stderr LOG_LEVEL=error ARGON_MEMORY=16384 ARGON_TIME=3
export NOBTEEK_BROWSER_CLOCK
NOBTEEK_BROWSER_CLOCK="$(date -u '+%Y-%m-%dT%H:%M:00Z')"

pg_bin=/usr/lib/postgresql/17/bin
pg_data=/var/lib/postgresql/nobteek-qa
install -d -m 0755 -o postgres -g postgres /run/postgresql
install -d -m 0700 -o postgres -g postgres "$pg_data"
if [[ ! -s "$pg_data/PG_VERSION" ]]; then
    runuser -u postgres -- "$pg_bin/initdb" -D "$pg_data" --auth-local=peer --auth-host=reject --locale=C.UTF-8 >/dev/null
fi
runuser -u postgres -- "$pg_bin/pg_ctl" -D "$pg_data" -l "$pg_data/server.log" \
    -o "-c listen_addresses= -k /run/postgresql -c shared_buffers=32MB -c max_connections=20" -w start

if [[ "$(runuser -u postgres -- "$pg_bin/psql" -XAt -d postgres -c "SELECT COUNT(*) FROM pg_roles WHERE rolname = 'www-data'")" == 0 ]]; then
    runuser -u postgres -- "$pg_bin/createuser" --no-superuser --no-createdb --no-createrole -- www-data
fi
if [[ "$(runuser -u postgres -- "$pg_bin/psql" -XAt -d postgres -c "SELECT COUNT(*) FROM pg_database WHERE datname = 'nobteek_test_browser'")" == 0 ]]; then
    runuser -u postgres -- "$pg_bin/createdb" --owner=www-data nobteek_test_browser
fi
runuser -u www-data -- php artisan migrate --force --no-interaction
if [[ "$(runuser -u www-data -- "$pg_bin/psql" -XAt -d nobteek_test_browser -c "SELECT COUNT(*) FROM clinics")" == 0 ]]; then
    runuser -u www-data -- php artisan db:seed --force --no-interaction
fi
runuser -u www-data -- php ../tools/prepare_connected_preview.php

sed -i "s/^Listen 80$/Listen $PORT/" /etc/apache2/ports.conf
sed -i "s/__PORT__/$PORT/" /etc/apache2/sites-available/000-default.conf
apache2ctl -t
exec apache2-foreground
