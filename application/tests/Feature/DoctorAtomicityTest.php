<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\DoctorTestCase;

#[Group('postgres')]
class DoctorAtomicityTest extends DoctorTestCase
{
    private function failOutbox(): void
    {
        DB::unprepared(<<<'SQL'
CREATE FUNCTION p08_test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic P08 outbox failure'; END $$;
CREATE TRIGGER p08_test_fail_outbox BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION p08_test_fail_outbox();
SQL);
    }

    public function test_call_rolls_back_active_slot_time_versions_event_and_replay_when_outbox_fails(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $before = $this->doctorSnapshot();
        $this->failOutbox();
        $this->callNext()->assertStatus(500);
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'waiting', 'version' => 1, 'called_at' => null]);
        $this->assertSame(0, DB::table('visits')->where('doctor_id', $this->id('DR_C'))->whereIn('state', ['called', 'in_service'])->count());
    }

    public function test_completion_rolls_back_fulfillment_and_both_events_if_visit_outbox_fails(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->callNext()->assertOk();
        $this->doctorAction($visit, 'start')->assertOk();
        $before = $this->doctorSnapshot();
        DB::unprepared(<<<'SQL'
CREATE FUNCTION p08_test_fail_complete_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM audit_events WHERE id = NEW.event_id AND event_type = 'visit_complete') THEN
        RAISE EXCEPTION 'synthetic P08 completion outbox failure';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER p08_test_fail_complete_outbox BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION p08_test_fail_complete_outbox();
SQL);
        $this->doctorAction($visit, 'complete')->assertStatus(500);
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'in_service', 'version' => 3, 'completed_at' => null]);
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_C1'), 'state' => 'confirmed', 'version' => 2]);
        $this->assertSame(0, DB::table('audit_events')->where('event_type', 'booking_fulfilled')->count());
    }

    public function test_priority_rolls_back_queue_sequence_counter_and_flags_when_outbox_fails(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $before = $this->doctorSnapshot();
        $this->failOutbox();
        $this->doctorAction($visit, 'priority', ['reason_code' => 'clinical_priority'])->assertStatus(500);
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'waiting', 'version' => 1, 'priority' => false, 'ready_sequence' => 1]);
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_C'), 'ready_counter' => 1, 'ticket_counter' => 1, 'version' => 2]);
    }

    public function test_delegation_rolls_back_permission_audit_outbox_and_replay_if_security_audit_fails(): void
    {
        $before = $this->doctorSnapshot();
        DB::unprepared(<<<'SQL'
CREATE FUNCTION p08_test_fail_delegation_security_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.event_type = 'call_next_delegation_changed' THEN
        RAISE EXCEPTION 'synthetic P08 delegation security audit failure';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER p08_test_fail_delegation_security_event BEFORE INSERT ON security_events
FOR EACH ROW EXECUTE FUNCTION p08_test_fail_delegation_security_event();
SQL);
        $this->delegation(true)->assertStatus(500);
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->assertDatabaseHas('memberships', ['id' => $this->id('MEM_RECEPTION_A'), 'delegation_version' => 1]);
        $this->signIn('RECEPTION_A');
        $this->callNext()->assertForbidden();
    }
}
