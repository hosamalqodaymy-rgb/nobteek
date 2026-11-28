import { useForm, usePage } from '@inertiajs/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Shared } from './AccountLayout';

type Entry = { value: string; label: string };
export type CommunityField = {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'date' | 'number' | 'checkbox';
  options?: Entry[];
  value?: string | boolean;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  maxLength?: number;
};
type Props = { action: string; submit: string; fields?: CommunityField[]; hidden?: Record<string, string>; resetAfterSave?: boolean };

export function CommunityForm({ action, submit, fields = [], hidden = {}, resetAfterSave = true }: Props) {
  const identity = usePage<Shared>().props.auth?.username ?? '';
  const form = useForm<Record<string, string | boolean>>(Object.fromEntries(fields.map(field => [field.name, field.value ?? (field.type === 'checkbox' ? false : '')])));
  const id = useId();
  const busy = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || busy.current) return;
    busy.current = true;
    setPreparing(true);
    setNotice('');
    try {
      const payload = { ...form.data, ...hidden };
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([action, payload])));
      const signature = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      const storageKey = 'nobteek-command:' + identity + ':' + signature;
      const command_id = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, command_id);

      form.transform(() => ({ ...payload, command_id }));
      form.post(action, {
        preserveScroll: true,
        onSuccess: () => {
          sessionStorage.removeItem(storageKey);
          if (resetAfterSave) form.reset();
        },
        onError: () => sessionStorage.removeItem(storageKey),
        onHttpException: response => {
          if (response.status !== 409 && response.status !== 422) return;
          sessionStorage.removeItem(storageKey);
          setNotice(response.status === 409 ? 'تعذّر حفظ الإجراء في الحالة الحالية. حدّث الصفحة وراجع حالة الطلب.' : 'تعذّر حفظ البيانات المدخلة. راجعها ثم أعد المحاولة.');
          return false;
        },
        onNetworkError: () => {
          setNotice('تعذّر تأكيد الحفظ. أعد المحاولة لتتأكد من حالة الطلب.');
          return false;
        },
        onFinish: () => {
          busy.current = false;
          setPreparing(false);
        },
      });
    } catch {
      busy.current = false;
      setPreparing(false);
      setNotice('تعذر إرسال الطلب. حاول مرة أخرى.');
    }
  }

  return <form className="secure-form" onSubmit={send}>
    {!online && <p className="account-alert account-warning" role="status">الاتصال منقطع. أعد المحاولة بعد عودته.</p>}
    {notice && <p className="account-alert account-error" role="alert">{notice}</p>}
    {Object.values(form.errors).length > 0 && <ul className="account-alert account-error" role="alert">{Object.values(form.errors).map((error, index) => <li key={index}>{error}</li>)}</ul>}
    {fields.map(field => {
      const controlId = id + '-' + field.name;
      const value = form.data[field.name] ?? '';
      const base = { id: controlId, name: field.name, required: field.required !== false, disabled: preparing, 'aria-invalid': Boolean(form.errors[field.name]) };
      if (field.type === 'checkbox') {
        return <label key={field.name} className="password-toggle" htmlFor={controlId}>
          <input {...base} type="checkbox" checked={Boolean(value)} onChange={event => form.setData(field.name, event.target.checked)} /> {field.label}
        </label>;
      }
      const text = { ...base, value: String(value), onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => form.setData(field.name, event.target.value) };
      return <div className="account-field" key={field.name}>
        <label htmlFor={controlId}>{field.label}</label>
        {field.options ? <select {...text}><option value="">اختر</option>
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : field.type === 'textarea' ? <textarea {...text} rows={4} maxLength={field.maxLength} />
          : <input {...text} type={field.type ?? 'text'} min={field.min} max={field.max} maxLength={field.maxLength} />}
      </div>;
    })}
    <button className="btn" type="submit" disabled={!online || preparing || form.processing}>{preparing || form.processing ? 'جارٍ الحفظ…' : submit}</button>
  </form>;
}
