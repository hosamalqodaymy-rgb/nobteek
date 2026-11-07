<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE clinics ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0)');
        DB::statement('ALTER TABLE doctors ADD COLUMN active boolean NOT NULL DEFAULT true, ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE doctors DROP COLUMN active, DROP COLUMN version');
        DB::statement('ALTER TABLE clinics DROP COLUMN version');
    }
};
