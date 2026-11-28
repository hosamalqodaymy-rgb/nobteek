'use strict';

const jobProfessions = {
  physician: 'طب', laboratory: 'مختبرات طبية', pharmacy: 'صيدلة', nursing: 'تمريض',
  therapy: 'علاج طبيعي', imaging: 'أشعة وتصوير', dental: 'طب الأسنان', other: 'مهن صحية أخرى',
};
const jobWorkTypes = { full: 'دوام كامل', part: 'دوام جزئي', shifts: 'مناوبات' };
const advertStates = {
  pending: ['قيد المراجعة', 'pending'], published: ['منشور', 'success'],
  revision: ['استكمال مطلوب', 'pending'], rejected: ['غير معتمد', 'error'], closed: ['مغلق', 'neutral'],
};
const hiringStates = {
  invited: ['دعوة من منشأة', 'info'], applied: ['تم التقديم', 'pending'], shortlisted: ['القائمة المختصرة', 'info'],
  interview: ['مقابلة محددة', 'info'], offered: ['عرض وظيفي', 'info'], accepted: ['العرض مقبول', 'pending'],
  hired: ['تأكدت المباشرة', 'success'], declined: ['رُفض العرض أو الدعوة', 'neutral'],
};
const recruitmentFeeAmount = 50;

function demoVacancies() {
  const fixtures = [
    ['CLN-005', 'أخصائي جراحة مخ وأعصاب', 'physician', 'جراحة المخ والأعصاب', 'full'],
    ['CLN-010', 'صيدلي سريري', 'pharmacy', 'الصيدلة السريرية', 'shifts'],
    ['CLN-015', 'أخصائي مختبرات طبية', 'laboratory', 'التحاليل السريرية', 'part'],
    ['CLN-005', 'ممرض عناية مركزة', 'nursing', 'العناية المركزة', 'shifts'],
    ['CLN-012', 'أخصائي علاج طبيعي', 'therapy', 'التأهيل الحركي', 'part'],
    ['CLN-020', 'فني أشعة', 'imaging', 'التصوير الطبي', 'full'],
    ['CLN-001', 'طبيب أسنان عام', 'dental', 'طب الأسنان العام', 'full'],
    ['CLN-006', 'طبيب أطفال', 'physician', 'طب الأطفال', 'shifts'],
  ];
  return fixtures.map(([publisher, title, profession, specialty, workType], index) => ({
    id: 'JOB-DEMO-' + (index + 1), kind: 'vacancy', publisher, title, profession, specialty, workType,
    area: demoDirectory[publisher].area, branch: demoDirectory[publisher].area,
    description: 'فرصة تجريبية للعمل ضمن فريق ' + jobProfessions[profession] + ' في المنشأة.',
    requirements: 'ترخيص مهني ساري في التخصص وخبرة مناسبة للوظيفة.',
    deadline: dateLocal(new Date(now() + (14 + index) * dayLength)),
    state: 'published', updatedAt: now(), reviewNote: '',
  }));
}

function seedHiring() {
  return { jobAdverts: previewServer ? [] : demoVacancies(), jobProfiles: [], jobApplications: [], jobBookmarks: {}, jobReports: [], placementFees: [] };
}

const careerProfile = id => state.jobProfiles.find(row => row.id === id);
const currentCareerProfile = () => careerProfile(activePatient()?.id);
const jobAdvert = id => state.jobAdverts.find(row => row.id === id);
const hiringCase = id => state.jobApplications.find(row => row.id === id);
const advertIsOpen = row => row?.state === 'published' && row.deadline >= dateLocal(new Date());
const employerAvailable = id => !previewServer && Boolean(Object.hasOwn(demoDirectory, id) || catalog()[id]?.status === 'approved');
const employerWorkspace = () => role === 'employer' && employerAvailable(clinic);
const publisherName = row => row.kind === 'vacancy' ? catalog()[row.publisher]?.name : careerProfile(row.publisher)?.name;
const isAdvertOwner = row => row && (row.kind === 'vacancy'
  ? employerWorkspace() && row.publisher === clinic
  : role === 'jobs' && row.publisher === activePatient()?.id);
const validJobDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && previewCalendar(value).toISOString().slice(0, 10) === value;
const datedFromToday = value => validJobDate(value) && value >= dateLocal(new Date());
const patientJobHash = (tab = '', id = '') => routeHash('jobs', tab) + (id ? '/' + id : '');
const employerJobHash = (tab, id = '') => routeHash('employer', tab) + (id ? '/' + id : '');

function saveCareerProfile(fields) {
  const patient = activePatient();
  if (role !== 'jobs' || discoveryRoute.tab !== 'profile' || !patient) return;
  const old = currentCareerProfile();
  const name = textFrom(fields, 'name');
  const profession = textFrom(fields, 'profession');
  const specialty = textFrom(fields, 'specialty');
  const area = textFrom(fields, 'area');
  const rawExperience = textFrom(fields, 'experience');
  const experience = Number(rawExperience);
  const bio = textFrom(fields, 'bio');
  const file = fields.get('cv');
  if (name.length < 2 || name.length > 60 || !Object.hasOwn(jobProfessions, profession)
    || specialty.length < 2 || specialty.length > 70 || area.length < 2 || area.length > 60
    || !rawExperience || !Number.isInteger(experience) || experience < 0 || experience > 70 || bio.length > 450) {
    return feedback('أكمل الاسم والمهنة والتخصص والمنطقة وسنوات الخبرة.', true);
  }
  if (file?.size && (file.type !== 'application/pdf' || file.size > limit)) return feedback('اختر سيرة تجريبية بصيغة PDF حتى 2 ميغابايت.', true);
  let cvName = old?.cvName ?? '';
  if (file?.size) cvName = file.name.slice(0, 100);
  if (fields.has('removeCv')) cvName = '';
  const current = { id: patient.id, name, profession, specialty, area, experience, bio, cvName };
  const profiles = old ? replacePreviewRow(state.jobProfiles, current) : [...state.jobProfiles, current];
  const resume = jobAdvert(discoveryRoute.day);
  const destination = resume?.kind === 'vacancy' && advertIsOpen(resume) ? patientJobHash('apply', resume.id) : patientJobHash('profile');
  return commitPreview({ jobProfiles: profiles }, 'حُفظ ملفك المهني الخاص.', destination);
}

function submitJobAdvert(fields) {
  const seeker = role === 'jobs' && discoveryRoute.tab === 'seeker';
  const profile = seeker ? currentCareerProfile() : null;
  const vacancy = employerWorkspace() && currentTab === 'postings';
  if (!(seeker && profile) && !vacancy) return;
  const editing = discoveryRoute.day && discoveryRoute.day !== 'new';
  const previous = editing ? jobAdvert(discoveryRoute.day) : null;
  if (editing && (!isAdvertOwner(previous) || previous.state !== 'revision')) return feedback('هذا الإعلان غير متاح للتعديل.', true);
  const proposal = {
    id: previous?.id ?? newId('JOB'), kind: seeker ? 'seeker' : 'vacancy',
    publisher: seeker ? profile.id : clinic,
    title: textFrom(fields, 'title'), profession: seeker ? profile.profession : textFrom(fields, 'profession'),
    specialty: seeker ? profile.specialty : textFrom(fields, 'specialty'),
    experience: seeker ? profile.experience : undefined,
    area: textFrom(fields, 'area'), branch: seeker ? '' : textFrom(fields, 'branch'),
    workType: textFrom(fields, 'workType'), deadline: textFrom(fields, 'deadline'),
    description: textFrom(fields, 'description'), requirements: seeker ? '' : textFrom(fields, 'requirements'),
    state: 'pending', reviewNote: '', updatedAt: now(),
  };
  if (proposal.title.length < 3 || proposal.title.length > 90 || !Object.hasOwn(jobProfessions, proposal.profession)
    || proposal.specialty.length < 2 || proposal.specialty.length > 70 || proposal.area.length < 2 || proposal.area.length > 60
    || (!seeker && (proposal.branch.length < 2 || proposal.branch.length > 80 || proposal.requirements.length < 5))
    || !Object.hasOwn(jobWorkTypes, proposal.workType) || !datedFromToday(proposal.deadline)
    || proposal.description.length < 10 || proposal.description.length > 700 || proposal.requirements.length > 400) {
    return feedback('راجع المسمى والتخصص والدوام والتاريخ ووصف الإعلان.', true);
  }
  if (seeker && !fields.has('consent')) return feedback('أكد موافقتك على إظهار البطاقة للمنشآت التجريبية المعتمدة.', true);
  if (state.jobAdverts.some(row => row.id !== proposal.id && row.kind === proposal.kind && row.publisher === proposal.publisher
    && ['pending', 'published', 'revision'].includes(row.state) && row.deadline >= dateLocal(new Date())
    && (seeker || searchable(row.title) === searchable(proposal.title)))) {
    return feedback('يوجد إعلان جارٍ لهذا المسمى أو لهذا الملف.', true);
  }
  return commitPreview({
    jobAdverts: previous ? replacePreviewRow(state.jobAdverts, proposal) : [...state.jobAdverts, proposal],
  }, 'أُرسل الإعلان للمراجعة.', seeker ? patientJobHash('profile') : employerJobHash('postings'));
}

function withdrawJobAdvert(id) {
  const row = jobAdvert(id);
  if (!isAdvertOwner(row) || !['pending', 'published', 'revision'].includes(row.state)) return;
  return commitPreview({
    jobAdverts: replacePreviewRow(state.jobAdverts, { ...row, state: 'closed', updatedAt: now() }),
  }, row.kind === 'seeker' ? 'أُخفيت البطاقة المهنية عن المنشآت.' : 'أُغلق الإعلان.');
}

function moderateJobAdvert(id, decision, reason = '') {
  if (role !== 'admin' || currentTab !== 'jobs-review') return;
  const row = jobAdvert(id);
  if (row?.state !== 'pending' || !['published', 'revision', 'rejected'].includes(decision)) return;
  if (decision === 'published' && !datedFromToday(row.deadline)) return feedback('انتهت مدة الإعلان. اطلب تعديل تاريخ الإغلاق.', true);
  if (decision !== 'published' && (reason.length < 4 || reason.length > 160)) return feedback('اكتب ملاحظة من 4 إلى 160 حرفًا.', true);
  const label = { published: 'اعتمد إعلان الوظيفة', revision: 'طُلب استكمال إعلان', rejected: 'رُفض الإعلان' }[decision];
  return commitPreview({
    jobAdverts: replacePreviewRow(state.jobAdverts, { ...row, state: decision, reviewNote: reason, updatedAt: now() }),
    platformAudit: platformAudit(label, row.id),
  }, label + '.');
}

function toggleJobBookmark(id) {
  if (role !== 'jobs') return;
  const bucket = activePatient()?.id ?? 'guest';
  const saved = state.jobBookmarks[bucket] ?? [];
  const adding = !saved.includes(id);
  if (adding && (jobAdvert(id)?.kind !== 'vacancy' || !advertIsOpen(jobAdvert(id)))) return;
  const ids = adding ? [...saved, id] : saved.filter(key => key !== id);
  return commitPreview({ jobBookmarks: { ...state.jobBookmarks, [bucket]: ids } }, adding ? 'حُفظت الفرصة.' : 'أُزيلت الفرصة من المحفوظة.');
}

function reportJobAdvert(fields, id) {
  const patient = activePatient();
  const row = jobAdvert(id);
  const reason = textFrom(fields, 'reason');
  if (role !== 'jobs' || discoveryRoute.tab !== 'vacancy' || !patient || !advertIsOpen(row)
    || reason.length < 5 || reason.length > 250) return feedback('اكتب سبب البلاغ من 5 إلى 250 حرفًا.', true);
  if (state.jobReports.some(report => report.advertId === id && report.patientId === patient.id)) return feedback('سبق إرسال بلاغ منك عن هذا الإعلان.', true);
  return commitPreview({
    jobReports: [...state.jobReports, { id: newId('REPORT'), advertId: id, patientId: patient.id, reason, state: 'open', createdAt: now() }],
  }, 'أُرسل البلاغ لمراجعة مدير المنصة.');
}

function reviewJobReport(id, hideAdvert) {
  if (role !== 'admin' || currentTab !== 'jobs-review') return;
  const report = state.jobReports.find(row => row.id === id && row.state === 'open');
  if (!report) return;
  const advert = jobAdvert(report.advertId);
  const label = hideAdvert ? 'أُخفي الإعلان بعد مراجعة البلاغ' : 'أُنجزت مراجعة بلاغ الإعلان';
  const changes = {
    jobReports: replacePreviewRow(state.jobReports, { ...report, state: 'reviewed', resolution: label }),
    platformAudit: platformAudit(label, report.id),
  };
  if (hideAdvert && advert?.state === 'published') {
    changes.jobAdverts = replacePreviewRow(state.jobAdverts, { ...advert, state: 'closed', reviewNote: 'أُغلق الإعلان بعد مراجعة بلاغ.' });
  }
  return commitPreview(changes, label + '.');
}

function applicationForActor(id, actor) {
  const item = hiringCase(id);
  if (actor === 'candidate' && role === 'jobs' && activePatient()?.id === item?.patientId) return item;
  if (actor === 'employer' && employerWorkspace() && item?.clinicId === clinic) return item;
  return null;
}

function sharedJobSnapshot(profile, includeCv) {
  const { id, cvName, ...data } = profile;
  return { ...data, cvName: includeCv ? cvName : '' };
}

function submitJobApplication(fields, id, invitation = false) {
  const profile = currentCareerProfile();
  if (role !== 'jobs' || !profile || !fields.has('consent')) return feedback('أكمل الملف المهني وأكد الموافقة على مشاركته.', true);
  const candidateMessage = textFrom(fields, 'message');
  if (candidateMessage.length > 450) return feedback('اكتب رسالة لا تتجاوز 450 حرفًا.', true);
  const date = now();
  const snapshot = sharedJobSnapshot(profile, fields.has('includeCv'));
  let item;
  if (invitation) {
    const before = applicationForActor(id, 'candidate');
    if (before?.stage !== 'invited') return feedback('هذه الدعوة غير متاحة.', true);
    item = { ...before, stage: 'applied', candidateMessage, snapshot, updatedAt: date };
  } else {
    const row = jobAdvert(id);
    if (row?.kind !== 'vacancy' || !advertIsOpen(row) || !employerAvailable(row.publisher)) return feedback('هذا الشاغر غير متاح للتقديم.', true);
    if (state.jobApplications.some(item => item.advertId === id && item.patientId === profile.id)) return feedback('سبق تقديم طلب لهذه الفرصة.', true);
    item = {
      id: newId('APP'), advertId: id, clinicId: row.publisher, patientId: profile.id, title: row.title,
      stage: 'applied', candidateMessage, snapshot, updatedAt: date,
    };
  }
  const items = invitation ? replacePreviewRow(state.jobApplications, item) : [...state.jobApplications, item];
  return commitPreview({ jobApplications: items }, 'أُرسل ملف التقديم إلى المنشأة.', patientJobHash('application', item.id));
}

function sendJobInvitation(fields, id) {
  const row = jobAdvert(id);
  const message = textFrom(fields, 'message');
  if (!employerWorkspace() || row?.kind !== 'seeker' || !advertIsOpen(row) || message.length > 450) return feedback('هذه البطاقة غير متاحة للدعوات.', true);
  if (state.jobApplications.some(item => item.advertId === id && item.clinicId === clinic)) return feedback('سبق إرسال دعوة لهذه البطاقة.', true);
  const item = {
    id: newId('APP'), advertId: id, clinicId: clinic, patientId: row.publisher, title: row.title,
    stage: 'invited', invitationMessage: message, snapshot: null, updatedAt: now(),
  };
  return commitPreview({ jobApplications: [...state.jobApplications, item] }, 'حُفظت الدعوة التجريبية.', employerJobHash('applications', item.id));
}

function updateHiringCase(id, action, fields = null) {
  const actor = role === 'employer' ? 'employer' : 'candidate';
  const item = applicationForActor(id, actor);
  if (!item) return;
  if (action === 'started') return confirmHiringStart(item, actor);
  const moves = {
    shortlist: ['employer', 'applied', 'shortlisted'],
    interview: ['employer', 'shortlisted', 'interview'],
    offer: ['employer', 'interview', 'offered'],
    accept: ['candidate', 'offered', 'accepted'],
    declineOffer: ['candidate', 'offered', 'declined'],
    declineInvitation: ['candidate', 'invited', 'declined'],
  };
  const move = moves[action];
  if (!move || move[0] !== actor || move[1] !== item.stage) return feedback('هذه الخطوة غير متاحة في الحالة الحالية.', true);
  const next = { ...item, stage: move[2], updatedAt: now() };
  if (action === 'interview') {
    const date = textFrom(fields, 'date');
    const location = textFrom(fields, 'location');
    if (!datedFromToday(date) || location.length < 2 || location.length > 100) return feedback('أدخل موعد المقابلة ومكانها.', true);
    next.interview = { date, location };
  }
  if (action === 'offer') {
    const startDate = textFrom(fields, 'startDate');
    const details = textFrom(fields, 'details');
    if (!datedFromToday(startDate) || startDate < item.interview.date || details.length < 5 || details.length > 450) {
      return feedback('أدخل تاريخ مباشرة بعد المقابلة وتفاصيل العرض.', true);
    }
    next.offer = { startDate, details };
  }
  return commitPreview({ jobApplications: replacePreviewRow(state.jobApplications, next) }, hiringStates[next.stage][0] + '.');
}

function confirmHiringStart(item, actor) {
  if (item.stage !== 'accepted' || !item.offer || item.offer.startDate > dateLocal(new Date())) {
    return feedback('يُتاح التأكيد بعد قبول العرض وحلول تاريخ المباشرة.', true);
  }
  if (item.started?.[actor]) return feedback('سُجل تأكيد المباشرة منك بالفعل.');
  const advert = jobAdvert(item.advertId);
  if (!advert) return feedback('مرجع الإعلان غير متاح.', true);
  const at = now();
  const started = { ...item.started, [actor]: at };
  const completed = Boolean(started.candidate && started.employer);
  const next = { ...item, started, stage: completed ? 'hired' : 'accepted', updatedAt: at };
  const changes = { jobApplications: replacePreviewRow(state.jobApplications, next) };
  if (completed && !state.placementFees.some(fee => fee.applicationId === item.id)) {
    changes.placementFees = [...state.placementFees, {
      id: newId('PLACEMENT'), applicationId: item.id, advertId: advert.id,
      billedRole: advert.kind === 'vacancy' ? 'employer' : 'candidate', publisherId: advert.publisher,
      amount: recruitmentFeeAmount, currency: 'USD', simulated: true, issuedAt: at,
    }];
  }
  return commitPreview(changes, completed ? 'تأكدت المباشرة من الطرفين وسُجلت الفاتورة التجريبية.' : 'حُفظ تأكيدك. بانتظار الطرف الآخر.');
}
