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
const { identities } = JSON.parse(await readFile('private/prices.json', 'utf8'));
const product = products.find(item => item.kind === 'product' && item.sku && item.specs?.EAN && item.image && item.warranty && identities[item.sku]?.tradeIndex && identities[item.sku].tradeIndex !== item.sku);
const family = products.find(item => item.kind === 'family' && item.image && item.variants?.some(variant => variant.ean && identities[variant.sku]?.tradeIndex && identities[variant.sku].tradeIndex !== variant.sku));
const variant = family?.variants.find(item => item.ean && identities[item.sku]?.tradeIndex && identities[item.sku].tradeIndex !== item.sku);
const temporary = products.find(item => item.kind === 'product' && item.sku && item.id !== product?.id);
assert(product && family && variant && temporary, 'Local catalog needs models and a family with an EAN variant.');
const productIdentity = identities[product.sku];
const variantIdentity = identities[variant.sku];
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
  for (const id of ['customer-type', 'customer-context', 'message-stage', 'mail-goal', 'next-step']) {
    assert.equal(await page.locator(`#${id}`).count(), 0, 'The duplicate conversation form was removed.');
  }
  assert.equal(await page.locator('.product-reason').count(), 0);

  await page.locator('#start-custom').click();
  const firstCustomId = await page.locator('.template-item.active').getAttribute('data-id');
  assert.equal(await selected.count(), 0);

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
  assert.match(await page.locator('#builder-status').innerText(), /czekają/);
  assert.equal(await page.locator('.product-reason').count(), 0);

  await selectedRow(selectedVariantId).getByRole('button', { name: /^Przenieś wyżej:/ }).click();
  await selectedRow(temporary.id).getByRole('button', { name: /^Usuń:/ }).click();
  assert.deepEqual(await selectionIds(), [selectedVariantId, product.id]);
  assert((await selectedRow(product.id).innerText()).includes(productIdentity.tradeIndex));
  assert((await selectedRow(selectedVariantId).innerText()).includes(variantIdentity.ean));
  await page.locator('#apply-offer').click();
  await page.locator('#format-text').click();
  let body = await editor.innerText();
  for (const identity of [productIdentity, variantIdentity]) {
    assert(body.includes(`Indeks handlowy: ${identity.tradeIndex}`));
    assert(body.includes(`EAN: ${identity.ean}`));
  }
  assert(!body.includes(product.sku), 'Manufacturer SKU is not labelled or displayed as the trade index.');
  assert(!body.includes(variant.sku), 'Exact variant uses its ERP trade index in the outgoing email.');
  assert(body.indexOf(variantIdentity.tradeIndex) < body.indexOf(productIdentity.tradeIndex), 'Product ordering follows the chosen order.');
  assert.equal(await editor.locator('img').count(), 0);
  assert.equal(await page.locator('#builder-status').evaluate(node => node.classList.contains('pending')), false);
  assert.match(await page.locator('#mail-length').innerText(), /\d+ słów/);
  const links = await editor.locator('a').evaluateAll(nodes => nodes.map(node => node.href));
  assert(links.includes(product.url));
  assert(links.includes(family.url));

  await page.locator('#format-visual').click();
  assert.equal(await editor.locator('img').count(), 2);
  await readyImages();
  assert((await editor.innerText()).includes(`Indeks handlowy: ${productIdentity.tradeIndex}`));
  assert((await editor.innerText()).includes(`EAN: ${variantIdentity.ean}`));
  await page.screenshot({ path: path.join(artifacts, 'builder-desktop.png'), fullPage: true });

  await page.locator('#format-text').click();
  const manual = 'Dodatkowe ustalenie wpisane ręcznie do wiadomości.';
  await appendEdit(manual);
  const productDetails = selectedRow(product.id).locator('.product-details');
  await productDetails.locator('summary').click();
  const warrantyToggle = productDetails.locator('input[data-field="warranty"]');
  assert(await warrantyToggle.isChecked());
  await warrantyToggle.uncheck();
  await page.locator('#apply-offer').click();
  await page.locator('#overwrite-dialog').waitFor({ state: 'visible' });
  await page.locator('#cancel-overwrite').click();
  assert((await editor.innerText()).includes(manual));
  assert.match(await page.locator('#builder-status').innerText(), /czekają/);
  await page.locator('#apply-offer').click();
  await page.locator('#confirm-overwrite').click();
  assert(!(await editor.innerText()).includes(manual));
  assert(!(await warrantyToggle.isChecked()));
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
  assert.equal(project.config.customerType, 'general');
  assert.equal(project.config.goal, 'auto');
  assert.equal(project.config.context, '');
  assert.deepEqual(project.items.map(item => item.selectionId), [selectedVariantId, product.id]);
  assert.equal(project.items[1].display.warranty, false);
  assert.equal(project.subject, savedSubject);
  assert.equal(project.manual, true);
  assert.equal(project.subjectOverride, true);

  await page.locator('#start-custom').click();
  const secondCustomId = await page.locator('.template-item.active').getAttribute('data-id');
  assert.notEqual(secondCustomId, firstCustomId);
  assert.equal(await selected.count(), 0);
  await page.locator('#project-file').setInputFiles(projectPath);
  await page.locator('#toast').filter({ hasText: 'Wczytano ofertę.' }).waitFor();
  assert.equal(await editor.innerText(), savedText);
  assert.equal(await page.locator('#subject-input').inputValue(), savedSubject);
  assert.deepEqual(await selectionIds(), [selectedVariantId, product.id]);
  assert(!(await selectedRow(product.id).locator('input[data-field="warranty"]').isChecked()));
  assert.equal(await page.locator('.product-reason').count(), 0);
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
  assert.equal(await editor.locator('img').count(), 0);
  assert(!(await editor.innerText()).includes(textEdit));
  await page.locator('#apply-offer').click();
  assert.match(await editor.innerText(), /Dzień dobry/);
  assert.equal(await selected.count(), 0);

  await page.locator('#lock-button').click();
  assert(await page.locator('#workspace').isHidden());
  for (const id of ['email-editor', 'selected-products', 'catalog-results', 'template-list']) assert.equal(await page.locator(`#${id}`).textContent(), '');
  for (const id of ['password', 'conversation-note', 'project-file']) assert.equal(await page.locator(`#${id}`).inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.reload();
  assert(await page.locator('#workspace').isHidden());
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, 'builder-result.json'), JSON.stringify({
    passed: true, catalogSearch: ['SKU', 'EAN', 'variant EAN'], products: 2,
    reorderAndRemove: true, tradeIndexAndEan: true, removedDuplicateFields: true, textAndPhoto: true,
    overwriteGuard: true, jsonRoundtrip: true, linkedJpegExport: true,
    mobileWidth: 320, independentOffers: true, messageWithoutProducts: true, lockCleanup: true,
  }, null, 2));
  console.log('PASS: builder catalog, SKU/EAN variants, trade indexes, selection/reorder/remove, text/photos, warranty-toggle manual-edit guard, JSON roundtrip, linked JPEG export, 320px layout, fresh offers, empty assortment, lock cleanup.');
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'builder-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
