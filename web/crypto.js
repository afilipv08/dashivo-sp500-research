'use strict';
/* ================= Crypto section: Top 10, key levels, BTC cycles, X & sentiment ================= */
Object.assign(ICONS, {
  coin: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8h4a2 2 0 010 4h-4zM9.5 12h4.5a2 2 0 010 4H9.5zM11 6v2M11 16v2M9.5 8v8"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  cycle: '<path d="M20 12a8 8 0 01-14.3 4.9M4 12a8 8 0 0114.3-4.9"/><path d="M18.5 3v4.5H14M5.5 21v-4.5H10"/>',
  xlogo: '<path d="M4 4l16 16M20 4L4 20" stroke-width="2.2"/>'
});
const CRYPTO = { data: null, loading: false, error: '', coin: 'BTC', fetched: false };
const CYCLE_COLORS = ['#8c8082', '#2f6fb8', '#b7791f', 'var(--accent)'];

/* ---------- formatting ---------- */
const cp = v => num(v) ? '$' + v.toLocaleString(I18N.locale, { maximumFractionDigits: v >= 1000 ? 0 : v >= 10 ? 2 : v >= 1 ? 3 : 5 }) : '—';
const big = v => num(v) ? '$' + new Intl.NumberFormat(I18N.locale, { notation: 'compact', maximumFractionDigits: 2 }).format(v) : '—';
const chg = (v, scale = 1) => { const x = num(v) ? v * scale : null; return h('span', { class: 'notr ' + (num(x) && x !== 0 ? (x > 0 ? 'positive' : 'negative') : '') }, num(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(x), 1) + '%' : '—'); };
const shortDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString(I18N.locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const coinLogo = (c, size = 32) => c.image ? h('span', { class: 'logo coin', style: { width: size + 'px', height: size + 'px' } }, h('img', { src: c.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => e.target.parentNode.replaceWith(monogram(c.symbol, size)) })) : monogram(c.symbol, size);
const fngColor = v => v <= 25 ? 'var(--bad)' : v <= 45 ? 'var(--warn)' : v <= 55 ? '#9aa0a6' : v <= 75 ? 'color-mix(in srgb,var(--good) 70%,#fff)' : 'var(--good)';
const coins = () => CRYPTO.data?.coins || [];
const coinBy = sym => coins().find(c => c.symbol === sym) || coins().find(c => !c.stable) || coins()[0];

/* ---------- data: cached snapshot first, then one refresh per page load (server limits it to every 10 min) ---------- */
async function loadCrypto() {
  if (!window.dashboardRunToken || CRYPTO.fetched) return;
  CRYPTO.fetched = true;
  const show = () => { if (['crypto', 'levels', 'cycles', 'xsent'].includes(App.route())) App.render(); };
  try { CRYPTO.data = await runRequest('/api/crypto'); } catch (e) { }
  CRYPTO.loading = true; show();
  try { CRYPTO.data = await runRequest('/api/crypto/refresh', 'POST', {}); CRYPTO.error = ''; }
  catch (e) { CRYPTO.error = e.message; }
  CRYPTO.loading = false; show();
}
function cryptoGuard() {
  if (!window.dashboardRunToken) return card(null, null, h('div', { class: 'banner' }, icon('alert', 18), h('span', null, 'Open the dashboard with run_dashboard.bat to load crypto data.')));
  loadCrypto();
  if (!CRYPTO.data) return card(null, null, h('div', { class: 'empty' }, CRYPTO.error ? tr(CRYPTO.error) : tr('Loading crypto data…')));
  return null;
}
const cryptoStatus = () => h('div', { class: 'banner crypto-status' }, icon('sched', 16),
  h('span', null, 'Data'), ' ', h('b', { class: 'notr' }, when(CRYPTO.data.at)), h('span', { class: 'muted' }, ' · CoinGecko, Bitstamp, Yahoo Finance, alternative.me'),
  CRYPTO.loading ? h('span', { class: 'muted' }, ' · ', 'Refreshing…') : null, CRYPTO.error ? h('span', { class: 'negative' }, ' · ', tr(CRYPTO.error)) : null);

/* ---------- interactive line chart: hover shows date / value of every series ---------- */
function hoverChart({ series, height = 260, log = false, hlines = [], xLabel = d => d, yFmt = cp, minX, maxX, axes = true }) {
  const W = 1000, H = height, L = axes ? 64 : 4, R = axes ? 14 : 4, T = axes ? 12 : 6, B = axes ? 26 : 6;
  const pts = series.flatMap(s => s.points);
  if (!pts.length) return h('div', { class: 'empty' }, 'No data yet');
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]).concat(hlines.map(l => l.y)).filter(v => v > 0 || !log);
  const x0 = minX ?? Math.min(...xs), x1 = maxX ?? Math.max(...xs);
  const f = v => log ? Math.log(v) : v, lo = Math.min(...ys.map(f)), hi = Math.max(...ys.map(f)), pad = (hi - lo) * .06 || 1;
  const X = x => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R), Y = v => T + (H - T - B) * (1 - (f(v) - (lo - pad)) / (hi - lo + 2 * pad));
  const ticks = !axes ? '' : [0, .25, .5, .75, 1].map(k => { const fv = lo - pad + k * (hi - lo + 2 * pad), v = log ? Math.exp(fv) : fv; return `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(yFmt(v))}</text>`; }).join('');
  const lines = hlines.map(l => `<line x1="${L}" x2="${W - R}" y1="${Y(l.y)}" y2="${Y(l.y)}" stroke="${l.color}" stroke-width="1.4" stroke-dasharray="${l.dash || '6 5'}" opacity=".9"/><text x="${W - R - 4}" y="${Y(l.y) - 4}" text-anchor="end" style="fill:${l.color};font-weight:700">${esc(l.label)}</text>`).join('');
  const paths = series.map(s => `<path d="${s.points.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>`).join('');
  const el = h('div', { class: 'hchart notr' });
  el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${ticks}${lines}${paths}${axes ? `<text x="${L}" y="${H - 6}">${esc(xLabel(x0))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(xLabel(x1))}</text>` : ''}<line class="cx" y1="${T}" y2="${H - B}" stroke="var(--accent)" stroke-opacity=".6" style="display:none"/>${series.map((s, k) => `<circle class="pt" data-k="${k}" r="4.5" fill="${s.color}" style="display:none"/>`).join('')}</svg>`;
  const svg = $('svg', el), cx = $('.cx', svg), dots = $$('.pt', svg);
  tipBind(svg, e => {
    const r = svg.getBoundingClientRect(), xv = x0 + ((e.clientX - r.left) / r.width * W - L) / (W - L - R) * (x1 - x0);
    cx.setAttribute('x1', X(xv)); cx.setAttribute('x2', X(xv)); cx.style.display = '';
    const rows = series.map((s, k) => {
      let best = null; for (const p of s.points) if (!best || Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
      const d = dots[k]; if (best && Math.abs(best[0] - xv) <= (x1 - x0) / 40) { d.setAttribute('cx', X(best[0])); d.setAttribute('cy', Y(best[1])); d.style.display = ''; } else { d.style.display = 'none'; best = null; }
      return best ? `<span style="color:${s.color}">●</span> ${esc(s.name)}: <b>${esc(yFmt(best[1]))}</b>` : '';
    }).filter(Boolean);
    return rows.length ? `<b>${esc(xLabel(Math.round(xv)))}</b><br>` + rows.join('<br>') : '';
  });
  svg.addEventListener('mouseleave', () => { cx.style.display = 'none'; dots.forEach(d => d.style.display = 'none'); });
  return el;
}
const dayIndex = d => Math.round(new Date(d + 'T12:00:00') / 864e5);
const dayLabel = i => shortDate(new Date(i * 864e5).toISOString().slice(0, 10));
function spark(c) {
  const p = c.spark || [];
  if (p.length < 2) return null;
  const up = p[p.length - 1] >= p[0];
  return hoverChart({ series: [{ name: '7d', color: up ? 'var(--good)' : 'var(--bad)', points: p.map((v, i) => [i, v]) }], height: 110, axes: false, xLabel: i => '−' + nf((p.length - 1 - i) * 7 / (p.length - 1), 1) + 'd', yFmt: cp });
}

/* ---------- Fear & Greed ---------- */
function fngGauge(v, label) {
  if (!num(v)) return h('div', { class: 'empty' }, '—');
  const el = h('div', { class: 'fng-gauge notr' });
  const a = Math.PI * (1 - v / 100), x = 60 + 46 * Math.cos(a), y = 60 - 46 * Math.sin(a);
  el.innerHTML = `<svg viewBox="0 0 120 70"><defs><linearGradient id="fngg"><stop offset="0" stop-color="var(--bad)"/><stop offset=".5" stop-color="var(--warn)"/><stop offset="1" stop-color="var(--good)"/></linearGradient></defs><path d="M14 60a46 46 0 0192 0" fill="none" stroke="url(#fngg)" stroke-width="10" stroke-linecap="round"/><line x1="60" y1="60" x2="${x}" y2="${y}" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="60" r="4" fill="var(--text)"/></svg><b style="color:${fngColor(v)}">${v}</b>`;
  return h('div', { class: 'fng-wrap' }, el, h('div', { class: 'fng-label' }, label));
}
function fngChart() {
  const rows = CRYPTO.data.fearGreed || [];
  return hoverChart({ series: [{ name: 'Fear & Greed', color: 'var(--accent)', points: rows.map(r => [dayIndex(r.date), r.value]) }], height: 170, yFmt: v => nf(v, 0),
    hlines: [{ y: 25, color: 'var(--bad)', label: tr('Extreme Fear') }, { y: 75, color: 'var(--good)', label: tr('Extreme Greed') }], xLabel: dayLabel });
}

/* ---------- Crypto Top 10 ---------- */
function nearest(c) {
  const s = c.levels?.supports?.[0], r = c.levels?.resistances?.[0];
  return h('div', { class: 'cr-levels' },
    h('div', null, h('small', null, 'Support'), s ? h('b', { class: 'notr' }, cp(s.price), ' ', chg((s.price / c.price - 1) * 100)) : h('b', null, '—')),
    h('div', null, h('small', null, 'Resistance'), r ? h('b', { class: 'notr' }, cp(r.price), ' ', chg((r.price / c.price - 1) * 100)) : h('b', null, '—')));
}
function rsiLabel(v) { return !num(v) ? '—' : v < 30 ? 'oversold' : v > 70 ? 'overbought' : 'neutral'; }
function coinCard(c) {
  const ind = c.ind || {};
  return h('article', { class: 'card cr-card c4', onclick: () => { if (!c.stable) { CRYPTO.coin = c.symbol; App.go('levels'); } }, style: { cursor: c.stable ? 'default' : 'pointer' } },
    h('div', { class: 'st-head' }, coinLogo(c, 38),
      h('div', { class: 'st-id' }, h('div', { class: 'st-sym' }, h('span', { class: 'st-rank' }, '#' + c.rank), h('span', { class: 'notr' }, c.symbol)), h('div', { class: 'muted small notr' }, c.name),
        c.stable ? h('span', { class: 'sec-chip' }, 'Stablecoin') : h('span', { class: 'sec-chip' }, ind.aboveMa200 ? 'Above MA200' : ind.aboveMa200 === false ? 'Below MA200' : 'MA200 —')),
      h('div', { class: 'st-px' }, h('b', { class: 'notr' }, cp(c.price)), h('small', null, '24h ', chg(c.ch24)), h('small', { class: 'muted notr' }, big(c.mcap)))),
    h('div', { class: 'cr-chg' }, [['7d', c.ch7], ['30d', c.ch30], ['1y', c.ch1y], ['ATH', c.athPct]].map(([l, v]) => h('div', null, h('small', null, l), chg(v)))),
    spark(c),
    c.stable ? h('p', { class: 'muted small' }, 'Pegged to the dollar: key levels and cycles do not apply.') : nearest(c),
    c.stable ? null : h('div', { class: 'st-foot muted small' }, h('span', null, 'RSI'), ' ', h('b', { class: 'notr' }, nf(ind.rsi, 0)), ' · ', h('span', null, rsiLabel(ind.rsi)), h('span', { class: 'sp' }),
      h('span', null, 'Volatility'), ' ', h('b', { class: 'notr' }, pctf(ind.vol30))));
}
Views.crypto = () => {
  const guard = cryptoGuard(); if (guard) return guard;
  const d = CRYPTO.data, g = d.global || {}, f = (d.fearGreed || []).slice(-1)[0] || {};
  return h('div', null, cryptoStatus(),
    h('div', { class: 'kpis' },
      kpi('Total market cap', big(g.mcap), h('span', null, '24h ', chg(g.mcapChange24h))),
      kpi('BTC dominance', pctf(num(g.btcDominance) ? g.btcDominance / 100 : null), h('span', null, 'ETH ', h('span', { class: 'notr' }, pctf(num(g.ethDominance) ? g.ethDominance / 100 : null)))),
      kpi('24h volume', big(g.volume), 'all cryptocurrencies'),
      kpi('Fear & Greed', num(f.value) ? String(f.value) : '—', f.label || '—'),
      kpi('BTC cycle', d.btc?.now ? tr('day') + ' ' + d.btc.now.daysSinceHalving : '—', d.btc?.now ? h('span', null, d.btc.now.daysToNextHalving + ' ', tr('days to the next halving')) : '—')),
    h('div', { class: 'sectionhead' }, h('div', null, h('h2', null, 'Top 10 by market cap'), h('p', { class: 'muted small' }, 'Click a coin for its key levels. Hover the 7-day chart for prices.'))),
    h('div', { class: 'grid' }, coins().map(coinCard)),
    card('Fear & Greed, 60 days', 'Below 25 = extreme fear (historically closer to bottoms); above 75 = extreme greed', fngChart(), null, 'mt'));
};

/* ---------- Key levels ---------- */
Views.levels = () => {
  const guard = cryptoGuard(); if (guard) return guard;
  const choices = coins().filter(c => !c.stable), c = coinBy(CRYPTO.coin);
  if (!c) return card(null, null, h('div', { class: 'empty' }, 'No data yet'));
  const ind = c.ind || {}, sup = c.levels?.supports || [], res = c.levels?.resistances || [];
  const hist = c.history || [], points = hist.map(([d, v]) => [dayIndex(d), v]);
  const ma = n => hist.length >= n ? hist.slice(n - 1).map(([d], i) => [dayIndex(d), hist.slice(i, i + n).reduce((a, r) => a + r[1], 0) / n]) : [];
  const chart = hoverChart({ series: [{ name: c.symbol, color: 'var(--text)', width: 2.2, points }, { name: 'MA50', color: 'var(--warn)', width: 1.4, points: ma(50) }, { name: 'MA200', color: 'var(--info)', width: 1.4, points: ma(200) }],
    height: 340, log: true, xLabel: dayLabel,
    hlines: [...res.map((l, i) => ({ y: l.price, color: 'var(--bad)', label: 'R' + (i + 1) + ' ' + cp(l.price) })), ...sup.map((l, i) => ({ y: l.price, color: 'var(--good)', label: 'S' + (i + 1) + ' ' + cp(l.price) }))] });
  const rung = (kind, l, i) => h('div', { class: 'rung ' + kind }, h('b', { class: 'notr' }, (kind === 'res' ? 'R' : 'S') + (i + 1)), h('span', { class: 'notr rp' }, cp(l.price)), chg((l.price / c.price - 1) * 100),
    h('small', { class: 'muted' }, l.touches + ' ', tr(l.touches === 1 ? 'touch' : 'touches'), ' · ', tr('last'), ' ', h('span', { class: 'notr' }, shortDate(l.last))));
  const scen = [];
  if (res[0]) scen.push(h('li', null, h('b', { class: 'positive' }, tr('Bullish:')), ' ', tr('a daily close above'), ' ', h('b', { class: 'notr' }, cp(res[0].price)), ' ', tr('opens the way to'), ' ', h('b', { class: 'notr' }, res[1] ? cp(res[1].price) : tr('the yearly high') + ' ' + cp(ind.high52))));
  if (sup[0]) scen.push(h('li', null, h('b', { class: 'negative' }, tr('Bearish:')), ' ', tr('losing'), ' ', h('b', { class: 'notr' }, cp(sup[0].price)), ' ', tr('points to the next support at'), ' ', h('b', { class: 'notr' }, sup[1] ? cp(sup[1].price) : tr('the yearly low') + ' ' + cp(ind.low52))));
  else scen.push(h('li', null, h('b', { class: 'negative' }, tr('Bearish:')), ' ', tr('price is below every support of the period; the next reference is the yearly low'), ' ', h('b', { class: 'notr' }, cp(ind.low52))));
  return h('div', null, cryptoStatus(),
    h('div', { class: 'chips coin-pick' }, choices.map(x => h('span', { class: 'chip tog' + (x.symbol === c.symbol ? ' on' : ''), onclick: () => { CRYPTO.coin = x.symbol; App.render(); } }, coinLogo(x, 18), h('span', { class: 'notr' }, x.symbol)))),
    h('div', { class: 'grid mt' },
      card(h('span', null, h('span', { class: 'notr' }, c.name + ' · ' + cp(c.price)), ' ', chg(c.ch24)), 'Daily close, last 12 months (log scale) · dashed lines = key levels · hover for values', chart, null, 'c8'),
      card('Level ladder', 'Where price turned repeatedly; the more touches, the stronger the level', h('div', null,
        h('div', { class: 'ladder' }, [...res].reverse().map((l, i) => rung('res', l, res.length - 1 - i)),
          h('div', { class: 'rung now' }, h('b', null, 'Now'), h('span', { class: 'notr rp' }, cp(c.price)), h('span', null, '')), sup.map((l, i) => rung('sup', l, i))),
        h('ul', { class: 'scen' }, scen)), null, 'c4'),
      card('Indicators', null, h('div', { class: 'ind-grid' },
        [['MA50', cp(ind.ma50)], ['MA200', cp(ind.ma200)], ['MA50 vs MA200', ind.cross === 'golden' ? tr('Golden cross (bullish)') : ind.cross === 'death' ? tr('Death cross (bearish)') : '—'],
          ['RSI 14', nf(ind.rsi, 1) + ' · ' + tr(rsiLabel(ind.rsi))], ['Volatility 30d (annual)', pctf(ind.vol30)], ['52-week range', cp(ind.low52) + ' – ' + cp(ind.high52)],
          ['All-time high', cp(c.ath) + ' · ' + shortDate(c.athDate)], ['From ATH', null, chg(c.athPct)], ['Market cap', big(c.mcap)]].map(([l, v, node]) =>
          h('div', null, h('small', null, l), node || h('b', { class: 'notr' }, v)))), null, 'c12')),
    h('p', { class: 'muted small mt' }, 'Levels are found from swing highs and lows of daily closes (up to 3 years for BTC, 1 year for the others), grouped within ±3.5%. They describe where buyers or sellers stepped in before, not a guarantee. Informational, not investment advice.'));
};

/* ---------- BTC cycles ---------- */
Views.cycles = () => {
  const guard = cryptoGuard(); if (guard) return guard;
  const b = CRYPTO.data.btc;
  if (!b?.cycles?.length) return card(null, null, h('div', { class: 'empty' }, 'Bitcoin history is unavailable right now.'));
  const n = b.now, btcNow = coinBy('BTC');
  const chart = hoverChart({ series: b.cycles.map((c, i) => ({ name: c.halving.slice(0, 4), color: CYCLE_COLORS[i % 4], width: i === b.cycles.length - 1 ? 3 : 1.6, points: c.series.filter(p => p[1] > 0) })),
    height: 340, log: true, minX: 0, maxX: n.cycleLength, xLabel: dd => tr('day') + ' ' + dd, yFmt: v => '×' + nf(v, v < 10 ? 2 : 0),
    hlines: [{ y: 1, color: 'var(--muted)', label: tr('halving price'), dash: '2 4' }] });
  const progress = Math.min(100, n.daysSinceHalving / n.cycleLength * 100);
  return h('div', null, cryptoStatus(),
    h('div', { class: 'kpis' },
      kpi('Days since halving', String(n.daysSinceHalving), h('span', null, tr('halving'), ' ', h('span', { class: 'notr' }, shortDate(n.halving)))),
      kpi('Next halving (est.)', String(n.daysToNextHalving), h('span', null, tr('days'), ' · ', h('span', { class: 'notr' }, shortDate(b.next)))),
      kpi('Current cycle peak', n.peak ? cp(n.peak) : '—', n.peakDate ? h('span', { class: 'notr' }, shortDate(n.peakDate)) : '—'),
      kpi('From cycle peak', n.drawdownNow != null ? h('span', { class: 'negative' }, pctf(n.drawdownNow)) : '—', btcNow ? h('span', null, 'BTC ', h('span', { class: 'notr' }, cp(btcNow.price))) : '—'),
      kpi('Cycle progress', nf(progress, 0) + '%', h('span', null, nf(n.cycleLength, 0) + ' ', tr('days per cycle')))),
    h('div', { class: 'grid mt' },
      card('Cycles compared', 'Price as a multiple of the price on halving day (log scale), by days since halving · hover to compare cycles on the same day', chart, null, 'c8'),
      card('If history repeats', 'Statistical analogy with the completed cycles, not a forecast', h('div', { class: 'analogy' },
        h('div', null, h('small', null, 'Peak came after halving'), h('b', { class: 'notr' }, n.historicalDaysToPeak ? n.historicalDaysToPeak.join('–') + ' ' + tr('days') : '—'),
          n.peakDate ? h('p', { class: 'muted small' }, tr('Current cycle'), ': ', h('span', { class: 'notr' }, b.cycles[b.cycles.length - 1].daysToPeak + ' · ' + shortDate(n.peakDate) + ' · ' + cp(n.peak))) : null),
        h('div', null, h('small', null, 'Peak to bottom'), h('b', { class: 'notr' }, n.historicalDrawdown ? pctf(n.historicalDrawdown[0]) + ' … ' + pctf(n.historicalDrawdown[1]) : '—')),
        n.bottomWindow ? h('div', null, h('small', null, 'Historical bottom window'), h('b', { class: 'notr' }, shortDate(n.bottomWindow[0]) + ' – ' + shortDate(n.bottomWindow[1]))) : null,
        n.bottomRange ? h('div', null, h('small', null, 'Price at historical depth'), h('b', { class: 'notr' }, cp(n.bottomRange[0]) + ' – ' + cp(n.bottomRange[1]))) : null,
        h('div', null, h('small', null, 'Cycle progress'), h('div', { class: 'pbar' }, h('i', { style: { width: progress + '%' } })))), null, 'c4'),
      card('Halving cycles', null, h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl' },
        h('thead', null, h('tr', null, ['Halving', 'Price at halving', 'Peak', 'Days to peak', 'Multiple', 'Bottom', 'Drawdown', 'Peak → bottom'].map(t => h('th', null, t)))),
        h('tbody', { class: 'notr' }, b.cycles.map((c, i) => h('tr', null,
          h('td', null, h('i', { class: 'dot', style: { background: CYCLE_COLORS[i % 4] } }), ' ', shortDate(c.halving), c.complete ? '' : ' · ' + tr('current')),
          h('td', null, cp(c.priceAtHalving)), h('td', null, cp(c.peak) + ' · ' + shortDate(c.peakDate)), h('td', null, String(c.daysToPeak)), h('td', null, '×' + nf(c.peakMultiple, 1)),
          h('td', null, c.bottom ? cp(c.bottom) + ' · ' + shortDate(c.bottomDate) : '—'), h('td', { class: 'negative' }, c.drawdown != null ? pctf(c.drawdown) : '—'),
          h('td', null, c.daysPeakToBottom != null ? c.daysPeakToBottom + ' ' + tr('days') : '—')))))), null, 'c12')),
    h('p', { class: 'muted small mt' }, 'Bitcoin daily closes from Bitstamp since 2011. Peaks are searched in the first 900 days after each halving; the bottom is the lowest close after the peak and before the next halving. The current cycle\'s bottom is not final while the cycle is running. Four cycles are a small sample: informational, not investment advice.'));
};

/* ---------- X & sentiment ---------- */
const X_ACCOUNTS = [
  ['Bitcoin', [['saylor', 'Michael Saylor'], ['adam3us', 'Adam Back'], ['APompliano', 'Anthony Pompliano'], ['100trillionUSD', 'PlanB'], ['PeterSchiff', 'Peter Schiff (bear)']]],
  ['Founders', [['VitalikButerin', 'Vitalik Buterin'], ['aeyakovenko', 'Anatoly Yakovenko (Solana)'], ['bgarlinghouse', 'Brad Garlinghouse (Ripple)'], ['justinsuntron', 'Justin Sun (Tron)'], ['cz_binance', 'CZ (Binance)']]],
  ['On-chain & data', [['glassnode', 'Glassnode'], ['woonomic', 'Willy Woo'], ['lookonchain', 'Lookonchain'], ['whale_alert', 'Whale Alert'], ['santimentfeed', 'Santiment']]],
  ['Macro & news', [['RaoulGMI', 'Raoul Pal'], ['LynAldenContact', 'Lyn Alden'], ['WatcherGuru', 'Watcher.Guru'], ['elonmusk', 'Elon Musk'], ['brian_armstrong', 'Brian Armstrong (Coinbase)']]]
];
const xSearch = q => 'https://x.com/search?q=' + encodeURIComponent(q) + '&f=top';
const DEFAULT_CRYPTO_PROMPT = 'Acționează ca un analist crypto cu peste 10 ani de experiență. Pentru {COIN} ({SYMBOL}) rezumă cele mai importante postări de pe X din ultimele 7 zile ale conturilor influente (fondatori, fonduri, analiști on-chain, exchange-uri, investitori mari) și spune-mi impactul probabil asupra prețului. Apoi dă-mi strict concluzia: cumpăr, aștept sau vând, cu praguri de preț (minime și maxime) și șanse probabilistice.';
const CAI = Object.assign({ prompt: DEFAULT_CRYPTO_PROMPT, assistant: 'grok' }, store.get('dashivo-sp500-crypto-ai', {}) || {});
if (!ASSISTANTS[CAI.assistant]) CAI.assistant = 'grok';
const saveCAI = () => store.set('dashivo-sp500-crypto-ai', { prompt: CAI.prompt, assistant: CAI.assistant });
function cryptoPrompt(c) {
  const n = v => num(v) ? v.toLocaleString('ro-RO', { maximumFractionDigits: v >= 10 ? 2 : 5 }) : 'n/a';
  const f = (CRYPTO.data?.fearGreed || []).slice(-1)[0], b = CRYPTO.data?.btc?.now, ind = c.ind || {};
  const lines = ['', '', `Date din dashboardul meu (${CRYPTO.data?.at?.slice(0, 16)}):`, `- Preț: $${n(c.price)}; 24h ${n(c.ch24)}%, 7z ${n(c.ch7)}%, 30z ${n(c.ch30)}%, 1 an ${n(c.ch1y)}%; față de ATH ${n(c.athPct)}%`,
    `- Suporturi: ${(c.levels?.supports || []).map(l => '$' + n(l.price)).join(', ') || 'n/a'}; rezistențe: ${(c.levels?.resistances || []).map(l => '$' + n(l.price)).join(', ') || 'n/a'}`,
    `- MA50 $${n(ind.ma50)}, MA200 $${n(ind.ma200)}, RSI14 ${n(ind.rsi)}; Fear & Greed: ${f ? f.value + ' (' + f.label + ')' : 'n/a'}`];
  if (c.symbol === 'BTC' && b) lines.push(`- Ciclul BTC: ziua ${b.daysSinceHalving} după halving-ul din ${b.halving}; vârful ciclului $${n(b.peak)} (${b.peakDate}); acum ${n((b.drawdownNow || 0) * 100)}% față de vârf`);
  return CAI.prompt.replaceAll('{COIN}', c.name).replaceAll('{SYMBOL}', c.symbol) + lines.join('\n');
}
function askCrypto(c) {
  const a = ASSISTANTS[CAI.assistant], text = cryptoPrompt(c);
  window.open(a.url(text), '_blank', 'noopener');
  copyText(text).then(ok => toast(a.clipboardOnly ? (ok ? 'Prompt copied. Paste it in Gemini.' : 'Copy failed') : ok ? 'Prompt sent and copied to the clipboard' : 'Prompt sent'));
}
Views.xsent = () => {
  const guard = cryptoGuard(); if (guard) return guard;
  const f = (CRYPTO.data.fearGreed || []).slice(-1)[0] || {}, a = ASSISTANTS[CAI.assistant];
  const handles = X_ACCOUNTS.flatMap(([, list]) => list.map(([u]) => u));
  return h('div', null, cryptoStatus(),
    h('div', { class: 'grid' },
      card('Fear & Greed today', 'alternative.me index, 0 = extreme fear, 100 = extreme greed', fngGauge(f.value, f.label), null, 'c4'),
      card('Fear & Greed, 60 days', null, fngChart(), null, 'c8'),
      card('Posts on X', 'X has no free API, so each button opens X with the right search, or asks your AI assistant for a summary of the week', h('div', { class: 'xrows' },
        coins().filter(c => !c.stable).map(c => h('div', { class: 'xrow' }, coinLogo(c, 30), h('div', { class: 'ai-id' }, h('b', { class: 'notr' }, c.symbol), h('div', { class: 'muted small notr' }, c.name)),
          h('a', { class: 'btn sm', href: xSearch('$' + c.symbol + ' min_faves:500'), target: '_blank', rel: 'noopener' }, icon('xlogo', 13), h('span', null, 'Top posts')),
          h('a', { class: 'btn sm', href: xSearch('(' + handles.map(u => 'from:' + u).join(' OR ') + ') (' + c.symbol + ' OR ' + c.name + ')'), target: '_blank', rel: 'noopener' }, icon('user', 13), h('span', null, 'From influential accounts')),
          h('button', { class: 'btn pri sm', onclick: () => askCrypto(c) }, icon('spark', 13), h('span', null, tr('Summarize with') + ' ' + a.name))))), btn('Prompt settings', 'cog', () => App.go('settings'), 'sm'), 'c12'),
      card('Accounts worth following', 'Curated list; each name opens the profile on X', h('div', { class: 'xacc' }, X_ACCOUNTS.map(([group, list]) => h('div', null, h('div', { class: 'up' }, group),
        list.map(([u, name]) => h('a', { class: 'xa', href: 'https://x.com/' + u, target: '_blank', rel: 'noopener' }, h('b', { class: 'notr' }, '@' + u), h('span', { class: 'muted small notr' }, name)))))), null, 'c12')),
    h('p', { class: 'muted small mt' }, 'Posts and AI summaries are opinions, not investment advice. Grok reads X directly and is the default assistant here; you can change it in Settings.'));
};

/* ---------- Settings: crypto prompt ---------- */
const baseSettings = Views.settings;
Views.settings = () => {
  const node = baseSettings();
  const area = h('textarea', { class: 'ta prompt-ta', id: 'cryptoPrompt', rows: 7 }); area.value = CAI.prompt;
  area.addEventListener('input', () => { CAI.prompt = area.value.trim() ? area.value : DEFAULT_CRYPTO_PROMPT; saveCAI(); });
  const pick = selectEl(Object.entries(ASSISTANTS).map(([k, x]) => [k, x.name]), CAI.assistant, v => { CAI.assistant = v; saveCAI(); }); pick.id = 'cryptoAssistant';
  node.append(card('Crypto AI prompt', 'Used on the X & sentiment page. {COIN} and {SYMBOL} are replaced; the dashboard data (price, levels, RSI, Fear & Greed, BTC cycle) is added at the end.', h('div', null, area,
    h('div', { class: 'row mt' }, field('AI assistant', pick), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: () => { CAI.prompt = DEFAULT_CRYPTO_PROMPT; saveCAI(); App.render(); toast('Default prompt restored'); } }, 'Restore default prompt'))), null, 'c12'));
  return node;
};
