// Crucible results: a suite, a leaderboard, then the views below it.
// Loading, the record join, counting rules, scores and the run detail panel are CrucibleCore's
// (crucible-core.js, loaded first); this file draws the main page from them. Everything shown comes
// from the records: modes, areas, tiers, thresholds and their text come from the selected suite's
// catalog, and anything the page doesn't recognize renders generically instead of throwing.
(function () {
  var C = window.CrucibleCore;
  var NONE = C.NONE, COLORS = C.COLORS, MAX_COMPARE = C.MAX_COMPARE;
  var num = C.num, cap = C.cap, pct = C.pct, mean = C.mean, median = C.median, fmtRepeat = C.fmtRepeat;
  var fmtScore = C.fmtScore, fmtSeconds = C.fmtSeconds, fmtUsd = C.fmtUsd, fmtCost = C.fmtCost, fmtInt = C.fmtInt, fmtDate = C.fmtDate;
  var heatStyle = C.heatStyle, el = C.el, svg = C.svg, nameNode = C.nameNode, whereTag = C.whereTag, taskName = C.taskName;
  var segmented = C.segmented, fillSelect = C.fillSelect, kvRow = C.kvRow, scoreBar = C.scoreBar, isNarrow = C.isNarrow;
  var script = document.currentScript;
  var resultsEl = document.getElementById('crucible-results');

  function start(D) {
    var store = D.store, SUITES = D.SUITES, CURRENT = D.CURRENT, suiteId = D.suiteId, suiteName = D.suiteName;
    var FB_METHODS = D.FB.scoring_methods || {};
    var rowLabel = D.rowLabel, configLabel = D.configLabel, hwValue = D.hwValue, cellValue = D.cellValue;

    // ---- State ------------------------------------------------------------

    var state = {
      suite: suiteId(CURRENT), mode: '', harness: 'best', where: 'all', hw: 'all', showInProgress: false,
      scatter: 'time', sort: null, detailRow: null, detailCfg: null, compare: [], open: {}
    };
    var S = null, V = null;
    function useSuite(id) {
      var cat = D.catalogById(id) || CURRENT;
      state.suite = suiteId(cat);
      S = D.suite(state.suite);
      if (!S.MODES.some(function (m) { return m.id === state.mode; })) state.mode = S.MODES[0] ? S.MODES[0].id : '';
      if (!state.sort || (!S.tierSeen[state.sort.key] && ['time', 'cost', 'model'].indexOf(state.sort.key) === -1)) state.sort = { key: S.HEAD, dir: -1 };
    }

    // The hash holds the section, the suite and the compared setups: #agentic&suite=v2&compare=a,b
    function readHash() {
      var h = C.parseHash();
      var v = h.params.compare;
      return { mode: h.id, suite: h.params.suite || null, compare: v === undefined ? null : v ? v.split(',').filter(Boolean) : [] };
    }
    function applyHash() {
      var h = readHash();
      if (h.mode) state.mode = h.mode;
      useSuite(h.suite && D.catalogById(h.suite) ? h.suite : state.suite);
      if (h.compare) state.compare = h.compare.slice(0, MAX_COMPARE);
    }
    function writeHash() {
      var parts = [encodeURIComponent(state.mode)];
      if (state.suite !== suiteId(CURRENT)) parts.push('suite=' + encodeURIComponent(state.suite));
      if (state.compare.length) parts.push('compare=' + state.compare.map(encodeURIComponent).join(','));
      var hash = '#' + parts.join('&');
      if (location.hash !== hash && history.replaceState) history.replaceState(null, '', hash);
    }

    function modeInfo() { return V.info; }
    function tierLabel(id) { return S.tierLabel(id); }
    function gateOf(id) { return S.gateOf(id); }

    // Tasks shown: this mode's active tasks, tier by tier, area order within a tier
    var tiers = [], orderedTasks = [], modeTaskIds = {}, MODE_TIERS = [];
    function selectMode() {
      V = S.view(state.mode);
      tiers = V.tiers;
      orderedTasks = V.orderedTasks;
      modeTaskIds = V.taskIds;
      MODE_TIERS = V.TIERS;
      var keyOk = MODE_TIERS.some(function (t) { return t.id === state.sort.key; }) || ['time', 'cost', 'model'].indexOf(state.sort.key) !== -1;
      if (!keyOk) state.sort = { key: V.head().id, dir: -1 };
    }

    function cellOf(cfg, taskId) { return S.cellOf(cfg, taskId); }
    function modeConfigsAll() { return V.configs(); }
    function passesFilters(cfg) {
      if (state.where !== 'all' && (state.where === 'local') !== cfg.local) return false;
      if (state.hw !== 'all' && hwValue(cfg) !== state.hw) return false;
      if (state.harness !== 'best' && cfg.harness !== state.harness) return false;
      return true;
    }

    // ---- Scores -----------------------------------------------------------

    function rowsAll() { return V.rows(passesFilters); }
    function showingInProgress(rows) { return state.showInProgress || V.noneFinished(rows); }

    function rankedRows() {
      var all = rowsAll();
      var showAll = showingInProgress(all);
      var list = all.filter(function (s) { return showAll || !s.inProgress; });
      return V.sortRows(list, state.sort);
    }

    // ---- Layout -----------------------------------------------------------

    function applyLayout() {
      C.applyLayout(['crucible-lb', 'crucible-matrix', 'crucible-heatmap', 'crucible-tests', 'crucible-compare']);
    }

    // ---- Controls ---------------------------------------------------------

    // Suite selector, newest first, and the suite line: version, task counts, cut date, changelog
    function renderSuite() {
      // One visible suite: no selector, just the suite line
      document.getElementById('suite-select').hidden = SUITES.length < 2;
      document.getElementById('suite-select-label').hidden = SUITES.length < 2;
      fillSelect(document.getElementById('suite-select'), SUITES.map(function (c) {
        return { value: suiteId(c), label: suiteName(c) + (c.suite.status === 'current' ? ' (current)' : '') };
      }), state.suite);
      var line = document.getElementById('suite-line');
      line.innerHTML = '';
      var cat = S.cat, suite = cat.suite;
      var active = S.tasks.filter(function (t) { return t.status === 'active'; }).length;
      var parts = [suiteName(cat) + (suite.version ? ' (version ' + suite.version + ')' : ''), active + ' scored tasks'];
      if (suite.cut_at) parts.push('cut ' + fmtDate(suite.cut_at));
      line.appendChild(document.createTextNode(parts.join(' · ')));
      if (suite.changelog_url) {
        line.appendChild(document.createTextNode(' · '));
        line.appendChild(el('a', { href: suite.changelog_url, rel: 'noopener' }, 'What changed'));
      }
      var note = document.getElementById('suite-note');
      note.textContent = suite.status === 'current' || cat === CURRENT ? ''
        : 'A past suite: its own tasks, tiers and weights, and only the runs that count in it (a run counts in every suite that pins its task at the version it ran).';
      note.hidden = !note.textContent;
    }

    function renderControls(rows) {
      var tabs = document.getElementById('mode-tabs');
      tabs.innerHTML = '';
      S.MODES.forEach(function (m) {
        var n = S.tasks.filter(function (t) { return t.mode === m.id && t.status === 'active'; }).length;
        var tab = el('button', { type: 'button', role: 'tab', class: 'crucible-mode-tab', 'aria-selected': m.id === state.mode, id: 'mode-tab-' + m.id });
        tab.appendChild(el('span', { class: 'crucible-mode-name' }, m.label));
        tab.appendChild(el('span', { class: 'crucible-mode-blurb' }, (m.blurb ? cap(m.blurb) + ' · ' : '') + n + ' tasks · ' +
          m.areas.map(function (a) { return a.label; }).join(', ')));
        tab.addEventListener('click', function () {
          state.mode = m.id;
          state.harness = 'best';
          state.hw = 'all';
          render();
        });
        tabs.appendChild(tab);
      });

      var harnesses = V.harnesses();
      var many = harnesses.length > 1;
      document.getElementById('harness-label').hidden = !many;
      document.getElementById('harness-toggle').hidden = !many;
      document.getElementById('harness-fixed').textContent = many || !harnesses.length ? '' : 'Every ' + modeInfo().label + ' run uses the ' + harnesses[0] + ' harness.';
      segmented('harness-toggle', [{ value: 'best', label: 'Best per model' }].concat(harnesses.map(function (h) {
        var n = modeConfigsAll().filter(function (c) { return c.harness === h; }).length;
        return { value: h, label: h, empty: !n, emptyTitle: 'No runs with this harness yet' };
      })), state.harness, function (h) { state.harness = h; render(); });
      segmented('where-toggle', [
        { value: 'all', label: 'All' }, { value: 'local', label: 'Local' }, { value: 'cloud', label: 'Cloud' }
      ], state.where, function (w) {
        state.where = w;
        if (w === 'cloud' && state.hw !== 'cloud') state.hw = 'all';
        if (w === 'local' && state.hw === 'cloud') state.hw = 'all';
        render();
      });

      // Hardware: the device that ran the weights, by hardware key; cloud runs have none
      var hwSeen = {}, hwOptions = [];
      modeConfigsAll().forEach(function (cfg) {
        var v = hwValue(cfg);
        if (hwSeen[v]) { Object.keys(cfg.devices).forEach(function (d) { hwSeen[v].devices[d] = true; }); return; }
        hwSeen[v] = { value: v, devices: Object.assign({}, cfg.devices) };
        hwOptions.push(hwSeen[v]);
      });
      hwOptions.sort(function (a, b) { return (a.value === 'cloud') - (b.value === 'cloud') || (a.value === '-') - (b.value === '-') || (a.value < b.value ? -1 : 1); });
      if (state.hw !== 'all' && !hwSeen[state.hw]) state.hw = 'all';
      fillSelect(document.getElementById('hw-select'), [{ value: 'all', label: 'All hardware' }].concat(hwOptions.map(function (o) {
        var devices = Object.keys(o.devices);
        return {
          value: o.value,
          label: o.value === 'cloud' ? 'Cloud (no hardware)' : (o.value === '-' ? 'Not recorded' : o.value) + (devices.length ? ' (' + devices.join(', ') + ')' : '')
        };
      })), state.hw);

      var all = rowsAll();
      var hidden = all.filter(function (s) { return s.ran && s.inProgress; }).length;
      var none = V.noneFinished(all);
      segmented('progress-toggle', [
        { value: false, label: 'Finished' },
        { value: true, label: 'Include in progress' + (hidden ? ' (' + hidden + ')' : ''), empty: !hidden, emptyTitle: 'Every model has finished this section' }
      ], showingInProgress(all), function (v) { state.showInProgress = v; render(); });
      var share = pct(S.IN_PROGRESS_BELOW);
      document.getElementById('progress-note').textContent = none && hidden
        ? 'No model has finished ' + share + ' of this section\'s scored tasks yet, so everyone is shown, marked * and unranked.'
        : state.showInProgress && hidden
        ? '* In progress: fewer than ' + share + ' of this section\'s scored tasks done. Listed last and not ranked.'
        : (hidden ? hidden + ' model' + (hidden === 1 ? '' : 's') + ' with fewer than ' + share + ' of this section\'s scored tasks done ' + (hidden === 1 ? 'is' : 'are') + ' hidden.' : '');
      segmented('scatter-toggle', [
        { value: 'time', label: 'Time per task' }, { value: 'cost', label: 'Cost per task' }
      ], state.scatter, function (m) { state.scatter = m; render(); });
    }

    // ---- Takeaways and notes ---------------------------------------------

    function filterPhrase() {
      var parts = [];
      if (state.harness !== 'best') parts.push('with ' + state.harness);
      if (state.hw === 'cloud') parts.push('in the cloud');
      else if (state.hw !== 'all') parts.push('on ' + (state.hw === '-' ? 'unrecorded hardware' : state.hw));
      else if (state.where === 'local') parts.push('run locally');
      else if (state.where === 'cloud') parts.push('in the cloud');
      return parts.join(' ');
    }

    function emptyText() {
      return 'No model has a counted run in this section of ' + suiteName(S.cat) + (filterPhrase() ? ' ' + filterPhrase() : '') + ' yet.';
    }

    function renderTakeaways(list) {
      var ul = document.getElementById('crucible-takeaways');
      ul.innerHTML = '';
      var H = S.HEADLINE;
      var ranked = list.filter(function (s) { return s.head && s.head.score !== null && !s.head.partial && !s.inProgress; })
        .sort(function (a, b) { return b.head.score - a.head.score; });
      var lines = [];
      if (ranked.length) {
        var top = ranked.slice(0, 2).map(function (s) { return s.label; });
        var what = H.blurb ? H.blurb + ' (' + H.label + ')' : 'the ' + H.label + ' tasks';
        lines.push(top.join(' and ') + (top.length > 1 ? ' lead ' : ' leads ') + what + (filterPhrase() ? ' ' + filterPhrase() : '') + '.');
        var local = ranked.filter(function (s) { return s.local; })[0];
        if (local && state.where !== 'cloud') {
          lines.push('The best local model is ' + local.label + ' at ' + fmtScore(local.head.score) + ', on ' + configLabel(local.cfg) + '.');
        }
        var priced = ranked.filter(function (s) { return !s.local && s.cost; });
        if (priced.length > 1) {
          var value = priced.slice().sort(function (a, b) { return b.head.score / b.cost - a.head.score / a.cost; })[0];
          lines.push(value.label + ' gives the most ' + H.label + ' score per dollar (' + fmtUsd(value.cost) + ' per task).');
        }
      }
      var stretch = V.stretch()[0];
      // Counted scores only: a provisional score never headlines a sentence
      var countedOf = function (s) { var r = stretch && s.tier[stretch.id]; return r && r.score !== null && !r.partial ? r.score : null; };
      var best = stretch && list.filter(function (s) { return countedOf(s) !== null; })
        .sort(function (a, b) { return countedOf(b) - countedOf(a); })[0];
      if (best) lines.push(best.label + ' scores highest on the ' + stretch.label + ' tasks (' + fmtScore(countedOf(best)) + ').');
      if (!lines.length) lines.push('No model has a complete ' + H.label + ' score' + (filterPhrase() ? ' ' + filterPhrase() : ' in this section') + ' yet.');
      lines.forEach(function (line) { ul.appendChild(el('li', {}, line)); });
    }

    function renderLeaderboardNote() {
      var H = S.HEADLINE;
      var parts = ['Ranked by ' + H.label + ' score (0–10).'];
      MODE_TIERS.forEach(function (t) {
        if (t.id === S.HEAD) return;
        parts.push(gateOf(t.id)
          ? t.label + ' is a pass/fail gate: a ' + t.label + ' score of at least ' + gateOf(t.id).mean + ', with no task below ' + gateOf(t.id).min + '.'
          : t.label + ' is scored separately and never blended in.');
      });
      parts.push('Each row is one model at one reasoning level, local or cloud, scored by its single best setup (named under it); "best of N setups" lists the others.' +
        ' Repeat runs are averaged. Cloud providers usually serve full precision, so a row shows what a model can do, not what it does on your hardware.');
      parts.push('A hatched bar means fewer than ' + pct(S.COVERAGE_MIN) + ' of that tier\'s tasks were scored. Select a column to sort.');
      document.getElementById('leaderboard-sub').textContent = parts.join(' ');
      var stretch = V.stretch().filter(function (t) { return !gateOf(t.id); })[0];
      document.getElementById('detail-outline-note').textContent = stretch ? ' (a thick outline is ' + stretch.label + ')' : '';
    }

    // ---- Leaderboard -------------------------------------------------------

    function tierCellContent(s, t, into) { S.tierCell(s, t, into); }
    function rankLabel(s, rank) { return V.isRanked(s) ? String(rank) : ''; }
    var costLabel = D.costLabel, costTitle = D.costTitle;

    function compareButton(cfg) {
      var on = state.compare.indexOf(cfg.slug) !== -1;
      var b = el('button', { type: 'button', class: 'crucible-link-button', 'aria-pressed': on }, on ? 'in compare ✓' : '+ compare');
      b.title = on ? 'Remove this setup from the compare view' : 'Add this setup to the compare view';
      b.addEventListener('click', function (e) { e.stopPropagation(); toggleCompare(cfg.slug); });
      return b;
    }

    function variantToggle(s) {
      if (s.variants.length < 2) return null;
      var open = !!state.open[s.rowKey];
      var b = el('button', { type: 'button', class: 'crucible-variant-toggle', 'aria-expanded': open },
        'best of ' + s.variants.length + ' setups ' + (open ? '▾' : '▸'));
      b.addEventListener('click', function () { state.open[s.rowKey] = !open; renderLeaderboard(currentList); });
      return b;
    }

    function nameBlock(s, into, isVariant) {
      var top = into.appendChild(el('span', { class: 'crucible-lb-name-line' }));
      if (!isVariant) top.appendChild(nameNode(s.label, s.inProgress ? ' *' : ''));
      top.appendChild(whereTag(s.cfg));
      var cfgLine = into.appendChild(el('span', { class: 'crucible-config-line' }));
      cfgLine.appendChild(el('span', { class: 'crucible-config-label' }, configLabel(s.cfg)));
      if (isVariant) cfgLine.appendChild(el('span', { class: 'crucible-config-n' }, ' · ' + s.runs + ' counted run' + (s.runs === 1 ? '' : 's')));
      var actions = into.appendChild(el('span', { class: 'crucible-config-actions' }));
      if (!isVariant) { var vt = variantToggle(s); if (vt) actions.appendChild(vt); }
      actions.appendChild(compareButton(s.cfg));
    }

    var currentList = [];
    function renderLeaderboard(list) {
      renderLeaderboardNote();
      var table = document.getElementById('crucible-leaderboard');
      table.innerHTML = '';
      if (isNarrow()) { renderLeaderboardCards(list); return; }
      document.getElementById('crucible-lb-narrow').innerHTML = '';
      var columns = [{ key: null, label: '#' }, { key: 'model', label: 'Model and best setup' }]
        .concat(MODE_TIERS.map(function (t) { return { key: t.id, label: t.label }; }))
        .concat([{ key: 'time', label: 'Time / task' }, { key: 'cost', label: 'Cost / task' }]);
      var head = el('tr');
      columns.forEach(function (c) {
        var th = el('th', { scope: 'col' });
        if (!c.key) th.textContent = c.label;
        else {
          var button = el('button', { type: 'button', class: 'crucible-sort' }, c.label);
          if (state.sort.key === c.key) {
            th.setAttribute('aria-sort', state.sort.dir < 0 ? 'descending' : 'ascending');
            button.appendChild(el('span', { 'aria-hidden': 'true' }, state.sort.dir < 0 ? ' ↓' : ' ↑'));
          }
          button.addEventListener('click', function () { setSort(c.key); });
          th.appendChild(button);
        }
        head.appendChild(th);
      });
      table.appendChild(el('thead')).appendChild(head);

      var body = table.appendChild(el('tbody'));
      var rank = 0;
      function scoreCells(row, s) {
        MODE_TIERS.forEach(function (t) {
          var td = el('td', { class: 'crucible-lb-bar-cell' });
          tierCellContent(s, t, td);
          row.appendChild(td);
        });
        row.appendChild(el('td', { class: 'crucible-lb-num' }, fmtSeconds(s.time)));
        row.appendChild(el('td', { class: 'crucible-lb-num', title: costTitle(s) }, costLabel(s)));
      }
      list.forEach(function (s) {
        var row = el('tr', { class: s.ran ? '' : 'is-not-run' });
        var label = rankLabel(s, rank + 1);
        if (label) rank += 1;
        row.appendChild(el('td', { class: 'crucible-lb-rank' }, label));
        var name = el('th', { scope: 'row', class: 'crucible-lb-name' });
        if (s.inProgress) name.title = 'In progress: ' + s.progress.done + ' of ' + s.progress.total + ' scored tasks in this section done';
        nameBlock(s, name, false);
        row.appendChild(name);
        scoreCells(row, s);
        body.appendChild(row);
        if (state.open[s.rowKey]) {
          s.variants.forEach(function (v, i) {
            var vr = el('tr', { class: 'crucible-variant-row' + (i === 0 ? ' is-best' : '') });
            vr.appendChild(el('td', { class: 'crucible-lb-rank' }, i === 0 ? 'best' : ''));
            var vn = el('th', { scope: 'row', class: 'crucible-lb-name' });
            nameBlock(Object.assign({}, v, { label: s.label }), vn, true);
            vr.appendChild(vn);
            scoreCells(vr, v);
            body.appendChild(vr);
          });
        }
      });
      if (!list.length) body.appendChild(el('tr')).appendChild(el('td', { colspan: columns.length, class: 'crucible-not-run' }, emptyText()));
    }

    function setSort(key) {
      // Scores sort high-first by default; time, cost and names low-first
      var natural = ['time', 'cost', 'model'].indexOf(key) === -1 ? -1 : 1;
      state.sort = { key: key, dir: state.sort.key === key ? -state.sort.dir : natural };
      render();
    }

    // Below 640 px each row is a card: rank, name, every tier, time and cost, the setup underneath
    function renderLeaderboardCards(list) {
      var box = document.getElementById('crucible-lb-narrow');
      box.innerHTML = '';
      var bar = el('div', { class: 'crucible-lb-sortbar' });
      bar.appendChild(el('label', { for: 'crucible-lb-sort' }, 'Sort by'));
      var select = el('select', { id: 'crucible-lb-sort', class: 'crucible-select' });
      MODE_TIERS.map(function (t) { return [t.id, t.label]; }).concat([['time', 'Time / task'], ['cost', 'Cost / task'], ['model', 'Model']]).forEach(function (o) {
        var opt = el('option', { value: o[0] }, o[1]);
        if (o[0] === state.sort.key) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', function () { state.sort = { key: select.value, dir: ['time', 'cost', 'model'].indexOf(select.value) === -1 ? -1 : 1 }; render(); });
      bar.appendChild(select);
      box.appendChild(bar);

      var ul = box.appendChild(el('ul', { class: 'crucible-lb-cards' }));
      var rank = 0;
      function scoreRows(card, s) {
        var tierList = MODE_TIERS.slice().sort(function (x, y) { return (y.id === state.sort.key) - (x.id === state.sort.key); });
        tierList.forEach(function (t) {
          var row = card.appendChild(el('div', { class: 'crucible-lb-card-score' + (t.id === state.sort.key ? ' is-sorted' : '') }));
          row.appendChild(el('span', { class: 'crucible-lb-card-label' }, t.label));
          tierCellContent(s, t, row);
        });
        var time = fmtSeconds(s.time) + '/task', cost = costLabel(s) + '/task';
        var line = card.appendChild(el('p', { class: 'crucible-lb-card-line' }));
        if (state.sort.key === 'time') line.appendChild(el('strong', {}, 'Time ' + time));
        else if (state.sort.key === 'cost') line.appendChild(el('strong', {}, 'Cost ' + cost));
        var rest = state.sort.key === 'time' ? [cost] : state.sort.key === 'cost' ? [time] : [time, cost];
        line.appendChild(document.createTextNode((line.firstChild ? ' · ' : '') + rest.join(' · ')));
      }
      list.forEach(function (s) {
        var label = rankLabel(s, rank + 1);
        if (label) rank += 1;
        var card = el('li', { class: 'crucible-lb-card' + (s.ran ? '' : ' is-not-run') });
        var top = card.appendChild(el('div', { class: 'crucible-lb-card-top' }));
        top.appendChild(el('span', { class: 'crucible-lb-rank' }, label || NONE));
        var name = top.appendChild(el('span', { class: 'crucible-lb-card-name crucible-lb-name' }));
        nameBlock(s, name, false);
        scoreRows(card, s);
        if (state.open[s.rowKey]) {
          var vl = card.appendChild(el('ul', { class: 'crucible-variant-cards' }));
          s.variants.forEach(function (v, i) {
            var vc = vl.appendChild(el('li', { class: 'crucible-variant-card' + (i === 0 ? ' is-best' : '') }));
            var vname = vc.appendChild(el('div', { class: 'crucible-lb-name' }));
            nameBlock(Object.assign({}, v, { label: s.label }), vname, true);
            if (i === 0) vname.insertBefore(el('span', { class: 'crucible-tag' }, 'best'), vname.firstChild);
            scoreRows(vc, v);
          });
        }
        ul.appendChild(card);
      });
      if (!list.length) box.appendChild(el('p', { class: 'crucible-not-run' }, emptyText()));
    }

    // ---- Scatter ----------------------------------------------------------

    // Score vs time or cost. Log x (time and cost span orders of magnitude), Pareto frontier, best quadrant.
    function renderScatter(list) {
      var container = document.getElementById('crucible-scatter');
      var tooltip = document.getElementById('crucible-tooltip');
      container.innerHTML = '';
      tooltip.hidden = true;
      var H = S.HEADLINE, measure = state.scatter;
      document.getElementById('scatter-measure-label').textContent = measure === 'time' ? 'time' : 'cost';
      function xOf(s) { return measure === 'time' ? s.time : s.cost; }

      var points = list.filter(function (s) { var x = xOf(s); return s.head && s.head.score !== null && x !== null && x > 0; });
      var skippedLocal = measure === 'cost' && list.some(function (s) { return s.local && s.head.score !== null && s.cost === null; });
      document.getElementById('scatter-sub').textContent = measure === 'time'
        ? H.label + ' score against median time per task, for each row\'s best setup. Up and to the left is better: the shaded corner is faster and better than the median, and the line joins models nothing else beats on both.'
        : H.label + ' score against average cost per task: the API bill for cloud models, the estimated electricity for local ones. Up and to the left is better.' +
          (skippedLocal ? ' Local setups on hardware with no power figure are left off.' : '');
      // The legend sits above the plot, never over the points
      var legend = document.getElementById('crucible-scatter-legend');
      legend.innerHTML = '';
      [['local', 'Local'], ['cloud', 'Cloud']].forEach(function (pair) {
        var item = legend.appendChild(el('span', { class: 'crucible-scatter-legend-item' }));
        var sw = item.appendChild(el('span', { class: 'crucible-scatter-swatch', 'aria-hidden': 'true' }));
        sw.style.background = COLORS[pair[0]];
        item.appendChild(document.createTextNode(pair[1]));
      });
      legend.hidden = !points.length;
      document.getElementById('crucible-scatter-key').hidden = true;
      if (!points.length) {
        container.appendChild(el('p', { class: 'crucible-sub' }, 'Nothing to plot for these filters yet.'));
        return;
      }

      var width = Math.max(280, container.clientWidth || 560);
      var narrow = width < 500;
      var height = narrow ? 300 : 340;
      var m = narrow ? { top: 16, right: 14, bottom: 44, left: 32 } : { top: 16, right: 24, bottom: 44, left: 44 };
      var xs = points.map(xOf);
      var lo = Math.log10(Math.min.apply(null, xs)), hi = Math.log10(Math.max.apply(null, xs));
      if (hi - lo < 0.5) { lo -= 0.25; hi += 0.25; }
      lo -= 0.1; hi += 0.1;
      function x(v) { return m.left + (Math.log10(v) - lo) / (hi - lo) * (width - m.left - m.right); }
      function y(v) { return m.top + (1 - v / 10) * (height - m.top - m.bottom); }

      var root = svg('svg', {
        class: 'crucible-chart-svg', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img',
        'aria-label': H.label + ' score against ' + (measure === 'time' ? 'time' : 'cost') + ' per task. The leaderboard has the same numbers.'
      });
      var medX = median(xs), medY = median(points.map(function (s) { return s.head.score; }));
      root.appendChild(svg('rect', { class: 'crucible-quadrant', x: m.left, y: m.top, width: Math.max(0, x(medX) - m.left), height: Math.max(0, y(medY) - m.top) }));
      [0, 5, 10].forEach(function (v) {
        root.appendChild(svg('line', { class: v ? 'crucible-grid' : 'crucible-baseline', x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }));
        root.appendChild(svg('text', { class: 'crucible-axis-label', x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v)));
      });
      for (var e = Math.ceil(lo); e <= Math.floor(hi); e++) {
        [1, 3].forEach(function (k) {
          var v = k * Math.pow(10, e);
          if (Math.log10(v) < lo || Math.log10(v) > hi) return;
          root.appendChild(svg('line', { class: 'crucible-grid', x1: x(v), x2: x(v), y1: m.top, y2: height - m.bottom }));
          root.appendChild(svg('text', { class: 'crucible-axis-label', x: x(v), y: height - m.bottom + 16, 'text-anchor': 'middle' },
            measure === 'time' ? fmtSeconds(v) : fmtUsd(v)));
        });
      }
      root.appendChild(svg('text', { class: 'crucible-axis-title', x: (m.left + width - m.right) / 2, y: height - 6, 'text-anchor': 'middle' },
        (measure === 'time' ? 'Median time per task' : 'Average cost per task') + ' (log scale)'));

      var sorted = points.slice().sort(function (a, b) { return xOf(a) - xOf(b); });
      var frontier = [], best = -1;
      sorted.forEach(function (s) { if (s.head.score > best) { frontier.push(s); best = s.head.score; } });
      if (frontier.length > 1) {
        root.appendChild(svg('path', { class: 'crucible-frontier', d: frontier.map(function (s, i) {
          return (i ? 'L' : 'M') + x(xOf(s)).toFixed(1) + ' ' + y(s.head.score).toFixed(1);
        }).join(' ') }));
      }
      // Wide: name the points (all of them when few, else the frontier). Narrow: number every
      // point and list the numbers under the chart, so no label is dropped or overlaps
      var labelAll = points.length <= 16;
      var key = document.getElementById('crucible-scatter-key');
      key.innerHTML = '';
      key.hidden = !narrow;
      var byScore = points.slice().sort(function (a, b) { return b.head.score - a.head.score || xOf(a) - xOf(b); });
      points.forEach(function (s) {
        var px = x(xOf(s)), py = y(s.head.score);
        var color = s.local ? COLORS.local : COLORS.cloud;
        root.appendChild(svg('circle', { class: 'crucible-dot' + (s.head.partial ? ' is-uncounted' : ''), cx: px, cy: py, r: 6,
          fill: s.head.partial ? '#fff' : color, stroke: s.head.partial ? color : '#fff' }));
        if (narrow) {
          root.appendChild(svg('text', { class: 'crucible-point-label crucible-point-num', x: px + 8, y: py - 7 }, String(byScore.indexOf(s) + 1)));
        } else if (labelAll || frontier.indexOf(s) !== -1) {
          // A label that would run past the plot's right edge sits to the left of its point
          var flip = px + 9 + s.label.length * 7 > width;
          root.appendChild(svg('text', { class: 'crucible-point-label', x: flip ? px - 9 : px + 9, y: py - 8, 'text-anchor': flip ? 'end' : 'start' }, s.label));
        }
        var hit = svg('circle', { class: 'crucible-hit', cx: px, cy: py, r: 14 });
        hit.addEventListener('mouseenter', function () {
          tooltip.innerHTML = '';
          tooltip.appendChild(el('div', { class: 'crucible-tooltip-title' }, s.label + ' · ' + s.cfg.where));
          tooltip.appendChild(el('div', { class: 'crucible-tooltip-note' }, configLabel(s.cfg)));
          tooltip.appendChild(el('div', {}, H.label + ' ' + fmtScore(s.head.score) + (s.head.partial ? ' (partial)' : '')));
          tooltip.appendChild(el('div', {}, 'Time per task ' + fmtSeconds(s.time) + ' · cost ' + costLabel(s)));
          tooltip.hidden = false;
          var left = px + 14;
          if (left + tooltip.offsetWidth > container.clientWidth) left = px - 14 - tooltip.offsetWidth;
          tooltip.style.left = Math.max(0, left - container.scrollLeft) + 'px';
          tooltip.style.top = Math.max(0, py - 20) + 'px';
        });
        hit.addEventListener('mouseleave', function () { tooltip.hidden = true; });
        root.appendChild(hit);
      });
      container.appendChild(root);
      if (narrow) {
        byScore.forEach(function (s, i) {
          var li = key.appendChild(el('li', {}));
          var sw = li.appendChild(el('span', { class: 'crucible-scatter-swatch', 'aria-hidden': 'true' }));
          sw.style.background = s.local ? COLORS.local : COLORS.cloud;
          li.appendChild(el('strong', {}, (i + 1) + ' '));
          li.appendChild(document.createTextNode(s.label + ' · ' + fmtScore(s.head.score) + (s.head.partial ? ' (partial)' : '') + ' · ' + (measure === 'time' ? fmtSeconds(s.time) : costLabel(s))));
        });
      }
    }

    // ---- Matrix -----------------------------------------------------------

    var promptBlock = D.promptBlock, runList = D.runList;
    function showCellDetail(s, t, c) { D.showCellDetail(document.getElementById('crucible-cell-detail'), S, s, t, c); }
    var matrixButton = D.cellButton;

    function renderMatrix(list) {
      var table = document.getElementById('crucible-matrix');
      table.innerHTML = '';
      document.getElementById('crucible-cell-detail').hidden = true;
      var rows = list.filter(function (s) { return s.ran; });
      if (isNarrow()) { renderMatrixNarrow(rows); return; }
      document.getElementById('crucible-matrix-narrow').innerHTML = '';

      var tierRow = el('tr');
      tierRow.appendChild(el('th', { scope: 'col' }));
      tiers.forEach(function (tier) {
        var n = orderedTasks.filter(function (t) { return t.tier === tier; }).length;
        tierRow.appendChild(el('th', { scope: 'colgroup', colspan: n, class: 'crucible-matrix-tier' }, tierLabel(tier)));
      });
      var idRow = el('tr');
      idRow.appendChild(el('th', { scope: 'col' }, 'Model'));
      orderedTasks.forEach(function (t, i) {
        var newTier = i && t.tier !== orderedTasks[i - 1].tier;
        var th = el('th', { scope: 'col', class: 'crucible-matrix-id' + (newTier ? ' is-tier-start' : ''), title: taskName(t) + (t.summary ? ': ' + t.summary : '') });
        th.appendChild(el('span', { class: 'crucible-matrix-name' }, taskName(t)));
        idRow.appendChild(th);
      });
      var head = table.appendChild(el('thead'));
      head.appendChild(tierRow);
      head.appendChild(idRow);

      var body = table.appendChild(el('tbody'));
      rows.forEach(function (s) {
        var row = el('tr');
        var name = el('th', { scope: 'row' });
        name.appendChild(nameNode(s.label));
        name.appendChild(el('span', { class: 'crucible-matrix-harness' }, configLabel(s.cfg)));
        row.appendChild(name);
        orderedTasks.forEach(function (t, i) {
          var c = cellOf(s.cfg, t.id);
          var td = el('td', { class: 'crucible-matrix-cell' + (i && t.tier !== orderedTasks[i - 1].tier ? ' is-tier-start' : '') +
            (t.status === 'provisional' ? ' is-provisional' : '') + (c ? '' : ' is-empty') });
          if (c) {
            var b = matrixButton(s, t, c, false);
            b.addEventListener('click', function () { showCellDetail(s, t, c); });
            td.appendChild(b);
          } else td.textContent = '·';
          row.appendChild(td);
        });
        body.appendChild(row);
      });
      if (!rows.length) body.appendChild(el('tr')).appendChild(el('td', { class: 'crucible-not-run' }, emptyText()));
    }

    var modelCard = D.modelCard;

    function renderMatrixNarrow(rows) {
      var box = document.getElementById('crucible-matrix-narrow');
      box.innerHTML = '';
      if (!rows.length) { box.appendChild(el('p', { class: 'crucible-not-run' }, emptyText())); return; }
      var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
      rows.forEach(function (s) {
        var li = modelCard(s, ul);
        tiers.forEach(function (tier) {
          li.appendChild(el('p', { class: 'crucible-card-group' }, tierLabel(tier)));
          orderedTasks.filter(function (t) { return t.tier === tier; }).forEach(function (t) {
            var c = cellOf(s.cfg, t.id);
            var label = el('span', { class: 'crucible-kv-label', title: taskName(t) + (t.summary ? ': ' + t.summary : '') }, taskName(t));
            if (t.status === 'provisional') label.appendChild(el('span', { class: 'crucible-tag' }, 'provisional'));
            var value;
            if (c) {
              value = matrixButton(s, t, c, true);
              value.addEventListener('click', function () {
                showCellDetail(s, t, c);
                document.getElementById('crucible-cell-detail').scrollIntoView({ block: 'start' });
              });
            } else value = el('span', { class: 'crucible-not-run' }, 'not run');
            kvRow(li, label, value, t.status === 'provisional' ? 'is-provisional' : '');
          });
        });
      });
    }

    // ---- Heatmap ----------------------------------------------------------

    function areaCellInto(td, r) {
      if (!r.n) { td.className = 'is-not-run'; td.textContent = 'not run'; return; }
      td.setAttribute('style', heatStyle(r.score));
      td.appendChild(el('span', { class: 'crucible-heat-score' }, fmtScore(r.score)));
      td.appendChild(el('span', { class: 'crucible-heat-n' }, r.n + '/' + r.tasks.length + ' tasks'));
    }

    function renderHeatmap(list) {
      var table = document.getElementById('crucible-heatmap');
      table.innerHTML = '';
      var areas = modeInfo().areas.filter(function (a) { return orderedTasks.some(function (t) { return t.area === a.id; }); });
      var ran = list.filter(function (s) { return s.ran; });
      var box = document.getElementById('crucible-heatmap-narrow');
      box.innerHTML = '';
      if (isNarrow()) {
        if (!ran.length) return;
        var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
        ran.forEach(function (s) {
          var li = modelCard(s, ul);
          areas.forEach(function (area) {
            var holder = el('span', { class: 'crucible-narrow-cell' });
            areaCellInto(holder, V.areaResult(s.cfg, area));
            kvRow(li, area.label, holder);
          });
        });
        return;
      }
      var head = el('tr');
      head.appendChild(el('th', { scope: 'col' }, 'Model'));
      areas.forEach(function (a) { head.appendChild(el('th', { scope: 'col' }, a.label)); });
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      ran.forEach(function (s) {
        var row = el('tr');
        var th = el('th', { scope: 'row' });
        th.appendChild(nameNode(s.label));
        th.appendChild(whereTag(s.cfg));
        row.appendChild(th);
        areas.forEach(function (area) {
          var td = el('td');
          areaCellInto(td, V.areaResult(s.cfg, area));
          row.appendChild(td);
        });
        body.appendChild(row);
      });
    }

    // ---- One model in detail ----------------------------------------------

    function detailTarget(list) {
      var ran = list.filter(function (s) { return s.ran; });
      var row = ran.filter(function (s) { return s.rowKey === state.detailRow; })[0] || ran[0] || null;
      if (!row) return null;
      state.detailRow = row.rowKey;
      var v = row.variants.filter(function (x) { return x.cfg.key === state.detailCfg; })[0] || row.variants[0];
      state.detailCfg = v.cfg.key;
      return { row: row, s: Object.assign({}, v, { label: row.label }) };
    }

    function renderDetailPicker(list) {
      var target = detailTarget(list);
      var ran = list.filter(function (s) { return s.ran; });
      fillSelect(document.getElementById('detail-model'), ran.map(function (s) {
        return { value: s.rowKey, label: s.label + ' (' + s.cfg.where + ')' };
      }), state.detailRow);
      var cfgSelect = document.getElementById('detail-config');
      fillSelect(cfgSelect, target ? target.row.variants.map(function (v, i) {
        return { value: v.cfg.key, label: (i === 0 ? 'Best: ' : '') + configLabel(v.cfg) + ' (' + v.cfg.where + ')' };
      }) : [], state.detailCfg);
      cfgSelect.disabled = !target || target.row.variants.length < 2;
      return target;
    }

    var openAreas = {};
    var cellNumbers = D.cellNumbers;

    function taskRow(s, t, columns, body, toolCalls) {
      var c = cellOf(s.cfg, t.id);
      var row = el('tr', { class: 'crucible-row' + (c ? '' : ' is-not-run') });
      var name = el('th', { scope: 'row' });
      name.title = taskName(t);
      name.appendChild(el('span', { class: 'crucible-test-id' }, taskName(t)));
      name.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, tierLabel(t.tier)));
      name.appendChild(el('span', { class: 'crucible-test-summary', title: t.summary || '' }, t.summary || ''));
      if (t.status === 'provisional') name.appendChild(el('span', { class: 'crucible-tag' }, 'provisional'));
      row.appendChild(name);
      if (!c) {
        row.appendChild(el('td', { colspan: columns.length - 1, class: 'crucible-not-run' }, 'not run'));
        body.appendChild(row);
        return;
      }
      var n = cellNumbers(c);
      var scoreCell = row.appendChild(el('td', { class: 'crucible-score-cell' }));
      scoreBar(n.value, scoreCell);
      var timeCell = row.appendChild(el('td', {}, fmtSeconds(n.time)));
      if (n.timedOut) timeCell.appendChild(el('span', { class: 'crucible-flag' }, 'timed out'));
      if (toolCalls) row.appendChild(el('td', {}, fmtInt(n.tools)));
      row.appendChild(el('td', {}, fmtInt(n.tokens)));
      row.appendChild(el('td', {}, fmtCost(n.cost, s.local)));
      row.appendChild(el('td', {}, String(n.runs)));

      var detail = el('tr', { class: 'crucible-detail', hidden: '' });
      var detailCell = el('td', { colspan: columns.length });
      detail.appendChild(detailCell);
      var filled = false;
      row.tabIndex = 0;
      row.setAttribute('aria-expanded', 'false');
      function toggle() {
        var open = detail.hidden;
        if (open && !filled) { filled = true; promptBlock(t, detailCell); runList(c, detailCell); }
        detail.hidden = !open;
        row.setAttribute('aria-expanded', open);
      }
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      body.appendChild(row);
      body.appendChild(detail);
    }

    // Runs of tasks this suite's catalog doesn't list are kept, not counted, and named here
    function renderOtherRuns(target) {
      var p = document.getElementById('crucible-other-runs');
      var other = target ? (S.other[target.s.cfg.key] || []) : [];
      p.hidden = !other.length;
      if (!other.length) return;
      var names = [];
      other.forEach(function (r) { var id = (r.task || {}).id || '?'; if (names.indexOf(id) === -1) names.push(id); });
      p.textContent = 'Other runs: ' + other.length + ' run' + (other.length === 1 ? '' : 's') + ' of tasks this suite doesn\'t list (' +
        names.slice(0, 8).join(', ') + (names.length > 8 ? ', …' : '') + '). They aren\'t counted in any score.';
    }

    function areaToggle(area, tasks, cfg, key, open) {
      var values = tasks.map(function (t) { return cellValue(cellOf(cfg, t.id)); });
      var ran = tasks.filter(function (t) { return cellOf(cfg, t.id); }).length;
      var avg = mean(values.map(function (v) { return v && v.agg ? v.agg.mean : null; }));
      var button = el('button', { type: 'button', class: 'crucible-area-toggle', 'aria-expanded': open });
      button.appendChild(el('span', { class: 'crucible-area-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'));
      button.appendChild(el('span', { class: 'crucible-area-name' }, area.label));
      var chip = el('span', { class: 'crucible-area-score' }, avg === null ? NONE : (isNarrow() ? 'mean ' : '') + fmtScore(avg));
      if (avg !== null) chip.setAttribute('style', heatStyle(avg));
      button.appendChild(chip);
      button.appendChild(el('span', { class: 'crucible-area-count' }, ran + '/' + tasks.length + ' run'));
      var strip = el('span', { class: 'crucible-area-strip', 'aria-hidden': 'true' });
      tasks.forEach(function (t, k) {
        var v = values[k], score = v && v.agg ? v.agg.mean : null;
        var sq = el('span', { class: 'crucible-area-sq is-role-' + S.tierRole(t.tier) + (v ? '' : ' is-empty'), title: taskName(t) + ' · ' + tierLabel(t.tier) + ' · ' + (v ? fmtScore(score) : 'not run') });
        if (score !== null) sq.setAttribute('style', heatStyle(score));
        strip.appendChild(sq);
      });
      button.appendChild(strip);
      button.addEventListener('click', function () { openAreas[key] = !open; renderTasks(currentTarget); });
      return button;
    }

    function taskCard(s, t, ul, toolCalls) {
      var c = cellOf(s.cfg, t.id);
      var li = ul.appendChild(el('li', { class: 'crucible-card crucible-test-card' + (c ? '' : ' is-not-run') }));
      var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
      title.appendChild(el('span', { class: 'crucible-test-id' }, taskName(t)));
      title.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, tierLabel(t.tier)));
      if (t.status === 'provisional') title.appendChild(el('span', { class: 'crucible-tag' }, 'provisional'));
      li.appendChild(el('p', { class: 'crucible-test-summary' }, t.summary || taskName(t)));
      if (!c) { li.appendChild(el('p', { class: 'crucible-not-run' }, 'not run')); return; }
      var n = cellNumbers(c);
      var score = el('span', { class: 'crucible-kv-value' });
      scoreBar(n.value, score);
      kvRow(li, 'Score', score);
      var time = el('span', { class: 'crucible-kv-value' }, fmtSeconds(n.time));
      if (n.timedOut) time.appendChild(el('span', { class: 'crucible-flag' }, 'timed out'));
      kvRow(li, 'Time', time);
      if (toolCalls) kvRow(li, 'Tool calls', fmtInt(n.tools));
      kvRow(li, 'Tokens out', fmtInt(n.tokens));
      kvRow(li, 'Cost', fmtCost(n.cost, s.local));
      kvRow(li, 'Runs', String(n.runs));
      var detail = li.appendChild(el('div', { class: 'crucible-detail', hidden: '' }));
      var filled = false;
      var more = li.appendChild(el('button', { type: 'button', class: 'crucible-card-more', 'aria-expanded': 'false' }, 'Show runs, checks and output'));
      more.addEventListener('click', function () {
        var open = detail.hidden;
        if (open && !filled) { filled = true; promptBlock(t, detail); runList(c, detail); }
        detail.hidden = !open;
        more.setAttribute('aria-expanded', open);
        more.textContent = open ? 'Hide runs, checks and output' : 'Show runs, checks and output';
      });
    }

    var currentTarget = null;
    function renderTasks(target) {
      currentTarget = target;
      var table = document.getElementById('crucible-tests');
      table.innerHTML = '';
      document.getElementById('crucible-tests-narrow').innerHTML = '';
      renderOtherRuns(target);
      if (!target) return;
      var s = target.s;
      var toolCalls = V.hasToolCalls();
      var groups = modeInfo().areas.map(function (area) {
        var list = orderedTasks.filter(function (t) { return t.area === area.id; });
        list.sort(function (a, b) { return tiers.indexOf(a.tier) - tiers.indexOf(b.tier); });
        return { area: area, tasks: list, key: state.mode + ':' + area.id };
      }).filter(function (g) { return g.tasks.length; });
      if (isNarrow()) {
        var box = document.getElementById('crucible-tests-narrow');
        groups.forEach(function (g) {
          var open = !!openAreas[g.key];
          var group = box.appendChild(el('div', { class: 'crucible-area-narrow' + (open ? ' is-open' : '') }));
          group.appendChild(areaToggle(g.area, g.tasks, s.cfg, g.key, open));
          if (open) {
            var ul = group.appendChild(el('ul', { class: 'crucible-cards' }));
            g.tasks.forEach(function (t) { taskCard(s, t, ul, toolCalls); });
          }
        });
        return;
      }
      var columns = ['Task', 'Score (mean)', 'Time'].concat(toolCalls ? ['Tool calls'] : [], ['Tokens out', 'Cost', 'Runs']);
      var head = el('tr');
      columns.forEach(function (c) { head.appendChild(el('th', { scope: 'col' }, c)); });
      table.appendChild(el('thead')).appendChild(head);
      groups.forEach(function (g) {
        var open = !!openAreas[g.key];
        var body = table.appendChild(el('tbody', { class: 'crucible-area' + (open ? ' is-open' : '') }));
        var groupRow = el('tr', { class: 'crucible-group crucible-area-row' });
        var th = el('th', { colspan: columns.length, scope: 'rowgroup' });
        th.appendChild(areaToggle(g.area, g.tasks, s.cfg, g.key, open));
        groupRow.appendChild(th);
        body.appendChild(groupRow);
        if (open) g.tasks.forEach(function (t) { taskRow(s, t, columns, body, toolCalls); });
      });
    }

    // ---- Compare ----------------------------------------------------------

    function toggleCompare(slug) {
      var i = state.compare.indexOf(slug);
      if (i !== -1) state.compare.splice(i, 1);
      else {
        if (state.compare.length >= MAX_COMPARE) state.compare.shift();
        state.compare.push(slug);
      }
      render();
    }

    // Two to four setups side by side on the tasks all of them have counted runs of (V.compare);
    // this draws its numbers
    function renderCompare() {
      var cmp = V.compare(state.compare);
      var candidates = cmp.candidates, chosen = cmp.chosen;

      var pick = document.getElementById('compare-pick');
      fillSelect(pick, [{ value: '', label: chosen.length >= MAX_COMPARE ? 'Up to ' + MAX_COMPARE + ' setups' : 'Pick a setup to add…' }].concat(
        candidates.filter(function (s) { return state.compare.indexOf(s.cfg.slug) === -1; }).map(function (s) {
          return { value: s.cfg.slug, label: rowLabel(s.cfg) + ' · ' + s.cfg.where + ' · ' + configLabel(s.cfg) };
        })), '');
      pick.disabled = chosen.length >= MAX_COMPARE;

      var chips = document.getElementById('compare-chips');
      chips.innerHTML = '';
      chosen.forEach(function (s) {
        var li = chips.appendChild(el('li', { class: 'crucible-compare-chip' }));
        li.appendChild(nameNode(s.label));
        li.appendChild(whereTag(s.cfg));
        li.appendChild(el('span', { class: 'crucible-config-label' }, ' ' + configLabel(s.cfg)));
        var x = li.appendChild(el('button', { type: 'button', class: 'crucible-link-button', 'aria-label': 'Remove ' + s.label + ' from the comparison' }, '✕'));
        x.addEventListener('click', function () { toggleCompare(s.cfg.slug); });
      });

      var sub = document.getElementById('compare-sub');
      var table = document.getElementById('crucible-compare');
      var box = document.getElementById('crucible-compare-narrow');
      table.innerHTML = '';
      box.innerHTML = '';
      var link = document.getElementById('compare-link');
      link.hidden = chosen.length < 2;
      if (chosen.length < 2) {
        sub.textContent = 'Pick two to four setups (a model at a reasoning level, on one quant, device or provider, and harness), local or cloud, to see them side by side on the tasks they all ran in this suite. "+ compare" on any leaderboard row adds it here.';
        return;
      }
      var sharedTasks = cmp.sharedTasks;
      sub.textContent = sharedTasks.length
        ? sharedTasks.length + ' scored task' + (sharedTasks.length === 1 ? '' : 's') + (chosen.length === 2 ? ' both setups ran in ' : ' all ' + chosen.length + ' setups ran in ') + suiteName(S.cat) +
          '. Tier scores below use only these, so no setup gains from a task another skipped. Scores are the mean of repeat runs (n and range under each).'
        : 'These setups have no scored task in common in ' + suiteName(S.cat) + ' yet.';
      if (!sharedTasks.length) return;

      var tierRowsData = cmp.tiers, extra = cmp.extra, taskCell = cmp.cell, best = C.bestOf;

      if (isNarrow()) {
        var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
        chosen.forEach(function (s, k) {
          var li = modelCard(s, ul);
          tierRowsData.forEach(function (r) { kvRow(li, r.tier.label + ' (shared)', fmtScore(r.scores[k].score)); });
          kvRow(li, 'Time / task', fmtSeconds(extra[k].time));
          kvRow(li, 'Cost / task', fmtCost(extra[k].cost, s.local));
        });
        sharedTasks.forEach(function (t) {
          var li = ul.appendChild(el('li', { class: 'crucible-card' }));
          var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
          title.appendChild(el('span', { class: 'crucible-test-id' }, taskName(t)));
          title.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, tierLabel(t.tier)));
          chosen.forEach(function (s) {
            var a = taskCell(s, t);
            var v = el('span', { class: 'crucible-kv-value' });
            v.appendChild(el('span', { class: 'crucible-score-num' }, fmtScore(a.mean)));
            v.appendChild(el('span', { class: 'crucible-repeat' }, ' ' + fmtRepeat(a)));
            kvRow(li, s.label + ' · ' + s.cfg.where, v);
          });
        });
        return;
      }

      var head = el('tr');
      head.appendChild(el('th', { scope: 'col' }, 'Task'));
      chosen.forEach(function (s) {
        var th = head.appendChild(el('th', { scope: 'col', class: 'crucible-compare-col' }));
        th.appendChild(nameNode(s.label));
        th.appendChild(whereTag(s.cfg));
        th.appendChild(el('span', { class: 'crucible-config-line' }, configLabel(s.cfg)));
      });
      table.appendChild(el('thead')).appendChild(head);
      var body = table.appendChild(el('tbody'));
      function numRow(label, cells, cls) {
        var row = body.appendChild(el('tr', { class: cls || '' }));
        row.appendChild(el('th', { scope: 'row' }, label));
        cells.forEach(function (c) { row.appendChild(c); });
      }
      tierRowsData.forEach(function (r) {
        var top = best(r.scores.map(function (x) { return x.score; }));
        numRow(r.tier.label + ' on shared tasks', r.scores.map(function (x) {
          var td = el('td', { class: 'crucible-compare-num' + (top !== null && x.score === top ? ' is-best' : '') }, fmtScore(x.score));
          td.appendChild(el('span', { class: 'crucible-repeat' }, ' ' + x.scored + '/' + x.total + ' tasks'));
          return td;
        }), 'crucible-compare-tier');
      });
      numRow('Time / task (median)', extra.map(function (x) { return el('td', { class: 'crucible-compare-num' }, fmtSeconds(x.time)); }), 'crucible-compare-tier');
      numRow('Cost / task', extra.map(function (x, k) {
        return el('td', { class: 'crucible-compare-num', title: costTitle(chosen[k]) }, fmtCost(x.cost, chosen[k].local));
      }), 'crucible-compare-tier');
      var lastTier = null;
      sharedTasks.forEach(function (t) {
        if (t.tier !== lastTier) {
          lastTier = t.tier;
          body.appendChild(el('tr', { class: 'crucible-group' })).appendChild(el('th', { colspan: chosen.length + 1, scope: 'rowgroup' }, tierLabel(t.tier)));
        }
        var aggs = chosen.map(function (s) { return taskCell(s, t); });
        var top = best(aggs.map(function (a) { return a.mean; }));
        numRow(taskName(t), aggs.map(function (a) {
          var td = el('td', { class: 'crucible-compare-num' + (top !== null && a.mean === top ? ' is-best' : '') });
          td.appendChild(el('span', { class: 'crucible-compare-chip-score', style: heatStyle(a.mean) }, fmtScore(a.mean)));
          td.appendChild(el('span', { class: 'crucible-repeat' }, ' ' + fmtRepeat(a)));
          return td;
        }));
      });
    }

    document.getElementById('compare-pick').addEventListener('change', function (e) {
      if (e.target.value) toggleCompare(e.target.value);
    });
    document.getElementById('compare-link').addEventListener('click', function () {
      var url = location.href;
      var btn = this;
      function done() { btn.textContent = 'Link copied'; setTimeout(function () { btn.textContent = 'Copy link'; }, 1500); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link', url); });
      else window.prompt('Copy this link', url);
    });

    // ---- How scores are made ----------------------------------------------

    // From the suite itself: how many scored tasks each method covers. A pinned task whose method
    // has no published score records (older suites pinned some) is named as unscored here.
    function renderCaveat() {
      var p = document.getElementById('crucible-caveat');
      var active = S.tasks.filter(function (t) { return t.status === 'active'; });
      var published = {};
      Object.keys(store.scores).forEach(function (k) { published[store.scores[k].method] = true; });
      var counts = {}, unscored = [];
      active.forEach(function (t) {
        var mth = t.scoring_method || 'unknown';
        if (!published[mth]) { unscored.push(t); return; }
        counts[mth] = (counts[mth] || 0) + 1;
      });
      p.innerHTML = '';
      var methods = Object.keys(counts);
      if (!methods.length) { p.hidden = true; return; }
      p.hidden = false;
      p.appendChild(el('strong', {}, 'How scores are made. '));
      var parts = methods.map(function (mth) {
        var fb = FB_METHODS[mth] || {};
        return counts[mth] + ' by ' + (fb.label || mth) + (fb.blurb ? ' (' + fb.blurb + ')' : '');
      });
      p.appendChild(document.createTextNode('Every score in ' + suiteName(S.cat) + ' is computed automatically, the same way every time: ' +
        parts.join(', and ') + '. Repeat runs of a setup are averaged. '));
      if (unscored.length) {
        p.appendChild(document.createTextNode(unscored.length + ' task' + (unscored.length === 1 ? '' : 's') + ' this suite pinned ' +
          (unscored.length === 1 ? 'has' : 'have') + ' no automatic score (' + unscored.map(taskName).join(', ') + '), so ' +
          (unscored.length === 1 ? 'it is' : 'they are') + ' left out of every score here. '));
      }
      p.appendChild(document.createTextNode('Each rule is listed on the '));
      p.appendChild(el('a', { href: '/crucible/about/' }, 'About'));
      p.appendChild(document.createTextNode(' page.'));
    }

    function renderFootnote() {
      var cat = S.cat;
      document.getElementById('crucible-footnote').textContent = suiteName(cat) +
        (cat.suite.cut_at ? ', cut ' + fmtDate(cat.suite.cut_at) : '') + (cat.crucible_version ? '; catalog published by Crucible ' + cat.crucible_version : '') + '. ' +
        NONE + ' means the harness didn\'t report that number. Cost per task is the provider\'s billed cost where reported; for local runs (marked ≈) it\'s the electricity used, ' +
        'estimated from the run\'s time, the machine\'s power draw and the average US price per kWh, and leaves out the hardware itself. ' +
        'Token counts aren\'t comparable across harnesses. Time and cost are each setup\'s own: local time depends on the hardware named.';
    }

    // ---- Render -----------------------------------------------------------

    function render() {
      applyLayout();
      selectMode();
      writeHash();
      var list = rankedRows();
      currentList = list;
      renderSuite();
      renderControls(list);
      renderTakeaways(list);
      renderLeaderboard(list);
      renderScatter(list);
      renderMatrix(list);
      renderHeatmap(list);
      renderTasks(renderDetailPicker(list));
      renderCompare();
      renderCaveat();
      renderFootnote();
    }

    document.getElementById('suite-select').addEventListener('change', function (e) {
      useSuite(e.target.value);
      render();
    });
    document.getElementById('hw-select').addEventListener('change', function (e) {
      state.hw = e.target.value;
      if (state.hw === 'cloud' && state.where === 'local') state.where = 'all';
      if (state.hw !== 'all' && state.hw !== 'cloud' && state.where === 'cloud') state.where = 'all';
      render();
    });
    document.getElementById('detail-model').addEventListener('change', function (e) {
      state.detailRow = e.target.value;
      state.detailCfg = null;
      renderTasks(renderDetailPicker(currentList));
    });
    document.getElementById('detail-config').addEventListener('change', function (e) {
      state.detailCfg = e.target.value;
      renderTasks(renderDetailPicker(currentList));
    });

    // Links to #chat, #agentic&suite=v2 or a compare URL switch views without a reload
    window.addEventListener('hashchange', function () {
      var before = [state.mode, state.suite, state.compare.join(',')].join('|');
      applyHash();
      if ([state.mode, state.suite, state.compare.join(',')].join('|') !== before) render();
    });

    var relayout = C.onLayoutChange(render);
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { relayout(); renderScatter(currentList); }, 150);
    });

    state.mode = '';
    useSuite(state.suite);
    applyHash();
    resultsEl.hidden = false;
    render();
  }

  C.boot({ script: script, ready: start });
})();
