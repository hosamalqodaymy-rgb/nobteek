import { Link, router, usePage } from '@inertiajs/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { BookingRequestForm, bookingReasons, bookingSources, bookingStates, SessionWindowFields, useBookingAttempt, type BookingOption } from '../components/BookingForms';
import { dateLabel, timeLabel } from '../components/ScheduleForm';
import { OfflineNotice, Pagination } from '../components/SetupForm';
import { useBookingTransport } from '../components/BookingTransport';
import { PrivateTicketLink } from '../components/PrivateTicketLink';
export type BookingData = { id: string; display_name: string; contact_phone: string | null; state: string; version: number; source: string; session_id: string; window_id: string; doctor_name: string; window_starts_at: string; window_ends_at: string; visit_state: string | null; visit_started: boolean; has_arrived: boolean; actions: Record<string, string> };
type RecoveryRequest = { booking_id: string; display_name: string; url: string; version: number; data: { reason_code: 'patient_requested_recovery'; verified_identity: true } };
function BookingCard({ booking: b, sessions, onSaved, disabled, recoveryDisabled, onRecovery, onBlockedChange }: { booking: BookingData; sessions: BookingOption[]; onSaved: (s: string) => void; disabled: boolean; recoveryDisabled: boolean; onRecovery: (booking: BookingData) => void; onBlockedChange: (id: string, blocked: boolean) => void }) {
  const uid = useId(); const a = useBookingAttempt(); const transport = useBookingTransport();
  const allowed = b.state === 'pending' ? ['confirm', 'reject', 'cancel', 'reschedule'] : b.state === 'confirmed' && !b.visit_started ? ['cancel', ...(!b.has_arrived ? ['reschedule'] : [])] : [];
  const [operation, setOperation] = useState(allowed[0] ?? ''); const [reason, setReason] = useState('booking_reviewed'); const [sessionId, setSession] = useState(''); const [windowId, setWindow] = useState('');
  const labels: Record<string, string> = { confirm: 'تأكيد الحجز', reject: 'رفض الطلب', cancel: 'إلغاء الحجز', reschedule: 'تأجيل إلى نافذة أخرى' };
  const command = allowed.includes(operation) ? operation : allowed[0] ?? '';
  useEffect(() => { onBlockedChange(b.id, a.busy || a.uncertain); return () => onBlockedChange(b.id, false); }, [b.id, a.busy, a.uncertain, onBlockedChange]);
  return <article className="account-card booking-card" data-booking-id={b.id} data-booking-version={b.version}>
    <div className="section-heading"><h2>{b.display_name}</h2><span className={`state-pill state-${b.state}`}>{bookingStates[b.state]}</span></div>
    <p>{b.doctor_name} · {dateLabel(b.window_starts_at)} · {timeLabel(b.window_starts_at)} – {timeLabel(b.window_ends_at)}</p>
    <p className="muted">{bookingSources[b.source]} · إصدار {b.version}{b.contact_phone && <> · <bdi>{b.contact_phone}</bdi></>}{b.has_arrived && ' · له سجل حضور'}</p>
    <p className="booking-reference muted">مرجع: <bdi>{b.id}</bdi></p>
    {allowed.length > 0 ? <form className="secure-form" onSubmit={async e => {
      e.preventDefault(); if (disabled) return; onSaved('');
      const result = await a.run(b.actions[command], { reason_code: reason, ...(command === 'reschedule' ? { session_id: sessionId, window_id: windowId } : {}) }, b.version);
      if (result) { onSaved(`تم ${command === 'confirm' ? 'تأكيد الحجز' : command === 'reject' ? 'رفض الطلب' : command === 'cancel' ? 'إلغاء الحجز' : 'تأجيل الحجز'} وتسجيل التغيير.`); transport.refresh(); }
    }}>
      <OfflineNotice online={a.online} />{a.error && <p className="account-alert account-error" role="alert">{a.error}</p>}
      <div className="account-field"><label htmlFor={`${uid}-action`}>الإجراء</label><select id={`${uid}-action`} value={command} onChange={e => { setOperation(e.target.value); setReason(e.target.value === 'confirm' ? 'booking_reviewed' : e.target.value === 'reschedule' ? 'schedule_change' : 'patient_request'); }} disabled={disabled || a.busy || a.uncertain}>{allowed.map(v => <option key={v} value={v}>{labels[v]}</option>)}</select></div>
      {command === 'reschedule' && <SessionWindowFields sessions={sessions} sessionId={sessionId} windowId={windowId} setSession={setSession} setWindow={setWindow} prefix={uid} disabled={disabled || a.busy || a.uncertain} />}
      <div className="account-field"><label htmlFor={`${uid}-reason`}>سبب الإجراء</label><select id={`${uid}-reason`} value={reason} onChange={e => setReason(e.target.value)} disabled={disabled || a.busy || a.uncertain} required>{Object.entries(bookingReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {command === 'cancel' && b.has_arrived && <p className="account-alert account-warning">سيغلق سجل الحضور قبل بدء الكشف، مع حفظ رقم التذكرة والتاريخ.</p>}
      <button className="btn" disabled={disabled || !a.online || a.busy}>{a.busy ? 'جارٍ تنفيذ الإجراء…' : a.uncertain ? 'إعادة المحاولة نفسها' : labels[command]}</button>
    </form> : <p className="muted">{b.visit_started ? 'بدأت الزيارة؛ يعالج الطبيب إنهاءها وفق دورة الزيارة.' : 'هذه الحالة محفوظة في السجل ولا تقبل إجراء حجز جديدًا.'}</p>}
    {b.actions.ticket_link && <div className="booking-recovery-action"><button className="btn btn--secondary" disabled={recoveryDisabled || !a.online} onClick={() => onRecovery(b)}>استعادة رابط المتابعة</button><p className="muted">لصاحب هذا الحجز بعد التحقق من هويته. رقم الهاتف وحده لا يكفي.</p></div>}
  </article>;
}
export default function BookingList() {
  const { bookings, sessions, date, state, server_time, pagination, request_url, public_url, links } = usePage<Shared & { bookings: BookingData[]; sessions: BookingOption[]; date: string; state: string; server_time: string; pagination: { previous: string | null; next: string | null }; request_url: string; public_url: string }>().props;
  const recovery = useBookingAttempt(); const refreshGeneration = useRef(0);
  const [filterDate, setDate] = useState(date); const [filterState, setState] = useState(state); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<RecoveryRequest | null>(null); const [verified, setVerified] = useState(false);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null); const [refreshing, setRefreshing] = useState(false);
  const [otherAttempts, setOtherAttempts] = useState<Record<string, boolean>>({}); const [requestBlocked, setRequestBlocked] = useState(false);
  const otherBlocked = requestBlocked || Object.values(otherAttempts).some(Boolean);
  const blocked = recovery.busy || recovery.uncertain;
  const actionsDisabled = !!selected || refreshing;
  const onBlockedChange = useCallback((id: string, value: boolean) => setOtherAttempts(previous => previous[id] === value ? previous : { ...previous, [id]: value }), []);
  const refresh = () => { const generation = ++refreshGeneration.current; setRefreshing(true); router.reload({ only: ['bookings', 'sessions', 'server_time', 'pagination'], onFinish: () => { if (generation === refreshGeneration.current) setRefreshing(false); } }); };
  useEffect(() => {
    if (!blocked) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [blocked]);
  function chooseRecovery(booking: BookingData) {
    if (actionsDisabled || otherBlocked || !recovery.online || !booking.actions.ticket_link) return;
    setReceipt(null); setNotice(''); setVerified(false);
    setSelected({ booking_id: booking.id, display_name: booking.display_name, url: booking.actions.ticket_link, version: booking.version, data: { reason_code: 'patient_requested_recovery', verified_identity: true } });
  }
  async function recover() {
    if (!selected || !verified || recovery.busy || !recovery.online || refreshing) return;
    const result = await recovery.run(selected.url, selected.data, selected.version);
    if (result) { setReceipt(result); setSelected(null); setVerified(false); setNotice(result.replayed ? 'استعيدت نتيجة المحاولة السابقة دون إصدار رابط إضافي.' : 'تم إصدار رابط متابعة جديد وإبطال الرابط السابق.'); refresh(); }
  }
  return <AccountLayout title="الحجوزات ومراجعة الطلبات" navigationBlocked={blocked}>
    <div className="booking-workspace">
    <div className="page-heading"><p className="eyebrow">مساحة العيادة</p><h1>الحجوزات ومراجعة الطلبات</h1><p className="muted">راجع الطلب ثم أكده داخل السعة. الحجز المؤكد يختلف عن تسجيل الحضور والدور.</p><div className="actions" inert={blocked}><Link className="btn btn--secondary" href={links['sessions.index']}>الجلسات والسعة</Link><a className="btn btn--secondary" href={public_url}>فتح رابط طلب العيادة</a></div></div>
    {notice && <p className="account-alert account-success" role="status">{notice}</p>}
    {selected && <section className="account-card ticket-recovery" aria-labelledby="ticket-recovery-title"><h2 id="ticket-recovery-title">استعادة رابط هذا الحجز</h2><p>{selected.display_name}</p><p>تحقق من هوية صاحب الحجز وفق إجراء العيادة قبل تسليم الرابط. لا تعتمد على رقم الهاتف وحده؛ قد يشترك فيه أفراد الأسرة.</p><p className="account-alert account-warning">إصدار الرابط الجديد يبطل السابق. سلّمه لصاحب الحجز عبر وسيلة خاصة موثوقة.</p><form className="secure-form" onSubmit={e => { e.preventDefault(); void recover(); }}><OfflineNotice online={recovery.online} /><label className="recovery-verification"><input type="checkbox" checked={verified} disabled={blocked || refreshing} required onChange={e => setVerified(e.target.checked)} /><span>تحققت من هوية صاحب هذا الحجز وطلب استعادة رابطه</span></label>{recovery.error && <p className="account-alert account-error" role="alert">{recovery.error}</p>}{recovery.uncertain && <p>احتفظ بهذه الصفحة وأعد المحاولة نفسها. يمكنك تحديث القائمة؛ ستبقى بيانات هذه المحاولة محفوظة حتى لو تغير الحجز أو اختفى من المرشح.</p>}<div className="actions"><button className="btn" disabled={!verified || !recovery.online || recovery.busy || refreshing}>{recovery.busy ? 'جارٍ إصدار الرابط…' : recovery.uncertain ? 'إعادة المحاولة نفسها' : 'إصدار رابط جديد لصاحب الحجز'}</button>{!blocked && <button className="btn btn--quiet" type="button" disabled={refreshing} onClick={() => { setSelected(null); setVerified(false); refresh(); }}>إغلاق الاستعادة وتحديث القائمة</button>}</div></form></section>}
    {receipt && typeof receipt.ticket_url === 'string' && <section className="account-card ticket-recovery-receipt"><PrivateTicketLink url={receipt.ticket_url} expiresAt={typeof receipt.ticket_expires_at === 'string' ? receipt.ticket_expires_at : null} /><button type="button" className="btn btn--quiet" onClick={() => setReceipt(null)}>أخفيت الرابط بعد تسليمه لصاحبه</button></section>}
    <section className="account-card"><h2>إضافة طلب من الاستقبال</h2><BookingRequestForm sessions={sessions} url={request_url} staff disabled={actionsDisabled} onBlockedChange={setRequestBlocked} /></section>
    <section className="account-card"><h2>طلبات وحجوزات اليوم المحدد</h2><form className="secure-form booking-filters" onSubmit={e => { e.preventDefault(); if (!actionsDisabled) router.get(links['bookings.index'], { date: filterDate, ...(filterState ? { state: filterState } : {}) }, { preserveState: true }); }}><div className="account-field"><label htmlFor="booking-date">يوم الجلسة بتوقيت اليمن</label><input id="booking-date" type="date" value={filterDate} required disabled={actionsDisabled} onChange={e => setDate(e.target.value)} /></div><div className="account-field"><label htmlFor="booking-state">حالة الحجز</label><select id="booking-state" value={filterState} disabled={actionsDisabled} onChange={e => setState(e.target.value)}><option value="">كل الحالات</option>{Object.entries(bookingStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><button className="btn btn--secondary" disabled={actionsDisabled}>عرض الحجوزات</button></form><p className="muted">آخر تحديث من الخادم: {dateLabel(server_time)} · {timeLabel(server_time)}. حدّث البيانات عند حدوث تعارض.</p><button className="btn btn--quiet" disabled={!recovery.online || refreshing} onClick={refresh}>{refreshing ? 'جارٍ تحديث البيانات…' : 'تحديث البيانات'}</button></section>
    {bookings.length ? <div className="booking-grid">{bookings.map(b => <BookingCard key={b.id} booking={b} sessions={sessions} onSaved={setNotice} disabled={actionsDisabled} recoveryDisabled={actionsDisabled || otherBlocked} onRecovery={chooseRecovery} onBlockedChange={onBlockedChange} />)}</div> : <section className="account-card"><h2>لا توجد حجوزات مطابقة</h2><p>غيّر اليوم أو الحالة، أو أضف طلبًا جديدًا من الاستقبال.</p></section>}
    {actionsDisabled ? <p className="muted">تتاح بقية الصفحات بعد إتمام استعادة الرابط.</p> : <Pagination value={pagination} />}
    </div>
  </AccountLayout>;
}
