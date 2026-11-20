'use strict';
/* Dashivo shared helpers (from reference-app/src/core.js, task model removed) */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function add(el, kids) { for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(k)); } }
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids); return el;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const D = {
  iso: d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
  parse(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); },
  today: () => D.iso(new Date()),
  add(s, n) { const d = D.parse(s); d.setDate(d.getDate() + n); return D.iso(d); },
  addMonths(s, n) { const d = D.parse(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return D.iso(d); },
  diff: (a, b) => Math.round((D.parse(a) - D.parse(b)) / 864e5),
  dow: s => D.parse(s).getDay(),
  fmt(s, o) { return s ? D.parse(s).toLocaleDateString(I18N.locale, o || { day: '2-digit', month: 'short', year: 'numeric' }) : ''; },
  short: s => D.fmt(s, { day: 'numeric', month: 'short' }),
  ym: s => s.slice(0, 7),
  mk: (y, m, d = 1) => y + '-' + pad(m + 1) + '-' + pad(d), // m is 0-based
  weekStart(s, ws) { const d = D.dow(s); return D.add(s, -((d - ws + 7) % 7)); },
  dim: (y, m) => new Date(y, m + 1, 0).getDate()
};
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function hash(s) { let n = 0; for (const c of String(s)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return n; }
const AV_COLORS = ['#fc9751', '#ffb37a', '#58a6ff', '#3ecf8e', '#b07cff', '#f5c451', '#ff6b9d', '#4fd1d9'];
const avColor = p => AV_COLORS[hash(p) % AV_COLORS.length];
const initials = p => String(p || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const CHART_COLORS = ['#fc9751', '#d9703f', '#b3a597', '#5b6470', '#3ecf8e', '#58a6ff', '#b07cff', '#f5c451'];
