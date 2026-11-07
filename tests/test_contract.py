import json
import unittest
from pathlib import Path
from model.reference_model import ReferenceClinic, Rejected

ROOT = Path(__file__).resolve().parents[1]


class ContractTests(unittest.TestCase):
    """T00A: specification ownership, consistency and boundaries."""

    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads((ROOT/'contracts/p00_v1.json').read_text())
        cls.source = json.loads((ROOT/'contracts/stage_plan_source.json').read_text())
        cls.fixtures = json.loads((ROOT/'fixtures/clinics_demo.json').read_text())

    def test_C01_dependencies_are_ordered_and_acyclic(self):
        stages = self.contract['stage_plan']
        self.assertEqual([s['id'] for s in stages], [f'P{i:02d}' for i in range(14)])
        prior = set()
        for stage in stages:
            self.assertTrue(set(stage['depends']).issubset(prior))
            self.assertTrue(stage['outputs'] and stage['tests'] and stage['next'])
            prior.add(stage['id'])

    def test_C02_all_twelve_screens_have_owner_and_shared_states(self):
        screens = self.contract['screens']
        self.assertEqual([s['id'] for s in screens], [f'S{i:02d}' for i in range(1,13)])
        for screen in screens:
            self.assertIn(screen['owner_phase'], {s['id'] for s in self.contract['stage_plan']})
            self.assertEqual(set(screen['states']), {'loading','empty','success','error','offline','forbidden','conflict'})

    def test_C03_state_names_preserve_the_authoritative_plan(self):
        self.assertEqual(self.contract['state_enums'], self.source['state_enums'])
        self.assertEqual(set(self.contract['state_owners']), set(self.contract['state_enums']))

    def test_C04_every_transition_uses_declared_states_and_commands(self):
        commands = {c['id'] for c in self.contract['commands']}
        identities=[]
        for edge in self.contract['transitions']:
            states = self.contract['state_enums'][edge['entity']]
            self.assertIn(edge['from'], states)
            self.assertIn(edge['to'], states)
            self.assertIn(edge['command'], commands)
            self.assertTrue(edge['condition_ar'])
            identities.append((edge['entity'],edge['from'],edge['to'],edge['command']))
        self.assertEqual(len(identities), len(set(identities)))

    def test_C05_all_rules_and_exceptions_have_unique_ids_and_owners(self):
        phases={s['id'] for s in self.contract['stage_plan']}
        for group in ('rules','exceptions'):
            rows=self.contract[group]
            self.assertEqual(len(rows),len({r['id'] for r in rows}))
            for row in rows:
                self.assertIn(row['owner_phase'],phases)

    def test_C06_finance_and_paid_services_are_disabled_and_deferred(self):
        for flag in ('external_payments','financial_tables','paid_messaging','paid_infrastructure_purchases','real_patient_data'):
            self.assertIs(self.contract['feature_flags'][flag], False)
        self.assertEqual(next(s for s in self.contract['screens'] if s['id']=='S11')['owner_phase'],'P13')
        for entity in self.contract['reserved_deferred_enums']:
            self.assertEqual(self.contract['state_owners'][entity], 'P13')
            self.assertNotIn(entity, self.contract['data_dictionary'])
        self.assertFalse(any('payment' in c['path'] or 'invoice' in c['path'] for c in self.contract['commands']))

    def test_C07_fixtures_have_two_clinics_three_doctors_and_scoped_relations(self):
        f=self.fixtures
        self.assertEqual(len(f['clinics']),2)
        self.assertEqual(len(f['doctors']),3)
        self.assertEqual(f['classification'],'synthetic_only_no_external_communications')
        doctors={d['id']:d for d in f['doctors']}
        actors={a['id']:a for a in f['actors']}
        for s in f['sessions']:
            self.assertEqual(s['clinic_id'],doctors[s['doctor_id']]['clinic_id'])
            self.assertEqual(s['clinic_id'],actors[doctors[s['doctor_id']]['actor_id']]['clinic_id'])

    def test_C08_critical_command_envelopes_require_retries_and_versions(self):
        commands=self.contract['commands']
        self.assertEqual(len(commands),len({c['id'] for c in commands}))
        for c in commands:
            self.assertEqual(c['idempotency_required'],not c['path'].startswith('GET'))
            self.assertEqual(c['expected_version_required'],c['id'] not in ('request','walk_in','ticket'))

    def test_C09_private_ticket_schema_excludes_identity_and_other_patients(self):
        fields=set(self.contract['private_ticket_fields'])
        self.assertTrue({'ticket_number','waiting_ahead','server_time'}.issubset(fields))
        self.assertTrue(fields.isdisjoint({'display_name','contact_phone','patients','secret','token_digest'}))
        p=self.contract['private_ticket_security']
        self.assertEqual(p['secret_random_bytes'],32)
        self.assertEqual(p['cache_control'],'private, no-store')
        self.assertTrue(p['exclude_from_service_worker_cache'])

    def test_C10_session_windows_cannot_overlap_cross_days_or_escape_bounds(self):
        import copy
        valid=self.fixtures['sessions'][0]
        for mutate in (
            lambda s:s['windows'][1].update(starts_at='2026-11-07T13:30:00Z'),
            lambda s:s.update(ends_at='2026-11-08T15:00:00Z'),
            lambda s:s['windows'][0].update(starts_at='2026-11-07T12:59:00Z'),
            lambda s:s['windows'][0].update(capacity=0),
        ):
            invalid=copy.deepcopy(valid);mutate(invalid)
            with self.assertRaises(Rejected): ReferenceClinic.validate_session(invalid)

    def test_C11_pending_and_terminal_states_have_clear_paths(self):
        edges=self.contract['transitions']
        pending={e['to'] for e in edges if e['entity']=='booking' and e['from']=='pending'}
        self.assertEqual(pending,{'confirmed','rejected','cancelled'})
        for entity,terminal in [('booking',{'rejected','cancelled','fulfilled'}),('visit',{'completed','left'}),('session',{'closed'})]:
            self.assertFalse(any(e['entity']==entity and e['from'] in terminal for e in edges))

    def test_C12_source_plan_tests_are_not_misreported_as_application_passes(self):
        self.assertEqual(sum(len(s['tests']) for s in self.source['stages']),29)
        self.assertTrue(all(t['status']=='not_run' for s in self.source['stages'] for t in s['tests']))
        scope=self.contract['validation_scope']
        self.assertTrue(scope['reference_model'])
        self.assertTrue(all(not scope[k] for k in scope if k!='reference_model'))

    def test_C13_doctor_sessions_cannot_overlap_within_a_clinic(self):
        import copy
        f=copy.deepcopy(self.fixtures)
        duplicate=copy.deepcopy(f['sessions'][0]);duplicate['id']='OVERLAP'
        f['sessions'].append(duplicate)
        with self.assertRaises(Rejected) as result: ReferenceClinic(f)
        self.assertEqual(result.exception.code,'overlapping_doctor_sessions')

