from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[1]
checks=[]
def check(name,value,detail=None):
    row={'id':name,'status':'passed' if value else 'failed'}
    if detail is not None: row['detail']=detail
    checks.append(row)

source=(ROOT/'prototype/index.html').read_text()
standalone=(ROOT/'prototype/Nobteek_P02_Prototype_AR.html').read_text()
js=(ROOT/'prototype/app.js').read_text()+(ROOT/'prototype/domain.js').read_text()
class ResourceParser(HTMLParser):
    def __init__(self): super().__init__();self.external=[]
    def handle_starttag(self,tag,attrs):
        data=dict(attrs)
        for attr in ['src','href']:
            value=data.get(attr,'')
            if value and (attr=='src' or tag=='link') and not value.startswith(('data:','#')):self.external.append(value)
parser=ResourceParser();parser.feed(standalone)
check('A01_standalone_has_no_external_resource_links',not parser.external,parser.external)
check('A02_standalone_has_no_remote_css_urls',not re.search(r'url\([\s\"\']*https?://',standalone))
check('A03_arabic_rtl_document','lang="ar-YE"' in source and 'dir="rtl"' in source)
check('A04_no_network_client',not re.search(r'\bfetch\s*\(|XMLHttpRequest|sendBeacon\s*\(|WebSocket\s*\(',js))
check('A05_no_persistent_patient_storage',not re.search(r'localStorage\.|sessionStorage\.|indexedDB\.',js))
check('A06_reuses_frozen_design_styles','design/styles/brand.generated.css' in source and 'design/styles/components.css' in source)
check('A07_no_payment_screen_route',not re.search(r"\b(?:billing|payment|subscription)\s*:", (ROOT/'prototype/app.js').read_text()))
check('A08_skip_link_and_landmark','class="skip-link"' in source and 'id="main-content"' in js)
check('A09_dialog_semantics','<dialog' in source and 'aria-labelledby="dialog-title"' in source)
contract=json.loads((ROOT/'prototype/P02_CONTRACTS.json').read_text())
check('A10_scope_explicit',not contract['productionHttp'] and not contract['productionAuth'] and not contract['productionDatabase'] and contract['excludedScreen']=={'S11':'P13'})
frozen=json.loads((ROOT/'contracts/frozen_p01_sha256.json').read_text())['files']
changed=[name for name,digest in frozen.items() if not (ROOT/name).is_file() or hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest]
check('A11_prior_contracts_fixtures_model_design_unchanged',not changed,changed)
check('A12_standalone_matches_deliverable',(ROOT.parent/'outputs/nobteek-p02-20261106/Nobteek_P02_Prototype_AR.html').read_bytes()==(ROOT/'prototype/Nobteek_P02_Prototype_AR.html').read_bytes())
result={'baselineId':'NOBTEEK-P02-1.0','scope':'static_prototype_assets','checksRun':len(checks),'passed':all(x['status']=='passed' for x in checks),'failures':sum(x['status']!='passed' for x in checks),'standalone_sha256':hashlib.sha256(standalone.encode()).hexdigest(),'checks':checks}
(ROOT/'results/p02_assets_validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False));raise SystemExit(0 if result['passed'] else 1)
