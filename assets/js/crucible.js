// Crucible results: a leaderboard first, then the controls that drive every view below it.
(function () {
  // _data/crucible/ holds one results bundle per file (this machine's, plus any dropped in from
  // others). Merge them: tests and settings from the newest bundle, runs from all, deduplicated by
  // run_id with the newest bundle winning.
  function mergeBundles(raw) {
    if (raw.format_version) return raw;
    var bundles = Object.keys(raw).map(function (k) { return raw[k]; })
      .filter(function (b) { return b && b.runs && b.tests; })
      .sort(function (a, b) { return a.generated_at < b.generated_at ? 1 : -1; });
    if (!bundles.length) return { runs: [], tests: [], modes: [], tiers: [], harnesses: [], category_weights: {}, generated_at: '' };
    var merged = Object.assign({}, bundles[0]), seen = {};
    merged.runs = [];
    bundles.forEach(function (b) {
      b.runs.forEach(function (r) { if (!seen[r.run_id]) { seen[r.run_id] = true; merged.runs.push(r); } });
    });
    merged.bundle_count = bundles.length;
    return merged;
  }
  var data = mergeBundles(JSON.parse(document.getElementById('crucible-data').textContent));
  // Two separate sections: chat tests (one API call) and agentic tests (tools and a workspace)
  // are never ranked together, and each mode has its own harnesses
  var MODES = data.modes || [];
  var MODE_BLURBS = { chat: 'One API call, no tools', agentic: 'An agent harness with tools and a workspace' };
  var TIER_LABELS = { spark: 'Spark', temper: 'Temper', forge: 'Forge' };
  var TIER_BLURBS = { spark: 'the basics', temper: 'everyday work', forge: 'frontier-level work' };
  var COVERAGE_MIN = 0.75; // a tier score is ranked only when this share of the tier is scored
  // A model that has finished less than this share of a section's active tests is "in progress":
  // hidden by default, listed last with an asterisk when shown
  var IN_PROGRESS_BELOW = 0.75;
  var SPARK_PASS = { mean: 8, min: 5 };
  var NONE = '—';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Two identities on the scatter: local (the point of Crucible) and cloud (the reference)
  var COLORS = { local: '#2a78d6', cloud: '#eb6834' };

  // ---- Data shaping -----------------------------------------------------

  // A model plus its reasoning level is one model here, as on Artificial Analysis:
  // "lmstudio/qwen/qwen3.5-9b#off" reads as "qwen3.5-9b (reasoning off)"
  function modelLabel(model) {
    var variant = model.split('#');
    var parts = variant[0].split('/');
    return parts[parts.length - 1] + (variant[1] ? ' (reasoning ' + variant[1] + ')' : '');
  }

  function isLocal(model) {
    return /^(ollama|lmstudio)\//.test(model);
  }

  data.runs.forEach(function (run) {
    if (run.reasoning && run.reasoning !== 'default') run.model = run.model + '#' + run.reasoning;
  });

  // Models in order of their first run, so adding a model never reorders the defaults
  var firstRun = {};
  data.runs.forEach(function (run) {
    if (!firstRun[run.model] || run.started_at < firstRun[run.model]) firstRun[run.model] = run.started_at;
  });
  var allModels = Object.keys(firstRun).sort(function (a, b) { return firstRun[a] < firstRun[b] ? -1 : 1; });

  // One score per run: automatic first (checks and hidden tests are the same every time), then a
  // person's review, then the AI judge's
  var SOURCE_LABELS = { human: 'human review', checks: 'automatic tests', agent: 'AI judge (rough)' };
  data.runs.forEach(function (run) {
    if (run.check_score !== null && run.check_score !== undefined) { run.best_score = run.check_score; run.score_source = 'checks'; }
    else if (run.score !== null && run.score !== undefined) { run.best_score = run.score; run.score_source = 'human'; }
    else if (run.agent_score !== null && run.agent_score !== undefined) { run.best_score = run.agent_score; run.score_source = 'agent'; }
    else { run.best_score = null; run.score_source = null; }
  });

  // latest[model][harness][testId] = { run: latest run, count: number of runs }
  var latest = {};
  data.runs.forEach(function (run) {
    var byHarness = (latest[run.model] = latest[run.model] || {});
    var byTest = (byHarness[run.harness] = byHarness[run.harness] || {});
    var entry = byTest[run.test_id];
    if (!entry) byTest[run.test_id] = { run: run, count: 1 };
    else {
      entry.count += 1;
      if (run.started_at > entry.run.started_at) entry.run = run;
    }
  });

  function cell(model, harness, testId) {
    return ((latest[model] || {})[harness] || {})[testId] || null;
  }

  // A run's score feeds aggregates only on the current test version and an active test
  function countedScore(c) {
    return c && c.run.counts ? c.run.best_score : null;
  }

  function mean(values) {
    values = values.filter(function (v) { return v !== null && v !== undefined; });
    if (!values.length) return null;
    return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  }

  function median(values) {
    values = values.filter(function (v) { return v !== null && v !== undefined; }).sort(function (a, b) { return a - b; });
    if (!values.length) return null;
    var mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }

  var mode = location.hash === '#agentic' ? 'agentic' : 'chat';
  function modeInfo() { return MODES.filter(function (m) { return m.id === mode; })[0] || { harnesses: [], areas: [] }; }
  function inMode(t) { return t.mode === mode && t.status !== 'retired'; }
  var modeTestIds = {};

  // Tests shown: this mode's tests that aren't retired, tier by tier, area order within a tier
  var tiers = [], orderedTests = [];
  function selectMode() {
    var areas = modeInfo().areas.map(function (a) { return a.id; });
    tiers = (data.tiers || ['temper']).filter(function (tier) {
      return data.tests.some(function (t) { return inMode(t) && t.tier === tier; });
    });
    orderedTests = [];
    tiers.forEach(function (tier) {
      areas.forEach(function (area) {
        data.tests.forEach(function (t) { if (inMode(t) && t.tier === tier && t.area === area) orderedTests.push(t); });
      });
    });
    modeTestIds = {};
    orderedTests.forEach(function (t) { modeTestIds[t.id] = true; });
  }

  // ---- Formatting -------------------------------------------------------

  function fmtScore(v) { return v === null || v === undefined ? NONE : v.toFixed(1); }
  function fmtSeconds(v) {
    if (v === null || v === undefined) return NONE;
    if (v < 60) return v.toFixed(v < 10 ? 1 : 0) + 's';
    if (v < 3600) return Math.floor(v / 60) + 'm ' + String(Math.round(v % 60)).padStart(2, '0') + 's';
    return Math.floor(v / 3600) + 'h ' + String(Math.round((v % 3600) / 60)).padStart(2, '0') + 'm';
  }
  function fmtUsd(v) {
    if (v === null || v === undefined) return NONE;
    if (v === 0) return '$0';
    return v < 0.01 ? '<$0.01' : '$' + v.toFixed(v < 1 ? 3 : 2);
  }
  function fmtInt(v) { return v === null || v === undefined ? NONE : v.toLocaleString(); }

  // Sequential scale: light to the site's secondary blue. Text flips to white on the dark half.
  function heatStyle(score) {
    if (score === null || score === undefined) return '';
    var t = Math.max(0, Math.min(1, score / 10));
    var light = [234, 242, 251], dark = [24, 86, 163];
    var rgb = light.map(function (c, i) { return Math.round(c + (dark[i] - c) * t); });
    return 'background:rgb(' + rgb.join(',') + ');color:' + (t > 0.55 ? '#fff' : '#2b2537');
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- State ------------------------------------------------------------

  function runCount(model, h) {
    return Object.keys((latest[model] || {})[h] || {}).filter(function (id) { return modeTestIds[id]; }).length;
  }

  // "best" ranks each model by its own best harness; otherwise every model uses the chosen one
  var harness = 'best';
  var where = 'all';           // all | local | cloud
  var showInProgress = false;
  var scatterMeasure = 'time'; // time | cost
  var sort = { key: 'temper', dir: -1 };
  var detailModel = null;

  // ---- Scores -----------------------------------------------------------

  // The harness a model is shown with: the chosen one, or under "best" the harness with its
  // highest Temper score. Complete coverage wins over a partial score, so a harness that can't
  // run half the tier (direct can't use tools) never outranks one that ran it all.
  var bestCache = {};
  function bestHarness(model) {
    if (bestCache[model] !== undefined) return bestCache[model];
    var candidates = modeInfo().harnesses.filter(function (h) { return runCount(model, h) > 0; }).map(function (h) {
      var t = tierScore(model, 'temper', h);
      return { h: h, complete: t.score !== null && !t.partial, score: t.score === null ? -1 : t.score, coverage: t.coverage };
    });
    candidates.sort(function (a, b) {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (!a.complete && a.coverage !== b.coverage) return b.coverage - a.coverage;
      return b.score - a.score;
    });
    return (bestCache[model] = candidates.length ? candidates[0].h : null);
  }

  function harnessFor(model) {
    if (modeInfo().harnesses.length === 1) return modeInfo().harnesses[0];
    return harness === 'best' ? bestHarness(model) : harness;
  }

  function harnessPhrase() {
    if (modeInfo().harnesses.length === 1) return modeInfo().harnesses[0];
    return harness === 'best' ? "each model's best harness" : harness;
  }

  function showsHarnessTag() { return harness === 'best' && modeInfo().harnesses.length > 1; }

  // Each active test's share of its tier: the category weight split across that category's tests
  function testWeights(tier) {
    var active = data.tests.filter(function (t) { return inMode(t) && t.tier === tier && t.status === 'active'; });
    var perCategory = {};
    active.forEach(function (t) { perCategory[t.category] = (perCategory[t.category] || 0) + 1; });
    var weights = {};
    active.forEach(function (t) { weights[t.id] = (data.category_weights[t.category] || 0) / perCategory[t.category]; });
    return weights;
  }

  // Tier score: Crucible's category weights, rescaled over the scored tests. Coverage is the
  // share of the tier's weight that was scored; below COVERAGE_MIN the score is partial.
  function tierScore(model, tier, h) {
    if (h === undefined) h = harnessFor(model);
    var weights = testWeights(tier);
    var total = 0, scoredWeight = 0, allWeight = 0, scores = [];
    Object.keys(weights).forEach(function (id) {
      allWeight += weights[id];
      var score = countedScore(cell(model, h, id));
      if (score === null) return;
      scores.push(score);
      total += score * weights[id];
      scoredWeight += weights[id];
    });
    var result = {
      score: scoredWeight ? total / scoredWeight : null,
      coverage: allWeight ? scoredWeight / allWeight : 0,
      scored: scores.length,
      total: Object.keys(weights).length,
      min: scores.length ? Math.min.apply(null, scores) : null
    };
    result.partial = result.score !== null && result.coverage < COVERAGE_MIN;
    return result;
  }

  // Provisional tests (like new Forge tests) don't count, but are worth showing on their own
  function provisionalScore(model, tier) {
    var tests = data.tests.filter(function (t) { return inMode(t) && t.tier === tier && t.status === 'provisional'; });
    var scores = tests.map(function (t) { var c = cell(model, harnessFor(model), t.id); return c ? c.run.best_score : null; });
    return { score: mean(scores), scored: scores.filter(function (s) { return s !== null; }).length, total: tests.length };
  }

  function sparkVerdict(result) {
    if (result.score === null) return null;
    if (result.partial) return 'partial';
    return result.score >= SPARK_PASS.mean && result.min >= SPARK_PASS.min ? 'pass' : 'fail';
  }

  function runsFor(model) {
    var byTest = (latest[model] || {})[harnessFor(model)] || {};
    return Object.keys(byTest).filter(function (id) { return modeTestIds[id]; }).map(function (id) { return byTest[id].run; });
  }

  // The machine and quantization most of this model's local runs used
  function hardwareLabel(model) {
    var counts = {};
    runsFor(model).forEach(function (r) {
      if (!r.inference || !r.inference.local) return;
      var hw = r.hardware || {};
      // hardware is the machine that ran the model; over LM Link that's not the one that ran crucible
      var specs = [hw.gpu || hw.cpu, hw.ram_gb ? hw.ram_gb + ' GB' : null].filter(Boolean).join(', ');
      var where = hw.hostname ? hw.hostname + (specs ? ' (' + specs + ')' : '') : null;
      if (r.inference.served_via) where = (where || 'remote') + ' via ' + r.inference.served_via;
      var label = [r.inference.quantization, where].filter(Boolean).join(' · ');
      if (label) counts[label] = (counts[label] || 0) + 1;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || null;
  }

  // Share of this section's active tests the model has a scored, current run of
  function sectionProgress(model) {
    var active = orderedTests.filter(function (t) { return t.status === 'active'; });
    var done = active.filter(function (t) { return countedScore(cell(model, harnessFor(model), t.id)) !== null; }).length;
    return { done: done, total: active.length, share: active.length ? done / active.length : 0 };
  }

  function stats(model) {
    var runs = runsFor(model).filter(function (r) { return r.counts; });
    var progress = sectionProgress(model);
    var spark = tierScore(model, 'spark');
    var forge = tierScore(model, 'forge');
    var provisional = provisionalScore(model, 'forge');
    return {
      model: model,
      harness: harnessFor(model),
      local: isLocal(model),
      ran: runsFor(model).length > 0,
      spark: spark,
      sparkVerdict: sparkVerdict(spark),
      temper: tierScore(model, 'temper'),
      forge: forge.total ? forge : null,
      forgeProvisional: provisional.total ? provisional : null,
      time: median(runs.map(function (r) { return r.elapsed_s; })),
      // Local inference has no API bill; show $0 rather than unknown
      cost: isLocal(model) ? 0 : mean(runs.map(function (r) { return r.cost_usd; })),
      hardware: hardwareLabel(model),
      progress: progress,
      inProgress: progress.share < IN_PROGRESS_BELOW
    };
  }

  function forgeValue(s) {
    if (s.forge && s.forge.score !== null) return s.forge.score;
    return s.forgeProvisional ? s.forgeProvisional.score : null;
  }

  var SORT_VALUES = {
    model: function (s) { return modelLabel(s.model).toLowerCase(); },
    spark: function (s) { return s.spark.score; },
    temper: function (s) { return s.temper.score; },
    forge: forgeValue,
    time: function (s) { return s.time; },
    cost: function (s) { return s.cost; }
  };

  // Models matching the filter, ranked by the current sort; unrun and unscored rows sink
  // In progress is hidden by default, but when no model has finished a section yet (say new
  // tests just went active), an empty leaderboard helps no one: show everyone, and say why
  function noneFinished() {
    return !allModels.some(function (m) {
      return modeInfo().harnesses.some(function (h) { return runCount(m, h) > 0; }) &&
        sectionProgress(m).share >= IN_PROGRESS_BELOW;
    });
  }

  function showingInProgress() { return showInProgress || noneFinished(); }

  function rankedStats() {
    var list = allModels
      .filter(function (m) { return where === 'all' || (where === 'local') === isLocal(m); })
      // Only models with a run in this section's tests
      .filter(function (m) { return modeInfo().harnesses.some(function (h) { return runCount(m, h) > 0; }); })
      .map(stats)
      .filter(function (s) { return showingInProgress() || !s.inProgress; });
    var value = SORT_VALUES[sort.key];
    var tierKey = ['spark', 'temper', 'forge'].indexOf(sort.key) !== -1;
    return list.sort(function (a, b) {
      if (a.ran !== b.ran) return a.ran ? -1 : 1;
      // In-progress models always sit below finished ones
      if (a.inProgress !== b.inProgress) return a.inProgress ? 1 : -1;
      // A partial tier score never outranks a complete one
      if (tierKey) {
        var pa = !a[sort.key] || a[sort.key].partial || a[sort.key].score === null;
        var pb = !b[sort.key] || b[sort.key].partial || b[sort.key].score === null;
        if (pa !== pb) return pa ? 1 : -1;
      }
      var va = value(a), vb = value(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return modelLabel(a.model) < modelLabel(b.model) ? -1 : 1;
    });
  }

  // ---- Views ------------------------------------------------------------

  function segmented(containerId, options, current, onPick) {
    var group = document.getElementById(containerId);
    group.innerHTML = '';
    options.forEach(function (opt) {
      var button = el('button', { role: 'radio', 'aria-checked': opt.value === current, class: 'crucible-segment' + (opt.empty ? ' is-empty' : '') }, opt.label);
      if (opt.empty) button.title = opt.emptyTitle || '';
      button.addEventListener('click', function () { onPick(opt.value); });
      group.appendChild(button);
    });
  }

  function renderControls() {
    var tabs = document.getElementById('mode-tabs');
    tabs.innerHTML = '';
    MODES.forEach(function (m) {
      var n = data.tests.filter(function (t) { return t.mode === m.id && t.status !== 'retired'; }).length;
      var tab = el('button', { type: 'button', role: 'tab', class: 'crucible-mode-tab', 'aria-selected': m.id === mode, id: 'mode-tab-' + m.id });
      tab.appendChild(el('span', { class: 'crucible-mode-name' }, m.label));
      tab.appendChild(el('span', { class: 'crucible-mode-blurb' }, (MODE_BLURBS[m.id] || '') + ' · ' + n + ' tests · ' +
        m.areas.map(function (a) { return a.label; }).join(', ')));
      tab.addEventListener('click', function () {
        mode = m.id;
        harness = 'best';
        if (history.replaceState) history.replaceState(null, '', '#' + m.id);
        render();
      });
      tabs.appendChild(tab);
    });
    var many = modeInfo().harnesses.length > 1;
    document.getElementById('harness-label').hidden = !many;
    document.getElementById('harness-toggle').hidden = !many;
    document.getElementById('harness-fixed').textContent = many ? '' : 'Every ' + (modeInfo().label || '') + ' run is a direct API call.';
    segmented('harness-toggle', [{ value: 'best', label: 'Best per model' }].concat(modeInfo().harnesses.map(function (h) {
      var n = allModels.reduce(function (s, m) { return s + runCount(m, h); }, 0);
      return { value: h, label: h, empty: !n, emptyTitle: 'No runs with this harness yet' };
    })), harness, function (h) { harness = h; render(); });
    segmented('where-toggle', [
      { value: 'all', label: 'All' }, { value: 'local', label: 'Local' }, { value: 'cloud', label: 'Cloud' }
    ], where, function (w) { where = w; render(); });
    var hidden = allModels.filter(function (m) {
      return modeInfo().harnesses.some(function (h) { return runCount(m, h) > 0; }) && sectionProgress(m).share < IN_PROGRESS_BELOW;
    }).length;
    segmented('progress-toggle', [
      { value: false, label: 'Finished' },
      { value: true, label: 'Include in progress' + (hidden ? ' (' + hidden + ')' : ''), empty: !hidden, emptyTitle: 'Every model has finished this section' }
    ], showingInProgress(), function (v) { showInProgress = v; render(); });
    document.getElementById('progress-note').textContent = noneFinished() && hidden
      ? 'No model has finished 75% of this section\'s tests yet, so everyone is shown, marked * and unranked.'
      : showInProgress && hidden
      ? '* In progress: fewer than 75% of this section\'s tests done. Listed last and not ranked.'
      : (hidden ? hidden + ' model' + (hidden === 1 ? '' : 's') + ' with fewer than 75% of this section\'s tests done ' + (hidden === 1 ? 'is' : 'are') + ' hidden.' : '');
    segmented('scatter-toggle', [
      { value: 'time', label: 'Time per task' }, { value: 'cost', label: 'Cost per task' }
    ], scatterMeasure, function (m) { scatterMeasure = m; render(); });
  }

  function renderTakeaways(list) {
    var ul = document.getElementById('crucible-takeaways');
    ul.innerHTML = '';
    var ranked = list.filter(function (s) { return s.temper.score !== null && !s.temper.partial; })
      .sort(function (a, b) { return b.temper.score - a.temper.score; });
    var lines = [];
    if (ranked.length) {
      var top = ranked.slice(0, 2).map(function (s) { return modelLabel(s.model); });
      lines.push(top.join(' and ') + (top.length > 1 ? ' lead' : ' leads') + ' everyday work (Temper) with ' + harnessPhrase() + '.');
      var local = ranked.filter(function (s) { return s.local; })[0];
      if (local && where !== 'cloud') {
        lines.push('The best local model is ' + modelLabel(local.model) + ' at ' + fmtScore(local.temper.score) +
          (local.hardware ? ', on ' + local.hardware : '') + '.');
      }
      var priced = ranked.filter(function (s) { return !s.local && s.cost; });
      if (priced.length > 1) {
        var value = priced.slice().sort(function (a, b) { return b.temper.score / b.cost - a.temper.score / a.cost; })[0];
        lines.push(modelLabel(value.model) + ' gives the most Temper score per dollar (' + fmtUsd(value.cost) + ' per task).');
      }
    }
    var forge = list.filter(function (s) { return forgeValue(s) !== null; }).sort(function (a, b) { return forgeValue(b) - forgeValue(a); })[0];
    if (forge) {
      lines.push(modelLabel(forge.model) + ' scores highest on the Forge tests (' + fmtScore(forgeValue(forge)) +
        (forge.forge && forge.forge.score !== null ? '' : ', provisional') + ').');
    }
    if (!lines.length) lines.push('No scored runs with ' + harnessPhrase() + ' for these models yet.');
    lines.forEach(function (line) { ul.appendChild(el('li', {}, line)); });
  }

  function tierCell(result, extra) {
    var td = el('td', { class: 'crucible-lb-num' });
    if (!result || result.score === null) {
      td.textContent = NONE;
      return td;
    }
    td.appendChild(el('span', {}, fmtScore(result.score)));
    if (result.partial || extra) {
      td.appendChild(el('span', { class: 'crucible-lb-note' }, extra || result.scored + '/' + result.total));
    }
    return td;
  }

  function renderLeaderboard(list) {
    var table = document.getElementById('crucible-leaderboard');
    table.innerHTML = '';
    var columns = [
      { key: null, label: '#' }, { key: 'model', label: 'Model' }, { key: 'spark', label: 'Spark' },
      { key: 'temper', label: 'Temper' }, { key: 'forge', label: 'Forge' },
      { key: 'time', label: 'Time / task' }, { key: 'cost', label: 'Cost / task' }
    ];
    var head = el('tr');
    columns.forEach(function (c) {
      var th = el('th', { scope: 'col' });
      if (!c.key) {
        th.textContent = c.label;
      } else {
        var button = el('button', { type: 'button', class: 'crucible-sort' }, c.label);
        if (sort.key === c.key) {
          th.setAttribute('aria-sort', sort.dir < 0 ? 'descending' : 'ascending');
          button.appendChild(el('span', { 'aria-hidden': 'true' }, sort.dir < 0 ? ' ↓' : ' ↑'));
        }
        button.addEventListener('click', function () {
          // Scores sort high-first by default; time, cost and names low-first
          var natural = ['time', 'cost', 'model'].indexOf(c.key) === -1 ? -1 : 1;
          sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : natural };
          render();
        });
        th.appendChild(button);
      }
      head.appendChild(th);
    });
    table.appendChild(el('thead')).appendChild(head);

    var body = table.appendChild(el('tbody'));
    var rank = 0;
    list.forEach(function (s) {
      var row = el('tr', { class: s.ran ? '' : 'is-not-run' });
      row.appendChild(el('td', { class: 'crucible-lb-rank' }, s.ran && !s.inProgress && s.temper.score !== null && !s.temper.partial ? String(++rank) : ''));
      var name = el('th', { scope: 'row' });
      name.appendChild(el('span', { class: 'crucible-legend-name' }, modelLabel(s.model) + (s.inProgress ? ' *' : '')));
      if (s.inProgress) name.title = 'In progress: ' + s.progress.done + ' of ' + s.progress.total + ' tests in this section done';
      name.appendChild(el('span', { class: 'crucible-tag' + (s.local ? ' is-local' : '') }, s.local ? 'local' : 'cloud'));
      if (s.hardware) name.appendChild(el('span', { class: 'crucible-legend-hw' }, s.hardware));
      if (showsHarnessTag() && s.harness) name.appendChild(el('span', { class: 'crucible-tag crucible-harness-tag' }, 'via ' + s.harness));
      row.appendChild(name);

      if (!s.ran) {
        row.appendChild(el('td', { colspan: columns.length - 2, class: 'crucible-not-run' }, 'not run with ' + harnessPhrase()));
        body.appendChild(row);
        return;
      }

      var spark = el('td');
      if (s.sparkVerdict) {
        spark.appendChild(el('span', { class: 'crucible-verdict is-' + s.sparkVerdict },
          s.sparkVerdict === 'pass' ? '✓ Pass' : s.sparkVerdict === 'fail' ? '✕ Fail' : 'Partial'));
      } else {
        spark.textContent = NONE;
      }
      row.appendChild(spark);

      var temper = el('td', { class: 'crucible-lb-bar-cell' });
      if (s.temper.score !== null) {
        var bar = el('span', { class: 'crucible-lb-bar' + (s.temper.partial ? ' is-partial' : '') });
        var fill = el('span', { class: 'crucible-lb-fill' + (s.local ? ' is-local' : '') });
        fill.style.width = (s.temper.score * 10) + '%';
        bar.appendChild(fill);
        temper.appendChild(bar);
        temper.appendChild(el('span', { class: 'crucible-lb-score' }, fmtScore(s.temper.score)));
        if (s.temper.partial) temper.appendChild(el('span', { class: 'crucible-lb-note' }, s.temper.scored + '/' + s.temper.total));
      } else {
        temper.textContent = NONE;
      }
      row.appendChild(temper);

      if (s.forge && s.forge.score !== null) row.appendChild(tierCell(s.forge));
      else if (s.forgeProvisional && s.forgeProvisional.score !== null) {
        row.appendChild(tierCell({ score: s.forgeProvisional.score }, 'provisional'));
      } else row.appendChild(tierCell(null));

      row.appendChild(el('td', { class: 'crucible-lb-num' }, fmtSeconds(s.time)));
      row.appendChild(el('td', { class: 'crucible-lb-num' }, s.local ? '$0 · local' : fmtUsd(s.cost)));
      body.appendChild(row);
    });
  }

  // Score vs time or cost. Log x (time and cost span orders of magnitude), Pareto frontier, best quadrant.
  function renderScatter(list) {
    var container = document.getElementById('crucible-scatter');
    var tooltip = document.getElementById('crucible-tooltip');
    container.innerHTML = '';
    tooltip.hidden = true;
    document.getElementById('scatter-measure-label').textContent = scatterMeasure === 'time' ? 'time' : 'cost';

    var points = list.filter(function (s) {
      var x = scatterMeasure === 'time' ? s.time : s.cost;
      return s.temper.score !== null && x !== null && x > 0;
    });
    var skippedLocal = scatterMeasure === 'cost' && list.some(function (s) { return s.local && s.temper.score !== null; });
    document.getElementById('scatter-sub').textContent = scatterMeasure === 'time'
      ? 'Temper score against median time per task. Up and to the left is better: the shaded corner is faster and better than the median, and the line joins models nothing else beats on both.'
      : 'Temper score against average API cost per task. Up and to the left is better.' +
        (skippedLocal ? ' Local models have no API cost and are left off.' : '');
    if (!points.length) {
      container.appendChild(el('p', { class: 'crucible-sub' }, 'Nothing to plot for this harness and filter yet.'));
      return;
    }

    var width = Math.max(560, container.clientWidth);
    var height = 340;
    var m = { top: 16, right: 24, bottom: 44, left: 44 };
    var xs = points.map(function (s) { return scatterMeasure === 'time' ? s.time : s.cost; });
    var lo = Math.log10(Math.min.apply(null, xs)), hi = Math.log10(Math.max.apply(null, xs));
    if (hi - lo < 0.5) { lo -= 0.25; hi += 0.25; }
    lo -= 0.1; hi += 0.1;
    function x(v) { return m.left + (Math.log10(v) - lo) / (hi - lo) * (width - m.left - m.right); }
    function y(v) { return m.top + (1 - v / 10) * (height - m.top - m.bottom); }

    var root = svg('svg', {
      class: 'crucible-chart-svg', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img',
      'aria-label': 'Temper score against ' + (scatterMeasure === 'time' ? 'time' : 'cost') + ' per task, using ' + harnessPhrase() + '. The leaderboard has the same numbers.'
    });

    // Best quadrant: better than the median on both axes
    var medX = median(xs), medY = median(points.map(function (s) { return s.temper.score; }));
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
          scatterMeasure === 'time' ? fmtSeconds(v) : fmtUsd(v)));
      });
    }
    root.appendChild(svg('text', { class: 'crucible-axis-title', x: (m.left + width - m.right) / 2, y: height - 6, 'text-anchor': 'middle' },
      (scatterMeasure === 'time' ? 'Median time per task' : 'Average cost per task') + ' (log scale)'));

    // Pareto frontier: sweeping from cheapest/fastest, keep each point that beats every score before it
    var sorted = points.slice().sort(function (a, b) {
      var xa = scatterMeasure === 'time' ? a.time : a.cost, xb = scatterMeasure === 'time' ? b.time : b.cost;
      return xa - xb;
    });
    var frontier = [], best = -1;
    sorted.forEach(function (s) { if (s.temper.score > best) { frontier.push(s); best = s.temper.score; } });
    if (frontier.length > 1) {
      var d = frontier.map(function (s, i) {
        var px = x(scatterMeasure === 'time' ? s.time : s.cost), py = y(s.temper.score);
        return (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
      }).join(' ');
      root.appendChild(svg('path', { class: 'crucible-frontier', d: d }));
    }

    var labelAll = points.length <= 12;
    points.forEach(function (s) {
      var px = x(scatterMeasure === 'time' ? s.time : s.cost), py = y(s.temper.score);
      var color = s.local ? COLORS.local : COLORS.cloud;
      var dot = svg('circle', { class: 'crucible-dot' + (s.temper.partial ? ' is-uncounted' : ''), cx: px, cy: py, r: 6,
        fill: s.temper.partial ? '#fff' : color, stroke: s.temper.partial ? color : '#fff' });
      var hit = svg('circle', { class: 'crucible-hit', cx: px, cy: py, r: 14 });
      hit.addEventListener('mouseenter', function () {
        tooltip.innerHTML = '';
        tooltip.appendChild(el('div', { class: 'crucible-tooltip-title' }, modelLabel(s.model) + (s.local ? ' · local' : ' · cloud') + ' · ' + s.harness));
        tooltip.appendChild(el('div', {}, 'Temper ' + fmtScore(s.temper.score) + (s.temper.partial ? ' (partial)' : '')));
        tooltip.appendChild(el('div', {}, 'Time per task ' + fmtSeconds(s.time) + ' · cost ' + (s.local ? '$0' : fmtUsd(s.cost))));
        if (s.hardware) tooltip.appendChild(el('div', { class: 'crucible-tooltip-note' }, s.hardware));
        tooltip.hidden = false;
        var left = px + 14;
        if (left + tooltip.offsetWidth > container.clientWidth) left = px - 14 - tooltip.offsetWidth;
        tooltip.style.left = Math.max(0, left - container.scrollLeft) + 'px';
        tooltip.style.top = Math.max(0, py - 20) + 'px';
      });
      hit.addEventListener('mouseleave', function () { tooltip.hidden = true; });
      root.appendChild(dot);
      if (labelAll || frontier.indexOf(s) !== -1) {
        root.appendChild(svg('text', { class: 'crucible-point-label', x: px + 9, y: py - 8 }, modelLabel(s.model)));
      }
      root.appendChild(hit);
    });

    // Legend: identity is never color alone (the leaderboard tags say local/cloud too)
    var legendY = m.top + 4;
    [['local', 'Local'], ['cloud', 'Cloud']].forEach(function (pair, i) {
      var lx = width - m.right - 120 + i * 62;
      root.appendChild(svg('circle', { cx: lx, cy: legendY, r: 5, fill: COLORS[pair[0]] }));
      root.appendChild(svg('text', { class: 'crucible-axis-label', x: lx + 9, y: legendY + 4 }, pair[1]));
    });
    container.appendChild(root);
  }

  function showCellDetail(s, t, c) {
    var panel = document.getElementById('crucible-cell-detail');
    panel.innerHTML = '';
    panel.appendChild(el('p', { class: 'crucible-tooltip-title' }, modelLabel(s.model) + ' · ' + s.harness + ' · ' + t.id + ' · ' + TIER_LABELS[t.tier] +
      (t.status === 'provisional' ? ' (provisional)' : '')));
    promptBlock(t, panel);
    if (!c) {
      panel.appendChild(el('p', {}, 'Not run with ' + s.harness + '.'));
    } else {
      var r = c.run;
      runDetail(r, panel);
      panel.appendChild(el('p', { class: 'crucible-detail-meta' }, [
        (r.status || NONE).toLowerCase(), 'time ' + fmtSeconds(r.elapsed_s), 'tool calls ' + fmtInt(r.tool_calls),
        r.cost_usd !== null && r.cost_usd !== undefined ? 'cost ' + fmtUsd(r.cost_usd) : null, 'run ' + r.run_id
      ].filter(Boolean).join(' · ')));
    }
    panel.hidden = false;
  }

  // The test's one-line summary, with the full prompt the model was given folded under it
  function promptBlock(t, into) {
    into.appendChild(el('p', { class: 'crucible-detail-prompt' }, t.summary));
    if (!t.prompt || t.prompt === t.summary) return;
    var details = el('details', { class: 'crucible-output crucible-prompt-full' });
    details.appendChild(el('summary', {}, 'Full prompt'));
    details.appendChild(el('pre', {}, t.prompt));
    into.appendChild(details);
  }

  // Everything a run produced and how it was scored: per-criterion scores, checks, hidden tests,
  // the judge's note, and the model's own output
  function runDetail(r, into) {
    into.appendChild(el('p', {}, r.best_score === null ? 'Not scored yet: this test needs review, which is a future feature.'
      : 'Score ' + fmtScore(r.best_score) + ', from ' + SOURCE_LABELS[r.score_source] + '.' +
        (r.score_source === 'agent' && r.agent_summary ? ' Judge: ' + r.agent_summary : '')));
    if (r.criteria && r.criteria.length) {
      var ul = el('ul', { class: 'crucible-criteria' });
      r.criteria.forEach(function (c) {
        var full = c.score === c.max_score, none = !c.score;
        var li = el('li', { class: full ? 'is-pass' : none ? 'is-fail' : 'is-partial' });
        li.appendChild(el('span', { class: 'crucible-criterion-score' }, (c.score === null ? NONE : +c.score.toFixed(2)) + '/' + c.max_score));
        li.appendChild(el('span', { class: 'crucible-criterion-name' }, c.criterion));
        if (c.detail) li.appendChild(el('span', { class: 'crucible-check-detail' }, ' (' + c.detail + ')'));
        ul.appendChild(li);
      });
      into.appendChild(el('p', { class: 'crucible-detail-label' }, 'Scored on'));
      into.appendChild(ul);
    }
    if (r.checks && r.checks.length) {
      into.appendChild(el('p', { class: 'crucible-detail-label' }, 'Checks'));
      into.appendChild(checkList(r.checks));
    }
    var h = r.hidden_tests;
    if (h) {
      var passed = h.tests.filter(function (t) { return t.passed; }).length;
      into.appendChild(el('p', { class: 'crucible-detail-label' }, 'Hidden tests: ' + passed + '/' + h.tests.length + ' pass'));
      if (h.error) into.appendChild(el('p', { class: 'crucible-flag' }, h.error));
      var list = el('ul', { class: 'crucible-checks' });
      var lastGroup = null;
      h.tests.forEach(function (t) {
        if (t.group !== lastGroup) { list.appendChild(el('li', { class: 'crucible-check-group' }, t.group)); lastGroup = t.group; }
        var li = el('li', { class: t.passed ? 'is-pass' : 'is-fail' });
        li.appendChild(el('span', { class: 'crucible-check-mark', 'aria-label': t.passed ? 'passed' : 'failed' }, t.passed ? '✓' : '✕'));
        li.appendChild(el('span', {}, t.name + ' '));
        if (t.error) li.appendChild(el('span', { class: 'crucible-check-detail' }, '(' + t.error + ')'));
        list.appendChild(li);
      });
      [['The repo\'s own tests pass', h.existing], ['Contract suite untouched', h.contract_unchanged],
       ['New tests catch the bug' + (h.regression ? ': ' + h.regression : ''), h.regression_passed]].forEach(function (pair) {
        if (pair[1] === null || pair[1] === undefined) return;
        var li = el('li', { class: pair[1] ? 'is-pass' : 'is-fail' });
        li.appendChild(el('span', { class: 'crucible-check-mark' }, pair[1] ? '✓' : '✕'));
        li.appendChild(el('span', {}, pair[0]));
        list.appendChild(li);
      });
      into.appendChild(list);
    }
    if (r.reasoning_chars) {
      into.appendChild(el('p', { class: 'crucible-detail-meta' }, 'Reasoned for ' + r.reasoning_chars.toLocaleString() +
        ' characters before answering' + (r.reasoning && r.reasoning !== 'default' ? ' (reasoning set to ' + r.reasoning + ')' : '') + '.'));
    }
    if (r.output) {
      var details = el('details', { class: 'crucible-output' });
      details.appendChild(el('summary', {}, 'Model output'));
      details.appendChild(el('pre', {}, r.output));
      into.appendChild(details);
    }
  }

  // Each programmatic check: pass/fail, the plain-English rule, and what it found
  function checkList(results) {
    var ul = el('ul', { class: 'crucible-checks' });
    results.forEach(function (r) {
      var li = el('li', { class: r.passed ? 'is-pass' : 'is-fail' });
      li.appendChild(el('span', { class: 'crucible-check-mark', 'aria-label': r.passed ? 'passed' : 'failed' }, r.passed ? '✓' : '✕'));
      li.appendChild(el('span', {}, (r.rule || r.id) + ' '));
      li.appendChild(el('span', { class: 'crucible-check-detail' }, '(' + r.detail + ')'));
      ul.appendChild(li);
    });
    return ul;
  }

  function renderMatrix(list) {
    var table = document.getElementById('crucible-matrix');
    table.innerHTML = '';
    document.getElementById('crucible-cell-detail').hidden = true;
    var rows = list.filter(function (s) { return s.ran; });

    var tierRow = el('tr');
    tierRow.appendChild(el('th', { scope: 'col' }));
    tiers.forEach(function (tier) {
      var n = orderedTests.filter(function (t) { return t.tier === tier; }).length;
      tierRow.appendChild(el('th', { scope: 'colgroup', colspan: n, class: 'crucible-matrix-tier' }, TIER_LABELS[tier]));
    });
    var idRow = el('tr');
    idRow.appendChild(el('th', { scope: 'col' }, 'Model'));
    orderedTests.forEach(function (t, i) {
      var newTier = i && t.tier !== orderedTests[i - 1].tier;
      idRow.appendChild(el('th', { scope: 'col', class: 'crucible-matrix-id' + (newTier ? ' is-tier-start' : ''), title: t.summary }, t.id));
    });
    var head = table.appendChild(el('thead'));
    head.appendChild(tierRow);
    head.appendChild(idRow);

    var body = table.appendChild(el('tbody'));
    rows.forEach(function (s) {
      var row = el('tr');
      var name = el('th', { scope: 'row' });
      name.appendChild(el('span', {}, modelLabel(s.model)));
      if (showsHarnessTag()) name.appendChild(el('span', { class: 'crucible-matrix-harness' }, s.harness));
      row.appendChild(name);
      orderedTests.forEach(function (t, i) {
        var c = cell(s.model, s.harness, t.id);
        var score = c ? c.run.best_score : null;
        var cls = 'crucible-matrix-cell' + (i && t.tier !== orderedTests[i - 1].tier ? ' is-tier-start' : '') +
          (t.status === 'provisional' ? ' is-provisional' : '') + (c ? '' : ' is-empty');
        var td = el('td', { class: cls });
        if (c) {
          var button = el('button', { type: 'button', 'aria-label': modelLabel(s.model) + ' ' + t.id + ': ' + fmtScore(score) }, score === null ? '?' : Math.round(score).toString());
          if (score !== null) button.setAttribute('style', heatStyle(score));
          if (c.run.timed_out) button.classList.add('is-timeout');
          if (c.run.score_source === 'checks') button.classList.add('is-checked');
          button.addEventListener('click', function () { showCellDetail(s, t, c); });
          td.appendChild(button);
        } else {
          td.textContent = '·';
        }
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    if (!rows.length) body.appendChild(el('tr')).appendChild(el('td', { class: 'crucible-not-run' }, 'No runs with ' + harnessPhrase() + ' yet.'));
  }

  function renderHeatmap(list) {
    var table = document.getElementById('crucible-heatmap');
    table.innerHTML = '';
    var head = el('tr');
    head.appendChild(el('th', { scope: 'col' }, 'Model'));
    var areas = modeInfo().areas.filter(function (a) { return orderedTests.some(function (t) { return t.area === a.id; }); });
    areas.forEach(function (a) { head.appendChild(el('th', { scope: 'col' }, a.label)); });
    table.appendChild(el('thead')).appendChild(head);

    var body = table.appendChild(el('tbody'));
    list.filter(function (s) { return s.ran; }).forEach(function (s) {
      var row = el('tr');
      var th = el('th', { scope: 'row' });
      th.appendChild(el('span', {}, modelLabel(s.model)));
      th.appendChild(el('span', { class: 'crucible-tag' + (s.local ? ' is-local' : '') }, s.local ? 'local' : 'cloud'));
      row.appendChild(th);
      areas.forEach(function (area) {
        var tests = orderedTests.filter(function (t) { return t.area === area.id && t.status === 'active'; });
        var cells = tests.map(function (t) { return cell(s.model, s.harness, t.id); }).filter(Boolean);
        var score = mean(cells.map(countedScore));
        // No active test run here yet (some areas are all provisional so far): show the
        // provisional tests' mean instead, dashed like the matrix's provisional cells
        var provisional = !cells.length;
        if (provisional) {
          tests = orderedTests.filter(function (t) { return t.area === area.id && t.status === 'provisional'; });
          cells = tests.map(function (t) { return cell(s.model, s.harness, t.id); }).filter(Boolean);
          score = mean(cells.map(function (c) { return c.run.best_score; }));
        }
        var td = el('td');
        if (!cells.length) {
          td.className = 'is-not-run';
          td.textContent = 'not run';
        } else {
          if (score === null) td.className = 'is-not-scored';
          else td.setAttribute('style', heatStyle(score));
          if (provisional) {
            td.classList.add('is-provisional');
            td.title = 'Provisional tests only: not in tier scores yet';
          }
          td.appendChild(el('span', { class: 'crucible-heat-score' }, score === null ? 'not scored' : fmtScore(score)));
          td.appendChild(el('span', { class: 'crucible-heat-n' }, cells.length + '/' + tests.length + (provisional ? ' provisional' : ' tests')));
        }
        row.appendChild(td);
      });
      body.appendChild(row);
    });
  }

  function renderDetailPicker(list) {
    var select = document.getElementById('detail-model');
    var ran = list.filter(function (s) { return s.ran; });
    if (!detailModel || !ran.some(function (s) { return s.model === detailModel; })) detailModel = ran.length ? ran[0].model : null;
    select.innerHTML = '';
    ran.forEach(function (s) {
      var opt = el('option', { value: s.model }, modelLabel(s.model) + (s.local ? ' (local)' : '') + (showsHarnessTag() ? ' · ' + s.harness : ''));
      if (s.model === detailModel) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // Which areas are open in the detail table; collapsed by default, kept across model changes
  var openAreas = {};

  function testRow(m, t, columns, body) {
    var c = cell(m, harnessFor(m), t.id);
    var row = el('tr', { class: 'crucible-row' + (c ? '' : ' is-not-run') });
    var name = el('th', { scope: 'row' });
    name.appendChild(el('span', { class: 'crucible-test-id' }, t.id));
    name.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, TIER_LABELS[t.tier]));
    name.appendChild(el('span', { class: 'crucible-test-summary', title: t.summary }, t.summary));
    if (t.status === 'provisional') name.appendChild(el('span', { class: 'crucible-tag' }, 'provisional'));
    row.appendChild(name);

    if (!c) {
      row.appendChild(el('td', { colspan: columns.length - 1, class: 'crucible-not-run' }, 'not run'));
      body.appendChild(row);
      return;
    }

    var r = c.run;
    var scoreCell = el('td', { class: 'crucible-score-cell' });
    var bar = el('span', { class: 'crucible-bar' + (r.counts ? '' : ' is-uncounted') });
    var fill = el('span', { class: 'crucible-bar-fill' });
    fill.style.width = (r.best_score === null ? 0 : r.best_score * 10) + '%';
    bar.appendChild(fill);
    scoreCell.appendChild(el('span', { class: 'crucible-score-num' }, fmtScore(r.best_score)));
    scoreCell.appendChild(bar);
    row.appendChild(scoreCell);

    var timeCell = el('td', {}, fmtSeconds(r.elapsed_s));
    if (r.timed_out || r.status !== 'COMPLETE') {
      timeCell.appendChild(el('span', { class: 'crucible-flag' }, r.timed_out ? 'timed out' : (r.status || '').toLowerCase()));
    }
    row.appendChild(timeCell);
    if (mode === 'agentic') row.appendChild(el('td', {}, fmtInt(r.tool_calls)));
    row.appendChild(el('td', {}, fmtInt(r.tokens_out)));
    row.appendChild(el('td', {}, isLocal(m) ? '$0' : fmtUsd(r.cost_usd)));
    row.appendChild(el('td', {}, String(c.count)));

    var detail = el('tr', { class: 'crucible-detail', hidden: '' });
    var detailCell = el('td', { colspan: columns.length });
    promptBlock(t, detailCell);
    runDetail(r, detailCell);
    var notes = ['Run ' + r.run_id, (r.status || NONE).toLowerCase(), 'test v' + (r.test_version || '?'), 'tokens in ' + fmtInt(r.tokens_in)];
    if (c.count > 1) notes.push('showing the latest of ' + c.count + ' runs');
    if (!r.counts) notes.push(t.status === 'provisional' ? 'provisional test, not in tier scores' : 'older test version, not in tier scores');
    detailCell.appendChild(el('p', { class: 'crucible-detail-meta' }, notes.join(' · ')));
    detail.appendChild(detailCell);

    row.tabIndex = 0;
    row.setAttribute('aria-expanded', 'false');
    function toggle() {
      var open = detail.hidden;
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

  // One group per area. Collapsed, a group shows its mean, how much ran, and one square per test
  // (easiest tier first) so gaps and weak spots show without opening it.
  function renderTests() {
    var table = document.getElementById('crucible-tests');
    table.innerHTML = '';
    if (!detailModel) return;
    var m = detailModel;
    var columns = ['Test', 'Score', 'Time'].concat(mode === 'agentic' ? ['Tool calls'] : [], ['Tokens out', 'Cost', 'Runs']);
    var head = el('tr');
    columns.forEach(function (c) { head.appendChild(el('th', { scope: 'col' }, c)); });
    table.appendChild(el('thead')).appendChild(head);

    modeInfo().areas.forEach(function (area) {
      var tests = orderedTests.filter(function (t) { return t.area === area.id; });
      if (!tests.length) return;
      tests.sort(function (a, b) { return tiers.indexOf(a.tier) - tiers.indexOf(b.tier); });
      var cells = tests.map(function (t) { return cell(m, harnessFor(m), t.id); });
      var ran = cells.filter(Boolean).length;
      var avg = mean(cells.map(function (c) { return c ? c.run.best_score : null; }));
      var key = mode + ':' + area.id;
      var open = !!openAreas[key];

      var body = table.appendChild(el('tbody', { class: 'crucible-area' + (open ? ' is-open' : '') }));
      var groupRow = el('tr', { class: 'crucible-group crucible-area-row' });
      var th = el('th', { colspan: columns.length, scope: 'rowgroup' });
      var button = el('button', { type: 'button', class: 'crucible-area-toggle', 'aria-expanded': open });
      button.appendChild(el('span', { class: 'crucible-area-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'));
      button.appendChild(el('span', { class: 'crucible-area-name' }, area.label));
      button.appendChild(el('span', { class: 'crucible-tag' }, tests[0].id.split('-')[0]));
      var chip = el('span', { class: 'crucible-area-score' }, avg === null ? NONE : fmtScore(avg));
      if (avg !== null) chip.setAttribute('style', heatStyle(avg));
      button.appendChild(chip);
      button.appendChild(el('span', { class: 'crucible-area-count' }, ran + '/' + tests.length + ' run'));
      var strip = el('span', { class: 'crucible-area-strip', 'aria-hidden': 'true' });
      tests.forEach(function (t, k) {
        var c = cells[k], score = c ? c.run.best_score : null;
        var sq = el('span', { class: 'crucible-area-sq is-' + t.tier + (c ? '' : ' is-empty'), title: t.id + ' · ' + TIER_LABELS[t.tier] + ' · ' + (c ? fmtScore(score) : 'not run') });
        if (score !== null) sq.setAttribute('style', heatStyle(score));
        strip.appendChild(sq);
      });
      button.appendChild(strip);
      button.addEventListener('click', function () { openAreas[key] = !open; renderTests(); });
      th.appendChild(button);
      groupRow.appendChild(th);
      body.appendChild(groupRow);
      if (open) tests.forEach(function (t) { testRow(m, t, columns, body); });
    });
  }

  function render() {
    bestCache = {};
    selectMode();
    var list = rankedStats();
    renderControls();
    renderTakeaways(list);
    renderLeaderboard(list);
    renderScatter(list);
    renderMatrix(list);
    renderHeatmap(list);
    renderDetailPicker(list);
    renderTests();
  }

  document.getElementById('detail-model').addEventListener('change', function (e) {
    detailModel = e.target.value;
    renderTests();
  });

  // Links to #chat or #agentic switch sections without a reload
  window.addEventListener('hashchange', function () {
    var wanted = location.hash === '#agentic' ? 'agentic' : 'chat';
    if (wanted !== mode) { mode = wanted; harness = 'best'; render(); }
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { renderScatter(rankedStats()); }, 150);
  });

  var release = data.release ? 'Release ' + data.release.release + '. ' : '';
  document.getElementById('crucible-footnote').textContent = release +
    '— means the harness didn\'t report that number. Cost per task is the harness\'s own estimate from OpenRouter prices; ' +
    'local models have no API cost. Token counts aren\'t comparable across harnesses. Data exported ' + data.generated_at.slice(0, 10) + '.';
  render();
})();
