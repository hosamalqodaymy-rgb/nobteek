<?php

use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

require __DIR__.'/prepare_p06_browser.php';

$clock = getenv('NOBTEEK_BROWSER_CLOCK');
if (! is_string($clock) || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/D', $clock) || abs(time() - strtotime($clock)) > 3600) {
    throw new RuntimeException('P07 browser fixtures require the explicit synthetic clock.');
}
Carbon::setTestNow(CarbonImmutable::parse($clock));
CarbonImmutable::setTestNow(CarbonImmutable::parse($clock));

$doctor = (string) Str::uuid();
$user = (string) Str::uuid();
DB::transaction(function () use ($user, $doctor, $password, $fixture): void {
    $clinic = $fixture['ids']['CLINIC_A'];
    DB::table('users')->insert(['id' => $user, 'username' => 'p07_browser_doctor', 'display_name' => 'طبيب فحص الاستقبال الصناعي', 'password' => Hash::make($password), 'login_enabled' => true]);
    DB::table('memberships')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $clinic, 'user_id' => $user, 'role' => 'doctor', 'active' => true]);
    DB::table('doctors')->insert(['id' => $doctor, 'clinic_id' => $clinic, 'user_id' => $user, 'display_name' => 'طبيب فحص الاستقبال الصناعي', 'active' => true]);
});
$directory = __DIR__.'/../results/p07-browser-ci';
if (! is_dir($directory)) {
    mkdir($directory, 0775, true);
}
file_put_contents($directory.'/fixture.json', json_encode(['doctor_id' => $doctor, 'synthetic_only' => true], JSON_THROW_ON_ERROR)."\n");
echo "P07 isolated browser doctor prepared.\n";
