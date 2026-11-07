<?php

use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Hash;

require __DIR__.'/../application/vendor/autoload.php';

$app = require __DIR__.'/../application/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

if (! app()->environment('testing') || config('database.default') !== 'pgsql' ||
    config('database.connections.pgsql.database') !== 'nobteek_test_browser' ||
    ! config('nobteek.demo_seed_enabled')) {
    throw new RuntimeException('Browser fixtures require the isolated synthetic browser database.');
}

$password = getenv('NOBTEEK_BROWSER_PASSWORD');
$secret = getenv('NOBTEEK_BROWSER_MFA_SECRET');
if (! is_string($password) || strlen($password) < 24 ||
    ! is_string($secret) || ! preg_match('/^[A-Z2-7]{32}$/D', $secret)) {
    throw new RuntimeException('Ephemeral browser credentials must be provided outside source.');
}

$fixture = json_decode(file_get_contents(__DIR__.'/../application/database/fixtures/foundation_demo.json'), true, flags: JSON_THROW_ON_ERROR);
foreach (['OWNER_A', 'RECEPTION_A', 'DOCTOR_A', 'DOCTOR_C'] as $code) {
    $user = User::findOrFail($fixture['ids'][$code]);
    $owner = $code === 'OWNER_A';
    $user->forceFill([
        'password' => Hash::make($password),
        'login_enabled' => true,
        'access_suspended' => false,
        'mfa_secret' => $owner ? $secret : null,
        'mfa_confirmed_at' => $owner ? now() : null,
        'mfa_last_step' => 0,
    ])->save();
}

echo "Synthetic browser accounts prepared; credentials are not written to reports.\n";
