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

    def test_a_dropped_connection_is_retried_once_then_reported(self):
        calls = []

        def flaky(command, **kwargs):
            calls.append(1)
            return type('R', (), {'returncode': 1 if len(calls) == 1 else 0, 'stdout': '', 'stderr': 'OpenAIConnectionError: Connection error.'})()
        queue = agents_bridge.Queue()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        with patch.object(agents_bridge, 'TA_HOME', Path(tmp.name)), patch.object(agents_bridge, 'available', return_value=True), \
             patch.object(agents_bridge, 'python_path', return_value=Path('/x/python')), patch.object(agents_bridge.subprocess, 'run', side_effect=flaky):
            queue.start(['AXON'])
            for _ in range(200):
                if not queue.snapshot()['running']:
                    break
                import time
                time.sleep(0.01)
        self.assertEqual(len(calls), 2)
        self.assertEqual(queue.snapshot()['done'], ['AXON'])

    def test_vibe_trading_answer_and_verdict_are_taken_from_its_plain_output(self):
        out = ("  - get_stock_profile CBRE.US  OK 1.1s\n  OK 2.6s\n**CBRE Group** provides real-estate services.\n\n**Verdict \u2014 Neutral:** earnings improved.\n"
               "\nStatus: SUCCESS\nElapsed: 1m 14s\nRun ID: 1\nRun dir: /x\nReason: released\n\n**CBRE Group** provides real-estate services.\n\n"
               "**Verdict \u2014 Neutral:** earnings improved.\n--show 1  |  --continue 1 \"...\"\n")
        parsed = agents_bridge.parse_vibe_output(out)
        self.assertEqual(parsed['verdict'], 'Neutral')
        self.assertTrue(parsed['text'].startswith('**CBRE Group** provides'))
        self.assertNotIn('--show', parsed['text'])
        self.assertEqual(agents_bridge.parse_vibe_output('no answer')['text'], '')
        self.assertIsNone(agents_bridge.parse_vibe_output('**x** nothing')['verdict'])
        self.assertEqual(agents_bridge.parse_vibe_output('Run dir: /x\n\n**CBRE.US (NYSE) \u2014 Neutral.** CBRE provides services.\n--show 1')['verdict'], 'Neutral')
        self.assertEqual(agents_bridge.parse_vibe_output('Run dir: /x\n\nThe outlook is bearish. **Verdict: Bearish** weak.\n')['verdict'], 'Bearish')

    def test_vibe_run_is_saved_in_the_platform_file_and_read_back(self):
        out = "**CBRE** is a broker.\n**Verdict \u2014 Bearish:** weak.\nStatus: SUCCESS\nRun dir: /x\n\n**CBRE** is a broker.\n**Verdict \u2014 Bearish:** weak.\n"
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        fake = lambda command, **kw: type('R', (), {'returncode': 0, 'stdout': out, 'stderr': ''})()
        queue = agents_bridge.Queue()
        with patch.object(agents_bridge, 'STORE', Path(tmp.name) / 'pc.json'), patch.object(agents_bridge, 'TA_HOME', Path(tmp.name)), \
             patch.object(agents_bridge, 'vibe_available', return_value=True), patch.object(agents_bridge, 'vibe_binary', return_value=Path('/x/vt')), \
             patch.object(agents_bridge.subprocess, 'run', side_effect=fake):
            self.assertTrue(queue.start(['CBRE'], program='vibe'))
            for _ in range(200):
                if not queue.snapshot()['running']:
                    break
                import time
                time.sleep(0.01)
            state = queue.snapshot()
            result = agents_bridge.public(['CBRE', 'NONE'], queue, 'vibe')
        self.assertEqual((state['done'], state['program']), (['CBRE'], 'vibe'))
        self.assertEqual(list(result['results']), ['CBRE'])
        self.assertEqual(result['results']['CBRE']['rating'], 'Bearish')
        self.assertIn('broker', result['results']['CBRE']['summary'])

    def test_unknown_program_is_rejected(self):
        with self.assertRaises(ValueError):
            agents_bridge.Queue().start(['AXON'], program='nope')

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
