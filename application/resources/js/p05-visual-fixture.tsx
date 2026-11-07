/** Isolated visual fixture. Simulated transport never contacts the application API. */
import { createInertiaApp, router } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import PlatformClinics from './pages/PlatformClinics';
import ClinicSettings from './pages/ClinicSettings';
import SessionList from './pages/SessionList';
import SessionDetail, { type SessionData } from './pages/SessionDetail';
import { sessionTransport, type SessionTransport } from './components/SessionTransport';
import '../css/app.css';
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') ?? 'ClinicSettings';
document.documentElement.dataset.fixtureScreen = screen;
document.documentElement.dataset.fixtureZoom = params.get('zoom') ?? '100';
if (params.get('zoom') === '200') document.documentElement.style.fontSize = '200%';
const pageName = screen.startsWith('Session') && !['SessionList','SessionEmpty'].includes(screen) ? 'SessionDetail' : screen === 'SessionEmpty' ? 'SessionList' : screen;
const role = screen === 'SessionDoctor' ? 'doctor' : screen === 'SessionReception' ? 'reception' : 'owner';
const names = ['welcome','login','security','logout','dashboard','team','platform','platform.clinics','platform.clinic.create','clinic.settings','clinic.settings.update','clinic.doctor.create','sessions.index','sessions.create'];
const links = Object.fromEntries(names.map(name => [name, `preview-p05-frame.html?screen=${name.startsWith('platform') ? 'PlatformClinics' : name.startsWith('sessions') ? 'SessionList' : 'ClinicSettings'}`]));
const doctor = { id: 'visual-doctor-a', display_name: 'طبيب تجريبي ألف' };
let session: SessionData = { id: 'visual-session', doctor_id: doctor.id, doctor_name: doctor.display_name, starts_at: '2026-11-07T13:00:00Z', ends_at: '2026-11-07T15:00:00Z', state: screen === 'SessionClosed' ? 'closed' : 'open', version: 1, windows: [{ id: 'visual-window', starts_at: '2026-11-07T13:00:00Z', ends_at: '2026-11-07T15:00:00Z', capacity: 10, reserved: 3, pending: 2 }], total_capacity: 10, booking_count: 5, unresolved_visits: 0, accepting_arrivals: screen !== 'SessionClosed', intake_ended: screen === 'SessionClosed', can_correct_schedule: false };
const events = [{ event_type: 'session_scheduled', reason_code: 'schedule_create', at: '2026-11-06T08:00:00Z' }];
const actions = Object.fromEntries(['open','pause','resume','close','capacity','extend','preview','correct'].map(name => [name, `visual-only-${name}`]));
const props = { errors: {}, brand: { name: 'نوبتيك', tagline: 'يوم عيادتك بترتيب واضح' }, links, status: null, privateNotice: null, auth: { display_name: 'حساب عرض وهمي', username: 'visual_only', platform_admin: screen === 'PlatformClinics' },
 clinic: { display_name: 'عيادة ألف التجريبية', city: 'إب', address_landmark: 'شارع ومعلم تجريبيان', contact_phone: '+967700000001', version: 1 },
 doctors: screen === 'SessionEmpty' ? [] : [{ ...doctor, specialty_optional: 'طب عام', active: true, version: 1, update_url: 'visual-only-doctor' }],
 unlinkedDoctors: [{ id: 'visual-member', display_name: 'طبيب تجريبي باء', username: 'doctor_visual' }],
 clinics: [{ id: 'visual-clinic', display_name: 'عيادة ألف التجريبية', city: 'إب', owner_username: 'owner_visual' }],
 sessions: screen === 'SessionEmpty' ? [] : [{ ...session, show_url: 'preview-p05-frame.html?screen=SessionDetail' }], date: '2026-11-07', role, pagination: { previous: null, next: null }, session, actions, events };
const transport: SessionTransport = {
 async post(url, data) {
  const capacity = Number(data.capacity ?? 10);
  if (url === actions.preview) {
   const available = Math.max(0,capacity-session.windows[0].reserved);
   return { status: 200, body: { old_capacity: session.windows[0].capacity, new_capacity: capacity, reserved: session.windows[0].reserved, pending: 2, pending_exceeding_available: Math.max(0,2-available), total_before: session.total_capacity, total_after: capacity, available_after: available, can_apply: capacity>=session.windows[0].reserved, preview_token:'visual-only-not-valid-on-server', message:capacity>=3?'تبقى الحجوزات القائمة كما هي. راجع الأعداد ثم أكد التغيير.':'الخفض أقل من الحجوزات المؤكدة والمنجزة، ولن يحفظ.' } };
  }
  if (url===actions.capacity) session={...session,version:session.version+1,total_capacity:capacity,windows:[{...session.windows[0],capacity}]};
  else if (url===actions.extend) session={...session,version:session.version+1,ends_at:String(data.ends_at)+'+03:00'};
  else session={...session,version:session.version+1,state:url===actions.pause?'paused':url===actions.close?'closed':'open'};
  events.unshift({event_type:'session_demo',reason_code:String(data.reason_code),at:'2026-11-07T13:30:00Z'});
  return {status:200,body:{id:session.id,state:session.state,version:session.version,server_time:'2026-11-07T13:30:00Z',request_id:'visual-only'}};
 },
 refresh() { router.replace({ props: { ...props, session, events }, preserveState: true, preserveScroll: true }); },
};
const pages = { PlatformClinics, ClinicSettings, SessionList, SessionDetail };
createInertiaApp({ page: { component:pageName,props,url:window.location.pathname+window.location.search,version:'visual-only',flash:{},clearHistory:false,encryptHistory:false,rescuedProps:[],rememberedState:{} }, resolve: name => pages[name as keyof typeof pages], setup({el,App,props:initialProps}) { createRoot(el!).render(<sessionTransport.Provider value={transport}><App {...initialProps}/></sessionTransport.Provider>); } });
