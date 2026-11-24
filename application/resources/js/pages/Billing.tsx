import { Link, router, usePage } from '@inertiajs/react';
import { type FormEvent, useRef, useState } from 'react';
import { AccountLayout, type Shared } from '../components/AccountLayout';
import { postForm, postJSON } from '../components/SessionTransport';

type PaymentMethod = { code: string; label: string };
type PaymentDestination = PaymentMethod & { recipient: string; number: string };
type Plan = { code: string; name: string; currency: string; amount_minor: number; methods?: PaymentMethod[] };
type Proof = { id: string; state: string; amount_minor: number; transfer_reference: string; rejection_reason: string | null; download_url: string; approve_url?: string; reject_url?: string };
type Invoice = { id: string; plan_name: string; currency: string; amount_minor: number; state: string; clinic_name: string; issued_at: string; approved_at: string | null; starts_at: string | null; ends_at: string | null; refunded_at: string | null; proofs: Proof[]; payment_destination?: PaymentDestination | null; submit_url?: string; void_url?: string; refund_url?: string };
type Invoices = { data: Invoice[]; prev_page_url: string | null; next_page_url: string | null };
type OwnerProps = { mode: 'owner'; access: { state: string; enrolled: boolean; covered_until: string | null; grace_until: string | null }; access_enforced: boolean; has_open_invoice: boolean; issue_url: string };
type PlatformProps = { mode: 'platform'; clinics: { id: string; display_name: string }[]; plan_url: string | null; trial_url: string };
type Props = (OwnerProps | PlatformProps) & { plans: Plan[]; invoices: Invoices; period_days: number; pilot: boolean };
type Send = (url: string, body: FormData | Record<string, unknown>, success: string) => Promise<boolean>;

const states: Record<string, string> = {
  issued: 'مفتوحة', pending: 'بانتظار المراجعة', paid: 'مدفوعة', voided: 'ملغاة', refunded: 'مستردة',
  submitted: 'بانتظار المراجعة', approved: 'معتمد', rejected: 'مرفوض',
  active: 'فعّال', trial: 'فترة تجربة', grace: 'فترة سماح', restricted: 'مقيّد',
};
const reasons: Record<string, string> = {
  partial_amount: 'المبلغ ناقص أو مختلف', duplicate_transfer: 'التحويل مستخدم من قبل', invalid_proof: 'تعذّر التحقق من الإثبات',
};
const referencePattern = String.raw`[A-Za-z0-9][A-Za-z0-9_\/\-]{3,79}`;

const pilotCurrencies = { YER: 'ريال يمني قديم', SAR: 'ريال سعودي', USD: 'دولار أمريكي' };

function currencyFormat(currency: string) {
  const fractionDigits = currency === 'YER' ? 0 : ['SAR', 'USD'].includes(currency) ? 2 : undefined;
  return new Intl.NumberFormat('ar-YE', { style: 'currency', currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function money(minor: number, currency: string) {
  const format = currencyFormat(currency);
  return format.format(minor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}

function amountMinor(amount: string, currency: string): number {
  const fractionDigits = currencyFormat(currency).resolvedOptions().maximumFractionDigits ?? 2;
  const normalized = amount.trim().replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace(/[,٫]/g, '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return 0;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > fractionDigits) return 0;
  return Number(whole + fraction.padEnd(fractionDigits, '0'));
}

function date(value: string) {
  return new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Aden' }).format(new Date(value));
}

function ProofReview({ proof, currency, destination, busy, send }: { proof: Proof; currency: string; destination?: PaymentDestination | null; busy: boolean; send: Send }) {
  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void send(proof.approve_url!, {
      verified_amount_minor: amountMinor(String(fields.get('amount')), currency),
      verified_transfer_reference: fields.get('reference'),
      ...(destination ? { verified_currency: fields.get('currency') } : {}),
    }, 'تم اعتماد التحويل وتسجيل فترة الاشتراك.');
  }

  function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void send(proof.reject_url!, { reason: fields.get('reason') }, 'تم رفض الإثبات وفتح الفاتورة لإرسال إثبات آخر.');
  }

  return <div className="actions">
    <form className="secure-form" onSubmit={approve}>
      <label className="account-field">مرجع التحويل بعد التحقق<input name="reference" dir="ltr" pattern={referencePattern} required /></label>
      {destination && <label className="account-field">العملة المستلمة<select name="currency" required><option value="">اختر العملة بعد مراجعة الحساب</option>
        {Object.entries(pilotCurrencies).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select></label>}
      <label className="account-field">المبلغ المستلم بعد التحقق ({currency})<input name="amount" inputMode="decimal" required /></label>
      <button className="btn" disabled={busy}>اعتماد التحويل</button>
    </form>
    <form className="secure-form" onSubmit={reject}>
      <label className="account-field">سبب الرفض<select name="reason" required><option value="">اختر السبب</option>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="btn btn--secondary" disabled={busy}>رفض الإثبات</button>
    </form>
  </div>;
}

function InvoiceCard({ invoice, platform, busy, send }: { invoice: Invoice; platform: boolean; busy: boolean; send: Send }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    fields.set('amount_minor', String(amountMinor(String(fields.get('amount')), invoice.currency)));
    fields.delete('amount');
    void send(invoice.submit_url!, fields, 'تم إرسال الإثبات للمراجعة.');
  }

  function refund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void send(invoice.refund_url!, { refund_reference: fields.get('reference'), confirmed: fields.get('confirmed') === 'on' }, 'تم تسجيل الاسترداد.');
  }

  return <article className="account-card">
    <h3>{invoice.plan_name} · {money(invoice.amount_minor, invoice.currency)}</h3>
    {platform && <p>{invoice.clinic_name}</p>}
    <p><span className="state-pill">{states[invoice.state]}</span> <time dateTime={invoice.issued_at}>{date(invoice.issued_at)}</time></p>
    <p className="muted">رقم الفاتورة <bdi>{invoice.id}</bdi></p>
    {invoice.payment_destination && <div>
      <h4>بيانات التحويل</h4>
      <p>{invoice.payment_destination.label} · <bdi dir="ltr">{invoice.payment_destination.number}</bdi></p>
      <p>اسم المستلم {invoice.payment_destination.recipient}</p>
      {invoice.submit_url && <p>حوّل {money(invoice.amount_minor, invoice.currency)} بنفس عملة الفاتورة، ثم ارفع إثبات التحويل.</p>}
    </div>}
    {invoice.approved_at && invoice.starts_at && invoice.ends_at && <div>
      <h4>إيصال الاشتراك</h4><p>الاعتماد في {date(invoice.approved_at)}. فترة الاشتراك من {date(invoice.starts_at)} إلى {date(invoice.ends_at)}.</p>
      {invoice.refunded_at && <p>سُجل الاسترداد في {date(invoice.refunded_at)}.</p>}
    </div>}
    {invoice.proofs.length > 0 && <ul className="team-list">{invoice.proofs.map(proof => <li key={proof.id}><div>
      <p><strong>{states[proof.state]}</strong> · {money(proof.amount_minor, invoice.currency)} · <bdi>{proof.transfer_reference}</bdi></p>
      {proof.rejection_reason && <p>{reasons[proof.rejection_reason]}</p>}
      <a className="nav-link" href={proof.download_url} download>تنزيل إثبات التحويل</a>
      {proof.approve_url && proof.reject_url && <ProofReview proof={proof} currency={invoice.currency} destination={invoice.payment_destination} busy={busy} send={send} />}
    </div></li>)}</ul>}
    {invoice.submit_url && <form className="secure-form" onSubmit={submit}>
      <label className="account-field">مرجع التحويل<input name="transfer_reference" dir="ltr" pattern={referencePattern} required /></label>
      <label className="account-field">المبلغ المحوّل ({invoice.currency})<input name="amount" inputMode="decimal" required /></label>
      <label className="account-field">إثبات التحويل (PDF أو JPG أو PNG حتى 2 MB)<input name="attachment" type="file" accept=".pdf,.jpg,.jpeg,.png" required /></label>
      <button className="btn" disabled={busy}>إرسال الإثبات للمراجعة</button>
    </form>}
    {invoice.void_url && <button className="btn btn--secondary" disabled={busy} onClick={() => {
      if (window.confirm('هل تريد إلغاء هذه الفاتورة المفتوحة؟')) void send(invoice.void_url!, {}, 'تم إلغاء الفاتورة.');
    }}>إلغاء الفاتورة</button>}
    {invoice.refund_url && <form className="secure-form" onSubmit={refund}>
      <h4>تسجيل الاسترداد اليدوي</h4>
      <label className="account-field">مرجع تحويل الاسترداد<input name="reference" dir="ltr" pattern={referencePattern} required /></label>
      <label className="billing-confirmation"><input type="checkbox" name="confirmed" required /> أؤكد إعادة كامل مبلغ الفاتورة خارج النظام.</label>
      <button className="btn btn--secondary" disabled={busy}>حفظ سجل الاسترداد</button>
    </form>}
  </article>;
}

export default function Billing(props: Props) {
  const { links } = usePage<Shared>().props;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const attempt = useRef<{ code: string; method: string | null; key: string } | null>(null);
  const [planCode, setPlanCode] = useState('');
  const activePlan = props.plans.find(plan => plan.code === planCode);
  const hasPaymentMethods = props.plans.some(plan => plan.methods?.length);
  const title = props.mode === 'owner' ? 'اشتراك العيادة' : 'إدارة الاشتراكات';

  const send: Send = async (url, body, success) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await (body instanceof FormData ? postForm(url, body) : postJSON(url, body));
      if (result.status < 200 || result.status >= 300) {
        setNotice({ failed: true, text: String(result.body.message ?? 'تعذر حفظ الطلب.') });
        return false;
      }
      setNotice({ failed: false, text: result.body.replayed ? 'هذه العملية مسجلة بالفعل. عُرضت النتيجة المحفوظة.' : success });
      router.reload({ only: ['invoices', 'plans', 'access', 'has_open_invoice'] });
      return true;
    } catch {
      setNotice({ failed: true, text: 'تعذر تأكيد حفظ الطلب. يمكنك إعادة المحاولة بنفس البيانات.' });
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  function issue(event: FormEvent<HTMLFormElement>, url: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const code = String(fields.get('plan_code'));
    const method = fields.get('payment_method') as string | null;
    if (attempt.current?.code !== code || attempt.current.method !== method) {
      attempt.current = { code, method, key: crypto.randomUUID() };
    }
    void send(url, { plan_code: code, payment_method: method, request_key: attempt.current.key }, 'تم إصدار الفاتورة.').then(saved => {
      if (saved) attempt.current = null;
    });
  }

  function createPlan(event: FormEvent<HTMLFormElement>, url: string) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const currency = String(data.currency).toUpperCase();
    void send(url, { code: data.code, name: data.name, currency, amount_minor: amountMinor(String(data.price), currency) }, 'تم تسجيل الباقة.');
  }

  return <AccountLayout title={title}><div className="billing-page">
    <div className="page-heading"><div><h1>{title}</h1></div><Link className="btn btn--secondary" href={links.dashboard}>مساحة العمل</Link></div>
    {props.mode === 'platform' && <p className="muted">راجع كشوف التحويل قبل اعتماد الإثبات. إذا طلب النظام تأكيدًا حديثًا، <Link href={links.security}>أكّد هويتك من أمان الحساب</Link>.</p>}
    {notice && <p className={`account-alert ${notice.failed ? 'account-error' : 'account-success'}`} role={notice.failed ? 'alert' : 'status'}>{notice.text}</p>}
    {props.mode === 'owner' ? <section className="account-card">
      <h2>حالة الاشتراك</h2>
      <p className="state-pill">{props.access.enrolled ? states[props.access.state] : 'لم يبدأ الاشتراك'}</p>
      {props.access.covered_until && <p>نهاية الفترة الحالية {date(props.access.covered_until)}</p>}
      {props.access.state === 'grace' && props.access.grace_until && <p>نهاية فترة السماح {date(props.access.grace_until)}</p>}
      {props.access.enrolled && props.access.state === 'restricted' && props.access_enforced && <p>الحجوزات الجديدة معلقة. يمكنك متابعة الحجوزات والزيارات المسجلة.</p>}
      {props.plans.length === 0 ? <p>لا توجد باقات متاحة حاليًا.</p> : !props.has_open_invoice && <form className="secure-form" onSubmit={event => issue(event, props.issue_url)}>
        {props.pilot && !hasPaymentMethods && <p>إعداد استقبال التحويلات قيد التجهيز.</p>}
        <label className="account-field">اختر باقة لمدة {props.period_days} يومًا<select name="plan_code" value={planCode} onChange={event => setPlanCode(event.target.value)} required><option value="">اختر الباقة</option>
          {props.plans.map(plan => <option key={plan.code} value={plan.code} disabled={props.pilot && !plan.methods?.length}>{plan.name} · {money(plan.amount_minor, plan.currency)}{props.pilot && !plan.methods?.length ? ' · قريبًا' : ''}</option>)}</select></label>
        {props.pilot && activePlan?.methods?.length ? <label className="account-field">طريقة التحويل<select key={activePlan.code} name="payment_method" required>
          <option value="">اختر طريقة التحويل</option>
          {activePlan.methods.map(method => <option key={method.code} value={method.code}>{method.label}</option>)}
        </select></label> : null}
        <button className="btn" disabled={busy || (props.pilot && !activePlan?.methods?.length)}>إصدار فاتورة</button>
      </form>}
    </section> : <div className="clinic-grid">
      <section className="account-card"><h2>باقات {props.period_days} يومًا</h2>
        <ul>{props.plans.map(plan => <li key={plan.code}>{plan.name} · {money(plan.amount_minor, plan.currency)}</li>)}</ul>
        {props.plan_url && <form className="secure-form" onSubmit={event => createPlan(event, props.plan_url!)}>
          <label className="account-field">رمز الباقة<input name="code" dir="ltr" pattern={String.raw`[a-z0-9\-]{2,40}`} required /></label>
          <label className="account-field">اسم الباقة<input name="name" maxLength={120} required /></label>
          <label className="account-field">رمز العملة المكوّن من ثلاثة أحرف<input name="currency" dir="ltr" pattern="[A-Za-z]{3}" required /></label>
          <label className="account-field">سعر الاشتراك<input name="price" inputMode="decimal" required /></label>
          <button className="btn" disabled={busy}>إضافة باقة</button>
        </form>}
      </section>
      <section className="account-card"><h2>بدء فترة تجربة</h2><form className="secure-form" onSubmit={event => {
        event.preventDefault();
        void send(props.trial_url, Object.fromEntries(new FormData(event.currentTarget)), 'تم بدء فترة التجربة.');
      }}>
        <label className="account-field">العيادة<select name="clinic_id" required><option value="">اختر العيادة</option>{props.clinics.map(clinic => <option key={clinic.id} value={clinic.id}>{clinic.display_name}</option>)}</select></label>
        <label className="account-field">أيام التجربة<input name="days" type="number" min="1" max="90" required /></label>
        <button className="btn" disabled={busy}>بدء التجربة</button>
      </form></section>
    </div>}
    <section><h2>الفواتير وإثباتات التحويل</h2>
      {props.invoices.data.length ? props.invoices.data.map(invoice => <InvoiceCard key={invoice.id} invoice={invoice} platform={props.mode === 'platform'} busy={busy} send={send} />) : <p>لا توجد فواتير في هذه الصفحة.</p>}
      <div className="actions">
        {props.invoices.prev_page_url && <Link className="btn btn--secondary" href={props.invoices.prev_page_url}>السابق</Link>}
        {props.invoices.next_page_url && <Link className="btn btn--secondary" href={props.invoices.next_page_url}>التالي</Link>}
      </div>
    </section>
  </div></AccountLayout>;
}
