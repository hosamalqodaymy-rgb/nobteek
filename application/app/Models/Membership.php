<?php

namespace App\Models;

use Database\Factories\MembershipFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Membership extends TenantRecord
{
    /** @use HasFactory<MembershipFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return ['active' => 'boolean', 'delegated_permissions' => 'array', 'delegation_version' => 'integer'];
    }
}
