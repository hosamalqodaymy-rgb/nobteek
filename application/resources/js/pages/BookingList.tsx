import { Link, router, usePage } from '@inertiajs/react';
import { useId, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { BookingRequestForm, bookingReasons, bookingSources, bookingStates, SessionWindowFields, useBookingAttempt, type BookingOption } from '../components/BookingForms';
import { dateLabel, timeLabel } from '../components/ScheduleForm';
import { OfflineNotice, Pagination } from '../components/SetupForm';
import { useBookingTransport } from '../components/BookingTransport';
export type BookingData = { id: string; display_name: string; contact_phone: string | null; state: string; version: number; source: string; session_id: string; window_id: string; doctor_name: string; window_starts_at: string; window_ends_at: string; visit_state: string | null; visit_started: boolean; has_arrived: boolean; actions: Record<string, string> };
function BookingCard({ booking: b, sessions, onSaved }: { booking: BookingData; sessions: BookingOption[]; onSaved: (s: string) => void }) {
  const uid = useId(); const a = useBookingAttempt(); const transport = useBookingTransport();
  const allowed = b.state === 'pending' ? ['confirm', 'reject', 'cancel', 'reschedule'] : b.state === 'confirmed' && !b.visit_started ? ['cancel', ...(!b.has_arrived ? ['reschedule'] : [])] : [];
  const [operation, setOperation] = useState(allowed[0] ?? ''); const [reason, setReason] = useState('booking_reviewed'); const [sessionId, setSession] = useState(''); const [windowId, setWindow] = useState('');
  const labels: Record<string, string> = { confirm: 'تأكيد الحجز', reject: 'رفض الطلب', cancel: 'إلغاء الحجز', reschedule: 'تأجيل إلى نافذة أخرى' };
  const command = allowed.includes(operation) ? operation : allowed[0] ?? '';
  return <article className="account-card booking-card">
    <div className="section-heading"><h2>{b.display_name}</h2><span className={`state-pill state-${b.state}`}>{bookingStates[b.state]}</span></div>
    <p>{b.doctor_name} · {dateLabel(b.window_starts_at)} · {timeLabel(b.window_starts_at)} – {timeLabel(b.window_ends_at)}</p>
    <p className="muted">{bookingSources[b.source]} · إصدار {b.version}{b.contact_phone && <> · <bdi>{b.contact_phone}</bdi></>}{b.has_arrived && ' · له سجل حضور'}</p>
    <p className="booking-reference muted">مرجع: <bdi>{b.id}</bdi></p>
    {allowed.length > 0 ? <form className="secure-form" onSubmit={async e => {
      e.preventDefault(); onSaved('');
      const result = await a.run(b.actions[command], { reason_code: reason, ...(command === 'reschedule' ? { session_id: sessionId, window_id: windowId } : {}) }, b.version);
      if (result) { onSaved(`تم ${command === 'confirm' ? 'تأكيد الحجز' : command === 'reject' ? 'رفض الطلب' : command === 'cancel' ? 'إلغاء الحجز' : 'تأجيل الحجز'} وتسجيل التغيير.`); transport.refresh(); }
    }}>
      <OfflineNotice online={a.online} />{a.error && <p className="account-alert account-error" role="alert">{a.error}</p>}
      <div className="account-field"><label htmlFor={`${uid}-action`}>الإجراء</label><select id={`${uid}-action`} value={command} onChange={e => { setOperation(e.target.value); setReason(e.target.value === 'confirm' ? 'booking_reviewed' : e.target.value === 'reschedule' ? 'schedule_change' : 'patient_request'); }} disabled={a.busy || a.uncertain}>{allowed.map(v => <option key={v} value={v}>{labels[v]}</option>)}</select></div>
      {command === 'reschedule' && <SessionWindowFields sessions={sessions} sessionId={sessionId} windowId={windowId} setSession={setSession} setWindow={setWindow} prefix={uid} disabled={a.busy || a.uncertain} />}
      <div className="account-field"><label htmlFor={`${uid}-reason`}>سبب الإجراء</label><select id={`${uid}-reason`} value={reason} onChange={e => setReason(e.target.value)} disabled={a.busy || a.uncertain} required>{Object.entries(bookingReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {command === 'cancel' && b.has_arrived && <p className="account-alert account-warning">سيغلق سجل الحضور قبل بدء الكشف، مع حفظ رقم التذكرة والتاريخ.</p>}
      <button className="btn" disabled={!a.online || a.busy}>{a.busy ? 'جارٍ تنفيذ الإجراء…' : a.uncertain ? 'إعادة المحاولة نفسها' : labels[command]}</button>
    </form> : <p className="muted">{b.visit_started ? 'بدأت الزيارة؛ يعالج الطبيب إنهاءها وفق دورة الزيارة.' : 'هذه الحالة محفوظة في السجل ولا تقبل إجراء حجز جديدًا.'}</p>}
  </article>;
}
export default function BookingList() {
  const { bookings, sessions, date, state, server_time, pagination, request_url, public_url, links } = usePage<Shared & { bookings: BookingData[]; sessions: BookingOption[]; date: string; state: string; server_time: string; pagination: { previous: string | null; next: string | null }; request_url: string; public_url: string }>().props;
  const transport = useBookingTransport();
  const [filterDate, setDate] = useState(date); const [filterState, setState] = useState(state); const [notice, setNotice] = useState('');
  return <AccountLayout title="الحجوزات ومراجعة الطلبات">
    <div className="page-heading"><p className="eyebrow">مساحة العيادة</p><h1>الحجوزات ومراجعة الطلبات</h1><p className="muted">راجع الطلب ثم أكده داخل السعة. الحجز المؤكد يختلف عن تسجيل الحضور والدور.</p><div className="actions"><Link className="btn btn--secondary" href={links['sessions.index']}>الجلسات والسعة</Link><a className="btn btn--secondary" href={public_url}>فتح رابط طلب العيادة</a></div></div>
    {notice && <p className="account-alert account-success" role="status">{notice}</p>}
    <section className="account-card"><h2>إضافة طلب من الاستقبال</h2><BookingRequestForm sessions={sessions} url={request_url} staff /></section>
    <section className="account-card"><h2>طلبات وحجوزات اليوم المحدد</h2><form className="secure-form booking-filters" onSubmit={e => { e.preventDefault(); router.get(links['bookings.index'], { date: filterDate, ...(filterState ? { state: filterState } : {}) }, { preserveState: true }); }}><div className="account-field"><label htmlFor="booking-date">يوم الجلسة بتوقيت اليمن</label><input id="booking-date" type="date" value={filterDate} required onChange={e => setDate(e.target.value)} /></div><div className="account-field"><label htmlFor="booking-state">حالة الحجز</label><select id="booking-state" value={filterState} onChange={e => setState(e.target.value)}><option value="">كل الحالات</option>{Object.entries(bookingStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><button className="btn btn--secondary">عرض الحجوزات</button></form><p className="muted">آخر تحديث من الخادم: {dateLabel(server_time)} · {timeLabel(server_time)}. حدّث البيانات عند حدوث تعارض.</p><button className="btn btn--quiet" onClick={() => transport.refresh()}>تحديث البيانات</button></section>
    {bookings.length ? <div className="booking-grid">{bookings.map(b => <BookingCard key={b.id} booking={b} sessions={sessions} onSaved={setNotice} />)}</div> : <section className="account-card"><h2>لا توجد حجوزات مطابقة</h2><p>غيّر اليوم أو الحالة، أو أضف طلبًا جديدًا من الاستقبال.</p></section>}
    <Pagination value={pagination} />
  </AccountLayout>;
}
