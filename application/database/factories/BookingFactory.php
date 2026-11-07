<?php

namespace Database\Factories;

use App\Models\ArrivalWindow;
use App\Models\Booking;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Factories\Factory;

/** Synthetic data only. Requires an explicit trusted TenantContext. @extends Factory<Booking> */
class BookingFactory extends Factory
{
    public function definition(): array
    {
        return ['patient_id' => Patient::factory(), 'window_id' => ArrivalWindow::factory(), 'session_id' => fn (array $a) => ArrivalWindow::findOrFail($a['window_id'])->session_id, 'source' => 'walk_in', 'state' => 'confirmed'];
    }
}
