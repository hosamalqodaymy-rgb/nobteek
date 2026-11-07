<?php

namespace App\Services;

use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ClinicAuthority
{
    public function __construct(private AccountSecurity $security) {}

    /** Called inside the mutation transaction. Lock order: actor, membership, aggregate. */
    public function actor(Request $request, array $roles, bool $recent = false): User
    {
        $context = app(TenantContext::class);
        abort_unless(in_array($context->role(), $roles, true), 403);
        $user = $this->security->lockedActor($request, recent: $recent);
        $membership = DB::table('memberships')->where('id', $context->membership['id'])->lockForUpdate()->firstOrFail();
        abort_unless($membership->user_id === $user->id && $membership->clinic_id === $context->clinicId() && $membership->active && in_array($membership->role, $roles, true) && $membership->role === $context->role(), 403);
        abort_unless(DB::table('clinics')->where('id', $context->clinicId())->where('operational_state', 'active')->exists(), 404);

        return $user;
    }

    public function platform(Request $request): User
    {
        abort_unless($request->user()->platform_role === 'platform_admin', 403);
        $user = $this->security->lockedActor($request, recent: true, mfa: true);
        abort_unless($user->platform_role === 'platform_admin', 403);

        return $user;
    }

    /** @param array<string, mixed> $changes */
    public function audit(Request $request, string $event, string $type, string $id, array $changes, ?string $reason = null): void
    {
        $context = app(TenantContext::class);
        $eventId = (string) Str::uuid();
        $safe = array_intersect_key($changes, array_flip(['version', 'from', 'to', 'starts_at', 'ends_at', 'old_ends_at', 'window_id', 'window_count', 'old_capacity', 'new_capacity', 'reserved', 'pending', 'active', 'fields']));
        DB::table('audit_events')->insert(['id' => $eventId, 'clinic_id' => $context->clinicId(), 'actor_membership_id' => $context->membership['id'], 'entity_type' => $type, 'entity_id' => $id,
            'event_type' => $event, 'reason_code' => $reason, 'request_id' => $request->attributes->get('security_request_id'), 'at' => now(), 'safe_changes' => json_encode((object) $safe, JSON_THROW_ON_ERROR)]);
        DB::table('outbox_messages')->insert(['id' => (string) Str::uuid(), 'clinic_id' => $context->clinicId(), 'event_id' => $eventId, 'channel' => 'internal', 'status' => 'disabled']);
    }
}
