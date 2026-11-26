'use strict';
/* ================= Verdict: every analysis of the current Top 10 side by side ================= */
const SUM = { agents: {}, loading: false, error: '' };
const SUM_PROGRAMS = ['tradingagents', 'vibe'];
async function sumLoadAgents() {
  if (SUM.loading) return;
  SUM.loading = true;
  const symbols = agentSymbols().join(',');
  try { for (const program of SUM_PROGRAMS) SUM.agents[program] = (await runRequest('/api/agents?program=' + program + '&symbols=' + encodeURIComponent(symbols))).results || {}; SUM.error = ''; }
  catch (e) { SUM.error = e.message; SUM.agents = SUM.agents || {}; }
  SUM.loading = false; SUM.loaded = true;
  if (App.route() === 'summary') App.render();
}
const SUM_VALUE_STEP = 0.15;   // a median estimate 15% above / below the price counts as cheap / expensive
const sumChip = (vote, text, title) => h('span', { class: 'tech-verdict agent-' + (vote > 0 ? 'good' : vote < 0 ? 'bad' : 'mid'), title: title || '' }, text);
const sumCell = signal => h('td', null, signal ? sumChip(signal.vote, signal.text, signal.title) : h('span', { class: 'muted' }, '—'));
function sumSignals(stock) {
  const out = {};
  const t = SIM_VIEW.market ? techAnalyse(techSeries(SIM_VIEW.market, stock.symbol)) : null;
  if (t && t.verdict !== 'unknown') out.tech = { vote: t.verdict === 'bullish' ? 1 : t.verdict === 'bearish' ? -1 : 0, text: tr(TECH_LABELS[t.verdict]), title: tr(techConclusion(t)) };
  const sources = INTRINSIC.data?.sources || {};
  const f = INTRINSIC.loaded ? fundAnalyse(stock, ivLookup(sources.zyberno?.rows, stock.symbol), ivLookup(sources.equityRank?.rows, stock.symbol)) : null;
  if (f && f.verdict !== 'unknown') out.fund = { vote: f.verdict === 'strong' ? 1 : f.verdict === 'weak' ? -1 : 0, text: tr(FUND_LABELS[f.verdict]), title: tr(fundConclusion(f)) };
  const est = INTRINSIC.loaded ? ivEstimates(stock, sources) : null;
  if (est && est.n >= 2) out.value = { vote: est.upside >= SUM_VALUE_STEP ? 1 : est.upside <= -SUM_VALUE_STEP ? -1 : 0, text: signedPct(est.upside), title: tr('Median of') + ' ' + est.n + ' ' + tr('estimates') + ': ' + usd1(est.median) };
  const ta = SUM.agents.tradingagents?.[stock.symbol];
  if (ta?.rating) out.ta = { vote: AGENT_RATING[ta.rating] === 'good' ? 1 : AGENT_RATING[ta.rating] === 'bad' ? -1 : 0, text: tr(ta.rating), title: ta.date + ' · ' + (ta.summary || '') };
  const vt = SUM.agents.vibe?.[stock.symbol];
  if (vt?.rating) out.vibe = { vote: AGENT_RATING[vt.rating] === 'good' ? 1 : AGENT_RATING[vt.rating] === 'bad' ? -1 : 0, text: tr(vt.rating), title: vt.date + ' · ' + (vt.summary || '') };
  return out;
}
const SUM_COLUMNS = [['tech', 'Technical'], ['fund', 'Fundamentals'], ['value', 'Fair value'], ['ta', 'TradingAgents'], ['vibe', 'Vibe-Trading']];
function sumOverall(signals) {
  const votes = Object.values(signals).map(s => s.vote), up = votes.filter(v => v > 0).length, down = votes.filter(v => v < 0).length, net = up - down;
  const label = votes.length < 2 ? 'Not enough signals' : net >= 2 ? 'Leaning positive' : net <= -2 ? 'Leaning negative' : 'Mixed';
  return { up, down, n: votes.length, label, vote: label === 'Leaning positive' ? 1 : label === 'Leaning negative' ? -1 : 0 };
}
Views.summary = () => {
  loadSimulations(); if (!INTRINSIC.loaded) ivLoad(); if (!SUM.loaded) sumLoadAgents();
  const heading = card('Verdict', 'The analyses of the current Top 10 side by side: technical, fundamentals, fair value and the answers of the programs on your PC. Each column votes positive, neutral or negative; the last column counts the votes. Hover a chip for the reason.', null, null, 'c12');
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  if (!selected) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))));
  if (!top.length) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('No ranked stocks in the active selection.'))));
  if (!SIM_VIEW.market || !INTRINSIC.loaded || !SUM.loaded) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const rows = top.map(stock => ({ stock, signals: sumSignals(stock) })).map(r => ({ ...r, overall: sumOverall(r.signals) }));
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl sum-tbl' },
    h('thead', null, h('tr', null, [tr('Stock'), ...SUM_COLUMNS.map(([, label]) => tr(label)), tr('Overall')].map(x => h('th', null, x)))),
    h('tbody', null, rows.map(({ stock, signals, overall }) => h('tr', null,
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(stock.symbol, 22), h('div', null, h('b', { class: 'notr' }, stock.symbol), h('div', { class: 'muted small notr' }, stock.company)))),
      ...SUM_COLUMNS.map(([key]) => sumCell(signals[key])),
      h('td', null, sumChip(overall.vote, tr(overall.label)), h('small', { class: 'muted notr sum-count' }, '▲ ' + overall.up + ' · ▼ ' + overall.down + ' / ' + overall.n)))))));
  return h('div', null, heading, card(null, null, table, null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Votes: technical bullish / bearish; fundamentals strong / weak; fair value median 15% or more above / below the price (needs two estimates); program ratings Buy, Overweight, Bullish / Underweight, Sell, Bearish. Equal weights; the signals are not independent (the programs read the same market data) and thresholds are baseline choices. Not investment advice.')));
};
