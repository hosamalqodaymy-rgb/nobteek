#!/usr/bin/env bash
set -euo pipefail

[[ "${NOBTEEK_PREVIEW_ACCESS:-}" =~ ^[0-9a-f]{64}$ ]]
[[ "${NOBTEEK_BROWSER_PASSWORD:-}" =~ ^[0-9a-f]{28}$ ]]
[[ "${NOBTEEK_BROWSER_MFA_SECRET:-}" =~ ^[A-Z2-7]{32}$ ]]
[[ "${APP_KEY:-}" == base64:* ]]
[[ "${RENDER_EXTERNAL_URL:-}" == https://*.onrender.com ]]

export APP_URL="$RENDER_EXTERNAL_URL" APP_ENV=testing APP_DEBUG=false
export DB_CONNECTION=pgsql DB_DATABASE=nobteek_test_browser DB_HOST=/run/postgresql
export DB_PORT=5432 DB_USERNAME=www-data DB_PASSWORD= DB_URL=
export NOBTEEK_DEMO_SEED=true SESSION_DRIVER=file SESSION_SECURE_COOKIE=true
export NOBTEEK_MANUAL_BILLING=true NOBTEEK_BILLING_PILOT=true NOBTEEK_BILLING_ENFORCE_ACCESS=false
export NOBTEEK_BILLING_PILOT_CLINIC_ID=10101923-eeb8-5aba-9627-57be7229cf49
export NOBTEEK_BILLING_RECIPIENT='مستلم تجريبي في نوبتيك'
export NOBTEEK_BILLING_KURAIMI_NUMBER=0000000001 NOBTEEK_BILLING_KURAIMI_CURRENCIES=YER,SAR,USD
export NOBTEEK_BILLING_JEEB_NUMBER=0000000001 NOBTEEK_BILLING_JEEB_CURRENCIES=YER,SAR,USD
export NOBTEEK_BILLING_FLOUSAK_NUMBER=0000000001 NOBTEEK_BILLING_FLOUSAK_CURRENCIES=YER,SAR,USD
export NOBTEEK_BILLING_JAWALI_NUMBER=0000000001 NOBTEEK_BILLING_JAWALI_CURRENCIES=YER,SAR,USD
export CACHE_STORE=file QUEUE_CONNECTION=sync MAIL_MAILER=array
export LOG_CHANNEL=stderr LOG_LEVEL=critical BCRYPT_ROUNDS=4 ARGON_MEMORY=1024 ARGON_TIME=1
export NOBTEEK_BROWSER_CLOCK
NOBTEEK_BROWSER_CLOCK="$(date -u '+%Y-%m-%dT%H:%M:00Z')"

pg_bin=/usr/lib/postgresql/17/bin
pg_data=/var/lib/postgresql/dhamar-qa
install -d -m 0755 -o postgres -g postgres /run/postgresql
install -d -m 0700 -o postgres -g postgres "$pg_data"
if [[ ! -s "$pg_data/PG_VERSION" ]]; then
    runuser -u postgres -- "$pg_bin/initdb" -D "$pg_data" --auth-local=peer --auth-host=reject --locale=C.UTF-8 > /dev/null
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
if [[ "$(runuser -u www-data -- "$pg_bin/psql" -XAt -d nobteek_test_browser -c 'SELECT COUNT(*) FROM clinics')" == 0 ]]; then
    runuser -u www-data -- php artisan db:seed --force --no-interaction
fi
runuser -u www-data -- php ../tools/prepare_dhamar_qa.php
[[ "$(runuser -u www-data -- "$pg_bin/psql" -XAt -d nobteek_test_browser -c "SELECT COUNT(*) FROM users WHERE login_enabled AND username IN ('demo_platform','demo_owner_a','demo_owner_b','demo_reception_a','demo_reception_b','demo_doctor_a','demo_doctor_b','demo_doctor_c')")" == 8 ]]

[[ "$(runuser -u www-data -- "$pg_bin/psql" -XAt -d nobteek_test_browser -c "SELECT COUNT(*) FROM clinics WHERE city = 'ذمار'")" == 2 ]]
[[ "$(runuser -u www-data -- "$pg_bin/psql" -XAt -d nobteek_test_browser -c "SELECT COUNT(*) FROM clinic_sessions WHERE ends_at > CURRENT_TIMESTAMP")" -ge 21 ]]

export APP_ENV=production NOBTEEK_DEMO_SEED=false
sed -i 's/^Listen 80$/Listen 10000/' /etc/apache2/ports.conf
sed -i "s/__QA_ACCESS_MARKER__/$NOBTEEK_PREVIEW_ACCESS/" /etc/apache2/sites-available/000-default.conf
apache2ctl -t
exec apache2-foreground
