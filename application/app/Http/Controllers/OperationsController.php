<?php

namespace App\Http\Controllers;

use App\Services\AccountSecurity;
use App\Services\ClinicAuthority;
use App\Services\OperationsRead;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class OperationsController extends Controller
{
    private function owner(): string
    {
        $context = app(TenantContext::class);
        abort_unless($context->role() === 'owner', 403);

        return $context->clinicId();
    }

    public function index(Request $request, OperationsRead $read): Response|JsonResponse
    {
        $clinic = $this->owner();
        $data = $request->validate(['date' => ['nullable', 'date_format:Y-m-d'], 'clinic_id' => ['prohibited'],
            'patient_id' => ['prohibited'], 'doctor_id' => ['prohibited'], 'phone' => ['prohibited']]);
        $date = $data['date'] ?? now('Asia/Aden')->toDateString();
        $payload = [
            'report' => $read->report($clinic, $date),
            'notifications' => $read->notifications($clinic),
            'audit' => $read->clinicAudit($clinic),
            'simulation_url' => route('operations.simulate'),
            'export_url' => route('operations.export'),
            'support_url' => route('operations.support'),
            'support_requests' => DB::table('support_requests')->where('clinic_id', $clinic)->orderByDesc('opened_at')
                ->limit(30)->get(['id', 'category', 'state', 'version', 'opened_at']),
        ];

        return $request->expectsJson() ? response()->json($payload) : Inertia::render('Operations', $payload);
    }

    public function export(Request $request, OperationsRead $read, AccountSecurity $security): \Illuminate\Http\Response
    {
        $clinic = $this->owner();
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d'], 'clinic_id' => ['prohibited'],
            'patient_id' => ['prohibited'], 'phone' => ['prohibited'], 'format' => ['prohibited']]);
        $security->lockedActor($request, recent: true, mfa: true);
        $report = $read->report($clinic, $data['date']);
        $file = fopen('php://temp', 'r+');
        fwrite($file, "\xEF\xBB\xBF");
        fputcsv($file, ['metric', 'value'], ',', '"', '');
        foreach ($report as $name => $value) {
            fputcsv($file, [$name, $value ?? 'not_available'], ',', '"', '');
        }
        rewind($file);
        $csv = stream_get_contents($file);
        fclose($file);

        return response($csv, 200, ['Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="nobteek-daily-report-'.$data['date'].'.csv"',
            'Cache-Control' => 'private, no-store, max-age=0', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function simulate(Request $request, ClinicAuthority $authority): JsonResponse
    {
        $clinic = $this->owner();
        $data = $request->validate(['event_id' => ['required', 'uuid'],
            'channel' => ['required', Rule::in(['sms', 'whatsapp', 'email'])],
            'clinic_id' => ['prohibited'], 'to' => ['prohibited'], 'phone' => ['prohibited'],
            'message' => ['prohibited'], 'delivered' => ['prohibited']]);
        $result = DB::transaction(function () use ($request, $authority, $data, $clinic): array {
            $authority->actor($request, ['owner']);
            $event = DB::table('outbox_messages')->where('clinic_id', $clinic)->where('event_id', $data['event_id'])
                ->where('channel', 'internal')->where('status', 'disabled')->first();
            abort_unless($event, 404);
            $existing = DB::table('notification_simulations')->where('clinic_id', $clinic)->where('event_id', $event->event_id)
                ->where('channel', $data['channel'])->first();
            $inserted = 0;
            if (! $existing) {
                $inserted = DB::table('notification_simulations')->insertOrIgnore([
                    'id' => (string) Str::uuid(), 'clinic_id' => $clinic, 'event_id' => $event->event_id,
                    'channel' => $data['channel'], 'status' => 'simulated_not_sent',
                    'actor_membership_id' => app(TenantContext::class)->membership['id'], 'simulated_at' => now(),
                ]);
            }
            return ['event_id' => $event->event_id, 'channel' => $data['channel'], 'state' => 'simulated_not_sent',
                'replayed' => $existing !== null || $inserted === 0,
                'external_delivery' => false];
        }, 3);

        return response()->json($result);
    }

    public function openSupport(Request $request, ClinicAuthority $authority): JsonResponse
    {
        $clinic = $this->owner();
        $data = $request->validate(['category' => ['required', Rule::in(['access', 'schedule', 'technical', 'other'])],
            'patient_id' => ['prohibited'], 'message' => ['prohibited'], 'description' => ['prohibited'],
            'clinic_id' => ['prohibited']]);
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && Str::isUuid($key), 428, 'أرسل مفتاح محاولة صالحًا.');
        $keyDigest = hash_hmac('sha256', strtolower($key), (string) config('app.key'));
        $fingerprint = hash('sha256', $data['category']);
        $result = DB::transaction(function () use ($request, $authority, $clinic, $data, $keyDigest, $fingerprint): array {
            $authority->actor($request, ['owner']);
            $membershipId = app(TenantContext::class)->membership['id'];
            $existing = DB::table('support_requests')->where('clinic_id', $clinic)->where('opened_by_membership_id', $membershipId)
                ->where('request_key_digest', $keyDigest)->lockForUpdate()->first();
            if ($existing) {
                abort_unless(hash_equals($existing->request_fingerprint, $fingerprint), 409, 'لا تستخدم مفتاح المحاولة لطلب مختلف.');

                return ['id' => $existing->id, 'state' => $existing->state, 'version' => (int) $existing->version, 'replayed' => true];
            }
            $id = (string) Str::uuid();
            DB::table('support_requests')->insert(['id' => $id, 'clinic_id' => $clinic, 'category' => $data['category'],
                'request_key_digest' => $keyDigest, 'request_fingerprint' => $fingerprint,
                'opened_by_membership_id' => $membershipId, 'opened_at' => now()]);
            $authority->audit($request, 'support_opened', 'support', $id, ['version' => 1], 'support_request');

            return ['id' => $id, 'state' => 'open', 'version' => 1, 'replayed' => false];
        }, 3);

        return response()->json($result, 201);
    }
}
