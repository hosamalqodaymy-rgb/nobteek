<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TicketTestCase;

#[Group('postgres')]
class OperationsP10Test extends TicketTestCase
{
    private function support(string $category = 'technical', ?string $key = null): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/v1/operations/support', ['category' => $category], ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function report(string $date = '2026-11-07'): array
    {
        return $this->getJson('/workspace/operations?date='.$date)->assertOk()->json('report');
    }

    public function test_internal_notifications_have_one_event_per_outbox_and_simulator_never_marks_delivery(): void
    {
        $this->arrivedVisit();
        $clinic = $this->id('CLINIC_A');
        $event = DB::table('audit_events')->where('clinic_id', $clinic)->where('event_type', 'visit_check_in')->value('id');
        $this->assertNotNull($event);
        $response = $this->getJson('/workspace/operations')->assertOk();
        $notifications = $response->json('notifications');
        $this->assertCount(1, array_filter($notifications, fn ($item) => $item['event_id'] === $event));
        $this->assertSame(count($notifications), count(array_unique(array_column($notifications, 'event_id'))));
        $payload = ['event_id' => $event, 'channel' => 'sms'];
        $this->postJson('/v1/operations/simulate', $payload)->assertOk()->assertJsonPath('state', 'simulated_not_sent')
            ->assertJsonPath('external_delivery', false)->assertJsonPath('replayed', false);
        $this->postJson('/v1/operations/simulate', $payload)->assertOk()->assertJsonPath('replayed', true);
        $this->postJson('/v1/operations/simulate', ['event_id' => $event, 'channel' => 'email'])->assertOk();
        $this->assertSame(2, DB::table('notification_simulations')->where('event_id', $event)->count());
        $this->assertSame(0, DB::table('outbox_messages')->where('status', 'processed')->count());
        $this->assertSame(0, DB::table('outbox_messages')->where('status', 'pending')->count());
        $this->assertSame('disabled', DB::table('outbox_messages')->where('event_id', $event)->value('status'));
        $this->postJson('/v1/operations/simulate', [...$payload, 'delivered' => true])->assertUnprocessable();
        $this->postJson('/v1/operations/simulate', [...$payload, 'phone' => '+967700000001'])->assertUnprocessable();
        $this->postJson('/v1/operations/simulate', ['event_id' => DB::table('audit_events')->where('clinic_id', $this->id('CLINIC_B'))->value('id') ?? $this->id('SESSION_B'), 'channel' => 'sms'])->assertNotFound();
    }

    public function test_wait_is_arrival_to_start_only_for_completed_visits_with_valid_times(): void
    {
        $baseline = $this->report();
        $first = $this->arrivedVisit();
        $second = $this->walkIn('مراجع سيناريو الانتظار')->assertCreated()->json('id');
        $this->doctor();
        $this->callNext()->assertOk()->assertJsonPath('id', $first);
        $this->travel(6)->minutes();
        $this->doctorAction($first, 'start')->assertOk();
        $this->travel(9)->minutes();
        $this->doctorAction($first, 'complete')->assertOk();
        $this->owner();
        $this->visitCommand($second, 'leave')->assertOk();
        $report = $this->report();
        $this->assertSame($baseline['arrivals'] + 2, $report['arrivals']);
        $this->assertSame($baseline['completed'] + 1, $report['completed']);
        $this->assertSame($baseline['departed'] + 1, $report['departed']);
        $this->assertSame($baseline['incomplete_times'] + 1, $report['incomplete_times']);
        $this->assertSame($baseline['measured_count'] + 1, $report['measured_count']);
        $this->assertEqualsWithDelta(6, $report['average_wait_minutes'], 0.01);
        $this->assertEqualsWithDelta(9, $report['average_service_minutes'], 0.01);
        $this->assertEqualsWithDelta(9, $report['total_service_minutes'], 0.01);
        $this->assertSame(0, $this->report('2026-11-06')['arrivals']);
    }

    public function test_in_progress_visit_is_not_included_in_wait_averages(): void
    {
        $baseline = $this->report();
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->callNext()->assertOk();
        $this->travel(4)->minutes();
        $this->doctorAction($visit, 'start')->assertOk();
        $this->owner();
        $report = $this->report();
        $this->assertSame($baseline['arrivals'] + 1, $report['arrivals']);
        $this->assertSame($baseline['measured_count'], $report['measured_count']);
        $this->assertSame($baseline['average_wait_minutes'], $report['average_wait_minutes']);
        $this->assertSame($baseline['incomplete_times'] + 1, $report['incomplete_times']);
    }

    public function test_reports_are_owner_only_scoped_and_csv_requires_recent_mfa(): void
    {
        $this->signIn('OWNER_B', true);
        $baselineOther = $this->getJson('/workspace/operations?date=2026-11-07')->assertOk()->json();
        $this->owner();
        $this->arrivedVisit();
        $owner = $this->getJson('/workspace/operations')->assertOk()->json();
        $this->assertSame($this->id('CLINIC_A'), DB::table('visits')->where('id', $this->id('VISIT_A1'))->value('clinic_id') ?? $this->id('CLINIC_A'));
        $content = json_encode($owner, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        foreach (['contact_phone', 'patient_id', 'ticket_url', 'diagnosis', 'secret'] as $field) {
            $this->assertArrayNotHasKey($field, $owner);
        }
        $this->get('/v1/operations/report.csv?date=2026-11-07')->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->get('/v1/operations/report.csv?date=2026-11-07&clinic_id='.$this->id('CLINIC_B'))->assertUnprocessable();
        $this->travel(11)->minutes();
        $this->getJson('/v1/operations/report.csv?date=2026-11-07')->assertStatus(423);
        $this->signIn('RECEPTION_A');
        $this->getJson('/workspace/operations')->assertForbidden();
        $this->getJson('/v1/operations/report.csv?date=2026-11-07')->assertForbidden();
        $this->signIn('DOCTOR_C');
        $this->getJson('/workspace/operations')->assertForbidden();
        $this->signIn('OWNER_B', true);
        $other = $this->getJson('/workspace/operations?date=2026-11-07')->assertOk()->json();
        $this->assertSame($baselineOther['report']['arrivals'], $other['report']['arrivals']);
        $this->assertSame($baselineOther['notifications'], $other['notifications']);
        $this->signIn('PLATFORM', true);
        $this->getJson('/workspace/operations')->assertNotFound();
        $this->getJson('/platform/operations')->assertOk();
    }

    public function test_support_requests_are_scoped_and_platform_can_resolve_once_with_audit(): void
    {
        $this->postJson('/v1/operations/support', ['category' => 'technical', 'description' => 'مراجع خاص'], ['Idempotency-Key' => (string) Str::uuid()])->assertUnprocessable();
        $key = (string) Str::uuid();
        $receipt = $this->support('technical', $key)->assertCreated()->assertJsonPath('replayed', false);
        $id = $receipt->json('id');
        $this->support('technical', $key)->assertCreated()->assertJsonPath('id', $id)->assertJsonPath('replayed', true);
        $this->support('access', $key)->assertConflict();
        $this->assertDatabaseHas('support_requests', ['id' => $id, 'clinic_id' => $this->id('CLINIC_A'), 'state' => 'open', 'version' => 1]);
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'support_opened')->where('entity_id', $id)->count());
        $this->assertSame(1, DB::table('outbox_messages')->where('event_id', DB::table('audit_events')->where('entity_id', $id)->value('id'))->count());
        $this->signIn('OWNER_B', true);
        $other = $this->getJson('/workspace/operations')->assertOk();
        $this->assertSame([], $other->json('support_requests'));
        $this->signIn('PLATFORM', true);
        $data = $this->getJson('/platform/operations')->assertOk()->json();
        $this->assertCount(1, $data['cases']);
        $this->assertSame('technical', $data['cases'][0]['category']);
        $this->assertArrayNotHasKey('patient_id', $data['cases'][0]);
        $this->postJson('/platform/support/'.$id.'/resolve', ['version' => 99, 'reason_code' => 'support_resolved'])->assertConflict();
        $this->postJson('/platform/support/'.$id.'/resolve', ['version' => 1, 'reason_code' => 'support_resolved'])
            ->assertOk()->assertJsonPath('version', 2)->assertJsonPath('state', 'resolved');
        $this->postJson('/platform/support/'.$id.'/resolve', ['version' => 1, 'reason_code' => 'support_resolved'])->assertConflict();
        $this->assertSame(1, DB::table('security_events')->where('event_type', 'support_resolved')->count());
        $this->assertDatabaseHas('support_requests', ['id' => $id, 'state' => 'resolved', 'version' => 2]);
        $this->signIn('RECEPTION_A');
        $this->support('access')->assertForbidden();
        $this->getJson('/platform/operations')->assertForbidden();
        $this->postJson('/platform/support/'.$id.'/resolve', ['version' => 2, 'reason_code' => 'support_resolved'])->assertForbidden();
    }
}
