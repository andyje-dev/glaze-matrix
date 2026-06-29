// Vercel serverless function.
// Fetches the Notion databases (glazes, clays, glaze combos, throws) server-side,
// shapes them into a compact object, and returns an HTML page with that object
// injected as window.__GMDATA__. The Notion token never reaches the client.

const NOTION_VERSION = '2022-06-28';

const GLAZES_DB_ID = process.env.GLAZES_DB_ID || '34b7d0e43ed2804c8552debe7c49b859';
const CLAYS_DB_ID = process.env.CLAYS_DB_ID || '34b7d0e43ed2805fa511fff16d5b0af0';
// TILES_DB_ID points at the "Glaze Combos" database. Rows there are combos; a
// row with Status=Finished is a finished test tile.
const TILES_DB_ID = process.env.TILES_DB_ID || 'e13b547dd5ab4319a6f528c837401d29';
// Thrown pieces. A throw can name the combo it used (Glaze Combos relation) and
// carry finished-piece photos, so combos with a piece but no tile still appear.
const THROWS_DB_ID = process.env.THROWS_DB_ID || '34b7d0e43ed280048dd0e89baff8626d';

// --- Notion property parsing -------------------------------------------------

function plainFromRich(arr) {
  return (arr || []).map(function (t) { return t.plain_text; }).join('');
}
function titleText(page) {
  for (const k in page.properties) {
    const p = page.properties[k];
    if (p && p.type === 'title') return plainFromRich(p.title);
  }
  return '';
}
function prop(page, name) { return page.properties ? page.properties[name] : undefined; }
function richText(p) { return p && p.rich_text ? plainFromRich(p.rich_text) : ''; }
function selName(p) { return p && p.select ? p.select.name : null; }
function multiNames(p) { return p && p.multi_select ? p.multi_select.map(function (s) { return s.name; }) : []; }
function checkbox(p) { return !!(p && p.checkbox); }
function relIds(p) { return p && p.relation ? p.relation.map(function (r) { return String(r.id).replace(/-/g, ''); }) : []; }

// A single files-property entry can be a Notion-hosted file (signed url that
// expires about an hour after this fetch, which is fine for a fresh load) or an
// external url.
function fileUrl(f) {
  if (!f) return null;
  if (f.type === 'external' && f.external) return f.external.url;
  if (f.type === 'file' && f.file) return f.file.url;
  return null;
}
function isImageUrl(u) {
  if (!u) return false;
  var path = u.split('?')[0].toLowerCase();
  return /\.(jpe?g|png|webp|gif|heic|heif|avif)$/.test(path);
}

// HEIC/HEIF (straight-from-iPhone uploads) can't render inline in any non-Safari
// browser: the <img> breaks and only its download link shows. Route those through
// /api/img, which fetches the original and transcodes to JPEG. Notion serves
// presigned S3 urls, so this has to be our own function — third-party proxies
// mangle the signature query params. Already-web-safe formats pass through.
function webImageUrl(u) {
  if (!u) return u;
  var path = u.split('?')[0].toLowerCase();
  if (/\.(heic|heif)$/.test(path)) return '/api/img?u=' + encodeURIComponent(u);
  return u;
}

// Photo urls for a test-tile page. With TILES_PHOTO_PROP set, read only that
// Files property (and trust every file in it); otherwise auto-detect across all
// Files properties and keep image-looking urls.
var PHOTO_PROP = process.env.TILES_PHOTO_PROP || null;
function pagePhotos(page) {
  var urls = [];
  var props = page.properties || {};
  function collect(p, trustAll) {
    if (!p || p.type !== 'files' || !Array.isArray(p.files)) return;
    p.files.forEach(function (f) {
      var u = fileUrl(f);
      if (u && (trustAll || isImageUrl(u))) urls.push(webImageUrl(u));
    });
  }
  if (PHOTO_PROP) {
    collect(props[PHOTO_PROP], true);
  } else {
    for (var k in props) collect(props[k], false);
  }
  return urls;
}

// Image urls from one named Files property, in upload order.
function propImages(page, propName) {
  var p = prop(page, propName);
  if (!p || p.type !== 'files' || !Array.isArray(p.files)) return [];
  var urls = [];
  p.files.forEach(function (f) {
    var u = fileUrl(f);
    if (u && isImageUrl(u)) urls.push(webImageUrl(u));
  });
  return urls;
}

// --- Mapping tables ----------------------------------------------------------

const MV = { Low: 1, Medium: 2, High: 3 };
const CLS = {
  'Transparent-pale': 'TP',
  'Transparent-colour': 'TC',
  'Semi-translucent': 'ST',
  'Iron-rich': 'IR',
  'Opaque-saturated': 'OS',
  'Pale-opaque': 'PO'
};
const FS = { Functional: 'OK', Decorative: 'DECO', 'Over-celadon-only': 'COND' };
const TONE = { White: 0, Buff: 1, Brown: 2, 'Near-black': 3 };

const CODE_RE = /[A-Z]{1,3}-\d{1,3}/;

function extractCode(text) {
  const m = (text || '').match(CODE_RE);
  return m ? m[0] : null;
}

// --- Notion fetch ------------------------------------------------------------

async function queryDatabase(token, databaseId) {
  const out = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch('https://api.notion.com/v1/databases/' + databaseId + '/query', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const detail = await res.text().catch(function () { return ''; });
      throw new Error('Notion query failed for ' + databaseId + ' (HTTP ' + res.status + '). ' + detail.slice(0, 300));
    }
    const json = await res.json();
    for (const r of json.results) out.push(r);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return out;
}

// --- Shaping -----------------------------------------------------------------

function shapeGlazes(pages) {
  // glazeById maps a dashless page id to a code, for every glaze page (even
  // unclassified ones) so test-tile relations always resolve. The matrix list
  // only includes classified glazes (those with a Clay Class).
  const glazeById = {};
  const glazes = [];
  for (const page of pages) {
    const title = titleText(page);
    const code = extractCode(title);
    const idKey = String(page.id).replace(/-/g, '');
    if (code) glazeById[idKey] = code;

    const cls = CLS[selName(prop(page, 'Clay Class'))];
    if (!cls) continue; // exclude unrelated studio glazes (no Clay Class)
    if (!code) continue;

    let brand = '';
    let name = title;
    const dash = title.indexOf(' - ');
    if (dash >= 0) brand = title.slice(0, dash);
    const codeAt = title.indexOf(code);
    if (codeAt >= 0) name = title.slice(codeAt + code.length).trim();

    glazes.push({
      id: idKey,
      code: code,
      name: name,
      brand: brand,
      mv: MV[selName(prop(page, 'Movement'))] || 1,
      brk: selName(prop(page, 'Breaks over Texture')) || 'None',
      color: selName(prop(page, 'Color Family')) || 'NEUTRAL',
      cls: cls,
      fs: FS[selName(prop(page, 'Food Use'))] || 'OK',
      roles: multiNames(prop(page, 'Layering Role'))
    });
  }
  return { glazes: glazes, glazeById: glazeById };
}

function shapeClays(pages) {
  const clayById = {};
  const clays = [];
  for (const page of pages) {
    const name = titleText(page);
    const idKey = String(page.id).replace(/-/g, '');
    clayById[idKey] = name;
    const tone = selName(prop(page, 'Tone'));
    if (tone == null || !(tone in TONE)) continue; // exclude clays with no Tone
    clays.push({
      id: idKey,
      name: name,
      D: TONE[tone],
      S: checkbox(prop(page, 'Speckled')),
      notes: richText(prop(page, 'Notes'))
    });
  }
  // Order by D ascending, then S ascending, then name.
  clays.sort(function (a, b) {
    if (a.D !== b.D) return a.D - b.D;
    if (a.S !== b.S) return (a.S ? 1 : 0) - (b.S ? 1 : 0);
    return a.name.localeCompare(b.name);
  });
  return { clays: clays, clayById: clayById };
}

// Resolve one glaze relation (Base Glaze / Top Glaze) to a glaze code.
function relGlaze(page, relName, glazeById) {
  for (const id of relIds(prop(page, relName))) {
    if (glazeById[id]) return glazeById[id];
  }
  return null;
}

// Resolve a Glaze Combos row to its {base, top} glaze codes (top null = single).
// Base/Top relations are the single source of truth; every combo row carries them.
function resolveComboGlazes(page, glazeById) {
  const base = relGlaze(page, 'Base Glaze', glazeById);
  if (!base) return null;
  return { base: base, top: relGlaze(page, 'Top Glaze', glazeById) || null };
}

// Map every Glaze Combos row (dashless page id) to its {base, top} codes, so a
// throw's Glaze Combos relation can be resolved to a matrix cell.
function shapeComboIndex(pages, glazeById) {
  const comboById = {};
  for (const page of pages) {
    const combo = resolveComboGlazes(page, glazeById);
    if (combo) comboById[String(page.id).replace(/-/g, '')] = combo;
  }
  return comboById;
}

function clayName(page, clayById) {
  const clayIds = relIds(prop(page, 'Clay'));
  for (const id of clayIds) { if (clayById[id]) return clayById[id]; }
  return null;
}

function shapeFinished(pages, glazeById, clayById) {
  const finished = [];
  for (const page of pages) {
    const status = selName(prop(page, 'Status'));
    if (status !== 'Finished') continue;

    const combo = resolveComboGlazes(page, glazeById);
    if (!combo) continue;

    finished.push({
      base: combo.base,
      top: combo.top,
      clay: clayName(page, clayById),
      photos: pagePhotos(page)
    });
  }
  return finished;
}

// A thrown piece counts when it is at least fired (so it has been glazed),
// names the combo it used, and has a photo of the result. The latest image in
// the throw's Photos is the finished, glazed piece.
const PIECE_PROP = process.env.THROWS_PHOTO_PROP || 'Photos';
const PIECE_STATUSES = { Finished: true, Fired: true };

function shapePieces(pages, comboById, clayById) {
  const pieces = [];
  for (const page of pages) {
    if (!PIECE_STATUSES[selName(prop(page, 'Status'))]) continue;

    const comboIds = relIds(prop(page, 'Glaze Combos'));
    let combo = null;
    for (const id of comboIds) { if (comboById[id]) { combo = comboById[id]; break; } }
    if (!combo) continue;

    const clay = clayName(page, clayById);
    if (!clay) continue;

    const images = propImages(page, PIECE_PROP);
    if (!images.length) continue;

    pieces.push({ base: combo.base, top: combo.top, clay: clay, photo: images[images.length - 1] });
  }
  return pieces;
}

// --- HTML --------------------------------------------------------------------

function escapeForScript(json) {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function page(data) {
  const payload = escapeForScript(JSON.stringify(data));
  return '<!doctype html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>Glaze Layering Matrix</title>\n' +
    '<link rel="stylesheet" href="/style.css">\n' +
    '</head>\n' +
    '<body>\n' +
    '<div id="app"></div>\n' +
    '<script>window.__GMDATA__ = ' + payload + ';</script>\n' +
    '<script src="/app.js"></script>\n' +
    '</body>\n</html>';
}

function errorPage(message) {
  return '<!doctype html>\n' +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Glaze Matrix</title><link rel="stylesheet" href="/style.css"></head>' +
    '<body><div class="errorbox"><h1>The matrix could not load</h1>' +
    '<p>' + String(message).replace(/</g, '&lt;') + '</p>' +
    '<p>Check that NOTION_TOKEN is set on the server and that the integration has ' +
    'been added to the Glazes, Clays, Glaze Combos, and Throws databases under Connections.</p>' +
    '</div></body></html>';
}

// --- Handler -----------------------------------------------------------------

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    res.statusCode = 500;
    res.end(errorPage('The NOTION_TOKEN environment variable is not set.'));
    return;
  }

  try {
    const [glazePages, clayPages, tilePages, throwPages] = await Promise.all([
      queryDatabase(token, GLAZES_DB_ID),
      queryDatabase(token, CLAYS_DB_ID),
      queryDatabase(token, TILES_DB_ID),
      queryDatabase(token, THROWS_DB_ID)
    ]);

    const g = shapeGlazes(glazePages);
    const c = shapeClays(clayPages);
    const finished = shapeFinished(tilePages, g.glazeById, c.clayById);
    const comboById = shapeComboIndex(tilePages, g.glazeById);
    const pieces = shapePieces(throwPages, comboById, c.clayById);

    const data = {
      glazes: g.glazes,
      clays: c.clays,
      finished: finished,
      pieces: pieces,
      generatedAt: new Date().toISOString()
    };

    res.statusCode = 200;
    res.end(page(data));
  } catch (err) {
    res.statusCode = 502;
    res.end(errorPage(err && err.message ? err.message : 'Unknown error querying Notion.'));
  }
};

// Exported for the offline self-test.
module.exports._internals = {
  shapeGlazes: shapeGlazes,
  shapeClays: shapeClays,
  shapeFinished: shapeFinished,
  shapeComboIndex: shapeComboIndex,
  shapePieces: shapePieces,
  extractCode: extractCode,
  pagePhotos: pagePhotos,
  webImageUrl: webImageUrl
};
