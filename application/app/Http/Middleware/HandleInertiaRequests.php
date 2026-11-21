<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    private function doctorWorkspaceAllowed(Request $request): bool
    {
        if (! $request->user()) {
            return false;
        }
        $memberships = DB::table('memberships as m')->join('clinics as c', 'c.id', '=', 'm.clinic_id')->where('m.user_id', $request->user()->id)
            ->where('m.active', true)->where('c.operational_state', 'active')->get(['m.id', 'm.role', 'm.clinic_id', 'm.delegated_permissions']);
        $membership = $memberships->firstWhere('id', $request->session()->get('membership_id')) ?? ($memberships->count() === 1 ? $memberships->first() : null);
        if (! $membership) {
            return false;
        }
        if ($membership->role === 'doctor') {
            return DB::table('doctors')->where('clinic_id', $membership->clinic_id)->where('user_id', $request->user()->id)->where('active', true)->exists();
        }

        return $membership->role === 'reception' && (json_decode($membership->delegated_permissions, true, flags: JSON_THROW_ON_ERROR)['call_next'] ?? false) === true;
    }

    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        Inertia::encryptHistory();

        if ($request->routeIs('public.booking', 'public.ticket', 'public.help', 'public.privacy', 'waiting.index')) {
            return [
                'brand' => ['name' => config('nobteek.brand.nameAr'), 'tagline' => config('nobteek.brand.tagline')],
                'links' => collect(['welcome', 'login', 'public.help', 'public.privacy', 'public.ticket'])->mapWithKeys(fn ($name) => [$name => route($name)])->all(),
            ];
        }

        return [
            ...parent::share($request),
            'auth' => $request->user() ? ['display_name' => $request->user()->display_name, 'username' => $request->user()->username, 'platform_admin' => $request->user()->platform_role === 'platform_admin'] : null,
            'links' => collect(['welcome', 'login', 'challenge', 'recovery', 'account.access', 'security', 'logout', 'dashboard', 'clinic.select', 'team', 'team.create', 'platform', 'mfa.start', 'mfa.confirm', 'recovery.rotate', 'password.change', 'account.confirm', 'platform.clinics', 'platform.clinic.create', 'clinic.settings', 'clinic.settings.update', 'clinic.doctor.create', 'sessions.index', 'sessions.create', 'bookings.index', 'bookings.request', 'reception.index', 'doctor.index', 'public.help', 'public.privacy', 'public.ticket'])->mapWithKeys(fn ($name) => [$name => route($name)])->all(),
            'doctor_workspace_allowed' => fn () => $this->doctorWorkspaceAllowed($request),
            'status' => fn () => $request->session()->get('status'),
            'privateNotice' => function () use ($request) {
                $encrypted = $request->session()->pull('private_notice');

                if ($encrypted) {
                    Inertia::flash('privateNotice', json_decode(Crypt::decryptString($encrypted), true, flags: JSON_THROW_ON_ERROR));
                }

                return null;
            },
            'brand' => ['name' => config('nobteek.brand.nameAr'), 'tagline' => config('nobteek.brand.tagline')],
        ];
    }
}
