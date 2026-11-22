# dashivo/ — vendored Dashivo shared design system

Copied from `/Users/afilipv/0_Etsy/Claude_Code/Reusable_Skill_Dashboards/reference-app` (Dashivo TaskFlow).
Keep these files identical to the source so the SP500 dashboard matches every other Dashivo app.

| File | Origin | Local changes |
|---|---|---|
| `styles.css`, `themes.css`, `shell.css`, `themes.js`, `i18n_brand.js` | verbatim | none |
| `core.js` | `core.js` helpers (`h`, `$`, `esc`, `D`, `clamp`, `debounce`, `CHART_COLORS`) | task data model removed |
| `ui.js` | `ui.js` icons, components, tooltip, charts, toast | task-only helpers removed |
| `shell.js` | `shell.js` collapsible menu + export file names | multi-account/backup part removed |
| `i18n.js` | verbatim engine | `LANG_KEY` and first-run default language come from `APP_CFG`; text inside `.notr` (market data) is never translated |
| `tour.js` | verbatim engine | steps/key moved to the app; home route = `App.home` |
| `assets/*.png` | brand logos | none — never redraw or recolor |
