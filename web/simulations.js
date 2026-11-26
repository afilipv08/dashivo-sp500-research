'use strict';
/* ================= Forward performance of saved Top 5 / Top 10 cohorts vs the S&P 500 ================= */
const SIM_VIEW = { history: null, market: null, loading: false, error: '', preset: 'top5', horizon: 1, open: null };
const SIM_OPTIONS = [['top5', 'Top 5 Investitii'], ['default', 'Default Top 10'], ['excel', 'Excel Top 10']];
const SIM_PERIODS = [1, 2, 3];
function simAddMonths(day, count) {
  const [y, m, d] = day.split('-').map(Number), month = m - 1 + count;
  const first = new Date(Date.UTC(y, month, 1)), last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
function simClose(history, symbol, day, direction) {
  const values = history.series?.[symbol]; if (!Array.isArray(values)) return null;
  if (direction === 'before') {
    for (let i = history.dates.length - 1; i >= 0; i--) if (history.dates[i] <= day && num(values[i]) && values[i] > 0) return { date: history.dates[i], price: values[i] };
  } else {
    for (let i = 0; i < history.dates.length; i++) if (history.dates[i] >= day && num(values[i]) && values[i] > 0) return { date: history.dates[i], price: values[i], index: i };
  }
  return null;
}
function simEntry(day, preset) {
  const record = day.presets?.[preset]; if (!record) return null;
  if (record.simulation) return record.simulation;
  const selected = (record.items || []).slice(0, preset === 'top5' ? 5 : 10), amount = selected.length ? 10_000 / selected.length : 0;
  const positions = selected.filter(r => num(r.price) && r.price > 0).map(r => ({ symbol: r.symbol, entryPrice: r.price, allocation: amount, shares: amount / r.price }));
  return { capital: 10_000, invested: amount * positions.length, cash: 10_000 - amount * positions.length, positions };
}
function simOutcome(day, preset, months) {
  const simulation = simEntry(day, preset), target = simAddMonths(day.date, months), market = SIM_VIEW.market;
  if (!simulation || !simulation.positions.length) return { status: 'empty', target };
  const dates = market?.dates || [], latest = dates.length ? simClose(market, '^GSPC', dates.at(-1), 'before')?.date : null;
  if (!market || !latest) return { status: 'missing', target };
  const startIndex = simClose(market, '^GSPC', day.date, 'before');
  if (!startIndex) return { status: 'missing', target };
  if (target > latest) return { status: 'pending', target };
  let end = null, missing = [];
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] < target || !num(market.series?.['^GSPC']?.[i]) || market.series['^GSPC'][i] <= 0) continue;
    const unavailable = simulation.positions.filter(p => !num(market.series?.[p.symbol]?.[i]) || market.series[p.symbol][i] <= 0).map(p => p.symbol);
    if (!unavailable.length) { end = { date: dates[i], index: i, benchmark: market.series['^GSPC'][i] }; break; }
    missing = unavailable;
  }
  if (!end) return { status: latest < target ? 'pending' : 'missing', target, missing };
  const value = simulation.cash + simulation.positions.reduce((sum, p) => sum + p.shares * market.series[p.symbol][end.index], 0);
  const portfolio = value / simulation.capital - 1, benchmark = end.benchmark / startIndex.price - 1;
  return { status: 'done', target, exitDate: end.date, value, portfolio, benchmark, excess: portfolio - benchmark, startIndex: startIndex.price, endIndex: end.benchmark };
}
async function loadSimulations() {
  if (SIM_VIEW.loading || (SIM_VIEW.history && SIM_VIEW.market)) return;
  SIM_VIEW.loading = true; SIM_VIEW.error = '';
  try {
    const [h, m] = await Promise.all([runRequest('/api/top10-history'), runRequest('/api/market-history')]);
    SIM_VIEW.history = h; SIM_VIEW.market = m;
    if (!m.series?.['^GSPC']?.some(v => num(v) && v > 0)) throw Error('S&P 500 daily closes are not available yet.');
  } catch (e) { SIM_VIEW.error = e.message || 'Simulation history is unavailable.'; }
  SIM_VIEW.loading = false;
  if (App.route() === 'simulations') App.render();
}
const simDayLabel = day => new Date(day + 'T12:00:00').toLocaleDateString(I18N.locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const simCash = v => num(v) ? '$' + nf(v, 0) : '—';
function simValueCell(o) {
  if (o.status === 'pending') return h('div', { class: 'sim-pending' }, h('b', null, tr('Pending')), h('small', { class: 'notr' }, tr('Due') + ' ' + o.target));
  if (o.status === 'missing') return h('div', { class: 'sim-pending' }, h('b', null, tr('Missing data')), o.missing?.length ? h('small', { class: 'notr' }, o.missing.join(', ')) : null);
  if (o.status === 'empty') return h('div', { class: 'sim-pending' }, h('b', null, tr('No eligible stocks')));
  return h('div', { class: 'sim-result' },
    h('b', { class: 'notr ' + plClass(o.portfolio) }, signedPct(o.portfolio)),
    h('small', { class: 'notr' }, tr('S&P 500') + ' ' + signedPct(o.benchmark)),
    h('small', { class: 'notr ' + plClass(o.excess) }, tr('Excess') + ' ' + signedPct(o.excess)),
    h('small', { class: 'muted notr' }, tr('Close') + ' ' + o.exitDate));
}
/* where a cohort stands today: every pick against the latest available close, plus the S&P 500 since selection */
function simToDate(day, simulation) {
  const market = SIM_VIEW.market, dates = market?.dates || [];
  const last = symbol => { const v = market?.series?.[symbol]; if (!v) return null; for (let i = dates.length - 1; i >= 0; i--) if (num(v[i]) && v[i] > 0) return { price: v[i], date: dates[i] }; return null; };
  const rows = (simulation?.positions || []).map(p => { const q = last(p.symbol); return { ...p, close: q?.price ?? null, closeDate: q?.date ?? null, change: q && p.entryPrice > 0 ? q.price / p.entryPrice - 1 : null, value: q ? p.shares * q.price : null }; });
  const known = rows.filter(r => num(r.value)), invested = rows.reduce((a, r) => a + r.allocation, 0);
  const start = simClose(market, '^GSPC', day.date, 'before'), now = last('^GSPC');
  return { rows, portfolio: known.length === rows.length && rows.length ? known.reduce((a, r) => a + r.value, 0) / invested - 1 : null,
    benchmark: start && now ? now.price / start.price - 1 : null, asOf: now?.date || null };
}
function simDetail(r) {
  const t = simToDate(r.day, r.sim);
  return h('tr', { class: 'sim-detail' }, h('td', { colspan: 4 + SIM_PERIODS.length },
    h('div', { class: 'sim-detail-head' }, h('b', null, tr('Since selection') + (t.asOf ? ' · ' + tr('close') + ' ' + t.asOf : '')),
      h('span', { class: 'notr ' + plClass(t.portfolio) }, tr('Portfolio') + ' ' + signedPct(t.portfolio)), h('span', { class: 'notr ' + plClass(t.benchmark) }, 'S&P 500 ' + signedPct(t.benchmark))),
    h('table', { class: 'pf-tbl' }, h('thead', null, h('tr', null, [tr('Symbol'), tr('Entry price'), tr('Latest close'), tr('Since selection'), tr('Allocation')].map(x => h('th', null, x)))),
      h('tbody', null, t.rows.map(p => h('tr', null, h('td', null, h('div', { class: 'sym-cell' }, logoEl(p.symbol, 20), h('b', { class: 'notr' }, p.symbol))), h('td', { class: 'notr' }, usd(p.entryPrice)),
        h('td', { class: 'notr' }, num(p.close) ? usd(p.close) + ' · ' + p.closeDate : '—'), h('td', { class: 'notr' }, h('span', { class: 'plpill ' + plClass(p.change) }, signedPct(p.change))), h('td', { class: 'notr' }, simCash(p.allocation))))))));
}
Views.simulations = () => {
  loadSimulations();
  const heading = card(tr('Simulations'), tr('Each research day is a separate equal-weighted cohort. Top 5 Investitii uses the first five picks; other presets use their Top 10. Starting capital is $10,000. Compares price changes with the S&P 500 index; dividends, fees and taxes are excluded.'),
    h('div', { class: 'seg sim-seg' }, SIM_OPTIONS.map(([key, label]) => h('button', { class: SIM_VIEW.preset === key ? 'on' : '', onclick: () => { SIM_VIEW.preset = key; App.render(); } }, tr(label)))));
  if (SIM_VIEW.error) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, SIM_VIEW.error)));
  if (!SIM_VIEW.history || !SIM_VIEW.market) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading the history…'))));
  const days = SIM_VIEW.history.days || [], rows = days.map(day => ({ day, outcomes: SIM_PERIODS.map(m => simOutcome(day, SIM_VIEW.preset, m)), sim: simEntry(day, SIM_VIEW.preset) }));
  const summaries = SIM_PERIODS.map((months, i) => {
    const done = rows.map(r => r.outcomes[i]).filter(o => o.status === 'done'), avgP = avgNumber(done.map(o => o.portfolio)), avgB = avgNumber(done.map(o => o.benchmark)), avgE = avgNumber(done.map(o => o.excess));
    return card(months + ' ' + tr(months === 1 ? 'month' : 'months'), done.length + ' / ' + rows.length + ' ' + tr('cohorts completed'),
      h('div', { class: 'sim-summary' },
        h('div', null, h('small', null, tr('Portfolio average')), h('b', { class: 'notr ' + plClass(avgP) }, signedPct(avgP))),
        h('div', null, h('small', null, tr('S&P 500 average')), h('b', { class: 'notr ' + plClass(avgB) }, signedPct(avgB))),
        h('div', null, h('small', null, tr('Excess return')), h('b', { class: 'notr ' + plClass(avgE) }, signedPct(avgE)))), null, 'sim-kpi');
  });
  const chosen = rows.map(r => ({ ...r, o: r.outcomes[SIM_VIEW.horizon - 1] })).filter(r => r.o.status === 'done');
  const chart = card(tr('Portfolio') + ' / ' + tr('S&P 500') + ' · ' + SIM_VIEW.horizon + ' ' + tr(SIM_VIEW.horizon === 1 ? 'month' : 'months'), 'P = portfolio; S&P = benchmark. Hover for exact returns.', chosen.length ? barList(chosen.flatMap(r => [
    { label: new Date(r.day.date + 'T12:00:00').toLocaleDateString(I18N.locale, { day: '2-digit', month: 'short' }) + ' P', value: r.o.portfolio * 100, color: r.o.portfolio < 0 ? 'var(--bad)' : 'var(--good)', tip: tipHtml(simDayLabel(r.day.date) + ' · ' + tr('Portfolio'), [tipRow('Portfolio return', signedPct(r.o.portfolio)), tipRow('Ending value', simCash(r.o.value)), tipRow('Market close', r.o.exitDate)]) },
    { label: new Date(r.day.date + 'T12:00:00').toLocaleDateString(I18N.locale, { day: '2-digit', month: 'short' }) + ' S&P', value: r.o.benchmark * 100, color: r.o.benchmark < 0 ? 'var(--bad)' : 'var(--info)', tip: tipHtml(simDayLabel(r.day.date) + ' · S&P 500', [tipRow('S&P 500 return', signedPct(r.o.benchmark)), tipRow('Market close', r.o.exitDate)]) }
  ]), { fmt: v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 1) + '%' }) : h('div', { class: 'empty' }, tr('No completed cohorts yet; the first 1-month review is due one calendar month after each selection.')), null, 'c12');
  const periodButtons = h('div', { class: 'seg sim-periods' }, SIM_PERIODS.map(m => h('button', { class: SIM_VIEW.horizon === m ? 'on' : '', onclick: () => { SIM_VIEW.horizon = m; App.render(); } }, m + ' ' + tr(m === 1 ? 'month' : 'months'))));
  const table = h('div', { class: 'tbl-wrap sim-table' }, h('table', { class: 'sp-tbl' },
    h('thead', null, h('tr', null, [tr('Selection date'), tr('Report'), tr('Stocks'), tr('Capital'), ...SIM_PERIODS.map(m => m + ' ' + tr(m === 1 ? 'month' : 'months'))].map(x => h('th', null, x)))),
    h('tbody', null, rows.flatMap(r => [h('tr', { class: 'sim-row-click' + (SIM_VIEW.open === r.day.date ? ' open' : ''), tabindex: 0, title: tr('Show the stocks of this cohort'), onclick: () => { SIM_VIEW.open = SIM_VIEW.open === r.day.date ? null : r.day.date; App.render(); } },
      h('td', { class: 'notr' }, simDayLabel(r.day.date)), h('td', { class: 'notr small' }, r.day.report || '—'),
      h('td', { class: 'notr' }, String(r.sim?.positions?.length || 0)), h('td', { class: 'notr' }, simCash(r.sim?.capital)),
      ...r.outcomes.map(o => h('td', null, simValueCell(o)))), ...(SIM_VIEW.open === r.day.date ? [simDetail(r)] : [])]))));
  return h('div', null, heading, h('div', { class: 'kpis sim-kpis' }, ...summaries), h('div', { class: 'row mt sim-row' }, h('b', null, tr('Return chart')), h('span', { class: 'sp' }), periodButtons), chart,
    card(tr('Cohort results'), tr('The first close on or after each 1/2/3-calendar-month date is used. Benchmark baseline uses the last S&P 500 close on or before selection day; selection prices come from the report.'), table, null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Price return only. No dividends, commissions, taxes or slippage. S&P 500 baseline is a daily close, so it is approximate to the intraday report quote. Not investment advice.')));
};
