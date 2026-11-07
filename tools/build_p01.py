"""Build P01 assets from one brand configuration. No network or paid services."""
import argparse
import json
import shutil
from pathlib import Path
from design_svg import Outliner, icon, svg

PROJECT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--config',type=Path,default=PROJECT/'design/brand.config.json')
parser.add_argument('--out',type=Path,default=PROJECT/'design')
args=parser.parse_args()
cfg=json.loads(args.config.read_text());out=args.out
for folder in ('assets','styles','preview'): (out/folder).mkdir(parents=True,exist_ok=True)
fonts=PROJECT/'design/fonts'
if fonts.resolve() != (out/'fonts').resolve():shutil.copytree(fonts,out/'fonts',dirs_exist_ok=True)
regular=Outliner(fonts/'Tajawal-Regular.ttf');medium=Outliner(fonts/'Tajawal-Medium.ttf');bold=Outliner(fonts/'Tajawal-Bold.ttf')
col=dict(cfg['colors'])
for name,recipe in cfg.get('derivedColors',{}).items():
    source=col[recipe['from']].lstrip('#');target=recipe['mixWith'].lstrip('#');mix=recipe['amount']
    channels=[int(int(source[i:i+2],16)*(1-mix)+int(target[i:i+2],16)*mix+.5) for i in (0,2,4)]
    col[name]='#'+''.join(f'{channel:02X}' for channel in channels)
cfg['colors']=col


def text(value,x,y,size=24,color=None,weight=400,anchor='right'):
    f=bold if weight==700 else medium if weight==500 else regular
    return f.draw(value,x,y,size,color or col['text'],anchor)


def width(value,size=24,weight=400):
    f=bold if weight==700 else medium if weight==500 else regular
    return f.layout(value)[1]*size/f.upem


def wrapped(value,x,y,max_width,size=24,line=38,color=None,weight=400):
    words=value.split();rows=[];current=''
    for word in words:
        trial=(current+' '+word).strip()
        if current and width(trial,size,weight)>max_width:rows.append(current);current=word
        else:current=trial
    if current:rows.append(current)
    return ''.join(text(row,x,y+i*line,size,color,weight) for i,row in enumerate(rows)),len(rows)


def rect(x,y,w,h,fill,rx=16,stroke=None):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"'+(f' stroke="{stroke}" stroke-width="1.5"' if stroke else '')+'/>'


def line(x1,y1,x2,y2,color):return f'<path d="M{x1} {y1}H{x2}" stroke="{color}" stroke-width="1"/>'


def brand_at(x,y,size=48,inverse=False):
    # Right edge x; label and mark keep a consistent clear space.
    ink=col['surface'] if inverse else col['navy'];mark=ink if inverse else col['primary']
    return icon(mark,x-size,y,size)+text(cfg['nameAr'],x-size-16,y+size*.76,size*.83,ink,700)


def button(label,x,y,w,h=58,primary=True):
    fill=col['primary'] if primary else col['surface'];ink=col['onPrimary'] if primary else col['primary']
    label_size=32 if h>=80 else 22
    return rect(x,y,w,h,fill,10,None if primary else col['primary'])+text(label,x+w/2,y+h/2+label_size*.32,label_size,ink,700,'middle')


def mock_card(x=0,y=0,scale=1):
    shape=rect(0,0,650,440,col['surface'],24,col['border'])
    shape+=text(cfg['cover']['demoClinic'],610,54,26,col['navy'],700)
    shape+=text(cfg['cover']['demoLabel'],610,85,17,col['muted'])
    shape+=line(32,112,618,112,col['border'])
    shape+=rect(344,140,274,208,col['tint'],16)
    shape+=text('المستدعى الآن',590,178,21,col['primary'],500)
    shape+=text('12',481,266,80,col['primary'],700,'middle')
    shape+=text(cfg['stateLabels']['visit']['called']['label'],481,314,22,col['primary'],700,'middle')
    for index,number in enumerate(('13','14','15')):
        rowy=143+index*74
        shape+=rect(32,rowy,286,62,col['background'],10)
        shape+=text(number,66,rowy+43,36,col['navy'],700,'left')
        shape+=text(cfg['stateLabels']['visit']['waiting']['label'],292,rowy+39,20,col['muted'])
    shape+=text('أرقام تجريبية دون أسماء مراجعين',610,395,18,col['muted'])
    return f'<g transform="translate({x} {y}) scale({scale})">{shape}</g>'


assets={}
assets['symbol-primary.svg']=svg(24,24,icon(col['primary']),cfg['nameAr']+' رمز')
assets['symbol-white.svg']=svg(24,24,icon(col['surface']),cfg['nameAr']+' رمز أبيض')
assets['favicon.svg']=assets['symbol-primary.svg']
for suffix,ink,mark in [('ar',col['navy'],col['primary']),('ar-inverse',col['surface'],col['surface']),('mono',col['text'],col['text'])]:
    content=icon(mark,208,8,64)+text(cfg['nameAr'],190,51,48,ink,700)+text(cfg['nameEn'],190,76,17,ink,500)
    assets['logo-'+suffix+'.svg']=svg(284,92,content,cfg['nameAr']+' '+cfg['nameEn'])
assets['logo-en.svg']=svg(320,92,icon(col['primary'],8,10,64)+text(cfg['nameEn'],90,58,44,col['navy'],700,'left'),cfg['nameEn'])
for size in (192,512,1024):
    content=rect(0,0,size,size,col['primary'],0)+icon(col['onPrimary'],size*.19,size*.19,size*.62)
    assets[f'icon-{size}.svg']=svg(size,size,content,cfg['nameAr']+' app icon')

cover=rect(0,0,1600,900,col['background'],0)
cover+=rect(0,0,1600,156,col['surface'],0)
cover+=brand_at(1504,46,58)+text(cfg['nameEn'],96,91,24,col['muted'],500,'left')
cover+=text(cfg['cover']['eyebrow'],1504,260,23,col['primary'],700)
headline,count=wrapped(cfg['cover']['headline'],1504,346,650,64,82,col['navy'],700);cover+=headline
description,_=wrapped(cfg['cover']['description'],1504,346+(count-1)*82+77,640,27,42,col['muted']);cover+=description
cover+=button(cfg['cover']['primaryAction'],1298,599,206,64)
cover+=button(cfg['cover']['secondaryAction'],1070,599,206,64,False)
cover+=mock_card(88,230)
cover+=line(96,776,1504,776,col['border'])
for label,x in [('حجز واضح',1504),('حضور مسجل',1000),('دور متابع',496)]:
    cover+=f'<circle cx="{x-12}" cy="823" r="5" fill="{col["primary"]}"/>'+text(label,x-34,832,24,col['text'],500)
assets['cover-desktop.svg']=svg(1600,900,cover,cfg['nameAr']+' الغلاف العام')

mobile=rect(0,0,720,1320,col['background'],0)+rect(0,0,720,140,col['surface'],0)
mobile+=brand_at(664,43,60)
mobile+=text(cfg['cover']['eyebrow'],664,218,28,col['primary'],700)
head,rows=wrapped(cfg['cover']['headline'],664,304,608,62,80,col['navy'],700);mobile+=head
desc_y=304+(rows-1)*80+68
desc,desc_rows=wrapped(cfg['cover']['description'],664,desc_y,608,32,46,col['muted']);mobile+=desc
btn_y=desc_y+(desc_rows-1)*46+46
mobile+=button(cfg['cover']['primaryAction'],56,btn_y,608,96)
mobile+=button(cfg['cover']['secondaryAction'],56,btn_y+116,608,96,False)
mobile+=mock_card(56,btn_y+260,.935)
assets['cover-mobile.svg']=svg(720,1320,mobile,cfg['nameAr']+' غلاف الهاتف')

board=rect(0,0,1600,1160,col['background'],0)
board+=rect(60,52,1480,220,col['surface'],24)
board+=brand_at(1456,100,96)
board+=text(cfg['tagline'],1320,235,25,col['muted'])
board+=text('NOBTEEK',112,135,31,col['primary'],700,'left')
board+=text('P01 / 1.0',112,180,22,col['muted'],500,'left')
board+=text('الحجوزات والحضور والدور في مكان واحد',1480,343,40,col['navy'],700)
board+=text('هوية واضحة وهادئة للعيادة',1480,389,25,col['muted'])
board+=mock_card(92,437,.92)
board+=text('المكونات الأساسية',1460,472,30,col['navy'],700)
board+=button(cfg['cover']['primaryAction'],1134,510,326,66)
board+=button(cfg['cover']['secondaryAction'],1134,592,326,66,False)
board+=rect(890,702,570,74,col['surface'],10,col['borderControl'])
board+=text('اسم المراجع',1436,746,23,col['muted'])
board+=rect(890,798,176,43,col['successBg'],21)+text('حجز مؤكد',978,827,20,col['success'],700,'middle')
board+=rect(1087,798,176,43,col['warningBg'],21)+text('قيد المراجعة',1175,827,20,col['warning'],700,'middle')
board+=rect(1284,798,176,43,col['neutralBg'],21)+text('منتظر',1372,827,20,col['navy'],700,'middle')
board+=text('ألوان الهوية',1480,930,29,col['navy'],700)
palette=[('primary','الأساسي'),('navy','الكحلي'),('background','الخلفية'),('text','النص'),('muted','المساعد'),('success','النجاح'),('warning','التنبيه'),('danger','الخطأ')]
for i,(key,label) in enumerate(palette):
    x=1340-i*176
    board+=rect(x,964,144,64,col[key],12,col['border'] if key=='background' else None)
    board+=text(label,x+72,1064,20,col['text'],500,'middle')
    board+=text(col[key],x+72,1096,18,col['muted'],400,'middle')
assets['identity-board.svg']=svg(1600,1160,board,cfg['nameAr']+' معاينة الهوية')

proof=rect(0,0,1000,360,col['surface'],0)
proof+=icon(col['primary'],110,95,24)+icon(col['primary'],255,82,48)+icon(col['primary'],445,50,144)
proof+=rect(700,40,220,220,col['navy'],16)+icon(col['surface'],745,85,130)
for label,x in [('24 px',122),('48 px',279),('6x',517),('Inverse',810)]:proof+=text(label,x,306,24,col['muted'],500,'middle')
assets['symbol-small-proof.svg']=svg(1000,360,proof,cfg['nameAr']+' فحص الرمز الصغير')
for name,content in assets.items():(out/'assets'/name).write_text(content)

def kebab(value):
    return ''.join('-'+c.lower() if c.isupper() else c for c in value)

css=['/* Generated from brand.config.json; do not edit by hand. */']
for weight,name in [(400,'Regular'),(500,'Medium'),(700,'Bold')]:
    css.append(f'@font-face{{font-family:Tajawal;src:url("../fonts/Tajawal-{name}.woff") format("woff");font-weight:{weight};font-style:normal;font-display:swap}}')
css.append(':root{')
for key,value in col.items():css.append(f'--color-{kebab(key)}:{value};')
typ=cfg['typography'];lay=cfg['layout']
css.extend([f'--font-family:"{typ["family"]}",{typ["fallback"]};',f'--font-body:{typ["bodyRem"]}rem;',f'--font-small:{typ["smallRem"]}rem;',f'--font-heading:{typ["headingRem"]}rem;',f'--font-hero:{typ["heroRem"]}rem;',f'--line-height:{typ["lineHeight"]};',
            f'--control-min-height:{lay["controlMinHeightRem"]}rem;',f'--control-min-width:{lay["controlMinWidthRem"]}rem;',f'--radius-control:{lay["controlRadiusRem"]}rem;',f'--radius-card:{lay["cardRadiusRem"]}rem;',f'--focus-width:{lay["focusWidthPx"]}px;',f'--focus-offset:{lay["focusOffsetPx"]}px;',f'--max-content:{lay["maxContentPx"]}px;'])
for n in (0,1,2,3,4,5,6,8,10,12,16,20):css.append(f'--space-{n}:{n*lay["spaceUnitRem"]}rem;')
css.append('}')
(out/'styles/brand.generated.css').write_text('\n'.join(css)+'\n')
(out/'brand.generated.js').write_text('// Generated from brand.config.json.\nwindow.NOBTEEK_BRAND='+json.dumps(cfg,ensure_ascii=False)+';\n')
(out/'assets/manifest.json').write_text(json.dumps({'baselineId':cfg['baselineId'],'name':cfg['nameAr'],'short_name':cfg['nameAr'],'lang':cfg['locale'],'dir':'rtl','background_color':col['background'],'theme_color':col['primary'],
    'display':'standalone','icons':[{'src':f'icon-{size}.png','sizes':f'{size}x{size}','type':'image/png','purpose':'any maskable'} for size in (192,512,1024)]},ensure_ascii=False,indent=2)+'\n')
(out/'asset-index.json').write_text(json.dumps({'baselineId':cfg['baselineId'],'nameAr':cfg['nameAr'],'nameEn':cfg['nameEn'],'assets':list(assets),'source':'brand.config.json'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'baseline':cfg['baselineId'],'svg_assets':len(assets),'out':str(out)},ensure_ascii=False))
