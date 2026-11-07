<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE booking_guests (
 id uuid PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at timestamptz NOT NULL,
 CHECK(expires_at > created_at)
);
ALTER TABLE audit_events ALTER COLUMN actor_membership_id DROP NOT NULL;
ALTER TABLE audit_events ADD COLUMN actor_kind varchar(16) NOT NULL DEFAULT 'staff';
ALTER TABLE audit_events ADD COLUMN guest_id uuid REFERENCES booking_guests(id);
ALTER TABLE audit_events ADD CONSTRAINT audit_actor_is_explicit CHECK (
 (actor_kind='staff' AND actor_membership_id IS NOT NULL AND guest_id IS NULL) OR
 (actor_kind='guest' AND actor_membership_id IS NULL AND guest_id IS NOT NULL)
);
CREATE INDEX bookings_window_state_index ON bookings(clinic_id,window_id,state);
CREATE INDEX booking_guests_expiry_index ON booking_guests(expires_at);
SQL);
    }

    public function down(): void
    {
        if (DB::table('audit_events')->where('actor_kind', 'guest')->exists()) {
            throw new RuntimeException('Guest audit events must be retained. Restore a reviewed backup instead of discarding them.');
        }
        DB::unprepared(<<<'SQL'
DROP INDEX bookings_window_state_index;
ALTER TABLE audit_events DROP CONSTRAINT audit_actor_is_explicit;
ALTER TABLE audit_events DROP COLUMN guest_id;
ALTER TABLE audit_events DROP COLUMN actor_kind;
ALTER TABLE audit_events ALTER COLUMN actor_membership_id SET NOT NULL;
DROP TABLE booking_guests;
SQL);
    }
};
