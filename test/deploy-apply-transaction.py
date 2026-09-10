"""Offline transaction failures: only temporary public configuration is written."""
import sys
sys.dont_write_bytecode = True
import importlib.util
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
