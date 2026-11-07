<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use PHPUnit\Framework\Attributes\Group;
use Tests\SecurityTestCase;

#[Group('postgres')]
class AccountRecoveryTest extends SecurityTestCase
{
    public function test_t04b_private_recovery_revokes_sessions_mfa_and_all_grants(): void
    {
        $user = $this->signIn('OWNER_A', true);
        $old = $user->security_version;
        $response = $this->post('/account/recovery-code', ['current_password' => self::PASSWORD, 'code' => $this->otp($user)])->assertRedirect();
        $raw = $this->privateNotice($response)['recovery_code'];
        $this->assertNotSame($raw, $user->fresh()->recovery_digest);
        $this->assertSame(hash('sha256', str_replace('-', '', $raw)), $user->fresh()->recovery_digest);
        $prior = $user->fresh()->security_version;
        $this->post('/logout');
        $this->post('/recover', ['username' => $user->username, 'recovery_code' => $raw, ...$this->passwordData()])->assertRedirect('/login');
        $this->assertGuest();
        $user->refresh();
        $this->assertTrue(Hash::check('AnotherSynthetic123', $user->password));
        $this->assertFalse($user->hasMfa());
        $this->assertNull($user->recovery_digest);
        $this->assertGreaterThan($old, $user->security_version);
        $this->actingAs($user)->withSession(['security_version' => $prior, 'mfa_verified_version' => $prior])->getJson('/v1/patients')->assertUnauthorized();
        $this->postJson('/recover', ['username' => $user->username, 'recovery_code' => $raw, ...$this->passwordData()])->assertUnprocessable();
        $this->post('/login', ['username' => $user->username, 'password' => 'AnotherSynthetic123'])->assertRedirect('/account/security');
    }

    public function test_old_recovery_code_is_invalid_after_rotation(): void
    {
        $user = $this->signIn('RECEPTION_A');
        $first = $this->privateNotice($this->post('/account/recovery-code', ['current_password' => self::PASSWORD]))['recovery_code'];
        $second = $this->privateNotice($this->post('/account/recovery-code', ['current_password' => self::PASSWORD]))['recovery_code'];
        $this->assertNotSame($first, $second);
        $this->post('/logout');
        $this->postJson('/recover', ['username' => $user->username, 'recovery_code' => $first, ...$this->passwordData()])->assertUnprocessable();
        $this->post('/recover', ['username' => $user->username, 'recovery_code' => $second, ...$this->passwordData()])->assertRedirect('/login');
    }

    public function test_suspended_user_cannot_recover_and_unknown_names_have_generic_response(): void
    {
        $user = $this->signIn('RECEPTION_A');
        $raw = $this->privateNotice($this->post('/account/recovery-code', ['current_password' => self::PASSWORD]))['recovery_code'];
        $user->forceFill(['access_suspended' => true])->save();
        Auth::logout();
        foreach ([$user->username, 'unknown_name'] as $name) {
            $this->postJson('/recover', ['username' => $name, 'recovery_code' => $raw, ...$this->passwordData()])->assertUnprocessable()->assertJsonValidationErrors('recovery_code');
        }
        $this->assertFalse(Hash::check('AnotherSynthetic123', $user->fresh()->password));
    }

    public function test_phone_lookup_and_public_booking_history_are_not_exposed(): void
    {
        foreach (['/v1/bookings?phone=700000001', '/v1/patients?phone=700000001', '/v1/patients/'.$this->id('PAT_A1'), '/v1/patients/export'] as $path) {
            $this->getJson($path)->assertUnauthorized();
        }
        foreach (['/v1/patients/by-phone/700000001', '/register'] as $path) {
            $this->getJson($path)->assertNotFound();
        }
        $this->signIn('RECEPTION_A');
        $this->getJson('/v1/patients?phone=700000001')->assertUnprocessable();
        $this->getJson('/v1/bookings?phone=700000001')->assertUnprocessable();
    }

    public function test_password_policy_and_wrong_recovery_do_not_reveal_secrets_in_flash(): void
    {
        $this->post('/recover', ['username' => 'someone', 'recovery_code' => 'PrivateSyntheticRecovery', 'password' => 'short', 'password_confirmation' => 'short'])
            ->assertSessionHasErrors('password');
        foreach (['password', 'password_confirmation', 'recovery_code'] as $field) {
            $this->assertNull(session()->getOldInput($field));
        }
    }
}
