'use strict';
/* ================= AI analysis: a prompt per Top 10 stock, opened in the user's AI assistant ================= */
const AI_KEY = 'dashivo-sp500-ai';
const DEFAULT_PROMPT = 'Acționează ca un investitor cu peste 20 de ani experiența, folosește date relevante si analizează-mi compania aceasta {TICKER} ({COMPANY}). Eu vreau sa primesc strict concluziile -> merita investită da sau nu, unde se poate duce prețul in minime de cât si cât sau maxime de cât si cât si șanse probabilistice -> mai vreau sa îmi zici top investitorii la nivel mondial ce părerea au de acest business al acestei companii';
/* assistants that accept a prefilled prompt in the URL; Gemini has none, so it gets the clipboard only */
const ASSISTANTS = {
  chatgpt: { name: 'ChatGPT', url: q => 'https://chatgpt.com/?q=' + encodeURIComponent(q) },
  claude: { name: 'Claude', url: q => 'https://claude.ai/new?q=' + encodeURIComponent(q) },
  perplexity: { name: 'Perplexity', url: q => 'https://www.perplexity.ai/search?q=' + encodeURIComponent(q) },
  grok: { name: 'Grok', url: q => 'https://grok.com/?q=' + encodeURIComponent(q) },
  gemini: { name: 'Gemini', url: () => 'https://gemini.google.com/app', clipboardOnly: true }
};
const AI = Object.assign({ prompt: DEFAULT_PROMPT, assistant: 'chatgpt', withData: true }, store.get(AI_KEY, {}) || {});
if (!ASSISTANTS[AI.assistant]) AI.assistant = 'chatgpt';
if (typeof AI.prompt !== 'string' || !AI.prompt.trim()) AI.prompt = DEFAULT_PROMPT;
const saveAI = () => store.set(AI_KEY, { prompt: AI.prompt, assistant: AI.assistant, withData: AI.withData });

/* the data block is part of the prompt, so it follows the prompt's language (Romanian), not the UI language */
function promptData(r) {
  const n = v => num(v) ? v.toLocaleString('ro-RO', { maximumFractionDigits: 2 }) : 'n/a';
  const p = v => num(v) ? (v * 100).toLocaleString('ro-RO', { maximumFractionDigits: 1 }) + '%' : 'n/a';
  const live = LIVE.prices[r.symbol];
  return ['', '', `Date din raportul meu (${DATA.sourceDate}, Yahoo Finance):`,
    `- Preț în raport: $${n(r.price)}` + (num(live) ? `; preț live: $${n(live)}` : ''),
    `- Minim / maxim 52 săptămâni: $${n(r.low)} / $${n(r['Max.'])}; distanța față de minim: ${p(r.distance)}`,
    `- Ținte analiști: minimă $${n(r.minTarget)}, medie $${n(r.meanTarget)}, maximă $${n(r.maxTarget)}; potențial către ținta medie: ${p(r.upside)}`,
    `- Recomandări (${n(r.total)} analiști): Strong Buy ${n(r.sb)}, Buy ${n(r.buy)}, Hold ${n(r.hold)}, Underperform ${n(r.under)}, Sell ${n(r.sell)}; consens: ${r.Consens ?? 'n/a'}`,
    `- Sector: ${r.sector}; ultima recomandare: ${r['Latest Rating - Date'] ?? 'n/a'} · ${r['Latest Rating - Rating'] ?? 'n/a'}`].join('\n');
}
const buildPrompt = r => AI.prompt.replaceAll('{TICKER}', r.symbol).replaceAll('{COMPANY}', r.company) + (AI.withData ? promptData(r) : '');

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }); t.value = text; document.body.append(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}
/* opens the tab first (still inside the click), then copies the prompt as a backup */
function launchPrompt(r) {
  const a = ASSISTANTS[AI.assistant], text = buildPrompt(r);
  window.open(a.url(text), '_blank', 'noopener');
  copyText(text).then(ok => toast(a.clipboardOnly ? (ok ? 'Prompt copied. Paste it in Gemini.' : 'Copy failed') : ok ? 'Prompt sent and copied to the clipboard' : 'Prompt sent'));
}

/* ---------- phone access (only shown on the computer, in phone mode) ---------- */
function phoneCard() {
  if (window.dashboardStatic) return null;   // the online version is already reachable from the phone
  const lan = window.dashboardLan;
  if (!lan) return card('Phone access', 'Open the dashboard on your phone, in the same Wi-Fi network', h('p', { class: 'muted' }, 'Start the dashboard with run_dashboard_telefon.bat to use it on your phone. The normal start stays reachable only from this computer.'), null, 'c12');
  const qr = h('div', { class: 'qr' });
  try { const q = qrcode(0, 'M'); q.addData(lan.url); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { qr.textContent = lan.url; }
  return card('Phone access', 'Same Wi-Fi network as this computer', h('div', { class: 'phone-grid' }, qr,
    h('div', null,
      h('div', { class: 'phone-steps' }, h('div', null, h('b', null, '1. '), h('span', null, 'Scan the code with the phone camera, or type the address:')), h('div', { class: 'notr' }, h('b', { class: 'big-url' }, lan.url)),
        h('div', null, h('b', null, '2. '), h('span', null, 'Enter the PIN:')), h('div', { class: 'notr' }, h('b', { class: 'big-pin' }, lan.pin.replace(/(\d{3})(\d{3})/, '$1 $2')))),
      h('p', { class: 'muted small' }, 'The PIN changes every time the dashboard starts. The phone stays signed in until then. If the page does not open, allow Python for private networks in the Windows firewall. From outside home use a VPN such as Tailscale; do not open the router.'))), null, 'c12');
}

/* ---------- Settings page ---------- */
Views.settings = () => {
  const area = h('textarea', { class: 'ta prompt-ta', id: 'aiPrompt', rows: 9 }); area.value = AI.prompt;
  const preview = h('pre', { class: 'prompt-preview notr', id: 'aiPreview' });
  const sample = ranked(selection() || [])[0] || universe()[0];
  const refresh = () => { preview.textContent = sample ? buildPrompt(sample) : AI.prompt; };
  area.addEventListener('input', () => { AI.prompt = area.value.trim() ? area.value : DEFAULT_PROMPT; saveAI(); refresh(); });
  const pick = selectEl(Object.entries(ASSISTANTS).map(([k, a]) => [k, a.name]), AI.assistant, v => { AI.assistant = v; saveAI(); }); pick.id = 'aiAssistant';
  const data = h('input', { type: 'checkbox', class: 'ck', id: 'aiWithData' }); data.checked = AI.withData;
  data.addEventListener('change', () => { AI.withData = data.checked; saveAI(); refresh(); });
  refresh();
  return h('div', { class: 'grid' }, phoneCard(),
    card('AI analysis prompt', 'Used by the buttons on the AI analysis page. {TICKER} and {COMPANY} are replaced for each stock.', h('div', null,
      area,
      h('div', { class: 'row mt' }, field('AI assistant', pick),
        h('label', { class: 'row ck-row', for: 'aiWithData' }, data, h('span', null, 'Add the report data (price, 52-week range, targets, recommendations)')),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn', id: 'aiReset', onclick: () => { AI.prompt = DEFAULT_PROMPT; saveAI(); App.render(); toast('Default prompt restored'); } }, 'Restore default prompt')),
      h('p', { class: 'muted small' }, 'ChatGPT, Claude and Perplexity open with the prompt already filled in; Gemini cannot receive it in the link, so the prompt is copied and you paste it. The prompt is always copied to the clipboard as well.')), null, 'c7'),
    card('Preview', sample ? h('span', null, 'Example for', ' ', h('b', { class: 'notr' }, sample.symbol)) : null, preview, null, 'c5'));
};

/* ---------- AI analysis page: the current Top 10 ---------- */
Views.ai = () => {
  const sel = selection();
  if (!sel) return card(null, null, h('div', { class: 'empty' }, 'Enter valid non-negative thresholds; analyst and recommendation counts must be integers.'));
  const top = ranked(sel).slice(0, 10), a = ASSISTANTS[AI.assistant];
  const row = (r, i) => {
    const live = LIVE.prices[r.symbol];
    return h('div', { class: 'ai-row' },
      h('span', { class: 'rk' }, i + 1), logoEl(r.symbol, 32),
      h('div', { class: 'ai-id' }, h('b', { class: 'notr' }, r.symbol), h('div', { class: 'muted small notr' }, r.company + ' · ' + r.sector)),
      h('div', { class: 'ai-num' }, h('small', null, 'Report price'), h('b', { class: 'notr' }, usd(r.price))),
      h('div', { class: 'ai-num' }, h('small', null, 'Live price'), h('b', { class: 'notr' }, num(live) ? usd(live) : '—')),
      h('div', { class: 'ai-num' }, h('small', null, 'Min. target proximity'), h('b', { class: 'notr' }, pctf(r.gap))),
      h('div', { class: 'ai-num' }, h('small', null, 'Upside to mean target'), h('b', { class: 'notr ' + (r.upside < 0 ? 'negative' : 'positive') }, pctf(r.upside))),
      h('div', { class: 'ai-num' }, h('small', null, 'Buy + Strong Buy'), h('b', { class: 'notr' }, pctf(r.support))),
      h('div', { class: 'ai-act' },
        h('button', { class: 'btn pri sm ai-go', onclick: () => launchPrompt(r) }, icon('spark', 14), h('span', null, tr('Analyze with') + ' ' + a.name)),
        h('button', { class: 'btn sm', title: 'Copy prompt', onclick: () => copyText(buildPrompt(r)).then(ok => toast(ok ? 'Prompt copied' : 'Copy failed')) }, icon('copy', 14))));
  };
  return h('div', null,
    card('AI analysis · Top 10', h('span', null, 'Same stocks and order as Top 10 [filtered]', ' (', RANKINGS[UI.ranking].label, ').'),
      top.length ? h('div', { class: 'ai-list' }, top.map(row)) : h('div', { class: 'empty' }, 'No valid ranking values.'),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Assistant'), h('b', { class: 'notr' }, a.name), btn('Prompt settings', 'cog', () => App.go('settings'), 'sm'))),
    h('p', { class: 'muted small mt' }, 'AI answers are opinions, not investment advice. Check the figures before investing, even in the demo portfolio.'));
};
