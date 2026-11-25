<?php

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Ramsey\Uuid\Uuid;

require __DIR__.'/prepare_p12_browser.php';

if (config('database.connections.pgsql.database') !== 'nobteek_test_browser' ||
    ! preg_match('/^[0-9a-f]{64}$/D', getenv('NOBTEEK_PREVIEW_ACCESS') ?: '')) {
    throw new RuntimeException('Dhamar fixtures require the gated QA database.');
}

User::findOrFail($fixture['ids']['PLATFORM'])->forceFill([
    'password' => Hash::make($password), 'login_enabled' => true, 'access_suspended' => false,
    'mfa_secret' => $secret, 'mfa_confirmed_at' => now(), 'mfa_last_step' => 0,
])->save();

$clinicNames = [
    'CLINIC_A' => 'مركز الملكة لطب وجراحة الفم والأسنان · تجربة',
    'CLINIC_B' => 'عيادة سلامتي لطب الأسنان · تجربة',
];

DB::transaction(function () use ($fixture, $clinicNames): void {
    foreach ($clinicNames as $code => $name) {
        DB::table('clinics')->where('id', $fixture['ids'][$code])->update([
            'display_name' => $name, 'city' => 'ذمار',
            'address_landmark' => 'بيانات تجربة مستقلة عن العيادة', 'contact_phone' => null,
        ]);
    }

    $today = CarbonImmutable::now('Asia/Aden')->startOfDay();
    foreach (['DR_A' => 'CLINIC_A', 'DR_B' => 'CLINIC_B', 'DR_C' => 'CLINIC_A'] as $doctor => $clinic) {
        for ($day = 0; $day < 7; $day++) {
            $start = $today->addDays($day);
            $end = $start->addDay()->subSecond();
            $name = 'nobteek-dhamar/'.$doctor.'/'.$start->toDateString();
            $sessionId = (string) Uuid::uuid5(Uuid::NAMESPACE_URL, $name);
            $windowId = (string) Uuid::uuid5($sessionId, 'window');
            DB::table('clinic_sessions')->insertOrIgnore([
                'id' => $sessionId, 'clinic_id' => $fixture['ids'][$clinic], 'doctor_id' => $fixture['ids'][$doctor],
                'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(), 'state' => 'open',
            ]);
            DB::table('arrival_windows')->insertOrIgnore([
                'id' => $windowId, 'session_id' => $sessionId, 'clinic_id' => $fixture['ids'][$clinic],
                'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(), 'capacity' => 20,
            ]);
        }
    }
});

echo "Dhamar QA clinics and 21 synthetic schedules ready.\n";
