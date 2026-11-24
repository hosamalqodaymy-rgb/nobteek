<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Visit;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use stdClass;

class ReceptionCommands
{
    public const REASONS = [
        'mark-away' => ['temporarily_absent', 'not_present'],
        'return' => ['patient_returned'],
        'leave' => ['patient_left', 'entered_in_error'],
        'defer' => ['patient_request', 'administrative_correction'],
    ];

    public function __construct(private ClinicAuthority $authority, private TicketLinks $tickets) {}

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

        $result = json_decode(Crypt::decryptString($record->response_ciphertext), true, flags: JSON_THROW_ON_ERROR);
        $this->tickets->assertReplayCurrent($result);

        return [...$result, 'replayed' => true];
    }

    private function remember(Request $request, string $key, string $fingerprint, stdClass $visit, int $bookingVersion, array $receipt = []): array
    {
        $context = app(TenantContext::class);
        $result = ['id' => $visit->id, 'visit_id' => $visit->id, 'booking_id' => $visit->booking_id, 'session_id' => $visit->session_id,
            'state' => $visit->state, 'version' => (int) $visit->version, 'booking_version' => $bookingVersion, 'ticket_number' => (int) $visit->ticket_number,
            'ready_sequence' => (int) $visit->ready_sequence, 'server_time' => now()->utc()->toIso8601String(), 'request_id' => $request->attributes->get('security_request_id'), ...$receipt];
        DB::table('command_replays')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $context->clinicId(),
            'actor_scope_digest' => hash_hmac('sha256', $context->membership['id'], config('app.key')), 'key_digest' => $key, 'request_fingerprint' => $fingerprint,
            'response_ciphertext' => Crypt::encryptString(json_encode($result, JSON_THROW_ON_ERROR)), 'created_at' => now(), 'expires_at' => now()->addHours(48)]);

        return [...$result, 'replayed' => false];
    }

    /** Lock order matches booking commands: actor, membership, session, booking, window, visit. */
    private function session(string $id): stdClass
    {
        return DB::table('clinic_sessions')->where('clinic_id', app(TenantContext::class)->clinicId())->where('id', $id)->lockForUpdate()->firstOrFail();
    }

    private function accepting(stdClass $session): void
    {
        abort_unless(in_array($session->state, ['open', 'paused'], true), 409, 'تسجيل الحضور متاح للجلسة المفتوحة أو المتوقفة مؤقتًا فقط.');
        abort_if(now()->lt(CarbonImmutable::parse($session->starts_at)), 409, 'لم يبدأ استقبال الجلسة.');
        abort_if(now()->gte(CarbonImmutable::parse($session->ends_at)), 409, 'انتهى استقبال الجلسة؛ لا يمكن إضافة حضور جديد.');
        $available = DB::table('doctors as d')->join('memberships as m', function ($join): void {
            $join->on('m.clinic_id', '=', 'd.clinic_id')->on('m.user_id', '=', 'd.user_id');
        })->join('users as u', 'u.id', '=', 'd.user_id')->where('d.clinic_id', $session->clinic_id)->where('d.id', $session->doctor_id)
            ->where('d.active', true)->where('m.active', true)->where('m.role', 'doctor')->where('u.login_enabled', true)->where('u.access_suspended', false)->exists();
        abort_unless($available, 409, 'الطبيب غير متاح لاستقبال حضور جديد.');
    }

    private function window(stdClass $session, string $id): stdClass
    {
        return DB::table('arrival_windows')->where('clinic_id', $session->clinic_id)->where('session_id', $session->id)->where('id', $id)->lockForUpdate()->firstOrFail();
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

    private function arrive(Request $request, stdClass $session, stdClass $booking, stdClass $window, bool $walkIn): stdClass
    {
        abort_unless($booking->state === 'confirmed' && $booking->visit_id === null, 409, 'الحضور متاح لحجز مؤكد لم يسجل حضوره سابقًا فقط.');
        abort_if(DB::table('visits')->where('booking_id', $booking->id)->exists(), 409, 'يوجد سجل حضور لهذا الحجز؛ لا يمكن إصدار تذكرة ثانية.');
        abort_if(now()->lt(CarbonImmutable::parse($window->starts_at)), 409, 'لم تبدأ نافذة الوصول. غيّر النافذة قبل تسجيل الحضور إذا وجدت سعة.');
        $ticket = (int) $session->ticket_counter + 1;
        $ready = (int) $session->ready_counter + 1;
        $id = (string) Str::uuid();
        DB::table('visits')->insert(['id' => $id, 'clinic_id' => $session->clinic_id, 'booking_id' => $booking->id, 'session_id' => $session->id, 'doctor_id' => $session->doctor_id,
            'ticket_number' => $ticket, 'ready_sequence' => $ready, 'priority' => false, 'state' => 'waiting', 'version' => 1, 'arrived_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $booking->version = (int) $booking->version + 1;
        DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('id', $booking->id)->update(['visit_id' => $id, 'version' => $booking->version, 'updated_at' => now()]);
        DB::table('clinic_sessions')->where('id', $session->id)->update(['ticket_counter' => $ticket, 'ready_counter' => $ready, 'version' => (int) $session->version + 1, 'updated_at' => now()]);
        $late = now()->gte(CarbonImmutable::parse($window->ends_at));
        $reason = $walkIn ? 'walk_in_verified' : ($late ? 'late_arrival' : 'arrival_verified');
        $this->audit($request, 'booking', $booking->id, $walkIn ? 'booking_walk_in' : 'booking_check_in', ['to' => 'confirmed', 'version' => $booking->version, 'visit_id' => $id], $reason);
        $this->audit($request, 'visit', $id, 'visit_check_in', ['to' => 'waiting', 'version' => 1, 'booking_id' => $booking->id, 'ticket_number' => $ticket, 'ready_sequence' => $ready, 'late_arrival' => $late], $reason);

        return DB::table('visits')->where('id', $id)->firstOrFail();
    }

    public function checkIn(Request $request, string $id): array
    {
        $expected = $this->expectedVersion($request);
        $key = $this->key($request);
        $fingerprint = $this->fingerprint(['command' => 'check-in', 'booking' => $id, 'expected' => $expected]);

        return DB::transaction(function () use ($request, $id, $expected, $key, $fingerprint): array {
            $this->authority->actor($request, ['owner', 'reception']);
            $initial = Booking::findOrFail($id);
            Gate::authorize('manage', $initial);
            $session = $this->session($initial->session_id);
            $booking = DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('id', $id)->lockForUpdate()->firstOrFail();
            if ($previous = $this->replay($key, $fingerprint)) {
                return $previous;
            }
            abort_unless($booking->session_id === $initial->session_id && (int) $booking->version === $expected, 409, 'تغير الحجز. حدث البيانات قبل تسجيل الحضور.');
            $this->accepting($session);
            $window = $this->window($session, $booking->window_id);
            $visit = $this->arrive($request, $session, $booking, $window, false);

            return $this->remember($request, $key, $fingerprint, $visit, $booking->version);
        }, 3);
    }

    public function walkIn(Request $request, string $id, array $data): array
    {
        $key = $this->key($request);
        $fingerprint = $this->fingerprint(['command' => 'walk-in', 'session' => $id, ...$data]);

        return DB::transaction(function () use ($request, $id, $data, $key, $fingerprint): array {
            $this->authority->actor($request, ['owner', 'reception']);
            $session = $this->session($id);
            if ($previous = $this->replay($key, $fingerprint)) {
                return $previous;
            }
            app(ClinicBilling::class)->requireNewIntake($session->clinic_id);
            $this->accepting($session);
            $window = $this->window($session, $data['window_id']);
            abort_unless(now()->gte(CarbonImmutable::parse($window->starts_at)) && now()->lt(CarbonImmutable::parse($window->ends_at)), 409, 'اختر نافذة وصول جارية للحضور المباشر.');
            $reserved = DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('window_id', $window->id)->whereIn('state', ['confirmed', 'fulfilled'])->count();
            abort_if($reserved >= $window->capacity, 409, 'اكتملت سعة نافذة الوصول. لا يمكن إضافة حضور مباشر.');
            $patientId = (string) Str::uuid();
            DB::table('patients')->insert(['id' => $patientId, 'clinic_id' => $session->clinic_id, 'display_name' => $data['display_name'], 'contact_phone' => $data['contact_phone'], 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
            $bookingId = (string) Str::uuid();
            DB::table('bookings')->insert(['id' => $bookingId, 'clinic_id' => $session->clinic_id, 'patient_id' => $patientId, 'session_id' => $session->id, 'window_id' => $window->id,
                'source' => 'walk_in', 'state' => 'confirmed', 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
            $booking = DB::table('bookings')->where('id', $bookingId)->firstOrFail();
            $visit = $this->arrive($request, $session, $booking, $window, true);

            return $this->remember($request, $key, $fingerprint, $visit, $booking->version, $this->tickets->issue($booking, $session));
        }, 3);
    }

    public function execute(Request $request, string $id, string $command, array $data): array
    {
        $expected = $this->expectedVersion($request);
        $key = $this->key($request);
        $fingerprint = $this->fingerprint(['command' => 'visit:'.$command, 'visit' => $id, 'expected' => $expected, ...$data]);

        return DB::transaction(function () use ($request, $id, $command, $data, $expected, $key, $fingerprint): array {
            $roles = $command === 'defer' ? ['owner'] : ($command === 'return' ? ['owner', 'reception'] : ['owner', 'reception', 'doctor']);
            $this->authority->actor($request, $roles);
            $initial = Visit::findOrFail($id);
            Gate::authorize('view', $initial);
            $session = $this->session($initial->session_id);
            $booking = DB::table('bookings')->where('clinic_id', $session->clinic_id)->where('id', $initial->booking_id)->lockForUpdate()->firstOrFail();
            $this->window($session, $booking->window_id);
            $visit = DB::table('visits')->where('clinic_id', $session->clinic_id)->where('id', $id)->lockForUpdate()->firstOrFail();
            if ($previous = $this->replay($key, $fingerprint)) {
                return $previous;
            }
            abort_unless((int) $visit->version === $expected, 409, 'تغير سجل الحضور. حدث البيانات قبل تنفيذ الإجراء.');
            abort_if($session->state === 'closed', 409, 'الجلسة مغلقة.');
            abort_unless($booking->state === 'confirmed' && $visit->started_at === null, 409, 'هذه الزيارة لا تقبل إجراء استقبال؛ راجع الطبيب.');
            $old = $visit->state;
            $changes = ['from' => $old, 'ticket_number' => (int) $visit->ticket_number, 'old_ready_sequence' => (int) $visit->ready_sequence];
            if ($command === 'mark-away') {
                abort_unless(in_array($old, ['waiting', 'called'], true), 409, 'الغياب المؤقت متاح للمنتظر أو المستدعى فقط.');
                $visit->state = 'away';
            } elseif ($command === 'leave') {
                abort_unless(in_array($old, ['waiting', 'called', 'away'], true), 409, 'هذه الحالة لا تقبل تسجيل مغادرة من الاستقبال.');
                $visit->state = 'left';
            } elseif (in_array($command, ['return', 'defer'], true)) {
                abort_unless($old === ($command === 'return' ? 'away' : 'waiting'), 409, 'الحالة الحالية لا تقبل هذا الإجراء.');
                abort_if($command === 'defer' && $visit->priority, 409, 'الأولوية الطبية من اختصاص الطبيب؛ لا تستخدم الإرجاء الإداري لتغييرها.');
                $visit->state = 'waiting';
                $visit->ready_sequence = (int) $session->ready_counter + 1;
                $visit->priority = false;
                if ($command === 'return') {
                    $visit->returned_at = now();
                }
            } else {
                abort(404);
            }
            $visit->version = $expected + 1;
            DB::table('visits')->where('id', $id)->update(['state' => $visit->state, 'version' => $visit->version, 'ready_sequence' => $visit->ready_sequence,
                'priority' => $visit->priority, 'returned_at' => $visit->returned_at, 'updated_at' => now()]);
            DB::table('clinic_sessions')->where('id', $session->id)->update(['ready_counter' => max((int) $session->ready_counter, (int) $visit->ready_sequence), 'version' => (int) $session->version + 1, 'updated_at' => now()]);
            $this->audit($request, 'visit', $id, 'visit_'.str_replace('-', '_', $command), [...$changes, 'to' => $visit->state, 'version' => $visit->version, 'ready_sequence' => (int) $visit->ready_sequence], $data['reason_code']);

            return $this->remember($request, $key, $fingerprint, $visit, (int) $booking->version);
        }, 3);
    }
}
