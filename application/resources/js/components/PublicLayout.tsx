import { Head, usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';
import symbol from '../../../../design/assets/symbol-primary.svg';

export type PublicShared = { [key: string]: unknown; brand: { name: string; tagline: string }; links: Record<string, string> };

export function PublicLayout({ title, children, narrow = false }: { title: string; children: ReactNode; narrow?: boolean }) {
  const { brand, links } = usePage<PublicShared>().props;
  return <>
    <Head title={`${title} | ${brand.name}`} />
    <a className="skip-link" href="#main">انتقل إلى المحتوى</a>
    <header className="site-header"><div className="wrap header-row">
      <a className="brand" href={links.welcome}><img src={symbol} alt="" width="42" height="42" /><span><span className="brand-name">{brand.name}</span><span className="brand-en" lang="en" dir="ltr">NOBTEEK</span></span></a>
      <nav className="header-links" aria-label="روابط المساعدة"><a className="nav-link" href={links['public.help']}>المساعدة</a><a className="nav-link" href={links['public.privacy']}>الخصوصية</a></nav>
    </div></header>
    <div className="preview-note">نسخة تجريبية قيد التجهيز · استخدم بيانات وهمية فقط</div>
    <main id="main" className={`wrap account-main public-workspace ${narrow ? 'account-narrow' : ''}`}>{children}</main>
    <footer className="account-footer wrap"><span>{brand.name} · {brand.tagline}</span><a href={links['public.help']}>مساعدة المراجع وحماية رابطه</a></footer>
  </>;
}
