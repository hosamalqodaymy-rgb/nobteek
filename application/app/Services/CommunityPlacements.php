<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CommunityPlacements
{
    public const MOVES = [
        'shortlist' => ['employer', 'applied', 'shortlisted'],
        'interview' => ['employer', 'shortlisted', 'interview'],
        'offer' => ['employer', 'interview', 'offered'],
        'accept' => ['candidate', 'offered', 'accepted'],
        'decline_offer' => ['candidate', 'offered', 'declined'],
        'decline_invitation' => ['candidate', 'invited', 'declined'],
    ];

    public function __construct(private CommunityHiring $hiring) {}

    private function visible(array $scope): Builder
    {
        abort_unless(in_array($scope['role'], ['employer', 'candidate'], true), 403);
        $query = DB::table('community_job_cases as j');

        return $scope['role'] === 'candidate' ? $query->where('j.candidate_id', $scope['user_id'])
            : $query->where('j.clinic_id', $scope['clinic_id']);
    }

    public function applications(array $scope): array
    {
        return $this->visible($scope)->join('community_job_adverts as a', 'a.id', '=', 'j.advert_id')->join('clinics as c', 'c.id', '=', 'j.clinic_id')
            ->orderByDesc('j.updated_at')->orderBy('j.id')->simplePaginate(20, [
                'j.id', 'j.state', 'j.updated_at', 'a.title', 'a.kind', 'c.display_name as clinic_name',
            ])->withQueryString()->toArray();
    }

    public function application(string $id, array $scope): array
    {
        $record = $this->visible($scope)->join('community_job_adverts as a', 'a.id', '=', 'j.advert_id')->join('clinics as c', 'c.id', '=', 'j.clinic_id')
            ->where('j.id', $id)->firstOrFail([
                'j.id', 'j.state', 'j.profile_snapshot', 'j.candidate_message', 'j.invitation_message', 'j.interview_on', 'j.interview_location',
                'j.starts_on', 'j.offer_details', 'j.candidate_started_at', 'j.employer_started_at', 'j.advert_id', 'a.title', 'a.kind', 'c.display_name as clinic_name',
            ]);
        $hasProfile = $scope['role'] === 'candidate' && $this->hiring->profile($scope['user_id']) !== null;
        $fee = $record->state === 'hired' ? DB::table('community_hiring_fees')->where('case_id', $id)->where('billed_role', $scope['role'])
            ->first(['amount_cents', 'currency', 'simulated', 'issued_at']) : null;
        $record->profile_snapshot = $record->profile_snapshot ? json_decode($record->profile_snapshot, true, flags: JSON_THROW_ON_ERROR) : null;

        return ['record' => $record, 'fee' => $fee, 'hasProfile' => $hasProfile];
    }

    private function snapshot(string $userId, bool $includeCv): string
    {
        $profile = $this->hiring->profile($userId);
        abort_unless($profile, 422, 'أكمل ملفك المهني قبل مشاركته.');
        if (! $includeCv) {
            unset($profile->cv_name);
        }

        return json_encode($profile, JSON_THROW_ON_ERROR);
    }

    public function apply(array $scope, string $advertId, ?string $message, bool $includeCv): string
    {
        abort_unless($scope['role'] === 'candidate', 403);
        $advert = $this->hiring->openAdvert($advertId, 'vacancy');
        $keys = ['advert_id' => $advert->id, 'candidate_id' => $scope['user_id'], 'clinic_id' => $advert->publisher_clinic_id];
        abort_if(DB::table('community_job_cases')->where($keys)->exists(), 409, 'سبق إرسال طلب للتقديم على هذه الفرصة.');

        return $this->insert($keys, ['state' => 'applied', 'profile_snapshot' => $this->snapshot($scope['user_id'], $includeCv), 'candidate_message' => $message]);
    }

    public function invite(array $scope, string $advertId, ?string $message): string
    {
        abort_unless($scope['role'] === 'employer', 403);
        $advert = $this->hiring->openAdvert($advertId, 'seeker');
        $keys = ['advert_id' => $advert->id, 'candidate_id' => $advert->publisher_user_id, 'clinic_id' => $scope['clinic_id']];
        abort_if(DB::table('community_job_cases')->where($keys)->exists(), 409, 'سبق إرسال دعوة لهذه البطاقة.');

        return $this->insert($keys, ['state' => 'invited', 'invitation_message' => $message]);
    }

    private function insert(array $keys, array $data): string
    {
        $id = (string) Str::uuid();
        DB::table('community_job_cases')->insert([...$keys, ...$data, 'id' => $id, 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    public function acceptInvitation(array $scope, string $id, ?string $message, bool $includeCv): string
    {
        abort_unless($scope['role'] === 'candidate', 403);
        $case = $this->visible($scope)->where('j.id', $id)->lockForUpdate()->firstOrFail();
        abort_unless($case->state === 'invited', 409, 'الدعوة غير متاحة في الحالة الحالية.');
        $this->hiring->openAdvert($case->advert_id, 'seeker');
        abort_unless(DB::table('clinics')->where('id', $case->clinic_id)->where('operational_state', 'active')->exists(), 409, 'المنشأة غير متاحة.');

        return $this->update($id, ['state' => 'applied', 'profile_snapshot' => $this->snapshot($scope['user_id'], $includeCv), 'candidate_message' => $message]);
    }

    public function transition(array $scope, string $id, string $action, array $data): string
    {
        $case = $this->visible($scope)->where('j.id', $id)->lockForUpdate()->firstOrFail();
        [$role, $before, $after] = self::MOVES[$action];
        abort_unless($scope['role'] === $role, 403);
        abort_unless($case->state === $before, 409, 'هذه الخطوة غير متاحة في الحالة الحالية.');
        if ($action === 'offer') {
            abort_if($data['starts_on'] < $case->interview_on, 422, 'اختر تاريخ مباشرة يوافق تاريخ المقابلة أو يأتي بعده.');
        }

        return $this->update($id, ['state' => $after, ...$data]);
    }

    public function confirmStart(array $scope, string $id): string
    {
        $case = $this->visible($scope)->where('j.id', $id)->lockForUpdate()->firstOrFail();
        $role = $scope['role'];
        $actorColumn = $role === 'employer' ? 'employer_started_at' : 'candidate_started_at';
        if ($case->{$actorColumn}) {
            return $id;
        }
        abort_unless($case->state === 'accepted' && $case->starts_on && $case->starts_on <= $this->hiring->today(), 409, 'يتاح التأكيد بعد قبول العرض وحلول تاريخ المباشرة.');
        $completed = $case->candidate_started_at || $case->employer_started_at;
        if ($completed) {
            $kind = DB::table('community_job_adverts')->where('id', $case->advert_id)->value('kind');
            DB::table('community_hiring_fees')->insert([
                'case_id' => $id, 'billed_role' => $kind === 'vacancy' ? 'employer' : 'candidate', 'issued_at' => now(),
            ]);
        }

        return $this->update($id, [$actorColumn => now(), 'state' => $completed ? 'hired' : 'accepted']);
    }

    private function update(string $id, array $changes): string
    {
        DB::table('community_job_cases')->where('id', $id)->update([...$changes, 'updated_at' => now()]);

        return $id;
    }
}
