<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\ClinicOperationsTestCase;

#[Group('postgres')]
class SessionCommandsTest extends ClinicOperationsTestCase
{
    public function test_open_pause_resume_and_close_are_versioned_reasoned_and_audited(): void
    {
        $this->owner();
        $id = $this->scheduled();
        $this->travelTo(CarbonImmutable::parse('2026-11-07T15:30:00Z'));
        $this->command($id, 'open')->assertOk()->assertJsonPath('state', 'open')->assertJsonPath('version', 2);
        $this->command($id, 'pause', version: 2)->assertOk()->assertJsonPath('state', 'paused');
        $this->getJson('/v1/sessions/'.$id)->assertJsonPath('data.accepting_arrivals', true);
        $this->command($id, 'resume', version: 3)->assertOk()->assertJsonPath('state', 'open');
        $this->command($id, 'close', version: 4)->assertOk()->assertJsonPath('state', 'closed')->assertJsonPath('version', 5);
        $events = DB::table('audit_events')->where('entity_id', $id)->get();
        $this->assertSame(5, $events->count());
        $this->assertSame(5, DB::table('outbox_messages')->whereIn('event_id', $events->pluck('id'))->where('status', 'disabled')->count());
    }

    public function test_open_cannot_escape_intake_bounds_and_no_action_reopens_closed_session(): void
    {
        $this->owner();
        $id = $this->scheduled();
        $this->command($id, 'open')->assertConflict();
        $this->travelTo(CarbonImmutable::parse('2026-11-07T17:00:00Z'));
        $this->command($id, 'open')->assertConflict();
        $this->command($id, 'close')->assertOk();
        $this->command($id, 'open', version: 2)->assertConflict();
    }

    public function test_close_rejects_each_unresolved_visit_without_changing_bookings(): void
    {
        $this->owner();
        $before = DB::table('bookings')->get()->toJson();
        foreach (['waiting', 'away', 'called', 'in_service'] as $state) {
            DB::table('visits')->where('id', $this->id('VISIT_A1'))->update(['state' => $state]);
            $this->command($this->id('SESSION_A'), 'close')->assertConflict();
        }
        $this->assertSame($before, DB::table('bookings')->get()->toJson());
        DB::table('visits')->where('id', $this->id('VISIT_A1'))->update(['state' => 'left']);
        $this->command($this->id('SESSION_A'), 'close')->assertOk();
        $this->assertSame($before, DB::table('bookings')->get()->toJson());
    }

    public function test_resume_after_intake_end_serves_existing_arrivals_without_reopening_intake(): void
    {
        $this->owner();
        $this->command($this->id('SESSION_A'), 'pause')->assertOk();
        $this->travel(3)->hours();
        $this->command($this->id('SESSION_A'), 'resume', version: 2)->assertOk();
        $this->getJson('/v1/sessions/'.$this->id('SESSION_A'))->assertOk()->assertJsonPath('data.accepting_arrivals', false)->assertJsonPath('data.intake_ended', true);
    }

    public function test_doctor_can_only_pause_resume_own_session_and_reception_cannot_operate(): void
    {
        $this->signIn('DOCTOR_A');
        $this->command($this->id('SESSION_A'), 'pause')->assertOk();
        $this->command($this->id('SESSION_A'), 'resume', version: 2)->assertOk();
        $this->command($this->id('SESSION_A'), 'close', version: 3)->assertForbidden();
        $this->command($this->id('SESSION_C'), 'pause')->assertNotFound();
        $this->signIn('RECEPTION_A');
        $this->command($this->id('SESSION_A'), 'pause', version: 3)->assertForbidden();
        $this->signIn('PLATFORM', true);
        $this->command($this->id('SESSION_A'), 'pause', version: 3)->assertNotFound();
    }

    public function test_idempotency_replay_returns_one_effect_and_encrypted_record(): void
    {
        $this->owner();
        $key = (string) Str::uuid();
        $first = $this->command($this->id('SESSION_A'), 'pause', key: $key)->assertOk()->assertJsonPath('replayed', false);
        $second = $this->command($this->id('SESSION_A'), 'pause', key: $key)->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame($first->json('version'), $second->json('version'));
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'session_pause')->count());
        $record = DB::table('command_replays')->first();
        $this->assertNotSame($key, $record->key_digest);
        $this->assertStringNotContainsString('"state"', $record->response_ciphertext);
        $this->assertSame('paused', json_decode(Crypt::decryptString($record->response_ciphertext), true)['state']);
        $this->command($this->id('SESSION_A'), 'pause', ['reason_code' => 'session_cancelled'], key: $key)->assertConflict();
        $this->command($this->id('SESSION_A'), 'pause')->assertConflict();
    }

    public function test_replay_still_requires_current_scope_and_membership(): void
    {
        $this->owner();
        $key = (string) Str::uuid();
        $this->command($this->id('SESSION_A'), 'pause', key: $key)->assertOk();
        DB::table('memberships')->where('id', $this->id('MEM_OWNER_A'))->update(['active' => false]);
        $this->command($this->id('SESSION_A'), 'pause', key: $key)->assertNotFound();
    }

    public function test_missing_reason_version_and_attempt_key_do_not_mutate(): void
    {
        $this->owner();
        $path = '/v1/sessions/'.$this->id('SESSION_A').'/pause';
        $this->postJson($path, ['reason_code' => 'operational_pause'])->assertStatus(428);
        $this->postJson($path, ['reason_code' => 'operational_pause'], ['If-Match' => '1'])->assertUnprocessable();
        $this->postJson($path, [], $this->headers())->assertUnprocessable();
        $this->postJson($path, ['reason_code' => 'operational_pause', 'clinic_id' => $this->id('CLINIC_B')], $this->headers())->assertUnprocessable();
        $this->assertSame(0, DB::table('command_replays')->count());
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_A'), 'state' => 'open', 'version' => 1]);
    }

    public function test_extension_does_not_create_window_or_capacity_and_wrong_transition_rolls_back(): void
    {
        $this->owner();
        $before = DB::table('arrival_windows')->get()->toJson();
        $this->command($this->id('SESSION_A'), 'extend', ['ends_at' => '2026-11-07T19:00'])->assertOk()->assertJsonPath('version', 2);
        $this->assertSame($before, DB::table('arrival_windows')->get()->toJson());
        $this->command($this->id('SESSION_A'), 'resume', version: 2)->assertConflict();
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_A'), 'state' => 'open', 'version' => 2]);
        $this->assertSame(1, DB::table('command_replays')->count());
    }
}
