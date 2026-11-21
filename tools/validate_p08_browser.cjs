/* P08 physician journeys and real HTTP races on an isolated synthetic database. */
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
const output = path.join(root, 'results/p08-browser-ci');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'fixture.json')));
assert.equal(fixture.synthetic_only, true);
const seed = JSON.parse(fs.readFileSync(path.join(root, 'application/database/fixtures/foundation_demo.json')));
const oldSession = seed.tables.clinic_sessions.find(s => s.id === fixture.old_session_id);
const oldDay = new Date(Date.parse(oldSession.starts_at) + 3 * 3600000).toISOString().slice(0, 10);
const report = { schemaVersion: 1, phase: 'P08', passed: false, scope: 'real_Laravel_PostgreSQL_browser_and_distinct_authenticated_doctor_reception_HTTP_races', checks: [], screenshots: [], runtimeErrors: [], serverErrors: [], layoutCases: [], apiResponsesMocked: false, syntheticOnly: true, physicalPhoneTested: false, textResizePercent: 200 };
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
function card(p, id) { return p.locator('article.doctor-visit[data-visit-id="' + id + '"]'); }
async function openDetails(details) {
  if (!await details.evaluate(e => e.open)) await details.locator(':scope > summary').click();
}
async function uiVisit(p, id, action, label, reason, expected = 200) {
  activePage = p;
  const c = card(p, id);
  if (reason) {
    await openDetails(c.locator('details.doctor-visit-actions'));
    await c.getByLabel('سبب ' + label, { exact: true }).selectOption(reason);
  }
  const route = '/v1/visits/' + id + '/' + action;
  const [response] = await Promise.all([
    p.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === 'POST'),
    c.getByRole('button', { name: label, exact: true }).click(),
  ]);
  assert.equal(response.status(), expected); const result = await response.json();
  if (expected === 200) {
    if (['complete', 'mark-away', 'leave'].includes(action)) await p.locator('.doctor-active').locator('article[data-visit-id="' + id + '"]').waitFor({ state: 'detached' });
    else await p.locator('article.doctor-visit[data-visit-id="' + id + '"][data-visit-version="' + result.version + '"]').waitFor();
  } else await p.getByRole('alert').waitFor();
  return result;
}
async function lostAndReplay(p, endpoint, trigger, refreshLabel, afterRefresh, successText) {
  activePage = p;
  const route = '**' + endpoint;
  let committed, original;
  await p.route(route, async r => {
    original = { url: r.request().url(), data: r.request().postDataJSON(), key: r.request().headers()['idempotency-key'], version: r.request().headers()['if-match'] };
    const response = await r.fetch(); assert.equal(response.status(), 200);
    committed = await response.json(); await r.abort('failed');
  });
  await trigger();
  await p.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).waitFor();
  assert.ok(original.key); assert.ok(original.version);
  await p.unroute(route);
  const currentPath = new URL(p.url()).pathname;
  const [refresh] = await Promise.all([
    p.waitForResponse(r => new URL(r.url()).pathname === currentPath && r.request().method() === 'GET'),
    p.getByRole('button', { name: refreshLabel, exact: true }).click(),
  ]);
  assert.equal(refresh.status(), 200);
  await p.getByRole('button', { name: refreshLabel, exact: true }).waitFor();
  await p.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).waitFor();
  await afterRefresh(committed, (await refresh.json()).props);
  const [retry] = await Promise.all([
    p.waitForResponse(r => r.url() === original.url && r.request().method() === 'POST'),
    p.getByRole('button', { name: 'إعادة المحاولة نفسها', exact: true }).click(),
  ]);
  assert.equal(retry.status(), 200);
  assert.equal(retry.request().url(), original.url);
  assert.equal(retry.request().headers()['idempotency-key'], original.key);
  assert.equal(retry.request().headers()['if-match'], original.version);
  assert.deepEqual(retry.request().postDataJSON(), original.data);
  const result = await retry.json();
  assert.deepEqual(result, { ...committed, replayed: true });
  await p.getByRole('status').filter({ hasText: successText }).waitFor();
  return { result, original };
}
async function captureLayout(p, name) {
  activePage = p;
  await p.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const width = p.viewportSize().width;
  const metrics = await p.evaluate(width => {
    const splitActionWords = [];
    for (const button of document.querySelectorAll('.doctor-workspace button, .team-grid button')) {
      const bounds = button.getBoundingClientRect(); if (!bounds.width || !bounds.height) continue;
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        for (const match of node.textContent.matchAll(/[\p{L}\p{M}]{3,}/gu)) {
          const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
          const lines = [];
          for (const rect of range.getClientRects()) if (rect.width && rect.height && !lines.some(top => Math.abs(top - rect.top) <= 1)) lines.push(rect.top);
          if (lines.length > 1) splitActionWords.push({ label: button.textContent.trim(), word: match[0], lines: lines.length });
        }
      }
    }
    return {
      requestedWidth: width, actualWidth: innerWidth, rootWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      direction: getComputedStyle(document.documentElement).direction, splitActionWords,
      controlsOutside: [...document.querySelectorAll('main input, main select, main button, main article, main section, header nav')].filter(e => {
        const r = e.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > width + 1);
      }).map(e => ({ tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || '').slice(0, 80) })),
    };
  }, width);
  const filename = name + '.png';
  await p.screenshot({ path: path.join(output, filename), fullPage: true });
  metrics.screenshotWidth = fs.readFileSync(path.join(output, filename)).readUInt32BE(16);
  report.screenshots.push(filename); report.layoutCases.push({ name, ...metrics });
  assert.equal(metrics.direction, 'rtl');
  for (const key of ['actualWidth', 'rootWidth', 'bodyWidth', 'screenshotWidth']) assert.ok(Math.abs(metrics[key] - width) <= 1, JSON.stringify(metrics));
  assert.deepEqual(metrics.controlsOutside, []);
  assert.deepEqual(metrics.splitActionWords, [], 'Action words must remain whole at this text size.');
}
(async () => {
  browser = await chromium.launch({ headless: true });
  const opts = { locale: 'ar-YE', timezoneId: 'Asia/Aden' };
  const owner = await pageFor(await browser.newContext({ ...opts, viewport: { width: 1440, height: 1000 } }));
  const doctor = await pageFor(await browser.newContext({ ...opts, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }));
  const reception = await pageFor(await browser.newContext({ ...opts, viewport: { width: 768, height: 900 } }));
  const other = await pageFor(await browser.newContext(opts));
  let sid, wid, entries = [], firstActive, delegatedCall;
  const query = (session = sid, date = day, state = 'waiting') => '?date=' + date + '&session_id=' + session + '&state=' + state;
  const url = (session = sid, date = day, state = 'waiting') => base + '/workspace/doctor' + query(session, date, state);
  const data = (p = doctor, session = sid, date = day, state = 'waiting') => get(p, '/v1/doctor' + query(session, date, state));
  async function visit(id, session = sid, date = day, state = 'waiting') {
    const snapshot = await data(doctor, session, date, state);
    const found = snapshot.active_visit?.id === id ? snapshot.active_visit : snapshot.visits.find(v => v.id === id);
    assert.ok(found, 'Visit visible in doctor scope: ' + id); return found;
  }
  async function sessionAction(action, label, reason, expectedAvailability) {
    await openDetails(doctor.locator('.doctor-session-actions'));
    await doctor.getByLabel('سبب ' + label, { exact: true }).selectOption(reason);
    const [response] = await Promise.all([
      doctor.waitForResponse(r => new URL(r.url()).pathname === '/v1/sessions/' + sid + '/' + action && r.request().method() === 'POST'),
      doctor.getByRole('button', { name: label, exact: true }).click(),
    ]);
    assert.equal(response.status(), 200);
    await doctor.locator('.doctor-session-state').getByText(expectedAvailability, { exact: true }).waitFor();
  }
  await step('D01', 'Owner MFA and independent physician, reception and other-physician sessions', async () => {
    await login(owner, 'demo_owner_a', true); await login(doctor, fixture.doctor_username);
    await login(reception, 'demo_reception_a'); await login(other, fixture.other_doctor_username);
    assert.equal(await doctor.getByRole('link', { name: 'شاشة الطبيب', exact: true }).count(), 1);
    assert.equal(await reception.getByRole('link', { name: 'شاشة الطبيب', exact: true }).count(), 0);
    assert.equal(await owner.getByRole('link', { name: 'شاشة الطبيب', exact: true }).count(), 0);
  });
  await step('D02', 'Create current physician session and six real arrived visits without fixture mutation', async () => {
    const created = await post(owner, '/workspace/sessions', { doctor_id: fixture.doctor_id, starts_at: day + 'T00:00', ends_at: day + 'T23:59', windows: [{ starts_at: day + 'T00:00', ends_at: day + 'T23:59', capacity: 30 }] });
    assert.equal(created.status, 201); sid = created.body.data.id; wid = created.body.data.windows[0].id;
    assert.equal((await post(owner, '/v1/sessions/' + sid + '/open', { reason_code: 'scheduled_start' }, 1)).status, 200);
    for (let ticket = 1; ticket <= 6; ticket++) {
      const createdVisit = await post(reception, '/v1/sessions/' + sid + '/walk-ins', { window_id: wid, display_name: 'زيارة الطبيب التجريبية ' + ticket, contact_phone: null });
      assert.equal(createdVisit.status, 201); assert.equal(createdVisit.body.ticket_number, ticket); entries.push(createdVisit.body);
    }
    await doctor.goto(url()); await doctor.getByRole('heading', { level: 1, name: 'شاشة الطبيب' }).waitFor();
    assert.equal((await data()).visits.length, 6);
  });
  await step('T08B', 'Uncalled start and completion fail; owner, undelegated reception and unrelated doctor cannot practice', async () => {
    assert.equal((await post(doctor, '/v1/visits/' + entries[0].id + '/start', {}, 1)).status, 409);
    assert.equal((await post(doctor, '/v1/visits/' + entries[0].id + '/complete', {}, 1)).status, 409);
    assert.equal((await post(owner, '/v1/visits/' + entries[0].id + '/priority', { reason_code: 'clinical_priority' }, 1)).status, 403);
    assert.equal((await post(reception, '/v1/visits/' + entries[0].id + '/start', {}, 1)).status, 403);
    assert.equal((await owner.request.get(base + '/v1/doctor', { headers: { Accept: 'application/json' } })).status(), 403);
    assert.equal((await reception.request.get(base + '/v1/doctor', { headers: { Accept: 'application/json' } })).status(), 403);
    assert.equal((await other.request.get(base + '/v1/doctor' + query(), { headers: { Accept: 'application/json' } })).status(), 404);
    assert.equal((await post(doctor, '/v1/sessions/' + fixture.other_clinic_session_id + '/call-next', {}, 1)).status, 404);
    assert.equal((await post(doctor, '/v1/visits/' + fixture.other_clinic_visit_id + '/start', {}, 1)).status, 404);
    assert.equal((await post(doctor, '/v1/visits/' + entries[0].id + '/priority', { reason_code: 'clinical_priority' }, 1, undefined, false)).status, 419);
    const snapshot = await data(); assert.equal(snapshot.permissions.can_practice, true);
    assert.ok(snapshot.visits.every(v => !Object.hasOwn(v, 'contact_phone')));
  });
  await step('D04', 'Owner grants explicit call-next-only permission through the Team UI', async () => {
    await owner.goto(base + '/workspace/team');
    const member = owner.locator('[data-membership-id="' + fixture.reception_membership_id + '"]');
    const [response] = await Promise.all([
      owner.waitForResponse(r => new URL(r.url()).pathname.endsWith('/delegation') && r.request().method() === 'POST'),
      member.getByRole('button', { name: 'تفويض استدعاء التالي فقط', exact: true }).click(),
    ]);
    assert.equal(response.status(), 200); assert.equal((await response.json()).call_next, true);
    await member.getByText('تفويض استدعاء التالي مفعّل', { exact: true }).waitFor();
    await reception.goto(url());
    const snapshot = await data(reception);
    assert.equal(snapshot.permissions.can_practice, false); assert.equal(snapshot.permissions.delegated_call_next, true);
    assert.ok(snapshot.visits.every(v => Object.keys(v.actions).length === 0));
    assert.equal(await reception.getByRole('button', { name: 'اعتماد أولوية طبية', exact: true }).count(), 0);
  });
  await step('T08A', 'Doctor and delegated receptionist race in one session and select one active visit', async () => {
    const before = await data(); const key = crypto.randomUUID(); const sent = [];
    const results = await Promise.all([doctor, reception].map(async p => {
      sent.push(performance.now()); return post(p, '/v1/sessions/' + sid + '/call-next', {}, before.selected_session.version, key);
    }));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const winner = results.find(r => r.status === 200).body; assert.equal(winner.id, entries[0].id);
    const current = await data(); firstActive = current.active_visit;
    assert.equal(firstActive.id, entries[0].id); assert.equal(firstActive.state, 'called');
    assert.equal((await data(doctor, sid, day, 'called')).visits.length, 1);
    report.sameSessionRace = { distinctActors: true, actorRoles: ['doctor', 'delegated_reception'], startDeltaMilliseconds: Math.abs(sent[1] - sent[0]), statuses: results.map(r => r.status), oneActiveVisit: true };
    await doctor.goto(url()); await card(doctor, firstActive.id).getByRole('button', { name: 'بدء الكشف', exact: true }).waitFor();
  });
  await step('D06', 'Fixed-reason priority and repeated decisions preserve tickets and never replace the active visit', async () => {
    await uiVisit(doctor, entries[1].id, 'priority', 'اعتماد أولوية طبية', 'clinical_priority');
    await uiVisit(doctor, entries[2].id, 'priority', 'اعتماد أولوية طبية', 'clinical_priority');
    await uiVisit(doctor, entries[1].id, 'priority', 'اعتماد أولوية طبية', 'clinical_priority');
    const current = await data();
    assert.deepEqual(current.visits.slice(0, 2).map(v => v.id), [entries[2].id, entries[1].id]);
    assert.deepEqual(current.visits.slice(0, 2).map(v => v.ticket_number), [3, 2]);
    assert.equal(current.active_visit.id, firstActive.id);
    assert.equal(current.visits[0].waiting_position, 1);
  });
  await step('D07', 'Physician records delay and pauses new calls while the called visit remains actionable', async () => {
    await sessionAction('pause', 'إيقاف الاستدعاء مؤقتًا', 'doctor_delayed', 'متأخر · الجلسة متوقفة مؤقتًا');
    const current = await data(); assert.equal(current.selected_session.availability, 'delayed');
    assert.equal(current.selected_session.actions.call_next, undefined); assert.ok(current.active_visit.actions.start);
    assert.equal((await post(doctor, '/v1/sessions/' + sid + '/call-next', {}, current.selected_session.version)).status, 409);
  });
  await step('D08', 'Physician and delegation controls fit RTL widths at normal and 200 percent text', async () => {
    for (const width of [360, 768, 1440]) {
      for (const scale of [100, 200]) {
        await doctor.setViewportSize({ width, height: 900 });
        await doctor.goto(url()); await card(doctor, firstActive.id).waitFor();
        await openDetails(doctor.locator('.doctor-session-actions'));
        await openDetails(card(doctor, firstActive.id).locator('.doctor-visit-actions'));
        await openDetails(card(doctor, entries[2].id).locator('.doctor-visit-actions'));
        await doctor.evaluate(scale => { document.documentElement.style.fontSize = scale + '%'; }, scale);
        await captureLayout(doctor, 'doctor-' + width + '-text' + scale);
        await doctor.goto(url(sid, day, 'completed'));
        await doctor.getByRole('heading', { name: 'لا توجد زيارات مطابقة', exact: true }).waitFor();
        await doctor.evaluate(scale => { document.documentElement.style.fontSize = scale + '%'; }, scale);
        await captureLayout(doctor, 'doctor-empty-' + width + '-text' + scale);
      }
    }
    for (const scale of [100, 200]) {
      await owner.setViewportSize({ width: 360, height: 900 }); await owner.goto(base + '/workspace/team');
      await owner.getByRole('heading', { name: 'فريق العيادة', exact: true }).waitFor();
      await owner.evaluate(scale => { document.documentElement.style.fontSize = scale + '%'; }, scale);
      await captureLayout(owner, 'delegation-360-text' + scale);
    }
  });
  await step('D09', 'Keyboard opens action controls and offline state prevents unconfirmed commands', async () => {
    await doctor.setViewportSize({ width: 360, height: 800 }); await doctor.goto(url());
    const details = card(doctor, firstActive.id).locator('.doctor-visit-actions');
    await details.locator(':scope > summary').focus(); await doctor.keyboard.press('Enter');
    assert.equal(await details.evaluate(e => e.open), true);
    await doctor.context().setOffline(true);
    await doctor.getByRole('status').filter({ hasText: 'الاتصال منقطع' }).waitFor();
    assert.equal(await card(doctor, firstActive.id).getByRole('button', { name: 'بدء الكشف', exact: true }).isDisabled(), true);
    assert.equal(await doctor.getByRole('button', { name: 'تحديث قائمة الطبيب', exact: true }).isDisabled(), true);
    await doctor.context().setOffline(false);
    await doctor.getByRole('status').filter({ hasText: 'الاتصال منقطع' }).waitFor({ state: 'detached' });
  });
  await step('D10', 'Paused visit starts and lost completion survives refresh with one fulfillment and one completion event', async () => {
    await uiVisit(doctor, firstActive.id, 'start', 'بدء الكشف');
    const started = await visit(firstActive.id);
    const completed = await lostAndReplay(doctor, '/v1/visits/' + firstActive.id + '/complete',
      () => card(doctor, firstActive.id).getByRole('button', { name: 'إنهاء الزيارة', exact: true }).click(),
      'تحديث قائمة الطبيب', async (committed, refreshed) => {
        assert.equal(refreshed.active_visit, null);
        assert.equal(await doctor.locator('.doctor-active article').count(), 0);
        assert.equal(committed.booking_state, 'fulfilled');
        assert.equal(await doctor.getByRole('button', { name: 'عرض جلسة الطبيب', exact: true }).isDisabled(), true);
      }, 'تم تأكيد الإجراء');
    const saved = await visit(firstActive.id, sid, day, 'completed');
    assert.equal(saved.state, 'completed'); assert.equal(saved.booking_state, 'fulfilled');
    assert.equal(saved.booking_version, started.booking_version + 1); assert.equal(saved.ticket_number, firstActive.ticket_number);
    assert.ok(saved.called_at && saved.started_at && saved.completed_at);
    assert.ok(Date.parse(saved.called_at) <= Date.parse(saved.started_at) && Date.parse(saved.started_at) <= Date.parse(saved.completed_at));
    assert.equal(saved.events.filter(e => e.event_type === 'visit_complete').length, 1);
    assert.equal((await post(owner, '/v1/bookings/' + saved.booking_id + '/cancel', { reason_code: 'patient_request' }, saved.booking_version)).status, 409);
    report.completionRetry = { sameUrlDataVersionAndKey: true, activeRowDisappearedBeforeReplay: true, replayed: completed.result.replayed, completionEvents: 1, bookingVersionIncrements: 1, fulfilled: true };
  });
  await step('D11', 'Delegated lost call response keeps immutable replay after refresh and exposes no clinical actions', async () => {
    await sessionAction('resume', 'استئناف الاستدعاء', 'service_resumed', 'متاح للاستدعاء');
    await reception.goto(url());
    delegatedCall = await lostAndReplay(reception, '/v1/sessions/' + sid + '/call-next',
      () => reception.getByRole('button', { name: 'استدعاء التالي', exact: true }).click(),
      'تحديث قائمة الطبيب', async (committed, refreshed) => {
        assert.equal(refreshed.active_visit.id, committed.id); assert.equal(committed.id, entries[2].id);
        assert.equal(refreshed.selected_session.actions.call_next, undefined);
        assert.equal(await reception.getByRole('button', { name: 'بدء الكشف', exact: true }).count(), 0);
        assert.equal(await reception.getByRole('button', { name: 'إنهاء الزيارة', exact: true }).count(), 0);
        assert.equal(await reception.getByRole('button', { name: 'اعتماد أولوية طبية', exact: true }).count(), 0);
      }, 'تم تأكيد الإجراء');
    const called = await visit(entries[2].id);
    assert.equal(called.events.filter(e => e.event_type === 'visit_call_next').length, 1);
    assert.equal((await post(reception, '/v1/visits/' + called.id + '/start', {}, called.version)).status, 403);
    assert.equal((await post(reception, '/v1/visits/' + called.id + '/complete', {}, called.version)).status, 403);
    assert.equal((await post(reception, '/v1/visits/' + entries[3].id + '/priority', { reason_code: 'clinical_priority' }, 1)).status, 403);
    report.callRetry = { sameUrlDataVersionAndKey: true, activeRowAppearedBeforeReplay: true, replayed: true, callEvents: 1, delegatedClinicalActionsAbsent: true };
  });
  await step('D12', 'Doctor records absence after calling and releases the active slot without changing the ticket', async () => {
    await doctor.goto(url());
    const away = await uiVisit(doctor, entries[2].id, 'mark-away', 'تسجيل غياب مؤقت', 'not_present');
    assert.equal(away.state, 'away'); assert.equal(away.ticket_number, 3);
    assert.equal((await data()).active_visit, null);
    const saved = await visit(entries[2].id, sid, day, 'away');
    assert.ok(saved.events.some(e => e.event_type === 'visit_mark_away' && e.reason_code === 'not_present'));
  });
  await step('D13', 'Cross-session real race permits one active visit and shows it in another selected session', async () => {
    const current = await data(), previous = await data(doctor, fixture.old_session_id, oldDay);
    assert.equal(previous.selected_session.intake_ended, true);
    const sent = [];
    const results = await Promise.all([
      (async () => { sent.push(performance.now()); return post(doctor, '/v1/sessions/' + fixture.old_session_id + '/call-next', {}, previous.selected_session.version); })(),
      (async () => { sent.push(performance.now()); return post(reception, '/v1/sessions/' + sid + '/call-next', {}, current.selected_session.version); })(),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const winner = results.find(r => r.status === 200).body;
    const currentAfter = await data(), oldAfter = await data(doctor, fixture.old_session_id, oldDay);
    assert.equal(currentAfter.active_visit.id, winner.id); assert.equal(oldAfter.active_visit.id, winner.id);
    assert.equal((await data(doctor, sid, day, 'called')).visits.length + (await data(doctor, fixture.old_session_id, oldDay, 'called')).visits.length, 1);
    const selectedOther = winner.session_id === sid ? fixture.old_session_id : sid;
    await doctor.goto(url(selectedOther, selectedOther === sid ? day : oldDay));
    await doctor.getByText('الزيارة الحالية من جلسة أخرى للطبيب نفسه.', { exact: false }).waitFor();
    assert.equal(await doctor.getByRole('button', { name: 'استدعاء التالي', exact: true }).count(), 0);
    if (winner.session_id === fixture.old_session_id) {
      await doctor.goto(base + '/workspace/doctor?date=' + day);
      assert.equal(await doctor.getByLabel('جلسة الطبيب', { exact: true }).inputValue(), fixture.old_session_id);
    }
    await uiVisit(doctor, winner.id, 'start', 'بدء الكشف');
    await uiVisit(doctor, winner.id, 'complete', 'إنهاء الزيارة');
    if (winner.session_id !== fixture.old_session_id) {
      const oldReady = await data(doctor, fixture.old_session_id, oldDay);
      const called = await post(doctor, '/v1/sessions/' + fixture.old_session_id + '/call-next', {}, oldReady.selected_session.version);
      assert.equal(called.status, 200); assert.equal(called.body.id, fixture.old_visit_id);
      await doctor.goto(base + '/workspace/doctor?date=' + day);
      assert.equal(await doctor.getByLabel('جلسة الطبيب', { exact: true }).inputValue(), fixture.old_session_id);
      await uiVisit(doctor, fixture.old_visit_id, 'start', 'بدء الكشف');
      await uiVisit(doctor, fixture.old_visit_id, 'complete', 'إنهاء الزيارة');
    }
    await doctor.waitForFunction(id => document.getElementById('doctor-session')?.value === id, sid);
    assert.equal((await visit(fixture.old_visit_id, fixture.old_session_id, oldDay, 'completed')).booking_state, 'fulfilled');
    report.crossSessionRace = { distinctActors: true, startDeltaMilliseconds: Math.abs(sent[1] - sent[0]), statuses: results.map(r => r.status), oneActiveAcrossSessions: true, activeShownInOtherSession: true, pastIntakeCompleted: true, defaultSelectionRefreshed: true };
  });
  await step('D14', 'Stale browser command fails clearly and refresh reveals the existing recorded change', async () => {
    await doctor.goto(url());
    const before = await visit(entries[3].id);
    const changed = await post(doctor, '/v1/visits/' + before.id + '/priority', { reason_code: 'clinical_priority' }, before.version);
    assert.equal(changed.status, 200);
    await uiVisit(doctor, before.id, 'priority', 'اعتماد أولوية طبية', 'clinical_priority', 409);
    const saved = await visit(before.id);
    assert.equal(saved.version, changed.body.version); assert.equal(saved.events.filter(e => e.event_type === 'visit_priority').length, 1);
    await doctor.getByRole('button', { name: 'تحديث قائمة الطبيب', exact: true }).click();
    await doctor.locator('article.doctor-visit[data-visit-id="' + before.id + '"][data-visit-version="' + saved.version + '"]').waitFor();
    await card(doctor, before.id).getByText('أولوية طبية مسجلة', { exact: true }).waitFor();
  });
  await step('D15', 'Correction is audit-only before and after closing; completed visits cannot be cancelled', async () => {
    await doctor.goto(url(sid, day, 'completed'));
    const before = await visit(firstActive.id, sid, day, 'completed');
    await uiVisit(doctor, before.id, 'correct', 'تسجيل تصحيح في السجل', 'administrative_correction');
    for (const state of ['waiting', 'away']) {
      const unresolved = await data(doctor, sid, day, state);
      for (const row of unresolved.visits) assert.equal((await post(reception, '/v1/visits/' + row.id + '/leave', { reason_code: 'patient_left' }, row.version)).status, 200);
    }
    const ready = await data();
    assert.equal((await post(owner, '/v1/sessions/' + sid + '/close', { reason_code: 'session_completed' }, ready.selected_session.version)).status, 200);
    await doctor.goto(url(sid, day, 'completed'));
    await doctor.locator('.doctor-session-state').getByText('الجلسة مغلقة', { exact: true }).waitFor();
    await uiVisit(doctor, before.id, 'correct', 'تسجيل تصحيح في السجل', 'entered_in_error');
    const after = await visit(before.id, sid, day, 'completed');
    for (const key of ['state', 'booking_state', 'booking_version', 'called_at', 'started_at', 'completed_at', 'ticket_number']) assert.equal(after[key], before[key], key);
    assert.equal(after.version, before.version + 2); assert.equal(after.events.filter(e => e.event_type === 'visit_correct').length, 2);
    assert.equal((await post(owner, '/v1/bookings/' + after.booking_id + '/cancel', { reason_code: 'entered_in_error' }, after.booking_version)).status, 409);
    report.correction = { fixedReasonsOnly: true, stateAndTimesUnchanged: true, afterClosedSession: true, events: 2, completedCancellationRejected: true };
  });
  await step('D16', 'Owner revokes delegation with replay after lost response; existing reception session loses call and replay rights', async () => {
    await owner.goto(base + '/workspace/team');
    const member = owner.locator('[data-membership-id="' + fixture.reception_membership_id + '"]');
    const revocation = await lostAndReplay(owner, '/workspace/team/' + fixture.reception_membership_id + '/delegation',
      () => member.getByRole('button', { name: 'إلغاء تفويض استدعاء التالي', exact: true }).click(),
      'تحديث صلاحيات الفريق', async (committed, refreshed) => {
        const current = refreshed.members.find(m => m.id === fixture.reception_membership_id);
        assert.equal(current.call_next, false); assert.equal(current.delegation_version, committed.delegation_version);
        assert.equal(await member.getByRole('button', { name: 'تفويض استدعاء التالي فقط', exact: true }).isDisabled(), true);
      }, 'تم إلغاء تفويض استدعاء التالي');
    const request = delegatedCall.original;
    assert.equal((await post(reception, new URL(request.url).pathname, request.data, Number(request.version.replaceAll('"', '')), request.key)).status, 403);
    assert.equal((await reception.request.get(base + '/v1/doctor', { headers: { Accept: 'application/json' } })).status(), 403);
    assert.equal((await reception.request.get(base + '/v1/reception?date=' + day, { headers: { Accept: 'application/json' } })).status(), 200);
    await reception.goto(base + '/workspace');
    assert.equal(await reception.getByRole('link', { name: 'شاشة الطبيب', exact: true }).count(), 0);
    report.delegation = { ownerUiGrantAndRevoke: true, revokeReplay: revocation.result.replayed, currentSessionRetained: true, revokedPriorCallReplayRejected: true, clinicalRightsNeverGranted: true };
  });
  await step('D17', 'No unexpected JavaScript or server errors', async () => {
    assert.deepEqual(report.runtimeErrors, []); assert.deepEqual(report.serverErrors, []);
  });
  report.passed = true;
})().catch(async e => {
  process.exitCode = 1; console.error(String(e.stack));
  if (activePage) { try { report.failure = { path: new URL(activePage.url()).pathname, body: (await activePage.locator('body').innerText()).slice(0, 2000) }; await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); } catch {} }
}).finally(async () => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (browser) await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(c => c.status !== 'passed').map(c => c.id) }));
});
