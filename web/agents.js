'use strict';
/* ================= TradingAgents (local AI agents) conclusions for the current Top 10 ================= */
const AGENTS = { data: null, loading: false, error: '', timer: null, pending: false };
const AGENT_RATING = { Buy: 'good', Overweight: 'good', Hold: 'mid', Underweight: 'bad', Sell: 'bad' };
const agentSymbols = () => { const sel = selection(); return sel ? ranked(sel).slice(0, 10).map(r => r.symbol) : []; };
const agentReportDay = () => { const m = /^(\d{2}) (\d{2}) (\d{4})/.exec(DATA.sourceDate || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; };
async function agentsLoad() {
  if (AGENTS.loading) return;
  AGENTS.loading = true;
  try { AGENTS.data = await runRequest('/api/agents?symbols=' + encodeURIComponent(agentSymbols().join(','))); AGENTS.error = ''; }
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
  if (!confirm(tr('Run the AI agents for') + ' ' + symbols.join(', ') + '? ' + tr('This uses your own TradingAgents install and AI account, takes several minutes per stock, and runs one stock at a time.'))) return;
  try { await runRequest('/api/agents/run', 'POST', { symbols }); toast('AI agent run started'); }
  catch (e) { toast(e.message); }
  AGENTS.loading = false; agentsLoad();
}
Views.agents = () => {
  if (!AGENTS.data && !AGENTS.loading && !AGENTS.error) agentsLoad();
  const heading = card('AI agents · current Top 10', 'Short conclusions from your local TradingAgents install (analyst, researcher, trader and risk agents). Each row is the final rating and executive summary of the latest saved run for that stock; the full report opens locally. Model output, not investment advice.', null, null, 'c12');
  if (window.dashboardStatic) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('AI agent analysis runs only on the computer with your TradingAgents install and AI account; open the local dashboard to run it and read the results.'))));
  if (AGENTS.error && !AGENTS.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, AGENTS.error)));
  if (!AGENTS.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const d = AGENTS.data, symbols = agentSymbols(), day = agentReportDay(), run = d.run || {};
  if (!d.available) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('TradingAgents was not found. Install it, or set TRADINGAGENTS_DIR to its folder before starting the dashboard.'))));
  if (!symbols.length) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('No ranked stocks in the active selection.'))));
  const need = symbols.filter(s => agentNeedsRun(s, d.results || {}, day));
  const status = run.running ? h('div', { class: 'banner' }, icon('sched', 18), h('b', null, tr('Running')), h('span', { class: 'notr' }, run.current || ''),
    h('span', { class: 'muted' }, tr('Waiting') + ': ' + (run.queue || []).length + ' · ' + tr('Done') + ': ' + (run.done || []).length)) : null;
  const errors = Object.entries(run.errors || {}).map(([s, m]) => h('div', { class: 'banner' }, icon('alert', 18), h('b', { class: 'notr' }, s), h('span', null, tr(m))));
  const runBtn = btn(need.length ? tr('Run for missing or outdated') + ' (' + need.length + ')' : tr('All conclusions are up to date'), 'play', () => agentsRun(need), 'sm');
  if (run.running || !need.length) runBtn.disabled = true;
  const actions = h('div', { class: 'row' }, runBtn,
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Checked') + ' ' + new Date(d.checkedAt).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' })));
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl agents-tbl' },
    h('thead', null, h('tr', null, ['Stock', 'Rating', 'Analysis date', 'Conclusion', 'Report'].map(x => h('th', null, tr(x))))),
    h('tbody', null, symbols.map(sym => { const r = (d.results || {})[sym], stock = universe().find(x => x.symbol === sym) || { symbol: sym, company: '' }, old = r && day && r.date < day;
      return h('tr', null,
        h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, stock.company)))),
        h('td', null, r ? h('span', { class: 'tech-verdict agent-' + (AGENT_RATING[r.rating] || 'mid') }, r.rating ? tr(r.rating) : r.ratingText) : h('span', { class: 'muted' }, run.current === sym ? tr('Running') : tr('No run yet'))),
        h('td', { class: 'notr' }, r ? [r.date, old ? h('div', { class: 'muted small' }, tr('older than the current report')) : null] : '—'),
        h('td', { class: 'tech-sum agents-sum notr' }, r?.summary || '—'),
        h('td', null, r?.html ? h('a', { class: 'etoro-open', href: '/agents-report/' + encodeURIComponent(r.report), target: '_blank', rel: 'noopener noreferrer' }, tr('Open full report') + ' ↗') : '—')); }))));
  return h('div', null, heading, status, ...errors, card(null, null, h('div', null, actions, table), null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Source:'), ' ', ivLink('TradingAgents', 'https://github.com/TauricResearch/TradingAgents'), ' · ', tr('Runs use the provider and models you saved in its CLI; no key is read or published. Results stay on this computer. Research output from AI models can be wrong; it is not investment advice.')));
};
