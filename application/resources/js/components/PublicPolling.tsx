import { useCallback, useEffect, useRef, useState } from 'react';

export type PublicRead<T> = { status: number; data: T | null; retryAfter?: number };
export async function readPublicJSON<T>(url: string, signal: AbortSignal, headers: Record<string, string> = {}, credentials: RequestCredentials = 'same-origin'): Promise<PublicRead<T>> {
  const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal, credentials, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
  const retryAfter = Number(response.headers.get('Retry-After'));
  const data = response.ok ? await response.json() as T : null;
  return { status: response.status, data, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined };
}

export function usePublicPolling<T>(read: (signal: AbortSignal) => Promise<PublicRead<T>>, enabled: boolean, seconds: number) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine); const [hidden, setHidden] = useState(() => document.hidden);
  const [stale, setStale] = useState(true); const [unavailable, setUnavailable] = useState(false); const [failed, setFailed] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let disposed = false; let generation = 0; let busy = false; let terminal = false; let failures = 0;
    let timer: number | undefined; let timeout: number | undefined; let controller: AbortController | null = null;
    const interval = Math.max(5000, seconds * 1000);
    function clearTimers() { window.clearTimeout(timer); window.clearTimeout(timeout); }
    function abort() { generation++; clearTimers(); controller?.abort(); controller = null; busy = false; setLoading(false); }
    function canRead() { return enabled && !disposed && navigator.onLine && !document.hidden; }
    async function update() {
      if (!canRead() || busy) return;
      window.clearTimeout(timer); busy = true; setLoading(true); const request = ++generation;
      controller = new AbortController(); const requestController = controller;
      timeout = window.setTimeout(() => requestController.abort(), 12000);
      let delay = interval;
      try {
        const response = await read(requestController.signal);
        if (disposed || request !== generation) return;
        if ([401, 403, 404, 410].includes(response.status)) {
          terminal = true; setData(null); setUnavailable(true); setStale(true); setFailed(false);
        } else if (response.status >= 200 && response.status < 300 && response.data !== null) {
          failures = 0; terminal = false; setData(response.data); setUnavailable(false); setStale(false); setFailed(false);
        } else {
          failures++; setFailed(true); setStale(true); delay = Math.max(interval * 2 ** Math.min(failures, 4), Math.min(response.retryAfter ?? 0, 300000));
        }
      } catch {
        if (disposed || request !== generation) return;
        failures++; setFailed(true); setStale(true); delay = interval * 2 ** Math.min(failures, 4);
      } finally {
        if (!disposed && request === generation) {
          window.clearTimeout(timeout); busy = false; controller = null; setLoading(false);
          if (canRead() && !terminal) timer = window.setTimeout(() => void update(), Math.min(delay, 300000));
        }
      }
    }
    function visibility() {
      setHidden(document.hidden);
      if (document.hidden) { abort(); setStale(true); } else if (!terminal) void update();
    }
    function connectivity() {
      setOnline(navigator.onLine);
      if (!navigator.onLine) { abort(); setStale(true); } else if (!terminal) void update();
    }
    setData(null); setUnavailable(false); setFailed(false); setStale(true);
    refreshRef.current = () => { terminal = false; void update(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    if (enabled) void update();
    return () => { disposed = true; generation++; clearTimers(); controller?.abort(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); refreshRef.current = () => {}; };
  }, [enabled, read, seconds]);
  return { data, loading, online, hidden, stale, unavailable, failed, refresh };
}

export function PollingNotice({ online, hidden, stale, failed, loading, hasData }: { online: boolean; hidden: boolean; stale: boolean; failed: boolean; loading: boolean; hasData: boolean }) {
  if (!online) return <p className="account-alert account-warning" role="status">الاتصال منقطع. {hasData ? 'المعلومات المعروضة قديمة ولا تؤكد الحالة الحالية.' : 'لا نستطيع تأكيد الحالة الآن.'} سيحاول النظام التحديث عند عودة الاتصال.</p>;
  if (hidden) return <p className="account-alert account-warning" role="status">التحديث متوقف أثناء إخفاء الصفحة. ستُراجع الحالة عند العودة إليها.</p>;
  if (failed || (stale && hasData)) return <p className="account-alert account-warning" role="status">تعذر تأكيد آخر تحديث. {hasData ? 'المعلومات المعروضة قديمة؛ راجع وقت آخر تحديث.' : 'لا توجد معلومات مؤكدة لعرضها الآن.'} ستتكرر المحاولة بفواصل أطول.</p>;
  if (loading) return <p className="muted" role="status">{hasData ? 'جارٍ تحديث الحالة…' : 'جارٍ التحقق من الحالة…'}</p>;
  return null;
}
