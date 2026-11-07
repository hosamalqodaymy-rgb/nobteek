<?php

namespace Database\Factories;

use App\Models\ClinicSession;
use App\Models\Doctor;
use Illuminate\Database\Eloquent\Factories\Factory;

/** Synthetic data only. Requires an explicit trusted TenantContext. @extends Factory<ClinicSession> */
class ClinicSessionFactory extends Factory
{
    public function definition(): array
    {
        return ['doctor_id' => Doctor::factory(), 'starts_at' => now()->addDay()->setTime(14, 0), 'ends_at' => now()->addDay()->setTime(16, 0), 'state' => 'scheduled'];
    }
}
