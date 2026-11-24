<?php

return [
    'dummy_password_hash' => '$argon2id$v=19$m=65536,t=4,p=1$bnhXaWcuZDE0Tm54QVIyeg$isi+PrEE2kzp4v7GH2H4t/i0iG/SfOiddtJBw6NRzXs',
    'brand' => json_decode(file_get_contents(base_path('../design/brand.config.json')), true, flags: JSON_THROW_ON_ERROR),
    'baseline' => 'NOBTEEK-P06-1.0',
    'business_rules' => 'NOBTEEK-P00-1.0',
    'design' => 'NOBTEEK-P01-1.0',
    'billing' => [
        'enabled' => env('NOBTEEK_MANUAL_BILLING', false),
        'enforce_access' => env('NOBTEEK_BILLING_ENFORCE_ACCESS', false),
        'grace_days' => env('NOBTEEK_BILLING_GRACE_DAYS', 7),
    ],
    'external_payments' => false,
    'paid_messaging' => false,
    'real_patient_data' => false,
    'intake_enabled' => false,
    'demo_seed_enabled' => env('NOBTEEK_DEMO_SEED', false),
];
