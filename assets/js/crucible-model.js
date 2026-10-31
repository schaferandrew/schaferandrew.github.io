// Crucible model page: one hierarchy, publisher -> model. The route (D.modelRoute) picks the level:
//   /crucible/model/                  the publishers with their models
//   /crucible/model/#<maker>          one publisher's models, each by its best variant and deployment
//   /crucible/model/#<maker>/<model>  one model: a variant (what changes the answers) and its
//                                     deployments (the machine or provider: speed, cost, reliability)
// '-' stands for models with no known maker. "Publisher" is the maker, the lab that trained the
// model, never the weight packager. Built on CrucibleCore: the join, counting rules, variants,
// deployments and paired comparisons are the core's; this file lays them out.
(function () {
  var C = window.CrucibleCore;
  var el = C.el, svg = C.svg, NONE = C.NONE, COLORS = C.COLORS, MAX_COMPARE = C.MAX_COMPARE;
  var fmtScore = C.fmtScore, fmtSeconds = C.fmtSeconds, fmtCost = C.fmtCost, pct = C.pct;
  var script = document.currentScript;

  function link(href, text, cls) { var a = el('a', { href: href }, text); if (cls) a.className = cls; return a; }

  C.boot({ script: script, ready: function (D) {
    var $ = function (id) { return document.getElementById(id); };
    var results = $('crucible-results');
    var ticked = [], tickedFor = null, openAreas = {}, abKey = null, route = null, pubMode = null, chartData = null;
    var S = null, V = null;

    function go(params, id) {
      location.hash = C.hashFor(id !== undefined ? id : (route && route.id), params, ['variant', 'deployment', 'mode', 'suite']);
    }
    $('suite-select').addEventListener('change', function (e) {
      go({ suite: e.target.value === C.suiteId(D.CURRENT) ? null : e.target.value, variant: null, deployment: null, mode: null });
    });

    function message(text) {
      var m = $('model-message');
      m.textContent = text || '';
      m.hidden = !text;
    }
    function showLevel(level) {
      $('model-index').hidden = level !== 'index';
      $('model-publisher').hidden = level !== 'publisher';
      $('model-page').hidden = level !== 'model';
      if (level !== 'model') $('model-meta').hidden = true;
    }
    function crumbs(parts) { C.breadcrumb($('model-breadcrumb'), parts); }
    function modelsCrumb() { return { href: C.modelIndexUrl(), text: 'Models' }; }

    // ---- Models of a maker ---------------------------------------------------

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
    function countText(models) {
      var local = models.filter(function (m) { return m.local; }).length, cloud = models.filter(function (m) { return m.cloud; }).length;
      return [models.length + ' model' + (models.length === 1 ? '' : 's'), local + ' local', cloud + ' cloud'];
    }
    function modelLink(m, cls) { return link(D.modelUrl(m.bases[0]), m.name, cls || 'crucible-pub-model'); }
    function hasHarness(mode) { return S.variantDims(mode).indexOf('harness') !== -1; }
    function variantText(v, mode) { return D.variantLabel(v, { harness: hasHarness(mode) }); }

    // ---- Index: publishers with their models ------------------------------------

    function renderIndex(unknownText) {
      var box = $('model-index');
      box.innerHTML = '';
      $('model-title').textContent = 'Models';
      document.title = 'Crucible models';
      crumbs(['Models']);
      message(unknownText || 'Every model with results, under the lab that made it (the publisher). Select a publisher to see its models side by side, or a model for its variants and deployments.');
      var makers = D.makers().map(function (id) { return { id: id, bases: D.basesByMaker(id) }; });
      var unknown = D.bases().filter(function (b) { return !D.makerOf(b); });
      if (unknown.length) makers.push({ id: null, bases: unknown });
      makers.forEach(function (g) {
        var models = groupModels(g.bases);
        var sec = box.appendChild(el('div', { class: 'cm-maker' }));
        var h = sec.appendChild(el('h2', { class: 'cm-maker-name' }));
        h.appendChild(link(C.publisherUrl(g.id), g.id ? D.makerLabel(g.id) : 'Unknown publisher'));
        if (g.id && models.some(function (m) { return m.inferred; })) h.appendChild(C.inferredMark());
        h.appendChild(el('span', { class: 'cm-note' }, countText(models)[0]));
        var ul = sec.appendChild(el('ul', { class: 'cm-model-list' }));
        models.forEach(function (m) {
          var n = m.bases.reduce(function (k, b) { return k + D.variantsOfBase(b).length; }, 0);
          var li = ul.appendChild(el('li'));
          li.appendChild(modelLink(m, 'crucible-model-link'));
          li.appendChild(el('span', { class: 'cm-note' }, n + ' variant' + (n === 1 ? '' : 's')));
        });
      });
      if (!makers.length) box.appendChild(el('p', { class: 'crucible-not-run' }, 'No models yet.'));
      showLevel('index');
    }

    // ---- Publisher: a maker's models, each by its best variant ----------------------

    // { model, best: variant stats | null, variants, dep: the best variant's main deployment }
    var entryCache = {};
    function entryFor(model, mode) {
      var k = C.suiteId(S.cat) + '|' + mode + '|' + model.key;
      if (entryCache[k]) return entryCache[k];
      var list = S.view(mode).variantsOf(model.bases), best = list[0] || null;
      var deps = best ? S.view(mode).deployments(best.variant) : [];
      return (entryCache[k] = { model: model, best: best, variants: list.length, dep: deps[0] ? S.view(mode).deploymentStats(best.variant, deps[0].deployment) : null, deps: deps.length });
    }
    function order(entries) {
      var ran = entries.filter(function (e) { return e.best; });
      var ranked = ran.filter(function (e) { return V.isRanked(e.best); }).sort(function (a, b) {
        return b.best.head.score - a.best.head.score || (a.model.name < b.model.name ? -1 : 1);
      });
      var rest = ran.filter(function (e) { return !V.isRanked(e.best); }).sort(function (a, b) { return S.betterConfig(a.best, b.best); });
      return { ranked: ranked, rest: rest, none: entries.filter(function (e) { return !e.best; }) };
    }
    function viewButton(m) { return link(D.modelUrl(m.bases[0]), 'View model →', 'crucible-pub-button'); }
    function depCell(e, into) {
      if (!e.dep) { into.appendChild(document.createTextNode(NONE)); return; }
      into.appendChild(el('span', { class: 'crucible-config-line' }, e.dep.label));
      if (e.deps > 1) into.appendChild(el('span', { class: 'crucible-config-n' }, 'main of ' + e.deps + ' deployments'));
    }
    function timeText(d) { return d ? fmtSeconds(d.time !== null ? d.time : d.timeAll) : NONE; }
    function costText(d) { return d ? fmtCost(d.cost.value, d.local) : NONE; }
    function costTitle(d) { return d ? (d.local ? 'Electricity estimate' : 'Billed by the provider') : ''; }

    function renderPublisher(maker) {
      var models = groupModels(D.basesByMaker(maker)), label = maker ? D.makerLabel(maker) : 'Unknown publisher';
      $('model-title').textContent = label;
      document.title = label + ' · Crucible models';
      crumbs([modelsCrumb(), label]);
      var meta = $('model-meta');
      meta.innerHTML = '';
      countText(models).concat(C.suiteName(S.cat)).forEach(function (t) { meta.appendChild(el('span', {}, t)); });
      var inferred = models.filter(function (m) { return m.inferred; }).length;
      if (inferred) {
        var tag = meta.appendChild(C.inferredMark());
        tag.title = C.INFERRED_TITLE + (inferred < models.length ? ' (' + inferred + ' of ' + models.length + ' models)' : '');
      }
      meta.hidden = false;
      message(maker ? '' : 'These models have no recorded maker, and none could be taken from their name.');
      showLevel('publisher');

      var modes = S.MODES;
      if (route.params.mode) pubMode = route.params.mode;
      if (!modes.some(function (m) { return m.id === pubMode; })) pubMode = modes[0] ? modes[0].id : '';
      $('pub-modes-box').hidden = modes.length < 2;
      C.segmented('pub-modes', modes.map(function (m) { return { value: m.id, label: m.label }; }), pubMode, function (id) { go({ mode: id }); });
      if (!modes.length) { $('pub-table-heading').hidden = true; return; }

      V = S.view(pubMode);
      var ord = order(models.map(function (m) { return entryFor(m, pubMode); }));
      $('pub-table-heading').hidden = false;
      $('pub-sub').textContent = S.modeInfo(pubMode).label + ' section. Each model\'s best variant, ranked by ' + V.head().label +
        ' score, and the deployment (machine or provider) it mostly ran on; time and cost belong to that deployment. Models with less than ' +
        pct(S.COVERAGE_MIN) + ' of the section\'s tasks run come after the rest.';
      renderModels(ord);
      renderPubCompare(ord);
      chartData = ord;
      drawChart();
      C.applyLayout(['crucible-pub']);
    }

    function renderModels(ord) {
      var table = $('pub-table'), narrow = $('crucible-pub-narrow');
      table.innerHTML = '';
      narrow.innerHTML = '';
      var tiers = V.TIERS, all = ord.ranked.concat(ord.rest);
      if (C.isNarrow()) { renderCards(narrow, ord, tiers); return; }
      var head = el('tr');
      ['Model', 'Best variant', 'Coverage'].concat(tiers.map(function (t) { return t.label; }), ['Deployment', 'Median time', 'Cost', '']).forEach(function (t, i) {
        head.appendChild(el('th', { scope: 'col', class: i >= 4 + tiers.length && i < 6 + tiers.length ? 'crucible-lb-num' : '' }, t));
      });
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      all.forEach(function (e) {
        var s = e.best, tr = body.appendChild(el('tr'));
        var th = tr.appendChild(el('th', { scope: 'row', class: 'crucible-lb-name' }));
        var line = th.appendChild(el('span', { class: 'crucible-lb-name-line' }));
        line.appendChild(modelLink(e.model));
        line.appendChild(C.whereTag(s.cfg));
        if (e.model.inferred) line.appendChild(C.inferredMark());
        var cfgTd = tr.appendChild(el('td', { class: 'crucible-pub-setup' }));
        cfgTd.appendChild(el('span', { class: 'crucible-config-line' }, variantText(s.variant, pubMode)));
        if (e.variants > 1) cfgTd.appendChild(el('span', { class: 'crucible-config-n' }, 'best of ' + e.variants + ' variants'));
        tr.appendChild(el('td', { class: 'crucible-pub-covcell' })).appendChild(C.coverageBar(s, S));
        tiers.forEach(function (t) { S.tierCell(s, t, tr.appendChild(el('td', { class: 'crucible-lb-bar-cell' }))); });
        depCell(e, tr.appendChild(el('td', { class: 'crucible-pub-setup' })));
        tr.appendChild(el('td', { class: 'crucible-lb-num' }, timeText(e.dep)));
        tr.appendChild(el('td', { class: 'crucible-lb-num', title: costTitle(e.dep) }, costText(e.dep)));
        tr.appendChild(el('td', {})).appendChild(viewButton(e.model));
      });
      ord.none.forEach(function (e) {
        var tr = body.appendChild(el('tr', { class: 'is-not-run' }));
        var th = tr.appendChild(el('th', { scope: 'row', class: 'crucible-lb-name' }));
        var line = th.appendChild(el('span', { class: 'crucible-lb-name-line' }));
        line.appendChild(modelLink(e.model));
        if (e.model.inferred) line.appendChild(C.inferredMark());
        tr.appendChild(el('td', { colspan: 3 + tiers.length + 3 }, 'Not run in this section'));
        tr.appendChild(el('td', {})).appendChild(viewButton(e.model));
      });
      if (!all.length && !ord.none.length) body.appendChild(el('tr')).appendChild(el('td', { colspan: 7 + tiers.length, class: 'crucible-not-run' }, 'No models.'));
    }

    // Below 640 px: a card per model with its scores, coverage bar and View model button
    function renderCards(box, ord, tiers) {
      var ul = box.appendChild(el('ul', { class: 'crucible-lb-cards' }));
      ord.ranked.concat(ord.rest).forEach(function (e) {
        var s = e.best, card = ul.appendChild(el('li', { class: 'crucible-lb-card crucible-pub-card' }));
        var top = card.appendChild(el('div', { class: 'crucible-lb-name-line' }));
        top.appendChild(modelLink(e.model));
        top.appendChild(C.whereTag(s.cfg));
        if (e.model.inferred) top.appendChild(C.inferredMark());
        card.appendChild(el('span', { class: 'crucible-config-line' }, variantText(s.variant, pubMode) + (e.variants > 1 ? ' · best of ' + e.variants + ' variants' : '')));
        card.appendChild(el('div', { class: 'crucible-pub-card-cov' })).appendChild(C.coverageBar(s, S));
        tiers.forEach(function (t) {
          var row = card.appendChild(el('div', { class: 'crucible-lb-card-score' }));
          row.appendChild(el('span', { class: 'crucible-lb-card-label' }, t.label));
          S.tierCell(s, t, row);
        });
        card.appendChild(el('p', { class: 'crucible-lb-card-line' }, 'On ' + (e.dep ? e.dep.label : NONE) + (e.deps > 1 ? ' (main of ' + e.deps + ')' : '')));
        card.appendChild(el('p', { class: 'crucible-lb-card-line' }, timeText(e.dep) + '/task · ' + costText(e.dep) + '/task'));
        card.appendChild(viewButton(e.model));
      });
      ord.none.forEach(function (e) {
        var card = ul.appendChild(el('li', { class: 'crucible-lb-card crucible-pub-card is-not-run' }));
        var top = card.appendChild(el('div', { class: 'crucible-lb-name-line' }));
        top.appendChild(modelLink(e.model));
        if (e.model.inferred) top.appendChild(C.inferredMark());
        card.appendChild(el('p', { class: 'crucible-lb-card-line' }, 'Not run in this section'));
        card.appendChild(viewButton(e.model));
      });
    }

    // The compare link takes each ranked model's best variant on its main deployment
    function setupOf(v, dep) {
      var d = dep && D.deploymentOf(dep.deployment || dep);
      return v.cfgs.filter(function (c) { return d && D.deploymentOf(c) === d; })[0] || v.cfgs[0];
    }
    function renderPubCompare(ord) {
      var p = $('pub-compare');
      p.innerHTML = '';
      var top = ord.ranked.slice(0, MAX_COMPARE);
      p.hidden = top.length < 2;
      if (p.hidden) return;
      p.appendChild(link(C.compareUrl(top.map(function (e) { return setupOf(e.best.variant, e.dep).slug; })), 'Compare these', 'crucible-pub-button is-solid'));
      p.appendChild(el('span', { class: 'crucible-sub' }, ' Best variants of ' + (top.length < ord.ranked.length ? 'the top ' : '') + top.length + ' ranked models in this section, on their main deployments.'));
    }

    // Chart: headline score of each model's best variant
    function drawChart() {
      var box = $('pub-chart'), wrap = $('pub-chart-box');
      box.innerHTML = '';
      var list = chartData ? chartData.ranked.concat(chartData.rest) : [];
      wrap.hidden = !list.length || !V;
      if (wrap.hidden) return;
      var H = V.head();
      $('pub-chart-heading').textContent = H.label + ' score per model';
      $('pub-chart-sub').textContent = H.label + ' score of each model\'s best variant, 0 to 10. Labels read score · tasks run / tasks in the section.';
      var legend = $('pub-legend');
      legend.innerHTML = '';
      [['local', 'local', 1], ['cloud', 'cloud', 1], ['pale', 'in progress (under ' + pct(S.COVERAGE_MIN) + ' of tasks run)', 0.35]].forEach(function (l) {
        var item = legend.appendChild(el('span', { class: 'crucible-pub-legend-item' }));
        var sw = item.appendChild(el('span', { class: 'crucible-pub-swatch' }));
        sw.style.background = l[0] === 'pale' ? '#8a8794' : COLORS[l[0]];
        sw.style.opacity = l[2];
        item.appendChild(document.createTextNode(l[1]));
      });
      var narrow = C.isNarrow(), W = Math.max(280, box.clientWidth || 640);
      var rowH = narrow ? 46 : 32, left = narrow ? 0 : Math.min(190, Math.round(W * 0.28)), right = narrow ? 0 : 110, top = 4;
      var x0 = left + (narrow ? 4 : 0), x1 = W - (narrow ? 4 : right);
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

    // ---- The model ------------------------------------------------------------------

    function tile(into, label, value, sub, title) {
      var t = into.appendChild(el('div', { class: 'cm-tile' }));
      t.appendChild(el('p', { class: 'cm-tile-label' }, label));
      var v = t.appendChild(el('p', { class: 'cm-tile-value' }));
      if (typeof value === 'string') v.textContent = value; else v.appendChild(value);
      t.appendChild(el('p', { class: 'cm-tile-sub' }, sub || ''));
      if (title) t.title = title;
      return t;
    }
    function verdictNode(v) {
      if (v === 'pass' || v === 'fail') return el('span', { class: 'crucible-verdict is-' + v }, v === 'pass' ? '✓ pass' : '✕ fail');
      if (v === 'partial') return el('span', { class: 'crucible-lb-note' }, 'partial');
      return document.createTextNode(NONE);
    }

    function renderModel(mr) {
      var bases = mr.bases, base0 = bases[0];
      var modeList = {}, modes = [];
      S.MODES.forEach(function (m) {
        var list = S.view(m.id).variantsOf(bases);
        if (list.length) { modeList[m.id] = list; modes.push(m); }
      });
      var allCfgs = Object.keys(D.CONFIGS).map(function (k) { return D.CONFIGS[k]; }).filter(function (c) { return bases.indexOf(c.base) !== -1; });
      var maker = D.makerOf(base0);

      $('model-title').textContent = D.modelLabel(base0);
      document.title = D.modelLabel(base0) + ' · Crucible models';
      crumbs([modelsCrumb(), { href: C.publisherUrl(maker), text: maker ? D.makerLabel(maker) : 'Unknown publisher' }, D.modelLabel(base0)]);
      message('');
      showLevel('model');
      renderOther(allCfgs);
      var empty = $('model-empty');
      $('model-body').hidden = !modes.length;
      empty.hidden = !!modes.length;

      // Selected section, variant and deployment
      var mode = mr.mode && modeList[mr.mode] ? mr.mode : null;
      if (!mode && mr.variant) {
        modes.some(function (m) { if (modeList[m.id].some(function (s) { return s.variant === mr.variant; })) { mode = m.id; return true; } });
      }
      mode = mode || (modes[0] && modes[0].id);
      var list = mode ? modeList[mode] : [], sel = null, deps = [], dep = null;
      if (list.length) {
        V = S.view(mode);
        sel = list.filter(function (s) { return s.variant === mr.variant; })[0] || list[0];
        deps = V.deployments(sel.variant);
        dep = deps.filter(function (d) { return mr.deployment && d.deployment === mr.deployment; })[0] || deps[0];
        if (tickedFor !== mr.key + '|' + S.id + '|' + mode) { ticked = []; tickedFor = mr.key + '|' + S.id + '|' + mode; }
      }

      var meta = $('model-meta');
      meta.innerHTML = '';
      meta.appendChild(el('span', {}, 'By ')).appendChild(D.makerNode(base0, { unknown: true }));
      var locals = allCfgs.filter(function (c) { return c.local; }).length;
      meta.appendChild(el('span', {}, locals === allCfgs.length ? 'Local' : locals ? 'Local and cloud' : 'Cloud'));
      var nv = bases.reduce(function (n, b) { return n + D.variantsOfBase(b).length; }, 0);
      meta.appendChild(el('span', {}, nv + ' variant' + (nv === 1 ? '' : 's')));
      var packaged = sel && D.packagedBy(sel.variant);
      if (packaged) meta.appendChild(el('span', {}, packaged));
      if (modes.length) meta.appendChild(el('span', {}, modes.map(function (m) { return m.label; }).join(' and ')));
      meta.hidden = false;

      if (!sel) {
        empty.textContent = 'No run of this model counts in ' + S.name + ' yet.';
        return;
      }
      renderPicker(modes, mode, list, sel, dep);
      renderTiles(sel);
      renderAreas(sel);
      renderDeployments(sel, deps, dep);
      renderVariants(mode, list, sel, dep);
      renderAB(mode, sel, dep);
      renderTasks(mode, sel, dep);
    }

    // ---- Variant picker ----------------------------------------------------------------

    function dimValues(list, dim) {
      var seen = {}, out = [];
      list.forEach(function (s) {
        var val = D.variantValue(s.variant, dim);
        if (seen[val]) return;
        seen[val] = true;
        out.push({ value: val, text: D.variantText(s.variant, dim), v: s.variant });
      });
      // two weights with the same quant text (different packagers) are told apart
      out.forEach(function (o) {
        if (out.filter(function (p) { return p.text === o.text; }).length > 1) o.text += ' (' + (o.v.weights.packager || o.v.weights.format || 'other build') + ')';
      });
      return out.sort(function (a, b) { return a.text < b.text ? -1 : a.text > b.text ? 1 : 0; });
    }
    // The closest variant with dim = value, keeping as many other current choices as possible
    function closest(list, dims, cur, dim, value) {
      var best = null, bestN = -1;
      list.forEach(function (s) {
        if (D.variantValue(s.variant, dim) !== value) return;
        var n = dims.filter(function (d) { return d !== dim && D.variantValue(s.variant, d) === D.variantValue(cur.variant, d); }).length;
        if (n > bestN) { best = s; bestN = n; }
      });
      return best;
    }
    function pickVariant(s, depKey, mode) {
      var keep = depKey && V.deployments(s.variant).some(function (d) { return d.key === depKey; });
      go({ variant: s.variant.slug, deployment: keep ? depKey : null, mode: mode });
    }

    function renderPicker(modes, mode, list, sel, dep) {
      var box = $('model-picker');
      box.innerHTML = '';
      var dims = S.variantDims(mode);
      var row = box.appendChild(el('div', { class: 'cm-chiprow', role: 'group', 'aria-label': 'Section' }));
      row.appendChild(el('span', { class: 'cm-chiplabel' }, 'Section'));
      if (modes.length > 1) {
        modes.forEach(function (m) {
          var b = row.appendChild(el('button', { type: 'button', class: 'cm-chip', 'aria-pressed': m.id === mode }, m.label));
          b.addEventListener('click', function () { go({ mode: m.id, variant: null, deployment: null }); });
        });
      } else {
        row.appendChild(el('span', { class: 'cm-chipplain' }, modes[0].label));
      }
      dims.forEach(function (dim) {
        var values = dimValues(list, dim), info = D.dimension(dim);
        var r = el('div', { class: 'cm-chiprow', role: 'group', 'aria-label': info.label });
        r.appendChild(el('span', { class: 'cm-chiplabel' }, info.label));
        if (values.length < 2) {
          if (dim === 'weights' && !sel.variant.local) return;
          r.appendChild(el('span', { class: 'cm-chipplain' }, C.cap(values[0].text.replace(/^reasoning /, ''))));
          box.appendChild(r);
          return;
        }
        values.forEach(function (o) {
          var exact = list.some(function (s) {
            return D.variantValue(s.variant, dim) === o.value && dims.every(function (d) { return d === dim || D.variantValue(s.variant, d) === D.variantValue(sel.variant, d); });
          });
          var b = r.appendChild(el('button', { type: 'button', class: 'cm-chip' + (exact ? '' : ' is-dashed'), 'aria-pressed': D.variantValue(sel.variant, dim) === o.value,
            title: exact ? '' : 'No variant ran with this alongside your other choices; selects the nearest one' }, C.cap(o.text.replace(/^reasoning /, ''))));
          b.addEventListener('click', function () {
            var t = closest(list, dims, sel, dim, o.value);
            if (t) pickVariant(t, dep && dep.key, mode);
          });
        });
        box.appendChild(r);
      });
    }

    // ---- Tiles and areas ---------------------------------------------------------------

    function renderTiles(s) {
      var box = $('model-tiles');
      box.innerHTML = '';
      var head = V.head(), r = s.tier[head.id];
      tile(box, head.label, r && r.score !== null ? fmtScore(r.score) : NONE, r ? r.scored + ' of ' + r.total + ' tasks' + (r.partial ? ' (partial)' : '') : 'no scored task');
      V.TIERS.forEach(function (t) {
        if (t.id === head.id) return;
        var res = s.tier[t.id];
        if (S.gateOf(t.id)) {
          tile(box, t.label + ' gate', verdictNode(s.verdict[t.id]), res && res.score !== null ? 'score ' + fmtScore(res.score) + ' · ' + res.scored + ' of ' + res.total + ' tasks' : 'no scored task');
        } else if (res) {
          tile(box, t.label, res.score !== null ? fmtScore(res.score) : NONE, res.scored + ' of ' + res.total + ' tasks' + (res.partial ? ' (partial)' : ''));
        }
      });
      tile(box, 'Coverage', s.progress.done + ' of ' + s.progress.total, s.inProgress ? 'in progress: under ' + pct(S.IN_PROGRESS_BELOW) + ' of the tasks' : pct(s.progress.share) + ' of the tasks');
      tile(box, 'Counted runs', C.fmtInt(s.runs), 'pooled over its deployments; time and cost are per deployment, below');
    }

    function renderAreas(s) {
      $('cm-areas-sub').textContent = 'Mean score on the tasks this variant has a counted run of in each area. “Measured on x of y” counts the area’s tasks; an area measured on fewer than half its tasks is drawn pale and is not a fair read of the area.';
      var box = $('cm-areas');
      box.innerHTML = '';
      s.areas.forEach(function (r) {
        if (!r.tasks.length) return;
        var none = r.state !== 'counted';
        var row = box.appendChild(el('div', { class: 'cm-area' + (none ? ' is-none' : '') + (r.pale && !none ? ' is-pale' : '') }));
        row.appendChild(el('span', { class: 'cm-area-name' }, r.area.label));
        var track = row.appendChild(el('span', { class: 'cm-area-track' }));
        if (!none) track.appendChild(el('span', { class: 'cm-area-fill' })).style.width = (r.score * 10) + '%';
        row.appendChild(el('span', { class: 'cm-area-val' }, r.state === 'not-run' ? 'not run' : r.state === 'none-count' ? 'none count' :
          fmtScore(r.score) + ' · measured on ' + r.n + ' of ' + r.tasks.length + (r.pale ? ' (few)' : '')));
        if (r.state === 'none-count') row.title = 'It has runs in this area, but none counts in this suite.';
      });
    }

    // ---- Deployments ---------------------------------------------------------------------

    function depName(d, into) {
      var span = into.appendChild(el('span', { class: 'cm-dep-name' }));
      span.appendChild(el('span', { class: 'cm-dep-label' }, d.label));
      span.appendChild(C.whereTag({ local: d.local, where: d.where || (d.local ? 'local' : 'cloud') }));
      if (!d.recorded) span.appendChild(el('span', { class: 'cm-unrecorded', title: 'These runs didn’t record where they ran. They count toward the variant’s quality but are left out of A/Bs and speed comparisons.' }, 'not recorded'));
      return span;
    }
    function costCell(d) {
      var t = fmtCost(d.cost.value, d.local);
      return d.cost.value === null ? NONE : t + (d.local ? ' (electricity est.)' : ' (billed)');
    }
    function timeCell(d) {
      if (d.time !== null) return fmtSeconds(d.time);
      return d.timeAll !== null ? fmtSeconds(d.timeAll) + ' (none finished)' : NONE;
    }
    // 20m 00s (1200 s): a timeout's limit is easier to recognize in seconds
    function secs(v) { v = C.num(v, null); return v === null ? NONE : v >= 60 ? fmtSeconds(v) + ' (' + Math.round(v) + ' s)' : fmtSeconds(v); }
    function packagerText(d) { return d.packager ? d.packager.replace(/^Packaged by /, '') : NONE; }

    function renderDeployments(sel, deps, dep) {
      var local = deps.some(function (d) { return d.local; }), cloud = deps.some(function (d) { return !d.local; });
      $('cm-deps-sub').textContent = 'Where this variant ran: speed, cost and reliability belong to a deployment, not to the variant. Median time is per task over finished runs. ' +
        (local && cloud ? 'Local cost is an electricity estimate (≈), cloud cost is what the provider billed; the two are never on one scale. ' : local ? 'Cost is an electricity estimate (≈): local runs aren’t billed. ' : 'Cost is what the provider billed. ') +
        (deps.length > 1 ? 'Select a deployment to look at its A/B.' : '');
      var table = $('cm-deps'), narrow = $('cm-deps-narrow');
      table.innerHTML = '';
      narrow.innerHTML = '';
      function pick(d) { go({ deployment: d.key, variant: sel.variant.slug, mode: V.mode }); }
      var head = el('tr');
      ['Deployment', 'Packaged by', 'Runs', 'Finished', 'Timed out', 'Errors', 'Median time per task', 'Cost per task'].forEach(function (t, i) {
        head.appendChild(el('th', { scope: 'col', class: i >= 2 && i <= 5 ? 'is-num' : '' }, t));
      });
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      deps.forEach(function (d) {
        var on = dep && d.deployment === dep.deployment;
        var tr = body.appendChild(el('tr', { class: 'crucible-row' + (on ? ' is-selected' : '') + (d.recorded ? '' : ' is-unrecorded'), 'aria-selected': on, tabindex: '0' }));
        tr.addEventListener('click', function () { pick(d); });
        tr.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); pick(d); } });
        depName(d, tr.appendChild(el('th', { scope: 'row' })));
        tr.appendChild(el('td', {}, packagerText(d)));
        [d.runs, d.finished, d.timedOut, d.errors].forEach(function (n, i) {
          tr.appendChild(el('td', { class: 'is-num' + (i >= 2 && n ? ' is-bad' : '') }, String(n)));
        });
        tr.appendChild(el('td', {}, timeCell(d)));
        tr.appendChild(el('td', {}, costCell(d)));
      });
      var ul = narrow.appendChild(el('ul', { class: 'crucible-cards' }));
      deps.forEach(function (d) {
        var on = dep && d.deployment === dep.deployment;
        var li = ul.appendChild(el('li', { class: 'crucible-card' + (on ? ' is-selected' : '') + (d.recorded ? '' : ' is-unrecorded') }));
        var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
        var b = title.appendChild(el('button', { type: 'button', class: 'crucible-link-button', 'aria-pressed': !!on }, d.label));
        b.addEventListener('click', function () { pick(d); });
        title.appendChild(C.whereTag({ local: d.local, where: d.where || (d.local ? 'local' : 'cloud') }));
        if (!d.recorded) title.appendChild(el('span', { class: 'cm-unrecorded' }, 'not recorded'));
        C.kvRow(li, 'Packaged by', packagerText(d));
        C.kvRow(li, 'Runs', d.runs + ' · ' + d.finished + ' finished · ' + d.timedOut + ' timed out · ' + d.errors + ' errors');
        C.kvRow(li, 'Median time', timeCell(d));
        C.kvRow(li, 'Cost', costCell(d));
      });
      C.applyLayout(['cm-deps']);

      // Runs that didn't finish, by task: reliability, kept apart from quality
      var box = $('cm-dnf');
      box.innerHTML = '';
      var rows = [];
      V.orderedTasks.forEach(function (t) {
        var c = S.variantCell(sel.variant, t.id);
        (c ? c.all : []).forEach(function (i) {
          if (i.state === 'counted' && D.runOutcome(i.run) !== 'finished') rows.push({ t: t, i: i, d: D.deploymentOf(i) });
        });
      });
      box.hidden = !rows.length;
      if (!rows.length) return;
      box.appendChild(el('p', { class: 'cm-dnf-head' }, 'Runs that didn’t finish'));
      var ul2 = box.appendChild(el('ul', { class: 'cm-dnf-list' }));
      rows.forEach(function (r) {
        var li = ul2.appendChild(el('li'));
        li.appendChild(link(C.taskUrl(r.t.id), C.taskName(r.t)));
        li.appendChild(document.createTextNode(': ' + D.outcomeText(r.i.run) + ' after ' + fmtSeconds(C.num(r.i.run.elapsed_s, null)) + ' on ' + r.d.label +
          '; the leaderboard scores it ' + fmtScore(r.i.score) + '.'));
        if (!r.d.recorded) li.appendChild(el('span', { class: 'cm-unrecorded' }, 'not recorded'));
      });
    }

    // ---- Every variant -------------------------------------------------------------------

    function renderVariants(mode, list, sel, dep) {
      var dims = S.variantDims(mode).filter(function (d) { return dimValues(list, d).length > 1; });
      $('variants-sub').textContent = list.length + ' variant' + (list.length === 1 ? '' : 's') + ' ran in this section, best first. Select a row to look at that variant; tick two to ' + MAX_COMPARE +
        ' to compare them (each on ' + (dep ? 'the selected deployment where it ran' : 'its own machine') + ').';
      var table = $('cm-variants'), box = $('cm-variants-narrow');
      table.innerHTML = '';
      box.innerHTML = '';
      function label(s) { return dims.length ? dims.map(function (d) { return D.variantText(s.variant, d); }).join(' · ') : variantText(s.variant, mode); }
      function toggle(s, on) {
        var i = ticked.indexOf(s.variant.key);
        if (on && i === -1) ticked.push(s.variant.key); else if (i !== -1) ticked.splice(i, 1);
        renderVariants(mode, list, sel, dep);
      }
      var head = el('tr');
      head.appendChild(el('th', { scope: 'col' }, ''));
      head.appendChild(el('th', { scope: 'col' }, 'Coverage'));
      head.appendChild(el('th', { scope: 'col' }, dims.length ? dims.map(function (d) { return D.dimension(d).label; }).join(' · ') : 'Variant'));
      V.TIERS.forEach(function (t) { head.appendChild(el('th', { scope: 'col', class: 'is-tier' }, t.label)); });
      head.appendChild(el('th', { scope: 'col', class: 'is-num' }, 'Deployments'));
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
      list.forEach(function (s) {
        var on = s === sel, nd = V.deployments(s.variant).length;
        var pick = function () { pickVariant(s, dep && dep.key, mode); };
        var tr = body.appendChild(el('tr', { class: 'crucible-row' + (on ? ' is-selected' : ''), 'aria-selected': on, tabindex: '0' }));
        tr.addEventListener('click', pick);
        tr.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); pick(); } });
        var cb = tr.appendChild(el('td')).appendChild(el('input', { type: 'checkbox', 'aria-label': 'Compare ' + label(s) }));
        cb.checked = ticked.indexOf(s.variant.key) !== -1;
        cb.disabled = !cb.checked && ticked.length >= MAX_COMPARE;
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () { toggle(s, cb.checked); });
        tr.appendChild(el('td')).appendChild(C.coverageBar(s, S));
        tr.appendChild(el('td', {}, label(s)));
        V.TIERS.forEach(function (t) { S.tierCell(s, t, tr.appendChild(el('td', { class: 'is-tier' }))); });
        tr.appendChild(el('td', { class: 'is-num' }, String(nd)));

        var li = ul.appendChild(el('li', { class: 'crucible-card' + (on ? ' is-selected' : '') }));
        var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
        var b = title.appendChild(el('button', { type: 'button', class: 'crucible-link-button', 'aria-pressed': on }, label(s)));
        b.addEventListener('click', pick);
        if (on) title.appendChild(el('span', { class: 'crucible-tag' }, 'selected'));
        li.appendChild(el('div', { class: 'cm-card-cov' })).appendChild(C.coverageBar(s, S));
        V.TIERS.forEach(function (t) {
          var v = el('span', { class: 'crucible-kv-value' });
          S.tierCell(s, t, v);
          C.kvRow(li, t.label, v);
        });
        C.kvRow(li, 'Deployments', String(nd));
        var lab = li.appendChild(el('label', { class: 'cm-card-check' }));
        var cb2 = lab.appendChild(el('input', { type: 'checkbox' }));
        cb2.checked = cb.checked;
        cb2.disabled = cb.disabled;
        lab.appendChild(document.createTextNode('Compare'));
        cb2.addEventListener('change', function () { toggle(s, cb2.checked); });
      });
      C.applyLayout(['cm-variants', 'cm-tasks']);
      var bar = $('cm-compare-bar');
      bar.innerHTML = '';
      var ok = ticked.length >= 2 && ticked.length <= MAX_COMPARE;
      if (ok) {
        var slugs = ticked.map(function (k) { return setupOf(D.variantOf(k), dep); }).map(function (c) { return c.slug; });
        bar.appendChild(el('a', { class: 'cm-compare-go', href: C.compareUrl(slugs) }, 'Compare ' + ticked.length + ' variants →'));
      } else {
        bar.appendChild(el('span', { class: 'cm-compare-go is-off', 'aria-disabled': 'true' }, 'Compare ' + (ticked.length ? ticked.length + ' variant' + (ticked.length === 1 ? '' : 's') : 'variants') + ' →'));
      }
      bar.appendChild(el('span', { class: 'cm-note' }, ok ? '' : 'Tick two to ' + MAX_COMPARE + ' variants.'));
    }

    // ---- A/B: the same deployment and tasks, one answer-changing setting apart ----------------

    function dnfLine(list, name, into) {
      list.forEach(function (x) {
        var r = x.runs[0];
        var li = into.appendChild(el('li'));
        li.appendChild(link(C.taskUrl(x.task.id), C.taskName(x.task)));
        li.appendChild(document.createTextNode(': ' + name + ' didn’t finish ' + x.k + ' of ' + x.n + ' run' + (x.n === 1 ? '' : 's') + ' (' + D.outcomeText(r.run) + ' after ' + secs(r.run.elapsed_s) + ').'));
      });
    }

    function renderAB(mode, sel, dep) {
      var sec = $('cm-ab');
      var cands = dep && dep.recorded ? V.abCandidates(sel.variant, dep.deployment) : [];
      sec.hidden = !cands.length && !(dep && !dep.recorded && V.variantsOf(sel.variant.base).length > 1);
      if (sec.hidden) return;
      $('cm-ab-pick').innerHTML = '';
      $('cm-db').innerHTML = '';
      $('cm-db-legend').innerHTML = '';
      $('cm-ab-notes').innerHTML = '';
      if (!cands.length) {
        $('cm-ab-heading').textContent = 'A/B';
        $('cm-ab-sub').textContent = 'An A/B needs a recorded machine or provider. This variant’s runs are on one that wasn’t recorded, so they can’t be compared with another variant’s.';
        $('cm-ab-summary').hidden = true;
        return;
      }
      $('cm-ab-summary').hidden = false;
      var cur = cands.filter(function (c) { return c.variant.key === abKey; })[0] || cands[0];
      abKey = cur.variant.key;
      var cmp = cur.comparison, d = D.dimension(cur.dim);
      function text(v) { return D.variantText(v, cur.dim); }
      var aText = text(sel.variant), bText = text(cur.variant);
      if (cands.length > 1) {
        var pick = $('cm-ab-pick');
        pick.appendChild(el('span', { class: 'crucible-toolbar-label' }, 'Compare'));
        var seg = pick.appendChild(el('div', { class: 'crucible-segmented', role: 'radiogroup', 'aria-label': 'Which variant to compare' }));
        C.segmented(seg, cands.map(function (c) { return { value: c.variant.key, label: D.variantText(c.variant, c.dim) }; }),
          abKey, function (v) { abKey = v; renderAB(mode, sel, dep); });
      }
      $('cm-ab-heading').textContent = 'A/B: ' + aText + ' or ' + bText;
      $('cm-ab-sub').textContent = 'The same variant but for its ' + d.label.toLowerCase() + ', on ' + dep.label + ', on the ' + cmp.shared.length + ' task' + (cmp.shared.length === 1 ? '' : 's') +
        ' both ran at this suite’s task version. Score per task, 0–10; a run that didn’t finish is listed below, not scored as a difference.';
      var cA = C.SERIES[0], cB = C.SERIES[1];
      var box = $('cm-db');
      var W = 300, pad = 8, x = function (v) { return pad + v / 10 * (W - 2 * pad); };
      cmp.pairs.forEach(function (p) {
        var row = box.appendChild(el('div', { class: 'cm-db-row' + (p.counted ? '' : ' is-uncounted') }));
        row.appendChild(el('a', { class: 'cm-db-name', href: C.taskUrl(p.task.id), title: C.taskName(p.task) }, C.taskName(p.task)));
        if (!p.counted) { row.appendChild(el('span', { class: 'cm-db-skip' }, 'not scored here: a side didn’t finish')); return; }
        var a = p.a.score, b = p.b.score;
        var g = svg('svg', { viewBox: '0 0 ' + W + ' 20', role: 'img', 'aria-label': C.taskName(p.task) + ': ' + aText + ' ' + fmtScore(a) + ', ' + bText + ' ' + fmtScore(b) });
        g.appendChild(svg('line', { x1: x(0), x2: x(10), y1: 10, y2: 10, stroke: '#e3e3e8', 'stroke-width': 1 }));
        g.appendChild(svg('line', { x1: x(a), x2: x(b), y1: 10, y2: 10, stroke: '#8a8794', 'stroke-width': 2 }));
        g.appendChild(svg('circle', { cx: x(a), cy: 10, r: 5, fill: cA })).appendChild(svg('title', {}, aText + ': ' + fmtScore(a)));
        g.appendChild(svg('circle', { cx: x(b), cy: 10, r: 5, fill: cB })).appendChild(svg('title', {}, bText + ': ' + fmtScore(b)));
        row.appendChild(g);
      });
      var axis = box.appendChild(el('div', { class: 'cm-db-row cm-db-axis-row' }));
      axis.appendChild(el('span'));
      var ag = svg('svg', { viewBox: '0 0 ' + W + ' 14', 'aria-hidden': 'true', class: 'cm-db-axis' });
      [0, 5, 10].forEach(function (v) { ag.appendChild(svg('text', { x: x(v), y: 11, 'text-anchor': v === 0 ? 'start' : v === 10 ? 'end' : 'middle' }, String(v))); });
      axis.appendChild(ag);
      var legend = $('cm-db-legend');
      [[cA, aText + ' (selected)'], [cB, bText]].forEach(function (p) {
        var sp = legend.appendChild(el('span'));
        sp.appendChild(el('span', { class: 'cm-dot' })).style.background = p[0];
        sp.appendChild(document.createTextNode(p[1]));
      });

      // The sentence is the core's: a "scores x higher" headline only when it is allowed, else "differ on k of n"
      var notes = $('cm-ab-notes');
      var summary = cmp.sentence(aText, bText);
      if (cmp.speed.comparable && cmp.speed.a !== null && cmp.speed.b !== null) {
        var f = cmp.speed.ratio === null ? null : cmp.speed.ratio >= 1 ? cmp.speed.ratio : 1 / cmp.speed.ratio;
        summary += ' On ' + dep.label + ' the median time per shared task is ' + fmtSeconds(cmp.speed.b) + ' with ' + bText + ' against ' + fmtSeconds(cmp.speed.a) + ' with ' + aText +
          (f !== null && f >= 1.05 ? ' (' + (f < 10 ? f.toFixed(1) : Math.round(f)) + '× ' + (cmp.speed.ratio > 1 ? 'slower' : 'faster') + ')' : '') + '.';
      }
      $('cm-ab-summary').textContent = summary;

      var dnfA = cmp.didNotFinish.a, dnfB = cmp.didNotFinish.b;
      if (dnfA.length || dnfB.length) {
        notes.appendChild(el('p', { class: 'cm-dnf-head' }, 'Didn’t finish (reliability, not part of the score difference)'));
        var ul = notes.appendChild(el('ul', { class: 'cm-dnf-list' }));
        dnfLine(dnfA, aText, ul);
        dnfLine(dnfB, bText, ul);
      }
      var un = cmp.unrecorded.a.map(function (r) { r.side = aText; return r; }).concat(cmp.unrecorded.b.map(function (r) { r.side = bText; return r; }));
      if (un.length) {
        notes.appendChild(el('p', { class: 'cm-dnf-head' }, 'Left out: runs on a machine that wasn’t recorded'));
        var ul2 = notes.appendChild(el('ul', { class: 'cm-dnf-list' }));
        un.forEach(function (r) {
          var li = ul2.appendChild(el('li'));
          li.appendChild(link(C.taskUrl(r.task.id), C.taskName(r.task)));
          li.appendChild(document.createTextNode(' with ' + r.side + ': ' + r.outcomeText + (r.elapsed !== null ? ' after ' + secs(r.elapsed) : '') + ', scored ' + fmtScore(r.score) +
            ' on ' + r.deployment.label + '. It may be a different machine, so it isn’t compared.'));
        });
      }
    }

    // ---- Tasks -----------------------------------------------------------------------------

    // An area's toggle: the mean of its counted task scores and how many of its tasks have a counted
    // run, the same numbers as "By area"; runs that don't count are named as such, never counted
    function areaToggle(area, tasks, v, key, open, rerender) {
      var means = tasks.map(function (t) { return S.variantMean(v, t.id); });
      var counted = means.filter(function (x) { return x !== null; }).length;
      var uncounted = tasks.filter(function (t, i) { var c = S.variantCell(v, t.id); return means[i] === null && c && c.all.length; }).length;
      var avg = C.mean(means);
      var button = el('button', { type: 'button', class: 'crucible-area-toggle', 'aria-expanded': open });
      button.appendChild(el('span', { class: 'crucible-area-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'));
      button.appendChild(el('span', { class: 'crucible-area-name' }, area.label));
      var chip = el('span', { class: 'crucible-area-score' }, avg === null ? NONE : (C.isNarrow() ? 'mean ' : '') + fmtScore(avg));
      if (avg !== null) chip.setAttribute('style', C.heatStyle(avg));
      button.appendChild(chip);
      button.appendChild(el('span', { class: 'crucible-area-count' }, counted + ' of ' + tasks.length + ' counted' + (uncounted ? ' · ' + uncounted + ' ran but don’t count' : '')));
      button.addEventListener('click', function () { openAreas[key] = !open; rerender(); });
      return button;
    }
    function runsText(n) { return n.counted === n.runs ? String(n.runs) : n.counted + ' of ' + n.runs + ' counted'; }

    function renderTasks(mode, sel, dep) {
      var v = sel.variant;
      $('cm-tasks-sub').textContent = 'Every task for the selected variant, grouped by area; a score is the mean of its counted runs, over all its deployments. Time and cost are from ' +
        (dep ? dep.label : 'its runs') + ' only. Select a score for its runs, checks and output.';
      var table = $('cm-tasks'), narrow = $('cm-tasks-narrow'), panel = $('cm-cell-detail');
      table.innerHTML = '';
      narrow.innerHTML = '';
      panel.hidden = true;
      var vlabel = variantText(v, mode), sObj = { label: C.shortName(v.base), cfg: v.cfgs[0] };
      var tierIx = V.tiers;
      var groups = V.info.areas.map(function (a) {
        var l = V.orderedTasks.filter(function (t) { return t.area === a.id; });
        l.sort(function (x, y) { return tierIx.indexOf(x.tier) - tierIx.indexOf(y.tier); });
        return { area: a, tasks: l, key: V.mode + ':' + a.id };
      }).filter(function (g) { return g.tasks.length; });
      function open(t, c) {
        D.showCellDetail(panel, S, sObj, t, c);
        var small = panel.querySelector('.crucible-task-id');
        if (small) small.textContent = ' ' + vlabel;
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      var rerender = function () { renderTasks(mode, sel, dep); };
      var local = dep ? dep.local : v.local;
      function depNumbers(t) { var c = dep && S.variantCell(v, t.id, dep.key); return c ? D.cellNumbers(c) : null; }
      if (C.isNarrow()) {
        groups.forEach(function (g) {
          var isOpen = !!openAreas[g.key];
          var group = narrow.appendChild(el('div', { class: 'crucible-area-narrow' + (isOpen ? ' is-open' : '') }));
          group.appendChild(areaToggle(g.area, g.tasks, v, g.key, isOpen, rerender));
          if (!isOpen) return;
          var ul = group.appendChild(el('ul', { class: 'crucible-cards' }));
          g.tasks.forEach(function (t) {
            var c = S.variantCell(v, t.id), n = D.cellNumbers(c), dn = depNumbers(t);
            var li = ul.appendChild(el('li', { class: 'crucible-card' + (c ? '' : ' is-not-run') }));
            var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
            title.appendChild(el('a', { class: 'crucible-test-id', href: C.taskUrl(t.id) }, C.taskName(t)));
            title.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, S.tierLabel(t.tier)));
            if (!c) { li.appendChild(el('p', { class: 'crucible-not-run' }, 'not run')); return; }
            var b = D.cellButton(sObj, t, c, true);
            b.addEventListener('click', function () { open(t, c); });
            var sv = el('span', { class: 'crucible-kv-value' });
            sv.appendChild(b);
            if (!n.counted) sv.appendChild(D.stateFlag(c.all[0].state));
            C.kvRow(li, 'Score', sv);
            C.kvRow(li, 'Time', dn ? fmtSeconds(dn.time) : NONE);
            C.kvRow(li, 'Cost', dn ? fmtCost(dn.cost, local) : NONE);
            C.kvRow(li, 'Runs', runsText(n));
          });
        });
        return;
      }
      var columns = ['Task', 'Score (mean)', 'Time', 'Cost', 'Runs'];
      var head = el('tr');
      columns.forEach(function (c) { head.appendChild(el('th', { scope: 'col' }, c)); });
      table.appendChild(el('thead')).appendChild(head);
      groups.forEach(function (g) {
        var isOpen = !!openAreas[g.key];
        var body = table.appendChild(el('tbody', { class: 'crucible-area' + (isOpen ? ' is-open' : '') }));
        var gr = body.appendChild(el('tr', { class: 'crucible-group crucible-area-row' }));
        gr.appendChild(el('th', { colspan: columns.length, scope: 'rowgroup' })).appendChild(areaToggle(g.area, g.tasks, v, g.key, isOpen, rerender));
        if (!isOpen) return;
        g.tasks.forEach(function (t) {
          var c = S.variantCell(v, t.id);
          var row = body.appendChild(el('tr', { class: 'crucible-row' + (c ? '' : ' is-not-run') }));
          var name = row.appendChild(el('th', { scope: 'row' }));
          name.appendChild(el('a', { class: 'crucible-test-id', href: C.taskUrl(t.id) }, C.taskName(t)));
          name.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, S.tierLabel(t.tier)));
          if (!c) { row.appendChild(el('td', { colspan: columns.length - 1, class: 'crucible-not-run' }, 'not run')); return; }
          var n = D.cellNumbers(c), dn = depNumbers(t);
          var b = D.cellButton(sObj, t, c, false);
          b.addEventListener('click', function () { open(t, c); });
          var sc = row.appendChild(el('td', { class: 'crucible-score-cell' }));
          sc.appendChild(b);
          if (n.value && n.value.agg) sc.appendChild(el('span', { class: 'crucible-repeat' }, ' ' + fmtScore(n.value.agg.mean) + ' · ' + C.fmtRepeat(n.value.agg)));
          else if (!n.counted) sc.appendChild(D.stateFlag(c.all[0].state));
          var tc = row.appendChild(el('td', {}, dn ? fmtSeconds(dn.time) : NONE));
          if (dn && dn.timedOut) tc.appendChild(el('span', { class: 'crucible-flag' }, 'timed out'));
          row.appendChild(el('td', {}, dn ? fmtCost(dn.cost, local) : NONE));
          row.appendChild(el('td', {}, runsText(n)));
        });
      });
    }

    // ---- Other runs: runs that don't count in this suite ----------------------------------------

    function renderOther(cfgs) {
      var p = $('cm-other');
      var counts = { older: 0, missing: 0, invalid: 0, harness: 0 }, total = 0;
      cfgs.forEach(function (c) {
        total += (S.other[c.key] || []).length;
        counts.missing += (S.other[c.key] || []).length;
        var cells = S.cells[c.key] || {};
        Object.keys(cells).forEach(function (id) {
          cells[id].all.forEach(function (i) {
            if (counts[i.state] !== undefined) { counts[i.state] += 1; total += 1; }
          });
        });
      });
      p.hidden = !total;
      if (!total) return;
      var why = [];
      if (counts.older) why.push(counts.older + ' from an older task version');
      if (counts.missing) why.push(counts.missing + ' of tasks this suite doesn’t list');
      if (counts.harness) why.push(counts.harness + ' through a harness the suite doesn’t score');
      if (counts.invalid) why.push(counts.invalid + ' marked invalid');
      p.textContent = 'Other runs: ' + total + ' run' + (total === 1 ? '' : 's') + ' of this model don’t count in ' + S.name + ' (' + why.join(', ') + '). They aren’t in any score.';
    }

    // ---- Route ----------------------------------------------------------------------------------

    function render(r) {
      route = r;
      S = D.suite(r.params.suite || null);
      D.renderSuiteBar(S);
      results.hidden = false;
      var mr = D.modelRoute(r);
      chartData = null;
      if (mr.level === 'model') {
        if (!mr.bases.length) {
          renderIndex('No model “' + mr.key + '” has results on Crucible. Pick one below.');
          return;
        }
        renderModel(mr);
        return;
      }
      if (mr.level === 'publisher') {
        var maker = null;
        if (!mr.unknownMaker) {
          var makers = D.makers(), id = mr.maker;
          maker = makers.indexOf(id) !== -1 ? id : makers.filter(function (m) { return m.toLowerCase() === id.toLowerCase(); })[0] || null;
          if (!maker) { renderIndex('There is no publisher “' + id + '” in the results. Pick one below.'); return; }
        } else if (!D.basesByMaker(null).length) {
          renderIndex('No model is missing a publisher. Pick one below.');
          return;
        }
        renderPublisher(maker);
        return;
      }
      renderIndex();
    }

    C.onLayoutChange(function () { if (route) render(route); });
    var lastW = window.innerWidth, timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (chartData && !$('model-publisher').hidden) drawChart(); }
      }, 150);
    });
    C.onRoute(render);
  } });
})();
