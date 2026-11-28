import math
import unittest

import valuation

RAW = {'sharesOutstanding': 100.0, 'trailingEps': 4.0, 'forwardEps': 5.0, 'bookValue': 20.0, 'freeCashflow': 800.0, 'ebitda': 1500.0,
       'revenue': 10000.0, 'operatingMargins': 0.1, 'totalDebt': 1000.0, 'totalCash': 500.0, 'returnOnEquity': 0.2, 'dividendRate': 2.0,
       'payoutRatio': 0.5, 'beta': 1.0, 'revenueGrowth': 0.05, 'earningsGrowth': 0.1, 'currentPrice': 100.0}
PEERS = {'forwardPE': 20.0, 'evToEbitda': 10.0}


def by_key(methods):
    return {m['key']: m for m in methods}


class ValuationTests(unittest.TestCase):
    def test_every_method_matches_its_formula(self):
        m = by_key(valuation.methods_for(RAW, 'Industrials', PEERS, 100.0))
        r = valuation.RISK_FREE + valuation.EQUITY_PREMIUM            # beta 1
        self.assertAlmostEqual(m['graham']['value'], round(math.sqrt(22.5 * 4 * 20), 2))
        self.assertAlmostEqual(m['ddm']['value'], round(2 * 1.035 / (r - 0.035), 2))          # growth capped at terminal + 1 point
        self.assertAlmostEqual(m['epv']['value'], round((0.1 * 10000 * (1 - valuation.TAX_RATE) / r + 500 - 1000) / 100, 2))
        self.assertAlmostEqual(m['lynch']['value'], round(4 * (25 + 2), 2))                    # forward growth 25% capped, +2% yield
        self.assertAlmostEqual(m['pe']['value'], 100.0)
        self.assertAlmostEqual(m['evEbitda']['value'], round((1500 * 10 - 1000 + 500) / 100, 2))
        self.assertAlmostEqual(m['residual']['value'], round(20 * (0.2 - 0.025) / (r - 0.025), 2))
        per_share = 8.0
        expected = sum(per_share * 1.05 ** t / (1 + r) ** t for t in range(1, 6)) + per_share * 1.05 ** 5 * 1.025 / (r - 0.025) / (1 + r) ** 5
        self.assertAlmostEqual(m['dcf']['value'], round(expected, 2))
        self.assertTrue(all(x['status'] == 'ok' and x['formula'] for x in m.values()))

    def test_missing_and_not_applicable_are_told_apart(self):
        m = by_key(valuation.methods_for({**RAW, 'dividendRate': 0, 'freeCashflow': -5, 'bookValue': None}, 'Industrials', PEERS, 100.0))
        self.assertEqual((m['ddm']['status'], m['ddm']['value']), ('na', None))
        self.assertIn('no dividend', m['ddm']['reason'])
        self.assertEqual(m['dcf']['status'], 'na')
        self.assertEqual(m['graham']['status'], 'missing')
        self.assertIn('book value', m['graham']['reason'].lower())
        empty = by_key(valuation.methods_for({}, 'Industrials', {}, None))
        self.assertTrue(all(x['status'] in ('missing', 'na') and x['value'] is None for x in empty.values()))

    def test_industry_fit(self):
        bank = by_key(valuation.methods_for(RAW, 'Financials', PEERS, 100.0))
        self.assertEqual(bank['dcf']['fit'], 'poor')
        self.assertEqual(bank['evEbitda']['fit'], 'poor')
        self.assertEqual(bank['residual']['fit'], 'good')
        tech = by_key(valuation.methods_for(RAW, 'Information Technology', PEERS, 100.0))
        self.assertEqual(tech['graham']['fit'], 'poor')
        self.assertEqual(valuation.group_of('Real Estate', 'REIT - Retail'), 'REIT')
        self.assertEqual(valuation.group_of('Real Estate', 'Real Estate Services'), 'Real Estate')
        reit = by_key(valuation.methods_for(RAW, 'REIT', PEERS, 100.0))
        self.assertEqual((reit['dcf']['fit'], reit['ddm']['fit']), ('limited', 'good'))
        low_payout = by_key(valuation.methods_for({**RAW, 'payoutRatio': 0.1}, 'Utilities', PEERS, 100.0))
        self.assertEqual(low_payout['ddm']['fit'], 'limited')

    def test_discount_rate_is_bounded(self):
        self.assertEqual(valuation.discount_rate(1.0)[0], valuation.RISK_FREE + valuation.EQUITY_PREMIUM)
        self.assertEqual(valuation.discount_rate(3.5)[0], 0.13)
        self.assertEqual(valuation.discount_rate(0.1)[0], 0.07)
        self.assertEqual(valuation.discount_rate(None)[1], 1.0)

    def test_build_combines_sources_and_leaves_poor_fits_out_of_the_median(self):
        fund = {'stocks': {}, 'sectorMedians': {}}
        for i in range(6):
            fund['stocks'][f'B{i}'] = {'sector': 'Financials', 'industry': 'Banks', 'raw': RAW, 'metrics': {'forwardPE': 10.0 + i, 'evToEbitda': 8.0}}
        intrinsic = {'sources': {'equityRank': {'rows': {'B0': {'value': 90.0, 'asOf': '2026-11-27T00:00', 'modelsAbove': 2, 'modelsTotal': 9}}}, 'zyberno': {'rows': {}}}}
        def fetch(url):
            if 'slatefinch' in url:
                return {'as_of': '2026-11-26', 'fields': ['symbol', 'fair_value', 'range_low', 'range_high', 'close_date'], 'rows': [['B0', 80.0, 60.0, 100.0, '2026-11-25'], ['B1', None, None, None, None]]}
            raise OSError('down')
        out = valuation.build(fund, intrinsic, {'B0': 100.0}, fetch=fetch)
        s = out['stocks']['B0']
        self.assertEqual(out['external']['sweet']['status'], 'unavailable')
        self.assertEqual({x['key']: x['status'] for x in s['sources']}, {'equityRank': 'ok', 'zyberno': 'missing', 'slate': 'ok', 'sweet': 'missing'})
        values = [m['value'] for m in s['methods'] if m['status'] == 'ok' and m['fit'] != 'poor'] + [90.0, 80.0]
        values.sort()
        n = len(values)
        self.assertEqual(s['count'], n)
        self.assertAlmostEqual(s['median'], round(values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2, 2))
        self.assertEqual(out['stocks']['B1']['sources'][2]['status'], 'missing')     # provider withholds a value
        self.assertEqual(s['peers']['forwardPE'], 13.0)                              # median of 10..15 for the group


if __name__ == '__main__':
    unittest.main()
