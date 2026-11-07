<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<User> */
class UserFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'id' => (string) Str::uuid(),
            'username' => 'demo_'.fake()->unique()->bothify('????????####'),
            'display_name' => 'حساب تجريبي',
            'password' => null,
            'login_enabled' => false,
            'platform_role' => null,
        ];
    }
}
