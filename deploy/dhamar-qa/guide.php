<?php

declare(strict_types=1);
use PragmaRX\Google2FA\Google2FA;

require dirname(__DIR__, 2).'/qa-template.php';

qaHeaders();
if (! hasQaAccess(qaAccessToken())) {
    header('Location: /qa-access.php', true, 302);
    exit;
}

if (isset($_GET['proof'])) {
    $label = 'NOBTEEK DHAMAR TEST  |  NO PAYMENT  |  DHA-QA-001  |  35 SAR';
    $stream = "BT /F1 16 Tf 36 710 Td ($label) Tj ET\n";
    $objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length '.strlen($stream)." >>\nstream\n$stream".'endstream',
    ];
    $body = "%PDF-1.4\n";
    $offsets = [];
    foreach ($objects as $index => $object) {
        $offsets[] = strlen($body);
        $body .= ($index + 1)." 0 obj\n$object\nendobj\n";
    }
    $start = strlen($body);
    $body .= "xref\n0 6\n0000000000 65535 f \n";
    foreach ($offsets as $offset) {
        $body .= sprintf("%010d 00000 n \n", $offset);
    }
    $body .= "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n$start\n%%EOF\n";
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="Nobteek_Dhamar_Test_Proof.pdf"');
    echo $body;
    exit;
}

require dirname(__DIR__).'/vendor/autoload.php';

$password = escapeQa(getenv('NOBTEEK_BROWSER_PASSWORD') ?: '');
$otp = (new Google2FA)->oathTotp(getenv('NOBTEEK_BROWSER_MFA_SECRET'), intdiv(time(), 30));
qaPage('دليل التجربة');
?>
<section>
<h2>تجربة المراجع</h2>
<p>سجّل الخروج من حساب الموظف أولًا ثم اختر عيادة. الأسماء مستمدة من أدلة علنية، والدخول والحجز والمواعيد مخصصة للاختبار.</p>
<nav><a href="/clinics/10101923-eeb8-5aba-9627-57be7229cf49/book">مركز الملكة لطب وجراحة الفم والأسنان</a>
<a href="/clinics/188f0e9f-09cf-5c79-af8f-6dda6566acbb/book">عيادة سلامتي لطب الأسنان</a></nav>
</section>
<section>
<h2>حسابات الموظفين والإدارة</h2>
<p>كلمة المرور المشتركة <code><?= $password ?></code></p>
<p>رمز التحقق الحالي للمالك ومدير المنصة <code><?= escapeQa($otp) ?></code></p>
<nav><a href="/login">تسجيل الدخول</a><a href="/workspace">مساحة العمل</a><a href="/qa-guide.php">تحديث رمز التحقق</a></nav>
<ul><li>مالك مركز الملكة <code>demo_owner_a</code></li><li>استقبال مركز الملكة <code>demo_reception_a</code></li><li>طبيب مركز الملكة <code>demo_doctor_a</code></li>
<li>مالك عيادة سلامتي <code>demo_owner_b</code></li><li>استقبال عيادة سلامتي <code>demo_reception_b</code></li><li>طبيب عيادة سلامتي <code>demo_doctor_b</code></li>
<li>مدير المنصة ومراجع التحويلات <code>demo_platform</code></li></ul>
</section>
<section>
<h2>مسار تجربة الحجز والتحويل</h2>
<ol><li>احجز كمراجع باسم تجريبي ورقم <code>700000099</code> واحفظ رابط المتابعة.</li>
<li>أكّد الحجز وسجّل الوصول من حساب الاستقبال، ثم استدعِ المراجع وأنهِ الزيارة من حساب الطبيب.</li>
<li>من حساب مالك مركز الملكة افتح «الاشتراكات» واختر باقة <code>35 SAR</code> وأي محفظة. ارفع ملف الإثبات أدناه بالمرجع <code>DHA-QA-001</code>.</li>
<li>من حساب مدير المنصة افتح «إدارة الاشتراكات»، واعتمد إثبات المحاكاة بالمبلغ والمرجع والعملة نفسها.</li></ol>
<p>أرقام المحافظ في هذه البيئة وهمية. ارفع ملف الاختبار دون إجراء تحويل حقيقي.</p><a href="/qa-guide.php?proof=1">تنزيل إثبات تجريبي PDF</a>
</section>
</main></html>
