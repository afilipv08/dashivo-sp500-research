'use strict';
Object.assign(ICONS, { star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>' });
/* ================= SP500 list (whole universe, quick filters) and Favorites (stars kept on this device) ================= */
const FAV_KEY = 'dashivo-sp500-favorites';
const SCREEN_KEY = 'dashivo-sp500-screener';
const favorites = () => { const f = store.get(FAV_KEY, {}); return f && typeof f === 'object' && !Array.isArray(f) ? f : {}; };
const isFavorite = sym => !!favorites()[sym];
function toggleFavorite(r) {
  const f = favorites();
  if (f[r.symbol]) delete f[r.symbol];
  else f[r.symbol] = { at: new Date().toISOString(), price: num(LIVE.prices?.[r.symbol]) ? LIVE.prices[r.symbol] : r.price };   // the price when starred, for "since added"
  store.set(FAV_KEY, f); App.updateNav();
  return !!f[r.symbol];
}
const favStar = (r, after) => {
  const on = isFavorite(r.symbol);
  return h('button', { type: 'button', class: 'fav-star' + (on ? ' on' : ''), title: tr(on ? 'Remove from favorites' : 'Add to favorites'), 'aria-pressed': String(on),
    onclick: e => { e.stopPropagation(); const now = toggleFavorite(r); e.currentTarget.classList.toggle('on', now); e.currentTarget.textContent = now ? '★' : '☆'; e.currentTarget.title = tr(now ? 'Remove from favorites' : 'Add to favorites'); if (after) after(); } }, on ? '★' : '☆');
};
/* everything the list shows about one stock, including the verdicts of the analysis pages when their data is loaded */
function screenRow(r) {
  const live = LIVE.prices?.[r.symbol], liveChg = num(live) && r.price > 0 ? live / r.price - 1 : null;
  const t = techOf(r.symbol), f = fundOf(r.symbol), v = valOf(r.symbol), price = num(live) ? live : r.price;
  return { r, symbol: r.symbol, company: r.company, sector: r.sector, price, liveChg, consensus: consensusOf(r), total: r.total, support: r.support, upside: r.upside, distance: r.distance,
    tech: t?.rating.category || null, techScore: t?.rating.composite ?? null, fund: f?.category || null, fundScore: f?.score ?? null,
    fairGap: v?.median && price ? v.median / price - 1 : null, fair: v?.median ?? null };
}
const SCREEN_DEFAULT = () => ({ q: '', sectors: [], consensus: [], upsideMin: null, analystsMin: null, supportMin: null, distanceMax: null, fairGapMin: null, tech: '', fund: '', favOnly: false, sort: { key: 'symbol', dir: 1 } });
const SCREEN = Object.assign(SCREEN_DEFAULT(), store.get(SCREEN_KEY, {}) || {});
const saveScreen = () => store.set(SCREEN_KEY, SCREEN);
const TECH_RANK = { 'Strong Buy': 2, Buy: 1, Neutral: 0, Sell: -1, 'Strong Sell': -2 }, FUND_RANK = { Strong: 2, Good: 1, Neutral: 0, Weak: -1, 'Very weak': -2 };
const SCREEN_PRESETS = [
  ['Undervalued quality', { fairGapMin: 20, fund: 'good' }],
  ['Strong momentum', { tech: 'buy' }],
  ['Near 52-week low', { distanceMax: 5 }],
  ['Analyst favourites', { supportMin: 80, analystsMin: 15 }],
  ['Big analyst upside', { upsideMin: 25, analystsMin: 10 }]
];
function screenTest(x) {
  const s = SCREEN, q = s.q.trim().toLowerCase();
  if (q && !(x.symbol + ' ' + x.company).toLowerCase().includes(q)) return false;
  if (s.sectors.length && !s.sectors.includes(x.sector)) return false;
  if (s.consensus.length && !s.consensus.includes(x.consensus)) return false;
  if (s.upsideMin != null && !(num(x.upside) && x.upside * 100 >= s.upsideMin)) return false;
  if (s.analystsMin != null && !(num(x.total) && x.total >= s.analystsMin)) return false;
  if (s.supportMin != null && !(num(x.support) && x.support * 100 >= s.supportMin)) return false;
  if (s.distanceMax != null && !(num(x.distance) && x.distance * 100 <= s.distanceMax)) return false;
  if (s.fairGapMin != null && !(num(x.fairGap) && x.fairGap * 100 >= s.fairGapMin)) return false;
  if (s.tech === 'buy' && !(TECH_RANK[x.tech] >= 1)) return false;
  if (s.tech === 'strong' && x.tech !== 'Strong Buy') return false;
  if (s.tech === 'sell' && !(TECH_RANK[x.tech] <= -1)) return false;
  if (s.fund === 'good' && !(FUND_RANK[x.fund] >= 1)) return false;
  if (s.fund === 'strong' && x.fund !== 'Strong') return false;
  if (s.fund === 'weak' && !(FUND_RANK[x.fund] <= -1)) return false;
  if (s.favOnly && !isFavorite(x.symbol)) return false;
  return true;
}
const SCREEN_COLS = [['symbol', 'Stock'], ['price', 'Price'], ['liveChg', 'Live vs report'], ['consensus', 'Consensus'], ['total', 'Analysts'], ['support', 'Buy + SB'],
  ['upside', 'Upside'], ['distance', 'Above 52-week low'], ['techScore', 'Technical analysis'], ['fundScore', 'Fundamental analysis'], ['fairGap', 'Fair value gap']];
function screenSort(rows, sort) {
  return [...rows].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null || x === 'N/A') return 1; if (y == null || y === 'N/A') return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir || a.symbol.localeCompare(b.symbol);
  });
}
const pctCell = (v, signed_) => h('td', { class: 'notr ' + (signed_ ? plClass(v) : '') }, num(v) ? (signed_ ? signedPct(v) : nf(v * 100, 1) + '%') : '—');
function screenCells(x, extra) {
  return [
    h('td', null, h('div', { class: 'sym-cell' }, logoEl(x.symbol, 22), h('div', null, h('b', { class: 'notr' }, x.symbol), h('div', { class: 'muted small notr' }, x.company), h('div', { class: 'muted small' }, sectorIcon(x.sector, 11), ' ', h('span', { class: 'notr' }, x.sector))))),
    h('td', { class: 'notr' }, usd1(x.price)), pctCell(x.liveChg, true), h('td', { class: 'notr' }, x.consensus), h('td', { class: 'notr' }, num(x.total) ? nf(x.total) : '—'),
    pctCell(x.support), pctCell(x.upside, true), pctCell(x.distance),
    h('td', null, x.tech ? techChip(x.tech) : h('span', { class: 'muted' }, '—')), h('td', null, x.fund ? fundChip(x.fund) : h('span', { class: 'muted' }, '—')),
    h('td', { class: 'notr ' + plClass(x.fairGap), title: x.fair ? tr('Median fair value') + ' ' + usd1(x.fair) : '' }, num(x.fairGap) ? signedPct(x.fairGap) : '—'), ...(extra || [])];
}
Views.screener = () => {
  techLoad(); fundLoad(); ivLoad();
  const all = universe().map(screenRow), wrap = h('div'), count = h('span', { class: 'badge', style: { '--c': 'var(--accent)' } });
  const sectors = [...new Set(all.map(x => x.sector).filter(Boolean))].sort();
  const set = patch => { Object.assign(SCREEN, patch); saveScreen(); draw(); };
  const numBox = (key, label, ph) => {
    const i = h('input', { class: 'in sc-num', type: 'number', step: 'any', placeholder: ph || '—', value: SCREEN[key] ?? '' });
    i.addEventListener('input', () => { const t = i.value.trim(), v = Number(t); if (t === '' || Number.isFinite(v)) set({ [key]: t === '' ? null : v }); });
    return h('label', { class: 'sc-field' }, h('small', null, tr(label)), i);
  };
  const chips = (key, values, icon_) => h('div', { class: 'chips' }, values.map(v => h('span', { class: 'chip tog' + (SCREEN[key].includes(v) ? ' on' : ''), onclick: e => {
    const list = SCREEN[key], i = list.indexOf(v); i < 0 ? list.push(v) : list.splice(i, 1); e.currentTarget.classList.toggle('on', i < 0); saveScreen(); draw(); } }, icon_ ? sectorIcon(v, 12) : null, h('span', { class: 'notr' }, v))));
  const search = h('input', { class: 'in csearch', type: 'search', placeholder: tr('Symbol or company'), value: SCREEN.q });
  search.addEventListener('input', () => set({ q: search.value }));
  const fav = h('label', { class: 'sc-check' }, h('input', { type: 'checkbox', checked: SCREEN.favOnly || null, onchange: e => set({ favOnly: e.currentTarget.checked }) }), ' ★ ' + tr('Favorites only'));
  const presets = h('div', { class: 'chips' }, SCREEN_PRESETS.map(([label, patch]) => h('span', { class: 'chip', onclick: () => { Object.assign(SCREEN, SCREEN_DEFAULT(), { sort: SCREEN.sort }, patch); saveScreen(); App.render(); } }, tr(label))),
    h('span', { class: 'chip', onclick: () => { Object.assign(SCREEN, SCREEN_DEFAULT(), { sort: SCREEN.sort }); saveScreen(); App.render(); } }, '✕ ' + tr('Clear all')));
  const bar = h('section', { class: 'card sc-bar' },
    h('div', { class: 'row' }, search, fav, h('span', { class: 'sp' }), count, btn(tr('CSV'), 'dl', () => exportCsv(screenSort(all.filter(screenTest), SCREEN.sort).map(x => x.r), 'SP500_list'), 'sm')),
    h('div', { class: 'sc-quick' }, h('small', { class: 'muted' }, tr('Quick filters:')), presets),
    h('div', { class: 'sc-grid' },
      numBox('upsideMin', 'Upside ≥ %'), numBox('analystsMin', 'Analysts ≥'), numBox('supportMin', 'Buy + SB ≥ %'), numBox('distanceMax', 'Above 52-week low ≤ %'), numBox('fairGapMin', 'Below fair value ≥ %'),
      h('label', { class: 'sc-field' }, h('small', null, tr('Technical analysis')), selectEl([['', tr('Any')], ['buy', tr('Buy or Strong Buy')], ['strong', tr('Strong Buy')], ['sell', tr('Sell or Strong Sell')]], SCREEN.tech, v => set({ tech: v }), 'sel')),
      h('label', { class: 'sc-field' }, h('small', null, tr('Fundamental analysis')), selectEl([['', tr('Any')], ['good', tr('Good or Strong')], ['strong', tr('Strong')], ['weak', tr('Weak or Very weak')]], SCREEN.fund, v => set({ fund: v }), 'sel'))),
    h('details', { class: 'fadv', open: SCREEN.sectors.length || SCREEN.consensus.length ? true : null }, h('summary', null, tr('Sectors and consensus')),
      h('div', { class: 'fsec' }, h('div', { class: 'up' }, tr('Sectors')), chips('sectors', sectors, true)),
      h('div', { class: 'fsec' }, h('div', { class: 'up' }, tr('Consensus')), chips('consensus', CONSENSUS))));
  const draw = () => {
    const rows = screenSort(all.filter(screenTest), SCREEN.sort);
    count.textContent = rows.length + ' / ' + all.length + ' ' + tr('stocks');
    const head = h('tr', null, h('th', { class: 'fav-col', title: tr('Favorites') }, '★'), ...SCREEN_COLS.map(([key, label]) => h('th', { class: 'srt', onclick: () => { SCREEN.sort = { key, dir: SCREEN.sort.key === key ? -SCREEN.sort.dir : (key === 'symbol' || key === 'consensus' ? 1 : -1) }; saveScreen(); draw(); } },
      tr(label), SCREEN.sort.key === key ? (SCREEN.sort.dir === 1 ? ' ↑' : ' ↓') : '')));
    wrap.replaceChildren(rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl sc-tbl2' }, h('thead', null, head),
      h('tbody', null, rows.slice(0, 600).map(x => h('tr', null, h('td', { class: 'fav-col' }, favStar(x.r, () => { if (SCREEN.favOnly) draw(); })), ...screenCells(x))))))
      : h('div', { class: 'empty' }, tr('No stock matches these filters.'), ' ', h('a', { href: '#', onclick: e => { e.preventDefault(); Object.assign(SCREEN, SCREEN_DEFAULT(), { sort: SCREEN.sort }); saveScreen(); App.render(); } }, tr('Clear all'))));
  };
  draw();
  return h('div', null, card('SP500 list', 'Every stock of the report, unfiltered until you filter. Combine any filters below, sort by any column, and click ☆ to add a stock to your favorites. The Top 10 filters do not apply here.', null, null, 'c12'),
    bar, card(null, null, wrap, null, 'c12'));
};
const FAV = { open: null };
Views.favorites = () => {
  techLoad(); fundLoad(); ivLoad();
  const fav = favorites(), rows = universe().filter(r => fav[r.symbol]).map(screenRow).sort((a, b) => (fav[b.symbol].at || '').localeCompare(fav[a.symbol].at || ''));
  const heading = card('Favorites', 'The stocks you starred, with today\'s view from every analysis. Click a stock for its card and verdicts; click ★ to remove it. Favorites are kept in this browser.', null, null, 'c12');
  if (!rows.length) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('No favorites yet. Open the SP500 list and click ☆ next to a stock.'), ' ', h('a', { href: '#/screener', onclick: e => { e.preventDefault(); App.go('screener'); } }, tr('Open the SP500 list') + ' →')), null, 'c12'));
  const missing = Object.keys(fav).filter(s => !universe().some(r => r.symbol === s));
  const body = [];
  rows.forEach(x => {
    const f = fav[x.symbol], since = num(f.price) && f.price > 0 && num(x.price) ? x.price / f.price - 1 : null, open = FAV.open === x.symbol;
    body.push(h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: () => { FAV.open = open ? null : x.symbol; App.render(); } },
      h('td', { class: 'fav-col' }, favStar(x.r, () => App.render())), ...screenCells(x, [h('td', { class: 'notr small' }, f.at ? new Date(f.at).toLocaleDateString(I18N.locale) : '—'), pctCell(since, true)])));
    if (open) body.push(h('tr', { class: 'company-open' }, h('td', { colspan: SCREEN_COLS.length + 3 }, companyDetail(x.r, x.sector))));
  });
  const head = h('tr', null, h('th', { class: 'fav-col' }, '★'), ...SCREEN_COLS.map(([, label]) => h('th', null, tr(label))), h('th', null, tr('Added')), h('th', null, tr('Since added')));
  return h('div', null, heading, h('div', { class: 'kpis' }, kpi(tr('Favorites'), String(rows.length), tr('stocks on this device'))),
    card(null, null, h('div', null, h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl sc-tbl2' }, h('thead', null, head), h('tbody', null, body))),
      missing.length ? h('p', { class: 'muted small' }, tr('Not in the current report:') + ' ' + missing.join(', ')) : null), null, 'c12'));
};
