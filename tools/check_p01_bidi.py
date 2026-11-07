from pathlib import Path
import json
from design_svg import Outliner

root=Path(__file__).resolve().parents[1]
outliner=Outliner(root/'design/fonts/Tajawal-Regular.ttf')
cmap=outliner.tt.getBestCmap()
def includes(sequence,items):return any(items[i:i+len(sequence)]==sequence for i in range(len(items)-len(sequence)+1))
checks=[]
for name,text,tokens in [('mixed_numbers','يستخدم الرمز في 24 و48 بكسل',['24','48']),('mixed_latin','نوبتيك P01 الإصدار 1.0',['P01','1.0'])]:
    glyphs=[g[0] for g in outliner.layout(text)[0]]
    passed=all(includes([cmap[ord(ch)] for ch in token],glyphs) for token in tokens)
    checks.append({'id':'bidi_'+name,'passed':passed,'detail':{'text':text,'ordered_tokens':tokens}})
print(json.dumps(checks,ensure_ascii=False))
if not all(x['passed'] for x in checks):raise SystemExit(1)
