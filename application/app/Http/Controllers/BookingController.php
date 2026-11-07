<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\ClinicSession;
use App\Services\BookingCommands;
use App\Services\SessionCommands;
use App\Support\TenantContext;
use App\Support\YemeniPhone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class BookingController extends Controller
{
    private function requestData(Request $request): array
    {
        $staff = (bool) $request->user();
        if ($staff) {
            Gate::authorize('viewAny', Booking::class);
        }
        $data = $request->validate(['session_id' => ['required', 'uuid'], 'window_id' => ['required', 'uuid'],
            'patient_id' => $staff ? ['nullable', 'uuid'] : ['prohibited'],
            'display_name' => ['nullable', 'string', 'max:80'], 'contact_phone' => ['nullable', 'string', 'max:40'],
            'source' => $staff ? ['nullable', Rule::in(['web', 'phone', 'walk_in'])] : ['prohibited'],
            'clinic_id' => ['prohibited'], 'user_id' => ['prohibited'], 'state' => ['prohibited'], 'version' => ['prohibited'], 'visit_id' => ['prohibited'], 'actor_id' => ['prohibited'], 'guest_id' => ['prohibited']]);
        $data['source'] = $staff ? ($data['source'] ?? 'web') : 'web';
        if (! empty($data['patient_id'])) {
            if (! empty($data['display_name']) || ! empty($data['contact_phone'])) {
                throw ValidationException::withMessages(['patient_id' => 'اختر مراجعًا محفوظًا أو أدخل بيانات مراجع جديد، دون جمع الخيارين.']);
            }
            unset($data['display_name'], $data['contact_phone']);
        } else {
            unset($data['patient_id']);
            $data['display_name'] = trim($data['display_name'] ?? '');
            if (mb_strlen($data['display_name']) < 2) {
                throw ValidationException::withMessages(['display_name' => 'أدخل اسم المراجع من حرفين إلى 80 حرفًا.']);
            }
            $data['contact_phone'] = YemeniPhone::normalize($data['contact_phone'] ?? null);
            if ($data['contact_phone'] !== null && ! preg_match('/^\+9677[0-9]{8}$/D', $data['contact_phone'])) {
                throw ValidationException::withMessages(['contact_phone' => 'أدخل جوالًا يمنيًا من تسعة أرقام يبدأ بسبعة.']);
            }
            if ($data['source'] !== 'walk_in' && ! $data['contact_phone']) {
                throw ValidationException::withMessages(['contact_phone' => 'طلب الويب أو الهاتف يحتاج رقم تواصل يمنيًا.']);
            }
        }

        return $data;
    }

    public function create(Request $request, BookingCommands $commands): JsonResponse
    {
        return response()->json($commands->create($request, $this->requestData($request)), 201);
    }

    public function command(Request $request, string $booking, string $command, BookingCommands $commands): JsonResponse
    {
        Gate::authorize('viewAny', Booking::class);
        $rules = ['reason_code' => ['required', Rule::in(BookingCommands::REASONS)], 'clinic_id' => ['prohibited'], 'patient_id' => ['prohibited'], 'state' => ['prohibited'], 'version' => ['prohibited'], 'visit_id' => ['prohibited']];
        if ($command === 'reschedule') {
            $rules += ['session_id' => ['required', 'uuid'], 'window_id' => ['required', 'uuid']];
        } else {
            $rules += ['session_id' => ['prohibited'], 'window_id' => ['prohibited']];
        }

        return response()->json($commands->execute($request, $booking, $command, $request->validate($rules)));
    }

    public function index(Request $request): Response|JsonResponse
    {
        Gate::authorize('viewAny', Booking::class);
        $data = $request->validate(['date' => ['nullable', 'date_format:Y-m-d'], 'state' => ['nullable', Rule::in(['pending', 'confirmed', 'rejected', 'cancelled', 'fulfilled'])], 'phone' => ['prohibited'], 'clinic_id' => ['prohibited']]);
        $date = $data['date'] ?? now('Asia/Aden')->toDateString();
        $query = Booking::whereIn('session_id', ClinicSession::whereDate('starts_at', $date)->select('id'));
        if (! empty($data['state'])) {
            $query->where('state', $data['state']);
        }
        $paginator = $query->orderByDesc('created_at')->orderBy('id')->simplePaginate(20)->withQueryString();
        $items = $paginator->getCollection()->map(fn (Booking $booking) => BookingResource::make($booking)->resolve($request));
        $props = ['bookings' => $items, 'date' => $date, 'state' => $data['state'] ?? '', 'server_time' => now()->utc()->toIso8601String(), 'pagination' => ['previous' => $paginator->previousPageUrl(), 'next' => $paginator->nextPageUrl()]];
        if ($request->expectsJson()) {
            return response()->json($props);
        }
        $props['sessions'] = ClinicSession::where('state', '!=', 'closed')->where('ends_at', '>', now())->orderBy('starts_at')->limit(60)->get()->map(fn (ClinicSession $s) => app(SessionCommands::class)->dto($s));
        $props['request_url'] = route('bookings.request');
        $props['public_url'] = route('public.booking', app(TenantContext::class)->clinicId());

        return Inertia::render('BookingList', $props);
    }

    public function show(Request $request, string $booking): BookingResource
    {
        $record = Booking::findOrFail($booking);
        Gate::authorize('view', $record);

        return (new BookingResource($record))->additional(['events' => DB::table('audit_events')->where('clinic_id', $record->clinic_id)->where('entity_type', 'booking')->where('entity_id', $record->id)->orderByDesc('at')->limit(30)->get(['event_type', 'reason_code', 'at', 'safe_changes'])]);
    }
}
