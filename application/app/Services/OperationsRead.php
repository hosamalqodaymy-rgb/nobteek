<?php

namespace App\Services;

use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

class OperationsRead
{
    private const EVENT_TITLES = [
        'booking_requested' => 'وصل طلب حجز جديد',
        'booking_confirm' => 'تأكيد طلب حجز',
        'booking_reject' => 'رفض طلب حجز',
        'booking_cancel' => 'إلغاء طلب حجز',
        'booking_reschedule' => 'تغيير موعد الحجز',
        'booking_ticket-link' => 'استعادة رابط متابعة',
        'visit_check_in' => 'حضور مراجع',
        'visit_walk_in' => 'وصول مراجع مباشر',
        'visit_call_next' => 'استدعاء المراجع التالي',
        'visit_start' => 'بدء الكشف',
        'visit_complete' => 'انتهاء الكشف',
        'visit_mark-away' => 'غياب مراجع',
        'visit_return' => 'عودة مراجع',
        'visit_leave' => 'مغادرة مراجع',
        'visit_priority' => 'تحديث الأولوية الطبية',
        'session_pause' => 'إيقاف النداء مؤقتًا',
        'session_resume' => 'استئناف النداء',
        'session_close' => 'إغلاق جلسة',
        'support_opened' => 'فتح طلب دعم',
    ];

    public function notifications(string $clinic): array
    {
        $query = DB::table('outbox_messages as o')
            ->join('audit_events as a', function ($join): void {
                $join->on('a.id', '=', 'o.event_id')->on('a.clinic_id', '=', 'o.clinic_id');
            })->where('o.clinic_id', $clinic)
            ->orderByDesc('a.at')->orderByDesc('a.id')->limit(50)
            ->get(['a.id', 'a.event_type', 'a.at', 'o.status', 'o.channel']);

        return $query->map(fn ($row): array => [
            'event_id' => $row->id,
            'title' => self::EVENT_TITLES[$row->event_type] ?? 'حدث مسجل في العيادة',
            'at' => CarbonImmutable::parse($row->at)->utc()->toIso8601String(),
            'internal_state' => 'recorded_not_delivered',
            'external_state' => 'disabled',
        ])->all();
    }

    public function report(string $clinic, string $date): array
    {
        $start = CarbonImmutable::parse($date, 'Asia/Aden')->startOfDay()->utc();
        $end = $start->addDay();
        $base = DB::table('visits')->where('clinic_id', $clinic)
            ->where('arrived_at', '>=', $start->toIso8601String())
            ->where('arrived_at', '<', $end->toIso8601String());
        $result = (clone $base)->selectRaw(<<<'SQL'
count(*) AS arrivals,
count(*) FILTER (WHERE state = 'completed') AS completed,
count(*) FILTER (WHERE state = 'left') AS departed,
count(*) FILTER (WHERE state = 'away') AS away,
count(*) FILTER (WHERE started_at IS NULL OR completed_at IS NULL OR completed_at < started_at OR started_at < arrived_at) AS incomplete_times,
count(*) FILTER (WHERE state = 'completed' AND started_at >= arrived_at AND completed_at >= started_at) AS measured_count,
coalesce(sum(extract(epoch from started_at - arrived_at)) FILTER (WHERE state = 'completed' AND started_at >= arrived_at AND completed_at >= started_at),0) AS total_wait_seconds,
coalesce(sum(extract(epoch from completed_at - started_at)) FILTER (WHERE state = 'completed' AND started_at >= arrived_at AND completed_at >= started_at),0) AS total_service_seconds
SQL)->first();
        $count = (int) $result->measured_count;
        $seconds = (float) $result->total_wait_seconds;
        $service = (float) $result->total_service_seconds;

        return [
            'date' => $date, 'timezone' => 'Asia/Aden',
            'arrivals' => (int) $result->arrivals, 'completed' => (int) $result->completed,
            'departed' => (int) $result->departed, 'away' => (int) $result->away,
            'incomplete_times' => (int) $result->incomplete_times,
            'measured_count' => $count,
            'average_wait_minutes' => $count ? round($seconds / 60 / $count, 2) : null,
            'average_service_minutes' => $count ? round($service / 60 / $count, 2) : null,
            'total_service_minutes' => round($service / 60, 2),
            'server_time' => now()->utc()->toIso8601String(),
        ];
    }

    public function clinicAudit(string $clinic): array
    {
        return DB::table('audit_events')->where('clinic_id', $clinic)->orderByDesc('at')->orderByDesc('id')->limit(40)
            ->get(['id', 'event_type', 'reason_code', 'at'])
            ->map(fn ($e): array => ['event_id' => $e->id, 'event_type' => $e->event_type,
                'reason_code' => $e->reason_code, 'at' => CarbonImmutable::parse($e->at)->utc()->toIso8601String()])->all();
    }
}
