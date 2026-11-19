import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import webbrowser

import dashboard

BASE = Path(__file__).resolve().parent


class Runner:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = {'running': False, 'progress': 0, 'message': 'Pregatit', 'report': None, 'error': None}
        self.data = None

    def start(self):
        with self.lock:
            if self.state['running']:
                return False
            self.state = {'running': True, 'progress': 1, 'message': 'Pornire program Yahoo SP500...', 'report': None, 'error': None}
            self.data = None
        threading.Thread(target=self.run, daemon=True).start()
        return True

    def run(self):
        try:
            report = None
            env = __import__('os').environ.copy()
            env['PYTHONIOENCODING'] = 'utf-8'
            with subprocess.Popen([sys.executable, '-u', str(BASE/'yahoo_unificat.py')], cwd=BASE,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, encoding='utf-8', errors='replace', env=env) as process:
                tail = []
                for line in process.stdout:
                    line = line.strip()
                    tail.append(line)
                    tail = tail[-12:]
                    match = re.match(r'\[(\d+)/(\d+)\]', line)
                    with self.lock:
                        if match:
                            self.state['progress'] = min(95, 5+90*int(match[1])/max(1, int(match[2])))
                        self.state['message'] = line[:500]
                    if line.startswith('Raport filtrat: '):
                        report = Path(line.split(': ', 1)[1]).resolve()
                code = process.wait()
            if code != 0:
                raise RuntimeError('Programul a esuat: ' + '\n'.join(tail))
            if report is None or report.parent != (BASE/'Output').resolve() or not report.is_file():
                raise RuntimeError('Raportul nou nu a fost identificat; nu se incarca un Excel vechi.')
            data = dashboard.payload(report)
            with self.lock:
                self.data = data
                self.state.update(running=False, progress=100, message='Gata. Excelul nou a fost generat si incarcat.', report=report.name)
        except Exception as exc:
            with self.lock:
                self.state.update(running=False, error=str(exc), message='Rulare esuata')

    def snapshot(self):
        with self.lock:
            return dict(self.state)


def make_server(port=8765):
    runner = Runner()
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, data, content_type='application/json; charset=utf-8'):
            body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(body)

        def trusted(self, api=False):
            expected = f'127.0.0.1:{self.server.server_port}'
            if self.headers.get('Host') != expected:
                self.reply(403, {'error': 'Host refuzat'})
                return False
            origin = self.headers.get('Origin')
            if origin and origin != f'http://{expected}':
                self.reply(403, {'error': 'Origin refuzat'})
                return False
            if api and not secrets.compare_digest(self.headers.get('X-Dashboard-Token', ''), token):
                self.reply(403, {'error': 'Token invalid'})
                return False
            return True

        def do_POST(self):
            if not self.trusted(api=True):
                return
            if self.path != '/api/run':
                self.reply(404, {'error': 'Ruta necunoscuta'})
                return
            if runner.start():
                self.reply(202, runner.snapshot())
            else:
                self.reply(409, {'error': 'Programul ruleaza deja'})

        def do_GET(self):
            if not self.trusted(api=self.path.startswith('/api/')):
                return
            if self.path == '/api/status':
                self.reply(200, runner.snapshot())
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
                    html = html.replace('<script id="data"', '<script>window.dashboardRunToken='+json.dumps(token)+';</script><script id="data"', 1)
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

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.runner = runner
    server.token = token
    return server


def main():
    parser = argparse.ArgumentParser(description='Dashboard local: lanseaza SP500 din browser.')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    server = make_server(args.port)
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'Dashboard: {url} ; Ctrl+C pentru oprire.', flush=True)
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
