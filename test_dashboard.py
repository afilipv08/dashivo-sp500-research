import json
from pathlib import Path
import re
import tempfile
import unittest

from openpyxl import Workbook

import dashboard


class DashboardTests(unittest.TestCase):
    def record(self, **overrides):
        row = {'Simbol': 'TEST', 'Conpanie': 'Test', 'Pret actiune': 100, 'Min. 52 wk': 95,
               'Tinta minima': 90, 'Tinta medie': 120, 'Tinta maxima': 140,
               'Strong Buy': 8, 'Buy': 6, 'Underperform': 2, 'Sell': 0, 'Total Analysts': 20}
        row.update(overrides)
        return row

    def test_ratios_and_hold(self):
        item = dashboard.analyze(self.record())
        self.assertEqual(item['hold'], 4)
        self.assertAlmostEqual(item['gap'], .1)
        self.assertAlmostEqual(item['upside'], .2)
        self.assertAlmostEqual(item['support'], .7)
        self.assertEqual(item['weighted'], 18)
        self.assertEqual(item['issues'], [])

    def test_explicit_hold_and_legacy_fallback(self):
        self.assertEqual(dashboard.analyze(self.record())['Hold'], 4)
        item = dashboard.analyze(self.record(Hold=4))
        self.assertEqual(item['hold'], 4)
        self.assertIsNone(dashboard.analyze(self.record(Hold=3))['hold'])
        self.assertIsNone(dashboard.analyze(self.record(Hold=None))['hold'])

    def test_invalid_counts_and_targets(self):
        item = dashboard.analyze(self.record(**{'Total Analysts': 2, 'Tinta minima': 150}))
        self.assertIsNone(item['hold'])
        self.assertIsNone(item['support'])
        self.assertGreaterEqual(len(item['issues']), 2)
        item = dashboard.analyze(self.record(**{'Pret actiune': 0, 'Tinta medie': None}))
        self.assertIsNone(item['upside'])
        self.assertIsNone(item['gap'])

    def test_export_embeds_data_safely(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'SP500_16_11_2026_10-58-47.xlsx'
            wb = Workbook()
            bulk = wb.active
            bulk.title = 'Lista_SP500'
            row = self.record(Conpanie='</script><img src=x onerror=alert(1)>')
            bulk.append(list(row))
            bulk.append(list(row.values()))
            ws = wb.create_sheet('Lista_Filtrata')
            ws.append(['Distanta <= 12% | Underperform <= 2'])
            ws.append([])
            ws.append(list(row))
            ws.append(list(row.values()))
            wb.save(path)
            wb.close()
            html = dashboard.export_dashboard(path).read_text(encoding='utf-8')
            data = re.search(r'<script id="data" type="application/json">(.*?)</script>', html, re.S).group(1)
            self.assertNotIn('<img', data)
            self.assertEqual(json.loads(data)['schema'], dashboard.PAYLOAD_SCHEMA)
            result = json.loads(data)
            self.assertEqual(result['bulkCount'], 1)
            self.assertTrue(result['fullUniverse'])
            self.assertEqual(len(result['allItems']), 1)
            self.assertEqual(len(result['items']), 1)
            self.assertEqual(result['items'][0]['company'], row['Conpanie'])
            for marker in ('__DATA_JSON__', '__CSS__', '__JS__', '__LOGO_SRC__', '__LOGO_WHITE__', '__MARK_SRC__'):
                self.assertNotIn(marker, html)
            # shared Dashivo shell: 3 designs, 6 languages, collapsible menu, tour, real logo
            for design in ("id: 'dashivo'", "id: 'midnight'", "id: 'cream'", 'html[data-theme=cream]', 'html[data-theme=dashivo]'):
                self.assertIn(design, html)
            self.assertIn("const DEFAULT_THEME = 'dashivo'", html)
            for code in ('en', 'de', 'fr', 'es', 'it', 'ro'):
                self.assertIn(f"code: '{code}'", html)
            self.assertIn("defaultLang: 'ro'", html)
            self.assertIn('function toggleSide', html)
            self.assertIn('const TOUR_STEPS', html)
            self.assertIn('const LOGO_SRC = "data:image/png;base64,', html)
            self.assertIn('Reusable_Skill_Dashboards', html)
            # pages and SP500 behaviour
            for page in ('overview', 'research', 'top10', 'sectors', 'history', 'simulations', 'filtered', 'universe', 'method'):
                self.assertIn(f'Views.{page} =', html)
            for field in ('distanceMax', 'analystsMin', 'sellExact', 'underMax', 'holdMax'):
                self.assertIn(f"{field}", html)
            self.assertIn('const DEFAULT_FILTERS = () => ({ distance: 12, analysts: 12, sell: 0, under: 2, hold: 2, positive: null', html)
            self.assertIn('r.hold <= f.hold', html)
            for preset in ("id: 'default'", "id: 'excel'", "id: 'top5'"):
                self.assertIn(preset, html)
            self.assertIn('function excludedBy', html)
            # demo portfolio page and Invest dialog
            self.assertIn('Views.portfolio =', html)
            self.assertIn('function openInvest', html)
            self.assertIn('PRICE_EVERY = 5 * 60 * 1000', html)
            self.assertIn('function loadLivePrices', html)
            self.assertIn('Views.ai =', html)
            for page in ('crypto', 'levels', 'cycles', 'xsent'):
                self.assertIn(f'Views.{page} =', html)
            self.assertIn("const SECTIONS = { stock:", html)
            self.assertIn('https://grok.com/?q=', html)
            self.assertIn('function phoneCard', html)
            self.assertIn('Views.history =', html)
            self.assertIn('Views.simulations =', html)
            self.assertIn('function simOutcome', html)
            self.assertIn("'/api/market-history'", html)
            self.assertIn('const nf1 =', html)
            self.assertIn('52wk low', html)
            self.assertIn("class: 'rng-lb ' + key", html)
            self.assertIn('function sectorRows()', html)
            self.assertIn('Filter this sector in Top 10 & filters', html)
            self.assertIn('function saveTop10', html)
            self.assertIn('var qrcode = function', html)
            self.assertIn('Views.settings =', html)
            self.assertIn('https://chatgpt.com/?q=', html)
            self.assertIn("LIVE_COL = 'Live price'", html)
            self.assertIn("DecompressionStream('deflate-raw')", html)
            self.assertIn('Lista_Filtrata', html)
            self.assertIn('<script id="data"', html)
            self.assertNotIn('src="https://', html)


if __name__ == '__main__':
    unittest.main()
