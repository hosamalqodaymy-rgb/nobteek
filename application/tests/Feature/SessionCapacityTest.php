<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\ClinicOperationsTestCase;

#[Group('postgres')]
class SessionCapacityTest extends ClinicOperationsTestCase
{
    private function payload(array $preview, int $capacity = 1): array
    {
        return ['window_id' => $this->id('W1_A'), 'capacity' => $capacity, 'preview_token' => $preview['preview_token'], 'acknowledged' => true];
    }

    public function test_t05b_preview_and_explicit_confirmation_adjust_capacity_without_touching_bookings(): void
    {
        $this->owner();
        $before = DB::table('bookings')->orderBy('id')->get()->toJson();
        $preview = $this->preview();
        $this->assertSame(1, $preview['reserved']);
        $this->assertSame(1, $preview['new_capacity']);
        $this->assertTrue($preview['can_apply']);
        $this->assertDatabaseHas('arrival_windows', ['id' => $this->id('W1_A'), 'capacity' => 2]);
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview))->assertOk()->assertJsonPath('version', 2);
        $this->assertDatabaseHas('arrival_windows', ['id' => $this->id('W1_A'), 'capacity' => 1]);
        $this->assertSame($before, DB::table('bookings')->orderBy('id')->get()->toJson());
        $event = DB::table('audit_events')->where('event_type', 'session_capacity')->first();
        $this->assertSame('capacity_adjustment', $event->reason_code);
        $this->assertSame(1, json_decode($event->safe_changes, true)['reserved']);
    }

    public function test_reservations_changing_after_preview_reject_stale_preview_and_too_low_capacity(): void
    {
        $this->owner();
        $preview = $this->preview();
        $booking = (array) DB::table('bookings')->where('id', $this->id('BOOK_A2'))->first();
        $booking['id'] = (string) Str::uuid();
        $booking['demo_code'] = null;
        $booking['window_id'] = $this->id('W1_A');
        $booking['state'] = 'fulfilled';
        DB::table('bookings')->insert($booking);
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview))->assertConflict();
        $new = $this->preview();
        $this->assertSame(2, $new['reserved']);
        $this->assertFalse($new['can_apply']);
        $this->assertNull($new['preview_token']);
        $this->assertDatabaseHas('arrival_windows', ['id' => $this->id('W1_A'), 'capacity' => 2]);
        $this->assertSame(0, DB::table('audit_events')->where('event_type', 'session_capacity')->count());
    }

    public function test_preview_is_bound_to_capacity_actor_and_expiry(): void
    {
        $this->owner();
        $preview = $this->preview();
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview, 3))->assertConflict();
        $member = (string) Str::uuid();
        DB::table('memberships')->insert(['id' => $member, 'clinic_id' => $this->id('CLINIC_A'), 'user_id' => $this->id('OWNER_B'), 'role' => 'owner']);
        $this->signIn('OWNER_B', true);
        $this->withSession(['membership_id' => $member]);
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview))->assertConflict();
        $this->owner();
        $this->travel(6)->minutes();
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview))->assertConflict();
        $this->assertSame(0, DB::table('command_replays')->count());
    }

    public function test_missing_acknowledgment_forged_token_and_foreign_window_do_not_change_capacity(): void
    {
        $this->owner();
        $preview = $this->preview();
        $this->command($this->id('SESSION_A'), 'capacity', [...$this->payload($preview), 'acknowledged' => false])->assertUnprocessable();
        $this->command($this->id('SESSION_A'), 'capacity', [...$this->payload($preview), 'preview_token' => 'invalid'])->assertUnprocessable();
        $this->postJson('/v1/sessions/'.$this->id('SESSION_A').'/capacity/preview', ['window_id' => $this->id('W1_B'), 'capacity' => 1], ['If-Match' => '1'])->assertNotFound();
        $this->assertSame(0, DB::table('command_replays')->count());
    }

    public function test_successful_capacity_retry_is_idempotent_and_delegation_is_not_inferred(): void
    {
        $this->owner();
        $preview = $this->preview();
        $key = (string) Str::uuid();
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview), key: $key)->assertOk();
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview), key: $key)->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'session_capacity')->count());
        $this->signIn('DOCTOR_A');
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview), key: $key)->assertForbidden();
        $this->signIn('RECEPTION_A');
        $this->postJson('/v1/sessions/'.$this->id('SESSION_A').'/capacity/preview', ['window_id' => $this->id('W1_A'), 'capacity' => 1], ['If-Match' => '2'])->assertForbidden();
    }

    public function test_pending_requests_do_not_reserve_capacity_but_the_preview_warns_when_they_will_not_fit(): void
    {
        $this->owner();
        DB::table('bookings')->where('id', $this->id('BOOK_A2'))->update(['window_id' => $this->id('W1_A')]);
        $preview = $this->preview();
        $this->assertTrue($preview['can_apply']);
        $this->assertSame(1, $preview['pending']);
        $this->assertSame(1, $preview['pending_exceeding_available']);
        $this->command($this->id('SESSION_A'), 'capacity', $this->payload($preview))->assertOk();
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_A2'), 'state' => 'pending']);
    }
}
