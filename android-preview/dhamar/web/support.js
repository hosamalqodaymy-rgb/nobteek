'use strict';

// Loaded before app.js. The support screens use the preview's local state and routing.
const supportTopics = {
  booking: 'الحجز والدور',
  account: 'حساب المراجع',
  clinic: 'إضافة عيادة',
  subscription: 'اشتراك العيادة',
  technical: 'مشكلة في التطبيق',
  other: 'استفسار آخر',
};
const supportStates = {
  open: ['بانتظار رد الدعم', 'pending'],
  answered: ['تم الرد', 'success'],
  closed: ['مغلقة', 'neutral'],
};
const helpQuestions = [
  ['booking', 'كيف أتابع الحجز ورقم الدور؟', 'افتح «مواعيدي» في شريط التنقل. يظهر رقم الدور بعد أن يسجّل الاستقبال حضورك.'],
  ['account', 'كيف أسجّل الدخول إلى حسابي؟', 'من «حسابي» أدخل رقم الجوال الوهمي ثم رمز الاختبار المعروض. يمكنك فتح حساب اختبار سابق من خيار الدخول الخاص به.'],
  ['clinic', 'كيف أضيف عيادتي إلى الدليل؟', 'من «حسابي»، افتح «أضف منشأتك» وأرسل طلب الإدراج ثم افتح «متابعة طلبات الإضافة». يظهر اسم العيادة في الدليل بعد اعتماد الطلب في تجربة مدير المنصة.'],
  ['subscription', 'أين أتابع إثبات اشتراك العيادة؟', 'من مساحة مالك العيادة اختر «الاشتراك». يراجع مدير المنصة الإثبات من «المالية».'],
  ['technical', 'كيف أجرّب المطابقة عند الانقطاع؟', 'افتح «التقارير والانقطاع» ثم تبويب «الانقطاع». جرّب تسجيل حضور مؤكد في السجل الورقي، وطابقه بعد إنهاء وضع الانقطاع.'],
  ['other', 'كيف أقرأ الرد على تذكرة الدعم؟', 'افتح «تذاكري» من مركز المساعدة في «حسابي». إذا فتحت تذكرة كضيف، استخدم رمز المتابعة الذي ظهر بعد الإرسال.'],
];

const supportTime = new Intl.DateTimeFormat('ar-YE', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Aden',
});
const supportTimestamp = time => html(supportTime.format(time));
let guestSupport = null;
let selectedSupportMember = 'PLAT-S1';
try { selectedSupportMember = sessionStorage.getItem('nobteek-support-member') || selectedSupportMember; } catch { /* The first demo operator is available. */ }

const currentSupportMember = () => membersFor('support').find(row => row.id === selectedSupportMember) ?? membersFor('support')[0];
const supportAssignee = ticket => membersFor('support').find(row => row.id === ticket.assignedTo);
const canHandleSupport = ticket => Boolean(currentSupportMember() && (!supportAssignee(ticket) || ticket.assignedTo === currentSupportMember().id));

function helpAnswers(query = '', topic = '') {
  const words = searchable(query).split(' ').filter(Boolean);
  const results = helpQuestions.filter(([category, question, answer]) => {
    const text = searchable(question + ' ' + answer);
    return (!topic || category === topic) && words.every(word => text.includes(word));
  });
  return results.map(([, question, answer]) => `<details class="help-answer">
    <summary>${html(question)}</summary><p>${html(answer)}</p>
    </details>`).join('') || empty('لا توجد إجابة مطابقة', 'جرّب كلمة أخرى مثل الحجز أو الاشتراك.');
}

function helpCenter() {
  return card('كيف نساعدك؟', `<div class="help-questions">
      ${field('ابحث في الأسئلة الشائعة', '<input id="help-search" type="search" maxlength="80" placeholder="مثال: رقم الدور">')}
      ${field('موضوع المساعدة', `<select id="help-topic"><option value="">كل الموضوعات</option>
        ${Object.entries(supportTopics).map(([id, label]) => option(id, label)).join('')}</select>`)}
      <div id="help-answers" aria-live="polite">${helpAnswers()}</div>
    </div>`)
    + card('التواصل مع الدعم', `<div class="actions">${routeLink('فتح تذكرة دعم', 'new-ticket')}${routeLink('تذاكري', 'tickets', '', 'secondary')}</div>`)
    + `<div class="actions">${routeLink('دليل التجربة', 'guide', '', 'secondary')}</div>`;
}

function updateHelpSearch() {
  document.querySelector('#help-answers').innerHTML = helpAnswers(
    document.querySelector('#help-search').value, document.querySelector('#help-topic').value);
}

function newSupportTicket() {
  const patient = activePatient();
  const identity = patient
    ? `<p class="meta">ستظهر التذكرة في حسابك التجريبي.</p>`
    : `<div class="patient-choice"><p>يمكنك الإرسال كضيف ومتابعة التذكرة برمز، أو حفظها في حسابك.</p>
       ${routeLink('تسجيل الدخول', 'account', 'new-ticket', 'secondary')}</div>`;
  return card('بيانات التذكرة', identity + `<form id="support-new">
    ${field('نوع الاستفسار', `<select name="topic" required><option value="">اختر نوع الاستفسار</option>
      ${Object.entries(supportTopics).map(([id, label]) => option(id, label)).join('')}</select>`)}
    ${field('عنوان التذكرة', '<input name="subject" required minlength="5" maxlength="80">')}
    ${field('وصف المشكلة', '<textarea name="body" rows="4" required minlength="10" maxlength="1000"></textarea>')}
    ${field('مرجع الحجز أو الطلب (اختياري)', '<input name="reference" maxlength="60" dir="auto">')}
    <p class="meta">استخدم بيانات وهمية. تجنّب إدخال معلومات المرضى أو كلمات المرور.</p>
    <button type="submit">إرسال التذكرة</button>
    </form>`);
}

const isSupportDesk = () => role === 'support' && !previewServer;

function readableSupportTicket() {
  const ticket = state.supportTickets.find(row => row.id === currentSupportId);
  if (!ticket) return null;
  if (isSupportDesk()) return canHandleSupport(ticket) ? ticket : null;
  if (role !== 'tickets') return null;
  const patient = activePatient();
  if (patient) return ticket.patientId === patient.id ? ticket : null;
  return ticket.patientId === null && ticket.id === guestSupport?.id ? ticket : null;
}

function supportHref(id, staff) {
  return staff ? routeHash('support', 'inbox') + '/' + id : routeHash('tickets', id);
}

function supportList(rows, staff = false) {
  const ordered = rows.slice().sort((a, b) =>
    (staff ? Number(b.status === 'open') - Number(a.status === 'open') : 0) || b.updatedAt - a.updatedAt);
  return `<ul class="support-list">${ordered.map(ticket => `<li>
    <a data-route class="support-list-item" href="${supportHref(ticket.id, staff)}">
      <div class="record-heading"><strong>${html(ticket.subject)}</strong>${pill(...supportStates[ticket.status])}</div>
      <span class="meta">${supportTopics[ticket.topic]} · <bdi>${html(ticket.id)}</bdi></span>
      <span class="meta">${staff ? html(supportAssignee(ticket)?.name ?? 'غير مسندة') + ' · ' : ''}${supportTimestamp(ticket.updatedAt)}</span>
    </a></li>`).join('')}</ul>`;
}

function supportTickets() {
  if (currentSupportId) return supportThread(readableSupportTicket(), false);
  const patient = activePatient();
  if (patient) {
    const closed = discoveryRoute.tab === 'closed';
    const rows = state.supportTickets.filter(ticket => ticket.patientId === patient.id && (ticket.status === 'closed') === closed);
    const tabs = `<nav class="profile-tabs appointment-tabs" aria-label="تصفية تذاكري">
      <a data-route data-selection href="${routeHash('tickets')}"${closed ? '' : ' aria-current="page"'}>المفتوحة</a>
      <a data-route data-selection href="${routeHash('tickets', 'closed')}"${closed ? ' aria-current="page"' : ''}>المغلقة</a></nav>`;
    return tabs + card(closed ? 'التذاكر المغلقة' : 'التذاكر المفتوحة', rows.length ? supportList(rows)
      : empty('لا توجد تذاكر في هذه القائمة', 'تظهر هنا تذاكرك بحسب حالتها.'));

  }

  const guestTicket = state.supportTickets.find(ticket => ticket.patientId === null && ticket.id === guestSupport?.id);
  const recent = guestTicket ? card('تذكرة الضيف الحالية', supportList([guestTicket])) : '';
  return recent + card('متابعة تذكرة ضيف', `<form id="support-guest">
    ${field('رمز المتابعة', '<input name="code" type="password" dir="ltr" required autocomplete="off" spellcheck="false" maxlength="48">')}
    <div class="actions"><button type="submit">عرض التذكرة</button>${routeLink('تسجيل الدخول', 'account', 'tickets', 'secondary')}</div>
    </form>`);
}

function filteredSupportDesk(status = '', query = '', mine = false) {
  const words = searchable(query).split(' ').filter(Boolean);
  const member = currentSupportMember();
  const rows = state.supportTickets.filter(ticket =>
    (!status || ticket.status === status) && (!mine || ticket.assignedTo === member?.id)
    && words.every(word => searchable(ticket.subject + ' ' + ticket.id + ' ' + ticket.reference).includes(word)));
  return rows.length ? supportList(rows, true) : empty('لا توجد تذاكر مطابقة', 'غيّر البحث أو حالة التذكرة.');
}

function supportDesk() {
  const member = currentSupportMember();
  if (!member) return card('صندوق الدعم', empty('لا توجد عضوية دعم نشطة', 'يمكن تفعيل عضوية من إدارة المنصة.'));
  if (currentSupportId) return supportThread(readableSupportTicket(), true);
  const today = dateLocal(new Date());
  const tickets = state.supportTickets;
  return roleMetrics([
    ['بانتظار الرد', tickets.filter(row => row.status === 'open').length],
    ['مسندة إليّ', tickets.filter(row => row.assignedTo === member.id && row.status !== 'closed').length],
    ['أُغلقت اليوم', tickets.filter(row => row.status === 'closed' && dateLocal(new Date(row.updatedAt)) === today).length],
  ]) + card('صندوق الدعم', `
    ${field('موظف الدعم التجريبي', `<select id="support-member">${membersFor('support').map(row => option(row.id, row.name, row.id === member.id)).join('')}</select>`)}
    ${field('ابحث بعنوان التذكرة أو مرجعها', '<input id="support-search" type="search" maxlength="80">')}
    ${field('حالة التذكرة', `<select id="support-status"><option value="">كل الحالات</option>
      ${Object.entries(supportStates).map(([id, [label]]) => option(id, label)).join('')}</select>`)}
    <label class="checkbox"><input type="checkbox" id="support-assigned-only"><span>المسندة إليّ</span></label>
    <div id="support-list" aria-live="polite">${filteredSupportDesk()}</div>`);
}

function selectSupportMember(id) {
  if (!isSupportDesk() || !membersFor('support').some(row => row.id === id)) return;
  selectedSupportMember = id;
  try { sessionStorage.setItem('nobteek-support-member', id); } catch { /* Keep the active selection in memory. */ }
  render();
  document.querySelector('#support-member')?.focus({ preventScroll: true });
}

function updateSupportDesk() {
  document.querySelector('#support-list').innerHTML = filteredSupportDesk(
    document.querySelector('#support-status').value, document.querySelector('#support-search').value,
    document.querySelector('#support-assigned-only').checked);
}

function supportAssignForm(ticket) {
  if (ticket.status === 'closed') return '';
  const staff = membersFor('support');
  const assignee = supportAssignee(ticket);
  return `<form id="support-assign">
    ${field('إسناد التذكرة إلى', `<select name="member" required><option value="">اختر موظفًا</option>
      ${staff.map(row => option(row.id, row.name, assignee?.id === row.id)).join('')}</select>`)}
    <button type="submit" class="secondary">حفظ الإسناد</button></form>`;
}

function assignSupportTicket(fields) {
  const ticket = isSupportDesk() ? readableSupportTicket() : null;
  const target = membersFor('support').find(row => row.id === fields.get('member'));
  if (!ticket || ticket.status === 'closed' || !target) return feedback('تعذّر إسناد هذه التذكرة.', true);
  if (ticket.assignedTo === target.id) return feedback('التذكرة مسندة إلى هذا الموظف بالفعل.');
  const updated = { ...ticket, assignedTo: target.id };
  return commitPreview({
    supportTickets: replacePreviewRow(state.supportTickets, updated),
    platformAudit: platformAudit('أُسندت تذكرة دعم', ticket.id),
  }, 'أُسندت التذكرة إلى ' + target.name + '.', target.id === currentSupportMember().id ? '' : routeHash('support', 'inbox'));
}

function supportThread(ticket, staff) {
  if (!ticket) return card('تعذّر فتح التذكرة', staff
    ? '<p class="meta">يفتح تفاصيل التذكرة موظف الدعم المسند إليه الطلب.</p>'
    : '<p class="meta">افتح تذكرتك باستخدام حسابك أو رمز المتابعة.</p>');

  const code = !staff && guestSupport?.id === ticket.id ? guestSupport.code : '';
  const tracking = code ? card('احتفظ برمز المتابعة', `<p>استخدم الرمز لفتح تذكرتك من جديد.</p>
    <p id="guest-tracking-code" class="support-code" dir="ltr">${html(code)}</p>`) : '';
  const messages = ticket.messages.map(({ author, body, at }) => {
    const sender = author === 'support' ? 'الدعم' : staff ? 'مقدّم التذكرة' : 'أنت';
    return `<li class="history support-message ${author === 'support' ? 'support-team' : ''}">
      <div class="record-heading"><strong>${sender}</strong><span class="meta">${supportTimestamp(at)}</span></div>
      <p dir="auto" class="support-body">${html(body)}</p></li>`;
  }).join('');
  const information = card(html(ticket.subject), `${pill(...supportStates[ticket.status])}
    <p class="meta">${supportTopics[ticket.topic]} · رقم التذكرة <bdi>${html(ticket.id)}</bdi></p>
    ${ticket.reference ? `<p class="meta">المرجع المرفق <bdi>${html(ticket.reference)}</bdi></p>` : ''}`);
  const reply = ticket.status === 'closed' ? '<p class="meta">أُغلقت التذكرة. يمكنك الرجوع إلى المحادثة هنا.</p>'
    : `<form id="support-reply">
      ${field('نص الرد', '<textarea name="body" rows="3" required minlength="2" maxlength="1000"></textarea>')}
      <div class="actions"><button type="submit">إرسال الرد</button>
      ${staff && ticket.status === 'answered' ? button('إغلاق التذكرة', 'support-close', '', 'secondary') : ''}</div>
      </form>`;
  const leave = !staff && ticket.patientId === null ? button('إخفاء تذكرة الضيف', 'support-leave-guest', '', 'secondary') : '';
  const assignment = staff ? card('الموظف المسند', `<p>${html(supportAssignee(ticket)?.name ?? 'غير مسندة')}</p>` + supportAssignForm(ticket)) : '';
  return tracking + information + assignment + card('المحادثة', `<ol class="support-conversation">${messages}</ol>` + reply)
    + (leave ? `<div class="actions">${leave}</div>` : '');
}

const hexBytes = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();

async function hashSupportCode(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return hexBytes(new Uint8Array(bytes));
}

async function submitSupportAccess(form, operation) {
  const submit = form.querySelector('button[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  try {
    await operation();
  } catch {
    if (form.isConnected) feedback('تعذّر فتح تذكرة الدعم. حاول مرة أخرى.', true);
  } finally {
    submit.disabled = false;
    form.removeAttribute('aria-busy');
  }
}

async function createSupportTicket(form, fields) {
  const topic = fields.get('topic');
  const subject = String(fields.get('subject') ?? '').trim();
  const body = String(fields.get('body') ?? '').trim();
  const reference = String(fields.get('reference') ?? '').trim();
  if (!Object.hasOwn(supportTopics, topic) || subject.length < 5 || subject.length > 80
      || body.length < 10 || body.length > 1000 || reference.length > 60) {
    return feedback('اختر النوع واكتب عنوانًا من 5 أحرف ووصفًا من 10 أحرف على الأقل.', true);
  }

  const patientId = activePatient()?.id ?? null;
  const code = patientId ? '' : hexBytes(crypto.getRandomValues(new Uint8Array(16)));
  const guestCodeHash = code ? await hashSupportCode(code) : '';
  if (!form.isConnected) return;
  const at = now();
  const ticket = {
    id: newId('SUP'), patientId, guestCodeHash, topic, subject, reference, status: 'open',
    updatedAt: at, messages: [{ author: 'requester', body, at }],
  };
  state.supportTickets.push(ticket);
  if (!save()) {
    state.supportTickets.pop();
    return;
  }
  if (code) guestSupport = { id: ticket.id, code: code.match(/.{8}/g).join('-') };
  navigate(supportHref(ticket.id, false), 'تم حفظ تذكرة الدعم.');
}

async function openGuestTicket(form, fields) {
  const code = String(fields.get('code') ?? '').normalize('NFKC').replace(/[\s-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(code)) return feedback('تحقّق من رمز المتابعة.', true);
  const digest = await hashSupportCode(code);
  if (!form.isConnected) return;
  const ticket = state.supportTickets.find(row => row.patientId === null && row.guestCodeHash === digest);
  if (!ticket) return feedback('تحقّق من رمز المتابعة.', true);
  guestSupport = { id: ticket.id, code: '' };
  navigate(supportHref(ticket.id, false));
}

function saveSupportUpdate(ticket, replacement, message) {
  const index = state.supportTickets.indexOf(ticket);
  state.supportTickets[index] = replacement;
  if (save()) navigate(supportHref(ticket.id, isSupportDesk()), message);
  else state.supportTickets[index] = ticket;
}

function replyToSupportTicket(fields) {
  const ticket = readableSupportTicket();
  if (!ticket || ticket.status === 'closed') return feedback('تعذّر إضافة رد إلى هذه التذكرة.', true);
  const body = String(fields.get('body') ?? '').trim();
  if (body.length < 2 || body.length > 1000) return feedback('اكتب ردًا من حرفين إلى 1000 حرف.', true);
  const staff = isSupportDesk();
  const at = now();
  const messages = [...ticket.messages, { author: staff ? 'support' : 'requester', body, at }];
  const next = { ...ticket, messages, status: staff ? 'answered' : 'open', updatedAt: at,
    assignedTo: staff ? currentSupportMember().id : ticket.assignedTo };
  saveSupportUpdate(ticket, next, 'تم حفظ الرد.');
}

function closeSupportTicket() {
  const ticket = isSupportDesk() ? readableSupportTicket() : null;
  if (!ticket || ticket.status !== 'answered') return feedback('يلزم الرد على التذكرة قبل إغلاقها.', true);
  saveSupportUpdate(ticket, { ...ticket, status: 'closed', updatedAt: now() }, 'تم إغلاق التذكرة.');
}
