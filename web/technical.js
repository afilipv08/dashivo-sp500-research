'use strict';
/* ================= Technical analysis: 33 indicator votes per stock, computed at build time (technical.py → data/technical.json) ================= */
const TECH = { data: null, loading: false, error: '', open: null, extra: '' };
const TECH_GROUPS = [['ma', 'Moving averages'], ['osc', 'Oscillators'], ['volume', 'Volume'], ['strength', 'Relative strength']];
const TECH_CAT_CLASS = { 'Strong Buy': 'good', Buy: 'good', Neutral: 'mid', Sell: 'bad', 'Strong Sell': 'bad' };
async function techLoad() {
  if (TECH.loading || TECH.data) return;
  TECH.loading = true;
  try { TECH.data = await runRequest('/api/technical'); TECH.error = ''; } catch (e) { TECH.error = e.message || 'Technical analysis data is unavailable.'; }
  TECH.loading = false;
  if (['technical', 'summary', 'sectors'].includes(App.route())) App.render();
}
const techOf = symbol => TECH.data?.stocks?.[symbol] || null;
/* the short verdict other pages show (Verdict, Sectors): the composite rating of this page */
function techVerdict(symbol) {
  const t = techOf(symbol); if (!t || !t.rating.category) return null;
  const c = t.rating.category;
  return { vote: c.includes('Buy') ? 1 : c.includes('Sell') ? -1 : 0, text: tr(c) + (t.indicators.rsi != null ? ' · RSI ' + nf(t.indicators.rsi, 0) : ''), title: techSummary(t) };
}
const techChip = (cat, extra) => cat ? h('span', { class: 'tech-verdict agent-' + (TECH_CAT_CLASS[cat] || 'mid') }, tr(cat) + (extra || '')) : h('span', { class: 'muted' }, '—');
const techScore = v => num(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), 2) : '—';
/* a −1…+1 gauge: the bar grows from the middle towards buy (right) or sell (left) */
function techGauge(v) {
  if (!num(v)) return h('span', { class: 'muted' }, '—');
  const width = Math.min(50, Math.abs(v) * 50);
  return h('div', { class: 'tg', title: techScore(v) }, h('i', { class: v >= 0 ? 'up' : 'down', style: { width: width + '%', [v >= 0 ? 'left' : 'right']: '50%' } }), h('b', { class: 'notr' }, techScore(v)));
}
function techSummary(t) {
  const r = t.rating, ind = t.indicators, parts = [];
  parts.push(tr('Composite') + ' ' + tr(r.category) + ' (' + techScore(r.composite) + ')');
  if (t.weekly?.category) parts.push(tr('weekly') + ' ' + tr(t.weekly.category));
  if (ind.adx != null) parts.push(ind.adx >= 25 ? tr('strong trend') + ' (ADX ' + nf(ind.adx, 0) + ')' : tr('weak trend') + ' (ADX ' + nf(ind.adx, 0) + ')');
  if (ind.rsi != null && (ind.rsi > 70 || ind.rsi < 30)) parts.push(ind.rsi > 70 ? tr('overbought') + ' (RSI ' + nf(ind.rsi, 0) + ')' : tr('oversold') + ' (RSI ' + nf(ind.rsi, 0) + ')');
  if (num(t.relative?.['6m'])) parts.push(tr('vs S&P 500, 6 months') + ' ' + signedPct(t.relative['6m']));
  return parts.join(' · ');
}
function techVotes(t) {
  return h('div', { class: 'tv-groups' }, TECH_GROUPS.map(([key, label]) => {
    const votes = Object.entries(t.votes[key] || {}), up = votes.filter(([, v]) => v > 0).length, down = votes.filter(([, v]) => v < 0).length;
    return h('div', { class: 'tv-group' }, h('div', { class: 'tv-head' }, h('b', null, tr(label)), techGauge(t.rating[key]), h('small', { class: 'muted notr' }, '▲ ' + up + ' · ▼ ' + down + ' / ' + votes.length)),
      h('div', { class: 'tv-list' }, votes.map(([name, v]) => h('span', { class: 'tv-vote ' + (v == null ? 'tv-na' : v > 0 ? 'tv-buy' : v < 0 ? 'tv-sell' : 'tv-flat'), title: v == null ? tr('Not enough history') : '' },
        h('span', { class: 'notr' }, tr(name)), h('b', null, v == null ? '—' : v > 0 ? tr('Buy') : v < 0 ? tr('Sell') : tr('Neutral'))))));
  }));
}
function techFacts(t) {
  const i = t.indicators, l = t.levels, row = (label, value, tip) => h('div', { class: 'tf', title: tip ? tr(tip) : '' }, h('small', null, tr(label)), h('b', { class: 'notr' }, value ?? '—'));
  const pct = v => num(v) ? nf(v * 100, 1) + '%' : '—';
  return h('div', { class: 'tf-grid' },
    row('RSI 14', i.rsi != null ? nf(i.rsi, 1) : null, 'Below 30 oversold, above 70 overbought'),
    row('Stochastic %K / %D', i.stochK != null ? nf(i.stochK, 0) + ' / ' + nf(i.stochD, 0) : null),
    row('ADX · +DI / −DI', i.adx != null ? nf(i.adx, 0) + ' · ' + nf(i.plusDI, 0) + ' / ' + nf(i.minusDI, 0) : null, 'ADX above 25 = strong trend; +DI above −DI = up direction'),
    row('MACD / signal', i.macd != null ? nf(i.macd, 2) + ' / ' + nf(i.macdSignal, 2) : null),
    row('CCI 20', i.cci != null ? nf(i.cci, 0) : null), row('Money Flow Index', i.mfi != null ? nf(i.mfi, 0) : null), row('Chaikin Money Flow', i.cmf != null ? nf(i.cmf, 2) : null),
    row('Price vs SMA 50', i.sma50 ? signedPct(t.price / i.sma50 - 1) : null), row('Price vs SMA 200', i.sma200 ? signedPct(t.price / i.sma200 - 1) : null),
    row('Last MA cross', t.cross ? (t.cross.type === 'golden' ? tr('Golden cross') : tr('Death cross')) + ' · ' + t.cross.date : null, 'SMA 50 crossing SMA 200'),
    row('ATR 14 (% of price)', pct(i.atrPct)), row('Volatility, 30 days', pct(i.volatility30), 'Annualized'), row('Bollinger %B · width', i.bbPercent != null ? nf(i.bbPercent, 2) + ' · ' + pct(i.bbWidth) : null, '%B above 1 = above the upper band, below 0 = below the lower band'),
    row('Volume, 20 vs 60 days', i.volumeRatio != null ? nf(i.volumeRatio, 2) + '×' : null),
    row('Support / resistance', (l.support ? usd1(l.support) : '—') + ' / ' + (l.resistance ? usd1(l.resistance) : '—'), 'Nearest swing low below and swing high above the price, last 120 days'),
    row('Pivot · S1 · R1', l.pivot ? usd1(l.pivot) + ' · ' + usd1(l.s1) + ' · ' + usd1(l.r1) : null, 'Classic pivot points from the last day'),
    row('52-week range', l.low52 ? usd1(l.low52) + ' – ' + usd1(l.high52) + ' (' + pct(l.position52) + ')' : null),
    row('Return 1 / 3 / 6 / 12 months', ['1m', '3m', '6m', '12m'].map(k => signedPct(t.returns[k])).join(' · ')),
    row('vs S&P 500, 3 / 6 / 12 months', ['3m', '6m', '12m'].map(k => signedPct(t.relative[k])).join(' · ')));
}
function techTrack(track, title) {
  if (!track) return null;
  const rows = technicalCats().filter(c => track.byCategory[c]);
  return h('div', null, h('div', { class: 'up' }, title),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl tt-tbl' }, h('thead', null, h('tr', null, [tr('Verdict that day'), tr('Days'), tr('Avg. return'), tr('vs S&P 500'), tr('Rose')].map(x => h('th', null, x)))),
      h('tbody', null, rows.map(c => { const r = track.byCategory[c];
        return h('tr', null, h('td', null, techChip(c)), h('td', { class: 'notr' }, nf(r.days)), h('td', { class: 'notr ' + plClass(r.avgReturn) }, signedPct(r.avgReturn)),
          h('td', { class: 'notr ' + plClass(r.avgExcess) }, signedPct(r.avgExcess)), h('td', { class: 'notr' }, nf(r.hitRate * 100, 0) + '%')); })))));
}
const technicalCats = () => ['Strong Buy', 'Buy', 'Neutral', 'Sell', 'Strong Sell'];
function techDetail(symbol) {
  const t = techOf(symbol);
  if (!t) return h('div', { class: 'empty' }, tr('No technical data for this stock (no price history from Yahoo Finance).'));
  return h('div', { class: 'tech-detail' },
    h('p', { class: 'tech-sum-line' }, techSummary(t), h('span', { class: 'muted small notr' }, ' · ' + tr('Data until') + ' ' + t.asOf + ' · ' + t.bars + ' ' + tr('days'))),
    techVotes(t),
    h('div', { class: 'tech-cols' }, techFacts(t), techTrack(t.track, tr('This stock: how the daily verdict did over the next 20 trading days (last year)'))));
}
function techUniverseTrack() {
  const tr_ = TECH.data?.track; if (!tr_) return null;
  const horizons = tr_.horizons.map(String), cats = technicalCats();
  const block = (rating, label) => h('div', { class: 'tt-block' }, h('div', { class: 'up' }, tr(label)),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl tt-tbl' },
      h('thead', null, h('tr', null, [tr('Verdict that day'), ...horizons.map(x => x + ' ' + tr('days') + ' · ' + tr('vs S&P 500'))].map(x => h('th', null, x)))),
      h('tbody', null, [...cats.map(c => h('tr', null, h('td', null, techChip(c)), ...horizons.map(hz => { const r = tr_.ratings[rating][hz][c];
          return h('td', { class: 'notr ' + plClass(r?.avgExcess), title: r ? nf(r.days) + ' ' + tr('days') + ' · ' + tr('beat the index') + ' ' + nf(r.beatRate * 100, 0) + '%' : '' }, r ? signedPct(r.avgExcess) : '—'); }))),
        h('tr', { class: 'tt-spread' }, h('td', null, h('b', null, tr('Strong Buy − Strong Sell'))), ...horizons.map(hz => { const v = tr_.ratings[rating][hz]._spread;
          return h('td', { class: 'notr ' + plClass(v) }, h('b', null, signedPct(v))); }))]))));
  return card('Track record', tr('Every stock, every day from') + ' ' + tr_.from + ' ' + tr('to') + ' ' + tr_.to + ' (' + tr_.stocks + ' ' + tr('stocks') + '): ' + tr('the average return over the S&P 500 in the following days, grouped by the verdict of that day. A positive Strong Buy − Strong Sell line means the verdict pointed the right way.'),
    h('div', null, h('div', { class: 'tt-wrap' }, block('composite', 'Composite verdict (this page)'), block('tv', 'TradingView rating only (moving averages + oscillators)')),
      h('p', { class: 'muted small' }, tr('Hover a cell for the number of days and how often the stock beat the index. Windows overlap (one starts every day), so the days are not independent; one year of a strong market is a single sample. A past edge is not a promise.'))), null, 'c12');
}
Views.technical = () => {
  techLoad();
  const heading = card('Technical analysis', 'For the current Top 10: 33 indicator votes in four groups (15 moving averages and 11 oscillators per TradingView\'s Technical Ratings rules, 4 volume and 3 relative-strength checks), a weekly rating, levels, and the measured track record of the verdict. Click a stock for every vote and value. Indicators describe past prices; they are not forecasts.', null, null, 'c12');
  if (TECH.error && !TECH.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, TECH.error)));
  if (!TECH.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  if (!selected) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))));
  const symbols = [...top.map(r => r.symbol)];
  if (TECH.extra && !symbols.includes(TECH.extra)) symbols.push(TECH.extra);
  const counts = {}; symbols.forEach(s => { const c = techOf(s)?.rating.category; if (c) counts[c] = (counts[c] || 0) + 1; });
  const kpis = h('div', { class: 'kpis' }, ...technicalCats().map(c => kpi(tr(c), String(counts[c] || 0), tr('of the stocks shown'))));
  const head = h('tr', null, ['Stock', 'Verdict', 'Score', 'TradingView', 'Weekly', ...TECH_GROUPS.map(([, l]) => l), 'RSI', 'ADX', 'Support / resistance', '3 months', 'vs S&P 500, 6 months'].map(x => h('th', null, tr(x))));
  const body = [];
  symbols.forEach(sym => {
    const t = techOf(sym), stock = universe().find(x => x.symbol === sym) || { symbol: sym, company: '' }, open = TECH.open === sym;
    body.push(h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: () => { TECH.open = open ? null : sym; App.render(); } },
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, stock.company + (top.some(r => r.symbol === sym) ? '' : ' · ' + tr('added')))))),
      h('td', null, t ? techChip(t.rating.category) : '—'), h('td', null, t ? techGauge(t.rating.composite) : '—'), h('td', null, t ? techChip(t.rating.tvCategory) : '—'), h('td', null, t?.weekly ? techChip(t.weekly.category) : '—'),
      ...TECH_GROUPS.map(([k]) => h('td', null, t ? techGauge(t.rating[k]) : '—')),
      h('td', { class: 'notr' }, t?.indicators.rsi != null ? nf(t.indicators.rsi, 0) : '—'), h('td', { class: 'notr' }, t?.indicators.adx != null ? nf(t.indicators.adx, 0) : '—'),
      h('td', { class: 'notr small' }, t ? (t.levels.support ? usd1(t.levels.support) : '—') + ' / ' + (t.levels.resistance ? usd1(t.levels.resistance) : '—') : '—'),
      h('td', { class: 'notr ' + plClass(t?.returns['3m']) }, t ? signedPct(t.returns['3m']) : '—'), h('td', { class: 'notr ' + plClass(t?.relative['6m']) }, t ? signedPct(t.relative['6m']) : '—')));
  });
  const options = universe().map(r => r.symbol).filter(s => techOf(s)).sort();
  const picker = h('div', { class: 'row' }, h('span', { class: 'muted small' }, tr('Analyse another stock:')),
    selectEl([['', '—'], ...options.map(s => [s, s])], TECH.extra, v => { TECH.extra = v; TECH.open = v || TECH.open; App.render(); }, 'sel csel'),
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Computed') + ' ' + new Date(TECH.data.at).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  const openStock = TECH.open && symbols.includes(TECH.open) ? TECH.open : null;
  const detail = openStock ? card(openStock + ' · ' + ((universe().find(x => x.symbol === openStock) || {}).company || ''), tr('Every vote and value; click the row again to close.'), techDetail(openStock), null, 'c12 tech-detail-card') : null;
  return h('div', null, heading, kpis, card(null, null, h('div', null, picker, h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl tech-tbl' }, h('thead', null, head), h('tbody', null, body))),
      openStock ? null : h('p', { class: 'muted small' }, tr('Click a stock for every vote and value.'))), null, 'c12'), detail,
    techUniverseTrack(),
    h('p', { class: 'muted small mt' }, tr('Votes: moving averages buy when below the price; oscillators follow TradingView\'s published conditions; volume uses OBV vs its 20-day average, Chaikin Money Flow (±0.05), MFI and up vs down volume; relative strength compares 3- and 6-month and 12-1 month returns with the S&P 500 (±2 points). Group score = mean of its votes; composite = mean of the four groups; Strong Buy above +0.5, Buy above +0.1, Sell below −0.1, Strong Sell below −0.5. Source: Yahoo Finance daily prices, adjusted. Not investment advice.')));
};
