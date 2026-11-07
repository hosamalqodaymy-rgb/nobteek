<?php

namespace Database\Factories;

use App\Models\Membership;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** Synthetic data only. Requires an explicit trusted TenantContext. @extends Factory<Membership> */
class MembershipFactory extends Factory
{
    public function definition(): array
    {
        return ['user_id' => User::factory(), 'role' => 'reception', 'active' => true];
    }
}
