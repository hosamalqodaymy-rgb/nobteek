<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\DemoFoundationSeeder;
use Inertia\DevTools\DevTools;
use Inertia\Testing\AssertableInertia as Assert;
use RuntimeException;
use Tests\TestCase;

class FoundationApplicationTest extends TestCase
{
    public function test_welcome_uses_the_shared_arabic_identity(): void
    {
        $this->withoutVite()->get('/')->assertOk()->assertInertia(fn (Assert $page) => $page
            ->component('Welcome')
            ->where('brand.name', 'نوبتيك')
            ->where('brand.tagline', 'يوم عيادتك بترتيب واضح'));
    }

    public function test_health_endpoint_boots_without_database_access(): void
    {
        $this->get('/up')->assertOk();
    }

    public function test_registration_and_ticket_routes_remain_closed_and_booking_routes_require_valid_context(): void
    {
        foreach (['/register', '/v1/tickets/demo'] as $path) {
            $this->get($path)->assertNotFound();
        }
        $this->getJson('/v1/bookings')->assertUnauthorized();
        $this->postJson('/v1/booking-requests', [])->assertUnprocessable();
    }

    public function test_paid_integrations_and_real_data_remain_disabled(): void
    {
        foreach (['external_payments', 'paid_messaging', 'real_patient_data', 'intake_enabled'] as $flag) {
            $this->assertFalse(config('nobteek.'.$flag));
        }
    }

    public function test_postgresql_and_aden_are_configured(): void
    {
        $this->assertSame('pgsql', config('database.default'));
        $this->assertSame('Asia/Aden', config('app.timezone'));
    }

    public function test_demo_factory_has_no_enabled_login_or_password(): void
    {
        $user = User::factory()->make();
        $this->assertFalse($user->login_enabled);
        $this->assertNull($user->password);
        $this->assertStringStartsWith('demo_', $user->username);
    }

    public function test_demo_seeding_refuses_production(): void
    {
        $this->app['env'] = 'production';
        $this->expectException(RuntimeException::class);
        (new DemoFoundationSeeder)->run();
    }

    public function test_demo_seeding_refuses_an_unrelated_database(): void
    {
        config(['nobteek.demo_seed_enabled' => true, 'database.connections.pgsql.database' => 'unrelated_database']);
        $this->expectException(RuntimeException::class);
        (new DemoFoundationSeeder)->run();
    }

    public function test_sensitive_page_recording_is_disabled_even_in_local_environment(): void
    {
        $this->app['env'] = 'local';
        $this->assertFalse(config('inertia.devtools.enabled'));
        $this->assertFalse(DevTools::enabled());
        $this->withoutVite()->get('/_inertia/devtools/entries')->assertNotFound();
    }
}
