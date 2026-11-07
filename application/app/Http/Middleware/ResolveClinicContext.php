<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class ResolveClinicContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $memberships = DB::table('memberships as m')->join('clinics as c', 'c.id', '=', 'm.clinic_id')
            ->where('m.user_id', $request->user()->id)->where('m.active', true)->where('c.operational_state', 'active')->select('m.*', 'c.display_name as clinic_name')->get();
        $selected = $request->session()->get('membership_id');
        if (! $selected && $memberships->count() === 1) {
            $selected = $memberships->first()->id;
            $request->session()->put('membership_id', $selected);
        }
        $membership = $memberships->firstWhere('id', $selected);
        abort_unless($membership, 404);
        $doctor = $membership->role === 'doctor' ? DB::table('doctors')->where('clinic_id', $membership->clinic_id)->where('user_id', $request->user()->id)->where('active', true)->value('id') : null;
        $context = app(TenantContext::class);
        $context->set((array) $membership, $doctor);
        try {
            return $next($request);
        } finally {
            $context->clear();
        }
    }
}
