'use strict';

const jobTitles = {
  vacancy: 'تفاصيل الشاغر', profile: 'ملفي المهني', saved: 'الفرص المحفوظة', my: 'طلباتي',
  apply: 'مراجعة التقديم', application: 'متابعة التوظيف', seeker: 'إعلان بحث عن عمل',
};
const jobBookmarkList = () => state.jobBookmarks[activePatient()?.id ?? 'guest'] ?? [];
const jobStatus = row => row.state === 'published' && !advertIsOpen(row) ? ['انتهت مدة الإعلان', 'neutral'] : advertStates[row.state];

function jobLink(title, tab, id = '', icon = '') {
  return discoverLink(title, patientJobHash(tab, id), 'route-link secondary', icon);
}

function accountForJob(label, purpose, id = '') {
  return card('أكمل الدخول', '<p>سجّل الدخول بالحساب التجريبي للمتابعة.</p><div class="actions">'
    + discoverButton(label, routeHash('account', purpose) + (id ? '/' + id : '')) + '</div>');
}

function jobMeta(row) {
  return [jobProfessions[row.profession], row.specialty, row.area, jobWorkTypes[row.workType]].filter(Boolean).join(' · ');
}

function jobResultRows(kind, filters = {}) {
  const words = searchable(filters.query ?? '').split(' ').filter(Boolean);
  const rows = state.jobAdverts.filter(row => row.kind === kind && advertIsOpen(row)
    && (!filters.profession || row.profession === filters.profession)
    && (!filters.work || row.workType === filters.work) && (!filters.area || row.area === filters.area)
    && words.every(word => searchable(row.title + ' ' + jobMeta(row) + ' ' + (kind === 'vacancy' ? publisherName(row) : '')).includes(word)));
  const entries = rows.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(row => {
    const href = kind === 'vacancy' ? patientJobHash('vacancy', row.id) : employerJobHash('talent', row.id);
    const subtitle = kind === 'vacancy' ? publisherName(row) : 'بطاقة مهنية';
    return `<li><a class="job-listing" data-route href="${href}">
      <span class="job-tile-icon">${discoverIcon(kind === 'vacancy' ? 'briefcase' : 'user')}</span>
      <span><strong>${html(row.title)}</strong><small>${html(subtitle)}</small>
        <small>${html(jobMeta(row))}</small></span>${discoverIcon('left')}</a></li>`;
  }).join('');
  return entries ? '<ul class="job-list">' + entries + '</ul>'
    : empty(kind === 'vacancy' ? 'لا توجد شواغر مطابقة' : 'لا توجد بطاقات مهنية مطابقة', 'جرّب نطاق بحث مختلفًا.');
}

function jobFilters(kind) {
  const areas = [...new Set(state.jobAdverts.filter(row => row.kind === kind && advertIsOpen(row)).map(row => row.area))];
  return `<section class="card job-filters">
    ${field('ابحث بمسمى أو تخصص', '<input id="jobs-search" type="search" maxlength="80" placeholder="مثال: مختبرات">')}
    <div class="job-filter-grid">
      ${field('المهنة', `<select id="jobs-profession"><option value="">كل المهن</option>
        ${Object.entries(jobProfessions).map(([value, label]) => option(value, label)).join('')}</select>`)}
      ${field('الدوام', `<select id="jobs-work-type"><option value="">الكل</option>
        ${Object.entries(jobWorkTypes).map(([value, label]) => option(value, label)).join('')}</select>`)}
      ${field('المنطقة', `<select id="jobs-area"><option value="">كل المناطق</option>${areas.map(area => option(area, area)).join('')}</select>`)}
    </div></section><div id="jobs-results" data-kind="${kind}" aria-live="polite">${jobResultRows(kind)}</div>`;
}

function updateJobResults() {
  const results = screen.querySelector('#jobs-results');
  if (!results) return;
  results.innerHTML = jobResultRows(results.dataset.kind, {
    query: screen.querySelector('#jobs-search').value, profession: screen.querySelector('#jobs-profession').value,
    work: screen.querySelector('#jobs-work-type').value, area: screen.querySelector('#jobs-area').value,
  });
}

function jobsHome() {
  return `<div class="account-options job-quick-links">
    <a data-route href="${patientJobHash('profile')}">${discoverIcon('user')}<strong>ملفي المهني</strong></a>
    <a data-route href="${patientJobHash('my')}">${discoverIcon('file')}<strong>طلباتي</strong></a>
    <a data-route href="${patientJobHash('saved')}">${discoverIcon('bookmark')}<strong>المحفوظة</strong></a>
  </div><h2 class="job-section-heading">شواغر المنشآت</h2>` + jobFilters('vacancy');
}

function jobSummary(row) {
  const employer = row.kind === 'vacancy' ? publisherName(row) : 'بطاقة بحث عن عمل';
  return card(html(row.title), `<div class="record-heading"><strong>${html(employer)}</strong>${pill(...jobStatus(row))}</div>
    <p class="meta">${html(jobMeta(row))}</p>
    ${row.branch ? `<p>الفرع · ${html(row.branch)}</p>` : ''}
    ${row.kind === 'seeker' ? `<p>سنوات الخبرة · ${arabicCount(row.experience)}</p>` : ''}
    <p class="meta">آخر يوم ${html(absoluteDate(row.deadline))}</p>
    <p class="support-body">${html(row.description)}</p>
    ${row.requirements ? `<h3>شروط التقديم</h3><p class="support-body">${html(row.requirements)}</p>` : ''}`);
}

function vacancyPage() {
  const row = jobAdvert(discoveryRoute.day);
  if (row?.kind !== 'vacancy' || !advertIsOpen(row)) return card('الشاغر غير متاح', '<p>راجع الشواغر المتاحة في قسم الوظائف.</p>');
  const patient = activePatient();
  const previous = state.jobApplications.find(item => item.advertId === row.id && patient?.id === item.patientId);
  const bookmark = jobBookmarkList().includes(row.id);
  const report = patient ? `<details class="facility-request-data"><summary>الإبلاغ عن الإعلان</summary>
    <form id="job-report" data-id="${row.id}">${field('سبب البلاغ', '<textarea name="reason" rows="3" required minlength="5" maxlength="250"></textarea>')}
      <button class="secondary">إرسال البلاغ</button></form></details>` : '';
  return jobSummary(row) + card('خيارات الإعلان',
    button(bookmark ? 'إزالة من المحفوظة' : 'حفظ الفرصة', 'job-bookmark', row.id, 'secondary') + report)
    + '<div class="discovery-fixed">' + (previous
      ? discoverButton('متابعة طلبي', patientJobHash('application', previous.id))
      : discoverButton('قدّم على الوظيفة', patientJobHash('apply', row.id))) + '</div>';
}

function savedVacancies() {
  const rows = jobBookmarkList().map(jobAdvert).filter(Boolean);
  return card('فرصك المحفوظة', rows.length ? rows.map(row => `<article class="history">
    <div class="record-heading"><strong>${html(row.title)}</strong>${pill(...jobStatus(row))}</div>
    <p class="meta">${html(publisherName(row))}</p>
    <div class="actions">${advertIsOpen(row) ? jobLink('عرض الفرصة', 'vacancy', row.id) : ''}
      ${button('إزالة من المحفوظة', 'job-bookmark', row.id, 'secondary')}</div></article>`).join('')
    : empty('لا توجد فرص محفوظة', 'احفظ فرصة من شاشة تفاصيلها لتعود إليها.'));
}

function careerProfileForm(profile) {
  return `<form id="career-profile">
    ${formInput('name', 'الاسم المهني التجريبي', profile?.name ?? activePatient()?.displayName, 60)}
    ${formSelect('profession', 'المهنة', jobProfessions, profile?.profession)}
    ${formInput('specialty', 'التخصص', profile?.specialty, 70)}
    ${formInput('area', 'منطقة العمل المفضلة', profile?.area ?? 'ذمار', 60)}
    ${field('سنوات الخبرة', `<input type="number" name="experience" min="0" max="70" required value="${html(profile?.experience ?? '')}">`)}
    ${field('نبذة مهنية', `<textarea name="bio" rows="3" maxlength="450">${html(profile?.bio)}</textarea>`)}
    ${field('سيرة ذاتية تجريبية PDF', '<input type="file" accept="application/pdf" name="cv">')}
    ${profile?.cvName ? '<label class="checkbox"><input type="checkbox" name="removeCv"><span>إزالة السيرة المحفوظة</span></label>' : ''}
    <p class="meta">تحفظ التجربة اسم ملف السيرة. تشارك بيانات التقديم مع المنشأة عند موافقتك.</p>
    <button>حفظ الملف المهني</button></form>`;
}

function careerProfilePage() {
  if (!activePatient()) return accountForJob('تسجيل الدخول', 'job-profile');
  const profile = currentCareerProfile();
  const adverts = state.jobAdverts.filter(row => row.kind === 'seeker' && row.publisher === activePatient().id).slice().reverse();
  const summary = profile ? `<dl class="booking-summary">
    ${reviewRow('المهنة والتخصص', html(jobProfessions[profile.profession] + ' · ' + profile.specialty), 'briefcase')}
    ${reviewRow('الخبرة والموقع', html(arabicCount(profile.experience) + ' سنة · ' + profile.area), 'pin')}
    ${reviewRow('السيرة الخاصة', html(profile.cvName || 'لم يحدد ملف'), 'file')}</dl>` : '';
  return (profile ? card(html(profile.name), summary + '<details class="facility-request-data"><summary>تعديل الملف المهني</summary>'
    + careerProfileForm(profile) + '</details>') : card('إنشاء ملف مهني', careerProfileForm(null)))
    + (profile ? card('بطاقة البحث عن عمل', adverts.map(row => `<article class="history">
        <div class="record-heading"><strong>${html(row.title)}</strong>${pill(...jobStatus(row))}</div>
        ${row.reviewNote ? `<p class="meta">${html(row.reviewNote)}</p>` : ''}
        <div class="actions">${row.state === 'revision' ? jobLink('استكمال البطاقة', 'seeker', row.id) : ''}
          ${['pending', 'revision', 'published'].includes(row.state) ? button('إخفاء البطاقة', 'job-withdraw', row.id, 'secondary') : ''}</div></article>`).join('')
        + (adverts.some(row => ['pending', 'revision', 'published'].includes(row.state) && row.deadline >= dateLocal(new Date())) ? ''
          : '<div class="actions">' + jobLink('إنشاء إعلان بحث عن عمل', 'seeker') + '</div>')) : '');
}

function jobAdvertForm(seeker, row = null) {
  const profile = currentCareerProfile();
  const area = row?.area ?? (seeker ? profile?.area : catalog()[clinic]?.area);
  const today = dateLocal(new Date());
  const deadline = row?.deadline && row.deadline >= today ? row.deadline : dateLocal(new Date(now() + 30 * dayLength));
  return `<form id="job-advert">
    ${formInput('title', seeker ? 'المسمى المهني' : 'مسمى الشاغر', row?.title ?? (seeker ? profile?.specialty : ''), 90)}
    ${seeker ? `<p class="meta">${html(jobProfessions[profile.profession] + ' · ' + profile.specialty)}</p>`
      : formSelect('profession', 'المهنة', jobProfessions, row?.profession) + formInput('specialty', 'التخصص', row?.specialty, 70)
        + formInput('branch', 'الفرع', row?.branch ?? catalog()[clinic]?.branch ?? area, 80)}
    ${formInput('area', 'المنطقة', area, 60)}
    ${formSelect('workType', 'نوع الدوام', jobWorkTypes, row?.workType)}
    ${field(seeker ? 'نهاية ظهور البطاقة' : 'آخر يوم للتقديم', `<input type="date" name="deadline" min="${today}" required value="${deadline}">`)}
    ${field('نبذة الإعلان', `<textarea name="description" rows="4" required minlength="10" maxlength="700">${html(row?.description)}</textarea>`)}
    ${seeker ? '<label class="checkbox"><input name="consent" type="checkbox" required><span>أوافق على عرض البطاقة للمنشآت المعتمدة في التجربة</span></label>'
      : field('شروط التقديم', `<textarea name="requirements" rows="3" required minlength="5" maxlength="400">${html(row?.requirements)}</textarea>`)}
    <p class="meta">تُسجّل رسوم محاكاة بقيمة ${arabicCount(recruitmentFeeAmount)} دولارًا على ناشر الإعلان عند تأكيد المباشرة من الطرفين.</p>
    <button>إرسال للمراجعة</button></form>`;
}

function seekerAdvertPage() {
  const profile = currentCareerProfile();
  const row = jobAdvert(discoveryRoute.day);
  if (!profile || (discoveryRoute.day && (!row || !isAdvertOwner(row) || row.state !== 'revision'))) {
    return card('البطاقة غير متاحة', '<p>افتح ملفك المهني لإدارة إعلانك.</p>');
  }
  return card('بطاقة مهنية للمنشآت', (row?.reviewNote ? `<p class="meta">${html(row.reviewNote)}</p>` : '') + jobAdvertForm(true, row));
}

function applicationConsent(id, fromInvitation = false) {
  const profile = currentCareerProfile();
  return `<form id="job-application" data-id="${id}" data-invitation="${fromInvitation}">
    <p><strong>${html(profile.name)}</strong> · ${html(profile.specialty)}</p>
    ${field('رسالة للمنشأة', '<textarea name="message" rows="3" maxlength="450"></textarea>')}
    ${profile.cvName ? `<label class="checkbox"><input name="includeCv" type="checkbox"><span>مشاركة اسم السيرة التجريبية ${html(profile.cvName)}</span></label>` : ''}
    <label class="checkbox"><input name="consent" type="checkbox" required><span>أوافق على مشاركة ملف التقديم مع هذه المنشأة</span></label>
    <button>${fromInvitation ? 'قبول الدعوة ومشاركة الملف' : 'إرسال طلب التقديم'}</button></form>`;
}

function applyForVacancy() {
  const row = jobAdvert(discoveryRoute.day);
  if (row?.kind !== 'vacancy' || !advertIsOpen(row)) return card('الشاغر غير متاح', '<p>اختر شاغرًا آخر من الوظائف.</p>');
  if (!activePatient()) return accountForJob('تسجيل الدخول لإكمال التقديم', 'job-apply', row.id);
  const previous = state.jobApplications.find(item => item.advertId === row.id && item.patientId === activePatient().id);
  if (previous) return card('طلبك محفوظ', `<div class="actions">${jobLink('متابعة طلبي', 'application', previous.id)}</div>`);
  if (!currentCareerProfile()) return card('جهّز ملفك المهني', `<p>احفظ بياناتك المهنية لإكمال التقديم على ${html(row.title)}.</p>
    <div class="actions">${jobLink('إكمال ملفي المهني', 'profile', row.id)}</div>`);
  return jobSummary(row) + card('البيانات المرسلة', applicationConsent(row.id));
}

function applicationList(rows, staff = false) {
  const entries = rows.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(row => `<li>
    <a class="support-list-item" data-route href="${staff ? employerJobHash('applications', row.id) : patientJobHash('application', row.id)}">
      <div class="record-heading"><strong>${html(row.title)}</strong>${pill(...hiringStates[row.stage])}</div>
      <span class="meta">${html(staff ? row.snapshot?.name ?? 'دعوة إلى باحث عن عمل' : catalog()[row.clinicId]?.name)}
        · <bdi>${html(row.id)}</bdi></span></a></li>`).join('');
  return entries ? '<ul class="support-list">' + entries + '</ul>' : empty('لا توجد طلبات هنا', 'تظهر هنا الطلبات والدعوات وفق حالة التوظيف.');
}

function candidateApplications() {
  if (!activePatient()) return accountForJob('تسجيل الدخول', 'job-applications');
  const rows = state.jobApplications.filter(row => row.patientId === activePatient().id);
  return card('الطلبات والدعوات والعروض', applicationList(rows));
}

function hiringTimeline(item) {
  const ordered = ['applied', 'shortlisted', 'interview', 'offered', 'accepted', 'hired'];
  const stageIndex = ordered.indexOf(item.stage);
  if (stageIndex < 0) return '';
  return `<ol class="hiring-timeline" aria-label="مراحل التوظيف">${ordered.map((stage, index) => `<li
    ${index === stageIndex ? 'aria-current="step"' : ''} class="${index <= stageIndex ? 'reached' : ''}">
    ${discoverIcon(index < stageIndex ? 'check' : 'clock')}<span>${hiringStates[stage][0]}</span></li>`).join('')}</ol>`;
}

function placementFeeCard(fee, heading = 'فاتورة المحاكاة', finance = false) {
  const advert = jobAdvert(fee.advertId);
  const payer = advert ? publisherName(advert) : '';
  const review = finance && !fee.reviewedAt ? button('تسجيل المراجعة المالية', 'job-fee-review', fee.id, 'secondary') : '';
  return card(html(heading), `<div class="record-heading"><strong class="placement-total">${arabicCount(fee.amount)} دولارًا أمريكيًا</strong>
    ${pill('تجريبية', 'info')}</div>
    <p>ناشر الإعلان · ${html(payer || (fee.billedRole === 'employer' ? 'المنشأة' : 'الباحث عن عمل'))}</p>
    <p class="meta">المرجع <bdi>${html(fee.id)}</bdi></p>
    ${finance && fee.reviewedAt ? '<p class="meta">تمت المراجعة المالية · ' + supportTimestamp(fee.reviewedAt) + '</p>' : ''}${review}`);
}

function hiringControls(item, actor) {
  const id = item.id;
  if (item.stage === 'invited' && actor === 'candidate') {
    const consent = currentCareerProfile() ? applicationConsent(id, true) : '<p>أكمل ملفك المهني قبل مشاركة بياناتك.</p>';
    return card('دعوة المنشأة', `<p class="support-body">${html(item.invitationMessage)}</p>` + consent
      + `<div class="actions">${button('رفض الدعوة', 'hiring-declineInvitation', id, 'secondary')}</div>`);
  }
  if (actor === 'employer' && item.stage === 'applied') {
    return '<div class="actions">' + button('إضافة للقائمة المختصرة', 'hiring-shortlist', id) + '</div>';
  }
  if (actor === 'employer' && item.stage === 'shortlisted') {
    return card('تحديد المقابلة', `<form id="hiring-interview" data-id="${id}">
      ${field('تاريخ المقابلة', '<input type="date" name="date" required>')}
      ${formInput('location', 'مكان المقابلة أو وسيلتها', '', 100)}
      <button>حفظ المقابلة</button></form>`);
  }
  if (actor === 'employer' && item.stage === 'interview') {
    return card('إرسال العرض', `<form id="hiring-offer" data-id="${id}">
      ${field('تاريخ المباشرة', '<input type="date" name="startDate" required>')}
      ${field('تفاصيل العرض', '<textarea name="details" required minlength="5" maxlength="450" rows="4"></textarea>')}
      <button>إرسال العرض الوظيفي</button></form>`);
  }
  if (actor === 'candidate' && item.stage === 'offered') {
    return '<div class="actions">' + button('قبول العرض', 'hiring-accept', id)
      + button('رفض العرض', 'hiring-declineOffer', id, 'secondary') + '</div>';
  }
  if (item.stage !== 'accepted' && item.stage !== 'hired') return '';
  const eligible = item.stage === 'accepted' && !item.started?.[actor] && item.offer.startDate <= dateLocal(new Date());
  return card('تأكيد المباشرة', `<dl class="booking-summary">
    ${reviewRow('المرشح', item.started?.candidate ? 'أكّد المباشرة' : 'بانتظار التأكيد', 'user')}
    ${reviewRow('المنشأة', item.started?.employer ? 'أكدت المباشرة' : 'بانتظار التأكيد', 'building')}</dl>
    ${eligible ? `<div class="actions">${button('تأكيد المباشرة', 'hiring-started', id)}</div>` : ''}
    ${item.stage === 'accepted' && item.offer.startDate > dateLocal(new Date()) ? '<p class="meta">يُتاح التأكيد عند حلول التاريخ المحدد.</p>' : ''}`);
}

function jobApplicationPage(actor) {
  const item = applicationForActor(discoveryRoute.day, actor);
  if (!item) return card('الطلب غير متاح', '<p>اختر طلبًا من قائمتك.</p>');
  const snapshot = item.snapshot;
  const fee = state.placementFees.find(row => row.applicationId === item.id && row.billedRole === actor);
  const identity = card(html(item.title), `<div class="record-heading"><strong>${html(catalog()[item.clinicId]?.name)}</strong>
    ${pill(...hiringStates[item.stage])}</div><p class="meta">مرجع الطلب · <bdi>${html(item.id)}</bdi></p>` + hiringTimeline(item));
  const shared = snapshot ? card('بيانات التقديم المشتركة', `<p><strong>${html(snapshot.name)}</strong> · ${html(snapshot.specialty)}</p>
    <p class="meta">${html(jobProfessions[snapshot.profession])} · ${arabicCount(snapshot.experience)} سنة · ${html(snapshot.area)}</p>
    ${snapshot.bio ? `<p class="support-body">${html(snapshot.bio)}</p>` : ''}
    ${snapshot.cvName ? `<p>${html(snapshot.cvName)}</p>` : ''}
    ${item.candidateMessage ? `<p class="support-body">${html(item.candidateMessage)}</p>` : ''}`) : '';
  const interview = item.interview ? card('المقابلة', `<p>${html(absoluteDate(item.interview.date))} · ${html(item.interview.location)}</p>`) : '';
  const offer = item.offer ? card('العرض الوظيفي', `<p class="meta">المباشرة · ${html(absoluteDate(item.offer.startDate))}</p>
    <p class="support-body">${html(item.offer.details)}</p>`) : '';
  return identity + (fee ? placementFeeCard(fee) : '') + shared + interview + offer + hiringControls(item, actor);
}

function jobsPage() {
  const screens = {
    vacancy: vacancyPage, profile: careerProfilePage, saved: savedVacancies, my: candidateApplications,
    apply: applyForVacancy, application: () => jobApplicationPage('candidate'), seeker: seekerAdvertPage,
  };
  return Object.hasOwn(screens, discoveryRoute.tab) ? screens[discoveryRoute.tab]() : jobsHome();
}

function employerAccess(renderPage) {
  return employerAvailable(clinic) ? renderPage()
    : card('اختر منشأة تجريبية معتمدة', '<p>ارجع إلى مساحات العمل وحدد المنشأة التي ستجرب التوظيف باسمها.</p>');
}

function employerHome() {
  const adverts = state.jobAdverts.filter(row => row.kind === 'vacancy' && row.publisher === clinic);
  const apps = state.jobApplications.filter(row => row.clinicId === clinic);
  const options = [['إعلاناتي', 'postings', 'briefcase'], ['الباحثون عن عمل', 'talent', 'users'], ['الطلبات والعروض', 'applications', 'file']];
  return roleMetrics([['شواغر مفتوحة', adverts.filter(advertIsOpen).length],
    ['طلبات جديدة', apps.filter(row => row.stage === 'applied').length], ['مباشرات مؤكدة', apps.filter(row => row.stage === 'hired').length]])
    + `<div class="account-options">${options.map(([label, tab, icon]) => discoverLink(label, employerJobHash(tab), '', icon)).join('')}</div>`;
}

function employerPostings() {
  const id = discoveryRoute.day;
  const row = jobAdvert(id);
  if (id === 'new' || (row && isAdvertOwner(row) && row.state === 'revision')) {
    return card(row ? 'استكمال إعلان الشاغر' : 'بيانات الشاغر', (row?.reviewNote ? `<p>${html(row.reviewNote)}</p>` : '') + jobAdvertForm(false, row));
  }
  const postings = state.jobAdverts.filter(item => item.kind === 'vacancy' && item.publisher === clinic).slice().reverse();
  return `<div class="actions">${discoverButton('إنشاء إعلان شاغر', employerJobHash('postings', 'new'))}</div>`
    + card('شواغر المنشأة', postings.length ? postings.map(item => `<article class="history">
      <div class="record-heading"><strong>${html(item.title)}</strong>${pill(...jobStatus(item))}</div>
      <p class="meta">${html(jobMeta(item))}</p>
      ${item.reviewNote ? `<p>${html(item.reviewNote)}</p>` : ''}
      <div class="actions">${item.state === 'revision' ? discoverButton('استكمال الإعلان', employerJobHash('postings', item.id)) : ''}
        ${['pending', 'revision', 'published'].includes(item.state) ? button('إغلاق الإعلان', 'job-withdraw', item.id, 'secondary') : ''}</div></article>`).join('')
      : empty('لا توجد إعلانات لهذه المنشأة', 'ابدأ بإعلان شاغر وأرسله للمراجعة.'));
}

function employerTalent() {
  if (!discoveryRoute.day) return jobFilters('seeker');
  const row = jobAdvert(discoveryRoute.day);
  if (row?.kind !== 'seeker' || !advertIsOpen(row)) return card('البطاقة غير متاحة', '<p>اختر بطاقة ظاهرة في الدليل.</p>');
  const invitation = state.jobApplications.find(item => item.advertId === row.id && item.clinicId === clinic);
  const invite = invitation ? '<div class="actions">' + discoverButton('متابعة الدعوة', employerJobHash('applications', invitation.id)) + '</div>'
    : `<form id="job-invite" data-id="${row.id}">
      ${field('رسالة الدعوة', '<textarea name="message" rows="3" maxlength="450"></textarea>')}
      <p class="meta">يشارك الباحث ملفه مع المنشأة بعد موافقته.</p><button>إرسال دعوة</button></form>`;
  return jobSummary(row) + card('دعوة للتوظيف', invite);
}

function employerApplications() {
  if (discoveryRoute.day) return jobApplicationPage('employer');
  return card('المرشحون والدعوات', applicationList(state.jobApplications.filter(row => row.clinicId === clinic), true));
}

function jobModeration() {
  const reports = discoveryRoute.day === 'reports';
  const tabs = `<nav class="profile-tabs appointment-tabs" aria-label="إشراف الوظائف">
    <a data-route data-selection href="${routeHash('admin', 'jobs-review')}"${reports ? '' : ' aria-current="page"'}>قيد المراجعة</a>
    <a data-route data-selection href="${routeHash('admin', 'jobs-review')}/reports"${reports ? ' aria-current="page"' : ''}>البلاغات</a></nav>`;
  if (reports) {
    const rows = state.jobReports.slice().reverse().map(row => `<article class="history">
      <strong>${html(jobAdvert(row.advertId)?.title)}</strong><p class="support-body">${html(row.reason)}</p>
      ${row.state === 'open' ? `<div class="actions">
        ${button('حفظ المراجعة', 'job-report-reviewed', row.id)}
        ${button('إخفاء الإعلان', 'job-report-hide', row.id, 'secondary')}</div>` : `<p class="meta">${html(row.resolution)}</p>`}</article>`);
    return tabs + card('بلاغات الإعلانات', rows.join('') || empty('لا توجد بلاغات', 'تظهر هنا بلاغات الحسابات التجريبية.'));
  }
  const pending = state.jobAdverts.filter(row => row.state === 'pending').slice().reverse();
  return tabs + (pending.length ? pending.map(row => jobSummary(row) + card('قرار المراجعة', `
    <p class="meta">${row.kind === 'vacancy' ? 'شاغر منشأة' : 'إعلان باحث عن عمل'} · <bdi>${row.id}</bdi></p>
    ${button('اعتماد الإعلان', 'job-approve', row.id)}
    <details class="facility-request-data"><summary>طلب استكمال أو رفض الإعلان</summary>
      <form id="job-moderation-${row.id}" class="job-moderation" data-id="${row.id}">
        ${formSelect('decision', 'القرار', { revision: 'طلب استكمال', rejected: 'رفض' }, 'revision')}
        ${field('ملاحظة للناشر', '<textarea name="reason" rows="3" minlength="4" maxlength="160" required></textarea>')}
        <button class="secondary">حفظ القرار</button></form></details>`)).join('')
    : card('الإعلانات الجديدة', empty('لا توجد إعلانات قيد المراجعة', 'تظهر هنا إعلانات المنشآت والباحثين قبل النشر.')));
}

function jobNoticeRows(patientId) {
  return state.jobApplications.filter(row => row.patientId === patientId && row.stage !== 'applied')
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map(row => `<article class="history">
      <a data-route class="notice-link" href="${patientJobHash('application', row.id)}"><strong>${hiringStates[row.stage][0]}</strong>
        <span class="meta">${html(row.title)}</span></a></article>`);
}
