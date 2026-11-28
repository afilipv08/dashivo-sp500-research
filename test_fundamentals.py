import unittest

import fundamentals


class FundamentalsTests(unittest.TestCase):
    def test_categories(self):
        for score, name in ((0.5, 'Strong'), (0.35, 'Strong'), (0.2, 'Good'), (0.0, 'Neutral'), (-0.2, 'Weak'), (-0.35, 'Very weak'), (None, None)):
            self.assertEqual(fundamentals.category(score), name, score)

    def test_rank_is_direction_aware_and_bounded(self):
        values = [1, 2, 3, 4, 5]
        self.assertEqual(fundamentals.rank(values, 5, True), 0.8)       # (4 + 0.5) / 5 → 0.9 → 0.8
        self.assertEqual(fundamentals.rank(values, 5, False), -0.8)
        self.assertEqual(fundamentals.rank(values, 3, True), 0.0)
        self.assertIsNone(fundamentals.rank(values, None, True))
        self.assertIsNone(fundamentals.rank([], 3, True))

    def test_metrics_come_from_each_source_and_missing_stay_missing(self):
        info = {'profitMargins': 0.1, 'marketCap': 1000, 'totalCash': 200, 'totalDebt': 100, 'freeCashflow': 50, 'operatingCashflow': 80,
                'netIncomeToCommon': 40, 'totalRevenue': 500, 'forwardEps': 5, 'trailingEps': 4, 'debtToEquity': 150, 'dividendYield': 0.02, 'payoutRatio': 0.6,
                'forwardPE': -3}
        er = {'fcf_3yr_cagr': 0.07, 'fundamental_strength': {'pillars': [{'key': 'financial_health', 'score': 64.9}]},
              'earnings_history': {'reports': [{'surprise_pct': 4.0}, {'surprise_pct': 6.0}]}}
        m, extras = fundamentals.metrics_from(info, er, {'roic': 12.0})
        self.assertEqual((m['netMargin'], m['roic'], m['fcfCagr3y'], m['erHealth']), (0.1, 0.12, 0.07, 64.9))
        self.assertAlmostEqual(m['netCashToCap'], 0.1)
        self.assertAlmostEqual(m['fcfYield'], 0.05)
        self.assertAlmostEqual(m['fcfMargin'], 0.1)
        self.assertAlmostEqual(m['cashConversion'], 2.0)
        self.assertAlmostEqual(m['forwardEpsGrowth'], 0.25)
        self.assertAlmostEqual(m['debtToEquity'], 1.5)
        self.assertAlmostEqual(m['surprise'], 0.05)
        self.assertAlmostEqual(m['payoutSafety'], 0.4)
        self.assertIsNone(m['forwardPE'])          # a negative P/E is not a valuation
        self.assertIsNone(m['roe'])
        no_div, _ = fundamentals.metrics_from({'dividendYield': 0, 'payoutRatio': 0})
        self.assertIsNone(no_div['dividendYield'])
        self.assertIsNone(no_div['payoutSafety'])

    def test_scoring_ranks_within_the_sector_and_needs_three_pillars(self):
        companies = {}
        for i in range(6):
            companies[f'T{i}'] = {'sector': 'Tech', 'metrics': {'netMargin': 0.10 + i / 100, 'revenueGrowth': 0.05 * i, 'debtToEquity': 1.0 - i / 10}}
            companies[f'B{i}'] = {'sector': 'Brokers', 'metrics': {'netMargin': 0.01 + i / 1000, 'revenueGrowth': 0.05 * i, 'debtToEquity': 1.0 - i / 10}}
        companies['THIN'] = {'sector': 'Tech', 'metrics': {'netMargin': 0.3}}
        medians = fundamentals.score_all(companies)
        # the best broker margin (1.5%) ranks at the top of its own sector even though it is far below every tech margin
        self.assertGreater(companies['B5']['ranks']['netMargin'], 0.6)
        self.assertLess(companies['T0']['ranks']['netMargin'], 0)
        self.assertEqual(companies['T5']['category'], 'Strong')
        self.assertIsNone(companies['THIN']['score'])             # one pillar only
        self.assertIn('netMargin', medians['Tech'])

    def test_build_uses_the_fetchers_and_reports_coverage(self):
        rows = [{'symbol': f'S{i}', 'sector': 'Tech'} for i in range(6)] + [{'symbol': 'EMPTY', 'sector': 'Tech'}]
        info = lambda s: {} if s == 'EMPTY' else {'profitMargins': 0.1 + int(s[1]) / 100, 'revenueGrowth': 0.1, 'debtToEquity': 50, 'forwardPE': 20}
        out = fundamentals.build(rows, fetch_info=info, fetch_er=lambda s: {})
        self.assertEqual(out['sources'], {'yahoo': 6, 'equityRank': 0, 'requested': 7})
        self.assertNotIn('EMPTY', out['stocks'])
        self.assertEqual(len(out['metrics']), len(fundamentals.METRICS))
        self.assertIn(out['stocks']['S5']['category'], ('Strong', 'Good', 'Neutral', 'Weak', 'Very weak'))


if __name__ == '__main__':
    unittest.main()
