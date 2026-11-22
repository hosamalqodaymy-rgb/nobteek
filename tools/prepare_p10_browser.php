<?php

use App\Models\User;
use Illuminate\Support\Facades\Hash;

require __DIR__.'/prepare_p08_browser.php';

$platform = User::findOrFail($fixture['ids']['PLATFORM']);
$platform->forceFill([
    'password' => Hash::make($password), 'login_enabled' => true,
    'access_suspended' => false, 'mfa_secret' => $secret,
    'mfa_confirmed_at' => now(), 'mfa_last_step' => 0,
])->save();
$directory = __DIR__.'/../results/p10-browser-ci';
if (! is_dir($directory)) { mkdir($directory, 0775, true); }
file_put_contents($directory.'/fixture.json', json_encode([
    'event_id' => $fixture['ids']['EVENT_CLINIC_A'],
    'other_event_id' => $fixture['ids']['EVENT_CLINIC_B'],
    'synthetic_only' => true,
], JSON_THROW_ON_ERROR)."\n");
echo "P10 isolated browser fixture prepared.\n";
