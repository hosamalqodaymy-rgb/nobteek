<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>دخول تجربة نوبتيك</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; min-height: 100dvh; display: grid; place-items: center;
               color: #153546; background: #f2f7f8; font: 1.05rem/1.65 system-ui, sans-serif; }
        main { width: min(100%, 28rem); padding: 1.6rem; border-radius: 1rem; background: #fff; border: 1px solid #dce6ea; }
        h1 { margin: 0 0 .5rem; font-size: 1.65rem; }
        p { margin: 0 0 1.2rem; }
        label { display: block; font-weight: 700; margin-bottom: .4rem; }
        input, button { display: block; width: 100%; min-height: 3rem; border-radius: .6rem; padding: .6rem; font: inherit; }
        input { border: 1px solid #647987; direction: ltr; }
        button { margin-top: 1rem; background: #13655f; color: white; border: 0; font-weight: 700; }
        .error { margin-block: .5rem 0; color: #a32d2d; }
    </style>
</head>
<body>
    <main>
        <h1>تجربة نوبتيك</h1>
        <p>أدخل رمز الوصول للتجربة. استخدم بيانات وهمية عند الاختبار.</p>
        <form method="post" action="{{ route('dhamar.preview.enter') }}">
            @csrf
            <label for="code">رمز الوصول التجريبي</label>
            <input id="code" name="code" type="password" maxlength="128" required autocomplete="off">
            @error('code')<p class="error" role="alert">{{ $message }}</p>@enderror
            <button type="submit">فتح التجربة</button>
        </form>
    </main>
</body>
</html>
