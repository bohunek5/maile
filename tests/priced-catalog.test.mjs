import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePricedCatalog,resolvePresetItem} from '../priced-catalog.js';
import {catalogItem,composeOffer,makeOfferState} from '../offer.js?v=6';
import {hasPrice,priceInfo} from '../product-details.js?v=6';
import {renderEmail} from '../email.js?v=6';

// Synthetic product identities and amounts, unrelated to the private feeds.
const price = (changes={}) => ({amount:'12.34',unit:'szt.',taxBasis:'unknown',currency:null,...changes});
const product = (id,changes={}) => ({id,sku:`SKU-${id}`,kind:'product',name:`Produkt ${id}`,category:'test',categoryLabel:'Test',summary:'Opis produktu',warranty:'3 lata',specs:{EAN:`EAN-${id}`},url:`https://example.test/${id}`,image:'',...changes});
const family = (variants,changes={}) => product('family',{kind:'family',variants,...changes});
const pricing = (bySku,changes={}) => ({updatedAt:'2026-01-01T00:00:00Z',feeds:{wholesale:{taxBasis:'net',currency:'PLN'},retail:{taxBasis:'net',currency:'PLN'}},identities:{},bySku,...changes});
const sales = {segments:{general:{opening:'Treść ogólna.',cta:'Proszę o odpowiedź.',subject:'Oferta'}},stages:{first:{}},goals:{}};

test('catalog excludes missing, zero, incomplete and conflicted prices',()=>{
  const products=['valid','missing','zero','unit','package'].map(id=>product(id));
  const prepared=preparePricedCatalog(products,pricing({
    'SKU-valid':{wholesale:price()},'SKU-zero':{wholesale:price({amount:'0'})},
    'SKU-unit':{wholesale:price({unit:''})},'SKU-package':{wholesale:price({packageIssue:'Conflicting package lengths'})},
  }));
  assert.deepEqual(prepared.map(p=>p.id),['valid']);
  assert.equal(prepared[0].prices.wholesale.taxBasis,'net');
  assert.equal(prepared[0].prices.wholesale.currency,'PLN');
  assert.equal(prepared[0].prices.wholesale.amount,'12.34');
});

test('unknown commercial settings do not make a price usable',()=>{
  const result=preparePricedCatalog([product('one')],pricing({'SKU-one':{wholesale:price()}},{feeds:{wholesale:{taxBasis:'unknown',currency:null},retail:{taxBasis:'unknown',currency:null}}}));
  assert.deepEqual(result,[]);
});

test('retail-only item stays usable and explicitly selects its available feed',()=>{
  const [record]=preparePricedCatalog([product('one')],pricing({'SKU-one':{retail:price()}}));
  const item=catalogItem(record);
  assert.equal(item.display.price,'retail');
  assert.equal(priceInfo(item,'retail').available,true);
  assert.equal(priceInfo(item,'wholesale').available,false);
});

test('family variants must have their own exact SKU price; parent price is never inherited',()=>{
  const source=family([
    {sku:'V-good',name:'Wariant dobry',ean:'EAN-good'},
    {sku:'V-missing',name:'Wariant bez ceny'},
    {name:'Wariant bez SKU'},
    {sku:'V-conflict',name:'Wariant ze sprzeczną jednostką'},
  ]);
  const [record]=preparePricedCatalog([source],pricing({
    'SKU-family':{wholesale:price()},'V-good':{wholesale:price()},
    'V-conflict':{wholesale:price({packageIssue:'Conflict'})},
  }));
  assert.deepEqual(record.variants.map(v=>v.sku),['V-good']);
  assert.equal(hasPrice(catalogItem(record)),false);
  assert.equal(hasPrice(catalogItem(record,record.variants[0])),true);
});

test('families without a priced exact variant are removed',()=>{
  const source=family([{sku:'V-missing',name:'Wariant'}]);
  assert.deepEqual(preparePricedCatalog([source],pricing({'SKU-family':{wholesale:price()}})),[]);
});

test('featured priority orders products and the default variant without mutating the source',()=>{
  const sources=[product('other'),family([{sku:'V-first',name:'Pierwszy'},{sku:'V-featured',name:'Polecany'}]),product('featured')];
  const data=pricing(Object.fromEntries(['SKU-other','SKU-featured','V-first','V-featured'].map(sku=>[sku,{wholesale:price()}])));
  const prepared=preparePricedCatalog(sources,data,['featured','family::V-featured']);
  assert.deepEqual(prepared.map(p=>p.id),['featured','family','other']);
  assert.deepEqual(prepared[1].variants.map(v=>v.sku),['V-featured','V-first']);
  assert.equal(sources[0].prices,undefined);
  assert.deepEqual(sources[1].variants.map(v=>v.sku),['V-first','V-featured']);
});

test('preset resolves an exact variant and retains verified commercial identity',()=>{
  const data=pricing({'V-one':{wholesale:price()}},{identities:{'V-one':{tradeIndex:'TRADE-ONE',ean:'EAN-ONE'}}});
  const prepared=preparePricedCatalog([family([{sku:'V-one',name:'Wariant'}])],data);
  const item=resolvePresetItem({catalogId:'family',variantSku:'V-one',name:'Nazwa w mailu',description:'Opis w mailu',display:{price:'none',warranty:false}},prepared);
  assert.equal(item.selectionId,'family::V-one');
  assert.equal(item.tradeIndex,'TRADE-ONE');
  assert.equal(item.ean,'EAN-ONE');
  assert.equal(item.display.price,'wholesale');
  assert.equal(item.price.available,true);
  assert.equal(item.name,'Nazwa w mailu');
  assert.equal(item.description,'Opis w mailu');
  assert.deepEqual(item.details,[]);
});

test('generic old category and unresolved family references resolve to no product',()=>{
  const prepared=preparePricedCatalog([product('one'),family([{sku:'V-one',name:'Wariant'}])],pricing({'SKU-one':{wholesale:price()},'V-one':{wholesale:price()}}));
  assert.equal(resolvePresetItem({name:'Taśmy LED',url:'https://example.test/category'},prepared),null);
  assert.equal(resolvePresetItem({catalogId:'family'},prepared),null);
  assert.equal(resolvePresetItem({catalogId:'family',variantSku:'NOT-IN-CATALOG'},prepared),null);
  assert.equal(resolvePresetItem({catalogId:'missing',url:prepared[0].url},prepared),null);
});

test('compose and both email formats contain only priced concrete selections',()=>{
  const prepared=preparePricedCatalog([product('one')],pricing({'SKU-one':{wholesale:price()}}));
  const item=resolvePresetItem({catalogId:'one'},prepared);
  const template={id:'preset',subject:'Oferta',intro:['Wybrane produkty.'],closing:['Proszę o odpowiedź.'],links:[],items:[item]};
  const state=makeOfferState(template);
  state.items.push({...catalogItem(product('missing')),reason:''});
  const model=composeOffer(template,state,sales);
  assert.equal(model.items.length,1);
  for(const mode of ['text','visual']){
    const html=renderEmail({...model,items:[...model.items,{...state.items[1],price:null}]},mode);
    assert.equal((html.match(/data-offer-product=/g)||[]).length,1);
    assert.equal((html.match(/data-product-price=/g)||[]).length,1);
    assert(!html.includes('Produkt missing'));
    assert(html.includes('Cena hurtowa'));
  }
});
