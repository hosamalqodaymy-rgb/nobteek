<?php

namespace Database\Factories;

use App\Models\Clinic;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Clinic> */
class ClinicFactory extends Factory
{
    public function definition(): array
    {
        return ['display_name' => 'عيادة وهمية '.fake()->numerify('####'), 'city' => 'إب - بيانات وهمية', 'address_landmark' => 'عنوان تجريبي', 'timezone' => 'Asia/Aden', 'operational_state' => 'active'];
    }
}
