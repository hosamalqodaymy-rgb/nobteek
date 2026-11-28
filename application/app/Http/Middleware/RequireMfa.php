<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireMfa
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user && ($user->requiresMfa() || $user->hasMfa()) &&
            (! $user->hasMfa() || (int) $request->session()->get('mfa_verified_version', 0) !== $user->security_version)) {
            if ($request->expectsJson()) {
                return response()->json(['message' => 'أكمل التحقق الإضافي لحسابك.', 'code' => 'mfa_required'], 423);
            }

            return redirect()->route('security');
        }

        return $next($request);
    }
}
