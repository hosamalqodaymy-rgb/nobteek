import { router, usePage } from '@inertiajs/react';
import { useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { postJSON } from '../components/SessionTransport';
type Case = { id: string; category: string; state: string; version: number; opened_at: string; resolved_at: string | null; clinic_name: string };
type Event = { event_type: string; at: string };
const types: Record<string, string> = { access: 'وصول الحسابات', schedule: 'جلسات', technical: 'تقنية', other: 'عام' };
export default function PlatformOperations({ cases, security_events, clinic_summary, resolve_url }: { cases: Case[]; security_events: Event[]; clinic_summary: { total: number; active: number; suspended: number }; resolve_url: string }) {
  const { links } = usePage<Shared>().props; const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function resolve(item: Case) {
    if (busy || !navigator.onLine) return;
    if (!window.confirm('تأكيد معالجة طلب الدعم؟ هذه العملية تسجل في تدقيق المنصة.')) return;
    setBusy(item.id); setError(''); setNotice('');
    try {
      const result = await postJSON(resolve_url.replace('SUPPORT_ID_PLACEHOLDER', item.id), { version: item.version, reason_code: 'support_resolved' });
      if (result.status < 200 || result.status >= 300) { setError(String(result.body.message ?? 'تعذر تحديث الطلب.')); return; }
      setNotice('تم تسجيل معالجة الطلب.'); router.reload({ only: ['cases', 'security_events', 'clinic_summary'] });
    } catch { setError('انقطع الاتصال. حدّث القائمة قبل إعادة الإجراء حتى لا تتكرر المحاولة.'); }
    finally { setBusy(''); }
  }
  return <AccountLayout title="دعم وتدقيق المنصة"><div className="p10-platform">
    <div className="page-heading"><p className="eyebrow">مدير المنصة</p><h1>دعم العيادات والتدقيق</h1><p className="muted">متابعة تشغيلية دون الوصول إلى بيانات المرضى أو تفعيل الاشتراكات المالية.</p>
      <div className="actions"><a className="btn btn--secondary" href={links['platform.clinics']}>قائمة العيادات</a><a className="btn btn--secondary" href={links.platform}>إدارة الحسابات</a></div></div>
    {error && <p className="account-alert account-error" role="alert">{error}</p>}{notice && <p className="account-alert account-success" role="status">{notice}</p>}
    <section className="account-card"><h2>ملخص العيادات</h2><p>الإجمالي: <strong>{clinic_summary.total}</strong> · الفعالة: <strong>{clinic_summary.active}</strong> · الموقوفة: <strong>{clinic_summary.suspended}</strong></p><p className="muted">هذه الأرقام حالة تشغيلية وليست اشتراكات مدفوعة.</p></section>
    <section className="account-card"><h2>طلبات الدعم الأخيرة</h2>
      {cases.length ? <ul className="team-list">{cases.map(item => <li key={item.id}><div><strong>{item.clinic_name}</strong><p>{types[item.category] ?? item.category} · {item.state === 'open' ? 'مفتوح' : 'تمت المعالجة'} · إصدار {item.version}</p><p className="muted">{new Date(item.opened_at).toLocaleString('ar-YE', { timeZone: 'Asia/Aden' })}</p></div>{item.state === 'open' && <button className="btn btn--secondary" disabled={!!busy} onClick={() => void resolve(item)}>اعتماد المعالجة</button>}</li>)}</ul> : <p>لا توجد طلبات دعم.</p>}
    </section>
    <section className="account-card"><h2>سجل أمان المنصة</h2><p className="muted">أنواع الأحداث وأوقاتها فقط، دون معلومات المرضى أو الأسرار أو بيانات دخول الحسابات.</p>
      {security_events.length ? <ul className="team-list">{security_events.map((item, i) => <li key={i}><div><strong>{item.event_type}</strong><p className="muted">{new Date(item.at).toLocaleString('ar-YE', { timeZone: 'Asia/Aden' })}</p></div></li>)}</ul> : <p>لا توجد أحداث أمان.</p>}
    </section>
  </div></AccountLayout>;
}
