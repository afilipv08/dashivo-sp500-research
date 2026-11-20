'use strict';
/* ================= SHELL: collapsible menu · accounts (multi-user) · backup =================
   Shared by every Dashivo app. Each app's core.js defines APP_CFG = { slug, required:[keys], blank(), reset() }. */
Object.assign(ICONS, {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>'
});

/* ---- left menu: hide / show (desktop = collapse, phone = off-canvas) ---- */
const SIDE_KEY = 'dashivo-side-hidden';
function initSide() { let v = false; try { v = localStorage.getItem(SIDE_KEY) === '1'; } catch (e) { v = /side-hidden/.test(window.name); } document.body.classList.toggle('side-hidden', v); }
function toggleSide() {
  if (innerWidth <= 960) { $('#side').classList.toggle('on'); return; }
  const on = document.body.classList.toggle('side-hidden');
  try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch (e) { window.name = String(window.name).replace(/\s?side-hidden/, '') + (on ? ' side-hidden' : ''); }
  setTimeout(() => dispatchEvent(new Event('resize')), 60);
}

/* ---- export file names: DD.MM.YYYY_hh-mmAM_AppName[_part].ext  (":" is not allowed in file names, so 10:35PM becomes 10-35PM) ---- */
function fileStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0'), h12 = d.getHours() % 12 || 12;
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}_${p(h12)}-${p(d.getMinutes())}${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}
function fileName(part, ext) {
  const clean = String(part || '').replace(/\.(csv|json)$/i, '').replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
  return `${fileStamp()}_${APP_CFG.title}${clean ? '_' + clean : ''}.${ext}`;
}

