import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import pandas as pd

import yahoo_unificat as yu


def frame(*symbols):
    return pd.DataFrame({'Symbol': list(symbols), 'Security': list(symbols), 'GICS Sector': ['Test'] * len(symbols)})


def item(symbol):
    return dict(symbol=symbol, company=symbol, sector='Test', price=10.0, low=9.0, high=12.0, distance=10/9-1,
                position=1/3, currency='USD', quote_time='x', price_field='regularMarketPrice', status='OK',
                source='https://example.com', analyst_values=[None]*len(yu.ANALYST_COLUMNS))


class HelperTests(unittest.TestCase):
    def test_rate_limit_detection(self):
        self.assertTrue(yu.is_rate_limited(Exception('429 Client Error: Too Many Requests')))
        self.assertTrue(yu.is_rate_limited(type('YFRateLimitError', (Exception,), {})('slow down')))
        self.assertFalse(yu.is_rate_limited(ValueError('404 Not Found')))

    def test_gate_pauses_after_limit(self):
        gate = yu.RateGate()
        gate.limited()
        self.assertGreater(gate.until - time.monotonic(), 5)
        gate.ok()
        self.assertEqual(gate.strikes, 0)

    def test_view_more_is_removed(self):
        self.assertEqual(yu.clean_rating_text('64 -> 67 View More'), '64 -> 67')
        self.assertEqual(yu.clean_rating_text('-- View More'), '—')


class ResumeTests(unittest.TestCase):
    def run_main(self, directory, argv, symbols):
        calls = []
        def research(record):
            calls.append(record['Symbol'])
            return item(record['Symbol'])
        with patch.object(yu, 'OUTPUT', Path(directory)), patch.object(yu, 'yf', object()), \
             patch.object(yu, 'constituents', return_value=(frame(*symbols), 'test')), \
             patch.object(yu, 'research_item', side_effect=research), \
             patch.object(yu, 'export', return_value=Path(directory)/'r.xlsx') as export, \
             patch('improvement.process_report', return_value=(Path(directory)/'r.xlsx', None, [])), patch.object(yu, 'preview'), \
             patch('sys.argv', ['yahoo_unificat.py', *argv]):
            self.assertEqual(yu.main(), 0)
        return calls, export.call_args[0][0]

    def test_resume_skips_saved_symbols_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(yu, 'OUTPUT', Path(directory)):
                path = yu.checkpoint_path()
            lines = [{'meta': {'started': '2026-11-20T09:00:00+02:00', 'total': 3}}, item('AAA'), item('BBB')]
            path.write_text('\n'.join(json.dumps(x) for x in lines) + '\n{"broken', encoding='utf-8')
            with patch.object(yu, 'OUTPUT', Path(directory)):
                self.assertEqual(yu.checkpoint_status(), {'done': 2, 'total': 3})
            calls, rows = self.run_main(directory, ['--resume'], ['AAA', 'BBB', 'CCC'])
            self.assertEqual(calls, ['CCC'])
            self.assertEqual(sorted(r['symbol'] for r in rows), ['AAA', 'BBB', 'CCC'])
            self.assertFalse(path.exists())

    def test_fresh_run_ignores_old_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(yu, 'OUTPUT', Path(directory)):
                yu.checkpoint_path().write_text(json.dumps(item('AAA')) + '\n', encoding='utf-8')
            calls, rows = self.run_main(directory, [], ['AAA', 'BBB'])
            self.assertEqual(sorted(calls), ['AAA', 'BBB'])
            self.assertEqual(len(rows), 2)


class RetryTests(unittest.TestCase):
    def test_failed_stocks_are_retried_then_filled_from_history(self):
        records = [{'Symbol': s, 'Security': s, 'GICS Sector': 'Test'} for s in ('AAA', 'BBB', 'CCC')]
        bad = lambda s: dict(item(s), price=None, low=None, high=None, distance=None, position=None, status='EROARE: x')
        rows = [item('AAA'), bad('BBB'), bad('CCC')]
        with tempfile.TemporaryDirectory() as d, patch.object(yu, 'RETRY_PAUSE', 0), \
             patch.object(yu, 'research_item', side_effect=lambda r: item(r['Symbol']) if r['Symbol'] == 'BBB' else bad(r['Symbol'])), \
             patch.object(yu, 'history_ranges', return_value={'CCC': (110.0, 100.0, 150.0)}), \
             patch.object(yu, 'analyst_values', return_value=[None] * len(yu.ANALYST_COLUMNS)):
            out = {r['symbol']: r for r in yu.retry_failed(rows, records, Path(d) / 'c.jsonl')}
        self.assertEqual(out['BBB']['status'], 'OK')                       # second pass succeeded
        self.assertEqual((out['CCC']['price'], out['CCC']['low'], out['CCC']['high']), (110.0, 100.0, 150.0))
        self.assertAlmostEqual(out['CCC']['distance'], 0.1)
        self.assertEqual(out['CCC']['price_field'], 'history 1y')


if __name__ == '__main__':
    unittest.main()
