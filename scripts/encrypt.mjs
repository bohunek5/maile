import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {preparePricedCatalog,resolvePresetItem} from '../priced-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let password = '';
for await (const chunk of process.stdin) password += chunk.toString();
password = password.replace(/\r?\n$/, '');
if (password.length < 10) throw new Error('Provide the password on stdin (at least 10 characters).');
const data = JSON.parse(await readFile(path.join(root, 'private/library.json'), 'utf8'));
if (data.schemaVersion !== 1 || data.templates.length !== 10) throw new Error('Expected 10 templates.');
data.catalog = JSON.parse(await readFile(path.join(root, 'private/catalog.json'), 'utf8'));
data.sales = JSON.parse(await readFile(path.join(root, 'private/sales.json'), 'utf8'));
data.groups = JSON.parse(await readFile(path.join(root, 'private/groups.json'), 'utf8'));
if(!data.groups.length||new Set(data.groups.map(group=>group.id)).size!==data.groups.length)throw new Error('Expected unique assortment groups.');
for(const group of data.groups){
  if(group.kind!=='group'||!group.name||group.gallery?.length!==4)throw new Error(`Incomplete group ${group.id}`);
  for(const entry of [group,...group.gallery]){
    if(!entry.url.startsWith('https://www.prescot.pl/katalog/'))throw new Error(`Invalid catalogue link in group ${group.id}`);
    if(!entry.image.startsWith('assets/'))throw new Error(`Expected original local photo in group ${group.id}`);
    await readFile(path.join(root,entry.image));
  }
}
data.prices = JSON.parse(await readFile(path.join(root, 'private/prices.json'), 'utf8'));
const priceSettings=JSON.parse(await readFile(path.join(root, 'private/prices-settings.json'), 'utf8'));
for(const key of ['wholesale','retail']){
  const settings=priceSettings[key];
  if(!['net','gross'].includes(settings?.taxBasis)||settings.currency!=='PLN')throw new Error('Confirm each feed currency and tax basis in private/prices-settings.json.');
  Object.assign(data.prices.feeds[key],settings,{basisSource:'owner-confirmed'});
}
if (!data.catalog.products?.length) throw new Error('The catalogue is empty.');
const pricedCatalog=preparePricedCatalog(data.catalog.products,data.prices,data.featured);
for(const template of data.templates){
  if(!template.items.length)throw new Error(`Template ${template.id} has no products.`);
  for(const reference of template.items)if(!resolvePresetItem(reference,pricedCatalog))throw new Error(`Template ${template.id} contains an unpriced or unresolved product.`);
}
const salt = randomBytes(16), iv = randomBytes(12), iterations = 600000;
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
password = '';
const cipher = createCipheriv('aes-256-gcm', key, iv);
cipher.setAAD(Buffer.from('prescot-mail-library-v1'));
const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()]);
key.fill(0);
await writeFile(path.join(root, 'library.enc.json'), JSON.stringify({version:1, algorithm:'AES-GCM', iterations, salt:salt.toString('base64'), iv:iv.toString('base64'), data:encrypted.toString('base64')}));
console.log(`Encrypted 10 product templates, ${data.groups.length} assortment groups and ${data.catalog.products.length} catalogue entries. No password was written to disk.`);
