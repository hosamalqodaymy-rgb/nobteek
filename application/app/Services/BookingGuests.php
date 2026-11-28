<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BookingGuests
{
    public static function isGuest(Request $request): bool
    {
        $user = $request->user();

        return ! $user || (config('nobteek.community_enabled') && $user->community_role === 'patient' && $user->platform_role === null
            && ! DB::table('memberships')->where('user_id', $user->id)->where('active', true)->exists());
    }

    public function issue(Request $request): void
    {
        $id = $request->session()->get('booking_guest_id');
        if (is_string($id) && DB::table('booking_guests')->where('id', $id)->where('expires_at', '>', now())->exists()) {
            return;
        }
        $id = (string) Str::uuid();
        DB::table('booking_guests')->insert(['id' => $id, 'created_at' => now(), 'expires_at' => now()->addHours(2)]);
        $request->session()->put('booking_guest_id', $id);
    }

    /** The authenticated server session, never a request parameter, carries this identity. */
    public function lock(Request $request): string
    {
        $id = $request->session()->get('booking_guest_id');
        abort_unless(is_string($id) && Str::isUuid($id), 419, 'افتح رابط العيادة أولًا ثم أعد المحاولة.');
        $guest = DB::table('booking_guests')->where('id', $id)->lockForUpdate()->first();
        abort_unless($guest && CarbonImmutable::parse($guest->expires_at)->isFuture(), 419, 'انتهت جلسة الطلب. افتح رابط العيادة من جديد.');

        return $id;
    }
}
