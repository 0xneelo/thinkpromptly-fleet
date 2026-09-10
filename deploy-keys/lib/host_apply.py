#!/usr/bin/env python3
"""Local Linux host-owner transaction. Dry-runs read public configuration only."""
import argparse
import base64
import difflib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile


def run(args):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def public_key(text):
    lines = [x.strip() for x in text.splitlines() if x.strip() and not x.lstrip().startswith('#')]
    if len(lines) != 1:
        raise ValueError('expected exactly one ed25519 public key')
    fields = lines[0].split()
    if len(fields) < 2 or fields[0] != 'ssh-ed25519':
        raise ValueError('expected an ordinary ed25519 PUBLIC key')
    raw = base64.b64decode(fields[1], validate=True)
    if raw[:19] != struct.pack('>I', 11) + b'ssh-ed25519' + struct.pack('>I', 32) or len(raw) != 51:
        raise ValueError('invalid ed25519 public key')
    return ' '.join(fields)


def append_ca(before, key):
    identity = key.split()[:2]
    if any(line.split()[:2] == identity for line in before.splitlines()):
        return before
    return before + ('\n' if before and not before.endswith('\n') else '') + key + '\n'


def directive(before, name, value):
    # First obtained value wins, including Includes: put the managed setting first.
    # Remove explicit duplicates even under Match, so an old misplaced line cannot linger.
    lines = [line for line in before.splitlines() if not re.match(r'^\s*' + name + r'\s+', line, re.I)]
    return name + ' ' + value + '\n' + '\n'.join(lines) + ('\n' if lines else '')


def checked_path(root, relative):
    path = root / relative
    for item in [path, *path.parents]:
        if item == root.parent:
            break
        if item.is_symlink():
            raise ValueError('refusing symlink: ' + str(item))
    return path


def read(path):
    return path.read_text() if path.exists() else ''


def diff(path, before, after):
    sys.stdout.writelines(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                             fromfile=str(path), tofile=str(path) + ' (planned)'))


def atomic_write(path, text, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    fd, name = tempfile.mkstemp(prefix='.ca-rotation-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def validate_and_reload(args, conf):
    run([args.sshd, '-t', '-f', str(conf)])
    run(['systemctl', 'reload', args.service])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['trust'])
    parser.add_argument('public_key', nargs='?')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--root', default='/', help='offline fixture root; dry-run only')
    parser.add_argument('--service', choices=['ssh', 'sshd'], default='ssh')
    parser.add_argument('--sshd', default='/usr/sbin/sshd')
    parser.add_argument('--rollback', help='backup directory printed by an earlier apply')
    args = parser.parse_args()
    root = Path(args.root).absolute()
    if root != Path('/') and not args.dry_run:
        raise ValueError('--root is for offline dry-run only')
    conf = checked_path(root, 'etc/ssh/sshd_config')
    ca = checked_path(root, 'etc/ssh/deploy_ca.pub')
    if not conf.is_file():
        raise ValueError('sshd_config missing')
    if args.rollback:
        backup = Path(args.rollback).absolute()
        expected = root / 'etc/ssh/ca-rotation-backups'
        if backup.parent != expected or backup.is_symlink():
            raise ValueError('rollback must name a direct child of ' + str(expected))
        manifest = json.loads((backup / 'manifest.json').read_text())
        changes = {}
        for relative, existed in manifest['files'].items():
            if relative not in ['etc/ssh/deploy_ca.pub', 'etc/ssh/sshd_config']:
                raise ValueError('unexpected rollback path')
            path = checked_path(root, relative)
            changes[path] = (backup / relative).read_text() if existed else None
    else:
        if not args.public_key:
            parser.error('public key file is required')
        key = public_key(Path(args.public_key).read_text())
        changes = {ca: append_ca(read(ca), key), conf: directive(read(conf), 'TrustedUserCAKeys', '/etc/ssh/deploy_ca.pub')}
    changed = {p: value for p, value in changes.items() if value != (p.read_text() if p.exists() else None)}
    for path, value in changed.items():
        diff(path, read(path), value or '')
    print('PLAN: sshd -t; systemctl reload ' + args.service + '; restore previous files if validation/reload fails')
    if args.dry_run:
        print('DRY-RUN: no files, accounts, services, or backups changed')
        return
    if os.geteuid() != 0:
        raise ValueError('apply requires root; use --dry-run for review')
    if not changed:
        print('Already current; no reload')
        return
    apply_changes(changed, root, args, conf, ca)


def apply_changes(changed, root, args, conf, ca):
    # Validate the baseline before doing anything and keep a recovery snapshot for rollback itself.
    run([args.sshd, '-t', '-f', str(conf)])
    parent = checked_path(root, 'etc/ssh/ca-rotation-backups')
    parent.mkdir(mode=0o700, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='trust-', dir=parent))
    manifest = {'files': {str(p.relative_to(root)): p.exists() for p in changed}}
    for path in changed:
        if path.exists():
            dest = backup / path.relative_to(root)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
    (backup / 'manifest.json').write_text(json.dumps(manifest))
    print('ROLLBACK: sudo deploy-keys/apply-trust-linux.sh --rollback ' + str(backup) + ' --service ' + args.service, flush=True)
    try:
        for path, value in changed.items():
            if value is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, value)
        validate_and_reload(args, conf)
    except Exception:
        for path in changed:
            saved = backup / path.relative_to(root)
            if saved.exists():
                shutil.copy2(saved, path)
            else:
                path.unlink(missing_ok=True)
        validate_and_reload(args, conf)
        raise
    if ca.exists():
        print(run(['ssh-keygen', '-lf', str(ca), '-E', 'sha256']).strip())
    print('Applied; backup retained at ' + str(backup))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        sys.exit(1)
