#!/usr/bin/env python3
"""Read the two fixed Prescot feeds; write prices only to ignored private/.

Run from anywhere: python3 scripts/sync-prices.py
Offline validation: python3 scripts/sync-prices.py --offline

The XML price attribute does not declare tax basis or currency. Those remain
unknown here. Confirmed commercial settings belong in prices-settings.json,
applied separately when encrypting the library. Product specifications and
energy classes never come from this price import.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / 'private'
MAX_BYTES = 32 * 1024 * 1024
FEEDS = {
    'wholesale': {'label': 'Hurt', 'url': 'https://prescot.wapromag.pl/prescot.xml', 'file': 'prescot.xml'},
    'retail': {'label': 'Detal', 'url': 'https://prescot.wapromag.pl/prescotcloud.xml', 'file': 'prescotcloud.xml'},
}


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def clean(value):
    return ' '.join(str(value or '').split())


def amount(value):
    """Keep source decimals exact. Zero/negative/invalid are not sale prices."""
    literal = clean(value).replace(',', '.')
    if not re.fullmatch(r'[0-9]{1,12}(?:\.[0-9]{1,6})?', literal):
        return None
    try:
        result = Decimal(literal)
        return format(result, 'f') if result.is_finite() and result > 0 else None
    except InvalidOperation:
        return None


def source_packaging(name, attrs):
    """Read explicit strip lengths, never electrical /m specifications."""
    if not re.match(r'^taśma\b', name, re.I):
        return None
    length_pattern = r'([0-9]+(?:[,.][0-9]+)?)\s*m'
    roll = re.fullmatch(r'\s*' + length_pattern + r'\s*', attrs.get('Rolka', ''), re.I)
    named_roll = re.search(r'\brolka\s+' + length_pattern + r'\b', name, re.I)
    # A standalone length at the end of a strip name is an explicit section
    # length. It is not called a roll unless the source says Rolka/rolka.
    tail = re.search(r'(?<![\w./])' + length_pattern + r'\s*$', name, re.I)
    candidates = [(match, source, kind) for match, source, kind in
                  [(roll, 'attribute:Rolka', 'rolka'), (named_roll, 'name:rolka', 'rolka'),
                   (tail, 'name:length', 'odcinek')] if match]
    lengths = {Decimal(match[1].replace(',', '.')) for match, _, _ in candidates}
    meter_value = clean(attrs.get('Taśma na metry')).casefold()
    result = {'soldByMeter': True if meter_value == 'tak' else False if meter_value == 'nie' else None}
    if len(lengths) > 1:
        result['issue'] = 'Sprzeczna długość odcinka w nazwie i parametrach XML.'
    if candidates:
        match, source, kind = candidates[0]
        length = Decimal(match[1].replace(',', '.'))
        if 0 < length <= 10000:
            result.update({'lengthMeters': format(length.normalize(), 'f'), 'kind': kind, 'source': source})
    return result


def parse_feed(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError('XML exceeds 32 MB.')
    try:
        decoded = raw.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise ValueError('XML must use UTF-8.') from error
    if '\x00' in decoded or re.search(r'<!\s*(DOCTYPE|ENTITY)\b', decoded, re.I):
        raise ValueError('XML DTDs/entities and non-UTF-8 encodings are not supported.')
    root = ET.fromstring(decoded)
    if root.tag != 'offers':
        raise ValueError('Expected offers XML.')
    rows, ids = [], set()
    for offer in root.findall('o'):
        source_id = clean(offer.get('id'))
        if not source_id or source_id in ids:
            raise ValueError('Missing or duplicate source ID.')
        ids.add(source_id)
        attrs = {}
        for node in offer.findall('attrs/a'):
            key, value = clean(node.get('name')), clean(node.text)
            if key in attrs and attrs[key] != value:
                raise ValueError('Conflicting duplicate product attribute.')
            attrs[key] = value
        # No unit conversion: a metre, roll and piece are not interchangeable.
        source_name = clean(offer.findtext('name'))
        rows.append({'sourceId': source_id, 'sourceSku': attrs.get('Kod_produktu', ''),
                     'sourceName': source_name, 'packaging': source_packaging(source_name, attrs),
                     'ean': attrs.get('EAN', ''), 'amount': amount(offer.get('price')),
                     'unit': attrs.get('Jednostka') or None,
                     'taxBasis': 'unknown', 'currency': None})
        if len(rows) > 50000:
            raise ValueError('XML exceeds 50000 products.')
    if not rows:
        raise ValueError('Empty feed; previous price snapshot was retained.')
    return rows


def catalog_entries(catalog):
    """Expose individual products and exact family variants, never families."""
    result, seen = [], {}
    for product in catalog['products']:
        entries = []
        if product.get('kind') == 'product':
            entries.append((product.get('sku'), product.get('specs', {}).get('EAN')))
        for variant in product.get('variants', []):
            entries.append((variant.get('sku'), variant.get('ean') or variant.get('specs', {}).get('EAN')))
        for sku, ean in entries:
            sku, ean = clean(sku), clean(ean)
            if not sku:
                raise ValueError('Catalog product/variant has no SKU.')
            if sku in seen:
                raise ValueError('Catalog contains a duplicate exact SKU: ' + sku)
            seen[sku] = ean
            result.append({'sku': sku, 'ean': ean})
    return result


def indexes(rows):
    by_sku, by_ean = defaultdict(list), defaultdict(list)
    for row in rows:
        if row['sourceSku']:
            by_sku[row['sourceSku']].append(row)
        if row['ean']:
            by_ean[row['ean']].append(row)
    return by_sku, by_ean


def match_row(entry, by_sku, by_ean):
    sku, ean = entry['sku'], entry['ean']
    sku_matches = by_sku.get(sku, [])
    if len(sku_matches) > 1:
        return None, 'ambiguousSku'
    if sku_matches:
        row = sku_matches[0]
        # An exact SKU with a contradictory EAN is a data error, not permission
        # to fall back to a different product whose EAN happens to match.
        if ean and row['ean'] and ean != row['ean']:
            return None, 'conflictingEan'
        return row, 'sku'
    ean_matches = by_ean.get(ean, []) if ean else []
    if len(ean_matches) > 1:
        return None, 'ambiguousEan'
    if ean_matches:
        return ean_matches[0], 'ean'
    return None, 'missing'


def inherit_retail_units(wholesale_rows, retail_rows):
    """Use a wholesale unit only for one unambiguous same SKU + nonempty EAN."""
    wholesale_pairs = defaultdict(list)
    retail_pairs = Counter()
    for row in wholesale_rows:
        if row['sourceSku'] and row['ean']:
            wholesale_pairs[row['sourceSku'], row['ean']].append(row)
    for row in retail_rows:
        if row['sourceSku'] and row['ean']:
            retail_pairs[row['sourceSku'], row['ean']] += 1
    for row in retail_rows:
        pair = (row['sourceSku'], row['ean'])
        candidates = wholesale_pairs.get(pair, [])
        if not row['unit'] and retail_pairs[pair] == 1 and len(candidates) == 1 and candidates[0]['unit']:
            row['unit'] = candidates[0]['unit']
            row['unitSource'] = 'wholesale'


def compare_packaging(wholesale_rows, retail_rows):
    indexes_by_feed = []
    for rows in [wholesale_rows, retail_rows]:
        pairs = defaultdict(list)
        for row in rows:
            if row['sourceSku'] and row['ean']:
                pairs[row['sourceSku'], row['ean']].append(row)
        indexes_by_feed.append(pairs)
    wholesale, retail = indexes_by_feed
    for pair, rows in wholesale.items():
        others = retail.get(pair, [])
        if len(rows) != 1 or len(others) != 1:
            continue
        left, right = rows[0].get('packaging'), others[0].get('packaging')
        if left and right and left.get('lengthMeters') and right.get('lengthMeters') and left['lengthMeters'] != right['lengthMeters']:
            left['issue'] = right['issue'] = 'Cenniki podają różne długości opakowania dla tego samego SKU i EAN.'


def add_package_label(price):
    packaging = price.get('packaging')
    if not packaging or clean(price['unit']).casefold().rstrip('.') != 'szt':
        return
    if packaging.get('soldByMeter'):
        price['packageIssue'] = 'XML wskazuje sprzedaż na metry, ale jednostką ceny jest sztuka.'
    elif packaging.get('issue'):
        price['packageIssue'] = packaging['issue']
    elif packaging.get('lengthMeters'):
        length = packaging['lengthMeters'].replace('.', ',')
        price['packageLabel'] = f"{packaging['kind']} {length} m"
        price['packageSource'] = packaging['source']


def build_identities(entries, feeds):
    """Keep the ERP trade index separate from the catalog/manufacturer SKU."""
    indexed = {feed_id: indexes(rows) for feed_id, rows in feeds.items()}
    identities, issues = {}, []
    counts = Counter({'matched': 0, 'missing': 0, 'conflictingTradeIndex': 0, 'conflictingEan': 0})
    for entry in entries:
        matches = [(feed_id, match_row(entry, *index)[0]) for feed_id, index in indexed.items()]
        matches = [(feed_id, row) for feed_id, row in matches if row]
        if not matches:
            counts['missing'] += 1
            continue
        identity = {'sources': [feed_id for feed_id, _ in matches]}
        trade_indexes = {row['sourceSku'] for _, row in matches if row['sourceSku']}
        eans = {row['ean'] for _, row in matches if row['ean']}
        if len(trade_indexes) == 1:
            identity['tradeIndex'] = next(iter(trade_indexes))
        elif len(trade_indexes) > 1:
            counts['conflictingTradeIndex'] += 1
            issues.append({'sku': entry['sku'], 'reason': 'conflictingTradeIndex'})
        if entry['ean']:
            identity['ean'] = entry['ean']
        elif len(eans) == 1:
            identity['ean'] = next(iter(eans))
        elif len(eans) > 1:
            counts['conflictingEan'] += 1
            issues.append({'sku': entry['sku'], 'reason': 'conflictingEan'})
        identities[entry['sku']] = identity
        counts['matched'] += 1
    return identities, dict(counts), issues


def build_prices(catalog, feeds, metadata, updated_at=None):
    entries = catalog_entries(catalog)
    inherit_retail_units(feeds['wholesale'], feeds['retail'])
    compare_packaging(feeds['wholesale'], feeds['retail'])
    result = {'schemaVersion': 1, 'updatedAt': updated_at or stamp(), 'feeds': {}, 'bySku': {}}
    identities, identity_counts, identity_issues = build_identities(entries, feeds)
    result.update({'identities': identities, 'identityDiagnostics': identity_counts, 'identityIssues': identity_issues})
    for feed_id, config in FEEDS.items():
        rows = feeds[feed_id]
        by_sku, by_ean = indexes(rows)
        counts = Counter({'catalogVariants': len(entries), 'feedProducts': len(rows),
                          'matched': 0, 'matchedSku': 0, 'matchedEan': 0, 'missing': 0,
                          'ambiguousSku': 0, 'ambiguousEan': 0, 'conflictingEan': 0,
                          'invalidPrice': 0, 'missingUnit': 0, 'inheritedUnit': 0,
                          'missingTaxBasis': 0, 'missingCurrency': 0,
                          'packageLabels': 0, 'packagingIssues': 0})
        issues = []
        for entry in entries:
            row, match = match_row(entry, by_sku, by_ean)
            if row is None:
                counts[match] += 1
                if match != 'missing':
                    issues.append({'sku': entry['sku'], 'reason': match})
                continue
            if row['amount'] is None:
                counts['invalidPrice'] += 1
                continue
            price = {**row, 'match': match}
            add_package_label(price)
            result['bySku'].setdefault(entry['sku'], {})[feed_id] = price
            counts['matched'] += 1
            counts['matchedSku' if match == 'sku' else 'matchedEan'] += 1
            counts['missingUnit'] += not bool(price['unit'])
            counts['inheritedUnit'] += price.get('unitSource') == 'wholesale'
            counts['missingTaxBasis'] += price['taxBasis'] == 'unknown'
            counts['missingCurrency'] += price['currency'] is None
            counts['packageLabels'] += bool(price.get('packageLabel'))
            counts['packagingIssues'] += bool(price.get('packageIssue'))
        result['feeds'][feed_id] = {'label': config['label'], 'url': config['url'],
                                    **metadata.get(feed_id, {}), 'taxBasis': 'unknown',
                                    'currency': None, 'diagnostics': dict(counts), 'issues': issues}
    return result


class FixedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if newurl != req.full_url:
            raise ValueError('The XML source redirected away from the fixed feed URL.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def atomic_json(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Read the already downloaded private XML files.')
    args = parser.parse_args()
    PRIVATE.mkdir(exist_ok=True)
    metadata_path = PRIVATE / 'price-feed-metadata.json'
    metadata = json.loads(metadata_path.read_text()) if args.offline and metadata_path.exists() else {}
    feeds, downloads = {}, {}
    for feed_id, config in FEEDS.items():
        local = PRIVATE / config['file']
        if args.offline:
            raw = local.read_bytes()
            meta = metadata.get(feed_id, {})
            expected_hash = hashlib.sha256(raw).hexdigest()
            if meta and meta.get('sha256') != expected_hash:
                raise ValueError('Offline XML differs from its recorded download checksum.')
            if not meta:
                meta = {'fetchedAt': datetime.fromtimestamp(local.stat().st_mtime, timezone.utc).isoformat(timespec='seconds'),
                        'sourceModified': None, 'sha256': expected_hash}
        else:
            request = urllib.request.Request(config['url'], headers={'User-Agent': 'PRESCOT-Mail-Builder/1.0',
                                                                     'Accept': 'application/xml', 'Accept-Encoding': 'identity'})
            with urllib.request.build_opener(FixedRedirect()).open(request, timeout=45) as response:
                raw = response.read(MAX_BYTES + 1)
                modified = response.headers.get('Last-Modified')
            meta = {'fetchedAt': stamp(), 'sourceModified': modified, 'sha256': hashlib.sha256(raw).hexdigest()}
            downloads[local] = raw
        feeds[feed_id] = parse_feed(raw)
        metadata[feed_id] = meta
    catalog = json.loads((PRIVATE / 'catalog.json').read_text())
    prices = build_prices(catalog, feeds, metadata)
    # Write only after both sources and the complete catalog join pass validation.
    for path, raw in downloads.items():
        temporary = path.with_suffix('.xml.tmp')
        temporary.write_bytes(raw)
        temporary.replace(path)
    atomic_json(metadata_path, metadata)
    atomic_json(PRIVATE / 'prices.json', prices)
    print(json.dumps({'updatedAt': prices['updatedAt'], 'catalogSkusWithPrices': len(prices['bySku']),
                      'identities': prices['identityDiagnostics'],
                      'feeds': {key: value['diagnostics'] for key, value in prices['feeds'].items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
