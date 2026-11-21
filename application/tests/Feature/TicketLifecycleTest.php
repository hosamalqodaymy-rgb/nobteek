<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\TicketTestCase;

#[Group('postgres')]
class TicketLifecycleTest extends TicketTestCase
{
    public function test_pending_confirmation_arrival_and_clinical_progress_are_distinct_and_versioned(): void
    {
        $receipt = $this->ticketRequest()->assertCreated();
        $booking = $receipt->json('id');
        $secret = $this->secretFrom($receipt);
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'pending')->assertJsonPath('booking_version', 1)
            ->assertJsonPath('visit_state', null)->assertJsonPath('ticket_number', null)->assertJsonPath('waiting_ahead', null)->assertJsonPath('visit_version', null);
        $this->ticketBookingCommand($booking, 'confirm')->assertOk();
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'confirmed')->assertJsonPath('booking_version', 2)
            ->assertJsonPath('visit_state', null)->assertJsonPath('ticket_number', null);
        $visit = $this->arrival($booking, 2)->assertCreated()->json('id');
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'confirmed')->assertJsonPath('booking_version', 3)
            ->assertJsonPath('visit_state', 'waiting')->assertJsonPath('ticket_number', 1)->assertJsonPath('waiting_ahead', 0)->assertJsonPath('visit_version', 1);
        $this->doctor();
        $this->callNext()->assertOk();
        $this->ticket($secret)->assertOk()->assertJsonPath('visit_state', 'called')->assertJsonPath('waiting_ahead', null)->assertJsonPath('doctor_state', 'called')->assertJsonPath('visit_version', 2);
        $this->doctorAction($visit, 'start')->assertOk();
        $this->ticket($secret)->assertOk()->assertJsonPath('visit_state', 'in_service')->assertJsonPath('waiting_ahead', null)->assertJsonPath('doctor_state', 'in_service')->assertJsonPath('visit_version', 3);
        $this->doctorAction($visit, 'complete')->assertOk();
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'fulfilled')->assertJsonPath('booking_version', 4)
            ->assertJsonPath('visit_state', 'completed')->assertJsonPath('ticket_number', 1)->assertJsonPath('waiting_ahead', null)->assertJsonPath('doctor_state', 'available')->assertJsonPath('visit_version', 4);
    }

    public function test_ahead_counts_present_waiting_in_priority_order_and_excludes_active_away_and_left_visits(): void
    {
        $first = $this->arrivedVisit();
        $second = $this->walkIn('مراجع ثان صناعي')->assertCreated();
        $third = $this->walkIn('مراجع ثالث صناعي')->assertCreated();
        $firstSecret = $this->tokenForBooking();
        $secondSecret = $this->tokenForBooking($second->json('booking_id'));
        $thirdSecret = $this->tokenForBooking($third->json('booking_id'));
        $this->ticket($secondSecret)->assertOk()->assertJsonPath('waiting_ahead', 1)->assertJsonPath('ticket_number', 2);
        $this->doctor();
        $this->doctorAction($third->json('id'), 'priority', ['reason_code' => 'clinical_priority'])->assertOk();
        $this->ticket($thirdSecret)->assertOk()->assertJsonPath('waiting_ahead', 0)->assertJsonPath('ticket_number', 3);
        $this->ticket($firstSecret)->assertOk()->assertJsonPath('waiting_ahead', 1);
        $this->ticket($secondSecret)->assertOk()->assertJsonPath('waiting_ahead', 2);
        $this->callNext()->assertOk()->assertJsonPath('id', $third->json('id'));
        $this->doctorAction($third->json('id'), 'start')->assertOk();
        $this->ticket($firstSecret)->assertOk()->assertJsonPath('waiting_ahead', 0)->assertJsonPath('doctor_state', 'in_service');
        $this->ticket($secondSecret)->assertOk()->assertJsonPath('waiting_ahead', 1);
        $this->owner();
        $this->visitCommand($first, 'mark-away')->assertOk();
        $this->ticket($firstSecret)->assertOk()->assertJsonPath('visit_state', 'away')->assertJsonPath('waiting_ahead', null);
        $this->ticket($secondSecret)->assertOk()->assertJsonPath('waiting_ahead', 0);
        $this->visitCommand($first, 'return', 2)->assertOk();
        $this->ticket($firstSecret)->assertOk()->assertJsonPath('ticket_number', 1)->assertJsonPath('waiting_ahead', 1);
        $this->visitCommand($second->json('id'), 'leave')->assertOk();
        $this->ticket($secondSecret)->assertOk()->assertJsonPath('visit_state', 'left')->assertJsonPath('waiting_ahead', null);
        $this->ticket($firstSecret)->assertOk()->assertJsonPath('waiting_ahead', 0)->assertJsonPath('doctor_state', 'in_service');
    }

    public function test_doctor_busy_state_is_doctor_wide_and_session_pause_is_reported_separately(): void
    {
        $this->arrivedVisit();
        $future = $this->postJson('/workspace/sessions', [...$this->schedule(), 'doctor_id' => $this->id('DR_C')])->assertCreated()->json('data.id');
        $window = DB::table('arrival_windows')->where('session_id', $future)->orderBy('starts_at')->value('id');
        $receipt = $this->ticketRequest(['session_id' => $future, 'window_id' => $window])->assertCreated();
        $secret = $this->secretFrom($receipt);
        $this->doctor();
        $this->callNext()->assertOk();
        $this->ticket($secret)->assertOk()->assertJsonPath('doctor_state', 'called')->assertJsonPath('session_state', 'scheduled')->assertJsonPath('waiting_ahead', null);
        $currentSecret = $this->tokenForBooking();
        $version = (int) DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->value('version');
        $this->command($this->id('SESSION_C'), 'pause', ['reason_code' => 'doctor_delayed'], $version)->assertOk();
        $this->ticket($currentSecret)->assertOk()->assertJsonPath('session_state', 'paused')->assertJsonPath('doctor_state', 'called');
    }

    public function test_cancellation_and_session_closure_remain_visible_without_invalidating_a_valid_link(): void
    {
        $this->arrivedVisit();
        $secret = $this->tokenForBooking();
        $this->ticketBookingCommand($this->id('BOOK_C1'), 'cancel', ['reason_code' => 'patient_request'])->assertOk();
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'cancelled')->assertJsonPath('visit_state', 'left')
            ->assertJsonPath('ticket_number', 1)->assertJsonPath('waiting_ahead', null);
        $version = (int) DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->value('version');
        $this->command($this->id('SESSION_C'), 'close', version: $version)->assertOk();
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'cancelled')->assertJsonPath('session_state', 'closed')->assertJsonPath('doctor_state', 'available');
    }

    public function test_rescheduling_changes_the_current_window_and_expiry_without_reviving_expired_or_revoked_links(): void
    {
        $secret = $this->tokenForBooking();
        $expired = $this->tokenForBooking();
        $revoked = $this->tokenForBooking();
        DB::table('ticket_tokens')->where('digest', hash('sha256', $expired))->update(['expires_at' => now()]);
        DB::table('ticket_tokens')->where('digest', hash('sha256', $revoked))->update(['revoked_at' => now()]);
        $future = $this->postJson('/workspace/sessions', [...$this->schedule(), 'doctor_id' => $this->id('DR_C')])->assertCreated()->json('data.id');
        $window = DB::table('arrival_windows')->where('session_id', $future)->orderBy('starts_at')->firstOrFail();
        $this->ticketBookingCommand($this->id('BOOK_C1'), 'reschedule', ['reason_code' => 'schedule_change', 'session_id' => $future, 'window_id' => $window->id])->assertOk();
        $response = $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'confirmed')->assertJsonPath('booking_version', 2)->assertJsonPath('session_state', 'scheduled');
        $this->assertTrue(CarbonImmutable::parse($response->json('window_starts_at'))->equalTo($window->starts_at));
        $this->assertTrue(CarbonImmutable::parse($response->json('window_ends_at'))->equalTo($window->ends_at));
        $expiry = DB::table('ticket_tokens')->where('digest', hash('sha256', $secret))->value('expires_at');
        $this->assertTrue(CarbonImmutable::parse($expiry)->equalTo('2026-11-09T17:00:00Z'));
        $this->ticket($expired)->assertNotFound();
        $this->ticket($revoked)->assertNotFound();
        $this->travelTo(CarbonImmutable::parse('2026-11-09T15:00:00Z'));
        $this->ticket($secret)->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-09T17:00:00Z'));
        $this->ticket($secret)->assertNotFound();
    }

    public function test_extension_updates_valid_link_expiry_only_and_keeps_the_promised_arrival_window(): void
    {
        $secret = $this->tokenForBooking();
        $expired = $this->tokenForBooking();
        $revoked = $this->tokenForBooking();
        DB::table('ticket_tokens')->where('digest', hash('sha256', $expired))->update(['expires_at' => now()]);
        DB::table('ticket_tokens')->where('digest', hash('sha256', $revoked))->update(['revoked_at' => now()]);
        $before = $this->ticket($secret)->assertOk()->json();
        $this->command($this->id('SESSION_C'), 'extend', ['ends_at' => '2026-11-07T19:00'])->assertOk();
        $after = $this->ticket($secret)->assertOk()->json();
        $this->assertSame($before['window_starts_at'], $after['window_starts_at']);
        $this->assertSame($before['window_ends_at'], $after['window_ends_at']);
        $expiry = DB::table('ticket_tokens')->where('digest', hash('sha256', $secret))->value('expires_at');
        $this->assertTrue(CarbonImmutable::parse($expiry)->equalTo('2026-11-09T16:00:00Z'));
        $this->ticket($expired)->assertNotFound();
        $this->ticket($revoked)->assertNotFound();
        $this->travelTo(CarbonImmutable::parse('2026-11-09T15:00:00Z'));
        $this->ticket($secret)->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-09T16:00:00Z'));
        $this->ticket($secret)->assertNotFound();
    }

    public function test_rescheduling_cannot_revive_an_effectively_expired_link_with_an_overlong_stored_expiry(): void
    {
        $secret = $this->tokenForBooking();
        DB::table('ticket_tokens')->where('digest', hash('sha256', $secret))->update(['expires_at' => '2026-11-10T15:00:00Z']);
        $this->travelTo(CarbonImmutable::parse('2026-11-09T15:00:00Z'));
        $this->owner();
        $this->ticket($secret)->assertNotFound();
        $future = $this->postJson('/workspace/sessions', ['doctor_id' => $this->id('DR_C'), 'starts_at' => '2026-11-09T19:00', 'ends_at' => '2026-11-09T20:00',
            'windows' => [['starts_at' => '2026-11-09T19:00', 'ends_at' => '2026-11-09T20:00', 'capacity' => 2]]])->assertCreated()->json('data.id');
        $window = DB::table('arrival_windows')->where('session_id', $future)->value('id');
        $this->ticketBookingCommand($this->id('BOOK_C1'), 'reschedule', ['reason_code' => 'schedule_change', 'session_id' => $future, 'window_id' => $window])->assertOk();
        $this->ticket($secret)->assertNotFound();
        $this->assertNotNull(DB::table('ticket_tokens')->where('digest', hash('sha256', $secret))->value('revoked_at'));
        $replacement = $this->secretFrom($this->renewTicket()->assertOk());
        $this->ticket($replacement)->assertOk()->assertJsonPath('booking_state', 'confirmed')->assertJsonPath('session_state', 'scheduled');
        $this->ticket($secret)->assertNotFound();
    }
}
