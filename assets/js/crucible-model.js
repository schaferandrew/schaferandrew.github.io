// Crucible model page (/crucible/model/#<maker>/<model>): one model with all of its setups. Built on
// CrucibleCore; the join, counting rules and stats come from the core's suite and view. A setup is
// picked by its parts (section, quant, reasoning, harness, machine) instead of one long dropdown.
(function () {
  var C = window.CrucibleCore;
  var el = C.el, svg = C.svg, NONE = C.NONE;
  var fmtScore = C.fmtScore, fmtSeconds = C.fmtSeconds, fmtInt = C.fmtInt, fmtCost = C.fmtCost;
  var script = document.currentScript;

  C.boot({ script: script, ready: function (D) {
    var SUITES = D.SUITES;
    var $ = function (id) { return document.getElementById(id); };
    var results = $('crucible-results');
    var ticked = [], tickedFor = null, openAreas = {}, abSlug = null, route = null;

    // The setup's parts. A dimension with one value among a model's setups isn't a choice.
    var DIMS = [
      { id: 'build', label: 'Build', val: function (c) { return C.shortName(c.base); }, quiet: true },
      { id: 'quant', label: 'Quant', val: function (c) { return c.local ? (c.quant || 'not recorded') : 'n/a'; }, quiet: true },
      { id: 'reasoning', label: 'Reasoning', val: function (c) { return c.level; } },
      { id: 'harness', label: 'Harness', val: function (c) { return c.harness; } },
      { id: 'machine', label: 'Machine / provider', val: function (c) { return c.local ? D.hardwareText(c) : 'via ' + (c.provider || 'cloud'); } }
    ];
    function dimVal(d, cfg) { return d.val(cfg); }
    function dimText(d, v) { return d.id === 'reasoning' ? C.cap(v) : v; }

    function go(params, base) {
      var r = route || { id: null, params: {} };
      var merged = { setup: r.params.setup, mode: r.params.mode, suite: r.params.suite };
      Object.keys(params).forEach(function (k) { merged[k] = params[k]; });
      location.hash = C.buildHash(base !== undefined ? base : r.id, merged);
    }

    // ---- Suite bar ----

    function renderSuite(S) {
      var select = $('suite-select');
      select.hidden = SUITES.length < 2;
      $('suite-select-label').hidden = SUITES.length < 2;
      C.fillSelect(select, SUITES.map(function (c) {
        return { value: C.suiteId(c), label: C.suiteName(c) + (c.suite.status === 'current' ? ' (current)' : '') };
      }), S.id);
      var line = $('suite-line');
      line.innerHTML = '';
      var suite = S.cat.suite;
      var active = S.tasks.filter(function (t) { return t.status === 'active'; }).length;
      var parts = [S.name + (suite.version ? ' (version ' + suite.version + ')' : ''), active + ' scored tasks'];
      if (suite.cut_at) parts.push('cut ' + C.fmtDate(suite.cut_at));
      line.appendChild(document.createTextNode(parts.join(' · ')));
      var note = $('suite-note');
      note.textContent = suite.status === 'current' || S.cat === D.CURRENT ? ''
        : 'A past suite: its own tasks, tiers and weights, and only the runs that count in it.';
      note.hidden = !note.textContent;
    }
    $('suite-select').addEventListener('change', function (e) { go({ suite: e.target.value, setup: null, mode: null }); });

    // ---- Index of models ----

    function renderIndex(S, unknownKey) {
      var box = $('model-index');
      box.innerHTML = '';
      $('model-title').textContent = 'Models';
      $('model-breadcrumb').innerHTML = '';
      $('model-breadcrumb').appendChild(el('a', { href: C.BASE }, '← Crucible results'));
      if (unknownKey) {
        box.appendChild(el('p', { class: 'crucible-status' }, 'No model “' + unknownKey + '” has results on Crucible. Pick one below.'));
      } else {
        box.appendChild(el('p', { class: 'crucible-sub' }, 'Every model with results, by the lab that made it. Select a model for all of its setups.'));
      }
      var groups = {}, order = [];
      D.bases().forEach(function (b) {
        var m = D.makerOf(b) || '';
        if (!groups[m]) { groups[m] = []; order.push(m); }
        groups[m].push(b);
      });
      order.sort(function (a, b) { return !a ? 1 : !b ? -1 : a < b ? -1 : 1; });
      order.forEach(function (m) {
        var g = box.appendChild(el('div', { class: 'cm-maker' }));
        var h = g.appendChild(el('h2', { class: 'cm-maker-name' }));
        if (m) h.appendChild(el('a', { href: C.publisherUrl(m) }, D.makerLabel(m)));
        else h.textContent = D.makerLabel(null);
        var ul = g.appendChild(el('ul', { class: 'cm-model-list' }));
        var seen = {};
        groups[m].sort().forEach(function (b) {
          var key = D.modelKey(b);
          if (seen[key]) return;
          seen[key] = true;
          var n = Object.keys(D.CONFIGS).filter(function (k) { return D.modelKey(D.CONFIGS[k].base) === key; }).length;
          var li = ul.appendChild(el('li'));
          li.appendChild(el('a', { href: D.modelUrl(b) }, D.modelLabel(b)));
          li.appendChild(el('span', { class: 'cm-note' }, n + ' setup' + (n === 1 ? '' : 's')));
        });
      });
      box.hidden = false;
      $('model-page').hidden = true;
    }

    // ---- The model ----

    function setupsOf(V, bases) {
      return V.configs().filter(function (c) { return bases.indexOf(c.base) !== -1; }).map(V.stats).filter(function (s) { return s.ran; })
        .sort(V.S.betterConfig);
    }

    // The closest setup that ran with `dim` = value, keeping as many other current choices as possible
    function closest(list, cur, dim, value) {
      var best = null, bestN = -1;
      list.forEach(function (s) {
        if (dimVal(dim, s.cfg) !== value) return;
        var n = DIMS.filter(function (d) { return d !== dim && dimVal(d, s.cfg) === dimVal(d, cur.cfg); }).length;
        if (n > bestN) { best = s; bestN = n; }
      });
      return best;
    }

    function renderModel(S, key, bases) {
      var params = route.params;
      var modeSetups = {}, modes = [];
      S.MODES.forEach(function (m) {
        var list = setupsOf(S.view(m.id), bases);
        if (list.length) { modeSetups[m.id] = list; modes.push(m); }
      });
      var allCfgs = Object.keys(D.CONFIGS).map(function (k) { return D.CONFIGS[k]; }).filter(function (c) { return bases.indexOf(c.base) !== -1; });
      var base0 = bases[0];
      var info = D.makerInfo(base0), maker = info.id;

      // Header
      $('model-title').textContent = D.modelLabel(base0);
      var crumbs = $('model-breadcrumb');
      crumbs.innerHTML = '';
      crumbs.appendChild(el('a', { href: C.BASE }, 'Crucible'));
      crumbs.appendChild(document.createTextNode(' › '));
      if (maker) crumbs.appendChild(el('a', { href: C.publisherUrl(maker) }, D.makerLabel(maker)));
      else crumbs.appendChild(document.createTextNode(D.makerLabel(null)));
      crumbs.appendChild(document.createTextNode(' › '));
      crumbs.appendChild(el('a', { href: C.BASE + 'model/' + C.buildHash(null, { suite: params.suite }) }, 'Models'));
      crumbs.appendChild(document.createTextNode(' › ' + D.modelLabel(base0)));

      var meta = $('model-meta');
      meta.innerHTML = '';
      var by = meta.appendChild(el('span', {}, 'By '));
      if (maker) by.appendChild(el('a', { href: C.publisherUrl(maker) }, D.makerLabel(maker)));
      else by.appendChild(document.createTextNode(D.makerLabel(null)));
      if (info.inferred && maker) by.appendChild(el('span', { class: 'cm-inferred', title: 'Taken from the model name; the runs didn’t record who made it.' }, ' inferred'));
      var locals = allCfgs.filter(function (c) { return c.local; }).length;
      meta.appendChild(el('span', {}, locals === allCfgs.length ? 'Local' : locals ? 'Local and cloud' : 'Cloud'));
      meta.appendChild(el('span', {}, allCfgs.length + ' setup' + (allCfgs.length === 1 ? '' : 's')));
      var machines = [];
      allCfgs.forEach(function (c) { var t = c.local ? D.hardwareText(c) : 'via ' + (c.provider || 'cloud'); if (machines.indexOf(t) === -1) machines.push(t); });
      meta.appendChild(el('span', {}, 'Runs on ' + machines.join('; ')));
      if (modes.length) meta.appendChild(el('span', {}, modes.map(function (m) { return m.label; }).join(' and ')));

      renderOther(S, allCfgs);
      var empty = $('model-empty');
      $('model-body').hidden = !modes.length;
      empty.hidden = !!modes.length;
      if (!modes.length) {
        empty.textContent = 'No run of this model counts in ' + S.name + ' yet.';
        return;
      }

      // Selected section and setup
      var selSlug = params.setup && D.configBySlug(params.setup);
      var mode = params.mode && modeSetups[params.mode] ? params.mode : null;
      if (!mode && selSlug) {
        modes.some(function (m) { if (modeSetups[m.id].some(function (s) { return s.cfg === selSlug; })) { mode = m.id; return true; } });
      }
      mode = mode || modes[0].id;
      var V = S.view(mode), list = modeSetups[mode];
      var sel = list.filter(function (s) { return s.cfg === selSlug; })[0] || list[0];
      if (tickedFor !== key + '|' + S.id + '|' + mode) { ticked = []; tickedFor = key + '|' + S.id + '|' + mode; }

      renderPicker(S, V, modes, mode, list, sel);
      renderTiles(S, V, sel);
      renderSetups(S, V, list, sel);
      renderAreas(S, V, sel);
      renderAB(S, V, list, sel);
      renderTasks(S, V, sel);
    }

    // ---- Setup picker ----

    function renderPicker(S, V, modes, mode, list, sel) {
      var box = $('model-picker');
      box.innerHTML = '';
      if (modes.length > 1) {
        var row = box.appendChild(el('div', { class: 'cm-chiprow', role: 'group', 'aria-label': 'Section' }));
        row.appendChild(el('span', { class: 'cm-chiplabel' }, 'Section'));
        modes.forEach(function (m) {
          var b = row.appendChild(el('button', { type: 'button', class: 'cm-chip', 'aria-pressed': m.id === mode }, m.label));
          b.addEventListener('click', function () { go({ mode: m.id, setup: null }); });
        });
      } else {
        var one = box.appendChild(el('div', { class: 'cm-chiprow' }));
        one.appendChild(el('span', { class: 'cm-chiplabel' }, 'Section'));
        one.appendChild(el('span', { class: 'cm-chipplain' }, modes[0].label));
      }
      DIMS.forEach(function (d) {
        var values = [];
        list.forEach(function (s) { var v = dimVal(d, s.cfg); if (values.indexOf(v) === -1) values.push(v); });
        var row = el('div', { class: 'cm-chiprow', role: 'group', 'aria-label': d.label });
        row.appendChild(el('span', { class: 'cm-chiplabel' }, d.label));
        if (values.length < 2) {
          if (d.quiet && (values[0] === 'n/a' || d.id === 'build')) return;
          row.appendChild(el('span', { class: 'cm-chipplain' }, dimText(d, values[0])));
          box.appendChild(row);
          return;
        }
        values.sort();
        values.forEach(function (v) {
          var exact = list.some(function (s) {
            return dimVal(d, s.cfg) === v && DIMS.every(function (o) { return o === d || dimVal(o, s.cfg) === dimVal(o, sel.cfg); });
          });
          var pressed = dimVal(d, sel.cfg) === v;
          var b = row.appendChild(el('button', { type: 'button', class: 'cm-chip' + (exact ? '' : ' is-dashed'), 'aria-pressed': pressed,
            title: exact ? '' : 'No setup ran with this alongside your other choices; selects the nearest one' }, dimText(d, v)));
          b.addEventListener('click', function () {
            var t = closest(list, sel, d, v);
            if (t) go({ setup: t.cfg.slug, mode: mode });
          });
        });
        box.appendChild(row);
      });
    }

    // ---- Tiles ----

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

    function renderTiles(S, V, s) {
      var box = $('model-tiles');
      box.innerHTML = '';
      var head = V.head(), r = s.tier[head.id];
      var sub = r ? r.scored + ' of ' + r.total + ' tasks' + (r.partial ? ' (partial)' : '') : 'no scored task';
      tile(box, head.label, r && r.score !== null ? fmtScore(r.score) : NONE, sub);
      V.TIERS.forEach(function (t) {
        if (t.id === head.id) return;
        var res = s.tier[t.id];
        if (S.gateOf(t.id)) {
          tile(box, t.label + ' gate', verdictNode(s.verdict[t.id]), res && res.score !== null ? 'score ' + fmtScore(res.score) + ' · ' + res.scored + ' of ' + res.total + ' tasks' : 'no scored task');
        } else if (res) {
          tile(box, t.label, res.score !== null ? fmtScore(res.score) : NONE, res.scored + ' of ' + res.total + ' tasks' + (res.partial ? ' (partial)' : ''));
        }
      });
      var behind = !C.meets(s.progress.share, S.COVERAGE_MIN);
      tile(box, 'Coverage', s.progress.done + ' of ' + s.progress.total, behind ? 'in progress: under ' + C.pct(S.COVERAGE_MIN) + ' of the tasks' : C.pct(s.progress.share) + ' of the tasks');
      tile(box, 'Median time per task', fmtSeconds(s.time), s.cost !== null && s.cost !== undefined ? (s.local ? 'electricity ' : 'cost ') + D.costLabel(s) + ' per run' : 'cost not recorded', D.costTitle(s));
    }

    // ---- Every setup ----

    function covNode(s, S) {
      var low = !C.meets(s.progress.share, S.COVERAGE_MIN);
      var w = el('span', { class: 'cm-cov' });
      w.appendChild(el('span', {}, s.progress.done + '/' + s.progress.total));
      var bar = w.appendChild(el('span', { class: 'cm-cov-bar' }));
      var fill = bar.appendChild(el('span', { class: 'cm-cov-fill' + (low ? ' is-low' : '') }));
      fill.style.width = Math.round(s.progress.share * 100) + '%';
      if (low) w.appendChild(el('span', { class: 'cm-note' }, 'in progress'));
      return w;
    }
    function varyingDims(list) {
      return DIMS.filter(function (d) {
        var seen = {};
        list.forEach(function (s) { seen[dimVal(d, s.cfg)] = true; });
        return Object.keys(seen).length > 1;
      });
    }

    function renderSetups(S, V, list, sel) {
      var dims = varyingDims(list);
      $('setups-sub').textContent = list.length + ' setup' + (list.length === 1 ? '' : 's') + ' ran in this section. Select a row to look at that setup; tick two to four to compare them.';
      var table = $('cm-setups');
      table.innerHTML = '';
      var box = $('cm-setups-narrow');
      box.innerHTML = '';
      var head = el('tr');
      head.appendChild(el('th', { scope: 'col' }, ''));
      ['Coverage'].concat(dims.length ? dims.map(function (d) { return d.label; }) : ['Setup'], V.TIERS.map(function (t) { return t.label; }), ['Median time'])
        .forEach(function (c) { head.appendChild(el('th', { scope: 'col' }, c)); });
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      function setLabel(s, d) { return dimText(d, dimVal(d, s.cfg)); }
      function tick(s) {
        var td = el('span');
        var cb = td.appendChild(el('input', { type: 'checkbox', 'aria-label': 'Compare ' + C.shortName(s.cfg.base) + ' ' + D.configLabel(s.cfg) }));
        cb.checked = ticked.indexOf(s.cfg.slug) !== -1;
        cb.disabled = !cb.checked && ticked.length >= C.MAX_COMPARE;
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () {
          var i = ticked.indexOf(s.cfg.slug);
          if (cb.checked && i === -1) ticked.push(s.cfg.slug); else if (i !== -1) ticked.splice(i, 1);
          renderSetups(S, V, list, sel);
        });
        return td;
      }
      list.forEach(function (s) {
        var tr = body.appendChild(el('tr', { class: 'crucible-row' + (s === sel ? ' is-selected' : ''), 'aria-selected': s === sel }));
        var pick = function () { go({ setup: s.cfg.slug, mode: V.mode }); };
        tr.addEventListener('click', pick);
        tr.appendChild(el('td')).appendChild(tick(s));
        tr.appendChild(el('td')).appendChild(covNode(s, S));
        if (dims.length) dims.forEach(function (d) { tr.appendChild(el('td', {}, setLabel(s, d))); });
        else tr.appendChild(el('td', {}, D.configLabel(s.cfg)));
        V.TIERS.forEach(function (t) { S.tierCell(s, t, tr.appendChild(el('td'))); });
        tr.appendChild(el('td', {}, fmtSeconds(s.time)));
      });
      // Narrow: a card per setup
      var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
      list.forEach(function (s) {
        var li = ul.appendChild(el('li', { class: 'crucible-card' + (s === sel ? ' is-selected' : '') }));
        var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
        var b = title.appendChild(el('button', { type: 'button', class: 'crucible-link-button', 'aria-pressed': s === sel }, dims.length ? dims.map(function (d) { return setLabel(s, d); }).join(' · ') : D.configLabel(s.cfg)));
        b.addEventListener('click', function () { go({ setup: s.cfg.slug, mode: V.mode }); });
        if (s === sel) title.appendChild(el('span', { class: 'crucible-tag' }, 'selected'));
        var cov = li.appendChild(el('div', { class: 'cm-card-cov' }));
        cov.appendChild(covNode(s, S));
        V.TIERS.forEach(function (t) {
          var v = el('span', { class: 'crucible-kv-value' });
          S.tierCell(s, t, v);
          C.kvRow(li, t.label, v);
        });
        C.kvRow(li, 'Median time', fmtSeconds(s.time));
        var lab = li.appendChild(el('label', { class: 'cm-card-check' }));
        var cb = lab.appendChild(el('input', { type: 'checkbox' }));
        cb.checked = ticked.indexOf(s.cfg.slug) !== -1;
        cb.disabled = !cb.checked && ticked.length >= C.MAX_COMPARE;
        lab.appendChild(document.createTextNode('Compare'));
        cb.addEventListener('change', function () {
          var i = ticked.indexOf(s.cfg.slug);
          if (cb.checked && i === -1) ticked.push(s.cfg.slug); else if (i !== -1) ticked.splice(i, 1);
          renderSetups(S, V, list, sel);
        });
      });
      C.applyLayout(['cm-setups', 'cm-tasks']);
      var bar = $('cm-compare-bar');
      bar.innerHTML = '';
      var ok = ticked.length >= 2 && ticked.length <= C.MAX_COMPARE;
      if (ok) bar.appendChild(el('a', { class: 'cm-compare-go', href: C.compareUrl(ticked) }, 'Compare ' + ticked.length + ' setups →'));
      else bar.appendChild(el('span', { class: 'cm-compare-go is-off', 'aria-disabled': 'true' }, 'Compare ' + (ticked.length ? ticked.length + ' setup' + (ticked.length === 1 ? '' : 's') : 'setups') + ' →'));
      bar.appendChild(el('span', { class: 'cm-note' }, ok ? '' : 'Tick two to ' + C.MAX_COMPARE + ' setups.'));
    }

    // ---- By area ----

    function renderAreas(S, V, s) {
      var box = $('cm-areas');
      box.innerHTML = '';
      V.info.areas.forEach(function (area) {
        var r = V.areaResult(s.cfg, area);
        if (!r.tasks.length) return;
        var none = r.n === 0;
        var row = box.appendChild(el('div', { class: 'cm-area' + (none ? ' is-none' : '') }));
        row.appendChild(el('span', { class: 'cm-area-name' }, area.label));
        var track = row.appendChild(el('span', { class: 'cm-area-track' }));
        if (!none) track.appendChild(el('span', { class: 'cm-area-fill' })).style.width = (r.score * 10) + '%';
        row.appendChild(el('span', { class: 'cm-area-val' }, none ? 'not run' : fmtScore(r.score) + ' · ran ' + r.n + ' of ' + r.tasks.length));
        if (none) row.querySelector('.cm-area-val').textContent = r.tasks.some(function (t) { return S.cellOf(s.cfg, t.id); }) ? 'none of its runs count' : 'not run';
      });
    }

    // ---- A/B: the same setup but for one dimension ----

    function renderAB(S, V, list, sel) {
      var sec = $('cm-ab');
      var found = [];
      list.forEach(function (o) {
        if (o === sel) return;
        var diff = DIMS.filter(function (d) { return dimVal(d, o.cfg) !== dimVal(d, sel.cfg); });
        if (diff.length !== 1) return;
        var shared = V.orderedTasks.filter(function (t) { return S.countedMean(sel.cfg, t.id) !== null && S.countedMean(o.cfg, t.id) !== null; });
        if (shared.length) found.push({ s: o, dim: diff[0], shared: shared });
      });
      sec.hidden = !found.length;
      if (!found.length) return;
      var cur = found.filter(function (f) { return f.s.cfg.slug === abSlug; })[0] || found[0];
      abSlug = cur.s.cfg.slug;
      var pick = $('cm-ab-pick');
      pick.innerHTML = '';
      if (found.length > 1) {
        pick.appendChild(el('span', { class: 'crucible-toolbar-label' }, 'Compare'));
        var seg = pick.appendChild(el('div', { class: 'crucible-segmented', role: 'radiogroup', 'aria-label': 'Which setup to compare' }));
        C.segmented(seg, found.map(function (f) {
          return { value: f.s.cfg.slug, label: f.dim.label + ': ' + dimText(f.dim, dimVal(f.dim, f.s.cfg)) };
        }), abSlug, function (v) { abSlug = v; renderAB(S, V, list, sel); });
      }
      var d = cur.dim, aText = dimText(d, dimVal(d, sel.cfg)), bText = dimText(d, dimVal(d, cur.s.cfg));
      $('cm-ab-heading').textContent = 'A/B: ' + d.label.toLowerCase() + ' ' + aText + ' or ' + bText;
      $('cm-ab-sub').textContent = 'The same setup but for its ' + d.label.toLowerCase() + ', on the ' + cur.shared.length + ' task' + (cur.shared.length === 1 ? '' : 's') + ' both ran. Score per task, 0–10.';
      var cA = '#1856a3', cB = '#eb6834';
      var box = $('cm-db');
      box.innerHTML = '';
      var W = 300, pad = 8, x = function (v) { return pad + v / 10 * (W - 2 * pad); };
      cur.shared.forEach(function (t) {
        var a = S.countedMean(sel.cfg, t.id), b = S.countedMean(cur.s.cfg, t.id);
        var row = box.appendChild(el('div', { class: 'cm-db-row' }));
        row.appendChild(el('a', { class: 'cm-db-name', href: C.taskUrl(t.id), title: C.taskName(t) }, C.taskName(t)));
        var g = svg('svg', { viewBox: '0 0 ' + W + ' 20', role: 'img', 'aria-label': C.taskName(t) + ': ' + aText + ' ' + fmtScore(a) + ', ' + bText + ' ' + fmtScore(b) });
        g.appendChild(svg('line', { x1: x(0), x2: x(10), y1: 10, y2: 10, stroke: '#e3e3e8', 'stroke-width': 1 }));
        g.appendChild(svg('line', { x1: x(a), x2: x(b), y1: 10, y2: 10, stroke: '#8a8794', 'stroke-width': 2 }));
        g.appendChild(svg('circle', { cx: x(a), cy: 10, r: 5, fill: cA }, undefined)).appendChild(svg('title', {}, aText + ': ' + fmtScore(a)));
        g.appendChild(svg('circle', { cx: x(b), cy: 10, r: 5, fill: cB })).appendChild(svg('title', {}, bText + ': ' + fmtScore(b)));
        row.appendChild(g);
      });
      var axis = box.appendChild(el('div', { class: 'cm-db-row' }));
      axis.appendChild(el('span'));
      var ag = svg('svg', { viewBox: '0 0 ' + W + ' 14', 'aria-hidden': 'true', class: 'cm-db-axis' });
      [0, 5, 10].forEach(function (v) { ag.appendChild(svg('text', { x: x(v), y: 11, 'text-anchor': v === 0 ? 'start' : v === 10 ? 'end' : 'middle' }, String(v))); });
      axis.appendChild(ag);
      var legend = $('cm-db-legend');
      legend.innerHTML = '';
      [[cA, aText + ' (selected)'], [cB, bText]].forEach(function (p) {
        var sp = legend.appendChild(el('span'));
        sp.appendChild(el('span', { class: 'cm-dot' })).style.background = p[0];
        sp.appendChild(document.createTextNode(p[1]));
      });
      // One line: the mean score difference and the median time ratio over the shared tasks
      var diffs = cur.shared.map(function (t) { return S.countedMean(cur.s.cfg, t.id) - S.countedMean(sel.cfg, t.id); });
      var dm = C.mean(diffs);
      var ratios = cur.shared.map(function (t) {
        var ta = D.cellNumbers(S.cellOf(sel.cfg, t.id)).time, tb = D.cellNumbers(S.cellOf(cur.s.cfg, t.id)).time;
        return ta && tb ? tb / ta : null;
      });
      var rm = C.median(ratios);
      var text = 'With ' + d.label.toLowerCase() + ' ' + bText + ' it ' + (Math.abs(dm) < 0.05 ? 'scores the same' : 'scores ' + Math.abs(dm).toFixed(1) + (dm > 0 ? ' higher' : ' lower')) + ' on average';
      if (rm !== null) {
        var f = rm >= 1 ? rm : 1 / rm;
        text += ' and ' + (f < 1.05 ? 'runs at about the same speed' : 'runs ' + (f < 10 ? f.toFixed(1) : Math.round(f)) + '× ' + (rm > 1 ? 'slower' : 'faster')) +
          ' (median time ' + fmtSeconds(C.median(cur.shared.map(function (t) { return D.cellNumbers(S.cellOf(cur.s.cfg, t.id)).time; }))) + ' against ' +
          fmtSeconds(C.median(cur.shared.map(function (t) { return D.cellNumbers(S.cellOf(sel.cfg, t.id)).time; }))) + ')';
      }
      $('cm-ab-summary').textContent = text + '.';
    }

    // ---- Tasks (compact copy of the main page's renderTasks: should move to core) ----

    function areaToggle(S, area, tasks, cfg, key, open, rerender) {
      var values = tasks.map(function (t) { return D.cellValue(S.cellOf(cfg, t.id)); });
      var ran = tasks.filter(function (t) { return S.cellOf(cfg, t.id); }).length;
      var avg = C.mean(values.map(function (v) { return v && v.agg ? v.agg.mean : null; }));
      var button = el('button', { type: 'button', class: 'crucible-area-toggle', 'aria-expanded': open });
      button.appendChild(el('span', { class: 'crucible-area-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'));
      button.appendChild(el('span', { class: 'crucible-area-name' }, area.label));
      var chip = el('span', { class: 'crucible-area-score' }, avg === null ? NONE : (C.isNarrow() ? 'mean ' : '') + fmtScore(avg));
      if (avg !== null) chip.setAttribute('style', C.heatStyle(avg));
      button.appendChild(chip);
      button.appendChild(el('span', { class: 'crucible-area-count' }, ran + '/' + tasks.length + ' run'));
      button.addEventListener('click', function () { openAreas[key] = !open; rerender(); });
      return button;
    }

    function renderTasks(S, V, s) {
      var table = $('cm-tasks'), narrow = $('cm-tasks-narrow');
      table.innerHTML = '';
      narrow.innerHTML = '';
      $('cm-cell-detail').hidden = true;
      var panel = $('cm-cell-detail');
      var sObj = { label: C.shortName(s.cfg.base), cfg: s.cfg };
      var tierIx = V.tiers;
      var groups = V.info.areas.map(function (a) {
        var list = V.orderedTasks.filter(function (t) { return t.area === a.id; });
        list.sort(function (x, y) { return tierIx.indexOf(x.tier) - tierIx.indexOf(y.tier); });
        return { area: a, tasks: list, key: V.mode + ':' + a.id };
      }).filter(function (g) { return g.tasks.length; });
      function open(t, c) { D.showCellDetail(panel, S, sObj, t, c); panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      var rerender = function () { renderTasks(S, V, s); };
      if (C.isNarrow()) {
        groups.forEach(function (g) {
          var isOpen = !!openAreas[g.key];
          var group = narrow.appendChild(el('div', { class: 'crucible-area-narrow' + (isOpen ? ' is-open' : '') }));
          group.appendChild(areaToggle(S, g.area, g.tasks, s.cfg, g.key, isOpen, rerender));
          if (!isOpen) return;
          var ul = group.appendChild(el('ul', { class: 'crucible-cards' }));
          g.tasks.forEach(function (t) {
            var c = S.cellOf(s.cfg, t.id), n = D.cellNumbers(c);
            var li = ul.appendChild(el('li', { class: 'crucible-card' + (c ? '' : ' is-not-run') }));
            var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
            title.appendChild(el('a', { class: 'crucible-test-id', href: C.taskUrl(t.id) }, C.taskName(t)));
            title.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, S.tierLabel(t.tier)));
            if (!c) { li.appendChild(el('p', { class: 'crucible-not-run' }, 'not run')); return; }
            var b = D.cellButton(sObj, t, c, true);
            b.addEventListener('click', function () { open(t, c); });
            C.kvRow(li, 'Score', b);
            C.kvRow(li, 'Time', fmtSeconds(n.time));
            C.kvRow(li, 'Cost', fmtCost(n.cost, s.local));
            C.kvRow(li, 'Runs', String(n.runs));
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
        gr.appendChild(el('th', { colspan: columns.length, scope: 'rowgroup' })).appendChild(areaToggle(S, g.area, g.tasks, s.cfg, g.key, isOpen, rerender));
        if (!isOpen) return;
        g.tasks.forEach(function (t) {
          var c = S.cellOf(s.cfg, t.id);
          var row = body.appendChild(el('tr', { class: 'crucible-row' + (c ? '' : ' is-not-run') }));
          var name = row.appendChild(el('th', { scope: 'row' }));
          name.appendChild(el('a', { class: 'crucible-test-id', href: C.taskUrl(t.id) }, C.taskName(t)));
          name.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, S.tierLabel(t.tier)));
          if (!c) { row.appendChild(el('td', { colspan: columns.length - 1, class: 'crucible-not-run' }, 'not run')); return; }
          var n = D.cellNumbers(c);
          var b = D.cellButton(sObj, t, c, false);
          b.addEventListener('click', function () { open(t, c); });
          var sc = row.appendChild(el('td', { class: 'crucible-score-cell' }));
          sc.appendChild(b);
          if (n.value && n.value.agg) sc.appendChild(el('span', { class: 'crucible-repeat' }, ' ' + fmtScore(n.value.agg.mean) + ' · ' + C.fmtRepeat(n.value.agg)));
          var tc = row.appendChild(el('td', {}, fmtSeconds(n.time)));
          if (n.timedOut) tc.appendChild(el('span', { class: 'crucible-flag' }, 'timed out'));
          row.appendChild(el('td', {}, fmtCost(n.cost, s.local)));
          row.appendChild(el('td', {}, String(n.runs)));
        });
      });
    }

    // ---- Other runs: runs that don't count in this suite ----

    function renderOther(S, cfgs) {
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

    // ---- Route ----

    function render(r) {
      route = r;
      var S = D.suite(r.params.suite || null);
      renderSuite(S);
      results.hidden = false;
      var key = r.id;
      var bases = key ? D.basesOf(key) : [];
      document.title = bases.length ? D.modelLabel(bases[0]) + ' · Crucible' : 'Crucible models';
      if (!bases.length) {
        renderIndex(S, key);
        return;
      }
      $('model-index').hidden = true;
      $('model-page').hidden = false;
      renderModel(S, key, bases);
    }
    C.onLayoutChange(function () { if (route) render(route); });
    C.onRoute(render);

  } });
})();
