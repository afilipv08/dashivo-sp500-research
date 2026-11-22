'use strict';
/* ================= Shared visuals: company logos, sector icons, price-range axis, recommendation bar ================= */
/* Company logo by symbol; falls back to a colored monogram when the image is missing or the PC is offline. */
Object.assign(ICONS, { phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>' });
const LOGO_URL = s => 'https://financialmodelingprep.com/image-stock/' + encodeURIComponent(s) + '.png';
const MONO_COLORS = ['#c8000a', '#1f6feb', '#2b8a4b', '#b7791f', '#7b52b8', '#0e7490', '#be185d', '#475569'];
function monogram(symbol, size) {
  return h('span', { class: 'logo mono', style: { width: size + 'px', height: size + 'px', background: MONO_COLORS[hash(symbol) % MONO_COLORS.length], fontSize: Math.round(size * .36) + 'px' } }, String(symbol).replace(/[^A-Z]/g, '').slice(0, 3) || '?');
}
function logoEl(symbol, size = 34) {
  const wrap = h('span', { class: 'logo', style: { width: size + 'px', height: size + 'px' } });
  const img = h('img', { src: LOGO_URL(symbol), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => wrap.replaceWith(monogram(symbol, size)), { once: true });
  wrap.append(img);
  return wrap;
}

/* GICS sector icons (line SVG, Dashivo style) */
const SECTOR_ICONS = {
  'Information Technology': '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  'Health Care': '<path d="M12 21s-7-4.5-9-9.5C1.5 7.5 4 4 7.5 4c2 0 3.5 1 4.5 2.5C13 5 14.5 4 16.5 4 20 4 22.5 7.5 21 11.5 19 16.5 12 21 12 21z"/><path d="M12 9v5M9.5 11.5h5"/>',
  'Financials': '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  'Consumer Discretionary': '<path d="M6 8h12l-1 13H7z"/><path d="M9 8V6a3 3 0 016 0v2"/>',
  'Consumer Staples': '<circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6"/>',
  'Communication Services': '<path d="M4 6h16v10H8l-4 4z"/><path d="M8 10h8M8 13h5"/>',
  'Industrials': '<path d="M3 21V10l6 4V10l6 4V6l6 4v11z"/><path d="M7 18h2M12 18h2M17 18h2"/>',
  'Energy': '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  'Utilities': '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
  'Real Estate': '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6M8 11h2M14 11h2"/>',
  'Materials': '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12L3 7M12 12v10"/>'
};
const sectorIcon = (sector, size = 13) => h('span', { class: 'sec-ic', html: `<svg viewBox="0 0 24 24" style="width:${size}px;height:${size}px">${SECTOR_ICONS[sector] || '<circle cx="12" cy="12" r="8"/>'}</svg>` });
const sectorChip = sector => h('span', { class: 'sec-chip' }, sectorIcon(sector), h('span', { class: 'notr' }, sector || 'N/A'));

/* One axis: 52-week range shaded, with markers for price and min / mean / max targets. */
function rangeAxis(r) {
  const high = num(r.high) ? r.high : num(r['Max.']) ? r['Max.'] : null;
  const marks = [['price', 'Price', r.price], ['min', 'Min', r.minTarget], ['mean', 'Mean', r.meanTarget], ['max', 'Max', r.maxTarget]].filter(m => num(m[2]) && m[2] > 0);
  const vals = marks.map(m => m[2]).concat([r.low, high].filter(v => num(v) && v > 0));
  if (!(r.price > 0) || vals.length < 2) return h('p', { class: 'warning' }, 'Price unavailable');
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1, pos = v => 3 + (v - lo) / span * 94;
  /* labels anchor left at the left edge, right at the right edge, centred in between, so none leaves the card */
  const anchor = x => ({ left: x + '%', transform: 'translateX(-' + Math.round(Math.min(100, Math.max(0, (x - 3) / 94 * 100))) + '%)' });
  const axis = h('div', { class: 'rng' }, h('div', { class: 'rng-track' }));
  if (num(r.low) && num(high)) {
    axis.append(h('div', { class: 'rng-52', style: { left: pos(r.low) + '%', width: (pos(high) - pos(r.low)) + '%' } }),
      h('div', { class: 'rng-end', style: anchor(pos(r.low)) }, h('b', { class: 'notr' }, nf1(r.low)), ' [', h('span', null, '52wk low'), ']'),
      h('div', { class: 'rng-end r', style: anchor(pos(high)) }, h('b', { class: 'notr' }, nf1(high)), ' [', h('span', null, '52wk high'), ']'));
  }
  /* greedy rows so close labels do not overlap */
  const rows = [];
  for (const [key, label, v] of [...marks].sort((a, b) => a[2] - b[2])) {
    const x = pos(v); let row = rows.findIndex(last => x - last > 17);
    if (row < 0) { row = rows.length; rows.push(x); } else rows[row] = x;
    const vs = key === 'price' ? '' : ' (' + (v >= r.price ? '+' : '−') + nf(Math.abs(v / r.price - 1) * 100, 1) + '%)';
    axis.append(h('div', { class: 'rng-mk ' + key, style: { left: x + '%' }, title: label + ': ' + usd1(v) + vs }),
      h('div', { class: 'rng-lb ' + key, style: { ...anchor(x), top: (34 + row * 14) + 'px' } }, h('b', { class: 'notr' }, nf1(v)), ' [', h('span', null, label), ']'));
  }
  axis.style.height = (40 + Math.max(1, rows.length) * 14) + 'px';
  return axis;
}

/* Recommendation bar with the share written inside each segment. */
const REC = [['sb', 'SB', 'Strong Buy', 'var(--good)'], ['buy', 'Buy', 'Buy', 'color-mix(in srgb,var(--good) 55%,#fff)'], ['hold', 'Hold', 'Hold', '#9aa0a6'], ['under', 'Und.', 'Underperform', 'var(--warn)'], ['sell', 'Sell', 'Sell', 'var(--bad)']];
function recBar(r) {
  if (!(num(r.hold) && r.total > 0)) return h('p', { class: 'warning' }, 'Distribution unavailable');
  const segTip = (long, n, share) => tipHtml(long, [tipRow('Analysts', n + ' / ' + r.total), tipRow('Share', nf(share * 100, 1) + '%')]);
  const bar = h('div', { class: 'recbar notr' }, REC.filter(([k]) => r[k] > 0).map(([k, short, long, c]) => {
    const share = r[k] / r.total;
    /* width follows the share, but every non-empty segment keeps room for its own percentage (CSS min-width) */
    return hoverTip(h('span', { style: { flex: share + ' 1 0', background: c } }, share >= .16 ? short + ' ' + nf(share * 100, 0) + '%' : nf(share * 100, 0) + '%'), () => segTip(long, r[k], share));
  }));
  /* every category with its count and share, so the thin segments are readable too */
  const legend = h('div', { class: 'reclegend notr' }, REC.map(([k, short, long, c]) => hoverTip(h('span', { class: r[k] ? '' : 'zero' },
    h('i', { style: { background: c } }), short + ' ', h('b', null, String(r[k])), ' (' + nf(r[k] / r.total * 100, 0) + '%)'), () => segTip(long, r[k], r[k] / r.total))));
  return h('div', null, bar, legend);
}

/* ---------- rich hover tooltips (built with tr() so they follow the UI language) ---------- */
const tipRow = (label, value) => `<div class="tr"><span>${esc(tr(label))}</span><b>${value}</b></div>`;
const tipHtml = (title, rows, note) => `<b>${esc(tr(title))}</b>` + (rows || []).join('') + (note ? `<div class="tn">${esc(tr(note))}</div>` : '');
/* phones have no hover: a tap shows the same tooltip under the element, a tap elsewhere hides it */
const TOUCH = matchMedia('(hover: none)').matches;
function showTipAt(el, html) {
  const t = $('#tip'); if (!t || !html) return;
  t.innerHTML = html; t.style.opacity = 1;
  const r = el.getBoundingClientRect(), w = t.offsetWidth, hh = t.offsetHeight;
  t.style.left = clamp(r.left, 8, innerWidth - w - 8) + 'px';
  t.style.top = (r.bottom + hh + 12 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - hh - 8)) + 'px';
}
function hoverTip(el, fn) {
  tipBind(el, () => fn());
  if (TOUCH) { el.classList.add('tap-tip'); el.addEventListener('click', () => showTipAt(el, fn())); }
  return el;
}
if (TOUCH) document.addEventListener('touchstart', e => { if (!e.target.closest('.tap-tip, .hchart, .donut')) { const t = $('#tip'); if (t) t.style.opacity = 0; } }, { passive: true });

/* ---------- analyst ratings: meaning of each grade and recent history ---------- */
const RATING_CLASS = [
  [/strong buy|top pick|conviction buy/i, 'bull', 'Strong Buy: the analyst expects a clearly better return than the market over the next 12 months.'],
  [/overweight|sector weight\s*\+/i, 'bull', 'Overweight: the analyst recommends holding more of this stock than its weight in the index, i.e. it should beat its benchmark.'],
  [/outperform|positive|accumulate|add|buy/i, 'bull', 'Buy / Outperform: the analyst expects the stock to rise more than the market or its sector over the next 12 months.'],
  [/underweight/i, 'bear', 'Underweight: the analyst recommends holding less of this stock than its index weight; it should lag its benchmark.'],
  [/underperform|negative|reduce|sell/i, 'bear', 'Sell / Underperform: the analyst expects the stock to do worse than the market or its sector.'],
  [/neutral|hold|equal.?weight|market perform|sector perform|in.?line|peer perform|sector weight|mixed/i, 'neutral', 'Neutral / Hold: the analyst expects a return roughly in line with the market or its sector.']
];
const ratingInfo = grade => RATING_CLASS.find(([re]) => re.test(String(grade || ''))) || [null, 'neutral', 'Rating given by the analyst firm; check the firm\'s own scale.'];
const ACTIONS = { up: 'Upgrade', down: 'Downgrade', main: 'Maintains', init: 'Initiated', reit: 'Reiterates' };
const RATINGS = {};
async function loadRatings(symbol) {
  if (RATINGS[symbol] || !window.dashboardRunToken) return;
  RATINGS[symbol] = { loading: true };
  try { RATINGS[symbol] = await runRequest('/api/ratings?symbol=' + encodeURIComponent(symbol)); } catch (e) { RATINGS[symbol] = { error: e.message }; }
}
function ratingTip(r) {
  const grade = r['Latest Rating - Rating'], [, cls, meaning] = ratingInfo(grade), h_ = RATINGS[r.symbol] || {};
  const rows = [tipRow('Latest rating', esc(String(grade || 'N/A')) + ' · ' + esc(String(r['Latest Rating - Date'] || ''))),
    tipRow('Action', esc(tr(String(r['Latest Rating - Rating Action'] || '—')))), tipRow('Price target', esc(String(r['Latest Rating - Price Target'] || '—')))];
  let hist = '';
  if (h_.rows?.length) hist = '<div class="tn">' + esc(tr('Recent rating changes')) + '</div>' + h_.rows.slice(0, 6).map(x => {
    const t = x.target ? (x.priorTarget && x.priorTarget !== x.target ? '$' + nf(x.priorTarget) + ' → $' + nf(x.target) : '$' + nf(x.target)) : '';
    const c = ratingInfo(x.to)[1];
    return `<div class="tr hist"><span>${esc(x.date)} · ${esc(x.firm || '')}</span><b class="rt-${c}">${esc(x.from && x.from !== x.to ? x.from + ' → ' : '')}${esc(x.to || '')}${t ? ' · ' + esc(t) : ''}</b></div>`;
  }).join('');
  else if (h_.loading) hist = '<div class="tn">' + esc(tr('Loading rating history…')) + '</div>';
  else if (h_.error) hist = '<div class="tn">' + esc(tr(h_.error)) + '</div>';
  return `<b class="rt-${cls}">${esc(String(grade || 'N/A'))}</b><div class="tn">${esc(tr(meaning))}</div>` + rows.join('') + hist;
}

/* ---------- hoverable bar list (diverging around zero) and histogram ---------- */
function barList(rows, { fmt = v => nf(v), height = 26 } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, 'No data yet');
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1e-9), neg = rows.some(r => r.value < 0);
  return h('div', { class: 'barlist' + (neg ? ' div' : '') }, rows.map(r => hoverTip(h('div', { class: 'bl-row', style: { height: height + 'px' }, onclick: r.onclick || null },
    h('span', { class: 'bl-lab notr' }, r.logo ? logoEl(r.label, 18) : null, r.label),
    h('div', { class: 'bl-track' }, h('i', { class: r.value < 0 ? 'neg' : 'pos', style: { width: Math.abs(r.value) / max * (neg ? 50 : 100) + '%', background: r.color || '' } })),
    h('b', { class: 'notr ' + (r.value < 0 ? 'negative' : '') }, fmt(r.value))), () => r.tip || `<b>${esc(r.label)}</b><br>${esc(fmt(r.value))}`)));
}
function histogram(items, { bins, label, mark, markLabel } = {}) {
  const counts = bins.slice(0, -1).map((lo, i) => ({ lo, hi: bins[i + 1], list: items.filter(x => x.v >= lo && (i === bins.length - 2 ? x.v <= bins[i + 1] : x.v < bins[i + 1])) }));
  const max = Math.max(1, ...counts.map(c => c.list.length));
  return h('div', { class: 'histo' }, h('div', { class: 'hg-bars' }, counts.map(c => hoverTip(h('div', { class: 'hg-col' + (mark != null && c.hi <= mark + 1e-9 ? ' hit' : '') },
    h('span', { class: 'hg-n notr' }, c.list.length || ''), h('i', { style: { height: c.list.length / max * 100 + '%' } }), h('small', { class: 'notr' }, label(c.lo, c.hi))),
    () => `<b>${esc(label(c.lo, c.hi))}</b><br>${c.list.length} ${esc(tr('stocks'))}` + (c.list.length ? '<div class="tn">' + esc(c.list.slice(0, 12).map(x => x.s).join(', ') + (c.list.length > 12 ? ' …' : '')) + '</div>' : '')))),
    mark != null ? h('p', { class: 'muted small' }, markLabel) : null);
}
