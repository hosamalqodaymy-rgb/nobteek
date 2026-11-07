/** Isolated visual fixture. No credentials, API calls or real bookings. */
import { createInertiaApp, router } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import BookingList, { type BookingData } from './pages/BookingList';
import PublicBooking from './pages/PublicBooking';
import { bookingTransport, type BookingTransport } from './components/BookingTransport';
import '../css/app.css';
const params = new URLSearchParams(window.location.search); const screen = params.get('screen') ?? 'BookingList';
document.documentElement.dataset.fixtureScreen = screen; document.documentElement.dataset.fixtureZoom = params.get('zoom') ?? '100';
if (params.get('zoom') === '200') document.documentElement.style.fontSize = '200%';
const pageName = screen.startsWith('Public') ? 'PublicBooking' : 'BookingList';
const links = Object.fromEntries(['welcome','login','security','logout','dashboard','sessions.index','bookings.index'].map(name=>[name,'preview-p06-frame.html?screen=BookingList']));
const actions = (id:string) => Object.fromEntries(['confirm','reject','cancel','reschedule'].map(c=>[c,`visual/${id}/${c}`]));
const session = { id:'visual-session',doctor_name:'طبيب عرض تجريبي',starts_at:'2026-11-07T07:00:00Z',windows:[{id:'visual-w1',starts_at:'2026-11-07T07:00:00Z',ends_at:'2026-11-07T08:00:00Z'},{id:'visual-w2',starts_at:'2026-11-07T08:00:00Z',ends_at:'2026-11-07T09:00:00Z'}] };
const base: BookingData = { id:'visual-booking-one',display_name:'مراجع عرض تجريبي',contact_phone:'+967700000099',state:'pending',version:1,source:'web',session_id:session.id,window_id:'visual-w1',doctor_name:session.doctor_name,window_starts_at:'2026-11-07T07:00:00Z',window_ends_at:'2026-11-07T08:00:00Z',visit_state:null,visit_started:false,has_arrived:false,actions:actions('visual-booking-one') };
let bookings:BookingData[] = screen==='BookingEmpty'?[]:[{...base,state:['BookingConfirmed','BookingArrived','BookingStarted'].includes(screen)?'confirmed':screen==='BookingTerminal'?'cancelled':'pending',has_arrived:['BookingArrived','BookingStarted'].includes(screen),visit_state:screen==='BookingArrived'?'waiting':screen==='BookingStarted'?'in_service':null,visit_started:screen==='BookingStarted'}];
const props = {errors:{},brand:{name:'نوبتيك',tagline:'يوم عيادتك بترتيب واضح'},auth:screen.startsWith('Public')?null:{display_name:'موظف عرض تجريبي',username:'visual_only',platform_admin:false},links,status:null,privateNotice:null,clinic:{display_name:'عيادة العرض التجريبية',city:'ذمار',address_landmark:'معلم عرض وهمي',contact_phone:'+967700000001'},sessions:screen==='PublicEmpty'?[]:[session],bookings,date:'2026-11-07',state:'',server_time:'2026-11-07T07:30:00Z',request_url:'visual/create',public_url:'preview-p06-frame.html?screen=PublicBooking',pagination:{previous:null,next:null}};
const transport:BookingTransport = {
 async post(url,data){
  if(url==='visual/create') {const id='visual-created-'+(bookings.length+1);bookings=[{...base,id,display_name:String(data.display_name),contact_phone:data.contact_phone?String(data.contact_phone):null,source:String(data.source??'web'),actions:actions(id)},...bookings];return {status:201,body:{id,state:'pending',version:1}};}
  const [,id,command] = url.split('/');let found=bookings.find(b=>b.id===id);
  if(!found)return {status:404,body:{message:'حجز عرض غير موجود'}};
  const next={...found,version:found.version+1,state:command==='confirm'?'confirmed':command==='reject'?'rejected':command==='cancel'?'cancelled':found.state};
  if(command==='reschedule'){const window=session.windows.find(w=>w.id===data.window_id);if(window){next.window_id=window.id;next.window_starts_at=window.starts_at;next.window_ends_at=window.ends_at;}}
  bookings=bookings.map(b=>b.id===id?next:b);return {status:200,body:{id,state:next.state,version:next.version}};
 },
 refresh(){router.replace({props:{...props,bookings},preserveState:true,preserveScroll:true});}
};
const pages={BookingList,PublicBooking};
createInertiaApp({page:{component:pageName,props,url:window.location.pathname+window.location.search,version:'visual-only',flash:{},clearHistory:false,encryptHistory:false,rescuedProps:[],rememberedState:{}},resolve:name=>pages[name as keyof typeof pages],setup({el,App,props:initialProps}){createRoot(el!).render(<bookingTransport.Provider value={transport}><App {...initialProps}/></bookingTransport.Provider>);}});
