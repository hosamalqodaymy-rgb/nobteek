<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AccountGrants;
use App\Services\AccountSecurity;
use App\Services\SecurityAudit;
use App\Support\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class TeamController extends Controller
{
    public function __construct(private AccountSecurity $security, private AccountGrants $grants, private SecurityAudit $audit) {}

    private function owner(Request $request, bool $lock = false): User
    {
        $context = app(TenantContext::class);
        abort_unless($context->role() === 'owner', 403);
        $actor = $lock ? $this->security->lockedActor($request, recent: true, mfa: true) : $request->user();
        if ($lock) {
            $membership = DB::table('memberships')->where('id', $context->membership['id'])->lockForUpdate()->firstOrFail();
            abort_unless($membership->user_id === $actor->id && $membership->clinic_id === $context->clinicId() && $membership->active && $membership->role === 'owner', 403);
        }

        return $actor;
    }

    private function staff(string $id): User
    {
        $context = app(TenantContext::class);
        $membership = DB::table('memberships')->where('id', $id)->where('clinic_id', $context->clinicId())->lockForUpdate()->firstOrFail();
        abort_unless(in_array($membership->role, ['reception', 'doctor'], true), 403);
        $user = User::whereKey($membership->user_id)->lockForUpdate()->firstOrFail();
        abort_if($user->id === request()->user()->id || $user->platform_role !== null, 403);
        abort_if(DB::table('memberships')->where('user_id', $user->id)->where(fn ($q) => $q->where('role', 'owner')->orWhere('clinic_id', '!=', $context->clinicId()))->exists(), 403,
            'هذا حساب مشترك أو ذو صلاحية أعلى. اطلب من مسؤول المنصة معالجة الوصول.');

        return $user;
    }

    public function index(Request $request): Response
    {
        $this->owner($request);
        $context = app(TenantContext::class);
        $members = DB::table('memberships as m')->join('users as u', 'u.id', '=', 'm.user_id')->where('m.clinic_id', $context->clinicId())
            ->orderBy('m.role')->get(['m.id', 'm.role', 'u.username', 'u.display_name', 'u.login_enabled', 'u.access_suspended', 'u.mfa_confirmed_at']);

        return Inertia::render('Team', ['members' => $members, 'clinic' => $context->membership['clinic_name'] ?? 'عيادتي']);
    }

    public function create(Request $request): RedirectResponse
    {
        $this->owner($request);
        $this->security->throttle($request, 'team_create', $request->user()->id, 10);
        $data = $request->validate(['username' => ['required', 'string', 'min:4', 'max:80', 'regex:/^[a-z][a-z0-9_.-]+$/D'],
            'display_name' => ['required', 'string', 'max:80'], 'role' => ['required', Rule::in(['reception', 'doctor'])], 'clinic_id' => ['prohibited'], 'platform_role' => ['prohibited']]);
        try {
            $url = DB::transaction(function () use ($request, $data): string {
                $actor = $this->owner($request, true);
                if (DB::table('users')->whereRaw('lower(username) = ?', [$data['username']])->exists()) {
                    throw ValidationException::withMessages(['username' => 'اختر اسم دخول آخر.']);
                }
                $user = User::create(['username' => $data['username'], 'display_name' => $data['display_name']]);
                $clinic = app(TenantContext::class)->clinicId();
                DB::table('memberships')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $clinic, 'user_id' => $user->id, 'role' => $data['role']]);

                return $this->grants->issue($actor, $user, $clinic, $request);
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['username' => 'اختر اسم دخول آخر.']);
        }

        return to_route('team')->with('private_notice', Crypt::encryptString(json_encode(['account_link' => $url])))->with('status', 'تم إنشاء الحساب. سلّم الرابط لصاحبه عبر وسيلة خاصة موثوقة خلال ٣٠ دقيقة.');
    }

    public function issue(Request $request, string $membership): RedirectResponse
    {
        $this->security->throttle($request, 'team_grant', $request->user()->id, 10);
        $url = DB::transaction(function () use ($request, $membership): string {
            $actor = $this->owner($request, true);

            return $this->grants->issue($actor, $this->staff($membership), app(TenantContext::class)->clinicId(), $request);
        });

        return to_route('team')->with('private_notice', Crypt::encryptString(json_encode(['account_link' => $url])))->with('status', 'الرابط صالح ٣٠ دقيقة ولمرة واحدة. أُبطلت الجلسات والروابط السابقة للحساب.');
    }

    public function suspend(Request $request, string $membership): RedirectResponse
    {
        $data = $request->validate(['suspended' => ['required', 'boolean'], 'reason' => ['required', Rule::in(['staff_change', 'security', 'reactivation'])]]);
        DB::transaction(function () use ($request, $membership, $data): void {
            $actor = $this->owner($request, true);
            $user = $this->staff($membership);
            $user->forceFill(['access_suspended' => (bool) $data['suspended'], 'login_enabled' => ! $data['suspended'] && $user->password !== null,
                'security_version' => $user->security_version + 1])->save();
            $this->security->revokeGrants($user->id);
            $this->audit->record($data['suspended'] ? 'account_suspended' : 'account_resumed', $actor->id, $user->id, app(TenantContext::class)->clinicId(), $request, ['reason' => $data['reason']]);
        });

        return to_route('team')->with('status', $data['suspended'] ? 'تم إيقاف الحساب وإبطال جلساته.' : 'تم رفع الإيقاف.');
    }

    private function platformActor(Request $request, bool $lock = false): User
    {
        abort_unless($request->user()->platform_role === 'platform_admin', 403);
        $actor = $lock ? $this->security->lockedActor($request, recent: true, mfa: true) : $request->user();
        abort_unless($actor->platform_role === 'platform_admin', 403);

        return $actor;
    }

    public function platform(Request $request): Response
    {
        $this->platformActor($request);
        $owners = DB::table('users as u')->join('memberships as m', 'm.user_id', '=', 'u.id')->join('clinics as c', 'c.id', '=', 'm.clinic_id')
            ->where('m.active', true)->get(['u.id', 'u.username', 'u.display_name', 'c.display_name as clinic']);

        return Inertia::render('Platform', ['owners' => $owners]);
    }

    public function accountLink(Request $request, string $user): RedirectResponse
    {
        $url = DB::transaction(function () use ($request, $user): string {
            $actor = $this->platformActor($request, true);
            $subject = User::whereKey($user)->lockForUpdate()->firstOrFail();
            abort_if($subject->id === $actor->id || $subject->platform_role !== null, 403);
            abort_unless(DB::table('memberships')->where('user_id', $subject->id)->where('active', true)->exists(), 404);

            return $this->grants->issue($actor, $subject, null, $request);
        });

        return to_route('platform')->with('private_notice', Crypt::encryptString(json_encode(['account_link' => $url])))->with('status', 'صدر رابط استعادة خاص بصاحب الحساب. تحقق من هويته خارج النظام قبل تسليمه.');
    }
}
