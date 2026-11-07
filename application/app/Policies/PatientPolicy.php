<?php

namespace App\Policies;

use App\Models\Patient;
use App\Models\User;
use App\Support\TenantContext;

class PatientPolicy
{
    public function viewAny(User $user): bool
    {
        return in_array(app(TenantContext::class)->role(), ['owner', 'reception', 'doctor'], true);
    }

    public function view(User $user, Patient $patient): bool
    {
        return $patient->clinic_id === app(TenantContext::class)->clinicId() && $this->viewAny($user);
    }

    public function update(User $user, Patient $patient): bool
    {
        return $patient->clinic_id === app(TenantContext::class)->clinicId() && $this->export($user);
    }

    public function export(User $user): bool
    {
        return in_array(app(TenantContext::class)->role(), ['owner', 'reception'], true);
    }
}
