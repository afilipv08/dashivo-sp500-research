from datetime import date, timedelta
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import crypto


def days(start, values):
    d0 = date.fromisoformat(start)
    return [((d0 + timedelta(days=i)).isoformat(), v) for i, v in enumerate(values)]


class AnalysisTests(unittest.TestCase):
    def test_indicators(self):
        up = [float(i) for i in range(1, 301)]
        ind = crypto.indicators(days('2025-01-01', up), 300)
        self.assertAlmostEqual(ind['ma50'], sum(up[-50:]) / 50)
        self.assertEqual(ind['cross'], 'golden')
        self.assertEqual(ind['rsi'], 100.0)
        self.assertTrue(ind['aboveMa200'])
        self.assertIsNone(crypto.rsi([1, 2]))
        flat = [100 * (1.01 if i % 2 else 0.99) for i in range(60)]
        self.assertGreater(crypto.volatility(flat), 0.1)

    def test_key_levels_find_repeated_turns(self):
        # price oscillates between ~100 (support) and ~150 (resistance), now at 125
        wave = [125 + 25 * math.sin(i / 8) for i in range(365)]
        levels = crypto.key_levels(days('2025-01-01', wave), 125)
        self.assertTrue(levels['supports'] and levels['resistances'])
        self.assertAlmostEqual(levels['supports'][0]['price'], 100, delta=3)
        self.assertAlmostEqual(levels['resistances'][0]['price'], 150, delta=3)
        self.assertGreater(levels['resistances'][0]['touches'], 3)
        self.assertEqual(crypto.key_levels(days('2025-01-01', [1, 2]), 2), {'supports': [], 'resistances': []})

    def test_btc_cycles(self):
        # halving 2016-07-09 at 100, peak 2000 after 500 days, bottom 400 later, then next cycle
        start = date(2016, 7, 9)
        series = []
        for i in range(3600):
            d = start + timedelta(days=i)
            if i <= 500:
                v = 100 + 1900 * i / 500
            elif i <= 900:
                v = 2000 - 1600 * (i - 500) / 400
            else:
                v = 400 + i
            series.append((d.isoformat(), v))
        out = crypto.btc_cycles(series, today='2026-01-01')
        first = out['cycles'][0]
        self.assertEqual((first['halving'], first['daysToPeak'], round(first['peakMultiple'])), ('2016-07-09', 500, 20))
        self.assertAlmostEqual(first['drawdown'], -0.8)
        self.assertEqual(first['daysPeakToBottom'], 400)
        self.assertTrue(first['complete'])
        self.assertEqual(out['now']['historicalDaysToPeak'][0], 500)
        self.assertIn('peakWindow', out['now'])
        self.assertEqual(len(out['cycles']), 3)


class RefreshTests(unittest.TestCase):
    def market(self, symbol, cid, price):
        return {'id': cid, 'symbol': symbol, 'name': cid.title(), 'current_price': price, 'market_cap': 1, 'price_change_percentage_1y_in_currency': 50,
                'sparkline_in_7d': {'price': [price] * 20}, 'ath': price * 2, 'ath_date': '2025-10-06T00:00:00Z'}

    def test_refresh_merges_sources_and_respects_interval(self):
        hist = [[d, 100.0] for d, _ in days('2025-01-01', [0] * 300)]
        markets = [self.market('btc', 'bitcoin', 100), self.market('usdt', 'tether', 1), self.market('hype', 'hyperliquid', 30)]
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(crypto, 'fetch_markets', return_value=markets), \
             patch.object(crypto, 'fetch_global', return_value={'total_market_cap': {'usd': 5}, 'total_volume': {'usd': 2}, 'market_cap_percentage': {'btc': 58}}), \
             patch.object(crypto, 'fetch_fear_greed', return_value=[{'value': 11, 'label': 'Extreme Fear', 'date': '2026-11-22'}]), \
             patch.object(crypto, 'fetch_btc_history', return_value=days('2016-07-09', [100.0] * 4000)), \
             patch.object(crypto, 'fetch_yahoo_history', return_value={'btc': hist, 'usdt': [[d, 1.0] for d, _ in hist], 'hype': [[d, 5.0] for d, _ in hist]}), \
             patch.object(crypto, 'fetch_coingecko_history', return_value=[['2026-11-22', 30.0]]) as cg, patch.object(crypto.time, 'sleep'):
            path = Path(tmp) / 'c.json'
            data = crypto.refresh(path=path)
            cg.assert_called_once_with('hyperliquid')          # Yahoo HYPE-USD price mismatch -> CoinGecko fallback
            coins = {c['symbol']: c for c in data['coins']}
            self.assertTrue(coins['USDT']['stable'])
            self.assertEqual(coins['USDT']['levels'], {'supports': [], 'resistances': []})
            self.assertEqual(len(coins['BTC']['history']), 365)  # Bitstamp history replaces Yahoo for BTC
            self.assertEqual(data['global']['btcDominance'], 58)
            self.assertIsNotNone(data['btc'])
            self.assertNotIn('_histories', crypto.public(data))
            again = crypto.refresh(path=path)
            self.assertEqual(again['at'], data['at'])              # within 10 minutes: cached
            self.assertEqual(crypto.fetch_markets.call_count, 1)


class RouteTests(unittest.TestCase):
    def test_crypto_routes(self):
        from http.client import HTTPConnection
        import json, threading
        import dashboard_server
        server = dashboard_server.make_server(0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            def call(method, path, token=True):
                c = HTTPConnection('127.0.0.1', server.server_port)
                c.request(method, path, headers={'X-Dashboard-Token': server.token} if token else {})
                r = c.getresponse(); body = json.loads(r.read()); c.close()
                return r.status, body
            with patch.object(crypto, 'cached', return_value={'at': 'x', 'coins': [], '_btc': [1]}), \
                 patch.object(crypto, 'refresh', return_value={'at': 'y', 'coins': [], '_histories': {}}):
                self.assertEqual(call('GET', '/api/crypto', token=False)[0], 403)
                status, body = call('GET', '/api/crypto')
                self.assertEqual((status, body), (200, {'at': 'x', 'coins': []}))
                self.assertEqual(call('POST', '/api/crypto/refresh')[1], {'at': 'y', 'coins': []})
            with patch.object(crypto, 'cached', return_value=None), patch.object(crypto, 'refresh', side_effect=RuntimeError('down')):
                self.assertEqual(call('POST', '/api/crypto/refresh')[0], 502)
        finally:
            server.shutdown(); server.server_close()


if __name__ == '__main__':
    unittest.main()
