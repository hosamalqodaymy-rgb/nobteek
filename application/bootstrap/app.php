<?php

use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\PrivateSecurityHeaders;
use App\Http\Middleware\RequireMfa;
use App\Http\Middleware\RequirePreviewAccess;
use App\Http\Middleware\ResolveClinicContext;
use App\Http\Middleware\VerifyAccountSession;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trustHosts(subdomains: false);
        $middleware->web(append: [PrivateSecurityHeaders::class, RequirePreviewAccess::class, VerifyAccountSession::class, HandleInertiaRequests::class]);
        $middleware->alias(['mfa' => RequireMfa::class, 'clinic' => ResolveClinicContext::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontFlash(['current_password', 'password', 'password_confirmation', 'code', 'recovery_code', 'grant_token', 'preview_token', 'display_name', 'contact_phone', 'secret', 'ticket_secret', 'ticket_url', 'transfer_reference', 'verified_transfer_reference', 'refund_reference', 'body', 'bio', 'cv_name', 'offer_details', 'interview_location']);
        $exceptions->report(function (Throwable $error) {
            if (request()->is('v1/tickets/*')) {
                Log::error('Private ticket request failed.', ['error_type' => $error::class, 'request_id' => request()->attributes->get('security_request_id')]);

                return false;
            }
            if (request()->routeIs('billing.*', 'platform.billing.*', 'platform.billing')) {
                Log::error('Private billing request failed.', ['error_type' => $error::class, 'request_id' => request()->attributes->get('security_request_id')]);

                return false;
            }
            if (request()->is('community/*')) {
                Log::error('Community request failed.', ['error_type' => $error::class, 'request_id' => request()->attributes->get('security_request_id')]);

                return false;
            }
        });
        $exceptions->respond(function (Response $response, Throwable $error, Request $request) {
            if ($request->is('v1/tickets/*')) {
                $status = $response->getStatusCode();
                $message = match ($status) {
                    404 => 'الرابط غير متاح أو انتهت صلاحيته. اطلب المساعدة من استقبال العيادة.',
                    422 => 'طلب متابعة غير صالح. افتح الرابط الخاص المحفوظ دون إضافة بيانات.',
                    429 => 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
                    default => 'تعذر تحديث التذكرة. أعد المحاولة لاحقًا.',
                };

                return response()->json(['message' => $message], $status, ['Cache-Control' => 'private, no-store, max-age=0', 'Pragma' => 'no-cache',
                    'Referrer-Policy' => 'no-referrer', 'X-Content-Type-Options' => 'nosniff', 'X-Frame-Options' => 'DENY']);
            }
            if (! $request->expectsJson() && ! $request->is('v1/*') && in_array($response->getStatusCode(), [403, 404, 419, 423, 429, 500, 503], true)) {
                $status = $response->getStatusCode();
                $messages = [403 => 'لا تسمح صلاحيات حسابك بهذا الإجراء.', 404 => 'الصفحة أو البيانات غير متاحة لحسابك.', 419 => 'انتهت الجلسة. افتح صفحة الدخول وأعد المحاولة.', 423 => 'أكمل التحقق الإضافي أو أعد تأكيد هويتك من أمان الحساب.', 429 => 'محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.', 500 => 'تعذر إتمام الطلب. أعد المحاولة لاحقًا.', 503 => 'الخدمة غير متاحة مؤقتًا. أعد المحاولة لاحقًا.'];

                return Inertia::render('Error', ['status' => $status, 'message' => $messages[$status]])->toResponse($request)->setStatusCode($status)->withHeaders(['Cache-Control' => 'private, no-store, max-age=0', 'Referrer-Policy' => 'no-referrer', 'X-Frame-Options' => 'DENY']);
            }

            return $response;
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('v1/*') || $request->expectsJson(),
        );
    })->create();
