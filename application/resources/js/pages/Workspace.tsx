import { Link, router, usePage } from '@inertiajs/react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
type Member = { id: string; role: string; display_name: string };
const roles: Record<string, string> = { owner: 'مالك العيادة', reception: 'موظف الاستقبال', doctor: 'الطبيب' };
export default function Workspace({ memberships, selectedMembership }: { memberships: Member[]; selectedMembership: string | null }) {
  const { auth, links } = usePage<Shared>().props;
  const selected = memberships.find(m => m.id === selectedMembership) ?? (memberships.length === 1 ? memberships[0] : null);
  return <AccountLayout title="مساحة العمل"><div className="page-heading"><div><p className="eyebrow">مساحة عملك</p><h1>مرحبًا {auth?.display_name}</h1><p className="muted">اختر العيادة التي ستعمل بها اليوم.</p></div><span className="state-pill">حساب مستقل</span></div>
    <div className="clinic-grid">{memberships.map(m => <section className={`account-card clinic-card ${selected?.id === m.id ? 'clinic-selected' : ''}`} key={m.id}><span className="state-pill">{roles[m.role]}</span><h2>{m.display_name}</h2><p className="muted">تظهر لك البيانات والإجراءات التي يسمح بها دورك.</p><button className="btn btn--secondary" onClick={() => router.post(links['clinic.select'], { membership_id: m.id })}>{selected?.id === m.id ? 'العيادة الحالية' : 'اختيار العيادة'}</button>{selected?.id === m.id && m.role === 'owner' && <div className="actions"><Link className="nav-link" href={links.team}>حسابات الفريق</Link><Link className="nav-link" href={links['clinic.settings']}>إعداد العيادة والأطباء</Link></div>}{selected?.id === m.id && m.role !== 'doctor' && <Link className="btn btn--secondary" href={links['bookings.index']}>الحجوزات ومراجعة الطلبات</Link>}{selected?.id === m.id && <Link className="btn" href={links['sessions.index']}>الجلسات ونوافذ الوصول</Link>}</section>)}</div>
    {!memberships.length && <div className="account-card"><h2>{auth?.platform_admin ? 'إدارة وصول الحسابات' : 'حسابك جاهز، وبانتظار ربط العيادة'}</h2><p className="muted">{auth?.platform_admin ? 'صلاحية إدارة المنصة لا تتيح الاطلاع تلقائيًا على بيانات المراجعين.' : 'تواصل مع مسؤول العيادة لتفعيل عضويتك.'}</p></div>}
    {auth?.platform_admin && <div className="actions"><Link className="btn" href={links['platform.clinics']}>العيادات وحسابات الملاك</Link><Link className="btn btn--secondary" href={links.platform}>إدارة وصول الحسابات</Link></div>}
    <section className="account-card account-history"><h2>حافظ على وصولك إلى الحساب</h2><p className="muted">فعّل تطبيق التحقق واحتفظ برمز استعادة خاص لتستعيد حسابك عند فقدان جهازك.</p><Link className="btn btn--secondary" href={links.security}>إعدادات أمان الحساب</Link></section>
  </AccountLayout>;
}
