import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_site


class SiteTests(unittest.TestCase):
    def test_build_without_network(self):
        with tempfile.TemporaryDirectory() as d, patch.object(build_site, 'SITE', Path(d) / 'site'), \
             patch('live_prices.cached', return_value={'at': '2026-11-22T10:00:00+02:00', 'prices': {'CBRE': 126.7}}), \
             patch('crypto.cached', return_value={'at': '2026-11-22T10:00:00+02:00', 'coins': [], '_btc': []}):
            site = build_site.build(refresh=False)
            html = (site / 'index.html').read_text(encoding='utf-8')
            self.assertIn('window.dashboardStatic=true', html)
            self.assertIn('rel="manifest"', html)
            self.assertIn('function staticApi', html)
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
