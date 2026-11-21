<?php

namespace Tests;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

abstract class DoctorTestCase extends ReceptionTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::table('arrival_windows')->where('id', $this->id('W1_C'))->update(['capacity' => 8]);
    }

    protected function doctor(): User
    {
        return $this->signIn('DOCTOR_C');
    }

    protected function arrivedVisit(): string
    {
        return $this->arrival()->assertCreated()->json('id');
    }

    protected function callNext(?string $session = null, ?int $version = null, ?string $key = null): TestResponse
    {
        $session ??= $this->id('SESSION_C');
        $version ??= (int) DB::table('clinic_sessions')->where('id', $session)->value('version');

        return $this->postJson('/v1/sessions/'.$session.'/call-next', [], $this->headers($version, $key));
    }

    protected function doctorAction(string $visit, string $command, array $data = [], ?int $version = null, ?string $key = null): TestResponse
    {
        $version ??= (int) DB::table('visits')->where('id', $visit)->value('version');

        return $this->postJson('/v1/visits/'.$visit.'/'.$command, $data, $this->headers($version, $key));
    }

    protected function delegation(bool $enabled, ?int $version = null, ?string $key = null, ?string $membership = null): TestResponse
    {
        $membership ??= $this->id('MEM_RECEPTION_A');
        $version ??= (int) DB::table('memberships')->where('id', $membership)->value('delegation_version');

        return $this->postJson('/workspace/team/'.$membership.'/delegation', ['call_next' => $enabled, 'reason_code' => $enabled ? 'delegation_granted' : 'delegation_revoked'], $this->headers($version, $key));
    }

    protected function doctorList(string $state = 'waiting', ?string $session = null, string $date = '2026-11-07'): TestResponse
    {
        return $this->getJson('/v1/doctor?date='.$date.'&session_id='.($session ?? $this->id('SESSION_C')).'&state='.$state);
    }

    protected function doctorSnapshot(): array
    {
        $snapshot = [];
        foreach (['bookings', 'visits', 'clinic_sessions', 'memberships'] as $table) {
            $snapshot[$table] = DB::table($table)->orderBy('id')->get()->toArray();
        }
        foreach (['audit_events', 'security_events', 'outbox_messages', 'command_replays'] as $table) {
            $snapshot[$table] = DB::table($table)->count();
        }

        return $snapshot;
    }
}
