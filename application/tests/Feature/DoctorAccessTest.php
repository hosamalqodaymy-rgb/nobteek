<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\DoctorTestCase;

#[Group('postgres')]
class DoctorAccessTest extends DoctorTestCase
{
    public function test_reception_call_is_disabled_by_default_and_owner_has_no_clinical_permission(): void
    {
        $visit = $this->arrivedVisit();
        foreach (['OWNER_A', 'RECEPTION_A'] as $actor) {
            $this->signIn($actor, $actor === 'OWNER_A');
            $this->doctorList()->assertForbidden();
            $this->callNext()->assertForbidden();
            $this->doctorAction($visit, 'start')->assertForbidden();
            $this->doctorAction($visit, 'priority', ['reason_code' => 'clinical_priority'])->assertForbidden();
        }
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'waiting', 'version' => 1, 'priority' => false]);
        $this->assertSame(0, DB::table('audit_events')->where('event_type', 'visit_call_next')->count());
    }

    public function test_explicit_reception_delegation_allows_call_but_no_clinical_commands(): void
    {
        $visit = $this->arrivedVisit();
        $this->delegation(true)->assertOk()->assertJsonPath('call_next', true)->assertJsonPath('delegation_version', 2);
        $this->signIn('RECEPTION_A');
        $this->doctorList()->assertOk()->assertJsonPath('permissions.can_practice', false)
            ->assertJsonPath('permissions.delegated_call_next', true)->assertJsonCount(0, 'visits.0.actions');
        $this->callNext()->assertOk()->assertJsonPath('id', $visit)->assertJsonPath('state', 'called');
        foreach (['start' => [], 'complete' => [], 'priority' => ['reason_code' => 'clinical_priority'], 'correct' => ['reason_code' => 'entered_in_error']] as $command => $data) {
            $this->doctorAction($visit, $command, $data)->assertForbidden();
        }
        $this->doctorList('called')->assertOk()->assertJsonCount(0, 'active_visit.actions');
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'called', 'started_at' => null, 'completed_at' => null]);
    }

    public function test_revoking_reception_delegation_blocks_replay_of_a_successful_call(): void
    {
        $visit = $this->arrivedVisit();
        $this->delegation(true)->assertOk();
        $this->signIn('RECEPTION_A');
        $key = (string) Str::uuid();
        $version = (int) DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->value('version');
        $this->callNext(version: $version, key: $key)->assertOk()->assertJsonPath('id', $visit);
        $this->owner();
        $this->delegation(false)->assertOk()->assertJsonPath('call_next', false)->assertJsonPath('delegation_version', 3);
        $this->signIn('RECEPTION_A');
        $this->callNext(version: $version, key: $key)->assertForbidden();
        $this->doctorList()->assertForbidden();
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $visit)->where('event_type', 'visit_call_next')->count());
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'called', 'version' => 2]);
    }

    public function test_delegation_and_its_replay_require_a_recent_mfa_verified_owner(): void
    {
        $this->signIn('RECEPTION_A');
        $this->delegation(true)->assertForbidden();
        $this->doctor();
        $this->delegation(true)->assertForbidden();
        $this->owner();
        $key = (string) Str::uuid();
        $this->delegation(true, 1, $key)->assertOk();
        $this->signIn('OWNER_A');
        $this->delegation(true, 1, $key)->assertStatus(423);
        $this->owner();
        $this->withSession(['auth_confirmed_at' => now()->subMinutes(11)->timestamp]);
        $this->delegation(true, 1, $key)->assertStatus(423);
        $this->assertSame(1, DB::table('security_events')->where('event_type', 'call_next_delegation_changed')->count());
    }

    public function test_delegation_targets_only_an_active_reception_membership_in_the_same_clinic(): void
    {
        $this->delegation(true, 1, membership: $this->id('MEM_RECEPTION_B'))->assertNotFound();
        $this->delegation(true, 1, membership: (string) Str::uuid())->assertNotFound();
        $this->delegation(true, 1, membership: $this->id('MEM_DOCTOR_C'))->assertForbidden();
        $this->delegation(true, 1, membership: $this->id('MEM_OWNER_A'))->assertForbidden();
        DB::table('memberships')->where('id', $this->id('MEM_RECEPTION_A'))->update(['active' => false]);
        $this->delegation(true, 1)->assertForbidden();
        $this->assertSame(0, DB::table('audit_events')->where('event_type', 'call_next_delegation_changed')->count());
        $this->assertDatabaseHas('memberships', ['id' => $this->id('MEM_RECEPTION_A'), 'delegation_version' => 1]);
    }

    public function test_delegation_retries_are_idempotent_and_stale_or_changed_requests_conflict(): void
    {
        $key = (string) Str::uuid();
        $first = $this->delegation(true, 1, $key)->assertOk();
        $before = $this->doctorSnapshot();
        $this->delegation(true, 1, $key)->assertOk()->assertJsonPath('replayed', true)
            ->assertJsonPath('request_id', $first->json('request_id'))->assertJsonPath('delegation_version', 2);
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->delegation(false, 1, $key)->assertConflict();
        $this->delegation(false, 1)->assertConflict();
        $this->assertEquals($before, $this->doctorSnapshot());
        $this->delegation(false, 2)->assertOk()->assertJsonPath('call_next', false)->assertJsonPath('delegation_version', 3);
        $this->assertSame(2, DB::table('audit_events')->where('event_type', 'call_next_delegation_changed')->count());
        $this->assertSame(2, DB::table('security_events')->where('event_type', 'call_next_delegation_changed')->count());
    }

    public function test_delegation_requires_headers_matching_reason_and_server_owned_permissions(): void
    {
        $url = '/workspace/team/'.$this->id('MEM_RECEPTION_A').'/delegation';
        $data = ['call_next' => true, 'reason_code' => 'delegation_granted'];
        $before = $this->doctorSnapshot();
        $this->postJson($url, $data)->assertStatus(428);
        $this->postJson($url, $data, ['If-Match' => '1'])->assertUnprocessable();
        $this->postJson($url, [...$data, 'reason_code' => 'delegation_revoked'], $this->headers())->assertUnprocessable();
        $this->postJson($url, [...$data, 'call_next' => 'yes'], $this->headers())->assertUnprocessable();
        foreach (['clinic_id' => $this->id('CLINIC_B'), 'role' => 'doctor', 'delegation_version' => 9, 'delegated_permissions' => ['call_next' => true, 'complete' => true]] as $field => $value) {
            $this->postJson($url, [...$data, $field => $value], $this->headers())->assertUnprocessable();
        }
        $this->assertEquals($before, $this->doctorSnapshot());
    }

    public function test_other_doctor_and_clinic_records_are_hidden_and_platform_or_guest_cannot_practice(): void
    {
        $this->arrivedVisit();
        $this->doctor();
        foreach ([$this->id('SESSION_A'), $this->id('SESSION_B'), (string) Str::uuid()] as $session) {
            $this->callNext($session, 1)->assertNotFound();
            $this->doctorList(session: $session)->assertNotFound();
        }
        foreach ([$this->id('VISIT_A1'), $this->id('VISIT_B1'), (string) Str::uuid()] as $visit) {
            $this->doctorAction($visit, 'start', version: 1)->assertNotFound();
            $this->doctorAction($visit, 'priority', ['reason_code' => 'clinical_priority'], 1)->assertNotFound();
        }
        $this->signIn('PLATFORM', true);
        $this->doctorList()->assertNotFound();
        $this->callNext()->assertNotFound();
        Auth::logout();
        session()->invalidate();
        $this->doctorList()->assertUnauthorized();
        $this->callNext()->assertUnauthorized();
    }

    public function test_doctor_workspace_is_private_and_scoped_to_own_visits_without_contact_or_replay_secrets(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $response = $this->doctorList()->assertOk()->assertJsonCount(1, 'visits')->assertJsonPath('visits.0.id', $visit)
            ->assertJsonPath('visits.0.doctor_id', $this->id('DR_C'))->assertJsonPath('permissions.can_practice', true);
        $response->assertJsonMissing(['booking_id' => $this->id('BOOK_A1')])->assertJsonMissing(['booking_id' => $this->id('BOOK_B1')]);
        $this->assertArrayNotHasKey('contact_phone', $response->json('visits.0'));
        $this->assertStringNotContainsString('response_ciphertext', $response->getContent());
        $this->assertStringNotContainsString('digest', $response->getContent());
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertSame('no-referrer', $response->headers->get('Referrer-Policy'));
        $this->get('/workspace/doctor')->assertOk()->assertSee('Doctor');
        foreach (['clinic_id' => $this->id('CLINIC_B'), 'doctor_id' => $this->id('DR_A'), 'phone' => '700000001', 'search' => 'مراجع'] as $field => $value) {
            $this->getJson('/v1/doctor?date=2026-11-07&'.$field.'='.urlencode($value))->assertUnprocessable();
        }
    }

    public function test_successful_clinical_replay_rechecks_current_membership_and_doctor_profile(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $key = (string) Str::uuid();
        $this->callNext(version: 2, key: $key)->assertOk();
        DB::table('memberships')->where('id', $this->id('MEM_DOCTOR_C'))->update(['active' => false]);
        $this->callNext(version: 2, key: $key)->assertNotFound();
        DB::table('memberships')->where('id', $this->id('MEM_DOCTOR_C'))->update(['active' => true]);
        DB::table('doctors')->where('id', $this->id('DR_C'))->update(['active' => false]);
        $this->callNext(version: 2, key: $key)->assertForbidden();
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $visit)->where('event_type', 'visit_call_next')->count());
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'called', 'version' => 2]);
    }

    public function test_session_list_limit_does_not_hide_active_or_explicitly_selected_doctor_session(): void
    {
        $start = CarbonImmutable::parse('2026-11-07T00:00:00', 'Asia/Aden')->utc();
        $sessions = [];
        $windows = [];
        for ($index = 0; $index < 60; $index++) {
            $id = (string) Str::uuid();
            $from = $start->addMinutes($index)->toIso8601String();
            $until = $start->addMinutes($index + 1)->toIso8601String();
            $sessions[] = ['id' => $id, 'clinic_id' => $this->id('CLINIC_A'), 'doctor_id' => $this->id('DR_C'), 'starts_at' => $from, 'ends_at' => $until, 'state' => 'closed'];
            $windows[] = ['id' => (string) Str::uuid(), 'clinic_id' => $this->id('CLINIC_A'), 'session_id' => $id, 'starts_at' => $from, 'ends_at' => $until, 'capacity' => 1];
        }
        DB::table('clinic_sessions')->insert($sessions);
        DB::table('arrival_windows')->insert($windows);
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->callNext()->assertOk();
        $this->getJson('/v1/doctor?date=2026-11-07')->assertOk()
            ->assertJsonPath('selected_session.id', $this->id('SESSION_C'))->assertJsonPath('active_visit.id', $visit);
        $this->doctorList('called')->assertOk()->assertJsonPath('active_visit.id', $visit);
        $this->doctorAction($visit, 'start')->assertOk();
        $this->doctorAction($visit, 'complete')->assertOk();
        $this->doctorList('completed')->assertOk()->assertJsonPath('selected_session.id', $this->id('SESSION_C'))
            ->assertJsonPath('visits.0.id', $visit)->assertJsonPath('visits.0.state', 'completed');
        $this->doctorList('completed', date: '2026-11-08')->assertNotFound();
    }

    public function test_successful_replay_never_bypasses_suspension_disabled_login_or_security_version(): void
    {
        $visit = $this->arrivedVisit();
        $doctor = $this->doctor();
        $key = (string) Str::uuid();
        $this->callNext(version: 2, key: $key)->assertOk();
        foreach ([['access_suspended' => true], ['login_enabled' => false], ['security_version' => $doctor->security_version + 1]] as $change) {
            DB::table('users')->where('id', $doctor->id)->update(['access_suspended' => false, 'login_enabled' => true, 'security_version' => $doctor->security_version]);
            $this->doctor();
            DB::table('users')->where('id', $doctor->id)->update($change);
            $this->callNext(version: 2, key: $key)->assertUnauthorized();
        }
        $this->assertSame(1, DB::table('audit_events')->where('entity_id', $visit)->where('event_type', 'visit_call_next')->count());
        $this->assertDatabaseHas('visits', ['id' => $visit, 'state' => 'called', 'version' => 2]);
    }

    public function test_doctor_with_configured_mfa_must_still_verify_it_before_replay(): void
    {
        $this->arrivedVisit();
        $this->signIn('DOCTOR_C', true);
        $key = (string) Str::uuid();
        $this->callNext(version: 2, key: $key)->assertOk();
        $this->withSession(['mfa_verified_version' => null]);
        $this->callNext(version: 2, key: $key)->assertStatus(423);
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'visit_call_next')->count());
    }

    public function test_clinical_commands_require_valid_headers_fixed_reasons_and_server_owned_state_and_times(): void
    {
        $visit = $this->arrivedVisit();
        $this->doctor();
        $url = '/v1/sessions/'.$this->id('SESSION_C').'/call-next';
        $before = $this->doctorSnapshot();
        $this->postJson($url, [])->assertStatus(428);
        $this->postJson($url, [], ['If-Match' => '2'])->assertUnprocessable();
        $this->postJson($url, [], ['If-Match' => '0', 'Idempotency-Key' => (string) Str::uuid()])->assertUnprocessable();
        $this->callNext(version: 99)->assertConflict();
        foreach (['clinic_id' => $this->id('CLINIC_B'), 'visit_id' => $visit, 'state' => 'called', 'called_at' => '2026-11-07T12:00:00Z', 'priority' => true] as $field => $value) {
            $this->postJson($url, [$field => $value], $this->headers(2))->assertUnprocessable();
        }
        $this->doctorAction($visit, 'priority', ['reason_code' => 'unrestricted_text'])->assertUnprocessable();
        $this->doctorAction($visit, 'priority', ['reason_code' => 'clinical_priority', 'clinical_notes' => 'بيانات لا تحفظ'])->assertUnprocessable();
        $this->doctorAction($visit, 'correct', ['reason_code' => 'change_patient'])->assertUnprocessable();
        $this->assertEquals($before, $this->doctorSnapshot());
        $key = (string) Str::uuid();
        $this->callNext(version: 2, key: $key)->assertOk();
        $before = $this->doctorSnapshot();
        $this->callNext(version: 3, key: $key)->assertConflict();
        $this->doctorAction($visit, 'start', ['started_at' => '2026-11-07T12:00:00Z'])->assertUnprocessable();
        $this->doctorAction($visit, 'start', ['reason_code' => 'consultation_started'])->assertUnprocessable();
        $this->doctorAction($visit, 'complete', ['completed_at' => '2026-11-07T13:00:00Z'])->assertUnprocessable();
        $this->assertEquals($before, $this->doctorSnapshot());
    }
}
