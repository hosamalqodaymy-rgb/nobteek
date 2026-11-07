"""Prepare a local-only browser QA surface through the supported preview daemon."""
from pathlib import Path
import json
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT.parent/'nobteek-p01-preview'
DIST=DEST/'dist'
shutil.copytree(ROOT/'design',DIST,dirs_exist_ok=True)
index=(ROOT/'design/preview/index.html').read_text().replace('href="../','href="./').replace('src="../','src="./')
(DIST/'index.html').write_text(index)
(DIST/'text-200.html').write_text(index.replace('</head>','<style>html{font-size:200%}</style></head>'))
alternate=json.loads((ROOT/'design/brand.config.json').read_text())
alternate['nameAr']='ترتيب';alternate['nameEn']='QueueDemo';alternate['colors']['primary']='#1D4ED8'
alternate_path=DEST/'alternate.config.json';alternate_path.write_text(json.dumps(alternate,ensure_ascii=False))
subprocess.run([sys.executable,str(ROOT/'tools/build_p01.py'),'--config',str(alternate_path),'--out',str(DIST/'alternate')],check=True,capture_output=True)
shutil.copyfile(ROOT/'design/components.js',DIST/'alternate/components.js')
shutil.copyfile(ROOT/'design/styles/components.css',DIST/'alternate/styles/components.css')
(DIST/'alternate/index.html').write_text(index)
expected=json.loads((ROOT/'contracts/p00_v1.json').read_text())['state_enums']
qa='''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>فحص P01</title>
<style>body{font:16px Tahoma;margin:24px;color:#172B3A}pre{direction:ltr;text-align:left;white-space:pre-wrap;font:13px monospace}.sample{overflow:auto;max-width:100%;border:1px solid #6B7D89;margin-block:20px}iframe{border:0;display:block;height:840px}h2{font-size:18px}</style>
<h1>فحص مكونات P01</h1><p>فحص معاينة التصميم فقط ببيانات وهمية</p><pre id="qa-result">جاري الفحص</pre><div id="frames"></div>
<script>
const EXPECTED=__EXPECTED__;
const rows=[];const frames=[{id:'360',width:360,src:'index.html'},{id:'768',width:768,src:'index.html'},{id:'1440',width:1440,src:'index.html'},{id:'360_text_200',width:360,src:'text-200.html'},{id:'alternate',width:1024,src:'alternate/index.html'}];
function check(id,passed,detail,acceptance='T01A'){rows.push({id,passed,detail,acceptance})}
async function inspect(spec,frame){
 const w=frame.contentWindow,d=frame.contentDocument;await d.fonts.ready;
 check('reflow_'+spec.id,d.documentElement.scrollWidth<=w.innerWidth,{width:w.innerWidth,scrollWidth:d.documentElement.scrollWidth});
 check('font_'+spec.id,d.fonts.check('400 16px Tajawal')&&d.fonts.check('500 16px Tajawal')&&d.fonts.check('700 16px Tajawal'),d.fonts.status);
 check('control_height_'+spec.id,[...d.querySelectorAll('button,.btn,input:not([type=checkbox]),select,.check-label')].every(e=>e.getBoundingClientRect().height>=48),'48px minimum');
 check('labels_'+spec.id,[...d.querySelectorAll('input,select')].every(e=>e.labels.length>0),'Every input and select has a label');
 if(spec.id==='360_text_200')check('actual_200_text',parseFloat(w.getComputedStyle(d.body).fontSize)>=32,w.getComputedStyle(d.body).fontSize);
 if(spec.id==='alternate'){
  const names=[...d.querySelectorAll('[data-brand-name-ar]')].map(e=>e.textContent),en=[...d.querySelectorAll('[data-brand-name-en]')].map(e=>e.textContent);
  check('rebrand_names',names.every(x=>x==='ترتيب')&&en.every(x=>x==='QueueDemo')&&d.title.includes('QueueDemo'),{names,en,title:d.title},'T01B');
  check('rebrand_primary',w.getComputedStyle(d.querySelector('.btn')).backgroundColor==='rgb(29, 78, 216)',w.getComputedStyle(d.querySelector('.btn')).backgroundColor,'T01B');
  check('rebrand_derived',w.getComputedStyle(d.documentElement).getPropertyValue('--color-primary-hover').trim()==='#1842B5',w.getComputedStyle(d.documentElement).getPropertyValue('--color-primary-hover').trim(),'T01B');
 }
 if(spec.id==='1440'){
  for(const entity of ['booking','visit','session']){const keys=[...d.querySelector('[data-state-gallery="'+entity+'"]').querySelectorAll('.badge')].map(e=>e.dataset.state).sort();check('canonical_'+entity,JSON.stringify(keys)===JSON.stringify([...EXPECTED[entity]].sort()),keys)}
  check('state_text_and_icons',[...d.querySelectorAll('.badge')].every(e=>e.textContent.trim()&&e.querySelector('svg')),'Text and icon accompany every color');
  check('seven_screen_states',d.querySelectorAll('[data-preview-state]').length===7,[...d.querySelectorAll('[data-preview-state]')].map(e=>e.dataset.previewState));
  check('body_16px',parseFloat(w.getComputedStyle(d.body).fontSize)>=16,w.getComputedStyle(d.body).fontSize);
  check('phone_ltr',[...d.querySelectorAll('input[type=tel]')].every(e=>w.getComputedStyle(e).direction==='ltr'),'Phone inputs remain LTR');
  check('error_description',!!d.getElementById(d.getElementById('invalid-phone').getAttribute('aria-describedby'))?.textContent.trim(),'Error text is attached to its input');
 }
}
Promise.all(frames.map(spec=>new Promise(resolve=>{const title=document.createElement('h2');title.textContent=spec.id;const host=document.createElement('div');host.className='sample';const frame=document.createElement('iframe');frame.title='معاينة '+spec.id;frame.style.width=spec.width+'px';frame.src=spec.src;frame.onload=()=>inspect(spec,frame).then(resolve).catch(e=>{check('load_'+spec.id,false,e.message);resolve()});host.append(frame);document.getElementById('frames').append(title,host)}))).then(()=>{document.getElementById('qa-result').textContent=JSON.stringify({scope:'P01_component_preview_only',checksRun:rows.length,passed:rows.every(x=>x.passed),failures:rows.filter(x=>!x.passed).length,checks:rows},null,2)});
</script></html>'''.replace('__EXPECTED__',json.dumps(expected,ensure_ascii=False))
(DIST/'qa.html').write_text(qa)
(DEST/'.openai').mkdir(exist_ok=True)
(DEST/'.openai/hosting.json').write_text(json.dumps({'static':{'directory':'dist'}}))
print('Prepared preview, four responsive fixtures and independent alternate brand')
