from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import Workbook, load_workbook

import improvement
import yahoo_unificat


HEADERS = list(improvement.REQUIRED) + ['Distanta fata de minim (%)', 'Ora cotatiei (locala)', 'Underperform', 'Total Analysts']


def workbook(records):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Actiuni SP500'
    ws.append(HEADERS)
    for index, overrides in enumerate(records, 2):
        item = {'Simbol': f'S{index}', 'Companie': 'Test', 'Pret actiune': 110,
                'Minim 52 sapt.': 100, 'Moneda': 'USD', 'Consens': 'BUY',
                'Strong Buy': 5, 'Buy': 10, 'Hold': 0, 'Sell': 0, 'Tinta minima': 110,
                'Distanta fata de minim (%)': f'=C{index}/D{index}-1',
                'Ora cotatiei (locala)': '09.11.2026 09:00', 'Underperform': 0,
                'Total Analysts': 15}
        item.update(overrides)
        ws.append([item.get(name) for name in HEADERS])
    return wb


class SelectionTests(unittest.TestCase):
    def test_filters_and_invalid_data(self):
        wb = workbook([{'Simbol': 'OK', 'Hold': 1, 'Underperform': 2},
                       {'Consens': 'HOLD'}, {'Sell': 1}, {'Hold': 2},
                       {'Strong Buy': 4}, {'Buy': None}, {'Sell': None},
                       {'Pret actiune': 0}, {'Minim 52 sapt.': float('nan')},
                       {'Hold': -1}, {'Buy': 5.5}, {'Buy': True}, {'Simbol': ''},
                       {'Tinta minima': None}, {'Tinta minima': 0},
                       {'Tinta minima': -10}, {'Tinta minima': float('inf')}])
        self.assertEqual([x['symbol'] for x in improvement.select_candidates(wb.active)], ['OK'])
        wb.close()

    def test_target_distance_is_percentage_and_absolute(self):
        wb = workbook([{'Simbol': 'A', 'Pret actiune': 20, 'Tinta minima': 21},
                       {'Simbol': 'B', 'Pret actiune': 1000, 'Tinta minima': 980},
                       {'Simbol': 'C', 'Pret actiune': 100, 'Tinta minima': 100}])
        candidates = improvement.select_candidates(wb.active)
        self.assertEqual([x['symbol'] for x in candidates], ['C', 'B', 'A'])
        self.assertAlmostEqual(candidates[1]['target_gap'], -0.02)
        self.assertAlmostEqual(candidates[1]['target_distance'], 0.02)
        wb.close()

    def test_missing_columns_and_duplicates(self):
        wb = workbook([{}, {}])
        wb.active.cell(1, 1, 'Wrong')
        with self.assertRaisesRegex(ValueError, 'Coloane lipsa'):
            improvement.select_candidates(wb.active)
        wb.close()
        wb = workbook([{'Simbol': 'A'}, {'Simbol': 'A'}])
        with self.assertRaisesRegex(ValueError, 'duplicat'):
            improvement.select_candidates(wb.active)
        wb.close()


class ListFilterTests(unittest.TestCase):
    def test_boundaries_and_independent_filters(self):
        wb = workbook([{'Simbol': 'EDGE', 'Pret actiune': 112, 'Strong Buy': 0, 'Buy': 8, 'Hold': 2, 'Underperform': 2, 'Consens': 'HOLD'},
                       {'Simbol': 'OVER_DISTANCE', 'Pret actiune': 112.01, 'Buy': 4},
                       {'Simbol': 'BELOW_TOTAL', 'Strong Buy': 0, 'Buy': 9, 'Hold': 2},
                       {'Simbol': 'SELL', 'Buy': 4, 'Sell': 1},
                       {'Simbol': 'UNDERPERFORM', 'Buy': 5, 'Underperform': 3},
                       {'Simbol': 'MISSING', 'Hold': None}])
        ws = wb.active
        for row in range(2, ws.max_row+1):
            ws.cell(row, ws.max_column, '=SUM(H1:H5)')
        self.assertEqual(improvement.select_list_rows(ws), [2])
        improvement.add_filtered_list(wb, ws)
        compact = improvement.compact_report(wb)
        filtered = compact['Lista_Filtrata']
        self.assertEqual(filtered['A1'].value, improvement.LIST_FILTER_RULES)
        self.assertEqual(filtered['A4'].value, 'EDGE')
        self.assertEqual(filtered.max_row, 4)
        self.assertEqual(filtered.max_column, 24)
        self.assertEqual(filtered.freeze_panes, 'E4')
        self.assertEqual(next(iter(filtered.tables.values())).ref, 'A3:X4')
        compact.close()
        wb.close()


class ExportTests(unittest.TestCase):
    def test_end_to_end_and_collision(self):
        records = [{'Simbol': 'A', 'Strong Buy': 15, 'Buy': 0, 'Pret actiune': 108, 'Tinta minima': 108},
                   {'Simbol': 'B', 'Strong Buy': 0, 'Buy': 15, 'Pret actiune': 105, 'Tinta minima': 105},
                   {'Simbol': 'C', 'Strong Buy': 20, 'Buy': 0},
                   {'Simbol': 'D', 'Strong Buy': 19, 'Buy': 0},
                   {'Simbol': 'E', 'Strong Buy': 18, 'Buy': 0},
                   {'Simbol': 'F', 'Strong Buy': 17, 'Buy': 0}]
        with tempfile.TemporaryDirectory() as directory, patch.object(improvement, 'BASE', Path(directory)):
            source = Path(directory)/'source.xlsx'
            wb = workbook(records)
            wb.save(source)
            wb.close()
            original = source.read_bytes()
            now = datetime(2026, 11, 9, 9, 19)
            report, investment, ranked = improvement.process_report(source, now=now)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual([x['symbol'] for x in ranked], ['C', 'D', 'E', 'F', 'A', 'B'])
            self.assertEqual(investment.name, '09_11_2026_09-19AM_top_5_to_invest.xlsx')
            result = load_workbook(report)
            self.assertEqual(result.sheetnames, ['Lista_SP500', 'Lista_Filtrata'])
            self.assertEqual(result['Lista_SP500'].max_row, 7)
            for ws in result.worksheets:
                self.assertEqual([cell.value for cell in ws[3 if ws.title == 'Lista_Filtrata' else 1]], [label for label, _ in improvement.OUTPUT_COLUMNS])
                self.assertEqual(ws.max_column, 24)
                self.assertFalse(any(cell.data_type == 'f' for row in ws for cell in row))
            self.assertAlmostEqual(result['Lista_SP500'].cell(4, 7).value, 0.1)
            self.assertEqual(result['Lista_SP500'].cell(2, 1).value, 'A')
            self.assertEqual(result['Lista_Filtrata'].max_row, 9)
            result.close()
            simulation = load_workbook(investment, data_only=True)
            rows = list(simulation.active.values)[1:]
            self.assertEqual(sum(row[4] for row in rows), 500)
            for row in rows:
                self.assertAlmostEqual(row[3]*row[5], 100)
                self.assertEqual(row[7], 0)
            simulation.close()
            report2, investment2, _ = improvement.process_report(source, now=now)
            self.assertNotEqual(report, report2)
            self.assertNotEqual(investment, investment2)

    def test_empty_and_partial_selection(self):
        for records, expected in [([{'Hold': 2}], 0), ([{}], 1)]:
            with tempfile.TemporaryDirectory() as directory, patch.object(improvement, 'BASE', Path(directory)):
                source = Path(directory)/'source.xlsx'
                wb = workbook(records)
                wb.save(source)
                wb.close()
                report, investment, ranked = improvement.process_report(source)
                self.assertEqual(len(ranked), expected)
                simulation = load_workbook(investment)
                self.assertEqual(simulation.active.max_row, expected+1)
                simulation.close()
                result = load_workbook(report)
                self.assertEqual(result.sheetnames, ['Lista_SP500', 'Lista_Filtrata'])
                result.close()

    def test_non_usd_rejected_without_outputs(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(improvement, 'BASE', Path(directory)):
            source = Path(directory)/'source.xlsx'
            wb = workbook([{'Moneda': 'EUR'}])
            wb.save(source)
            wb.close()
            with self.assertRaisesRegex(ValueError, 'non-USD'):
                improvement.process_report(source)
            self.assertFalse((Path(directory)/'Investitii').exists())

    def test_live_export_integration_without_network(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(improvement, 'BASE', Path(directory)):
            values = [None]*len(yahoo_unificat.ANALYST_COLUMNS)
            values[:6] = ['BUY', 5, 10, 1, 0, 0]
            values[10] = 16
            values[13] = 110
            item = dict(symbol='TEST', company='Test', sector='Test', price=110, low=100,
                        high=120, distance=0.1, currency='USD', quote_time='Test',
                        price_field='currentPrice', status='OK', source='https://example.com',
                        analyst_values=values)
            with patch.object(yahoo_unificat, 'OUTPUT', Path(directory)/'Output'):
                source = yahoo_unificat.export([item], 'offline test', datetime.now(), limited=True)
            report, investment, ranked = improvement.process_report(source, copy_report=False)
            self.assertEqual(report, source.resolve())
            self.assertEqual(ranked[0]['symbol'], 'TEST')
            result = load_workbook(report)
            self.assertAlmostEqual(result['Lista_SP500']['G2'].value, 0.1)
            self.assertEqual(result['Lista_SP500']['K2'].value, 1)
            self.assertEqual(result['Lista_SP500']['N2'].value, 16)
            self.assertAlmostEqual(result['Lista_SP500']['O2'].value, 28/16)
            self.assertEqual(result['Lista_SP500']['T2'].value, 56)
            result.close()

    def test_closeness_precedes_score(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(improvement, 'BASE', Path(directory)):
            source = Path(directory)/'source.xlsx'
            wb = workbook([{'Simbol': 'HIGH_SCORE', 'Strong Buy': 50, 'Tinta minima': 165},
                           {'Simbol': 'CLOSE', 'Strong Buy': 5, 'Buy': 10, 'Tinta minima': 111},
                           {'Simbol': 'FOURTEEN', 'Strong Buy': 4, 'Buy': 10}])
            wb.save(source)
            wb.close()
            report, investment, ranked = improvement.process_report(source)
            self.assertEqual([x['symbol'] for x in ranked], ['CLOSE', 'HIGH_SCORE'])
            result = load_workbook(report)
            ws = result['Lista_SP500']
            self.assertEqual(ws['A2'].value, 'HIGH_SCORE')
            self.assertEqual(ws['Q2'].value, 165)
            self.assertEqual(ws.max_column, 24)
            self.assertEqual(ws['G2'].number_format, '0.00%')
            result.close()

    def test_hold_is_not_a_list_filter(self):
        wb = workbook([{'Hold': 8, 'Underperform': 2, 'Total Analysts': 25},
                       {'Hold': 0, 'Underperform': 3, 'Total Analysts': 25},
                       {'Underperform': None}, {'Underperform': -1}])
        self.assertEqual(improvement.select_list_rows(wb.active), [2])
        wb.close()

    def test_rebuild_compact_output_with_inferred_hold(self):
        wb = workbook([{'Strong Buy': 0, 'Buy': 10, 'Hold': 2, 'Total Analysts': 12}])
        first = improvement.two_sheet_report(wb.active)
        second = improvement.two_sheet_report(first['Lista_SP500'])
        self.assertEqual(second.sheetnames, ['Lista_SP500', 'Lista_Filtrata'])
        self.assertEqual(second['Lista_Filtrata'].max_row, 4)
        self.assertEqual(second['Lista_Filtrata']['N4'].value, 12)
        second.close()
        first.close()
        wb.close()

    def test_cli_offline_does_not_fetch(self):
        with patch('sys.argv', ['yahoo_unificat.py', '--input-excel', 'existing.xlsx']), \
             patch.object(improvement, 'process_report') as process, \
             patch.object(yahoo_unificat, 'constituents', side_effect=AssertionError('Network called')):
            self.assertEqual(yahoo_unificat.main(), 0)
            process.assert_called_once_with(Path('existing.xlsx'))


if __name__ == '__main__':
    unittest.main()
