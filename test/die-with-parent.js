// Preloaded into every child `spawnChild` starts (node --require this file). The parent holds
// the write end of this child's stdin and never writes to it, so EOF here can only mean the
// parent is gone — including when it was SIGKILLed and no cleanup hook of its own could run.
// That is what makes a leaked test server impossible rather than merely tidied up afterwards.
//
// The watcher is unref'd: it must never keep a child alive that would otherwise finish on its
// own (the broker's SIGTERM test waits on exactly that), but an unref'd handle still delivers
// EOF for as long as the child is alive for its own reasons.
const die = () => process.exit(0);
process.stdin.on('end', die);
process.stdin.on('close', die);
process.stdin.on('error', die);
process.stdin.resume();
process.stdin.unref();
