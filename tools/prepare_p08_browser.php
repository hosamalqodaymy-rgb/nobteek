<?php

use Carbon\Carbon;
use Carbon\CarbonImmutable;

require __DIR__.'/prepare_p06_browser.php';

$clock = getenv('NOBTEEK_BROWSER_CLOCK');
if (! is_string($clock) || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/D', $clock) || abs(time() - strtotime($clock)) > 3600) {
    throw new RuntimeException('P08 browser fixtures require the explicit synthetic clock.');
}
Carbon::setTestNow(CarbonImmutable::parse($clock));
CarbonImmutable::setTestNow(CarbonImmutable::parse($clock));

$directory = __DIR__.'/../results/p08-browser-ci';
if (! is_dir($directory)) {
    mkdir($directory, 0775, true);
}
file_put_contents($directory.'/fixture.json', json_encode([
    'doctor_id' => $fixture['ids']['DR_A'],
    'doctor_username' => 'demo_doctor_a',
    'other_doctor_id' => $fixture['ids']['DR_C'],
    'other_doctor_username' => 'demo_doctor_c',
    'reception_membership_id' => $fixture['ids']['MEM_RECEPTION_A'],
    'old_session_id' => $fixture['ids']['SESSION_A'],
    'old_visit_id' => $fixture['ids']['VISIT_A1'],
    'other_clinic_session_id' => $fixture['ids']['SESSION_B'],
    'other_clinic_visit_id' => $fixture['ids']['VISIT_B1'],
    'synthetic_only' => true,
], JSON_THROW_ON_ERROR)."\n");
echo "P08 isolated doctor workflow fixtures prepared.\n";
