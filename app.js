import { unlockLibrary } from './crypto.js';
import { renderEmail, cleanEmail, emailText, htmlDocument, escapeHTML } from './email.js?v=2';
import { createZip } from './zip.js';
import { recommendProducts } from './recommend.js?v=4';
import { config, imageUrl } from './config.js';
import { normalize, makeOfferState, catalogItem, composeOffer, offerChecks, searchProducts, warrantyLabel, warrantyYears, technicalLine, normalizeContext } from './offer.js';

const $ = id => document.getElementById(id);
let library=null, current=null, mode='text', unlockPending=false, session=0, toastTimer, catalogLimit=config.catalogPageSize, pendingOverwrite=null, conversationResult=null;
const conversationChoices=new Map();
const customs=new Map(), drafts=new Map(), subjects=new Map(), offers=new Map(), manualEdits=new Set(), subjectOverrides=new Set(), catalogById=new Map(), originalItems=new Map();
const fields={'customer-type':'customerType','message-stage':'stage','customer-context':'context','mail-goal':'goal','next-step':'nextStep'};
const element=(tag,className,text) => {const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const button=(text,action,className='button button-quiet button-small')=>{const node=element('button',className,text);node.type='button';node.addEventListener('click',action);return node;};
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},4000);}
function offer(template=current){if(!offers.has(template.id))offers.set(template.id,makeOfferState(template));return offers.get(template.id);}
function save(){if(!current)return;drafts.set(`${current.id}:${mode}`,cleanEmail($('email-editor').innerHTML));subjects.set(current.id,$('subject-input').value);}
function model(template){const state=offer(template);return state.generated?composeOffer(template,state,library.sales):template;}
function fragment(template,format=mode){return drafts.get(`${template.id}:${format}`)??renderEmail(model(template),format);}
function subject(template){return subjects.get(template.id)??model(template).subject;}
function updateLength(){const count=$('email-editor').innerText.trim().split(/\s+/).filter(Boolean).length;$('mail-length').textContent=`${count} słów`;}
function renderList(){
  if(!library)return;
  const query=normalize($('search-input').value),group=$('group-filter').value;
  const visible=[...customs.values(),...library.templates].filter(t=>(group==='all'||t.group===group)&&normalize([t.title,t.subject,t.purpose,...t.tags,...t.items.map(p=>`${p.name} ${p.sku??''}`)].join(' ')).includes(query));
  $('template-list').replaceChildren();
  for(const t of visible){const node=button('',()=>select(t.id),'template-item');node.dataset.id=t.id;node.classList.toggle('active',current?.id===t.id);node.setAttribute('aria-current',String(current?.id===t.id));const text=element('span','item-text');text.append(element('strong','',t.title),element('small','',t.short));node.append(element('span','item-number',(customs.has(t.id)?'＋':String(library.templates.indexOf(t)+1).padStart(2,'0'))),text);$('template-list').append(node);}
  $('result-count').textContent=`${library.templates.length} wzorów${customs.size?` · ${customs.size} ${customs.size===1?'oferta':customs.size%10>=2&&customs.size%10<=4&&(customs.size%100<12||customs.size%100>14)?'oferty':'ofert'}`:''}`;$('empty-state').hidden=visible.length!==0;
}
function renderEditor(){
  $('subject-input').value=subject(current);$('email-editor').innerHTML=fragment(current);
  $('format-text').setAttribute('aria-pressed',String(mode==='text'));$('format-visual').setAttribute('aria-pressed',String(mode==='visual'));
  $('template-note').textContent=offer().generated?'':current.note??'';$('template-note').hidden=!$('template-note').textContent;updateLength();
}
function select(id,keepFocus=false,saveCurrent=true){
  if(saveCurrent)save();current=customs.get(id)||library.templates.find(t=>t.id===id);if(!current)return;
  $('template-title').textContent=current.title;$('template-purpose').textContent=current.purpose;$('template-tags').replaceChildren(...current.tags.map(t=>element('span','tag',t)));
  for(const [id,key] of Object.entries(fields))$(id).value=offer().config[key];
  renderEditor();renderSelected();renderList();
  if(!keepFocus&&matchMedia('(max-width:760px)').matches)$('template-title').scrollIntoView({behavior:'smooth',block:'start'});
}
function setMode(next){if(!current||next===mode)return;save();mode=next;renderEditor();}
function status(){
  const state=offer();$('builder-status').classList.toggle('pending',state.dirty);
  $('builder-status').textContent=state.dirty?'Zmiany czekają na ułożenie maila. Kopiowanie zastosuje je do treści.':manualEdits.has(current.id)?'Jedna z wersji zawiera ręczne poprawki. Edycja tekstu i wersji ze zdjęciami jest niezależna.':state.generated?'Mail zawiera wybrany asortyment i ustalenia.':'Możesz skopiować wzór albo dopasować go powyżej.';
  $('offer-checks').replaceChildren(...offerChecks(state).map(text=>element('p','check-item',text)));
}
function markDirty(){offer().dirty=true;status();}
function photo(src,alt,className){const img=element('img',className);img.src=src;img.alt=alt;img.loading='lazy';img.addEventListener('error',()=>{img.hidden=true;},{once:true});return img;}
function renderSelected(){
  const items=offer().items;$('selected-count').textContent=String(items.length);$('selected-products').replaceChildren();
  items.forEach((item,index)=>{
    const row=element('div','selected-product'),main=element('div','selected-product-main'),copy=element('div');row.dataset.selectionId=item.selectionId;
    if(item.image)main.append(photo(item.image,item.name,''));copy.append(element('strong','',item.name),element('small','',[item.sku,item.warranty?`Gwarancja: ${warrantyLabel(item.warranty)}`:'',item.kind==='family'?'Rodzina produktów':''].filter(Boolean).join(' · ')));main.append(copy);
    const reason=element('input','product-reason');reason.type='text';reason.maxLength=300;reason.value=item.reason||'';reason.placeholder='Dlaczego ten produkt? Zdanie dla klienta';reason.setAttribute('aria-label',`Powód wyboru: ${item.name}`);reason.addEventListener('input',()=>{item.reason=reason.value;markDirty();});
    const actions=element('div','selected-product-actions');
    const up=button('',()=>{[items[index-1],items[index]]=[items[index],items[index-1]];markDirty();renderSelected();});up.innerHTML='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>';up.title='Przenieś wyżej';up.disabled=index===0;up.setAttribute('aria-label',`Przenieś wyżej: ${item.name}`);
    const down=button('',()=>{[items[index+1],items[index]]=[items[index],items[index+1]];markDirty();renderSelected();});down.innerHTML='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg>';down.title='Przenieś niżej';down.disabled=index===items.length-1;down.setAttribute('aria-label',`Przenieś niżej: ${item.name}`);
    const remove=button('Usuń',()=>{items.splice(index,1);markDirty();renderSelected();});remove.classList.add('remove-product');remove.setAttribute('aria-label',`Usuń: ${item.name}`);actions.append(element('span','product-order',`Pozycja ${index+1}`),up,down,remove);row.append(main,reason,actions);$('selected-products').append(row);
  });
  $('selection-hint').textContent=items.length?'Kolejność tutaj odpowiada kolejności w mailu. Własne uzasadnienie zastąpi opis katalogowy.':'Zacznij od produktów pasujących do rozmowy. Możesz też wysłać wiadomość bez listy produktów.';status();
}
function regenerate(){
  const state=offer();state.generated=true;state.dirty=false;drafts.delete(`${current.id}:text`);drafts.delete(`${current.id}:visual`);manualEdits.delete(current.id);
  if(!subjectOverrides.has(current.id))subjects.delete(current.id);renderEditor();status();
}
function confirmOverwrite(action){if(manualEdits.has(current.id)){pendingOverwrite=action;$('overwrite-dialog').showModal();}else action();}
function ensureReady(action){if(!current)return;if(offer().dirty)confirmOverwrite(()=>{regenerate();action();});else action();}
$('apply-offer').addEventListener('click',()=>confirmOverwrite(()=>{regenerate();toast('Mail ułożony. Możesz go jeszcze dopracować przed skopiowaniem.');}));
$('confirm-overwrite').addEventListener('click',()=>{const action=pendingOverwrite;pendingOverwrite=null;$('overwrite-dialog').close();action?.();});
$('copy-existing').addEventListener('click',()=>{const html=cleanEmail($('email-editor').innerHTML);pendingOverwrite=null;$('overwrite-dialog').close();copy({html,plain:emailText(html),message:'Skopiowano obecną treść. Zmiany asortymentu nadal czekają na zastosowanie.'});});
$('cancel-overwrite').addEventListener('click',()=>{pendingOverwrite=null;$('overwrite-dialog').close();});
$('overwrite-dialog').addEventListener('cancel',()=>{pendingOverwrite=null;});
for(const [id,key] of Object.entries(fields))$(id).addEventListener($(id).tagName==='SELECT'?'change':'input',()=>{offer().config[key]=$(id).value;markDirty();});

function setupLibrary(){
  for(const product of library.catalog.products){product.image=imageUrl(product.image);catalogById.set(product.id,product);product.searchText=normalize([product.name,product.sku,product.family,product.categoryLabel,product.summary,...Object.values(product.specs??{}),...(product.variants??[]).flatMap(v=>[v.sku,v.name,v.ean,...Object.values(v.specs??{})])].join(' '));}
  for(const template of library.templates){template.items=template.items.map((item,index)=>{const product=[...catalogById.values()].find(p=>p.url===item.url||item.sku&&p.sku===item.sku);const enriched=product?{...catalogItem(product),...item,id:product.id,selectionId:product.id,specs:product.specs,kind:product.kind,warranty:warrantyLabel(product.warranty)}:{...item,selectionId:`category-${index}-${template.id}`};enriched.image=imageUrl(enriched.image);enriched.reason='';originalItems.set(enriched.selectionId,enriched);return enriched;});}
  const categories=new Map(library.catalog.products.map(p=>[p.category,p.categoryLabel]));$('catalog-category').replaceChildren(new Option('Wszystkie kategorie','all'),...[...categories].map(([value,label])=>new Option(label,value)));
  $('catalog-meta').textContent=`${library.catalog.products.length} produktów i rodzin · Stan katalogu: ${library.catalog.updated}. `;
  const link=element('a','','Otwórz katalog Prescot');link.href=config.catalogUrl;link.target='_blank';link.rel='noopener noreferrer';$('catalog-meta').append(link);
}
function renderCatalog(reset=false){
  if(reset)catalogLimit=config.catalogPageSize;
  const found=searchProducts(library.catalog.products,{query:$('catalog-search').value,category:$('catalog-category').value,warranty:$('catalog-warranty').value});
  $('catalog-results').replaceChildren();
  for(const product of found.slice(0,catalogLimit)){
    const card=element('article','catalog-card');card.dataset.id=product.id;
    if(product.image)card.append(photo(product.image,product.name,'catalog-photo'));else card.append(element('span','catalog-photo no-photo','Bez zdjęcia'));
    const copy=element('div','catalog-copy');copy.append(element('span','catalog-kind',`${product.categoryLabel}${product.kind==='family'?' · Rodzina produktów':''}`),element('h3','',product.name),element('p','',product.summary),element('small','',technicalLine(product)));
    if(product.warranty)copy.append(element('small','',`Gwarancja: ${warrantyLabel(product.warranty)}`));
    let variant=null;
    const actions=element('div','catalog-actions');
    const item=()=>catalogItem(product,variant);
    const update=()=>{const selected=offer().items.some(i=>i.selectionId===item().selectionId);card.classList.toggle('selected',selected);add.textContent=selected?'Usuń z maila':'+ Dodaj do maila';add.setAttribute('aria-pressed',String(selected));$('catalog-result-count').textContent=`${Math.min(catalogLimit,found.length)} z ${found.length} wyników · W mailu: ${offer().items.length}`;};
    const add=button('',()=>{const chosen=item(),items=offer().items,index=items.findIndex(i=>i.selectionId===chosen.selectionId);if(index<0)items.push(chosen);else items.splice(index,1);markDirty();renderSelected();update();},'button button-primary button-small');
    if(product.variants?.length){
      const variants=element('select','catalog-variant');variants.setAttribute('aria-label',`Wariant: ${product.name}`);variants.append(new Option('Cała rodzina — wariant do ustalenia',''));
      for(const v of product.variants)variants.append(new Option(`${v.sku} · ${v.name}`,v.sku));
      const query=normalize($('catalog-search').value).trim();const matching=product.variants.find(v=>query&&(normalize(v.sku)===query||normalize(v.ean)===query))||($('catalog-warranty').value!=='all'&&product.variants.find(v=>warrantyYears(v.specs?.Gwarancja)===Number($('catalog-warranty').value)));if(matching){variant=matching;variants.value=matching.sku;}
      variants.addEventListener('change',()=>{variant=product.variants.find(v=>v.sku===variants.value)||null;update();});card.append(variants);
    }
    const link=element('a','button button-quiet button-small','Karta produktu ↗');link.href=product.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(add,link);card.append(copy,actions);update();$('catalog-results').append(card);
  }
  $('catalog-result-count').textContent=`${Math.min(catalogLimit,found.length)} z ${found.length} wyników · W mailu: ${offer().items.length}`;$('catalog-empty').hidden=found.length!==0;$('catalog-more').hidden=found.length<=catalogLimit;
}
$('open-catalog').addEventListener('click',()=>{renderCatalog(true);$('catalog-dialog').showModal();$('catalog-search').focus();});
for(const id of ['close-catalog','catalog-done'])$(id).addEventListener('click',()=>$('catalog-dialog').close());
$('catalog-search').addEventListener('input',()=>renderCatalog(true));for(const id of ['catalog-category','catalog-warranty'])$(id).addEventListener('change',()=>renderCatalog(true));
$('catalog-more').addEventListener('click',()=>{catalogLimit+=config.catalogPageSize;renderCatalog();});
$('catalog-clear').addEventListener('click',()=>{$('catalog-search').value='';$('catalog-category').value='all';$('catalog-warranty').value='all';renderCatalog(true);});
function newTemplate(){return {id:`oferta-${Date.now()}`,title:`Twoja oferta ${customs.size+1}`,short:'Własny wybór produktów',group:'start',purpose:'Wybierz produkty i dopasuj wiadomość do konkretnej rozmowy.',tags:['Własny wybór','Bez stopki'],subject:library.sales.segments.general.subject,intro:[library.sales.segments.general.opening],closing:[library.sales.segments.general.cta],items:[],links:[]};}
$('start-custom').addEventListener('click',()=>{const custom=newTemplate();customs.set(custom.id,custom);offer(custom).generated=true;select(custom.id);});

const numberPL=value=>new Intl.NumberFormat('pl-PL',{maximumFractionDigits:2}).format(value);
function resetConversationResults(){
  conversationResult=null;conversationChoices.clear();$('conversation-results').hidden=true;$('apply-conversation').disabled=true;$('conversation-status').textContent='';$('conversation-selection').textContent='Wybierz propozycje, które chcesz uwzględnić w mailu.';
}
$('open-conversation').addEventListener('click',()=>{resetConversationResults();$('replace-assortment').checked=false;$('conversation-note').value=offer().conversationNote||'';$('reserve-percent').value=offer().reservePercent??20;$('conversation-dialog').showModal();$('conversation-note').focus();});
$('close-conversation').addEventListener('click',()=>$('conversation-dialog').close());
$('conversation-note').addEventListener('input',()=>{offer().conversationNote=$('conversation-note').value;resetConversationResults();});
$('reserve-percent').addEventListener('input',()=>{resetConversationResults();});
function conversationCount(){
  const count=[...conversationChoices.values()].filter(Boolean).length;$('apply-conversation').disabled=count===0;$('conversation-selection').textContent=count?`Do oferty: ${count} ${count===1?'pozycja':count<5?'pozycje':'pozycji'}. ${$('replace-assortment').checked?'Zastąpisz obecny asortyment.':'Obecny asortyment zostanie zachowany.'}`:'Wybierz propozycje, które chcesz uwzględnić w mailu.';
}
$('replace-assortment').addEventListener('change',conversationCount);
function analyzeConversation(stripId=null,preserve=false){
  const note=$('conversation-note').value.trim(),reserve=Number($('reserve-percent').value);
  if(note.length<3){$('conversation-status').textContent='Opisz potrzeby klienta lub wpisz symbol produktu.';return;}
  if($('reserve-percent').value===''||!Number.isFinite(reserve)||reserve<0||reserve>50){$('conversation-status').textContent='Podaj rezerwę mocy od 0 do 50%.';return;}
  offer().conversationNote=note;offer().reservePercent=reserve;
  conversationResult=recommendProducts(note,library.catalog.products,{reservePercent:reserve,...(stripId?{stripId}:{})});
  if(!preserve)conversationChoices.clear();
  for(const group of conversationResult.groups){const key=candidate=>candidate.variantSku?`${candidate.id}::${candidate.variantSku}`:candidate.id;const previous=conversationChoices.get(group.key);if(previous!==''&&!group.products.some(p=>key(p)===previous))conversationChoices.set(group.key,group.products[0]?key(group.products[0]):'');}
  for(const key of conversationChoices.keys())if(!conversationResult.groups.some(g=>g.key===key))conversationChoices.delete(key);
  renderConversation();if(!preserve)$('conversation-results').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderConversation(){
  const result=conversationResult;$('conversation-results').hidden=false;$('conversation-status').textContent=result.summary;
  $('conversation-criteria').replaceChildren(...result.criteria.map(c=>element('span','',`${c.label}: ${c.value}`)));
  if(!result.criteria.length)$('conversation-criteria').append(element('p','','Nie rozpoznano jeszcze konkretnych parametrów.'));
  const calc=$('conversation-calculation');calc.replaceChildren();calc.hidden=!result.calculation;
  if(result.calculation){const c=result.calculation,p=catalogById.get(c.stripId);calc.append(element('strong','',`Obliczenie dla ${p?.sku||p?.name||'wybranej taśmy'}`),element('p','',`${numberPL(c.lengthMeters)} m × ${numberPL(c.wattsPerMeter)} W/m = ${numberPL(c.loadWatts)} W obciążenia`),element('p','',`${numberPL(c.loadWatts)} W ÷ ${numberPL(1-c.reservePercent/100)} = minimum ${numberPL(c.minimumSupplyWatts)} W${c.voltage?`, ${c.voltage} V DC`:''}. Rezerwa: ${numberPL(c.reservePercent)}%.`),element('p','conversation-note-hint','Rezerwa to przyjęte założenie. Podział odcinków i sposób zasilania trzeba ustalić dla konkretnej instalacji.'));}
  $('conversation-questions').replaceChildren();if(result.questions.length){const list=element('ul');for(const q of result.questions)list.append(element('li','',q));$('conversation-questions').append(element('strong','','Do ustalenia z klientem'),list);}
  $('conversation-groups').replaceChildren();
  for(const group of result.groups){
    const section=element('section','conversation-group');section.append(element('h3','',group.title));if(group.note)section.append(element('p','conversation-note-hint',group.note));
    for(const candidate of [...group.products,null]){
      const p=candidate?catalogById.get(candidate.id):null;if(candidate&&!p)continue;
      const id=candidate?(candidate.variantSku?`${candidate.id}::${candidate.variantSku}`:candidate.id):'';
      const row=element('label',candidate?'recommendation':'recommendation recommendation-skip'),radio=element('input');radio.type='radio';radio.name=`recommend-${group.key}`;radio.value=id;radio.checked=conversationChoices.get(group.key)===id;
      radio.addEventListener('change',()=>{conversationChoices.set(group.key,id);if(group.key==='strips'&&id)analyzeConversation(candidate.id,true);else conversationCount();});
      const copy=element('span');if(candidate){copy.append(element('strong','',`${p.name}${candidate.variantSku?` · ${candidate.variantSku}`:''}`),element('small','',candidate.reasons.join(' · ')));const link=element('a','','Sprawdź kartę produktu ↗');link.href=p.url;link.target='_blank';link.rel='noopener noreferrer';copy.append(link);}else copy.textContent='Pomiń tę grupę';
      row.append(radio,copy);section.append(row);
    }
    $('conversation-groups').append(section);
  }
  conversationCount();
}
$('analyze-conversation').addEventListener('click',()=>analyzeConversation());
$('apply-conversation').addEventListener('click',()=>{
  if(!conversationResult)return;let added=0,typeChanged=false;if($('replace-assortment').checked)offer().items=[];
  for(const group of conversationResult.groups){const selected=conversationChoices.get(group.key),candidate=group.products.find(p=>(p.variantSku?`${p.id}::${p.variantSku}`:p.id)===selected);if(!candidate)continue;const p=catalogById.get(candidate.id);if(!p)continue;const variant=candidate.variantSku?p.variants?.find(v=>v.sku===candidate.variantSku):null;const item=catalogItem(p,variant);if(offer().items.some(i=>i.selectionId===item.selectionId))continue;offer().items.push(item);added++;}
  if(conversationResult.customerType&&offer().config.customerType==='general'){typeChanged=true;offer().config.customerType=conversationResult.customerType;$('customer-type').value=conversationResult.customerType;}
  if(added||typeChanged){markDirty();renderSelected();}else status();$('conversation-dialog').close();toast(added?`Dodano ${added} ${added===1?'propozycję':added<5?'propozycje':'propozycji'}. Ułóż mail, aby zobaczyć nowy asortyment.`:'Wybrane produkty są już w ofercie.');
});

$('unlock-form').addEventListener('submit',async event=>{
  event.preventDefault();if(unlockPending)return;
  if(!crypto.subtle){$('login-error').textContent='Otwórz kreator przez bezpieczny adres HTTPS.';return;}
  const password=$('password').value;if(!password){$('login-error').textContent='Wpisz hasło.';$('password').focus();return;}
  unlockPending=true;$('unlock-button').disabled=true;$('unlock-button').textContent='Otwieranie…';$('login-error').textContent='';
  try{
    let payload;try{const response=await fetch(config.libraryPath,{cache:'no-store'});if(!response.ok)throw new Error();payload=await response.json();}catch{$('login-error').textContent='Nie udało się pobrać biblioteki. Sprawdź połączenie i spróbuj ponownie.';return;}
    try{library=await unlockLibrary(password,payload);}catch{$('login-error').textContent='Nieprawidłowe hasło. Spróbuj ponownie.';$('password').select();return;}
    try{setupLibrary();}catch{library=null;$('login-error').textContent='Nie udało się wczytać katalogu. Odśwież stronę i spróbuj ponownie.';return;}
    $('password').value='';$('password').type='password';$('toggle-password').textContent='Pokaż';$('toggle-password').setAttribute('aria-label','Pokaż hasło');$('toggle-password').setAttribute('aria-pressed','false');
    $('lock-screen').hidden=true;$('workspace').hidden=false;select(library.templates[0].id,true);$('search-input').focus();session++;
  }finally{unlockPending=false;$('unlock-button').disabled=false;$('unlock-button').textContent='Otwórz kreator';}
});
$('toggle-password').addEventListener('click',()=>{const show=$('password').type==='password';$('password').type=show?'text':'password';$('toggle-password').textContent=show?'Ukryj':'Pokaż';$('toggle-password').setAttribute('aria-label',show?'Ukryj hasło':'Pokaż hasło');$('toggle-password').setAttribute('aria-pressed',String(show));});
function lock(){
  session++;conversationResult=null;conversationChoices.clear();library=null;current=null;mode='text';pendingOverwrite=null;for(const map of [customs,drafts,subjects,offers,catalogById,originalItems,manualEdits,subjectOverrides])map.clear();
  $('workspace').hidden=true;$('lock-screen').hidden=false;
  for(const id of ['email-editor','template-list','template-title','template-purpose','template-tags','template-note','selected-products','catalog-results','catalog-meta','offer-checks','conversation-criteria','conversation-calculation','conversation-questions','conversation-groups'])$(id).replaceChildren();
  for(const id of ['password','subject-input','search-input','copy-fallback-text','customer-context','next-step','catalog-search','project-file','conversation-note'])$(id).value='';
  $('group-filter').value='all';$('login-error').textContent='';$('toast').hidden=true;for(const id of ['copy-fallback','catalog-dialog','overwrite-dialog','conversation-dialog'])$(id).close();$('password').focus();
}
$('lock-button').addEventListener('click',lock);window.addEventListener('pagehide',()=>{if(library)lock();});
$('search-input').addEventListener('input',renderList);$('group-filter').addEventListener('change',renderList);
$('format-text').addEventListener('click',()=>setMode('text'));$('format-visual').addEventListener('click',()=>setMode('visual'));
$('subject-input').addEventListener('input',()=>{subjectOverrides.add(current.id);save();});
function editorChanged(){manualEdits.add(current.id);save();updateLength();status();}
$('email-editor').addEventListener('input',editorChanged);$('email-editor').addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));editorChanged();});$('email-editor').addEventListener('drop',event=>event.preventDefault());
$('email-editor').addEventListener('click',event=>{const link=event.target.closest('a');if(link&&(event.ctrlKey||event.metaKey))window.open(link.href,'_blank','noopener,noreferrer');});
$('reset-template').addEventListener('click',()=>confirmOverwrite(()=>{drafts.delete(`${current.id}:text`);drafts.delete(`${current.id}:visual`);subjects.delete(current.id);subjectOverrides.delete(current.id);manualEdits.delete(current.id);offers.delete(current.id);select(current.id,true,false);toast('Przywrócono pierwotny wzór i asortyment.');}));

function legacyCopy(html,plain){
  const holder=document.createElement('div');holder.contentEditable='true';holder.style.cssText='position:fixed;left:-10000px;top:0;';holder.innerHTML=html||escapeHTML(plain).replace(/\n/g,'<br>');document.body.append(holder);
  const selection=getSelection(),saved=selection.rangeCount?selection.getRangeAt(0).cloneRange():null,range=document.createRange();range.selectNodeContents(holder);selection.removeAllRanges();selection.addRange(range);
  const handler=event=>{if(event.clipboardData){event.clipboardData.setData('text/plain',plain);if(html)event.clipboardData.setData('text/html',html);event.preventDefault();}};
  document.addEventListener('copy',handler);let success=false;try{success=document.execCommand('copy');}catch{}document.removeEventListener('copy',handler);holder.remove();selection.removeAllRanges();if(saved)selection.addRange(saved);return success;
}
async function copy({html,plain,message}){
  const activeSession=session;try{if(html&&navigator.clipboard?.write&&window.ClipboardItem)await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);else if(!html&&navigator.clipboard?.writeText)await navigator.clipboard.writeText(plain);else if(!legacyCopy(html,plain))throw new Error();if(session===activeSession)toast(message);}
  catch{if(session!==activeSession)return;if(legacyCopy(html,plain))toast(message);else{$('copy-fallback-text').value=plain;$('copy-fallback').showModal();$('copy-fallback-text').select();}}
}
$('copy-subject').addEventListener('click',()=>ensureReady(()=>copy({plain:$('subject-input').value,message:'Temat skopiowany.'})));
$('copy-email').addEventListener('click',()=>ensureReady(()=>{save();const html=fragment(current);copy({html,plain:emailText(html),message:'Mail skopiowany. Wklej go nad swoją stopką.'});}));
$('copy-plain').addEventListener('click',()=>ensureReady(()=>{save();copy({plain:emailText(fragment(current)),message:'Zwykły tekst z linkami skopiowany.'});}));
$('close-copy-fallback').addEventListener('click',()=>$('copy-fallback').close());
function download(name,blob){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
$('download-html').addEventListener('click',()=>ensureReady(()=>{save();download(`prescot-${current.id}${mode==='visual'?'-zdjecia':''}.html`,new Blob([htmlDocument(subject(current),fragment(current))],{type:'text/html;charset=utf-8'}));toast('Pobrano HTML bez podpisu i stopki.');}));
$('download-txt').addEventListener('click',()=>ensureReady(()=>{save();download(`prescot-${current.id}.txt`,new Blob([`Temat: ${subject(current)}\n\n${emailText(fragment(current))}\n`],{type:'text/plain;charset=utf-8'}));}));
$('download-all').addEventListener('click',()=>{
  if(!library)return;const files=[];
  for(const t of library.templates){const prefix=`${(customs.has(t.id)?'＋':String(library.templates.indexOf(t)+1).padStart(2,'0'))}-${t.id}/`;files.push({name:prefix+'mail.html',content:htmlDocument(t.subject,renderEmail(t,'text'))},{name:prefix+'mail-ze-zdjeciami.html',content:htmlDocument(t.subject,renderEmail(t,'visual'))},{name:prefix+'mail.txt',content:`Temat: ${t.subject}\n\n${emailText(renderEmail(t,'text'))}\n`});}
  download('PRESCOT-10-maili.zip',createZip(files));toast('Pobrano 10 wzorów: HTML, wersje ze zdjęciami i TXT.');
});
$('save-project').addEventListener('click',()=>{save();const payload={type:'prescot-offer',version:1,templateId:current.id,conversationNote:offer().conversationNote||'',reservePercent:offer().reservePercent??20,config:offer().config,items:offer().items.map(i=>({selectionId:i.selectionId,id:i.id,variantSku:i.variantSku,reason:i.reason||''})),generated:offer().generated,dirty:offer().dirty,subject:subject(current),subjectOverride:subjectOverrides.has(current.id),manual:manualEdits.has(current.id),mode,drafts:{text:fragment(current,'text'),visual:fragment(current,'visual')}};download('prescot-oferta-robocza.json',new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));toast('Zapisano plik roboczy na tym urządzeniu. Wczytasz go przy kolejnym logowaniu.');});
$('load-project').addEventListener('click',()=>$('project-file').click());
$('project-file').addEventListener('change',async()=>{
  const file=$('project-file').files[0],activeSession=session;if(!file)return;
  try{
    if(file.size>2_000_000)throw new Error();const data=JSON.parse(await file.text());if(!library||session!==activeSession)return;
    if(data.type!=='prescot-offer'||data.version!==1||!Array.isArray(data.items)||data.items.length>200)throw new Error();
    const items=data.items.map(raw=>{let item;const p=catalogById.get(raw.id);if(p){const variant=raw.variantSku?p.variants?.find(v=>v.sku===raw.variantSku):null;if(raw.variantSku&&!variant)throw new Error();item=catalogItem(p,variant);}else if(originalItems.has(raw.selectionId))item=structuredClone(originalItems.get(raw.selectionId));else throw new Error();item.reason=String(raw.reason||'').slice(0,300);return item;});
    if(new Set(items.map(i=>i.selectionId)).size!==items.length)throw new Error();
    save();const base=library.templates.find(t=>t.id===data.templateId);const custom={...(base?structuredClone(base):newTemplate()),id:`oferta-${Date.now()}`,title:`Wczytana oferta ${customs.size+1}`,purpose:'Zapisana propozycja — możesz dopracować ją przed wysłaniem.'};
    customs.set(custom.id,custom);offers.set(custom.id,{conversationNote:String(data.conversationNote||'').slice(0,3000),reservePercent:Number.isFinite(data.reservePercent)?Math.max(0,Math.min(50,data.reservePercent)):20,config:normalizeContext(data.config),items,generated:Boolean(data.generated),dirty:Boolean(data.dirty)});subjects.set(custom.id,String(data.subject||custom.subject).slice(0,300));subjectOverrides.delete(custom.id);if(data.subjectOverride)subjectOverrides.add(custom.id);manualEdits.delete(custom.id);if(data.manual)manualEdits.add(custom.id);
    for(const format of ['text','visual']){drafts.delete(`${custom.id}:${format}`);if(typeof data.drafts?.[format]==='string')drafts.set(`${custom.id}:${format}`,cleanEmail(data.drafts[format]));}
    mode=data.mode==='visual'?'visual':'text';select(custom.id,true,false);toast('Wczytano ofertę. Możesz zmienić produkty lub treść.');
  }catch{toast('Nie udało się wczytać oferty. Użyj pliku JSON zapisanego w tym kreatorze.');}finally{$('project-file').value='';}
});
