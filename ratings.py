"""Recent analyst rating changes per symbol (Yahoo upgrades/downgrades), fetched on demand and cached for a day."""
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading
import time

BASE = Path(__file__).resolve().parent
PATH = BASE / 'Output' / 'ratings_cache.json'
TTL = 24 * 3600
LOCK = threading.Lock()
SYMBOL = re.compile(r'^[A-Z0-9.\-]{1,12}$')


def fetch(symbol):
    """Last rating changes as dicts; replaced in tests."""
    import yfinance as yf
    frame = yf.Ticker(symbol).upgrades_downgrades
    rows = []
    if frame is None or len(frame) == 0:
        return rows
    for index, row in frame.sort_index(ascending=False).head(10).iterrows():
        value = lambda *names: next((row.get(n) for n in names if n in row and row.get(n) == row.get(n) and row.get(n) not in ('', None)), None)
        num = lambda v: float(v) if isinstance(v, (int, float)) and math.isfinite(v) and v > 0 else None
        rows.append({'date': index.strftime('%Y-%m-%d') if hasattr(index, 'strftime') else str(index)[:10],
                     'firm': value('Firm', 'firm'), 'from': value('FromGrade', 'fromGrade'), 'to': value('ToGrade', 'toGrade'),
                     'action': value('Action', 'action'), 'targetAction': value('priceTargetAction'),
                     'target': num(value('currentPriceTarget')), 'priorTarget': num(value('priorPriceTarget'))})
    return rows


def _load():
    try:
        return json.loads(PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def history(symbol):
    symbol = str(symbol or '').strip().upper()
    if not SYMBOL.match(symbol):
        raise ValueError('Invalid symbol.')
    with LOCK:
        cache = _load()
        hit = cache.get(symbol)
        if hit and time.time() - hit.get('ts', 0) < TTL:
            return hit
    rows = fetch(symbol)
    entry = {'symbol': symbol, 'ts': time.time(), 'at': datetime.now().astimezone().isoformat(timespec='seconds'), 'rows': rows}
    with LOCK:
        cache = _load()
        cache[symbol] = entry
        PATH.parent.mkdir(parents=True, exist_ok=True)
        handle, tmp = tempfile.mkstemp(dir=PATH.parent, suffix='.tmp')
        with os.fdopen(handle, 'w', encoding='utf-8') as out:
            json.dump(cache, out)
        os.replace(tmp, PATH)
    return entry
