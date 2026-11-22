# مثال ضبط تسجيل Nginx الآمن قبل إطلاق نوبتيك

يستخدم تطبيق P09 رابط تذكرة قديمًا يحوي سرًا في المسار `/v1/tickets/{secret}`. تظل الواجهة الحديثة `/v1/tickets/current` ترسل الرمز عبر ترويسة Authorization. **كلاهما يجب ألا يظهر في السجلات**.

مثال مقتطف فقط، **ليس إعداد نشر جاهزًا**، يُراجع مع مسؤول استضافة Nginx ويُدمج بحذر في HTTP block:
```nginx
log_format nobteek_safe 'time=$time_iso8601 method=$request_method status=$status duration=$request_time request_id=$request_id';
```
في server block:
```nginx
access_log /var/log/nginx/nobteek_access.log nobteek_safe;
```

- لا تستخدم `$request` أو `$request_uri` أو `$uri` أو `$args` أو `$http_authorization` أو `$http_cookie` أو `$http_referer` في أي سجل لهذه المسارات. قد تحتوي URL أو Bearer أو رموز جلسة.
- راجع سجلات خادم PHP وAPM وCDN والوكيل أمام Nginx وطبقات الاستثناء، وليس Nginx وحده.
- لا تُخرج كلمات المرور والرموز إلى أي Metrics labels أو Traces أو بريد الأخطاء.
- حدّد `APP_DEBUG=false`، وHTTPS وTLS موثوقًا، وقواعد وصول مقيّدة، ثم اختبر إخفاء الرموز بمحاولات صناعية قبل الاستخدام الحقيقي.
- الاحتفاظ بالسجلات والتعامل مع الطلبات القانونية والحذف يعتمد على سياسة معتمدة منفصلة؛ لم تُفعل هذه الإعدادات على استضافة فعلية.
