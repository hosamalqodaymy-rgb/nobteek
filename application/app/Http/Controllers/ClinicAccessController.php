<?php

namespace App\Http\Controllers;

use App\Http\Resources\PatientResource;
use App\Models\Patient;
use App\Services\AccountSecurity;
use App\Services\BillingPilot;
use App\Services\SecurityAudit;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class ClinicAccessController extends Controller
{
    public function memberships(Request $request): Collection
    {
        return DB::table('memberships as m')->join('clinics as c', 'c.id', '=', 'm.clinic_id')->where('m.user_id', $request->user()->id)
            ->where('m.active', true)->where('c.operational_state', 'active')->orderBy('c.display_name')->get(['m.id', 'm.clinic_id', 'm.role', 'c.display_name']);
    }

    public function dashboard(Request $request, BillingPilot $pilot): Response
    {
        $memberships = $this->memberships($request)->map(fn ($membership) => [
            'id' => $membership->id, 'role' => $membership->role, 'display_name' => $membership->display_name,
            'can_bill' => $membership->role === 'owner' && $pilot->includesClinic($membership->clinic_id),
        ]);

        return Inertia::render('Workspace', ['memberships' => $memberships, 'selectedMembership' => $request->session()->get('membership_id')]);
    }

    public function select(Request $request): RedirectResponse
    {
        $data = $request->validate(['membership_id' => ['required', 'uuid'], 'clinic_id' => ['prohibited']]);
        abort_unless($this->memberships($request)->contains('id', $data['membership_id']), 404);
        $request->session()->put('membership_id', $data['membership_id']);
        $request->session()->regenerate();

        return to_route('dashboard');
    }

    public function patients(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Patient::class);
        $request->validate(['clinic_id' => ['prohibited'], 'phone' => ['prohibited'], 'contact_phone' => ['prohibited']]);

        return PatientResource::collection(Patient::query()->orderBy('id')->simplePaginate(50));
    }

    public function patient(string $patient): PatientResource
    {
        $record = Patient::findOrFail($patient);
        Gate::authorize('view', $record);

        return new PatientResource($record);
    }

    public function updatePatient(Request $request, string $patient, AccountSecurity $security, SecurityAudit $audit): PatientResource
    {
        $data = $request->validate(['display_name' => ['required', 'string', 'min:2', 'max:80'], 'contact_phone' => ['nullable', 'regex:/^\+9677\d{8}$/D'],
            'version' => ['required', 'integer', 'min:1'], 'clinic_id' => ['prohibited'], 'user_id' => ['prohibited'], 'doctor_id' => ['prohibited'], 'role' => ['prohibited']]);

        return DB::transaction(function () use ($request, $patient, $data, $security, $audit): PatientResource {
            $security->lockedActor($request);
            $context = app(TenantContext::class);
            $membership = DB::table('memberships')->where('id', $context->membership['id'])->lockForUpdate()->firstOrFail();
            abort_unless($membership->active && $membership->user_id === $request->user()->id && $membership->clinic_id === $context->clinicId() && in_array($membership->role, ['owner', 'reception'], true), 403);
            $record = Patient::whereKey($patient)->lockForUpdate()->firstOrFail();
            Gate::authorize('update', $record);
            abort_unless($record->version === (int) $data['version'], 409, 'تغيرت البيانات. حدث الصفحة قبل الحفظ.');
            $record->fill(['display_name' => $data['display_name'], 'contact_phone' => $data['contact_phone'] ?? null, 'version' => $record->version + 1])->save();
            $audit->record('patient_contact_updated', $request->user()->id, clinic: $context->clinicId(), request: $request);

            return new PatientResource($record);
        });
    }

    public function export(Request $request, SecurityAudit $audit): \Illuminate\Http\Response
    {
        Gate::authorize('export', Patient::class);
        $request->validate(['clinic_id' => ['prohibited'], 'phone' => ['prohibited']]);
        $rows = Patient::query()->orderBy('id')->limit(1001)->get();
        abort_if($rows->count() > 1000, 422, 'القائمة كبيرة. اطلب تصديرًا محددًا من مسؤول الدعم.');
        $file = fopen('php://temp', 'r+');
        fwrite($file, "\xEF\xBB\xBF");
        fputcsv($file, ['الاسم', 'رقم الاتصال'], ',', '"', '');
        foreach ($rows as $row) {
            $cells = array_map(fn ($value) => preg_match('/^[\s\x00-\x1f]*[=+@-]/u', (string) $value) ? "'".$value : $value, [$row->display_name, $row->contact_phone]);
            fputcsv($file, $cells, ',', '"', '');
        }
        rewind($file);
        $content = stream_get_contents($file);
        fclose($file);
        $audit->record('patient_contacts_exported', $request->user()->id, clinic: app(TenantContext::class)->clinicId(), request: $request, context: ['count' => $rows->count()]);

        return response($content, 200, ['Content-Type' => 'text/csv; charset=UTF-8', 'Content-Disposition' => 'attachment; filename="clinic-contacts.csv"']);
    }
}
