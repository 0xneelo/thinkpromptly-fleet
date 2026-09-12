'use strict';
// Screens address compiled nodes by their data-dc-tpl id (public/v2/app.js). A
// recompile that adds nodes earlier in the template renumbers every id after
// them, and a stale id fails silently: on 2026-09-11 a click on the sidebar's
// "Desktop sessions" nav button opened a terminal tile. This test finds each
// addressed node by what it is (tag, literal text, attribute, template binding)
// and fails with the id the table should hold now.
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const V2 = join(__dirname, '..', 'public', 'v2');
const SCREENS = join(V2, 'screens');
const APP = readFileSync(join(V2, 'app.js'), 'utf8');

/* app.js is compiler output, one element per line, nested by indentation:
 *   h("tag", { key: k+"|N", "data-dc-tpl": "ID", …attrs },
 * Text children are t(k+"|N", "literal") or I(k+"|N", v, ["", " expr ", ""]),
 * sc-for loops are A(aN(v)).map(…), and each binding aN is defined once at the
 * top as aN = C("…template source…"). */
function parse(src) {
  const defs = {};
  for (const m of src.matchAll(/^ *(a\d+) = C\((".*")\),?$/gm)) defs[m[1]] = JSON.parse(m[2]);
  const nodes = new Map();
  const stack = []; // { ind, id, loops } for open elements and open loops
  src.split('\n').forEach((line, i) => {
    const ind = line.search(/\S/);
    if (ind < 0) return;
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    const top = stack[stack.length - 1] || { id: null, loops: [] };
    const loop = line.match(/^\s*A\((a\d+)\(v\d*\)\)\.map\(/);
    if (loop) { stack.push({ ind, id: top.id, loops: [...top.loops, defs[loop[1]]] }); return; }
    const el = line.match(/^\s*h\("([^"]+)", \{ key: [^,]+, "data-dc-tpl": "(\d+)"(.*)$/);
    if (el) {
      const style = (el[3].match(/style: (a\d+)\(v\d*\)/) || [])[1];
      nodes.set(el[2], { id: el[2], line: i + 1, tag: el[1], attrs: el[3], style: style ? defs[style] : null,
        text: [], parent: top.id, loops: top.loops });
      stack.push({ ind, id: el[2], loops: top.loops });
      return;
    }
    if (!top.id) return;
    const lit = line.match(/^\s*t\(k\d*\+"\|\d+", (".*")\)/);
    if (lit) { const s = JSON.parse(lit[1]).trim(); if (s) nodes.get(top.id).text.push(s); return; }
    const bound = line.match(/^\s*I\(k\d*\+"\|\d+", v\d*, (\[.*\])\)/);
    if (bound) JSON.parse(bound[1]).forEach((s, j) => { if (j % 2) nodes.get(top.id).text.push('{{ ' + s.trim() + ' }}'); });
  });
  return nodes;
}

const nodes = parse(APP);
const all = [...nodes.values()];
const q = {
  parent: (n) => nodes.get(n.parent),
  up(n) { const out = []; for (let p = q.parent(n); p; p = q.parent(p)) out.push(p); return out; },
  // The element an sc-for renders once per item: inside exactly this loop chain,
  // with a parent outside its innermost loop.
  root: (n, ...chain) => n.loops.join('|') === chain.join('|') && q.parent(n).loops.length < chain.length,
};

const REFRESH = (n) => n.tag === 'button' && n.text.includes('Refresh') && q.up(n).some((a) => a.tag === 'header');

const EXPECT = {
  'shell.js': {
    themeBtn: (n) => n.tag === 'button' && n.attrs.includes('"aria-label": "Toggle light / dark mode"')
      && q.up(n).some((a) => a.attrs.includes('"data-screen-label": "Fleetdeck app"')),
    connectAll: (n) => n.tag === 'button' && n.text.includes('Connect all'),
    sessionList: (n) => all.some((k) => k.parent === n.id && q.root(k, '{{ A_groups }}')),
    sessionRow: (n) => n.tag === 'button' && q.root(n, '{{ A_groups }}', '{{ g.items }}'),
    livePill: (n) => n.tag === 'span' && n.text.includes('Live API'),
    refresh: REFRESH,
    accountRow: (n) => q.root(n, '{{ A_miniAccounts }}'),
    boxRow: (n) => q.root(n, '{{ A_boxRows }}'),
  },
  'machines.js': {
    // afterRender queries `:scope > card` under the Machines screen.
    card: (n) => q.root(n, '{{ A_machines }}') && q.parent(n).attrs.includes('"data-screen-label": "Machines"'),
    kindChip: (n) => n.tag === 'span' && n.text.includes('{{ m.kind }}'),
    reported: (n) => n.tag === 'span' && n.text.includes('reported just now'),
    row: (n) => q.root(n, '{{ A_machines }}', '{{ m.rows }}'),
    note: (n) => n.tag === 'p' && n.text.includes('{{ r.note }}') && n.loops.includes('{{ m.rows }}'),
    refresh: REFRESH,
  },
};

// Each table is a plain object literal with no nested braces, so it evaluates alone.
function tableOf(file) {
  const m = readFileSync(join(SCREENS, file), 'utf8').match(/var TPL = (\{[\s\S]*?\});/);
  assert.ok(m, file + ' still declares var TPL = {…}');
  return { ...vm.runInNewContext('(' + m[1] + ')') };
}

test('the parser sees every compiled node', () => {
  assert.strictEqual(nodes.size, APP.split('"data-dc-tpl": "').length - 1);
});

test('every screen that looks nodes up by compiler id is covered here', () => {
  const users = readdirSync(SCREENS).filter((f) => /\[data-dc-tpl="' \+/.test(readFileSync(join(SCREENS, f), 'utf8')));
  assert.deepStrictEqual(users.sort(), Object.keys(EXPECT).sort());
});

for (const [file, expect] of Object.entries(EXPECT)) {
  const table = tableOf(file);

  test(file + ': every TPL entry has an expectation', () => {
    assert.deepStrictEqual(Object.keys(table).sort(), Object.keys(expect).sort());
  });

  for (const [name, want] of Object.entries(expect)) {
    test(`${file}: TPL.${name} is still the node it names`, () => {
      const hits = all.filter(want);
      assert.strictEqual(hits.length, 1,
        `${name}: ${hits.length} nodes match (${hits.map((n) => n.id).join(', ')}); the expectation must pick exactly one`);
      assert.strictEqual(table[name], hits[0].id,
        `${file} TPL.${name} = '${table[name]}', but app.js:${hits[0].line} holds it as '${hits[0].id}'`);
    });
  }
}
