"""Technical analysis for every stock in the report, computed at build time from daily OHLCV (Yahoo Finance via yfinance).

Ratings follow TradingView's published "Technical Ratings" rules (15 moving-average and 11 oscillator conditions, each
-1/0/+1, means between -1 and +1, Strong Sell < -0.5 <= Sell < -0.1 <= Neutral <= 0.1 < Buy <= 0.5 < Strong Buy). This
module adds volume and relative-strength groups, a weekly rating, context (volatility, levels) and a measured track
record of the daily composite rating. Everything is descriptive; nothing here is a forecast.
"""
from datetime import datetime
import math

import numpy as np
import pandas as pd

MA_LENGTHS = (10, 20, 30, 50, 100, 200)
FORWARD_DAYS = 20          # horizon for the track record (about one trading month)
TRACK_DAYS = 252           # how many recent days of the daily rating are scored
CATEGORIES = ('Strong Sell', 'Sell', 'Neutral', 'Buy', 'Strong Buy')
SCHEMA = 1


def category(value):
    if value is None or not math.isfinite(value):
        return None
    if value < -0.5:
        return 'Strong Sell'
    if value < -0.1:
        return 'Sell'
    if value <= 0.1:
        return 'Neutral'
    if value <= 0.5:
        return 'Buy'
    return 'Strong Buy'


# ---------------------------------------------------------------- indicator primitives (vectorized, pandas Series)
def sma(s, n):
    return s.rolling(n, min_periods=n).mean()


def ema(s, n):
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def wma(s, n):
    weights = np.arange(1, n + 1, dtype=float)
    return s.rolling(n, min_periods=n).apply(lambda x: float(np.dot(x, weights) / weights.sum()), raw=True)


def hull(s, n=9):
    return wma(2 * wma(s, n // 2) - wma(s, n), int(math.sqrt(n)))


def wilder(s, n):
    return s.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def rsi(close, n=14):
    delta = close.diff()
    gain, loss = wilder(delta.clip(lower=0), n), wilder((-delta).clip(lower=0), n)
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(loss != 0, 100.0)


def stochastic(high, low, close, n=14, k=3, d=3):
    lowest, highest = low.rolling(n, min_periods=n).min(), high.rolling(n, min_periods=n).max()
    raw = 100 * (close - lowest) / (highest - lowest).replace(0, np.nan)
    k_line = sma(raw, k)
    return k_line, sma(k_line, d)


def cci(high, low, close, n=20):
    tp = (high + low + close) / 3
    mean = sma(tp, n)
    dev = tp.rolling(n, min_periods=n).apply(lambda x: float(np.mean(np.abs(x - x.mean()))), raw=True)
    return (tp - mean) / (0.015 * dev.replace(0, np.nan))


def adx(high, low, close, n=14):
    up, down = high.diff(), -low.diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=high.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=high.index)
    tr = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    atr = wilder(tr, n)
    plus_di, minus_di = 100 * wilder(plus_dm, n) / atr, 100 * wilder(minus_dm, n) / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return wilder(dx, n), plus_di, minus_di


def atr(high, low, close, n=14):
    tr = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    return wilder(tr, n)


def macd(close, fast=12, slow=26, signal=9):
    line = ema(close, fast) - ema(close, slow)
    return line, ema(line, signal)


def ultimate(high, low, close):
    prev = close.shift()
    bp = close - pd.concat([low, prev], axis=1).min(axis=1)
    tr = pd.concat([high, prev], axis=1).max(axis=1) - pd.concat([low, prev], axis=1).min(axis=1)
    avg = lambda n: bp.rolling(n, min_periods=n).sum() / tr.rolling(n, min_periods=n).sum().replace(0, np.nan)
    return 100 * (4 * avg(7) + 2 * avg(14) + avg(28)) / 7


def mfi(high, low, close, volume, n=14):
    tp = (high + low + close) / 3
    flow = tp * volume
    pos = flow.where(tp > tp.shift(), 0.0).rolling(n, min_periods=n).sum()
    neg = flow.where(tp < tp.shift(), 0.0).rolling(n, min_periods=n).sum()
    return 100 - 100 / (1 + pos / neg.replace(0, np.nan))


def cmf(high, low, close, volume, n=20):
    mult = ((close - low) - (high - close)) / (high - low).replace(0, np.nan)
    return (mult.fillna(0) * volume).rolling(n, min_periods=n).sum() / volume.rolling(n, min_periods=n).sum().replace(0, np.nan)


def obv(close, volume):
    return (np.sign(close.diff()).fillna(0) * volume).cumsum()


# ---------------------------------------------------------------- votes: each is a Series of -1 / 0 / +1 (NaN = not available)
def _vote(buy, sell, available):
    out = pd.Series(np.where(buy, 1.0, np.where(sell, -1.0, 0.0)), index=available.index)
    return out.where(available)


def ma_votes(df):
    c, v = df['Close'], df['Volume']
    votes = {}
    for n in MA_LENGTHS:
        for name, line in ((f'SMA {n}', sma(c, n)), (f'EMA {n}', ema(c, n))):
            votes[name] = _vote(line < c, line > c, line.notna())
    vwma = (c * v).rolling(20, min_periods=20).sum() / v.rolling(20, min_periods=20).sum().replace(0, np.nan)
    votes['VWMA 20'] = _vote(vwma < c, vwma > c, vwma.notna())
    hma = hull(c, 9)
    votes['Hull MA 9'] = _vote(hma < c, hma > c, hma.notna())
    hi, lo = df['High'], df['Low']
    conv = (hi.rolling(9).max() + lo.rolling(9).min()) / 2
    base = (hi.rolling(26).max() + lo.rolling(26).min()) / 2
    span_a = (conv + base) / 2
    span_b = (hi.rolling(52).max() + lo.rolling(52).min()) / 2
    votes['Ichimoku Cloud'] = _vote((span_a > span_b) & (base > span_a) & (conv > base) & (c > conv),
                                    (span_a < span_b) & (base < span_a) & (conv < base) & (c < conv), span_b.notna())
    return votes


def osc_votes(df):
    hi, lo, c = df['High'], df['Low'], df['Close']
    votes = {}
    r = rsi(c)
    votes['RSI 14'] = _vote((r < 30) & (r > r.shift()), (r > 70) & (r < r.shift()), r.notna())
    k, d = stochastic(hi, lo, c)
    votes['Stochastic 14,3,3'] = _vote((k < 20) & (d < 20) & (k > d), (k > 80) & (d > 80) & (k < d), d.notna())
    cc = cci(hi, lo, c)
    votes['CCI 20'] = _vote((cc < -100) & (cc > cc.shift()), (cc > 100) & (cc < cc.shift()), cc.notna())
    a, pdi, mdi = adx(hi, lo, c)
    votes['ADX 14'] = _vote((pdi > mdi) & (a > 20) & (a > a.shift()), (pdi < mdi) & (a > 20) & (a < a.shift()), a.notna())
    hl2 = (hi + lo) / 2
    ao = sma(hl2, 5) - sma(hl2, 34)
    p1, p2 = ao.shift(), ao.shift(2)
    votes['Awesome Oscillator'] = _vote(((ao > 0) & (p1 <= 0)) | ((ao > 0) & (p1 > 0) & (ao > p1) & (p1 < p2)),
                                        ((ao < 0) & (p1 >= 0)) | ((ao < 0) & (p1 < 0) & (ao < p1) & (p1 > p2)), p2.notna())
    mom = c - c.shift(10)
    votes['Momentum 10'] = _vote(mom > mom.shift(), mom < mom.shift(), mom.shift().notna())
    m, s = macd(c)
    votes['MACD 12,26,9'] = _vote(m > s, m < s, s.notna())
    srsi_raw = 100 * (r - r.rolling(14).min()) / (r.rolling(14).max() - r.rolling(14).min()).replace(0, np.nan)
    sk = sma(srsi_raw, 3)
    sd = sma(sk, 3)
    trend = sma(c, 50)            # up / down trend for Stochastic RSI and Bull Bear Power: price vs its 50-day average
    votes['Stochastic RSI'] = _vote((c < trend) & (sk < 20) & (sd < 20) & (sk > sd), (c > trend) & (sk > 80) & (sd > 80) & (sk < sd),
                                    sd.notna() & trend.notna())
    wr = -100 * (hi.rolling(14).max() - c) / (hi.rolling(14).max() - lo.rolling(14).min()).replace(0, np.nan)
    votes['Williams %R 14'] = _vote((wr < -80) & (wr > wr.shift()), (wr > -20) & (wr < wr.shift()), wr.notna())
    e13 = ema(c, 13)
    bull, bear = hi - e13, lo - e13
    votes['Bull Bear Power'] = _vote((c > trend) & (bear < 0) & (bear > bear.shift()), (c < trend) & (bull > 0) & (bull < bull.shift()),
                                     e13.notna() & trend.notna())
    uo = ultimate(hi, lo, c)
    votes['Ultimate Oscillator'] = _vote(uo > 70, uo < 30, uo.notna())
    return votes


def volume_votes(df):
    hi, lo, c, v = df['High'], df['Low'], df['Close'], df['Volume']
    votes = {}
    o = obv(c, v)
    o_avg = sma(o, 20)
    votes['OBV vs 20-day average'] = _vote(o > o_avg, o < o_avg, o_avg.notna())
    flow = cmf(hi, lo, c, v)
    votes['Chaikin Money Flow 20'] = _vote(flow > 0.05, flow < -0.05, flow.notna())
    mf = mfi(hi, lo, c, v)
    votes['Money Flow Index 14'] = _vote((mf < 20) & (mf > mf.shift()), (mf > 80) & (mf < mf.shift()), mf.notna())
    up_vol = v.where(c > c.shift(), 0.0).rolling(20, min_periods=20).sum()
    down_vol = v.where(c < c.shift(), 0.0).rolling(20, min_periods=20).sum()
    votes['Up vs down volume, 20 days'] = _vote(up_vol > 1.2 * down_vol, down_vol > 1.2 * up_vol, up_vol.notna())
    return votes


def strength_votes(close, bench):
    """Relative strength against the S&P 500 over 3 and 6 months, and 12-1 month momentum vs the index."""
    votes = {}
    b = bench.reindex(close.index).ffill()
    for days, label in ((63, '3 months'), (126, '6 months')):
        excess = close / close.shift(days) - b / b.shift(days)
        votes[f'vs S&P 500, {label}'] = _vote(excess > 0.02, excess < -0.02, excess.notna())
    mom = close.shift(21) / close.shift(252) - 1
    bmom = b.shift(21) / b.shift(252) - 1
    votes['12-1 month momentum vs S&P 500'] = _vote(mom - bmom > 0.02, mom - bmom < -0.02, (mom - bmom).notna())
    return votes


def group_rating(votes):
    frame = pd.DataFrame(votes)
    return frame.mean(axis=1, skipna=True).where(frame.notna().any(axis=1))


# ---------------------------------------------------------------- per-stock analysis
def _f(x, digits=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, digits) if math.isfinite(x) else None


def _last_votes(votes):
    out = {}
    for name, series in votes.items():
        value = series.iloc[-1] if len(series) else np.nan
        out[name] = None if pd.isna(value) else int(value)
    return out


def _pivots(high, low, close, window=5, lookback=120):
    """Nearest swing support below and resistance above the last close (swing = extreme of 2*window+1 bars)."""
    h, l = high.iloc[-lookback:], low.iloc[-lookback:]
    price = float(close.iloc[-1])
    highs = [float(h.iloc[i]) for i in range(window, len(h) - window) if h.iloc[i] == h.iloc[i - window:i + window + 1].max()]
    lows = [float(l.iloc[i]) for i in range(window, len(l) - window) if l.iloc[i] == l.iloc[i - window:i + window + 1].min()]
    above = sorted(x for x in highs if x > price)
    below = sorted((x for x in lows if x < price), reverse=True)
    return (_f(below[0], 2) if below else None), (_f(above[0], 2) if above else None)


def _weekly(df):
    w = df.resample('W-FRI').agg({'Open': 'first', 'High': 'max', 'Low': 'min', 'Close': 'last', 'Volume': 'sum'}).dropna()
    if len(w) < 30:
        return None
    ma, osc = group_rating(ma_votes(w)), group_rating(osc_votes(w))
    value = pd.concat([ma, osc], axis=1).mean(axis=1, skipna=True).iloc[-1]
    return {'ma': _f(ma.iloc[-1]), 'osc': _f(osc.iloc[-1]), 'all': _f(value), 'category': category(_f(value))}


def analyse(df, bench):
    """One stock: OHLCV DataFrame (DatetimeIndex) + the S&P 500 close Series. Returns a JSON-ready dict or None."""
    df = df.dropna(subset=['Close']).copy()
    df = df[df['Close'] > 0]
    if len(df) < 60:
        return None
    for col in ('Open', 'High', 'Low'):
        df[col] = df[col].fillna(df['Close'])
    df['Volume'] = df['Volume'].fillna(0)
    c, hi, lo = df['Close'], df['High'], df['Low']
    groups = {'ma': ma_votes(df), 'osc': osc_votes(df), 'volume': volume_votes(df), 'strength': strength_votes(c, bench)}
    ratings = {k: group_rating(v) for k, v in groups.items()}
    tv_all = pd.concat([ratings['ma'], ratings['osc']], axis=1).mean(axis=1, skipna=True)
    composite = pd.concat(list(ratings.values()), axis=1).mean(axis=1, skipna=True)
    price = float(c.iloc[-1])
    a, pdi, mdi = adx(hi, lo, c)
    m, s = macd(c)
    k, d = stochastic(hi, lo, c)
    at = atr(hi, lo, c)
    mid, sd20 = sma(c, 20), c.rolling(20).std()
    upper, lower = mid + 2 * sd20, mid - 2 * sd20
    year = c.iloc[-252:]
    s50, s200 = sma(c, 50), sma(c, 200)
    cross = None
    if s200.notna().sum() > 1:
        diff = np.sign(s50 - s200).dropna()
        flips = diff[diff != diff.shift()].iloc[1:]
        if len(flips):
            cross = {'type': 'golden' if flips.iloc[-1] > 0 else 'death', 'date': flips.index[-1].strftime('%Y-%m-%d')}
    support, resistance = _pivots(hi, lo, c)
    ret = lambda n: _f(price / float(c.iloc[-1 - n]) - 1) if len(c) > n else None
    b = bench.reindex(c.index).ffill()
    rel = lambda n: _f(price / float(c.iloc[-1 - n]) - float(b.iloc[-1]) / float(b.iloc[-1 - n])) if len(c) > n and pd.notna(b.iloc[-1 - n]) else None
    logret = np.log(c / c.shift()).iloc[-30:]
    pp = (float(hi.iloc[-1]) + float(lo.iloc[-1]) + price) / 3
    out = {
        'asOf': c.index[-1].strftime('%Y-%m-%d'), 'price': _f(price, 2), 'bars': len(c),
        'rating': {'ma': _f(ratings['ma'].iloc[-1]), 'osc': _f(ratings['osc'].iloc[-1]), 'tv': _f(tv_all.iloc[-1]),
                   'volume': _f(ratings['volume'].iloc[-1]), 'strength': _f(ratings['strength'].iloc[-1]), 'composite': _f(composite.iloc[-1])},
        'votes': {k: _last_votes(v) for k, v in groups.items()},
        'weekly': _weekly(df),
        'indicators': {
            'rsi': _f(rsi(c).iloc[-1], 1), 'stochK': _f(k.iloc[-1], 1), 'stochD': _f(d.iloc[-1], 1), 'cci': _f(cci(hi, lo, c).iloc[-1], 1),
            'adx': _f(a.iloc[-1], 1), 'plusDI': _f(pdi.iloc[-1], 1), 'minusDI': _f(mdi.iloc[-1], 1), 'macd': _f(m.iloc[-1], 3), 'macdSignal': _f(s.iloc[-1], 3),
            'mfi': _f(mfi(hi, lo, c, df['Volume']).iloc[-1], 1), 'cmf': _f(cmf(hi, lo, c, df['Volume']).iloc[-1], 3),
            'sma50': _f(s50.iloc[-1], 2), 'sma200': _f(s200.iloc[-1], 2), 'ema20': _f(ema(c, 20).iloc[-1], 2),
            'atrPct': _f(at.iloc[-1] / price), 'bbPercent': _f((price - lower.iloc[-1]) / (upper.iloc[-1] - lower.iloc[-1])) if pd.notna(upper.iloc[-1]) and upper.iloc[-1] != lower.iloc[-1] else None,
            'bbWidth': _f((upper.iloc[-1] - lower.iloc[-1]) / mid.iloc[-1]) if pd.notna(mid.iloc[-1]) else None,
            'volatility30': _f(logret.std() * math.sqrt(252)) if len(logret.dropna()) > 10 else None,
            'volumeRatio': _f(df['Volume'].iloc[-20:].mean() / df['Volume'].iloc[-60:].mean()) if df['Volume'].iloc[-60:].mean() > 0 else None},
        'levels': {'high52': _f(year.max(), 2), 'low52': _f(year.min(), 2), 'position52': _f((price - year.min()) / (year.max() - year.min())) if year.max() > year.min() else None,
                   'support': support, 'resistance': resistance, 'pivot': _f(pp, 2), 'r1': _f(2 * pp - float(lo.iloc[-1]), 2), 's1': _f(2 * pp - float(hi.iloc[-1]), 2)},
        'returns': {'1m': ret(21), '3m': ret(63), '6m': ret(126), '12m': ret(252)},
        'relative': {'3m': rel(63), '6m': rel(126), '12m': rel(252)},
        'cross': cross,
    }
    out['rating']['category'] = category(out['rating']['composite'])
    out['rating']['tvCategory'] = category(out['rating']['tv'])
    out['track'] = track_record(composite, c, b)
    return out


def track_record(composite, close, bench, days=TRACK_DAYS, horizon=FORWARD_DAYS):
    """How the daily composite category did over the last `days` scored days: forward `horizon`-day return and excess vs the index."""
    fwd = close.shift(-horizon) / close - 1
    bfwd = bench.shift(-horizon) / bench - 1
    frame = pd.DataFrame({'rating': composite, 'fwd': fwd, 'excess': fwd - bfwd}).dropna().iloc[-days:]
    if frame.empty:
        return None
    frame['category'] = frame['rating'].map(category)
    out = {}
    for name, part in frame.groupby('category'):
        out[name] = {'days': int(len(part)), 'avgReturn': _f(part['fwd'].mean()), 'avgExcess': _f(part['excess'].mean()), 'hitRate': _f((part['fwd'] > 0).mean())}
    return {'horizon': horizon, 'from': frame.index[0].strftime('%Y-%m-%d'), 'to': frame.index[-1].strftime('%Y-%m-%d'), 'byCategory': out,
            '_rows': frame[['category', 'fwd', 'excess']]}


def aggregate_track(tracks):
    """Pool every stock's scored days per category: the universe-wide track record of the composite rating."""
    rows = [t['_rows'] for t in tracks if t and '_rows' in t]
    if not rows:
        return None
    frame = pd.concat(rows)
    out = {}
    for name in CATEGORIES:
        part = frame[frame['category'] == name]
        if len(part):
            out[name] = {'days': int(len(part)), 'avgReturn': _f(part['fwd'].mean()), 'avgExcess': _f(part['excess'].mean()),
                         'hitRate': _f((part['fwd'] > 0).mean()), 'beatRate': _f((part['excess'] > 0).mean())}
    return {'horizon': FORWARD_DAYS, 'stocks': len(rows), 'byCategory': out}


def build(symbols, period='3y', download=None):
    """Download OHLCV for `symbols` and ^GSPC and analyse each; returns the payload published as data/technical.json."""
    if download is None:
        import yfinance as yf
        download = lambda tickers: yf.download(tickers, period=period, interval='1d', auto_adjust=True, progress=False, group_by='ticker', threads=True)
    tickers = list(dict.fromkeys(list(symbols) + ['^GSPC']))
    raw = download([t.replace('.', '-') for t in tickers])
    def frame(symbol):
        key = symbol.replace('.', '-')
        try:
            df = raw[key] if isinstance(raw.columns, pd.MultiIndex) else raw
        except KeyError:
            return None
        return df[['Open', 'High', 'Low', 'Close', 'Volume']].astype(float) if set(['Open', 'High', 'Low', 'Close', 'Volume']) <= set(df.columns) else None
    bench_df = frame('^GSPC')
    if bench_df is None or bench_df['Close'].dropna().empty:
        raise RuntimeError('S&P 500 history is unavailable.')
    bench = bench_df['Close'].dropna()
    stocks, tracks = {}, []
    for symbol in symbols:
        df = frame(symbol)
        if df is None:
            continue
        try:
            result = analyse(df, bench)
        except Exception as exc:          # one bad series must not stop the others
            print('technical', symbol, exc)
            continue
        if result:
            tracks.append(result['track'])
            if result['track']:
                result['track'] = {k: v for k, v in result['track'].items() if k != '_rows'}
            stocks[symbol] = result
    return {'schema': SCHEMA, 'at': datetime.now().astimezone().isoformat(timespec='seconds'), 'source': 'Yahoo Finance daily OHLCV (yfinance), adjusted',
            'method': 'TradingView Technical Ratings rules + volume and relative-strength groups', 'stocks': stocks, 'track': aggregate_track(tracks)}
