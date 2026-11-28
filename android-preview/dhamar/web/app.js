'use strict';

const referenceClinics = {
  queen: { name: 'مركز الملكة لطب وجراحة الفم والأسنان', specialty: 'dentistry', area: 'محافظة ذمار', doctors: ['طبيب تجريبي ١', 'طبيب تجريبي ٢'] },
  salamati: { name: 'عيادة سلامتي لطب الأسنان', specialty: 'dentistry', area: 'محافظة ذمار', doctors: ['طبيب تجريبي ٣'] },
};
const specialties = {
  dentistry: 'طب الأسنان', general: 'الطب العام', pediatrics: 'الأطفال',
  dermatology: 'الجلدية', ophthalmology: 'العيون', orthopedics: 'العظام',
  gynecology: 'النساء والولادة', family: 'طب الأسرة', internal: 'الباطنية', neuro: 'الأعصاب',
  ent: 'الأنف والأذن والحنجرة', lab: 'المختبر', physio: 'العلاج الطبيعي', radiology: 'الأشعة', other: 'تخصص آخر',
};
const applicationStates = {
  pending: ['قيد المراجعة', 'pending'],
  revision: ['استكمال مطلوب', 'pending'],
  approved: ['أُدرجت في الدليل', 'success'],
  rejected: ['الطلب مرفوض', 'error'],
};
const workspaces = {
  patient: {
    title: 'المراجع', detail: 'احجز موعدًا وتابع حجوزاتك.',
    tabs: {
      book: ['الحجز', patientBooking],
      follow: ['متابعة الحجز', patientFollowUp],
      history: ['مواعيدي', patientHistory],
      detail: ['تفاصيل الموعد', patientAppointment],
      change: ['تغيير الموعد', patientAppointmentChange],
    },
  },
  reception: {
    title: 'الاستقبال', detail: 'راجع الطلبات وسجّل حضور المراجعين.',
    tabs: { requests: ['الطلبات', () => receive(false)], attendance: ['الحضور والدور', () => receive(true)] },
  },
  doctor: {
    title: 'الطبيب', detail: 'استدعِ المراجعين وتابع الزيارات.',
    tabs: { queue: ['الدور الحالي', () => doctorPage(false)], completed: ['الزيارات المكتملة', () => doctorPage(true)] },
  },
  owner: {
    title: 'مالك العيادة', detail: 'تابع اليوم والدوام والفريق والاشتراك.',
    tabs: { today: ['اليوم', ownerToday], schedules: ['الدوام', ownerSchedules], team: ['الفريق', ownerTeam], subscription: ['الاشتراك', ownerSubscription] },
  },
  admin: {
    title: 'مدير المنصة', detail: 'راجع المنشآت وعضويات الفريق والمعاملات.',
    tabs: {
      overview: ['لوحة المنصة', platformHome],
      clinics: ['مراجعة المنشآت', () => clinicApplications(true)],
      roles: ['الأعضاء والأدوار', platformRolesPage],
      finance: ['المالية', platformFinance],
      'jobs-review': ['إشراف الوظائف', jobModeration],
    },
  },
  support: {
    title: 'الدعم الفني', detail: 'راجع تذاكر الدعم وأسندها إلى الموظفين.',
    tabs: { inbox: ['صندوق الدعم', supportDesk] },
  },
  employer: {
    title: 'مسؤول التوظيف', detail: 'انشر الشواغر وراجع المرشحين والعروض.',
    tabs: {
      overview: ['مسؤول التوظيف', () => employerAccess(employerHome)],
      postings: ['إعلاناتي', () => employerAccess(employerPostings)],
      talent: ['الباحثون عن عمل', () => employerAccess(employerTalent)],
      applications: ['الطلبات والعروض', () => employerAccess(employerApplications)],
    },
  },
  operations: {
    title: 'التقارير والانقطاع', detail: 'تابع النشاط وجرّب المطابقة الورقية.',
    tabs: { reports: ['التقارير', reports], outage: ['الانقطاع', outagePage] },
  },
};
const visitLabels = {
  pending: 'قيد المراجعة', confirmed: 'حجز مؤكد', waiting: 'منتظر',
  called: 'تم الاستدعاء', in_service: 'داخل الكشف', completed: 'اكتملت الزيارة',
  denied: 'رفض الطلب', cancelled: 'أُلغي الحجز', away: 'غياب مؤقت', left: 'غادر العيادة',
};
const invoiceLabels = { issued: 'فاتورة مفتوحة', submitted: 'إثبات قيد المراجعة', paid: 'اشتراك مفعّل', rejected: 'الإثبات مرفوض', refunded: 'سُجل الاسترداد', returned: 'استكمال الإثبات مطلوب' };
const prices = {
  YER: { amount: 5000, label: 'ريال يمني قديم' },
  SAR: { amount: 35, label: 'ريال سعودي' },
  USD: { amount: 10, label: 'دولار أمريكي' },
};
const wallets = { kuraimi: 'الكريمي', jeeb: 'جيب', flousak: 'فلوسك', jawali: 'جوالي' };
const key = previewServer ? 'nobteek-dhamar-live-preview' : 'nobteek-dhamar-qa-1';
const patientSessionKey = previewServer ? key + '-patient-session' : 'nobteek-dhamar-patient-session';
const dayLength = 86400000;
const limit = 2 * 1024 * 1024;
const adenDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit' });
function dateLocal(date) {
  const { year, month, day } = Object.fromEntries(adenDate.formatToParts(date).map(part => [part.type, part.value]));
  return [year, month, day].join('-');
}
const now = () => Date.now();

function referenceSessions(date) {
  return Object.entries(referenceClinics).flatMap(([clinicId, item]) =>
    item.doctors.map((doctor, index) => ({
      id: clinicId + '-' + index + '-' + date, clinic: clinicId, doctor, date,
      start: '00:00', end: '23:59', capacity: 12, open: true, ticket: 0,
    })));
}

function seed() {
  return {
    sessions: [], bookings: [], invoices: [], events: [], outage: {}, clinicApplications: [],
    patientAccounts: [], supportTickets: [], platformMembers: seedPlatformMembers(), platformAudit: [], teamInvitations: [], clinicDraft: null, guestBookingIds: [], notificationPrefs: { bookings: true, support: true, jobs: true }, ...seedHiring(),
  };
}

let state;
try { state = JSON.parse(localStorage.getItem(key)) || seed(); } catch { state = seed(); }
state.clinicApplications ??= [];
state.patientAccounts ??= [];
state.supportTickets ??= [];
state.platformMembers ??= seedPlatformMembers();
state.platformAudit ??= [];
state.teamInvitations ??= [];
state.guestBookingIds ??= state.bookings.filter(row => !row.patientId).map(row => row.id);
state.notificationPrefs = { bookings: true, support: true, jobs: true, ...state.notificationPrefs };
for (const [field, value] of Object.entries(seedHiring())) state[field] ??= value;

function refreshPreviewSessions(date) {
  if (previewServer) return;
  const bookedSessions = new Set(state.bookings.map(booking => booking.sessionId));
  state.sessions = state.sessions.filter(row => !row.directoryFixture || row.date >= date || bookedSessions.has(row.id));
  const sessionIds = new Set(state.sessions.map(row => row.id));
  const shiftKey = row => [row.clinic, row.doctor, row.date].join('/');
  const manualShifts = new Set(state.sessions.filter(row => !row.directoryFixture).map(shiftKey));
  for (const row of [...referenceSessions(date), ...buildDiscoverySessions(date)]) {
    if (!sessionIds.has(row.id) && !manualShifts.has(shiftKey(row))) state.sessions.push(row);
  }
}

let sessionDate = dateLocal(new Date());
refreshPreviewSessions(sessionDate);

let clinic = 'queen';
let role = 'directory';
let currentTab = '';
let chosenBookingSession = '';
let currentBookingId = '';
let currentSupportId = '';
let activePatientId = null;
try { activePatientId = sessionStorage.getItem(patientSessionKey); } catch { /* Storage may be unavailable in the preview. */ }
let activeDoctor = '';
const feedbackRegion = document.querySelector('#feedback');
const pageHeading = document.querySelector('#page-heading');
const screen = document.querySelector('#screen');
const main = document.querySelector('#main');
const notice = document.querySelector('#notice');
const navigation = document.querySelector('#workspace-nav');
const notificationsLink = document.querySelector('#show-notifications');
const backButton = document.querySelector('#preview-back');
const cityLabel = document.querySelector('#preview-city');

const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const option = (value, title, active) => `<option value="${html(value)}"${active ? ' selected' : ''}>${html(title)}</option>`;
const field = (label, control) => `<label><span>${label}</span>${control}</label>`;
const button = (label, action, id = '', style = '') => `<button class="${style}" data-action="${action}" data-id="${html(id)}" type="button">${label}</button>`;
const statusMarkers = { info: 'i', pending: '◷', success: '✓', error: '×', neutral: '−' };
const visitTones = {
  pending: 'pending', confirmed: 'success', waiting: 'pending', called: 'info',
  in_service: 'info', completed: 'success', denied: 'error', cancelled: 'neutral', away: 'pending', left: 'neutral',
};
const invoiceTones = { issued: 'info', submitted: 'pending', paid: 'success', rejected: 'error', refunded: 'neutral', returned: 'pending' };
const marker = tone => `<span class="marker" aria-hidden="true">${statusMarkers[tone]}</span>`;
const pill = (label, tone) => `<span class="status ${tone}">${marker(tone)}<span>${html(label)}</span></span>`;
const empty = (title, detail) => `<div class="empty"><strong>${title}</strong><p>${detail}</p></div>`;
const card = (title, body) => `<section class="card"><h2>${title}</h2>${body}</section>`;
const routeHash = (workspace = '', tab = '', clinicId = clinic) => '#' + [clinicId, workspace, tab].filter(Boolean).join('/');
const routeLink = (label, workspace, tab, style = '') => `<a data-route class="route-link ${style}" href="${routeHash(workspace, tab)}">${label}</a>`;
const amount = currency => `${prices[currency].amount.toLocaleString('ar-YE')} ${prices[currency].label}`;
const catalog = () => liveCatalog ?? ({
  ...referenceClinics,
  ...demoDirectory,
  ...Object.fromEntries(state.clinicApplications.filter(row => row.status === 'approved').map(row => [row.id, row])),
});
const sessions = (clinicId = clinic) => state.sessions.filter(row => row.clinic === clinicId);
const bookings = () => state.bookings.filter(row => row.clinic === clinic);
const activePatient = () => state.patientAccounts.find(row => row.id === activePatientId);
const canViewBooking = (row, patient = activePatient()) => patient
  ? row.patientId === patient.id
  : !row.patientId && state.guestBookingIds.includes(row.id);
const invoices = () => state.invoices.filter(row => row.clinic === clinic);
const session = id => state.sessions.find(row => row.id === id);
const newId = prefix => prefix + '-' + now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

function save() {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    feedback('تعذّر حفظ بيانات التجربة على الجهاز.', true);
    return false;
  }
}

function feedback(text, failed = false) {
  if (!text) {
    feedbackRegion.replaceChildren();
    return;
  }
  const tone = failed ? 'error' : 'success';
  feedbackRegion.innerHTML = `<p class="feedback ${tone}">${marker(tone)}<span>${html(text)}</span></p>`;
}

function record(message, clinicId = clinic, destination = '') {
  state.events.push({ clinic: clinicId, message, at: now() });
  if (!save()) {
    state.events.pop();
    return false;
  }
  if (destination) navigate('#' + clinic + '/' + destination, message);
  else {
    render();
    feedback(message);
  }
  return true;
}

function sessionLabel(row) {
  const date = `\u2066${row.date}\u2069`;
  const hours = `\u2066${row.start}–${row.end}\u2069`;
  return `${row.doctor} · ${date} · ${hours}`;
}

function bookingInfo(row, title = row.name) {
  const schedule = session(row.sessionId);
  return `<div class="record-heading"><strong>${html(title)}</strong>${pill(visitLabels[row.status], visitTones[row.status])}</div>
    <p class="meta">${html(schedule ? sessionLabel(schedule) : '')}</p>
    <p class="meta">مرجع الحجز <bdi>${html(row.id)}</bdi></p>
    ${row.ticket ? `<p class="ticket">رقم الدور <bdi>${row.ticket}</bdi></p>` : ''}`;
}

const searchable = value => value.normalize('NFKC').replace(/[أإآٱ]/g, 'ا').replace(/[\p{M}\u0640]/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
const clinicMeta = row => `${html(specialties[row.specialty])} · ${html(row.area)}`;
const canViewClinicRequest = row => (row.requesterId ?? null) === (activePatient()?.id ?? null);
function clinicApplications(review) {
  const rows = state.clinicApplications.filter(row => review || canViewClinicRequest(row)).reverse();
  const emptyText = empty('لا توجد طلبات إضافة', 'تظهر هنا الطلبات بعد إرسالها من «أضف منشأتك» في حسابي.');
  const entries = rows.map(row => `<article class="history">
    <div class="record-heading"><strong>${html(row.name)}</strong>${pill(...applicationStates[row.status])}</div>
    <p class="meta">${clinicMeta(row)}</p>
    <p class="meta">مرجع الطلب <bdi>${html(row.id)}</bdi></p>
    ${row.branch ? `<details class="facility-request-data"><summary>بيانات الطلب</summary>${facilitySummary(row, review)}</details>` : ''}
    ${row.reason ? `<p class="meta">${row.status === 'revision' ? 'مطلوب استكمال' : 'سبب الرفض'} · ${html(row.reason)}</p>` : ''}
    ${!review && row.status === 'revision' ? button('استكمال الطلب', 'revise-clinic', row.id) : ''}
    ${review && row.status === 'pending' ? `<div class="clinic-decision">
      ${button('اعتماد ونشر في دليل التجربة', 'approve-clinic', row.id)}
      <details><summary>طلب استكمال</summary>
        <form class="clinic-review-note" data-decision="revision" data-id="${html(row.id)}">
          ${field('ملاحظة لمقدم الطلب', '<textarea name="reason" required minlength="4" maxlength="160" rows="2"></textarea>')}
          <button>حفظ طلب الاستكمال</button>
        </form>
      </details>
      <details><summary>رفض الطلب</summary>
        <form class="clinic-review-note" data-decision="rejected" data-id="${html(row.id)}">
          ${field('سبب الرفض', '<input name="reason" required minlength="4" maxlength="160">')}
          <button class="danger">تأكيد الرفض</button>
        </form>
      </details></div>` : ''}
    ${row.status === 'approved' ? `<div class="actions"><a class="route-link secondary" data-route href="${routeHash('clinic', '', row.id)}">عرض ملف العيادة</a></div>` : ''}
    </article>`).join('');
  return card(review ? 'مراجعة طلبات العيادات' : 'الطلبات المقدّمة', entries || emptyText)
    + (review ? '' : `<div class="actions">${routeLink('طلب إضافة جديد', 'apply', '', 'secondary')}</div>`);
}

function decideClinic(id, status, reason = '') {
  if (role !== 'admin' || currentTab !== 'clinics' || !['approved', 'revision', 'rejected'].includes(status)) return;
  const request = state.clinicApplications.find(row => row.id === id);
  if (request?.status !== 'pending') return feedback('هذا الطلب لم يعد قيد المراجعة.', true);
  if (status !== 'approved' && (reason.length < 4 || reason.length > 160)) {
    return feedback('اكتب ملاحظة من 4 إلى 160 حرفًا لمقدم الطلب.', true);
  }
  const messages = {
    approved: 'تم اعتماد العيادة وإدراجها في دليل التجربة.',
    revision: 'حُفظ طلب استكمال بيانات المنشأة.',
    rejected: 'تم رفض طلب الإضافة وحفظ السبب.',
  };
  return commitPreview({
    clinicApplications: replacePreviewRow(state.clinicApplications, { ...request, status, reason }),
    platformAudit: platformAudit(messages[status], id),
  }, messages[status]);
}

function setPatientSession(patientId) {
  guestSupport = null;
  if (!patientId && previewServer) {
    writeLiveSession(livePhoneKey, null);
    ticketNotice = '';
  }
  activePatientId = patientId;
  try {
    if (patientId) sessionStorage.setItem(patientSessionKey, patientId);
    else sessionStorage.removeItem(patientSessionKey);
  } catch { /* The in-memory session is still available. */ }
}

async function derivePatientPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const digest = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: Uint8Array.from(salt), iterations: 600000, hash: 'SHA-256',
  }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function patientAccessForm(creating) {
  const title = creating ? 'بيانات الحساب' : 'تسجيل الدخول';
  const otherPage = creating ? 'account' : 'register';
  const otherTitle = creating ? 'لدي حساب' : 'إنشاء حساب جديد';
  const alternate = creating ? routeLink(otherTitle, otherPage, currentTab, 'secondary') : '';
  const displayName = creating
    ? field('اسم المراجع التجريبي', '<input name="displayName" required minlength="2" maxlength="50" placeholder="مثال: مراجع تجربة">')
    : '';
  const confirmation = creating
    ? field('تأكيد كلمة المرور', '<input name="confirmPassword" type="password" required minlength="8" maxlength="64" autocomplete="new-password">')
    : '';
  const passwordOptions = creating ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"';
  return card(title, `<form id="${creating ? 'patient-register' : 'patient-login'}">
    ${displayName}
    ${field('اسم المستخدم التجريبي', '<input name="username" required maxlength="32" autocapitalize="none" spellcheck="false" autocomplete="username">')}
    ${creating ? '<p class="meta">اختر اسم مستخدم من 3 إلى 32 حرفًا أو رقمًا. يمكنك استخدام النقطة والشرطة والشرطة السفلية.</p>' : ''}
    ${field('كلمة المرور', `<input name="password" type="password" required maxlength="64" ${passwordOptions}>`)}
    ${creating ? '<p class="meta">استخدم كلمة مرور خاصة بالتجربة من 8 إلى 64 حرفًا.</p>' : ''}
    ${confirmation}
    <div class="actions"><button type="submit">${creating ? 'إنشاء الحساب' : 'دخول'}</button>${alternate}</div>
    </form>`);
}

function patientAccountPage() {
  if (previewServer?.support) return accountOptions();
  const patient = activePatient();
  if (!patient) {
    const previous = state.patientAccounts.some(row => row.username)
      ? `<details class="legacy-sign-in"><summary>الدخول بحساب اختبار سابق</summary>${patientAccessForm(false)}</details>`
      : '';
    return phoneJourney() + previous + (currentTab ? '' : accountOptions());
  }
  const identifier = patient.phoneSuffix
    ? `<dt>الجوال التجريبي</dt><dd>ينتهي بـ <bdi>${html(patient.phoneSuffix)}</bdi></dd>`
    : `<dt>اسم المستخدم</dt><dd><bdi>${html(patient.username)}</bdi></dd>`;
  return card('حساب المراجع', `<dl class="patient-identity">
    <dt>الاسم المعروض</dt><dd>${html(patient.displayName || 'مراجع تجريبي')}</dd>
    ${identifier}
    </dl><div class="actions">
      ${button('تسجيل الخروج', 'patient-sign-out', '', 'secondary')}
    </div>`) + accountOptions();
}

async function readPatientAccess(form, fields) {
  const creating = form.id === 'patient-register';
  const username = String(fields.get('username') ?? '').normalize('NFKC').trim().toLowerCase();
  const password = String(fields.get('password') ?? '');
  const displayName = String(fields.get('displayName') ?? '').trim();
  const submit = form.querySelector('button[type="submit"]');
  if (submit.disabled) return;

  const existing = state.patientAccounts.find(row => row.username === username);
  if (creating) {
    if (displayName.length < 2 || displayName.length > 50 || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{2,31}$/u.test(username)) {
      return feedback('تحقق من الاسم التجريبي واسم المستخدم.', true);
    }
    if (password.length < 8 || password.length > 64) return feedback('استخدم كلمة مرور من 8 إلى 64 حرفًا.', true);
    if (password !== fields.get('confirmPassword')) return feedback('كلمتا المرور غير متطابقتين.', true);
    if (existing) return feedback('اسم المستخدم مستخدم. اختر اسمًا آخر أو سجّل الدخول.', true);
  } else if (!existing || password.length > 64) {
    return feedback('تحقق من اسم المستخدم وكلمة المرور.', true);
  }

  feedback('');
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  let patient = existing;
  try {
    const salt = existing?.salt ?? Array.from(crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await derivePatientPassword(password, salt);
    if (!form.isConnected) return;
    if (!creating && passwordHash !== existing.passwordHash) return feedback('تحقق من اسم المستخدم وكلمة المرور.', true);

    if (creating) {
      patient = { id: newId('PT'), username, displayName, salt, passwordHash };
      state.patientAccounts.push(patient);
      if (!save()) {
        state.patientAccounts.pop();
        return;
      }
    }
  } catch {
    if (form.isConnected) feedback('تعذّر إعداد الدخول التجريبي على هذا الجهاز.', true);
    return;
  } finally {
    submit.disabled = false;
    form.removeAttribute('aria-busy');
  }

  setPatientSession(patient.id);
  const destination = patientAccessDestination();
  navigate(destination, creating ? 'تم إنشاء الحساب وتسجيل الدخول.' : 'تم تسجيل الدخول.');
}

function guide() {
  return card('خطوات التجربة', `
    <ol><li>ابحث في «اكتشف»، وافتح ملف العيادة أو الطبيب، ثم اختر وقت الزيارة.</li>
    <li>أكمل التحقق من الجوال التجريبي، ثم راجع الموعد وأرسل الطلب. تابع حالته من «مواعيدي».</li>
    <li>من «حسابي» افتح «أضف منشأتك» وأرسل طلبًا باسم وهمي. راجعه في تبويب «طلبات العيادات» من مساحة مدير المنصة.</li>
    <li>من الاستقبال، أكّد الطلب في «الطلبات»، ثم سجّل حضوره في «الحضور والدور».</li>
    <li>من الطبيب، استدعِ المراجع من «الدور الحالي» وأتمّ الكشف. راجع النتيجة في «مواعيدي».</li>
    <li>من مالك العيادة، افتح «الاشتراك»، وأصدر فاتورة تجريبية وأرسل إثبات الاختبار.</li>
    <li>من مدير المنصة، افتح «المالية»، واعتمد المبلغ والعملة والمرجع. ستجد الفاتورة في «سجل الفواتير».</li>
    <li>من «التقارير والانقطاع»، افتح «الانقطاع» وجرّب تسجيل الحضور الورقي ومطابقته.</li>
    <li>من «المساعدة»، افتح تذكرة تجريبية، ثم جرّب الرد عليها من مساحة «الدعم الفني».</li></ol>
    <p class="meta">بيانات العيادات والممارسين والمواعيد في هذه النسخة مخصّصة للمحاكاة.</p>`
  );
}

function hub() {
  const choices = field('العيادة · ذمار', `<select id="clinic-select">${Object.entries(catalog()).map(([id, row]) => option(id, row.name, id === clinic)).join('')}</select>`);
  const tiles = Object.entries(workspaces).filter(([id]) => id !== 'patient').map(([id, item]) => `<li>
    <a class="workspace-card" data-route href="${routeHash(id, Object.keys(item.tabs)[0])}">
      <span><strong>${item.title}</strong><span class="meta">${item.detail}</span></span>
      <span class="workspace-arrow" aria-hidden="true"></span>
    </a></li>`).join('');
  return `<div class="card context">${choices}</div><ul class="workspace-grid" aria-label="الأدوار التجريبية">${tiles}</ul>`;
}

function receive(attendance) {
  const rows = bookings().filter(row => {
    const request = ['pending', 'denied', 'cancelled'].includes(row.status);
    return attendance ? !request : request;
  }).reverse();
  const title = attendance ? 'الحضور والدور' : 'طلبات الحجز';
  const counts = bookings();
  const metrics = roleMetrics([
    ['قيد المراجعة', counts.filter(row => row.status === 'pending').length],
    ['بانتظار الحضور', counts.filter(row => row.status === 'confirmed').length],
    ['سُجل حضورهم', counts.filter(row => row.ticket).length],
  ]);
  const filters = `<section class="card">${field('ابحث بالاسم أو مرجع الحجز',
    '<input type="search" id="reception-search" maxlength="80">')}
    <p class="meta" id="reception-no-match" role="status" hidden>لا توجد نتائج مطابقة.</p></section>`;
  const blank = attendance ? empty('لا توجد حجوزات مؤكدة', 'بعد تأكيد الطلب ستتمكن من تسجيل حضوره هنا.')
    : empty('لا توجد طلبات حجز', 'تظهر هنا طلبات المراجعين بعد إرسالها.');
  return metrics + filters + card(title, rows.length ? rows.map(row => {
    let actions = '';
    if (row.status === 'pending') actions = button('تأكيد الحجز', 'confirm', row.id) + button('رفض الطلب', 'deny', row.id, 'secondary');
    if (row.status === 'confirmed') actions = button('تسجيل الحضور', 'arrive', row.id);
    return `<div class="history" data-reception-record="${html(searchable(row.name + ' ' + row.id))}">
      ${bookingInfo(row)}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
  }).join('') : blank);
}

function doctorPage(completedOnly) {
  const doctors = catalog()[clinic].doctors;
  const chosen = doctors.includes(activeDoctor) ? activeDoctor : doctors[0];
  const rows = bookings().filter(row => session(row.sessionId)?.doctor === chosen);
  const input = field('الطبيب', `<select id="doctor-select">${doctors.map(name => option(name, name, chosen === name)).join('')}</select>`);
  if (completedOnly) {
    const completed = rows.filter(row => row.status === 'completed').map(row => `<div class="history">${bookingInfo(row)}</div>`);
    return card('الزيارات المكتملة', input + (completed.join('') || empty('لا توجد زيارات مكتملة', 'تظهر هنا الزيارات بعد إنهائها.')));
  }
  const active = rows.find(row => row.status === 'called' || row.status === 'in_service');
  const waiting = rows.filter(row => row.status === 'waiting');
  if (!active && !waiting.length) return card('الدور الحالي', input + empty('لا يوجد مراجع في الدور', 'تظهر الزيارات هنا بعد تسجيل الحضور.'));
  let commands = '';
  if (active) commands = button(active.status === 'called' ? 'بدء الكشف' : 'إنهاء الزيارة', active.status === 'called' ? 'start' : 'complete', active.id);
  else if (waiting.length) commands = button('استدعاء التالي', 'call', waiting.sort((a, b) => a.arrivedAt - b.arrivedAt)[0].id);
  const current = active ? `<section class="discovery-highlight"><h2>المراجع الحالي</h2>
      ${pill(visitLabels[active.status], visitTones[active.status])}<strong class="clinic-queue-ticket"><bdi>${active.ticket}</bdi></strong>
      <p>${html(active.name)}</p></section>`
    : empty('لا توجد زيارة جارية', 'تظهر هنا بيانات المراجع عند استدعائه.');
  const line = waiting.slice().sort((a, b) => a.arrivedAt - b.arrivedAt).map(row =>
    `<article class="history">${bookingInfo(row)}</article>`).join('');
  return card('الدور الحالي', input + current + (commands ? `<div class="actions">${commands}</div>` : ''))
    + card('قائمة الانتظار', line || empty('لا يوجد منتظرون', 'تظهر هنا أرقام الدور عند تسجيل الحضور.'));
}

function invoiceInfo(row) {
  return `<div class="record-heading"><strong>${amount(row.currency)}</strong>${pill(invoiceLabels[row.status], invoiceTones[row.status])}</div>
    <p class="meta">لمدة 30 يومًا · ${wallets[row.wallet]}</p>
    <p class="meta">رقم الفاتورة <bdi>${html(row.id)}</bdi>${row.reference ? ` · مرجع الإثبات <bdi>${html(row.reference)}</bdi>` : ''}</p>
    ${row.validUntil ? `<p class="meta">تاريخ نهاية الفترة: ${html(dateLocal(new Date(row.validUntil)))}</p>` : ''}`;
}

function proofForm(row) {
  return `<p>مستلم تجريبي · <bdi>0000000001</bdi></p><form id="proof" data-id="${row.id}">
    ${field('مرجع التحويل', '<input name="reference" dir="ltr" placeholder="DHA-QA-001" required maxlength="40">')}
    ${field('ملف إثبات اختباري PDF أو صورة', '<input name="proof" type="file" accept="application/pdf,image/jpeg,image/png">')}
    <label class="checkbox"><input name="sample" type="checkbox"><span>استخدام إثبات الاختبار الجاهز</span></label>
    <button>إرسال الإثبات للمراجعة</button></form>`;
}

function ownerSchedules() {
  const overview = profilesFor(catalog()[clinic]).map(person => `<details class="facility-request-data"><summary>${html(person.name)}</summary>
    ${providerHours(person)}</details>`).join('');
  return card('الدوام الأسبوعي', overview) + card('إضافة نافذة وصول', `<form id="schedule">
    ${field('الطبيب', `<select name="doctor">${catalog()[clinic].doctors.map(name => option(name, name)).join('')}</select>`)}
    ${field('اليوم', `<input name="date" type="date" value="${dateLocal(new Date(now() + dayLength))}" required>`)}
    ${field('بداية الجلسة', '<input name="start" type="time" value="08:00" required>')}
    ${field('نهاية الجلسة', '<input name="end" type="time" value="09:00" required>')}
    ${field('سعة نافذة الوصول', '<input name="capacity" type="number" min="1" max="40" value="8" required>')}
    <button>إضافة جلسة</button>
    </form>`) + card('نوافذ الوصول القادمة', sessions().filter(row => row.date >= dateLocal(new Date()))
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .map(row => `<div class="history"><div class="record-heading"><strong>${html(row.doctor)}</strong>${pill(row.open ? 'الحجز مفتوح' : 'الحجز مغلق', row.open ? 'success' : 'neutral')}</div>
      <p class="meta"><bdi>${html(row.date)}</bdi> · <bdi>${html(row.start)}–${html(row.end)}</bdi></p>
      ${button(row.open ? 'أغلق الحجز للجلسة' : 'افتح الحجز للجلسة', 'toggle-session', row.id, 'secondary')}</div>`).join('')
      || empty('لا توجد نوافذ وصول', 'أضف نافذة ليظهر وقتها للمراجع.'));
}

function ownerSubscription() {
  const openInvoice = invoices().find(row => ['issued', 'submitted', 'returned'].includes(row.status));
  const activeInvoice = invoices().filter(row => row.status === 'paid' && row.validUntil > now()).sort((a, b) => b.validUntil - a.validUntil)[0];
  const issueForm = `<form id="invoice">
    ${field('عملة الاشتراك التجريبي', `<select name="currency">${Object.keys(prices).map(currency => option(currency, amount(currency))).join('')}</select>`)}
    ${field('طريقة التحويل', `<select name="wallet">${Object.entries(wallets).map(([id, label]) => option(id, label)).join('')}</select>`)}
    <button>إصدار فاتورة لمدة 30 يومًا</button></form>`;
  return card('اشتراك العيادة', `<p>${pill(activeInvoice ? 'فعّال في التجربة' : 'بانتظار تفعيل اشتراك تجريبي', activeInvoice ? 'success' : 'pending')}</p>` + (!openInvoice ? issueForm : '')
    + invoices().slice().reverse().map(row => `<div class="history">${invoiceInfo(row)}${row.reviewNote ? `<p class="meta">ملاحظة المراجعة · ${html(row.reviewNote)}</p>` : ''}
      ${['issued', 'returned'].includes(row.status) ? proofForm(row) : ''}</div>`).join(''));
}

function adminPage(review) {
  const rows = state.invoices.filter(row => review ? row.status === 'submitted' : row.status !== 'submitted').reverse();
  const title = review ? 'إثباتات قيد المراجعة' : 'سجل الفواتير';
  const blank = review ? empty('لا توجد إثباتات قيد المراجعة', 'تظهر هنا الإثباتات بعد إرسالها من مساحة مالك العيادة.')
    : empty('لا توجد فواتير في السجل', 'تظهر هنا الفواتير المفتوحة والتي انتهت مراجعتها.');
  const clinics = catalog();
  return card(title, rows.length ? rows.map(row => `<div class="history">
    <h3>${html(clinics[row.clinic]?.name ?? row.clinic)}</h3>${invoiceInfo(row)}
    ${row.status === 'submitted' ? `<p>ملف الإثبات: ${html(row.file)}</p>
      <form class="review" data-id="${row.id}">
      ${field('المرجع الذي تحققت منه', '<input name="reference" dir="ltr" required>')}
      ${field('المبلغ المستلم', '<input name="amount" type="number" min="1" required>')}
      ${field('العملة المستلمة', `<select name="currency" required><option value="">اختر العملة</option>${Object.keys(prices).map(currency => option(currency, prices[currency].label)).join('')}</select>`)}
      <div class="actions"><button>اعتماد الإثبات</button>${button('رفض الإثبات', 'reject-proof', row.id, 'secondary')}</div></form>
      <details class="facility-request-data"><summary>طلب استكمال الإثبات</summary><form class="proof-changes" data-id="${html(row.id)}">
        ${field('ملاحظة المراجعة', '<textarea name="reason" required minlength="4" maxlength="160" rows="2"></textarea>')}
        <button class="secondary">إرسال ملاحظة الاستكمال</button></form></details>`
      : row.status === 'paid' ? button('تسجيل استرداد تجريبي', 'refund', row.id, 'secondary') : ''}</div>`
  ).join('') : blank);
}

function outagePage() {
  const outage = state.outage[clinic] ?? { active: false, paper: [] };
  const candidates = bookings().filter(row => row.status === 'confirmed');
  const paperForm = outage.active && candidates.length ? `<form id="paper">
    ${field('الحجز المؤكد', `<select name="booking">${candidates.map(row => option(row.id, row.name + ' · ' + row.id)).join('')}</select>`)}
    <button>تسجيل على الورق</button></form>` : '';
  const paper = outage.paper.map(id => {
    const booking = bookings().find(row => row.id === id);
    return `<p>${html(booking?.name)} ${!outage.active && booking?.status === 'confirmed' ? button('مطابقة الحضور', 'reconcile', id, 'secondary') : ''}</p>`;
  }).join('');
  return card('محاكاة الانقطاع', `<p>${pill(outage.active ? 'محاكاة الانقطاع نشطة' : 'محاكاة الانقطاع متوقفة', outage.active ? 'pending' : 'neutral')}</p>
    ${button(outage.active ? 'إنهاء وضع الانقطاع' : 'ابدأ انقطاعًا تجريبيًا', 'outage', '', 'secondary')}
    ${paperForm}${paper}`);
}

function reports() {
  const visits = bookings();
  const stats = [
    ['الحجوزات', visits.length],
    ['الزيارات المكتملة', visits.filter(row => row.status === 'completed').length],
    ['الفواتير المدفوعة', invoices().filter(row => row.status === 'paid').length],
  ];
  const events = state.events.filter(row => row.clinic === clinic).slice(-10).reverse();
  return card('التقارير', `<ul class="stats">${stats.map(([label, count]) => `<li>${label}: <strong>${count}</strong></li>`).join('')}</ul>`
    + (events.length ? `<ul>${events.map(row => `<li>${html(row.message)}</li>`).join('')}</ul>`
      : empty('لا يوجد نشاط بعد', 'تظهر هنا الإجراءات التجريبية لهذه العيادة.')))
    + card('إعادة ضبط التجربة', '<p>تحذف هذه العملية بيانات التجربة على هذا الهاتف، بما فيها الحسابات والحجوزات وتذاكر الدعم.</p>' + button('إعادة ضبط', 'reset', '', 'danger'));
}

const signedInDestinations = {
  book: ['patient', 'book'], history: ['patient', 'history'], tickets: ['tickets'], 'new-ticket': ['new-ticket'],
  'job-profile': ['jobs', 'profile'], 'job-applications': ['jobs', 'my'], 'job-apply': ['jobs', 'apply'],
};
function patientAccessDestination() {
  if (chosenBookingSession) return appointmentHash('patient', chosenBookingSession);
  const resume = !previewServer && currentTab === 'job-apply' ? jobAdvert(discoveryRoute.day) : null;
  if (resume?.kind === 'vacancy') return patientJobHash('apply', resume.id);
  const path = signedInDestinations[currentTab];
  return routeHash(...(path ?? ['account']));
}
const publicPages = {
  jobs: { title: 'الوظائف الصحية', detail: 'فرص العمل في العيادات والمنشآت الصحية.', render: jobsPage },
  directory: { title: 'احجز موعدك', detail: 'اعثر على طبيب أو عيادة في ذمار.', render: browseDirectory },
  clinic: { title: '', detail: '', render: clinicDiscoverProfile },
  practitioner: { title: 'ملف الممارس', detail: '', render: providerProfile },
  slots: { title: 'اختيار الموعد', detail: '', render: appointmentPicker },
  notifications: { title: 'التنبيهات', detail: 'تحديثات الحجز والدعم على هذا الجهاز.', render: previewNotifications },
  settings: { title: 'الإعدادات', detail: '', render: previewSettings },
  apply: { title: 'أضف منشأتك', detail: 'قدّم طلبًا تجريبيًا لإدراج عيادة في الدليل.', render: applyForClinic },
  account: { title: 'حسابي', detail: 'حساب المراجع التجريبي', render: patientAccountPage },
  register: { title: 'إنشاء حساب مراجع', detail: 'أنشئ حسابًا تجريبيًا على هذا الجهاز.', render: () => patientAccessForm(true) },
  applications: { title: 'متابعة طلبات الإضافة', detail: 'حالة الطلبات المقدّمة من هذا الجهاز.', render: () => clinicApplications(false) },
  hub: { title: 'مساحات العمل', detail: 'اختر عيادة في ذمار ثم افتح مساحة العمل.', render: hub },
  guide: { title: 'كيف تجرّب النظام؟', detail: 'جرّب الحجز والدور وإدارة العيادة في ذمار.', render: guide },
  help: { title: 'مركز المساعدة', detail: 'ابحث عن إجابة أو تابع تذكرة دعم.', render: helpCenter },
  'new-ticket': { title: 'فتح تذكرة دعم', detail: 'صف المشكلة أو الاستفسار.', render: newSupportTicket },
  tickets: { title: 'تذاكر الدعم', detail: 'تابع حالة التذكرة واقرأ الردود.', render: supportTickets },
};

const clinicPages = ['clinic', 'practitioner', 'slots'];

function render() {
  const workspace = workspaces[role];
  const page = publicPages[role];
  const profile = clinicPages.includes(role) ? catalog()[clinic] : null;
  const patientTab = role === 'patient';
  const staffWorkspace = workspace && !patientTab;
  const hasStaffNav = staffWorkspace && !['support', 'admin', 'employer'].includes(role);
  const mainEntry = role === 'directory' || (role === 'account' && !currentTab)
    || (role === 'jobs' && !discoveryRoute.tab) || (patientTab && ['history', 'follow'].includes(currentTab));
  const bookingTitle = activePatient() || !chosenBookingSession ? 'مراجعة الحجز' : 'إكمال الحجز';
  const patientTitles = { book: bookingTitle, history: 'مواعيدي', follow: 'حالة الحجز', detail: 'تفاصيل الموعد', change: 'تغيير الموعد' };
  const title = patientTab ? patientTitles[currentTab]
    : ['admin', 'employer'].includes(role) ? workspace.tabs[currentTab][0]
    : role === 'jobs' ? (Object.hasOwn(jobTitles, discoveryRoute.tab) ? jobTitles[discoveryRoute.tab] : page.title)
    : role === 'support' && currentSupportId ? 'مراجعة تذكرة'
    : role === 'clinic' ? profile.name
    : (role === 'account' && currentTab) ? 'تسجيل الدخول' : workspace?.title ?? page.title;
  const context = patientTab && currentTab === 'history' ? 'تابع حجوزاتك في العيادات.'
    : ['admin', 'support'].includes(role) ? 'مساحة عمل تجريبية'
    : workspace ? catalog()[clinic].name : role === 'jobs' && discoveryRoute.tab ? '' : profile?.area ?? page.detail;
  pageHeading.classList.toggle('hero', ['hub', 'guide', 'help'].includes(role));
  pageHeading.innerHTML = `<div class="page-heading-line"><h1 tabindex="-1">${html(title)}</h1>
    ${role === 'directory' ? '<span class="preview-tag">بيانات تجريبية</span>' : ''}</div>
    ${context ? `<p>${html(context)}</p>` : ''}`;
  notice.hidden = !['register', 'apply', 'hub'].includes(role);
  notificationsLink.hidden = !mainEntry;
  notificationsLink.href = routeHash('notifications');
  backButton.hidden = Boolean(mainEntry || hasStaffNav);
  cityLabel.hidden = role !== 'directory';
  screen.innerHTML = workspace ? workspace.tabs[currentTab][1]() : page.render();
  updatePhoneCooldown();

  const navLink = (label, href, active, icon = '', external = false) =>
    `<a ${external ? '' : 'data-route '}href="${html(href)}"${active ? ' aria-current="page"' : ''}>${icon ? discoverIcon(icon) : ''}<span>${label}</span></a>`;
  navigation.hidden = !hasStaffNav && !mainEntry;
  if (hasStaffNav) {
    const links = Object.entries(workspace.tabs).map(([tab, [label]]) => navLink(label, routeHash(role, tab), tab === currentTab));
    const label = ['admin', 'owner'].includes(role) ? 'الأدوار' : 'المساحات';
    navigation.innerHTML = `<div class="nav-inner${role === 'owner' ? ' owner-nav' : ''}">${links.join('')}${navLink(label, routeHash(), false)}</div>`;
    navigation.setAttribute('aria-label', 'تنقل مساحة العمل');
  } else if (mainEntry) {
    const jobs = !previewServer || previewServer.jobs;
    navigation.innerHTML = `<div class="nav-inner patient-nav${jobs ? ' patient-nav-jobs' : ''}">
      ${navLink('اكتشف', routeHash('directory'), role === 'directory', 'home')}
      ${navLink('مواعيدي', routeHash('patient', 'history'), patientTab && currentTab === 'history', 'calendar')}
      ${jobs ? navLink('الوظائف', previewServer?.jobs ?? routeHash('jobs'), role === 'jobs', 'briefcase', Boolean(previewServer?.jobs)) : ''}
      ${navLink('حسابي', routeHash('account'), role === 'account', 'user')}
    </div>`;
    navigation.setAttribute('aria-label', 'التنقل الرئيسي');
  } else navigation.replaceChildren();
}

function renderRoute(message = '', moveFocus = true) {
  if (previewServer && liveCatalog === null) return renderConnectedLoading();
  const day = dateLocal(new Date());
  if (day !== sessionDate) {
    sessionDate = day;
    refreshPreviewSessions(day);
    save();
  }
  let [requestedClinic, workspace, tab, item, selection] = window.location.hash.slice(1).split('/');
  const knownClinic = Object.hasOwn(catalog(), requestedClinic);
  const nextClinic = knownClinic ? requestedClinic : Object.keys(catalog())[0];
  if (clinic !== nextClinic) {
    clinic = nextClinic;
    activeDoctor = '';
  }

  if (knownClinic && !previewServer && workspace === 'admin') {
    if (tab === 'support') {
      workspace = 'support';
      tab = 'inbox';
      history.replaceState(history.state, '', routeHash(workspace, tab) + (item ? '/' + encodeURIComponent(item) : ''));
    } else if (tab === 'review' || tab === 'invoices') {
      item = tab === 'invoices' ? 'history' : '';
      tab = 'finance';
      history.replaceState(history.state, '', routeHash(workspace, tab) + (item ? '/' + item : ''));
    }
  }
  const tabs = knownClinic && (!previewServer || workspace === 'patient') && Object.hasOwn(workspaces, workspace) ? workspaces[workspace].tabs : null;
  role = !previewServer && knownClinic && !workspace ? 'hub' : 'directory';
  const localOnly = ['apply', 'applications', 'hub', 'jobs'];
  const publicPage = Object.hasOwn(publicPages, workspace) && (!previewServer || !localOnly.includes(workspace));
  if (tabs || (publicPage && (!clinicPages.includes(workspace) || knownClinic))) role = workspace;
  if (role === 'register' && activePatient()) role = 'account';
  currentTab = '';
  if (tabs) currentTab = Object.hasOwn(tabs, tab) ? tab : Object.keys(tabs)[0];
  if ((role === 'account' || role === 'register') && Object.hasOwn(signedInDestinations, tab)) currentTab = tab;
  chosenBookingSession = currentTab === 'book' && /^[A-Za-z0-9-]+$/.test(item ?? '') ? item : '';
  currentBookingId = role === 'patient' && /^[A-Za-z0-9-]+$/.test(item ?? '') ? item : '';
  discoveryRoute = { tab: tab ?? '', day: item ?? '', appointment: selection ?? '' };
  currentSupportId = role === 'support' ? item ?? '' : role === 'tickets' && String(tab ?? '').startsWith('SUP-') ? tab : '';
  render();
  feedback(message);
  if (previewServer && isConnectedTicketPage()) void updateConnectedTickets();
  refreshConnectedDirectory();
  if (moveFocus) {
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    pageHeading.querySelector('h1').focus({ preventScroll: true });
  }
}

function navigate(hash, message = '', tabChange = false) {
  if (window.location.hash !== hash) {
    if (tabChange) history.replaceState(history.state, '', hash);
    else history.pushState({ nobteekRoute: true }, '', hash);
  }
  renderRoute(message, !tabChange);
  if (tabChange) {
    const selection = [...screen.querySelectorAll('a[data-selection][aria-current]')].find(link => link.hash === hash);
    selection?.focus({ preventScroll: true });
  }
}

function previewBack() {
  if (role === 'hub') return navigate(routeHash('account'));
  if (role === 'admin') return navigate(currentTab === 'overview' ? routeHash() : routeHash('admin', 'overview'));
  if (role === 'support') return navigate(currentSupportId ? routeHash('support', 'inbox') : routeHash());
  if (role === 'employer') {
    if (discoveryRoute.day) return navigate(employerJobHash(currentTab));
    return navigate(currentTab === 'overview' ? routeHash() : employerJobHash('overview'));
  }
  if (role === 'jobs') {
    if (discoveryRoute.tab === 'profile' && discoveryRoute.day) return navigate(patientJobHash('apply', discoveryRoute.day));
    if (discoveryRoute.tab === 'apply') return navigate(patientJobHash('vacancy', discoveryRoute.day));
    const parent = { application: 'my', seeker: 'profile' };
    return navigate(patientJobHash(parent[discoveryRoute.tab] ?? ''));
  }
  if (role === 'tickets' && currentSupportId) return navigate(routeHash('tickets'));
  if (history.state?.nobteekRoute) return history.back();
  if (role === 'slots') return navigate(routeHash('practitioner', discoveryRoute.tab));
  if (role === 'practitioner') return navigate(routeHash('clinic', 'doctors'));
  if (role === 'patient') return navigate(currentTab === 'book' ? routeHash('clinic') : routeHash('patient', 'history'));
  const parents = {
    guide: 'help', 'new-ticket': 'help', tickets: 'help', applications: 'apply',
    settings: 'account', apply: 'account', help: 'account', register: 'account',
  };
  return navigate(routeHash(parents[role] ?? 'directory'));
}

document.addEventListener('input', event => {
  if (event.target.id === 'directory-search') updateBrowseDirectory();
  if (event.target.id === 'help-search') updateHelpSearch();
  if (event.target.id === 'jobs-search') updateJobResults();
  if (event.target.id === 'support-search') updateSupportDesk();
  if (event.target.id === 'platform-role-search') filterPlatformRoles(event.target.value);
  if (event.target.id === 'reception-search') {
    const query = searchable(event.target.value);
    const rows = [...screen.querySelectorAll('[data-reception-record]')];
    for (const row of rows) row.hidden = !row.dataset.receptionRecord.includes(query);
    document.getElementById('reception-no-match').hidden = !query || rows.some(row => !row.hidden);
  }
});

document.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'help-topic') updateHelpSearch();
  if (['jobs-profession', 'jobs-work-type', 'jobs-area'].includes(input.id)) updateJobResults();
  if (input.id === 'support-member') selectSupportMember(input.value);
  if (['support-status', 'support-assigned-only'].includes(input.id)) updateSupportDesk();
  if (['directory-specialty', 'directory-area', 'directory-today'].includes(input.id)) updateBrowseDirectory();
  const alert = input.dataset.previewAlert;
  if (role === 'notifications' && Object.hasOwn(state.notificationPrefs, alert)) {
    const original = state.notificationPrefs[alert];
    state.notificationPrefs[alert] = input.checked;
    if (save()) {
      screen.innerHTML = previewNotifications();
      screen.querySelector(`[data-preview-alert="${alert}"]`).focus({ preventScroll: true });
    } else input.checked = state.notificationPrefs[alert] = original;
  }
  if (input.id === 'clinic-select' && Object.hasOwn(catalog(), input.value)) {
    history.replaceState(history.state, '', '#' + input.value);
    renderRoute('', false);
    document.querySelector('#clinic-select').focus({ preventScroll: true });
  }
  if (input.id === 'doctor-select') {
    activeDoctor = input.value;
    render();
    document.querySelector('#doctor-select').focus({ preventScroll: true });
  }
  if (input.name === 'sample' && input.form?.id === 'proof') {
    if (input.checked && !input.form.elements.reference.value) {
      input.form.elements.reference.value = 'DHA-QA-' + String(state.invoices.findIndex(row => row.id === input.form.dataset.id) + 1).padStart(3, '0');
    }
  }
});

function changeBooking(row, action) {
  const transitions = {
    confirm: ['pending', 'confirmed', 'تم تأكيد الحجز'],
    deny: ['pending', 'denied', 'رُفض طلب الحجز'],
    arrive: ['confirmed', 'waiting', 'تم تسجيل الحضور'],
    call: ['waiting', 'called', 'تم استدعاء المراجع'],
    start: ['called', 'in_service', 'بدأ الكشف'],
    complete: ['in_service', 'completed', 'اكتملت الزيارة'],
  };
  const [from, to, title] = transitions[action] ?? transitions.arrive;
  if (row.status !== from) return feedback('تعذر تنفيذ الإجراء في الحالة الحالية.', true);
  const schedule = session(row.sessionId);
  if (action === 'confirm' && (!schedule.open || bookings().filter(item => item.sessionId === schedule.id && !['pending', 'denied', 'cancelled'].includes(item.status)).length >= schedule.capacity)) return feedback('النافذة مغلقة أو اكتملت سعتها.', true);
  const outage = state.outage[clinic];
  if (action === 'arrive' && outage?.active) return feedback('استخدم السجل الورقي في وضع الانقطاع.', true);
  if (action === 'reconcile') outage.paper = outage.paper.filter(id => id !== row.id);
  if (to === 'waiting') {
    row.ticket = ++schedule.ticket;
    row.arrivedAt = now();
  }
  row.status = to;
  record(title + ' · ' + row.name, clinic, action === 'confirm' ? 'reception/attendance' : '');
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-route]');
  if (link) {
    event.preventDefault();
    navigate(link.hash, '', link.hasAttribute('data-selection'));
    return;
  }
  const control = event.target.closest('button[data-action]');
  if (!control) return;
  const { action, id } = control.dataset;
  if (action === 'preview-back') return previewBack();
  if (action === 'platform-member-toggle') return togglePlatformMember(id);
  if (action === 'job-withdraw') return withdrawJobAdvert(id);
  if (action === 'job-bookmark') return toggleJobBookmark(id);
  if (action === 'job-approve') return moderateJobAdvert(id, 'published');
  if (action === 'job-fee-review') return reviewPlacementFee(id);
  if (action === 'job-report-reviewed' || action === 'job-report-hide') return reviewJobReport(id, action === 'job-report-hide');
  if (action.startsWith('hiring-')) return updateHiringCase(id, action.slice(7));
  if (action === 'revise-clinic' && role === 'applications') return resumeClinicApplication(id);
  if (action === 'facility-save-draft' && role === 'apply') return readClinicApplication(new FormData(control.form), true);
  if (action === 'clinic-invite-cancel' && role === 'owner' && currentTab === 'team') return cancelPreviewStaffInvite(id);
  if (action === 'connected-catalog') return loadConnectedCatalog();
  if (action === 'connected-ticket') return updateConnectedTickets();
  if (action === 'booking-phone-resend') return sendPreviewPhoneCode(matchingChallenge()?.phone);
  if (action === 'booking-phone-change') return editPreviewPhone();
  if (action === 'preview-text-size' && role === 'settings') return togglePreviewText(control);
  if (action === 'support-close') return closeSupportTicket();
  if (action === 'support-leave-guest' && role === 'tickets' && !activePatient()) {
    guestSupport = null;
    return navigate(routeHash('tickets'), 'تم إخفاء تذكرة الضيف.');
  }
  if (action === 'approve-clinic' && role === 'admin' && currentTab === 'clinics') return decideClinic(id, 'approved');
  if (action === 'patient-sign-out' && role === 'account') {
    setPatientSession(null);
    return navigate(routeHash('account'), 'تم تسجيل الخروج.');
  }
  if (action === 'reset') {
    if (confirm('إعادة ضبط بيانات الاختبار على الجهاز؟')) {
      state = seed();
      refreshPreviewSessions(dateLocal(new Date()));
      setPatientSession(null);
      updatePhoneChallenge(null);
      activeDoctor = '';
      if (!Object.hasOwn(referenceClinics, clinic)) {
        clinic = 'queen';
        history.replaceState(null, '', routeHash('operations', 'reports'));
      }
      record('بدأت تجربة جديدة');
    }
    return;
  }
  if (action === 'outage') {
    const outage = state.outage[clinic] ??= { active: false, paper: [] };
    outage.active = !outage.active;
    return record(outage.active ? 'بدأ انقطاع تجريبي' : 'عاد الاتصال التجريبي');
  }
  if (action === 'toggle-session') {
    const schedule = sessions().find(row => row.id === id);
    if (schedule) { schedule.open = !schedule.open; record(schedule.open ? 'فُتح حجز الجلسة' : 'أُغلق حجز الجلسة'); }
    return;
  }
  if (role === 'admin' && currentTab === 'finance') {
    const invoice = state.invoices.find(row => row.id === id);
    const decision = action === 'reject-proof' && invoice?.status === 'submitted' ? ['rejected', 'رُفض إثبات الاختبار']
      : action === 'refund' && invoice?.status === 'paid' ? ['refunded', 'سُجل الاسترداد التجريبي'] : null;
    if (decision) {
      return commitPreview({
        invoices: replacePreviewRow(state.invoices, { ...invoice, status: decision[0] }),
        platformAudit: platformAudit(decision[1], id),
      }, decision[1], routeHash('admin', 'finance') + '/history');
    }
  }
  const booking = bookings().find(row => row.id === id);
  if (booking) changeBooking(booking, action);
});

function readSchedule(fields) {
  const doctor = fields.get('doctor');
  const date = fields.get('date');
  const start = fields.get('start');
  const end = fields.get('end');
  const capacity = Number(fields.get('capacity'));
  if (!catalog()[clinic].doctors.includes(doctor) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < dateLocal(new Date())
    || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start || !Number.isInteger(capacity) || capacity < 1 || capacity > 40) return feedback('اختر تاريخًا وساعات وسعة صحيحة.', true);
  if (sessions().some(row => row.date === date && row.doctor === doctor && row.open && row.start < end && row.end > start)) return feedback('الموعد يتداخل مع جلسة مفتوحة للطبيب.', true);
  state.sessions.push({ id: newId('S'), clinic, doctor, date, start, end, capacity, open: true, ticket: 0 });
  if (!record('أضيفت جلسة بموعد جديد')) state.sessions.pop();
}

function readProof(fields, id) {
  const invoice = invoices().find(row => row.id === id && ['issued', 'returned'].includes(row.status));
  const reference = String(fields.get('reference') ?? '').trim().toUpperCase();
  const proof = fields.get('proof');
  const isSample = fields.get('sample') === 'on';
  if (!invoice || !/^[A-Z0-9][A-Z0-9/_-]{3,39}$/.test(reference)) return feedback('أدخل مرجع تحويل تجريبي صالحًا.', true);
  if (!isSample && (!proof?.size || proof.size > limit || !['application/pdf', 'image/png', 'image/jpeg'].includes(proof.type))) return feedback('اختر PDF أو صورة بحجم يصل إلى 2 ميغابايت، أو استخدم الإثبات الجاهز.', true);
  return commitPreview({ invoices: replacePreviewRow(state.invoices, {
    ...invoice, status: 'submitted', reference, file: isSample ? 'إثبات اصطناعي جاهز' : proof.name, reviewNote: '',
  }) }, 'أُرسل إثبات التحويل التجريبي للمراجعة');
}

function approve(fields, id) {
  const row = state.invoices.find(invoice => invoice.id === id && invoice.status === 'submitted');
  if (!row || fields.get('currency') !== row.currency || Number(fields.get('amount')) !== prices[row.currency].amount
    || String(fields.get('reference')).trim().toUpperCase() !== row.reference) return feedback('تحقق من تطابق المبلغ والعملة والمرجع.', true);
  if (state.invoices.some(invoice => ['paid', 'refunded'].includes(invoice.status) && invoice.reference === row.reference)) return feedback('سبق اعتماد هذا المرجع.', true);
  const lastEnd = state.invoices.filter(invoice => invoice.clinic === row.clinic && invoice.status === 'paid').reduce((end, invoice) => Math.max(end, invoice.validUntil), now());
  return commitPreview({
    invoices: replacePreviewRow(state.invoices, { ...row, status: 'paid', validUntil: lastEnd + 30 * dayLength }),
    platformAudit: platformAudit('اعتمد مدير المنصة إثبات اشتراك', id),
  }, 'اعتمد مدير المنصة الاشتراك التجريبي', routeHash('admin', 'finance') + '/history');
}

document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  const fields = new FormData(form);
  if (form.id === 'support-new' && role === 'new-ticket') return submitSupportAccess(form, () => createSupportTicket(form, fields));
  if (form.id === 'support-guest' && role === 'tickets' && !activePatient()) return submitSupportAccess(form, () => openGuestTicket(form, fields));
  if (form.id === 'support-reply') return replyToSupportTicket(fields);
  if (form.id === 'support-assign') return assignSupportTicket(fields);
  if (form.id === 'career-profile') return saveCareerProfile(fields);
  if (form.id === 'job-advert') return submitJobAdvert(fields);
  if (form.id === 'job-report') return reportJobAdvert(fields, form.dataset.id);
  if (form.id === 'job-invite') return sendJobInvitation(fields, form.dataset.id);
  if (form.id === 'job-application') return submitJobApplication(fields, form.dataset.id, form.dataset.invitation === 'true');
  if (form.id === 'hiring-interview' || form.id === 'hiring-offer') return updateHiringCase(form.dataset.id, form.id.slice(7), fields);
  if (form.classList.contains('job-moderation')) return moderateJobAdvert(form.dataset.id, textFrom(fields, 'decision'), textFrom(fields, 'reason'));
  if (form.id === 'clinic-application' && role === 'apply') return readClinicApplication(fields);
  if (form.id === 'clinic-team-invite' && role === 'owner' && currentTab === 'team') return invitePreviewStaff(fields);
  if (form.classList.contains('clinic-review-note')) return decideClinic(form.dataset.id, form.dataset.decision, textFrom(fields, 'reason'));
  if (form.classList.contains('proof-changes')) return returnProofForChanges(fields, form.dataset.id);
  if ((form.id === 'patient-login' && role === 'account') || (form.id === 'patient-register' && role === 'register')) {
    return readPatientAccess(form, fields);
  }
  if (form.id === 'booking-phone' && phoneFlowActive()) return sendPreviewPhoneCode(fields.get('phone'));
  if (form.id === 'booking-phone-code' && phoneFlowActive()) return verifyPreviewPhone(form, fields);
  if (role === 'patient') {
    if (currentTab === 'book' && form.id === 'booking-select') {
      const appointment = previewSessionFor(clinic, fields.get('session'));
      if (appointment) return navigate(appointmentHash('patient', appointment.id));
      return feedback('اختر موعدًا متاحًا.', true);
    }
    if (currentTab === 'book' && form.id === 'booking') return readBooking(form, fields);
    if (currentTab === 'detail' && form.id === 'appointment-cancel') return updatePatientAppointment(fields, true);
    if (currentTab === 'change' && form.id === 'appointment-change') return updatePatientAppointment(fields, false);
  }
  if (form.id === 'schedule') return readSchedule(fields);
  if (form.id === 'proof' && role === 'owner' && currentTab === 'subscription') return readProof(fields, form.dataset.id);
  if (form.classList.contains('review') && role === 'admin' && currentTab === 'finance') return approve(fields, form.dataset.id);
  if (form.id === 'invoice' && role === 'owner' && currentTab === 'subscription') {
    const currency = fields.get('currency');
    const wallet = fields.get('wallet');
    if (!Object.hasOwn(prices, currency) || !Object.hasOwn(wallets, wallet) || invoices().some(row => ['issued', 'submitted', 'returned'].includes(row.status))) return feedback('توجد فاتورة مفتوحة أو خيار دفع غير متاح.', true);
    return commitPreview({ invoices: [...state.invoices, { id: newId('INV'), clinic, currency, wallet, status: 'issued' }] }, 'صدرت فاتورة اشتراك تجريبية');
  }
  if (form.id === 'paper') {
    const outage = state.outage[clinic];
    const id = fields.get('booking');
    if (!outage?.active || !bookings().some(row => row.id === id && row.status === 'confirmed')) return feedback('تعذر تسجيل الحضور الورقي.', true);
    if (!outage.paper.includes(id)) outage.paper.push(id);
    record('حُفظ الحضور في سجل المطابقة التجريبي');
  }
});

save();
window.addEventListener('popstate', () => renderRoute());
setupPreviewText();
notificationsLink.innerHTML = discoverIcon('bell');
backButton.innerHTML = discoverIcon('right');
cityLabel.innerHTML = discoverIcon('pin') + '<span>ذمار</span>';
renderRoute('', false);
startConnectedPreview();
