import { createContext, useContext } from 'react';
import { router } from '@inertiajs/react';
export type JSONResult = { status: number; body: Record<string, unknown> };
export type SessionTransport = { post(url: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<JSONResult>; refresh(): void };
export function postJSON(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<JSONResult> {
    return post(url, JSON.stringify(body), { 'Content-Type': 'application/json', ...headers });
}
export function postForm(url: string, body: FormData): Promise<JSONResult> {
    return post(url, body, {});
}
async function post(url: string, body: BodyInit, headers: Record<string, string>): Promise<JSONResult> {
    const token = document.cookie.split('; ').find(value => value.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=') ?? '';
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token), ...headers }, body });
    let data: Record<string, unknown>;
    try { data = await response.json(); } catch { data = { message: 'تعذر قراءة نتيجة الطلب. حدّث البيانات قبل المتابعة.' }; }
    return { status: response.status, body: data };
}
export const sessionTransport = createContext<SessionTransport>({
  post: postJSON,
  refresh() { router.reload({ only: ['session', 'events', 'doctors'] }); },
});
export const useSessionTransport = () => useContext(sessionTransport);
