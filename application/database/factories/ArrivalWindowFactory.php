<?php

namespace Database\Factories;

use App\Models\ArrivalWindow;
use App\Models\ClinicSession;
use Illuminate\Database\Eloquent\Factories\Factory;

/** Synthetic data only. Requires an explicit trusted TenantContext. @extends Factory<ArrivalWindow> */
class ArrivalWindowFactory extends Factory
{
    public function definition(): array
    {
        return ['session_id' => ClinicSession::factory(), 'starts_at' => fn (array $a) => ClinicSession::findOrFail($a['session_id'])->starts_at, 'ends_at' => fn (array $a) => ClinicSession::findOrFail($a['session_id'])->ends_at, 'capacity' => 5];
    }
}
