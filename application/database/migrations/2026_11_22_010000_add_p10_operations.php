<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE notification_simulations (
 id uuid PRIMARY KEY,
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 event_id uuid NOT NULL,
 channel varchar(20) NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
 status varchar(32) NOT NULL DEFAULT 'simulated_not_sent' CHECK (status = 'simulated_not_sent'),
 simulated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor_membership_id uuid NOT NULL,
 UNIQUE (event_id,channel),
 FOREIGN KEY (clinic_id,event_id) REFERENCES audit_events(clinic_id,id),
 FOREIGN KEY (clinic_id,actor_membership_id) REFERENCES memberships(clinic_id,id)
);
CREATE INDEX notification_simulations_clinic_time ON notification_simulations(clinic_id,simulated_at);
CREATE TABLE support_requests (
 id uuid PRIMARY KEY,
 clinic_id uuid NOT NULL REFERENCES clinics(id),
 category varchar(32) NOT NULL CHECK (category IN ('access','schedule','technical','other')),
 state varchar(20) NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 opened_by_membership_id uuid NOT NULL,
 opened_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at timestamptz,
 resolved_by_user_id uuid REFERENCES users(id),
 UNIQUE (clinic_id,id),
 FOREIGN KEY (clinic_id,opened_by_membership_id) REFERENCES memberships(clinic_id,id),
 CHECK ((state='open' AND resolved_at IS NULL AND resolved_by_user_id IS NULL) OR
        (state='resolved' AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL))
);
CREATE INDEX support_requests_clinic_state ON support_requests(clinic_id,state,opened_at);
SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS support_requests,notification_simulations');
    }
};
