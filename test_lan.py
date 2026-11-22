from http.client import HTTPConnection
import json
import threading
import unittest
from unittest.mock import patch

import dashboard_server


class LanTests(unittest.TestCase):
    def setUp(self):
        with patch.object(dashboard_server, 'lan_ip', return_value='192.168.1.50'):
            self.server = dashboard_server.make_server(0, lan=True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.host = f'192.168.1.50:{self.server.server_port}'
        remote = patch.object(self.server.RequestHandlerClass, 'local', return_value=False)   # behave like a phone
        remote.start()
        self.addCleanup(remote.stop)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method, path, body=None, headers=None):
        c = HTTPConnection('127.0.0.1', self.server.server_port)
        c.request(method, path, body=body, headers={'Host': self.host, **(headers or {})})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, dict(r.getheaders()), data

    def test_phone_must_enter_pin(self):
        status, _, page = self.call('GET', '/')
        self.assertEqual(status, 401)
        self.assertIn(b'name="pin"', page)
        self.assertEqual(self.call('GET', '/api/status', headers={'X-Dashboard-Token': self.server.token})[0], 401)
        form = {'Content-Type': 'application/x-www-form-urlencoded'}
        self.assertEqual(self.call('POST', '/login', 'pin=000000' if self.server.pin != '000000' else 'pin=111111', form)[0], 401)
        status, headers, _ = self.call('POST', '/login', 'pin=' + self.server.pin, form)
        self.assertEqual(status, 303)
        cookie = headers['Set-Cookie'].split(';')[0]
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        auth = {'Cookie': cookie, 'X-Dashboard-Token': self.server.token}
        self.assertEqual(self.call('GET', '/api/status', headers=auth)[0], 200)
        status, _, page = self.call('GET', '/', headers={'Cookie': cookie})
        self.assertEqual(status, 200)
        self.assertNotIn(b'window.dashboardLan=', page)    # the PIN is never sent to the phone
        self.assertNotIn(('PIN: ' + self.server.pin).encode(), page)
        self.assertNotIn(('"pin": "' + self.server.pin + '"').encode(), page)

    def test_lockout_and_foreign_host(self):
        form = {'Content-Type': 'application/x-www-form-urlencoded'}
        wrong = 'pin=000000' if self.server.pin != '000000' else 'pin=111111'
        for _ in range(5):
            self.call('POST', '/login', wrong, form)
        status, _, page = self.call('POST', '/login', 'pin=' + self.server.pin, form)
        self.assertEqual(status, 401)
        self.assertIn('10 minute'.encode(), page)
        self.assertEqual(self.call('GET', '/', headers={'Host': 'evil.example'})[0], 403)

    def test_local_mode_rejects_lan_host(self):
        server = dashboard_server.make_server(0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            c = HTTPConnection('127.0.0.1', server.server_port)
            c.request('GET', '/api/status', headers={'Host': f'192.168.1.50:{server.server_port}'})
            self.assertEqual(c.getresponse().status, 403)
        finally:
            server.shutdown(); server.server_close()


if __name__ == '__main__':
    unittest.main()
