import json
import unittest
from pathlib import Path
from unittest.mock import patch
import run


class BackupTests(unittest.TestCase):
    def test_failure_diagnostic_never_exposes_raw_details(self):
        from subprocess import CompletedProcess
        result = CompletedProcess([], 1, b'', b'AccessDenied secret-token private-file-name')
        with patch.object(run.subprocess, 'run', return_value=result):
            with self.assertRaises(run.BackupError) as raised:
                run.command(['restic', 'init'], {})
        self.assertIn('access_denied', str(raised.exception))
        self.assertNotIn('secret-token', str(raised.exception))
        self.assertNotIn('private-file-name', str(raised.exception))

    def setUp(self):
        self.env = {name: 'x' * 40 for name in run.REQUIRED}
        self.env.update(DATABASE_URL='must-not-leak', STRIPE_SECRET_KEY='must-not-leak')

    def test_credentials_are_separated(self):
        reader, writer = run.environments(self.env)
        self.assertNotIn('AWS_SECRET_ACCESS_KEY', reader)
        self.assertNotIn('RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY', writer)
        self.assertNotIn('DATABASE_URL', reader)
        self.assertNotIn('STRIPE_SECRET_KEY', writer)

    def test_missing_credentials_fail_before_any_io(self):
        with patch.object(run, 'command') as call:
            with self.assertRaises(run.BackupError):
                run.run({})
            call.assert_not_called()

    def test_failed_source_check_never_backs_up(self):
        calls = []
        def fake(args, env, cwd=None):
            calls.append(args[:2])
            if args[:2] == ['rclone', 'check']:
                raise run.BackupError('source changed')
            return b''
        with patch.object(run, 'command', fake):
            with self.assertRaises(run.BackupError):
                run.run(self.env)
        self.assertNotIn(['restic', 'backup'], calls)

    def test_restore_failure_is_not_success(self):
        def fake(args, env, cwd=None):
            if args[:2] == ['restic', 'backup']:
                return json.dumps({'message_type': 'summary', 'snapshot_id': 'abc123'}).encode()
            if args[:2] == ['restic', 'restore']:
                raise run.BackupError('restore failed')
            return b''
        with patch.object(run, 'command', fake):
            with self.assertRaises(run.BackupError):
                run.run(self.env)

    def test_retention_only_follows_verified_restore(self):
        calls = []
        def fake(args, env, cwd=None):
            calls.append(args)
            if args[:2] == ['restic', 'backup']:
                return b'{"message_type":"summary","snapshot_id":"abc123"}'
            return b''
        with patch.object(run, 'command', fake):
            self.assertTrue(run.run(self.env)['restoreVerified'])
        self.assertNotIn(['restic', 'init'], calls)
        forget = next(a for a in calls if a[:2] == ['restic', 'forget'])
        self.assertIn('30d', forget)
        self.assertIn('host,tags', forget)
        restore_check = next(i for i,a in enumerate(calls) if a[:2] == ['rclone','check'] and 'source:familytrack' not in a)
        self.assertGreater(calls.index(forget), restore_check)
        self.assertEqual(calls[-1], ['restic', 'check'])


if __name__ == '__main__':
    unittest.main()
