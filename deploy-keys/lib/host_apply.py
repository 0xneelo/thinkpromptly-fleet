#!/usr/bin/env python3
"""Local Linux host-owner transaction. Dry-runs read public configuration only."""
import argparse
import base64
import hashlib
import difflib
import fcntl
import glob
from contextlib import contextmanager
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


def fingerprint(line):
    if not line.strip() or line.lstrip().startswith('#'):
        return ''
    key = public_key(line)
    raw = base64.b64decode(key.split()[1])
    return 'SHA256:' + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=')


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


def deploy_policy(config, include_root=Path('/etc/ssh')):
    begin, end = '# BEGIN CA ROTATION DEPLOY', '# END CA ROTATION DEPLOY'
    config = re.sub(re.escape(begin) + r'.*?' + re.escape(end) + r'\n?', '', config, flags=re.S)
    # Global-only directives must stay outside Match. Reject an Include hiding an
    # earlier Match instead of guessing which source addresses it will match.
    def check_includes(text, seen):
        import shlex
        for line in text.splitlines():
            fields = shlex.split(line, comments=True)
            if not fields:
                continue
            if fields[0].lower() == 'match':
                raise ValueError('Include before deploy policy contains Match; owner must move that Match into sshd_config')
            if fields[0].lower() == 'include':
                for pattern in fields[1:]:
                    pattern = str(include_root / pattern) if not os.path.isabs(pattern) else pattern
                    for name in glob.glob(pattern):
                        path = Path(name).resolve()
                        if path in seen:
                            raise ValueError('recursive sshd Include')
                        check_includes(path.read_text(), seen | {path})
    first_match = re.search(r'^\s*Match\s+', config, re.I | re.M)
    split = first_match.start() if first_match else len(config)
    prefix, suffix = config[:split], config[split:]
    check_includes(prefix, set())
    block = begin + '\nMatch User deploy\n    PasswordAuthentication no\n    KbdInteractiveAuthentication no\nMatch all\n' + end + '\n'
    return prefix.rstrip('\n') + '\n' + block + suffix


def assert_transition_policy(before, after, mode):
    def values(text, name):
        return re.findall(r'^\s*' + name + r'\s+([^\n#]+)', text, re.I | re.M)
    if '/etc/ssh/deploy_ca.pub' not in [v.strip() for v in values(after, 'TrustedUserCAKeys')]:
        raise ValueError('managed trust directive is missing; complete S2 before principals apply')
    if mode == 'trust' and values(before, 'AuthorizedPrincipalsFile') != values(after, 'AuthorizedPrincipalsFile'):
        raise ValueError('trust transaction must preserve the existing principals directive')


@contextmanager
def host_lock(root, preview=False):
    if preview:
        yield
        return
    path = checked_path(root, 'etc/ssh/ca-rotation.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        stat = os.fstat(fd)
        if stat.st_uid != 0 or stat.st_mode & 0o077:
            raise ValueError('apply lock must be root-owned and mode 0600')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('another CA rotation apply/rollback holds the host lock') from None
        yield
    finally:
        os.close(fd)


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
    if path.parent.name == 'principals':
        os.chmod(path.parent, 0o755)
        mode = 0o644
    fd, name = tempfile.mkstemp(prefix='.ca-rotation-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def validate_and_reload(args, conf, desired=False):
    run([args.sshd, '-t', '-f', str(conf)])
    if desired and getattr(args, 'mode', None) and not getattr(args, 'rollback', None):
        for user in (['deploy', 'root'] if args.mode == 'principals' else ['root']):
            effective = run([args.sshd, '-T', '-f', str(conf), '-C', 'user=' + user + ',host=localhost,addr=127.0.0.1'])
            values = dict(line.split(' ', 1) for line in effective.splitlines() if ' ' in line)
            if values.get('trustedusercakeys') != '/etc/ssh/deploy_ca.pub':
                raise ValueError('effective trust path differs; inspect Includes/Match before applying')
            if args.mode == 'principals':
                if values.get('authorizedprincipalsfile') != '/etc/ssh/principals/%u' or values.get('authorizedprincipalscommand', 'none') != 'none':
                    raise ValueError('effective principal policy differs; inspect Includes/Match')
                if user == 'deploy' and any(values.get(k) != 'no' for k in ['passwordauthentication', 'kbdinteractiveauthentication']):
                    raise ValueError('effective deploy password policy differs')
    run(['systemctl', 'reload', args.service])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['trust', 'principals'])
    parser.add_argument('public_key', nargs='?')
    parser.add_argument('--box', choices=['think-box', 'onboarding-app-box', 'ivy-box'])
    parser.add_argument('--retire-legacy', action='store_true')
    parser.add_argument('--retire-v1', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--root', default='/', help='offline fixture root; dry-run only')
    parser.add_argument('--service', choices=['ssh', 'sshd'], default='ssh')
    parser.add_argument('--sshd', default='/usr/sbin/sshd')
    parser.add_argument('--rollback', help='backup directory printed by an earlier apply')
    args = parser.parse_args()
    if args.mode == 'trust' and (args.box or args.retire_legacy):
        parser.error('principal options require the principals entry script')
    if args.mode == 'principals' and (args.public_key or args.retire_v1):
        parser.error('CA options require the trust entry script')
    root = Path(args.root).absolute()
    if root != Path('/') and not args.dry_run:
        raise ValueError('--root is for offline dry-run only')
    if not args.dry_run and os.geteuid() != 0:
        raise ValueError('apply requires root; use --dry-run for review')
    # Every read used to construct a transaction occurs under the same host lock.
    with host_lock(root, args.dry_run):
        plan_and_apply(args, root, parser)


def plan_and_apply(args, root, parser):
    conf = checked_path(root, 'etc/ssh/sshd_config')
    ca = checked_path(root, 'etc/ssh/deploy_ca.pub')
    if not conf.is_file():
        raise ValueError('sshd_config missing')
    create_deploy = False
    disable_deploy = False
    if args.rollback:
        backup = Path(args.rollback).absolute()
        expected = root / 'etc/ssh/ca-rotation-backups'
        if backup.parent != expected or backup.is_symlink():
            raise ValueError('rollback must name a direct child of ' + str(expected))
        checked_path(root, str(backup.relative_to(root)))
        manifest = json.loads(checked_path(backup, 'manifest.json').read_text())
        changes = {}
        disable_deploy = bool(manifest.get('created_deploy'))
        for relative, existed in manifest['files'].items():
            if relative not in ['etc/ssh/deploy_ca.pub', 'etc/ssh/sshd_config', 'etc/ssh/principals/deploy', 'etc/ssh/principals/root']:
                raise ValueError('unexpected rollback path')
            path = checked_path(root, relative)
            changes[path] = checked_path(backup, relative).read_text() if existed else None
    elif args.mode == 'principals':
        if not args.box:
            parser.error('--box is required')
        templates = Path(__file__).resolve().parents[1] / 'principals' / args.box
        changes = {conf: directive(read(conf), 'AuthorizedPrincipalsFile', '/etc/ssh/principals/%u')}
        # Disable password/keyboard-interactive for deploy without weakening other accounts.
        changes[conf] = deploy_policy(changes[conf], root / 'etc/ssh')
        for user in ['deploy', 'root']:
            content = (templates / user).read_text()
            if args.retire_legacy and user != 'deploy':
                content = ''.join(line + '\n' for line in content.splitlines() if line != user)
            changes[checked_path(root, 'etc/ssh/principals/' + user)] = content
        if root == Path('/'):
            try:
                run(['id', '-u', 'deploy'])
            except subprocess.CalledProcessError:
                create_deploy = True
            if not create_deploy:
                groups = set(run(['id', '-nG', 'deploy']).split())
                if groups.intersection({'sudo', 'wheel', 'admin', 'docker', 'lxd', 'disk'}):
                    raise ValueError('existing deploy user has privileged groups; owner must resolve')
                if shutil.which('sudo') and not args.retire_legacy:
                    check = subprocess.run(['sudo', '-n', '-l', '-U', 'deploy'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    if check.returncode == 0:
                        raise ValueError('existing deploy user has sudo rights; owner must resolve')
        else:
            create_deploy = not any(line.startswith('deploy:') for line in read(root / 'etc/passwd').splitlines())
    elif args.retire_v1:
        v1 = 'SHA256:Sg4TJdI9+SNBj8K0et1nEBhb8ntuX7ZzXSqzikyyDL0'
        kept = [line for line in read(ca).splitlines(keepends=True) if fingerprint(line) != v1]
        if not any(line.strip() and not line.lstrip().startswith('#') for line in kept):
            raise ValueError('refusing to remove the last CA')
        changes = {ca: ''.join(kept)}
    else:
        if not args.public_key:
            parser.error('public key file is required')
        key = public_key(Path(args.public_key).read_text())
        changes = {ca: append_ca(read(ca), key), conf: directive(read(conf), 'TrustedUserCAKeys', '/etc/ssh/deploy_ca.pub')}
    changed = {p: value for p, value in changes.items() if value != (p.read_text() if p.exists() else None)}
    for path, value in changed.items():
        diff(path, read(path), value or '')
    if disable_deploy:
        print('- ACCOUNT deploy: lock, expire, and set nologin; retain home for owner review')
    if create_deploy:
        print('+ ACCOUNT deploy: useradd --create-home --user-group --shell /bin/bash --password * deploy (no usable password, no sudo)')
    print('PLAN: sshd -t; systemctl reload ' + args.service + '; restore previous files if validation/reload fails')
    planned_ca = changes.get(ca, read(ca))
    for line in (planned_ca or '').splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            print('CA fingerprint: ' + fingerprint(line))
    if args.dry_run:
        print('DRY-RUN: no files, accounts, services, or backups changed')
        return
    if os.geteuid() != 0:
        raise ValueError('apply requires root; use --dry-run for review')
    if not args.rollback:
        assert_transition_policy(read(conf), changes.get(conf, read(conf)), args.mode)
    for policy_path in [conf.parent, conf.parent / 'principals', conf.parent / 'ca-rotation-backups', *changes]:
        if policy_path.exists() and (policy_path.stat().st_uid != 0 or policy_path.stat().st_mode & 0o022):
            raise ValueError('SSH policy must be root-owned and not group/world writable: ' + str(policy_path))
        if policy_path.exists() and policy_path.parent.name == 'principals' and policy_path.stat().st_mode & 0o777 != 0o644:
            raise ValueError('Existing principals file must be mode 0644: ' + str(policy_path))
        if policy_path.exists() and policy_path.name == 'principals' and policy_path.stat().st_mode & 0o777 != 0o755:
            raise ValueError('Existing principals directory must be mode 0755: ' + str(policy_path))
    if not changed and not create_deploy and not disable_deploy:
        print('Already current; no reload')
        return
    apply_changes(changed, root, args, conf, ca, create_deploy, disable_deploy)


def apply_changes(changed, root, args, conf, ca, create_deploy=False, disable_deploy=False):
    # Validate the baseline before doing anything and keep a recovery snapshot for rollback itself.
    rollback = getattr(args, 'rollback', None)
    if not rollback:
        run([args.sshd, '-t', '-f', str(conf)])
    parent = checked_path(root, 'etc/ssh/ca-rotation-backups')
    parent.mkdir(mode=0o700, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='rotation-', dir=parent))
    manifest = {'created_deploy': create_deploy, 'files': {str(p.relative_to(root)): p.exists() for p in changed}}
    for path in changed:
        if path.exists():
            dest = backup / path.relative_to(root)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
    (backup / 'manifest.json').write_text(json.dumps(manifest))
    if rollback:
        candidate = backup / 'rollback-candidate.conf'
        candidate.write_text(changed.get(conf, read(conf)))
        run([args.sshd, '-t', '-f', str(candidate)])
    entry = 'apply-principals-linux.sh' if getattr(args, 'mode', 'trust') == 'principals' else 'apply-trust-linux.sh'
    print('ROLLBACK: sudo deploy-keys/' + entry + ' --rollback ' + str(backup) + ' --service ' + args.service, flush=True)
    created = False
    try:
        if create_deploy:
            run(['useradd', '--create-home', '--user-group', '--shell', '/bin/bash', '--password', '*', 'deploy'])
            created = True
            if shutil.which('sudo'):
                rights = subprocess.run(['sudo', '-n', '-l', '-U', 'deploy'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if rights.returncode == 0:
                    raise ValueError('new deploy user inherits sudo rights; account will be disabled')
        for path, value in changed.items():
            if value is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, value, (path.stat().st_mode & 0o777) if path.exists() else 0o644)
        if disable_deploy:
            run(['usermod', '--lock', '--expiredate', '1', '--shell', '/usr/sbin/nologin', 'deploy'])
        validate_and_reload(args, conf, desired=True)
    except Exception:
        errors = []
        for path in changed:
            try:
                saved = backup / path.relative_to(root)
                if saved.exists():
                    atomic_write(path, saved.read_text(), saved.stat().st_mode & 0o777)
                else:
                    path.unlink(missing_ok=True)
            except Exception as error:
                errors.append('restore ' + str(path) + ': ' + str(error))
        if created:
            try:
                run(['usermod', '--lock', '--expiredate', '1', '--shell', '/usr/sbin/nologin', 'deploy'])
                print('New deploy account locked; home retained for owner review')
            except Exception as error:
                errors.append('disable deploy: ' + str(error))
        try:
            validate_and_reload(args, conf)
        except Exception as error:
            errors.append('restore validation/reload: ' + str(error))
        for error in errors:
            print('RECOVERY ERROR: ' + error, file=sys.stderr)
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
