'use strict';
/* ================= SP500 pages ================= */
Object.assign(ICONS, {
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 15h18M9 4v16"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.6v.4"/>',
  file: '<path d="M14 3H6.5A2.5 2.5 0 004 5.5v13A2.5 2.5 0 006.5 21h11a2.5 2.5 0 002.5-2.5V9z"/><path d="M14 3v6h6"/>'
});
const kpi = (label, value, sub, cls = '') => h('div', { class: 'card kpi ' + cls }, h('div', { class: 'l' }, label), h('div', { class: 'v notr' }, value), h('div', { class: 's' }, sub));
const dataText = v => h('span', { class: 'notr' }, v);

/* ---------- reusable: one table cell (Excel value, live price, Invest button on the symbol) ---------- */
function dataCell(r, c, first) {
  const v = r[c];
  if (c === LIVE_PCT_COL) return h('td', { class: 'num ' + (num(v) && v !== 0 ? (v > 0 ? 'positive' : 'negative') : '') }, num(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v) * 100) + '%' : '—');
  if (c === LIVE_COL) return h('td', { class: 'num live' }, num(v) ? nf(v) : '—');
  if (c === first) return h('td', { class: 'sym-cell' }, logoEl(r.symbol, 22), h('span', null, v ?? '—'), investButton(r));
  if (c === 'Sector') return h('td', null, sectorIcon(v, 14), ' ', v ?? '—');
  return h('td', { class: num(v) ? 'num' : '' }, c.includes('%') ? pctf(v) : num(v) ? nf(v) : (v ?? '—'));
}
const liveStatus = () => window.dashboardRunToken ? h('span', { class: 'muted small live-status notr' },
  LIVE.loading ? tr('Loading live prices…') : LIVE.at ? tr('Live prices') + ': ' + new Date(LIVE.at).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '', LIVE.error ? ' · ' + tr(LIVE.error) : '') : null;

/* ---------- reusable: sortable table of Excel columns ---------- */
function dataTable(rows, sort, onSort) {
  if (!rows.length) return h('div', { class: 'empty' }, 'No stocks in the selection.');
  const cols = tableHeaders();
  const head = h('tr', null, cols.map(c => h('th', { class: 'srt', 'aria-sort': sort.key === c ? (sort.dir === 1 ? 'ascending' : 'descending') : null, onclick: () => onSort(c) },
    headerLabel(c), sort.key === c ? (sort.dir === 1 ? ' ↑' : ' ↓') : '')));
  return h('div', { class: 'tbl-wrap', 'data-keep': 'tbl' }, h('table', { class: 'sp-tbl' }, h('thead', null, head), h('tbody', { class: 'notr' }, sortRows(rows, sort).map(r => h('tr', null, cols.map(c => dataCell(r, c, cols[0])))))));
}
const toggleSort = (sort, key) => { sort.dir = sort.key === key ? -sort.dir : 1; sort.key = key; };

/* ---------- compact stock card (Top 10, portfolio hover) ---------- */
function stockCard(r, i) {
  const live = LIVE.prices[r.symbol], liveChg = num(live) && r.price > 0 ? live / r.price - 1 : null;
  const stat = (label, value, cls, tip) => hoverTip(h('div', { class: 'has-tip' }, h('small', null, label), h('b', { class: 'notr ' + (cls || '') }, value)), tip);
  const counts = 'SB ' + nf(r.sb) + ' + Buy ' + nf(r.buy) + ' + Hold ' + nf(r.hold) + ' + Und. ' + nf(r.under) + ' + Sell ' + nf(r.sell);
  const scoreTip = () => tipHtml('Weighted score', [tipRow('Formula', esc(tr('1.5 × Strong Buy + Buy'))), tipRow('Calculation', '1.5 × ' + nf(r.sb) + ' + ' + nf(r.buy) + ' = <b>' + nf(r.weighted) + '</b>'),
    tipRow('Buy + Strong Buy share', pctf(r.support)), tipRow('Ranking', esc(tr(RANKINGS[UI.ranking].label)) + ' · #' + (i + 1))],
    'Default order: proximity to the minimum target ascending, then this score descending, then the distance from the 52-week low, then the symbol.');
  const rating = hoverTip(h('span', { class: 'rating-link', onmouseenter: () => loadRatings(r.symbol) }, dataText((r['Latest Rating - Date'] || 'N/A') + ' · ' + (r['Latest Rating - Rating'] || 'N/A'))), () => ratingTip(r));
  return h('article', { class: 'card stock c4' },
    h('div', { class: 'st-head' }, logoEl(r.symbol, 38),
      h('div', { class: 'st-id' }, h('div', { class: 'st-sym' }, h('span', { class: 'st-rank' }, '#' + (i + 1)), h('span', { class: 'notr' }, r.symbol)),
        h('div', { class: 'muted small notr st-co' }, r.company), sectorChip(r.sector)),
      h('div', { class: 'st-px' },
        h('div', { class: 'px-row' }, h('small', { class: 'muted' }, 'Report'), h('b', { class: 'notr' }, usd1(r.price))),
        h('div', { class: 'px-row live' }, h('small', null, h('i', { class: 'live-dot' + (LIVE.loading ? ' busy' : '') }), 'Live'),
          h('b', { class: 'notr ' + (liveChg == null ? '' : liveChg >= 0 ? 'positive' : 'negative') }, num(live) ? usd1(live) : '—')),
        h('small', { class: 'notr muted' }, num(liveChg) ? (liveChg >= 0 ? '+' : '−') + nf(Math.abs(liveChg) * 100, 1) + '% · ' + new Date(LIVE.at).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' }) : ''))),
    rangeAxis(r),
    recBar(r),
    h('div', { class: 'st-stats' },
      stat('Analysts', nf(r.total), '', () => tipHtml('Total Analysts', [tipRow('Calculation', esc(counts) + ' = <b>' + nf(r.total) + '</b>')], 'Recommendations from Yahoo Finance; Underperform = Yahoo sell, Sell = Yahoo strong sell.')),
      stat('To min. target', pctf(r.gap), '', () => tipHtml('Min. target proximity', [tipRow('Formula', esc(tr('|Min. target / Price − 1|'))), tipRow('Calculation', '|' + usd(r.minTarget) + ' / ' + usd(r.price) + ' − 1| = <b>' + pctf(r.gap) + '</b>'),
        tipRow('Position', esc(tr(r.minTarget >= r.price ? 'the minimum target is above the price' : 'the minimum target is below the price')))], 'Lower = the price is closer to the most pessimistic analyst target.')),
      stat('Upside', pctf(r.upside), r.upside < 0 ? 'negative' : 'positive', () => tipHtml('Upside to mean target', [tipRow('Formula', esc(tr('Mean target / Price − 1'))), tipRow('Calculation', usd(r.meanTarget) + ' / ' + usd(r.price) + ' − 1 = <b>' + pctf(r.upside) + '</b>'),
        tipRow('Target range', usd(r.minTarget) + ' – ' + usd(r.maxTarget))], 'Analyst targets are 12-month opinions, not guaranteed returns.')),
      stat('Above low', pctf(r.distance), '', () => tipHtml('From 52-week low', [tipRow('Formula', esc(tr('Price / 52-week low − 1'))), tipRow('Calculation', usd(r.price) + ' / ' + usd(r.low) + ' − 1 = <b>' + pctf(r.distance) + '</b>'),
        tipRow('52-week range', usd(r.low) + ' – ' + usd(r.high ?? r['Max.']))]))),
    h('div', { class: 'st-foot muted small' }, icon('book', 13), rating, h('span', { class: 'sp' }),
      hoverTip(h('span', { class: 'has-tip' }, h('span', null, 'Score'), ' ', dataText(nf(r.weighted))), scoreTip), investButton(r)),
    r.issues.length ? h('div', { class: 'warning' }, r.issues.map(t => h('div', null, t))) : null);
}

const Views = {};

/* ---------- Sector analysis: whole reported S&P 500 universe, independent of active Top 10 filters ---------- */
const SECTOR_PAGE = { open: null, sort: { key: 'count', dir: -1 }, company: null, csort: { key: 'weighted', dir: -1 } };
const sectorStats = rows => {
  const valid = rows.filter(r => num(r.support) && num(r.total) && r.total > 0);
  const live = rows.map(r => num(LIVE.prices[r.symbol]) && r.price > 0 ? LIVE.prices[r.symbol] / r.price - 1 : null).filter(num);
  const ups = rows.map(r => r.upside).filter(num), gaps = rows.map(r => r.gap).filter(num);
  const recTotal = valid.reduce((a, r) => a + r.total, 0), buy = valid.reduce((a, r) => a + r.sb + r.buy, 0);
  const counts = ['sb', 'buy', 'hold', 'under', 'sell'].map(k => valid.reduce((a, r) => a + (num(r[k]) ? r[k] : 0), 0));
  return { count: rows.length, live: avgNumber(live), liveCount: live.length, support: recTotal ? buy / recTotal : null,
    consensus: counts, analysts: recTotal, upside: avgNumber(ups), upsideCount: ups.length, gap: avgNumber(gaps), gapCount: gaps.length };
};
const avgNumber = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function sectorRows() {
  const all = universe(), names = [...new Set(all.map(r => r.sector).filter(s => s && s !== 'N/A'))];
  return names.map(name => { const rows = all.filter(r => r.sector === name); return { name, rows, ...sectorStats(rows) }; });
}
function sectorConsensusTip(s) {
  const labels = ['Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell'];
  return tipHtml(s.name + ' · Analyst consensus', [tipRow('Analysts', nf(s.analysts)), ...labels.map((name, i) => tipRow(name, nf(s.consensus[i])))], 'Aggregated counts across all stocks with valid analyst recommendation data in this sector.');
}
/* ---------- sector drill-down: the companies of a sector, then one company's detail ---------- */
const sectorLive = r => num(LIVE.prices[r.symbol]) && r.price > 0 ? LIVE.prices[r.symbol] / r.price - 1 : null;
const SECTOR_COMPANY_COLS = [['symbol', 'Company'], ['price', 'Price'], ['live', 'Live vs report'], ['consensus', 'Consensus'], ['support', 'Buy + SB'], ['total', 'Analysts'], ['upside', 'Upside'], ['gap', 'Min-target proximity']];
function sectorCompanyValue(r, key) { return key === 'live' ? sectorLive(r) : key === 'consensus' ? consensusOf(r) : key === 'symbol' ? r.symbol : r[key]; }
/* the verdicts the dashboard already computes for any stock; each one stays out until its data has loaded */
function companyVerdicts(r) {
  loadSimulations(); if (!INTRINSIC.loaded) ivLoad();
  const chip = (label, vote, text, title) => h('div', { class: 'cv-item' }, h('small', null, tr(label)), h('span', { class: 'tech-verdict agent-' + (vote > 0 ? 'good' : vote < 0 ? 'bad' : 'mid'), title: title || '' }, text));
  const wait = label => h('div', { class: 'cv-item' }, h('small', null, tr(label)), h('span', { class: 'muted small' }, tr('Loading…')));
  const none = label => h('div', { class: 'cv-item' }, h('small', null, tr(label)), h('span', { class: 'muted small' }, tr('Unavailable')));
  const t = SIM_VIEW.market ? techAnalyse(techSeries(SIM_VIEW.market, r.symbol)) : undefined;
  const sources = INTRINSIC.data?.sources || {};
  const f = INTRINSIC.loaded ? fundAnalyse(r, ivLookup(sources.zyberno?.rows, r.symbol), ivLookup(sources.equityRank?.rows, r.symbol)) : undefined;
  const est = INTRINSIC.loaded ? ivEstimates(r, sources) : undefined;
  return h('div', { class: 'cv-grid' },
    t === undefined ? wait('Technical') : !t || t.verdict === 'unknown' ? none('Technical')
      : chip('Technical', t.verdict === 'bullish' ? 1 : t.verdict === 'bearish' ? -1 : 0, tr(TECH_LABELS[t.verdict]) + (t.rsi != null ? ' · RSI ' + nf(t.rsi, 0) : ''), tr(techConclusion(t))),
    f === undefined ? wait('Fundamentals') : !f || f.verdict === 'unknown' ? none('Fundamentals')
      : chip('Fundamentals', f.verdict === 'strong' ? 1 : f.verdict === 'weak' ? -1 : 0, tr(FUND_LABELS[f.verdict]) + (f.pe ? ' · P/E ' + nf(f.pe, 1) : f.loss ? ' · ' + tr('Loss') : ''), tr(fundConclusion(f))),
    est === undefined ? wait('Fair value') : est.n < 2 ? none('Fair value')
      : chip('Fair value', est.upside >= .15 ? 1 : est.upside <= -.15 ? -1 : 0, usd1(est.median) + ' · ' + signedPct(est.upside), est.list.map(x => x.source + ' ' + usd1(x.value)).join(' · ')));
}
function companyDetail(r, sector) {
  return h('div', { class: 'company-detail' },
    h('div', { class: 'cd-card' }, stockCard({ ...r, issues: r.issues || [] }, 0)),
    h('div', { class: 'cd-side' },
      h('div', { class: 'up' }, tr('Analyses')), companyVerdicts(r),
      h('div', { class: 'row cd-actions' },
        typeof investButton === 'function' ? investButton(r) : null,
        h('a', { class: 'etoro-open', href: etoroAssetUrl(r.symbol), target: '_blank', rel: 'noopener noreferrer' }, 'eToro ↗'),
        btn('Filter this sector in Top 10 [filtered]', 'filter', () => { UI.f.sectors = [sector]; saveFilters(); App.go('top10'); }, 'sm ghost')),
      h('p', { class: 'muted small' }, tr('Click the company again to close. Hover a verdict for the reason; the pages Technical, Fundamentals and Fair value explain each method.'))));
}
function sectorCompanies(sector) {
  const ks = SECTOR_PAGE.csort, rows = [...sector.rows].sort((a, b) => {
    const x = sectorCompanyValue(a, ks.key), y = sectorCompanyValue(b, ks.key);
    if (x == null || x === 'N/A') return 1; if (y == null || y === 'N/A') return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * ks.dir || a.symbol.localeCompare(b.symbol);
  });
  const head = h('tr', null, SECTOR_COMPANY_COLS.map(([key, title]) => h('th', { class: 'srt', onclick: e => { e.stopPropagation(); SECTOR_PAGE.csort = { key, dir: ks.key === key ? -ks.dir : key === 'symbol' || key === 'consensus' ? 1 : -1 }; App.render(); } },
    tr(title), ks.key === key ? (ks.dir === 1 ? ' ↑' : ' ↓') : '')));
  const body = [];
  rows.forEach(r => {
    const live = sectorLive(r), open = SECTOR_PAGE.company === r.symbol;
    body.push(h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: () => { SECTOR_PAGE.company = open ? null : r.symbol; App.render(); } },
      h('td', { class: 'sym-cell' }, logoEl(r.symbol, 22), h('div', null, h('b', { class: 'notr' }, r.symbol), h('div', { class: 'muted small notr' }, r.company))),
      h('td', { class: 'notr' }, usd1(r.price), num(LIVE.prices[r.symbol]) ? h('div', { class: 'muted small' }, tr('Live') + ' ' + usd1(LIVE.prices[r.symbol])) : null),
      h('td', { class: 'notr ' + (live == null ? '' : live >= 0 ? 'positive' : 'negative') }, signedSector(live)),
      h('td', { class: 'notr' }, consensusOf(r)), h('td', { class: 'notr' }, pctf(r.support)), h('td', { class: 'notr' }, nf(r.total)),
      h('td', { class: 'notr ' + (r.upside < 0 ? 'negative' : r.upside > 0 ? 'positive' : '') }, pctf(r.upside)), h('td', { class: 'notr' }, pctf(r.gap))));
    if (open) body.push(h('tr', { class: 'company-open' }, h('td', { colspan: SECTOR_COMPANY_COLS.length }, companyDetail(r, sector.name))));
  });
  return h('div', { class: 'sector-companies' },
    h('div', { class: 'sc-head' }, h('b', null, sector.name + ' · ' + sector.count + ' ' + tr('companies')), h('span', { class: 'muted small' }, tr('Click a company for its detail; click the sector row again to close.'))),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl sc-tbl' }, h('thead', null, head), h('tbody', null, body))));
}
Views.sectors = () => {
  const sectors = sectorRows();
  const sorted = [...sectors].sort((a, b) => {
    const x = a[SECTOR_PAGE.sort.key], y = b[SECTOR_PAGE.sort.key];
    return x == null ? 1 : y == null ? -1 : SECTOR_PAGE.sort.dir * (x - y) || a.name.localeCompare(b.name);
  });
  const choose = s => { SECTOR_PAGE.open = SECTOR_PAGE.open === s.name ? null : s.name; SECTOR_PAGE.company = null; App.render(); };
  const columns = [['name','Sector'],['count','Companies'],['live','Avg. live vs report'],['support','Buy + Strong Buy'],['upside','Avg. upside'],['gap','Avg. min-target proximity']];
  const table = h('div', { class: 'tbl-wrap sector-table' }, h('table', { class: 'sp-tbl' },
    h('thead', null, h('tr', null, columns.map(([key, title]) => h('th', { class: 'srt', onclick: () => { SECTOR_PAGE.sort = { key, dir: SECTOR_PAGE.sort.key === key ? -SECTOR_PAGE.sort.dir : key === 'name' ? 1 : -1 }; App.render(); } }, title, SECTOR_PAGE.sort.key === key ? (SECTOR_PAGE.sort.dir === 1 ? ' ↑' : ' ↓') : '')))),
    h('tbody', null, sorted.flatMap(s => [h('tr', { class: 'sector-row' + (SECTOR_PAGE.open === s.name ? ' selected' : ''), onclick: () => choose(s) },
      h('td', null, sectorIcon(s.name, 17), ' ', h('b', { class: 'notr' }, s.name)),
      h('td', { class: 'notr' }, nf(s.count)),
      h('td', { class: 'notr ' + (s.live == null ? '' : s.live >= 0 ? 'positive' : 'negative') }, s.live == null ? '—' : signedSector(s.live), h('small', { class: 'muted' }, ' · ' + s.liveCount + ' ' + tr('with live prices'))),
      h('td', null, hoverTip(h('span', { class: 'notr' }, pctf(s.support)), () => sectorConsensusTip(s))),
      h('td', { class: 'notr ' + (s.upside == null ? '' : s.upside >= 0 ? 'positive' : 'negative') }, pctf(s.upside)),
      h('td', { class: 'notr' }, pctf(s.gap))), ...(SECTOR_PAGE.open === s.name ? [h('tr', { class: 'sector-open' }, h('td', { colspan: columns.length }, sectorCompanies(s)))] : [])]))));
  const metricCards = card('Sector comparison', 'All reported S&P 500 companies; click a sector to see its companies, then a company for its detail. Live change = current quote vs the source report price, not a time-period return.', table, null, 'c12');
  const charts = h('div', { class: 'grid mt' },
    card('Live change by sector', 'Average of available live quote / report price − 1', barList([...sectors].sort((a,b) => (b.live ?? -Infinity) - (a.live ?? -Infinity)).map(s => ({ label: s.name, value: (s.live ?? 0) * 100, color: s.live < 0 ? 'var(--bad)' : 'var(--good)', tip: tipHtml(s.name, [tipRow('Companies', nf(s.count)), tipRow('Average change', signedSector(s.live)), tipRow('Live quotes included', nf(s.liveCount))]) })), { fmt: v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 1) + '%' }), null, 'c7'),
    card('Analyst upside', 'Simple mean of report upside to mean analyst target; not a forecast return', barList([...sectors].sort((a,b) => (b.upside ?? -Infinity) - (a.upside ?? -Infinity)).map(s => ({ label: s.name, value: (s.upside ?? 0) * 100, color: s.upside < 0 ? 'var(--bad)' : 'var(--good)', tip: tipHtml(s.name, [tipRow('Companies with valid target', nf(s.upsideCount)), tipRow('Average upside', pctf(s.upside))]) })), { fmt: v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 1) + '%' }), null, 'c5'));
  const liveMissing = universe().length - Object.keys(LIVE.prices || {}).filter(s => universe().some(r => r.symbol === s)).length;
  return h('div', null,
    h('div', { class: 'banner' }, icon('alert', 18), h('b', null, 'All sectors · full SP500 universe'), h('span', null, DATA.sourceDate), h('span', { class: 'muted' }, 'Top 10 filters do not affect this comparison.')),
    h('div', { class: 'kpis' }, kpi('Sectors', sectors.length, 'GICS sectors found in the report'), kpi('Companies', universe().length, 'in the current report'), kpi('Live quotes', Object.keys(LIVE.prices || {}).filter(s => universe().some(r => r.symbol === s)).length, LIVE.at ? tr('Updated') + ' ' + new Date(LIVE.at).toLocaleString(I18N.locale) : tr('No live quotes yet')), kpi('Missing quotes', liveMissing, 'excluded only from live-change average')),
    metricCards, charts);
};
const signedSector = v => num(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v) * 100, 1) + '%' : '—';

/* ---------- Overview ---------- */
Views.overview = () => {
  const sel = selection() || [], agg = aggregate(sel), top = ranked(sel), sectorsMix = {};
  sel.forEach(r => sectorsMix[r.sector] = (sectorsMix[r.sector] || 0) + 1);
  const mix = Object.entries(sectorsMix).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));
  return h('div', null,
    h('div', { class: 'banner' }, icon('alert', 18), h('b', null, 'Snapshot, not live quotes.'), h('span', null, 'Report'), dataText(DATA.sourceDate),
      h('span', { class: 'muted' }, 'The date in the Excel name may indicate regeneration, not the time of the quotes. Analyst targets do not guarantee returns.')),
    h('div', { class: 'kpis' },
      kpi('Report universe', DATA.bulkCount ?? '—', 'rows in the full list'),
      kpi('Filtered list', sel.length, 'rows after active filters'),
      kpi('Buy + Strong Buy', pctf(agg.support), 'aggregated share of valid recommendations'),
      kpi('Upside to mean target', pctf(agg.upside), 'simple average; not a forecast return'),
      kpi('Top pick', top[0]?.symbol ?? '—', top[0] ? RANKINGS[UI.ranking].label : 'No valid ranking values.')),
    h('div', { class: 'grid mt' },
      card('Sector mix', 'Stocks in the filtered list, by sector', mix.length ? donut(mix, { label: 'stocks', onSelect: d => { UI.f.sectors = [d.label]; saveFilters(); App.go('top10'); } }) : h('div', { class: 'empty' }, 'No stocks in the selection.'), null, 'c7'),
      card('Top 5', RANKINGS[UI.ranking].label, top.length ? h('div', { class: 'tl' }, top.slice(0, 5).map((r, i) => h('div', { class: 'ti', style: { '--c': 'var(--accent)' }, onclick: () => App.go('top10') },
        h('span', { class: 'rk' }, i + 1), logoEl(r.symbol, 28), h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'nm notr' }, r.symbol + ' · ' + r.company), h('div', { class: 'sub notr' }, r.sector)), h('b', { class: 'notr' }, usd(r.price))))) : h('div', { class: 'empty' }, 'No valid ranking values.'),
        btn('Top 10 [filtered]', 'right', () => App.go('top10'), 'sm ghost'), 'c5'),
      card('Recommendations', 'All analyst ratings of the filtered stocks · hover a segment', (() => {
        const tot = k => sel.reduce((a, r) => a + (num(r[k]) ? r[k] : 0), 0);
        const data = REC.map(([k, , long, c]) => ({ label: long, value: tot(k), color: c })).filter(d => d.value > 0);
        return data.length ? donut(data, { label: 'ratings' }) : h('div', { class: 'empty' }, 'No stocks in the selection.');
      })(), null, 'c5'),
      card('Upside to target', 'Hover a bar for price, targets and proximity · click to open Top 10', barList(top.slice(0, 10).map(r => ({
        label: r.symbol, logo: true, value: (r.upside ?? 0) * 100, color: r.upside < 0 ? 'var(--bad)' : 'var(--good)', onclick: () => App.go('top10'),
        tip: tipHtml(r.symbol + ' · ' + r.company, [tipRow('Price', usd(r.price)), tipRow('Min. target', usd(r.minTarget)), tipRow('Mean target', usd(r.meanTarget)), tipRow('Max. target', usd(r.maxTarget)),
          tipRow('Upside to mean target', pctf(r.upside)), tipRow('Min. target proximity', pctf(r.gap))]) })), { fmt: v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 1) + '%' }), null, 'c7'),
      card('Distance from 52-week low', 'How many SP500 stocks sit close to their yearly low · hover a column for the symbols', histogram(
        universe().filter(r => num(r.distance)).map(r => ({ v: r.distance * 100, s: r.symbol })),
        { bins: [0, 5, 10, 15, 20, 30, 40, 60, 100, 1000], label: (lo, hi) => hi >= 1000 ? '≥' + lo + '%' : lo + '–' + hi + '%', mark: UI.f.distance, markLabel: tr('Highlighted: within the active distance filter') + ' (≤ ' + nf(UI.f.distance) + '%)' }), null, 'c12'),
      card('Source', null, h('div', null, h('div', { class: 'srcgrid' },
        h('div', null, h('div', { class: 'up' }, 'Source Excel'), h('a', { id: 'excelLink', class: 'notr', href: excelHref(), download: DATA.source }, DATA.source)),
        h('div', null, h('div', { class: 'up' }, 'HTML generated'), dataText(DATA.generated)),
        h('div', null, h('div', { class: 'up' }, 'Active criteria'), h('div', { class: 'chips' }, criteriaChips()))),
        h('div', { class: 'row mt' }, btn('Run research', 'play', () => App.go('research'), 'sm'), btn('Full SP500 list', 'table', () => App.go('universe'), 'sm'))), null, 'c12')));
};
let excelObjectUrl = null;
const excelHref = () => excelObjectUrl || './' + encodeURIComponent(DATA.source);

/* ---------- Research: run Python + manual import ---------- */
Views.research = () => h('div', { class: 'grid' },
  card('Research', 'Downloads Yahoo data, generates Excel and loads the result automatically. A full run takes about 5 minutes.', h('div', null,
    window.dashboardRunToken ? null : h('div', { class: 'banner' }, icon('alert', 18), h('span', null, 'Open the dashboard with run_dashboard.bat (http://127.0.0.1:8765) to run the program. A file opened directly cannot start Python for security reasons.')),
    h('div', { class: 'row' }, h('button', { class: 'btn pri', id: 'runButton', onclick: startRun }, icon('play'), h('span', null, 'Run research and update the dashboard')), h('span', { class: 'sp' }), h('b', { id: 'runPct', class: 'notr big' })),
    h('div', { class: 'banner resume', id: 'runResume', hidden: true }, icon('repeat', 18), h('span', { id: 'runResumeText' }), h('span', { class: 'sp' }),
      h('button', { class: 'btn pri sm', id: 'runContinue', onclick: () => launchRun(true) }, 'Continue'),
      h('button', { class: 'btn sm', id: 'runRestart', onclick: () => { if (ask('Start a full Yahoo Finance download? It can take about 5 minutes.')) launchRun(false); } }, 'Start over')),
    h('div', { class: 'phases', id: 'runPhases' }, RUN_PHASES.map(([k, label], i) => h('span', { class: 'phase', 'data-phase': k }, h('b', null, i + 1), label))),
    h('div', { class: 'pbar runbar', id: 'runBar', role: 'progressbar', 'aria-label': 'SP500 program progress' }, h('i', { style: { width: '0%' } })),
    h('p', { id: 'runCount', class: 'runcount' }),
    h('div', { class: 'runstats', id: 'runStats', hidden: true },
      [['OK', 'runOk'], ['With errors', 'runErrors'], ['Elapsed', 'runElapsed'], ['Estimated time left', 'runEta']].map(([l, id]) => h('div', null, h('small', null, l), h('b', { id, class: 'notr' }, '—')))),
    h('p', { id: 'runResumed', class: 'muted small' }),
    h('p', { id: 'runStatus', role: 'status', 'aria-live': 'polite' }),
    h('p', { id: 'runError', class: 'negative', role: 'alert' })), null, 'c12'),
  card('Import an existing Excel', 'Select an SP500 report from your PC. Local processing: it reads the Excel only; it does not download Yahoo quotes or run Python.', h('div', null,
    h('div', { class: 'row' }, h('button', { class: 'btn', id: 'importButton', onclick: () => $('#excelFile').click() }, icon('upload'), h('span', null, 'Load / update Excel')),
      h('input', { id: 'excelFile', type: 'file', accept: '.xlsx', hidden: true, onchange: e => { if (e.target.files[0]) loadExcel(e.target.files[0]); } })),
    h('div', { class: 'pbar runbar', id: 'importBar' }, h('i', { style: { width: '0%' } })),
    h('p', { id: 'importStatus', role: 'status', 'aria-live': 'polite' }, IMPORT.message),
    h('p', { id: 'importError', class: 'negative', role: 'alert' }, IMPORT.error)), null, 'c12'));

/* ---------- Top 10 [filtered] ---------- */
const exBadge = key => h('span', { class: 'ex notr', id: 'ex-' + key });
function numInput(value, onValue, { id, step = '1', placeholder = '', integer = true, key }) {
  const i = h('input', { class: 'in', id, type: 'number', min: '0', step, placeholder, value: value ?? '' });
  i.addEventListener('input', () => {
    const t = i.value.trim(), v = Number(t), ok = t === '' || (i.checkValidity() && Number.isFinite(v) && v >= 0 && (!integer || Number.isInteger(v)));
    i.classList.toggle('bad', !ok); ok ? UI.bad.delete(key + id) : UI.bad.add(key + id);
    if (ok) onValue(t === '' ? null : v);
    saveFilters(); refreshTop();
  });
  return i;
}
/* short filter labels; the full meaning shows on hover */
const FILTER_HELP = {
  distance: ['Maximum distance from the 52-week low', 'Keeps stocks whose price is at most this % above their lowest price of the last 52 weeks. Lower = cheaper relative to the past year.'],
  analysts: ['Minimum number of analysts', 'Keeps stocks covered by at least this many analysts; more analysts make the consensus more reliable.'],
  sell: ['Maximum Sell ratings', 'Sell = Yahoo strong sell. Excludes stocks with more strong-sell ratings than this.'],
  under: ['Maximum Underperform ratings', 'Underperform = Yahoo sell. Excludes stocks with more sell ratings than this.'],
  hold: ['Maximum Hold ratings', 'Excludes stocks where many analysts only say Hold; lower = stronger conviction.'],
  positive: ['Minimum Strong Buy + Buy', 'Keeps stocks with at least this many positive ratings.'],
  price: ['Price range (USD)', 'Report price between the minimum and the maximum; empty = no limit.'],
  upside: ['Upside to the mean target (%)', 'Mean analyst target / price − 1, between the minimum and the maximum.'],
  support: ['Buy + Strong Buy share (%)', 'Share of positive ratings among all analysts.'],
  gap: ['Proximity to the minimum target (%)', '|Minimum target / price − 1|: how far the price is from the most pessimistic target.'],
  consensus: ['Consensus', 'BUY / HOLD / SELL as computed by the program from the analyst counts. None selected = all.'],
  sectors: ['Sectors', 'GICS sectors. None selected = all.']
};
const PRESET_HELP = {
  default: 'The Excel criteria (distance ≤ 12%, ≥ 12 analysts, Sell 0, Underperform ≤ 2) plus Hold ≤ 2.',
  excel: 'Exactly the Lista_Filtrata rules of the Excel report, without a Hold limit.',
  top5: 'The rule of the Top 5 investment simulation: BUY consensus, Sell 0, Hold ≤ 1, Strong Buy + Buy ≥ 15, ranked by proximity to the minimum target.'
};
const filterTip = key => () => { const [t, d] = FILTER_HELP[key], ex = excludedBy()[key];
  return tipHtml(t, ex != null ? [tipRow('Removes on its own', ex + ' ' + tr('stocks'))] : [], d); };
function presetBar() {
  const mine = userPresets();
  const chip = (label, on, onclick, extra, tip) => { const el = h('span', { class: 'chip preset' + (on ? ' on' : ''), onclick }, label, extra); return tip ? hoverTip(el, tip) : el; };
  return h('div', { class: 'chips', id: 'presets' },
    PRESETS.map(p => chip(p.short, sameFilters(UI.f, p.f()), () => { applyPreset(p.f(), p.ranking); App.render(); }, null, () => tipHtml(p.label, [], PRESET_HELP[p.id]))),
    mine.map((p, k) => chip(h('span', { class: 'notr' }, p.name), sameFilters(UI.f, cleanFilters(p.f)), () => { applyPreset(p.f, p.ranking); App.render(); },
      h('button', { class: 'chip-x', title: 'Delete preset', onclick: e => { e.stopPropagation(); store.set(PRESETS_KEY, mine.filter((_, j) => j !== k)); App.render(); } }, '×'))),
    chip('+ Save', false, () => {
      const name = (prompt(tr('Preset name')) || '').trim().slice(0, 40);
      if (!name) return;
      store.set(PRESETS_KEY, [...mine.filter(p => p.name !== name), { name, f: UI.f, ranking: UI.ranking }]); toast('Preset saved'); App.render();
    }, null, () => tipHtml('+ Save current filters', [], 'Saves the current thresholds, ranges, consensus, sectors and ranking under a name of your choice.')));
}
const reportWhen = () => { const m = /^(\d{2}) (\d{2}) (\d{4}) (\d{2})-(\d{2})/.exec(DATA.sourceDate || ''); return m ? m[1] + '.' + m[2] + '.' + m[3] + ' · ' + m[4] + ':' + m[5] : null; };
Views.top10 = () => {
  const f = UI.f;
  /* compact threshold: short label + input + "−N" badge; the long label stays as the tooltip */
  const thr = (key, short, long, id, step = '1', integer = true) => hoverTip(h('label', { class: 'cthr', for: id }, h('b', null, short),
    numInput(f[key], v => { UI.f[key] = v; }, { id, step, integer, key, placeholder: '—' }), exBadge(key)), filterTip(key));
  const rng = (key, label, step = '0.1') => hoverTip(h('div', { class: 'fbox crng' }, h('div', { class: 'fl' }, h('label', null, label), exBadge(key)),
    h('div', { class: 'pair' }, numInput(f[key][0], v => { UI.f[key][0] = v; }, { id: key + 'Min', step, integer: false, key, placeholder: 'min' }), h('span', null, '–'),
      numInput(f[key][1], v => { UI.f[key][1] = v; }, { id: key + 'Max', step, integer: false, key, placeholder: 'max' }))), filterTip(key));
  const toggles = (key, values) => h('div', { class: 'chips' }, values.map(v => h('span', { class: 'chip tog' + (f[key].includes(v) ? ' on' : ''), onclick: e => {
    const list = UI.f[key], i = list.indexOf(v); i < 0 ? list.push(v) : list.splice(i, 1);
    e.currentTarget.classList.toggle('on', i < 0); saveFilters(); refreshTop(); markPreset();
  } }, key === 'sectors' ? sectorIcon(v, 12) : null, h('span', { class: key === 'sectors' ? 'notr' : '' }, v))));
  const search = h('input', { class: 'in csearch', id: 'search', type: 'search', placeholder: 'Symbol / company', value: f.q });
  search.addEventListener('input', () => { UI.f.q = search.value; saveFilters(); refreshTop(); });
  const rank = selectEl(Object.entries(RANKINGS).map(([k, r]) => [k, r.label]), UI.ranking, v => { UI.ranking = v; saveFilters(); refreshTop(); }, 'sel csel'); rank.id = 'ranking'; rank.title = tr('Top 10 ranking');
  const advCount = ['price', 'upside', 'support', 'gap', 'consensus', 'sectors'].filter(k => CRITERIA.find(c => c.key === k).on(f)).length;
  const adv = h('details', { class: 'fadv', open: UI.adv || null, ontoggle: e => { UI.adv = e.currentTarget.open; } },
    h('summary', null, h('span', null, 'Advanced filters'), h('span', { class: 'muted' }, ' · ', 'ranges, consensus, sectors'), advCount ? h('span', { class: 'badge', style: { '--c': 'var(--accent)' } }, String(advCount)) : null),
    h('div', { class: 'fgrid4 fsec' }, rng('price', 'Price $', '0.01'), rng('upside', 'Upside %'), rng('support', 'SB+B %'), rng('gap', 'To min. %')),
    h('div', { class: 'fsec' }, hoverTip(h('div', { class: 'fl has-tip' }, h('div', { class: 'up' }, 'Consensus'), exBadge('consensus')), filterTip('consensus')), toggles('consensus', CONSENSUS)),
    h('div', { class: 'fsec' }, hoverTip(h('div', { class: 'fl has-tip' }, h('div', { class: 'up' }, 'Sectors'), exBadge('sectors')), filterTip('sectors')), toggles('sectors', sectors())));
  const researched = reportWhen();
  return h('div', null,
    researched ? h('div', { class: 'banner', id: 'researchStamp' }, icon('sched', 18), h('b', null, 'Last research run'), dataText(researched),
      h('span', { class: 'muted' }, 'The Top 10 uses this report; live prices update separately.')) : null,
    h('section', { class: 'card fbar' },
      h('div', { class: 'fbar-row' }, presetBar()),
      h('div', { class: 'fbar-row' },
        thr('distance', 'Dist% ≤', '', 'distanceMax', '0.1', false), thr('analysts', 'Anal. ≥', '', 'analystsMin'),
        thr('sell', 'Sell ≤', 'Maximum Sell ≤', 'sellExact'), thr('under', 'Und. ≤', '', 'underMax'), thr('hold', 'Hold ≤', 'Maximum Hold ≤', 'holdMax'),
        thr('positive', 'SB+B ≥', 'Strong Buy + Buy ≥', 'positiveMin'),
        h('span', { class: 'sp' }), search, rank,
        h('button', { class: 'btn sm', id: 'reset', onclick: () => { applyPreset(DEFAULT_FILTERS(), 'proximity'); UI.sort = { key: null, dir: 1 }; App.render(); } }, 'Reset'),
        h('button', { class: 'btn sm', id: 'csv', title: tr('Export selection CSV'), onclick: () => { const s = selection(); if (s) exportCsv(s, 'Selection'); } }, icon('dl'), h('span', null, 'CSV'))),
      adv,
      h('p', { id: 'filterError', class: 'negative', role: 'alert' }),
      DATA.fullUniverse ? null : h('p', { class: 'muted small', id: 'universeNote' }, 'Excel has no Lista_SP500 sheet. Thresholds apply only to available rows; load the full list to expand selection.')),
    h('div', { class: 'sectionhead' }, h('div', null, h('h2', null, 'Top 10 · price and analysts'), h('p', { class: 'muted small', id: 'method' })),
      h('div', { class: 'row' }, h('span', { class: 'badge', id: 'shown', style: { '--c': 'var(--accent)' } }),
        btn('Save in history', 'plus', saveTop10, 'sm'), btn('History', 'sched', () => App.go('history'), 'sm ghost'))),
    h('div', { class: 'grid', id: 'topGrid' }));
};
function markPreset() {
  const mine = userPresets(), all = [...PRESETS.map(p => p.f()), ...mine.map(p => cleanFilters(p.f))];
  $$('#presets .preset').forEach((el, i) => { if (i < all.length) el.classList.toggle('on', sameFilters(UI.f, all[i])); });
}
function refreshTop() {
  const sel = selection(), err = $('#filterError');
  if (!err) return;
  if (!sel) { err.textContent = 'Enter valid non-negative thresholds; analyst and recommendation counts must be integers.'; return; }
  err.textContent = '';
  const ex = excludedBy();
  $$('.ex').forEach(b => { const v = ex[b.id.slice(3)]; b.textContent = v == null ? '' : '−' + v; b.classList.toggle('hot', v > 0); });
  markPreset();
  const top = ranked(sel).slice(0, 10);
  $('#topGrid').replaceChildren(...(top.length ? top.map(stockCard) : [h('div', { class: 'card empty c12' }, 'No valid ranking values.')]));
  $('#shown').textContent = top.length + ' of ' + sel.length + ' selected';
  $('#method').textContent = UI.ranking === 'proximity' ? 'Percentage proximity to minimum target ascending; weighted score descending. The target may be below or above price.' : 'Descending order by ' + RANKINGS[UI.ranking].label;
  App.updateNav();
}

/* ---------- Filtered list ---------- */
Views.filtered = () => {
  const sel = selection();
  if (!sel) return card(null, null, h('div', { class: 'empty' }, 'Enter valid non-negative thresholds; analyst and recommendation counts must be integers.'));
  return card('Filtered', 'Click a header to sort. Thresholds, search and sector are set on the Top 10 [filtered] page.', h('div', null,
    h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { class: 'chips' }, criteriaChips()), h('span', { class: 'sp' }),
      liveStatus(), h('span', { class: 'badge', id: 'tableCount' }, sel.length + ' rows'),
 btn('Export selection CSV', 'dl', () => exportCsv(sel, 'Selection'), 'sm')),
    dataTable(sel, UI.sort, k => { toggleSort(UI.sort, k); App.render(); })));
};

/* ---------- Full SP500 list: per-column filters (min–max for numbers, text or list for the rest) ---------- */
const COLF_KEY = 'dashivo-sp500-colfilters';
UI.cf = store.get(COLF_KEY, {}) || {};
const saveColFilters = debounce(() => store.set(COLF_KEY, UI.cf), 300);
function columnKinds(rows) {
  const kinds = {};
  for (const c of tableHeaders()) {
    const vals = rows.map(r => r[c]).filter(v => v != null && v !== '');
    const distinct = [...new Set(vals.map(String))];
    kinds[c] = vals.length && vals.every(num) ? 'num' : distinct.length && distinct.length <= 15 ? 'list' : 'text';
    if (kinds[c] === 'list') kinds[c + '\u0000opts'] = distinct.sort();
  }
  return kinds;
}
function columnTest(c, f, kind) {
  const scale = c.includes('%') ? 100 : 1;
  if (kind === 'num') { const lo = f.min, hi = f.max; if (lo == null && hi == null) return null; return r => inRange(r[c], [lo, hi], scale); }
  const t = String(f.text ?? '').trim().toLowerCase(); if (!t) return null;
  return kind === 'list' ? r => String(r[c] ?? '').toLowerCase() === t : r => String(r[c] ?? '').toLowerCase().includes(t);
}
Views.universe = () => {
  const cols = tableHeaders(), all = universe(), kinds = columnKinds(all), count = h('span', { class: 'badge' }), tbody = h('tbody', { class: 'notr' });
  for (const c of Object.keys(UI.cf)) if (!cols.includes(c)) delete UI.cf[c];
  const rowsNow = () => {
    const q = UI.uq.trim().toLowerCase();
    const tests = cols.map(c => UI.cf[c] && columnTest(c, UI.cf[c], kinds[c])).filter(Boolean);
    return all.filter(r => (!q || (r.symbol + ' ' + r.company).toLowerCase().includes(q)) && tests.every(t => t(r)));
  };
  const draw = () => {
    const rows = sortRows(rowsNow(), UI.usort), active = Object.values(UI.cf).filter(f => f && (f.min != null || f.max != null || String(f.text ?? '').trim())).length;
    count.textContent = rows.length + ' of ' + all.length + ' stocks';
    $('#colActive') && ($('#colActive').textContent = active ? active + ' column filters' : '');
    tbody.replaceChildren(...rows.map(r => h('tr', null, cols.map(c => dataCell(r, c, cols[0])))));
    $('#uEmpty') && ($('#uEmpty').hidden = rows.length > 0);
  };
  const update = (c, patch) => { UI.cf[c] = { ...(UI.cf[c] || {}), ...patch }; saveColFilters(); draw(); };
  const stop = e => e.stopPropagation();
  const colInput = c => {
    const f = UI.cf[c] || {}, kind = kinds[c];
    if (kind === 'num') {
      const box = (k, ph) => { const i = h('input', { class: 'in cf', type: 'number', step: 'any', placeholder: ph, value: f[k] ?? '', onclick: stop, onkeydown: stop });
        i.addEventListener('input', () => { const t = i.value.trim(), v = Number(t); i.classList.toggle('bad', t !== '' && !Number.isFinite(v)); if (t === '' || Number.isFinite(v)) update(c, { [k]: t === '' ? null : v }); }); return i; };
      return h('div', { class: 'cfpair' }, box('min', 'min'), box('max', 'max'));
    }
    if (kind === 'list') {
      const sel = selectEl(kinds[c + '\u0000opts'], f.text ?? '', v => update(c, { text: v }), 'sel cf', 'All'); sel.addEventListener('click', stop); return sel;
    }
    const i = h('input', { class: 'in cf', type: 'search', placeholder: 'contains…', value: f.text ?? '', onclick: stop, onkeydown: stop });
    i.addEventListener('input', () => update(c, { text: i.value })); return i;
  };
  const head = h('tr', null, cols.map(c => h('th', { class: 'srt cfh', 'aria-sort': UI.usort.key === c ? (UI.usort.dir === 1 ? 'ascending' : 'descending') : null,
    onclick: () => { toggleSort(UI.usort, c); App.render(); } }, h('div', { class: 'cft' }, headerLabel(c), UI.usort.key === c ? (UI.usort.dir === 1 ? ' ↑' : ' ↓') : ''), colInput(c))));
  const search = h('input', { class: 'in', type: 'search', placeholder: 'E.g. APTV, Cummins…', value: UI.uq });
  search.addEventListener('input', () => { UI.uq = search.value; draw(); });
  const body = h('div', null, h('div', { class: 'tbl-wrap', 'data-keep': 'utbl' }, h('table', { class: 'sp-tbl cf-tbl' }, h('thead', null, head), tbody)),
    h('div', { class: 'empty', id: 'uEmpty', hidden: true }, 'No stocks in the selection.'));
  const view = card('Full SP500 list', 'Every stock queried in the report, before any filter. Filter any column from its header: min–max for numbers, text or list for the rest.', h('div', null,
    h('div', { class: 'tools' }, field('Symbol / company', search, 'w2'), h('span', { class: 'sp' }), liveStatus(), h('span', { class: 'muted small', id: 'colActive' }), count,
      btn('Clear column filters', 'x', () => { UI.cf = {}; UI.uq = ''; saveColFilters(); App.render(); }, 'sm'),
      btn('Export list CSV', 'dl', () => exportCsv(sortRows(rowsNow(), UI.usort), 'Full_List'), 'sm')),
    DATA.fullUniverse ? null : h('div', { class: 'banner' }, icon('alert', 18), h('span', null, 'Excel has no Lista_SP500 sheet. Thresholds apply only to available rows; load the full list to expand selection.')),
    body));
  setTimeout(draw, 0); draw();
  return view;
};

/* ---------- Methodology ---------- */
Views.method = () => {
  const sel = selection() || [], issues = aggregate(sel).issues;
  return h('div', { class: 'grid' },
    card('Methodology', null, h('div', { class: 'guide' },
      h('p', null, 'Default ranking: |Minimum target / Price − 1| ascending, then 1.5 × Strong Buy + Buy descending, then symbol. Active thresholds apply to the full list without modifying the source Excel. Missing ranking values exclude a stock only from Top 10.'),
      h('p', null, 'Charts normalize each company’s price to 100. They compare targets, not historical prices. Absolute values are shown in USD (SP500 universe).'),
      h('p', null, 'Hold is read from Excel. For legacy reports without Hold, it is inferred from Total Analysts − Strong Buy − Buy − Underperform − Sell. Hold has an editable threshold, default ≤ 2. Underperform maps to Yahoo sell; Sell maps to Yahoo strongSell. Original Excel labels are preserved.'),
      h('p', null, 'Aggregated support = sum of Buy + Strong Buy / sum of Total Analysts for valid rows. Recommendations and targets may have different update times. No growth probabilities are calculated.'),
      h('p', { class: 'muted' }, 'Informational analysis, not investment advice. Excel is processed locally; only running the program requests Yahoo Finance data.')), null, 'c7'),
    card('Data quality', 'Numerical checks on the current selection', issues.length
      ? h('div', { class: 'tl' }, issues.map(([s, t]) => h('div', { class: 'ti', style: { '--c': 'var(--warn)' } }, h('b', { class: 'notr' }, s), h('span', null, t))))
      : h('p', null, 'No numerical inconsistencies detected in the selection.'), null, 'c5'),
    card('Sources', null, h('div', { class: 'srcgrid' },
      h('div', null, h('div', { class: 'up' }, 'Source Excel'), dataText(DATA.source)),
      h('div', null, h('div', { class: 'up' }, 'HTML generated'), dataText(DATA.generated)),
      h('div', null, h('div', { class: 'up' }, 'Visual reference'), dataText(DATA.styleReference))), null, 'c12'));
};
