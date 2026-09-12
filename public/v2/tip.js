// public/v2/tip.js — one styled tooltip for the whole deck, live mode only.
//
// The mock's icon buttons and chips carry `title` attributes, so the only tooltip
// the deck had was the browser's own: delayed, unstyled, and barely shown by the
// desktop app's webview. This gives every `title` — and the aria-label of an
// icon-only button that has no title at all — the popover the bus header already
// draws for its actions: heading + description, themed, under the element.
//
// Sources, in order: data-tip-title / data-tip (set by a screen file, e.g. the
// keys chips), then `title`, then `aria-label` on an element with no visible text.
// While the popover is up the element's `title` is parked in data-tip-parked so the
// native tooltip stays quiet; it goes back on leave. A title the app rewrites
// mid-hover (desktop.js flips a copy button to 'Copied') is caught by a
// MutationObserver and painted, so the popover never lags the button.
//
// Fixture mode (?fixture=1) registers nothing: the pixel gate must see the mock's
// DOM and nothing else. Node gets the pure half (resolve, place) for the test.
(function (global) {
  'use strict';

  var GAP = 8;        // px between the element and the popover
  var EDGE = 8;       // px the popover keeps from the viewport edge
  var SHOW_MS = 220;  // hover dwell before the popover appears

  // What an element wants shown, or null. `el` needs only getAttribute and
  // textContent, which is what lets the test run without a DOM.
  function resolve(el) {
    var heading = el.getAttribute('data-tip-title') || '';
    var body = el.getAttribute('data-tip') || el.getAttribute('title') || el.getAttribute('data-tip-parked') || '';
    if (!heading && !body) {
      var label = el.getAttribute('aria-label');
      if (label && !String(el.textContent || '').trim()) body = label;
    }
    return heading || body ? { heading: heading, body: body } : null;
  }

  // Where the popover goes: centred under the anchor, clamped to the viewport,
  // flipped above only when below does not fit and above does.
  function place(anchor, tip, view) {
    var x = anchor.left + anchor.width / 2 - tip.width / 2;
    x = Math.max(EDGE, Math.min(x, view.width - tip.width - EDGE));
    var below = anchor.top + anchor.height + GAP;
    var above = anchor.top - GAP - tip.height;
    var y = below + tip.height <= view.height - EDGE || above < EDGE ? below : above;
    return { x: x, y: y };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { resolve: resolve, place: place, SHOW_MS: SHOW_MS };
  }
  if (typeof document === 'undefined') return;
  if (isFixtureMode()) return;

  // Mirrors screens/keys.js: decided before anything touches the DOM.
  function isFixtureMode() {
    try { if (localStorage.getItem('fd-fixture') === '1') return true; } catch (e) { /* storage off */ }
    var search = global.location && global.location.search;
    return typeof search === 'string' && /[?&]fixture=1(&|$)/.test(search);
  }

  // The bus header's tipStyle (logic.js) and its tokens, per theme.
  var PALETTE = {
    dark: { bg: 'rgba(18,18,18,0.94)', line: 'rgba(255,255,255,0.13)', ink: '#ffffff', ink60: 'rgba(255,255,255,0.6)' },
    light: { bg: 'rgba(255,255,255,0.96)', line: 'rgba(0,0,0,0.13)', ink: '#111111', ink60: 'rgba(17,17,17,0.62)' },
  };

  var box = null, head = null, text = null;
  var cur = null;     // the element whose popover is up
  var armed = null;   // the element whose dwell timer is running
  var timer = null;
  var watch = null;   // MutationObserver on cur's title/data-tip
  var alive = null;   // while shown: notices cur leaving the DOM under a still mouse

  function ensure() {
    if (box) return;
    box = document.createElement('div');
    box.setAttribute('role', 'tooltip');
    box.setAttribute('data-fd-tip', '1');
    var s = box.style;
    s.position = 'fixed'; s.zIndex = '10000'; s.maxWidth = '260px'; s.display = 'none';
    s.flexDirection = 'column'; s.gap = '3px'; s.borderRadius = '10px'; s.padding = '9px 12px';
    s.boxShadow = '0 10px 30px rgba(0,0,0,0.3)'; s.pointerEvents = 'none'; s.textAlign = 'left';
    s.borderStyle = 'solid'; s.borderWidth = '1px';
    head = document.createElement('span');
    head.style.fontSize = '12px'; head.style.fontWeight = '500';
    text = document.createElement('span');
    text.style.fontSize = '11.5px'; text.style.lineHeight = '1.45';
    box.appendChild(head); box.appendChild(text);
    document.body.appendChild(box);
  }

  // The nearest ancestor with something to say. Bounded by body, and cheap: a
  // handful of attribute reads per mouseover.
  function target(node) {
    for (var el = node; el && el !== document.body && el.nodeType === 1; el = el.parentNode) {
      if (resolve(el)) return el;
    }
    return null;
  }

  function park(el) {
    var t = el.getAttribute('title');
    if (t === null) return;
    el.setAttribute('data-tip-parked', t);
    el.removeAttribute('title');
  }
  function unpark(el) {
    var t = el.getAttribute('data-tip-parked');
    if (t === null) return;
    el.removeAttribute('data-tip-parked');
    if (!el.hasAttribute('title')) el.setAttribute('title', t);
  }

  function paint(el, c) {
    var p = PALETTE[document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'];
    box.style.background = p.bg; box.style.borderColor = p.line;
    head.style.color = p.ink; text.style.color = p.ink60;
    head.textContent = c.heading; head.style.display = c.heading ? '' : 'none';
    text.textContent = c.body; text.style.display = c.body ? '' : 'none';
    box.style.display = 'flex';
    var at = place(el.getBoundingClientRect(), box.getBoundingClientRect(),
      { width: global.innerWidth, height: global.innerHeight });
    box.style.left = at.x + 'px'; box.style.top = at.y + 'px';
  }

  function show(el) {
    armed = null;
    if (!document.body.contains(el)) return;   // dropped by a render during the dwell
    park(el);
    var c = resolve(el);
    if (!c) return;
    ensure();
    cur = el;
    paint(el, c);
    watch = new MutationObserver(function () {
      park(el);
      var next = resolve(el);
      if (next) paint(el, next); else hide();
    });
    watch.observe(el, { attributes: true, attributeFilter: ['title', 'data-tip', 'data-tip-title'] });
    alive = setInterval(function () { if (!document.body.contains(el)) hide(); }, 500);
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    armed = null;
    if (watch) { watch.disconnect(); watch = null; }
    if (alive) { clearInterval(alive); alive = null; }
    if (cur) { unpark(cur); cur = null; }
    if (box) box.style.display = 'none';
  }

  document.addEventListener('mouseover', function (e) {
    var el = target(e.target);
    if (el && el === (cur || armed)) return;
    hide();
    if (!el) return;
    armed = el;
    timer = setTimeout(function () { timer = null; show(el); }, SHOW_MS);
  }, true);
  // Only a pointer leaving the element itself counts: a mouseout elsewhere must
  // not dismiss a popover that keyboard focus put up.
  document.addEventListener('mouseout', function (e) {
    var el = cur || armed;
    if (el && el.contains(e.target) && !(e.relatedTarget && el.contains(e.relatedTarget))) hide();
  }, true);
  document.addEventListener('focusin', function (e) {
    var el = target(e.target);
    if (el && el !== cur) { hide(); show(el); }
  }, true);
  document.addEventListener('focusout', function (e) { if (cur && cur.contains(e.target)) hide(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); }, true);
  // Only a scroll that moves the anchor matters; the deck's log panel scrolls
  // itself on every poll and must not dismiss a popover elsewhere.
  document.addEventListener('scroll', function (e) {
    if (cur && (e.target === document || e.target.contains(cur))) hide();
  }, true);
  global.addEventListener('resize', hide);
})(typeof window !== 'undefined' ? window : globalThis);
