(function(){
 'use strict';
 const brand=window.NOBTEEK_BRAND;
 if(!brand)throw new Error('Brand configuration is required');
 const iconPaths={
 check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
 clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
 queue:'<path d="M6 6h14M6 12h10M6 18h6"/><circle cx="3" cy="6" r=".5"/><circle cx="3" cy="12" r=".5"/><circle cx="3" cy="18" r=".5"/>',
 bell:'<path d="M6 9a6 6 0 0 1 12 0v6l2 2H4l2-2Z"/><path d="M10 20h4"/>',
 user:'<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
 arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v5m8-5v5M4 11h16"/>',
 pause:'<path d="M8 5v14m8-14v14"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/>',
 offline:'<path d="m3 3 18 18M7 7a14 14 0 0 1 14 0M3 7l2 1m4 4a7 7 0 0 1 7 0M8 15l2-1m2 6h.01"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>'
 };
 function icon(name){return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(iconPaths[name]||iconPaths.info)+'</svg>'}
 function put(selector,value){document.querySelectorAll(selector).forEach(el=>{el.textContent=value})}
 put('[data-brand-name-ar]',brand.nameAr);put('[data-brand-name-en]',brand.nameEn);put('[data-brand-tagline]',brand.tagline);
 for(const key of Object.keys(brand.cover))put('[data-cover="'+key+'"]',brand.cover[key]);
 document.title=brand.nameAr+' '+brand.nameEn+' | معاينة الهوية والمكونات';
 document.documentElement.lang=brand.locale;document.documentElement.dir=brand.direction;
 document.querySelectorAll('[data-ui-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.uiIcon)});
 function badge(entity,state){
  const spec=brand.stateLabels[entity]?.[state];
  if(!spec)throw new Error('Unknown canonical state: '+entity+'.'+state);
  const el=document.createElement('span');el.className='badge tone-'+spec.tone;
  el.dataset.entity=entity;el.dataset.state=state;el.innerHTML=icon(spec.icon);
  const label=document.createElement('span');label.textContent=spec.label;el.append(label);return el;
 }
 document.querySelectorAll('[data-state-badge]').forEach(el=>{el.replaceChildren(badge(el.dataset.entity,el.dataset.state))});
 document.querySelectorAll('[data-state-label]').forEach(el=>{el.textContent=brand.stateLabels[el.dataset.entity][el.dataset.state].label});
 document.querySelectorAll('[data-state-gallery]').forEach(el=>{
  const entity=el.dataset.stateGallery;
  Object.keys(brand.stateLabels[entity]).forEach(state=>el.append(badge(entity,state)));
 });
 const paletteLabels={primary:'اللون الأساسي',navy:'الكحلي',background:'خلفية الصفحات',surface:'البطاقات',text:'النص الأساسي',muted:'النص المساعد',borderControl:'حدود الحقول',danger:'الخطأ'};
 document.querySelectorAll('[data-palette]').forEach(host=>{
  Object.keys(paletteLabels).forEach(key=>{
   const card=document.createElement('div');card.className='swatch';
   const color=document.createElement('div');color.className='swatch-color';color.style.backgroundColor=brand.colors[key];
   const copy=document.createElement('div');copy.className='swatch-copy';
   const title=document.createElement('strong');title.textContent=paletteLabels[key];
   const hex=document.createElement('code');hex.textContent=brand.colors[key];
   copy.append(title,hex);card.append(color,copy);host.append(card);
  });
 });
 document.querySelectorAll('[data-preview-button]').forEach(button=>button.addEventListener('click',()=>{
  const status=document.getElementById('component-result');
  if(status)status.textContent='تمت معاينة تفاعل الزر؛ بيانات هذه الصفحة تجريبية.';
 }));
 window.NOBTEEK_UI={icon,badge,brand,scope:'P01_design_components_only'};
})();
