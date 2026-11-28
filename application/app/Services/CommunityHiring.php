<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

class CommunityHiring
{
    public const PROFESSIONS = ['physician', 'laboratory', 'pharmacy', 'nursing', 'therapy', 'imaging', 'dental', 'other'];

    public const WORK_TYPES = ['full', 'part', 'shifts'];

    public const TABS = [
        'candidate' => ['cases', 'profile', 'posts', 'saved'],
        'employer' => ['posts', 'candidates', 'cases'],
        'moderator' => ['review', 'reports'],
    ];

    /** @return array{role:string, user_id:?string, clinic_id:?string, clinic_name:?string} */
    public function scope(Request $request, ?User $user, bool $forUpdate = false): array
    {
        $clinic = null;
        $role = match (true) {
            $user?->platform_role === 'platform_admin' => 'moderator',
            $user?->community_role === 'patient' => 'candidate',
            default => 'guest',
        };
        if ($role === 'guest' && $user && $user->community_role !== 'support') {
            $memberships = DB::table('memberships as m')->join('clinics as c', 'c.id', '=', 'm.clinic_id')
                ->where('m.user_id', $user->id)->where('m.role', 'owner')->where('m.active', true)->where('c.operational_state', 'active')
                ->select(['m.clinic_id', 'c.display_name']);
            if ($selected = $request->session()->get('membership_id')) {
                $memberships->where('m.id', $selected);
            }
            if ($forUpdate) {
                $memberships->lockForUpdate();
            }
            $available = $memberships->limit(2)->get();
            if ($available->count() === 1) {
                $clinic = $available->first();
                $role = 'employer';
            }
        }

        return ['role' => $role, 'user_id' => $user?->id, 'clinic_id' => $clinic?->clinic_id, 'clinic_name' => $clinic?->display_name];
    }

    public function today(): string
    {
        return now('Asia/Aden')->toDateString();
    }

    private function adverts(): Builder
    {
        return DB::table('community_job_adverts as a')->leftJoin('clinics as c', 'c.id', '=', 'a.publisher_clinic_id')
            ->select([
                'a.id', 'a.kind', 'a.title', 'a.profession', 'a.specialty', 'a.area', 'a.branch', 'a.work_type', 'a.deadline',
                'a.description', 'a.requirements', 'a.state', 'c.display_name as clinic_name',
            ]);
    }

    private function activeAdverts(Builder $query, string $kind): Builder
    {
        $query->where('a.kind', $kind)->where('a.state', 'published')->where('a.deadline', '>=', $this->today());
        if ($kind === 'vacancy') {
            return $query->whereIn('a.publisher_clinic_id', DB::table('clinics')->where('operational_state', 'active')->select('id'));
        }

        return $query->whereIn('a.publisher_user_id', DB::table('users')->where('community_role', 'patient')
            ->where('login_enabled', true)->where('access_suspended', false)->select('id'));
    }

    public function browse(?string $profession): array
    {
        $query = $this->activeAdverts($this->adverts(), 'vacancy');
        if ($profession) {
            $query->where('a.profession', $profession);
        }

        return $query->orderBy('a.deadline')->orderBy('a.id')->simplePaginate(20)->withQueryString()->toArray();
    }

    public function profile(string $userId): ?stdClass
    {
        return DB::table('community_job_profiles')->where('user_id', $userId)
            ->first(['name', 'profession', 'specialty', 'area', 'experience', 'bio', 'cv_name']);
    }

    private function mine(Builder $query, array $scope): Builder
    {
        abort_unless(in_array($scope['role'], ['candidate', 'employer'], true), 403);

        return $scope['role'] === 'candidate' ? $query->where('a.publisher_user_id', $scope['user_id'])
            : $query->where('a.publisher_clinic_id', $scope['clinic_id']);
    }

    public function advert(string $id, array $scope): array
    {
        $record = $this->adverts()->where('a.id', $id)
            ->addSelect(['a.publisher_clinic_id', 'a.publisher_user_id', 'a.review_note'])->firstOrFail();
        $mine = ($scope['role'] === 'candidate' && $record->publisher_user_id === $scope['user_id'])
            || ($scope['role'] === 'employer' && $record->publisher_clinic_id === $scope['clinic_id']);
        $isOpen = $this->activeAdverts(DB::table('community_job_adverts as a'), $record->kind)->where('a.id', $id)->exists();
        $moderator = $scope['role'] === 'moderator';
        abort_unless($mine || $moderator || ($isOpen && ($record->kind === 'vacancy' || $scope['role'] === 'employer')), 404);
        unset($record->publisher_clinic_id, $record->publisher_user_id);
        if (! $mine && ! $moderator) {
            unset($record->review_note);
        }

        return ['record' => $record, 'mine' => $mine, 'open' => $isOpen,
            'saved' => $scope['role'] === 'candidate' && DB::table('community_job_bookmarks')->where('user_id', $scope['user_id'])->where('advert_id', $id)->exists(),
        ];
    }

    public function openAdvert(string $id, string $kind): stdClass
    {
        return $this->activeAdverts(DB::table('community_job_adverts as a'), $kind)->where('a.id', $id)->lockForUpdate()->firstOrFail();
    }

    public function listings(string $tab, array $scope): array
    {
        if ($tab === 'reports') {
            return DB::table('community_job_reports as r')->join('community_job_adverts as a', 'a.id', '=', 'r.advert_id')
                ->whereNull('r.reviewed_at')->orderBy('r.created_at')->orderBy('r.id')->simplePaginate(20, [
                    'r.id', 'r.reason', 'r.advert_id', 'a.title',
                ])->withQueryString()->toArray();
        }

        $query = $this->adverts();
        $query = match ($tab) {
            'posts' => $this->mine($query, $scope)->addSelect('a.review_note'),
            'candidates' => $this->activeAdverts($query, 'seeker'),
            'review' => $query->where('a.state', 'pending'),
            'saved' => $this->activeAdverts($query->join('community_job_bookmarks as b', 'b.advert_id', '=', 'a.id')
                ->where('b.user_id', $scope['user_id']), 'vacancy'),
        };

        return $query->orderByDesc('a.updated_at')->orderBy('a.id')->simplePaginate(20)->withQueryString()->toArray();
    }

    public function saveProfile(array $scope, array $data): string
    {
        abort_unless($scope['role'] === 'candidate', 403);
        $id = $scope['user_id'];
        DB::table('community_job_profiles')->upsert([
            ...$data,
            'user_id' => $id,
            'created_at' => now(),
            'updated_at' => now(),
        ], ['user_id'], [...array_keys($data), 'updated_at']);

        return $id;
    }

    public function saveAdvert(array $scope, array $data, ?string $id): string
    {
        abort_unless(in_array($scope['role'], ['candidate', 'employer'], true), 403);
        $candidate = $scope['role'] === 'candidate';
        $kind = $candidate ? 'seeker' : 'vacancy';
        if ($candidate) {
            $profile = $this->profile($scope['user_id']);
            abort_unless($profile, 422, 'أكمل ملفك المهني قبل إرسال بطاقة البحث عن عمل.');
            $data['profession'] = $profile->profession;
            $data['specialty'] = $profile->specialty;
        }
        if ($id) {
            $record = $this->mine(DB::table('community_job_adverts as a'), $scope)->where('a.id', $id)->lockForUpdate()->firstOrFail();
            abort_unless($record->state === 'revision', 409, 'التعديل متاح عندما يطلب المدير استكمال الإعلان.');
        }
        $duplicates = $this->mine(DB::table('community_job_adverts as a'), $scope)
            ->where('a.kind', $kind)->whereIn('a.state', ['pending', 'published', 'revision'])->where('a.deadline', '>=', $this->today());
        if (! $candidate) {
            $duplicates->whereRaw('lower(a.title) = lower(?)', [$data['title']]);
        }
        if ($id) {
            $duplicates->where('a.id', '!=', $id);
        }
        abort_if($duplicates->exists(), 409, 'يوجد إعلان جارٍ لهذا المسمى أو الملف.');
        $fields = [...$data, 'state' => 'pending', 'review_note' => null, 'reviewer_id' => null, 'reviewed_at' => null, 'updated_at' => now()];
        if ($id) {
            DB::table('community_job_adverts')->where('id', $id)->update($fields);

            return $id;
        }
        $id = (string) Str::uuid();
        DB::table('community_job_adverts')->insert([
            ...$fields, 'id' => $id, 'kind' => $kind, 'publisher_user_id' => $candidate ? $scope['user_id'] : null,
            'publisher_clinic_id' => $scope['clinic_id'], 'created_at' => now(),
        ]);

        return $id;
    }

    public function close(array $scope, string $id): string
    {
        $record = $this->mine(DB::table('community_job_adverts as a'), $scope)->where('a.id', $id)->lockForUpdate()->firstOrFail();
        abort_unless(in_array($record->state, ['pending', 'published', 'revision'], true), 409, 'هذا الإعلان مغلق أو غير متاح.');
        DB::table('community_job_adverts')->where('id', $id)->update(['state' => 'closed', 'updated_at' => now()]);

        return $id;
    }

    public function review(array $scope, string $id, string $state, ?string $note): string
    {
        abort_unless($scope['role'] === 'moderator', 403);
        $record = DB::table('community_job_adverts')->where('id', $id)->lockForUpdate()->firstOrFail();
        abort_unless($record->state === 'pending', 409, 'سبقت مراجعة الإعلان.');
        abort_if($state === 'published' && $record->deadline < $this->today(), 409, 'انتهت مدة الإعلان.');
        DB::table('community_job_adverts')->where('id', $id)->update([
            'state' => $state, 'review_note' => $note, 'reviewer_id' => $scope['user_id'], 'reviewed_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    public function bookmark(array $scope, string $advert, bool $saved): string
    {
        abort_unless($scope['role'] === 'candidate', 403);
        $keys = ['user_id' => $scope['user_id'], 'advert_id' => $advert];
        if ($saved) {
            $this->openAdvert($advert, 'vacancy');
            DB::table('community_job_bookmarks')->insertOrIgnore([...$keys, 'created_at' => now()]);
        } else {
            DB::table('community_job_bookmarks')->where($keys)->delete();
        }

        return $advert;
    }

    public function report(array $scope, string $advert, string $reason): string
    {
        abort_unless($scope['role'] === 'candidate', 403);
        $this->openAdvert($advert, 'vacancy');
        $keys = ['user_id' => $scope['user_id'], 'advert_id' => $advert];
        abort_if(DB::table('community_job_reports')->where($keys)->exists(), 409, 'سبق إرسال بلاغ عن هذا الإعلان.');
        $id = (string) Str::uuid();
        DB::table('community_job_reports')->insert([...$keys, 'id' => $id, 'reason' => $reason, 'created_at' => now()]);

        return $id;
    }

    public function resolveReport(array $scope, string $id, bool $hideAdvert): string
    {
        abort_unless($scope['role'] === 'moderator', 403);
        $report = DB::table('community_job_reports')->where('id', $id)->lockForUpdate()->firstOrFail();
        abort_if($report->reviewed_at !== null, 409, 'سبقت مراجعة البلاغ.');
        DB::table('community_job_reports')->where('id', $id)->update(['reviewer_id' => $scope['user_id'], 'reviewed_at' => now()]);
        if ($hideAdvert) {
            DB::table('community_job_adverts')->where('id', $report->advert_id)->where('state', 'published')->update([
                'state' => 'closed', 'review_note' => 'أُغلق الإعلان بعد مراجعة بلاغ.', 'reviewer_id' => $scope['user_id'], 'reviewed_at' => now(), 'updated_at' => now(),
            ]);
        }

        return $id;
    }
}
