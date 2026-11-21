<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Visit;
use App\Support\TenantContext;

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
}
