<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\CommunityCommands;
use App\Services\CommunityHiring;
use App\Services\CommunityPlacements;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class CommunityHiringController extends Controller
{
    public function __construct(private CommunityHiring $hiring, private CommunityPlacements $placements) {}

    public function index(Request $request): Response|JsonResponse
    {
        $scope = $this->scope($request);
        $profession = $request->validate(['profession' => ['nullable', Rule::in(CommunityHiring::PROFESSIONS)]])['profession'] ?? null;

        return $this->page($request, $scope, 'browse', ['listing' => $this->hiring->browse($profession), 'profession' => $profession]);
    }

    public function advert(Request $request, string $advert): Response|JsonResponse
    {
        $scope = $this->scope($request);

        return $this->page($request, $scope, 'advert', ['advert' => $this->hiring->advert($advert, $scope)]);
    }

    public function manage(Request $request): Response|JsonResponse
    {
        $scope = $this->scope($request);
        $tabs = CommunityHiring::TABS[$scope['role']] ?? null;
        abort_unless($tabs, 403);
        $tab = $request->validate(['tab' => ['nullable', Rule::in($tabs)]])['tab'] ?? $tabs[0];
        $data = match ($tab) {
            'profile' => ['profile' => $this->hiring->profile($scope['user_id'])],
            'cases' => ['listing' => $this->placements->applications($scope)],
            default => ['listing' => $this->hiring->listings($tab, $scope)],
        };
        if ($tab === 'posts' && $scope['role'] === 'candidate') {
            $data['hasProfile'] = $this->hiring->profile($scope['user_id']) !== null;
        }

        return $this->page($request, $scope, $tab, $data);
    }

    public function apply(Request $request, string $advert): Response|JsonResponse
    {
        $scope = $this->scope($request);
        abort_unless($scope['role'] === 'candidate', 403);
        $details = $this->hiring->advert($advert, $scope);
        abort_unless($details['open'] && $details['record']->kind === 'vacancy', 404);

        return $this->page($request, $scope, 'apply', [
            'advert' => $details, 'profile' => $this->hiring->profile($scope['user_id']),
        ]);
    }

    public function application(Request $request, string $application): Response|JsonResponse
    {
        $scope = $this->scope($request);

        return $this->page($request, $scope, 'case', ['application' => $this->placements->application($application, $scope)]);
    }

    public function store(Request $request, CommunityCommands $commands): RedirectResponse|JsonResponse
    {
        $scope = $this->scope($request);
        abort_if($scope['role'] === 'guest', 403);
        $base = $request->validate([
            'command_id' => ['required', 'uuid'],
            'action' => ['required', Rule::in([
                'save_profile', 'save_advert', 'close_advert', 'review_advert', 'save', 'remove', 'report', 'resolve_report',
                'apply', 'invite', 'accept_invitation', 'confirm_start', ...array_keys(CommunityPlacements::MOVES),
            ])],
        ]);
        $action = $base['action'];
        $data = $this->validateCommand($request, $action, $scope['role']);

        $id = $commands->run($request, 'hiring.'.$action, $base['command_id'], $data, function (User $actor) use ($scope, $request, $action, $data): string {
            $current = $this->hiring->scope($request, $actor, forUpdate: true);
            abort_unless($current === $scope, 403);

            return $this->perform($current, $action, $data);
        });

        if ($request->expectsJson()) {
            return response()->json(['id' => $id], match ($action) {
                'save_advert' => empty($data['id']) ? 201 : 200,
                'apply', 'invite', 'report' => 201,
                default => 200,
            });
        }

        return $this->redirectAfter($action, $id, $data);
    }

    private function scope(Request $request): array
    {
        abort_unless(config('nobteek.community_enabled'), 404);

        return $this->hiring->scope($request, $request->user());
    }

    private function page(Request $request, array $scope, string $view, array $data): Response|JsonResponse
    {
        $props = [
            'role' => $scope['role'],
            'clinicName' => $scope['clinic_name'],
            'view' => $view,
            'tabs' => CommunityHiring::TABS[$scope['role']] ?? [],
            'today' => $this->hiring->today(),
            'urls' => [
                'browse' => route('community.jobs'),
                'manage' => route('community.jobs.manage'),
                'store' => route('community.jobs.store'),
                'directory' => DhamarPreviewController::available($request) && in_array($scope['role'], ['candidate', 'guest'], true) && (! $request->user() || $scope['role'] === 'candidate')
                    ? route('dhamar.preview') : null,
            ],
            ...$data,
        ];

        return $request->expectsJson() ? response()->json($props) : Inertia::render('CommunityJobs', $props);
    }

    private function validateCommand(Request $request, string $action, string $role): array
    {
        $id = ['id' => ['required', 'uuid']];
        $date = ['required', 'date_format:Y-m-d', 'after_or_equal:'.$this->hiring->today()];
        $message = ['message' => ['nullable', 'string', 'max:450']];
        $consent = ['consent' => ['accepted'], 'include_cv' => ['nullable', 'boolean']];
        $employer = $role === 'employer';

        return $request->validate(match ($action) {
            'save_profile' => [
                'name' => ['required', 'string', 'min:2', 'max:60'],
                'profession' => ['required', Rule::in(CommunityHiring::PROFESSIONS)],
                'specialty' => ['required', 'string', 'min:2', 'max:70'],
                'area' => ['required', 'string', 'min:2', 'max:60'],
                'experience' => ['required', 'integer', 'between:0,70'],
                'bio' => ['nullable', 'string', 'max:450'],
                'cv_name' => ['nullable', 'string', 'max:100'],
                'return_advert' => ['nullable', 'uuid'],
            ],
            'save_advert' => [
                'id' => ['nullable', 'uuid'],
                'title' => ['required', 'string', 'min:3', 'max:90'],
                'profession' => [Rule::excludeIf(! $employer), 'required', Rule::in(CommunityHiring::PROFESSIONS)],
                'specialty' => [Rule::excludeIf(! $employer), 'required', 'string', 'min:2', 'max:70'],
                'area' => ['required', 'string', 'min:2', 'max:60'],
                'branch' => [Rule::excludeIf(! $employer), 'required', 'string', 'min:2', 'max:80'],
                'work_type' => ['required', Rule::in(CommunityHiring::WORK_TYPES)],
                'deadline' => $date,
                'description' => ['required', 'string', 'min:10', 'max:700'],
                'requirements' => [Rule::excludeIf(! $employer), 'required', 'string', 'min:5', 'max:400'],
                'consent' => [Rule::excludeIf($employer), 'accepted'],
            ],
            'review_advert' => [...$id,
                'decision' => ['required', Rule::in(['published', 'revision', 'rejected'])],
                'note' => ['required_unless:decision,published', 'nullable', 'string', 'min:4', 'max:160'],
            ],
            'apply', 'accept_invitation' => [...$id, ...$message, ...$consent],
            'invite' => [...$id, ...$message],
            'report' => [...$id, 'reason' => ['required', 'string', 'min:5', 'max:250']],
            'resolve_report' => [...$id, 'hide' => ['required', 'boolean']],
            'interview' => [...$id, 'interview_on' => $date, 'interview_location' => ['required', 'string', 'min:2', 'max:100']],
            'offer' => [...$id, 'starts_on' => $date, 'offer_details' => ['required', 'string', 'min:5', 'max:450']],
            default => $id,
        });
    }

    private function perform(array $scope, string $action, array $data): string
    {
        $id = $data['id'] ?? null;
        $message = $data['message'] ?? null;
        $includeCv = (bool) ($data['include_cv'] ?? false);

        return match ($action) {
            'save_profile' => $this->hiring->saveProfile($scope, [...['bio' => null, 'cv_name' => null], ...Arr::except($data, 'return_advert')]),
            'save_advert' => $this->hiring->saveAdvert($scope, Arr::except($data, ['id', 'consent']), $id),
            'close_advert' => $this->hiring->close($scope, $id),
            'review_advert' => $this->hiring->review($scope, $id, $data['decision'], $data['note'] ?? null),
            'save', 'remove' => $this->hiring->bookmark($scope, $id, $action === 'save'),
            'report' => $this->hiring->report($scope, $id, $data['reason']),
            'resolve_report' => $this->hiring->resolveReport($scope, $id, (bool) $data['hide']),
            'apply' => $this->placements->apply($scope, $id, $message, $includeCv),
            'invite' => $this->placements->invite($scope, $id, $message),
            'accept_invitation' => $this->placements->acceptInvitation($scope, $id, $message, $includeCv),
            'confirm_start' => $this->placements->confirmStart($scope, $id),
            default => $this->placements->transition($scope, $id, $action, Arr::except($data, 'id')),
        };
    }

    private function redirectAfter(string $action, string $id, array $data): RedirectResponse
    {
        [$url, $arguments, $status] = match ($action) {
            'save_profile' => ! empty($data['return_advert'])
                ? ['community.jobs.apply', $data['return_advert'], 'حُفظ الملف المهني الخاص.']
                : ['community.jobs.manage', ['tab' => 'profile'], 'حُفظ الملف المهني الخاص.'],
            'save_advert' => ['community.jobs.advert', $id, 'أُرسل الإعلان للمراجعة.'],
            'close_advert' => ['community.jobs.manage', ['tab' => 'posts'], 'أُغلق الإعلان.'],
            'review_advert' => ['community.jobs.manage', ['tab' => 'review'], 'حُفظ قرار المراجعة.'],
            'resolve_report' => ['community.jobs.manage', ['tab' => 'reports'], 'حُفظت مراجعة البلاغ.'],
            'report' => ['community.jobs.advert', $data['id'], 'أُرسل البلاغ إلى مدير المنصة.'],
            'save', 'remove' => ['community.jobs.advert', $id, $action === 'save' ? 'أُضيفت الفرصة إلى المحفوظة.' : 'أُزيلت الفرصة من المحفوظة.'],
            'apply' => ['community.jobs.case', $id, 'أُرسل طلب التقديم إلى المنشأة.'],
            'invite' => ['community.jobs.case', $id, 'أُرسلت الدعوة إلى المرشح.'],
            default => ['community.jobs.case', $id, 'حُفظ تحديث الطلب.'],
        };

        return to_route($url, $arguments)->with('status', $status);
    }
}
