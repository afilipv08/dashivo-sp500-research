from datetime import datetime, timezone
import json
import math
import unittest
from unittest.mock import patch

import intrinsic_value


class IntrinsicValueTests(unittest.TestCase):
    def test_equity_rank_parser_keeps_dated_per_share_estimates(self):
        parsed = intrinsic_value.parse_equity_rank({
            'meta': {'batch_last_recomputed': '2026-11-25T08:17:34+00:00'},
            'rows': [{'ticker': 'ABC', 'model_fair_value_estimate': 42.5,
                      'price_at_last_recompute': 40, 'last_recomputed': '2026-11-25T08:00:00+00:00'},
                     {'ticker': 'NONE', 'model_fair_value_estimate': None}]})
        abc = parsed['rows']['ABC']
        self.assertEqual({k: abc[k] for k in ('value', 'price', 'asOf', 'reason')}, {'value': 42.5, 'price': 40, 'asOf': '2026-11-25T08:00:00+00:00', 'reason': None})
        self.assertIsNone(abc['strengthScore'])
        self.assertIsNone(parsed['rows']['NONE']['value'])
        self.assertTrue(parsed['rows']['NONE']['reason'])

    def test_zyberno_per_share_conversion_is_explicit_and_date_preserved(self):
        row = ('snapshot_date,symbol,intrinsic_value_usd,market_cap_usd,price_usd,record_computed_utc\n'
               '2026-11-01,ABC,500000000,1000000000,20,2026-10-30\n')
        parsed = intrinsic_value.parse_zyberno_csv(row)
        estimate = parsed['rows']['ABC']
        self.assertEqual(estimate['value'], 10)
        self.assertEqual(estimate['impliedShares'], 50_000_000)
        self.assertEqual(estimate['asOf'], '2026-10-30')
        self.assertEqual(estimate['snapshotDate'], '2026-11-01')

    def test_sec_methods_calculate_only_from_annual_filing_facts(self):
        def annual(value, unit):
            return {unit: [{'fy': 2024, 'fp': 'FY', 'form': '10-K', 'filed': '2025-02-01',
                            'start': '2024-01-01', 'end': '2024-12-31', 'val': value}]}
        facts = {'facts': {'us-gaap': {
            'NetCashProvidedByUsedInOperatingActivities': {'units': annual(1000, 'USD')},
            'PaymentsToAcquirePropertyPlantAndEquipment': {'units': annual(-200, 'USD')},
            'EarningsPerShareDiluted': {'units': annual(4, 'USD / shares')},
            'CommonStockDividendsPerShareDeclared': {'units': annual(1.5, 'USD / shares')},
            'StockholdersEquity': {'units': {'USD': [{'form': '10-K', 'filed': '2025-02-01', 'end': '2024-12-31', 'val': 2000}]}},
        }, 'dei': {'EntityCommonStockSharesOutstanding': {'units': {
            'shares': [{'form': '10-K', 'filed': '2025-02-01', 'end': '2024-12-31', 'val': 100}]
        }}}}}
        methods = intrinsic_value.calculate_methods(facts)
        self.assertAlmostEqual(methods['graham']['value'], math.sqrt(22.5 * 4 * 20))
        self.assertAlmostEqual(methods['ddm']['value'], 1.5 * 1.025 / (0.09 - 0.025))
        self.assertGreater(methods['dcf']['value'], 8)
        self.assertEqual(methods['dcf']['inputs']['fcf'], 800)
        self.assertEqual(methods['dcf']['assumptions']['years'], 5)

    def test_missing_or_nonpositive_inputs_remain_unavailable(self):
        methods = intrinsic_value.calculate_methods({'facts': {}})
        self.assertIsNone(methods['dcf']['value'])
        self.assertIsNone(methods['graham']['value'])
        self.assertIsNone(methods['ddm']['value'])
        self.assertTrue(methods['dcf']['reason'])

    def test_ticker_key_normalizes_share_class_separators(self):
        self.assertEqual(intrinsic_value._ticker_key('BRK.B'), intrinsic_value._ticker_key('BRK-B'))

    def test_429_stops_all_remaining_source_requests(self):
        with patch.object(intrinsic_value, '_request', side_effect=intrinsic_value.RateLimited()) as request:
            payload = intrinsic_value.build_payload(['AAPL'])
        self.assertEqual(request.call_count, 1)
        self.assertEqual(payload['sources']['equityRank']['status'], 'rate_limited')
        self.assertEqual(payload['sources']['zyberno']['status'], 'not_requested')
        self.assertEqual(payload['sources']['sec']['status'], 'not_requested')

    def test_fresh_cache_is_reused_without_network(self):
        previous = {'schema': intrinsic_value.PAYLOAD_SCHEMA, 'at': datetime.now(timezone.utc).isoformat(),
                    'sources': {'sec': {'status': 'contact_required', 'rows': {}}}}
        with patch.object(intrinsic_value, '_request', side_effect=AssertionError('network should not run')):
            self.assertIs(intrinsic_value.build_payload(['AAPL'], previous=previous), previous)

    def test_fresh_cache_with_an_older_schema_is_rebuilt(self):
        previous = {'at': datetime.now(timezone.utc).isoformat(), 'sources': {'sec': {'status': 'contact_required', 'rows': {}}}}
        with patch.object(intrinsic_value, '_request', side_effect=intrinsic_value.RateLimited()) as request:
            payload = intrinsic_value.build_payload(['AAPL'], previous=previous)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(payload['schema'], intrinsic_value.PAYLOAD_SCHEMA)

    def test_fundamental_fields_are_kept_for_the_fundamental_page(self):
        csv_text = ('snapshot_date,symbol,industry,intrinsic_value_usd,market_cap_usd,price_usd,record_computed_utc,roe_pct,roic_pct,'
                    'free_cash_flow_ttm_usd,revenue_ttm_usd,net_income_ttm_usd,eps_diluted_ttm_usd,fundamental_growth_rate_pct,zyberno_score\n'
                    '2026-11-01,ABC,Software,500,1000,20,2026-10-30,21.5,14.2,120,1000,200,4.0,6.5,77\n')
        z = intrinsic_value.parse_zyberno_csv(csv_text)['rows']['ABC']
        self.assertEqual((z['roe'], z['roic'], z['fcf'], z['revenue'], z['netIncome'], z['eps'], z['growth'], z['score'], z['industry']),
                         (21.5, 14.2, 120.0, 1000.0, 200.0, 4.0, 6.5, 77.0, 'Software'))
        er = intrinsic_value.parse_equity_rank({'rows': [{'ticker': 'ABC', 'model_fair_value_estimate': 10, 'fundamental_strength_score': 63,
                                                          'fundamental_strength_grade': 'B-', 'equity_rank_score': 51.5, 'models_above_price': 2, 'models_total': 9}]})['rows']['ABC']
        self.assertEqual((er['strengthScore'], er['strengthGrade'], er['rankScore'], er['modelsAbove'], er['modelsTotal']), (63, 'B-', 51.5, 2, 9))

    def test_ttm_methods_use_zyberno_values_and_stay_unavailable_without_inputs(self):
        row = {'impliedShares': 100.0, 'fcf': 800.0, 'eps': 4.0, 'roe': 20.0, 'netIncome': 400.0, 'asOf': '2026-10-27'}
        methods = intrinsic_value.calculate_methods_ttm(row)
        # same DCF as the SEC path for 8 of free cash flow per share, and book value per share = 400 / 0.20 / 100 = 20
        self.assertAlmostEqual(methods['dcf']['value'], intrinsic_value._dcf_value(8.0, .05, .09, .025, 5))
        self.assertAlmostEqual(methods['graham']['value'], math.sqrt(22.5 * 4 * 20))
        self.assertEqual(methods['dcf']['inputs']['source'], 'Zyberno TTM')
        self.assertIsNone(methods['ddm']['value'])
        none = intrinsic_value.calculate_methods_ttm({'impliedShares': 100.0, 'fcf': -5.0, 'eps': -1.0, 'roe': 10.0, 'netIncome': -3.0})
        self.assertIsNone(none['dcf']['value'])
        self.assertIsNone(none['graham']['value'])
        self.assertTrue(none['dcf']['reason'] and none['graham']['reason'])
        self.assertIsNone(intrinsic_value.calculate_methods_ttm({})['dcf']['value'])

    def test_payload_carries_ttm_methods_for_every_zyberno_row(self):
        csv_text = ('snapshot_date,symbol,intrinsic_value_usd,market_cap_usd,price_usd,record_computed_utc,roe_pct,free_cash_flow_ttm_usd,'
                    'net_income_ttm_usd,eps_diluted_ttm_usd\n2026-11-01,AAPL,500,10000,100,2026-10-30,20,800,400,4\n')

        def response(url, user_agent=None, timeout=30):
            return json.dumps({'meta': {}, 'rows': []}).encode() if url == intrinsic_value.EQUITY_RANK_URL else csv_text.encode()
        with patch.object(intrinsic_value, '_request', side_effect=response):
            payload = intrinsic_value.build_payload(['AAPL'])
        ttm = payload['sources']['ttm']
        self.assertEqual(ttm['status'], 'available')
        self.assertGreater(ttm['rows']['AAPL']['dcf']['value'], 0)
        self.assertEqual(payload['sources']['sec']['status'], 'contact_required')

    def test_fresh_rate_limited_cache_is_not_retried_within_24_hours(self):
        previous = {'schema': intrinsic_value.PAYLOAD_SCHEMA, 'at': datetime.now(timezone.utc).isoformat(),
                    'sources': {'sec': {'status': 'rate_limited', 'rows': {}}}}
        with patch.object(intrinsic_value, '_request', side_effect=AssertionError('do not retry a 429')):
            self.assertIs(intrinsic_value.build_payload(['AAPL'], previous=previous,
                                                        contact_email='test@example.invalid'), previous)

    def test_sec_contact_is_used_only_in_user_agent_not_published_data(self):
        email = 'test-contact@example.invalid'
        headers = []

        def response(url, user_agent=None, timeout=30):
            headers.append(user_agent or '')
            if url == intrinsic_value.EQUITY_RANK_URL:
                return json.dumps({'meta': {}, 'rows': []}).encode()
            if url == intrinsic_value.ZYBERNO_URL:
                return b'snapshot_date,symbol,intrinsic_value_usd,market_cap_usd,price_usd,record_computed_utc\n'
            if url == intrinsic_value.SEC_TICKERS_URL:
                return json.dumps({'data': [[320193, 'Apple Inc.', 'AAPL', 'Nasdaq']]}).encode()
            if url == intrinsic_value.SEC_FACTS_URL.format(320193):
                return json.dumps({'facts': {}}).encode()
            raise AssertionError(url)

        with patch.object(intrinsic_value, '_request', side_effect=response):
            payload = intrinsic_value.build_payload(['AAPL'], contact_email=email)
        serialized = json.dumps(payload)
        self.assertEqual(payload['sources']['sec']['status'], 'available')
        self.assertIn(email, ' '.join(headers))
        self.assertNotIn(email, serialized)
        self.assertEqual(payload['sources']['sec']['rows']['AAPL']['dcf']['value'], None)


if __name__ == '__main__':
    unittest.main()
