"""Crypto section: top 10 coins by market cap, key price levels, indicators and Bitcoin halving cycles.

Sources (free, no key): CoinGecko (markets, global), alternative.me (Fear & Greed), Bitstamp (BTC daily since
2011, for cycles), Yahoo Finance via yfinance (one batch of daily history), CoinGecko 365-day fallback.
"""
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import tempfile
import threading
import time

import requests

BASE = Path(__file__).resolve().parent
PATH = BASE / 'Output' / 'crypto.json'
LOCK = threading.Lock()
UA = {'User-Agent': 'Mozilla/5.0 (SP500 Research dashboard)'}
CG = 'https://api.coingecko.com/api/v3'
STABLE = {'usdt', 'usdc', 'dai', 'fdusd', 'usde', 'pyusd', 'tusd', 'usds', 'busd', 'usd1'}
HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20']
NEXT_HALVING = '2028-04-15'   # estimate (every 210 000 blocks ≈ 4 years)
PEAK_WINDOW = 900             # cycle peaks came 371-548 days after halving; later highs belong to the next cycle's run-up
MIN_REFRESH = 10 * 60         # CoinGecko public limits: never refresh more often than this
HISTORY_TTL = 12 * 3600


def get_json(url, params=None, timeout=25):
    response = requests.get(url, params=params, headers=UA, timeout=timeout)
    response.raise_for_status()
    return response.json()


# ---------------------------------------------------------------- fetchers (replaced in tests)
def fetch_markets():
    return get_json(f'{CG}/coins/markets', {'vs_currency': 'usd', 'order': 'market_cap_desc', 'per_page': 10, 'page': 1,
                                           'sparkline': 'true', 'price_change_percentage': '24h,7d,30d,1y'})


def fetch_global():
    return get_json(f'{CG}/global')['data']


def fetch_fear_greed(days=60):
    rows = get_json('https://api.alternative.me/fng/', {'limit': days})['data']
    return [{'value': int(r['value']), 'label': r['value_classification'],
             'date': datetime.fromtimestamp(int(r['timestamp']), timezone.utc).strftime('%Y-%m-%d')} for r in reversed(rows)]


def fetch_btc_history():
    """BTC/USD daily closes from Bitstamp since 2011 (1000 days per request)."""
    out, start = {}, int(datetime(2011, 8, 18, tzinfo=timezone.utc).timestamp())
    now = time.time()
    while start < now:
        data = get_json('https://www.bitstamp.net/api/v2/ohlc/btcusd/', {'step': 86400, 'limit': 1000, 'start': start})['data']['ohlc']
        if not data:
            break
        for row in data:
            out[datetime.fromtimestamp(int(row['timestamp']), timezone.utc).strftime('%Y-%m-%d')] = float(row['close'])
        last = int(data[-1]['timestamp'])
        if last <= start:
            break
        start = last + 86400
    return sorted(out.items())


def fetch_yahoo_history(symbols):
    """One yfinance batch for '<SYM>-USD' over the last ~400 days -> {SYM: [[date, close], ...]}."""
    import yfinance as yf
    tickers = [s.upper() + '-USD' for s in symbols]
    frame = yf.download(tickers, period='400d', interval='1d', progress=False, auto_adjust=False, group_by='column', threads=True)
    out = {}
    if frame is None or len(frame) == 0:
        return out
    close = frame['Close']
    if getattr(close, 'ndim', 1) == 1:
        close = close.to_frame(tickers[0])
    for ticker in close.columns:
        rows = [[i.strftime('%Y-%m-%d'), float(v)] for i, v in close[ticker].items() if v == v and v > 0]
        if rows:
            out[str(ticker)[:-4].lower()] = rows
    return out


def fetch_coingecko_history(coin_id):
    data = get_json(f'{CG}/coins/{coin_id}/market_chart', {'vs_currency': 'usd', 'days': 365, 'interval': 'daily'})
    rows = {datetime.fromtimestamp(ms / 1000, timezone.utc).strftime('%Y-%m-%d'): float(p) for ms, p in data['prices'] if p}
    return sorted([list(r) for r in rows.items()])


# ---------------------------------------------------------------- analysis (pure functions)
def sma(values, n):
    return sum(values[-n:]) / n if len(values) >= n else None


def rsi(values, n=14):
    if len(values) <= n:
        return None
    gains = losses = 0.0
    for a, b in zip(values[-n - 1:-1], values[-n:]):
        change = b - a
        gains += max(change, 0)
        losses += max(-change, 0)
    if losses == 0:
        return 100.0
    return 100 - 100 / (1 + gains / losses)


def volatility(values, n=30):
    """Annualised volatility of daily log returns (crypto trades 365 days a year)."""
    if len(values) <= n:
        return None
    rets = [math.log(b / a) for a, b in zip(values[-n - 1:-1], values[-n:]) if a > 0 and b > 0]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    return math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(365)


def swing_points(values, window=7):
    highs, lows = [], []
    for i in range(window, len(values) - window):
        part = values[i - window:i + window + 1]
        if values[i] == max(part):
            highs.append(i)
        elif values[i] == min(part):
            lows.append(i)
    return highs, lows


def key_levels(history, price, tolerance=0.035, keep=3, lookback=1095):
    """Support / resistance levels from swing highs and lows (up to 3 years), clustered within `tolerance`.

    Each level counts how many times price turned there (strength) and when it last did; levels below the
    price are supports, above it resistances. Breaking a resistance tends to open the way to the next one.
    """
    closes = [c for _, c in history][-lookback:]   # up to 3 years when the history is that long (BTC)
    dates = [d for d, _ in history][-lookback:]
    if len(closes) < 30 or not price:
        return {'supports': [], 'resistances': []}
    highs, lows = swing_points(closes)
    points = sorted((closes[i], i) for i in highs + lows)
    clusters = []
    for value, index in points:
        if clusters and value <= clusters[-1]['mean'] * (1 + tolerance):
            c = clusters[-1]
            c['values'].append(value)
            c['last'] = max(c['last'], index)
            c['mean'] = sum(c['values']) / len(c['values'])
        else:
            clusters.append({'values': [value], 'mean': value, 'last': index})
    levels = [{'price': round(c['mean'], 8), 'touches': len(c['values']), 'last': dates[c['last']]} for c in clusters]
    supports = sorted([l for l in levels if l['price'] < price], key=lambda l: -l['price'])[:keep]
    resistances = sorted([l for l in levels if l['price'] > price], key=lambda l: l['price'])[:keep]
    return {'supports': supports, 'resistances': resistances}


def indicators(history, price):
    closes = [c for _, c in history]
    ma50, ma200 = sma(closes, 50), sma(closes, 200)
    cross = ('golden' if ma50 > ma200 else 'death') if ma50 and ma200 else None   # MA50 above / below MA200
    last365 = closes[-365:]
    return {'ma50': ma50, 'ma200': ma200, 'cross': cross, 'rsi': rsi(closes), 'vol30': volatility(closes),
            'high52': max(last365) if last365 else None, 'low52': min(last365) if last365 else None,
            'aboveMa200': price > ma200 if ma200 and price else None}


def btc_cycles(history, today=None):
    """Halving cycles from BTC daily closes: price at halving, peak (date, multiple, days after halving),
    bottom after the peak (drawdown), plus series normalised to the halving price for the overlay chart."""
    today = today or date.today().isoformat()
    series = dict(history)
    days = [d for d, _ in history]
    if not days:
        return {'cycles': [], 'halvings': HALVINGS, 'next': NEXT_HALVING}
    bounds = HALVINGS + [NEXT_HALVING]
    cycles = []
    for i, start in enumerate(HALVINGS):
        end = bounds[i + 1]
        segment = [(d, series[d]) for d in days if start <= d < end]
        if not segment:
            continue
        d0 = date.fromisoformat(start)
        base = segment[0][1]
        window = [r for r in segment if (date.fromisoformat(r[0]) - d0).days <= PEAK_WINDOW]
        peak_d, peak = max(window, key=lambda r: r[1])
        after = [r for r in segment if r[0] > peak_d]
        bottom_d, bottom = min(after, key=lambda r: r[1]) if after else (None, None)
        complete = end <= today
        step = max(1, len(segment) // 240)
        cycles.append({
            'halving': start, 'priceAtHalving': base, 'complete': complete, 'partialData': segment[0][0] > start,
            'peakDate': peak_d, 'peak': peak, 'peakMultiple': peak / base, 'daysToPeak': (date.fromisoformat(peak_d) - d0).days,
            'bottomDate': bottom_d, 'bottom': bottom, 'drawdown': bottom / peak - 1 if bottom else None,
            'daysPeakToBottom': (date.fromisoformat(bottom_d) - date.fromisoformat(peak_d)).days if bottom_d else None,
            'daysElapsed': (date.fromisoformat(segment[-1][0]) - d0).days,
            'series': [[(date.fromisoformat(d) - d0).days, round(p / base, 4)] for d, p in segment[::step]] + [[(date.fromisoformat(segment[-1][0]) - d0).days, round(segment[-1][1] / base, 4)]]})
    done = [c for c in cycles if c['complete'] and not c['partialData']]
    current = cycles[-1] if cycles else None
    to_peak = [c['daysToPeak'] for c in done]
    now = {'halving': HALVINGS[-1], 'daysSinceHalving': (date.fromisoformat(today) - date.fromisoformat(HALVINGS[-1])).days,
           'daysToNextHalving': (date.fromisoformat(NEXT_HALVING) - date.fromisoformat(today)).days,
           'cycleLength': (date.fromisoformat(NEXT_HALVING) - date.fromisoformat(HALVINGS[-1])).days,
           'historicalDaysToPeak': [min(to_peak), max(to_peak)] if to_peak else None,
           'historicalDrawdown': [min(c['drawdown'] for c in done if c['drawdown'] is not None), max(c['drawdown'] for c in done if c['drawdown'] is not None)] if done else None}
    if current and to_peak:
        now['peakWindow'] = [(date.fromisoformat(HALVINGS[-1]) + timedelta(days=min(to_peak))).isoformat(),
                             (date.fromisoformat(HALVINGS[-1]) + timedelta(days=max(to_peak))).isoformat()]
    if current and done and current['daysElapsed'] > current['daysToPeak'] + 30:
        # statistical analogy only: if the current cycle repeats past peak-to-bottom timing and depth
        to_bottom = [c['daysPeakToBottom'] for c in done if c['daysPeakToBottom']]
        depth = [c['drawdown'] for c in done if c['drawdown'] is not None]
        last_price = current['series'][-1][1] * current['priceAtHalving']
        peak_day = date.fromisoformat(current['peakDate'])
        now.update(peak=current['peak'], peakDate=current['peakDate'], drawdownNow=last_price / current['peak'] - 1,
                   bottomWindow=[(peak_day + timedelta(days=min(to_bottom))).isoformat(), (peak_day + timedelta(days=max(to_bottom))).isoformat()],
                   bottomRange=[current['peak'] * (1 + min(depth)), current['peak'] * (1 + max(depth))])
    return {'cycles': cycles, 'halvings': HALVINGS, 'next': NEXT_HALVING, 'now': now}


# ---------------------------------------------------------------- snapshot
def is_stable(coin):
    return coin['symbol'].lower() in STABLE or (abs((coin.get('current_price') or 0) - 1) < .02 and abs(coin.get('price_change_percentage_1y_in_currency') or 0) < 3)


def coin_view(c, history):
    price = c.get('current_price')
    stable = is_stable(c)
    return {'id': c['id'], 'symbol': c['symbol'].upper(), 'name': c['name'], 'image': c.get('image'), 'rank': c.get('market_cap_rank'),
            'price': price, 'mcap': c.get('market_cap'), 'volume': c.get('total_volume'), 'high24': c.get('high_24h'), 'low24': c.get('low_24h'),
            'ch24': c.get('price_change_percentage_24h_in_currency'), 'ch7': c.get('price_change_percentage_7d_in_currency'),
            'ch30': c.get('price_change_percentage_30d_in_currency'), 'ch1y': c.get('price_change_percentage_1y_in_currency'),
            'ath': c.get('ath'), 'athDate': (c.get('ath_date') or '')[:10], 'athPct': c.get('ath_change_percentage'),
            'circulating': c.get('circulating_supply'), 'maxSupply': c.get('max_supply'),
            'spark': [round(v, 8) for v in (c.get('sparkline_in_7d') or {}).get('price', [])[::4]],
            'stable': stable, 'history': history[-365:],
            'levels': {'supports': [], 'resistances': []} if stable else key_levels(history, price),
            'ind': indicators(history, price) if history else {}}


def save(data, path=None):
    path = Path(path or PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    with os.fdopen(handle, 'w', encoding='utf-8') as out:
        json.dump(data, out, separators=(',', ':'))
    os.replace(tmp, path)


def cached(path=None):
    try:
        return json.loads(Path(path or PATH).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def age(data, key='at'):
    try:
        return time.time() - datetime.fromisoformat(data[key]).timestamp()
    except (TypeError, KeyError, ValueError):
        return math.inf


def refresh(force=False, path=None):
    """Rebuild the crypto snapshot. Market data at most every 10 minutes, daily history every 12 hours."""
    with LOCK:
        old = cached(path)
        if old and not force and age(old) < MIN_REFRESH:
            return old
        markets = fetch_markets()
        errors = []
        try:
            global_ = fetch_global()
            glob = {'mcap': global_['total_market_cap']['usd'], 'mcapChange24h': global_.get('market_cap_change_percentage_24h_usd'),
                    'volume': global_['total_volume']['usd'], 'btcDominance': global_['market_cap_percentage'].get('btc'),
                    'ethDominance': global_['market_cap_percentage'].get('eth'), 'coins': global_.get('active_cryptocurrencies')}
        except Exception as exc:
            glob = (old or {}).get('global')
            errors.append('global: ' + str(exc)[:120])
        try:
            fng = fetch_fear_greed()
        except Exception as exc:
            fng = (old or {}).get('fearGreed', [])
            errors.append('fear&greed: ' + str(exc)[:120])
        histories, btc = (old or {}).get('_histories', {}), (old or {}).get('_btc', [])
        if not old or age(old, 'historyAt') > HISTORY_TTL or any(c['symbol'] not in histories for c in markets):
            histories = load_histories(markets, errors)
            try:
                btc = fetch_btc_history()
            except Exception as exc:
                errors.append('bitstamp: ' + str(exc)[:120])
            history_at = datetime.now().astimezone().isoformat(timespec='seconds')
        else:
            history_at = old['historyAt']
        if btc and markets and markets[0]['symbol'] == 'btc':
            histories['btc'] = [list(r) for r in btc]
        data = {'at': datetime.now().astimezone().isoformat(timespec='seconds'), 'historyAt': history_at,
                'global': glob, 'fearGreed': fng, 'coins': [coin_view(c, histories.get(c['symbol'], [])) for c in markets],
                'btc': btc_cycles([tuple(r) for r in btc]) if btc else None, 'errors': errors,
                '_histories': histories, '_btc': btc}
        save(data, path)
        return data


def load_histories(markets, errors):
    """Yahoo batch first; a Yahoo series is used only if its last close matches CoinGecko's price (±15%),
    which rejects ticker collisions; anything missing falls back to CoinGecko's 365-day history."""
    out = {}
    try:
        yahoo = fetch_yahoo_history([c['symbol'] for c in markets])
    except Exception as exc:
        yahoo = {}
        errors.append('yahoo: ' + str(exc)[:120])
    for c in markets:
        rows = yahoo.get(c['symbol'])
        price = c.get('current_price') or 0
        if rows and price and abs(rows[-1][1] / price - 1) < .15:
            out[c['symbol']] = rows
            continue
        try:
            out[c['symbol']] = fetch_coingecko_history(c['id'])
            time.sleep(1.5)
        except Exception as exc:
            errors.append(f"history {c['symbol']}: " + str(exc)[:80])
    return out


def public(data):
    """Snapshot for the page (internal caches removed)."""
    return {k: v for k, v in (data or {}).items() if not k.startswith('_')} if data else None
