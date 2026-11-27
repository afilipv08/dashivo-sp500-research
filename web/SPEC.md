---
id: sp500-dashboard
type: module-design
title: SP500 Research dashboard (Dashivo)
status: draft
---

## Purpose

The local web view of an SP500 report: it shows the Excel produced by `yahoo_unificat.py` /
`improvement.py`, lets the user filter and rank it, and (when served by `dashboard_server.py`)
starts a new research run. It is a Dashivo app: same brand, designs, languages and shell as the
other Dashivo dashboards (TaskFlow, SimpleBudget, HabitFlow, Debt Tracker).

## Boundary

- **Input:** the JSON payload built by `dashboard.payload()` from the compact workbook
  (`Lista_SP500` + `Lista_Filtrata`), embedded in `<script id="data">`, or a workbook the user
  imports in the browser. The source Excel is never modified.
- **Output:** one self-contained `SP500_Dashboard.html` (CSS, JS, logos and data inlined by
  `dashboard.build_html`), plus CSV exports named `DD.MM.YYYY_hh-mmAM_SP500_Research_<part>.csv`.
- **Server contract:** `dashboard_server.py` injects `window.dashboardRunToken` before the data
  script; the page calls `POST /api/run` (body `{"resume": bool}`), `GET /api/status`,
  `GET /api/result` with `X-Dashboard-Token`. Status carries `phase` (list → quotes → export → load
  → done), `done/total`, `ok/errors`, `resumed`, `elapsed`, `eta` and, when idle, `resumable`.
  Without the token (file opened directly) running is disabled and explained.

## Research run

- `yahoo_unificat.py` downloads 4 stocks at a time; a shared rate-limit gate pauses every worker on
  Yahoo 429 (10 s doubling to 160 s) and retries. A full run takes ~4–5 min (measured 20.11.2026).
- Its stdout is the progress protocol: `PHASE <name> [total] [already-done]` and
  `[n/N] SYMBOL: status` in completion order; `Raport filtrat: <path>` names the result.
- Every finished stock is appended to `Output/.checkpoint_<YYYYMMDD>.jsonl`; `--resume` skips saved
  symbols, a fresh run discards the file, a successful report deletes it. Resuming is offered only
  for today's checkpoint, so stale quotes are never mixed into a new report.
- One run writes `Output/complet/SP500_<ts>.xlsx` (full 38-column export, kept apart so report
  globs never pick it), `Output/SP500_<ts>.xlsx` (compact report used by Investitii and the
  dashboard) and `Output/SP500_<ts>.json` (dashboard snapshot; `dashboard.load_payload` reuses it
  while it is newer than the Excel, otherwise rebuilds it, so older reports still open).

## Decisions

- **Dashivo is vendored, not re-imitated.** `dashivo/` holds copies of the shared Dashivo files
  (see `dashivo/README.md` for the few local changes); `web/` holds only SP500 code. Updating the
  look means re-copying from `Reusable_Skill_Dashboards`, not editing CSS here.
- **Designs:** Dashivo Red (default), Midnight Orange, Cream Pastel. **Languages:** en-US, de, fr,
  es, it, ro; Romanian on first run (user's request), then the remembered choice.
- **UI text is English source,** translated at DOM level by the Dashivo engine from
  `web/i18n_sp500.js`. Market data (symbols, companies, sectors, numbers) sits in `.notr` and is
  never translated; Excel financial labels (Strong Buy … Sell, Total Analysts, Latest Rating …)
  stay English. Status/issue messages from Python (`dashboard.analyze`, `dashboard_server`) are
  English source for the same reason; per-stock progress lines (`[n/N] SYMBOL: status`) are data.
- **Titles** are short everywhere: a page's card heading repeats its menu name (e.g. Technical, Fair value, Backtest) instead of a sentence,
  and the explanatory sentence sits in the card subtitle.
- **Pages** (menu labels are deliberately one or two words; the first two Top 10 names are the user's own): Overview, Research,
  Top 10 [filtered] (with the sub-pages Top 10 returns, Filtered, Simulations and Calendar, indented in the menu), Sectors,
  Technical, Fundamentals, AI agents, Fair value, eToro, All stocks, AI prompts, Sources, Method, Portfolio (several named
  portfolios), Settings, and for Crypto Crypto Top 10, Levels, BTC cycles, X & sentiment, routed in-app (`App.go`) with a first-run tour and a Ctrl/⌘+K palette.
- **Filters:** a list of optional criteria (`null` = no limit) applied to the full loaded list and
  shared by Overview, Top 10 and Filtered list: thresholds (distance from 52-week low, min Total
  Analysts, max Sell / Underperform / Hold, min Strong Buy + Buy), min–max ranges (price, upside,
  Buy+SB share, min-target proximity), multi-select consensus and sectors, search. Defaults are
  12 % / 12 / 0 / 2 / Hold ≤ 2 — Hold ≤ 2 is the user's deliberate choice even though the Excel
  `Lista_Filtrata` does not filter Hold (on 20.11.2026: 3 vs 63 stocks).
- **Top 10 layout:** a compact filter bar (presets, the six thresholds with their “−N” badges,
  search, ranking) with ranges / consensus / sectors under a collapsed “Advanced filters”. Cards are
  small (3 per row): one price axis (52-week band, price, min / mean / max targets), a recommendation
  bar with shares written inside, four short stats. The same card is the portfolio hover card.
  A banner above the filters shows the date and time of the research behind the report (parsed from the report
  file name, hidden when unknown); live prices are timestamped separately.
- **Logos** load from financialmodelingprep.com by symbol with a colored monogram fallback (offline
  or missing); a few symbols return a blank image that the browser cannot detect. Sectors use 11
  GICS line icons. `dashboard.PAYLOAD_SCHEMA` versions the JSON snapshot so a field change
  (e.g. the 52-week `high`) rebuilds cached reports.
- **Full SP500 list** is filtered independently of the criteria above: one filter per column header,
  its kind inferred from the data (numbers → min–max, with `%` columns entered in percent; ≤ 15
  distinct values → list; otherwise “contains” text). Column filters persist separately
  (`dashivo-sp500-colfilters`); CSV export takes the filtered, sorted rows.
- **Presets** keep both views reachable: “As in Excel” (no Hold limit) and “As in Top 5 Investitii”
  (BUY, Sell 0, Hold ≤ 1, SB+B ≥ 15, valid minimum target — must stay equal to
  `improvement.select_candidates`), plus user-named presets. Filters, ranking and presets persist in
  `localStorage`. Each filter shows how many stocks fail only that filter (would return without it).

## Live prices

- Requested on every opening of the dashboard (served mode only): `POST /api/live-prices` with all
  symbols → `live_prices.refresh` does one batch `yf.download` and caches
  `Output/live_prices.json`; `GET` returns the cache, shown first and kept until the next opening.
- Re-requested every 5 minutes while the dashboard is open; Top 10 cards show report and live price
  side by side with the live time.
- Shown as two columns after the report price in the Filtered and Full lists (“Live price”, “Live
  vs report (%)”). Display only, by decision: filters, rankings and Top 10 keep the report price so
  they stay identical to the Excel.

## AI analysis

- The AI analysis page lists the current Top 10 (same filters and ranking as Top 10 [filtered]). Each
  stock's button opens the chosen assistant in a new tab with the prompt prefilled in the URL
  (ChatGPT `?q=`, Claude `new?q=`, Perplexity `search?q=`; Gemini has no such link, so it gets the
  clipboard only) and also copies the prompt. No API key and no server call: the user's own AI
  account does the analysis.
- The prompt lives on the Settings page (browser storage): the user's default text with `{TICKER}` /
  `{COMPANY}`, plus, by default, a data block from the report. The data block is in Romanian
  because it is part of the prompt, not of the UI.

## Sections

The menu has two sections, switched under the logo: **Stock market** (everything above) and
**Crypto**. Inside Stock market the index pages sit under a foldable tree node (`NAV_TREE`:
Stock market → SP500 → Overview … Methodology), so other indices can be added as siblings; the
portfolio stays at section level because it can hold stocks from any index. Each `NAV` entry carries its section (`all` = both, e.g. Settings); opening a page
switches to its section, and the last section is remembered.

## Crypto

- Scope by decision: the top 10 coins by market cap, no screening/filters like the stock market.
- `crypto.py` builds `Output/crypto.json` (served by `GET /api/crypto`, rebuilt by
  `POST /api/crypto/refresh` on the first crypto page of each opening): CoinGecko markets + global,
  alternative.me Fear & Greed (60 days), Bitstamp BTC daily since 2011, one Yahoo batch for the other
  coins' year of history (kept only if its last close is within ±15% of CoinGecko, which rejects
  ticker collisions) with CoinGecko's 365-day history as fallback. Market data at most every
  10 minutes (public API limits), history every 12 hours; a failing source keeps the old data.
- **Key levels** = swing highs/lows of daily closes (3 years for BTC, 1 year otherwise) clustered
  within ±3.5%, with touches and last touch; nearest 3 supports and resistances drive the
  bullish/bearish scenarios. Stablecoins get no levels. Indicators: MA50/MA200, RSI14, 30-day
  volatility, 52-week range, ATH.
- **BTC cycles:** one cycle per halving; the peak is searched in the first 900 days (later highs are
  the next cycle's run-up — without this the 2020 cycle peak lands in 2024), the bottom is the lowest
  close after it. The “if history repeats” box is a statistical analogy over completed cycles.
- **X:** there is no free X API, so posts are not fetched; the page opens X searches (top posts,
  posts from a curated account list) and an AI summary prompt, with Grok as the default assistant
  because it reads X. The crypto prompt is edited in Settings.

## Demo portfolio

- Simulated investing only, no real money. `portfolio.py` owns `Portofoliu/portfolio.json` (atomic
  writes under a lock): starting capital (default 10 000 USD, never below what is invested), deposits,
  open positions, closed positions and the last price per symbol. Cash, values and P/L are derived on
  read, never stored.
- Buys and sells use the live Yahoo price at that moment (fallback: report price on buy, last known
  price on sell, marked by `source`); shares = amount / price, fractional; each buy is its own
  position. A buy stores a snapshot of the analysis card so the Portfolio page shows, on hover, the
  analysis the decision was based on, unaffected by later reports.
- Routes (token-protected): `GET /api/portfolio`, `GET /api/portfolio/history?id=` (daily closes since
  the buy), `POST /api/portfolio/{buy,sell,deposit,capital,prices}`. Prices refresh automatically every
  5 minutes while the dashboard is open — by the user's choice there is no manual price button.
- “Invest” is offered on the Filtered list and Full SP500 list rows only (not on Top 10 cards).
- **Several named portfolios** (up to 20, names 1–40 characters, unique ignoring case): each is a separate account with its own
  capital, cash, positions, closed positions and prices. `Portofoliu/portfolio.json` holds `{"portfolios": [...]}`; a file written
  before this existed becomes the first one ("Main portfolio"), and the browser copy (GitHub Pages) migrates the same way. Every
  portfolio call names its portfolio (`portfolio` in the body, `?id=` for reads; omitted = the first), the answer carries the short
  list (`portfolios`), `create`/`rename`/`delete` are extra actions, and the last portfolio cannot be deleted. The chosen portfolio is
  remembered on the device; the Invest dialog asks which portfolio to spend from and shows its cash. In the browser every `await`
  runs before the store is read, because a price refresh in flight once overwrote a delete (read-modify-write across an await).
  Backups export and import all portfolios (an older single-portfolio file is accepted).

## Explanations on hover

Every derived number explains itself on hover with its formula and the actual values (weighted
score, analyst total, target proximity, upside, distance from the low), each recommendation
segment shows its analyst count, each filter shows its meaning and how many stocks it removes on
its own. The latest rating explains the grade and lists recent rating changes, fetched on first
hover from Yahoo (`ratings.py`, `GET /api/ratings?symbol=`, cached a day).

## Online version (GitHub Pages)

- The user does not keep the PC on, so the dashboard also runs without it: repository
  `afilipv08/dashivo-sp500-research` (public, required by free Pages; it holds code and market data only),
  site `https://afilipv08.github.io/dashivo-sp500-research/`, installable on the phone (manifest, icons,
  service worker with network-first offline cache).
- `build_site.py` builds `site/`: the same app with `window.dashboardStatic`, plus `data/live_prices.json`,
  `crypto.json`, `ratings.json` (filtered list), `history.json` (1 year of daily closes, one shared date
  list), `intrinsic_values.json`, and `meta.json`. Ratings, history and valuation snapshots are reused
  from the published site while fresh; valuation source failures retain last-good data when available.
- In site mode `web/static.js` answers every `/api/*` call: files for data, `localStorage` for the demo
  portfolio (same rules as `portfolio.py`, with export/import backup because it lives on one device), and
  “Run research” opens the GitHub workflow page. The PC version is unchanged.
- Intrinsic-value source data is fetched during the build, never from browser JavaScript except the
  provider's official Fair Value Calculator SVG embed. `SEC_CONTACT_EMAIL` is supplied to the Pages
  build only as a GitHub Actions secret and is used only in the SEC User-Agent; neither it nor raw SEC
  responses are published. The browser and local server consume the attribution-safe static snapshot.
- GitHub Actions: `research.yml` once per calendar day, Europe/Bucharest (a two-hourly schedule feeding a gate, see Top 10 returns) and on demand runs `yahoo_unificat.py`, commits reports and Top 10 returns, then publishes; `site.yml` refreshes prices every 30 minutes in US
  market hours, crypto every 2 hours, and rebuilds after every push to `main`. Its deploy token is limited to
  `contents:read`, `actions:read` (Pages artifact lookup), `pages:write`, and `id-token:write`.
- `deploy-pages` intermittently reported "Found 0 artifact(s)" right after the upload (about half of the runs on 25.11.2026,
  succeeding on re-run), so both workflows wait 30 s between the upload and the deploy; re-running the failed job is the fallback.
- Yahoo silently throttles cloud runners (quotes come back empty, no 429): `yahoo_unificat.retry_failed`
  retries failed stocks slowly, then fills price and 52-week range from one batch of daily history
  (`price_field = history 1y`). First cloud run before this: 432/503.

## Making changes (keep GitHub and the local copy in sync)

The local folder and `origin/main` must always end up identical, by the user's request:
1. `git pull --rebase` first — the daily GitHub research commits new reports and `Output/top10_history.json`.
2. Change and test locally (`python -m unittest`).
3. Commit and `git push`; `site.yml` rebuilds and publishes the site, and a running local server is restarted.
Only bot commits touch `Output/` and `Investitii/`, so code changes do not conflict with them.

## Sector analysis

The sector page summarizes the full reported SP500 universe, independent of Top 10 filters. It groups by the report's GICS sector field and compares company count, average live-vs-report price change, analyst Buy+Strong Buy share/consensus, mean analyst-target upside, and mean minimum-target proximity. Live change uses only symbols with a quote and is not a historical-period return; recommendation/target metrics remain report-derived.

Drill-down: clicking a sector opens its companies directly under that row (one sector at a time; click again to close), with price and live price, live change, consensus, Buy+SB, analysts, upside and min-target proximity, sortable by any column. Clicking a company opens its detail inline: the same analysis card as Top 10 (52-week axis, targets, recommendation bar, rating history on hover) and the Technical, Fundamentals and Fair-value verdicts the dashboard computes for any stock, plus Invest, eToro and "filter this sector in Top 10". It works for every company, not only the Top 10; verdicts show "Loading…" until the market history and valuation snapshot arrive, then the page re-renders, and missing data shows as unavailable.

## Top 10 returns

- After every research run (PC and GitHub) `top10_history.record` stores the day's Top 10 for the three presets
  in `Output/top10_history.json` (committed): one entry per day, latest run of the day wins, with price, proximity,
  upside, score and how many stocks matched. Its preset rules and ranking copy `web/data.js` and must stay equal
  (tested against the Investitii Top 5). `--backfill` rebuilt it from the saved reports.
- The online research runs **once per calendar day** (Romania time), at any hour: by the user's decision only the daily cadence matters,
  not the time. GitHub starts scheduled jobs hours late or drops them (on 26–27.11.2026 every run started after midnight and an
  earlier 16:00-based gate skipped them all, leaving a two-day gap), so `cron: '17 */2 * * *'` (every two hours, off the full hour)
  feeds a gate that runs only when today's date is not yet in `Output/top10_history.json`; manual runs always execute.
- Backup trigger on the owner's Mac: launchd agent `com.dashivo.sp500.daily-research` (in `~/Library/LaunchAgents`, log in
  `~/Library/Logs/dashivo-daily-research.log`) runs `daily_research_trigger.sh` at 09:05, 13:05, 17:05 and 21:05 (a missed time runs on
  wake). It reads the history on GitHub and starts the workflow only when today has no research and no run is in progress, using the
  GitHub CLI login already on the Mac (no stored token). It only helps when the Mac is on; a fully external trigger (e.g. cron-job.org
  calling the `workflow_dispatch` API) would need a fine-grained token limited to this repository's Actions, created by the owner.
- The Top 10 returns page compares each day's picks with the current live price (“since selection”), shows the
  most frequent stocks, and lists “My saves”: Top 10 lists saved from the current filters on the device.
- The Returns calendar page (`web/calendar.js`, a Top 10 [filtered] sub-page) colours each trading day green or red by
  the equal-weighted day-over-day price return of the Top 10 selection in force that day: the latest saved selection
  made on an **earlier** date, because a selection is made at some hour of that day, often during the US session, so its first full
  day is the next one. Hover shows the portfolio and S&P 500 percentages and each pick; a click lists the picks. Days
  without a market close, without a prior selection, or with no usable prices stay grey; nothing is estimated. It reads the
  same `top10-history` and `market-history` data as the simulations.
- Simulation cohorts use each saved Top 5/Top 10 selection and report entry prices, with $10,000 equally
  allocated across eligible picks. The page compares 1-, 2- and 3-calendar-month price returns against the
  S&P 500; it uses the first available close on/after each endpoint, and shows future or unavailable results
  as pending/missing rather than estimating them. Dividends, fees and taxes are excluded; the daily index
  close is an approximation to the report's intraday stock prices.
  Each cohort row expands to its picks with entry price, latest available close and the return since selection,
  plus the S&P 500 since the selection day, so every day's selection can be followed individually.

## Intrinsic value

The Intrinsic value page uses the current Top 10 selected by the user's active filters and ranking. It
shows the live quote when available, otherwise the report price is identified as such. External sources
are dated and linked: Equity Rank's blended model value, Fair Value Calculator's official per-ticker
attributed SVG badge, and Zyberno's CC BY 4.0 monthly cross-section. Zyberno publishes company-level
intrinsic value, so the displayed per-share value is explicitly approximate and calculated as
`intrinsic_value_usd / (market_cap_usd / price_usd)`; the source inputs, row date and snapshot date are
available with the estimate. Missing provider values or conversion inputs remain unavailable.

The three filing-based methods use SEC Company Facts: (1) a five-year FCF-per-diluted-share DCF, where
annual FCF is operating cash flow minus property/plant/equipment purchases, using 5% explicit growth,
9% discount rate and 2.5% terminal growth; (2) Graham Number, `sqrt(22.5 × diluted EPS × book value per
share)`; and (3) Gordon-growth DDM, `next annual dividend per share / (9% required return − 2.5%
dividend growth)`. Inputs, filing dates and assumptions accompany results. These baseline assumptions
are unconfirmed, not forecasts; missing, nonpositive or incompatible inputs produce unavailable
results rather than invented estimates. While SEC filings are not connected (no `SEC_CONTACT_EMAIL`), `sources.ttm` gives the DCF and the Graham Number
from Zyberno's trailing-twelve-month values (shares = market cap / source price, book value = net income / ROE, so both are approximate and
labelled as such); the dividend model stays unavailable because no free source here carries dividends. A filing-based value, when present,
always wins over the derived one. SEC calls are build-side, paced below 10 requests/second, and
skipped unless the `SEC_CONTACT_EMAIL` Actions secret is configured. A provider 429 stops further
source requests in that build; the current snapshot is retained and the next refresh waits for its
24-hour cache window.

## Verdict

The Verdict page (`web/summary.js`, first sub-page of Top 10 [filtered]) puts the analyses of the current Top 10 side by side so they
bring value together: technical verdict, fundamentals verdict, fair-value median against the price (needs two estimates; ≥ +15% positive,
≤ −15% negative), and the saved ratings of TradingAgents and Vibe-Trading. Each column votes +1/0/−1, the last column counts them
(≥ net +2 leaning positive, ≤ net −2 leaning negative, otherwise mixed; fewer than two signals = not enough). Equal weights; the signals are
not independent (the programs read the same market data), thresholds are baseline choices, and a missing signal is left out, not guessed.
The Fair value page also shows the median of the positive estimates with its range and the gap to the price. Pages that depend on the
market history or on the valuation snapshot re-render when those finish loading (a page opened first used to stay on "Loading…").

## Technical analysis

The Technical analysis page (`web/technical.js`) shows the current Top 10 (and any other stock picked) from `data/technical.json`, which
`technical.py` computes at build time from three years of adjusted daily OHLCV (Yahoo Finance) for every stock and the S&P 500; it is
recomputed at most twice a day and served locally by `/api/technical`. The browser does no indicator maths.
- **33 votes in four groups**, each -1/0/+1: 15 moving-average and 11 oscillator conditions exactly as TradingView's published
  Technical Ratings rules (SMA/EMA 10–200, VWMA 20, Hull 9, Ichimoku; RSI, Stochastic, CCI, ADX, Awesome, Momentum, MACD, Stoch RSI,
  Williams %R, Bull Bear Power, Ultimate), plus 4 volume checks (OBV vs its 20-day average, Chaikin Money Flow ±0.05, MFI, up vs down
  volume) and 3 relative-strength checks against the S&P 500 (3 and 6 months, 12-1 momentum, ±2 points). Where TradingView's text leaves
  the up/down trend open (Stoch RSI, Bull Bear Power) the trend is price vs its 50-day average — our choice. Indicators without enough
  history do not vote.
- Group score = mean of its votes; **composite verdict** = mean of the four groups; categories use TradingView's thresholds
  (±0.1, ±0.5). The TradingView-only rating (moving averages + oscillators) and a weekly rating are shown next to it. Context values
  (ADX/DI, ATR, Bollinger, 30-day volatility, swing support/resistance, classic pivots, 52-week range, returns, relative returns, last
  golden/death cross) are shown, not voted.
- **Track record**: for every stock, the last 252 days with a known 60-day outcome are scored; pooled over the universe, the average
  forward return over the S&P 500 at 5, 20 and 60 days per verdict category, with the Strong Buy − Strong Sell spread, for both the
  composite and the TradingView-only rating; each stock also shows its own 20-day record. Windows overlap, so days are not independent,
  and one year is one market regime. On 27.11.2026 (Sep 2025–Sep 2026 scored) the composite spread was ≈0 / +1.0 / +2.3 points at 5 / 20 /
  60 days and the TradingView-only spread about zero, which is why the volume and relative-strength groups are part of the verdict.
- Other pages (Verdict, Sectors company detail) use the composite verdict through `techVerdict()`.

## Fundamental analysis

The Fundamental analysis page (`web/fundamental.js`) reuses the attributed valuation snapshot (`intrinsic_values.json`), so it
adds no source: Zyberno (CC BY 4.0) supplies trailing-twelve-month revenue, net income, free cash flow, EPS, ROE, ROIC and
market cap, and Equity Rank the Fundamental Strength score/grade and model counts. Ratios (P/E on the live or report
price, P/S, net margin, FCF yield) are computed in the browser; missing inputs stay blank. Six rules vote +1/0/−1: net margin
(>10% / <0%), ROE (>15% / <5%), ROIC (>10% / <6%), FCF yield (>4% / <0%), trailing P/E (≤25 / >40 or a loss) and Fundamental
Strength (≥60 / <40); the verdict is strong at +3 or more, weak at −3 or less, otherwise mixed, and needs at least four
available rules. The thresholds are baseline choices, unconfirmed by the user, and source rows can lag the latest filings.
The snapshot carries `schema` (`PAYLOAD_SCHEMA`), and a cache without the current schema is rebuilt, so new published fields
do not wait for the 24-hour window.

## AI agents (programs on the owner's PC)

The AI agents page (`web/agents.js`, `agents_bridge.py`) queries programs installed on the user's PC for the current Top 10
and keeps every answer in the platform. It is **local only** by decision: a run spends the owner's AI account and minutes, and
the results are model output. The bridge never reads or copies keys. A tab per program; one run at a time across programs.
- **TradingAgents** (default `~/5_GitHub_programs/TradingAgents`, override `TRADINGAGENTS_DIR`; data in `~/.tradingagents`, override
  `TRADINGAGENTS_HOME`): the newest readable saved report per symbol under `logs/reports/<SYMBOL>_<timestamp>/` gives the
  five-tier rating, analysis date and ~330 characters of the portfolio decision's executive summary; `complete_report.html` opens
  from `/agents-report/<name>` (validated name, loopback visitors only). A run is `python -m cli.main --ticker … --date today
  --analysts … --save --no-show --html` with the repository's own virtualenv (its `tradingagents` launcher points to an old path),
  taking provider, models, depth and analysts from the CLI's saved `cli_prefs.json`; killed after 45 minutes.
- **Vibe-Trading** (`vibe-trading` on the PATH or `~/.local/bin`, override `VIBE_TRADING_BIN`; its provider is set in
  `~/.vibe-trading/.env`): `vibe-trading -p "<fixed prompt>" --no-rich` (plain output; `--json` carries no answer text). The final
  answer is read from the block after the run header, the Bullish/Neutral/Bearish verdict from its "Verdict" line, killed after 20
  minutes. Its answers redact figures it cannot ground, and a run may degrade to a deterministic fallback; both are shown as given.
- Every successful result is saved in `Output/pc_analysis.json` (written atomically; it is not in the bot's commit list, so it is
  published only when the owner commits it). `build_site.py` copies it to `data/pc_analysis.json`, so the online copy shows the saved
  answers read-only. A dropped connection to the AI provider is retried once (it was transient on 26.11.2026); failures are explained
  from known error classes and logged to `~/.tradingagents/logs/dashboard_runs/`.
- `POST /api/agents/run` (loopback only; phone/Tailscale visitors get 403) queues up to 10 symbols for a program; the UI asks for
  confirmation and offers runs for stocks with no conclusion or one older than the report behind the Top 10, or for all ten.
- **freqtrade** (`~/5_GitHub_programs/freqtrade` with its own `.venv`, override `FREQTRADE_DIR`; installed there on 26.11.2026 with
  `pip install -e .`) powers the Crypto → Backtest page (`web/backtest.js`), not the stock page: per coin of the crypto Top 10 it
  downloads public Binance hourly candles (`download-data`, no key) into `~/.freqtrade_dashboard/<COIN>/` and runs `backtesting`
  of `SampleStrategy` over the last 90 days (100 USDT per trade, one open trade), then saves trades, win rate, total profit % on the
  stake and deepest drawdown. Stablecoins, symbols that are not plain tickers and pairs missing on Binance are reported as not
  testable. It tests one example strategy on the past; it is not a forecast or advice.
- **One button**: the Verdict page offers "Run all programs for the Top 10": `POST /api/agents/run` with `program: "all"` runs
  TradingAgents then Vibe-Trading (the installed ones) over the Top 10, one stock at a time, saving every answer in the platform
  file; the page follows the run (every 15 s) and fills in as answers arrive. freqtrade is separate because it works on the crypto Top 10.
- Ratings and summaries are not investment advice and not forecasts. scrapling-lab (Flashscore scraping) is unrelated to stocks and
  not used here.

## eToro links

The eToro page uses the active filters and ranking to show official asset-page links for the current
Top 10 and points to the Analyst Forecast and Analysis sections on eToro. The dashboard intentionally
does not fetch, scrape, cache, or republish eToro forecast data: the API documentation reviewed lists
market rates, candles, history and metadata, but no analyst-forecast endpoint, and public
redistribution rights were not confirmed. No eToro API credentials belong in the public app. If
approved access and reuse rights become available, reconsider this boundary before importing data.

## Phone access

- Opt-in only (`run_dashboard_telefon.bat` / `dashboard_server.py --lan`); the normal start stays
  bound to 127.0.0.1. Phone mode binds the LAN, accepts only its own hosts (loopback + the PC's LAN
  IP), and every non-loopback visitor must enter a 6-digit PIN generated per start (session cookie,
  HttpOnly + SameSite=Strict; 5 wrong PINs lock that address for 10 minutes). The PIN and address are
  injected only into the computer's own page (Settings card with a locally generated QR code), never
  sent to the phone. LAN traffic is plain HTTP; remote use goes through a VPN such as Tailscale, never
  router port forwarding.
- Phones have no hover, so every explanation tooltip also opens on tap and closes on a tap elsewhere.
- Live prices keep a ticker's last known price when Yahoo drops it from a batch (`stale`).

## Known limits

- Translations other than Romanian were machine-authored; native proofreading is pending
  (unconfirmed quality).
- Fonts load from Google Fonts with a system fallback; the page otherwise works offline.
