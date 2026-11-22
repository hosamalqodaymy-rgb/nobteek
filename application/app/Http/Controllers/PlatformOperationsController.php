<?php

namespace App\Http\Controllers;

use App\Services\ClinicAuthority;
use App\Services\SecurityAudit;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class PlatformOperationsController extends Controller
{
    private function check(Request $request): void
    {
        abort_unless($request->user()?->platform_role === 'platform_admin', 403);
    }

    public function index(Request $request): Response|JsonResponse
    {
        $this->check($request);
        $request->validate(['clinic_id' => ['prohibited'], 'patient_id' => ['prohibited'],
            'phone' => ['prohibited'], 'user_id' => ['prohibited']]);
        $cases = DB::table('support_requests as s')->join('clinics as c', 'c.id', '=', 's.clinic_id')
            ->orderByDesc('s.opened_at')->orderByDesc('s.id')->limit(100)
            ->get(['s.id', 's.category', 's.state', 's.version', 's.opened_at', 's.resolved_at', 'c.display_name as clinic_name'])
            ->map(fn ($s): array => ['id' => $s->id, 'category' => $s->category, 'state' => $s->state,
                'version' => (int) $s->version, 'opened_at' => CarbonImmutable::parse($s->opened_at)->utc()->toIso8601String(),
                'resolved_at' => $s->resolved_at ? CarbonImmutable::parse($s->resolved_at)->utc()->toIso8601String() : null,
                'clinic_name' => $s->clinic_name]);
        $events = DB::table('security_events')->orderByDesc('at')->orderByDesc('id')->limit(50)
            ->get(['event_type', 'at'])
            ->map(fn ($e): array => ['event_type' => $e->event_type, 'at' => CarbonImmutable::parse($e->at)->utc()->toIso8601String()]);
        $clinics = DB::table('clinics')->selectRaw("count(*) as total, count(*) FILTER (WHERE operational_state = 'active') as active, count(*) FILTER (WHERE operational_state = 'suspended') as suspended")->first();
        $payload = ['cases' => $cases, 'security_events' => $events,
            'clinic_summary' => ['total' => (int) $clinics->total, 'active' => (int) $clinics->active,
                'suspended' => (int) $clinics->suspended],
            'resolve_url' => route('platform.support.resolve', ['support' => 'SUPPORT_ID_PLACEHOLDER'])];

        return $request->expectsJson() ? response()->json($payload) : Inertia::render('PlatformOperations', $payload);
    }

    public function resolve(Request $request, string $support, ClinicAuthority $authority, SecurityAudit $audit): JsonResponse
    {
        $this->check($request);
        $data = $request->validate(['version' => ['required', 'integer', 'min:1'],
            'reason_code' => ['required', 'in:support_resolved'],
            'patient_id' => ['prohibited'], 'clinic_id' => ['prohibited'],
            'description' => ['prohibited'], 'message' => ['prohibited']]);
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && Str::isUuid($key), 428, 'أرسل مفتاح محاولة صالحًا.');
        $keyDigest = hash_hmac('sha256', strtolower($key), (string) config('app.key'));
        $result = DB::transaction(function () use ($request, $support, $authority, $audit, $data, $keyDigest): array {
            $actor = $authority->platform($request);
            $record = DB::table('support_requests')->where('id', $support)->lockForUpdate()->first();
            abort_unless($record, 404);
            if ($record->state === 'resolved' && $record->resolved_by_user_id === $actor->id &&
                hash_equals((string) $record->resolution_key_digest, $keyDigest) &&
                (int) $record->version === (int) $data['version'] + 1) {
                return ['id' => $support, 'state' => 'resolved', 'version' => (int) $record->version, 'replayed' => true];
            }
            abort_unless($record->state === 'open' && (int) $record->version === (int) $data['version'], 409, 'تغير طلب الدعم. حدّث القائمة.');
            DB::table('support_requests')->where('id', $support)->update([
                'state' => 'resolved', 'version' => $record->version + 1,
                'resolved_at' => now(), 'resolved_by_user_id' => $actor->id, 'resolution_key_digest' => $keyDigest,
            ]);
            $audit->record('support_resolved', $actor->id, clinic: $record->clinic_id,
                request: $request, context: ['result' => 'resolved']);

            return ['id' => $support, 'state' => 'resolved', 'version' => (int) $record->version + 1, 'replayed' => false];
        }, 3);

        return response()->json($result);
    }
}
