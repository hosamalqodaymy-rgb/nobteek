<?php

namespace Database\Factories;

use App\Models\Patient;
use Illuminate\Database\Eloquent\Factories\Factory;

/** Synthetic data only. Requires an explicit trusted TenantContext. @extends Factory<Patient> */
class PatientFactory extends Factory
{
    public function definition(): array
    {
        return ['display_name' => 'مراجع وهمي '.fake()->numerify('####'), 'contact_phone' => null];
    }
}
