import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
let password='';for await(const chunk of process.stdin)password+=chunk;password=password.trimEnd();
if(!password)throw new Error('Pass password on stdin.');
const base=process.env.MAILE_TEST_URL||'http://127.0.0.1:4179/';
const groups=JSON.parse(await readFile('private/groups.json','utf8'));
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
const editor=page.locator('#email-editor'),groupRows=editor.locator('[data-offer-product^="group:"]');
const download=async(button,file)=>{const wait=page.waitForEvent('download');await page.locator(button).click();await(await wait).saveAs('test-results/'+file);return readFile('test-results/'+file,'utf8');};
try{
 await page.goto(base);await page.locator('#password').fill(password);await page.locator('#unlock-button').click();await page.locator('#workspace').waitFor({state:'visible'});password='';
 await page.locator('.template-item[data-id="grupy-asortymentowe"]').click();
 assert.equal(await groupRows.count(),groups.length);assert.equal(await editor.locator('img').count(),groups.length*5);assert.equal(await editor.locator('[data-product-price]').count(),0);
 assert.match(await page.locator('#subject-input').inputValue(),/głównych grup/);
 await page.waitForFunction(()=>[...document.querySelectorAll('#email-editor img')].every(i=>i.complete&&i.naturalWidth>0));
 await groupRows.first().screenshot({path:'test-results/group-card-desktop.png'});
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/groups-desktop.png'});
 for(const group of groups){const row=editor.locator(`[data-offer-product="${group.selectionId}"]`);assert.equal(await row.locator('img').count(),5);const links=await row.locator('a').evaluateAll(nodes=>nodes.map(n=>n.href));for(const entry of [group,...group.gallery])assert(links.includes(entry.url));}
 await page.locator('#copy-email').click();await page.locator('#toast').filter({hasText:'Mail skopiowany.'}).waitFor();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Zobacz całą grupę/);
 const html=await download('#download-html','groups-all.html');assert.equal((html.match(/<img /g)||[]).length,groups.length*5);assert(!html.includes('data-product-price'));assert(!html.includes('contenteditable'));
 await page.locator('#format-text').click();assert.equal(await editor.locator('img').count(),0);assert.equal(await groupRows.count(),groups.length);assert.doesNotMatch(await editor.innerText(),/Cena hurtowa|Cena detaliczna|Indeks handlowy|EAN:/);
 await page.locator('#open-groups').click();await page.locator('#groups-clear').click();for(const group of groups.slice(0,2))await page.locator(`#group-options input[value="${group.id}"]`).check();
 await page.locator('#apply-groups').click();await page.locator('#apply-offer').click();assert.equal(await groupRows.count(),2);assert.equal(await editor.locator('img').count(),10);assert.match(await page.locator('#subject-input').inputValue(),/Taśmy LED i Profile i listwy LED/);
 await download('#save-project','groups-roundtrip.json');await page.locator('#start-custom').click();await page.locator('#project-file').setInputFiles('test-results/groups-roundtrip.json');await page.locator('#toast').filter({hasText:'Wczytano ofertę.'}).waitFor();assert.equal(await groupRows.count(),2);assert.equal(await editor.locator('img').count(),10);
 await page.locator('#open-groups').click();await page.locator('#groups-select-all').click();await page.locator('#apply-groups').click();await page.locator('#apply-offer').click();assert.equal(await groupRows.count(),groups.length);
 await page.locator('.template-item[data-id="ogolny"]').click();const products=await page.locator('.selected-product').count();
 await page.locator('#offer-price-mode').selectOption('none');await page.locator('#apply-offer').click();assert.equal(await editor.locator('[data-product-price]').count(),0);assert.equal(await editor.locator('[data-offer-product]').count(),products);assert.doesNotMatch(await editor.innerText(),/cena jednostkowa|Ceny według cennika|Cena hurtowa|Cena detaliczna/);
 await page.locator('#copy-email').click();await page.locator('#toast').filter({hasText:'Mail skopiowany.'}).waitFor();
 await page.locator('#open-catalog').click();const extra=page.locator('.catalog-card:not(.selected)').first();await extra.getByRole('button',{name:'+ Dodaj do maila',exact:true}).click();await page.locator('#catalog-done').click();assert.equal(await page.locator('#offer-price-mode').inputValue(),'none');await page.locator('#apply-offer').click();assert.equal(await editor.locator('[data-product-price]').count(),0);await page.locator('.selected-product').last().getByRole('button',{name:/^Usuń:/}).click();await page.locator('#apply-offer').click();
 await page.locator('#offer-price-mode').selectOption('retail');await page.locator('#apply-offer').click();assert.equal(await editor.locator('[data-product-price]').count(),products);
 const first=page.locator('.selected-product').first();await first.locator('summary').click();await first.locator('.product-price-mode').selectOption('none');assert.equal(await page.locator('#offer-price-mode').inputValue(),'mixed');await page.locator('#apply-offer').click();assert.equal(await editor.locator('[data-product-price]').count(),products-1);
 await page.locator('#open-groups').click();await page.locator(`#group-options input[value="${groups[0].id}"]`).check();await page.locator('#apply-groups').click();await page.locator('#apply-offer').click();assert.equal(await groupRows.count(),1);assert.equal(await editor.locator('[data-product-price]').count(),products-1);assert.equal(await page.locator('#offer-price-mode').inputValue(),'mixed');
 await download('#save-project','groups-mixed.json');await page.locator('#project-file').setInputFiles('test-results/groups-mixed.json');await page.locator('#toast').filter({hasText:'Wczytano ofertę.'}).waitFor();assert.equal(await groupRows.count(),1);assert.equal(await editor.locator('[data-product-price]').count(),products-1);
 await page.locator('#copy-email').click();await page.locator('#toast').filter({hasText:'Mail skopiowany.'}).waitFor();
 for(const width of [1920,768,390,320]){
  await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`page overflow ${width}`);
  await page.locator('#open-groups').click();assert(await page.locator('#groups-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`dialog overflow ${width}`);
  if(width===390)await page.screenshot({path:'test-results/groups-dialog-mobile.png'});
  await page.locator('#close-groups').click();
  if(width===390)await groupRows.first().screenshot({path:'test-results/group-card-mobile.png'});
 }
 await page.locator('#lock-button').click();assert.equal(await page.locator('#group-options').textContent(),'');assert(await page.locator('#groups-dialog').isHidden());assert.deepEqual(errors,[]);
 console.log('PASS: group all/subset/mixed offers, 5 linked original photos, no-price/global/individual settings, copy/HTML, draft roundtrip, responsive320 and lock.');
}finally{await browser.close();}
