/* P11: real localhost Laravel/PostgreSQL outage UX, synthetic fixture, no outbound commands. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.NOBTEEK_BROWSER_TOOLS,'node_modules/playwright'));
const base='http://127.0.0.1:8000',out=path.join(__dirname,'../results/p11-ci');
const password=process.env.NOBTEEK_BROWSER_PASSWORD;
assert.equal(process.env.APP_ENV,'testing');
assert.equal(process.env.DB_DATABASE,'nobteek_test_browser');
assert.ok(password&&password.length>=24);
const report={phase:'P11',checks:[],layouts:[],syntheticOnly:true,apiMocked:false,offlineCommandsQueued:false,passed:false};
let browser;
function save(){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');}
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('P11 '+name+' passed');save();}catch(e){report.checks.push({name,passed:false,error:String(e.message).slice(0,400)});save();throw e;}}
async function main(){
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'ar-YE'});
  const page=await context.newPage();
  let attemptedWrites=0;
  page.on('request',req=>{if(req.method()!=='GET'&&req.url().includes('/v1/'))attemptedWrites++;});
  await check('reception_signin',async()=>{
    await page.goto(base+'/login');
    await page.getByLabel('اسم الدخول',{exact:true}).fill('demo_reception_a');
    await page.getByLabel('كلمة المرور',{exact:true}).fill(password);
    await page.getByRole('button',{name:'دخول العيادة',exact:true}).click();
    await page.waitForURL('**/workspace');
  });
  await check('live_read_only_counts',async()=>{
    await page.goto(base+'/workspace/outage');
    await page.getByRole('heading',{name:'الانقطاع والمطابقة مع السجل الورقي'}).waitFor();
    await page.getByText('الخادم متصل وقاعدة البيانات أجابت.',{exact:false}).waitFor();
    const r=await page.request.get(base+'/v1/outage/status',{headers:{Accept:'application/json'}});
    assert.equal(r.status(),200);
    const b=await r.json();assert.equal(b.synchronized,true);assert.ok(Array.isArray(b.sessions));
    assert.equal(b.sessions.every(s=>!('patient_id'in s)&&!('contact_phone'in s)),true);
  });
  await check('disconnect_never_claims_save',async()=>{
    await context.setOffline(true);
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await page.getByRole('alert').getByText('الاتصال منقطع',{exact:false}).waitFor();
    await page.getByRole('button',{name:'فحص الخادم وتحديث الأعداد'}).click();
    await page.getByText('لا تنفذ أي حفظ أو إصدار تذكرة.',{exact:false}).waitFor();
    assert.equal(attemptedWrites,0);
  });
  await check('reconnect_requires_server_proof',async()=>{
    await context.setOffline(false);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.getByRole('alert').getByText('عاد اتصال الجهاز',{exact:false}).waitFor();
    assert.equal(await page.getByText('الخادم متصل وقاعدة البيانات أجابت.',{exact:false}).count(),0);
    const [resp]=await Promise.all([page.waitForResponse(r=>r.url().includes('/v1/outage/status')&&r.request().method()==='GET'),page.getByRole('button',{name:'فحص الخادم وتحديث الأعداد'}).click()]);
    assert.equal(resp.status(),200);
    await page.getByText('الخادم متصل وقاعدة البيانات أجابت.',{exact:false}).waitFor();
    assert.equal(attemptedWrites,0);
  });
  await check('paper_model_has_no_storage',async()=>{
    assert.ok(await page.getByRole('heading',{name:'إجراءات بديلة ومطابقة بعد العودة'}).count());
    assert.equal(await page.getByRole('checkbox').count(),6);
    const stored=await page.evaluate(()=>({
      local:Object.entries(localStorage),session:Object.entries(sessionStorage),
    }));
    const encoded=JSON.stringify(stored);
    for(const forbidden of ['contact_phone','patient_id','ticket_url','ticket_secret','authorization','recovery_code']){
      assert.ok(!encoded.toLowerCase().includes(forbidden),'private field in browser storage');
    }
  });
  await check('responsive_200_percent',async()=>{
    for(const width of [360,768,1440])for(const zoom of [1,2]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(zoom=>document.documentElement.style.fontSize=(16*zoom)+'px',zoom);
      const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
      report.layouts.push({width,zoom,...sizes});
      assert.ok(sizes.scroll<=sizes.client+1,'overflow '+width+' zoom '+zoom);
      await page.screenshot({path:path.join(out,'outage-'+width+'-'+zoom+'.png'),fullPage:true});
    }
  });
  report.offlineCommandsQueued=attemptedWrites!==0;
  assert.equal(attemptedWrites,0);
  report.passed=true;save();
}
main().catch(e=>{console.error(e);save();process.exitCode=1;}).finally(async()=>{await browser?.close();});
