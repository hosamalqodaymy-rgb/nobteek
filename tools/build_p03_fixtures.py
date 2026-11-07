from pathlib import Path
import json
import uuid
import hashlib
from datetime import datetime, timedelta

ROOT=Path(__file__).resolve().parents[1]
f=json.loads((ROOT/'fixtures/clinics_demo.json').read_text())
ids={}
def uid(code):
    ids.setdefault(code,str(uuid.uuid5(uuid.NAMESPACE_URL,'https://nobteek.invalid/demo/'+code)))
    return ids[code]
tables={}
tables['users']=[{'id':uid(a['id']),'username':'demo_'+a['id'].lower(),'display_name':'حساب تجريبي '+a['id'],'password':None,'login_enabled':False,'platform_role':'platform_admin' if a['role']=='platform_admin' else None} for a in f['actors'] if a['role']!='public']
tables['clinics']=[{'id':uid(c['id']),'demo_code':c['id'],'display_name':c['name_ar'],'city':'صنعاء - بيانات وهمية','address_landmark':'عنوان تجريبي','timezone':'Asia/Aden','operational_state':'active'} for c in f['clinics']]
tables['memberships']=[{'id':uid('MEM_'+a['id']),'clinic_id':uid(a['clinic_id']),'user_id':uid(a['id']),'role':a['role'],'active':True,'delegated_permissions':{'call_next':False} if a['role']=='reception' else {}} for a in f['actors'] if a['clinic_id']]
tables['doctors']=[{'id':uid(d['id']),'clinic_id':uid(d['clinic_id']),'user_id':uid(d['actor_id']),'demo_code':d['id'],'display_name':'طبيب تجريبي '+d['id']} for d in f['doctors']]
tables['clinic_sessions']=[{'id':uid(s['id']),'clinic_id':uid(s['clinic_id']),'doctor_id':uid(s['doctor_id']),'demo_code':s['id'],'starts_at':s['starts_at'],'ends_at':s['ends_at'],'state':s['state'],'version':1,'ticket_counter':0 if s['id']=='SESSION_C' else 1,'ready_counter':0 if s['id']=='SESSION_C' else 1} for s in f['sessions']]
tables['arrival_windows']=[{'id':uid(w['id']),'clinic_id':uid(s['clinic_id']),'session_id':uid(s['id']),'demo_code':w['id'],'starts_at':w['starts_at'],'ends_at':w['ends_at'],'capacity':w['capacity']} for s in f['sessions'] for w in s['windows']]
tables['patients']=[{'id':uid(code),'clinic_id':uid(clinic),'demo_code':code,'display_name':name,'contact_phone':phone} for code,clinic,name,phone in [
    ('PAT_A1','CLINIC_A','مراجع تجريبي ألف','+967700000001'),('PAT_A2','CLINIC_A','مراجع تجريبي من الأسرة','+967700000001'),('PAT_A3','CLINIC_A','مراجع تجريبي دون هاتف',None),('PAT_B1','CLINIC_B','مراجع تجريبي باء','+967700000003')]]
books=[('BOOK_A1','CLINIC_A','PAT_A1','SESSION_A','W1_A','phone','confirmed','VISIT_A1'),('BOOK_A2','CLINIC_A','PAT_A2','SESSION_A','W2_A','web','pending',None),('BOOK_C1','CLINIC_A','PAT_A2','SESSION_C','W1_C','web','confirmed',None),('BOOK_B1','CLINIC_B','PAT_B1','SESSION_B','W1_B','phone','confirmed','VISIT_B1')]
tables['bookings']=[{'id':uid(code),'demo_code':code,'clinic_id':uid(clinic),'patient_id':uid(patient),'session_id':uid(session),'window_id':uid(window),'source':source,'state':state,'version':1,'visit_id':uid(visit) if visit else None} for code,clinic,patient,session,window,source,state,visit in books]
tables['visits']=[{'id':uid(visit),'clinic_id':uid(clinic),'booking_id':uid(code),'session_id':uid(session),'doctor_id':uid('DR_A' if clinic=='CLINIC_A' else 'DR_B'),'ticket_number':1,'ready_sequence':1,'priority':False,'state':'waiting','version':1,'arrived_at':f['default_now']} for code,clinic,patient,session,window,source,state,visit in books if visit]
session_map={s['id']:s for s in f['sessions']}
tables['ticket_tokens']=[{'digest':hashlib.sha256(('synthetic-only-'+code).encode()).hexdigest(),'clinic_id':uid(clinic),'booking_id':uid(code),'expires_at':(datetime.fromisoformat(session_map[session]['ends_at'].replace('Z','+00:00'))+timedelta(hours=48)).isoformat(),'revoked_at':None} for code,clinic,patient,session,window,source,state,visit in books]
tables['audit_events']=[{'id':uid('EVENT_'+c),'clinic_id':uid(c),'actor_membership_id':uid('MEM_RECEPTION_'+c[-1]),'entity_type':'clinic','entity_id':uid(c),'event_type':'demo.seed','at':f['default_now'],'reason_code':'synthetic_fixture','request_id':uid('REQUEST_'+c),'safe_changes':{}} for c in ['CLINIC_A','CLINIC_B']]
tables['outbox_messages']=[{'id':uid('OUTBOX_'+c),'clinic_id':uid(c),'event_id':uid('EVENT_'+c),'channel':'internal','status':'disabled','attempts':0} for c in ['CLINIC_A','CLINIC_B']]
out=ROOT/'application/database/fixtures';out.mkdir(exist_ok=True)
(out/'foundation_demo.json').write_text(json.dumps({'classification':'synthetic_only_disabled_accounts_no_external_messages','source':'fixtures/clinics_demo.json','ids':ids,'tables':tables},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:len(v) for k,v in tables.items()}))
