import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Pass the password on stdin, e.g. from an interactive getpass prompt.
// Catalog fixtures stay local; this test never stores credentials.
let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, '');
if (!password) throw new Error('Provide the test password on stdin.');

const base = process.env.MAILE_TEST_URL || 'http://127.0.0.1:4179/';
const { products } = JSON.parse(await readFile('private/catalog.json', 'utf8'));
const product = products.find(item => item.kind === 'product' && item.sku && item.specs?.EAN && item.image);
const family = products.find(item => item.kind === 'family' && item.image && item.variants?.some(variant => variant.ean));
const variant = family?.variants.find(item => item.ean);
const temporary = products.find(item => item.kind === 'product' && item.sku && item.id !== product?.id);
assert(product && family && variant && temporary, 'Local catalog needs models and a family with an EAN variant.');
const selectedVariantId = `${family.id}::${variant.sku}`;
const artifacts = 'test-results';
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(15000);
const editor = page.locator('#email-editor');
const selected = page.locator('.selected-product');
const selectionIds = () => selected.evaluateAll(nodes => nodes.map(node => node.dataset.selectionId));
// Product identifiers are read from the catalog and passed as exact attribute values.
const catalogCard = id => page.locator(`.catalog-card[data-id=${JSON.stringify(id)}]`);
const selectedRow = id => page.locator(`.selected-product[data-selection-id=${JSON.stringify(id)}]`);
const appendEdit = text => editor.evaluate((node, value) => {
  const paragraph = document.createElement('p'); paragraph.textContent = value;
  node.append(paragraph); node.dispatchEvent(new Event('input', { bubbles: true }));
}, text);
const downloadFile = async (button, name) => {
  const pending = page.waitForEvent('download'); await page.locator(button).click();
  const download = await pending; const destination = path.join(artifacts, name);
  await download.saveAs(destination); return destination;
};
const readyImages = async () => {
  const pictures = editor.locator('img');
  for (let index = 0; index < await pictures.count(); index++) await pictures.nth(index).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('#email-editor img')].every(image => image.complete && image.naturalWidth > 0));
};

try {
  if (base.includes('127.0.0.1')) {
    await page.route('https://bohunek5.github.io/maile/assets/products/*', route => route.fulfill({
      path: path.resolve('assets/products', route.request().url().split('/').pop()), contentType: 'image/jpeg',
    }));
  }
  await page.goto(base);
  await page.locator('#password').fill(password);
  await page.locator('#unlock-button').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
  password = '';
  assert.equal(await page.locator('#password').inputValue(), '');

  await page.locator('#start-custom').click();
  const firstCustomId = await page.locator('.template-item.active').getAttribute('data-id');
  assert.equal(await selected.count(), 0);
  await page.locator('#customer-type').selectOption('installer');
  await page.locator('#customer-context').fill('Rozmawialiśmy o podświetleniu trzech wnęk w nowym biurze.');
  await page.locator('#mail-goal').selectOption('quote');
  assert.match(await page.locator('#builder-status').innerText(), /czekają/);

  await page.locator('#open-catalog').click();
  await page.locator('#catalog-search').fill(product.sku);
  await catalogCard(product.id).waitFor();
  assert.equal(await catalogCard(product.id).locator('h3').textContent(), product.name);
  await page.locator('#catalog-search').fill(product.specs.EAN);
  await catalogCard(product.id).waitFor();
  await catalogCard(product.id).locator('button').click();
  assert.equal(await catalogCard(product.id).locator('button').getAttribute('aria-pressed'), 'true');

  await page.locator('#catalog-search').fill(variant.ean);
  await catalogCard(family.id).waitFor();
  assert.equal(await catalogCard(family.id).locator('.catalog-variant').inputValue(), variant.sku, 'EAN search selects the matching variant.');
  await catalogCard(family.id).locator('button').click();
  await page.locator('#catalog-search').fill(temporary.sku);
  await catalogCard(temporary.id).locator('button').click();
  await page.locator('#catalog-done').click();
  assert.equal(await selected.count(), 3);

  const rationale = 'Ten wariant odpowiada ustalonej barwie światła we wnękach.';
  await selectedRow(product.id).locator('.product-reason').fill(rationale);
  await selectedRow(selectedVariantId).getByRole('button', { name: /^Przenieś wyżej:/ }).click();
  await selectedRow(temporary.id).getByRole('button', { name: /^Usuń:/ }).click();
  assert.deepEqual(await selectionIds(), [selectedVariantId, product.id]);
  assert.equal(await selectedRow(product.id).locator('.product-reason').inputValue(), rationale);
  await page.locator('#apply-offer').click();
  await page.locator('#format-text').click();
  let body = await editor.innerText();
  assert.match(body, /podświetleniu trzech wnęk/);
  assert(body.includes(variant.sku));
  assert(body.includes(rationale));
  assert(body.indexOf(variant.sku) < body.indexOf(product.sku), 'Product ordering follows the chosen order.');
  assert.equal(await editor.locator('img').count(), 0);
  assert.equal(await page.locator('#builder-status').evaluate(node => node.classList.contains('pending')), false);
  assert.match(await page.locator('#mail-length').innerText(), /\d+ słów/);
  const links = await editor.locator('a').evaluateAll(nodes => nodes.map(node => node.href));
  assert(links.includes(product.url));
  assert(links.includes(family.url));

  await page.locator('#format-visual').click();
  assert.equal(await editor.locator('img').count(), 2);
  await readyImages();
  assert((await editor.innerText()).includes(rationale));
  assert.match(await editor.innerText(), /podświetleniu trzech wnęk/);
  await page.screenshot({ path: path.join(artifacts, 'builder-desktop.png'), fullPage: true });

  await page.locator('#format-text').click();
  const manual = 'Dodatkowe ustalenie wpisane ręcznie do wiadomości.';
  await appendEdit(manual);
  const revisedContext = 'Rozmawialiśmy o podświetleniu czterech wnęk w nowym biurze.';
  await page.locator('#customer-context').fill(revisedContext);
  await page.locator('#apply-offer').click();
  await page.locator('#overwrite-dialog').waitFor({ state: 'visible' });
  await page.locator('#cancel-overwrite').click();
  assert((await editor.innerText()).includes(manual));
  assert(!(await editor.innerText()).includes(revisedContext));
  await page.locator('#apply-offer').click();
  await page.locator('#confirm-overwrite').click();
  assert(!(await editor.innerText()).includes(manual));
  assert((await editor.innerText()).includes(revisedContext));
  assert(await page.locator('#overwrite-dialog').isHidden());

  const visualEdit = 'Dopisek dla wersji ze zdjęciami.';
  const textEdit = 'Dopisek dla wersji tekstowej.';
  await page.locator('#format-visual').click(); await appendEdit(visualEdit);
  const savedVisual = await editor.innerText();
  await page.locator('#format-text').click(); await appendEdit(textEdit);
  await page.locator('#subject-input').fill('Robocza oferta — test zachowania zmian');
  const savedText = await editor.innerText();
  const savedSubject = await page.locator('#subject-input').inputValue();
  const projectPath = await downloadFile('#save-project', 'builder-roundtrip.json');
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  assert.equal(project.type, 'prescot-offer');
  assert.equal(project.config.customerType, 'installer');
  assert.equal(project.config.goal, 'quote');
  assert.equal(project.config.context, revisedContext);
  assert.deepEqual(project.items.map(item => item.selectionId), [selectedVariantId, product.id]);
  assert.equal(project.items[1].reason, rationale);
  assert.equal(project.subject, savedSubject);
  assert.equal(project.manual, true);
  assert.equal(project.subjectOverride, true);

  await page.locator('#start-custom').click();
  const secondCustomId = await page.locator('.template-item.active').getAttribute('data-id');
  assert.notEqual(secondCustomId, firstCustomId);
  assert.equal(await selected.count(), 0);
  assert.equal(await page.locator('#customer-context').inputValue(), '');
  assert.equal(await page.locator('#customer-type').inputValue(), 'general');
  await page.locator('#project-file').setInputFiles(projectPath);
  await page.locator('#toast').filter({ hasText: 'Wczytano ofertę.' }).waitFor();
  assert.equal(await editor.innerText(), savedText);
  assert.equal(await page.locator('#subject-input').inputValue(), savedSubject);
  assert.equal(await page.locator('#customer-context').inputValue(), revisedContext);
  assert.equal(await page.locator('#customer-type').inputValue(), 'installer');
  assert.equal(await page.locator('#mail-goal').inputValue(), 'quote');
  assert.deepEqual(await selectionIds(), [selectedVariantId, product.id]);
  assert.equal(await selectedRow(product.id).locator('.product-reason').inputValue(), rationale);
  await page.locator('#format-visual').click();
  assert.equal(await editor.innerText(), savedVisual);
  await readyImages();

  const exportPath = await downloadFile('#download-html', 'builder-export.html');
  const exported = await readFile(exportPath, 'utf8');
  const exportedImages = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return [...document.querySelectorAll('img')].map(image => ({ src: image.getAttribute('src'), link: image.closest('a')?.getAttribute('href') }));
  }, exported);
  assert.equal(exportedImages.length, 2);
  assert(exportedImages.every(image => /^https?:\/\/.+\.jpe?g(?:\?.*)?$/i.test(image.src)));
  assert.deepEqual(new Set(exportedImages.map(image => image.link)), new Set([product.url, family.url]));
  assert(!exported.includes('contenteditable'));
  assert(!/Hubert|609 438|hasło dostępu/i.test(exported));

  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator('#open-catalog').click();
  await page.locator('#catalog-clear').click();
  await page.locator('.catalog-card').first().waitFor();
  const dimensions = await page.evaluate(() => {
    const dialog = document.querySelector('#catalog-dialog');
    const scroller = document.querySelector('.catalog-scroll');
    return {
      pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
      dialogWidth: dialog.scrollWidth, dialogClient: dialog.clientWidth,
      listWidth: scroller.scrollWidth, listClient: scroller.clientWidth,
    };
  });
  assert(dimensions.pageWidth <= dimensions.viewport, JSON.stringify(dimensions));
  assert(dimensions.dialogWidth <= dimensions.dialogClient + 1, JSON.stringify(dimensions));
  assert(dimensions.listWidth <= dimensions.listClient + 1, JSON.stringify(dimensions));
  await page.screenshot({ path: path.join(artifacts, 'builder-mobile-catalog-320.png') });
  await page.locator('#catalog-search').fill(variant.ean);
  await catalogCard(family.id).waitFor();
  assert.equal(await catalogCard(family.id).locator('button').getAttribute('aria-pressed'), 'true');
  await page.locator('#catalog-done').click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(artifacts, 'builder-mobile-320.png'), fullPage: true });

  await page.locator('#start-custom').click();
  const freshId = await page.locator('.template-item.active').getAttribute('data-id');
  assert(![firstCustomId, secondCustomId].includes(freshId));
  assert.equal(await selected.count(), 0);
  assert.equal(await page.locator('#customer-context').inputValue(), '');
  assert.equal(await page.locator('#next-step').inputValue(), '');
  assert.equal(await page.locator('#mail-goal').inputValue(), 'auto');
  assert.equal(await editor.locator('img').count(), 0);
  assert(!(await editor.innerText()).includes(revisedContext));
  assert(!(await editor.innerText()).includes(textEdit));
  await page.locator('#message-stage').selectOption('followup');
  await page.locator('#next-step').fill('Czy omówimy propozycję w środę o 11:00?');
  await page.locator('#apply-offer').click();
  assert.match(await editor.innerText(), /Czy omówimy propozycję w środę o 11:00\?/);
  assert.equal(await selected.count(), 0);

  await page.locator('#lock-button').click();
  assert(await page.locator('#workspace').isHidden());
  for (const id of ['email-editor', 'selected-products', 'catalog-results', 'template-list']) assert.equal(await page.locator(`#${id}`).textContent(), '');
  for (const id of ['password', 'customer-context', 'next-step', 'project-file']) assert.equal(await page.locator(`#${id}`).inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.reload();
  assert(await page.locator('#workspace').isHidden());
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'builder-result.json'), JSON.stringify({
    passed: true, catalogSearch: ['SKU', 'EAN', 'variant EAN'], products: 2,
    reorderAndRemove: true, customReasons: true, textAndPhoto: true,
    overwriteGuard: true, jsonRoundtrip: true, linkedJpegExport: true,
    mobileWidth: 320, independentOffers: true, followupWithoutProducts: true, lockCleanup: true,
  }, null, 2));
  console.log('PASS: builder catalog, SKU/EAN variants, selection/reorder/remove, personalized text/photos, manual-edit guard, JSON roundtrip, linked JPEG export, 320px layout, fresh offers, follow-up, lock cleanup.');
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'builder-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
