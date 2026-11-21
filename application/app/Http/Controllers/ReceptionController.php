<?php

namespace App\Http\Controllers;

use App\Models\ClinicSession;
use App\Models\Visit;
use App\Services\ReceptionCommands;
use App\Services\SessionCommands;
use App\Support\TenantContext;
use App\Support\YemeniPhone;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;
use stdClass;

class ReceptionController extends Controller
{
    private function prohibited(): array
    {
        return array_fill_keys(['clinic_id', 'patient_id', 'user_id', 'actor_id', 'guest_id', 'state', 'version', 'visit_id', 'ticket_number', 'ready_sequence', 'priority', 'arrived_at', 'doctor_id'], ['prohibited']);
    }

    public function checkIn(Request $request, string $booking, ReceptionCommands $commands): JsonResponse
    {
        Gate::authorize('viewAny', Visit::class);
        $request->validate($this->prohibited() + ['session_id' => ['prohibited'], 'window_id' => ['prohibited']]);

        return response()->json($commands->checkIn($request, $booking), 201);
    }

    public function walkIn(Request $request, string $session, ReceptionCommands $commands): JsonResponse
    {
        Gate::authorize('viewAny', Visit::class);
        $data = $request->validate($this->prohibited() + ['window_id' => ['required', 'uuid'], 'display_name' => ['required', 'string', 'max:80'], 'contact_phone' => ['nullable', 'string', 'max:40'], 'source' => ['prohibited'], 'session_id' => ['prohibited']]);
        $data['display_name'] = trim($data['display_name']);
        if (mb_strlen($data['display_name']) < 2) {
            throw ValidationException::withMessages(['display_name' => 'أدخل اسم المراجع من حرفين إلى 80 حرفًا.']);
        }
        $data['contact_phone'] = YemeniPhone::normalize($data['contact_phone'] ?? null);
        if ($data['contact_phone'] !== null && ! preg_match('/^\+9677[0-9]{8}$/D', $data['contact_phone'])) {
            throw ValidationException::withMessages(['contact_phone' => 'أدخل جوالًا يمنيًا من تسعة أرقام يبدأ بسبعة، أو اتركه فارغًا.']);
        }

        return response()->json($commands->walkIn($request, $session, $data), 201);
    }

    public function command(Request $request, string $visit, string $command, ReceptionCommands $commands): JsonResponse
    {
        $record = Visit::findOrFail($visit);
        Gate::authorize('view', $record);
        $data = $request->validate($this->prohibited() + ['reason_code' => ['required', Rule::in(ReceptionCommands::REASONS[$command])], 'session_id' => ['prohibited'], 'window_id' => ['prohibited']]);

        return response()->json($commands->execute($request, $visit, $command, $data));
    }

    private function rows(): Builder
    {
        $clinic = app(TenantContext::class)->clinicId();

        return DB::table('bookings as b')->join('patients as p', function ($join): void {
            $join->on('p.id', '=', 'b.patient_id')->on('p.clinic_id', '=', 'b.clinic_id');
        })->join('clinic_sessions as s', function ($join): void {
            $join->on('s.id', '=', 'b.session_id')->on('s.clinic_id', '=', 'b.clinic_id');
        })->join('arrival_windows as w', function ($join): void {
            $join->on('w.id', '=', 'b.window_id')->on('w.clinic_id', '=', 'b.clinic_id');
        })->join('doctors as d', function ($join): void {
            $join->on('d.id', '=', 's.doctor_id')->on('d.clinic_id', '=', 'b.clinic_id');
        })->leftJoin('visits as v', function ($join): void {
            $join->on('v.booking_id', '=', 'b.id')->on('v.clinic_id', '=', 'b.clinic_id');
        })->where('b.clinic_id', $clinic);
    }

    private function columns(Builder $query): Builder
    {
        return $query->select(['b.id as booking_id', 'b.state as booking_state', 'b.version as booking_version', 'b.source', 'b.session_id',
            'p.display_name', 'p.contact_phone', 'd.display_name as doctor_name', 's.state as session_state', 'w.starts_at as window_starts_at', 'w.ends_at as window_ends_at',
            'v.id as visit_id', 'v.state as visit_state', 'v.version as visit_version', 'v.ticket_number', 'v.ready_sequence', 'v.priority', 'v.arrived_at', 'v.returned_at', 'v.started_at'])
            ->selectRaw("CASE WHEN v.state = 'waiting' THEN (SELECT count(*) + 1 FROM visits ahead WHERE ahead.clinic_id = v.clinic_id AND ahead.session_id = v.session_id AND ahead.state = 'waiting' AND ((ahead.priority AND NOT v.priority) OR (ahead.priority = v.priority AND ahead.ready_sequence < v.ready_sequence))) ELSE NULL END as waiting_position");
    }

    private function dto(stdClass $row): array
    {
        $actions = [];
        if ($row->booking_state === 'confirmed' && $row->visit_id === null) {
            $actions['check-in'] = route('reception.check-in', $row->booking_id);
        }
        if ($row->visit_id !== null && $row->started_at === null && $row->booking_state === 'confirmed') {
            $commands = match ($row->visit_state) {
                'waiting' => ['mark-away', 'leave', ...(app(TenantContext::class)->role() === 'owner' && ! $row->priority ? ['defer'] : [])],
                'called' => ['mark-away', 'leave'],
                'away' => [...(app(TenantContext::class)->role() !== 'doctor' ? ['return'] : []), 'leave'],
                default => [],
            };
            foreach ($commands as $command) {
                $actions[$command] = route('reception.command', ['visit' => $row->visit_id, 'command' => $command]);
            }
        }

        return ['booking_id' => $row->booking_id, 'booking_state' => $row->booking_state, 'booking_version' => (int) $row->booking_version, 'source' => $row->source,
            'session_id' => $row->session_id, 'display_name' => $row->display_name, 'contact_phone' => $row->contact_phone, 'doctor_name' => $row->doctor_name,
            'session_state' => $row->session_state, 'window_starts_at' => CarbonImmutable::parse($row->window_starts_at)->utc()->toIso8601String(), 'window_ends_at' => CarbonImmutable::parse($row->window_ends_at)->utc()->toIso8601String(),
            'visit' => $row->visit_id === null ? null : ['id' => $row->visit_id, 'state' => $row->visit_state, 'version' => (int) $row->visit_version, 'ticket_number' => (int) $row->ticket_number,
                'ready_sequence' => (int) $row->ready_sequence, 'waiting_position' => $row->waiting_position === null ? null : (int) $row->waiting_position, 'priority' => (bool) $row->priority,
                'arrived_at' => CarbonImmutable::parse($row->arrived_at)->utc()->toIso8601String(), 'returned_at' => $row->returned_at ? CarbonImmutable::parse($row->returned_at)->utc()->toIso8601String() : null],
            'actions' => $actions];
    }

    public function index(Request $request): Response|JsonResponse
    {
        Gate::authorize('viewAny', Visit::class);
        $data = $request->validate(['date' => ['nullable', 'date_format:Y-m-d'], 'session_id' => ['nullable', 'uuid'], 'search' => ['nullable', 'string', 'max:80'],
            'state' => ['nullable', Rule::in(['not_arrived', 'waiting', 'called', 'in_service', 'away', 'completed', 'left'])], 'clinic_id' => ['prohibited'], 'phone' => ['prohibited'], 'contact_phone' => ['prohibited']]);
        $date = $data['date'] ?? now('Asia/Aden')->toDateString();
        $start = CarbonImmutable::parse($date, 'Asia/Aden')->startOfDay()->utc();
        $end = $start->addDay();
        $sessions = ClinicSession::where('starts_at', '>=', $start)->where('starts_at', '<', $end)->orderBy('starts_at')->orderBy('id')->limit(60)->get();
        $selected = $data['session_id'] ?? '';
        if ($selected !== '') {
            abort_unless($sessions->contains('id', $selected), 404);
        }
        $query = $this->rows()->where('s.starts_at', '>=', $start)->where('s.starts_at', '<', $end);
        if ($selected !== '') {
            $query->where('s.id', $selected);
        }
        $counts = (clone $query)->selectRaw("count(*) FILTER (WHERE v.state='waiting') as waiting, count(*) FILTER (WHERE v.state='away') as away, count(*) FILTER (WHERE b.state='confirmed' AND v.id IS NULL) as not_arrived")->first();
        if (! empty($data['state'])) {
            if ($data['state'] === 'not_arrived') {
                $query->where('b.state', 'confirmed')->whereNull('v.id');
            } else {
                $query->where('v.state', $data['state']);
            }
        }
        $search = trim($data['search'] ?? '');
        if ($search !== '') {
            $digits = strtr($search, array_combine(preg_split('//u', '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', -1, PREG_SPLIT_NO_EMPTY), str_split('01234567890123456789')));
            if (preg_match('/^[0-9]+$/D', $digits)) {
                if (! preg_match('/^[1-9][0-9]{0,17}$/D', $digits)) {
                    throw ValidationException::withMessages(['search' => 'أدخل رقم تذكرة صالحًا.']);
                }
                $query->where('v.ticket_number', $digits);
            } else {
                if (mb_strlen($search) < 2) {
                    throw ValidationException::withMessages(['search' => 'اكتب حرفين على الأقل للبحث بالاسم داخل اليوم المحدد.']);
                }
                $pattern = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search);
                $query->whereRaw("p.display_name ILIKE ? ESCAPE '!'", ['%'.$pattern.'%']);
            }
        }
        $paginator = $this->columns($query)->orderBy('s.starts_at')->orderBy('s.id')
            ->orderByRaw("CASE WHEN v.state='waiting' THEN 0 WHEN v.state IN ('called','in_service') THEN 1 WHEN v.state='away' THEN 2 WHEN v.id IS NULL AND b.state='confirmed' THEN 3 ELSE 4 END")
            ->orderByDesc('v.priority')->orderBy('v.ready_sequence')->orderBy('b.id')->simplePaginate(20)->withQueryString();
        $props = ['arrivals' => $paginator->getCollection()->map(fn (stdClass $row) => $this->dto($row)), 'date' => $date, 'session_id' => $selected, 'search' => $search, 'state' => $data['state'] ?? '',
            'summary' => ['waiting' => (int) $counts->waiting, 'away' => (int) $counts->away, 'not_arrived' => (int) $counts->not_arrived],
            'server_time' => now()->utc()->toIso8601String(), 'pagination' => ['previous' => $paginator->previousPageUrl(), 'next' => $paginator->nextPageUrl()]];
        $props['sessions'] = $sessions->map(fn (ClinicSession $session) => [...app(SessionCommands::class)->dto($session), 'walk_in_url' => route('reception.walk-in', $session->id)]);
        if ($request->expectsJson()) {
            return response()->json($props);
        }

        return Inertia::render('Reception', $props);
    }

    public function show(Request $request, string $visit): JsonResponse
    {
        $record = Visit::findOrFail($visit);
        Gate::authorize('view', $record);
        $row = $this->columns($this->rows()->where('v.id', $record->id))->firstOrFail();

        return response()->json(['data' => $this->dto($row), 'events' => DB::table('audit_events')->where('clinic_id', $record->clinic_id)->where('entity_type', 'visit')->where('entity_id', $record->id)->orderByDesc('at')->orderByDesc('id')->limit(30)->get(['event_type', 'reason_code', 'at', 'safe_changes'])]);
    }
}
