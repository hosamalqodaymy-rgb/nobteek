<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            throw new RuntimeException('Nobteek requires PostgreSQL.');
        }
        DB::unprepared(file_get_contents(database_path('schema/0001_foundation.sql')));
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS command_replays,outbox_messages,audit_events,ticket_tokens,visits,bookings,patients,arrival_windows,clinic_sessions,doctors,memberships,clinics,users CASCADE');
        DB::statement('DROP FUNCTION IF EXISTS nobteek_check_window_bounds()');
    }
};
