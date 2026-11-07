<?php

namespace App\Models;

use Database\Factories\ArrivalWindowFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class ArrivalWindow extends TenantRecord
{
    /** @use HasFactory<ArrivalWindowFactory> */
    use HasFactory;

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected function casts(): array
    {
        return ['starts_at' => 'immutable_datetime', 'ends_at' => 'immutable_datetime', 'capacity' => 'integer'];
    }
}
