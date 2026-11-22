<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\ReceptionTestCase;

#[Group('postgres')]
class P11OutageTest extends ReceptionTestCase
{
    private function snapshot(): array
    {
        return $this->getJson('/v1/outage/status?date=2026-11-07')->assertOk()->json();
    }

    public function test_read_only_snapshot_preserves_server_ticket_counter_and_replay(): void
    {
        $before = $this->snapshot();
        $session = collect($before['sessions'])->firstWhere('id', $this->id('SESSION_C'));
        $this->assertNotNull($session);
        $this->assertSame(0, $session['issued_tickets']);
        $this->assertSame(1, $session['not_arrived']);
        $this->assertTrue($before['synchronized']);
        $this->assertSame($before, $this->snapshot());

        $key = (string) Str::uuid();
        $receipt = $this->arrival(key: $key)->assertCreated();
        $after = $this->snapshot();
        $updated = collect($after['sessions'])->firstWhere('id', $this->id('SESSION_C'));
        $this->assertSame(1, $updated['issued_tickets']);
        $this->assertSame(1, $updated['waiting']);
        $this->assertSame(0, $updated['not_arrived']);

        $this->arrival(key: $key)->assertCreated()->assertJsonPath('replayed', true)
            ->assertJsonPath('id', $receipt->json('id'));
        $this->assertSame($after['sessions'], $this->snapshot()['sessions']);
        $this->assertSame(1, DB::table('visits')->where('booking_id', $this->id('BOOK_C1'))->count());
        $this->assertSame(1, (int) DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->value('ticket_counter'));
    }

    public function test_only_same_clinic_and_same_doctor_sessions_are_visible_without_pii(): void
    {
        $owner = $this->snapshot();
        $this->assertCount(2, $owner['sessions']);
        $this->assertSame($this->id('CLINIC_A'), DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->value('clinic_id'));
        $encoded = json_encode($owner, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        foreach (['contact_phone', 'display_name', 'patient_id', 'ticket_url', 'secret', 'مراجع تجريبي'] as $private) {
            $this->assertStringNotContainsString($private, $encoded);
        }
        $this->assertArrayNotHasKey('patient_id', $owner);

        $this->signIn('RECEPTION_A');
        $this->getJson('/v1/outage/status?date=2026-11-07')->assertOk();
        $this->signIn('DOCTOR_C');
        $doctor = $this->snapshot();
        $this->assertCount(1, $doctor['sessions']);
        $this->assertSame($this->id('SESSION_C'), $doctor['sessions'][0]['id']);
        $this->getJson('/v1/outage/status?date=2026-11-07&session_id='.$this->id('SESSION_A'))->assertOk()->assertJsonPath('sessions', []);

        $this->signIn('OWNER_B', true);
        $foreign = $this->snapshot();
        $this->assertCount(1, $foreign['sessions']);
        $this->assertSame($this->id('SESSION_B'), $foreign['sessions'][0]['id']);
        $this->signIn('PLATFORM', true);
        $this->getJson('/workspace/outage')->assertNotFound();
        $this->getJson('/v1/outage/status')->assertNotFound();
    }

    public function test_outage_is_read_only_rejects_foreign_inputs_and_requires_login(): void
    {
        $this->assertStringContainsString('no-store', (string) $this->get('/workspace/outage?date=2026-11-07')->assertOk()->headers->get('Cache-Control'));
        $this->getJson('/v1/outage/status?clinic_id='.$this->id('CLINIC_B'))->assertUnprocessable();
        $this->getJson('/v1/outage/status?patient_id='.$this->id('PAT_B1'))->assertUnprocessable();
        $this->getJson('/v1/outage/status?ticket_number=10')->assertUnprocessable();
        $this->getJson('/v1/outage/status?date=2026-11-31')->assertUnprocessable();
        $this->postJson('/v1/outage/status', [])->assertMethodNotAllowed();
        $this->postJson('/workspace/outage', [])->assertMethodNotAllowed();

        $this->post('/logout')->assertRedirect();
        $this->getJson('/v1/outage/status')->assertUnauthorized();
    }

    public function test_security_headers_apply_only_https_hsts_and_disable_sensitive_browser_features(): void
    {
        $normal = $this->get('/workspace/outage?date=2026-11-07')->assertOk();
        $normal->assertHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        $normal->assertHeader('Cross-Origin-Opener-Policy', 'same-origin');
        $this->assertFalse($normal->headers->has('Strict-Transport-Security'));

        $secure = $this->get('https://localhost/workspace/outage?date=2026-11-07')->assertOk();
        $secure->assertHeader('Strict-Transport-Security', 'max-age=31536000');
        $secure->assertHeader('Referrer-Policy', 'no-referrer');
        $secure->assertHeader('X-Frame-Options', 'DENY');
    }
}
