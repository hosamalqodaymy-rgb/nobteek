<?php

namespace App\Http\Controllers;

use App\Http\Resources\ClinicSessionResource;
use App\Models\ClinicSession;
use App\Models\Doctor;
use App\Services\SessionCommands;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class SessionSetupController extends Controller
{
    public static function scheduleRules(): array
    {
        return ['doctor_id' => ['required', 'uuid'], 'starts_at' => ['required', 'date_format:Y-m-d\TH:i'], 'ends_at' => ['required', 'date_format:Y-m-d\TH:i'],
            'windows' => ['required', 'array', 'min:1', 'max:96'], 'windows.*' => ['required', 'array:starts_at,ends_at,capacity'],
            'windows.*.starts_at' => ['required', 'date_format:Y-m-d\TH:i'], 'windows.*.ends_at' => ['required', 'date_format:Y-m-d\TH:i'], 'windows.*.capacity' => ['required', 'integer', 'min:1', 'max:1000'],
            'clinic_id' => ['prohibited'], 'user_id' => ['prohibited'], 'state' => ['prohibited']];
    }

    public function index(Request $request, SessionCommands $commands): Response|AnonymousResourceCollection
    {
        Gate::authorize('viewAny', ClinicSession::class);
        $data = $request->validate(['date' => ['nullable', 'date_format:Y-m-d'], 'clinic_id' => ['prohibited']]);
        $date = $data['date'] ?? now()->toDateString();
        $sessions = ClinicSession::whereDate('starts_at', $date)->orderBy('starts_at')->simplePaginate(20)->withQueryString();
        if ($request->expectsJson()) {
            return ClinicSessionResource::collection($sessions);
        }
        $items = $sessions->getCollection()->map(fn (ClinicSession $s) => [...$commands->dto($s), 'show_url' => route('sessions.show', $s->id)]);

        return Inertia::render('SessionList', ['sessions' => $items, 'date' => $date, 'role' => app(TenantContext::class)->role(), 'doctors' => Doctor::where('active', true)->orderBy('display_name')->get(['id', 'display_name']), 'pagination' => ['previous' => $sessions->previousPageUrl(), 'next' => $sessions->nextPageUrl()]]);
    }

    public function show(Request $request, string $session, SessionCommands $commands): Response|ClinicSessionResource
    {
        $record = ClinicSession::findOrFail($session);
        Gate::authorize('view', $record);
        if ($request->expectsJson()) {
            return new ClinicSessionResource($record);
        }
        $events = DB::table('audit_events')->where('clinic_id', $record->clinic_id)->where('entity_type', 'session')->where('entity_id', $record->id)->orderByDesc('at')->limit(20)->get(['event_type', 'reason_code', 'at', 'safe_changes'])->map(fn ($event) => ['event_type' => $event->event_type, 'reason_code' => $event->reason_code, 'at' => CarbonImmutable::parse($event->at)->utc()->toIso8601String()]);
        $actions = [];
        foreach (['open', 'pause', 'resume', 'close', 'capacity', 'extend'] as $command) {
            $actions[$command] = route('session.command', ['session' => $record->id, 'command' => $command]);
        }
        $actions['waiting_room'] = route('waiting.index', $record->id);

        return Inertia::render('SessionDetail', ['session' => $commands->dto($record), 'role' => app(TenantContext::class)->role(), 'events' => $events, 'actions' => [...$actions, 'preview' => route('session.capacity.preview', $record->id), 'correct' => route('session.schedule.correct', $record->id)], 'doctors' => Doctor::where('active', true)->get(['id', 'display_name'])]);
    }

    public function create(Request $request, SessionCommands $commands): RedirectResponse|JsonResponse
    {
        abort_unless(app(TenantContext::class)->role() === 'owner', 403);
        $data = $request->validate(self::scheduleRules());
        $record = $commands->create($request, $data);
        if ($request->expectsJson()) {
            return response()->json(['data' => $commands->dto($record)], 201);
        }

        return to_route('sessions.show', $record->id)->with('status', 'تم تجهيز الجلسة ونوافذ الوصول. تفتح داخل وقت استقبالها.');
    }

    public function correct(Request $request, string $session, SessionCommands $commands): RedirectResponse|JsonResponse
    {
        abort_unless(app(TenantContext::class)->role() === 'owner', 403);
        $data = $request->validate([...self::scheduleRules(), 'version' => ['required', 'integer', 'min:1']]);
        $record = $commands->replaceSchedule($request, $session, $data);
        if ($request->expectsJson()) {
            return response()->json(['data' => $commands->dto($record)]);
        }

        return to_route('sessions.show', $record->id)->with('status', 'تم تصحيح جدول الجلسة الخالية وتسجيل التغيير.');
    }

    public function preview(Request $request, string $session, SessionCommands $commands): JsonResponse
    {
        $data = $request->validate(['window_id' => ['required', 'uuid'], 'capacity' => ['required', 'integer', 'min:1', 'max:1000'], 'clinic_id' => ['prohibited']]);

        return response()->json($commands->preview($request, $session, $data));
    }

    public function command(Request $request, string $session, string $command, SessionCommands $commands): JsonResponse
    {
        $rules = ['reason_code' => ['required', Rule::in($command === 'pause' ? [...SessionCommands::REASONS, ...SessionCommands::PAUSE_REASONS] : SessionCommands::REASONS)], 'clinic_id' => ['prohibited'], 'doctor_id' => ['prohibited'], 'user_id' => ['prohibited'], 'version' => ['prohibited'], 'state' => ['prohibited']];
        if ($command === 'capacity') {
            $rules += ['window_id' => ['required', 'uuid'], 'capacity' => ['required', 'integer', 'min:1', 'max:1000'], 'preview_token' => ['required', 'string', 'max:8192'], 'acknowledged' => ['required', 'accepted']];
        } elseif ($command === 'extend') {
            $rules += ['ends_at' => ['required', 'date_format:Y-m-d\TH:i']];
        }

        return response()->json($commands->execute($request, $session, $command, $request->validate($rules)));
    }
}
