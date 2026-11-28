'use strict';

const previewServer = JSON.parse(document.querySelector('meta[name="nobteek-connected-preview"]')?.content ?? 'null');
const livePhoneKey = 'nobteek-live-phone';
const liveAttemptsKey = 'nobteek-live-attempt';
const liveTicketsKey = 'nobteek-live-tickets';
let liveCatalog = null;
let catalogInFlight = false;
let catalogError = false;
let ticketsInFlight = false;
let bookingInFlight = false;
let catalogFetchedAt = 0;

function readLiveSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

function writeLiveSession(key, value) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

function confirmedPreviewOccupancy(row, counts) {
  return previewServer ? row.occupied : (counts.get(row.id) ?? 0);
}

function renderConnectedLoading() {
  pageHeading.innerHTML = '<h1 tabindex="-1">دليل العيادات التجريبي</h1>';
  notice.hidden = true;
  backButton.hidden = true;
  notificationsLink.hidden = true;
  navigation.hidden = true;
  screen.innerHTML = card(catalogError ? 'تعذّر الاتصال بالخادم' : 'تحميل العيادات',
    catalogError ? button('إعادة المحاولة', 'connected-catalog') : '<p role="status">جارٍ تحميل المواعيد.</p>');
}

async function loadConnectedCatalog() {
  if (!previewServer || catalogInFlight) return;
  catalogInFlight = true;
  try {
    const response = await fetch(previewServer.catalog, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('catalog unavailable');
    const data = await response.json();
    if (!data.clinics || !Object.keys(data.clinics).length || !Array.isArray(data.windows)) throw new Error('invalid catalog');
    const firstLoad = liveCatalog === null;
    liveCatalog = data.clinics;
    const previous = new Map(state.sessions.map(row => [row.id, row]));
    for (const row of data.windows) previous.set(row.id, row);
    const included = new Set(data.windows.map(row => row.id));
    const interrupted = readLiveSession(liveAttemptsKey);
    const held = new Set(state.bookings.map(row => row.sessionId));
    if (interrupted) held.add(interrupted.windowId);
    state.sessions = [...previous.values()].filter(row => included.has(row.id) || held.has(row.id))
      .map(row => included.has(row.id) ? row : { ...row, open: false });
    catalogError = false;
    catalogFetchedAt = now();
    save();
    if (firstLoad || ['directory', 'clinic', 'practitioner', 'slots'].includes(role)) renderRoute('', false);
  } catch {
    catalogError = true;
    if (liveCatalog === null) renderConnectedLoading();
  } finally {
    catalogInFlight = false;
  }
}

const liveStateLabels = {
  pending: 'pending', confirmed: 'confirmed', rejected: 'denied', cancelled: 'cancelled', fulfilled: 'completed',
};
const liveVisitLabels = {
  waiting: 'waiting', called: 'called', in_service: 'in_service', completed: 'completed', away: 'away', left: 'left',
};

function refreshConnectedDirectory() {
  if (!previewServer || !['directory', 'clinic', 'practitioner', 'slots'].includes(role)) return;
  if (now() - catalogFetchedAt > 12000) void loadConnectedCatalog();
}

function connectedRetry(patient, appointmentId) {
  if (!previewServer || !patient) return null;
  const attempt = readLiveSession(liveAttemptsKey);
  return attempt?.patientId === patient.id && attempt.windowId === appointmentId ? attempt : null;
}

function isConnectedTicketPage() {
  return role === 'patient' && ['history', 'follow', 'detail'].includes(currentTab);
}

let ticketNotice = '';

async function updateConnectedTickets() {
  if (!previewServer || ticketsInFlight || !isConnectedTicketPage()) return;
  const ownTickets = readLiveSession(liveTicketsKey) ?? {};
  const rows = state.bookings.filter(row => canViewBooking(row) && ownTickets[row.id] && !inactiveBooking(row));
  if (!rows.length) return;
  ticketsInFlight = true;
  const patientId = activePatientId;
  let connectionLost = false;
  try {
    const snapshot = await Promise.all(rows.map(async row => {
      try {
        const response = await fetch(previewServer.ticket, {
          credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + ownTickets[row.id] },
        });
        if (!response.ok) throw new Error('ticket unavailable');
        const ticket = await response.json();
        const status = liveVisitLabels[ticket.visit_state] ?? liveStateLabels[ticket.booking_state];
        if (!status) throw new Error('invalid ticket state');
        return { row, status, ticket };
      } catch {
        connectionLost = true;
        return null;
      }
    }));
    if (patientId !== activePatientId) return;
    let changed = false;
    for (const result of snapshot) {
      if (!result) continue;
      const { row, ticket, status } = result;
      const fields = {
        status, ticket: ticket.ticket_number, waitingAhead: ticket.waiting_ahead, serverUpdatedAt: ticket.server_time,
      };
      if (Object.entries(fields).some(([key, value]) => row[key] !== value)) {
        Object.assign(row, fields);
        changed = true;
      }
    }
    if (changed) save();
    const nextNotice = connectionLost ? 'تعذّر تحديث حالة الحجز. يظهر آخر تحديث محفوظ.' : '';
    if (changed || nextNotice !== ticketNotice) {
      ticketNotice = nextNotice;
      if (isConnectedTicketPage()) render();
    }
  } finally {
    ticketsInFlight = false;
  }
}

function connectedTicketControl(row) {
  if (!previewServer || !row) return '';
  const date = row.serverUpdatedAt ? previewConnectedClock.format(new Date(row.serverUpdatedAt)) : '';
  const position = row.status === 'waiting' && Number.isInteger(row.waitingAhead)
    ? '<p>عدد المنتظرين قبلك <bdi>' + row.waitingAhead + '</bdi></p>' : '';
  return card('تحديث الحالة', position
    + (date ? '<p class="meta">آخر تحديث · ' + html(date) + '</p>' : '')
    + (ticketNotice ? '<p role="status">' + html(ticketNotice) + '</p>' : '')
    + button('تحديث حالة الحجز', 'connected-ticket', '', 'secondary'));
}

const previewConnectedClock = new Intl.DateTimeFormat('ar-YE', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Aden',
});

async function sendConnectedBooking(form, patient, schedule, name) {
  if (bookingInFlight) return;
  const identity = readLiveSession(livePhoneKey);
  if (identity?.id !== patient.id) return feedback('تحقّق من الهاتف التجريبي مجددًا قبل الإرسال.', true);
  const data = {
    session_id: schedule.serverSession, window_id: schedule.id,
    display_name: name, contact_phone: identity.phone,
  };
  const fingerprint = JSON.stringify(data);
  let attempt = readLiveSession(liveAttemptsKey);
  if (attempt && (attempt.fingerprint !== fingerprint || attempt.patientId !== patient.id || attempt.scope !== previewServer.scope)) {
    return feedback('توجد محاولة سابقة بلا نتيجة مؤكدة. أعد إرسال الطلب نفسه من الجلسة الأصلية.', true);
  }
  attempt ??= {
    fingerprint, key: crypto.randomUUID(), patientId: patient.id, scope: previewServer.scope,
    windowId: schedule.id, name,
  };
  if (!writeLiveSession(liveAttemptsKey, attempt)) return feedback('تعذّر حفظ مرجع المحاولة على هذا الجهاز.', true);
  const submit = form.querySelector('button[type="submit"], button');
  submit.disabled = true;
  bookingInFlight = true;
  feedback('');
  try {
    const response = await fetch(previewServer.booking, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000),
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        'X-CSRF-TOKEN': previewServer.csrf, 'Idempotency-Key': attempt.key,
      },
      body: fingerprint,
    });
    if (response.status >= 500 || response.status === 419) throw new Error('uncertain booking');
    const result = await response.json();
    if (!response.ok) {
      writeLiveSession(liveAttemptsKey, null);
      if (form.isConnected) feedback(Object.values(result.errors ?? {}).flat().join(' · ') || result.message || 'تعذّر إرسال الطلب.', true);
      if (response.status === 409) void loadConnectedCatalog();
      return;
    }
    const link = new URL(result.ticket_url, location.origin);
    const secret = link.hash.slice(1);
    if (link.origin !== location.origin || !/^[a-f0-9]{64}$/.test(secret) || !/^[a-f0-9-]{36}$/.test(result.id)
      || result.window_id !== schedule.id) throw new Error('invalid receipt');
    const tickets = readLiveSession(liveTicketsKey) ?? {};
    if (!writeLiveSession(liveTicketsKey, { ...tickets, [result.id]: secret })) throw new Error('unable to retain ticket');
    const booking = state.bookings.find(row => row.id === result.id) ?? {
      id: result.id, name, clinic: schedule.clinic, sessionId: schedule.id, patientId: patient.id,
      status: 'pending', ticket: null, createdAt: now(), serverUpdatedAt: result.server_time,
    };
    const isNew = !state.bookings.includes(booking);
    const oldName = patient.displayName;
    if (!oldName) patient.displayName = name;
    if (isNew) state.bookings.push(booking);
    if (!save()) {
      if (isNew) state.bookings.pop();
      patient.displayName = oldName;
      throw new Error('unable to retain booking');
    }
    writeLiveSession(liveAttemptsKey, null);
    if (form.isConnected) navigate(patientBookingHash('follow', booking), 'حُفظ الطلب على الخادم التجريبي.');
  } catch {
    if (form.isConnected) feedback('تعذّر تأكيد الحفظ. أعد إرسال الطلب نفسه عند عودة الاتصال.', true);
  } finally {
    bookingInFlight = false;
    submit.disabled = false;
  }
}

function startConnectedPreview() {
  if (!previewServer) return;
  void loadConnectedCatalog();
  window.addEventListener('online', () => {
    void loadConnectedCatalog();
    void updateConnectedTickets();
  });
  window.setInterval(() => {
    if (!document.hidden) void updateConnectedTickets();
  }, 20000);
}
