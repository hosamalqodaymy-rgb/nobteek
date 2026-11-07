import { Link, router, usePage } from '@inertiajs/react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
export default function Platform({ owners }: { owners: { id: string; username: string; display_name: string; clinic: string }[] }) {
  const { links } = usePage<Shared>().props;
  return <AccountLayout title="إدارة وصول الحسابات"><div className="page-heading"><div><p className="eyebrow">إدارة المنصة</p><h1>إدارة وصول الحسابات</h1><p className="muted">أصدر رابط استعادة بعد التحقق من هوية صاحب الحساب خارج النظام. ينهي إصدار الرابط جلساته الحالية.</p></div><Link className="btn btn--secondary" href={links['platform.clinics']}>العيادات وحسابات الملاك</Link></div><section className="account-card"><ul className="team-list">{owners.map((o, i) => <li key={`${o.id}-${i}`}><div><strong>{o.display_name}</strong><p>{o.clinic} · <bdi>{o.username}</bdi></p></div><button className="btn btn--secondary" onClick={() => router.post(`${links.platform}/${o.id}/access`)}>إصدار رابط استعادة</button></li>)}</ul>{!owners.length && <p>لم تُضف حسابات مرتبطة بعيادات بعد. ستتاح إضافتها من إعدادات العيادات.</p>}</section></AccountLayout>;
}
