<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\ReceptionTestCase;

#[Group('postgres')]
class ReceptionVisitTest extends ReceptionTestCase
{
    public function test_away_leaves_queue_and_return_joins_tail_with_same_ticket(): void
    {
        $first = $this->arrival()->assertCreated()->json('id');
        $second = $this->walkIn()->assertCreated()->json('id');
        $this->visitCommand($first, 'mark-away')->assertOk()->assertJsonPath('state', 'away');
        $this->getJson('/v1/visits/'.$second)->assertOk()->assertJsonPath('data.visit.waiting_position', 1);
        $this->travelTo(now()->addHours(2));
        $this->visitCommand($first, 'return', 2)->assertOk()->assertJsonPath('ticket_number', 1)->assertJsonPath('ready_sequence', 3)->assertJsonPath('version', 3);
        $this->getJson('/v1/visits/'.$first)->assertOk()->assertJsonPath('data.visit.waiting_position', 2);
        $this->assertDatabaseHas('visits', ['id' => $first, 'returned_at' => now(), 'ticket_number' => 1]);
        $this->assertDatabaseHas('audit_events', ['entity_id' => $first, 'event_type' => 'visit_return', 'reason_code' => 'patient_returned']);
    }

    public function test_return_resets_old_priority_as_required_by_tail_rule(): void
    {
        $id = $this->arrival()->assertCreated()->json('id');
        DB::table('visits')->where('id', $id)->update(['state' => 'away', 'priority' => true]);
        $this->visitCommand($id, 'return')->assertOk();
        $this->assertDatabaseHas('visits', ['id' => $id, 'priority' => false]);
    }

    public function test_owner_reasoned_defer_moves_waiter_to_tail_and_reception_cannot_use_it(): void
    {
        $first = $this->arrival()->assertCreated()->json('id');
        $this->walkIn()->assertCreated();
        $this->visitCommand($first, 'defer')->assertOk()->assertJsonPath('ticket_number', 1)->assertJsonPath('ready_sequence', 3);
        $this->getJson('/v1/visits/'.$first)->assertJsonPath('data.visit.waiting_position', 2);
        $this->assertDatabaseHas('audit_events', ['entity_id' => $first, 'event_type' => 'visit_defer', 'reason_code' => 'administrative_correction']);
        $this->signIn('RECEPTION_A');
        $this->visitCommand($first, 'defer', 2)->assertForbidden();
    }

    public function test_defer_cannot_override_medical_priority_or_active_visit(): void
    {
        $id = $this->arrival()->assertCreated()->json('id');
        DB::table('visits')->where('id', $id)->update(['priority' => true]);
        $this->visitCommand($id, 'defer')->assertConflict();
        DB::table('visits')->where('id', $id)->update(['priority' => false, 'state' => 'called']);
        $this->visitCommand($id, 'defer')->assertConflict();
    }

    public function test_called_away_or_left_frees_the_doctor_without_deleting_history(): void
    {
        $id = $this->id('VISIT_A1');
        DB::table('visits')->where('id', $id)->update(['state' => 'called', 'called_at' => now()]);
        $this->visitCommand($id, 'mark-away')->assertOk();
        $this->assertDatabaseMissing('visits', ['doctor_id' => $this->id('DR_A'), 'state' => 'called']);
        $this->assertDatabaseHas('visits', ['id' => $id, 'called_at' => now(), 'ticket_number' => 1]);
        $this->visitCommand($id, 'leave', 2)->assertOk()->assertJsonPath('state', 'left');
        $this->visitCommand($id, 'return', 3)->assertConflict();
        $this->arrival($this->id('BOOK_A1'))->assertConflict();
    }

    public function test_started_completed_and_already_away_transitions_are_rejected(): void
    {
        $id = $this->id('VISIT_A1');
        foreach (['in_service', 'completed', 'left'] as $state) {
            DB::table('visits')->where('id', $id)->update(['state' => $state]);
            $this->visitCommand($id, 'mark-away')->assertConflict();
            $this->visitCommand($id, 'leave')->assertConflict();
            $this->visitCommand($id, 'return')->assertConflict();
        }
        DB::table('visits')->where('id', $id)->update(['state' => 'away']);
        $this->visitCommand($id, 'mark-away')->assertConflict();
    }

    public function test_visit_replay_is_one_reasoned_event_and_stale_new_action_is_rejected(): void
    {
        $id = $this->id('VISIT_A1');
        $key = (string) Str::uuid();
        $first = $this->visitCommand($id, 'mark-away', key: $key)->assertOk();
        $this->visitCommand($id, 'mark-away', key: $key)->assertOk()->assertJsonPath('replayed', true)->assertJsonPath('request_id', $first->json('request_id'));
        $this->visitCommand($id, 'leave', key: $key)->assertConflict();
        $this->visitCommand($id, 'return')->assertConflict();
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $id)->where('event_type', 'visit_mark_away')->count());
        $url = '/v1/visits/'.$id.'/return';
        $this->postJson($url, [], $this->headers(2))->assertUnprocessable();
        $this->postJson($url, ['reason_code' => 'clinical_priority'], $this->headers(2))->assertUnprocessable();
    }

    public function test_booking_cancel_and_reschedule_remain_consistent_after_arrival(): void
    {
        $id = $this->arrival()->assertCreated()->json('id');
        $booking = $this->id('BOOK_C1');
        $this->postJson('/v1/bookings/'.$booking.'/reschedule', ['reason_code' => 'schedule_change', 'session_id' => $this->id('SESSION_C'), 'window_id' => $this->id('W2_C')], $this->headers(2))->assertConflict();
        $this->postJson('/v1/bookings/'.$booking.'/cancel', ['reason_code' => 'patient_request'], $this->headers(2))->assertOk();
        $this->assertDatabaseHas('visits', ['id' => $id, 'state' => 'left', 'ticket_number' => 1, 'version' => 2]);
        $this->visitCommand($id, 'return', 2)->assertConflict();
        $this->arrival($booking, 3)->assertConflict();
    }
}
