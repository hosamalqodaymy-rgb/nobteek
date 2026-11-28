'use strict';

const platformRoleLabels = { support: 'الدعم', finance: 'المالية', admin: 'مدير المنصة' };
function seedPlatformMembers() {
  return [
    { id: 'PLAT-S1', name: 'هبة الوادي', role: 'support', active: true },
    { id: 'PLAT-S2', name: 'سامي الحقلي', role: 'support', active: true },
    { id: 'PLAT-F1', name: 'مها السنبلي', role: 'finance', active: true },
    { id: 'PLAT-A1', name: 'مسؤول المنصة التجريبي', role: 'admin', active: true },
  ];
}

const membersFor = (type, activeOnly = true) =>
  state.platformMembers.filter(row => row.role === type && (!activeOnly || row.active));

function commitPreview(changes, message, destination = '') {
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, state[key]]));
  Object.assign(state, changes);
  if (!save()) {
    Object.assign(state, previous);
    return false;
  }
  if (destination) navigate(destination, message);
  else {
    render();
    feedback(message);
  }
  return true;
}

const replacePreviewRow = (rows, next) => rows.map(row => row.id === next.id ? next : row);
const platformAudit = (label, reference) => [...state.platformAudit.slice(-59), { label, reference, at: now() }];

function platformHistory(limit = 8) {
  const items = state.platformAudit.slice(-limit).reverse();
  return items.length ? items.map(row => `<article class="history">
    <strong>${html(row.label)}</strong><p class="meta"><bdi>${html(row.reference)}</bdi> · ${supportTimestamp(row.at)}</p></article>`).join('')
    : empty('لا توجد مراجعات مسجلة', 'تظهر هنا آخر قرارات المنشآت والعضويات والمالية.');
}

function platformHome() {
  const pending = state.clinicApplications.filter(row => row.status === 'pending').length;
  const invoices = state.invoices.filter(row => row.status === 'submitted').length;
  const adverts = state.jobAdverts.filter(row => row.state === 'pending').length;
  const sections = [
    ['المنشآت والفروع', 'طلبات التحقق والإدراج', 'clinics', 'building'],
    ['الأعضاء والأدوار', 'العضويات ونطاق الدور', 'roles', 'users'],
    ['المالية', 'الاشتراكات ورسوم المحاكاة', 'finance', 'file'],
    ['إشراف الوظائف', 'الإعلانات والبلاغات', 'jobs-review', 'briefcase'],
  ];
  return roleMetrics([['طلبات منشآت', pending], ['إثباتات اشتراك', invoices], ['إعلانات للمراجعة', adverts]])
    + `<div class="account-options platform-options">${sections.map(([label, detail, destination, icon]) =>
      `<a data-route href="${routeHash('admin', destination)}">${discoverIcon(icon)}
        <strong>${label}<small>${detail}</small></strong>${discoverIcon('left')}</a>`).join('')}</div>`
    + card('آخر المراجعات', platformHistory());
}

function platformRolesPage() {
  const clinics = catalog();
  const items = state.platformMembers.map(member => ({
    ...member, description: platformRoleLabels[member.role], toggle: member.role === 'support',
  })).concat(state.teamInvitations.map(invite => ({
    ...invite, description: staffRoleLabels[invite.role] + ' · ' + (clinics[invite.clinic]?.branch ?? clinics[invite.clinic]?.name ?? ''),
    invite: true,
  })));
  return card('نطاق العضويات', `${field('ابحث باسم العضو أو المنشأة', '<input id="platform-role-search" type="search" maxlength="80">')}
    ${items.map(row => `<article class="history" data-platform-member="${html(searchable(row.name + ' ' + row.description))}">
      <div class="record-heading"><strong>${html(row.name)}</strong>${pill(row.invite ? 'دعوة معلّقة' : row.active ? 'نشط' : 'موقوف', row.invite ? 'pending' : row.active ? 'success' : 'neutral')}</div>
      <p class="meta">${html(row.description)}</p>
      ${row.toggle ? button(row.active ? 'إيقاف عضوية الدعم' : 'تفعيل عضوية الدعم', 'platform-member-toggle', row.id, 'secondary') : ''}
    </article>`).join('')}
    <p class="meta" id="platform-role-empty" role="status" hidden>لا توجد عضويات مطابقة.</p>`)
    + card('سجل تغييرات الأدوار', platformHistory());
}

function filterPlatformRoles(query) {
  const matches = searchable(query);
  const items = [...screen.querySelectorAll('[data-platform-member]')];
  for (const item of items) item.hidden = !item.dataset.platformMember.includes(matches);
  screen.querySelector('#platform-role-empty').hidden = items.some(item => !item.hidden);
}

function togglePlatformMember(id) {
  if (role !== 'admin' || currentTab !== 'roles' || previewServer) return;
  const member = membersFor('support', false).find(row => row.id === id);
  if (!member) return;
  if (member.active && membersFor('support').length <= 1) return feedback('أبقِ عضو دعم واحدًا على الأقل نشطًا للتجربة.', true);
  const label = member.active ? 'أوقفت عضوية الدعم' : 'أعيد تفعيل عضوية الدعم';
  return commitPreview({
    platformMembers: replacePreviewRow(state.platformMembers, { ...member, active: !member.active }),
    platformAudit: platformAudit(label, member.id),
  }, label + ' · ' + member.name);
}

function platformFinance() {
  const tab = discoveryRoute.day;
  const sections = [['', 'قيد المراجعة'], ['history', 'سجل الفواتير'], ['placements', 'رسوم التوظيف']];
  const controls = `<nav class="profile-tabs" aria-label="عرض الفواتير">${sections.map(([id, label]) =>
    `<a data-route data-selection href="${routeHash('admin', 'finance') + (id ? '/' + id : '')}"${tab === id ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
  if (tab !== 'placements') return controls + adminPage(tab !== 'history');
  const fees = state.placementFees.slice().reverse().map(fee => placementFeeCard(fee, hiringCase(fee.applicationId)?.title, true));
  return controls + (fees.join('') || card('رسوم التوظيف التجريبية',
    empty('لا توجد رسوم مسجلة', 'تظهر كل فاتورة بعد تأكيد المباشرة من الطرفين.')));
}

function returnProofForChanges(fields, id) {
  if (role !== 'admin' || currentTab !== 'finance') return;
  const invoice = state.invoices.find(row => row.id === id && row.status === 'submitted');
  const reason = textFrom(fields, 'reason');
  if (!invoice || reason.length < 4 || reason.length > 160) return feedback('أدخل ملاحظة استكمال من 4 إلى 160 حرفًا.', true);
  return commitPreview({
    invoices: replacePreviewRow(state.invoices, { ...invoice, status: 'returned', reviewNote: reason }),
    platformAudit: platformAudit('طُلب استكمال إثبات اشتراك', id),
  }, 'حُفظ طلب استكمال الإثبات.');
}

function reviewPlacementFee(id) {
  if (role !== 'admin' || currentTab !== 'finance' || discoveryRoute.day !== 'placements') return;
  const fee = state.placementFees.find(row => row.id === id && row.simulated && !row.reviewedAt);
  if (!fee) return;
  return commitPreview({
    placementFees: replacePreviewRow(state.placementFees, { ...fee, reviewedAt: now() }),
    platformAudit: platformAudit('رُوجعت فاتورة توظيف تجريبية', fee.id),
  }, 'تم تسجيل المراجعة المالية التجريبية.');
}
