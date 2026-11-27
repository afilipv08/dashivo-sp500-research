'use strict';
/* ================= Site mode (GitHub Pages): no server on this side =================
   Data comes from files that GitHub Actions rebuilds (data/*.json); the demo portfolio lives in this browser;
   research runs as a GitHub Actions workflow. Every `runRequest('/api/…')` is answered here instead. */
const SITE = { meta: null, files: {} };
const SITE_PF_KEY = 'dashivo-sp500-portfolio';
async function siteFile(name, fresh = true) {
  if (!fresh && SITE.files[name]) return SITE.files[name];
  const response = await fetch('data/' + name + '?t=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) throw Error(name === 'crypto.json' ? 'Crypto data is unavailable right now.' : 'Live prices are unavailable right now.');
  return SITE.files[name] = await response.json();
}
async function siteMeta() { if (!SITE.meta) { try { SITE.meta = await siteFile('meta.json', false); } catch (e) { SITE.meta = {}; } } return SITE.meta; }

/* ---------- demo portfolios in localStorage (same rules as portfolio.py); several, each with a name the user chose ---------- */
const PF_MAX = 20, PF_MAX_NAME = 40;
const pfEmpty = (name = 'Main portfolio', capital = 10000, id) => ({ id: id || Math.random().toString(36).slice(2, 10), name, capital, deposits: [], positions: [], closed: [], prices: {} });
/* a device that saved one portfolio before several existed keeps it as the first one */
function pfStore() {
  const raw = store.get(SITE_PF_KEY, null);
  const list = raw && Array.isArray(raw.portfolios) && raw.portfolios.length ? raw.portfolios
    : raw && typeof raw === 'object' && Array.isArray(raw.positions) ? [{ ...raw, id: 'main', name: 'Main portfolio' }] : [pfEmpty(undefined, undefined, 'main')];
  return { portfolios: list.map(a => Object.assign(pfEmpty(a.name, 10000, a.id), a)) };
}
const pfStoreSave = st => store.set(SITE_PF_KEY, st);
function pfFind(st, id) {
  if (!id) return st.portfolios[0];
  const a = st.portfolios.find(x => x.id === id); if (!a) throw Error('Portfolio not found.');
  return a;
}
function pfCleanName(name, others) {
  name = String(name || '').trim().split(/\s+/).join(' ');
  if (!name || name.length > PF_MAX_NAME) throw Error('Give the portfolio a name of 1 to ' + PF_MAX_NAME + ' characters.');
  if (others.some(o => String(o).toLowerCase() === name.toLowerCase())) throw Error('A portfolio with this name already exists.');
  return name;
}
const pfCash = d => d.capital + d.deposits.reduce((a, x) => a + x.amount, 0) - d.positions.reduce((a, p) => a + p.amount, 0) - d.closed.reduce((a, c) => a + c.amount, 0) + d.closed.reduce((a, c) => a + c.proceeds, 0);
function pfSummary(d) {
  const positions = d.positions.map(p => { const q = d.prices[p.symbol] || {}, cur = q.price || p.price, value = p.shares * cur;
    return { ...p, current: cur, priceAt: q.at || p.opened, priceSource: q.source || p.source, value, pl: value - p.amount, plPct: value / p.amount - 1 }; });
  const closed = d.closed.map(c => ({ ...c, pl: c.proceeds - c.amount, plPct: c.proceeds / c.amount - 1 }));
  const invested = positions.reduce((a, p) => a + p.amount, 0), value = positions.reduce((a, p) => a + p.value, 0), cash = pfCash(d);
  const funded = d.capital + d.deposits.reduce((a, x) => a + x.amount, 0), stamps = Object.values(d.prices).map(q => q.at).filter(Boolean).sort();
  return { id: d.id, name: d.name, capital: d.capital, deposits: d.deposits, funded, cash, invested, value, equity: cash + value, unrealized: value - invested, unrealizedPct: invested ? value / invested - 1 : null,
    realized: closed.reduce((a, c) => a + c.pl, 0), total: cash + value - funded, totalPct: funded ? (cash + value) / funded - 1 : null, positions, closed, pricesAt: stamps[stamps.length - 1] || null };
}
const pfListing = st => st.portfolios.map(d => { const v = pfSummary(d); return { id: d.id, name: d.name, equity: v.equity, cash: v.cash, total: v.total, totalPct: v.totalPct, positions: v.positions.length }; });
const positiveNum = (v, what) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw Error('Invalid ' + what + '.'); return n; };
async function liveQuote(symbol) {
  try { const l = await siteFile('live_prices.json'); const p = l.prices?.[symbol]; if (num(p) && p > 0) return { price: p, at: l.at, source: 'live' }; } catch (e) { }
  return null;
}
/* every await (live quote, price file) happens BEFORE the store is read, so two actions in flight cannot overwrite each other */
async function pfAction(action, body) {
  const now = new Date().toISOString(), pid = typeof body.portfolio === 'string' ? body.portfolio : null;
  let quote = null, files = null;
  if (action === 'buy') quote = await liveQuote(String(body.symbol || '').trim().toUpperCase());
  else if (action === 'sell') { const p = pfFind(pfStore(), pid).positions.find(x => x.id === body.id); quote = p ? await liveQuote(p.symbol) : null; }
  else if (action === 'prices') files = await siteFile('live_prices.json');
  const st = pfStore();
  const reply = (d, extra) => ({ ...extra, portfolio: pfSummary(d), portfolios: pfListing(st) });
  if (action === 'create') {
    if (st.portfolios.length >= PF_MAX) throw Error('At most ' + PF_MAX + ' portfolios.');
    const d = pfEmpty(pfCleanName(body.name, st.portfolios.map(x => x.name)), body.capital == null || body.capital === '' ? 10000 : positiveNum(body.capital, 'starting capital'));
    st.portfolios.push(d); pfStoreSave(st); return reply(d);
  }
  if (action === 'rename') { const d = pfFind(st, pid); d.name = pfCleanName(body.name, st.portfolios.filter(x => x !== d).map(x => x.name)); pfStoreSave(st); return reply(d); }
  if (action === 'delete') {
    const d = pfFind(st, pid); if (st.portfolios.length === 1) throw Error('The last portfolio cannot be deleted.');
    st.portfolios = st.portfolios.filter(x => x !== d); pfStoreSave(st); return reply(st.portfolios[0]);
  }
  const d = pfFind(st, pid);
  if (action === 'buy') {
    const symbol = String(body.symbol || '').trim().toUpperCase(); if (!symbol) throw Error('Invalid symbol.');
    const amount = positiveNum(body.amount, 'amount');
    if (amount > pfCash(d) + 1e-9) throw Error('Amount exceeds available cash.');
    const q = quote || (num(body.reportPrice) && body.reportPrice > 0 ? { price: body.reportPrice, at: now, source: 'report' } : null);
    if (!q) throw Error('No price available for ' + symbol + '.');
    const a = body.analysis || {};
    const position = { id: Math.random().toString(36).slice(2, 12), symbol, company: a.company || symbol, sector: a.sector || '', opened: now, amount, price: q.price, shares: amount / q.price, source: q.source, analysis: a };
    d.positions.push(position); d.prices[symbol] = { price: q.price, at: q.at, source: q.source }; pfStoreSave(st);
    return reply(d, { position });
  }
  if (action === 'sell') {
    const p = d.positions.find(x => x.id === body.id); if (!p) throw Error('Position not found.');
    const q = quote || { price: d.prices[p.symbol]?.price || p.price, at: now, source: 'last' };
    d.positions = d.positions.filter(x => x !== p);
    const closed = { ...p, closed: now, closePrice: q.price, closeSource: q.source, proceeds: p.shares * q.price };
    d.closed.push(closed); d.prices[p.symbol] = { price: q.price, at: q.at, source: q.source }; pfStoreSave(st);
    return reply(d, { closed });
  }
  if (action === 'deposit') { d.deposits.push({ amount: positiveNum(body.amount, 'amount'), at: now }); pfStoreSave(st); return reply(d); }
  if (action === 'capital') {
    const old = d.capital; d.capital = positiveNum(body.amount, 'amount');
    if (pfCash(d) < -1e-9) { d.capital = old; throw Error('Starting capital cannot be lower than the money already invested.'); }
    pfStoreSave(st); return reply(d);
  }
  if (action === 'prices') {
    for (const p of d.positions) if (num(files.prices?.[p.symbol])) d.prices[p.symbol] = { price: files.prices[p.symbol], at: files.at, source: 'live' };
    pfStoreSave(st); return reply(d);
  }
  throw Error('Ruta necunoscuta');
}
function pfExport() {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(pfStore(), null, 1)], { type: 'application/json' })), download: fileName('Portfolios', 'json') });
  document.body.append(a); a.click(); a.remove(); toast('Backup exported');
}
function pfImport() {
  const f = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  f.addEventListener('change', () => { const file = f.files[0]; f.remove(); if (!file) return;
    file.text().then(t => { try {
      const d = JSON.parse(t), valid = a => a && Array.isArray(a.positions) && Array.isArray(a.closed) && num(a.capital);
      const list = Array.isArray(d?.portfolios) ? d.portfolios : [d];
      if (!list.length || !list.every(valid)) throw 0;
      if (!ask('Replace the portfolios on this device with the backup file?')) return;
      pfStoreSave({ portfolios: list.map((a, i) => ({ ...pfEmpty(a.name || 'Portfolio ' + (i + 1), 10000, a.id || (i ? undefined : 'main')), ...a })) });
      PORT.data = null; PORT.active = null; App.render(); toast('Backup imported'); }
    catch (e) { toast('That file is not a valid portfolio backup'); } }); });
  document.body.append(f); f.click();
}

/* ---------- the /api/* routes, answered from files and localStorage ---------- */
async function staticApi(path, method, body) {
  const [route, query] = path.split('?');
  if (route === '/api/live-prices') return siteFile('live_prices.json');
  if (route === '/api/crypto' || route === '/api/crypto/refresh') return siteFile('crypto.json');
  if (route === '/api/ratings') {
    const sym = new URLSearchParams(query).get('symbol'), all = await siteFile('ratings.json', false).catch(() => ({}));
    if (!all[sym]) throw Error('Rating history is unavailable right now.');
    return all[sym];
  }
  if (route === '/api/top10-history') return siteFile('top10_history.json', false).catch(() => ({ days: [] }));
  if (route === '/api/market-history') return siteFile('history.json', false);
  if (route === '/api/intrinsic-values') return siteFile('intrinsic_values.json', false);
  if (route === '/api/technical') return siteFile('technical.json', false);
  if (route === '/api/agents') {   // runs only on the PC with the user's own install; the online copy shows the answers saved so far
    const q = new URLSearchParams(query), program = q.get('program') || 'tradingagents', saved = (await siteFile('pc_analysis.json', false).catch(() => ({})))[program] || {};
    const results = {}; (q.get('symbols') || '').split(',').forEach(s => { if (saved[s]) results[s] = saved[s]; });
    return { program, available: false, results, run: {}, checkedAt: new Date().toISOString() };
  }
  if (route === '/api/portfolio') { const st = pfStore(); return { ...pfSummary(pfFind(st, new URLSearchParams(query).get('id'))), portfolios: pfListing(st) }; }
  if (route === '/api/portfolio/history') {
    const id = new URLSearchParams(query).get('id'), p = pfStore().portfolios.flatMap(d => [...d.positions, ...d.closed]).find(x => x.id === id);
    if (!p) throw Error('Position not found.');
    const all = await siteFile('history.json', false).catch(() => ({}));
    const closes = all.series?.[p.symbol] || [];   // aligned on all.dates to keep the file small
    const points = (all.dates || []).map((day, i) => [day, closes[i]]).filter(([day, v]) => num(v) && day >= p.opened.slice(0, 10));
    return { id, symbol: p.symbol, price: p.price, points };
  }
  if (route.startsWith('/api/portfolio/')) return pfAction(route.split('/').pop(), body || {});
  if (route === '/api/status') { const m = await siteMeta(); return { running: false, progress: 0, phase: null, message: m.reportAt ? 'Last research run on GitHub' : 'Ready to start.', resumable: null }; }
  throw Error('Not available in the online version.');
}

/* ---------- research: runs as a GitHub Actions workflow ---------- */
function siteResearchCard() {
  const m = SITE.meta || {};
  siteMeta().then(x => { if (x !== m && App.route() === 'research') App.render(); });
  const row = (label, value) => h('div', null, h('small', null, label), h('b', { class: 'notr' }, value || '—'));
  return card('Research', 'In the online version the research runs on GitHub servers: automatically once a day, or now from the button. It takes about 10 minutes; the site updates itself when it finishes.', h('div', null,
    h('div', { class: 'ind-grid' }, row('Current report', DATA.sourceDate), row('Last research run', m.reportAt ? when(m.reportAt) : null), row('Prices updated', m.pricesAt ? when(m.pricesAt) : null), row('Next automatic run', tr('Once a day'))),
    h('div', { class: 'row mt' }, m.workflowUrl ? h('a', { class: 'btn pri', href: m.workflowUrl, target: '_blank', rel: 'noopener' }, icon('play'), h('span', null, 'Start the research on GitHub')) : null,
      m.repoUrl ? h('a', { class: 'btn', href: m.repoUrl + '/tree/main/Output', target: '_blank', rel: 'noopener' }, icon('file'), h('span', null, 'All Excel reports')) : null),
    h('p', { class: 'muted small' }, 'On the GitHub page tap “Run workflow”, then “Run workflow” again. You need to be signed in to GitHub.')), null, 'c12');
}

if (window.dashboardStatic) {
  const baseResearch = Views.research;
  Views.research = () => { const node = baseResearch(); node.firstChild.replaceWith(siteResearchCard()); return node; };
  const basePortfolio = Views.portfolio;
  Views.portfolio = () => {
    if (!PORT.data) { const st = pfStore(); PORT.data = { ...pfSummary(pfFind(st, PORT.active && st.portfolios.some(x => x.id === PORT.active) ? PORT.active : null)), portfolios: pfListing(st) }; }
    const node = basePortfolio(), actions = node.querySelector('.card-h .row');
    if (actions) add(actions, [btn('Export backup', 'dl', pfExport, 'sm'), btn('Import backup', 'upload', pfImport, 'sm')]);
    node.prepend(h('div', { class: 'banner' }, icon('wallet', 16), h('span', null, 'The demo portfolio is saved on this device only. Use Export backup to keep a copy or to move it to another phone.')));
    return node;
  };
}
