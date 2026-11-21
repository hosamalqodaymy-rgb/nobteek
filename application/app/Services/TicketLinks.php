<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use stdClass;

class TicketLinks
{
    /** @return array{ticket_url:string,ticket_expires_at:string} */
    public function issue(stdClass $booking, stdClass $session): array
    {
        abort_unless($booking->clinic_id === $session->clinic_id && $booking->session_id === $session->id, 409);
        $expires = CarbonImmutable::parse($session->ends_at)->addHours(48)->utc();
        abort_if($expires->lte(now()), 409, 'انتهت مدة متابعة هذا الحجز.');
        $secret = bin2hex(random_bytes(32));
        DB::table('ticket_tokens')->insert(['digest' => hash('sha256', $secret), 'clinic_id' => $booking->clinic_id,
            'booking_id' => $booking->id, 'expires_at' => $expires->toIso8601String(), 'created_at' => now()]);

        return ['ticket_url' => route('public.ticket').'#'.$secret, 'ticket_expires_at' => $expires->toIso8601String()];
    }

    /** A command replay must never restore a revoked or expired bearer link. */
    public function assertReplayCurrent(array $result): void
    {
        if (! isset($result['ticket_url'])) {
            return;
        }
        $secret = parse_url($result['ticket_url'], PHP_URL_FRAGMENT);
        abort_unless(is_string($secret) && preg_match('/^[a-f0-9]{64}$/D', $secret), 409, 'رابط نتيجة المحاولة لم يعد متاحًا. اطلب رابطًا جديدًا من الاستقبال.');
        $bookingId = $result['booking_id'] ?? $result['id'];
        abort_unless($this->currentToken($secret)->where('b.id', $bookingId)->exists(), 409, 'انتهى الرابط السابق أو تم استبداله. اطلب رابطًا جديدًا من الاستقبال.');
    }

    private function currentToken(string $secret): Builder
    {
        $at = now()->utc()->toIso8601String();

        return DB::table('ticket_tokens as t')->join('bookings as b', function (JoinClause $join): void {
            $join->on('b.id', '=', 't.booking_id')->on('b.clinic_id', '=', 't.clinic_id');
        })->join('clinic_sessions as s', function (JoinClause $join): void {
            $join->on('s.id', '=', 'b.session_id')->on('s.clinic_id', '=', 'b.clinic_id');
        })->join('clinics as c', 'c.id', '=', 'b.clinic_id')->where('c.operational_state', 'active')
            ->where('t.digest', hash('sha256', $secret))->whereNull('t.revoked_at')->where('t.expires_at', '>', $at)
            ->whereRaw("s.ends_at + INTERVAL '48 hours' > ?", [$at]);
    }

    /** @return array{booking_state:string,visit_state:?string,ticket_number:?int,waiting_ahead:?int,doctor_state:string,session_state:string,window_starts_at:string,window_ends_at:string,server_time:string,booking_version:int,visit_version:?int} */
    public function read(string $secret): array
    {
        abort_unless(preg_match('/^[a-f0-9]{64}$/D', $secret), 404);
        $waiting = DB::table('visits as ahead')->selectRaw('count(*)')
            ->whereColumn('ahead.clinic_id', 'v.clinic_id')->whereColumn('ahead.session_id', 'v.session_id')->whereColumn('ahead.doctor_id', 'v.doctor_id')
            ->where('ahead.state', 'waiting')->where(function (Builder $query): void {
                $query->whereColumn('ahead.priority', '>', 'v.priority')->orWhere(function (Builder $equal): void {
                    $equal->whereColumn('ahead.priority', 'v.priority')->whereColumn('ahead.ready_sequence', '<', 'v.ready_sequence');
                });
            });
        $active = DB::table('visits as active')->select('active.state')->whereColumn('active.clinic_id', 's.clinic_id')
            ->whereColumn('active.doctor_id', 's.doctor_id')->whereIn('active.state', ['called', 'in_service'])->limit(1);
        $record = $this->currentToken($secret)->join('arrival_windows as w', function (JoinClause $join): void {
            $join->on('w.id', '=', 'b.window_id')->on('w.session_id', '=', 'b.session_id')->on('w.clinic_id', '=', 'b.clinic_id');
        })->leftJoin('visits as v', function (JoinClause $join): void {
            $join->on('v.id', '=', 'b.visit_id')->on('v.booking_id', '=', 'b.id')->on('v.clinic_id', '=', 'b.clinic_id')
                ->on('v.session_id', '=', 'b.session_id')->on('v.doctor_id', '=', 's.doctor_id');
        })->select(['b.state as booking_state', 'b.version as booking_version', 'b.visit_id as expected_visit_id', 'v.id as matched_visit_id',
            'v.state as visit_state', 'v.version as visit_version', 'v.ticket_number', 's.state as session_state',
            'w.starts_at as window_starts_at', 'w.ends_at as window_ends_at'])
            ->selectSub($waiting, 'waiting_ahead')->selectSub($active, 'doctor_state')->first();
        abort_unless($record && ($record->expected_visit_id === null || $record->matched_visit_id !== null), 404);

        return ['booking_state' => $record->booking_state, 'visit_state' => $record->visit_state,
            'ticket_number' => $record->ticket_number === null ? null : (int) $record->ticket_number,
            'waiting_ahead' => $record->visit_state === 'waiting' ? (int) $record->waiting_ahead : null,
            'doctor_state' => $record->doctor_state ?? 'available', 'session_state' => $record->session_state,
            'window_starts_at' => CarbonImmutable::parse($record->window_starts_at)->utc()->toIso8601String(),
            'window_ends_at' => CarbonImmutable::parse($record->window_ends_at)->utc()->toIso8601String(),
            'server_time' => now()->utc()->toIso8601String(), 'booking_version' => (int) $record->booking_version,
            'visit_version' => $record->visit_version === null ? null : (int) $record->visit_version];
    }
}
