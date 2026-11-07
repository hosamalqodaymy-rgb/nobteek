<?php

namespace Tests;

use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

abstract class ClinicOperationsTestCase extends SecurityTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-11-07T13:30:00Z'));
    }

    protected function owner(): void
    {
        $this->user('DOCTOR_A');
        $this->signIn('OWNER_A', true);
    }

    protected function schedule(): array
    {
        return ['doctor_id' => $this->id('DR_A'), 'starts_at' => '2026-11-07T18:00', 'ends_at' => '2026-11-07T20:00', 'windows' => [
            ['starts_at' => '2026-11-07T18:00', 'ends_at' => '2026-11-07T19:00', 'capacity' => 2],
            ['starts_at' => '2026-11-07T19:00', 'ends_at' => '2026-11-07T20:00', 'capacity' => 3]]];
    }

    protected function scheduled(): string
    {
        return $this->postJson('/workspace/sessions', $this->schedule())->assertCreated()->json('data.id');
    }

    protected function headers(int $version = 1, ?string $key = null): array
    {
        return ['If-Match' => '"'.$version.'"', 'Idempotency-Key' => $key ?? (string) Str::uuid()];
    }

    protected function command(string $id, string $command, array $data = [], int $version = 1, ?string $key = null): TestResponse
    {
        $reasons = ['open' => 'scheduled_start', 'pause' => 'operational_pause', 'resume' => 'service_resumed', 'close' => 'session_completed', 'capacity' => 'capacity_adjustment', 'extend' => 'intake_extended'];

        return $this->postJson('/v1/sessions/'.$id.'/'.$command, ['reason_code' => $reasons[$command], ...$data], $this->headers($version, $key));
    }

    protected function preview(int $capacity = 1): array
    {
        return $this->postJson('/v1/sessions/'.$this->id('SESSION_A').'/capacity/preview', ['window_id' => $this->id('W1_A'), 'capacity' => $capacity], ['If-Match' => '"1"'])->assertOk()->json();
    }
}
