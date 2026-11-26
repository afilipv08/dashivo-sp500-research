'use strict';
/* ================= Contents: platforms, what each can answer, and open-source projects ================= */
/* status: 'use' = feeds the dashboard now, 'link' = linked only, 'cand' = candidate, 'local' = installed on the owner's PC.
   Limits come from each provider's own pages (checked 25–26.11.2026) or from this project's own use; they can change. */
const SOURCE_STATUS = { use: 'In use', link: 'Link only', cand: 'Candidate', local: 'Installed on this PC' };
const SOURCE_ROWS = [
  ['Yahoo Finance (yfinance)', 'https://finance.yahoo.com/', 'use', 'Free, unofficial, throttled on cloud runners.', 'Prices, analyst ratings and targets, 52-week range, price history.'],
  ['SEC EDGAR Company Facts', 'https://www.sec.gov/edgar/sec-api-documentation', 'use', 'Free; fair-access limit of 10 requests per second and a contact header.', 'Filing-based inputs for the DCF, Graham Number and dividend methods.'],
  ['Equity Rank', 'https://www.equity-rank.com/', 'use', 'Free public dataset.', 'Fair-value estimate and Fundamental Strength score.'],
  ['Zyberno', 'https://zyberno.com/brina-gap/', 'use', 'Free, CC BY 4.0 (attribution required).', 'Trailing-twelve-month fundamentals, ROE, ROIC and intrinsic value.'],
  ['Fair Value Calculator', 'https://www.fairvalue-calculator.com/', 'use', 'Free official SVG badge per ticker.', 'A second per-share fair-value opinion.'],
  ['CoinGecko · alternative.me · Bitstamp', 'https://www.coingecko.com/', 'use', 'Free public APIs with rate limits.', 'Crypto prices, Fear & Greed, Bitcoin history and cycles.'],
  ['eToro', 'https://www.etoro.com/', 'link', 'The API needs personal keys, no analyst-forecast endpoint was found and public reuse is not confirmed.', 'Analyst Forecast on its asset pages (opened by link).'],
  ['FRED (St. Louis Fed)', 'https://fred.stlouisfed.org/', 'cand', 'Free API key (listed as free and optional by TradingAgents).', 'Interest rates, inflation and other macro series for rate-sensitivity checks.'],
  ['Alpha Vantage', 'https://www.alphavantage.co/', 'cand', 'Free key: 25 requests per day, 5 per minute.', 'Fundamentals, indicators and news sentiment for a few stocks a day.'],
  ['Finnhub', 'https://finnhub.io/', 'cand', 'Free key: 60 calls per minute; many endpoints are premium.', 'Quotes, basic financials, insider transactions and company news.'],
  ['Financial Modeling Prep', 'https://site.financialmodelingprep.com/', 'cand', 'Free Basic plan: 250 calls per day; displaying or redistributing data needs a licence.', 'Statements and ratios for private use only, not for this public site.'],
  ['TradingAgents', 'https://github.com/TauricResearch/TradingAgents', 'local', 'Open source; runs on your own AI account.', 'Multi-agent analysis with a rating and summary (AI agents page).'],
  ['OpenBB Platform', 'https://github.com/OpenBB-finance/OpenBB', 'cand', 'Open source (Apache-2.0 in v5); not installed here.', 'Connectors to many data providers and research tools.'],
  ['Vibe-Trading · freqtrade', 'https://github.com/HKUDS/Vibe-Trading', 'local', 'Open source; found on this PC, not evaluated or integrated.', 'Trading research and crypto bot tooling.']
];
const SOURCE_ANSWERS = [
  ['Is it cheap or expensive?', 'Compare the price with several fair-value estimates and filing-based methods.', 'intrinsic', 'Intrinsic value'],
  ['Is the business good?', 'Margins, ROE, ROIC, free cash flow and the Fundamental Strength score.', 'fundamental', 'Fundamental analysis'],
  ['Is the trend with us?', 'Moving averages, RSI, MACD and momentum from daily closes.', 'technical', 'Technical analysis'],
  ['What do analysts and AI agents say?', 'Consensus, targets, rating changes and the local multi-agent conclusion.', 'ai', 'AI analysis'],
  ['Is the macro backdrop a risk?', 'Needs a macro source such as FRED (candidate, not connected yet).', null, null]
];
Views.sources = () => {
  const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'sp-tbl src-tbl' },
    h('thead', null, h('tr', null, ['Platform', 'Status', 'Free access and limits', 'Useful for'].map(x => h('th', null, tr(x))))),
    h('tbody', null, SOURCE_ROWS.map(([name, url, status, free, gives]) => h('tr', null,
      h('td', null, ivLink(name, url)), h('td', null, h('span', { class: 'tech-verdict src-' + status }, tr(SOURCE_STATUS[status]))),
      h('td', { class: 'tech-sum src-free' }, tr(free)), h('td', { class: 'tech-sum src-free' }, tr(gives)))))));
  const answers = h('div', { class: 'iv-guide src-answers' }, SOURCE_ANSWERS.map(([q, a, route, page]) => h('article', { class: 'iv-guide-item' },
    h('b', null, tr(q)), h('p', null, tr(a)), route ? h('a', { href: '#/' + route, onclick: e => { e.preventDefault(); App.go(route); } }, tr(page) + ' →') : h('small', null, tr('Not connected yet')))));
  return h('div', null,
    card('Sources and analyses', 'Where the data comes from, what each platform allows for free, and which question each page answers. Limits are the providers\' own and can change.', table, null, 'c12'),
    card('What you can conclude', 'Each question below is answered by a page of this dashboard.', answers, null, 'c12'),
    card('Rules for adding a source', null, h('ul', { class: 'src-rules' },
      h('li', null, tr('Free tier first; check the provider\'s terms before showing its data on the public site (the repository and Pages are public).')),
      h('li', null, tr('Keys and account details stay in GitHub Actions secrets or on this PC, never in the page or the repository.')),
      h('li', null, tr('Missing data is shown as unavailable, never estimated.'))), null, 'c12'),
    h('p', { class: 'muted small mt' }, tr('Indicative, checked on the providers\' own pages on 25–26.11.2026; confirm limits before relying on them. Not investment advice.')));
};
