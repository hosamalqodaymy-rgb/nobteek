/* Operational acceptance against the isolated Laravel and PostgreSQL instance. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, devices } = require(path.join(process.env.NOBTEEK_BROWSER_TOOLS, 'node_modules/playwright'));

assert.equal(process.env.APP_ENV, 'testing');
assert.equal(process.env.DB_DATABASE, 'nobteek_test_browser');
const base = 'http://127.0.0.1:8000';
const day = new Date(Date.parse(process.env.NOBTEEK_BROWSER_CLOCK) + 3 * 3600000).toISOString().slice(0, 10);
const fixture = require('../application/database/fixtures/foundation_demo.json').ids;
const password = process.env.NOBTEEK_BROWSER_PASSWORD;
const secret = process.env.NOBTEEK_BROWSER_MFA_SECRET;
assert.ok(password && /^[A-Z2-7]{32}$/.test(secret));
const output = path.join(__dirname, '../results/p12-ci');
const mobileEngine = process.env.NOBTEEK_P12_MOBILE_CHROMIUM === 'true' ? chromium : webkit;
const clinics = [
  { code: 'A', id: fixture.CLINIC_A, doctors: ['A', 'C'] },
  { code: 'B', id: fixture.CLINIC_B, doctors: ['B'] },
];
const report = {
  phase: 'P12', syntheticOnly: true, physicalPhoneTested: false,
  engines: { desktop: chromium.name(), mobile: mobileEngine.name() }, checks: [], layouts: [],
  blockedExternalRequests: 0, passed: false,
};

async function check(name, execute) {
  try {
    await execute();
    report.checks.push({ name, passed: true });
    console.log('P12 ' + name + ' passed');
  } catch (error) {
    report.checks.push({ name, passed: false });
    throw error;
  }
}

function totp() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(value => alphabet.indexOf(value).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(value => parseInt(value, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.parse(process.env.NOBTEEK_BROWSER_CLOCK) / 30000)));
  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function newPage(browser, mobile = false) {
  const profile = mobile
    ? devices[mobileEngine === webkit ? 'iPhone 13' : 'Pixel 7']
    : { viewport: { width: 1440, height: 900 } };
  const context = await browser.newContext({ ...profile, locale: 'ar-YE', timezoneId: 'Asia/Aden' });
  await context.route(/^https?:\/\//, route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    report.blockedExternalRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  return page;
}

async function login(browser, username, withMfa = false) {
  const page = await newPage(browser);
  await page.goto(base + '/login');
  await page.getByLabel('اسم الدخول', { exact: true }).fill(username);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'دخول العيادة', exact: true }).click();
  if (withMfa) {
    await page.waitForURL('**/login/challenge');
    await page.getByLabel('رمز تطبيق التحقق', { exact: true }).fill(totp());
    await page.getByRole('button', { name: 'تحقق ومتابعة', exact: true }).click();
  }
  await page.waitForURL('**/workspace');
  return page;
}

async function get(page, route, expected = 200) {
  const response = await page.request.get(base + route, { headers: { Accept: 'application/json' } });
  assert.equal(response.status(), expected, 'GET ' + route.split('?')[0]);
  return response.json();
}

async function post(page, route, data, expected, version, key = crypto.randomUUID()) {
  const cookies = await page.context().cookies(base);
  const token = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');
  assert.ok(token, 'Expected XSRF cookie in the isolated staff context');
  const headers = {
    Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token.value), 'Idempotency-Key': key,
  };
  if (version !== undefined) headers['If-Match'] = String(version);
  const response = await page.request.post(base + route, { headers, data });
  assert.equal(response.status(), expected, 'POST ' + route);
  return response.json();
}

async function measureLayout(page, label) {
  for (const textScale of [100, 200]) {
    const layout = await page.evaluate(async scale => {
      document.documentElement.style.fontSize = scale + '%';
      await document.fonts.ready;
      return {
        direction: getComputedStyle(document.documentElement).direction,
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      };
    }, textScale);
    report.layouts.push({ label, textScale, ...layout });
    assert.equal(layout.direction, 'rtl');
    assert.ok(layout.content <= layout.viewport + 1, 'Horizontal overflow on ' + label);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
}

function trackTicket(page) {
  return page.waitForResponse(response => new URL(response.url()).pathname === '/v1/tickets/current');
}

async function ticketState(page, read) {
  const [response] = await Promise.all([trackTicket(page), read()]);
  assert.equal(response.status(), 200);
  assert.match(response.headers()['cache-control'], /no-store/);
  return response.json();
}

async function completeVisit({ clinic, doctorCode, owner, reception, desktop, mobile }) {
  const doctor = await login(desktop, 'demo_doctor_' + doctorCode.toLowerCase());
  const patient = await newPage(mobile, true);
  const schedule = {
    doctor_id: fixture['DR_' + doctorCode],
    starts_at: day + 'T00:00', ends_at: day + 'T23:59',
    windows: [{ starts_at: day + 'T00:00', ends_at: day + 'T23:59', capacity: 4 }],
  };
  const session = (await post(owner, '/workspace/sessions', schedule, 201)).data;
  await post(owner, '/v1/sessions/' + session.id + '/open', { reason_code: 'scheduled_start' }, 200, session.version);

  await patient.goto(base + '/clinics/' + clinic.id + '/book');
  await patient.getByLabel('الطبيب والجلسة', { exact: true }).selectOption(session.id);
  await patient.getByLabel('نافذة الوصول', { exact: true }).selectOption(session.windows[0].id);
  await patient.getByLabel('اسم المراجع', { exact: true }).fill('مراجع اختبار الإصدار');
  await patient.getByLabel('رقم التواصل', { exact: true }).fill('700000090');
  const [created] = await Promise.all([
    patient.waitForResponse(response => new URL(response.url()).pathname === '/v1/booking-requests' && response.request().method() === 'POST'),
    patient.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }).click(),
  ]);
  assert.equal(created.status(), 201);
  const booking = await created.json();
  await patient.getByRole('heading', { name: 'تم حفظ الطلب · قيد المراجعة', exact: true }).waitFor();

  const pending = await ticketState(patient, () => patient.goto(booking.ticket_url));
  assert.equal(pending.booking_state, 'pending');
  assert.equal(pending.ticket_number, null);
  await patient.waitForFunction(() => location.hash === '');
  await patient.locator('.ticket-status').waitFor();

  const bookingRoute = '/v1/bookings/' + booking.id;
  const confirmed = await post(reception, bookingRoute + '/confirm', { reason_code: 'booking_reviewed' }, 200, booking.version);
  const replayKey = crypto.randomUUID();
  const visit = await post(reception, bookingRoute + '/check-in', {}, 201, confirmed.version, replayKey);
  assert.equal(visit.ticket_number, 1);
  const replay = await post(reception, bookingRoute + '/check-in', {}, 201, confirmed.version, replayKey);
  assert.equal(replay.replayed, true);
  assert.equal(replay.id, visit.id);

  const queueView = '/v1/doctor?date=' + day + '&session_id=' + session.id + '&state=waiting';
  const queue = await get(doctor, queueView);
  const called = await post(doctor, '/v1/sessions/' + session.id + '/call-next', {}, 200, queue.selected_session.version);
  assert.equal(called.id, visit.id);
  const visitRoute = '/v1/visits/' + visit.id;
  const inService = await post(doctor, visitRoute + '/start', {}, 200, called.version);
  const completed = await post(doctor, visitRoute + '/complete', {}, 200, inService.version);
  assert.equal(completed.state, 'completed');
  const finalTicket = await ticketState(patient, () => patient.getByRole('button', { name: 'تحديث حالة الحجز', exact: true }).click());
  assert.equal(finalTicket.ticket_number, visit.ticket_number);
  assert.equal(finalTicket.visit_state, 'completed');
  const display = await patient.locator('main').innerText();
  assert.ok(!display.includes('700000090') && !display.includes('مراجع اختبار الإصدار'), 'Ticket view exposes contact details');
  await measureLayout(patient, 'mobile-ticket-' + doctorCode);
  await doctor.goto(base + '/workspace/doctor?date=' + day + '&session_id=' + session.id);
  await doctor.getByRole('heading', { name: 'شاشة الطبيب', exact: true }).waitFor();
  await measureLayout(doctor, 'desktop-doctor-' + doctorCode);
  await patient.context().close();
  return { bookingRoute, session, doctor };
}

let desktop;
let mobile;
async function main() {
  desktop = await chromium.launch();
  mobile = await mobileEngine.launch();
  const journeys = [];
  const users = {};
  for (const clinic of clinics) {
    const suffix = clinic.code.toLowerCase();
    const owner = await login(desktop, 'demo_owner_' + suffix, true);
    const reception = await login(desktop, 'demo_reception_' + suffix);
    users[clinic.code] = { owner, reception };
    for (const doctorCode of clinic.doctors) {
      await check('booking_to_completed_visit_' + doctorCode, async () => {
        journeys.push(await completeVisit({ clinic, doctorCode, owner, reception, desktop, mobile }));
      });
    }
  }

  await check('clinic_and_doctor_isolation', async () => {
    const [first, second, third] = journeys;
    await get(users.A.reception, third.bookingRoute, 404);
    await get(users.B.reception, first.bookingRoute, 404);
    const waiting = session => '/v1/sessions/' + session.id + '/waiting';
    await get(first.doctor, waiting(second.session), 404);
    await get(users.B.owner, waiting(first.session), 404);
    const clinicA = await get(users.A.owner, '/workspace/operations?date=' + day);
    const clinicB = await get(users.B.owner, '/workspace/operations?date=' + day);
    assert.equal(clinicA.report.completed, 2);
    assert.equal(clinicB.report.completed, 1);
  });

  await check('notifications_are_simulated_only', async () => {
    const owner = users.A.owner;
    const { notifications } = await get(owner, '/workspace/operations?date=' + day);
    assert.ok(notifications.length > 0);
    assert.ok(notifications.every(item => item.external_state === 'disabled'));
    const data = { event_id: notifications[0].event_id, channel: 'sms' };
    const simulated = await post(owner, '/v1/operations/simulate', data, 200);
    const retried = await post(owner, '/v1/operations/simulate', data, 200);
    assert.equal(simulated.state, 'simulated_not_sent');
    assert.equal(simulated.external_delivery, false);
    assert.equal(retried.replayed, true);
    assert.equal(report.blockedExternalRequests, 0);
  });
  report.passed = true;
}

main().catch(error => {
  const safe = String(error.message)
    .replaceAll(password, '[test password]')
    .replaceAll(secret, '[test secret]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[test bearer]')
    .replace(/\b[a-f0-9]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[test id]');
  console.error(safe);
  process.exitCode = 1;
}).finally(async () => {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  await Promise.all([mobile?.close(), desktop?.close()]);
});
