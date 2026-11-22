'use strict';
/* ================= SP500 data: snapshot, filters, rankings, CSV, Excel import ================= */
const DATA = JSON.parse(document.getElementById('data').textContent);
const num = v => typeof v === 'number' && Number.isFinite(v);
const nf = (v, digits = 2) => num(v) ? v.toLocaleString(I18N.locale, { maximumFractionDigits: digits }) : '—';
const nf1 = v => num(v) ? v.toLocaleString(I18N.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
const pctf = v => num(v) ? nf(v * 100) + '%' : '—';
const usd = v => num(v) ? '$' + nf(v) : '—';
const usd1 = v => num(v) ? '$' + nf1(v) : '—';

/* Excel headers stay as in the workbook; the UI shows an English label that the i18n engine translates. */
const HEADER_EN = {
  'Simbol': 'Symbol', 'Conpanie': 'Company', 'Companie': 'Company', 'Pret actiune': 'Stock price',
  'Min. 52 wk': '52-week low', 'Max.': '52-week high', 'Dist. fata de min. [%]': 'Distance from low [%]',
  'Consens': 'Consensus', 'Tinta medie': 'Mean target', 'Tinta minima': 'Minimum target', 'Tinta maxima': 'Maximum target',
  'Potential (%)': 'Upside (%)'
};
const headerLabel = h => HEADER_EN[h] || h;

/* ---------- filters: every criterion is optional (null = no limit) ---------- */
const DEFAULT_FILTERS = () => ({ distance: 12, analysts: 12, sell: 0, under: 2, hold: 2, positive: null,
  price: [null, null], upside: [null, null], support: [null, null], gap: [null, null], consensus: [], sectors: [], q: '' });
const CONSENSUS = ['BUY', 'HOLD', 'SELL', 'N/A'];
const consensusOf = r => { const c = String(r.Consens ?? '').trim().toUpperCase(); return CONSENSUS.includes(c) ? c : 'N/A'; };
const intOk = v => num(v) && Number.isInteger(v) && v >= 0;
const inRange = (v, [lo, hi], scale = 1) => num(v) && (lo == null || v >= lo / scale - 1e-12) && (hi == null || v <= hi / scale + 1e-12);
const rangeText = ([lo, hi], unit = '') => (lo == null ? '…' : nf(lo) + unit) + ' – ' + (hi == null ? '…' : nf(hi) + unit);
/* key · active · test · chip [english label, data value] */
const CRITERIA = [
  { key: 'distance', on: f => f.distance != null, test: (r, f) => r.price > 0 && r.low > 0 && num(r.distance) && r.distance <= f.distance / 100 + 1e-12, chip: f => ['Distance from low ≤', nf(f.distance) + '%'] },
  { key: 'analysts', on: f => f.analysts != null, test: (r, f) => intOk(r.total) && r.total >= f.analysts, chip: f => ['Total Analysts ≥', f.analysts] },
  { key: 'sell', on: f => f.sell != null, test: (r, f) => intOk(r.sell) && r.sell <= f.sell, chip: f => ['Sell ≤', f.sell] },
  { key: 'under', on: f => f.under != null, test: (r, f) => intOk(r.under) && r.under <= f.under, chip: f => ['Underperform ≤', f.under] },
  { key: 'hold', on: f => f.hold != null, test: (r, f) => intOk(r.hold) && r.hold <= f.hold, chip: f => ['Hold ≤', f.hold] },
  { key: 'positive', on: f => f.positive != null, test: (r, f) => intOk(r.sb) && intOk(r.buy) && r.sb + r.buy >= f.positive, chip: f => ['Strong Buy + Buy ≥', f.positive] },
  { key: 'price', on: f => f.price.some(v => v != null), test: (r, f) => inRange(r.price, f.price), chip: f => ['Price (USD)', rangeText(f.price)] },
  { key: 'upside', on: f => f.upside.some(v => v != null), test: (r, f) => inRange(r.upside, f.upside, 100), chip: f => ['Upside to mean target (%)', rangeText(f.upside, '%')] },
  { key: 'support', on: f => f.support.some(v => v != null), test: (r, f) => inRange(r.support, f.support, 100), chip: f => ['Buy + Strong Buy (%)', rangeText(f.support, '%')] },
  { key: 'gap', on: f => f.gap.some(v => v != null), test: (r, f) => inRange(r.gap, f.gap, 100), chip: f => ['Min. target proximity (%)', rangeText(f.gap, '%')] },
  { key: 'consensus', on: f => f.consensus.length > 0, test: (r, f) => f.consensus.includes(consensusOf(r)), chip: f => ['Consensus', f.consensus.join(', ')] },
  { key: 'sectors', on: f => f.sectors.length > 0, test: (r, f) => f.sectors.includes(r.sector), chip: f => ['Sectors', f.sectors.length === 1 ? f.sectors[0] : String(f.sectors.length)] },
  { key: 'q', on: f => !!f.q.trim(), test: (r, f) => (r.symbol + ' ' + r.company).toLowerCase().includes(f.q.trim().toLowerCase()), chip: null }
];
const PRESETS = [
  { id: 'default', short: 'Default', label: 'Default (Hold ≤ 2)', f: DEFAULT_FILTERS },
  { id: 'excel', short: 'Excel', label: 'As in Excel', f: () => ({ ...DEFAULT_FILTERS(), hold: null }) },
  { id: 'top5', short: 'Top 5', label: 'As in Top 5 Investitii', ranking: 'proximity', f: () => ({ ...DEFAULT_FILTERS(), distance: null, analysts: null, under: null, sell: 0, hold: 1, positive: 15, consensus: ['BUY'], gap: [0, null] }) }
];
const FILTERS_KEY = 'dashivo-sp500-filters', PRESETS_KEY = 'dashivo-sp500-presets';
const store = {
  get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { } }
};
/* merge a stored/preset filter object onto the defaults, dropping anything malformed */
function cleanFilters(raw) {
  const f = DEFAULT_FILTERS();
  if (!raw || typeof raw !== 'object') return f;
  for (const k of ['distance', 'analysts', 'sell', 'under', 'hold', 'positive']) if (raw[k] === null || (num(raw[k]) && raw[k] >= 0)) f[k] = raw[k];
  for (const k of ['price', 'upside', 'support', 'gap']) if (Array.isArray(raw[k]) && raw[k].length === 2) f[k] = raw[k].map(v => num(v) ? v : null);
  if (Array.isArray(raw.consensus)) f.consensus = raw.consensus.filter(c => CONSENSUS.includes(c));
  if (Array.isArray(raw.sectors)) f.sectors = raw.sectors.filter(x => typeof x === 'string');
  if (typeof raw.q === 'string') f.q = raw.q;
  return f;
}
const saved = store.get(FILTERS_KEY, null);
const UI = {
  f: cleanFilters(saved?.f), ranking: saved?.ranking in { proximity: 1, support: 1, weighted: 1, upside: 1 } ? saved.ranking : 'proximity',
  bad: new Set(), sort: { key: null, dir: 1 }, uq: '', usector: '', usort: { key: null, dir: 1 }
};
const saveFilters = debounce(() => store.set(FILTERS_KEY, { f: UI.f, ranking: UI.ranking }), 300);
const userPresets = () => store.get(PRESETS_KEY, []).filter(p => p && typeof p.name === 'string');
function applyPreset(f, ranking) { UI.f = cleanFilters(f); if (ranking) UI.ranking = ranking; UI.bad.clear(); saveFilters(); }
const sameFilters = (a, b) => JSON.stringify({ ...a, q: '' }) === JSON.stringify({ ...b, q: '' });

const universe = () => DATA.allItems || DATA.items;
/* ---------- live prices (display only: filters and rankings keep the report price) ---------- */
const LIVE_COL = 'Live price', LIVE_PCT_COL = 'Live vs report (%)';
const LIVE = { at: null, prices: {}, loading: false, error: '' };
function applyLive() {
  for (const r of universe()) {
    const p = LIVE.prices[r.symbol];
    r[LIVE_COL] = num(p) ? p : null;
    r[LIVE_PCT_COL] = num(p) && r.price > 0 ? p / r.price - 1 : null;
  }
}
/* the Excel columns, plus the two live columns right after the report price when the server is available */
function tableHeaders() {
  if (!window.dashboardRunToken) return DATA.headers;
  applyLive();
  const out = DATA.headers.filter(c => c !== LIVE_COL && c !== LIVE_PCT_COL), at = out.indexOf('Pret actiune') + 1 || 1;
  out.splice(at, 0, LIVE_COL, LIVE_PCT_COL);
  return out;
}
const sectors = () => [...new Set(universe().map(r => r.sector))].sort();
const activeCriteria = (f = UI.f) => CRITERIA.filter(c => c.on(f));
/* null = some input is invalid (the page shows the error and keeps the previous view) */
function selection(f = UI.f) {
  if (UI.bad.size) return null;
  const act = activeCriteria(f);
  return universe().filter(r => act.every(c => c.test(r, f)));
}
/* for each active criterion: how many stocks fail only that one (they would come back without it) */
function excludedBy(f = UI.f) {
  const act = activeCriteria(f), out = Object.fromEntries(act.map(c => [c.key, 0]));
  for (const r of universe()) {
    let miss = null, n = 0;
    for (const c of act) if (!c.test(r, f)) { miss = c.key; if (++n > 1) break; }
    if (n === 1) out[miss]++;
  }
  return out;
}
const criteriaChips = (f = UI.f) => activeCriteria(f).filter(c => c.chip).map(c => { const [label, value] = c.chip(f); return h('span', { class: 'chip' }, label, ' ', h('span', { class: 'notr' }, String(value))); });

const RANKINGS = {
  proximity: { label: 'Proximity to minimum target', key: 'gap', asc: true },
  support: { label: 'Buy + Strong Buy share', key: 'support' },
  weighted: { label: 'Score 1.5 × Strong Buy + Buy', key: 'weighted' },
  upside: { label: 'Upside to mean target', key: 'upside' }
};
function ranked(rows, mode = UI.ranking) {
  const R = RANKINGS[mode], k = R.key;
  return rows.filter(r => num(r[k])).sort((a, b) => (R.asc ? a[k] - b[k] : b[k] - a[k]) || (b.weighted ?? 0) - (a.weighted ?? 0) || a.symbol.localeCompare(b.symbol));
}
function aggregate(rows) {
  const valid = rows.filter(r => num(r.support)), ups = rows.filter(r => num(r.upside));
  const total = valid.reduce((a, r) => a + r.total, 0);
  return {
    support: valid.length && total ? valid.reduce((a, r) => a + r.sb + r.buy, 0) / total : null,
    upside: ups.length ? ups.reduce((a, r) => a + r.upside, 0) / ups.length : null,
    issues: rows.flatMap(r => r.issues.map(i => [r.symbol, i]))
  };
}
function sortRows(rows, sort) {
  if (!sort.key) return rows;
  const k = sort.key;
  return [...rows].sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    return sort.dir * (num(x) && num(y) ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }));
  });
}
function exportCsv(rows, part) {
  const safe = v => { let s = String(v ?? ''); if (/^[=+@-]/.test(s) && !num(v)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const cols = tableHeaders(), text = '\ufeff' + [cols, ...rows.map(r => cols.map(h => r[h]))].map(row => row.map(safe).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: fileName(part, 'csv') }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- analysis of an imported workbook (mirrors dashboard.analyze in Python) ---------- */
function analyzeImported(record) {
  const r = { ...record }, fields = { price: 'Pret actiune', low: 'Min. 52 wk', high: 'Max.', minTarget: 'Tinta minima', meanTarget: 'Tinta medie', maxTarget: 'Tinta maxima', sb: 'Strong Buy', buy: 'Buy', under: 'Underperform', sell: 'Sell', total: 'Total Analysts' };
  for (const [key, col] of Object.entries(fields)) r[key] = num(record[col]) ? record[col] : null;
  r.symbol = String(record.Simbol ?? ''); r.company = String(record.Conpanie ?? record.Companie ?? ''); r.sector = String(record.Sector || 'N/A');
  const counts = [r.sb, r.buy, r.under, r.sell, r.total], valid = counts.every(v => num(v) && v >= 0 && Number.isInteger(v));
  r.hold = Object.hasOwn(record, 'Hold') ? (num(record.Hold) ? record.Hold : null) : valid ? r.total - r.sb - r.buy - r.under - r.sell : null;
  if (r.hold !== null && (!Number.isInteger(r.hold) || !valid || r.hold + r.sb + r.buy + r.under + r.sell !== r.total)) r.hold = null;
  if (!Object.hasOwn(record, 'Hold')) r.Hold = r.hold;
  if (r.hold < 0) r.hold = null;
  r.support = valid && r.hold !== null && r.total > 0 ? (r.sb + r.buy) / r.total : null;
  r.weighted = valid && r.hold !== null ? 1.5 * r.sb + r.buy : null;
  const ratio = v => r.price > 0 && v > 0 && Number.isFinite(v / r.price) ? v / r.price - 1 : null;
  r.gap = ratio(r.minTarget) === null ? null : Math.abs(ratio(r.minTarget)); r.upside = ratio(r.meanTarget);
  r.distance = r.price > 0 && r.low > 0 ? r.price / r.low - 1 : null;
  r.issues = [];
  if (r.hold === null) r.issues.push('Recommendations missing or inconsistent; the distribution cannot be calculated.');
  if ([r.minTarget, r.meanTarget, r.maxTarget].some(v => !num(v) || v <= 0)) r.issues.push('One or more targets are missing or invalid.');
  else if (!(r.minTarget <= r.meanTarget && r.meanTarget <= r.maxTarget)) r.issues.push('The order minimum ≤ mean ≤ maximum target is not respected.');
  if (!(r.price > 0)) r.issues.push('Price missing or invalid.');
  return r;
}

/* ---------- minimal XLSX reader (local, no server) ---------- */
function xmlDoc(text) { const doc = new DOMParser().parseFromString(text, 'application/xml'); if (doc.getElementsByTagName('parsererror').length) throw Error('Invalid XML inside the Excel file.'); return doc; }
const xnodes = (root, tag) => Array.from(root.getElementsByTagNameNS('*', tag));
async function openZip(buffer) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer); let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) { if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; } }
  if (end < 0) throw Error('The file is not a valid XLSX archive.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error('Multipart archives are not supported.');
  const count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true);
  if (count === 65535 || offset === 0xffffffff) throw Error('ZIP64 format is not supported.');
  let cursor = offset, total = 0; const entries = new Map(), decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw Error('Invalid ZIP index.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), size = view.getUint32(cursor + 20, true), raw = view.getUint32(cursor + 24, true), nameLen = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true), local = view.getUint32(cursor + 42, true);
    if (flags & 1) throw Error('Encrypted Excel files are not supported.');
    total += raw; if (raw > 32 * 1024 * 1024 || total > 80 * 1024 * 1024) throw Error('Excel file too large for local import (max. 80 MB uncompressed).');
    entries.set(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen)), { method, size, raw, local }); cursor += 46 + nameLen + extra + comment;
  }
  return {
    has: name => entries.has(name),
    async text(name) {
      const e = entries.get(name); if (!e) throw Error('Missing XLSX part: ' + name);
      if (view.getUint32(e.local, true) !== 0x04034b50) throw Error('Invalid ZIP entry.');
      const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
      if (start + e.size > bytes.length) throw Error('Truncated XLSX file.');
      let data = bytes.slice(start, start + e.size);
      if (e.method === 8) { let stream; try { stream = new DecompressionStream('deflate-raw'); } catch { throw Error('Incompatible browser. Use a recent version of Chrome or Edge.'); } data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer()); }
      else if (e.method !== 0) throw Error('Unsupported ZIP compression.');
      if (data.length !== e.raw) throw Error('Inconsistent ZIP size.');
      return decoder.decode(data);
    }
  };
}
function parseSheet(text, shared) {
  const doc = xmlDoc(text), rows = [];
  for (const row of xnodes(doc, 'row')) {
    const cells = [];
    for (const c of xnodes(row, 'c')) {
      const match = (c.getAttribute('r') || '').match(/^([A-Z]+)/); if (!match) continue;
      let col = 0; for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64;
      if (col > 256) throw Error('Too many columns in the Excel file.');
      const type = c.getAttribute('t'), v = xnodes(c, 'v')[0]?.textContent; let value = null;
      if (type === 'inlineStr') value = xnodes(c, 't').map(n => n.textContent).join('');
      else if (type === 's') value = shared[Number(v)] ?? null;
      else if (type === 'str') value = v ?? null;
      else if (v !== undefined && v !== '' && type !== 'e') value = Number.isFinite(Number(v)) ? Number(v) : v;
      cells[col - 1] = value;
    }
    rows.push(cells);
  }
  return rows;
}
function recordsFromRows(rows) {
  const index = rows.findIndex(row => row.includes('Simbol') && row.includes('Pret actiune'));
  if (index < 0) throw Error('Header Simbol / Pret actiune is missing.');
  const headers = rows[index].map(v => v ?? '').filter(Boolean);
  if (![23, 24].includes(headers.length)) throw Error('The 24 SP500 columns are required (or the legacy 23-column format).');
  if (!headers.includes('Hold')) headers.splice(headers.indexOf('Buy') + 1, 0, 'Hold');
  const required = ['Tinta minima', 'Tinta medie', 'Strong Buy', 'Buy', 'Underperform', 'Sell', 'Total Analysts', 'Min. 52 wk'];
  if (required.some(x => !headers.includes(x))) throw Error('Required columns are missing from Lista_Filtrata.');
  const records = rows.slice(index + 1).filter(row => row[rows[index].indexOf('Simbol')]).map(row => Object.fromEntries(rows[index].map((x, i) => [x, row[i] ?? null]).filter(([x]) => x)));
  return { headers, records };
}
/* progress(value 0..100, englishMessage) */
async function readWorkbook(file, progress) {
  if (!/\.xlsx$/i.test(file.name)) throw Error('Select an .xlsx file.');
  if (file.size > 20 * 1024 * 1024) throw Error('File too large (max. 20 MB).');
  progress(5, 'Reading file…'); const zip = await openZip(await file.arrayBuffer());
  progress(15, 'Opening Excel…');
  const wb = xmlDoc(await zip.text('xl/workbook.xml')), rels = xmlDoc(await zip.text('xl/_rels/workbook.xml.rels'));
  const relationMap = new Map(xnodes(rels, 'Relationship').filter(n => n.getAttribute('TargetMode') !== 'External').map(n => [n.getAttribute('Id'), n.getAttribute('Target')]));
  const sheets = new Map();
  for (const s of xnodes(wb, 'sheet')) { const target = relationMap.get(s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')); if (target) sheets.set(s.getAttribute('name'), new URL(target, 'https://local.invalid/xl/workbook.xml').pathname.slice(1)); }
  if (!sheets.has('Lista_Filtrata')) throw Error('The Excel file must contain the Lista_Filtrata sheet.');
  progress(35, 'Reading text and columns…');
  const shared = zip.has('xl/sharedStrings.xml') ? xnodes(xmlDoc(await zip.text('xl/sharedStrings.xml')), 'si').map(si => xnodes(si, 't').map(n => n.textContent).join('')) : [];
  const filteredRows = parseSheet(await zip.text(sheets.get('Lista_Filtrata')), shared);
  const bulkRows = sheets.has('Lista_SP500') ? parseSheet(await zip.text(sheets.get('Lista_SP500')), shared) : null;
  const parsed = recordsFromRows(bulkRows || filteredRows);
  progress(60, 'Analyzing recommendations and targets…');
  const items = [];
  for (let i = 0; i < parsed.records.length; i++) {
    items.push(analyzeImported(parsed.records[i]));
    if (i % 100 === 0) { progress(60 + 20 * (i + 1) / Math.max(1, parsed.records.length), 'Analyzing recommendations and targets…'); await new Promise(r => setTimeout(r, 0)); }
  }
  const match = file.name.match(/SP500_(\d{2}_\d{2}_\d{4}_\d{2}-\d{2}-\d{2})/);
  return {
    source: file.name, sourceDate: match ? match[1].replaceAll('_', ' ') : 'Unknown', generated: new Date().toISOString(),
    criteria: String(filteredRows[0]?.[0] ?? ''), headers: parsed.headers, items, allItems: items,
    fullUniverse: !!bulkRows, bulkCount: bulkRows ? items.length : null
  };
}
