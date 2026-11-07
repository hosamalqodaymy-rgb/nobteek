"""Exercise real CSRF middleware and independent cookie jars on synthetic localhost only.

Requires the private local QA runner to seed/enable the two demo accounts with
NOBTEEK_HTTP_TEST_PASSWORD. Never run against deployed services or real records.
"""
import argparse
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

parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--synthetic-only',action='store_true');parser.add_argument('--output',default='results/p04_http_validation.json');args=parser.parse_args()
url=args.base_url.rstrip('/');parsed=urlparse(url)
if not args.synthetic_only or parsed.scheme!='http' or parsed.hostname not in {'127.0.0.1','localhost'} or parsed.path:
    raise SystemExit('Only explicitly opted-in synthetic localhost runs are allowed.')
password=os.environ.get('NOBTEEK_HTTP_TEST_PASSWORD')
if not password:raise SystemExit('A private synthetic QA password is required.')
checks=[]
def check(name,condition):
 checks.append({'id':name,'status':'passed' if condition else 'failed'})
 if not condition:raise AssertionError(name)
def get(client,path):return client.get(url+path,timeout=15)
def post(client,path,data,csrf=True):
 headers={'Accept':'application/json'}
 if csrf:headers['X-XSRF-TOKEN']=unquote(client.cookies.get('XSRF-TOKEN',''))
 return client.post(url+path,json=data,headers=headers,allow_redirects=False,timeout=15)
def page(response):
 match=re.search(r'<script[^>]*data-page="app"[^>]*>([\s\S]*?)</script>',response.text)
 if not match:raise AssertionError('Expected real Inertia HTML page')
 return json.loads(match.group(1))
def login(client,username):
 get(client,'/login')
 return post(client,'/login',{'username':username,'password':password})
a=Session();b=Session();recovery_session=Session();owner=Session()
report={'baselineId':'NOBTEEK-P04-1.0','scope':'real_local_HTTP_CSRF_cookies_two_independent_sessions_synthetic_only','checks':checks,'passed':False}
try:
 r=get(a,'/login');check('H01_login_page_and_no_store',r.status_code==200 and 'no-store' in r.headers.get('Cache-Control',''))
 cookie=' '.join(r.headers.get_all('Set-Cookie',[])).lower();check('H02_cookie_httponly_samesite','httponly' in cookie and 'samesite=lax' in cookie)
 check('H03_csrf_missing_rejected',post(a,'/login',{'username':'demo_reception_a','password':password},csrf=False).status_code==419)
 old=a.cookies.get('nobteek-session')
 check('H04_first_real_login',login(a,'demo_reception_a').status_code==302)
 check('H05_second_independent_login',login(b,'demo_reception_a').status_code==302 and login(recovery_session,'demo_reception_a').status_code==302)
 check('H06_both_sessions_can_read',[get(c,'/v1/patients').status_code for c in (a,b)]==[200,200])
 check('H07_cross_clinic_denied',get(a,'/v1/patients/9e413304-3e0b-5313-bc32-c5fe834f6386').status_code==404)
 get(a,'/account/security')
 changed=post(a,'/account/password',{'current_password':password,'password':'SyntheticChanged123','password_confirmation':'SyntheticChanged123'})
 check('H08_change_password_real_csrf',changed.status_code==302)
 check('H15_stale_session_can_open_recovery',get(recovery_session,'/recover').status_code==200 and page(get(recovery_session,'/recover'))['props']['auth'] is None)
 check('H09_only_changing_session_survives',get(a,'/v1/patients').status_code==200 and b.get(url+'/v1/patients',headers={'Accept':'application/json'},timeout=15).status_code==401)
 check('H10_logout_closes_current_session',post(a,'/logout',{}).status_code==302 and a.get(url+'/v1/patients',headers={'Accept':'application/json'},timeout=15).status_code==401)
 check('H11_owner_password_requires_mfa',login(owner,'demo_owner_a').headers.get('Location','').endswith('/account/security') and owner.get(url+'/v1/patients',headers={'Accept':'application/json'},timeout=15).status_code==423)
 security=page(get(owner,'/account/security'))
 check('H12_history_encryption_no_raw_credentials',security.get('encryptHistory') is True and security['props']['auth'].keys()=={'username','display_name','platform_admin'})
 check('H13_get_logout_is_not_allowed',get(owner,'/logout').status_code==405)
 check('H14_sensitive_debug_recorder_not_exposed',get(owner,'/_inertia/devtools/entries').status_code==404)
 report['passed']=True
finally:
 target=Path(__file__).resolve().parents[1]/args.output;target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'passed':report['passed'],'checksRun':len(checks),'checks':checks}))
