<?php

namespace Database\Factories;

use App\Models\Booking;
use App\Models\ClinicSession;
use App\Models\Visit;
use Illuminate\Database\Eloquent\Factories\Factory;

/** Synthetic data only. Requires an explicit trusted TenantContext. @extends Factory<Visit> */
class VisitFactory extends Factory
{
    public function definition(): array
    {
        return ['booking_id' => Booking::factory(), 'session_id' => fn (array $a) => Booking::findOrFail($a['booking_id'])->session_id, 'doctor_id' => fn (array $a) => ClinicSession::findOrFail($a['session_id'])->doctor_id, 'ticket_number' => 1, 'ready_sequence' => 1, 'state' => 'waiting'];
    }
}
