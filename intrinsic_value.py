"""Attributable intrinsic-value data for the static dashboard.

Public datasets and SEC Company Facts are fetched only by the build/server process. The
published JSON contains derived values and source dates, never request credentials.
"""
import csv
from datetime import date, datetime, timezone
import io
import json
import math
import re
import time
import urllib.error
import urllib.request

EQUITY_RANK_URL = 'https://api.equity-rank.com/api/datasets/valuations-latest.json'
ZYBERNO_URL = ('https://huggingface.co/datasets/Zyberno/us-equity-valuation-cross-section-with-brina-gap'
               '/resolve/main/brina_gap_cross_section.csv?download=true')
SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
SEC_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK{:010d}.json'
FVC_EMBED_URL = 'https://www.fairvalue-calculator.com/embed/{}.svg'
ASSUMPTIONS = {'dcf_growth': 0.05, 'terminal_growth': 0.025, 'discount_rate': 0.09, 'years': 5,
               'graham_multiplier': 22.5, 'ddm_required_return': 0.09}


class RateLimited(Exception):
    pass


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def _ticker_key(symbol):
    return re.sub(r'[^A-Z0-9]', '', str(symbol or '').upper())


def _request(url, user_agent='Dashivo SP500 Research (https://github.com/afilipv08/dashivo-sp500-research)', timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': user_agent, 'Accept': 'application/json,text/csv,*/*'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise RateLimited() from None
        raise RuntimeError('upstream HTTP error') from None
    except Exception:
        raise RuntimeError('upstream request failed') from None


def parse_equity_rank(payload):
    """Reduce the provider's bulk feed to its dated, per-share estimate."""
    meta = payload.get('meta') or {}
    rows = {}
    for row in payload.get('rows', []):
        symbol = str(row.get('ticker') or '').upper()
        value = _number(row.get('model_fair_value_estimate'))
        if symbol:
            rows[symbol] = {'value': value if value is not None and value > 0 else None,
                            'price': _number(row.get('price_at_last_recompute')),
                            'asOf': row.get('last_recomputed') or meta.get('batch_last_recomputed'),
                            'reason': None if value is not None and value > 0 else 'Provider has no usable blended estimate for this ticker.'}
    return {'status': 'available' if rows else 'empty', 'at': meta.get('batch_last_recomputed') or meta.get('generated_at'),
            'url': EQUITY_RANK_URL, 'rows': rows}


def parse_zyberno_csv(text):
    """Convert company-level intrinsic value into an explicitly approximate per-share figure."""
    reader = csv.DictReader(io.StringIO(text))
    rows = {}
    snapshot = None
    for row in reader:
        symbol = str(row.get('symbol') or '').upper()
        snapshot = snapshot or row.get('snapshot_date')
        intrinsic = _number(_to_float(row.get('intrinsic_value_usd')))
        market_cap = _number(_to_float(row.get('market_cap_usd')))
        price = _number(_to_float(row.get('price_usd')))
        if not symbol:
            continue
        implied_shares = market_cap / price if market_cap and market_cap > 0 and price and price > 0 else None
        per_share = intrinsic / implied_shares if intrinsic and intrinsic > 0 and implied_shares else None
        rows[symbol] = {'value': per_share if per_share and math.isfinite(per_share) and per_share > 0 else None,
                        'companyValue': intrinsic, 'marketCap': market_cap, 'sourcePrice': price,
                        'impliedShares': implied_shares, 'asOf': row.get('record_computed_utc'),
                        'snapshotDate': row.get('snapshot_date'),
                        'reason': None if per_share and math.isfinite(per_share) and per_share > 0 else 'Required company value, market capitalization, or source price is missing.'}
    return {'status': 'available' if rows else 'empty', 'at': snapshot, 'url': ZYBERNO_URL, 'rows': rows}


def _to_float(value):
    try:
        result = float(value) if value not in (None, '') else None
        return result if result is not None and math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _fact_rows(companyfacts, tags, units):
    taxonomies = companyfacts.get('facts') or {}
    for taxonomy in ('us-gaap', 'dei', 'ifrs-full'):
        facts = taxonomies.get(taxonomy) or {}
        for tag in tags:
            item = facts.get(tag) or {}
            for unit in units:
                rows = (item.get('units') or {}).get(unit)
                if rows:
                    return rows
    return []


def _annual_fact(companyfacts, tags, units):
    candidates = []
    allowed_forms = {'10-K', '20-F', '40-F'}
    for row in _fact_rows(companyfacts, tags, units):
        if row.get('form') not in allowed_forms or not row.get('end') or _number(row.get('val')) is None:
            continue
        start = row.get('start')
        if start:
            try:
                days = (date.fromisoformat(row['end']) - date.fromisoformat(start)).days
            except ValueError:
                continue
            if not 300 <= days <= 400:
                continue
        else:
            # Duration facts must have an annual period, not an instant balance-sheet value.
            continue
        candidates.append(row)
    if not candidates:
        return None
    latest_end = max(row['end'] for row in candidates)
    same_period = [row for row in candidates if row['end'] == latest_end]
    result = max(same_period, key=lambda row: row.get('filed', ''))
    return {'value': float(result['val']), 'end': result['end'], 'filed': result.get('filed'), 'fy': result.get('fy')}


def _instant_fact(companyfacts, tags, units):
    candidates = []
    allowed_forms = {'10-K', '10-Q', '20-F', '40-F', '6-K'}
    for row in _fact_rows(companyfacts, tags, units):
        if row.get('form') not in allowed_forms or row.get('start') or not row.get('end') or _number(row.get('val')) is None:
            continue
        candidates.append(row)
    if not candidates:
        return None
    latest_end = max(row['end'] for row in candidates)
    result = max((row for row in candidates if row['end'] == latest_end), key=lambda row: row.get('filed', ''))
    return {'value': float(result['val']), 'end': result['end'], 'filed': result.get('filed')}


def calculate_methods(companyfacts, assumptions=None):
    """Calculate transparent per-share methods from SEC XBRL facts; missing inputs stay unavailable."""
    a = {**ASSUMPTIONS, **(assumptions or {})}
    cfo = _annual_fact(companyfacts, ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'], ['USD'])
    capex = _annual_fact(companyfacts, ['PaymentsToAcquirePropertyPlantAndEquipment'], ['USD'])
    eps = _annual_fact(companyfacts, ['EarningsPerShareDiluted'], ['USD/shares', 'USD / shares'])
    equity = _instant_fact(companyfacts, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], ['USD'])
    shares = _instant_fact(companyfacts, ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'], ['shares'])
    if shares is None:
        shares = _annual_fact(companyfacts, ['WeightedAverageNumberOfDilutedSharesOutstanding'], ['shares'])
    dividend = _annual_fact(companyfacts, ['CommonStockDividendsPerShareDeclared'], ['USD/shares', 'USD / shares'])

    methods = {}
    fcf = cfo['value'] - abs(capex['value']) if cfo and capex else None
    share_count = shares['value'] if shares else None
    g, r, terminal, years = a['dcf_growth'], a['discount_rate'], a['terminal_growth'], int(a['years'])
    reason = None
    if fcf is None or share_count is None:
        reason = 'Missing annual operating cash flow, capital expenditure, or diluted shares.'
    elif fcf <= 0 or share_count <= 0 or r <= terminal:
        reason = 'FCF, share count, or discount-rate assumptions are not valid for DCF.'
    if reason:
        methods['dcf'] = {'value': None, 'reason': reason}
    else:
        annual_per_share = fcf / share_count
        pv = sum(annual_per_share * (1 + g) ** year / (1 + r) ** year for year in range(1, years + 1))
        terminal_value = (annual_per_share * (1 + g) ** years * (1 + terminal) / (r - terminal)) / (1 + r) ** years
        methods['dcf'] = {'value': pv + terminal_value, 'reason': None,
                          'inputs': {'fcf': fcf, 'shares': share_count, 'fcfPerShare': annual_per_share,
                                     'fiscalYear': cfo['end'], 'filed': cfo.get('filed')},
                          'assumptions': {'growth': g, 'discountRate': r, 'terminalGrowth': terminal, 'years': years}}

    book_per_share = equity['value'] / share_count if equity and share_count and share_count > 0 else None
    if not eps or not book_per_share or eps['value'] <= 0 or book_per_share <= 0:
        methods['graham'] = {'value': None, 'reason': 'Positive annual diluted EPS, common equity, or share count is unavailable.'}
    else:
        methods['graham'] = {'value': math.sqrt(a['graham_multiplier'] * eps['value'] * book_per_share), 'reason': None,
                             'inputs': {'eps': eps['value'], 'bookValuePerShare': book_per_share,
                                        'fiscalYear': eps['end'], 'equityFiled': equity['filed'], 'shares': share_count},
                             'assumptions': {'multiplier': a['graham_multiplier']}}

    required = a['ddm_required_return']
    growth = a['terminal_growth']
    if not dividend or dividend['value'] <= 0 or required <= growth:
        methods['ddm'] = {'value': None, 'reason': 'Positive annual dividend per share or valid required-return assumptions are unavailable.'}
    else:
        d1 = dividend['value'] * (1 + growth)
        methods['ddm'] = {'value': d1 / (required - growth), 'reason': None,
                          'inputs': {'annualDividendPerShare': dividend['value'], 'nextDividend': d1,
                                     'fiscalYear': dividend['end'], 'filed': dividend.get('filed')},
                          'assumptions': {'growth': growth, 'requiredReturn': required}}
    return methods


def _restrict_to_universe(source, symbols):
    allowed = {_ticker_key(symbol) for symbol in symbols}
    rows = {ticker: row for ticker, row in source.get('rows', {}).items() if _ticker_key(ticker) in allowed}
    return {**source, 'rows': rows, 'status': source.get('status') if rows else 'no_universe_coverage'}


def _sec_methods(symbols, email):
    if not email:
        return {'status': 'contact_required', 'at': None, 'url': 'https://www.sec.gov/edgar/sec-api-documentation', 'rows': {}}
    agent = 'Dashivo SP500 Research contact: ' + email
    try:
        index = json.loads(_request(SEC_TICKERS_URL, agent).decode('utf-8'))
    except RateLimited:
        return {'status': 'rate_limited', 'at': None, 'url': SEC_TICKERS_URL, 'rows': {}}
    except Exception:
        return {'status': 'unavailable', 'at': None, 'url': SEC_TICKERS_URL, 'rows': {}}
    cik_by_symbol = {}
    for row in index.get('data', []):
        if len(row) >= 2:
            cik_by_symbol[_ticker_key(row[2] if len(row) > 2 else '')] = int(row[0])
    matched = {symbol: cik_by_symbol.get(_ticker_key(symbol)) for symbol in symbols}
    output = {}
    for position, (symbol, cik) in enumerate(matched.items()):
        if not cik:
            continue
        if position:
            time.sleep(0.13)  # stay below SEC fair-access limit, including any concurrent batch work
        try:
            facts = json.loads(_request(SEC_FACTS_URL.format(cik), agent).decode('utf-8'))
        except RateLimited:
            return {'status': 'rate_limited', 'at': None, 'url': SEC_FACTS_URL, 'rows': output}
        except Exception:
            return {'status': 'unavailable', 'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                    'url': SEC_FACTS_URL, 'rows': output}
        output[symbol] = calculate_methods(facts)
    return {'status': 'available' if output else 'unavailable', 'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'url': 'https://www.sec.gov/edgar/sec-api-documentation', 'rows': output}


def build_payload(symbols, previous=None, contact_email=None):
    """Fetch/cache source data. A fresh cache is reused except when SEC access is newly configured."""
    previous = previous if isinstance(previous, dict) else {}
    previous_sources = previous.get('sources') or {}
    previous_sec = previous_sources.get('sec') or {}
    sec_needs_refresh = bool(contact_email) and previous_sec.get('status') == 'contact_required'
    try:
        at = datetime.fromisoformat(previous.get('at', '')).timestamp()
        if time.time() - at < 24 * 3600 and not sec_needs_refresh:
            return previous
    except (ValueError, TypeError, OSError):
        pass

    sources = {}
    rate_limited = False
    try:
        sources['equityRank'] = _restrict_to_universe(
            parse_equity_rank(json.loads(_request(EQUITY_RANK_URL).decode('utf-8'))), symbols)
    except RateLimited:
        rate_limited = True
        sources['equityRank'] = {'status': 'rate_limited', 'at': None, 'url': EQUITY_RANK_URL, 'rows': {}}
    except Exception:
        sources['equityRank'] = {'status': 'unavailable', 'at': None, 'url': EQUITY_RANK_URL, 'rows': {}}
    if rate_limited:
        sources['zyberno'] = {'status': 'not_requested', 'at': None, 'url': ZYBERNO_URL, 'rows': {}}
    else:
        try:
            sources['zyberno'] = _restrict_to_universe(parse_zyberno_csv(_request(ZYBERNO_URL).decode('utf-8-sig')), symbols)
        except RateLimited:
            rate_limited = True
            sources['zyberno'] = {'status': 'rate_limited', 'at': None, 'url': ZYBERNO_URL, 'rows': {}}
        except Exception:
            sources['zyberno'] = {'status': 'unavailable', 'at': None, 'url': ZYBERNO_URL, 'rows': {}}

    if rate_limited:
        sources['sec'] = {'status': 'not_requested', 'at': None,
                          'url': 'https://www.sec.gov/edgar/sec-api-documentation', 'rows': {}}
    elif contact_email:
        sources['sec'] = _sec_methods(symbols, contact_email)
    else:
        sources['sec'] = {'status': 'contact_required', 'at': None,
                          'url': 'https://www.sec.gov/edgar/sec-api-documentation', 'rows': {}}
    # Preserve last good public data through transient upstream failures, retaining original row dates.
    for key in ('equityRank', 'zyberno'):
        if sources[key]['status'] in ('unavailable', 'rate_limited', 'empty') and (previous_sources.get(key) or {}).get('rows'):
            old = previous_sources[key]
            sources[key] = {**old, 'status': 'stale', 'staleSince': datetime.now(timezone.utc).isoformat(timespec='seconds')}
    if sources['sec']['status'] in ('unavailable', 'rate_limited', 'contact_required') and previous_sec.get('rows'):
        sources['sec'] = {**previous_sec, 'status': 'stale', 'staleSince': datetime.now(timezone.utc).isoformat(timespec='seconds')}

    return {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'assumptions': ASSUMPTIONS,
            'sources': sources, 'fvcEmbedUrl': FVC_EMBED_URL}
