<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use PragmaRX\Google2FA\Google2FA;

class AccountSecurity
{
    public function __construct(private SecurityAudit $audit) {}

    public static function passwordRules(): array
    {
        return ['required', 'string', 'max:128', Password::min(12)->letters()->numbers(), 'confirmed'];
    }

    public function throttle(Request $request, string $action, string $identity = '', int $limit = 5): void
    {
        foreach ([$action.'|'.$identity.'|'.$request->ip() => $limit, $action.'|ip|'.$request->ip() => 30] as $value => $maximum) {
            $key = hash_hmac('sha256', $value, (string) config('app.key'));
            if (RateLimiter::tooManyAttempts($key, $maximum)) {
                abort(429, 'محاولات كثيرة. انتظر دقيقة ثم حاول مجددًا.');
            }
            RateLimiter::hit($key, 60);
        }
    }

    public function invalid(string $field = 'username'): never
    {
        throw ValidationException::withMessages([$field => 'تعذر إتمام الطلب. تحقق من البيانات أو اطلب مساعدة المسؤول.']);
    }

    public function login(Request $request, string $username, #[\SensitiveParameter] string $password): string
    {
        $username = strtolower(trim($username));
        $this->throttle($request, 'login', $username);
        $id = DB::table('users')->whereRaw('lower(username) = ?', [$username])->value('id');
        $destination = DB::transaction(function () use ($id, $request, $password): string {
            $user = $id ? User::whereKey($id)->lockForUpdate()->first() : null;
            $hash = $user?->password ?? config('nobteek.dummy_password_hash');
            $valid = Hash::check($password, $hash);
            if (! $user || ! $valid || ! $user->login_enabled || $user->access_suspended) {
                return 'failed';
            }
            if (Hash::needsRehash($user->password)) {
                $user->forceFill(['password' => Hash::make($password)])->save();
            }
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            if ($user->hasMfa()) {
                $request->session()->put('pending_login', ['id' => $user->id, 'version' => $user->security_version, 'expires' => now()->addMinutes(5)->timestamp]);

                return 'challenge';
            }
            $this->establish($request, $user, false);
            $this->audit->record('login_succeeded', $user->id, $user->id, request: $request);

            return $user->requiresMfa() ? 'security' : 'dashboard';
        });
        if ($destination === 'failed') {
            $this->audit->record('login_failed', request: $request);
            $this->invalid();
        }

        return $destination;
    }

    public function establish(Request $request, User $user, bool $mfa): void
    {
        Inertia::clearHistory();
        Auth::login($user, false);
        $request->session()->regenerate();
        $request->session()->regenerateToken();
        $request->session()->forget(['pending_login', 'membership_id']);
        $request->session()->put('security_version', $user->security_version);
        $request->session()->put('auth_confirmed_at', now()->timestamp);
        $request->session()->put('mfa_verified_version', $mfa ? $user->security_version : null);
    }

    public function verifyOtp(User $user, #[\SensitiveParameter] string $code): bool
    {
        if (! preg_match('/^\d{6}$/D', $code) || ! $user->hasMfa()) {
            return false;
        }
        $step = (new Google2FA)->verifyKeyNewer($user->mfa_secret, $code, $user->mfa_last_step ?? 0, 1, intdiv(now()->timestamp, 30));
        if ($step === false) {
            return false;
        }
        $user->mfa_last_step = $step;
        $user->save();

        return true;
    }

    public function challenge(Request $request, #[\SensitiveParameter] string $code): void
    {
        $pending = $request->session()->get('pending_login', []);
        $this->throttle($request, 'challenge', (string) ($pending['id'] ?? 'none'));
        DB::transaction(function () use ($request, $pending, $code): void {
            $user = isset($pending['id']) ? User::whereKey($pending['id'])->lockForUpdate()->first() : null;
            if (! $user || ! $user->login_enabled || $user->access_suspended || ($pending['expires'] ?? 0) < now()->timestamp ||
                $user->security_version !== ($pending['version'] ?? null) || ! $this->verifyOtp($user, $code)) {
                $this->invalid('code');
            }
            $this->establish($request, $user, true);
            $this->audit->record('mfa_login_succeeded', $user->id, $user->id, request: $request);
        });
    }

    public function lockedActor(Request $request, bool $recent = false, bool $mfa = false): User
    {
        $user = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
        abort_unless($user->login_enabled && ! $user->access_suspended && $user->security_version === $request->session()->get('security_version'), 401);
        if ($mfa || $user->requiresMfa() || $user->hasMfa()) {
            abort_unless($user->hasMfa() && $request->session()->get('mfa_verified_version') === $user->security_version, 423, 'أكمل التحقق الإضافي أولًا.');
        }
        if ($recent) {
            abort_unless($request->session()->get('auth_confirmed_at', 0) >= now()->subMinutes(10)->timestamp, 423, 'أعد تأكيد هويتك من صفحة أمان الحساب.');
        }

        return $user;
    }

    private function checkPassword(User $user, #[\SensitiveParameter] string $password): void
    {
        if (! Hash::check($password, $user->password)) {
            $this->invalid('current_password');
        }
    }

    public function confirm(Request $request, #[\SensitiveParameter] string $password, #[\SensitiveParameter] string $code): void
    {
        $this->throttle($request, 'confirm', $request->user()->id);
        DB::transaction(function () use ($request, $password, $code): void {
            $user = $this->lockedActor($request);
            $this->checkPassword($user, $password);
            if ($user->hasMfa() && ! $this->verifyOtp($user, $code)) {
                $this->invalid('code');
            }
            $request->session()->put('auth_confirmed_at', now()->timestamp);
        });
    }

    public function beginMfa(Request $request, #[\SensitiveParameter] string $password, #[\SensitiveParameter] string $code): void
    {
        $this->throttle($request, 'mfa_setup', $request->user()->id);
        DB::transaction(function () use ($request, $password, $code): void {
            $user = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            abort_unless($user->security_version === $request->session()->get('security_version') && $user->login_enabled && ! $user->access_suspended, 401);
            $this->checkPassword($user, $password);
            if ($user->hasMfa() && ! $this->verifyOtp($user, $code)) {
                $this->invalid('code');
            }
            $user->forceFill(['mfa_pending_secret' => (new Google2FA)->generateSecretKey(32), 'mfa_pending_until' => now()->addMinutes(10)])->save();
            $this->audit->record('mfa_setup_started', $user->id, $user->id, request: $request);
        });
    }

    public function confirmMfa(Request $request, #[\SensitiveParameter] string $code): string
    {
        $this->throttle($request, 'mfa_confirm', $request->user()->id);

        return DB::transaction(function () use ($request, $code): string {
            $user = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            abort_unless($user->security_version === $request->session()->get('security_version') && $user->login_enabled && ! $user->access_suspended, 401);
            $secret = $user->mfa_pending_secret;
            $step = $secret && $user->mfa_pending_until?->isFuture() && preg_match('/^\d{6}$/D', $code)
                ? (new Google2FA)->verifyKeyNewer($secret, $code, 0, 1, intdiv(now()->timestamp, 30)) : false;
            if ($step === false) {
                $this->invalid('code');
            }
            $raw = $this->newRecoveryCode($user);
            $user->forceFill(['mfa_secret' => $secret, 'mfa_pending_secret' => null, 'mfa_pending_until' => null,
                'mfa_confirmed_at' => now(), 'mfa_last_step' => $step, 'security_version' => $user->security_version + 1])->save();
            $this->revokeGrants($user->id);
            $this->establish($request, $user, true);
            $this->audit->record('mfa_enabled', $user->id, $user->id, request: $request);

            return $raw;
        });
    }

    public function rotateRecovery(Request $request, #[\SensitiveParameter] string $password, #[\SensitiveParameter] string $code): string
    {
        $this->throttle($request, 'rotate_recovery', $request->user()->id);

        return DB::transaction(function () use ($request, $password, $code): string {
            $user = $this->lockedActor($request);
            $this->checkPassword($user, $password);
            if ($user->hasMfa() && ! $this->verifyOtp($user, $code)) {
                $this->invalid('code');
            }
            $raw = $this->newRecoveryCode($user);
            $user->security_version++;
            $user->save();
            $this->revokeGrants($user->id);
            $this->establish($request, $user, $user->hasMfa());
            $this->audit->record('recovery_code_rotated', $user->id, $user->id, request: $request);

            return $raw;
        });
    }

    private function newRecoveryCode(User $user): string
    {
        $raw = implode('-', str_split(bin2hex(random_bytes(20)), 8));
        $user->recovery_digest = hash('sha256', str_replace('-', '', $raw));
        $user->recovery_issued_at = now();

        return $raw;
    }

    public function changePassword(Request $request, #[\SensitiveParameter] string $current, #[\SensitiveParameter] string $password, #[\SensitiveParameter] string $code): void
    {
        $this->throttle($request, 'password', $request->user()->id);
        DB::transaction(function () use ($request, $current, $password, $code): void {
            $user = $this->lockedActor($request);
            $this->checkPassword($user, $current);
            if ($user->hasMfa() && ! $this->verifyOtp($user, $code)) {
                $this->invalid('code');
            }
            $user->forceFill(['password' => Hash::make($password), 'security_version' => $user->security_version + 1])->save();
            $this->revokeGrants($user->id);
            $this->establish($request, $user, $user->hasMfa());
            $this->audit->record('password_changed', $user->id, $user->id, request: $request);
        });
    }

    public function recover(Request $request, string $username, #[\SensitiveParameter] string $code, #[\SensitiveParameter] string $password): void
    {
        $username = strtolower(trim($username));
        $this->throttle($request, 'recover', $username);
        DB::transaction(function () use ($request, $username, $code, $password): void {
            $user = User::whereRaw('lower(username) = ?', [$username])->lockForUpdate()->first();
            $normalized = strtolower(str_replace(['-', ' '], '', trim($code)));
            if (! $user || $user->access_suspended || ! $user->recovery_digest || ! hash_equals($user->recovery_digest, hash('sha256', $normalized))) {
                $this->invalid('recovery_code');
            }
            $this->resetCredentials($user, $password);
            $this->audit->record('account_recovered', subject: $user->id, request: $request);
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        });
    }

    public function resetCredentials(User $user, #[\SensitiveParameter] string $password): void
    {
        $user->forceFill(['password' => Hash::make($password), 'login_enabled' => true,
            'security_version' => $user->security_version + 1, 'remember_token' => null,
            'mfa_secret' => null, 'mfa_pending_secret' => null, 'mfa_pending_until' => null,
            'mfa_confirmed_at' => null, 'mfa_last_step' => null, 'recovery_digest' => null, 'recovery_issued_at' => null])->save();
        $this->revokeGrants($user->id);
    }

    public function revokeGrants(string $userId): void
    {
        DB::table('account_grants')->where('user_id', $userId)->whereNull('consumed_at')->whereNull('revoked_at')->update(['revoked_at' => now()]);
    }
}
