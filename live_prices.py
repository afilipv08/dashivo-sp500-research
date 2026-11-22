"""Live prices for the whole list, fetched in one Yahoo request and kept until the next refresh."""
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading

BASE = Path(__file__).resolve().parent
PATH = BASE / 'Output' / 'live_prices.json'
LOCK = threading.Lock()
SYMBOL = re.compile(r'^[A-Z0-9.\-]{1,12}$')


def download(symbols):
    """Last price per symbol from one batch request; replaced in tests."""
    import yfinance as yf
    frame = yf.download(symbols, period='5d', interval='1d', progress=False, threads=True, auto_adjust=False, group_by='column')
    return last_closes(frame, symbols)


def last_closes(frame, symbols):
    """Latest non-empty close for each symbol; handles single- and multi-column Yahoo frames."""
    if frame is None or len(frame) == 0:
        return {}
    close = frame['Close'] if 'Close' in getattr(frame, 'columns', []) or hasattr(frame.columns, 'levels') else frame
    if getattr(close, 'ndim', 1) == 1:
        close = close.to_frame(symbols[0])
    out = {}
    for symbol in close.columns:
        values = [float(v) for v in close[symbol].tolist() if v is not None and math.isfinite(float(v)) and float(v) > 0]
        if values:
            out[str(symbol)] = values[-1]
    return out


def cached(path=None):
    path = Path(path or PATH)
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'at': None, 'prices': {}}


def refresh(symbols, path=None):
    symbols = sorted({str(s).strip().upper() for s in symbols if SYMBOL.match(str(s).strip().upper())})
    if not symbols:
        raise ValueError('No symbols to price.')
    prices = download(symbols)
    if not prices:
        raise RuntimeError('Live prices are unavailable right now.')
    # Yahoo sometimes drops a few tickers from a batch; keep their last known price instead of a blank
    old = cached(path).get('prices', {})
    missing = [s for s in symbols if s not in prices]
    prices.update({s: old[s] for s in missing if s in old})
    data = {'at': datetime.now().astimezone().isoformat(timespec='seconds'), 'prices': prices,
            'missing': [s for s in missing if s not in prices], 'stale': [s for s in missing if s in prices]}
    path = Path(path or PATH)
    with LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
        with os.fdopen(handle, 'w', encoding='utf-8') as out:
            json.dump(data, out)
        os.replace(tmp, path)
    return data
