from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import dashboard_server
import portfolio


class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / 'portfolio.json'
        self.prices = {'AAA': 100.0, 'BBB': 50.0}
        patcher = patch.object(portfolio, 'fetch_price', side_effect=lambda s: self.prices[s])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.dir.cleanup)

    def test_buy_converts_amount_to_shares_and_uses_cash(self):
        position, view = portfolio.buy('aaa', 1000, {'symbol': 'AAA', 'company': 'Alpha', 'gap': .1, 'junk': 1}, 90, self.path)
        self.assertEqual((position['symbol'], position['price'], position['shares'], position['source']), ('AAA', 100.0, 10.0, 'live'))
        self.assertEqual(position['analysis'], {'symbol': 'AAA', 'company': 'Alpha', 'gap': .1})
        self.assertEqual(view['cash'], 9000)
        self.prices['AAA'] = 110.0
        view = portfolio.refresh_prices(self.path)
        self.assertAlmostEqual(view['value'], 1100)
        self.assertAlmostEqual(view['unrealized'], 100)
        self.assertAlmostEqual(view['unrealizedPct'], .1)
        self.assertAlmostEqual(view['equity'], 10100)

    def test_buy_falls_back_to_report_price_and_rejects_bad_input(self):
        self.prices.pop('AAA')
        position, _ = portfolio.buy('AAA', 500, None, 125, self.path)
        self.assertEqual((position['price'], position['source']), (125.0, 'report'))
        for args in [('AAA', -1), ('AAA', 'x'), ('AAA', float('inf')), ('', 10), ('BBB', 20000)]:
            with self.assertRaises(ValueError):
                portfolio.buy(*args, path=self.path)
        with self.assertRaises(portfolio.PriceError):
            portfolio.buy('ZZZ', 10, path=self.path)

    def test_sell_realizes_profit_and_returns_cash(self):
        position, _ = portfolio.buy('BBB', 1000, path=self.path)
        self.prices['BBB'] = 40.0
        closed, view = portfolio.sell(position['id'], self.path)
        self.assertAlmostEqual(closed['proceeds'], 800)
        self.assertEqual(view['positions'], [])
        self.assertAlmostEqual(view['realized'], -200)
        self.assertAlmostEqual(view['cash'], 9800)
        self.assertAlmostEqual(view['closed'][0]['plPct'], -.2)
        with self.assertRaises(ValueError):
            portfolio.sell(position['id'], self.path)

    def test_several_named_portfolios_keep_separate_money_and_positions(self):
        legacy = {'capital': 5000, 'deposits': [], 'positions': [], 'closed': [], 'prices': {}}
        self.path.write_text(json.dumps(legacy), encoding='utf-8')
        first = portfolio.listing(self.path)
        self.assertEqual([(p['name'], p['equity']) for p in first], [(portfolio.DEFAULT_NAME, 5000)])
        created = portfolio.create('  Dividend   picks ', 2000, self.path)
        self.assertEqual((created['name'], created['capital']), ('Dividend picks', 2000))
        main_id, other_id = [p['id'] for p in portfolio.listing(self.path)]
        portfolio.buy('AAA', 1000, path=self.path, pid=other_id)
        self.assertEqual(portfolio.summary(portfolio.load(self.path, other_id))['cash'], 1000)
        self.assertEqual(portfolio.summary(portfolio.load(self.path, main_id))['cash'], 5000)
        self.assertEqual(portfolio.summary(portfolio.load(self.path))['cash'], 5000)   # no id = the first one
        with self.assertRaises(ValueError):
            portfolio.buy('AAA', 3000, path=self.path, pid=other_id)   # only 1,000 left in this one
        portfolio.deposit(250, self.path, other_id)
        self.assertEqual(portfolio.summary(portfolio.load(self.path, other_id))['cash'], 1250)
        position_id = portfolio.load(self.path, other_id)['positions'][0]['id']
        with patch.object(portfolio, 'fetch_history', return_value=[['2026-11-20', 100.0]]):
            self.assertEqual(portfolio.history(position_id, self.path)['symbol'], 'AAA')   # found whichever portfolio holds it

    def test_names_are_validated_and_renamed_and_the_last_portfolio_stays(self):
        with self.assertRaises(ValueError):
            portfolio.create('   ', None, self.path)
        with self.assertRaises(ValueError):
            portfolio.create('x' * (portfolio.MAX_NAME + 1), None, self.path)
        portfolio.create('Growth', None, self.path)
        with self.assertRaises(ValueError):
            portfolio.create('growth', None, self.path)   # same name, other case
        growth = portfolio.listing(self.path)[1]['id']
        with self.assertRaises(ValueError):
            portfolio.rename(growth, portfolio.DEFAULT_NAME, self.path)
        self.assertEqual(portfolio.rename(growth, 'Growth 2', self.path)['name'], 'Growth 2')
        with self.assertRaises(ValueError):
            portfolio.load(self.path, 'missing')
        portfolio.remove(growth, self.path)
        self.assertEqual(len(portfolio.listing(self.path)), 1)
        with self.assertRaises(ValueError):
            portfolio.remove(portfolio.listing(self.path)[0]['id'], self.path)

    def test_deposit_capital_and_persistence(self):
        portfolio.buy('AAA', 6000, path=self.path)
        self.assertAlmostEqual(portfolio.deposit(500, self.path)['cash'], 4500)
        with self.assertRaises(ValueError):
            portfolio.set_capital(5000, self.path)
        view = portfolio.set_capital(20000, self.path)
        self.assertAlmostEqual(view['cash'], 14500)
        self.assertAlmostEqual(view['funded'], 20500)
        self.assertEqual(len(portfolio.load(self.path)['positions']), 1)

    def test_price_failure_keeps_last_price(self):
        portfolio.buy('AAA', 1000, path=self.path)
        self.prices.pop('AAA')
        view = portfolio.refresh_prices(self.path)
        self.assertEqual(view['priceErrors'], ['AAA'])
        self.assertAlmostEqual(view['positions'][0]['current'], 100)


class PortfolioRouteTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        patches = [patch.object(portfolio, 'PATH', Path(self.dir.name) / 'p.json'),
                   patch.object(portfolio, 'fetch_price', return_value=20.0),
                   patch.object(portfolio, 'fetch_history', return_value=[['2026-11-20', 20.0], ['2026-11-21', 21.0]])]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.server = dashboard_server.make_server(0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.dir.cleanup)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method, path, body=None, token=True):
        connection = HTTPConnection('127.0.0.1', self.server.server_port)
        headers = {'X-Dashboard-Token': self.server.token} if token else {}
        connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        response = connection.getresponse()
        data = json.loads(response.read())
        connection.close()
        return response.status, data

    def test_buy_history_sell_round_trip(self):
        self.assertEqual(self.call('POST', '/api/portfolio/buy', {'symbol': 'AAA', 'amount': 100}, token=False)[0], 403)
        status, data = self.call('POST', '/api/portfolio/buy', {'symbol': 'AAA', 'amount': 100, 'analysis': {'company': 'Alpha'}})
        self.assertEqual(status, 200)
        pid = data['position']['id']
        self.assertEqual(data['portfolio']['cash'], 9900)
        status, hist = self.call('GET', f'/api/portfolio/history?id={pid}')
        self.assertEqual((status, len(hist['points'])), (200, 2))
        self.assertEqual(self.call('POST', '/api/portfolio/buy', {'symbol': 'AAA', 'amount': 1e9})[0], 400)
        status, data = self.call('POST', '/api/portfolio/sell', {'id': pid})
        self.assertEqual((status, data['portfolio']['cash']), (200, 10000))
        self.assertEqual(self.call('GET', '/api/portfolio')[1]['closed'][0]['symbol'], 'AAA')
        status, data = self.call('POST', '/api/portfolio/create', {'name': 'Second', 'capital': 3000})
        self.assertEqual((status, data['portfolio']['name'], len(data['portfolios'])), (200, 'Second', 2))
        second = data['portfolio']['id']
        status, data = self.call('POST', '/api/portfolio/buy', {'symbol': 'AAA', 'amount': 500, 'portfolio': second})
        self.assertEqual((status, data['portfolio']['cash']), (200, 2500))
        self.assertEqual(self.call('GET', '/api/portfolio')[1]['cash'], 10000)   # the first portfolio is untouched
        view = self.call('GET', f'/api/portfolio?id={second}')[1]
        self.assertEqual((view['name'], view['cash'], len(view['portfolios'])), ('Second', 2500, 2))
        self.assertEqual(self.call('GET', '/api/portfolio?id=nope')[0], 400)
        self.assertEqual(self.call('POST', '/api/portfolio/rename', {'portfolio': second, 'name': 'Renamed'})[1]['portfolio']['name'], 'Renamed')
        self.assertEqual(self.call('POST', '/api/portfolio/delete', {'portfolio': second})[0], 200)
        self.assertEqual(self.call('POST', '/api/portfolio/delete', {'portfolio': portfolio.listing()[0]['id']})[0], 400)


if __name__ == '__main__':
    unittest.main()
