'use strict';

const previewWeekdays = ['', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
const previewDateLabel = new Intl.DateTimeFormat('ar-YE', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'Asia/Aden' });
const previewShortDate = new Intl.DateTimeFormat('ar-YE', { day: 'numeric', month: 'short', timeZone: 'Asia/Aden' });
const previewClock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Aden' });
const previewTimeLabel = new Intl.DateTimeFormat('ar-YE', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Aden' });
const previewCalendar = (day, offset = 0) => new Date(Date.parse(day + 'T12:00:00Z') + offset * 86400000);
const weekDayFor = date => date.getUTCDay() || 7;
const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const asClock = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');

function buildDiscoverySessions(day) {
  const choices = [];
  for (const [clinicId, entry] of Object.entries(demoDirectory)) {
    if (!entry.bookingEnabled) continue;
    for (let offset = 0; offset < 7; offset++) {
      const date = previewCalendar(day, offset);
      const dateString = dateLocal(date);
      entry.profiles.forEach((provider, index) => {
        for (const [weekDay, start, end, duration] of provider.hours) {
          if (weekDay !== weekDayFor(date)) continue;
          const first = toMinutes(start);
          const anchors = new Set([first, first + duration, toMinutes(end) - duration]);
          for (const minute of anchors) {
            if (minute < first || minute + duration > toMinutes(end)) continue;
            choices.push({
              id: [clinicId, index, dateString, minute].join('-'), clinic: clinicId, doctor: provider.name,
              date: dateString, start: asClock(minute), end: asClock(minute + duration),
              capacity: 1, open: true, ticket: 0, directoryFixture: true,
            });
          }
        }
      });
    }
  }
  return choices;
}

function previewSessionCounts() {
  const counts = new Map();
  for (const booking of state.bookings) {
    if (!['pending', 'denied', 'cancelled'].includes(booking.status)) {
      counts.set(booking.sessionId, (counts.get(booking.sessionId) ?? 0) + 1);
    }
  }
  return counts;
}

function visiblePreviewSessions(clinicId = null, doctor = null) {
  const nowValue = new Date();
  const day = dateLocal(nowValue);
  const time = previewClock.format(nowValue);
  return state.sessions.filter(row => (!clinicId || row.clinic === clinicId) && (!doctor || row.doctor === doctor)
    && (row.date > day || (row.date === day && (row.directoryFixture ? row.start >= time : row.end > time))))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

const canBookPreviewSession = (row, counts) => row.open && confirmedPreviewOccupancy(row, counts) < row.capacity;
function previewSessionFor(clinicId, appointmentId) {
  return visiblePreviewSessions(clinicId).find(row => row.id === appointmentId && canBookPreviewSession(row, previewSessionCounts()));
}

const discoverIcons = {
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2M3 12c5 3 13 3 18 0m-11 2h4"/>',
  bookmark: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  search: '<circle cx="10.7" cy="10.7" r="6.5"/><path d="m16 16 4 4"/>',
  pin: '<path d="M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.2"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7zm4 11h4"/>',
  home: '<path d="m3 10 9-7 9 7v10H3zm6 10v-6h6v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-14 4h2m3 0h2m3 0h2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m3 9v-2a5 5 0 0 0-2-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 1-1 1-1 3m0 3h.01"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-5h6v5M8 7h2m4 0h2m-8 4h2m4 0h2"/>',
  settings: '<circle cx="12" cy="12" r="3.5"/><path d="m12 3 2 2 3-1 1 3 3 1-1 3 1 3-3 1-1 3-3-1-2 2-2-2-3 1-1-3-3-1 1-3-1-3 3-1 1-3 3 1z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
};
const discoverIcon = name => `<svg class="discovery-icon" viewBox="0 0 24 24" aria-hidden="true">${discoverIcons[name]}</svg>`;
const discoverLink = (title, to, classes = '', icon = '') => `<a class="${classes}" data-route href="${html(to)}">${icon ? discoverIcon(icon) : ''}<span>${html(title)}</span></a>`;
const discoverButton = (title, to, primary = true) => discoverLink(title, to, 'route-link' + (primary ? '' : ' secondary'));
const profilesFor = row => row.profiles ?? row.doctors.map(name => ({ name, specialty: row.specialty, hours: [] }));
const profileFor = (row, index) => profilesFor(row)[index] ?? null;
const specialtyText = row => (row.specialties ?? [row.specialty]).map(key => specialties[key]).filter(Boolean).join(' · ');
const previewDay = day => {
  const today = dateLocal(new Date());
  if (day === today) return 'اليوم';
  if (day === dateLocal(previewCalendar(today, 1))) return 'غدًا';
  return previewDateLabel.format(previewCalendar(day));
};
const displayTime = time => previewTimeLabel.format(new Date('2000-01-01T' + time + ':00+03:00'));
const windowTime = row => row.start === '00:00' && row.end === '23:59' ? 'نافذة طوال اليوم' : displayTime(row.start);
const previewAppointmentLabel = row => previewDay(row.date) + '، ' + windowTime(row);
const appointmentHash = (scene, id = '') => routeHash(scene, 'book') + (id ? '/' + id : '');
const dayPickerHash = (idx, day = '', id = '', clinicId = clinic) =>
  routeHash('slots', String(idx), clinicId) + (day ? '/' + day : '') + (id ? '/' + id : '');

function clinicPicture(entry, className = '') {
  if (!entry.photo) return `<span class="discovery-photo discovery-placeholder ${className}">${discoverIcon('building')}</span>`;
  const [image, row, col] = entry.photo;
  return `<span class="discovery-photo ${className}" role="img" aria-label="صورة منشأة توضيحية"
    style="background-image:url('discovery/${image}.webp');background-position:${col * 100/3}% ${row * 100/3}%"></span>`;
}

function practitionerAvatar(provider, clinicId = clinic) {
  if (clinicId === 'CLN-001' && provider.name === demoDirectory['CLN-001'].doctors[0]) {
    return '<span class="discovery-avatar photo-avatar" role="img" aria-label="صورة توضيحية للممارس"></span>';
  }
  return `<span class="discovery-avatar" aria-hidden="true">${html(provider.name.trim().slice(0, 1))}</span>`;
}

function doctorCard(provider, url, extra = '') {
  return `<a class="discovery-person" data-route href="${html(url)}">
    ${practitionerAvatar(provider)}<span class="discovery-label"><strong>${html(provider.name)}</strong>
    <span class="meta">${html(specialties[provider.specialty])}${extra ? ' · ' + html(extra) : ''}</span></span>${discoverIcon('left')}</a>`;
}

const filterKey = 'nobteek-discovery-filters';
const discoveryFilters = { query: '', specialty: '', area: '', today: false };
try {
  const savedFilters = JSON.parse(sessionStorage.getItem(filterKey));
  if (savedFilters && typeof savedFilters === 'object') {
    for (const key of ['query', 'specialty', 'area']) if (typeof savedFilters[key] === 'string') discoveryFilters[key] = savedFilters[key];
    discoveryFilters.today = savedFilters.today === true;
  }
} catch { /* Discovery works without saved filters. */ }

function browseDirectory() {
  const areaOptions = [...new Set(Object.values(catalog()).map(row => row.area))];
  return `<div class="discovery">
    <label class="discovery-search"><span class="sr-only">ابحث باسم الطبيب أو التخصص أو العيادة</span>${discoverIcon('search')}
      <input id="directory-search" type="search" autocomplete="off" maxlength="80" value="${html(discoveryFilters.query)}" placeholder="ابحث باسم الطبيب أو التخصص أو العيادة"></label>
    <div class="discovery-filters" aria-label="تصفية العيادات">
      <label class="today-filter"><input id="directory-today" type="checkbox"${discoveryFilters.today ? ' checked' : ''}>
        ${discoverIcon('calendar')}<span>اليوم</span></label>
      <label><span class="sr-only">التخصص</span><select id="directory-specialty"><option value="">التخصص</option>
        ${Object.entries(specialties).map(([id, title]) => option(id, title, id === discoveryFilters.specialty)).join('')}</select></label>
      <label><span class="sr-only">المنطقة</span><select id="directory-area"><option value="">المنطقة</option>
        ${areaOptions.map(area => option(area, area, area === discoveryFilters.area)).join('')}</select></label>
    </div>
    <div id="directory-results" aria-live="polite">${discoveryResults()}</div>
  </div>`;
}

function updateBrowseDirectory() {
  discoveryFilters.query = document.querySelector('#directory-search').value;
  discoveryFilters.specialty = document.querySelector('#directory-specialty').value;
  discoveryFilters.area = document.querySelector('#directory-area').value;
  discoveryFilters.today = document.querySelector('#directory-today').checked;
  try { sessionStorage.setItem(filterKey, JSON.stringify(discoveryFilters)); } catch { /* Continue in memory. */ }
  document.querySelector('#directory-results').innerHTML = discoveryResults();
}

function discoveryResults() {
  const { query, specialty, area, today } = discoveryFilters;
  const words = searchable(query).split(' ').filter(Boolean);
  const counts = previewSessionCounts();
  const openings = new Map();
  const todayDate = dateLocal(new Date());
  const clinics = catalog();
  for (const row of visiblePreviewSessions()) {
    if ((today && row.date !== todayDate) || !canBookPreviewSession(row, counts)) continue;
    if (!openings.has(row.clinic)) openings.set(row.clinic, row);
  }
  const matches = Object.entries(clinics).filter(([, row]) => {
    const description = searchable([row.name, row.area, specialtyText(row), ...row.doctors].join(' '));
    return (!specialty || (row.specialties ?? [row.specialty]).includes(specialty))
      && (!area || row.area === area) && words.every(word => description.includes(word));
  }).filter(([id]) => !today || openings.has(id));

  const byAvailability = id => {
    const first = openings.get(id);
    return first ? first.date + first.start : '9999';
  };
  const filtered = Boolean(words.length || specialty || area || today);
  matches.sort(([a], [b]) => Number(Object.hasOwn(demoDirectory, b)) - Number(Object.hasOwn(demoDirectory, a))
    || byAvailability(a).localeCompare(byAvailability(b)));

  if (!matches.length) return empty('لا توجد نتائج مطابقة', 'جرّب اسمًا أقصر أو غيّر التخصص أو المنطقة.');
  const first = matches.find(([id]) => (previewServer || Object.hasOwn(demoDirectory, id)) && openings.has(id));
  const featured = first && !filtered ? discoveryHighlight(first, openings.get(first[0])) : '';
  const title = filtered ? ('نتائج البحث · ' + matches.length) : 'عيادات في ذمار';
  return featured + `<div class="discovery-section"><h2>${html(title)}</h2>`
    + `<ul class="discovery-clinics">${matches.map(([id, row]) => {
      const opening = openings.get(id);
      return `<li><a class="clinic-card discovery-clinic" data-route href="${routeHash('clinic', '', id)}">
        ${clinicPicture(row)}<span class="discovery-label"><strong>${html(row.name)}</strong><span class="meta">${html(specialtyText(row) + ' · ' + row.area)}</span>
        ${opening ? pill(previewAppointmentLabel(opening), 'success') : pill('لا توجد مواعيد متاحة', 'neutral')}</span>${discoverIcon('left')}
        </a></li>`;
    }).join('')}</ul></div>`;
}

function discoveryHighlight([id, row], appointment) {
  const idx = row.doctors.indexOf(appointment.doctor);
  const provider = profileFor(row, idx);
  if (!provider) return '';
  return `<section class="discovery-section"><h2>أقرب موعد متاح</h2>
    <div class="discovery-highlight">
      <div class="discovery-feature-time"><strong>${html(previewAppointmentLabel(appointment))}</strong>
      <span class="specialty-tag">${html(specialties[provider.specialty])}</span></div>
      <div class="discovery-feature-person">${practitionerAvatar(provider, id)}<span><strong>${html(provider.name)}</strong>
       <span>${html(row.name + ' · ' + row.area)}</span></span></div>
      ${discoverLink('عرض الموعد', dayPickerHash(idx, appointment.date, appointment.id, id), 'route-link discover-highlight-cta', 'calendar')}
    </div></section>`;
}

function profileTabs(selected) {
  return `<nav class="profile-tabs" aria-label="صفحات ملف العيادة">
  ${[['', 'نظرة عامة'], ['doctors', 'الأطباء'], ['hours', 'الدوام']].map(([value, title]) =>
    `<a data-route data-selection href="${routeHash('clinic', value)}"${selected === value ? ' aria-current="page"' : ''}>${title}</a>`).join('')}
  </nav>`;
}

function clinicDiscoverProfile() {
  const row = catalog()[clinic];
  const selected = ['doctors', 'hours'].includes(discoveryRoute.tab) ? discoveryRoute.tab : '';
  const providers = profilesFor(row);
  const counts = previewSessionCounts();
  const first = visiblePreviewSessions(clinic).find(item => canBookPreviewSession(item, counts));
  const list = `<div class="discovery-people">${providers.map((p, i) =>
    doctorCard(p, routeHash('practitioner', String(i)), p.hours.length ? '' : 'بيانات اختبار')).join('')}</div>`;
  const index = first ? row.doctors.indexOf(first.doctor) : -1;
  const button = first ? discoverButton('احجز موعدًا', dayPickerHash(index, first.date), true) : '';
  const people = selected === 'doctors' ? `<section class="discovery-section"><h2>فريق العيادة</h2>${list}</section>` : '';
  const overview = selected === '' ? card('عن العيادة', `<dl class="discovery-info">
    <div><dt>التخصصات</dt><dd>${html(specialtyText(row))}</dd></div>
    <div><dt>الموقع</dt><dd>${html(row.address ?? row.area)}</dd></div>
    <div><dt>أقرب موعد تجريبي</dt><dd>${first ? html(previewAppointmentLabel(first)) : 'لا توجد مواعيد متاحة'}</dd></div>
  </dl>`) : '';
  const hours = selected === 'hours' ? card('الدوام الأسبوعي', providers.map(p => `<section class="discovery-hours">
    <h3>${html(p.name)}</h3>${providerHours(p)}</section>`).join('')) : '';
  return `<div class="discovery">${clinicPicture(row, 'discovery-cover')}
    ${profileTabs(selected)}${overview}${hours}${people}</div>${button ? `<div class="discovery-fixed">${button}</div>` : ''}`;
}

function providerHours(provider) {
  if (!provider.hours.length) return '<p class="meta">تحدد العيادة المواعيد حسب الجلسات المفتوحة.</p>';
  const order = day => (day + 1) % 7;
  return `<ul class="discovery-hours-list">${provider.hours.slice().sort((a,b) => order(a[0]) - order(b[0])).map(([day, start, end]) =>
    `<li><span>${previewWeekdays[day]}</span><bdi dir="ltr">${start}–${end}</bdi></li>`).join('')}</ul>`;
}

let discoveryRoute = { tab: '', day: '', appointment: '' };
function routeProviderIndex() {
  return /^\d+$/.test(discoveryRoute.tab) ? Number(discoveryRoute.tab) : -1;
}

function providerProfile() {
  const row = catalog()[clinic];
  const index = routeProviderIndex();
  const provider = profileFor(row, index);
  if (!provider) return empty('ملف الممارس غير متاح', 'ارجع إلى ملف العيادة واختر ممارسًا.');
  const counts = previewSessionCounts();
  const first = visiblePreviewSessions(clinic, provider.name).find(item => canBookPreviewSession(item, counts));
  return `<div class="discovery">
    <div class="discovery-profile">${practitionerAvatar(provider)}<div><strong>${html(provider.name)}</strong>
      <p class="meta">${html(specialties[provider.specialty])} · ممارس تجريبي</p></div></div>
    ${card('مكان الزيارة', `<p>${html(row.name)}</p><p class="meta">${html(row.address ?? row.area)}</p>`)}
    ${card('الدوام الأسبوعي', providerHours(provider))}
  </div>${first ? `<div class="discovery-fixed">${discoverButton('اختيار موعد', dayPickerHash(index, first.date))}</div>`
    : card('المواعيد', empty('لا توجد مواعيد متاحة', 'يمكنك الرجوع إلى فريق العيادة لاختيار ممارس آخر.'))}`;
}

function appointmentPicker() {
  const row = catalog()[clinic];
  const index = routeProviderIndex();
  const provider = profileFor(row, index);
  if (!provider) return empty('ملف الممارس غير متاح', 'اختر ممارسًا من ملف العيادة.');
  const times = visiblePreviewSessions(clinic, provider.name);
  const counts = previewSessionCounts();
  const selectedDay = times.find(item => item.date === discoveryRoute.day)?.date
    ?? times.find(item => canBookPreviewSession(item, counts))?.date ?? dateLocal(new Date());
  const appointment = times.find(item => item.date === selectedDay && item.id === discoveryRoute.appointment && canBookPreviewSession(item, counts));
  const days = [...new Set(times.map(item => item.date))];
  const today = dateLocal(new Date());
  const tomorrow = dateLocal(previewCalendar(today, 1));
  const dayTabs = days.map(day => {
    const date = previewCalendar(day);
    const label = day === today ? 'اليوم' : day === tomorrow ? 'غدًا' : previewWeekdays[weekDayFor(date)];
    return `<a data-route data-selection href="${dayPickerHash(index, day)}"${selectedDay === day ? ' aria-current="date"' : ''}>
      <strong>${label}</strong><time datetime="${day}">${html(previewShortDate.format(date))}</time></a>`;
  }).join('');
  const list = times.filter(item => item.date === selectedDay).map(item => canBookPreviewSession(item, counts)
    ? `<a data-route data-selection href="${dayPickerHash(index, selectedDay, item.id)}"${appointment?.id === item.id ? ' aria-current="true"' : ''}>${html(windowTime(item))}</a>`
    : `<span aria-disabled="true">${html(windowTime(item))}<small>${item.open ? 'ممتلئ' : 'مغلق'}</small></span>`).join('');

  return `<div class="discovery"><div class="discovery-profile">${practitionerAvatar(provider)}<div><strong>${html(provider.name)}</strong>
    <p class="meta">${html(row.name + ' · ' + specialties[provider.specialty])}</p></div></div>
    ${days.length ? card('اختر اليوم', '<div class="discovery-days">' + dayTabs + '</div>') : ''}
    ${card('اختر الوقت', list ? '<div class="discovery-times">' + list + '</div>'
      : empty('لا توجد مواعيد متاحة', 'جرّب تاريخًا آخر عند فتح جلسات الممارس.'))}
    ${appointment ? card('الموعد المختار', `<p>${html(previewAppointmentLabel(appointment))}</p>`) : ''}
    </div><div class="discovery-fixed">${appointment ? discoverButton('متابعة', appointmentHash('patient', appointment.id))
      : '<button type="button" disabled>متابعة</button>'}</div>`;
}

function accountOptions() {
  const links = [
    ['المساعدة', 'help', 'help'],
    ['أضف منشأتك', 'apply', 'building'],
    [previewServer?.support ? (previewServer.signedIn ? 'حساب نوبتيك' : 'تسجيل دخول نوبتيك') : 'مساحات العمل', '', 'grid'],
    ['الإعدادات', 'settings', 'settings'],
  ];
  return `<div class="account-options">${links.filter(([, dest]) => !previewServer || dest !== 'apply').map(([title, dest, icon]) => {
    const serverUrl = !dest ? previewServer?.workspace : dest === 'help' ? previewServer?.support : null;
    return `<a ${serverUrl ? `href="${html(serverUrl)}"` : `data-route href="${routeHash(dest)}"`}>
      ${discoverIcon(icon)}<strong>${title}</strong>${discoverIcon('left')}</a>`;
  }).join('')}</div>`;
}

const textSizeKey = 'nobteek-preview-large-text';
function setupPreviewText() {
  try { document.documentElement.classList.toggle('large-text', localStorage.getItem(textSizeKey) === '1'); } catch { /* Standard text size. */ }
}
function togglePreviewText(button) {
  const expanded = document.documentElement.classList.toggle('large-text');
  button.setAttribute('aria-pressed', String(expanded));
  try { localStorage.setItem(textSizeKey, expanded ? '1' : '0'); } catch { /* Keep current text size. */ }
}
function previewSettings() {
  return card('حجم العرض', `<button class="secondary" type="button" id="zoom-toggle" data-action="preview-text-size"
     aria-pressed="${document.documentElement.classList.contains('large-text')}">تكبير النص</button>`);
}

function previewNotifications() {
  const patientId = activePatient()?.id ?? null;
  const latest = [];
  if (state.notificationPrefs.bookings) {
    const clinics = catalog();
    latest.push(...state.bookings.filter(row => canViewBooking(row)).slice(-8).reverse().map(row =>
      `<article class="history"><strong>${html(visitLabels[row.status])}</strong><p class="meta">${html(clinics[row.clinic]?.name)} · <bdi>${html(row.id)}</bdi></p></article>`));
  }
  if (patientId && state.notificationPrefs.support) {
    latest.push(...state.supportTickets.filter(row => row.patientId === patientId && ['answered', 'closed'].includes(row.status)).slice(-5).reverse().map(row =>
      `<article class="history"><a data-route class="notice-link" href="${supportHref(row.id, false)}"><strong>${row.status === 'closed' ? 'أُغلقت تذكرة الدعم' : 'رد جديد على تذكرة الدعم'}</strong>
        <span class="meta"><bdi>${html(row.id)}</bdi></span></a></article>`));
    latest.push(...state.clinicApplications.filter(row => canViewClinicRequest(row) && row.status === 'revision').slice(-5).reverse().map(row =>
      `<article class="history"><a data-route class="notice-link" href="${routeHash('applications')}"><strong>استكمال طلب منشأة</strong><span class="meta">${html(row.name)}</span></a></article>`));
  }
  if (!previewServer && patientId && state.notificationPrefs.jobs) latest.push(...jobNoticeRows(patientId));
  return card('التحديثات الأخيرة', latest.join('') || empty('لا توجد تنبيهات', 'تظهر هنا تحديثات طلباتك في التجربة.'))
    + card('تفضيلات العرض', `<label class="checkbox"><input type="checkbox" data-preview-alert="bookings"${state.notificationPrefs.bookings ? ' checked' : ''}> <span>الحجز والدور</span></label>
    <label class="checkbox"><input type="checkbox" data-preview-alert="support"${state.notificationPrefs.support ? ' checked' : ''}> <span>ردود الدعم</span></label>
    ${previewServer ? '' : `<label class="checkbox"><input type="checkbox" data-preview-alert="jobs"${state.notificationPrefs.jobs ? ' checked' : ''}> <span>الوظائف الصحية</span></label>`}`);
}
