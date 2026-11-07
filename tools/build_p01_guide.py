from pathlib import Path
import json
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import landscape,letter
from reportlab.lib.colors import HexColor
from design_svg import Outliner,icon,svg
from svg_to_pdf import draw_svg

ROOT=Path(__file__).resolve().parents[1];DESIGN=ROOT/'design'
OUT=ROOT.parent/'outputs/nobteek-p01-20261106';OUT.mkdir(parents=True,exist_ok=True)
cfg=json.loads((DESIGN/'brand.generated.js').read_text().split('window.NOBTEEK_BRAND=',1)[1].rstrip(';\n'))
validation=json.loads((ROOT/'results/p01_validation.json').read_text());assert validation['passed']
c=cfg['colors'];fonts={w:Outliner(DESIGN/f'fonts/Tajawal-{n}.ttf') for w,n in [(400,'Regular'),(500,'Medium'),(700,'Bold')]}
pages=[]

def t(value,x,y,size=26,color=None,weight=400,anchor='right'):
    return fonts[weight].draw(value,x,y,size,color or c['text'],anchor)
def rect(x,y,w,h,color,rx=12,stroke=None):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{color}"'+(f' stroke="{stroke}" stroke-width="1.5"' if stroke else '')+'/>'
def wrap(value,x,y,width=1408,size=26,line=42,color=None,weight=400):
    f=fonts[weight];rows=[];current=''
    for word in value.split():
        trial=(current+' '+word).strip()
        if current and f.layout(trial)[1]*size/f.upem>width:rows.append(current);current=word
        else:current=trial
    if current:rows.append(current)
    return ''.join(t(row,x,y+i*line,size,color,weight) for i,row in enumerate(rows)),len(rows)
def block(value,x,y,width=1408,size=26,line=42,color=None,weight=400):return wrap(value,x,y,width,size,line,color,weight)[0]
def embed(name,x,y,scale=1):
    source=(DESIGN/'assets'/name).read_text();body=source[source.index('</title>')+8:source.rfind('</svg>')]
    return f'<g transform="translate({x} {y}) scale({scale})">{body}</g>'
def base(title,number):
    return rect(0,0,1600,1160,c['surface'],0)+t(title,1504,112,48,c['navy'],700)+t(cfg['nameAr']+'  P01  1.0',96,109,23,c['muted'],500,'left')+t(str(number),800,1123,22,c['muted'],400,'middle')
def finish(content,title):pages.append(svg(1600,1160,content,title))

board=(DESIGN/'assets/identity-board.svg').read_text();pages.append(board)

p=base('الشعار واستخدامه',2)
p+=rect(96,177,660,260,c['background'],20)+embed('logo-ar.svg',164,224,1.82)
p+=rect(816,177,688,260,c['navy'],20)+embed('logo-ar-inverse.svg',904,224,1.82)
p+=t('النسخة الأساسية',714,476,26,c['navy'],700)+t('النسخة البيضاء',1466,476,26,c['navy'],700)
p+=rect(96,520,660,210,c['background'],20)+embed('logo-en.svg',178,565,1.4)
p+=rect(816,520,688,210,c['background'],20)+embed('logo-mono.svg',922,562,1.45)
p+=t('الكتابة اللاتينية',714,772,25,c['navy'],700)+t('نسخة بلون واحد',1466,772,25,c['navy'],700)
p+=embed('symbol-small-proof.svg',96,823,.7)
p+=block('مساحة أمان حول الشعار تعادل ربع ارتفاع الرمز على الأقل. يستخدم الرمز وحده في 24 و48 بكسل. تحفظ النسب، ويستخدم الأبيض فوق الكحلي أو لون داكن واضح.',1504,865,520,25,39,c['muted'])
finish(p,cfg['nameAr']+' الشعار')

p=base('الألوان والخط ووضوح القراءة',3)
palette=[('primary','الأساسي'),('navy','الكحلي'),('background','الخلفية'),('text','النص'),('muted','المساعد'),('success','النجاح'),('warning','التنبيه'),('danger','الخطأ')]
for i,(key,label) in enumerate(palette):
    x=1340-i*176;p+=rect(x,174,144,80,c[key],12,c['border'] if key=='background' else None)+t(label,x+72,294,23,c['text'],500,'middle')+t(c[key],x+72,330,21,c['muted'],400,'middle')
p+=t('Tajawal',1496,416,42,c['navy'],700)+t('خط عربي محلي بأوزان 400 و500 و700',1496,460,27,c['muted'])
p+=t('نص واضح في كل شاشة',1496,525,44,c['text'],700)+t('النص الأساسي 16 بكسل والشروحات 14 على الأقل وأزرار الهاتف 48 بكسل',1496,577,27,c['muted'])
ratios=json.loads((ROOT/'results/p01_assets_validation.json').read_text())['contrast']
labels={'primary':'أبيض على الأساسي','hover':'أبيض على التحويم','active':'أبيض على الضغط','main_text':'نص على الخلفية','muted_text':'نص مساعد على أبيض','success':'نص النجاح','warning':'نص التنبيه','error':'نص الخطأ','primary_soft':'أساسي على خلفية فاتحة','navy_inverse':'أبيض على الكحلي','control_boundary':'حدود الحقول','focus_ring':'مؤشر التركيز'}
for i,r in enumerate(ratios):
    col=i//6;row=i%6;x=824 if col==0 else 96;y=632+row*48
    p+=rect(x,y,680,42,c['background'],6)+t(labels[r['id']],x+654,y+29,24,c['text'],500)+t(f"{r['ratio']:.2f}:1",x+24,y+29,24,c['primary'],700,'left')
p+=block('الأزواج النصية المفحوصة تجاوزت 4.5 إلى 1. حد الحقول 6B7D89 واضح فوق الأبيض، بينما D7E2E8 للفواصل الزخرفية. هذه فحوص محددة وليست شهادة امتثال كاملة.',1504,984,1408,25,39,c['muted'])
finish(p,cfg['nameAr']+' الألوان والخط')

p=base('الأزرار والحقول وحالات البيانات',4)
def btn(label,x,y,w,fill,ink,stroke=None):return rect(x,y,w,74,fill,10,stroke)+t(label,x+w/2,y+47,27,ink,700,'middle')
p+=btn('تأكيد الحجز',1194,190,310,c['primary'],c['onPrimary'])+btn('تعديل الحجز',844,190,310,c['surface'],c['primary'],c['primary'])
p+=btn('إلغاء الحجز',494,190,310,c['danger'],c['onPrimary'])+btn('غير متاح الآن',96,190,358,c['disabledBg'],c['muted'])
p+=t('مؤشر التركيز بلوحة المفاتيح',1504,343,28,c['navy'],700)
p+=rect(838,378,672,104,'none',14,c['focus'])+rect(846,386,656,88,c['surface'],10,c['borderControl'])+t('اسم المراجع',1474,443,28,c['muted'])
p+=t('خطأ مرتبط بالحقل',744,343,28,c['navy'],700)+rect(96,386,648,88,c['surface'],10,c['danger'])+t('123',122,444,30,c['text'],400,'left')
p+=t('اكتب تسعة أرقام محلية تبدأ بسبعة',744,524,25,c['danger'])
p+=t('حالات الحجز والزيارة والجلسة',1504,620,29,c['navy'],700)
states=[('booking','pending'),('booking','confirmed'),('visit','waiting'),('visit','called'),('visit','in_service'),('visit','away')]
tone={'warning':('warningBg','warning'),'success':('successBg','success'),'neutral':('neutralBg','navy'),'primary':('tint','primary'),'navy':('navy','surface')}
for i,(entity,key) in enumerate(states):
    spec=cfg['stateLabels'][entity][key];bg,fg=tone[spec['tone']];x=1268-(i%3)*484;y=665+(i//3)*86
    p+=rect(x-212,y,448,60,c[bg],30)+t(spec['label'],x+12,y+40,25,c[fg],700,'middle')
p+=rect(96,894,1408,126,c['warningBg'],14)+t('الاتصال متوقف',1468,941,29,c['warning'],700)+t('الحالة المعروضة قديمة ولا يظهر تأكيد للحفظ قبل التحقق من الخادم',1468,989,26,c['warning'])
p+=t('كل حالة لها نص ورمز، وتبقى قيم الحالات مطابقة لمواصفات P00',1504,1071,26,c['muted'])
finish(p,cfg['nameAr']+' المكونات')

p=base('الغلاف للحاسوب والهاتف',5)
p+=embed('cover-desktop.svg',72,210,.64)+embed('cover-mobile.svg',1150,174,.47)
p+=t('غلاف الحاسوب',1096,174,28,c['navy'],700)+t('غلاف الهاتف',1488,151,28,c['navy'],700)
p+=block('الغلاف يقدم الحجز والحضور والدور، مع دخول العيادة ومتابعة الحجز. تستخدم بيانات العرض أرقاما تجريبية دون أسماء مراجعين أو وعود بوقت كشف دقيق.',1096,871,1014,27,43,c['muted'])
p+=block('في P02 توظف هذه الهوية في رحلات الاستقبال والطبيب والمراجع والمالك، مع حالات التحميل والخطأ والانقطاع والتعارض. يظل الربط التشغيلي والتحصيل في مرحلتيهما.',1096,1006,1014,26,41,c['muted'])
finish(p,cfg['nameAr']+' الغلاف')

p=base('نتائج الفحص والتسليم إلى P02',6)
p+=t(str(validation['checksRun'])+' فحصا ناجحا للهوية والمكونات',1504,214,38,c['primary'],700)
asset_checks=json.loads((ROOT/'results/p01_assets_validation.json').read_text())['checksRun']
for label,value,y in [('فحوص الأصول والألوان',str(asset_checks),290),('فحوص المتصفح والأحجام وتغيير الهوية','32',354),('تفاعلات فعلية للأزرار والحقول والتركيز','5',418)]:
    p+=rect(96,y-40,1408,56,c['background'],8)+t(label,1466,y,28,c['text'],500)+t(value,132,y,29,c['primary'],700,'left')
p+=block('شملت المعاينة عروض 360 و768 و1440 بكسل وتكبير النص إلى 200 بالمئة، ونجح تغيير الاسم واللون من إعداد واحد. روجعت الأيقونة في 24 و48 والنسخة البيضاء، وفحصت أحجام أيقونات 192 و512 و1024 ومنطقة أمانها.',1504,518,1408,27,43,c['muted'])
p+=t('ملفات التنفيذ',1504,654,31,c['navy'],700)
for value,y in [('design/brand.config.json',710),('design/styles/components.css',754),('design/Nobteek_P01_Preview.html',798),('results/p01_validation.json',842)]:p+=t(value,144, y,26,c['muted'],500,'left')
p+=block('P01 مغلقة على مستوى الهوية والمكونات. P02 لم تبدأ، والتطبيق التشغيلي وقاعدة البيانات والتحصيل لم تختبر ضمن هذه المرحلة. الاسم اسم عمل حتى استكمال التحقق التجاري قبل النشر العام.',1504,710,800,25,40,c['muted'])
p+=t('المراجع',1504,929,29,c['navy'],700)
p+=t('W3C WCAG 2.2 Contrast Minimum and Non Text Contrast',96,973,22,c['muted'],400,'left')
p+=t('W3C WCAG 2.2 Focus Visible',96,1013,22,c['muted'],400,'left')
p+=t('Google Fonts Tajawal SIL Open Font License 1.1',96,1053,22,c['muted'],400,'left')
finish(p,cfg['nameAr']+' النتائج والتسليم')

guide_dir=DESIGN/'guide';guide_dir.mkdir(exist_ok=True)
for i,source in enumerate(pages,1):(guide_dir/f'page-{i}.svg').write_text(source)
pdf=OUT/'Nobteek_P01_Brand_Guide_AR.pdf';width,height=landscape(letter)
doc=canvas.Canvas(str(pdf),pagesize=(width,height),pageCompression=1)
doc.setTitle('دليل هوية '+cfg['nameAr']+' ومكونات الواجهة P01');doc.setAuthor(cfg['nameEn'])
for i,source in enumerate(pages,1):
    draw_svg(doc,source,0,0,width,height)
    if i==6:
        for y,url in [(973,'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'),(1013,'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html'),(1053,'https://github.com/google/fonts/blob/main/ofl/tajawal/OFL.txt')]:
            scale=width/1600;offset=(height-1160*scale)/2
            doc.linkURL(url,(96*scale,offset+(1160-y-5)*scale,1000*scale,offset+(1160-y+24)*scale),relative=0,thickness=0)
    doc.showPage()
doc.save()
print(json.dumps({'pdf':str(pdf),'pages':len(pages),'vector_paths':True}))
