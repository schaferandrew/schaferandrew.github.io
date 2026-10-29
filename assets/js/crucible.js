// Crucible results: a leaderboard first, then the controls that drive every view below it.
// The page is data-driven: modes, areas, tiers, thresholds and their text come from the results
// bundle. FALLBACKS (_data/crucible_fallbacks.yml) fill what an older bundle (format 2) doesn't
// carry, and anything the page doesn't recognize renders generically instead of throwing.
(function () {
  var SUPPORTED_FORMAT = 3; // a bundle with a higher format_version is skipped, with a notice
  var NONE = '—';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Two identities on the scatter: local (the point of Crucible) and cloud (the reference)
  var COLORS = { local: '#2a78d6', cloud: '#eb6834' };
  var script = document.currentScript;
  var statusEl = document.getElementById('crucible-status');
  var resultsEl = document.getElementById('crucible-results');

  function showStatus(text, retry) {
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
    if (retry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'crucible-segment crucible-retry';
      button.textContent = 'Try again';
      button.addEventListener('click', load);
      statusEl.appendChild(document.createTextNode(' '));
      statusEl.appendChild(button);
    }
  }

  // The bundles are a generated JSON page, fetched after first paint instead of inlined
  function load() {
    showStatus('Loading results…');
    fetch(script.getAttribute('data-src'))
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        try {
          start(payload);
        } catch (e) {
          if (window.console) console.error(e);
          showStatus('Something went wrong drawing the results.', true);
        }
      }, function () {
        showStatus('Couldn’t load the results.', true);
      });
  }

  // _data/crucible/ holds one results bundle per file (this machine's, plus any dropped in from
  // others), possibly in sub-folders. Merge them: the catalog (tests, tiers, settings) from the
  // newest bundle that has one, runs from all, deduplicated by run_id with the newest bundle
  // winning. A bundle newer than this page understands is skipped and counted.
  function mergeBundles(raw) {
    var found = [];
    (function walk(node) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      if (node.format_version !== undefined || Array.isArray(node.runs) || Array.isArray(node.tests) || Array.isArray(node.tasks)) found.push(node);
      else Object.keys(node).forEach(function (k) { walk(node[k]); });
    })(raw);
    var skipped = 0;
    var bundles = found.filter(function (b) {
      if (typeof b.format_version === 'number' && b.format_version > SUPPORTED_FORMAT) { skipped += 1; return false; }
      return true;
    }).sort(function (a, b) { return (a.generated_at || '') < (b.generated_at || '') ? 1 : -1; });
    var catalog = bundles.filter(function (b) { return Array.isArray(b.tests) || Array.isArray(b.tasks); })[0] || {};
    var merged = Object.assign({}, catalog), seen = {};
    merged.runs = [];
    bundles.forEach(function (b) {
      (Array.isArray(b.runs) ? b.runs : []).forEach(function (r) {
        if (r && r.test_id && !seen[r.run_id]) { seen[r.run_id] = true; merged.runs.push(r); }
      });
    });
    merged.bundle_count = bundles.length;
    merged.skipped = skipped;
    return merged;
  }

  function num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function cap(id) { id = String(id); return id.charAt(0).toUpperCase() + id.slice(1); }
  function ids(list) {
    return (list || []).map(function (h) { return typeof h === 'string' ? h : h && h.id; }).filter(Boolean);
  }
  function pct(v) { return Math.round(v * 100) + '%'; }

  function start(payload) {
    var FB = payload.fallbacks || {};
    var FB_MODES = FB.modes || {}, FB_TIERS = FB.tiers || {}, FB_AREAS = FB.areas || {};
    var data = mergeBundles(payload.bundles || {});
    data.tests = (data.tests || data.tasks || []).filter(function (t) { return t && t.id; });
    data.category_weights = data.category_weights || {};
    (data.categories || []).forEach(function (c) {
      if (c && c.id && typeof c.weight === 'number' && data.category_weights[c.id] === undefined) data.category_weights[c.id] = c.weight;
    });
    data.tests.forEach(function (t) {
      t.scoring_method = t.scoring && typeof t.scoring === 'object' ? t.scoring.method : t.scoring;
    });

    // Scoring policy: the bundle's, else the fallbacks', else today's values
    var policy = data.scoring_policy || {}, policyFb = FB.scoring_policy || {};
    var COVERAGE_MIN = num(policy.coverage_min, num(policyFb.coverage_min, 0.75)); // a tier score is ranked only when this share of the tier is scored
    // A model that has finished less than this share of a section's active tests is "in progress":
    // hidden by default, listed last with an asterisk when shown
    var IN_PROGRESS_BELOW = num(policy.in_progress_below, num(policyFb.in_progress_below, 0.75));

    // Tiers: the catalog's order and roles. A tier no catalog lists (only tasks mention it) is
    // appended with no role: shown, but it never headlines or gates.
    function tierInfo(id, o, pos) {
      var fb = FB_TIERS[id] || {};
      return {
        id: id, label: o.label || fb.label || cap(id), blurb: o.blurb || fb.blurb || '',
        role: o.role || fb.role || null, gate: o.gate || fb.gate || null,
        order: num(o.order, num(fb.order, 1000 + pos)), pos: pos
      };
    }
    var TIERS = [], tierSeen = {};
    (data.tiers || []).forEach(function (t) {
      var id = typeof t === 'string' ? t : t && t.id;
      if (!id || tierSeen[id]) return;
      tierSeen[id] = true;
      TIERS.push(tierInfo(id, typeof t === 'object' ? t : {}, TIERS.length));
    });
    data.tests.forEach(function (t) {
      if (t.tier && !tierSeen[t.tier]) { tierSeen[t.tier] = true; TIERS.push(tierInfo(t.tier, {}, TIERS.length)); }
    });
    if (!TIERS.length) TIERS.push(tierInfo('temper', {}, 0));
    TIERS.sort(function (a, b) { return a.order - b.order || a.pos - b.pos; });
    function tierById(id) { return TIERS.filter(function (t) { return t.id === id; })[0] || tierInfo(id, {}, 1000); }
    function tierLabel(id) { return tierById(id).label; }
    function tierRole(id) { return tierById(id).role || 'none'; }
    var HEADLINE = TIERS.filter(function (t) { return t.role === 'headline'; })[0] ||
      TIERS.filter(function (t) { return t.role !== 'gate'; })[0] || TIERS[0];
    var HEAD = HEADLINE.id;
    function gateOf(id) {
      var t = tierById(id), g = t.gate;
      return t.role === 'gate' && g && typeof g.mean === 'number' && typeof g.min === 'number' ? g : null;
    }
    var STRETCH = TIERS.filter(function (t) { return t.id !== HEAD && t.role !== 'gate'; });

    // Modes: sections that are never ranked together, each with its own harnesses and areas
    function buildModes() {
      var list = [], seen = {}, declared = {};
      function addMode(id, o) {
        if (!id || seen[id]) return;
        seen[id] = true;
        var fb = FB_MODES[id] || {};
        var areas = (o.areas || (data.areas || []).filter(function (a) { return a && a.mode === id; })).filter(Boolean).map(function (a, i) {
          return { id: a.id, label: a.label || (FB_AREAS[a.id] || {}).label || cap(a.id), order: num(a.order, i) };
        }).sort(function (a, b) { return a.order - b.order; });
        var harnesses = ids(o.harnesses || (data.harnesses || []).filter(function (h) { return h && h.modes && h.modes.indexOf(id) !== -1; }));
        harnesses.forEach(function (h) { declared[h] = true; });
        list.push({ id: id, label: o.label || fb.label || cap(id), blurb: o.blurb || fb.blurb || '', areas: areas, harnesses: harnesses, order: num(o.order, num(fb.order, 1000 + list.length)), pos: list.length });
      }
      (data.modes || []).forEach(function (m) { if (m && typeof m === 'object') addMode(m.id, m); });
      data.tests.forEach(function (t) { if (t.mode) addMode(t.mode, {}); });
      // Areas and harnesses nothing declares are still real: list them after the known ones
      var testMode = {};
      data.tests.forEach(function (t) { testMode[t.id] = t.mode; });
      list.forEach(function (m) {
        data.tests.forEach(function (t) {
          if (t.mode === m.id && t.area && !m.areas.some(function (a) { return a.id === t.area; })) {
            m.areas.push({ id: t.area, label: (FB_AREAS[t.area] || {}).label || cap(t.area), order: 1000 });
          }
        });
        data.runs.forEach(function (r) {
          if (testMode[r.test_id] === m.id && r.harness && !declared[r.harness]) { declared[r.harness] = true; m.harnesses.push(r.harness); }
        });
      });
      return list.sort(function (a, b) { return a.order - b.order || a.pos - b.pos; });
    }

    // ---- Data shaping -----------------------------------------------------

    // A model plus its reasoning level is one model here, as on Artificial Analysis:
    // "lmstudio/qwen/qwen3.5-9b#off" reads as "qwen3.5-9b (reasoning off)"
    var MODES = buildModes();

    function modelLabel(model) {
      var variant = model.split('#');
      var parts = variant[0].split('/');
      return parts[parts.length - 1] + (variant[1] ? ' (reasoning ' + variant[1] + ')' : '');
    }

    // Local vs cloud: the run says so (inference.local, or endpoint.where); only a run that
    // doesn't falls back to the provider prefix
    function runIsLocal(run) {
      if (run.inference && typeof run.inference.local === 'boolean') return run.inference.local;
      if (run.endpoint && run.endpoint.where) return run.endpoint.where === 'local';
      return /^(ollama|lmstudio)\//.test(run.model);
    }

    var localModels = {};
    data.runs.forEach(function (run) {
      if (run.reasoning && run.reasoning !== 'default') run.model = run.model + '#' + run.reasoning;
      if (localModels[run.model] === undefined) localModels[run.model] = runIsLocal(run);
    });

    function isLocal(model) { return !!localModels[model]; }

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

    // One layout at a time, chosen here rather than by CSS so a stale stylesheet can't show both:
    // below 640 px the leaderboard is cards and the matrix and heatmap show one task or model
    var narrowQuery = window.matchMedia ? window.matchMedia('(max-width: 639px)') : null;
    function isNarrow() { return !!(narrowQuery && narrowQuery.matches); }
    function applyLayout() {
      var narrow = isNarrow();
      ['crucible-lb', 'crucible-matrix', 'crucible-heatmap', 'crucible-tests'].forEach(function (name) {
        var wide = document.querySelector('.' + name + '-wide'), box = document.getElementById(name + '-narrow');
        if (wide) wide.hidden = narrow;
        if (box) box.hidden = !narrow;
      });
    }

    function modeFromHash() {
      var wanted = location.hash.replace('#', '');
      return MODES.some(function (m) { return m.id === wanted; }) ? wanted : (MODES[0] ? MODES[0].id : '');
    }
    var mode = modeFromHash();
    function modeInfo() { return MODES.filter(function (m) { return m.id === mode; })[0] || { id: mode, label: '', blurb: '', harnesses: [], areas: [] }; }
    function inMode(t) { return t.mode === mode && t.status !== 'retired'; }
    var modeTestIds = {};

    // Tests shown: this mode's tests that aren't retired, tier by tier, area order within a tier
    var tiers = [], orderedTests = [];
    function selectMode() {
      var areas = modeInfo().areas.map(function (a) { return a.id; });
      tiers = TIERS.map(function (t) { return t.id; }).filter(function (tier) {
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
    var sort = { key: HEAD, dir: -1 };
    var detailModel = null;

    // ---- Scores -----------------------------------------------------------

    // The harness a model is shown with: the chosen one, or under "best" the harness with its
    // highest headline-tier score. Complete coverage wins over a partial score, so a harness that can't
    // run half the tier (direct can't use tools) never outranks one that ran it all.
    var bestCache = {};
    function bestHarness(model) {
      if (bestCache[model] !== undefined) return bestCache[model];
      var candidates = modeInfo().harnesses.filter(function (h) { return runCount(model, h) > 0; }).map(function (h) {
        var t = tierScore(model, HEAD, h);
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
      var weights = {}, sum = 0;
      // A task's own weight (resolved by the exporter) wins; else its category's weight, split
      active.forEach(function (t) {
        weights[t.id] = typeof t.weight === 'number' ? t.weight : (data.category_weights[t.category] || 0) / perCategory[t.category];
        sum += weights[t.id];
      });
      // A tier nothing weights yet (a new category) counts its tasks equally rather than vanishing
      if (!sum && active.length) active.forEach(function (t) { weights[t.id] = 1 / active.length; });
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

    // A gate tier is pass or fail against the catalog's thresholds
    function gateVerdict(result, gate) {
      if (!result || result.score === null) return null;
      if (result.partial) return 'partial';
      return result.score >= gate.mean && result.min >= gate.min ? 'pass' : 'fail';
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
      // The gate and headline tiers always have a result; any other tier only when it has tests,
      // with its provisional tests' mean as a stand-in until it has counted ones
      var tier = {}, verdict = {}, provisionalOf = {};
      TIERS.forEach(function (t) {
        var result = tierScore(model, t.id);
        if (t.id === HEAD || t.role === 'gate') tier[t.id] = result;
        else {
          tier[t.id] = result.total ? result : null;
          var provisional = provisionalScore(model, t.id);
          provisionalOf[t.id] = provisional.total ? provisional : null;
        }
        if (gateOf(t.id)) verdict[t.id] = gateVerdict(result, gateOf(t.id));
      });
      return {
        model: model,
        harness: harnessFor(model),
        local: isLocal(model),
        ran: runsFor(model).length > 0,
        tier: tier,
        verdict: verdict,
        provisional: provisionalOf,
        head: tier[HEAD],
        time: median(runs.map(function (r) { return r.elapsed_s; })),
        // Local inference has no API bill; show $0 rather than unknown
        cost: isLocal(model) ? 0 : mean(runs.map(function (r) { return r.cost_usd; })),
        hardware: hardwareLabel(model),
        progress: progress,
        inProgress: progress.share < IN_PROGRESS_BELOW
      };
    }

    function tierValue(s, id) {
      var result = s.tier[id];
      if (result && result.score !== null) return result.score;
      return s.provisional[id] ? s.provisional[id].score : null;
    }

    function sortValue(key, s) {
      if (key === 'model') return modelLabel(s.model).toLowerCase();
      if (key === 'time') return s.time;
      if (key === 'cost') return s.cost;
      return tierValue(s, key);
    }

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
      var value = function (s) { return sortValue(sort.key, s); };
      var tierKey = tierSeen[sort.key] === true;
      return list.sort(function (a, b) {
        if (a.ran !== b.ran) return a.ran ? -1 : 1;
        // In-progress models always sit below finished ones
        if (a.inProgress !== b.inProgress) return a.inProgress ? 1 : -1;
        // A partial tier score never outranks a complete one
        if (tierKey) {
          var pa = !a.tier[sort.key] || a.tier[sort.key].partial || a.tier[sort.key].score === null;
          var pb = !b.tier[sort.key] || b.tier[sort.key].partial || b.tier[sort.key].score === null;
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
        tab.appendChild(el('span', { class: 'crucible-mode-blurb' }, (m.blurb ? m.blurb + ' · ' : '') + n + ' tests · ' +
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
      document.getElementById('harness-fixed').textContent = many || !modeInfo().harnesses.length ? '' : 'Every ' + modeInfo().label + ' run uses the ' + modeInfo().harnesses[0] + ' harness.';
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
        ? 'No model has finished ' + pct(IN_PROGRESS_BELOW) + ' of this section\'s tests yet, so everyone is shown, marked * and unranked.'
        : showInProgress && hidden
        ? '* In progress: fewer than ' + pct(IN_PROGRESS_BELOW) + ' of this section\'s tests done. Listed last and not ranked.'
        : (hidden ? hidden + ' model' + (hidden === 1 ? '' : 's') + ' with fewer than ' + pct(IN_PROGRESS_BELOW) + ' of this section\'s tests done ' + (hidden === 1 ? 'is' : 'are') + ' hidden.' : '');
      segmented('scatter-toggle', [
        { value: 'time', label: 'Time per task' }, { value: 'cost', label: 'Cost per task' }
      ], scatterMeasure, function (m) { scatterMeasure = m; render(); });
    }

    function renderTakeaways(list) {
      var ul = document.getElementById('crucible-takeaways');
      ul.innerHTML = '';
      var ranked = list.filter(function (s) { return s.head.score !== null && !s.head.partial; })
        .sort(function (a, b) { return b.head.score - a.head.score; });
      var lines = [];
      if (ranked.length) {
        var top = ranked.slice(0, 2).map(function (s) { return modelLabel(s.model); });
        var what = HEADLINE.blurb ? HEADLINE.blurb + ' (' + HEADLINE.label + ')' : 'the ' + HEADLINE.label + ' tests';
        lines.push(top.join(' and ') + (top.length > 1 ? ' lead ' : ' leads ') + what + ' with ' + harnessPhrase() + '.');
        var local = ranked.filter(function (s) { return s.local; })[0];
        if (local && where !== 'cloud') {
          lines.push('The best local model is ' + modelLabel(local.model) + ' at ' + fmtScore(local.head.score) +
            (local.hardware ? ', on ' + local.hardware : '') + '.');
        }
        var priced = ranked.filter(function (s) { return !s.local && s.cost; });
        if (priced.length > 1) {
          var value = priced.slice().sort(function (a, b) { return b.head.score / b.cost - a.head.score / a.cost; })[0];
          lines.push(modelLabel(value.model) + ' gives the most ' + HEADLINE.label + ' score per dollar (' + fmtUsd(value.cost) + ' per task).');
        }
      }
      var stretch = STRETCH[0];
      var best = stretch && list.filter(function (s) { return tierValue(s, stretch.id) !== null; })
        .sort(function (a, b) { return tierValue(b, stretch.id) - tierValue(a, stretch.id); })[0];
      if (best) {
        var counted = best.tier[stretch.id] && best.tier[stretch.id].score !== null;
        lines.push(modelLabel(best.model) + ' scores highest on the ' + stretch.label + ' tests (' + fmtScore(tierValue(best, stretch.id)) +
          (counted ? '' : ', provisional') + ').');
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

    // The sentence under the leaderboard heading, from the catalog's tiers and policy
    function renderLeaderboardNote() {
      var parts = ['Ranked by ' + HEADLINE.label + ' score (0–10).'];
      TIERS.forEach(function (t) {
        if (t.id === HEAD) return;
        parts.push(gateOf(t.id)
          ? t.label + ' is a pass/fail gate' + (t.blurb ? ' on ' + t.blurb : '') + '.'
          : t.label + ' is scored separately and never blended in.');
      });
      parts.push('A hatched bar means fewer than ' + pct(COVERAGE_MIN) + ' of that tier\'s tests were scored. Select a column to sort.');
      var multi = MODES.filter(function (m) { return m.harnesses.length > 1; })[0];
      if (multi) {
        parts.push('In ' + multi.label + ', <strong>Best per model</strong> ranks each model with the harness it does best with (the "via" tag); pick a single harness below to compare everyone on the same one.');
      }
      document.getElementById('leaderboard-sub').innerHTML = parts.join(' ');
      var stretch = STRETCH.filter(function (t) { return !gateOf(t.id); })[0];
      document.getElementById('detail-outline-note').textContent = stretch ? ' (a thick outline is ' + stretch.label + ')' : '';
    }

    // How a score reads: the gate's verdict, a bar for the headline, a number for the rest
    function tierCellContent(s, t, into) {
      var result = s.tier[t.id];
      if (gateOf(t.id)) {
        var v = s.verdict[t.id];
        if (!v) { into.textContent = NONE; return; }
        into.appendChild(el('span', { class: 'crucible-verdict is-' + v }, v === 'pass' ? '✓ Pass' : v === 'fail' ? '✕ Fail' : 'Partial'));
      } else if (t.id === HEAD) {
        if (result.score === null) { into.textContent = NONE; return; }
        var bar = el('span', { class: 'crucible-lb-bar' + (result.partial ? ' is-partial' : '') });
        var fill = el('span', { class: 'crucible-lb-fill' + (s.local ? ' is-local' : '') });
        fill.style.width = (result.score * 10) + '%';
        bar.appendChild(fill);
        into.appendChild(bar);
        into.appendChild(el('span', { class: 'crucible-lb-score' }, fmtScore(result.score)));
        if (result.partial) into.appendChild(el('span', { class: 'crucible-lb-note' }, result.scored + '/' + result.total));
      } else if (result && result.score !== null) {
        into.appendChild(el('span', {}, fmtScore(result.score)));
        if (result.partial) into.appendChild(el('span', { class: 'crucible-lb-note' }, result.scored + '/' + result.total));
      } else if (s.provisional[t.id] && s.provisional[t.id].score !== null) {
        into.appendChild(el('span', {}, fmtScore(s.provisional[t.id].score)));
        into.appendChild(el('span', { class: 'crucible-lb-note' }, 'provisional'));
      } else {
        into.textContent = NONE;
      }
    }

    function rankLabel(s, rank) {
      return s.ran && !s.inProgress && s.head.score !== null && !s.head.partial ? String(rank) : '';
    }

    function renderLeaderboard(list) {
      renderLeaderboardNote();
      var table = document.getElementById('crucible-leaderboard');
      table.innerHTML = '';
      if (isNarrow()) { renderLeaderboardCards(list); return; }
      document.getElementById('crucible-lb-narrow').innerHTML = '';
      var columns = [{ key: null, label: '#' }, { key: 'model', label: 'Model' }]
        .concat(TIERS.map(function (t) { return { key: t.id, label: t.label }; }))
        .concat([{ key: 'time', label: 'Time / task' }, { key: 'cost', label: 'Cost / task' }]);
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
          button.addEventListener('click', function () { setSort(c.key); });
          th.appendChild(button);
        }
        head.appendChild(th);
      });
      table.appendChild(el('thead')).appendChild(head);

      var body = table.appendChild(el('tbody'));
      var rank = 0;
      list.forEach(function (s) {
        var row = el('tr', { class: s.ran ? '' : 'is-not-run' });
        row.appendChild(el('td', { class: 'crucible-lb-rank' }, rankLabel(s, rank + 1)));
        if (rankLabel(s, rank + 1)) rank += 1;
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

        TIERS.forEach(function (t) {
          var td = el('td', { class: t.id === HEAD ? 'crucible-lb-bar-cell' : gateOf(t.id) ? '' : 'crucible-lb-num' });
          tierCellContent(s, t, td);
          row.appendChild(td);
        });
        row.appendChild(el('td', { class: 'crucible-lb-num' }, fmtSeconds(s.time)));
        row.appendChild(el('td', { class: 'crucible-lb-num' }, costLabel(s)));
        body.appendChild(row);
      });
    }

    function costLabel(s) { return s.local ? '$0 · local' : fmtUsd(s.cost); }

    function setSort(key) {
      // Scores sort high-first by default; time, cost and names low-first
      var natural = ['time', 'cost', 'model'].indexOf(key) === -1 ? -1 : 1;
      sort = { key: key, dir: sort.key === key ? -sort.dir : natural };
      render();
    }

    // A tier's score as a bar with its marking, for any tier: provisional and partial say so in words
    function tierBarInto(s, t, into) {
      var result = s.tier[t.id], prov = s.provisional[t.id];
      var counted = result && result.score !== null;
      var score = counted ? result.score : prov && prov.score !== null ? prov.score : null;
      if (score === null) { into.appendChild(el('span', {}, NONE)); return; }
      var partial = counted && result.partial;
      var bar = el('span', { class: 'crucible-lb-bar' + (partial || !counted ? ' is-partial' : '') });
      var fill = el('span', { class: 'crucible-lb-fill' + (s.local ? ' is-local' : '') });
      fill.style.width = (score * 10) + '%';
      bar.appendChild(fill);
      into.appendChild(bar);
      into.appendChild(el('span', { class: 'crucible-lb-score' }, fmtScore(score)));
      var verdict = s.verdict[t.id];
      if (verdict) into.appendChild(el('span', { class: 'crucible-verdict is-' + verdict }, verdict === 'pass' ? '✓ Pass' : verdict === 'fail' ? '✕ Fail' : 'Partial'));
      if (partial) into.appendChild(el('span', { class: 'crucible-lb-note' }, 'partial · ' + result.scored + '/' + result.total));
      else if (!counted) into.appendChild(el('span', { class: 'crucible-lb-note' }, 'provisional'));
    }

    // Below 640 px the table is hidden and each model is a card: rank, name, the headline score
    // as a bar, one line with the other tiers, time and cost, and the hardware underneath
    function renderLeaderboardCards(list) {
      var box = document.getElementById('crucible-lb-narrow');
      box.innerHTML = '';
      var bar = el('div', { class: 'crucible-lb-sortbar' });
      bar.appendChild(el('label', { for: 'crucible-lb-sort' }, 'Sort by'));
      var select = el('select', { id: 'crucible-lb-sort', class: 'crucible-select' });
      TIERS.map(function (t) { return [t.id, t.label]; }).concat([['time', 'Time / task'], ['cost', 'Cost / task'], ['model', 'Model']]).forEach(function (o) {
        var opt = el('option', { value: o[0] }, o[1]);
        if (o[0] === sort.key) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', function () { sort = { key: select.value, dir: ['time', 'cost', 'model'].indexOf(select.value) === -1 ? -1 : 1 }; render(); });
      bar.appendChild(select);
      box.appendChild(bar);

      var ol = box.appendChild(el('ul', { class: 'crucible-lb-cards' }));
      var rank = 0;
      list.forEach(function (s) {
        var label = rankLabel(s, rank + 1);
        if (label) rank += 1;
        var card = el('li', { class: 'crucible-lb-card' + (s.ran ? '' : ' is-not-run') });
        var top = card.appendChild(el('div', { class: 'crucible-lb-card-top' }));
        top.appendChild(el('span', { class: 'crucible-lb-rank' }, label || NONE));
        var name = top.appendChild(el('span', { class: 'crucible-lb-card-name' }));
        name.appendChild(el('span', { class: 'crucible-legend-name' }, modelLabel(s.model) + (s.inProgress ? ' *' : '')));
        name.appendChild(el('span', { class: 'crucible-tag' + (s.local ? ' is-local' : '') }, s.local ? 'local' : 'cloud'));
        if (showsHarnessTag() && s.harness) name.appendChild(el('span', { class: 'crucible-tag crucible-harness-tag' }, 'via ' + s.harness));
        if (!s.ran) {
          card.appendChild(el('p', { class: 'crucible-not-run' }, 'not run with ' + harnessPhrase()));
          ol.appendChild(card);
          return;
        }
        // The bar follows the sort: the tier sorted by, else the headline tier
        var barTier = tierSeen[sort.key] === true ? tierById(sort.key) : HEADLINE;
        var headline = card.appendChild(el('div', { class: 'crucible-lb-card-score' }));
        headline.appendChild(el('span', { class: 'crucible-lb-card-label' }, barTier.label));
        tierBarInto(s, barTier, headline);
        var parts = [];
        TIERS.forEach(function (t) {
          if (t.id === barTier.id) return;
          var holder = el('span');
          tierCellContent(s, t, holder);
          var text = Array.prototype.map.call(holder.children, function (c) { return c.textContent; }).join(' ');
          if (text) parts.push(t.label + ' ' + text);
        });
        var time = fmtSeconds(s.time) + '/task', cost = costLabel(s) + '/task';
        var line = card.appendChild(el('p', { class: 'crucible-lb-card-line' }));
        // Time and cost have no 0-10 bar, so the sorted one leads the line, in bold
        if (sort.key === 'time') line.appendChild(el('strong', {}, 'Time ' + time));
        else if (sort.key === 'cost') line.appendChild(el('strong', {}, 'Cost ' + cost));
        var rest = parts.concat(sort.key === 'time' ? [cost] : sort.key === 'cost' ? [time] : [time, cost]);
        line.appendChild(document.createTextNode((line.firstChild ? ' · ' : '') + rest.join(' · ')));
        if (s.hardware) card.appendChild(el('p', { class: 'crucible-legend-hw' }, s.hardware));
        ol.appendChild(card);
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
        return s.head.score !== null && x !== null && x > 0;
      });
      var skippedLocal = scatterMeasure === 'cost' && list.some(function (s) { return s.local && s.head.score !== null; });
      document.getElementById('scatter-sub').textContent = scatterMeasure === 'time'
        ? HEADLINE.label + ' score against median time per task. Up and to the left is better: the shaded corner is faster and better than the median, and the line joins models nothing else beats on both.'
        : HEADLINE.label + ' score against average API cost per task. Up and to the left is better.' +
          (skippedLocal ? ' Local models have no API cost and are left off.' : '');
      if (!points.length) {
        container.appendChild(el('p', { class: 'crucible-sub' }, 'Nothing to plot for this harness and filter yet.'));
        return;
      }

      // The viewBox is the container's width, so the chart scales to a phone instead of scrolling
      var width = Math.max(280, container.clientWidth || 560);
      var narrow = width < 500;
      var height = narrow ? 300 : 340;
      var m = narrow ? { top: 16, right: 14, bottom: 44, left: 32 } : { top: 16, right: 24, bottom: 44, left: 44 };
      var xs = points.map(function (s) { return scatterMeasure === 'time' ? s.time : s.cost; });
      var lo = Math.log10(Math.min.apply(null, xs)), hi = Math.log10(Math.max.apply(null, xs));
      if (hi - lo < 0.5) { lo -= 0.25; hi += 0.25; }
      lo -= 0.1; hi += 0.1;
      function x(v) { return m.left + (Math.log10(v) - lo) / (hi - lo) * (width - m.left - m.right); }
      function y(v) { return m.top + (1 - v / 10) * (height - m.top - m.bottom); }

      var root = svg('svg', {
        class: 'crucible-chart-svg', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img',
        'aria-label': HEADLINE.label + ' score against ' + (scatterMeasure === 'time' ? 'time' : 'cost') + ' per task, using ' + harnessPhrase() + '. The leaderboard has the same numbers.'
      });

      // Best quadrant: better than the median on both axes
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
      sorted.forEach(function (s) { if (s.head.score > best) { frontier.push(s); best = s.head.score; } });
      if (frontier.length > 1) {
        var d = frontier.map(function (s, i) {
          var px = x(scatterMeasure === 'time' ? s.time : s.cost), py = y(s.head.score);
          return (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
        }).join(' ');
        root.appendChild(svg('path', { class: 'crucible-frontier', d: d }));
      }

      var labelAll = points.length <= 12 && !narrow;
      points.forEach(function (s) {
        var px = x(scatterMeasure === 'time' ? s.time : s.cost), py = y(s.head.score);
        var color = s.local ? COLORS.local : COLORS.cloud;
        var dot = svg('circle', { class: 'crucible-dot' + (s.head.partial ? ' is-uncounted' : ''), cx: px, cy: py, r: 6,
          fill: s.head.partial ? '#fff' : color, stroke: s.head.partial ? color : '#fff' });
        var hit = svg('circle', { class: 'crucible-hit', cx: px, cy: py, r: 14 });
        hit.addEventListener('mouseenter', function () {
          tooltip.innerHTML = '';
          tooltip.appendChild(el('div', { class: 'crucible-tooltip-title' }, modelLabel(s.model) + (s.local ? ' · local' : ' · cloud') + ' · ' + s.harness));
          tooltip.appendChild(el('div', {}, HEADLINE.label + ' ' + fmtScore(s.head.score) + (s.head.partial ? ' (partial)' : '')));
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
      panel.appendChild(el('p', { class: 'crucible-tooltip-title' }, modelLabel(s.model) + ' · ' + s.harness + ' · ' + t.id + ' · ' + tierLabel(t.tier) +
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
      into.appendChild(el('p', { class: 'crucible-detail-prompt' }, t.summary || t.name || t.id));
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
        : 'Score ' + fmtScore(r.best_score) + ', from ' + (SOURCE_LABELS[r.score_source] || r.score_source) + '.' +
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
        var hidden = h.tests || [];
        var passed = hidden.filter(function (t) { return t.passed; }).length;
        into.appendChild(el('p', { class: 'crucible-detail-label' }, 'Hidden tests: ' + passed + '/' + hidden.length + ' pass'));
        if (h.error) into.appendChild(el('p', { class: 'crucible-flag' }, h.error));
        var list = el('ul', { class: 'crucible-checks' });
        var lastGroup = null;
        hidden.forEach(function (t) {
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
      if (isNarrow()) { table.innerHTML = ''; renderMatrixNarrow(rows); return; }
      document.getElementById('crucible-matrix-narrow').innerHTML = '';

      var tierRow = el('tr');
      tierRow.appendChild(el('th', { scope: 'col' }));
      tiers.forEach(function (tier) {
        var n = orderedTests.filter(function (t) { return t.tier === tier; }).length;
        tierRow.appendChild(el('th', { scope: 'colgroup', colspan: n, class: 'crucible-matrix-tier' }, tierLabel(tier)));
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

    // Below 640 px each table row becomes a card of label and value pairs
    function modelCard(s, ul) {
      var li = ul.appendChild(el('li', { class: 'crucible-card' }));
      var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
      title.appendChild(el('span', { class: 'crucible-legend-name' }, modelLabel(s.model)));
      title.appendChild(el('span', { class: 'crucible-tag' + (s.local ? ' is-local' : '') }, s.local ? 'local' : 'cloud'));
      if (showsHarnessTag() && s.harness) title.appendChild(el('span', { class: 'crucible-tag crucible-harness-tag' }, s.harness));
      return li;
    }

    function kvRow(parent, label, value, extraClass) {
      var row = parent.appendChild(el('div', { class: 'crucible-kv' + (extraClass ? ' ' + extraClass : '') }));
      row.appendChild(typeof label === 'string' ? el('span', { class: 'crucible-kv-label' }, label) : label);
      row.appendChild(typeof value === 'string' ? el('span', { class: 'crucible-kv-value' }, value) : value);
      return row;
    }

    // The matrix, one card per model: every task's score, grouped by tier
    function renderMatrixNarrow(rows) {
      var box = document.getElementById('crucible-matrix-narrow');
      box.innerHTML = '';
      if (!rows.length) {
        box.appendChild(el('p', { class: 'crucible-not-run' }, 'No runs with ' + harnessPhrase() + ' yet.'));
        return;
      }
      var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
      rows.forEach(function (s) {
        var li = modelCard(s, ul);
        tiers.forEach(function (tier) {
          li.appendChild(el('p', { class: 'crucible-card-group' }, tierLabel(tier)));
          orderedTests.filter(function (t) { return t.tier === tier; }).forEach(function (t) {
            var c = cell(s.model, s.harness, t.id);
            var label = el('span', { class: 'crucible-kv-label', title: t.summary || '' }, t.id);
            if (t.status === 'provisional') label.appendChild(el('span', { class: 'crucible-tag' }, 'provisional'));
            var value;
            if (c) {
              var score = c.run.best_score;
              value = el('button', { type: 'button', class: 'crucible-card-score', 'aria-label': modelLabel(s.model) + ' ' + t.id + ': ' + fmtScore(score) }, score === null ? '?' : fmtScore(score));
              if (score !== null) value.setAttribute('style', heatStyle(score));
              if (c.run.timed_out) value.classList.add('is-timeout');
              if (c.run.score_source === 'checks') value.classList.add('is-checked');
              value.addEventListener('click', function () {
                showCellDetail(s, t, c);
                document.getElementById('crucible-cell-detail').scrollIntoView({ block: 'start' });
              });
            } else {
              value = el('span', { class: 'crucible-not-run' }, 'not run');
            }
            kvRow(li, label, value, t.status === 'provisional' ? 'is-provisional' : '');
          });
        });
      });
    }

    // One model's mean in one area. No active test run yet (some areas are all provisional so far):
    // the provisional tests' mean instead, dashed like the matrix's provisional cells
    function areaResult(s, area) {
      var tests = orderedTests.filter(function (t) { return t.area === area.id && t.status === 'active'; });
      var cells = tests.map(function (t) { return cell(s.model, s.harness, t.id); }).filter(Boolean);
      var score = mean(cells.map(countedScore));
      var provisional = !cells.length;
      if (provisional) {
        tests = orderedTests.filter(function (t) { return t.area === area.id && t.status === 'provisional'; });
        cells = tests.map(function (t) { return cell(s.model, s.harness, t.id); }).filter(Boolean);
        score = mean(cells.map(function (c) { return c.run.best_score; }));
      }
      return { tests: tests, cells: cells, score: score, provisional: provisional };
    }

    function areaCellInto(td, r) {
      if (!r.cells.length) {
        td.className = 'is-not-run';
        td.textContent = 'not run';
        return;
      }
      if (r.score === null) td.className = 'is-not-scored';
      else td.setAttribute('style', heatStyle(r.score));
      if (r.provisional) {
        td.classList.add('is-provisional');
        td.title = 'Provisional tests only: not in tier scores yet';
      }
      td.appendChild(el('span', { class: 'crucible-heat-score' }, r.score === null ? 'not scored' : fmtScore(r.score)));
      td.appendChild(el('span', { class: 'crucible-heat-n' }, r.cells.length + '/' + r.tests.length + (r.provisional ? ' provisional' : ' tests')));
    }

    function renderHeatmap(list) {
      var table = document.getElementById('crucible-heatmap');
      table.innerHTML = '';
      var head = el('tr');
      head.appendChild(el('th', { scope: 'col' }, 'Model'));
      var areas = modeInfo().areas.filter(function (a) { return orderedTests.some(function (t) { return t.area === a.id; }); });
      (isNarrow() ? [] : areas).forEach(function (a) { head.appendChild(el('th', { scope: 'col' }, a.label)); });
      table.appendChild(el('thead')).appendChild(head);

      var body = table.appendChild(el('tbody'));
      var ran = list.filter(function (s) { return s.ran; });
      (isNarrow() ? [] : ran).forEach(function (s) {
        var row = el('tr');
        var th = el('th', { scope: 'row' });
        th.appendChild(el('span', {}, modelLabel(s.model)));
        th.appendChild(el('span', { class: 'crucible-tag' + (s.local ? ' is-local' : '') }, s.local ? 'local' : 'cloud'));
        row.appendChild(th);
        areas.forEach(function (area) {
          var td = el('td');
          areaCellInto(td, areaResult(s, area));
          row.appendChild(td);
        });
        body.appendChild(row);
      });

      // Below 640 px: one card per model, each area's mean and how many of its tests ran
      var box = document.getElementById('crucible-heatmap-narrow');
      box.innerHTML = '';
      if (!ran.length || !isNarrow()) return;
      var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
      ran.forEach(function (s) {
        var li = modelCard(s, ul);
        areas.forEach(function (area) {
          var holder = el('span', { class: 'crucible-narrow-cell' });
          areaCellInto(holder, areaResult(s, area));
          kvRow(li, area.label, holder);
        });
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

    // The tool-calls column shows when any run in this section reported the metric
    function modeHasToolCalls() {
      return data.runs.some(function (r) { return modeTestIds[r.test_id] && r.tool_calls !== null && r.tool_calls !== undefined; });
    }

    // Which areas are open in the detail table; collapsed by default, kept across model changes
    var openAreas = {};

    function testRow(m, t, columns, body) {
      var c = cell(m, harnessFor(m), t.id);
      var row = el('tr', { class: 'crucible-row' + (c ? '' : ' is-not-run') });
      var name = el('th', { scope: 'row' });
      name.appendChild(el('span', { class: 'crucible-test-id' }, t.id));
      name.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, tierLabel(t.tier)));
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
      if (modeHasToolCalls()) row.appendChild(el('td', {}, fmtInt(r.tool_calls)));
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
    // Runs of tasks no catalog lists are kept, but not counted: they sit under the model's detail
    function renderOtherRuns() {
      var p = document.getElementById('crucible-other-runs');
      var known = {};
      data.tests.forEach(function (t) { known[t.id] = true; });
      var other = data.runs.filter(function (r) { return r.model === detailModel && !known[r.test_id]; });
      p.hidden = !other.length;
      if (!other.length) return;
      var idsList = [];
      other.forEach(function (r) { if (idsList.indexOf(r.test_id) === -1) idsList.push(r.test_id); });
      p.textContent = 'Other runs: ' + other.length + ' run' + (other.length === 1 ? '' : 's') + ' of tests this page doesn\'t list (' +
        idsList.slice(0, 8).join(', ') + (idsList.length > 8 ? ', …' : '') + '). They aren\'t counted in any score.';
    }

    // The collapsible area header: its mean, how many tests ran, and one square per test
    function areaToggle(area, tests, cells, key, open) {
      var ran = cells.filter(Boolean).length;
      var avg = mean(cells.map(function (c) { return c ? c.run.best_score : null; }));
      var button = el('button', { type: 'button', class: 'crucible-area-toggle', 'aria-expanded': open });
      button.appendChild(el('span', { class: 'crucible-area-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'));
      button.appendChild(el('span', { class: 'crucible-area-name' }, area.label));
      button.appendChild(el('span', { class: 'crucible-tag' }, String(tests[0].id).split('-')[0]));
      var chip = el('span', { class: 'crucible-area-score' }, avg === null ? NONE : (isNarrow() ? 'mean ' : '') + fmtScore(avg));
      if (avg !== null) chip.setAttribute('style', heatStyle(avg));
      button.appendChild(chip);
      button.appendChild(el('span', { class: 'crucible-area-count' }, ran + '/' + tests.length + ' run'));
      var strip = el('span', { class: 'crucible-area-strip', 'aria-hidden': 'true' });
      tests.forEach(function (t, k) {
        var c = cells[k], score = c ? c.run.best_score : null;
        var sq = el('span', { class: 'crucible-area-sq is-role-' + tierRole(t.tier) + (c ? '' : ' is-empty'), title: t.id + ' · ' + tierLabel(t.tier) + ' · ' + (c ? fmtScore(score) : 'not run') });
        if (score !== null) sq.setAttribute('style', heatStyle(score));
        strip.appendChild(sq);
      });
      button.appendChild(strip);
      button.addEventListener('click', function () { openAreas[key] = !open; renderTests(); });
      return button;
    }

    // Below 640 px a test is a card: its numbers as label and value pairs, tap for its detail
    function testCard(m, t, ul) {
      var c = cell(m, harnessFor(m), t.id);
      var li = ul.appendChild(el('li', { class: 'crucible-card crucible-test-card' + (c ? '' : ' is-not-run') }));
      var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
      title.appendChild(el('span', { class: 'crucible-test-id' }, t.id));
      title.appendChild(el('span', { class: 'crucible-tag crucible-tier-tag is-' + t.tier }, tierLabel(t.tier)));
      if (t.status === 'provisional') title.appendChild(el('span', { class: 'crucible-tag' }, 'provisional'));
      li.appendChild(el('p', { class: 'crucible-test-summary' }, t.summary || t.name || ''));
      if (!c) { li.appendChild(el('p', { class: 'crucible-not-run' }, 'not run')); return; }
      var r = c.run;
      var score = el('span', { class: 'crucible-kv-value' });
      score.appendChild(el('span', { class: 'crucible-score-num' }, fmtScore(r.best_score)));
      var bar = score.appendChild(el('span', { class: 'crucible-bar' + (r.counts ? '' : ' is-uncounted') }));
      var fill = bar.appendChild(el('span', { class: 'crucible-bar-fill' }));
      fill.style.width = (r.best_score === null ? 0 : r.best_score * 10) + '%';
      kvRow(li, 'Score', score);
      var time = el('span', { class: 'crucible-kv-value' }, fmtSeconds(r.elapsed_s));
      if (r.timed_out || r.status !== 'COMPLETE') time.appendChild(el('span', { class: 'crucible-flag' }, r.timed_out ? 'timed out' : (r.status || '').toLowerCase()));
      kvRow(li, 'Time', time);
      if (modeHasToolCalls()) kvRow(li, 'Tool calls', fmtInt(r.tool_calls));
      kvRow(li, 'Tokens out', fmtInt(r.tokens_out));
      kvRow(li, 'Cost', isLocal(m) ? '$0' : fmtUsd(r.cost_usd));
      kvRow(li, 'Runs', String(c.count));
      var detail = li.appendChild(el('div', { class: 'crucible-detail', hidden: '' }));
      promptBlock(t, detail);
      runDetail(r, detail);
      var notes = ['Run ' + r.run_id, (r.status || NONE).toLowerCase(), 'test v' + (r.test_version || '?'), 'tokens in ' + fmtInt(r.tokens_in)];
      if (c.count > 1) notes.push('showing the latest of ' + c.count + ' runs');
      if (!r.counts) notes.push(t.status === 'provisional' ? 'provisional test, not in tier scores' : 'older test version, not in tier scores');
      detail.appendChild(el('p', { class: 'crucible-detail-meta' }, notes.join(' · ')));
      var more = li.appendChild(el('button', { type: 'button', class: 'crucible-card-more', 'aria-expanded': 'false' }, 'Show checks and output'));
      more.addEventListener('click', function () {
        var open = detail.hidden;
        detail.hidden = !open;
        more.setAttribute('aria-expanded', open);
        more.textContent = open ? 'Hide checks and output' : 'Show checks and output';
      });
    }

    function renderTestsNarrow(m) {
      var box = document.getElementById('crucible-tests-narrow');
      box.innerHTML = '';
      modeInfo().areas.forEach(function (area) {
        var tests = orderedTests.filter(function (t) { return t.area === area.id; });
        if (!tests.length) return;
        tests.sort(function (a, b) { return tiers.indexOf(a.tier) - tiers.indexOf(b.tier); });
        var cells = tests.map(function (t) { return cell(m, harnessFor(m), t.id); });
        var key = mode + ':' + area.id;
        var open = !!openAreas[key];
        var group = box.appendChild(el('div', { class: 'crucible-area-narrow' + (open ? ' is-open' : '') }));
        group.appendChild(areaToggle(area, tests, cells, key, open));
        if (open) {
          var ul = group.appendChild(el('ul', { class: 'crucible-cards' }));
          tests.forEach(function (t) { testCard(m, t, ul); });
        }
      });
    }

    function renderTests() {
      var table = document.getElementById('crucible-tests');
      table.innerHTML = '';
      renderOtherRuns();
      if (!detailModel) return;
      var m = detailModel;
      if (isNarrow()) { renderTestsNarrow(m); return; }
      document.getElementById('crucible-tests-narrow').innerHTML = '';
      var columns = ['Test', 'Score', 'Time'].concat(modeHasToolCalls() ? ['Tool calls'] : [], ['Tokens out', 'Cost', 'Runs']);
      var head = el('tr');
      columns.forEach(function (c) { head.appendChild(el('th', { scope: 'col' }, c)); });
      table.appendChild(el('thead')).appendChild(head);

      modeInfo().areas.forEach(function (area) {
        var tests = orderedTests.filter(function (t) { return t.area === area.id; });
        if (!tests.length) return;
        tests.sort(function (a, b) { return tiers.indexOf(a.tier) - tiers.indexOf(b.tier); });
        var cells = tests.map(function (t) { return cell(m, harnessFor(m), t.id); });
        var key = mode + ':' + area.id;
        var open = !!openAreas[key];

        var body = table.appendChild(el('tbody', { class: 'crucible-area' + (open ? ' is-open' : '') }));
        var groupRow = el('tr', { class: 'crucible-group crucible-area-row' });
        var th = el('th', { colspan: columns.length, scope: 'rowgroup' });
        th.appendChild(areaToggle(area, tests, cells, key, open));
        groupRow.appendChild(th);
        body.appendChild(groupRow);
        if (open) tests.forEach(function (t) { testRow(m, t, columns, body); });
      });
    }

    // What is scored how, from the tests themselves: areas whose tests all use programmatic
    // checks, and whether any test needs the judge
    function renderCaveat() {
      var p = document.getElementById('crucible-caveat');
      var live = data.tests.filter(function (t) { return t.status !== 'retired'; });
      var checked = [];
      MODES.forEach(function (m) {
        m.areas.forEach(function (a) {
          var tests = live.filter(function (t) { return t.mode === m.id && t.area === a.id; });
          if (tests.length && tests.every(function (t) { return t.scoring_method === 'checks'; })) checked.push(a.label.toLowerCase());
        });
      });
      var judged = live.some(function (t) { return t.scoring_method === 'judge'; });
      var hidden = live.some(function (t) { return t.scoring_method === 'hidden_tests'; });
      var text = '';
      if (checked.length) {
        text += cap(checked.join(', ')) + ' tests are scored by programmatic checks: fixed rules applied to the model\'s answer, the same way every time. ';
      }
      if (judged) {
        text += (checked.length ? 'Other tests' : 'Tests') + ' are scored by an AI judge (Claude) against the test\'s rubric' +
          (hidden ? ', with hidden acceptance tests where there are any' : '') +
          '. Judge scores are a rough signal, not a precise eval, so treat differences of a point or two as noise.';
      }
      p.hidden = !text;
      p.innerHTML = '';
      if (!text) return;
      p.appendChild(el('strong', {}, 'How scores are made. '));
      p.appendChild(document.createTextNode(text));
      if (checked.length) {
        var link = el('a', { href: '/crucible/about/' }, 'About');
        p.appendChild(document.createTextNode(' Each rule is listed on the '));
        p.appendChild(link);
        p.appendChild(document.createTextNode(' page.'));
      }
    }

    function render() {
      bestCache = {};
      applyLayout();
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
      var wanted = modeFromHash();
      if (wanted !== mode) { mode = wanted; harness = 'best'; render(); }
    });

    // Crossing 640 px swaps the layouts
    var shownNarrow = isNarrow();
    function relayout() {
      if (isNarrow() === shownNarrow) return;
      shownNarrow = isNarrow();
      render();
    }
    if (narrowQuery) {
      if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', relayout);
      else if (narrowQuery.addListener) narrowQuery.addListener(relayout);
    }

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { relayout(); renderScatter(rankedStats()); }, 150);
    });

    var release = data.release && data.release.release ? 'Release ' + data.release.release + '. ' : '';
    document.getElementById('crucible-footnote').textContent = release +
      '— means the harness didn\'t report that number. Cost per task is the harness\'s own estimate from OpenRouter prices; ' +
      'local models have no API cost. Token counts aren\'t comparable across harnesses.' +
      (data.generated_at ? ' Data exported ' + String(data.generated_at).slice(0, 10) + '.' : '');
    renderCaveat();
    resultsEl.hidden = false;
    render();
    showStatus(data.skipped ? 'Some results were published with a newer Crucible than this page understands, so they are not shown.' : '');
  }

  load();
})();
