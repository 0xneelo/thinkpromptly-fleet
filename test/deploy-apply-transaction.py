"""Offline transaction failures: only temporary public configuration is written."""
import sys
sys.dont_write_bytecode = True
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host_apply', Path(__file__).resolve().parents[1] / 'deploy-keys/lib/host_apply.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TransactionTest(unittest.TestCase):
    def test_deploy_match_precedes_address_match_and_includes_cannot_hide_one(self):
        before = 'Port 22\nMatch Address 10.0.0.0/8\n PasswordAuthentication yes\n'
        after = mod.deploy_policy(before)
        self.assertLess(after.index('Match User deploy'), after.index('Match Address'))
        self.assertEqual(after, mod.deploy_policy(after))
        with tempfile.TemporaryDirectory(prefix='ivo-include-') as directory:
            root = Path(directory)
            (root / 'site.conf').write_text(before)
            with self.assertRaisesRegex(ValueError, 'Include.*Match'):
                mod.deploy_policy('Include site.conf\nPort 22\n', root)

    def test_host_lock_excludes_overlap_and_next_plan_reads_new_state(self):
        with tempfile.TemporaryDirectory(prefix='ivo-lock-') as directory:
            root = Path(directory)
            conf = root / 'etc/ssh/sshd_config'
            conf.parent.mkdir(parents=True)
            actual_fstat = os.fstat
            def fixture_stat(fd):
                stat = actual_fstat(fd)
                return SimpleNamespace(st_uid=0, st_mode=stat.st_mode)
            with patch.object(mod.os, 'fstat', fixture_stat):
                with mod.host_lock(root):
                    with self.assertRaisesRegex(ValueError, 'host lock'):
                        with mod.host_lock(root):
                            self.fail('overlapping transaction entered')
                    conf.write_text('TrustedUserCAKeys /etc/ssh/deploy_ca.pub\n')
                with mod.host_lock(root):
                    before = conf.read_text()
                    after = mod.directive(before, 'AuthorizedPrincipalsFile', '/etc/ssh/principals/%u')
                    mod.assert_transition_policy(before, after, 'principals')
                    self.assertIn('TrustedUserCAKeys /etc/ssh/deploy_ca.pub', after)
            with self.assertRaisesRegex(ValueError, 'S2'):
                mod.assert_transition_policy('', 'AuthorizedPrincipalsFile /etc/ssh/principals/%u\n', 'principals')

    def test_principal_modes_survive_restrictive_umask(self):
        with tempfile.TemporaryDirectory(prefix='ivo-mode-') as directory:
            path = Path(directory) / 'principals/deploy'
            mask = os.umask(0o077)
            try:
                mod.atomic_write(path, 'deploy\n')
            finally:
                os.umask(mask)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o755)
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)

    def test_rollback_validates_candidate_not_malformed_current_config(self):
        with tempfile.TemporaryDirectory(prefix='ivo-rollback-') as directory:
            root = Path(directory)
            conf = root / 'etc/ssh/sshd_config'
            conf.parent.mkdir(parents=True)
            conf.write_text('MALFORMED\n')
            calls = []
            def runner(argv):
                calls.append(argv)
                if argv[0] == 'test-sshd':
                    self.assertNotIn('MALFORMED', Path(argv[argv.index('-f') + 1]).read_text())
                return ''
            args = SimpleNamespace(sshd='test-sshd', service='ssh', rollback='saved')
            with patch.object(mod, 'run', runner):
                mod.apply_changes({conf:'Port 22\n'}, root, args, conf, conf.parent/'deploy_ca.pub')
            self.assertEqual(conf.read_text(), 'Port 22\n')
            self.assertTrue(calls[0][-1].endswith('rollback-candidate.conf'))

    def test_account_disable_failure_cannot_skip_file_restore_or_reload(self):
        with tempfile.TemporaryDirectory(prefix='ivo-disable-fail-') as directory:
            root = Path(directory)
            conf = root / 'etc/ssh/sshd_config'
            conf.parent.mkdir(parents=True)
            conf.write_text('Port 22\n')
            calls = []
            def runner(argv):
                calls.append(argv)
                if argv[0] == 'usermod':
                    self.assertEqual(conf.read_text(), 'Port 22\n')
                    raise subprocess.CalledProcessError(2, argv)
                if argv[0] == 'test-sshd' and conf.read_text() == 'BAD\n':
                    raise subprocess.CalledProcessError(1, argv)
                return ''
            args = SimpleNamespace(sshd='test-sshd', service='ssh')
            with patch.object(mod, 'run', runner), patch.object(mod.shutil, 'which', return_value=None):
                with self.assertRaises(subprocess.CalledProcessError) as raised:
                    mod.apply_changes({conf:'BAD\n'}, root, args, conf, conf.parent/'deploy_ca.pub', create_deploy=True)
            self.assertEqual(raised.exception.returncode, 1)
            self.assertEqual(conf.read_text(), 'Port 22\n')
            self.assertEqual(calls[-1], ['systemctl','reload','ssh'])

    def test_validation_and_reload_failure_restore_exact_files(self):
        for fault in ('validation', 'reload'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='ivo-transaction-') as directory:
                root = Path(directory)
                conf = root / 'etc/ssh/sshd_config'
                conf.parent.mkdir(parents=True)
                conf.write_text('Port 22\n')
                ca = conf.parent / 'deploy_ca.pub'
                ca.write_text('public-fixture-before\n')
                calls = []
                def runner(argv):
                    calls.append(argv)
                    fail = len(calls) == 2 if fault == 'validation' else len(calls) == 3
                    if fail:
                        raise subprocess.CalledProcessError(1, argv)
                    return ''
                args = SimpleNamespace(sshd='test-sshd', service='ssh')
                with patch.object(mod, 'run', runner), self.assertRaises(subprocess.CalledProcessError):
                    mod.apply_changes({ca:'public-fixture-after\n', conf:'Port 23\n'},root,args,conf,ca)
                self.assertEqual(ca.read_text(),'public-fixture-before\n')
                self.assertEqual(conf.read_text(),'Port 22\n')
                self.assertEqual(calls[-1],['systemctl','reload','ssh'])
                self.assertEqual(len(list((conf.parent/'ca-rotation-backups').glob('*/manifest.json'))),1)

if __name__ == '__main__':
    unittest.main()
