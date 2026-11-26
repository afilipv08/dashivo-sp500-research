'use strict';
/* ================= Crypto backtest with freqtrade (installed on the owner's PC): the sample strategy on the top coins ================= */
const BT = { data: null, loading: false, error: '', timer: null };
const BT_STABLES = ['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDS', 'PYUSD'];
const btTestable = sym => /^[A-Z0-9]{2,10}$/.test(sym) && !BT_STABLES.includes(sym);
const btSymbols = () => (CRYPTO.data?.coins || []).map(c => c.symbol);
async function btLoad() {
  if (BT.loading) return;
  BT.loading = true;
  try { BT.data = await runRequest('/api/agents?program=freqtrade&symbols=' + encodeURIComponent(btSymbols().join(','))); BT.error = ''; }
  catch (e) { BT.error = e.message || 'Backtest results are unavailable.'; }
  BT.loading = false;
  clearTimeout(BT.timer);
  if (BT.data?.run?.running) BT.timer = setTimeout(() => { if (App.route() === 'backtest') btLoad(); }, 10000);
  if (App.route() === 'backtest') App.render();
}
async function btRun(symbols) {
  if (!symbols.length) return;
  if (!confirm(tr('Backtest') + ': ' + symbols.join(', ') + '? ' + tr('This downloads public Binance candles and runs freqtrade on your PC, about half a minute per coin, one coin at a time.'))) return;
  try { await runRequest('/api/agents/run', 'POST', { symbols, program: 'freqtrade' }); toast('Backtest started'); }
  catch (e) { toast(e.message); }
  BT.loading = false; btLoad();
}
Views.backtest = () => {
  if (!CRYPTO.data) { loadCrypto().then(() => App.route() === 'backtest' && App.render()); }
  if (CRYPTO.data && !BT.data && !BT.loading && !BT.error) btLoad();
  const heading = card('Backtest', 'What the freqtrade sample strategy (RSI/Bollinger-style) would have done on each coin over the last 90 days of Binance hourly candles, trading 100 USDT at a time. It is a test of the past on one example strategy, not a forecast or advice.', null, null, 'c12');
  if (BT.error && !BT.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, BT.error)));
  if (!CRYPTO.data || !BT.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const d = BT.data, run = d.run || {}, results = d.results || {}, today = d.today || new Date().toISOString().slice(0, 10), online = window.dashboardStatic;
  const coinsList = CRYPTO.data.coins || [], testable = coinsList.filter(c => btTestable(c.symbol)).map(c => c.symbol), need = testable.filter(s => !results[s] || results[s].date < today);
  if (!online && !d.available) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('freqtrade was not found. Install it, or set FREQTRADE_DIR to its folder before starting the dashboard.'))));
  const status = run.running && run.program === 'freqtrade' ? h('div', { class: 'banner' }, icon('sched', 18), h('b', null, tr('Running')), h('span', { class: 'notr' }, run.current || ''),
    h('span', { class: 'muted' }, tr('Waiting') + ': ' + (run.queue || []).length + ' · ' + tr('Done') + ': ' + (run.done || []).length)) : null;
  const errors = run.program === 'freqtrade' ? Object.entries(run.errors || {}).map(([s, m]) => h('div', { class: 'banner' }, icon('alert', 18), h('b', { class: 'notr' }, s), h('span', null, tr(m)))) : [];
  const runBtn = btn(need.length ? tr('Backtest missing or outdated') + ' (' + need.length + ')' : tr('All backtests are up to date'), 'play', () => btRun(need), 'sm');
  if (run.running || !need.length) runBtn.disabled = true;
  const actions = online ? h('p', { class: 'muted small' }, tr('Runs start only from the dashboard on your PC; this online copy shows the answers saved so far.'))
    : h('div', { class: 'row' }, runBtn, h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Checked') + ' ' + new Date(d.checkedAt).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' })));
  const pct = (v, digits = 1) => num(v) ? h('span', { class: plClass(v / 100) }, (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), digits) + '%') : '—';
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl bt-tbl' },
    h('thead', null, h('tr', null, ['Coin', 'Result', 'Trades', 'Won', 'Profit', 'Deepest drawdown', 'Period'].map(x => h('th', null, tr(x))))),
    h('tbody', null, coinsList.map(c => { const r = results[c.symbol], stable = BT_STABLES.includes(c.symbol), skipped = !btTestable(c.symbol);
      return h('tr', null, h('td', null, h('b', { class: 'notr' }, c.symbol), h('div', { class: 'muted small notr' }, c.name)),
        h('td', null, r ? h('span', { class: 'tech-verdict agent-' + (r.rating === 'Profit' ? 'good' : r.rating === 'Loss' ? 'bad' : 'mid') }, tr(r.rating)) : h('span', { class: 'muted' }, stable ? tr('Stablecoin') : skipped ? tr('Not testable') : run.current === c.symbol ? tr('Running') : tr('No run yet'))),
        h('td', { class: 'notr' }, r ? String(r.trades ?? '—') : '—'), h('td', { class: 'notr' }, r && num(r.winRate) ? nf(r.winRate, 0) + '%' : '—'),
        h('td', { class: 'notr' }, r ? pct(r.profitPct, 2) : '—'), h('td', { class: 'notr' }, r && num(r.drawdownPct) ? nf(r.drawdownPct, 1) + '%' : '—'), h('td', { class: 'notr small' }, r?.period || '—')); }))));
  return h('div', null, heading, status, ...errors, card(null, null, h('div', null, actions, table), null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Source:'), ' ', ivLink('freqtrade', 'https://github.com/freqtrade/freqtrade'), ' · ', tr('Candles from Binance public data; fees and slippage follow freqtrade defaults. Coins not listed on Binance are reported as unavailable. Not investment advice.')));
};
