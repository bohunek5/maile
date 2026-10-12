import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogItem, composeOffer, defaultContext, makeOfferState,
  normalizeContext, offerChecks, searchProducts, technicalLine, warrantyLabel,
} from '../offer.js';

// Neutral fixtures: no customer data, private messages or commercial terms.
const products = [
  {
    id: 'strip-a', name: 'Taśma Łąka SMD', sku: 'TEST-SMD-24',
    category: 'strips', categoryLabel: 'Taśmy LED', kind: 'product', family: 'Łąka',
    summary: 'Ciepła biel do oświetlenia półek.', warranty: '84 miesiące',
    url: 'https://example.com/catalog#strip-a', image: 'https://example.com/strip-a.jpg',
    specs: { 'Zasilanie DC': '24 V', 'Moc': '8 W/m', 'Barwa światła': '3000 K' },
  },
  {
    id: 'strip-b', name: 'Taśma Brzoza COB', sku: 'TEST-COB-12',
    category: 'strips', categoryLabel: 'Taśmy LED', kind: 'product',
    summary: 'Linia światła.', warranty: '5 lat',
    url: 'https://example.com/catalog#strip-b',
    specs: { 'Napięcie DC': '12 V DC', 'Moc': '6 W/m' },
  },
  {
    id: 'power-a', name: 'Zasilacz Źródło', sku: 'TEST-PSU-24',
    category: 'power', categoryLabel: 'Zasilacze', kind: 'product',
    summary: 'Zasilacz stałonapięciowy.', warranty: '3 lata',
    url: 'https://example.com/catalog#power-a',
    specs: { 'Napięcie wyjściowe': '24 V DC', 'Moc znamionowa': '60 W' },
  },
  {
    id: 'profile-family', name: 'Profil Żuraw', sku: '',
    category: 'profiles', categoryLabel: 'Profile', kind: 'family',
    summary: 'Profil do zabudowy.', warranty: '',
    url: 'https://example.com/catalog#profile-family',
    specs: { 'Materiał': 'Aluminium' },
    variants: [
      { sku: 'TEST-PROF-1', name: 'Biały 1 m', ean: '0000000000001', specs: { 'Długość': '1 m' } },
      { sku: 'TEST-PROF-2', name: 'Czarny 2 m', ean: '0000000000002', specs: { 'Długość': '2 m' } },
    ],
  },
];

const testPrices={wholesale:{amount:'10.00',currency:'PLN',taxBasis:'net',unit:'szt.'}};
for(const p of products){if(p.kind!=='family')p.prices=testPrices;for(const v of p.variants??[])v.prices=testPrices;}

const sales = {
  segments: {
    general: { subject: 'Propozycje produktów', opening: 'Dziękuję za rozmowę.', cta: 'Które produkty są potrzebne?' },
    installer: { subject: 'Produkty do instalacji', opening: 'Przesyłam produkty do planowanej instalacji.', cta: 'Jakie długości odcinków przewidujesz?' },
    furniture: { subject: 'Produkty do mebli', opening: 'Przesyłam propozycje do zabudowy meblowej.', cta: 'Jaka jest szerokość miejsca montażu?' },
  },
  stages: {
    first: { subject: '', opening: 'Pierwszy kontakt.' },
    offer: { subject: 'Pytanie o przesłaną ofertę', opening: 'Wracam do przesłanej oferty.' },
    followup: { subject: 'Czy temat pozostaje aktualny?', opening: 'Wracam do naszej wiadomości.' },
  },
  goals: {
    quote: { text: 'Jakie ilości przygotować do wyceny?' },
    selection: { text: 'Którą propozycję wybierasz?' },
    samples: { text: 'Które próbki przygotować?' },
    meeting: { text: 'Jaki termin rozmowy pasuje?' },
    b2b: { text: 'Czy chcesz rozpocząć współpracę?' },
  },
  b2b: { label: 'Formularz współpracy', url: 'https://example.com/b2b' },
};

const template = {
  id: 'neutral-template', title: 'Neutralny wzór', subject: 'Stary temat',
  intro: ['Stary wstęp'], closing: ['Stare zakończenie'],
  links: [{ label: 'Stary link', url: 'https://example.com/old' }],
  items: [catalogItem(products[0])],
};
const stateFor = (items = [catalogItem(products[0])], config = {}) => ({
  config: { ...defaultContext(), ...config }, items, dirty: false, generated: false,
});
const ids = results => results.map(product => product.id);

test('catalog search combines words, ignores Polish diacritics and finds symbols and variant EANs', async t => {
  const cases = [
    ['TASMA LAKA', ['strip-a']],
    ['półek 24', ['strip-a']],
    ['zrodlo stalONAPIECIOWY', ['power-a']],
    ['TEST-COB-12', ['strip-b']],
    ['zuraw bialy', ['profile-family']],
    ['TEST-PROF-2', ['profile-family']],
    ['0000000000001', ['profile-family']],
    ['  taśma   COB  ', ['strip-b']],
    ['COB 24', []],
  ];
  for (const [query, expected] of cases) {
    await t.test(query, () => assert.deepEqual(ids(searchProducts(products, { query })), expected));
  }
});

test('category and warranty filters intersect with search and convert months to years', () => {
  assert.equal(searchProducts(products).length, 4);
  assert.deepEqual(ids(searchProducts(products, { category: 'strips', warranty: '7' })), ['strip-a']);
  assert.deepEqual(ids(searchProducts(products, { query: 'taśma', warranty: '5' })), ['strip-b']);
  assert.deepEqual(ids(searchProducts(products, { category: 'power', warranty: '3' })), ['power-a']);
  assert.deepEqual(searchProducts(products, { category: 'profiles', warranty: '7' }), []);
  assert.deepEqual(searchProducts(products, { query: 'TEST-PSU-24', category: 'strips' }), []);
  assert.deepEqual(searchProducts(products, { warranty: '2' }), []);
  assert.equal(products[0].warranty, '84 miesiące');
});

test('precomputed catalog search text supports the same normalized queries', () => {
  const indexed = [{ ...products[0], searchText: 'tasma laka test-smd-24 ciepla biel 24 v 3000 k' }];
  assert.deepEqual(ids(searchProducts(indexed, { query: 'ŁĄKA 3000 K' })), ['strip-a']);
});

test('warranty filtering finds a family when the guarantee is specified only on a variant', () => {
  const family = {
    ...products[3], warranty: '',
    variants: products[3].variants.map(variant => ({ ...variant, specs: { ...variant.specs, Gwarancja: '24 miesiące' } })),
  };
  assert.deepEqual(ids(searchProducts([family], { warranty: '2', category: 'profiles' })), [family.id]);
  assert.deepEqual(searchProducts([family], { warranty: '7' }), []);
});

test('different variants have stable selection identities and retain their catalog destination', () => {
  const family = products[3];
  const first = catalogItem(family, family.variants[0]);
  const second = catalogItem(family, family.variants[1]);
  assert.notEqual(first.selectionId, second.selectionId);
  assert.notEqual(first.selectionId, catalogItem(family).selectionId);
  assert.equal(first.selectionId, catalogItem(family, family.variants[0]).selectionId);
  assert.equal(first.sku, 'TEST-PROF-1');
  assert.equal(first.variantSku, 'TEST-PROF-1');
  assert.equal(first.kind, 'product');
  assert.match(first.name, /Biały 1 m/);
  assert.equal(first.url, family.url);
  assert.deepEqual(first.specs, { 'Materiał': 'Aluminium', 'Długość': '1 m' });
  assert.equal(second.specs['Długość'], '2 m');
  assert.deepEqual(family.specs, { 'Materiał': 'Aluminium' });
});

test('creating an offer isolates editable product data from the template', () => {
  const before = structuredClone(template);
  const state = makeOfferState(template);
  state.items[0].description = 'Opis dopasowany do klienta';
  state.items[0].specs.Moc = '99 W/m';
  state.config.context = 'Nowy kontekst';
  assert.deepEqual(template, before);
  assert.ok(state.items[0].selectionId);
  assert.equal(state.generated, false);
});

test('first-contact email uses the recipient segment, conversation context and one matching CTA', () => {
  const state = stateFor(undefined, { customerType: 'installer', context: '  Rozmawialiśmy o trzech wnękach.  ' });
  const before = structuredClone(state);
  const mail = composeOffer(template, state, sales);
  assert.equal(mail.subject, sales.segments.installer.subject);
  assert.deepEqual(mail.intro, [sales.segments.installer.opening, 'Rozmawialiśmy o trzech wnękach.']);
  assert.deepEqual(mail.closing, [sales.segments.installer.cta]);
  assert.deepEqual(mail.links, []);
  assert.deepEqual(state, before);
});

test('offer and follow-up stages change opening and subject while retaining recipient relevance', () => {
  for (const stage of ['offer', 'followup']) {
    const state = stateFor(undefined, { stage, customerType: 'furniture', context: 'Temat: podświetlenie szaf.' });
    const mail = composeOffer(template, state, sales);
    assert.equal(mail.subject, sales.stages[stage].subject);
    assert.equal(mail.intro[0], sales.stages[stage].opening);
    assert.equal(mail.intro[1], 'Temat: podświetlenie szaf.');
    assert.deepEqual(mail.closing, [sales.segments.furniture.cta]);
    assert.ok(!mail.intro.includes(sales.segments.furniture.opening));
  }
});

test('explicit goal replaces automatic CTA and custom next step takes precedence', () => {
  const state = stateFor(undefined, { customerType: 'installer', goal: 'samples' });
  assert.deepEqual(composeOffer(template, state, sales).closing, [sales.goals.samples.text]);
  state.config.nextStep = 'Czy omówimy próbki we wtorek o 10:00?';
  assert.deepEqual(composeOffer(template, state, sales).closing, [state.config.nextStep]);
});

test('B2B link is included only when B2B is the active next step', () => {
  const state = stateFor(undefined, { goal: 'b2b' });
  assert.deepEqual(composeOffer(template, state, sales).links, [sales.b2b]);
  state.config.nextStep = 'Proszę o ilości do wyceny.';
  const custom = composeOffer(template, state, sales);
  assert.deepEqual(custom.links, []);
  assert.deepEqual(custom.closing, ['Proszę o ilości do wyceny.']);
});

test('selected product order and individual rationale carry into the email without changing catalog data', () => {
  const first = catalogItem(products[2]);
  const second = catalogItem(products[0]);
  second.reason = 'Ciepła biel zgodna z ustaleniami z rozmowy.';
  const mail = composeOffer(template, stateFor([first, second]), sales);
  assert.deepEqual(mail.items.map(item => item.id), ['power-a', 'strip-a']);
  assert.equal(mail.items[0].description, products[2].summary);
  assert.equal(mail.items[1].description, second.reason);
  assert.equal(mail.items[1].url, products[0].url);
  assert.equal(mail.items[1].image, products[0].image);
  assert.equal(second.description, products[0].summary);
});

test('guarantees remain per product and absent guarantees are not invented', () => {
  const mail = composeOffer(template, stateFor(products.map(product => catalogItem(product,product.variants?.[0]))), sales);
  assert.deepEqual(mail.items.map(item => item.warranty), ['7 lat', '5 lat', '3 lata', '']);
  assert.ok(!mail.intro.concat(mail.closing).some(line => /gwarancj/i.test(line)));
  assert.equal(warrantyLabel('24 miesiące'), '2 lata');
  assert.equal(warrantyLabel(null), '');
});

test('a variant-specific guarantee overrides the family guarantee', () => {
  const family = { ...products[3], warranty: '5 lat' };
  const variant = { ...family.variants[0], specs: { ...family.variants[0].specs, Gwarancja: '24 miesiące' } };
  const item = catalogItem(family, variant);
  assert.equal(item.warranty, '2 lata');
  assert.equal(composeOffer(template, stateFor([item]), sales).items[0].warranty, '2 lata');
  assert.equal(catalogItem(family).warranty, '5 lat');
});

test('unresolved product families are excluded while priced variants remain', () => {
  const family = products[3];
  const unresolved = stateFor([catalogItem(family)]);
  const resolved = stateFor([catalogItem(family, family.variants[0])]);
  assert.deepEqual(composeOffer(template, unresolved, sales).items, []);
  assert.doesNotMatch(composeOffer(template, resolved, sales).items[0].name, /rodzina/);
  assert.ok(offerChecks(unresolved).some(check => /rodzina produktów/.test(check)));
  assert.ok(!offerChecks(resolved).some(check => /rodzina produktów/.test(check)));
});

test('technical summaries keep model, output voltage, power and light color without undefined placeholders', () => {
  assert.equal(technicalLine(catalogItem(products[0])), 'TEST-SMD-24 · 24 V · 8 W/m · 3000 K');
  assert.equal(technicalLine(catalogItem(products[2])), 'TEST-PSU-24 · 24 V DC · 60 W');
  assert.equal(technicalLine({ sku: '', specs: { 'Moc': '—' } }), '');
});

test('checks flag conflicting voltages and mixed guarantees without certifying a compatible set', () => {
  const state = stateFor([catalogItem(products[1]), catalogItem(products[2])], { context: 'Do jednej instalacji.' });
  const checks = offerChecks(state);
  assert.ok(checks.some(check => /12.*24.*V|24.*12.*V/.test(check)), checks.join('\n'));
  assert.ok(checks.some(check => /różne okresy gwarancji/.test(check)));
  const mail = composeOffer(template, state, sales);
  assert.doesNotMatch(JSON.stringify({ checks, mail }), /zestaw jest kompatybilny|gotowy zestaw|gwarantowana zgodność/i);
});

test('matching nominal voltage and a voltage range do not create generic warnings or certify compatibility', () => {
  const controller = {
    ...catalogItem(products[2]), id: 'controller', sku: 'TEST-CTRL',
    specs: { 'Zasilanie DC': '12–24 V DC' },
  };
  const checks = offerChecks(stateFor([catalogItem(products[0]), catalogItem(products[2]), controller], { context: 'Ustalenia z rozmowy.' }));
  assert.ok(!checks.some(check => /urządzenia o napięciu/.test(check)));
  assert.ok(!checks.some(check => /sprawdź moc.*zgodność sterowania/.test(check)));
  assert.ok(!checks.some(check => /zgodne urządzenia|kompatybilny zestaw|pełna kompatybilność/i.test(check)));
});

test('empty and overlong selections receive actionable checks instead of a score', () => {
  const empty = stateFor([], { stage: 'followup', context: 'W nawiązaniu do oferty.', nextStep: 'Czy temat jest aktualny?' });
  assert.ok(offerChecks(empty).some(check => /samą treść rozmowy i następny krok/.test(check)));
  assert.deepEqual(composeOffer(template, empty, sales).items, []);
  assert.deepEqual(composeOffer(template, empty, sales).closing, ['Czy temat jest aktualny?']);
  const items = Array.from({ length: 6 }, () => catalogItem(products[0]));
  const checks = offerChecks(stateFor(items));
  assert.ok(checks.some(check => /6 pozycji/.test(check)));
  assert.ok(checks.every(check => !/\d+\s*%/.test(check)));
});

test('imported context accepts supported choices and limits free text', () => {
  const accepted = normalizeContext({
    customerType: 'architect', stage: 'followup', goal: 'meeting', context: 'x'.repeat(700), nextStep: 'y'.repeat(300),
  });
  assert.equal(accepted.customerType, 'architect');
  assert.equal(accepted.stage, 'followup');
  assert.equal(accepted.goal, 'meeting');
  assert.equal(accepted.context.length, 600);
  assert.equal(accepted.nextStep.length, 200);
  assert.deepEqual(normalizeContext({ customerType: 'unknown', stage: 'unknown', goal: 'unknown' }), defaultContext());
});

test('changing visible data keeps template copy; changing assortment drops stale product-count promises',()=>{
  const initial=stateFor();initial.items[0].display={voltage:true,price:'wholesale'};
  assert.deepEqual(composeOffer(template,initial,sales).intro,template.intro);
  const changed=stateFor([catalogItem(products[2])]);
  assert.deepEqual(composeOffer(template,changed,sales).intro,[sales.segments.general.opening]);
});
