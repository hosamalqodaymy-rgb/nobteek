<?php

namespace Database\Factories;

use App\Models\Doctor;
use App\Models\Membership;
use Illuminate\Database\Eloquent\Factories\Factory;

/** Synthetic data only. Requires an explicit trusted TenantContext. @extends Factory<Doctor> */
class DoctorFactory extends Factory
{
    public function definition(): array
    {
        return ['user_id' => fn () => Membership::factory()->create(['role' => 'doctor'])->user_id, 'display_name' => 'طبيب وهمي'];
    }
}
