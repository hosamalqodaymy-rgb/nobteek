"""Install and open the actual APK on an Android emulator; no real-device claim."""
from pathlib import Path
import json,re,subprocess,sys,time,xml.etree.ElementTree as ET

root=Path(__file__).resolve().parents[1]
out=root/'dist-phone'
def adb(*args):
    return subprocess.check_output(['adb',*args],text=True,timeout=60)
def tree():
    try:
        adb('shell','uiautomator','dump','/sdcard/nobteek-ui.xml')
        data=adb('exec-out','cat','/sdcard/nobteek-ui.xml')
    except (subprocess.CalledProcessError,subprocess.TimeoutExpired):return None
    start=data.find('<?xml')
    if start<0:return None
    try:return ET.fromstring(data[start:])
    except ET.ParseError:return None
def wait_text(text):
    for _ in range(20):
        t=tree()
        if t is not None and any(text in n.get('text','') for n in t.iter('node')):return t
        time.sleep(1)
    raise AssertionError('Missing Android screen text: '+text)
def tap(node):
    x1,y1,x2,y2=map(int,re.findall(r'\d+',node.attrib['bounds']))
    adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
report={'installed':False,'publicScreen':False,'staffScreen':False,'text200':False,'physicalPhoneTested':False,'scope':'Android emulator startup and local WebView rendering'}
try:
    adb('install','-r',str(out/'Nobteek_P06_Interface_Test.apk'));report['installed']=True
    adb('shell','input','keyevent','KEYCODE_WAKEUP')
    adb('shell','am','force-stop','com.google.android.apps.nexuslauncher')
    adb('shell','wm','dismiss-keyguard')
    adb('shell','am','start','-W','-n','com.nobteek.preview/.MainActivity')
    adb('shell','am','force-stop','com.google.android.apps.nexuslauncher')
    t=wait_text('عيادة العرض التجريبية');report['publicScreen']=True
    (out/'android-public.png').write_bytes(subprocess.check_output(['adb','exec-out','screencap','-p']))
    tap(next(n for n in t.iter('node') if n.get('class')=='android.widget.Spinner'))
    t=wait_text('الاستقبال — طلب معلق')
    tap(next(n for n in t.iter('node') if n.get('text')=='الاستقبال — طلب معلق'))
    t=wait_text('الحجوزات ومراجعة الطلبات');report['staffScreen']=True
    tap(next(n for n in t.iter('node') if n.get('text')=='النص 100%'))
    wait_text('النص 200%');report['text200']=True
    (out/'android-staff-text200.png').write_bytes(subprocess.check_output(['adb','exec-out','screencap','-p']))
    report['sdk']=adb('shell','getprop','ro.build.version.sdk').strip()
    report['passed']=True
finally:
    try:
        (out/'android-last-screen.png').write_bytes(subprocess.check_output(['adb','exec-out','screencap','-p']))
        (out/'android-diagnostics.txt').write_text(adb('logcat','-d','-t','300'),encoding='utf-8')
    except Exception:pass
    (out/'ANDROID_SMOKE_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))
