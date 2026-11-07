import { useForm } from '@inertiajs/react';
import { useId } from 'react';
import { OfflineNotice, useOnline } from './SetupForm';
export type WindowDraft = { starts_at: string; ends_at: string; capacity: number };
export type ScheduleDraft = { doctor_id: string; starts_at: string; ends_at: string; windows: WindowDraft[]; version?: number };
export type DoctorOption = { id: string; display_name: string };
export function localInput(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function timeLabel(iso: string): string { return new Intl.DateTimeFormat('ar-YE', { timeZone: 'Asia/Aden', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
export function dateLabel(iso: string): string { return new Intl.DateTimeFormat('ar-YE', { timeZone: 'Asia/Aden', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso)); }
export function initialSchedule(date: string): ScheduleDraft { return { doctor_id: '', starts_at: `${date}T16:00`, ends_at: `${date}T18:00`, windows: [{ starts_at: `${date}T16:00`, ends_at: `${date}T17:00`, capacity: 10 }, { starts_at: `${date}T17:00`, ends_at: `${date}T18:00`, capacity: 10 }] }; }
export function ScheduleForm({ action, doctors, initial, submit = 'حفظ الجلسة ونوافذها' }: { action: string; doctors: DoctorOption[]; initial: ScheduleDraft; submit?: string }) {
  const form = useForm(initial); const uid = useId(); const online = useOnline();
  const updateWindow = (index: number, field: keyof WindowDraft, value: string) => form.setData('windows', form.data.windows.map((w, i) => i === index ? { ...w, [field]: field === 'capacity' ? Number(value) : value } : w));
  const lastEnd = form.data.windows.at(-1)?.ends_at;
  const addable = !!lastEnd && lastEnd < form.data.ends_at && form.data.windows.length < 96;
  return <form className="secure-form schedule-form" onSubmit={e => { e.preventDefault(); if (online && !form.processing) form.post(action, { preserveScroll: true }); }}>
    <OfflineNotice online={online} />
    {!!Object.keys(form.errors).length && <div className="account-alert account-error" role="alert"><strong>راجع الجدول قبل الحفظ</strong><ul>{Object.values(form.errors).map((error, i) => <li key={i}>{error}</li>)}</ul></div>}
    <div className="account-field"><label htmlFor={`${uid}-doctor`}>الطبيب</label><select id={`${uid}-doctor`} name="doctor_id" value={form.data.doctor_id} required onChange={e => form.setData('doctor_id', e.target.value)}><option value="">اختر الطبيب</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.display_name}</option>)}</select></div>
    <div className="form-two-cols">{(['starts_at', 'ends_at'] as const).map((name, i) => <div className="account-field" key={name}><label htmlFor={`${uid}-${name}`}>{i === 0 ? 'بداية استقبال الجلسة' : 'نهاية استقبال الجلسة'}</label><input id={`${uid}-${name}`} name={name} type="datetime-local" value={form.data[name]} required onChange={e => form.setData(name, e.target.value)} /><small>بتوقيت اليمن · اليوم نفسه</small></div>)}</div>
    <div className="window-heading"><h3>نوافذ الوصول</h3><span className="state-pill">السعة الإجمالية: {form.data.windows.reduce((sum, w) => sum + (Number(w.capacity) || 0), 0)}</span></div>
    <p className="muted">النافذة فترة وصول للمراجعين، ووقت الكشف يتأثر بالحضور وسير العمل. عدّل القيم المقترحة وفق قدرة العيادة.</p>
    {form.data.windows.map((w, i) => <fieldset className="window-editor" key={i}><legend>النافذة {i + 1}</legend><div className="form-two-cols">{(['starts_at', 'ends_at'] as const).map((field, j) => <div className="account-field" key={field}><label htmlFor={`${uid}-w${i}-${field}`}>{j === 0 ? 'بداية النافذة' : 'نهاية النافذة'}</label><input id={`${uid}-w${i}-${field}`} name={`windows[${i}][${field}]`} type="datetime-local" required min={form.data.starts_at} max={form.data.ends_at} value={w[field]} onChange={e => updateWindow(i, field, e.target.value)} /></div>)}</div><div className="account-field"><label htmlFor={`${uid}-w${i}-capacity`}>عدد الأماكن في النافذة</label><input id={`${uid}-w${i}-capacity`} name={`windows[${i}][capacity]`} type="number" min="1" max="1000" required value={w.capacity || ''} onChange={e => updateWindow(i, 'capacity', e.target.value)} /></div>{form.data.windows.length > 1 && <button type="button" className="btn btn--quiet" onClick={() => form.setData('windows', form.data.windows.filter((_, index) => i !== index))}>حذف هذه النافذة من الجدول المقترح</button>}</fieldset>)}
    <button className="btn btn--secondary" type="button" disabled={!addable} onClick={() => form.setData('windows', [...form.data.windows, { starts_at: lastEnd!, ends_at: form.data.ends_at, capacity: 10 }])}>إضافة نافذة وصول</button>
    {!addable && <small className="muted">لإضافة نافذة أخرى، اجعل نهاية النافذة الأخيرة قبل نهاية الجلسة، ثم أضف النافذة في المساحة المتبقية.</small>}
    <button className="btn" disabled={!online || form.processing || doctors.length === 0}>{form.processing ? 'جارٍ الحفظ…' : submit}</button>
  </form>;
}
