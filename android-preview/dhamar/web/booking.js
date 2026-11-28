'use strict';

const phoneChallengeKey = 'nobteek-preview-phone-challenge';
const phoneChallengeLifetime = 10 * 60 * 1000;
const phoneResendDelay = 30 * 1000;
const phoneAttemptLimit = 5;
const bookingDate = new Intl.DateTimeFormat('ar-YE', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Aden',
});
const latinDigits = value => String(value ?? '').normalize('NFKC').replace(/[٠-٩۰-۹]/g, digit =>
  String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10));

function previewPhone(value) {
  const compact = latinDigits(value).replace(/[\s()-]/g, '');
  const matches = /^(?:(?:\+|00)?967)?(7[0-9]{8})$/.exec(compact);
  return matches ? '+967' + matches[1] : '';
}

let phoneChallenge;
try { phoneChallenge = JSON.parse(sessionStorage.getItem(phoneChallengeKey)); } catch { /* Start a fresh challenge. */ }
let codeFeedbackTimer;

function updatePhoneChallenge(challenge) {
  phoneChallenge = challenge;
  try {
    if (challenge) sessionStorage.setItem(phoneChallengeKey, JSON.stringify(challenge));
    else sessionStorage.removeItem(phoneChallengeKey);
  } catch { /* The current screen can still verify its code. */ }
}

function phoneFlowScope() {
  return role === 'patient' ? clinic + '/' + chosenBookingSession : 'account/' + currentTab;
}

function matchingChallenge() {
  return phoneChallenge?.scope === phoneFlowScope() ? phoneChallenge : null;
}

const phoneFlowActive = () => !activePatient() && (
  role === 'account'
  || (role === 'patient' && currentTab === 'book' && chosenBookingSession && previewSessionFor(clinic, chosenBookingSession))
);

const reviewRow = (label, value, icon) => `<div>${discoverIcon(icon)}<dt>${label}</dt><dd>${value}</dd></div>`;
const absoluteDate = value => bookingDate.format(previewCalendar(value));

function appointmentSummary(row, title = 'تفاصيل الموعد') {
  const entry = catalog()[row.clinic];
  return card(title, `<dl class="booking-summary">
    ${reviewRow('المنشأة', html(entry.name) + '<small>' + html([entry.branch, entry.address ?? entry.area].filter(Boolean).join(' · ')) + '</small>', 'building')}
    ${reviewRow('الممارس', html(row.doctor), 'user')}
    ${reviewRow('التاريخ', html(absoluteDate(row.date)), 'calendar')}
    ${reviewRow('نافذة الوصول', row.start === '00:00' && row.end === '23:59'
      ? 'طوال اليوم' : '<bdi>' + html(displayTime(row.start) + ' – ' + displayTime(row.end)) + '</bdi>', 'clock')}
  </dl>`);
}

function bookingUnavailable(row) {
  const entry = catalog()[clinic];
  const providerIndex = entry.doctors.indexOf(row?.doctor);
  const alternate = providerIndex >= 0 ? dayPickerHash(providerIndex, row.date) : routeHash('clinic');
  return card('الموعد غير متاح', '<p>قد يمتلئ الموعد أو يتغير دوام العيادة أثناء الحجز. اختر موعدًا آخر للمتابعة.</p>'
    + '<div class="actions">' + discoverButton('اختيار موعد آخر', alternate) + '</div>');
}

function phoneJourney(selected = null) {
  const challenge = matchingChallenge();
  const inTime = challenge && challenge.expiresAt > now();
  const summary = selected ? appointmentSummary(selected, 'الموعد المختار') : '';
  if (!inTime) {
    const phone = challenge?.phone?.slice(4) ?? '';
    return card('تأكيد رقم الهاتف', `<p class="meta">استخدم رقم جوال يمنيًا وهميًا. يظهر رمز الاختبار هنا على الجهاز.</p>
      ${challenge?.expiresAt ? '<p class="meta">انتهت صلاحية الرمز. اطلب رمزًا جديدًا لإكمال الخطوات.</p>' : ''}
      <form id="booking-phone">
        ${field('رقم الجوال · اليمن +967', `<input name="phone" type="tel" inputmode="tel" dir="ltr" maxlength="23"
          autocomplete="off" placeholder="770000001" value="${html(phone)}" required>`)}
        <button type="submit">إنشاء رمز الاختبار</button>
      </form>`) + summary;
  }

  const limited = challenge.attempts >= phoneAttemptLimit;
  return card('رمز التحقق', `<p class="meta">جوال تجريبي ينتهي بـ <bdi>${html(challenge.phone.slice(-4))}</bdi></p>
    ${limited ? '<p class="meta">استُنفدت محاولات هذا الرمز. اطلب رمزًا جديدًا.</p>' : `
      <p class="booking-code"><span>رمز الاختبار</span><output id="booking-demo-code" dir="ltr">${html(challenge.code)}</output></p>
      <form id="booking-phone-code">
        ${field('أدخل الرمز المكوّن من ستة أرقام',
          '<input name="code" type="text" inputmode="numeric" dir="ltr" maxlength="6" autocomplete="one-time-code" required>')}
        <button type="submit">تحقّق وتابع</button>
      </form>`}
    <div class="actions phone-actions">
      ${button('إعادة إنشاء الرمز', 'booking-phone-resend', '', 'secondary')}
      ${button('تعديل رقم الهاتف', 'booking-phone-change', '', 'secondary')}
    </div><p class="meta" id="booking-resend-hint"></p>`) + summary;
}

function updatePhoneCooldown() {
  clearTimeout(codeFeedbackTimer);
  const hint = document.getElementById('booking-resend-hint');
  const challenge = matchingChallenge();
  if (!hint || !challenge) return;
  const seconds = Math.max(0, Math.ceil((challenge.resendAt - now()) / 1000));
  const resend = screen.querySelector('[data-action="booking-phone-resend"]');
  resend.disabled = seconds > 0;
  hint.textContent = seconds ? 'يمكنك إنشاء رمز جديد بعد ' + seconds.toLocaleString('ar-YE') + ' ث.' : '';
  if (seconds) codeFeedbackTimer = setTimeout(updatePhoneCooldown, 1000);
}

function sendPreviewPhoneCode(number) {
  if (!phoneFlowActive()) return;
  const phone = previewPhone(number);
  if (!phone) return feedback('أدخل جوالًا يمنيًا صحيحًا من تسعة أرقام يبدأ بسبعة.', true);
  if (previewServer && !/^\+96777000000[1-9]$/.test(phone)) return feedback('استخدم أحد أرقام الاختبار من 770000001 إلى 770000009.', true);
  const previous = matchingChallenge();
  if (previous?.phone === phone && previous.expiresAt && now() < previous.resendAt) return;
  const numberValue = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  updatePhoneChallenge({
    scope: phoneFlowScope(), phone, code: String(numberValue).padStart(6, '0'),
    attempts: 0, expiresAt: now() + phoneChallengeLifetime, resendAt: now() + phoneResendDelay,
  });
  render();
  feedback('');
  screen.querySelector('#booking-phone-code input')?.focus({ preventScroll: true });
}

function editPreviewPhone() {
  if (!phoneFlowActive()) return;
  const challenge = matchingChallenge();
  if (!challenge) return;
  updatePhoneChallenge({ ...challenge, code: '', expiresAt: 0 });
  render();
  feedback('');
  screen.querySelector('#booking-phone input')?.focus({ preventScroll: true });
}

async function verifyPreviewPhone(form, fields) {
  if (!phoneFlowActive()) return;
  const challenge = matchingChallenge();
  if (!challenge || now() >= challenge.expiresAt) {
    render();
    return feedback('انتهت صلاحية الرمز. أنشئ رمزًا جديدًا.', true);
  }
  if (challenge.attempts >= phoneAttemptLimit) return;
  const control = form.querySelector('button[type="submit"]');
  if (control.disabled) return;
  const code = latinDigits(fields.get('code')).trim();
  if (!/^[0-9]{6}$/.test(code)) return feedback('أدخل رمزًا من ستة أرقام.', true);
  if (code !== challenge.code) {
    updatePhoneChallenge({ ...challenge, attempts: challenge.attempts + 1 });
    if (phoneChallenge.attempts >= phoneAttemptLimit) render();
    return feedback('الرمز غير صحيح.', true);
  }
  control.disabled = true;
  form.setAttribute('aria-busy', 'true');
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(challenge.phone));
    if (!form.isConnected || challenge !== matchingChallenge() || !phoneFlowActive()) return;
    if (now() >= challenge.expiresAt) {
      render();
      return feedback('انتهت صلاحية الرمز. أنشئ رمزًا جديدًا.', true);
    }
    const phoneDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    let patient = state.patientAccounts.find(row => row.phoneDigest === phoneDigest);
    if (!patient) {
      patient = { id: newId('PT'), displayName: '', phoneDigest, phoneSuffix: challenge.phone.slice(-4) };
      state.patientAccounts.push(patient);
      if (!save()) {
        state.patientAccounts.pop();
        return;
      }
    }
    if (previewServer && !writeLiveSession(livePhoneKey, { id: patient.id, phone: challenge.phone })) {
      return feedback('تعذّر حفظ جلسة التحقق التجريبية. حاول مرة أخرى.', true);
    }
    updatePhoneChallenge(null);
    setPatientSession(patient.id);
    const message = 'تم التحقق التجريبي من الهاتف.';
    if (role === 'account' && currentTab) {
      navigate(patientAccessDestination(), message);
    } else renderRoute(message);
  } catch {
    if (form.isConnected) feedback('تعذّر التحقق على هذا الجهاز. حاول مرة أخرى.', true);
  } finally {
    control.disabled = false;
    form.removeAttribute('aria-busy');
  }
}

function patientBooking() {
  const counts = previewSessionCounts();
  const available = visiblePreviewSessions(clinic).filter(row => canBookPreviewSession(row, counts));
  if (!chosenBookingSession && available.length) {
    return card('اختر الموعد', `<form id="booking-select">${field('الممارس والموعد',
      `<select name="session" required><option value="">اختر موعدًا</option>${available.map(row => option(row.id, sessionLabel(row))).join('')}</select>`)}
      <button>متابعة</button></form>`);
  }

  const patient = activePatient();
  const interrupted = connectedRetry(patient, chosenBookingSession);
  const selected = interrupted ? sessions().find(row => row.id === chosenBookingSession)
    : available.find(row => row.id === chosenBookingSession);
  if (!selected) return bookingUnavailable(session(chosenBookingSession));
  if (!patient) return phoneJourney(selected);
  return appointmentSummary(selected) + card('بيانات المراجع', `<form id="booking">
    ${field('اسم المراجع التجريبي', `<input name="name" required minlength="2" maxlength="50" autocomplete="off"
      value="${html(interrupted?.name ?? patient.displayName)}" placeholder="مراجع تجربة"${interrupted ? ' readonly' : ''}>`)}
    <p class="meta">${interrupted ? 'أعد إرسال الطلب نفسه للتحقق من نتيجته.'
      : 'يظهر طلبك في «مواعيدي». تراجع العيادة الطلب قبل تأكيد الموعد.'}</p>
    <button>${interrupted ? 'إعادة محاولة الإرسال' : 'إرسال طلب الحجز'}</button></form>`);
}

const patientBookingHash = (tab, row) => routeHash('patient', tab, row.clinic) + '/' + row.id;
const inactiveBooking = row => ['completed', 'denied', 'cancelled', 'left'].includes(row.status);
const ownedPreviewBooking = id => bookings().find(row => row.id === id && canViewBooking(row));
const latestPatientBooking = () => bookings().filter(row => canViewBooking(row)).at(-1);

function readBooking(form, fields) {
  const patient = activePatient();
  const name = String(fields.get('name') ?? '').trim();
  if (!patient || name.length < 2 || name.length > 50) return feedback('تحقق من اسم المراجع ثم أعد المحاولة.', true);
  const previous = bookings().find(row => row.sessionId === chosenBookingSession && row.patientId === patient.id && !inactiveBooking(row));
  if (previous) return navigate(patientBookingHash('follow', previous), 'سبق حفظ طلبك لهذا الموعد.');
  const retry = connectedRetry(patient, chosenBookingSession);
  const schedule = retry ? sessions().find(row => row.id === chosenBookingSession) : previewSessionFor(clinic, chosenBookingSession);
  if (!schedule) {
    render();
    return feedback('أصبح الموعد غير متاح. اختر وقتًا آخر.', true);
  }
  if (previewServer) return sendConnectedBooking(form, patient, schedule, name);
  const booking = {
    id: newId('DH'), name, clinic, sessionId: schedule.id, status: 'pending', ticket: null,
    patientId: patient.id, createdAt: now(),
  };
  const oldName = patient.displayName;
  if (!oldName) patient.displayName = name;
  state.bookings.push(booking);
  if (!record('حُفظ طلب الحجز · قيد المراجعة', clinic, 'patient/follow/' + booking.id)) {
    state.bookings.pop();
    patient.displayName = oldName;
  }
}

function patientFollowUp() {
  const row = currentBookingId ? ownedPreviewBooking(currentBookingId) : latestPatientBooking();
  if (!row) return card('متابعة الطلب', empty('لا يظهر هذا الطلب هنا', 'يمكنك متابعة حجوزات حسابك من «مواعيدي».'));
  const schedule = session(row.sessionId);
  return (schedule ? appointmentSummary(schedule) : '')
    + card('حالة الطلب', `<div class="record-heading">${pill(visitLabels[row.status], visitTones[row.status])}</div>
      <p class="meta">مرجع الحجز <bdi>${html(row.id)}</bdi></p>
      ${row.status === 'pending' ? '<p>بانتظار مراجعة العيادة. تابع التحديثات في «مواعيدي».</p>' : ''}
      ${row.ticket ? `<p class="ticket">رقم الدور <bdi>${row.ticket}</bdi></p>` : ''}`) + connectedTicketControl(row);
}

function patientHistory() {
  const patient = activePatient();
  const clinics = catalog();
  const previous = currentBookingId === 'past';
  const tabs = `<nav class="profile-tabs appointment-tabs" aria-label="عرض المواعيد">
    <a data-route data-selection href="${routeHash('patient', 'history')}"${previous ? '' : ' aria-current="page"'}>القادمة</a>
    <a data-route data-selection href="${routeHash('patient', 'history')}/past"${previous ? ' aria-current="page"' : ''}>السابقة</a></nav>`;
  const content = state.bookings.filter(row => canViewBooking(row, patient) && inactiveBooking(row) === previous)
    .slice().reverse().map(row => `<article class="card">${bookingInfo(row, clinics[row.clinic]?.name ?? row.name)}
      <div class="actions">${discoverButton('تفاصيل الموعد', patientBookingHash('detail', row), false)}</div></article>`).join('');
  const title = previous ? 'المواعيد السابقة' : 'المواعيد القادمة';
  const intro = patient ? '' : '<p class="meta">سجّل الدخول من «حسابي» لعرض حجوزات حسابك التجريبي.</p>';
  return tabs + (content || card(title, empty('لا توجد مواعيد هنا', 'تظهر طلباتك ومواعيدك بحسب حالة الزيارة.'))) + intro;
}

function canManagePreviewBooking(row) {
  return !previewServer && row && ['pending', 'confirmed'].includes(row.status) && visiblePreviewSessions(row.clinic).some(item => item.id === row.sessionId);
}

function patientAppointment() {
  const row = ownedPreviewBooking(currentBookingId);
  if (!row) return card('الموعد غير متاح', '<p>افتح الموعد من قائمة «مواعيدي» في حسابك.</p>');
  const schedule = session(row.sessionId);
  const controls = canManagePreviewBooking(row) ? card('إدارة الموعد', `<p class="meta">يمكن تغيير موعد التجربة أو إلغاؤه قبل الحضور. تراجع العيادة أي موعد بديل.</p>
    <div class="actions">${discoverButton('تغيير الموعد', patientBookingHash('change', row))}</div>
    <details class="manage-cancel"><summary>إلغاء الحجز</summary>
      <form id="appointment-cancel"><p>هل تريد إلغاء هذا الموعد؟</p><button class="danger">تأكيد الإلغاء</button></form>
    </details>`) : '';
  return (schedule ? appointmentSummary(schedule) : '') + card('حالة الحجز', bookingInfo(row)) + connectedTicketControl(row) + controls;
}

function alternativeSessions(row) {
  const original = session(row.sessionId);
  const counts = previewSessionCounts();
  return visiblePreviewSessions(clinic, original?.doctor).filter(item => item.id !== row.sessionId && canBookPreviewSession(item, counts));
}

function patientAppointmentChange() {
  const row = ownedPreviewBooking(currentBookingId);
  if (!canManagePreviewBooking(row)) return card('تعذّر تغيير الموعد', '<p>أصبح تغيير هذا الموعد غير متاح.</p>');
  const choices = alternativeSessions(row);
  if (!choices.length) return card('لا توجد أوقات بديلة', '<p>سيبقى موعدك الحالي محفوظًا.</p>');
  return card('موعد بديل مع الممارس نفسه', `<form id="appointment-change">
    ${field('اليوم والوقت', `<select name="session" required><option value="">اختر موعدًا</option>
      ${choices.map(item => option(item.id, previewAppointmentLabel(item))).join('')}</select>`)}
    <p class="meta">ينتقل الطلب إلى قيد المراجعة عند حفظ الوقت البديل.</p><button>إرسال التغيير</button>
    </form>`);
}

function updatePatientAppointment(fields, cancelling) {
  const row = ownedPreviewBooking(currentBookingId);
  if (!canManagePreviewBooking(row)) return feedback('تعذّر تعديل هذا الموعد.', true);
  const next = cancelling ? null : alternativeSessions(row).find(item => item.id === fields.get('session'));
  if (!cancelling && !next) return feedback('أصبح الموعد البديل غير متاح.', true);
  if (next && bookings().some(item => item !== row && item.patientId === row.patientId && item.sessionId === next.id && !inactiveBooking(item))) {
    return feedback('لديك طلب آخر في الوقت المختار.', true);
  }
  const original = { ...row };
  if (next) row.sessionId = next.id;
  row.status = cancelling ? 'cancelled' : 'pending';
  const message = cancelling ? 'تم إلغاء الحجز التجريبي.' : 'حُفظ الوقت البديل وأُرسل للمراجعة.';
  if (!record(message, clinic, 'patient/detail/' + row.id)) Object.assign(row, original);
}
