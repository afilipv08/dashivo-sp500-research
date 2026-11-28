'use strict';
/* ================= Signals: 27 methods + the funnel score per Top 10 stock, computed once a day (signals.py → data/signals.json) ================= */
const SIG = { data: null, loading: false, error: '', open: null, extra: '' };
const SIG_DECISION_CLASS = { BUY: 'good', WATCH: 'mid', PASS: 'bad', AVOID: 'bad' };
const SIG_REGIME_CLASS = { 'Risk-on': 'good', Neutral: 'mid', 'Risk-off': 'bad', Unknown: 'mid' };
async function sigLoad() {
  if (SIG.loading || SIG.data) return;
  SIG.loading = true;
  try { SIG.data = await runRequest('/api/signals'); SIG.error = ''; } catch (e) { SIG.error = e.message || 'Signals data is unavailable right now.'; }
  SIG.loading = false;
  if (['signals', 'summary'].includes(App.route())) App.render();
}
const sigOf = symbol => SIG.data?.stocks?.[symbol] || null;
const sigChip = (cls, text, title) => h('span', { class: 'tech-verdict agent-' + cls, title: title || '' }, text);
const sigVoteClass = v => v === 1 ? 'good' : v === -1 ? 'bad' : v === 0 ? 'mid' : 'na';
const sigDecision = d => d ? sigChip(SIG_DECISION_CLASS[d.decision] || 'mid', h('span', { class: 'notr' }, d.decision), d.summary) : h('span', { class: 'muted' }, '—');
const sigNum = (v, digits = 2) => num(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), digits) : '—';
/* the short verdict the Verdict page shows */
function sigVerdict(symbol) {
  const s = sigOf(symbol); if (!s) return null;
  const c = s.conclusion;
  return { vote: c.decision === 'BUY' ? 1 : c.decision === 'WATCH' ? 0 : -1, text: c.decision + ' · ' + sigNum(s.funnel.final), title: tr(c.summary) + ' ▲ ' + c.up + ' · ▼ ' + c.down };
}
function sigMarket(m) {
  const r = m.regime, fmt = (key, v) => {
    if (v == null) return h('span', { class: 'muted' }, tr('no data'));
    if (key === 'breadth') return nf(v * 100, 0) + '%';
    if (key === 'cot') return nf(v[0], 0) + ' · p' + nf(v[1], 0) + ' · ' + v[2];
    if (key === 'credit') return nf(v[0], 2) + '% · ' + tr('6-month average') + ' ' + nf(v[1], 2) + '% · ' + sigNum(v[2]) + ' ' + tr('in a month');
    return v.map(x => nf(x, 2)).join(' / ');
  };
  const rows = r.items.map(it => h('tr', null, h('td', null, tr(it.label)), h('td', { class: 'notr' }, fmt(it.key, it.value)),
    h('td', null, it.score == null ? h('span', { class: 'muted' }, '—') : sigChip(sigVoteClass(it.score), h('span', { class: 'notr' }, sigNum(it.score, 0))))));
  const dm = m.dualMomentum, fs = m.faberSpy, vx = m.vix, mc = m.macro || {}, ca = m.crossAsset || {}, se = m.seasonality || {};
  const fact = (label, value) => h('div', { class: 'tf' }, h('small', null, tr(label)), h('b', { class: 'notr small' }, value));
  return card('Market regime', 'Five market indicators, each +1 / 0 / −1. Risk-off blocks new long positions; Neutral halves the risk per trade.', h('div', null,
    h('div', { class: 'row' }, sigChip(SIG_REGIME_CLASS[r.label] || 'mid', tr(r.label)), h('b', { class: 'notr' }, tr('Score') + ' ' + sigNum(r.score, 0) + ' (' + r.known + '/5)'),
      h('span', { class: 'muted small' }, tr('Risk per trade') + ': ' + (r.risk ? nf(r.risk * 100, 1) + '%' : tr('no new longs')))),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'pf-tbl' }, h('thead', null, h('tr', null, [tr('Indicator'), tr('Value'), tr('Score')].map(x => h('th', null, x)))), h('tbody', null, rows))),
    h('div', { class: 'fd-facts' },
      fact('Dual momentum holds', dm ? dm.hold + ' (SPY ' + signedPct(dm.spy) + ', VEU ' + signedPct(dm.veu) + ', AGG ' + signedPct(dm.agg) + ')' : '—'),
      fact('10-month trend (SPY)', fs ? (fs.in ? tr('in') : tr('out')) + ' · ' + usd1(fs.close) + ' / ' + usd1(fs.avg10) : '—'),
      fact('VIX spike rule', vx ? (vx.buy ? tr('buy SPY') : tr('no signal')) + ' · VIX ' + nf(vx.vix, 1) + ' / ' + nf(vx.vix3m, 1) : '—'),
      fact('Business cycle', mc.phase ? tr(mc.phase) + ' · ' + (mc.favored || []).join(', ') : '—'),
      fact('Cross-asset tone', ca.tone ? tr(ca.tone) + ' · Cu/Au ' + signedPct(ca.copperGold3m) + ', USD ' + signedPct(ca.dollar3m) : '—'),
      fact('Seasonality', se.strongHalf ? tr('November–April window') : tr('May–October window')))), null, 'c12');
}
function sigDetail(sym) {
  const s = sigOf(sym); if (!s) return h('div', { class: 'empty' }, tr('Not analysed in today’s run.'));
  const c = s.conclusion, f = s.funnel, q = s.quality;
  const list = (title, items, cls) => items.length ? h('div', { class: 'tv-group' }, h('div', { class: 'tv-head' }, h('b', null, tr(title)), h('small', { class: 'muted notr' }, String(items.length))),
    h('ul', { class: 'sig-list ' + cls }, items.map(x => h('li', { class: typeof x === 'string' && cls !== 'sig-tr' ? 'notr' : '' }, x)))) : null;
  const facts = h('div', { class: 'fd-facts' },
    h('div', { class: 'tf' }, h('small', null, tr('Funnel score')), h('b', { class: 'notr' }, sigNum(f.final) + ' → ' + f.raw)),
    h('div', { class: 'tf' }, h('small', null, tr('Quality') + ' · ' + tr('Positioning') + ' · ' + tr('Timing') + ' · ' + tr('Sector')), h('b', { class: 'notr' }, [f.quality, f.positioning, f.timing, f.sector].map(x => sigNum(x, 1)).join(' · '))),
    h('div', { class: 'tf' }, h('small', null, tr('Stop')), h('b', { class: 'notr' }, usd1(c.stop) + ' (' + tr('risk per share') + ' ' + usd1(c.riskPerShare) + ')')),
    h('div', { class: 'tf' }, h('small', null, tr('Invalidation')), h('b', { class: 'small' }, c.invalidation)),
    h('div', { class: 'tf' }, h('small', null, tr('Next earnings')), h('b', { class: 'notr' }, c.nextEarnings || '—')),
    h('div', { class: 'tf' }, h('small', null, tr('Price')), h('b', { class: 'notr' }, usd1(s.price) + ' · ' + s.date)));
  const checks = q ? h('div', { class: 'tv-group' }, h('div', { class: 'tv-head' }, h('b', null, tr('Quality checks')), h('small', { class: 'muted notr' }, q.passed + ' / ' + q.known)),
    h('ul', { class: 'sig-list' }, q.items.map(i => h('li', { class: i.ok == null ? 'muted' : i.ok ? 'positive' : 'negative' }, (i.ok == null ? '○ ' : i.ok ? '✓ ' : '✗ ') + tr(i.label))))) : null;
  const methods = h('table', { class: 'pf-tbl sig-methods' }, h('thead', null, h('tr', null, ['#', tr('Method'), tr('Verdict'), tr('Data')].map(x => h('th', null, x)))),
    h('tbody', null, s.methods.map(m => h('tr', { class: m.vote == null ? 'fd-missing' : '' }, h('td', { class: 'notr muted' }, String(m.id)), h('td', null, tr(m.name)),
      h('td', null, sigChip(sigVoteClass(m.vote), h('span', { class: 'notr' }, m.verdict))), h('td', { class: 'notr small' }, m.text)))));
  return h('div', { class: 'tech-detail' },
    h('p', { class: 'tech-sum-line' }, sigDecision(c), ' ', h('b', null, tr(c.summary))),
    c.overrides.length ? h('p', { class: 'muted small' }, c.overrides.map(x => tr(x)).join(' ')) : null,
    facts,
    c.triggers.length ? list('What would change the verdict', c.triggers, 'sig-tr') : null,
    h('div', { class: 'tv-groups' }, ...[['For', c.pros, 'sig-for'], ['Against', c.cons, 'sig-against']].map(([title, ids, cls]) =>
      list(title, ids.map(id => s.methods.find(m => m.id === id)).filter(Boolean).map(m => h('span', null, h('b', null, tr(m.name)), ': ', h('span', { class: 'notr' }, m.text))), cls)), checks),
    h('div', { class: 'tbl-wrap mt' }, methods));
}
Views.signals = () => {
  sigLoad();
  const heading = card('Signals', 'For the current Top 10: 27 trading and investing methods and the funnel score (quality 30%, positioning 25%, timing 25%, sector 20%), computed once a day from free sources (SEC filings, Yahoo Finance, FRED, CFTC, Reddit mentions). Market regime and the override rules turn the score into BUY, WATCH, PASS or AVOID. Click a stock for every method and the reasons.', null, null, 'c12');
  if (SIG.error && !SIG.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Signals data is not published yet. It appears after the next daily build.'))));
  if (!SIG.data) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading…'))));
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  if (!selected) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))));
  const symbols = top.map(r => r.symbol);
  if (SIG.extra && !symbols.includes(SIG.extra)) symbols.push(SIG.extra);
  const counts = {}; symbols.forEach(s => { const d = sigOf(s)?.conclusion.decision; if (d) counts[d] = (counts[d] || 0) + 1; });
  const kpis = h('div', { class: 'kpis' }, ...['BUY', 'WATCH', 'PASS', 'AVOID'].map(d => kpi(d, String(counts[d] || 0), tr('of the stocks shown'))));
  const head = h('tr', null, [tr('Stock'), tr('Decision'), tr('Funnel score'), tr('Quality'), tr('Positioning'), tr('Timing'), tr('Sector'), '▲ / ▼', tr('Next earnings')].map(x => h('th', null, x)));
  const body = symbols.map(sym => {
    const s = sigOf(sym), stock = universe().find(x => x.symbol === sym) || { company: '' }, open = SIG.open === sym;
    return h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: () => { SIG.open = open ? null : sym; App.render(); } },
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, stock.company + (top.some(r => r.symbol === sym) ? '' : ' · ' + tr('added')))))),
      h('td', null, s ? sigDecision(s.conclusion) : h('span', { class: 'muted small' }, tr('Not analysed in today’s run.'))),
      h('td', null, s ? sigChip(SIG_DECISION_CLASS[s.funnel.raw] || 'mid', h('span', { class: 'notr' }, sigNum(s.funnel.final)), tr('BUY from +1.2, WATCH from +0.5')) : '—'),
      ...['quality', 'positioning', 'timing', 'sector'].map(k => h('td', { class: 'notr' }, s ? sigChip(s.funnel[k] > 0 ? 'good' : s.funnel[k] < 0 ? 'bad' : 'mid', sigNum(s.funnel[k], 1)) : '—')),
      h('td', { class: 'notr' }, s ? '▲ ' + s.conclusion.up + ' · ▼ ' + s.conclusion.down : '—'), h('td', { class: 'notr muted' }, s?.conclusion.nextEarnings || '—'));
  });
  const options = Object.keys(SIG.data.stocks || {}).sort();
  const picker = h('div', { class: 'row' }, h('span', { class: 'muted small' }, tr('Analyse another stock:')),
    selectEl([['', '—'], ...options.map(s => [s, s])], SIG.extra, v => { SIG.extra = v; SIG.open = v || SIG.open; App.render(); }, 'sel csel'),
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Computed') + ' ' + new Date(SIG.data.at).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  const openStock = SIG.open && symbols.includes(SIG.open) ? SIG.open : null;
  const detail = openStock ? card(openStock + ' · ' + ((universe().find(x => x.symbol === openStock) || {}).company || ''), tr('Every method with its data, the reasons for and against, and what would change the verdict; click the row again to close.'), sigDetail(openStock), null, 'c12') : null;
  const src = SIG.data.sources || {}, srcLine = Object.entries(src).map(([k, v]) => k + ': ' + (v.status || '—')).join(' · ');
  return h('div', null, heading, sigMarket(SIG.data.market), kpis,
    card(null, null, h('div', null, picker, h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl sig-tbl' }, h('thead', null, head), h('tbody', null, body))),
      openStock ? null : h('p', { class: 'muted small' }, tr('Click a stock for all 27 methods.'))), null, 'c12'), detail,
    h('p', { class: 'muted small mt' }, tr('Sources:'), ' SEC EDGAR · Yahoo Finance · FRED · CFTC · ApeWisdom. ', h('span', { class: 'notr' }, srcLine), '. ',
      tr('Rules are starting points that have not been backtested here. Missing data is shown as missing and scored 0, never estimated. Research, not investment advice.')));
};
