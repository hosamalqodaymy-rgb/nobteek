/* P01 visual-system checks, not tests of the production clinic application. */
const fs=require('fs');const path=require('path');const os=require('os');
const {pathToFileURL}=require('url');const {spawnSync}=require('child_process');
const {chromium}=require('playwright');const sharp=require('sharp');
const ROOT=path.resolve(__dirname,'..');const DESIGN=path.join(ROOT,'design');
const evidence=path.join(ROOT,'results/p01');fs.mkdirSync(evidence,{recursive:true});
const checks=[];const contrast=[];
function check(id,condition,detail,acceptance='T01A'){
 const row={id,status:condition?'passed':'failed',acceptance,detail};checks.push(row);
 if(!condition)console.error(JSON.stringify(row));
}
function lum(hex){const vals=hex.replace('#','').match(/../g).map(h=>parseInt(h,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return vals[0]*.2126+vals[1]*.7152+vals[2]*.0722}
function ratio(a,b){const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
function hex(rgb){const values=rgb.match(/[\d.]+/g).slice(0,3).map(Number);return '#'+values.map(v=>v.toString(16).padStart(2,'0')).join('')}
async function main(){
 if(process.env.SITES_MANAGED_LINUX_CONTAINER==='1')throw new Error('In managed Linux use prepare_p01_preview.py, sites-preview and the controlled browser. This portable Playwright runner does not run here.');
 const executablePath=process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!/^(file:|data:)/.test(r.url()))external.push(r.url())});
  await page.goto(pathToFileURL(path.join(DESIGN,'preview/index.html')).href);await page.evaluate(()=>document.fonts.ready);
  const brand=await page.evaluate(()=>window.NOBTEEK_BRAND);const c=brand.colors;
  for(const [name,fg,bg,min] of [
   ['primary button',c.onPrimary,c.primary,4.5],['primary hover',c.onPrimary,c.primaryHover,4.5],['primary active',c.onPrimary,c.primaryActive,4.5],
   ['main text',c.text,c.background,4.5],['secondary text',c.muted,c.surface,4.5],['success',c.success,c.successBg,4.5],
   ['warning',c.warning,c.warningBg,4.5],['error',c.danger,c.dangerBg,4.5],['primary soft',c.primary,c.tint,4.5],
   ['white on navy',c.surface,c.navy,4.5],['control boundary',c.borderControl,c.surface,3],['focus ring',c.focus,c.surface,3]
  ]){const value=ratio(fg,bg);contrast.push({name,foreground:fg,background:bg,ratio:value,minimum:min});check('contrast_'+name.replaceAll(' ','_'),value>=min,{ratio:Number(value.toFixed(3)),minimum:min})}
  check('self_hosted_font_loaded',await page.evaluate(()=>document.fonts.check('400 16px Tajawal')&&document.fonts.check('500 16px Tajawal')&&document.fonts.check('700 16px Tajawal')),'Local WOFF 400/500/700');
  const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'contracts/p00_v1.json'),'utf8'));
  check('canonical_operational_states',Object.keys(brand.stateLabels).every(entity=>JSON.stringify(Object.keys(brand.stateLabels[entity]).sort())===JSON.stringify([...contract.state_enums[entity]].sort())),'Booking, visit and session keys match P00');
  check('all_screen_state_samples',JSON.stringify((await page.locator('[data-preview-state]').evaluateAll(elements=>elements.map(el=>el.dataset.previewState).sort())))===JSON.stringify([...brand.previewStates].sort()),'Seven required preview states');
  check('badges_have_text_and_icons',await page.locator('.badge').evaluateAll(elements=>elements.every(el=>!!el.textContent.trim()&&!!el.querySelector('svg'))),'Meaning is present as text and an icon');
  const badgeColors=await page.locator('.badge').evaluateAll(elements=>elements.map(el=>({color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor})));
  check('rendered_badge_contrast',badgeColors.every(x=>ratio(hex(x.color),hex(x.bg))>=4.5),'Every rendered state badge at least 4.5:1');
  check('labels_and_error_descriptions',await page.locator('input,select').evaluateAll(elements=>elements.every(el=>el.labels.length>0&&(!el.hasAttribute('aria-describedby')||el.getAttribute('aria-describedby').split(' ').every(id=>!!document.getElementById(id)?.textContent.trim())))),'Every input has a real label and valid described-by target');
  check('phone_direction',await page.locator('input[type=tel]').evaluateAll(elements=>elements.every(el=>getComputedStyle(el).direction==='ltr')),'Phone direction is independent from RTL interface');
  check('body_and_controls_type_size',await page.evaluate(()=>parseFloat(getComputedStyle(document.body).fontSize)>=16&&[...document.querySelectorAll('button,input,select')].every(el=>parseFloat(getComputedStyle(el).fontSize)>=16)),'Body and form controls at least 16px in base preview');
  check('control_hit_height',await page.locator('button,.btn,input:not([type=checkbox]),select,.check-label').evaluateAll(elements=>elements.every(el=>el.getBoundingClientRect().height>=48)),'48px minimum control height including checkbox label target');
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>{const el=document.activeElement,s=getComputedStyle(el);return {tag:el.tagName,outline:s.outlineStyle,width:parseFloat(s.outlineWidth),color:s.outlineColor}});
  check('keyboard_focus_visible',focus.outline==='solid'&&focus.width>=2,focus);
  await page.getByRole('button',{name:'تأكيد الحجز',exact:true}).click();
  check('component_demo_feedback',!!(await page.locator('#component-result').textContent()).trim(),'Demo click gives status feedback without writing a booking');
  for(const width of [360,768,1440]){
   await page.setViewportSize({width,height:1100});await page.evaluate(()=>document.documentElement.style.fontSize='100%');
   await page.screenshot({path:path.join(evidence,`preview-${width}.png`),fullPage:true});
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   check('responsive_'+width,layout.scroll<=layout.width,layout);
  }
  await page.setViewportSize({width:360,height:1200});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await page.screenshot({path:path.join(evidence,'preview-360-text-200.png'),fullPage:true});
  const zoom=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,bodyFont:parseFloat(getComputedStyle(document.body).fontSize)}));
  check('text_200_percent_reflow',zoom.scroll<=zoom.width&&zoom.bodyFont>=32,zoom);
  await page.evaluate(()=>document.documentElement.style.fontSize='100%');
  check('no_runtime_errors',errors.length===0,errors);check('no_external_requests',external.length===0,'Preview and fonts operate from local files');
  for(const size of [24,48]){const m=await sharp(path.join(DESIGN,`assets/symbol-${size}.png`)).metadata();check('symbol_'+size,m.width===size&&m.height===size&&m.hasAlpha,'Exact small-size PNG with transparency')}
  for(const size of [192,512,1024]){
   const {data,info}=await sharp(path.join(DESIGN,`assets/icon-${size}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   let opaque=true,safe=true;
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;if(data[i+3]!==255)opaque=false;
    if(data[i]>230&&data[i+1]>230&&data[i+2]>230&&Math.hypot(x+.5-size/2,y+.5-size/2)>size*.4)safe=false;
   }
   check('app_icon_'+size,info.width===size&&info.height===size&&opaque&&safe,'Opaque square; foreground inside centered 80%-diameter safe circle');
  }
  const vectorFiles=fs.readdirSync(path.join(DESIGN,'assets')).filter(name=>name.endsWith('.svg'));
  check('standalone_vector_assets',vectorFiles.every(name=>{const s=fs.readFileSync(path.join(DESIGN,'assets',name),'utf8');return !/<(?:text|image|foreignObject)\b/.test(s)&&!/(?:href|src)=/.test(s)&&s.includes('<path')}),'Every vector export is made of paths and has no external font/image reference');
  const componentSource=fs.readFileSync(path.join(DESIGN,'styles/components.css'),'utf8');
  check('no_independent_color_literals',!/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/.test(componentSource),'Shared component styles use generated color variables','T01B');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nobteek-p01-brand-'));
  try{
   const alternate=JSON.parse(fs.readFileSync(path.join(DESIGN,'brand.config.json'),'utf8'));alternate.nameAr='ترتيب';alternate.nameEn='QueueDemo';alternate.colors.primary='#1D4ED8';
   const configFile=path.join(temp,'alternate.json');fs.writeFileSync(configFile,JSON.stringify(alternate));
   const target=path.join(temp,'design');const python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
   const built=spawnSync(python,[path.join(ROOT,'tools/build_p01.py'),'--config',configFile,'--out',target],{encoding:'utf8'});
   check('alternate_brand_build',built.status===0,built.stderr||built.stdout,'T01B');
   if(built.status===0){
    fs.copyFileSync(path.join(DESIGN,'styles/components.css'),path.join(target,'styles/components.css'));
    fs.copyFileSync(path.join(DESIGN,'components.js'),path.join(target,'components.js'));
    fs.copyFileSync(path.join(DESIGN,'preview/index.html'),path.join(target,'preview/index.html'));
    const alt=await browser.newPage({viewport:{width:1440,height:1000}});await alt.goto(pathToFileURL(path.join(target,'preview/index.html')).href);await alt.evaluate(()=>document.fonts.ready);
    const changed=await alt.evaluate(()=>({names:[...document.querySelectorAll('[data-brand-name-ar]')].map(e=>e.textContent),en:[...document.querySelectorAll('[data-brand-name-en]')].map(e=>e.textContent),title:document.title,background:getComputedStyle(document.querySelector('.btn')).backgroundColor,hover:window.NOBTEEK_BRAND.colors.primaryHover,tint:window.NOBTEEK_BRAND.colors.tint}));
    check('single_config_names_propagate',changed.names.every(n=>n==='ترتيب')&&changed.en.every(n=>n==='QueueDemo')&&changed.title.includes('QueueDemo'),changed,'T01B');
    check('single_config_color_propagates',hex(changed.background).toUpperCase()==='#1D4ED8'&&changed.hover!==brand.colors.primaryHover&&changed.tint!==brand.colors.tint,changed,'T01B');
    const generated=fs.readdirSync(path.join(target,'assets')).filter(n=>n.endsWith('.svg')).map(n=>({name:n,source:fs.readFileSync(path.join(target,'assets',n),'utf8')}));
    check('all_vector_exports_rebrand',generated.every(({name,source})=>source.includes(name==='logo-en.svg'?'QueueDemo':'ترتيب')&&!source.includes('نوبتيك')&&!source.includes('Nobteek')),'Logo, cover and app SVGs rebuild from the same configuration','T01B');
    await alt.close();
   }
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
  const report={baselineId:brand.baselineId,generatedAt:new Date().toISOString(),validationScope:'P01_design_assets_and_component_preview',productionApplicationTested:false,
   checksRun:checks.length,passed:checks.every(x=>x.status==='passed'),failures:checks.filter(x=>x.status==='failed').length,
   acceptance:Object.fromEntries(['T01A','T01B'].map(id=>[id,{checks:checks.filter(x=>x.acceptance===id).length,status:checks.filter(x=>x.acceptance===id).every(x=>x.status==='passed')?'passed':'failed'}])),
   contrast,checks,manualVisualReviewRequired:true,externalPayments:false};
  fs.writeFileSync(path.join(ROOT,'results/p01_validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checksRun:report.checksRun,failures:report.failures,passed:report.passed,acceptance:report.acceptance}));
  process.exitCode=report.passed?0:1;
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e.stack);process.exit(1)});
