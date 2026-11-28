<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE users ADD COLUMN community_role varchar(16)
                CHECK (community_role IN ('patient', 'support'));
            CREATE TABLE community_commands (
                user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                command_id uuid NOT NULL,
                fingerprint char(64) NOT NULL,
                result_id uuid NOT NULL,
                created_at timestamptz NOT NULL,
                PRIMARY KEY (user_id, command_id)
            );
            CREATE TABLE community_support_tickets (
                id uuid PRIMARY KEY,
                patient_id uuid NOT NULL REFERENCES users(id),
                assignee_id uuid REFERENCES users(id),
                topic varchar(24) NOT NULL CHECK (topic IN ('booking', 'account', 'clinic', 'subscription', 'technical', 'other')),
                subject varchar(80) NOT NULL,
                reference varchar(60),
                state varchar(12) NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL
            );
            CREATE INDEX community_support_owner ON community_support_tickets (patient_id, updated_at DESC, id);
            CREATE INDEX community_support_desk ON community_support_tickets (assignee_id, updated_at DESC, id);
            CREATE TABLE community_support_messages (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                ticket_id uuid NOT NULL REFERENCES community_support_tickets(id) ON DELETE CASCADE,
                author_id uuid NOT NULL REFERENCES users(id),
                author_role varchar(12) NOT NULL CHECK (author_role IN ('patient', 'support')),
                body varchar(1000) NOT NULL,
                created_at timestamptz NOT NULL
            );
            CREATE INDEX community_support_thread ON community_support_messages (ticket_id, id);
            SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP TABLE community_support_messages, community_support_tickets, community_commands; ALTER TABLE users DROP COLUMN community_role;');
    }
};
