<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
ALTER TABLE users ADD COLUMN security_version bigint NOT NULL DEFAULT 1 CHECK(security_version > 0),
 ADD COLUMN access_suspended boolean NOT NULL DEFAULT false,
 ADD COLUMN mfa_secret text, ADD COLUMN mfa_pending_secret text,
 ADD COLUMN mfa_pending_until timestamptz, ADD COLUMN mfa_confirmed_at timestamptz,
 ADD COLUMN mfa_last_step bigint, ADD COLUMN recovery_digest char(64), ADD COLUMN recovery_issued_at timestamptz;
ALTER TABLE patients ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version > 0);
CREATE TABLE security_events (
 id uuid PRIMARY KEY, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL, clinic_id uuid REFERENCES clinics(id),
 event_type varchar(80) NOT NULL, at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 request_id uuid NOT NULL, ip_digest char(64), safe_context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX security_events_subject_time ON security_events(subject_user_id,at);
CREATE INDEX security_events_clinic_time ON security_events(clinic_id,at);
CREATE TABLE account_grants (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, clinic_id uuid REFERENCES clinics(id),
 token_digest char(64) NOT NULL UNIQUE, purpose varchar(16) NOT NULL CHECK(purpose IN('activation','recovery')),
 security_version bigint NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX account_grants_user ON account_grants(user_id);
SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS account_grants,security_events');
        DB::statement('ALTER TABLE patients DROP COLUMN version');
        DB::statement('ALTER TABLE users DROP COLUMN security_version, DROP COLUMN access_suspended, DROP COLUMN mfa_secret, DROP COLUMN mfa_pending_secret, DROP COLUMN mfa_pending_until, DROP COLUMN mfa_confirmed_at, DROP COLUMN mfa_last_step, DROP COLUMN recovery_digest, DROP COLUMN recovery_issued_at');
    }
};
