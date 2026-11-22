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
- **Pages:** Overview, Run research, Top 10 & filters, Filtered list, Full SP500 list, Methodology,
  routed in-app (`App.go`) with a first-run tour and a Ctrl/⌘+K palette.
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

- The AI analysis page lists the current Top 10 (same filters and ranking as Top 10 & filters). Each
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
  list), `meta.json`. Ratings and history are reused from the published site while under a day old.
- In site mode `web/static.js` answers every `/api/*` call: files for data, `localStorage` for the demo
  portfolio (same rules as `portfolio.py`, with export/import backup because it lives on one device), and
  “Run research” opens the GitHub workflow page. The PC version is unchanged.
- GitHub Actions (times in Europe/Bucharest): `research.yml` every Monday 16:00 and on demand runs
  `yahoo_unificat.py`, commits the reports and publishes; `site.yml` refreshes prices every 30 minutes in US
  market hours, crypto every 2 hours, and rebuilds after every push to `main`.
- Yahoo silently throttles cloud runners (quotes come back empty, no 429): `yahoo_unificat.retry_failed`
  retries failed stocks slowly, then fills price and 52-week range from one batch of daily history
  (`price_field = history 1y`). First cloud run before this: 432/503.

## Top 10 history

- After every research run (PC and GitHub) `top10_history.record` stores the day's Top 10 for the three presets
  in `Output/top10_history.json` (committed): one entry per day, latest run of the day wins, with price, proximity,
  upside, score and how many stocks matched. Its preset rules and ranking copy `web/data.js` and must stay equal
  (tested against the Investitii Top 5). `--backfill` rebuilt it from the saved reports.
- The online research now runs every weekday at 16:00 Romania time: two UTC crons (summer/winter) plus a gate
  step that keeps only the one matching the current Bucharest offset.
- The Top 10 history page compares each day's picks with the current live price (“since selection”), shows the
  most frequent stocks, and lists “My saves”: Top 10 lists saved from the current filters on the device.

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
