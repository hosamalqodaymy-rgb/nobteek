'use strict';

const facilityTypes = { clinic: 'عيادة', center: 'مركز طبي', hospital: 'مستشفى' };
const facilitySteps = [['details', 'البيانات'], ['verification', 'التحقق'], ['setup', 'التجهيز'], ['review', 'المراجعة']];
const staffRoleLabels = { reception: 'الاستقبال', doctor: 'طبيب' };
const formInput = (key, label, value, max, required = true) => field(label,
  `<input name="${key}" maxlength="${max}" value="${html(value)}"${required ? ' required' : ''}>`);
const formSelect = (key, label, entries, selected) => field(label,
  `<select name="${key}" required>${Object.entries(entries).map(([value, text]) => option(value, text, selected === value)).join('')}</select>`);
const textFrom = (fields, key) => String(fields.get(key) ?? '').trim();

function clinicApplicationDraft() {
  return state.clinicDraft && canViewClinicRequest(state.clinicDraft) ? state.clinicDraft : {};
}

function clinicApplicationStep() {
  const draft = clinicApplicationDraft();
  const requested = facilitySteps.findIndex(([id]) => id === discoveryRoute.tab);
  return Math.min(requested < 0 ? draft.step ?? 0 : requested, draft.step ?? 0);
}

function clinicFlowTrail(step) {
  return `<ol class="facility-steps" aria-label="خطوات طلب المنشأة">${facilitySteps.map(([, label], index) =>
    `<li${step === index ? ' aria-current="step"' : ''}><span>${index + 1}</span>${label}</li>`).join('')}</ol>`;
}

function clinicDetailsForm(draft) {
  return card('بيانات المنشأة', `<form id="clinic-application">
    ${formSelect('type', 'نوع المنشأة', facilityTypes, draft.type ?? 'clinic')}
    ${formInput('name', 'اسم المنشأة في الدليل', draft.name, 80)}
    ${formInput('area', 'المنطقة في ذمار', draft.area, 60)}
    ${formInput('branch', 'اسم الفرع', draft.branch, 80)}
    ${formInput('address', 'عنوان الزيارة', draft.address, 160)}
    <div class="actions"><button>التالي</button>${button('حفظ مسودة', 'facility-save-draft', '', 'secondary')}</div>
    </form>`);
}

function facilityVerificationForm(draft) {
  const upload = (key, label, saved) => field(label,
    `<input type="file" accept="application/pdf,image/jpeg,image/png" name="${key}">${saved ? `<small>${html(saved)}</small>` : ''}`);
  return card('التحقق من المنشأة', `<form id="clinic-application">
    ${formSelect('applicantRole', 'صفة مقدم الطلب', { owner: 'مالك المنشأة', delegate: 'مفوّض عن المنشأة' }, draft.applicantRole ?? 'owner')}
    ${upload('licence', 'ترخيص المنشأة', draft.licence)}
    ${upload('delegation', 'مستند التفويض · للمفوّض', draft.delegation)}
    <label class="checkbox"><input type="checkbox" name="sample"><span>استخدام وثائق الاختبار الجاهزة</span></label>
    <p class="meta">تحتفظ التجربة باسم الملف فقط. استخدم ملفات وهمية.</p>
    <button>متابعة التجهيز</button></form>`);
}

function facilitySetupForm(draft) {
  const days = Object.fromEntries(previewWeekdays.slice(1).map((label, index) => [index + 1, label]));
  return card('تجهيز الفرع', `<form id="clinic-application">
    ${formSelect('specialty', 'التخصص', { '': 'اختر التخصص', ...specialties }, draft.specialty)}
    ${formInput('practitioner', 'اسم الممارس التجريبي', draft.practitioner, 60)}
    ${formSelect('weekday', 'يوم العمل', days, String(draft.weekday ?? 6))}
    <div class="clinic-time-row">
      ${field('بداية الدوام', `<input type="time" name="start" required value="${html(draft.start ?? '08:00')}">`)}
      ${field('نهاية الدوام', `<input type="time" name="end" required value="${html(draft.end ?? '13:00')}">`)}
    </div>
    <p class="meta">يفتح المالك المواعيد بعد اعتماد المنشأة.</p>
    <button>معاينة الطلب</button></form>`);
}

function facilitySummary(draft, verification = false) {
  const details = [
    reviewRow('المنشأة والفرع', html(draft.name) + '<small>' + html([draft.branch, draft.area].filter(Boolean).join(' · ')) + '</small>', 'building'),
    reviewRow('عنوان الزيارة', html(draft.address ?? draft.area), 'pin'),
    reviewRow('الممارس والتخصص', html([draft.practitioner ?? draft.doctors?.[0], specialties[draft.specialty]].filter(Boolean).join(' · ')), 'user'),
  ];
  if (draft.weekday) details.push(reviewRow('الدوام', html(previewWeekdays[draft.weekday])
    + ' · <bdi>' + html(draft.start + '–' + draft.end) + '</bdi>', 'clock'));
  if (verification && draft.licence) {
    details.push(reviewRow('ترخيص المنشأة', html(draft.licence), 'file'));
    if (draft.delegation) details.push(reviewRow('مستند التفويض', html(draft.delegation), 'file'));
  }
  return '<dl class="booking-summary">' + details.join('') + '</dl>';
}

function facilityReviewForm(draft) {
  return card('راجع طلب الإضافة', facilitySummary(draft, true)) +
    `<form id="clinic-application" class="discovery-fixed facility-review">
      <label class="checkbox"><input name="confirmed" type="checkbox" required><span>راجعت بيانات المنشأة التجريبية</span></label>
      <button>إرسال للمراجعة</button>
    </form>`;
}

function applyForClinic() {
  const draft = clinicApplicationDraft();
  const step = clinicApplicationStep();
  const forms = [clinicDetailsForm, facilityVerificationForm, facilitySetupForm, facilityReviewForm];
  return clinicFlowTrail(step) + forms[step](draft)
    + (step === 0 ? `<div class="actions">${routeLink('متابعة طلبات الإضافة', 'applications', '', 'secondary')}</div>` : '');
}

function clinicDraftDetails(fields) {
  return {
    type: textFrom(fields, 'type'), name: textFrom(fields, 'name').slice(0, 80), area: textFrom(fields, 'area').slice(0, 60),
    branch: textFrom(fields, 'branch').slice(0, 80), address: textFrom(fields, 'address').slice(0, 160),
  };
}

function keepClinicDraft(draft) {
  const previous = state.clinicDraft;
  state.clinicDraft = draft ? { ...draft, requesterId: activePatient()?.id ?? null } : null;
  if (save()) return true;
  state.clinicDraft = previous;
  return false;
}

function fileNameForFacility(file, previous) {
  if (!file?.size) return previous ?? '';
  if (file.size > limit || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) return null;
  return file.name.slice(0, 120);
}

function facilityNameTaken(name, except) {
  const requests = state.clinicApplications.filter(row => row.id !== except && ['pending', 'revision'].includes(row.status));
  return [...Object.values(catalog()), ...requests].some(row => searchable(row.name) === searchable(name));
}

function resumeClinicApplication(id) {
  const request = state.clinicApplications.find(row => row.id === id && row.status === 'revision' && canViewClinicRequest(row));
  if (!request) return feedback('هذا الطلب غير متاح للاستكمال.', true);
  const { id: revisionId, ...details } = request;
  if (keepClinicDraft({ ...details, revisionId, step: 1 })) navigate(routeHash('apply', 'verification'));
}

function readClinicApplication(fields, saveDraft = false) {
  const draft = clinicApplicationDraft();
  const step = clinicApplicationStep();
  if (step === 0) {
    const details = clinicDraftDetails(fields);
    const next = { ...draft, ...details };
    if (saveDraft) {
      if (keepClinicDraft({ ...next, step: 0 })) feedback('حُفظت مسودة الطلب.');
      return;
    }
    if (!Object.hasOwn(facilityTypes, details.type) || details.name.length < 3
      || details.area.length < 2 || details.branch.length < 2 || details.address.length < 3) {
      return feedback('أكمل اسم المنشأة والمنطقة والفرع والعنوان.', true);
    }
    if (facilityNameTaken(details.name, draft.revisionId)) return feedback('يوجد طلب أو منشأة مدرجة بهذا الاسم.', true);
    if (keepClinicDraft({ ...next, step: Math.max(draft.step ?? 0, 1) })) navigate(routeHash('apply', 'verification'));
    return;
  }

  if (step === 1) {
    const applicantRole = textFrom(fields, 'applicantRole');
    const sample = fields.has('sample');
    const licence = sample ? 'ترخيص منشأة اصطناعي' : fileNameForFacility(fields.get('licence'), draft.licence);
    const delegation = sample && applicantRole === 'delegate' ? 'تفويض اصطناعي' : fileNameForFacility(fields.get('delegation'), draft.delegation);
    if (!['owner', 'delegate'].includes(applicantRole) || !licence || delegation === null || (applicantRole === 'delegate' && !delegation)) {
      return feedback('أرفق الترخيص والتفويض عند الحاجة بصيغة PDF أو صورة حتى 2 ميغابايت، أو اختر الوثائق التجريبية الجاهزة.', true);
    }
    if (keepClinicDraft({ ...draft, applicantRole, licence, delegation, step: Math.max(draft.step, 2) })) navigate(routeHash('apply', 'setup'));
    return;
  }

  if (step === 2) {
    const specialty = textFrom(fields, 'specialty');
    const practitioner = textFrom(fields, 'practitioner');
    const weekday = Number(fields.get('weekday'));
    const start = textFrom(fields, 'start');
    const end = textFrom(fields, 'end');
    if (!Object.hasOwn(specialties, specialty) || practitioner.length < 2 || practitioner.length > 60
      || !Number.isInteger(weekday) || !previewWeekdays[weekday] || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) {
      return feedback('اختر التخصص والممارس وساعات دوام صحيحة.', true);
    }
    if (keepClinicDraft({ ...draft, specialty, practitioner, weekday, start, end, step: 3 })) navigate(routeHash('apply', 'review'));
    return;
  }

  if (!fields.has('confirmed') || !draft.licence || !draft.practitioner) return feedback('راجع بيانات المنشأة وأكدها قبل الإرسال.', true);
  if (facilityNameTaken(draft.name, draft.revisionId)) return feedback('يوجد طلب أو منشأة مدرجة بهذا الاسم.', true);
  const details = { ...draft };
  delete details.step;
  delete details.revisionId;
  const existing = state.clinicApplications.find(row => row.id === draft.revisionId && row.status === 'revision' && canViewClinicRequest(row));
  if (draft.revisionId && !existing) return feedback('انتهت صلاحية استكمال هذا الطلب.', true);
  const application = {
    ...details, id: existing?.id ?? newId('CLN'), status: 'pending', reason: '',
    requesterId: activePatient()?.id ?? null, doctors: [draft.practitioner],
    profiles: [{ name: draft.practitioner, specialty: draft.specialty, hours: [[draft.weekday, draft.start, draft.end]] }],
  };
  return commitPreview({
    clinicDraft: null,
    clinicApplications: existing ? replacePreviewRow(state.clinicApplications, application) : [...state.clinicApplications, application],
  }, 'تم إرسال طلب الإضافة للمراجعة.', routeHash('applications'));
}

const arabicCount = number => number.toLocaleString('ar-YE');
const roleMetrics = items => `<div class="clinic-metrics">${items.map(([label, value]) =>
  `<div><strong>${arabicCount(value)}</strong><span>${label}</span></div>`).join('')}</div>`;

function ownerToday() {
  const today = dateLocal(new Date());
  const requests = bookings().filter(row => session(row.sessionId)?.date === today);
  const available = visiblePreviewSessions(clinic);
  const counts = previewSessionCounts();
  const next = available.find(row => canBookPreviewSession(row, counts));
  return roleMetrics([
    ['حجوزات اليوم', requests.length],
    ['بانتظار المراجعة', requests.filter(row => row.status === 'pending').length],
    ['في قائمة الدور', requests.filter(row => ['waiting', 'called', 'in_service'].includes(row.status)).length],
  ]) + (next ? card('النافذة التالية', `<p><strong>${html(next.doctor)}</strong></p>
    <p>${html(previewAppointmentLabel(next))}</p>
    <p class="meta">السعة المتبقية ${arabicCount(next.capacity - (counts.get(next.id) ?? 0))} من ${arabicCount(next.capacity)}</p>`)
    : card('النافذة التالية', empty('لا توجد نافذة متاحة', 'يمكن للمالك فتح نافذة استقبال من «الدوام».')));
}

function ownerTeam() {
  const entry = catalog()[clinic];
  const invited = state.teamInvitations.filter(row => row.clinic === clinic);
  const members = entry.doctors.map(name => `<article class="history"><strong>${html(name)}</strong>
    <p class="meta">طبيب · ${html(entry.branch ?? entry.area)}</p></article>`).join('');
  return card('فريق الفرع', members + invited.map(row => `<article class="history">
    <div class="record-heading"><strong>${html(row.name)}</strong>${pill('دعوة تجريبية معلّقة', 'pending')}</div>
    <p class="meta">${staffRoleLabels[row.role]} · ${html(entry.branch ?? entry.area)}</p>
    ${button('إلغاء الدعوة', 'clinic-invite-cancel', row.id, 'secondary')}</article>`).join(''))
    + card('دعوة موظف', `<form id="clinic-team-invite">
    ${formInput('name', 'اسم الموظف التجريبي', '', 60)}
    ${formSelect('staffRole', 'الدور', staffRoleLabels, 'reception')}
    <button>حفظ دعوة تجريبية</button></form>`);
}

function invitePreviewStaff(fields) {
  const name = textFrom(fields, 'name');
  const staffRole = textFrom(fields, 'staffRole');
  if (name.length < 2 || name.length > 60 || !Object.hasOwn(staffRoleLabels, staffRole)) {
    return feedback('أدخل اسم الموظف واختر دوره.', true);
  }
  if (state.teamInvitations.some(row => row.clinic === clinic && row.role === staffRole && searchable(row.name) === searchable(name))) {
    return feedback('توجد دعوة معلّقة لهذا الموظف.', true);
  }
  state.teamInvitations.push({ id: newId('TEAM'), clinic, name, role: staffRole });
  if (!record('حُفظت دعوة الفريق التجريبية.')) state.teamInvitations.pop();
}

function cancelPreviewStaffInvite(id) {
  const index = state.teamInvitations.findIndex(row => row.id === id && row.clinic === clinic);
  if (index < 0) return;
  const [invitation] = state.teamInvitations.splice(index, 1);
  if (!record('أُلغيت دعوة الفريق.')) state.teamInvitations.splice(index, 0, invitation);
}
