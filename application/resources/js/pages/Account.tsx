import { Link, usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { SecureForm } from '../components/SecureForm';

type Props = { communityLogin?: boolean; screen: 'login' | 'challenge' | 'recovery' | 'activation' | 'security'; mfa?: { enabled: boolean; required: boolean; setup: { secret: string; qr: string } | null }; events?: { event_type: string; at: string }[] };
const username = { name: 'username', label: 'اسم الدخول', hint: 'اسم الحساب الذي سلّمه لك مسؤول العيادة' };
const password = { name: 'password', label: 'كلمة المرور', type: 'password' };
const current = { name: 'current_password', label: 'كلمة المرور الحالية', type: 'password' };
const otp = { name: 'code', label: 'رمز تطبيق التحقق', hint: 'ستة أرقام من تطبيق التحقق على جهازك' };
const newPassword = [{ ...password, label: 'كلمة مرور جديدة', hint: '١٢ حرفًا على الأقل، تتضمن أحرفًا وأرقامًا' }, { name: 'password_confirmation', label: 'تأكيد كلمة المرور', type: 'password' }];
const eventLabels: Record<string, string> = { login_succeeded: 'دخول للحساب', mfa_login_succeeded: 'دخول مع التحقق الإضافي', logout: 'خروج', password_changed: 'تغيير كلمة المرور', mfa_setup_started: 'بدء إعداد التحقق', mfa_enabled: 'تفعيل التحقق الإضافي', recovery_code_rotated: 'تجديد رمز الاستعادة', account_recovered: 'استعادة الحساب', account_link_issued: 'إصدار رابط وصول', account_link_consumed: 'استخدام رابط الوصول', account_suspended: 'إيقاف الحساب', account_resumed: 'إعادة تفعيل الحساب', platform_admin_bootstrapped: 'إنشاء حساب الإدارة' };

export default function Account({ screen, mfa, events = [], communityLogin = false }: Props) {
  const { links, auth } = usePage<Shared>().props;
  const [token, setToken] = useState('');
  useEffect(() => {
    if (screen === 'activation') {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      setToken(fragment.get('token') ?? '');
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [screen]);
  const titles = { login: 'أهلًا بعودتك', challenge: 'تحقق إضافي لحماية حسابك', recovery: 'استعادة الحساب', activation: 'تعيين كلمة المرور', security: 'أمان حسابك' };
  return <AccountLayout title={titles[screen]} narrow={screen !== 'security'}>
    {screen === 'security' ? <>
      <div className="page-heading"><div><p className="eyebrow">حسابك الخاص</p><h1>{titles[screen]}</h1><p className="muted">{auth?.display_name} · <bdi>{auth?.username}</bdi></p></div><Link className="btn btn--secondary" href={links.dashboard}>العودة لمساحة العمل</Link></div>
      {mfa?.required && !mfa.enabled && <div className="account-alert account-warning" role="status">يلزم تفعيل التحقق الإضافي قبل الوصول إلى بيانات العيادة أو أدوات الإدارة.</div>}
      <div className="security-grid">
        <section className="account-card"><span className={`state-pill ${mfa?.enabled ? 'state-success' : ''}`}>{mfa?.enabled ? 'مفعّل' : 'بانتظار الإعداد'}</span><h2>تطبيق التحقق</h2><p className="muted">استخدم تطبيق تحقق مثل Google Authenticator أو Microsoft Authenticator. لا يحتاج الرمز إلى رسالة هاتفية.</p>
          {mfa?.setup ? <><img className="mfa-qr" src={mfa.setup.qr} width="220" height="220" alt="رمز إعداد تطبيق التحقق" /><label htmlFor="setup-secret">أو أدخل المفتاح يدويًا</label><input id="setup-secret" className="secret-value" readOnly value={mfa.setup.secret} dir="ltr" onFocus={e => e.target.select()} /><p className="muted">أكمل الإعداد خلال ١٠ دقائق. لا تشارك المفتاح أو صورة الرمز.</p><SecureForm action={links['mfa.confirm']} fields={[otp]} submit="تأكيد التفعيل" /></> : <SecureForm action={links['mfa.start']} fields={[current, ...(mfa?.enabled ? [otp] : [])]} submit={mfa?.enabled ? 'إعداد جهاز تحقق بديل' : 'بدء إعداد التحقق'} />}
        </section>
        <section className="account-card"><h2>تغيير كلمة المرور</h2><p className="muted">تنتهي جلسات الأجهزة الأخرى بعد التغيير.</p><SecureForm action={links['password.change']} fields={[current, ...newPassword, ...(mfa?.enabled ? [otp] : [])]} submit="حفظ كلمة المرور" /></section>
        <section className="account-card"><h2>رمز الاستعادة الخاص</h2><p className="muted">احتفظ به في مكان مستقل عن جهاز التحقق. إنشاء رمز جديد يلغي السابق وينهي الجلسات الأخرى.</p><SecureForm action={links['recovery.rotate']} fields={[current, ...(mfa?.enabled ? [otp] : [])]} submit="إنشاء رمز استعادة جديد" /></section>
        <section className="account-card"><h2>تأكيد هويتك</h2><p className="muted">إذا طلب النظام تأكيدًا حديثًا لإدارة الوصول، أكمله هنا ثم عد إلى الإجراء.</p><SecureForm action={links['account.confirm']} fields={[current, ...(mfa?.enabled ? [otp] : [])]} submit="تأكيد الهوية" /></section>
      </div>
      <section className="account-card account-history"><h2>آخر أحداث أمان الحساب</h2>{events.length ? <ul className="event-list">{events.map((e, i) => <li key={i}><span>{eventLabels[e.event_type] ?? 'تحديث أمان الحساب'}</span><time dateTime={e.at}>{new Date(e.at).toLocaleString('ar-YE', { timeZone: 'Asia/Aden' })}</time></li>)}</ul> : <p className="muted">لا توجد أحداث مسجلة حتى الآن.</p>}</section>
    </> : <div className="auth-panel"><div className="auth-intro"><p className="eyebrow">{screen === 'login' && !communityLogin ? 'يوم عيادتك بترتيب واضح' : 'وصول خاص وآمن'}</p><h1>{titles[screen]}</h1><p className="muted">{screen === 'login' ? (communityLogin ? 'استخدم حساب نوبتيك التجريبي للمتابعة.' : 'ادخل بحسابك المستقل لتصل إلى مساحة عيادتك وصلاحياتك.') : screen === 'challenge' ? 'أدخل الرمز الحالي من تطبيق التحقق. إذا استخدمت الرمز للتو، انتظر الرمز التالي.' : screen === 'recovery' ? 'أدخل اسم حسابك ورمز الاستعادة الذي حفظته سابقًا. ستنتهي الجلسات السابقة ويُعاد إعداد التحقق الإضافي.' : 'ضع كلمة مرور خاصة بك لتفعيل حسابك أو استعادة الوصول إليه.'}</p></div>
      {screen === 'login' && <><SecureForm action={links.login} fields={[communityLogin ? { ...username, hint: 'اسم الدخول المخصص لحسابك' } : username, password]} submit={communityLogin ? 'تسجيل الدخول' : 'دخول العيادة'} /><div className="auth-links"><Link href={links.recovery}>نسيت كلمة المرور أو فقدت جهاز التحقق؟</Link></div><p className="auth-help">{communityLogin ? 'اطلب حساب اختبار من مشرف التجربة.' : 'ليس لديك حساب؟ اطلبه من مسؤول عيادتك. لا يلزم المراجع حساب لمتابعة دوره عند إتاحة الخدمة.'}</p></>}
      {screen === 'challenge' && <><SecureForm action={links.challenge} fields={[otp]} submit="تحقق ومتابعة" /><div className="auth-links"><Link href={links.login}>العودة للدخول</Link><Link href={links.recovery}>استخدام رمز الاستعادة</Link></div></>}
      {screen === 'recovery' && <><SecureForm action={links.recovery} fields={[username, { name: 'recovery_code', label: 'رمز الاستعادة الخاص', hint: 'الرمز الطويل الذي حفظته من صفحة أمان الحساب' }, ...newPassword]} submit="استعادة الحساب" /><p className="auth-help">فقدت الرمز أيضًا؟ اطلب رابط استعادة من مسؤولك بعد التحقق من هويتك. لا تستعاد الحسابات برقم هاتف المراجع.</p><Link className="nav-link" href={links.login}>العودة للدخول</Link></>}
      {screen === 'activation' && (token ? <SecureForm action={links['account.access']} hidden={{ grant_token: token }} fields={newPassword} submit="تعيين كلمة المرور" /> : <div className="account-alert account-warning" role="status">افتح الرابط الخاص الذي سلّمه لك المسؤول. إذا انتهت صلاحيته أو أعدت تحميل الصفحة بعد فتحه، اطلب رابطًا جديدًا أو افتح الرابط الأصلي مرة أخرى.</div>)}
    </div>}
  </AccountLayout>;
}
