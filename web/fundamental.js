'use strict';
/* ================= Fundamental analysis of the current Top 10 from the attributed valuation snapshot ================= */
const FUND_LABELS = { strong: 'Strong', mixed: 'Mixed', weak: 'Weak', unknown: 'Not enough data' };
const fundRatio = (a, b) => num(a) && num(b) && b !== 0 ? a / b : null;
/* Zyberno (CC BY 4.0) supplies trailing-twelve-month fundamentals, Equity Rank the Fundamental Strength composite;
   every rule votes +1 / 0 / −1 or null (unavailable) and the verdict is the sum of the available votes */
function fundAnalyse(stock, zyberno, rank) {
  if (!zyberno && !rank) return null;
  const price = num(LIVE.prices?.[stock.symbol]) && LIVE.prices[stock.symbol] > 0 ? LIVE.prices[stock.symbol] : stock.price;
  const z = zyberno || {}, r = rank || {};
  const pe = num(z.eps) && z.eps > 0 && num(price) ? price / z.eps : null, loss = num(z.eps) && z.eps <= 0;
  const netMargin = fundRatio(z.netIncome, z.revenue), fcfMargin = fundRatio(z.fcf, z.revenue), fcfYield = fundRatio(z.fcf, z.marketCap), ps = fundRatio(z.marketCap, z.revenue);
  const rules = [
    { key: 'Net margin', vote: netMargin == null ? null : netMargin > .1 ? 1 : netMargin < 0 ? -1 : 0, detail: netMargin == null ? null : nf(netMargin * 100, 1) + '%' },
    { key: 'Return on equity', vote: !num(z.roe) ? null : z.roe > 15 ? 1 : z.roe < 5 ? -1 : 0, detail: !num(z.roe) ? null : nf(z.roe, 1) + '%' },
    { key: 'Return on invested capital', vote: !num(z.roic) ? null : z.roic > 10 ? 1 : z.roic < 6 ? -1 : 0, detail: !num(z.roic) ? null : nf(z.roic, 1) + '%' },
    { key: 'Free cash flow yield', vote: fcfYield == null ? null : fcfYield > .04 ? 1 : fcfYield < 0 ? -1 : 0, detail: fcfYield == null ? null : nf(fcfYield * 100, 1) + '%' },
    { key: 'P/E (trailing)', vote: loss ? -1 : pe == null ? null : pe <= 25 ? 1 : pe > 40 ? -1 : 0, detail: loss ? 'Negative earnings' : pe == null ? null : nf(pe, 1) },
    { key: 'Fundamental Strength', vote: !num(r.strengthScore) ? null : r.strengthScore >= 60 ? 1 : r.strengthScore < 40 ? -1 : 0, detail: !num(r.strengthScore) ? null : nf(r.strengthScore, 0) + (r.strengthGrade ? ' · ' + r.strengthGrade : '') }
  ];
  const votes = rules.filter(x => x.vote != null), score = votes.reduce((a, x) => a + x.vote, 0);
  const verdict = votes.length < 4 ? 'unknown' : score >= 3 ? 'strong' : score <= -3 ? 'weak' : 'mixed';
  return { price, pe, loss, ps, netMargin, fcfMargin, fcfYield, marketCap: z.marketCap, roe: z.roe, roic: z.roic, growth: z.growth, strengthScore: r.strengthScore, strengthGrade: r.strengthGrade,
    modelsAbove: r.modelsAbove, modelsTotal: r.modelsTotal, rules, score, available: votes.length, verdict, asOf: z.asOf || z.snapshotDate };
}
const fundConclusion = f => !f || f.verdict === 'unknown' ? 'Not enough fundamental data for a verdict.'
  : f.verdict === 'strong' ? 'Most quality and valuation checks are favourable.' : f.verdict === 'weak' ? 'Most quality and valuation checks are unfavourable.' : 'Quality and valuation checks are mixed.';
const fundBig = v => num(v) ? '$' + (v >= 1e12 ? nf(v / 1e12, 2) + 'T' : v >= 1e9 ? nf(v / 1e9, 1) + 'B' : nf(v / 1e6, 0) + 'M') : '—';
const fundTip = (symbol, f) => tipHtml(symbol + ' · ' + tr(FUND_LABELS[f.verdict]), f.rules.map(r => tipRow(r.key, r.vote == null ? tr('Unavailable') : (r.vote > 0 ? '▲ ' : r.vote < 0 ? '▼ ' : '● ') + esc(r.detail || ''))),
  tr('Score') + ' ' + (f.score > 0 ? '+' : '') + f.score + ' / ' + f.available + (f.asOf ? ' · ' + tr('Source date') + ' ' + String(f.asOf).slice(0, 10) : ''));
Views.fundamental = () => {
  if (!INTRINSIC.loaded) ivLoad();
  const heading = card('Fundamentals', 'Trailing-twelve-month fundamentals (Zyberno, CC BY 4.0) and the Equity Rank Fundamental Strength score for the stocks of the current Top 10 (active filters and ranking). Six rules vote up, neutral or down; hover a verdict for the values. Data are dated and may lag the latest filings; not a forecast.', null, null, 'c12');
  if (INTRINSIC.error) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Intrinsic-value data is unavailable.'), ' ', INTRINSIC.error)));
  if (!INTRINSIC.loaded) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading verified source data…'))));
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  if (!selected) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))));
  if (!top.length) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('No ranked stocks in the active selection.'))));
  const sources = INTRINSIC.data?.sources || {};
  const rows = top.map(stock => ({ stock, f: fundAnalyse(stock, ivLookup(sources.zyberno?.rows, stock.symbol), ivLookup(sources.equityRank?.rows, stock.symbol)) }));
  const counts = { strong: 0, mixed: 0, weak: 0 }; rows.forEach(r => { if (r.f && counts[r.f.verdict] != null) counts[r.f.verdict]++; });
  const kpis = h('div', { class: 'kpis' }, kpi('Strong', String(counts.strong), 'of the current Top 10'), kpi('Mixed', String(counts.mixed), 'of the current Top 10'), kpi('Weak', String(counts.weak), 'of the current Top 10'));
  const cell = (v, fmt) => h('td', { class: 'notr' }, v == null ? '—' : fmt(v));
  const pct = (v, d = 1) => h('span', { class: plClass(v) }, nf(v * 100, d) + '%');
  const chips = f => !f ? '—' : h('div', { class: 'fund-chips' }, f.rules.filter(r => r.vote).map(r => h('span', { class: 'fund-chip ' + (r.vote > 0 ? 'up' : 'down') }, (r.vote > 0 ? '+ ' : '− ') + tr(r.key))));
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl fund-tbl' },
    h('thead', null, h('tr', null, ['Stock', 'Market cap', 'P/E', 'P/S', 'Net margin', 'FCF yield', 'ROE', 'ROIC', 'Strength', 'Verdict', 'Strengths and concerns', 'Summary'].map(x => h('th', null, tr(x))))),
    h('tbody', null, rows.map(({ stock, f }) => h('tr', null,
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(stock.symbol, 22), h('div', null, h('b', { class: 'notr' }, stock.symbol), h('div', { class: 'muted small notr' }, stock.company)))),
      cell(f?.marketCap, fundBig), h('td', { class: 'notr' }, f?.loss ? tr('Loss') : f?.pe == null ? '—' : nf(f.pe, 1)), cell(f?.ps, v => nf(v, 1)),
      cell(f?.netMargin, v => pct(v)), cell(f?.fcfYield, v => pct(v)), cell(f?.roe, v => h('span', { class: plClass(v) }, nf(v, 1) + '%')), cell(f?.roic, v => h('span', { class: plClass(v) }, nf(v, 1) + '%')),
      cell(f?.strengthScore, v => nf(v, 0) + (f.strengthGrade ? ' · ' + f.strengthGrade : '')),
      h('td', null, f ? hoverTip(h('span', { class: 'tech-verdict fund-' + f.verdict }, tr(FUND_LABELS[f.verdict])), () => fundTip(stock.symbol, f)) : '—'),
      h('td', null, chips(f)), h('td', { class: 'tech-sum' }, tr(fundConclusion(f))))))));
  return h('div', null, heading, kpis, card(null, null, table, null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Sources:'), ' ', ivLink('Zyberno', 'https://zyberno.com/brina-gap/'), ' (CC BY 4.0) · ', ivLink('Equity Rank', 'https://www.equity-rank.com/'), ' · ',
      tr('Thresholds (up / down): net margin >10% / <0%; ROE >15% / <5%; ROIC >10% / <6%; FCF yield >4% / <0%; P/E ≤25 / >40 or a loss; Fundamental Strength ≥60 / <40. These are baseline choices, not recommendations.'), ' ', tr('Ratios are computed here from the sources\' trailing-twelve-month values; P/E uses the live or report price. Missing data is left blank, never estimated. Not investment advice.')));
};
