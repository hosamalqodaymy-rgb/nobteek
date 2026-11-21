<?php

namespace App\Http\Controllers;

use App\Models\ClinicSession;
use App\Models\Visit;
use App\Services\DoctorCommands;
use App\Services\ReceptionCommands;
use App\Services\SessionCommands;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use stdClass;

class DoctorController extends Controller
{
    private function prohibited(): array
    {
        return array_fill_keys(['clinic_id', 'patient_id', 'user_id', 'actor_id', 'guest_id', 'doctor_id', 'booking_id', 'visit_id', 'session_id', 'window_id',
            'state', 'version', 'ticket_number', 'ready_sequence', 'priority', 'arrived_at', 'called_at', 'started_at', 'completed_at', 'returned_at',
            'display_name', 'contact_phone', 'diagnosis', 'clinical_notes', 'notes', 'note', 'description'], ['prohibited']);
    }

    public function callNext(Request $request, string $session, DoctorCommands $commands): JsonResponse
    {
        Gate::authorize('workspace', Visit::class);
        $request->validate($this->prohibited() + ['reason_code' => ['prohibited']]);

        return response()->json($commands->callNext($request, $session));
    }

    public function command(Request $request, string $visit, string $command, DoctorCommands $commands): JsonResponse
    {
        $record = Visit::findOrFail($visit);
        Gate::authorize('practice', $record);
        $reason = isset(DoctorCommands::REASONS[$command]) ? ['required', Rule::in(DoctorCommands::REASONS[$command])] : ['prohibited'];
        $data = $request->validate($this->prohibited() + ['reason_code' => $reason]);

        return response()->json($commands->execute($request, $visit, $command, $data));
    }

    private function rows(): Builder
    {
        $context = app(TenantContext::class);
        $query = DB::table('visits as v')->join('bookings as b', function ($join): void {
            $join->on('b.id', '=', 'v.booking_id')->on('b.clinic_id', '=', 'v.clinic_id')->on('b.session_id', '=', 'v.session_id');
        })->join('patients as p', function ($join): void {
            $join->on('p.id', '=', 'b.patient_id')->on('p.clinic_id', '=', 'v.clinic_id');
        })->join('clinic_sessions as s', function ($join): void {
            $join->on('s.id', '=', 'v.session_id')->on('s.clinic_id', '=', 'v.clinic_id')->on('s.doctor_id', '=', 'v.doctor_id');
        })->where('v.clinic_id', $context->clinicId());
        if ($context->role() === 'doctor') {
            $query->where('v.doctor_id', $context->doctorId);
        }

        return $query;
    }

    private function columns(Builder $query): Builder
    {
        return $query->select(['v.id', 'v.clinic_id', 'v.booking_id', 'v.session_id', 'v.doctor_id', 'v.state', 'v.version', 'v.ticket_number', 'v.ready_sequence', 'v.priority',
            'v.arrived_at', 'v.called_at', 'v.started_at', 'v.completed_at', 'v.returned_at', 'b.state as booking_state', 'b.version as booking_version', 'p.display_name', 's.state as session_state'])
            ->selectRaw("CASE WHEN v.state = 'waiting' THEN (SELECT count(*) + 1 FROM visits ahead WHERE ahead.clinic_id = v.clinic_id AND ahead.session_id = v.session_id AND ahead.state = 'waiting' AND ((ahead.priority AND NOT v.priority) OR (ahead.priority = v.priority AND ahead.ready_sequence < v.ready_sequence))) ELSE NULL END as waiting_position");
    }

    private function visitDto(stdClass $visit, bool $practice): array
    {
        $actions = [];
        if ($practice) {
            if ($visit->session_state !== 'closed' && $visit->booking_state === 'confirmed') {
                $clinical = match ($visit->state) {
                    'waiting' => $visit->started_at === null ? ['priority'] : [],
                    'called' => $visit->started_at === null && $visit->called_at !== null ? ['start'] : [],
                    'in_service' => $visit->started_at !== null ? ['complete'] : [],
                    default => [],
                };
                foreach ($clinical as $command) {
                    $actions[$command] = route('doctor.'.$command, $visit->id);
                }
                if ($visit->started_at === null) {
                    $reception = match ($visit->state) {
                        'waiting', 'called' => ['mark-away', 'leave'],
                        'away' => ['leave'],
                        default => [],
                    };
                    foreach ($reception as $command) {
                        $actions[str_replace('-', '_', $command)] = route('reception.command', ['visit' => $visit->id, 'command' => $command]);
                    }
                }
            }
            if ($visit->started_at !== null && in_array($visit->state, ['in_service', 'completed'], true)
                && $visit->booking_state === ($visit->state === 'completed' ? 'fulfilled' : 'confirmed')) {
                $actions['correct'] = route('doctor.correct', $visit->id);
            }
        }
        $result = ['id' => $visit->id, 'booking_id' => $visit->booking_id, 'booking_state' => $visit->booking_state, 'booking_version' => (int) $visit->booking_version,
            'session_id' => $visit->session_id, 'doctor_id' => $visit->doctor_id, 'display_name' => $visit->display_name, 'ticket_number' => (int) $visit->ticket_number,
            'ready_sequence' => (int) $visit->ready_sequence, 'waiting_position' => $visit->waiting_position === null ? null : (int) $visit->waiting_position,
            'priority' => (bool) $visit->priority, 'state' => $visit->state, 'version' => (int) $visit->version, 'actions' => $actions];
        foreach (['arrived_at', 'called_at', 'started_at', 'completed_at', 'returned_at'] as $field) {
            $result[$field] = $visit->$field ? CarbonImmutable::parse($visit->$field)->utc()->toIso8601String() : null;
        }
        $result['events'] = DB::table('audit_events')->where('clinic_id', $visit->clinic_id)->where('entity_type', 'visit')->where('entity_id', $visit->id)
            ->orderByRaw("(safe_changes->>'version')::bigint DESC NULLS LAST")->orderByDesc('at')->orderByDesc('id')->limit(8)->get(['event_type', 'reason_code', 'at', 'safe_changes'])
            ->map(fn (stdClass $event) => ['event_type' => $event->event_type, 'reason_code' => $event->reason_code,
                'at' => CarbonImmutable::parse($event->at)->utc()->toIso8601String(), 'safe_changes' => json_decode($event->safe_changes, true, flags: JSON_THROW_ON_ERROR)])->all();

        return $result;
    }

    private function sessionDto(ClinicSession $session, bool $practice): array
    {
        $doctor = DB::table('doctors as d')->join('users as u', 'u.id', '=', 'd.user_id')->join('memberships as m', function ($join): void {
            $join->on('m.clinic_id', '=', 'd.clinic_id')->on('m.user_id', '=', 'd.user_id');
        })->where('d.clinic_id', $session->clinic_id)->where('d.id', $session->doctor_id)->first(['d.display_name', 'd.active', 'u.login_enabled', 'u.access_suspended', 'm.active as membership_active', 'm.role']);
        $available = $doctor && $doctor->active && $doctor->membership_active && $doctor->role === 'doctor' && $doctor->login_enabled && ! $doctor->access_suspended;
        $busy = DB::table('visits')->where('clinic_id', $session->clinic_id)->where('doctor_id', $session->doctor_id)->whereIn('state', ['called', 'in_service'])->exists();
        $pauseReason = $session->state === 'paused' ? DB::table('audit_events')->where('clinic_id', $session->clinic_id)->where('entity_type', 'session')->where('entity_id', $session->id)
            ->where('event_type', 'session_pause')->orderByRaw("(safe_changes->>'version')::bigint DESC NULLS LAST")->orderByDesc('at')->value('reason_code') : null;
        $availability = match (true) {
            $session->state === 'closed' => 'closed',
            $session->state === 'paused' && $pauseReason === 'doctor_delayed' => 'delayed',
            $session->state === 'paused' || ! $available => 'paused',
            $busy => 'busy',
            $session->state === 'scheduled' || now()->lt($session->starts_at) => 'scheduled',
            default => 'available',
        };
        $actions = [];
        if ($session->state === 'open' && now()->gte($session->starts_at) && $available && ! $busy
            && DB::table('visits')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->where('state', 'waiting')->exists()) {
            $actions['call_next'] = route('doctor.call-next', $session->id);
        }
        if ($practice && in_array($session->state, ['open', 'paused'], true)) {
            $command = $session->state === 'open' ? 'pause' : 'resume';
            $actions[$command] = route('session.command', ['session' => $session->id, 'command' => $command]);
        }

        return ['id' => $session->id, 'doctor_id' => $session->doctor_id, 'doctor_name' => $doctor?->display_name ?? 'طبيب', 'state' => $session->state,
            'version' => $session->version, 'starts_at' => $session->starts_at->utc()->toIso8601String(), 'ends_at' => $session->ends_at->utc()->toIso8601String(),
            'intake_ended' => now()->gte($session->ends_at), 'availability' => $availability, 'actions' => $actions];
    }

    public function index(Request $request): Response|JsonResponse
    {
        Gate::authorize('workspace', Visit::class);
        $data = $request->validate(['date' => ['nullable', 'date_format:Y-m-d'], 'session_id' => ['nullable', 'uuid'],
            'state' => ['nullable', Rule::in(['waiting', 'called', 'in_service', 'away', 'completed', 'left'])], 'clinic_id' => ['prohibited'], 'doctor_id' => ['prohibited'],
            'phone' => ['prohibited'], 'contact_phone' => ['prohibited'], 'search' => ['prohibited']]);
        $context = app(TenantContext::class);
        $practice = $context->role() === 'doctor';
        $date = $data['date'] ?? now('Asia/Aden')->toDateString();
        $start = CarbonImmutable::parse($date, 'Asia/Aden')->startOfDay()->utc();
        $end = $start->addDay();
        $eligibleSessions = ClinicSession::where(function ($query) use ($start, $end): void {
            $query->where(fn ($day) => $day->where('starts_at', '>=', $start)->where('starts_at', '<', $end))
                ->orWhereExists(function ($active): void {
                    $active->selectRaw('1')->from('visits')->whereColumn('visits.clinic_id', 'clinic_sessions.clinic_id')
                        ->whereColumn('visits.session_id', 'clinic_sessions.id')->whereIn('visits.state', ['called', 'in_service']);
                });
        });
        $sessions = (clone $eligibleSessions)->orderBy('starts_at')->orderBy('id')->limit(60)->get();
        $activeSessionId = $practice ? Visit::whereIn('state', ['called', 'in_service'])->value('session_id') : null;
        $ownActiveSession = $activeSessionId ? ClinicSession::whereKey($activeSessionId)->first() : null;
        if ($ownActiveSession && ! $sessions->contains('id', $ownActiveSession->id)) {
            $sessions->push($ownActiveSession);
        }
        $selected = $data['session_id'] ?? '';
        if ($selected !== '') {
            $requestedSession = (clone $eligibleSessions)->whereKey($selected)->firstOrFail();
            if (! $sessions->contains('id', $requestedSession->id)) {
                $sessions->push($requestedSession);
            }
        } else {
            $selected = $ownActiveSession?->id ?? $sessions->firstWhere('state', 'open')?->id ?? $sessions->first()?->id ?? '';
        }
        $session = $selected !== '' ? $sessions->firstWhere('id', $selected) : null;
        abort_if($selected !== '' && ! $session, 404);
        $state = $data['state'] ?? 'waiting';
        $query = $this->rows();
        if ($session) {
            $query->where('v.session_id', $session->id);
        } else {
            $query->whereRaw('1=0');
        }
        $counts = (clone $query)->selectRaw("count(*) FILTER (WHERE v.state='waiting') as waiting, count(*) FILTER (WHERE v.state='away') as away, count(*) FILTER (WHERE v.state='completed') as completed, count(*) FILTER (WHERE v.state='left') as left_count")->first();
        $paginator = $this->columns($query->where('v.state', $state))->orderByDesc('v.priority')->orderBy('v.ready_sequence')->orderBy('v.id')->simplePaginate(20)->withQueryString();
        $active = $session ? $this->columns($this->rows()->where('v.doctor_id', $session->doctor_id)->whereIn('v.state', ['called', 'in_service']))->first() : null;
        $sessionDtos = $sessions->map(fn (ClinicSession $item) => $this->sessionDto($item, $practice));
        $props = ['date' => $date, 'session_id' => $selected, 'state' => $state, 'permissions' => ['can_practice' => $practice, 'delegated_call_next' => ! $practice],
            'sessions' => $sessionDtos, 'selected_session' => $sessionDtos->firstWhere('id', $selected), 'active_visit' => $active ? $this->visitDto($active, $practice) : null,
            'visits' => $paginator->getCollection()->map(fn (stdClass $visit) => $this->visitDto($visit, $practice)),
            'summary' => ['waiting' => (int) $counts->waiting, 'away' => (int) $counts->away, 'completed' => (int) $counts->completed, 'left' => (int) $counts->left_count],
            'pagination' => ['previous' => $paginator->previousPageUrl(), 'next' => $paginator->nextPageUrl()], 'server_time' => now()->utc()->toIso8601String(),
            'reason_options' => [...DoctorCommands::REASONS, 'pause' => SessionCommands::PAUSE_REASONS, 'resume' => ['service_resumed'],
                'mark_away' => ReceptionCommands::REASONS['mark-away'], 'leave' => ReceptionCommands::REASONS['leave']]];
        if ($request->expectsJson()) {
            return response()->json($props);
        }

        return Inertia::render('Doctor', $props);
    }
}
