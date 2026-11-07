import { Link, usePage } from '@inertiajs/react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
export default function Error({ status, message }: { status: number; message: string }) {
  const { links } = usePage<Shared>().props;
  return <AccountLayout title="تعذر إتمام الطلب" narrow><section className="account-card"><p className="eyebrow">{status}</p><h1>تعذر إتمام الطلب</h1><p role="alert">{message}</p><div className="actions"><Link className="btn" href={status === 423 ? links.security : links.login}>{status === 423 ? 'أمان الحساب' : 'العودة للدخول'}</Link><Link className="btn btn--secondary" href={links.dashboard}>مساحة العمل</Link></div></section></AccountLayout>;
}
