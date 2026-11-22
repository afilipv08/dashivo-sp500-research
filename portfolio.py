"""Demo portfolio: virtual cash account, manual buys/sells and price tracking (Portofoliu/portfolio.json)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import math
import os
from pathlib import Path
import tempfile
import threading
import uuid

BASE = Path(__file__).resolve().parent
PATH = BASE / 'Portofoliu' / 'portfolio.json'
DEFAULT_CAPITAL = 10000.0
LOCK = threading.RLock()
ANALYSIS_KEYS = ('symbol', 'company', 'sector', 'price', 'low', 'high', 'total', 'support', 'weighted', 'sb', 'buy', 'hold',
                 'under', 'sell', 'minTarget', 'meanTarget', 'maxTarget', 'gap', 'upside', 'distance',
                 'Latest Rating - Date', 'Latest Rating - Rating', 'issues', 'reportDate')


class PriceError(RuntimeError):
    """No usable price could be obtained."""


def now():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def positive(value, name):
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f'Invalid {name}.') from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f'Invalid {name}.')
    return value


def fetch_price(symbol):
    """Latest Yahoo price; replaced in tests and offline checks."""
    import yfinance as yf
    try:
        price = yf.Ticker(symbol).fast_info.get('last_price')
    except Exception as exc:
        raise PriceError(str(exc)) from exc
    try:
        return positive(price, 'price')
    except ValueError:
        raise PriceError(f'No price for {symbol}.') from None


def fetch_history(symbol, start):
    """Daily closes since `start` (YYYY-MM-DD) as [[date, close], ...]; replaced in tests."""
    import yfinance as yf
    frame = yf.Ticker(symbol).history(start=start, interval='1d', auto_adjust=False)
    return [[index.strftime('%Y-%m-%d'), float(close)] for index, close in frame['Close'].items() if math.isfinite(close)]


def empty():
    return {'capital': DEFAULT_CAPITAL, 'deposits': [], 'positions': [], 'closed': [], 'prices': {}}


def load(path=None):
    path = Path(path or PATH)
    with LOCK:
        if not path.is_file():
            return empty()
        data = json.loads(path.read_text(encoding='utf-8'))
        base = empty()
        base.update({k: data[k] for k in base if k in data})
        return base


def save(data, path=None):
    path = Path(path or PATH)
    with LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
        with os.fdopen(handle, 'w', encoding='utf-8') as out:
            json.dump(data, out, ensure_ascii=False, indent=1)
        os.replace(tmp, path)


def cash(data):
    return (data['capital'] + sum(d['amount'] for d in data['deposits']) - sum(p['amount'] for p in data['positions'])
            - sum(c['amount'] for c in data['closed']) + sum(c['proceeds'] for c in data['closed']))


def summary(data):
    """Account view with derived values (never stored)."""
    positions = []
    for p in data['positions']:
        quote = data['prices'].get(p['symbol']) or {}
        price = quote.get('price') or p['price']
        value = p['shares'] * price
        positions.append(dict(p, current=price, priceAt=quote.get('at') or p['opened'], priceSource=quote.get('source', p['source']),
                              value=value, pl=value - p['amount'], plPct=value / p['amount'] - 1))
    closed = [dict(c, pl=c['proceeds'] - c['amount'], plPct=c['proceeds'] / c['amount'] - 1) for c in data['closed']]
    invested = sum(p['amount'] for p in positions)
    value = sum(p['value'] for p in positions)
    available = cash(data)
    funded = data['capital'] + sum(d['amount'] for d in data['deposits'])
    stamps = [q.get('at') for q in data['prices'].values() if q.get('at')]
    return {'capital': data['capital'], 'deposits': data['deposits'], 'funded': funded, 'cash': available,
            'invested': invested, 'value': value, 'equity': available + value,
            'unrealized': value - invested, 'unrealizedPct': value / invested - 1 if invested else None,
            'realized': sum(c['pl'] for c in closed), 'total': available + value - funded,
            'totalPct': (available + value) / funded - 1 if funded else None,
            'positions': positions, 'closed': closed, 'pricesAt': max(stamps) if stamps else None}


def _quote(data, symbol, fallback, fallback_source):
    try:
        price, source = fetch_price(symbol), 'live'
    except Exception:
        if not fallback:
            raise PriceError(f'No price available for {symbol}.')
        price, source = fallback, fallback_source
    data['prices'][symbol] = {'price': price, 'at': now(), 'source': source}
    return price, source


def buy(symbol, amount, analysis=None, report_price=None, path=None):
    symbol = str(symbol or '').strip().upper()
    if not symbol or len(symbol) > 12:
        raise ValueError('Invalid symbol.')
    amount = positive(amount, 'amount')
    with LOCK:
        data = load(path)
        if amount > cash(data) + 1e-9:
            raise ValueError('Amount exceeds available cash.')
        fallback = None
        try:
            fallback = positive(report_price, 'price')
        except ValueError:
            pass
        price, source = _quote(data, symbol, fallback, 'report')
        snap = {k: analysis.get(k) for k in ANALYSIS_KEYS if k in analysis} if isinstance(analysis, dict) else {}
        position = {'id': uuid.uuid4().hex[:10], 'symbol': symbol, 'company': str(snap.get('company') or symbol),
                    'sector': str(snap.get('sector') or ''), 'opened': now(), 'amount': amount, 'price': price,
                    'shares': amount / price, 'source': source, 'analysis': snap}
        data['positions'].append(position)
        save(data, path)
        return position, summary(data)


def sell(position_id, path=None):
    with LOCK:
        data = load(path)
        position = next((p for p in data['positions'] if p['id'] == position_id), None)
        if position is None:
            raise ValueError('Position not found.')
        last = (data['prices'].get(position['symbol']) or {}).get('price') or position['price']
        price, source = _quote(data, position['symbol'], last, 'last')
        data['positions'].remove(position)
        data['closed'].append(dict(position, closed=now(), closePrice=price, closeSource=source, proceeds=position['shares'] * price))
        save(data, path)
        return data['closed'][-1], summary(data)


def deposit(amount, path=None):
    amount = positive(amount, 'amount')
    with LOCK:
        data = load(path)
        data['deposits'].append({'amount': amount, 'at': now()})
        save(data, path)
        return summary(data)


def set_capital(amount, path=None):
    amount = positive(amount, 'amount')
    with LOCK:
        data = load(path)
        data['capital'] = amount
        if cash(data) < -1e-9:
            raise ValueError('Starting capital cannot be lower than the money already invested.')
        save(data, path)
        return summary(data)


def refresh_prices(path=None):
    """Fetch the live price of every open position (in parallel); keeps the last price on failure."""
    symbols = sorted({p['symbol'] for p in load(path)['positions']})
    results = {}
    if symbols:
        with ThreadPoolExecutor(min(4, len(symbols))) as pool:
            for symbol, result in zip(symbols, pool.map(lambda s: _safe(fetch_price, s), symbols)):
                results[symbol] = result
    with LOCK:
        data = load(path)
        stamp = now()
        for symbol, price in results.items():
            if price is not None:
                data['prices'][symbol] = {'price': price, 'at': stamp, 'source': 'live'}
        save(data, path)
        view = summary(data)
        view['priceErrors'] = sorted(s for s, p in results.items() if p is None)
        return view


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception:
        return None


def history(position_id, path=None):
    data = load(path)
    position = next((p for p in data['positions'] + data['closed'] if p['id'] == position_id), None)
    if position is None:
        raise ValueError('Position not found.')
    points = fetch_history(position['symbol'], position['opened'][:10])
    return {'id': position_id, 'symbol': position['symbol'], 'price': position['price'], 'points': points}
