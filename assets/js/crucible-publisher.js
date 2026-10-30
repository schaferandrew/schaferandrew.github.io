// Crucible publisher page: one maker's models side by side, or an index of makers.
// "Publisher" is the lab that trained the model (D.makerOf), never the weight packager. Loading, the
// record join, counting rules, leaderboard rows and scores are CrucibleCore's; this file groups the
// leaderboard's rows by model and draws them. Makers are shown as recorded: no label list here.
(function () {
  var C = window.CrucibleCore;
  var NONE = C.NONE, COLORS = C.COLORS, MAX_COMPARE = C.MAX_COMPARE;
  var el = C.el, svg = C.svg, pct = C.pct, fmtScore = C.fmtScore, fmtSeconds = C.fmtSeconds;
  var segmented = C.segmented, whereTag = C.whereTag, isNarrow = C.isNarrow;
  var script = document.currentScript;

  function byId(id) { return document.getElementById(id); }
  function link(href, text, cls) { var a = el('a', { href: href }, text); if (cls) a.className = cls; return a; }

  function start(D) {
    var suiteId = D.suiteId, suiteName = D.suiteName, configLabel = D.configLabel;
    var current = { maker: null, mode: null, suite: null };
    var S = null, V = null;

    // ---- Models of a maker -------------------------------------------------

    // One entry per model (D.modelKey), which can span several base strings
    function groupModels(bases) {
      var order = [], by = {};
      bases.forEach(function (b) {
        var key = D.modelKey(b);
        if (!by[key]) { by[key] = { key: key, name: C.modelName(b), bases: [], local: false, cloud: false, inferred: false }; order.push(key); }
        by[key].bases.push(b);
        if (D.makerInfo(b).inferred && D.makerOf(b)) by[key].inferred = true;
      });
      Object.keys(D.CONFIGS).forEach(function (k) {
        var cfg = D.CONFIGS[k], key = D.modelKey(cfg.base);
        if (!by[key]) return;
        if (cfg.local) by[key].local = true; else by[key].cloud = true;
      });
      return order.map(function (k) { return by[k]; }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    }
    function counts(models) {
      return { models: models.length, local: models.filter(function (m) { return m.local; }).length, cloud: models.filter(function (m) { return m.cloud; }).length };
    }
    function countText(c) {
      var parts = [c.models + ' model' + (c.models === 1 ? '' : 's')];
      parts.push(c.local + ' local');
      parts.push(c.cloud + ' cloud');
      return parts;
    }

    // ---- A model's best setup in one section ---------------------------------

    var rowCache = {};
    function modeRows(mode) {
      var k = suiteId(S.cat) + '|' + mode;
      return rowCache[k] || (rowCache[k] = S.view(mode).rows());
    }
    // { model, best: row | null, setups } where best is the leaderboard row (reasoning level) with the best setup
    function entryFor(model, mode) {
      var rows = modeRows(mode).filter(function (r) { return D.modelKey(r.cfg.base) === model.key; });
      if (!rows.length) return { model: model, best: null, setups: 0 };
      var sorted = rows.slice().sort(S.betterConfig);
      return { model: model, best: sorted[0], setups: rows.reduce(function (n, r) { return n + r.variants.length; }, 0) };
    }
    function isRanked(Vm, s) { return Vm.isRanked(s); }
    // Ranked first by headline score, then in-progress or unscored ones
    function order(entries, Vm) {
      var ran = entries.filter(function (e) { return e.best; });
      var ranked = ran.filter(function (e) { return isRanked(Vm, e.best); }).sort(function (a, b) {
        return b.best.head.score - a.best.head.score || (a.model.name < b.model.name ? -1 : 1);
      });
      var rest = ran.filter(function (e) { return !isRanked(Vm, e.best); }).sort(function (a, b) { return S.betterConfig(a.best, b.best); });
      return { ranked: ranked, rest: rest, none: entries.filter(function (e) { return !e.best; }) };
    }

    // ---- Small pieces ----------------------------------------------------------

    var inferredMark = C.inferredMark;
    function makerLink(id) { return link(C.publisherUrl(id), D.makerLabel(id), 'crucible-pub-maker'); }
    function modelLink(model, cls) {
      return link(D.modelUrl(model.bases[0]), model.name, cls || 'crucible-pub-model');
    }
    function setupText(s) {
      var lead = s.cfg.level !== 'default' ? 'reasoning ' + s.cfg.level + ' · ' : '';
      return lead + configLabel(s.cfg);
    }
    function coverage(s, into) { return into.appendChild(C.coverageBar(s, S)); }
    function viewButton(model) { return link(D.modelUrl(model.bases[0]), 'View model →', 'crucible-pub-button'); }

    // ---- Suite bar and chrome -----------------------------------------------------

    function renderSuite() { D.renderSuiteBar(S); }
    function hashFor(id, mode) { return C.hashFor(id, { mode: mode || null }); }
    function crumbs(maker) {
      C.breadcrumb(byId('pub-crumbs'), maker ? [{ href: C.publisherUrl(null), text: 'Publishers' }, D.makerLabel(maker)] : ['Publishers']);
    }
    function message(text) {
      var m = byId('pub-message');
      m.textContent = text || '';
      m.hidden = !text;
    }

    // ---- Maker page --------------------------------------------------------------------

    function renderMaker(maker) {
      var models = groupModels(D.basesByMaker(maker));
      var c = counts(models);
      byId('pub-title').textContent = D.makerLabel(maker);
      document.title = D.makerLabel(maker) + ' · Crucible publishers';
      crumbs(maker);
      var meta = byId('pub-meta');
      meta.innerHTML = '';
      countText(c).concat(suiteName(S.cat)).forEach(function (t) { meta.appendChild(el('span', {}, t)); });
      var inferred = models.filter(function (m) { return m.inferred; }).length;
      if (inferred) {
        var tag = meta.appendChild(inferredMark());
        tag.title = C.INFERRED_TITLE + (inferred < models.length ? ' (' + inferred + ' of ' + models.length + ' models)' : '');
      }
      meta.hidden = false;
      message('');

      var modes = S.MODES;
      if (!modes.some(function (m) { return m.id === current.mode; })) current.mode = modes[0] ? modes[0].id : '';
      byId('pub-modes-box').hidden = modes.length < 2;
      segmented('pub-modes', modes.map(function (m) { return { value: m.id, label: m.label }; }), current.mode, function (id) {
        current.mode = id;
        if (history.replaceState) history.replaceState(null, '', hashFor(maker, id));
        renderMaker(maker);
      });
      byId('pub-unknown-box').hidden = true;
      if (!modes.length) { byId('pub-table-heading').hidden = true; return; }

      V = S.view(current.mode);
      var entries = models.map(function (m) { return entryFor(m, current.mode); });
      var ord = order(entries, V);
      byId('pub-table-heading').hidden = false;
      byId('pub-table-heading').textContent = 'Models';
      byId('pub-sub').textContent = S.modeInfo(current.mode).label + ' section. Each model\'s best setup, as on the leaderboard, ranked by ' +
        V.head().label + ' score; models with less than ' + pct(S.COVERAGE_MIN) + ' of the section\'s tasks run come after the rest.';
      renderModels(ord);
      renderCompare(ord);
      renderChart(ord);
      C.applyLayout(['crucible-pub']);
    }

    function renderModels(ord) {
      var table = byId('pub-table'), narrow = byId('crucible-pub-narrow');
      table.innerHTML = '';
      narrow.innerHTML = '';
      var tiers = V.TIERS, all = ord.ranked.concat(ord.rest);
      if (isNarrow()) { renderCards(narrow, ord, tiers); return; }
      var head = el('tr');
      ['Model', 'Best setup', 'Coverage'].concat(tiers.map(function (t) { return t.label; }), ['Median time', 'Cost', '']).forEach(function (t, i) {
        head.appendChild(el('th', { scope: 'col', class: i >= 3 + tiers.length && i < 5 + tiers.length ? 'crucible-lb-num' : '' }, t));
      });
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      all.forEach(function (e) {
        var s = e.best, tr = body.appendChild(el('tr'));
        var th = tr.appendChild(el('th', { scope: 'row', class: 'crucible-lb-name' }));
        var line = th.appendChild(el('span', { class: 'crucible-lb-name-line' }));
        line.appendChild(modelLink(e.model));
        line.appendChild(whereTag(s.cfg));
        if (e.model.inferred) line.appendChild(inferredMark());
        var cfgTd = tr.appendChild(el('td', { class: 'crucible-pub-setup' }));
        cfgTd.appendChild(el('span', { class: 'crucible-config-line' }, setupText(s)));
        if (e.setups > 1) cfgTd.appendChild(el('span', { class: 'crucible-config-n' }, 'best of ' + e.setups + ' setups'));
        coverage(s, tr.appendChild(el('td', { class: 'crucible-pub-covcell' })));
        tiers.forEach(function (t) { S.tierCell(s, t, tr.appendChild(el('td', { class: 'crucible-lb-bar-cell' }))); });
        tr.appendChild(el('td', { class: 'crucible-lb-num' }, fmtSeconds(s.time)));
        tr.appendChild(el('td', { class: 'crucible-lb-num', title: D.costTitle(s) }, D.costLabel(s)));
        tr.appendChild(el('td', {})).appendChild(viewButton(e.model));
      });
      ord.none.forEach(function (e) {
        var tr = body.appendChild(el('tr', { class: 'is-not-run' }));
        var th = tr.appendChild(el('th', { scope: 'row', class: 'crucible-lb-name' }));
        var line = th.appendChild(el('span', { class: 'crucible-lb-name-line' }));
        line.appendChild(modelLink(e.model));
        if (e.model.inferred) line.appendChild(inferredMark());
        tr.appendChild(el('td', { colspan: 2 + tiers.length + 2 }, 'Not run in this section'));
        tr.appendChild(el('td', {})).appendChild(viewButton(e.model));
      });
      if (!all.length && !ord.none.length) body.appendChild(el('tr')).appendChild(el('td', { colspan: 6 + tiers.length, class: 'crucible-not-run' }, 'No models.'));
    }

    // Below 640 px: a card per model with its scores, coverage bar and View model button
    function renderCards(box, ord, tiers) {
      var ul = box.appendChild(el('ul', { class: 'crucible-lb-cards' }));
      ord.ranked.concat(ord.rest).forEach(function (e) {
        var s = e.best, card = ul.appendChild(el('li', { class: 'crucible-lb-card crucible-pub-card' }));
        var top = card.appendChild(el('div', { class: 'crucible-lb-name-line' }));
        top.appendChild(modelLink(e.model));
        top.appendChild(whereTag(s.cfg));
        if (e.model.inferred) top.appendChild(inferredMark());
        card.appendChild(el('span', { class: 'crucible-config-line' }, setupText(s) + (e.setups > 1 ? ' · best of ' + e.setups + ' setups' : '')));
        coverage(s, card.appendChild(el('div', { class: 'crucible-pub-card-cov' })));
        tiers.forEach(function (t) {
          var row = card.appendChild(el('div', { class: 'crucible-lb-card-score' }));
          row.appendChild(el('span', { class: 'crucible-lb-card-label' }, t.label));
          S.tierCell(s, t, row);
        });
        card.appendChild(el('p', { class: 'crucible-lb-card-line' }, fmtSeconds(s.time) + '/task · ' + D.costLabel(s) + '/task'));
        card.appendChild(viewButton(e.model));
      });
      ord.none.forEach(function (e) {
        var card = ul.appendChild(el('li', { class: 'crucible-lb-card crucible-pub-card is-not-run' }));
        var top = card.appendChild(el('div', { class: 'crucible-lb-name-line' }));
        top.appendChild(modelLink(e.model));
        if (e.model.inferred) top.appendChild(inferredMark());
        card.appendChild(el('p', { class: 'crucible-lb-card-line' }, 'Not run in this section'));
        card.appendChild(viewButton(e.model));
      });
    }

    function renderCompare(ord) {
      var p = byId('pub-compare');
      p.innerHTML = '';
      var slugs = ord.ranked.slice(0, MAX_COMPARE).map(function (e) { return e.best.cfg.slug; });
      p.hidden = slugs.length < 2;
      if (p.hidden) return;
      p.appendChild(link(C.compareUrl(slugs), 'Compare these', 'crucible-pub-button is-solid'));
      p.appendChild(el('span', { class: 'crucible-sub' }, ' Best setups of ' + (slugs.length < ord.ranked.length ? 'the top ' : '') + slugs.length + ' ranked models in this section.'));
    }

    // ---- Chart: headline score of each model's best setup --------------------------------

    var chartData = null;
    function renderChart(ord) {
      chartData = ord;
      drawChart();
    }
    function drawChart() {
      var box = byId('pub-chart'), wrap = byId('pub-chart-box');
      box.innerHTML = '';
      var ord = chartData;
      var list = ord ? ord.ranked.concat(ord.rest) : [];
      wrap.hidden = !list.length;
      if (!list.length) return;
      var H = V.head();
      byId('pub-chart-heading').textContent = H.label + ' score per model';
      byId('pub-chart-sub').textContent = H.label + ' score of each model\'s best setup, 0 to 10. Labels read score · tasks run / tasks in the section.';
      var legend = byId('pub-legend');
      legend.innerHTML = '';
      [['local', 'local', 1], ['cloud', 'cloud', 1], ['pale', 'in progress (under ' + pct(S.COVERAGE_MIN) + ' of tasks run)', 0.35]].forEach(function (l) {
        var item = legend.appendChild(el('span', { class: 'crucible-pub-legend-item' }));
        var sw = item.appendChild(el('span', { class: 'crucible-pub-swatch' }));
        sw.style.background = l[0] === 'pale' ? '#8a8794' : COLORS[l[0]];
        sw.style.opacity = l[2];
        item.appendChild(document.createTextNode(l[1]));
      });
      var narrow = isNarrow(), W = Math.max(280, box.clientWidth || 640);
      var rowH = narrow ? 46 : 32, left = narrow ? 0 : Math.min(190, Math.round(W * 0.28)), right = narrow ? 0 : 110, top = 4;
      var x0 = left + (narrow ? 4 : 0), x1 = W - (narrow ? 4 : right) - (narrow ? 0 : 0);
      var barMax = narrow ? W - 8 - 100 : x1 - x0;
      var Hh = list.length * rowH + 26;
      var g = svg('svg', { class: 'crucible-chart-svg crucible-pub-svg', width: W, height: Hh, viewBox: '0 0 ' + W + ' ' + Hh, role: 'img', 'aria-label': H.label + ' score per model' });
      function X(v) { return x0 + v / 10 * barMax; }
      [0, 5, 10].forEach(function (v) {
        g.appendChild(svg('line', { class: 'crucible-grid', x1: X(v), x2: X(v), y1: 0, y2: Hh - 20 }));
        g.appendChild(svg('text', { class: 'crucible-tick', x: X(v), y: Hh - 5, 'text-anchor': v === 0 ? 'start' : v === 10 ? 'end' : 'middle' }, v));
      });
      list.forEach(function (e, i) {
        var s = e.best, y = top + i * rowH, ty = narrow ? y + 13 : y + 16, by = narrow ? y + 20 : y + 5;
        var a = svg('a', { href: D.modelUrl(e.model.bases[0]) });
        a.appendChild(svg('text', narrow ? { class: 'crucible-pub-lbl', x: x0, y: ty } : { class: 'crucible-pub-lbl', x: left - 8, y: ty, 'text-anchor': 'end' }, e.model.name));
        g.appendChild(a);
        if (s.head.score === null) {
          g.appendChild(svg('text', { class: 'crucible-pub-none', x: x0 + 4, y: narrow ? by + 13 : ty }, 'no ' + H.label + ' tasks run yet'));
          return;
        }
        var w = Math.max(1, s.head.score / 10 * barMax), pale = s.inProgress || s.head.partial;
        g.appendChild(svg('rect', { x: x0, y: by, width: w, height: 16, rx: 3, fill: COLORS[s.local ? 'local' : 'cloud'], 'fill-opacity': pale ? 0.35 : 1 }));
        g.appendChild(svg('text', { class: 'crucible-pub-val', x: x0 + w + 6, y: by + 12 }, fmtScore(s.head.score) + ' · ' + s.progress.done + '/' + s.progress.total));
      });
      box.appendChild(g);
    }

    // ---- Index of makers --------------------------------------------------------------------

    function bestScore(models, mode) {
      var Vm = S.view(mode), best = null;
      models.forEach(function (m) {
        var e = entryFor(m, mode);
        if (!e.best || e.best.head.score === null) return;
        var ranked = Vm.isRanked(e.best);
        if (!best || (ranked && !best.ranked) || (ranked === best.ranked && e.best.head.score > best.score)) {
          best = { score: e.best.head.score, ranked: ranked, model: m, row: e.best };
        }
      });
      return best;
    }
    function bestCell(b, into) {
      if (!b) { into.appendChild(el('span', { class: 'crucible-lb-none' }, NONE)); return; }
      var cell = into.appendChild(el('span', { class: 'crucible-pub-best' + (b.ranked ? '' : ' is-pale'), title: b.model.name + (b.ranked ? '' : ' (in progress)') }));
      cell.appendChild(el('span', { class: 'crucible-lb-score' }, fmtScore(b.score)));
      cell.appendChild(el('span', { class: 'crucible-lb-count' }, b.model.name));
    }

    function renderIndex(unknownId) {
      byId('pub-title').textContent = 'Publishers';
      document.title = 'Crucible publishers';
      crumbs(null);
      byId('pub-meta').hidden = true;
      byId('pub-modes-box').hidden = true;
      byId('pub-compare').hidden = true;
      byId('pub-chart-box').hidden = true;
      var makers = D.makers();
      message(unknownId ? 'There is no publisher "' + unknownId + '" in the results. Pick one from the list.' :
        'The labs that made the models on Crucible. Select one to see its models side by side. Scores are each model\'s best setup\'s headline score in a section.');
      byId('pub-table-heading').hidden = false;
      byId('pub-table-heading').textContent = makers.length + ' publisher' + (makers.length === 1 ? '' : 's');
      byId('pub-sub').textContent = '';
      var modes = S.MODES;
      var rows = makers.map(function (id) {
        var models = groupModels(D.basesByMaker(id));
        return { id: id, models: models, c: counts(models), best: modes.map(function (m) { return bestScore(models, m.id); }),
          inferred: models.some(function (m) { return m.inferred; }) };
      });
      var table = byId('pub-table'), narrow = byId('crucible-pub-narrow');
      table.innerHTML = '';
      narrow.innerHTML = '';
      if (isNarrow()) {
        var ul = narrow.appendChild(el('ul', { class: 'crucible-lb-cards' }));
        rows.forEach(function (r) {
          var card = ul.appendChild(el('li', { class: 'crucible-lb-card crucible-pub-card' }));
          var top = card.appendChild(el('div', { class: 'crucible-lb-name-line' }));
          top.appendChild(makerLink(r.id));
          if (r.inferred) top.appendChild(inferredMark());
          card.appendChild(el('span', { class: 'crucible-config-line' }, countText(r.c).join(' · ')));
          modes.forEach(function (m, i) {
            var row = card.appendChild(el('div', { class: 'crucible-lb-card-score' }));
            row.appendChild(el('span', { class: 'crucible-lb-card-label' }, m.label));
            bestCell(r.best[i], row);
          });
          card.appendChild(link(C.publisherUrl(r.id), 'View models →', 'crucible-pub-button'));
        });
      } else {
        var head = el('tr');
        ['Publisher', 'Models', 'Local', 'Cloud'].concat(modes.map(function (m) { return 'Best ' + m.label + ' score'; }), ['']).forEach(function (t, i) {
          head.appendChild(el('th', { scope: 'col', class: i >= 1 && i <= 3 ? 'crucible-lb-num' : '' }, t));
        });
        table.appendChild(el('thead')).appendChild(head);
        var body = table.appendChild(el('tbody'));
        rows.forEach(function (r) {
          var tr = body.appendChild(el('tr'));
          var th = tr.appendChild(el('th', { scope: 'row', class: 'crucible-lb-name' }));
          var line = th.appendChild(el('span', { class: 'crucible-lb-name-line' }));
          line.appendChild(makerLink(r.id));
          if (r.inferred) line.appendChild(inferredMark());
          tr.appendChild(el('td', { class: 'crucible-lb-num' }, String(r.c.models)));
          tr.appendChild(el('td', { class: 'crucible-lb-num' }, String(r.c.local)));
          tr.appendChild(el('td', { class: 'crucible-lb-num' }, String(r.c.cloud)));
          modes.forEach(function (m, i) { bestCell(r.best[i], tr.appendChild(el('td', { class: 'crucible-lb-bar-cell' }))); });
          tr.appendChild(el('td', {})).appendChild(link(C.publisherUrl(r.id), 'View models →', 'crucible-pub-button'));
        });
        if (!rows.length) body.appendChild(el('tr')).appendChild(el('td', { colspan: 5 + modes.length, class: 'crucible-not-run' }, 'No publishers yet.'));
      }
      C.applyLayout(['crucible-pub']);

      var unknown = groupModels(D.bases().filter(function (b) { return !D.makerOf(b); }));
      byId('pub-unknown-box').hidden = !unknown.length;
      var list = byId('pub-unknown');
      list.innerHTML = '';
      unknown.forEach(function (m) {
        var li = list.appendChild(el('li'));
        li.appendChild(link(D.modelUrl(m.bases[0]), m.name, 'crucible-pub-model'));
        li.appendChild(el('span', { class: 'crucible-config-line' }, [m.local ? 'local' : '', m.cloud ? 'cloud' : ''].filter(Boolean).join(' and ')));
      });
    }

    // ---- Routing -----------------------------------------------------------------------------

    function render(route) {
      var cat = route.params.suite ? D.catalogById(route.params.suite) : null;
      S = D.suite(cat ? route.params.suite : null);
      current.suite = suiteId(S.cat);
      renderSuite();
      var id = route.id, maker = null;
      if (id) {
        var makers = D.makers();
        maker = makers.indexOf(id) !== -1 ? id : makers.filter(function (m) { return m.toLowerCase() === id.toLowerCase(); })[0] || null;
      }
      if (maker && route.params.mode) current.mode = route.params.mode;
      if (maker) {
        current.maker = maker;
        renderMaker(maker);
      } else {
        chartData = null;
        renderIndex(id);
      }
    }

    byId('suite-select').addEventListener('change', function (e) {
      var id = e.target.value, isCurrent = id === suiteId(D.CURRENT);
      location.hash = C.buildHash(C.parseHash().id, { mode: C.parseHash().params.mode || null, suite: isCurrent ? null : id });
    });
    window.addEventListener('hashchange', function () { render(C.parseHash()); });
    var relayout = C.onLayoutChange(function () { render(C.parseHash()); });
    var lastW = window.innerWidth, timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        relayout();
        if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (chartData) drawChart(); }
      }, 150);
    });

    byId('crucible-results').hidden = false;
    render(C.parseHash());
  }

  C.boot({ script: script, ready: start });
})();
