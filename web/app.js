'use strict';
/* ================= SP500 app shell: router, top bar, run program, import, palette ================= */

/* ---------- run the Python research through dashboard_server.py ---------- */
const RUN = { running: false, progress: 0, message: 'Ready to start.', error: '', phase: null, done: 0, total: 0, ok: 0, errors: 0, resumed: 0, elapsed: null, eta: null, resumable: null };
const RUN_PHASES = [['list', 'S&P 500 list'], ['quotes', 'Quotes + analysts'], ['export', 'Excel + Top 5'], ['load', 'Loading into the dashboard']];
const duration = s => num(s) ? (s >= 60 ? Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0') + ' s' : Math.round(s) + ' s') : '—';
async function runRequest(path, method = 'GET', body) {
  if (window.dashboardStatic) return staticApi(path, method, body);   // online version: files + this browser
  const headers = { 'X-Dashboard-Token': window.dashboardRunToken };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Local server error');
  return data;
}
function runPaint() {
  const bar = $('#runBar i'); if (bar) bar.style.width = RUN.progress + '%';
  const set = (id, text) => { const el = $(id); if (el && el.textContent !== text) el.textContent = text; };
  set('#runPct', RUN.running || RUN.progress ? Math.round(RUN.progress) + '%' : '');
  set('#runCount', RUN.total ? 'Analyzed ' + RUN.done + ' of ' + RUN.total + ' stocks' : '');
  set('#runStatus', RUN.message); set('#runError', RUN.error);
  set('#runOk', String(RUN.ok)); set('#runErrors', String(RUN.errors)); set('#runElapsed', duration(RUN.elapsed)); set('#runEta', num(RUN.eta) ? '~' + duration(RUN.eta) : '—');
  set('#runResumed', RUN.resumed ? RUN.resumed + ' resumed from the interrupted run' : '');
  const at = RUN_PHASES.findIndex(p => p[0] === RUN.phase), finished = RUN.phase === 'done';
  $$('#runPhases .phase').forEach((el, i) => { el.classList.toggle('ok', finished || (at >= 0 && i < at)); el.classList.toggle('on', RUN.running && i === at); });
  const stats = $('#runStats'); if (stats) stats.hidden = !RUN.running && !finished;
  const resume = $('#runResume'), r = RUN.resumable;
  if (resume) {
    resume.hidden = RUN.running || !r || !r.done;
    if (r && r.done) set('#runResumeText', 'An interrupted run from today already saved ' + r.done + ' of ' + (r.total ?? '?') + ' stocks.');
  }
  const b = $('#runButton'); if (b) b.disabled = RUN.running;
  App.updateNav();
}
function runState(state) {
  for (const k of ['running', 'phase', 'done', 'total', 'ok', 'errors', 'resumed', 'elapsed', 'eta']) RUN[k] = state[k] ?? RUN[k];
  RUN.progress = state.progress || 0; RUN.message = state.message || ''; RUN.resumable = state.resumable ?? null;
}
async function followProgram() {
  try {
    const state = await runRequest('/api/status'); runState(state); runPaint();
    if (state.running) { setTimeout(followProgram, 1500); return; }
    if (state.error) throw Error(state.error);
    if (state.report) {
      Object.assign(DATA, await runRequest('/api/result')); excelObjectUrl = null;
      RUN.progress = 100; RUN.message = 'Done: ' + DATA.bulkCount + ' stocks read. The table and charts use the new Excel.';
      App.render(); toast('Research complete. Dashboard updated.');
    }
  } catch (e) { RUN.running = false; RUN.error = e.message; RUN.message = 'Run failed. Previous data is retained.'; RUN.progress = 0; }
  runPaint();
}
async function startRun() {
  RUN.error = '';
  if (window.dashboardStatic) { const m = await siteMeta(); if (m.workflowUrl) window.open(m.workflowUrl, '_blank', 'noopener'); else App.go('research'); return; }
  if (!window.dashboardRunToken) { RUN.error = 'Open the dashboard with run_dashboard.bat (http://127.0.0.1:8765) to run the program. A file opened directly cannot start Python for security reasons.'; if (App.route() !== 'research') App.go('research'); runPaint(); return; }
  if (RUN.running) { App.go('research'); return; }
  if (RUN.resumable && RUN.resumable.done) { if (App.route() !== 'research') App.go('research'); runPaint(); $('#runResume')?.scrollIntoView({ block: 'center' }); return; }
  if (!ask('Start a full Yahoo Finance download? It can take about 5 minutes.')) return;
  launchRun(false);
}
async function launchRun(resume) {
  Object.assign(RUN, { running: true, phase: 'list', done: 0, total: 0, ok: 0, errors: 0, resumed: 0, elapsed: 0, eta: null, resumable: null, progress: 1, error: '', message: 'Program started. Downloading Yahoo data…' });
  if (App.route() !== 'research') App.go('research'); runPaint();
  try { await runRequest('/api/run', 'POST', { resume }); followProgram(); }
  catch (e) { RUN.running = false; RUN.error = e.message; runPaint(); }
}

/* ---------- manual Excel import ---------- */
const IMPORT = { busy: false, message: 'Snapshot data is already displayed. You can load another report.', error: '' };
function importPaint(value) {
  const bar = $('#importBar i'); if (bar && value != null) bar.style.width = value + '%';
  const s = $('#importStatus'); if (s) s.textContent = IMPORT.message; const e = $('#importError'); if (e) e.textContent = IMPORT.error;
  const b = $('#importButton'); if (b) b.disabled = IMPORT.busy;
}
async function loadExcel(file) {
  if (IMPORT.busy) return; IMPORT.busy = true; IMPORT.error = ''; importPaint(0);
  try {
    const next = await readWorkbook(file, (v, text) => { IMPORT.message = text; importPaint(v); });
    Object.assign(DATA, next);
    if (excelObjectUrl) URL.revokeObjectURL(excelObjectUrl); excelObjectUrl = URL.createObjectURL(file);
    IMPORT.message = 'Done: ' + next.items.length + ' stocks loaded from ' + file.name + '.';
    App.render(); importPaint(100); toast('Excel loaded');
  } catch (e) { IMPORT.message = 'Import failed. Previous data is retained.'; IMPORT.error = e.message || String(e); importPaint(0); }
  finally { IMPORT.busy = false; importPaint(); const f = $('#excelFile'); if (f) f.value = ''; }
}

/* ---------- live prices: requested on every opening of the dashboard, kept until the next one ---------- */
const LIVE_EVERY = 5 * 60 * 1000;
async function loadLivePrices() {
  if (!window.dashboardRunToken) return;
  /* repaint without stealing focus: Top 10 only redraws its cards; tables wait while a filter is being typed */
  const show = () => {
    const r = App.route(), typing = document.activeElement?.closest?.('#view') && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (r === 'top10') refreshTop(); else if (['filtered', 'universe'].includes(r) && !typing) App.render();
  };
  if (!LIVE.at) { try { Object.assign(LIVE, await runRequest('/api/live-prices')); } catch (e) { } }
  LIVE.loading = true; show();
  try { const d = await runRequest('/api/live-prices', 'POST', { symbols: universe().map(r => r.symbol) }); Object.assign(LIVE, { at: d.at, prices: d.prices, error: '' }); }
  catch (e) { LIVE.error = e.message; }
  LIVE.loading = false; show();
  if (!LIVE.timer) LIVE.timer = setInterval(loadLivePrices, LIVE_EVERY);
}

/* ---------- command palette (Ctrl/⌘+K): pages + symbols ---------- */
/* [route, label, icon, group, section]; section 'all' = shown in both Stock market and Crypto */
const NAV = [
  ['overview', 'Overview', 'grid', 'SP500', 'stock'], ['research', 'Research', 'play', 'SP500', 'stock'],
  ['top10', 'Top 10 [filtered]', 'filter', 'SP500', 'stock'], ['summary', 'Verdict', 'spark', 'SP500', 'stock', 'child'], ['history', 'Top 10 returns', 'sched', 'SP500', 'stock', 'child'], ['filtered', 'Filtered', 'list', 'SP500', 'stock', 'child'], ['simulations', 'Simulations', 'trend', 'SP500', 'stock', 'child'], ['calendar', 'Calendar', 'sched', 'SP500', 'stock', 'child'],
  ['sectors', 'Sectors', 'layers', 'SP500', 'stock'], ['technical', 'Technical', 'trend', 'SP500', 'stock'], ['fundamental', 'Fundamentals', 'matrix', 'SP500', 'stock'], ['agents', 'AI agents', 'spark', 'SP500', 'stock'], ['intrinsic', 'Fair value', 'matrix', 'SP500', 'stock'], ['etoro', 'eToro', 'trend', 'SP500', 'stock'], ['universe', 'All stocks', 'table', 'SP500', 'stock'],
  ['ai', 'AI prompts', 'spark', 'SP500', 'stock'], ['sources', 'Sources', 'book', 'SP500', 'stock'], ['method', 'Method', 'book', 'SP500', 'stock'],
  ['portfolio', 'Portfolio', 'wallet', 'PORTFOLIO', 'stock'],
  ['crypto', 'Crypto Top 10', 'coin', 'CRYPTO', 'crypto'], ['levels', 'Levels', 'layers', 'CRYPTO', 'crypto'], ['backtest', 'Backtest', 'sched', 'CRYPTO', 'crypto'], ['cycles', 'BTC cycles', 'cycle', 'CRYPTO', 'crypto'], ['xsent', 'X & sentiment', 'xlogo', 'CRYPTO', 'crypto'],
  ['settings', 'Settings', 'cog', 'HELP', 'all']
];
/* market groups are tree nodes (Stock market → SP500 → pages) that fold; other indices can be added as siblings */
const NAV_TREE = { SP500: { label: 'SP500', sub: 'S&P 500 · USA', icon: 'trend' } };
const NAV_FOLD_KEY = 'dashivo-sp500-nav-folded';
const SECTIONS = { stock: { label: 'Stock market', home: 'overview', icon: 'trend' }, crypto: { label: 'Crypto', home: 'crypto', icon: 'coin' } };
const SECTION_KEY = 'dashivo-sp500-section';
const TITLES = {
  overview: ['Overview', 'Price, recommendations and targets · local dashboard'], sectors: ['Sectors', 'Compare all 11 sectors and explore their constituents'], research: ['Research', 'Yahoo Finance download and Excel import'],
  top10: ['Top 10 [filtered]', 'Editable thresholds and the ten best-ranked stocks'], intrinsic: ['Fair value', 'Three attributed external estimates and three transparent methods for the current Top 10'], etoro: ['eToro', 'Official eToro pages for the current Top 10'], filtered: ['Filtered', 'All Excel columns for the active selection'],
  universe: ['All stocks', 'Every queried stock, with search and sorting'], crypto: ['Crypto Top 10', 'The 10 largest cryptocurrencies by market cap'], backtest: ['Backtest', 'A sample freqtrade strategy tested on the last 90 days of each top coin'], levels: ['Levels', 'Supports and resistances where price tends to turn'], cycles: ['BTC cycles', 'Bitcoin halving cycles from the full price history'], xsent: ['X & sentiment', 'Influential posts on X, Fear & Greed and AI summaries'], sources: ['Sources', 'Platforms, free limits and which page answers which question'], agents: ['AI agents', 'Short conclusions from programs on your PC for the current Top 10'], fundamental: ['Fundamentals', 'Quality and valuation checks from attributed fundamentals for the current Top 10'], technical: ['Technical', 'Rules-based signals from daily closes for the current Top 10'], summary: ['Verdict', 'All analyses of the current Top 10 side by side'], calendar: ['Calendar', 'Green and red days for the Top 10 selection in force'], history: ['Top 10 returns', 'What the Top 10 was on each day, and how it did since'], simulations: ['Simulations', 'Top 5 and Top 10 vs the S&P 500 at 1, 2 and 3 months'], ai: ['AI prompts', 'One prompt per Top 10 stock, opened in your AI assistant'], settings: ['Settings', 'AI prompt and assistant'], portfolio: ['Portfolio', 'Demo account · simulated investments, no real money'], method: ['Method', 'How the numbers are calculated']
};
function openPalette() {
  const p = $('#pal'); p.innerHTML = ''; p.classList.add('on'); $('#back').classList.add('on');
  const inp = h('input', { placeholder: 'Jump to a page or search a symbol…', autocomplete: 'off' }), res = h('div', { class: 'res' });
  let sel = 0, list = [];
  const draw = () => {
    const q = inp.value.toLowerCase().trim(); list = [];
    NAV.filter(n => !q || n[1].toLowerCase().includes(q) || tr(n[1]).toLowerCase().includes(q)).forEach(n => list.push({ g: 'PAGES', l: n[1], s: n[3], ic: n[2], go: () => App.go(n[0]) }));
    if (!q || 'run research'.includes(q) || tr('Run research').toLowerCase().includes(q)) list.unshift({ g: 'ACTIONS', l: 'Run research', s: '', ic: 'play', go: startRun });
    if (q) universe().filter(r => (r.symbol + ' ' + r.company).toLowerCase().includes(q)).slice(0, 8).forEach(r => list.push({ g: 'STOCKS', l: r.symbol + ' · ' + r.company, s: usd(r.price), ic: 'trend', data: true, go: () => { UI.uq = r.symbol; UI.usector = ''; App.go('universe'); } }));
    sel = clamp(sel, 0, Math.max(0, list.length - 1)); res.innerHTML = ''; let g = '';
    list.forEach((it, k) => { if (it.g !== g) { g = it.g; res.append(h('div', { class: 'gh' }, g)); } res.append(h('div', { class: 'it' + (k === sel ? ' on' : '') + (it.data ? ' notr' : ''), onclick: () => run(it), onmousemove: () => { if (sel !== k) { sel = k; $$('.it', res).forEach((e, j) => e.classList.toggle('on', j === k)); } } }, icon(it.ic), it.l, h('small', null, it.s))); });
    if (!list.length) res.append(h('div', { class: 'empty' }, 'No results'));
  };
  const run = it => { closePalette(); it.go(); };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && list[sel]) run(list[sel]);
  });
  p.append(inp, res); draw(); setTimeout(() => inp.focus(), 30);
}
function closePalette() { $('#pal').classList.remove('on'); $('#back').classList.remove('on'); }

/* ---------- router + shell ---------- */
const App = {
  cur: null, home: 'overview', section: (() => { try { return localStorage.getItem(SECTION_KEY) === 'crypto' ? 'crypto' : 'stock'; } catch (e) { return 'stock'; } })(),
  setSection(sec) { this.section = sec; document.body.dataset.sec = sec; try { localStorage.setItem(SECTION_KEY, sec); } catch (e) { } $$('.sec-switch button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec)); },
  route() { if (this.cur && Views[this.cur]) return this.cur; const home = SECTIONS[this.section].home, r = (location.hash.replace(/^#\/?/, '') || home).split('?')[0]; return Views[r] ? r : home; },
  go(r) { if (!Views[r]) return; this.cur = r; try { history.replaceState(null, '', '#/' + r); } catch (e) { } $('#side').classList.remove('on'); this.render(); },
  render() {
    const r = this.route(), view = $('#view'), y = scrollY;
    let node; try { node = Views[r](); } catch (err) { console.error(err); node = h('div', { class: 'card empty' }, 'Something went wrong rendering this page: ' + err.message); }
    view.replaceChildren(node); const tip = $('#tip'); if (tip) tip.style.opacity = 0;   // a tooltip must not outlive its page
    scrollTo(0, this._lastRoute === r ? y : 0); this._lastRoute = r;
    const t = TITLES[r]; $('.ttl h1').textContent = t[0]; $('.ttl p').textContent = t[1]; document.title = tr(t[0]) + ' · Dashivo SP500 Research';
    const sec = (NAV.find(n => n[0] === r) || [])[4];
    if (sec && sec !== 'all' && sec !== this.section) this.setSection(sec);
    $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r));
    $('.nav a.on')?.closest('.nav-grp.folded')?.classList.remove('folded');   // never hide the page you are on
    if (r === 'top10') refreshTop();
    if (r === 'research') { runPaint(); importPaint(); }
    this.updateNav();
  },
  updateNav() {
    const sel = selection();
    const counts = { filtered: sel ? sel.length : null, universe: universe().length, research: RUN.running ? Math.round(RUN.progress) + '%' : null, portfolio: PORT.data?.positions?.length || null };
    $$('.nav .cnt').forEach(c => { const v = counts[c.dataset.r]; c.textContent = v ?? ''; c.style.display = v == null || v === '' ? 'none' : ''; c.classList.toggle('hot', c.dataset.r === 'research'); });
  },
  boot() {
    I18N.init(); Theme.init(); initSide(); this.setSection(this.section);
    const groups = []; NAV.forEach(n => { let g = groups.find(x => x[0] === n[3]); if (!g) groups.push(g = [n[3], []]); g[1].push(n); });
    const sectionSwitch = h('div', { class: 'sec-switch', role: 'tablist', 'aria-label': 'Sections' }, Object.entries(SECTIONS).map(([k, sct]) =>
      h('button', { type: 'button', 'data-sec': k, role: 'tab', onclick: () => { this.setSection(k); App.go(sct.home); }, html: svgIcon(sct.icon) + '<span>' + sct.label + '</span>' })));
    $('#side').append(h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, brandImg()), h('div', { class: 'brand-app' }, 'SP500 RESEARCH')), sectionSwitch,
      h('nav', { class: 'nav', 'aria-label': 'Dashboard navigation' }, groups.map(([g, ns]) => {
        const sec = ns.every(n => n[4] === ns[0][4]) ? ns[0][4] : 'all', tree = NAV_TREE[g];
        const links = ns.map(n => h('a', { href: '#/' + n[0], class: n[5] || null, 'data-r': n[0], 'data-sec': n[4], onclick: e => { e.preventDefault(); App.go(n[0]); }, html: svgIcon(n[2]) + '<span>' + n[1] + '</span>' }, h('span', { class: 'cnt notr', 'data-r': n[0] })));
        if (!tree) return h('div', { class: 'nav-grp', 'data-sec': sec }, h('div', { class: 'nav-g' }, g), links);
        let folded = false; try { folded = (JSON.parse(localStorage.getItem(NAV_FOLD_KEY)) || []).includes(g); } catch (e) { }
        const grp = h('div', { class: 'nav-grp tree' + (folded ? ' folded' : ''), 'data-sec': sec });
        const head = h('button', { type: 'button', class: 'nav-node', 'aria-expanded': String(!folded), onclick: () => {
          const f = grp.classList.toggle('folded'); head.setAttribute('aria-expanded', String(!f));
          try { const list = new Set(JSON.parse(localStorage.getItem(NAV_FOLD_KEY)) || []); f ? list.add(g) : list.delete(g); localStorage.setItem(NAV_FOLD_KEY, JSON.stringify([...list])); } catch (e) { }
        }, html: svgIcon(tree.icon) + '<span class="nn"><b>' + tree.label + '</b><small>' + tree.sub + '</small></span>' + svgIcon('down') });
        add(grp, [head, h('div', { class: 'nav-kids' }, links)]);
        return grp;
      })),
      h('div', { class: 'side-foot' }, 'DASHIVO', h('br'), 'DRIVE PROGRESS · v1.0'));
    const langPop = h('div', { class: 'pop', id: 'langPop', style: { width: '280px' } }), themePop = h('div', { class: 'pop', id: 'themePop', style: { width: '320px' } });
    add($('#top'), [h('button', { class: 'ico-btn burger', title: 'Show / hide menu', onclick: toggleSide, html: svgIcon('menu') }), h('div', { class: 'ttl' }, h('h1'), h('p')),
      h('div', { class: 'search', onclick: openPalette }, icon('search', 16), 'Search or jump to…', h('kbd', null, '⌘K')),
      h('div', { style: { position: 'relative' } }, h('button', { class: 'ico-btn theme-btn', id: 'themeBtn', title: 'Design', onclick: e => { e.stopPropagation(); langPop.classList.remove('on'); themeMenu(themePop); }, html: svgIcon('palette') }), themePop),
      h('div', { style: { position: 'relative' } }, h('button', { class: 'ico-btn lang-btn', id: 'langBtn', title: 'Language', onclick: e => { e.stopPropagation(); themePop.classList.remove('on'); langMenu(langPop); } }), langPop),
      window.dashboardLan ? h('button', { class: 'ico-btn', id: 'phoneBtn', title: 'Phone access', onclick: () => App.go('settings'), html: svgIcon('phone') }) : null,
      h('button', { class: 'ico-btn', id: 'tourBtn', title: 'Take the interactive tour', onclick: () => Tour.start(), html: svgIcon('help') }),
      h('button', { class: 'btn pri hide-s', id: 'topRun', onclick: startRun }, icon('play'), h('span', null, 'Run research'))]);
    addEventListener('hashchange', () => { this.cur = null; this.render(); });
    addEventListener('click', e => { if (!e.target.closest('#langPop') && !e.target.closest('#langBtn')) langPop.classList.remove('on'); if (!e.target.closest('#themePop') && !e.target.closest('#themeBtn')) themePop.classList.remove('on'); if (!e.target.closest('#side') && !e.target.closest('.burger')) $('#side').classList.remove('on'); });
    $('#back').addEventListener('click', () => { closePalette(); closeInvest(); });
    addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      else if (e.key === 'Escape') { closePalette(); closeInvest(); langPop.classList.remove('on'); themePop.classList.remove('on'); }
    });
    langBtnUpdate(); this.render(); I18N.apply(); I18N.observe(); Tour.maybeStart(); startPriceTimer(); loadLivePrices();
    if (window.dashboardRunToken) runRequest('/api/status').then(s => { runState(s); if (s.running) followProgram(); runPaint(); }).catch(e => { RUN.error = e.message; runPaint(); });
  }
};
