import json
from datetime import date, timedelta
import unittest

import numpy as np
import pandas as pd

import signals

# Vistra's filings (USD millions) as checked by hand against SEC EDGAR on 28.11.2026
VST = dict(end='2026-09-30', rev_q=6347, rev_q_ly=4971, rev_q1=4017, rev_q1_ly=4250, op_q=1706, op_q_ly=1037,
           rev_ttm=20588, rev_ttm_prev=17191, op_ttm=4232, op_ttm_prev=2031, ni_ttm=2707, ni_ttm_prev=1152,
           cfo_ttm=5762, cfo_ttm_prev=3991, capex_ttm=3155, da_ttm=2103, da_ttm_prev=2060, sga_ttm=1727, sga_ttm_prev=1718,
           gp_ttm=None, gp_ttm_prev=None, buyback_ttm=1169, assets=45029, assets_prev=38020, assets_prev2=37878,
           liab=38566, liab_prev=32797, equity=6306, ltd=21146, ltd_prev=15988, cash=2743, ca=13367, cl=11549, ca_prev=8381, cl_prev=8426,
           re=2091, ar=2763, ar_prev=2327, ppe=19089, ppe_prev=17725, shares_q=337.852657, shares_q_ly=345.03516,
           mcap=339.394683 * 122.65, fcf_hist=[3777, 2485, 1318])


def prices(n=520, start=100.0, drift=0.0005, seed=1, end=None):
    rng = np.random.default_rng(seed)
    close = start * np.exp(np.cumsum(drift + rng.normal(0, 0.01, n)))
    idx = pd.bdate_range(end=end or pd.Timestamp('2026-11-27'), periods=n)
    return pd.DataFrame({'Open': close * 0.999, 'High': close * 1.01, 'Low': close * 0.99, 'Close': close, 'Volume': 1e6}, index=idx)


def context(label='Neutral', sectors=None):
    return {'regime': {'label': label, 'score': 0, 'risk': 0.005, 'items': []}, 'sectors': sectors or [], 'macro': {}, 'seasonality': {}, 'crossAsset': {}}


class FundamentalsTests(unittest.TestCase):
    def test_quality_checks_match_the_vistra_report(self):
        q = signals.quality_checks(VST)
        self.assertEqual((q['passed'], q['known'], q['score']), (5, 5, 2))
        self.assertAlmostEqual(q['revGrowth'], 0.2768, places=4)
        self.assertAlmostEqual(q['netDebtEbitda'], 2.9, places=2)

    def test_quality_is_unknown_when_fewer_than_three_checks_apply(self):
        bank = {'rev_q': 100, 'rev_q_ly': 90, 'rev_q1': 95, 'rev_q1_ly': 90}
        q = signals.quality_checks(bank)
        self.assertEqual(q['known'], 2)
        self.assertIsNone(q['score'])

    def test_piotroski_and_red_flags_match_hand_calculations(self):
        pio = signals.piotroski(VST)
        self.assertEqual(pio['score'], 8)
        self.assertFalse(next(t for t in pio['tests'] if t['label'].startswith('Long-term debt'))['ok'])
        self.assertAlmostEqual(pio['pb'], 6.6, places=1)
        rf = signals.red_flags(VST, 'Utilities')
        self.assertAlmostEqual(rf['altman'], 1.53, places=2)
        self.assertAlmostEqual(rf['altmanZ2'], 1.22, places=2)
        self.assertAlmostEqual(rf['beneish'], -2.64, places=2)
        self.assertIsNone(signals.red_flags(VST, 'Financials')['altman'])

    def test_reverse_dcf_growth(self):
        g = signals.implied_growth(41627, 2607)
        self.assertAlmostEqual(g, 0.0258, places=3)
        self.assertIsNone(signals.implied_growth(41627, -5))
        self.assertAlmostEqual(signals.cagr([100, 121]) or 0, 0, places=6)   # fewer than 3 points: not meaningful
        self.assertAlmostEqual(signals.cagr([100, 110, 121]), 0.10, places=6)

    def test_facts_derive_ttm_and_fourth_quarter(self):
        def row(start, end, val, form='10-Q', filed='2026-01-01'):
            return {'start': start, 'end': end, 'val': val, 'form': form, 'filed': filed}
        rows = [row('2024-01-01', '2024-12-31', 400, '10-K'), row('2024-01-01', '2024-09-30', 290), row('2025-01-01', '2025-09-30', 330),
                row('2025-07-01', '2025-09-30', 120), row('2025-01-01', '2025-12-31', 460, '10-K'), row('2025-01-01', '2025-09-30', 330, '10-K')]
        facts = signals.Facts({'facts': {'us-gaap': {'Revenues': {'units': {'USD': rows}}}}})
        self.assertEqual(facts.ttm(['Revenues'], '2025-09-30'), 330 + 400 - 290)
        self.assertEqual(facts.quarter(['Revenues'], '2025-09-30'), 120)
        self.assertEqual(facts.quarter(['Revenues'], '2025-12-31'), 460 - 330)
        self.assertEqual(facts.ttm(['Revenues'], '2025-12-31'), 460)


class SignalTests(unittest.TestCase):
    def test_insider_cluster_and_big_sellers(self):
        today = date(2026, 11, 28)
        d = lambda n: (today - timedelta(days=n)).isoformat()
        trades = [{'date': d(3), 'name': n, 'code': 'P', 'shares': 1000, 'price': 50, 'value': 50000, 'after': 10000} for n in ('A', 'B', 'C')]
        trades.append({'date': d(40), 'name': 'D', 'code': 'S', 'shares': 300, 'price': 60, 'value': 18000, 'after': 700})
        s = signals.summarize_insiders(trades, today)
        self.assertEqual((s['buyers14'], s['buyers30'], s['value14']), (3, 3, 150000))
        self.assertEqual(s['bigSellers'], ['D'])

    def test_new_text_share_ignores_years_and_amounts(self):
        a = 'We may lose customers in 2025 because of competition from larger firms. Our debt of $3 billion could limit our ability to invest in growth.'
        b = 'We may lose customers in 2026 because of competition from larger firms. Our debt of $5 billion could limit our ability to invest in growth.'
        share, n = signals.new_text_share(b, a)
        self.assertEqual((share, n), (0.0, 2))
        share, _ = signals.new_text_share(b + ' A new cyber attack could stop our plants for several weeks in a row.', a)
        self.assertAlmostEqual(share, 1 / 3)

    def test_market_context_regime(self):
        idx = pd.bdate_range(end='2026-11-27', periods=300)
        up = pd.DataFrame({'Close': np.linspace(100, 160, 300)}, index=idx)
        px = {'SPY': up, '^VIX': pd.DataFrame({'Close': np.full(300, 15.0)}, index=idx), '^VIX3M': pd.DataFrame({'Close': np.full(300, 17.0)}, index=idx)}
        for etf in signals.SECTOR_ETF.values():
            px[etf] = up
        hy = pd.Series(np.linspace(4.0, 3.0, 250), index=pd.bdate_range(end='2026-11-27', periods=250))
        ctx = signals.market_context(px, {'BAMLH0A0HYM2': hy}, [{'lev_money_positions_long': '1', 'lev_money_positions_short': '0', 'report_date_as_yyyy_mm_dd': '2026-11-17T00'}] * 10,
                                     today=date(2026, 11, 28))
        self.assertEqual(ctx['regime']['label'], 'Risk-on')
        self.assertEqual(len(ctx['sectors']), 11)
        self.assertEqual(ctx['sectors'][0]['score'], 2)
        self.assertTrue(ctx['seasonality']['strongHalf'])

    def test_good_business_bad_timing_is_watch_and_risk_off_blocks_buy(self):
        p = {'close': 122.65, 'ma50': 139.16, 'ma200': 150.6, 'rsi14': 42.6, 'range4w': 144.7, 'lastVol': 1.6e6, 'avgVol50': 6.7e6,
             'ma50_20': 145.0, 'r1m': -0.14, 'atr': 7.13, 'low52': 110.89}
        q = signals.quality_checks(VST)
        ctx = context('Risk-off', [{'sector': 'Utilities', 'rank': 6, 'score': 0}])
        f = signals.funnel_score(p, q, {'buyers30': 0, 'bigSellers': []}, {'shortPercentOfFloat': 0.033}, {}, 'Utilities', ctx)
        self.assertEqual((f['quality'], f['positioning'], f['timing'], f['sector'], f['final'], f['raw']), (2, 0.0, -2, 0, 0.1, 'PASS'))
        methods = [signals.M(10, 'FLAG', -1, 'Altman Z 1.53')]
        c = signals.conclude(p, q, f, methods, {}, ctx, {})
        self.assertEqual(c['decision'], 'WATCH')
        self.assertTrue(any('50-day' in t for t in c['triggers']))
        self.assertIn('52-week low', c['invalidation'])
        strong = {**f, 'raw': 'BUY', 'timing': 2, 'final': 1.5}
        self.assertEqual(signals.conclude(p, q, strong, [signals.M(10, 'CLEAN', 0, '')], {}, ctx, {})['decision'], 'WATCH')
        self.assertEqual(signals.conclude(p, q, strong, [signals.M(10, 'CLEAN', 0, '')], {}, context('Risk-on'), {})['decision'], 'BUY')

    def test_target_symbols_keeps_order_and_limit(self):
        days = {'days': [{'date': '2026-11-27', 'presets': {'a': {'items': [{'symbol': 'X'}, {'symbol': 'Y'}]}}},
                         {'date': '2026-11-26', 'presets': {'a': {'items': [{'symbol': 'OLD'}]}}}]}
        self.assertEqual(signals.target_symbols({'items': [{'symbol': 'Y'}, {'symbol': 'Z'}]}, days), ['X', 'Y', 'Z'])
        self.assertEqual(len(signals.target_symbols({'items': [{'symbol': str(i)} for i in range(200)]}, None)), signals.MAX_SYMBOLS)

    def test_build_without_network_is_json_safe(self):
        frames = {'AAA': prices(seed=2), 'BBB': prices(seed=3, drift=-0.0005)}
        for t in signals.MARKET_TICKERS:
            frames[t] = prices(seed=sum(map(ord, t)))

        def download(tickers):
            return pd.concat({t: frames[t] for t in tickers if t in frames}, axis=1)

        class FakeHttp:
            def get(self, url, binary=False):
                if 'fredgraph' in url:
                    rows = ['DATE,V'] + [f"{d:%Y-%m-%d},{3 + i / 1000:.3f}" for i, d in enumerate(pd.bdate_range(end='2026-11-27', periods=300))]
                    return '\n'.join(rows)
                raise OSError('offline')

            def json(self, url):
                if 'apewisdom' in url:
                    return {'results': [{'ticker': 'AAA', 'mentions': 50, 'mentions_24h_ago': 40, 'rank': 3}]}
                raise OSError('offline')
        data = {'items': [{'symbol': 'AAA'}, {'symbol': 'BBB'}], 'allItems': [{'symbol': 'AAA', 'sector': 'Energy'}, {'symbol': 'BBB', 'sector': 'Energy'}]}
        hist = {'dates': [d.strftime('%Y-%m-%d') for d in frames['AAA'].index[-250:]],
                'series': {s: [round(float(x), 2) for x in frames[s]['Close'].iloc[-250:]] for s in ('AAA', 'BBB')}}
        out = signals.build(data, hist, None, http=FakeHttp(), download=download, extras_fn=lambda s: {}, today=date(2026, 11, 28))
        json.dumps(out, allow_nan=False)
        self.assertEqual(set(out['stocks']), {'AAA', 'BBB'})
        self.assertEqual(out['sources']['sec']['status'], 'contact_required')
        self.assertEqual(out['sources']['cftc']['status'], 'unavailable')
        stock = out['stocks']['AAA']
        self.assertEqual([m['id'] for m in stock['methods']], list(range(1, 28)))
        self.assertIn(stock['conclusion']['decision'], ('BUY', 'WATCH', 'PASS', 'AVOID'))
        self.assertEqual(next(m for m in stock['methods'] if m['id'] == 9)['verdict'], 'NO DATA')
        self.assertEqual(next(m for m in stock['methods'] if m['id'] == 17)['data']['symbol'], 'BBB')
        self.assertFalse(stock['funnel']['qualityKnown'])
        self.assertNotEqual(stock['conclusion']['decision'], 'BUY')


if __name__ == '__main__':
    unittest.main()
