import { imageUrl } from './config.js';

export const detailFields = [
  {key:'warranty',label:'Gwarancja'}, {key:'voltage',label:'Napięcie'},
  {key:'power',label:'Moc'}, {key:'brightness',label:'Jasność'},
  {key:'energy',label:'Klasa energetyczna'},
];
export function normalizeDisplay(raw={}) {
  const display={warranty:true,voltage:false,power:false,brightness:false,energy:false,price:'none'};
  for(const {key} of detailFields) if(typeof raw?.[key]==='boolean')display[key]=raw[key];
  if(['none','wholesale','retail'].includes(raw?.price))display.price=raw.price;
  return display;
}
export function identificationLine(item) {
  if(item.kind==='family'&&!item.variantSku)return '';
  const ean=item.ean||item.specs?.EAN;
  return [item.tradeIndex?`Indeks handlowy: ${item.tradeIndex}`:'',ean?`EAN: ${ean}`:''].filter(Boolean).join(' · ');
}
const normalized=value=>String(value).toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/ł/g,'l').trim();
const present=value=>value!=null && !['','—','-','brak','n/d','nie dotyczy'].includes(normalized(value));
export function productFacts(item) {
  const specs=new Map(Object.entries(item.specs??{}).map(([k,v])=>[normalized(k),v]));
  const get=(keys,label)=>{for(const key of keys){const value=specs.get(key);if(present(value))return {label,value:String(value)};}return null;};
  const voltage=get(['napiecie wyjsciowe','wyjscie dc'],'Napięcie wyjściowe') || get(['zasilanie dc','napiecie dc','napiecie pracy','zasilanie ac','napiecie wejsciowe','napiecie','zasilanie'],'Napięcie');
  const power=get(['moc wszystkich kanalow'],'Moc wszystkich kanałów') || get(['moc znamionowa','moc'],'Moc');
  const brightness=get(['strumien swietlny','strumien'],'Strumień świetlny') || get(['strumien kanalu bialego'],'Strumień kanału białego');
  const energy=String(specs.get('klasa energetyczna')??'').trim().toUpperCase();
  return {
    warranty:present(item.warranty)?{label:'Gwarancja',value:item.warranty}:null,
    voltage,power,brightness,
    energy:/^[A-G]$/.test(energy)?{label:'Klasa energetyczna',value:energy,image:imageUrl(`assets/energy/${energy}.png`)}:null,
  };
}
export function priceInfo(item, mode) {
  const value=item.prices?.[mode];
  if(!['wholesale','retail'].includes(mode)||!value||item.kind==='family'&&!item.variantSku)return {available:false,reason:'Brak ceny dla tej pozycji'};
  if(!Number.isFinite(Number(value.amount))||Number(value.amount)<=0)return {available:false,reason:'Brak aktualnej ceny'};
  if(value.packageIssue)return {available:false,reason:'Długość rolki do potwierdzenia'};
  if(!['net','gross'].includes(value.taxBasis)||!value.currency)return {available:false,reason:'VAT i waluta do potwierdzenia'};
  if(!value.unit?.trim())return {available:false,reason:'Jednostka ceny do potwierdzenia'};
  const amount=new Intl.NumberFormat('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(value.amount));
  const packaging=value.packageLabel&&/^szt\.?$/.test(value.unit)?` (${value.packageLabel})`:'';
  return {available:true,label:mode==='wholesale'?'Cena hurtowa':'Cena detaliczna',value:`${amount} ${value.currency==='PLN'?'zł':value.currency} ${value.taxBasis==='net'?'netto':'brutto'} / ${value.unit}${packaging}`,updatedAt:value.updatedAt||''};
}
export function itemPresentation(item) {
  const display=normalizeDisplay(item.display),facts=productFacts(item),price=priceInfo(item,display.price);
  return {
    details:detailFields.filter(({key})=>key!=='energy'&&display[key]&&facts[key]).map(({key})=>facts[key]),
    energy:display.energy?facts.energy:null,
    price:price.available?price:null,
  };
}
