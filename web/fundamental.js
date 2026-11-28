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

const FUND_NOTE_NODATA = X('No data: the sources did not publish this figure for the stock. It is left out of the pillar and the score and is never estimated.', 'Fără date: sursele nu au publicat această cifră pentru acțiune. E lăsată în afara pilonului și a scorului și nu este niciodată estimată.');
const FUND_LOWDATA = 0.6;
const fundLabel = k => tr((FUND.data.pillars.find(p => p.key === k) || {}).label || k);
const fundMissing = f => FUND.data.metrics.filter(m => f.metrics[m.key] == null);
/* "enough data" verdict of a stock: ok / low (coverage under 60%) / none (fewer than 3 pillars, so no score) */
const fundData = f => !f || f.score == null ? 'none' : f.coverage < FUND_LOWDATA ? 'low' : 'ok';
const FUND_DATA_TXT = { ok: X('Enough data', 'Date suficiente'), low: X('Little data', 'Date puține'), none: X('Not enough data', 'Date insuficiente') };
function fundMetricTip(m, f, med) {
  const info = FUND_INFO[m.key] || [], v = f.metrics[m.key], r = f.ranks[m.key];
  return tipHtml(m.label, [exRow('What it shows', tr(info[0])), exRow('Calculation', tr(info[1])),
    exRow('Direction', tr(m.higherIsBetter ? 'Higher is better' : 'Lower is better')),
    exRow('Value', v == null ? tr('no data') : fundValue(m.key, v)), exRow('Sector median', fundValue(m.key, med[m.key])),
    exRow('Rank in sector', r == null ? '—' : exSigned(r) + ' · ' + exRankWords(r))], v == null ? FUND_NOTE_NODATA : X('Rank −1 = worst of the group, 0 = middle, +1 = best; the direction above is already applied.', 'Rang −1 = cel mai slab din grup, 0 = la mijloc, +1 = cel mai bun; direcția de mai sus e deja aplicată.'));
}
function fundPillarTip(p, f) {
  const rows = FUND.data.metrics.filter(m => m.pillar === p.key), got = rows.filter(m => f.ranks[m.key] != null), v = f.pillars[p.key];
  return tipHtml(p.label, [exRow('What it shows', tr(FUND_PILLAR_INFO[p.key])),
    exRow('Calculation', got.length ? tr('Mean of') + ' ' + got.length + ' ' + tr('ranks') + ': ' + got.map(m => exSigned(f.ranks[m.key], 1)).join(', ') + ' = ' + exSigned(v) : '—'),
    exRow('Reading', v == null ? tr('no data') : exRankWords(v)), exRow('Missing', rows.length - got.length ? (rows.length - got.length) + ' ' + tr('of') + ' ' + rows.length + ': ' + rows.filter(m => f.ranks[m.key] == null).map(m => tr(m.label)).join(', ') : null)],
    X('A pillar is the average of the ranks of its metrics against companies of the same sector.', 'Un pilon este media rangurilor metricilor sale față de companiile din același sector.'));
}
function fundScoreTip(f) {
  const ps = Object.entries(f.pillars);
  return tipHtml('Score', [exRow('What it shows', tr(X('How the company compares with its sector peers across the seven pillars.', 'Cum se compară compania cu cele din același sector pe cei șapte piloni.'))),
    exRow('Calculation', ps.length >= 3 ? tr('Mean of') + ' ' + ps.length + ' ' + tr('pillars') + ': ' + ps.map(([, v]) => exSigned(v, 2)).join(', ') + ' = ' + exSigned(f.score) : tr('Fewer than 3 pillars have data, so there is no score.')),
    exRow('Verdict', f.category ? tr(f.category) : '—')],
    X('Strong from +0.35, Good from +0.10, Neutral between −0.10 and +0.10, Weak below −0.10, Very weak below −0.35. It compares companies with each other; it does not say the price is cheap.', 'Strong de la +0,35, Good de la +0,10, Neutral între −0,10 și +0,10, Weak sub −0,10, Very weak sub −0,35. Compară companiile între ele; nu spune că prețul e ieftin.'));
}
function fundDataTip(f) {
  const miss = fundMissing(f), st = fundData(f);
  return tipHtml('Data coverage', [exRow('Metrics with data', f.coverage != null ? Math.round(f.coverage * FUND.data.metrics.length) + ' / ' + FUND.data.metrics.length + ' (' + nf(f.coverage * 100, 0) + '%)' : '—'),
    exRow('Reading', tr(FUND_DATA_TXT[st])), exRow('Missing', miss.length ? miss.map(m => tr(m.label)).join(', ') : null)],
    X('Missing figures are skipped, never estimated. Below 60% coverage treat the verdict with caution; with fewer than 3 pillars there is no score.', 'Cifrele lipsă sunt sărite, niciodată estimate. Sub 60% acoperire tratează verdictul cu prudență; cu mai puțin de 3 piloni nu există scor.'));
}
const fundHeadTip = {
  Verdict: [X('The overall judgement from the score.', 'Concluzia generală dată de scor.'), X('Strong ≥ +0.35 · Good ≥ +0.10 · Neutral · Weak < −0.10 · Very weak < −0.35.', 'Strong ≥ +0,35 · Good ≥ +0,10 · Neutral · Weak < −0,10 · Very weak < −0,35.')],
  Score: [X('Average of the pillar scores, from −1 (worst in sector) to +1 (best).', 'Media scorurilor pilonilor, de la −1 (cel mai slab din sector) la +1 (cel mai bun).'), X('Hover a score for the pillars behind it.', 'Treci cu mouse-ul peste scor pentru pilonii din spatele lui.')],
  'Forward P/E': [X('Price paid per dollar of expected profit; lower is cheaper.', 'Prețul plătit pentru un dolar de profit așteptat; mai mic = mai ieftin.'), FUND_INFO.forwardPE[1]],
  'Net margin': [FUND_INFO.netMargin[0], FUND_INFO.netMargin[1]],
  'Revenue growth': [FUND_INFO.revenueGrowth[0], FUND_INFO.revenueGrowth[1]],
  Data: [X('How many of the 32 metrics had data.', 'Câte dintre cele 32 de metrici au avut date.'), X('Hover a value for what is missing.', 'Treci cu mouse-ul peste valoare pentru ce lipsește.')]
};
const fundTh = (label, tipSpec) => exTip(h('th', null, tr(label)), label, [exRow('What it shows', tr(tipSpec[0])), exRow('Calculation', tr(tipSpec[1]))]);
function fundDetail(symbol) {
  const f = fundOf(symbol);
  if (!f) return h('div', { class: 'empty' }, tr('No fundamental data for this stock.'));
  const med = FUND.data.sectorMedians[f.sector] || {};
  const groups = FUND.data.pillars.map(p => {
    const rows = FUND.data.metrics.filter(m => m.pillar === p.key);
    return h('div', { class: 'tv-group' }, h('div', { class: 'tv-head' }, exHover(h('b', null, tr(p.label)), () => fundPillarTip(p, f)), techGauge(f.pillars[p.key])),
      h('table', { class: 'pf-tbl fd-tbl' }, h('thead', null, h('tr', null, [tr('Metric'), tr('Value'), tr('Sector median'), tr('Rank in sector')].map(x => h('th', null, x)))),
        h('tbody', null, rows.map(m => exHover(h('tr', { class: f.metrics[m.key] == null ? 'fd-missing' : '' },
          h('td', null, tr(m.label), h('small', { class: 'muted' }, m.higherIsBetter ? ' ↑' : ' ↓')),
          h('td', { class: 'notr' }, f.metrics[m.key] == null ? h('span', { class: 'muted' }, tr('no data')) : fundValue(m.key, f.metrics[m.key])),
          h('td', { class: 'notr muted' }, fundValue(m.key, med[m.key])), h('td', null, f.ranks[m.key] != null ? techGauge(f.ranks[m.key]) : '—')), () => fundMetricTip(m, f, med))))));
  });
  const reports = (f.reports || []).filter(r => r.report_date);
  const st = fundData(f), miss = fundMissing(f);
  const banner = st === 'ok' ? null : exBanner(st === 'none' ? 'bad' : 'warn', st === 'none' ? tr('Not enough data for a score: fewer than 3 of the 7 pillars have figures.') : tr('Little data: only') + ' ' + nf(f.coverage * 100, 0) + '% ' + tr('of the 32 metrics are available, so treat the verdict with caution.'), miss.length ? ' ' + tr('Missing') + ': ' + miss.map(m => tr(m.label)).join(', ') + '.' : '');
  return h('div', { class: 'tech-detail' }, banner,
    h('p', { class: 'tech-sum-line' }, fundSummary(f), h('span', { class: 'muted small notr' }, ' · ' + f.sector + (f.industry ? ' / ' + f.industry : ''))),
    h('div', { class: 'fd-facts' },
      exHover(h('div', { class: 'tf' }, h('small', null, tr('Equity Rank strength')), h('b', { class: 'notr' }, num(f.erStrength) ? nf(f.erStrength, 0) + (f.erGrade ? ' · ' + f.erGrade : '') : '—')), () => tipHtml('Equity Rank strength', [exRow('What it shows', tr(X('Overall fundamental strength score from Equity Rank, 0–100, with a letter grade.', 'Scorul general de forță fundamentală de la Equity Rank, 0–100, cu o notă literă.')))], X('Published by Equity Rank; shown for comparison and not part of our score.', 'Publicat de Equity Rank; afișat pentru comparație și nu face parte din scorul nostru.'))),
      exHover(h('div', { class: 'tf' }, h('small', null, tr('Trailing P/E')), h('b', { class: 'notr' }, num(f.trailingPE) ? nf(f.trailingPE, 1) : '—')), () => tipHtml('Trailing P/E', [exRow('Calculation', tr(X('Price ÷ earnings per share of the last 12 months.', 'Preț ÷ profit pe acțiune din ultimele 12 luni.')))], X('Lower means a cheaper price per dollar of past profit; compare it only with the same sector.', 'Mai mic = preț mai ieftin pe dolar de profit trecut; compară doar în același sector.'))),
      exHover(h('div', { class: 'tf' }, h('small', null, tr('Beta')), h('b', { class: 'notr' }, num(f.beta) ? nf(f.beta, 2) : '—')), () => tipHtml('Beta', [exRow('What it shows', tr(X('How much the stock moves compared with the market.', 'Cât se mișcă acțiunea față de piață.')))], X('1 = moves like the S&P 500, above 1 = swings more, below 1 = swings less.', '1 = se mișcă ca S&P 500, peste 1 = oscilează mai mult, sub 1 = mai puțin.'))),
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
  const howto = h('p', { class: 'muted small ex-howto' }, tr(X('How to read: every figure is compared with companies of the same sector (−1 = worst, +1 = best). Seven pillars average those ranks into one score and a verdict. Hover any underlined figure to see what it means, how it is calculated and what the number says; click a row for all 32 metrics. Missing data is flagged and never estimated.', 'Cum citești: fiecare cifră e comparată cu companiile din același sector (−1 = cel mai slab, +1 = cel mai bun). Șapte piloni mediază aceste ranguri într-un scor și un verdict. Treci cu mouse-ul peste orice cifră subliniată ca să vezi ce înseamnă, cum se calculează și ce spune numărul; apasă pe un rând pentru toate cele 32 de metrici. Datele lipsă sunt marcate și niciodată estimate.')));
  const head = h('tr', null, h('th', null, tr('Stock')), fundTh('Verdict', fundHeadTip.Verdict), fundTh('Score', fundHeadTip.Score),
    ...pillars.map(p => exHover(h('th', null, tr(p.label)), () => tipHtml(p.label, [exRow('What it shows', tr(FUND_PILLAR_INFO[p.key])), exRow('Metrics', FUND.data.metrics.filter(m => m.pillar === p.key).map(m => tr(m.label)).join(', '))],
      X('Mean of the ranks of its metrics against companies of the same sector, −1 worst to +1 best.', 'Media rangurilor metricilor ei față de companiile din același sector, −1 cel mai slab, +1 cel mai bun.')))),
    fundTh('Forward P/E', fundHeadTip['Forward P/E']), fundTh('Net margin', fundHeadTip['Net margin']), fundTh('Revenue growth', fundHeadTip['Revenue growth']), fundTh('Data', fundHeadTip.Data));
  const body = symbols.map(sym => {
    const f = fundOf(sym), stock = universe().find(x => x.symbol === sym) || { company: '' }, open = FUND.open === sym;
    return h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: () => { FUND.open = open ? null : sym; App.render(); } },
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, stock.company + (top.some(r => r.symbol === sym) ? '' : ' · ' + tr('added')))))),
      h('td', null, f ? exHover(fundChip(f.category), () => fundScoreTip(f)) : '—'), h('td', null, f ? exHover(h('span', null, techGauge(f.score)), () => fundScoreTip(f)) : '—'),
      ...pillars.map(p => h('td', null, f ? exHover(h('span', null, techGauge(f.pillars[p.key])), () => fundPillarTip(p, f)) : '—')),
      ...['forwardPE', 'netMargin'].map(k => h('td', { class: 'notr' }, f ? exHover(h('span', null, fundValue(k, f.metrics[k])), () => fundMetricTip(FUND.data.metrics.find(m => m.key === k), f, FUND.data.sectorMedians[f.sector] || {})) : '—')),
      h('td', { class: 'notr ' + plClass(f?.metrics.revenueGrowth) }, f ? exHover(h('span', null, fundValue('revenueGrowth', f.metrics.revenueGrowth)), () => fundMetricTip(FUND.data.metrics.find(m => m.key === 'revenueGrowth'), f, FUND.data.sectorMedians[f.sector] || {})) : '—'), h('td', { class: 'notr' }, f ? exHover(h('span', { class: 'tech-verdict agent-' + ({ ok: 'good', low: 'mid', none: 'bad' })[fundData(f)] }, nf(f.coverage * 100, 0) + '% · ' + tr(FUND_DATA_TXT[fundData(f)])), () => fundDataTip(f)) : '—'));
  });
  const options = universe().map(r => r.symbol).filter(s => fundOf(s)).sort();
  const picker = h('div', { class: 'row' }, h('span', { class: 'muted small' }, tr('Analyse another stock:')),
    selectEl([['', '—'], ...options.map(s => [s, s])], FUND.extra, v => { FUND.extra = v; FUND.open = v || FUND.open; App.render(); }, 'sel csel'),
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Computed') + ' ' + new Date(FUND.data.at).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  const openStock = FUND.open && symbols.includes(FUND.open) ? FUND.open : null;
  const detail = openStock ? card(openStock + ' · ' + ((universe().find(x => x.symbol === openStock) || {}).company || ''), tr('Every metric with its sector median and rank; click the row again to close.'), fundDetail(openStock), null, 'c12') : null;
  return h('div', null, heading, howto, kpis, card(null, null, h('div', null, picker, h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl fund-tbl' }, h('thead', null, head), h('tbody', null, body))),
      openStock ? null : h('p', { class: 'muted small' }, tr('Click a stock for every metric.'))), null, 'c12'), detail,
    h('p', { class: 'muted small mt' }, tr('Sources:'), ' Yahoo Finance · ', ivLink('Equity Rank', 'https://www.equity-rank.com/'), ' · ', ivLink('Zyberno', 'https://zyberno.com/brina-gap/'), ' (CC BY 4.0). ',
      tr('Rank in sector = percentile among the companies of the same sector with that metric (−1 worst … +1 best; the whole universe when fewer than five peers have it). Pillar = mean of its ranks; score = mean of the pillars (at least three needed); Strong from +0.35, Good from +0.1, Weak below −0.1, Very weak below −0.35. Dividend metrics count only for companies that pay one. Data can lag the latest filings; not investment advice.')));
};
