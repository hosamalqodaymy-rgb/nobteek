<?php

namespace Tests\Feature;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\Group;
use Tests\ClinicOperationsTestCase;

#[Group('postgres')]
class BookingRescheduleTest extends ClinicOperationsTestCase
{
    private function action(string $id, array $target, int $version = 1, ?string $key = null): TestResponse
    {
        return $this->postJson('/v1/bookings/'.$id.'/reschedule', ['reason_code' => 'schedule_change', ...$target], $this->headers($version, $key));
    }

    private function pending(): string
    {
        return $this->postJson('/v1/booking-requests', ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A'), 'display_name' => 'حجز تأجيل صناعي', 'source' => 'walk_in'], $this->headers())->assertCreated()->json('id');
    }

    public function test_confirmed_reschedule_is_atomic_and_retains_state_patient_and_no_visit(): void
    {
        $this->owner();
        $id = $this->id('BOOK_A2');
        DB::table('bookings')->where('id', $id)->update(['state' => 'confirmed']);
        $old = DB::table('bookings')->where('id', $id)->first();
        $this->action($id, ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A')])->assertOk()->assertJsonPath('state', 'confirmed')->assertJsonPath('version', 2);
        $this->assertDatabaseHas('bookings', ['id' => $id, 'patient_id' => $old->patient_id, 'window_id' => $this->id('W1_A')]);
        $this->assertDatabaseMissing('visits', ['booking_id' => $id]);
        $this->assertDatabaseHas('audit_events', ['entity_id' => $id, 'event_type' => 'booking_reschedule']);
    }

    public function test_full_destination_preserves_origin_version_tokens_and_all_events(): void
    {
        $this->owner();
        $this->user('DOCTOR_C');
        $id = $this->id('BOOK_A2');
        DB::table('bookings')->where('id', $id)->update(['state' => 'confirmed']);
        DB::table('bookings')->where('id', $this->id('BOOK_C1'))->update(['state' => 'fulfilled']);
        DB::table('arrival_windows')->where('id', $this->id('W1_C'))->update(['capacity' => 1]);
        $before = DB::table('bookings')->where('id', $id)->first();
        $this->action($id, ['session_id' => $this->id('SESSION_C'), 'window_id' => $this->id('W1_C')])->assertConflict();
        $this->assertEquals($before, DB::table('bookings')->where('id', $id)->first());
        $this->assertSame(0, DB::table('command_replays')->count());
        $this->assertSame(0, DB::table('audit_events')->where('event_type', 'like', 'booking_%')->count());
    }

    public function test_pending_can_move_to_full_destination_without_reserving_it(): void
    {
        $this->owner();
        $this->user('DOCTOR_C');
        $id = $this->pending();
        DB::table('arrival_windows')->where('id', $this->id('W1_C'))->update(['capacity' => 1]);
        $this->action($id, ['session_id' => $this->id('SESSION_C'), 'window_id' => $this->id('W1_C')])->assertOk()->assertJsonPath('state', 'pending');
        $this->assertSame(1, DB::table('bookings')->where('window_id', $this->id('W1_C'))->whereIn('state', ['confirmed', 'fulfilled'])->count());
    }

    public function test_reschedule_cannot_move_any_arrived_booking_even_if_visit_already_left(): void
    {
        $this->owner();
        foreach (['waiting', 'away', 'called', 'left'] as $state) {
            DB::table('visits')->where('id', $this->id('VISIT_A1'))->update(['state' => $state]);
            $this->action($this->id('BOOK_A1'), ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A')])->assertConflict();
        }
    }

    public function test_reschedule_checks_current_version_and_replays_only_identical_command(): void
    {
        $this->owner();
        $id = $this->id('BOOK_A2');
        $target = ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A')];
        $key = (string) Str::uuid();
        $this->action($id, $target, key: $key)->assertOk();
        $this->action($id, $target, key: $key)->assertOk()->assertJsonPath('replayed', true)->assertJsonPath('version', 2);
        $this->action($id, ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W2_A')], key: $key)->assertConflict();
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $id)->count());
    }

    public function test_foreign_session_foreign_window_same_window_and_terminal_states_are_rejected(): void
    {
        $this->owner();
        $id = $this->id('BOOK_A2');
        $this->action($id, ['session_id' => $this->id('SESSION_B'), 'window_id' => $this->id('W1_B')])->assertNotFound();
        $this->action($id, ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_B')])->assertNotFound();
        $this->action($id, ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W2_A')])->assertUnprocessable();
        foreach (['rejected', 'cancelled', 'fulfilled'] as $state) {
            DB::table('bookings')->where('id', $id)->update(['state' => $state]);
            $this->action($id, ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W1_A')])->assertConflict();
        }
    }

    public function test_future_scheduled_session_accepts_booking_without_opening_intake(): void
    {
        $this->owner();
        $target = $this->scheduled();
        $window = DB::table('arrival_windows')->where('session_id', $target)->orderBy('starts_at')->value('id');
        $this->action($this->id('BOOK_A2'), ['session_id' => $target, 'window_id' => $window])->assertOk();
        $this->assertDatabaseHas('clinic_sessions', ['id' => $target, 'state' => 'scheduled']);
    }

    public function test_intake_end_expired_window_and_closed_destination_reject_new_confirmation(): void
    {
        $this->owner();
        $id = $this->pending();
        $this->travel(40)->minutes();
        $this->postJson('/v1/bookings/'.$id.'/confirm', ['reason_code' => 'booking_reviewed'], $this->headers())->assertConflict();
        $this->action($id, ['session_id' => $this->id('SESSION_A'), 'window_id' => $this->id('W2_A')])->assertOk();
        $this->travel(3)->hours();
        $this->postJson('/v1/bookings/'.$id.'/confirm', ['reason_code' => 'booking_reviewed'], $this->headers(2))->assertConflict();
    }

    public function test_failed_outbox_insert_rolls_back_booking_patient_versions_event_and_replay(): void
    {
        $this->owner();
        DB::unprepared("CREATE FUNCTION p06_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback check'; END $$; CREATE TRIGGER p06_outbox_failure BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION p06_fail_outbox();");
        $patients = DB::table('patients')->count();
        $bookings = DB::table('bookings')->count();
        $version = DB::table('clinic_sessions')->where('id', $this->id('SESSION_A'))->value('version');
        $this->withoutExceptionHandling();
        try {
            $this->pending();
            $this->fail('The synthetic outbox failure must abort the entire transaction.');
        } catch (QueryException $error) {
            $this->assertStringContainsString('synthetic rollback check', $error->getMessage());
        }
        $this->assertSame($patients, DB::table('patients')->count());
        $this->assertSame($bookings, DB::table('bookings')->count());
        $this->assertSame($version, DB::table('clinic_sessions')->where('id', $this->id('SESSION_A'))->value('version'));
        $this->assertSame(0, DB::table('audit_events')->where('event_type', 'like', 'booking_%')->count());
        $this->assertSame(0, DB::table('command_replays')->count());
    }
}
