import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import top10_history as th


def row(sym, **kw):
    r = dict(symbol=sym, company=sym, sector='Test', price=100.0, low=95.0, distance=100 / 95 - 1, total=20, sb=10, buy=6,
             hold=2, under=0, sell=0, gap=0.05, upside=0.2, weighted=21.0, support=0.8, Consens='BUY')
    r.update(kw)
    return r


class Top10HistoryTests(unittest.TestCase):
    def test_presets_mirror_the_dashboard_rules(self):
        items = [row('AAA', gap=0.02), row('BBB', hold=3), row('CCC', distance=0.2), row('DDD', gap=0.01, hold=1),
                 row('EEE', Consens='HOLD', hold=0, gap=0.03), row('FFF', sb=5, buy=5, hold=0, total=10)]
        self.assertEqual([r['symbol'] for r in th.top10(items, 'default')['items']], ['DDD', 'AAA', 'EEE'])   # no consensus rule here
        self.assertEqual([r['symbol'] for r in th.top10(items, 'excel')['items']], ['DDD', 'AAA', 'EEE', 'BBB'])   # no Hold limit
        self.assertEqual([r['symbol'] for r in th.top10(items, 'top5')['items']], ['DDD'])        # BUY, hold<=1, SB+B>=15
        many = [row(f'S{i:02d}', gap=i / 100) for i in range(15)]
        self.assertEqual((th.top10(many, 'default')['matches'], len(th.top10(many, 'default')['items'])), (15, 10))

    def test_one_entry_per_day_latest_wins(self):
        snaps = [{'date': '2026-11-22', 'at': '2026-11-22T16:00:00', 'presets': {}}, {'date': '2026-11-22', 'at': '2026-11-22T21:00:00', 'presets': {}},
                 {'date': '2026-11-21', 'at': '2026-11-21T16:00:00', 'presets': {}}]
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'h.json'
            for s in snaps:
                with patch.object(th, 'snapshot', return_value=s):
                    th.record('x', path)
            days = th.load(path)['days']
            self.assertEqual([(x['date'], x['at'][11:16]) for x in days], [('2026-11-22', '21:00'), ('2026-11-21', '16:00')])

    def test_snapshot_from_real_report(self):
        reports = sorted(Path(th.BASE / 'Output').glob('SP500_20_11_2026_15-33-13.xlsx'))
        if not reports:
            self.skipTest('report not present')
        snap = th.snapshot(reports[0])
        self.assertEqual(snap['date'], '2026-11-20')
        self.assertEqual([r['symbol'] for r in snap['presets']['top5']['items'][:5]], ['TRGP', 'CRH', 'ANET', 'NUE', 'BLK'])   # = Investitii simulation
        self.assertEqual(snap['presets']['excel']['matches'], 63)


if __name__ == '__main__':
    unittest.main()
