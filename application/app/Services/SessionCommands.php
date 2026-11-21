<?php

namespace App\Services;

use App\Models\ArrivalWindow;
use App\Models\ClinicSession;
use App\Models\Doctor;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SessionCommands
{
    public const REASONS = ['scheduled_start', 'operational_pause', 'service_resumed', 'capacity_adjustment', 'intake_extended', 'session_completed', 'session_cancelled'];

    public const PAUSE_REASONS = ['operational_pause', 'doctor_delayed'];

    public function __construct(private ClinicAuthority $authority) {}

    public function localTime(string $value): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('!Y-m-d\TH:i', $value, 'Asia/Aden');
    }

    /** @return array{0:CarbonImmutable,1:CarbonImmutable} */
    private function validateSchedule(array $data): array
    {
        $start = $this->localTime($data['starts_at']);
        $end = $this->localTime($data['ends_at']);
        if ($end <= $start || ! $start->isSameDay($end)) {
            throw ValidationException::withMessages(['ends_at' => 'نهاية الاستقبال بعد البداية وفي اليوم نفسه بتوقيت اليمن.']);
        }
        $windows = $data['windows'];
        usort($windows, fn (array $a, array $b) => strcmp($a['starts_at'], $b['starts_at']));
        $previous = $start;
        foreach ($windows as $window) {
            $ws = $this->localTime($window['starts_at']);
            $we = $this->localTime($window['ends_at']);
            if ($ws < $start || $we > $end || $we <= $ws || $ws < $previous) {
                throw ValidationException::withMessages(['windows' => 'كل نافذة داخل وقت الجلسة، بنهاية بعد البداية، ودون تداخل مع نافذة أخرى.']);
            }
            $previous = $we;
        }

        return [$start, $end];
    }

    private function doctor(string $id, bool $mustLogin = false): Doctor
    {
        $doctor = Doctor::whereKey($id)->lockForUpdate()->firstOrFail();
        $member = DB::table('memberships')->where('clinic_id', $doctor->clinic_id)->where('user_id', $doctor->user_id)->where('role', 'doctor')->where('active', true)->exists();
        $user = DB::table('users')->where('id', $doctor->user_id)->first();
        if (! $doctor->active || ! $member || ! $user || $user->access_suspended || ($mustLogin && ! $user->login_enabled)) {
            throw ValidationException::withMessages(['doctor_id' => 'يلزم ملف طبيب فعال وعضوية فعالة وحساب غير موقوف. فعّل حسابه قبل فتح الجلسة.']);
        }

        return $doctor;
    }

    private function storeWindows(ClinicSession $session, array $windows): void
    {
        foreach ($windows as $window) {
            ArrivalWindow::create(['session_id' => $session->id, 'starts_at' => $this->localTime($window['starts_at']), 'ends_at' => $this->localTime($window['ends_at']), 'capacity' => $window['capacity']]);
        }
    }

    public function create(Request $request, array $data): ClinicSession
    {
        [$start, $end] = $this->validateSchedule($data);
        try {
            return DB::transaction(function () use ($request, $data, $start, $end): ClinicSession {
                $this->authority->actor($request, ['owner']);
                $doctor = $this->doctor($data['doctor_id']);
                $session = ClinicSession::create(['doctor_id' => $doctor->id, 'starts_at' => $start, 'ends_at' => $end, 'state' => 'scheduled']);
                $this->storeWindows($session, $data['windows']);
                $this->authority->audit($request, 'session_scheduled', 'session', $session->id, ['starts_at' => $start->utc()->toIso8601String(), 'ends_at' => $end->utc()->toIso8601String(), 'window_count' => count($data['windows']), 'version' => 1], 'schedule_create');

                return $session->refresh();
            }, 3);
        } catch (QueryException $error) {
            if (($error->errorInfo[0] ?? null) === '23P01') {
                throw ValidationException::withMessages(['starts_at' => 'يوجد تداخل مع جلسة أخرى للطبيب نفسه في العيادة.']);
            }
            throw $error;
        }
    }

    public function replaceSchedule(Request $request, string $id, array $data): ClinicSession
    {
        [$start, $end] = $this->validateSchedule($data);
        try {
            return DB::transaction(function () use ($request, $id, $data, $start, $end): ClinicSession {
                $this->authority->actor($request, ['owner']);
                $session = ClinicSession::whereKey($id)->lockForUpdate()->firstOrFail();
                Gate::authorize('manage', $session);
                if ($session->version !== (int) $data['version']) {
                    throw ValidationException::withMessages(['version' => 'تغيرت الجلسة. حدث الصفحة قبل الحفظ.']);
                }
                if ($session->state !== 'scheduled' || DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('session_id', $id)->exists() || DB::table('visits')->where('clinic_id', $session->clinic_id)->where('session_id', $id)->exists()) {
                    throw ValidationException::withMessages(['schedule' => 'تصحيح الجدول متاح للجلسة المجدولة الخالية من الحجوزات والزيارات فقط.']);
                }
                $doctor = $this->doctor($data['doctor_id']);
                ArrivalWindow::where('session_id', $id)->delete();
                $session->fill(['doctor_id' => $doctor->id, 'starts_at' => $start, 'ends_at' => $end, 'version' => $session->version + 1])->save();
                $this->storeWindows($session, $data['windows']);
                $this->authority->audit($request, 'session_schedule_corrected', 'session', $id, ['version' => $session->version, 'starts_at' => $start->utc()->toIso8601String(), 'ends_at' => $end->utc()->toIso8601String(), 'window_count' => count($data['windows'])], 'schedule_correction');

                return $session;
            }, 3);
        } catch (QueryException $error) {
            if (($error->errorInfo[0] ?? null) === '23P01') {
                throw ValidationException::withMessages(['starts_at' => 'يوجد تداخل مع جلسة أخرى للطبيب نفسه.']);
            }
            throw $error;
        }
    }

    private function expectedVersion(Request $request): int
    {
        $header = (string) $request->header('If-Match');
        abort_if($header === '', 428, 'يلزم إصدار الجلسة قبل تنفيذ الإجراء.');
        abort_unless(preg_match('/^(?:"([1-9][0-9]{0,17})"|([1-9][0-9]{0,17}))$/D', $header, $match), 422, 'صيغة إصدار الجلسة غير صالحة.');

        return (int) ($match[1] !== '' ? $match[1] : $match[2]);
    }

    private function normalize(array $data): array
    {
        if (! array_is_list($data)) {
            ksort($data);
        }
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $data[$key] = $this->normalize($value);
            }
        }

        return $data;
    }

    private function reservations(string $session, ?string $window = null): array
    {
        $query = DB::table('bookings')->where('clinic_id', app(TenantContext::class)->clinicId())->where('session_id', $session);
        if ($window) {
            $query->where('window_id', $window);
        }

        return ['reserved' => (clone $query)->whereIn('state', ['confirmed', 'fulfilled'])->count(), 'pending' => (clone $query)->where('state', 'pending')->count()];
    }

    private function previewSnapshot(Request $request, ClinicSession $session, ArrivalWindow $window, int $capacity): array
    {
        return ['actor' => $request->user()->id, 'membership' => app(TenantContext::class)->membership['id'], 'clinic' => $session->clinic_id, 'session' => $session->id, 'version' => $session->version,
            'window' => $window->id, 'capacity' => $capacity, ...$this->reservations($session->id, $window->id)];
    }

    public function preview(Request $request, string $id, array $data): array
    {
        $expected = $this->expectedVersion($request);

        return DB::transaction(function () use ($request, $id, $data, $expected): array {
            $this->authority->actor($request, ['owner']);
            $session = ClinicSession::whereKey($id)->lockForUpdate()->firstOrFail();
            Gate::authorize('manage', $session);
            abort_unless($session->version === $expected, 409, 'تغيرت الجلسة. حدث البيانات قبل المعاينة.');
            abort_if($session->state === 'closed', 409, 'الجلسة مغلقة.');
            $window = ArrivalWindow::where('session_id', $id)->whereKey($data['window_id'])->firstOrFail();
            $snapshot = $this->previewSnapshot($request, $session, $window, (int) $data['capacity']);
            $allowed = $snapshot['capacity'] >= $snapshot['reserved'];
            $total = ArrivalWindow::where('session_id', $id)->sum('capacity');

            return ['session_id' => $id, 'version' => $session->version, 'window_id' => $window->id, 'old_capacity' => $window->capacity, 'new_capacity' => $snapshot['capacity'],
                'reserved' => $snapshot['reserved'], 'pending' => $snapshot['pending'], 'available_after' => max(0, $snapshot['capacity'] - $snapshot['reserved']),
                'pending_exceeding_available' => max(0, $snapshot['pending'] - max(0, $snapshot['capacity'] - $snapshot['reserved'])),
                'total_before' => (int) $total, 'total_after' => (int) $total - $window->capacity + $snapshot['capacity'], 'can_apply' => $allowed,
                'message' => $allowed ? 'تبقى الحجوزات القائمة كما هي. راجع الأعداد ثم أكد التغيير.' : 'الخفض أقل من عدد الحجوزات المؤكدة والمنجزة، ولن يحفظ.',
                'preview_token' => $allowed ? Crypt::encryptString(json_encode([...$snapshot, 'expires' => now()->addMinutes(5)->timestamp], JSON_THROW_ON_ERROR)) : null];
        }, 3);
    }

    public function execute(Request $request, string $id, string $command, array $data): array
    {
        $expected = $this->expectedVersion($request);
        $key = (string) $request->header('Idempotency-Key');
        abort_unless(preg_match('/^[a-zA-Z0-9_.:-]{16,128}$/D', $key), 422, 'يلزم مفتاح محاولة صالح لهذا الإجراء.');
        $role = in_array($command, ['pause', 'resume'], true) ? 'operate' : 'manage';
        $fingerprint = hash('sha256', json_encode($this->normalize(['command' => $command, 'session' => $id, 'expected' => $expected, 'data' => $data]), JSON_THROW_ON_ERROR));
        try {
            return DB::transaction(function () use ($request, $id, $command, $data, $expected, $key, $role, $fingerprint): array {
                $this->authority->actor($request, $role === 'operate' ? ['owner', 'doctor'] : ['owner']);
                $session = ClinicSession::whereKey($id)->lockForUpdate()->firstOrFail();
                Gate::authorize($role, $session);
                $context = app(TenantContext::class);
                $scope = hash_hmac('sha256', $context->membership['id'], config('app.key'));
                $keyDigest = hash_hmac('sha256', $key, config('app.key'));
                $replay = DB::table('command_replays')->where('clinic_id', $session->clinic_id)->where('actor_scope_digest', $scope)->where('key_digest', $keyDigest)->first();
                if ($replay && CarbonImmutable::parse($replay->expires_at)->isFuture()) {
                    abort_unless(hash_equals($replay->request_fingerprint, $fingerprint), 409, 'استخدم مفتاح محاولة جديدًا لإجراء أو بيانات مختلفة.');

                    return [...json_decode(Crypt::decryptString($replay->response_ciphertext), true, flags: JSON_THROW_ON_ERROR), 'replayed' => true];
                }
                if ($replay) {
                    DB::table('command_replays')->where('id', $replay->id)->delete();
                }
                abort_unless($session->version === $expected, 409, 'تغيرت الجلسة. حدث الصفحة قبل تكرار الإجراء.');
                $changes = $this->apply($request, $session, $command, $data);
                $session->version++;
                $session->save();
                $this->authority->audit($request, 'session_'.$command, 'session', $session->id, [...$changes, 'version' => $session->version], $data['reason_code']);
                $result = ['id' => $session->id, 'state' => $session->state, 'version' => $session->version, 'server_time' => now()->utc()->toIso8601String(), 'request_id' => $request->attributes->get('security_request_id')];
                DB::table('command_replays')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $session->clinic_id, 'actor_scope_digest' => $scope, 'key_digest' => $keyDigest, 'request_fingerprint' => $fingerprint,
                    'response_ciphertext' => Crypt::encryptString(json_encode($result, JSON_THROW_ON_ERROR)), 'created_at' => now(), 'expires_at' => now()->addHours(48)]);

                return [...$result, 'replayed' => false];
            }, 3);
        } catch (QueryException $error) {
            if (in_array($error->errorInfo[0] ?? null, ['23P01', '23514'], true)) {
                abort(409, 'يتعارض التغيير مع جلسة أخرى أو حدود النوافذ. أعد مراجعة الجدول.');
            }
            throw $error;
        }
    }

    private function apply(Request $request, ClinicSession $session, string $command, array $data): array
    {
        abort_if($session->state === 'closed', 409, 'الجلسة مغلقة.');
        $old = $session->state;
        if ($command === 'open') {
            abort_unless($old === 'scheduled' && now()->betweenIncluded($session->starts_at, $session->ends_at) && now()->lt($session->ends_at), 409, 'فتح الجلسة متاح من حالتها المجدولة وداخل وقت استقبالها فقط.');
            $this->doctor($session->doctor_id, true);
            abort_unless(ArrivalWindow::where('session_id', $session->id)->exists(), 409, 'أضف نافذة وصول قبل فتح الجلسة.');
            $session->state = 'open';
        } elseif ($command === 'pause') {
            abort_unless($old === 'open', 409, 'إيقاف النداء متاح للجلسة المفتوحة فقط.');
            $session->state = 'paused';
        } elseif ($command === 'resume') {
            abort_unless($old === 'paused', 409, 'استئناف النداء متاح للجلسة المتوقفة فقط.');
            $this->doctor($session->doctor_id, true);
            $session->state = 'open';
        } elseif ($command === 'close') {
            $unresolved = DB::table('visits')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->whereIn('state', ['waiting', 'away', 'called', 'in_service'])->count();
            abort_if($unresolved > 0, 409, 'عالج جميع المنتظرين والغائبين مؤقتًا والحالات النشطة قبل الإغلاق.');
            $session->state = 'closed';
        } elseif ($command === 'extend') {
            $end = $this->localTime($data['ends_at']);
            abort_unless($end->greaterThan($session->ends_at) && $end->greaterThan(now()) && $end->isSameDay($session->starts_at->setTimezone('Asia/Aden')), 409, 'التمديد يزيد النهاية إلى وقت لاحق ضمن يوم الجلسة نفسه.');
            $previous = $session->ends_at->utc()->toIso8601String();
            $session->ends_at = $end;
            DB::table('ticket_tokens')->where('clinic_id', $session->clinic_id)->whereNull('revoked_at')->where('expires_at', '>', now())
                ->whereIn('booking_id', DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->select('id'))
                ->update(['expires_at' => $end->addHours(48)->utc()->toIso8601String()]);

            return ['old_ends_at' => $previous, 'ends_at' => $end->utc()->toIso8601String()];
        } elseif ($command === 'capacity') {
            $window = ArrivalWindow::where('session_id', $session->id)->whereKey($data['window_id'])->lockForUpdate()->firstOrFail();
            try {
                $token = json_decode(Crypt::decryptString($data['preview_token']), true, flags: JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                abort(422, 'معاينة غير صالحة. أعد معاينة السعة.');
            }
            $current = $this->previewSnapshot($request, $session, $window, (int) $data['capacity']);
            $expires = $token['expires'] ?? 0;
            unset($token['expires']);
            abort_unless($expires >= now()->timestamp && $token === $current, 409, 'انتهت المعاينة أو تغيرت الحجوزات أو السعة المطلوبة. أعد المعاينة قبل الحفظ.');
            abort_unless($current['capacity'] >= $current['reserved'], 409, 'لا يمكن خفض السعة دون الحجوزات المؤكدة والمنجزة.');
            $previous = $window->capacity;
            $window->capacity = $current['capacity'];
            $window->save();

            return ['window_id' => $window->id, 'old_capacity' => $previous, 'new_capacity' => $window->capacity, 'reserved' => $current['reserved'], 'pending' => $current['pending']];
        } else {
            abort(404);
        }

        return ['from' => $old, 'to' => $session->state];
    }

    public function dto(ClinicSession $session): array
    {
        $windows = ArrivalWindow::where('session_id', $session->id)->orderBy('starts_at')->get()->map(fn (ArrivalWindow $w) => ['id' => $w->id, 'starts_at' => $w->starts_at->utc()->toIso8601String(), 'ends_at' => $w->ends_at->utc()->toIso8601String(), 'capacity' => $w->capacity, ...$this->reservations($session->id, $w->id)])->all();
        $bookings = DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->count();
        $unresolved = DB::table('visits')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->whereIn('state', ['waiting', 'away', 'called', 'in_service'])->count();

        return ['id' => $session->id, 'doctor_id' => $session->doctor_id, 'doctor_name' => Doctor::find($session->doctor_id)?->display_name ?? 'طبيب', 'starts_at' => $session->starts_at->utc()->toIso8601String(), 'ends_at' => $session->ends_at->utc()->toIso8601String(),
            'state' => $session->state, 'version' => $session->version, 'windows' => $windows, 'total_capacity' => array_sum(array_column($windows, 'capacity')), 'booking_count' => $bookings, 'unresolved_visits' => $unresolved,
            'accepting_arrivals' => in_array($session->state, ['open', 'paused'], true) && now()->gte($session->starts_at) && now()->lt($session->ends_at), 'intake_ended' => now()->gte($session->ends_at),
            'can_correct_schedule' => $session->state === 'scheduled' && $bookings === 0 && $unresolved === 0];
    }
}
