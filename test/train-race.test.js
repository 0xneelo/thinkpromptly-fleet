// The start/end race in fleetdeck-train.js, run in-process. POST /api/ghtrain awaits the
// 1Password read before it sets ghTrain, so an /end that landed during that wait used to be
// undone the moment the older start resolved: the window reopened with nobody having asked.
// `op` is a parked callback here, so each test chooses when a read completes.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const { tmpdir } = require('./helpers');

// Config before require: the module reads its env at load time, and would otherwise listen
// and spawn caffeinate.
const env = path.join(tmpdir('train-race'), 'github-app.env');
fs.writeFileSync(env, 'export GH_APP_ID=1\nexport GH_APP_INSTALLATION_ID=2\nexport GH_APP_KEY_OP="op://Private/key"\n');
Object.assign(process.env, { FLEET_GH_ENV: env, FLEET_TRAIN_NO_LISTEN: '1', FLEET_TRAIN_NO_CAFFEINATE: '1' });

// The broker destructures execFile at require time, so the fake has to be in place first.
// Every `op document get` parks its callback here; a test fires it when it chooses.
const reads = [];
child_process.execFile = (cmd, args, opts, cb) => {
  reads.push(cb);
};
const train = require('../fleetdeck-train');

const PEM = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n';
const ENDED = { active: false, expiresAt: null };

afterEach(() => {
  train.endTrain(); // clears any timer, so the runner exits
  reads.length = 0;
});

test('an /end that lands while the op read is pending is not undone when the start resolves', async () => {
  const start = train.startTrainForTest('1h');
  assert.equal(reads.length, 1, 'start is parked on the op read');
  assert.deepEqual(train.trainStatus(), ENDED);
  train.endTrain();
  reads[0](null, PEM, '');
  const r = await start;
  assert.equal(r.code, 409);
  assert.equal(r.body.ok, false);
  assert.deepEqual(train.trainStatus(), ENDED, 'the stale start must not reopen the window');
});

test('a newer start supersedes an older one still parked on op, whichever resolves first', async () => {
  const older = train.startTrainForTest('1h');
  const newer = train.startTrainForTest('4h');
  assert.equal(reads.length, 2);
  reads[1](null, PEM, '');
  assert.equal((await newer).code, 200);
  const { expiresAt } = train.trainStatus();
  reads[0](null, PEM, '');
  assert.equal((await older).code, 409);
  assert.deepEqual(train.trainStatus(), { active: true, expiresAt }, 'the newer window stands untouched');
});

test('a start with nothing in between still opens the window', async () => {
  const start = train.startTrainForTest('1h');
  reads[0](null, PEM, '');
  assert.equal((await start).code, 200);
  assert.equal(train.trainStatus().active, true);
});
