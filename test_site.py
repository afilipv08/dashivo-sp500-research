import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import build_site


class SiteTests(unittest.TestCase):
    def test_market_history_includes_sp500_index(self):
        import pandas as pd
        index = pd.date_range('2026-11-20', periods=2, freq='D')
        columns = pd.MultiIndex.from_tuples([('Close', 'AAA'), ('Close', '^GSPC')])
        frame = pd.DataFrame([[10.0, 6000.0], [11.0, 6100.0]], index=index, columns=columns)
        fake = SimpleNamespace(download=lambda symbols, **kwargs: (self.assertIn('^GSPC', symbols) or frame))
        with patch.dict('sys.modules', {'yfinance': fake}):
            history = build_site.history(['AAA'])
        self.assertEqual(history['series']['^GSPC'], [6000.0, 6100.0])
        self.assertEqual(history['series']['AAA'], [10.0, 11.0])

    def test_build_without_network(self):
        with tempfile.TemporaryDirectory() as d, patch.object(build_site, 'SITE', Path(d) / 'site'), \
             patch('live_prices.cached', return_value={'at': '2026-11-22T10:00:00+02:00', 'prices': {'CBRE': 126.7}}), \
             patch('crypto.cached', return_value={'at': '2026-11-22T10:00:00+02:00', 'coins': [], '_btc': []}):
            site = build_site.build(refresh=False)
            html = (site / 'index.html').read_text(encoding='utf-8')
            self.assertIn('window.dashboardStatic=true', html)
            self.assertIn('rel="manifest"', html)
            self.assertIn('function staticApi', html)
            self.assertIn('Views.intrinsic', html)
            self.assertIn('Views.etoro', html)
            self.assertIn('Views.calendar', html)
            self.assertIn('Views.technical', html)
            self.assertIn('Views.fundamental', html)
            self.assertIn('ETORO_SLUG_ALIASES', html)
            self.assertIn('https://www.etoro.com/markets/', html)
            self.assertNotIn('ETORO_API_KEY', html)
            self.assertNotIn('x-api-key', html)
            self.assertNotIn('x-user-key', html)
            self.assertIn("route === '/api/intrinsic-values'", html)
            intrinsic = json.loads((site / 'data/intrinsic_values.json').read_text())
            self.assertEqual(intrinsic['sources']['sec']['status'], 'contact_required')
            self.assertNotIn('SEC_CONTACT_EMAIL', json.dumps(intrinsic))
            meta = json.loads((site / 'data/meta.json').read_text())
            self.assertTrue(meta['workflowUrl'].endswith('/actions/workflows/research.yml'))
            self.assertEqual(json.loads((site / 'data/live_prices.json').read_text())['prices'], {'CBRE': 126.7})
            self.assertNotIn('_btc', json.loads((site / 'data/crypto.json').read_text()))
            manifest = json.loads((site / 'manifest.webmanifest').read_text())
            self.assertEqual(manifest['display'], 'standalone')
            for f in ('icon-192.png', 'icon-512.png', 'sw.js', '.nojekyll', meta['report']):
                self.assertTrue((site / f).is_file(), f)


if __name__ == '__main__':
    unittest.main()
