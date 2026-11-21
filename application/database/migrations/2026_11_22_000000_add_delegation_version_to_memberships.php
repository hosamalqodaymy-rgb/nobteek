<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE memberships ADD COLUMN delegation_version bigint NOT NULL DEFAULT 1 CHECK (delegation_version > 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE memberships DROP COLUMN delegation_version');
    }
};
