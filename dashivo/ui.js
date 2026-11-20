'use strict';
/* ============ icons ============ */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 10h18M8 2.5v4M16 2.5v4"/>',
  week: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 10h18M9 10v11M15 10v11"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>',
  sched: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  filter: '<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
  matrix: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 3v18M3 12h18"/>',
  kanban: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="15" rx="1.5"/>',
  gantt: '<path d="M3 5h9M7 10h12M5 15h8M10 20h11"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5z"/><path d="M4 21.5A2.5 2.5 0 016.5 19H20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/>',
  dl: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  up: '<path d="M18 15l-6-6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 015 .6c0 1.7-2.5 2-2.5 3.5M12 17v.4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.1"/><circle cx="17.5" cy="10.5" r="1.1"/><circle cx="8.5" cy="7.5" r="1.1"/><circle cx="6.5" cy="12.5" r="1.1"/><path d="M12 2a10 10 0 100 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.7 4.7 0 0022 10.7C22 5.8 17.5 2 12 2z"/>',
  subtask: '<path d="M6 3v9a3 3 0 003 3h9M14 11l4 4-4 4"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'
};
const icon = (n, s) => h('span', { style: { display: 'inline-flex' }, html: `<svg viewBox="0 0 24 24" ${s ? `style="width:${s}px;height:${s}px"` : ''} fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>` });
const svgIcon = n => `<svg viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

/* ============ tiny components ============ */
function selectEl(opts, value, onchange, cls = 'sel', blank) {
  const s = h('select', { class: cls });
  if (blank != null) s.append(h('option', { value: '' }, blank));
  for (const o of opts) { const [v, l] = Array.isArray(o) ? o : [o, o]; s.append(h('option', { value: v }, l)); }
  if (value != null && ![...s.options].some(o => o.value === String(value)) && value !== '') s.append(h('option', { value }, value));
  s.value = value ?? ''; if (onchange) s.addEventListener('change', () => onchange(s.value)); return s;
}
function inputEl(type, value, onchange, cls = 'in', ev = 'change') {
  const i = h('input', { type, class: cls }); i.value = value ?? ''; if (onchange) i.addEventListener(ev, () => onchange(i.value)); return i;
}
const field = (label, ctl, cls) => h('div', { class: 'fld ' + (cls || '') }, h('label', null, label), ctl);
const badge = (text, color) => h('span', { class: 'badge', style: { '--c': color || 'var(--muted)' } }, text);
const pbar = (pct, cls = '') => h('div', { class: 'pbar ' + cls }, h('i', { style: { width: clamp(pct, 0, 100) + '%' } }));
function card(title, sub, body, actions, cls = '') {
  return h('section', { class: 'card ' + cls }, (title || actions) && h('div', { class: 'card-h' }, h('div', null, title && h('h3', null, title), sub && h('p', null, sub)), h('div', { class: 'sp' }), actions), body);
}
function btn(label, ic, onclick, cls = '') { return h('button', { class: 'btn ' + cls, onclick }, ic && icon(ic), label && h('span', null, label)); }

/* ============ tooltip ============ */
function tipBind(el, fn) {
  const t = $('#tip');
  el.addEventListener('mousemove', e => { const html = fn(e); if (!html) { t.style.opacity = 0; return; } t.innerHTML = html; t.style.opacity = 1; const w = t.offsetWidth; t.style.left = Math.min(innerWidth - w - 10, e.clientX + 14) + 'px'; t.style.top = (e.clientY + 16) + 'px'; });
  el.addEventListener('mouseleave', () => t.style.opacity = 0);
}

/* ============ charts ============ */
function donut(data, o = {}) {
  const total = data.reduce((a, b) => a + b.value, 0), R = 68, C = 2 * Math.PI * R;
  const svg = h('div', { class: 'donut' });
  let svgh = `<svg viewBox="0 0 170 170"><circle class="track" cx="85" cy="85" r="${R}"/>`;
  let off = 0;
  data.forEach((d, i) => {
    if (!d.value) return;
    const len = d.value / total * C, gap = data.filter(x => x.value).length > 1 ? 2.5 : 0;
    svgh += `<circle data-i="${i}" cx="85" cy="85" r="${R}" stroke="${d.color}" stroke-dasharray="${Math.max(len - gap, .5)} ${C}" stroke-dashoffset="${-off}"/>`;
    off += len;
  });
  svg.innerHTML = svgh + '</svg><div class="ctr"><b>' + (o.center ?? total) + '</b><small>' + esc(o.label || 'Total') + '</small></div>';
  tipBind(svg, e => { const c = e.target.closest('circle[data-i]'); if (!c) return ''; const d = data[+c.dataset.i]; return `<b>${esc(d.label)}</b><br>${d.value} · ${Math.round(d.value / total * 100)}%`; });
  if (o.onSelect) { svg.addEventListener('click', e => { const c = e.target.closest('circle[data-i]'); if (c) o.onSelect(data[+c.dataset.i]); }); svg.style.cursor = 'pointer'; }
  const legend = h('div', { class: 'legend' }, data.map(d => h('div', { style: o.onSelect ? { cursor: 'pointer' } : null, onclick: o.onSelect ? () => o.onSelect(d) : null }, h('i', { style: { background: d.color } }), d.label, h('b', null, d.value))));
  return h('div', { class: 'donut-w' }, svg, legend);
}
function hbars(data, o = {}) {
  const max = Math.max(1, ...data.map(d => d.value));
  if (!data.length) return h('div', { class: 'empty' }, 'No data yet');
  return h('div', { class: 'hb' }, data.map(d => h('div', { class: 'r', style: o.onSelect ? { cursor: 'pointer' } : null, onclick: o.onSelect ? () => o.onSelect(d) : null }, h('span', { title: d.label }, d.label), h('div', { class: 't' }, h('i', { style: { width: d.value / max * 100 + '%', background: d.color ? `linear-gradient(90deg,${d.color},${d.color})` : '' } })), h('b', null, d.value))));
}
function niceMax(v) { if (v <= 5) return 5; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function lineChart({ labels, series, height = 250 }) {
  const W = 720, H = height, L = 34, B = 26, T = 12, R = 10;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.data))), n = labels.length;
  const x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), y = v => T + (H - T - B) * (1 - v / max);
  const path = pts => pts.map((p, i) => i ? `C${(pts[i - 1][0] + p[0]) / 2},${pts[i - 1][1]} ${(pts[i - 1][0] + p[0]) / 2},${p[1]} ${p[0]},${p[1]}` : `M${p[0]},${p[1]}`).join(' ');
  let g = `<defs>${series.map((s, k) => `<linearGradient id="lg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="${s.fill ? .38 : .0}"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  for (let k = 0; k <= 4; k++) { const v = max / 4 * k; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/><text x="${L - 8}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`; }
  const step = Math.ceil(n / 14);
  labels.forEach((l, i) => { if (i % step === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  series.forEach((s, k) => {
    const pts = s.data.map((v, i) => [x(i), y(v)]);
    if (s.fill) g += `<path d="${path(pts)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)}Z" fill="url(#lg${k})"/>`;
    g += `<path d="${path(pts)}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''}/>`;
  });
  g += `<line id="cx" y1="${T}" y2="${H - B}" stroke="var(--accent)" stroke-opacity=".5" style="display:none"/>`;
  series.forEach((s, k) => g += `<circle class="pt" data-k="${k}" r="5" stroke="${s.color}" stroke-width="2.4" style="display:none;fill:var(--tipbg)"/>`);
  const el = h('div'); el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">${g}</svg>`;
  const svg = $('svg', el), cx = $('#cx', svg), pts = $$('.pt', svg);
  const lg = h('div', { class: 'row', style: { gap: '16px', marginTop: '10px' } }, series.map(s => h('span', { class: 'row', style: { gap: '6px', fontSize: '12px', color: 'var(--muted)' } }, h('i', { style: { width: '10px', height: '10px', borderRadius: '50%', background: s.color, display: 'inline-block' } }), s.name)));
  tipBind(svg, e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const i = clamp(Math.round((px - L) / ((W - L - R) / Math.max(1, n - 1))), 0, n - 1);
    cx.setAttribute('x1', x(i)); cx.setAttribute('x2', x(i)); cx.style.display = '';
    pts.forEach((p, k) => { p.setAttribute('cx', x(i)); p.setAttribute('cy', y(series[k].data[i])); p.style.display = ''; });
    return `<b>${esc(labels[i])}</b><br>` + series.map(s => `<span style="color:${s.color}">●</span> ${esc(s.name)}: <b style="color:#fff">${s.data[i]}</b>`).join('<br>');
  });
  svg.addEventListener('mouseleave', () => { cx.style.display = 'none'; pts.forEach(p => p.style.display = 'none'); });
  el.append(lg); return el;
}
function sparkline(vals, color = TH.accent) {
  const W = 120, H = 46, max = Math.max(1, ...vals), n = vals.length;
  const pts = vals.map((v, i) => [i * W / (n - 1), H - 6 - v / max * (H - 14)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const el = h('div', { class: 'spark' }); const id = 'sp' + uid();
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:100%"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${W},${H} L0,${H}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  return el;
}
function ring(pct, color = 'var(--accent)', label) {
  const R = 32, C = 2 * Math.PI * R, p = clamp(pct || 0, 0, 100);
  const arc = p > 0 ? `<circle cx="37" cy="37" r="${R}" stroke="${color}" stroke-linecap="round" stroke-dasharray="${C * p / 100} ${C}"/>` : '';
  const el = h('div', { class: 'ring' }); el.innerHTML = `<svg viewBox="0 0 74 74"><circle class="track" cx="37" cy="37" r="${R}"/>${arc}</svg><b>${label ?? Math.round(p) + '%'}</b>`;
  return el;
}
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

/* ============ toast ============ */
function toast(msg, withUndo) {
  const t = h('div', { class: 'toast' }, msg, withUndo && h('button', { onclick: () => { undo(); t.remove(); } }, 'UNDO'));
  $('#toasts').append(t); setTimeout(() => t.remove(), withUndo ? 6000 : 2800);
}

