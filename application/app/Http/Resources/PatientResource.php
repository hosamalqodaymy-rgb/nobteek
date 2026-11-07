<?php

namespace App\Http\Resources;

use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PatientResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id, 'display_name' => $this->display_name, 'version' => $this->version,
            'contact_phone' => $this->when(in_array(app(TenantContext::class)->role(), ['owner', 'reception'], true), $this->contact_phone),
        ];
    }
}
