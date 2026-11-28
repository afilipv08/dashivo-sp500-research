"""Signals: 27 trading/investing methods plus the funnel score for the stocks the site can show in its Top 10.

Built once a day at site-build time (build_site.py → data/signals.json) from free sources only:
  prices      Yahoo Finance daily OHLCV (yfinance), also SPY, VEU, AGG, ^VIX, ^VIX3M, sector ETFs, copper and gold futures
  macro       FRED public CSV (high-yield spread, yield curve, jobless claims, T-bills, 10-year yield, dollar index)
  positioning CFTC Commitments of Traders (E-mini S&P 500, leveraged funds) · Yahoo short interest · Yahoo option chains
  filings     SEC EDGAR companyfacts (XBRL statements), submissions, Form 4 insider filings, 10-K text (needs SEC_CONTACT_EMAIL)
  attention   ApeWisdom Reddit mention counts
Missing data is reported as missing and scored 0; nothing is estimated. Every rule is a starting point that has not been
backtested here, and nothing in this file is investment advice.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import csv
import io
import json
import math
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET

import numpy as np
import pandas as pd

SCHEMA = 1
MAX_SYMBOLS = 80
COST_OF_EQUITY = 0.09
SECTOR_ETF = {'Communication Services': 'XLC', 'Consumer Discretionary': 'XLY', 'Consumer Staples': 'XLP', 'Energy': 'XLE',
              'Financials': 'XLF', 'Health Care': 'XLV', 'Industrials': 'XLI', 'Information Technology': 'XLK', 'Materials': 'XLB',
              'Real Estate': 'XLRE', 'Utilities': 'XLU'}
MARKET_TICKERS = ['SPY', 'VEU', 'AGG', '^VIX', '^VIX3M', 'HG=F', 'GC=F'] + list(SECTOR_ETF.values())
FRED_SERIES = ['BAMLH0A0HYM2', 'T10Y2Y', 'ICSA', 'DTB3', 'DGS10', 'DTWEXBGS']
FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={}'
COT_URL = ('https://publicreporting.cftc.gov/resource/gpe5-46if.json?$where=market_and_exchange_names%20like%20'
           '%27E-MINI%20S%26P%20500%20-%20CHICAGO%20MERCANTILE%20EXCHANGE%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=160'
           '&$select=report_date_as_yyyy_mm_dd,lev_money_positions_long,lev_money_positions_short')
SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
SEC_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK{:010d}.json'
SEC_SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK{:010d}.json'
SEC_ARCHIVE_URL = 'https://www.sec.gov/Archives/edgar/data/{}/{}/{}'
APEWISDOM_URL = 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/{}'
CYCLE_SECTORS = {
    'Early': ['Financials', 'Consumer Discretionary', 'Industrials', 'Real Estate'],
    'Mid': ['Information Technology', 'Communication Services', 'Industrials', 'Materials'],
    'Late': ['Energy', 'Materials', 'Health Care', 'Consumer Staples', 'Utilities'],
    'Recession': ['Consumer Staples', 'Utilities', 'Health Care'],
}
CYCLICAL = {'Materials', 'Industrials', 'Energy', 'Financials', 'Consumer Discretionary', 'Information Technology'}
DEFENSIVE = {'Consumer Staples', 'Utilities', 'Health Care', 'Real Estate'}
NO_ALTMAN = {'Financials', 'Real Estate'}      # Altman Z is not defined for banks, insurers and REITs
# id, name, group — names are UI text (translated in web/i18n_sp500.js)
METHODS = [
    (1, 'Dual momentum', 'Market'), (2, 'Earnings drift', 'Events'), (3, 'Insider cluster buying', 'Smart money'),
    (4, '52-week low recovery', 'Value'), (5, 'Short squeeze', 'Smart money'), (6, 'Business cycle', 'Market'),
    (7, 'Put selling', 'Options'), (8, 'COT extremes', 'Market'), (9, 'Piotroski F-score', 'Quality'),
    (10, 'Red-flag filter', 'Quality'), (11, 'RSI(2) pullback', 'Trend'), (12, '12-1 momentum', 'Trend'),
    (13, '10-month trend', 'Trend'), (14, 'VIX spike', 'Market'), (15, 'Reverse DCF', 'Value'),
    (16, 'Spin-off', 'Events'), (17, 'Pairs trade', 'Trend'), (18, 'Seasonality', 'Market'),
    (19, '10-K wording change', 'Quality'), (20, 'Google Trends', 'Attention'), (21, 'Retail crowding', 'Attention'),
    (22, 'Real buybacks', 'Quality'), (23, 'Cross-asset signals', 'Market'), (24, 'BVB dividend gap', 'Value'),
    (25, 'Volatility targeting', 'Risk'), (26, 'Drawdown rules', 'Risk'), (27, 'ML ranking', 'Model'),
]


def now():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def _f(x, digits=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, digits) if math.isfinite(x) else None


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


# ================================================================ fetching (all injectable for tests)
class Http:
    """urllib GET with a User-Agent, retries on 429/5xx, and a polite pause for sec.gov (max ~8 requests per second)."""
    def __init__(self, contact_email=None, timeout=40):
        self.email, self.timeout = contact_email, timeout
        self._lock, self._last = threading.Lock(), 0.0

    def get(self, url, binary=False):
        sec = 'sec.gov' in url
        if sec and not self.email:
            raise PermissionError('SEC requires a contact e-mail (SEC_CONTACT_EMAIL).')
        agent = ('Dashivo SP500 Research contact: ' + self.email) if sec else 'Dashivo SP500 Research (github.com/afilipv08/dashivo-sp500-research)'
        for attempt in range(4):
            if sec:
                with self._lock:
                    wait = 0.13 - (time.monotonic() - self._last)
                    if wait > 0:
                        time.sleep(wait)
                    self._last = time.monotonic()
            req = urllib.request.Request(url, headers={'User-Agent': agent, 'Accept-Encoding': 'identity'})
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    data = r.read()
                return data if binary else data.decode('utf-8', 'replace')
            except urllib.error.HTTPError as exc:
                if exc.code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError):
                if attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise

    def json(self, url):
        return json.loads(self.get(url))


def fred_series(http, sid):
    rows = list(csv.reader(io.StringIO(http.get(FRED_URL.format(sid)))))[1:]
    out = [(r[0], float(r[1])) for r in rows if len(r) == 2 and r[1] not in ('.', '')]
    return pd.Series([v for _, v in out], index=pd.to_datetime([d for d, _ in out]))


def yf_download(tickers, period='2y'):
    import yfinance as yf
    return yf.download(tickers, period=period, interval='1d', auto_adjust=True, progress=False, group_by='ticker', threads=True)


def frame_of(raw, symbol):
    key = symbol.replace('.', '-')
    try:
        df = raw[key] if isinstance(raw.columns, pd.MultiIndex) else raw
    except KeyError:
        return None
    cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    if not set(cols) <= set(df.columns):
        return None
    df = df[cols].astype(float).dropna(subset=['Close'])
    return df if len(df) else None


def yf_extras(symbol):
    """Short interest, option chain summary and earnings dates for one stock from Yahoo (each part may be missing)."""
    import yfinance as yf
    t = yf.Ticker(symbol.replace('.', '-'))
    out = {}
    try:
        info = t.info or {}
        out['short'] = {k: _f(info.get(k)) for k in ('shortPercentOfFloat', 'shortRatio', 'sharesShort', 'sharesShortPriorMonth', 'heldPercentInstitutions')}
    except Exception as exc:
        out['shortError'] = str(exc)[:120]
    try:
        out['options'] = option_summary(t)
    except Exception as exc:
        out['optionsError'] = str(exc)[:120]
    try:
        ed = t.get_earnings_dates(limit=8)
        rows = []
        for ts, r in (ed if ed is not None else pd.DataFrame()).iterrows():
            ts = pd.Timestamp(ts)
            rows.append({'at': ts.isoformat(), 'estimate': _f(r.get('EPS Estimate')), 'reported': _f(r.get('Reported EPS')), 'surprise': _f(r.get('Surprise(%)'))})
        out['earnings'] = rows
    except Exception as exc:
        out['earningsError'] = str(exc)[:120]
    return out


def option_summary(ticker):
    """At-the-money implied volatility of the first expiry 20+ days out, and the put/call open-interest ratio of the first two expiries."""
    exps = list(ticker.options or [])
    if not exps:
        return None
    hist = ticker.history(period='5d')
    spot = float(hist['Close'].dropna().iloc[-1]) if len(hist) else None
    today = date.today()
    far = [e for e in exps if (datetime.strptime(e, '%Y-%m-%d').date() - today).days >= 20] or exps
    chain = ticker.option_chain(far[0])
    iv = None
    if spot:
        calls = chain.calls.dropna(subset=['impliedVolatility'])
        if len(calls):
            iv = float(calls.iloc[(calls['strike'] - spot).abs().argsort()[:2]]['impliedVolatility'].mean())
    put_oi = call_oi = 0.0
    for e in exps[:2]:
        c = ticker.option_chain(e)
        call_oi += float(c.calls['openInterest'].fillna(0).sum())
        put_oi += float(c.puts['openInterest'].fillna(0).sum())
    return {'expiry': far[0], 'atmIv': _f(iv), 'putCallOi': _f(put_oi / call_oi) if call_oi > 0 else None, 'openInterest': int(put_oi + call_oi)}


# ================================================================ SEC parsing
class Facts:
    """Flow (duration) and stock (instant) values from SEC companyfacts, 10-K/10-Q only, latest filing wins."""
    def __init__(self, companyfacts):
        self.flows, self.instants, self.dei = {}, {}, {}
        facts = (companyfacts or {}).get('facts') or {}
        for taxonomy in ('us-gaap', 'ifrs-full'):
            for tag, body in (facts.get(taxonomy) or {}).items():
                for unit, rows in (body.get('units') or {}).items():
                    if not (unit == 'USD' or unit == 'shares' or unit.startswith('USD/')):
                        continue
                    for r in rows:
                        if not str(r.get('form', '')).startswith(('10-K', '10-Q', '20-F', '40-F')):
                            continue
                        end = r.get('end')
                        if r.get('start'):
                            key = (r['start'], end)
                            store = self.flows.setdefault(tag, {})
                        else:
                            key = end
                            store = self.instants.setdefault(tag, {})
                        if key not in store or str(r.get('filed', '')) >= store[key][1]:
                            store[key] = (float(r['val']), str(r.get('filed', '')))
        for tag, body in (facts.get('dei') or {}).items():
            for unit, rows in (body.get('units') or {}).items():
                if rows:
                    self.dei[tag] = max(rows, key=lambda r: (r.get('end', ''), r.get('filed', '')))['val']

    @staticmethod
    def _days(start, end):
        return (date.fromisoformat(end) - date.fromisoformat(start)).days

    def _tag(self, tags, store):
        for t in tags:
            if store.get(t):
                return store[t]
        return None

    def latest_end(self, tags):
        rows = self._tag(tags, self.flows)
        return max(e for _, e in rows) if rows else None

    def flow(self, tags, start_min, start_max, end):
        rows = self._tag(tags, self.flows) or {}
        for (s, e), (v, _) in rows.items():
            if e == end and start_min <= self._days(s, e) <= start_max:
                return v
        return None

    def quarter(self, tags, end):
        """The 3-month value ending at `end`; a fourth quarter is derived as full year minus nine months."""
        q = self.flow(tags, 80, 100, end)
        if q is not None:
            return q
        fy, nine = self.flow(tags, 350, 380, end), None
        if fy is not None:
            rows = self._tag(tags, self.flows) or {}
            for (s, e), (v, _) in rows.items():
                if 260 <= self._days(s, e) <= 285 and 80 <= (date.fromisoformat(end) - date.fromisoformat(e)).days <= 100:
                    nine = v
            return fy - nine if nine is not None else None
        return None

    def ttm(self, tags, end):
        """Trailing twelve months ending at `end`: full year, or year-to-date + previous full year − previous year-to-date."""
        fy = self.flow(tags, 350, 380, end)
        if fy is not None:
            return fy
        rows = self._tag(tags, self.flows) or {}
        ytd = [(self._days(s, e), v) for (s, e), (v, _) in rows.items() if e == end and 80 <= self._days(s, e) <= 285]
        if not ytd:
            return None
        span, value = max(ytd)
        e_prev = date.fromisoformat(end) - timedelta(days=365)
        prev_fy = prev_ytd = None
        for (s, e), (v, _) in rows.items():
            d_end = date.fromisoformat(e)
            if abs((d_end - (date.fromisoformat(end) - timedelta(days=span))).days) <= 15 and 350 <= self._days(s, e) <= 380:
                prev_fy = v
            if abs((d_end - e_prev).days) <= 15 and abs(self._days(s, e) - span) <= 15:
                prev_ytd = v
        return value + prev_fy - prev_ytd if prev_fy is not None and prev_ytd is not None else None

    def instant(self, tags, end, tolerance=20):
        rows = self._tag(tags, self.instants) or {}
        best = None
        for e, (v, _) in rows.items():
            gap = abs((date.fromisoformat(e) - date.fromisoformat(end)).days)
            if gap <= tolerance and (best is None or gap < best[0]):
                best = (gap, v)
        return best[1] if best else None

    def annual_series(self, tags, years=6):
        rows = self._tag(tags, self.flows) or {}
        out = {}
        for (s, e), (v, _) in rows.items():
            if 350 <= self._days(s, e) <= 380:
                out[e] = v
        return [out[k] for k in sorted(out)][-years:]


TAGS = {
    'rev': ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense', 'Revenue'],
    'op': ['OperatingIncomeLoss'], 'ni': ['NetIncomeLoss', 'ProfitLoss'],
    'cfo': ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    'capex': ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
    'da': ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation'],
    'shares': ['WeightedAverageNumberOfDilutedSharesOutstanding'], 'assets': ['Assets'], 'liab': ['Liabilities'],
    'lse': ['LiabilitiesAndStockholdersEquity'],
    'equity': ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    'ltd': ['LongTermDebt', 'LongTermDebtNoncurrent'], 'ltd_cur': ['LongTermDebtCurrent'],
    'cash': ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    'ca': ['AssetsCurrent'], 'cl': ['LiabilitiesCurrent'], 're': ['RetainedEarningsAccumulatedDeficit'],
    'ar': ['AccountsReceivableNetCurrent'], 'sga': ['SellingGeneralAndAdministrativeExpense'], 'ppe': ['PropertyPlantAndEquipmentNet'],
    'gp': ['GrossProfit'], 'cogs': ['CostOfRevenue', 'CostOfGoodsAndServicesSold'], 'buyback': ['PaymentsForRepurchaseOfCommonStock'],
}


def fundamentals_from(facts, price=None):
    """The statement figures the methods need, for the latest reported period and one year earlier (None when missing)."""
    end = facts.latest_end(TAGS['rev']) or facts.latest_end(TAGS['ni'])
    if not end:
        return None
    e = date.fromisoformat(end)
    prev = (e - timedelta(days=364)).isoformat()
    prev2 = (e - timedelta(days=728)).isoformat()
    q_prev_end = None
    rows = facts._tag(TAGS['rev'], facts.flows) or {}
    ends = sorted({x for _, x in rows if 70 <= (e - date.fromisoformat(x)).days <= 110})
    q_prev_end = ends[-1] if ends else None
    F = {'end': end}
    for k in ('rev', 'op', 'ni', 'cfo', 'capex', 'da', 'sga', 'gp', 'cogs', 'buyback'):
        F[k + '_ttm'] = facts.ttm(TAGS[k], end)
        F[k + '_ttm_prev'] = facts.ttm(TAGS[k], _match_end(facts, TAGS[k], prev))
    for k in ('rev', 'op'):
        F[k + '_q'] = facts.quarter(TAGS[k], end)
        F[k + '_q_ly'] = facts.quarter(TAGS[k], _match_end(facts, TAGS[k], prev))
        if q_prev_end:
            F[k + '_q1'] = facts.quarter(TAGS[k], q_prev_end)
            F[k + '_q1_ly'] = facts.quarter(TAGS[k], _match_end(facts, TAGS[k], (date.fromisoformat(q_prev_end) - timedelta(days=364)).isoformat()))
    F['shares_q'] = facts.quarter(TAGS['shares'], end) or facts.flow(TAGS['shares'], 80, 380, end)
    F['shares_q_ly'] = facts.quarter(TAGS['shares'], _match_end(facts, TAGS['shares'], prev)) or facts.flow(TAGS['shares'], 80, 380, _match_end(facts, TAGS['shares'], prev))
    for k in ('assets', 'liab', 'lse', 'equity', 'ltd', 'ltd_cur', 'cash', 'ca', 'cl', 're', 'ar', 'ppe'):
        F[k] = facts.instant(TAGS[k], end)
        F[k + '_prev'] = facts.instant(TAGS[k], prev)
        F[k + '_prev2'] = facts.instant(TAGS[k], prev2)
    for suffix in ('', '_prev', '_prev2'):
        if F['liab' + suffix] is None and F['lse' + suffix] is not None and F['equity' + suffix] is not None:
            F['liab' + suffix] = F['lse' + suffix] - F['equity' + suffix]
        if F['ltd' + suffix] is None and F['ltd_cur' + suffix] is not None:
            F['ltd' + suffix] = F['ltd_cur' + suffix]
    F['shares_out'] = facts.dei.get('EntityCommonStockSharesOutstanding')
    cfo, capex = facts.annual_series(TAGS['cfo']), facts.annual_series(TAGS['capex'])
    n = min(len(cfo), len(capex))
    F['fcf_hist'] = [c - x for c, x in zip(cfo[-n:], capex[-n:])] if n else []
    F['mcap'] = F['shares_out'] * price if F['shares_out'] and price else None
    return F


def _match_end(facts, tags, target):
    """The reported period end closest to `target` (within 20 days), so quarters line up with the same quarter a year earlier."""
    rows = facts._tag(tags, facts.flows) or {}
    t = date.fromisoformat(target)
    ends = sorted({e for _, e in rows}, key=lambda x: abs((date.fromisoformat(x) - t).days))
    return ends[0] if ends and abs((date.fromisoformat(ends[0]) - t).days) <= 20 else target


def _ratio(a, b):
    return a / b if _num(a) and _num(b) and b != 0 else None


def quality_checks(F):
    """Funnel pillar Quality: five pass/fail checks, mapped 5 → +2 … 0–1 → −2 (None when the filings are missing)."""
    if not F:
        return None
    g_q = _ratio(F.get('rev_q'), F.get('rev_q_ly'))
    g_q1 = _ratio(F.get('rev_q1'), F.get('rev_q1_ly'))
    g_q = g_q - 1 if g_q is not None else None
    g_q1 = g_q1 - 1 if g_q1 is not None else None
    m, m_ly = _ratio(F.get('op_q'), F.get('rev_q')), _ratio(F.get('op_q_ly'), F.get('rev_q_ly'))
    margin_label = 'Operating margin ≥ a year ago'
    if m is None or m_ly is None:
        m, m_ly, margin_label = _ratio(F.get('ni_ttm'), F.get('rev_ttm')), _ratio(F.get('ni_ttm_prev'), F.get('rev_ttm_prev')), 'Net margin ≥ a year ago (12 months)'
    fcf = F['cfo_ttm'] - F['capex_ttm'] if _num(F.get('cfo_ttm')) and _num(F.get('capex_ttm')) else None
    fcf_label = 'Free cash flow positive (12 months)'
    if fcf is None and _num(F.get('cfo_ttm')):
        fcf, fcf_label = F['cfo_ttm'], 'Operating cash flow positive (12 months, no capex reported)'
    ebitda = F['op_ttm'] + F['da_ttm'] if _num(F.get('op_ttm')) and _num(F.get('da_ttm')) else None
    net_debt = (F.get('ltd') or 0) - (F.get('cash') or 0) if F.get('ltd') is not None or F.get('cash') is not None else None
    nd_e = net_debt / ebitda if _num(net_debt) and _num(ebitda) and ebitda > 0 else None
    sh = _ratio(F.get('shares_q'), F.get('shares_q_ly'))
    sh = sh - 1 if sh is not None else None
    debt_known = nd_e is not None or (_num(net_debt) and net_debt <= 0) or (_num(ebitda) and ebitda <= 0)
    items = [
        ('Revenue growth > 8% year over year', None if g_q is None else g_q > 0.08, _f(g_q)),
        ('Growth this quarter ≥ last quarter', None if g_q is None or g_q1 is None else g_q >= g_q1, [_f(g_q1), _f(g_q)]),
        (margin_label, None if m is None or m_ly is None else m >= m_ly, [_f(m_ly), _f(m)]),
        (fcf_label, None if fcf is None else fcf > 0, _f(fcf, 0)),
        ('Net debt / EBITDA < 3 and shares +3% at most', None if not debt_known else (nd_e is not None and nd_e < 3 or (_num(net_debt) and net_debt <= 0)) and (sh is None or sh <= 0.03), [_f(nd_e, 2), _f(sh)]),
    ]
    known = [ok for _, ok, _ in items if ok is not None]
    passed = sum(1 for ok in known if ok)
    scaled = round(passed * 5 / len(known)) if len(known) >= 3 else None
    return {'items': [{'label': l, 'ok': None if ok is None else bool(ok), 'value': v} for l, ok, v in items], 'passed': passed, 'known': len(known),
            'score': None if scaled is None else {5: 2, 4: 1, 3: 0, 2: -1}.get(scaled, -2), 'revGrowth': _f(g_q), 'fcf': _f(fcf, 0) if fcf_label.startswith('Free') else None,
            'netDebtEbitda': _f(nd_e, 2), 'shareChange': _f(sh)}


def piotroski(F):
    if not F or not all(_num(F.get(k)) for k in ('ni_ttm', 'ni_ttm_prev', 'assets', 'assets_prev', 'cfo_ttm')):
        return None
    avg = (F['assets'] + F['assets_prev']) / 2
    avg_prev = (F['assets_prev'] + F['assets_prev2']) / 2 if _num(F.get('assets_prev2')) else F['assets_prev']
    roa, roa_prev = F['ni_ttm'] / avg, F['ni_ttm_prev'] / avg_prev
    lev, lev_prev = _ratio(F.get('ltd'), F['assets']), _ratio(F.get('ltd_prev'), F['assets_prev'])
    cr, cr_prev = _ratio(F.get('ca'), F.get('cl')), _ratio(F.get('ca_prev'), F.get('cl_prev'))
    if _num(F.get('gp_ttm')) and _num(F.get('gp_ttm_prev')):
        margin, margin_prev, margin_label = _ratio(F['gp_ttm'], F.get('rev_ttm')), _ratio(F['gp_ttm_prev'], F.get('rev_ttm_prev')), 'Gross margin up'
    else:
        margin, margin_prev, margin_label = _ratio(F.get('op_ttm'), F.get('rev_ttm')), _ratio(F.get('op_ttm_prev'), F.get('rev_ttm_prev')), 'Operating margin up (no gross margin reported)'
    turn, turn_prev = _ratio(F.get('rev_ttm'), avg), _ratio(F.get('rev_ttm_prev'), avg_prev)
    tests = [('ROA positive', roa > 0), ('Operating cash flow positive', F['cfo_ttm'] > 0), ('ROA up', roa > roa_prev),
             ('Cash flow above net income', F['cfo_ttm'] > F['ni_ttm']),
             ('Long-term debt / assets down', lev is not None and lev_prev is not None and lev <= lev_prev),
             ('Current ratio up', cr is not None and cr_prev is not None and cr > cr_prev),
             ('No new shares', _num(F.get('shares_q')) and _num(F.get('shares_q_ly')) and F['shares_q'] <= F['shares_q_ly']),
             (margin_label, margin is not None and margin_prev is not None and margin > margin_prev),
             ('Asset turnover up', turn is not None and turn_prev is not None and turn > turn_prev)]
    pb = _ratio(F.get('mcap'), F.get('equity')) if _num(F.get('equity')) and F['equity'] > 0 else None
    return {'score': sum(1 for _, ok in tests if ok), 'tests': [{'label': l, 'ok': bool(ok)} for l, ok in tests], 'pb': _f(pb, 2)}


def red_flags(F, sector):
    out = {'altman': None, 'altmanZ2': None, 'beneish': None}
    if not F:
        return out
    TA, liab = F.get('assets'), F.get('liab')
    if sector not in NO_ALTMAN and all(_num(x) for x in (TA, liab, F.get('ca'), F.get('cl'), F.get('re'), F.get('op_ttm'), F.get('rev_ttm'))) and TA > 0 and liab > 0:
        x1, x2, x3, x5 = (F['ca'] - F['cl']) / TA, F['re'] / TA, F['op_ttm'] / TA, F['rev_ttm'] / TA
        if _num(F.get('mcap')):
            out['altman'] = _f(1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * F['mcap'] / liab + 1.0 * x5, 2)
        if _num(F.get('equity')):
            out['altmanZ2'] = _f(6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * F['equity'] / liab, 2)
    need = ('ar', 'ar_prev', 'rev_ttm', 'rev_ttm_prev', 'ca', 'ca_prev', 'ppe', 'ppe_prev', 'assets', 'assets_prev', 'da_ttm', 'da_ttm_prev',
            'ni_ttm', 'cfo_ttm', 'liab', 'liab_prev')
    if all(_num(F.get(k)) for k in need) and F['ar_prev'] > 0:
        dsri = (F['ar'] / F['rev_ttm']) / (F['ar_prev'] / F['rev_ttm_prev'])
        gm, gm_prev = _ratio(F.get('gp_ttm'), F['rev_ttm']), _ratio(F.get('gp_ttm_prev'), F['rev_ttm_prev'])
        gmi = gm_prev / gm if gm and gm_prev else 1.0
        aqi = (1 - (F['ca'] + F['ppe']) / F['assets']) / (1 - (F['ca_prev'] + F['ppe_prev']) / F['assets_prev'])
        sgi = F['rev_ttm'] / F['rev_ttm_prev']
        depi = (F['da_ttm_prev'] / (F['da_ttm_prev'] + F['ppe_prev'])) / (F['da_ttm'] / (F['da_ttm'] + F['ppe']))
        sgai = ((F['sga_ttm'] / F['rev_ttm']) / (F['sga_ttm_prev'] / F['rev_ttm_prev'])) if _num(F.get('sga_ttm')) and _num(F.get('sga_ttm_prev')) and F['sga_ttm_prev'] else 1.0
        tata = (F['ni_ttm'] - F['cfo_ttm']) / F['assets']
        lvgi = (F['liab'] / F['assets']) / (F['liab_prev'] / F['assets_prev'])
        out['beneish'] = _f(-4.84 + .92 * dsri + .528 * gmi + .404 * aqi + .892 * sgi + .115 * depi - .172 * sgai + 4.679 * tata - .327 * lvgi, 2)
        out['beneishGrossMarginNeutral'] = gm is None
    return out


def implied_growth(mcap, fcf, r=COST_OF_EQUITY):
    """Perpetual growth g that makes value = FCF·(1+g)/(r−g) equal to the market cap."""
    if not (_num(mcap) and _num(fcf)) or fcf <= 0 or mcap <= 0:
        return None
    return (mcap * r - fcf) / (mcap + fcf)


def cagr(values):
    vals = [v for v in values if _num(v)]
    if len(vals) < 3 or vals[0] <= 0 or vals[-1] <= 0:
        return None
    return (vals[-1] / vals[0]) ** (1 / (len(vals) - 1)) - 1


# ================================================================ insider filings
def insider_activity(http, cik, submissions, days=120, limit=15):
    """Open-market buys (code P) and sells (code S) from the Form 4 filings of the last `days` days."""
    r = (submissions or {}).get('filings', {}).get('recent', {})
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows = [(r['filingDate'][i], r['accessionNumber'][i], r['primaryDocument'][i]) for i in range(len(r.get('form', [])))
            if r['form'][i] == '4' and r['filingDate'][i] >= cutoff][:limit]
    trades = []
    for filed, acc, doc in rows:
        try:
            raw = http.get(SEC_ARCHIVE_URL.format(int(cik), acc.replace('-', ''), doc.split('/')[-1]))
            root = ET.fromstring(raw)
        except Exception:
            continue
        name = root.findtext('.//reportingOwner/reportingOwnerId/rptOwnerName') or '?'
        title = root.findtext('.//reportingOwnerRelationship/officerTitle') or ('Director' if root.findtext('.//reportingOwnerRelationship/isDirector') in ('1', 'true') else '')
        for tx in root.findall('.//nonDerivativeTransaction'):
            code = tx.findtext('.//transactionCoding/transactionCode')
            if code not in ('P', 'S'):
                continue
            shares, price = _f(tx.findtext('.//transactionAmounts/transactionShares/value')), _f(tx.findtext('.//transactionAmounts/transactionPricePerShare/value'))
            after = _f(tx.findtext('.//postTransactionAmounts/sharesOwnedFollowingTransaction/value'))
            trades.append({'date': tx.findtext('.//transactionDate/value') or filed, 'name': name.title(), 'title': title, 'code': code,
                           'shares': shares, 'price': price, 'value': _f((shares or 0) * (price or 0), 0), 'after': after})
    return trades


def summarize_insiders(trades, today=None):
    today = today or date.today()
    def within(t, d):
        try:
            return (today - date.fromisoformat(t['date'][:10])).days <= d
        except ValueError:
            return False
    buys30 = [t for t in trades if t['code'] == 'P' and within(t, 30)]
    buys14 = [t for t in trades if t['code'] == 'P' and within(t, 14)]
    sells = {}
    for t in trades:
        if t['code'] == 'S' and t['shares'] and t['after'] is not None:
            s = sells.setdefault(t['name'], {'sold': 0.0, 'after': t['after']})
            s['sold'] += t['shares']
            s['after'] = min(s['after'], t['after'])
    big_sellers = [n for n, s in sells.items() if s['sold'] / (s['sold'] + s['after']) > 0.20] if sells else []
    return {'buyers30': len({t['name'] for t in buys30}), 'buyers14': len({t['name'] for t in buys14}),
            'value14': _f(sum(t['value'] or 0 for t in buys14), 0), 'buys': sum(1 for t in trades if t['code'] == 'P'),
            'sells': sum(1 for t in trades if t['code'] == 'S'), 'bigSellers': big_sellers,
            'buyValue': _f(sum(t['value'] or 0 for t in trades if t['code'] == 'P'), 0),
            'sellValue': _f(sum(t['value'] or 0 for t in trades if t['code'] == 'S'), 0),
            'lastBuy': max((t['date'] for t in trades if t['code'] == 'P'), default=None)}


# ================================================================ 10-K wording
WORD = re.compile(r'[a-z]{3,}')


def tenk_text(html):
    text = re.sub(r'(?is)<(script|style).*?</\1>', ' ', html)
    text = re.sub(r'(?s)<[^>]+>', ' ', text)
    text = re.sub(r'&[#a-z0-9]+;', ' ', text, flags=re.I)
    low = text.lower()
    best = ''
    for m in re.finditer(r'item\s*1a\.?\s*risk\s*factors', low):
        stop = re.search(r'item\s*(1b|1c|2)\.?\s', low[m.start() + 200:])
        part = low[m.start(): m.start() + 200 + (stop.start() if stop else 400000)]
        if len(part) > len(best):
            best = part
    if len(best) > 5000:
        return best
    return low


SENT = re.compile(r'(?<=[.!?])\s+')


def sentences(text):
    norm = lambda x: re.sub(r'\s+', ' ', re.sub(r'[^a-z ]', ' ', x)).strip()      # years, amounts and punctuation change every year
    return {norm(x) for x in SENT.split(text) if len(x.split()) >= 8}


def new_text_share(current, previous):
    """Share of the current risk-factor sentences (8+ words) that do not appear word for word in the previous 10-K."""
    cur, prev = sentences(current), sentences(previous)
    return (len(cur - prev) / len(cur), len(cur)) if cur else (None, 0)


def tenk_similarity(http, cik, submissions, cached=None):
    r = (submissions or {}).get('filings', {}).get('recent', {})
    tenks = [(r['accessionNumber'][i], r['primaryDocument'][i], r['filingDate'][i]) for i in range(len(r.get('form', []))) if r['form'][i] == '10-K'][:2]
    if len(tenks) < 2:
        return None
    if cached and cached.get('accession') == tenks[0][0]:
        return cached
    texts = [tenk_text(http.get(SEC_ARCHIVE_URL.format(int(cik), acc.replace('-', ''), doc))) for acc, doc, _ in tenks]
    share, n = new_text_share(texts[0], texts[1])
    return {'accession': tenks[0][0], 'filed': tenks[0][2], 'previousFiled': tenks[1][2], 'newShare': _f(share, 3), 'sentences': n}


# ================================================================ market context
def percentile_of(value, series):
    s = [x for x in series if _num(x)]
    return 100.0 * sum(1 for x in s if x < value) / len(s) if s and _num(value) else None


def market_context(px, fred, cot, hist=None, today=None):
    """Regime (5 indicators), sector ranking, business-cycle phase and the market-level methods. px: {ticker: DataFrame}."""
    today = today or date.today()
    out = {'regime': {'items': []}}
    spy = px.get('SPY')
    items, total, known = out['regime']['items'], 0, 0

    def add(key, label, value, score):
        nonlocal total, known
        items.append({'key': key, 'label': label, 'value': value, 'score': score})
        if score is not None:
            total += score
            known += 1
    if spy is not None and len(spy) > 220:
        c = spy['Close']
        ma200, ma200_prev = c.rolling(200).mean().iloc[-1], c.rolling(200).mean().iloc[-21]
        add('trend', 'SPY vs 200-day average', [_f(c.iloc[-1], 2), _f(ma200, 2)], 1 if c.iloc[-1] > ma200 and ma200 > ma200_prev else 0 if c.iloc[-1] > ma200 else -1)
    else:
        add('trend', 'SPY vs 200-day average', None, None)
    vix_df, vix3_df = px.get('^VIX'), px.get('^VIX3M')
    vix = float(vix_df['Close'].iloc[-1]) if vix_df is not None else (float(fred['VIXCLS'].iloc[-1]) if 'VIXCLS' in fred else None)
    vix3 = float(vix3_df['Close'].iloc[-1]) if vix3_df is not None else None
    if vix is not None and vix3 is not None:
        add('vol', 'VIX / VIX3M', [_f(vix, 2), _f(vix3, 2)], 1 if vix < 18 and vix3 > vix else 0 if 18 <= vix <= 25 and vix3 > vix else -1)
    else:
        add('vol', 'VIX / VIX3M', None, None)
    hy = fred.get('BAMLH0A0HYM2')
    if hy is not None and len(hy) > 30:
        last, avg6 = float(hy.iloc[-1]), float(hy[hy.index >= hy.index[-1] - pd.Timedelta(days=182)].mean())
        month = float(hy[hy.index <= hy.index[-1] - pd.Timedelta(days=30)].iloc[-1])
        add('credit', 'High-yield credit spread', [_f(last, 2), _f(avg6, 2), _f(last - month, 2)], 1 if last < avg6 else -1 if last - month > 0.5 else 0)
    else:
        add('credit', 'High-yield credit spread', None, None)
    breadth = None
    if hist and hist.get('series'):
        above = n = 0
        for vals in hist['series'].values():
            v = [x for x in vals if _num(x)]
            if len(v) >= 200:
                n += 1
                above += v[-1] > sum(v[-200:]) / 200
        breadth = above / n if n >= 50 else None
    add('breadth', 'S&P 500 stocks above their 200-day average', _f(breadth), None if breadth is None else 1 if breadth > 0.6 else -1 if breadth < 0.4 else 0)
    if cot:
        nets = [float(r['lev_money_positions_long']) - float(r['lev_money_positions_short']) for r in cot[:156]]
        pct = percentile_of(nets[0], nets)
        add('cot', 'Leveraged funds, S&P 500 futures (3-year percentile)', [_f(nets[0], 0), _f(pct, 1), cot[0]['report_date_as_yyyy_mm_dd'][:10]],
            1 if pct < 20 else -1 if pct > 90 else 0)
        out['cot'] = {'net': _f(nets[0], 0), 'percentile': _f(pct, 1), 'date': cot[0]['report_date_as_yyyy_mm_dd'][:10]}
    else:
        add('cot', 'Leveraged funds, S&P 500 futures (3-year percentile)', None, None)
    label = 'Unknown' if known < 3 else 'Risk-on' if total >= 2 else 'Risk-off' if total <= -2 else 'Neutral'
    out['regime'].update({'score': total, 'known': known, 'label': label, 'risk': {'Risk-on': 0.01, 'Neutral': 0.005}.get(label, 0.0)})

    # sector ranking: average of 3- and 6-month returns minus SPY's
    ret = lambda df, n: float(df['Close'].iloc[-1] / df['Close'].iloc[-1 - n] - 1) if df is not None and len(df) > n else None
    s3, s6 = ret(spy, 63), ret(spy, 126)
    rows = []
    for sector, etf in SECTOR_ETF.items():
        r3, r6 = ret(px.get(etf), 63), ret(px.get(etf), 126)
        if None not in (r3, r6, s3, s6):
            rows.append({'sector': sector, 'etf': etf, 'r3m': _f(r3), 'r6m': _f(r6), 'rel': _f(((r3 - s3) + (r6 - s6)) / 2)})
    rows.sort(key=lambda r: -r['rel'])
    for i, r in enumerate(rows):
        r['rank'] = i + 1
        r['score'] = 2 if i == 0 else 1 if i <= 2 else 0 if i <= 5 else -1 if i <= 8 else -2
    out['sectors'] = rows

    # macro and the business-cycle phase
    lastv = lambda k: float(fred[k].iloc[-1]) if k in fred and len(fred[k]) else None
    ago = lambda k, days: float(fred[k][fred[k].index <= fred[k].index[-1] - pd.Timedelta(days=days)].iloc[-1]) if k in fred and len(fred[k]) > 5 else None
    claims, claims6 = lastv('ICSA'), (float(fred['ICSA'].iloc[-26:].mean()) if 'ICSA' in fred else None)
    curve, hy_last = lastv('T10Y2Y'), lastv('BAMLH0A0HYM2')
    hy_chg = hy_last - ago('BAMLH0A0HYM2', 91) if hy_last is not None and ago('BAMLH0A0HYM2', 91) is not None else None
    claims_up = claims / claims6 - 1 if claims and claims6 else None
    phase = None
    if None not in (curve, claims_up, hy_last, hy_chg):
        if claims_up > 0.15 or hy_last > 5:
            phase = 'Recession'
        elif curve > 1.0 and claims_up < 0 and hy_chg < 0:
            phase = 'Early'
        elif curve < 0.5 and (hy_chg > 0.25 or claims_up > 0.05):
            phase = 'Late'
        else:
            phase = 'Mid'
    out['macro'] = {'curve': _f(curve, 2), 'claims': _f(claims, 0), 'claims6m': _f(claims6, 0), 'claimsChange': _f(claims_up), 'hy': _f(hy_last, 2),
                    'hyChange3m': _f(hy_chg, 2), 'tenYear': _f(lastv('DGS10'), 2), 'tenYear3m': _f(ago('DGS10', 91), 2), 'tbill': _f(lastv('DTB3'), 2),
                    'dollar': _f(lastv('DTWEXBGS'), 2), 'dollar3m': _f(ago('DTWEXBGS', 91), 2), 'phase': phase, 'favored': CYCLE_SECTORS.get(phase, [])}
    # dual momentum (12-month total return from adjusted prices)
    tb = (lastv('DTB3') or 0) / 100
    r12 = {k: ret(px.get(k), 252) for k in ('SPY', 'VEU', 'AGG')}
    if None not in r12.values():
        pick = ('SPY' if r12['SPY'] >= r12['VEU'] else 'VEU') if r12['SPY'] > tb else 'AGG'
        out['dualMomentum'] = {'spy': _f(r12['SPY']), 'veu': _f(r12['VEU']), 'agg': _f(r12['AGG']), 'tbill': _f(tb), 'hold': pick}
    # 10-month trend on SPY: last completed month close vs the average of the 10 completed months before it
    if spy is not None and len(spy) > 230:
        me = spy['Close'].resample('ME').last()
        completed = me[me.index < pd.Timestamp(today.replace(day=1))]
        if len(completed) >= 10:
            out['faberSpy'] = {'close': _f(completed.iloc[-1], 2), 'avg10': _f(completed.iloc[-10:].mean(), 2), 'in': bool(completed.iloc[-1] > completed.iloc[-10:].mean()),
                               'live': _f(spy['Close'].iloc[-1], 2)}
    # VIX spike rule: VIX above 30 with backwardation in the last 20 days, and now back in contango
    if vix_df is not None and vix3_df is not None:
        j = pd.concat([vix_df['Close'], vix3_df['Close']], axis=1, keys=['v', 'v3']).dropna().iloc[-20:]
        panic = bool(((j.v > 30) & (j.v > j.v3)).any())
        out['vix'] = {'vix': _f(vix, 2), 'vix3m': _f(vix3, 2), 'panicRecently': panic, 'buy': bool(panic and vix3 >= vix * 1.01)}   # 1% buffer against flip-flopping
    # cross-asset: copper/gold ratio and the dollar, 3-month change
    cu, au = px.get('HG=F'), px.get('GC=F')
    cg = None
    if cu is not None and au is not None:
        ratio = (cu['Close'] / au['Close']).dropna()
        cg = float(ratio.iloc[-1] / ratio.iloc[-64] - 1) if len(ratio) > 64 else None
    usd = lastv('DTWEXBGS'), ago('DTWEXBGS', 91)
    usd_chg = usd[0] / usd[1] - 1 if None not in usd else None
    tone = None
    if cg is not None and usd_chg is not None:
        tone = 'Risk-on' if cg > 0 and usd_chg < 0 else 'Risk-off' if cg < 0 and usd_chg > 0 else 'Mixed'
    out['crossAsset'] = {'copperGold3m': _f(cg), 'dollar3m': _f(usd_chg), 'tone': tone}
    m, d = today.month, today.day
    out['seasonality'] = {'strongHalf': m in (11, 12, 1, 2, 3, 4), 'turnOfMonth': d >= 24 or d <= 3}
    spy_vol = float(np.log(spy['Close']).diff().iloc[-60:].std() * math.sqrt(252)) if spy is not None and len(spy) > 61 else None
    out['spyVol'] = _f(spy_vol)
    return out


# ================================================================ per-stock price features
def price_features(df):
    c, h, l, v = df['Close'], df['High'], df['Low'], df['Volume']
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / 14, adjust=False).mean()

    def rsi(n):
        d = c.diff()
        up, dn = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean(), (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
        return 100 - 100 / (1 + up / dn.replace(0, np.nan))
    year = df.iloc[-252:]
    ret = lambda n: float(c.iloc[-1] / c.iloc[-1 - n] - 1) if len(c) > n else None
    me = c.resample('ME').last()
    completed = me[me.index < pd.Timestamp(date.today().replace(day=1))]
    feat = {'close': float(c.iloc[-1]), 'date': c.index[-1].strftime('%Y-%m-%d'), 'ma5': float(c.iloc[-5:].mean()),
            'ma50': float(c.rolling(50).mean().iloc[-1]) if len(c) >= 50 else None,
            'ma200': float(c.rolling(200).mean().iloc[-1]) if len(c) >= 200 else None,
            'atr': float(atr.iloc[-1]), 'rsi14': float(rsi(14).iloc[-1]), 'rsi2': float(rsi(2).iloc[-1]),
            'high52': float(year['High'].max()), 'low52': float(year['Low'].min()),
            'r1m': ret(21), 'r3m': ret(63), 'r6m': ret(126), 'r12m': ret(252),
            'r12_1': float(c.iloc[-22] / c.iloc[-252] - 1) if len(c) > 252 else None,
            'vol60': float(np.log(c).diff().iloc[-60:].std() * math.sqrt(252)), 'hv30': float(np.log(c).diff().iloc[-30:].std() * math.sqrt(252)),
            'avgVol50': float(v.iloc[-51:-1].mean()), 'lastVol': float(v.iloc[-1]), 'range4w': float(h.iloc[-21:-1].max()),
            'monthClose': float(completed.iloc[-1]) if len(completed) >= 11 else None,
            'avg10m': float(completed.iloc[-10:].mean()) if len(completed) >= 11 else None, 'days': len(c), 'first': float(c.iloc[0])}
    feat['ma50_20'] = float(c.rolling(50).mean().iloc[-21]) if len(c) >= 71 else None
    return feat


def earnings_reaction(df, earnings, today=None, release=None):
    """The last reported quarter (within ~3 months): EPS surprise, opening gap, volume and whether the gap held 3 days.
    `release` (SEC 8-K item 2.02 acceptance time, New York) dates the report more reliably than Yahoo's calendar."""
    today = today or date.today()
    past = [e for e in earnings or [] if e.get('reported') is not None and pd.Timestamp(e['at']).date() <= today]
    future = sorted(pd.Timestamp(e['at']).date() for e in earnings or [] if pd.Timestamp(e['at']).date() > today)
    out = {'next': future[0].isoformat() if future else None}
    if not past and not release:
        return out
    last = max(past, key=lambda e: e['at']) if past else {}
    ts = pd.Timestamp(release) if release else pd.Timestamp(last['at'])
    if release and last and abs((pd.Timestamp(last['at']).date() - ts.date()).days) > 10:
        last = {}          # Yahoo's last row is another quarter: keep the SEC date, drop the unmatched surprise
    out['dateSource'] = 'SEC 8-K' if release else 'Yahoo'
    day = ts.tz_localize(None).normalize() if ts.tzinfo else ts.normalize()
    idx = df.index.searchsorted(day if (ts.hour, ts.minute) < (9, 30) or (not release and ts.hour < 12) else day + pd.Timedelta(days=1))
    if idx <= 0 or idx >= len(df) or (today - day.date()).days > 100:
        out.update({'date': day.date().isoformat(), 'surprise': last.get('surprise'), 'recent': False})
        return out
    react, prev = df.iloc[idx], df.iloc[idx - 1]
    after = df.iloc[idx + 1: idx + 4]
    out.update({'date': df.index[idx].strftime('%Y-%m-%d'), 'recent': True, 'surprise': last.get('surprise'), 'estimate': last.get('estimate'), 'reported': last.get('reported'),
                'gap': _f(react['Open'] / prev['Close'] - 1), 'dayMove': _f(react['Close'] / prev['Close'] - 1),
                'volume': _f(react['Volume'] / df['Volume'].iloc[max(0, idx - 51): idx - 1].mean(), 2),
                'held': bool(len(after) == 3 and (after['Close'] >= react['Low']).all()), 'reactionClose': _f(react['Close'], 2)})
    return out


# ================================================================ the methods
def M(mid, verdict, vote, text, **data):
    name, group = next((n, g) for i, n, g in [(x[0], x[1], x[2]) for x in METHODS] if i == mid)
    return {'id': mid, 'name': name, 'group': group, 'verdict': verdict, 'vote': vote, 'text': text, 'data': data or None}


def pct(x, digits=1):
    return '—' if x is None else f'{x * 100:+.{digits}f}%'


def usd(x, digits=2):
    return '—' if x is None else f'${x:,.{digits}f}'


def evaluate(symbol, sector, df, F, extras, insiders, tenk, ctx, peer=None, mentions=None, universe_mom=None, today=None):
    """Every method, the funnel and the conclusion for one stock. Returns the published per-stock dict."""
    today = today or date.today()
    p = price_features(df)
    q = quality_checks(F)
    pio = piotroski(F)
    rf = red_flags(F, sector)
    er = earnings_reaction(df, (extras or {}).get('earnings'), today, (extras or {}).get('release'))
    short = (extras or {}).get('short') or {}
    opt = (extras or {}).get('options') or {}
    ins = summarize_insiders(insiders, today) if insiders is not None else None
    methods = []
    tb = (ctx.get('macro') or {}).get('tbill')
    tb = tb / 100 if tb is not None else None
    dm = ctx.get('dualMomentum')
    # 1 dual momentum
    if dm and p['r12m'] is not None and tb is not None:
        good = p['r12m'] > tb and dm['hold'] != 'AGG'
        methods.append(M(1, 'PASS' if not good else 'IN', 1 if good else -1,
                         f"12-month return {pct(p['r12m'])} vs T-bills {pct(tb)}; market rule holds {dm['hold']} (SPY {pct(dm['spy'])}, VEU {pct(dm['veu'])}).", r12m=_f(p['r12m'])))
    else:
        methods.append(M(1, 'NO DATA', None, 'Twelve months of prices or the T-bill rate are missing.'))
    # 2 earnings drift
    if er.get('recent'):
        surprise = er.get('surprise')
        beat = None if surprise is None else surprise > 0
        rest = [(er.get('gap') or 0) >= 0.04, (er.get('volume') or 0) >= 2, bool(er.get('held')), p['close'] >= (er.get('reactionClose') or 1e18)]
        text = (f"Report {er['date']} ({er.get('dateSource')}): EPS surprise {pct(surprise / 100) if surprise is not None else 'not available'}, gap {pct(er.get('gap'))}, "
                f"volume {er.get('volume')}× average, gap {'held' if er.get('held') else 'did not hold'} 3 days; price now {'above' if rest[3] else 'below'} the reaction-day close "
                f"{usd(er.get('reactionClose'))}. Revenue and guidance are not in the free data.")
        if beat and all(rest):
            verdict, vote = 'BUY', 1
        elif beat is not False and rest[3] and (beat or all(rest[:3])):
            verdict, vote = 'WATCH', 0
        else:
            verdict, vote = 'PASS', -1 if not rest[3] else 0
        methods.append(M(2, verdict, vote, text, **er))
    else:
        methods.append(M(2, 'NO SIGNAL', None, f"No report in the last three months{(' (last: ' + er['date'] + ')') if er.get('date') else ''}.", next=er.get('next')))
    # 3 insider cluster
    down20 = p['close'] <= 0.8 * p['high52']
    if ins is None:
        methods.append(M(3, 'NO DATA', None, 'Form 4 filings were not retrieved (SEC contact e-mail missing or SEC unavailable).'))
    else:
        cluster = ins['buyers14'] >= 3 and (ins['value14'] or 0) >= 100000 and down20
        text = (f"Last 120 days: {ins['buys']} open-market buys ({usd(ins['buyValue'], 0)}), {ins['sells']} sells ({usd(ins['sellValue'], 0)}); "
                f"{ins['buyers14']} buyer(s) in 14 days, {ins['buyers30']} in 30 days" + (f"; sold > 20% of holding: {', '.join(ins['bigSellers'])}" if ins['bigSellers'] else '') + '.')
        vote = 1 if cluster else 0 if ins['buys'] else -1 if ins['sells'] else 0
        methods.append(M(3, 'BUY' if cluster else 'WATCH' if ins['buyers30'] else 'PASS', vote, text, **ins))
    # 4 52-week low recovery
    near = p['close'] <= p['low52'] * 1.15
    qual_ok = q is not None and q['score'] is not None and q['score'] >= 1
    above50 = p['ma50'] is not None and p['close'] > p['ma50']
    if near:
        verdict = 'BUY' if qual_ok and above50 else 'WATCH' if qual_ok else 'PASS'
        methods.append(M(4, verdict, 1 if verdict == 'BUY' else 0 if verdict == 'WATCH' else -1,
                         f"{pct(p['close'] / p['low52'] - 1)} above the 52-week low {usd(p['low52'])}; quality {'passes' if qual_ok else 'fails (value-trap risk)'}; "
                         f"close {'above' if above50 else 'below'} the 50-day average {usd(p['ma50'])}.", trigger=_f(p['ma50'], 2)))
    else:
        methods.append(M(4, 'N/A', None, f"Not near the low: {pct(p['close'] / p['low52'] - 1)} above the 52-week low (rule: within 15%)."))
    # 5 short squeeze
    si, dtc = short.get('shortPercentOfFloat'), short.get('shortRatio')
    breakout = p['close'] > p['range4w'] and p['lastVol'] >= 2 * p['avgVol50']
    if si is None:
        methods.append(M(5, 'NO DATA', None, 'Short interest is unavailable.'))
    elif si > 0.20 and (dtc or 0) > 5:
        methods.append(M(5, 'BUY' if breakout else 'WATCH', 1 if breakout else 0, f"Short interest {si * 100:.1f}% of float, {dtc} days to cover; {'breakout on 2× volume' if breakout else 'no breakout yet'}.", si=si, dtc=dtc))
    else:
        methods.append(M(5, 'N/A', None, f"Short interest {si * 100:.1f}% of float, {dtc or '—'} days to cover (rule: > 20% and > 5 days).", si=si, dtc=dtc))
    # 6 business cycle
    phase, favored = (ctx.get('macro') or {}).get('phase'), (ctx.get('macro') or {}).get('favored') or []
    if phase:
        methods.append(M(6, 'FAVORED' if sector in favored else 'NEUTRAL', 1 if sector in favored else 0,
                         f"{phase} cycle (curve {ctx['macro']['curve']}, claims {pct(ctx['macro']['claimsChange'])} vs 6-month average, HY spread {ctx['macro']['hyChange3m']:+} pts in 3 months); favored: {', '.join(favored)}."))
    else:
        methods.append(M(6, 'NO DATA', None, 'FRED macro series are unavailable.'))
    # 7 put selling (IV vs 30-day historical volatility as the free substitute for IV rank)
    iv = opt.get('atmIv')
    if iv:
        rich = iv / p['hv30'] >= 1.2 if p['hv30'] else False
        up = above50 and (p['ma200'] is None or p['close'] > p['ma200'])
        methods.append(M(7, 'SELL PUTS' if rich and up and qual_ok else 'PASS', 0,
                         f"ATM IV {iv * 100:.0f}% vs 30-day realized {p['hv30'] * 100:.0f}% (ratio {iv / p['hv30']:.2f}; IV rank is not free, rule uses ≥ 1.2); "
                         f"trend {'up' if up else 'down'}; put/call OI {opt.get('putCallOi') or '—'}. Idea: 30–45 day put near 0.20 delta, take profit at 50%.", **opt))
    else:
        methods.append(M(7, 'NO DATA', None, 'Option chain unavailable.'))
    # 8 COT
    cot = ctx.get('cot')
    methods.append(M(8, 'N/A', None, (f"Futures-level only (no contract for single stocks). S&P 500 leveraged funds net {cot['net']:,.0f} contracts, "
                                      f"{cot['percentile']:.0f}th percentile of 3 years ({cot['date']}); used in the regime.") if cot else 'CFTC data unavailable.'))
    # 9 Piotroski
    if pio:
        cheap = pio['pb'] is not None and pio['pb'] <= 2
        methods.append(M(9, 'BUY' if pio['score'] >= 8 and cheap else 'POSITIVE' if pio['score'] >= 7 else 'AVOID' if pio['score'] <= 2 else 'NEUTRAL',
                         1 if pio['score'] >= 7 else -1 if pio['score'] <= 2 else 0,
                         f"F-score {pio['score']}/9; price/book {pio['pb'] or '—'} ({'cheap' if cheap else 'not cheap'}, rule: ≤ 2). Failed: " +
                         (', '.join(t['label'] for t in pio['tests'] if not t['ok']) or 'none') + '.', score=pio['score'], pb=pio['pb']))
    else:
        methods.append(M(9, 'NO DATA', None, 'SEC statements are missing.'))
    # 10 red flags
    if rf['altman'] is None and rf['beneish'] is None:
        methods.append(M(10, 'N/A' if sector in NO_ALTMAN and F else 'NO DATA', None, 'Altman Z does not apply to financials/REITs.' if sector in NO_ALTMAN and F else 'SEC statements are missing.'))
    else:
        manip = rf['beneish'] is not None and rf['beneish'] > -1.78
        distress = rf['altman'] is not None and rf['altman'] < 1.8
        verdict = 'AVOID' if manip else 'FLAG' if distress else 'CLEAN'
        methods.append(M(10, verdict, -1 if manip or distress else 0,
                         f"Altman Z {rf['altman'] if rf['altman'] is not None else 'n/a'} (distress < 1.8), Z'' {rf['altmanZ2'] if rf['altmanZ2'] is not None else 'n/a'}; "
                         f"Beneish M {rf['beneish'] if rf['beneish'] is not None else 'n/a'} (manipulation risk > −1.78)" +
                         ('; Altman often misfires on capital-heavy companies.' if distress and not manip else '.'), **rf))
    # 11 RSI(2)
    if p['ma200'] is None:
        methods.append(M(11, 'NO DATA', None, 'Less than 200 days of prices.'))
    elif p['close'] > p['ma200']:
        methods.append(M(11, 'BUY' if p['rsi2'] < 10 else 'WAIT', 1 if p['rsi2'] < 10 else 0, f"Above the 200-day average; RSI(2) {p['rsi2']:.0f} (buy below 10, sell above the 5-day average {usd(p['ma5'])})."))
    else:
        methods.append(M(11, 'PASS', -1, f"Below the 200-day average {usd(p['ma200'])}; RSI(2) {p['rsi2']:.0f}. The rule only buys pullbacks in uptrends."))
    # 12 12-1 momentum
    mom = p['r12_1']
    rank = percentile_of(mom, universe_mom) if universe_mom and mom is not None else None
    if mom is None:
        methods.append(M(12, 'NO DATA', None, 'Less than 13 months of prices.'))
    else:
        methods.append(M(12, 'BUY' if rank is not None and rank >= 90 else 'HOLD' if rank is not None and rank >= 50 else 'PASS',
                         1 if rank is not None and rank >= 90 else 0 if rank is not None and rank >= 50 else -1,
                         f"12-1 month return {pct(mom)}" + (f", percentile {rank:.0f} of the S&P 500 (buy in the top 10%)." if rank is not None else '.'), percentile=_f(rank, 1)))
    # 13 10-month trend
    fs = ctx.get('faberSpy')
    if p['monthClose'] is not None:
        inn = p['monthClose'] > p['avg10m']
        methods.append(M(13, 'IN' if inn else 'OUT', 1 if inn else -1, f"Last month close {usd(p['monthClose'])} vs 10-month average {usd(p['avg10m'])}" +
                         (f"; SPY {'in' if fs['in'] else 'out'} ({usd(fs['close'])} vs {usd(fs['avg10'])})." if fs else '.')))
    else:
        methods.append(M(13, 'NO DATA', None, 'Less than 11 months of prices.'))
    # 14 VIX spike
    vx = ctx.get('vix')
    methods.append(M(14, 'BUY SPY' if vx and vx['buy'] else 'NO SIGNAL', None,
                     f"VIX {vx['vix']} / VIX3M {vx['vix3m']}; panic (VIX > 30 above VIX3M) in the last 20 days: {'yes' if vx['panicRecently'] else 'no'}. Market-level rule." if vx else 'VIX data unavailable.'))
    # 15 reverse DCF
    fcf = (q or {}).get('fcf')
    g = implied_growth((F or {}).get('mcap'), fcf)
    hist_g = cagr((F or {}).get('fcf_hist') or [])
    if g is None:
        methods.append(M(15, 'N/A' if F else 'NO DATA', None, 'Free cash flow is not positive, so the price cannot be read as a growth rate.' if F else 'SEC statements are missing.'))
    else:
        if hist_g is None:
            verdict, vote = 'NEUTRAL', 0
        else:
            verdict, vote = ('UNDERVALUED', 1) if g < hist_g - 0.03 else ('OVERPRICED', -1) if g > hist_g + 0.03 else ('FAIR', 0)
        methods.append(M(15, verdict, vote, f"Market cap {usd((F['mcap'] or 0) / 1e9, 1)}B on 12-month FCF {usd(fcf / 1e9, 2)}B implies {pct(g)} growth a year forever at a {COST_OF_EQUITY:.0%} cost of equity; "
                         f"FCF history CAGR {pct(hist_g) if hist_g is not None else 'not meaningful'}. Reported FCF includes growth capex.", implied=_f(g), history=_f(hist_g)))
    # 16 spin-off
    spin = (extras or {}).get('spinoff')
    if spin and p['days'] < 480:
        drop = p['close'] / p['first'] - 1
        methods.append(M(16, 'BUY' if drop <= -0.15 and qual_ok else 'WATCH', 1 if drop <= -0.15 and qual_ok else 0, f"Spin-off (Form 10 filed {spin}); {pct(drop)} since its first trading day in the data."))
    else:
        methods.append(M(16, 'N/A', None, 'Not a recent spin-off.'))
    # 17 pairs
    if peer:
        z = peer['z']
        methods.append(M(17, 'LONG VS PEER' if z <= -2 else 'SHORT VS PEER' if z >= 2 else 'NO SIGNAL', 0,
                         f"Price ratio vs {peer['symbol']} (correlation {peer['corr']:.2f}) is {z:+.2f} standard deviations from its 60-day average (trade beyond ±2).", **peer))
    else:
        methods.append(M(17, 'NO DATA', None, 'No same-sector peer history.'))
    # 18 seasonality
    se = ctx.get('seasonality') or {}
    methods.append(M(18, 'MILD +' if se.get('strongHalf') else 'NEUTRAL', 0, ('November–April window' if se.get('strongHalf') else 'May–October window') +
                     ('; turn of the month.' if se.get('turnOfMonth') else '.') + ' Timing filter only, never a reason on its own.'))
    # 19 10-K wording
    if tenk and tenk.get('newShare') is not None:
        share = tenk['newShare']
        methods.append(M(19, 'CAUTION' if share > 0.40 else 'STABLE', -1 if share > 0.40 else 0,
                         f"{share * 100:.0f}% of the {tenk['sentences']} risk-factor sentences in the 10-K of {tenk['filed']} are new versus {tenk['previousFiled']} (caution above 40%).", **tenk))
    else:
        methods.append(M(19, 'NO DATA', None, 'Two 10-K filings were not compared (needs the SEC contact e-mail; up to 12 new companies a day; very frequent filers keep older 10-Ks outside the recent list).'))
    # 20 Google Trends
    methods.append(M(20, 'N/A', None, 'Google offers no free server API; check trends.google.com by hand for consumer brands.'))
    # 21 retail crowding
    if mentions is None:
        methods.append(M(21, 'NO DATA', None, 'Reddit mention counts unavailable.'))
    elif not mentions:
        methods.append(M(21, 'QUIET', 0, 'Not among the most-mentioned stocks on Reddit.'))
    else:
        spike = (mentions.get('mentions') or 0) >= 5 * max(1, mentions.get('mentions_24h_ago') or 0) and (p['r1m'] or 0) > 0.5
        methods.append(M(21, 'WARNING' if spike else 'NORMAL', -1 if spike else 0, f"Reddit mentions {mentions.get('mentions')} (24 h earlier {mentions.get('mentions_24h_ago')}), rank {mentions.get('rank')}; 1-month price {pct(p['r1m'])}."))
    # 22 buybacks
    sh, bb = (q or {}).get('shareChange'), (F or {}).get('buyback_ttm')
    if sh is None:
        methods.append(M(22, 'NO DATA', None, 'Share counts are missing.'))
    else:
        verdict, vote = ('POSITIVE', 1) if sh <= -0.02 and (bb or 0) > 0 else ('DILUTION', -1) if sh > 0.02 else ('IGNORE' if (bb or 0) > 0 else 'NEUTRAL', 0)
        methods.append(M(22, verdict, vote, f"Diluted shares {pct(sh)} year over year; buybacks last 12 months {usd((bb or 0) / 1e9, 2)}B.", shareChange=sh, buyback=_f(bb, 0)))
    # 23 cross-asset
    ca = ctx.get('crossAsset') or {}
    if ca.get('tone') in ('Risk-on', 'Risk-off'):
        fav = (sector in CYCLICAL) if ca['tone'] == 'Risk-on' else (sector in DEFENSIVE)
        unfav = (sector in DEFENSIVE) if ca['tone'] == 'Risk-on' else (sector in CYCLICAL)
        methods.append(M(23, 'FAVORED' if fav else 'UNFAVORED' if unfav else 'NEUTRAL', 1 if fav else -1 if unfav else 0,
                         f"{ca['tone']}: copper/gold {pct(ca['copperGold3m'])}, dollar {pct(ca['dollar3m'])} in 3 months."))
    else:
        methods.append(M(23, 'NEUTRAL' if ca.get('tone') else 'NO DATA', 0 if ca.get('tone') else None,
                         f"Mixed: copper/gold {pct(ca.get('copperGold3m'))}, dollar {pct(ca.get('dollar3m'))} in 3 months." if ca.get('tone') else 'Copper, gold or dollar data unavailable.'))
    # 24 BVB
    methods.append(M(24, 'N/A', None, 'Only for stocks listed on the Bucharest Stock Exchange.'))
    # 25 volatility targeting
    spy_vol = ctx.get('spyVol')
    methods.append(M(25, 'SIZING', None, f"60-day volatility {p['vol60'] * 100:.0f}% vs SPY {spy_vol * 100:.0f}%: for equal risk, size this at {min(1.0, spy_vol / p['vol60']):.2f}× an index position." if spy_vol else
                     f"60-day volatility {p['vol60'] * 100:.0f}%.", weight=_f(min(1.0, spy_vol / p['vol60'])) if spy_vol else None))
    # 26 drawdown
    methods.append(M(26, 'INFO', None, f"{pct(p['close'] / p['high52'] - 1)} from the 52-week high. Portfolio rule: −10% from peak → halve sizes, −15% → stop new trades."))
    # 27 ML ranking
    methods.append(M(27, 'N/A', None, 'Not built yet: needs a walk-forward-tested model on several years of these features.'))

    funnel = funnel_score(p, q, ins, short, opt, sector, ctx)
    conclusion = conclude(p, q, funnel, methods, er, ctx, rf)
    return {'symbol': symbol, 'sector': sector, 'price': _f(p['close'], 2), 'date': p['date'], 'features': {k: _f(v, 4) for k, v in p.items() if k not in ('date',)},
            'funnel': funnel, 'quality': q, 'methods': methods, 'conclusion': conclusion}


def funnel_score(p, q, ins, short, opt, sector, ctx):
    t = [p['ma50'] is not None and p['close'] > p['ma50'], p['ma50'] is not None and p['ma200'] is not None and p['ma50'] > p['ma200'], False, False, 45 <= p['rsi14'] <= 72]
    setup_breakout = p['close'] > p['range4w']
    setup_pullback = p['ma50'] is not None and p['close'] > p['ma50'] and p['close'] <= p['ma50'] * 1.03 and p['ma50_20'] is not None and p['ma50'] > p['ma50_20']
    t[2] = setup_breakout or setup_pullback
    t[3] = t[2] and p['lastVol'] >= 1.5 * p['avgVol50']
    timing = {5: 2, 4: 1, 3: 0, 2: -1}.get(sum(t), -2)
    pos, notes = 0.0, []
    if ins is not None:
        if ins['buyers30'] >= 2:
            pos += 2; notes.append('2+ insiders bought in 30 days')
        elif ins['buyers30'] == 1:
            pos += 1; notes.append('1 insider bought in 30 days')
        if ins['bigSellers']:
            pos -= 1; notes.append('insider sold > 20% of holding')
    si = short.get('shortPercentOfFloat')
    if si is not None and si > 0.15:
        pos += 1 if t[0] else -1
        notes.append('short interest > 15% ' + ('with price above 50-day' if t[0] else 'with price below 50-day'))
    prior, now_ = short.get('sharesShortPriorMonth'), short.get('sharesShort')
    if prior and now_ and now_ > 1.2 * prior and (p['r1m'] or 0) < 0:
        pos -= 1; notes.append('short interest up > 20% while price fell')
    pc = opt.get('putCallOi')
    if pc is not None:
        if pc < 0.7:
            pos += 0.5; notes.append('put/call OI < 0.7')
        elif pc > 1.3:
            pos -= 0.5; notes.append('put/call OI > 1.3')
    pos = max(-2.0, min(2.0, pos))
    sec_row = next((r for r in ctx.get('sectors') or [] if r['sector'] == sector), None)
    sector_score = sec_row['score'] if sec_row else 0
    quality = q['score'] if q and q['score'] is not None else 0
    final = 0.30 * quality + 0.25 * pos + 0.25 * timing + 0.20 * sector_score
    return {'quality': quality, 'qualityKnown': bool(q and q['score'] is not None), 'positioning': pos, 'positioningNotes': notes, 'timing': timing,
            'timingChecks': [bool(x) for x in t], 'sector': sector_score, 'sectorRank': sec_row['rank'] if sec_row else None,
            'final': round(final, 2), 'raw': 'BUY' if final >= 1.2 else 'WATCH' if final >= 0.5 else 'PASS'}


def conclude(p, q, funnel, methods, er, ctx, rf):
    """Decision with the overrides of the funnel prompt, plus reasons, triggers, invalidation and sizing."""
    regime = ctx['regime']['label']
    decision, why = funnel['raw'], []
    good_fund_bad_timing = funnel['quality'] >= 1 and funnel['timing'] <= -1
    if good_fund_bad_timing and decision != 'WATCH':
        decision = 'WATCH'; why.append('Good fundamentals with bad timing is always WATCH, never BUY.')
    if not funnel['qualityKnown'] and decision == 'BUY':
        decision = 'WATCH'; why.append('Fundamentals could not be checked.')
    if regime == 'Risk-off' and decision == 'BUY':
        decision = 'WATCH'; why.append('Risk-off regime: no new long positions.')
    m10 = next(m for m in methods if m['id'] == 10)
    if m10['verdict'] == 'AVOID':
        decision = 'AVOID'; why.append('Beneish M-score signals possible earnings manipulation.')
    elif m10['verdict'] == 'FLAG' and decision == 'BUY':
        decision = 'WATCH'; why.append('Altman Z is in the distress zone.')
    nxt = er.get('next')
    if nxt and decision == 'BUY' and (date.fromisoformat(nxt) - date.today()).days <= 14:
        decision = 'WATCH'; why.append('Earnings within 10 trading days.')
    pros = [m['id'] for m in methods if m['vote'] == 1]          # method ids; the page shows their names and texts
    cons = [m['id'] for m in methods if m['vote'] == -1]
    triggers = []
    if regime in ('Risk-off', 'Unknown'):
        triggers.append('Market regime back to at least Neutral (SPY above its 200-day average, VIX below 25 with VIX3M above it, credit spreads no longer widening).')
    if p['ma50'] is not None and p['close'] <= p['ma50']:
        triggers.append(f"Close above the 50-day average (≈ {usd(p['ma50'])}), ideally on 1.5× average volume.")
    if p['ma50'] is not None and p['ma200'] is not None and p['ma50'] <= p['ma200']:
        triggers.append(f"50-day average back above the 200-day ({usd(p['ma50'])} vs {usd(p['ma200'])}).")
    if funnel['quality'] < 1:
        triggers.append('Fundamentals improving (at least 4 of the 5 quality checks).')
    stop = p['close'] - 2 * p['atr']
    invalid = (f"Close below the 52-week low {usd(p['low52'])}." if p['close'] <= p['low52'] * 1.25 else f"Close below {usd(stop)} (entry − 2 × ATR).")
    risk = ctx['regime'].get('risk', 0)
    if decision == 'BUY' and regime == 'Neutral':
        why.append('Neutral regime: half the usual risk per trade.')
    summary = {'BUY': 'Passes the funnel: business, positioning, timing and sector line up.',
               'WATCH': 'Not yet: wait for the triggers below before buying.',
               'PASS': 'Does not pass the funnel today.', 'AVOID': 'Excluded by the red-flag filter.'}[decision]
    if good_fund_bad_timing:
        summary = 'Good business, bad timing: fundamentals decide what to buy, price and regime decide when.'
    return {'decision': decision, 'summary': summary, 'overrides': why, 'pros': pros, 'cons': cons, 'up': len(pros), 'down': len(cons),
            'triggers': triggers if decision != 'BUY' else [], 'invalidation': invalid, 'stop': _f(stop, 2), 'riskPerShare': _f(2 * p['atr'], 2),
            'riskPercent': risk if decision == 'BUY' else 0, 'nextEarnings': nxt, 'regime': regime}


# ================================================================ pairs and universe helpers
def pair_for(symbol, sector, hist, sectors_by_symbol):
    if not hist or symbol not in (hist.get('series') or {}):
        return None
    dates = pd.to_datetime(hist['dates'])
    s = pd.Series(hist['series'][symbol], index=dates, dtype=float)
    best = None
    for other, vals in hist['series'].items():
        if other == symbol or sectors_by_symbol.get(other) != sector:
            continue
        o = pd.Series(vals, index=dates, dtype=float)
        j = pd.concat([s, o], axis=1, keys=['a', 'b']).dropna()
        if len(j) < 120:
            continue
        corr = j.pct_change().dropna().corr().iloc[0, 1]
        if math.isfinite(corr) and (best is None or corr > best[1]):
            best = (other, corr, j)
    if not best:
        return None
    other, corr, j = best
    ratio = (j['a'] / j['b']).iloc[-60:]
    z = (ratio.iloc[-1] - ratio.mean()) / ratio.std() if ratio.std() > 0 else 0.0
    return {'symbol': other, 'corr': _f(corr, 3), 'ratio': _f(ratio.iloc[-1]), 'z': _f(z, 2)}


def universe_momentum(hist):
    out = []
    for vals in (hist or {}).get('series', {}).values():
        v = [x for x in vals if _num(x)]
        if len(v) >= 240:
            out.append(v[-22] / v[0] - 1)
    return out


def target_symbols(data, top10_days=None, limit=MAX_SYMBOLS):
    """The stocks the Top 10 can show: every preset's Top 10 of the latest saved day, then the filtered list, in that order."""
    out = []
    days = (top10_days or {}).get('days') or []
    if days:
        latest = max(days, key=lambda d: d.get('date') or '')
        for preset in (latest.get('presets') or {}).values():
            out += [r['symbol'] for r in preset.get('items') or []]
    out += [r['symbol'] for r in data.get('items') or []]
    return list(dict.fromkeys(out))[:limit]


# ================================================================ build
def build(data, hist=None, top10_days=None, previous=None, contact_email=None, http=None, download=yf_download, extras_fn=yf_extras, today=None):
    """Compute data/signals.json. `previous` (the published file) supplies cached 10-K comparisons."""
    today = today or date.today()
    http = http or Http(contact_email)
    symbols = target_symbols(data, top10_days)
    sector_of = {r['symbol']: r.get('sector') for r in data.get('allItems') or []}
    sources = {}
    raw = download(list(dict.fromkeys([s.replace('.', '-') for s in symbols] + MARKET_TICKERS)))
    px = {t: frame_of(raw, t) for t in MARKET_TICKERS}
    px = {k: v for k, v in px.items() if v is not None}
    sources['prices'] = {'status': 'ok', 'tickers': len(px)}
    fred = {}
    for sid in FRED_SERIES:
        try:
            fred[sid] = fred_series(http, sid)
        except Exception as exc:
            print('signals FRED', sid, exc)
    sources['fred'] = {'status': 'ok' if len(fred) == len(FRED_SERIES) else 'partial' if fred else 'unavailable', 'series': sorted(fred)}
    try:
        cot = http.json(COT_URL)
        sources['cftc'] = {'status': 'ok'}
    except Exception as exc:
        cot = None
        sources['cftc'] = {'status': 'unavailable', 'error': str(exc)[:120]}
    ctx = market_context(px, fred, cot, hist, today)
    mentions = None
    try:
        mentions = {}
        for page in (1, 2, 3):
            for r in http.json(APEWISDOM_URL.format(page)).get('results') or []:
                mentions[str(r.get('ticker', '')).upper()] = r
        sources['apewisdom'] = {'status': 'ok'}
    except Exception as exc:
        mentions = None if not mentions else mentions
        sources['apewisdom'] = {'status': 'unavailable' if mentions is None else 'partial', 'error': str(exc)[:120]}
    ciks = {}
    if contact_email:
        try:
            for r in http.json(SEC_TICKERS_URL).values():
                ciks[str(r['ticker']).upper()] = int(r['cik_str'])
            sources['sec'] = {'status': 'ok'}
        except Exception as exc:
            sources['sec'] = {'status': 'unavailable', 'error': str(exc)[:120]}
    else:
        sources['sec'] = {'status': 'contact_required'}
    prev_stocks = (previous or {}).get('stocks') or {}
    tenk_budget = [12]
    budget_lock = threading.Lock()
    umom = universe_momentum(hist)
    # Yahoo rate-limits parallel quote/option requests, so these go one stock at a time with one retry
    yahoo = {}
    for symbol in symbols:
        for attempt in range(2):
            try:
                got = extras_fn(symbol) or {}
            except Exception as exc:
                got = {'error': str(exc)[:120]}
            yahoo[symbol] = got
            if not any(k.endswith('Error') for k in got) and 'error' not in got:
                break
            time.sleep(3)
    sources['yahooExtras'] = {'status': 'ok', 'complete': sum(1 for v in yahoo.values() if v.get('short') and v.get('options') is not None and v.get('earnings'))}

    def one(symbol):
        df = frame_of(raw, symbol)
        if df is None or len(df) < 60:
            return symbol, None
        price = float(df['Close'].iloc[-1])
        F = insiders = tenk = None
        extras = {}
        cik = ciks.get(symbol.upper()) or ciks.get(symbol.replace('.', '-').upper())
        if cik:
            try:
                F = fundamentals_from(Facts(http.json(SEC_FACTS_URL.format(cik))), price)
            except Exception as exc:
                print('signals facts', symbol, exc)
            try:
                subs = http.json(SEC_SUBMISSIONS_URL.format(cik))
                insiders = insider_activity(http, cik, subs)
                recent = subs.get('filings', {}).get('recent', {})
                for i, form in enumerate(recent.get('form', [])):
                    if form.startswith('10-12B') and recent['filingDate'][i] >= (today - timedelta(days=730)).isoformat():
                        extras['spinoff'] = recent['filingDate'][i]
                    if form == '8-K' and '2.02' in str((recent.get('items') or [''] * len(recent['form']))[i]) and 'release' not in extras:
                        acc = recent.get('acceptanceDateTime', [None] * len(recent['form']))[i]
                        if acc and acc[:10] >= (today - timedelta(days=100)).isoformat():
                            extras['release'] = pd.Timestamp(acc).tz_convert('America/New_York').tz_localize(None).isoformat()   # UTC → New York
                cached = ((prev_stocks.get(symbol) or {}).get('cache') or {}).get('tenk')
                with budget_lock:
                    allowed = tenk_budget[0] > 0 or bool(cached)
                if allowed:
                    tenk = tenk_similarity(http, cik, subs, cached)
                    if tenk is not cached:
                        with budget_lock:
                            tenk_budget[0] -= 1
            except Exception as exc:
                print('signals filings', symbol, exc)
        extras.update(yahoo.get(symbol) or {})
        sector = sector_of.get(symbol)
        peer = pair_for(symbol, sector, hist, sector_of)
        m = None if mentions is None else (mentions.get(symbol.upper()) or {})
        try:
            result = evaluate(symbol, sector, df, F, extras, insiders, tenk, ctx, peer, m, umom, today)
        except Exception as exc:
            print('signals evaluate', symbol, exc)
            return symbol, None
        result['cache'] = {'tenk': tenk}
        result['sources'] = {'sec': F is not None, 'form4': insiders is not None, 'options': bool(extras.get('options')),
                             'short': bool((extras.get('short') or {}).get('shortPercentOfFloat') is not None), 'earnings': bool(extras.get('earnings'))}
        return symbol, result

    with ThreadPoolExecutor(max_workers=4) as pool:
        stocks = {s: r for s, r in pool.map(one, symbols) if r}
    return {'schema': SCHEMA, 'at': now(), 'symbols': symbols, 'market': ctx, 'sources': sources, 'stocks': stocks,
            'methods': [{'id': i, 'name': n, 'group': g} for i, n, g in METHODS],
            'note': 'Rules are starting points, not backtested here. Research, not investment advice.'}


if __name__ == '__main__':
    import argparse, os
    import dashboard, build_site, top10_history
    ap = argparse.ArgumentParser(description='Compute data/signals.json from the latest report.')
    ap.add_argument('--symbols', help='comma-separated symbols to analyse instead of the Top 10 set')
    ap.add_argument('--out', default='Output/signals.json')
    a = ap.parse_args()
    report, _ = build_site.latest_report()
    payload = dashboard.load_payload(report)
    if a.symbols:
        payload = {**payload, 'items': [{'symbol': s.strip().upper()} for s in a.symbols.split(',')]}
    result = build(payload, build_site.history([r['symbol'] for r in payload['allItems']]) if not a.symbols else None,
                   None if a.symbols else top10_history.load(), contact_email=os.environ.get('SEC_CONTACT_EMAIL'))
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1, allow_nan=False)
    print(a.out, len(result['stocks']), 'stocks', result['market']['regime'])
