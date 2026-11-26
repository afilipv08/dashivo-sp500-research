'use strict';
/* ================= Programs installed on the owner's PC, queried for the current Top 10 ================= */
const AGENT_PROGRAMS = [['tradingagents', 'TradingAgents', 'https://github.com/TauricResearch/TradingAgents'], ['vibe', 'Vibe-Trading', 'https://github.com/HKUDS/Vibe-Trading']];
const AGENTS = { program: 'tradingagents', data: null, loading: false, error: '', timer: null };
const AGENT_RATING = { Buy: 'good', Overweight: 'good', Hold: 'mid', Underweight: 'bad', Sell: 'bad', Bullish: 'good', Neutral: 'mid', Bearish: 'bad' };
const agentSymbols = () => { const sel = selection(); return sel ? ranked(sel).slice(0, 10).map(r => r.symbol) : []; };
const agentReportDay = () => { const m = /^(\d{2}) (\d{2}) (\d{4})/.exec(DATA.sourceDate || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; };
async function agentsLoad() {
  if (AGENTS.loading) return;
  AGENTS.loading = true;
  const program = AGENTS.program;
  try { const data = await runRequest('/api/agents?program=' + program + '&symbols=' + encodeURIComponent(agentSymbols().join(','))); if (program === AGENTS.program) { AGENTS.data = data; AGENTS.error = ''; } }
  catch (e) { AGENTS.error = e.message || 'AI agent results are unavailable.'; }
  AGENTS.loading = false;
  clearTimeout(AGENTS.timer);
  if (AGENTS.data?.run?.running) AGENTS.timer = setTimeout(() => { if (App.route() === 'agents') agentsLoad(); }, 15000);
  if (App.route() === 'agents') App.render();
}
/* a stock needs a run when it has no saved conclusion or the saved one predates the report behind the current Top 10 */
const agentNeedsRun = (symbol, results, day) => !results[symbol] || (day && results[symbol].date < day);
async function agentsRun(symbols) {
  if (!symbols.length) return;
  if (!confirm(tr('Run the AI agents for') + ' ' + symbols.join(', ') + '? ' + tr('This uses your own program and AI account, takes several minutes per stock, and runs one stock at a time.'))) return;
  try { await runRequest('/api/agents/run', 'POST', { symbols, program: AGENTS.program }); toast('AI agent run started'); }
  catch (e) { toast(e.message); }
  AGENTS.loading = false; agentsLoad();
}
function agentTabs() {
  return h('div', { class: 'seg' }, AGENT_PROGRAMS.map(([key, label]) => h('button', { class: AGENTS.program === key ? 'on' : '', onclick: () => { AGENTS.program = key; AGENTS.data = null; AGENTS.error = ''; clearTimeout(AGENTS.timer); App.render(); } }, label)));
}
function agentRow(sym, r, run, day, program) {
  const stock = universe().find(x => x.symbol === sym) || { symbol: sym, company: '' }, old = r && day && r.date < day;
  const detail = r?.text ? h('details', { class: 'agent-full' }, h('summary', null, tr('Full answer')), h('pre', { class: 'notr' }, r.text)) : null;
  return h('tr', null,
    h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, stock.company)))),
    h('td', null, r ? h('span', { class: 'tech-verdict agent-' + (AGENT_RATING[r.rating] || 'mid') }, r.rating ? tr(r.rating) : r.ratingText || '—') : h('span', { class: 'muted' }, run.current === sym ? tr('Running') : tr('No run yet'))),
    h('td', { class: 'notr' }, r ? [r.date, old ? h('div', { class: 'muted small' }, tr('older than the current report')) : null] : '—'),
    h('td', { class: 'tech-sum agents-sum notr' }, r?.summary || '—', detail),
    h('td', null, r?.html && program === 'tradingagents' && !window.dashboardStatic ? h('a', { class: 'etoro-open', href: '/agents-report/' + encodeURIComponent(r.report), target: '_blank', rel: 'noopener noreferrer' }, tr('Open full report') + ' ↗') : '—'));
}
Views.agents = () => {
  if (!AGENTS.data && !AGENTS.loading && !AGENTS.error) agentsLoad();
  const [, label, link] = AGENT_PROGRAMS.find(p => p[0] === AGENTS.program);
  const heading = card('AI agents', 'Short conclusions from programs installed on your PC (TradingAgents, Vibe-Trading) for the stocks of the current Top 10. Each run is saved in this platform; the table shows the latest saved answer per stock. Model output, not investment advice.', agentTabs(), null, 'c12');
  if (AGENTS.error && !AGENTS.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, AGENTS.error)));
  if (!AGENTS.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const d = AGENTS.data, symbols = agentSymbols(), day = agentReportDay(), run = d.run || {}, results = d.results || {};
  const online = window.dashboardStatic;
  if (!symbols.length) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('No ranked stocks in the active selection.'))));
  if (!online && !d.available) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('The program was not found. Install it, or point the dashboard to its folder (TRADINGAGENTS_DIR or VIBE_TRADING_BIN) before starting it.'))));
  const need = symbols.filter(s => agentNeedsRun(s, results, day));
  const mine = run.program === AGENTS.program;
  const status = run.running ? h('div', { class: 'banner' }, icon('sched', 18), h('b', null, tr('Running')), h('span', null, (AGENT_PROGRAMS.find(p => p[0] === run.program) || [])[1] || ''), h('span', { class: 'notr' }, run.current || ''),
    h('span', { class: 'muted' }, tr('Waiting') + ': ' + (run.queue || []).length + ' · ' + tr('Done') + ': ' + (run.done || []).length)) : null;
  const errors = mine ? Object.entries(run.errors || {}).map(([s, m]) => h('div', { class: 'banner' }, icon('alert', 18), h('b', { class: 'notr' }, s), h('span', null, tr(m)))) : [];
  const runBtn = btn(need.length ? tr('Run for missing or outdated') + ' (' + need.length + ')' : tr('All conclusions are up to date'), 'play', () => agentsRun(need), 'sm');
  if (run.running || !need.length) runBtn.disabled = true;
  const actions = online ? h('p', { class: 'muted small' }, tr('Runs start only from the dashboard on your PC; this online copy shows the answers saved so far.'))
    : h('div', { class: 'row' }, runBtn, btn(tr('Run for all ten'), 'play', () => agentsRun(symbols), 'sm ghost'), h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Checked') + ' ' + new Date(d.checkedAt).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' })));
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl agents-tbl' },
    h('thead', null, h('tr', null, ['Stock', 'Rating', 'Analysis date', 'Conclusion', 'Report'].map(x => h('th', null, tr(x))))),
    h('tbody', null, symbols.map(sym => agentRow(sym, results[sym], run, day, AGENTS.program)))));
  return h('div', null, heading, status, ...errors, card(null, null, h('div', null, actions, table), null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Source:'), ' ', ivLink(label, link), ' · ', tr('Runs use the provider and models you set up in the program; no key is read or published. Research output from AI models can be wrong; it is not investment advice.')));
};
