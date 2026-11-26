'use strict';
/* ================= Demo portfolio: Invest dialog, Portfolio page, 5-minute price refresh ================= */
Object.assign(ICONS, {
  wallet: '<path d="M3 7.5A2.5 2.5 0 015.5 5H18a2 2 0 012 2v1"/><rect x="3" y="8" width="18" height="12" rx="2.5"/><path d="M16 14h2"/>'
});
const PORT_ACTIVE_KEY = 'dashivo-sp500-portfolio-active';
const PORT = { data: null, error: '', hist: {}, open: null, refreshing: false, timer: null, active: store.get(PORT_ACTIVE_KEY, null) };
const setActivePortfolio = id => { PORT.active = id; store.set(PORT_ACTIVE_KEY, id); };
const PRICE_EVERY = 5 * 60 * 1000;
const tiny = (v, eps) => num(v) && Math.abs(v) < eps ? 0 : v;   // float noise like −1e-13 must read as 0, not −$0
const signed = v => { v = tiny(v, .005); return num(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + nf(Math.abs(v)) : '—'; };
const signedPct = v => { v = tiny(v, .00005); return num(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v) * 100) + '%' : '—'; };
const plClass = v => { v = tiny(v, .00005); return num(v) && v !== 0 ? (v > 0 ? 'positive' : 'negative') : ''; };
const when = iso => iso ? new Date(iso).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const day = iso => iso ? new Date(iso).toLocaleDateString(I18N.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const snapshotOf = r => Object.fromEntries(['symbol', 'company', 'sector', 'price', 'low', 'total', 'support', 'weighted', 'sb', 'buy', 'hold', 'under', 'sell',
  'minTarget', 'meanTarget', 'maxTarget', 'gap', 'upside', 'distance', 'Latest Rating - Date', 'Latest Rating - Rating', 'issues'].map(k => [k, r[k] ?? null]).concat([['reportDate', DATA.sourceDate], ['high', r.high ?? r['Max.'] ?? null]]));

/* every call names the portfolio it works on; the answer carries the short list of all portfolios */
async function portfolioCall(path, body) {
  const query = !body && !path && PORT.active ? '?id=' + encodeURIComponent(PORT.active) : '';
  const data = await runRequest('/api/portfolio' + path + query, body ? 'POST' : 'GET', body && body.portfolio === undefined ? { ...body, portfolio: PORT.active } : body);
  const view = data.portfolio || data, list = data.portfolios || PORT.data?.portfolios;
  if (path === '/create' || path === '/delete' || !PORT.active || !PORT.data) setActivePortfolio(view.id);   // a new portfolio opens at once; after a delete the first one is shown
  if (view.id === PORT.active) PORT.data = { ...view, portfolios: list };
  else if (PORT.data) PORT.data = { ...PORT.data, portfolios: list };
  PORT.error = '';
  return data;
}
async function loadPortfolio(force) {
  if (!window.dashboardRunToken) return null;
  if (PORT.data && !force) return PORT.data;
  try { await portfolioCall(''); }
  catch (e) {
    if (PORT.active) { setActivePortfolio(null); PORT.data = null; try { await portfolioCall(''); return PORT.data; } catch (e2) { e = e2; } }   // the remembered portfolio no longer exists
    PORT.error = e.message;
  }
  return PORT.data;
}
/* prices: refreshed every 5 minutes while the dashboard is open, and on opening the page when stale */
async function refreshPrices() {
  if (!window.dashboardRunToken || PORT.refreshing || !PORT.data?.positions?.length) return;
  PORT.refreshing = true;
  try { await portfolioCall('/prices', {}); } catch (e) { PORT.error = e.message; }
  PORT.refreshing = false;
  if (App.route() === 'portfolio') App.render();
}
function startPriceTimer() {
  if (!window.dashboardRunToken || PORT.timer) return;
  PORT.timer = setInterval(refreshPrices, PRICE_EVERY);
  loadPortfolio().then(d => { App.updateNav(); if (d && (!d.pricesAt || Date.now() - new Date(d.pricesAt) > PRICE_EVERY)) refreshPrices(); });
}

/* ---------- Invest dialog (from the filtered and full lists) ---------- */
const investButton = r => h('button', { class: 'inv-btn', title: tr('Invest'), onclick: e => { e.stopPropagation(); openInvest(r); } }, icon('plus', 13), h('span', null, tr('Invest')));
function closeInvest() { $('#invest')?.remove(); if (!$('#pal').classList.contains('on')) $('#back').classList.remove('on'); }
async function openInvest(r) {
  if (!window.dashboardRunToken) { toast('Open the dashboard with run_dashboard.bat to use the demo portfolio.'); return; }
  closeInvest();
  const d = await loadPortfolio();
  const list = d?.portfolios?.length ? d.portfolios : d ? [{ id: d.id, name: d.name, cash: d.cash }] : [];
  let target = list.find(p => p.id === PORT.active) || list[0], cashLeft = target ? target.cash : null;
  const amount = h('input', { class: 'in', type: 'number', min: '1', step: '0.01', value: num(cashLeft) ? Math.min(1000, Math.floor(cashLeft)) : 1000, id: 'investAmount' });
  const est = h('b', { class: 'notr' }), err = h('p', { class: 'negative', role: 'alert' }), cashEl = h('strong', { class: 'notr' });
  const chooser = list.length > 1 ? field('Portfolio', selectEl(list.map(p => [p.id, p.name + ' · ' + usd(p.cash)]), target.id, v => { target = list.find(p => p.id === v); cashLeft = target.cash; update(); }, 'sel')) : null;
  const go = h('button', { class: 'btn pri', id: 'investConfirm' }, icon('wallet'), h('span', null, 'Invest'));
  const update = () => { cashEl.textContent = num(cashLeft) ? usd(cashLeft) : '—'; const v = Number(amount.value); est.textContent = r.price > 0 && v > 0 ? nf(v / r.price, 4) : '—'; go.disabled = !(v > 0) || (num(cashLeft) && v > cashLeft + 1e-9); err.textContent = num(cashLeft) && v > cashLeft + 1e-9 ? tr('Amount exceeds available cash.') : ''; };
  amount.addEventListener('input', update);
  go.addEventListener('click', async () => {
    go.disabled = true; err.textContent = '';
    try {
      const res = await portfolioCall('/buy', { symbol: r.symbol, amount: Number(amount.value), reportPrice: r.price, analysis: snapshotOf(r), portfolio: target.id });
      const p = res.position; closeInvest(); App.updateNav();
      toast(tr('Bought') + ' ' + nf(p.shares, 4) + ' × ' + p.symbol + ' @ ' + usd(p.price) + (p.source === 'live' ? '' : ' (' + tr('report price') + ')') + (list.length > 1 ? ' · ' + target.name : ''));
    } catch (e) { err.textContent = tr(e.message); go.disabled = false; }
  });
  const box = h('div', { class: 'modal on invest', id: 'invest', role: 'dialog', 'aria-label': 'Invest' },
    h('div', { class: 'inv-h' }, h('div', null, h('div', { class: 'up' }, 'Invest · demo portfolio'), h('div', { class: 'symbol notr' }, r.symbol), h('div', { class: 'muted notr' }, r.company + ' · ' + r.sector)),
      h('button', { class: 'ico-btn', title: 'Close', onclick: closeInvest }, icon('x', 16))),
    h('div', { class: 'inv-b' },
      h('div', { class: 'minis' }, h('div', null, h('small', null, 'Report price'), h('strong', { class: 'notr' }, usd(r.price))),
        h('div', null, h('small', null, 'Available cash'), cashEl),
        h('div', null, h('small', null, 'Estimated shares'), est)),
      chooser, field('Amount (USD)', amount),
      h('div', { class: 'chips', style: { marginTop: '8px' } }, [100, 500, 1000, 2500].map(v => h('span', { class: 'chip tog notr', onclick: () => { amount.value = v; update(); } }, '$' + nf(v)))),
      h('p', { class: 'muted small' }, 'The final number of shares uses the live Yahoo price at confirmation (the report price if Yahoo is unavailable).'), err,
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: closeInvest }, 'Cancel'), go)));
  document.body.append(box); $('#back').classList.add('on'); update(); setTimeout(() => amount.select(), 30);
}

/* ---------- Portfolio page ---------- */
function historyChart(hist) {
  const pts = hist.points || [];
  if (pts.length < 2) return h('p', { class: 'muted small' }, 'Not enough daily prices yet; the chart fills in as days pass.');
  const W = 1100, H = 230, L = 56, R = 12, T = 12, B = 26, vals = pts.map(p => p[1]).concat(hist.price);
  const lo = Math.min(...vals) * .98, hi = Math.max(...vals) * 1.02, x = i => L + i * (W - L - R) / (pts.length - 1), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const up = pts[pts.length - 1][1] >= hist.price, color = up ? 'var(--good)' : 'var(--bad)';
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p[1]).toFixed(1)).join(' ');
  const ticks = [lo, (lo + hi) / 2, hi].map(v => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(nf(v))}</text>`).join('');
  const el = h('div', { class: 'notr' });
  el.innerHTML = `<svg class="chart-svg hist" viewBox="0 0 ${W} ${H}">${ticks}<line x1="${L}" x2="${W - R}" y1="${y(hist.price)}" y2="${y(hist.price)}" stroke="var(--muted)" stroke-dasharray="5 5"/>`
    + `<path d="${line} L${x(pts.length - 1)},${H - B} L${x(0)},${H - B}Z" fill="${color}" opacity=".12"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.4"/>`
    + `<text x="${L}" y="${H - 6}">${esc(pts[0][0])}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(pts[pts.length - 1][0])}</text></svg>`;
  return el;
}
async function toggleHistory(p) {
  PORT.open = PORT.open === p.id ? null : p.id;
  if (PORT.open && !PORT.hist[p.id]) {
    PORT.hist[p.id] = { loading: true };
    App.render();
    try { PORT.hist[p.id] = await runRequest('/api/portfolio/history?id=' + encodeURIComponent(p.id)); }
    catch (e) { PORT.hist[p.id] = { error: e.message }; }
  }
  if (App.route() === 'portfolio') App.render();
}
/* hover: the analysis card saved on the day of the investment */
function analysisPop(p) {
  const pop = $('#pfPop'); if (!pop) return;
  const a = p.analysis || {};
  if (!a.symbol) { pop.hidden = true; return; }
  pop.replaceChildren(h('div', { class: 'pf-pop-h' }, h('span', null, 'Analysis on the investment day'), ' · ', h('span', { class: 'notr' }, a.reportDate || day(p.opened))),
    stockCard({ ...a, issues: a.issues || [] }, 0));
  pop.hidden = false;
}
function placePop(e) {
  const pop = $('#pfPop'); if (!pop || pop.hidden) return;
  const w = pop.offsetWidth, hh = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 18)) + 'px';
  pop.style.top = Math.max(8, Math.min(innerHeight - hh - 8, e.clientY - hh / 3)) + 'px';
}
async function sellPosition(p) {
  if (!ask('Sell this position at the current price?')) return;
  try { const res = await portfolioCall('/sell', { id: p.id }); toast(tr('Position closed') + ': ' + p.symbol + ' ' + signed(res.closed.proceeds - res.closed.amount)); }
  catch (e) { toast(tr(e.message)); }
  App.render();
}
async function accountAction(kind) {
  const label = kind === 'deposit' ? 'Amount to add (USD)' : 'Starting capital (USD)';
  const value = Number(String(prompt(tr(label), kind === 'capital' ? PORT.data?.capital ?? 10000 : 1000) ?? '').replace(',', '.'));
  if (!(value > 0)) return;
  try { await portfolioCall('/' + kind, { amount: value }); toast(kind === 'deposit' ? 'Funds added' : 'Starting capital updated'); }
  catch (e) { toast(tr(e.message)); }
  App.render();
}
/* ---------- several portfolios, each with a name the user chose ---------- */
async function switchPortfolio(id) {
  if (id === PORT.active) return;
  const keep = PORT.active; setActivePortfolio(id); PORT.data = { ...(PORT.data || {}), id: null }; PORT.open = null;
  try { await portfolioCall(''); } catch (e) { setActivePortfolio(keep); PORT.error = e.message; }
  App.render(); App.updateNav();
}
async function newPortfolio() {
  const name = String(prompt(tr('Name of the new portfolio')) ?? '').trim(); if (!name) return;
  const capital = Number(String(prompt(tr('Starting capital (USD)'), 10000) ?? '').replace(',', '.'));
  if (!(capital > 0)) return;
  try { await portfolioCall('/create', { name, capital, portfolio: null }); PORT.open = null; toast(tr('Portfolio created') + ': ' + name); }
  catch (e) { toast(tr(e.message)); }
  App.render(); App.updateNav();
}
async function renamePortfolio() {
  const name = String(prompt(tr('New name of the portfolio'), PORT.data?.name || '') ?? '').trim(); if (!name || name === PORT.data?.name) return;
  try { await portfolioCall('/rename', { name }); toast('Portfolio renamed'); } catch (e) { toast(tr(e.message)); }
  App.render();
}
async function deletePortfolio() {
  const d = PORT.data;
  if (!d || !ask(tr('Delete this portfolio with all its positions and history?') + ' ' + d.name)) return;
  try { await portfolioCall('/delete', {}); PORT.open = null; toast('Portfolio deleted'); } catch (e) { toast(tr(e.message)); }
  App.render(); App.updateNav();
}
function portfolioBar(d) {
  const list = d.portfolios || [];
  return h('div', { class: 'pf-bar' },
    h('div', { class: 'pf-tabs', role: 'tablist', 'aria-label': tr('Portfolios') }, list.map(p => h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.id === d.id), class: 'pf-tab' + (p.id === d.id ? ' on' : ''), title: p.name,
      onclick: () => switchPortfolio(p.id) }, h('b', { class: 'notr' }, p.name), h('small', { class: 'notr ' + plClass(p.totalPct) }, usd(p.equity) + ' · ' + signedPct(p.totalPct))))),
    h('div', { class: 'row' }, btn('New portfolio', 'plus', newPortfolio, 'sm'), btn('Rename', 'edit', renamePortfolio, 'sm ghost'),
      list.length > 1 ? btn('Delete portfolio', 'x', deletePortfolio, 'sm ghost') : null));
}
Views.portfolio = () => {
  if (!window.dashboardRunToken) return card('Portfolio', null, h('div', { class: 'banner' }, icon('alert', 18), h('span', null, 'Open the dashboard with run_dashboard.bat to use the demo portfolio.')));
  const d = PORT.data;
  if (!d) { loadPortfolio().then(() => App.route() === 'portfolio' && App.render()); return card('Portfolio', null, h('div', { class: 'empty' }, PORT.error || 'Loading the portfolio…')); }
  if (d.pricesAt && Date.now() - new Date(d.pricesAt) > PRICE_EVERY) setTimeout(refreshPrices, 0);
  const money = (label, value, sub, cls = '') => h('div', { class: 'card kpi ' + cls }, h('div', { class: 'l' }, label), h('div', { class: 'v notr ' + (cls.includes('pl') ? plClass(value) : '') }, cls.includes('pl') ? signed(value) : usd(value)), h('div', { class: 's notr' }, sub));
  const head = cols => h('thead', null, h('tr', null, cols.map(c => h('th', { class: /^(Invested|Shares|Buy price|Current price|Value|P\/L|Proceeds|Close price)/.test(c) ? 'r' : '' }, c))));
  const rows = [];
  for (const p of d.positions) {
    const tr_ = h('tr', { class: 'pf-row' + (PORT.open === p.id ? ' open' : ''), onclick: () => toggleHistory(p), onmouseenter: e => { analysisPop(p); placePop(e); }, onmousemove: placePop, onmouseleave: () => { const pop = $('#pfPop'); if (pop) pop.hidden = true; } },
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(p.symbol, 28), h('div', null, h('b', { class: 'notr' }, p.symbol), h('div', { class: 'muted small notr' }, p.company)))),
      h('td', { class: 'notr' }, day(p.opened)), h('td', { class: 'r notr' }, usd(p.amount)), h('td', { class: 'r notr' }, nf(p.shares, 4)),
      h('td', { class: 'r notr' }, usd(p.price), p.source === 'live' ? null : h('div', { class: 'muted small' }, 'report price')),
      h('td', { class: 'r' }, h('span', { class: 'notr' }, usd(p.current)), h('div', { class: 'muted small notr' }, when(p.priceAt))),
      h('td', { class: 'r notr' }, usd(p.value)), h('td', { class: 'r notr ' + plClass(p.pl) }, signed(p.pl)), h('td', { class: 'r notr' }, h('span', { class: 'plpill ' + plClass(p.plPct) }, signedPct(p.plPct))),
      h('td', { class: 'r' }, h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); sellPosition(p); } }, 'Sell position')));
    rows.push(tr_);
    if (PORT.open === p.id) {
      const hst = PORT.hist[p.id] || {};
      rows.push(h('tr', { class: 'pf-chart' }, h('td', { colspan: 10 }, h('div', { class: 'muted small' }, 'Daily price since the investment · dashed line = buy price'),
        hst.loading ? h('div', { class: 'empty' }, 'Loading price history…') : hst.error ? h('p', { class: 'negative' }, tr(hst.error)) : historyChart(hst))));
    }
  }
  return h('div', null,
    portfolioBar(d),
    h('div', { class: 'kpis pf-kpis' },
      money('Account value', d.equity, signed(d.total) + ' · ' + signedPct(d.totalPct)),
      money('Available cash', d.cash, tr('funded') + ' ' + usd(d.funded)),
      money('Invested', d.invested, d.positions.length + ' ' + tr('open positions')),
      money('Positions value', d.value, d.pricesAt ? tr('prices') + ' ' + when(d.pricesAt) : '—'),
      money('Unrealized P/L', d.unrealized, signedPct(d.unrealizedPct), 'pl'),
      money('Realized P/L', d.realized, d.closed.length + ' ' + tr('closed positions'), 'pl')),
    PORT.error ? h('p', { class: 'negative' }, tr(PORT.error)) : null,
    d.positions.length ? h('div', { class: 'grid mt' },
      card('Allocation', 'Current value of each position · hover for value and P/L', donut(d.positions.map((p, i) => ({ label: p.symbol, value: Math.round(p.value), color: CHART_COLORS[i % CHART_COLORS.length] }))
        .concat(d.cash > 0.5 ? [{ label: tr('Cash'), value: Math.round(d.cash), color: 'var(--track)' }] : []), { label: 'USD' }), null, 'c5'),
      card('P/L per position', 'Hover a bar for the details', barList(d.positions.map(p => ({ label: p.symbol, logo: true, value: p.pl, color: p.pl < 0 ? 'var(--bad)' : 'var(--good)',
        tip: tipHtml(p.symbol + ' · ' + p.company, [tipRow('Invested', usd(p.amount)), tipRow('Shares', nf(p.shares, 4)), tipRow('Buy price', usd(p.price)), tipRow('Current price', usd(p.current)),
          tipRow('Value', usd(p.value)), tipRow('P/L $', signed(p.pl)), tipRow('P/L %', signedPct(p.plPct))]) })), { fmt: v => signed(v) }), null, 'c7')) : null,
    card('Open positions', 'Prices refresh automatically every 5 minutes · hover a row for the analysis, click it for the price evolution',
      d.positions.length ? h('div', { class: 'tbl-wrap', 'data-keep': 'pf' }, h('table', { class: 'pf-tbl' },
        head(['Symbol', 'Date', 'Invested', 'Shares', 'Buy price', 'Current price', 'Value', 'P/L $', 'P/L %', '']), h('tbody', null, rows)))
        : h('div', { class: 'empty' }, 'No open positions yet. Use “Invest” on a row of the Filtered list or the Full SP500 list.'),
      h('div', { class: 'row' }, btn('Add funds', 'plus', () => accountAction('deposit'), 'sm'), btn('Starting capital', 'edit', () => accountAction('capital'), 'sm')), 'mt'),
    card('Closed positions', null, d.closed.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl' },
      head(['Symbol', 'Opened', 'Closed', 'Invested', 'Buy price', 'Close price', 'Proceeds', 'P/L $', 'P/L %']),
      h('tbody', null, [...d.closed].reverse().map(c => h('tr', null, h('td', null, h('b', { class: 'notr' }, c.symbol), h('div', { class: 'muted small notr' }, c.company)),
        h('td', { class: 'notr' }, day(c.opened)), h('td', { class: 'notr' }, day(c.closed)), h('td', { class: 'r notr' }, usd(c.amount)), h('td', { class: 'r notr' }, usd(c.price)),
        h('td', { class: 'r notr' }, usd(c.closePrice)), h('td', { class: 'r notr' }, usd(c.proceeds)), h('td', { class: 'r notr ' + plClass(c.pl) }, signed(c.pl)),
        h('td', { class: 'r notr' }, h('span', { class: 'plpill ' + plClass(c.plPct) }, signedPct(c.plPct))))))))
      : h('div', { class: 'empty' }, 'No closed positions yet.'), null, 'mt'),
    h('div', { class: 'pf-pop', id: 'pfPop', hidden: true }));
};
