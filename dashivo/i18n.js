'use strict';
/* ================= INTERNATIONALISATION ================= */
const LANG_KEY = APP_CFG.langKey || 'dashivo-lang';
const LANGS = [
  { code: 'en', name: 'English', country: 'United States', locale: 'en-US' },
  { code: 'de', name: 'Deutsch', country: 'Deutschland', locale: 'de-DE' },
  { code: 'fr', name: 'Français', country: 'France', locale: 'fr-FR' },
  { code: 'es', name: 'Español', country: 'España', locale: 'es-ES' },
  { code: 'it', name: 'Italiano', country: 'Italia', locale: 'it-IT' },
  { code: 'ro', name: 'Română', country: 'România', locale: 'ro-RO' }
];
const DAYS3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DAYS2 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const I18N = {
  lang: 'en', locale: 'en-US', maps: {}, cache: {},
  init() {
    const codes = ['de', 'fr', 'es', 'it', 'ro'];
    codes.forEach(c => this.maps[c] = new Map());
    I18N_ROWS.forEach(r => codes.forEach((c, i) => this.maps[c].set(r[0], r[i + 1])));
    let saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (e) { const m = /mf-lang=(\w\w)/.exec(window.name); saved = m && m[1]; }
    if (!saved && APP_CFG.defaultLang) saved = APP_CFG.defaultLang;
    if (!saved) { const nav = (navigator.language || 'en').slice(0, 2).toLowerCase(); saved = LANGS.some(l => l.code === nav) ? nav : 'en'; }
    this.set(saved, true);
  },
  save(code) { try { localStorage.setItem(LANG_KEY, code); } catch (e) { window.name = String(window.name).replace(/mf-lang=\w\w/, '') + ' mf-lang=' + code; } },
  set(code, silent) {
    const L = LANGS.find(l => l.code === code) || LANGS[0];
    this.lang = L.code; this.locale = L.locale; this.cache = {}; document.documentElement.lang = L.code;
    this.localeNames();
    if (!silent) { this.save(L.code); }
  },
  localeNames() {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    for (let m = 0; m < 12; m++) MONTHS[m] = cap(new Date(2023, m, 1).toLocaleDateString(this.locale, { month: 'long' }));
    for (let d = 0; d < 7; d++) { const sh = new Date(2023, 0, 1 + d).toLocaleDateString(this.locale, { weekday: 'short' }).replace(/\.$/, ''); DAYS3[d] = cap(sh).slice(0, 3); DAYS2[d] = cap(sh).slice(0, 2); }
    for (let d = 0; d < 7; d++) DAYN[d] = cap(new Date(2023, 0, 1 + d).toLocaleDateString(this.locale, { weekday: 'long' }));
  },
  tr(s) {
    if (this.lang === 'en' || !s) return s;
    const c = this.cache; if (s in c) return c[s];
    if (this.maps[this.lang].has(s)) return c[s] = this.maps[this.lang].get(s);
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
    let out = core ? this.core(core, s) : s;
    if (out !== core) out = lead + out + trail; else out = s;
    return c[s] = out;
  },
  core(core, full) {
    const i = ['de', 'fr', 'es', 'it', 'ro'].indexOf(this.lang), map = this.maps[this.lang];
    if (map.has(core)) return map.get(core);
    for (const [re, t] of I18N_PATS) { const m = re.exec(core); if (m) return t[i].replace(/\$(\d)/g, (_, n) => this.tr(m[+n])); }
    if (core.startsWith('↳ ')) { const x = this.tr(core.slice(2)); if (x !== core.slice(2)) return '↳ ' + x; }
    if (core.startsWith('↻ ')) { const x = this.tr(core.slice(2)); if (x !== core.slice(2)) return '↻ ' + x; }
    if (core === core.toUpperCase() && /[A-Z]{3,}/.test(core)) { const up = this.up || (this.up = {}); if (!up[this.lang]) { const m = up[this.lang] = new Map(); for (const [k, v] of map) m.set(k.toUpperCase(), v.toUpperCase()); } if (up[this.lang].has(core)) return up[this.lang].get(core); const parts = core.split(' · '); if (parts.length > 1) { const t = parts.map(p => up[this.lang].get(p) || this.tr(p)); if (t.some((x, k) => x !== parts[k])) return t.join(' · '); } }
    if (core.includes(' · ')) { const parts = core.split(' · '), t = parts.map(p => this.tr(p)); if (t.some((x, k) => x !== parts[k])) return t.join(' · '); }
    if (core.endsWith(':')) { const x = this.tr(core.slice(0, -1)); if (x !== core.slice(0, -1)) return x + ':'; }
    return core;
  },
  /* ---- DOM translation ---- */
  skip(n) { const p = n.parentNode; return !p || /^(SCRIPT|STYLE|TEXTAREA|CODE)$/.test(p.nodeName) || !!(p.closest && p.closest('.notr')); },
  text(n) {
    if (this.skip(n)) return;
    if (n._tr !== undefined && n.nodeValue === n._tr) { const v = this.tr(n._en); if (v !== n.nodeValue) { n.nodeValue = v; } n._tr = v; return; }
    n._en = n.nodeValue; const v = this.tr(n._en); n._tr = v; if (v !== n.nodeValue) n.nodeValue = v;
  },
  attrs(el) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      if (!el.hasAttribute(a)) continue; const store = el._ia || (el._ia = {}), cur = el.getAttribute(a), st = store[a];
      const en = st && st.tr === cur ? st.en : cur, v = this.tr(en); store[a] = { en, tr: v }; if (v !== cur) el.setAttribute(a, v);
    }
  },
  apply(root) {
    root = root || document.body;
    if (root.nodeType === 3) return this.text(root);
    if (root.nodeType !== 1) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) this.text(n);
    if (root.matches && root.matches('[title],[placeholder],[aria-label]')) this.attrs(root);
    root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(e => this.attrs(e));
  },
  observe() {
    this.mo = new MutationObserver(recs => {
      this.mo.disconnect();
      try {
        for (const r of recs) {
          if (r.type === 'childList') r.addedNodes.forEach(n => this.apply(n));
          else if (r.type === 'characterData') this.text(r.target);
          else if (r.type === 'attributes') this.attrs(r.target);
        }
      } finally { this.mo.observe(document.body, this.cfg); }
    });
    this.cfg = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] };
    this.mo.observe(document.body, this.cfg);
  }
};
const tr = s => I18N.tr(s);
const ask = msg => confirm(tr(msg));
const flagSvg = (code, w = 28) => {
  const h_ = Math.round(w * 2 / 3), id = 'fc' + code + w + Math.floor(Math.random() * 1e5);
  const bands = { de: ['h', ['#000000', '#dd0000', '#ffce00']], fr: ['v', ['#0055a4', '#ffffff', '#ef4135']], it: ['v', ['#009246', '#ffffff', '#ce2b37']], ro: ['v', ['#002b7f', '#fcd116', '#ce1126']], es: ['h', ['#aa151b', '#f1bf00', '#aa151b'], [1, 2, 1]] }[code];
  let body = '';
  if (code === 'en') {
    const sh = 40 / 13;
    for (let k = 0; k < 13; k++) body += `<rect x="0" y="${(k * sh).toFixed(3)}" width="60" height="${(sh + .06).toFixed(3)}" fill="${k % 2 ? '#ffffff' : '#bf0a30'}"/>`;
    body += `<rect x="0" y="0" width="26" height="${(sh * 7).toFixed(3)}" fill="#002868"/>`;
    for (let r = 0; r < 9; r++) { const n = r % 2 ? 5 : 6, x0 = r % 2 ? 4.3 : 2.2; for (let c = 0; c < n; c++) body += `<circle cx="${(x0 + c * 4.2).toFixed(2)}" cy="${(1.9 + r * 2.3).toFixed(2)}" r=".95" fill="#ffffff"/>`; }
  } else {
    const [dir, cols, wts] = bands, ws = wts || [1, 1, 1], tot = ws.reduce((a, b) => a + b, 0); let off = 0;
    cols.forEach((c, k) => { const sz = ws[k] / tot * (dir === 'h' ? 40 : 60); body += dir === 'h' ? `<rect x="0" y="${off.toFixed(3)}" width="60" height="${(sz + .06).toFixed(3)}" fill="${c}"/>` : `<rect x="${off.toFixed(3)}" y="0" width="${(sz + .06).toFixed(3)}" height="40" fill="${c}"/>`; off += sz; });
  }
  return `<svg viewBox="0 0 60 40" width="${w}" height="${h_}" shape-rendering="geometricPrecision" style="flex:none;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.28))"><defs><clipPath id="${id}"><rect width="60" height="40" rx="5"/></clipPath><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs><g clip-path="url(#${id})">${body}<rect width="60" height="40" fill="url(#${id}g)"/></g><rect x=".5" y=".5" width="59" height="39" rx="4.6" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/></svg>`;
};
function langMenu(pop) {
  pop.replaceChildren(h('div', { class: 'up', style: { marginBottom: '8px' } }, 'Choose your country'),
    h('div', { class: 'tl' }, LANGS.map(l => h('div', { class: 'ti' + (I18N.lang === l.code ? ' lang-on' : ''), style: { '--c': 'var(--accent)', borderLeftColor: I18N.lang === l.code ? 'var(--accent)' : 'transparent' }, onclick: () => { I18N.set(l.code); pop.classList.remove('on'); App.render(); I18N.apply(); langBtnUpdate(); } },
      h('span', { style: { display: 'inline-flex' }, html: flagSvg(l.code, 46) }), h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'nm' }, l.name), h('div', { class: 'sub' }, l.country)), I18N.lang === l.code ? icon('check', 16) : null))));
  I18N.apply(pop); pop.classList.toggle('on');
}
function langBtnUpdate() { const b = $('#langBtn'); if (b) { b.innerHTML = flagSvg(I18N.lang, 36) + '<span style="font:800 11px var(--font);letter-spacing:.08em">' + I18N.lang.toUpperCase() + '</span>'; b.title = LANGS.find(l => l.code === I18N.lang).name; } }
