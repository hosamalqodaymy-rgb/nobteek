import { Link, router, usePage } from '@inertiajs/react';
import { useEffect, useId, useRef, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { useBookingAttempt } from '../components/BookingForms';
import { bookingTransport } from '../components/BookingTransport';
import { dateLabel, timeLabel } from '../components/ScheduleForm';
import { OfflineNotice, Pagination } from '../components/SetupForm';
import { postJSON } from '../components/SessionTransport';

type CommandName = 'call_next' | 'start' | 'complete' | 'priority' | 'correct' | 'mark_away' | 'leave' | 'pause' | 'resume';
type Command = { url: string; data: Record<string, unknown>; version: number; label: string; subject: string };
type Session = {
  id: string; doctor_id: string; doctor_name: string; starts_at: string; ends_at: string; state: string; version: number; intake_ended: boolean;
  availability: 'available' | 'busy' | 'delayed' | 'paused' | 'scheduled' | 'closed';
  actions: Partial<Record<'call_next' | 'pause' | 'resume', string>>;
};
type Visit = {
  id: string; booking_id: string; booking_state: string; booking_version: number; session_id: string; doctor_id: string; display_name: string;
  ticket_number: number; ready_sequence: number; waiting_position: number | null; priority: boolean; state: string; version: number;
  arrived_at: string; called_at: string | null; started_at: string | null; completed_at: string | null; returned_at: string | null;
  actions: Partial<Record<'start' | 'complete' | 'priority' | 'correct' | 'mark_away' | 'leave', string>>;
  events: { event_type: string; reason_code: string | null; at: string; safe_changes: unknown }[];
};
type ReasonOptions = Partial<Record<CommandName, string[]>>;
type DoctorProps = Shared & {
  date: string; session_id: string; state: string; permissions: { can_practice: boolean; delegated_call_next: boolean };
  sessions: Session[]; selected_session: Session | null; active_visit: Visit | null; visits: Visit[];
  summary: { waiting: number; away: number; completed: number; left: number };
  pagination: { previous: string | null; next: string | null }; reason_options: ReasonOptions; server_time: string;
};
const visitStates: Record<string, string> = { waiting: 'منتظر', called: 'مستدعى', in_service: 'داخل الكشف', away: 'غائب مؤقتًا', completed: 'اكتملت الزيارة', left: 'غادر' };
const availabilityLabels: Record<Session['availability'], string> = { available: 'متاح للاستدعاء', busy: 'لديه زيارة نشطة', delayed: 'متأخر · الجلسة متوقفة مؤقتًا', paused: 'الجلسة متوقفة مؤقتًا', scheduled: 'الجلسة لم تفتح بعد', closed: 'الجلسة مغلقة' };
const commandLabels: Record<CommandName, string> = { call_next: 'استدعاء التالي', start: 'بدء الكشف', complete: 'إنهاء الزيارة', priority: 'اعتماد أولوية طبية', correct: 'تسجيل تصحيح في السجل', mark_away: 'تسجيل غياب مؤقت', leave: 'تسجيل مغادرة نهائية', pause: 'إيقاف الاستدعاء مؤقتًا', resume: 'استئناف الاستدعاء' };
const reasonLabels: Record<string, string> = { clinical_priority: 'أولوية طبية بقرار الطبيب', administrative_correction: 'تصحيح إداري موثق', entered_in_error: 'تسجيل إدخال وقع بالخطأ', operational_pause: 'توقف تشغيلي مؤقت', doctor_delayed: 'تأخر الطبيب', service_resumed: 'استئناف الخدمة', temporarily_absent: 'غياب مؤقت بطلب المراجع', not_present: 'تحقق الطبيب من عدم وجود المراجع', patient_left: 'غادر المراجع' };
const eventLabels: Record<string, string> = { visit_check_in: 'تسجيل الحضور', visit_call_next: 'استدعاء المراجع', visit_called: 'استدعاء المراجع', visit_start: 'بدء الكشف', visit_started: 'بدء الكشف', visit_complete: 'إنهاء الزيارة', visit_completed: 'إنهاء الزيارة', visit_priority: 'اعتماد أولوية طبية', visit_correct: 'تسجيل تصحيح', visit_corrected: 'تسجيل تصحيح', visit_mark_away: 'تسجيل غياب مؤقت', visit_return: 'تسجيل العودة', visit_leave: 'تسجيل المغادرة', visit_defer: 'إرجاء إلى نهاية الدور' };
const reloadProps = ['date', 'session_id', 'state', 'sessions', 'selected_session', 'active_visit', 'visits', 'summary', 'pagination', 'permissions', 'reason_options', 'server_time'];
const transport = { post: postJSON, refresh() { router.reload({ only: reloadProps }); } };

function ReasonAction({ action, url, version, subject, options, disabled, submit }: {
  action: CommandName; url: string; version: number; subject: string; options: string[]; disabled: boolean; submit: (command: Command) => Promise<void>;
}) {
  const uid = useId(); const [chosen, setChosen] = useState(options[0] ?? '');
  const reason = options.includes(chosen) ? chosen : options[0] ?? '';
  return <form className="secure-form doctor-reason-action" onSubmit={e => {
    e.preventDefault(); if (!disabled && reason) void submit({ url, version, subject, label: commandLabels[action], data: { reason_code: reason } });
  }}>
    <div className="account-field"><label htmlFor={uid}>{'سبب ' + commandLabels[action]}</label><select id={uid} value={reason} disabled={disabled} required onChange={e => setChosen(e.target.value)}>{options.map(code => <option key={code} value={code}>{reasonLabels[code] ?? 'سبب إداري مسجل'}</option>)}</select></div>
    {action === 'priority' && <p className="muted">الأولوية بقرار الطبيب دون تسجيل تشخيص. يبقى رقم التذكرة ثابتًا ولا تتغير الزيارة النشطة. إعادة اعتمادها تضعها بعد الأولويات المعتمدة قبلها.</p>}
    {action === 'correct' && <p className="muted">يحفظ هذا الإجراء تصحيحًا في السجل مع السبب. تبقى حالة الزيارة وأوقاتها محفوظة، ولا يعيد فتح زيارة مكتملة.</p>}
    {action === 'leave' && <p className="account-alert account-warning">مغادرة نهائية لهذا الحضور؛ يبقى الرقم والتاريخ محفوظين ولا يعود من إجراء العودة.</p>}
    <button className="btn btn--secondary" disabled={disabled || !reason}>{commandLabels[action]}</button>
  </form>;
}

function VisitCard({ visit, current = false, canPractice, reasonOptions, disabled, submit }: {
  visit: Visit; current?: boolean; canPractice: boolean; reasonOptions: ReasonOptions; disabled: boolean; submit: (command: Command) => Promise<void>;
}) {
  const subject = visit.display_name + ' · التذكرة ' + visit.ticket_number;
  const reasonActions = (['priority', 'mark_away', 'leave', 'correct'] as const).filter(action => canPractice && visit.actions[action]);
  return <article className={'account-card doctor-visit' + (current ? ' doctor-current-visit' : '')} data-visit-id={visit.id}>
    <div className="section-heading"><h2>{visit.display_name}</h2><span className={'state-pill state-' + visit.state}>{visitStates[visit.state]}</span></div>
    {visit.priority && <p className="state-pill state-warning">أولوية طبية مسجلة</p>}
    <dl className="reception-ticket"><div><dt>رقم التذكرة الثابت</dt><dd>{visit.ticket_number}</dd></div><div><dt>موضع الانتظار الآن</dt><dd>{visit.waiting_position ?? 'خارج الانتظار'}</dd></div></dl>
    <dl className="stat-list doctor-times">
      <div><dt>الحضور</dt><dd>{timeLabel(visit.arrived_at)}</dd></div>
      {visit.called_at && <div><dt>الاستدعاء</dt><dd>{timeLabel(visit.called_at)}</dd></div>}
      {visit.started_at && <div><dt>بدء الكشف</dt><dd>{timeLabel(visit.started_at)}</dd></div>}
      {visit.completed_at && <div><dt>نهاية الزيارة</dt><dd>{timeLabel(visit.completed_at)}</dd></div>}
    </dl>
    <p className="muted">إصدار الزيارة {visit.version}{visit.booking_state === 'fulfilled' && ' · الحجز مستوفى'}</p>
    {canPractice && <div className="actions doctor-primary-actions">{(['start', 'complete'] as const).map(action => visit.actions[action] && <button className="btn" key={action} disabled={disabled} onClick={() => void submit({ url: visit.actions[action]!, data: {}, version: visit.version, label: commandLabels[action], subject })}>{commandLabels[action]}</button>)}</div>}
    {!!reasonActions.length && <details className="doctor-visit-actions"><summary>إجراءات الزيارة المسجلة</summary><div className="doctor-reason-grid">{reasonActions.map(action => <ReasonAction key={action} action={action} url={visit.actions[action]!} version={visit.version} subject={subject} options={reasonOptions[action] ?? []} disabled={disabled} submit={submit} />)}</div></details>}
    {!!visit.events.length && <details className="doctor-event-history"><summary>سجل الزيارة</summary><ul className="event-list">{visit.events.map((event, index) => <li key={event.at + ':' + event.event_type + ':' + index}><span>{eventLabels[event.event_type] ?? 'إجراء محفوظ'}{event.reason_code && reasonLabels[event.reason_code] && ' · ' + reasonLabels[event.reason_code]}</span><time dateTime={event.at}>{dateLabel(event.at)} · {timeLabel(event.at)}</time></li>)}</ul></details>}
  </article>;
}

function DoctorScreen() {
  const props = usePage<DoctorProps>().props;
  const { date, session_id, state, permissions, sessions, selected_session, active_visit, visits, summary, pagination, reason_options, server_time, links } = props;
  const attempt = useBookingAttempt(); const [pending, setPending] = useState<Command | null>(null);
  const [notice, setNotice] = useState(''); const [refreshing, setRefreshing] = useState(false);
  const refreshGeneration = useRef(0);
  const [day, setDay] = useState(date); const [session, setSession] = useState(session_id); const [filter, setFilter] = useState(state);
  useEffect(() => { setDay(date); setSession(session_id); setFilter(state); }, [date, session_id, state]);
  const blocked = attempt.busy || attempt.uncertain;
  const disabled = blocked || refreshing || !attempt.online;
  const refresh = () => { const generation = ++refreshGeneration.current; setRefreshing(true); router.reload({ only: reloadProps, onFinish: () => { if (generation === refreshGeneration.current) setRefreshing(false); } }); };
  async function submit(command: Command) {
    if (blocked || refreshing || !attempt.online) return;
    setPending(command); setNotice('');
    const result = await attempt.run(command.url, command.data, command.version);
    if (result) { setPending(null); setNotice('تم حفظ الإجراء: ' + command.label + (result.ticket_number ? ' · رقم التذكرة ' + String(result.ticket_number) : '')); refresh(); }
  }
  async function retry() {
    if (!pending || attempt.busy || !attempt.online) return;
    const result = await attempt.run(pending.url, pending.data, pending.version);
    if (result) { setPending(null); setNotice('تم تأكيد الإجراء: ' + pending.label + (result.replayed ? ' · استعيدت نتيجة المحاولة السابقة دون تكرار أثرها.' : '')); refresh(); }
  }
  const listedVisits = visits.filter(visit => visit.id !== active_visit?.id);
  return <AccountLayout title="شاشة الطبيب">
    <div className="doctor-workspace">
      <div className="page-heading"><div><p className="eyebrow">مساحة العيادة</p><h1>شاشة الطبيب</h1><p className="muted">الاستدعاء ثم بدء الكشف وإنهاؤه، مع حفظ أوقات الخادم ورقم التذكرة.</p></div><Link className="btn btn--secondary" href={links['sessions.index']}>الجلسات ونوافذ الوصول</Link></div>
      {permissions.delegated_call_next && !permissions.can_practice && <p className="account-alert account-warning">لديك تفويض لاستدعاء التالي فقط. يبدأ الطبيب المخول الكشف وينهيه ويعتمد الأولوية الطبية.</p>}
      <OfflineNotice online={attempt.online} />
      {attempt.busy && pending && <p className="account-alert" role="status">جارٍ حفظ {pending.label}… احتفظ بهذه الصفحة حتى تأكيد النتيجة.</p>}
      {notice && <p className="account-alert account-success" role="status">{notice}</p>}
      {attempt.error && <section className="account-alert account-error doctor-command-state" role="alert"><h2>نتيجة الإجراء</h2><p>{attempt.error}</p>{pending && <p>{pending.label} · {pending.subject}</p>}{attempt.uncertain && <><p>احتفظ بهذه الصفحة وأعد المحاولة نفسها قبل أي إجراء آخر. يمكنك تحديث القائمة مع بقاء المحاولة محفوظة.</p><button className="btn" disabled={!attempt.online || attempt.busy} onClick={() => void retry()}>{attempt.busy ? 'جارٍ التحقق من النتيجة…' : 'إعادة المحاولة نفسها'}</button></>}</section>}
      <section className="account-card doctor-selection" aria-labelledby="doctor-selection-title"><h2 id="doctor-selection-title">اليوم والجلسة</h2><form className="secure-form doctor-filters" onSubmit={e => {
        e.preventDefault(); if (!disabled) router.get(links['doctor.index'], { date: day, ...(session ? { session_id: session } : {}), state: filter }, { preserveState: true });
      }}>
        <div className="account-field"><label htmlFor="doctor-date">يوم العيادة بتوقيت اليمن</label><input id="doctor-date" type="date" value={day} required disabled={disabled} onChange={e => { setDay(e.target.value); setSession(''); }} /></div>
        <div className="account-field"><label htmlFor="doctor-session">جلسة الطبيب</label><select id="doctor-session" value={session} disabled={disabled} onChange={e => setSession(e.target.value)}><option value="">اختر جلسة اليوم</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.doctor_name} · {timeLabel(item.starts_at)} – {timeLabel(item.ends_at)}</option>)}</select></div>
        <div className="account-field"><label htmlFor="doctor-state">حالة الزيارات المعروضة</label><select id="doctor-state" value={filter} disabled={disabled} onChange={e => setFilter(e.target.value)}>{Object.entries(visitStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <button className="btn btn--secondary" disabled={disabled}>عرض جلسة الطبيب</button>
      </form><div className="doctor-refresh"><p className="muted">آخر تحديث: {dateLabel(server_time)} · {timeLabel(server_time)}</p><button className="btn btn--quiet" disabled={!attempt.online || refreshing} onClick={refresh}>{refreshing ? 'جارٍ تحديث قائمة الطبيب…' : 'تحديث قائمة الطبيب'}</button></div></section>
      {selected_session ? <>
        <section className="account-card doctor-session-state" aria-label="حالة جلسة الطبيب"><div className="section-heading"><h2>{selected_session.doctor_name}</h2><span className="state-pill">{availabilityLabels[selected_session.availability]}</span></div><p>{dateLabel(selected_session.starts_at)} · {timeLabel(selected_session.starts_at)} – {timeLabel(selected_session.ends_at)}</p>
          {selected_session.intake_ended && <p className="account-alert account-warning">انتهى استقبال حضور جديد. تستمر معالجة من سجلوا حضورهم حتى إتمام القائمة.</p>}
          {selected_session.actions.call_next ? <button className="btn doctor-call-next" disabled={disabled} onClick={() => void submit({ url: selected_session.actions.call_next!, data: {}, version: selected_session.version, label: commandLabels.call_next, subject: selected_session.doctor_name })}>استدعاء التالي</button> : <p className="muted">الاستدعاء الجديد يتطلب جلسة مفتوحة ومراجعًا منتظرًا وطبيبًا دون زيارة نشطة.</p>}
          {permissions.can_practice && (selected_session.actions.pause || selected_session.actions.resume) && <details className="doctor-session-actions"><summary>تنظيم الاستدعاء والتأخر</summary><div className="doctor-reason-grid">{(['pause', 'resume'] as const).map(action => selected_session.actions[action] && <ReasonAction key={action} action={action} url={selected_session.actions[action]!} version={selected_session.version} subject={selected_session.doctor_name} options={reason_options[action] ?? []} disabled={disabled} submit={submit} />)}</div><p className="muted">التوقف يمنع استدعاء جديد، ويسمح ببدء الزيارة المستدعاة وإتمامها.</p></details>}
        </section>
        <div className="reception-summary" aria-label="ملخص جلسة الطبيب"><div className="account-card"><strong>{summary.waiting}</strong><span>منتظرون</span></div><div className="account-card"><strong>{summary.away}</strong><span>غائبون مؤقتًا</span></div><div className="account-card"><strong>{summary.completed}</strong><span>زيارات مكتملة</span></div><div className="account-card"><strong>{summary.left}</strong><span>غادروا</span></div></div>
      </> : <section className="account-card"><h2>لا توجد جلسة متاحة لهذا اليوم</h2><p>اختر يومًا آخر أو راجع إعداد الجلسات مع مسؤول العيادة.</p></section>}
      <section className="doctor-active" aria-labelledby="doctor-active-title"><h2 id="doctor-active-title">الزيارة الحالية للطبيب</h2>{active_visit ? <>
        {active_visit.session_id !== selected_session?.id && <p className="account-alert account-warning">الزيارة الحالية من جلسة أخرى للطبيب نفسه. يجب معالجتها قبل استدعاء مراجع من الجلسة المحددة.</p>}
        <VisitCard visit={active_visit} current canPractice={permissions.can_practice} reasonOptions={reason_options} disabled={disabled} submit={submit} />
      </> : <p className="account-alert">لا توجد زيارة مستدعاة أو داخل الكشف لهذا الطبيب.</p>}</section>
      <section className="doctor-list" aria-labelledby="doctor-list-title"><h2 id="doctor-list-title">المنتظرون وسجل الزيارات</h2><p className="muted">الأولوية الطبية أولًا، ثم ترتيب الحضور الفعلي. رقم التذكرة ثابت وموضع الانتظار يتغير.</p>{listedVisits.length ? <div className="booking-grid">{listedVisits.map(visit => <VisitCard key={visit.id} visit={visit} canPractice={permissions.can_practice} reasonOptions={reason_options} disabled={disabled} submit={submit} />)}</div> : <div className="account-card"><h3>{visits.length ? 'الزيارة المطابقة ظاهرة في البطاقة الحالية' : 'لا توجد زيارات مطابقة'}</h3><p>اختر حالة أخرى من مرشح الزيارات أو حدّث القائمة بعد تسجيل الحضور.</p></div>}{blocked ? <p className="muted">تتاح بقية صفحات القائمة بعد تأكيد نتيجة الإجراء الحالي.</p> : <Pagination value={pagination} />}</section>
    </div>
  </AccountLayout>;
}

export default function Doctor() { return <bookingTransport.Provider value={transport}><DoctorScreen /></bookingTransport.Provider>; }
