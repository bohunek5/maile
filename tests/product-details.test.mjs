import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDisplay,productFacts,itemPresentation,priceInfo,identificationLine} from '../product-details.js';
import {catalogItem,composeOffer,defaultContext} from '../offer.js';
import {renderEmail} from '../email.js';

const prices={wholesale:{amount:'10.20',currency:'PLN',taxBasis:'net',unit:'m'},retail:{amount:'15.90',currency:'PLN',taxBasis:'net',unit:'m'}};
const item={id:'test',name:'Test',sku:'TEST',kind:'product',url:'https://example.com/product',warranty:'5 lat',description:'Opis.',prices,specs:{'Zasilanie DC':'24 V','Moc':'8 W/m','Strumień świetlny':'900 lm/m','Klasa energetyczna':'F'}};
const template={subject:'Test',intro:[],closing:[],items:[item]};
const sales={segments:{general:{opening:'Dzień dobry',cta:'Jaka ilość?'}},stages:{first:{}}};
const emailItem=display=>composeOffer(template,{config:defaultContext(),items:[{...item,display,reason:''}]},sales).items[0];

test('field visibility affects both mail formats while defaults retain warranty and a wholesale price',()=>{
  const initial=emailItem();assert.deepEqual(initial.details,[{label:'Gwarancja',value:'5 lat'}]);assert.equal(initial.price.available,true);
  const chosen=emailItem({warranty:false,voltage:true,power:true,brightness:true,energy:true,price:'retail'});
  for(const mode of ['text','visual']){
    const html=renderEmail({...template,items:[chosen]},mode);
    assert.doesNotMatch(html,/Gwarancja/);
    assert.match(html,/Napięcie: 24 V/);assert.match(html,/Moc: 8 W\/m/);assert.match(html,/Strumień świetlny: 900 lm\/m/);
    assert.match(html,/Klasa energetyczna: F/);assert.match(html,/15,90 zł netto \/ m/);assert.doesNotMatch(html,/brutto/);
    if(mode==='visual')assert.match(html,/assets\/energy\/F\.png/);
  }
  const hidden=renderEmail({...template,items:[emailItem({warranty:false})]},'visual');
  assert.doesNotMatch(hidden,/Napięcie:|Moc:|Strumień|Klasa energetyczna|Gwarancja/);
});
test('power and flux keep channel meaning; supplies use output voltage',()=>{
  const facts=productFacts({specs:{'Napięcie wejściowe':'230 V AC','Napięcie wyjściowe':'24 V DC','Moc kanału białego':'6.4 W/m','Moc wszystkich kanałów':'25 W/m','Strumień kanału białego':'800 lm/m'}});
  assert.deepEqual(facts.voltage,{label:'Napięcie wyjściowe',value:'24 V DC'});
  assert.deepEqual(facts.power,{label:'Moc wszystkich kanałów',value:'25 W/m'});
  assert.deepEqual(facts.brightness,{label:'Strumień kanału białego',value:'800 lm/m'});
});
test('missing data and invalid or legacy energy classes are never invented',()=>{
  for(const cls of ['A+','A++','D–F','brak','',undefined])assert.equal(productFacts({specs:{'Klasa energetyczna':cls}}).energy,null);
  assert.equal(productFacts({specs:{'Klasa energetyczna':'e'}}).energy.value,'E');
  const model=itemPresentation({display:{voltage:true,power:true,energy:true},specs:{'Moc':'—'}});
  assert.deepEqual(model.details,[]);assert.equal(model.energy,null);
});
test('prices require positive amount, confirmed basis, currency and unit',()=>{
  for(const override of [{amount:0},{amount:'NaN'},{amount:-1},{currency:null},{taxBasis:'unknown'},{unit:null},{unit:''}]){
    assert.equal(priceInfo({...item,prices:{wholesale:{...prices.wholesale,...override}}},'wholesale').available,false);
  }
  assert.match(priceInfo(item,'wholesale').value,/10,20 zł netto \/ m/);
  assert.equal(priceInfo(item,'none').available,false);
  const roll={...item,prices:{wholesale:{...prices.wholesale,unit:'szt',packageLabel:'rolka 10 m'}}};
  assert.match(priceInfo(roll,'wholesale').value,/10,20 zł netto \/ szt \(rolka 10 m\)/);
  roll.prices.wholesale.unit='m';assert.doesNotMatch(priceInfo(roll,'wholesale').value,/rolka/);
  roll.prices.wholesale.amount='1.123456';assert.match(priceInfo(roll,'wholesale').value,/1,123456/);
});
test('family prices cannot leak onto an unpriced variant',()=>{
  const family={...item,kind:'family',variants:[{sku:'VAR-A',prices:{retail:{...prices.retail,unit:'szt.'}}},{sku:'VAR-B'}]};
  assert.equal(priceInfo(catalogItem(family),'retail').available,false);
  assert.match(priceInfo(catalogItem(family,family.variants[0]),'retail').value,/szt\./);
  assert.equal(priceInfo(catalogItem(family,family.variants[1]),'retail').available,false);
});
test('imported display configuration accepts only supported booleans and price modes',()=>{
  assert.deepEqual(normalizeDisplay({warranty:false,voltage:'true',energy:true,price:'attacker',amount:1}),{warranty:false,voltage:false,power:false,brightness:false,energy:true,price:'wholesale'});
  assert.equal(normalizeDisplay(null).price,'wholesale');
});
test('identification shows trade index and exact variant EAN, never a catalog SKU fallback',()=>{
  const product={...item,tradeIndex:'SALE-01',ean:'0000000000001'};
  assert.equal(identificationLine(catalogItem(product)),'Indeks handlowy: SALE-01 · EAN: 0000000000001');
  assert.equal(identificationLine(catalogItem(item)),'');
  const family={...product,kind:'family',variants:[{sku:'CAT-VAR',tradeIndex:'SALE-02',ean:'0000000000002'}]};
  assert.equal(identificationLine(catalogItem(family)),'');
  const variant=catalogItem(family,family.variants[0]);
  assert.equal(identificationLine(variant),'Indeks handlowy: SALE-02 · EAN: 0000000000002');
  assert(!variant.name.includes('CAT-VAR'));
});
