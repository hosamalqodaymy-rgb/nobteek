<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\CommunityCommands;
use App\Services\CommunitySupport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class CommunitySupportController extends Controller
{
    public function index(Request $request, CommunitySupport $support, ?string $ticket = null): Response|JsonResponse
    {
        $user = $request->user();
        $role = $support->role($user);
        $filter = $request->validate(['filter' => ['nullable', Rule::in(['open', 'mine', 'closed'])]])['filter'] ?? 'open';
        $details = $ticket ? $support->thread($user, $ticket) : null;
        $props = [
            'role' => $role,
            'inbox' => $ticket ? null : $support->inbox($user, $filter),
            'filter' => $filter,
            'thread' => $details,
            'agents' => $ticket && $details['state'] !== 'closed' ? $support->agents($user) : [],
            'supportUrl' => route('community.support'),
            'threadUrl' => $ticket ? route('community.support', $ticket) : null,
            'directoryUrl' => $role === 'patient' && DhamarPreviewController::available($request) ? route('dhamar.preview') : null,
        ];

        return $request->expectsJson() ? response()->json($props) : Inertia::render('CommunitySupport', $props);
    }

    public function store(Request $request, CommunitySupport $support, CommunityCommands $commands): RedirectResponse|JsonResponse
    {
        abort_unless($support->role($request->user()) === 'patient', 403);
        $data = $request->validate([
            'command_id' => ['required', 'uuid'],
            'topic' => ['required', Rule::in(CommunitySupport::TOPICS)],
            'subject' => ['required', 'string', 'min:5', 'max:80'],
            'reference' => ['nullable', 'string', 'max:60'],
            'body' => ['required', 'string', 'min:10', 'max:1000'],
        ]);
        $id = $commands->run($request, 'support.open', $data['command_id'], $data, fn (User $actor): string => $support->open($actor, $data));

        return $this->saved($request, $id, 'حُفظت تذكرة الدعم.', 201);
    }

    public function update(Request $request, string $ticket, CommunitySupport $support, CommunityCommands $commands): RedirectResponse|JsonResponse
    {
        $support->role($request->user());
        $data = $request->validate([
            'command_id' => ['required', 'uuid'],
            'action' => ['required', Rule::in(['reply', 'assign', 'close'])],
            'body' => ['exclude_unless:action,reply', 'required', 'string', 'min:2', 'max:1000'],
            'assignee' => ['exclude_unless:action,assign', 'required', 'uuid'],
        ]);
        $id = $commands->run($request, 'support.'.$ticket, $data['command_id'], $data,
            fn (User $actor): string => $support->update($actor, $ticket, $data['action'], $data));
        if ($request->expectsJson()) {
            return response()->json(['id' => $id]);
        }

        return $data['action'] === 'assign' && $data['assignee'] !== $request->user()->id
            ? to_route('community.support')->with('status', 'حُفظ إسناد التذكرة.')
            : $this->saved($request, $id, 'حُفظ تحديث التذكرة.', 200);
    }

    private function saved(Request $request, string $id, string $message, int $status): RedirectResponse|JsonResponse
    {
        return $request->expectsJson()
            ? response()->json(['id' => $id], $status)
            : to_route('community.support', $id)->with('status', $message);
    }
}
