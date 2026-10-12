import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendProducts } from '../recommend.js';

function strip(id, overrides = {}) {
  return { id, sku: id, name: `Taśma LED ${id}`, category: 'tasmy', family: id, warranty: '5 lat', ...overrides,
    specs: { 'Zasilanie DC': '24 V', 'Moc': '9,6 W/m', 'Barwa światła': '3000 K', 'Typ diody': 'COB', 'Sterowanie': 'MONO', 'Stopień ochrony': 'IP20', 'Szerokość PCB': '8 mm', ...overrides.specs } };
}
function supply(id, watts, voltage = 24, overrides = {}) {
  return { id, sku: id, name: `Zasilacz LED ${id}`, category: 'zasilanie-sterowanie', warranty: '7 lat', ...overrides,
    specs: { 'Napięcie wyjściowe': `${voltage} V DC`, 'Napięcie wejściowe': '230 V AC', 'Moc znamionowa': `${watts} W`, 'Stopień ochrony': 'IP67', ...overrides.specs } };
}
function controller(id, mode = 'MONO', amps = 12) {
  return { id, sku: id, name: `Zestaw PR Touch ${mode}`, category: 'zasilanie-sterowanie', specs: { 'Funkcja': mode, 'Napięcie DC': '5–24 V', 'Obciążenie łączne': `maks. ${amps} A`, 'Obciążenie kanału': `maks. ${amps} A` } };
}
const products = [
  strip('COB-WARM-24'),
  strip('COB-HIGH-24', { specs: { 'Moc': '20 W/m' } }),
  strip('COB-WARM-12', { specs: { 'Zasilanie DC': '12 V' } }),
  strip('SMD-NEUTRAL-24', { specs: { 'Typ diody': 'SMD2835', 'Barwa światła': '4000 K' } }),
  strip('COB-WARM-48', { specs: { 'Zasilanie DC': '48 V' } }),
  supply('PSU-60-24', 60), supply('PSU-72-24', 72), supply('PSU-150-24', 150), supply('PSU-200-24', 200), supply('PSU-100-12', 100, 12),
  controller('CTRL-MONO-12A'), controller('CTRL-RGB-12A', 'RGB'), controller('CTRL-WEAK-1A', 'MONO', 1),
  { id: 'PROFILE-WIDE', sku: 'FAMILY-001', name: 'Profil z kanałem 11 mm', category: 'profile', kind: 'family', specs: { 'Szerokość kanału LED': '11 mm', 'Szerokość profilu': '16 mm', 'Montaż': 'Nawierzchniowy' }, variants: [{ sku: 'VARIANT-SILVER-2M', name: 'Profil srebrny 2 m', specs: { 'Długość nominalna': '2000 mm' } }] },
  { id: 'PROFILE-NARROW', name: 'Profil szeroki z wąskim kanałem', category: 'profile', specs: { 'Szerokość kanału LED': '6 mm', 'Szerokość profilu': '30 mm', 'Montaż': 'Nawierzchniowy' } },
  { id: 'CONNECTOR-MONO', name: 'Złączka SMD/COB', category: 'akcesoria', specs: { 'Typ taśmy': 'SMD/COB · MONO', 'Szerokość taśmy': '8/10 mm' } },
  { id: 'CONNECTOR-RGB', name: 'Złączka RGB', category: 'akcesoria', specs: { 'Typ taśmy': 'SMD/COB · RGB', 'Szerokość taśmy': '8/10 mm' } },
];
const group = (r, key) => r.groups.find(g => g.key === key)?.products || [];
const ids = (r, key) => group(r, key).map(p => p.id);

test('matches all explicit strip parameters and explains catalogue facts', () => {
  const r = recommendProducts('Do kuchni 6 m taśmy COB 24 V 3000 K 9,6 W/m IP20 5 lat', products);
  assert.deepEqual(ids(r, 'strips'), ['COB-WARM-24']);
  assert.equal(r.customerType, 'furniture');
  assert.deepEqual(r.calculation, { lengthMeters: 6, wattsPerMeter: 9.6, loadWatts: 57.6, reservePercent: 20, minimumSupplyWatts: 72, voltage: 24, stripId: 'COB-WARM-24' });
  assert.ok(group(r, 'strips')[0].reasons.includes('9,6 W/m'));
});

test('counts repeated segments, and only supplies meeting output voltage and reserve', () => {
  const r = recommendProducts('COB 24V 3000K 9,6W/m 2 odcinki po 3 m i zasilacz', products);
  assert.equal(r.calculation.lengthMeters, 6);
  assert.equal(r.calculation.minimumSupplyWatts, 72);
  assert.deepEqual(ids(r, 'supplies'), ['PSU-72-24', 'PSU-150-24', 'PSU-200-24']);
  assert.ok(!ids(r, 'supplies').some(id => id.startsWith('CTRL')));
});

test('an alternate matching strip recomputes supply sizing', () => {
  const r = recommendProducts('COB 24V 3000K 6 m i zasilacz', products, { stripId: 'COB-HIGH-24', reservePercent: 25 });
  assert.equal(r.calculation.stripId, 'COB-HIGH-24');
  assert.equal(r.calculation.loadWatts, 120);
  assert.equal(r.calculation.minimumSupplyWatts, 160);
  assert.deepEqual(ids(r, 'supplies'), ['PSU-200-24']);
  const refused = recommendProducts('COB 24V 3000K 6 m', products, { stripId: 'COB-WARM-12' });
  assert.notEqual(refused.calculation.stripId, 'COB-WARM-12');
});

test('Polish decimal lengths and multiplication are numerical, not substring guesses', () => {
  const r = recommendProducts('COB 24V 3000K 9,6W/m 2 x 2,5 m', products);
  assert.equal(r.calculation.lengthMeters, 5);
  assert.equal(r.calculation.loadWatts, 48);
  assert.equal(r.calculation.minimumSupplyWatts, 60);
});

test('ambiguous and contradictory lengths never size a supply', () => {
  for (const note of ['3–5 m', '3 m oraz 5 m', '2 odcinki po 3 m łącznie 8 m', 'dwa odcinki po 3 m']) {
    const r = recommendProducts(`COB 24V 3000K ${note}`, products);
    assert.equal(r.calculation, undefined);
    assert.ok(r.questions.some(q => /długo|metr|zakres/.test(q)));
    assert.deepEqual(ids(r, 'supplies'), []);
  }
});

test('unexpected explicit voltages and zero power are not silently discarded', () => {
  assert.deepEqual(ids(recommendProducts('COB 36V ciepła', products), 'strips'), []);
  assert.deepEqual(recommendProducts('COB 24V 0W/m', products).groups, []);
  assert.equal(recommendProducts('COB-WARM-24 2 odc. po 3 mb', products).calculation.lengthMeters, 6);
});

test('contradictory voltage or colour blocks proposals instead of guessing', () => {
  for (const note of ['COB 12V lub 24V 3000K', 'COB 24V 3000K albo 4000K']) {
    const r = recommendProducts(note, products);
    assert.deepEqual(r.groups, []);
    assert.ok(r.questions.some(q => /Doprecyzuj/.test(q)));
  }
});

test('negation and named neutral colour retain only positive requested technology', () => {
  const r = recommendProducts('Nie COB tylko SMD, 24V, neutralna, 5 lat', products);
  assert.deepEqual(ids(r, 'strips'), ['SMD-NEUTRAL-24']);
  assert.ok(!r.questions.some(q => /Technologia|technologia/.test(q)));
});

test('AC input is never matched as supply output and IP is respected', () => {
  const source = [...products, supply('IP20-SUPPLY', 72, 24, { specs: { 'Stopień ochrony': 'IP20' } })];
  assert.deepEqual(ids(recommendProducts('Zasilacz 24 V 72 W IP67', source), 'supplies'), ['PSU-72-24']);
  assert.deepEqual(ids(recommendProducts('Zasilacz 230 V 72 W', source), 'supplies'), []);
});

test('autodetection 12/24 V is a set, not a continuous voltage range', () => {
  const auto = { id: 'AUTO-100', name: 'Zasilacz auto', category: 'zasilanie-sterowanie', specs: { 'Wyjście DC': '12 / 24 V — autodetekcja', 'Moc': '100 W', 'Wejście AC': '180–265 V' } };
  assert.deepEqual(ids(recommendProducts('Zasilacz 12V 100W', [auto]), 'supplies'), ['AUTO-100']);
  assert.deepEqual(ids(recommendProducts('Zasilacz 48V 100W', [auto]), 'supplies'), []);
});

test('controllers require correct channel type and adequate known current', () => {
  const r = recommendProducts('COB 24V 3000K 9,6W/m 6 m i ściemniacz', products);
  assert.deepEqual(ids(r, 'controllers'), ['CTRL-MONO-12A']);
});

test('digital strips never produce an analogue controller suggestion', () => {
  const source = [strip('DIGITAL-001', { family: 'COB Digital', specs: { 'Układ sterujący': 'IC2811' } }), ...products.filter(p => p.category !== 'tasmy')];
  const r = recommendProducts('DIGITAL-001 3 m i sterownik', source);
  assert.deepEqual(ids(r, 'strips'), ['DIGITAL-001']);
  assert.deepEqual(ids(r, 'controllers'), []);
  assert.ok(r.questions.some(q => /cyfrowa/.test(q)));
});

test('profile sizing uses LED channel, and connectors use width plus channel type', () => {
  const r = recommendProducts('COB 24V 3000K 9,6W/m, profil nawierzchniowy i złączki', products);
  assert.deepEqual(ids(r, 'profiles'), ['PROFILE-WIDE']);
  assert.deepEqual(ids(r, 'connectors'), ['CONNECTOR-MONO']);
});

test('exact variant references survive as product id plus variant SKU', () => {
  const r = recommendProducts('Klient prosi o VARIANT-SILVER-2M', products);
  assert.deepEqual(group(r, 'profiles').map(({ id, variantSku }) => ({ id, variantSku })), [{ id: 'PROFILE-WIDE', variantSku: 'VARIANT-SILVER-2M' }]);
});

test('an exact variant uses its own warranty before the family warranty', () => {
  const source = [strip('STRIP-FAMILY', { warranty: '7 lat', variants: [{ sku: 'STRIP-VARIANT-5Y', name: 'Wariant taśmy', specs: { Gwarancja: '5 lat' } }] })];
  const r = recommendProducts('STRIP-VARIANT-5Y, 5 lat', source);
  assert.equal(group(r, 'strips')[0]?.variantSku, 'STRIP-VARIANT-5Y');
  assert.ok(group(r, 'strips')[0].reasons.includes('Gwarancja 5 lat'));
});

test('SKU symbols do not become false technology or channel constraints', () => {
  const source = [strip('SERIES-RGB', { specs: { Sterowanie: 'RGB' } }), strip('SERIES-RGB+WW', { specs: { Sterowanie: 'RGBW' } })];
  const r = recommendProducts('SERIES-RGB+WW', source);
  assert.deepEqual(ids(r, 'strips'), ['SERIES-RGB+WW']);
  assert.deepEqual(ids(recommendProducts('SERIES-RGB+WW, ale napięcie 12V', source), 'strips'), []);
});

test('unrecognized notes and missing sizing facts ask useful questions', () => {
  const empty = recommendProducts('Miła rozmowa, klient chce ofertę, zadzwonić we wtorek.', products);
  assert.deepEqual(empty.groups, []);
  assert.ok(empty.questions.length);
  const insufficient = recommendProducts('Zasilacz do sklepu', products);
  assert.deepEqual(insufficient.groups, []);
  assert.ok(insufficient.questions.some(q => /napięcie/.test(q)));
  assert.ok(insufficient.questions.some(q => /moc/i.test(q)));
});

test('no catalogue prices means no invented cheapest recommendation', () => {
  const r = recommendProducts('Najtańsza taśma COB 24V ciepła, budżet ważny', products);
  assert.ok(r.questions.some(q => /nie zawiera cen/.test(q)));
  assert.ok(group(r, 'strips').every(p => p.reasons.every(reason => !/najta|cena/.test(reason))));
});

test('wet or outdoor application needs an explicit protection requirement', () => {
  for (const place of ['na zewnątrz', 'na dworze', 'deszcz', 'mokra wnęka', 'łazienka']) {
    const r = recommendProducts(`COB 24V ciepła, ${place}`, products);
    assert.deepEqual(r.groups, []);
    assert.ok(r.questions.some(q => /stopień IP/.test(q)));
  }
  const withIp = recommendProducts('COB 24V ciepła, na zewnątrz, IP67', [strip('STRIP-IP67', { specs: { 'Stopień ochrony': 'IP67' } })]);
  assert.deepEqual(ids(withIp, 'strips'), ['STRIP-IP67']);
  for (const note of ['na zewnątrz IP20', 'kontakt z deszczem IP30', 'mokra wnęka IP40']) {
    const r = recommendProducts(`COB 24V ciepła ${note}`, products);
    assert.deepEqual(r.groups, []);
    assert.ok(r.questions.some(q => /Potwierdź warunki/.test(q)));
  }
});

test('furniture suggestions prefer IP20 transparently without assuming dry conditions', () => {
  const source = [strip('SEALED-FIRST', { specs: { 'Stopień ochrony': 'IP67' } }), strip('INDOOR-SECOND')];
  const r = recommendProducts('Do mebli COB 24V 3000K 6m', source);
  assert.equal(group(r, 'strips')[0].id, 'INDOOR-SECOND');
  assert.equal(r.calculation.stripId, 'INDOOR-SECOND');
  assert.ok(group(r, 'strips')[0].reasons.some(reason => /suchego wnętrza/.test(reason)));
  assert.ok(r.questions.some(question => /suchym miejscu/.test(question)));
  assert.deepEqual(ids(recommendProducts('Do mebli COB 24V 3000K IP67', source), 'strips'), ['SEALED-FIRST']);
});

test('profile lookup can use documented LED bonding width', () => {
  const source = [...products.filter(p => p.category !== 'profile'), { id: 'PROFILE-BOND', name: 'Profil', category: 'profile', specs: { 'Szerokość klejenia LED A': '10 mm', 'Szerokość profilu': '20 mm' } }];
  const r = recommendProducts('Stolarz: COB 24V 3000K, profil', source);
  assert.equal(r.customerType, 'furniture');
  assert.deepEqual(ids(r, 'profiles'), ['PROFILE-BOND']);
});

test('missing power and unsupported voltage leave calculation or supply unresolved', () => {
  const missing = strip('NO-POWER-001', { specs: { 'Moc': '' } });
  const r = recommendProducts('NO-POWER-001 4m i zasilacz', [missing, ...products]);
  assert.equal(r.calculation, undefined);
  assert.ok(r.questions.some(q => /potwierdzonej mocy/.test(q)));
  const fortyEight = recommendProducts('COB 48V 3000K 4m i zasilacz', products);
  assert.equal(fortyEight.calculation.voltage, 48);
  assert.deepEqual(ids(fortyEight, 'supplies'), []);
});

test('invalid reserve cannot create infinite or negative results', () => {
  for (const reservePercent of [100, -10, NaN, Infinity]) {
    const r = recommendProducts('COB-WARM-24 6m', products, { reservePercent });
    assert.equal(r.calculation.reservePercent, 20);
    assert.equal(r.calculation.minimumSupplyWatts, 72);
  }
});

test('catalogue and options are not mutated', () => {
  const before = structuredClone(products), options = { reservePercent: 20 };
  recommendProducts('COB 24V 3000K 3m, profil i sterownik', products, options);
  assert.deepEqual(products, before);
  assert.deepEqual(options, { reservePercent: 20 });
});

test('strict bounds and unsupported parameter ranges are not treated as exact values', () => {
  for (const note of ['COB 24V 3000K ponad 9,6 W/m', 'COB 24V 3000K 9,6–20 W/m', 'taśma COB 12–24 V']) {
    const result=recommendProducts(note,products);
    assert.deepEqual(result.groups,[]);
    assert.ok(result.questions.some(q=>/zakres lub granicę/.test(q)));
  }
});

test('uppercase Polish characters are normalized in accessory requests', () => {
  const result=recommendProducts('TAŚMA COB 24V 3000K I ZŁĄCZKI',products);
  assert.deepEqual(ids(result,'connectors'),['CONNECTOR-MONO']);
});
