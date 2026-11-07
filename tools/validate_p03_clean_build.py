"""Reinstall from both locks in a new directory; never copy local credentials."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import re

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--php',default='php')
parser.add_argument('--composer',default='composer')
parser.add_argument('--with-postgres',action='store_true')
parser.add_argument('--baseline', default='NOBTEEK-P03-1.0')
parser.add_argument('--output', default='results/p03_clean_build_validation.json')
args=parser.parse_args()
temp=Path(tempfile.mkdtemp(prefix='nobteek-clean-'))
checkout=temp/'nobteek';checkout.mkdir()
def ignored(directory,names):
    omit={n for n in names if n in {'vendor','node_modules','.git','.env','.env.testing','.phpunit.cache','.phpunit.result.cache','build','hot','inertia-devtools'}}
    if str(directory).endswith(('/bootstrap/cache','/storage/logs','/storage/framework/views','/storage/framework/cache','/storage/framework/sessions')):
        omit.update(n for n in names if n!='.gitignore')
    return omit
shutil.copytree(ROOT/'application',checkout/'application',ignore=ignored)
shutil.copytree(ROOT/'design',checkout/'design')
app=checkout/'application'
checks=[]
env=os.environ.copy();env['PATH']=str(Path(args.php).resolve().parent)+os.pathsep+env['PATH']
commands=[('C01_composer_lock_install',[args.composer,'install','--no-interaction','--prefer-dist','--no-progress']),('C02_composer_manifest_valid',[args.composer,'validate','--strict']),('C03_npm_clean_install',['npm','ci','--no-audit','--no-fund']),('C04_fresh_application_key',[args.php,'artisan','key:generate','--no-interaction']),('C05_typescript_and_production_build',['npm','run','build']),('C06_laravel_http_kernel_tests',[args.php,'artisan','test','--compact','--exclude-group','postgres','--log-junit='+str(temp/'phpunit.xml')])]
if args.with_postgres:
    if env.get('APP_ENV')!='testing' or not re.fullmatch(r'nobteek_test(?:_[a-z0-9_]+)?',env.get('DB_DATABASE','')):
        raise SystemExit('A separately configured nobteek_test database is required.')
    commands=commands[:5]+[
        ('C06_postgres_migrate_and_seed',[args.php,'artisan','migrate:fresh','--seed','--no-interaction']),
        ('C07_full_laravel_database_suite',[args.php,'artisan','test','--compact','--log-junit='+str(temp/'phpunit.xml')])]
for name,command in commands:
    if name=='C04_fresh_application_key':shutil.copyfile(app/'.env.example',app/'.env')
    run=subprocess.run(command,cwd=app,env=env,text=True,capture_output=True)
    checks.append({'id':name,'status':'passed' if run.returncode==0 else 'failed'})
    if run.returncode:
        checks[-1]['detail']=(run.stdout+run.stderr)[-2200:]
        break
passed=all(x['status']=='passed' for x in checks) and len(checks)==len(commands)
report={'baselineId':args.baseline,'scope':'new_directory_clean_locked_install_build_and_full_PostgreSQL_integration' if args.with_postgres else 'new_directory_clean_locked_install_build_and_non_database_http_tests','passed':passed,'checksRun':len(checks),'checks':checks,'phpunit':None,'databaseServerConnectionTested':args.with_postgres and passed,'frameworkMigrationTested':args.with_postgres and passed,'ciWorkflowExecuted':False}
if (temp/'phpunit.xml').exists():
    xml=ET.parse(temp/'phpunit.xml').getroot();suite=next(iter(xml))
    report['phpunit']={k:suite.attrib.get(k) for k in ['tests','assertions','errors','failures','skipped']}
(ROOT/args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
shutil.rmtree(temp)
raise SystemExit(0 if report['passed'] else 1)
