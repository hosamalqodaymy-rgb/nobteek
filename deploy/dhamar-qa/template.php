<?php

declare(strict_types=1);

function qaHeaders(): void
{
    ini_set('display_errors', '0');
    header('Cache-Control: no-store, private');
    header('Content-Type: text/html; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
}

function escapeQa(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function qaAccessToken(): string
{
    $token = getenv('NOBTEEK_PREVIEW_ACCESS') ?: '';
    if (! preg_match('/^[0-9a-f]{64}$/D', $token)) {
        http_response_code(503);
        exit;
    }

    return $token;
}

function hasQaAccess(string $token): bool
{
    $cookie = $_COOKIE['nobteek_qa'] ?? null;

    return is_string($cookie) && hash_equals($token, $cookie);
}

function qaPage(string $title): void
{
    $title = escapeQa($title);
    echo <<<HTML
<!doctype html><html lang="ar" dir="rtl">
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{$title}</title>
<style>
* { box-sizing: border-box; } body { margin: 0; background: #f3f7f7; color: #15383d; font: 1rem/1.7 system-ui,sans-serif; }
main { width: min(100%, 46rem); margin: auto; padding: 1rem; } header { padding: .8rem 0; }
h1,h2 { line-height: 1.3; margin: .25rem 0 .65rem; } section { background: white; border: 1px solid #d6e4e3; border-radius: .9rem; padding: 1rem; margin-block: 1rem; }
a,button { display: inline-block; background: #0b6060; color: white; font: inherit; text-decoration: none; padding: .6rem 1rem; border: 0; border-radius: .55rem; margin: .2rem 0; overflow-wrap: anywhere; }
input { width: 100%; display: block; border: 1px solid #497576; background: #fff; color: #15383d; border-radius: .5rem; padding: .75rem; margin-block: .4rem .8rem; font: inherit; }
p { margin: .5rem 0; overflow-wrap: anywhere; } ul,ol { padding-inline-start: 1.2rem; }
code { display: inline-block; direction: ltr; overflow-wrap: anywhere; background: #eff5f5; padding: .2rem .45rem; user-select: all; }
nav { display: flex; flex-wrap: wrap; gap: .55rem; } .hint { color: #3f6267; } .error { color: #932b22; }
</style>
<main><header><p class="hint">نوبتيك · نسخة اختبار ذمار</p><h1>{$title}</h1></header>
HTML;
}
