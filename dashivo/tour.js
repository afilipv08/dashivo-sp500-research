'use strict';
/* ================= INTERACTIVE TOUR ================= */
/* TOUR_KEY and TOUR_STEPS are defined by the app (see web/tour_steps.js). */
const Tour = {
  i: 0, active: false, startRoute: null,
  seen() { try { return localStorage.getItem(TOUR_KEY) === 'done'; } catch (e) { return String(window.name).includes(TOUR_KEY); } },
  mark() { try { localStorage.setItem(TOUR_KEY, 'done'); } catch (e) { if (!String(window.name).includes(TOUR_KEY)) window.name += ' ' + TOUR_KEY; } },
  maybeStart() { if (!this.seen()) setTimeout(() => { if (!this.active) this.start(); }, 700); },
  start() {
    if (this.active) return; this.active = true; this.i = 0; this.startRoute = App.route();
    closePalette();
    this.root = h('div', { id: 'tour' }, h('div', { class: 'tour-shield' }), this.spot = h('div', { class: 'tour-spot' }), this.tip = h('div', { class: 'tour-tip' }));
    document.body.append(this.root);
    this._key = e => { if (!this.active) return; if (e.key === 'Escape') this.end(true); else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); this.go(1); } else if (e.key === 'ArrowLeft') this.go(-1); };
    this._rs = debounce(() => this.show(), 120);
    addEventListener('keydown', this._key, true); addEventListener('resize', this._rs);
    this.show();
  },
  go(d) { const n = this.i + d; if (n < 0) return; if (n >= TOUR_STEPS.length) return this.end(false); this.i = n; this.show(); },
  async show() {
    const s = TOUR_STEPS[this.i], total = TOUR_STEPS.length;
    if (s.route && App.route() !== s.route) { App.go(s.route); await new Promise(r => setTimeout(r, 180)); }
    const side = $('#side'); if (s.side) document.body.classList.remove('side-hidden'); if (innerWidth <= 960) side.classList.toggle('on', !!s.side); else side.classList.remove('on');
    if (!this.active) return;
    const el = s.sel ? $(s.sel) : null, vis = el && el.getClientRects().length;
    if (vis && !s.side) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise(r => setTimeout(r, 60)); }
    const t = this.tip; t.innerHTML = '';
    const prog = h('div', { class: 'tour-bar' }, h('i', { style: { width: (this.i + 1) / total * 100 + '%' } }));
    const nextBtn = btn(s.welcome ? 'Start the tour' : s.last ? 'Finish' : 'Next', s.last ? 'check' : null, () => this.go(1), 'pri sm');
    add(t, [prog,
      h('div', { class: 'tour-step' }, s.welcome ? 'Welcome' : `Step ${this.i} of ${total - 1}`),
      s.welcome && h('div', { class: 'tour-logo' }, h('img', { src: LOGO_SRC, alt: 'Dashivo' })),
      h('h3', null, s.title), h('p', null, s.text),
      h('div', { class: 'tour-act' },
        s.last ? null : h('button', { class: 'tour-skip', onclick: () => this.end(true) }, s.welcome ? 'Skip, I’ll explore myself' : 'Skip tour'),
        h('span', { class: 'sp' }), this.i > 0 && btn('Back', 'left', () => this.go(-1), 'sm ghost'), nextBtn)]);
    nextBtn.focus({ preventScroll: true });
    const sp = this.spot, shield = this.root.firstChild;
    if (vis) {
      const r = el.getBoundingClientRect(), pad = 8;
      const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(innerWidth - x - 4, r.width + pad * 2), hh = Math.min(innerHeight - y - 4, r.height + pad * 2);
      Object.assign(sp.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' }); shield.style.background = 'transparent';
      t.classList.remove('center'); t.style.left = t.style.top = '0'; t.style.transform = 'none';
      const tw = Math.min(360, innerWidth - 24); t.style.width = tw + 'px'; const th = t.offsetHeight; let tx, ty;
      const place = innerWidth < 700 ? 'auto' : s.place;
      if (place === 'right' && x + w + tw + 20 < innerWidth) { tx = x + w + 14; ty = y + 10; }
      else if ((place === 'bottom' || place === 'auto') && y + hh + th + 20 < innerHeight) { tx = x; ty = y + hh + 14; }
      else if (place === 'top' && y - th - 20 > 0) { tx = x; ty = y - th - 14; }
      else if (y + hh + th + 20 < innerHeight) { tx = x; ty = y + hh + 14; }
      else if (y - th - 20 > 0) { tx = x; ty = y - th - 14; }
      else { tx = x + 20; ty = Math.max(12, innerHeight - th - 20); }
      t.style.left = clamp(tx, 12, innerWidth - tw - 12) + 'px'; t.style.top = clamp(ty, 12, innerHeight - th - 12) + 'px';
    } else {
      sp.style.display = 'none'; shield.style.background = 'rgba(4,6,9,.78)'; t.classList.add('center'); t.style.width = Math.min(440, innerWidth - 24) + 'px'; t.style.left = '50%'; t.style.top = '50%'; t.style.transform = 'translate(-50%,-50%)';
    }
  },
  end(skipped) {
    if (!this.active) return; this.active = false; this.mark();
    removeEventListener('keydown', this._key, true); removeEventListener('resize', this._rs); this.root.remove(); $('#side').classList.remove('on');
    App.go(App.home); toast(skipped ? 'Tour skipped. Replay it anytime with the ? button' : 'Tour complete. Enjoy!');
  }
};
