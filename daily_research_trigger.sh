#!/bin/bash
# Backup trigger for the daily research, run by launchd on this Mac (see web/SPEC.md, "Online version").
# Starts the GitHub workflow only when today's research (Romania date) is not yet in Output/top10_history.json on GitHub,
# so it never adds a second run. Uses the GitHub CLI login already on this Mac; no token is stored here.
REPO="afilipv08/dashivo-sp500-research"
GH="${GH_BIN:-/opt/homebrew/bin/gh}"
TODAY="${TODAY_OVERRIDE:-$(TZ=Europe/Bucharest date +%F)}"   # override and DRY_RUN=1 are for testing only
stamp() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

if ! "$GH" auth status >/dev/null 2>&1; then stamp "gh is not signed in; nothing done"; exit 1; fi
DATES="$("$GH" api "repos/$REPO/contents/Output/top10_history.json" -H "Accept: application/vnd.github.raw" 2>/dev/null \
  | /usr/bin/python3 -c "import sys, json; print(' '.join(d.get('date', '') for d in json.load(sys.stdin).get('days', [])))" 2>/dev/null)"
if [ -z "$DATES" ]; then stamp "could not read the history from GitHub; nothing done"; exit 1; fi
case " $DATES " in *" $TODAY "*) stamp "$TODAY already has a research; nothing to do"; exit 0;; esac

# a research started by GitHub's own schedule may still be running: do not start a second one
if "$GH" run list --repo "$REPO" --workflow research.yml --limit 5 --json status --jq '.[].status' 2>/dev/null | grep -qE 'in_progress|queued'; then
  stamp "a research run is already in progress; nothing to do"; exit 0
fi
if [ -n "$DRY_RUN" ]; then stamp "$TODAY had no research yet; would start the workflow (dry run)"; exit 0; fi
"$GH" workflow run research.yml --repo "$REPO" && stamp "$TODAY had no research yet; started the workflow"
