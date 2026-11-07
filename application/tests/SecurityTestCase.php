<?php

namespace Tests;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;
use RuntimeException;

abstract class SecurityTestCase extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected const PASSWORD = 'SyntheticPassword123';

    protected const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

    protected function beforeRefreshingDatabase(): void
    {
        if (! app()->environment('testing') || config('database.default') !== 'pgsql' ||
            ! preg_match('/^nobteek_test(?:_[a-z0-9_]+)?$/', (string) config('database.connections.pgsql.database'))) {
            throw new RuntimeException('Only isolated synthetic PostgreSQL test databases are allowed.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
    }

    protected function id(string $code): string
    {
        return json_decode(file_get_contents(database_path('fixtures/foundation_demo.json')), true)['ids'][$code];
    }

    protected function user(string $code): User
    {
        $user = User::findOrFail($this->id($code));
        if (! $user->password) {
            $user->forceFill(['password' => Hash::make(self::PASSWORD), 'login_enabled' => true])->save();
        }

        return $user;
    }

    protected function mfa(User $user): User
    {
        $user->forceFill(['mfa_secret' => self::SECRET, 'mfa_confirmed_at' => now(), 'mfa_last_step' => 0])->save();

        return $user;
    }

    protected function signIn(string $code, bool $verified = false): User
    {
        session()->forget('membership_id');
        $user = $this->user($code);
        if ($verified) {
            $this->mfa($user);
        }
        $this->actingAs($user)->withSession(['membership_id' => null, 'security_version' => $user->security_version, 'mfa_verified_version' => $verified ? $user->security_version : null, 'auth_confirmed_at' => now()->timestamp]);

        return $user;
    }

    protected function otp(User $user): string
    {
        return (new Google2FA)->oathTotp($user->mfa_secret, intdiv(now()->timestamp, 30));
    }

    protected function data(): array
    {
        return ['display_name' => 'اسم وهمي معدل', 'contact_phone' => '+967700000099', 'version' => 1];
    }

    protected function passwordData(): array
    {
        return ['password' => 'AnotherSynthetic123', 'password_confirmation' => 'AnotherSynthetic123'];
    }

    protected function privateNotice(TestResponse $response): array
    {
        $encrypted = session('private_notice');
        $this->assertIsString($encrypted);

        return json_decode(Crypt::decryptString($encrypted), true);
    }
}
