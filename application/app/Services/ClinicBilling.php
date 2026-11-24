<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

class ClinicBilling
{
    public const PERIOD_DAYS = 30;

    public const REJECTION_REASONS = ['partial_amount', 'duplicate_transfer', 'invalid_proof'];

    public function __construct(private ClinicAuthority $authority, private SecurityAudit $audit, private BillingPilot $pilot) {}

    private function paidTerms(string $clinic): Builder
    {
        return DB::table('billing_receipts as r')->join('billing_invoices as i', 'i.id', '=', 'r.invoice_id')
            ->where('i.clinic_id', $clinic)->where('i.state', 'paid');
    }

    public function entitlement(string $clinic): array
    {
        $enrollment = DB::table('billing_enrollments')->where('clinic_id', $clinic)->first();
        $time = CarbonImmutable::now();
        $termEnd = $this->paidTerms($clinic)->where('r.starts_at', '<=', $time)->max('r.ends_at');
        $paidUntil = $termEnd ? CarbonImmutable::parse($termEnd) : null;
        $trialUntil = $enrollment?->trial_ends_at ? CarbonImmutable::parse($enrollment->trial_ends_at) : null;
        $coveredUntil = $paidUntil;
        if ($trialUntil && (! $paidUntil || $trialUntil->gt($paidUntil))) {
            $coveredUntil = $trialUntil;
        }
        $graceUntil = $coveredUntil?->addDays(max(0, (int) config('nobteek.billing.grace_days')));
        $state = match (true) {
            $paidUntil && $paidUntil->gt($time) => 'active',
            $trialUntil && $trialUntil->gt($time) => 'trial',
            $graceUntil && $graceUntil->gt($time) => 'grace',
            default => 'restricted',
        };

        return [
            'state' => $state, 'enrolled' => $enrollment !== null,
            'covered_until' => $coveredUntil?->toIso8601String(), 'grace_until' => $graceUntil?->toIso8601String(),
        ];
    }

    public function requireNewIntake(string $clinic): void
    {
        if (! config('nobteek.billing.enabled') || ! config('nobteek.billing.enforce_access') || ! $this->pilot->includesClinic($clinic)) {
            return;
        }

        DB::table('clinics')->where('id', $clinic)->sharedLock()->firstOrFail(['id']);
        $access = $this->entitlement($clinic);
        abort_if($access['enrolled'] && $access['state'] === 'restricted', 403, 'الحجوزات الجديدة معلقة لدى هذه العيادة. يمكن متابعة الحجوزات والزيارات المسجلة.');
    }

    public function lockClinic(string $clinic): void
    {
        DB::table('clinics')->where('id', $clinic)->where('operational_state', 'active')->lockForUpdate()->firstOrFail(['id']);
    }

    public function issue(Request $request, string $clinic, array $data): array
    {
        return DB::transaction(function () use ($request, $clinic, $data): array {
            $this->authority->actor($request, ['owner']);
            $this->lockClinic($clinic);
            $invoice = DB::table('billing_invoices')->where('clinic_id', $clinic)->where('request_key', $data['request_key'])->first();
            $method = $data['payment_method'] ?? null;
            if ($invoice) {
                $previousDestination = $this->paymentDestination($invoice->payment_destination_ciphertext);
                abort_unless($invoice->plan_code === $data['plan_code'] && ($previousDestination['code'] ?? null) === $method,
                    409, 'استخدم محاولة جديدة لاختيار باقة أو طريقة تحويل مختلفة.');

                return ['id' => $invoice->id, 'state' => $invoice->state, 'replayed' => true];
            }

            $open = DB::table('billing_invoices')->where('clinic_id', $clinic)->whereIn('state', ['issued', 'pending'])->exists();
            abort_if($open, 409, 'أكمل الفاتورة الحالية أو ألغها قبل إصدار فاتورة جديدة.');
            $destination = null;
            if ($this->pilot->enabled()) {
                [$rate, $destination] = $this->pilot->checkout($data['plan_code'], $method);
                DB::table('billing_plans')->insertOrIgnore($rate);
            } else {
                abort_if($method !== null || in_array($data['plan_code'], $this->pilot->codes(), true), 404);
            }
            $plan = DB::table('billing_plans')->where('code', $data['plan_code'])->sharedLock()->firstOrFail();
            if ($destination) {
                abort_unless((int) $plan->amount_minor === $rate['amount_minor'] && $plan->currency === $rate['currency'],
                    409, 'تعذر إصدار الفاتورة. راجع إعداد سعر الاشتراك.');
            }
            $id = (string) Str::uuid();
            DB::table('billing_invoices')->insert([
                'id' => $id, 'clinic_id' => $clinic, 'plan_code' => $plan->code, 'plan_name' => $plan->name,
                'currency' => $plan->currency, 'amount_minor' => $plan->amount_minor, 'request_key' => $data['request_key'], 'issued_at' => now(),
                'payment_destination_ciphertext' => $destination ? Crypt::encryptString(json_encode($destination, JSON_THROW_ON_ERROR)) : null,
            ]);

            return ['id' => $id, 'state' => 'issued', 'replayed' => false];
        }, 3);
    }

    public function paymentDestination(?string $ciphertext): ?array
    {
        return $ciphertext ? json_decode(Crypt::decryptString($ciphertext), true, flags: JSON_THROW_ON_ERROR) : null;
    }

    private function invoice(string $clinic, string $id): stdClass
    {
        $this->lockClinic($clinic);

        return DB::table('billing_invoices')->where('clinic_id', $clinic)->where('id', $id)->lockForUpdate()->firstOrFail();
    }

    public function void(Request $request, string $clinic, string $id): array
    {
        return DB::transaction(function () use ($request, $clinic, $id): array {
            $this->authority->actor($request, ['owner']);
            $invoice = $this->invoice($clinic, $id);
            if ($invoice->state === 'voided') {
                return ['state' => 'voided', 'replayed' => true];
            }

            abort_unless($invoice->state === 'issued', 409, 'يمكن إلغاء الفاتورة المفتوحة قبل إرسال الإثبات أو بعد رفضه.');
            DB::table('billing_invoices')->where('id', $id)->update(['state' => 'voided']);

            return ['state' => 'voided', 'replayed' => false];
        }, 3);
    }

    public function submit(Request $request, string $clinic, string $id, array $data): array
    {
        $upload = $data['attachment'];
        $attachment = $upload->get();
        $reference = strtoupper($data['transfer_reference']);
        $amount = (int) $data['amount_minor'];
        $fingerprint = hash('sha256', json_encode([$reference, $amount, hash('sha256', $attachment)], JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($request, $clinic, $id, $upload, $attachment, $reference, $amount, $fingerprint): array {
            $this->authority->actor($request, ['owner']);
            $invoice = $this->invoice($clinic, $id);
            $previous = DB::table('billing_payment_proofs')->where('invoice_id', $id)->where('fingerprint', $fingerprint)->first(['id', 'state']);
            if ($previous) {
                return ['id' => $previous->id, 'state' => $previous->state, 'replayed' => true];
            }

            abort_unless($invoice->state === 'issued', 409, 'يمكن رفع إثبات لفاتورة مفتوحة فقط.');
            $proof = (string) Str::uuid();
            DB::table('billing_payment_proofs')->insert([
                'id' => $proof, 'invoice_id' => $id, 'transfer_reference' => $reference, 'amount_minor' => $amount,
                'attachment_ciphertext' => Crypt::encryptString(base64_encode($attachment)), 'attachment_extension' => $upload->extension(),
                'fingerprint' => $fingerprint, 'submitted_at' => now(),
            ]);
            DB::table('billing_invoices')->where('id', $id)->update(['state' => 'pending']);

            return ['id' => $proof, 'state' => 'submitted', 'replayed' => false];
        }, 3);
    }

    public function review(Request $request, string $proofId, bool $approve, array $data): array
    {
        return DB::transaction(function () use ($request, $proofId, $approve, $data): array {
            $actor = $this->authority->platform($request);
            $target = DB::table('billing_payment_proofs as p')->join('billing_invoices as i', 'i.id', '=', 'p.invoice_id')
                ->where('p.id', $proofId)->firstOrFail(['i.id', 'i.clinic_id']);
            $invoice = $this->invoice($target->clinic_id, $target->id);
            $proof = DB::table('billing_payment_proofs')->where('id', $proofId)->firstOrFail(['state', 'transfer_reference', 'amount_minor', 'rejection_reason']);
            $state = $approve ? 'approved' : 'rejected';

            if ($approve) {
                if ($invoice->payment_destination_ciphertext) {
                    abort_unless(($data['verified_currency'] ?? null) === $invoice->currency,
                        409, 'تحقّق من وصول المبلغ بنفس عملة الفاتورة.');
                }
                abort_unless(strtoupper($data['verified_transfer_reference']) === $proof->transfer_reference, 409, 'مرجع التحويل المثبت مختلف عن المرجع المرسل.');
                abort_unless((int) $data['verified_amount_minor'] === (int) $invoice->amount_minor
                    && (int) $proof->amount_minor === (int) $invoice->amount_minor, 409, 'المبلغ المثبت يجب أن يطابق قيمة الفاتورة.');
            }

            if (($approve && in_array($proof->state, ['approved', 'refunded'], true))
                || (! $approve && $proof->state === 'rejected' && $proof->rejection_reason === $data['reason'])) {
                return ['state' => $proof->state, 'replayed' => true];
            }

            abort_unless($invoice->state === 'pending' && $proof->state === 'submitted', 409, 'تغيرت حالة الفاتورة أو الإثبات. حدّث القائمة.');
            if ($approve) {
                $this->grantTerm($invoice, $proofId, $proof->transfer_reference);
            }
            DB::table('billing_payment_proofs')->where('id', $proofId)->update([
                'state' => $state, 'rejection_reason' => $data['reason'] ?? null,
                'reviewed_at' => now(), 'reviewed_by' => $actor->id,
            ]);
            DB::table('billing_invoices')->where('id', $invoice->id)->update(['state' => $approve ? 'paid' : 'issued']);
            $this->audit->record('billing_proof_'.$state, $actor->id, clinic: $invoice->clinic_id, request: $request);

            return ['state' => $state, 'replayed' => false];
        }, 3);
    }

    private function grantTerm(stdClass $invoice, string $proof, string $reference): void
    {
        $time = CarbonImmutable::now();
        $clinic = $invoice->clinic_id;
        $startsAt = $time;
        $paidUntil = $this->paidTerms($clinic)->max('r.ends_at');
        $trialUntil = DB::table('billing_enrollments')->where('clinic_id', $clinic)->value('trial_ends_at');
        foreach (array_filter([$paidUntil, $trialUntil]) as $until) {
            $startsAt = $startsAt->max(CarbonImmutable::parse($until));
        }

        $created = DB::table('billing_receipts')->insertOrIgnore([
            'invoice_id' => $invoice->id, 'proof_id' => $proof, 'transfer_reference' => $reference,
            'approved_at' => $time, 'starts_at' => $startsAt, 'ends_at' => $startsAt->addDays(self::PERIOD_DAYS),
        ]);
        abort_unless($created === 1, 409, 'سبق اعتماد هذا المرجع في إيصال آخر.');
        DB::table('billing_enrollments')->insertOrIgnore(['clinic_id' => $clinic]);
    }

    public function refund(Request $request, string $id, string $reference): array
    {
        return DB::transaction(function () use ($request, $id, $reference): array {
            $actor = $this->authority->platform($request);
            $clinic = DB::table('billing_invoices')->where('id', $id)->firstOrFail(['clinic_id'])->clinic_id;
            $invoice = $this->invoice($clinic, $id);
            $record = DB::table('billing_refunds')->where('invoice_id', $id)->first();
            if ($record) {
                abort_unless($record->refund_reference === $reference, 409, 'سُجل استرداد هذه الفاتورة بمرجع آخر.');

                return ['state' => 'refunded', 'replayed' => true];
            }

            abort_unless($invoice->state === 'paid', 409, 'الاسترداد متاح لفاتورة مدفوعة.');
            $receipt = DB::table('billing_receipts')->where('invoice_id', $id)->firstOrFail();
            $laterTerm = $this->paidTerms($clinic)->where('r.starts_at', '>=', $receipt->ends_at)->exists();
            abort_if(CarbonImmutable::parse($receipt->ends_at)->gt(now()) && $laterTerm, 409, 'ابدأ باسترداد التجديد الأحدث إذا أردت إلغاء فترة سارية أو مستقبلية.');

            $created = DB::table('billing_refunds')->insertOrIgnore([
                'invoice_id' => $id, 'recorded_by' => $actor->id, 'refund_reference' => $reference, 'completed_at' => now(),
            ]);
            abort_unless($created === 1, 409, 'سبق تسجيل مرجع الاسترداد.');
            DB::table('billing_payment_proofs')->where('id', $receipt->proof_id)->update(['state' => 'refunded']);
            DB::table('billing_invoices')->where('id', $id)->update(['state' => 'refunded']);
            $this->audit->record('billing_refund_completed', $actor->id, clinic: $clinic, request: $request);

            return ['state' => 'refunded', 'replayed' => false];
        }, 3);
    }
}
