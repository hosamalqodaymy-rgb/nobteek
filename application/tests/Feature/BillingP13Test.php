<?php

namespace Tests\Feature;

use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\Group;
use Tests\DoctorTestCase;

#[Group('postgres')]
class BillingP13Test extends DoctorTestCase
{
    private const AMOUNT = 12000;

    private const PROOF_CONTENT = "%PDF-1.4\nSynthetic transfer evidence\n%%EOF";

    protected function setUp(): void
    {
        parent::setUp();
        config(['nobteek.billing.enabled' => true]);
    }

    private function createPlan(): void
    {
        $this->signIn('PLATFORM', true);
        $this->postJson('/platform/billing/plans', [
            'code' => 'synthetic-month', 'name' => 'باقة اختبار صناعية', 'currency' => 'YER', 'amount_minor' => self::AMOUNT,
        ])->assertCreated();
    }

    private function issue(?string $key = null): TestResponse
    {
        return $this->postJson('/v1/billing/invoices', ['plan_code' => 'synthetic-month', 'request_key' => $key ?? (string) Str::uuid()]);
    }

    private function proof(string $invoice, string $reference = 'SYNTHETIC-TRANSFER-1', int $amount = self::AMOUNT): TestResponse
    {
        return $this->post('/v1/billing/invoices/'.$invoice.'/proofs', [
            'transfer_reference' => $reference, 'amount_minor' => $amount,
            'attachment' => UploadedFile::fake()->createWithContent('synthetic.pdf', self::PROOF_CONTENT),
        ], ['Accept' => 'application/json']);
    }

    private function approve(string $proof, string $reference = 'SYNTHETIC-TRANSFER-1', int $verified = self::AMOUNT): TestResponse
    {
        return $this->postJson('/v1/payment-proofs/'.$proof.'/approve', [
            'verified_amount_minor' => $verified, 'verified_transfer_reference' => $reference,
        ]);
    }

    private function reject(string $proof, string $reason): TestResponse
    {
        return $this->postJson('/v1/payment-proofs/'.$proof.'/reject', ['reason' => $reason]);
    }

    private function refund(string $invoice, string $reference, bool $confirmed = true): TestResponse
    {
        return $this->postJson('/v1/billing/invoices/'.$invoice.'/refund', ['refund_reference' => $reference, 'confirmed' => $confirmed]);
    }

    private function assertAccess(string $state, ?string $date = null): void
    {
        $this->get('/workspace/billing')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Billing')->where('mode', 'owner')->where('access.state', $state)
            ->when($date !== null, fn (AssertableInertia $props) => $props->where('access.covered_until', $date))
        );
    }

    public function test_pending_proof_stays_inactive_and_repeated_approval_grants_one_thirty_day_term(): void
    {
        $this->createPlan();
        $this->owner();
        $key = (string) Str::uuid();
        $invoice = $this->issue($key)->assertCreated()->json('id');
        $this->issue($key)->assertOk()->assertJsonPath('id', $invoice)->assertJsonPath('replayed', true);
        $this->issue()->assertConflict();
        $proof = $this->proof($invoice)->assertCreated()->json('id');
        $this->proof($invoice, 'synthetic-transfer-1')->assertOk()->assertJsonPath('id', $proof)->assertJsonPath('replayed', true);
        $this->assertAccess('restricted');
        $this->assertDatabaseCount('billing_receipts', 0);
        $this->assertDatabaseCount('billing_enrollments', 0);
        $this->assertDatabaseHas('billing_invoices', ['id' => $invoice, 'state' => 'pending']);

        $this->signIn('PLATFORM', true);
        $this->get('/platform/billing')->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Billing')->where('mode', 'platform')->where('invoices.data.0.id', $invoice)
            ->where('invoices.data.0.proofs.0.id', $proof)->missing('invoices.data.0.proofs.0.attachment_ciphertext'));
        $this->approve($proof, 'DIFFERENT-REFERENCE')->assertConflict();
        $this->approve($proof)->assertOk()->assertJsonPath('replayed', false);
        $this->approve($proof)->assertOk()->assertJsonPath('replayed', true);
        $this->assertDatabaseCount('billing_receipts', 1);
        $this->assertDatabaseCount('billing_payment_proofs', 1);
        $this->assertDatabaseHas('billing_invoices', ['id' => $invoice, 'state' => 'paid']);
        $this->assertSame(1, DB::table('security_events')->where('event_type', 'billing_proof_approved')->count());
        $this->owner();
        $this->assertAccess('active', now()->addDays(30)->toIso8601String());
    }

    public function test_partial_and_duplicate_transfers_do_not_create_another_receipt(): void
    {
        $this->createPlan();
        $this->owner();
        $invoice = $this->issue()->assertCreated()->json('id');
        $partial = $this->proof($invoice, 'PARTIAL-TRANSFER', 100)->assertCreated()->json('id');
        $this->signIn('PLATFORM', true);
        $this->approve($partial, 'PARTIAL-TRANSFER', 100)->assertConflict();
        $this->approve($partial, 'PARTIAL-TRANSFER')->assertConflict();
        $this->reject($partial, 'partial_amount')->assertOk()->assertJsonPath('replayed', false);
        $this->reject($partial, 'partial_amount')->assertOk()->assertJsonPath('replayed', true);
        $this->assertDatabaseCount('billing_receipts', 0);

        $this->owner();
        $valid = $this->proof($invoice)->assertCreated()->json('id');
        $this->signIn('PLATFORM', true);
        $this->approve($valid)->assertOk();

        $this->signIn('OWNER_B', true);
        $secondInvoice = $this->issue()->assertCreated()->json('id');
        $duplicate = $this->proof($secondInvoice)->assertCreated()->json('id');
        $this->signIn('PLATFORM', true);
        $this->approve($duplicate)->assertConflict();
        $this->reject($duplicate, 'duplicate_transfer')->assertOk();
        $this->assertDatabaseCount('billing_receipts', 1);
        $this->assertDatabaseHas('billing_invoices', ['id' => $secondInvoice, 'state' => 'issued']);
        $this->assertDatabaseHas('billing_payment_proofs', ['id' => $partial, 'state' => 'rejected', 'rejection_reason' => 'partial_amount']);
        $this->assertDatabaseHas('billing_payment_proofs', ['id' => $duplicate, 'state' => 'rejected', 'rejection_reason' => 'duplicate_transfer']);
        $this->assertFalse(config('nobteek.external_payments'));
    }

    public function test_renewal_and_full_refund_each_apply_once_and_retain_the_receipt(): void
    {
        $this->createPlan();
        $this->owner();
        $first = $this->issue()->assertCreated()->json('id');
        $proof = $this->proof($first)->assertCreated()->json('id');
        $this->signIn('PLATFORM', true);
        $this->approve($proof)->assertOk();
        $time = CarbonImmutable::now();

        $this->travel(2)->days();
        $this->owner();
        $renewal = $this->issue()->assertCreated()->json('id');
        $renewalProof = $this->proof($renewal, 'SYNTHETIC-RENEWAL')->assertCreated()->json('id');
        $this->signIn('PLATFORM', true);
        $this->approve($renewalProof, 'SYNTHETIC-RENEWAL')->assertOk();
        $this->approve($renewalProof, 'SYNTHETIC-RENEWAL')->assertOk()->assertJsonPath('replayed', true);
        $term = DB::table('billing_receipts')->where('invoice_id', $renewal)->first();
        $this->assertTrue(CarbonImmutable::parse($term->starts_at)->eq($time->addDays(30)));
        $this->assertTrue(CarbonImmutable::parse($term->ends_at)->eq($time->addDays(60)));

        $this->refund($first, 'SYNTHETIC-REFUND-1')->assertConflict();
        $this->refund($renewal, 'SYNTHETIC-REFUND-2', false)->assertUnprocessable();
        $this->refund($renewal, 'SYNTHETIC-REFUND-2')->assertOk()->assertJsonPath('replayed', false);
        $this->refund($renewal, 'synthetic-refund-2')->assertOk()->assertJsonPath('replayed', true);
        $this->refund($renewal, 'DIFFERENT-REFUND')->assertConflict();
        $this->approve($renewalProof, 'SYNTHETIC-RENEWAL')->assertOk()->assertJsonPath('state', 'refunded')->assertJsonPath('replayed', true);
        $this->assertDatabaseCount('billing_receipts', 2);
        $this->assertDatabaseCount('billing_refunds', 1);
        $this->assertDatabaseHas('billing_payment_proofs', ['id' => $renewalProof, 'state' => 'refunded']);
        $this->assertDatabaseHas('billing_invoices', ['id' => $renewal, 'state' => 'refunded', 'amount_minor' => self::AMOUNT]);
        $this->assertSame(1, DB::table('security_events')->where('event_type', 'billing_refund_completed')->count());
        $this->owner();
        $this->assertAccess('active', $time->addDays(30)->toIso8601String());
    }

    public function test_proofs_require_the_correct_role_clinic_and_recent_platform_verification(): void
    {
        $this->createPlan();
        $this->owner();
        $invoice = $this->issue()->assertCreated()->json('id');
        $proof = $this->proof($invoice)->assertCreated()->json('id');
        $this->getJson('/v1/billing/proofs/'.$proof)->assertOk()->assertHeader('Content-Disposition', 'attachment; filename="transfer-proof.pdf"')
            ->assertHeader('X-Content-Type-Options', 'nosniff')->assertContent(self::PROOF_CONTENT);
        $this->assertStringNotContainsString('Synthetic transfer evidence', DB::table('billing_payment_proofs')->where('id', $proof)->value('attachment_ciphertext'));
        $this->approve($proof)->assertForbidden();

        $this->signIn('OWNER_B', true);
        $this->get('/workspace/billing')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->has('invoices.data', 0));
        $this->getJson('/v1/billing/proofs/'.$proof)->assertNotFound();
        $this->proof($invoice)->assertNotFound();

        $this->signIn('RECEPTION_A');
        $this->getJson('/workspace/billing')->assertForbidden();
        $this->getJson('/v1/billing/proofs/'.$proof)->assertForbidden();

        $this->signIn('PLATFORM', true);
        $this->withSession(['auth_confirmed_at' => now()->subMinutes(11)->timestamp]);
        $this->getJson('/platform/billing/proofs/'.$proof)->assertStatus(423);
        $this->approve($proof)->assertStatus(423);
        $this->signIn('PLATFORM', true);
        $this->getJson('/platform/billing/proofs/'.$proof)->assertOk()->assertContent(self::PROOF_CONTENT);

        config(['nobteek.billing.enabled' => false]);
        $this->getJson('/platform/billing')->assertNotFound();
        $this->approve($proof)->assertNotFound();
    }

    public function test_trial_and_grace_boundaries_do_not_regrant_access_on_retry(): void
    {
        $clinic = $this->id('CLINIC_B');
        $this->signIn('PLATFORM', true);
        $this->postJson('/platform/billing/trials', ['clinic_id' => $clinic, 'days' => 5])->assertCreated();
        $this->postJson('/platform/billing/trials', ['clinic_id' => $clinic, 'days' => 3])->assertConflict();
        $expires = CarbonImmutable::now()->addDays(5);
        $this->signIn('OWNER_B', true);
        $this->assertAccess('trial', $expires->toIso8601String());
        $this->travelTo($expires);
        $this->signIn('OWNER_B', true);
        $this->assertAccess('grace', $expires->toIso8601String());

        $this->travelTo($expires->addDays(7));
        $this->signIn('PLATFORM', true);
        $this->postJson('/platform/billing/trials', ['clinic_id' => $clinic, 'days' => 5])->assertOk()->assertJsonPath('replayed', true);
        $this->signIn('OWNER_B', true);
        $this->assertAccess('restricted', $expires->toIso8601String());
    }

    public function test_expiration_blocks_new_intake_and_allows_a_started_visit_to_finish(): void
    {
        config(['nobteek.billing.enforce_access' => true, 'nobteek.billing.grace_days' => 0]);
        $clinic = $this->id('CLINIC_A');
        DB::table('billing_enrollments')->insert(['clinic_id' => $clinic, 'trial_ends_at' => now()->addMinutes(3), 'trial_days' => 1]);
        $visit = $this->arrivedVisit();
        $this->doctor();
        $this->callNext()->assertOk()->assertJsonPath('id', $visit);
        $this->doctorAction($visit, 'start')->assertOk()->assertJsonPath('state', 'in_service');
        $this->travel(3)->minutes();

        $this->owner();
        $this->walkIn()->assertForbidden();
        $this->postJson('/v1/booking-requests', [
            'session_id' => $this->id('SESSION_C'), 'window_id' => $this->id('W1_C'),
            'display_name' => 'مراجع صناعي', 'contact_phone' => '+967700000099', 'source' => 'phone',
        ], $this->headers())->assertForbidden();
        $this->doctor();
        $this->doctorAction($visit, 'complete')->assertOk()->assertJsonPath('state', 'completed');
        $this->assertDatabaseHas('bookings', ['id' => $this->id('BOOK_C1'), 'state' => 'fulfilled']);
    }

    public function test_wrong_file_and_voided_invoice_do_not_create_financial_entries(): void
    {
        $this->createPlan();
        $this->owner();
        $invoice = $this->issue()->assertCreated()->json('id');
        $this->post('/v1/billing/invoices/'.$invoice.'/proofs', [
            'transfer_reference' => 'SYNTHETIC-SAMPLE', 'amount_minor' => self::AMOUNT,
            'attachment' => UploadedFile::fake()->createWithContent('sample.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('attachment');
        $this->postJson('/v1/billing/invoices/'.$invoice.'/void')->assertOk()->assertJsonPath('replayed', false);
        $this->postJson('/v1/billing/invoices/'.$invoice.'/void')->assertOk()->assertJsonPath('replayed', true);
        $this->proof($invoice)->assertConflict();
        $this->assertDatabaseCount('billing_payment_proofs', 0);
        $this->assertDatabaseCount('billing_receipts', 0);
        $this->issue()->assertCreated();
    }
}
