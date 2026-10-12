import { itemPresentation, pricedDisplay, priceInfo, identificationLine } from './product-details.js?v=6';

export const normalize = value => String(value ?? '').toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/ł/g,'l');
export const defaultContext = () => ({ customerType:'general', stage:'first', context:'', goal:'auto', nextStep:'' });

export function searchProducts(products, {query='',category='all',warranty='all'}={}) {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  return products.filter(product => {
    if (category !== 'all' && product.category !== category) return false;
    if (warranty !== 'all' && ![product.warranty,...(product.variants ?? []).map(v=>v.specs?.Gwarancja)].some(value=>warrantyYears(value)===Number(warranty))) return false;
    const haystack = product.searchText ?? normalize([product.name,product.sku,product.tradeIndex,product.ean,product.family,product.categoryLabel,product.summary,...Object.values(product.specs ?? {}),...(product.variants ?? []).flatMap(v=>[v.sku,v.tradeIndex,v.name,v.ean])].join(' '));
    return tokens.every(token=>haystack.includes(token));
  });
}

export function warrantyYears(value) {
  const text=String(value ?? ''),n=Number(text.match(/\d+/)?.[0]);
  return /mies/i.test(text) ? n/12 : n || null;
}
export function warrantyLabel(value) {
  const n=warrantyYears(value);
  if (!n) return '';
  if (Number.isInteger(n)) return `${n} ${n===1?'rok':n>=2&&n<=4?'lata':'lat'}`;
  return String(value);
}

export function catalogItem(product, variant) {
  const sku=variant?.sku || product.sku;
  const identity=variant||product,ean=identity.ean||identity.specs?.EAN||'';
  const name=variant ? `${product.name} · ${variant.name && variant.name!==sku ? variant.name : identity.tradeIndex||(ean?`EAN ${ean}`:'Wybrany wariant')}` : product.name;
  const item={
    id:product.id,selectionId:variant ? `${product.id}::${sku}` : product.id,sku,name,
    tradeIndex:identity.tradeIndex||'',ean:product.kind==='family'&&!variant?'':ean,
    url:product.url,image:product.image || '',description:product.summary || '',
    warranty:warrantyLabel(variant?.specs?.Gwarancja || product.warranty),category:product.category,kind:variant?'product':product.kind,
    family:product.family,variantSku:variant?.sku || '',specs:{...(product.specs ?? {}),...(variant?.specs ?? {})},reason:'',
    prices:variant ? (variant.prices ?? {}) : product.kind==='family' ? {} : (product.prices ?? {}),
  };
  item.display=pricedDisplay(item);return item;
}

export function makeOfferState(template) {
  return {
    config:defaultContext(), items:template.items.map((item,index)=>({
      ...structuredClone(item),selectionId:item.selectionId || item.id || item.sku || `category-${index}-${template.id}`,reason:'',
    })), dirty:false, generated:false,
  };
}

export function technicalLine(item) {
  const specs=item.specs ?? {};
  const get = patterns => Object.entries(specs).find(([key,value])=>patterns.some(p=>normalize(key).includes(p)) && value && value!=='—')?.[1];
  const values=[item.sku,get(['zasilanie dc','napiecie wyjsciowe','wyjscie dc','napiecie dc']),get(['moc znamionowa','moc']),get(['barwa swiatla'])].filter(Boolean);
  return [...new Set(values)].join(' · ');
}

export function composeOffer(template,state,sales) {
  const segment=sales.segments[state.config.customerType] || sales.segments.general;
  const stage=sales.stages[state.config.stage] || sales.stages.first;
  const intro=[state.config.stage==='first' ? segment.opening : stage.opening];
  if (state.config.context.trim()) intro.push(state.config.context.trim());
  const goal=state.config.goal==='auto' ? segment.cta : sales.goals[state.config.goal]?.text || segment.cta;
  const closing=[state.config.nextStep.trim() || goal];
  const isB2b=state.config.goal==='b2b' && !state.config.nextStep.trim();
  const items=state.items.filter(item=>priceInfo(item,item.display?.price||'wholesale').available).map(item=>({
    ...item,description:item.reason.trim() || item.description,
    warranty:warrantyLabel(item.warranty),technical:identificationLine(item),...itemPresentation({...item,warranty:warrantyLabel(item.warranty)}),
    name:item.kind==='family' && !item.variantSku ? `${item.name} — rodzina` : item.name,
  }));
  const identity=item=>item.selectionId||item.id||item.sku;
  const sameAssortment=template.items.length===items.length&&template.items.every(item=>items.some(selected=>identity(item)===identity(selected)));
  const preserveTemplate=sameAssortment&&state.config.customerType==='general'&&state.config.stage==='first'&&!state.config.context.trim()&&state.config.goal==='auto'&&!state.config.nextStep.trim();
  return preserveTemplate ? {...template,items} : {...template,subject:stage.subject || segment.subject,intro,closing,items,links:isB2b?[sales.b2b]:[]};
}

export function offerChecks(state) {
  const items=state.items,checks=[];
  if (!items.length) return ['Nie wybrano produktów — mail będzie zawierał samą treść rozmowy i następny krok.'];
  if (items.length>5) checks.push(`Wybrano ${items.length} pozycji. Przy pierwszej wiadomości rozważ pozostawienie najtrafniejszych propozycji.`);
  const years=[...new Set(items.map(i=>warrantyYears(i.warranty)).filter(Boolean))].sort((a,b)=>a-b);
  if (years.length>1) checks.push(`Wybrane produkty mają różne okresy gwarancji (${years.join(', ')} lat). Uwzględnij to w rozmowie z klientem.`);
  if (items.some(i=>i.kind==='family'&&!i.variantSku)) checks.push('W wyborze jest rodzina produktów. Wskaż wariant w katalogu albo ustal go z klientem.');
  if(items.some(i=>!priceInfo(i,i.display?.price||'wholesale').available)) checks.push('Pozycje bez potwierdzonej ceny zostały wyłączone z maila.');
  const voltages=new Set();
  for (const item of items) {
    const entry=Object.entries(item.specs ?? {}).find(([key])=>/zasilanie dc|napiecie dc|napiecie wyjsciowe|wyjscie dc/.test(normalize(key)));
    if (entry && /^\s*(12|24|48)\s*V(?:\s*DC)?\s*$/i.test(entry[1])) voltages.add(entry[1].match(/\d+/)[0]);
  }
  if (voltages.size>1) checks.push(`W wyborze są urządzenia o napięciu ${[...voltages].join(' i ')} V. Jeśli mają pracować razem, sprawdź zgodność ich zasilania.`);
  return checks;
}

export function normalizeContext(raw={}) {
  const value=defaultContext();
  if(['general','installer','furniture','wholesale','architect','advertising'].includes(raw.customerType)) value.customerType=raw.customerType;
  if(['first','offer','followup'].includes(raw.stage)) value.stage=raw.stage;
  if(['auto','quote','selection','samples','meeting','b2b'].includes(raw.goal)) value.goal=raw.goal;
  value.context=String(raw.context ?? '').slice(0,600);value.nextStep=String(raw.nextStep ?? '').slice(0,200);
  return value;
}
