<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\Group;
use Tests\ClinicOperationsTestCase;

#[Group('postgres')]
class BookingCommandsTest extends ClinicOperationsTestCase
{
    private function pending(): string
    {
        $this->owner();

        return $this->postJson('/v1/booking-requests', ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W2_A'), 'display_name' => 'مراجع صناعي', 'contact_phone' => '+967700000099', 'source' => 'phone'], $this->headers())->assertCreated()->json('id');
    }

    private function action(string $id, string $command, int $version = 1, ?string $key = null): TestResponse
    {
        return $this->postJson('/v1/bookings/'.$id.'/'.$command, ['reason_code' => 'patient_request'], $this->headers($version, $key));
    }

    public function test_confirm_reserves_capacity_and_cancel_releases_it_without_creating_a_visit(): void
    {
        $id = $this->pending();
        $this->action($id, 'confirm')->assertOk()->assertJsonPath('state', 'confirmed')->assertJsonPath('version', 2);
        $this->action($id, 'cancel', 2)->assertOk()->assertJsonPath('state', 'cancelled')->assertJsonPath('version', 3);
        $this->assertDatabaseMissing('visits', ['booking_id' => $id]);
        $this->assertSame(3, DB::table('audit_events')->where('entity_id', $id)->count());
        $this->assertSame(3, DB::table('outbox_messages')->whereIn('event_id', DB::table('audit_events')->where('entity_id', $id)->pluck('id'))->where('status', 'disabled')->count());
    }

    public function test_reject_and_cancel_pending_are_terminal_and_reasoned(): void
    {
        $id = $this->pending();
        $this->action($id, 'reject')->assertOk()->assertJsonPath('state', 'rejected');
        $this->action($id, 'confirm', 2)->assertConflict();
        $this->action($id, 'cancel', 2)->assertConflict();
        $this->assertDatabaseHas('audit_events', ['entity_id' => $id, 'event_type' => 'booking_reject', 'reason_code' => 'patient_request']);
        $other = $this->pending();
        $this->action($other, 'cancel')->assertOk();
        $this->action($other, 'confirm', 2)->assertConflict();
    }

    public function test_capacity_full_counts_fulfilled_and_preserves_pending_version_and_audit(): void
    {
        $id = $this->pending();
        DB::table('arrival_windows')->where('id', $this->id('W2_A'))->update(['capacity' => 1]);
        DB::table('bookings')->where('id', $this->id('BOOK_A2'))->update(['window_id' => $this->id('W2_A'), 'state' => 'fulfilled']);
        $this->action($id, 'confirm')->assertConflict();
        $this->assertDatabaseHas('bookings', ['id' => $id, 'state' => 'pending', 'version' => 1]);
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $id)->count());
    }

    public function test_replay_precedes_stale_version_but_still_requires_current_membership(): void
    {
        $id = $this->pending();
        $key = (string) Str::uuid();
        $a = $this->action($id, 'confirm', key: $key)->assertOk();
        $b = $this->action($id, 'confirm', key: $key)->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame($a->json('request_id'), $b->json('request_id'));
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $id)->where('event_type', 'booking_confirm')->count());
        $this->action($id, 'confirm', 2, $key)->assertConflict();
        $this->action($id, 'cancel')->assertConflict();
        DB::table('memberships')->where('id', $this->id('MEM_OWNER_A'))->update(['active' => false]);
        $this->action($id, 'confirm', key: $key)->assertNotFound();
    }

    public function test_cancel_closes_waiting_away_and_called_without_losing_ticket_or_history(): void
    {
        $this->owner();
        foreach (['waiting', 'away', 'called'] as $state) {
            DB::table('bookings')->where('id', $this->id('BOOK_A1'))->update(['state' => 'confirmed', 'version' => 1]);
            DB::table('visits')->where('id', $this->id('VISIT_A1'))->update(['state' => $state, 'version' => 1]);
            $ticket = DB::table('visits')->where('id', $this->id('VISIT_A1'))->value('ticket_number');
            $this->action($this->id('BOOK_A1'), 'cancel')->assertOk();
            $this->assertDatabaseHas('visits', ['id' => $this->id('VISIT_A1'), 'state' => 'left', 'version' => 2, 'ticket_number' => $ticket]);
            $event = DB::table('audit_events')->where('entity_id', $this->id('BOOK_A1'))->orderByDesc('at')->get()->first(fn ($event) => json_decode($event->safe_changes, true)['old_visit_state'] === $state);
            $this->assertNotNull($event);
            $this->assertSame('left', json_decode($event->safe_changes, true)['visit_state']);
        }
    }

    public function test_cancel_never_undoes_started_or_completed_visit(): void
    {
        $this->owner();
        foreach (['in_service', 'completed', 'left'] as $state) {
            DB::table('visits')->where('id', $this->id('VISIT_A1'))->update(['state' => $state, 'started_at' => now()]);
            $this->action($this->id('BOOK_A1'), 'cancel')->assertConflict();
        }
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_A1'), 'state' => 'confirmed', 'version' => 1]);
        $this->assertSame(0, DB::table('audit_events')->where('entity_id', $this->id('BOOK_A1'))->count());
    }

    public function test_missing_reason_headers_forged_state_and_wrong_window_do_not_mutate(): void
    {
        $id = $this->pending();
        $url = '/v1/bookings/'.$id.'/confirm';
        $this->postJson($url, ['reason_code' => 'booking_reviewed'])->assertStatus(428);
        $this->postJson($url, ['reason_code' => 'booking_reviewed'], ['If-Match' => '1'])->assertUnprocessable();
        $this->postJson($url, [], $this->headers())->assertUnprocessable();
        $this->postJson($url, ['reason_code' => 'booking_reviewed', 'state' => 'fulfilled'], $this->headers())->assertUnprocessable();
        $this->assertDatabaseHas('bookings', ['id' => $id, 'state' => 'pending', 'version' => 1]);
    }

    public function test_scope_and_role_protect_reads_commands_and_platform_from_patients(): void
    {
        $id = $this->pending();
        $this->getJson('/v1/bookings/'.$id)->assertOk()->assertJsonPath('data.display_name', 'مراجع صناعي');
        $this->signIn('RECEPTION_B');
        $this->action($id, 'confirm')->assertNotFound();
        $this->getJson('/v1/bookings/'.$id)->assertNotFound();
        $this->signIn('DOCTOR_A');
        $this->action($id, 'confirm')->assertForbidden();
        $this->getJson('/v1/bookings')->assertForbidden();
        $this->signIn('PLATFORM', true);
        $this->getJson('/v1/bookings')->assertNotFound();
    }

    public function test_booking_changes_invalidate_prior_capacity_preview(): void
    {
        $this->owner();
        $preview = $this->preview(4);
        $this->postJson('/v1/booking-requests', ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A'), 'display_name' => 'معاينة صناعية', 'source' => 'walk_in'], $this->headers())->assertCreated();
        $this->command($this->id('SESSION_A'), 'capacity', ['window_id' => $this->id('W1_A'), 'capacity' => 4, 'preview_token' => $preview['preview_token'], 'acknowledged' => true])->assertConflict();
    }
}
