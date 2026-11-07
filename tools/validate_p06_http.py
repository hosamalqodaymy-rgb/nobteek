"""Real HTTP, CSRF, independent actors and concurrent booking requests on synthetic localhost only."""
import argparse,base64,datetime,hashlib,hmac,http.cookiejar,json,os,re,struct,threading,time,urllib.error,urllib.request,uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote,urlparse

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
class Client:
 def __init__(self,other=None):
  self.jar=http.cookiejar.CookieJar()
  if other:
   import copy
   for cookie in other.jar:self.jar.set_cookie(copy.copy(cookie))
  self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar),NoRedirect())
 @property
 def cookies(self):return {c.name:c.value for c in self.jar}
 def request(self,method,path,data=None,csrf=True,html=False,headers=None):
  hdr={'Accept':'text/html' if html else 'application/json',**(headers or {})}
  if data is not None:
   hdr['Content-Type']='application/json'
   if csrf:hdr['X-XSRF-TOKEN']=unquote(self.cookies.get('XSRF-TOKEN',''))
  req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),method=method,headers=hdr)
  try:response=self.opener.open(req,timeout=20)
  except urllib.error.HTTPError as error:response=error
  raw=response.read().decode()
  return SimpleNamespace(status=response.code,body=json.loads(raw) if raw.startswith(('{','[')) else None,text=raw,headers=response.headers)
 def get(self,path,html=False):return self.request('GET',path,html=html)
 def post(self,path,data,headers=None,csrf=True):return self.request('POST',path,data,headers=headers,csrf=csrf)
 def page(self,path):
  response=self.get(path,True)
  match=re.search(r'<script[^>]*data-page="app"[^>]*>([\s\S]*?)</script>',response.text)
  if not match:raise AssertionError('Expected Inertia HTML')
  return json.loads(match.group(1))

parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--synthetic-only',action='store_true');parser.add_argument('--output',default='results/p06_http_validation.json');args=parser.parse_args()
base=args.base_url.rstrip('/');origin=urlparse(base)
if not args.synthetic_only or origin.scheme!='http' or origin.hostname not in {'127.0.0.1','localhost'} or origin.path:raise SystemExit('Explicit synthetic localhost testing only.')
password=os.environ.get('NOBTEEK_HTTP_TEST_PASSWORD');secret=os.environ.get('NOBTEEK_HTTP_TEST_MFA_SECRET')
if not password or not secret:raise SystemExit('Synthetic QA credentials are required outside source.')
checks=[]
def check(name,ok):
 checks.append({'id':name,'status':'passed' if ok else 'failed'})
 if not ok:raise AssertionError(name)
def headers(version=None,key=None):return {'Idempotency-Key':key or str(uuid.uuid4()),**({} if version is None else {'If-Match':str(version)})}
def otp():
 digest=hmac.new(base64.b32decode(secret),struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest();offset=digest[-1]&15
 return str((struct.unpack('>I',digest[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
def login(name,mfa=False):
 c=Client();c.page('/login');r=c.post('/login',{'username':name,'password':password});assert r.status==302,'Synthetic login failed'
 if mfa:c.page('/login/challenge');assert c.post('/login/challenge',{'code':otp()}).status==302,'Synthetic OTP failed'
 c.page('/workspace');return c
def command(c,b,action,version=1,key=None,**data):return c.post('/v1/bookings/'+b+'/'+action,{'reason_code':'booking_reviewed' if action=='confirm' else 'patient_request',**data},headers(version,key))
ids=json.loads((Path(__file__).resolve().parents[1]/'application/database/fixtures/foundation_demo.json').read_text())['ids']
report={'baselineId':'NOBTEEK-P06-1.0','scope':'real_local_HTTP_CSRF_MFA_PostgreSQL_with_distinct_staff_and_guest_cookie_jars','passed':False,'checks':checks,'realPatientDataUsed':False,'externalMessagesSent':False,'productionReleaseTested':False}
try:
 owner=login('demo_owner_a',True);reception=login('demo_reception_a');check('K01_real_owner_MFA_and_reception_password',owner.get('/v1/bookings').status==200 and reception.get('/v1/bookings').status==200)
 aden=datetime.timezone(datetime.timedelta(hours=3));day=datetime.datetime.now(aden).date()+datetime.timedelta(days=1);start=datetime.datetime.combine(day,datetime.time(10),aden);fmt=lambda t:t.strftime('%Y-%m-%dT%H:%M')
 schedule={'doctor_id':ids['DR_A'],'starts_at':fmt(start),'ends_at':fmt(start+datetime.timedelta(hours=2)),'windows':[{'starts_at':fmt(start),'ends_at':fmt(start+datetime.timedelta(hours=1)),'capacity':1},{'starts_at':fmt(start+datetime.timedelta(hours=1)),'ends_at':fmt(start+datetime.timedelta(hours=2)),'capacity':1}]}
 r=owner.post('/workspace/sessions',schedule);check('K02_future_scheduled_session_accepts_requests',r.status==201);session=r.body['data'];sid=session['id'];w1,w2=[w['id'] for w in session['windows']]
 public_path='/clinics/'+ids['CLINIC_A']+'/book';a=Client();b=Client();a.page(public_path);b.page(public_path)
 data={'session_id':sid,'window_id':w1,'display_name':'اسم صناعي أول','contact_phone':'٧٠٠٠٠٠٠٩٩'}
 r=a.post('/v1/booking-requests',data,headers(),csrf=False);check('K03_public_CSRF_required',r.status==419)
 key=str(uuid.uuid4());ra=a.post('/v1/booking-requests',data,headers(key=key));check('K04_web_pending_without_visit_or_ticket_number',ra.status==201 and ra.body['state']=='pending' and 'ticket_number' not in ra.body and 'contact_phone' not in ra.body);aid=ra.body['id']
 replay=a.post('/v1/booking-requests',data,headers(key=key));check('K05_lost_response_retry_same_booking',replay.status==201 and replay.body['id']==aid and replay.body['replayed'] is True)
 check('K06_changed_payload_same_key_conflicts',a.post('/v1/booking-requests',{**data,'display_name':'اسم مغاير'},headers(key=key)).status==409)
 rb=b.post('/v1/booking-requests',{**data,'display_name':'اسم صناعي ثان'},headers(key=key));check('K07_different_browser_same_key_independent',rb.status==201 and rb.body['id']!=aid and rb.body['replayed'] is False);bid=rb.body['id']
 ad=owner.get('/v1/bookings/'+aid).body['data'];bd=owner.get('/v1/bookings/'+bid).body['data'];check('K08_shared_family_phone_two_distinct_patients',ad['patient_id']!=bd['patient_id'] and ad['contact_phone']==bd['contact_phone'])
 barrier=threading.Barrier(2);sent=[]
 def compete(pair):
  c,id=pair;barrier.wait(timeout=5);sent.append(time.monotonic_ns());return id,command(c,id,'confirm')
 with ThreadPoolExecutor(max_workers=2) as pool:race=list(pool.map(compete,[(owner,aid),(reception,bid)]))
 check('K09_two_distinct_staff_compete_last_slot',sorted(r.status for _,r in race)==[200,409]);winner=next(id for id,r in race if r.status==200);loser=next(id for id,r in race if r.status==409)
 details=[owner.get('/v1/bookings/'+id).body for id in [aid,bid]]
 check('K10_one_confirmed_one_pending_no_partial_event',sorted(x['data']['state'] for x in details)==['confirmed','pending'] and sum(sum(e['event_type']=='booking_confirm' for e in x['events']) for x in details)==1)
 report['lastSlotRace']={'distinctAuthenticatedActors':True,'actorRoles':['owner','reception'],'requestStartDeltaMilliseconds':round(abs(sent[1]-sent[0])/1e6,3),'httpStatuses':sorted(r.status for _,r in race),'confirmed':1,'pending':1,'bookingConfirmEvents':1}
 d={**data,'window_id':w2,'display_name':'اسم صناعي ثالث'};duplicate_key=str(uuid.uuid4());c1=Client(a);c2=Client(a);barrier2=threading.Barrier(2)
 def duplicate(c):barrier2.wait(timeout=5);return c.post('/v1/booking-requests',d,headers(key=duplicate_key))
 with ThreadPoolExecutor(max_workers=2) as pool:duplicates=list(pool.map(duplicate,[c1,c2]))
 check('K11_parallel_guest_retry_one_result',all(r.status==201 for r in duplicates) and len({r.body['id'] for r in duplicates})==1 and sorted(r.body['replayed'] for r in duplicates)==[False,True]);third=duplicates[0].body['id']
 check('K12_parallel_create_one_audit_event',len(owner.get('/v1/bookings/'+third).body['events'])==1)
 check('K13_second_window_confirmation',command(reception,third,'confirm').status==200)
 blocked=command(owner,winner,'reschedule',2,session_id=sid,window_id=w2);record=owner.get('/v1/bookings/'+winner).body['data'];check('K14_full_target_keeps_original_booking',blocked.status==409 and record['window_id']==w1 and record['version']==2 and record['state']=='confirmed')
 check('K15_cancel_releases_capacity',command(reception,third,'cancel',2).status==200)
 move_key=str(uuid.uuid4());moved=command(owner,winner,'reschedule',2,move_key,session_id=sid,window_id=w2);check('K16_reschedule_atomically_retains_confirmed_state',moved.status==200 and moved.body['state']=='confirmed' and moved.body['version']==3)
 again=command(owner,winner,'reschedule',2,move_key,session_id=sid,window_id=w2);check('K17_reschedule_retry_one_effect',again.status==200 and again.body['replayed'] is True and sum(e['event_type']=='booking_reschedule' for e in owner.get('/v1/bookings/'+winner).body['events'])==1)
 check('K18_old_slot_available_after_move',command(reception,loser,'confirm').status==200)
 check('K19_stale_version_rejected',command(owner,winner,'cancel',2).status==409)
 doctor=login('demo_doctor_a');check('K20_doctor_cannot_manage_bookings',command(doctor,winner,'cancel',3).status==403)
 check('K21_cross_clinic_not_found',reception.get('/v1/bookings/'+ids['BOOK_B1']).status==404)
 check('K22_public_history_and_phone_lookup_denied',a.get('/v1/bookings?phone=700000099').status==401 and reception.get('/v1/bookings?phone=700000099').status==422)
 check('K23_private_headers',all('no-store' in r.headers.get('Cache-Control','') and r.headers.get('Referrer-Policy')=='no-referrer' for r in [ra,rb,reception.get('/v1/bookings/'+winner)]))
 check('K24_staff_page_real_component',reception.page('/workspace/bookings?date='+str(day))['component']=='BookingList')
 direct=reception.post('/v1/booking-requests',{'session_id':sid,'window_id':w1,'display_name':'اسم صناعي دون هاتف','source':'walk_in'},headers());check('K25_direct_contact_optional_no_automatic_arrival',direct.status==201 and reception.get('/v1/bookings/'+direct.body['id']).body['data']['has_arrived'] is False)
 check('K26_pending_rejection_reasoned',command(reception,direct.body['id'],'reject').status==200 and reception.get('/v1/bookings/'+direct.body['id']).body['data']['state']=='rejected')
 check('K27_invalid_phone_rejected_before_write',a.post('/v1/booking-requests',{**data,'contact_phone':'123'},headers()).status==422)
 check('K28_public_cannot_confirm_booking',command(a,winner,'confirm',3).status==401)
 report['passed']=True
finally:
 (Path(__file__).resolve().parents[1]/args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'passed':report['passed'],'checksRun':len(checks),'checks':checks,'lastSlotRace':report.get('lastSlotRace')}))
