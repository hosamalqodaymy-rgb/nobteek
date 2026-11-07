"""Validate the versioned source boundary and retained baselines before packaging."""
from pathlib import Path
import argparse,hashlib,json,re,subprocess
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--php',default='php');args=parser.parse_args()
files=[Path(x) for x in subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0') if x]
checks=[]
def record(name,ok,detail=None):
 item={'id':name,'status':'passed' if ok else 'failed'}
 if detail:item['detail']=detail
 checks.append(item)
bad=[str(f) for f in files if any(x in {'node_modules','vendor','.git','inertia-devtools'} for x in f.parts) or (f.name.startswith('.env') and f.name not in {'.env.example','.env.testing.example'}) or f.name=='auth.json' or (str(f).startswith('application/storage/') and f.name!='.gitignore')]
record('S01_source_excludes_environments_secrets_sessions_logs_and_dependencies',not bad,bad or None)
patterns=[rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',rb'(?m)^APP_KEY=base64:[A-Za-z0-9+/=]{30,}',rb'gh[pousr]_[A-Za-z0-9]{30,}',rb'sk-[A-Za-z0-9]{32,}']
texts={'.php','.json','.ts','.tsx','.js','.mjs','.cjs','.txt','.md','.py','.html','.css','.yml','.yaml','.csv','.sh','.svg'}
hits=[str(f) for f in files if f.suffix in texts and any(re.search(pattern,(ROOT/f).read_bytes()) for pattern in patterns)]
record('S02_no_known_private_key_or_provider_token_patterns',not hits,hits or None)
frozen=json.loads((ROOT/'contracts/frozen_p01_sha256.json').read_text())['files'];mismatch=[f for f,h in frozen.items() if hashlib.sha256((ROOT/f).read_bytes()).hexdigest()!=h]
prototype=hashlib.sha256((ROOT/'prototype/Nobteek_P02_Prototype_AR.html').read_bytes()).hexdigest()
record('S03_frozen_business_design_and_prototype_retained',not mismatch and prototype=='27f21fe86ab0a287b4989dad240f0a93dec45f673d01e58f724a266d1018fe8b')
manifest=json.loads((ROOT/'application/package.json').read_text());lock=json.loads((ROOT/'application/package-lock.json').read_text());record('S04_javascript_lock_matches_manifest',all(manifest.get(k,{})==lock['packages'][''].get(k,{}) for k in ['version','dependencies','devDependencies']))
phpfiles=[f for f in files if f.suffix=='.php' and str(f).startswith('application/')]
def lint(f):
 r=subprocess.run([args.php,'-l',str(ROOT/f)],capture_output=True,text=True)
 return str(f) if r.returncode else None
with ThreadPoolExecutor(max_workers=6) as pool:errors=[x for x in pool.map(lint,phpfiles) if x]
record('S05_php_source_parses',not errors,errors or None)
a=json.loads((ROOT/'results/p05_application_validation.json').read_text());c=json.loads((ROOT/'results/p05_clean_build_validation.json').read_text());h=json.loads((ROOT/'results/p05_http_validation.json').read_text());b=json.loads((ROOT/'contracts/build_backlog_current.json').read_text())
record('S06_evidence_counts_and_next_phase_agree',a['passed'] and c['passed'] and h['passed'] and a['tests']==int(c['phpunit']['tests'])==80 and a['assertions']==int(c['phpunit']['assertions'])==563 and len(h['checks'])==23 and b['next_stage']=='P06')
r=subprocess.run(['git','diff','--cached','--check'],cwd=ROOT,capture_output=True,text=True);record('S07_diff_has_no_whitespace_errors',r.returncode==0)
report={'baselineId':'NOBTEEK-P05-1.0','scope':'versioned_source_boundary_static_secret_patterns_syntax_baseline_and_evidence','passed':all(x['status']=='passed' for x in checks),'checksRun':len(checks),'checks':checks,'phpFilesLinted':len(phpfiles),'frozenFilesVerified':len(frozen),'independentSecurityAuditCompleted':False}
(ROOT/'results/p05_source_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report))
raise SystemExit(0 if report['passed'] else 1)
