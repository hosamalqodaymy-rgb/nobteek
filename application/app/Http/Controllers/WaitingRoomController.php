<?php

namespace App\Http\Controllers;

use App\Models\ClinicSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class WaitingRoomController extends Controller
{
    private function session(string $session): ClinicSession
    {
        $record = ClinicSession::findOrFail($session);
        Gate::authorize('view', $record);

        return $record;
    }

    public function show(string $session): Response
    {
        $record = $this->session($session);

        return Inertia::render('WaitingRoom', ['read_url' => route('waiting.api', $record->id), 'poll_seconds' => 5]);
    }

    public function read(Request $request, string $session): JsonResponse
    {
        abort_if($request->query->count() !== 0, 422);
        $record = $this->session($session);
        $visits = DB::table('visits')->where('clinic_id', $record->clinic_id)->where('session_id', $record->id)->where('doctor_id', $record->doctor_id)
            ->whereIn('state', ['called', 'in_service', 'waiting'])->orderByDesc('priority')->orderBy('ready_sequence')->get(['state', 'ticket_number']);

        return response()->json(['doctor_id' => $record->doctor_id, 'session_state' => $record->state,
            'called_ticket_numbers' => $visits->whereIn('state', ['called', 'in_service'])->pluck('ticket_number')->map(fn ($number): int => (int) $number)->values()->all(),
            'next_ticket_numbers' => $visits->where('state', 'waiting')->take(5)->pluck('ticket_number')->map(fn ($number): int => (int) $number)->values()->all(),
            'server_time' => now()->utc()->toIso8601String()]);
    }
}
