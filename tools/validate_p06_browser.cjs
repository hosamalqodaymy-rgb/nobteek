/* Real browser acceptance tests against isolated localhost Laravel, without mocked API responses. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.NOBTEEK_BROWSER_TOOLS, 'node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const base = process.env.NOBTEEK_BROWSER_URL || 'http://127.0.0.1:8000';
assert.equal(new URL(base).hostname, '127.0.0.1');
assert.equal(process.env.APP_ENV, 'testing');
assert.equal(process.env.DB_DATABASE, 'nobteek_test_browser');
const password = process.env.NOBTEEK_BROWSER_PASSWORD;
const secret = process.env.NOBTEEK_BROWSER_MFA_SECRET;
assert.ok(password && secret);
const ids = JSON.parse(fs.readFileSync(path.join(root, 'application/database/fixtures/foundation_demo.json'))).ids;
const output = path.join(root, 'results/p06-browser-ci');
fs.mkdirSync(output, { recursive: true });
const report = { schemaVersion: 1, scope: 'real_Laravel_PostgreSQL_authenticated_browser_and_public_flow', browser: 'Chromium', passed: false, checks: [], screenshots: [], runtimeErrors: [], serverErrors: [], syntheticOnly: true, realPhoneTested: false, mobileEmulationTested: true, fullBrowserPageZoomTested: false, textResizePercent: 200, apiResponsesMocked: false };
let browser;
let activePage;
async function step(id, name, work) {
  const check = { id, name, status: 'running' }; report.checks.push(check);
  try { await work(); check.status = 'passed'; console.log(JSON.stringify({ id, status: 'passed' })); }
  catch (error) { check.status = 'failed'; check.error = String(error.message).slice(0, 2000); throw error; }
}
function otp() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest(); const offset = h.at(-1) & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function pageFor(context) {
  const page = await context.newPage(); page.setDefaultTimeout(15000); activePage = page;
  page.on('pageerror', e => report.runtimeErrors.push(String(e.message).slice(0, 300)));
  page.on('response', r => { if (r.status() >= 500 && r.url().startsWith(base)) report.serverErrors.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  return page;
}
async function login(page, username, mfa = false) {
  await page.goto(base + '/login');
  await page.getByLabel('اسم الدخول', { exact: true }).fill(username);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'دخول العيادة', exact: true }).click();
  if (mfa) {
    await page.waitForURL('**/login/challenge');
    await page.getByLabel('رمز تطبيق التحقق', { exact: true }).fill(otp());
    await page.getByRole('button', { name: 'تحقق ومتابعة', exact: true }).click();
  }
  await page.waitForURL('**/workspace');
  await page.getByRole('heading', { level: 1 }).waitFor();
}
async function api(page, route) {
  const r = await page.request.get(base + route, { headers: { Accept: 'application/json' } });
  assert.equal(r.status(), 200, 'Expected authorized read: ' + route); return r.json();
}
async function fillRequest(form, sid, wid, name, phone = '٧٠٠٠٠٠٠٩٩') {
  await form.getByLabel('الطبيب والجلسة', { exact: true }).selectOption(sid);
  await form.getByLabel('نافذة الوصول', { exact: true }).selectOption(wid);
  await form.getByLabel('اسم المراجع', { exact: true }).fill(name);
  await form.getByLabel(/رقم التواصل/).fill(phone);
}
async function submitRequest(page, form) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/v1/booking-requests') && r.request().method() === 'POST'),
    form.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }).click(),
  ]);
  assert.equal(response.status(), 201);
  await page.getByRole('heading', { name: 'تم حفظ الطلب · قيد المراجعة', exact: true }).waitFor();
  return (await response.json()).id;
}
function card(page, name) { return page.locator('article.booking-card').filter({ hasText: name }); }
const labels = { confirm: 'تأكيد الحجز', reject: 'رفض الطلب', cancel: 'إلغاء الحجز', reschedule: 'تأجيل إلى نافذة أخرى' };
async function command(page, name, id, action, sid, wid) {
  const c = card(page, name); await c.getByLabel('الإجراء', { exact: true }).selectOption(action);
  if (action === 'reschedule') {
    await c.getByLabel('الطبيب والجلسة', { exact: true }).selectOption(sid);
    await c.getByLabel('نافذة الوصول', { exact: true }).selectOption(wid);
  }
  const [r] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/v1/bookings/' + id + '/' + action) && r.request().method() === 'POST'),
    c.getByRole('button', { name: labels[action], exact: true }).click(),
  ]);
  assert.equal(r.status(), 200);
  const data = await r.json();
  await page.getByRole('status').filter({ hasText: 'وتسجيل التغيير' }).waitFor();
  const stateLabels = { pending: 'قيد المراجعة', confirmed: 'مؤكد', rejected: 'مرفوض', cancelled: 'ملغى' };
  await c.locator('.state-pill').filter({ hasText: stateLabels[data.state] }).waitFor();
  await c.locator('p').filter({ hasText: 'إصدار ' + data.version }).waitFor();
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  report.screenshots.push(name + '.png');
}
async function layout(page, name) {
  activePage = page;
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const metrics = await page.evaluate(width => {
    const bad = [...document.querySelectorAll('main input, main select, main button, main article, main section, header nav')].filter(e => {
      const r = e.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > width + 1);
    }).map(e => ({ tag: e.tagName, text: (e.getAttribute('aria-label') || e.textContent || '').slice(0, 100), left: e.getBoundingClientRect().left, width: e.getBoundingClientRect().width }));
    const overflow = [...document.querySelectorAll('body *')].filter(e => {
      if (e.closest('.skip-link') || getComputedStyle(e).display === 'none') return false;
      const r = e.getBoundingClientRect(); return r.width && r.height && (r.left < -1 || r.right > width + 1);
    }).map(e => ({ tag: e.tagName, className: String(e.className).slice(0, 100), text: (e.textContent || '').slice(0, 100), left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right }));
    return { viewport: width, actualViewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, direction: getComputedStyle(document.documentElement).direction, bad, overflow: overflow.slice(0, 12), h1: document.querySelectorAll('main h1').length };
  }, page.viewportSize().width);
  await capture(page, name);
  const png = fs.readFileSync(path.join(output, name + '.png'));
  metrics.screenshotWidth = png.readUInt32BE(16);
  assert.equal(metrics.direction, 'rtl'); assert.equal(metrics.h1, 1);
  assert.ok(Math.abs(metrics.actualViewport - metrics.viewport) <= 1, JSON.stringify(metrics));
  assert.ok(metrics.scrollWidth <= metrics.viewport + 1, JSON.stringify(metrics));
  assert.ok(metrics.bodyScrollWidth <= metrics.viewport + 1, JSON.stringify(metrics));
  assert.ok(metrics.screenshotWidth <= metrics.viewport + 1, JSON.stringify(metrics));
  assert.deepEqual(metrics.bad, [], JSON.stringify(metrics));
  return metrics;
}
(async () => {
  browser = await chromium.launch({ headless: true });
  const options = { locale: 'ar-YE', timezoneId: 'Asia/Aden' };
  const ownerContext = await browser.newContext({ ...options, viewport: { width: 1440, height: 1000 } });
  const staffContext = await browser.newContext({ ...options, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const guestContext = await browser.newContext({ ...options, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const owner = await pageFor(ownerContext), staff = await pageFor(staffContext), guest = await pageFor(guestContext);
  let sid, w1, w2, booking, direct, family1, family2;
  const day = new Date(Date.now() + 2 * 86400000 + 3 * 3600000).toISOString().slice(0, 10);
  const bookingsUrl = base + '/workspace/bookings?date=' + day;
  const publicUrl = base + '/clinics/' + ids.CLINIC_A + '/book';
  const patient = 'فحص متصفح حجز تجريبي';
  await step('B01', 'Owner enters password and real TOTP challenge', async () => { await login(owner, 'demo_owner_a', true); });
  await step('B02', 'Owner creates a future session and two windows through UI', async () => {
    await owner.getByRole('link', { name: 'الجلسات ونوافذ الوصول', exact: true }).click();
    const f = owner.locator('form.schedule-form');
    await f.getByLabel('الطبيب', { exact: true }).selectOption(ids.DR_A);
    await f.getByLabel('بداية استقبال الجلسة', { exact: true }).fill(day + 'T10:00');
    await f.getByLabel('نهاية استقبال الجلسة', { exact: true }).fill(day + 'T12:00');
    for (let i = 0; i < 2; i++) {
      const window = f.locator('fieldset').nth(i);
      await window.getByLabel('بداية النافذة', { exact: true }).fill(day + (i ? 'T11:00' : 'T10:00'));
      await window.getByLabel('نهاية النافذة', { exact: true }).fill(day + (i ? 'T12:00' : 'T11:00'));
      await window.getByLabel('عدد الأماكن في النافذة', { exact: true }).fill('10');
    }
    await f.getByRole('button', { name: 'حفظ الجلسة ونوافذها', exact: true }).click();
    await owner.waitForURL(/\/workspace\/sessions\/[a-f0-9-]{36}$/);
    sid = new URL(owner.url()).pathname.split('/').at(-1);
    const data = (await api(owner, '/v1/sessions/' + sid)).data;
    [w1, w2] = data.windows.map(w => w.id); assert.ok(w1 && w2);
  });
  await step('B03', 'Reception logs in normally on mobile viewport and opens bookings', async () => {
    await login(staff, 'demo_reception_a'); await staff.getByRole('link', { name: 'الحجوزات ومراجعة الطلبات', exact: true }).click();
    await staff.getByLabel('يوم الجلسة بتوقيت اليمن').fill(day);
    await staff.getByRole('button', { name: 'عرض الحجوزات', exact: true }).click();
    await staff.waitForURL('**/workspace/bookings?date=' + day);
  });
  await step('B04', 'Public form rejects invalid Yemeni phone via real server validation', async () => {
    await guest.goto(publicUrl); await fillRequest(guest.locator('form'), sid, w1, patient, '123');
    const [r] = await Promise.all([guest.waitForResponse(r => r.url().endsWith('/v1/booking-requests')), guest.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }).click()]);
    assert.equal(r.status(), 422); await guest.getByRole('alert').waitFor();
  });
  await step('B05', 'Public Arabic-digit phone creates pending request through keyboard', async () => {
    await guest.getByLabel(/رقم التواصل/).fill('٧٠٠٠٠٠٠٩٩');
    const [r] = await Promise.all([guest.waitForResponse(r => r.url().endsWith('/v1/booking-requests')), guest.getByLabel(/رقم التواصل/).press('Tab').then(() => guest.keyboard.press('Enter'))]);
    assert.equal(r.status(), 201); const data = await r.json(); booking = data.id;
    assert.equal(data.state, 'pending'); assert.ok(!('ticket_number' in data));
    await guest.getByRole('heading', { name: 'تم حفظ الطلب · قيد المراجعة', exact: true }).waitFor();
    assert.ok((await guest.getByRole('status').innerText()).includes('لم يتأكد الحجز'));
  });
  await step('B06', 'Reception refreshes and confirms the public request', async () => {
    await staff.getByRole('button', { name: 'تحديث البيانات', exact: true }).click();
    await card(staff, patient).getByRole('heading', { name: patient, exact: true }).waitFor();
    await command(staff, patient, booking, 'confirm');
    assert.equal((await api(staff, '/v1/bookings/' + booking)).data.state, 'confirmed');
  });
  await step('B07', 'Reception reschedules confirmed booking to the second window', async () => {
    await command(staff, patient, booking, 'reschedule', sid, w2);
    const data = (await api(staff, '/v1/bookings/' + booking)).data;
    assert.equal(data.window_id, w2); assert.equal(data.state, 'confirmed'); assert.equal(data.version, 3);
  });
  await step('B08', 'Reception cancels and cancellation persists after reload', async () => {
    await command(staff, patient, booking, 'cancel'); await staff.reload();
    assert.equal(await card(staff, patient).locator('.state-pill').innerText(), 'ملغى');
    assert.equal((await api(staff, '/v1/bookings/' + booking)).data.state, 'cancelled');
  });
  await step('B09', 'Walk-in request accepts no phone and does not register arrival', async () => {
    const f = staff.getByRole('heading', { name: 'إضافة طلب من الاستقبال', exact: true }).locator('..').locator('form');
    await fillRequest(f, sid, w1, 'فحص متصفح مراجع مباشر', '');
    await f.getByLabel('مصدر الحجز', { exact: true }).selectOption('walk_in');
    direct = await submitRequest(staff, f);
    const data = (await api(staff, '/v1/bookings/' + direct)).data;
    assert.equal(data.has_arrived, false); assert.equal(data.contact_phone, null);
  });
  await step('B10', 'Reception rejects the walk-in pending request with reason', async () => {
    await card(staff, 'فحص متصفح مراجع مباشر').waitFor();
    await command(staff, 'فحص متصفح مراجع مباشر', direct, 'reject');
    assert.equal((await api(staff, '/v1/bookings/' + direct)).data.state, 'rejected');
    await staff.getByRole('button', { name: 'تقديم طلب آخر', exact: true }).click();
  });
  await step('B11', 'Two relatives sharing a phone remain distinct patients', async () => {
    await guest.getByRole('button', { name: 'تقديم طلب آخر', exact: true }).click();
    await fillRequest(guest.locator('form'), sid, w1, 'فحص متصفح فرد أسرة أول'); family1 = await submitRequest(guest, guest.locator('form'));
    await guest.getByRole('button', { name: 'تقديم طلب آخر', exact: true }).click();
    await fillRequest(guest.locator('form'), sid, w1, 'فحص متصفح فرد أسرة ثان'); family2 = await submitRequest(guest, guest.locator('form'));
    const a = (await api(staff, '/v1/bookings/' + family1)).data, b = (await api(staff, '/v1/bookings/' + family2)).data;
    assert.notEqual(a.patient_id, b.patient_id); assert.equal(a.contact_phone, b.contact_phone);
  });
  await step('B12', 'Guest cannot read history and reception cannot cross clinics', async () => {
    assert.equal((await guest.request.get(base + '/v1/bookings', { headers: { Accept: 'application/json' } })).status(), 401);
    assert.equal((await staff.request.get(base + '/v1/bookings/' + ids.BOOK_B1, { headers: { Accept: 'application/json' } })).status(), 404);
    assert.equal((await guest.request.post(base + '/v1/booking-requests', { headers: { Accept: 'application/json' }, data: { session_id: sid, window_id: w1, display_name: 'فحص حماية الطلب', contact_phone: '700000099' } })).status(), 419);
    await guest.goto(publicUrl); assert.ok(!(await guest.locator('body').innerText()).includes('فحص متصفح فرد أسرة'));
  });
  await step('B13', 'Doctor cannot open booking management', async () => {
    const ctx = await browser.newContext({ ...options, viewport: { width: 768, height: 1000 } });
    const doctor = await pageFor(ctx); await login(doctor, 'demo_doctor_a');
    const r = await doctor.goto(base + '/workspace/bookings'); assert.equal(r.status(), 403); await ctx.close();
  });
  await step('B14', 'Offline form disables submission and recovers on reconnect', async () => {
    await guestContext.setOffline(true);
    await guest.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }).waitFor();
    await guest.waitForFunction(() => document.querySelector('form button').disabled);
    await guestContext.setOffline(false); await guest.waitForFunction(() => !document.querySelector('form button').disabled);
  });
  await step('B15', 'Lost real response retries once without duplicate record', async () => {
    let saved, dropped = false;
    await guest.route('**/v1/booking-requests', async route => {
      if (!dropped) { dropped = true; const r = await route.fetch(); assert.equal(r.status(), 201); saved = await r.json(); await route.abort('failed'); }
      else { await route.continue(); }
    });
    await fillRequest(guest.locator('form'), sid, w2, 'فحص متصفح إعادة محاولة');
    await guest.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }).click();
    await guest.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).waitFor();
    await guest.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).click();
    await guest.getByRole('heading', { name: 'تم حفظ الطلب · قيد المراجعة', exact: true }).waitFor();
    assert.equal(await guest.locator('.booking-reference').innerText(), saved.id);
    const result = await api(staff, '/v1/bookings/' + saved.id); assert.equal(result.events.length, 1);
    await guest.unroute('**/v1/booking-requests');
  });
  await step('B16', 'Booking filters display cancelled requests correctly', async () => {
    await staff.getByLabel('حالة الحجز', { exact: true }).selectOption('cancelled');
    await staff.getByRole('button', { name: 'عرض الحجوزات', exact: true }).click();
    await staff.waitForURL('**state=cancelled');
    await staff.waitForFunction(() => document.querySelectorAll('article.booking-card').length === 1);
    assert.equal(await staff.locator('article.booking-card').count(), 1);
    assert.equal(await card(staff, patient).locator('.state-pill').innerText(), 'ملغى');
    await staff.goto(bookingsUrl);
  });
  report.layoutMatrix = []; report.textResizeMatrix = [];
  for (const width of [360, 768, 1440]) {
    await step('B17-' + width, 'RTL public and staff layout at ' + width, async () => {
      await staff.setViewportSize({ width, height: 1000 }); await guest.setViewportSize({ width, height: 1000 });
      await staff.goto(bookingsUrl); await guest.goto(publicUrl);
      await staff.getByRole('heading', { name: 'الحجوزات ومراجعة الطلبات', level: 1 }).waitFor();
      await guest.getByLabel('اسم المراجع', { exact: true }).waitFor();
      report.layoutMatrix.push({ page: 'staff', ...await layout(staff, 'staff-' + width) }, { page: 'public', ...await layout(guest, 'public-' + width) });
    });
    await step('B18-' + width, '200 percent text resize and usable controls at ' + width, async () => {
      for (const [page, name] of [[staff, 'staff'], [guest, 'public']]) {
        const before = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        const after = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
        assert.ok(after >= before * 1.95);
        report.textResizeMatrix.push({ page: name, ...await layout(page, name + '-' + width + '-text200') });
        await page.getByLabel('الطبيب والجلسة', { exact: true }).first().selectOption(sid);
        await page.getByLabel('نافذة الوصول', { exact: true }).first().selectOption(w1);
        await page.getByLabel('اسم المراجع', { exact: true }).fill('اختبار تكبير النص');
        const button = page.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }); await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox(); assert.ok(box.width > 0 && box.height >= 44);
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      }
    });
  }
  await step('B19', 'Logout ends the reception browser session', async () => {
    await staff.getByRole('button', { name: 'خروج', exact: true }).click(); await staff.waitForURL('**/login');
    assert.equal((await staff.request.get(base + '/v1/bookings', { headers: { Accept: 'application/json' } })).status(), 401);
  });
  await step('B20', 'No uncaught browser errors or server failures', async () => { assert.deepEqual(report.runtimeErrors, []); assert.deepEqual(report.serverErrors, []); });
  report.passed = true;
})().catch(async error => {
  report.error = String(error.message).slice(0, 2500);
  if (activePage && !activePage.isClosed() && !/\/login|\/account/.test(activePage.url())) { try { await capture(activePage, 'failure'); } catch {} }
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(x => x.status !== 'passed'), realPhoneTested: report.realPhoneTested }));
  if (browser) await browser.close();
});
