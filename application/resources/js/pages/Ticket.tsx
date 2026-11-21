import { usePage } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PublicLayout, type PublicShared } from '../components/PublicLayout';
import { PrivateTicketLink } from '../components/PrivateTicketLink';
import { subscribePrivateTicketFragment, takePrivateTicketFragment } from '../components/PrivateTicketFragment';
import { PollingNotice, readPublicJSON, usePublicPolling } from '../components/PublicPolling';
import { dateLabel, timeLabel } from '../components/ScheduleForm';

type TicketData = {
  booking_state: 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'fulfilled';
  visit_state: 'waiting' | 'called' | 'in_service' | 'away' | 'completed' | 'left' | null;
  ticket_number: number | null; waiting_ahead: number | null; doctor_state: 'available' | 'called' | 'in_service';
  session_state: 'scheduled' | 'open' | 'paused' | 'closed'; window_starts_at: string; window_ends_at: string;
  server_time: string; booking_version: number; visit_version: number | null;
};
const ticketFields = ['booking_state', 'visit_state', 'ticket_number', 'waiting_ahead', 'doctor_state', 'session_state', 'window_starts_at', 'window_ends_at', 'server_time', 'booking_version', 'visit_version'];
function validTicket(data: unknown): data is TicketData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const integer = (value: unknown) => Number.isInteger(value) && Number(value) > 0;
  return Object.keys(d).length === ticketFields.length && ticketFields.every(key => key in d)
    && ['pending', 'confirmed', 'rejected', 'cancelled', 'fulfilled'].includes(String(d.booking_state))
    && (d.visit_state === null || ['waiting', 'called', 'in_service', 'away', 'completed', 'left'].includes(String(d.visit_state)))
    && ['available', 'called', 'in_service'].includes(String(d.doctor_state)) && ['scheduled', 'open', 'paused', 'closed'].includes(String(d.session_state))
    && (d.ticket_number === null || integer(d.ticket_number)) && (d.waiting_ahead === null || (Number.isInteger(d.waiting_ahead) && Number(d.waiting_ahead) >= 0))
    && integer(d.booking_version) && (d.visit_version === null || integer(d.visit_version))
    && ['window_starts_at', 'window_ends_at', 'server_time'].every(key => typeof d[key] === 'string' && Number.isFinite(Date.parse(String(d[key]))));
}
function status(data: TicketData): { title: string; text: string } {
  if (data.booking_state === 'pending') return { title: 'طلبك قيد المراجعة', text: 'لم يتأكد الحجز بعد. الطلب لا يحجز مكانًا ولا يمنح رقم دور. تابع رد العيادة قبل الحضور.' };
  if (data.booking_state === 'rejected') return { title: 'لم يُقبل طلب الحجز', text: 'راجع العيادة لمعرفة الخيارات المتاحة. لا يتيح هذا الطلب حضورًا مؤكدًا.' };
  if (data.booking_state === 'cancelled') return { title: 'الحجز ملغى', text: 'لم يعد هذا الحجز صالحًا للحضور. تواصل مع العيادة قبل تقديم طلب آخر.' };
  if (data.visit_state === 'completed' || data.booking_state === 'fulfilled') return { title: 'اكتملت زيارتك', text: 'حُفظ اكتمال الزيارة في سجل العيادة. شكرًا لك.' };
  if (data.visit_state === 'called') return { title: 'تم استدعاء رقمك', text: 'توجّه إلى الاستقبال أو غرفة الطبيب بحسب تنظيم العيادة.' };
  if (data.visit_state === 'in_service') return { title: 'الزيارة جارية', text: 'سُجل بدء الكشف. ستتحدث هذه الصفحة عند اكتمال الزيارة.' };
  if (data.visit_state === 'away') return { title: 'سُجل غياب مؤقت', text: 'عند عودتك، راجع الاستقبال لتسجيل العودة إلى نهاية الانتظار. يبقى رقم تذكرتك ثابتًا.' };
  if (data.visit_state === 'left') return { title: 'سُجلت مغادرتك', text: 'أُغلق هذا الحضور مع حفظ تذكرته وتاريخه. راجع الاستقبال إذا احتجت خدمة أخرى.' };
  if (data.visit_state === 'waiting') return { title: 'أنت في قائمة الانتظار', text: 'الترتيب يتأثر بالحضور والأولوية الطبية المسجلة. انتبه إلى النداء داخل العيادة.' };
  return { title: 'الحجز مؤكد · لم يسجل الحضور', text: 'احضر خلال نافذة الوصول وراجع الاستقبال لتسجيل حضورك. يصدر رقم الدور بعد تسجيل الحضور.' };
}
const sessionLabels = { scheduled: 'الجلسة مجدولة ولم تفتح بعد', open: 'الجلسة مفتوحة', paused: 'النداء متوقف مؤقتًا', closed: 'الجلسة مغلقة' };
const doctorLabels = { available: 'لا توجد زيارة نشطة لدى الطبيب', called: 'لدى الطبيب مراجع مستدعى', in_service: 'الطبيب يجري كشفًا الآن' };

export default function Ticket({ read_url, poll_seconds }: { read_url: string; poll_seconds: number }) {
  const { links } = usePage<PublicShared>().props;
  const [secret, setSecret] = useState(''); const [resolved, setResolved] = useState(false);
  const consumedFragment = useRef(false);
  useEffect(() => {
    if (!consumedFragment.current) { consumedFragment.current = true; setSecret(takePrivateTicketFragment()); setResolved(true); }
    return subscribePrivateTicketFragment(value => { setSecret(value); setResolved(true); });
  }, []);
  const read = useCallback(async (signal: AbortSignal) => {
    const result = await readPublicJSON<TicketData>(read_url, signal, { Authorization: `Bearer ${secret}` }, 'omit');
    if (result.data !== null && !validTicket(result.data)) throw new Error('Invalid ticket data');
    return result;
  }, [read_url, secret]);
  const poll = usePublicPolling(read, !!secret, poll_seconds);
  const data = poll.data; const state = data ? status(data) : null;
  const originalLink = secret ? new URL(links['public.ticket'], window.location.origin).href + '#' + secret : '';
  return <PublicLayout title="متابعة الحجز والدور" narrow>
    <div className="page-heading"><p className="eyebrow">رابط المراجع الخاص</p><h1>متابعة الحجز والدور</h1><p className="muted">حالة هذا الحجز فقط، دون حساب مراجع أو بيانات الآخرين.</p></div>
    {resolved && !secret ? <section className="account-card"><h2>افتح رابطك الخاص</h2><p>أعد فتح الرابط الأصلي الذي حفظته عند تقديم الطلب أو الذي سلّمته لك العيادة. لا يمكن الوصول إلى حجز برقم الهاتف أو رقم التذكرة وحده.</p><a className="btn btn--secondary" href={links['public.help'] + '#lost-link'}>فقدت رابط المتابعة</a></section> : <>
      <PollingNotice {...poll} hasData={!!data} />
      {poll.unavailable ? <section className="account-card" role="status"><h2>الرابط غير متاح أو انتهت صلاحيته</h2><p>قد يكون الرابط غير صحيح أو انتهى أو استُبدل برابط جديد. راجع العيادة لاستعادته بعد التحقق من هويتك.</p><a className="btn btn--secondary" href={links['public.help'] + '#lost-link'}>مساعدة استعادة الرابط</a></section> : <>
        {data && state && <section className="account-card ticket-status" data-booking-state={data.booking_state} data-visit-state={data.visit_state ?? 'none'} aria-labelledby="ticket-state-title">
          <span className={`state-pill state-${data.booking_state}`}>{data.booking_state === 'pending' ? 'قيد المراجعة · غير مؤكد' : data.booking_state === 'confirmed' ? 'حجز مؤكد' : data.booking_state === 'fulfilled' ? 'حجز مستوفى' : data.booking_state === 'rejected' ? 'طلب مرفوض' : 'حجز ملغى'}</span>
          <h2 id="ticket-state-title">{state.title}</h2><p>{state.text}</p>
          {data.ticket_number !== null && <div className="ticket-number"><span>رقم تذكرتك الثابت</span><strong data-ticket-number>{data.ticket_number}</strong></div>}
          {data.visit_state === 'waiting' && data.waiting_ahead !== null && <section className="ticket-waiting" aria-label="عدد المنتظرين أمامك"><h3>المنتظرون الحاضرون أمامك</h3><strong data-waiting-ahead>{data.waiting_ahead}</strong><p>هذا العدد لا يشمل الزيارة الحالية لدى الطبيب ولا الحجوزات التي لم تسجل حضورها. لا يحدد وقت كشف دقيقًا.</p></section>}
          <div className="ticket-session-state"><p><strong>{sessionLabels[data.session_state]}</strong></p><p>{doctorLabels[data.doctor_state]}</p>{data.session_state === 'paused' && <p>لا يجري استدعاء جديد أثناء التوقف. قد يستكمل الطبيب الزيارة الحالية.</p>}{data.session_state === 'closed' && !['completed', 'left'].includes(data.visit_state ?? '') && data.booking_state !== 'fulfilled' && <p className="account-alert account-warning">الجلسة مغلقة. راجع العيادة قبل الحضور؛ لا تعرض هذه الصفحة موعدًا بديلًا.</p>}</div>
          <h3>نافذة الوصول بتوقيت اليمن</h3><p>{dateLabel(data.window_starts_at)} · {timeLabel(data.window_starts_at)} – {timeLabel(data.window_ends_at)}</p><p className="muted">نافذة الوصول فترة للحضور وليست موعد كشف بالدقيقة.</p>
          <p className="muted ticket-updated">آخر تحديث مؤكد: <time dateTime={data.server_time}>{dateLabel(data.server_time)} · {timeLabel(data.server_time)}</time>{poll.stale && ' · بيانات قديمة'}</p>
        </section>}
        <div className="ticket-refresh"><button className="btn btn--secondary" disabled={!poll.online || poll.loading || !secret} onClick={poll.refresh}>تحديث حالة الحجز</button><p className="muted">تُراجع الحالة كل 20 ثانية عند ظهور الصفحة والاتصال بالشبكة.</p></div>
      </>}
      {originalLink && !poll.unavailable && <section className="account-card ticket-save"><PrivateTicketLink url={originalLink} /><p className="muted">بعد إعادة تحميل الصفحة افتح الرابط المحفوظ من جديد. لا يحتفظ التطبيق بنسخة منه على هذا الجهاز.</p></section>}
    </>}
  </PublicLayout>;
}
