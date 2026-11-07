<?php

namespace App\Policies;

use App\Models\ClinicSession;
use App\Models\User;
use App\Support\TenantContext;

class ClinicSessionPolicy
{
    public function viewAny(User $user): bool
    {
        return in_array(app(TenantContext::class)->role(), ['owner', 'reception', 'doctor'], true);
    }

    public function view(User $user, ClinicSession $session): bool
    {
        $context = app(TenantContext::class);

        return $session->clinic_id === $context->clinicId() && $this->viewAny($user) && ($context->role() !== 'doctor' || $session->doctor_id === $context->doctorId);
    }

    public function manage(User $user, ClinicSession $session): bool
    {
        return app(TenantContext::class)->role() === 'owner' && $this->view($user, $session);
    }

    public function operate(User $user, ClinicSession $session): bool
    {
        return in_array(app(TenantContext::class)->role(), ['owner', 'doctor'], true) && $this->view($user, $session);
    }
}
