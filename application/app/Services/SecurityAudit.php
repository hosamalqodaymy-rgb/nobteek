<?php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SecurityAudit
{
    /** @param array<string, int|string|bool|null> $context */
    public function record(string $event, ?string $actor = null, ?string $subject = null, ?string $clinic = null, ?Request $request = null, array $context = []): void
    {
        $safe = array_intersect_key($context, array_flip(['reason', 'membership_id', 'role', 'count', 'result']));
        DB::table('security_events')->insert([
            'id' => (string) Str::uuid(), 'actor_user_id' => $actor,
            'subject_user_id' => $subject, 'clinic_id' => $clinic,
            'event_type' => $event, 'at' => now(),
            'request_id' => $request?->attributes->get('security_request_id') ?? (string) Str::uuid(),
            'ip_digest' => $request ? hash_hmac('sha256', (string) $request->ip(), (string) config('app.key')) : null,
            'safe_context' => json_encode((object) $safe, JSON_THROW_ON_ERROR),
        ]);
    }
}
