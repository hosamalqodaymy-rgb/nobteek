<?php

namespace App\Policies;

use App\Models\Booking;
use App\Models\User;
use App\Support\TenantContext;

class BookingPolicy
{
    public function viewAny(User $user): bool
    {
        return in_array(app(TenantContext::class)->role(), ['owner', 'reception'], true);
    }

    public function view(User $user, Booking $booking): bool
    {
        return $this->viewAny($user) && $booking->clinic_id === app(TenantContext::class)->clinicId();
    }

    public function manage(User $user, Booking $booking): bool
    {
        return $this->view($user, $booking);
    }
}
