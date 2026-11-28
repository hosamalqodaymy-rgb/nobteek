<?php

namespace App\Http\Controllers;

use App\Services\BookingGuests;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\View;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DhamarPreviewController extends Controller
{
    private const ASSETS = [
        'index.html' => 'text/html; charset=utf-8',
        'style.css' => 'text/css; charset=utf-8',
        'discovery.css' => 'text/css; charset=utf-8',
        'app.js' => 'text/javascript; charset=utf-8',
        'booking.js' => 'text/javascript; charset=utf-8',
        'clinic.js' => 'text/javascript; charset=utf-8',
        'connection.js' => 'text/javascript; charset=utf-8',
        'support.js' => 'text/javascript; charset=utf-8',
        'platform.js' => 'text/javascript; charset=utf-8',
        'hiring.js' => 'text/javascript; charset=utf-8',
        'jobs.js' => 'text/javascript; charset=utf-8',
        'discovery.js' => 'text/javascript; charset=utf-8',
        'discovery/demo.js' => 'text/javascript; charset=utf-8',
        'discovery/entrances.webp' => 'image/webp',
        'discovery/consultation.webp' => 'image/webp',
        'discovery/services.webp' => 'image/webp',
        'discovery/practitioners.webp' => 'image/webp',
        'logo-ar.png' => 'image/png',
        'styles/brand.generated.css' => 'text/css; charset=utf-8',
        'fonts/Tajawal-Regular.woff' => 'font/woff',
        'fonts/Tajawal-Medium.woff' => 'font/woff',
        'fonts/Tajawal-Bold.woff' => 'font/woff',
    ];

    public function qaAccess(Request $request): View
    {
        $this->previewCode($request);

        return view('qa-access');
    }

    public function enterQa(Request $request): RedirectResponse
    {
        $code = $this->previewCode($request);
        $input = $request->validate(['code' => ['required', 'string', 'max:128']])['code'];
        if (! hash_equals($code, $input)) {
            throw ValidationException::withMessages(['code' => 'رمز الوصول غير صحيح.']);
        }

        return to_route($request->user() ? 'dashboard' : 'dhamar.preview')
            ->cookie('nobteek_preview_access', hash('sha256', $code), 1440, '/', null, true, true, false, 'lax');
    }

    private function previewCode(Request $request): string
    {
        $code = config('nobteek.connected_preview_code');
        abort_unless(self::available($request) && $request->isSecure() && is_string($code) && $code !== '', 404);

        return $code;
    }

    public function show(Request $request, BookingGuests $guests): Response
    {
        $this->ensureTesting($request);
        abort_unless(BookingGuests::isGuest($request), 403, 'افتح تجربة المراجع في نافذة منفصلة عن حساب الموظف.');
        $guests->issue($request);
        $scope = hash_hmac('sha256', $request->session()->get('booking_guest_id'), config('app.key'));
        $configuration = [
            'catalog' => route('dhamar.preview.catalog', absolute: false),
            'booking' => route('bookings.request', absolute: false),
            'ticket' => route('public.ticket.current', absolute: false),
            'workspace' => ! $request->user() && config('nobteek.community_enabled')
                ? route('login', ['entry' => 'community'], absolute: false) : route('dashboard', absolute: false),
            'support' => config('nobteek.community_enabled') ? route('community.support', absolute: false) : null,
            'jobs' => config('nobteek.community_enabled') ? route('community.jobs', absolute: false) : null,
            'signedIn' => $request->user() !== null,
            'csrf' => csrf_token(),
            'scope' => $scope,
        ];
        $encoded = e(json_encode($configuration, JSON_THROW_ON_ERROR));
        $html = file_get_contents($this->path('index.html'));
        $html = str_replace('</head>', '<meta name="nobteek-connected-preview" content="'.$encoded.'"></head>', $html);

        return response($html, 200, [
            'Content-Type' => self::ASSETS['index.html'],
            'Content-Security-Policy' => "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
        ]);
    }

    public function asset(Request $request, string $asset): BinaryFileResponse
    {
        $this->ensureTesting($request);
        abort_if($asset === 'index.html' || ! isset(self::ASSETS[$asset]), 404);

        return response()->file($this->path($asset), ['Content-Type' => self::ASSETS[$asset]]);
    }

    public function catalog(Request $request): JsonResponse
    {
        $this->ensureTesting($request);
        $clinics = DB::table('clinics')
            ->where('operational_state', 'active')->whereNotNull('demo_code')
            ->orderBy('display_name')->limit(100)->get(['id', 'display_name', 'city', 'address_landmark'])->keyBy('id');
        $staff = DB::table('doctors as d')->join('memberships as m', function ($join): void {
            $join->on('m.clinic_id', '=', 'd.clinic_id')->on('m.user_id', '=', 'd.user_id');
        })->join('users as u', 'u.id', '=', 'd.user_id')
            ->whereIn('d.clinic_id', $clinics->keys())->where('d.active', true)->where('m.active', true)
            ->where('m.role', 'doctor')->where('u.login_enabled', true)->where('u.access_suspended', false)
            ->orderBy('d.display_name')->get(['d.id', 'd.clinic_id', 'd.display_name', 'd.specialty_optional']);
        $reservations = DB::table('bookings')
            ->whereIn('clinic_id', $clinics->keys())->whereIn('state', ['confirmed', 'fulfilled'])
            ->select('window_id')->selectRaw('COUNT(*) as used')->groupBy('window_id');
        $windows = DB::table('arrival_windows as w')
            ->join('clinic_sessions as s', 's.id', '=', 'w.session_id')
            ->leftJoinSub($reservations, 'r', 'r.window_id', '=', 'w.id')
            ->whereIn('s.doctor_id', $staff->pluck('id'))->whereIn('s.clinic_id', $clinics->keys())
            ->where('w.ends_at', '>', now())->where('w.starts_at', '<', now()->addDays(7))
            ->orderBy('w.starts_at')->limit(300)->get([
                'w.id', 'w.clinic_id', 'w.starts_at', 'w.ends_at', 'w.capacity',
                's.id as session_id', 's.doctor_id', 's.state', 'r.used',
            ]);
        $names = $staff->keyBy('id');

        return response()->json([
            'clinics' => $clinics->map(function (object $clinic) use ($staff): array {
                $providers = $staff->where('clinic_id', $clinic->id)->values();
                $profiles = $providers->map(fn (object $doctor): array => [
                    'name' => $doctor->display_name,
                    'specialty' => in_array($doctor->specialty_optional, ['طب الأسرة', 'الطب العام', 'طب الأسنان', 'الأطفال'], true)
                        ? ['طب الأسرة' => 'family', 'الطب العام' => 'general', 'طب الأسنان' => 'dentistry', 'الأطفال' => 'pediatrics'][$doctor->specialty_optional]
                        : 'other',
                    'hours' => [],
                ]);

                return [
                    'name' => $clinic->display_name, 'area' => $clinic->city, 'address' => $clinic->address_landmark,
                    'doctors' => $providers->pluck('display_name')->all(), 'profiles' => $profiles->all(),
                    'specialty' => $profiles->first()['specialty'] ?? 'other', 'specialties' => $profiles->pluck('specialty')->unique()->values()->all(),
                ];
            })->all(),
            'windows' => $windows->map(function (object $row) use ($names): array {
                $starts = CarbonImmutable::parse($row->starts_at)->setTimezone('Asia/Aden');
                $ends = CarbonImmutable::parse($row->ends_at)->setTimezone('Asia/Aden');

                return [
                    'id' => $row->id, 'clinic' => $row->clinic_id, 'serverSession' => $row->session_id,
                    'doctor' => $names[$row->doctor_id]->display_name, 'date' => $starts->toDateString(),
                    'start' => $starts->format('H:i'), 'end' => $ends->format('H:i'), 'capacity' => (int) $row->capacity,
                    'occupied' => (int) $row->used, 'open' => $row->state !== 'closed', 'ticket' => 0,
                ];
            })->all(),
        ]);
    }

    public static function available(Request $request): bool
    {
        if (! app()->environment('testing') || ! config('nobteek.demo_seed_enabled') || config('nobteek.real_patient_data')) {
            return false;
        }
        if (in_array($request->getHost(), ['localhost', '127.0.0.1'], true)) {
            return true;
        }
        $origin = config('nobteek.connected_preview_origin');

        return config('nobteek.community_enabled') && $request->isSecure() && $request->getSchemeAndHttpHost() === $origin
            && $origin === config('app.url') && config('database.default') === 'pgsql'
            && preg_match('/^nobteek_test(?:_[a-z0-9_]+)?$/D', (string) config('database.connections.pgsql.database')) === 1;
    }

    private function ensureTesting(Request $request): void
    {
        abort_unless(self::available($request), 404);
    }

    private function path(string $asset): string
    {
        return match (true) {
            $asset === 'logo-ar.png' => base_path('../design/assets/logo-ar.png'),
            str_starts_with($asset, 'fonts/'), str_starts_with($asset, 'styles/') => base_path('../design/'.$asset),
            default => base_path('../android-preview/dhamar/web/'.$asset),
        };
    }
}
