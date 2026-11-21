<?php

namespace App\Http\Controllers;

use App\Services\TicketLinks;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class TicketController extends Controller
{
    public function show(): Response
    {
        return Inertia::render('Ticket', ['read_url' => route('public.ticket.current'), 'poll_seconds' => 20]);
    }

    public function current(Request $request, TicketLinks $tickets): JsonResponse
    {
        return $this->read($request, $tickets, $request->bearerToken() ?? '');
    }

    public function legacy(Request $request, string $secret, TicketLinks $tickets): JsonResponse
    {
        return $this->read($request, $tickets, $secret);
    }

    private function read(Request $request, TicketLinks $tickets, string $secret): JsonResponse
    {
        abort_if($request->query->count() !== 0, 422);

        return response()->json($tickets->read($secret));
    }

    public function help(): Response
    {
        return Inertia::render('Information', ['kind' => 'help']);
    }

    public function privacy(): Response
    {
        return Inertia::render('Information', ['kind' => 'privacy']);
    }
}
