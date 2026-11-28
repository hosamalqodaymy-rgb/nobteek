<?php

namespace App\Http\Controllers;

use App\Services\AccountGrants;
use App\Services\AccountSecurity;
use App\Services\SecurityAudit;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;
use PragmaRX\Google2FA\Google2FA;

class AccountController extends Controller
{
    public function __construct(private AccountSecurity $security) {}

    public function loginPage(Request $request): Response|RedirectResponse
    {
        return $request->user() ? to_route('dashboard') : Inertia::render('Account', [
            'screen' => 'login',
            'communityLogin' => config('nobteek.community_enabled')
                && ($request->query('entry') === 'community' || str_starts_with((string) $request->session()->get('url.intended'), url('/community').'/')),
        ]);
    }

    public function login(Request $request): RedirectResponse
    {
        $data = $request->validate(['username' => ['required', 'string', 'max:80'], 'password' => ['required', 'string', 'max:128']]);

        $destination = $this->security->login($request, $data['username'], $data['password']);

        return $destination === 'dashboard' ? redirect()->intended(route('dashboard')) : to_route($destination);
    }

    public function challengePage(Request $request): Response|RedirectResponse
    {
        $pending = $request->session()->get('pending_login');
        if (! $pending || ($pending['expires'] ?? 0) < now()->timestamp) {
            $request->session()->forget('pending_login');

            return to_route('login');
        }

        return Inertia::render('Account', ['screen' => 'challenge']);
    }

    public function challenge(Request $request): RedirectResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'regex:/^\d{6}$/D']]);
        $this->security->challenge($request, $data['code']);

        return redirect()->intended(route('dashboard'));
    }

    public function recoveryPage(): Response
    {
        return Inertia::render('Account', ['screen' => 'recovery']);
    }

    public function recover(Request $request): RedirectResponse
    {
        $data = $request->validate(['username' => ['required', 'string', 'max:80'], 'recovery_code' => ['required', 'string', 'max:100'], 'password' => AccountSecurity::passwordRules()]);
        $this->security->recover($request, $data['username'], $data['recovery_code'], $data['password']);

        return to_route('login')->with('status', 'تم تعيين كلمة المرور. سجّل الدخول وأعد إعداد التحقق الإضافي عند طلبه.');
    }

    public function accessPage(): Response
    {
        return Inertia::render('Account', ['screen' => 'activation']);
    }

    public function activate(Request $request, AccountGrants $grants): RedirectResponse
    {
        $data = $request->validate(['grant_token' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/D'], 'password' => AccountSecurity::passwordRules()]);
        $grants->consume($request, $data['grant_token'], $data['password']);

        return to_route('login')->with('status', 'أصبحت كلمة مرورك جاهزة. يمكنك تسجيل الدخول.');
    }

    public function security(Request $request): Response
    {
        $user = $request->user();
        $pending = $user->mfa_pending_secret && $user->mfa_pending_until?->isFuture();
        $setup = null;
        if ($pending) {
            $url = (new Google2FA)->getQRCodeUrl('Nobteek', $user->username, $user->mfa_pending_secret);
            $svg = (new Writer(new ImageRenderer(new RendererStyle(220), new SvgImageBackEnd)))->writeString($url);
            $setup = ['secret' => $user->mfa_pending_secret, 'qr' => 'data:image/svg+xml;base64,'.base64_encode($svg)];
        }

        return Inertia::render('Account', ['screen' => 'security', 'mfa' => ['enabled' => $user->hasMfa(), 'required' => $user->requiresMfa(), 'setup' => $setup],
            'events' => DB::table('security_events')->where('subject_user_id', $user->id)->orderByDesc('at')->limit(15)->get(['event_type', 'at'])]);
    }

    public function beginMfa(Request $request): RedirectResponse
    {
        $data = $request->validate(['current_password' => ['required', 'string', 'max:128'], 'code' => ['nullable', 'string', 'max:6']]);
        $this->security->beginMfa($request, $data['current_password'], $data['code'] ?? '');

        return to_route('security')->with('status', 'امسح الرمز بتطبيق التحقق ثم أدخل الرمز المؤلف من ستة أرقام.');
    }

    public function confirmMfa(Request $request): RedirectResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'regex:/^\d{6}$/D']]);
        $code = $this->security->confirmMfa($request, $data['code']);

        return to_route('security')->with('private_notice', Crypt::encryptString(json_encode(['recovery_code' => $code])))->with('status', 'تم تفعيل التحقق الإضافي. احفظ رمز الاستعادة في مكان خاص.');
    }

    public function rotateRecovery(Request $request): RedirectResponse
    {
        $data = $request->validate(['current_password' => ['required', 'string', 'max:128'], 'code' => ['nullable', 'string', 'max:6']]);
        $code = $this->security->rotateRecovery($request, $data['current_password'], $data['code'] ?? '');

        return to_route('security')->with('private_notice', Crypt::encryptString(json_encode(['recovery_code' => $code])))->with('status', 'هذا رمزك الجديد. أصبح الرمز السابق غير صالح.');
    }

    public function password(Request $request): RedirectResponse
    {
        $data = $request->validate(['current_password' => ['required', 'string', 'max:128'], 'code' => ['nullable', 'string', 'max:6'], 'password' => [...AccountSecurity::passwordRules(), 'different:current_password']]);
        $this->security->changePassword($request, $data['current_password'], $data['password'], $data['code'] ?? '');

        return to_route('security')->with('status', 'تم تغيير كلمة المرور وإنهاء الجلسات الأخرى.');
    }

    public function confirm(Request $request): RedirectResponse
    {
        $data = $request->validate(['current_password' => ['required', 'string', 'max:128'], 'code' => ['nullable', 'string', 'max:6']]);
        $this->security->confirm($request, $data['current_password'], $data['code'] ?? '');

        return to_route('security')->with('status', 'تم تأكيد هويتك لمدة عشر دقائق.');
    }

    public function logout(Request $request, SecurityAudit $audit): RedirectResponse
    {
        $audit->record('logout', $request->user()->id, $request->user()->id, request: $request);
        Inertia::clearHistory();
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return to_route('login');
    }
}
