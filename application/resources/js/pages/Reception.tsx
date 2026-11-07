import { Link, router, usePage } from '@inertiajs/react';
import { useId, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { bookingStates, SessionWindowFields, useBookingAttempt, type BookingOption } from '../components/BookingForms';
import { bookingTransport, useBookingTransport } from '../components/BookingTransport';
import { dateLabel, timeLabel } from '../components/ScheduleForm';
import { OfflineNotice, Pagination } from '../components/SetupForm';
import { postJSON } from '../components/SessionTransport';

type ReceptionSession = BookingOption & { state: string; accepting_arrivals: boolean; walk_in_url: string; windows: (BookingOption['windows'][number] & { capacity: number; reserved: number })[] };
type Arrival = {
  booking_id: string; booking_state: string; booking_version: number; source: string; session_id: string;
  display_name: string; contact_phone: string | null; doctor_name: string; window_starts_at: string; window_ends_at: string;
  visit: null | { id: string; state: string; version: number; ticket_number: number; ready_sequence: number; waiting_position: number | null; priority: boolean; arrived_at: string; returned_at: string | null };
  actions: Record<string, string>;
};
const visitStates: Record<string, string> = { waiting: 'منتظر', called: 'مستدعى', in_service: 'داخل الكشف', away: 'غائب مؤقتًا', completed: 'اكتملت الزيارة', left: 'غادر' };
const commands: Record<string, string> = { 'mark-away': 'غياب مؤقت', return: 'تسجيل العودة', leave: 'مغادرة نهائية', defer: 'إرجاء إلى نهاية الدور' };
const reasons: Record<string, Record<string, string>> = {
  'mark-away': { temporarily_absent: 'غياب مؤقت بطلب المراجع', not_present: 'تحقق الموظف من عدم وجوده' },
  return: { patient_returned: 'عاد المراجع وتم التحقق من وجوده' },
  leave: { patient_left: 'غادر المراجع', entered_in_error: 'تصحيح حضور أدخل بالخطأ' },
  defer: { patient_request: 'طلب المراجع التأخر في الدور', administrative_correction: 'تصحيح إداري مصرح' },
};
const transport = { post: postJSON, refresh() { router.reload({ only: ['arrivals', 'sessions', 'summary', 'server_time'] }); } };

function ArrivalAction({ row, saved }: { row: Arrival; saved: (s: string) => void }) {
  const uid = useId(); const attempt = useBookingAttempt(); const api = useBookingTransport();
  const available = Object.keys(row.actions);
  const [chosen, setChosen] = useState(available[0] ?? '');
  const command = available.includes(chosen) ? chosen : available[0] ?? '';
  const [reason, setReason] = useState(Object.keys(reasons[command] ?? {})[0] ?? '');
  const blocked = attempt.busy || attempt.uncertain;
  if (!available.length) return <p className="muted">{row.visit ? 'حالة محفوظة في السجل؛ إجراءات الكشف من اختصاص الطبيب.' : 'يلزم تأكيد الحجز أولًا من شاشة مراجعة الطلبات.'}</p>;
  const arrival = command === 'check-in';
  return <form className="secure-form reception-action" onSubmit={async e => {
    e.preventDefault(); saved('');
    const result = await attempt.run(row.actions[command], arrival ? {} : { reason_code: reason }, arrival ? row.booking_version : row.visit!.version);
    if (result) { saved(arrival ? 'تم تسجيل الحضور · رقم التذكرة ' + String(result.ticket_number) : 'تم حفظ إجراء الاستقبال مع السبب.'); api.refresh(); }
  }}>
    <OfflineNotice online={attempt.online} />
    {attempt.error && <p className="account-alert account-error" role="alert">{attempt.error}</p>}
    {!arrival && <>
      <div className="account-field"><label htmlFor={uid + '-action'}>إجراء الحضور</label><select id={uid + '-action'} value={command} disabled={blocked} onChange={e => { setChosen(e.target.value); setReason(Object.keys(reasons[e.target.value])[0]); }}>{available.map(value => <option value={value} key={value}>{commands[value]}</option>)}</select></div>
      <div className="account-field"><label htmlFor={uid + '-reason'}>سبب إجراء الحضور</label><select id={uid + '-reason'} value={reason} disabled={blocked} required onChange={e => setReason(e.target.value)}>{Object.entries(reasons[command] ?? {}).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      {command === 'return' && <p className="muted">ستعود إلى نهاية المنتظرين بنفس رقم التذكرة، حتى بعد نهاية وقت استقبال حضور جديد.</p>}
      {command === 'leave' && <p className="account-alert account-warning">مغادرة نهائية لهذا الحضور. لا يمكن إعادته من إجراء العودة، وسيبقى رقمه وسجله محفوظين.</p>}
      {command === 'defer' && <p className="muted">إجراء مصرح للمالك ينقل المنتظر إلى النهاية دون تقديم أحد على الحالة النشطة أو تغيير أولوية طبية.</p>}
    </>}
    <button className="btn" disabled={!attempt.online || attempt.busy}>{attempt.busy ? 'جارٍ حفظ الحضور…' : attempt.uncertain ? 'إعادة المحاولة نفسها' : arrival ? 'تسجيل الحضور وإصدار التذكرة' : commands[command]}</button>
  </form>;
}

function WalkInForm({ sessions, serverTime, saved }: { sessions: ReceptionSession[]; serverTime: string; saved: (s: string) => void }) {
  const uid = useId(); const attempt = useBookingAttempt(); const api = useBookingTransport();
  const [session, setSession] = useState(''); const [window, setWindow] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const now = new Date(serverTime).getTime();
  const current = sessions.filter(s => s.accepting_arrivals).map(s => ({ ...s, windows: s.windows.filter(w => new Date(w.starts_at).getTime() <= now && now < new Date(w.ends_at).getTime() && w.reserved < w.capacity) })).filter(s => s.windows.length);
  const blocked = attempt.busy || attempt.uncertain;
  if (receipt) return <div className="account-alert account-success" role="status"><h3>تم حفظ الحضور المباشر</h3><p>رقم التذكرة: <strong>{String(receipt.ticket_number)}</strong>. يظهر موضع الانتظار في قائمة الجلسة.</p><button className="btn btn--secondary" onClick={() => { setReceipt(null); setName(''); setPhone(''); }}>إضافة مراجع آخر</button></div>;
  if (!current.length) return <p className="account-alert account-warning">لا توجد نافذة وصول جارية بسعة متاحة للحضور المباشر في هذا اليوم. حدّث البيانات أو راجع الجلسات والسعة.</p>;
  return <form className="secure-form walk-in-form" onSubmit={async e => {
    e.preventDefault();
    const target = current.find(s => s.id === session);
    if (!target) return;
    const result = await attempt.run(target.walk_in_url, { window_id: window, display_name: name, contact_phone: phone || null });
    if (result) { setReceipt(result); saved('تم حفظ الحجز المؤكد والحضور المباشر معًا.'); api.refresh(); }
  }}>
    <OfflineNotice online={attempt.online} />{attempt.error && <p className="account-alert account-error" role="alert">{attempt.error}</p>}
    <SessionWindowFields sessions={current} sessionId={session} windowId={window} setSession={setSession} setWindow={setWindow} disabled={blocked} prefix={uid} />
    <div className="account-field"><label htmlFor={uid + '-name'}>اسم المراجع المباشر</label><input id={uid + '-name'} value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required disabled={blocked} autoComplete="off" /></div>
    <div className="account-field"><label htmlFor={uid + '-phone'}>جوال المراجع المباشر · اختياري</label><input id={uid + '-phone'} type="tel" inputMode="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} disabled={blocked} autoComplete="off" /><small>يمكن تركه فارغًا. رقم الأسرة لا يدمج أشخاصًا مختلفين.</small></div>
    <p className="muted">يضيف هذا الإجراء حجزًا مؤكدًا وحضورًا معًا داخل السعة المتاحة. استخدم تسجيل الحضور في البطاقة إذا كان للمراجع حجز مؤكد بالفعل.</p>
    <button className="btn" disabled={!attempt.online || attempt.busy}>{attempt.busy ? 'جارٍ إضافة الحضور…' : attempt.uncertain ? 'إعادة المحاولة نفسها' : 'حفظ الحضور المباشر وإصدار التذكرة'}</button>
  </form>;
}

function ReceptionScreen() {
  const { arrivals, sessions, date, session_id, search, state, summary, server_time, pagination, links } = usePage<Shared & {
    arrivals: Arrival[]; sessions: ReceptionSession[]; date: string; session_id: string; search: string; state: string;
    summary: { waiting: number; away: number; not_arrived: number }; server_time: string; pagination: { previous: string | null; next: string | null };
  }>().props;
  const [day, setDay] = useState(date); const [session, setSession] = useState(session_id);
  const [query, setQuery] = useState(search); const [filter, setFilter] = useState(state); const [notice, setNotice] = useState('');
  return <AccountLayout title="الاستقبال والحضور">
    <div className="page-heading"><p className="eyebrow">مساحة العيادة</p><h1>الاستقبال والحضور</h1><p className="muted">رقم التذكرة ثابت، وموضع الانتظار يتغير حسب الحضور والعودة. تسجيل الحجز وحده لا يعني الوصول.</p><div className="actions"><Link className="btn btn--secondary" href={links['bookings.index']}>الحجوزات ومراجعة الطلبات</Link><Link className="btn btn--secondary" href={links['sessions.index']}>الجلسات والسعة</Link></div></div>
    <div className="reception-summary" aria-label="ملخص الحضور"><div className="account-card"><strong>{summary.waiting}</strong><span>منتظرون حاضرون</span></div><div className="account-card"><strong>{summary.away}</strong><span>غائبون مؤقتًا</span></div><div className="account-card"><strong>{summary.not_arrived}</strong><span>مؤكدون لم يسجلوا الحضور</span></div></div>
    {notice && <p className="account-alert account-success" role="status">{notice}</p>}
    <section className="account-card"><h2>قائمة اليوم والبحث</h2><form className="secure-form reception-filters" onSubmit={e => {
      e.preventDefault(); router.get(links['reception.index'], { date: day, ...(session ? { session_id: session } : {}), ...(query ? { search: query } : {}), ...(filter ? { state: filter } : {}) }, { preserveState: true });
    }}>
      <div className="account-field"><label htmlFor="reception-date">يوم الاستقبال بتوقيت اليمن</label><input id="reception-date" type="date" value={day} required onChange={e => { setDay(e.target.value); setSession(''); }} /></div>
      <div className="account-field"><label htmlFor="reception-session">جلسة الاستقبال</label><select id="reception-session" value={session} onChange={e => setSession(e.target.value)}><option value="">كل جلسات اليوم</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.doctor_name} · {timeLabel(s.starts_at)}</option>)}</select></div>
      <div className="account-field"><label htmlFor="reception-search">بحث بالاسم أو رقم التذكرة</label><input id="reception-search" value={query} maxLength={80} onChange={e => setQuery(e.target.value)} autoComplete="off" /><small>الاسم من حرفين، أو رقم التذكرة كاملًا؛ داخل اليوم والعيادة فقط.</small></div>
      <div className="account-field"><label htmlFor="reception-state">حالة الحضور</label><select id="reception-state" value={filter} onChange={e => setFilter(e.target.value)}><option value="">كل الحالات</option><option value="not_arrived">مؤكد لم يحضر</option>{Object.entries(visitStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <button className="btn btn--secondary">عرض قائمة الاستقبال</button>
    </form><p className="muted">آخر تحديث: {dateLabel(server_time)} · {timeLabel(server_time)}. موضع الانتظار محسوب بين المنتظرين في الجلسة نفسها، حتى عند البحث.</p><button className="btn btn--quiet" onClick={() => transport.refresh()}>تحديث قائمة الحضور</button></section>
    <section className="account-card"><details><summary>إضافة حضور مباشر</summary><WalkInForm sessions={sessions} serverTime={server_time} saved={setNotice} /></details></section>
    {arrivals.length ? <div className="booking-grid">{arrivals.map(row => <article className="account-card reception-card" key={row.booking_id}>
      <div className="section-heading"><h2>{row.display_name}</h2><span className={'state-pill state-' + (row.visit?.state ?? row.booking_state)}>{row.visit ? visitStates[row.visit.state] : bookingStates[row.booking_state]}</span></div>
      <p>{row.doctor_name} · {dateLabel(row.window_starts_at)} · {timeLabel(row.window_starts_at)} – {timeLabel(row.window_ends_at)}</p>
      {row.contact_phone && <p className="muted">للتواصل: <bdi>{row.contact_phone}</bdi></p>}
      {row.visit ? <><dl className="reception-ticket"><div><dt>رقم التذكرة الثابت</dt><dd>{row.visit.ticket_number}</dd></div><div><dt>موضع الانتظار الآن</dt><dd>{row.visit.waiting_position ?? 'خارج الانتظار'}</dd></div></dl><p className="muted">حضر {timeLabel(row.visit.arrived_at)}{row.visit.returned_at && ' · آخر عودة ' + timeLabel(row.visit.returned_at)} · إصدار الحضور {row.visit.version}</p></> : <p className="muted">لم يصدر رقم تذكرة؛ {row.booking_state === 'confirmed' ? 'سجل الوصول عند حضور المراجع.' : 'راجع حالة الحجز قبل تسجيل الحضور.'}</p>}
      <ArrivalAction key={row.visit ? row.visit.id + ':' + row.visit.version : row.booking_id} row={row} saved={setNotice} />
    </article>)}</div> : <section className="account-card"><h2>لا توجد نتائج مطابقة</h2><p>غيّر اليوم أو الجلسة أو البحث، أو أضف حضورًا مباشرًا داخل الوقت والسعة.</p></section>}
    <Pagination value={pagination} />
  </AccountLayout>;
}

export default function Reception() { return <bookingTransport.Provider value={transport}><ReceptionScreen /></bookingTransport.Provider>; }
