<?php

namespace App\Models;

use Database\Factories\DoctorFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Doctor extends TenantRecord
{
    /** @use HasFactory<DoctorFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return ['active' => 'boolean', 'version' => 'integer'];
    }
}
