<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('restore-smoke')]
class P11RestoreSmokeTest extends TestCase
{
    public function test_restored_synthetic_database_can_process_a_booking_arrival_without_duplicate_ticket(): void
    {
        if (env('NOBTEEK_RESTORE_SMOKE') !== 'true' ||
            config('database.connections.pgsql.database') !== 'nobteek_test_restore' ||
            ! app()->environment('testing')) {
            $this->markTestSkipped('Only runs on the P11 isolated restored snapshot.');
        }
        $this->withoutVite();
        $fixture = json_decode(file_get_contents(database_path('fixtures/foundation_demo.json')), true, flags: JSON_THROW_ON_ERROR)['ids'];
        $this->assertGreaterThanOrEqual(2, DB::table('clinics')->count());
        $this->assertGreaterThanOrEqual(1, DB::table('visits')->count());
        $sessionId = $fixture['SESSION_C'];
        $bookingId = $fixture['BOOK_C1'];
        $windowId = $fixture['W1_C'];
        $now = now();
        DB::transaction(function () use ($fixture, $sessionId, $windowId, $now): void {
            DB::table('clinic_sessions')->where('id', $sessionId)->update([
                'starts_at' => $now->copy()->subMinutes(15),
                'ends_at' => $now->copy()->addHours(2), 'state' => 'open',
            ]);
            DB::table('arrival_windows')->where('id', $windowId)->update([
                'starts_at' => $now->copy()->subMinutes(15),
                'ends_at' => $now->copy()->addHour(), 'capacity' => 3,
            ]);
            DB::table('arrival_windows')->where('id', $fixture['W2_C'])->update([
                'starts_at' => $now->copy()->addHour(),
                'ends_at' => $now->copy()->addHours(2),
            ]);
        });
        $doctor = User::findOrFail($fixture['DOCTOR_C']);
        $doctor->forceFill(['login_enabled' => true, 'access_suspended' => false])->save();
        $user = User::findOrFail($fixture['RECEPTION_A']);
        $user->forceFill(['password' => Hash::make('SyntheticRecoveryOnlyPassword123'), 'login_enabled' => true])->save();
        $this->actingAs($user)->withSession(['membership_id' => $fixture['MEM_RECEPTION_A'],
            'security_version' => $user->security_version, 'auth_confirmed_at' => $now->timestamp]);
        $key = (string) Str::uuid();
        $url = '/v1/bookings/'.$bookingId.'/check-in';
        $headers = ['If-Match' => '"1"', 'Idempotency-Key' => $key];
        $first = $this->postJson($url, [], $headers)->assertCreated()->assertJsonPath('ticket_number', 1);
        $id = $first->json('id');
        $this->postJson($url, [], $headers)->assertCreated()->assertJsonPath('replayed', true)->assertJsonPath('id', $id);
        $this->assertSame(1, DB::table('visits')->where('booking_id', $bookingId)->count());
        $this->assertSame(1, (int) DB::table('clinic_sessions')->where('id', $sessionId)->value('ticket_counter'));
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $id)->where('event_type', 'visit_check_in')->count());
        $this->getJson('/v1/outage/status?date='.$now->setTimezone('Asia/Aden')->toDateString())
            ->assertOk()->assertJsonPath('synchronized', true);
    }
}
