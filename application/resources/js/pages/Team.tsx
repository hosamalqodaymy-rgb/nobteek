import { Link, router, usePage } from '@inertiajs/react';
import { useRef, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { useBookingAttempt } from '../components/BookingForms';
import { bookingTransport } from '../components/BookingTransport';
import { SecureForm } from '../components/SecureForm';
import { OfflineNotice } from '../components/SetupForm';
import { postJSON } from '../components/SessionTransport';
type Member = { id: string; username: string; display_name: string; role: string; login_enabled: boolean; access_suspended: boolean; mfa_confirmed_at: string | null; active: boolean; call_next: boolean; delegation_version: number; delegation_url: string | null };
type DelegationCommand = { url: string; version: number; name: string; data: { call_next: boolean; reason_code: string } };
const roles: Record<string, string> = { owner: 'مالك العيادة', reception: 'الاستقبال', doctor: 'طبيب' };
function TeamScreen({ members, clinic, confirmationRequired }: { members: Member[]; clinic: string; confirmationRequired: boolean }) {
  const { links } = usePage<Shared>().props;
  const attempt = useBookingAttempt(); const [pending, setPending] = useState<DelegationCommand | null>(null);
  const [notice, setNotice] = useState(''); const [refreshing, setRefreshing] = useState(false);
  const refreshGeneration = useRef(0);
  const blocked = attempt.busy || attempt.uncertain;
  const disabled = blocked || refreshing || !attempt.online;
  const refresh = () => { const generation = ++refreshGeneration.current; setRefreshing(true); router.reload({ only: ['members'], onFinish: () => { if (generation === refreshGeneration.current) setRefreshing(false); } }); };
  async function save(command: DelegationCommand) {
    const result = await attempt.run(command.url, command.data, command.version);
    if (result) { setPending(null); setNotice((command.data.call_next ? 'تم تفويض استدعاء التالي فقط: ' : 'تم إلغاء تفويض استدعاء التالي: ') + command.name); refresh(); }
  }
  async function change(member: Member) {
    if (disabled || !member.delegation_url) return;
    const command = { url: member.delegation_url, version: member.delegation_version, name: member.display_name, data: { call_next: !member.call_next, reason_code: member.call_next ? 'delegation_revoked' : 'delegation_granted' } };
    setPending(command); setNotice(''); await save(command);
  }
  return <AccountLayout title="حسابات الفريق">
    <div className="page-heading"><div><p className="eyebrow">{clinic}</p><h1>كل موظف بحسابه</h1><p className="muted">أنشئ حسابًا مستقلًا وحدد دوره ثم سلّمه رابط تعيين كلمة المرور.</p></div><Link className="btn btn--secondary" href={links['clinic.settings']}>ملفات الأطباء وإعداد العيادة</Link></div>
    <OfflineNotice online={attempt.online} />
    {attempt.busy && <p className="account-alert" role="status">جارٍ حفظ تفويض استدعاء التالي… احتفظ بهذه الصفحة حتى تأكيد النتيجة.</p>}
    {notice && <p className="account-alert account-success" role="status">{notice}</p>}
    {attempt.error && <section className="account-alert account-error" role="alert"><p>{attempt.error}</p>{pending && <p>{pending.data.call_next ? 'تفويض استدعاء التالي: ' : 'إلغاء تفويض استدعاء التالي: '}{pending.name}</p>}{attempt.uncertain && pending && <><p>احتفظ بهذه الصفحة وأعد الطلب نفسه لتأكيد النتيجة قبل تعديل أي صلاحية أخرى.</p><button className="btn" disabled={attempt.busy || !attempt.online} onClick={() => void save(pending)}>إعادة المحاولة نفسها</button></>}{confirmationRequired && !attempt.uncertain && <><p>أكمل تأكيد هويتك بكلمة المرور ورمز تطبيق التحقق ثم عد إلى حسابات الفريق.</p><Link className="btn btn--secondary" href={links.security}>تأكيد هوية المالك</Link></>}</section>}
    <div className="team-grid"><section className="account-card"><h2>إضافة حساب للفريق</h2><fieldset className="team-create-fields" disabled={disabled}><SecureForm action={links['team.create']} fields={[{ name: 'display_name', label: 'اسم الموظف' }, { name: 'username', label: 'اسم دخول جديد', hint: 'أحرف إنجليزية صغيرة وأرقام. يبدأ بحرف وطوله ٤ أحرف على الأقل' }, { name: 'role', label: 'الصلاحية', options: [{ value: 'reception', label: 'موظف استقبال' }, { value: 'doctor', label: 'طبيب' }] }]} submit="إنشاء الحساب والرابط" /></fieldset><p className="auth-help">اربط ملف الطبيب وتخصصه من إعدادات العيادة بعد إنشاء حسابه. لا تستخدم حسابًا واحدًا لأكثر من موظف.</p></section><section className="account-card"><h2>فريق العيادة</h2><p className="muted">تفويض الاستقبال يتيح استدعاء التالي فقط. تبقى بداية الكشف ونهايته والأولوية الطبية للطبيب المخول.</p><button className="btn btn--quiet" disabled={!attempt.online || refreshing} onClick={refresh}>{refreshing ? 'جارٍ تحديث صلاحيات الفريق…' : 'تحديث صلاحيات الفريق'}</button><ul className="team-list">{members.map(m => <li key={m.id} data-membership-id={m.id}><div><strong>{m.display_name}</strong><p><bdi>{m.username}</bdi> · {roles[m.role]}</p><span className={`state-pill ${m.access_suspended ? 'state-danger' : m.login_enabled ? 'state-success' : ''}`}>{m.access_suspended ? 'موقوف' : m.login_enabled ? 'الدخول متاح' : 'بانتظار التفعيل أو الاستعادة'}</span>{m.role === 'reception' && <p>{m.call_next ? 'تفويض استدعاء التالي مفعّل' : 'تفويض استدعاء التالي غير مفعّل'}</p>}</div>{m.role !== 'owner' && <div className="member-actions"><button className="btn btn--secondary" disabled={disabled || m.access_suspended} onClick={() => router.post(`${links.team}/${m.id}/access`)}>إصدار رابط وصول</button><button className="btn btn--quiet" disabled={disabled} onClick={() => router.post(`${links.team}/${m.id}/suspend`, { suspended: !m.access_suspended, reason: m.access_suspended ? 'reactivation' : 'staff_change' })}>{m.access_suspended ? 'رفع الإيقاف' : 'إيقاف الدخول'}</button>{m.role === 'reception' && m.delegation_url && <button className="btn btn--secondary" disabled={disabled || (!m.call_next && (!m.active || !m.login_enabled || m.access_suspended))} onClick={() => void change(m)}>{m.call_next ? 'إلغاء تفويض استدعاء التالي' : 'تفويض استدعاء التالي فقط'}</button>}</div>}</li>)}</ul></section></div>
  </AccountLayout>;
}

export default function Team(props: { members: Member[]; clinic: string }) {
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const transport = { async post(url: string, data: Record<string, unknown>, headers?: Record<string, string>) { const result = await postJSON(url, data, headers); setConfirmationRequired(result.status === 423); return result; }, refresh() { router.reload({ only: ['members'] }); } };
  return <bookingTransport.Provider value={transport}><TeamScreen {...props} confirmationRequired={confirmationRequired} /></bookingTransport.Provider>;
}
