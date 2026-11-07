<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Patient;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use stdClass;

class BookingCommands
{
    public const REASONS = ['booking_reviewed', 'capacity_full', 'patient_request', 'clinic_unavailable', 'duplicate_request', 'contact_unreachable', 'schedule_change', 'entered_in_error'];

    public function __construct(private ClinicAuthority $authority, private BookingGuests $guests) {}

    private function expectedVersion(Request $request): int
    {
        $header = (string) $request->header('If-Match');
        abort_if($header === '', 428, 'يلزم إصدار الحجز قبل تنفيذ الإجراء.');
        abort_unless(preg_match('/^(?:"([1-9][0-9]{0,17})"|([1-9][0-9]{0,17}))$/D', $header, $match), 422, 'صيغة إصدار الحجز غير صالحة.');

        return (int) ($match[1] !== '' ? $match[1] : $match[2]);
    }

    private function attemptKey(Request $request): string
    {
        $key = (string) $request->header('Idempotency-Key');
        abort_unless(preg_match('/^[a-zA-Z0-9_.:-]{16,128}$/D', $key), 422, 'يلزم مفتاح محاولة صالح.');

        return hash_hmac('sha256', $key, config('app.key'));
    }

    private function canonical(array $data): array
    {
        ksort($data);

        return $data;
    }

    private function fingerprint(array $data): string
    {
        return hash_hmac('sha256', json_encode($this->canonical($data), JSON_THROW_ON_ERROR), config('app.key'));
    }

    /** Lock order: actor or guest, sessions sorted by id, booking, arrival window, visit. */
    private function actor(Request $request): array
    {
        if ($request->user()) {
            $this->authority->actor($request, ['owner', 'reception']);
            $context = app(TenantContext::class);

            return ['kind' => 'staff', 'id' => $context->membership['id'], 'clinic' => $context->clinicId(), 'scope' => hash_hmac('sha256', $context->membership['id'], config('app.key'))];
        }
        $id = $this->guests->lock($request);

        return ['kind' => 'guest', 'id' => $id, 'clinic' => null, 'scope' => hash_hmac('sha256', 'guest:'.$id, config('app.key'))];
    }

    private function replay(string $clinic, array $actor, string $key, string $fingerprint): ?array
    {
        $record = DB::table('command_replays')->where('clinic_id', $clinic)->where('actor_scope_digest', $actor['scope'])->where('key_digest', $key)->first();
        if (! $record) {
            return null;
        }
        if (CarbonImmutable::parse($record->expires_at)->lte(now())) {
            DB::table('command_replays')->where('id', $record->id)->delete();

            return null;
        }
        abort_unless(hash_equals($record->request_fingerprint, $fingerprint), 409, 'استخدم مفتاح محاولة جديدًا لإجراء أو بيانات مختلفة.');

        return [...json_decode(Crypt::decryptString($record->response_ciphertext), true, flags: JSON_THROW_ON_ERROR), 'replayed' => true];
    }

    private function remember(string $clinic, array $actor, string $key, string $fingerprint, array $result): array
    {
        DB::table('command_replays')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $clinic, 'actor_scope_digest' => $actor['scope'], 'key_digest' => $key, 'request_fingerprint' => $fingerprint,
            'response_ciphertext' => Crypt::encryptString(json_encode($result, JSON_THROW_ON_ERROR)), 'created_at' => now(), 'expires_at' => now()->addHours(48)]);

        return [...$result, 'replayed' => false];
    }

    private function audit(Request $request, array $actor, string $clinic, string $id, string $event, array $changes, string $reason): void
    {
        $eventId = (string) Str::uuid();
        DB::table('audit_events')->insert(['id' => $eventId, 'clinic_id' => $clinic, 'actor_membership_id' => $actor['kind'] === 'staff' ? $actor['id'] : null,
            'actor_kind' => $actor['kind'], 'guest_id' => $actor['kind'] === 'guest' ? $actor['id'] : null, 'entity_type' => 'booking', 'entity_id' => $id, 'event_type' => $event,
            'reason_code' => $reason, 'request_id' => $request->attributes->get('security_request_id'), 'at' => now(), 'safe_changes' => json_encode((object) $changes, JSON_THROW_ON_ERROR)]);
        DB::table('outbox_messages')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $clinic, 'event_id' => $eventId, 'channel' => 'internal', 'status' => 'disabled']);
    }

    private function session(string $id, ?string $clinic): stdClass
    {
        $query = DB::table('clinic_sessions')->where('id', $id);
        if ($clinic) {
            $query->where('clinic_id', $clinic);
        }
        $session = $query->lockForUpdate()->firstOrFail();
        abort_unless(DB::table('clinics')->where('id', $session->clinic_id)->where('operational_state', 'active')->exists(), 404);

        return $session;
    }

    private function available(stdClass $session, string $windowId, bool $reserve, ?string $exclude = null): stdClass
    {
        abort_if($session->state === 'closed', 409, 'الجلسة مغلقة.');
        abort_if(CarbonImmutable::parse($session->ends_at)->lte(now()), 409, 'انتهى استقبال هذه الجلسة.');
        $doctorActive = DB::table('doctors as d')->join('memberships as m', function ($join): void {
            $join->on('m.clinic_id', '=', 'd.clinic_id')->on('m.user_id', '=', 'd.user_id');
        })->join('users as u', 'u.id', '=', 'd.user_id')->where('d.clinic_id', $session->clinic_id)->where('d.id', $session->doctor_id)
            ->where('d.active', true)->where('m.role', 'doctor')->where('m.active', true)->where('u.access_suspended', false)->where('u.login_enabled', true)->exists();
        abort_unless($doctorActive, 409, 'الطبيب غير متاح للحجوزات حاليًا.');
        $window = DB::table('arrival_windows')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->where('id', $windowId)->lockForUpdate()->firstOrFail();
        abort_if(CarbonImmutable::parse($window->ends_at)->lte(now()), 409, 'انتهت نافذة الوصول. اختر نافذة لاحقة.');
        if ($reserve) {
            $query = DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('window_id', $window->id)->whereIn('state', ['confirmed', 'fulfilled']);
            if ($exclude) {
                $query->where('id', '!=', $exclude);
            }
            abort_if($query->count() >= $window->capacity, 409, 'اكتملت سعة نافذة الوصول. اختر نافذة أخرى.');
        }

        return $window;
    }

    private function bump(array $sessions): void
    {
        foreach (array_unique($sessions) as $id) {
            DB::table('clinic_sessions')->where('id', $id)->increment('version', 1, ['updated_at' => now()]);
        }
    }

    private function result(Request $request, stdClass $booking): array
    {
        return ['id' => $booking->id, 'state' => $booking->state, 'version' => (int) $booking->version, 'session_id' => $booking->session_id, 'window_id' => $booking->window_id,
            'server_time' => now()->utc()->toIso8601String(), 'request_id' => $request->attributes->get('security_request_id')];
    }

    public function create(Request $request, array $data): array
    {
        $key = $this->attemptKey($request);
        $fingerprint = $this->fingerprint(['command' => 'request', ...$data]);

        return DB::transaction(function () use ($request, $data, $key, $fingerprint): array {
            $actor = $this->actor($request);
            $session = $this->session($data['session_id'], $actor['clinic']);
            if ($previous = $this->replay($session->clinic_id, $actor, $key, $fingerprint)) {
                return $previous;
            }
            $this->available($session, $data['window_id'], false);
            if (isset($data['patient_id'])) {
                abort_unless($actor['kind'] === 'staff', 403);
                $patient = Patient::findOrFail($data['patient_id']);
                if (in_array($data['source'], ['phone', 'web'], true) && ! $patient->contact_phone) {
                    throw ValidationException::withMessages(['patient_id' => 'الحجز الهاتفي يحتاج رقم تواصل محفوظًا للمراجع.']);
                }
                $patientId = $patient->id;
            } else {
                $patientId = (string) Str::uuid();
                DB::table('patients')->insert(['id' => $patientId, 'clinic_id' => $session->clinic_id, 'display_name' => $data['display_name'], 'contact_phone' => $data['contact_phone'], 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
            }
            $id = (string) Str::uuid();
            DB::table('bookings')->insert(['id' => $id, 'clinic_id' => $session->clinic_id, 'patient_id' => $patientId, 'session_id' => $session->id, 'window_id' => $data['window_id'],
                'source' => $actor['kind'] === 'guest' ? 'web' : $data['source'], 'state' => 'pending', 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
            $this->bump([$session->id]);
            $this->audit($request, $actor, $session->clinic_id, $id, 'booking_requested', ['to' => 'pending', 'version' => 1, 'session_id' => $session->id, 'window_id' => $data['window_id'], 'source' => $actor['kind'] === 'guest' ? 'web' : $data['source']], 'request_received');
            $record = DB::table('bookings')->where('id', $id)->firstOrFail();

            return $this->remember($session->clinic_id, $actor, $key, $fingerprint, $this->result($request, $record));
        }, 3);
    }

    public function execute(Request $request, string $id, string $command, array $data): array
    {
        $expected = $this->expectedVersion($request);
        $key = $this->attemptKey($request);
        $fingerprint = $this->fingerprint(['command' => $command, 'booking' => $id, 'expected' => $expected, ...$data]);

        return DB::transaction(function () use ($request, $id, $command, $data, $expected, $key, $fingerprint): array {
            $actor = $this->actor($request);
            abort_unless($actor['kind'] === 'staff', 403);
            $initial = Booking::findOrFail($id);
            Gate::authorize('manage', $initial);
            $sessionIds = array_unique([$initial->session_id, $command === 'reschedule' ? $data['session_id'] : $initial->session_id]);
            sort($sessionIds, SORT_STRING);
            $sessions = [];
            foreach ($sessionIds as $sessionId) {
                $sessions[$sessionId] = $this->session($sessionId, $actor['clinic']);
            }
            $booking = DB::table('bookings')->where('clinic_id', $actor['clinic'])->where('id', $id)->lockForUpdate()->firstOrFail();
            if ($previous = $this->replay($actor['clinic'], $actor, $key, $fingerprint)) {
                return $previous;
            }
            abort_unless($booking->session_id === $initial->session_id && (int) $booking->version === $expected, 409, 'تغير الحجز. حدث البيانات قبل تنفيذ الإجراء.');
            $old = $booking->state;
            $changes = ['from' => $old, 'version' => $expected + 1];
            if ($command === 'confirm') {
                abort_unless($old === 'pending', 409, 'يمكن تأكيد الطلب المعلق فقط.');
                $this->available($sessions[$booking->session_id], $booking->window_id, true);
                $booking->state = 'confirmed';
            } elseif ($command === 'reject') {
                abort_unless($old === 'pending', 409, 'يمكن رفض الطلب المعلق فقط.');
                $booking->state = 'rejected';
            } elseif ($command === 'cancel') {
                abort_unless(in_array($old, ['pending', 'confirmed'], true), 409, 'هذه الحالة لا تقبل إلغاء حجز عادي.');
                $changes += $this->cancelVisit($booking);
                $booking->state = 'cancelled';
            } elseif ($command === 'reschedule') {
                abort_unless(in_array($old, ['pending', 'confirmed'], true), 409, 'التأجيل متاح للحجز المعلق أو المؤكد قبل الحضور.');
                abort_if(DB::table('visits')->where('clinic_id', $actor['clinic'])->where('booking_id', $id)->exists(), 409, 'سجل المراجع حضوره. استخدم إجراءات الدور بدل تأجيل الحجز.');
                abort_if($booking->session_id === $data['session_id'] && $booking->window_id === $data['window_id'], 422, 'اختر نافذة مختلفة للتأجيل.');
                $this->available($sessions[$data['session_id']], $data['window_id'], $old === 'confirmed', $id);
                $changes += ['old_session_id' => $booking->session_id, 'old_window_id' => $booking->window_id, 'session_id' => $data['session_id'], 'window_id' => $data['window_id']];
                $booking->session_id = $data['session_id'];
                $booking->window_id = $data['window_id'];
                $tokens = DB::table('ticket_tokens')->where('clinic_id', $actor['clinic'])->where('booking_id', $id)->whereNull('revoked_at');
                $tokens->update(['expires_at' => CarbonImmutable::parse($sessions[$data['session_id']]->ends_at)->addHours(48)]);
            } else {
                abort(404);
            }
            $booking->version = $expected + 1;
            DB::table('bookings')->where('clinic_id', $actor['clinic'])->where('id', $id)->update(['state' => $booking->state, 'session_id' => $booking->session_id, 'window_id' => $booking->window_id, 'version' => $booking->version, 'updated_at' => now()]);
            $this->bump($sessionIds);
            $this->audit($request, $actor, $actor['clinic'], $id, 'booking_'.$command, [...$changes, 'to' => $booking->state], $data['reason_code']);

            return $this->remember($actor['clinic'], $actor, $key, $fingerprint, $this->result($request, $booking));
        }, 3);
    }

    private function cancelVisit(stdClass $booking): array
    {
        $visit = DB::table('visits')->where('clinic_id', $booking->clinic_id)->where('booking_id', $booking->id)->lockForUpdate()->first();
        if (! $visit) {
            return [];
        }
        abort_if($visit->started_at !== null || in_array($visit->state, ['in_service', 'completed'], true), 409, 'بدأت الزيارة؛ لا تستخدم إلغاء الحجز. راجع الطبيب.');
        if ($visit->state !== 'left') {
            DB::table('visits')->where('id', $visit->id)->where('clinic_id', $booking->clinic_id)->update(['state' => 'left', 'version' => (int) $visit->version + 1, 'updated_at' => now()]);
        }

        return ['visit_id' => $visit->id, 'old_visit_state' => $visit->state, 'visit_state' => 'left', 'visit_version' => (int) $visit->version + ($visit->state === 'left' ? 0 : 1)];
    }
}
