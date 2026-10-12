"""Synthetic fixtures only: no supplier or customer prices in this file."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('sync_prices', Path(__file__).resolve().parents[1] / 'scripts' / 'sync-prices.py')
prices = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prices)


def offer(pid='1', sku='TEST-1', ean='0000000000001', price='12.34', unit='m'):
    return f'<o id="{pid}" price="{price}"><attrs><a name="Kod_produktu">{sku}</a><a name="EAN">{ean}</a><a name="Jednostka">{unit}</a></attrs></o>'


def feed(*offers):
    return prices.parse_feed(('<offers version="1">' + ''.join(offers) + '</offers>').encode())


def catalog(sku='TEST-1', ean='0000000000001'):
    return {'products': [{'kind': 'product', 'sku': sku, 'specs': {'EAN': ean}}]}


def strip(name='Taśma LED 24V 2W/m 300lm/m 10m', roll='10m', unit='szt', by_meter='Nie'):
    source = offer(unit=unit).replace('<attrs>', f'<name>{name}</name><attrs>')
    return source.replace('</attrs>', f'<a name="Rolka">{roll}</a><a name="Taśma na metry">{by_meter}</a></attrs>')


def build(catalog_data, wholesale, retail):
    return prices.build_prices(catalog_data, {'wholesale': wholesale, 'retail': retail}, {}, '2026-01-01T00:00:00Z')


class ImportPricesTests(unittest.TestCase):
    def test_source_decimal_is_exact_and_commercial_metadata_is_unknown(self):
        row = feed(offer(price='12.3400'))[0]
        self.assertEqual(row['amount'], '12.3400')
        self.assertEqual(row['taxBasis'], 'unknown')
        self.assertIsNone(row['currency'])
        self.assertEqual(row['unit'], 'm')

    def test_only_positive_bounded_decimal_prices_are_accepted(self):
        for value in ['', '0', '-1', 'NaN', 'Infinity', '1e99999999', '1234567890123', '1.1234567']:
            with self.subTest(value=value):
                self.assertIsNone(prices.amount(value))
        self.assertEqual(prices.amount('12,34'), '12.34')

    def test_dtd_and_utf16_are_rejected(self):
        for raw in [b'<!DOCTYPE offers [<!ENTITY x "12">]><offers/>', '<offers/>'.encode('utf-16'), b'<offers/>']:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    prices.parse_feed(raw)

    def test_duplicate_source_ids_fail_snapshot(self):
        with self.assertRaises(ValueError):
            feed(offer(), offer())

    def test_exact_sku_or_exact_ean_only(self):
        result = build(catalog(), feed(offer(sku='OTHER')), feed(offer()))
        self.assertEqual(result['bySku']['TEST-1']['wholesale']['match'], 'ean')
        self.assertEqual(result['bySku']['TEST-1']['retail']['match'], 'sku')
        absent = build(catalog(), feed(offer(sku='TEST-10', ean='2')), feed(offer(sku='test-1', ean='3')))
        self.assertEqual(absent['bySku'], {})

    def test_conflicting_ean_blocks_sku_and_ean_fallback(self):
        rows = feed(offer(ean='2'), offer(pid='2', sku='OTHER'))
        result = build(catalog(), rows, rows)
        self.assertEqual(result['bySku'], {})
        self.assertEqual(result['feeds']['wholesale']['diagnostics']['conflictingEan'], 1)

    def test_ambiguous_sku_or_ean_never_chooses_first(self):
        sku_rows = feed(offer(), offer(pid='2', ean='2'))
        ean_rows = feed(offer(sku='ONE'), offer(pid='2', sku='TWO'))
        result = build(catalog(), sku_rows, ean_rows)
        self.assertEqual(result['bySku'], {})
        self.assertEqual(result['feeds']['wholesale']['diagnostics']['ambiguousSku'], 1)
        self.assertEqual(result['feeds']['retail']['diagnostics']['ambiguousEan'], 1)

    def test_family_has_no_price_until_exact_variant_is_selected(self):
        data = {'products': [{'kind': 'family', 'sku': 'TEST-FAMILY', 'specs': {'EAN': '999'},
                              'variants': [{'sku': 'TEST-1', 'ean': '0000000000001'}]}]}
        rows = feed(offer(), offer(pid='2', sku='TEST-FAMILY', ean='999'))
        result = build(data, rows, rows)
        self.assertEqual(set(result['bySku']), {'TEST-1'})

    def test_retail_unit_inherits_only_unambiguous_same_sku_and_nonempty_ean(self):
        result = build(catalog(), feed(offer()), feed(offer(unit='')))
        retail = result['bySku']['TEST-1']['retail']
        self.assertEqual((retail['unit'], retail['unitSource']), ('m', 'wholesale'))
        for sku, ean in [('OTHER', '0000000000001'), ('TEST-1', '')]:
            rows = feed(offer(sku=sku, ean=ean, unit=''))
            prices.inherit_retail_units(feed(offer()), rows)
            self.assertIsNone(rows[0]['unit'])

    def test_explicit_retail_unit_is_not_overwritten_or_converted(self):
        result = build(catalog(), feed(offer(unit='m')), feed(offer(unit='szt.')))
        self.assertEqual(result['bySku']['TEST-1']['retail']['unit'], 'szt.')
        self.assertNotIn('unitSource', result['bySku']['TEST-1']['retail'])

    def test_duplicate_unit_donor_pair_does_not_inherit(self):
        retail = feed(offer(unit=''))
        prices.inherit_retail_units(feed(offer(), offer(pid='2')), retail)
        self.assertIsNone(retail[0]['unit'])

    def test_duplicate_catalog_skus_fail_snapshot(self):
        data = catalog()
        data['products'].append(data['products'][0].copy())
        with self.assertRaises(ValueError):
            build(data, feed(offer()), feed(offer()))

    def test_unpriced_or_zero_price_is_omitted_and_counted(self):
        result = build(catalog(), feed(offer(price='0')), feed(offer(price='')))
        self.assertEqual(result['bySku'], {})
        self.assertEqual(result['feeds']['wholesale']['diagnostics']['invalidPrice'], 1)

    def test_explicit_roll_length_is_preserved_without_price_conversion(self):
        result = build(catalog(), feed(strip()), feed(strip(unit='')))
        for key in ['wholesale', 'retail']:
            row = result['bySku']['TEST-1'][key]
            self.assertEqual(row['packageLabel'], 'rolka 10 m')
            self.assertEqual(row['packageSource'], 'attribute:Rolka')
            self.assertEqual(row['amount'], '12.34')
            self.assertEqual(row['unit'], 'szt')
            self.assertIn('10m', row['sourceName'])

    def test_price_per_metre_does_not_become_a_roll_price(self):
        result = build(catalog(), feed(strip(unit='m', by_meter='Tak')), feed(strip(unit='')))
        for key in ['wholesale', 'retail']:
            self.assertNotIn('packageLabel', result['bySku']['TEST-1'][key])
            self.assertEqual(result['bySku']['TEST-1'][key]['amount'], '12.34')

    def test_roll_in_name_and_plain_section_length_are_distinguished(self):
        for name, expected in [('Taśma LED rolka 50m', 'rolka 50 m'), ('Taśma LED 50m', 'odcinek 50 m')]:
            rows = feed(strip(name=name, roll=''))
            result = build(catalog(), rows, rows)
            self.assertEqual(result['bySku']['TEST-1']['wholesale']['packageLabel'], expected)

    def test_power_and_lumens_per_metre_are_not_package_lengths(self):
        for name in ['Taśma LED 5W/m', 'Taśma LED 500lm/m', 'Taśma LED 100led/m']:
            rows = feed(strip(name=name, roll=''))
            result = build(catalog(), rows, rows)
            self.assertNotIn('packageLabel', result['bySku']['TEST-1']['wholesale'])

    def test_conflicting_roll_and_name_are_flagged_without_guessing(self):
        result = build(catalog(), feed(strip(roll='50m')), feed(strip(roll='50m', unit='')))
        row = result['bySku']['TEST-1']['wholesale']
        self.assertNotIn('packageLabel', row)
        self.assertIn('Sprzeczna długość', row['packageIssue'])

    def test_two_feeds_must_agree_on_explicit_packaging(self):
        result = build(catalog(), feed(strip()), feed(strip(name='Taśma LED 50m', roll='50m', unit='')))
        for key in ['wholesale', 'retail']:
            row = result['bySku']['TEST-1'][key]
            self.assertNotIn('packageLabel', row)
            self.assertIn('Cenniki podają różne', row['packageIssue'])

    def test_per_piece_with_sold_by_meter_flag_is_not_assumed_to_be_a_roll(self):
        rows = feed(strip(by_meter='Tak'))
        result = build(catalog(), rows, rows)
        row = result['bySku']['TEST-1']['wholesale']
        self.assertNotIn('packageLabel', row)
        self.assertIn('sprzedaż na metry', row['packageIssue'])

    def test_trade_index_is_distinct_from_catalog_manufacturer_code(self):
        rows = feed(offer(sku='ERP-001'))
        result = build(catalog(sku='MANUFACTURER-001'), rows, rows)
        identity = result['identities']['MANUFACTURER-001']
        self.assertEqual(identity['tradeIndex'], 'ERP-001')
        self.assertEqual(identity['ean'], '0000000000001')
        self.assertEqual(identity['sources'], ['wholesale', 'retail'])

    def test_identity_survives_missing_or_zero_price_and_missing_unit(self):
        result = build(catalog(), feed(offer(price='0', unit='')), feed(offer(price='', unit='')))
        self.assertEqual(result['bySku'], {})
        self.assertEqual(result['identities']['TEST-1']['tradeIndex'], 'TEST-1')
        self.assertEqual(result['identities']['TEST-1']['ean'], '0000000000001')

    def test_conflicting_trade_indexes_are_not_selected_arbitrarily(self):
        result = build(catalog(), feed(offer(sku='ERP-ONE')), feed(offer(sku='ERP-TWO')))
        self.assertNotIn('tradeIndex', result['identities']['TEST-1'])
        self.assertEqual(result['identities']['TEST-1']['ean'], '0000000000001')
        self.assertEqual(result['identityDiagnostics']['conflictingTradeIndex'], 1)

    def test_ambiguous_or_conflicting_matches_do_not_create_identity(self):
        rows = feed(offer(ean='DIFFERENT'))
        result = build(catalog(), rows, rows)
        self.assertEqual(result['identities'], {})

    def test_ean_conflict_without_catalog_ean_is_reported(self):
        result = build(catalog(ean=''), feed(offer(ean='ONE')), feed(offer(ean='TWO')))
        identity = result['identities']['TEST-1']
        self.assertEqual(identity['tradeIndex'], 'TEST-1')
        self.assertNotIn('ean', identity)
        self.assertEqual(result['identityDiagnostics']['conflictingEan'], 1)


if __name__ == '__main__':
    unittest.main()
