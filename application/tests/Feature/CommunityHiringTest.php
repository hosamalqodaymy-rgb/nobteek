<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use PHPUnit\Framework\Attributes\Group;
use Tests\SecurityTestCase;

#[Group('postgres')]
class CommunityHiringTest extends SecurityTestCase
{
    private const JOBS = '/community/jobs';

    private const MANAGE = self::JOBS.'/manage';

    protected function setUp(): void
    {
        parent::setUp();
        config(['nobteek.community_enabled' => true]);
    }

    private function candidate(?User $user = null): User
    {
        $user ??= User::factory()->create(['community_role' => 'patient', 'login_enabled' => true, 'password' => Hash::make(self::PASSWORD)])->fresh();
        $this->actingAs($user)->withSession(['security_version' => $user->security_version, 'membership_id' => null, 'mfa_verified_version' => null]);

        return $user;
    }

    private function command(string $action, array $data = []): TestResponse
    {
        return $this->postJson(self::MANAGE, [
            'command_id' => (string) Str::uuid(),
            'action' => $action,
            ...$data,
        ]);
    }

    private function posting(array $changes = []): array
    {
        return [
            'title' => 'أخصائي مختبرات للتجربة',
            'profession' => 'laboratory',
            'specialty' => 'المختبرات الطبية',
            'area' => 'ذمار',
            'branch' => 'الفرع التجريبي',
            'work_type' => 'full',
            'deadline' => now('Asia/Aden')->addDays(7)->toDateString(),
            'description' => 'فرصة تجريبية للعمل ضمن فريق المختبر في المنشأة.',
            'requirements' => 'خبرة مهنية في المختبرات الطبية.',
            ...$changes,
        ];
    }

    private function profile(array $changes = []): array
    {
        return [
            'name' => 'ممارس مهني تجريبي',
            'profession' => 'laboratory',
            'specialty' => 'مختبر سريري',
            'area' => 'ذمار',
            'experience' => 5,
            'bio' => 'نبذة مهنية لا تعرض في الدليل العام.',
            'cv_name' => 'SyntheticCV.pdf',
            ...$changes,
        ];
    }

    private function advanceToOffer(string $id, string $interview, string $start): void
    {
        $this->command('offer', ['id' => $id, 'starts_on' => $start, 'offer_details' => 'تفاصيل عرض وظيفي تجريبي.'])->assertConflict();
        $this->command('shortlist', ['id' => $id])->assertOk();
        $this->command('interview', ['id' => $id, 'interview_on' => $interview, 'interview_location' => 'الاستقبال التجريبي'])->assertOk();
        $tooEarly = now('Asia/Aden')->subDay()->toDateString();
        $this->command('offer', ['id' => $id, 'starts_on' => $tooEarly, 'offer_details' => 'تاريخ عرض غير صالح.'])->assertUnprocessable();
        $this->command('offer', ['id' => $id, 'starts_on' => $start, 'offer_details' => 'تفاصيل عرض وظيفي تجريبي.'])->assertOk();
    }

    public function test_vacancy_is_public_only_after_review_and_bills_the_publisher_only_after_both_start_confirmations(): void
    {
        $today = now('Asia/Aden')->toDateString();
        $tomorrow = now('Asia/Aden')->addDay()->toDateString();
        $adData = [...$this->posting(), 'command_id' => (string) Str::uuid()];
        $this->get(self::JOBS)->assertOk()->assertInertia(fn (Assert $page) => $page->component('CommunityJobs')->where('role', 'guest'));
        $this->getJson(self::MANAGE)->assertUnauthorized();
        $this->signIn('RECEPTION_A');
        $this->command('save_advert', $adData)->assertForbidden();

        $this->signIn('OWNER_A', true);
        $id = $this->command('save_advert', $adData)->assertCreated()->json('id');
        $this->command('save_advert', $adData)->assertCreated()->assertJsonPath('id', $id);
        $this->command('save_advert', [...$adData, 'title' => 'إعلان مختلف بنفس مفتاح الطلب'])->assertConflict();
        $this->getJson(self::JOBS.'/'.$id)->assertJsonPath('advert.record.state', 'pending')->assertJsonPath('advert.mine', true);
        $this->signIn('OWNER_B', true);
        $this->getJson(self::JOBS.'/'.$id)->assertNotFound();
        $this->command('review_advert', ['id' => $id, 'decision' => 'published'])->assertForbidden();

        $this->signIn('PLATFORM');
        $this->getJson(self::JOBS.'/'.$id)->assertStatus(423);
        $this->signIn('PLATFORM', true);
        $this->getJson(self::MANAGE.'?tab=review')->assertJsonPath('listing.data.0.id', $id);
        $this->command('review_advert', ['id' => $id, 'decision' => 'published'])->assertOk();
        $this->post('/logout')->assertRedirect('/login');
        $this->getJson(self::JOBS.'?profession=laboratory')->assertOk()->assertJsonPath('listing.data.0.id', $id);
        $this->getJson(self::JOBS.'?profession=nursing')->assertOk()->assertJsonCount(0, 'listing.data');
        $this->getJson(self::JOBS.'/'.$id)->assertOk()
            ->assertJsonMissingPath('advert.record.publisher_clinic_id')->assertJsonMissingPath('advert.record.review_note');

        $candidate = $this->candidate();
        $this->command('save_profile', $this->profile())->assertOk();
        $this->command('apply', ['id' => $id, 'consent' => false])->assertUnprocessable();
        $request = ['id' => $id, 'consent' => true, 'command_id' => (string) Str::uuid()];
        $case = $this->command('apply', $request)->assertCreated()->json('id');
        $this->command('apply', $request)->assertCreated()->assertJsonPath('id', $case);
        $this->command('apply', [...$request, 'command_id' => (string) Str::uuid()])->assertConflict();
        $this->getJson(self::MANAGE.'/'.$case)->assertJsonPath('application.record.state', 'applied');
        $this->command('shortlist', ['id' => $case])->assertForbidden();
        $this->candidate();
        $this->getJson(self::MANAGE.'/'.$case)->assertNotFound();
        $this->signIn('OWNER_B', true);
        $this->getJson(self::MANAGE.'/'.$case)->assertNotFound();
        $this->signIn('PLATFORM', true);
        $this->getJson(self::MANAGE.'/'.$case)->assertForbidden();

        $this->signIn('OWNER_A', true);
        $this->getJson(self::MANAGE.'/'.$case)->assertOk()->assertJsonPath('application.record.profile_snapshot.name', 'ممارس مهني تجريبي')
            ->assertJsonMissingPath('application.record.profile_snapshot.cv_name');
        $this->advanceToOffer($case, $today, $tomorrow);
        $this->candidate($candidate);
        $this->command('accept', ['id' => $case])->assertOk();
        $this->command('confirm_start', ['id' => $case])->assertConflict();
        $this->assertDatabaseCount('community_hiring_fees', 0);
        $this->travel(1)->days();
        $this->command('confirm_start', ['id' => $case])->assertOk();
        $this->assertDatabaseCount('community_hiring_fees', 0);

        $this->signIn('OWNER_A', true);
        $this->command('confirm_start', ['id' => $case])->assertOk();
        $this->command('confirm_start', ['id' => $case])->assertOk();
        $this->getJson(self::MANAGE.'/'.$case)->assertJsonPath('application.record.state', 'hired')
            ->assertJsonPath('application.fee.amount_cents', 5000)->assertJsonPath('application.fee.currency', 'USD')->assertJsonPath('application.fee.simulated', true);
        $this->assertDatabaseCount('community_hiring_fees', 1);
        $this->assertDatabaseHas('community_hiring_fees', ['case_id' => $case, 'billed_role' => 'employer', 'simulated' => true]);
        $this->candidate($candidate);
        $this->getJson(self::MANAGE.'/'.$case)->assertJsonPath('application.fee', null);
    }

    public function test_seeker_card_only_shares_private_profile_after_consent_and_bills_the_seeker_for_their_post(): void
    {
        $candidate = $this->candidate();
        $this->command('save_profile', $this->profile())->assertOk();
        $data = $this->posting(['title' => 'أبحث عن فرصة في مختبر']);
        $this->command('save_advert', [...$data, 'consent' => false])->assertUnprocessable();
        $id = $this->command('save_advert', [...$data, 'consent' => true])->assertCreated()->json('id');
        $this->signIn('PLATFORM', true);
        $this->command('review_advert', ['id' => $id, 'decision' => 'published'])->assertOk();
        $this->post('/logout')->assertRedirect('/login');
        $this->getJson(self::JOBS.'/'.$id)->assertNotFound();
        $this->getJson(self::JOBS)->assertJsonCount(0, 'listing.data');
        $this->candidate();
        $this->getJson(self::JOBS.'/'.$id)->assertNotFound();

        $this->signIn('OWNER_A', true);
        $this->getJson(self::MANAGE.'?tab=candidates')->assertOk()->assertJsonPath('listing.data.0.id', $id);
        $this->getJson(self::JOBS.'/'.$id)->assertOk()->assertJsonMissingPath('advert.record.publisher_user_id')
            ->assertDontSee('SyntheticCV.pdf')->assertDontSee('ممارس مهني تجريبي');
        $case = $this->command('invite', ['id' => $id, 'message' => 'ندعوك للتقديم لمنشأتنا التجريبية.'])->assertCreated()->json('id');
        $this->getJson(self::MANAGE.'/'.$case)->assertJsonPath('application.record.profile_snapshot', null);
        $this->signIn('OWNER_B', true);
        $this->getJson(self::MANAGE.'/'.$case)->assertNotFound();

        $this->candidate($candidate);
        $this->command('accept_invitation', ['id' => $case, 'consent' => false])->assertUnprocessable();
        $this->command('accept_invitation', ['id' => $case, 'consent' => true, 'include_cv' => true])->assertOk();
        $this->command('save_profile', $this->profile(['name' => 'اسم مهني معدل']))->assertOk();
        $this->signIn('OWNER_A', true);
        $this->getJson(self::MANAGE.'/'.$case)->assertOk()->assertJsonPath('application.record.profile_snapshot.name', 'ممارس مهني تجريبي')
            ->assertJsonPath('application.record.profile_snapshot.cv_name', 'SyntheticCV.pdf')->assertDontSee('اسم مهني معدل');
        $today = now('Asia/Aden')->toDateString();
        $this->advanceToOffer($case, $today, $today);

        $this->candidate($candidate);
        $this->command('accept', ['id' => $case])->assertOk();
        $this->signIn('OWNER_A', true);
        $this->command('confirm_start', ['id' => $case])->assertOk();
        $this->assertDatabaseCount('community_hiring_fees', 0);
        $this->candidate($candidate);
        $this->command('confirm_start', ['id' => $case])->assertOk();
        $this->getJson(self::MANAGE.'/'.$case)->assertJsonPath('application.record.state', 'hired')->assertJsonPath('application.fee.amount_cents', 5000);
        $this->assertDatabaseHas('community_hiring_fees', ['case_id' => $case, 'billed_role' => 'candidate']);
        $this->assertDatabaseCount('community_hiring_fees', 1);
        $this->signIn('OWNER_A', true);
        $this->getJson(self::MANAGE.'/'.$case)->assertJsonPath('application.fee', null);
    }

    public function test_revision_bookmarks_reports_and_flag_respect_role_and_visibility(): void
    {
        $this->signIn('OWNER_A', true);
        $id = $this->command('save_advert', $this->posting())->assertCreated()->json('id');
        $this->signIn('PLATFORM', true);
        $this->command('review_advert', ['id' => $id, 'decision' => 'revision', 'note' => 'أضف تفاصيل الوظيفة.'])->assertOk();
        $this->signIn('OWNER_B', true);
        $this->command('save_advert', [...$this->posting(), 'id' => $id])->assertNotFound();
        $this->signIn('OWNER_A', true);
        $this->getJson(self::JOBS.'/'.$id)->assertJsonPath('advert.record.review_note', 'أضف تفاصيل الوظيفة.');
        $this->command('save_advert', [...$this->posting(['title' => 'مسؤول مختبر تجريبي']), 'id' => $id])->assertOk();

        $this->signIn('PLATFORM', true);
        $this->command('review_advert', ['id' => $id, 'decision' => 'published'])->assertOk();
        $candidate = $this->candidate();
        $this->command('save', ['id' => $id])->assertOk();
        $this->getJson(self::MANAGE.'?tab=saved')->assertJsonPath('listing.data.0.id', $id);
        $this->command('remove', ['id' => $id])->assertOk();
        $this->getJson(self::MANAGE.'?tab=saved')->assertJsonCount(0, 'listing.data');
        $this->command('save', ['id' => $id])->assertOk();
        $report = $this->command('report', ['id' => $id, 'reason' => 'بلاغ لمراجعة الإعلان التجريبي.'])->assertCreated()->json('id');
        $this->command('report', ['id' => $id, 'reason' => 'بلاغ مكرر للفرصة نفسها.'])->assertConflict();
        $this->command('resolve_report', ['id' => $report, 'hide' => true])->assertForbidden();
        $this->signIn('PLATFORM', true);
        $this->getJson(self::MANAGE.'?tab=reports')->assertJsonPath('listing.data.0.id', $report);
        $this->command('resolve_report', ['id' => $report, 'hide' => true])->assertOk();
        $this->getJson(self::MANAGE.'?tab=reports')->assertJsonCount(0, 'listing.data');

        $this->candidate($candidate);
        $this->getJson(self::MANAGE.'?tab=saved')->assertJsonCount(0, 'listing.data');
        $this->getJson(self::JOBS.'/'.$id)->assertNotFound();
        config(['nobteek.community_enabled' => false]);
        $this->getJson(self::JOBS)->assertNotFound();
        $this->command('save_profile', $this->profile())->assertNotFound();
    }
}
