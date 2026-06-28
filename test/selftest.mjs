// Offline self-test. No network, no dependencies.
// 1) Syntax-checks both source files.
// 2) Exercises the server-side Notion shaping with mock pages.
// 3) Runs the client scoring algorithm against a DOM stub and asserts invariants.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);

let passed = 0;
function ok(name) { passed++; console.log('  ok  ' + name); }

// --- 1. Syntax ---------------------------------------------------------------
for (const f of ['api/index.js', 'public/app.js']) {
  execFileSync(process.execPath, ['--check', join(root, f)], { stdio: 'pipe' });
  ok('syntax: ' + f);
}

// --- 2. Server-side shaping --------------------------------------------------
const api = require(join(root, 'api/index.js'));
const { shapeGlazes, shapeClays, shapeFinished, extractCode } = api._internals;

function titleProp(text) { return { type: 'title', title: [{ plain_text: text }] }; }
function sel(name) { return { type: 'select', select: name == null ? null : { name } }; }
function multi(names) { return { type: 'multi_select', multi_select: names.map((n) => ({ name: n })) }; }
function check(v) { return { type: 'checkbox', checkbox: v }; }
function rel(ids) { return { type: 'relation', relation: ids.map((id) => ({ id })) }; }
function text(s) { return { type: 'rich_text', rich_text: [{ plain_text: s }] }; }

const glazePages = [
  {
    id: 'pc10id',
    properties: {
      Name: titleProp('Amaco - PC-10 June Bug'),
      Movement: sel('High'),
      'Breaks over Texture': sel('Strong'),
      'Color Family': sel('COPPER'),
      'Clay Class': sel('Transparent-colour'),
      'Food Use': sel('Functional'),
      'Layering Role': multi(['high-mover'])
    }
  },
  {
    id: 'pc12id',
    properties: {
      Name: titleProp('Amaco - PC-12 Blue Midnight'),
      Movement: sel('Medium'),
      'Breaks over Texture': sel('Subtle'),
      'Color Family': sel('COBALT'),
      'Clay Class': sel('Opaque-saturated'),
      'Food Use': sel('Functional'),
      'Layering Role': multi([])
    }
  },
  {
    id: 'studioid',
    properties: {
      Name: titleProp('Studio - XX-1 Unrelated'),
      'Clay Class': sel(null) // no Clay Class: excluded
    }
  }
];

const { glazes, glazeById } = shapeGlazes(glazePages);
assert.equal(glazes.length, 2, 'two classified glazes');
const pc10 = glazes.find((g) => g.code === 'PC-10');
assert.ok(pc10, 'PC-10 parsed');
assert.equal(pc10.name, 'June Bug');
assert.equal(pc10.brand, 'Amaco');
assert.equal(pc10.cls, 'TC');
assert.equal(pc10.mv, 3);
assert.equal(pc10.color, 'COPPER');
assert.equal(glazeById['pc10id'], 'PC-10');
assert.equal(glazeById['studioid'], 'XX-1', 'unclassified still maps id to code for relations');
assert.equal(extractCode('Amaco - PC-10 June Bug'), 'PC-10');
ok('shapeGlazes: parse, exclude, id map');

const clayPages = [
  { id: 'wh8id', properties: { Name: titleProp('New Mexico Clay - WH8 Stoneware'), Tone: sel('White'), Speckled: check(false) } },
  { id: 'ermid', properties: { Name: titleProp('New Mexico Clay - Ermine'), Tone: sel('White'), Speckled: check(true) } },
  { id: 'choid', properties: { Name: titleProp('New Mexico Clay - Chocolate'), Tone: sel('Near-black'), Speckled: check(false) } },
  { id: 'notone', properties: { Name: titleProp('New Mexico Clay - Mystery'), Tone: sel(null) } }
];
const { clays, clayById } = shapeClays(clayPages);
assert.equal(clays.length, 3, 'three classified clays, no-Tone excluded');
assert.deepEqual(clays.map((c) => c.name), ['New Mexico Clay - WH8 Stoneware', 'New Mexico Clay - Ermine', 'New Mexico Clay - Chocolate'], 'ordered D asc, S asc, name');
assert.equal(clays[0].D, 0);
assert.equal(clays[2].D, 3);
ok('shapeClays: parse, exclude, order');

const tilePages = [
  {
    id: 't1',
    properties: {
      Status: sel('Finished'),
      'Base Glaze': rel(['pc10id']),
      'Top Glaze': rel([]),
      Clay: rel(['wh8id']),
      Layers: text('Base (PC-10 June Bug): 3'),
      Name: text('PC-10 June Bug')
    }
  },
  {
    id: 't2',
    properties: {
      Status: sel('Finished'),
      'Base Glaze': rel([]),
      'Top Glaze': rel([]),
      Clay: rel(['wh8id']),
      Layers: text('Base (PC-10 June Bug): 3\nTop (PC-12 Blue Midnight): 2'),
      Name: text('PC-10 June Bug → PC-12 Blue Midnight')
    }
  },
  {
    id: 't3',
    properties: { Status: sel('To-Do'), 'Base Glaze': rel(['pc10id']), Clay: rel(['wh8id']) }
  }
];
const finished = shapeFinished(tilePages, glazeById, clayById);
assert.equal(finished.length, 2, 'only Finished rows');
const single = finished.find((f) => f.top === null);
assert.ok(single && single.base === 'PC-10' && single.clay === 'New Mexico Clay - WH8 Stoneware', 'single resolved via relation + Name');
const combo = finished.find((f) => f.top === 'PC-12');
assert.ok(combo && combo.base === 'PC-10', 'combo resolved via Layers text');
ok('shapeFinished: status filter, relation/Layers resolution, single vs combo');

// --- 3. Client scoring -------------------------------------------------------
function stubEl() {
  const e = {
    style: {}, _children: [], className: '', textContent: '', title: '',
    appendChild(c) { this._children.push(c); return c; },
    setAttribute() {}, addEventListener() {},
    querySelector() { return stubEl(); },
    classList: { contains() { return false; }, add() {} }
  };
  let h = '';
  Object.defineProperty(e, 'innerHTML', { get() { return h; }, set(v) { h = v; } });
  return e;
}
const documentStub = {
  getElementById() { return stubEl(); },
  createElement() { return stubEl(); },
  createTextNode() { return stubEl(); }
};
const windowStub = { __GMDATA__: { glazes: [], clays: [], finished: [], generatedAt: null } };
const sandbox = { window: windowStub, document: documentStub, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sandbox);

const T = windowStub.__GM_TEST__;
assert.ok(T, 'app.js exposed test hook (rendered without throwing)');

const base = T.enrich({ code: 'C-21', name: 'x', mv: 1, brk: 'None', color: 'NEUTRAL', cls: 'PO', fs: 'OK', roles: ['base-friendly'] });
const named = T.enrich({ code: 'CR-12', name: 'y', mv: 2, brk: 'Subtle', color: 'COBALT', cls: 'OS', fs: 'OK', roles: [] });
const plain = T.enrich({ code: 'ZZ-1', name: 'z', mv: 2, brk: 'None', color: 'NEUTRAL', cls: 'OS', fs: 'OK', roles: [] });

// A_NAMED C-21|CR-12 is a top pick.
assert.equal(T.baseLook(base, named), T.REC, 'A_NAMED pair is Recommended');
// At D0/S false the band equals baseLook.
assert.equal(T.bandCombo(base, named, { D: 0, S: false }), T.baseLook(base, named), 'white baseline equals baseLook');
// Non-named, low interest is Worth a test at white.
assert.equal(T.baseLook(base, plain), T.WORTH, 'low-interest pair is Worth a test');
// Ermine freckle promotion: base cls PO is in SHOWS, so D0/S true promotes one toward Recommended.
assert.equal(T.bandCombo(base, plain, { D: 0, S: true }), T.REC, 'freckle promotes Worth a test to Recommended');
// Chocolate (D3): pale base darkening delta is negative, so it does not demote below its white look here.
assert.equal(T.bandCombo(base, named, { D: 3, S: false }), T.REC, 'named pair holds on near-black');
ok('client scoring: baseLook, white baseline, freckle, near-black');

// runRisk and deco sanity.
const mover = T.enrich({ code: 'PC-30', name: 'm', mv: 3, brk: 'Strong', color: 'IRON', cls: 'ST', fs: 'OK', roles: ['high-mover'] });
assert.equal(T.runRisk(base, mover), true, 'high-mover top is a run risk');
const crawl = T.enrich({ code: 'CW-1', name: 'c', mv: 2, brk: 'None', color: 'NEUTRAL', cls: 'OS', fs: 'OK', roles: ['crawl'] });
assert.equal(T.deco(base, crawl, false), true, 'crawl top over non-celadon is decorative');
ok('client scoring: runRisk and deco');

// Single-glaze demotion on a near-black body (sign settled with the owner).
const tpSingle = T.enrich({ code: 'C-21', name: 's', mv: 1, brk: 'None', color: 'NEUTRAL', cls: 'TP', fs: 'OK', roles: [] });
const tcSingle = T.enrich({ code: 'C-47', name: 's', mv: 1, brk: 'None', color: 'NEUTRAL', cls: 'TC', fs: 'OK', roles: [] });
assert.equal(T.bandSingle(tpSingle, { D: 0, S: false }), T.REC, 'TP single on white is Recommended');
assert.equal(T.bandSingle(tpSingle, { D: 3, S: false }), T.SKIP, 'TP single on near-black demotes to Skip');
assert.equal(T.bandSingle(tcSingle, { D: 3, S: false }), T.WORTH, 'TC single on near-black demotes to Worth a test');
ok('client scoring: single-glaze near-black demotion');

// --- 4. Clay selector (full render with a richer DOM stub) -------------------
function richStub() {
  const created = [];
  function makeEl(tag) {
    const e = {
      tagName: tag, style: {}, _children: [], _l: {}, className: '', textContent: '', title: '', checked: false, type: '',
      appendChild(c) { this._children.push(c); return c; },
      setAttribute() {}, getAttribute() { return '0'; },
      addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
      querySelector() { return makeEl('div'); },
      classList: { contains() { return false; }, add() {} }
    };
    let h = '';
    Object.defineProperty(e, 'innerHTML', {
      get() { return h; },
      set(v) { h = v; if (v === '') this._children.length = 0; }
    });
    created.push(e);
    return e;
  }
  const document = { getElementById: () => makeEl('div'), createElement: makeEl, createTextNode: () => makeEl('text') };
  return { created, document };
}
function dispatch(el, type) { (el._l[type] || []).forEach((fn) => fn({ target: el })); }
function bandCount(cell) { return cell._children.filter((c) => c.className === 'gm-band').length; }

const stub = richStub();
const fixtureData = {
  glazes: [
    { id: 'a', code: 'C-21', name: 'June', brand: 'X', mv: 1, brk: 'None', color: 'NEUTRAL', cls: 'PO', fs: 'OK', roles: ['base-friendly'] },
    { id: 'b', code: 'CR-12', name: 'Sky', brand: 'X', mv: 2, brk: 'Subtle', color: 'COBALT', cls: 'OS', fs: 'OK', roles: [] }
  ],
  clays: [
    { id: 'w', name: 'New Mexico Clay - WH8 Stoneware', D: 0, S: false },
    { id: 'c', name: 'New Mexico Clay - Chocolate', D: 3, S: false }
  ],
  finished: [],
  generatedAt: null
};
const sb2 = { window: { __GMDATA__: fixtureData }, document: stub.document, console };
vm.createContext(sb2);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sb2);

const cells = stub.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-cell') === 0);
const inputs = stub.created.filter((e) => e.type === 'checkbox');
assert.equal(cells.length, 4, 'two glazes give a 2x2 matrix');
assert.ok(inputs.length >= 3, 'two clay checkboxes plus the progress toggle');
assert.equal(bandCount(cells[0]), 2, 'both clays selected: two bands per cell');

// Deselect the second clay (Chocolate); the first two checkboxes are the clays.
inputs[1].checked = false;
dispatch(inputs[1], 'change');
assert.equal(bandCount(cells[0]), 1, 'one clay deselected: one band per cell');

// Deselecting the last remaining clay is refused (at least one stays).
inputs[0].checked = false;
dispatch(inputs[0], 'change');
assert.equal(inputs[0].checked, true, 'last clay cannot be deselected');
assert.equal(bandCount(cells[0]), 1, 'still one band after the refused toggle');

// Reselect Chocolate: back to two bands.
inputs[1].checked = true;
dispatch(inputs[1], 'change');
assert.equal(bandCount(cells[0]), 2, 'reselecting restores two bands');
ok('clay selector: band division follows selection, last clay protected');

console.log('\nAll ' + passed + ' checks passed.');
