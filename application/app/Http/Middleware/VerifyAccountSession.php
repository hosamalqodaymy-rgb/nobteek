<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class VerifyAccountSession
{
    public function handle(Request $request, Closure $next): Response
    {
        app(TenantContext::class)->clear();
        if ($user = $request->user()) {
            $current = User::query()->find($user->id);
            if (! $current || ! $current->login_enabled || $current->access_suspended ||
                (int) $request->session()->get('security_version', 0) !== $current->security_version) {
                Auth::logout();
                $request->session()->invalidate();
                $request->session()->regenerateToken();
                if ($request->is('login', 'recover', 'account-access', 'login/challenge') || $request->routeIs('public.booking', 'public.ticket', 'public.help', 'public.privacy')) {
                    return $next($request);
                }
                if ($request->expectsJson()) {
                    return response()->json(['message' => 'انتهت صلاحية الجلسة. سجل الدخول من جديد.'], 401);
                }

                return redirect()->route('login');
            }
            Auth::setUser($current);
        }

        return $next($request);
    }
}
