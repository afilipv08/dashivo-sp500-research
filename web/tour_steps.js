'use strict';
/* First-run tour (engine: dashivo/tour.js). Selectors point at real elements of each page. */
const TOUR_STEPS = [
  { title: 'Welcome to Dashivo SP500 Research', text: 'Run the S&P 500 research, filter the results and compare price with analyst targets. This 1-minute tour shows you around. You can skip it at any time.', welcome: true },
  { route: 'overview', sel: '#side .nav', side: true, place: 'right', title: 'Your navigation', text: 'Every page lives here: overview, research, Top 10 & filters, the filtered list, the full SP500 list and the methodology. The numbers show how many stocks each list holds.' },
  { route: 'overview', sel: '#topRun', place: 'bottom', title: 'Run the research', text: 'Starts the Python program: it downloads Yahoo Finance data for every S&P 500 stock, builds the Excel and loads it here. A progress bar shows how many stocks have been analyzed.' },
  { route: 'overview', sel: '#top .search', place: 'bottom', title: 'Search & jump', text: 'Press Ctrl/⌘ + K to jump to any page or find a stock by symbol or company name.' },
  { route: 'overview', sel: '#themeBtn', place: 'bottom', title: 'Languages & designs', text: 'Use the flag button to pick your country and language, and the palette button to switch the whole design: colors, patterns and style.' },
  { route: 'overview', sel: '.kpis', place: 'bottom', title: 'Overview at a glance', text: 'The report universe, the filtered list, the aggregated Buy + Strong Buy share, the average upside and the current top pick.' },
  { route: 'top10', sel: '#view .fbar', place: 'bottom', title: 'Editable thresholds', text: 'Change the distance from the 52-week low, the minimum number of analysts and the maximum Sell, Underperform and Hold. Everything updates instantly; the source Excel is never modified.' },
  { route: 'top10', sel: '#topGrid', place: 'top', title: 'Top 10 cards', text: 'Each card compares the price with the minimum, mean and maximum analyst targets and shows the distribution of recommendations. Pick another ranking in the selector above.' },
  { route: 'universe', sel: '#view .tbl-wrap', place: 'top', title: 'Full SP500 list', text: 'Every stock queried in the report, before any filter. Filter any column from its header, sort it and export to CSV.' },
  { route: 'overview', title: 'You are ready', text: 'Your design and language are remembered in this browser. You can replay this tour from the ? button at the top.', last: true }
];
