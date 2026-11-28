<?php

namespace App\Services;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CommunityCommands
{
    /**
     * @param  array<string, mixed>  $payload
     * @param  Closure(User): string  $perform
     */
    public function run(Request $request, string $kind, string $id, array $payload, Closure $perform): string
    {
        ksort($payload);
        $fingerprint = hash_hmac('sha256', json_encode([$kind, $payload], JSON_THROW_ON_ERROR), config('app.key'));

        return DB::transaction(function () use ($request, $id, $fingerprint, $perform): string {
            $actor = app(AccountSecurity::class)->lockedActor($request);
            $previous = DB::table('community_commands')->where('user_id', $actor->id)->where('command_id', $id)->first();
            if ($previous) {
                abort_unless(hash_equals($previous->fingerprint, $fingerprint), 409, 'معرّف المحاولة مستخدم لطلب مختلف.');

                return $previous->result_id;
            }

            $result = $perform($actor);
            DB::table('community_commands')->insert([
                'user_id' => $actor->id,
                'command_id' => $id,
                'fingerprint' => $fingerprint,
                'result_id' => $result,
                'created_at' => now(),
            ]);

            return $result;
        }, attempts: 3);
    }
}
