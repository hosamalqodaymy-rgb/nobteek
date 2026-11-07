<?php

namespace App\Support;

class TenantContext
{
    /** @var array{id:string,clinic_id:string,user_id:string,role:string}|null */
    public ?array $membership = null;

    public ?string $doctorId = null;

    /** @param array{id:string,clinic_id:string,user_id:string,role:string} $membership */
    public function set(array $membership, ?string $doctorId): void
    {
        $this->membership = $membership;
        $this->doctorId = $doctorId;
    }

    public function clear(): void
    {
        $this->membership = null;
        $this->doctorId = null;
    }

    public function clinicId(): ?string
    {
        return $this->membership['clinic_id'] ?? null;
    }

    public function role(): ?string
    {
        return $this->membership['role'] ?? null;
    }
}
