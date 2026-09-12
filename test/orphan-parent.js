// Fixture for child-lifecycle.test.js: starts a real server child through the same harness the
// suite uses, prints its pid, then hangs forever and never calls stop(). The test SIGKILLs this
// process — the harshest case, where no cleanup hook of ours can run — and asserts the child it
// left behind dies with it anyway. The broker is the child here rather than the deck only
// because it needs no second loopback alias, so this case runs anywhere.
const { startBroker } = require('./http');

startBroker().then((b) => {
  console.log('PID ' + b.child.pid);
  setInterval(() => {}, 1000);
});
