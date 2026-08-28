const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { MessageBus } = require('../message-bus');

const target = (value) => {
  if (value?.type !== 'claude-desktop' || value.session !== 'current') throw new Error('bad target');
  return value;
};

test('persists a delivered message and deduplicates its id', async () => {
  const db = new DatabaseSync(':memory:');
  const delivered = [];
  const bus = new MessageBus(db, async (message) => delivered.push(message.text), target);
  const input = {
    id: 'message-001',
    source: 'codex-desktop',
    target: { type: 'claude-desktop', session: 'current' },
    text: 'hello Claude',
  };

  const first = await bus.send(input);
  const duplicate = await bus.send(input);

  assert.equal(first.status, 'delivered');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(delivered, ['hello Claude']);
  assert.equal(bus.list()[0].text, 'hello Claude');
});

test('records delivery failure and retries it once', async () => {
  const db = new DatabaseSync(':memory:');
  let attempts = 0;
  const bus = new MessageBus(
    db,
    async () => {
      if (++attempts === 1) throw new Error('receiver offline');
    },
    target
  );
  const input = {
    id: 'message-002',
    source: 'fleetdeck-ui',
    target: { type: 'claude-desktop', session: 'current' },
    text: 'retry me',
  };

  assert.equal((await bus.send(input)).status, 'failed');
  assert.match(bus.get(input.id).error, /receiver offline/);
  assert.equal((await bus.retry(input.id)).status, 'delivered');
  assert.equal(attempts, 2);
});

test('rejects empty and oversized messages before persistence', async () => {
  const db = new DatabaseSync(':memory:');
  const bus = new MessageBus(db, async () => {}, target);
  const base = {
    source: 'test',
    target: { type: 'claude-desktop', session: 'current' },
  };

  await assert.rejects(() => bus.send({ ...base, text: ' ' }), /non-empty/);
  await assert.rejects(() => bus.send({ ...base, text: 'x'.repeat(65 * 1024) }), /64 KiB/);
  assert.deepEqual(bus.list(), []);
});
