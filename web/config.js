'use strict';
/* SP500 Research · app contract read by the shared Dashivo files (i18n.js, shell.js, tour.js). */
const APP_CFG = {
  title: 'SP500_Research',            // export file names: DD.MM.YYYY_hh-mmAM_SP500_Research_<part>.csv
  slug: 'sp500-research',
  langKey: 'dashivo-sp500-lang',
  defaultLang: 'ro'                   // first run starts in Romanian; the user's choice is remembered afterwards
};
const TOUR_KEY = 'dashivo-sp500-tour';
/* The shared i18n engine expects these two tables; web/i18n_sp500.js fills them. */
const I18N_ROWS = [];
const I18N_PATS = [];
