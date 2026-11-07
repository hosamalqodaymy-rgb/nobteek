import { useForm } from '@inertiajs/react';
import { useEffect, useId, useState } from 'react';

type Field = { name: string; label: string; type?: string; hint?: string; options?: { value: string; label: string }[]; required?: boolean };
export function SecureForm({ action, fields, submit, hidden = {} }: { action: string; fields: Field[]; submit: string; hidden?: Record<string, string> }) {
  const id = useId();
  const initial = Object.fromEntries(fields.map(f => [f.name, '']));
  const form = useForm<Record<string, string>>({ ...initial, ...hidden });
  const [online, setOnline] = useState(true);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const errors = Object.values(form.errors).filter(Boolean);
  return <form className="secure-form" onSubmit={e => {
    e.preventDefault();
    if (!online || form.processing) return;
    form.transform(data => ({ ...data, ...hidden }));
    form.post(action, { preserveScroll: true, onSuccess: () => form.reset() });
  }}>
    {errors.length > 0 && <div className="account-alert account-error" role="alert"><strong>راجع البيانات التالية</strong><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></div>}
    {!online && <p className="account-alert account-warning" role="status">الاتصال منقطع. عد للاتصال ثم أعد المحاولة؛ لم نؤكد حفظ الطلب.</p>}
    {fields.map(field => {
      const controlId = `${id}-${field.name}`;
      const isPassword = field.type === 'password';
      const props = {
        id: controlId, name: field.name, value: form.data[field.name] ?? '',
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => form.setData(field.name, e.target.value),
        required: field.required !== false, 'aria-invalid': !!form.errors[field.name],
        'aria-describedby': `${controlId}-help ${controlId}-error`,
      };
      return <div className="account-field" key={field.name}>
        <label htmlFor={controlId}>{field.label}</label>
        {field.options ? <select {...props}><option value="">اختر الصلاحية</option>{field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> :
          <input {...props} type={isPassword && visible ? 'text' : field.type ?? 'text'}
            dir={['username', 'code', 'recovery_code'].includes(field.name) || isPassword ? 'ltr' : undefined}
            autoComplete={field.name === 'username' ? 'username' : field.name === 'code' ? 'one-time-code' : isPassword ? (field.name === 'current_password' || submit === 'دخول العيادة' ? 'current-password' : 'new-password') : 'off'}
            inputMode={field.name === 'code' ? 'numeric' : undefined} maxLength={field.name === 'code' ? 6 : isPassword ? 128 : field.name === 'recovery_code' ? 100 : 80}
            pattern={field.name === 'code' ? '[0-9]{6}' : undefined} />}
        <small id={`${controlId}-help`}>{field.hint}</small>
        <span id={`${controlId}-error`} className="field-error">{form.errors[field.name]}</span>
      </div>;
    })}
    {fields.some(f => f.type === 'password') && <label className="password-toggle"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} /> إظهار كلمة المرور</label>}
    <button className="btn" type="submit" disabled={form.processing || !online}>{form.processing ? 'جارٍ التحقق…' : submit}</button>
  </form>;
}
