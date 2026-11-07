<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\ReceptionTestCase;

#[Group('postgres')]
class ReceptionArrivalTest extends ReceptionTestCase
{
    public function test_confirmed_check_in_is_atomic_and_does_not_reserve_capacity_twice(): void
    {
        DB::table('arrival_windows')->where('id', $this->id('W1_C'))->update(['capacity' => 1]);
        $result = $this->arrival()->assertCreated()->assertJsonPath('state', 'waiting')->assertJsonPath('ticket_number', 1)->assertJsonPath('booking_version', 2);
        $visit = $result->json('id');
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_C1'), 'state' => 'confirmed', 'version' => 2, 'visit_id' => $visit]);
        $this->assertDatabaseHas('clinic_sessions', ['id' => $this->id('SESSION_C'), 'version' => 2, 'ticket_counter' => 1, 'ready_counter' => 1]);
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'waiting', 'priority' => false, 'arrived_at' => now()]);
        $this->assertDatabaseHas('audit_events', ['entity_id' => $visit, 'event_type' => 'visit_check_in', 'reason_code' => 'arrival_verified']);
        $this->assertSame(2, DB::table('outbox_messages')->whereIn('event_id', DB::table('audit_events')->whereIn('entity_id', [$visit, $this->id('BOOK_C1')])->pluck('id'))->count());
        $this->assertSame(1, DB::table('bookings')->where('session_id', $this->id('SESSION_C'))->whereIn('state', ['confirmed', 'fulfilled'])->count());
    }

    public function test_retries_return_one_ticket_and_new_key_cannot_create_second_visit(): void
    {
        $key = (string) Str::uuid();
        $first = $this->arrival(key: $key)->assertCreated();
        $before = $this->receptionSnapshot();
        $this->arrival(key: $key)->assertCreated()->assertJsonPath('replayed', true)->assertJsonPath('id', $first->json('id'))->assertJsonPath('request_id', $first->json('request_id'));
        $this->assertEquals($before, $this->receptionSnapshot());
        $this->arrival(version: 2)->assertConflict();
        $this->arrival(version: 2, key: $key)->assertConflict();
        $this->assertSame(1, DB::table('visits')->where('booking_id', $this->id('BOOK_C1'))->count());
    }

    public function test_pending_cancelled_rejected_and_fulfilled_cannot_arrive(): void
    {
        foreach (['pending', 'cancelled', 'rejected', 'fulfilled'] as $state) {
            DB::table('bookings')->where('id', $this->id('BOOK_C1'))->update(['state' => $state]);
            $before = $this->receptionSnapshot();
            $this->arrival()->assertConflict();
            $this->assertEquals($before, $this->receptionSnapshot());
        }
    }

    public function test_early_arrival_rejected_and_late_arrival_keeps_actual_queue_order(): void
    {
        DB::table('bookings')->where('id', $this->id('BOOK_A2'))->update(['state' => 'confirmed']);
        $this->arrival($this->id('BOOK_A2'))->assertConflict();
        $this->travelTo(\Carbon\CarbonImmutable::parse('2026-11-07T14:10:00Z'));
        DB::table('bookings')->where('id', $this->id('BOOK_A2'))->update(['window_id' => $this->id('W1_A')]);
        $late = $this->arrival($this->id('BOOK_A2'))->assertCreated()->assertJsonPath('ticket_number', 2)->assertJsonPath('ready_sequence', 2);
        $this->assertDatabaseHas('audit_events', ['entity_id' => $late->json('id'), 'event_type' => 'visit_check_in', 'reason_code' => 'late_arrival']);
        $this->getJson('/v1/visits/'.$late->json('id'))->assertOk()->assertJsonPath('data.visit.waiting_position', 2);
    }

    public function test_paused_session_accepts_arrivals_but_closed_scheduled_and_end_boundary_do_not(): void
    {
        foreach (['scheduled', 'closed'] as $state) {
            DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->update(['state' => $state]);
            $this->arrival()->assertConflict();
        }
        DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->update(['state' => 'paused']);
        $this->arrival()->assertCreated();
        $this->travelTo(\Carbon\CarbonImmutable::parse('2026-11-07T15:00:00Z'));
        DB::table('bookings')->where('id', $this->id('BOOK_A2'))->update(['state' => 'confirmed']);
        $this->arrival($this->id('BOOK_A2'))->assertConflict();
        $this->walkIn()->assertConflict();
    }

    public function test_walk_in_creates_one_confirmed_booking_and_arrival_without_phone(): void
    {
        $key = (string) Str::uuid();
        $response = $this->walkIn(key: $key)->assertCreated()->assertJsonPath('state', 'waiting')->assertJsonPath('ticket_number', 1);
        $booking = DB::table('bookings')->where('id', $response->json('booking_id'))->first();
        $this->assertSame('confirmed', $booking->state);
        $this->assertSame('walk_in', $booking->source);
        $this->assertDatabaseHas('patients', ['id' => $booking->patient_id, 'display_name' => 'حضور مباشر صناعي', 'contact_phone' => null]);
        $before = $this->receptionSnapshot();
        $this->walkIn(key: $key)->assertCreated()->assertJsonPath('id', $response->json('id'))->assertJsonPath('replayed', true);
        $this->assertEquals($before, $this->receptionSnapshot());
        $this->walkIn('اسم آخر', key: $key)->assertConflict();
    }

    public function test_walk_in_full_capacity_leaves_no_partial_records_or_counter_gap(): void
    {
        DB::table('arrival_windows')->where('id', $this->id('W1_C'))->update(['capacity' => 1]);
        DB::table('bookings')->where('id', $this->id('BOOK_C1'))->update(['state' => 'fulfilled']);
        $before = $this->receptionSnapshot();
        $this->walkIn()->assertConflict();
        $this->assertEquals($before, $this->receptionSnapshot());
    }

    public function test_shared_phone_keeps_walk_in_people_distinct_and_normalizes_arabic_digits(): void
    {
        DB::table('arrival_windows')->where('id', $this->id('W1_C'))->update(['capacity' => 4]);
        $one = $this->walkIn('فرد أول من الأسرة', '٧٠٠٠٠٠٠٩٩')->assertCreated();
        $two = $this->walkIn('فرد ثان من الأسرة', '700000099')->assertCreated();
        $people = DB::table('bookings')->whereIn('id', [$one->json('booking_id'), $two->json('booking_id')])->pluck('patient_id');
        $this->assertCount(2, $people->unique());
        $this->assertSame(2, DB::table('patients')->whereIn('id', $people)->where('contact_phone', '+967700000099')->count());
    }

    public function test_walk_in_rejects_future_window_invalid_phone_blank_name_and_client_owned_fields(): void
    {
        $url = '/v1/sessions/'.$this->id('SESSION_C').'/walk-ins';
        $data = ['window_id' => $this->id('W1_C'), 'display_name' => 'اسم صناعي'];
        foreach (['display_name' => ' ', 'contact_phone' => '123', 'priority' => true, 'ticket_number' => 50, 'clinic_id' => $this->id('CLINIC_B')] as $field => $value) {
            $this->postJson($url, [...$data, $field => $value], $this->headers())->assertUnprocessable();
        }
        $this->postJson($url, [...$data, 'window_id' => $this->id('W2_C')], $this->headers())->assertConflict();
        $this->postJson($url, [...$data, 'window_id' => $this->id('W1_B')], $this->headers())->assertNotFound();
    }

    public function test_check_in_requires_headers_current_version_and_server_owned_time(): void
    {
        $url = '/v1/bookings/'.$this->id('BOOK_C1').'/check-in';
        $this->postJson($url, [])->assertStatus(428);
        $this->postJson($url, [], ['If-Match' => '1'])->assertUnprocessable();
        $this->postJson($url, [], $this->headers(9))->assertConflict();
        $this->postJson($url, ['arrived_at' => '2026-11-07T13:00:00Z'], $this->headers())->assertUnprocessable();
        $this->assertDatabaseMissing('visits', ['booking_id' => $this->id('BOOK_C1')]);
    }
}
