<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TicketTestCase;

#[Group('postgres')]
class TicketRecoveryTest extends TicketTestCase
{
    public function test_verified_recovery_revokes_every_previous_link_and_audits_one_versioned_effect(): void
    {
        $first = $this->tokenForBooking();
        $second = $this->tokenForBooking();
        $key = (string) Str::uuid();
        $receipt = $this->renewTicket(version: 1, key: $key)->assertOk()->assertJsonPath('version', 2)->assertJsonPath('replayed', false);
        $newSecret = $this->secretFrom($receipt);
        $this->assertNotSame($first, $newSecret);
        $this->assertNotSame($second, $newSecret);
        $this->ticket($first)->assertNotFound();
        $this->ticket($second)->assertNotFound();
        $this->ticket($newSecret)->assertOk()->assertJsonPath('booking_version', 2)->assertJsonPath('booking_state', 'confirmed');
        $this->assertSame(1, DB::table('ticket_tokens')->where('booking_id', $this->id('BOOK_C1'))->whereNull('revoked_at')->count());
        $event = DB::table('audit_events')->where('event_type', 'booking_ticket-link')->sole();
        $this->assertSame('patient_requested_recovery', $event->reason_code);
        $this->assertSame($this->id('BOOK_C1'), $event->entity_id);
        $this->assertSame(1, DB::table('outbox_messages')->where('event_id', $event->id)->where('status', 'disabled')->count());
        $this->assertStringNotContainsString($newSecret, $event->safe_changes);
        $before = $this->ticketSnapshot();
        $this->renewTicket(version: 1, key: $key)->assertOk()->assertJsonPath('replayed', true)->assertJsonPath('ticket_url', $receipt->json('ticket_url'));
        $this->assertEquals($before, $this->ticketSnapshot());
    }

    public function test_old_creation_and_rotation_replays_cannot_restore_a_superseded_link(): void
    {
        $createKey = (string) Str::uuid();
        $created = $this->ticketRequest(key: $createKey)->assertCreated();
        $booking = $created->json('id');
        $createdSecret = $this->secretFrom($created);
        $rotateKey = (string) Str::uuid();
        $rotated = $this->renewTicket($booking, 1, $rotateKey)->assertOk();
        $rotatedSecret = $this->secretFrom($rotated);
        $latest = $this->renewTicket($booking, 2)->assertOk();
        $latestSecret = $this->secretFrom($latest);
        $before = $this->ticketSnapshot();
        $this->ticketRequest(key: $createKey)->assertConflict();
        $this->renewTicket($booking, 1, $rotateKey)->assertConflict();
        $this->assertEquals($before, $this->ticketSnapshot());
        $this->ticket($createdSecret)->assertNotFound();
        $this->ticket($rotatedSecret)->assertNotFound();
        $this->ticket($latestSecret)->assertOk()->assertJsonPath('booking_version', 3);
        $this->assertSame(1, DB::table('ticket_tokens')->where('booking_id', $booking)->whereNull('revoked_at')->count());
    }

    public function test_recovery_requires_verified_identity_fixed_reason_version_and_attempt_key(): void
    {
        $url = '/v1/bookings/'.$this->id('BOOK_C1').'/ticket-link';
        $data = ['reason_code' => 'patient_requested_recovery', 'verified_identity' => true];
        $before = $this->ticketSnapshot();
        $this->postJson($url, $data)->assertStatus(428);
        $this->postJson($url, $data, ['If-Match' => '1'])->assertUnprocessable();
        $this->postJson($url, ['reason_code' => 'patient_requested_recovery'], $this->headers())->assertUnprocessable();
        $this->renewTicket(data: ['verified_identity' => false])->assertUnprocessable();
        $this->renewTicket(data: ['verified_identity' => 'yes'])->assertUnprocessable();
        $this->renewTicket(data: ['reason_code' => 'phone_matched'])->assertUnprocessable();
        $this->renewTicket(version: 99)->assertConflict();
        foreach (['clinic_id' => $this->id('CLINIC_B'), 'patient_id' => $this->id('PAT_A1'), 'secret' => str_repeat('a', 64), 'expires_at' => '2099-01-01T00:00:00Z', 'version' => 1] as $field => $value) {
            $this->postJson($url, [...$data, $field => $value], $this->headers())->assertUnprocessable();
        }
        $this->assertEquals($before, $this->ticketSnapshot());
    }

    public function test_only_owner_and_reception_in_the_booking_clinic_can_recover_a_link(): void
    {
        $this->doctor();
        $this->renewTicket()->assertForbidden();
        $this->signIn('OWNER_B', true);
        $this->renewTicket()->assertNotFound();
        $this->signIn('PLATFORM', true);
        $this->renewTicket()->assertNotFound();
        Auth::logout();
        session()->invalidate();
        $this->renewTicket()->assertUnauthorized();
        $this->signIn('RECEPTION_A');
        $secret = $this->secretFrom($this->renewTicket()->assertOk());
        $this->ticket($secret)->assertOk();
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'booking_ticket-link')->count());
    }

    public function test_recovery_replay_rechecks_current_membership_before_returning_a_secret(): void
    {
        $this->signIn('RECEPTION_A');
        $key = (string) Str::uuid();
        $this->renewTicket(version: 1, key: $key)->assertOk();
        DB::table('memberships')->where('id', $this->id('MEM_RECEPTION_A'))->update(['active' => false]);
        $before = $this->ticketSnapshot();
        $response = $this->renewTicket(version: 1, key: $key)->assertNotFound();
        $this->assertArrayNotHasKey('ticket_url', $response->json());
        $this->assertEquals($before, $this->ticketSnapshot());
    }

    public function test_a_reused_key_for_another_booking_or_version_cannot_rotate_either_link(): void
    {
        $key = (string) Str::uuid();
        $this->renewTicket(version: 1, key: $key)->assertOk();
        $before = $this->ticketSnapshot();
        $this->renewTicket(version: 2, key: $key)->assertConflict();
        $this->renewTicket($this->id('BOOK_A2'), 1, $key)->assertConflict();
        $this->assertEquals($before, $this->ticketSnapshot());
    }

    public function test_recovery_cannot_extend_the_lifetime_after_session_expiry(): void
    {
        $secret = $this->tokenForBooking();
        $this->travelTo(CarbonImmutable::parse('2026-11-09T15:00:00Z'));
        $this->owner();
        $before = $this->ticketSnapshot();
        $this->renewTicket()->assertConflict();
        $this->assertEquals($before, $this->ticketSnapshot());
        $this->ticket($secret)->assertNotFound();
    }

    public function test_recovery_booking_list_uses_the_full_yemen_calendar_day_without_adjacent_dates(): void
    {
        $bookings = [];
        foreach (['previous' => '2026-11-06T23:59:00', 'first' => '2026-11-07T00:00:00', 'last' => '2026-11-07T23:59:00', 'next' => '2026-11-08T00:00:00'] as $label => $local) {
            $start = CarbonImmutable::parse($local, 'Asia/Aden')->utc();
            $end = $start->addSeconds(30);
            $session = (string) Str::uuid();
            $window = (string) Str::uuid();
            $booking = (string) Str::uuid();
            DB::table('clinic_sessions')->insert(['id' => $session, 'clinic_id' => $this->id('CLINIC_A'), 'doctor_id' => $this->id('DR_C'),
                'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(), 'state' => 'scheduled']);
            DB::table('arrival_windows')->insert(['id' => $window, 'clinic_id' => $this->id('CLINIC_A'), 'session_id' => $session,
                'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(), 'capacity' => 1]);
            DB::table('bookings')->insert(['id' => $booking, 'clinic_id' => $this->id('CLINIC_A'), 'patient_id' => $this->id('PAT_A2'),
                'session_id' => $session, 'window_id' => $window, 'source' => 'web', 'state' => 'pending']);
            $bookings[$label] = $booking;
        }
        $response = $this->getJson('/v1/bookings?date=2026-11-07')->assertOk();
        $this->assertEqualsCanonicalizing([$this->id('BOOK_A1'), $this->id('BOOK_A2'), $this->id('BOOK_C1'), $bookings['first'], $bookings['last']], array_column($response->json('bookings'), 'id'));
    }
}
