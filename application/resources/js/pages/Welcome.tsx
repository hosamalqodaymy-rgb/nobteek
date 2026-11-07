import { Head, Link } from '@inertiajs/react';
import symbol from '../../../../design/assets/symbol-primary.svg';

type Props = { brand: { name: string; tagline: string }; links: Record<string, string> };

export default function Welcome({ brand, links }: Props) {
  return (
    <>
      <Head title={brand.name} />
      <main className="foundation-cover">
        <img src={symbol} alt="" width="72" height="72" />
        <p className="eyebrow">نسخة تجريبية قيد التجهيز</p>
        <h1>{brand.name}</h1>
        <h2>{brand.tagline}</h2>
        <p className="lead">تنظيم الحجوزات والحضور والدور في مكان واحد</p>
        <Link className="btn" href={links.login}>دخول العيادة</Link><p className="foundation-note">يجري تجهيز الخدمة. لا تستقبل هذه النسخة حجوزات أو بيانات حقيقية.</p>
      </main>
    </>
  );
}
