import copy
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from model.reference_model import ReferenceClinic, Context, Rejected, clock, normalize_phone

ROOT=Path(__file__).resolve().parents[1]


class WorkflowTests(unittest.TestCase):
    """T00B: executable examples of the rules, not production integration tests."""

    def setUp(self):
        self.f=json.loads((ROOT/'fixtures/clinics_demo.json').read_text())
        self.m=ReferenceClinic(self.f)
        self.now=clock(self.f['default_now'])
        self.rec=Context('RECEPTION_A','CLINIC_A')
        self.owner=Context('OWNER_A','CLINIC_A')
        self.doc=Context('DOCTOR_A','CLINIC_A')
        self.public=Context('PUBLIC','CLINIC_A','REFERENCE_ONLY_ANON_A')
        self.keys=0

    def cmd(self, command, ident, body=None, actor=None, now=None, key=None, expected=None):
        self.keys+=1
        c=actor or self.rec
        if expected is None and command not in ('request','walk_in'):
            table = self.m.sessions if command in ('call_next','open','pause','resume','close','capacity','extend') else self.m.bookings if command in ('confirm','reject','cancel','reschedule','check_in') else self.m.visits
            if ident in table: expected=table[ident]['version']
        return self.m.execute(c,command,ident,body,key=key or 'key-'+str(self.keys),expected=expected,now=now or self.now)

    def booking(self, name='مراجع تجريبي', window='W1_A', session='SESSION_A', actor=None, confirm=False):
        result=self.cmd('request',session,{'window_id':window,'display_name':name,'contact_phone':'700000001'},actor=actor or self.public)
        if confirm: self.cmd('confirm',result['booking_id'],actor=actor or self.rec)
        return result

    def arrived(self, name='مراجع تجريبي'):
        b=self.booking(name,confirm=True)
        return b,self.cmd('check_in',b['booking_id'])

    def rejected(self,status,call):
        with self.assertRaises(Rejected) as result: call()
        self.assertEqual(result.exception.status,status)
        return result.exception.code

    def test_W01_complete_journey_without_finance(self):
        b,v=self.arrived()
        self.assertEqual(self.m.ticket(b['secret'],now=self.now)['visit_state'],'waiting')
        called=self.cmd('call_next','SESSION_A',actor=self.doc)
        self.assertEqual(called['visit_id'],v['visit_id'])
        self.cmd('start',v['visit_id'],actor=self.doc)
        self.cmd('complete',v['visit_id'],actor=self.doc,now=self.now+timedelta(minutes=12))
        self.cmd('close','SESSION_A',{'reason':'day_finished'},actor=self.owner)
        self.assertEqual(self.m.bookings[b['booking_id']]['state'],'fulfilled')
        self.assertEqual(self.m.sessions['SESSION_A']['state'],'closed')
        self.assertTrue(all(x['external_delivery']=='disabled' for x in self.m.outbox))

    def test_W02_pending_requests_neither_reserve_capacity_nor_receive_tickets(self):
        self.m.sessions['SESSION_A']['windows'][0]['capacity']=1
        requests=[self.booking('مراجع تجريبي '+str(i)) for i in range(4)]
        self.assertTrue(all(x['state']=='pending' and x['ticket_number'] is None for x in requests))
        self.assertFalse(self.m.visits)
        self.cmd('confirm',requests[-1]['booking_id'])
        self.assertEqual(sum(b['state']=='confirmed' for b in self.m.bookings.values()),1)

    def test_W03_competing_last_slot_has_one_success_in_reference_model(self):
        self.m.sessions['SESSION_A']['windows'][0]['capacity']=1
        a,b=self.booking('تجريبي ألف'),self.booking('تجريبي باء')
        def attempt(index,booking):
            try:
                self.m.execute(self.rec,'confirm',booking['booking_id'],{},key='competing-'+str(index),expected=1,now=self.now)
                return 'confirmed'
            except Rejected as e:return e.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(attempt,i,booking) for i,booking in enumerate((a,b))]
            outcomes=[x.result() for x in futures]
        self.assertCountEqual(outcomes,['confirmed','capacity_full'])
        self.m.invariants()

    def test_W04_retry_same_request_returns_same_result_and_one_event(self):
        body={'window_id':'W1_A','display_name':'تجريبي ألف','contact_phone':'700000001'}
        first=self.cmd('request','SESSION_A',body,actor=self.public,key='request-retry')
        second=self.cmd('request','SESSION_A',body,actor=self.public,key='request-retry')
        self.assertEqual(first,second)
        self.assertEqual(len(self.m.bookings),1)
        self.assertEqual(len(self.m.events),1)

    def test_W05_reusing_key_with_different_body_is_rejected(self):
        body={'window_id':'W1_A','display_name':'تجريبي ألف','contact_phone':'700000001'}
        self.cmd('request','SESSION_A',body,actor=self.public,key='same-key')
        self.rejected(409,lambda:self.cmd('request','SESSION_A',{**body,'display_name':'تجريبي باء'},actor=self.public,key='same-key'))
        self.assertEqual(len(self.m.bookings),1)

    def test_W06_stale_version_preserves_state_and_event_count(self):
        b=self.booking(confirm=True)
        before=len(self.m.events)
        code=self.rejected(409,lambda:self.cmd('cancel',b['booking_id'],{'reason':'patient_request'},expected=1))
        self.assertEqual(code,'stale_version')
        self.assertEqual(self.m.bookings[b['booking_id']]['state'],'confirmed')
        self.assertEqual(len(self.m.events),before)

    def test_W07_cross_clinic_read_and_write_share_not_found(self):
        b=self.booking(confirm=True)
        wrong=Context('RECEPTION_B','CLINIC_B')
        self.rejected(404,lambda:self.m.read_booking(wrong,b['booking_id']))
        self.rejected(404,lambda:self.cmd('cancel',b['booking_id'],{'reason':'x'},actor=wrong))
        self.assertEqual(self.m.bookings[b['booking_id']]['state'],'confirmed')

    def test_W08_tenant_id_in_body_is_not_trusted(self):
        code=self.rejected(422,lambda:self.cmd('request','SESSION_A',{'clinic_id':'CLINIC_B'},actor=self.public))
        self.assertEqual(code,'clinic_context_is_server_owned')
        self.assertFalse(self.m.bookings)

    def test_W09_doctor_cannot_serve_another_doctors_visit(self):
        _,v=self.arrived()
        self.cmd('call_next','SESSION_A',actor=self.doc)
        other=Context('DOCTOR_C','CLINIC_A')
        self.rejected(404,lambda:self.cmd('start',v['visit_id'],actor=other))
        self.assertEqual(self.m.visits[v['visit_id']]['state'],'called')

    def test_W10_reception_call_is_explicitly_delegated(self):
        self.arrived()
        self.rejected(403,lambda:self.cmd('call_next','SESSION_A'))
        self.m.actors['RECEPTION_A']['can_call']=True
        result=self.cmd('call_next','SESSION_A')
        self.assertEqual(result['state'],'called')
        self.rejected(403,lambda:self.cmd('start',result['visit_id']))

    def test_W11_platform_admin_has_no_default_patient_read(self):
        b=self.booking()
        self.rejected(403,lambda:self.m.read_booking(Context('PLATFORM','CLINIC_A'),b['booking_id']))

    def test_W12_check_in_replay_and_second_key_never_duplicate_ticket(self):
        b=self.booking(confirm=True)
        expected=self.m.bookings[b['booking_id']]['version']
        first=self.cmd('check_in',b['booking_id'],key='arrival-key',expected=expected)
        second=self.cmd('check_in',b['booking_id'],key='arrival-key',expected=expected)
        self.assertEqual(first,second)
        self.rejected(409,lambda:self.cmd('check_in',b['booking_id']))
        self.assertEqual(len(self.m.visits),1)

    def test_W13_calling_twice_cannot_reserve_two_visits(self):
        _,a=self.arrived('تجريبي ألف');self.arrived('تجريبي باء')
        first=self.cmd('call_next','SESSION_A',actor=self.doc)
        code=self.rejected(409,lambda:self.cmd('call_next','SESSION_A',actor=self.doc))
        self.assertEqual(code,'doctor_busy')
        self.assertEqual(first['visit_id'],a['visit_id'])

    def test_W14_service_state_also_reserves_doctor(self):
        _,a=self.arrived('تجريبي ألف');self.arrived('تجريبي باء')
        self.cmd('call_next','SESSION_A',actor=self.doc)
        self.cmd('start',a['visit_id'],actor=self.doc)
        self.rejected(409,lambda:self.cmd('call_next','SESSION_A',actor=self.doc))

    def test_W15_absence_return_keeps_ticket_and_moves_to_end(self):
        _,a=self.arrived('تجريبي ألف');_,b=self.arrived('تجريبي باء')
        self.cmd('mark_away',a['visit_id'],{'reason':'not_present'})
        self.cmd('return',a['visit_id'])
        self.assertEqual([v['id'] for v in self.m.ready('SESSION_A')],[b['visit_id'],a['visit_id']])
        self.assertEqual(self.m.visits[a['visit_id']]['ticket_number'],a['ticket_number'])

    def test_W16_called_patient_marked_away_releases_doctor(self):
        _,a=self.arrived('تجريبي ألف');_,b=self.arrived('تجريبي باء')
        self.cmd('call_next','SESSION_A',actor=self.doc)
        self.cmd('mark_away',a['visit_id'],{'reason':'not_present'})
        self.assertEqual(self.cmd('call_next','SESSION_A',actor=self.doc)['visit_id'],b['visit_id'])

    def test_W17_cancellation_releases_space_without_reusing_number(self):
        self.m.sessions['SESSION_A']['windows'][0]['capacity']=1
        a,va=self.arrived('تجريبي ألف')
        self.cmd('cancel',a['booking_id'],{'reason':'patient_request'})
        b,vb=self.arrived('تجريبي باء')
        self.assertEqual(self.m.visits[va['visit_id']]['state'],'left')
        self.assertGreater(vb['ticket_number'],va['ticket_number'])
        self.assertEqual(len(self.m.bookings),2)

    def test_W18_completed_visit_keeps_historical_capacity(self):
        self.m.sessions['SESSION_A']['windows'][0]['capacity']=1
        _,v=self.arrived();self.cmd('call_next','SESSION_A',actor=self.doc)
        self.cmd('start',v['visit_id'],actor=self.doc);self.cmd('complete',v['visit_id'],actor=self.doc)
        another=self.booking('مراجع آخر')
        self.rejected(409,lambda:self.cmd('confirm',another['booking_id']))

    def test_W19_in_service_cannot_be_cancelled(self):
        b,v=self.arrived();self.cmd('call_next','SESSION_A',actor=self.doc);self.cmd('start',v['visit_id'],actor=self.doc)
        self.rejected(409,lambda:self.cmd('cancel',b['booking_id'],{'reason':'patient_request'}))
        self.assertEqual(self.m.visits[v['visit_id']]['state'],'in_service')

    def test_W20_capacity_cannot_drop_below_confirmed_count(self):
        self.booking('تجريبي ألف',confirm=True);self.booking('تجريبي باء',confirm=True)
        self.rejected(409,lambda:self.cmd('capacity','SESSION_A',{'window_id':'W1_A','capacity':1,'reason':'adjust'},actor=self.owner))
        self.assertEqual(self.m.sessions['SESSION_A']['windows'][0]['capacity'],2)

    def test_W21_failed_reschedule_retains_old_reservation(self):
        a=self.booking('تجريبي ألف',confirm=True)
        self.booking('تجريبي باء',window='W2_A',confirm=True)
        self.booking('تجريبي جيم',window='W2_A',confirm=True)
        before=copy.deepcopy(self.m.bookings[a['booking_id']]);count=len(self.m.events)
        self.rejected(409,lambda:self.cmd('reschedule',a['booking_id'],{'session_id':'SESSION_A','window_id':'W2_A','reason':'requested'}))
        self.assertEqual(self.m.bookings[a['booking_id']],before)
        self.assertEqual(len(self.m.events),count)

    def test_W22_family_phone_does_not_merge_people(self):
        a=self.booking('تجريبي ألف',confirm=True);b=self.booking('تجريبي باء',confirm=True)
        self.assertNotEqual(a['booking_id'],b['booking_id'])
        self.assertNotEqual(a['secret'],b['secret'])
        self.assertEqual(len(self.m.bookings),2)

    def test_W23_arabic_international_phone_and_shape_validation(self):
        self.assertEqual(normalize_phone('٠٠٩٦٧ ٧٠٠ ٠٠٠ ٠٠١'),'+967700000001')
        self.assertEqual(normalize_phone('+967 (700) 000-001'),'+967700000001')
        for invalid in ('123','800000001','7000000011','+966700000001','70000abc1'):
            self.rejected(422,lambda invalid=invalid:normalize_phone(invalid))

    def test_W24_walk_in_without_phone_is_atomic_and_has_a_ticket(self):
        v=self.cmd('walk_in','SESSION_A',{'display_name':'مراجع دون هاتف','contact_phone':None})
        b=self.m.bookings[v['booking_id']]
        self.assertIsNone(b['contact_phone'])
        self.assertEqual((b['state'],v['state']),('confirmed','waiting'))
        self.assertEqual(v['ticket_number'],1)

    def test_W25_walk_in_with_full_window_leaves_no_partial_booking(self):
        self.m.sessions['SESSION_A']['windows'][0]['capacity']=1
        self.arrived()
        before=(len(self.m.bookings),len(self.m.events),len(self.m.outbox))
        self.rejected(409,lambda:self.cmd('walk_in','SESSION_A',{'display_name':'مراجع آخر'}))
        self.assertEqual((len(self.m.bookings),len(self.m.events),len(self.m.outbox)),before)

    def test_W26_early_arrival_waits_for_window_and_late_arrival_is_recorded(self):
        early=self.booking('مراجع مبكر',window='W2_A',confirm=True)
        self.rejected(409,lambda:self.cmd('check_in',early['booking_id']))
        late=self.booking('مراجع متأخر',confirm=True)
        v=self.cmd('check_in',late['booking_id'],now=clock('2026-11-07T14:10:00Z'))
        self.assertEqual(v['state'],'waiting')

    def test_W27_intake_end_blocks_arrivals_but_existing_queue_continues(self):
        _,v=self.arrived();pending=self.booking('متأخر',window='W2_A',confirm=True)
        after=clock('2026-11-07T15:01:00Z')
        self.rejected(409,lambda:self.cmd('check_in',pending['booking_id'],now=after))
        self.cmd('call_next','SESSION_A',actor=self.doc,now=after)
        self.cmd('start',v['visit_id'],actor=self.doc,now=after)
        self.cmd('complete',v['visit_id'],actor=self.doc,now=after+timedelta(minutes=10))

    def test_W28_paused_session_keeps_current_visit_and_blocks_new_call(self):
        _,v=self.arrived();self.cmd('call_next','SESSION_A',actor=self.doc)
        self.cmd('pause','SESSION_A',{'reason':'doctor_delay'},actor=self.owner)
        self.cmd('start',v['visit_id'],actor=self.doc);self.cmd('complete',v['visit_id'],actor=self.doc)
        self.rejected(409,lambda:self.cmd('call_next','SESSION_A',actor=self.doc))

    def test_W29_close_requires_explicit_resolution_and_is_final(self):
        b,v=self.arrived()
        self.rejected(409,lambda:self.cmd('close','SESSION_A',{'reason':'day_finished'},actor=self.owner))
        self.cmd('leave',v['visit_id'],{'reason':'left_clinic'})
        self.cmd('close','SESSION_A',{'reason':'day_finished'},actor=self.owner)
        self.assertEqual(self.m.bookings[b['booking_id']]['state'],'confirmed')
        self.rejected(409,lambda:self.cmd('request','SESSION_A',{'window_id':'W1_A','display_name':'تجريبي','contact_phone':'700000001'},actor=self.public))

    def test_W30_ahead_count_excludes_current_service_and_others_identity(self):
        _,a=self.arrived('تجريبي ألف');b,_=self.arrived('تجريبي باء')
        self.cmd('call_next','SESSION_A',actor=self.doc);self.cmd('start',a['visit_id'],actor=self.doc)
        dto=self.m.ticket(b['secret'],now=self.now)
        self.assertEqual(dto['waiting_ahead'],0)
        self.assertEqual(dto['doctor_state'],'in_service')
        expected=json.loads((ROOT/'contracts/p00_v1.json').read_text())['private_ticket_fields']
        self.assertEqual(set(dto),set(expected))
        self.assertNotIn('تجريبي ألف',json.dumps(dto,ensure_ascii=False))

    def test_W31_ticket_number_cannot_substitute_for_secret_and_secret_expires(self):
        b,v=self.arrived()
        self.rejected(404,lambda:self.m.ticket(str(v['ticket_number']),now=self.now))
        self.rejected(404,lambda:self.m.ticket(b['secret'],now=clock('2026-11-09T15:00:00Z')))
        self.assertTrue(self.m.ticket(b['secret'],now=self.now))

    def test_W32_priority_requires_doctor_and_preserves_ticket(self):
        _,a=self.arrived('تجريبي ألف');_,b=self.arrived('تجريبي باء')
        self.rejected(403,lambda:self.cmd('priority',b['visit_id'],{'reason':'clinical_priority'}))
        self.cmd('priority',b['visit_id'],{'reason':'clinical_priority'},actor=self.doc)
        self.assertEqual(self.m.ready('SESSION_A')[0]['id'],b['visit_id'])
        self.assertEqual(self.m.visits[b['visit_id']]['ticket_number'],b['ticket_number'])
        self.assertEqual(self.m.events[-1]['reason'],'clinical_priority')

    def test_W33_failed_command_emits_neither_event_nor_outbox_entry(self):
        _,v=self.arrived()
        before=(len(self.m.events),len(self.m.outbox))
        self.rejected(409,lambda:self.cmd('complete',v['visit_id'],actor=self.doc))
        self.assertEqual((len(self.m.events),len(self.m.outbox)),before)

    def test_W34_replayed_command_rechecks_current_permission(self):
        b=self.booking()
        expected=self.m.bookings[b['booking_id']]['version']
        self.cmd('confirm',b['booking_id'],key='permission-retry',expected=expected)
        self.m.actors['RECEPTION_A']['role']='doctor'
        self.rejected(403,lambda:self.cmd('confirm',b['booking_id'],key='permission-retry',expected=expected))

    def test_W35_session_extension_cannot_cross_local_day_or_add_capacity(self):
        before=copy.deepcopy(self.m.sessions['SESSION_A']['windows'])
        self.rejected(422,lambda:self.cmd('extend','SESSION_A',{'ends_at':'2026-11-07T21:01:00Z','reason':'delay'},actor=self.owner))
        self.cmd('extend','SESSION_A',{'ends_at':'2026-11-07T16:00:00Z','reason':'delay'},actor=self.owner)
        self.assertEqual(self.m.sessions['SESSION_A']['windows'],before)

    def test_W36_new_call_from_overlapping_overrun_cannot_double_reserve_doctor(self):
        _,v=self.arrived();self.cmd('call_next','SESSION_A',actor=self.doc);self.cmd('start',v['visit_id'],actor=self.doc)
        later=copy.deepcopy(self.m.sessions['SESSION_A']);later.update(id='LATER_A',starts_at='2026-11-07T15:00:00Z',ends_at='2026-11-07T17:00:00Z')
        later['windows']=[{'id':'LATE_W','starts_at':'2026-11-07T15:00:00Z','ends_at':'2026-11-07T17:00:00Z','capacity':1}]
        self.m.sessions[later['id']]=later
        self.cmd('walk_in',later['id'],{'display_name':'مراجع لاحق'},now=clock('2026-11-07T15:10:00Z'))
        self.rejected(409,lambda:self.cmd('call_next',later['id'],actor=self.doc,now=clock('2026-11-07T15:10:00Z')))

    def test_W37_anonymous_retry_keys_are_isolated_between_browsers(self):
        body={'window_id':'W1_A','display_name':'تجريبي ألف','contact_phone':'700000001'}
        first=self.cmd('request','SESSION_A',body,actor=self.public,key='same-client-key')
        other=Context('PUBLIC','CLINIC_A','REFERENCE_ONLY_ANON_B')
        second=self.cmd('request','SESSION_A',body,actor=other,key='same-client-key')
        self.assertNotEqual(first['booking_id'],second['booking_id'])
        self.assertNotEqual(first['secret'],second['secret'])

    def test_W38_public_context_without_anonymous_scope_is_rejected(self):
        self.rejected(401,lambda:self.cmd('request','SESSION_A',{'window_id':'W1_A','display_name':'تجريبي','contact_phone':'700000001'},actor=Context('PUBLIC','CLINIC_A')))

