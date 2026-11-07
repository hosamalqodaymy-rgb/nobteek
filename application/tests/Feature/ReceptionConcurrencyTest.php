<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\ReceptionTestCase;

#[Group('postgres')]
class ReceptionConcurrencyTest extends ReceptionTestCase
{
    private function failOutbox(): void
    {
        DB::unprepared(<<<'SQL'
CREATE FUNCTION nobteek_test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$;
CREATE TRIGGER nobteek_test_fail_outbox BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION nobteek_test_fail_outbox();
SQL);
    }

    public function test_check_in_rolls_back_visit_booking_counters_event_and_replay_when_outbox_fails(): void
    {
        $before = $this->receptionSnapshot();
        $this->failOutbox();
        $this->arrival()->assertStatus(500);
        $this->assertEquals($before, $this->receptionSnapshot());
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_C1'), 'visit_id' => null, 'version' => 1]);
    }

    public function test_walk_in_rolls_back_patient_and_all_operational_records_when_outbox_fails(): void
    {
        $before = $this->receptionSnapshot();
        $this->failOutbox();
        $this->walkIn()->assertStatus(500);
        $this->assertEquals($before, $this->receptionSnapshot());
    }

    public function test_failed_visit_transition_does_not_change_order_or_version(): void
    {
        $before = $this->receptionSnapshot();
        $this->failOutbox();
        $this->visitCommand($this->id('VISIT_A1'), 'defer')->assertStatus(500);
        $this->assertEquals($before, $this->receptionSnapshot());
        $this->assertDatabaseHas('visits', ['id' => $this->id('VISIT_A1'), 'state' => 'waiting', 'ready_sequence' => 1, 'version' => 1]);
    }

    public function test_arrival_and_return_invalidate_old_session_capacity_preview(): void
    {
        $this->arrival()->assertCreated();
        $preview = $this->preview(4);
        $this->visitCommand($this->id('VISIT_A1'), 'mark-away')->assertOk();
        $this->command($this->id('SESSION_A'), 'capacity', ['window_id' => $this->id('W1_A'), 'capacity' => 4, 'preview_token' => $preview['preview_token'], 'acknowledged' => true])->assertConflict();
    }
}
