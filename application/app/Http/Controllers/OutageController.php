<?php

namespace App\Http\Controllers;

use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class OutageController extends Controller
{
    private function snapshot(Request $request): array
    {
        $data = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d'],
            'session_id' => ['nullable', 'uuid'],
            'clinic_id' => ['prohibited'],
            'patient_id' => ['prohibited'],
            'phone' => ['prohibited'],
            'ticket_number' => ['prohibited'],
        ]);
        $context = app(TenantContext::class);
        $role = $context->role();
        abort_unless(in_array($role, ['owner', 'reception', 'doctor'], true), 403);
        $date = $data['date'] ?? now('Asia/Aden')->toDateString();
        $begin = CarbonImmutable::parse($date, 'Asia/Aden')->startOfDay()->utc();
        $end = $begin->addDay();
        $sessions = DB::table('clinic_sessions as s')->join('doctors as d', function ($join): void {
            $join->on('d.id', '=', 's.doctor_id')->on('d.clinic_id', '=', 's.clinic_id');
        })->where('s.clinic_id', $context->clinicId())
            ->where('s.starts_at', '>=', $begin->toIso8601String())
            ->where('s.starts_at', '<', $end->toIso8601String());
        if ($role === 'doctor') {
            abort_unless($context->doctorId, 403);
            $sessions->where('s.doctor_id', $context->doctorId);
        }
        if (isset($data['session_id']) && $data['session_id'] !== '') {
            $sessions->where('s.id', $data['session_id']);
        }
        $rows = $sessions->orderBy('s.starts_at')->orderBy('s.id')->limit(50)->get([
            's.id', 's.state', 's.version', 's.ticket_counter', 's.doctor_id',
            's.starts_at', 'd.display_name as doctor_name',
        ]);
        $ids = $rows->pluck('id')->all();
        $visitCounts = empty($ids) ? collect() : DB::table('visits')->where('clinic_id', $context->clinicId())
            ->whereIn('session_id', $ids)->groupBy('session_id')->selectRaw(
                "session_id, count(*) FILTER (WHERE state='waiting') AS waiting, ".
                "count(*) FILTER (WHERE state='called') AS called, ".
                "count(*) FILTER (WHERE state='in_service') AS in_service, ".
                "count(*) FILTER (WHERE state='away') AS away, ".
                "count(*) FILTER (WHERE state='completed') AS completed, ".
                "count(*) FILTER (WHERE state='left') AS left_total"
            )->get()->keyBy('session_id');
        $notArrived = empty($ids) ? collect() : DB::table('bookings as b')
            ->leftJoin('visits as v', function ($join): void {
                $join->on('v.booking_id', '=', 'b.id')->on('v.clinic_id', '=', 'b.clinic_id');
            })->where('b.clinic_id', $context->clinicId())->whereIn('b.session_id', $ids)
            ->where('b.state', 'confirmed')->whereNull('v.id')->groupBy('b.session_id')
            ->selectRaw('b.session_id, count(*) AS not_arrived')->pluck('not_arrived', 'session_id');

        return [
            'date' => $date,
            'server_time' => now()->utc()->toIso8601String(),
            'synchronized' => true,
            'sessions' => $rows->map(function ($row) use ($visitCounts, $notArrived): array {
                $v = $visitCounts->get($row->id);
                return [
                    'id' => $row->id, 'doctor_name' => $row->doctor_name,
                    'state' => $row->state, 'version' => (int) $row->version,
                    'starts_at' => CarbonImmutable::parse($row->starts_at)->utc()->toIso8601String(),
                    'issued_tickets' => (int) $row->ticket_counter,
                    'not_arrived' => (int) ($notArrived[$row->id] ?? 0),
                    'waiting' => (int) ($v->waiting ?? 0), 'called' => (int) ($v->called ?? 0),
                    'in_service' => (int) ($v->in_service ?? 0), 'away' => (int) ($v->away ?? 0),
                    'completed' => (int) ($v->completed ?? 0), 'left' => (int) ($v->left_total ?? 0),
                ];
            })->all(),
        ];
    }

    public function index(Request $request): Response|JsonResponse
    {
        $data = $this->snapshot($request);

        return $request->expectsJson() ? response()->json($data) : Inertia::render('Outage', [
            ...$data,
            'status_url' => route('outage.status'),
            'reception_url' => route('reception.index'),
            'bookings_url' => route('bookings.index'),
        ]);
    }

    public function status(Request $request): JsonResponse
    {
        return response()->json($this->snapshot($request));
    }
}
