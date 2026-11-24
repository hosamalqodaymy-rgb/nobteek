<?php

namespace App\Http\Controllers;

use App\Services\BillingPilot;
use App\Services\ClinicAuthority;
use App\Services\ClinicBilling;
use App\Services\SecurityAudit;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;

class BillingController extends Controller
{
    private const REFERENCE = '/^[a-zA-Z0-9][a-zA-Z0-9_\/-]{3,79}$/D';

    private const MONEY = ['required', 'integer', 'min:1', 'max:999999999999'];

    public function __construct(private ClinicBilling $billing, private ClinicAuthority $authority, private SecurityAudit $audit, private BillingPilot $pilot) {}

    private function clinic(): string
    {
        abort_unless(config('nobteek.billing.enabled'), 404);
        $context = app(TenantContext::class);
        abort_unless($context->role() === 'owner', 403);

        $clinic = $context->clinicId();
        abort_unless($this->pilot->includesClinic($clinic), 404);

        return $clinic;
    }

    private function platform(Request $request): void
    {
        abort_unless(config('nobteek.billing.enabled'), 404);
        abort_unless($request->user()->platform_role === 'platform_admin', 403);
    }

    public function ownerPage(): InertiaResponse
    {
        $clinic = $this->clinic();

        return Inertia::render('Billing', [
            'mode' => 'owner',
            'plans' => $this->pilot->enabled() ? $this->pilot->rates() : $this->customPlans(),
            'pilot' => $this->pilot->enabled(),
            'access' => $this->billing->entitlement($clinic),
            'access_enforced' => config('nobteek.billing.enforce_access'),
            'invoices' => $this->invoices($clinic),
            'has_open_invoice' => DB::table('billing_invoices')->where('clinic_id', $clinic)->whereIn('state', ['issued', 'pending'])->exists(),
            'issue_url' => route('billing.issue'),
            'period_days' => ClinicBilling::PERIOD_DAYS,
        ]);
    }

    public function platformPage(Request $request): InertiaResponse
    {
        $this->platform($request);

        return Inertia::render('Billing', [
            'mode' => 'platform',
            'plans' => $this->pilot->enabled() ? $this->pilot->rates() : $this->customPlans(),
            'pilot' => $this->pilot->enabled(),
            'invoices' => $this->invoices(null),
            'clinics' => DB::table('clinics')->where('operational_state', 'active')
                ->when($this->pilot->enabled(), fn (Builder $query) => $query->where('id', config('nobteek.billing.pilot.clinic_id')))
                ->orderBy('display_name')->get(['id', 'display_name']),
            'plan_url' => $this->pilot->enabled() ? null : route('platform.billing.plan'),
            'trial_url' => route('platform.billing.trial'),
            'period_days' => ClinicBilling::PERIOD_DAYS,
        ]);
    }

    private function customPlans(): Collection
    {
        return DB::table('billing_plans')->whereNotIn('code', $this->pilot->codes())->orderBy('code')->get();
    }

    private function invoices(?string $clinic): array
    {
        $rows = DB::table('billing_invoices as i')
            ->join('clinics as c', 'c.id', '=', 'i.clinic_id')
            ->leftJoin('billing_receipts as r', 'r.invoice_id', '=', 'i.id')
            ->leftJoin('billing_refunds as f', 'f.invoice_id', '=', 'i.id')
            ->when($clinic, fn (Builder $query, string $id) => $query->where('i.clinic_id', $id))
            ->orderByRaw("case when i.state = 'pending' then 0 when i.state = 'issued' then 1 else 2 end")
            ->orderByDesc('i.issued_at')->orderBy('i.id')
            ->paginate(20, ['i.id', 'i.plan_name', 'i.currency', 'i.amount_minor', 'i.state', 'i.issued_at', 'i.payment_destination_ciphertext',
                'c.display_name as clinic_name', 'r.approved_at', 'r.starts_at', 'r.ends_at', 'f.completed_at as refunded_at']);

        $proofs = DB::table('billing_payment_proofs')->whereIn('invoice_id', $rows->getCollection()->pluck('id'))
            ->orderByDesc('submitted_at')->orderBy('id')
            ->get(['invoice_id', 'id', 'state', 'amount_minor', 'transfer_reference', 'rejection_reason'])->groupBy('invoice_id');

        return $rows->through(function ($invoice) use ($clinic, $proofs) {
            foreach (['issued_at', 'approved_at', 'starts_at', 'ends_at', 'refunded_at'] as $date) {
                $invoice->{$date} = $invoice->{$date} ? CarbonImmutable::parse($invoice->{$date})->toIso8601String() : null;
            }
            if (in_array($invoice->state, ['issued', 'pending'], true)) {
                $invoice->payment_destination = $this->billing->paymentDestination($invoice->payment_destination_ciphertext);
            }
            unset($invoice->payment_destination_ciphertext);
            $invoice->proofs = $proofs->get($invoice->id, collect())->map(function ($proof) use ($clinic) {
                $proof->download_url = route($clinic ? 'billing.proof.download' : 'platform.billing.proof.download', ['proof' => $proof->id]);
                if (! $clinic && $proof->state === 'submitted') {
                    $proof->approve_url = route('platform.billing.proof.approve', ['proof' => $proof->id]);
                    $proof->reject_url = route('platform.billing.proof.reject', ['proof' => $proof->id]);
                }

                return $proof;
            });
            if ($clinic && $invoice->state === 'issued') {
                $invoice->submit_url = route('billing.proof.submit', ['invoice' => $invoice->id]);
                $invoice->void_url = route('billing.void', ['invoice' => $invoice->id]);
            }
            if (! $clinic && $invoice->state === 'paid') {
                $invoice->refund_url = route('platform.billing.refund', ['invoice' => $invoice->id]);
            }

            return $invoice;
        })->toArray();
    }

    public function issue(Request $request): JsonResponse
    {
        $clinic = $this->clinic();
        $data = $request->validate([
            'plan_code' => ['required', 'string', 'max:40'], 'request_key' => ['required', 'uuid'],
            'payment_method' => ['nullable', 'string', 'max:16'],
        ]);
        $data['request_key'] = strtolower($data['request_key']);
        $result = $this->billing->issue($request, $clinic, $data);

        return response()->json($result, $result['replayed'] ? 200 : 201);
    }

    public function void(Request $request, string $invoice): JsonResponse
    {
        return response()->json($this->billing->void($request, $this->clinic(), $invoice));
    }

    public function submit(Request $request, string $invoice): JsonResponse
    {
        $clinic = $this->clinic();
        $data = $request->validate([
            'transfer_reference' => ['required', 'string', 'regex:'.self::REFERENCE],
            'amount_minor' => self::MONEY,
            'attachment' => ['required', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:2048'],
        ]);
        $result = $this->billing->submit($request, $clinic, $invoice, $data);

        return response()->json($result, $result['replayed'] ? 200 : 201);
    }

    public function ownerDownload(string $proof): Response
    {
        return $this->download($proof, $this->clinic());
    }

    public function platformDownload(Request $request, string $proof): Response
    {
        $this->platform($request);

        return DB::transaction(function () use ($request, $proof): Response {
            $this->authority->platform($request);

            return $this->download($proof, null);
        }, 3);
    }

    private function download(string $proof, ?string $clinic): Response
    {
        $record = DB::table('billing_payment_proofs as p')->join('billing_invoices as i', 'i.id', '=', 'p.invoice_id')->where('p.id', $proof)
            ->when($clinic, fn (Builder $query, string $id) => $query->where('i.clinic_id', $id))
            ->firstOrFail(['p.attachment_ciphertext', 'p.attachment_extension']);

        return response(base64_decode(Crypt::decryptString($record->attachment_ciphertext), true), 200, [
            'Content-Type' => 'application/octet-stream',
            'Content-Disposition' => 'attachment; filename="transfer-proof.'.$record->attachment_extension.'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function approve(Request $request, string $proof): JsonResponse
    {
        $this->platform($request);
        $data = $request->validate([
            'verified_amount_minor' => self::MONEY,
            'verified_currency' => ['nullable', 'string', 'regex:/^[A-Z]{3}$/D'],
            'verified_transfer_reference' => ['required', 'string', 'regex:'.self::REFERENCE],
        ]);

        return response()->json($this->billing->review($request, $proof, true, $data));
    }

    public function reject(Request $request, string $proof): JsonResponse
    {
        $this->platform($request);
        $data = $request->validate(['reason' => ['required', Rule::in(ClinicBilling::REJECTION_REASONS)]]);

        return response()->json($this->billing->review($request, $proof, false, $data));
    }

    public function refund(Request $request, string $invoice): JsonResponse
    {
        $this->platform($request);
        $data = $request->validate(['refund_reference' => ['required', 'string', 'regex:'.self::REFERENCE], 'confirmed' => ['accepted']]);

        return response()->json($this->billing->refund($request, $invoice, strtoupper($data['refund_reference'])));
    }

    public function plan(Request $request): JsonResponse
    {
        $this->platform($request);
        abort_if($this->pilot->enabled(), 403);
        $data = $request->validate([
            'code' => ['required', 'string', 'regex:/^[a-z0-9-]{2,40}$/D'],
            'name' => ['required', 'string', 'max:120'],
            'currency' => ['required', 'string', 'regex:/^[A-Z]{3}$/D'],
            'amount_minor' => self::MONEY,
        ]);
        $result = DB::transaction(function () use ($request, $data): array {
            $actor = $this->authority->platform($request);
            abort_if(in_array($data['code'], $this->pilot->codes(), true), 422);
            $created = DB::table('billing_plans')->insertOrIgnore($data) === 1;
            $existing = DB::table('billing_plans')->where('code', $data['code'])->firstOrFail();
            abort_unless($existing->name === $data['name'] && $existing->currency === $data['currency']
                && (int) $existing->amount_minor === (int) $data['amount_minor'], 409, 'رمز الباقة مستخدم لإعداد مختلف.');
            if ($created) {
                $this->audit->record('billing_plan_created', $actor->id, request: $request);
            }

            return ['replayed' => ! $created];
        }, 3);

        return response()->json($result, $result['replayed'] ? 200 : 201);
    }

    public function trial(Request $request): JsonResponse
    {
        $this->platform($request);
        $data = $request->validate(['clinic_id' => ['required', 'uuid'], 'days' => ['required', 'integer', 'min:1', 'max:90']]);
        $result = DB::transaction(function () use ($request, $data): array {
            $actor = $this->authority->platform($request);
            abort_unless($this->pilot->includesClinic($data['clinic_id']), 404);
            $this->billing->lockClinic($data['clinic_id']);
            $existing = DB::table('billing_enrollments')->where('clinic_id', $data['clinic_id'])->first();
            if ($existing) {
                abort_unless($existing->trial_days !== null && (int) $existing->trial_days === (int) $data['days'], 409, 'سبق تسجيل اشتراك أو تجربة لهذه العيادة.');

                return ['replayed' => true];
            }
            DB::table('billing_enrollments')->insert(['clinic_id' => $data['clinic_id'], 'trial_days' => $data['days'],
                'trial_ends_at' => CarbonImmutable::now()->addDays((int) $data['days'])]);
            $this->audit->record('billing_trial_started', $actor->id, clinic: $data['clinic_id'], request: $request);

            return ['replayed' => false];
        }, 3);

        return response()->json($result, $result['replayed'] ? 200 : 201);
    }
}
