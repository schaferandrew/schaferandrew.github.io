// Crucible results: a suite, a leaderboard, then the views below it.
// The page reads bundle format 3: one catalog per suite (what a suite is) plus run, score and status
// records (what happened), joined here. Everything shown comes from those records: modes, areas,
// tiers, thresholds and their text come from the selected suite's catalog. FALLBACKS
// (_data/crucible_fallbacks.yml) only fill a label a catalog doesn't carry, and anything the page
// doesn't recognize renders generically instead of throwing.
(function () {
  var SUPPORTED_FORMAT = 3; // a record or catalog with a higher format_version is skipped, with a notice
  var NONE = '—';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Two identities on the scatter: local (the point of Crucible) and cloud (the reference)
  var COLORS = { local: '#2a78d6', cloud: '#eb6834' };
  var MAX_COMPARE = 4;
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

  // The records are a generated JSON page, fetched after first paint instead of inlined
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

  function num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function cap(id) { id = String(id); return id.charAt(0).toUpperCase() + id.slice(1); }
  function ids(list) {
    return (list || []).map(function (h) { return typeof h === 'string' ? h : h && h.id; }).filter(Boolean);
  }
  // A share meets a threshold at exactly the threshold (6 of 8 meets 0.75), whatever the float rounding
  function meets(share, min) { return share + 1e-9 >= min; }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function scoreKey(uuid, rubric, method) { return uuid + '|' + rubric + '|' + method; }
  function newer(node) { return typeof node.format_version === 'number' && node.format_version > SUPPORTED_FORMAT; }

  // Find every record, wherever Jekyll nested it (folders become nested hashes): catalogs, runs,
  // score records and status records. Keys are file names; only the records' own fields are read.
  function collect(payload) {
    var out = { catalogs: [], runs: {}, scores: {}, scoresByRun: {}, status: {}, skipped: 0 };
    function add(node) {
      if (node.record === 'run') {
        if (newer(node)) out.skipped += 1;
        else if (node.run_uuid && !out.runs[node.run_uuid]) out.runs[node.run_uuid] = node;
        return true;
      }
      if (node.record === 'score') {
        if (newer(node)) { out.skipped += 1; return true; }
        if (!node.run_uuid) return true;
        out.scores[scoreKey(node.run_uuid, node.rubric_version, node.method)] = node;
        (out.scoresByRun[node.run_uuid] = out.scoresByRun[node.run_uuid] || []).push(node);
        return true;
      }
      if (node.record === 'status') {
        if (node.run_uuid) (out.status[node.run_uuid] = out.status[node.run_uuid] || []).push(node);
        return true;
      }
      if (node.suite && Array.isArray(node.tasks)) {
        if (newer(node)) out.skipped += 1;
        else out.catalogs.push(node);
        return true;
      }
      return false;
    }
    (function walk(node) {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      if (add(node)) return;
      if (newer(node)) { out.skipped += 1; return; }
      Object.keys(node).forEach(function (k) { walk(node[k]); });
    })([payload.catalogs, payload.runs, payload.scores, payload.status]);
    // Status records only ever append: the last one wins
    Object.keys(out.status).forEach(function (uuid) {
      out.status[uuid].sort(function (a, b) { return (a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : 0; });
    });
    // One catalog per suite, newest suite first (by its version, then its cut date)
    var bySuite = {};
    out.catalogs.forEach(function (c) {
      var id = String(c.suite.id || c.suite.version || '?');
      if (!bySuite[id] || num(c.format_revision, 0) > num(bySuite[id].format_revision, 0)) bySuite[id] = c;
    });
    function versionParts(c) {
      return String(c.suite.version || c.suite.id || '').replace(/^v/i, '').split('.').map(function (p) { return parseInt(p, 10) || 0; });
    }
    out.catalogs = Object.keys(bySuite).map(function (k) { return bySuite[k]; }).sort(function (a, b) {
      var va = versionParts(a), vb = versionParts(b);
      for (var i = 0; i < Math.max(va.length, vb.length); i++) {
        if ((va[i] || 0) !== (vb[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
      }
      return (b.suite.cut_at || '') < (a.suite.cut_at || '') ? -1 : 1;
    });
    return out;
  }

  function start(payload) {
    var FB = payload.fallbacks || {};
    var FB_MODES = FB.modes || {}, FB_TIERS = FB.tiers || {}, FB_AREAS = FB.areas || {}, FB_METHODS = FB.scoring_methods || {};
    var store = collect(payload);
    var skippedNote = store.skipped ? 'Some results were published with a newer Crucible than this page understands, so they are not shown.' : '';
    if (!store.catalogs.length) {
      showStatus(skippedNote || 'No results have been published yet.');
      return;
    }
    function suiteId(c) { return String(c.suite.id || c.suite.version); }
    // Suites the display settings (_data/crucible_display.yml) hide aren't selectable; if that would
    // hide every suite, all of them stay visible
    var DISPLAY = payload.display || {};
    var hiddenSuites = (DISPLAY.hidden_suites || []).map(String);
    // A local run isn't billed: its cost is the electricity it used, its time x its machine's watts
    // (display settings, by hardware key) x the price per kWh. None when the machine has no watts listed
    var ENERGY = DISPLAY.energy || {};
    function wattsOf(hwKey) { var w = num((ENERGY.watts || {})[hwKey], null); return w && w > 0 ? w : null; }
    function isLocalRun(run) { return !!(run.endpoint && run.endpoint.where === 'local'); }
    function runCost(run) {
      if (!isLocalRun(run)) return num((run.metrics || {}).cost_usd, null);
      var w = wattsOf(run.hardware && run.hardware.key), t = num(run.elapsed_s, null), price = num(ENERGY.usd_per_kwh, null);
      return w && t !== null && price !== null ? w * t / 3600000 * price : null;
    }
    var SUITES = store.catalogs.filter(function (c) { return hiddenSuites.indexOf(suiteId(c)) === -1; });
    if (!SUITES.length) SUITES = store.catalogs;
    function suiteName(c) { var id = suiteId(c); return 'Suite ' + (/^v/i.test(id) ? id : 'v' + id); }
    var CURRENT = SUITES.filter(function (c) { return c.suite.status === 'current'; })[0] || SUITES[0];

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
      if (v < 0.0001) return '<$0.0001';
      return '$' + (v < 0.01 ? v.toPrecision(2) : v.toFixed(v < 1 ? 3 : 2));
    }
    // A local cost is an electricity estimate, marked as such; a cloud cost is what the provider billed
    function fmtCost(v, local) { return (local && v !== null && v !== undefined ? '≈' : '') + fmtUsd(v); }
    function fmtInt(v) { return v === null || v === undefined ? NONE : v.toLocaleString(); }
    function fmtDate(v) { return v ? String(v).slice(0, 10) : NONE; }

    // Decode speed: a run's output tokens (reasoning included) over its generation time, prompt
    // processing left out (metrics.output_tokens_per_s). Older runs don't have it; they never count.
    function runTps(run) { var v = num(((run && run.metrics) || {}).output_tokens_per_s, null); return v !== null && v > 0 ? v : null; }
    // The median over the runs that recorded it, with how many did
    function tpsOf(runs) {
      var values = runs.map(function (i) { return runTps(i.run); }).filter(function (v) { return v !== null; });
      return { value: median(values), n: values.length };
    }
    function fmtTps(v, bare) { return v === null || v === undefined ? NONE : (v < 10 ? v.toFixed(1) : String(Math.round(v))) + (bare ? '' : ' tok/s'); }
    function tpsTitle(t, of) {
      return t.n ? 'Decode speed: median of the ' + t.n + (of ? ' of ' + of : '') + ' run' + (t.n === 1 ? '' : 's') + ' that recorded it (output tokens per second of generation, prompt processing excluded)'
        : 'Decode speed wasn\'t recorded for these runs';
    }

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

    // Repeats: the mean, with n and the range (never the best or the latest run)
    function agg(values) {
      values = values.filter(function (v) { return v !== null && v !== undefined; });
      if (!values.length) return null;
      return { mean: mean(values), n: values.length, min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
    }
    function fmtRepeat(a) {
      if (!a) return NONE;
      if (a.n === 1) return '1 run';
      return a.n + ' runs, ' + (a.min === a.max ? 'all ' + fmtScore(a.min) : fmtScore(a.min) + '–' + fmtScore(a.max));
    }

    // ---- Configurations ----------------------------------------------------

    // A configuration is one model, as weights, at one reasoning level, on one endpoint, hardware
    // and harness (the run record's identity keys). Rows on the leaderboard are a base model at a
    // reasoning level; a row is scored by its single best configuration.
    var CONFIGS = {}, SLUGS = {};
    function shortName(base) { var parts = String(base).split('/'); return parts[parts.length - 1]; }
    function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, ''); }

    // The identity fields a configuration is made of, from the run record. null means "not
    // recorded" (older and migrated runs often lack the publisher, the resolved reasoning level or
    // the hardware key), never a different setup. OpenRouter's upstream provider is per-request
    // routing, not a setup anyone chose, so it never splits one (a run's detail names it).
    var FIELDS = ['publisher', 'format', 'quant', 'reasoning', 'provider', 'hwKey', 'device'];
    function identityOf(r) {
      var m = r.model || {}, e = r.endpoint || {}, hw = r.hardware || null;
      var vk = m.variant_key ? String(m.variant_key).split('|') : [];
      function known(v) { return v === undefined || v === null || v === '' || v === '-' ? null : String(v); }
      var where = e.where || (hw && hw.key ? 'local' : 'cloud');
      var local = where === 'local';
      var rs = m.reasoning || {};
      var requested = known(rs.requested), resolved = known(rs.resolved);
      // An explicitly requested level is known; "default" is known only once it resolved
      var explicit = requested && requested !== 'default';
      return {
        base: m.base || vk[0] || m.id || 'unknown', where: where, local: local,
        harness: (r.harness && r.harness.id) || 'unknown',
        publisher: known(vk.length ? vk[1] : m.publisher),
        format: known(vk.length ? vk[2] : m.format),
        quant: known(vk.length ? vk[3] : m.quant && String(m.quant).toLowerCase()),
        reasoning: explicit ? requested : resolved,
        reqDefault: !explicit,
        provider: local ? null : known(e.provider),
        hwKey: local ? known(hw && hw.key) : null,
        // The machine that served the weights (an LM Link peer, or this machine's label)
        device: local ? known(e.device || (hw && hw.label)) : null,
        quantLabel: m.quant || null, publisherLabel: m.publisher || null
      };
    }
    function rawKey(id) {
      return [id.base, id.where, id.harness, id.reqDefault ? 'd' : 'x'].concat(FIELDS.map(function (f) { return id[f] === null ? '?' : id[f]; })).join('|');
    }
    function unknowns(id) { return FIELDS.filter(function (f) { return id[f] === null; }); }
    // b can stand for a: same base, endpoint kind and harness, and every field both recorded agrees.
    // A run that asked for the default reasoning level and didn't record what it resolved to only
    // matches runs that also asked for the default.
    function compatible(a, b) {
      if (a.base !== b.base || a.where !== b.where || a.harness !== b.harness) return false;
      if (a.reasoning === null && !b.reqDefault) return false;
      if (b.reasoning === null && !a.reqDefault) return false;
      return FIELDS.every(function (f) { return a[f] === null || b[f] === null || a[f] === b[f]; });
    }
    function strictlyMoreKnown(b, a) {
      var ua = unknowns(a), ub = unknowns(b);
      return ub.length < ua.length && ub.every(function (f) { return ua.indexOf(f) !== -1; });
    }

    // Group every run by its recorded identity, then merge a group with unrecorded fields into the
    // one better-recorded group it matches; when two or more match, it stays its own setup.
    var CONFIG_OF_RUN = {};
    (function buildConfigs() {
      var groups = {}, order = [];
      Object.keys(store.runs).forEach(function (uuid) {
        var r = store.runs[uuid], id = identityOf(r), k = rawKey(id);
        if (!groups[k]) { groups[k] = { key: k, id: id, runs: [] }; order.push(k); }
        groups[k].runs.push(r);
      });
      var target = {};
      order.forEach(function (k) {
        var g = groups[k];
        if (!unknowns(g.id).length) return;
        var cands = order.filter(function (o) { return o !== k && compatible(g.id, groups[o].id) && strictlyMoreKnown(groups[o].id, g.id); });
        // Keep the best-recorded candidates: drop one that another candidate refines
        var top = cands.filter(function (c) {
          return !cands.some(function (d) { return d !== c && compatible(groups[c].id, groups[d].id) && strictlyMoreKnown(groups[d].id, groups[c].id); });
        });
        if (top.length === 1) target[k] = top[0];
      });
      function resolve(k) { var seen = {}; while (target[k] && !seen[k]) { seen[k] = true; k = target[k]; } return k; }
      order.forEach(function (k) {
        var finalKey = resolve(k), g = groups[finalKey], id = g.id;
        var cfg = CONFIGS[finalKey];
        if (!cfg) {
          var level = id.reasoning || 'default';
          cfg = CONFIGS[finalKey] = {
            key: finalKey, rowKey: id.base + '#' + level, base: id.base, level: level, where: id.where, local: id.local,
            harness: id.harness, quant: id.quantLabel || id.quant, publisher: id.publisherLabel || id.publisher,
            hwKey: id.hwKey, provider: id.provider, servedVia: {}, devices: {}, merged: 0
          };
          var slug = [shortName(id.base), level !== 'default' ? 'reasoning-' + level : '', id.local ? id.quant : '',
            id.local ? id.hwKey || id.device || 'local' : id.provider || 'cloud', id.harness]
            .filter(Boolean).map(slugify).join('~');
          var unique = slug, i = 2;
          while (SLUGS[unique]) unique = slug + '~' + (i++);
          cfg.slug = unique;
          SLUGS[unique] = cfg;
        }
        if (finalKey !== k) cfg.merged += groups[k].runs.length;
        groups[k].runs.forEach(function (r) {
          CONFIG_OF_RUN[r.run_uuid] = cfg;
          var e = r.endpoint || {}, hw = r.hardware || null;
          if (cfg.local) {
            var device = e.device || (hw && hw.label);
            if (device) cfg.devices[device] = true;
            if (e.served_via) cfg.servedVia[e.served_via] = true;
          }
        });
      });
    })();
    function configOf(r) { return CONFIG_OF_RUN[r.run_uuid]; }

    function rowLabel(cfg) { return shortName(cfg.base) + (cfg.level !== 'default' ? ' (reasoning ' + cfg.level + ')' : ''); }
    function hardwareText(cfg) {
      var devices = Object.keys(cfg.devices);
      if (!cfg.hwKey) return devices.length ? devices.join(', ') : 'hardware not recorded';
      return cfg.hwKey + (devices.length ? ' (' + devices.join(', ') + ')' : '');
    }
    // "Q4_K_M · rtx-5070-ti-16gb (Whitehall) · direct" or "via openrouter (OpenAI) · direct"
    function configLabel(cfg) {
      var parts = cfg.local
        ? [(cfg.publisher ? cfg.publisher + ' ' : '') + (cfg.quant || 'quant not recorded'), hardwareText(cfg)]
        : ['via ' + (cfg.provider || 'cloud')];
      return parts.concat([cfg.harness]).join(' · ');
    }
    // A model's name never breaks inside its slug ("qwen3.6-35b-a3b"): only before "(reasoning …)"
    function nameNode(label, suffix) {
      var span = el('span', { class: 'crucible-legend-name' });
      var i = label.indexOf(' (');
      span.appendChild(el('span', { class: 'crucible-slug' }, i === -1 ? label : label.slice(0, i)));
      if (i !== -1) span.appendChild(document.createTextNode(label.slice(i)));
      if (suffix) span.appendChild(document.createTextNode(suffix));
      return span;
    }
    function whereTag(cfg) {
      return el('span', { class: 'crucible-tag' + (cfg.local ? ' is-local' : '') }, cfg.where === 'local' || cfg.where === 'cloud' ? cfg.where : cap(cfg.where));
    }

    // A run's standing: withdrawn runs never show; invalid ones show, flagged, and never count
    function validity(uuid, r) {
      var list = store.status[uuid];
      var last = list && list[list.length - 1];
      if (last) {
        if (last.withdrawn) return 'withdrawn';
        if (last.invalid) return 'invalid';
        if (last.valid === true) return 'valid';
      }
      return r.outcome && r.outcome.invalid ? 'invalid' : 'valid';
    }
    function invalidReason(uuid, r) {
      var list = store.status[uuid], last = list && list[list.length - 1];
      var inv = (last && last.invalid) || (r.outcome && r.outcome.invalid);
      return inv && (inv.reason || inv.detail) || null;
    }

    // ---- Suite context -----------------------------------------------------

    // Everything the selected suite decides: its tasks, tiers, modes, weights, and which runs count
    function buildSuite(cat) {
      var S = { cat: cat };
      var tasks = (cat.tasks || []).filter(function (t) { return t && t.id; });
      var taskById = {}, aliasOf = {};
      tasks.forEach(function (t) {
        taskById[t.id] = t;
        (t.aliases || []).forEach(function (a) { aliasOf[a] = t.id; });
        t.scoring_method = t.scoring && typeof t.scoring === 'object' ? t.scoring.method : t.scoring;
      });
      S.tasks = tasks;
      S.taskById = taskById;
      S.categoryWeights = {};
      (cat.categories || []).forEach(function (c) { if (c && c.id && typeof c.weight === 'number') S.categoryWeights[c.id] = c.weight; });

      var policy = cat.scoring_policy || {}, policyFb = FB.scoring_policy || {};
      S.COVERAGE_MIN = num(policy.coverage_min, num(policyFb.coverage_min, 0.75));
      S.IN_PROGRESS_BELOW = num(policy.in_progress_below, num(policyFb.in_progress_below, 0.75));

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
      (cat.tiers || []).forEach(function (t) {
        var id = typeof t === 'string' ? t : t && t.id;
        if (!id || tierSeen[id]) return;
        tierSeen[id] = true;
        TIERS.push(tierInfo(id, typeof t === 'object' ? t : {}, TIERS.length));
      });
      tasks.forEach(function (t) {
        if (t.tier && !tierSeen[t.tier]) { tierSeen[t.tier] = true; TIERS.push(tierInfo(t.tier, {}, TIERS.length)); }
      });
      if (!TIERS.length) TIERS.push(tierInfo('all', { label: 'Score' }, 0));
      TIERS.sort(function (a, b) { return a.order - b.order || a.pos - b.pos; });
      S.TIERS = TIERS;
      S.tierSeen = tierSeen;
      S.HEADLINE = TIERS.filter(function (t) { return t.role === 'headline'; })[0] ||
        TIERS.filter(function (t) { return t.role !== 'gate'; })[0] || TIERS[0];
      S.HEAD = S.HEADLINE.id;
      S.STRETCH = TIERS.filter(function (t) { return t.id !== S.HEAD && t.role !== 'gate'; });

      // Modes: sections that are never ranked together, each with its own harnesses and areas
      var harnessModes = {};
      (cat.harnesses || []).forEach(function (h) { if (h && h.id) harnessModes[h.id] = h.modes || []; });
      var modes = [], seen = {};
      function addMode(id, o) {
        if (!id || seen[id]) return;
        seen[id] = true;
        var fb = FB_MODES[id] || {};
        var areas = (o.areas || (cat.areas || []).filter(function (a) { return a && a.mode === id; })).filter(Boolean).map(function (a, i) {
          return { id: a.id, label: a.label || (FB_AREAS[a.id] || {}).label || cap(a.id), order: num(a.order, i) };
        }).sort(function (a, b) { return a.order - b.order; });
        var harnesses = ids(o.harnesses || (cat.harnesses || []).filter(function (h) { return h && h.modes && h.modes.indexOf(id) !== -1; }));
        modes.push({ id: id, label: o.label || fb.label || cap(id), blurb: o.blurb || fb.blurb || '', areas: areas, harnesses: harnesses, order: num(o.order, num(fb.order, 1000 + modes.length)), pos: modes.length });
      }
      (cat.modes || []).forEach(function (m) { if (m && typeof m === 'object') addMode(m.id, m); });
      tasks.forEach(function (t) { if (t.mode) addMode(t.mode, {}); });
      modes.forEach(function (m) {
        tasks.forEach(function (t) {
          if (t.mode === m.id && t.area && !m.areas.some(function (a) { return a.id === t.area; })) {
            m.areas.push({ id: t.area, label: (FB_AREAS[t.area] || {}).label || cap(t.area), order: 1000 });
          }
        });
      });
      S.MODES = modes.sort(function (a, b) { return a.order - b.order || a.pos - b.pos; });
      function harnessCounts(h, mode) {
        // A harness the catalog doesn't declare for any mode is unknown: it never counts
        return (harnessModes[h] || []).indexOf(mode) !== -1;
      }

      // Join every run to this suite. A run counts when the suite pins its task (active) at the
      // run's task version, through one of its mode's harnesses, and it isn't invalid or withdrawn;
      // its score is its score record at the rubric version the suite pins.
      S.cells = {};       // cfg.key -> task id -> { all, counted, provisional }
      S.cfgModes = {};    // cfg.key -> mode id -> true
      S.other = {};       // cfg.key -> [runs of tasks this catalog doesn't list]
      S.unscored = 0;     // counted runs with no score record at the pinned rubric version
      Object.keys(store.runs).forEach(function (uuid) {
        var r = store.runs[uuid];
        var valid = validity(uuid, r);
        if (valid === 'withdrawn') return;
        var cfg = configOf(r);
        var taskRef = r.task || {};
        var t = taskById[taskRef.id] || taskById[aliasOf[taskRef.id]] || taskById[aliasOf[taskRef.alias]];
        if (!t) { (S.other[cfg.key] = S.other[cfg.key] || []).push(r); return; }
        if (t.status === 'retired') return;
        var sameVersion = t.version === null || t.version === undefined || taskRef.version === t.version;
        var state;
        if (valid === 'invalid') state = 'invalid';
        else if (!sameVersion) state = 'older';
        else if (!harnessCounts(cfg.harness, t.mode)) state = 'harness';
        else if (t.status === 'active') state = 'counted';
        else state = 'provisional';
        // The pinned rubric version's score record; anything that doesn't count may show its newest
        var rec = store.scores[scoreKey(uuid, t.rubric_version, t.scoring_method)] ||
          (store.scoresByRun[uuid] || []).filter(function (s) { return s.rubric_version === t.rubric_version; })[0] || null;
        if (!rec && state !== 'counted') {
          rec = (store.scoresByRun[uuid] || []).slice().sort(function (a, b) { return b.rubric_version - a.rubric_version; })[0] || null;
        }
        if (state === 'counted' && !rec) S.unscored += 1;
        var info = { run: r, uuid: uuid, task: t, cfg: cfg, state: state, rec: rec, score: rec && typeof rec.score === 'number' ? rec.score : null };
        var byTask = (S.cells[cfg.key] = S.cells[cfg.key] || {});
        var c = (byTask[t.id] = byTask[t.id] || { all: [], counted: [], provisional: [] });
        c.all.push(info);
        if (state === 'counted' && info.score !== null) c.counted.push(info);
        if (state === 'provisional' && info.score !== null) c.provisional.push(info);
        (S.cfgModes[cfg.key] = S.cfgModes[cfg.key] || {})[t.mode] = true;
      });
      Object.keys(S.cells).forEach(function (k) {
        Object.keys(S.cells[k]).forEach(function (id) {
          S.cells[k][id].all.sort(function (a, b) { return (b.run.started_at || '') < (a.run.started_at || '') ? -1 : 1; });
        });
      });
      return S;
    }

    // ---- State ------------------------------------------------------------

    var state = {
      suite: suiteId(CURRENT), mode: '', harness: 'best', where: 'all', hw: 'all', showInProgress: false,
      scatter: 'time', sort: null, detailRow: null, detailCfg: null, compare: [], open: {}
    };
    var S = null;
    var suiteCache = {};
    function catalogById(id) { return SUITES.filter(function (c) { return suiteId(c) === id; })[0] || null; }
    function useSuite(id) {
      var cat = catalogById(id) || CURRENT;
      state.suite = suiteId(cat);
      S = suiteCache[state.suite] = suiteCache[state.suite] || buildSuite(cat);
      if (!S.MODES.some(function (m) { return m.id === state.mode; })) state.mode = S.MODES[0] ? S.MODES[0].id : '';
      if (!state.sort || (!S.tierSeen[state.sort.key] && ['time', 'cost', 'model'].indexOf(state.sort.key) === -1)) state.sort = { key: S.HEAD, dir: -1 };
    }

    // The hash holds the section, the suite and the compared setups: #agentic&suite=v2&compare=a,b
    function readHash() {
      var out = { mode: null, suite: null, compare: null };
      location.hash.replace(/^#/, '').split('&').forEach(function (part) {
        if (!part) return;
        var i = part.indexOf('=');
        if (i === -1) { out.mode = decodeURIComponent(part); return; }
        var k = part.slice(0, i), v = decodeURIComponent(part.slice(i + 1));
        if (k === 'suite') out.suite = v;
        else if (k === 'compare') out.compare = v ? v.split(',').filter(Boolean) : [];
      });
      return out;
    }
    function applyHash() {
      var h = readHash();
      if (h.mode) state.mode = h.mode;
      useSuite(h.suite && catalogById(h.suite) ? h.suite : state.suite);
      if (h.compare) state.compare = h.compare.slice(0, MAX_COMPARE);
    }
    function writeHash() {
      var parts = [encodeURIComponent(state.mode)];
      if (state.suite !== suiteId(CURRENT)) parts.push('suite=' + encodeURIComponent(state.suite));
      if (state.compare.length) parts.push('compare=' + state.compare.map(encodeURIComponent).join(','));
      var hash = '#' + parts.join('&');
      if (location.hash !== hash && history.replaceState) history.replaceState(null, '', hash);
    }

    function modeInfo() { return S.MODES.filter(function (m) { return m.id === state.mode; })[0] || { id: state.mode, label: '', blurb: '', harnesses: [], areas: [] }; }
    function tierById(id) { return S.TIERS.filter(function (t) { return t.id === id; })[0] || { id: id, label: cap(id), role: null }; }
    function tierLabel(id) { return tierById(id).label; }
    function tierRole(id) { return tierById(id).role || 'none'; }
    function gateOf(id) {
      var t = tierById(id), g = t.gate;
      return t.role === 'gate' && g && typeof g.mean === 'number' && typeof g.min === 'number' ? g : null;
    }
    function taskName(t) { return (t && t.name) || (t && t.id) || ''; }
    // Only tasks the suite makes active are shown; provisional runs stay in the data, unshown
    function inMode(t) { return t.mode === state.mode && t.status === 'active'; }

    // Tasks shown: this mode's active tasks, tier by tier, area order within a tier
    var tiers = [], orderedTasks = [], modeTaskIds = {};
    function selectMode() {
      var areas = modeInfo().areas.map(function (a) { return a.id; });
      tiers = S.TIERS.map(function (t) { return t.id; }).filter(function (tier) {
        return S.tasks.some(function (t) { return inMode(t) && t.tier === tier; });
      });
      orderedTasks = [];
      tiers.forEach(function (tier) {
        areas.forEach(function (area) {
          S.tasks.forEach(function (t) { if (inMode(t) && t.tier === tier && t.area === area) orderedTasks.push(t); });
        });
      });
      modeTaskIds = {};
      orderedTasks.forEach(function (t) { modeTaskIds[t.id] = true; });
      // A tier with no active task in this section has no column here
      MODE_TIERS = S.TIERS.filter(function (t) { return tiers.indexOf(t.id) !== -1; });
      if (!MODE_TIERS.length) MODE_TIERS = [S.HEADLINE];
      var keyOk = MODE_TIERS.some(function (t) { return t.id === state.sort.key; }) || ['time', 'tps', 'cost', 'model'].indexOf(state.sort.key) !== -1;
      if (!keyOk) state.sort = { key: modeHead().id, dir: -1 };
    }
    var MODE_TIERS = [];
    function modeHead() { return MODE_TIERS.filter(function (t) { return t.id === S.HEAD; })[0] || MODE_TIERS.filter(function (t) { return t.role !== 'gate'; })[0] || MODE_TIERS[0]; }
    function modeStretch() { return MODE_TIERS.filter(function (t) { return t.id !== S.HEAD && t.role !== 'gate'; }); }

    // Harnesses in this mode: only the catalog's. A run through any other harness never counts,
    // so it isn't offered as a filter; the model detail still lists the run as not counted
    function modeHarnesses() { return modeInfo().harnesses.slice(); }

    function cellOf(cfg, taskId) { return ((S.cells[cfg.key] || {})[taskId]) || null; }
    // A cell's value: the mean of its counted runs; for a provisional task, its runs' mean
    function cellValue(c) {
      if (!c) return null;
      if (c.counted.length) return { kind: 'counted', agg: agg(c.counted.map(function (i) { return i.score; })) };
      if (c.provisional.length) return { kind: 'provisional', agg: agg(c.provisional.map(function (i) { return i.score; })) };
      return { kind: 'uncounted', agg: null };
    }
    function countedMean(cfg, taskId) {
      var c = cellOf(cfg, taskId);
      return c && c.counted.length ? mean(c.counted.map(function (i) { return i.score; })) : null;
    }

    function modeConfigsAll() {
      return Object.keys(S.cells).map(function (k) { return CONFIGS[k]; }).filter(function (cfg) {
        return S.cfgModes[cfg.key] && S.cfgModes[cfg.key][state.mode];
      });
    }
    function hwValue(cfg) { return cfg.local ? cfg.hwKey || '-' : 'cloud'; }
    function passesFilters(cfg) {
      if (state.where !== 'all' && (state.where === 'local') !== cfg.local) return false;
      if (state.hw !== 'all' && hwValue(cfg) !== state.hw) return false;
      if (state.harness !== 'best' && cfg.harness !== state.harness) return false;
      return true;
    }

    // ---- Scores -----------------------------------------------------------

    // Each active task's share of its tier: the catalog's weight, else its category's weight split
    var weightCache = {};
    function taskWeights(tier) {
      var key = state.suite + ':' + state.mode + ':' + tier;
      if (weightCache[key]) return weightCache[key];
      var active = S.tasks.filter(function (t) { return inMode(t) && t.tier === tier && t.status === 'active'; });
      var perCategory = {};
      active.forEach(function (t) { perCategory[t.category] = (perCategory[t.category] || 0) + 1; });
      var weights = {}, sum = 0;
      active.forEach(function (t) {
        weights[t.id] = typeof t.weight === 'number' ? t.weight : (S.categoryWeights[t.category] || 0) / perCategory[t.category];
        sum += weights[t.id];
      });
      // A tier nothing weights yet counts its tasks equally rather than vanishing
      if (!sum && active.length) active.forEach(function (t) { weights[t.id] = 1 / active.length; });
      return (weightCache[key] = weights);
    }

    // Tier score: weighted mean of per-task means, rescaled over the scored tasks. Coverage is the
    // share of the tier's weight that was scored; below COVERAGE_MIN the score is partial.
    // `only` limits it to a set of tasks (the compare view's shared tasks).
    function tierScore(cfg, tier, only) {
      var weights = taskWeights(tier);
      var total = 0, scoredWeight = 0, allWeight = 0, scores = [], n = 0;
      Object.keys(weights).forEach(function (id) {
        if (only && !only[id]) return;
        allWeight += weights[id];
        n += 1;
        var score = countedMean(cfg, id);
        if (score === null) return;
        scores.push(score);
        total += score * weights[id];
        scoredWeight += weights[id];
      });
      var result = {
        score: scoredWeight ? total / scoredWeight : null,
        coverage: allWeight ? scoredWeight / allWeight : 0,
        scored: scores.length, total: n,
        min: scores.length ? Math.min.apply(null, scores) : null
      };
      result.partial = result.score !== null && !meets(result.coverage, S.COVERAGE_MIN);
      return result;
    }

    // Provisional tasks don't count, but are worth showing on their own
    function provisionalScore(cfg, tier) {
      var list = S.tasks.filter(function (t) { return inMode(t) && t.tier === tier && t.status === 'provisional'; });
      var scores = list.map(function (t) { var v = cellValue(cellOf(cfg, t.id)); return v && v.agg ? v.agg.mean : null; });
      return { score: mean(scores), scored: scores.filter(function (s) { return s !== null; }).length, total: list.length };
    }

    function gateVerdict(result, gate) {
      if (!result || result.score === null) return null;
      if (result.partial) return 'partial';
      return result.score >= gate.mean && result.min >= gate.min ? 'pass' : 'fail';
    }

    function countedRuns(cfg, only) {
      var out = [];
      Object.keys(S.cells[cfg.key] || {}).forEach(function (id) {
        if (!modeTaskIds[id] || (only && !only[id])) return;
        out = out.concat(S.cells[cfg.key][id].counted);
      });
      return out;
    }
    function timeOf(runs) { return median(runs.map(function (i) { return num(i.run.elapsed_s, null); })); }
    function costOf(cfg, runs) { return mean(runs.map(function (i) { return runCost(i.run); })); }

    var statsCache = {};
    function stats(cfg) {
      if (statsCache[cfg.key]) return statsCache[cfg.key];
      var runs = countedRuns(cfg);
      var active = orderedTasks.filter(function (t) { return t.status === 'active'; });
      var done = active.filter(function (t) { return countedMean(cfg, t.id) !== null; }).length;
      var progress = { done: done, total: active.length, share: active.length ? done / active.length : 0 };
      var tier = {}, verdict = {}, provisionalOf = {};
      S.TIERS.forEach(function (t) {
        var result = tierScore(cfg, t.id);
        if (t.id === S.HEAD || t.role === 'gate') tier[t.id] = result;
        else {
          tier[t.id] = result.total ? result : null;
          var prov = provisionalScore(cfg, t.id);
          provisionalOf[t.id] = prov.total ? prov : null;
        }
        if (gateOf(t.id)) verdict[t.id] = gateVerdict(result, gateOf(t.id));
      });
      var ran = Object.keys(S.cells[cfg.key] || {}).some(function (id) { return modeTaskIds[id]; });
      return (statsCache[cfg.key] = {
        cfg: cfg, local: cfg.local, ran: ran, tier: tier, verdict: verdict, provisional: provisionalOf,
        head: tier[S.HEAD], time: timeOf(runs), tps: tpsOf(runs), cost: costOf(cfg, runs), runs: runs.length,
        progress: progress, inProgress: !meets(progress.share, S.IN_PROGRESS_BELOW)
      });
    }

    // Best configuration: among setups whose headline tier meets the catalog's coverage_min, the
    // highest headline score; only when none does, the one with the most scored tasks. A near-empty
    // setup never beats a covered one. Never stitched per task: every number is one setup's.
    function betterConfig(a, b) {
      var ca = a.head.score !== null && meets(a.head.coverage, S.COVERAGE_MIN);
      var cb = b.head.score !== null && meets(b.head.coverage, S.COVERAGE_MIN);
      if (ca !== cb) return ca ? -1 : 1;
      if (ca) {
        if (a.head.score !== b.head.score) return b.head.score - a.head.score;
        if (a.progress.done !== b.progress.done) return b.progress.done - a.progress.done;
        return b.runs - a.runs;
      }
      if (a.progress.done !== b.progress.done) return b.progress.done - a.progress.done;
      var sa = a.head.score === null ? -1 : a.head.score, sb = b.head.score === null ? -1 : b.head.score;
      if (sa !== sb) return sb - sa;
      return b.runs - a.runs;
    }

    // One row per base model and reasoning level, across local and cloud
    function rowsAll() {
      var groups = {};
      modeConfigsAll().filter(passesFilters).forEach(function (cfg) {
        (groups[cfg.rowKey] = groups[cfg.rowKey] || []).push(stats(cfg));
      });
      // A model with no counted run in this suite and section isn't on the board at all
      return Object.keys(groups).filter(function (key) {
        return groups[key].some(function (v) { return v.runs > 0; });
      }).map(function (key) {
        var variants = groups[key].sort(betterConfig);
        var best = variants[0];
        return Object.assign({}, best, { rowKey: key, label: rowLabel(best.cfg), variants: variants });
      });
    }

    function tierValue(s, id) {
      var result = s.tier[id];
      if (result && result.score !== null) return result.score;
      return s.provisional[id] ? s.provisional[id].score : null;
    }
    function sortValue(key, s) {
      if (key === 'model') return (s.label || rowLabel(s.cfg)).toLowerCase();
      if (key === 'time') return s.time;
      if (key === 'tps') return s.tps ? s.tps.value : null;
      if (key === 'cost') return s.cost;
      return tierValue(s, key);
    }

    function noneFinished(rows) { return !rows.some(function (s) { return s.ran && !s.inProgress; }); }
    function showingInProgress(rows) { return state.showInProgress || noneFinished(rows); }

    function rankedRows() {
      var all = rowsAll();
      var showAll = showingInProgress(all);
      var list = all.filter(function (s) { return showAll || !s.inProgress; });
      var sort = state.sort;
      var tierKey = S.tierSeen[sort.key] === true;
      return list.sort(function (a, b) {
        if (a.ran !== b.ran) return a.ran ? -1 : 1;
        if (a.inProgress !== b.inProgress) return a.inProgress ? 1 : -1;
        if (tierKey) {
          var pa = !a.tier[sort.key] || a.tier[sort.key].partial || a.tier[sort.key].score === null;
          var pb = !b.tier[sort.key] || b.tier[sort.key].partial || b.tier[sort.key].score === null;
          if (pa !== pb) return pa ? 1 : -1;
        }
        var va = sortValue(sort.key, a), vb = sortValue(sort.key, b);
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (va < vb) return -sort.dir;
        if (va > vb) return sort.dir;
        return a.label < b.label ? -1 : 1;
      });
    }

    // ---- Layout -----------------------------------------------------------

    // One layout at a time, chosen here rather than by CSS so a stale stylesheet can't show both:
    // below 640 px every table is cards
    var narrowQuery = window.matchMedia ? window.matchMedia('(max-width: 639px)') : null;
    function isNarrow() { return !!(narrowQuery && narrowQuery.matches); }
    function applyLayout() {
      var narrow = isNarrow();
      ['crucible-lb', 'crucible-matrix', 'crucible-heatmap', 'crucible-tests', 'crucible-compare'].forEach(function (name) {
        var wide = document.querySelector('.' + name + '-wide'), box = document.getElementById(name + '-narrow');
        if (wide) wide.hidden = narrow;
        if (box) box.hidden = !narrow;
      });
    }

    // ---- Controls ---------------------------------------------------------

    function segmented(containerId, options, current, onPick) {
      var group = document.getElementById(containerId);
      group.innerHTML = '';
      options.forEach(function (opt) {
        var button = el('button', { type: 'button', role: 'radio', 'aria-checked': opt.value === current, class: 'crucible-segment' + (opt.empty ? ' is-empty' : '') }, opt.label);
        if (opt.empty) button.title = opt.emptyTitle || '';
        button.addEventListener('click', function () { onPick(opt.value); });
        group.appendChild(button);
      });
    }

    function fillSelect(select, options, current) {
      select.innerHTML = '';
      options.forEach(function (o) {
        var opt = el('option', { value: o.value }, o.label);
        if (o.value === current) opt.selected = true;
        select.appendChild(opt);
      });
    }

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

      var harnesses = modeHarnesses();
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
      var none = noneFinished(all);
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
      var stretch = modeStretch()[0];
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
      var stretch = modeStretch().filter(function (t) { return !gateOf(t.id); })[0];
      document.getElementById('detail-outline-note').textContent = stretch ? ' (a thick outline is ' + stretch.label + ')' : '';
    }

    // ---- Leaderboard -------------------------------------------------------

    // Every tier reads the same: a 0-10 score, the bar, and 'n/m tasks'. The gate result (pass or
    // fail) and 'partial' or 'provisional' are small markers on that cell, not a different cell.
    function tierCellContent(s, t, into) {
      var result = s.tier[t.id], prov = s.provisional[t.id];
      var counted = result && result.score !== null;
      var score = counted ? result.score : prov && prov.score !== null ? prov.score : null;
      if (score === null) { into.appendChild(el('span', { class: 'crucible-lb-none' }, NONE)); return; }
      var partial = counted && result.partial;
      var provisional = !counted;
      var scored = counted ? result.scored : prov.scored, total = counted ? result.total : prov.total;
      var cellEl = el('span', { class: 'crucible-tier-cell' + (provisional ? ' is-provisional' : '') });
      var bar = el('span', { class: 'crucible-lb-bar' + (partial ? ' is-partial' : '') + (provisional ? ' is-provisional' : '') });
      var fill = el('span', { class: 'crucible-lb-fill' + (s.local ? ' is-local' : '') });
      fill.style.width = (score * 10) + '%';
      bar.appendChild(fill);
      cellEl.appendChild(bar);
      cellEl.appendChild(el('span', { class: 'crucible-lb-score' }, fmtScore(score)));
      cellEl.appendChild(el('span', { class: 'crucible-lb-count' }, scored + '/' + total + ' tasks'));
      var markers = el('span', { class: 'crucible-lb-markers' });
      var verdict = s.verdict[t.id];
      if (verdict === 'pass' || verdict === 'fail') {
        markers.appendChild(el('span', { class: 'crucible-verdict is-' + verdict, title: t.label + ' gate: ' + verdict }, verdict === 'pass' ? '✓ pass' : '✕ fail'));
      }
      if (partial) markers.appendChild(el('span', { class: 'crucible-lb-note', title: 'Fewer than ' + pct(S.COVERAGE_MIN) + ' of this tier\'s tasks were scored' }, 'partial'));
      else if (provisional) markers.appendChild(el('span', { class: 'crucible-lb-note', title: 'Provisional tasks don\'t count toward rankings' }, 'provisional'));
      if (markers.firstChild) cellEl.appendChild(markers);
      into.appendChild(cellEl);
    }

    function rankLabel(s, rank) {
      return s.ran && !s.inProgress && s.head.score !== null && !s.head.partial ? String(rank) : '';
    }
    function costLabel(s) { return fmtCost(s.cost, s.local); }
    function costTitle(s) {
      if (!s.local) return 'Average API cost per counted run';
      var w = wattsOf(s.cfg.hwKey);
      return w ? 'Estimated electricity per counted run: ' + w + ' W at $' + num(ENERGY.usd_per_kwh, 0) + '/kWh for the run\'s time. Not the hardware\'s cost.'
        : 'Local runs aren\'t billed, and this hardware has no power figure';
    }

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
        MODE_TIERS.forEach(function (t) {
          var td = el('td', { class: 'crucible-lb-bar-cell' });
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
      MODE_TIERS.map(function (t) { return [t.id, t.label]; }).concat([['time', 'Time / task'], ['tps', 'Decode speed'], ['cost', 'Cost / task'], ['model', 'Model']]).forEach(function (o) {
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

    // ---- Runs: score detail, checks and output, loaded on demand ---------

    var detailsPromise = null;
    function loadDetails() {
      if (!detailsPromise) {
        detailsPromise = fetch(script.getAttribute('data-details')).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (payload) {
          var index = {};
          (function walk(node) {
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (!node || typeof node !== 'object') return;
            if (node.record === 'score') { index[scoreKey(node.run_uuid, node.rubric_version, node.method)] = node; return; }
            Object.keys(node).forEach(function (k) { walk(node[k]); });
          })(payload);
          return index;
        });
        detailsPromise.catch(function () { detailsPromise = null; });
      }
      return detailsPromise;
    }

    var STATE_TEXT = {
      counted: 'counts in this suite',
      provisional: 'provisional task: shown, not in tier scores',
      older: 'from an older version of this task: doesn\'t count in this suite',
      invalid: 'marked invalid: never counts',
      harness: 'a harness this suite doesn\'t score for this section: doesn\'t count'
    };

    function promptBlock(t, into) {
      into.appendChild(el('p', { class: 'crucible-detail-prompt' }, t.summary || taskName(t)));
      if (!t.prompt || t.prompt === t.summary) return;
      var details = el('details', { class: 'crucible-output crucible-prompt-full' });
      details.appendChild(el('summary', {}, 'Full prompt'));
      details.appendChild(el('pre', {}, t.prompt));
      into.appendChild(details);
    }

    function scoreSentence(info) {
      var rec = info.rec, t = info.task;
      if (!rec) return 'Not scored at rubric version ' + (t.rubric_version === undefined ? '?' : t.rubric_version) + '.';
      var raw = rec.raw || {};
      var unit = raw.unit || (t.scoring && t.scoring.unit) || '';
      var amount = function (v) { return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : fmtInt(v); };
      var text = raw.total ? amount(raw.passed) + ' of ' + amount(raw.total) + ' ' + unit + (unit === 'tests' ? ' passed' : '') + ' → ' + fmtScore(rec.score)
        : 'Score ' + fmtScore(rec.score);
      if (typeof rec.capped_at === 'number') text += ' (capped at ' + fmtScore(rec.capped_at) + ')';
      var methodLabel = (FB_METHODS[rec.method] || {}).label || rec.method;
      return text + ', by ' + methodLabel + ' (rubric version ' + rec.rubric_version + ').';
    }

    function renderItems(full, into) {
      into.innerHTML = '';
      if (!full) { into.appendChild(el('p', { class: 'crucible-detail-meta' }, 'No per-check results published for this score.')); return; }
      var items = full.items || [];
      var ul = el('ul', { class: 'crucible-checks' });
      if (items.length) {
        var lastGroup = null;
        items.forEach(function (it) {
          if (it.group && it.group !== lastGroup) { ul.appendChild(el('li', { class: 'crucible-check-group' }, it.group)); lastGroup = it.group; }
          var li = el('li', { class: it.passed ? 'is-pass' : 'is-fail' });
          li.appendChild(el('span', { class: 'crucible-check-mark', 'aria-label': it.passed ? 'passed' : 'failed' }, it.passed ? '✓' : '✕'));
          li.appendChild(el('span', {}, (it.label || it.id || '') + ' '));
          if (it.detail) li.appendChild(el('span', { class: 'crucible-check-detail' }, '(' + it.detail + ')'));
          ul.appendChild(li);
        });
      } else {
        (full.groups || []).forEach(function (g) {
          var all = g.passed === g.total;
          var li = el('li', { class: all ? 'is-pass' : g.passed ? 'is-partial' : 'is-fail' });
          li.appendChild(el('span', { class: 'crucible-check-mark' }, fmtInt(g.passed) + '/' + fmtInt(g.total)));
          li.appendChild(el('span', {}, ' ' + (g.id || '') + (g.detail ? ' (' + g.detail + ')' : '')));
          ul.appendChild(li);
        });
      }
      if (!ul.firstChild) { into.appendChild(el('p', { class: 'crucible-detail-meta' }, 'No per-check results published for this score.')); return; }
      into.appendChild(el('p', { class: 'crucible-detail-label' }, 'Checks and tests'));
      into.appendChild(ul);
    }

    function runBody(info, into) {
      var r = info.run, met = r.metrics || {}, out = r.outcome || {};
      into.appendChild(el('p', {}, scoreSentence(info)));
      var flag = STATE_TEXT[info.state] || info.state;
      var reason = info.state === 'invalid' ? invalidReason(info.uuid, r) : null;
      into.appendChild(el('p', { class: 'crucible-detail-meta' }, cap(flag) + (reason ? ': ' + reason : '') + '.'));
      var checks = into.appendChild(el('div', { class: 'crucible-run-checks' }));
      if (info.rec) {
        checks.appendChild(el('p', { class: 'crucible-detail-meta' }, 'Loading checks…'));
        loadDetails().then(function (index) {
          renderItems(index[scoreKey(info.uuid, info.rec.rubric_version, info.rec.method)], checks);
        }, function () { checks.innerHTML = ''; checks.appendChild(el('p', { class: 'crucible-detail-meta' }, 'Couldn’t load the checks.')); });
      }
      if (met.reasoning_chars) {
        into.appendChild(el('p', { class: 'crucible-detail-meta' }, 'Reasoned for ' + met.reasoning_chars.toLocaleString() + ' characters before answering.'));
      }
      if (r.output_ref) {
        var details = el('details', { class: 'crucible-output' });
        details.appendChild(el('summary', {}, 'Model output'));
        var pre = details.appendChild(el('pre', {}, 'Loading…'));
        var loaded = false;
        details.addEventListener('toggle', function () {
          if (!details.open || loaded) return;
          loaded = true;
          fetch((script.getAttribute('data-outputs') || '/crucible-data/') + r.output_ref).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
          }).then(function (text) { pre.textContent = text || '(empty)'; }, function () { loaded = false; pre.textContent = 'Couldn’t load the output.'; });
        });
        into.appendChild(details);
      }
      into.appendChild(el('p', { class: 'crucible-detail-meta' }, [
        'ran ' + fmtDate(r.started_at), (out.status || NONE).replace(/_/g, ' ') + (out.timed_out ? ' (timed out)' : ''),
        'time ' + fmtSeconds(num(r.elapsed_s, null)), runTps(r) !== null ? 'decode ' + fmtTps(runTps(r)) : 'decode speed not recorded', met.tool_calls !== null && met.tool_calls !== undefined ? 'tool calls ' + fmtInt(met.tool_calls) : null,
        'tokens in ' + fmtInt(met.tokens_in), 'out ' + fmtInt(met.tokens_out),
        (info.cfg.local ? 'electricity ' : 'cost ') + fmtCost(runCost(r), info.cfg.local),
        r.endpoint && r.endpoint.upstream && (r.endpoint.upstream.name || r.endpoint.upstream.provider) ? 'routed to ' + (r.endpoint.upstream.name || r.endpoint.upstream.provider) : null,
        'task v' + ((r.task || {}).version === null || (r.task || {}).version === undefined ? '?' : r.task.version),
        r.provenance && r.provenance.crucible_version ? 'Crucible ' + r.provenance.crucible_version : null,
        'run ' + info.uuid.slice(0, 8)
      ].filter(Boolean).join(' · ')));
    }

    // Every run behind one cell, newest first; open one for its score, checks and output
    function runList(c, into) {
      if (!c || !c.all.length) { into.appendChild(el('p', {}, 'Not run with this setup.')); return; }
      var value = cellValue(c);
      if (value.agg) {
        into.appendChild(el('p', {}, (value.kind === 'provisional' ? 'Provisional: ' : 'Score ') + fmtScore(value.agg.mean) +
          (value.agg.n > 1 ? ', the mean of ' + fmtRepeat(value.agg) : ' (1 run)') + '.'));
      } else {
        into.appendChild(el('p', {}, 'No run of this setup counts in this suite.'));
      }
      var ul = into.appendChild(el('ul', { class: 'crucible-runs' }));
      c.all.forEach(function (info, i) {
        var li = ul.appendChild(el('li', { class: 'crucible-run is-' + info.state }));
        var details = li.appendChild(el('details'));
        var summary = details.appendChild(el('summary'));
        summary.appendChild(el('span', { class: 'crucible-run-score' }, fmtScore(info.score)));
        summary.appendChild(document.createTextNode(' ' + fmtDate(info.run.started_at) + ' · ' + fmtSeconds(num(info.run.elapsed_s, null))));
        if (info.state !== 'counted') summary.appendChild(el('span', { class: 'crucible-flag' }, info.state === 'provisional' ? 'provisional' : info.state === 'older' ? 'older task version' : info.state === 'invalid' ? 'invalid' : 'not counted'));
        var body = details.appendChild(el('div', { class: 'crucible-run-body' }));
        var filled = false;
        details.addEventListener('toggle', function () {
          if (!details.open || filled) return;
          filled = true;
          runBody(info, body);
        });
        if (i === 0) details.open = true;
      });
    }

    function showCellDetail(s, t, c) {
      var panel = document.getElementById('crucible-cell-detail');
      panel.innerHTML = '';
      var title = panel.appendChild(el('p', { class: 'crucible-tooltip-title' }, s.label + ' · ' + taskName(t) + ' · ' + tierLabel(t.tier) +
        (t.status === 'provisional' ? ' (provisional)' : '')));
      title.appendChild(el('small', { class: 'crucible-task-id' }, ' ' + configLabel(s.cfg)));
      promptBlock(t, panel);
      runList(c, panel);
      panel.hidden = false;
    }

    // ---- Matrix -----------------------------------------------------------

    function matrixButton(s, t, c, narrowCell) {
      var value = cellValue(c);
      var a = value && value.agg;
      var text = a ? (narrowCell ? fmtScore(a.mean) : Math.round(a.mean).toString()) : NONE;
      var b = el('button', { type: 'button', class: narrowCell ? 'crucible-card-score' : '',
        'aria-label': s.label + ' ' + taskName(t) + ': ' + (a ? fmtScore(a.mean) + ', ' + fmtRepeat(a) : 'doesn\'t count in this suite') });
      b.textContent = text;
      b.title = a ? fmtScore(a.mean) + ' · ' + fmtRepeat(a) : (STATE_TEXT[c.all[0].state] || '');
      if (a) b.setAttribute('style', heatStyle(a.mean));
      else b.classList.add('is-uncounted');
      if (a && a.n > 1) b.appendChild(el('sup', { class: 'crucible-repeat-n' }, '×' + a.n));
      if (c.all.some(function (i) { return i.run.outcome && i.run.outcome.timed_out; })) b.classList.add('is-timeout');
      return b;
    }

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

    function modelCard(s, ul) {
      var li = ul.appendChild(el('li', { class: 'crucible-card' }));
      var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
      title.appendChild(nameNode(s.label));
      title.appendChild(whereTag(s.cfg));
      li.appendChild(el('p', { class: 'crucible-config-line' }, configLabel(s.cfg)));
      return li;
    }

    function kvRow(parent, label, value, extraClass) {
      var row = parent.appendChild(el('div', { class: 'crucible-kv' + (extraClass ? ' ' + extraClass : '') }));
      row.appendChild(typeof label === 'string' ? el('span', { class: 'crucible-kv-label' }, label) : label);
      row.appendChild(typeof value === 'string' ? el('span', { class: 'crucible-kv-value' }, value) : value);
      return row;
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

    function areaResult(cfg, area) {
      var list = orderedTasks.filter(function (t) { return t.area === area.id; });
      var means = list.map(function (t) { return countedMean(cfg, t.id); }).filter(function (v) { return v !== null; });
      return { tasks: list, n: means.length, score: mean(means) };
    }

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
            areaCellInto(holder, areaResult(s.cfg, area));
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
          areaCellInto(td, areaResult(s.cfg, area));
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

    function cellNumbers(c) {
      var counted = c ? c.counted : [];
      var shown = c ? (c.counted.length ? c.counted : c.provisional.length ? c.provisional : c.all) : [];
      var met = function (f) { return shown.map(function (i) { return num((i.run.metrics || {})[f], null); }); };
      return {
        value: cellValue(c), time: median(shown.map(function (i) { return num(i.run.elapsed_s, null); })),
        tools: median(met('tool_calls')), tokens: median(met('tokens_out')), tps: tpsOf(shown), cost: mean(shown.map(function (i) { return runCost(i.run); })),
        timedOut: shown.some(function (i) { return i.run.outcome && i.run.outcome.timed_out; }), runs: c ? c.all.length : 0, counted: counted.length
      };
    }

    function modeHasToolCalls() {
      return modeConfigsAll().some(function (cfg) {
        return Object.keys(S.cells[cfg.key] || {}).some(function (id) {
          return modeTaskIds[id] && S.cells[cfg.key][id].all.some(function (i) { var v = (i.run.metrics || {}).tool_calls; return v !== null && v !== undefined; });
        });
      });
    }

    function scoreBar(value, into) {
      var a = value && value.agg;
      into.appendChild(el('span', { class: 'crucible-score-num' }, a ? fmtScore(a.mean) : NONE));
      var bar = into.appendChild(el('span', { class: 'crucible-bar' + (value && value.kind === 'counted' ? '' : ' is-uncounted') }));
      var fill = bar.appendChild(el('span', { class: 'crucible-bar-fill' }));
      fill.style.width = (a ? a.mean * 10 : 0) + '%';
      if (a) into.appendChild(el('span', { class: 'crucible-repeat' }, fmtRepeat(a)));
    }

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
      row.appendChild(el('td', { title: tpsTitle(n.tps) }, fmtTps(n.tps.value)));
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
        var sq = el('span', { class: 'crucible-area-sq is-role-' + tierRole(t.tier) + (v ? '' : ' is-empty'), title: taskName(t) + ' · ' + tierLabel(t.tier) + ' · ' + (v ? fmtScore(score) : 'not run') });
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
      kvRow(li, 'Decode speed', fmtTps(n.tps.value));
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

    // Decode speed of one model (at one reasoning level) on each machine it ran on in this section:
    // the median over its counted runs there that recorded it. Every setup of the model counts here,
    // whatever the filters, since the same weights decode at different speeds on different hardware.
    function renderSpeed(target) {
      var box = document.getElementById('crucible-speed');
      if (!box) return;
      box.innerHTML = '';
      box.hidden = !target;
      if (!target) return;
      var groups = {}, order = [];
      modeConfigsAll().filter(function (cfg) { return cfg.rowKey === target.row.rowKey; }).forEach(function (cfg) {
        var key = cfg.local ? 'local|' + (cfg.hwKey || cfg.where) : 'cloud|' + (cfg.provider || cfg.where);
        var g = groups[key];
        if (!g) { g = groups[key] = { key: key, label: cfg.local ? hardwareText(cfg) : 'cloud via ' + (cfg.provider || cfg.where), cfg: cfg, runs: [], setups: [], current: false }; order.push(key); }
        g.runs = g.runs.concat(countedRuns(cfg));
        var setup = (cfg.local ? [cfg.quant || 'quant not recorded', cfg.harness] : [cfg.harness]).join(' · ');
        if (g.setups.indexOf(setup) === -1) g.setups.push(setup);
        if (cfg.key === target.s.cfg.key) g.current = true;
      });
      var list = order.map(function (k) { var g = groups[k]; g.tps = tpsOf(g.runs); return g; }).filter(function (g) { return g.runs.length; });
      list.sort(function (a, b) {
        if ((a.tps.value === null) !== (b.tps.value === null)) return a.tps.value === null ? 1 : -1;
        return (b.tps.value || 0) - (a.tps.value || 0) || (a.label < b.label ? -1 : 1);
      });
      var head = box.appendChild(el('p', { class: 'crucible-speed-title' }));
      head.appendChild(el('strong', {}, 'Decode speed'));
      head.appendChild(document.createTextNode(' by hardware: output tokens per second of generation, prompt processing excluded; the median of ' +
        target.s.label + '\'s counted runs in this section that recorded it.'));
      var max = Math.max.apply(null, [0].concat(list.map(function (g) { return g.tps.value || 0; })));
      if (!max) {
        box.appendChild(el('p', { class: 'crucible-detail-meta' }, NONE + ' (not recorded for ' + (list.length === 1 ? 'this model\'s runs' : 'any of this model\'s runs') + ' yet)'));
        return;
      }
      var ul = box.appendChild(el('ul', { class: 'crucible-speed-list' }));
      list.forEach(function (g) {
        var li = ul.appendChild(el('li', { class: 'crucible-speed-row' + (g.current ? ' is-current' : ''), title: tpsTitle(g.tps, g.runs.length) }));
        var name = li.appendChild(el('span', { class: 'crucible-speed-name' }));
        name.appendChild(el('span', { class: 'crucible-speed-hw' }, g.label));
        name.appendChild(whereTag(g.cfg));
        name.appendChild(el('span', { class: 'crucible-config-n crucible-speed-setups' }, g.setups.join(', ')));
        var bar = li.appendChild(el('span', { class: 'crucible-bar crucible-speed-bar' }));
        var fill = bar.appendChild(el('span', { class: 'crucible-bar-fill' }));
        fill.style.width = (g.tps.value ? Math.max(2, g.tps.value / max * 100) : 0) + '%';
        var value = li.appendChild(el('span', { class: 'crucible-speed-value' }));
        value.appendChild(el('span', { class: 'crucible-score-num' }, fmtTps(g.tps.value)));
        value.appendChild(el('span', { class: 'crucible-repeat' }, g.tps.n + ' of ' + g.runs.length + ' run' + (g.runs.length === 1 ? '' : 's')));
      });
    }

    var currentTarget = null;
    function renderTasks(target) {
      currentTarget = target;
      var table = document.getElementById('crucible-tests');
      table.innerHTML = '';
      document.getElementById('crucible-tests-narrow').innerHTML = '';
      renderOtherRuns(target);
      renderSpeed(target);
      if (!target) return;
      var s = target.s;
      var toolCalls = modeHasToolCalls();
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
      var columns = ['Task', 'Score (mean)', 'Time'].concat(toolCalls ? ['Tool calls'] : [], ['Tokens out', 'Decode speed', 'Cost', 'Runs']);
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

    function compareCandidates() {
      return modeConfigsAll().map(stats).filter(function (s) { return s.ran; }).sort(function (a, b) {
        var la = rowLabel(a.cfg), lb = rowLabel(b.cfg);
        if (la !== lb) return la < lb ? -1 : 1;
        return betterConfig(a, b);
      });
    }

    // Two to four setups side by side on the tasks all of them have counted runs of. Tier scores
    // are recomputed over those shared tasks only; each keeps its own local/cloud tag, cost and time.
    function renderCompare() {
      var candidates = compareCandidates();
      var bySlug = {};
      candidates.forEach(function (s) { bySlug[s.cfg.slug] = s; });
      var chosen = state.compare.map(function (slug) { return bySlug[slug]; }).filter(Boolean)
        .map(function (s) { return Object.assign({}, s, { label: rowLabel(s.cfg) }); });

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
      var shared = {}, sharedTasks = orderedTasks.filter(function (t) {
        return t.status === 'active' && chosen.every(function (s) { return countedMean(s.cfg, t.id) !== null; });
      });
      sharedTasks.forEach(function (t) { shared[t.id] = true; });
      sub.textContent = sharedTasks.length
        ? sharedTasks.length + ' scored task' + (sharedTasks.length === 1 ? '' : 's') + (chosen.length === 2 ? ' both setups ran in ' : ' all ' + chosen.length + ' setups ran in ') + suiteName(S.cat) +
          '. Tier scores below use only these, so no setup gains from a task another skipped. Scores are the mean of repeat runs (n and range under each).'
        : 'These setups have no scored task in common in ' + suiteName(S.cat) + ' yet.';
      if (!sharedTasks.length) return;

      var tierRowsData = S.TIERS.map(function (t) {
        var any = sharedTasks.some(function (x) { return x.tier === t.id; });
        return any ? { tier: t, scores: chosen.map(function (s) { return tierScore(s.cfg, t.id, shared); }) } : null;
      }).filter(Boolean);
      var extra = chosen.map(function (s) {
        var runs = countedRuns(s.cfg, shared);
        return { time: timeOf(runs), tps: tpsOf(runs), cost: costOf(s.cfg, runs) };
      });
      function taskCell(s, t) {
        var c = cellOf(s.cfg, t.id), a = agg(c.counted.map(function (i) { return i.score; }));
        return a;
      }
      function best(values) {
        var nums = values.filter(function (v) { return v !== null && v !== undefined; });
        return nums.length > 1 ? Math.max.apply(null, nums) : null;
      }

      if (isNarrow()) {
        var ul = box.appendChild(el('ul', { class: 'crucible-cards' }));
        chosen.forEach(function (s, k) {
          var li = modelCard(s, ul);
          tierRowsData.forEach(function (r) { kvRow(li, r.tier.label + ' (shared)', fmtScore(r.scores[k].score)); });
          kvRow(li, 'Time / task', fmtSeconds(extra[k].time));
          kvRow(li, 'Decode speed', fmtTps(extra[k].tps.value));
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
      numRow('Decode speed (median)', extra.map(function (x) {
        var td = el('td', { class: 'crucible-compare-num', title: tpsTitle(x.tps) }, fmtTps(x.tps.value));
        if (x.tps.n) td.appendChild(el('span', { class: 'crucible-repeat' }, ' ' + x.tps.n + ' run' + (x.tps.n === 1 ? '' : 's')));
        return td;
      }), 'crucible-compare-tier');
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
        'Decode speed is output tokens (reasoning included) per second of generation, leaving out prompt processing: the median over the runs that recorded it (' + NONE + ' when none did). ' +
        'Token counts aren\'t comparable across harnesses. Time, decode speed and cost are each setup\'s own: local ones depend on the hardware named.';
    }

    // ---- Render -----------------------------------------------------------

    function render() {
      statsCache = {};
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
      resizeTimer = setTimeout(function () { relayout(); renderScatter(currentList); }, 150);
    });

    state.mode = '';
    useSuite(state.suite);
    applyHash();
    resultsEl.hidden = false;
    render();
    showStatus(skippedNote);
  }

  load();
})();
