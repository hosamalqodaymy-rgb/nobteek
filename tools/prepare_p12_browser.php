<?php

use App\Models\User;
use Illuminate\Support\Facades\Hash;

require __DIR__.'/prepare_p08_browser.php';

foreach (['external_payments', 'paid_messaging', 'real_patient_data', 'intake_enabled'] as $flag) {
    if (config('nobteek.'.$flag) !== false) {
        throw new RuntimeException('P12 acceptance requires all production and paid integrations to be disabled.');
    }
}

if (config('mail.default') !== 'array' || config('queue.default') !== 'sync') {
    throw new RuntimeException('P12 acceptance requires isolated mail and queue configuration.');
}

foreach (['OWNER_B', 'RECEPTION_B', 'DOCTOR_B'] as $code) {
    $owner = $code === 'OWNER_B';
    User::findOrFail($fixture['ids'][$code])->forceFill([
        'password' => Hash::make($password),
        'login_enabled' => true,
        'access_suspended' => false,
        'mfa_secret' => $owner ? $secret : null,
        'mfa_confirmed_at' => $owner ? now() : null,
        'mfa_last_step' => 0,
    ])->save();
}

echo "P12 accounts ready for two isolated synthetic clinics.\n";
