<?php

namespace Tests\Feature;

use Closure;
use Database\Seeders\DemoFoundationSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use RuntimeException;
use Tests\TestCase;

#[Group('postgres')]
class FoundationDatabaseTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected function beforeRefreshingDatabase(): void
    {
        if (! app()->environment('testing') || config('database.default') !== 'pgsql' ||
            ! preg_match('/^nobteek_test(?:_[a-z0-9_]+)?$/', (string) config('database.connections.pgsql.database'))) {
            throw new RuntimeException('Database tests require an isolated nobteek_test database.');
        }
    }

    /** @return array<string, mixed> */
    private function row(string $table, string $code): array
    {
        return (array) DB::table($table)->where('demo_code', $code)->firstOrFail();
    }

    private function rejects(string $state, Closure $action): void
    {
        try {
            DB::transaction(function () use ($action): void {
                $action();
                DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
            });
            $this->fail('Expected a database integrity violation.');
        } catch (QueryException $error) {
            $this->assertSame($state, $error->errorInfo[0]);
        }
    }

    public function test_seed_is_synthetic_repeatable_and_disabled_for_login(): void
    {
        $this->assertSame(2, DB::table('clinics')->count());
        $this->assertSame(3, DB::table('doctors')->count());
        $this->assertSame(0, DB::table('users')->where('login_enabled', true)->count());
        $this->assertSame(0, DB::table('users')->whereNotNull('password')->count());
        (new DemoFoundationSeeder)->run();
        $this->assertSame(4, DB::table('bookings')->count());
        $this->assertSame(2, DB::table('visits')->count());
    }

    public function test_operational_foreign_keys_reject_other_clinic_references(): void
    {
        $booking = $this->row('bookings', 'BOOK_A2');
        $booking['id'] = (string) Str::uuid();
        $booking['demo_code'] = null;
        $booking['window_id'] = $this->row('arrival_windows', 'W1_B')['id'];
        $this->rejects('23503', fn () => DB::table('bookings')->insert($booking));
        $booking['window_id'] = $this->row('arrival_windows', 'W2_A')['id'];
        $booking['patient_id'] = $this->row('patients', 'PAT_B1')['id'];
        $this->rejects('23503', fn () => DB::table('bookings')->insert($booking));
        $session = $this->row('clinic_sessions', 'SESSION_A');
        $session['id'] = (string) Str::uuid();
        $session['demo_code'] = null;
        $session['doctor_id'] = $this->row('doctors', 'DR_B')['id'];
        $this->rejects('23503', fn () => DB::table('clinic_sessions')->insert($session));
    }

    public function test_one_arrival_and_one_ticket_number_are_enforced(): void
    {
        $visit = (array) DB::table('visits')->where('booking_id', $this->row('bookings', 'BOOK_A1')['id'])->firstOrFail();
        $visit['id'] = (string) Str::uuid();
        $this->rejects('23505', fn () => DB::table('visits')->insert($visit));
        $visit['booking_id'] = $this->row('bookings', 'BOOK_A2')['id'];
        $this->rejects('23505', fn () => DB::table('visits')->insert($visit));
    }

    public function test_called_and_in_service_both_reserve_the_doctor(): void
    {
        $first = DB::table('visits')->where('booking_id', $this->row('bookings', 'BOOK_A1')['id'])->firstOrFail();
        DB::table('visits')->where('id', $first->id)->update(['state' => 'called']);
        $visit = (array) $first;
        $visit['id'] = (string) Str::uuid();
        $visit['booking_id'] = $this->row('bookings', 'BOOK_A2')['id'];
        $visit['ticket_number'] = 2;
        $visit['ready_sequence'] = 2;
        $visit['state'] = 'in_service';
        $this->rejects('23505', fn () => DB::table('visits')->insert($visit));
    }

    public function test_family_phone_and_optional_walk_in_phone_are_supported(): void
    {
        $this->assertSame(2, DB::table('patients')->where('contact_phone', '+967700000001')->count());
        $this->assertNull($this->row('patients', 'PAT_A3')['contact_phone']);
    }

    public function test_windows_cannot_escape_their_session_or_have_zero_capacity(): void
    {
        $id = $this->row('arrival_windows', 'W2_A')['id'];
        $this->rejects('23514', fn () => DB::table('arrival_windows')->where('id', $id)->update(['ends_at' => '2026-11-07T16:00:00Z']));
        $this->rejects('23514', fn () => DB::table('arrival_windows')->where('id', $id)->update(['capacity' => 0]));
    }
}
