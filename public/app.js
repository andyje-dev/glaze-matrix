// Client. Runs the scoring algorithm and draws the matrix, legend, progress
// bar, glaze key, and hover/tap detail panel from window.__GMDATA__.
// No secrets here. All user-facing copy avoids em dashes.

(function () {
  'use strict';

  var DATA = window.__GMDATA__ || { glazes: [], clays: [], finished: [], generatedAt: null };

  // --- Rating scale ---------------------------------------------------------
  // Ordered: 0 Recommended, 1 Worth a test, 2 Skip.
  var REC = 0, WORTH = 1, SKIP = 2;
  var RATING_LABEL = ['Recommended', 'Worth a test', 'Skip'];

  function step(r, k) { return Math.max(0, Math.min(2, r + k)); }

  // --- Hand-curated judgment data (edited deliberately with the owner) -------
  var VERYPALE = setOf(['C-21', 'CO-6', 'CO-21', 'PG-54', 'PG-55']);
  var LIGHTCRYSTAL = setOf(['CO-6', 'CO-21']);
  var SHOWS = setOf(['TP', 'TC', 'ST', 'PO']);
  var BD = { TP: -1, TC: -1, ST: 0, IR: 1, OS: 0, PO: -1 };

  var REACT = setOf([
    reactKey('COPPER', 'IRON'),
    reactKey('COBALT', 'IRON'),
    reactKey('COBALT', 'COPPER'),
    reactKey('IRON', 'PINK')
  ]);

  var A_NAMED = setOf(('C-21|CR-12, C-21|PC-12, C-21|PC-14, C-21|PC-56, C-21|PG-54, ' +
    'C-47|CR-12, C-47|PC-14, C-47|PC-56, C-47|PG-54, C-53|CR-12, C-53|PC-17, ' +
    'PC-10|PC-17, PC-25|PC-56, PC-31|PC-12, PC-31|PC-30, PC-31|PC-48, PC-31|PC-56, ' +
    'PC-31|PG-54, PC-31|PG-55, PC-32|PC-25, PC-32|PC-56, PC-40|CR-12, PC-40|PC-12, ' +
    'PC-40|PC-14, PC-40|PG-54, PC-40|PG-55, PC-48|PG-55, PC-59|PC-25').split(/,\s*/));

  var B_NAMED = setOf(('C-53|PC-14, PC-10|PC-14, PC-12|PC-14, PC-25|PC-17, PC-30|PC-14, ' +
    'PC-30|PC-17, PC-30|PG-54, PC-31|PC-14, PC-32|PC-14, PC-32|PC-17, PC-59|PC-14, ' +
    'SW-190|PG-54').split(/,\s*/));

  function setOf(arr) { var s = {}; for (var i = 0; i < arr.length; i++) s[arr[i]] = true; return s; }
  function has(set, key) { return Object.prototype.hasOwnProperty.call(set, key); }
  function reactKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function pairKey(b, t) { return b.code + '|' + t.code; }

  // --- Glaze flags ----------------------------------------------------------
  function enrich(g) {
    var roles = g.roles || [];
    function role(name) { return roles.indexOf(name) >= 0; }
    g.mover = role('high-mover');
    g.flux = role('flux');
    g.crawl = role('crawl');
    g.crystal = role('crystal');
    g.metal = role('metallic');
    g.topper = role('topper-only');
    g.celadon = role('celadon');
    g.phase = role('phase');
    g.hicrystal = g.crystal && g.mv === 3;
    g.translucent = g.cls === 'TP' || g.cls === 'TC';
    g.strong = g.brk === 'Strong';
    return g;
  }

  // --- Scoring --------------------------------------------------------------
  function interest(b, t) {
    var s = 0;
    if (b.strong || t.strong) s += 1;
    if (b.color !== t.color) s += has(REACT, reactKey(b.color, t.color)) ? 2 : 1;
    if (b.translucent || t.translucent) s += 1;
    if (((b.metal ? 1 : 0) + (t.metal ? 1 : 0)) === 1) s += 1;
    if (t.flux) s += 1;
    if (t.phase) s += 1;
    return s;
  }

  function runRisk(b, t) {
    return t.mv === 3 || b.mv === 3 || t.flux || b.crystal || t.crystal || (b.mv + t.mv >= 5);
  }

  function deco(b, t, single) {
    if (single) return b.fs === 'DECO' || b.fs === 'COND';
    if (t.crawl) return !b.celadon;
    if (b.fs === 'DECO' || t.fs === 'DECO') return true;
    if (t.hicrystal && b.mv <= 1) return true;
    if (b.fs === 'COND' || t.fs === 'COND') return true;
    return false;
  }

  function baseLook(b, t) {
    if (b.topper || b.hicrystal || b.crawl) return SKIP;
    if (t.crawl) return b.celadon ? REC : WORTH;
    if (b.metal && t.metal) return SKIP;
    if (b.mv === 3 && t.mv === 3) return SKIP;
    if (t.hicrystal) return b.mv <= 1 ? WORTH : SKIP;
    var k = pairKey(b, t);
    if (has(A_NAMED, k) || has(B_NAMED, k)) return REC;
    return interest(b, t) >= 4 ? REC : WORTH;
  }

  function ddCombo(b, t) {
    var d = BD[b.cls];
    if (t.cls === 'IR') d += 1;
    if ((t.cls === 'TP' || t.cls === 'PO') && has(SHOWS, b.cls)) d -= 1;
    if (b.cls === 'TP' && (t.cls === 'TP' || t.cls === 'PO')) d -= 1;
    if (t.hicrystal && has(LIGHTCRYSTAL, t.code)) d -= 1;
    return Math.max(-3, Math.min(1, d));
  }

  function singleLvl(b) {
    if (b.crawl) return 0;
    switch (b.cls) {
      case 'TP': return -2;
      case 'TC': return -1;
      case 'ST': return 0;
      case 'IR': return 0;
      case 'OS': return 0;
      case 'PO': return has(VERYPALE, b.code) ? -2 : -1;
    }
    return 0;
  }

  function bandCombo(b, t, clay) {
    var bl = baseLook(b, t);
    if (bl === SKIP) return SKIP;
    var ddD = Math.round(ddCombo(b, t) * clay.D / 3);
    var r = step(bl, ddD);
    if (clay.S && has(SHOWS, b.cls)) r = step(r, -1);
    return r;
  }

  function bandSingle(b, clay) {
    // singleLvl is a demotion magnitude (non-positive); demote Recommended
    // toward Skip by that magnitude as the body darkens. (Sign settled with
    // the owner: a pale single on a near-black body should darken to Skip.)
    var slD = Math.round(singleLvl(b) * clay.D / 3);
    var r = step(REC, -slD);
    if (clay.S && has(SHOWS, b.cls)) r = step(r, -1);
    return r;
  }

  // --- Sorting glazes by code ----------------------------------------------
  function codeSort(a, b) {
    var pa = a.code.split('-'), pb = b.code.split('-');
    if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
    return (parseInt(pa[1], 10) || 0) - (parseInt(pb[1], 10) || 0);
  }

  // --- Build model ----------------------------------------------------------
  var glazes = DATA.glazes.map(enrich).slice().sort(codeSort);
  var clays = DATA.clays.slice();

  // Blackout index: key "base|top|clay" for finished tiles (top empty = single).
  var finishedKeys = {};
  (DATA.finished || []).forEach(function (f) {
    finishedKeys[f.base + '|' + (f.top || '') + '|' + (f.clay || '')] = true;
  });
  function isFinished(baseCode, topCode, clayName) {
    return has(finishedKeys, baseCode + '|' + (topCode || '') + '|' + clayName);
  }

  // Precompute every cell. cell = { single, b, t, bands:[{rating,finished}], run, deco }
  var matrix = [];
  for (var i = 0; i < glazes.length; i++) {
    var row = [];
    for (var j = 0; j < glazes.length; j++) {
      var b = glazes[i], t = glazes[j];
      var single = i === j;
      var bands = clays.map(function (clay) {
        var rating = single ? bandSingle(b, clay) : bandCombo(b, t, clay);
        var fin = single
          ? isFinished(b.code, null, clay.name)
          : isFinished(b.code, t.code, clay.name);
        return { rating: rating, finished: fin };
      });
      var allSkip = bands.every(function (x) { return x.rating === SKIP; });
      row.push({
        single: single, b: b, t: t, bands: bands,
        run: allSkip ? false : runRisk(b, t),
        deco: allSkip ? false : deco(b, t, single),
        allSkip: allSkip
      });
    }
    matrix.push(row);
  }

  // --- Text -----------------------------------------------------------------
  function ironInvolved(b, t) {
    return b.cls === 'IR' || (t && t.cls === 'IR') || b.color === 'IRON' || (t && t.color === 'IRON');
  }

  function coatsCombo(b, t) {
    var baseCoats = b.mover ? 2 : 3;
    var topCoats = t.crawl ? '1 to 4' : (t.mover ? 1 : 2);
    return 'Coats: base ' + b.code + ' ' + baseCoats + ', top ' + t.code + ' ' + topCoats + '.';
  }
  function coatsSingle(b) {
    var n = b.crystal ? 4 : (b.mover ? 2 : 3);
    return 'Coats: ' + n + ', built up with a thickness gradient.';
  }

  function recCombo(b, t) {
    var k = pairKey(b, t);
    var line;
    if (b.topper) line = 'Works best on top; buried as a base it runs or muddies.';
    else if (b.hicrystal) line = 'Very fluid crystalline meant to stand alone; sheets off as a base.';
    else if (b.crawl) line = 'Crawls into raised beads; use it as the top over a celadon.';
    else if (t.crawl && b.celadon) line = 'Signature food-safe use; beads up over the celadon, food-safe only over a celadon.';
    else if (t.crawl) line = 'Beads for texture, decorative.';
    else if (b.metal && t.metal) line = 'Two metallics cancel to a muddy matte.';
    else if (b.mv === 3 && t.mv === 3) line = 'Two high movers sheet off together.';
    else if (t.hicrystal && b.mv <= 1) line = 'Pools crystals over the stable base, lovely but very fluid.';
    else if (t.hicrystal) line = 'Too fluid to sit over the moving base.';
    else if (has(A_NAMED, k)) line = 'Top pick: ' + featureList(b, t) + '.';
    else if (has(B_NAMED, k)) line = 'Strong but runs: ' + featureList(b, t) + '.';
    else line = capitalize(featureList(b, t)) + '.';
    return { line: line, coats: coatsCombo(b, t) };
  }

  function featureList(b, t) {
    var f = [];
    if (b.strong || t.strong) f.push('strong break');
    if (b.color !== t.color) f.push(has(REACT, reactKey(b.color, t.color)) ? 'reactive seam' : 'contrast seam');
    if (b.translucent || t.translucent) f.push('translucent veil');
    if (t.phase) f.push('phase float');
    if (((b.metal ? 1 : 0) + (t.metal ? 1 : 0)) === 1) f.push('metallic focal');
    if (!f.length) return 'a simple layering';
    return f.join(', ');
  }

  function recSingle(b) {
    var f = [];
    if (b.crystal) f.push('crystals develop with thickness');
    if (b.mover) f.push('a high mover, keep it off the foot');
    if (b.strong) f.push('breaks strongly over texture');
    if (b.translucent) f.push('a translucent that shows the body');
    if (!f.length) f.push('a steady, even surface');
    var line = 'On its own: ' + f.join(', ') + '.';
    if (b.fs === 'DECO') line += ' Decorative only.';
    if (b.fs === 'COND') line += ' Food-safe only over a celadon.';
    return { line: line, coats: coatsSingle(b) };
  }

  function clayNote(b, t, clay, rating, single) {
    if (clay.D === 0) {
      var s0 = 'reads colour brightest and truest';
      if (clay.S) s0 += ', and freckles up through the glaze for character';
      return s0;
    }
    var s;
    if (rating === SKIP) {
      s = 'the pale or transparent component can go muddy; brush a white slip first';
    } else if (ironInvolved(b, single ? null : t)) {
      s = 'deepens and enriches, the richest of the set';
    } else {
      var baseBand = single ? bandSingle(b, { D: 0, S: false }) : bandCombo(b, t, { D: 0, S: false });
      if (rating > baseBand) s = 'darkens and mutes a touch but still worth a tile';
      else s = 'the opaque layer covers the dark body and holds with deepened rims';
    }
    if (clay.D === 3) s += '; fires with a hold';
    return s;
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // --- Rendering ------------------------------------------------------------
  var COLORS = ['#C0DD97', '#B5D4F4', '#EAE7DF']; // REC, WORTH, SKIP
  var BLACK = '#17130d';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function fmtTime(iso) {
    if (!iso) return 'unknown';
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  var app = document.getElementById('app');

  // Header
  var header = el('header', 'gm-header');
  header.appendChild(el('h1', null, 'Glaze Layering Matrix'));
  header.appendChild(el('p', 'gm-sub', 'Rows are the base glaze, columns the top glaze. The diagonal is single glazes. Each cell shows one band per clay.'));
  header.appendChild(el('p', 'gm-stamp', 'Live from Notion: ' + fmtTime(DATA.generatedAt)));
  app.appendChild(header);

  // Legend
  var legend = el('div', 'gm-legend');
  legend.appendChild(swatch(COLORS[REC], 'Recommended'));
  legend.appendChild(swatch(COLORS[WORTH], 'Worth a test'));
  legend.appendChild(swatch(COLORS[SKIP], 'Skip'));
  legend.appendChild(swatch(BLACK, 'Finished tile'));
  legend.appendChild(tagKey('gm-run', 'Run risk'));
  legend.appendChild(tagKey('gm-deco', 'Decorative only'));
  app.appendChild(legend);

  function swatch(color, label) {
    var w = el('span', 'gm-key');
    var sw = el('span', 'gm-swatch');
    sw.style.background = color;
    w.appendChild(sw);
    w.appendChild(el('span', 'gm-keylabel', label));
    return w;
  }
  function tagKey(cls, label) {
    var w = el('span', 'gm-key');
    w.appendChild(el('span', 'gm-tagicon ' + cls));
    w.appendChild(el('span', 'gm-keylabel', label));
    return w;
  }

  // Progress bar with toggle
  var includeWorth = false;
  var progWrap = el('div', 'gm-progress');
  var progBarOuter = el('div', 'gm-bar-outer');
  var progBarInner = el('div', 'gm-bar-inner');
  progBarOuter.appendChild(progBarInner);
  var progLabel = el('div', 'gm-prog-label');
  var toggleWrap = el('label', 'gm-toggle');
  var toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggleWrap.appendChild(toggle);
  toggleWrap.appendChild(document.createTextNode(' Count Worth a test too'));
  toggle.addEventListener('change', function () { includeWorth = toggle.checked; updateProgress(); });
  progWrap.appendChild(progLabel);
  progWrap.appendChild(progBarOuter);
  progWrap.appendChild(toggleWrap);
  app.appendChild(progWrap);

  function updateProgress() {
    var target = 0, done = 0;
    for (var i = 0; i < matrix.length; i++) {
      for (var j = 0; j < matrix[i].length; j++) {
        var bands = matrix[i][j].bands;
        for (var k = 0; k < bands.length; k++) {
          var counts = bands[k].rating === REC || (includeWorth && bands[k].rating === WORTH);
          if (counts) {
            target++;
            if (bands[k].finished) done++;
          }
        }
      }
    }
    var pct = target ? Math.round(done / target * 100) : 0;
    progBarInner.style.width = pct + '%';
    var what = includeWorth ? 'recommended and worth-a-test' : 'recommended';
    progLabel.textContent = done + ' of ' + target + ' ' + what + ' bands made (' + pct + '%)';
  }

  // Matrix grid
  var scroll = el('div', 'gm-scroll');
  var grid = el('div', 'gm-grid');
  grid.style.gridTemplateColumns = 'var(--hd) repeat(' + glazes.length + ', var(--cell))';

  // corner
  grid.appendChild(el('div', 'gm-corner'));
  // column headers
  glazes.forEach(function (g) {
    var h = el('div', 'gm-colhead', '<span>' + g.code + '</span>');
    h.title = g.code + ' ' + g.name;
    grid.appendChild(h);
  });
  // rows
  for (var ri = 0; ri < glazes.length; ri++) {
    var rh = el('div', 'gm-rowhead', '<span>' + glazes[ri].code + '</span>');
    rh.title = glazes[ri].code + ' ' + glazes[ri].name;
    grid.appendChild(rh);
    for (var ci = 0; ci < glazes.length; ci++) {
      grid.appendChild(buildCell(ri, ci));
    }
  }
  scroll.appendChild(grid);
  app.appendChild(scroll);

  function buildCell(ri, ci) {
    var cell = matrix[ri][ci];
    var d = el('div', 'gm-cell' + (cell.single ? ' gm-single' : ''));
    d.setAttribute('data-i', ri);
    d.setAttribute('data-j', ci);
    cell.bands.forEach(function (band) {
      var bd = el('div', 'gm-band');
      bd.style.background = band.finished ? BLACK : COLORS[band.rating];
      d.appendChild(bd);
    });
    if (cell.run) d.appendChild(el('span', 'gm-tag gm-run'));
    if (cell.deco) d.appendChild(el('span', 'gm-tag gm-deco'));
    return d;
  }

  // Glaze key grouped by product line (code prefix)
  var keyWrap = el('div', 'gm-glazekey');
  keyWrap.appendChild(el('h2', null, 'Glaze key'));
  var groups = {};
  var order = [];
  glazes.forEach(function (g) {
    var pre = g.code.split('-')[0];
    if (!groups[pre]) { groups[pre] = []; order.push(pre); }
    groups[pre].push(g);
  });
  order.forEach(function (pre) {
    var grp = el('div', 'gm-group');
    grp.appendChild(el('h3', null, pre));
    var ul = el('ul');
    groups[pre].forEach(function (g) {
      ul.appendChild(el('li', null, '<b>' + g.code + '</b> ' + escapeHtml(g.name)));
    });
    grp.appendChild(ul);
    keyWrap.appendChild(grp);
  });
  app.appendChild(keyWrap);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Detail panel
  var detail = el('div', 'gm-detail');
  detail.style.display = 'none';
  app.appendChild(detail);

  function showDetail(ri, ci) {
    var cell = matrix[ri][ci];
    var b = cell.b, t = cell.t;
    var rec = cell.single ? recSingle(b) : recCombo(b, t);
    var title = cell.single
      ? (b.code + ' ' + b.name)
      : (b.code + ' ' + b.name + ' → ' + t.code + ' ' + t.name);

    var html = '<button class="gm-close" aria-label="Close">×</button>';
    html += '<h3>' + escapeHtml(title) + '</h3>';
    var tags = [];
    if (cell.run) tags.push('<span class="gm-pill gm-run-pill">Run risk</span>');
    if (cell.deco) tags.push('<span class="gm-pill gm-deco-pill">Decorative only</span>');
    if (tags.length) html += '<div class="gm-pills">' + tags.join(' ') + '</div>';
    html += '<p class="gm-rec">' + escapeHtml(rec.line) + '</p>';
    html += '<p class="gm-coats">' + escapeHtml(rec.coats) + '</p>';
    html += '<ul class="gm-claylist">';
    cell.bands.forEach(function (band, idx) {
      var clay = clays[idx];
      var note = clayNote(b, t, clay, band.rating, cell.single);
      var fin = band.finished ? ' (finished)' : '';
      html += '<li><span class="gm-claydot" style="background:' +
        (band.finished ? BLACK : COLORS[band.rating]) + '"></span>' +
        '<b>' + escapeHtml(clay.name) + '</b>: ' + RATING_LABEL[band.rating] + fin +
        '. ' + escapeHtml(note) + '</li>';
    });
    html += '</ul>';
    detail.innerHTML = html;
    detail.style.display = 'block';
    detail.querySelector('.gm-close').addEventListener('click', function () {
      detail.style.display = 'none';
    });
  }

  // Interaction: hover and tap
  grid.addEventListener('mouseover', function (e) {
    var cell = closestCell(e.target);
    if (cell) showDetail(+cell.getAttribute('data-i'), +cell.getAttribute('data-j'));
  });
  grid.addEventListener('click', function (e) {
    var cell = closestCell(e.target);
    if (cell) showDetail(+cell.getAttribute('data-i'), +cell.getAttribute('data-j'));
  });
  function closestCell(node) {
    while (node && node !== grid) {
      if (node.classList && node.classList.contains('gm-cell')) return node;
      node = node.parentNode;
    }
    return null;
  }

  // Test hook (harmless in the browser; used by the offline self-test).
  window.__GM_TEST__ = {
    REC: REC, WORTH: WORTH, SKIP: SKIP,
    enrich: enrich, baseLook: baseLook, bandCombo: bandCombo, bandSingle: bandSingle,
    ddCombo: ddCombo, singleLvl: singleLvl, interest: interest, runRisk: runRisk,
    deco: deco, recCombo: recCombo, recSingle: recSingle
  };

  // Empty-state guard
  if (!glazes.length) {
    app.appendChild(el('p', 'gm-empty', 'No classified glazes were returned. Check that the Glazes database has rows with a Clay Class and that the integration can read it.'));
  }

  updateProgress();
})();
