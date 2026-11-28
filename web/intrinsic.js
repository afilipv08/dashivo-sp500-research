'use strict';
/* ---------- external and calculated per-share value estimates ---------- */
const INTRINSIC = { data: null, loading: false, loaded: false, error: '' };
const ivTickerKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function ivLookup(rows, symbol) {
  if (!rows) return null;
  if (rows[symbol]) return rows[symbol];
  const key = ivTickerKey(symbol);
  return Object.entries(rows).find(([ticker]) => ivTickerKey(ticker) === key)?.[1] || null;
}
function ivDate(value) { return value ? String(value).slice(0, 10) : '—'; }
function ivLink(label, href, cls = 'iv-link') {
  return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, label);
}
function ivUnavailable(reason) {
  return h('div', { class: 'iv-unavailable', title: reason || tr('No verified estimate is available for this stock.') }, tr('Unavailable'),
    reason ? h('small', null, reason) : null);
}
function ivValue(value, sourceDate, title, prefix = '') {
  return h('div', { class: 'iv-value', title: title || '' },
    num(value) && value > 0 ? prefix + usd1(value) : ivUnavailable(title),
    sourceDate ? h('small', { class: 'iv-date' }, tr('Source date') + ': ' + ivDate(sourceDate)) : null);
}
function ivMethodCell(method, sourceStatus) {
  if (!method) {
    const reason = sourceStatus === 'contact_required' ? tr('SEC contact secret is not configured.') : tr('No filing data is available for this method.');
    return h('td', null, ivUnavailable(reason));
  }
  const details = [method.reason, method.inputs && Object.entries(method.inputs).map(([k, v]) => k + ': ' + (num(v) ? nf(v, 3) : v)).join(' · '),
    method.assumptions && Object.entries(method.assumptions).map(([k, v]) => k + ': ' + (num(v) ? nf(v * (Math.abs(v) <= 1 ? 100 : 1), 1) + (Math.abs(v) <= 1 ? '%' : '') : v)).join(' · ')].filter(Boolean).join('\n');
  return h('td', null, num(method.value) && method.value > 0 ? ivValue(method.value, method.inputs?.filed || method.inputs?.fiscalYear || method.inputs?.asOf, details) : ivUnavailable(method.reason || details));
}
function ivSourceCell(source, symbol, kind) {
  const item = ivLookup(source?.rows, symbol);
  if (!item || !num(item.value) || item.value <= 0) {
    const reason = source?.status === 'rate_limited' ? tr('Provider temporarily rate-limited this source.')
      : source?.status === 'unavailable' ? tr('Provider data is temporarily unavailable.')
        : item?.reason || tr('No usable per-share estimate or conversion inputs are available.');
    return h('td', null, ivUnavailable(reason));
  }
  if (kind === 'zyberno') {
    const formula = 'Approximate per share = company intrinsic value / (market capitalization / source price). '
      + 'Company value: ' + usd1(item.companyValue) + '; market cap: ' + usd1(item.marketCap) + '; source price: ' + usd1(item.sourcePrice)
      + '; implied shares: ' + nf(item.impliedShares, 0) + '. Snapshot: ' + (item.snapshotDate || '—');
    return h('td', null, ivLink('~' + usd1(item.value), 'https://zyberno.com/brina-gap/' + encodeURIComponent(symbol) + '/', 'iv-value iv-link'),
      h('small', { class: 'iv-date', title: formula }, tr('Source date') + ': ' + ivDate(item.asOf || item.snapshotDate)),
      h('small', { class: 'iv-date' }, tr('Approximate per share')));
  }
  const details = 'Equity Rank blended model fair-value estimate; batch price: ' + usd1(item.price) + '; not a price target or forecast.';
  return h('td', null, ivLink(usd1(item.value), 'https://www.equity-rank.com/', 'iv-value iv-link'),
    h('small', { class: 'iv-date', title: details }, tr('Source date') + ': ' + ivDate(item.asOf)));
}
function ivFvcCell(symbol, template) {
  const url = (template || 'https://www.fairvalue-calculator.com/embed/{}.svg').replace('{}', encodeURIComponent(symbol));
  const page = 'https://www.fairvalue-calculator.com/stock/' + encodeURIComponent(symbol) + '?utm_source=embed&utm_medium=badge';
  const image = h('img', { class: 'iv-fvc', src: url, alt: tr('Fair Value Calculator per-share estimate for') + ' ' + symbol,
    loading: 'lazy', referrerpolicy: 'no-referrer' });
  image.addEventListener('error', () => image.replaceWith(ivUnavailable(tr('Fair Value Calculator has no available embed for this stock.'))), { once: true });
  return h('td', null, ivLink(image, page, 'iv-fvc-link'));
}
function ivLivePrice(stock) {
  const live = LIVE.prices?.[stock.symbol];
  if (num(live) && live > 0) return h('div', { class: 'iv-value' }, usd1(live), h('small', { class: 'iv-date' }, tr('Live')));
  return h('div', { class: 'iv-unavailable' }, usd1(stock.price), h('small', null, tr('Report price; live quote unavailable')));
}
/* every positive per-share estimate for a stock (SEC filings first, trailing-twelve-month values otherwise) and their median against the price */
function ivEstimates(stock, sources) {
  const live = LIVE.prices?.[stock.symbol], price = num(live) && live > 0 ? live : stock.price;
  const sec = ivLookup(sources.sec?.rows, stock.symbol) || {}, ttm = ivLookup(sources.ttm?.rows, stock.symbol) || {};
  const pick = (a, b) => (a?.value ? a : b);
  const list = [['Equity Rank', ivLookup(sources.equityRank?.rows, stock.symbol)?.value], ['Zyberno', ivLookup(sources.zyberno?.rows, stock.symbol)?.value],
    ['DCF', pick(sec.dcf, ttm.dcf)?.value], ['Graham', pick(sec.graham, ttm.graham)?.value], ['DDM', pick(sec.ddm, ttm.ddm)?.value]]
    .filter(([, v]) => num(v) && v > 0).map(([source, value]) => ({ source, value })).sort((a, b) => a.value - b.value);
  const n = list.length, mid = n % 2 ? list[(n - 1) / 2].value : n ? (list[n / 2 - 1].value + list[n / 2].value) / 2 : null;
  return { price, list, n, median: mid, upside: mid != null && num(price) && price > 0 ? mid / price - 1 : null };
}
function ivMedianCell(est) {
  if (est.n < 2) return h('td', null, ivUnavailable(tr('At least two estimates are needed.')));
  const tip = est.list.map(x => x.source + ' ' + usd1(x.value)).join(' · ');
  return h('td', null, h('div', { class: 'iv-value', title: tip }, usd1(est.median), h('small', { class: 'iv-delta ' + plClass(est.upside) }, signedPct(est.upside) + ' ' + tr('vs price')),
    h('small', { class: 'iv-date' }, est.n + ' ' + tr('estimates') + ' · ' + usd1(est.list[0].value) + '–' + usd1(est.list.at(-1).value))));
}
function ivLoad() {
  if (INTRINSIC.loaded || INTRINSIC.loading) return;
  INTRINSIC.loading = true;
  runRequest('/api/intrinsic-values').then(data => { INTRINSIC.data = data; INTRINSIC.error = ''; })
    .catch(error => { INTRINSIC.error = error.message || tr('Intrinsic-value data is unavailable.'); })
    .finally(() => { INTRINSIC.loading = false; INTRINSIC.loaded = true; if (['intrinsic', 'summary', 'sectors'].includes(App.route())) App.render(); });
}
function ivMethodGuide() {
  const a = INTRINSIC.data?.assumptions || { dcf_growth: .05, terminal_growth: .025, discount_rate: .09, years: 5, graham_multiplier: 22.5, ddm_required_return: .09 };
  return h('div', { class: 'iv-guide' },
    h('article', { class: 'iv-guide-item' }, h('b', null, tr('DCF · free cash flow')),
      h('p', null, tr('Five-year DCF: latest annual (operating cash flow − capital expenditure) per diluted share, grown for five years and discounted; includes a terminal value.')),
      h('small', null, tr('Assumptions') + ': ' + nf(a.dcf_growth * 100, 1) + '% ' + tr('growth') + ' · ' + nf(a.discount_rate * 100, 1) + '% ' + tr('discount rate') + ' · ' + nf(a.terminal_growth * 100, 1) + '% ' + tr('terminal growth'))),
    h('article', { class: 'iv-guide-item' }, h('b', null, tr('Graham Number')),
      h('p', null, '√(' + nf(a.graham_multiplier, 1) + ' × ' + tr('diluted EPS') + ' × ' + tr('book value per share') + '). Positive annual EPS and common equity are required.'),
      h('small', null, tr('Filing-derived annual inputs; unavailable when missing or non-positive.'))),
    h('article', { class: 'iv-guide-item' }, h('b', null, tr('Gordon-growth DDM')),
      h('p', null, tr('Next annual dividend per share ÷ (required return − perpetual dividend growth).')),
      h('small', null, tr('Assumptions') + ': ' + nf(a.ddm_required_return * 100, 1) + '% ' + tr('required return') + ' · ' + nf(a.terminal_growth * 100, 1) + '% ' + tr('dividend growth'))));
}
Views.intrinsic = () => {
  if (!INTRINSIC.loaded) ivLoad();
  const selectionRows = selection(), top = selectionRows ? ranked(selectionRows).slice(0, 10) : [];
  const data = INTRINSIC.data || {}, sources = data.sources || {}, methodsStatus = sources.sec?.status;
  const alert = methodsStatus === 'contact_required'
    ? h('div', { class: 'iv-alert' }, h('b', null, tr('SEC filings are not connected yet.')),
      ' ', tr('DCF and Graham Number use Zyberno trailing-twelve-month values (shares and book value are implied, so approximate); the dividend model needs SEC filings. Add SEC_CONTACT_EMAIL as a GitHub Actions secret to use filings; no email is published.'))
    : null;
  const body = INTRINSIC.error ? h('div', { class: 'empty' }, tr('Intrinsic-value data is unavailable.'), ' ', INTRINSIC.error)
    : !INTRINSIC.loaded ? h('div', { class: 'empty' }, tr('Loading verified source data…'))
      : !selectionRows ? h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))
        : !top.length ? h('div', { class: 'empty' }, tr('No ranked stocks in the active selection.'))
          : h('div', { class: 'iv-table-wrap' }, h('table', { class: 'iv-table' },
            h('thead', null,
              h('tr', { class: 'iv-groups' }, h('th', { rowspan: 2 }, tr('Stock')), h('th', { rowspan: 2 }, tr('Live price')),
                h('th', { colspan: 3 }, tr('External estimates')), h('th', { colspan: 3 }, tr('Calculated methods')), h('th', { rowspan: 2 }, tr('Median'))),
              h('tr', null, h('th', null, ivLink('Equity Rank', 'https://www.equity-rank.com/', 'iv-head-link')),
                h('th', null, ivLink('Fair Value Calculator', 'https://www.fairvalue-calculator.com/', 'iv-head-link')),
                h('th', null, ivLink('Zyberno · approx.', 'https://zyberno.com/', 'iv-head-link')),
                h('th', null, tr('DCF · FCF')), h('th', null, tr('Graham Number')), h('th', null, tr('Gordon DDM')))),
            h('tbody', null, top.map(stock => {
              const sec = ivLookup(sources.sec?.rows, stock.symbol) || {}, ttm = ivLookup(sources.ttm?.rows, stock.symbol) || {};   // SEC filings first, trailing-twelve-month values otherwise
              return h('tr', null,
                h('td', null, h('b', { class: 'iv-ticker notr' }, stock.symbol), h('small', { class: 'iv-company' }, stock.company)),
                h('td', null, ivLivePrice(stock)),
                ivSourceCell(sources.equityRank, stock.symbol, 'equityRank'), ivFvcCell(stock.symbol, data.fvcEmbedUrl),
                ivSourceCell(sources.zyberno, stock.symbol, 'zyberno'),
                ivMethodCell(sec.dcf?.value ? sec.dcf : ttm.dcf || sec.dcf, methodsStatus), ivMethodCell(sec.graham?.value ? sec.graham : ttm.graham || sec.graham, methodsStatus), ivMethodCell(sec.ddm?.value ? sec.ddm : ttm.ddm || sec.ddm, methodsStatus),
                ivMedianCell(ivEstimates(stock, sources)));
            }))));
  return h('div', null,
    card('Fair value', 'Active filters and ranking determine these stocks. Estimates are not price targets or investment advice.',
      h('div', null, alert, body,
        h('p', { class: 'iv-disclaimer' }, tr('External data is attributed and dated. Zyberno per-share value is approximate; source company value is divided by implied shares. Missing data is never replaced with an estimate.'))), null, 'c12'),
    card('The three methods', 'SEC Company Facts · annual filing inputs · assumptions shown with each result', ivMethodGuide(), null, 'c12'),
    card('Sources used', null, h('div', { class: 'iv-attribution' },
      h('span', null, ivLink('Equity Rank', 'https://www.equity-rank.com/') , ' · public blended model values'),
      h('span', null, ivLink('Fair Value Calculator', 'https://www.fairvalue-calculator.com/') , ' · official per-ticker SVG embed with provider attribution'),
      h('span', null, ivLink('Zyberno', 'https://zyberno.com/brina-gap/') , ' · CC BY 4.0 monthly cross-section; per-share conversion disclosed'),
      h('span', null, ivLink('SEC EDGAR Company Facts', 'https://www.sec.gov/edgar/sec-api-documentation') , ' · filing-derived inputs')),
      null, 'c12'));
};
