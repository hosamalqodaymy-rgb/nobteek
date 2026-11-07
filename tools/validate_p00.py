"""Run the P00 contract and reference-model checks with an explicit evidence scope."""
import json
import platform
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


class RecordedResult(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.rows=[]

    def addSuccess(self,test):
        super().addSuccess(test)
        self.rows.append({'id':test.id(),'status':'passed','acceptance':'T00A' if '.test_contract.' in '.'+test.id() else 'T00B'})

    def addFailure(self,test,err):
        super().addFailure(test,err)
        self.rows.append({'id':test.id(),'status':'failed','detail':self._exc_info_to_string(err,test)})

    def addError(self,test,err):
        super().addError(test,err)
        self.rows.append({'id':test.id(),'status':'error','detail':self._exc_info_to_string(err,test)})


if __name__=='__main__':
    suite=unittest.defaultTestLoader.discover(str(ROOT/'tests'),pattern='test_*.py')
    started=time.perf_counter()
    result=unittest.TextTestRunner(verbosity=1,resultclass=RecordedResult).run(suite)
    groups={g:[r for r in result.rows if r.get('acceptance')==g] for g in ('T00A','T00B')}
    report={
        'baseline_id':'NOBTEEK-P00-1.0',
        'generated_at':datetime.now(timezone.utc).isoformat(),
        'python_version':platform.python_version(),
        'validation_type':'specification_and_in_memory_reference_model',
        'production_application_tests_run':False,
        'database_concurrency_tested':False,
        'ui_or_network_or_security_integration_tested':False,
        'real_patient_data_used':False,
        'real_payments_or_messages_sent':False,
        'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
        'elapsed_seconds':round(time.perf_counter()-started,4),
        'passed':result.wasSuccessful(),
        'acceptance':{g:{'status':'passed' if rows and all(r['status']=='passed' for r in rows) else 'failed','checks':len(rows)} for g,rows in groups.items()},
        'checks':result.rows,
        'remaining_required_in_production':['PostgreSQL tenant constraints and concurrent transactions','HTTP authentication and role enforcement','UI and mobile flows','network failure and retry integration','private cache and secret redaction','backup restore','payment and paid provider integration in P13','market use and renewal'],
    }
    (ROOT/'results').mkdir(exist_ok=True)
    (ROOT/'results/p00_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('tests_run','failures','errors','passed','acceptance')},ensure_ascii=False))
    sys.exit(0 if result.wasSuccessful() else 1)
