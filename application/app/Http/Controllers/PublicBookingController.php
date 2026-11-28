<?php

namespace App\Http\Controllers;

use App\Services\BookingGuests;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class PublicBookingController extends Controller
{
    public function show(Request $request, string $clinic, BookingGuests $guests): Response
    {
        $record = DB::table('clinics')->where('id', $clinic)->where('operational_state', 'active')->firstOrFail();
        if (BookingGuests::isGuest($request)) {
            $guests->issue($request);
        }
        $sessions = DB::table('clinic_sessions as s')->join('doctors as d', function ($join): void {
            $join->on('d.id', '=', 's.doctor_id')->on('d.clinic_id', '=', 's.clinic_id');
        })->join('memberships as m', function ($join): void {
            $join->on('m.user_id', '=', 'd.user_id')->on('m.clinic_id', '=', 's.clinic_id');
        })->join('users as u', 'u.id', '=', 'd.user_id')->where('s.clinic_id', $clinic)->where('s.state', '!=', 'closed')->where('s.ends_at', '>', now())
            ->where('s.starts_at', '<', now()->addDays(30))->where('d.active', true)->where('m.active', true)->where('m.role', 'doctor')->where('u.login_enabled', true)->where('u.access_suspended', false)
            ->orderBy('s.starts_at')->limit(40)->get(['s.id', 'd.display_name as doctor_name', 's.starts_at', 's.ends_at']);
        $options = $sessions->map(fn ($session) => ['id' => $session->id, 'doctor_name' => $session->doctor_name, 'starts_at' => CarbonImmutable::parse($session->starts_at)->utc()->toIso8601String(),
            'windows' => DB::table('arrival_windows')->where('clinic_id', $clinic)->where('session_id', $session->id)->where('ends_at', '>', now())->orderBy('starts_at')->get(['id', 'starts_at', 'ends_at'])->map(fn ($window) => ['id' => $window->id, 'starts_at' => CarbonImmutable::parse($window->starts_at)->utc()->toIso8601String(), 'ends_at' => CarbonImmutable::parse($window->ends_at)->utc()->toIso8601String()])->all()])->filter(fn ($session) => count($session['windows']) > 0)->values();

        return Inertia::render('PublicBooking', ['clinic' => ['display_name' => $record->display_name, 'city' => $record->city, 'address_landmark' => $record->address_landmark, 'contact_phone' => $record->contact_phone], 'sessions' => $options, 'request_url' => route('bookings.request')]);
    }
}
