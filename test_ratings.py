from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

import ratings


class RatingTests(unittest.TestCase):
    def test_fetch_normalises_yahoo_frame(self):
        frame = pd.DataFrame({'Firm': ['A', 'B'], 'ToGrade': ['Buy', 'Neutral'], 'FromGrade': ['Neutral', ''], 'Action': ['up', 'init'],
                              'priceTargetAction': ['Raises', 'Announces'], 'currentPriceTarget': [130.0, 0.0], 'priorPriceTarget': [120.0, float('nan')]},
                             index=pd.to_datetime(['2026-11-01', '2026-11-10']))
        with patch('yfinance.Ticker') as ticker:
            ticker.return_value.upgrades_downgrades = frame
            rows = ratings.fetch('AAA')
        self.assertEqual(rows[0], {'date': '2026-11-10', 'firm': 'B', 'from': None, 'to': 'Neutral', 'action': 'init', 'targetAction': 'Announces', 'target': None, 'priorTarget': None})
        self.assertEqual((rows[1]['to'], rows[1]['target'], rows[1]['priorTarget']), ('Buy', 130.0, 120.0))

    def test_history_caches_and_validates(self):
        with tempfile.TemporaryDirectory() as d, patch.object(ratings, 'PATH', Path(d) / 'r.json'), \
             patch.object(ratings, 'fetch', return_value=[{'date': '2026-11-10', 'to': 'Buy'}]) as f:
            self.assertEqual(ratings.history('aaa')['rows'][0]['to'], 'Buy')
            ratings.history('AAA')
            f.assert_called_once_with('AAA')
            with self.assertRaises(ValueError):
                ratings.history('bad symbol!')


if __name__ == '__main__':
    unittest.main()
