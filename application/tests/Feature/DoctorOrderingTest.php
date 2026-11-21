<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\DoctorTestCase;

#[Group('postgres')]
class DoctorOrderingTest extends DoctorTestCase
{
    public function test_priority_uses_decision_order_preserves_tickets_and_replays_without_moving_again(): void
    {
        $first = $this->arrivedVisit();
        $second = $this->walkIn('أولوية ثانية')->assertCreated()->json('id');
        $third = $this->walkIn('أولوية أولى')->assertCreated()->json('id');
        $this->doctor();
        $key = (string) Str::uuid();
        $this->doctorAction($third, 'priority', ['reason_code' => 'clinical_priority'], 1, $key)->assertOk()->assertJsonPath('ticket_number', 3)->assertJsonPath('ready_sequence', 4);
        $this->doctorAction($second, 'priority', ['reason_code' => 'clinical_priority'])->assertOk()->assertJsonPath('ready_sequence', 5);
        $this->doctorList()->assertOk()->assertJsonPath('visits.0.id', $third)->assertJsonPath('visits.1.id', $second)->assertJsonPath('visits.2.id', $first);
        $before = $this->doctorSnapshot();
        $this->doctorAction($third, 'priority', ['reason_code' => 'clinical_priority'], 1, $key)->assertOk()->assertJsonPath('replayed', true)->assertJsonPath('ready_sequence', 4);
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->doctorAction($third, 'priority', ['reason_code' => 'clinical_priority'])->assertOk()->assertJsonPath('ready_sequence', 6)->assertJsonPath('ticket_number', 3);
        $this->doctorList()->assertOk()->assertJsonPath('visits.0.id', $second)->assertJsonPath('visits.1.id', $third)->assertJsonPath('visits.2.id', $first);
        $this->callNext()->assertOk()->assertJsonPath('id', $second)->assertJsonPath('ticket_number', 2);
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_C'), 'ready_counter' => 6, 'ticket_counter' => 3]);
    }

    public function test_priority_does_not_preempt_the_active_visit_or_apply_to_away_visits(): void
    {
        $first = $this->arrivedVisit();
        $second = $this->walkIn('مراجع ذو أولوية')->assertCreated()->json('id');
        $this->doctor();
        $this->callNext()->assertOk()->assertJsonPath('id', $first);
        $this->doctorAction($second, 'priority', ['reason_code' => 'clinical_priority'])->assertOk();
        $this->callNext()->assertConflict();
        $this->assertDatabaseHas('visits', ['id' => $first, 'state' => 'called']);
        $this->doctorAction($first, 'priority', ['reason_code' => 'clinical_priority'])->assertConflict();
        $this->visitCommand($second, 'mark-away', 2)->assertOk();
        $this->doctorAction($second, 'priority', ['reason_code' => 'clinical_priority'])->assertConflict();
        $this->owner();
        $this->visitCommand($second, 'return', 3)->assertOk()->assertJsonPath('priority', false)->assertJsonPath('ticket_number', 2);
        $this->doctor();
        $this->doctorAction($first, 'start')->assertOk();
        $this->doctorAction($first, 'complete')->assertOk();
        $this->callNext()->assertOk()->assertJsonPath('id', $second);
    }

    public function test_delayed_status_is_audited_pause_reason_and_resume_restores_availability(): void
    {
        $this->arrivedVisit();
        $this->doctor();
        $this->doctorList()->assertOk()->assertJsonPath('selected_session.availability', 'available');
        $this->command($this->id('SESSION_C'), 'pause', ['reason_code' => 'doctor_delayed'], 2)->assertOk();
        $this->doctorList()->assertOk()->assertJsonPath('selected_session.availability', 'delayed');
        $this->callNext()->assertConflict();
        $this->command($this->id('SESSION_C'), 'resume', version: 3)->assertOk();
        $this->doctorList()->assertOk()->assertJsonPath('selected_session.availability', 'available');
        $this->postJson('/v1/sessions/'.$this->id('SESSION_C').'/resume', ['reason_code' => 'doctor_delayed'], $this->headers(4))->assertUnprocessable();
        $this->command($this->id('SESSION_C'), 'pause', version: 4)->assertOk();
        $this->doctorList()->assertOk()->assertJsonPath('selected_session.availability', 'paused');
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $this->id('SESSION_C'))->where('event_type', 'session_pause')->where('reason_code', 'doctor_delayed')->count());
    }
}
