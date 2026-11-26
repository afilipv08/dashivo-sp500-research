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


MAX_PORTFOLIOS = 20
MAX_NAME = 40
DEFAULT_NAME = 'Main portfolio'


def empty(name=DEFAULT_NAME, capital=DEFAULT_CAPITAL, pid=None):
    return {'id': pid or uuid.uuid4().hex[:8], 'name': name, 'capital': capital, 'deposits': [], 'positions': [], 'closed': [], 'prices': {}}


def clean_name(name, others=()):
    name = ' '.join(str(name or '').split())
    if not name or len(name) > MAX_NAME:
        raise ValueError(f'Give the portfolio a name of 1 to {MAX_NAME} characters.')
    if name.casefold() in {str(o).casefold() for o in others}:
        raise ValueError('A portfolio with this name already exists.')
    return name


def _read_store(path=None):
    """{'portfolios': [account, ...]}; a file written before several portfolios existed becomes the first one."""
    path = Path(path or PATH)
    if not path.is_file():
        return {'portfolios': [empty(pid='main')]}
    data = json.loads(path.read_text(encoding='utf-8'))
    if isinstance(data.get('portfolios'), list) and data['portfolios']:
        accounts = data['portfolios']
    else:
        accounts = [dict(data, id='main', name=DEFAULT_NAME)]
    fixed = []
    for account in accounts:
        base = empty(account.get('name') or DEFAULT_NAME, pid=account.get('id') or None)
        base.update({k: account[k] for k in base if k in account})
        fixed.append(base)
    return {'portfolios': fixed}


def _write_store(store, path=None):
    path = Path(path or PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    with os.fdopen(handle, 'w', encoding='utf-8') as out:
        json.dump(store, out, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _find(store, pid):
    if pid in (None, ''):
        return store['portfolios'][0]
    account = next((a for a in store['portfolios'] if a['id'] == pid), None)
    if account is None:
        raise ValueError('Portfolio not found.')
    return account


def load(path=None, pid=None):
    """One account (the first when `pid` is omitted)."""
    with LOCK:
        return _find(_read_store(path), pid)


def save(data, path=None, pid=None):
    with LOCK:
        store = _read_store(path)
        target = _find(store, pid or data.get('id'))
        store['portfolios'][store['portfolios'].index(target)] = data
        _write_store(store, path)


def listing(path=None):
    """Every portfolio in short: name and where it stands."""
    out = []
    for account in _read_store(path)['portfolios']:
        view = summary(account)
        out.append({'id': account['id'], 'name': account['name'], 'equity': view['equity'], 'cash': view['cash'], 'total': view['total'],
                    'totalPct': view['totalPct'], 'positions': len(view['positions'])})
    return out


def create(name, capital=None, path=None):
    with LOCK:
        store = _read_store(path)
        if len(store['portfolios']) >= MAX_PORTFOLIOS:
            raise ValueError(f'At most {MAX_PORTFOLIOS} portfolios.')
        account = empty(clean_name(name, [a['name'] for a in store['portfolios']]),
                        positive(capital, 'starting capital') if capital not in (None, '') else DEFAULT_CAPITAL)
        store['portfolios'].append(account)
        _write_store(store, path)
        return summary(account)


def rename(pid, name, path=None):
    with LOCK:
        store = _read_store(path)
        account = _find(store, pid)
        account['name'] = clean_name(name, [a['name'] for a in store['portfolios'] if a is not account])
        _write_store(store, path)
        return summary(account)


def remove(pid, path=None):
    """Deletes a portfolio with its positions and history; the last one cannot be deleted. Returns the new first portfolio."""
    with LOCK:
        store = _read_store(path)
        account = _find(store, pid)
        if len(store['portfolios']) == 1:
            raise ValueError('The last portfolio cannot be deleted.')
        store['portfolios'].remove(account)
        _write_store(store, path)
        return summary(store['portfolios'][0])


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
    return {'id': data.get('id'), 'name': data.get('name'), 'capital': data['capital'], 'deposits': data['deposits'], 'funded': funded, 'cash': available,
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


def buy(symbol, amount, analysis=None, report_price=None, path=None, pid=None):
    symbol = str(symbol or '').strip().upper()
    if not symbol or len(symbol) > 12:
        raise ValueError('Invalid symbol.')
    amount = positive(amount, 'amount')
    with LOCK:
        data = load(path, pid)
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
        save(data, path, pid)
        return position, summary(data)


def sell(position_id, path=None, pid=None):
    with LOCK:
        data = load(path, pid)
        position = next((p for p in data['positions'] if p['id'] == position_id), None)
        if position is None:
            raise ValueError('Position not found.')
        last = (data['prices'].get(position['symbol']) or {}).get('price') or position['price']
        price, source = _quote(data, position['symbol'], last, 'last')
        data['positions'].remove(position)
        data['closed'].append(dict(position, closed=now(), closePrice=price, closeSource=source, proceeds=position['shares'] * price))
        save(data, path, pid)
        return data['closed'][-1], summary(data)


def deposit(amount, path=None, pid=None):
    amount = positive(amount, 'amount')
    with LOCK:
        data = load(path, pid)
        data['deposits'].append({'amount': amount, 'at': now()})
        save(data, path, pid)
        return summary(data)


def set_capital(amount, path=None, pid=None):
    amount = positive(amount, 'amount')
    with LOCK:
        data = load(path, pid)
        data['capital'] = amount
        if cash(data) < -1e-9:
            raise ValueError('Starting capital cannot be lower than the money already invested.')
        save(data, path, pid)
        return summary(data)


def refresh_prices(path=None, pid=None):
    """Fetch the live price of every open position (in parallel); keeps the last price on failure."""
    symbols = sorted({p['symbol'] for p in load(path, pid)['positions']})
    results = {}
    if symbols:
        with ThreadPoolExecutor(min(4, len(symbols))) as pool:
            for symbol, result in zip(symbols, pool.map(lambda s: _safe(fetch_price, s), symbols)):
                results[symbol] = result
    with LOCK:
        data = load(path, pid)
        stamp = now()
        for symbol, price in results.items():
            if price is not None:
                data['prices'][symbol] = {'price': price, 'at': stamp, 'source': 'live'}
        save(data, path, pid)
        view = summary(data)
        view['priceErrors'] = sorted(s for s, p in results.items() if p is None)
        return view


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception:
        return None


def history(position_id, path=None):
    accounts = _read_store(path)['portfolios']
    position = next((p for a in accounts for p in a['positions'] + a['closed'] if p['id'] == position_id), None)
    if position is None:
        raise ValueError('Position not found.')
    points = fetch_history(position['symbol'], position['opened'][:10])
    return {'id': position_id, 'symbol': position['symbol'], 'price': position['price'], 'points': points}
