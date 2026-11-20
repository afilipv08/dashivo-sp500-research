'use strict';
/* ================= DESIGNS (themes) =================
   Each design = CSS variable set in styles.css (`html[data-theme=<id>]`) + chart palette + preview swatch.
   To add a design: add an entry here and a matching `html[data-theme=<id>]{...}` block in styles.css. */
const THEME_KEY = 'dashivo-theme';
const DEFAULT_THEME = 'dashivo';
const TH = { accent: '#c8000a', accent2: '#9e0008', accent3: '#e5484f', good: '#2b8a4b', rgb: '200,0,10' };   // refreshed from CSS on every theme change
const THEMES = [
  { id: 'dashivo', name: 'Dashivo Red', desc: 'Brand red menu · clean white cards',
    sw: { bg: '#f6f4f2', side: '#c8000a', card: '#ffffff', tiles: ['#c8000a', '#1f1517', '#e5484f', '#8c8082'] },
    chart: ['#c8000a', '#1f1517', '#e5484f', '#8c8082', '#2b8a4b', '#2f6fb8', '#b7791f', '#7b52b8'] },
  { id: 'midnight', name: 'Midnight Orange', desc: 'Dark navy · orange accent',
    sw: { bg: '#0f0e0f', side: '#111a22', card: '#15202a', tiles: ['#fc9751', '#d9703f', '#b3a597', '#5b6470'] },
    chart: ['#fc9751', '#d9703f', '#b3a597', '#5b6470', '#3ecf8e', '#58a6ff', '#b07cff', '#f5c451'] },
  { id: 'cream', name: 'Cream Pastel', desc: 'Warm cream · pastel tiles · black menu',
    sw: { bg: '#fbf3e6', side: '#1d1b19', card: '#f2eadc', tiles: ['#f4bfdf', '#a3b56a', '#f4d96a', '#b9cbee'] },
    chart: ['#e48fc0', '#8fa352', '#e9c545', '#7f9fdc', '#c9a98a', '#6b7280', '#9b6fd0', '#3ecf8e'] }
];
const Theme = {
  id: DEFAULT_THEME,
  init() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { const m = /mf-theme=(\w+)/.exec(window.name); saved = m && m[1]; }
    this.set(THEMES.some(t => t.id === saved) ? saved : DEFAULT_THEME, true);
  },
  save(id) { try { localStorage.setItem(THEME_KEY, id); } catch (e) { window.name = String(window.name).replace(/mf-theme=\w+/, '') + ' mf-theme=' + id; } },
  set(id, silent) {
    const t = THEMES.find(x => x.id === id) || THEMES[0]; this.id = t.id;
    document.documentElement.dataset.theme = t.id;
    CHART_COLORS.splice(0, CHART_COLORS.length, ...t.chart);
    const cs = getComputedStyle(document.documentElement), g = k => cs.getPropertyValue(k).trim();
    TH.accent = g('--accent') || TH.accent; TH.accent2 = g('--accent2') || TH.accent2; TH.rgb = g('--accent-rgb') || TH.rgb; TH.accent3 = g('--accent3') || TH.accent3; TH.good = g('--good') || TH.good;
    if (!silent) this.save(t.id);
  },
  preview(t) {
    return h('span', { class: 'th-prev', style: { background: t.sw.bg } },
      h('i', { class: 's', style: { background: t.sw.side } }),
      h('span', { class: 'm' }, t.sw.tiles.map(c => h('i', { style: { background: c } }))));
  }
};
function themeMenu(pop) {
  pop.replaceChildren(h('div', { class: 'up', style: { marginBottom: '8px' } }, 'Choose your design'),
    h('div', { class: 'tl' }, THEMES.map(t => h('div', { class: 'ti' + (Theme.id === t.id ? ' th-on' : ''), style: { '--c': 'var(--accent)', borderLeftColor: Theme.id === t.id ? 'var(--accent)' : 'transparent' },
      onclick: () => { Theme.set(t.id); pop.classList.remove('on'); App.render(); I18N.apply(); } },
      Theme.preview(t), h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'nm' }, t.name), h('div', { class: 'sub' }, t.desc)), Theme.id === t.id ? icon('check', 16) : null))));
  I18N.apply(pop); pop.classList.toggle('on');
}

/* brand image: red wordmark for light tiles + white wordmark for the red menu (CSS picks one per design) */
const brandImg = (cls = '') => [h('img', { class: 'logo-red ' + cls, src: LOGO_SRC, alt: 'Dashivo', draggable: 'false' }), h('img', { class: 'logo-white ' + cls, src: LOGO_WHITE, alt: 'Dashivo', draggable: 'false' })];

Object.assign(ICONS, { palette: '<circle cx="13.5" cy="6.5" r="1.1"/><circle cx="17.5" cy="10.5" r="1.1"/><circle cx="8.5" cy="7.5" r="1.1"/><circle cx="6.5" cy="12.5" r="1.1"/><path d="M12 2a10 10 0 100 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.7 4.7 0 0022 10.7C22 5.8 17.5 2 12 2z"/>' });
