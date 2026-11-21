<?php

namespace Tests\Feature;

use App\Http\Middleware\HandleInertiaRequests;
use App\Services\TicketLinks;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use RuntimeException;
use Tests\TicketTestCase;

#[Group('postgres')]
class TicketSecurityTest extends TicketTestCase
{
    public function test_request_issues_a_random_fragment_link_and_only_digest_or_encrypted_replay_is_persisted(): void
    {
        $key = (string) Str::uuid();
        $first = $this->ticketRequest(key: $key)->assertCreated()->assertJsonPath('state', 'pending');
        $secret = $this->secretFrom($first);
        $booking = $first->json('id');
        $token = DB::table('ticket_tokens')->where('booking_id', $booking)->sole();
        $this->assertSame(hash('sha256', $secret), $token->digest);
        $this->assertNull($token->revoked_at);
        $this->assertTrue(CarbonImmutable::parse($token->expires_at)->equalTo('2026-11-09T15:00:00Z'));
        $this->assertTrue(CarbonImmutable::parse($first->json('ticket_expires_at'))->equalTo($token->expires_at));
        $record = DB::table('command_replays')->sole();
        $this->assertStringNotContainsString($secret, $record->response_ciphertext);
        $stored = json_decode(Crypt::decryptString($record->response_ciphertext), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame($first->json('ticket_url'), $stored['ticket_url']);
        foreach (['ticket_tokens', 'audit_events', 'outbox_messages', 'command_replays'] as $table) {
            $this->assertStringNotContainsString($secret, DB::table($table)->get()->toJson());
        }
        $before = $this->ticketSnapshot();
        $this->ticketRequest(key: $key)->assertCreated()->assertJsonPath('replayed', true)->assertJsonPath('ticket_url', $first->json('ticket_url'));
        $this->assertEquals($before, $this->ticketSnapshot());
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'pending')->assertJsonPath('ticket_number', null);
    }

    public function test_private_ticket_has_exact_contract_fields_and_never_serializes_identities_or_internal_records(): void
    {
        $this->arrivedVisit();
        $secret = $this->tokenForBooking();
        $response = $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'confirmed')->assertJsonPath('visit_state', 'waiting');
        $this->assertEqualsCanonicalizing(self::TICKET_FIELDS, array_keys($response->json()));
        $content = json_encode($response->json(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        foreach (DB::table('patients')->get() as $patient) {
            $this->assertStringNotContainsString($patient->id, $content);
            $this->assertStringNotContainsString($patient->display_name, $content);
            if ($patient->contact_phone) {
                $this->assertStringNotContainsString($patient->contact_phone, $content);
            }
        }
        foreach ([$secret, hash('sha256', $secret), $this->id('BOOK_C1'), $this->id('SESSION_C'), $this->id('DR_C'), 'clinical_priority', 'response_ciphertext'] as $private) {
            $this->assertStringNotContainsString($private, $content);
        }
        $this->assertPrivateResponse($response);
        $this->getJson('/v1/tickets/'.$secret)->assertOk()->assertExactJson($response->json());
        Auth::logout();
        session()->invalidate();
        $this->ticket($secret)->assertOk()->assertExactJson($response->json());
    }

    public function test_walk_in_issues_one_private_link_and_replaying_it_after_recovery_cannot_restore_the_old_link(): void
    {
        $key = (string) Str::uuid();
        $receipt = $this->walkIn('مراجع حضور برابط صناعي', key: $key)->assertCreated();
        $secret = $this->secretFrom($receipt);
        $booking = $receipt->json('booking_id');
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'confirmed')->assertJsonPath('visit_state', 'waiting')->assertJsonPath('ticket_number', 1);
        $before = $this->ticketSnapshot();
        $this->walkIn('مراجع حضور برابط صناعي', key: $key)->assertCreated()->assertJsonPath('replayed', true)->assertJsonPath('ticket_url', $receipt->json('ticket_url'));
        $this->assertEquals($before, $this->ticketSnapshot());
        $replacement = $this->secretFrom($this->renewTicket($booking)->assertOk());
        $before = $this->ticketSnapshot();
        $this->walkIn('مراجع حضور برابط صناعي', key: $key)->assertConflict();
        $this->assertEquals($before, $this->ticketSnapshot());
        $this->ticket($secret)->assertNotFound();
        $this->ticket($replacement)->assertOk()->assertJsonPath('ticket_number', 1);
    }

    public function test_ticket_numbers_identifiers_unknown_revoked_and_expired_tokens_have_the_same_private_not_found_result(): void
    {
        $secret = $this->tokenForBooking();
        $invalid = $this->ticket(str_repeat('f', 64))->assertNotFound();
        $this->assertPrivateResponse($invalid);
        foreach (['1', $this->id('BOOK_C1'), hash('sha256', $secret), str_repeat('a', 63), strtoupper($secret)] as $guess) {
            $response = $this->ticket($guess)->assertNotFound();
            $this->assertSame($invalid->json(), $response->json());
            $this->assertPrivateResponse($response);
        }
        DB::table('ticket_tokens')->where('digest', hash('sha256', $secret))->update(['revoked_at' => now()]);
        $this->ticket($secret)->assertNotFound()->assertExactJson($invalid->json());
        $expired = $this->tokenForBooking();
        $this->travelTo(CarbonImmutable::parse('2026-11-09T15:00:00Z'));
        $this->ticket($expired)->assertNotFound()->assertExactJson($invalid->json());
        $this->getJson('/v1/tickets/current')->assertNotFound()->assertExactJson($invalid->json());
        $legacy = $this->getJson('/v1/tickets/not-a-ticket')->assertNotFound()->assertExactJson($invalid->json());
        $this->assertPrivateResponse($legacy);
    }

    public function test_link_expires_at_exactly_48_hours_after_session_end_even_if_the_stored_expiry_is_later(): void
    {
        $secret = $this->tokenForBooking();
        DB::table('ticket_tokens')->where('digest', hash('sha256', $secret))->update(['expires_at' => '2026-11-10T15:00:00Z']);
        $this->travelTo(CarbonImmutable::parse('2026-11-09T14:59:59Z'));
        $this->ticket($secret)->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-09T15:00:00Z'));
        $this->ticket($secret)->assertNotFound();
    }

    public function test_query_identifiers_and_phone_cannot_select_a_different_booking_or_recover_a_link(): void
    {
        $secret = $this->tokenForBooking();
        foreach (['booking_id' => $this->id('BOOK_B1'), 'patient_id' => $this->id('PAT_A1'), 'clinic_id' => $this->id('CLINIC_B'), 'phone' => '700000001', 'secret' => $secret] as $field => $value) {
            $response = $this->getJson('/v1/tickets/current?'.http_build_query([$field => $value]), ['Authorization' => 'Bearer '.$secret])->assertUnprocessable();
            $this->assertArrayNotHasKey('booking_state', $response->json());
            $this->assertStringNotContainsString($secret, $response->getContent());
        }
        $this->getJson('/v1/tickets/current?secret='.$secret)->assertUnprocessable();
        $this->ticket($secret)->assertOk()->assertJsonPath('ticket_number', null);
    }

    public function test_shared_phone_and_independent_guest_attempts_never_share_a_token_or_replay_identity(): void
    {
        Auth::logout();
        session()->invalidate();
        $key = (string) Str::uuid();
        $this->get('/clinics/'.$this->id('CLINIC_A').'/book')->assertOk();
        $first = $this->ticketRequest(key: $key)->assertCreated();
        $firstSecret = $this->secretFrom($first);
        session()->invalidate();
        $this->get('/clinics/'.$this->id('CLINIC_A').'/book')->assertOk();
        $second = $this->ticketRequest(key: $key)->assertCreated();
        $secondSecret = $this->secretFrom($second);
        $this->assertNotSame($firstSecret, $secondSecret);
        $this->assertNotSame($first->json('id'), $second->json('id'));
        $this->assertSame(2, DB::table('command_replays')->count());
        $this->assertSame(2, DB::table('patients')->where('contact_phone', '+967700000071')->count());
        $this->owner();
        $this->ticketBookingCommand($first->json('id'), 'reject', ['reason_code' => 'capacity_full'])->assertOk();
        Auth::logout();
        session()->invalidate();
        $this->ticket($firstSecret)->assertOk()->assertJsonPath('booking_state', 'rejected');
        $this->ticket($secondSecret)->assertOk()->assertJsonPath('booking_state', 'pending');
    }

    public function test_private_ticket_lookup_uses_its_capability_without_inheriting_a_signed_in_staff_clinic(): void
    {
        $secret = $this->tokenForBooking($this->id('BOOK_B1'));
        $this->ticket($secret)->assertOk()->assertJsonPath('ticket_number', 1)->assertJsonPath('visit_state', 'waiting');
        $this->getJson('/v1/bookings/'.$this->id('BOOK_B1'))->assertNotFound();
    }

    public function test_a_stale_staff_login_does_not_block_a_valid_capability_or_grant_staff_access(): void
    {
        $secret = $this->tokenForBooking();
        DB::table('users')->where('id', $this->id('OWNER_A'))->increment('security_version');
        $this->ticket($secret)->assertOk()->assertJsonPath('booking_state', 'confirmed');
        $this->waitingRoom()->assertUnauthorized();
        $this->get('/ticket')->assertOk();
        $this->renewTicket()->assertUnauthorized();
    }

    public function test_direct_legacy_navigation_is_stateless_and_does_not_save_the_secret_as_a_previous_url(): void
    {
        $secret = $this->tokenForBooking();
        $previous = 'http://localhost/help';
        $this->withSession(['_previous' => ['url' => $previous]]);
        $response = $this->get('/v1/tickets/'.$secret)->assertOk();
        $this->assertEqualsCanonicalizing(self::TICKET_FIELDS, array_keys($response->json()));
        $this->assertSame($previous, session('_previous.url'));
        $this->assertStringNotContainsString($secret, json_encode(session()->all(), JSON_THROW_ON_ERROR));
        $this->assertPrivateResponse($response);
    }

    public function test_ticket_failures_hide_secrets_and_stack_details_even_with_debug_enabled(): void
    {
        $secret = $this->tokenForBooking();
        config(['app.debug' => true]);
        Log::spy();
        $this->mock(TicketLinks::class)->shouldReceive('read')->once()->with($secret)->andThrow(new RuntimeException('Synthetic private failure '.$secret));
        $response = $this->getJson('/v1/tickets/'.$secret)->assertStatus(500);
        $this->assertSame(['message'], array_keys($response->json()));
        $this->assertStringNotContainsString($secret, $response->getContent());
        $this->assertStringNotContainsString('Synthetic private failure', $response->getContent());
        $this->assertPrivateResponse($response);
        Log::shouldHaveReceived('error')->once()->withArgs(function (string $message, array $context) use ($secret): bool {
            $this->assertStringNotContainsString($secret, $message);
            $this->assertStringNotContainsString($secret, json_encode($context, JSON_THROW_ON_ERROR));
            $this->assertSame(RuntimeException::class, $context['error_type']);
            $this->assertEqualsCanonicalizing(['error_type', 'request_id'], array_keys($context));

            return true;
        });
    }

    public function test_a_mismatched_deferred_visit_reference_fails_closed_instead_of_disclosing_another_booking(): void
    {
        $secret = $this->tokenForBooking();
        DB::table('bookings')->where('id', $this->id('BOOK_C1'))->update(['visit_id' => $this->id('VISIT_A1')]);
        $this->ticket($secret)->assertNotFound();
        $this->getJson('/v1/tickets/'.$secret)->assertNotFound();
        DB::table('bookings')->where('id', $this->id('BOOK_C1'))->update(['visit_id' => null]);
        $this->ticket($secret)->assertOk()->assertJsonPath('visit_state', null)->assertJsonPath('ticket_number', null);
    }

    public function test_public_pages_and_hall_do_not_include_staff_authentication_or_private_flash_props(): void
    {
        $secret = 'synthetic-sensitive-grant';
        $staff = $this->user('OWNER_A');
        foreach (['/ticket', '/help', '/privacy', '/clinics/'.$this->id('CLINIC_A').'/book', '/workspace/sessions/'.$this->id('SESSION_C').'/waiting'] as $path) {
            $this->withSession(['private_notice' => Crypt::encryptString(json_encode(['grant_token' => $secret], JSON_THROW_ON_ERROR)), 'status' => $secret]);
            $headers = ['X-Inertia' => 'true', 'X-Requested-With' => 'XMLHttpRequest'];
            $version = app(HandleInertiaRequests::class)->version(Request::create($path));
            if ($version !== null) {
                $headers['X-Inertia-Version'] = $version;
            }
            $response = $this->get($path, $headers)->assertOk();
            $props = $response->json('props');
            $this->assertIsArray($props);
            foreach (['auth', 'privateNotice', 'status', 'errors', 'doctor_workspace_allowed'] as $field) {
                $this->assertArrayNotHasKey($field, $props);
            }
            $content = json_encode($response->json(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            foreach ([$secret, $staff->display_name, $staff->username] as $private) {
                $this->assertStringNotContainsString($private, $content);
            }
            $this->assertPrivateResponse($response);
        }
    }
}
