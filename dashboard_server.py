import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

import agents_bridge
import crypto
import dashboard
import live_prices
import portfolio
import ratings
import top10_history

BASE = Path(__file__).resolve().parent
MARKET_HISTORY_CACHE = {'data': None, 'fetched': 0.0}
MARKET_HISTORY_LOCK = threading.Lock()
INTRINSIC_CACHE = {'data': None, 'fetched': 0.0}
INTRINSIC_LOCK = threading.Lock()
AGENT_QUEUE = agents_bridge.Queue()


def market_history():
    """Read local history or the published public history; never expose API credentials."""
    with MARKET_HISTORY_LOCK:
        if MARKET_HISTORY_CACHE['data'] and time.monotonic() - MARKET_HISTORY_CACHE['fetched'] < 1800:
            return MARKET_HISTORY_CACHE['data']
        local = BASE / 'site' / 'data' / 'history.json'
        data = None
        try:
            candidate = json.loads(local.read_text(encoding='utf-8'))
            if '^GSPC' in candidate.get('series', {}):
                data = candidate
        except (OSError, ValueError):
            pass
        if data is None:
            url = 'https://afilipv08.github.io/dashivo-sp500-research/data/history.json?t=' + str(int(time.time()))
            with urllib.request.urlopen(url, timeout=20) as response:
                data = json.loads(response.read())
        MARKET_HISTORY_CACHE.update(data=data, fetched=time.monotonic())
        return data


def intrinsic_values():
    """Read the published attribution-safe valuation snapshot; never fetch SEC with a browser request."""
    with INTRINSIC_LOCK:
        if INTRINSIC_CACHE['data'] and time.monotonic() - INTRINSIC_CACHE['fetched'] < 1800:
            return INTRINSIC_CACHE['data']
        local = BASE / 'site' / 'data' / 'intrinsic_values.json'
        data = None
        try:
            candidate = json.loads(local.read_text(encoding='utf-8'))
            if isinstance(candidate, dict) and isinstance(candidate.get('sources'), dict):
                data = candidate
        except (OSError, ValueError):
            pass
        if data is None:
            url = 'https://afilipv08.github.io/dashivo-sp500-research/data/intrinsic_values.json?t=' + str(int(time.time()))
            with urllib.request.urlopen(url, timeout=20) as response:
                data = json.loads(response.read())
        INTRINSIC_CACHE.update(data=data, fetched=time.monotonic())
        return data


PHASES = ('list', 'quotes', 'export', 'load')


def checkpoint_status():
    from yahoo_unificat import checkpoint_status as status   # lazy: keeps server start-up light
    return status()


class Runner:
    """Runs yahoo_unificat.py and turns its output into a progress state for the page."""
    IDLE = {'running': False, 'progress': 0, 'message': 'Ready to start.', 'report': None, 'error': None,
            'phase': None, 'done': 0, 'total': 0, 'ok': 0, 'errors': 0, 'resumed': 0}

    def __init__(self):
        self.lock = threading.Lock()
        self.state = dict(self.IDLE)
        self.data = None
        self.resume = False
        self.started = self.quotes_started = None

    def start(self, resume=False):
        with self.lock:
            if self.state['running']:
                return False
            self.state = dict(self.IDLE, running=True, progress=1, phase='list', message='Starting the Yahoo SP500 program…')
            self.data, self.resume = None, bool(resume)
            self.started, self.quotes_started = time.monotonic(), None
        threading.Thread(target=self.run, daemon=True).start()
        return True

    def consume(self, line):
        """Update the state from one output line; returns the report path when the program announces it."""
        with self.lock:
            st = self.state
            if line.startswith('PHASE '):
                parts = line.split()
                st['phase'] = parts[1]
                if parts[1] == 'quotes':
                    st['total'] = int(parts[2]) if len(parts) > 2 else 0
                    st['done'] = st['resumed'] = int(parts[3]) if len(parts) > 3 else 0
                    st['progress'] = 5 + 90 * st['done'] / max(1, st['total'])
                    self.quotes_started = time.monotonic()
                elif parts[1] == 'export':
                    st['progress'] = 96
                return None
            match = re.match(r'\[(\d+)/(\d+)\] \S+: (.*)', line)
            if match:
                st['done'], st['total'] = int(match[1]), int(match[2])
                st['errors' if match[3].startswith('EROARE') else 'ok'] += 1
                st['progress'] = min(95, 5 + 90 * st['done'] / max(1, st['total']))
            st['message'] = line[:500]
        if line.startswith('Raport filtrat: '):
            return Path(line.split(': ', 1)[1]).resolve()
        return None

    def run(self):
        try:
            report = None
            env = __import__('os').environ.copy()
            env['PYTHONIOENCODING'] = 'utf-8'
            command = [sys.executable, '-u', str(BASE/'yahoo_unificat.py')] + (['--resume'] if self.resume else [])
            with subprocess.Popen(command, cwd=BASE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, encoding='utf-8', errors='replace', env=env) as process:
                tail = []
                for line in process.stdout:
                    line = line.strip()
                    tail = (tail + [line])[-12:]
                    report = self.consume(line) or report
                code = process.wait()
            if code != 0:
                raise RuntimeError('Programul a esuat: ' + '\n'.join(tail))
            if report is None or report.parent != (BASE/'Output').resolve() or not report.is_file():
                raise RuntimeError('Raportul nou nu a fost identificat; nu se incarca un Excel vechi.')
            with self.lock:
                self.state.update(phase='load', progress=98)
            data = dashboard.load_payload(report)
            with self.lock:
                self.data = data
                self.state.update(running=False, progress=100, phase='done', message='Done. The new Excel was generated and loaded.', report=report.name)
        except Exception as exc:
            with self.lock:
                self.state.update(running=False, error=str(exc), message='Run failed. Previous data is retained.')

    def snapshot(self):
        with self.lock:
            st = dict(self.state)
            now = time.monotonic()
            st['elapsed'] = round(now - self.started) if self.started and st['running'] else None
            fresh = st['done'] - st['resumed']
            st['eta'] = (round((now - self.quotes_started) / fresh * (st['total'] - st['done']))
                         if st['running'] and st['phase'] == 'quotes' and self.quotes_started and fresh > 0 else None)
        if not st['running']:
            try:
                st['resumable'] = checkpoint_status()
            except Exception:
                st['resumable'] = None
        return st


def lan_ip():
    """This PC's address in the local network (no packet is sent: UDP connect only picks the route)."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(('192.168.1.1', 9))
            return probe.getsockname()[0]
        except OSError:
            return '127.0.0.1'


def tailscale_ip():
    """This PC's Tailscale address (100.64.0.0/10), if Tailscale is installed and connected."""
    import ipaddress, socket
    try:
        addresses = {a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}
    except OSError:
        return None
    return next((a for a in sorted(addresses) if ipaddress.ip_address(a) in ipaddress.ip_network('100.64.0.0/10')), None)


def allowed_host(host, port, lan):
    """Host header check against DNS rebinding: an attacker's domain never matches.
    Local mode: 127.0.0.1 / localhost only. Phone mode: also private, CGNAT (Tailscale) IP literals on our
    port, and *.ts.net names (Tailscale MagicDNS / `tailscale serve` HTTPS, port omitted)."""
    import ipaddress
    host = (host or '').strip().lower()
    name, _, given = host.rpartition(':') if host.count(':') == 1 else (host, '', '')
    if name in ('127.0.0.1', 'localhost'):
        return given == str(port)
    if not lan:
        return False
    if name.endswith('.ts.net'):
        return given in ('', str(port), '443')
    try:
        ip = ipaddress.ip_address(name)
    except ValueError:
        return False
    return given == str(port) and ip.version == 4 and (ip.is_private or ip in ipaddress.ip_network('100.64.0.0/10'))


PUBLIC = ('/manifest.webmanifest', '/icon.png')   # no data inside: phones fetch them before / without signing in


LOGIN_PAGE = """<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashivo SP500 Research</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4f2;font:16px -apple-system,Segoe UI,Roboto,sans-serif;color:#1f1517}
form{background:#fff;border-radius:18px;padding:28px 24px;width:min(340px,90vw);box-shadow:0 14px 40px rgba(0,0,0,.12);text-align:center}
h1{margin:0 0 4px;color:#c8000a;font-size:24px}p{color:#6c6357;font-size:14px;margin:6px 0 18px}
input{width:100%;box-sizing:border-box;font-size:28px;letter-spacing:.4em;text-align:center;padding:12px;border:1px solid #e0d5d2;border-radius:12px}
button{margin-top:14px;width:100%;padding:13px;border:0;border-radius:12px;background:#c8000a;color:#fff;font-weight:800;font-size:16px}.err{color:#c8102e;font-weight:700}</style></head>
<body><form method="post" action="/login"><h1>Dashivo</h1><p>SP500 Research · introdu PIN-ul afișat pe calculator<br>enter the PIN shown on the computer</p>__ERR__
<input name="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus><button>Intră / Enter</button></form></body></html>"""


def make_server(port=8765, lan=False):
    """lan=True: reachable from phones in the same network, every non-local visitor must enter a PIN first."""
    runner = Runner()
    token = secrets.token_urlsafe(32)
    pin = f'{secrets.randbelow(10 ** 6):06d}'
    session = secrets.token_urlsafe(32)
    failures = {}   # ip -> [count, first failure time]

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, data, content_type='application/json; charset=utf-8', headers=None):
            body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(body)

        def local(self):
            # a reverse proxy on this PC (e.g. `tailscale serve`) connects from loopback: its visitors are remote
            proxied = any(self.headers.get(h) for h in ('X-Forwarded-For', 'Forwarded', 'Tailscale-User-Login'))
            return self.client_address[0] in ('127.0.0.1', '::1') and not proxied

        def signed_in(self):
            if self.local():
                return True
            cookies = dict(part.strip().split('=', 1) for part in (self.headers.get('Cookie') or '').split(';') if '=' in part)
            return secrets.compare_digest(cookies.get('sp500_session', ''), session)

        def login_page(self, error=''):
            html = LOGIN_PAGE.replace('__ERR__', f'<p class="err">{error}</p>' if error else '')
            self.reply(401, html.encode('utf-8'), 'text/html; charset=utf-8')

        def login(self):
            ip, now = self.client_address[0], time.time()
            count, first = failures.get(ip, [0, now])
            if count >= 5 and now - first < 600:
                return self.login_page('Prea multe încercări. Așteaptă 10 minute. / Too many attempts, wait 10 minutes.')
            from urllib.parse import parse_qs
            length = min(int(self.headers.get('Content-Length') or 0), 200)
            given = parse_qs(self.rfile.read(length).decode('utf-8', 'replace')).get('pin', [''])[0].strip()
            if secrets.compare_digest(given, pin):
                failures.pop(ip, None)
                self.reply(303, b'', 'text/plain', {'Location': '/', 'Set-Cookie': f'sp500_session={session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000'})
            else:
                failures[ip] = [count + 1 if now - first < 600 else 1, first if now - first < 600 else now]
                self.login_page('PIN greșit. / Wrong PIN.')

        def trusted(self, api=False):
            port_ = self.server.server_port
            if not allowed_host(self.headers.get('Host'), port_, lan):
                self.reply(403, {'error': 'Host refuzat'})
                return False
            origin = self.headers.get('Origin')
            if origin and not (origin.startswith(('http://', 'https://')) and allowed_host(origin.split('://', 1)[1], port_ if origin.startswith('http://') else 443, lan)
                               and origin.split('://', 1)[1] == self.headers.get('Host')):
                self.reply(403, {'error': 'Origin refuzat'})
                return False
            if not self.signed_in():
                if api:
                    self.reply(401, {'error': 'Sign in with the PIN first.'})
                elif self.command == 'POST' and self.path == '/login':
                    self.login()
                else:
                    self.login_page()
                return False
            if api and not secrets.compare_digest(self.headers.get('X-Dashboard-Token', ''), token):
                self.reply(403, {'error': 'Token invalid'})
                return False
            return True

        def body(self, limit=1024):
            try:
                length = int(self.headers.get('Content-Length') or 0)
                if length > limit:
                    return None
                data = json.loads(self.rfile.read(length) or b'{}') if length else {}
            except (ValueError, json.JSONDecodeError):
                return {}
            return data if isinstance(data, dict) else {}

        def portfolio_post(self, action, body):
            """Demo portfolio operations; ValueError/PriceError messages are English UI text."""
            try:
                if action == 'buy':
                    position, view = portfolio.buy(body.get('symbol'), body.get('amount'), body.get('analysis'), body.get('reportPrice'))
                    self.reply(200, {'position': position, 'portfolio': view})
                elif action == 'sell':
                    closed, view = portfolio.sell(str(body.get('id', '')))
                    self.reply(200, {'closed': closed, 'portfolio': view})
                elif action == 'deposit':
                    self.reply(200, {'portfolio': portfolio.deposit(body.get('amount'))})
                elif action == 'capital':
                    self.reply(200, {'portfolio': portfolio.set_capital(body.get('amount'))})
                elif action == 'prices':
                    self.reply(200, {'portfolio': portfolio.refresh_prices()})
                else:
                    self.reply(404, {'error': 'Ruta necunoscuta'})
            except (ValueError, portfolio.PriceError) as exc:
                self.reply(400, {'error': str(exc)})

        def do_POST(self):
            if self.path == '/login':
                if self.trusted():
                    self.reply(303, b'', 'text/plain', {'Location': '/'})
                return
            if not self.trusted(api=True):
                return
            if self.path == '/api/crypto/refresh':
                try:
                    self.reply(200, crypto.public(crypto.refresh()))
                except Exception as exc:
                    old = crypto.public(crypto.cached())
                    self.reply(502, {'error': 'Crypto data is unavailable right now.', 'detail': str(exc)[:200], 'data': old})
                return
            if self.path == '/api/live-prices':
                body = self.body(64 * 1024)
                symbols = body.get('symbols') if isinstance(body, dict) else None
                try:
                    self.reply(200, live_prices.refresh(symbols if isinstance(symbols, list) else []))
                except ValueError as exc:
                    self.reply(400, {'error': str(exc)})
                except Exception:
                    self.reply(502, {'error': 'Live prices are unavailable right now.', **live_prices.cached()})
                return
            if self.path == '/api/agents/run':
                if not self.local():   # starting an AI run spends the owner's account and time: this computer only
                    self.reply(403, {'error': 'AI agent runs can only be started on the computer that hosts the dashboard.'})
                    return
                body = self.body(4 * 1024) or {}
                try:
                    started = AGENT_QUEUE.start(body.get('symbols'))
                except ValueError as exc:
                    self.reply(400, {'error': str(exc)})
                except RuntimeError as exc:
                    self.reply(503, {'error': str(exc)})
                else:
                    self.reply(202 if started else 409, AGENT_QUEUE.snapshot() if started else {'error': 'An AI agent run is already in progress.'})
                return
            if self.path.startswith('/api/portfolio/'):
                body = self.body(64 * 1024)
                if body is None:
                    self.reply(413, {'error': 'Request too large.'})
                else:
                    self.portfolio_post(self.path.rsplit('/', 1)[1], body)
                return
            if self.path != '/api/run':
                self.reply(404, {'error': 'Ruta necunoscuta'})
                return
            body = self.body() or {}
            if runner.start(resume=body.get('resume') is True):
                self.reply(202, runner.snapshot())
            else:
                self.reply(409, {'error': 'Programul ruleaza deja'})

        def do_GET(self):
            if not self.trusted(api=self.path.startswith('/api/')):
                return
            if self.path == '/api/status':
                self.reply(200, runner.snapshot())
            elif self.path.startswith('/api/ratings?'):
                from urllib.parse import parse_qs, urlsplit
                try:
                    self.reply(200, ratings.history(parse_qs(urlsplit(self.path).query).get('symbol', [''])[0]))
                except ValueError as exc:
                    self.reply(400, {'error': str(exc)})
                except Exception:
                    self.reply(502, {'error': 'Rating history is unavailable right now.'})
            elif self.path == '/api/top10-history':
                self.reply(200, top10_history.load())
            elif self.path == '/api/market-history':
                try:
                    self.reply(200, market_history())
                except Exception:
                    self.reply(503, {'error': 'Daily market history (including the S&P 500 benchmark) is unavailable right now.'})
            elif self.path == '/api/intrinsic-values':
                try:
                    self.reply(200, intrinsic_values())
                except Exception:
                    self.reply(503, {'error': 'Intrinsic-value source data is unavailable right now.'})
            elif self.path.startswith('/api/agents'):
                from urllib.parse import parse_qs, urlsplit
                symbols = [x for x in parse_qs(urlsplit(self.path).query).get('symbols', [''])[0].split(',') if x][:agents_bridge.MAX_SYMBOLS]
                self.reply(200, agents_bridge.public(symbols, AGENT_QUEUE))
            elif self.path.startswith('/agents-report/'):
                name = self.path[len('/agents-report/'):].split('?', 1)[0]
                path = agents_bridge.report_html(name.rsplit('_', 2)[0], name) if self.local() else None
                if path:
                    self.reply(200, path.read_bytes(), 'text/html; charset=utf-8')
                else:
                    self.reply(404, {'error': 'Report not found.'})
            elif self.path == '/api/crypto':
                data = crypto.public(crypto.cached())
                self.reply(200 if data else 404, data or {'error': 'No crypto data yet.'})
            elif self.path == '/api/live-prices':
                self.reply(200, live_prices.cached())
            elif self.path == '/api/portfolio':
                self.reply(200, portfolio.summary(portfolio.load()))
            elif self.path.startswith('/api/portfolio/history?'):
                from urllib.parse import parse_qs, urlsplit
                try:
                    self.reply(200, portfolio.history(parse_qs(urlsplit(self.path).query).get('id', [''])[0]))
                except ValueError as exc:
                    self.reply(400, {'error': str(exc)})
                except Exception:
                    self.reply(502, {'error': 'Price history is unavailable right now.'})
            elif self.path == '/api/result':
                with runner.lock:
                    data = runner.data
                self.reply(200 if data else 409, data or {'error': 'Rezultatul nu este pregatit'})
            elif self.path == '/':
                try:
                    reports = list((BASE/'Output').glob('SP500_*.xlsx'))
                    latest = max(reports, key=lambda p: p.stat().st_mtime)
                    html_path = dashboard.export_dashboard(latest)
                    html = html_path.read_text(encoding='utf-8')
                    boot = 'window.dashboardRunToken=' + json.dumps(token) + ';'
                    if lan and self.local():   # only the computer itself is shown how to connect the phone
                        ts = tailscale_ip()
                        boot += 'window.dashboardLan=' + json.dumps({'url': f'http://{self.server.lan_ip}:{self.server.server_port}/', 'pin': pin,
                                                                     'tailscale': f'http://{ts}:{self.server.server_port}/' if ts else None}) + ';'
                    html = html.replace('<script id="data"', '<script>' + boot + '</script><script id="data"', 1)
                    self.reply(200, html.encode('utf-8'), 'text/html; charset=utf-8')
                except Exception as exc:
                    self.reply(500, {'error': str(exc)})
            elif self.path.startswith('/SP500_') and self.path.endswith('.xlsx'):
                from urllib.parse import unquote
                path = (BASE/'Output'/unquote(self.path[1:])).resolve()
                if path.parent != (BASE/'Output').resolve() or not path.is_file():
                    self.reply(404, {'error': 'Fisier inexistent'})
                else:
                    self.reply(200, path.read_bytes(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            else:
                self.reply(404, {'error': 'Ruta necunoscuta'})

    server = ThreadingHTTPServer(('0.0.0.0' if lan else '127.0.0.1', port), Handler)
    server.lan_ip = lan_ip() if lan else '127.0.0.1'
    server.pin = pin
    server.runner = runner
    server.token = token
    return server


def main():
    parser = argparse.ArgumentParser(description='Dashboard local: lanseaza SP500 din browser.')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--lan', action='store_true', help='Accesibil si de pe telefon, in aceeasi retea Wi-Fi (cu PIN).')
    args = parser.parse_args()
    server = make_server(args.port, lan=args.lan)
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'Dashboard: {url} ; Ctrl+C pentru oprire.', flush=True)
    if args.lan:
        print(f'Telefon (aceeasi retea Wi-Fi): http://{server.lan_ip}:{server.server_port}/  PIN: {server.pin}', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
