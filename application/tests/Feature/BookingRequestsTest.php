<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\ClinicOperationsTestCase;

#[Group('postgres')]
class BookingRequestsTest extends ClinicOperationsTestCase
{
    private function payload(string $name = 'مراجع تجريبي'): array
    {
        return ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A'), 'display_name' => $name, 'contact_phone' => '٧٠٠٠٠٠٠٩٩'];
    }

    private function guest(): void
    {
        $this->user('DOCTOR_A');
        $this->get('/clinics/'.$this->id('CLINIC_A').'/book')->assertOk();
    }

    public function test_web_request_is_pending_without_reserving_capacity_or_creating_visit(): void
    {
        $this->guest();
        $reserved = DB::table('bookings')->where('window_id', $this->id('W1_A'))->whereIn('state', ['confirmed', 'fulfilled'])->count();
        $visits = DB::table('visits')->count();
        $result = $this->postJson('/v1/booking-requests', $this->payload(), $this->headers())->assertCreated()->assertJsonPath('state', 'pending')->assertJsonPath('version', 1);
        $this->assertDatabaseHas('patients', ['contact_phone' => '+967700000099', 'display_name' => 'مراجع تجريبي']);
        $this->assertDatabaseHas('bookings', ['id' => $result->json('id'), 'source' => 'web', 'state' => 'pending', 'visit_id' => null]);
        $this->assertSame($reserved, DB::table('bookings')->where('window_id', $this->id('W1_A'))->whereIn('state', ['confirmed', 'fulfilled'])->count());
        $this->assertSame($visits, DB::table('visits')->count());
        $this->assertStringNotContainsString('contact_phone', $result->getContent());
        $this->assertStringNotContainsString('ticket_number', $result->getContent());
        $event = DB::table('audit_events')->where('entity_id', $result->json('id'))->first();
        $this->assertSame('guest', $event->actor_kind);
        $this->assertNull($event->actor_membership_id);
        $this->assertNotNull($event->guest_id);
        $this->assertStringNotContainsString('مراجع', $event->safe_changes);
        $this->assertDatabaseHas('outbox_messages', ['event_id' => $event->id, 'status' => 'disabled']);
    }

    public function test_retry_returns_same_booking_without_a_second_patient_or_event(): void
    {
        $this->guest();
        $key = (string) Str::uuid();
        $before = DB::table('patients')->count();
        $first = $this->postJson('/v1/booking-requests', $this->payload(), $this->headers(key: $key))->assertCreated();
        $retry = $this->postJson('/v1/booking-requests', $this->payload(), $this->headers(key: $key))->assertCreated()->assertJsonPath('replayed', true);
        $this->assertSame($first->json('id'), $retry->json('id'));
        $this->assertSame($before + 1, DB::table('patients')->count());
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $first->json('id'))->count());
        $record = DB::table('command_replays')->first();
        $this->assertStringNotContainsString($first->json('id'), $record->response_ciphertext);
        $this->assertSame($first->json('id'), json_decode(Crypt::decryptString($record->response_ciphertext), true)['id']);
        $this->postJson('/v1/booking-requests', $this->payload('اسم مختلف'), $this->headers(key: $key))->assertConflict();
    }

    public function test_shared_phone_keeps_two_family_members_separate(): void
    {
        $this->guest();
        $a = $this->postJson('/v1/booking-requests', $this->payload('الأول تجريبي'), $this->headers())->assertCreated()->json('id');
        $b = $this->postJson('/v1/booking-requests', $this->payload('الثاني تجريبي'), $this->headers())->assertCreated()->json('id');
        $this->assertNotSame(DB::table('bookings')->where('id', $a)->value('patient_id'), DB::table('bookings')->where('id', $b)->value('patient_id'));
        $this->assertSame(2, DB::table('patients')->where('contact_phone', '+967700000099')->count());
    }

    public function test_each_guest_has_an_independent_scope_even_with_the_same_attempt_key(): void
    {
        $this->guest();
        $key = (string) Str::uuid();
        $first = $this->postJson('/v1/booking-requests', $this->payload(), $this->headers(key: $key))->assertCreated()->json('id');
        session()->forget('booking_guest_id');
        $this->guest();
        $second = $this->postJson('/v1/booking-requests', $this->payload(), $this->headers(key: $key))->assertCreated()->assertJsonPath('replayed', false)->json('id');
        $this->assertNotSame($first, $second);
        $this->assertSame(2, DB::table('command_replays')->distinct()->count('actor_scope_digest'));
    }

    public function test_expired_or_missing_guest_identity_cannot_create_or_replay(): void
    {
        $this->user('DOCTOR_A');
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers())->assertStatus(419);
        $this->guest();
        $key = (string) Str::uuid();
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers(key: $key))->assertCreated();
        DB::table('booking_guests')->update(['created_at' => now()->subHours(3), 'expires_at' => now()->subHour()]);
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers(key: $key))->assertStatus(419);
    }

    public function test_web_requires_contact_and_rejects_forged_identity_and_clinic(): void
    {
        $this->guest();
        foreach ([['contact_phone' => null], ['contact_phone' => '123'], ['display_name' => ' '], ['clinic_id' => $this->id('CLINIC_B')], ['patient_id' => $this->id('PAT_A1')], ['guest_id' => (string) Str::uuid()], ['state' => 'confirmed'], ['source' => 'walk_in']] as $change) {
            $this->postJson('/v1/booking-requests', [...$this->payload(), ...$change], $this->headers())->assertUnprocessable();
        }
        $this->assertSame(0, DB::table('command_replays')->count());
    }

    public function test_reception_can_create_direct_without_phone_but_phone_source_needs_it(): void
    {
        $this->user('DOCTOR_A');
        $this->signIn('RECEPTION_A');
        $this->postJson('/v1/booking-requests', [...$this->payload(), 'source' => 'walk_in', 'contact_phone' => null], $this->headers())->assertCreated();
        $this->postJson('/v1/booking-requests', [...$this->payload(), 'source' => 'phone', 'contact_phone' => null], $this->headers())->assertUnprocessable();
        $this->postJson('/v1/booking-requests', ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A'), 'source' => 'phone', 'patient_id' => $this->id('PAT_A1')], $this->headers())->assertCreated();
        $this->postJson('/v1/booking-requests', ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A'), 'source' => 'walk_in', 'patient_id' => $this->id('PAT_B1')], $this->headers())->assertNotFound();
    }

    public function test_existing_patient_web_or_phone_request_requires_saved_contact(): void
    {
        $this->user('DOCTOR_A');
        $this->signIn('RECEPTION_A');
        DB::table('patients')->where('id', $this->id('PAT_A1'))->update(['contact_phone' => null]);
        $data = ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A'), 'patient_id' => $this->id('PAT_A1')];
        foreach (['web', 'phone'] as $source) {
            $this->postJson('/v1/booking-requests', [...$data, 'source' => $source], $this->headers())->assertUnprocessable();
        }
        $this->postJson('/v1/booking-requests', [...$data, 'source' => 'walk_in'], $this->headers())->assertCreated();
    }

    public function test_staff_cannot_forge_cross_clinic_or_use_public_route_to_bypass_mfa_or_role(): void
    {
        $this->user('DOCTOR_A');
        $this->signIn('RECEPTION_A');
        $this->postJson('/v1/booking-requests', [...$this->payload(), 'session_id' => $this->id('SESSION_B'), 'window_id' => $this->id('W1_B')], $this->headers())->assertNotFound();
        $this->signIn('DOCTOR_A');
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers())->assertForbidden();
        $this->signIn('OWNER_A');
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers())->assertStatus(423);
    }

    public function test_closed_ended_unavailable_and_foreign_window_requests_do_not_leave_orphans(): void
    {
        $this->guest();
        $before = DB::table('patients')->count();
        $this->postJson('/v1/booking-requests', [...$this->payload(), 'window_id' => $this->id('W1_B')], $this->headers())->assertNotFound();
        DB::table('clinic_sessions')->where('id', $this->id('SESSION_A'))->update(['state' => 'closed']);
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers())->assertConflict();
        DB::table('clinic_sessions')->where('id', $this->id('SESSION_A'))->update(['state' => 'open']);
        DB::table('doctors')->where('id', $this->id('DR_A'))->update(['active' => false]);
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers())->assertConflict();
        DB::table('doctors')->where('id', $this->id('DR_A'))->update(['active' => true]);
        $this->travelTo(CarbonImmutable::parse(DB::table('clinic_sessions')->where('id', $this->id('SESSION_A'))->value('ends_at')));
        $this->guest();
        $this->postJson('/v1/booking-requests', $this->payload(), $this->headers())->assertConflict();
        $this->assertSame($before, DB::table('patients')->count());
    }

    public function test_public_page_exposes_only_published_schedule_and_no_patient_lists(): void
    {
        $this->guest();
        $this->get('/clinics/'.$this->id('CLINIC_A').'/book')->assertOk()->assertDontSee($this->id('PAT_A1'))->assertDontSee($this->id('MEM_OWNER_A'))->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $this->getJson('/v1/bookings')->assertUnauthorized();
        DB::table('clinics')->where('id', $this->id('CLINIC_A'))->update(['operational_state' => 'suspended']);
        $this->get('/clinics/'.$this->id('CLINIC_A').'/book')->assertNotFound();
    }
}
