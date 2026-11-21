<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\DoctorTestCase;

#[Group('postgres')]
class DoctorLifecycleTest extends DoctorTestCase
{
    public function test_call_start_complete_preserve_ticket_and_fulfil_booking_with_server_times(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $called = $this->callNext()->assertOk()->assertJsonPath('id', $visit)->assertJsonPath('state', 'called')->assertJsonPath('version', 2);
        $this->assertTrue(CarbonImmutable::parse($called->json('called_at'))->eq(now()));
        $this->travel(2)->minutes();
        $started = $this->doctorAction($visit, 'start')->assertOk()->assertJsonPath('state', 'in_service')->assertJsonPath('version', 3);
        $this->assertTrue(CarbonImmutable::parse($started->json('started_at'))->eq(now()));
        $this->travel(5)->minutes();
        $completed = $this->doctorAction($visit, 'complete')->assertOk()->assertJsonPath('state', 'completed')->assertJsonPath('version', 4)
            ->assertJsonPath('booking_state', 'fulfilled')->assertJsonPath('booking_version', 3)->assertJsonPath('ticket_number', 1);
        $this->assertTrue(CarbonImmutable::parse($completed->json('completed_at'))->eq(now()));
        $this->assertSame($called->json('called_at'), $completed->json('called_at'));
        $this->assertSame($started->json('started_at'), $completed->json('started_at'));
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_C1'), 'visit_id' => $visit, 'state' => 'fulfilled', 'version' => 3]);
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_C'), 'version' => 5, 'ticket_counter' => 1]);
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $this->id('BOOK_C1'))->where('event_type', 'booking_fulfilled')->count());
        $this->doctorList('completed')->assertOk()->assertJsonPath('active_visit', null)->assertJsonPath('summary.completed', 1)->assertJsonPath('visits.0.id', $visit);
    }

    public function test_visit_cannot_start_or_complete_before_its_required_previous_state(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $before = $this->doctorSnapshot();
        $this->doctorAction($visit, 'start')->assertConflict();
        $this->doctorAction($visit, 'complete')->assertConflict();
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->callNext()->assertOk();
        $before = $this->doctorSnapshot();
        $this->doctorAction($visit, 'complete')->assertConflict();
        $this->assertEquals($before, $this->doctorSnapshot());
    }

    public function test_successful_lifecycle_replays_restore_original_results_without_repeating_events(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $callKey = (string) Str::uuid();
        $startKey = (string) Str::uuid();
        $completeKey = (string) Str::uuid();
        $this->callNext(version: 2, key: $callKey)->assertOk();
        $this->doctorAction($visit, 'start', version: 2, key: $startKey)->assertOk();
        $this->doctorAction($visit, 'complete', version: 3, key: $completeKey)->assertOk();
        $before = $this->doctorSnapshot();
        $this->callNext(version: 2, key: $callKey)->assertOk()->assertJsonPath('id', $visit)->assertJsonPath('state', 'called')->assertJsonPath('replayed', true);
        $this->doctorAction($visit, 'start', version: 2, key: $startKey)->assertOk()->assertJsonPath('state', 'in_service')->assertJsonPath('replayed', true);
        $this->doctorAction($visit, 'complete', version: 3, key: $completeKey)->assertOk()->assertJsonPath('state', 'completed')->assertJsonPath('replayed', true);
        $this->assertEquals($before, $this->doctorSnapshot());
        foreach (['visit_call_next', 'visit_start', 'visit_complete'] as $event) {
            $this->assertSame(1, DB::table('audit_events')->where('entity_id', $visit)->where('event_type', $event)->count());
        }
    }

    public function test_paused_session_blocks_new_calls_but_allows_the_active_visit_to_start_and_finish(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->command($this->id('SESSION_C'), 'pause', version: 2)->assertOk();
        $this->callNext()->assertConflict();
        $this->command($this->id('SESSION_C'), 'resume', version: 3)->assertOk();
        $this->callNext()->assertOk();
        $this->command($this->id('SESSION_C'), 'pause', version: 5)->assertOk();
        $this->doctorAction($visit, 'start')->assertOk();
        $this->doctorAction($visit, 'complete')->assertOk();
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_C'), 'state' => 'paused']);
    }

    public function test_previously_arrived_visits_are_processed_after_intake_ends(): void
    {
        $visit = $this->arrivedVisit();
        $this->travelTo(CarbonImmutable::parse('2026-11-07T15:01:00Z'));
        $this->doctor();
        $this->doctorList()->assertOk()->assertJsonPath('selected_session.intake_ended', true);
        $this->callNext()->assertOk();
        $this->doctorAction($visit, 'start')->assertOk();
        $this->doctorAction($visit, 'complete')->assertOk();
    }

    public function test_called_absence_frees_doctor_and_return_preserves_ticket_at_tail(): void
    {
        $first = $this->arrivedVisit();
        $second = $this->walkIn('المراجع الثاني')->assertCreated()->json('id');
        $this->doctor();
        $this->callNext()->assertOk()->assertJsonPath('id', $first);
        $this->visitCommand($first, 'mark-away', 2)->assertOk();
        $this->callNext()->assertOk()->assertJsonPath('id', $second);
        $this->owner();
        $this->visitCommand($first, 'return', 3)->assertOk()->assertJsonPath('ticket_number', 1)->assertJsonPath('ready_sequence', 3);
        $this->doctor();
        $this->callNext()->assertConflict();
        $this->doctorAction($second, 'start')->assertOk();
        $this->doctorAction($second, 'complete')->assertOk();
        $this->callNext()->assertOk()->assertJsonPath('id', $first)->assertJsonPath('ticket_number', 1);
    }

    public function test_completed_visit_cannot_restart_or_be_cancelled_by_reception(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->callNext()->assertOk();
        $this->doctorAction($visit, 'start')->assertOk();
        $this->doctorAction($visit, 'complete')->assertOk();
        $this->doctorAction($visit, 'start')->assertConflict();
        $this->doctorAction($visit, 'complete')->assertConflict();
        $this->owner();
        $this->visitCommand($visit, 'leave', 4)->assertConflict();
        $this->postJson('/v1/bookings/'.$this->id('BOOK_C1').'/cancel', ['reason_code' => 'patient_request'], $this->headers(3))->assertConflict();
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_C1'), 'state' => 'fulfilled']);
        $this->assertSame(1, DB::table('bookings')->where('window_id', $this->id('W1_C'))->whereIn('state', ['confirmed', 'fulfilled'])->count());
    }

    public function test_recorded_correction_preserves_started_visit_state_and_all_original_times(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->doctorAction($visit, 'correct', ['reason_code' => 'administrative_correction'])->assertConflict();
        $this->callNext()->assertOk();
        $this->doctorAction($visit, 'correct', ['reason_code' => 'administrative_correction'])->assertConflict();
        $this->doctorAction($visit, 'start')->assertOk();
        $before = DB::table('visits')->where('id', $visit)->first();
        $events = DB::table('audit_events')->where('entity_id', $visit)->count();
        $key = (string) Str::uuid();
        $this->doctorAction($visit, 'correct', ['reason_code' => 'administrative_correction'], 3, $key)->assertOk()->assertJsonPath('state', 'in_service')->assertJsonPath('version', 4);
        $after = DB::table('visits')->where('id', $visit)->first();
        foreach (['state', 'ticket_number', 'arrived_at', 'called_at', 'started_at', 'completed_at'] as $field) {
            $this->assertSame($before->$field, $after->$field);
        }
        $this->assertSame($events + 1, DB::table('audit_events')->where('entity_id', $visit)->count());
        $this->doctorAction($visit, 'correct', ['reason_code' => 'administrative_correction'], 3, $key)->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame($events + 1, DB::table('audit_events')->where('entity_id', $visit)->count());
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_C1'), 'state' => 'confirmed', 'version' => 2]);
    }

    public function test_completed_visit_accepts_audit_only_correction_after_session_closure(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->callNext()->assertOk();
        $this->doctorAction($visit, 'start')->assertOk();
        $completed = $this->doctorAction($visit, 'complete')->assertOk();
        $this->owner();
        $this->command($this->id('SESSION_C'), 'close', version: 5)->assertOk();
        $this->doctor();
        $this->doctorAction($visit, 'correct', ['reason_code' => 'entered_in_error'])->assertOk()->assertJsonPath('state', 'completed')
            ->assertJsonPath('completed_at', $completed->json('completed_at'))->assertJsonPath('booking_state', 'fulfilled');
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_C'), 'state' => 'closed']);
        $this->doctorAction($visit, 'start')->assertConflict();
    }

    public function test_active_visit_from_previous_session_blocks_later_session_until_completed(): void
    {
        $first = $this->arrivedVisit();
        $this->doctor();
        $this->callNext()->assertOk();
        $this->doctorAction($first, 'start')->assertOk();
        $this->owner();
        $schedule = $this->schedule();
        $schedule['doctor_id'] = $this->id('DR_C');
        $newSession = $this->postJson('/workspace/sessions', $schedule)->assertCreated()->json('data');
        $this->travelTo(CarbonImmutable::parse('2026-11-07T15:30:00Z'));
        $this->owner();
        $this->command($newSession['id'], 'open')->assertOk();
        $second = $this->postJson('/v1/sessions/'.$newSession['id'].'/walk-ins', ['window_id' => $newSession['windows'][0]['id'], 'display_name' => 'مراجع الجلسة التالية', 'contact_phone' => null], $this->headers())->assertCreated()->json('id');
        $this->doctor();
        $this->doctorList(session: $newSession['id'])->assertOk()->assertJsonPath('active_visit.id', $first)->assertJsonPath('active_visit.session_id', $this->id('SESSION_C'))->assertJsonPath('selected_session.availability', 'busy');
        $before = $this->doctorSnapshot();
        $this->callNext($newSession['id'])->assertConflict();
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->doctorAction($first, 'complete')->assertOk();
        $this->callNext($newSession['id'])->assertOk()->assertJsonPath('id', $second);
        $this->assertSame(1, DB::table('visits')->where('doctor_id', $this->id('DR_C'))->whereIn('state', ['called', 'in_service'])->count());
    }

    public function test_empty_queue_and_closed_session_do_not_create_calls_or_events(): void
    {
        $this->doctor();
        $before = $this->doctorSnapshot();
        $this->callNext()->assertConflict();
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->owner();
        $this->command($this->id('SESSION_C'), 'close')->assertOk();
        $this->doctor();
        $before = $this->doctorSnapshot();
        $this->callNext()->assertConflict();
        $this->assertEquals($before, $this->doctorSnapshot());
    }
}
