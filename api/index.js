// Vercel serverless function.
// Fetches the three Notion databases server-side, shapes them into a compact
// object, and returns an HTML page with that object injected as
// window.__GMDATA__. The Notion token never reaches the client.

const NOTION_VERSION = '2022-06-28';

const GLAZES_DB_ID = process.env.GLAZES_DB_ID || '34b7d0e43ed2804c8552debe7c49b859';
const CLAYS_DB_ID = process.env.CLAYS_DB_ID || '34b7d0e43ed2805fa511fff16d5b0af0';
const TILES_DB_ID = process.env.TILES_DB_ID || 'e13b547dd5ab4319a6f528c837401d29';

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
function selName(p) { return p && p.select ? p.select.name : null; }
function multiNames(p) { return p && p.multi_select ? p.multi_select.map(function (s) { return s.name; }) : []; }
function checkbox(p) { return !!(p && p.checkbox); }
function relIds(p) { return p && p.relation ? p.relation.map(function (r) { return String(r.id).replace(/-/g, ''); }) : []; }
function richText(p) { return p && p.rich_text ? plainFromRich(p.rich_text) : ''; }

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
      S: checkbox(prop(page, 'Speckled'))
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

function resolveTileGlaze(page, relName, glazeById, layersKey, namePart) {
  // 1) relation, 2) Layers text, 3) Name.
  const ids = relIds(prop(page, relName));
  for (const id of ids) {
    if (glazeById[id]) return glazeById[id];
  }
  const layers = richText(prop(page, 'Layers'));
  if (layers) {
    const re = new RegExp(layersKey + '\\s*\\(\\s*([A-Z]{1,3}-\\d{1,3})');
    const m = layers.match(re);
    if (m) return m[1];
  }
  if (namePart != null) {
    const name = richTextOrTitle(page, 'Name');
    if (name) {
      const parts = name.split('→'); // arrow
      const piece = parts[namePart];
      if (piece !== undefined) return extractCode(piece);
    }
  }
  return null;
}

function richTextOrTitle(page, name) {
  const p = prop(page, name);
  if (p && p.type === 'rich_text') return richText(p);
  if (p && p.type === 'title') return plainFromRich(p.title);
  return '';
}

function shapeFinished(pages, glazeById, clayById) {
  const finished = [];
  for (const page of pages) {
    const status = selName(prop(page, 'Status'));
    if (status !== 'Finished') continue;

    const base = resolveTileGlaze(page, 'Base Glaze', glazeById, 'Base', 0);
    if (!base) continue;

    // A single-glaze tile has no top. Try Top relation / Layers / second Name part.
    let top = resolveTileGlaze(page, 'Top Glaze', glazeById, 'Top', 1);
    // If the Name has no arrow, namePart 1 returns undefined and top stays null.
    const name = richTextOrTitle(page, 'Name');
    if (top && name && name.indexOf('→') < 0 && relIds(prop(page, 'Top Glaze')).length === 0) {
      // Name is single and no Top relation: treat as single even if Layers had a stray match.
      const layers = richText(prop(page, 'Layers'));
      if (!/Top\s*\(/.test(layers)) top = null;
    }

    const clayIds = relIds(prop(page, 'Clay'));
    let clay = null;
    for (const id of clayIds) { if (clayById[id]) { clay = clayById[id]; break; } }

    finished.push({ base: base, top: top || null, clay: clay });
  }
  return finished;
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
    'been added to the Glazes, Clays, and Test Tiles databases under Connections.</p>' +
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
    const [glazePages, clayPages, tilePages] = await Promise.all([
      queryDatabase(token, GLAZES_DB_ID),
      queryDatabase(token, CLAYS_DB_ID),
      queryDatabase(token, TILES_DB_ID)
    ]);

    const g = shapeGlazes(glazePages);
    const c = shapeClays(clayPages);
    const finished = shapeFinished(tilePages, g.glazeById, c.clayById);

    const data = {
      glazes: g.glazes,
      clays: c.clays,
      finished: finished,
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
  extractCode: extractCode
};
