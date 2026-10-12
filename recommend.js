import {hasPrice} from './product-details.js?v=7';
/**
 * Local, deterministic catalogue matching for a salesperson's Polish call note.
 * Like prescotled/catalog-parameters.mjs, numerical facts come from labelled
 * fields: an AC input voltage must never stand in for a DC output voltage.
 * Scores order matching records; they are not probabilities of compatibility.
 */
const normal = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const number = value => Number(String(value).replace(',', '.'));
const fmt = value => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(value);
const unique = values => [...new Set(values)];
const round = value => Math.round(value * 1000) / 1000;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numeric = '\\d+(?:[.,]\\d+)?';
const field = (product, pattern) => Object.entries(product.specs || {}).filter(([label]) => pattern.test(normal(label))).map(([, value]) => String(value)).join('; ');
const numbers = value => [...String(value).matchAll(/\d+(?:[.,]\d+)?/g)].map(match => number(match[0]));
const one = value => { const found = numbers(value); return found.length === 1 ? found[0] : null; };
const years = value => { const n = one(value); return n === null ? null : /mies/i.test(value) ? n / 12 : n; };
const negated = (text, index) => /\b(?:nie(?:\s+(?:chce|chca|potrzebuje|potrzebuja|ma\s+byc))?|bez|zamiast)\s*$/.test(text.slice(Math.max(0, index - 35), index));
function matches(text, pattern) {
  return [...text.matchAll(pattern)].filter(match => !negated(text, match.index));
}
function channel(value) {
  const t = normal(value).replace(/\s|\+/g, '');
  return /rgbcct/.test(t) ? 'RGBCCT' : /rgbw/.test(t) ? 'RGBW' : /rgb/.test(t) ? 'RGB' : /cct/.test(t) ? 'CCT' : /mono/.test(t) ? 'MONO' : null;
}
function record(product, variant) {
  const p = variant ? { ...product, name: variant.name, sku: variant.sku, kind:'product',variantSku:variant.sku,prices:variant.prices,tradeIndex:variant.tradeIndex, ean:variant.ean, specs: { ...product.specs, ...variant.specs } } : product;
  const name = normal([p.name, p.family].join(' '));
  const strip = p.category === 'tasmy';
  const supply = /\bzasilacz\b/.test(name) && Boolean(field(p, /wyjscie dc|napiecie wyjsciowe/));
  const controller = !supply && p.category === 'zasilanie-sterowanie' && Boolean(field(p, /^funkcja$/));
  const voltageText = field(p, strip ? /^zasilanie dc$|^napiecie dc$/ : supply ? /^wyjscie dc$|^napiecie wyjsciowe$/ : /^napiecie dc$|^napiecie pracy$|^zasilanie$/);
  const powerText = field(p, strip ? /^moc$|^moc wszystkich kanalow$/ : /^moc$|^moc znamionowa$/);
  const technologyText = normal(field(p, /^typ diody$|^typ tasmy$/) || name);
  const mode = channel(field(p, /^sterowanie$|^funkcja$|^typ tasmy$/)) || (strip && /^\d+\s*k$/i.test(field(p, /^barwa swiatla$/)) ? 'MONO' : null);
  return {
    product: p, id: product.id, variantSku: variant?.sku, strip, supply, controller,
    key: strip ? 'strips' : supply ? 'supplies' : controller ? 'controllers' : p.category === 'profile' ? 'profiles' : p.category === 'akcesoria' && /zlaczk/.test(name) ? 'connectors' : 'other',
    voltage: numbers(voltageText), voltageText, voltageRange: /\d\s*[–—-]\s*\d/.test(voltageText),
    power: one(powerText), powerText,
    cct: numbers(field(p, /^barwa swiatla$|^temperatura barwowa$/)),
    cctText: field(p, /^barwa swiatla$|^temperatura barwowa$/),
    technology: /cob/.test(technologyText) ? 'COB' : /smd/.test(technologyText) ? 'SMD' : null,
    technologyText, mode,
    ip: field(p, /^stopien ochrony$|^ochrona$/).match(/IP\s*(\d{2})/i)?.[1] || null,
    warranty: years(variant?.specs?.Gwarancja || p.warranty || field(p, /^gwarancja$/)),
    width: one(field(p, strip ? /^szerokosc pcb$/ : /^szerokosc kanalu led$/) || (!strip ? field(p, /^szerokosc klejenia led a$/) : '')),
    connectorWidths: numbers(field(p, /^szerokosc tasmy$/)),
    digital: /digital|cyfrow/.test(name) || Boolean(field(p, /^uklad sterujacy$/)),
    channelAmps: one(field(p, /^obciazenie kanalu$/)),
    totalAmps: one(field(p, /^obciazenie laczne$/)),
    mount: field(p, /^montaz$/),
  };
}
function supportsVoltage(record, voltage) {
  return record.voltageRange ? record.voltage.length === 2 && voltage >= record.voltage[0] && voltage <= record.voltage[1] : record.voltage.includes(voltage);
}
function parseLength(text, questions) {
  const meterUnit = '(?:mb?\\b|metr(?:ow|y|a)?\\b)';
  const totals = [...text.matchAll(new RegExp(`(?:lacznie|razem|suma|w sumie)\\s*(?:ok\\.?\\s*)?(${numeric})\\s*${meterUnit}`, 'g'))].map(m => number(m[1]));
  const repeated = [...text.matchAll(new RegExp(`(\\d+)\\s*(?:(?:odcink(?:i|ow|a)?|odc\\.?|fragment(?:y|ow)?)\\s*po|[x×])\\s*(${numeric})\\s*${meterUnit}`, 'g'))];
  const values = [...text.matchAll(new RegExp(`(${numeric})\\s*${meterUnit}`, 'g'))].filter(m => !/w\s*\/\s*$/.test(text.slice(0, m.index)));
  const ambiguousRange = new RegExp(`${numeric}\\s*(?:[–—-]|do|lub|albo)\\s*${numeric}\\s*(?:m\\b|metr)`).test(text);
  const repeatedTotal = repeated.length === 1 ? number(repeated[0][1]) * number(repeated[0][2]) : null;
  if (unique(totals).length > 1 || (totals.length && repeatedTotal !== null && Math.abs(totals[0] - repeatedTotal) > 0.001)) {
    questions.push('Długości w opisie się różnią. Ile metrów taśmy ma zasilać jeden zasilacz?');
    return null;
  }
  if (totals.length) return totals[0] > 0 ? totals[0] : null;
  if (ambiguousRange) {
    questions.push('Podaj jedną długość do obliczenia mocy; w opisie jest zakres lub kilka alternatyw.');
    return null;
  }
  if (repeated.length === 1 && values.length === 1) return repeatedTotal > 0 ? round(repeatedTotal) : null;
  if (values.length && !repeated.length && /\b(?:odcinki|odcinkow|fragmenty|fragmentow|razy)\b/.test(text)) {
    questions.push('Podaj łączną długość taśmy na jednym zasilaczu lub zapisz liczbę odcinków, np. „2 odcinki po 3 m”.');
    return null;
  }
  if (values.length === 1) return number(values[0][1]) > 0 ? number(values[0][1]) : null;
  if (values.length > 1) questions.push('Ile metrów taśmy ma pracować łącznie na jednym zasilaczu? Podaj np. „łącznie 6 m”.');
  return null;
}
function parse(text, questions) {
  const t = normal(text).slice(0, 10000), criteria = [], result = { text: t, criteria, conflict: false };
  // Do not silently turn a strict bound or an unhandled range into an exact value.
  if (/(?:ponad|powyzej|wiecej niz|mniej niz|ponizej|[<>])\s*\d+(?:[.,]\d+)?\s*(?:w|v|k|mm|m)\b/.test(t) || /\d+(?:[.,]\d+)?\s*(?:–|—|-|do|lub|albo)\s*\d+(?:[.,]\d+)?\s*(?:w|v|k)\b/.test(t)) {
    questions.push('Podano zakres lub granicę parametru. Wskaż konkretny wariant albo jedną wartość do wstępnej propozycji.');
    result.conflict = true;
  }
  const add = (key, label, values, unit = '') => {
    const found = unique(values);
    if (found.length > 1) { questions.push(`Doprecyzuj ${label.toLowerCase()}: w opisie pojawia się ${found.join(' i ')}${unit}.`); result.conflict = true; }
    else if (found.length) { result[key] = found[0]; criteria.push({ label, value: `${found[0]}${unit}` }); }
  };
  add('technology', 'Technologia', matches(t, /\b(cob|smd)\b/g).map(m => m[1].toUpperCase()));
  result.excludedTechnology = unique([...t.matchAll(/\b(cob|smd)\b/g)].filter(m => negated(t, m.index)).map(m => m[1].toUpperCase()));
  add('voltage', 'Napięcie', matches(t, /\b(\d+(?:[.,]\d+)?)\s*v(?:\s*dc)?\b/g).map(m => number(m[1])), ' V');
  add('cct', 'Barwa', matches(t, /\b(\d{4})\s*k\b/g).map(m => Number(m[1])), ' K');
  add('ip', 'Ochrona', matches(t, /\bip\s*(\d{2})\b/g).map(m => m[1]));
  const protection = criteria.find(item => item.label === 'Ochrona');
  if (protection) protection.value = `IP${protection.value}`;
  const warrantyMatches = matches(t, /\b(2|3|5|7)\s*(?:lat|lata|letni[a-z]*)\b/g);
  add('warranty', 'Gwarancja', warrantyMatches.map(m => Number(m[1])), ' lat');
  result.warrantyMinimum = warrantyMatches.some(m => /(?:min(?:imum)?\.?|co najmniej)\s*$/.test(t.slice(0, m.index)));
  add('wattsPerMeter', 'Moc taśmy', matches(t, new RegExp(`(${numeric})\\s*w\\s*(?:/\\s*m\\b|na\\s*metr\\b)`, 'g')).map(m => number(m[1])), ' W/m');
  add('supplyWatts', 'Moc zasilacza', matches(t, new RegExp(`(${numeric})\\s*w\\b(?!\\s*(?:/|na\\s*metr))`, 'g')).map(m => number(m[1])), ' W');
  if (['wattsPerMeter', 'supplyWatts', 'voltage'].some(key => result[key] === 0)) { questions.push('Moc i napięcie muszą być większe od zera. Popraw podany parametr.'); result.conflict = true; }
  const modes = matches(t, /\b(rgb\s*\+?\s*cct|rgbw|rgb|cct|mono)\b/g).map(m => channel(m[1]));
  add('mode', 'Sterowanie', modes);
  const temperatures = [ [/\bciepl[a-z]*\b/g, 'warm', 'ciepła (2700–3500 K)'], [/\bneutraln[a-z]*\b/g, 'neutral', 'neutralna (3501–4500 K)'], [/\bzimn[a-z]*\b/g, 'cold', 'zimna (od 5000 K)'] ].filter(([pattern]) => matches(t, pattern).length);
  if (!result.cct && temperatures.length === 1) { result.temperature = temperatures[0][1]; criteria.push({ label: 'Barwa', value: temperatures[0][2] }); }
  else if (!result.cct && temperatures.length > 1 && result.mode !== 'CCT' && result.mode !== 'RGBCCT') { questions.push('Która barwa ma być w tej propozycji: ciepła, neutralna czy zimna?'); result.conflict = true; }
  result.lengthMeters = parseLength(t, questions);
  if (result.lengthMeters) criteria.push({ label: 'Długość do obliczeń', value: `${fmt(result.lengthMeters)} m` });
  result.wantsSupply = matches(t, /\bzasilacz[a-z]*\b/g).length > 0;
  result.wantsController = matches(t, /\b(?:sterownik[a-z]*|sciemnia[a-z]*|pilot[a-z]*|dali|zigbee|wifi|wi-fi)\b/g).length > 0;
  result.wantsProfile = matches(t, /\b(?:profil[a-z]*|listw[a-z]*)\b/g).length > 0;
  result.wantsConnector = matches(t, /\bzlaczk[a-z]*\b/g).length > 0;
  result.wantsStrip = matches(t, /\btasm[a-z]*\b/g).length > 0 || Boolean(result.technology || result.cct || result.temperature || result.wattsPerMeter || result.mode || (!result.wantsSupply && !result.wantsController && !result.wantsProfile && !result.wantsConnector && result.voltage));
  if (/\bkuchni|\bmebl|\bszaf|\bstolar/.test(t)) result.customerType = 'furniture';
  else if (/\bhurtown|\bhurtow/.test(t)) result.customerType = 'wholesale';
  else if (/\barchitekt/.test(t)) result.customerType = 'architect';
  else if (/\binstalator/.test(t)) result.customerType = 'installer';
  else if (/\breklam|\bkaseton/.test(t)) result.customerType = 'advertising';
  const mount = matches(t, /\b(wpuszczan[a-z]*|natynkow[a-z]*|nawierzchniow[a-z]*|zwieszan[a-z]*)\b/g).map(m => /wpuszcz/.test(m[1]) ? 'wpuszcz' : /zwiesz/.test(m[1]) ? 'zwiesz' : 'nawierzchni|natynkow');
  if (unique(mount).length === 1) result.mount = mount[0];
  if (/\btan(?:i|io|ie|szy|sze)|\bbudzet|\bcen[a-z]*\b/.test(t)) questions.push('Jaki jest budżet i cennik klienta: hurtowy czy detaliczny? Dobór poniżej uwzględnia parametry; cenę możesz dodać przy wybranym produkcie.');
  const wetContext = /\blazien|\bzewnatrz|\bdworze|\bdeszcz|\bwilgo|\bmokr|\bwod[a-z]*\b/.test(t);
  if (wetContext && (!result.ip || result.ip.endsWith('0'))) {
    result.requiresProtection = true;
    questions.push(result.ip ? `W opisie jest IP${result.ip} oraz montaż na zewnątrz lub możliwy kontakt z wodą. Potwierdź warunki i wymagany stopień ochrony przed doborem produktu.` : 'Jakie są warunki kontaktu z wodą i wymagany stopień IP? Ustal je przed wyborem wykonania.');
  }
  return result;
}
function stripMatch(r, c, exact = false) {
  if (!r.strip) return null;
  const reasons = [];
  if (c.technology) { if (r.technology !== c.technology) return null; reasons.push(`Technologia ${c.technology}`); }
  if (c.excludedTechnology?.includes(r.technology)) return null;
  if (c.voltage) { if (!supportsVoltage(r, c.voltage)) return null; reasons.push(`${c.voltage} V DC`); }
  if (c.wattsPerMeter) { if (r.power === null || Math.abs(r.power - c.wattsPerMeter) > 0.0001) return null; reasons.push(`${fmt(r.power)} W/m`); }
  if (c.cct || c.temperature) {
    const targets = r.cct.filter(n => c.cct ? n === c.cct : c.temperature === 'warm' ? n >= 2700 && n <= 3500 : c.temperature === 'neutral' ? n > 3500 && n <= 4500 : n >= 5000);
    if (!targets.length || /[–—-]/.test(r.cctText)) return null;
    if (!c.mode && r.mode !== 'MONO') return null;
    reasons.push(`Barwa ${r.cctText}`);
  }
  if (c.mode) { if (r.mode !== c.mode) return null; reasons.push(`Sterowanie ${r.mode}`); }
  if (c.ip) { if (r.ip !== c.ip) return null; reasons.push(`IP${r.ip}`); }
  if (c.warranty) { if (r.warranty === null || (c.warrantyMinimum ? r.warranty < c.warranty : r.warranty !== c.warranty)) return null; reasons.push(`Gwarancja ${r.warranty} lat`); }
  if (exact) reasons.unshift('Symbol wskazany w opisie');
  return reasons.length ? reasons : null;
}
function item(r, reasons, score = reasons.length * 10) {
  return { id: r.id, ...(r.variantSku ? { variantSku: r.variantSku } : {}), reasons, score };
}
function selectedRecords(records, text) {
  const found = [];
  for (const product of records) {
    const variants = product.variants || [];
    for (const variant of [null, ...variants]) {
      const identifiers = [variant?.sku || product.sku, variant ? variant.tradeIndex : product.tradeIndex, variant?.ean || (!variant ? product.ean||product.specs?.EAN : '')].filter(value => String(value || '').length >= 4);
      if (identifiers.some(value => {
        const escaped = escapeRegex(normal(value));
        const match = new RegExp(`(^|[^a-z0-9_.+-])(${escaped})(?=$|[^a-z0-9_.+-])`).exec(text);
        return match && !negated(text, match.index + match[1].length);
      })) found.push(record(product, variant));
    }
  }
  return found;
}
const titles = { strips: 'Taśmy pasujące do opisu', supplies: 'Zasilacze do sprawdzenia', controllers: 'Sterowanie', profiles: 'Profile', connectors: 'Złączki', other: 'Pozycje wskazane w opisie' };

export function recommendProducts(text, products, options = {}) {
  const questions = [], criteria = [], groups = [], data = Array.isArray(products) ? products : [];
  const eligible=record=>hasPrice(record.product);
  const rawText = normal(text).slice(0, 10000), exact = selectedRecords(data, rawText).filter(eligible);
  // A symbol such as ...-RGB+WW is an identifier, not a separate RGB request.
  let parameterText = rawText;
  for (const match of exact) for (const value of [match.product.sku, match.product.tradeIndex, match.product.ean, match.product.specs?.EAN].filter(Boolean)) {
    parameterText = parameterText.replace(new RegExp(`(^|[^a-z0-9_.+-])${escapeRegex(normal(value))}(?=$|[^a-z0-9_.+-])`, 'g'), '$1 ');
  }
  const c = parse(parameterText, questions);
  criteria.push(...c.criteria);
  const records = data.flatMap(p=>p.kind==='family'?(p.variants??[]).map(v=>record(p,v)):[record(p)]).filter(eligible);
  const result = { criteria, groups, questions, summary: '', ...(c.customerType ? { customerType: c.customerType } : {}) };
  if(!records.length){result.summary='Brak propozycji z potwierdzoną ceną.';questions.push('Zmień kryteria lub sprawdź aktualizację cennika. Produkty bez ceny nie są proponowane.');return result;}
  const group = (key, candidates, note) => { if (candidates.length) groups.push({ key, title: titles[key], products: candidates.slice(0, 3), ...(note ? { note } : {}) }); };
  if (c.conflict) { result.summary = 'Najpierw doprecyzuj rozbieżne parametry.'; return result; }
  if (c.requiresProtection) { result.summary = 'Przed doborem wykonania do tych warunków ustal wymagany stopień ochrony IP.'; return result; }
  const exactStrips = exact.filter(r => r.strip);
  const preferDryInterior = !c.ip && (c.customerType === 'furniture' || /\bsuch[a-z]*\b/.test(c.text));
  const matchingStrips = (exactStrips.length ? exactStrips : records).map(r => ({ record: r, reasons: stripMatch(r, c, exactStrips.length > 0) })).filter(r => r.reasons);
  if (preferDryInterior) {
    matchingStrips.sort((a, b) => Number(b.record.ip === '20') - Number(a.record.ip === '20'));
    for (const candidate of matchingStrips) if (candidate.record.ip === '20') candidate.reasons.push('IP20 — propozycja do suchego wnętrza');
  }
  const wantsStrip = c.wantsStrip || exactStrips.length > 0;
  let chosenStrip = wantsStrip ? (matchingStrips.find(x => x.record.id === options.stripId) || matchingStrips[0])?.record : null;
  if (wantsStrip) {
    if (preferDryInterior && matchingStrips.length && !/\bsuch[a-z]*\b/.test(c.text)) questions.push('Czy montaż będzie w suchym miejscu? W propozycjach do mebli pierwszeństwo ma wykonanie IP20.');
    const diverse = [];
    for (const match of matchingStrips) {
      // 10 m and 50 m rolls of the same strip are not three useful alternatives.
      const key = [match.record.product.family, match.record.voltageText, match.record.powerText, match.record.cctText, match.record.ip].join('|');
      if (!diverse.some(x => x.key === key)) diverse.push({ ...match, key });
    }
    const top = diverse.slice(0, 3);
    const selected = matchingStrips.find(x => x.record.id === chosenStrip?.id);
    if (selected && !top.some(x => x.record.id === selected.record.id)) top.splice(2, 1, selected);
    group('strips', top.map(x => item(x.record, x.reasons)), 'Alternatywy do wyboru. Zasilanie jest liczone dla wskazanej taśmy.');
    if (!matchingStrips.length) questions.push(criteria.some(x => x.label !== 'Długość do obliczeń') || exactStrips.length ? 'Brak taśmy spełniającej podane parametry w tej kopii katalogu. Sprawdź parametry lub zapytaj o wykonanie na zamówienie.' : 'Doprecyzuj parametry taśmy, np. COB lub SMD, napięcie i barwę światła.');
    if (!c.cct && !c.temperature && !c.mode && !exactStrips.length) questions.push('Jaką barwę lub rodzaj światła ustalono: np. 3000 K, 4000 K, RGB albo CCT?');
    if (!c.voltage && !exactStrips.length) questions.push('Czy napięcie jest narzucone przez instalację? W propozycji pozostawiono napięcie konkretnej taśmy.');
  }
  let minimumSupply = null, voltage = chosenStrip?.voltage.length === 1 ? chosenStrip.voltage[0] : c.voltage;
  // Reserve is the unused share of nominal supply power: 20% => load / 0.8.
  const suppliedReserve = Number(options.reservePercent);
  const reservePercent = options.reservePercent !== undefined && Number.isFinite(suppliedReserve) && suppliedReserve >= 0 && suppliedReserve < 100 ? suppliedReserve : 20;
  if (chosenStrip && c.lengthMeters && chosenStrip.power !== null && /w\s*\/\s*m/i.test(chosenStrip.powerText)) {
    const loadWatts = round(c.lengthMeters * chosenStrip.power);
    minimumSupply = Math.ceil((loadWatts / (1 - reservePercent / 100) - 1e-9) * 1000) / 1000;
    result.calculation = { lengthMeters: c.lengthMeters, wattsPerMeter: chosenStrip.power, loadWatts, reservePercent, minimumSupplyWatts: minimumSupply, voltage: voltage || null, stripId: chosenStrip.id };
  } else if (chosenStrip && c.lengthMeters && chosenStrip.power === null) questions.push('Ta pozycja nie ma jednej potwierdzonej mocy całkowitej W/m. Ustal moc lub tryb pracy przed doborem zasilacza.');
  if (chosenStrip && !c.lengthMeters && !questions.some(q => /metr|dlugosc|długo/.test(q))) questions.push('Ile metrów tej taśmy ma pracować na jednym zasilaczu? To pozwoli policzyć wymaganą moc.');
  if (c.wantsSupply || minimumSupply !== null || exact.some(r => r.supply)) {
    const exactSupplies = exact.filter(r => r.supply);
    if (!voltage && !exactSupplies.length) questions.push('Jakie napięcie wyjściowe ma mieć zasilacz: 12 V czy 24 V?');
    if (minimumSupply === null && !c.supplyWatts && !exactSupplies.length) questions.push('Podaj moc zasilacza albo długość i konkretną taśmę, aby obliczyć obciążenie.');
    const supplyCandidates = (exactSupplies.length ? exactSupplies : records.filter(r => r.supply)).filter(r => {
      if (!exactSupplies.length && (!voltage || (minimumSupply === null && !c.supplyWatts))) return false;
      if (voltage && !supportsVoltage(r, voltage)) return false;
      if (minimumSupply !== null && (r.power === null || r.power < minimumSupply)) return false;
      if (c.supplyWatts && r.power !== c.supplyWatts) return false;
      if (c.ip && r.ip !== c.ip) return false;
      // A strip's warranty does not become a warranty for every component.
      const warrantyApplies = !wantsStrip || /\bzestaw\b/.test(c.text) || /zasilacz[a-z]*[^.;]{0,30}\b(?:3|5|7)\s*(?:lat|lata)\b/.test(c.text);
      if (warrantyApplies && c.warranty && (r.warranty === null || (c.warrantyMinimum ? r.warranty < c.warranty : r.warranty !== c.warranty))) return false;
      return true;
    }).sort((a, b) => (a.power ?? Infinity) - (b.power ?? Infinity));
    group('supplies', supplyCandidates.map(r => item(r, [...(exactSupplies.length ? ['Symbol wskazany w opisie'] : []), `Wyjście: ${r.voltageText}`, `Moc: ${fmt(r.power)} W`, ...(r.ip ? [`IP${r.ip}`] : []), ...(r.warranty ? [`Gwarancja ${r.warranty} lat`] : []), ...(minimumSupply !== null ? [`Przy ${reservePercent}% wolnej mocy potrzeba minimum ${fmt(minimumSupply)} W`] : [])])), 'Dopasowanie napięcia i mocy. Sposób zasilania odcinków, warunki montażu i wymagany stopień IP pozostają do potwierdzenia.');
    if (!supplyCandidates.length && voltage && (minimumSupply !== null || c.supplyWatts)) questions.push(`Brak zasilacza spełniającego te warunki (${voltage} V${minimumSupply !== null ? `, co najmniej ${fmt(minimumSupply)} W` : ''}) w tej kopii katalogu.`);
  }
  if (c.wantsController || exact.some(r => r.controller)) {
    const mode = chosenStrip?.mode || c.mode;
    const exactControllers = exact.filter(r => r.controller);
    const protocol = c.text.match(/\b(dali|zigbee|wi-?fi)\b/)?.[1];
    if (chosenStrip?.digital) questions.push('Wybrana taśma jest cyfrowa. Potrzebny jest sterownik zgodny z jej układem IC; PR Touch nie został do niej dobrany.');
    else if (protocol) questions.push(`Sprawdź dostępność sterownika ${protocol.toUpperCase()} — w tej kopii bazy nie ma potwierdzonego dopasowania tego protokołu.`);
    else if ((!mode || !voltage) && !exactControllers.length) questions.push('Do sterowania potrzebne są napięcie i rodzaj taśmy: MONO, CCT, RGB, RGBW lub RGB+CCT.');
    else {
      const amps = result.calculation && voltage ? result.calculation.loadWatts / voltage : null;
      const candidates = (exactControllers.length ? exactControllers : records.filter(r => r.controller)).filter(r => (!mode || r.mode === mode) && (!voltage || supportsVoltage(r, voltage)) && (amps === null || (r.totalAmps !== null && r.totalAmps >= amps && (mode !== 'MONO' || r.channelAmps >= amps))));
      group('controllers', candidates.map(r => item(r, [...(exactControllers.length ? ['Symbol wskazany w opisie'] : []), `Funkcja ${r.mode}`, `Zasilanie ${r.voltageText}`, ...(amps !== null ? [`Obciążenie całkowite instalacji: ${fmt(amps)} A`] : [])])), mode === 'MONO' && amps !== null ? 'Sprawdzono napięcie, rodzaj taśmy i prąd kanału dla wyliczonego obciążenia.' : 'Do potwierdzenia pozostaje obciążenie każdego kanału i sposób podłączenia odcinków.');
      if (!candidates.length) questions.push('Brak sterownika spełniającego te parametry w tej kopii katalogu.');
    }
  }
  const exactOther = exact.filter(r => !r.strip && !r.supply && !r.controller);
  for (const key of unique(exactOther.map(r => r.key))) group(key, exactOther.filter(r => r.key === key).map(r => item(r, ['Symbol wskazany w opisie'])));
  if (c.wantsProfile && !exactOther.some(r => r.key === 'profiles')) {
    const candidates = records.filter(r => r.key === 'profiles' && (!chosenStrip?.width || r.width >= chosenStrip.width) && (!c.mount || new RegExp(c.mount).test(normal(r.mount))));
    if (c.mount || chosenStrip?.width) group('profiles', candidates.map(r => item(r, [...(chosenStrip?.width ? [`Kanał ${fmt(r.width)} mm mieści PCB ${fmt(chosenStrip.width)} mm`] : []), ...(c.mount ? [`Montaż: ${r.mount}`] : [])])), 'Wstępny wybór według szerokości i montażu. Długość, wykończenie, osłona i odprowadzanie ciepła wymagają doboru.');
    else questions.push('Jaki profil jest potrzebny: nawierzchniowy, wpuszczany czy zwieszany? Podaj też szerokość taśmy.');
    if ((c.mount || chosenStrip?.width) && !candidates.length) questions.push('Brak profilu z potwierdzoną szerokością i sposobem montażu odpowiadającymi opisowi.');
  }
  if (c.wantsConnector && !exactOther.some(r => r.key === 'connectors')) {
    if (chosenStrip?.width && chosenStrip.mode && chosenStrip.technology) {
      const candidates = records.filter(r => r.key === 'connectors' && r.connectorWidths.includes(chosenStrip.width) && r.mode === chosenStrip.mode && r.technologyText.includes(chosenStrip.technology.toLowerCase()));
      group('connectors', candidates.map(r => item(r, [`Szerokość taśmy ${fmt(chosenStrip.width)} mm`, `${chosenStrip.technology} · ${chosenStrip.mode}`])), 'Do potwierdzenia: układ pól lutowniczych, prąd złącza, grubość PCB i rodzaj połączenia.');
      if (!candidates.length) questions.push('Brak złączki o potwierdzonej szerokości i typie pasującym do wybranej taśmy.');
    } else questions.push('Do złączki potrzebne są szerokość i typ taśmy oraz połączenie: taśma–taśma czy taśma–przewód.');
  }
  if (!groups.length && !questions.length) questions.push('Dopisz, czego potrzebuje klient: np. taśma COB, 24 V, 3000 K, 6 m, albo konkretny symbol produktu.');
  result.questions = unique(questions);
  result.summary = groups.length ? 'Propozycje wynikają z podanych parametrów i danych katalogu. Wybierz produkty, które chcesz dodać do oferty.' : 'Na podstawie tego opisu nie ma jeszcze potwierdzonego dopasowania.';
  return result;
}
