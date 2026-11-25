<?php

declare(strict_types=1);

require dirname(__DIR__, 2).'/qa-template.php';

qaHeaders();
$token = qaAccessToken();
$error = false;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $supplied = $_POST['code'] ?? null;
    if (is_string($supplied) && hash_equals($token, trim($supplied))) {
        setcookie('nobteek_qa', $token, [
            'expires' => time() + 604800, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
        ]);
        header('Location: /qa-guide.php', true, 303);
        exit;
    }
    $error = true;
} elseif (hasQaAccess($token)) {
    header('Location: /qa-guide.php', true, 302);
    exit;
}

qaPage('الدخول إلى التجربة');
?>
<section>
<p>الأسماء المعروضة أسماء عيادات منشورة في ذمار. هذه تجربة مستقلة ببيانات وهمية.</p>
<form method="post" action="/qa-access.php">
<label for="code">رمز دخول التجربة</label>
<input id="code" type="password" name="code" dir="ltr" required maxlength="64" autocomplete="off">
<?php if ($error) { ?><p class="error" role="alert">تحقق من رمز الدخول وأعد المحاولة.</p><?php } ?>
<button type="submit">افتح التجربة</button>
</form>
</section></main></html>
