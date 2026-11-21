import { Head, Link, router, usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';
import symbol from '../../../../design/assets/symbol-primary.svg';

export type Shared = {
  [key: string]: unknown;
  brand: { name: string; tagline: string };
  auth: { display_name: string; username: string; platform_admin: boolean } | null;
  doctor_workspace_allowed?: boolean;
  links: Record<string, string>;
  status: string | null;
  privateNotice: { recovery_code?: string; account_link?: string } | null;
};
export function AccountLayout({ title, children, narrow = false, navigationBlocked = false }: { title: string; children: ReactNode; narrow?: boolean; navigationBlocked?: boolean }) {
  const page = usePage<Shared>();
  const { brand, auth, links, status } = page.props;
  const privateNotice = (page.flash.privateNotice ?? null) as Shared['privateNotice'];
  return <>
    <Head title={`${title} | ${brand.name}`} />
    <a className="skip-link" href="#main">انتقل إلى المحتوى</a>
    <header className="site-header"><div className="wrap header-row">
      <Link className="brand" href={links.welcome} aria-disabled={navigationBlocked || undefined} onClick={e => { if (navigationBlocked) e.preventDefault(); }}><img src={symbol} alt="" width="42" height="42" /><span><span className="brand-name">{brand.name}</span><span className="brand-en" lang="en" dir="ltr">NOBTEEK</span></span></Link>
      <nav className="header-links" aria-label="القائمة الرئيسية" inert={navigationBlocked}>
        {auth ? <><Link className="nav-link" href={links.dashboard}>مساحة العمل</Link>{page.props.doctor_workspace_allowed && <Link className="nav-link" href={links['doctor.index']}>شاشة الطبيب</Link>}<Link className="nav-link" href={links.security}>أمان الحساب</Link><button className="btn btn--quiet" onClick={() => router.post(links.logout)}>خروج</button></> : <Link className="nav-link" href={links.login}>دخول العيادة</Link>}
      </nav>
    </div></header>
    <div className="preview-note">نسخة تجريبية قيد التجهيز · استخدم بيانات وهمية فقط</div>
    <main id="main" className={`wrap account-main ${narrow ? 'account-narrow' : ''}`}>
      {status && <div className="account-alert account-success" role="status" tabIndex={-1}>{status}</div>}
      {privateNotice && <section className="account-alert account-warning" aria-labelledby="private-title">
        <h2 id="private-title">احفظه الآن في مكان خاص</h2>
        <p>يظهر مرة واحدة. لا تشاركه مع أي شخص غير صاحب الحساب.</p>
        {privateNotice.recovery_code && <><label htmlFor="private-code">رمز الاستعادة</label><input id="private-code" readOnly dir="ltr" value={privateNotice.recovery_code} onFocus={e => e.target.select()} /><p>استخدمه عند فقدان كلمة المرور أو جهاز التحقق. سيُنهي الجلسات السابقة ويعيد إعداد أمان الحساب.</p></>}
        {privateNotice.account_link && <><label htmlFor="private-link">الرابط الخاص · صالح ٣٠ دقيقة</label><textarea id="private-link" readOnly dir="ltr" rows={3} value={privateNotice.account_link} onFocus={e => e.target.select()} /><p>تحقق من هوية صاحبه وسلمه الرابط عبر وسيلة خاصة موثوقة. لا ترسله إلى مجموعة.</p></>}
      </section>}
      {children}
    </main>
    <footer className="account-footer wrap"><span>{brand.name} · {brand.tagline}</span><span>تنظيم يوم العيادة يبدأ بخطوة واضحة</span></footer>
  </>;
}
