'use strict';
/* ================= Top 10 history: one entry per day per preset (automatic), plus the user's own saves ================= */
const HIST = { data: null, error: '', preset: 'default', open: null };
const MINE_KEY = 'dashivo-sp500-top10-saved';
const HIST_PRESETS = [['default', 'Default'], ['excel', 'Excel'], ['top5', 'Top 5'], ['mine', 'My saves']];
const histKeep = r => ({ symbol: r.symbol, company: r.company, sector: r.sector, price: r.price, gap: r.gap, upside: r.upside, weighted: r.weighted, support: r.support, distance: r.distance, total: r.total });
const mySaves = () => (store.get(MINE_KEY, []) || []).filter(x => x && Array.isArray(x.items));

/* save the Top 10 of the current filters on this device */
function saveTop10() {
  const sel = selection(); if (!sel) return;
  const top = ranked(sel).slice(0, 10);
  if (!top.length) { toast('No valid ranking values.'); return; }
  const label = activeCriteria().filter(c => c.chip).map(c => c.chip(UI.f).join(' ')).join(' · ');
  const now = new Date();
  store.set(MINE_KEY, [{ date: now.toISOString().slice(0, 10), at: now.toISOString(), report: DATA.source, label, ranking: UI.ranking, matches: sel.length, items: top.map(histKeep) }, ...mySaves()].slice(0, 200));
  toast('Top 10 saved in the history');
}
async function loadHistory() {
  if (HIST.data || HIST.loading) return;
  HIST.loading = true;
  try { HIST.data = window.dashboardRunToken ? await runRequest('/api/top10-history') : { days: [] }; } catch (e) { HIST.error = e.message; HIST.data = { days: [] }; }
  HIST.loading = false;
  if (App.route() === 'history') App.render();
}
/* entries of the chosen preset, newest first: [{date, at, report, matches, label?, items}] */
function histEntries() {
  if (HIST.preset === 'mine') return mySaves().map(s => ({ ...s, own: true }));
  return (HIST.data?.days || []).map(d => ({ date: d.date, at: d.at, report: d.report, ...(d.presets?.[HIST.preset] || { matches: 0, items: [] }) }));
}
const sinceThen = r => { const live = LIVE.prices[r.symbol]; return num(live) && r.price > 0 ? live / r.price - 1 : null; };
const avg = list => { const v = list.filter(num); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const weekday = d => new Date(d + 'T12:00:00').toLocaleDateString(I18N.locale, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

Views.history = () => {
  loadHistory();
  const entries = histEntries();
  const seg = h('div', { class: 'seg hist-seg' }, HIST_PRESETS.map(([k, label]) => h('button', { class: HIST.preset === k ? 'on' : '', onclick: () => { HIST.preset = k; HIST.open = null; App.render(); } }, label)));
  const head = card('Top 10 history', 'Saved automatically after every research run (every weekday at 16:00 online); “My saves” are the Top 10 lists you saved from Top 10 & filters on this device.',
    h('div', { class: 'row' }, seg, h('span', { class: 'sp' }), btn('Save current Top 10', 'plus', () => { saveTop10(); App.render(); }, 'sm')));
  if (!HIST.data && HIST.preset !== 'mine') return h('div', null, head, card(null, null, h('div', { class: 'empty' }, 'Loading the history…')));
  if (!entries.length) return h('div', null, head, card(null, null, h('div', { class: 'empty' }, HIST.preset === 'mine' ? 'No saved Top 10 yet. Use “Save current Top 10” here or on Top 10 & filters.' : 'No days recorded yet.')));
  /* summary: how the picks did since the day they were selected (live price now vs price that day) */
  const dayAvg = entries.map(e => avg(e.items.map(sinceThen)));
  const all = entries.flatMap(e => e.items.map(r => ({ ...r, date: e.date, chg: sinceThen(r) }))).filter(r => num(r.chg));
  const best = all.reduce((a, r) => (!a || r.chg > a.chg ? r : a), null), worst = all.reduce((a, r) => (!a || r.chg < a.chg ? r : a), null);
  const freq = {}; entries.forEach(e => e.items.forEach(r => { (freq[r.symbol] = freq[r.symbol] || []).push(e.date); }));
  const topFreq = Object.entries(freq).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 10);
  const kpis = h('div', { class: 'kpis' },
    kpi('Days recorded', String(entries.length), h('span', { class: 'notr' }, entries[entries.length - 1].date + ' → ' + entries[0].date)),
    kpi('Average since selection', h('span', { class: plClass(avg(dayAvg)) }, signedPct(avg(dayAvg))), 'live price vs price on the day'),
    kpi('Best pick', best ? best.symbol : '—', best ? h('span', null, h('span', { class: 'positive notr' }, signedPct(best.chg)), ' · ', h('span', { class: 'notr' }, best.date)) : '—'),
    kpi('Weakest pick', worst ? worst.symbol : '—', worst ? h('span', null, h('span', { class: 'negative notr' }, signedPct(worst.chg)), ' · ', h('span', { class: 'notr' }, worst.date)) : '—'),
    kpi('Distinct stocks', String(Object.keys(freq).length), 'across all recorded days'));
  const freqCard = card('Most often in the Top 10', 'Hover a bar for the days', barList(topFreq.map(([sym, days]) => ({ label: sym, logo: true, value: days.length,
    tip: tipHtml(sym, [tipRow('Days in the Top 10', String(days.length)), tipRow('Since then', signedPct(sinceThen({ symbol: sym, price: entries.find(e => e.date === days[days.length - 1]).items.find(r => r.symbol === sym).price })))], days.join(', ')) })),
    { fmt: v => v + ' ' + tr(v === 1 ? 'one day' : 'days') }), null, 'c5');
  const trend = card('Average change since selection, per day', 'Each bar = the 10 stocks selected that day, live price now vs their price then', barList(entries.slice(0, 15).map((e, i) => ({
    label: e.date.slice(5), value: (dayAvg[i] ?? 0) * 100, color: dayAvg[i] < 0 ? 'var(--bad)' : 'var(--good)',
    tip: tipHtml(weekday(e.date), [tipRow('Stocks', String(e.items.length)), tipRow('Average since selection', signedPct(dayAvg[i]))], e.items.map(r => r.symbol).join(', ')) })), { fmt: v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 1) + '%' }), null, 'c7');
  const dayCard = (e, i) => {
    const key = e.at || e.date, open = HIST.open === key;
    const chips = h('div', { class: 'hist-chips' }, e.items.map((r, k) => { const c = sinceThen(r);
      return hoverTip(h('span', { class: 'hist-chip ' + plClass(c) }, h('b', null, k + 1), logoEl(r.symbol, 18), h('span', { class: 'notr' }, r.symbol)),
        () => tipHtml(r.symbol + ' · ' + r.company, [tipRow('Price that day', usd(r.price)), tipRow('Live price', usd(LIVE.prices[r.symbol])), tipRow('Since then', signedPct(c)), tipRow('Min. target proximity', pctf(r.gap))])); }));
    const table = open ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl' },
      h('thead', null, h('tr', null, ['#', 'Symbol', 'Sector', 'Price that day', 'Live price', 'Since then', 'Min. target proximity', 'Upside', 'Score'].map(t => h('th', null, t)))),
      h('tbody', null, e.items.map((r, k) => { const c = sinceThen(r);
        return h('tr', null, h('td', null, String(k + 1)), h('td', null, h('div', { class: 'sym-cell' }, logoEl(r.symbol, 22), h('div', null, h('b', { class: 'notr' }, r.symbol), h('div', { class: 'muted small notr' }, r.company)))),
          h('td', null, sectorIcon(r.sector, 13), ' ', h('span', { class: 'notr' }, r.sector)), h('td', { class: 'notr' }, usd(r.price)), h('td', { class: 'notr' }, usd(LIVE.prices[r.symbol])),
          h('td', { class: 'notr' }, h('span', { class: 'plpill ' + plClass(c) }, signedPct(c))), h('td', { class: 'notr' }, pctf(r.gap)), h('td', { class: 'notr' }, pctf(r.upside)), h('td', { class: 'notr' }, nf(r.weighted))); })))) : null;
    return h('article', { class: 'card hist-day' + (open ? ' open' : '') },
      h('div', { class: 'hist-head', onclick: () => { HIST.open = open ? null : key; App.render(); } },
        h('div', null, h('b', { class: 'notr hist-date' }, weekday(e.date)), h('div', { class: 'muted small notr' }, (e.own ? new Date(e.at).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' }) + ' · ' : '') + (e.report || '') + ' · ' + e.matches + ' ' + tr('matches'))),
        h('span', { class: 'sp' }), h('div', { class: 'hist-avg' }, h('small', null, 'Since selection'), h('b', { class: 'notr ' + plClass(dayAvg[i]) }, signedPct(dayAvg[i]))),
        e.own ? h('button', { class: 'chip-x', title: tr('Delete'), onclick: ev => { ev.stopPropagation(); store.set(MINE_KEY, mySaves().filter(x => x.at !== e.at)); App.render(); } }, '×') : null,
        icon(open ? 'up' : 'down', 16)),
      e.label ? h('p', { class: 'muted small notr' }, e.label) : null, chips, table);
  };
  return h('div', null, head, kpis, h('div', { class: 'grid mt' }, trend, freqCard), h('div', { class: 'hist-list mt' }, entries.map(dayCard)),
    h('p', { class: 'muted small mt' }, 'Prices “that day” are the report prices; “since then” compares them with the current live price. Informational, not investment advice.'));
};
