<?php

namespace App\Services;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ClinicAdministration
{
    public function __construct(private ClinicAuthority $authority, private AccountGrants $grants, private SecurityAudit $securityAudit) {}

    /** @return array{clinic_id:string,account_link:string} */
    public function onboard(Request $request, array $data): array
    {
        try {
            return DB::transaction(function () use ($request, $data): array {
                $actor = $this->authority->platform($request);
                if (User::whereRaw('lower(username) = ?', [$data['owner_username']])->exists()) {
                    throw ValidationException::withMessages(['owner_username' => 'اسم الدخول مستخدم. افتح إدارة الوصول للحساب القائم أو اختر اسمًا جديدًا.']);
                }
                $clinic = Clinic::create(array_intersect_key($data, array_flip(['display_name', 'city', 'address_landmark', 'contact_phone'])));
                $owner = User::create(['username' => $data['owner_username'], 'display_name' => $data['owner_display_name']]);
                DB::table('memberships')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $clinic->id, 'user_id' => $owner->id, 'role' => 'owner']);
                $link = $this->grants->issue($actor, $owner, $clinic->id, $request);
                $this->securityAudit->record('clinic_onboarded', $actor->id, $owner->id, $clinic->id, $request);

                return ['clinic_id' => $clinic->id, 'account_link' => $link];
            }, 3);
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['owner_username' => 'اسم الدخول مستخدم. لم تنشأ عيادة إضافية.']);
        }
    }

    public function updateClinic(Request $request, array $data): Clinic
    {
        return DB::transaction(function () use ($request, $data): Clinic {
            $this->authority->actor($request, ['owner'], true);
            $clinic = Clinic::whereKey(app(TenantContext::class)->clinicId())->lockForUpdate()->firstOrFail();
            if ($clinic->version !== (int) $data['version']) {
                throw ValidationException::withMessages(['version' => 'تغيرت معلومات العيادة. حدث الصفحة قبل الحفظ.']);
            }
            $clinic->fill(array_intersect_key($data, array_flip(['display_name', 'city', 'address_landmark', 'contact_phone'])));
            $fields = array_keys($clinic->getDirty());
            $clinic->version++;
            $clinic->save();
            $this->authority->audit($request, 'clinic_updated', 'clinic', $clinic->id, ['fields' => $fields, 'version' => $clinic->version], 'profile_update');

            return $clinic;
        }, 3);
    }

    public function createDoctor(Request $request, array $data): Doctor
    {
        return DB::transaction(function () use ($request, $data): Doctor {
            $this->authority->actor($request, ['owner'], true);
            $context = app(TenantContext::class);
            $membership = DB::table('memberships')->where('id', $data['membership_id'])->where('clinic_id', $context->clinicId())->where('active', true)->where('role', 'doctor')->lockForUpdate()->firstOrFail();
            abort_if(DB::table('users')->where('id', $membership->user_id)->whereNotNull('platform_role')->exists(), 403);
            if (Doctor::where('user_id', $membership->user_id)->exists()) {
                throw ValidationException::withMessages(['membership_id' => 'هذه العضوية مرتبطة بملف طبيب بالفعل.']);
            }
            $doctor = Doctor::create(['user_id' => $membership->user_id, 'display_name' => $data['display_name'], 'specialty_optional' => $data['specialty_optional'] ?? null]);
            $this->authority->audit($request, 'doctor_created', 'doctor', $doctor->id, ['version' => 1, 'active' => true], 'profile_create');

            return $doctor->refresh();
        }, 3);
    }

    public function updateDoctor(Request $request, string $id, array $data): Doctor
    {
        return DB::transaction(function () use ($request, $id, $data): Doctor {
            $this->authority->actor($request, ['owner'], true);
            $doctor = Doctor::whereKey($id)->lockForUpdate()->firstOrFail();
            if ($doctor->version !== (int) $data['version']) {
                throw ValidationException::withMessages(['version' => 'تغير ملف الطبيب. حدث الصفحة قبل الحفظ.']);
            }
            if (! $data['active'] && DB::table('clinic_sessions')->where('clinic_id', $doctor->clinic_id)->where('doctor_id', $doctor->id)->where('state', '!=', 'closed')->exists()) {
                throw ValidationException::withMessages(['active' => 'أغلق جلسات الطبيب غير المغلقة قبل تعطيل ملفه.']);
            }
            $doctor->fill(['display_name' => $data['display_name'], 'specialty_optional' => $data['specialty_optional'] ?? null, 'active' => (bool) $data['active']]);
            $fields = array_keys($doctor->getDirty());
            $doctor->version++;
            $doctor->save();
            $this->authority->audit($request, 'doctor_updated', 'doctor', $doctor->id, ['fields' => $fields, 'active' => $doctor->active, 'version' => $doctor->version], 'profile_update');

            return $doctor;
        }, 3);
    }
}
