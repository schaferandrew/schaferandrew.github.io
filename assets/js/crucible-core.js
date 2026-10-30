// Crucible core: what every Crucible page shares, as window.CrucibleCore. Loading the records,
// suite selection, the record join and counting rules, leaderboard rows, formatting, the run detail
// panel, compare numbers, a hash router and links between the pages. No page-specific layout here.
// The page reads bundle format 3: one catalog per suite (what a suite is) plus run, score and status
// records (what happened), joined here. Everything shown comes from those records: modes, areas,
// tiers, thresholds and their text come from the selected suite's catalog. FALLBACKS
// (_data/crucible_fallbacks.yml) only fill a label a catalog doesn't carry, and anything the page
// doesn't recognize renders generically instead of throwing.
(function () {
  var C = window.CrucibleCore = {};
  var SUPPORTED_FORMAT = 3; // a record or catalog with a higher format_version is skipped, with a notice
  var NONE = '—';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  C.SUPPORTED_FORMAT = SUPPORTED_FORMAT;
  C.NONE = NONE;
  // Two identities on the scatter: local (the point of Crucible) and cloud (the reference)
  C.COLORS = { local: '#2a78d6', cloud: '#eb6834' };
  C.MAX_COMPARE = 4;
  C.BASE = '/crucible/';

  // ---- Small helpers -----------------------------------------------------

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
  // The highest of two or more numbers; null when there's nothing to beat
  function bestOf(values) {
    var nums = values.filter(function (v) { return v !== null && v !== undefined; });
    return nums.length > 1 ? Math.max.apply(null, nums) : null;
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
    if (v < 0.0001) return '<$0.0001';
    return '$' + (v < 0.01 ? v.toPrecision(2) : v.toFixed(v < 1 ? 3 : 2));
  }
  // A local cost is an electricity estimate, marked as such; a cloud cost is what the provider billed
  function fmtCost(v, local) { return (local && v !== null && v !== undefined ? '≈' : '') + fmtUsd(v); }
  function fmtInt(v) { return v === null || v === undefined ? NONE : v.toLocaleString(); }
  function fmtDate(v) { return v ? String(v).slice(0, 10) : NONE; }
  function fmtRepeat(a) {
    if (!a) return NONE;
    if (a.n === 1) return '1 run';
    return a.n + ' runs, ' + (a.min === a.max ? 'all ' + fmtScore(a.min) : fmtScore(a.min) + '–' + fmtScore(a.max));
  }

  // Sequential scale: light to the site's secondary blue. Text flips to white on the dark half.
  function heatStyle(score) {
    if (score === null || score === undefined) return '';
    var t = Math.max(0, Math.min(1, score / 10));
    var light = [234, 242, 251], dark = [24, 86, 163];
    var rgb = light.map(function (c, i) { return Math.round(c + (dark[i] - c) * t); });
    return 'background:rgb(' + rgb.join(',') + ');color:' + (t > 0.55 ? '#fff' : '#2b2537');
  }

  function shortName(base) { var parts = String(base).split('/'); return parts[parts.length - 1]; }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, ''); }
  function taskName(t) { return (t && t.name) || (t && t.id) || ''; }
  function suiteId(c) { return String(c.suite.id || c.suite.version); }
  function suiteName(c) { var id = suiteId(c); return 'Suite ' + (/^v/i.test(id) ? id : 'v' + id); }

  // A model base's maker is the part before its '/', with a leading '~' (a provider's "latest"
  // alias) dropped; null when there is none. The model registry, when published, wins over this.
  function makerFromBase(base) {
    var b = String(base || '').replace(/^~/, ''), i = b.indexOf('/');
    return i > 0 ? b.slice(0, i) : null;
  }
  // The model's own name, without its maker prefix: "qwen/qwen3.5-9b" -> "qwen3.5-9b"
  function modelName(base) {
    var b = String(base || '').replace(/^~/, ''), i = b.indexOf('/');
    return i === -1 ? b : b.slice(i + 1);
  }

  [['num', num], ['cap', cap], ['ids', ids], ['meets', meets], ['pct', pct], ['scoreKey', scoreKey], ['mean', mean],
    ['median', median], ['agg', agg], ['bestOf', bestOf], ['fmtScore', fmtScore], ['fmtSeconds', fmtSeconds],
    ['fmtUsd', fmtUsd], ['fmtCost', fmtCost], ['fmtInt', fmtInt], ['fmtDate', fmtDate], ['fmtRepeat', fmtRepeat],
    ['heatStyle', heatStyle], ['shortName', shortName], ['slugify', slugify], ['taskName', taskName],
    ['suiteId', suiteId], ['suiteName', suiteName], ['makerFromBase', makerFromBase], ['modelName', modelName]
  ].forEach(function (p) { C[p[0]] = p[1]; });

  // ---- DOM helpers --------------------------------------------------------

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
  function segmented(containerId, options, current, onPick) {
    var group = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
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
  function kvRow(parent, label, value, extraClass) {
    var row = parent.appendChild(el('div', { class: 'crucible-kv' + (extraClass ? ' ' + extraClass : '') }));
    row.appendChild(typeof label === 'string' ? el('span', { class: 'crucible-kv-label' }, label) : label);
    row.appendChild(typeof value === 'string' ? el('span', { class: 'crucible-kv-value' }, value) : value);
    return row;
  }
  // A cell's mean as a number, a bar and its repeats
  function scoreBar(value, into) {
    var a = value && value.agg;
    into.appendChild(el('span', { class: 'crucible-score-num' }, a ? fmtScore(a.mean) : NONE));
    var bar = into.appendChild(el('span', { class: 'crucible-bar' + (value && value.kind === 'counted' ? '' : ' is-uncounted') }));
    var fill = bar.appendChild(el('span', { class: 'crucible-bar-fill' }));
    fill.style.width = (a ? a.mean * 10 : 0) + '%';
    if (a) into.appendChild(el('span', { class: 'crucible-repeat' }, fmtRepeat(a)));
  }

  // One layout at a time, chosen here rather than by CSS so a stale stylesheet can't show both:
  // below 640 px every table is cards. `names` are prefixes of a .<name>-wide box and a #<name>-narrow one.
  var narrowQuery = window.matchMedia ? window.matchMedia('(max-width: 639px)') : null;
  function isNarrow() { return !!(narrowQuery && narrowQuery.matches); }
  function applyLayout(names) {
    var narrow = isNarrow();
    names.forEach(function (name) {
      var wide = document.querySelector('.' + name + '-wide'), box = document.getElementById(name + '-narrow');
      if (wide) wide.hidden = narrow;
      if (box) box.hidden = !narrow;
    });
  }
  // Calls fn when the layout crosses 640 px (not on every resize)
  function onLayoutChange(fn) {
    var shown = isNarrow();
    function relayout() {
      if (isNarrow() === shown) return;
      shown = isNarrow();
      fn();
    }
    if (narrowQuery) {
      if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', relayout);
      else if (narrowQuery.addListener) narrowQuery.addListener(relayout);
    }
    return relayout;
  }

  [['el', el], ['svg', svg], ['nameNode', nameNode], ['whereTag', whereTag], ['segmented', segmented],
    ['fillSelect', fillSelect], ['kvRow', kvRow], ['scoreBar', scoreBar], ['isNarrow', isNarrow],
    ['applyLayout', applyLayout], ['onLayoutChange', onLayoutChange]
  ].forEach(function (p) { C[p[0]] = p[1]; });
  C.narrowQuery = narrowQuery;

  // ---- Router and links -------------------------------------------------

  // '#<id>&key=value&…': the part with no '=' is the page's id (a mode, a task id, maker/model,
  // a list of setup slugs); the rest are parameters, e.g. suite=v2
  function parseHash(hash) {
    var out = { id: null, params: {} };
    String(hash === undefined ? location.hash : hash).replace(/^#/, '').split('&').forEach(function (part) {
      if (!part) return;
      var i = part.indexOf('=');
      if (i === -1) { out.id = decodeURIComponent(part); return; }
      out.params[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
    });
    return out;
  }
  // An id is encoded segment by segment, so maker/model and slug lists keep their '/' and ','
  function encodeId(id) {
    return String(id).split('/').map(function (seg) { return seg.split(',').map(encodeURIComponent).join(','); }).join('/');
  }
  function buildHash(id, params) {
    var parts = [];
    if (id !== null && id !== undefined && id !== '') parts.push(encodeId(id));
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === '') return;
      parts.push(k + '=' + encodeURIComponent(v));
    });
    return '#' + parts.join('&');
  }
  // Calls fn(route) now and on every hash change
  function onRoute(fn) {
    window.addEventListener('hashchange', function () { fn(parseHash()); });
    fn(parseHash());
  }
  // Links to the other pages keep the suite the reader is looking at (no param means the current one)
  function suiteParam(suite) { return suite !== undefined ? suite : parseHash().params.suite || null; }
  function pageUrl(page, id, suite) { return C.BASE + page + '/' + buildHash(id, { suite: suiteParam(suite) }); }
  function taskUrl(id, suite) { return pageUrl('task', id, suite); }
  function modelUrl(maker, base, suite) { return pageUrl('model', (maker ? maker + '/' : '') + modelName(base), suite); }
  function compareUrl(slugs, suite) { return pageUrl('compare', slugs.join(','), suite); }
  function publisherUrl(maker, suite) { return pageUrl('publisher', maker, suite); }

  [['parseHash', parseHash], ['buildHash', buildHash], ['onRoute', onRoute], ['taskUrl', taskUrl],
    ['modelUrl', modelUrl], ['compareUrl', compareUrl], ['publisherUrl', publisherUrl]
  ].forEach(function (p) { C[p[0]] = p[1]; });

  // ---- Records ------------------------------------------------------------

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
  C.collect = collect;

  // The model registry, when the bundle carries one (payload.models): maker id and label per model
  // base. Read tolerantly: any object with a `maker` (an id, or { id, label }) under a `base` field
  // or a base-named key, and makers as { id: label } or { id: { label } } under a `makers` key.
  function readModels(node) {
    var models = {}, makers = {};
    function makerLabel(id, v) {
      var label = typeof v === 'string' ? v : v && (v.label || v.name);
      if (id && label && !makers[id]) makers[id] = String(label);
    }
    (function walk(n, key, parentKey) {
      if (Array.isArray(n)) { n.forEach(function (x) { walk(x, null, key); }); return; }
      if (!n || typeof n !== 'object' || newer(n)) return;
      if (parentKey === 'makers' || n.record === 'maker') {
        makerLabel(n.id || key, n.label ? n : n.name ? n : null);
        if (n.id || key) return;
      }
      if (n.maker !== undefined && n.maker !== null) {
        var base = typeof n.base === 'string' ? n.base : key;
        var mk = n.maker, id = typeof mk === 'string' ? mk : mk && mk.id;
        if (base && id) {
          models[base] = { maker: String(id), label: n.label || n.name || null };
          makerLabel(String(id), typeof mk === 'object' ? mk : n.maker_label);
        }
        return;
      }
      Object.keys(n).forEach(function (k) {
        if (k === 'makers' && n[k] && typeof n[k] === 'object' && !Array.isArray(n[k])) {
          Object.keys(n[k]).forEach(function (id) { makerLabel(id, n[k][id]); });
        } else walk(n[k], k, key);
      });
    })(node, null, null);
    return { models: models, makers: makers };
  }

  // ---- Data: everything the records say, joined ---------------------------

  // C.data(payload, urls) -> D, the whole joined bundle. urls: { src, details, outputs }.
  C.data = function (payload, urls) {
    var D = { payload: payload, urls: urls || {} };
    var FB = D.FB = payload.fallbacks || {};
    var FB_MODES = FB.modes || {}, FB_TIERS = FB.tiers || {}, FB_AREAS = FB.areas || {}, FB_METHODS = FB.scoring_methods || {};
    var store = D.store = collect(payload);
    D.skippedNote = store.skipped ? 'Some results were published with a newer Crucible than this page understands, so they are not shown.' : '';
    // Suites the display settings (_data/crucible_display.yml) hide aren't selectable; if that would
    // hide every suite, all of them stay visible
    var DISPLAY = D.DISPLAY = payload.display || {};
    var hiddenSuites = (DISPLAY.hidden_suites || []).map(String);
    var SUITES = store.catalogs.filter(function (c) { return hiddenSuites.indexOf(suiteId(c)) === -1; });
    if (!SUITES.length) SUITES = store.catalogs;
    D.SUITES = SUITES;
    D.CURRENT = SUITES.filter(function (c) { return c.suite.status === 'current'; })[0] || SUITES[0];
    D.suiteId = suiteId;
    D.suiteName = suiteName;
    D.catalogById = function (id) { return SUITES.filter(function (c) { return suiteId(c) === id; })[0] || null; };

    // A local run isn't billed: its cost is the electricity it used, its time x its machine's watts
    // (display settings, by hardware key) x the price per kWh. None when the machine has no watts listed
    var ENERGY = D.ENERGY = DISPLAY.energy || {};
    function wattsOf(hwKey) { var w = num((ENERGY.watts || {})[hwKey], null); return w && w > 0 ? w : null; }
    function isLocalRun(run) { return !!(run.endpoint && run.endpoint.where === 'local'); }
    function runCost(run) {
      if (!isLocalRun(run)) return num((run.metrics || {}).cost_usd, null);
      var w = wattsOf(run.hardware && run.hardware.key), t = num(run.elapsed_s, null), price = num(ENERGY.usd_per_kwh, null);
      return w && t !== null && price !== null ? w * t / 3600000 * price : null;
    }
    D.wattsOf = wattsOf;
    D.isLocalRun = isLocalRun;
    D.runCost = runCost;
    function timeOf(runs) { return median(runs.map(function (i) { return num(i.run.elapsed_s, null); })); }
    function costOf(cfg, runs) { return mean(runs.map(function (i) { return runCost(i.run); })); }
    D.timeOf = timeOf;
    D.costOf = costOf;

    // ---- Configurations ----------------------------------------------------

    // A configuration is one model, as weights, at one reasoning level, on one endpoint, hardware
    // and harness (the run record's identity keys). Rows on the leaderboard are a base model at a
    // reasoning level; a row is scored by its single best configuration.
    var CONFIGS = D.CONFIGS = {}, SLUGS = D.SLUGS = {};

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
    D.configOf = configOf;
    D.configBySlug = function (slug) { return SLUGS[slug] || null; };

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
    D.rowLabel = rowLabel;
    D.hardwareText = hardwareText;
    D.configLabel = configLabel;
    function hwValue(cfg) { return cfg.local ? cfg.hwKey || '-' : 'cloud'; }
    D.hwValue = hwValue;

    // ---- Makers and models ---------------------------------------------------

    var REG = readModels(payload.models);
    // A base model: from a run, a configuration, a row (s.cfg) or the base string itself
    function baseOf(x) {
      if (!x) return null;
      if (typeof x === 'string') return x;
      if (x.run_uuid && CONFIG_OF_RUN[x.run_uuid]) return CONFIG_OF_RUN[x.run_uuid].base;
      if (x.cfg) return x.cfg.base;
      if (x.model) { var m = x.model; return m.base || (m.variant_key ? String(m.variant_key).split('|')[0] : null) || m.id || null; }
      return x.base || null;
    }
    function makerOf(x) {
      var base = baseOf(x);
      if (!base) return null;
      return REG.models[base] ? REG.models[base].maker : makerFromBase(base);
    }
    function makerLabel(id) {
      if (!id) return '';
      var fb = (FB.makers || {})[id];
      return REG.makers[id] || (typeof fb === 'string' ? fb : fb && fb.label) || cap(id);
    }
    // The model page's id: "qwen/qwen3.5-9b" (maker, then the model's own name), or just the name
    function modelKey(x) {
      var base = baseOf(x);
      if (!base) return null;
      var maker = makerOf(base);
      return (maker ? maker + '/' : '') + modelName(base);
    }
    var BASES = [];
    Object.keys(CONFIGS).forEach(function (k) { if (BASES.indexOf(CONFIGS[k].base) === -1) BASES.push(CONFIGS[k].base); });
    D.baseOf = baseOf;
    D.makerOf = makerOf;
    D.makerLabel = makerLabel;
    D.modelKey = modelKey;
    D.modelLabel = function (base) { return (REG.models[base] && REG.models[base].label) || shortName(base); };
    D.bases = function () { return BASES.slice(); };
    D.basesOf = function (key) { return BASES.filter(function (b) { return modelKey(b) === key; }); };
    D.basesByMaker = function (maker) { return BASES.filter(function (b) { return makerOf(b) === maker; }); };
    D.makers = function () {
      var out = [];
      BASES.forEach(function (b) { var m = makerOf(b); if (m && out.indexOf(m) === -1) out.push(m); });
      return out.sort();
    };
    D.modelUrl = function (x, suite) { var base = baseOf(x); return modelUrl(makerOf(base), base, suite); };

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
    D.validity = validity;
    D.invalidReason = invalidReason;

    // A cell's value: the mean of its counted runs; for a provisional task, its runs' mean
    function cellValue(c) {
      if (!c) return null;
      if (c.counted.length) return { kind: 'counted', agg: agg(c.counted.map(function (i) { return i.score; })) };
      if (c.provisional.length) return { kind: 'provisional', agg: agg(c.provisional.map(function (i) { return i.score; })) };
      return { kind: 'uncounted', agg: null };
    }
    D.cellValue = cellValue;
    // A cell's numbers: its value, median time, tool calls and tokens, mean cost, timeouts, run counts
    function cellNumbers(c) {
      var counted = c ? c.counted : [];
      var shown = c ? (c.counted.length ? c.counted : c.provisional.length ? c.provisional : c.all) : [];
      var met = function (f) { return shown.map(function (i) { return num((i.run.metrics || {})[f], null); }); };
      return {
        value: cellValue(c), time: median(shown.map(function (i) { return num(i.run.elapsed_s, null); })),
        tools: median(met('tool_calls')), tokens: median(met('tokens_out')), cost: mean(shown.map(function (i) { return runCost(i.run); })),
        timedOut: shown.some(function (i) { return i.run.outcome && i.run.outcome.timed_out; }), runs: c ? c.all.length : 0, counted: counted.length
      };
    }
    D.cellNumbers = cellNumbers;

    // ---- Suite context -----------------------------------------------------

    // Everything the selected suite decides: its tasks, tiers, modes, weights, and which runs count
    function buildSuite(cat) {
      var S = { cat: cat, id: suiteId(cat), name: suiteName(cat) };
      var tasks = (cat.tasks || []).filter(function (t) { return t && t.id; });
      var taskById = {}, aliasOf = {};
      tasks.forEach(function (t) {
        taskById[t.id] = t;
        (t.aliases || []).forEach(function (a) { aliasOf[a] = t.id; });
        t.scoring_method = t.scoring && typeof t.scoring === 'object' ? t.scoring.method : t.scoring;
      });
      S.tasks = tasks;
      S.taskById = taskById;
      S.task = function (id) { return taskById[id] || taskById[aliasOf[id]] || null; };
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

      S.modeInfo = function (id) { return S.MODES.filter(function (m) { return m.id === id; })[0] || { id: id, label: '', blurb: '', harnesses: [], areas: [] }; };
      S.tierById = function (id) { return S.TIERS.filter(function (t) { return t.id === id; })[0] || { id: id, label: cap(id), role: null }; };
      S.tierLabel = function (id) { return S.tierById(id).label; };
      S.tierRole = function (id) { return S.tierById(id).role || 'none'; };
      S.gateOf = function (id) {
        var t = S.tierById(id), g = t.gate;
        return t.role === 'gate' && g && typeof g.mean === 'number' && typeof g.min === 'number' ? g : null;
      };
      S.cellOf = function (cfg, taskId) { return ((S.cells[cfg.key] || {})[taskId]) || null; };
      S.countedMean = function (cfg, taskId) {
        var c = S.cellOf(cfg, taskId);
        return c && c.counted.length ? mean(c.counted.map(function (i) { return i.score; })) : null;
      };
      // Every setup with a run of this task in this suite (any state), with the task's cell
      S.taskCells = function (taskId) {
        return Object.keys(S.cells).filter(function (k) { return S.cells[k][taskId]; })
          .map(function (k) { return { cfg: CONFIGS[k], cell: S.cells[k][taskId] }; });
      };

      // Best configuration: among setups whose headline tier meets the catalog's coverage_min, the
      // highest headline score; only when none does, the one with the most scored tasks. A near-empty
      // setup never beats a covered one. Never stitched per task: every number is one setup's.
      S.betterConfig = function (a, b) {
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
      };

      // Every tier reads the same: a 0-10 score, the bar, and 'n/m tasks'. The gate result (pass or
      // fail) and 'partial' or 'provisional' are small markers on that cell, not a different cell.
      S.tierCell = function (s, t, into) {
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
      };

      var views = {};
      S.view = function (mode) { return views[mode] || (views[mode] = buildView(S, mode)); };
      return S;
    }

    // ---- A suite's section (mode) ---------------------------------------------

    // One mode of one suite: its tasks in order, tiers, weights, tier scores, stats per setup and
    // leaderboard rows. Stats don't depend on any filter, so they're cached here.
    function buildView(S, modeId) {
      var V = { S: S, mode: modeId, info: S.modeInfo(modeId) };
      // Only tasks the suite makes active are shown; provisional runs stay in the data, unshown
      function inMode(t) { return t.mode === modeId && t.status === 'active'; }
      V.inMode = inMode;

      // Tasks shown: this mode's active tasks, tier by tier, area order within a tier
      var areas = V.info.areas.map(function (a) { return a.id; });
      var tiers = V.tiers = S.TIERS.map(function (t) { return t.id; }).filter(function (tier) {
        return S.tasks.some(function (t) { return inMode(t) && t.tier === tier; });
      });
      var orderedTasks = V.orderedTasks = [];
      tiers.forEach(function (tier) {
        areas.forEach(function (area) {
          S.tasks.forEach(function (t) { if (inMode(t) && t.tier === tier && t.area === area) orderedTasks.push(t); });
        });
      });
      var taskIds = V.taskIds = {};
      orderedTasks.forEach(function (t) { taskIds[t.id] = true; });
      // A tier with no active task in this section has no column here
      V.TIERS = S.TIERS.filter(function (t) { return tiers.indexOf(t.id) !== -1; });
      if (!V.TIERS.length) V.TIERS = [S.HEADLINE];
      V.head = function () { return V.TIERS.filter(function (t) { return t.id === S.HEAD; })[0] || V.TIERS.filter(function (t) { return t.role !== 'gate'; })[0] || V.TIERS[0]; };
      V.stretch = function () { return V.TIERS.filter(function (t) { return t.id !== S.HEAD && t.role !== 'gate'; }); };
      // Harnesses in this mode: only the catalog's. A run through any other harness never counts,
      // so it isn't offered as a filter; the model detail still lists the run as not counted
      V.harnesses = function () { return V.info.harnesses.slice(); };
      // Every setup with a run in this mode
      V.configs = function () {
        return Object.keys(S.cells).map(function (k) { return CONFIGS[k]; }).filter(function (cfg) {
          return S.cfgModes[cfg.key] && S.cfgModes[cfg.key][modeId];
        });
      };

      // Each active task's share of its tier: the catalog's weight, else its category's weight split
      var weightCache = {};
      V.taskWeights = function (tier) {
        if (weightCache[tier]) return weightCache[tier];
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
        return (weightCache[tier] = weights);
      };

      // Tier score: weighted mean of per-task means, rescaled over the scored tasks. Coverage is the
      // share of the tier's weight that was scored; below COVERAGE_MIN the score is partial.
      // `only` limits it to a set of tasks (the compare view's shared tasks).
      V.tierScore = function (cfg, tier, only) {
        var weights = V.taskWeights(tier);
        var total = 0, scoredWeight = 0, allWeight = 0, scores = [], n = 0;
        Object.keys(weights).forEach(function (id) {
          if (only && !only[id]) return;
          allWeight += weights[id];
          n += 1;
          var score = S.countedMean(cfg, id);
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
      };

      // Provisional tasks don't count, but are worth showing on their own
      V.provisionalScore = function (cfg, tier) {
        var list = S.tasks.filter(function (t) { return inMode(t) && t.tier === tier && t.status === 'provisional'; });
        var scores = list.map(function (t) { var v = cellValue(S.cellOf(cfg, t.id)); return v && v.agg ? v.agg.mean : null; });
        return { score: mean(scores), scored: scores.filter(function (s) { return s !== null; }).length, total: list.length };
      };

      function gateVerdict(result, gate) {
        if (!result || result.score === null) return null;
        if (result.partial) return 'partial';
        return result.score >= gate.mean && result.min >= gate.min ? 'pass' : 'fail';
      }

      V.countedRuns = function (cfg, only) {
        var out = [];
        Object.keys(S.cells[cfg.key] || {}).forEach(function (id) {
          if (!taskIds[id] || (only && !only[id])) return;
          out = out.concat(S.cells[cfg.key][id].counted);
        });
        return out;
      };

      // A setup in this mode: tier scores, gate verdicts, provisional scores, time, cost, progress
      var statsCache = {};
      V.stats = function (cfg) {
        if (statsCache[cfg.key]) return statsCache[cfg.key];
        var runs = V.countedRuns(cfg);
        var active = orderedTasks.filter(function (t) { return t.status === 'active'; });
        var done = active.filter(function (t) { return S.countedMean(cfg, t.id) !== null; }).length;
        var progress = { done: done, total: active.length, share: active.length ? done / active.length : 0 };
        var tier = {}, verdict = {}, provisionalOf = {};
        S.TIERS.forEach(function (t) {
          var result = V.tierScore(cfg, t.id);
          if (t.id === S.HEAD || t.role === 'gate') tier[t.id] = result;
          else {
            tier[t.id] = result.total ? result : null;
            var prov = V.provisionalScore(cfg, t.id);
            provisionalOf[t.id] = prov.total ? prov : null;
          }
          if (S.gateOf(t.id)) verdict[t.id] = gateVerdict(result, S.gateOf(t.id));
        });
        var ran = Object.keys(S.cells[cfg.key] || {}).some(function (id) { return taskIds[id]; });
        return (statsCache[cfg.key] = {
          cfg: cfg, local: cfg.local, ran: ran, tier: tier, verdict: verdict, provisional: provisionalOf,
          head: tier[S.HEAD], time: timeOf(runs), cost: costOf(cfg, runs), runs: runs.length,
          progress: progress, inProgress: !meets(progress.share, S.IN_PROGRESS_BELOW)
        });
      };

      // One row per base model and reasoning level, across local and cloud, scored by its best
      // setup; `variants` are its setups, best first. `keep(cfg)` filters the setups considered.
      V.rows = function (keep) {
        var groups = {};
        V.configs().filter(keep || function () { return true; }).forEach(function (cfg) {
          (groups[cfg.rowKey] = groups[cfg.rowKey] || []).push(V.stats(cfg));
        });
        // A model with no counted run in this suite and section isn't on the board at all
        return Object.keys(groups).filter(function (key) {
          return groups[key].some(function (v) { return v.runs > 0; });
        }).map(function (key) {
          var variants = groups[key].sort(S.betterConfig);
          var best = variants[0];
          return Object.assign({}, best, { rowKey: key, label: rowLabel(best.cfg), variants: variants });
        });
      };

      function tierValue(s, id) {
        var result = s.tier[id];
        if (result && result.score !== null) return result.score;
        return s.provisional[id] ? s.provisional[id].score : null;
      }
      function sortValue(key, s) {
        if (key === 'model') return (s.label || rowLabel(s.cfg)).toLowerCase();
        if (key === 'time') return s.time;
        if (key === 'cost') return s.cost;
        return tierValue(s, key);
      }
      V.tierValue = tierValue;
      // Leaderboard order for sort { key: tier id | 'model' | 'time' | 'cost', dir: -1 | 1 }: rows with
      // runs first, in-progress last, partial tier scores after full ones
      V.sortRows = function (list, sort) {
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
      };
      V.noneFinished = function (rows) { return !rows.some(function (s) { return s.ran && !s.inProgress; }); };
      // A row is ranked when it ran, has finished and has a full headline score
      V.isRanked = function (s) { return s.ran && !s.inProgress && s.head.score !== null && !s.head.partial; };

      V.hasToolCalls = function () {
        return V.configs().some(function (cfg) {
          return Object.keys(S.cells[cfg.key] || {}).some(function (id) {
            return taskIds[id] && S.cells[cfg.key][id].all.some(function (i) { var v = (i.run.metrics || {}).tool_calls; return v !== null && v !== undefined; });
          });
        });
      };
      V.areaResult = function (cfg, area) {
        var list = orderedTasks.filter(function (t) { return t.area === area.id; });
        var means = list.map(function (t) { return S.countedMean(cfg, t.id); }).filter(function (v) { return v !== null; });
        return { tasks: list, n: means.length, score: mean(means) };
      };

      // ---- Compare ----

      // Setups that ran in this mode, by model name, best setup first within a model
      V.compareCandidates = function () {
        return V.configs().map(V.stats).filter(function (s) { return s.ran; }).sort(function (a, b) {
          var la = rowLabel(a.cfg), lb = rowLabel(b.cfg);
          if (la !== lb) return la < lb ? -1 : 1;
          return S.betterConfig(a, b);
        });
      };
      // Two to four setups side by side on the tasks all of them have counted runs of. Tier scores
      // are recomputed over those shared tasks only; each keeps its own local/cloud tag, cost and time.
      V.compare = function (slugs) {
        var candidates = V.compareCandidates();
        var bySlug = {};
        candidates.forEach(function (s) { bySlug[s.cfg.slug] = s; });
        var chosen = slugs.map(function (slug) { return bySlug[slug]; }).filter(Boolean)
          .map(function (s) { return Object.assign({}, s, { label: rowLabel(s.cfg) }); });
        var out = { candidates: candidates, chosen: chosen, shared: {}, sharedTasks: [], tiers: [], extra: [] };
        if (chosen.length < 2) return out;
        out.sharedTasks = orderedTasks.filter(function (t) {
          return t.status === 'active' && chosen.every(function (s) { return S.countedMean(s.cfg, t.id) !== null; });
        });
        out.sharedTasks.forEach(function (t) { out.shared[t.id] = true; });
        out.tiers = S.TIERS.map(function (t) {
          var any = out.sharedTasks.some(function (x) { return x.tier === t.id; });
          return any ? { tier: t, scores: chosen.map(function (s) { return V.tierScore(s.cfg, t.id, out.shared); }) } : null;
        }).filter(Boolean);
        out.extra = chosen.map(function (s) {
          var runs = V.countedRuns(s.cfg, out.shared);
          return { time: timeOf(runs), cost: costOf(s.cfg, runs) };
        });
        // One setup's counted runs of one shared task, as a mean with n and range
        out.cell = function (s, t) { return agg(S.cellOf(s.cfg, t.id).counted.map(function (i) { return i.score; })); };
        return out;
      };
      return V;
    }

    var suiteCache = {};
    // A suite by id (hidden or unknown ids fall back to the current suite), built once
    D.suite = function (id) {
      var cat = D.catalogById(id) || D.CURRENT;
      var key = suiteId(cat);
      return suiteCache[key] || (suiteCache[key] = buildSuite(cat));
    };
    // The suite the hash's suite= parameter selects, else the current one
    D.selectedSuite = function () { return D.suite(parseHash().params.suite || null); };

    // ---- Runs: score detail, checks and output, loaded on demand ---------

    var detailsPromise = null;
    D.loadDetails = function () {
      if (!detailsPromise) {
        detailsPromise = fetch(D.urls.details).then(function (r) {
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
    };

    var STATE_TEXT = D.STATE_TEXT = {
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

    // One run: its score sentence, standing, checks (details.json), output (fetched when opened)
    function runBody(info, into) {
      var r = info.run, met = r.metrics || {}, out = r.outcome || {};
      into.appendChild(el('p', {}, scoreSentence(info)));
      var flag = STATE_TEXT[info.state] || info.state;
      var reason = info.state === 'invalid' ? invalidReason(info.uuid, r) : null;
      into.appendChild(el('p', { class: 'crucible-detail-meta' }, cap(flag) + (reason ? ': ' + reason : '') + '.'));
      var checks = into.appendChild(el('div', { class: 'crucible-run-checks' }));
      if (info.rec) {
        checks.appendChild(el('p', { class: 'crucible-detail-meta' }, 'Loading checks…'));
        D.loadDetails().then(function (index) {
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
          fetch((D.urls.outputs || '/crucible-data/') + r.output_ref).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
          }).then(function (text) { pre.textContent = text || '(empty)'; }, function () { loaded = false; pre.textContent = 'Couldn’t load the output.'; });
        });
        into.appendChild(details);
      }
      into.appendChild(el('p', { class: 'crucible-detail-meta' }, [
        'ran ' + fmtDate(r.started_at), (out.status || NONE).replace(/_/g, ' ') + (out.timed_out ? ' (timed out)' : ''),
        'time ' + fmtSeconds(num(r.elapsed_s, null)), met.tool_calls !== null && met.tool_calls !== undefined ? 'tool calls ' + fmtInt(met.tool_calls) : null,
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

    D.promptBlock = promptBlock;
    D.scoreSentence = scoreSentence;
    D.runBody = runBody;
    D.runList = runList;
    // The cell detail panel: a row's setup (s: { label, cfg }) on one task, the task's prompt and
    // every run behind the cell (c, from S.cellOf). Fills `panel` and shows it.
    D.showCellDetail = function (panel, S, s, t, c) {
      panel.innerHTML = '';
      var title = panel.appendChild(el('p', { class: 'crucible-tooltip-title' }, s.label + ' · ' + taskName(t) + ' · ' + S.tierLabel(t.tier) +
        (t.status === 'provisional' ? ' (provisional)' : '')));
      title.appendChild(el('small', { class: 'crucible-task-id' }, ' ' + configLabel(s.cfg)));
      promptBlock(t, panel);
      runList(c, panel);
      panel.hidden = false;
    };

    // A matrix cell's button: the cell's mean, heat-coloured, with its repeats; click it to open the panel
    D.cellButton = function (s, t, c, narrowCell) {
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
    };

    // A card headed by a row's model name, where tag and setup
    D.modelCard = function (s, ul) {
      var li = ul.appendChild(el('li', { class: 'crucible-card' }));
      var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
      title.appendChild(nameNode(s.label));
      title.appendChild(whereTag(s.cfg));
      li.appendChild(el('p', { class: 'crucible-config-line' }, configLabel(s.cfg)));
      return li;
    };

    D.costLabel = function (s) { return fmtCost(s.cost, s.local); };
    D.costTitle = function (s) {
      if (!s.local) return 'Average API cost per counted run';
      var w = wattsOf(s.cfg.hwKey);
      return w ? 'Estimated electricity per counted run: ' + w + ' W at $' + num(ENERGY.usd_per_kwh, 0) + '/kWh for the run\'s time. Not the hardware\'s cost.'
        : 'Local runs aren\'t billed, and this hardware has no power figure';
    };

    return D;
  };

  // ---- Loading ------------------------------------------------------------

  // C.boot({ script, status, ready }): fetches the records (script's data-src), shows a loading
  // and an error state with a retry in `status`, joins them (C.data) and calls ready(D). A page's
  // script tag carries data-src, data-details and data-outputs, as crucible.js's does.
  C.boot = function (opts) {
    var script = opts.script, statusEl = opts.status || document.getElementById('crucible-status');
    function attr(name) { return opts[name] || (script && script.getAttribute('data-' + name)) || null; }
    var urls = { src: attr('src'), details: attr('details'), outputs: attr('outputs') || '/crucible-data/' };

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
      fetch(urls.src)
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(function (payload) {
          try {
            var D = C.data(payload, urls);
            D.showStatus = showStatus;
            if (!D.store.catalogs.length) {
              showStatus(D.skippedNote || 'No results have been published yet.');
              return;
            }
            opts.ready(D);
            showStatus(D.skippedNote);
          } catch (e) {
            if (window.console) console.error(e);
            showStatus('Something went wrong drawing the results.', true);
          }
        }, function () {
          showStatus('Couldn’t load the results.', true);
        });
    }
    load();
  };
})();
