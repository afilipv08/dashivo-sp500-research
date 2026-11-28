'use strict';
/* ================= Fair value: 8 calculated methods + 5 external sources per stock (valuation.py → data/valuation.json) =================
   Every cell explains itself on hover (formula, inputs, assumptions), says when data was missing or the method does not apply,
   and whether the method suits the company's industry. Poorly suited methods are shown but left out of the median. */
const INTRINSIC = { data: null, loading: false, loaded: false, error: '' };   // kept for older callers; holds the valuation payload
const VAL = { open: null, extra: '' };
const FVC_EMBED = 'https://www.fairvalue-calculator.com/embed/{}.svg';
const ivTickerKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function ivLookup(rows, symbol) {
  if (!rows) return null;
  if (rows[symbol]) return rows[symbol];
  const key = ivTickerKey(symbol);
  return Object.entries(rows).find(([ticker]) => ivTickerKey(ticker) === key)?.[1] || null;
}
function ivLink(label, href, cls = 'iv-link') { return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, label); }
function ivLoad() {
  if (INTRINSIC.loaded || INTRINSIC.loading) return;
  INTRINSIC.loading = true;
  runRequest('/api/valuation').then(data => { INTRINSIC.data = data; INTRINSIC.error = ''; })
    .catch(error => { INTRINSIC.error = error.message || tr('Fair value data is unavailable.'); })
    .finally(() => { INTRINSIC.loading = false; INTRINSIC.loaded = true; if (['intrinsic', 'summary', 'sectors'].includes(App.route())) App.render(); });
}
const valOf = symbol => ivLookup(INTRINSIC.data?.stocks, symbol);
const valPrice = (symbol, fallback) => { const live = LIVE.prices?.[symbol]; return num(live) && live > 0 ? live : fallback; };
/* the median of the usable estimates against the current price, for Verdict and Sectors */
function ivEstimates(stock) {
  const v = valOf(stock.symbol); if (!v) return { n: 0, list: [] };
  const price = valPrice(stock.symbol, v.price || stock.price);
  const list = [...v.methods.filter(m => m.status === 'ok' && m.fit !== 'poor').map(m => ({ source: valLabel(m.key), value: m.value })),
    ...v.sources.filter(s => s.status === 'ok').map(s => ({ source: valLabel(s.key), value: s.value }))].sort((a, b) => a.value - b.value);
  return { price, list, n: list.length, median: v.median, upside: v.median && price ? v.median / price - 1 : null };
}
const VAL_INFO = {
  dcf: ['Discounted cash flow', 'What the company is worth today if it keeps producing free cash flow: five years of growth on today\'s free cash flow per share, then a perpetual value, all discounted at the required return.'],
  graham: ['Graham Number', 'Benjamin Graham\'s ceiling for a defensive investor: the price at which P/E × P/B equals 22.5 (P/E 15 × P/B 1.5).'],
  ddm: ['Dividend discount (Gordon)', 'The value of all future dividends, growing at a steady rate, discounted at the required return. Only for companies that pay a dividend.'],
  epv: ['Earnings power value', 'Bruce Greenwald\'s no-growth value: today\'s after-tax operating profit as a perpetuity, plus cash, minus debt. It shows what the business is worth without any growth.'],
  lynch: ['Peter Lynch fair value', 'Peter Lynch\'s rule that a fairly priced stock has a P/E equal to its earnings growth rate (plus its dividend yield).'],
  pe: ['Peer P/E multiple', 'What the company would cost at the median forward P/E of comparable companies (same sector; REITs among REITs).'],
  evEbitda: ['Peer EV/EBITDA multiple', 'What the shares would be worth if the whole business were valued at the median EV/EBITDA of comparable companies, after debt and cash.'],
  residual: ['Residual income (justified P/B)', 'Book value scaled by how much the company earns on it above the required return: P/B = (ROE − g) / (r − g). Suited to banks and insurers.'],
  equityRank: ['Equity Rank', 'Blend of 8–15 valuation models recomputed after every market close (equity-rank.com).'],
  zyberno: ['Zyberno', 'Intrinsic value from SEC filings (owner earnings and growth), published monthly under CC BY 4.0; converted here to a per-share figure with implied shares, so approximate.'],
  slate: ['Slate Finch', 'Fair value from a published formula applied to SEC filings, with a likely range (slatefinch.app). The provider withholds a value when its checks fail.'],
  sweet: ['SweetValueLab', 'Median of several models (DCF, multiples, sector-specific models for banks and REITs) from public filings, nightly, CC BY 4.0 (sweetvaluelab.com).'],
  fvc: ['Fair Value Calculator', 'Fair value from multiple models, shown with the provider\'s own badge (fairvalue-calculator.com).']
};
const VAL_LINKS = { equityRank: 'https://www.equity-rank.com/', zyberno: 'https://zyberno.com/brina-gap/', slate: 'https://www.slatefinch.app/', sweet: 'https://sweetvaluelab.com/stocks', fvc: 'https://www.fairvalue-calculator.com/' };
const valLabel = key => tr((VAL_INFO[key] || [key])[0]);
const VAL_INPUT = { freeCashFlow: 'Free cash flow', shares: 'Shares', fcfPerShare: 'FCF per share', eps: 'EPS', bookValuePerShare: 'Book value per share', annualDividend: 'Annual dividend',
  payoutRatio: 'Payout ratio', operatingProfit: 'Operating profit', cash: 'Cash', debt: 'Debt', growth: 'Growth', dividendYield: 'Dividend yield', forwardEps: 'Forward EPS',
  peerMedianPE: 'Peer median P/E', ebitda: 'EBITDA', peerMedianEvEbitda: 'Peer median EV/EBITDA', roe: 'Return on equity', discountRate: 'Discount rate',
  terminalGrowth: 'Terminal growth', years: 'Years', beta: 'Beta', multiplier: 'Multiplier', dividendGrowth: 'Dividend growth', requiredReturn: 'Required return',
  taxRate: 'Tax rate', fairPE: 'Fair P/E' };
const VAL_PCT = new Set(['growth', 'dividendYield', 'roe', 'discountRate', 'terminalGrowth', 'dividendGrowth', 'requiredReturn', 'taxRate', 'payoutRatio']);
function valFmt(key, v) {
  if (!num(v)) return '—';
  if (VAL_PCT.has(key)) return nf(v * 100, 1) + '%';
  if (['freeCashFlow', 'operatingProfit', 'cash', 'debt', 'ebitda'].includes(key)) return fundBig(v);
  if (key === 'shares') return nf(v / 1e6, 1) + ' M';
  if (['eps', 'bookValuePerShare', 'annualDividend', 'forwardEps', 'fcfPerShare'].includes(key)) return usd(v);
  return nf(v, 2);
}

/* ---------- definitions, worked calculations and reference links ---------- */
const VAL_REF = {
  dcf: 'https://en.wikipedia.org/wiki/Discounted_cash_flow', graham: 'https://en.wikipedia.org/wiki/Graham_number', ddm: 'https://en.wikipedia.org/wiki/Dividend_discount_model',
  epv: 'https://wallstreetprep.com/knowledge/earnings-power-value-epv', lynch: 'https://en.wikipedia.org/wiki/PEG_ratio', pe: 'https://en.wikipedia.org/wiki/Price%E2%80%93earnings_ratio',
  evEbitda: 'https://en.wikipedia.org/wiki/Enterprise_value', residual: 'https://en.wikipedia.org/wiki/Residual_income_valuation'
};
const VAL_BEST = {
  dcf: X('Profitable companies with positive free cash flow. Not banks and insurers.', 'Companii profitabile cu flux de numerar liber pozitiv. Nu pentru bănci și asigurători.'),
  graham: X('Asset-heavy, steady businesses (industrials, materials, utilities, energy, staples). Undervalues asset-light companies.', 'Afaceri stabile, cu multe active (industrie, materiale, utilități, energie, bunuri de bază). Subevaluează companiile cu puține active.'),
  ddm: X('Companies that pay a steady dividend (utilities, staples, financials, REITs).', 'Companii care plătesc un dividend constant (utilități, bunuri de bază, financiare, REIT).'),
  epv: X('Stable, mature businesses with steady profit. Not banks and insurers.', 'Afaceri stabile și mature, cu profit constant. Nu pentru bănci și asigurători.'),
  lynch: X('Growing companies with positive earnings growth. Not utilities.', 'Companii în creștere, cu profit în creștere pozitivă. Nu pentru utilități.'),
  pe: X('Any profitable company that has comparable peers. Less suited to REITs.', 'Orice companie profitabilă cu firme comparabile. Mai puțin potrivită pentru REIT.'),
  evEbitda: X('Companies with debt and positive EBITDA. Not banks and insurers.', 'Companii cu datorii și EBITDA pozitiv. Nu pentru bănci și asigurători.'),
  residual: X('Banks and insurers, where book value is the core of the business.', 'Bănci și asigurători, unde valoarea contabilă este nucleul afacerii.')
};
const VAL_SRC_NOTE = X('External source: the figure is computed by the provider, not by this site; open its page to see its own method.', 'Sursă externă: cifra e calculată de furnizor, nu de acest site; deschide pagina lui ca să vezi metoda proprie.');
X('Calculation with these numbers', 'Calculul cu aceste cifre'); X('Methods explained', 'Metodele explicate'); X('Definition', 'Definiție'); X('Formula', 'Formulă'); X('Best suited to', 'Potrivită pentru');
X('Reference', 'Referință'); X('Provider', 'Furnizor'); X('Open the source', 'Deschide sursa'); X('Read more', 'Citește mai mult'); X('Method', 'Metodă'); X('Source', 'Sursă');
X('after-tax operating profit', 'profit operațional după taxe'); X('capitalized at the required return', 'capitalizat la randamentul cerut'); X('plus cash, minus debt', 'plus numerar, minus datorii'); X('per share', 'pe acțiune');
X('years of growth', 'ani de creștere'); X('terminal value', 'valoare terminală'); X('Fair P/E', 'P/E corect'); X('P/E = growth + dividend yield, held between 5 and 25', 'P/E = creștere + randament dividend, limitat între 5 și 25');
function valWorked(m) {
  if (m.status !== 'ok') return [];
  const i = m.inputs || {}, a = m.assumptions || {}, u = v => usd(v), p = v => nf(v * 100, 1) + '%', big = v => fundBig(v);
  switch (m.key) {
    case 'graham': return ['√(22.5 × ' + u(i.eps) + ' × ' + u(i.bookValuePerShare) + ') = ' + u(m.value)];
    case 'dcf': {
      const f = i.fcfPerShare, g = a.growth, r = a.discountRate, gt = a.terminalGrowth, n = a.years; let pv = 0;
      for (let t = 1; t <= n; t++) pv += f * (1 + g) ** t / (1 + r) ** t;
      const tv = f * (1 + g) ** n * (1 + gt) / (r - gt) / (1 + r) ** n;
      return [tr('FCF per share') + ' ' + big(i.freeCashFlow) + ' ÷ ' + nf(i.shares / 1e6, 1) + ' M = ' + u(f), n + ' ' + tr('years of growth') + ' ' + p(g) + ', ' + tr('Discount rate') + ' ' + p(r) + ': ' + u(pv),
        tr('terminal value') + ' (g ' + p(gt) + '): ' + u(tv), u(pv) + ' + ' + u(tv) + ' = ' + u(m.value)];
    }
    case 'ddm': return [u(i.annualDividend) + ' × (1 + ' + p(a.dividendGrowth) + ') ÷ (' + p(a.requiredReturn) + ' − ' + p(a.dividendGrowth) + ') = ' + u(m.value)];
    case 'epv': {
      const nopat = i.operatingProfit * (1 - a.taxRate), eq = nopat / a.discountRate + i.cash - i.debt;
      return [tr('after-tax operating profit') + ': ' + big(i.operatingProfit) + ' × (1 − ' + p(a.taxRate) + ') = ' + big(nopat), tr('capitalized at the required return') + ' ' + p(a.discountRate) + ': ' + big(nopat / a.discountRate),
        tr('plus cash, minus debt') + ': ' + big(eq), big(eq) + ' ÷ ' + nf(i.shares / 1e6, 1) + ' M ' + tr('Shares') + ' = ' + u(m.value)];
    }
    case 'lynch': return [tr('Fair P/E') + ' = ' + p(i.growth) + ' + ' + p(i.dividendYield) + ' → ' + nf(a.fairPE, 1) + ' (' + tr('P/E = growth + dividend yield, held between 5 and 25') + ')', u(i.eps) + ' × ' + nf(a.fairPE, 1) + ' = ' + u(m.value)];
    case 'pe': return [u(i.forwardEps) + ' × ' + nf(i.peerMedianPE, 1) + ' = ' + u(m.value)];
    case 'evEbitda': return ['(' + big(i.ebitda) + ' × ' + nf(i.peerMedianEvEbitda, 1) + ' − ' + big(i.debt) + ' + ' + big(i.cash) + ') ÷ ' + nf(i.shares / 1e6, 1) + ' M = ' + u(m.value)];
    case 'residual': return [u(i.bookValuePerShare) + ' × (' + p(i.roe) + ' − ' + p(a.growth) + ') ÷ (' + p(a.requiredReturn) + ' − ' + p(a.growth) + ') = ' + u(m.value)];
    default: return [];
  }
}
const VAL_FIT = { good: ['✓', 'Suited to this industry'], limited: ['⚠', 'Limited fit for this industry'], poor: ['✕', 'Not suited to this industry'] };
/* the full explanation of one cell, as tooltip HTML */
function valTip(m, stock) {
  const [label, about] = VAL_INFO[m.key] || [m.key, ''], rows = [];
  const price = valPrice(stock.symbol, stock.v.price);
  if (m.status === 'ok') {
    rows.push(tipRow('Fair value', '<b>' + esc(usd1(m.value)) + '</b>'));
    if (num(price)) rows.push(tipRow('vs price', esc(signedPct(m.value / price - 1)) + ' (' + esc(usd1(price)) + ')'));
    if (m.low && m.high) rows.push(tipRow('Range', esc(usd1(m.low) + ' – ' + usd1(m.high))));
  } else rows.push(tipRow(m.status === 'na' ? 'Not applicable' : 'Missing data', esc(tr(m.reason || ''))));
  rows.push(tipRow('Definition', esc(tr(about))));
  if (m.formula) rows.push(tipRow('Formula', esc(m.formula)));
  valWorked(m).forEach((line, n) => rows.push(tipRow(n ? '' : 'Calculation with these numbers', '<span class="notr">' + esc(line) + '</span>')));
  if (!VAL_INFO[m.key]) rows.push(tipRow('Provider', esc(label)));
  if (VAL_LINKS[m.key]) rows.push(tipRow('Source', esc(VAL_LINKS[m.key].replace('https://', '').replace(/\/$/, ''))));
  else if (VAL_REF[m.key]) rows.push(tipRow('Reference', esc(VAL_REF[m.key].replace('https://', ''))));
  Object.entries(m.inputs || {}).forEach(([k, v]) => rows.push(tipRow(VAL_INPUT[k] || k, esc(valFmt(k, v)))));
  Object.entries(m.assumptions || {}).forEach(([k, v]) => rows.push(tipRow((VAL_INPUT[k] || k) + ' (' + tr('assumption') + ')', esc(valFmt(k, v)))));
  if (m.asOf) rows.push(tipRow('Source date', esc(String(m.asOf).slice(0, 10))));
  if (m.note) rows.push(tipRow('Note', esc(tr(m.note))));
  if (m.fit) rows.push(tipRow(VAL_FIT[m.fit][1], esc(m.fitReason ? tr(m.fitReason) : tr('Commonly used for companies like this one.'))));
  if (m.status === 'ok') rows.push(tipRow('In the median', m.fit === 'poor' ? tr('No — not suited to this industry') : tr('Yes')));
  return tipHtml(label, rows, VAL_LINKS[m.key] ? VAL_SRC_NOTE : 'Click the stock row for clickable links and the full list of explanations.');
}
function valCell(m, stock) {
  const price = valPrice(stock.symbol, stock.v.price);
  const body = m.status === 'ok'
    ? [h('b', { class: 'iv-value notr' }, usd1(m.value)), num(price) ? h('small', { class: 'iv-delta notr ' + plClass(m.value / price - 1) }, signedPct(m.value / price - 1)) : null]
    : [h('span', { class: 'iv-state' }, m.status === 'na' ? tr('Not applicable') : tr('No data'))];
  const fit = m.fit ? h('small', { class: 'iv-fit fit-' + m.fit }, VAL_FIT[m.fit][0] + ' ' + tr(m.fit === 'good' ? 'suited' : m.fit === 'limited' ? 'limited fit' : 'not suited')) : null;
  return h('td', { class: 'iv-cell iv-' + m.status + (m.fit === 'poor' ? ' iv-poor' : '') }, hoverTip(h('div', { class: 'has-tip' }, ...body, fit), () => valTip(m, stock)));
}
function valFvcCell(symbol) {
  const url = FVC_EMBED.replace('{}', encodeURIComponent(symbol)), page = 'https://www.fairvalue-calculator.com/stock/' + encodeURIComponent(symbol) + '?utm_source=embed&utm_medium=badge';
  const image = h('img', { class: 'iv-fvc', src: url, alt: tr('Fair Value Calculator per-share estimate for') + ' ' + symbol, loading: 'lazy', referrerpolicy: 'no-referrer' });
  image.addEventListener('error', () => image.replaceWith(h('span', { class: 'iv-state' }, tr('No data'))), { once: true });
  return h('td', { class: 'iv-cell' }, hoverTip(h('div', { class: 'has-tip' }, ivLink(image, page, 'iv-fvc-link')), () => tipHtml(VAL_INFO.fvc[0], [tipRow('Source', 'fairvalue-calculator.com')], VAL_INFO.fvc[1])));
}
function valMedianCell(stock) {
  const v = stock.v, price = valPrice(stock.symbol, v.price);
  if (!v.median) return h('td', null, h('span', { class: 'iv-state' }, tr('No data')));
  const up = num(price) ? v.median / price - 1 : null;
  return h('td', { class: 'iv-cell iv-median' }, hoverTip(h('div', { class: 'has-tip' }, h('b', { class: 'iv-value notr' }, usd1(v.median)), h('small', { class: 'iv-delta notr ' + plClass(up) }, signedPct(up)),
    h('small', { class: 'iv-fit notr' }, v.count + ' ' + tr('estimates'))),
    () => tipHtml('Median fair value', [tipRow('Median', esc(usd1(v.median))), tipRow('Range of estimates', esc(usd1(v.low) + ' – ' + usd1(v.high))), tipRow('Estimates used', String(v.count)),
      tipRow('vs price', esc(signedPct(up)))], 'The middle of every calculated method that suits this industry and every external source with a value. A median is used so one extreme model cannot move it.')));
}
function valDetail(stock) {
  const v = stock.v, all = [...v.sources.map(s => ({ ...s, kind: 'source' })), ...v.methods.map(m => ({ ...m, kind: 'method' }))];
  return h('div', { class: 'val-detail' }, all.map(m => {
    const holder = h('div', { class: 'val-item iv-' + m.status });
    holder.innerHTML = valTip(m, stock);
    const href = VAL_LINKS[m.key] || VAL_REF[m.key];
    if (href) holder.append(h('div', { class: 'iv-ref' }, ivLink(tr(VAL_LINKS[m.key] ? 'Open the source' : 'Read more') + ' ↗', href)));
    return holder;
  }));
}
Views.intrinsic = () => {
  ivLoad();
  const heading = card('Fair value', 'For the current Top 10: eight calculated methods and four external sources (plus the Fair Value Calculator badge). Hover any cell to see the formula, the inputs and assumptions, whether data was missing or the method does not apply, and whether the method suits this industry. Methods that do not suit the industry stay visible but are left out of the median. Estimates, not price targets or investment advice.', null, null, 'c12');
  if (INTRINSIC.error && !INTRINSIC.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, INTRINSIC.error)));
  if (!INTRINSIC.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  if (!selected) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))));
  const symbols = top.map(r => r.symbol);
  if (VAL.extra && !symbols.includes(VAL.extra)) symbols.push(VAL.extra);
  const D = INTRINSIC.data, srcKeys = D.sources.map(s => s.key).filter(k => k !== 'fvc'), methodKeys = D.methods.map(m => m.key);
  const head = h('thead', null,
    h('tr', { class: 'iv-groups' }, h('th', { rowspan: 2 }, tr('Stock')), h('th', { rowspan: 2 }, tr('Price')), h('th', { colspan: srcKeys.length + 1 }, tr('External sources')),
      h('th', { colspan: methodKeys.length }, tr('Calculated methods')), h('th', { rowspan: 2 }, tr('Median'))),
    h('tr', null, ...srcKeys.map(k => h('th', null, ivLink(valLabel(k), VAL_LINKS[k], 'iv-head-link'))), h('th', null, ivLink(valLabel('fvc'), VAL_LINKS.fvc, 'iv-head-link')),
      ...methodKeys.map(k => exHover(h('th', null, valLabel(k)), () => tipHtml(VAL_INFO[k][0], [tipRow('Definition', esc(tr(VAL_INFO[k][1]))), tipRow('Best suited to', esc(tr(VAL_BEST[k])))], 'Hover a value for the calculation with the stock’s own numbers.')))));
  const body = symbols.map(sym => {
    const v = valOf(sym), stock = universe().find(x => x.symbol === sym) || { symbol: sym, company: '', price: null }, open = VAL.open === sym;
    if (!v) return h('tr', null, h('td', null, h('b', { class: 'notr' }, sym)), h('td', { colspan: srcKeys.length + methodKeys.length + 3, class: 'muted' }, tr('No fair value data for this stock.')));
    const s = { ...stock, v }, price = valPrice(sym, v.price || stock.price);
    return h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: e => { if (e.target.closest('a')) return; VAL.open = open ? null : sym; App.render(); } },
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, (stock.company || '') + (top.some(r => r.symbol === sym) ? '' : ' · ' + tr('added'))),
        h('div', { class: 'muted small notr' }, v.industry || v.sector || '')))),
      h('td', { class: 'notr' }, h('b', null, usd1(price)), h('small', { class: 'iv-fit' }, num(LIVE.prices?.[sym]) ? tr('Live') : tr('Report price'))),
      ...srcKeys.map(k => valCell(v.sources.find(x => x.key === k) || { key: k, status: 'missing', reason: 'Not covered.' }, s)), valFvcCell(sym),
      ...methodKeys.map(k => valCell(v.methods.find(x => x.key === k), s)), valMedianCell(s));
  });
  const options = universe().map(r => r.symbol).filter(s => valOf(s)).sort();
  const picker = h('div', { class: 'row' }, h('span', { class: 'muted small' }, tr('Analyse another stock:')),
    selectEl([['', '—'], ...options.map(s => [s, s])], VAL.extra, val => { VAL.extra = val; VAL.open = val || VAL.open; App.render(); }, 'sel csel'),
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Computed') + ' ' + new Date(D.at).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  const legend = h('div', { class: 'iv-legend' }, ...Object.entries(VAL_FIT).map(([k, [icon_, text]]) => h('span', { class: 'iv-fit fit-' + k }, icon_ + ' ' + tr(text))),
    h('span', { class: 'iv-state' }, tr('No data') + ' = ' + tr('an input is missing')), h('span', { class: 'iv-state' }, tr('Not applicable') + ' = ' + tr('the method does not apply to this company (for example no dividend)')));
  const openStock = VAL.open && symbols.includes(VAL.open) && valOf(VAL.open) ? VAL.open : null;
  const detail = openStock ? card(openStock + ' · ' + tr('every estimate explained'), tr('The same explanations as on hover, all at once; click the row again to close.'),
    valDetail({ ...(universe().find(x => x.symbol === openStock) || { symbol: openStock }), v: valOf(openStock) }), null, 'c12') : null;
  const methodRows = methodKeys.map(k => {
    const sample = symbols.map(valOf).filter(Boolean).map(v => v.methods.find(x => x.key === k)?.formula).find(Boolean);
    return h('tr', null, h('td', null, h('b', null, valLabel(k))), h('td', null, tr(VAL_INFO[k][1])), h('td', { class: 'notr' }, sample || '—'), h('td', null, tr(VAL_BEST[k])), h('td', null, ivLink(tr('Read more') + ' ↗', VAL_REF[k])));
  });
  const sourceRows = [...srcKeys, 'fvc'].map(k => h('tr', null, h('td', null, h('b', null, valLabel(k))), h('td', null, tr(VAL_INFO[k][1])), h('td', { class: 'muted' }, tr('Computed by the provider')),
    h('td', null, tr('External source')), h('td', null, ivLink(tr('Open the source') + ' ↗', VAL_LINKS[k]))));
  const explained = card('Methods explained', 'What each estimate means, how it is calculated and where to read more. The calculated methods run on Yahoo Finance statistics with the assumptions below; the external sources are computed by their providers.',
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl iv-explain' }, h('thead', null, h('tr', null, ['Method', 'Definition', 'Formula', 'Best suited to', 'Reference'].map(x => h('th', null, tr(x))))),
      h('tbody', null, ...methodRows, ...sourceRows))), null, 'c12');
  const a = D.assumptions;
  const guide = card('Assumptions', null, h('p', { class: 'muted small' }, tr('Required return = risk-free rate') + ' ' + nf(a.riskFree * 100, 1) + '% + beta × ' + nf(a.equityPremium * 100, 1) + '% ' +
    tr('(held between 7% and 13%); terminal growth') + ' ' + nf(a.terminalGrowth * 100, 1) + '%; ' + tr('tax rate') + ' ' + nf(a.taxRate * 100, 0) + '%; ' +
    tr('DCF growth = revenue growth held between 0% and 12% for five years. Company data: Yahoo Finance statistics. These are baseline choices, not forecasts.')), null, 'c12');
  const credits = h('p', { class: 'muted small mt' }, tr('Sources:'), ' ', ivLink('Equity Rank', VAL_LINKS.equityRank), ' · ', ivLink('Zyberno', VAL_LINKS.zyberno), ' (CC BY 4.0) · ',
    ivLink('Slate Finch', VAL_LINKS.slate), ' · ', ivLink('SweetValueLab', VAL_LINKS.sweet), ' (CC BY 4.0) · ', ivLink('Fair Value Calculator', VAL_LINKS.fvc), ' · Yahoo Finance. ',
    D.external?.slate?.notice ? tr('Slate Finch:') + ' ' + D.external.slate.notice + ' ' : '', tr('Not investment advice.'));
  const thin = symbols.map(sym => ({ sym, v: valOf(sym) })).filter(x => x.v && x.v.count < 3);
  const thinBanner = thin.length ? exBanner('warn', tr('Few estimates for') + ' ' + thin.map(x => x.sym + ' (' + x.v.count + ')').join(', ') + '. ' + tr('With fewer than 3 usable estimates the median is not reliable; the reason for each missing one is shown on hover.')) : null;
  return h('div', null, heading, thinBanner, card(null, null, h('div', null, picker, legend, h('div', { class: 'tbl-wrap' }, h('table', { class: 'iv-table' }, head, h('tbody', null, body))),
    openStock ? null : h('p', { class: 'muted small' }, tr('Click a stock to read every estimate explained.'))), null, 'c12'), detail, explained, guide, credits);
};
