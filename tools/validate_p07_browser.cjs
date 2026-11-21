/* P07 browser journeys and real HTTP concurrency on an isolated synthetic database. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.NOBTEEK_BROWSER_TOOLS, 'node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8000';
assert.equal(process.env.APP_ENV, 'testing');
assert.equal(process.env.DB_DATABASE, 'nobteek_test_browser');
assert.ok(Math.abs(Date.now() - Date.parse(process.env.NOBTEEK_BROWSER_CLOCK)) < 3600000);
const day = new Date(Date.parse(process.env.NOBTEEK_BROWSER_CLOCK) + 3 * 3600000).toISOString().slice(0, 10);
const password = process.env.NOBTEEK_BROWSER_PASSWORD;
const secret = process.env.NOBTEEK_BROWSER_MFA_SECRET;
assert.ok(password && secret);
const ids = JSON.parse(fs.readFileSync(path.join(root, 'application/database/fixtures/foundation_demo.json'))).ids;
const output = path.join(root, 'results/p07-browser-ci');
fs.mkdirSync(output, { recursive: true });
const report = { schemaVersion: 1, phase: 'P07', passed: false, scope: 'real_Laravel_PostgreSQL_browser_and_distinct_authenticated_staff_HTTP_races', checks: [], screenshots: [], runtimeErrors: [], serverErrors: [], layoutCases: [], apiResponsesMocked: false, syntheticOnly: true, physicalPhoneTested: false, textResizePercent: 200 };
let browser, activePage;
async function step(id, name, work) {
  const check = { id, name, status: 'running' }; report.checks.push(check);
  try { await work(); check.status = 'passed'; console.log(JSON.stringify({ id, status: 'passed' })); }
  catch (e) { check.status = 'failed'; check.error = String(e.message).slice(0, 2500); throw e; }
}
function otp() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.parse(process.env.NOBTEEK_BROWSER_CLOCK) / 30000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest(); const offset = h.at(-1) & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function pageFor(context) {
  const p = await context.newPage(); p.setDefaultTimeout(15000); activePage = p;
  p.on('pageerror', e => report.runtimeErrors.push(String(e.message).slice(0, 300)));
  p.on('response', r => { if (r.status() >= 500 && r.url().startsWith(base)) report.serverErrors.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  return p;
}
async function login(p, username, mfa = false) {
  await p.goto(base + '/login');
  await p.getByLabel('اسم الدخول', { exact: true }).fill(username);
  await p.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await p.getByRole('button', { name: 'دخول العيادة', exact: true }).click();
  if (mfa) {
    await p.waitForURL('**/login/challenge');
    await p.getByLabel('رمز تطبيق التحقق', { exact: true }).fill(otp());
    await p.getByRole('button', { name: 'تحقق ومتابعة', exact: true }).click();
  }
  await p.waitForURL('**/workspace');
}
async function get(p, route) {
  const r = await p.request.get(base + route, { headers: { Accept: 'application/json' } });
  assert.equal(r.status(), 200, 'GET ' + route); return r.json();
}
async function post(p, route, data, version, key = crypto.randomUUID(), csrf = true) {
  const cookies = await p.context().cookies(base);
  const token = cookies.find(c => c.name === 'XSRF-TOKEN')?.value ?? '';
  const headers = { Accept: 'application/json', 'Idempotency-Key': key };
  if (csrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(token);
  if (version !== undefined) headers['If-Match'] = String(version);
  const r = await p.request.post(base + route, { headers, data });
  return { status: r.status(), body: await r.json() };
}
function card(p, name) { return p.locator('article.reception-card').filter({ has: p.getByRole('heading', { name, exact: true }) }); }
async function uiCommand(p, name, action, label, reason) {
  const c = card(p, name);
  await c.getByLabel('إجراء الحضور', { exact: true }).selectOption(action);
  if (reason) await c.getByLabel('سبب إجراء الحضور', { exact: true }).selectOption(reason);
  const [r] = await Promise.all([
    p.waitForResponse(r => new URL(r.url()).pathname.endsWith('/' + action) && r.request().method() === 'POST'),
    c.getByRole('button', { name: label, exact: true }).click(),
  ]);
  assert.equal(r.status(), 200); const data = await r.json();
  await c.getByText('إصدار الحضور ' + data.version, { exact: false }).waitFor();
  return data;
}
async function captureLayout(p, name) {
  activePage = p;
  await p.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const width = p.viewportSize().width;
  const metrics = await p.evaluate(width => ({
    requestedWidth: width, actualWidth: innerWidth, rootWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
    direction: getComputedStyle(document.documentElement).direction,
    controlsOutside: [...document.querySelectorAll('main input, main select, main button, main article, main section, header nav')].filter(e => {
      const r = e.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > width + 1);
    }).map(e => ({ tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || '').slice(0, 80) })),
  }), width);
  const filename = name + '.png';
  await p.screenshot({ path: path.join(output, filename), fullPage: true, style: '.private-ticket-value{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;background:#e7eff1!important}.private-ticket-value::selection{color:transparent!important;-webkit-text-fill-color:transparent!important;background:transparent!important}' });
  metrics.screenshotWidth = fs.readFileSync(path.join(output, filename)).readUInt32BE(16);
  report.screenshots.push(filename); report.layoutCases.push({ name, ...metrics });
  assert.equal(metrics.direction, 'rtl');
  for (const key of ['actualWidth', 'rootWidth', 'bodyWidth', 'screenshotWidth']) assert.ok(Math.abs(metrics[key] - width) <= 1, JSON.stringify(metrics));
  assert.deepEqual(metrics.controlsOutside, []);
}
(async () => {
  browser = await chromium.launch({ headless: true });
  const opts = { locale: 'ar-YE', timezoneId: 'Asia/Aden' };
  const owner = await pageFor(await browser.newContext({ ...opts, viewport: { width: 1440, height: 1000 } }));
  const staff = await pageFor(await browser.newContext({ ...opts, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }));
  let sid, wid, entries = [], lost, direct;
  const url = () => base + '/workspace/reception?date=' + day + '&session_id=' + sid;
  async function booked(name) {
    const created = await post(owner, '/v1/booking-requests', { session_id: sid, window_id: wid, display_name: name, contact_phone: '700000099', source: 'phone' });
    assert.equal(created.status, 201);
    assert.equal((await post(owner, '/v1/bookings/' + created.body.id + '/confirm', { reason_code: 'booking_reviewed' }, 1)).status, 200);
    return { id: created.body.id, name };
  }
  await step('R01', 'Owner MFA and independent reception password sessions', async () => {
    await login(owner, 'demo_owner_a', true); await login(staff, 'demo_reception_a');
  });
  await step('R02', 'Open synthetic current session using real application commands', async () => {
    const doctor = JSON.parse(fs.readFileSync(path.join(output, 'fixture.json'))).doctor_id;
    const r = await post(owner, '/workspace/sessions', { doctor_id: doctor, starts_at: day + 'T00:00', ends_at: day + 'T23:59', windows: [{ starts_at: day + 'T00:00', ends_at: day + 'T23:59', capacity: 21 }] });
    assert.equal(r.status, 201); sid = r.body.data.id; wid = r.body.data.windows[0].id;
    assert.equal((await post(owner, '/v1/sessions/' + sid + '/open', { reason_code: 'scheduled_start' }, 1)).status, 200);
    entries = [await booked('وصول متزامن أول'), await booked('وصول متزامن ثان')];
  });
  await step('T07A', 'Distinct staff simultaneously check in distinct bookings without duplicate tickets', async () => {
    const key = crypto.randomUUID(); const sent = [];
    const responses = await Promise.all(entries.map(async (entry, i) => {
      sent.push(performance.now());
      return post(i ? staff : owner, '/v1/bookings/' + entry.id + '/check-in', {}, 2, key);
    }));
    assert.deepEqual(responses.map(r => r.status), [201, 201]);
    assert.deepEqual(responses.map(r => r.body.ticket_number).sort(), [1, 2]);
    assert.deepEqual(responses.map(r => r.body.ready_sequence).sort(), [1, 2]);
    entries.forEach((entry, i) => Object.assign(entry, responses[i].body));
    entries.sort((a, b) => a.ticket_number - b.ticket_number);
    report.arrivalRace = { distinctActors: true, actorRoles: ['owner', 'reception'], startDeltaMilliseconds: Math.abs(sent[1] - sent[0]), statuses: responses.map(r => r.status), tickets: responses.map(r => r.body.ticket_number), readySequences: responses.map(r => r.body.ready_sequence) };
  });
  await step('R04', 'Two staff check in the same booking once with no consumed extra ticket', async () => {
    const target = await booked('وصول واحد من جهازين');
    const r = await Promise.all([post(owner, '/v1/bookings/' + target.id + '/check-in', {}, 2), post(staff, '/v1/bookings/' + target.id + '/check-in', {}, 2)]);
    assert.deepEqual(r.map(x => x.status).sort(), [201, 409]);
    assert.equal(r.find(x => x.status === 201).body.ticket_number, 3);
    report.sameBookingRace = { distinctActors: true, statuses: r.map(x => x.status), oneVisit: true, ticket: 3 };
  });
  await step('R05', 'Mobile reception renders stable tickets and independent queue positions', async () => {
    await staff.goto(url());
    await staff.getByRole('heading', { level: 1, name: 'الاستقبال والحضور' }).waitFor();
    await card(staff, entries[0].name).getByText('رقم التذكرة الثابت', { exact: true }).waitFor();
    assert.equal((await get(staff, '/v1/visits/' + entries[0].id)).data.visit.waiting_position, 1);
  });
  await step('T07B', 'Away and return preserve ticket and join the tail with recorded reasons', async () => {
    const first = entries[0];
    const away = await uiCommand(staff, first.name, 'mark-away', 'غياب مؤقت');
    assert.equal(away.state, 'away');
    const returned = await uiCommand(staff, first.name, 'return', 'تسجيل العودة');
    assert.equal(returned.state, 'waiting'); assert.equal(returned.ticket_number, first.ticket_number); assert.equal(returned.ready_sequence, 4);
    const current = await get(staff, '/v1/visits/' + first.id);
    assert.equal(current.data.visit.waiting_position, 3);
    assert.ok(current.events.some(e => e.event_type === 'visit_return' && e.reason_code === 'patient_returned'));
    assert.ok(current.events.some(e => e.event_type === 'visit_mark_away' && e.reason_code === 'temporarily_absent'));
  });
  await step('R07', 'Lost committed check-in response retries the same key and keeps one ticket', async () => {
    lost = await booked('وصول مع انقطاع الرد');
    await staff.goto(url());
    const route = '**/v1/bookings/' + lost.id + '/check-in';
    let committed;
    await staff.route(route, async r => { const response = await r.fetch(); assert.equal(response.status(), 201); committed = await response.json(); await r.abort('failed'); });
    const c = card(staff, lost.name);
    await c.getByRole('button', { name: 'تسجيل الحضور وإصدار التذكرة', exact: true }).click();
    await c.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).waitFor();
    await staff.unroute(route);
    const [retry] = await Promise.all([
      staff.waitForResponse(r => r.url().endsWith('/v1/bookings/' + lost.id + '/check-in')),
      c.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).click(),
    ]);
    const result = await retry.json();
    assert.equal(retry.status(), 201); assert.equal(result.replayed, true); assert.equal(result.id, committed.id); assert.equal(result.ticket_number, 4);
    await c.getByText('رقم التذكرة الثابت', { exact: true }).waitFor();
    assert.equal((await get(staff, '/v1/visits/' + result.id)).events.filter(e => e.event_type === 'visit_check_in').length, 1);
  });
  await step('R08', 'Walk-in form saves confirmed booking and arrival together without a phone', async () => {
    await staff.getByText('إضافة حضور مباشر', { exact: true }).click();
    const form = staff.locator('form.walk-in-form');
    await form.getByLabel('الطبيب والجلسة', { exact: true }).selectOption(sid);
    await form.getByLabel('نافذة الوصول', { exact: true }).selectOption(wid);
    await form.getByLabel('اسم المراجع المباشر', { exact: true }).fill('حضور مباشر من المتصفح');
    const [response] = await Promise.all([
      staff.waitForResponse(r => r.url().endsWith('/v1/sessions/' + sid + '/walk-ins') && r.request().method() === 'POST'),
      form.getByRole('button', { name: 'حفظ الحضور المباشر وإصدار التذكرة', exact: true }).click(),
    ]);
    assert.equal(response.status(), 201); direct = await response.json(); assert.equal(direct.ticket_number, 5);
    await staff.getByRole('heading', { name: 'تم حفظ الحضور المباشر', exact: true }).waitFor();
    const saved = await get(staff, '/v1/visits/' + direct.id);
    assert.equal(saved.data.contact_phone, null); assert.equal(saved.data.booking_state, 'confirmed');
  });
  await step('R09', 'Reasoned owner defer is hidden from reception and cannot change a ticket', async () => {
    const current = await get(staff, '/v1/visits/' + entries[1].id);
    assert.equal(current.data.actions.defer, undefined);
    assert.equal((await post(staff, '/v1/visits/' + entries[1].id + '/defer', { reason_code: 'administrative_correction' }, 1)).status, 403);
    await owner.goto(url());
    const result = await uiCommand(owner, entries[1].name, 'defer', 'إرجاء إلى نهاية الدور', 'administrative_correction');
    assert.equal(result.ticket_number, entries[1].ticket_number);
    assert.equal((await get(owner, '/v1/visits/' + entries[1].id)).data.visit.waiting_position, 5);
  });
  await step('R10', 'Permanent departure retains history and cannot return or reissue a ticket', async () => {
    const departed = await uiCommand(staff, 'حضور مباشر من المتصفح', 'leave', 'مغادرة نهائية');
    assert.equal(departed.ticket_number, 5); assert.equal(departed.state, 'left');
    assert.equal((await post(staff, '/v1/visits/' + direct.id + '/return', { reason_code: 'patient_returned' }, 2)).status, 409);
  });
  await step('R11', 'Name and ticket search are scoped without renumbering the filtered queue', async () => {
    await staff.getByLabel('جلسة الاستقبال', { exact: true }).selectOption(sid);
    await staff.getByLabel('بحث بالاسم أو رقم التذكرة', { exact: true }).fill(entries[1].name);
    await staff.getByRole('button', { name: 'عرض قائمة الاستقبال', exact: true }).click();
    await staff.waitForURL(/search=/);
    await staff.waitForFunction(() => document.querySelectorAll('article.reception-card').length === 1);
    const result = await get(staff, '/v1/reception?date=' + day + '&session_id=' + sid + '&search=' + encodeURIComponent(entries[1].name));
    assert.equal(result.arrivals[0].visit.ticket_number, entries[1].ticket_number); assert.equal(result.arrivals[0].visit.waiting_position, 4);
    const ticket = await get(staff, '/v1/reception?date=' + day + '&session_id=' + sid + '&search=٢');
    assert.equal(ticket.arrivals.length, 1); assert.equal(ticket.arrivals[0].visit.ticket_number, 2);
  });
  await step('R12', 'CSRF, cross-clinic access and phone lookup restrictions remain enforced', async () => {
    assert.equal((await post(staff, '/v1/visits/' + entries[0].id + '/leave', { reason_code: 'patient_left' }, 3, undefined, false)).status, 419);
    assert.equal((await staff.request.get(base + '/v1/visits/' + ids.VISIT_B1, { headers: { Accept: 'application/json' } })).status(), 404);
    assert.equal((await staff.request.get(base + '/v1/reception?phone=700000099', { headers: { Accept: 'application/json' } })).status(), 422);
    const doctor = await pageFor(await browser.newContext(opts));
    await login(doctor, 'demo_doctor_a');
    assert.equal((await doctor.request.get(base + '/v1/reception', { headers: { Accept: 'application/json' } })).status(), 403);
  });
  await step('R13', 'Reception controls and empty state fit all widths at normal and 200 percent text', async () => {
    for (const width of [360, 768, 1440]) {
      for (const scale of [100, 200]) {
        await staff.setViewportSize({ width, height: 900 });
        await staff.goto(url()); await staff.getByRole('heading', { level: 1 }).waitFor();
        await staff.getByText('إضافة حضور مباشر', { exact: true }).click();
        await staff.evaluate(scale => { document.documentElement.style.fontSize = scale + '%'; }, scale);
        await captureLayout(staff, 'reception-' + width + '-text' + scale);
        await staff.goto(url() + '&search=' + encodeURIComponent('اسم صناعي غير موجود'));
        await staff.getByRole('heading', { name: 'لا توجد نتائج مطابقة', exact: true }).waitFor();
        await staff.evaluate(scale => { document.documentElement.style.fontSize = scale + '%'; }, scale);
        await captureLayout(staff, 'empty-' + width + '-text' + scale);
      }
    }
  });
  await step('R15', 'Last-slot lost walk-in response survives refresh and updates pagination from 20 to 21 arrivals', async () => {
    activePage = staff;
    const endpoint = '/v1/sessions/' + sid + '/walk-ins';
    const listing = '/v1/reception?date=' + day + '&session_id=' + sid;
    for (let ticket = 6; ticket <= 20; ticket++) {
      const added = await post(staff, endpoint, { window_id: wid, display_name: 'حضور لاختبار الصفحات ' + ticket, contact_phone: null });
      assert.equal(added.status, 201); assert.equal(added.body.ticket_number, ticket);
    }
    const before = await get(staff, listing);
    assert.equal(before.arrivals.length, 20); assert.equal(before.pagination.next, null);
    const windowBefore = before.sessions.find(s => s.id === sid).windows.find(w => w.id === wid);
    assert.equal(windowBefore.capacity, 21); assert.equal(windowBefore.reserved, 20);
    await staff.setViewportSize({ width: 360, height: 800 });
    await staff.goto(url());
    await staff.waitForFunction(() => document.querySelectorAll('article.reception-card').length === 20);
    const pages = staff.getByRole('navigation', { name: 'صفحات القائمة', exact: true });
    assert.equal(await pages.getByRole('link', { name: 'التالي', exact: true }).count(), 0);
    await staff.getByText('إضافة حضور مباشر', { exact: true }).click();
    const form = staff.locator('form.walk-in-form');
    await form.getByLabel('الطبيب والجلسة', { exact: true }).selectOption(sid);
    await form.getByLabel('نافذة الوصول', { exact: true }).selectOption(wid);
    await form.getByLabel('اسم المراجع المباشر', { exact: true }).fill('آخر حضور مع انقطاع الرد');
    const route = '**' + endpoint;
    let committed, original;
    await staff.route(route, async r => {
      original = { url: r.request().url(), data: r.request().postDataJSON(), key: r.request().headers()['idempotency-key'] };
      const response = await r.fetch(); assert.equal(response.status(), 201);
      committed = await response.json(); await r.abort('failed');
    });
    await form.getByRole('button', { name: 'حفظ الحضور المباشر وإصدار التذكرة', exact: true }).click();
    await form.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).waitFor();
    assert.equal(committed.ticket_number, 21); assert.ok(original.key);
    await staff.unroute(route);
    const [refresh] = await Promise.all([
      staff.waitForResponse(r => new URL(r.url()).pathname === '/workspace/reception' && r.request().method() === 'GET'),
      staff.getByRole('button', { name: 'تحديث قائمة الحضور', exact: true }).click(),
    ]);
    assert.equal(refresh.status(), 200);
    const refreshed = (await refresh.json()).props;
    const fullWindow = refreshed.sessions.find(s => s.id === sid).windows.find(w => w.id === wid);
    assert.equal(fullWindow.capacity, 21); assert.equal(fullWindow.reserved, 21);
    await pages.getByRole('link', { name: 'التالي', exact: true }).waitFor();
    await form.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).waitFor();
    assert.equal(await form.getByLabel('الطبيب والجلسة', { exact: true }).inputValue(), sid);
    assert.equal(await form.getByLabel('اسم المراجع المباشر', { exact: true }).isDisabled(), true);
    const [retry] = await Promise.all([
      staff.waitForResponse(r => r.url() === original.url && r.request().method() === 'POST'),
      form.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).click(),
    ]);
    assert.equal(retry.status(), 201);
    assert.equal(retry.request().url(), original.url);
    assert.equal(retry.request().headers()['idempotency-key'], original.key);
    assert.deepEqual(retry.request().postDataJSON(), original.data);
    const result = await retry.json();
    assert.equal(result.replayed, true); assert.equal(result.id, committed.id); assert.equal(result.ticket_number, 21);
    await staff.getByRole('heading', { name: 'تم حفظ الحضور المباشر', exact: true }).waitFor();
    assert.equal((await get(staff, '/v1/visits/' + result.id)).events.filter(e => e.event_type === 'visit_check_in').length, 1);
    const firstPage = await get(staff, listing), secondPage = await get(staff, listing + '&page=2');
    const all = [...firstPage.arrivals, ...secondPage.arrivals];
    assert.equal(all.length, 21); assert.equal(new Set(all.map(row => row.booking_id)).size, 21);
    assert.equal(all.filter(row => row.visit?.id === result.id).length, 1);
    assert.equal(secondPage.arrivals.length, 1); assert.equal(secondPage.arrivals[0].visit.id, direct.id); assert.equal(secondPage.pagination.next, null);
    await pages.getByRole('link', { name: 'التالي', exact: true }).click();
    await staff.waitForURL(/page=2/);
    await card(staff, 'حضور مباشر من المتصفح').waitFor();
    assert.equal(await staff.locator('article.reception-card').count(), 1);
    report.walkInRefreshRetry = { rowsBefore: 20, rowsAfter: 21, windowCapacity: 21, sameRequestAndKey: true, replayed: true, ticket: 21, oneArrivalEvent: true, secondPageReachable: true };
  });
  await step('R14', 'No unexpected JavaScript or server errors', async () => {
    assert.deepEqual(report.runtimeErrors, []); assert.deepEqual(report.serverErrors, []);
  });
  report.passed = true;
})().catch(async e => {
  process.exitCode = 1; console.error(String(e.stack).replace(/[a-f0-9]{64}/gi, '[private bearer redacted]'));
  if (activePage) { try { report.failure = { path: new URL(activePage.url()).pathname, body: (await activePage.locator('body').innerText()).slice(0, 2000) }; await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, style: '.private-ticket-value{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;background:#e7eff1!important}.private-ticket-value::selection{color:transparent!important;-webkit-text-fill-color:transparent!important;background:transparent!important}' }); } catch {} }
}).finally(async () => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2).replace(/[a-f0-9]{64}/gi, '[private bearer redacted]') + '\n');
  if (browser) await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(c => c.status !== 'passed').map(c => c.id) }));
});
