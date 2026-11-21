import { useCallback } from 'react';
import { PublicLayout } from '../components/PublicLayout';
import { PollingNotice, readPublicJSON, usePublicPolling } from '../components/PublicPolling';
import { dateLabel, timeLabel } from '../components/ScheduleForm';

type RoomData = { doctor_id: string; session_state: 'scheduled' | 'open' | 'paused' | 'closed'; called_ticket_numbers: number[]; next_ticket_numbers: number[]; server_time: string };
const fields = ['doctor_id', 'session_state', 'called_ticket_numbers', 'next_ticket_numbers', 'server_time'];
function validRoom(value: unknown): value is RoomData {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return Object.keys(d).length === fields.length && fields.every(k => k in d) && typeof d.doctor_id === 'string'
    && ['scheduled', 'open', 'paused', 'closed'].includes(String(d.session_state)) && typeof d.server_time === 'string' && Number.isFinite(Date.parse(d.server_time))
    && ['called_ticket_numbers', 'next_ticket_numbers'].every(key => Array.isArray(d[key]) && (d[key] as unknown[]).every(n => Number.isInteger(n) && Number(n) > 0));
}
const states = { scheduled: 'الجلسة لم تفتح بعد', open: 'الجلسة مفتوحة', paused: 'النداء متوقف مؤقتًا', closed: 'الجلسة مغلقة' };
export default function WaitingRoom({ read_url, poll_seconds }: { read_url: string; poll_seconds: number }) {
  const read = useCallback(async (signal: AbortSignal) => {
    const response = await readPublicJSON<RoomData>(read_url, signal);
    if (response.data !== null && !validRoom(response.data)) throw new Error('Invalid waiting room data');
    return response;
  }, [read_url]);
  const poll = usePublicPolling(read, true, poll_seconds); const data = poll.data;
  return <PublicLayout title="شاشة الانتظار">
    <div className="page-heading"><p className="eyebrow">أرقام الدور في الجلسة المحددة</p><h1>شاشة الانتظار</h1><p className="muted">تعرض هذه الشاشة الأرقام دون أسماء المراجعين أو هواتفهم.</p></div>
    <PollingNotice {...poll} hasData={!!data} />
    {poll.unavailable ? <section className="account-card" role="status"><h2>تعذر فتح شاشة هذه الجلسة</h2><p>يحتاج موظف العيادة إلى تسجيل الدخول بصلاحية مناسبة ثم فتح الشاشة من الجلسة المحددة.</p></section> : data && <>
      <section className="account-card room-session"><h2>{states[data.session_state]}</h2><p className="muted">جلسة الطبيب التي اختارها موظف العيادة لهذه الشاشة</p>{data.session_state === 'paused' && <p>انتظر إعلان استئناف النداء. قد يستكمل الطبيب الزيارة الحالية.</p>}{data.session_state === 'closed' && <p>انتهى عمل هذه الجلسة. راجع الاستقبال لأي استفسار.</p>}</section>
      <div className="waiting-room-grid"><section className="account-card room-current"><h2>الدور الحالي في هذه الجلسة</h2><p className="muted">المستدعى أو داخل الكشف</p>{data.called_ticket_numbers.length ? <ul className="room-numbers" aria-label="أرقام الدور الحالي">{data.called_ticket_numbers.map(n => <li key={n}>{n}</li>)}</ul> : <p className="room-empty">لا يوجد دور نشط في هذه الجلسة</p>}</section>
      <section className="account-card"><h2>الأرقام التالية في الانتظار</h2>{data.next_ticket_numbers.length ? <ol className="room-numbers room-next" aria-label="أرقام الانتظار التالية">{data.next_ticket_numbers.map(n => <li key={n}>{n}</li>)}</ol> : <p className="room-empty">لا توجد أرقام منتظرة في هذه الجلسة</p>}<p className="muted">الترتيب يتبع الحضور والأولوية الطبية. لا تعني القائمة وقت كشف محددًا.</p></section></div>
      <p className="muted">آخر تحديث مؤكد: <time dateTime={data.server_time}>{dateLabel(data.server_time)} · {timeLabel(data.server_time)}</time>{poll.stale && ' · بيانات قديمة'}</p>
    </>}
    <button className="btn btn--secondary" disabled={!poll.online || poll.loading} onClick={poll.refresh}>تحديث شاشة الانتظار</button><p className="muted">تُراجع الشاشة كل 5 ثوانٍ أثناء ظهورها، ويتوقف التحديث عند إخفائها.</p>
  </PublicLayout>;
}
