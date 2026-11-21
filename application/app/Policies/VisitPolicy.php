<?php

namespace App\Policies;

use App\Models\ClinicSession;
use App\Models\User;
use App\Models\Visit;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

class VisitPolicy
{
    public function viewAny(User $user): bool
    {
        return in_array(app(TenantContext::class)->role(), ['owner', 'reception'], true);
    }

    public function view(User $user, Visit $visit): bool
    {
        $context = app(TenantContext::class);

        return $visit->clinic_id === $context->clinicId() && ($this->viewAny($user) || ($context->role() === 'doctor' && $visit->doctor_id === $context->doctorId));
    }

    public function workspace(User $user): bool
    {
        $context = app(TenantContext::class);
        if ($context->role() === 'doctor') {
            return $context->doctorId !== null;
        }
        if ($context->role() !== 'reception') {
            return false;
        }
        $permissions = DB::table('memberships')->where('id', $context->membership['id'])->where('clinic_id', $context->clinicId())
            ->where('user_id', $user->id)->where('role', 'reception')->where('active', true)->value('delegated_permissions');

        return $permissions !== null && (json_decode($permissions, true, flags: JSON_THROW_ON_ERROR)['call_next'] ?? false) === true;
    }

    public function callNext(User $user, ClinicSession $session): bool
    {
        $context = app(TenantContext::class);

        return $session->clinic_id === $context->clinicId() && $this->workspace($user)
            && ($context->role() === 'reception' || $session->doctor_id === $context->doctorId);
    }

    public function practice(User $user, Visit $visit): bool
    {
        $context = app(TenantContext::class);

        return $context->role() === 'doctor' && $visit->clinic_id === $context->clinicId() && $visit->doctor_id === $context->doctorId;
    }
}
