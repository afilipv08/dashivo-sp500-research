from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

import live_prices


class LivePriceTests(unittest.TestCase):
    def test_last_close_from_multi_and_single_frames(self):
        idx = pd.to_datetime(['2026-11-19', '2026-11-20'])
        multi = pd.DataFrame({('Close', 'AAA'): [10.0, 11.0], ('Close', 'BBB'): [5.0, float('nan')], ('Open', 'AAA'): [1, 1]}, index=idx)
        multi.columns = pd.MultiIndex.from_tuples(multi.columns)
        self.assertEqual(live_prices.last_closes(multi, ['AAA', 'BBB']), {'AAA': 11.0, 'BBB': 5.0})
        single = pd.DataFrame({'Close': [3.0, 4.0], 'Open': [1, 1]}, index=idx)
        self.assertEqual(live_prices.last_closes(single, ['CCC']), {'CCC': 4.0})
        self.assertEqual(live_prices.last_closes(pd.DataFrame(), ['X']), {})

    def test_refresh_saves_cache_and_validates(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'live.json'
            with patch.object(live_prices, 'download', return_value={'AAA': 12.5}) as dl:
                data = live_prices.refresh(['aaa', 'BBB', 'bad symbol!', 'AAA'], path)
            dl.assert_called_once_with(['AAA', 'BBB'])
            self.assertEqual((data['prices'], data['missing']), ({'AAA': 12.5}, ['BBB']))
            self.assertEqual(live_prices.cached(path)['prices'], {'AAA': 12.5})
            with patch.object(live_prices, 'download', return_value={'BBB': 3.0}):
                data = live_prices.refresh(['AAA', 'BBB'], path)   # AAA dropped by Yahoo this time
            self.assertEqual((data['prices'], data['stale'], data['missing']), ({'BBB': 3.0, 'AAA': 12.5}, ['AAA'], []))
            with self.assertRaises(ValueError):
                live_prices.refresh(['!!'], path)
            with patch.object(live_prices, 'download', return_value={}), self.assertRaises(RuntimeError):
                live_prices.refresh(['AAA'], path)
            self.assertEqual(live_prices.cached(path)['prices'], {'BBB': 3.0, 'AAA': 12.5})   # a failed refresh keeps the cache


if __name__ == '__main__':
    unittest.main()
