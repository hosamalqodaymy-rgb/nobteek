<?php

namespace App\Http\Resources;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;

class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $patient = DB::table('patients')->where('clinic_id', $this->clinic_id)->where('id', $this->patient_id)->firstOrFail();
        $session = DB::table('clinic_sessions')->where('clinic_id', $this->clinic_id)->where('id', $this->session_id)->firstOrFail();
        $window = DB::table('arrival_windows')->where('clinic_id', $this->clinic_id)->where('id', $this->window_id)->firstOrFail();
        $visit = DB::table('visits')->where('clinic_id', $this->clinic_id)->where('booking_id', $this->id)->first();
        $actions = [];
        foreach (['confirm', 'reject', 'cancel', 'reschedule'] as $command) {
            $actions[$command] = route('booking.command', ['booking' => $this->id, 'command' => $command]);
        }

        return ['id' => $this->id, 'patient_id' => $patient->id, 'display_name' => $patient->display_name, 'contact_phone' => $patient->contact_phone, 'state' => $this->state,
            'version' => $this->version, 'source' => $this->source, 'session_id' => $this->session_id, 'window_id' => $this->window_id,
            'doctor_name' => DB::table('doctors')->where('clinic_id', $this->clinic_id)->where('id', $session->doctor_id)->value('display_name'),
            'window_starts_at' => CarbonImmutable::parse($window->starts_at)->utc()->toIso8601String(), 'window_ends_at' => CarbonImmutable::parse($window->ends_at)->utc()->toIso8601String(),
            'visit_state' => $visit?->state, 'visit_started' => $visit?->started_at !== null, 'has_arrived' => $visit !== null, 'actions' => $actions];
    }
}
