"""Exercise real CSRF middleware and independent cookie jars on synthetic localhost only.

Requires the private local QA runner to seed/enable the two demo accounts with
NOBTEEK_HTTP_TEST_PASSWORD. Never run against deployed services or real records.
"""
import argparse,base64,hmac,hashlib,struct,time,uuid,datetime
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json,os,re,html
from urllib.parse import urlparse,unquote
import urllib.request,urllib.error,http.cookiejar
from types import SimpleNamespace
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
class Session:
 def __init__(self):
  self.jar=http.cookiejar.CookieJar()
  self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
  self.no_redirect=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar),NoRedirect())
 @property
 def cookies(self):return {c.name:c.value for c in self.jar}
 def request(self,method,url,data=None,headers=None,follow=True,timeout=15):
  req=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers=headers or {},method=method)
  if data is not None:req.add_header('Content-Type','application/json')
  try:r=(self.opener if follow else self.no_redirect).open(req,timeout=timeout)
  except urllib.error.HTTPError as e:r=e
  return SimpleNamespace(status_code=r.code,headers=r.headers,text=r.read().decode())
 def get(self,url,headers=None,timeout=15):return self.request('GET',url,headers=headers,timeout=timeout)
 def post(self,url,json,headers=None,allow_redirects=False,timeout=15):return self.request('POST',url,json,headers,allow_redirects,timeout)


parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--synthetic-only',action='store_true');args=parser.parse_args()
url=args.base_url.rstrip('/');origin=urlparse(url)
if not args.synthetic_only or origin.scheme!='http' or origin.hostname not in {'127.0.0.1','localhost'} or origin.path:raise SystemExit('Explicit synthetic localhost testing only.')
password=os.environ.get('NOBTEEK_HTTP_TEST_PASSWORD');secret=os.environ.get('NOBTEEK_HTTP_TEST_MFA_SECRET')
if not password or not secret:raise SystemExit('Private synthetic QA credentials required.')
checks=[]
def check(name,ok):
 checks.append({'id':name,'status':'passed' if ok else 'failed'})
 if not ok:raise AssertionError(name)
def post(client,path,data,headers=None):
 return client.post(url+path,json=data,headers={'Accept':'application/json','X-XSRF-TOKEN':unquote(client.cookies.get('XSRF-TOKEN','')) ,**(headers or {})},timeout=20)
def get(client,path):return client.get(url+path,headers={'Accept':'application/json'},timeout=20)
def dto(response):return json.loads(response.text)
def page(client,path):
 response=client.get(url+path,timeout=20)
 match=re.search(r'<script[^>]*data-page="app"[^>]*>([\s\S]*?)</script>',response.text)
 if not match:raise AssertionError('Expected real Inertia HTML')
 return json.loads(match.group(1))
def otp():
 key=base64.b32decode(secret);msg=struct.pack('>Q',int(time.time())//30);digest=hmac.new(key,msg,hashlib.sha1).digest();offset=digest[-1]&15
 return str((struct.unpack('>I',digest[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
def login(name,mfa=False,pw=None):
 client=Session();page(client,'/login');r=post(client,'/login',{'username':name,'password':pw or password})
 if r.status_code!=302:raise AssertionError('Synthetic login failed')
 if mfa:
  page(client,'/login/challenge');r=post(client,'/login/challenge',{'code':otp()})
  if r.status_code!=302:raise AssertionError('Synthetic OTP failed')
 page(client,'/workspace' if mfa or name=='demo_doctor_a' else '/account/security')
 return client
def headers(version,key=None):return {'If-Match':str(version),'Idempotency-Key':key or str(uuid.uuid4())}
report={'baselineId':'NOBTEEK-P05-1.0','scope':'real_local_HTTP_4_PHP_workers_CSRF_MFA_and_PostgreSQL_synthetic_only','checks':checks,'passed':False,'productionReleaseTested':False}
try:
 owner=login('demo_owner_a',True);check('J01_owner_real_password_TOTP_login',get(owner,'/v1/patients').status_code==200)
 settings=page(owner,'/workspace/clinic')['props'];check('J02_current_clinic_settings',settings['clinic']['version']==1 and len(settings['doctors'])>=2)
 wrong=get(owner,'/v1/sessions/24be0293-4689-5c4d-9c31-cb91c8f0acff');check('J03_other_clinic_session_not_found',wrong.status_code==404)
 aden=datetime.timezone(datetime.timedelta(hours=3));now=datetime.datetime.now(aden).replace(second=0,microsecond=0);start=max(now-datetime.timedelta(minutes=5),now.replace(hour=0,minute=0));end=min(now+datetime.timedelta(minutes=40),now.replace(hour=23,minute=59));fmt=lambda dt:dt.strftime('%Y-%m-%dT%H:%M')
 data={'doctor_id':'7f285a7b-83cf-5038-a003-8a2804b35d2f','starts_at':fmt(start),'ends_at':fmt(end),'windows':[{'starts_at':fmt(start),'ends_at':fmt(end),'capacity':10}]}
 created=post(owner,'/workspace/sessions',data);check('J04_create_real_session_windows',created.status_code==201)
 session=dto(created)['data'];sid=session['id'];wid=session['windows'][0]['id'];base='/v1/sessions/'+sid
 check('J05_local_time_preserves_UTC_instant',datetime.datetime.fromisoformat(session['starts_at'])==start)
 check('J06_version_required',post(owner,base+'/open',{'reason_code':'scheduled_start'}).status_code==428)
 opened=post(owner,base+'/open',{'reason_code':'scheduled_start'},headers(1));check('J07_open_inside_intake',opened.status_code==200 and dto(opened)['version']==2)
 attempt=str(uuid.uuid4())
 with ThreadPoolExecutor(max_workers=2) as pool:
  concurrent=list(pool.map(lambda _:post(owner,base+'/pause',{'reason_code':'operational_pause'},headers(2,attempt)),range(2)))
 check('J08_parallel_same_attempt_one_effect',all(r.status_code==200 and dto(r)['version']==3 for r in concurrent) and sorted(dto(r)['replayed'] for r in concurrent)==[False,True])
 events=page(owner,'/workspace/sessions/'+sid)['props']['events'];check('J09_single_audit_event_for_parallel_pause',sum(e['event_type']=='session_pause' for e in events)==1)
 doctor=login('demo_doctor_a');resumed=post(doctor,base+'/resume',{'reason_code':'service_resumed'},headers(3));check('J10_doctor_resumes_own_session',resumed.status_code==200 and dto(resumed)['version']==4)
 foreign=post(doctor,'/v1/sessions/ec79224f-d370-51b9-a54a-c2e534d67396/pause',{'reason_code':'operational_pause'},headers(1));check('J11_doctor_cannot_operate_other_doctor',foreign.status_code==404)
 preview=post(owner,base+'/capacity/preview',{'window_id':wid,'capacity':4},{'If-Match':'4'});check('J12_preview_does_not_change_capacity',preview.status_code==200 and dto(get(owner,base))['data']['total_capacity']==10)
 payload={'window_id':wid,'capacity':4,'preview_token':dto(preview)['preview_token'],'acknowledged':False,'reason_code':'capacity_adjustment'}
 check('J13_explicit_capacity_acknowledgment_required',post(owner,base+'/capacity',payload,headers(4)).status_code==422)
 payload['acknowledged']=True;attempt=str(uuid.uuid4());saved=post(owner,base+'/capacity',payload,headers(4,attempt));check('J14_confirmed_capacity_change',saved.status_code==200 and dto(saved)['version']==5 and dto(get(owner,base))['data']['total_capacity']==4)
 repeated=post(owner,base+'/capacity',payload,headers(4,attempt));check('J15_capacity_retry_no_duplicate',repeated.status_code==200 and dto(repeated)['replayed'] is True and dto(repeated)['version']==5)
 check('J16_stale_version_conflict',post(owner,base+'/pause',{'reason_code':'operational_pause'},headers(4)).status_code==409)
 extension=min(end+datetime.timedelta(minutes=10),now.replace(hour=23,minute=59));extended=post(owner,base+'/extend',{'ends_at':fmt(extension),'reason_code':'intake_extended'},headers(5));check('J17_extension_without_new_capacity',extended.status_code==200 and dto(get(owner,base))['data']['total_capacity']==4 and len(dto(get(owner,base))['data']['windows'])==1)
 closed=post(owner,base+'/close',{'reason_code':'session_completed'},headers(6));check('J18_close_empty_session',closed.status_code==200 and dto(closed)['state']=='closed')
 check('J19_closed_is_terminal',post(owner,base+'/resume',{'reason_code':'service_resumed'},headers(7)).status_code==409)
 admin=login('demo_platform',True);username='qa_owner_'+uuid.uuid4().hex[:12]
 onboarding=post(admin,'/platform/clinics',{'display_name':'عيادة اختبار HTTP وهمية','city':'إب','address_landmark':'معلم اختباري','contact_phone':'٧٧١٢٣٤٥٦٧','owner_username':username,'owner_display_name':'مالك وهمي'})
 check('J20_platform_onboards_atomic_clinic_owner',onboarding.status_code==201 and 'account_link' in dto(onboarding))
 activation=Session();page(activation,'/account-access');grant=dto(onboarding)['account_link'].split('#token=')[1];new_password='SyntheticOwnerAccess123'
 accepted=post(activation,'/account-access',{'grant_token':grant,'password':new_password,'password_confirmation':new_password});check('J21_owner_activation_link_works',accepted.status_code==302)
 page(activation,'/login');entered=post(activation,'/login',{'username':username,'password':new_password});check('J22_new_owner_requires_MFA_before_use',entered.status_code==302 and entered.headers.get('Location','').endswith('/account/security') and get(activation,'/v1/patients').status_code==423)
 check('J23_platform_has_no_patient_access',get(admin,'/v1/patients').status_code==404)
 report['passed']=True
finally:
 (Path(__file__).resolve().parents[1]/'results/p05_http_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'passed':report['passed'],'checksRun':len(checks),'checks':checks}))
