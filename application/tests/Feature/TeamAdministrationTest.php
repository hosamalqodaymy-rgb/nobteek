<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\SecurityTestCase;

#[Group('postgres')]
class TeamAdministrationTest extends SecurityTestCase
{
    private function token(string $url): string
    {
        parse_str(parse_url($url, PHP_URL_FRAGMENT), $values);

        return $values['token'];
    }

    public function test_owner_can_create_independent_staff_and_one_time_activation_link(): void
    {
        $this->signIn('OWNER_A', true);
        $response = $this->post('/workspace/team', ['username' => 'synthetic_new_staff', 'display_name' => 'موظف وهمي', 'role' => 'reception'])->assertRedirect('/workspace/team');
        $url = $this->privateNotice($response)['account_link'];
        $token = $this->token($url);
        $this->assertNull(parse_url($url, PHP_URL_QUERY));
        $user = User::where('username', 'synthetic_new_staff')->firstOrFail();
        $this->assertFalse($user->login_enabled);
        $this->assertNull($user->password);
        $this->assertSame(hash('sha256', $token), DB::table('account_grants')->where('user_id', $user->id)->value('token_digest'));
        $this->assertStringNotContainsString($token, DB::table('account_grants')->get()->toJson());
        $this->assertStringNotContainsString($token, DB::table('security_events')->get()->toJson());
        $this->post('/logout');
        $this->post('/account-access', ['grant_token' => $token, ...$this->passwordData()])->assertRedirect('/login');
        $this->assertGuest();
        $this->assertTrue($user->fresh()->login_enabled);
        $this->postJson('/account-access', ['grant_token' => $token, ...$this->passwordData()])->assertUnprocessable();
        $this->post('/login', ['username' => $user->username, 'password' => 'AnotherSynthetic123'])->assertRedirect('/workspace');
    }

    public function test_reset_link_immediately_revokes_target_sessions_and_reissue_revokes_old_link(): void
    {
        $target = $this->mfa($this->user('RECEPTION_A'));
        $epoch = $target->security_version;
        $this->signIn('OWNER_A', true);
        $path = '/workspace/team/'.$this->id('MEM_RECEPTION_A').'/access';
        $first = $this->token($this->privateNotice($this->post($path)->assertRedirect())['account_link']);
        $this->assertFalse($target->fresh()->login_enabled);
        $this->assertGreaterThan($epoch, $target->fresh()->security_version);
        $second = $this->token($this->privateNotice($this->post($path)->assertRedirect())['account_link']);
        $this->post('/logout');
        $this->postJson('/account-access', ['grant_token' => $first, ...$this->passwordData()])->assertUnprocessable();
        $this->post('/account-access', ['grant_token' => $second, ...$this->passwordData()])->assertRedirect('/login');
        $this->assertFalse($target->fresh()->hasMfa());
        $this->actingAs($target->fresh())->withSession(['security_version' => $epoch])->getJson('/v1/patients')->assertUnauthorized();
    }

    public function test_owner_cannot_reset_other_clinic_owner_or_privileged_or_shared_user(): void
    {
        $this->signIn('OWNER_A', true);
        $this->postJson('/workspace/team/'.$this->id('MEM_RECEPTION_B').'/access')->assertNotFound();
        $this->postJson('/workspace/team/'.$this->id('MEM_OWNER_A').'/access')->assertForbidden();
        DB::table('memberships')->insert(['id' => (string) Str::uuid(), 'user_id' => $this->id('RECEPTION_A'), 'clinic_id' => $this->id('CLINIC_B'), 'role' => 'owner']);
        $this->postJson('/workspace/team/'.$this->id('MEM_RECEPTION_A').'/access')->assertForbidden();
        $this->assertSame(0, DB::table('account_grants')->count());
    }

    public function test_reception_doctor_and_unverified_owner_cannot_administer_team(): void
    {
        foreach (['RECEPTION_A', 'DOCTOR_A'] as $code) {
            $this->signIn($code);
            $this->postJson('/workspace/team', ['username' => 'forbidden_user', 'display_name' => 'وهمي', 'role' => 'owner'])->assertForbidden();
            $this->postJson('/workspace/team/'.$this->id('MEM_RECEPTION_A').'/access')->assertForbidden();
            Auth::logout();
        }
        $this->signIn('OWNER_A');
        $this->postJson('/workspace/team', [])->assertStatus(423);
    }

    public function test_role_escalation_and_client_clinic_are_rejected_and_recent_confirmation_required(): void
    {
        $this->signIn('OWNER_A', true);
        $data = ['username' => 'test_new_member', 'display_name' => 'حساب وهمي', 'role' => 'owner'];
        $this->postJson('/workspace/team', $data)->assertUnprocessable();
        $this->postJson('/workspace/team', [...$data, 'role' => 'reception', 'clinic_id' => $this->id('CLINIC_B')])->assertUnprocessable();
        $this->travel(11)->minutes();
        $this->postJson('/workspace/team', [...$data, 'role' => 'reception'])->assertStatus(423);
    }

    public function test_suspend_prevents_login_and_recovery_until_explicitly_resumed(): void
    {
        $target = $this->user('RECEPTION_A');
        $this->signIn('OWNER_A', true);
        $path = '/workspace/team/'.$this->id('MEM_RECEPTION_A').'/suspend';
        $this->post($path, ['suspended' => true, 'reason' => 'staff_change'])->assertRedirect();
        $this->assertTrue($target->fresh()->access_suspended);
        $this->postJson('/workspace/team/'.$this->id('MEM_RECEPTION_A').'/access')->assertUnprocessable();
        $this->post($path, ['suspended' => false, 'reason' => 'reactivation'])->assertRedirect();
        $this->assertTrue($target->fresh()->login_enabled);
        $this->assertFalse($target->fresh()->access_suspended);
        $this->post('/logout');
        $this->post('/login', ['username' => $target->username, 'password' => self::PASSWORD])->assertRedirect('/workspace');
    }

    public function test_grant_expiry_and_security_epoch_are_enforced(): void
    {
        $target = $this->user('RECEPTION_A');
        $this->signIn('OWNER_A', true);
        $url = $this->privateNotice($this->post('/workspace/team/'.$this->id('MEM_RECEPTION_A').'/access'))['account_link'];
        $token = $this->token($url);
        $this->post('/logout');
        $this->travel(31)->minutes();
        $this->postJson('/account-access', ['grant_token' => $token, ...$this->passwordData()])->assertUnprocessable();
        $this->travelBack();
        $target->increment('security_version');
        $this->postJson('/account-access', ['grant_token' => $token, ...$this->passwordData()])->assertUnprocessable();
        $this->assertFalse(Hash::check('AnotherSynthetic123', $target->fresh()->password));
    }

    public function test_only_platform_admin_can_issue_owner_recovery(): void
    {
        $this->signIn('OWNER_A', true);
        $path = '/platform/accounts/'.$this->id('OWNER_B').'/access';
        $this->postJson($path)->assertForbidden();
        Auth::logout();
        $this->signIn('PLATFORM', true);
        $response = $this->post($path)->assertRedirect('/platform/accounts');
        $this->assertArrayHasKey('account_link', $this->privateNotice($response));
        $this->getJson('/v1/patients')->assertNotFound();
    }

    public function test_platform_can_recover_shared_staff_without_patient_access(): void
    {
        $target = $this->user('RECEPTION_A');
        DB::table('memberships')->insert(['id' => (string) Str::uuid(), 'user_id' => $target->id, 'clinic_id' => $this->id('CLINIC_B'), 'role' => 'reception']);
        $this->signIn('PLATFORM', true);
        $response = $this->post('/platform/accounts/'.$target->id.'/access')->assertRedirect('/platform/accounts');
        $this->assertArrayHasKey('account_link', $this->privateNotice($response));
        $this->assertFalse($target->fresh()->login_enabled);
        $this->getJson('/v1/patients')->assertNotFound();
    }

    public function test_old_revoked_session_can_open_and_use_its_private_recovery_link(): void
    {
        $target = $this->user('RECEPTION_A');
        $old = $target->security_version;
        $this->signIn('OWNER_A', true);
        $url = $this->privateNotice($this->post('/workspace/team/'.$this->id('MEM_RECEPTION_A').'/access'))['account_link'];
        $this->actingAs($target->fresh())->withSession(['security_version' => $old]);
        $this->get('/account-access')->assertOk();
        $this->assertGuest();
        $this->post('/account-access', ['grant_token' => $this->token($url), ...$this->passwordData()])->assertRedirect('/login');
        $this->assertTrue($target->fresh()->login_enabled);
        $this->assertTrue(Hash::check('AnotherSynthetic123', $target->fresh()->password));
    }
}
