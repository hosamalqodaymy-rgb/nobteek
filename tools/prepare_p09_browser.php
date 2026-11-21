<?php

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

require __DIR__.'/prepare_p08_browser.php';

$workflowEnvironment = getenv('GITHUB_ENV');
if (! is_string($workflowEnvironment) || $workflowEnvironment === '' || ! is_file($workflowEnvironment)) {
    throw new RuntimeException('P09 browser credentials require the ephemeral workflow environment.');
}
$expiredSecret = bin2hex(random_bytes(32));
$oldSession = DB::table('clinic_sessions')->where('id', $fixture['ids']['SESSION_A'])->firstOrFail();
$expiredAt = CarbonImmutable::parse($oldSession->ends_at)->addHours(48);
if (! $expiredAt->isPast()) {
    throw new RuntimeException('The P09 expired-link fixture must remain expired.');
}
DB::table('ticket_tokens')->insert([
    'digest' => hash('sha256', $expiredSecret),
    'clinic_id' => $fixture['ids']['CLINIC_A'],
    'booking_id' => $fixture['ids']['BOOK_A1'],
    'expires_at' => $expiredAt->toIso8601String(),
    'created_at' => now()->toIso8601String(),
]);
echo '::add-mask::'.$expiredSecret."\n";
file_put_contents($workflowEnvironment, 'NOBTEEK_EXPIRED_TICKET_SECRET='.$expiredSecret."\n", FILE_APPEND);

$artifactDirectory = __DIR__.'/../results/p09-browser-ci';
if (! is_dir($artifactDirectory)) {
    mkdir($artifactDirectory, 0775, true);
}
file_put_contents($artifactDirectory.'/fixture.json', json_encode([
    'clinic_id' => $fixture['ids']['CLINIC_A'],
    'other_clinic_id' => $fixture['ids']['CLINIC_B'],
    'doctor_id' => $fixture['ids']['DR_A'],
    'doctor_username' => 'demo_doctor_a',
    'other_doctor_id' => $fixture['ids']['DR_C'],
    'other_doctor_username' => 'demo_doctor_c',
    'reception_membership_id' => $fixture['ids']['MEM_RECEPTION_A'],
    'old_session_id' => $fixture['ids']['SESSION_A'],
    'old_booking_id' => $fixture['ids']['BOOK_A1'],
    'old_visit_id' => $fixture['ids']['VISIT_A1'],
    'other_clinic_session_id' => $fixture['ids']['SESSION_B'],
    'synthetic_only' => true,
], JSON_THROW_ON_ERROR)."\n");
echo "P09 isolated patient and waiting-room fixtures prepared; ticket secrets are not written to evidence.\n";
