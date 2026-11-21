<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\TicketTestCase;

#[Group('postgres')]
class TicketAtomicityTest extends TicketTestCase
{
    public function test_token_storage_failure_rolls_back_the_new_booking_patient_audit_outbox_and_replay(): void
    {
        $before = $this->ticketSnapshot();
        DB::unprepared(<<<'SQL'
CREATE FUNCTION p09_test_fail_token_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic P09 token storage failure'; END $$;
CREATE TRIGGER p09_test_fail_token_insert BEFORE INSERT ON ticket_tokens
FOR EACH ROW EXECUTE FUNCTION p09_test_fail_token_insert();
SQL);
        $this->ticketRequest()->assertStatus(500);
        $this->assertEquals($before, $this->ticketSnapshot());
    }

    public function test_recovery_outbox_failure_restores_the_old_token_and_all_versions_without_a_partial_replay(): void
    {
        $secret = $this->tokenForBooking();
        $before = $this->ticketSnapshot();
        DB::unprepared(<<<'SQL'
CREATE FUNCTION p09_test_fail_recovery_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic P09 recovery outbox failure'; END $$;
CREATE TRIGGER p09_test_fail_recovery_outbox BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION p09_test_fail_recovery_outbox();
SQL);
        $this->renewTicket()->assertStatus(500);
        $this->assertEquals($before, $this->ticketSnapshot());
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_version', 1);
    }
}
