from copy import copy
from datetime import datetime
import math
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.formula.translate import Translator
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.table import Table, TableStyleInfo

BASE = Path(__file__).resolve().parent
SIMULATION_CAPITAL = 10_000.0
OUTPUT_COLUMNS = (
    ('Simbol', 'Simbol'), ('Conpanie', 'Companie'), ('Sector', 'Sector'),
    ('Pret actiune', 'Pret actiune'), ('Min. 52 wk', 'Minim 52 sapt.'),
    ('Max.', 'Maxim 52 sapt.'), ('Dist. fata de min. [%]', 'Distanta fata de minim (%)'),
    ('Consens', 'Consens'), ('Strong Buy', 'Strong Buy'), ('Buy', 'Buy'), ('Hold', 'Hold'),
    ('Underperform', 'Underperform'), ('Sell', 'Sell'), ('Total Analysts', 'Total Analysts'),
    ('Average Analyst Rating', 'Average Analyst Rating'), ('Tinta medie', 'Tinta medie'),
    ('Tinta minima', 'Tinta minima'), ('Tinta maxima', 'Tinta maxima'),
    ('Potential (%)', 'Potential (%)'), ('Ranking Score', 'Ranking Score'),
    ('Latest Rating - Date', 'Latest Rating - Date'),
    ('Latest Rating - Rating Action', 'Latest Rating - Rating Action'),
    ('Latest Rating - Rating', 'Latest Rating - Rating'),
    ('Latest Rating - Price Target', 'Latest Rating - Price Target'),
)
REQUIRED = ('Simbol', 'Companie', 'Pret actiune', 'Minim 52 sapt.', 'Moneda',
            'Consens', 'Strong Buy', 'Buy', 'Hold', 'Sell', 'Tinta minima')
RULES = ('Consens = BUY; Sell = 0; Hold = 0 sau 1; Strong Buy + Buy >= 15. '
         'Apropiere de tinta minima = ABS(Tinta minima / Pret actiune - 1), crescator; '
         'se aplica atat tintelor sub pret, cat si celor peste pret, fara prag procentual. '
         'Clasament final: apropiere procentuala crescatoare, apoi '
         '1.5 * Strong Buy + Buy descrescator, diferenta pret-minim 52s crescatoare, apoi simbol. '
         'Underperform nu este filtrat: in raport Sell = Yahoo strongSell, '
         'iar Underperform = Yahoo sell. Date lipsa/invalide excluse.')


def numeric(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def select_candidates(ws):
    headers = [cell.value for cell in ws[1]]
    missing = set(REQUIRED) - set(headers)
    if missing:
        raise ValueError('Coloane lipsa: ' + ', '.join(sorted(missing)))
    columns = {name: headers.index(name) for name in REQUIRED}
    candidates, seen = [], set()
    for row_index, row in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
        record = {name: row[index] for name, index in columns.items()}
        if str(record['Consens']).strip().upper() != 'BUY':
            continue
        counts = {name: numeric(record[name]) for name in ('Strong Buy', 'Buy', 'Hold', 'Sell')}
        if any(value is None or value < 0 or not value.is_integer() for value in counts.values()):
            continue
        if counts['Sell'] != 0 or counts['Hold'] not in (0, 1):
            continue
        positive = counts['Strong Buy'] + counts['Buy']
        if positive < 15:
            continue
        price, low = numeric(record['Pret actiune']), numeric(record['Minim 52 sapt.'])
        if price is None or low is None or price <= 0 or low <= 0:
            continue
        target = numeric(record['Tinta minima'])
        if target is None or target <= 0:
            continue
        target_gap = target/price-1
        if not math.isfinite(target_gap):
            continue
        symbol = str(record['Simbol'] or '').strip().upper()
        if not symbol:
            continue
        if symbol in seen:
            raise ValueError(f'Simbol duplicat eligibil: {symbol}')
        seen.add(symbol)
        candidates.append(dict(record, symbol=symbol, price=price, low=low,
                               source_row=row_index, difference=price-low, target=target,
                               target_gap=target_gap, target_distance=abs(target_gap),
                               positive=int(positive), score=1.5*counts['Strong Buy']+counts['Buy']))
    candidates.sort(key=lambda item: (item['target_distance'], item['symbol']))
    return candidates


LIST_FILTER_RULES = 'Distanta fata de minim <= 12% | Total Analysts >= 12 | Sell = 0 | Underperform <= 2'


def select_list_rows(source):
    headers = [cell.value for cell in source[1]]
    required = ('Pret actiune', 'Minim 52 sapt.', 'Total Analysts', 'Sell', 'Underperform')
    if not set(required).issubset(headers):
        raise ValueError('Coloane lipsa pentru Lista_Filtrata.')
    selected = []
    for row_index in range(2, source.max_row+1):
        values = {name: source.cell(row_index, col).value for col, name in enumerate(headers, 1)}
        price, low = numeric(values['Pret actiune']), numeric(values['Minim 52 sapt.'])
        total = numeric(values['Total Analysts'])
        if source.cell(row_index, headers.index('Total Analysts')+1).data_type == 'f':
            counts = [numeric(values.get(name)) for name in ('Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell')]
            total = sum(counts) if all(value is not None and value >= 0 and value.is_integer() for value in counts) else None
        sell, underperform = numeric(values['Sell']), numeric(values['Underperform'])
        if price is None or low is None or price <= 0 or low <= 0:
            continue
        if any(value is None or value < 0 or not value.is_integer() for value in (total, sell, underperform)):
            continue
        distance = price/low-1
        if (distance <= 0.12 or math.isclose(distance, 0.12, rel_tol=0, abs_tol=1e-12)) and total >= 12 and sell == 0 and underperform <= 2:
            selected.append(row_index)
    return selected


def add_filtered_list(wb, source):
    ws = wb.create_sheet('Lista_Filtrata')
    ws.append([cell.value for cell in source[1]])
    for target_row, source_row in enumerate(select_list_rows(source), 2):
        for col in range(1, source.max_column+1):
            old = source.cell(source_row, col)
            new = ws.cell(target_row, col)
            new.value = (Translator(old.value, origin=old.coordinate).translate_formula(new.coordinate)
                         if old.data_type == 'f' else old.value)
            new._style = copy(old._style)
    ws['A1'].comment = Comment(LIST_FILTER_RULES, 'Criterii')


def style_table(ws, name, header_row=1):
    ws.freeze_panes = f'E{header_row+1}'
    ws.sheet_view.showGridLines = False
    ws.row_dimensions[header_row].height = 60
    widths = {'Simbol': 9, 'Conpanie': 24, 'Companie': 24, 'Sector': 18,
              'Strong Buy': 9, 'Buy': 8, 'Underperform': 13, 'Sell': 8,
              'Consens': 10, 'Latest Rating - Date': 12,
              'Latest Rating - Rating Action': 14, 'Latest Rating - Rating': 14,
              'Latest Rating - Price Target': 14}
    for cell in ws[header_row]:
        cell.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws.column_dimensions[cell.column_letter].width = widths.get(str(cell.value), 12)
    for row in ws.iter_rows(min_row=header_row+1):
        ws.row_dimensions[row[0].row].height = 30
        for cell in row:
            cell.alignment = Alignment(vertical='center', wrap_text=True)
            cell.font = Font(name='Calibri', size=10, color='404040')
    table_ref = f'A{header_row}:{ws.cell(ws.max_row, ws.max_column).coordinate}'
    if ws.max_row > header_row:
        table = Table(displayName=name, ref=table_ref)
        table.tableStyleInfo = TableStyleInfo(name='TableStyleMedium2', showRowStripes=True)
        ws.add_table(table)
    else:
        ws.auto_filter.ref = table_ref


def add_selection_sheet(wb, source, name, candidates, table_name):
    if name in wb.sheetnames:
        raise ValueError(f'Fila {name} exista deja; raportul nu este suprascris.')
    ws = wb.create_sheet(name)
    headers = [cell.value for cell in source[1]]
    ws.append(headers + ['Diferenta pret-minim (USD)', 'Strong Buy + Buy', 'Scor ponderat (1.5 SB + B)',
                         'Diferenta tinta minima-pret (%)', 'Apropiere tinta minima (%)'])
    for target_row, item in enumerate(candidates, 2):
        for col in range(1, len(headers)+1):
            old = source.cell(item['source_row'], col)
            new = ws.cell(target_row, col)
            new.value = (Translator(old.value, origin=old.coordinate).translate_formula(new.coordinate)
                         if old.data_type == 'f' else old.value)
            new._style = copy(old._style)
            new.comment = copy(old.comment)
            if old.hyperlink:
                new.hyperlink = old.hyperlink.target
        if 'Nr.' in headers:
            ws.cell(target_row, headers.index('Nr.')+1, target_row-1)
        ws.cell(target_row, len(headers)+1, item['difference']).number_format = '0.00'
        ws.cell(target_row, len(headers)+2, item['positive'])
        ws.cell(target_row, len(headers)+3, item['score']).number_format = '0.0'
        ws.cell(target_row, len(headers)+4, item['target_gap']).number_format = '0.00%'
        ws.cell(target_row, len(headers)+5, item['target_distance']).number_format = '0.00%'
    style_table(ws, table_name)
    ws['A1'].comment = Comment(RULES, 'Criterii')
    return ws


def compact_report(source_wb):
    wb = Workbook()
    wb.remove(wb.active)
    for index, source in enumerate(source_wb.worksheets, 1):
        ws = wb.create_sheet(source.title)
        headers = [cell.value for cell in source[1]]
        columns = {name: col for col, name in enumerate(headers, 1)}
        ws.append([label for label, _ in OUTPUT_COLUMNS])
        for row_index in range(2, source.max_row+1):
            values = {name: source.cell(row_index, col).value for name, col in columns.items()}
            price = numeric(values.get('Pret actiune'))
            low = numeric(values.get('Minim 52 sapt.'))
            target = numeric(values.get('Tinta medie'))
            counts = [numeric(values.get(name)) for name in ('Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell')]
            total = sum(counts) if all(value is not None for value in counts) else None
            computed = {
                'Distanta fata de minim (%)': price/low-1 if price is not None and low else None,
                'Potential (%)': target/price-1 if target is not None and price else None,
                'Total Analysts': total,
                'Average Analyst Rating': sum((i+1)*value for i, value in enumerate(counts))/total if total else None,
                'Ranking Score': 5*counts[0]+3*counts[1]+counts[2]-2*counts[3]-4*counts[4] if total is not None else None,
            }
            for col, (_, name) in enumerate(OUTPUT_COLUMNS, 1):
                old = source.cell(row_index, columns[name]) if name in columns else None
                value = values.get(name)
                if old is not None and old.data_type == 'f':
                    if name not in computed:
                        raise ValueError(f'Formula nesuportata in coloana {name}.')
                    value = computed[name]
                new = ws.cell(row_index, col, value)
                if old is not None:
                    new.font = copy(old.font)
                    new.fill = copy(old.fill)
                    new.border = copy(old.border)
                    new.alignment = copy(old.alignment)
                    new.protection = copy(old.protection)
                    new.number_format = old.number_format
                    new.comment = copy(old.comment)
                    if old.hyperlink:
                        new.hyperlink = old.hyperlink.target
                if name in ('Distanta fata de minim (%)', 'Potential (%)'):
                    new.number_format = '0.00%'
        if source.title == 'Lista_Filtrata':
            ws.insert_rows(1, 2)
            ws.merge_cells('A1:X1')
            ws['A1'] = LIST_FILTER_RULES
            ws['A1'].font = Font(name='Calibri', size=12, bold=True, color='17365D')
            ws['A1'].alignment = Alignment(vertical='center', wrap_text=True)
            ws.row_dimensions[1].height = 36
            ws.row_dimensions[2].height = 8
            style_table(ws, f'TabelOutput{index}', header_row=3)
            ws.print_title_rows = '1:3'
            ws['C3'].comment = Comment('Date lipsa/invalide excluse. Filtru independent de consens si de Top 5. Underperform <= 2; Hold nu este filtrat.', 'Criterii')
        else:
            style_table(ws, f'TabelOutput{index}')
            ws['A1'].comment = copy(source['A1'].comment)
    return wb


def available_path(directory, stem):
    path = directory / (stem + '.xlsx')
    suffix = 1
    while path.exists():
        path = directory / f'{stem}_{suffix}.xlsx'
        suffix += 1
    return path


def investment_workbook(top, source_path, now):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Top 5 - simulare'
    ws.append(['Nr.', 'Simbol', 'Companie', 'Pret de referinta (USD)', 'Investitie (USD)',
               'Actiuni fractionare', 'Valoare initiala (USD)', 'Profit initial (USD)',
               'Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell', 'Scor ponderat', 'Diferenta pret-minim (USD)',
               'Ora cotatiei din sursa', 'Moneda', 'Tinta minima (USD)',
               'Diferenta tinta minima-pret (%)', 'Apropiere tinta minima (%)'])
    per_position = SIMULATION_CAPITAL / len(top) if top else 0.0
    for index, item in enumerate(top, 1):
        row = index+1
        ws.append([index, item['symbol'], item['Companie'], item['price'], per_position,
                   per_position/item['price'], per_position, 0, item['Strong Buy'], item['Buy'],
                   item['Hold'], item.get('Underperform'), item['Sell'],
                   item['score'], item['difference'], item.get('quote_time'), item['Moneda'],
                   item['target'], item['target_gap'], item['target_distance']])
        for col in (4, 5, 7, 8, 15, 18):
            ws.cell(row, col).number_format = '$#,##0.00'
        ws.cell(row, 6).number_format = '0.00000000'
        for col in (19, 20):
            ws.cell(row, col).number_format = '0.00%'
    style_table(ws, 'TabelInvestitii')
    info = wb.create_sheet('Informatii')
    invested = per_position * len(top)
    for row in [('Camp', 'Valoare'), ('Data simulare', now.isoformat(timespec='seconds')),
                ('Raport sursa', str(source_path.resolve())), ('Criterii', RULES),
                ('Numar pozitii', len(top)), ('Capital initial (USD)', SIMULATION_CAPITAL),
                ('Capital investit (USD)', invested), ('Numerar ramas (USD)', SIMULATION_CAPITAL-invested),
                ('Status', 'SIMULARE; nu sunt trimise ordine si nu sunt cumparate actiuni.'),
                ('Ipoteze', 'Actiuni fractionare; fara comisioane, taxe sau spread. Preturile sunt cele din raportul sursa, nu cotatii live.'),
                ('Rezultat initial', 'Profit/pierdere initiala = 0; nu se proiecteaza randamente viitoare.'),
                ('Acoperire', 'Top 5 din raportul furnizat; un raport limitat/partial nu reprezinta intregul SP500.'),
                ('Avertisment', 'Date informative, nu recomandare de investitie.')]:
        info.append(row)
    info.column_dimensions['A'].width = 28
    info.column_dimensions['B'].width = 110
    return wb


def two_sheet_report(source):
    raw = Workbook()
    ws = raw.active
    ws.title = 'Lista_SP500'
    aliases = {label: name for label, name in OUTPUT_COLUMNS}
    headers = [aliases.get(cell.value, cell.value) for cell in source[1]]
    infer_hold = 'Hold' not in headers
    ws.append(headers + (['Hold'] if infer_hold else []))
    for row_index, row in enumerate(source.iter_rows(min_row=2, values_only=True), 2):
        values = list(row)
        if infer_hold:
            record = dict(zip(headers, values))
            total = numeric(record.get('Total Analysts'))
            counts = [numeric(record.get(name)) for name in ('Strong Buy', 'Buy', 'Underperform', 'Sell')]
            hold = total-sum(counts) if total is not None and all(value is not None for value in counts) else None
            values.append(hold)
        ws.append(values)
        for col in range(1, source.max_column+1):
            ws.cell(row_index, col).number_format = source.cell(row_index, col).number_format
    add_filtered_list(raw, ws)
    compact = compact_report(raw)
    raw.close()
    return compact


def process_report(source_path, copy_report=True, now=None, report_path=None):
    source_path = Path(source_path).resolve()
    now = now or datetime.now().astimezone()
    wb = load_workbook(source_path)
    try:
        if 'Actiuni SP500' not in wb.sheetnames:
            raise ValueError('Raportul nu contine fila Actiuni SP500.')
        source = wb['Actiuni SP500']
        candidates = select_candidates(source)
        headers = [cell.value for cell in source[1]]
        time_col = headers.index('Ora cotatiei (locala)')+1 if 'Ora cotatiei (locala)' in headers else None
        for item in candidates:
            item['quote_time'] = source.cell(item['source_row'], time_col).value if time_col else None
        ranked = sorted(candidates, key=lambda item: (item['target_distance'], -item['score'],
                                                     item['difference'], item['symbol']))
        top = ranked[:5]
        if any(str(item['Moneda']).strip().upper() != 'USD' for item in top):
            raise ValueError('Topul contine cotatii non-USD; este necesar un curs valutar pentru simulare.')

        output = BASE / 'Output'
        output.mkdir(parents=True, exist_ok=True)
        if report_path is not None:
            report_path = Path(report_path).resolve()
        else:
            report_path = available_path(output, source_path.stem + '_improvement') if copy_report else source_path
        investment_dir = BASE / 'Investitii'
        investment_dir.mkdir(parents=True, exist_ok=True)
        investment_path = available_path(investment_dir, now.strftime('%d_%m_%Y_%I-%M%p') + '_top_5_to_invest')
        simulation = investment_workbook(top, source_path, now)
        compact = two_sheet_report(source)
        compact.save(report_path)
        compact.close()
        simulation.save(investment_path)
        simulation.close()
    finally:
        wb.close()
    from dashboard import export_dashboard
    export_dashboard(report_path)
    print(f'Raport filtrat: {report_path}')
    print(f'Eligibile: {len(ranked)}; Top: {", ".join(item["symbol"] for item in top) or "niciuna"}')
    print(f'Simulare: {investment_path}; capital initial: {SIMULATION_CAPITAL:.0f} USD; investit: {SIMULATION_CAPITAL if top else 0:.0f} USD')
    if len(top) < 5:
        print('ATENTIE: mai putin de 5 actiuni eligibile; nu se completeaza cu actiuni care nu respecta filtrul.')
    return report_path, investment_path, ranked
