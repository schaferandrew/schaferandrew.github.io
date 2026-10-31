// Crucible results: a suite, a leaderboard, then the views below it.
// Loading, the record join, counting rules, scores and the run detail panel are CrucibleCore's
// (crucible-core.js, loaded first); this file draws the main page from them. Everything shown comes
// from the records: modes, areas, tiers, thresholds and their text come from the selected suite's
// catalog, and anything the page doesn't recognize renders generically instead of throwing.
(function () {
  var C = window.CrucibleCore;
  var NONE = C.NONE, COLORS = C.COLORS, MAX_COMPARE = C.MAX_COMPARE, AGG = C.AGG;
  var cap = C.cap, pct = C.pct, median = C.median;
  var fmtScore = C.fmtScore, fmtSeconds = C.fmtSeconds, fmtUsd = C.fmtUsd, fmtDate = C.fmtDate, fmtTps = C.fmtTps, tpsTitle = C.tpsTitle;
  var heatStyle = C.heatStyle, el = C.el, svg = C.svg, whereTag = C.whereTag, taskName = C.taskName;
  var segmented = C.segmented, fillSelect = C.fillSelect, kvRow = C.kvRow, isNarrow = C.isNarrow;
  var script = document.currentScript;
  var resultsEl = document.getElementById('crucible-results');

  function start(D) {
    var store = D.store, CURRENT = D.CURRENT, suiteId = D.suiteId, suiteName = D.suiteName;
    var FB_METHODS = D.FB.scoring_methods || {};
    var configLabel = D.configLabel, hwValue = D.hwValue, AGG_LABEL = D.AGG_LABEL;
    var SORT_KEYS = [AGG, 'time', 'tps', 'cost', 'model'];

    // ---- State ------------------------------------------------------------

    var state = {
      suite: suiteId(CURRENT), mode: '', harness: 'best', where: 'all', hw: 'all', showInProgress: false,
      scatter: 'time', sort: null, open: {},
      exclude: {}  // tier ID -> true: tiers the reader left out of the overall score
    };
    var S = null, V = null;
    function useSuite(id) {
      var cat = D.catalogById(id) || CURRENT;
      state.suite = suiteId(cat);
      S = D.suite(state.suite);
      if (!S.MODES.some(function (m) { return m.id === state.mode; })) state.mode = S.MODES[0] ? S.MODES[0].id : '';
      if (!state.sort || (!S.tierSeen[state.sort.key] && SORT_KEYS.indexOf(state.sort.key) === -1)) state.sort = { key: AGG, dir: -1 };
    }

    // The hash holds the section, the suite and the tiers left out of the overall score:
    // #agentic&suite=v2&exclude=forge. An old #chat&compare=a,b link moves to the compare page (the
    // comparison lives there now), keeping the suite.
    function readHash() {
      var h = C.parseHash();
      var v = h.params.compare, x = h.params.exclude;
      return { mode: h.id, suite: h.params.suite || null, compare: v ? v.split(',').filter(Boolean) : [], exclude: x ? x.split(',').filter(Boolean) : [] };
    }
    function redirectCompare(h) {
      if (!h.compare.length) return false;
      location.replace(C.compareUrl(h.compare.slice(0, MAX_COMPARE), h.suite));
      return true;
    }
    function applyHash() {
      var h = readHash();
      if (h.mode) state.mode = h.mode;
      useSuite(h.suite && D.catalogById(h.suite) ? h.suite : state.suite);
      state.exclude = {};
      h.exclude.forEach(function (id) { state.exclude[id] = true; });
    }
    function writeHash() {
      var hash = C.buildHash(state.mode, { suite: state.suite !== suiteId(CURRENT) ? state.suite : null });
      var excluded = MODE_TIERS.filter(function (t) { return state.exclude[t.id]; }).map(function (t) { return encodeURIComponent(t.id); });
      if (excluded.length && !aggAll()) hash += (hash.length > 1 ? '&' : '') + 'exclude=' + excluded.join(',');
      if (location.hash !== hash && history.replaceState) history.replaceState(null, '', hash);
    }

    var modelRef = D.modelRef, modelLink = D.modelLink, modelCard = D.modelCard;

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
      var keyOk = MODE_TIERS.some(function (t) { return t.id === state.sort.key; }) || SORT_KEYS.indexOf(state.sort.key) !== -1;
      if (!keyOk) state.sort = { key: V.head().id, dir: -1 };
    }
    // The overall score's tiers, as the reader's toggles leave them (the core's V.aggTiers)
    function aggTiers() { return V.aggTiers(state.exclude); }
    function aggAll() { return V.aggAll(state.exclude); }
    function aggTierNames() { return V.aggTierNames(state.exclude); }
    function showAgg() { return V.showAgg(); }
    function aggInfo() { return V.aggInfo(); }
    function isExcluded(t) { return !!state.exclude[t.id] && showAgg(); }

    function cellOf(cfg, taskId) { return S.cellOf(cfg, taskId); }
    function modeConfigsAll() { return V.configs(); }
    function passesFilters(cfg) {
      if (state.where !== 'all' && (state.where === 'local') !== cfg.local) return false;
      if (state.hw !== 'all' && hwValue(cfg) !== state.hw) return false;
      if (state.harness !== 'best' && cfg.harness !== state.harness) return false;
      return true;
    }

    // ---- Scores -----------------------------------------------------------

    function rowsAll() { return V.rows(passesFilters, state.exclude); }
    function showingInProgress(rows) { return state.showInProgress || V.noneFinished(rows); }

    function rankedRows() {
      var all = rowsAll();
      var showAll = showingInProgress(all);
      var list = all.filter(function (s) { return showAll || !s.inProgress; });
      return V.sortRows(list, state.sort);
    }

    // ---- Layout -----------------------------------------------------------

    function applyLayout() {
      C.applyLayout(['crucible-lb', 'crucible-matrix', 'crucible-heatmap']);
    }

    // ---- Controls ---------------------------------------------------------

    // Suite selector, newest first, and the suite line: version, task counts, cut date, changelog
    function renderSuite() { D.renderSuiteBar(S); }

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
      renderAggToggle();
      segmented('scatter-toggle', [
        { value: 'time', label: 'Time per task' }, { value: 'cost', label: 'Cost per task' }
      ], state.scatter, function (m) { state.scatter = m; render(); });
    }

    // Which tiers the overall score includes: one toggle per tier, at least one always on
    function renderAggToggle() {
      var bar = document.getElementById('agg-bar'), group = document.getElementById('agg-toggle');
      bar.hidden = !showAgg();
      group.innerHTML = '';
      if (!showAgg()) return;
      document.getElementById('agg-label').textContent = AGG_LABEL + ' includes';
      var on = aggTiers();
      MODE_TIERS.forEach(function (t) {
        var pressed = on.indexOf(t) !== -1, last = pressed && on.length === 1;
        var b = el('button', { type: 'button', class: 'crucible-segment', 'aria-pressed': pressed }, (pressed ? '✓ ' : '') + t.label);
        b.title = last ? 'The ' + AGG_LABEL + ' score needs at least one tier' : (pressed ? 'Leave ' : 'Add ') + t.label + (pressed ? ' out of ' : ' to ') + 'the ' + AGG_LABEL + ' score';
        if (last) b.setAttribute('aria-disabled', 'true');
        b.addEventListener('click', function () {
          if (last) return;
          if (pressed) state.exclude[t.id] = true;
          else delete state.exclude[t.id];
          render();
        });
        group.appendChild(b);
      });
      document.getElementById('agg-note').textContent = aggAll() ? '' : 'Showing ' + aggTierNames() + ' only.';
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
      var H = aggInfo();
      var ranked = list.filter(function (s) { return s.overall.score !== null && !s.overall.partial && !s.inProgress; })
        .sort(function (a, b) { return b.overall.score - a.overall.score; });
      var lines = [];
      if (ranked.length) {
        var top = ranked.slice(0, 2);
        var tail = filterPhrase() ? ' ' + filterPhrase() : '';
        var what = showAgg() ? 'on ' + aggTierNames() + ' together' : 'the ' + H.label + ' tasks';
        lines.push(top.length > 1 ? [top[0], ' and ', top[1], ' lead ' + what + tail + '.'] : [top[0], ' leads ' + what + tail + '.']);
        var local = ranked.filter(function (s) { return s.local; })[0];
        if (local && state.where !== 'cloud') {
          lines.push(['The best local model is ', local, ' at ' + fmtScore(local.overall.score) + ', on ' + configLabel(local.cfg) + '.']);
        }
        var priced = ranked.filter(function (s) { return !s.local && s.cost; });
        if (priced.length > 1) {
          var value = priced.slice().sort(function (a, b) { return b.overall.score / b.cost - a.overall.score / a.cost; })[0];
          lines.push([value, ' gives the most ' + H.label + ' score per dollar (' + fmtUsd(value.cost) + ' per task).']);
        }
      }
      var stretch = V.stretch()[0];
      // Counted scores only: a provisional score never headlines a sentence
      var countedOf = function (s) { var r = stretch && s.tier[stretch.id]; return r && r.score !== null && !r.partial ? r.score : null; };
      var best = stretch && list.filter(function (s) { return countedOf(s) !== null; })
        .sort(function (a, b) { return countedOf(b) - countedOf(a); })[0];
      if (best) lines.push([best, ' scores highest on the ' + stretch.label + ' tasks (' + fmtScore(countedOf(best)) + ').']);
      if (!lines.length) lines.push('No model has a complete ' + H.label + ' score' + (filterPhrase() ? ' ' + filterPhrase() : ' in this section') + ' yet.');
      lines.forEach(function (line) {
        var li = ul.appendChild(el('li'));
        [].concat(line).forEach(function (part) {
          li.appendChild(typeof part === 'string' ? document.createTextNode(part) : modelLink(part));
        });
      });
    }

    function renderLeaderboardNote() {
      var parts = [showAgg()
        ? 'Ranked by ' + AGG_LABEL + ' score (0–' + V.aggMax(state.exclude) + '): ' + (aggTiers().length > 1 ? 'the ' + aggTierNames() + ' scores added together, each out of 10. ' : 'the ' + aggTierNames() + ' score alone. ') +
          'Choose which tiers it includes above; a model missing one of them isn\'t ranked until you leave that tier out.'
        : 'Ranked by ' + aggInfo().label + ' score (0–10).'];
      MODE_TIERS.forEach(function (t) {
        if (gateOf(t.id)) parts.push(t.label + ' is also a pass/fail gate: a ' + t.label + ' score of at least ' + gateOf(t.id).mean + ', with no task below ' + gateOf(t.id).min + '.');
      });
      parts.push('Each row is one model at one reasoning level, local or cloud, scored by its single best setup (named under it); "best of N setups" lists the others.' +
        ' Repeat runs are averaged. Cloud providers usually serve full precision, so a row shows what a model can do, not what it does on your hardware.');
      parts.push('A hatched bar means fewer than ' + pct(S.COVERAGE_MIN) + ' of that tier\'s tasks were scored' + (showAgg() ? ' (for ' + AGG_LABEL + ', that one of its tiers is short)' : '') + '. Select a column to sort.');
      document.getElementById('leaderboard-sub').textContent = parts.join(' ');
    }

    // ---- Leaderboard -------------------------------------------------------

    function tierCellContent(s, t, into) { S.tierCell(s, t, into); }
    function rankLabel(s, rank) { return V.isRanked(s) ? String(rank) : ''; }
    var costLabel = D.costLabel, costTitle = D.costTitle;

    // The compare selection: setup slugs kept in sessionStorage, up to four. Two or more open the compare page.
    var STORE_KEY = 'crucible-compare';
    var picked = [];
    try { picked = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]').filter(function (x) { return typeof x === 'string'; }).slice(0, MAX_COMPARE); } catch (e) { picked = []; }
    function savePicked() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(picked)); } catch (e) { /* storage blocked */ } }
    function togglePicked(slug) {
      var i = picked.indexOf(slug);
      if (i !== -1) picked.splice(i, 1);
      else { if (picked.length >= MAX_COMPARE) picked.shift(); picked.push(slug); }
      savePicked();
      renderLeaderboard(currentList);
      renderTray();
    }
    function renderTray() {
      var tray = document.getElementById('compare-tray');
      tray.innerHTML = '';
      tray.hidden = !picked.length;
      if (!picked.length) return;
      if (picked.length > 1) tray.appendChild(el('a', { class: 'crucible-compare-go', href: C.compareUrl(picked) }, 'Compare ' + picked.length + ' →'));
      else tray.appendChild(el('span', { class: 'crucible-compare-hint' }, '1 setup picked: pick another to compare'));
      var clear = tray.appendChild(el('button', { type: 'button', class: 'crucible-link-button' }, 'Clear'));
      clear.addEventListener('click', function () { picked = []; savePicked(); renderLeaderboard(currentList); renderTray(); });
    }

    function compareButton(cfg) {
      var on = picked.indexOf(cfg.slug) !== -1;
      var b = el('button', { type: 'button', class: 'crucible-link-button', 'aria-pressed': on }, on ? 'picked ✓' : '+ compare');
      b.title = on ? 'Remove this setup from the comparison' : 'Add this setup to a comparison (two to ' + MAX_COMPARE + ')';
      b.addEventListener('click', function (e) { e.stopPropagation(); togglePicked(cfg.slug); });
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
      if (!isVariant) top.appendChild(modelRef(s, s.inProgress ? ' *' : ''));
      top.appendChild(whereTag(s.cfg));
      var cfgLine = into.appendChild(el('span', { class: 'crucible-config-line' }));
      cfgLine.appendChild(el('span', { class: 'crucible-config-label' }, configLabel(s.cfg)));
      if (isVariant) cfgLine.appendChild(el('span', { class: 'crucible-config-n' }, ' · ' + s.runs + ' counted run' + (s.runs === 1 ? '' : 's')));
      var actions = into.appendChild(el('span', { class: 'crucible-config-actions' }));
      if (!isVariant) { var vt = variantToggle(s); if (vt) actions.appendChild(vt); }
      actions.appendChild(compareButton(s.cfg));
    }

    // The overall score first (when there's more than one tier), then each tier
    function scoreColumns() { return (showAgg() ? [aggInfo()] : []).concat(MODE_TIERS); }

    var currentList = [];
    function renderLeaderboard(list) {
      renderLeaderboardNote();
      var table = document.getElementById('crucible-leaderboard');
      table.innerHTML = '';
      if (isNarrow()) { renderLeaderboardCards(list); return; }
      document.getElementById('crucible-lb-narrow').innerHTML = '';
      var columns = [{ key: null, label: '#' }, { key: 'model', label: 'Model and best setup' }]
        .concat(scoreColumns().map(function (t) { return { key: t.id, label: t.label, title: t.id === AGG ? aggTierNames() + (aggTiers().length > 1 ? ' added together, out of ' : ' alone, out of ') + V.aggMax(state.exclude) : t.blurb ? cap(t.blurb) : '' }; }))
        .concat([{ key: 'time', label: 'Time / task' }, { key: 'tps', label: 'tok/s', title: 'Decode speed: output tokens per second of generation (median)' }, { key: 'cost', label: 'Cost / task' }]);
      var head = el('tr');
      columns.forEach(function (c) {
        var th = el('th', { scope: 'col' });
        if (c.title) th.title = c.title;
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
        scoreColumns().forEach(function (t) {
          var td = el('td', { class: 'crucible-lb-bar-cell' + (t.id === AGG ? ' is-overall' : '') + (isExcluded(t) ? ' is-excluded' : '') });
          tierCellContent(s, t, td);
          row.appendChild(td);
        });
        row.appendChild(el('td', { class: 'crucible-lb-num' }, fmtSeconds(s.time)));
        row.appendChild(el('td', { class: 'crucible-lb-num', title: tpsTitle(s.tps, s.runs) }, fmtTps(s.tps.value, true)));
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
      // Scores and decode speed sort high-first by default; time, cost and names low-first
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
      scoreColumns().map(function (t) { return [t.id, t.label]; }).concat([['time', 'Time / task'], ['tps', 'Decode speed'], ['cost', 'Cost / task'], ['model', 'Model']]).forEach(function (o) {
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
        var tierList = scoreColumns().sort(function (x, y) { return (y.id === state.sort.key) - (x.id === state.sort.key); });
        tierList.forEach(function (t) {
          var row = card.appendChild(el('div', { class: 'crucible-lb-card-score' + (t.id === state.sort.key ? ' is-sorted' : '') + (isExcluded(t) ? ' is-excluded' : '') }));
          row.appendChild(el('span', { class: 'crucible-lb-card-label' }, t.label));
          tierCellContent(s, t, row);
        });
        var parts = [['time', 'Time ', fmtSeconds(s.time) + '/task'], ['tps', 'Decode ', fmtTps(s.tps.value)], ['cost', 'Cost ', costLabel(s) + '/task']];
        var line = card.appendChild(el('p', { class: 'crucible-lb-card-line' }));
        var sorted = parts.filter(function (p) { return p[0] === state.sort.key; })[0];
        if (sorted) line.appendChild(el('strong', {}, sorted[1] + sorted[2]));
        var rest = parts.filter(function (p) { return p !== sorted; }).map(function (p) { return p[0] === 'tps' ? 'decode ' + p[2] : p[2]; });
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
      var tipTimer;
      tooltip.onmouseenter = function () { clearTimeout(tipTimer); };
      tooltip.onmouseleave = function () { tooltip.hidden = true; };
      container.innerHTML = '';
      tooltip.hidden = true;
      var H = aggInfo(), measure = state.scatter;
      document.getElementById('scatter-measure-label').textContent = measure === 'time' ? 'time' : 'cost';
      function xOf(s) { return measure === 'time' ? s.time : s.cost; }

      var points = list.filter(function (s) { var x = xOf(s); return s.overall.score !== null && x !== null && x > 0; });
      var skippedLocal = measure === 'cost' && list.some(function (s) { return s.local && s.overall.score !== null && s.cost === null; });
      var what = H.label + ' score' + (showAgg() && !aggAll() ? ' (' + aggTierNames() + ')' : '');
      document.getElementById('scatter-sub').textContent = measure === 'time'
        ? what + ' against median time per task, for each row\'s best setup. Up and to the left is better: the shaded corner is faster and better than the median, and the line joins models nothing else beats on both.'
        : what + ' against average cost per task: the API bill for cloud models, the estimated electricity for local ones. Up and to the left is better.' +
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
      var yMax = V.aggMax(state.exclude);
      function y(v) { return m.top + (1 - v / yMax) * (height - m.top - m.bottom); }

      var root = svg('svg', {
        class: 'crucible-chart-svg', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img',
        'aria-label': what + ' against ' + (measure === 'time' ? 'time' : 'cost') + ' per task. The leaderboard has the same numbers.'
      });
      var medX = median(xs), medY = median(points.map(function (s) { return s.overall.score; }));
      root.appendChild(svg('rect', { class: 'crucible-quadrant', x: m.left, y: m.top, width: Math.max(0, x(medX) - m.left), height: Math.max(0, y(medY) - m.top) }));
      [0, yMax / 2, yMax].forEach(function (v) {
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
      sorted.forEach(function (s) { if (s.overall.score > best) { frontier.push(s); best = s.overall.score; } });
      if (frontier.length > 1) {
        root.appendChild(svg('path', { class: 'crucible-frontier', d: frontier.map(function (s, i) {
          return (i ? 'L' : 'M') + x(xOf(s)).toFixed(1) + ' ' + y(s.overall.score).toFixed(1);
        }).join(' ') }));
      }
      // Wide: name the points (all of them when few, else the frontier). Narrow: number every
      // point and list the numbers under the chart, so no label is dropped or overlaps
      var labelAll = points.length <= 16;
      var key = document.getElementById('crucible-scatter-key');
      key.innerHTML = '';
      key.hidden = !narrow;
      var byScore = points.slice().sort(function (a, b) { return b.overall.score - a.overall.score || xOf(a) - xOf(b); });
      points.forEach(function (s) {
        var px = x(xOf(s)), py = y(s.overall.score);
        var color = s.local ? COLORS.local : COLORS.cloud;
        root.appendChild(svg('circle', { class: 'crucible-dot' + (s.overall.partial ? ' is-uncounted' : ''), cx: px, cy: py, r: 6,
          fill: s.overall.partial ? '#fff' : color, stroke: s.overall.partial ? color : '#fff' }));
        if (narrow) {
          root.appendChild(svg('text', { class: 'crucible-point-label crucible-point-num', x: px + 8, y: py - 7 }, String(byScore.indexOf(s) + 1)));
        } else if (labelAll || frontier.indexOf(s) !== -1) {
          // A label that would run past the plot's right edge sits to the left of its point
          var flip = px + 9 + s.label.length * 7 > width;
          root.appendChild(svg('text', { class: 'crucible-point-label', x: flip ? px - 9 : px + 9, y: py - 8, 'text-anchor': flip ? 'end' : 'start' }, s.label));
        }
        var hit = svg('circle', { class: 'crucible-hit', cx: px, cy: py, r: 14 });
        hit.addEventListener('mouseenter', function () {
          clearTimeout(tipTimer);
          tooltip.innerHTML = '';
          var tipTitle = tooltip.appendChild(el('div', { class: 'crucible-tooltip-title' }));
          tipTitle.appendChild(modelRef(s));
          tipTitle.appendChild(document.createTextNode(' · ' + s.cfg.where));
          tooltip.appendChild(el('div', { class: 'crucible-tooltip-note' }, configLabel(s.cfg)));
          tooltip.appendChild(el('div', {}, H.label + ' ' + fmtScore(s.overall.score) + (s.overall.partial ? ' (partial)' : '')));
          tooltip.appendChild(el('div', {}, 'Time per task ' + fmtSeconds(s.time) + ' · cost ' + costLabel(s)));
          tooltip.hidden = false;
          var left = px + 14;
          if (left + tooltip.offsetWidth > container.clientWidth) left = px - 14 - tooltip.offsetWidth;
          tooltip.style.left = Math.max(0, left - container.scrollLeft) + 'px';
          tooltip.style.top = Math.max(0, py - 20) + 'px';
        });
        hit.addEventListener('mouseleave', function () { tipTimer = setTimeout(function () { tooltip.hidden = true; }, 250); });
        root.appendChild(hit);
      });
      container.appendChild(root);
      if (narrow) {
        byScore.forEach(function (s, i) {
          var li = key.appendChild(el('li', {}));
          var sw = li.appendChild(el('span', { class: 'crucible-scatter-swatch', 'aria-hidden': 'true' }));
          sw.style.background = s.local ? COLORS.local : COLORS.cloud;
          li.appendChild(el('strong', {}, (i + 1) + ' '));
          li.appendChild(modelLink(s));
          li.appendChild(document.createTextNode(' · ' + fmtScore(s.overall.score) + (s.overall.partial ? ' (partial)' : '') + ' · ' + (measure === 'time' ? fmtSeconds(s.time) : costLabel(s))));
        });
      }
    }

    // ---- Matrix -----------------------------------------------------------

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
        th.appendChild(el('a', { href: C.taskUrl(t.id), class: 'crucible-matrix-name' }, taskName(t)));
        idRow.appendChild(th);
      });
      var head = table.appendChild(el('thead'));
      head.appendChild(tierRow);
      head.appendChild(idRow);

      var body = table.appendChild(el('tbody'));
      rows.forEach(function (s) {
        var row = el('tr');
        var name = el('th', { scope: 'row' });
        name.appendChild(modelRef(s));
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
            var label = el('span', { class: 'crucible-kv-label', title: taskName(t) + (t.summary ? ': ' + t.summary : '') });
            label.appendChild(el('a', { href: C.taskUrl(t.id) }, taskName(t)));
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
        th.appendChild(modelRef(s));
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

    // The other pages keep the suite being looked at
    function renderDeeper() {
      var suite = state.suite !== suiteId(CURRENT) ? C.buildHash(null, { suite: state.suite }) : '';
      Array.prototype.forEach.call(document.querySelectorAll('#crucible-deeper a'), function (a) {
        var base = a.getAttribute('data-base') || a.getAttribute('href');
        a.setAttribute('data-base', base);
        a.setAttribute('href', base + suite);
      });
    }

    function renderFootnote() {
      var cat = S.cat;
      document.getElementById('crucible-footnote').textContent = suiteName(cat) +
        (cat.suite.cut_at ? ', cut ' + fmtDate(cat.suite.cut_at) : '') + (cat.crucible_version ? '; catalog published by Crucible ' + cat.crucible_version : '') + '. ' +
        NONE + ' means the harness didn\'t report that number. Cost per task is the provider\'s billed cost where reported; for local runs (marked ≈) it\'s the electricity used, ' +
        'estimated from the run\'s time, the machine\'s power draw and the average US price per kWh, and leaves out the hardware itself. ' +
        'Decode speed is output tokens (reasoning included) per second of generation, leaving out prompt processing: the median over the runs that recorded it (' + NONE + ' when none did). ' +
        'Token counts aren\'t comparable across harnesses. Time, decode speed and cost are each setup\'s own: local ones depend on the hardware named.';
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
      renderDeeper();
      renderTray();
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
    // Links to #chat or #agentic&suite=v2 switch views without a reload; an old compare link moves on
    window.addEventListener('hashchange', function () {
      if (redirectCompare(readHash())) return;
      function key() { return [state.mode, state.suite, Object.keys(state.exclude).sort().join(',')].join('|'); }
      var before = key();
      applyHash();
      if (key() !== before) render();
    });

    var relayout = C.onLayoutChange(render);
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { relayout(); renderScatter(currentList); }, 150);
    });

    if (redirectCompare(readHash())) return;
    state.mode = '';
    useSuite(state.suite);
    applyHash();
    resultsEl.hidden = false;
    render();
  }

  C.boot({ script: script, ready: start });
})();
