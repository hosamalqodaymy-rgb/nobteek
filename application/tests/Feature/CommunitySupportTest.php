<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use PHPUnit\Framework\Attributes\Group;
use Tests\SecurityTestCase;

#[Group('postgres')]
class CommunitySupportTest extends SecurityTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['nobteek.community_enabled' => true]);
    }

    public function test_hosted_discovery_requires_the_configured_https_origin_and_isolated_fixtures(): void
    {
        $origin = 'https://qa.nobteek.test';
        $path = '/preview/dhamar/index.html';
        config(['app.url' => $origin, 'nobteek.connected_preview_origin' => $origin]);

        $this->get($origin.$path)->assertOk()->assertSee('nobteek-connected-preview');
        $this->get('http://qa.nobteek.test'.$path)->assertNotFound();
        config(['nobteek.demo_seed_enabled' => false]);
        $this->get($origin.$path)->assertNotFound();
    }

    public function test_hosted_preview_is_gated_by_a_secure_cookie_and_keeps_ticket_reads_stateless(): void
    {
        $origin = 'https://qa.nobteek.test';
        $code = 'synthetic-access-code';
        config(['app.url' => $origin, 'nobteek.connected_preview_origin' => $origin, 'nobteek.connected_preview_code' => $code]);
        $path = $origin.'/preview/dhamar/index.html';
        $gate = $origin.'/qa-access';

        $this->get($path.'?code='.$code)->assertRedirect($gate);
        $this->getJson($origin.'/community/jobs')->assertForbidden();
        $this->get($gate)->assertOk()->assertSee('رمز الوصول التجريبي');
        $this->postJson($gate, ['code' => 'wrong-code'])->assertUnprocessable();
        $cookie = $this->post($gate, ['code' => $code])->assertRedirect($path)->assertCookie('nobteek_preview_access')->getCookie('nobteek_preview_access', decrypt: false);
        $this->assertTrue($cookie->isSecure());
        $this->assertTrue($cookie->isHttpOnly());
        $this->withUnencryptedCookie($cookie->getName(), $cookie->getValue())->get($path)->assertOk();
        $this->getJson($origin.'/v1/tickets/current')->assertNotFound();
    }

    private function communityUser(string $role): User
    {
        return User::factory()->create([
            'community_role' => $role,
            'login_enabled' => true,
            'password' => Hash::make(self::PASSWORD),
        ])->fresh();
    }

    private function createTicket(array $extra = []): array
    {
        return [
            'command_id' => (string) Str::uuid(),
            'topic' => 'booking',
            'subject' => 'استفسار عن حجز تجريبي',
            'body' => 'هل تم تأكيد الموعد التجريبي؟',
            ...$extra,
        ];
    }

    private function updateTicket(string $id, string $action, array $extra = []): TestResponse
    {
        return $this->postJson('/community/support/'.$id, [
            'command_id' => (string) Str::uuid(),
            'action' => $action,
            ...$extra,
        ]);
    }

    public function test_patient_and_support_agent_share_only_the_authorized_thread(): void
    {
        $patient = $this->communityUser('patient');
        $agent = $this->mfa($this->communityUser('support'));

        $this->get('/community/support')->assertRedirect('/login');
        $this->post('/login', ['username' => $patient->username, 'password' => self::PASSWORD])->assertRedirect('/community/support');
        $this->get('/community/support')->assertInertia(fn (Assert $page) => $page->component('CommunitySupport')->where('role', 'patient'));
        $id = $this->postJson('/community/support', $this->createTicket())->assertCreated()->json('id');
        $this->post('/logout')->assertRedirect('/login');

        $this->post('/login', ['username' => $agent->username, 'password' => self::PASSWORD])->assertRedirect('/login/challenge');
        $this->getJson('/community/support/'.$id)->assertUnauthorized();
        $this->post('/login/challenge', ['code' => $this->otp($agent)])->assertRedirect('/workspace');
        $this->getJson('/community/support')->assertOk()->assertJsonPath('inbox.data.0.id', $id);
        $this->updateTicket($id, 'close')->assertConflict();
        $this->updateTicket($id, 'reply', ['body' => 'تأكدنا من حفظ الموعد التجريبي.'])->assertOk();
        $this->post('/logout')->assertRedirect('/login');

        $other = $this->communityUser('patient');
        $this->post('/login', ['username' => $other->username, 'password' => self::PASSWORD])->assertRedirect('/workspace');
        $this->getJson('/community/support')->assertOk()->assertJsonCount(0, 'inbox.data');
        $this->getJson('/community/support/'.$id)->assertNotFound();
        $this->updateTicket($id, 'reply', ['body' => 'رد مراجع مختلف'])->assertNotFound();
        $this->post('/logout')->assertRedirect('/login');

        $this->post('/login', ['username' => $patient->username, 'password' => self::PASSWORD])->assertRedirect('/workspace');
        $this->getJson('/community/support/'.$id)->assertOk()
            ->assertJsonPath('thread.state', 'answered')
            ->assertJsonPath('thread.messages.1.body', 'تأكدنا من حفظ الموعد التجريبي.')
            ->assertJsonPath('thread.messages.1.author_role', 'support')
            ->assertJsonPath('thread.assignee', null)
            ->assertJsonCount(0, 'agents')
            ->assertJsonMissingPath('thread.messages.1.author_id');
        $this->updateTicket($id, 'close')->assertForbidden();
        $this->updateTicket($id, 'reply', ['body' => 'شكرًا على المتابعة.'])->assertOk();
        $this->getJson('/community/support/'.$id)->assertJsonPath('thread.state', 'open');
    }

    public function test_commands_are_idempotent_and_require_current_permissions(): void
    {
        $patient = $this->communityUser('patient');
        $agent = $this->communityUser('support');
        $colleague = $this->mfa($this->communityUser('support'));
        $ticket = $this->createTicket();

        $this->actingAs($patient)->withSession(['security_version' => $patient->security_version]);
        $this->postJson('/community/support', $this->createTicket(['body' => 'أ']))->assertUnprocessable();
        $id = $this->postJson('/community/support', $ticket)->assertCreated()->json('id');
        $this->postJson('/community/support', $ticket)->assertCreated()->assertJsonPath('id', $id);
        $this->postJson('/community/support', [...$ticket, 'body' => 'تغيرت تفاصيل الرسالة التجريبية.'])->assertConflict();
        $this->assertSame(1, DB::table('community_support_messages')->where('ticket_id', $id)->count());

        $this->actingAs($agent)->withSession(['security_version' => $agent->security_version]);
        $this->get('/community/support')->assertRedirect('/account/security');
        $this->getJson('/community/support/'.$id)->assertStatus(423);
        $this->mfa($agent);
        $this->actingAs($agent)->withSession(['mfa_verified_version' => $agent->security_version]);
        $this->updateTicket($id, 'assign', ['assignee' => $patient->id])->assertUnprocessable();
        $this->updateTicket($id, 'assign', ['assignee' => $colleague->id])->assertOk();
        $this->getJson('/community/support/'.$id)->assertNotFound();

        $this->actingAs($colleague)->withSession(['security_version' => $colleague->security_version, 'mfa_verified_version' => $colleague->security_version]);
        $this->getJson('/community/support?filter=mine')->assertJsonPath('inbox.data.0.id', $id);
        $reply = ['command_id' => (string) Str::uuid(), 'body' => 'تمت مراجعة الطلب التجريبي.'];
        $this->updateTicket($id, 'reply', $reply)->assertOk();
        $this->updateTicket($id, 'reply', $reply)->assertOk();
        $this->updateTicket($id, 'close')->assertOk();
        $this->updateTicket($id, 'reply', ['body' => 'رد بعد الإغلاق'])->assertConflict();
        $this->assertSame(2, DB::table('community_support_messages')->where('ticket_id', $id)->count());
        $this->getJson('/community/support?filter=closed')->assertJsonPath('inbox.data.0.state', 'closed');

        $this->signIn('RECEPTION_A');
        $this->getJson('/community/support')->assertForbidden();
        config(['nobteek.community_enabled' => false]);
        $this->actingAs($patient)->withSession(['security_version' => $patient->security_version]);
        $this->getJson('/community/support')->assertNotFound();
        $this->postJson('/community/support', $ticket)->assertNotFound();
    }
}
