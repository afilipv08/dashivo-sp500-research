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
            result = json.loads(data)
            self.assertEqual(result['bulkCount'], 1)
            self.assertTrue(result['fullUniverse'])
            self.assertEqual(len(result['allItems']), 1)
            self.assertEqual(len(result['items']), 1)
            self.assertEqual(result['items'][0]['company'], row['Conpanie'])
            self.assertNotIn('__DATA_JSON__', html)
            self.assertNotIn('__IMPORT_JS__', html)
            self.assertNotIn('__FILTER_JS__', html)
            self.assertNotIn('__THEME_CSS__', html)
            self.assertNotIn('__THEME_JS__', html)
            self.assertNotIn('__LANGUAGE_JS__', html)
            self.assertIn('id="languageSelect"', html)
            self.assertIn('id="themeSelect"', html)
            self.assertIn('data-theme="red"', html)
            self.assertIn('sp500-dashivo-language', html)
            self.assertIn('id="themeButton"', html)
            self.assertIn('class="side"', html)
            self.assertIn('--bg:#0f0e0f', html)
            self.assertIn('data-theme="light"', html)
            self.assertIn('Dashivo-SimpleBudget.html', html)
            for field in ('distanceMax', 'analystsMin', 'sellExact', 'underMax', 'holdMax'):
                self.assertIn(f'id="{field}"', html)
            self.assertIn('matchesCriteria', html)
            self.assertIn("$('holdMax').value='2'", html)
            self.assertIn('r.hold<=c.hold', html)
            self.assertIn('id="importButton"', html)
            self.assertIn('id="importProgress"', html)
            self.assertIn("DecompressionStream('deflate-raw')", html)
            self.assertIn('refreshDashboard();', html)
            self.assertIn('Lista_Filtrata', html)
            self.assertNotIn('src="https://', html)


if __name__ == '__main__':
    unittest.main()
