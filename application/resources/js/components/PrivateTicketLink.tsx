import { useId, useState } from 'react';
import { dateLabel, timeLabel } from './ScheduleForm';

export function PrivateTicketLink({ url, expiresAt }: { url: string; expiresAt?: string | null }) {
  const uid = useId(); const [notice, setNotice] = useState('');
  let valid = false;
  try { const parsed = new URL(url, window.location.origin); valid = parsed.origin === window.location.origin && parsed.pathname === '/ticket' && /^#[a-f0-9]{64}$/i.test(parsed.hash); } catch { valid = false; }
  if (!valid) return <p className="account-alert account-warning" role="status">تعذر عرض رابط المتابعة. راجع العيادة لاستعادته بعد التحقق من هويتك.</p>;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setNotice('نُسخ الرابط الخاص. احفظه في مكان آمن لصاحبه.'); }
    catch { document.getElementById(uid)?.focus(); setNotice('حدد الرابط من الحقل وانسخه يدويًا.'); }
  }
  function save() {
    const object = URL.createObjectURL(new Blob([url + '\n'], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = object; anchor.download = 'nobteek-private-link.txt'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(object), 1000); setNotice('طُلب حفظ ملف الرابط. احتفظ به في مكان خاص.');
  }
  return <section className="private-ticket-link" aria-label="حفظ رابط المتابعة الخاص">
    <h3>احفظ رابط المتابعة الخاص</h3><p>من يملك هذا الرابط يستطيع مشاهدة حالة هذا الحجز. سلّمه لصاحبه فقط ولا تنشره في مجموعة أو صورة.</p>
    <label htmlFor={uid}>رابط المتابعة الخاص</label><textarea id={uid} className="private-ticket-value" readOnly dir="ltr" rows={3} value={url} onFocus={e => e.target.select()} autoComplete="off" spellCheck={false} />
    <div className="actions"><button type="button" className="btn btn--secondary" onClick={() => void copy()}>نسخ الرابط الخاص</button><button type="button" className="btn btn--secondary" onClick={save}>حفظ ملف الرابط</button><a className="btn btn--quiet" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">فتح رابط المتابعة</a></div>
    {expiresAt && <p className="muted">صالح حتى {dateLabel(expiresAt)} · {timeLabel(expiresAt)} بتوقيت اليمن. استعادة رابط جديد تبطل القديم.</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
  </section>;
}
