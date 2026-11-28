'use strict';
/* ================= Fundamental analysis: 32 metrics in 7 pillars, each ranked within the stock's sector (fundamentals.py → data/fundamentals.json) ================= */
const FUND = { data: null, loading: false, error: '', open: null, extra: '' };
const FUND_CLASS = { Strong: 'good', Good: 'good', Neutral: 'mid', Weak: 'bad', 'Very weak': 'bad' };
const FUND_PCT = new Set(['netMargin', 'operatingMargin', 'grossMargin', 'roe', 'roa', 'roic', 'revenueGrowth', 'earningsGrowth', 'forwardEpsGrowth', 'fcfCagr3y', 'netCashToCap', 'fcfYield', 'fcfMargin', 'surprise', 'dividendYield', 'payoutSafety']);
const FUND_SCORE = new Set(['erHealth', 'erQuality', 'erProfitability', 'erCapital']);
async function fundLoad() {
  if (FUND.loading || FUND.data) return;
  FUND.loading = true;
  try { FUND.data = await runRequest('/api/fundamentals'); FUND.error = ''; } catch (e) { FUND.error = e.message || 'Fundamental analysis data is unavailable.'; }
  FUND.loading = false;
  if (['fundamental', 'summary', 'sectors'].includes(App.route())) App.render();
}
const fundOf = symbol => FUND.data?.stocks?.[symbol] || null;
function fundValue(key, v) {
  if (!num(v)) return '—';
  if (FUND_PCT.has(key)) return (v < 0 ? '−' : '') + nf(Math.abs(v) * 100, 1) + '%';
  if (FUND_SCORE.has(key)) return nf(v, 0) + ' / 100';
  if (key === 'roeSlope' || key === 'grossMarginChange') return (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), 2) + ' pp';
  return nf(v, 2) + (['debtToEquity', 'currentRatio', 'quickRatio', 'cashConversion'].includes(key) ? '×' : '');
}
const fundChip = cat => cat ? h('span', { class: 'tech-verdict agent-' + (FUND_CLASS[cat] || 'mid') }, tr(cat)) : h('span', { class: 'muted' }, '—');
function fundSummary(f) {
  const best = Object.entries(f.pillars).sort((a, b) => b[1] - a[1]), label = k => tr((FUND.data.pillars.find(p => p.key === k) || {}).label || k);
  const parts = [tr('Score') + ' ' + techScore(f.score) + ' ' + tr('vs sector peers')];
  if (best.length) parts.push(tr('strongest') + ': ' + label(best[0][0]));
  if (best.length > 1) parts.push(tr('weakest') + ': ' + label(best.at(-1)[0]));
  parts.push(tr('data coverage') + ' ' + nf(f.coverage * 100, 0) + '%');
  return parts.join(' · ');
}
/* the short verdict other pages show (Verdict, Sectors) */
function fundVerdict(symbol) {
  const f = fundOf(symbol); if (!f || !f.category) return null;
  return { vote: f.score >= 0.1 ? 1 : f.score <= -0.1 ? -1 : 0, text: tr(f.category) + (num(f.metrics.forwardPE) ? ' · P/E ' + nf(f.metrics.forwardPE, 1) : ''), title: fundSummary(f) };
}
function fundDetail(symbol) {
  const f = fundOf(symbol);
  if (!f) return h('div', { class: 'empty' }, tr('No fundamental data for this stock.'));
  const med = FUND.data.sectorMedians[f.sector] || {};
  const groups = FUND.data.pillars.map(p => {
    const rows = FUND.data.metrics.filter(m => m.pillar === p.key);
    return h('div', { class: 'tv-group' }, h('div', { class: 'tv-head' }, h('b', null, tr(p.label)), techGauge(f.pillars[p.key])),
      h('table', { class: 'pf-tbl fd-tbl' }, h('thead', null, h('tr', null, [tr('Metric'), tr('Value'), tr('Sector median'), tr('Rank in sector')].map(x => h('th', null, x)))),
        h('tbody', null, rows.map(m => h('tr', { class: f.metrics[m.key] == null ? 'fd-missing' : '' },
          h('td', { title: m.higherIsBetter ? tr('Higher is better') : tr('Lower is better') }, tr(m.label), h('small', { class: 'muted' }, m.higherIsBetter ? ' ↑' : ' ↓')),
          h('td', { class: 'notr' }, f.metrics[m.key] == null ? h('span', { class: 'muted' }, tr('no data')) : fundValue(m.key, f.metrics[m.key])),
          h('td', { class: 'notr muted' }, fundValue(m.key, med[m.key])), h('td', null, f.ranks[m.key] != null ? techGauge(f.ranks[m.key]) : '—'))))));
  });
  const reports = (f.reports || []).filter(r => r.report_date);
  return h('div', { class: 'tech-detail' },
    h('p', { class: 'tech-sum-line' }, fundSummary(f), h('span', { class: 'muted small notr' }, ' · ' + f.sector + (f.industry ? ' / ' + f.industry : ''))),
    h('div', { class: 'fd-facts' },
      h('div', { class: 'tf' }, h('small', null, tr('Equity Rank strength')), h('b', { class: 'notr' }, num(f.erStrength) ? nf(f.erStrength, 0) + (f.erGrade ? ' · ' + f.erGrade : '') : '—')),
      h('div', { class: 'tf' }, h('small', null, tr('Trailing P/E')), h('b', { class: 'notr' }, num(f.trailingPE) ? nf(f.trailingPE, 1) : '—')),
      h('div', { class: 'tf' }, h('small', null, tr('Beta')), h('b', { class: 'notr' }, num(f.beta) ? nf(f.beta, 2) : '—')),
      h('div', { class: 'tf' }, h('small', null, tr('Market cap')), h('b', { class: 'notr' }, fundBig(f.marketCap))),
      h('div', { class: 'tf' }, h('small', null, tr('Next earnings')), h('b', { class: 'notr' }, f.nextEarnings || '—')),
      h('div', { class: 'tf' }, h('small', null, tr('Last reports: EPS vs estimate')), h('b', { class: 'notr small' }, reports.length ? reports.map(r => r.report_date.slice(5) + ' ' + (num(r.surprise_pct) ? (r.surprise_pct >= 0 ? '+' : '') + nf(r.surprise_pct, 1) + '%' : '—')).join(' · ') : '—'))),
    h('div', { class: 'tv-groups' }, groups));
}
const fundBig = v => num(v) ? '$' + (v >= 1e12 ? nf(v / 1e12, 2) + 'T' : v >= 1e9 ? nf(v / 1e9, 1) + 'B' : nf(v / 1e6, 0) + 'M') : '—';
Views.fundamental = () => {
  fundLoad();
  const heading = card('Fundamental analysis', 'For the current Top 10: 32 metrics in 7 pillars (profitability, growth, financial health, valuation, cash flow and earnings quality, fundamental momentum, shareholder returns) from Yahoo Finance statistics, Equity Rank and Zyberno. Each metric is ranked against the companies of the same sector, so a utility is compared with utilities and a software company with software companies. Click a stock for every metric.', null, null, 'c12');
  if (FUND.error && !FUND.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, FUND.error)));
  if (!FUND.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  if (!selected) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))));
  const symbols = top.map(r => r.symbol);
  if (FUND.extra && !symbols.includes(FUND.extra)) symbols.push(FUND.extra);
  const counts = {}; symbols.forEach(s => { const c = fundOf(s)?.category; if (c) counts[c] = (counts[c] || 0) + 1; });
  const kpis = h('div', { class: 'kpis' }, ...['Strong', 'Good', 'Neutral', 'Weak', 'Very weak'].map(c => kpi(tr(c), String(counts[c] || 0), tr('of the stocks shown'))));
  const pillars = FUND.data.pillars;
  const head = h('tr', null, [tr('Stock'), tr('Verdict'), tr('Score'), ...pillars.map(p => tr(p.label)), tr('Forward P/E'), tr('Net margin'), tr('Revenue growth'), tr('Data')].map(x => h('th', null, x)));
  const body = symbols.map(sym => {
    const f = fundOf(sym), stock = universe().find(x => x.symbol === sym) || { company: '' }, open = FUND.open === sym;
    return h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: () => { FUND.open = open ? null : sym; App.render(); } },
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, stock.company + (top.some(r => r.symbol === sym) ? '' : ' · ' + tr('added')))))),
      h('td', null, f ? fundChip(f.category) : '—'), h('td', null, f ? techGauge(f.score) : '—'),
      ...pillars.map(p => h('td', null, f ? techGauge(f.pillars[p.key]) : '—')),
      h('td', { class: 'notr' }, f ? fundValue('forwardPE', f.metrics.forwardPE) : '—'), h('td', { class: 'notr' }, f ? fundValue('netMargin', f.metrics.netMargin) : '—'),
      h('td', { class: 'notr ' + plClass(f?.metrics.revenueGrowth) }, f ? fundValue('revenueGrowth', f.metrics.revenueGrowth) : '—'), h('td', { class: 'notr muted' }, f ? nf(f.coverage * 100, 0) + '%' : '—'));
  });
  const options = universe().map(r => r.symbol).filter(s => fundOf(s)).sort();
  const picker = h('div', { class: 'row' }, h('span', { class: 'muted small' }, tr('Analyse another stock:')),
    selectEl([['', '—'], ...options.map(s => [s, s])], FUND.extra, v => { FUND.extra = v; FUND.open = v || FUND.open; App.render(); }, 'sel csel'),
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Computed') + ' ' + new Date(FUND.data.at).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  const openStock = FUND.open && symbols.includes(FUND.open) ? FUND.open : null;
  const detail = openStock ? card(openStock + ' · ' + ((universe().find(x => x.symbol === openStock) || {}).company || ''), tr('Every metric with its sector median and rank; click the row again to close.'), fundDetail(openStock), null, 'c12') : null;
  return h('div', null, heading, kpis, card(null, null, h('div', null, picker, h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl fund-tbl' }, h('thead', null, head), h('tbody', null, body))),
      openStock ? null : h('p', { class: 'muted small' }, tr('Click a stock for every metric.'))), null, 'c12'), detail,
    h('p', { class: 'muted small mt' }, tr('Sources:'), ' Yahoo Finance · ', ivLink('Equity Rank', 'https://www.equity-rank.com/'), ' · ', ivLink('Zyberno', 'https://zyberno.com/brina-gap/'), ' (CC BY 4.0). ',
      tr('Rank in sector = percentile among the companies of the same sector with that metric (−1 worst … +1 best; the whole universe when fewer than five peers have it). Pillar = mean of its ranks; score = mean of the pillars (at least three needed); Strong from +0.35, Good from +0.1, Weak below −0.1, Very weak below −0.35. Dividend metrics count only for companies that pay one. Data can lag the latest filings; not investment advice.')));
};
