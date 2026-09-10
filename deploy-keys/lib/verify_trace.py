#!/usr/bin/env python3
"""Fail-closed parsing of an owner-side, single-connection OpenSSH debug trace.

OpenSSH sshconnect2.c emits an offer before send_pubkey_test and an acceptance
before signing. Require the offered certificate's fingerprint, a sent request,
and SSH_MSG_USERAUTH_FAILURE (51), without a PK_OK/acceptance or successful login.
https://github.com/openssh/openssh-portable/blob/master/sshconnect2.c
"""
import re
import sys


def certificate_refused(trace, host, port, user, fingerprint, status):
    if status != 255:
        return False
    target = re.compile(r"^debug1: Authenticating to " + re.escape(host) +
                        r"(?: \[[^\]]+\])?:" + re.escape(port) + r" as '" + re.escape(user) + r"'$", re.M)
    if not target.search(trace) or 'debug1: SSH2_MSG_NEWKEYS received' not in trace:
        return False
    if 'Server accepts key:' in trace or 'Authenticated to ' in trace or 'Load key ' in trace:
        return False
    offered = sent = denied = False
    for line in trace.replace('\r', '').splitlines():
        if line.startswith('debug1: Offering public key:'):
            if offered:
                return False  # Multiple offers cannot prove isolation of the supplied pair.
            offered = bool(re.search(r' ED25519-CERT ' + re.escape(fingerprint) + r'(?: |$)', line))
            if not offered:
                return False
        elif offered and line == 'debug3: send packet: type 50':
            sent = True
        elif sent and line == 'debug3: receive packet: type 51':
            denied = True
        elif sent and line == 'debug3: receive packet: type 60':
            return False
    return denied and bool(re.search(r'^' + re.escape(user + '@' + host) +
                                    r': Permission denied \(publickey\)\.$', trace, re.M))


if __name__ == '__main__':
    host, port, user, fingerprint, status = sys.argv[1:]
    sys.exit(0 if certificate_refused(sys.stdin.read(), host, port, user, fingerprint, int(status)) else 1)
