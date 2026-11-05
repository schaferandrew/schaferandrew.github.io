// Crucible "what to run next": /crucible/todo/[#&suite=<id>&mode=<id>&sort=<key>&all=1]. Every setup
// with a counted run in the selected suite and section whose scored tasks aren't all counted yet,
// sortable by how easy it is to bring to full coverage, and one recommendation for what to run next.
// Counting is the core's (S.countedMean, V.stats); nothing here re-implements the join.
(function () {
  var C = window.CrucibleCore;
  if (!C) return;
  var el = C.el, NONE = C.NONE, num = C.num, median = C.median, fmtSeconds = C.fmtSeconds, fmtScore = C.fmtScore;
  var script = document.currentScript;
  var D, S, V, route;
  var SORTS = ['easiest', 'fewest', 'time', 'score', 'model'];

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function param(k) { return route.params[k] || null; }
  function setParam(over) {
    var p = { suite: param('suite'), mode: param('mode'), sort: param('sort'), all: param('all') };
    Object.keys(over).forEach(function (k) { p[k] = over[k]; });
    location.hash = C.buildHash(null, p);
  }

  // A task's typical time: the median of its counted runs' times over every setup in this suite
  var taskTimeCache = {};
  function taskTime(t) {
    if (taskTimeCache[t.id] !== undefined) return taskTimeCache[t.id];
    var times = [];
    S.taskCells(t.id).forEach(function (tc) {
      tc.cell.all.forEach(function (i) { var v = num(i.run.elapsed_s, null); if (v !== null && D.runOutcome(i.run) === 'finished') times.push(v); });
    });
    return (taskTimeCache[t.id] = times.length ? median(times) : null);
  }
  // This setup's own pace against the field: the median of its finished time / the task's median
  function paceOf(cfg) {
    var ratios = [];
    V.orderedTasks.forEach(function (t) {
      var c = S.cellOf(cfg, t.id), typical = taskTime(t);
      if (!c || !typical) return;
      c.all.forEach(function (i) {
        var v = num(i.run.elapsed_s, null);
        if (v !== null && D.runOutcome(i.run) === 'finished') ratios.push(v / typical);
      });
    });
    return ratios.length ? median(ratios) : 1;
  }

  // One entry per setup with tasks left: which tasks, why each is missing, an estimated time
  function entryOf(s) {
    var cfg = s.cfg, pace = paceOf(cfg), left = [], est = 0, unknown = 0, failed = 0, awaiting = 0;
    V.orderedTasks.forEach(function (t) {
      if (t.status !== 'active' || S.countedMean(cfg, t.id) !== null) return;
      var c = S.cellOf(cfg, t.id), tries = c ? c.all.filter(function (i) { return i.state === 'counted'; }) : [];
      var why = 'not run', fails = 0;
      if (tries.length) {
        fails = tries.filter(function (i) { return D.runOutcome(i.run) !== 'finished'; }).length;
        if (tries.some(function (i) { return i.score === null && D.runOutcome(i.run) === 'finished'; })) { why = 'awaiting score'; awaiting += 1; }
        else if (fails) { why = fails === 1 ? D.outcomeText(tries[0].run) : 'failed ' + fails + '×'; failed += 1; }
      } else if (c && c.all.length) why = 'only older or uncounted runs';
      var typical = taskTime(t), time = typical === null ? null : typical * pace;
      if (why !== 'awaiting score') { if (time === null) unknown += 1; else est += time; }
      left.push({ task: t, why: why, fails: fails, time: time });
    });
    if (!left.length) return null;
    // Effort: tasks to run, with a task this setup already failed on counting double, then time
    var toRun = left.filter(function (x) { return x.why !== 'awaiting score'; });
    var effort = toRun.reduce(function (n, x) { return n + 1 + Math.min(x.fails, 3); }, 0);
    return { s: s, cfg: cfg, label: D.rowLabel(cfg), left: left, toRun: toRun.length, failed: failed, awaiting: awaiting, est: est, unknown: unknown, effort: effort, pace: pace };
  }

  function compare(key) {
    function byName(a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; }
    function score(e) { return e.s.overall.score === null ? -1 : e.s.overall.score; }
    return function (a, b) {
      if (key === 'model') return byName(a, b);
      if (key === 'score') return score(b) - score(a) || a.left.length - b.left.length || byName(a, b);
      if (key === 'time') return a.est - b.est || a.left.length - b.left.length || byName(a, b);
      if (key === 'fewest') return a.left.length - b.left.length || a.est - b.est || byName(a, b);
      return a.effort - b.effort || a.est - b.est || score(b) - score(a) || byName(a, b);
    };
  }

  function estText(e) {
    if (!e.toRun) return 'scoring only';
    if (e.unknown === e.toRun) return NONE;
    return '≈ ' + fmtSeconds(e.est) + (e.unknown ? ' + ' + plural(e.unknown, 'untimed task') : '');
  }
  function taskList(e, limit) {
    var ul = el('ul', { class: 'todo-tasks' });
    e.left.slice(0, limit || e.left.length).forEach(function (x) {
      var li = ul.appendChild(el('li', { class: x.why === 'not run' ? '' : 'is-' + C.slugify(x.why.replace(/ \d+×$/, '')) }));
      li.appendChild(el('a', { href: C.taskUrl(x.task.id) }, C.taskName(x.task)));
      li.appendChild(el('span', { class: 'todo-why' }, ' ' + S.tierLabel(x.task.tier) + ' · ' + x.why + (x.time !== null && x.why !== 'awaiting score' ? ' · ≈ ' + fmtSeconds(x.time) : '')));
    });
    if (limit && e.left.length > limit) ul.appendChild(el('li', { class: 'todo-more' }, '…and ' + (e.left.length - limit) + ' more'));
    return ul;
  }

  // The pick: the easiest setup that's close (its best full score comes within reach), favouring
  // a model's best setup; then its tasks in the order to run them: never-run first, quickest first
  function renderPick(entries) {
    var box = document.getElementById('todo-pick');
    box.innerHTML = '';
    if (!entries.length) { box.appendChild(el('p', { class: 'crucible-sub' }, 'Every setup here has a counted run of every scored task. Nothing left to run.')); return; }
    var ranked = entries.slice().sort(compare('easiest'));
    var e = ranked.filter(function (x) { return x.toRun; })[0] || ranked[0];
    var card = box.appendChild(el('div', { class: 'todo-pick-card' }));
    var title = card.appendChild(el('div', { class: 'crucible-card-title' }));
    title.appendChild(D.modelRef({ cfg: e.cfg, label: e.label }));
    title.appendChild(C.whereTag(e.cfg));
    card.appendChild(el('p', { class: 'crucible-config-line' }, D.configLabel(e.cfg)));
    var why = [plural(e.toRun, 'task') + ' to run', e.s.progress.done + '/' + e.s.progress.total + ' done'];
    if (e.awaiting) why.push(plural(e.awaiting, 'run') + ' awaiting a score');
    if (e.toRun) why.push(estText(e) + ' estimated');
    card.appendChild(el('p', { class: 'todo-pick-why' }, why.join(' · ')));
    var order = e.left.filter(function (x) { return x.why !== 'awaiting score'; }).sort(function (a, b) {
      return a.fails - b.fails || (a.time === null ? Infinity : a.time) - (b.time === null ? Infinity : b.time);
    });
    if (order.length) {
      card.appendChild(el('p', { class: 'crucible-sub' }, 'Run these, quickest and never-failed first:'));
      card.appendChild(taskList({ left: order }));
    }
    var others = ranked.filter(function (x) { return x !== e && x.toRun; }).slice(0, 3);
    if (others.length) {
      var p = card.appendChild(el('p', { class: 'crucible-sub' }, 'Then: '));
      others.forEach(function (x, i) {
        if (i) p.appendChild(document.createTextNode(', '));
        p.appendChild(D.modelLink({ cfg: x.cfg, label: x.label }));
        p.appendChild(document.createTextNode(' (' + plural(x.toRun, 'task') + ')'));
      });
    }
    card.appendChild(el('p', { class: 'crucible-footnote' }, 'Easiest means fewest tasks to run, each task this setup already timed out or errored on counting extra, then the least estimated time: each task\'s median finished time across setups, scaled by this setup\'s own pace.'));
  }

  function renderTable(entries) {
    var table = document.getElementById('todo-table'), cards = document.getElementById('todo-table-narrow');
    table.innerHTML = '';
    cards.innerHTML = '';
    if (!entries.length) return;
    var head = table.appendChild(el('thead')).appendChild(el('tr'));
    ['Setup', 'Done', 'Left', 'Estimated', D.AGG_LABEL + ' so far', 'Tasks left'].forEach(function (h) { head.appendChild(el('th', { scope: 'col' }, h)); });
    var body = table.appendChild(el('tbody'));
    var aggCol = V.aggInfo();
    entries.forEach(function (e) {
      var tr = body.appendChild(el('tr'));
      var name = tr.appendChild(el('td'));
      name.appendChild(D.modelRef({ cfg: e.cfg, label: e.label }));
      name.appendChild(C.whereTag(e.cfg));
      name.appendChild(el('div', { class: 'crucible-config-line' }, D.configLabel(e.cfg)));
      tr.appendChild(el('td')).appendChild(C.coverageBar(e.s, S));
      tr.appendChild(el('td', { class: 'todo-num' }, String(e.left.length) + (e.failed ? ' (' + e.failed + ' failed)' : '')));
      tr.appendChild(el('td', { class: 'todo-num' }, estText(e)));
      S.tierCell(e.s, aggCol, tr.appendChild(el('td')));
      var names = tr.appendChild(el('td', { class: 'todo-names' }));
      e.left.forEach(function (x, i) {
        if (i) names.appendChild(document.createTextNode(', '));
        names.appendChild(el('a', { href: C.taskUrl(x.task.id), title: S.tierLabel(x.task.tier) + ' · ' + x.why }, C.taskName(x.task)));
      });

      var li = D.modelCard(e.s, cards);
      li.appendChild(el('p', { class: 'todo-pick-why' }, e.s.progress.done + '/' + e.s.progress.total + ' done · ' + e.left.length + ' left · ' + estText(e)));
      li.appendChild(taskList(e, 4));
    });
  }

  function render(r) {
    route = r;
    S = D.selectedSuite();
    D.renderSuiteBar(S);
    C.breadcrumb(document.getElementById('todo-crumbs'), ['What to run next']);
    var modes = S.MODES.filter(function (m) { return S.view(m.id).orderedTasks.length; });
    if (!modes.length) modes = S.MODES;
    var mode = modes.filter(function (m) { return m.id === param('mode'); })[0] || modes[0];
    V = S.view(mode.id);
    taskTimeCache = {};
    var bar = document.getElementById('todo-mode-bar');
    bar.hidden = modes.length < 2;
    if (modes.length > 1) {
      C.segmented('todo-mode', modes.map(function (m) { return { value: m.id, label: m.label || C.cap(m.id) }; }), mode.id, function (id) { setParam({ mode: id }); });
    }
    var sort = SORTS.indexOf(param('sort')) === -1 ? 'easiest' : param('sort');
    document.getElementById('todo-sort').value = sort;
    var all = param('all') === '1';
    document.getElementById('todo-all').checked = all;

    var stats = all ? V.configs().map(function (cfg) { return V.stats(cfg); }).filter(function (s) { return s.runs > 0; })
      : V.rows().map(function (row) { return row.variants[0]; });
    var entries = stats.map(entryOf).filter(Boolean);
    var full = stats.length - entries.length;
    renderPick(entries);
    entries.sort(compare(sort));
    document.getElementById('todo-sub').textContent = entries.length
      ? plural(entries.length, all ? 'setup' : 'model') + ' with tasks left of ' + plural(V.orderedTasks.length, 'scored task') + (full ? '; ' + full + ' already complete.' : '.')
      : '';
    renderTable(entries);
    C.applyLayout(['todo-table']);
  }

  C.boot({
    script: script,
    ready: function (data) {
      D = data;
      document.getElementById('crucible-results').hidden = false;
      document.getElementById('suite-select').addEventListener('change', function (e) { setParam({ suite: e.target.value, mode: null }); });
      document.getElementById('todo-sort').addEventListener('change', function (e) { setParam({ sort: e.target.value === 'easiest' ? null : e.target.value }); });
      document.getElementById('todo-all').addEventListener('change', function (e) { setParam({ all: e.target.checked ? '1' : null }); });
      C.onLayoutChange(function () { C.applyLayout(['todo-table']); });
      C.onRoute(function (r) {
        try { render(r); } catch (err) {
          if (window.console) console.error(err);
          D.showStatus('Something went wrong drawing this page.', false);
        }
      });
    }
  });
})();
