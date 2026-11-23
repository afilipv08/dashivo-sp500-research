"""Day-by-day history of the Top 10 for each filter preset (Output/top10_history.json).

Called after every research run (PC and GitHub); `python top10_history.py --backfill` rebuilds it from all saved
reports. The preset rules and the ranking mirror web/data.js (PRESETS, CRITERIA, ranked) and must stay equal.
"""
import argparse
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re
import tempfile

import dashboard

BASE = Path(__file__).resolve().parent
PATH = BASE / 'Output' / 'top10_history.json'
STAMP = re.compile(r'SP500_(\d{2}_\d{2}_\d{4}_\d{2}-\d{2}-\d{2})\.xlsx$')
SIMULATION_CAPITAL = 10_000.0
PRESETS = {   # None = no limit, as in the dashboard
    'default': dict(distance=12, analysts=12, sell=0, under=2, hold=2, positive=None, consensus=None, gap_min=None),
    'excel': dict(distance=12, analysts=12, sell=0, under=2, hold=None, positive=None, consensus=None, gap_min=None),
    'top5': dict(distance=None, analysts=None, sell=0, under=None, hold=1, positive=15, consensus='BUY', gap_min=0),
}


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def whole(v):
    return num(v) and float(v).is_integer() and v >= 0


def passes(r, p):
    if p['distance'] is not None and not (num(r.get('price')) and r['price'] > 0 and num(r.get('low')) and r['low'] > 0
                                          and num(r.get('distance')) and r['distance'] <= p['distance'] / 100 + 1e-12):
        return False
    for key, field in (('analysts', 'total'),):
        if p[key] is not None and not (whole(r.get(field)) and r[field] >= p[key]):
            return False
    for key, field in (('sell', 'sell'), ('under', 'under'), ('hold', 'hold')):
        if p[key] is not None and not (whole(r.get(field)) and r[field] <= p[key]):
            return False
    if p['positive'] is not None and not (whole(r.get('sb')) and whole(r.get('buy')) and r['sb'] + r['buy'] >= p['positive']):
        return False
    if p['consensus'] is not None and str(r.get('Consens') or '').strip().upper() != p['consensus']:
        return False
    if p['gap_min'] is not None and not (num(r.get('gap')) and r['gap'] >= p['gap_min'] / 100 - 1e-12):
        return False
    return True


def top10(items, preset):
    rows = [r for r in items if passes(r, PRESETS[preset]) and num(r.get('gap'))]
    rows.sort(key=lambda r: (r['gap'], -(r.get('weighted') or 0), r['symbol']))
    keep = ('symbol', 'company', 'sector', 'price', 'gap', 'upside', 'weighted', 'support', 'distance', 'total')
    result = {'matches': len(rows), 'items': [{k: r.get(k) for k in keep} for r in rows[:10]]}
    # Investitii uses the first five from its ordered preset; other presets simulate all ten.
    selected = result['items'][:5 if preset == 'top5' else 10]
    per_position = SIMULATION_CAPITAL / len(selected) if selected else 0.0
    positions = [{'symbol': r['symbol'], 'entryPrice': r['price'], 'allocation': per_position,
                  'shares': per_position / r['price']} for r in selected if num(r.get('price')) and r['price'] > 0]
    result['simulation'] = {'capital': SIMULATION_CAPITAL, 'invested': per_position * len(positions),
                            'cash': SIMULATION_CAPITAL - per_position * len(positions), 'positions': positions}
    return result


def snapshot(report):
    report = Path(report)
    stamp = datetime.strptime(STAMP.search(report.name).group(1), '%d_%m_%Y_%H-%M-%S')
    data = dashboard.load_payload(report)
    items = data.get('allItems') or data['items']
    return {'date': stamp.strftime('%Y-%m-%d'), 'at': stamp.isoformat(), 'report': report.name, 'universe': len(items),
            'presets': {name: top10(items, name) for name in PRESETS}}


def load(path=None):
    try:
        return json.loads(Path(path or PATH).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'days': []}


def save(history, path=None):
    path = Path(path or PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    history['days'].sort(key=lambda d: d['date'], reverse=True)
    handle, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    with os.fdopen(handle, 'w', encoding='utf-8') as out:
        json.dump(history, out, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    os.replace(tmp, path)


def record(report, path=None):
    """Add (or replace) the day of this report; one entry per day, the latest run of the day wins."""
    snap = snapshot(report)
    history = load(path)
    days = [d for d in history['days'] if d['date'] != snap['date'] or d['at'] > snap['at']]
    if not any(d['date'] == snap['date'] for d in days):
        days.append(snap)
    history['days'] = days
    save(history, path)
    return snap


def backfill(path=None):
    reports = sorted((p for p in (BASE / 'Output').glob('SP500_*.xlsx') if STAMP.search(p.name)),
                     key=lambda p: datetime.strptime(STAMP.search(p.name).group(1), '%d_%m_%Y_%H-%M-%S'))
    for report in reports:
        try:
            snap = record(report, path)
            print(snap['date'], report.name, {k: v['matches'] for k, v in snap['presets'].items()})
        except Exception as exc:   # very old reports have another layout
            print('skip', report.name, exc)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('report', nargs='?', type=Path)
    parser.add_argument('--backfill', action='store_true')
    args = parser.parse_args()
    backfill() if args.backfill or not args.report else print(record(args.report)['date'])
