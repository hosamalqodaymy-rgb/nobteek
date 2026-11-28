<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

class CommunitySupport
{
    public const TOPICS = ['booking', 'account', 'clinic', 'subscription', 'technical', 'other'];

    public function role(User $user): string
    {
        abort_unless(config('nobteek.community_enabled'), 404);
        abort_unless(in_array($user->community_role, ['patient', 'support'], true), 403);

        return $user->community_role;
    }

    private function visible(User $user): Builder
    {
        $query = DB::table('community_support_tickets as t');
        if ($this->role($user) === 'patient') {
            return $query->where('t.patient_id', $user->id);
        }

        return $query->where(function (Builder $scope) use ($user): void {
            $scope->where('t.assignee_id', $user->id)->orWhereNull('t.assignee_id')
                ->orWhereNotIn('t.assignee_id', $this->activeAgents()->select('id'));
        });
    }

    private function activeAgents(): Builder
    {
        return DB::table('users')->where('community_role', 'support')->where('login_enabled', true)->where('access_suspended', false);
    }

    public function inbox(User $user, string $filter): array
    {
        $role = $this->role($user);
        $query = $this->visible($user);
        if ($filter === 'mine' && $role === 'support') {
            $query->where('t.assignee_id', $user->id)->where('t.state', '!=', 'closed');
        } elseif ($filter === 'closed') {
            $query->where('t.state', 'closed');
        } else {
            $query->where('t.state', '!=', 'closed');
        }

        return $query->orderByDesc('t.updated_at')->orderByDesc('t.id')->simplePaginate(25, [
            't.id', 't.topic', 't.subject', 't.state', 't.updated_at',
        ])->withQueryString()->toArray();
    }

    public function thread(User $user, string $id): array
    {
        $role = $this->role($user);
        $ticket = $this->visible($user)->where('t.id', $id)
            ->firstOrFail(['t.id', 't.topic', 't.subject', 't.reference', 't.state', 't.assignee_id', 't.updated_at']);
        $details = (array) $ticket;
        unset($details['assignee_id']);

        return [
            ...$details,
            'messages' => DB::table('community_support_messages')->where('ticket_id', $id)->orderBy('id')
                ->get(['id', 'author_role', 'body', 'created_at'])->all(),
            'assignee' => $role === 'support' ? $this->activeAgents()->where('id', $ticket->assignee_id)->value('display_name') : null,
        ];
    }

    public function agents(User $user): array
    {
        return $this->role($user) === 'support' ? $this->activeAgents()->orderBy('display_name')->get(['id', 'display_name'])->all() : [];
    }

    public function open(User $actor, array $data): string
    {
        abort_unless($this->role($actor) === 'patient', 403);
        $id = (string) Str::uuid();
        DB::table('community_support_tickets')->insert([
            'id' => $id,
            'patient_id' => $actor->id,
            'topic' => $data['topic'],
            'subject' => $data['subject'],
            'reference' => $data['reference'] ?? null,
            'state' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->message($actor, $id, 'patient', $data['body']);

        return $id;
    }

    public function update(User $actor, string $id, string $action, array $data): string
    {
        $role = $this->role($actor);
        abort_unless($action === 'reply' || $role === 'support', 403);
        /** @var stdClass $ticket */
        $ticket = $this->visible($actor)->where('t.id', $id)->lockForUpdate()->firstOrFail();
        abort_if($ticket->state === 'closed', 409, 'أُغلقت هذه التذكرة.');
        $changes = ['updated_at' => now()];

        if ($action === 'assign') {
            abort_unless($this->activeAgents()->where('id', $data['assignee'])->exists(), 422, 'اختر موظف دعم نشطًا.');
            $changes['assignee_id'] = $data['assignee'];
        } elseif ($action === 'close') {
            abort_unless($ticket->state === 'answered', 409, 'تحتاج التذكرة إلى رد قبل إغلاقها.');
            $changes['state'] = 'closed';
        } else {
            $this->message($actor, $id, $role, $data['body']);
            $changes['state'] = $role === 'support' ? 'answered' : 'open';
            if ($role === 'support') {
                $changes['assignee_id'] = $actor->id;
            }
        }

        DB::table('community_support_tickets')->where('id', $id)->update($changes);

        return $id;
    }

    private function message(User $actor, string $id, string $role, string $body): void
    {
        DB::table('community_support_messages')->insert([
            'ticket_id' => $id, 'author_id' => $actor->id, 'author_role' => $role, 'body' => $body, 'created_at' => now(),
        ]);
    }
}
