<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\ClinicOperationsTestCase;

#[Group('postgres')]
class SessionSetupTest extends ClinicOperationsTestCase
{
    public function test_t05a_adjacent_session_and_windows_are_saved_in_correct_utc_instants(): void
    {
        $this->owner();
        $result = $this->postJson('/workspace/sessions', $this->schedule())->assertCreated();
        $result->assertJsonPath('data.starts_at', '2026-11-07T15:00:00+00:00')->assertJsonPath('data.ends_at', '2026-11-07T17:00:00+00:00')->assertJsonPath('data.total_capacity', 5);
        $this->assertSame(2, DB::table('arrival_windows')->where('session_id', $result->json('data.id'))->count());
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'session_scheduled')->count());
    }

    public function test_t05a_overlapping_sessions_are_rejected_without_partial_windows_or_events(): void
    {
        $this->owner();
        $this->scheduled();
        $before = DB::table('arrival_windows')->count();
        $this->postJson('/workspace/sessions', $this->schedule())->assertUnprocessable();
        $this->assertSame(4, DB::table('clinic_sessions')->count());
        $this->assertSame($before, DB::table('arrival_windows')->count());
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'session_scheduled')->count());
    }

    public function test_outside_overlapping_reversed_empty_and_cross_day_windows_are_rejected(): void
    {
        $this->owner();
        $data = $this->schedule();
        foreach ([
            [...$data, 'windows' => []],
            [...$data, 'ends_at' => '2026-11-08T01:00'],
            [...$data, 'windows' => [['starts_at' => '2026-11-07T17:59', 'ends_at' => '2026-11-07T19:00', 'capacity' => 1]]],
            [...$data, 'windows' => [['starts_at' => '2026-11-07T19:00', 'ends_at' => '2026-11-07T18:00', 'capacity' => 1]]],
            [...$data, 'windows' => [['starts_at' => '2026-11-07T18:00', 'ends_at' => '2026-11-07T19:30', 'capacity' => 1], ['starts_at' => '2026-11-07T19:00', 'ends_at' => '2026-11-07T20:00', 'capacity' => 2]]],
            [...$data, 'windows' => [['starts_at' => '2026-11-07T18:00', 'ends_at' => '2026-11-07T19:00', 'capacity' => 0]]],
        ] as $invalid) {
            $this->postJson('/workspace/sessions', $invalid)->assertUnprocessable();
        }
        $this->assertSame(3, DB::table('clinic_sessions')->count());
    }

    public function test_empty_draft_can_be_corrected_but_existing_bookings_and_history_are_preserved(): void
    {
        $this->owner();
        $id = $this->scheduled();
        $new = [...$this->schedule(), 'version' => 1, 'ends_at' => '2026-11-07T21:00'];
        $this->postJson('/workspace/sessions/'.$id.'/schedule', $new)->assertOk()->assertJsonPath('data.version', 2)->assertJsonPath('data.total_capacity', 5);
        $this->postJson('/workspace/sessions/'.$id.'/schedule', $new)->assertUnprocessable();
        DB::table('clinic_sessions')->where('id', $this->id('SESSION_A'))->update(['state' => 'scheduled']);
        $before = DB::table('bookings')->get()->toJson();
        $this->postJson('/workspace/sessions/'.$this->id('SESSION_A').'/schedule', $new)->assertUnprocessable();
        $this->assertSame($before, DB::table('bookings')->get()->toJson());
    }

    public function test_settings_and_list_do_not_reveal_other_clinic_or_doctor_sessions(): void
    {
        $this->owner();
        $this->postJson('/workspace/sessions', [...$this->schedule(), 'doctor_id' => $this->id('DR_B')])->assertNotFound();
        $this->postJson('/workspace/sessions', [...$this->schedule(), 'clinic_id' => $this->id('CLINIC_B')])->assertUnprocessable();
        $this->signIn('DOCTOR_A');
        $this->getJson('/v1/sessions?date=2026-11-07')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->id('SESSION_A'));
        $this->getJson('/v1/sessions/'.$this->id('SESSION_C'))->assertNotFound();
        $this->getJson('/v1/sessions/'.$this->id('SESSION_B'))->assertNotFound();
        $this->postJson('/workspace/sessions', $this->schedule())->assertForbidden();
        $this->signIn('RECEPTION_A');
        $this->getJson('/v1/sessions?date=2026-11-07')->assertOk()->assertJsonCount(2, 'data');
        $this->postJson('/workspace/sessions', $this->schedule())->assertForbidden();
    }

    public function test_extension_checks_next_session_same_day_and_never_adds_capacity(): void
    {
        $this->owner();
        $this->scheduled();
        $this->command($this->id('SESSION_A'), 'extend', ['ends_at' => '2026-11-07T18:30'])->assertConflict();
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_A'), 'version' => 1]);
        $this->command($this->id('SESSION_A'), 'extend', ['ends_at' => '2026-11-08T01:00'])->assertConflict();
        $this->command($this->id('SESSION_A'), 'extend', ['ends_at' => '2026-11-07T17:59'])->assertConflict();
        $this->command($this->id('SESSION_A'), 'extend', ['ends_at' => '2026-11-07T18:00'])->assertConflict();
        $this->assertSame(0, DB::table('audit_events')->where('event_type', 'session_extend')->count());
    }
}
