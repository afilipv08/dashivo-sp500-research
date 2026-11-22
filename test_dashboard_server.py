from http.client import HTTPConnection
import json
import threading
import unittest
from unittest.mock import patch

import dashboard_server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.server = dashboard_server.make_server(0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, headers=None, body=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response.status, json.loads(body)

    def test_requires_token(self):
        self.assertEqual(self.request('POST', '/api/run')[0], 403)
        self.assertFalse(self.server.runner.snapshot()['running'])

    def test_rejects_foreign_origin_and_host(self):
        headers = {'X-Dashboard-Token': self.server.token, 'Origin': 'https://attacker.example'}
        self.assertEqual(self.request('POST', '/api/run', headers)[0], 403)
        self.assertEqual(self.request('GET', '/api/status', {'Host': 'attacker.example'})[0], 403)

    def test_start_progress_and_result(self):
        headers = {'X-Dashboard-Token': self.server.token}
        with patch.object(self.server.runner, 'run'):
            self.assertEqual(self.request('POST', '/api/run', headers)[0], 202)
            self.assertEqual(self.request('POST', '/api/run', headers)[0], 409)
            status, state = self.request('GET', '/api/status', headers)
            self.assertEqual(status, 200)
            self.assertTrue(state['running'])
            self.assertEqual(self.request('GET', '/api/result', headers)[0], 409)
            with self.server.runner.lock:
                self.server.runner.data = {'source': 'new.xlsx'}
                self.server.runner.state.update(running=False, progress=100, report='new.xlsx')
            self.assertEqual(self.request('GET', '/api/result', headers)[1]['source'], 'new.xlsx')

    def test_resume_flag_is_passed(self):
        headers = {'X-Dashboard-Token': self.server.token, 'Content-Type': 'application/json'}
        with patch.object(self.server.runner, 'run'):
            self.assertEqual(self.request('POST', '/api/run', headers, json.dumps({'resume': True}))[0], 202)
            self.assertTrue(self.server.runner.resume)

    def test_progress_from_program_output(self):
        runner = dashboard_server.Runner()
        runner.start = lambda resume=False: None
        runner.started = 0
        runner.state['running'] = True
        for line in ['PHASE list', 'PHASE quotes 10 4', '[5/10] AAA: OK', '[6/10] BBB: EROARE: 404']:
            self.assertIsNone(runner.consume(line))
        state = runner.snapshot()
        self.assertEqual((state['phase'], state['done'], state['total'], state['ok'], state['errors'], state['resumed']), ('quotes', 6, 10, 1, 1, 4))
        self.assertIsNotNone(state['eta'])
        self.assertEqual(state['message'], '[6/10] BBB: EROARE: 404')
        self.assertEqual(runner.consume('Raport filtrat: /tmp/x.xlsx').name, 'x.xlsx')


if __name__ == '__main__':
    unittest.main()
