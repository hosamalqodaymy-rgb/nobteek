<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use PHPUnit\Framework\Attributes\Group;
use Tests\ClinicOperationsTestCase;

#[Group('postgres')]
class ClinicSetupTest extends ClinicOperationsTestCase
{
    private function onboarding(): array
    {
        return ['display_name' => 'عيادة وهمية جديدة', 'city' => 'إب', 'address_landmark' => 'قرب معلم تجريبي', 'contact_phone' => '٧٧١ ٢٣٤ ٥٦٧', 'owner_username' => 'synthetic_new_owner', 'owner_display_name' => 'مالك وهمي'];
    }

    public function test_platform_creates_clinic_and_disabled_owner_atomically_and_returns_private_grant(): void
    {
        $this->signIn('PLATFORM', true);
        $result = $this->postJson('/platform/clinics', $this->onboarding())->assertCreated();
        $clinic = Clinic::findOrFail($result->json('clinic_id'));
        $owner = User::where('username', 'synthetic_new_owner')->firstOrFail();
        $this->assertSame('+967771234567', $clinic->contact_phone);
        $this->assertSame('Asia/Aden', $clinic->timezone);
        $this->assertFalse($owner->login_enabled);
        $this->assertNull($owner->password);
        $this->assertDatabaseHas('memberships', ['clinic_id' => $clinic->id, 'user_id' => $owner->id, 'role' => 'owner']);
        $this->assertStringContainsString('#token=', $result->json('account_link'));
        $this->assertSame(1, DB::table('security_events')->where('event_type', 'clinic_onboarded')->count());
        $this->getJson('/v1/patients')->assertNotFound();
    }

    public function test_repeated_username_never_leaves_an_orphan_or_duplicate_clinic(): void
    {
        $this->signIn('PLATFORM', true);
        $this->postJson('/platform/clinics', $this->onboarding())->assertCreated();
        $this->postJson('/platform/clinics', $this->onboarding())->assertUnprocessable();
        $this->assertSame(3, Clinic::count());
        $this->assertSame(1, User::where('username', 'synthetic_new_owner')->count());
        $this->assertSame(1, DB::table('account_grants')->count());
    }

    public function test_only_verified_recent_platform_admin_can_onboard(): void
    {
        $this->owner();
        $this->postJson('/platform/clinics', $this->onboarding())->assertForbidden();
        $this->signIn('PLATFORM');
        $this->postJson('/platform/clinics', $this->onboarding())->assertStatus(423);
        $this->signIn('PLATFORM', true);
        $this->travel(11)->minutes();
        $this->postJson('/platform/clinics', $this->onboarding())->assertStatus(423);
        $this->assertSame(2, Clinic::count());
    }

    public function test_owner_updates_only_current_clinic_with_version_and_normalized_phone(): void
    {
        $this->owner();
        $data = ['display_name' => 'عيادة ألف المعدلة', 'city' => 'ذمار', 'address_landmark' => 'حي تجريبي', 'contact_phone' => '00967771234567', 'version' => 1];
        $this->post('/workspace/clinic', $data)->assertRedirect('/workspace/clinic');
        $this->assertDatabaseHas('clinics', ['id' => $this->id('CLINIC_A'), 'version' => 2, 'contact_phone' => '+967771234567']);
        $this->assertDatabaseHas('clinics', ['id' => $this->id('CLINIC_B'), 'version' => 1]);
        $this->postJson('/workspace/clinic', $data)->assertUnprocessable();
        $this->postJson('/workspace/clinic', [...$data, 'version' => 2, 'clinic_id' => $this->id('CLINIC_B')])->assertUnprocessable();
        $this->assertSame(1, DB::table('audit_events')->where('event_type', 'clinic_updated')->count());
    }

    public function test_non_owner_cannot_read_or_change_clinic_setup_and_forged_clinic_fields_are_rejected(): void
    {
        $this->signIn('RECEPTION_A');
        $this->getJson('/workspace/clinic')->assertForbidden();
        $this->postJson('/workspace/clinic', [])->assertForbidden();
        $this->owner();
        $this->get('/workspace/clinic')->assertOk()->assertInertia(fn (Assert $p) => $p->component('ClinicSettings')->where('clinic.version', 1));
        $this->postJson('/workspace/clinic', ['display_name' => 'أ', 'contact_phone' => '123'])->assertUnprocessable();
    }

    public function test_doctor_profile_must_match_a_doctor_membership_in_current_clinic(): void
    {
        $this->owner();
        $staff = User::factory()->create();
        $membership = (string) Str::uuid();
        DB::table('memberships')->insert(['id' => $membership, 'clinic_id' => $this->id('CLINIC_A'), 'user_id' => $staff->id, 'role' => 'doctor']);
        $data = ['membership_id' => $membership, 'display_name' => 'طبيب وهمي جديد', 'specialty_optional' => 'طب عام'];
        $this->post('/workspace/doctors', $data)->assertRedirect('/workspace/clinic');
        $this->assertDatabaseHas('doctors', ['clinic_id' => $this->id('CLINIC_A'), 'user_id' => $staff->id, 'active' => true]);
        $this->postJson('/workspace/doctors', $data)->assertUnprocessable();
        $this->postJson('/workspace/doctors', [...$data, 'membership_id' => $this->id('MEM_DOCTOR_B')])->assertNotFound();
        $this->postJson('/workspace/doctors', [...$data, 'membership_id' => $this->id('MEM_RECEPTION_A')])->assertNotFound();
    }

    public function test_profile_identity_cannot_be_reassigned_and_inactive_doctor_fails_closed(): void
    {
        $this->owner();
        $data = ['display_name' => 'طبيب معدل', 'specialty_optional' => 'طب عام', 'active' => true, 'version' => 1];
        $this->postJson('/workspace/doctors/'.$this->id('DR_A'), [...$data, 'user_id' => $this->id('DOCTOR_B')])->assertUnprocessable();
        $this->postJson('/workspace/doctors/'.$this->id('DR_B'), $data)->assertNotFound();
        $this->postJson('/workspace/doctors/'.$this->id('DR_A'), [...$data, 'active' => false])->assertUnprocessable();
        DB::table('clinic_sessions')->where('id', $this->id('SESSION_A'))->update(['state' => 'closed']);
        $this->post('/workspace/doctors/'.$this->id('DR_A'), [...$data, 'active' => false])->assertRedirect();
        $this->signIn('DOCTOR_A');
        $this->getJson('/v1/patients')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/v1/sessions/'.$this->id('SESSION_A'))->assertNotFound();
    }
}
