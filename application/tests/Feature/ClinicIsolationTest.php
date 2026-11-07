<?php

namespace Tests\Feature;

use App\Models\ArrivalWindow;
use App\Models\Booking;
use App\Models\ClinicSession;
use App\Models\Doctor;
use App\Models\Membership;
use App\Models\Patient;
use App\Models\Visit;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\SecurityTestCase;

#[Group('postgres')]
class ClinicIsolationTest extends SecurityTestCase
{
    public function test_t04a_employee_cannot_read_modify_or_export_another_clinic(): void
    {
        $this->signIn('RECEPTION_A');
        $this->getJson('/v1/patients')->assertOk()->assertJsonCount(3, 'data')->assertJsonMissing(['id' => $this->id('PAT_B1')]);
        $this->getJson('/v1/patients/'.$this->id('PAT_B1'))->assertNotFound();
        $this->patchJson('/v1/patients/'.$this->id('PAT_B1'), $this->data())->assertNotFound();
        $this->getJson('/v1/patients/export?clinic_id='.$this->id('CLINIC_B'))->assertUnprocessable();
        $export = $this->get('/v1/patients/export')->assertOk();
        $this->assertStringNotContainsString('+967700000003', $export->getContent());
        $this->assertStringContainsString('+967700000001', $export->getContent());
        $this->assertDatabaseHas('patients', ['id' => $this->id('PAT_B1'), 'version' => 1]);
    }

    public function test_changing_membership_or_clinic_id_cannot_change_tenant(): void
    {
        $this->signIn('RECEPTION_A');
        $this->postJson('/workspace/select', ['membership_id' => $this->id('MEM_RECEPTION_B')])->assertNotFound();
        $this->getJson('/v1/patients?clinic_id='.$this->id('CLINIC_B'))->assertUnprocessable();
        $this->patchJson('/v1/patients/'.$this->id('PAT_A1'), [...$this->data(), 'clinic_id' => $this->id('CLINIC_B')])->assertUnprocessable();
        $this->withSession(['membership_id' => $this->id('MEM_RECEPTION_B')])->getJson('/v1/patients')->assertNotFound();
    }

    public function test_doctors_see_only_their_confirmed_patients_without_phone_or_export(): void
    {
        $this->signIn('DOCTOR_A');
        $this->getJson('/v1/patients')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->id('PAT_A1'))->assertJsonMissingPath('data.0.contact_phone');
        $this->getJson('/v1/patients/'.$this->id('PAT_A2'))->assertNotFound();
        $this->getJson('/v1/patients/'.$this->id('PAT_B1'))->assertNotFound();
        $this->getJson('/v1/patients/export')->assertForbidden();
        $this->patchJson('/v1/patients/'.$this->id('PAT_A1'), $this->data())->assertForbidden();
        $this->getJson('/workspace/team')->assertForbidden();
    }

    public function test_doctor_with_missing_profile_and_inactive_membership_fails_closed(): void
    {
        $user = $this->signIn('DOCTOR_C');
        DB::table('ticket_tokens')->where('booking_id', $this->id('BOOK_C1'))->delete();
        DB::table('bookings')->where('demo_code', 'BOOK_C1')->delete();
        DB::table('arrival_windows')->where('session_id', $this->id('SESSION_C'))->delete();
        DB::table('clinic_sessions')->where('id', $this->id('SESSION_C'))->delete();
        DB::table('doctors')->where('id', $this->id('DR_C'))->delete();
        $this->getJson('/v1/patients')->assertOk()->assertJsonCount(0, 'data');
        DB::table('memberships')->where('user_id', $user->id)->update(['active' => false]);
        $this->getJson('/v1/patients')->assertNotFound();
    }

    public function test_platform_admin_has_no_automatic_patient_access(): void
    {
        $this->signIn('PLATFORM', true);
        $this->get('/platform/accounts')->assertOk();
        $this->getJson('/v1/patients')->assertNotFound();
        $this->getJson('/v1/patients/'.$this->id('PAT_A1'))->assertNotFound();
        $this->getJson('/v1/patients/export')->assertNotFound();
    }

    public function test_models_fail_closed_without_context_and_doctor_scopes_cover_future_modules(): void
    {
        $context = app(TenantContext::class);
        foreach ([Patient::class, Booking::class, ClinicSession::class, Doctor::class, ArrivalWindow::class, Visit::class, Membership::class] as $model) {
            $this->assertSame(0, $model::count());
        }
        $context->set((array) DB::table('memberships')->where('id', $this->id('MEM_DOCTOR_A'))->first(), $this->id('DR_A'));
        $this->assertSame(1, Patient::count());
        $this->assertSame(1, Doctor::count());
        $this->assertSame(1, ClinicSession::count());
        $this->assertSame(2, ArrivalWindow::count());
        $this->assertSame(2, Booking::count());
        $this->assertSame(1, Visit::count());
        $this->assertSame(1, Membership::count());
        $context->clear();
        $this->assertSame(0, Patient::count());
    }

    public function test_contact_update_uses_optimistic_version_and_does_not_log_patient_details(): void
    {
        $this->signIn('RECEPTION_A');
        $path = '/v1/patients/'.$this->id('PAT_A1');
        $this->patchJson($path, [...$this->data(), 'display_name' => 'أ'])->assertUnprocessable();
        $this->patchJson($path, $this->data())->assertOk()->assertJsonPath('data.version', 2);
        $this->patchJson($path, $this->data())->assertConflict();
        $this->assertStringNotContainsString('+967700000099', DB::table('security_events')->get()->toJson());
        $this->assertDatabaseHas('patients', ['id' => $this->id('PAT_A1'), 'version' => 2]);
    }

    public function test_csv_escapes_formulas_and_records_only_export_count(): void
    {
        $this->signIn('RECEPTION_A');
        DB::table('patients')->where('id', $this->id('PAT_A1'))->update(['display_name' => '=1+1']);
        $response = $this->get('/v1/patients/export')->assertOk();
        $this->assertStringContainsString("'=1+1", $response->getContent());
        $this->assertStringContainsString("'+967", $response->getContent());
        $event = DB::table('security_events')->where('event_type', 'patient_contacts_exported')->first();
        $this->assertSame(3, json_decode($event->safe_context, true)['count']);
        $this->assertStringNotContainsString('+967', $event->safe_context);
    }

    public function test_multi_clinic_selection_is_explicit_and_removed_membership_cannot_fall_back(): void
    {
        $user = $this->signIn('RECEPTION_A');
        $id = (string) Str::uuid();
        DB::table('memberships')->insert(['id' => $id, 'clinic_id' => $this->id('CLINIC_B'), 'user_id' => $user->id, 'role' => 'reception']);
        $this->getJson('/v1/patients')->assertNotFound();
        $this->post('/workspace/select', ['membership_id' => $id])->assertRedirect('/workspace');
        $this->getJson('/v1/patients')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->id('PAT_B1'));
        DB::table('memberships')->where('id', $id)->update(['active' => false]);
        $this->getJson('/v1/patients')->assertNotFound();
    }

    public function test_suspended_clinic_and_untrusted_fields_do_not_authorize_access(): void
    {
        $this->signIn('RECEPTION_A');
        $this->patchJson('/v1/patients/'.$this->id('PAT_A1'), [...$this->data(), 'role' => 'owner'])->assertUnprocessable();
        DB::table('clinics')->where('id', $this->id('CLINIC_A'))->update(['operational_state' => 'suspended']);
        $this->getJson('/v1/patients')->assertNotFound();
    }

    public function test_tenant_model_write_guard_preserves_clinic_through_related_factories(): void
    {
        $context = app(TenantContext::class);
        $context->set((array) DB::table('memberships')->where('id', $this->id('MEM_OWNER_A'))->first(), null);
        $visit = Visit::factory()->create();
        $this->assertSame($this->id('CLINIC_A'), $visit->clinic_id);
        $booking = Booking::findOrFail($visit->booking_id);
        $patient = Patient::findOrFail($booking->patient_id);
        $this->assertSame($this->id('CLINIC_A'), $patient->clinic_id);
        $this->assertSame($this->id('CLINIC_A'), ClinicSession::findOrFail($visit->session_id)->clinic_id);
        $patient->clinic_id = $this->id('CLINIC_B');
        try {
            $patient->save();
            $this->fail('Clinic reassignment must be rejected.');
        } catch (HttpException $error) {
            $this->assertSame(404, $error->getStatusCode());
        }
        $this->assertDatabaseHas('patients', ['id' => $patient->id, 'clinic_id' => $this->id('CLINIC_A')]);
        $context->clear();
        $this->expectException(HttpException::class);
        Patient::factory()->create();
    }
}
