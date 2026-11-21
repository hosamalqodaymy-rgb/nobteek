<?php

namespace App\Services;

use App\Models\ClinicSession;
use App\Models\Visit;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use stdClass;

class DoctorCommands
{
    public const REASONS = [
        'priority' => ['clinical_priority'],
        'correct' => ['administrative_correction', 'entered_in_error'],
    ];

    public function __construct(private ClinicAuthority $authority, private SecurityAudit $securityAudit) {}

    private function expectedVersion(Request $request): int
    {
        $header = (string) $request->header('If-Match');
        abort_if($header === '', 428, 'يلزم إصدار السجل قبل تنفيذ الإجراء.');
        abort_unless(preg_match('/^(?:"([1-9][0-9]{0,17})"|([1-9][0-9]{0,17}))$/D', $header, $match), 422, 'صيغة إصدار السجل غير صالحة.');

        return (int) ($match[1] !== '' ? $match[1] : $match[2]);
    }

    private function key(Request $request): string
    {
        $key = (string) $request->header('Idempotency-Key');
        abort_unless(preg_match('/^[a-zA-Z0-9_.:-]{16,128}$/D', $key), 422, 'يلزم مفتاح محاولة صالح.');

        return hash_hmac('sha256', $key, config('app.key'));
    }

    private function fingerprint(array $data): string
    {
        ksort($data);

        return hash_hmac('sha256', json_encode($data, JSON_THROW_ON_ERROR), config('app.key'));
    }

    private function replay(string $key, string $fingerprint): ?array
    {
        $context = app(TenantContext::class);
        $record = DB::table('command_replays')->where('clinic_id', $context->clinicId())
            ->where('actor_scope_digest', hash_hmac('sha256', $context->membership['id'], config('app.key')))->where('key_digest', $key)->first();
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

    private function remember(Request $request, string $key, string $fingerprint, array $result): array
    {
        $context = app(TenantContext::class);
        $result += ['server_time' => now()->utc()->toIso8601String(), 'request_id' => $request->attributes->get('security_request_id')];
        DB::table('command_replays')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $context->clinicId(),
            'actor_scope_digest' => hash_hmac('sha256', $context->membership['id'], config('app.key')), 'key_digest' => $key, 'request_fingerprint' => $fingerprint,
            'response_ciphertext' => Crypt::encryptString(json_encode($result, JSON_THROW_ON_ERROR)), 'created_at' => now(), 'expires_at' => now()->addHours(48)]);

        return [...$result, 'replayed' => false];
    }

    private function audit(Request $request, string $type, string $id, string $event, array $changes, string $reason): void
    {
        $context = app(TenantContext::class);
        $eventId = (string) Str::uuid();
        DB::table('audit_events')->insert(['id' => $eventId, 'clinic_id' => $context->clinicId(), 'actor_membership_id' => $context->membership['id'],
            'actor_kind' => 'staff', 'entity_type' => $type, 'entity_id' => $id, 'event_type' => $event, 'reason_code' => $reason,
            'request_id' => $request->attributes->get('security_request_id'), 'at' => now(), 'safe_changes' => json_encode((object) $changes, JSON_THROW_ON_ERROR)]);
        DB::table('outbox_messages')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $context->clinicId(), 'event_id' => $eventId, 'channel' => 'internal', 'status' => 'disabled']);
    }

    /** Lock order: actor, membership, session, doctor, booking, window, visit. */
    private function doctor(Request $request, ClinicSession $session): stdClass
    {
        $doctor = DB::table('doctors')->where('clinic_id', $session->clinic_id)->where('id', $session->doctor_id)->lockForUpdate()->firstOrFail();
        if (app(TenantContext::class)->role() === 'doctor') {
            abort_unless($doctor->active && $doctor->user_id === $request->user()->id, 403);
        }

        return $doctor;
    }

    private function availableDoctor(stdClass $doctor): void
    {
        $available = DB::table('memberships as m')->join('users as u', 'u.id', '=', 'm.user_id')
            ->where('m.clinic_id', $doctor->clinic_id)->where('m.user_id', $doctor->user_id)->where('m.role', 'doctor')->where('m.active', true)
            ->where('u.login_enabled', true)->where('u.access_suspended', false)->exists();
        abort_unless($doctor->active && $available, 409, 'الطبيب غير متاح لاستدعاء مراجع جديد.');
    }

    /** @return array{0:stdClass,1:stdClass} */
    private function records(ClinicSession $session, string $bookingId, string $visitId): array
    {
        $booking = DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->where('id', $bookingId)->lockForUpdate()->firstOrFail();
        DB::table('arrival_windows')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->where('id', $booking->window_id)->lockForUpdate()->firstOrFail();
        $visit = DB::table('visits')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->where('doctor_id', $session->doctor_id)
            ->where('booking_id', $bookingId)->where('id', $visitId)->lockForUpdate()->firstOrFail();
        abort_unless($booking->visit_id === $visit->id, 409, 'تغير ربط الحضور بالحجز. حدث البيانات.');

        return [$booking, $visit];
    }

    private function result(ClinicSession $session, stdClass $booking, stdClass $visit): array
    {
        $result = ['id' => $visit->id, 'visit_id' => $visit->id, 'booking_id' => $booking->id, 'session_id' => $session->id,
            'state' => $visit->state, 'version' => (int) $visit->version, 'booking_state' => $booking->state, 'booking_version' => (int) $booking->version,
            'session_version' => $session->version, 'ticket_number' => (int) $visit->ticket_number, 'ready_sequence' => (int) $visit->ready_sequence, 'priority' => (bool) $visit->priority];
        foreach (['arrived_at', 'called_at', 'started_at', 'completed_at', 'returned_at'] as $field) {
            $result[$field] = $visit->$field ? CarbonImmutable::parse($visit->$field)->utc()->toIso8601String() : null;
        }

        return $result;
    }

    public function callNext(Request $request, string $id): array
    {
        $expected = $this->expectedVersion($request);
        $key = $this->key($request);
        $fingerprint = $this->fingerprint(['command' => 'doctor:call-next', 'session' => $id, 'expected' => $expected]);
        try {
            return DB::transaction(function () use ($request, $id, $expected, $key, $fingerprint): array {
                $this->authority->actor($request, ['doctor', 'reception']);
                Gate::authorize('workspace', Visit::class);
                $session = ClinicSession::whereKey($id)->lockForUpdate()->firstOrFail();
                Gate::authorize('callNext', [Visit::class, $session]);
                $doctor = $this->doctor($request, $session);
                if ($previous = $this->replay($key, $fingerprint)) {
                    return $previous;
                }
                abort_unless($session->version === $expected, 409, 'تغيرت الجلسة. حدث البيانات قبل الاستدعاء.');
                abort_unless($session->state === 'open' && now()->gte($session->starts_at), 409, 'الاستدعاء متاح للجلسة المفتوحة بعد بدء استقبالها فقط.');
                $this->availableDoctor($doctor);
                abort_if(DB::table('visits')->where('clinic_id', $session->clinic_id)->where('doctor_id', $doctor->id)->whereIn('state', ['called', 'in_service'])->exists(), 409,
                    'لدى الطبيب مراجع مستدعى أو داخل الكشف، ولو كان من جلسة أخرى. أكمل الإجراء الحالي أولًا.');
                $next = DB::table('visits')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->where('state', 'waiting')
                    ->orderByDesc('priority')->orderBy('ready_sequence')->orderBy('id')->first();
                abort_unless($next, 409, 'لا يوجد مراجع حاضر في قائمة الانتظار.');
                [$booking, $visit] = $this->records($session, $next->booking_id, $next->id);
                abort_unless($booking->state === 'confirmed' && $visit->state === 'waiting' && $visit->started_at === null, 409, 'تغيرت حالة المراجع. حدث القائمة.');
                $oldCalledAt = $visit->called_at;
                $visit->state = 'called';
                $visit->called_at = now()->utc()->toIso8601String();
                $visit->version = (int) $visit->version + 1;
                DB::table('visits')->where('id', $visit->id)->update(['state' => $visit->state, 'called_at' => $visit->called_at, 'version' => $visit->version, 'updated_at' => now()]);
                $session->version++;
                $session->save();
                $this->audit($request, 'visit', $visit->id, 'visit_call_next', ['from' => 'waiting', 'to' => 'called', 'version' => $visit->version,
                    'ticket_number' => (int) $visit->ticket_number, 'ready_sequence' => (int) $visit->ready_sequence,
                    'previous_called_at' => $oldCalledAt ? CarbonImmutable::parse($oldCalledAt)->utc()->toIso8601String() : null,
                    'called_at' => $visit->called_at], 'queue_order');

                return $this->remember($request, $key, $fingerprint, $this->result($session, $booking, $visit));
            }, 3);
        } catch (QueryException $error) {
            if (($error->errorInfo[0] ?? null) === '23505' && str_contains($error->getMessage(), 'visits_one_active_per_doctor')) {
                abort(409, 'لدى الطبيب زيارة نشطة. حدث البيانات قبل الاستدعاء.');
            }
            throw $error;
        }
    }

    public function execute(Request $request, string $id, string $command, array $data): array
    {
        $expected = $this->expectedVersion($request);
        $key = $this->key($request);
        $fingerprint = $this->fingerprint(['command' => 'doctor:'.$command, 'visit' => $id, 'expected' => $expected, ...$data]);

        return DB::transaction(function () use ($request, $id, $command, $data, $expected, $key, $fingerprint): array {
            $this->authority->actor($request, ['doctor']);
            $initial = Visit::findOrFail($id);
            Gate::authorize('practice', $initial);
            $session = ClinicSession::whereKey($initial->session_id)->lockForUpdate()->firstOrFail();
            $this->doctor($request, $session);
            [$booking, $visit] = $this->records($session, $initial->booking_id, $id);
            if ($previous = $this->replay($key, $fingerprint)) {
                return $previous;
            }
            abort_unless((int) $visit->version === $expected, 409, 'تغيرت الزيارة. حدث البيانات قبل تنفيذ الإجراء.');
            abort_if($session->state === 'closed' && $command !== 'correct', 409, 'الجلسة مغلقة.');
            $changes = ['from' => $visit->state, 'ticket_number' => (int) $visit->ticket_number];
            $updates = [];
            if ($command === 'start') {
                abort_unless($booking->state === 'confirmed' && $visit->state === 'called' && $visit->called_at !== null && $visit->started_at === null, 409, 'بدء الكشف متاح للمراجع المستدعى فقط.');
                $visit->state = 'in_service';
                $visit->started_at = now()->utc()->toIso8601String();
                $updates = ['state' => $visit->state, 'started_at' => $visit->started_at];
                $changes['started_at'] = $visit->started_at;
                $reason = 'consultation_started';
            } elseif ($command === 'complete') {
                abort_unless($booking->state === 'confirmed' && $visit->state === 'in_service' && $visit->started_at !== null && $visit->completed_at === null, 409, 'إنهاء الزيارة متاح بعد بدء الكشف فقط.');
                $visit->state = 'completed';
                $visit->completed_at = now()->utc()->toIso8601String();
                $updates = ['state' => $visit->state, 'completed_at' => $visit->completed_at];
                $booking->state = 'fulfilled';
                $booking->version = (int) $booking->version + 1;
                DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('id', $booking->id)->update(['state' => $booking->state, 'version' => $booking->version, 'updated_at' => now()]);
                $changes['completed_at'] = $visit->completed_at;
                $reason = 'consultation_completed';
                $this->audit($request, 'booking', $booking->id, 'booking_fulfilled', ['from' => 'confirmed', 'to' => 'fulfilled', 'version' => $booking->version, 'visit_id' => $visit->id], $reason);
            } elseif ($command === 'priority') {
                abort_unless($booking->state === 'confirmed' && $visit->state === 'waiting' && $visit->started_at === null, 409, 'تسجيل الأولوية الطبية متاح لمراجع حاضر في الانتظار فقط.');
                $changes += ['old_priority' => (bool) $visit->priority, 'old_ready_sequence' => (int) $visit->ready_sequence];
                $session->ready_counter = (int) $session->ready_counter + 1;
                $visit->priority = true;
                $visit->ready_sequence = $session->ready_counter;
                $updates = ['priority' => true, 'ready_sequence' => $visit->ready_sequence];
                $changes += ['priority' => true, 'ready_sequence' => $visit->ready_sequence];
                $reason = $data['reason_code'];
            } elseif ($command === 'correct') {
                abort_unless($visit->started_at !== null && in_array($visit->state, ['in_service', 'completed'], true)
                    && $booking->state === ($visit->state === 'completed' ? 'fulfilled' : 'confirmed'), 409, 'تسجيل التصحيح الإداري متاح بعد بدء الزيارة فقط؛ لا يعيد الحالة أو يغير الأوقات.');
                $changes['state_and_times_preserved'] = true;
                $reason = $data['reason_code'];
            } else {
                abort(404);
            }
            $visit->version = $expected + 1;
            DB::table('visits')->where('clinic_id', $session->clinic_id)->where('id', $id)->update([...$updates, 'version' => $visit->version, 'updated_at' => now()]);
            $session->version++;
            $session->save();
            $this->audit($request, 'visit', $id, 'visit_'.$command, [...$changes, 'to' => $visit->state, 'version' => $visit->version], $reason);

            return $this->remember($request, $key, $fingerprint, $this->result($session, $booking, $visit));
        }, 3);
    }

    public function delegate(Request $request, string $id, array $data): array
    {
        $expected = $this->expectedVersion($request);
        $key = $this->key($request);
        $fingerprint = $this->fingerprint(['command' => 'doctor:delegate-call-next', 'membership' => $id, 'expected' => $expected, ...$data]);

        return DB::transaction(function () use ($request, $id, $data, $expected, $key, $fingerprint): array {
            $actor = $this->authority->actor($request, ['owner'], recent: true);
            $context = app(TenantContext::class);
            $membership = DB::table('memberships')->where('clinic_id', $context->clinicId())->where('id', $id)->lockForUpdate()->firstOrFail();
            abort_unless($membership->role === 'reception' && $membership->active, 403, 'التفويض متاح لعضوية استقبال فعالة فقط.');
            if ($previous = $this->replay($key, $fingerprint)) {
                return $previous;
            }
            abort_unless((int) $membership->delegation_version === $expected, 409, 'تغير التفويض. حدث بيانات الفريق قبل الحفظ.');
            $permissions = json_decode($membership->delegated_permissions, true, flags: JSON_THROW_ON_ERROR);
            $old = ($permissions['call_next'] ?? false) === true;
            $enabled = (bool) $data['call_next'];
            $permissions['call_next'] = $enabled;
            $version = $expected + 1;
            DB::table('memberships')->where('id', $id)->update(['delegated_permissions' => json_encode((object) $permissions, JSON_THROW_ON_ERROR), 'delegation_version' => $version, 'updated_at' => now()]);
            $this->audit($request, 'membership', $id, 'call_next_delegation_changed', ['from' => $old, 'to' => $enabled, 'version' => $version], $data['reason_code']);
            $this->securityAudit->record('call_next_delegation_changed', $actor->id, $membership->user_id, $context->clinicId(), $request,
                ['reason' => $data['reason_code'], 'membership_id' => $id, 'result' => $enabled ? 'granted' : 'revoked']);

            return $this->remember($request, $key, $fingerprint, ['id' => $id, 'membership_id' => $id, 'call_next' => $enabled, 'version' => $version, 'delegation_version' => $version]);
        }, 3);
    }
}
