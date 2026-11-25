'use strict';
/* ---------- official eToro links for the current filtered Top 10 ---------- */
const ETORO_SLUG_ALIASES = { 'BF.B': 'bf-b', 'BF-B': 'bf-b', 'BRK.B': 'brk.b', 'BRK-B': 'brk.b' };
function etoroAssetUrl(symbol) {
  const ticker = String(symbol || '').trim().toUpperCase();
  const slug = ETORO_SLUG_ALIASES[ticker] || ticker.toLowerCase();
  return 'https://www.etoro.com/markets/' + encodeURIComponent(slug);
}
function etoroOpenLink(stock) {
  return h('a', { class: 'etoro-open', href: etoroAssetUrl(stock.symbol), target: '_blank', rel: 'noopener noreferrer',
    'aria-label': stock.symbol + ' · eToro' }, tr('Open eToro page') + ' ↗');
}
Views.etoro = () => {
  const selected = selection(), top = selected ? ranked(selected).slice(0, 10) : [];
  const body = !selected ? h('div', { class: 'empty' }, tr('Correct the active filters before viewing the Top 10.'))
    : !top.length ? h('div', { class: 'empty' }, tr('No ranked stocks in the active selection.'))
      : h('div', { class: 'etoro-table-wrap' }, h('table', { class: 'etoro-table' },
        h('thead', null, h('tr', null, h('th', null, tr('Stock')), h('th', null, tr('eToro page')), h('th', null, tr('Where to look')))),
        h('tbody', null, top.map(stock => h('tr', null,
          h('td', null, h('b', { class: 'etoro-ticker notr' }, stock.symbol), h('small', { class: 'etoro-company' }, stock.company)),
          h('td', null, etoroOpenLink(stock)),
          h('td', null, h('span', null, tr('Overview → Analyst Forecast')),
            h('small', { class: 'etoro-detail' }, tr('Analysis tab for more details'))))))));
  return h('div', null, card('eToro · current Top 10', 'The active filters and ranking determine these stocks.',
    h('div', null,
      h('p', { class: 'etoro-intro' }, tr('Open each stock’s official eToro page to review its analyst research.')),
      h('div', { class: 'etoro-note' }, tr('Analyst consensus is not a guaranteed prediction or investment advice.'), ' ',
        tr('This page links to eToro only. It does not copy forecasts or import eToro data.')),
      body), null, 'c12'));
};
