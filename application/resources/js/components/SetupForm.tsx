import { Link, useForm } from '@inertiajs/react';
import { useEffect, useId, useState } from 'react';

export type SetupField = { name: string; label: string; type?: string; hint?: string; required?: boolean; maxLength?: number; options?: { value: string; label: string }[] };
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}
export function OfflineNotice({ online }: { online: boolean }) { return online ? null : <p role="status" className="account-alert account-warning">الاتصال منقطع. لم نؤكد حفظ أي طلب جديد. عد للاتصال ثم أعد المحاولة.</p>; }
export function SetupForm({ action, values, fields, submit, reset = false }: { action: string; values: Record<string, string | number | boolean>; fields: SetupField[]; submit: string; reset?: boolean }) {
  const form = useForm(values); const uid = useId(); const online = useOnline();
  return <form className="secure-form" onSubmit={e => { e.preventDefault(); if (online && !form.processing) form.post(action, { preserveScroll: true, onSuccess: () => { form.clearErrors(); if (reset) form.reset(); } }); }}>
    <OfflineNotice online={online} />
    {Object.keys(form.errors).length > 0 && <div className="account-alert account-error" role="alert"><strong>راجع البيانات قبل الحفظ</strong><ul>{Object.values(form.errors).map((error, i) => <li key={i}>{error}</li>)}</ul></div>}
    {fields.map(field => <div className="account-field" key={field.name}>
      {field.type === 'checkbox' ? <label className="password-toggle" htmlFor={`${uid}-${field.name}`}><input id={`${uid}-${field.name}`} name={field.name} type="checkbox" checked={!!form.data[field.name]} onChange={e => form.setData(field.name, e.target.checked)} />{field.label}</label> : <>
        <label htmlFor={`${uid}-${field.name}`}>{field.label}</label>
        {field.options ? <select id={`${uid}-${field.name}`} name={field.name} value={String(form.data[field.name] ?? '')} required={field.required !== false} onChange={e => form.setData(field.name, e.target.value)} aria-describedby={`${uid}-${field.name}-hint`}><option value="">اختر من القائمة</option>{field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input id={`${uid}-${field.name}`} name={field.name} type={field.type ?? 'text'} value={String(form.data[field.name] ?? '')} required={field.required !== false} maxLength={field.maxLength ?? 80} autoComplete="off" dir={field.name.includes('phone') || field.name.includes('username') ? 'ltr' : undefined} onChange={e => form.setData(field.name, e.target.value)} aria-invalid={!!form.errors[field.name]} aria-describedby={`${uid}-${field.name}-hint`} />}
      </>}
      <small id={`${uid}-${field.name}-hint`}>{field.hint}</small>
    </div>)}
    <button className="btn" disabled={!online || form.processing}>{form.processing ? 'جارٍ الحفظ…' : submit}</button>
  </form>;
}
export function Pagination({ value }: { value?: { previous: string | null; next: string | null } }) { return value && <nav className="actions pagination" aria-label="صفحات القائمة">{value.previous && <Link className="btn btn--secondary" href={value.previous}>السابق</Link>}{value.next && <Link className="btn btn--secondary" href={value.next}>التالي</Link>}</nav>; }
export const clinicFields: SetupField[] = [
  { name: 'display_name', label: 'اسم العيادة', maxLength: 120 }, { name: 'city', label: 'المدينة أو المنطقة', hint: 'مثل إب أو صنعاء أو ذمار' },
  { name: 'address_landmark', label: 'الحي والشارع وأقرب معلم', maxLength: 240 }, { name: 'contact_phone', label: 'جوال تواصل العيادة', type: 'tel', required: false, hint: 'اختياري · رقم يمني يبدأ بسبعة، بالعربية أو الإنجليزية' },
];
