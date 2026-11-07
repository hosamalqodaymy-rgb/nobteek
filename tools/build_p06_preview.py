"""Build isolated visual fixtures from the same components without server access."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[1]
subprocess.run(['npx','vite','build','--config','vite.p06-preview.config.ts'],cwd=root/'application',check=True,capture_output=True,text=True)
html=(root/'preview/p05/index.html').read_text().replace('P05','P06').replace('preview-p05-frame','preview-p06-frame').replace('مراجعة إعداد العيادة والجلسات','مراجعة الحجوزات').replace('واجهة إعداد العيادة','واجهة الحجوزات')
a=html.index('<select id="screen">');b=html.index('</select>',a)
options={'BookingList':'طلب معلق','BookingConfirmed':'حجز مؤكد','BookingArrived':'حجز مع حضور','BookingStarted':'زيارة بدأت','BookingTerminal':'حجز ملغى','BookingEmpty':'قائمة فارغة','PublicBooking':'طلب المراجع','PublicEmpty':'لا نوافذ متاحة'}
html=html[:a]+'<select id="screen">'+''.join(f'<option value="{key}">{label}</option>' for key,label in options.items())+html[b:]
html=html.replace('screen=ClinicSettings','screen=BookingList')
a=html.index('<p>');b=html.index('</p>',a)
html=html[:a]+'<p>مكونات الواجهة نفسها ببيانات عرض ونقل محاكى لا يتصل بالخادم ولا ينشئ حجوزات حقيقية.</p>'+html[b+4:]
(root/'preview/p06/index.html').write_text(html)
print('P06 isolated visual preview built.')
