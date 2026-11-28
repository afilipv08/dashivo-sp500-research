"""Build the online version (GitHub Pages) into site/: the dashboard page, its data files and the app manifest.

    python build_site.py                 # use the data already on disk
    python build_site.py --refresh       # also fetch live prices, crypto, ratings and price history now

GitHub Actions runs this after the weekly research and every 30 minutes for prices (see .github/workflows).
"""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request

import dashboard
import intrinsic_value
import technical
import fundamentals
import signals
import valuation

BASE = Path(__file__).resolve().parent
SITE = BASE / 'site'
OUTPUT = BASE / 'Output'
REPO = os.environ.get('GITHUB_REPOSITORY', 'afilipv08/dashivo-sp500-research')
PAGES = f"https://{REPO.split('/')[0]}.github.io/{REPO.split('/')[1]}/"
DAY = 24 * 3600


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')


def latest_report():
    reports = [p for p in OUTPUT.glob('SP500_*.xlsx') if re.search(r'SP500_\d{2}_\d{2}_\d{4}_\d{2}-\d{2}-\d{2}\.xlsx$', p.name)]
    stamp = lambda p: datetime.strptime(re.search(r'(\d{2}_\d{2}_\d{4}_\d{2}-\d{2}-\d{2})', p.name).group(1), '%d_%m_%Y_%H-%M-%S')
    return max(reports, key=stamp), stamp


def previous(name):
    """The file currently published on the site, to reuse slow-changing data between 30-minute builds."""
    try:
        with urllib.request.urlopen(PAGES + 'data/' + name + '?t=' + str(int(time.time())), timeout=20) as r:
            return json.loads(r.read())
    except Exception:
        return None


def fresh(data, hours):
    try:
        return time.time() - datetime.fromisoformat(data['at']).timestamp() < hours * 3600
    except (TypeError, KeyError, ValueError):
        return False


def history(symbols):
    """One year of unadjusted daily closes for every symbol plus ^GSPC, aligned on one date list."""
    import yfinance as yf
    symbols = sorted(set(symbols) | {'^GSPC'})
    frame = yf.download(symbols, period='1y', interval='1d', progress=False, auto_adjust=False, group_by='column', threads=True)['Close']
    dates = [d.strftime('%Y-%m-%d') for d in frame.index]
    series = {}
    for sym in frame.columns:
        values = [round(float(v), 2) if v == v and v > 0 else None for v in frame[sym].tolist()]
        if any(values):
            series[str(sym)] = values
    return {'at': now(), 'dates': dates, 'series': series}


def write_json(name, data):
    (SITE / 'data').mkdir(parents=True, exist_ok=True)
    (SITE / 'data' / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')


def icons():
    from PIL import Image
    mark = Image.open(BASE / 'dashivo/assets/mark.png').convert('RGBA')
    for size in (192, 512):
        tile = Image.new('RGBA', (size, size), (255, 255, 255, 255))   # opaque square: phones mask it themselves
        inner = mark.resize((int(size * .82),) * 2, Image.LANCZOS)
        tile.alpha_composite(inner, ((size - inner.width) // 2,) * 2)
        tile.convert('RGB').save(SITE / f'icon-{size}.png')


PWA_HEAD = """<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#c8000a">
<link rel="apple-touch-icon" href="icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="SP500 Research">
<meta name="apple-mobile-web-app-status-bar-style" content="default">"""
SERVICE_WORKER = """// offline: always try the network first, fall back to the last copy
const CACHE = 'sp500-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // 'no-cache' revalidates with GitHub Pages, so a new version shows up right away instead of after the 10-minute HTTP cache
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
"""


def build(refresh=False):
    report, stamp = latest_report()
    data = dashboard.load_payload(report)
    intrinsic_data = None
    try:
        intrinsic_data = json.loads((SITE / 'data' / 'intrinsic_values.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        pass
    if refresh and intrinsic_data is None:
        intrinsic_data = previous('intrinsic_values.json')
    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / 'data').mkdir(parents=True)
    payload = json.dumps(data, ensure_ascii=False, allow_nan=False).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    html = dashboard.build_html(payload)
    html = html.replace('<title>', PWA_HEAD + '\n<title>', 1)
    html = html.replace('<script id="data"', "<script>window.dashboardStatic=true;window.dashboardRunToken='static';"
                        "if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js'));</script><script id=\"data\"", 1)
    (SITE / 'index.html').write_text(html, encoding='utf-8')
    shutil.copy(report, SITE / report.name)          # the "Source Excel" link
    symbols = [r['symbol'] for r in data['allItems']]
    meta = {'at': now(), 'report': report.name, 'reportAt': stamp(report).isoformat(), 'repoUrl': f'https://github.com/{REPO}',
            'workflowUrl': f'https://github.com/{REPO}/actions/workflows/research.yml', 'site': PAGES}

    import live_prices, crypto, ratings
    live = None
    if refresh:
        try:
            live = live_prices.refresh(symbols)
        except Exception as exc:
            print('live prices:', exc)
    live = live or live_prices.cached()
    if live.get('prices'):
        write_json('live_prices.json', live)
        meta['pricesAt'] = live.get('at')

    coins = None
    if refresh:
        try:
            coins = crypto.refresh(force=True)
        except Exception as exc:
            print('crypto:', exc)
    coins = crypto.public(coins or crypto.cached())
    if coins:
        write_json('crypto.json', coins)
        meta['cryptoAt'] = coins.get('at')

    # slow-changing data: reuse what the site already publishes while it is less than a day old
    rated = previous('ratings.json') if refresh else None
    if refresh and not (rated and fresh(rated.get('_meta', {}), 24)):
        rated = {'_meta': {'at': now()}}
        for sym in [r['symbol'] for r in data['items']][:120]:    # the filtered list (the stocks shown on Top 10)
            try:
                rated[sym] = {'symbol': sym, 'at': now(), 'rows': ratings.fetch(sym)}
            except Exception as exc:
                print('ratings', sym, exc)
    if rated:
        write_json('ratings.json', rated)

    hist = previous('history.json') if refresh else None
    if refresh:
        try:
            if hist and fresh(hist, 24):
                if '^GSPC' not in hist.get('series', {}):
                    benchmark = history(['^GSPC'])
                    by_date = dict(zip(benchmark['dates'], benchmark['series'].get('^GSPC', [])))
                    values = [by_date.get(day) for day in hist['dates']]
                    if any(isinstance(value, (int, float)) and value > 0 for value in values):
                        hist['series']['^GSPC'] = values
                        hist['at'] = benchmark['at']
                    else:
                        print('history: S&P 500 benchmark is unavailable')
            else:
                hist = history(symbols)
        except Exception as exc:
            print('history:', exc)
    if hist:
        write_json('history.json', hist)

    # technical analysis from three years of daily OHLCV for every stock; recomputed at most twice a day
    tech = previous('technical.json') if refresh else None
    if refresh and not (tech and tech.get('schema') == technical.SCHEMA and fresh(tech, 12)):
        try:
            tech = technical.build(symbols)
        except Exception as exc:
            print('technical:', exc)
    if tech:
        write_json('technical.json', tech)

    if refresh:
        try:
            intrinsic_data = intrinsic_value.build_payload(
                symbols, previous=intrinsic_data, contact_email=os.environ.get('SEC_CONTACT_EMAIL', '').strip() or None)
        except Exception:
            # Keep building the public site if an optional valuation source is unavailable.
            intrinsic_data = intrinsic_data or {'at': now(), 'assumptions': intrinsic_value.ASSUMPTIONS, 'sources': {}, 'fvcEmbedUrl': intrinsic_value.FVC_EMBED_URL}
    if intrinsic_data is None:
        intrinsic_data = {'at': now(), 'assumptions': intrinsic_value.ASSUMPTIONS,
                          'sources': {'equityRank': {'status': 'unavailable', 'rows': {}},
                                      'zyberno': {'status': 'unavailable', 'rows': {}},
                                      'sec': {'status': 'contact_required', 'rows': {}}},
                          'fvcEmbedUrl': intrinsic_value.FVC_EMBED_URL}
    write_json('intrinsic_values.json', intrinsic_data)

    # fundamental analysis for every stock, ranked within its sector; refreshed at most once a day (about 2–3 minutes)
    fund = previous('fundamentals.json') if refresh else None
    if refresh and not (fund and fund.get('schema') == fundamentals.SCHEMA and fresh(fund, 24)):
        try:
            fund = fundamentals.build(data['allItems'], ((intrinsic_data or {}).get('sources') or {}).get('zyberno', {}).get('rows'))
        except Exception as exc:
            print('fundamentals:', exc)
    if fund:
        write_json('fundamentals.json', fund)

    # fair value: eight calculated methods from the fundamentals plus external sources; at most twice a day
    val = previous('valuation.json') if refresh else None
    if refresh and fund and not (val and val.get('schema') == valuation.SCHEMA and fresh(val, 12)):
        try:
            val = valuation.build(fund, intrinsic_data, (live or {}).get('prices'))
        except Exception as exc:
            print('valuation:', exc)
    if val:
        write_json('valuation.json', val)

    import top10_history
    top10_days = top10_history.load()
    write_json('top10_history.json', top10_days)

    # signals: 27 methods + the funnel score for every stock the Top 10 can show; once a day (several minutes: SEC, Yahoo, FRED, CFTC)
    sig = previous('signals.json') if refresh else None
    targets = set(signals.target_symbols(data, top10_days))
    sec_email = os.environ.get('SEC_CONTACT_EMAIL', '').strip() or None
    sec_missing = bool(sec_email) and ((sig or {}).get('sources') or {}).get('sec', {}).get('status') != 'ok'   # e-mail added since the last run
    if refresh and not (sig and sig.get('schema') == signals.SCHEMA and fresh(sig, 20) and targets <= set(sig.get('symbols') or []) and not sec_missing):
        try:
            sig = signals.build(data, hist, top10_days, previous=sig, contact_email=sec_email)
        except Exception as exc:
            print('signals:', exc)
    if sig:
        write_json('signals.json', sig)
    pc_results = BASE / 'Output' / 'pc_analysis.json'   # answers of the programs on the owner's PC, kept in the platform
    if pc_results.is_file():
        try:
            write_json('pc_analysis.json', json.loads(pc_results.read_text(encoding='utf-8')))
        except ValueError:
            pass
    write_json('meta.json', meta)
    (SITE / 'manifest.webmanifest').write_text(json.dumps({
        'name': 'Dashivo SP500 Research', 'short_name': 'SP500', 'start_url': './', 'scope': './', 'display': 'standalone',
        'background_color': '#f6f4f2', 'theme_color': '#c8000a', 'description': 'S&P 500 and crypto research dashboard',
        'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any maskable'},
                  {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any maskable'}]}, indent=1), encoding='utf-8')
    (SITE / 'sw.js').write_text(SERVICE_WORKER, encoding='utf-8')
    (SITE / '.nojekyll').write_text('', encoding='utf-8')
    icons()
    size = sum(f.stat().st_size for f in SITE.rglob('*') if f.is_file()) // 1024
    print(f'Site: {SITE} · report {report.name} · {size} KB')
    return SITE


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--refresh', action='store_true', help='Fetch live prices, crypto, ratings and history now.')
    build(parser.parse_args().refresh)
