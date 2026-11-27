'use strict';
/* ================= Daily return calendar: green/red days for the rolling Top 10 selection ================= */
const CAL = { month: null, preset: 'default', selected: null };
const CAL_PRESETS = [['default', 'Default Top 10'], ['excel', 'Excel Top 10'], ['top5', 'Top 5 Investitii']];
const CAL_SATURATION = 0.02;   // a ±2% day reaches the strongest colour

/* the selection in force on a trading day = the latest saved one made on an earlier date (a pick made on the
   day itself is taken at some hour of that day, often during or after the US session, so its first full day is the next one) */
function calSelection(history, preset, day) {
  const days = (history.days || []).filter(d => d.date < day && d.presets?.[preset]?.items?.length).sort((a, b) => b.date.localeCompare(a.date));
  const entry = days[0]; if (!entry) return null;
  return { date: entry.date, symbols: entry.presets[preset].items.slice(0, preset === 'top5' ? 5 : 10).map(r => r.symbol) };
}
const calChange = (market, symbol, i) => {
  const v = market.series?.[symbol]; if (!v || !num(v[i]) || !num(v[i - 1]) || v[i] <= 0 || v[i - 1] <= 0) return null;
  return v[i] / v[i - 1] - 1;
};
/* one entry per trading day: {date, selection, picks:[{symbol, change}], portfolio, benchmark} */
function calDays(history, market, preset) {
  const dates = market.dates || [], out = {};
  for (let i = 1; i < dates.length; i++) {
    const benchmark = calChange(market, '^GSPC', i), selection = calSelection(history, preset, dates[i]);
    if (!selection) { out[dates[i]] = { date: dates[i], benchmark, selection: null, picks: [], portfolio: null }; continue; }
    const picks = selection.symbols.map(symbol => ({ symbol, change: calChange(market, symbol, i) }));
    const valid = picks.filter(p => num(p.change));
    out[dates[i]] = { date: dates[i], benchmark, selection, picks, portfolio: valid.length ? avgNumber(valid.map(p => p.change)) : null };
  }
  return out;
}
const calMonthOf = day => day.slice(0, 7);
function calShiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
const calColor = r => num(r) && r !== 0 ? 'color-mix(in srgb, var(' + (r > 0 ? '--good' : '--bad') + ') ' + Math.round(18 + 52 * Math.min(1, Math.abs(r) / CAL_SATURATION)) + '%, transparent)' : null;

function calTip(day) {
  const rows = [tipRow('Portfolio', signedPct(day.portfolio)), tipRow('S&P 500', signedPct(day.benchmark))];
  if (day.selection) rows.push(tipRow('Selection from', day.selection.date));
  return tipHtml(new Date(day.date + 'T12:00:00').toLocaleDateString(I18N.locale, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }), rows,
    day.picks.length ? day.picks.map(p => p.symbol + ' ' + signedPct(p.change)).join(' · ') : 'No selection was in force on this day.');
}
function calCell(date, info) {
  if (!info) return h('div', { class: 'cal-cell off' }, h('span', { class: 'cal-n' }, String(Number(date.slice(8)))));
  const color = calColor(info.portfolio);
  const cell = h('button', { type: 'button', class: 'cal-cell' + (num(info.portfolio) ? (info.portfolio >= 0 ? ' up' : ' down') : ' none') + (CAL.selected === info.date ? ' sel' : ''),
    style: color ? { background: color } : null, onclick: () => { CAL.selected = CAL.selected === info.date ? null : info.date; App.render(); } },
    h('span', { class: 'cal-n' }, String(Number(date.slice(8)))), h('b', { class: 'cal-v notr' }, num(info.portfolio) ? signedPct(info.portfolio) : '—'));
  return hoverTip(cell, () => calTip(info));
}
Views.calendar = () => {
  loadSimulations();
  const heading = card('Returns calendar', 'Each trading day shows the equal-weighted price return of the Top 10 selection in force that day (the latest one made on an earlier date): green for a gain, red for a loss. Hover for percentages; click a day for its stocks.',
    h('div', { class: 'seg' }, CAL_PRESETS.map(([key, label]) => h('button', { class: CAL.preset === key ? 'on' : '', onclick: () => { CAL.preset = key; CAL.selected = null; App.render(); } }, tr(label)))));
  if (SIM_VIEW.error) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, SIM_VIEW.error)));
  if (!SIM_VIEW.history || !SIM_VIEW.market) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading the history…'))));
  const days = calDays(SIM_VIEW.history, SIM_VIEW.market, CAL.preset), dates = Object.keys(days).sort();
  if (!dates.length) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('No trading days with prices are available yet.'))));
  const withReturn = dates.filter(d => num(days[d].portfolio));
  const month = CAL.month && dates.some(d => calMonthOf(d) === CAL.month) ? CAL.month : calMonthOf(withReturn.at(-1) || dates.at(-1));
  const first = calMonthOf(dates[0]), last = calMonthOf(dates.at(-1));
  const [y, m] = month.split('-').map(Number), daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate(), offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cal-cell blank' }));
  for (let d = 1; d <= daysInMonth; d++) { const date = month + '-' + String(d).padStart(2, '0'); cells.push(calCell(date, days[date])); }
  const monthDays = withReturn.filter(d => calMonthOf(d) === month), wins = monthDays.filter(d => days[d].portfolio > 0).length;
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(I18N.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const nav = h('div', { class: 'cal-nav' },
    h('button', { class: 'btn sm ghost', disabled: month <= first ? true : null, onclick: () => { CAL.month = calShiftMonth(month, -1); CAL.selected = null; App.render(); } }, icon('left', 14)),
    h('b', { class: 'notr cal-title' }, monthName.charAt(0).toUpperCase() + monthName.slice(1)),
    h('button', { class: 'btn sm ghost', disabled: month >= last ? true : null, onclick: () => { CAL.month = calShiftMonth(month, 1); CAL.selected = null; App.render(); } }, icon('right', 14)),
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, wins + ' / ' + monthDays.length + ' ' + tr('green days')));
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map(i => h('div', { class: 'cal-wd' }, DAYS3[i]));
  const grid = h('div', { class: 'cal-grid' }, ...weekdays, ...cells);
  const sel = CAL.selected && days[CAL.selected];
  const detail = sel ? card(new Date(sel.date + 'T12:00:00').toLocaleDateString(I18N.locale, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }),
    sel.selection ? tr('Selection from') + ' ' + sel.selection.date : tr('No selection was in force on this day.'),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl' }, h('thead', null, h('tr', null, [tr('Symbol'), tr('Day return')].map(t => h('th', null, t)))),
      h('tbody', null, [{ symbol: tr('Portfolio'), change: sel.portfolio, total: true }, { symbol: 'S&P 500', change: sel.benchmark, total: true }, ...sel.picks].map(p =>
        h('tr', null, h('td', { class: p.total ? '' : 'notr' }, p.total ? h('b', null, p.symbol) : h('div', { class: 'sym-cell' }, logoEl(p.symbol, 20), h('b', null, p.symbol))),
          h('td', { class: 'notr' }, h('span', { class: 'plpill ' + plClass(p.change) }, signedPct(p.change)))))))), null, 'c12') : null;
  return h('div', null, heading, card(null, null, h('div', null, nav, grid), null, 'c12'), detail,
    h('p', { class: 'muted small mt' }, tr('Price return from daily closes only; days without a market close or without a prior selection are grey. Dividends, fees and taxes are excluded. Not investment advice.')));
};
