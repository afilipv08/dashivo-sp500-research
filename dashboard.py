import argparse
import base64
from datetime import date, datetime
import json
import math
from pathlib import Path
import re

from openpyxl import load_workbook

BASE = Path(__file__).resolve().parent
PAYLOAD_SCHEMA = 2   # bump when payload fields change, so cached JSON snapshots are rebuilt
STYLE_REFERENCE = 'Dashivo design system (Reusable_Skill_Dashboards · reference app TaskFlow)'
CSS_FILES = ('dashivo/styles.css', 'dashivo/themes.css', 'dashivo/shell.css', 'web/app.css')
# Order matters: helpers -> UI -> app config + wording -> shared i18n/themes/shell -> app -> tour.
JS_FILES = ('dashivo/core.js', 'dashivo/ui.js', 'web/config.js', 'web/vendor/qrcode.js', 'web/i18n_sp500.js', 'dashivo/i18n_brand.js',
            'dashivo/i18n.js', 'dashivo/themes.js', 'dashivo/shell.js', 'web/data.js', 'web/visuals.js', 'web/views.js',
            'web/portfolio.js', 'web/history.js', 'web/ai.js', 'web/crypto.js', 'web/static.js', 'web/app.js', 'dashivo/tour.js', 'web/tour_steps.js')


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def sheet_records(ws):
    for header_row, row in enumerate(ws.iter_rows(values_only=True), 1):
        if 'Simbol' in row and 'Pret actiune' in row:
            headers = list(row)
            break
    else:
        raise ValueError(f'Antetul nu a fost gasit in {ws.title}.')
    records = []
    for row in ws.iter_rows(min_row=header_row+1, values_only=True):
        if not row[headers.index('Simbol')]:
            continue
        records.append({str(key): (value.isoformat() if isinstance(value, (date, datetime)) else value)
                        for key, value in zip(headers, row) if key is not None})
    return headers, records


def analyze(record):
    fields = {'price': 'Pret actiune', 'low': 'Min. 52 wk', 'high': 'Max.', 'minTarget': 'Tinta minima',
              'meanTarget': 'Tinta medie', 'maxTarget': 'Tinta maxima',
              'sb': 'Strong Buy', 'buy': 'Buy', 'under': 'Underperform',
              'sell': 'Sell', 'total': 'Total Analysts'}
    item = dict(record)
    for key, column in fields.items():
        item[key] = number(record.get(column))
    item['symbol'] = str(record.get('Simbol', ''))
    item['company'] = str(record.get('Conpanie', record.get('Companie', '')) or '')
    item['sector'] = str(record.get('Sector') or 'N/A')
    counts = [item[key] for key in ('sb', 'buy', 'under', 'sell', 'total')]
    valid_counts = all(v is not None and v >= 0 and v.is_integer() for v in counts)
    item['hold'] = number(record.get('Hold')) if 'Hold' in record else item['total']-sum(counts[:4]) if valid_counts else None
    if item['hold'] is not None and (not item['hold'].is_integer() or not valid_counts or item['hold']+sum(counts[:4]) != item['total']):
        item['hold'] = None
    if 'Hold' not in item:
        item['Hold'] = item['hold']
    if item['hold'] is not None and item['hold'] < 0:
        item['hold'] = None
    item['support'] = (item['sb']+item['buy'])/item['total'] if valid_counts and item['hold'] is not None and item['total'] else None
    item['weighted'] = 1.5*item['sb']+item['buy'] if valid_counts and item['hold'] is not None else None
    price = item['price']
    item['gap'] = abs(item['minTarget']/price-1) if price and price > 0 and item['minTarget'] and item['minTarget'] > 0 else None
    item['upside'] = item['meanTarget']/price-1 if price and price > 0 and item['meanTarget'] and item['meanTarget'] > 0 else None
    item['distance'] = price/item['low']-1 if price and price > 0 and item['low'] and item['low'] > 0 else None
    issues = []
    if item['hold'] is None:
        issues.append('Recommendations missing or inconsistent; the distribution cannot be calculated.')
    targets = [item[key] for key in ('minTarget', 'meanTarget', 'maxTarget')]
    if any(v is None or v <= 0 for v in targets):
        issues.append('One or more targets are missing or invalid.')
    elif not targets[0] <= targets[1] <= targets[2]:
        issues.append('The order minimum ≤ mean ≤ maximum target is not respected.')
    if price is None or price <= 0:
        issues.append('Price missing or invalid.')
    item['issues'] = issues
    return item


def payload(source):
    wb = load_workbook(source, read_only=True, data_only=True)
    try:
        if 'Lista_Filtrata' not in wb.sheetnames:
            raise ValueError('Excelul trebuie sa contina Lista_Filtrata.')
        headers, records = sheet_records(wb['Lista_Filtrata'])
        if 'Hold' not in headers:
            headers.insert(headers.index('Buy')+1, 'Hold')
        items = [analyze(record) for record in records]
        bulk = wb['Lista_SP500'] if 'Lista_SP500' in wb.sheetnames else wb['Actiuni SP500'] if 'Actiuni SP500' in wb.sheetnames else None
        bulk_records = sheet_records(bulk)[1] if bulk is not None else None
        bulk_count = len(bulk_records) if bulk_records is not None else None
        all_items = [analyze(record) for record in bulk_records] if bulk_records is not None else items
        match = re.search(r'SP500_(\d{2}_\d{2}_\d{4}_\d{2}-\d{2}-\d{2})', source.stem)
        report_date = match.group(1).replace('_', ' ') if match else 'Unknown'
        criteria = str(wb['Lista_Filtrata']['A1'].value or '')
        return {'schema': PAYLOAD_SCHEMA, 'source': source.name, 'sourceDate': report_date,
                'generated': datetime.now().astimezone().isoformat(timespec='seconds'),
                'styleReference': STYLE_REFERENCE, 'criteria': criteria,
                'bulkCount': bulk_count, 'headers': headers, 'items': items,
                'allItems': all_items, 'fullUniverse': bulk is not None}
    finally:
        wb.close()


def data_uri(path):
    return 'data:image/png;base64,' + base64.b64encode((BASE/path).read_bytes()).decode('ascii')


def build_html(data):
    """Inline CSS, JS, logos and the JSON snapshot into one portable HTML file (like Dashivo build.py)."""
    read = lambda name: (BASE/name).read_text(encoding='utf-8')
    parts = {'__CSS__': '\n'.join(read(name) for name in CSS_FILES),
             '__JS__': '\n'.join(read(name) for name in JS_FILES),
             '__LOGO_SRC__': data_uri('dashivo/assets/logo.png'),
             '__LOGO_WHITE__': data_uri('dashivo/assets/logo-white.png'),
             '__MARK_SRC__': data_uri('dashivo/assets/mark.png'),
             '__DATA_JSON__': data}
    return re.sub('|'.join(parts), lambda match: parts[match.group(0)], read('web/index.html'))


def load_payload(source):
    """Dashboard data for an Excel report, read from its JSON snapshot (written on first use)."""
    source = Path(source).resolve()
    snapshot = source.with_suffix('.json')
    if snapshot.is_file() and snapshot.stat().st_mtime >= source.stat().st_mtime:
        try:
            data = json.loads(snapshot.read_text(encoding='utf-8'))
            if data.get('schema') == PAYLOAD_SCHEMA:
                return data
        except (OSError, ValueError):
            pass
    data = payload(source)
    snapshot.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    return data


def export_dashboard(source, output=None):
    source = Path(source).resolve()
    output = Path(output) if output else source.parent/'SP500_Dashboard.html'
    data = json.dumps(load_payload(source), ensure_ascii=False, allow_nan=False)
    data = data.replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    output.write_text(build_html(data), encoding='utf-8')
    print(f'Dashboard HTML: {output}')
    return output


def main():
    parser = argparse.ArgumentParser(description='Dashboard SP500 offline din Lista_Filtrata.')
    parser.add_argument('excel', nargs='?', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    source = args.excel
    if source is None:
        sources = [p for p in (BASE/'Output').glob('SP500_*.xlsx') if not p.name.startswith('~$')]
        if not sources:
            parser.error('Nu exista rapoarte SP500 in Output.')
        source = max(sources, key=lambda p: p.stat().st_mtime)
    export_dashboard(source, args.output)


if __name__ == '__main__':
    main()
