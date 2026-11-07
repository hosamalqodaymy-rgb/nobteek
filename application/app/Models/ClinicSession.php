<?php

namespace App\Models;

use Database\Factories\ClinicSessionFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class ClinicSession extends TenantRecord
{
    /** @use HasFactory<ClinicSessionFactory> */
    use HasFactory;

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected function casts(): array
    {
        return ['starts_at' => 'immutable_datetime', 'ends_at' => 'immutable_datetime', 'version' => 'integer'];
    }
}
