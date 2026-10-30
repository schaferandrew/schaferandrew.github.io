// Crucible compare page: two to four setups of one section side by side, on the tasks all of them
// have counted runs of. The numbers are CrucibleCore's (V.compare); this file draws them.
// The hash is the state: #<slug>,<slug>[&mode=<id>][&suite=<id>].
(function () {
  var C = window.CrucibleCore;
  var MAX = C.MAX_COMPARE;
  var el = C.el, svg = C.svg, fmtScore = C.fmtScore, fmtSeconds = C.fmtSeconds, fmtCost = C.fmtCost;
  var mean = C.mean, median = C.median, num = C.num, taskName = C.taskName, heatStyle = C.heatStyle;
  var script = document.currentScript;
  var SERIES = C.SERIES;
  var TIE = 1e-9;

  function start(D) {
    var route = null, ctx = null;
    var colorOf = {};                       // slug -> series color, fixed while the page is open
    var open = {}, openMissing = {}, tiedOpen = false;
    var modeCache = {};
    var results = document.getElementById('crucible-results');
    var rowLabel = D.rowLabel, configLabel = D.configLabel;

    // ---- Route -> setups ----------------------------------------------------

    function modesOf(S, cfg) {
      var key = S.id + '|' + cfg.slug;
      if (!modeCache[key]) {
        modeCache[key] = S.MODES.filter(function (m) {
          return S.view(m.id).compareCandidates().some(function (s) { return s.cfg === cfg; });
        }).map(function (m) { return m.id; });
      }
      return modeCache[key];
    }
    function modeName(S, id) { var m = S.modeInfo(id); return m.label || C.cap(id); }

    function resolve(r) {
      var S = D.suite(r.params.suite || null);
      var notes = [], cfgs = [], mode = r.params.mode || null;
      if (mode && !S.MODES.some(function (m) { return m.id === mode; })) {
        notes.push('There is no section "' + mode + '" in ' + C.suiteName(S.cat) + '.');
        mode = null;
      }
      var askedMode = mode;
      String(r.id || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (slug) {
        var cfg = D.configBySlug(slug);
        if (!cfg) { notes.push('"' + slug + '" isn\'t a setup in the results, so it was left out.'); return; }
        if (cfgs.indexOf(cfg) !== -1) return;
        var label = rowLabel(cfg) + ' (' + configLabel(cfg) + ')';
        var modes = modesOf(S, cfg);
        if (!modes.length) { notes.push(label + ' has no scored task in ' + C.suiteName(S.cat) + ', so it was left out.'); return; }
        if (!mode) mode = modes[0];
        if (modes.indexOf(mode) === -1) {
          notes.push(label + ' ran in ' + modes.map(function (m) { return modeName(S, m); }).join(' and ') + ', not ' + modeName(S, mode) +
            '. Setups from different sections can\'t be compared, so it was left out.');
          return;
        }
        if (cfgs.length >= MAX) { notes.push('Up to ' + MAX + ' setups can be compared; ' + label + ' was left out.'); return; }
        cfgs.push(cfg);
      });
      if (!mode && S.MODES[0]) mode = S.MODES[0].id;
      return { S: S, mode: mode, askedMode: askedMode, cfgs: cfgs, notes: notes, V: mode ? S.view(mode) : null };
    }

    // ---- Hash ---------------------------------------------------------------

    function hashFor(slugs, extra) {
      return C.hashFor(slugs.join(','), Object.assign({ mode: ctx.explicitMode ? ctx.mode : null }, extra || {}));
    }
    function go(slugs, extra) { location.hash = hashFor(slugs, extra); }
    function slugs() { return ctx.chosen.map(function (s) { return s.cfg.slug; }); }

    // ---- Setup identity -------------------------------------------------------

    function dot(color) { return el('span', { class: 'cmp-dot', style: 'background:' + color, 'aria-hidden': 'true' }); }
    // maker / model, then the setup line and the local/cloud tag
    function identity(cfg, color, opts) {
      opts = opts || {};
      var box = el('span', { class: 'cmp-id' });
      var line = box.appendChild(el('span', { class: 'cmp-id-name' }));
      if (color) line.appendChild(dot(color));
      line.appendChild(D.modelRef(cfg));
      line.appendChild(C.whereTag(cfg));
      if (!opts.short) box.appendChild(el('span', { class: 'crucible-config-line' }, configLabel(cfg)));
      return box;
    }
    // A plain-text name for charts, legends and column heads
    function shortLabel(cfg) { return rowLabel(cfg); }
    function fullLabel(cfg) { return rowLabel(cfg) + ' · ' + cfg.where + ' · ' + configLabel(cfg); }

    // ---- Controls ---------------------------------------------------------------

    function renderSuite() { D.renderSuiteBar(ctx.S); }

    function renderPicker() {
      var pick = document.getElementById('cmp-pick');
      pick.innerHTML = '';
      var full = ctx.chosen.length >= MAX;
      var cands = ctx.V ? ctx.V.compareCandidates().filter(function (s) { return slugs().indexOf(s.cfg.slug) === -1; }) : [];
      pick.appendChild(el('option', { value: '' }, full ? 'Up to ' + MAX + ' setups' : cands.length ? 'Pick a setup…' : 'No other setups ran here'));
      var groups = {}, order = [];
      cands.forEach(function (s) {
        var m = D.makerOf(s.cfg) || '';
        if (!groups[m]) { groups[m] = []; order.push(m); }
        groups[m].push(s);
      });
      order.sort(function (a, b) { return !a ? 1 : !b ? -1 : a < b ? -1 : a > b ? 1 : 0; });
      order.forEach(function (m) {
        var g = pick.appendChild(el('optgroup', { label: D.makerLabel(m || null) }));
        groups[m].forEach(function (s) { g.appendChild(el('option', { value: s.cfg.slug }, fullLabel(s.cfg))); });
      });
      pick.disabled = full || !cands.length;

      var bar = document.getElementById('cmp-mode-bar');
      var many = ctx.S.MODES.length > 1 && !ctx.chosen.length;
      bar.hidden = !many;
      if (many) {
        C.segmented('cmp-mode', ctx.S.MODES.map(function (m) { return { value: m.id, label: m.label || C.cap(m.id) }; }), ctx.mode, function (id) {
          ctx.explicitMode = true;
          ctx.mode = id;
          go([], { mode: id });
        });
      }
    }

    function renderChips() {
      var ul = document.getElementById('cmp-chips');
      ul.innerHTML = '';
      ctx.chosen.forEach(function (s) {
        var li = ul.appendChild(el('li', { class: 'crucible-compare-chip cmp-chip' }));
        li.style.borderLeft = '4px solid ' + s.color;
        li.appendChild(identity(s.cfg, s.color));
        var x = li.appendChild(el('button', { type: 'button', class: 'crucible-link-button cmp-remove', 'aria-label': 'Remove ' + shortLabel(s.cfg) + ' from the comparison' }, '✕'));
        x.addEventListener('click', function () { go(slugs().filter(function (k) { return k !== s.cfg.slug; })); });
      });
      var notes = document.getElementById('cmp-notes');
      notes.innerHTML = '';
      ctx.notes.forEach(function (n) { notes.appendChild(el('li', {}, n)); });
      notes.hidden = !ctx.notes.length;
    }

    // ---- Numbers ------------------------------------------------------------------

    function runsOf(s, shared) { return ctx.V.countedRuns(s.cfg, shared); }
    function sum(list) { var t = 0; list.forEach(function (v) { t += v; }); return t; }

    function numbers() {
      var cmp = ctx.cmp, tasks = cmp.sharedTasks, S = ctx.S;
      // score[k][i]: setup k on shared task i (mean of its counted repeats)
      var score = ctx.chosen.map(function (s) { return tasks.map(function (t) { return S.countedMean(s.cfg, t.id); }); });
      var time = ctx.chosen.map(function (s) {
        return tasks.map(function (t) { var n = D.cellNumbers(S.cellOf(s.cfg, t.id)).time; return n > 0 ? n : null; });
      });
      var tops = tasks.map(function (t, i) { return Math.max.apply(null, score.map(function (row) { return row[i]; })); });
      var rows = ctx.chosen.map(function (s, k) {
        var runs = runsOf(s, cmp.shared);
        var times = runs.map(function (r) { return num(r.run.elapsed_s, null); });
        var costs = runs.map(function (r) { return D.runCost(r.run); });
        var costKnown = costs.length && costs.every(function (c) { return c !== null; });
        return {
          mean: mean(score[k]), top: score[k].filter(function (v, i) { return v + TIE >= tops[i]; }).length,
          median: median(times), total: times.every(function (t) { return t !== null; }) ? sum(times) : null,
          cost: costKnown ? sum(costs) : null, runs: runs.length
        };
      });
      return { score: score, time: time, tops: tops, rows: rows };
    }

    // ---- Summary ---------------------------------------------------------------------

    function renderSummary(nums) {
      var cmp = ctx.cmp, S = ctx.S, n = cmp.sharedTasks.length;
      var table = document.getElementById('cmp-summary'), box = document.getElementById('cmp-summary-narrow');
      table.innerHTML = '';
      box.innerHTML = '';
      var bestMean = C.bestOf(nums.rows.map(function (r) { return r.mean; }));

      if (C.isNarrow()) {
        var ul = box.appendChild(el('ul', { class: 'crucible-cards cmp-cards' }));
        ctx.chosen.forEach(function (s, k) {
          var r = nums.rows[k];
          var li = ul.appendChild(el('li', { class: 'crucible-card cmp-card' }));
          li.style.borderLeft = '5px solid ' + s.color;
          li.appendChild(identity(s.cfg, s.color));
          C.kvRow(li, 'Mean on shared tasks', el('span', { class: 'crucible-compare-chip-score', style: heatStyle(r.mean) }, fmtScore(r.mean)));
          cmp.tiers.forEach(function (t) { C.kvRow(li, S.tierLabel(t.tier.id) + ' (shared)', fmtScore(t.scores[k].score)); });
          C.kvRow(li, 'Top score on', r.top + ' of ' + n);
          C.kvRow(li, 'Median time', fmtSeconds(r.median));
          C.kvRow(li, 'Total time', fmtSeconds(r.total));
          C.kvRow(li, 'Cost', fmtCost(r.cost, s.local));
        });
        return;
      }

      var head = el('tr');
      head.appendChild(el('th', { scope: 'col' }, 'Setup'));
      head.appendChild(el('th', { scope: 'col', class: 'cmp-num' }, 'Mean on ' + n + ' shared'));
      cmp.tiers.forEach(function (t) { head.appendChild(el('th', { scope: 'col', class: 'cmp-num' }, S.tierLabel(t.tier.id))); });
      ['Top score on', 'Median time', 'Total time', 'Cost'].forEach(function (h) { head.appendChild(el('th', { scope: 'col', class: 'cmp-num' }, h)); });
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      ctx.chosen.forEach(function (s, k) {
        var r = nums.rows[k], tr = body.appendChild(el('tr'));
        tr.appendChild(el('th', { scope: 'row', class: 'cmp-setup' })).appendChild(identity(s.cfg, s.color));
        var td = tr.appendChild(el('td', { class: 'cmp-num' + (bestMean !== null && r.mean === bestMean ? ' is-best' : '') }));
        td.appendChild(el('span', { class: 'crucible-compare-chip-score', style: heatStyle(r.mean) }, fmtScore(r.mean)));
        cmp.tiers.forEach(function (t) {
          var best = C.bestOf(t.scores.map(function (x) { return x.score; })), x = t.scores[k];
          var c = tr.appendChild(el('td', { class: 'cmp-num' + (best !== null && x.score === best ? ' is-best' : '') }, fmtScore(x.score)));
          if (x.scored !== x.total) c.appendChild(el('span', { class: 'crucible-repeat' }, ' ' + x.scored + '/' + x.total));
        });
        tr.appendChild(el('td', { class: 'cmp-num' }, r.top + ' of ' + n));
        tr.appendChild(el('td', { class: 'cmp-num' }, fmtSeconds(r.median)));
        tr.appendChild(el('td', { class: 'cmp-num' }, fmtSeconds(r.total)));
        tr.appendChild(el('td', { class: 'cmp-num', title: D.costTitle(s) }, fmtCost(r.cost, s.local)));
      });
    }

    // ---- Charts --------------------------------------------------------------------------

    // One row per task, one dot per setup on a shared horizontal axis; two setups join as a dumbbell.
    // spec: { host, labels[], tasks[], values[k][i], lo, hi, pos(v)->0..1, ticks[], tick(v), what }
    function rowsChart(spec) {
      var host = spec.host;
      host.innerHTML = '';
      var W = Math.max(260, Math.floor(host.clientWidth || 320));
      var above = W < 520;                                  // labels sit over their row on narrow widths
      var pad = 9, rowH = above ? 50 : 32;
      var x0 = above ? 4 : Math.min(200, Math.round(W * 0.36));
      var left = x0 + pad + (above ? 0 : 8), right = W - pad - 6;
      var n = spec.tasks.length, H = n * rowH + 26;
      var g = svg('svg', { class: 'cmp-svg', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': spec.what });
      function X(v) { return left + spec.pos(v) * (right - left); }
      var lastX = -99;
      spec.ticks.forEach(function (v) {
        if (X(v) - lastX < 34 && v !== spec.ticks[0]) return;
        lastX = X(v);
        g.appendChild(svg('line', { x1: X(v), x2: X(v), y1: 0, y2: n * rowH, class: 'cmp-grid' }));
        g.appendChild(svg('text', { x: X(v), y: H - 8, 'text-anchor': 'middle', class: 'cmp-tick' }, spec.tick(v)));
      });
      var chars = Math.max(8, Math.floor(((above ? W - 8 : x0 - 12)) / 6.4));
      spec.tasks.forEach(function (t, i) {
        var top = i * rowH, cy = top + (above ? 32 : rowH / 2);
        g.appendChild(svg('line', { x1: 0, x2: W, y1: top + rowH, y2: top + rowH, class: 'cmp-rowline' }));
        var name = taskName(t), a = svg('a', { href: C.taskUrl(t.id) });
        a.appendChild(svg('text', above ? { x: 4, y: top + 15, class: 'cmp-lbl' } : { x: x0 - 8, y: cy + 4, 'text-anchor': 'end', class: 'cmp-lbl' },
          name.length > chars ? name.slice(0, chars - 1) + '…' : name));
        a.appendChild(svg('title', {}, name));
        g.appendChild(a);
        var pts = [];
        spec.values.forEach(function (row, k) { if (row[i] !== null && row[i] !== undefined) pts.push({ k: k, v: row[i] }); });
        if (spec.values.length === 2 && pts.length === 2) {
          g.appendChild(svg('line', { x1: X(pts[0].v), x2: X(pts[1].v), y1: cy, y2: cy, class: 'cmp-bell' }));
        }
        var seen = {};
        pts.forEach(function (p) {
          var key = p.v.toPrecision(2), off = seen[key] || 0;
          seen[key] = off + 1;
          var dy = spec.values.length === 2 ? 0 : (off - 1.5) * 3.4 + 1;
          var c = svg('circle', { cx: X(p.v), cy: cy + dy, r: 5, fill: ctx.chosen[p.k].color, class: 'cmp-pt' });
          c.appendChild(svg('title', {}, spec.labels[p.k] + ' · ' + name + ': ' + spec.show(p.v)));
          g.appendChild(c);
        });
      });
      host.appendChild(g);
    }

    function niceTime(v) { return v >= 60 && v % 60 === 0 ? v / 60 + 'm' : v + 's'; }

    function renderCharts(nums) {
      var cmp = ctx.cmp, tasks = cmp.sharedTasks;
      var labels = ctx.chosen.map(function (s) { return shortLabel(s.cfg); });

      var all = [];
      nums.score.forEach(function (row) { all = all.concat(row); });
      var lo = Math.floor(Math.min.apply(null, all) / 2) * 2;
      if (lo >= 10) lo = 8;
      var ticks = [], step = 10 - lo <= 4 ? 1 : 2;
      for (var v = lo; v <= 10 + TIE; v += step) ticks.push(v);
      document.getElementById('cmp-dots-sub').textContent = lo > 0
        ? 'Score out of 10, one dot per setup. The axis starts at ' + lo + ', not 0, so gaps look bigger than they would on a full scale.'
        : 'Score out of 10, one dot per setup. The axis runs from 0 to 10.';
      rowsChart({
        host: document.getElementById('cmp-dots'), tasks: tasks, values: nums.score, labels: labels, lo: lo, hi: 10,
        pos: function (x) { return (x - lo) / (10 - lo); }, ticks: ticks, tick: function (x) { return String(x); },
        show: fmtScore, what: 'Score per shared task, one dot per setup, axis from ' + lo + ' to 10'
      });

      var flat = [];
      nums.time.forEach(function (row) { row.forEach(function (x) { if (x !== null) flat.push(x); }); });
      var timeHost = document.getElementById('cmp-time');
      if (!flat.length) {
        timeHost.innerHTML = '';
        timeHost.appendChild(el('p', { class: 'crucible-sub' }, 'No run times were recorded for these tasks.'));
        document.getElementById('cmp-time-sub').textContent = '';
        return;
      }
      var mn = Math.min.apply(null, flat), mx = Math.max.apply(null, flat);
      var cand = [];
      for (var e = Math.floor(Math.log10(mn)) - 1; e <= Math.ceil(Math.log10(mx)) + 1; e++) {
        [1, 2, 5].forEach(function (m) { cand.push(+(m * Math.pow(10, e)).toPrecision(3)); });
      }
      var tlo = cand.filter(function (x) { return x <= mn * (1 + TIE); }).pop(), thi = cand.filter(function (x) { return x >= mx * (1 - TIE); })[0];
      if (!(thi > tlo)) thi = tlo * 10;
      var tticks = cand.filter(function (x) { return x >= tlo && x <= thi; });
      var span = Math.log(thi) - Math.log(tlo);
      document.getElementById('cmp-time-sub').textContent = 'Median seconds per task on a log scale: equal distances are equal ratios (10× faster is one big step), not equal seconds.';
      rowsChart({
        host: timeHost, tasks: tasks, values: nums.time, labels: labels, lo: tlo, hi: thi,
        pos: function (x) { return (Math.log(x) - Math.log(tlo)) / span; }, ticks: tticks, tick: niceTime,
        show: fmtSeconds, what: 'Median seconds per shared task, one dot per setup, log scale'
      });
    }

    // ---- Where they differ -------------------------------------------------------------------

    // Each setup's checks on one task, side by side, from its newest counted run
    function fillChecks(host, t) {
      host.innerHTML = '';
      var grid = host.appendChild(el('div', { class: 'cmp-checks' }));
      var loads = [];
      ctx.chosen.forEach(function (s) {
        var col = grid.appendChild(el('div', { class: 'cmp-checks-col' }));
        col.style.borderTop = '3px solid ' + s.color;
        var cell = ctx.S.cellOf(s.cfg, t.id), info = cell && cell.counted[0];
        var head = col.appendChild(el('p', { class: 'cmp-checks-head' }));
        head.appendChild(el('strong', {}, shortLabel(s.cfg)));
        var body = col.appendChild(el('div'));
        if (!info) { body.appendChild(el('p', { class: 'crucible-detail-meta' }, 'No counted run.')); return; }
        head.appendChild(document.createTextNode(' ' + fmtScore(info.score)));
        col.appendChild(el('p', { class: 'crucible-detail-meta' }, cell.counted.length > 1
          ? 'Newest of ' + cell.counted.length + ' counted runs, ' + C.fmtDate(info.run.started_at)
          : 'One counted run, ' + C.fmtDate(info.run.started_at)));
        if (!info.rec) { body.appendChild(el('p', { class: 'crucible-detail-meta' }, 'No score record for this run.')); return; }
        body.appendChild(el('p', { class: 'crucible-detail-meta' }, 'Loading checks…'));
        loads.push({ info: info, body: body });
      });
      if (loads.length) {
        D.loadDetails().then(function (index) {
          loads.forEach(function (l) { D.renderItems(index[C.scoreKey(l.info.uuid, l.info.rec.rubric_version, l.info.rec.method)], l.body); });
        }, function () {
          loads.forEach(function (l) { l.body.innerHTML = ''; l.body.appendChild(el('p', { class: 'crucible-detail-meta' }, 'Couldn’t load the checks.')); });
        });
      }
      host.appendChild(el('p', { class: 'cmp-task-link' })).appendChild(el('a', { href: C.taskUrl(t.id) }, 'Open the task page →'));
    }

    // A control that shows/hides a panel, filling it on first open
    function toggler(button, panel, t, labels) {
      var filled = false;
      function sync() {
        var on = !!open[t.id];
        panel.hidden = !on;
        button.setAttribute('aria-expanded', on);
        button.textContent = on ? labels[1] : labels[0];
        if (on && !filled) { filled = true; fillChecks(panel, t); }
      }
      button.addEventListener('click', function () { open[t.id] = !open[t.id]; sync(); });
      sync();
    }

    function renderDiff(nums) {
      var cmp = ctx.cmp, tasks = cmp.sharedTasks, k = ctx.chosen.length;
      var rows = tasks.map(function (t, i) {
        var vals = nums.score.map(function (row) { return row[i]; });
        return { t: t, vals: vals, spread: Math.max.apply(null, vals) - Math.min.apply(null, vals), i: i };
      });
      rows.sort(function (a, b) { return b.spread - a.spread || a.i - b.i; });
      var tied = rows.filter(function (r) { return r.spread < TIE; });
      var collapse = tied.length > 5;

      document.getElementById('cmp-diff-sub').textContent = 'Shared tasks sorted by spread (best score minus worst), widest first. Select a task to see each setup\'s checks side by side.' +
        (collapse ? ' ' + tied.length + ' tasks where every setup scored the same are folded into one line.' : '');

      var table = document.getElementById('cmp-diff'), box = document.getElementById('cmp-diff-narrow');
      table.innerHTML = '';
      box.innerHTML = '';
      var narrow = C.isNarrow();
      var body, ul;
      if (narrow) ul = box.appendChild(el('ul', { class: 'crucible-cards cmp-cards' }));
      else {
        var head = el('tr');
        head.appendChild(el('th', { scope: 'col' }, 'Task'));
        head.appendChild(el('th', { scope: 'col', class: 'cmp-num' }, 'Spread'));
        ctx.chosen.forEach(function (s) {
          var th = head.appendChild(el('th', { scope: 'col', class: 'cmp-num cmp-colhead', title: fullLabel(s.cfg) }));
          th.appendChild(dot(s.color));
          th.appendChild(el('span', {}, shortLabel(s.cfg)));
        });
        table.appendChild(el('thead')).appendChild(head);
        body = table.appendChild(el('tbody'));
      }

      function scoreChip(v, best) { return el('span', { class: 'crucible-compare-chip-score' + (best ? ' is-best' : ''), style: heatStyle(v) }, fmtScore(v)); }

      function taskRow(r) {
        var top = Math.max.apply(null, r.vals);
        if (narrow) {
          var li = ul.appendChild(el('li', { class: 'crucible-card' }));
          var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
          title.appendChild(el('a', { href: C.taskUrl(r.t.id), class: 'crucible-test-id' }, taskName(r.t)));
          title.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + r.t.tier }, ctx.S.tierLabel(r.t.tier)));
          C.kvRow(li, 'Spread', fmtScore(r.spread));
          ctx.chosen.forEach(function (s, j) {
            var label = el('span', { class: 'crucible-kv-label cmp-kv-setup' });
            label.appendChild(dot(s.color));
            label.appendChild(document.createTextNode(shortLabel(s.cfg)));
            C.kvRow(li, label, scoreChip(r.vals[j], r.vals[j] + TIE >= top && r.spread > TIE));
          });
          var btn = li.appendChild(el('button', { type: 'button', class: 'crucible-link-button cmp-expand', 'aria-expanded': 'false' }));
          var panel = li.appendChild(el('div', { class: 'cmp-detail' }));
          toggler(btn, panel, r.t, ['Show checks', 'Hide checks']);
          return;
        }
        var tr = body.appendChild(el('tr', { class: 'cmp-task-row' }));
        var td = tr.appendChild(el('th', { scope: 'row' }));
        td.appendChild(el('a', { href: C.taskUrl(r.t.id) }, taskName(r.t)));
        td.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + r.t.tier }, ctx.S.tierLabel(r.t.tier)));
        tr.appendChild(el('td', { class: 'cmp-num' }, fmtScore(r.spread)));
        r.vals.forEach(function (v) { tr.appendChild(el('td', { class: 'cmp-num' })).appendChild(scoreChip(v, v + TIE >= top && r.spread > TIE)); });
        var btn2 = el('button', { type: 'button', class: 'crucible-link-button cmp-expand', 'aria-expanded': 'false' });
        td.appendChild(btn2);
        var dtr = body.appendChild(el('tr', { class: 'cmp-detail-row' }));
        var dtd = dtr.appendChild(el('td', { colspan: k + 2 }));
        var panel2 = dtd.appendChild(el('div', { class: 'cmp-detail' }));
        // the detail row is the one that hides; the panel inside it fills on first open
        var filled = false;
        function sync() {
          var on = !!open[r.t.id];
          dtr.hidden = !on;
          btn2.setAttribute('aria-expanded', on);
          btn2.textContent = on ? 'Hide checks' : 'Show checks';
          if (on && !filled) { filled = true; fillChecks(panel2, r.t); }
        }
        btn2.addEventListener('click', function () { open[r.t.id] = !open[r.t.id]; sync(); });
        tr.addEventListener('click', function (e) { if (!e.target.closest('a, button')) btn2.click(); });
        sync();
      }

      (collapse ? rows.filter(function (r) { return r.spread >= TIE; }) : rows).forEach(taskRow);
      if (collapse) {
        var label = tied.length + ' more tasks tied';
        var note = tiedOpen ? 'Every setup scored the same on each of these.' : 'Every setup scored the same on each, so they are folded.';
        function foldButton() {
          var b = el('button', { type: 'button', class: 'crucible-link-button', 'aria-expanded': String(tiedOpen) }, tiedOpen ? 'Fold them again' : 'Show them');
          b.addEventListener('click', function () { tiedOpen = !tiedOpen; renderDiff(nums); });
          return b;
        }
        if (narrow) {
          var fold = ul.appendChild(el('li', { class: 'crucible-card cmp-fold' }));
          fold.appendChild(el('strong', {}, label));
          fold.appendChild(el('p', { class: 'crucible-sub' }, note));
          fold.appendChild(foldButton());
        } else {
          var ftr = body.appendChild(el('tr', { class: 'cmp-fold' }));
          var ftd = ftr.appendChild(el('td', { colspan: k + 2 }));
          ftd.appendChild(el('strong', {}, label));
          ftd.appendChild(document.createTextNode(' · ' + note + ' '));
          ftd.appendChild(foldButton());
        }
        if (tiedOpen) tied.forEach(taskRow);
      }
    }

    // ---- Tasks not shared --------------------------------------------------------------------------

    function renderMissing() {
      var host = document.getElementById('cmp-missing'), V = ctx.V, S = ctx.S;
      host.innerHTML = '';
      var active = V.orderedTasks.filter(function (t) { return t.status === 'active'; });
      var shared = ctx.cmp.shared;
      var outside = active.filter(function (t) { return !shared[t.id]; });
      if (!outside.length) {
        host.appendChild(el('p', { class: 'crucible-sub' }, 'Every one of the ' + active.length + ' tasks in ' + modeName(S, ctx.mode) + ' is shared by all of these setups.'));
        return;
      }
      host.appendChild(el('p', { class: 'crucible-sub' }, outside.length + ' of the ' + active.length + ' tasks in ' + modeName(S, ctx.mode) +
        ' are left out of the comparison because at least one setup has no counted run of them. Nobody is scored on a task another setup skipped.'));
      var ul = host.appendChild(el('ul', { class: 'cmp-missing' }));
      ctx.chosen.forEach(function (s) {
        var miss = active.filter(function (t) { return S.countedMean(s.cfg, t.id) === null; });
        var li = ul.appendChild(el('li'));
        var line = li.appendChild(el('div', { class: 'cmp-missing-line' }));
        line.appendChild(dot(s.color));
        line.appendChild(el('span', {}, shortLabel(s.cfg) + ': ' + (miss.length ? 'no counted run of ' + miss.length + ' of ' + active.length + ' tasks' : 'ran all ' + active.length + ' tasks')));
        if (!miss.length) return;
        var btn = line.appendChild(el('button', { type: 'button', class: 'crucible-link-button' }));
        var list = li.appendChild(el('ul', { class: 'cmp-missing-list' }));
        miss.forEach(function (t) { list.appendChild(el('li')).appendChild(el('a', { href: C.taskUrl(t.id) }, taskName(t))); });
        function sync() {
          var on = !!openMissing[s.cfg.slug];
          list.hidden = !on;
          btn.setAttribute('aria-expanded', on);
          btn.textContent = on ? 'Hide' : 'List them';
        }
        btn.addEventListener('click', function () { openMissing[s.cfg.slug] = !openMissing[s.cfg.slug]; sync(); });
        sync();
      });
    }

    // ---- Page ----------------------------------------------------------------------------------------

    function render() {
      ctx = resolve(route);
      var S = ctx.S;
      ctx.explicitMode = !!route.params.mode;
      ctx.cmp = ctx.V ? ctx.V.compare(ctx.cfgs.map(function (c) { return c.slug; })) : { chosen: [], sharedTasks: [], tiers: [], shared: {} };
      ctx.chosen = ctx.cmp.chosen;
      // A setup that has no scored task here comes back from the core's candidates only if it ran
      ctx.cfgs.forEach(function (c) {
        if (!ctx.chosen.some(function (s) { return s.cfg === c; })) ctx.notes.push(rowLabel(c) + ' has no scored task in ' + modeName(S, ctx.mode) + ', so it was left out.');
      });
      // Fixed colors: a setup keeps its color while the page is open
      var taken = {};
      ctx.chosen.forEach(function (s) {
        var c = colorOf[s.cfg.slug];
        if (c && !taken[c]) taken[c] = true; else colorOf[s.cfg.slug] = null;
      });
      ctx.chosen.forEach(function (s) {
        if (!colorOf[s.cfg.slug]) {
          colorOf[s.cfg.slug] = SERIES.filter(function (c) { return !taken[c]; })[0];
          taken[colorOf[s.cfg.slug]] = true;
        }
        s.color = colorOf[s.cfg.slug];
      });

      C.breadcrumb(document.getElementById('cmp-crumbs'), ['Compare setups']);
      document.title = ctx.chosen.length > 1 ? 'Compare ' + ctx.chosen.map(function (s) { return shortLabel(s.cfg); }).join(' vs ') : 'Compare setups';
      renderSuite();
      renderChips();
      renderPicker();
      document.getElementById('compare-link').hidden = !ctx.chosen.length;
      var sub = document.getElementById('cmp-sub'), body = document.getElementById('cmp-body');
      var n = ctx.cmp.sharedTasks.length;
      if (ctx.chosen.length < 2) {
        body.hidden = true;
        sub.textContent = 'Pick two to four setups to see them side by side. A setup is one model at one reasoning level, quant, machine or provider and harness, local or cloud. ' +
          'They are scored only on the tasks all of them have counted runs of, so nobody gains from a task another skipped. ' +
          'Setups from different sections can\'t be compared' + (ctx.mode ? ', so the picker lists only ' + modeName(S, ctx.mode) + ' setups.' : '.') +
          (ctx.chosen.length ? ' Add one more to start.' : '');
        return;
      }
      body.hidden = false;
      sub.textContent = n
        ? n + ' task' + (n === 1 ? '' : 's') + (ctx.chosen.length === 2 ? ' both setups' : ' all ' + ctx.chosen.length + ' setups') + ' ran in ' + modeName(S, ctx.mode) + ' of ' + C.suiteName(S.cat) +
          '. Everything below counts only these tasks. Scores are the mean of repeat runs.'
        : 'These setups have no scored task in common in ' + modeName(S, ctx.mode) + ' of ' + C.suiteName(S.cat) + ' yet, so there is nothing to compare.';
      document.getElementById('cmp-shared').hidden = !n;
      C.applyLayout(['cmp-summary', 'cmp-diff']);
      if (n) {
        var nums = numbers();
        renderSummary(nums);
        renderCharts(nums);
        renderDiff(nums);
        ctx.nums = nums;
      } else {
        document.getElementById('cmp-summary').innerHTML = '';
        document.getElementById('cmp-summary-narrow').innerHTML = '';
      }
      renderMissing();
    }

    // ---- Events --------------------------------------------------------------------------------------------

    document.getElementById('cmp-pick').addEventListener('change', function (e) {
      if (e.target.value) go(slugs().concat([e.target.value]));
    });
    document.getElementById('suite-select').addEventListener('change', function (e) {
      var id = e.target.value;
      location.hash = C.buildHash(slugs().join(','), { mode: ctx.explicitMode ? ctx.mode : null, suite: id === D.suiteId(D.CURRENT) ? null : id });
    });
    var linkBtn = document.getElementById('compare-link');
    linkBtn.textContent = 'Copy link';
    linkBtn.addEventListener('click', function () {
      var url = location.origin + location.pathname + hashFor(slugs());
      var field = document.getElementById('cmp-url');
      function done() { linkBtn.textContent = 'Link copied'; setTimeout(function () { linkBtn.textContent = 'Copy link'; }, 1500); }
      function fallback() {
        if (!field) {
          field = el('input', { type: 'text', readonly: '', id: 'cmp-url', class: 'cmp-url', 'aria-label': 'Link to this comparison' });
          linkBtn.parentNode.parentNode.insertBefore(field, linkBtn.parentNode.nextSibling);
        }
        field.value = url;
        field.hidden = false;
        field.focus();
        field.select();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
      else fallback();
    });

    var relayout = C.onLayoutChange(function () { render(); });
    var timer, lastW = 0;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var w = document.getElementById('cmp-dots').clientWidth;
        if (ctx && ctx.nums && Math.abs(w - lastW) > 8 && ctx.cmp.sharedTasks.length) { lastW = w; renderCharts(ctx.nums); }
        relayout();
      }, 150);
    });

    results.hidden = false;
    C.onRoute(function (r) {
      route = r;
      render();
      lastW = document.getElementById('cmp-dots').clientWidth;
    });
  }

  C.boot({ script: script, ready: start });
})();
