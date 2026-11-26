'use strict';
/* ================= Technical analysis of the current Top 10, computed from published daily closes ================= */
const TECH_MIN_CLOSES = 200;   // SMA200 needs 200 closes; with fewer the long-term rules are reported as unavailable
const techSeries = (market, symbol) => {
  const v = market.series?.[symbol]; if (!Array.isArray(v)) return [];
  const out = []; (market.dates || []).forEach((date, i) => { if (num(v[i]) && v[i] > 0) out.push({ date, close: v[i] }); });
  return out;
};
const techSma = (closes, n) => closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null;
function techEma(values, n) {
  if (values.length < n) return [];
  const k = 2 / (n + 1); let ema = values.slice(0, n).reduce((a, b) => a + b, 0) / n; const out = [ema];
  for (let i = n; i < values.length; i++) { ema = values[i] * k + ema * (1 - k); out.push(ema); }
  return out;
}
function techRsi(closes, n = 14) {   // Wilder smoothing
  if (closes.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; gain = (gain * (n - 1) + Math.max(d, 0)) / n; loss = (loss * (n - 1) + Math.max(-d, 0)) / n; }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}
function techMacd(closes) {
  const fast = techEma(closes, 12), slow = techEma(closes, 26); if (!slow.length) return null;
  const line = slow.map((s, i) => fast[i + (fast.length - slow.length)] - s), signal = techEma(line, 9); if (!signal.length) return null;
  return { macd: line.at(-1), signal: signal.at(-1), hist: line.at(-1) - signal.at(-1) };
}
const techReturn = (closes, days) => closes.length > days ? closes.at(-1) / closes.at(-1 - days) - 1 : null;
function techVolatility(closes, n = 30) {
  if (closes.length <= n) return null;
  const r = []; for (let i = closes.length - n; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
}
/* every rule votes +1 / 0 / −1 or null (unavailable); the verdict is the sum of the available votes */
function techAnalyse(points) {
  const closes = points.map(p => p.close); if (closes.length < 30) return null;
  const price = closes.at(-1), sma20 = techSma(closes, 20), sma50 = techSma(closes, 50), sma200 = techSma(closes, TECH_MIN_CLOSES);
  const rsi = techRsi(closes), macd = techMacd(closes), r1 = techReturn(closes, 21), r3 = techReturn(closes, 63), r6 = techReturn(closes, 126);
  const year = closes.slice(-252), hi = Math.max(...year), lo = Math.min(...year), pos = hi > lo ? (price - lo) / (hi - lo) : null;
  const rules = [
    { key: 'Price vs SMA50', vote: sma50 == null ? null : price > sma50 ? 1 : -1, detail: sma50 == null ? null : usd1(price) + ' vs ' + usd1(sma50) },
    { key: 'Price vs SMA200', vote: sma200 == null ? null : price > sma200 ? 1 : -1, detail: sma200 == null ? null : usd1(price) + ' vs ' + usd1(sma200) },
    { key: 'SMA50 vs SMA200', vote: sma50 == null || sma200 == null ? null : sma50 > sma200 ? 1 : -1, detail: sma50 == null || sma200 == null ? null : usd1(sma50) + ' vs ' + usd1(sma200) },
    { key: 'RSI 14', vote: rsi == null ? null : rsi < 30 ? 1 : rsi > 70 ? -1 : 0, detail: rsi == null ? null : nf(rsi, 0) },
    { key: 'MACD histogram', vote: macd == null ? null : macd.hist > 0 ? 1 : -1, detail: macd == null ? null : nf(macd.hist, 2) },
    { key: '3-month momentum', vote: r3 == null ? null : r3 > 0 ? 1 : -1, detail: signedPct(r3) }
  ];
  const votes = rules.filter(r => r.vote != null), score = votes.reduce((a, r) => a + r.vote, 0);
  const verdict = votes.length < 4 ? 'unknown' : score >= 3 ? 'bullish' : score <= -3 ? 'bearish' : 'mixed';
  return { price, last: points.at(-1).date, count: closes.length, sma20, sma50, sma200, rsi, macd, r1, r3, r6, hi, lo, pos, vol: techVolatility(closes), rules, score, available: votes.length, verdict };
}
const TECH_LABELS = { bullish: 'Bullish', mixed: 'Mixed', bearish: 'Bearish', unknown: 'Not enough data' };
function techConclusion(t) {
  if (!t || t.verdict === 'unknown') return 'Not enough price history for a verdict.';
  const hot = t.rsi != null && t.rsi > 70, cold = t.rsi != null && t.rsi < 30;
  if (t.verdict === 'bullish') return hot ? 'Trend and momentum mostly positive, but overbought (RSI above 70).' : 'Trend and momentum mostly positive.';
  if (t.verdict === 'bearish') return cold ? 'Trend and momentum mostly negative, but oversold (RSI below 30).' : 'Trend and momentum mostly negative.';
  return hot ? 'Signals are mixed and the stock looks overbought (RSI above 70).' : cold ? 'Signals are mixed and the stock looks oversold (RSI below 30).' : 'Signals point in different directions.';
}
const techTip = (symbol, t) => tipHtml(symbol + ' · ' + tr(TECH_LABELS[t.verdict]), t.rules.map(r => tipRow(r.key, r.vote == null ? tr('Unavailable') : (r.vote > 0 ? '▲ ' : r.vote < 0 ? '▼ ' : '● ') + esc(r.detail || ''))),
  tr('Score') + ' ' + (t.score > 0 ? '+' : '') + t.score + ' / ' + t.available + ' · ' + tr('Data until') + ' ' + t.last);
Views.technical = () => {
  loadSimulations();
  const heading = card('Technical', 'Computed here from published daily closes of the stocks in the current Top 10 (active filters and ranking). Six rules each vote up, neutral or down; hover a verdict for the values. Indicators describe past prices and are not forecasts.', null, null, 'c12');
  if (SIM_VIEW.error) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, SIM_VIEW.error)));
  if (!SIM_VIEW.market) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Loading the history…'))));
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  if (!selected) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))));
  if (!top.length) return h('div', null, heading, card(null, null, h('div', { class: 'empty' }, tr('No ranked stocks in the active selection.'))));
  const rows = top.map(stock => ({ stock, t: techAnalyse(techSeries(SIM_VIEW.market, stock.symbol)) }));
  const counts = { bullish: 0, mixed: 0, bearish: 0 }; rows.forEach(r => { if (r.t && counts[r.t.verdict] != null) counts[r.t.verdict]++; });
  const kpis = h('div', { class: 'kpis' }, kpi('Bullish', String(counts.bullish), 'of the current Top 10', 'good'), kpi('Mixed', String(counts.mixed), 'of the current Top 10'), kpi('Bearish', String(counts.bearish), 'of the current Top 10', 'bad'));
  const cell = (v, fmt) => h('td', { class: 'notr' }, v == null ? '—' : fmt(v));
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl tech-tbl' },
    h('thead', null, h('tr', null, ['Stock', 'Price', 'RSI 14', 'vs SMA50', 'vs SMA200', '1 month', '3 months', '6 months', '52-week position', 'Verdict', 'Summary'].map(x => h('th', null, tr(x))))),
    h('tbody', null, rows.map(({ stock, t }) => h('tr', null,
      h('td', null, h('div', { class: 'sym-cell' }, logoEl(stock.symbol, 22), h('div', null, h('b', { class: 'notr' }, stock.symbol), h('div', { class: 'muted small notr' }, stock.company)))),
      cell(t?.price, usd1), cell(t?.rsi, v => nf(v, 0)),
      cell(t?.sma50 && t.price / t.sma50 - 1, v => h('span', { class: plClass(v) }, signedPct(v))), cell(t?.sma200 && t.price / t.sma200 - 1, v => h('span', { class: plClass(v) }, signedPct(v))),
      cell(t?.r1, v => h('span', { class: plClass(v) }, signedPct(v))), cell(t?.r3, v => h('span', { class: plClass(v) }, signedPct(v))), cell(t?.r6, v => h('span', { class: plClass(v) }, signedPct(v))),
      cell(t?.pos, v => nf(v * 100, 0) + '%'),
      h('td', null, t ? hoverTip(h('span', { class: 'tech-verdict ' + t.verdict }, tr(TECH_LABELS[t.verdict])), () => techTip(stock.symbol, t)) : '—'),
      h('td', { class: 'tech-sum' }, tr(techConclusion(t))))))));
  return h('div', null, heading, kpis, card(null, null, table, null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Votes (up / down): price above / below SMA50 and SMA200; SMA50 above / below SMA200; RSI below 30 / above 70; MACD histogram above / below 0; 3-month return above / below 0. Verdict: bullish at +3 or more, bearish at −3 or less, otherwise mixed.')),
    h('p', { class: 'muted small mt' }, tr('Source: daily closes (Yahoo Finance via the published history). SMA = simple moving average; RSI uses Wilder smoothing; MACD 12/26/9. Indicators use closing prices only. Not investment advice.')));
};
