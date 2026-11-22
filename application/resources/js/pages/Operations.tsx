import { router, usePage } from '@inertiajs/react';
import { useRef, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { postJSON } from '../components/SessionTransport';

type Report = { date: string; timezone: string; arrivals: number; completed: number; departed: number; away: number; incomplete_times: number; measured_count: number; average_wait_minutes: number | null; average_service_minutes: number | null; total_service_minutes: number; resolved_support_count: number; total_support_minutes: number; server_time: string };
type Notification = { event_id: string; title: string; at: string; internal_state: string; external_state: string };
type Event = { event_id: string; event_type: string; reason_code: string | null; at: string };
type Support = { id: string; category: string; state: string; version: number; opened_at: string };
type Props = { report: Report; notifications: Notification[]; audit: Event[]; simulation_url: string; export_url: string; support_url: string; support_requests: Support[] };
const categories: Record<string, string> = { access: 'الدخول والحسابات', schedule: 'الجلسات والمواعيد', technical: 'مشكلة تقنية', other: 'استفسار عام' };
function minute(value: number | null) { return value === null ? 'لا تتوفر أوقات مكتملة' : value.toLocaleString('ar-YE') + ' دقيقة'; }
export default function Operations({ report, notifications, audit, simulation_url, export_url, support_url, support_requests }: Props) {
  const { links } = usePage<Shared>().props;
  const [date, setDate] = useState(report.date);
  const [category, setCategory] = useState('technical');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('sms');
  const [selected, setSelected] = useState('');
  const supportAttempt = useRef<{ category: string; key: string } | null>(null);
  const [uncertainSupport, setUncertainSupport] = useState(false);
  async function act(url: string, data: Record<string, unknown>, success: string) {
    if (busy || !navigator.onLine) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await postJSON(url, data);
      if (result.status < 200 || result.status >= 300) { setError(String(result.body.message ?? 'تعذر حفظ الإجراء')); return; }
      setNotice(success);
      router.reload({ only: ['notifications', 'audit', 'support_requests'] });
    } catch { setError('تعذر التأكد من نتيجة الاتصال. حدّث القائمة قبل إعادة الإجراء.'); }
    finally { setBusy(false); }
  }
  async function openSupport() {
    if (busy || !navigator.onLine) return;
    if (!supportAttempt.current) supportAttempt.current = { category, key: crypto.randomUUID() };
    if (supportAttempt.current.category !== category) { setError('أعد محاولة الطلب السابق قبل تغيير تصنيف المشكلة.'); return; }
    setBusy(true); setNotice(''); setError('');
    try {
      const result = await postJSON(support_url, { category }, { 'Idempotency-Key': supportAttempt.current.key });
      if (result.status >= 500) { setUncertainSupport(true); setError('لم نتأكد من الحفظ. أعد المحاولة نفسها دون تغيير النوع.'); return; }
      if (result.status < 200 || result.status >= 300) {
        setUncertainSupport(false); supportAttempt.current = null;
        setError(String(result.body.message ?? 'تعذر حفظ الطلب.')); return;
      }
      setUncertainSupport(false); supportAttempt.current = null;
      setNotice(result.body.replayed ? 'تمت استعادة نتيجة الطلب السابق دون تكرار.' : 'تم تسجيل طلب الدعم دون بيانات مراجعين.');
      router.reload({ only: ['support_requests', 'notifications', 'audit'] });
    } catch { setUncertainSupport(true); setError('انقطع الاتصال. أعد المحاولة بنفس النوع لمنع طلب دعم مكرر.'); }
    finally { setBusy(false); }
  }
  return <AccountLayout title="تقارير وتنبيهات العيادة">
    <div className="page-heading"><p className="eyebrow">لوحة مالك العيادة</p><h1>تقارير وتنبيهات العيادة</h1><p className="muted">نسخة اختبارية ببيانات صناعية. الأحداث الداخلية مسجلة، والقنوات الخارجية معطلة ولم تُرسل أي رسالة.</p>
      <div className="actions"><a className="btn btn--secondary" href={links.dashboard}>مساحة العمل</a><a className="btn btn--secondary" href={links['clinic.settings']}>إعدادات العيادة</a></div></div>
    {notice && <p className="account-alert account-success" role="status">{notice}</p>}
    {error && <p className="account-alert account-error" role="alert">{error}</p>}
    <section className="account-card"><h2>ملخص يوم العيادة</h2>
      <form className="date-filter" onSubmit={e => { e.preventDefault(); router.get(links['operations.index'], { date }); }}>
        <label htmlFor="report-date">التاريخ بتوقيت اليمن</label><input id="report-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
        <button className="btn btn--secondary">عرض التقرير</button></form>
      <div className="clinic-grid">
        {([['الحاضرون', report.arrivals], ['الزيارات المكتملة', report.completed], ['المغادرون', report.departed], ['الغائبون مؤقتًا', report.away], ['سجلات ناقصة الأوقات', report.incomplete_times], ['زيارات قابلة لقياس الوقت', report.measured_count]] as [string, number][]).map(([title, value]) => <div className="account-card" key={title}><h3>{title}</h3><p><strong>{value.toLocaleString('ar-YE')}</strong></p></div>)}
      </div>
      <p>متوسط الانتظار: <strong>{minute(report.average_wait_minutes)}</strong></p>
      <p>متوسط مدة الكشف: <strong>{minute(report.average_service_minutes)}</strong></p>
      <p>مجموع دقائق الكشف: <strong>{minute(report.total_service_minutes)}</strong></p>
      <p>دقائق الدعم المكتملة للطلبات المفتوحة في هذا اليوم: <strong>{minute(report.total_support_minutes)}</strong> · عدد الطلبات المحسومة: <strong>{report.resolved_support_count}</strong></p>
      <p className="muted">يُقاس الانتظار من الوصول إلى بدء الكشف للزيارة المكتملة ذات الأوقات الصحيحة فقط. الغائبون والمغادرون ونقص الأوقات منفصلون. لا يمثل ذلك وعدًا بموعد كشف.</p>
      <a className="btn btn--secondary" href={export_url + '?date=' + encodeURIComponent(report.date)}>تصدير التقرير CSV بصلاحية مالك وتحقق حديث</a>
    </section>
    <section className="account-card"><h2>التنبيهات الداخلية</h2><p className="muted">سجل قراءة فقط من أحداث العمليات؛ لكل حدث سجل واحد لا يعني وصول رسالة للمراجع.</p>
      {notifications.length ? <ul className="team-list">{notifications.map(n => <li key={n.event_id}><div><strong>{n.title}</strong><p className="muted">{new Date(n.at).toLocaleString('ar-YE', { timeZone: 'Asia/Aden' })} · مسجل داخليًا، غير مُرسل</p></div><button className="btn btn--quiet" type="button" onClick={() => setSelected(n.event_id)}>اختيار للمحاكاة</button></li>)}</ul> : <p>لا توجد أحداث محفوظة.</p>}
      <h3>محاكاة قناة خارجية دون إرسال</h3><p className="muted">المحاكاة لا تحتاج رقم هاتف ولا عنوان بريد، ولا تُغيّر حالة صندوق الإرسال الحقيقي.</p>
      <div className="actions"><label htmlFor="simulation-channel">القناة</label><select id="simulation-channel" value={channel} onChange={e => setChannel(e.target.value)}><option value="sms">رسالة نصية</option><option value="whatsapp">واتساب</option><option value="email">بريد إلكتروني</option></select>
        <button className="btn btn--secondary" disabled={!selected || busy} onClick={() => void act(simulation_url, { event_id: selected, channel }, 'تم تسجيل محاكاة فقط؛ لم تُرسل رسالة خارجية.')}>محاكاة الحدث المحدد</button></div>
      {selected && <p className="muted">الحدث المحدد: <bdi>{selected}</bdi></p>}
    </section>
    <section className="account-card"><h2>طلبات الدعم</h2><p className="muted">اختر نوع المشكلة فقط؛ لا تضع اسم مراجع أو رقم هاتف أو تفاصيل طبية.</p>
      <form className="secure-form" onSubmit={e => { e.preventDefault(); void openSupport(); }}>
        <label htmlFor="support-category">نوع الطلب</label><select id="support-category" value={category} disabled={uncertainSupport || busy} onChange={e => setCategory(e.target.value)}>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        <button className="btn" disabled={busy}>{uncertainSupport ? 'إعادة المحاولة نفسها' : 'فتح طلب دعم'}</button></form>
      {support_requests.length ? <ul className="team-list">{support_requests.map(s => <li key={s.id}><div><strong>{categories[s.category] ?? 'استفسار'}</strong><p className="muted">{s.state === 'open' ? 'مفتوح' : 'تمت معالجته'} · {new Date(s.opened_at).toLocaleString('ar-YE', { timeZone: 'Asia/Aden' })}</p></div></li>)}</ul> : <p>لا توجد طلبات دعم.</p>}
    </section>
    <section className="account-card"><h2>سجل التدقيق المختصر</h2><p className="muted">نوع الحدث وسببه وتوقيته فقط، دون بيانات المراجعين أو محتوى الرسائل.</p>
      {audit.length ? <ul className="team-list">{audit.map(e => <li key={e.event_id}><div><strong>{e.event_type}</strong><p className="muted">{e.reason_code ?? 'بلا سبب مدرج'} · {new Date(e.at).toLocaleString('ar-YE', { timeZone: 'Asia/Aden' })}</p></div></li>)}</ul> : <p>لا توجد أحداث تدقيق.</p>}
    </section>
  </AccountLayout>;
}
