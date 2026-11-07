<?php

namespace App\Models;

use Database\Factories\VisitFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Visit extends TenantRecord
{
    /** @use HasFactory<VisitFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return ['version' => 'integer', 'priority' => 'boolean', 'arrived_at' => 'immutable_datetime', 'called_at' => 'immutable_datetime', 'started_at' => 'immutable_datetime', 'completed_at' => 'immutable_datetime'];
    }
}
