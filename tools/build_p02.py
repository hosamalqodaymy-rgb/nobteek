from pathlib import Path
import base64
import json
import re
import shutil

ROOT=Path(__file__).resolve().parents[1];P=ROOT/'prototype'
fixtures=json.loads((ROOT/'fixtures/clinics_demo.json').read_text())
(P/'fixture.generated.js').write_text('window.NOBTEEK_DEMO_FIXTURES='+json.dumps(fixtures,ensure_ascii=False)+';\n')
source=(P/'index.html').read_text();css='\n'.join((ROOT/p).read_text() for p in ['design/styles/brand.generated.css','design/styles/components.css','prototype/app.css'])
for font in (ROOT/'design/fonts').glob('*.woff'):
    css=css.replace('../fonts/'+font.name,'data:font/woff;base64,'+base64.b64encode(font.read_bytes()).decode())
source=re.sub(r'<link rel="stylesheet"[^>]*>','',source)
source=re.sub(r'<script defer[^>]*></script>','',source)
source=source.replace('</head>','<style>'+css+'</style></head>')
js='\n'.join((ROOT/p).read_text() for p in ['design/brand.generated.js','design/components.js','prototype/fixture.generated.js','prototype/domain.js','prototype/app.js'])
source=source.replace('</body>','<script>'+js+'</script></body>')
for asset in (ROOT/'design/assets').glob('*.svg'):
    source=source.replace('../design/assets/'+asset.name,'data:image/svg+xml;base64,'+base64.b64encode(asset.read_bytes()).decode())
out=ROOT.parent/'outputs/nobteek-p02-20261106';out.mkdir(parents=True,exist_ok=True)
(out/'Nobteek_P02_Prototype_AR.html').write_text(source)
(P/'Nobteek_P02_Prototype_AR.html').write_text(source)
preview=ROOT.parent/'nobteek-p02-preview';dist=preview/'dist';dist.mkdir(parents=True,exist_ok=True)
shutil.copytree(ROOT/'design',dist/'design',dirs_exist_ok=True)
shutil.copytree(P,dist/'prototype',dirs_exist_ok=True)
index=(P/'index.html').read_text().replace('../design/','design/').replace('href="app.css"','href="prototype/app.css"')
for name in ['fixture.generated.js','domain.js','app.js']:index=index.replace('src="'+name+'"','src="prototype/'+name+'"')
# app.js references /../design from a template, which resolves to /design in the root preview.
(dist/'index.html').write_text(index)
(dist/'text-200.html').write_text(index.replace('</head>','<style>html{font-size:200%}</style></head>'))
shutil.copyfile(ROOT/'tools/p02_browser_qa.html',dist/'qa.html')
(preview/'.openai').mkdir(exist_ok=True);(preview/'.openai/hosting.json').write_text(json.dumps({'static':{'directory':'dist'}}))
contracts={'baselineId':'NOBTEEK-P02-1.0','scope':'interactive_browser_prototype','businessRules':'NOBTEEK-P00-1.0','design':'NOBTEEK-P01-1.0',
           'screens':['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S12'],'excludedScreen':{'S11':'P13'},
           'transport':'prototype/domain.js','productionHttp':False,'productionAuth':False,'productionDatabase':False,'localStorageUsed':False,
           'states':['loading','empty','success','error','offline','forbidden','conflict'],
           'criticalCommands':json.loads((ROOT/'contracts/p00_v1.json').read_text())['commands']}
(P/'P02_CONTRACTS.json').write_text(json.dumps(contracts,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'standalone':str(out/'Nobteek_P02_Prototype_AR.html'),'preview':str(preview),'bytes':len(source.encode())}))
