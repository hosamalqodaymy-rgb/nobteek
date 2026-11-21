<?php

use Carbon\Carbon;
use Carbon\CarbonImmutable;

if (PHP_SAPI !== 'cli-server' || getenv('APP_ENV') !== 'testing' || getenv('DB_DATABASE') !== 'nobteek_test_browser' || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/D', (string) getenv('NOBTEEK_BROWSER_CLOCK')) || abs(time() - strtotime(getenv('NOBTEEK_BROWSER_CLOCK'))) > 3600) {
    http_response_code(503);
    exit('Synthetic localhost browser server only.');
}
$public = realpath(__DIR__.'/../application/public');
$path = realpath($public.'/'.rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? ''));
if ($path && str_starts_with($path, $public.DIRECTORY_SEPARATOR) && is_file($path) && pathinfo($path, PATHINFO_EXTENSION) !== 'php') {
    return false;
}
require __DIR__.'/../application/vendor/autoload.php';
Carbon::setTestNow(CarbonImmutable::parse(getenv('NOBTEEK_BROWSER_CLOCK')));
CarbonImmutable::setTestNow(CarbonImmutable::parse(getenv('NOBTEEK_BROWSER_CLOCK')));
require $public.'/index.php';
