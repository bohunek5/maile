import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { renderEmail } from '../email.js';

// Neutral fixtures only: no customer data, commercial prices or product assets.
const group={
  kind:'group',id:'profiles',selectionId:'group:profiles',name:'Profile do mebli',
  description:'Wybierz wykończenie i sposób montażu do swojej realizacji.',
  url:'https://example.com/catalog?group=profiles',image:'https://example.com/group.jpg',
  gallery:Array.from({length:4},(_,index)=>({image:`https://example.com/photo-${index}.jpg`,name:`Przykład ${index+1}`,url:`https://example.com/catalog#example-${index}`})),
  display:{price:'none'},
};
const priced={
  kind:'product',id:'neutral-product',selectionId:'product:neutral',name:'Produkt testowy',
  description:'Opis produktu testowego.',url:'https://example.com/catalog#neutral',
  image:'https://example.com/product.jpg',display:{price:'wholesale'},
  technical:'Indeks handlowy: TEST-001',details:[{label:'Gwarancja',value:'2 lata'}],
  price:{available:true,label:'Cena hurtowa',value:'10,00 zł netto / szt.',updatedAt:'2026-01-15'},
};
const unpriced={...priced,id:'without-price',selectionId:'product:without-price',name:'Produkt bez ceny',display:{price:'none'}};
const template=items=>({subject:'Propozycje po rozmowie',intro:['Dziękuję za rozmowę.'],closing:['Która grupa Państwa interesuje?'],items,links:[]});

test('text group email contains one category description and CTA without gallery products or prices',()=>{
  const item={...group,technical:'EAN: 9999999999999',details:[{label:'Moc',value:'99 W'}],price:priced.price,energy:{value:'A',image:'https://example.com/energy.png'}};
  const html=renderEmail(template([item]),'text');
  assert.match(html,/data-offer-product="group:profiles"/);
  assert.match(html,/Profile do mebli/);
  assert.match(html,/Zobacz całą grupę/);
  assert.match(html,/href="https:\/\/example\.com\/catalog\?group=profiles"/);
  assert.doesNotMatch(html,/<img|Przykład [1-4]|EAN:|Moc:|energetyczna|data-product-price|Cena hurtowa|Ceny według/);
});

test('visual groups use one main image and four linked examples, without per-product information',()=>{
  const html=renderEmail(template([group]),'visual');
  assert.equal((html.match(/<img /g)||[]).length,5);
  const widths=[...html.matchAll(/<img[^>]* width="(\d+)"/g)].map(match=>Number(match[1]));
  assert.equal(widths.length,5);assert(widths[0]>widths[1]);assert(widths.slice(1).every(width=>width===widths[1]&&width>0));
  assert.match(html,/Przykłady z tej grupy/);
  assert.match(html,/Zobacz całą grupę/);
  for(const entry of group.gallery)assert.ok(html.includes(`href="${entry.url}"`));
  assert.doesNotMatch(html,/data-product-price|Cena hurtowa|Ceny według/);
});

test('mixed emails retain groups and explicitly unpriced products while excluding unavailable selected prices',()=>{
  const unavailable={...priced,id:'unavailable',selectionId:'unavailable',name:'Niepotwierdzona cena',price:{available:false}};
  for(const mode of ['text','visual']){
    const html=renderEmail(template([group,priced,unpriced,unavailable]),mode);
    assert.equal((html.match(/data-offer-product=/g)||[]).length,3);
    assert.equal((html.match(/data-product-price=/g)||[]).length,1);
    assert.match(html,/Produkt bez ceny/);
    assert.doesNotMatch(html,/Niepotwierdzona cena/);
    assert.match(html,/Ceny według cennika/);
    assert.doesNotMatch(renderEmail(template([unpriced]),mode),/data-product-price|Ceny według cennika/);
  }
});

test('group content and image attributes are escaped without changing the input selection',()=>{
  const item={...group,name:'Profile <b>"jasne"</b>',description:'Montaż & dobór',gallery:group.gallery.map(entry=>({...entry,name:'" onerror="bad()'}))};
  const before=structuredClone(item),html=renderEmail(template([item]),'visual');
  assert.match(html,/Profile &lt;b&gt;&quot;jasne&quot;&lt;\/b&gt;/);
  assert.match(html,/Montaż &amp; dobór/);
  assert.doesNotMatch(html,/alt="" onerror=/);
  assert.deepEqual(item,before);
});

test('browser validates mixed prices, sanitization and a five-image card at 320 px',async t=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:900}});
    const source=await readFile(new URL('../email.js',import.meta.url),'utf8');
    const moduleUrl=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    await page.route('https://example.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#f0f2f3"/></svg>'}));

    await t.test('all selected rows survive cleaning; no-price rows do not require price elements',async()=>{
      const result=await page.evaluate(async({moduleUrl,group,priced,unpriced})=>{
        const email=await import(moduleUrl),items=[group,priced,unpriced];
        return ['text','visual'].map(mode=>{
          const html=email.renderEmail({intro:[],closing:[],items},mode),clean=email.cleanEmail(html);
          return {raw:email.emailHasPrices(html,items),clean:email.emailHasPrices(clean,items),text:email.emailText(clean)};
        });
      },{moduleUrl,group,priced,unpriced});
      for(const value of result){assert.equal(value.raw,true);assert.equal(value.clean,true);assert.match(value.text,/Zobacz całą grupę/);assert.doesNotMatch(value.text,/Przykład [1-4]/);}
    });

    await t.test('deleting or altering an expected price, row or identity blocks copying',async()=>{
      const result=await page.evaluate(async({moduleUrl,group,priced,unpriced})=>{
        const email=await import(moduleUrl),items=[group,priced,unpriced];
        const fresh=()=>new DOMParser().parseFromString(email.renderEmail({intro:[],closing:[],items},'visual'),'text/html');
        const run=change=>{const doc=fresh();change(doc);return email.emailHasPrices(doc.body.innerHTML,items);};
        return {
          deletedPrice:run(doc=>doc.querySelector('[data-product-price]').remove()),
          alteredPrice:run(doc=>doc.querySelector('[data-product-price]').textContent='Cena hurtowa: 1,00 zł netto / szt.'),
          duplicatePrice:run(doc=>{const price=doc.querySelector('[data-product-price]');price.after(price.cloneNode(true));}),
          missingGroup:run(doc=>doc.querySelector('[data-offer-product="group:profiles"]').remove()),
          changedIdentity:run(doc=>doc.querySelector('[data-offer-product="group:profiles"]').dataset.offerProduct='group:other'),
          extraPriceInGroup:run(doc=>doc.querySelector('[data-offer-product="group:profiles"] td').append(doc.querySelector('[data-product-price]').cloneNode(true))),
          expectedPriceNowMissing:email.emailHasPrices(email.renderEmail({intro:[],closing:[],items:[unpriced]}),[{...unpriced,display:{price:'wholesale'}}]),
          duplicateExpectedIdentity:email.emailHasPrices(email.renderEmail({intro:[],closing:[],items:[group,unpriced]}),[group,group]),
        };
      },{moduleUrl,group,priced,unpriced});
      for(const [scenario,accepted] of Object.entries(result))assert.equal(accepted,false,scenario);
    });

    await t.test('sanitized exported card fits 320 px and places thumbnails in two rows',async()=>{
      const html=await page.evaluate(async({moduleUrl,group,priced})=>{
        const email=await import(moduleUrl);
        return email.htmlDocument('Grupa i produkt',email.renderEmail({intro:[],closing:[],items:[group,priced]},'visual'));
      },{moduleUrl,group,priced});
      await page.setContent(html,{waitUntil:'load'});
      const result=await page.evaluate(()=>{
        const card=document.querySelector('[data-offer-product="group:profiles"]'),images=[...card.querySelectorAll('img')];
        return {width:innerWidth,scroll:document.documentElement.scrollWidth,images:images.map(image=>{const box=image.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,right:box.right,loaded:image.naturalWidth>0};})};
      });
      assert.ok(result.scroll<=result.width,JSON.stringify(result));
      assert.equal(result.images.length,5);
      assert.ok(result.images.every(image=>image.loaded&&image.right<=320));
      const [main,a,b,c,d]=result.images;
      assert.ok(main.width>a.width);
      assert.ok(a.y>main.y&&c.y>a.y);
      assert.equal(a.y,b.y);assert.equal(c.y,d.y);
      assert.ok(b.x>a.x&&d.x>c.x);
    });
  }finally{await browser.close();}
});
