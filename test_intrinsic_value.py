import math
import unittest

import intrinsic_value


class IntrinsicValueTests(unittest.TestCase):
    def test_equity_rank_parser_keeps_dated_per_share_estimates(self):
        parsed = intrinsic_value.parse_equity_rank({
            'meta': {'batch_last_recomputed': '2026-11-25T08:17:34+00:00'},
            'rows': [{'ticker': 'ABC', 'model_fair_value_estimate': 42.5,
                      'price_at_last_recompute': 40, 'last_recomputed': '2026-11-25T08:00:00+00:00'},
                     {'ticker': 'NONE', 'model_fair_value_estimate': None}]})
        self.assertEqual(parsed['rows']['ABC'], {'value': 42.5, 'price': 40, 'asOf': '2026-11-25T08:00:00+00:00', 'reason': None})
        self.assertIsNone(parsed['rows']['NONE']['value'])
        self.assertTrue(parsed['rows']['NONE']['reason'])

    def test_zyberno_per_share_conversion_is_explicit_and_date_preserved(self):
        row = ('snapshot_date,symbol,intrinsic_value_usd,market_cap_usd,price_usd,record_computed_utc\n'
               '2026-11-01,ABC,500000000,1000000000,20,2026-10-30\n')
        parsed = intrinsic_value.parse_zyberno_csv(row)
        estimate = parsed['rows']['ABC']
        self.assertEqual(estimate['value'], 10)
        self.assertEqual(estimate['impliedShares'], 50_000_000)
        self.assertEqual(estimate['asOf'], '2026-10-30')
        self.assertEqual(estimate['snapshotDate'], '2026-11-01')

    def test_sec_methods_calculate_only_from_annual_filing_facts(self):
        def annual(value, unit):
            return {unit: [{'fy': 2024, 'fp': 'FY', 'form': '10-K', 'filed': '2025-02-01',
                            'start': '2024-01-01', 'end': '2024-12-31', 'val': value}]}
        facts = {'facts': {'us-gaap': {
            'NetCashProvidedByUsedInOperatingActivities': {'units': annual(1000, 'USD')},
            'PaymentsToAcquirePropertyPlantAndEquipment': {'units': annual(200, 'USD')},
            'EarningsPerShareDiluted': {'units': annual(4, 'USD / shares')},
            'CommonStockDividendsPerShareDeclared': {'units': annual(1.5, 'USD / shares')},
            'StockholdersEquity': {'units': {'USD': [{'form': '10-K', 'filed': '2025-02-01', 'end': '2024-12-31', 'val': 2000}]}},
        }, 'dei': {'EntityCommonStockSharesOutstanding': {'units': {
            'shares': [{'form': '10-K', 'filed': '2025-02-01', 'end': '2024-12-31', 'val': 100}]
        }}}}}
        methods = intrinsic_value.calculate_methods(facts)
        self.assertAlmostEqual(methods['graham']['value'], math.sqrt(22.5 * 4 * 20))
        self.assertAlmostEqual(methods['ddm']['value'], 1.5 * 1.025 / (0.09 - 0.025))
        self.assertGreater(methods['dcf']['value'], 8)
        self.assertEqual(methods['dcf']['inputs']['fcf'], 800)
        self.assertEqual(methods['dcf']['assumptions']['years'], 5)

    def test_missing_or_nonpositive_inputs_remain_unavailable(self):
        methods = intrinsic_value.calculate_methods({'facts': {}})
        self.assertIsNone(methods['dcf']['value'])
        self.assertIsNone(methods['graham']['value'])
        self.assertIsNone(methods['ddm']['value'])
        self.assertTrue(methods['dcf']['reason'])

    def test_ticker_key_normalizes_share_class_separators(self):
        self.assertEqual(intrinsic_value._ticker_key('BRK.B'), intrinsic_value._ticker_key('BRK-B'))


if __name__ == '__main__':
    unittest.main()
