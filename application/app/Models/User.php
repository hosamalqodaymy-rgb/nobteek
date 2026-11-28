<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\DB;

#[Fillable(['username', 'display_name'])]
#[Hidden(['password', 'remember_token', 'mfa_secret', 'mfa_pending_secret', 'recovery_digest', 'mfa_last_step'])]
class User extends Authenticatable
{
    public $incrementing = false;

    protected $keyType = 'string';

    /** @use HasFactory<UserFactory> */
    use HasFactory, \Illuminate\Database\Eloquent\Concerns\HasUuids, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'login_enabled' => 'boolean',
            'access_suspended' => 'boolean',
            'security_version' => 'integer',
            'mfa_secret' => 'encrypted',
            'mfa_pending_secret' => 'encrypted',
            'mfa_confirmed_at' => 'datetime',
            'mfa_pending_until' => 'datetime',
            'mfa_last_step' => 'integer',
            'password' => 'hashed',
        ];
    }

    public function hasMfa(): bool
    {
        return $this->mfa_confirmed_at !== null && $this->getRawOriginal('mfa_secret') !== null;
    }

    public function requiresMfa(): bool
    {
        return $this->platform_role === 'platform_admin' || $this->community_role === 'support' || DB::table('memberships')
            ->where('user_id', $this->id)->where('active', true)->where('role', 'owner')->exists();
    }
}
