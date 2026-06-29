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
const { shapeGlazes, shapeClays, shapeFinished, shapeComboIndex, shapePieces, extractCode, pagePhotos } = api._internals;

function titleProp(text) { return { type: 'title', title: [{ plain_text: text }] }; }
function sel(name) { return { type: 'select', select: name == null ? null : { name } }; }
function rich(text) { return { type: 'rich_text', rich_text: text == null ? [] : [{ plain_text: text }] }; }
function multi(names) { return { type: 'multi_select', multi_select: names.map((n) => ({ name: n })) }; }
function check(v) { return { type: 'checkbox', checkbox: v }; }
function rel(ids) { return { type: 'relation', relation: ids.map((id) => ({ id })) }; }
function files(entries) { return { type: 'files', files: entries }; }
function ifile(url) { return { type: 'file', file: { url } }; }
function efile(url) { return { type: 'external', external: { url } }; }

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
  { id: 'wh8id', properties: { Name: titleProp('New Mexico Clay - WH8 Stoneware'), Tone: sel('White'), Speckled: check(false), Notes: rich('Bright white, easy to throw.') } },
  { id: 'ermid', properties: { Name: titleProp('New Mexico Clay - Ermine'), Tone: sel('White'), Speckled: check(true) } },
  { id: 'choid', properties: { Name: titleProp('New Mexico Clay - Chocolate'), Tone: sel('Near-black'), Speckled: check(false) } },
  { id: 'notone', properties: { Name: titleProp('New Mexico Clay - Mystery'), Tone: sel(null) } }
];
const { clays, clayById } = shapeClays(clayPages);
assert.equal(clays.length, 3, 'three classified clays, no-Tone excluded');
assert.deepEqual(clays.map((c) => c.name), ['New Mexico Clay - WH8 Stoneware', 'New Mexico Clay - Ermine', 'New Mexico Clay - Chocolate'], 'ordered D asc, S asc, name');
assert.equal(clays[0].D, 0);
assert.equal(clays[2].D, 3);
assert.equal(clays[0].notes, 'Bright white, easy to throw.', 'Notes text is parsed onto the clay');
assert.equal(clays[1].notes, '', 'a clay with no Notes gets an empty string');
ok('shapeClays: parse, exclude, order, notes');

const tilePages = [
  {
    id: 't1', // Finished single: Base relation only, no Top.
    properties: {
      Status: sel('Finished'),
      'Base Glaze': rel(['pc10id']),
      'Top Glaze': rel([]),
      Clay: rel(['wh8id']),
      Photo: files([
        ifile('https://files.example.com/tile-a.jpg?sig=1'),
        efile('https://example.com/tile-b.png'),
        ifile('https://files.example.com/notes.pdf?sig=2')
      ])
    }
  },
  {
    id: 't2', // Finished layered: Base + Top relations.
    properties: {
      Status: sel('Finished'),
      'Base Glaze': rel(['pc10id']),
      'Top Glaze': rel(['pc12id']),
      Clay: rel(['wh8id'])
    }
  },
  {
    id: 't3', // To-Do: excluded from finished, but still indexed as a combo.
    properties: { Status: sel('To-Do'), 'Base Glaze': rel(['pc10id']), Clay: rel(['wh8id']) }
  },
  {
    id: 't4', // Finished but no Base relation: dropped (relations are required).
    properties: { Status: sel('Finished'), 'Base Glaze': rel([]), Clay: rel(['wh8id']) }
  }
];
const finished = shapeFinished(tilePages, glazeById, clayById);
assert.equal(finished.length, 2, 'only Finished rows with a resolvable Base Glaze relation');
const single = finished.find((f) => f.top === null);
assert.ok(single && single.base === 'PC-10' && single.clay === 'New Mexico Clay - WH8 Stoneware', 'single resolved via Base relation');
const combo = finished.find((f) => f.top === 'PC-12');
assert.ok(combo && combo.base === 'PC-10', 'combo resolved via Base/Top relations');
ok('shapeFinished: status filter, relation-only resolution, missing-relation row dropped');

// Photo auto-detection keeps image urls and drops non-images.
assert.deepEqual(single.photos, ['https://files.example.com/tile-a.jpg?sig=1', 'https://example.com/tile-b.png'], 'image photos kept, pdf dropped');
assert.deepEqual(combo.photos, [], 'tile with no Files property has no photos');
assert.deepEqual(
  pagePhotos({ properties: { Shots: files([ifile('a.JPG'), ifile('b.txt'), efile('https://x/c.webp')]) } }),
  ['a.JPG', 'https://x/c.webp'],
  'pagePhotos: case-insensitive image filter across Files properties'
);
ok('pagePhotos: image filtering');

// Throws → finished pieces. The combo index covers every combo row (any status),
// so a throw can resolve to a cell even when no tile was ever finished.
const comboById = shapeComboIndex(tilePages, glazeById);
assert.deepEqual(comboById['t2'], { base: 'PC-10', top: 'PC-12' }, 'combo index resolves a layered row');
assert.deepEqual(comboById['t3'], { base: 'PC-10', top: null }, 'combo index covers a To-Do (untiled) row');

const throwPages = [
  {
    id: 'th1', // Finished, resolves to the PC-10 → PC-12 combo on Chocolate
    properties: {
      Status: sel('Finished'),
      'Glaze Combos': rel(['t2']),
      Clay: rel(['choid']),
      Photos: files([ifile('https://f/early.jpg'), ifile('https://f/final.jpg?sig=9'), ifile('https://f/notes.pdf')])
    }
  },
  { id: 'th2', properties: { Status: sel('Wet'), 'Glaze Combos': rel(['t2']), Clay: rel(['choid']), Photos: files([ifile('https://f/x.jpg')]) } },
  { id: 'th3', properties: { Status: sel('Fired'), 'Glaze Combos': rel(['t2']), Clay: rel(['choid']), Photos: files([ifile('https://f/notes.pdf')]) } },
  { id: 'th4', properties: { Status: sel('Finished'), 'Glaze Combos': rel(['nope']), Clay: rel(['choid']), Photos: files([ifile('https://f/y.jpg')]) } },
  { id: 'th5', properties: { Status: sel('Fired'), 'Glaze Combos': rel(['t2']), Clay: rel([]), Photos: files([ifile('https://f/z.jpg')]) } }
];
const pieces = shapePieces(throwPages, comboById, clayById);
assert.equal(pieces.length, 1, 'only a Finished/Fired throw with a known combo, a clay, and an image counts');
assert.deepEqual(pieces[0], { base: 'PC-10', top: 'PC-12', clay: 'New Mexico Clay - Chocolate', photo: 'https://f/final.jpg?sig=9' }, 'latest image wins, pdf ignored');
ok('shapePieces: status/combo/clay/photo gating, latest-image pick');

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
      tagName: tag, style: {}, _children: [], _l: {}, _a: {}, parentNode: null,
      className: '', textContent: '', title: '', checked: false, type: '',
      appendChild(c) { c.parentNode = this; this._children.push(c); return c; },
      setAttribute(k, v) { this._a[k] = v; },
      getAttribute(k) { return k in this._a ? this._a[k] : null; },
      addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
      querySelector() { return makeEl('div'); }
    };
    e.classList = {
      contains(c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; },
      add(c) { if (!this.contains(c)) e.className = e.className ? e.className + ' ' + c : c; },
      remove(c) { e.className = (' ' + e.className + ' ').split(' ' + c + ' ').join(' ').trim(); }
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
function dispatch(el, type, evt) { (el._l[type] || []).forEach((fn) => fn(evt || { target: el })); }
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

// --- 5. Click-to-pin ---------------------------------------------------------
const stub2 = richStub();
const sb3 = { window: { __GMDATA__: fixtureData }, document: stub2.document, console };
vm.createContext(sb3);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sb3);

const grid = stub2.created.find((e) => e.className === 'gm-grid');
const detail = stub2.created.find((e) => e.className === 'gm-detail');
const pinCells = stub2.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-cell') === 0);
const singleCell = pinCells[0]; // (0,0): single C-21, title has no arrow
const comboCell = pinCells[1];  // (0,1): C-21 over CR-12, title has an arrow
assert.equal(detail.style.display, 'none', 'panel hidden until first interaction');

// Hover preview while nothing is pinned.
dispatch(grid, 'mouseover', { target: comboCell });
assert.equal(detail.style.display, 'block', 'hover shows the panel');
assert.ok(detail.innerHTML.indexOf('→') >= 0, 'hover shows the hovered combo');

// Click to pin the combo cell.
dispatch(grid, 'click', { target: comboCell });
assert.ok(comboCell.classList.contains('gm-pinned'), 'clicked cell is pinned');

// Hovering elsewhere does not change the pinned panel.
dispatch(grid, 'mouseover', { target: singleCell });
assert.ok(detail.innerHTML.indexOf('→') >= 0, 'pinned panel ignores hover');

// Click the pinned cell again to unpin.
dispatch(grid, 'click', { target: comboCell });
assert.ok(!comboCell.classList.contains('gm-pinned'), 'second click unpins');

// Hover preview is restored after unpinning.
dispatch(grid, 'mouseover', { target: singleCell });
assert.ok(detail.innerHTML.indexOf('→') < 0, 'hover updates again after unpin');
ok('click-to-pin: pin holds the panel, second click and hover restore behaviour');

// --- 6. Finished-tile photos in the detail panel -----------------------------
const stub3 = richStub();
const photoData = {
  glazes: fixtureData.glazes,
  clays: fixtureData.clays,
  finished: [{ base: 'C-21', top: null, clay: 'New Mexico Clay - WH8 Stoneware', photos: ['https://files.example.com/tile-a.jpg?sig=1'] }],
  generatedAt: null
};
const sb4 = { window: { __GMDATA__: photoData }, document: stub3.document, console };
vm.createContext(sb4);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sb4);

const grid3 = stub3.created.find((e) => e.className === 'gm-grid');
const detail3 = stub3.created.find((e) => e.className === 'gm-detail');
const cells3 = stub3.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-cell') === 0);
const finishedSingle = cells3[0]; // (0,0): C-21 single on WH8, finished with a photo
const plainCombo = cells3[1];     // (0,1): not finished

dispatch(grid3, 'mouseover', { target: finishedSingle });
assert.ok(detail3.innerHTML.indexOf('<img') >= 0, 'finished cell shows a tile photo');
assert.ok(detail3.innerHTML.indexOf('tile-a.jpg') >= 0, 'photo points at the tile url');
assert.ok(detail3.innerHTML.indexOf('Finished tiles') >= 0, 'photo section is labelled');

dispatch(grid3, 'mouseover', { target: plainCombo });
assert.ok(detail3.innerHTML.indexOf('<img') < 0, 'cell with no finished tile shows no photo');
ok('detail photos: shown only for finished cells');

// --- 7. Finished-piece (thrown) photos and the grey band ---------------------
const stub4 = richStub();
const pieceData = {
  glazes: fixtureData.glazes,
  clays: fixtureData.clays,
  finished: [],
  // C-21 → CR-12 on WH8 has a thrown piece but no finished tile.
  pieces: [{ base: 'C-21', top: 'CR-12', clay: 'New Mexico Clay - WH8 Stoneware', photo: 'https://f/piece-x.jpg' }],
  generatedAt: null
};
const sb5 = { window: { __GMDATA__: pieceData }, document: stub4.document, console };
vm.createContext(sb5);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sb5);

const grid4 = stub4.created.find((e) => e.className === 'gm-grid');
const detail4 = stub4.created.find((e) => e.className === 'gm-detail');
const cells4 = stub4.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-cell') === 0);
const pieceCombo = cells4[1]; // (0,1): C-21 over CR-12; WH8 band is the piece
const wh8Band = pieceCombo._children.filter((c) => c.className === 'gm-band')[0];
assert.equal(wh8Band.style.background, '#5b554c', 'piece band uses the grey, not the rating colour');

dispatch(grid4, 'mouseover', { target: pieceCombo });
assert.ok(detail4.innerHTML.indexOf('Finished pieces') >= 0, 'detail panel has a Finished pieces section');
assert.ok(detail4.innerHTML.indexOf('piece-x.jpg') >= 0, 'piece photo is shown');
assert.ok(detail4.innerHTML.indexOf('(finished piece)') >= 0, 'clay row notes the finished piece');
ok('finished pieces: grey band, piece gallery, clay-row label');

// A finished tile for the same combo+clay outranks the piece (black, no grey).
const stub5 = richStub();
const bothData = {
  glazes: fixtureData.glazes,
  clays: fixtureData.clays,
  finished: [{ base: 'C-21', top: 'CR-12', clay: 'New Mexico Clay - WH8 Stoneware', photos: ['https://f/tile.jpg'] }],
  pieces: [{ base: 'C-21', top: 'CR-12', clay: 'New Mexico Clay - WH8 Stoneware', photo: 'https://f/piece-x.jpg' }],
  generatedAt: null
};
const sb6 = { window: { __GMDATA__: bothData }, document: stub5.document, console };
vm.createContext(sb6);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sb6);
const cells5 = stub5.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-cell') === 0);
const bothBand = cells5[1]._children.filter((c) => c.className === 'gm-band')[0];
assert.equal(bothBand.style.background, '#17130d', 'a finished tile outranks a piece (stays black)');
ok('precedence: finished tile beats finished piece');

// --- 8. Clay description popup ------------------------------------------------
const stub6 = richStub();
const clayNoteData = {
  glazes: fixtureData.glazes,
  clays: [
    { id: 'w', name: 'New Mexico Clay - WH8 Stoneware', D: 0, S: false, notes: 'Bright white and forgiving.' },
    { id: 'c', name: 'New Mexico Clay - Chocolate', D: 3, S: false, notes: 'Dark, makes glazes pop.' }
  ],
  finished: [],
  generatedAt: null
};
const sb7 = { window: { __GMDATA__: clayNoteData }, document: stub6.document, console };
vm.createContext(sb7);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sb7);

const grid5 = stub6.created.find((e) => e.className === 'gm-grid');
const detail5 = stub6.created.find((e) => e.className === 'gm-detail');
const clayNames = stub6.created.filter((e) => e.className === 'gm-clayname');
assert.equal(clayNames.length, 2, 'each clay has a clickable name button');

// Clicking a clay name shows its description in the bottom-right panel.
dispatch(clayNames[1], 'click');
assert.equal(detail5.style.display, 'block', 'clay name opens the popup');
assert.ok(detail5.innerHTML.indexOf('Dark, makes glazes pop.') >= 0, 'popup shows the clay note');
assert.ok(detail5.innerHTML.indexOf('Near-black body') >= 0, 'popup shows the tone subtitle');

// While the clay popup is open, hovering a cell does not replace it.
const cells6 = stub6.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-cell') === 0);
dispatch(grid5, 'mouseover', { target: cells6[1] });
assert.ok(detail5.innerHTML.indexOf('Dark, makes glazes pop.') >= 0, 'clay popup holds against hover');

// Clicking a cell takes over the panel (the clay popup yields).
dispatch(grid5, 'click', { target: cells6[1] });
assert.ok(detail5.innerHTML.indexOf('Dark, makes glazes pop.') < 0, 'clicking a cell replaces the clay popup');
ok('clay popup: name opens it, holds against hover, yields to a cell click');

// --- 9. Hover/pin parity for clays and hover-off clearing --------------------
const stub7 = richStub();
const sb8 = { window: { __GMDATA__: clayNoteData }, document: stub7.document, console };
vm.createContext(sb8);
vm.runInContext(readFileSync(join(root, 'public/app.js'), 'utf8'), sb8);

const grid7 = stub7.created.find((e) => e.className === 'gm-grid');
const detail7 = stub7.created.find((e) => e.className === 'gm-detail');
const clayPicker7 = stub7.created.find((e) => e.className === 'gm-clays');
const clayNames7 = stub7.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-clayname') === 0);
const cells7 = stub7.created.filter((e) => typeof e.className === 'string' && e.className.indexOf('gm-cell') === 0);

// Hovering a clay name previews it without pinning (name not yet bold).
dispatch(clayNames7[0], 'mouseover');
assert.equal(detail7.style.display, 'block', 'hovering a clay name previews it');
assert.ok(detail7.innerHTML.indexOf('Bright white and forgiving.') >= 0, 'preview shows the hovered clay note');
assert.ok(!clayNames7[0].classList.contains('gm-clayname-on'), 'an unpinned (hovered) clay name is not marked');

// Leaving the clay row clears the unpinned preview.
dispatch(clayPicker7, 'mouseleave');
assert.equal(detail7.style.display, 'none', 'leaving the clay row clears an unpinned clay preview');

// Clicking selects (pins): the name is marked and the popup stays on leave.
dispatch(clayNames7[0], 'click');
assert.ok(clayNames7[0].classList.contains('gm-clayname-on'), 'a selected clay name is marked');
dispatch(clayPicker7, 'mouseleave');
assert.equal(detail7.style.display, 'block', 'a selected clay popup stays after leaving the row');

// Clicking the selected clay again unselects it.
dispatch(clayNames7[0], 'click');
assert.ok(!clayNames7[0].classList.contains('gm-clayname-on'), 'clicking the selected clay again unselects it');
dispatch(clayPicker7, 'mouseleave'); // back to a clean, empty panel

// Matrix hover-off: an unpinned combo preview clears on leaving the grid.
dispatch(grid7, 'mouseover', { target: cells7[1] });
assert.equal(detail7.style.display, 'block', 'hovering a cell previews it');
dispatch(grid7, 'mouseleave');
assert.equal(detail7.style.display, 'none', 'leaving the matrix clears an unpinned combo preview');

// A selected combo stays on the screen after leaving the matrix.
dispatch(grid7, 'click', { target: cells7[1] });
dispatch(grid7, 'mouseleave');
assert.equal(detail7.style.display, 'block', 'a selected combo stays after leaving the matrix');
ok('hover/pin parity: clay preview+marked pin, hover-off clears unpinned previews');

console.log('\nAll ' + passed + ' checks passed.');
