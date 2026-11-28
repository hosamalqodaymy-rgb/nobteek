<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

require __DIR__.'/prepare_p12_browser.php';

$patientPassword = getenv('NOBTEEK_QA_PATIENT_PASSWORD');
if (! config('nobteek.community_enabled') || ! is_string($patientPassword) || strlen($patientPassword) < 16) {
    throw new RuntimeException('Connected QA requires an isolated patient password.');
}

foreach (['demo_patient' => 'مراجع تجريبي', 'demo_patient_b' => 'مراجع تجريبي آخر', 'demo_support' => 'موظف دعم تجريبي'] as $username => $name) {
    $staff = $username === 'demo_support';
    $user = User::query()->firstOrNew(['username' => $username]);
    $user->forceFill([
        'display_name' => $name,
        'password' => Hash::make($staff || $username !== 'demo_patient' ? $password : $patientPassword),
        'login_enabled' => true,
        'access_suspended' => false,
        'community_role' => $staff ? 'support' : 'patient',
        'mfa_secret' => $staff ? $secret : null,
        'mfa_confirmed_at' => $staff ? now() : null,
    ])->save();
}

User::findOrFail($fixture['ids']['PLATFORM'])->forceFill([
    'password' => Hash::make($password), 'login_enabled' => true, 'access_suspended' => false,
    'mfa_secret' => $secret, 'mfa_confirmed_at' => now(),
])->save();

DB::transaction(function () use ($fixture): void {
    $now = now('UTC');
    foreach (['A', 'B'] as $letter) {
        $session = $fixture['ids']['SESSION_'.$letter];
        $starts = $now->copy()->addMinutes(15);
        $middle = $starts->copy()->addHours(3);
        $ends = $middle->copy()->addHours(3);
        $current = DB::table('clinic_sessions')->where('id', $session)->lockForUpdate()->first();
        if (\Carbon\CarbonImmutable::parse($current->ends_at)->isFuture()) {
            continue;
        }
        DB::table('clinic_sessions')->where('id', $session)->update(['starts_at' => $starts, 'ends_at' => $ends, 'state' => 'open']);
        DB::table('arrival_windows')->where('id', $fixture['ids']['W1_'.$letter])->update(['starts_at' => $starts, 'ends_at' => $middle]);
        DB::table('arrival_windows')->where('id', $fixture['ids']['W2_'.$letter])->update(['starts_at' => $middle, 'ends_at' => $ends]);
    }

    DB::table('community_job_adverts')->insertOrIgnore([
        'id' => 'f25bc744-6dc6-4096-ba5d-b6bcb65cc071',
        'publisher_clinic_id' => $fixture['ids']['CLINIC_A'],
        'kind' => 'vacancy', 'title' => 'فني مختبر طبي · نموذج تجريبي',
        'profession' => 'laboratory', 'specialty' => 'المختبرات الطبية', 'area' => 'ذمار', 'branch' => 'العيادة التجريبية',
        'work_type' => 'full', 'deadline' => $now->copy()->addDays(14)->setTimezone('Asia/Aden')->toDateString(),
        'description' => 'إعلان لاختبار التقديم ومراجعة الحالات بين الحسابات التجريبية.',
        'requirements' => 'ملف مهني تجريبي وخبرة في المختبرات الطبية.',
        'state' => 'published', 'reviewer_id' => $fixture['ids']['PLATFORM'],
        'reviewed_at' => $now, 'created_at' => $now, 'updated_at' => $now,
    ]);
});

echo "Nobteek connected QA seeded with synthetic accounts and availability.\n";
