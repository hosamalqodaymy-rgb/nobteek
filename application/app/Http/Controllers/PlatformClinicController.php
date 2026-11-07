<?php

namespace App\Http\Controllers;

use App\Models\Clinic;
use App\Services\ClinicAdministration;
use App\Support\YemeniPhone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class PlatformClinicController extends Controller
{
    public function index(Request $request): Response
    {
        abort_unless($request->user()->platform_role === 'platform_admin', 403);
        $clinics = Clinic::orderByDesc('created_at')->simplePaginate(30);
        $items = $clinics->getCollection()->map(fn (Clinic $clinic) => ['id' => $clinic->id, 'display_name' => $clinic->display_name, 'city' => $clinic->city,
            'owner_username' => DB::table('memberships as m')->join('users as u', 'u.id', '=', 'm.user_id')->where('m.clinic_id', $clinic->id)->where('m.role', 'owner')->where('m.active', true)->value('u.username')]);

        return Inertia::render('PlatformClinics', ['clinics' => $items, 'pagination' => ['previous' => $clinics->previousPageUrl(), 'next' => $clinics->nextPageUrl()]]);
    }

    public static function clinicRules(): array
    {
        return ['display_name' => ['required', 'string', 'min:2', 'max:120'], 'city' => ['required', 'string', 'min:2', 'max:80'], 'address_landmark' => ['required', 'string', 'min:2', 'max:240'],
            'contact_phone' => ['nullable', 'string', 'regex:/^\+9677[0-9]{8}$/D'], 'clinic_id' => ['prohibited'], 'timezone' => ['prohibited'], 'operational_state' => ['prohibited'], 'platform_role' => ['prohibited']];
    }

    public function create(Request $request, ClinicAdministration $administration): RedirectResponse|JsonResponse
    {
        abort_unless($request->user()->platform_role === 'platform_admin', 403);
        $request->merge(['contact_phone' => is_string($request->input('contact_phone')) ? YemeniPhone::normalize($request->input('contact_phone')) : $request->input('contact_phone')]);
        $data = $request->validate([...self::clinicRules(), 'owner_username' => ['required', 'string', 'min:4', 'max:80', 'regex:/^[a-z][a-z0-9_.-]+$/D'], 'owner_display_name' => ['required', 'string', 'min:2', 'max:80'], 'owner_user_id' => ['prohibited']]);
        $result = $administration->onboard($request, $data);
        if ($request->expectsJson()) {
            return response()->json($result, 201);
        }

        return to_route('platform.clinics')->with('private_notice', Crypt::encryptString(json_encode(['account_link' => $result['account_link']])))->with('status', 'أُنشئت العيادة وحساب مالكها. سلّم المالك رابطه الخاص خلال ٣٠ دقيقة.');
    }
}
