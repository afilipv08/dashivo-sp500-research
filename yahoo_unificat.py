"""Screener personal S&P 500: Yahoo Finance -> Excel, sortat dupa minimul 52s."""
from pathlib import Path
from datetime import datetime, timezone
from io import StringIO
import argparse
import math
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import traceback
import requests

import html
import json
import re
from typing import Any
import pandas as pd
try:
    import yfinance as yf
except ModuleNotFoundError:
    yf = None
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.properties import CalcProperties
from openpyxl.comments import Comment

BASE = Path(__file__).resolve().parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))
OUTPUT = BASE / 'Output'
WIKI = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
CSV = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv'
HEADERS = ['Nr.', 'Simbol', 'Companie', 'Sector', 'Pret actiune', 'Minim 52 sapt.',
           'Maxim 52 sapt.', 'Distanta fata de minim (%)', 'Pozitie interval 52s (%)',
           'Moneda', 'Ora cotatiei (locala)', 'Camp pret Yahoo', 'Status date', 'Sursa Yahoo']


ANALYSTS_URL = "https://finance.yahoo.com/quote/{ticker}/"
ANALYST_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/html"}
SESSION = requests.Session()
ANALYSTS_PAGE_CACHE = {}
ANALYST_COLUMNS = [
    'Consens', 'Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell',
    'Strong Buy %', 'Buy %', 'Hold %', 'Sell %', 'Total Analysts',
    'Average Analyst Rating', 'Tinta medie', 'Tinta minima', 'Tinta maxima',
    'Potential (%)', 'Ranking Score', 'Status analisti',
    'Latest Rating - Date', 'Latest Rating - Analyst', 'Latest Rating - Rating Action',
    'Latest Rating - Rating', 'Latest Rating - Price Action', 'Latest Rating - Price Target'
]
HEADERS += ANALYST_COLUMNS
WORKERS = 4                     # actiuni descarcate simultan
MAX_ATTEMPTS = 4


class RateGate:
    """Pauza comuna pentru toate firele cand Yahoo limiteaza cererile (HTTP 429)."""
    def __init__(self):
        self.lock = threading.Lock()
        self.until = 0.0
        self.strikes = 0

    def wait(self):
        while True:
            with self.lock:
                delay = self.until - time.monotonic()
            if delay <= 0:
                return
            time.sleep(min(delay, 1.0))

    def limited(self):
        with self.lock:
            self.strikes = min(self.strikes + 1, 5)
            self.until = max(self.until, time.monotonic() + 10 * 2 ** (self.strikes - 1))

    def ok(self):
        with self.lock:
            self.strikes = max(0, self.strikes - 1)


GATE = RateGate()


def is_rate_limited(exc):
    text = f'{type(exc).__name__} {exc}'.lower()
    return any(marker in text for marker in ('ratelimit', 'rate limit', 'too many requests', '429'))

def analyst_values(symbol, price):
    try:
        for attempt in range(MAX_ATTEMPTS):
            GATE.wait()
            try:
                report = get_quote(symbol)
                GATE.ok()
                break
            except Exception as exc:
                if not is_rate_limited(exc) or attempt == MAX_ATTEMPTS - 1:
                    raise
                GATE.limited()
        history = report.get('recommendationHistory', [])
        current = history[0] if history else None
        counts = [as_int(current.get(k, 0)) for k in ('strongBuy','buy','hold','sell','strongSell')] if current is not None else [None]*5
        total = sum(counts) if current is not None else None
        sb, buy, hold, under, sell = counts
        percentages = [sb/total, buy/total, hold/total, (under+sell)/total] if total else [None]*4
        average = (sb+2*buy+3*hold+4*under+5*sell)/total if total else None
        score = sb*5+buy*3+hold-under*2-sell*4 if current is not None else None
        target = number(report.get('targetMeanPrice'))
        potential = target/price-1 if target and price else None
        ratings = report.get('latestRatings', [])
        latest = ratings[0] if ratings else {}
        status = []
        if current is None: status.append('Recomandari indisponibile')
        if not target: status.append('Tinta medie indisponibila')
        if not ratings: status.append('Latest Rating indisponibil')
        return [str(report.get('recommendationKey','n/a')).upper(), *counts, *percentages,
                total, average, report.get('targetMeanPrice'), report.get('targetLowPrice'),
                report.get('targetHighPrice'), potential, score, '; '.join(status) or 'OK',
                *[latest.get(k) for k in ('date','analyst','rating_action','rating','price_action','price_target')]]
    except Exception as exc:
        values = [None]*len(ANALYST_COLUMNS)
        values[17] = 'EROARE: ' + str(exc)[:250]
        return values
    finally:
        ANALYSTS_PAGE_CACHE.pop(symbol, None)


class YahooDataError(RuntimeError):
    """Datele cerute nu au putut fi citite de la Yahoo Finance."""

def as_int(value: Any) -> int:
    """Normalizează valorile lipsă/NaN din tabelul pandas Yahoo la zero."""
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return 0

def get_quote(ticker: str) -> dict[str, Any]:
    """Citește consensul prin yfinance, care gestionează autentificarea Yahoo."""
    stock = yf.Ticker(ticker)
    try:
        targets = stock.get_analyst_price_targets() or {}
        summary = stock.get_recommendations_summary()
    except Exception as exc:
        raise YahooDataError(f'Nu am putut citi datele pentru «{ticker}»: {exc}') from exc
    try:
        current_price = stock.fast_info.get('last_price') or targets.get('current')
    except Exception:
        current_price = targets.get('current')
    try:
        name = stock.get_info().get('longName', ticker)
    except Exception:
        name = ticker
    try:
        recent_ratings = stock.get_upgrades_downgrades()
    except Exception:
        recent_ratings = None
    if not targets and (summary is None or summary.empty):
        raise YahooDataError(f'Nu am găsit date de analiști pentru «{ticker}».')
    counts = {key: 0 for key in ('strongBuy', 'buy', 'hold', 'sell', 'strongSell')}
    if summary is not None and (not summary.empty):
        latest = summary.iloc[0]
        for key in counts:
            value = latest.get(key, 0)
            counts[key] = as_int(value)
    recommendation_history: list[dict[str, Any]] = []
    if summary is not None and (not summary.empty):
        for _, row in summary.head(4).iterrows():
            period = row.get('period', row.name)
            recommendation_history.append({'period': str(period), **{key: as_int(row.get(key, 0)) for key in counts}})
    fallback_ratings: list[dict[str, str]] = []
    if recent_ratings is not None and (not recent_ratings.empty):
        for index, row in recent_ratings.sort_index(ascending=False).head(8).iterrows():
            date = getattr(index, 'strftime', lambda _format: str(index))('%d.%m.%Y')
            fallback_ratings.append({'date': date, 'analyst': str(row.get('Firm', row.get('firm', '—')) or '—'), 'rating_action': str(row.get('Action', row.get('action', '—')) or '—'), 'rating': str(row.get('ToGrade', row.get('toGrade', '—')) or '—'), 'price_action': '—', 'price_target': '—'})
    try:
        latest_ratings = find_latest_ratings_in_page(ticker)
    except requests.RequestException:
        latest_ratings = []
    if not latest_ratings:
        latest_ratings = fallback_ratings
    opinions = sum(counts.values())
    weighted = counts['strongBuy'] + 2 * counts['buy'] + 3 * counts['hold'] + 4 * counts['sell'] + 5 * counts['strongSell']
    average = weighted / opinions if opinions else None
    positive = counts['strongBuy'] + counts['buy']
    negative = counts['sell'] + counts['strongSell']
    if opinions == 0:
        recommendation = 'n/a'
    elif positive >= negative * 2 and positive > counts['hold']:
        recommendation = 'buy'
    elif negative >= positive * 2 and negative > counts['hold']:
        recommendation = 'sell'
    else:
        recommendation = 'hold'
    return {'longName': name, 'regularMarketPrice': current_price, 'targetMeanPrice': targets.get('mean'), 'targetLowPrice': targets.get('low'), 'targetHighPrice': targets.get('high'), 'numberOfAnalystOpinions': opinions or None, 'averageAnalystRating': f'{average:.2f} / 5' if average else 'n/a', 'recommendationKey': recommendation, 'recommendationHistory': recommendation_history, 'latestRatings': latest_ratings}

def _extract_balanced_json(text: str, start: int) -> str | None:
    """Extrage un obiect JSON echilibrat pornind de la prima acoladă."""
    first = text.find('{', start)
    if first == -1:
        return None
    depth, in_string, escape = (0, False, False)
    for index in range(first, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == '\\\\':
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return text[first:index + 1]
    return None

def get_analysts_page(ticker: str) -> str:
    """Descarcă o singură dată pagina Analysts, chiar dacă citim două secțiuni."""
    if ticker not in ANALYSTS_PAGE_CACHE:
        response = SESSION.get(ANALYSTS_URL.format(ticker=ticker), headers=ANALYST_HEADERS, timeout=20)
        response.raise_for_status()
        ANALYSTS_PAGE_CACHE[ticker] = response.text
    return ANALYSTS_PAGE_CACHE[ticker]

def _page_json_payloads(page: str) -> list[dict[str, Any]]:
    """Extrage datele serializate din aplicația web Yahoo, fără selectori fragili HTML."""
    payloads: list[dict[str, Any]] = []
    for marker in ('root.App.main', '__NEXT_DATA__', 'Latest Ratings', 'latestRatings'):
        start = page.find(marker)
        if start == -1:
            continue
        raw = _extract_balanced_json(page, start)
        if raw:
            try:
                data = json.loads(raw)
                if isinstance(data, dict):
                    payloads.append(data)
            except json.JSONDecodeError:
                continue
    return payloads

def _date_for_display(value: Any) -> str:
    if isinstance(value, (int, float)):
        timestamp = value / 1000 if value > 10000000000 else value
        try:
            return datetime.fromtimestamp(timestamp, timezone.utc).strftime('%d.%m.%Y')
        except (OSError, OverflowError, ValueError):
            pass
    return str(value or '—')

def find_latest_ratings_in_page(ticker: str) -> list[dict[str, str]]:
    """Caută dinamic cardurile Yahoo «Latest Ratings» și normalizează câmpurile."""
    page = get_analysts_page(ticker)
    visible_text = re.sub('\\s+', ' ', re.sub('<[^>]+>', ' ', html.unescape(page))).strip()
    card_match = re.search('Latest Rating\\s+Date\\s+(?P<date>.+?)\\s+Analyst\\s+(?P<analyst>.+?)\\s+Rating Action\\s+(?P<rating_action>.+?)\\s+Rating\\s+(?P<rating>.+?)\\s+Price Action\\s+(?P<price_action>.+?)\\s+Price Target\\s+(?P<price_target>.+?)(?=\\s+(?:Statistics|Compare|People Also Watch|Copyright|Terms)\\b|$)', visible_text, flags=re.IGNORECASE)
    if card_match:
        fields = {key: clean_rating_text(value) for key, value in card_match.groupdict().items()}
        return [{'date': fields['date'], 'analyst': fields['analyst'], 'rating_action': fields['rating_action'], 'rating': fields['rating'], 'price_action': fields['price_action'], 'price_target': fields['price_target']}]
    records: list[dict[str, str]] = []

    def value_of(data: dict[str, Any], *names: str) -> Any:
        normalized = {str(key).replace('_', '').lower(): value for key, value in data.items()}
        for name in names:
            if name.replace('_', '').lower() in normalized:
                return normalized[name.replace('_', '').lower()]
        return None

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            analyst = value_of(value, 'analyst', 'analystName', 'firm', 'company')
            rating = value_of(value, 'rating', 'toGrade', 'grade')
            rating_action = value_of(value, 'ratingAction', 'action', 'rating_action')
            price_action = value_of(value, 'priceAction', 'price_action')
            price_target = value_of(value, 'priceTarget', 'targetPrice', 'price_target')
            date = value_of(value, 'date', 'ratingDate', 'publishedDate', 'epochGradeDate')
            if analyst and rating and (rating_action or price_action or price_target):
                records.append({'date': _date_for_display(date), 'analyst': str(analyst), 'rating_action': str(rating_action or '—'), 'rating': str(rating), 'price_action': str(price_action or '—'), 'price_target': format_number(price_target) if isinstance(price_target, (int, float)) else str(price_target or '—')})
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    for payload in _page_json_payloads(page):
        walk(payload)
    unique: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in records:
        key = (item['date'], item['analyst'], item['rating'], item['price_target'])
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique[:8]

def clean_rating_text(value: str) -> str:
    """Elimina linkul «View More» lipit de ultimul camp al cardului Yahoo."""
    value = re.sub(r'\s*View More\s*$', '', value.strip(), flags=re.IGNORECASE).strip()
    return '—' if value in ('', '-', '--') else value

def format_number(value: Any) -> str:
    try:
        return f'{float(value):,.2f}'
    except (TypeError, ValueError):
        return 'n/a'

def number(value):
    try:
        x = float(value)
        return x if math.isfinite(x) and x > 0 else None
    except (TypeError, ValueError):
        return None

def constituents():
    errors = []
    for url in (WIKI, CSV):
        try:
            response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
            response.raise_for_status()
            if url == WIKI:
                tables = pd.read_html(StringIO(response.text))
                frame = next(t for t in tables if {'Symbol', 'Security', 'GICS Sector'}.issubset(t.columns))
            else:
                frame = pd.read_csv(StringIO(response.text))
            frame = frame[['Symbol', 'Security', 'GICS Sector']].dropna().drop_duplicates('Symbol')
            if len(frame) < 450:
                raise ValueError('Lista neasteptat de scurta; extragerea este oprita.')
            return frame, url
        except Exception as exc:
            errors.append(f'{url}: {exc}')
    raise RuntimeError('Nu pot obtine lista S&P 500. Verifica internetul/proxy-ul.\n' + '\n'.join(errors))

def quote(record):
    symbol = str(record['Symbol']).replace('.', '-')
    result = dict(symbol=symbol, company=str(record['Security']), sector=str(record['GICS Sector']),
                  price=None, low=None, high=None, distance=None, position=None,
                  currency='', quote_time='Indisponibila', price_field='', status='',
                  source=f'https://finance.yahoo.com/quote/{symbol}/')
    last_error = ''
    for attempt in range(MAX_ATTEMPTS):
        GATE.wait()
        try:
            info = yf.Ticker(symbol).get_info()
            GATE.ok()
            field = 'regularMarketPrice' if number(info.get('regularMarketPrice')) else 'currentPrice'
            price = number(info.get(field))
            low = number(info.get('fiftyTwoWeekLow'))
            high = number(info.get('fiftyTwoWeekHigh'))
            if price is None or low is None or high is None or high < low:
                raise ValueError('Pret/minim/maxim 52s lipsa sau invalid; nu se inventeaza valori.')
            timestamp = info.get('regularMarketTime')
            qt = 'Indisponibila'
            if timestamp and field == 'regularMarketPrice':
                qt = datetime.fromtimestamp(float(timestamp), timezone.utc).astimezone().strftime('%d.%m.%Y %H:%M:%S %z')
            status = 'OK'
            if high == low:
                status = 'Interval 52s zero; pozitie indisponibila'
            elif price < low or price > high:
                status = 'Pret in afara intervalului Yahoo; verifica sursa'
            if qt == 'Indisponibila':
                status += '; ora cotatiei indisponibila'
            result.update(price=price, low=low, high=high, distance=(price/low-1),
                          position=(price-low)/(high-low) if high > low else None,
                          currency=info.get('currency', 'Necunoscuta'), quote_time=qt,
                          price_field=field, status=status)
            return result
        except Exception as exc:
            last_error = str(exc)
            if is_rate_limited(exc):
                GATE.limited()
            elif attempt >= 2:
                break
            elif attempt < MAX_ATTEMPTS - 1:
                time.sleep(2 ** (attempt + 1))
    result['status'] = 'EROARE: ' + last_error[:250]
    return result

def export(rows, list_url, started, limited=False):
    """Exportul complet (toate coloanele, cu formule) merge in Output/complet; compactul il scrie improvement."""
    folder = OUTPUT / 'complet'
    folder.mkdir(parents=True, exist_ok=True)
    now = datetime.now().astimezone()
    path = folder / (now.strftime('SP500_%d_%m_%Y_%H-%M-%S') + '.xlsx')
    if path.exists() or (OUTPUT / path.name).exists():
        path = folder / (now.strftime('SP500_%d_%m_%Y_%H-%M-%S') + f'_{now.microsecond:06d}.xlsx')
    wb = Workbook()
    ws = wb.active
    ws.title = 'Actiuni SP500'
    ws.append(HEADERS)
    rank = 0
    for index, item in enumerate(rows, start=2):
        valid = item['distance'] is not None
        if valid:
            rank += 1
        ws.append([rank if valid else None, item['symbol'], item['company'], item['sector'],
                   item['price'], item['low'], item['high'],
                   f'=IFERROR(E{index}/F{index}-1,"")' if valid else None,
                   f'=IFERROR((E{index}-F{index})/(G{index}-F{index}),"")' if valid else None,
                   item['currency'], item['quote_time'], item['price_field'], item['status'], item['source']] + item.get('analyst_values', [None]*len(ANALYST_COLUMNS)))
        for col in (5, 6, 7):
            ws.cell(index, col).number_format = '#,##0.00'
            ws.cell(index, col).comment = Comment(item['source'], 'Sursa')
        for col in (8, 9):
            ws.cell(index, col).number_format = '0.00%'
        ws.cell(index, 14).hyperlink = item['source']
        for col in range(1, len(HEADERS)+1):
            cell = ws.cell(index, col)
            color = '000000' if col in (8, 9) else ('008000' if col in (5, 6, 7) else '404040')
            if col == 13 and item['status'] != 'OK':
                color = 'B45309'
            cell.font = Font(name='Calibri', size=11, color=color)
            cell.alignment = Alignment(vertical='center', wrap_text=False)
        ws.row_dimensions[index].height = 15
    table = Table(displayName='TabelSP500', ref=f'A1:{ws.cell(1, len(HEADERS)).column_letter}{len(rows)+1}')
    table.tableStyleInfo = TableStyleInfo(name='TableStyleMedium2', showRowStripes=True)
    ws.add_table(table)
    widths = [7, 12, 48, 27, 18, 20, 20, 34, 33, 14, 35, 23, 65, 48] + [max(14, min(32, len(h)+2)) for h in ANALYST_COLUMNS]
    for col, width in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(1, col).column_letter].width = width
        ws.cell(1, col).font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
    ws.row_dimensions[1].height = 15
    ws.freeze_panes = 'E2'
    ws.sheet_view.showGridLines = False
    ws['A1'].comment = Comment(
        f"Inceput: {started.isoformat(timespec='seconds')}\n"
        f"Sfarsit: {now.isoformat(timespec='seconds')}\n"
        f"Sursa componente: {list_url}\n"
        f"Simboluri procesate: {len(rows)}\n"
        f"Acoperire: {'TEST LIMITAT' if limited else 'Lista completa; verifica statusurile'}\n"
        "Consens si Ranking Score sunt calculate prin regulile programului de analisti.\n"
        "Underperform = Yahoo sell; Sell = Yahoo strongSell; Sell % include ambele.\n"
        "Date informative, nu recomandare de investitie. Cotatiile nu sunt garantat in timp real.",
        'Informatii')
    for row_index, item in enumerate(rows, start=2):
        values = item.get('analyst_values', [])
        if values and values[10] is not None:
            formulas = {
                25: f'=SUM(P{row_index}:T{row_index})',
                21: f'=IFERROR(P{row_index}/Y{row_index},"")',
                22: f'=IFERROR(Q{row_index}/Y{row_index},"")',
                23: f'=IFERROR(R{row_index}/Y{row_index},"")',
                24: f'=IFERROR((S{row_index}+T{row_index})/Y{row_index},"")',
                26: f'=IFERROR((P{row_index}+2*Q{row_index}+3*R{row_index}+4*S{row_index}+5*T{row_index})/Y{row_index},"")',
                31: f'=5*P{row_index}+3*Q{row_index}+R{row_index}-2*S{row_index}-4*T{row_index}'
            }
            for col, formula in formulas.items(): ws.cell(row_index,col,formula)
        if values and values[15] is not None:
            ws.cell(row_index,30,f'=IFERROR(AA{row_index}/E{row_index}-1,"")')
        for col in (21,22,23,24,30):
            ws.cell(row_index,col).number_format = '0.00%'
        for col in (26,27,28,29):
            ws.cell(row_index,col).number_format = '#,##0.00'
        for col in range(15, len(HEADERS)+1):
            cell = ws.cell(row_index,col)
            if cell.data_type != 'f' and isinstance(cell.value,str) and cell.value.startswith(('=', '+', '-', '@')):
                cell.value = "'" + cell.value
            cell.comment = Comment(item['source'], 'Sursa')
    wb.calculation = CalcProperties(calcId=191029, fullCalcOnLoad=True)
    wb.save(path)
    return path

def checkpoint_path(day=None):
    """Progresul zilei: o linie JSON per actiune terminata, ca o rulare intrerupta sa poata fi reluata."""
    return OUTPUT / ('.checkpoint_' + (day or datetime.now()).strftime('%Y%m%d') + '.jsonl')

def load_checkpoint(path):
    meta, items = {}, {}
    if not path.exists():
        return meta, items
    for line in path.read_text(encoding='utf-8').splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue                        # ultima linie poate fi taiata de o oprire brusca
        if 'meta' in record:
            meta = record['meta']
        elif record.get('symbol'):
            items[record['symbol']] = record
    return meta, items

def checkpoint_status(day=None):
    meta, items = load_checkpoint(checkpoint_path(day))
    return {'done': len(items), 'total': meta.get('total')} if items else None

def json_default(value):
    return value.item() if hasattr(value, 'item') else str(value)

def research_item(record):
    item = quote(record)
    item['analyst_values'] = analyst_values(item['symbol'], item['price'])
    time.sleep(0.4)
    return item

RETRY_PAUSE = 20


def apply_history(item, closes):
    """Price and 52-week range from daily history, for stocks whose quote page Yahoo did not return."""
    close, low, high = closes
    if not (close and low and high and high >= low):
        return item
    item.update(price=close, low=low, high=high, distance=close / low - 1, position=(close - low) / (high - low) if high > low else None,
                currency='USD', quote_time='Inchidere zilnica (istoric)', price_field='history 1y', status='OK (pret din istoric zilnic)')
    item['analyst_values'] = analyst_values(item['symbol'], close)
    return item


def history_ranges(symbols):
    """{symbol: (last close, 52-week low, 52-week high)} from one yfinance batch of daily bars."""
    frame = yf.download(symbols, period='1y', interval='1d', progress=False, auto_adjust=False, group_by='column', threads=True)
    out = {}
    for sym in symbols:
        try:
            close = frame['Close'][sym].dropna(); low = frame['Low'][sym].dropna(); high = frame['High'][sym].dropna()
            if len(close):
                out[sym] = (number(close.iloc[-1]), number(low.min()), number(high.max()))
        except (KeyError, IndexError):
            continue
    return out


def retry_failed(rows, records, ckpt):
    """Cloud servers get silently throttled by Yahoo (quotes come back empty, no HTTP 429): retry the failed
    stocks once more, slowly, then fall back to daily history for the price and the 52-week range."""
    failed = [r for r in rows if r['distance'] is None]
    if not failed:
        return rows
    by_symbol = {str(r['Symbol']).replace('.', '-'): r for r in records}
    print(f'PHASE retry {len(failed)}', flush=True)
    time.sleep(RETRY_PAUSE)
    fixed = {}
    with ThreadPoolExecutor(2) as pool, ckpt.open('a', encoding='utf-8') as log:
        for item in pool.map(research_item, [by_symbol[f['symbol']] for f in failed if f['symbol'] in by_symbol]):
            if item['distance'] is not None:
                fixed[item['symbol']] = item
                log.write(json.dumps(item, default=json_default) + '\n')
            print(f"[retry] {item['symbol']}: {item['status']}", flush=True)
    still = [f for f in failed if f['symbol'] not in fixed]
    if still:
        try:
            ranges = history_ranges([f['symbol'] for f in still])
        except Exception as exc:
            ranges = {}
            print(f'[history] EROARE: {exc}', flush=True)
        for f in still:
            if f['symbol'] in ranges:
                item = apply_history(dict(f), ranges[f['symbol']])
                if item['distance'] is not None:
                    fixed[item['symbol']] = item
                    print(f"[history] {item['symbol']}: {item['status']}", flush=True)
    return [fixed.get(r['symbol'], r) for r in rows]


def preview(rows):
    columns = ['Simbol', 'Companie', 'Pret', 'Minim 52s', 'Maxim 52s', 'Dist. minim %', 'Pozitie 52s %', 'Moneda']
    data = []
    for r in rows[:5]:
        fmt = lambda v: f'{v:.2f}' if v is not None else 'N/A'
        data.append([r['symbol'], r['company'], fmt(r['price']), fmt(r['low']), fmt(r['high']),
                     fmt(r['distance']*100 if r['distance'] is not None else None),
                     fmt(r['position']*100 if r['position'] is not None else None), r['currency']])
    print('\nPRIMELE 5 RANDURI DIN OUTPUT (date reale ale acestei rulari):\n')
    print(pd.DataFrame(data, columns=columns).to_string(index=False))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=0, help='Doar pentru test: primele N simboluri din lista; 0=toate.')
    parser.add_argument('--input-excel', type=Path, help='Proceseaza offline un Excel existent, fara descarcari Yahoo.')
    parser.add_argument('--demo', action='store_true', help='Proceseaza offline cel mai recent raport din output-ul programului original.')
    parser.add_argument('--resume', action='store_true', help='Continua rularea intrerupta azi (sare actiunile deja salvate).')
    args = parser.parse_args()
    if args.input_excel and args.demo:
        parser.error('Foloseste --input-excel sau --demo, nu ambele.')
    from improvement import process_report
    if args.input_excel or args.demo:
        source = args.input_excel
        if args.demo:
            reports = [p for p in (BASE.parent / 'output').glob('*.xlsx') if not p.name.startswith('~$')]
            if not reports:
                parser.error('Nu exista rapoarte Excel pentru demo in output-ul original.')
            source = max(reports, key=lambda p: p.stat().st_mtime)
        process_report(source)
        return 0
    if args.limit < 0:
        parser.error('--limit trebuie sa fie >= 0')
    if yf is None:
        parser.error('Pentru descarcarea live este necesar yfinance. Demo-ul offline functioneaza fara acesta.')
    started = datetime.now().astimezone()
    print('PHASE list', flush=True)
    frame, list_url = constituents()
    if args.limit:
        frame = frame.head(args.limit)
    records = frame.to_dict('records')
    symbols = {str(r['Symbol']).replace('.', '-') for r in records}
    OUTPUT.mkdir(exist_ok=True)
    ckpt = checkpoint_path()
    meta, saved = load_checkpoint(ckpt) if args.resume else ({}, {})
    if not saved:
        ckpt.write_text(json.dumps({'meta': {'started': started.isoformat(), 'total': len(records), 'list': list_url}}) + '\n', encoding='utf-8')
    elif meta.get('started'):
        started = datetime.fromisoformat(meta['started'])
    rows = [item for symbol, item in saved.items() if symbol in symbols]
    todo = [r for r in records if str(r['Symbol']).replace('.', '-') not in saved]
    print(f'Simboluri de procesat: {len(records)}. Preturile vin exclusiv din Yahoo Finance.')
    print(f'PHASE quotes {len(records)} {len(rows)}', flush=True)
    with ThreadPoolExecutor(WORKERS) as pool, ckpt.open('a', encoding='utf-8') as log:
        for future in as_completed([pool.submit(research_item, r) for r in todo]):
            item = future.result()
            rows.append(item)
            log.write(json.dumps(item, default=json_default) + '\n')
            log.flush()
            print(f"[{len(rows)}/{len(records)}] {item['symbol']}: {item['status']}", flush=True)
    rows = retry_failed(rows, records, ckpt)
    print('PHASE export', flush=True)
    rows.sort(key=lambda r: (r['distance'] is None, r['distance'] if r['distance'] is not None else math.inf, r['symbol']))
    path = export(rows, list_url, started, limited=bool(args.limit))
    report, _, _ = process_report(path, report_path=OUTPUT / path.name)
    ckpt.unlink(missing_ok=True)
    preview(rows)
    valid = sum(r['distance'] is not None for r in rows)
    print(f'\nExcel salvat: {report}\nExport complet: {path}\nCotatii utilizabile: {valid}/{len(rows)}')
    if valid < len(rows):
        print('ATENTIE: rezultat partial. Randurile cu erori sunt la final, nu sunt eliminate.')
    return 0 if valid else 2

if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('\nExtragere intrerupta. Nu s-a generat un raport complet.')
        sys.exit(130)
    except Exception:
        OUTPUT.mkdir(exist_ok=True)
        log = OUTPUT / ('eroare_' + datetime.now().strftime('%d.%m.%y_%H-%M-%S') + '.txt')
        log.write_text(traceback.format_exc(), encoding='utf-8')
        print(f'EROARE. Detalii: {log}')
        traceback.print_exc()
        sys.exit(1)
