"""Bridge to a local TradingAgents install (https://github.com/TauricResearch/TradingAgents).

Local only: it reads reports the tool saved under ~/.tradingagents and, on request, starts its CLI for chosen tickers.
It uses the user's own AI account/settings from TradingAgents' saved CLI preferences; no key is read, copied or published.
"""
import json
import os
import shutil
from datetime import date, datetime
from pathlib import Path
import re
import subprocess
import threading
import time

TA_DIR = Path(os.environ.get('TRADINGAGENTS_DIR') or Path.home() / '5_GitHub_programs' / 'TradingAgents')
TA_HOME = Path(os.environ.get('TRADINGAGENTS_HOME') or Path.home() / '.tradingagents')
STORE = Path(__file__).resolve().parent / 'Output' / 'pc_analysis.json'   # the platform's own copy of every result, shown after restarts
PROGRAMS = ('tradingagents', 'vibe')
VERDICTS = {'Bullish': 'good', 'Neutral': 'mid', 'Bearish': 'bad'}
VIBE_TIMEOUT = 20 * 60
VIBE_PROMPT = ('Research {listing} (the U.S.-listed stock with ticker {symbol}); use exactly that listing and do not ask which one is meant, using current market data tools. In at most 120 words give: business, latest financial performance, '
               'key risks, and a one-line verdict (Bullish, Neutral or Bearish) with the main reason. State the data dates and flag anything missing.')
SYMBOL = re.compile(r'^[A-Z0-9][A-Z0-9.\-]{0,9}$')
RATINGS = ('Buy', 'Overweight', 'Hold', 'Underweight', 'Sell')
MAX_SYMBOLS = 10
RUN_TIMEOUT = 45 * 60          # one ticker; a stuck run is killed instead of blocking the queue
SUMMARY_CHARS = 330
CONNECTION_RETRIES = 1
CONNECTION_MESSAGE = 'The AI provider could not be reached (connection error). Check the internet connection, then run again.'


def python_path():
    for candidate in (TA_DIR / '.venv' / 'bin' / 'python', TA_DIR / '.venv' / 'Scripts' / 'python.exe'):
        if candidate.is_file():
            return candidate
    return None


def available():
    return python_path() is not None and (TA_DIR / 'cli' / 'main.py').is_file()


def reports_dir():
    return TA_HOME / 'logs' / 'reports'


def _short(text, limit=SUMMARY_CHARS):
    text = re.sub(r'\s+', ' ', text or '').strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind('. '), cut.rfind('; '))
    return (cut[:end + 1] if end > limit * 0.5 else cut.rsplit(' ', 1)[0] + '…').strip()


def parse_report(folder):
    """Header + short executive summary of one saved TradingAgents report; None when it cannot be read."""
    try:
        head = (folder / 'complete_report.md').read_text(encoding='utf-8', errors='replace')[:2500]
    except OSError:
        return None
    rating = re.search(r'^- Rating:\s*(.+)$', head, re.M)
    analysed = re.search(r'^- Analysis date:\s*(\d{4}-\d{2}-\d{2})', head, re.M)
    generated = re.search(r'^- Generated:\s*(.+)$', head, re.M)
    if not rating or not analysed:
        return None
    summary = ''
    try:
        decision = (folder / '5_portfolio' / 'decision.md').read_text(encoding='utf-8', errors='replace')
        found = re.search(r'\*\*Executive Summary\*\*:\s*(.+?)(?:\n\s*\n|\Z)', decision, re.S)
        summary = _short(found.group(1)) if found else ''
    except OSError:
        pass
    value = rating.group(1).strip()
    return {'rating': value if value in RATINGS else None, 'ratingText': value, 'date': analysed.group(1),
            'generated': generated.group(1).strip() if generated else None, 'summary': summary,
            'report': folder.name, 'html': (folder / 'complete_report.html').is_file()}


def latest(symbols, program='tradingagents'):
    """Newest saved result per symbol: {SYMBOL: {...}}."""
    if program == 'vibe':
        saved = read_store().get('vibe', {})
        return {s: saved[s] for s in symbols if isinstance(s, str) and s in saved}
    root = reports_dir()
    out = {}
    saved = read_store().get('tradingagents', {})
    if not root.is_dir():
        return {s: saved[s] for s in symbols if isinstance(s, str) and s in saved}
    for symbol in symbols:
        if not isinstance(symbol, str) or not SYMBOL.match(symbol):
            continue
        folders = sorted((p for p in root.glob(symbol + '_*') if p.is_dir() and re.fullmatch(r'\d{8}_\d{6}', p.name[len(symbol) + 1:])),
                         key=lambda p: p.name[len(symbol) + 1:], reverse=True)
        for folder in folders:
            parsed = parse_report(folder)
            if parsed:
                out[symbol] = parsed
                break
        if symbol not in out and symbol in saved:   # the tool's own folder is gone: use the platform's copy
            out[symbol] = saved[symbol]
    return out


def report_html(symbol, name):
    """Path of a saved complete_report.html, validated against the known reports folder."""
    if not SYMBOL.match(symbol or '') or not re.fullmatch(re.escape(symbol) + r'_\d{8}_\d{6}', name or ''):
        return None
    path = (reports_dir() / name / 'complete_report.html').resolve()
    return path if path.is_file() and reports_dir().resolve() in path.parents else None


def cli_environment():
    """TRADINGAGENTS_* variables from the CLI's own saved answers, so a run reuses the user's provider and models."""
    env = dict(os.environ)
    env.setdefault('TRADINGAGENTS_NO_UPDATE_CHECK', '1')
    try:
        prefs = json.loads((TA_HOME / 'cli_prefs.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        prefs = {}
    mapping = {'llm_provider': 'TRADINGAGENTS_LLM_PROVIDER', 'quick_think_llm': 'TRADINGAGENTS_QUICK_THINK_LLM',
               'deep_think_llm': 'TRADINGAGENTS_DEEP_THINK_LLM', 'output_language': 'TRADINGAGENTS_OUTPUT_LANGUAGE',
               'backend_url': 'TRADINGAGENTS_LLM_BACKEND_URL'}
    for key, variable in mapping.items():
        if isinstance(prefs.get(key), str) and prefs[key] and variable not in env:
            env[variable] = prefs[key]
    depth = prefs.get('research_depth')
    if isinstance(depth, int) and 1 <= depth <= 5:
        env.setdefault('TRADINGAGENTS_MAX_DEBATE_ROUNDS', str(depth))
        env.setdefault('TRADINGAGENTS_MAX_RISK_ROUNDS', str(depth))
    analysts = prefs.get('analysts')
    names = ','.join(a for a in analysts if isinstance(a, str) and re.fullmatch(r'[a-z]+', a)) if isinstance(analysts, list) else ''
    return env, names or 'market,social,news,fundamentals'


def explain_failure(err):
    """A short, safe reason for a failed run, chosen from known error classes (never raw output, which may name the account)."""
    text = err.decode('utf-8', 'replace') if isinstance(err, bytes) else (err or '')
    tail = text[-4000:]
    if re.search(r'ConnectionError|APITimeoutError|TimeoutError|Connection error', tail):
        return CONNECTION_MESSAGE
    if re.search(r'AuthenticationError|PermissionDenied|\b401\b|\b403\b|login', tail, re.I):
        return 'The AI provider rejected the sign-in. Sign in again in TradingAgents (for ChatGPT: tradingagents login chatgpt), then run again.'
    if re.search(r'RateLimit|\b429\b|quota', tail, re.I):
        return 'The AI provider is rate-limiting or out of quota. Wait, then run again.'
    return 'TradingAgents stopped with an error (see its own logs).'


def write_log(symbol, code, out, err):
    """Keep the tail of a run's output next to TradingAgents' own logs, so a failed run can be diagnosed."""
    text = lambda v: v.decode('utf-8', 'replace') if isinstance(v, bytes) else (v or '')
    try:
        folder = TA_HOME / 'logs' / 'dashboard_runs'
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f'{symbol}.log').write_text(f'exit: {code}\n--- stdout (tail)\n{text(out)[-6000:]}\n--- stderr (tail)\n{text(err)[-6000:]}\n', encoding='utf-8')
    except OSError:
        pass



_store_lock = threading.Lock()


def read_store():
    try:
        data = json.loads(STORE.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_result(program, symbol, result):
    """Keep a result in the platform file (atomic), so it stays visible and can be published with the site."""
    with _store_lock:
        data = read_store()
        data.setdefault(program, {})[symbol] = result
        STORE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STORE.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
        os.replace(tmp, STORE)


def vibe_binary():
    found = os.environ.get('VIBE_TRADING_BIN') or shutil.which('vibe-trading') or str(Path.home() / '.local' / 'bin' / 'vibe-trading')
    return Path(found) if Path(found).is_file() else None


def vibe_available():
    return vibe_binary() is not None


def parse_vibe_output(text):
    """The final answer of a Vibe-Trading run: the repeated block after the run header, else the text before 'Status:'."""
    text = re.sub(r'\x1b\[[0-9;]*m', '', text or '')
    after = re.search(r'Run dir:[^\n]*\n(.*?)(?:\n--show |\Z)', text, re.S)
    block = re.sub(r'^(?:(?:Reason|Elapsed|Run ID|Status)[^\n]*\n)+\s*', '', after.group(1).strip() + '\n') .strip() if after else ''
    if not block:
        head = text.split('\nStatus:')[0]
        found = re.search(r'^\*\*.*', head, re.M | re.S)
        block = found.group(0).strip() if found else ''
    verdict = (re.search(r'Verdict\W+(Bullish|Neutral|Bearish)', block, re.I) or re.search(r'[\u2014:-]\s*\**(Bullish|Neutral|Bearish)\b', block, re.I)
               or re.search(r'\b(Bullish|Neutral|Bearish)\b', block))
    name = verdict.group(1).capitalize() if verdict else None
    return {'text': block, 'verdict': name}


def run_vibe(symbol):
    """One Vibe-Trading run; raises RuntimeError with a short safe message."""
    try:
        result = subprocess.run([str(vibe_binary()), '-p', VIBE_PROMPT.format(symbol=symbol, listing=symbol.replace('.', '-') + '.US'), '--no-rich'], capture_output=True, text=True,
                                timeout=VIBE_TIMEOUT, cwd=Path.home())
    except subprocess.TimeoutExpired:
        raise RuntimeError('The run took too long and was stopped.') from None
    except OSError:
        raise RuntimeError('Vibe-Trading could not be started.') from None
    write_log('vibe_' + symbol, result.returncode, result.stdout, result.stderr)
    parsed = parse_vibe_output(result.stdout)
    if result.returncode != 0 or not parsed['text']:
        raise RuntimeError(explain_failure(result.stderr + result.stdout[-2000:]))
    summary = _short(re.sub(r'\*\*|※', '', parsed['text']), 700)
    return {'rating': parsed['verdict'], 'ratingText': parsed['verdict'] or '', 'date': date.today().isoformat(),
            'generated': datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'summary': summary, 'text': parsed['text'][:6000], 'html': False}


class Queue:
    """Runs the TradingAgents CLI one ticker at a time in a background thread."""
    def __init__(self):
        self.lock = threading.Lock()
        self.state = self.idle()

    @staticmethod
    def idle():
        return {'running': False, 'program': None, 'queue': [], 'current': None, 'done': [], 'errors': {}, 'startedAt': None}

    def snapshot(self):
        with self.lock:
            return json.loads(json.dumps(self.state))

    def start(self, symbols, today=None, program='tradingagents'):
        if program not in PROGRAMS:
            raise ValueError('Unknown program.')
        clean = []
        for symbol in symbols if isinstance(symbols, list) else []:
            symbol = str(symbol).strip().upper()
            if SYMBOL.match(symbol) and symbol not in clean:
                clean.append(symbol)
        clean = clean[:MAX_SYMBOLS]
        if not clean:
            raise ValueError('Choose at least one valid symbol.')
        if not (available() if program == 'tradingagents' else vibe_available()):
            raise RuntimeError(('TradingAgents' if program == 'tradingagents' else 'Vibe-Trading') + ' is not installed at the configured location.')
        with self.lock:
            if self.state['running']:
                return False
            self.state = {'running': True, 'program': program, 'queue': list(clean), 'current': None, 'done': [], 'errors': {}, 'startedAt': time.time()}
        threading.Thread(target=self._work, args=(clean, today or date.today().isoformat(), program), daemon=True).start()
        return True

    def _work(self, symbols, day, program='tradingagents'):
        env, analysts = cli_environment()
        for symbol in symbols:
            with self.lock:
                self.state['current'] = symbol
                self.state['queue'] = [s for s in self.state['queue'] if s != symbol]
            error = None
            if program == 'vibe':
                try:
                    for attempt in range(CONNECTION_RETRIES + 1):
                        try:
                            save_result('vibe', symbol, run_vibe(symbol))
                            break
                        except RuntimeError as exc:
                            if attempt >= CONNECTION_RETRIES or str(exc) != CONNECTION_MESSAGE:
                                raise
                except RuntimeError as exc:
                    error = str(exc)
                except Exception:
                    error = 'Vibe-Trading could not be started.'
                with self.lock:
                    (self.state['errors'].__setitem__(symbol, error) if error else self.state['done'].append(symbol))
                continue
            try:
                for attempt in range(CONNECTION_RETRIES + 1):
                    result = subprocess.run([str(python_path()), '-m', 'cli.main', '--ticker', symbol, '--date', day, '--analysts', analysts,
                                             '--save', '--no-show', '--html'], cwd=TA_DIR, env=env, capture_output=True, text=True, timeout=RUN_TIMEOUT)
                    write_log(symbol, result.returncode, result.stdout, result.stderr)
                    # a dropped connection to the AI provider is usually momentary (the same stock ran fine minutes later)
                    if result.returncode == 0 or explain_failure(result.stderr).split(' (')[0] != CONNECTION_MESSAGE.split(' (')[0]:
                        break
                if result.returncode != 0:
                    error = explain_failure(result.stderr)
                else:
                    saved = latest([symbol]).get(symbol)
                    if saved:
                        save_result('tradingagents', symbol, saved)
            except subprocess.TimeoutExpired as exc:
                write_log(symbol, 'timeout', exc.stdout, exc.stderr)
                error = 'The run took too long and was stopped.'
            except Exception:   # a failed ticker must never leave the queue stuck in the running state
                error = 'TradingAgents could not be started.'
            with self.lock:
                (self.state['errors'].__setitem__(symbol, error) if error else self.state['done'].append(symbol))
        with self.lock:
            self.state['running'] = False
            self.state['current'] = None


def public(symbols, queue, program='tradingagents'):
    """Payload for the dashboard: saved short conclusions plus the run state."""
    program = program if program in PROGRAMS else 'tradingagents'
    return {'program': program, 'available': available() if program == 'tradingagents' else vibe_available(), 'results': latest(symbols, program),
            'run': queue.snapshot(), 'today': date.today().isoformat(), 'checkedAt': datetime.now().astimezone().isoformat(timespec='seconds')}
