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

/* ---------- plain-language explanations (hover / tap) ---------- */
const SIG_PILLAR = {
  quality: [X('Is the company financially healthy?', 'Este compania sănătoasă financiar?'), X('Five pass/fail checks on SEC filings: sales growth above 8%, growth speeding up, margin not lower than a year ago, positive free cash flow, moderate debt. 5 passed = +2, 4 = +1, 3 = 0, 2 = −1, fewer = −2.', 'Cinci verificări trece/pică pe raportările SEC: vânzări în creștere cu peste 8%, creștere în accelerare, marjă nu mai mică ca acum un an, flux de numerar liber pozitiv, datorie moderată. 5 trecute = +2, 4 = +1, 3 = 0, 2 = −1, mai puține = −2.'), 30],
  positioning: [X('What insiders and short sellers are doing.', 'Ce fac insiderii și vânzătorii în lipsă (short).'), X('Insider buying (+1 for one buyer, +2 for two or more in 30 days), a big insider sale (−1), short interest above 15% (+1 with price above its 50-day average, −1 below), rising shorts while price falls (−1), put/call open interest (+0.5 under 0.7, −0.5 over 1.3). Limited to −2…+2.', 'Cumpărări de insideri (+1 pentru unul, +2 pentru doi sau mai mulți în 30 de zile), vânzare mare a unui insider (−1), short interest peste 15% (+1 cu prețul peste media pe 50 de zile, −1 sub ea), short în creștere cât prețul scade (−1), put/call open interest (+0,5 sub 0,7, −0,5 peste 1,3). Limitat la −2…+2.'), 25],
  timing: [X('Is the price chart ready for a purchase now?', 'Este graficul de preț pregătit pentru o achiziție acum?'), X('Five price checks: price above its 50-day average, 50-day above 200-day, a breakout or a pullback setup, that setup on 1.5× volume, RSI(14) between 45 and 72. 5 passed = +2, 4 = +1, 3 = 0, 2 = −1, fewer = −2.', 'Cinci verificări de preț: preț peste media pe 50 de zile, media 50 peste media 200, un setup de breakout sau pullback, acel setup cu volum 1,5×, RSI(14) între 45 și 72. 5 trecute = +2, 4 = +1, 3 = 0, 2 = −1, mai puține = −2.'), 25],
  sector: [X('Is the stock’s sector leading the market?', 'Este sectorul acțiunii în fruntea pieței?'), X('The sector ETF is ranked against the other sectors on 3- and 6-month performance versus SPY: best = +2, next two = +1, middle = 0, then −1 and −2.', 'ETF-ul sectorului e clasat față de celelalte sectoare după performanța pe 3 și 6 luni față de SPY: cel mai bun = +2, următoarele două = +1, mijloc = 0, apoi −1 și −2.'), 20]
};
const SIG_PILLAR_NAME = { quality: 'Quality', positioning: 'Positioning', timing: 'Timing', sector: 'Sector' };
const SIG_DECISION_INFO = {
  BUY: X('The score is high enough (+1.2 or more) and no safety rule blocks it. Consider a position with the stop shown in the detail.', 'Scorul e suficient de mare (+1,2 sau mai mult) și nicio regulă de siguranță nu îl blochează. Poți lua în calcul o poziție cu stopul din detaliu.'),
  WATCH: X('Interesting but not ready: score between +0.5 and +1.2, or a safety rule capped a higher score. Wait for the triggers listed in the detail.', 'Interesantă dar nu e gata: scor între +0,5 și +1,2, sau o regulă de siguranță a plafonat un scor mai mare. Așteaptă declanșatorii din detaliu.'),
  PASS: X('The score is below +0.5: nothing here argues for buying now.', 'Scorul e sub +0,5: nimic nu pledează pentru cumpărare acum.'),
  AVOID: X('A red flag (possible earnings manipulation) overrides everything else.', 'Un semnal roșu (posibilă manipulare a profitului) anulează tot restul.')
};
X('Decision', 'Decizie'); X('Funnel score', 'Scor pâlnie'); X('Data', 'Date'); X('Next earnings', 'Următoarea raportare');
const SIG_DATA_TXT = { ok: X('All methods computed', 'Toate metodele calculate'), low: X('Some data missing', 'Lipsesc unele date'), none: X('Not enough data', 'Date insuficiente') };
const sigMissing = s => s.methods.filter(m => m.verdict === 'NO DATA');
/* ok: every method that applies has data · low: at least one is missing · none: fundamentals missing or six or more methods without data */
const sigData = s => !s ? 'none' : !s.funnel.qualityKnown || sigMissing(s).length >= 6 ? 'none' : sigMissing(s).length ? 'low' : 'ok';
const sigMethodWords = m => m.vote === 1 ? X('supports buying', 'susține cumpărarea') : m.vote === -1 ? X('argues against', 'pledează împotrivă') : m.vote === 0 ? X('neutral', 'neutru') : m.verdict === 'NO DATA' ? X('no data, counted as 0', 'fără date, numărat ca 0') : X('not scored (informational or does not apply)', 'fără punctaj (informativ sau nu se aplică)');
function sigMethodTip(m) {
  const info = SIG_INFO[m.id] || [];
  return tipHtml('#' + m.id + ' ' + tr(m.name), [exRow('Group', tr(m.group)), exRow('What it checks', tr(info[0])), exRow('Rule', tr(info[1])), exRow('Here', '<span class="notr">' + esc(m.text) + '</span>'),
    exRow('Reading', tr(sigMethodWords(m)))], m.verdict === 'NO DATA' ? X('Missing data is shown as missing and never estimated.', 'Datele lipsă sunt afișate ca lipsă și niciodată estimate.') : X('A vote of +1 / 0 / −1 feeds the ▲ / ▼ count; the funnel score uses its own four pillars.', 'Votul +1 / 0 / −1 intră în numărătoarea ▲ / ▼; scorul pâlniei folosește cei patru piloni ai săi.'));
}
function sigPillarTip(k, s) {
  const f = s.funnel, [what, rule, weight] = SIG_PILLAR[k], v = f[k];
  let here = '';
  if (k === 'quality') here = s.quality ? s.quality.passed + ' / ' + s.quality.known + ' ' + tr('checks passed') : tr('no data');
  if (k === 'timing') here = f.timingChecks.filter(Boolean).length + ' / 5 ' + tr('checks passed');
  if (k === 'positioning') here = f.positioningNotes?.length ? f.positioningNotes.map(tr).join('; ') : tr('no insider, short-interest or option signal');
  if (k === 'sector') here = f.sectorRank != null ? tr('rank') + ' ' + f.sectorRank + ' ' + tr('of 11 sectors') : tr('no data');
  return tipHtml(SIG_PILLAR_NAME[k], [exRow('What it shows', tr(what)), exRow('Calculation', tr(rule)), exRow('Weight in the score', weight + '%'), exRow('Here', '<span class="notr">' + esc(here) + '</span>'),
    exRow('Score', exSigned(v, 1) + ' → ' + weight / 100 + ' × ' + exSigned(v, 1) + ' = ' + exSigned(v * weight / 100, 2))],
    k === 'quality' && !f.qualityKnown ? X('SEC statements are missing, so Quality counts as 0 and BUY is capped at WATCH.', 'Situațiile SEC lipsesc, deci Calitatea contează 0 și BUY e plafonat la WATCH.') : X('Each pillar goes from −2 (bad) to +2 (good).', 'Fiecare pilon merge de la −2 (rău) la +2 (bun).'));
}
function sigScoreTip(s) {
  const f = s.funnel, c = s.conclusion;
  return tipHtml('Funnel score', [exRow('What it shows', tr(X('One number that combines the four pillars: positive favours buying, negative argues against.', 'Un singur număr care combină cei patru piloni: pozitiv favorizează cumpărarea, negativ pledează împotrivă.'))),
    exRow('Calculation', '<span class="notr">0.30×' + exSigned(f.quality, 1) + ' + 0.25×' + exSigned(f.positioning, 1) + ' + 0.25×' + exSigned(f.timing, 1) + ' + 0.20×' + exSigned(f.sector, 1) + ' = ' + exSigned(f.final) + '</span>'),
    exRow('Before safety rules', f.raw), exRow('Decision', c.decision)],
    X('BUY from +1.2, WATCH from +0.5, otherwise PASS. Safety rules can lower the decision, never raise it.', 'BUY de la +1,2, WATCH de la +0,5, altfel PASS. Regulile de siguranță pot coborî decizia, niciodată urca.'));
}
function sigDecisionTip(s) {
  const c = s.conclusion;
  return tipHtml('Decision', [exRow('Decision', c.decision), exRow('What it means', tr(SIG_DECISION_INFO[c.decision])), exRow('Why', tr(c.summary)), ...c.overrides.map(o => exRow('Safety rule', tr(o)))],
    X('Research, not investment advice. The rules are starting points that have not been backtested here.', 'Cercetare, nu sfat de investiții. Regulile sunt puncte de plecare netestate retroactiv aici.'));
}
function sigDataTip(s) {
  const miss = sigMissing(s), st = sigData(s), known = s.methods.filter(m => m.vote != null).length;
  return tipHtml('Data coverage', [exRow('Methods with a vote', known + ' / ' + s.methods.length), exRow('Reading', tr(SIG_DATA_TXT[st])), exRow('Missing', miss.length ? miss.map(m => '#' + m.id + ' ' + tr(m.name)).join(', ') : null),
    exRow('Fundamentals (SEC)', s.funnel.qualityKnown ? tr('available') : tr('missing, Quality counts 0'))],
    X('Some methods never give a vote (informational or not applicable). Missing data counts 0 and is never estimated; without fundamentals BUY is capped at WATCH.', 'Unele metode nu dau niciodată vot (informative sau neaplicabile). Datele lipsă contează 0 și nu sunt estimate; fără fundamentale BUY e plafonat la WATCH.'));
}
const sigHeadTip = {
  Decision: [X('The conclusion: BUY, WATCH, PASS or AVOID.', 'Concluzia: BUY, WATCH, PASS sau AVOID.'), X('From the funnel score, then lowered by safety rules (risk-off market, no fundamentals, earnings within 14 days, red flags).', 'Din scorul pâlniei, apoi coborât de regulile de siguranță (piață risk-off, fără fundamentale, raportare în 14 zile, semnale roșii).')],
  'Funnel score': [X('One number from −2 to +2 combining the four pillars.', 'Un număr de la −2 la +2 care combină cei patru piloni.'), X('0.30 × Quality + 0.25 × Positioning + 0.25 × Timing + 0.20 × Sector. BUY from +1.2, WATCH from +0.5.', '0,30 × Calitate + 0,25 × Poziționare + 0,25 × Timing + 0,20 × Sector. BUY de la +1,2, WATCH de la +0,5.')],
  '▲ / ▼': [X('How many of the 27 methods support (▲) or argue against (▼) buying.', 'Câte dintre cele 27 de metode susțin (▲) sau pledează împotriva (▼) cumpărării.'), X('Count of methods with vote +1 and −1; neutral and unscored methods are not counted.', 'Numărul metodelor cu vot +1 și −1; metodele neutre și fără punctaj nu se numără.')],
  Data: [X('Did every method get the data it needs?', 'A primit fiecare metodă datele de care are nevoie?'), X('Methods with a vote out of 27; the rest are informational, not applicable or missing data.', 'Metode cu vot din 27; restul sunt informative, neaplicabile sau fără date.')],
  'Next earnings': [X('Date of the next earnings report.', 'Data următoarei raportări de rezultate.'), X('Within 14 days a BUY is capped at WATCH because a report can move the price sharply.', 'În mai puțin de 14 zile un BUY e plafonat la WATCH, pentru că un raport poate mișca puternic prețul.')]
};
const sigTh = (label, spec) => exTip(h('th', null, tr(label)), label, [exRow('What it shows', tr(spec[0])), exRow('Calculation', tr(spec[1]))]);
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
  const rows = r.items.map(it => exHover(h('tr', null, h('td', null, tr(it.label)), h('td', { class: 'notr' }, fmt(it.key, it.value)),
    h('td', null, it.score == null ? h('span', { class: 'muted' }, '—') : sigChip(sigVoteClass(it.score), h('span', { class: 'notr' }, sigNum(it.score, 0))))),
    () => tipHtml(it.label, [exRow('Value', it.value == null ? tr('no data') : '<span class="notr">' + esc(fmt(it.key, it.value).textContent ?? fmt(it.key, it.value)) + '</span>'),
      exRow('Score', it.score == null ? tr('not counted') : sigNum(it.score, 0))], it.value == null ? X('No data: this indicator is not counted, so the regime rests on fewer than five.', 'Fără date: acest indicator nu se numără, deci regimul se bazează pe mai puțin de cinci.') : X('Each indicator votes +1 (supportive), 0 or −1 (hostile) for stocks.', 'Fiecare indicator votează +1 (favorabil), 0 sau −1 (ostil) pentru acțiuni.'))));
  const dm = m.dualMomentum, fs = m.faberSpy, vx = m.vix, mc = m.macro || {}, ca = m.crossAsset || {}, se = m.seasonality || {};
  const fact = (label, value) => h('div', { class: 'tf' }, h('small', null, tr(label)), h('b', { class: 'notr small' }, value));
  return card('Market regime', 'Five market indicators, each +1 / 0 / −1. Risk-off blocks new long positions; Neutral halves the risk per trade.', h('div', null,
    r.known < 5 ? exBanner('warn', tr('Market regime rests on') + ' ' + r.known + ' ' + tr('of 5 indicators; the rest have no data.')) : null,
    h('div', { class: 'row' }, exHover(sigChip(SIG_REGIME_CLASS[r.label] || 'mid', tr(r.label)), () => tipHtml('Market regime', [exRow('What it means', tr(r.label === 'Risk-on' ? X('Conditions favour stocks: normal risk per trade.', 'Condițiile favorizează acțiunile: risc normal per tranzacție.') : r.label === 'Risk-off' ? X('Conditions are hostile: no new long positions.', 'Condițiile sunt ostile: fără poziții long noi.') : X('Mixed picture: half the usual risk per trade.', 'Imagine mixtă: jumătate din riscul obișnuit per tranzacție.'))), exRow('Calculation', '<span class="notr">' + sigNum(r.score, 0) + ' (' + r.known + '/5)</span>')], X('Score +2 or more = Risk-on, −2 or less = Risk-off, otherwise Neutral.', 'Scor +2 sau mai mult = Risk-on, −2 sau mai puțin = Risk-off, altfel Neutral.'))), h('b', { class: 'notr' }, tr('Score') + ' ' + sigNum(r.score, 0) + ' (' + r.known + '/5)'),
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
    exHover(h('div', { class: 'tf' }, h('small', null, tr('Funnel score')), h('b', { class: 'notr' }, sigNum(f.final) + ' → ' + f.raw)), () => sigScoreTip(s)),
    h('div', { class: 'tf' }, h('small', null, tr('Quality') + ' · ' + tr('Positioning') + ' · ' + tr('Timing') + ' · ' + tr('Sector')), h('b', { class: 'notr' }, [f.quality, f.positioning, f.timing, f.sector].map(x => sigNum(x, 1)).join(' · '))),
    exHover(h('div', { class: 'tf' }, h('small', null, tr('Stop')), h('b', { class: 'notr' }, usd1(c.stop) + ' (' + tr('risk per share') + ' ' + usd1(c.riskPerShare) + ')')), () => tipHtml('Stop', [exRow('Calculation', '<span class="notr">' + usd1(s.price) + ' − 2 × ATR = ' + usd1(c.stop) + '</span>'), exRow('Risk per share', usd1(c.riskPerShare))], X('A close below the stop means the idea is wrong: leave. ATR is the average daily range over 14 days.', 'O închidere sub stop înseamnă că ideea e greșită: ieși. ATR e intervalul zilnic mediu pe 14 zile.'))),
    h('div', { class: 'tf' }, h('small', null, tr('Invalidation')), h('b', { class: 'small' }, c.invalidation)),
    h('div', { class: 'tf' }, h('small', null, tr('Next earnings')), h('b', { class: 'notr' }, c.nextEarnings || '—')),
    h('div', { class: 'tf' }, h('small', null, tr('Price')), h('b', { class: 'notr' }, usd1(s.price) + ' · ' + s.date)));
  const checks = q ? h('div', { class: 'tv-group' }, h('div', { class: 'tv-head' }, h('b', null, tr('Quality checks')), h('small', { class: 'muted notr' }, q.passed + ' / ' + q.known)),
    h('ul', { class: 'sig-list' }, q.items.map(i => h('li', { class: i.ok == null ? 'muted' : i.ok ? 'positive' : 'negative' }, (i.ok == null ? '○ ' : i.ok ? '✓ ' : '✗ ') + tr(i.label) + (i.ok == null ? ' · ' + tr('no data') : ''))))) : null;
  const methods = h('table', { class: 'pf-tbl sig-methods' }, h('thead', null, h('tr', null, ['#', tr('Method'), tr('Verdict'), tr('Data')].map(x => h('th', null, x)))),
    h('tbody', null, s.methods.map(m => h('tr', { class: m.vote == null ? 'fd-missing' : '' }, h('td', { class: 'notr muted' }, String(m.id)), h('td', null, exHover(h('span', null, tr(m.name)), () => sigMethodTip(m))),
      h('td', null, exHover(sigChip(sigVoteClass(m.vote), h('span', { class: 'notr' }, m.verdict)), () => sigMethodTip(m))), h('td', { class: 'notr small' }, m.text)))));
  const st = sigData(s), miss = sigMissing(s), secOk = (SIG.data.sources?.sec?.status || 'ok') === 'ok';
  const banner = st === 'ok' ? null : exBanner(st === 'none' ? 'bad' : 'warn', st === 'none' ? tr('Not enough data for a reliable verdict:') + ' ' + (s.funnel.qualityKnown ? '' : tr('fundamentals (SEC) are missing, so Quality counts as 0.') + ' ') : tr('Some data is missing.') + ' ',
    miss.length ? tr('No data for') + ': ' + miss.map(m => '#' + m.id + ' ' + tr(m.name)).join(', ') + '. ' : '', tr('Missing data counts as 0 and is never estimated.'), secOk ? '' : ' ' + tr('The SEC source did not respond in the last build.'));
  const example = h('div', { class: 'ex-example' }, h('b', null, tr('How this verdict was reached') + ': '), h('span', { class: 'notr' }, '0.30×' + sigNum(f.quality, 1) + ' + 0.25×' + sigNum(f.positioning, 1) + ' + 0.25×' + sigNum(f.timing, 1) + ' + 0.20×' + sigNum(f.sector, 1) + ' = ' + sigNum(f.final) + ' → ' + f.raw),
    ' · ', tr(SIG_DECISION_INFO[f.raw]), c.decision !== f.raw ? ' ' + tr('Safety rules then changed it to') + ' ' + c.decision + '.' : '');
  return h('div', { class: 'tech-detail' }, banner,
    h('p', { class: 'tech-sum-line' }, exHover(sigDecision(c), () => sigDecisionTip(s)), ' ', h('b', null, tr(c.summary))), example,
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
  const kpis = h('div', { class: 'kpis' }, ...['BUY', 'WATCH', 'PASS', 'AVOID'].map(d => exHover(kpi(d, String(counts[d] || 0), tr('of the stocks shown')), () => tipHtml(d, [exRow('What it means', tr(SIG_DECISION_INFO[d]))], X('Counts the stocks currently shown below.', 'Numără acțiunile afișate mai jos.')))));
  const head = h('tr', null, h('th', null, tr('Stock')), sigTh('Decision', sigHeadTip.Decision), sigTh('Funnel score', sigHeadTip['Funnel score']),
    ...['quality', 'positioning', 'timing', 'sector'].map(k => exTip(h('th', null, tr(SIG_PILLAR_NAME[k])), SIG_PILLAR_NAME[k], [exRow('What it shows', tr(SIG_PILLAR[k][0])), exRow('Calculation', tr(SIG_PILLAR[k][1])), exRow('Weight in the score', SIG_PILLAR[k][2] + '%')], X('Each pillar goes from −2 (bad) to +2 (good).', 'Fiecare pilon merge de la −2 (rău) la +2 (bun).'))),
    sigTh('▲ / ▼', sigHeadTip['▲ / ▼']), sigTh('Data', sigHeadTip.Data), sigTh('Next earnings', sigHeadTip['Next earnings']));
  const body = symbols.map(sym => {
    const s = sigOf(sym), stock = universe().find(x => x.symbol === sym) || { company: '' }, open = SIG.open === sym, st = sigData(s);
    return h('tr', { class: 'company-row' + (open ? ' selected' : ''), onclick: () => { SIG.open = open ? null : sym; App.render(); } },
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(sym, 22), h('div', null, h('b', { class: 'notr' }, sym), h('div', { class: 'muted small notr' }, stock.company + (top.some(r => r.symbol === sym) ? '' : ' · ' + tr('added')))))),
      h('td', null, s ? exHover(sigDecision({ ...s.conclusion, summary: '' }), () => sigDecisionTip(s)) : h('span', { class: 'muted small' }, tr('Not analysed in today’s run.'))),
      h('td', null, s ? exHover(sigChip(SIG_DECISION_CLASS[s.funnel.raw] || 'mid', h('span', { class: 'notr' }, sigNum(s.funnel.final))), () => sigScoreTip(s)) : '—'),
      ...['quality', 'positioning', 'timing', 'sector'].map(k => h('td', { class: 'notr' }, s ? exHover(sigChip(s.funnel[k] > 0 ? 'good' : s.funnel[k] < 0 ? 'bad' : 'mid', sigNum(s.funnel[k], 1)), () => sigPillarTip(k, s)) : '—')),
      h('td', { class: 'notr' }, s ? exHover(h('span', null, '▲ ' + s.conclusion.up + ' · ▼ ' + s.conclusion.down), () => tipHtml('▲ / ▼', [exRow('For', s.conclusion.pros.map(id => tr(s.methods.find(m => m.id === id)?.name || '')).join(', ') || '—'), exRow('Against', s.conclusion.cons.map(id => tr(s.methods.find(m => m.id === id)?.name || '')).join(', ') || '—')], X('Open the stock for the data behind each method.', 'Deschide acțiunea pentru datele din spatele fiecărei metode.'))) : '—'),
      h('td', null, s ? exHover(h('span', { class: 'tech-verdict agent-' + ({ ok: 'good', low: 'mid', none: 'bad' })[st] }, s.methods.filter(m => m.vote != null).length + '/27 · ' + tr(SIG_DATA_TXT[st])), () => sigDataTip(s)) : '—'),
      h('td', { class: 'notr muted' }, s?.conclusion.nextEarnings || '—'));
  });
  const options = Object.keys(SIG.data.stocks || {}).sort();
  const picker = h('div', { class: 'row' }, h('span', { class: 'muted small' }, tr('Analyse another stock:')),
    selectEl([['', '—'], ...options.map(s => [s, s])], SIG.extra, v => { SIG.extra = v; SIG.open = v || SIG.open; App.render(); }, 'sel csel'),
    h('span', { class: 'sp' }), h('span', { class: 'muted small notr' }, tr('Computed') + ' ' + new Date(SIG.data.at).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
  const openStock = SIG.open && symbols.includes(SIG.open) ? SIG.open : null;
  const detail = openStock ? card(openStock + ' · ' + ((universe().find(x => x.symbol === openStock) || {}).company || ''), tr('Every method with its data, the reasons for and against, and what would change the verdict; click the row again to close.'), sigDetail(openStock), null, 'c12') : null;
  const src = SIG.data.sources || {}, srcLine = Object.entries(src).map(([k, v]) => k + ': ' + (v.status || '—')).join(' · ');
  const first = symbols.map(sigOf).find(Boolean), ff = first?.funnel;
  const howto = h('p', { class: 'muted small ex-howto' }, tr(X('How to read: four pillars (Quality, Positioning, Timing, Sector) each get −2…+2 and are weighed into one funnel score; the score gives BUY, WATCH or PASS, and safety rules can only lower it. The 27 methods are extra evidence (▲ for, ▼ against). Hover any underlined figure for what it means, how it is calculated and what the number says. Missing data is flagged and counts as 0.', 'Cum citești: patru piloni (Calitate, Poziționare, Timing, Sector) primesc fiecare −2…+2 și se combină într-un scor al pâlniei; scorul dă BUY, WATCH sau PASS, iar regulile de siguranță îl pot doar coborî. Cele 27 de metode sunt dovezi suplimentare (▲ pentru, ▼ împotrivă). Treci cu mouse-ul peste orice cifră subliniată ca să vezi ce înseamnă, cum se calculează și ce spune numărul. Datele lipsă sunt marcate și contează 0.')),
    first ? h('span', { class: 'notr' }, ' ' + tr('Example') + ' ' + first.symbol + ': 0.30×' + sigNum(ff.quality, 1) + ' + 0.25×' + sigNum(ff.positioning, 1) + ' + 0.25×' + sigNum(ff.timing, 1) + ' + 0.20×' + sigNum(ff.sector, 1) + ' = ' + sigNum(ff.final) + ' → ' + first.conclusion.decision + '.') : null);
  return h('div', null, heading, howto, sigMarket(SIG.data.market), kpis,
    card(null, null, h('div', null, picker, h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl sig-tbl' }, h('thead', null, head), h('tbody', null, body))),
      openStock ? null : h('p', { class: 'muted small' }, tr('Click a stock for all 27 methods.'))), null, 'c12'), detail,
    h('p', { class: 'muted small mt' }, tr('Sources:'), ' SEC EDGAR · Yahoo Finance · FRED · CFTC · ApeWisdom. ', h('span', { class: 'notr' }, srcLine), '. ',
      tr('Rules are starting points that have not been backtested here. Missing data is shown as missing and scored 0, never estimated. Research, not investment advice.')));
};
