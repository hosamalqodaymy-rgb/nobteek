<?php

namespace App\Http\Controllers;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Services\ClinicAdministration;
use App\Support\TenantContext;
use App\Support\YemeniPhone;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class ClinicSetupController extends Controller
{
    public function index(): Response
    {
        $context = app(TenantContext::class);
        abort_unless($context->role() === 'owner', 403);
        $clinic = Clinic::findOrFail($context->clinicId());
        $doctors = Doctor::orderBy('display_name')->get()->map(fn (Doctor $d) => ['id' => $d->id, 'display_name' => $d->display_name, 'specialty_optional' => $d->specialty_optional, 'active' => $d->active, 'version' => $d->version, 'update_url' => route('clinic.doctor.update', $d->id)]);
        $members = DB::table('memberships as m')->join('users as u', 'u.id', '=', 'm.user_id')->where('m.clinic_id', $context->clinicId())->where('m.active', true)->where('m.role', 'doctor')->whereNull('u.platform_role')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('doctors as d')->whereColumn('d.clinic_id', 'm.clinic_id')->whereColumn('d.user_id', 'm.user_id'))->get(['m.id', 'u.display_name', 'u.username']);

        return Inertia::render('ClinicSettings', ['clinic' => $clinic->only(['display_name', 'city', 'address_landmark', 'contact_phone', 'version']), 'doctors' => $doctors, 'unlinkedDoctors' => $members]);
    }

    public function update(Request $request, ClinicAdministration $administration): RedirectResponse
    {
        abort_unless(app(TenantContext::class)->role() === 'owner', 403);
        $request->merge(['contact_phone' => is_string($request->input('contact_phone')) ? YemeniPhone::normalize($request->input('contact_phone')) : $request->input('contact_phone')]);
        $data = $request->validate([...PlatformClinicController::clinicRules(), 'version' => ['required', 'integer', 'min:1']]);
        $administration->updateClinic($request, $data);

        return to_route('clinic.settings')->with('status', 'تم حفظ معلومات العيادة.');
    }

    public function createDoctor(Request $request, ClinicAdministration $administration): RedirectResponse
    {
        abort_unless(app(TenantContext::class)->role() === 'owner', 403);
        $data = $request->validate(['membership_id' => ['required', 'uuid'], 'display_name' => ['required', 'string', 'min:2', 'max:80'], 'specialty_optional' => ['nullable', 'string', 'max:120'], 'clinic_id' => ['prohibited'], 'user_id' => ['prohibited'], 'role' => ['prohibited']]);
        $administration->createDoctor($request, $data);

        return to_route('clinic.settings')->with('status', 'تم ربط ملف الطبيب بحسابه في العيادة.');
    }

    public function updateDoctor(Request $request, string $doctor, ClinicAdministration $administration): RedirectResponse
    {
        abort_unless(app(TenantContext::class)->role() === 'owner', 403);
        $data = $request->validate(['display_name' => ['required', 'string', 'min:2', 'max:80'], 'specialty_optional' => ['nullable', 'string', 'max:120'], 'active' => ['required', 'boolean'], 'version' => ['required', 'integer', 'min:1'], 'clinic_id' => ['prohibited'], 'user_id' => ['prohibited'], 'membership_id' => ['prohibited']]);
        $administration->updateDoctor($request, $doctor, $data);

        return to_route('clinic.settings')->with('status', 'تم حفظ ملف الطبيب.');
    }
}
