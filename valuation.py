"""Fair value per share for every stock: eight calculated methods and five external sources, each with the formula, the inputs,
whether data was missing, and whether the method suits the company's industry.

Calculated methods use Yahoo Finance company statistics (kept in data/fundamentals.json as `raw`) and the sector medians of the
same file. External sources: Equity Rank and Zyberno (from the valuation snapshot), Slate Finch and SweetValueLab (public
datasets, fetched here), Fair Value Calculator (an image badge, shown by the page). Nothing is estimated when an input is
missing: the cell says which input is missing instead.
"""
from datetime import datetime
import json
import math
import urllib.request

SCHEMA = 1
RISK_FREE = 0.045          # 10-year US Treasury, rounded; an assumption shown with every result
EQUITY_PREMIUM = 0.05      # expected market return above the risk-free rate; an assumption
TERMINAL_GROWTH = 0.025
TAX_RATE = 0.21            # US federal corporate rate, used for the earnings power value
YEARS = 5
SLATE_URL = 'https://www.slatefinch.app/api/v1/index.json'
SWEET_URL = 'https://sweetvaluelab.com/datasets/stocks.json'
UA = {'User-Agent': 'Dashivo SP500 Research (https://github.com/afilipv08/dashivo-sp500-research)'}

# how well each method fits a GICS sector: 'good', 'limited' or 'poor', with the reason shown to the user
FIT = {
    'dcf': {'Financials': ('poor', 'Free cash flow is not meaningful for banks and insurers: lending and deposits are their operations.'),
            'REIT': ('limited', 'REITs are valued on funds from operations (FFO); free cash flow understates them.')},
    'graham': {'Information Technology': ('poor', 'Asset-light companies have little book value, so the Graham Number undervalues them.'),
               'Communication Services': ('poor', 'Asset-light companies have little book value, so the Graham Number undervalues them.'),
               'Health Care': ('limited', 'Much of the value is in research and patents that the book value does not show.'),
               'Consumer Discretionary': ('limited', 'Brands and growth are not in the book value.')},
    'ddm': {'Information Technology': ('limited', 'Dividends are a small part of what this industry returns to shareholders.'),
            'Communication Services': ('limited', 'Dividends are a small part of what this industry returns to shareholders.'),
            'Consumer Discretionary': ('limited', 'Dividends are a small part of what this industry returns to shareholders.'),
            'Health Care': ('limited', 'Dividends are a small part of what this industry returns to shareholders.')},
    'epv': {'Financials': ('poor', 'Operating profit and debt are not separable for banks and insurers.'),
            'REIT': ('limited', 'Property revaluations and FFO matter more than operating profit.')},
    'lynch': {'Utilities': ('poor', 'Regulated, slow-growing companies: a growth-based multiple does not fit.'),
              'REIT': ('limited', 'Growth in earnings per share is distorted by depreciation for REITs.'),
              'Financials': ('limited', 'Earnings growth swings with credit cycles.')},
    'pe': {'REIT': ('limited', 'Depreciation makes REIT earnings understate their cash profits; P/FFO is the usual multiple.')},
    'evEbitda': {'Financials': ('poor', 'EBITDA and enterprise value are not meaningful for banks and insurers.'),
                 'REIT': ('limited', 'Works for REITs only with property-level debt in mind.')},
    'residual': {'Information Technology': ('poor', 'Book value says little about asset-light companies.'),
                 'Communication Services': ('poor', 'Book value says little about asset-light companies.'),
                 'Health Care': ('limited', 'Book value misses research and patents.')},
}
GOOD_FOR = {'ddm': {'Utilities', 'Consumer Staples', 'Financials', 'REIT'}, 'residual': {'Financials'}, 'graham': {'Industrials', 'Materials', 'Utilities', 'Financials', 'Energy', 'Consumer Staples'}}
METHODS = [('dcf', 'Discounted cash flow'), ('graham', 'Graham Number'), ('ddm', 'Dividend discount (Gordon)'), ('epv', 'Earnings power value'),
           ('lynch', 'Peter Lynch fair value'), ('pe', 'Peer P/E multiple'), ('evEbitda', 'Peer EV/EBITDA multiple'), ('residual', 'Residual income (justified P/B)')]
SOURCES = [('equityRank', 'Equity Rank'), ('zyberno', 'Zyberno'), ('slate', 'Slate Finch'), ('sweet', 'SweetValueLab'), ('fvc', 'Fair Value Calculator')]


def _n(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _r(x, d=2):
    return round(x, d) if x is not None and math.isfinite(x) else None


def group_of(sector, industry):
    """REITs are judged apart from the rest of Real Estate (brokers and services such as CBRE are not REITs)."""
    return 'REIT' if 'REIT' in str(industry or '') else sector


def fit_of(method, sector):
    """How well a method suits the sector: an explicit entry first, then 'limited' outside the sectors a method was designed for."""
    if method in FIT and sector in FIT[method]:
        return FIT[method][sector]
    if method in ('graham', 'residual') and sector not in GOOD_FOR[method]:
        return ('limited', 'Usable here, but the method was designed for ' + ', '.join(sorted(GOOD_FOR[method])).lower() + ' companies.')
    return ('good', None)


def discount_rate(beta):
    """CAPM: risk-free + beta × equity premium, held between 7% and 13% so an odd beta cannot dominate."""
    b = beta if beta is not None and 0 < beta < 4 else 1.0
    return min(0.13, max(0.07, RISK_FREE + b * EQUITY_PREMIUM)), b


def _result(key, sector, value=None, status='ok', reason=None, formula=None, inputs=None, assumptions=None):
    fit, fit_reason = fit_of(key, sector)
    return {'key': key, 'value': _r(value), 'status': status, 'reason': reason, 'fit': fit, 'fitReason': fit_reason,
            'formula': formula, 'inputs': inputs or {}, 'assumptions': assumptions or {}}


def methods_for(raw, sector, medians, price):
    """The eight calculated methods for one company. raw = Yahoo statistics; medians = sector medians from fundamentals.json."""
    g = lambda k: _n(raw.get(k))
    shares, eps, feps, bvps = g('sharesOutstanding'), g('trailingEps'), g('forwardEps'), g('bookValue')
    fcf, ebitda, revenue, opm = g('freeCashflow'), g('ebitda'), g('revenue') or g('totalRevenue'), g('operatingMargins')
    debt, cash, roe, div = g('totalDebt') or 0.0, g('totalCash') or 0.0, g('returnOnEquity'), g('dividendRate')
    r, beta = discount_rate(g('beta'))
    growth_raw = g('earningsGrowth') if g('earningsGrowth') is not None else g('revenueGrowth')
    out = []
    # 1. discounted cash flow: five years of growth on free cash flow per share, then a terminal value
    if fcf is None or not shares:
        out.append(_result('dcf', sector, status='missing', reason='Free cash flow or share count is missing.'))
    elif fcf <= 0:
        out.append(_result('dcf', sector, status='na', reason='Free cash flow is negative, so a cash-flow valuation has nothing to discount.', inputs={'freeCashFlow': fcf}))
    else:
        rev_g = g('revenueGrowth')
        gr = min(0.12, max(0.0, rev_g if rev_g is not None else 0.05))
        per_share = fcf / shares
        pv = sum(per_share * (1 + gr) ** t / (1 + r) ** t for t in range(1, YEARS + 1))
        tv = per_share * (1 + gr) ** YEARS * (1 + TERMINAL_GROWTH) / (r - TERMINAL_GROWTH) / (1 + r) ** YEARS
        out.append(_result('dcf', sector, pv + tv, formula='Σ FCF/share × (1+g)^t / (1+r)^t for 5 years + terminal value FCF₅ × (1+gₜ) / (r − gₜ), discounted',
                           inputs={'freeCashFlow': fcf, 'shares': shares, 'fcfPerShare': _r(per_share, 3)},
                           assumptions={'growth': _r(gr, 4), 'discountRate': _r(r, 4), 'terminalGrowth': TERMINAL_GROWTH, 'years': YEARS, 'beta': _r(beta)}))
    # 2. Graham Number
    if eps is None or bvps is None:
        out.append(_result('graham', sector, status='missing', reason='Earnings per share or book value per share is missing.'))
    elif eps <= 0 or bvps <= 0:
        out.append(_result('graham', sector, status='na', reason='Earnings or book value is negative; the Graham Number needs both positive.', inputs={'eps': eps, 'bookValuePerShare': bvps}))
    else:
        out.append(_result('graham', sector, math.sqrt(22.5 * eps * bvps), formula='√(22.5 × EPS × book value per share)', inputs={'eps': eps, 'bookValuePerShare': bvps},
                           assumptions={'multiplier': 22.5}))
    # 3. dividend discount (Gordon growth)
    if div is None or div <= 0:
        res = _result('ddm', sector, status='na', reason='The company pays no dividend, so a dividend model does not apply.')
        out.append(res)
    else:
        dg = min(TERMINAL_GROWTH + 0.01, max(0.0, growth_raw if growth_raw is not None else TERMINAL_GROWTH))
        if r <= dg:
            out.append(_result('ddm', sector, status='na', reason='Expected dividend growth is not below the required return.'))
        else:
            res = _result('ddm', sector, div * (1 + dg) / (r - dg), formula='Next dividend D₀ × (1+g) / (r − g)', inputs={'annualDividend': div, 'payoutRatio': g('payoutRatio')},
                          assumptions={'dividendGrowth': _r(dg, 4), 'requiredReturn': _r(r, 4), 'beta': _r(beta)})
            payout = g('payoutRatio')
            if payout is not None and payout < 0.2 and res['fit'] == 'good':
                res['fit'], res['fitReason'] = 'limited', 'The dividend is a small share of earnings (payout below 20%), so it says little about the value.'
            out.append(res)
    # 4. earnings power value (Greenwald): today's after-tax operating profit as a perpetuity, no growth
    if opm is None or revenue is None or not shares:
        out.append(_result('epv', sector, status='missing', reason='Operating margin, revenue or share count is missing.'))
    elif opm <= 0:
        out.append(_result('epv', sector, status='na', reason='Operating profit is negative; there are no earnings to capitalize.'))
    else:
        nopat = opm * revenue * (1 - TAX_RATE)
        out.append(_result('epv', sector, (nopat / r + cash - debt) / shares, formula='(operating profit × (1 − tax) / r + cash − debt) / shares',
                           inputs={'operatingProfit': _r(opm * revenue, 0), 'cash': cash, 'debt': debt, 'shares': shares},
                           assumptions={'taxRate': TAX_RATE, 'discountRate': _r(r, 4), 'growth': 0}))
    # 5. Peter Lynch fair value: P/E equal to growth plus dividend yield
    fg = (feps / eps - 1) if feps is not None and eps and eps > 0 else growth_raw
    if eps is None or fg is None:
        out.append(_result('lynch', sector, status='missing', reason='Earnings per share or an earnings growth rate is missing.'))
    elif eps <= 0 or fg <= 0:
        out.append(_result('lynch', sector, status='na', reason='Earnings or expected earnings growth is not positive; the method needs growth.'))
    else:
        dy = (div / price) if div and price else 0.0
        fair_pe = min(25.0, max(5.0, fg * 100)) + dy * 100
        out.append(_result('lynch', sector, eps * fair_pe, formula='EPS × (growth % + dividend yield %), growth held between 5 and 25',
                           inputs={'eps': eps, 'growth': _r(fg, 4), 'dividendYield': _r(dy, 4)}, assumptions={'fairPE': _r(fair_pe, 1)}))
    # 6. sector P/E multiple on forward earnings
    mpe = _n((medians or {}).get('forwardPE'))
    if feps is None or mpe is None:
        out.append(_result('pe', sector, status='missing', reason='Forward EPS or the peer median P/E is missing.'))
    elif feps <= 0:
        out.append(_result('pe', sector, status='na', reason='Expected earnings are negative; a P/E multiple does not apply.'))
    else:
        out.append(_result('pe', sector, feps * mpe, formula='Forward EPS × peer median forward P/E', inputs={'forwardEps': feps, 'peerMedianPE': mpe}))
    # 7. sector EV/EBITDA multiple
    mev = _n((medians or {}).get('evToEbitda'))
    if ebitda is None or mev is None or not shares:
        out.append(_result('evEbitda', sector, status='missing', reason='EBITDA, share count or the peer median EV/EBITDA is missing.'))
    elif ebitda <= 0:
        out.append(_result('evEbitda', sector, status='na', reason='EBITDA is negative; an EBITDA multiple does not apply.'))
    else:
        out.append(_result('evEbitda', sector, (ebitda * mev - debt + cash) / shares, formula='(EBITDA × peer median EV/EBITDA − debt + cash) / shares',
                           inputs={'ebitda': ebitda, 'peerMedianEvEbitda': mev, 'debt': debt, 'cash': cash, 'shares': shares}))
    # 8. residual income: justified price/book = (ROE − g) / (r − g)
    rg = TERMINAL_GROWTH
    if bvps is None or roe is None:
        out.append(_result('residual', sector, status='missing', reason='Book value per share or return on equity is missing.'))
    elif bvps <= 0 or roe <= 0:
        out.append(_result('residual', sector, status='na', reason='Book value or return on equity is not positive.'))
    else:
        out.append(_result('residual', sector, bvps * (roe - rg) / (r - rg), formula='Book value per share × (ROE − g) / (r − g)',
                           inputs={'bookValuePerShare': bvps, 'roe': _r(roe, 4)}, assumptions={'growth': rg, 'requiredReturn': _r(r, 4)}))
    for m in out:
        if m['status'] == 'ok' and (m['value'] is None or m['value'] <= 0):
            m.update(status='na', value=None, reason='The calculation gives no positive value for this company.')
    return out


def _fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read())


def external_sources(fetch=_fetch):
    """Slate Finch and SweetValueLab per-share values by ticker; a failing source is simply absent."""
    out = {'slate': {'rows': {}, 'status': 'unavailable'}, 'sweet': {'rows': {}, 'status': 'unavailable'}}
    try:
        d = fetch(SLATE_URL)
        fields = d['fields']
        idx = {k: fields.index(k) for k in ('symbol', 'fair_value', 'range_low', 'range_high', 'close_date')}
        out['slate'] = {'status': 'available', 'asOf': d.get('as_of'), 'notice': d.get('notice'),
                        'rows': {row[idx['symbol']]: {'value': _n(row[idx['fair_value']]), 'low': _n(row[idx['range_low']]), 'high': _n(row[idx['range_high']])} for row in d['rows']}}
    except Exception:
        pass
    try:
        d = fetch(SWEET_URL)
        out['sweet'] = {'status': 'available', 'asOf': d.get('asOf'),
                        'rows': {x['symbol']: {'value': _n(x.get('fairValue')), 'low': _n(x.get('modelLow')), 'high': _n(x.get('modelHigh')), 'profile': x.get('profile'),
                                               'quality': x.get('quality'), 'valuedBy': x.get('valuedBy_kind')} for x in d['data'] if x.get('symbol')}}
    except Exception:
        pass
    return out


def _ext(name, sector, item, status_text, value=None, low=None, high=None, as_of=None, note=None):
    if value is None or value <= 0:
        return {'key': name, 'value': None, 'status': 'missing', 'reason': status_text}
    return {'key': name, 'value': _r(value), 'status': 'ok', 'low': _r(low), 'high': _r(high), 'asOf': as_of, 'note': note}


def build(fund, intrinsic, prices=None, fetch=_fetch):
    """fund = data/fundamentals.json payload, intrinsic = data/intrinsic_values.json payload, prices = {symbol: live price}."""
    prices = prices or {}
    ext = external_sources(fetch)
    isrc = (intrinsic or {}).get('sources') or {}
    stocks = {}
    # peer multiples by group (REITs apart); a group with fewer than five companies uses the whole universe
    groups = {}
    for f in (fund or {}).get('stocks', {}).values():
        groups.setdefault(group_of(f.get('sector'), f.get('industry')), []).append(f.get('metrics') or {})
    def med(rows, key):
        vals = sorted(v for v in (r.get(key) for r in rows) if isinstance(v, (int, float)) and v > 0)
        return vals[len(vals) // 2] if len(vals) >= 5 else None
    everyone = [m for rows in groups.values() for m in rows]
    peer_medians = {'_all': {'forwardPE': med(everyone, 'forwardPE'), 'evToEbitda': med(everyone, 'evToEbitda')}}
    for name, rows in groups.items():
        peer_medians[name] = {k: med(rows, k) or peer_medians['_all'][k] for k in ('forwardPE', 'evToEbitda')}
    for sym, f in (fund or {}).get('stocks', {}).items():
        raw, sector = f.get('raw') or {}, f.get('sector')
        group = group_of(sector, f.get('industry'))
        price = _n(prices.get(sym)) or _n(raw.get('currentPrice'))
        methods = methods_for(raw, group, peer_medians.get(group) or peer_medians['_all'], price)
        er, zy = (isrc.get('equityRank') or {}).get('rows', {}).get(sym) or {}, (isrc.get('zyberno') or {}).get('rows', {}).get(sym) or {}
        sl, sw = ext['slate']['rows'].get(sym) or {}, ext['sweet']['rows'].get(sym) or {}
        sources = [
            _ext('equityRank', sector, er, er.get('reason') or 'Not covered by Equity Rank.', er.get('value'), as_of=(er.get('asOf') or '')[:10],
                 note=(f"{int(er['modelsAbove'])} of {int(er['modelsTotal'])} models above the price" if er.get('modelsTotal') else None)),
            _ext('zyberno', sector, zy, zy.get('reason') or 'Not covered by Zyberno.', zy.get('value'), as_of=zy.get('asOf'), note='approximate per share: company value / implied shares'),
            _ext('slate', sector, sl, 'Slate Finch withholds a value for this company or does not cover it.', sl.get('value'), sl.get('low'), sl.get('high'), ext['slate'].get('asOf')),
            _ext('sweet', sector, sw, 'Not covered by SweetValueLab.', sw.get('value'), sw.get('low'), sw.get('high'), ext['sweet'].get('asOf'),
                 note=('valued with its ' + sw['profile'] + ' model') if sw.get('profile') and sw.get('profile') != 'general' else None),
        ]
        usable = [m['value'] for m in methods if m['status'] == 'ok' and m['fit'] != 'poor'] + [s['value'] for s in sources if s['status'] == 'ok']
        usable.sort()
        n = len(usable)
        median = None if not n else (usable[n // 2] if n % 2 else (usable[n // 2 - 1] + usable[n // 2]) / 2)
        stocks[sym] = {'sector': sector, 'group': group, 'industry': f.get('industry'), 'peers': peer_medians.get(group), 'price': _r(price), 'methods': methods, 'sources': sources,
                       'median': _r(median), 'count': n, 'low': _r(usable[0]) if n else None, 'high': _r(usable[-1]) if n else None,
                       'upside': _r(median / price - 1, 4) if median and price else None}
    return {'schema': SCHEMA, 'at': datetime.now().astimezone().isoformat(timespec='seconds'),
            'assumptions': {'riskFree': RISK_FREE, 'equityPremium': EQUITY_PREMIUM, 'terminalGrowth': TERMINAL_GROWTH, 'taxRate': TAX_RATE, 'years': YEARS},
            'methods': [{'key': k, 'label': l} for k, l in METHODS], 'sources': [{'key': k, 'label': l} for k, l in SOURCES],
            'external': {k: {'status': v['status'], 'asOf': v.get('asOf'), 'notice': v.get('notice')} for k, v in ext.items()}, 'stocks': stocks}
