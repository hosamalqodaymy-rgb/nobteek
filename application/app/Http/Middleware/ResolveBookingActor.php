<?php

namespace App\Http\Middleware;

use App\Services\BookingGuests;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ResolveBookingActor
{
    public function handle(Request $request, Closure $next): Response
    {
        if (BookingGuests::isGuest($request)) {
            return $next($request);
        }

        return app(RequireMfa::class)->handle($request, fn (Request $verified): Response => app(ResolveClinicContext::class)->handle($verified, $next));
    }
}
