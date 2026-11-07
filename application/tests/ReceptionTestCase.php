<?php

namespace Tests;

use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

abstract class ReceptionTestCase extends ClinicOperationsTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->owner();
        $this->user('DOCTOR_C');
    }

    protected function arrival(?string $booking = null, int $version = 1, ?string $key = null): TestResponse
    {
        return $this->postJson('/v1/bookings/'.($booking ?? $this->id('BOOK_C1')).'/check-in', [], $this->headers($version, $key));
    }

    protected function visitCommand(string $visit, string $command, int $version = 1, ?string $key = null, ?string $reason = null): TestResponse
    {
        $reasons = ['mark-away' => 'temporarily_absent', 'return' => 'patient_returned', 'leave' => 'patient_left', 'defer' => 'administrative_correction'];

        return $this->postJson('/v1/visits/'.$visit.'/'.$command, ['reason_code' => $reason ?? $reasons[$command]], $this->headers($version, $key));
    }

    protected function walkIn(string $name = 'حضور مباشر صناعي', ?string $phone = null, ?string $key = null): TestResponse
    {
        return $this->postJson('/v1/sessions/'.$this->id('SESSION_C').'/walk-ins', ['window_id' => $this->id('W1_C'), 'display_name' => $name, 'contact_phone' => $phone], $this->headers(key: $key));
    }

    protected function receptionSnapshot(): array
    {
        $snapshot = [];
        foreach (['patients', 'bookings', 'visits', 'audit_events', 'outbox_messages', 'command_replays'] as $table) {
            $snapshot[$table] = DB::table($table)->count();
        }
        $snapshot['sessions'] = DB::table('clinic_sessions')->orderBy('id')->get(['id', 'ticket_counter', 'ready_counter', 'version'])->toArray();

        return $snapshot;
    }
}
