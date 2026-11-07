/* P02 browser-local transport. No HTTP, database, authentication or payment service. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NOBTEEK_DEMO_DOMAIN=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value));
 class DemoError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
 const reject=(status,code)=>{throw new DemoError(status,code)};
 function normalizePhone(value,required=true){
  let s=String(value||'').trim().replace(/[٠-٩۰-۹]/g,c=>'٠١٢٣٤٥٦٧٨٩'.includes(c)?String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)):String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[\s()\-]/g,'');
  if(!s)return required?reject(422,'contact_required'):null;
  s=s.replace(/^(\+967|00967)/,'');if(!/^7[0-9]{8}$/.test(s))reject(422,'invalid_contact_shape');return '+967'+s;
 }
 class DemoTransport{
  constructor(fixtures,{seed=true,tokenFactory}={}){
   this.fixture=clone(fixtures);this.now=fixtures.default_now;this.mode='normal';this.seq=0;this.counters={};this.replays={};this.events=[];this.outbox=[];
   for(const key of ['clinics','actors','doctors','sessions'])this[key]=Object.fromEntries(clone(fixtures[key]).map(x=>[x.id,x]));
   for(const clinic of Object.values(this.clinics))Object.assign(clinic,{landmark:'عنوان تجريبي للمعاينة',city:'صنعاء'});
   this.doctors.DR_A.display_name='دكتور تجريبي ألف';this.doctors.DR_B.display_name='دكتور تجريبي باء';this.doctors.DR_C.display_name='دكتور تجريبي جيم';
   this.bookings={};this.visits={};this.tokens={};this.tokenFactory=tokenFactory||(()=>{const a=new Uint8Array(18),n=this.id('token');if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(a);return 'DEMO_'+n+'_'+Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');});
   for(const s of Object.values(this.sessions))this.validateSession(s);
   if(seed)this.seed();
  }
  clock(){return new Date(this.now).getTime();}
  id(kind){this.counters[kind]=(this.counters[kind]||0)+1;return kind+'_'+this.counters[kind];}
  context(role,clinic='CLINIC_A',doctor='DR_A'){
   const ids={owner:clinic==='CLINIC_A'?'OWNER_A':'OWNER_B',reception:clinic==='CLINIC_A'?'RECEPTION_A':'RECEPTION_B',doctor:this.doctors[doctor]?.actor_id,public:'PUBLIC',platform_admin:'PLATFORM'};
   return {actor_id:ids[role],clinic_id:clinic,anonymous_scope:role==='public'?'P02_BROWSER_SESSION':null};
  }
  actor(ctx){const a=this.actors[ctx.actor_id];if(!a)reject(401,'authentication_required');if(!this.clinics[ctx.clinic_id]||(a.clinic_id&&a.clinic_id!==ctx.clinic_id))reject(404,'not_found');if(a.role==='public'&&!ctx.anonymous_scope)reject(401,'anonymous_scope_required');return a;}
  scope(rows,id,ctx){const row=rows[id];if(!row||row.clinic_id!==ctx.clinic_id)reject(404,'not_found');return row;}
  permit(ctx,command,s){
   const a=this.actor(ctx),map={request:['public','owner','reception'],confirm:['owner','reception'],reject:['owner','reception'],cancel:['owner','reception'],reschedule:['owner','reception'],check_in:['owner','reception'],walk_in:['owner','reception'],mark_away:['owner','reception','doctor'],return:['owner','reception'],leave:['owner','reception','doctor'],call_next:['doctor'],start:['doctor'],complete:['doctor'],priority:['doctor'],open:['owner'],pause:['owner','doctor'],resume:['owner','doctor'],close:['owner'],capacity:['owner'],extend:['owner'],new_session:['owner'],clinic_update:['owner'],delegate:['owner'],read:['owner','reception','doctor'],report:['owner']};
   if(!(map[command]||[]).includes(a.role)&&!(command==='call_next'&&a.role==='reception'&&a.can_call))reject(403,'forbidden');
   if(a.role==='doctor'&&s&&this.doctors[s.doctor_id]?.actor_id!==ctx.actor_id)reject(404,'not_found');
  }
  validateSession(s,exclude){
   const start=new Date(s.starts_at).getTime(),end=new Date(s.ends_at).getTime(),day=x=>new Date(x+3*3600000).toISOString().slice(0,10);
   if(!(start<end)||day(start)!==day(end))reject(422,'invalid_session_day');
   let last=start;for(const w of [...s.windows].sort((a,b)=>a.starts_at.localeCompare(b.starts_at))){const ws=+new Date(w.starts_at),we=+new Date(w.ends_at);if(!Number.isInteger(w.capacity)||w.capacity<1||ws<last||ws<start||we>end||ws>=we)reject(422,'invalid_window');last=we;}
   if(!s.windows.length)reject(422,'windows_required');
   for(const x of Object.values(this.sessions||{}))if(x.id!==exclude&&x.id!==s.id&&x.clinic_id===s.clinic_id&&x.doctor_id===s.doctor_id&&start<+new Date(x.ends_at)&&end>+new Date(x.starts_at))reject(422,'overlapping_doctor_sessions');
  }
  window(s,id){const w=s.windows.find(x=>x.id===id);if(!w)reject(422,'invalid_window');return w;}
  accepting(s,open=false){if(s.state==='closed')reject(409,'session_closed');if(this.clock()>=+new Date(s.ends_at))reject(409,'intake_ended');if(open&&(!['open','paused'].includes(s.state)||this.clock()<+new Date(s.starts_at)))reject(409,'session_not_open');}
  occupied(s,windowId,exclude){return Object.values(this.bookings).filter(b=>b.session_id===s.id&&['confirmed','fulfilled'].includes(b.state)&&b.id!==exclude&&(!windowId||b.window_id===windowId)).length;}
  space(s,windowId,exclude){const w=this.window(s,windowId);if(this.occupied(s,windowId,exclude)>=w.capacity||this.occupied(s,null,exclude)>=s.windows.reduce((n,x)=>n+x.capacity,0))reject(409,'capacity_full');}
  version(row,expected){if(expected==null)reject(422,'expected_version_required');if(row.version!==expected)reject(409,'stale_version');}
  ready(sessionId){return Object.values(this.visits).filter(v=>v.session_id===sessionId&&v.state==='waiting').sort((a,b)=>Number(b.priority)-Number(a.priority)||a.ready_seq-b.ready_seq);}
  active(doctorId){return Object.values(this.visits).find(v=>v.doctor_id===doctorId&&['called','in_service'].includes(v.state));}
  event(ctx,type,id,reason){const event={id:this.id('event'),clinic_id:ctx.clinic_id,actor_id:ctx.actor_id,type,entity_id:id,at:this.now,reason:reason||null};this.events.push(event);this.outbox.push({event_id:event.id,external_delivery:'disabled'});}
  resolve(ctx,command,id){
   if(['request','walk_in','call_next','open','pause','resume','close','capacity','extend'].includes(command))return {s:this.scope(this.sessions,id,ctx)};
   if(['confirm','reject','cancel','reschedule','check_in'].includes(command)){const b=this.scope(this.bookings,id,ctx);return {b,s:this.scope(this.sessions,b.session_id,ctx)};}
   if(['mark_away','return','leave','start','complete','priority'].includes(command)){const v=this.scope(this.visits,id,ctx);return {v,s:this.scope(this.sessions,v.session_id,ctx)};}
   if(['new_session','clinic_update','delegate'].includes(command))return {s:null};reject(422,'unknown_command');
  }
  command(ctx,command,id,body={},options={}){
   const a=this.actor(ctx);if(this.mode==='offline')reject(0,'offline');if(this.mode==='error')reject(500,'demo_failure');if(this.mode==='forbidden')reject(403,'forbidden');if(this.mode==='conflict')reject(409,'stale_version');
   const target=this.resolve(ctx,command,id);this.permit(ctx,command,target.s);if('clinic_id' in body)reject(422,'clinic_context_is_server_owned');
   const key=options.key;if(!key)reject(422,'idempotency_key_required');const subject=a.role==='public'?'anon/'+ctx.anonymous_scope:ctx.actor_id;
   const cacheKey=ctx.clinic_id+'/'+subject+'/'+key,fingerprint=JSON.stringify([command,id,body,options.expected]);
   if(this.replays[cacheKey]){if(this.replays[cacheKey].fingerprint!==fingerprint)reject(409,'idempotency_key_reused');return clone(this.replays[cacheKey].response);}
   const before=clone({sessions:this.sessions,bookings:this.bookings,visits:this.visits,tokens:this.tokens,events:this.events,outbox:this.outbox,counters:this.counters,clinics:this.clinics,actors:this.actors,seq:this.seq});
   try{const result=this.execute(ctx,command,id,clone(body),options.expected,target);this.invariants();const response={status:['request','walk_in','check_in','new_session'].includes(command)?201:200,data:{...result,server_time:this.now,request_id:this.id('request')}};this.replays[cacheKey]={fingerprint,response:clone(response)};return response;}catch(error){Object.assign(this,before);throw error;}
  }
  request(ctx,s,body){
   this.accepting(s);const w=this.window(s,body.window_id);if(this.clock()>=+new Date(w.ends_at))reject(409,'window_ended');
   const name=String(body.display_name||'').trim();if(name.length<2||name.length>80)reject(422,'invalid_display_name');
   const source=this.actor(ctx).role==='public'?'web':body.source||'phone';if(!['web','phone','walk_in'].includes(source))reject(422,'invalid_source');
   const phone=normalizePhone(body.contact_phone,source!=='walk_in'),id=this.id('booking'),token=this.tokenFactory();
   const b={id,clinic_id:ctx.clinic_id,session_id:s.id,window_id:w.id,display_name:name,contact_phone:phone,source,state:'pending',version:1,visit_id:null};this.bookings[id]=b;this.tokens[token]=id;this.event(ctx,'booking.request',id);
   return {booking_id:id,state:'pending',version:1,ticket_number:null,secret:token};
  }
  checkIn(ctx,b,s){
   this.accepting(s,true);if(b.state!=='confirmed'||b.visit_id)reject(409,'arrival_already_recorded');if(this.clock()<+new Date(this.window(s,b.window_id).starts_at))reject(409,'arrival_window_not_started');
   const id=this.id('visit'),ticketKey='ticket_'+s.id;this.counters[ticketKey]=(this.counters[ticketKey]||0)+1;
   const v={id,clinic_id:ctx.clinic_id,session_id:s.id,doctor_id:s.doctor_id,booking_id:b.id,state:'waiting',version:1,ticket_number:this.counters[ticketKey],ready_seq:++this.seq,priority:false,arrived_at:this.now,called_at:null,started_at:null,completed_at:null,returned_at:null};
   this.visits[id]=v;b.visit_id=id;b.version++;this.event(ctx,'visit.check_in',id);return {visit_id:id,state:'waiting',version:1,ticket_number:v.ticket_number};
  }
  execute(ctx,cmd,id,body,expected,target){
   let {s,b,v}=target;
   if(cmd==='request')return this.request(ctx,s,body);
   if(cmd==='walk_in'){
    this.accepting(s,true);const w=s.windows.find(w=>this.clock()>=+new Date(w.starts_at)&&this.clock()<+new Date(w.ends_at));if(!w)reject(409,'no_current_window');this.space(s,w.id);
    const result=this.request(ctx,s,{...body,window_id:w.id,source:'walk_in'});b=this.bookings[result.booking_id];b.state='confirmed';b.version++;this.event(ctx,'booking.confirm',b.id);return {...this.checkIn(ctx,b,s),booking_id:b.id,secret:result.secret};
   }
   if(cmd==='new_session'){
    const doctor=this.scope(this.doctors,body.doctor_id,ctx),sid=this.id('session');
    const next={id:sid,clinic_id:ctx.clinic_id,doctor_id:doctor.id,state:'scheduled',version:1,starts_at:body.starts_at,ends_at:body.ends_at,windows:[{id:'window_'+sid,starts_at:body.starts_at,ends_at:body.ends_at,capacity:Number(body.capacity)}]};this.validateSession(next);this.sessions[sid]=next;this.event(ctx,'session.created',sid);return {session_id:sid,state:next.state,version:1};
   }
   if(cmd==='clinic_update'){const c=this.clinics[ctx.clinic_id];if(String(body.name||'').trim().length<2)reject(422,'invalid_display_name');c.name_ar=String(body.name).trim();c.landmark=String(body.landmark||'').trim();this.event(ctx,'clinic.updated',c.id);return {clinic_id:c.id,state:'updated'};}
   if(cmd==='delegate'){const actor=this.scope(this.actors,body.actor_id,ctx);if(actor.role!=='reception')reject(422,'invalid_actor');actor.can_call=!!body.can_call;this.event(ctx,'membership.delegated',actor.id);return {actor_id:actor.id,state:actor.can_call?'delegated':'default'};}
   if(['open','pause','resume','close','capacity','extend'].includes(cmd)){
    this.version(s,expected);if(s.state==='closed')reject(409,'session_closed');
    if(['pause','resume','close','capacity','extend'].includes(cmd)&&!String(body.reason||'').trim())reject(422,'reason_required');
    if(cmd==='open'){if(s.state!=='scheduled'||this.clock()<+new Date(s.starts_at)||this.clock()>=+new Date(s.ends_at))reject(409,'invalid_transition');s.state='open';}
    if(cmd==='pause'){if(s.state!=='open')reject(409,'invalid_transition');s.state='paused';}
    if(cmd==='resume'){if(s.state!=='paused')reject(409,'invalid_transition');s.state='open';}
    if(cmd==='close'){if(Object.values(this.visits).some(v=>v.session_id===id&&['waiting','called','in_service','away'].includes(v.state)))reject(409,'unresolved_visits');s.state='closed';}
    if(cmd==='capacity'){const w=this.window(s,body.window_id),n=Number(body.capacity);if(!Number.isInteger(n)||n<1)reject(422,'invalid_capacity');if(n<this.occupied(s,w.id))reject(409,'capacity_below_reservations');w.capacity=n;}
    if(cmd==='extend'){const end=+new Date(body.ends_at);if(!(end>+new Date(s.ends_at))||new Date(end+10800000).toISOString().slice(0,10)!==new Date(+new Date(s.starts_at)+10800000).toISOString().slice(0,10))reject(422,'invalid_extension');s.ends_at=new Date(end).toISOString();}
    s.version++;this.event(ctx,'session.'+cmd,id,body.reason);return {session_id:id,state:s.state,version:s.version};
   }
   if(b){
    this.version(b,expected);if(s.state==='closed')reject(409,'session_closed');
    if(cmd==='confirm'){this.accepting(s);if(b.state!=='pending')reject(409,'invalid_transition');if(this.clock()>=+new Date(this.window(s,b.window_id).ends_at))reject(409,'window_ended');this.space(s,b.window_id);b.state='confirmed';}
    else if(cmd==='reject'){if(b.state!=='pending')reject(409,'invalid_transition');if(!body.reason)reject(422,'reason_required');b.state='rejected';}
    else if(cmd==='cancel'){if(!['pending','confirmed'].includes(b.state))reject(409,'invalid_transition');if(!body.reason)reject(422,'reason_required');if(b.visit_id){const x=this.visits[b.visit_id];if(['in_service','completed'].includes(x.state))reject(409,'visit_already_started');x.state='left';x.version++;}b.state='cancelled';}
    else if(cmd==='reschedule'){if(!['pending','confirmed'].includes(b.state)||b.visit_id)reject(409,'arrival_already_recorded');if(!body.reason)reject(422,'reason_required');const next=this.scope(this.sessions,body.session_id,ctx);this.accepting(next);const w=this.window(next,body.window_id);if(this.clock()>=+new Date(w.ends_at))reject(409,'window_ended');if(b.state==='confirmed')this.space(next,w.id,b.id);b.session_id=next.id;b.window_id=w.id;}
    else if(cmd==='check_in')return this.checkIn(ctx,b,s);
    b.version++;this.event(ctx,'booking.'+cmd,id,body.reason);return {booking_id:id,state:b.state,version:b.version};
   }
   if(s.state==='closed')reject(409,'session_closed');
   if(cmd==='call_next'){this.version(s,expected);if(s.state!=='open')reject(409,'session_not_open');if(this.active(s.doctor_id))reject(409,'doctor_busy');v=this.ready(s.id)[0];if(!v)reject(409,'queue_empty');v.state='called';v.called_at=this.now;v.version++;s.version++;}
   else{
    this.version(v,expected);
    if(cmd==='start'){if(v.state!=='called')reject(409,'invalid_transition');v.state='in_service';v.started_at=this.now;}
    else if(cmd==='complete'){if(v.state!=='in_service')reject(409,'invalid_transition');v.state='completed';v.completed_at=this.now;const x=this.bookings[v.booking_id];x.state='fulfilled';x.version++;}
    else if(['mark_away','leave'].includes(cmd)){if(!['waiting','called','away'].includes(v.state)||(cmd==='mark_away'&&v.state==='away'))reject(409,'invalid_transition');if(!body.reason)reject(422,'reason_required');v.state=cmd==='leave'?'left':'away';}
    else if(cmd==='return'){if(v.state!=='away')reject(409,'invalid_transition');v.state='waiting';v.priority=false;v.ready_seq=++this.seq;v.returned_at=this.now;}
    else if(cmd==='priority'){if(v.state!=='waiting')reject(409,'invalid_transition');if(body.reason!=='clinical_priority')reject(422,'reason_required');v.priority=true;v.ready_seq=++this.seq;}
    v.version++;
   }
   this.event(ctx,'visit.'+cmd,v.id,body.reason);return {visit_id:v.id,state:v.state,version:v.version,ticket_number:v.ticket_number};
  }
  ticket(secret){
   const b=this.bookings[this.tokens[secret]];if(!b)reject(404,'not_found');const s=this.sessions[b.session_id];if(this.clock()>=+new Date(s.ends_at)+48*3600000)reject(404,'not_found');const v=this.visits[b.visit_id],active=this.active(s.doctor_id);
   return {booking_state:b.state,visit_state:v?.state||null,ticket_number:v?.ticket_number||null,waiting_ahead:v?.state==='waiting'?this.ready(s.id).findIndex(x=>x.id===v.id):null,doctor_state:active?.state||'available',session_state:s.state,window_starts_at:this.window(s,b.window_id).starts_at,window_ends_at:this.window(s,b.window_id).ends_at,server_time:this.now,booking_version:b.version,visit_version:v?.version||null};
  }
  snapshot(ctx){
   const a=this.actor(ctx);if(a.role==='platform_admin')return clone({clinics:Object.values(this.clinics),actors:Object.values(this.actors),sessions:Object.values(this.sessions),events:this.events.filter(x=>!x.type.startsWith('visit.')&&!x.type.startsWith('booking.'))});
   this.permit(ctx,'read');const sessions=Object.values(this.sessions).filter(s=>s.clinic_id===ctx.clinic_id&&(a.role!=='doctor'||this.doctors[s.doctor_id].actor_id===ctx.actor_id)),ids=new Set(sessions.map(s=>s.id));
   return clone({clinic:this.clinics[ctx.clinic_id],doctors:Object.values(this.doctors).filter(d=>d.clinic_id===ctx.clinic_id&&(a.role!=='doctor'||d.actor_id===ctx.actor_id)),sessions,bookings:Object.values(this.bookings).filter(b=>ids.has(b.session_id)),visits:Object.values(this.visits).filter(v=>ids.has(v.session_id)),actors:Object.values(this.actors).filter(x=>x.clinic_id===ctx.clinic_id),events:this.events.filter(e=>e.clinic_id===ctx.clinic_id)});
  }
  report(ctx){this.permit(ctx,'report');const data=this.snapshot(ctx),complete=data.visits.filter(v=>v.state==='completed'),timed=complete.filter(v=>v.arrived_at&&v.started_at),values=timed.map(v=>(+new Date(v.started_at)-+new Date(v.arrived_at))/60000);return {completed:complete.length,waiting:data.visits.filter(v=>v.state==='waiting').length,left:data.visits.filter(v=>v.state==='left').length,missing_times:complete.length-timed.length,average_wait_minutes:values.length?values.reduce((n,x)=>n+x,0)/values.length:null};}
  advance(minutes){if(!Number.isFinite(minutes)||minutes<0)reject(422,'invalid_time');this.now=new Date(this.clock()+minutes*60000).toISOString();}
  seed(){
   const call=(ctx,cmd,id,body={},expected)=>this.command(ctx,cmd,id,body,{key:'seed-'+(++this.seq),expected}).data;
   for(const [clinic,doctor,session,window,name,present] of [['CLINIC_A','DR_A','SESSION_A','W1_A','مراجع تجريبي ألف',true],['CLINIC_A','DR_C','SESSION_C','W1_C','مراجع تجريبي جيم',false],['CLINIC_B','DR_B','SESSION_B','W1_B','مراجع تجريبي باء',true]]){
    const ctx=this.context('reception',clinic,doctor),b=call(ctx,'request',session,{window_id:window,display_name:name,contact_phone:'700000001',source:'phone'});call(ctx,'confirm',b.booking_id,{},1);if(present)call(ctx,'check_in',b.booking_id,{},2);
   }
   call(this.context('public'),'request','SESSION_A',{window_id:'W2_A',display_name:'طلب تجريبي جديد',contact_phone:'700000002'});
  }
  invariants(){
   for(const s of Object.values(this.sessions))for(const w of s.windows)if(this.occupied(s,w.id)>w.capacity)throw Error('Capacity invariant');
   const tickets=new Set(),active=new Set();for(const v of Object.values(this.visits)){const key=v.session_id+'/'+v.ticket_number;if(tickets.has(key))throw Error('Ticket reused');tickets.add(key);if(['called','in_service'].includes(v.state)){if(active.has(v.doctor_id))throw Error('Doctor double occupied');active.add(v.doctor_id);}const b=this.bookings[v.booking_id],s=this.sessions[v.session_id];if(b.clinic_id!==v.clinic_id||s.clinic_id!==v.clinic_id||b.visit_id!==v.id||v.doctor_id!==s.doctor_id)throw Error('Tenant relation invariant');}
  }
 }
 return {DemoTransport,DemoError,normalizePhone};
});
