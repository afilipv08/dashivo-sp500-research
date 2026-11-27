import math
import unittest

import numpy as np
import pandas as pd

import technical


def frame(close, volume=None, spread=0.01):
    idx = pd.bdate_range('2023-01-02', periods=len(close))
    c = pd.Series(close, index=idx, dtype=float)
    return pd.DataFrame({'Open': c.shift().fillna(c), 'High': c * (1 + spread), 'Low': c * (1 - spread), 'Close': c,
                         'Volume': pd.Series(volume if volume is not None else [1e6] * len(close), index=idx, dtype=float)})


class TechnicalTests(unittest.TestCase):
    def test_categories_use_tradingview_thresholds(self):
        cases = {-0.9: 'Strong Sell', -0.5: 'Sell', -0.11: 'Sell', -0.1: 'Neutral', 0.0: 'Neutral', 0.1: 'Neutral', 0.11: 'Buy', 0.5: 'Buy', 0.51: 'Strong Buy'}
        for value, name in cases.items():
            self.assertEqual(technical.category(value), name, value)
        self.assertIsNone(technical.category(None))
        self.assertIsNone(technical.category(float('nan')))

    def test_primitives_match_hand_calculations(self):
        s = pd.Series([1.0, 2, 3, 4, 5])
        self.assertEqual(technical.sma(s, 3).tolist()[2:], [2.0, 3.0, 4.0])
        self.assertAlmostEqual(technical.wma(s, 3).iloc[-1], (3 * 1 + 4 * 2 + 5 * 3) / 6)
        rising = pd.Series(np.arange(1, 40, dtype=float))
        self.assertEqual(technical.rsi(rising).iloc[-1], 100.0)          # no losses at all
        falling = pd.Series(np.arange(40, 1, -1, dtype=float))
        self.assertAlmostEqual(technical.rsi(falling).iloc[-1], 0.0)
        # stochastic at the top of its 14-day range is 100
        df = frame(np.arange(1, 40, dtype=float), spread=0)
        k, d = technical.stochastic(df['High'], df['Low'], df['Close'])
        self.assertAlmostEqual(k.iloc[-1], 100.0)
        m, sig = technical.macd(pd.Series(np.arange(1, 80, dtype=float)))
        self.assertGreater(m.iloc[-1], 0)

    def test_votes_agree_with_a_clean_uptrend_and_downtrend(self):
        up = frame(100 * 1.002 ** np.arange(400))
        down = frame(100 * 0.998 ** np.arange(400))
        bench = frame(100 * 1.0005 ** np.arange(400))['Close']
        for df, sign in ((up, 1), (down, -1)):
            votes = technical.ma_votes(df)
            self.assertTrue(all(v.iloc[-1] == sign for name, v in votes.items() if name not in ('Ichimoku Cloud', 'Hull MA 9')))   # Hull leads a perfectly smooth curve, either side
            self.assertEqual(np.sign(technical.macd(df['Close'])[0].iloc[-1]), sign)   # on a perfect curve line and signal converge
        self.assertEqual(technical.strength_votes(up['Close'], bench)['vs S&P 500, 6 months'].iloc[-1], 1)
        self.assertEqual(technical.strength_votes(down['Close'], bench)['vs S&P 500, 6 months'].iloc[-1], -1)
        # an indicator without enough history does not vote
        self.assertTrue(math.isnan(technical.ma_votes(frame(np.arange(1, 60, dtype=float)))['SMA 200'].iloc[-1]))

    def test_analyse_returns_a_complete_dated_result(self):
        rng = np.random.default_rng(1)
        close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.015, 700)))
        df = frame(close, volume=rng.integers(1_000_000, 3_000_000, 700))
        bench = frame(100 * np.exp(np.cumsum(rng.normal(0.0003, 0.01, 700))))['Close']
        out = technical.analyse(df, bench)
        self.assertEqual(out['price'], round(close[-1], 2))
        self.assertIn(out['rating']['category'], technical.CATEGORIES)
        self.assertEqual(len(out['votes']['ma']), 15)
        self.assertEqual(len(out['votes']['osc']), 11)
        for key in ('ma', 'osc', 'tv', 'volume', 'strength', 'composite'):
            self.assertTrue(-1 <= out['rating'][key] <= 1, key)
        self.assertIsNotNone(out['weekly'])
        self.assertTrue(0 <= out['levels']['position52'] <= 1)
        self.assertEqual(out['track']['horizon'], technical.FORWARD_DAYS)
        self.assertEqual(sum(v['days'] for v in out['track']['byCategory'].values()), technical.TRACK_DAYS)
        self.assertIsNone(technical.analyse(frame(np.arange(1, 30, dtype=float)), bench))   # too short

    def test_track_record_measures_forward_returns_per_category(self):
        idx = pd.bdate_range('2024-01-01', periods=60)
        close = pd.Series(np.linspace(100, 160, 60), index=idx)
        bench = pd.Series(100.0, index=idx)
        rating = pd.Series([0.8] * 60, index=idx)                 # always Strong Buy on a rising line
        tr = technical.track_record(rating, close, bench, days=10, horizon=5)
        self.assertEqual(list(tr['byCategory']), ['Strong Buy'])
        row = tr['byCategory']['Strong Buy']
        self.assertEqual((row['days'], row['hitRate']), (10, 1.0))
        expected = (close.shift(-5) / close - 1).dropna().iloc[-10:].mean()
        self.assertAlmostEqual(row['avgReturn'], round(expected, 4))
        agg = technical.aggregate_track([tr, tr])
        self.assertEqual(agg['byCategory']['Strong Buy']['days'], 20)

    def test_build_uses_the_downloaded_frame_and_skips_missing_symbols(self):
        rng = np.random.default_rng(2)
        idx = pd.bdate_range('2023-01-02', periods=400)
        parts = {}
        for t in ('AAA', 'BRK-B', '^GSPC'):
            c = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 400)))
            parts[t] = pd.DataFrame({'Open': c, 'High': c * 1.01, 'Low': c * 0.99, 'Close': c, 'Volume': 1e6}, index=idx)
        raw = pd.concat(parts, axis=1)
        out = technical.build(['AAA', 'BRK.B', 'MISSING'], download=lambda tickers: raw)
        self.assertEqual(sorted(out['stocks']), ['AAA', 'BRK.B'])
        self.assertNotIn('_rows', str(out['stocks']['AAA']['track']))
        self.assertEqual(out['track']['stocks'], 2)


if __name__ == '__main__':
    unittest.main()
