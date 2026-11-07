<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Testing\AssertableInertia as Assert;
use PHPUnit\Framework\Attributes\Group;
use PragmaRX\Google2FA\Google2FA;
use Tests\SecurityTestCase;

#[Group('postgres')]
class AccountAuthenticationTest extends SecurityTestCase
{
    public function test_login_uses_username_password_argon2id_and_rotates_session(): void
    {
        $user = $this->user('RECEPTION_A');
        $this->get('/login')->assertOk()->assertHeader('Referrer-Policy', 'no-referrer')->assertInertia(fn (Assert $p) => $p->component('Account')->where('screen', 'login'));
        $old = session()->getId();
        $this->post('/login', ['username' => strtoupper($user->username), 'password' => self::PASSWORD])->assertRedirect('/workspace');
        $this->assertAuthenticatedAs($user);
        $this->assertNotSame($old, session()->getId());
        $this->assertSame($user->security_version, session('security_version'));
        $this->assertStringStartsWith('$argon2id$', $user->password);
        $this->assertSame(1, DB::table('security_events')->where('event_type', 'login_succeeded')->count());
    }

    public function test_unknown_wrong_and_disabled_accounts_return_same_failure_without_secret_flash(): void
    {
        $user = $this->user('RECEPTION_A');
        foreach (['unknown_account', $user->username, 'demo_reception_b'] as $username) {
            $this->postJson('/login', ['username' => $username, 'password' => 'WrongSynthetic123'])->assertUnprocessable()->assertJsonValidationErrors('username');
            $this->assertGuest();
        }
        $this->post('/login', ['username' => $user->username, 'password' => 'WrongSynthetic123'])->assertSessionHasErrors('username');
        $this->assertNull(session()->getOldInput('password'));
        $events = DB::table('security_events')->get()->toJson();
        $this->assertStringNotContainsString('WrongSynthetic', $events);
        $this->assertStringNotContainsString($user->username, $events);
        $this->assertSame(4, DB::table('security_events')->where('event_type', 'login_failed')->count());
    }

    public function test_login_attempts_are_rate_limited(): void
    {
        for ($n = 0; $n < 5; $n++) {
            $this->postJson('/login', ['username' => 'demo_reception_a', 'password' => 'wrong'])->assertUnprocessable();
        }
        $this->postJson('/login', ['username' => 'demo_reception_a', 'password' => 'wrong'])->assertStatus(429);
    }

    public function test_owners_and_platform_cannot_enter_workspace_without_mfa(): void
    {
        foreach (['OWNER_A', 'PLATFORM'] as $code) {
            $user = $this->user($code);
            Auth::logout();
            $this->post('/login', ['username' => $user->username, 'password' => self::PASSWORD])->assertRedirect('/account/security');
            $this->getJson('/workspace')->assertStatus(423);
            $this->get('/account/security')->assertOk();
            $this->getJson('/v1/patients')->assertStatus(423);
        }
    }

    public function test_mfa_challenge_requires_fresh_otp_and_prevents_replay(): void
    {
        $user = $this->mfa($this->user('OWNER_A'));
        $this->post('/login', ['username' => $user->username, 'password' => self::PASSWORD])->assertRedirect('/login/challenge');
        $this->assertGuest();
        $this->getJson('/v1/patients')->assertUnauthorized();
        $otp = $this->otp($user);
        $this->post('/login/challenge', ['code' => $otp])->assertRedirect('/workspace');
        $this->assertAuthenticatedAs($user);
        $this->getJson('/v1/patients')->assertOk();
        $this->post('/logout')->assertRedirect('/login');
        $this->post('/login', ['username' => $user->username, 'password' => self::PASSWORD])->assertRedirect('/login/challenge');
        $this->postJson('/login/challenge', ['code' => $otp])->assertUnprocessable();
        $this->assertGuest();
        $this->travel(31)->seconds();
        $this->post('/login/challenge', ['code' => $this->otp($user)])->assertRedirect('/workspace');
    }

    public function test_expired_and_revoked_login_challenges_are_rejected(): void
    {
        $user = $this->mfa($this->user('OWNER_A'));
        $this->post('/login', ['username' => $user->username, 'password' => self::PASSWORD]);
        $this->travel(6)->minutes();
        $this->postJson('/login/challenge', ['code' => $this->otp($user)])->assertUnprocessable();
        $this->travelBack();
        $this->post('/login', ['username' => $user->username, 'password' => self::PASSWORD]);
        $user->increment('security_version');
        $this->postJson('/login/challenge', ['code' => $this->otp($user)])->assertUnprocessable();
        $this->assertGuest();
    }

    public function test_enrollment_is_encrypted_verified_and_shows_recovery_only_once(): void
    {
        $user = $this->signIn('OWNER_A');
        $this->post('/account/mfa/start', ['current_password' => self::PASSWORD])->assertRedirect('/account/security');
        $user->refresh();
        $secret = $user->mfa_pending_secret;
        $this->assertNotSame($secret, DB::table('users')->where('id', $user->id)->value('mfa_pending_secret'));
        $this->assertNull($user->mfa_secret);
        $this->get('/account/security')->assertOk()->assertInertia(fn (Assert $p) => $p->where('mfa.setup.secret', $secret)->where('mfa.enabled', false));
        $otp = (new Google2FA)->oathTotp($secret, intdiv(now()->timestamp, 30));
        $response = $this->post('/account/mfa/confirm', ['code' => $otp])->assertRedirect('/account/security');
        $notice = $this->privateNotice($response);
        $this->assertArrayHasKey('recovery_code', $notice);
        $user->refresh();
        $this->assertTrue($user->hasMfa());
        $this->assertNull($user->mfa_pending_secret);
        $this->assertStringNotContainsString($secret, $user->toJson());
        $this->assertStringNotContainsString($notice['recovery_code'], DB::table('security_events')->get()->toJson());
        $shown = $this->get('/account/security')->assertInertia(fn (Assert $p) => $p->where('privateNotice', null));
        $page = json_decode(json_encode($shown->viewData('page')), true);
        $this->assertSame($notice['recovery_code'], $page['flash']['privateNotice']['recovery_code']);
        $this->get('/account/security')->assertInertia(fn (Assert $p) => $p->where('privateNotice', null));
        $this->get('/workspace')->assertOk();
    }

    public function test_expired_mfa_setup_is_not_accepted_and_replacement_preserves_existing_secret(): void
    {
        $user = $this->signIn('OWNER_A', true);
        $old = $user->mfa_secret;
        $this->post('/account/mfa/start', ['current_password' => self::PASSWORD, 'code' => $this->otp($user)])->assertRedirect();
        $user->refresh();
        $this->assertSame($old, $user->mfa_secret);
        $pending = $user->mfa_pending_secret;
        $this->travel(11)->minutes();
        $otp = (new Google2FA)->oathTotp($pending, intdiv(now()->timestamp, 30));
        $this->postJson('/account/mfa/confirm', ['code' => $otp])->assertUnprocessable();
        $this->assertSame($old, $user->fresh()->mfa_secret);
    }

    public function test_stale_session_is_rejected_and_logout_clears_auth(): void
    {
        $user = $this->signIn('RECEPTION_A');
        $user->increment('security_version');
        $this->getJson('/v1/patients')->assertUnauthorized();
        $this->assertGuest();
        $this->signIn('RECEPTION_A');
        $this->post('/logout')->assertRedirect('/login');
        $this->assertGuest();
        $this->getJson('/v1/patients')->assertUnauthorized();
        $this->get('/logout')->assertStatus(405);
    }

    public function test_password_change_revokes_other_sessions_and_keeps_only_current_epoch(): void
    {
        $user = $this->signIn('RECEPTION_A');
        $old = $user->security_version;
        $this->post('/account/password', ['current_password' => self::PASSWORD, ...$this->passwordData()])->assertRedirect('/account/security');
        $this->assertTrue(Hash::check('AnotherSynthetic123', $user->fresh()->password));
        $this->assertSame($old + 1, session('security_version'));
        $this->getJson('/v1/patients')->assertOk();
        $this->withSession(['security_version' => $old])->getJson('/v1/patients')->assertUnauthorized();
    }

    public function test_bootstrap_refuses_noninteractive_default_password_creation(): void
    {
        $this->artisan('nobteek:bootstrap-admin new_admin --no-interaction')->assertFailed();
        $this->assertDatabaseMissing('users', ['username' => 'new_admin']);
    }
}
