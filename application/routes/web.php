<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\ClinicAccessController;
use App\Http\Controllers\ClinicSetupController;
use App\Http\Controllers\DoctorController;
use App\Http\Controllers\OperationsController;
use App\Http\Controllers\OutageController;
use App\Http\Controllers\PlatformClinicController;
use App\Http\Controllers\PlatformOperationsController;
use App\Http\Controllers\PublicBookingController;
use App\Http\Controllers\ReceptionController;
use App\Http\Controllers\SessionSetupController;
use App\Http\Controllers\TeamController;
use App\Http\Controllers\TicketController;
use App\Http\Controllers\WaitingRoomController;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\ResolveBookingActor;
use App\Http\Middleware\VerifyAccountSession;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;
use Inertia\Inertia;

Route::get('/clinics/{clinic}/book', [PublicBookingController::class, 'show'])->whereUuid('clinic')->middleware('throttle:120,1')->name('public.booking');
Route::post('/v1/booking-requests', [BookingController::class, 'create'])->middleware([ResolveBookingActor::class, 'throttle:30,1'])->name('bookings.request');
Route::get('/ticket', [TicketController::class, 'show'])->name('public.ticket');
Route::get('/help', [TicketController::class, 'help'])->name('public.help');
Route::get('/privacy', [TicketController::class, 'privacy'])->name('public.privacy');
Route::withoutMiddleware([StartSession::class, ShareErrorsFromSession::class, PreventRequestForgery::class, VerifyAccountSession::class, HandleInertiaRequests::class])
    ->middleware('throttle:120,1')->group(function (): void {
        Route::get('/v1/tickets/current', [TicketController::class, 'current'])->name('public.ticket.current');
        Route::get('/v1/tickets/{secret}', [TicketController::class, 'legacy'])->where('secret', '[a-f0-9]{64}')->name('public.ticket.data');
    });

Route::get('/', fn () => Inertia::render('Welcome'))->name('welcome');
Route::get('/login', [AccountController::class, 'loginPage'])->name('login');
Route::post('/login', [AccountController::class, 'login'])->middleware('throttle:30,1');
Route::get('/login/challenge', [AccountController::class, 'challengePage'])->name('challenge');
Route::post('/login/challenge', [AccountController::class, 'challenge']);
Route::get('/recover', [AccountController::class, 'recoveryPage'])->name('recovery');
Route::post('/recover', [AccountController::class, 'recover']);
Route::get('/account-access', [AccountController::class, 'accessPage'])->name('account.access');
Route::post('/account-access', [AccountController::class, 'activate']);

Route::middleware('auth')->group(function (): void {
    Route::post('/logout', [AccountController::class, 'logout'])->name('logout');
    Route::get('/account/security', [AccountController::class, 'security'])->name('security');
    Route::post('/account/mfa/start', [AccountController::class, 'beginMfa'])->name('mfa.start');
    Route::post('/account/mfa/confirm', [AccountController::class, 'confirmMfa'])->name('mfa.confirm');
    Route::post('/account/recovery-code', [AccountController::class, 'rotateRecovery'])->name('recovery.rotate');
    Route::post('/account/password', [AccountController::class, 'password'])->name('password.change');
    Route::post('/account/confirm', [AccountController::class, 'confirm'])->name('account.confirm');
    Route::middleware('mfa')->group(function (): void {
        Route::get('/workspace', [ClinicAccessController::class, 'dashboard'])->name('dashboard');
        Route::post('/workspace/select', [ClinicAccessController::class, 'select'])->name('clinic.select');
        Route::get('/platform/accounts', [TeamController::class, 'platform'])->name('platform');
        Route::post('/platform/accounts/{user}/access', [TeamController::class, 'accountLink'])->whereUuid('user')->name('platform.account.link')->middleware('throttle:10,1');
        Route::get('/platform/clinics', [PlatformClinicController::class, 'index'])->name('platform.clinics');
        Route::get('/platform/operations', [PlatformOperationsController::class, 'index'])->name('platform.operations');
        Route::post('/platform/support/{support}/resolve', [PlatformOperationsController::class, 'resolve'])->whereUuid('support')->name('platform.support.resolve');
        Route::post('/platform/clinics', [PlatformClinicController::class, 'create'])->name('platform.clinic.create')->middleware('throttle:10,1');
        Route::middleware('clinic')->group(function (): void {
            Route::get('/workspace/operations', [OperationsController::class, 'index'])->name('operations.index');
            Route::get('/workspace/outage', [OutageController::class, 'index'])->name('outage.index');
            Route::get('/v1/outage/status', [OutageController::class, 'status'])->middleware('throttle:90,1')->name('outage.status');
            Route::get('/v1/operations/report.csv', [OperationsController::class, 'export'])->name('operations.export');
            Route::post('/v1/operations/simulate', [OperationsController::class, 'simulate'])->name('operations.simulate');
            Route::post('/v1/operations/support', [OperationsController::class, 'openSupport'])->name('operations.support');
            Route::get('/workspace/clinic', [ClinicSetupController::class, 'index'])->name('clinic.settings');
            Route::post('/workspace/clinic', [ClinicSetupController::class, 'update'])->name('clinic.settings.update');
            Route::post('/workspace/doctors', [ClinicSetupController::class, 'createDoctor'])->name('clinic.doctor.create');
            Route::post('/workspace/doctors/{doctor}', [ClinicSetupController::class, 'updateDoctor'])->whereUuid('doctor')->name('clinic.doctor.update');
            Route::get('/workspace/sessions', [SessionSetupController::class, 'index'])->name('sessions.index');
            Route::post('/workspace/sessions', [SessionSetupController::class, 'create'])->name('sessions.create');
            Route::get('/workspace/sessions/{session}', [SessionSetupController::class, 'show'])->whereUuid('session')->name('sessions.show');
            Route::get('/workspace/sessions/{session}/waiting', [WaitingRoomController::class, 'show'])->whereUuid('session')->name('waiting.index');
            Route::post('/workspace/sessions/{session}/schedule', [SessionSetupController::class, 'correct'])->whereUuid('session')->name('session.schedule.correct');
            Route::get('/v1/sessions', [SessionSetupController::class, 'index'])->name('sessions.api');
            Route::get('/v1/sessions/{session}', [SessionSetupController::class, 'show'])->whereUuid('session')->name('session.api.show');
            Route::get('/v1/sessions/{session}/waiting', [WaitingRoomController::class, 'read'])->whereUuid('session')->name('waiting.api');
            Route::post('/v1/sessions/{session}/capacity/preview', [SessionSetupController::class, 'preview'])->whereUuid('session')->name('session.capacity.preview');
            Route::post('/v1/sessions/{session}/{command}', [SessionSetupController::class, 'command'])->whereUuid('session')->whereIn('command', ['open', 'pause', 'resume', 'close', 'capacity', 'extend'])->name('session.command');

            Route::get('/workspace/bookings', [BookingController::class, 'index'])->name('bookings.index');
            Route::get('/workspace/doctor', [DoctorController::class, 'index'])->name('doctor.index');
            Route::get('/v1/doctor', [DoctorController::class, 'index'])->name('doctor.api');
            Route::post('/v1/sessions/{session}/call-next', [DoctorController::class, 'callNext'])->whereUuid('session')->name('doctor.call-next');
            foreach (['start', 'complete', 'priority', 'correct'] as $command) {
                Route::post('/v1/visits/{visit}/'.$command, [DoctorController::class, 'command'])->whereUuid('visit')->defaults('command', $command)->name('doctor.'.$command);
            }
            Route::get('/workspace/reception', [ReceptionController::class, 'index'])->name('reception.index');
            Route::get('/v1/reception', [ReceptionController::class, 'index'])->name('reception.api');
            Route::get('/v1/visits/{visit}', [ReceptionController::class, 'show'])->whereUuid('visit')->name('reception.show');
            Route::post('/v1/bookings/{booking}/check-in', [ReceptionController::class, 'checkIn'])->whereUuid('booking')->name('reception.check-in');
            Route::post('/v1/sessions/{session}/walk-ins', [ReceptionController::class, 'walkIn'])->whereUuid('session')->name('reception.walk-in');
            Route::post('/v1/visits/{visit}/{command}', [ReceptionController::class, 'command'])->whereUuid('visit')->whereIn('command', ['mark-away', 'return', 'leave', 'defer'])->name('reception.command');
            Route::get('/v1/bookings', [BookingController::class, 'index'])->name('bookings.api');
            Route::get('/v1/bookings/{booking}', [BookingController::class, 'show'])->whereUuid('booking')->name('bookings.show');
            Route::post('/v1/bookings/{booking}/ticket-link', [BookingController::class, 'ticketLink'])->whereUuid('booking')->middleware('throttle:30,1')->name('booking.ticket-link');
            Route::post('/v1/bookings/{booking}/{command}', [BookingController::class, 'command'])->whereUuid('booking')->whereIn('command', ['confirm', 'reject', 'cancel', 'reschedule'])->name('booking.command');

            Route::get('/workspace/team', [TeamController::class, 'index'])->name('team');
            Route::post('/workspace/team', [TeamController::class, 'create'])->name('team.create');
            Route::post('/workspace/team/{membership}/access', [TeamController::class, 'issue'])->whereUuid('membership')->name('team.link');
            Route::post('/workspace/team/{membership}/suspend', [TeamController::class, 'suspend'])->whereUuid('membership')->name('team.suspend');
            Route::post('/workspace/team/{membership}/delegation', [TeamController::class, 'delegation'])->whereUuid('membership')->name('team.delegation');
            Route::get('/v1/patients', [ClinicAccessController::class, 'patients'])->name('patients.index');
            Route::get('/v1/patients/export', [ClinicAccessController::class, 'export'])->name('patients.export');
            Route::get('/v1/patients/{patient}', [ClinicAccessController::class, 'patient'])->whereUuid('patient')->name('patients.show');
            Route::patch('/v1/patients/{patient}', [ClinicAccessController::class, 'updatePatient'])->whereUuid('patient')->name('patients.update');
        });
    });
});
