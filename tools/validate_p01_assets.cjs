/* Offline checks usable in the managed container; browser evidence is separate. */
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const sharp=require('sharp');
const {spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),DESIGN=path.join(ROOT,'design');
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(DESIGN,'brand.generated.js'),'utf8'),context);
const b=context.window.NOBTEEK_BRAND,c=b.colors,checks=[],contrast=[];
function add(id,condition,detail,acceptance='T01A'){checks.push({id,status:condition?'passed':'failed',detail,acceptance});if(!condition)console.error(id,detail)}
function lum(hex){const a=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722}
function ratio(a,b){return(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)}
async function main(){
 for(const [id,fg,bg,min] of [
 ['primary',c.onPrimary,c.primary,4.5],['hover',c.onPrimary,c.primaryHover,4.5],['active',c.onPrimary,c.primaryActive,4.5],
 ['main_text',c.text,c.background,4.5],['muted_text',c.muted,c.surface,4.5],['success',c.success,c.successBg,4.5],
 ['warning',c.warning,c.warningBg,4.5],['error',c.danger,c.dangerBg,4.5],['primary_soft',c.primary,c.tint,4.5],
 ['navy_inverse',c.surface,c.navy,4.5],['control_boundary',c.borderControl,c.surface,3],['focus_ring',c.focus,c.surface,3]
 ]){const value=ratio(fg,bg);contrast.push({id,foreground:fg,background:bg,ratio:value,minimum:min});add('contrast_'+id,value>=min,{ratio:Number(value.toFixed(3)),minimum:min})}
 for(const size of [24,48]){const m=await sharp(path.join(DESIGN,`assets/symbol-${size}.png`)).metadata();add('symbol_'+size,m.width===size&&m.height===size&&m.hasAlpha,'Exact PNG dimensions and transparency')}
 for(const size of [192,512,1024]){
  const {data,info}=await sharp(path.join(DESIGN,`assets/icon-${size}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});let safe=true,opaque=true;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;if(data[i+3]!==255)opaque=false;if(data[i]>230&&data[i+1]>230&&data[i+2]>230&&Math.hypot(x+.5-size/2,y+.5-size/2)>size*.4)safe=false}
  add('app_icon_'+size,info.width===size&&info.height===size&&safe&&opaque,'Opaque square and foreground inside the maskable safe circle');
 }
 const vectors=fs.readdirSync(path.join(DESIGN,'assets')).filter(n=>n.endsWith('.svg'));
 add('self_contained_vectors',vectors.every(n=>{const s=fs.readFileSync(path.join(DESIGN,'assets',n),'utf8');return !/<(?:text|image|foreignObject)\b/.test(s)&&!/(?:href|src)=/.test(s)&&s.includes('<path')}),{svgFiles:vectors.length});
 const p00=JSON.parse(fs.readFileSync(path.join(ROOT,'contracts/p00_v1.json'),'utf8'));
 add('state_keys_match_p00',['booking','visit','session'].every(e=>JSON.stringify([...Object.keys(b.stateLabels[e])].sort())===JSON.stringify([...p00.state_enums[e]].sort())),'Canonical operational state names are unchanged');
 add('financial_work_deferred',b.financePhase==='P13'&&!b.externalServicesEnabled&&!b.realPatientData,'No payment or paid integration added');
 const origins=JSON.parse(fs.readFileSync(path.join(DESIGN,'fonts/ORIGIN.json'),'utf8'));
 for(const item of origins){const data=fs.readFileSync(path.join(DESIGN,'fonts',item.name));const sha=crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+data.length+'\0'),data])).digest('hex');add('font_source_'+item.name,sha===item.sha&&data.length===item.size,'Matches the exact official GitHub blob')}
 for(const weight of ['Regular','Medium','Bold'])add('font_woff_'+weight,fs.readFileSync(path.join(DESIGN,'fonts',`Tajawal-${weight}.woff`)).subarray(0,4).toString()==='wOFF','Local WOFF asset');
 const componentCss=fs.readFileSync(path.join(DESIGN,'styles/components.css'),'utf8');
 add('component_colors_use_tokens',!/#(?:[\da-fA-F]{3}|[\da-fA-F]{6})\b/.test(componentCss),'No separate color literals in shared components','T01B');
 const template=fs.readFileSync(path.join(DESIGN,'preview/index.html'),'utf8');
 add('template_brand_is_data_bound',!template.includes('نوبتيك')&&!template.includes('Nobteek')&&template.includes('data-brand-name-ar'),'Visible brand values come from the generated configuration','T01B');
 const alt=path.join(ROOT,'../nobteek-p01-preview/dist/alternate/assets');
 const altVectors=fs.readdirSync(alt).filter(n=>n.endsWith('.svg'));
 add('all_exports_rebrand',altVectors.length===vectors.length&&altVectors.every(n=>{const s=fs.readFileSync(path.join(alt,n),'utf8');return s.includes(n==='logo-en.svg'?'QueueDemo':'ترتيب')&&!s.includes('نوبتيك')&&!s.includes('Nobteek')}),'All SVG variants and cover exports rebuild with their configured language name','T01B');
 const bidi=spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',[path.join(ROOT,'tools/check_p01_bidi.py')],{encoding:'utf8'});
 if(bidi.status!==0)throw new Error('Mixed-script SVG check failed: '+bidi.stdout+bidi.stderr);
 for(const row of JSON.parse(bidi.stdout))add(row.id,row.passed,row.detail);
 const report={baselineId:b.baselineId,generatedAt:new Date().toISOString(),scope:'offline_P01_asset_and_design_contract_checks',productionApplicationTested:false,checksRun:checks.length,passed:checks.every(x=>x.status==='passed'),failures:checks.filter(x=>x.status==='failed').length,contrast,checks};
 fs.writeFileSync(path.join(ROOT,'results/p01_assets_validation.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({checksRun:report.checksRun,failures:report.failures,passed:report.passed,contrast:contrast.map(x=>({id:x.id,ratio:Number(x.ratio.toFixed(2))}))}));process.exitCode=report.passed?0:1;
}
main().catch(e=>{console.error(e.stack);process.exit(1)});
