<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_plans', function (Blueprint $table): void {
            $table->string('code', 40)->primary();
            $table->string('name', 120);
            $table->char('currency', 3);
            $table->unsignedBigInteger('amount_minor');
        });

        Schema::create('billing_enrollments', function (Blueprint $table): void {
            $table->foreignUuid('clinic_id')->primary()->constrained('clinics');
            $table->timestampTz('trial_ends_at')->nullable();
            $table->unsignedSmallInteger('trial_days')->nullable();
        });

        Schema::create('billing_invoices', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('clinic_id')->constrained('clinics');
            $table->string('plan_code', 40);
            $table->foreign('plan_code')->references('code')->on('billing_plans');
            $table->string('plan_name', 120);
            $table->char('currency', 3);
            $table->unsignedBigInteger('amount_minor');
            $table->uuid('request_key');
            $table->string('state', 12)->default('issued');
            $table->timestampTz('issued_at');
            $table->unique(['clinic_id', 'request_key']);
            $table->index(['clinic_id', 'issued_at']);
        });

        Schema::create('billing_payment_proofs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('invoice_id')->constrained('billing_invoices');
            $table->string('transfer_reference', 80);
            $table->unsignedBigInteger('amount_minor');
            $table->text('attachment_ciphertext');
            $table->string('attachment_extension', 4);
            $table->char('fingerprint', 64);
            $table->string('state', 12)->default('submitted');
            $table->string('rejection_reason', 30)->nullable();
            $table->timestampTz('submitted_at');
            $table->timestampTz('reviewed_at')->nullable();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users');
            $table->index(['invoice_id', 'submitted_at']);
            $table->unique(['invoice_id', 'fingerprint']);
        });

        Schema::create('billing_receipts', function (Blueprint $table): void {
            $table->foreignUuid('invoice_id')->primary()->constrained('billing_invoices');
            $table->foreignUuid('proof_id')->unique()->constrained('billing_payment_proofs');
            $table->string('transfer_reference', 80)->unique();
            $table->timestampTz('approved_at');
            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at');
        });

        Schema::create('billing_refunds', function (Blueprint $table): void {
            $table->foreignUuid('invoice_id')->primary()->constrained('billing_receipts', 'invoice_id');
            $table->foreignUuid('recorded_by')->constrained('users');
            $table->string('refund_reference', 80)->unique();
            $table->timestampTz('completed_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_refunds');
        Schema::dropIfExists('billing_receipts');
        Schema::dropIfExists('billing_payment_proofs');
        Schema::dropIfExists('billing_invoices');
        Schema::dropIfExists('billing_enrollments');
        Schema::dropIfExists('billing_plans');
    }
};
