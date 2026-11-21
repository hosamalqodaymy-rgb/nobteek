import { useEffect, useId, useRef, useState } from 'react';
import { dateLabel, timeLabel } from './ScheduleForm';
import { useBookingTransport } from './BookingTransport';
import { OfflineNotice, useOnline } from './SetupForm';
import { PrivateTicketLink } from './PrivateTicketLink';

export type BookingOption = { id: string; doctor_name: string; starts_at: string; windows: { id: string; starts_at: string; ends_at: string }[] };
export const bookingStates: Record<string, string> = { pending: 'قيد المراجعة', confirmed: 'مؤكد', rejected: 'مرفوض', cancelled: 'ملغى', fulfilled: 'منجز' };
export const bookingSources: Record<string, string> = { web: 'طلب ويب', phone: 'اتصال هاتفي', walk_in: 'من العيادة' };
export const bookingReasons: Record<string, string> = { booking_reviewed: 'مراجعة الطلب واعتماده', capacity_full: 'اكتمال السعة', patient_request: 'طلب المراجع', clinic_unavailable: 'تعذر استقبال العيادة', duplicate_request: 'طلب مكرر تحقق منه الموظف', contact_unreachable: 'تعذر التواصل', schedule_change: 'تغيير الجدول', entered_in_error: 'خطأ إدخال' };
export function useBookingAttempt() {
  const transport = useBookingTransport(); const online = useOnline(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const inFlight = useRef(false);
  async function run(url: string, data: Record<string, unknown>, version?: number) {
    if (!online || inFlight.current) return null;
    const signature = JSON.stringify({ url, data, version });
    if (attempt.current?.signature !== signature) {
      if (uncertain) { setError('لم نتأكد من نتيجة المحاولة السابقة. أعد الطلب نفسه قبل تغيير البيانات.'); return null; }
      attempt.current = { signature, key: crypto.randomUUID() };
    }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await transport.post(url, data, { 'Idempotency-Key': attempt.current.key, ...(version === undefined ? {} : { 'If-Match': `"${version}"` }) });
      if (result.status >= 500) { setUncertain(true); setError('تعذر التأكد من الحفظ. أعد المحاولة نفسها؛ سيمنع النظام تكرار أثرها.'); return null; }
      setUncertain(false);
      if (result.status < 200 || result.status >= 300) {
        const details = result.body.errors && typeof result.body.errors === 'object' ? Object.values(result.body.errors).flat().join(' · ') : '';
        setError(details || String(result.body.message ?? 'تعذر إتمام الطلب.')); return null;
      }
      attempt.current = null;
      return result.body;
    } catch { setUncertain(true); setError('انقطع الاتصال قبل تأكيد النتيجة. احتفظ بهذه الصفحة وأعد المحاولة نفسها عند عودة الاتصال.'); return null; }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { run, busy, error, uncertain, online };
}
export function SessionWindowFields({ sessions, sessionId, windowId, setSession, setWindow, disabled = false, prefix }: { sessions: BookingOption[]; sessionId: string; windowId: string; setSession: (s: string) => void; setWindow: (w: string) => void; disabled?: boolean; prefix: string }) {
  const selected = sessions.find(s => s.id === sessionId);
  return <>
    <div className="account-field"><label htmlFor={`${prefix}-session`}>الطبيب والجلسة</label><select id={`${prefix}-session`} value={sessionId} disabled={disabled} required onChange={e => { setSession(e.target.value); setWindow(''); }}><option value="">اختر جلسة</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.doctor_name} · {dateLabel(s.starts_at)} · {timeLabel(s.starts_at)}</option>)}</select></div>
    <div className="account-field"><label htmlFor={`${prefix}-window`}>نافذة الوصول</label><select id={`${prefix}-window`} value={windowId} disabled={disabled || !selected} required onChange={e => setWindow(e.target.value)}><option value="">اختر نافذة وصول</option>{selected?.windows.map(w => <option key={w.id} value={w.id}>{timeLabel(w.starts_at)} – {timeLabel(w.ends_at)}</option>)}</select><small>الأوقات بتوقيت اليمن. نافذة الوصول لا تعني موعد كشف دقيقًا.</small></div>
  </>;
}
export function BookingRequestForm({ sessions, url, staff = false, disabled = false, onBlockedChange }: { sessions: BookingOption[]; url: string; staff?: boolean; disabled?: boolean; onBlockedChange?: (blocked: boolean) => void }) {
  const uid = useId(); const a = useBookingAttempt(); const transport = useBookingTransport();
  const [sessionId, setSession] = useState(''); const [windowId, setWindow] = useState(''); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [source, setSource] = useState('phone');
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const blocked = disabled || a.busy || a.uncertain;
  useEffect(() => { onBlockedChange?.(a.busy || a.uncertain); return () => onBlockedChange?.(false); }, [a.busy, a.uncertain, onBlockedChange]);
  if (receipt) return <div className="account-alert account-success" role="status"><h2>تم حفظ الطلب · قيد المراجعة</h2><p>لم يتأكد الحجز بعد ولم يصدر رقم دور. {staff ? 'راجع الطلب في القائمة ثم أكده إذا كانت السعة متاحة.' : 'تواصل مع العيادة لتأكيد قبول الطلب قبل الحضور.'}</p>{staff && <p>مرجع الطلب: <bdi className="booking-reference">{String(receipt.id)}</bdi></p>}{typeof receipt.ticket_url === 'string' && <PrivateTicketLink url={receipt.ticket_url} expiresAt={typeof receipt.ticket_expires_at === 'string' ? receipt.ticket_expires_at : null} />}<button className="btn btn--secondary" disabled={disabled} onClick={() => { setReceipt(null); setName(''); setPhone(''); }}>تقديم طلب آخر</button></div>;
  return <form className="secure-form" onSubmit={async e => {
    e.preventDefault(); if (disabled) return;
    const result = await a.run(url, { session_id: sessionId, window_id: windowId, display_name: name, contact_phone: phone || null, ...(staff ? { source } : {}) });
    if (result) { setReceipt(result); if (staff) transport.refresh(); }
  }}>
    <OfflineNotice online={a.online} />
    {a.error && <p className="account-alert account-error" role="alert">{a.error}</p>}
    <SessionWindowFields sessions={sessions} sessionId={sessionId} windowId={windowId} setSession={setSession} setWindow={setWindow} prefix={uid} disabled={blocked} />
    <div className="account-field"><label htmlFor={`${uid}-name`}>اسم المراجع</label><input id={`${uid}-name`} value={name} disabled={blocked} onChange={e => setName(e.target.value)} autoComplete="off" minLength={2} maxLength={80} required /></div>
    {staff && <div className="account-field"><label htmlFor={`${uid}-source`}>مصدر الحجز</label><select id={`${uid}-source`} value={source} disabled={blocked} onChange={e => setSource(e.target.value)}><option value="phone">اتصال هاتفي</option><option value="walk_in">من العيادة</option></select></div>}
    <div className="account-field"><label htmlFor={`${uid}-phone`}>رقم التواصل {staff && source === 'walk_in' ? '· اختياري' : ''}</label><input id={`${uid}-phone`} type="tel" dir="ltr" inputMode="tel" autoComplete="off" value={phone} disabled={blocked} onChange={e => setPhone(e.target.value)} maxLength={40} required={!staff || source !== 'walk_in'} aria-describedby={`${uid}-phone-hint`} /><small id={`${uid}-phone-hint`}>رقم يمني من تسعة أرقام يبدأ بسبعة. يمكن استخدام رقم الأسرة لأكثر من مراجع دون دمجهم.</small></div>
    <p className="muted">هذا طلب حجز قيد المراجعة. لا يحجز مكانًا ولا يسجل الحضور أو يمنح رقم دور قبل تأكيد العيادة.</p>
    <button className="btn" disabled={disabled || !a.online || a.busy || sessions.length === 0}>{a.busy ? 'جارٍ إرسال الطلب…' : a.uncertain ? 'إعادة المحاولة نفسها' : 'إرسال طلب الحجز'}</button>
  </form>;
}
