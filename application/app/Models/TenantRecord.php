<?php

namespace App\Models;

use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

abstract class TenantRecord extends Model
{
    use HasUuids;

    protected $guarded = ['id', 'clinic_id'];

    protected static function boot(): void
    {
        parent::boot();
        static::addGlobalScope('clinic', function (Builder $query): void {
            $context = app(TenantContext::class);
            $table = $query->getModel()->getTable();
            if (! $context->clinicId()) {
                $query->whereRaw('1=0');

                return;
            }
            $query->where($table.'.clinic_id', $context->clinicId());
            if ($context->role() !== 'doctor') {
                return;
            }
            if (! $context->doctorId) {
                $query->whereRaw('1=0');
            } elseif ($table === 'doctors') {
                $query->where($table.'.id', $context->doctorId);
            } elseif (in_array($table, ['clinic_sessions', 'visits'], true)) {
                $query->where($table.'.doctor_id', $context->doctorId);
            } elseif (in_array($table, ['bookings', 'arrival_windows'], true)) {
                $query->whereIn($table.'.session_id', function ($sub) use ($context): void {
                    $sub->select('id')->from('clinic_sessions')->where('clinic_id', $context->clinicId())->where('doctor_id', $context->doctorId);
                });
            } elseif ($table === 'patients') {
                $query->whereExists(function ($sub) use ($context): void {
                    $sub->selectRaw('1')->from('bookings as b')->join('clinic_sessions as s', 's.id', '=', 'b.session_id')
                        ->whereColumn('b.patient_id', 'patients.id')->where('b.clinic_id', $context->clinicId())
                        ->where('s.clinic_id', $context->clinicId())->where('s.doctor_id', $context->doctorId)
                        ->whereIn('b.state', ['confirmed', 'fulfilled']);
                });
            } elseif ($table === 'memberships') {
                $query->where('user_id', $context->membership['user_id']);
            } else {
                $query->whereRaw('1=0');
            }
        });
        static::saving(function (TenantRecord $record): void {
            $clinic = app(TenantContext::class)->clinicId();
            abort_unless($clinic, 404);
            if (! $record->exists && ! $record->clinic_id) {
                $record->clinic_id = $clinic;
            }
            abort_unless($record->clinic_id === $clinic && ! ($record->exists && $record->isDirty('clinic_id')), 404);
        });
        static::deleting(function (TenantRecord $record): void {
            abort_unless($record->clinic_id === app(TenantContext::class)->clinicId(), 404);
        });
    }
}
