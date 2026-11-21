/* P09: real isolated Laravel/PostgreSQL journeys. No patient or bearer data in artifacts. */
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
const tomorrow = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const password = process.env.NOBTEEK_BROWSER_PASSWORD;
const mfaSecret = process.env.NOBTEEK_BROWSER_MFA_SECRET;
const expiredSecret = process.env.NOBTEEK_EXPIRED_TICKET_SECRET;
assert.ok(password && mfaSecret && /^[a-f0-9]{64}$/.test(expiredSecret || ''));
const output = path.join(root, 'results/p09-browser-ci');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'fixture.json')));
assert.equal(fixture.synthetic_only, true);
const ticketFields = ['booking_state', 'visit_state', 'ticket_number', 'waiting_ahead', 'doctor_state', 'session_state', 'window_starts_at', 'window_ends_at', 'server_time', 'booking_version', 'visit_version'].sort();
const roomFields = ['doctor_id', 'session_state', 'called_ticket_numbers', 'next_ticket_numbers', 'server_time'].sort();
// Screenshot-only styling avoids mobile full-page mask-coordinate drift. Values remain intact.
const screenshotPrivacyStyle = '.private-ticket-value{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;background:#e7eff1!important}.private-ticket-value::selection{color:transparent!important;-webkit-text-fill-color:transparent!important;background:transparent!important}';
const report = { schemaVersion: 1, phase: 'P09', passed: false, scope: 'real_Laravel_PostgreSQL_private_ticket_and_staff_waiting_room', checks: [], screenshots: [], layoutCases: [], runtimeErrors: [], serverErrors: [], apiResponsesMocked: false, syntheticOnly: true, physicalPhoneTested: false, textResizePercent: 200, faultInjection: ['one_committed_response_aborted', 'temporary_network_abort', 'browser_offline', 'document_visibility_events'] };
let browser, activePage;
function safe(value) { return String(value).replace(/[a-f0-9]{64}/gi, '[private bearer redacted]').replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[identifier]'); }
function checkpoint() { fs.writeFileSync(path.join(output, 'report.json'), safe(JSON.stringify(report, null, 2)) + '\n'); }
function stage(label) { report.currentStage = safe(label); checkpoint(); }
async function bounded(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(label + ' exceeded ' + milliseconds + 'ms')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function jsonBody(response, label) { stage(label); return bounded(response.json(), 10000, label); }
async function textBody(response, label) { stage(label); return bounded(response.text(), 10000, label); }
async function step(id, name, work) {
  const check = { id, name, status: 'running' }; report.checks.push(check); report.activeStep = id; stage(name);
  let timer;
  try {
    await Promise.race([work(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(id + ' exceeded 45000ms during: ' + report.currentStage)), 45000); })]);
    check.status = 'passed'; report.activeStep = null; checkpoint(); console.log(JSON.stringify({ id, status: 'passed' }));
  } catch (error) { check.status = 'failed'; check.error = safe(error.message).slice(0, 2000); check.failedStage = report.currentStage; checkpoint(); throw error; }
  finally { clearTimeout(timer); }
}
function otp() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of mfaSecret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(value => parseInt(value, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.parse(process.env.NOBTEEK_BROWSER_CLOCK) / 30000)));
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function pageFor(context) {
  const page = await context.newPage(); page.setDefaultTimeout(15000); activePage = page;
  page.on('pageerror', error => report.runtimeErrors.push(safe(error.message).slice(0, 300)));
  page.on('response', response => { if (response.status() >= 500 && response.url().startsWith(base)) report.serverErrors.push({ path: safe(new URL(response.url()).pathname), status: response.status() }); });
  return page;
}
async function login(page, username, mfa = false) {
  activePage = page;
  stage('Clinic sign-in' + (mfa ? ' with MFA' : ''));
  await page.goto(base + '/login');
  await page.getByLabel('اسم الدخول', { exact: true }).fill(username);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'دخول العيادة', exact: true }).click();
  if (mfa) { await page.waitForURL('**/login/challenge'); await page.getByLabel('رمز تطبيق التحقق', { exact: true }).fill(otp()); await page.getByRole('button', { name: 'تحقق ومتابعة', exact: true }).click(); }
  await page.waitForURL('**/workspace');
}
async function post(page, route, data, version, key = crypto.randomUUID()) {
  stage('HTTP POST ' + new URL(route, base).pathname);
  const cookies = await page.context().cookies(base); const csrf = cookies.find(cookie => cookie.name === 'XSRF-TOKEN')?.value || '';
  const headers = { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(csrf), 'Idempotency-Key': key };
  if (version !== undefined) headers['If-Match'] = String(version);
  const response = await page.request.post(new URL(route, base).href, { headers, data });
  return { status: response.status(), body: await jsonBody(response, 'Decoding real HTTP command response') };
}
async function get(page, route) { stage('HTTP GET ' + new URL(route, base).pathname); const response = await page.request.get(new URL(route, base).href, { headers: { Accept: 'application/json' } }); assert.equal(response.status(), 200, 'Authorized read failed'); return jsonBody(response, 'Decoding authorized real HTTP data'); }
function bearer(url) { const value = new URL(url, base); assert.ok(value.origin === base && value.pathname === '/ticket' && /^#[a-f0-9]{64}$/.test(value.hash), 'Safe fragment link expected'); return value.hash.slice(1); }
async function readTicket(page, link, query = '') {
  stage('Reading private-ticket DTO through real HTTP client');
  const response = await page.request.get(base + '/v1/tickets/current' + query, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + bearer(link) } });
  const body = await jsonBody(response, 'Decoding private-ticket HTTP response with status ' + response.status()); if (response.status() === 200) assert.deepEqual(Object.keys(body).sort(), ticketFields);
  return { status: response.status(), body, headers: response.headers() };
}
async function openTicket(page, link, expected = 200) {
  activePage = page;
  stage('Opening private shell and waiting for bearer read');
  await page.goto(base + '/help');
  const [response, shell] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname === '/v1/tickets/current'), page.goto(link)]);
  assert.equal(response.status(), expected); await page.waitForFunction(() => location.hash === '');
  stage(expected === 200 ? 'Rendering private ticket state' : 'Rendering unavailable private-link state');
  if (expected === 200) await page.locator('.ticket-status').waitFor();
  else await page.getByRole('heading', { name: 'الرابط غير متاح أو انتهت صلاحيته', exact: true }).waitFor();
  return { response, shell };
}
async function refreshTicket(page) {
  activePage = page;
  stage('Manual private-ticket refresh');
  const [response] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname === '/v1/tickets/current'), page.getByRole('button', { name: 'تحديث حالة الحجز', exact: true }).click()]);
  assert.equal(response.status(), 200); await page.getByRole('button', { name: 'تحديث حالة الحجز', exact: true }).waitFor();
  return jsonBody(response, 'Decoding browser manual-refresh body');
}
async function advancePoll(page, milliseconds, route) {
  activePage = page;
  stage('Automatic poll after ' + milliseconds + 'ms for ' + route);
  const response = page.waitForResponse(value => new URL(value.url()).pathname === route);
  await page.clock.runFor(milliseconds); const result = await response; assert.equal(result.status(), 200); return jsonBody(result, 'Decoding browser automatic-poll body');
}
async function captureLayout(page, name) {
  activePage = page;
  stage('Font readiness for ' + name);
  await bounded(page.evaluate(async () => { await document.fonts.ready; }), 10000, 'Font readiness for ' + name);
  stage('Layout measurement for ' + name);
  const width = page.viewportSize().width;
  const metrics = await page.evaluate(width => {
    const splitActionWords = [];
    for (const button of document.querySelectorAll('main button, main a.btn')) {
      const bounds = button.getBoundingClientRect(); if (!bounds.width || !bounds.height) continue;
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) for (const match of node.textContent.matchAll(/[\p{L}\p{M}]{3,}/gu)) {
        const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        const lines = []; for (const rectangle of range.getClientRects()) if (rectangle.width && rectangle.height && !lines.some(top => Math.abs(top - rectangle.top) <= 1)) lines.push(rectangle.top);
        if (lines.length > 1) splitActionWords.push({ word: match[0], lines: lines.length });
      }
    }
    return { requestedWidth: width, actualWidth: innerWidth, rootWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, direction: getComputedStyle(document.documentElement).direction, splitActionWords,
      controlsOutside: [...document.querySelectorAll('main input, main textarea, main select, main button, main article, main section, header nav')].filter(element => { const box = element.getBoundingClientRect(); return box.width && (box.left < -1 || box.right > width + 1); }).map(element => ({ tag: element.tagName })) };
  }, width);
  const filename = name + '.png';
  stage('Masked screenshot for ' + name);
  await page.screenshot({ path: path.join(output, filename), fullPage: true, style: screenshotPrivacyStyle, animations: 'disabled' });
  metrics.screenshotWidth = fs.readFileSync(path.join(output, filename)).readUInt32BE(16);
  report.screenshots.push(filename); report.layoutCases.push({ name, ...metrics });
  assert.equal(metrics.direction, 'rtl');
  for (const key of ['actualWidth', 'rootWidth', 'bodyWidth', 'screenshotWidth']) assert.ok(Math.abs(metrics[key] - width) <= 1, key + ' must match viewport');
  assert.deepEqual(metrics.controlsOutside, []); assert.deepEqual(metrics.splitActionWords, [], 'Action words must remain whole');
}
async function textSize(page, percent) { await page.evaluate(value => { document.documentElement.style.fontSize = value + '%'; }, percent); }
function safeShell(props) { for (const key of ['auth', 'privateNotice', 'status', 'doctor_workspace_allowed', 'errors']) assert.equal(Object.hasOwn(props, key), false, 'Private shared prop in public shell'); }
async function shellProps(page) {
  stage('Reading unhydrated public shell props');
  const url = new URL(page.url());
  const response = await page.request.get(url.origin + url.pathname + url.search, { headers: { Accept: 'text/html' } });
  assert.equal(response.status(), 200, 'Public HTML shell must load');
  return page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const attribute = document.getElementById('app')?.getAttribute('data-page');
    if (attribute?.trim().startsWith('{')) return JSON.parse(attribute).props;
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      const data = JSON.parse(script.textContent || '{}');
      if (typeof data.component === 'string' && typeof data.url === 'string' && data.props && typeof data.props === 'object') return data.props;
    }
    throw new Error('Initial Inertia page data is absent from the HTML shell');
  }, await textBody(response, 'Reading unhydrated HTML shell body'));
}

(async () => {
  browser = await chromium.launch({ headless: true });
  const opts = { locale: 'ar-YE', timezoneId: 'Asia/Aden' };
  const owner = await pageFor(await browser.newContext({ ...opts, viewport: { width: 1440, height: 1000 } }));
  const reception = await pageFor(await browser.newContext(opts));
  const doctor = await pageFor(await browser.newContext(opts));
  const other = await pageFor(await browser.newContext(opts));
  const guest = await pageFor(await browser.newContext({ ...opts, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, acceptDownloads: true }));
  const ticket = await pageFor(await browser.newContext({ ...opts, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }));
  const invalid = await pageFor(await browser.newContext({ ...opts, viewport: { width: 360, height: 800 } }));
  let hall;
  await ticket.clock.install({ time: new Date(process.env.NOBTEEK_BROWSER_CLOCK) });
  await ticket.clock.pauseAt(new Date(Date.parse(process.env.NOBTEEK_BROWSER_CLOCK) + 1000));
  let ticketRequests = 0;
  const ticketTransport = [];
  ticket.on('request', request => { if (new URL(request.url()).pathname === '/v1/tickets/current') ticketRequests++; });
  ticket.on('requestfinished', async request => {
    if (new URL(request.url()).pathname !== '/v1/tickets/current') return;
    const headers = await request.allHeaders(); ticketTransport.push({ fixedPath: request.url() === base + '/v1/tickets/current', hasBearer: /^Bearer [a-f0-9]{64}$/.test(headers.authorization || ''), noCookie: !headers.cookie, noReferer: !headers.referer });
  });
  let sid, wid, receipt, family, targetVisit, activeVisit, renewed, future, futureSession;
  const arrivals = [];
  const snapshot = (state = 'waiting', session = sid, date = day) => get(doctor, '/v1/doctor?date=' + date + '&session_id=' + session + '&state=' + state);
  const booking = id => get(reception, '/v1/bookings/' + id).then(result => result.data);
  const visit = id => get(reception, '/v1/visits/' + id).then(result => result.data);
  const roomRoute = () => '/v1/sessions/' + sid + '/waiting';

  await step('P09B01', 'Owner MFA and distinct reception, physician, unrelated physician, and anonymous contexts', async () => {
    await login(owner, 'demo_owner_a', true); await login(reception, 'demo_reception_a'); await login(doctor, fixture.doctor_username); await login(other, fixture.other_doctor_username);
    hall = await pageFor(await browser.newContext({ ...opts, viewport: { width: 1440, height: 1000 }, storageState: await owner.context().storageState() }));
    await hall.clock.install({ time: new Date(process.env.NOBTEEK_BROWSER_CLOCK) });
    await hall.clock.pauseAt(new Date(Date.parse(process.env.NOBTEEK_BROWSER_CLOCK) + 1000));
    const created = await post(owner, '/workspace/sessions', { doctor_id: fixture.doctor_id, starts_at: day + 'T00:00', ends_at: day + 'T23:59', windows: [{ starts_at: day + 'T00:00', ends_at: day + 'T23:59', capacity: 30 }] });
    assert.equal(created.status, 201); sid = created.body.data.id; wid = created.body.data.windows[0].id;
    assert.equal((await post(owner, '/v1/sessions/' + sid + '/open', { reason_code: 'scheduled_start' }, 1)).status, 200);
  });
  await step('P09B02', 'Public doctor/window booking receipt offers explicit private copy and file save', async () => {
    activePage = guest;
    await guest.goto(base + '/clinics/' + fixture.clinic_id + '/book'); safeShell(await shellProps(guest));
    await guest.getByLabel('الطبيب والجلسة', { exact: true }).selectOption(sid); await guest.getByLabel('نافذة الوصول', { exact: true }).selectOption(wid);
    await guest.getByLabel('اسم المراجع', { exact: true }).fill('مراجع المتابعة التجريبي'); await guest.getByLabel('رقم التواصل', { exact: true }).fill('777123456');
    const [response] = await Promise.all([guest.waitForResponse(value => new URL(value.url()).pathname === '/v1/booking-requests' && value.request().method() === 'POST'), guest.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }).click()]);
    assert.equal(response.status(), 201); receipt = await jsonBody(response, 'Decoding browser public-booking receipt'); bearer(receipt.ticket_url);
    await guest.getByRole('heading', { name: 'تم حفظ الطلب · قيد المراجعة', exact: true }).waitFor();
    assert.ok(await guest.locator('.private-ticket-value').inputValue() === receipt.ticket_url, 'Receipt link matches issued link');
    assert.equal((await guest.locator('body').innerText()).includes(receipt.id), false, 'Internal booking reference is not public UI');
    await guest.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    stage('Copying private link to explicitly permitted clipboard');
    await guest.getByRole('button', { name: 'نسخ الرابط الخاص', exact: true }).click();
    assert.ok(await bounded(guest.evaluate(() => navigator.clipboard.readText()), 10000, 'Private clipboard read') === receipt.ticket_url, 'Explicit copy preserved private link');
    stage('Saving explicit private-link download');
    const [download] = await Promise.all([guest.waitForEvent('download'), guest.getByRole('button', { name: 'حفظ ملف الرابط', exact: true }).click()]);
    assert.equal(download.suggestedFilename(), 'nobteek-private-link.txt');
    let file = ''; for await (const chunk of await download.createReadStream()) file += chunk.toString(); assert.ok(file.trim() === receipt.ticket_url, 'Saved link matches receipt'); await download.delete();
    await captureLayout(guest, 'public-booking-receipt-360'); await textSize(guest, 200); await captureLayout(guest, 'public-booking-receipt-360-text200'); await textSize(guest, 100);
    const second = await post(guest, '/v1/booking-requests', { session_id: sid, window_id: wid, display_name: 'حجز أسرة تجريبي مستقل', contact_phone: '777123456' });
    assert.equal(second.status, 201); family = second.body; assert.ok(family.id !== receipt.id && family.ticket_url !== receipt.ticket_url, 'Family contact does not merge private bookings');
  });
  await step('P09B03', 'Pending ticket uses exact private DTO and bearer header with fragment scrubbed and no persisted data', async () => {
    await ticket.addInitScript(tokens => {
      window.__p09HistoryObservation = { encryptionCalls: 0, leaked: false };
      function inspect(value) { let text = ''; try { text = typeof value === 'string' ? value : value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? new TextDecoder().decode(value) : JSON.stringify(value); } catch {} if (typeof text === 'string' && (tokens.some(token => text.includes(token)) || /\/ticket(?:#|%23)[a-f0-9]{64}/i.test(text))) window.__p09HistoryObservation.leaked = true; }
      for (const name of ['pushState', 'replaceState']) { const native = history[name].bind(history); history[name] = (data, title, url) => { inspect(data); inspect(url); return native(data, title, url); }; }
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle); crypto.subtle.encrypt = (algorithm, key, data) => { window.__p09HistoryObservation.encryptionCalls++; inspect(data); return encrypt(algorithm, key, data); };
    }, [bearer(receipt.ticket_url), bearer(family.ticket_url)]);
    const { response, shell } = await openTicket(ticket, receipt.ticket_url); const data = await jsonBody(response, 'Decoding successful browser private-ticket read');
    assert.deepEqual(Object.keys(data).sort(), ticketFields); assert.equal(data.booking_state, 'pending'); assert.equal(data.ticket_number, null); assert.equal(data.waiting_ahead, null);
    assert.ok(response.headers()['cache-control'].includes('no-store')); assert.equal(response.headers()['referrer-policy'], 'no-referrer');
    assert.ok(shell.headers()['cache-control'].includes('no-store')); assert.equal(shell.headers()['referrer-policy'], 'no-referrer');
    safeShell(await shellProps(ticket)); assert.equal((await textBody(shell, 'Inspecting browser private HTML shell')).includes(bearer(receipt.ticket_url)), false);
    const persisted = await ticket.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, history: history.state }));
    assert.equal(persisted.includes(bearer(receipt.ticket_url)), false); assert.equal(persisted.includes('waiting_ahead'), false);
    await ticket.waitForFunction(() => window.__p09HistoryObservation.encryptionCalls > 0);
    assert.equal((await ticket.evaluate(() => window.__p09HistoryObservation)).leaked, false, 'Bearer never reaches encrypted-history plaintext');
    assert.equal(await ticket.locator('[data-ticket-number]').count(), 0); assert.equal(await ticket.locator('[data-waiting-ahead]').count(), 0);
    await captureLayout(ticket, 'ticket-pending-360');
    stage('Native same-page private-link navigation');
    const switched = ticket.waitForResponse(value => new URL(value.url()).pathname === '/v1/tickets/current');
    await ticket.evaluate(link => { const anchor = document.createElement('a'); anchor.href = link; document.body.append(anchor); anchor.click(); anchor.remove(); }, family.ticket_url);
    assert.equal((await switched).status(), 200); await ticket.waitForFunction(() => location.hash === '');
    assert.ok(await ticket.locator('.private-ticket-value').inputValue() === family.ticket_url, 'Same-page saved link uses the new capability');
    stage('Back and Forward with distinct component-key instants');
    await ticket.clock.runFor(1); await ticket.goBack(); await ticket.clock.runFor(1); await ticket.goForward(); await ticket.waitForFunction(() => location.hash === '');
    assert.equal((await ticket.evaluate(() => window.__p09HistoryObservation)).leaked, false, 'Back and Forward cannot restore a secret from history');
    await openTicket(ticket, receipt.ticket_url);
    const ownerShell = await pageFor(owner.context()); await ownerShell.goto(base + '/ticket'); safeShell(await shellProps(ownerShell));
    assert.equal(await ownerShell.getByRole('button', { name: 'خروج', exact: true }).count(), 0); await ownerShell.close();
    report.privateTransport = { fragmentScrubbedBeforeInertia: true, encryptedHistoryPlaintextInspected: true, samePageSavedLinkHandled: true, backForwardContainsNoCapability: true, bearerHeaderOnly: true, cookieOmitted: true, noReferrer: true, noStore: true, noBrowserPersistence: true, exactFields: 11 };
  });
  await step('P09B04', 'Wrong, expired, missing, guessed and tampered links reveal no booking or family lookup', async () => {
    const wrong = base + '/ticket#' + crypto.randomBytes(32).toString('hex');
    await openTicket(invalid, wrong, 404);
    const wrongRead = await readTicket(guest, wrong); assert.equal(wrongRead.status, 404);
    const expiredLink = base + '/ticket#' + expiredSecret;
    await openTicket(invalid, expiredLink, 404);
    const expiredRead = await readTicket(guest, expiredLink); assert.equal(expiredRead.status, 404); assert.deepEqual(expiredRead.body, wrongRead.body);
    assert.equal(await invalid.locator('.ticket-status').count(), 0); assert.equal(await invalid.locator('.private-ticket-value').count(), 0);
    await captureLayout(invalid, 'ticket-expired-360');
    await invalid.goto(base + '/help'); await invalid.goto(base + '/ticket#' + receipt.id); await invalid.getByRole('heading', { name: 'افتح رابطك الخاص', exact: true }).waitFor();
    await invalid.reload(); await invalid.getByRole('heading', { name: 'افتح رابطك الخاص', exact: true }).waitFor();
    assert.equal((await readTicket(guest, receipt.ticket_url, '?booking_id=' + family.id)).status, 422);
    assert.equal((await guest.request.get(base + '/v1/bookings?phone=777123456', { headers: { Accept: 'application/json' } })).status(), 401);
    const samePhone = await readTicket(guest, family.ticket_url); assert.equal(samePhone.body.booking_state, 'pending'); assert.equal(samePhone.body.ticket_number, null);
  });
  await step('P09B05', 'Confirmed arrival assigns a fixed ticket and excludes unarrived family bookings from the waiting count', async () => {
    for (let number = 1; number <= 3; number++) {
      const created = await post(reception, '/v1/sessions/' + sid + '/walk-ins', { window_id: wid, display_name: 'حضور تجريبي ' + number, contact_phone: null });
      assert.equal(created.status, 201); assert.equal(created.body.ticket_number, number); bearer(created.body.ticket_url); arrivals.push(created.body);
    }
    assert.equal((await post(reception, '/v1/bookings/' + receipt.id + '/confirm', { reason_code: 'booking_reviewed' }, receipt.version)).status, 200);
    const current = await booking(receipt.id); const checked = await post(reception, '/v1/bookings/' + receipt.id + '/check-in', {}, current.version);
    assert.equal(checked.status, 201); targetVisit = checked.body; assert.equal(targetVisit.ticket_number, 4);
    assert.equal((await post(reception, '/v1/bookings/' + family.id + '/confirm', { reason_code: 'booking_reviewed' }, family.version)).status, 200);
    for (let number = 5; number <= 7; number++) {
      const created = await post(reception, '/v1/sessions/' + sid + '/walk-ins', { window_id: wid, display_name: 'حضور تجريبي ' + number, contact_phone: null });
      assert.equal(created.status, 201); arrivals.push(created.body);
    }
    const data = await refreshTicket(ticket); assert.equal(data.ticket_number, 4); assert.equal(data.waiting_ahead, 3); assert.equal(data.visit_state, 'waiting');
    await ticket.locator('[data-waiting-ahead]').filter({ hasText: /^3$/ }).waitFor();
    await captureLayout(ticket, 'ticket-waiting-360'); await textSize(ticket, 200); await captureLayout(ticket, 'ticket-waiting-360-text200'); await textSize(ticket, 100);
    assert.equal((await readTicket(guest, family.ticket_url)).body.ticket_number, null);
  });
  await step('P09B06', 'Priority, current service and session pause remain distinct from present waiting count; automatic 20s polling', async () => {
    const fifth = arrivals.find(row => row.ticket_number === 5);
    assert.equal((await post(doctor, '/v1/visits/' + fifth.id + '/priority', { reason_code: 'clinical_priority' }, fifth.version)).status, 200);
    let data = await refreshTicket(ticket); assert.equal(data.waiting_ahead, 4);
    const before = await snapshot(); const called = await post(doctor, '/v1/sessions/' + sid + '/call-next', {}, before.selected_session.version);
    assert.equal(called.status, 200); activeVisit = called.body; assert.equal(activeVisit.id, fifth.id);
    data = await advancePoll(ticket, 20010, '/v1/tickets/current'); assert.equal(data.waiting_ahead, 3); assert.equal(data.doctor_state, 'called'); assert.equal(data.visit_state, 'waiting');
    assert.equal((await post(doctor, '/v1/visits/' + activeVisit.id + '/start', {}, activeVisit.version)).status, 200);
    const current = await snapshot(); assert.equal((await post(owner, '/v1/sessions/' + sid + '/pause', { reason_code: 'operational_pause' }, current.selected_session.version)).status, 200);
    data = await refreshTicket(ticket); assert.equal(data.session_state, 'paused'); assert.equal(data.doctor_state, 'in_service'); assert.equal(data.waiting_ahead, 3);
    await ticket.getByText('الطبيب يجري كشفًا الآن', { exact: true }).waitFor(); await ticket.getByText('النداء متوقف مؤقتًا', { exact: true }).waitFor();
    report.waitingSemantics = { activeExcluded: true, unarrivedExcluded: true, priorityOrdered: true, sessionStateSeparate: true, ticketPollSeconds: 20 };
  });
  await step('P09B07', 'Staff waiting display is session scoped, numbers only, and refreshes automatically every 5 seconds', async () => {
    activePage = hall;
    let data = await get(owner, roomRoute()); assert.deepEqual(Object.keys(data).sort(), roomFields); assert.deepEqual(data.called_ticket_numbers, [5]); assert.deepEqual(data.next_ticket_numbers, [1, 2, 3, 4, 6]);
    assert.equal((await guest.request.get(base + roomRoute(), { headers: { Accept: 'application/json' } })).status(), 401);
    assert.equal((await other.request.get(base + roomRoute(), { headers: { Accept: 'application/json' } })).status(), 404);
    assert.equal((await doctor.request.get(base + roomRoute(), { headers: { Accept: 'application/json' } })).status(), 200);
    assert.equal((await owner.request.get(base + '/v1/sessions/' + fixture.other_clinic_session_id + '/waiting', { headers: { Accept: 'application/json' } })).status(), 404);
    await hall.goto(base + '/workspace/sessions/' + sid + '/waiting'); await hall.getByRole('list', { name: 'أرقام الدور الحالي', exact: true }).waitFor(); safeShell(await shellProps(hall));
    const text = await hall.locator('body').innerText(); assert.equal(text.includes('مراجع المتابعة التجريبي'), false); assert.equal(text.includes('777123456'), false); assert.equal(text.includes(fixture.doctor_id), false); assert.equal(text.includes('demo_owner_a'), false);
    for (const width of [1440, 768, 360]) { await hall.setViewportSize({ width, height: 900 }); await captureLayout(hall, 'waiting-room-' + width); }
    await textSize(hall, 200); await captureLayout(hall, 'waiting-room-360-text200'); await textSize(hall, 100);
    data = await advancePoll(hall, 5010, roomRoute()); assert.deepEqual(data.called_ticket_numbers, [5]);
    const oldRoom = await get(owner, '/v1/sessions/' + fixture.old_session_id + '/waiting'); assert.deepEqual(oldRoom.called_ticket_numbers, []); assert.ok(!oldRoom.next_ticket_numbers.includes(5));
    report.waitingRoom = { staffOnly: true, tenantAndDoctorScoped: true, currentIncludesInService: true, selectedSessionOnly: true, nextLimit: 5, safeFields: 5, pollSeconds: 5 };
  });
  await step('P09B08', 'Away and return states preserve ticket number and return to the end without inventing a count', async () => {
    let current = await visit(targetVisit.id);
    assert.equal((await post(reception, '/v1/visits/' + targetVisit.id + '/mark-away', { reason_code: 'temporarily_absent' }, current.visit.version)).status, 200);
    let data = await refreshTicket(ticket); assert.equal(data.visit_state, 'away'); assert.equal(data.waiting_ahead, null); assert.equal(data.ticket_number, 4);
    assert.equal(await ticket.locator('[data-waiting-ahead]').count(), 0);
    current = await visit(targetVisit.id); assert.equal((await post(reception, '/v1/visits/' + targetVisit.id + '/return', { reason_code: 'patient_returned' }, current.visit.version)).status, 200);
    data = await refreshTicket(ticket); assert.equal(data.visit_state, 'waiting'); assert.equal(data.ticket_number, 4); assert.equal(data.waiting_ahead, 5);
  });
  await step('P09B09', 'Offline, hidden-tab pause and exponential retry preserve an honest stale state', async () => {
    stage('Offline lifecycle and paused automatic requests');
    let count = ticketRequests; await ticket.context().setOffline(true); await ticket.getByRole('status').filter({ hasText: 'الاتصال منقطع' }).waitFor();
    await ticket.clock.runFor(60000); assert.equal(ticketRequests, count); await captureLayout(ticket, 'ticket-offline-360');
    const returned = ticket.waitForResponse(response => new URL(response.url()).pathname === '/v1/tickets/current'); await ticket.context().setOffline(false); assert.equal((await returned).status(), 200);
    await ticket.getByRole('status').filter({ hasText: 'الاتصال منقطع' }).waitFor({ state: 'detached' });
    stage('Hidden-tab lifecycle and visible resume');
    await ticket.evaluate(() => { window.__p09Hidden = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__p09Hidden }); document.dispatchEvent(new Event('visibilitychange')); });
    count = ticketRequests; await ticket.clock.runFor(60000); assert.equal(ticketRequests, count);
    const visible = ticket.waitForResponse(response => new URL(response.url()).pathname === '/v1/tickets/current'); await ticket.evaluate(() => { window.__p09Hidden = false; document.dispatchEvent(new Event('visibilitychange')); }); assert.equal((await visible).status(), 200);
    stage('Aborted read and exponential backoff');
    await ticket.route('**/v1/tickets/current', route => route.abort('failed'));
    await ticket.getByRole('button', { name: 'تحديث حالة الحجز', exact: true }).click(); await ticket.getByRole('status').filter({ hasText: 'تعذر تأكيد آخر تحديث' }).waitFor();
    count = ticketRequests; await ticket.clock.runFor(39000); assert.equal(ticketRequests, count);
    const secondFailure = ticket.waitForEvent('requestfailed', request => new URL(request.url()).pathname === '/v1/tickets/current');
    await ticket.clock.runFor(1010); await secondFailure; assert.equal(ticketRequests, count + 1);
    await ticket.getByRole('button', { name: 'تحديث حالة الحجز', exact: true }).waitFor(); await ticket.unroute('**/v1/tickets/current'); await refreshTicket(ticket);
    report.polling = { hiddenPaused: true, resumedOnVisible: true, offlineRetainsStaleData: true, reconnectImmediate: true, failedReadBackoffFirstMilliseconds: 40000, manualRefreshWorks: true };
  });
  await step('P09B10', 'Verified recovery survives lost committed response, refreshed version and disappearing row, with one immutable replay', async () => {
    activePage = owner;
    const before = await booking(receipt.id);
    assert.equal((await post(reception, before.actions.ticket_link, { reason_code: 'patient_requested_recovery', verified_identity: false }, before.version)).status, 422);
    assert.equal((await post(reception, before.actions.ticket_link, { contact_phone: '777123456' }, before.version)).status, 422);
    assert.equal((await post(doctor, before.actions.ticket_link, { reason_code: 'patient_requested_recovery', verified_identity: true }, before.version)).status, 403);
    await owner.goto(base + '/workspace/bookings?date=' + day + '&state=confirmed');
    const row = owner.locator('.booking-card[data-booking-id="' + receipt.id + '"]'); await row.getByRole('button', { name: 'استعادة رابط المتابعة', exact: true }).click();
    const panel = owner.locator('.ticket-recovery'); const issueButton = panel.getByRole('button', { name: 'إصدار رابط جديد لصاحب الحجز', exact: true }); assert.equal(await issueButton.isDisabled(), true);
    await panel.getByRole('checkbox').check(); await owner.setViewportSize({ width: 360, height: 900 }); await textSize(owner, 200); await captureLayout(owner, 'staff-recovery-360-text200'); await textSize(owner, 100);
    let original, committed;
    const endpoint = '/v1/bookings/' + receipt.id + '/ticket-link';
    await owner.route('**' + endpoint, async route => {
      original = { url: route.request().url(), key: route.request().headers()['idempotency-key'], version: route.request().headers()['if-match'], data: route.request().postDataJSON() };
      const response = await route.fetch(); assert.equal(response.status(), 200); committed = await jsonBody(response, 'Decoding committed recovery before intentional response loss'); await route.abort('failed');
    });
    await issueButton.click(); await panel.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).waitFor(); await owner.unroute('**' + endpoint);
    assert.equal(await owner.getByRole('button', { name: 'إرسال طلب الحجز', exact: true }).isDisabled(), true); assert.equal(await owner.getByRole('button', { name: 'عرض الحجوزات', exact: true }).isDisabled(), true);
    assert.equal(await panel.getByRole('checkbox').isDisabled(), true);
    const changed = await booking(receipt.id); assert.equal(changed.version, before.version + 1);
    assert.equal((await post(reception, '/v1/bookings/' + receipt.id + '/cancel', { reason_code: 'patient_request' }, changed.version)).status, 200);
    const [refresh] = await Promise.all([owner.waitForResponse(response => new URL(response.url()).pathname === '/workspace/bookings' && response.request().method() === 'GET'), owner.getByRole('button', { name: 'تحديث البيانات', exact: true }).click()]);
    assert.equal(refresh.status(), 200); await row.waitFor({ state: 'detached' }); await owner.getByRole('button', { name: 'تحديث البيانات', exact: true }).waitFor();
    const [retry] = await Promise.all([owner.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST'), panel.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).click()]);
    assert.equal(retry.status(), 200); assert.ok(retry.request().url() === original.url && retry.request().headers()['idempotency-key'] === original.key && retry.request().headers()['if-match'] === original.version, 'Recovery replay preserved URL, key and version'); assert.deepEqual(retry.request().postDataJSON(), original.data);
    renewed = await jsonBody(retry, 'Decoding browser recovery replay'); assert.equal(renewed.replayed, true); assert.ok(renewed.ticket_url === committed.ticket_url, 'Replay returns same current link');
    await owner.locator('.ticket-recovery-receipt .private-ticket-value').waitFor(); assert.ok(await owner.locator('.ticket-recovery-receipt .private-ticket-value').inputValue() === renewed.ticket_url);
    assert.equal((await readTicket(guest, receipt.ticket_url)).status, 404); const result = await readTicket(guest, renewed.ticket_url); assert.equal(result.body.booking_state, 'cancelled'); assert.equal(result.body.waiting_ahead, null);
    const audit = await get(reception, '/v1/bookings/' + receipt.id); assert.equal(audit.events.filter(event => event.event_type === 'booking_ticket-link').length, 1);
    await openTicket(ticket, renewed.ticket_url); await ticket.getByRole('heading', { name: 'الحجز ملغى', exact: true }).waitFor(); await captureLayout(ticket, 'ticket-cancelled-360');
    report.recovery = { explicitIdentityRequired: true, phoneOnlyRejected: true, oldLinkRevoked: true, sameUrlDataVersionAndKey: true, rowDisappearedAfterRefresh: true, auditEvents: 1, replayed: true };
  });
  await step('P09B11', 'Doctor busy in another session never appears as available; rejected and closed states stay honest', async () => {
    const created = await post(owner, '/workspace/sessions', { doctor_id: fixture.doctor_id, starts_at: tomorrow + 'T00:00', ends_at: tomorrow + 'T23:59', windows: [{ starts_at: tomorrow + 'T00:00', ends_at: tomorrow + 'T23:59', capacity: 5 }] });
    assert.equal(created.status, 201); futureSession = created.body.data;
    const requested = await post(guest, '/v1/booking-requests', { session_id: futureSession.id, window_id: futureSession.windows[0].id, display_name: 'متابعة جلسة أخرى تجريبية', contact_phone: '777123456' }); assert.equal(requested.status, 201); future = requested.body;
    const busy = await readTicket(guest, future.ticket_url); assert.equal(busy.body.doctor_state, 'in_service'); assert.equal(busy.body.session_state, 'scheduled'); assert.equal(busy.body.waiting_ahead, null);
    await hall.goto(base + '/workspace/sessions/' + futureSession.id + '/waiting'); await hall.getByText('لا يوجد دور نشط في هذه الجلسة', { exact: true }).waitFor(); assert.equal((await hall.locator('body').innerText()).includes('الطبيب متاح'), false); await captureLayout(hall, 'waiting-room-empty-360');
    assert.equal((await post(reception, '/v1/bookings/' + future.id + '/reject', { reason_code: 'clinic_unavailable' }, future.version)).status, 200);
    await openTicket(invalid, future.ticket_url); await invalid.getByRole('heading', { name: 'لم يُقبل طلب الحجز', exact: true }).waitFor();
    const current = await visit(activeVisit.id); assert.equal((await post(doctor, '/v1/visits/' + activeVisit.id + '/complete', {}, current.visit.version)).status, 200);
    for (const state of ['waiting', 'away']) for (const row of (await snapshot(state)).visits) assert.equal((await post(reception, '/v1/visits/' + row.id + '/leave', { reason_code: 'patient_left' }, row.version)).status, 200);
    const ready = await snapshot(); assert.equal((await post(owner, '/v1/sessions/' + sid + '/close', { reason_code: 'session_completed' }, ready.selected_session.version)).status, 200);
    await openTicket(ticket, family.ticket_url); await ticket.getByText('الجلسة مغلقة', { exact: true }).waitFor(); assert.equal(await ticket.locator('[data-ticket-number]').count(), 0);
    const completed = await readTicket(guest, arrivals.find(row => row.ticket_number === 5).ticket_url); assert.equal(completed.body.booking_state, 'fulfilled'); assert.equal(completed.body.visit_state, 'completed'); assert.equal(completed.body.waiting_ahead, null);
    report.sessionLifecycle = { doctorBusyAcrossSessions: true, emptyHallDoesNotClaimDoctorAvailable: true, rejectedLinkReadable: true, cancelledLinkReadable: true, closedWithoutInventedTicket: true, completedLinkReadable: true };
  });
  await step('P09B12', 'Arabic help and privacy remain readable at 200 percent and no private URLs enter persistence or errors', async () => {
    activePage = invalid;
    for (const [route, name] of [['/help', 'help'], ['/privacy', 'privacy']]) { await invalid.goto(base + route); safeShell(await shellProps(invalid)); await textSize(invalid, 200); await captureLayout(invalid, name + '-360-text200'); await textSize(invalid, 100); }
    activePage = ticket; await ticket.reload(); await ticket.getByRole('heading', { name: 'افتح رابطك الخاص', exact: true }).waitFor(); assert.equal(await ticket.locator('.ticket-status').count(), 0);
    assert.ok(ticketTransport.length >= 10 && ticketTransport.every(value => value.fixedPath && value.hasBearer && value.noCookie && value.noReferer), 'Every browser ticket read uses private fixed-path bearer transport');
    assert.deepEqual(report.runtimeErrors, []); assert.deepEqual(report.serverErrors, []);
  });
  report.passed = true;
})().catch(async error => {
  process.exitCode = 1; console.error(safe(error.stack));
  report.failure = { step: report.activeStep, stage: report.currentStage };
  if (activePage) { try { report.failure.path = safe(new URL(activePage.url()).pathname); await bounded(activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, style: screenshotPrivacyStyle, animations: 'disabled' }), 10000, 'Failure screenshot'); } catch (failure) { report.failure.screenshotError = safe(failure.message).slice(0, 300); } }
}).finally(async () => {
  checkpoint();
  if (browser) await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(check => check.status !== 'passed').map(check => check.id) }));
});
