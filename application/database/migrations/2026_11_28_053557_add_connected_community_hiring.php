<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('community_job_profiles', function (Blueprint $table): void {
            $table->foreignUuid('user_id')->primary()->constrained('users')->restrictOnDelete();
            $table->string('name', 60);
            $table->string('profession', 20);
            $table->string('specialty', 70);
            $table->string('area', 60);
            $table->unsignedSmallInteger('experience');
            $table->string('bio', 450)->nullable();
            $table->string('cv_name', 100)->nullable();
            $table->timestampsTz();
        });

        Schema::create('community_job_adverts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('publisher_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUuid('publisher_clinic_id')->nullable()->constrained('clinics')->restrictOnDelete();
            $table->string('kind', 12);
            $table->string('title', 90);
            $table->string('profession', 20);
            $table->string('specialty', 70);
            $table->string('area', 60);
            $table->string('branch', 80)->nullable();
            $table->string('work_type', 12);
            $table->date('deadline');
            $table->string('description', 700);
            $table->string('requirements', 400)->nullable();
            $table->string('state', 12);
            $table->string('review_note', 160)->nullable();
            $table->foreignUuid('reviewer_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('reviewed_at')->nullable();
            $table->timestampsTz();
            $table->index(['kind', 'state', 'deadline']);
            $table->index(['publisher_user_id', 'state']);
            $table->index(['publisher_clinic_id', 'state']);
        });
        DB::statement("ALTER TABLE community_job_adverts ADD CONSTRAINT job_advert_publisher CHECK ((kind = 'seeker' AND publisher_user_id IS NOT NULL AND publisher_clinic_id IS NULL) OR (kind = 'vacancy' AND publisher_user_id IS NULL AND publisher_clinic_id IS NOT NULL))");
        DB::statement("ALTER TABLE community_job_adverts ADD CONSTRAINT job_advert_state CHECK (state IN ('pending', 'published', 'revision', 'rejected', 'closed'))");

        Schema::create('community_job_cases', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('advert_id')->constrained('community_job_adverts')->restrictOnDelete();
            $table->foreignUuid('candidate_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('clinic_id')->constrained('clinics')->restrictOnDelete();
            $table->string('state', 12);
            $table->jsonb('profile_snapshot')->nullable();
            $table->string('candidate_message', 450)->nullable();
            $table->string('invitation_message', 450)->nullable();
            $table->date('interview_on')->nullable();
            $table->string('interview_location', 100)->nullable();
            $table->date('starts_on')->nullable();
            $table->string('offer_details', 450)->nullable();
            $table->timestampTz('candidate_started_at')->nullable();
            $table->timestampTz('employer_started_at')->nullable();
            $table->timestampsTz();
            $table->unique(['advert_id', 'candidate_id', 'clinic_id']);
            $table->index(['candidate_id', 'updated_at']);
            $table->index(['clinic_id', 'updated_at']);
        });
        DB::statement("ALTER TABLE community_job_cases ADD CONSTRAINT job_case_state CHECK (state IN ('invited', 'applied', 'shortlisted', 'interview', 'offered', 'accepted', 'hired', 'declined'))");
        DB::statement("ALTER TABLE community_job_cases ADD CONSTRAINT job_case_consent CHECK (state IN ('invited', 'declined') OR profile_snapshot IS NOT NULL)");
        DB::statement("ALTER TABLE community_job_cases ADD CONSTRAINT job_case_start CHECK ((starts_on IS NULL OR (interview_on IS NOT NULL AND starts_on >= interview_on)) AND (state <> 'hired' OR (candidate_started_at IS NOT NULL AND employer_started_at IS NOT NULL)))");

        Schema::create('community_hiring_fees', function (Blueprint $table): void {
            $table->foreignUuid('case_id')->primary()->constrained('community_job_cases')->restrictOnDelete();
            $table->string('billed_role', 12);
            $table->unsignedInteger('amount_cents')->default(5000);
            $table->char('currency', 3)->default('USD');
            $table->boolean('simulated')->default(true);
            $table->timestampTz('issued_at');
        });
        DB::statement("ALTER TABLE community_hiring_fees ADD CONSTRAINT hiring_fee_simulation CHECK (simulated AND amount_cents = 5000 AND currency = 'USD' AND billed_role IN ('candidate', 'employer'))");

        Schema::create('community_job_bookmarks', function (Blueprint $table): void {
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('advert_id')->constrained('community_job_adverts')->cascadeOnDelete();
            $table->timestampTz('created_at');
            $table->primary(['user_id', 'advert_id']);
        });

        Schema::create('community_job_reports', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('advert_id')->constrained('community_job_adverts')->restrictOnDelete();
            $table->string('reason', 250);
            $table->foreignUuid('reviewer_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('reviewed_at')->nullable()->index();
            $table->timestampTz('created_at');
            $table->unique(['user_id', 'advert_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('community_job_reports');
        Schema::dropIfExists('community_job_bookmarks');
        Schema::dropIfExists('community_hiring_fees');
        Schema::dropIfExists('community_job_cases');
        Schema::dropIfExists('community_job_adverts');
        Schema::dropIfExists('community_job_profiles');
    }
};
