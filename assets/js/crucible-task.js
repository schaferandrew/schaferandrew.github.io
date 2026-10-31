// Crucible task page: /crucible/task/#<task-id>[&suite=<id>][&provisional=1]. With no id, an index of
// the selected suite's tasks. Everything comes from the catalog and the joined records in crucible-core.js.
(function () {
  var C = window.CrucibleCore;
  if (!C) return;
  var el = C.el, svg = C.svg, COLORS = C.COLORS, NONE = C.NONE;
  var fmtScore = C.fmtScore, fmtSeconds = C.fmtSeconds, fmtInt = C.fmtInt, fmtUsd = C.fmtUsd;
  var mean = C.mean, median = C.median, num = C.num, cap = C.cap;
  var script = document.currentScript;
  var D, S, route, task, entries, detailsIndex = null, detailsState = 'idle';
  var state = { showAll: false, measure: 'time', openCfg: null };
  var EPS = 1e-9;

  // ---- Small helpers ------------------------------------------------------

  function isProv(t) { return t.status !== 'active' && t.status !== 'retired'; }
  function showProv() { return route.params.provisional === '1'; }
  function hashFor(id, over) { return C.hashFor(id, over, ['suite', 'provisional']); }
  function taskHref(id) { return C.BASE + 'task/' + hashFor(id); }
  function link(href, text, cls) { return el('a', { href: href, class: cls || '' }, text); }
  function areaLabel(t) {
    var a = S.modeInfo(t.mode).areas.filter(function (x) { return x.id === t.area; })[0];
    return a ? a.label : t.area ? cap(t.area) : '';
  }
  function methodLabel(m) {
    var f = ((D.FB || {}).scoring_methods || {})[m];
    return (f && f.label) || m || 'unknown method';
  }
  function suiteLabel(v) { var s = String(v); return /^v/i.test(s) ? s : 'v' + s; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function fmtTokens(v) {
    if (v === null || v === undefined) return NONE;
    return v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
  }
  function costText(e) { return C.fmtCost(e.cost, e.cfg.local); }
  function scoreButton(e) {
    return C.scoreButton(e.mean, e.label + ' ' + fmtScore(e.mean) + ', open its runs', { cls: 'crucible-task-score', n: e.runs.length });
  }
  function makerNode(cfg) { return D.makerNode(cfg, { unknown: true }); }
  // The model's name alone: the setup column names the reasoning level
  function modelLink(cfg) { return D.modelLink({ cfg: cfg, label: C.shortName(cfg.base) }); }

  // ---- Numbers --------------------------------------------------------------

  // One entry per setup: the runs that count (for a provisional task, its provisional runs)
  function buildEntries(t) {
    var prov = isProv(t), out = [];
    S.taskCells(t.id).forEach(function (tc) {
      var runs = prov ? tc.cell.provisional : tc.cell.counted;
      if (!runs.length) return;
      out.push({
        cfg: tc.cfg, cell: tc.cell, runs: runs, label: D.rowLabel(tc.cfg), model: D.modelKey(tc.cfg),
        mean: mean(runs.map(function (i) { return i.score; })),
        time: median(runs.map(function (i) { return num(i.run.elapsed_s, null); })),
        tokens: median(runs.map(function (i) { return num((i.run.metrics || {}).tokens_out, null); })),
        cost: mean(runs.map(function (i) { return D.runCost(i.run); })),
        latest: runs[0]
      });
    });
    out.sort(byScore);
    return out;
  }
  function byScore(a, b) {
    if (a.mean !== b.mean) return b.mean - a.mean;
    var ta = a.time === null ? Infinity : a.time, tb = b.time === null ? Infinity : b.time;
    return ta - tb;
  }
  // Each model's best setup is the leaderboard's: the core's S.betterConfig on the setups' section
  // stats (the overall score), among the setups that ran this task; then ranked by score here
  function bestPerModel(list) {
    var V = S.view(task.mode), by = {}, order = [];
    list.forEach(function (e) {
      if (!by[e.model]) { by[e.model] = []; order.push(e.model); }
      by[e.model].push(e);
    });
    return order.map(function (k) {
      return by[k].slice().sort(function (a, b) { return S.betterConfig(V.stats(a.cfg), V.stats(b.cfg)) || byScore(a, b); })[0];
    }).sort(byScore);
  }

  // Per-check results of one run, grouped (core's D.runGroups); null until details.json loads
  function runGroups(info) { return D.runGroups(detailsIndex, info); }
  function checkStats() {
    var by = {}, order = [];
    entries.forEach(function (e) {
      e.runs.forEach(function (info) {
        var g = runGroups(info);
        if (!g) return;
        g.order.forEach(function (k) {
          if (!by[k]) { by[k] = { key: k, title: g.titles[k], values: [], full: 0 }; order.push(k); }
          by[k].values.push(g.values[k]);
          if (g.values[k] + EPS >= 1) by[k].full += 1;
        });
      });
    });
    // The catalog's criteria order when its labels match the groups, else first seen
    var crit = (task.criteria || []).map(function (c) { return c.id || c.label; });
    order.sort(function (a, b) {
      var ia = crit.indexOf(a), ib = crit.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
    });
    return order.map(function (k) { by[k].rate = mean(by[k].values); by[k].n = by[k].values.length; return by[k]; });
  }
  // Check columns for the performers: the groups seen in the shown setups' latest runs
  function checkColumns() {
    return detailsIndex ? checkStats().map(function (s) { return s.key; }) : [];
  }

  // ---- Page shell -----------------------------------------------------------

  var body;
  function section(title, sub, id) {
    var wrap = el('section', { class: 'crucible-task-section' });
    if (id) wrap.id = id;
    wrap.appendChild(el('h2', { class: 'crucible-heading' }, title));
    if (sub) wrap.appendChild(el('p', { class: 'crucible-sub' }, sub));
    body.appendChild(wrap);
    return wrap;
  }
  function note(text, cls) { return el('p', { class: 'crucible-sub crucible-task-note ' + (cls || '') }, text); }

  function renderSuite() {
    D.renderSuiteBar(S);
    var box = document.getElementById('provisional-toggle');
    box.checked = showProv();
    var hiddenProv = S.tasks.filter(isProv).length;
    document.getElementById('provisional-note').textContent = showProv() ? 'Provisional tasks are listed and marked; they never count toward any score.'
      : hiddenProv ? hiddenProv + ' provisional ' + (hiddenProv === 1 ? 'task is' : 'tasks are') + ' hidden.' : '';
  }

  // ---- Index ----------------------------------------------------------------

  function renderIndex() {
    document.getElementById('task-title').textContent = 'Crucible tasks';
    document.title = 'Crucible tasks';
    C.breadcrumb(document.getElementById('task-crumbs'), ['Tasks']);
    var shown = S.tasks.filter(function (t) { return t.status === 'active' || (isProv(t) && showProv()); });
    if (!shown.length) { body.appendChild(note('This suite has no tasks to list.')); return; }
    body.appendChild(note('Every task of ' + S.name + ', by section and area. Select one for what it asks, how it is scored and how the models did.'));
    var tierPos = {};
    S.TIERS.forEach(function (t, i) { tierPos[t.id] = i; });
    S.MODES.forEach(function (m) {
      var inMode = shown.filter(function (t) { return t.mode === m.id; });
      if (!inMode.length) return;
      var head = el('h2', { class: 'crucible-heading' }, m.label + ' ');
      head.appendChild(el('small', { class: 'crucible-task-count' }, plural(inMode.length, 'task')));
      body.appendChild(head);
      if (m.blurb) body.appendChild(el('p', { class: 'crucible-sub' }, cap(m.blurb)));
      m.areas.forEach(function (a) {
        var list = inMode.filter(function (t) { return t.area === a.id; });
        if (!list.length) return;
        list.sort(function (x, y) { return (tierPos[x.tier] || 0) - (tierPos[y.tier] || 0) || C.taskName(x).localeCompare(C.taskName(y)); });
        body.appendChild(el('h3', { class: 'crucible-task-area' }, a.label));
        var ul = body.appendChild(el('ul', { class: 'crucible-task-list' }));
        list.forEach(function (t) {
          var li = ul.appendChild(el('li', { class: 'crucible-task-item' }));
          var top = li.appendChild(el('div', { class: 'crucible-task-item-top' }));
          top.appendChild(link(taskHref(t.id), C.taskName(t), 'crucible-task-link'));
          top.appendChild(el('span', { class: 'crucible-tag crucible-task-tier' }, S.tierLabel(t.tier)));
          if (isProv(t)) top.appendChild(el('span', { class: 'crucible-tag crucible-task-prov' }, 'Provisional'));
          if (t.summary) li.appendChild(el('p', { class: 'crucible-task-summary' }, t.summary.split('\n')[0]));
        });
      });
    });
  }

  // ---- Messages -------------------------------------------------------------

  function renderMissing(id) {
    document.getElementById('task-title').textContent = 'Task not found';
    document.title = 'Task not found · Crucible';
    var others = D.SUITES.filter(function (c) { return D.suite(D.suiteId(c)) !== S && D.suite(D.suiteId(c)).task(id); });
    body.appendChild(note('There is no task called “' + id + '” in ' + S.name + '.', 'crucible-task-big'));
    if (others.length) {
      var p = body.appendChild(el('p', { class: 'crucible-sub' }, 'It exists in: '));
      others.forEach(function (c, i) {
        if (i) p.appendChild(document.createTextNode(', '));
        p.appendChild(link(C.BASE + 'task/' + C.buildHash(id, { suite: D.suiteId(c), provisional: showProv() ? '1' : null }), D.suiteName(c)));
      });
      p.appendChild(document.createTextNode('.'));
    }
    var q = id.toLowerCase(), like = S.tasks.filter(function (t) {
      return (t.status === 'active' || (isProv(t) && showProv())) && (t.id.indexOf(q) !== -1 || C.taskName(t).toLowerCase().indexOf(q) !== -1);
    }).slice(0, 5);
    if (like.length) {
      var ul = body.appendChild(el('ul', { class: 'crucible-task-list' }));
      like.forEach(function (t) { ul.appendChild(el('li', { class: 'crucible-task-item' })).appendChild(link(taskHref(t.id), C.taskName(t), 'crucible-task-link')); });
    }
    body.appendChild(el('p', { class: 'crucible-sub' })).appendChild(link(C.BASE + 'task/' + hashFor(null), 'See all tasks'));
  }

  function renderStub(t, text, button) {
    document.getElementById('task-title').textContent = C.taskName(t);
    document.title = C.taskName(t) + ' · Crucible';
    body.appendChild(note(text, 'crucible-task-big'));
    if (button) {
      var b = body.appendChild(el('button', { type: 'button', class: 'crucible-segment crucible-task-action' }, 'Show provisional tasks'));
      b.addEventListener('click', function () { location.hash = hashFor(t.id, { provisional: '1' }); });
    }
    body.appendChild(el('p', { class: 'crucible-sub' })).appendChild(link(C.BASE + 'task/' + hashFor(null), 'See all tasks'));
  }

  // ---- 1 Header -------------------------------------------------------------

  function renderHeader(t) {
    var m = S.modeInfo(t.mode);
    document.getElementById('task-title').textContent = C.taskName(t);
    document.title = C.taskName(t) + ' · Crucible';
    C.breadcrumb(document.getElementById('task-crumbs'), [{ href: C.BASE + 'task/' + hashFor(null), text: 'Tasks' }, C.taskName(t)]);

    var head = el('header', { class: 'crucible-task-head' });
    var pills = head.appendChild(el('div', { class: 'crucible-task-pills' }));
    pills.appendChild(el('span', { class: 'crucible-tag crucible-task-tier' }, S.tierLabel(t.tier)));
    pills.appendChild(el('span', { class: 'crucible-tag' }, [m.label || cap(t.mode || ''), areaLabel(t)].filter(Boolean).join(' · ')));
    if (m.harnesses && m.harnesses.length) pills.appendChild(el('span', { class: 'crucible-tag' }, m.harnesses.join(' / ')));
    if (isProv(t)) pills.appendChild(el('span', { class: 'crucible-tag crucible-task-prov' }, 'Provisional'));
    var sc = t.scoring && typeof t.scoring === 'object' ? t.scoring : {};
    var meta = [];
    meta.push('Scored by ' + methodLabel(t.scoring_method) + (typeof sc.total === 'number' ? ', ' + fmtInt(sc.total) + ' ' + (sc.unit || 'points') : ''));
    meta.push('Task v' + (t.version === undefined || t.version === null ? '?' : t.version) + (t.rubric_version !== undefined && t.rubric_version !== null ? ' · rubric v' + t.rubric_version : ''));
    if (t.aliases && t.aliases.length) meta.push('Formerly ' + t.aliases.join(', '));
    if (t.added_in) meta.push('Added in suite ' + suiteLabel(t.added_in));
    var ul = head.appendChild(el('ul', { class: 'crucible-task-meta' }));
    meta.forEach(function (x) { ul.appendChild(el('li', {}, x)); });
    body.appendChild(head);
    if (isProv(t)) {
      body.appendChild(el('p', { class: 'crucible-task-provnote' }, 'Provisional: not scored in this suite yet. Its runs are shown here only; they never count toward any score or ranking.'));
    }
  }

  // ---- 2 Tiles --------------------------------------------------------------

  function tile(key, value, detail, extra) {
    var d = el('div', { class: 'crucible-task-tile' });
    d.appendChild(el('span', { class: 'crucible-task-tile-k' }, key));
    var vEl = d.appendChild(el('span', { class: 'crucible-task-tile-v' }));
    if (typeof value === 'string') vEl.textContent = value; else vEl.appendChild(value);
    if (detail) d.appendChild(el('span', { class: 'crucible-task-tile-d' }, detail));
    if (extra) d.appendChild(extra);
    return d;
  }
  function renderTiles() {
    var n = entries.length, models = {}, locals = 0;
    entries.forEach(function (e) { models[e.model] = true; if (e.cfg.local) locals += 1; });
    var scale = (task.scoring && task.scoring.scale) || 10;
    var maxed = entries.filter(function (e) { return e.mean + EPS >= scale; }).length;
    var scores = entries.map(function (e) { return e.mean; });
    var top = Math.max.apply(null, scores);
    var fastest = entries.filter(function (e) { return e.mean + EPS >= top && e.time !== null; })
      .sort(function (a, b) { return a.time - b.time; })[0];
    var grid = el('div', { class: 'crucible-task-tiles' });
    grid.appendChild(tile('Setups that ran it', String(n), plural(Object.keys(models).length, 'model') + ' · ' + locals + ' local, ' + (n - locals) + ' cloud'));
    var bar = el('span', { class: 'crucible-bar' });
    bar.appendChild(el('span', { class: 'crucible-bar-fill' })).style.width = (n ? maxed / n * 100 : 0) + '%';
    var v = el('span', {}, String(maxed));
    v.appendChild(el('small', {}, ' of ' + n));
    grid.appendChild(tile('Scored ' + fmtScore(scale).replace(/\.0$/, ''), v, null, bar));
    grid.appendChild(tile('Median score', fmtScore(median(scores)), 'range ' + fmtScore(Math.min.apply(null, scores)) + ' to ' + fmtScore(top)));
    var fd = fastest ? el('span', { class: 'crucible-task-tile-d' }) : null;
    if (fastest) { fd.appendChild(link(D.modelUrl(fastest.cfg), fastest.label)); fd.appendChild(document.createTextNode(' · ' + fastest.cfg.harness)); }
    var ft = tile('Fastest top score (' + fmtScore(top) + ')', fastest ? fmtSeconds(fastest.time) : NONE, fastest ? null : 'no time recorded');
    if (fd) ft.appendChild(fd);
    grid.appendChild(ft);
    body.appendChild(grid);
  }

  // ---- 3 Asks and scoring ---------------------------------------------------

  function renderAsks(t) {
    var two = el('div', { class: 'crucible-task-two' });
    body.appendChild(two);
    var asks = el('section', { class: 'crucible-task-block' });
    asks.appendChild(el('h2', { class: 'crucible-heading' }, 'What it asks'));
    var text = t.prompt || t.summary || '';
    if (text) {
      var long = text.split('\n').length > 12 || text.length > 1100;
      var pre = el('pre', { class: 'crucible-task-prompt' + (long ? ' is-collapsed' : '') }, text);
      asks.appendChild(pre);
      if (long) {
        var b = asks.appendChild(el('button', { type: 'button', class: 'crucible-link-button', 'aria-expanded': 'false' }, 'Show the full prompt'));
        b.addEventListener('click', function () {
          var open = pre.classList.toggle('is-collapsed') === false;
          b.textContent = open ? 'Collapse the prompt' : 'Show the full prompt';
          b.setAttribute('aria-expanded', String(open));
        });
      }
    } else asks.appendChild(note('The catalog has no prompt for this task.'));
    two.appendChild(asks);

    var how = el('section', { class: 'crucible-task-block' });
    how.appendChild(el('h2', { class: 'crucible-heading' }, 'How it\'s scored'));
    var sc = t.scoring && typeof t.scoring === 'object' ? t.scoring : {};
    var rules = t.rules || [], crit = t.criteria || [];
    if (rules.length) {
      how.appendChild(el('p', { class: 'crucible-task-label' }, 'Rules'));
      var ul = how.appendChild(el('ul', { class: 'crucible-task-rules' }));
      rules.forEach(function (r) { ul.appendChild(el('li', {}, typeof r === 'string' ? r : (r && (r.label || r.id)) || '')); });
    }
    if (crit.length) {
      var critFb = ((D.FB || {}).scoring_methods || {})[t.scoring_method];
      how.appendChild(el('p', { class: 'crucible-task-label' }, (critFb && critFb.criteria_label) || 'Criteria'));
      var cl = how.appendChild(el('ul', { class: 'crucible-task-rules' }));
      crit.forEach(function (c) {
        var li = cl.appendChild(el('li', {}, c.label || c.id || ''));
        if (typeof c.max_score === 'number') li.appendChild(el('span', { class: 'crucible-task-pts' }, ' ' + c.max_score + ' ' + (c.max_score === 1 ? 'point' : 'points')));
      });
    }
    if (!rules.length && !crit.length) how.appendChild(note('The catalog lists no rules for this task.'));
    var tot = [];
    if (typeof sc.total === 'number') tot.push(fmtInt(sc.total) + ' ' + (sc.unit || 'points') + ' in total' + (sc.scale ? ', scaled to ' + sc.scale : ''));
    tot.push('by ' + methodLabel(t.scoring_method));
    how.appendChild(note('Scored ' + tot.join(', ') + '.'));
    two.appendChild(how);
  }

  // ---- 4 Checks -------------------------------------------------------------

  function renderChecks(wrap) {
    wrap.innerHTML = '';
    wrap.appendChild(el('h2', { class: 'crucible-heading' }, 'Which checks trip models up'));
    if (detailsState === 'loading' || detailsState === 'idle') { wrap.appendChild(note('Loading per-check results…')); return; }
    if (detailsState === 'error') { wrap.appendChild(note('Couldn’t load the per-check results.')); return; }
    var stats = checkStats();
    if (!stats.length) { wrap.appendChild(note('No per-check results were published for these runs.')); return; }
    var runs = stats.reduce(function (m, s) { return Math.max(m, s.n); }, 0);
    wrap.appendChild(el('p', { class: 'crucible-sub' }, 'Share of the ' + plural(runs, 'counted run') + ' that passed each check, hardest first. A part-credit check counts the share it earned.'));
    var ul = wrap.appendChild(el('ul', { class: 'crucible-task-bars' }));
    stats.slice().sort(function (a, b) { return a.rate - b.rate; }).forEach(function (s) {
      var li = ul.appendChild(el('li', { class: 'crucible-task-bar-row', title: s.title }));
      li.appendChild(el('span', { class: 'crucible-task-bar-name' }, s.key));
      var bar = li.appendChild(el('span', { class: 'crucible-bar crucible-task-bar' }));
      var fill = bar.appendChild(el('span', { class: 'crucible-bar-fill' }));
      fill.style.width = (s.rate * 100) + '%';
      li.appendChild(el('span', { class: 'crucible-task-bar-pct' }, C.pct(s.rate)));
      li.appendChild(el('span', { class: 'crucible-task-bar-n' }, s.full + ' of ' + s.n + ' runs'));
    });
  }

  // ---- 5 Spread -------------------------------------------------------------

  function legend(parent, pairs) {
    var lg = parent.appendChild(el('div', { class: 'crucible-scatter-legend' }));
    pairs.forEach(function (p) {
      var item = lg.appendChild(el('span', { class: 'crucible-scatter-legend-item' }));
      var sw = item.appendChild(el('span', { class: 'crucible-scatter-swatch', 'aria-hidden': 'true' }));
      sw.style.background = p[1];
      item.appendChild(document.createTextNode(p[0]));
    });
  }
  function renderSpread(wrap) {
    var chart = wrap.querySelector('.crucible-chart');
    chart.innerHTML = '';
    var width = Math.max(280, chart.clientWidth || 600), m = { top: 10, right: 16, bottom: 30, left: 16 };
    var bins = {}, maxStack = 1;
    entries.forEach(function (e) {
      var k = e.mean.toFixed(1);
      (bins[k] = bins[k] || []).push(e);
      maxStack = Math.max(maxStack, bins[k].length);
    });
    var r = 5, step = 11, room = 230;
    if (maxStack * step > room) { step = room / maxStack; r = Math.max(2.5, step / 2 - 0.5); }
    var plotH = Math.max(60, maxStack * step + 8), height = m.top + plotH + m.bottom;
    function x(v) { return m.left + v / 10 * (width - m.left - m.right); }
    var root = svg('svg', { class: 'crucible-chart-svg', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img',
      'aria-label': 'Score of each setup on this task, one dot per setup' });
    var base = m.top + plotH;
    root.appendChild(svg('line', { class: 'crucible-baseline', x1: m.left, x2: width - m.right, y1: base, y2: base }));
    [0, 2, 4, 6, 8, 10].forEach(function (v) {
      root.appendChild(svg('line', { class: 'crucible-grid', x1: x(v), x2: x(v), y1: m.top, y2: base }));
      root.appendChild(svg('text', { class: 'crucible-axis-label', x: x(v), y: base + 16, 'text-anchor': 'middle' }, String(v)));
    });
    Object.keys(bins).forEach(function (k) {
      bins[k].forEach(function (e, i) {
        var c = svg('circle', { class: 'crucible-dot', cx: x(e.mean), cy: base - r - 1 - i * step, r: r,
          fill: e.cfg.local ? COLORS.local : COLORS.cloud, stroke: '#fff' });
        c.appendChild(svg('title', {}, e.label + ' · ' + D.configLabel(e.cfg) + ' · ' + fmtScore(e.mean)));
        root.appendChild(c);
      });
    });
    chart.appendChild(root);
  }

  // ---- 6 Performers ---------------------------------------------------------

  var detailPanel;
  function openDetail(e, rowEl) {
    D.showCellDetail(detailPanel, S, { label: e.label, cfg: e.cfg }, task, e.cell);
    state.openCfg = e.cfg.key;
    Array.prototype.forEach.call(document.querySelectorAll('.crucible-task-perf .is-open'), function (n) { n.classList.remove('is-open'); });
    if (rowEl) rowEl.classList.add('is-open');
    if (detailPanel.scrollIntoView) detailPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function checkSquare(e, key) {
    var g = runGroups(e.latest), v = g && g.values[key];
    var cls = v === undefined || v === null ? 'is-none' : v + EPS >= 1 ? 'is-pass' : v > EPS ? 'is-partial' : 'is-fail';
    var txt = cls === 'is-pass' ? 'passed' : cls === 'is-fail' ? 'failed' : cls === 'is-partial' ? 'partly passed (' + C.pct(v) + ')' : 'not recorded';
    var s = el('span', { class: 'crucible-task-sq ' + cls, title: key + ': ' + txt, role: 'img', 'aria-label': key + ': ' + txt });
    s.textContent = cls === 'is-pass' ? '✓' : cls === 'is-fail' ? '✕' : cls === 'is-partial' ? '~' : '';
    return s;
  }
  function renderPerformers(wrap) {
    wrap.innerHTML = '';
    wrap.appendChild(el('h2', { class: 'crucible-heading' }, 'Best performers'));
    var models = bestPerModel(entries), list = state.showAll ? entries.slice().sort(byScore) : models;
    wrap.appendChild(el('p', { class: 'crucible-sub' }, (state.showAll ? 'Every setup' : 'Each model\'s best setup (the one the leaderboard ranks it by, on its ' + S.view(task.mode).aggInfo().label + ' score)') +
      ', ranked by score on this task, then time. Check squares are from the setup\'s latest counted run. Select a row for its runs, checks and output.' +
      (detailsState === 'loading' ? ' Loading checks…' : '')));
    var cols = checkColumns();
    var wide = wrap.appendChild(el('div', { class: 'crucible-scroll crucible-perf-wide' }));
    var table = wide.appendChild(el('table', { class: 'crucible-tests crucible-task-perf' }));
    var tr = table.appendChild(el('thead')).appendChild(el('tr'));
    ['#', 'Maker', 'Model', 'Setup', 'Score'].forEach(function (h, i) { tr.appendChild(el('th', { class: i === 4 ? 'is-num' : '' }, h)); });
    cols.forEach(function (k) { tr.appendChild(el('th', { class: 'crucible-task-checkhead', title: k })).appendChild(el('span', {}, k)); });
    ['Time', 'Tokens out', 'Cost'].forEach(function (h) { tr.appendChild(el('th', { class: 'is-num' }, h)); });
    var tb = table.appendChild(el('tbody'));
    var cards = el('ul', { class: 'crucible-cards crucible-task-cards', id: 'crucible-perf-narrow' });
    cards.hidden = true;
    list.forEach(function (e, i) {
      var row = tb.appendChild(el('tr', { class: 'crucible-row' + (state.openCfg === e.cfg.key ? ' is-open' : ''), tabindex: '0' }));
      row.appendChild(el('td', { class: 'is-rank' }, String(i + 1)));
      row.appendChild(el('td', {})).appendChild(makerNode(e.cfg));
      row.appendChild(el('td', {})).appendChild(modelLink(e.cfg));
      var setup = row.appendChild(el('td', { class: 'crucible-task-setup' }));
      setup.appendChild(C.whereTag(e.cfg));
      setup.appendChild(document.createTextNode(' ' + D.variantLabel(D.variantOf(e.cfg), { harness: S.variantDims(task.mode).indexOf('harness') !== -1 })));
      setup.appendChild(document.createTextNode(' '));
      setup.appendChild(el('span', { class: 'crucible-sub' }, D.deploymentLabel(D.deploymentOf(e.cfg))));
      var sc = row.appendChild(el('td', { class: 'is-num' })), sb = scoreButton(e);
      sc.appendChild(sb);
      cols.forEach(function (k) { row.appendChild(el('td', { class: 'crucible-task-checkcell' })).appendChild(checkSquare(e, k)); });
      row.appendChild(el('td', { class: 'is-num' }, fmtSeconds(e.time)));
      row.appendChild(el('td', { class: 'is-num' }, fmtTokens(e.tokens)));
      row.appendChild(el('td', { class: 'is-num', title: D.costTitle({ local: e.cfg.local, cfg: e.cfg }) }, costText(e)));
      function open() { openDetail(e, row); }
      row.addEventListener('click', function (ev) { if (!ev.target.closest('a')) open(); });
      row.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === row) { ev.preventDefault(); open(); } });

      var li = cards.appendChild(el('li', { class: 'crucible-card' + (state.openCfg === e.cfg.key ? ' is-open' : '') }));
      var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
      title.appendChild(el('span', { class: 'crucible-task-rank' }, '#' + (i + 1)));
      title.appendChild(modelLink(e.cfg));
      title.appendChild(C.whereTag(e.cfg));
      li.appendChild(el('p', {})).appendChild(makerNode(e.cfg));
      var cfgLine = li.appendChild(el('p', { class: 'crucible-config-line' }, D.variantLabel(D.variantOf(e.cfg), { harness: S.variantDims(task.mode).indexOf('harness') !== -1 }) + ' '));
      cfgLine.appendChild(el('span', { class: 'crucible-sub' }, D.deploymentLabel(D.deploymentOf(e.cfg))));
      var top = li.appendChild(el('div', { class: 'crucible-task-card-score' }));
      var cb = scoreButton(e);
      top.appendChild(cb);
      if (e.runs.length > 1) top.appendChild(el('span', { class: 'crucible-repeat' }, '×' + e.runs.length + ' runs'));
      if (cols.length) {
        var sq = li.appendChild(el('div', { class: 'crucible-task-squares' }));
        cols.forEach(function (k) { sq.appendChild(checkSquare(e, k)); });
      }
      li.appendChild(el('p', { class: 'crucible-task-card-nums' }, 'Time ' + fmtSeconds(e.time) + ' · tokens out ' + fmtTokens(e.tokens) + ' · cost ' + costText(e)));
      cb.addEventListener('click', function () { openDetail(e, li); });
    });
    wrap.appendChild(cards);
    var actions = wrap.appendChild(el('div', { class: 'crucible-task-actions' }));
    if (entries.length > models.length) {
      var more = actions.appendChild(el('button', { type: 'button', class: 'crucible-segment' }, state.showAll ? 'Show best setup per model' : 'Show all ' + entries.length + ' setups'));
      more.addEventListener('click', function () { state.showAll = !state.showAll; renderPerformers(wrap); });
    }
    var top4 = models.slice(0, C.MAX_COMPARE);
    if (top4.length > 1) {
      actions.appendChild(link(C.compareUrl(top4.map(function (e) { return e.cfg.slug; })), 'Compare top ' + top4.length + ' →', 'crucible-link-button crucible-task-compare'));
    }
    detailPanel = wrap.appendChild(el('div', { class: 'crucible-cell-detail', id: 'crucible-cell-detail' }));
    detailPanel.hidden = true;
    C.applyLayout(['crucible-perf']);
  }

  // ---- 7 Scatter ------------------------------------------------------------

  var MEASURES = {
    time: { label: 'Time', axis: 'Median time per run', of: function (e) { return e.time; }, fmt: fmtSeconds },
    tokens: { label: 'Tokens out', axis: 'Median tokens out per run', of: function (e) { return e.tokens; }, fmt: fmtTokens },
    cost: { label: 'Cost', axis: 'Average cost per run', of: function (e) { return e.cost; }, fmt: fmtUsd }
  };
  function renderScatter(wrap) {
    var mm = MEASURES[state.measure];
    var chart = wrap.querySelector('.crucible-chart');
    chart.innerHTML = '';
    var pts = entries.filter(function (e) { var v = mm.of(e); return v !== null && v > 0; });
    var skipped = entries.length - pts.length;
    wrap.querySelector('.crucible-task-scatter-note').textContent = (pts.length
      ? 'Score against ' + mm.axis.toLowerCase() + ', log scale. Up and to the left is better. Each dot is a setup; the best setup of each model is named.' +
        (skipped ? ' ' + plural(skipped, 'setup') + ' left off (' + (state.measure === 'cost' ? 'local hardware with no power figure, or no cost recorded' : 'not recorded') + ').' : '')
      : 'Nothing to plot: none of these setups recorded this measure.') +
      ' Times and costs come from different machines and providers, so read them as each setup\'s own, not as a like-for-like speed test.';
    if (!pts.length) return;
    var width = Math.max(280, chart.clientWidth || 600), narrow = width < 500, height = narrow ? 300 : 340;
    var m = narrow ? { top: 16, right: 14, bottom: 44, left: 32 } : { top: 16, right: 24, bottom: 44, left: 44 };
    var xs = pts.map(mm.of);
    var lo = Math.log10(Math.min.apply(null, xs)), hi = Math.log10(Math.max.apply(null, xs));
    if (hi - lo < 0.5) { lo -= 0.25; hi += 0.25; }
    lo -= 0.1; hi += 0.1;
    function x(v) { return m.left + (Math.log10(v) - lo) / (hi - lo) * (width - m.left - m.right); }
    function y(v) { return m.top + (1 - v / 10) * (height - m.top - m.bottom); }
    var root = svg('svg', { class: 'crucible-chart-svg', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img',
      'aria-label': 'Score against ' + mm.axis.toLowerCase() + ' for each setup' });
    [0, 5, 10].forEach(function (v) {
      root.appendChild(svg('line', { class: v ? 'crucible-grid' : 'crucible-baseline', x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }));
      root.appendChild(svg('text', { class: 'crucible-axis-label', x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v)));
    });
    for (var ex = Math.ceil(lo); ex <= Math.floor(hi); ex++) {
      [1, 3].forEach(function (k) {
        var v = k * Math.pow(10, ex);
        if (Math.log10(v) < lo || Math.log10(v) > hi) return;
        root.appendChild(svg('line', { class: 'crucible-grid', x1: x(v), x2: x(v), y1: m.top, y2: height - m.bottom }));
        root.appendChild(svg('text', { class: 'crucible-axis-label', x: x(v), y: height - m.bottom + 16, 'text-anchor': 'middle' }, mm.fmt(v)));
      });
    }
    root.appendChild(svg('text', { class: 'crucible-axis-title', x: (m.left + width - m.right) / 2, y: height - 6, 'text-anchor': 'middle' }, mm.axis + ' (log scale)'));

    // Labels: only each model's best setup, placed where they touch no other label or dot
    var dots = pts.map(function (e) { var px = x(mm.of(e)), py = y(e.mean); return { e: e, px: px, py: py, box: [px - 7, py - 7, px + 7, py + 7] }; });
    var placed = [];
    function hit(a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; }
    var named = bestPerModel(pts), labels = [];
    named.forEach(function (e) {
      var d = dots.filter(function (q) { return q.e === e; })[0], text = C.shortName(e.cfg.base);
      if (text.length > 24) text = text.slice(0, 23) + '…';
      var w = text.length * 6.3 + 2, h = 12;
      var cands = [
        { x: d.px + 9, y: d.py + 4, a: 'start', b: [d.px + 8, d.py - 8, d.px + 10 + w, d.py + 6] },
        { x: d.px - 9, y: d.py + 4, a: 'end', b: [d.px - 10 - w, d.py - 8, d.px - 8, d.py + 6] },
        { x: d.px - w / 2, y: d.py - 10, a: 'start', b: [d.px - w / 2, d.py - 10 - h + 2, d.px + w / 2, d.py - 9] },
        { x: d.px - w / 2, y: d.py + 20, a: 'start', b: [d.px - w / 2, d.py + 8, d.px + w / 2, d.py + 22] }
      ];
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (c.b[0] < 0 || c.b[2] > width || c.b[1] < 0 || c.b[3] > height) continue;
        if (placed.some(function (p) { return hit(p, c.b); })) continue;
        if (dots.some(function (q) { return q !== d && hit(q.box, c.b); })) continue;
        placed.push(c.b);
        labels.push(svg('text', { class: 'crucible-point-label', x: c.x, y: c.y, 'text-anchor': c.a }, text));
        return;
      }
    });
    dots.forEach(function (d) {
      var e = d.e, color = e.cfg.local ? COLORS.local : COLORS.cloud;
      var c = svg('circle', { class: 'crucible-dot crucible-task-dot', cx: d.px, cy: d.py, r: 6, fill: color, stroke: '#fff', tabindex: '0', role: 'button',
        'aria-label': e.label + ', ' + fmtScore(e.mean) + ', ' + mm.fmt(mm.of(e)) });
      c.appendChild(svg('title', {}, e.label + ' · ' + D.configLabel(e.cfg) + ' · score ' + fmtScore(e.mean) + ' · ' + mm.fmt(mm.of(e))));
      function open() { openDetail(e, null); }
      c.addEventListener('click', open);
      c.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') open(); });
      root.appendChild(c);
    });
    labels.forEach(function (t) { root.appendChild(t); });
    chart.appendChild(root);
  }

  // ---- 8 Harness comparison -------------------------------------------------

  var SHAPES = ['circle', 'square', 'diamond', 'triangle'];
  function marker(shape, cx, cy, r, color) {
    var a = { fill: color, stroke: '#fff', 'stroke-width': 2 };
    if (shape === 'square') return svg('rect', Object.assign({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r }, a));
    if (shape === 'diamond') return svg('polygon', Object.assign({ points: [cx, cy - r - 1, cx + r + 1, cy, cx, cy + r + 1, cx - r - 1, cy].join(',') }, a));
    if (shape === 'triangle') return svg('polygon', Object.assign({ points: [cx, cy - r - 1, cx + r + 1, cy + r, cx - r - 1, cy + r].join(',') }, a));
    return svg('circle', Object.assign({ cx: cx, cy: cy, r: r }, a));
  }
  function harnessLabel(id) {
    var h = (S.cat.harnesses || []).filter(function (x) { return x && x.id === id; })[0];
    return (h && h.label) || id;
  }
  function renderHarness() {
    var hs = S.modeInfo(task.mode).harnesses || [];
    if (hs.length < 2) return;
    var wrap = section('Harness comparison', 'The same task through each agent harness this suite scores for it.');
    var rows = hs.map(function (h) {
      var list = entries.filter(function (e) { return e.cfg.harness === h; });
      return { id: h, list: list, mean: mean(list.map(function (e) { return e.mean; })), best: list.length ? Math.max.apply(null, list.map(function (e) { return e.mean; })) : null,
        time: median(list.map(function (e) { return e.time; })) };
    }).filter(function (r) { return r.list.length; });
    if (!rows.length) { wrap.appendChild(note('No harness has a counted run of this task.')); return; }
    var scroll = wrap.appendChild(el('div', { class: 'crucible-scroll' }));
    var table = scroll.appendChild(el('table', { class: 'crucible-tests crucible-task-harness' }));
    var tr = table.appendChild(el('thead')).appendChild(el('tr'));
    ['Harness', 'Setups', 'Mean score', 'Best score', 'Median time'].forEach(function (h, i) { tr.appendChild(el('th', { class: i ? 'is-num' : '' }, h)); });
    var tb = table.appendChild(el('tbody'));
    rows.forEach(function (r) {
      var row = tb.appendChild(el('tr'));
      var th = row.appendChild(el('th', { scope: 'row' }));
      var sw = th.appendChild(el('span', { class: 'crucible-task-hsw' }));
      sw.style.background = C.seriesColor(hs.indexOf(r.id));
      th.appendChild(document.createTextNode(harnessLabel(r.id)));
      [String(r.list.length), fmtScore(r.mean), fmtScore(r.best), fmtSeconds(r.time)].forEach(function (v) { row.appendChild(el('td', { class: 'is-num' }, v)); });
    });

    // Dumbbells: the same setup (base, quant, reasoning, machine) on two or more harnesses
    var groups = {}, order = [];
    entries.forEach(function (e) {
      var c = e.cfg, k = [c.base, c.level, c.quant, c.hwKey, c.provider, c.where].join('|');
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(e);
    });
    var pairs = order.map(function (k) { return groups[k]; }).filter(function (g) {
      var seen = {}; g.forEach(function (e) { seen[e.cfg.harness] = true; });
      return Object.keys(seen).length > 1;
    });
    wrap.appendChild(el('h3', { class: 'crucible-task-area' }, 'Same setup, different harness'));
    if (!pairs.length) { wrap.appendChild(note('No model ran this task on more than one harness at the same setup, so there is nothing to compare yet.')); return; }
    var perModel = {};
    pairs.forEach(function (g) { var k = g[0].model; perModel[k] = (perModel[k] || 0) + 1; });
    legend(wrap, hs.filter(function (h) { return rows.some(function (r) { return r.id === h; }); }).map(function (h) { return [harnessLabel(h), C.seriesColor(hs.indexOf(h))]; }));
    var chart = wrap.appendChild(el('div', { class: 'crucible-chart' }));
    pairs.sort(function (a, b) {
      return Math.max.apply(null, b.map(function (e) { return e.mean; })) - Math.max.apply(null, a.map(function (e) { return e.mean; }));
    });
    function draw() {
      chart.innerHTML = '';
      var width = Math.max(280, chart.clientWidth || 600), m = { left: 16, right: 16, top: 6, bottom: 30 }, rowH = 50;
      var height = m.top + pairs.length * rowH + m.bottom;
      function x(v) { return m.left + v / 10 * (width - m.left - m.right); }
      var root = svg('svg', { class: 'crucible-chart-svg', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img',
        'aria-label': 'Score of each model on each harness, same setup' });
      var base = m.top + pairs.length * rowH;
      [0, 2, 4, 6, 8, 10].forEach(function (v) {
        root.appendChild(svg('line', { class: 'crucible-grid', x1: x(v), x2: x(v), y1: m.top, y2: base }));
        root.appendChild(svg('text', { class: 'crucible-axis-label', x: x(v), y: base + 16, 'text-anchor': 'middle' }, String(v)));
      });
      pairs.forEach(function (g, i) {
        var top = m.top + i * rowH, ly = top + 16, dy = top + 34;
        var cfg = g[0].cfg, name = g[0].label;
        if (perModel[g[0].model] > 1) name += ' · ' + (cfg.local ? [cfg.quant, cfg.hwKey].filter(Boolean).join(' ') : cfg.provider || 'cloud');
        var byH = g.slice().sort(function (a, b) { return hs.indexOf(a.cfg.harness) - hs.indexOf(b.cfg.harness); });
        var t = svg('text', { class: 'crucible-point-label crucible-task-dbname', x: m.left, y: ly });
        t.appendChild(svg('tspan', { 'font-weight': 'bold' }, name));
        t.appendChild(svg('tspan', { fill: '#545454' }, '   ' + byH.map(function (e) { return harnessLabel(e.cfg.harness) + ' ' + fmtScore(e.mean); }).join(' · ')));
        root.appendChild(t);
        var vals = byH.map(function (e) { return e.mean; });
        root.appendChild(svg('line', { x1: x(Math.min.apply(null, vals)), x2: x(Math.max.apply(null, vals)), y1: dy, y2: dy, stroke: '#9a97a3', 'stroke-width': 3, 'stroke-linecap': 'round' }));
        byH.forEach(function (e) {
          var hi = hs.indexOf(e.cfg.harness), mk = marker(SHAPES[hi % SHAPES.length], x(e.mean), dy, 6, C.seriesColor(hi));
          mk.appendChild(svg('title', {}, name + ' on ' + harnessLabel(e.cfg.harness) + ': ' + fmtScore(e.mean) + ' · ' + fmtSeconds(e.time)));
          root.appendChild(mk);
        });
      });
      chart.appendChild(root);
    }
    draw();
    redraws.push(draw);
  }

  // ---- Task page ------------------------------------------------------------

  var redraws = [];
  function renderTask(t) {
    task = t;
    renderHeader(t);
    entries = buildEntries(t);
    if (entries.length) renderTiles();
    else {
      var anyRuns = S.taskCells(t.id).reduce(function (n, tc) { return n + tc.cell.all.length; }, 0);
      body.appendChild(note('No run of this task counts in this suite yet.' + (anyRuns ? ' ' + plural(anyRuns, 'run') + ' exist but don\'t count (an older task version, a harness this suite doesn\'t score, or marked invalid).' : ''), 'crucible-task-big'));
    }
    renderAsks(t);
    if (!entries.length) return;

    var checks = el('section', { class: 'crucible-task-section' });
    body.appendChild(checks);
    var spread = section('Score spread', 'One dot per setup, at its mean score. Dots at the same score stack.');
    legend(spread, [['Local', COLORS.local], ['Cloud', COLORS.cloud]]);
    spread.appendChild(el('div', { class: 'crucible-chart' }));
    renderSpread(spread);
    redraws.push(function () { renderSpread(spread); });

    var perf = section('', '');
    perf.removeChild(perf.firstChild);
    renderChecks(checks);
    renderPerformers(perf);

    var sc = section('Score against ' + 'time, tokens or cost', null);
    sc.querySelector('h2').textContent = 'Score against effort';
    var tool = sc.appendChild(el('div', { class: 'crucible-toolbar crucible-toolbar-tight' }));
    var seg = tool.appendChild(el('div', { class: 'crucible-segmented', role: 'radiogroup', 'aria-label': 'Measure for the horizontal axis' }));
    sc.appendChild(el('p', { class: 'crucible-sub crucible-task-scatter-note' }));
    legend(sc, [['Local', COLORS.local], ['Cloud', COLORS.cloud]]);
    sc.appendChild(el('div', { class: 'crucible-chart' }));
    function pick() {
      C.segmented(seg, Object.keys(MEASURES).map(function (k) { return { value: k, label: MEASURES[k].label }; }), state.measure,
        function (v) { state.measure = v; pick(); });
      renderScatter(sc);
    }
    pick();
    redraws.push(function () { renderScatter(sc); });

    if (!isProv(t)) renderHarness();
    else if ((S.modeInfo(t.mode).harnesses || []).length > 1) renderHarness();

    // Per-check results load after first paint
    if (detailsState === 'ready') return;
    detailsState = 'loading';
    D.loadDetails().then(function (index) {
      detailsIndex = index; detailsState = 'ready';
      if (task !== t) return;
      renderChecks(checks);
      renderPerformers(perf);
    }, function () {
      detailsState = 'error';
      if (task === t) renderChecks(checks);
    });
  }

  // ---- Route ----------------------------------------------------------------

  function render(r) {
    route = r;
    S = D.suite(route.params.suite || null);
    redraws = [];
    state.openCfg = null;
    body.innerHTML = '';
    C.breadcrumb(document.getElementById('task-crumbs'), [{ href: C.BASE + 'task/' + hashFor(null), text: 'Tasks' }]);
    renderSuite();
    document.getElementById('crucible-results').hidden = false;
    if (!route.id) { renderIndex(); return; }
    var t = S.task(route.id);
    if (!t) { renderMissing(route.id); return; }
    if (t.status === 'retired') { renderStub(t, C.taskName(t) + ' is retired in ' + S.name + ': it no longer counts, and its runs are not shown.'); return; }
    if (isProv(t) && !showProv()) {
      renderStub(t, C.taskName(t) + ' is a provisional task: it isn\'t scored in ' + S.name + ' yet, so it is hidden unless you ask to see provisional tasks.', true);
      return;
    }
    renderTask(t);
  }

  C.boot({
    script: script,
    ready: function (data) {
      D = data;
      body = document.getElementById('task-body');
      document.getElementById('suite-select').addEventListener('change', function (e) {
        location.hash = hashFor(route.id, { suite: e.target.value });
      });
      document.getElementById('provisional-toggle').addEventListener('change', function (e) {
        location.hash = hashFor(route.id, { provisional: e.target.checked ? '1' : null });
      });
      var timer = null;
      window.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { redraws.forEach(function (f) { f(); }); }, 150);
      });
      C.onLayoutChange(function () { C.applyLayout(['crucible-perf']); });
      C.onRoute(function (r) {
        try { render(r); window.scrollTo(0, 0); } catch (e) {
          if (window.console) console.error(e);
          D.showStatus('Something went wrong drawing this task.', false);
        }
      });
    }
  });
})();
