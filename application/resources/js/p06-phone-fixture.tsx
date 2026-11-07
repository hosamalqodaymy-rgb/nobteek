/** Local phone UI fixture. No authentication, server requests or real bookings. */
import { createInertiaApp, router } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import BookingList, { type BookingData } from './pages/BookingList';
import PublicBooking from './pages/PublicBooking';
import { bookingTransport, type BookingTransport } from './components/BookingTransport';
import '../css/app.css';

const query = new URLSearchParams(location.search);
const screen = query.get('screen') ?? 'PublicBooking';
const pageName = screen.startsWith('Public') ? 'PublicBooking' : 'BookingList';
if (query.get('zoom') === '200') document.documentElement.style.fontSize = '200%';
const day = new Date(Date.now() + 86400000 + 3 * 3600000).toISOString().slice(0, 10);
const localUrl = (name: string) => `phone-preview-frame.html?screen=${name}&zoom=${query.get('zoom') === '200' ? '200' : '100'}`;
const links = Object.fromEntries(['welcome', 'login', 'security', 'logout', 'dashboard', 'sessions.index', 'bookings.index'].map(name => [name, localUrl(name === 'welcome' || name === 'logout' ? 'PublicBooking' : 'BookingList')]));
links.security = localUrl('BookingList') + '&unavailable=1';
links['sessions.index'] = localUrl('BookingList') + '&unavailable=1';
const actions = (id: string) => Object.fromEntries(['confirm', 'reject', 'cancel', 'reschedule'].map(c => [c, `local/${id}/${c}`]));
const session = { id: 'phone-session', doctor_name: 'طبيب تجربة الجوال', starts_at: day + 'T07:00:00Z', windows: [{ id: 'phone-w1', starts_at: day + 'T07:00:00Z', ends_at: day + 'T08:00:00Z' }, { id: 'phone-w2', starts_at: day + 'T08:00:00Z', ends_at: day + 'T09:00:00Z' }] };
const base: BookingData = { id: 'phone-example-001', display_name: 'مراجع تجربة الجوال', contact_phone: '+967700000099', state: screen === 'BookingConfirmed' ? 'confirmed' : 'pending', version: 1, source: 'web', session_id: session.id, window_id: 'phone-w1', doctor_name: session.doctor_name, window_starts_at: session.windows[0].starts_at, window_ends_at: session.windows[0].ends_at, visit_state: null, visit_started: false, has_arrived: false, actions: actions('phone-example-001') };
let bookings: BookingData[] = screen === 'BookingEmpty' ? [] : [{ ...base }];
let filterDay = day, filterState = '';
const props = { errors: {}, brand: { name: 'نوبتيك', tagline: 'يوم عيادتك بترتيب واضح' }, auth: pageName === 'PublicBooking' ? null : { display_name: 'موظف تجربة محلية', username: 'local_preview', platform_admin: false }, links, status: null, privateNotice: null, clinic: { display_name: 'عيادة العرض التجريبية', city: 'ذمار', address_landmark: 'بيانات وهمية لتجربة الهاتف', contact_phone: null }, sessions: [session], bookings, date: day, state: '', server_time: new Date().toISOString(), request_url: 'local/create', public_url: localUrl('PublicBooking'), pagination: { previous: null, next: null } };
function refresh() {
  const visible = filterDay === day ? bookings.filter(b => !filterState || b.state === filterState) : [];
  router.replace({ props: { ...props, bookings: visible, date: filterDay, state: filterState, server_time: new Date().toISOString() }, preserveState: true, preserveScroll: true });
}
const transport: BookingTransport = {
  async post(url, data) {
    if (url === 'local/create') {
      const id = 'phone-created-' + crypto.randomUUID();
      const window = session.windows.find(w => w.id === data.window_id) ?? session.windows[0];
      bookings = [{ ...base, id, state: 'pending', version: 1, display_name: String(data.display_name), contact_phone: data.contact_phone ? String(data.contact_phone) : null, source: String(data.source ?? 'web'), window_id: window.id, window_starts_at: window.starts_at, window_ends_at: window.ends_at, actions: actions(id) }, ...bookings];
      return { status: 201, body: { id, state: 'pending', version: 1 } };
    }
    const [, id, command] = url.split('/');
    const found = bookings.find(b => b.id === id);
    if (!found) return { status: 404, body: { message: 'حجز التجربة غير موجود' } };
    const next = { ...found, version: found.version + 1, state: command === 'confirm' ? 'confirmed' : command === 'reject' ? 'rejected' : command === 'cancel' ? 'cancelled' : found.state };
    if (command === 'reschedule') {
      const window = session.windows.find(w => w.id === data.window_id);
      if (window) { next.window_id = window.id; next.window_starts_at = window.starts_at; next.window_ends_at = window.ends_at; }
    }
    bookings = bookings.map(b => b.id === id ? next : b);
    return { status: 200, body: { id, state: next.state, version: next.version } };
  },
  refresh,
};
router.get = (_url, data) => {
  const filters = (data ?? {}) as Record<string, unknown>;
  filterDay = String(filters.date ?? day); filterState = String(filters.state ?? ''); refresh();
};
router.visit = (url) => {
  const target = new URL(String(url), location.href);
  if (target.searchParams.has('unavailable')) { alert('هذه معاينة واجهات P06 فقط. شاشة الحسابات والجلسات الكاملة ليست ضمن هذا الملف.'); return; }
  if (target.origin === location.origin && target.pathname.endsWith('/phone-preview-frame.html')) location.assign(target.href);
};
router.post = () => location.assign(localUrl('PublicBooking'));
const pages = { BookingList, PublicBooking };
createInertiaApp({ page: { component: pageName, props, url: location.pathname + location.search, version: 'phone-local-only', flash: {}, clearHistory: false, encryptHistory: false, rescuedProps: [], rememberedState: {} }, resolve: name => pages[name as keyof typeof pages], setup({ el, App, props: initial }) { createRoot(el!).render(<bookingTransport.Provider value={transport}><App {...initial} /></bookingTransport.Provider>); } });
