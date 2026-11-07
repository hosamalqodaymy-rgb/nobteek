<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\ReceptionTestCase;

#[Group('postgres')]
class ReceptionAccessTest extends ReceptionTestCase
{
    public function test_day_list_is_clinic_scoped_bounded_and_exposes_only_safe_fields(): void
    {
        $response = $this->getJson('/v1/reception?date=2026-11-07')->assertOk()->assertJsonCount(3, 'arrivals');
        $response->assertJsonMissing(['display_name' => 'مراجع تجريبي باء']);
        $response->assertJsonPath('summary.waiting', 1)->assertJsonPath('summary.not_arrived', 1);
        $this->assertStringNotContainsString('actor_scope_digest', $response->getContent());
        $this->assertStringNotContainsString('digest', $response->getContent());
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertSame('no-referrer', $response->headers->get('Referrer-Policy'));
        $this->get('/workspace/reception')->assertOk()->assertSee('Reception');
    }

    public function test_search_is_name_or_ticket_inside_one_day_and_never_phone_lookup(): void
    {
        $this->getJson('/v1/reception?date=2026-11-07&search='.urlencode('تجريبي ألف'))->assertOk()->assertJsonCount(1, 'arrivals')->assertJsonPath('arrivals.0.visit.ticket_number', 1);
        $this->getJson('/v1/reception?date=2026-11-07&search='.urlencode('١'))->assertOk()->assertJsonCount(1, 'arrivals');
        $this->getJson('/v1/reception?date=2026-11-07&search=%25')->assertUnprocessable();
        $this->getJson('/v1/reception?date=2026-11-07&search=%25%25')->assertOk()->assertJsonCount(0, 'arrivals');
        $this->getJson('/v1/reception?date=2026-11-08')->assertOk()->assertJsonCount(0, 'arrivals');
        $this->getJson('/v1/reception?phone=700000001')->assertUnprocessable();
        $this->getJson('/v1/reception?clinic_id='.$this->id('CLINIC_B'))->assertUnprocessable();
        $this->getJson('/v1/reception?session_id='.$this->id('SESSION_B'))->assertNotFound();
    }

    public function test_filtering_does_not_change_the_authoritative_waiting_position(): void
    {
        $this->arrival()->assertCreated();
        $other = $this->walkIn('اسم مميز للبحث')->assertCreated();
        $this->getJson('/v1/reception?date=2026-11-07&session_id='.$this->id('SESSION_C').'&search='.urlencode('مميز'))
            ->assertOk()->assertJsonCount(1, 'arrivals')->assertJsonPath('arrivals.0.visit.id', $other->json('id'))->assertJsonPath('arrivals.0.visit.waiting_position', 2)->assertJsonPath('summary.waiting', 2);
        $this->getJson('/v1/reception?date=2026-11-07&state=not_arrived')->assertOk()->assertJsonCount(0, 'arrivals');
    }

    public function test_doctor_can_only_mark_away_or_leave_own_visits_and_cannot_manage_reception(): void
    {
        $visit = $this->id('VISIT_A1');
        $this->signIn('DOCTOR_C');
        $this->getJson('/v1/visits/'.$visit)->assertNotFound();
        $this->visitCommand($visit, 'mark-away')->assertNotFound();
        $this->signIn('DOCTOR_A');
        $this->getJson('/v1/visits/'.$visit)->assertOk();
        $this->visitCommand($visit, 'mark-away')->assertOk();
        $this->visitCommand($visit, 'return', 2)->assertForbidden();
        $this->visitCommand($visit, 'defer', 2)->assertForbidden();
        $this->getJson('/v1/reception')->assertForbidden();
        $this->arrival()->assertForbidden();
        $this->walkIn()->assertForbidden();
        $this->visitCommand($visit, 'leave', 2)->assertOk();
    }

    public function test_cross_clinic_unknown_resources_and_platform_access_are_not_found(): void
    {
        $this->arrival($this->id('BOOK_B1'))->assertNotFound();
        $this->getJson('/v1/visits/'.$this->id('VISIT_B1'))->assertNotFound();
        $this->visitCommand($this->id('VISIT_B1'), 'leave')->assertNotFound();
        $this->visitCommand((string) Str::uuid(), 'leave')->assertNotFound();
        $this->signIn('PLATFORM', true);
        $this->getJson('/v1/reception')->assertNotFound();
    }

    public function test_replay_still_requires_active_membership_and_login(): void
    {
        $key = (string) Str::uuid();
        $this->signIn('RECEPTION_A');
        $this->arrival(key: $key)->assertCreated();
        DB::table('memberships')->where('id', $this->id('MEM_RECEPTION_A'))->update(['active' => false]);
        $this->arrival(key: $key)->assertNotFound();
        $this->assertSame(1, DB::table('visits')->where('booking_id', $this->id('BOOK_C1'))->count());
    }

    public function test_suspended_doctor_blocks_new_arrival_but_preserves_departure_management(): void
    {
        DB::table('users')->where('id', $this->id('DOCTOR_C'))->update(['access_suspended' => true]);
        $this->arrival()->assertConflict();
        $this->walkIn()->assertConflict();
        $this->visitCommand($this->id('VISIT_A1'), 'leave')->assertOk();
    }

    public function test_owner_without_mfa_cannot_use_reception(): void
    {
        $this->signIn('OWNER_A');
        $this->getJson('/v1/reception')->assertStatus(423);
        $this->arrival()->assertStatus(423);
    }
}
