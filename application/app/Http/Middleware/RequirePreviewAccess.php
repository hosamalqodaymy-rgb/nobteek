<?php

namespace App\Http\Middleware;

use App\Http\Controllers\DhamarPreviewController;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequirePreviewAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $code = config('nobteek.connected_preview_code');
        if (! $code || $request->routeIs('dhamar.preview.access', 'dhamar.preview.enter', 'public.ticket.current')) {
            return $next($request);
        }
        abort_unless(DhamarPreviewController::available($request) && $request->isSecure(), 404);
        if (hash_equals(hash('sha256', $code), (string) $request->cookie('nobteek_preview_access'))) {
            return $next($request);
        }
        abort_if($request->expectsJson(), 403, 'افتح واجهة الاختبار وأدخل رمز الوصول.');

        return to_route('dhamar.preview.access');
    }
}
