import { Link } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { AccountLayout } from '../components/AccountLayout';

type Session = { id: string; doctor_name: string; starts_at: string; state: string; version: number; issued_tickets: number; not_arrived: number; waiting: number; called: number; in_service: number; away: number; completed: number; left: number };
type Snapshot = { date: string; server_time: string; sessions: Session[]; synchronized: boolean };
const stateNames: Record<string,string> = { scheduled:'مجدولة',open:'مفتوحة',paused:'متوقفة مؤقتًا',closed:'مغلقة' };
function time(value: string) { return new Date(value).toLocaleString('ar-YE',{timeZone:'Asia/Aden'}); }

type OutageProps = Snapshot & { status_url: string; doctor_url: string | null; reception_url: string | null; bookings_url: string | null };

export default function Outage({ date, server_time, sessions, status_url, doctor_url, reception_url, bookings_url }: OutageProps) {
  const [snapshot,setSnapshot] = useState<Snapshot>({date,server_time,sessions,synchronized:true});
  const [connected,setConnected] = useState(typeof navigator==='undefined' ? true : navigator.onLine);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [clock,setClock] = useState(()=>performance.now());
  const [lastConfirmedAt,setLastConfirmedAt] = useState(()=>performance.now());
  const [checked,setChecked] = useState<string[]>([]);
  const pending = useRef<AbortController | null>(null);

  async function refresh() {
    if (pending.current) return;
    if (!navigator.onLine) {
      setConnected(false);
      setError('الاتصال غير مؤكد. لا تنفذ أي حفظ أو إصدار تذكرة.');
      return;
    }

    const request = new AbortController();
    pending.current = request;
    const timeout = window.setTimeout(() => request.abort(), 8000);
    setBusy(true);
    try {
      const response = await fetch(status_url, {
        headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal: request.signal,
      });
      if (!response.ok) throw new Error('server');
      const payload=await response.json() as Snapshot;
      if (!payload.synchronized || !Array.isArray(payload.sessions)) throw new Error('invalid');
      if (pending.current !== request) return;
      if (request.signal.aborted || !navigator.onLine) throw new Error('disconnected');

      const verifiedAt = performance.now();
      setSnapshot(payload);
      setLastConfirmedAt(verifiedAt);
      setClock(verifiedAt);
      setConnected(true);
      setError('');
    } catch {
      if (pending.current === request) {
        setConnected(false);
        setError('تعذر التحقق من الخادم وقاعدة البيانات. آخر بيانات محفوظة بالصفحة قديمة؛ لا تصدر تذاكر بناءً عليها.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    const cancelRefresh = () => {
      const request = pending.current;
      pending.current = null;
      request?.abort();
    };
    const invalidate = (message: string) => {
      cancelRefresh();
      setBusy(false);
      setConnected(false);
      setError(message);
    };
    const online = () => invalidate('عاد اتصال الجهاز؛ تحقّق من الخادم قبل المطابقة.');
    const offline = () => invalidate('الاتصال منقطع؛ توقفت العمليات الإلكترونية. استخدم السجل الورقي مؤقتًا.');
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) invalidate('استُعيدت الصفحة من سجل المتصفح؛ تحقّق من الخادم قبل المطابقة.');
    };
    const interval = window.setInterval(() => setClock(performance.now()), 5000);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pageshow', restored);
    return () => {
      cancelRefresh();
      window.clearInterval(interval);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pageshow', restored);
    };
  }, [status_url]);
  const stale=clock-lastConfirmedAt>30000;
  const valid=connected&&!stale&&!error;
  const tasks=[
    'تسجيل وقت وصول المراجع واسم المراجع ورقم الهاتف على الورق فقط، دون إدخاله في حقل غير مصرح أو تخزينه على الجهاز.',
    'اكتب اسم الجلسة والطبيب ووقت العملية ورقم مرجع ورقي مختلف بوضوح عن رقم التذكرة الإلكتروني.',
    'لا تعلن رقم تذكرة إلكترونية جديدة أو تأكيد حجز في أثناء انقطاع الخادم.',
    'بعد عودة الاتصال تحقق من عدادات الجلسات وقائمة الحجوزات والزيارات في الخادم.',
    'طابق كل ورقة مع السجل الموجود أولًا، ثم استخدم إجراء الحضور أو الحجز العادي عند الحاجة وبمفتاح محاولة جديد لعملية جديدة فقط.',
    'إذا ظهر حفظ سابق أو تذكرة بالفعل، لا تنشئ طلبًا ثانيًا؛ اطلب مراجعة المالك عند اختلاف السجل.',
  ];
  return <AccountLayout title="خطة الانقطاع والمطابقة">
    <div className="page-heading"><div><p className="eyebrow">P11 · سلامة التشغيل</p><h1>الانقطاع والمطابقة مع السجل الورقي</h1><p className="muted">السجل الورقي المؤقت خارج النظام، ولا تعطي هذه الصفحة أرقام تذاكر أو تحفظ أي بيانات مراجعين على جهازك.</p></div>
      <div className="actions">
        {doctor_url && <Link className="btn btn--secondary" href={doctor_url}>شاشة الطبيب</Link>}
        {reception_url && <Link className="btn btn--secondary" href={reception_url}>الاستقبال</Link>}
        {bookings_url && <Link className="btn btn--secondary" href={bookings_url}>الحجوزات</Link>}
      </div></div>
    {!valid ? <div role="alert" className="account-alert account-warning"><strong>وضع احتياطي — لا يوجد تأكيد حي من الخادم.</strong><p>{error || 'بيانات الجلسات قديمة؛ تحديث مطلوب.'}</p><p>لا تفسّر ظهور الإنترنت وحده على أنه نجاح الحفظ.</p></div>
      : <p className="account-alert account-success" role="status">الخادم متصل وقاعدة البيانات أجابت. آخر قراءة: {time(snapshot.server_time)}</p>}
    <section className="account-card"><h2>التحقق من الحالة الحية</h2>
      <p className="muted">تُعرض معلومات الجلسات العددية فقط دون أسماء المرضى أو أرقام هواتفهم. القراءة اليدوية لا تغيّر أرقام الدور.</p>
      <button className="btn" type="button" disabled={busy} onClick={()=>void refresh()}>{busy?'جارٍ فحص الاتصال…':'فحص الخادم وتحديث الأعداد'}</button>
      <p className="muted">آخر قراءة من الخادم: {time(snapshot.server_time)} {stale?'· قديمة':''}</p>
      <div className="clinic-grid">{snapshot.sessions.map(s=><div className="account-card" key={s.id}>
        <h3>{s.doctor_name}</h3><p className="muted">{time(s.starts_at)} · {stateNames[s.state]??s.state}</p>
        <p>تذاكر صادرة: <strong>{s.issued_tickets}</strong> · إصدار الجلسة: <strong>{s.version}</strong></p>
        <p>مؤكدون دون حضور: {s.not_arrived} · منتظرون: {s.waiting} · مستدعون: {s.called} · داخل الكشف: {s.in_service}</p>
        <p>غائبون: {s.away} · مكتملون: {s.completed} · مغادرون: {s.left}</p></div>)}</div>
      {snapshot.sessions.length===0&&<p>لا توجد جلسات ضمن اليوم المحدد.</p>}
    </section>
    <section className="account-card p11-paper"><h2>إجراءات بديلة ومطابقة بعد العودة</h2>
      <p className="muted">حدد البنود أدناه للمتابعة خلال هذه الجلسة فقط؛ لا تحفظ الصفحة قائمة مراجعين ولا ترسل أوامر آليًا عند عودة الاتصال.</p>
      <ol>{tasks.map((label,i)=><li key={i}><label className="p11-step"><input type="checkbox" checked={checked.includes(String(i))} onChange={e=>setChecked(old=>e.target.checked?[...old,String(i)]:old.filter(x=>x!==String(i)))} /><span>{label}</span></label></li>)}</ol>
      <div className="actions"><button className="btn btn--secondary" type="button" onClick={()=>window.print()}>طباعة التعليمات ونموذج ورقي فارغ</button></div>
      <div className="p11-print-only"><h3>دفتر أعمال الانقطاع — ورقي فقط</h3><p>العيادة: __________ التاريخ: __________ الموظف: __________</p><p>مرجع الورقة: __________ الجلسة: __________ وقت الوصول: __________</p><p>اسم المراجع: __________________ الهاتف عند الحاجة: __________________</p><p>نتيجة المطابقة بعد الاتصال: __________________ توقيع الموظف: __________</p></div>
    </section>
  </AccountLayout>;
}
