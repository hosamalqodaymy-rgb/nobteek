<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AccountGrants
{
    public function __construct(private AccountSecurity $security, private SecurityAudit $audit) {}

    /** Must be called inside a transaction after actor/target authorization and locks. */
    public function issue(User $actor, User $subject, ?string $clinicId, Request $request): string
    {
        abort_if($subject->access_suspended, 422, 'أعد تفعيل الحساب قبل إصدار الرابط.');
        $purpose = $subject->password ? 'recovery' : 'activation';
        $this->security->revokeGrants($subject->id);
        $subject->forceFill(['login_enabled' => false, 'security_version' => $subject->security_version + 1])->save();
        $raw = bin2hex(random_bytes(32));
        DB::table('account_grants')->insert(['id' => (string) Str::uuid(), 'user_id' => $subject->id,
            'actor_user_id' => $actor->id, 'clinic_id' => $clinicId, 'token_digest' => hash('sha256', $raw),
            'purpose' => $purpose, 'security_version' => $subject->security_version, 'expires_at' => now()->addMinutes(30)]);
        $this->audit->record('account_link_issued', $actor->id, $subject->id, $clinicId, $request);

        return route('account.access').'#token='.$raw;
    }

    public function consume(Request $request, #[\SensitiveParameter] string $token, #[\SensitiveParameter] string $password): void
    {
        $this->security->throttle($request, 'grant', hash('sha256', $token));
        DB::transaction(function () use ($request, $token, $password): void {
            $digest = hash('sha256', $token);
            $candidate = DB::table('account_grants')->where('token_digest', $digest)->first();
            if (! $candidate) {
                $this->security->invalid('grant_token');
            }
            $user = User::whereKey($candidate->user_id)->lockForUpdate()->firstOrFail();
            $grant = DB::table('account_grants')->where('id', $candidate->id)->lockForUpdate()->first();
            if ($grant->consumed_at || $grant->revoked_at || $user->access_suspended || $grant->security_version !== $user->security_version ||
                Carbon::parse($grant->expires_at)->isPast()) {
                $this->security->invalid('grant_token');
            }
            DB::table('account_grants')->where('id', $grant->id)->update(['consumed_at' => now()]);
            $this->security->resetCredentials($user, $password);
            $this->audit->record('account_link_consumed', subject: $user->id, clinic: $grant->clinic_id, request: $request);
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        });
    }
}
