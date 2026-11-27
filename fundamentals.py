"""Fundamental analysis for every stock in the report, built at site-build time.

Sources: Yahoo Finance company statistics (yfinance `Ticker.info`), the Equity Rank public per-stock page (pillar scores,
three-year trends, earnings surprises; attribution required) and the Zyberno CC BY 4.0 row already in the valuation
snapshot. Every metric is ranked against the companies of the same GICS sector (percentile, direction-aware), because
absolute thresholds misjudge whole industries (a 3% net margin is weak for software and normal for brokers). Pillar =
mean of its ranked metrics; verdict = mean of the pillars. Missing metrics are left out, never estimated.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import math
import urllib.request

SCHEMA = 1
ER_URL = 'https://api.equity-rank.com/api/stocks/{}/public'
# (key, label, pillar, higher_is_better)
METRICS = [
    ('netMargin', 'Net margin', 'profitability', True), ('operatingMargin', 'Operating margin', 'profitability', True),
    ('grossMargin', 'Gross margin', 'profitability', True), ('roe', 'Return on equity', 'profitability', True),
    ('roa', 'Return on assets', 'profitability', True), ('roic', 'Return on invested capital', 'profitability', True),
    ('revenueGrowth', 'Revenue growth (year on year)', 'growth', True), ('earningsGrowth', 'Earnings growth (year on year)', 'growth', True),
    ('forwardEpsGrowth', 'Expected EPS growth (forward vs trailing)', 'growth', True), ('fcfCagr3y', 'Free cash flow growth, 3 years', 'growth', True),
    ('debtToEquity', 'Debt / equity', 'health', False), ('currentRatio', 'Current ratio', 'health', True), ('quickRatio', 'Quick ratio', 'health', True),
    ('netCashToCap', 'Net cash / market cap', 'health', True), ('erHealth', 'Equity Rank financial health', 'health', True),
    ('forwardPE', 'Forward P/E', 'valuation', False), ('peg', 'PEG ratio', 'valuation', False), ('evToEbitda', 'EV / EBITDA', 'valuation', False),
    ('priceToSales', 'Price / sales', 'valuation', False), ('priceToBook', 'Price / book', 'valuation', False), ('fcfYield', 'Free cash flow yield', 'valuation', True),
    ('fcfMargin', 'Free cash flow margin', 'quality', True), ('cashConversion', 'Operating cash flow / net income', 'quality', True),
    ('erQuality', 'Equity Rank earnings quality', 'quality', True), ('erProfitability', 'Equity Rank profitability', 'quality', True),
    ('surprise', 'Average earnings surprise, last 4 reports', 'momentum', True), ('roeSlope', 'ROE trend, 3 years', 'momentum', True),
    ('grossMarginChange', 'Gross margin change, 3 years', 'momentum', True), ('analystMean', 'Analyst recommendation (1 = strong buy)', 'momentum', False),
    ('dividendYield', 'Dividend yield', 'shareholder', True), ('payoutSafety', 'Payout ratio headroom', 'shareholder', True),
    ('erCapital', 'Equity Rank capital allocation', 'shareholder', True),
]
PILLARS = [('profitability', 'Profitability'), ('growth', 'Growth'), ('health', 'Financial health'), ('valuation', 'Valuation'),
           ('quality', 'Cash flow and earnings quality'), ('momentum', 'Fundamental momentum'), ('shareholder', 'Shareholder returns')]
MIN_PEERS = 5          # fewer sector peers with the metric: rank against the whole universe instead


def _num(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def category(score):
    if score is None:
        return None
    if score >= 0.35:
        return 'Strong'
    if score >= 0.1:
        return 'Good'
    if score > -0.1:
        return 'Neutral'
    if score > -0.35:
        return 'Weak'
    return 'Very weak'


def metrics_from(info, er=None, zyberno=None):
    """The raw metrics of one company from Yahoo statistics, the Equity Rank page and the Zyberno row (any may be missing)."""
    info, er, zyberno = info or {}, er or {}, zyberno or {}
    g = lambda k: _num(info.get(k))
    cap, cash, debt, fcf, ocf = g('marketCap'), g('totalCash'), g('totalDebt'), g('freeCashflow'), g('operatingCashflow')
    revenue = g('totalRevenue') or (cap / g('priceToSalesTrailing12Months') if cap and g('priceToSalesTrailing12Months') else None)
    net_income = g('netIncomeToCommon')
    fpe, tpe = g('forwardPE'), g('trailingPE')
    feps, teps = g('forwardEps'), g('trailingEps')
    pillars = {p.get('key'): _num(p.get('score')) for p in ((er.get('fundamental_strength') or {}).get('pillars') or [])}
    reports = ((er.get('earnings_history') or {}).get('reports') or [])[:4]
    surprises = [_num(r.get('surprise_pct')) for r in reports if _num(r.get('surprise_pct')) is not None]
    payout, dy = g('payoutRatio'), g('dividendYield')
    out = {
        'netMargin': g('profitMargins'), 'operatingMargin': g('operatingMargins'), 'grossMargin': g('grossMargins'),
        'roe': g('returnOnEquity'), 'roa': g('returnOnAssets'), 'roic': _num(zyberno.get('roic')) / 100 if _num(zyberno.get('roic')) is not None else None,
        'revenueGrowth': g('revenueGrowth'), 'earningsGrowth': g('earningsGrowth'),
        'forwardEpsGrowth': feps / teps - 1 if feps is not None and teps and teps > 0 else None,
        'fcfCagr3y': _num(er.get('fcf_3yr_cagr')),
        'debtToEquity': g('debtToEquity') / 100 if g('debtToEquity') is not None else None,
        'currentRatio': g('currentRatio'), 'quickRatio': g('quickRatio'),
        'netCashToCap': (cash - debt) / cap if cash is not None and debt is not None and cap else None,
        'erHealth': pillars.get('financial_health'),
        'forwardPE': fpe if fpe and fpe > 0 else None, 'peg': g('trailingPegRatio') if g('trailingPegRatio') and g('trailingPegRatio') > 0 else None,
        'evToEbitda': g('enterpriseToEbitda') if g('enterpriseToEbitda') and g('enterpriseToEbitda') > 0 else None,
        'priceToSales': g('priceToSalesTrailing12Months'), 'priceToBook': g('priceToBook') if g('priceToBook') and g('priceToBook') > 0 else None,
        'fcfYield': fcf / cap if fcf is not None and cap else None,
        'fcfMargin': fcf / revenue if fcf is not None and revenue else None,
        'cashConversion': ocf / net_income if ocf is not None and net_income and net_income > 0 else None,
        'erQuality': pillars.get('earnings_quality'), 'erProfitability': pillars.get('profitability'),
        'surprise': sum(surprises) / len(surprises) / 100 if surprises else None,
        'roeSlope': _num(er.get('roe_3yr_slope')), 'grossMarginChange': _num(er.get('gross_margin_3yr_change')),
        'analystMean': g('recommendationMean'),
        # a dividend counts only where one is paid; headroom = 1 - payout, so a payout above 100% ranks low
        'dividendYield': (dy / 100 if dy and dy > 1 else dy) if dy and dy > 0 else None,
        'payoutSafety': 1 - payout if payout and payout > 0 and dy and dy > 0 else None,
        'erCapital': pillars.get('capital_allocation'),
    }
    extras = {'trailingPE': tpe, 'beta': g('beta'), 'marketCap': cap, 'industry': info.get('industry'), 'sector': info.get('sector'),
              'erStrength': _num(er.get('fundamental_strength_score')), 'erGrade': er.get('fundamental_strength_grade'),
              'nextEarnings': er.get('next_earnings_date'), 'reports': [{k: r.get(k) for k in ('report_date', 'eps_estimate', 'eps_actual', 'surprise_pct')} for r in reports]}
    return out, extras


def rank(values, value, higher):
    """Direction-aware percentile of `value` among `values`, mapped to -1 (worst) … +1 (best)."""
    if value is None or not values:
        return None
    below = sum(1 for v in values if v < value)
    equal = sum(1 for v in values if v == value)
    p = (below + 0.5 * equal) / len(values)
    return round((2 * p - 1) if higher else (1 - 2 * p), 4)


def score_all(companies):
    """companies: {symbol: {'sector': str, 'metrics': {...}}} → adds 'ranks', 'pillars', 'score', 'category'; returns sector medians."""
    by_sector, universe = {}, {}
    for sym, c in companies.items():
        for key, *_ in METRICS:
            v = c['metrics'].get(key)
            if v is not None:
                by_sector.setdefault(c['sector'], {}).setdefault(key, []).append(v)
                universe.setdefault(key, []).append(v)
    medians = {}
    for sector, keys in by_sector.items():
        medians[sector] = {k: round(sorted(v)[len(v) // 2], 4) for k, v in keys.items()}
    for sym, c in companies.items():
        ranks, pillars = {}, {}
        for key, label, pillar, higher in METRICS:
            peers = by_sector.get(c['sector'], {}).get(key, [])
            pool = peers if len(peers) >= MIN_PEERS else universe.get(key, [])
            r = rank(pool, c['metrics'].get(key), higher)
            if r is not None:
                ranks[key] = r
                pillars.setdefault(pillar, []).append(r)
        c['ranks'] = ranks
        c['pillars'] = {p: round(sum(v) / len(v), 4) for p, v in pillars.items()}
        c['score'] = round(sum(c['pillars'].values()) / len(c['pillars']), 4) if len(c['pillars']) >= 3 else None
        c['category'] = category(c['score'])
        c['coverage'] = round(len(ranks) / len(METRICS), 2)
    return medians


def _fetch_info(symbol):
    import yfinance as yf
    try:
        return yf.Ticker(symbol.replace('.', '-')).info or {}
    except Exception:
        return {}


def _fetch_er(symbol):
    try:
        req = urllib.request.Request(ER_URL.format(symbol.replace('.', '-')), headers={'User-Agent': 'Dashivo SP500 Research (https://github.com/afilipv08/dashivo-sp500-research)'})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def build(rows, zyberno_rows=None, fetch_info=_fetch_info, fetch_er=_fetch_er, workers=6):
    """rows: report items with 'symbol' and 'sector'. Returns the payload published as data/fundamentals.json."""
    zyberno_rows = zyberno_rows or {}
    symbols = [r['symbol'] for r in rows]
    with ThreadPoolExecutor(workers) as pool:
        infos = dict(zip(symbols, pool.map(fetch_info, symbols)))
    with ThreadPoolExecutor(min(workers, 4)) as pool:
        ers = dict(zip(symbols, pool.map(fetch_er, symbols)))
    companies = {}
    for r in rows:
        sym = r['symbol']
        metrics, extras = metrics_from(infos.get(sym), ers.get(sym), zyberno_rows.get(sym))
        if not any(v is not None for v in metrics.values()):
            continue
        companies[sym] = {'sector': r.get('sector') or extras.get('sector') or 'Unknown', 'metrics': {k: (round(v, 4) if isinstance(v, float) else v) for k, v in metrics.items()}, **extras}
    medians = score_all(companies)
    return {'schema': SCHEMA, 'at': datetime.now().astimezone().isoformat(timespec='seconds'),
            'sources': {'yahoo': sum(1 for s in symbols if infos.get(s)), 'equityRank': sum(1 for s in symbols if ers.get(s)), 'requested': len(symbols)},
            'metrics': [{'key': k, 'label': l, 'pillar': p, 'higherIsBetter': hb} for k, l, p, hb in METRICS],
            'pillars': [{'key': k, 'label': l} for k, l in PILLARS], 'sectorMedians': medians, 'stocks': companies}
