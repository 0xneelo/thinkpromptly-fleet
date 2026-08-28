#!/bin/sh
# fd-codex-wrap.sh <command> [args...] - claim a fleet lease, run <command>, deregister.
#
# The Codex breed has NO hooks, so it cannot use SessionStart/SessionEnd. The normal Codex
# path is the `mark.sh --worker` piggyback that install-box.sh patches in (the launcher runs
# that line for both breeds). THIS wrapper is the explicit alternative for a Codex session
# that is NOT started through mark.sh: wrap the launch line with it instead.
#
#   fd-codex-wrap.sh codex --some-flag /path/to/prompt.md
#
# Rules that outrank convenience here:
#  - The wrapped argv is NEVER inspected, echoed or logged. A launch line can carry a prompt
#    path or a flag with a secret in it; logging argv is how that leaks.
#  - `exec` is deliberately NOT used: it would replace this shell and skip the deregister.
#    The command runs as a foreground child (so it keeps the terminal and the process group -
#    a backgrounded TUI would stop on SIGTTIN), and a trap covers every exit path.
#  - The wrapped command's exit status is what this script exits with. Nothing here may
#    swallow or rewrite it.
# POSIX sh only.
set -u

FD_BIN=${FD_BIN:-$(dirname -- "$0")}

if [ $# -lt 1 ]; then
  # No argv is ever echoed, including in this message.
  echo "usage: fd-codex-wrap.sh <command> [args...]" >&2
  exit 2
fi

# Deregister exactly once, however we leave. Silent and never fatal: a failing cleanup must
# not change the status the operator sees for their own command.
fd_wrap_done=''
fd_wrap_cleanup() {
  [ -n "$fd_wrap_done" ] && return 0
  fd_wrap_done=1
  [ -r "$FD_BIN/deregister.sh" ] && sh "$FD_BIN/deregister.sh" >/dev/null 2>&1
  return 0
}

# 128+signo, the shell's own convention for a signal death - so a Ctrl-C through this
# wrapper reports the same status it would without it.
#
# KNOWN LIMIT, and it is the price of keeping the child in the foreground: POSIX sh defers a
# trap until the running foreground command returns, and the child gets no signal of its own.
# That is harmless for the way this is used - Ctrl-C, a closing pane and `tmux kill-session`
# all signal the whole foreground process group, so the child dies and the trap runs at once.
# A `kill -TERM <wrapper-pid>` aimed at THIS pid alone is the exception: the child keeps
# running and the deregister waits for it. Signal the process group (`kill -TERM -<pgid>`)
# if you need that case. Forwarding instead would mean backgrounding the child, and a
# backgrounded TUI stops on SIGTTIN the moment it reads the terminal.
trap 'fd_wrap_cleanup' EXIT
trap 'fd_wrap_cleanup; exit 130' INT
trap 'fd_wrap_cleanup; exit 143' TERM
trap 'fd_wrap_cleanup; exit 129' HUP

# Claim first, so the lease exists before the session can do anything. It spawns the
# detached pinger itself. Silent and never fatal: no lease is a degraded session, not a
# dead one. Inside tmux the session name resolves from tmux; elsewhere (a mac desktop
# Codex) set FD_NAME and FD_PID in the environment before calling this.
[ -r "$FD_BIN/lease-claim.sh" ] && sh "$FD_BIN/lease-claim.sh" >/dev/null 2>&1

"$@"
status=$?

fd_wrap_cleanup
exit "$status"
