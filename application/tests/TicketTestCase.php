<?php

namespace Tests;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

abstract class TicketTestCase extends DoctorTestCase
{
    protected const TICKET_FIELDS = ['booking_state', 'visit_state', 'ticket_number', 'waiting_ahead', 'doctor_state', 'session_state', 'window_starts_at', 'window_ends_at', 'server_time', 'booking_version', 'visit_version'];

    protected const WAITING_ROOM_FIELDS = ['doctor_id', 'session_state', 'called_ticket_numbers', 'next_ticket_numbers', 'server_time'];

    protected function ticketRequest(array $data = [], ?string $key = null): TestResponse
    {
        return $this->postJson('/v1/booking-requests', [...[
            'session_id' => $this->id('SESSION_C'), 'window_id' => $this->id('W1_C'),
            'display_name' => 'مراجع رابط تجريبي', 'contact_phone' => '700000071',
        ], ...$data], ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    protected function ticketBookingCommand(string $booking, string $command, array $data = [], ?int $version = null, ?string $key = null): TestResponse
    {
        $version ??= (int) DB::table('bookings')->where('id', $booking)->value('version');

        return $this->postJson('/v1/bookings/'.$booking.'/'.$command, ['reason_code' => 'booking_reviewed', ...$data], $this->headers($version, $key));
    }

    protected function renewTicket(?string $booking = null, ?int $version = null, ?string $key = null, array $data = []): TestResponse
    {
        return $this->ticketBookingCommand($booking ?? $this->id('BOOK_C1'), 'ticket-link', ['reason_code' => 'patient_requested_recovery', 'verified_identity' => true, ...$data], $version, $key);
    }

    protected function secretFrom(TestResponse $response): string
    {
        $url = $response->json('ticket_url');
        $this->assertIsString($url);
        $this->assertSame('/ticket', parse_url($url, PHP_URL_PATH));
        $this->assertNull(parse_url($url, PHP_URL_QUERY));
        $secret = parse_url($url, PHP_URL_FRAGMENT);
        $this->assertIsString($secret);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/D', $secret);

        return $secret;
    }

    protected function tokenForBooking(?string $booking = null): string
    {
        $booking = DB::table('bookings')->where('id', $booking ?? $this->id('BOOK_C1'))->firstOrFail();
        $session = DB::table('clinic_sessions')->where('id', $booking->session_id)->firstOrFail();
        $secret = bin2hex(random_bytes(32));
        DB::table('ticket_tokens')->insert(['digest' => hash('sha256', $secret), 'clinic_id' => $booking->clinic_id, 'booking_id' => $booking->id,
            'expires_at' => CarbonImmutable::parse($session->ends_at)->addHours(48), 'created_at' => now()]);

        return $secret;
    }

    protected function ticket(string $secret): TestResponse
    {
        return $this->getJson('/v1/tickets/current', ['Authorization' => 'Bearer '.$secret]);
    }

    protected function waitingRoom(?string $session = null): TestResponse
    {
        return $this->getJson('/v1/sessions/'.($session ?? $this->id('SESSION_C')).'/waiting');
    }

    protected function assertPrivateResponse(TestResponse $response): void
    {
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $response->assertHeader('Referrer-Policy', 'no-referrer');
    }

    protected function ticketSnapshot(): array
    {
        $snapshot = [];
        foreach (['patients', 'bookings', 'visits', 'clinic_sessions', 'ticket_tokens', 'audit_events', 'outbox_messages', 'command_replays'] as $table) {
            $snapshot[$table] = DB::table($table)->orderBy($table === 'ticket_tokens' ? 'digest' : 'id')->get()->toArray();
        }

        return $snapshot;
    }
}
