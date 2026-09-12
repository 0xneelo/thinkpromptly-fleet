// public/v2/tip.js — the pure half of the deck's tooltip. Requiring the module in
// Node hits its `typeof document === 'undefined'` guard, so no listener is
// registered; what is covered is which attribute wins (resolve) and where the
// popover lands (place). The DOM half is a handful of event handlers over these.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const tip = require(path.join(__dirname, '..', 'public/v2/tip.js'));

function el(attrs, textContent) {
  return { getAttribute: (k) => (k in attrs ? attrs[k] : null), textContent: textContent || '' };
}

test('resolve — data-tip beats title, which beats the parked title', () => {
  assert.deepStrictEqual(tip.resolve(el({ 'data-tip-title': 'H', 'data-tip': 'B', title: 'T' })), { heading: 'H', body: 'B' });
  assert.deepStrictEqual(tip.resolve(el({ title: 'T', 'data-tip-parked': 'P' })), { heading: '', body: 'T' });
  // Parked while shown: the title is gone but the popover still has its text.
  assert.deepStrictEqual(tip.resolve(el({ 'data-tip-parked': 'P' })), { heading: '', body: 'P' });
});

test('resolve — aria-label counts only on an icon-only element', () => {
  assert.deepStrictEqual(tip.resolve(el({ 'aria-label': 'Dismiss' }, '  ')), { heading: '', body: 'Dismiss' });
  assert.strictEqual(tip.resolve(el({ 'aria-label': 'Select' }, 'Select')), null);
  assert.strictEqual(tip.resolve(el({})), null);
});

test('place — centred below, clamped to the viewport, above only when below does not fit', () => {
  const view = { width: 800, height: 600 };
  const box = { width: 200, height: 50 };
  assert.deepStrictEqual(tip.place({ left: 300, top: 100, width: 100, height: 30 }, box, view), { x: 250, y: 138 });
  // Hugging the left edge keeps its margin rather than going negative.
  assert.deepStrictEqual(tip.place({ left: 0, top: 100, width: 20, height: 30 }, box, view), { x: 8, y: 138 });
  assert.deepStrictEqual(tip.place({ left: 790, top: 100, width: 20, height: 30 }, box, view), { x: 592, y: 138 });
  // Near the bottom it flips above.
  assert.deepStrictEqual(tip.place({ left: 300, top: 560, width: 100, height: 30 }, box, view), { x: 250, y: 502 });
  // When neither fits it stays below, which at least keeps the top edge readable.
  assert.deepStrictEqual(tip.place({ left: 300, top: 20, width: 100, height: 30 }, box, { width: 800, height: 80 }), { x: 250, y: 58 });
});
