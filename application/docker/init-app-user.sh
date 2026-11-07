#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set app_user="$NOBTEEK_APP_USER" --set app_database="$NOBTEEK_APP_DATABASE" \
  --set app_password="$POSTGRES_PASSWORD" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE :"app_database" OWNER :"app_user";
REVOKE CONNECT ON DATABASE :"app_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_database" TO :"app_user";
SQL
