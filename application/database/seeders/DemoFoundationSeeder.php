<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class DemoFoundationSeeder extends Seeder
{
    public function run(): void
    {
        $database = (string) config('database.connections.pgsql.database');
        if (! app()->environment(['local', 'testing']) ||
            ! config('nobteek.demo_seed_enabled') ||
            ! preg_match('/^nobteek_(development|test(?:_[a-z0-9_]+)?)$/', $database)) {
            throw new RuntimeException('Demo seed requires an explicitly enabled local or testing Nobteek database.');
        }
        $fixture = json_decode(file_get_contents(database_path('fixtures/foundation_demo.json')), true, flags: JSON_THROW_ON_ERROR);
        DB::transaction(function () use ($fixture): void {
            foreach ($fixture['tables'] as $table => $rows) {
                foreach ($rows as $row) {
                    foreach (['delegated_permissions', 'safe_changes'] as $column) {
                        if (array_key_exists($column, $row)) {
                            $row[$column] = json_encode((object) $row[$column], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
                        }
                    }
                    $key = $table === 'ticket_tokens' ? 'digest' : 'id';
                    DB::table($table)->updateOrInsert([$key => $row[$key]], $row);
                }
            }
        });
    }
}
