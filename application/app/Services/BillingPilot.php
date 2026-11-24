<?php

namespace App\Services;

class BillingPilot
{
    private const RATES = [
        'pilot-monthly-yer' => ['name' => 'اشتراك نوبتيك · ريال يمني قديم', 'currency' => 'YER', 'amount_minor' => 5000],
        'pilot-monthly-sar' => ['name' => 'اشتراك نوبتيك · ريال سعودي', 'currency' => 'SAR', 'amount_minor' => 3500],
        'pilot-monthly-usd' => ['name' => 'اشتراك نوبتيك · دولار أمريكي', 'currency' => 'USD', 'amount_minor' => 1000],
    ];

    private const LABELS = ['kuraimi' => 'الكريمي', 'jeeb' => 'جيب', 'flousak' => 'فلوسك', 'jawali' => 'جوالي'];

    public function enabled(): bool
    {
        return (bool) config('nobteek.billing.pilot.enabled');
    }

    public function includesClinic(string $clinic): bool
    {
        return ! $this->enabled() || $clinic === config('nobteek.billing.pilot.clinic_id');
    }

    public function codes(): array
    {
        return array_keys(self::RATES);
    }

    public function rates(): array
    {
        $rates = [];
        foreach (self::RATES as $code => $rate) {
            $methods = $this->destinations($rate['currency']);
            $rates[] = ['code' => $code, ...$rate,
                'methods' => array_map(fn (array $destination) => ['code' => $destination['code'], 'label' => $destination['label']], array_values($methods)),
            ];
        }

        return $rates;
    }

    public function checkout(string $plan, ?string $method): array
    {
        $rate = self::RATES[$plan] ?? null;
        abort_unless($rate, 404);
        $destination = $this->destinations($rate['currency'])[$method] ?? null;
        abort_unless($destination, 422, 'اختر طريقة تحويل مفعّلة لعملة الفاتورة.');

        return [['code' => $plan, ...$rate], $destination];
    }

    private function destinations(string $currency): array
    {
        $recipient = trim((string) config('nobteek.billing.pilot.recipient'));
        if ($recipient === '') {
            return [];
        }

        $destinations = [];
        foreach (self::LABELS as $code => $label) {
            $method = config('nobteek.billing.pilot.methods.'.$code, []);
            $number = trim((string) ($method['number'] ?? ''));
            $currencies = array_map('trim', explode(',', strtoupper((string) ($method['currencies'] ?? ''))));
            if (preg_match('/^\+?[0-9]{6,20}$/D', $number) && in_array($currency, $currencies, true)) {
                $destinations[$code] = compact('code', 'label', 'recipient', 'number');
            }
        }

        return $destinations;
    }
}
