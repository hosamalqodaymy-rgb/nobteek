<?php

namespace App\Http\Resources;

use App\Services\SessionCommands;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ClinicSessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return app(SessionCommands::class)->dto($this->resource);
    }
}
