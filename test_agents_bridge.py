from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import agents_bridge

REPORT = """# Trading Analysis Report: AXON

- Analysis date: 2026-11-11
- Rating: Underweight
- Generated: 2026-11-11 22:45:02
- TradingAgents 0.7.0: chatgpt, deep gpt-6.1-sol, quick gpt-6-sol

## I. Analyst Team Reports
"""
DECISION = """**Rating**: Underweight

**Executive Summary**: Reduce exposure in measured tranches. Reassess over 3-6 months as margins become clearer. """ + 'Detail. ' * 80 + """

**Investment Thesis**: ignored.
"""


def make_report(root, symbol='AXON', stamp='20261111_224502', report=REPORT, decision=DECISION):
    folder = root / 'logs' / 'reports' / f'{symbol}_{stamp}'
    (folder / '5_portfolio').mkdir(parents=True)
    (folder / 'complete_report.md').write_text(report, encoding='utf-8')
    if decision is not None:
        (folder / '5_portfolio' / 'decision.md').write_text(decision, encoding='utf-8')
    (folder / 'complete_report.html').write_text('<html></html>', encoding='utf-8')
    return folder


class AgentsBridgeTests(unittest.TestCase):
    def test_saved_report_becomes_a_short_conclusion(self):
        with tempfile.TemporaryDirectory() as d, patch.object(agents_bridge, 'TA_HOME', Path(d)):
            make_report(Path(d))
            result = agents_bridge.latest(['AXON', 'NONE'])
        self.assertEqual(list(result), ['AXON'])
        item = result['AXON']
        self.assertEqual((item['rating'], item['date'], item['generated']), ('Underweight', '2026-11-11', '2026-11-11 22:45:02'))
        self.assertTrue(item['summary'].startswith('Reduce exposure in measured tranches.'))
        self.assertLessEqual(len(item['summary']), agents_bridge.SUMMARY_CHARS + 1)
        self.assertNotIn('ignored', item['summary'])
        self.assertTrue(item['html'])

    def test_newest_readable_report_wins_and_unreadable_ones_are_skipped(self):
        with tempfile.TemporaryDirectory() as d, patch.object(agents_bridge, 'TA_HOME', Path(d)):
            make_report(Path(d), stamp='20261101_100000', report=REPORT.replace('2026-11-11', '2026-11-01'))
            make_report(Path(d), stamp='20261105_100000', report='no header here')
            self.assertEqual(agents_bridge.latest(['AXON'])['AXON']['date'], '2026-11-01')
            make_report(Path(d), stamp='20261110_100000', report=REPORT.replace('2026-11-11', '2026-11-10'))
            self.assertEqual(agents_bridge.latest(['AXON'])['AXON']['date'], '2026-11-10')

    def test_unknown_rating_text_is_kept_but_not_classified(self):
        with tempfile.TemporaryDirectory() as d, patch.object(agents_bridge, 'TA_HOME', Path(d)):
            make_report(Path(d), report=REPORT.replace('Underweight', 'Maybe'))
            item = agents_bridge.latest(['AXON'])['AXON']
        self.assertIsNone(item['rating'])
        self.assertEqual(item['ratingText'], 'Maybe')

    def test_report_page_path_is_validated(self):
        with tempfile.TemporaryDirectory() as d, patch.object(agents_bridge, 'TA_HOME', Path(d)):
            make_report(Path(d))
            self.assertIsNotNone(agents_bridge.report_html('AXON', 'AXON_20261111_224502'))
            for symbol, name in (('AXON', '../../etc/passwd'), ('AXON', 'AXON_20261111_224502/../x'), ('../AXON', 'AXON_20261111_224502'),
                                 ('AXON', 'CLS_20261111_224502'), ('', ''), (None, None)):
                self.assertIsNone(agents_bridge.report_html(symbol, name), (symbol, name))

    def test_cli_environment_reuses_saved_choices_but_never_overrides_the_environment(self):
        with tempfile.TemporaryDirectory() as d, patch.object(agents_bridge, 'TA_HOME', Path(d)), \
             patch.dict('os.environ', {'TRADINGAGENTS_LLM_PROVIDER': 'ollama'}, clear=False):
            (Path(d) / 'cli_prefs.json').write_text('{"llm_provider":"chatgpt","quick_think_llm":"quick","research_depth":2,'
                                                    '"analysts":["market","news","bad name!"],"output_language":"English"}', encoding='utf-8')
            env, analysts = agents_bridge.cli_environment()
        self.assertEqual(env['TRADINGAGENTS_LLM_PROVIDER'], 'ollama')
        self.assertEqual((env['TRADINGAGENTS_QUICK_THINK_LLM'], env['TRADINGAGENTS_MAX_DEBATE_ROUNDS'], analysts), ('quick', '2', 'market,news'))

    def test_failures_are_explained_from_known_classes_without_leaking_output(self):
        self.assertIn('could not be reached', agents_bridge.explain_failure('...\nOpenAIConnectionError: Connection error.\nuser@example.com'))
        self.assertIn('sign-in', agents_bridge.explain_failure('openai.AuthenticationError: 401'))
        self.assertIn('rate-limiting', agents_bridge.explain_failure(b'RateLimitError 429'))
        generic = agents_bridge.explain_failure('Traceback ... secret-token user@example.com')
        self.assertNotIn('@', generic)
        self.assertIn('stopped with an error', generic)

    def test_start_rejects_bad_input_and_a_missing_install(self):
        queue = agents_bridge.Queue()
        with self.assertRaises(ValueError):
            queue.start(['', 'bad symbol!', '../x', '-A'])
        with patch.object(agents_bridge, 'available', return_value=False), self.assertRaises(RuntimeError):
            queue.start(['AXON'])

    def test_queue_runs_symbols_in_order_and_records_failures(self):
        calls = []

        def fake_run(command, **kwargs):
            calls.append(command[command.index('--ticker') + 1])
            return type('R', (), {'returncode': 1 if command[command.index('--ticker') + 1] == 'BAD' else 0, 'stdout': 'out', 'stderr': 'boom: details'})()
        queue = agents_bridge.Queue()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        with patch.object(agents_bridge, 'TA_HOME', Path(tmp.name)), patch.object(agents_bridge, 'available', return_value=True), patch.object(agents_bridge, 'python_path', return_value=Path('/x/python')), \
             patch.object(agents_bridge.subprocess, 'run', side_effect=fake_run):
            self.assertTrue(queue.start(['AXON', 'bad', 'AXON', 'CLS'], today='2026-11-26'))
            for _ in range(200):
                if not queue.snapshot()['running']:
                    break
                import time
                time.sleep(0.01)
        state = queue.snapshot()
        self.assertEqual(calls, ['AXON', 'BAD', 'CLS'])
        self.assertEqual(state['done'], ['AXON', 'CLS'])
        self.assertEqual(list(state['errors']), ['BAD'])
        self.assertFalse(state['running'])
        self.assertIn('boom: details', (Path(tmp.name) / 'logs' / 'dashboard_runs' / 'BAD.log').read_text())


if __name__ == '__main__':
    unittest.main()
