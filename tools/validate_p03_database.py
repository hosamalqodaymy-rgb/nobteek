"""Exercise the actual PostgreSQL engine without opening server sockets.

This is a limited fallback for this executor; it does not replace Laravel's
normal PDO migration/feature tests on a PostgreSQL server.
"""
from pathlib import Path
import argparse
import json
import re
import subprocess
import uuid

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--postgres',required=True)
parser.add_argument('--pgdata',required=True)
args=parser.parse_args()
data=Path(args.pgdata)
if (data/'postmaster.pid').exists():
    raise SystemExit('Refusing single-user checks while a server may be active.')
database='nobteek_test_p03_'+uuid.uuid4().hex[:8]
checks=[]

def sql(statement, db=database):
    text=' '.join(line for line in statement.splitlines() if not line.lstrip().startswith('--'))+'\n'
    if db == database:
        text='SET ROLE nobteek_test; '+text
    run=subprocess.run([args.postgres,'--single','-D',str(data),'-c','log_error_verbosity=verbose',db],input=text,text=True,capture_output=True)
    return run.stdout+run.stderr

def check(name,statement,expected=None):
    if expected:
        body=f"BEGIN {statement}; SET CONSTRAINTS ALL IMMEDIATE; RAISE EXCEPTION 'expected integrity rejection'; EXCEPTION WHEN SQLSTATE '{expected}' THEN NULL; END;"
    else:
        body=f"IF NOT ({statement}) THEN RAISE EXCEPTION 'assertion failed'; END IF;"
    output=sql(f"BEGIN; DO $test$ BEGIN {body} RAISE LOG 'PASS_{name}'; END $test$; ROLLBACK;")
    passed='ERROR:' not in output and 'FATAL:' not in output and 'PASS_'+name in output
    checks.append({'id':name,'status':'passed' if passed else 'failed',**({'detail':output[-1800:]} if not passed else {})})

def literal(value):
    if value is None:return 'NULL'
    if value is True:return 'TRUE'
    if value is False:return 'FALSE'
    if isinstance(value,(dict,list)):value=json.dumps(value,ensure_ascii=False)
    if isinstance(value,(int,float)):return str(value)
    return "'"+str(value).replace("'","''")+"'"

created=sql(f'CREATE DATABASE {database} OWNER nobteek_test;','postgres')
if 'ERROR:' in created or 'FATAL:' in created:raise SystemExit(created)
schema=(ROOT/'application/database/schema/0001_foundation.sql').read_text()
output=sql('BEGIN;\n'+schema+'\nCOMMIT;')
checks.append({'id':'DB01_migrate_empty_database','status':'passed' if 'ERROR:' not in output and 'FATAL:' not in output else 'failed'})
if checks[-1]['status']=='failed':raise SystemExit(output[-3500:])
fixture=json.loads((ROOT/'application/database/fixtures/foundation_demo.json').read_text());ids=fixture['ids'];q=lambda code:literal(ids[code])
statements=[]
for table,rows in fixture['tables'].items():
    for row in rows:
        key='digest' if table=='ticket_tokens' else 'id'
        columns=','.join(row)
        values=','.join(literal(v) for v in row.values())
        updates=','.join(k+'=EXCLUDED.'+k for k in row if k!=key)
        statements.append(f'INSERT INTO {table} ({columns}) VALUES ({values}) ON CONFLICT ({key}) DO UPDATE SET {updates};')
seed='BEGIN; '+' '.join(statements)+' COMMIT;'
output=sql(seed)
checks.append({'id':'DB02_seed_synthetic_fixture','status':'passed' if 'ERROR:' not in output and 'FATAL:' not in output else 'failed'})
if checks[-1]['status']=='failed':raise SystemExit(output[-3500:])
check('DB03_fixture_counts',"(SELECT count(*)=2 FROM clinics) AND (SELECT count(*)=3 FROM doctors) AND (SELECT count(*)=7 FROM memberships) AND (SELECT count(*)=8 FROM users)")
check('DB04_disabled_accounts',"NOT EXISTS(SELECT 1 FROM users WHERE login_enabled OR password IS NOT NULL)")
check('DB05_shared_family_phone',"(SELECT count(*)=2 FROM patients WHERE contact_phone='+967700000001')")
check('DB06_optional_phone',f"(SELECT contact_phone IS NULL FROM patients WHERE id={q('PAT_A3')})")
check('DB07_cross_clinic_patient',f"UPDATE bookings SET patient_id={q('PAT_B1')} WHERE id={q('BOOK_A2')}",'23503')
check('DB08_cross_clinic_window',f"UPDATE bookings SET window_id={q('W1_B')} WHERE id={q('BOOK_A2')}",'23503')
check('DB09_window_from_other_session',f"UPDATE bookings SET window_id={q('W1_C')} WHERE id={q('BOOK_A2')}",'23503')
check('DB10_cross_clinic_doctor',f"UPDATE clinic_sessions SET doctor_id={q('DR_B')} WHERE id={q('SESSION_A')}",'23503')
check('DB11_cross_clinic_visit',f"UPDATE visits SET doctor_id={q('DR_B')} WHERE id={q('VISIT_A1')}",'23503')
check('DB12_booking_link_matches_visit',f"UPDATE bookings SET visit_id={q('VISIT_B1')} WHERE id={q('BOOK_A2')}",'23503')
check('DB13_cross_clinic_token',f"UPDATE ticket_tokens SET clinic_id={q('CLINIC_B')} WHERE booking_id={q('BOOK_A1')}",'23503')
check('DB14_cross_clinic_audit_actor',f"UPDATE audit_events SET actor_membership_id={q('MEM_RECEPTION_B')} WHERE id={q('EVENT_CLINIC_A')}",'23503')
check('DB15_cross_clinic_outbox_event',f"UPDATE outbox_messages SET clinic_id={q('CLINIC_B')} WHERE id={q('OUTBOX_CLINIC_A')}",'23503')
visit_columns='id,clinic_id,booking_id,session_id,doctor_id,ticket_number,ready_sequence,state'
def visit_insert(booking,number,state='waiting'):
    return f"INSERT INTO visits({visit_columns}) VALUES(gen_random_uuid(),{q('CLINIC_A')},{q(booking)},{q('SESSION_A')},{q('DR_A')},{number},{number},'{state}')"
check('DB16_one_visit_per_booking',visit_insert('BOOK_A1',2),'23505')
check('DB17_ticket_unique_in_session',visit_insert('BOOK_A2',1),'23505')
check('DB18_called_locks_doctor',f"UPDATE visits SET state='called' WHERE id={q('VISIT_A1')}; "+visit_insert('BOOK_A2',2,'in_service'),'23505')
check('DB19_in_service_locks_doctor',f"UPDATE visits SET state='in_service',started_at=arrived_at WHERE id={q('VISIT_A1')}; "+visit_insert('BOOK_A2',2,'called'),'23505')
check('DB20_positive_capacity',f"UPDATE arrival_windows SET capacity=0 WHERE id={q('W1_A')}",'23514')
check('DB21_window_inside_session',f"UPDATE arrival_windows SET ends_at='2026-11-07T16:00:00Z' WHERE id={q('W2_A')}",'23514')
check('DB22_nonoverlapping_windows',f"UPDATE arrival_windows SET starts_at='2026-11-07T13:30:00Z' WHERE id={q('W2_A')}",'23P01')
check('DB23_nonoverlapping_doctor_sessions',f"INSERT INTO clinic_sessions(id,clinic_id,doctor_id,starts_at,ends_at) VALUES(gen_random_uuid(),{q('CLINIC_A')},{q('DR_A')},'2026-11-07T13:30:00Z','2026-11-07T15:30:00Z')",'23P01')
check('DB24_doctor_requires_doctor_membership',f"UPDATE doctors SET user_id={q('RECEPTION_A')} WHERE id={q('DR_A')}",'23503')
check('DB25_no_plaintext_ticket_column',"NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='ticket_tokens' AND column_name IN ('secret','token','raw_token'))")
check('DB26_no_financial_tables',"NOT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('payments','invoices','subscriptions','refunds'))")
output=sql(seed)
checks.append({'id':'DB27_repeat_seed_is_idempotent','status':'passed' if 'ERROR:' not in output and 'FATAL:' not in output else 'failed'})
check('DB28_repeat_preserves_counts',"(SELECT count(*)=4 FROM bookings) AND (SELECT count(*)=2 FROM visits) AND (SELECT count(*)=2 FROM outbox_messages)")
check('DB29_external_delivery_disabled',"NOT EXISTS(SELECT 1 FROM outbox_messages WHERE channel<>'internal' OR status<>'disabled' OR attempts<>0)")
check('DB30_replay_requires_retention',f"INSERT INTO command_replays(clinic_id,actor_scope_digest,key_digest,request_fingerprint,response_ciphertext,expires_at) VALUES({q('CLINIC_A')},repeat('a',64),repeat('b',64),repeat('c',64),'demo-ciphertext',CURRENT_TIMESTAMP+interval '1 hour')",'23514')
check('DB31_application_role_not_superuser',"(SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole FROM pg_roles WHERE rolname=current_user)")
cleanup=sql(f'DROP DATABASE {database};','postgres')
result={'baselineId':'NOBTEEK-P03-1.0','mode':'postgresql_17_single_user','postgresVersion':'17.11','migrationRole':'nobteek_test_non_superuser','checksRun':len(checks),'passed':all(c['status']=='passed' for c in checks),'failures':sum(c['status']!='passed' for c in checks),'pdoConnectionTested':False,'networkServerTested':False,'temporaryDatabaseRemoved':'ERROR:' not in cleanup,'checks':checks}
(ROOT/'results/p03_database_validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='checks'}))
for c in checks:
    if c['status']!='passed':print(json.dumps(c))
raise SystemExit(0 if result['passed'] else 1)
