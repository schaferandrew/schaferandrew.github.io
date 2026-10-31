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
  // Rule 5, a display rule like the fallbacks: a paired comparison gets a "scores X higher/lower"
  // headline only on at least MIN_PAIRED_TASKS shared finished tasks, and only when no single task
  // accounts for more than MAX_TASK_SHARE of the summed difference. Otherwise: "differ on k of n".
  C.MIN_PAIRED_TASKS = 5;
  C.MAX_TASK_SHARE = 0.5;
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

  // Namespaces that repackage other labs' weights; never a maker. Mirrors Crucible's origin.PACKAGERS.
  var PACKAGERS = ['mlx-community', 'lmstudio-community', 'unsloth', 'bartowski'];
  // The maker inferred from a model base, for runs without model.origin: the part before its '/',
  // with a leading '~' (a provider's "latest" alias) dropped; null when there is none or it's a packager.
  function makerFromBase(base) {
    var b = String(base || '').replace(/^~/, ''), i = b.indexOf('/');
    var m = i > 0 ? b.slice(0, i).toLowerCase() : null;
    return m && PACKAGERS.indexOf(m) === -1 ? m : null;
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
  // extra: more parameters, written before the suite (e.g. { variant, deployment, mode })
  function pageUrl(page, id, suite, extra) {
    var p = {};
    Object.keys(extra || {}).forEach(function (k) { if (k !== 'suite') p[k] = extra[k]; });
    p.suite = suiteParam(suite);
    return C.BASE + page + '/' + buildHash(id, p);
  }
  function taskUrl(id, suite) { return pageUrl('task', id, suite); }
  // The model page: '#<maker>/<model>', '#-/<model>' when no maker is known. The third argument is
  // the suite, or an object { variant, deployment, mode, suite }; extra (the 4th) adds parameters.
  function modelUrl(maker, base, suite, extra) {
    if (suite && typeof suite === 'object') { extra = suite; suite = extra.suite; }
    return pageUrl('model', (maker || UNKNOWN_MAKER) + '/' + modelName(base), suite, extra);
  }
  function compareUrl(slugs, suite) { return pageUrl('compare', slugs.join(','), suite); }
  // A publisher (the maker) is the model page's top level: '#<maker>', '#-' for models with no
  // known maker. publisherUrl() with no maker at all would be '#-' too; the index is modelIndexUrl().
  function publisherUrl(maker, suite) { return pageUrl('model', maker || UNKNOWN_MAKER, suite); }
  function modelIndexUrl(suite) { return pageUrl('model', null, suite); }
  // The model page's id, parsed: '' -> { level: 'index' }; '<maker>' -> { level: 'publisher', maker };
  // '<maker>/<model>' -> { level: 'model', maker, model }. '-' stands for "no known maker" (maker null,
  // unknownMaker true). key is what D.basesOf takes ("qwen/qwen3.5-9b", or just the name).
  var UNKNOWN_MAKER = '-';
  function parseModelId(id) {
    id = id === null || id === undefined ? '' : String(id).replace(/^\/+|\/+$/g, '');
    if (!id) return { level: 'index', maker: null, model: null, unknownMaker: false, key: null };
    var i = id.indexOf('/');
    var maker = i === -1 ? id : id.slice(0, i), model = i === -1 ? null : id.slice(i + 1) || null;
    var unknown = maker === UNKNOWN_MAKER;
    if (unknown) maker = null;
    return {
      level: model ? 'model' : 'publisher', maker: maker, model: model, unknownMaker: unknown,
      key: model ? (maker ? maker + '/' : '') + model : null
    };
  }
  C.UNKNOWN_MAKER = UNKNOWN_MAKER;
  C.parseModelId = parseModelId;
  C.modelIndexUrl = modelIndexUrl;

  // The hash for `id`, keeping the current hash's `keep` parameters (default: the suite), then `over`
  function hashFor(id, over, keep) {
    var cur = parseHash().params, p = {};
    (keep || ['suite']).forEach(function (k) { if (cur[k] !== undefined) p[k] = cur[k]; });
    Object.keys(over || {}).forEach(function (k) { p[k] = over[k]; });
    return buildHash(id, p);
  }
  // A page's breadcrumb: 'Crucible › …', each part a { href, text } link or plain text. The
  // Crucible link keeps the suite being looked at.
  function breadcrumb(into, parts) {
    into.innerHTML = '';
    [{ href: C.BASE + buildHash(null, { suite: suiteParam() }), text: 'Crucible' }].concat(parts || []).forEach(function (p, i) {
      if (i) into.appendChild(document.createTextNode(' › '));
      if (typeof p === 'string') into.appendChild(document.createTextNode(p));
      else into.appendChild(el('a', { href: p.href }, p.text));
    });
  }

  [['parseHash', parseHash], ['buildHash', buildHash], ['onRoute', onRoute], ['taskUrl', taskUrl],
    ['modelUrl', modelUrl], ['compareUrl', compareUrl], ['publisherUrl', publisherUrl], ['hashFor', hashFor],
    ['breadcrumb', breadcrumb]
  ].forEach(function (p) { C[p[0]] = p[1]; });

  // ---- Shared pieces ------------------------------------------------------

  // Series colours for two to four things drawn side by side (compare, A/B, harnesses); apart from
  // the heat blues' light end and readable on white. Index past the end wraps.
  C.SERIES = ['#1856a3', '#eb6834', '#2f8a4a', '#8a4fbf'];
  C.seriesColor = function (i) { return C.SERIES[i % C.SERIES.length]; };
  C.INFERRED_TITLE = 'Inferred from the model name: the runs didn\'t record who made the model.';
  C.inferredMark = function () { return el('span', { class: 'crucible-inferred', title: C.INFERRED_TITLE }, 'inferred'); };
  // A heat-coloured score button: value 0-10 (null shows as uncounted), its accessible label, and
  // opts { text, n (repeats, shown as ×n), cls }
  C.scoreButton = function (value, label, opts) {
    opts = opts || {};
    var counted = value !== null && value !== undefined;
    var b = el('button', { type: 'button', class: 'crucible-score-button' + (opts.cls ? ' ' + opts.cls : '') + (counted ? '' : ' is-uncounted'), 'aria-label': label },
      opts.text !== undefined ? opts.text : fmtScore(value));
    if (counted) b.setAttribute('style', heatStyle(value));
    if (opts.n > 1) b.appendChild(el('sup', { class: 'crucible-repeat-n' }, '×' + opts.n));
    return b;
  };
  // A setup's coverage: counted tasks of the section's scored tasks, a bar, and an "in progress"
  // pill below the suite's in_progress_below (s: V.stats(cfg))
  C.coverageBar = function (s, S) {
    var w = el('span', { class: 'crucible-cov' });
    w.appendChild(el('span', { class: 'crucible-cov-n' }, s.progress.done + '/' + s.progress.total));
    var bar = w.appendChild(el('span', { class: 'crucible-cov-bar' }));
    bar.appendChild(el('span', { class: 'crucible-cov-fill' + (s.inProgress ? ' is-low' : '') })).style.width = Math.round(s.progress.share * 100) + '%';
    if (s.inProgress) w.appendChild(C.inProgressPill(S));
    return w;
  };
  C.inProgressPill = function (S) {
    return el('span', { class: 'crucible-pill', title: 'Fewer than ' + pct(S.IN_PROGRESS_BELOW) + ' of this section\'s scored tasks have a counted run, so the score may still move' }, 'in progress');
  };

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
    var CONFIG_OF_RUN = {}, IDENT_OF_CFG = {};
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
          IDENT_OF_CFG[finalKey] = id;
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

    // ---- Variants and deployments -------------------------------------------

    // A setup is a variant on a deployment. The variant is what changes the answers: the base model,
    // its weights (packager, format, quant), the reasoning level and the harness. Quality belongs to a
    // variant. The deployment is what changes speed and cost: the machine for a local run (its
    // hardware key, else the device that served it), the provider for a cloud one. Speed, cost and
    // reliability belong to a deployment of a variant.
    // Variants come from setups, so a run with no recorded machine that a setup took in (see
    // buildConfigs) counts in that setup's variant. Deployments come from each run's own record: such
    // a run is in its own "machine not recorded" deployment, never merged, and kept out of A/Bs and
    // speed or cost comparisons.
    var VARIANTS = D.VARIANTS = {}, VARIANT_OF_CFG = {}, VARIANT_SLUGS = {};
    var DEPLOYMENTS = D.DEPLOYMENTS = {}, DEPLOYMENT_OF_RUN = {};

    // Every dimension a setup is made of, and its kind. 'harness' is answer-changing only in a mode
    // with more than one harness (S.variantDims(mode) asks the catalog); elsewhere it's implied.
    D.DIMENSIONS = [
      { id: 'model', kind: 'variant', label: 'Model' },
      { id: 'weights', kind: 'variant', label: 'Quant' },
      { id: 'reasoning', kind: 'variant', label: 'Reasoning' },
      { id: 'harness', kind: 'variant', label: 'Harness' },
      { id: 'where', kind: 'deployment', label: 'Local or cloud' },
      { id: 'machine', kind: 'deployment', label: 'Machine' },
      { id: 'provider', kind: 'deployment', label: 'Provider' }
    ];
    D.dimension = function (id) { return D.DIMENSIONS.filter(function (d) { return d.id === id; })[0] || { id: id, kind: 'variant', label: cap(id) }; };

    // finished | timed_out | error (a harness error, a failure, a context limit, or no status
    // recorded). Only a finished run's score is quality in a comparison; the others are reliability.
    function runOutcome(r) {
      var o = (r && r.outcome) || {};
      if (o.timed_out || o.status === 'timeout') return 'timed_out';
      if (o.status === 'completed') return 'finished';
      return 'error';
    }
    D.runOutcome = runOutcome;
    D.OUTCOME_TEXT = { finished: 'finished', timed_out: 'timed out', error: 'harness error' };
    function outcomeText(r) {
      var k = runOutcome(r), st = ((r && r.outcome) || {}).status;
      return k === 'error' && st && st !== 'harness_error' ? String(st).replace(/_/g, ' ') : D.OUTCOME_TEXT[k];
    }
    D.outcomeText = outcomeText;

    function deploymentFrom(local, hwKey, device, provider) {
      var key, label, recorded = true;
      if (local) {
        if (hwKey) key = 'local~' + slugify(hwKey);
        else if (device) key = 'local~device-' + slugify(device);
        else { key = 'local~unrecorded'; recorded = false; }
      } else if (provider) key = 'cloud~' + slugify(provider);
      else { key = 'cloud~unrecorded'; recorded = false; }
      var dep = DEPLOYMENTS[key];
      if (!dep) {
        dep = DEPLOYMENTS[key] = {
          key: key, local: local, where: local ? 'local' : 'cloud', recorded: recorded,
          hwKey: local ? hwKey || null : null, provider: local ? null : provider || null,
          devices: {}, upstreams: {}, costKind: local ? 'electricity' : 'billed'
        };
      }
      if (local && device && hwKey) dep.devices[device] = true;
      return dep;
    }
    function deploymentLabel(dep) {
      if (!dep) return NONE;
      if (dep.local) {
        if (!dep.recorded) return 'machine not recorded';
        var devices = Object.keys(dep.devices);
        if (!dep.hwKey) return devices.join(', ') || dep.key.replace(/^local~device-/, '');
        return dep.hwKey + (devices.length ? ' (' + devices.join(', ') + ')' : '');
      }
      return dep.recorded ? 'via ' + dep.provider : 'provider not recorded';
    }
    D.deploymentLabel = deploymentLabel;
    Object.keys(store.runs).forEach(function (uuid) {
      var r = store.runs[uuid], id = identityOf(r), e = r.endpoint || {};
      var dep = deploymentFrom(id.local, id.hwKey, id.device, id.provider);
      if (!id.hwKey && id.device) dep.devices[id.device] = true;
      var up = e.upstream && (e.upstream.name || e.upstream.provider);
      if (up) dep.upstreams[up] = true;
      DEPLOYMENT_OF_RUN[uuid] = dep;
    });
    Object.keys(DEPLOYMENTS).forEach(function (k) { DEPLOYMENTS[k].label = deploymentLabel(DEPLOYMENTS[k]); });

    // Variants, one per setup's answer-changing fields. Weights that weren't recorded (no quant on
    // a local setup) are unknown: such a setup is a variant of its own, never pooled with another.
    Object.keys(CONFIGS).forEach(function (k) {
      var cfg = CONFIGS[k], id = IDENT_OF_CFG[k] || {};
      var recorded = !cfg.local || !!id.quant;
      var weightsKey = cfg.local ? [id.publisher || '?', id.format || '?', id.quant || '?'].join('/') : 'api';
      var vkey = [cfg.base, recorded ? weightsKey : 'unrecorded:' + cfg.key, cfg.level, cfg.harness].join('|');
      var v = VARIANTS[vkey];
      if (!v) {
        v = VARIANTS[vkey] = {
          key: vkey, base: cfg.base, rowKey: cfg.rowKey, level: cfg.level, harness: cfg.harness,
          local: cfg.local, where: cfg.where,
          weights: { key: recorded ? weightsKey : null, recorded: recorded, quant: cfg.local ? cfg.quant || null : null, format: id.format || null, packager: cfg.publisher || null },
          cfgs: []
        };
        var slug = [cfg.local ? (cfg.quant || 'quant-not-recorded') : 'api', 'reasoning-' + cfg.level, cfg.harness].map(slugify).join('~');
        var unique = slug, n = 2, taken = VARIANT_SLUGS[cfg.base] = VARIANT_SLUGS[cfg.base] || {};
        while (taken[unique]) unique = slug + '~' + (n++);
        taken[unique] = v;
        v.slug = unique;
      }
      v.cfgs.push(cfg);
      VARIANT_OF_CFG[k] = v;
    });

    // x: a run, a setup, a cell entry or row ({ cfg }), a variant, or a variant key
    function variantOf(x) {
      if (!x) return null;
      if (typeof x === 'string') return VARIANTS[x] || null;
      if (x.cfgs && x.weights) return x;
      if (x.run_uuid && CONFIG_OF_RUN[x.run_uuid]) return VARIANT_OF_CFG[CONFIG_OF_RUN[x.run_uuid].key];
      if (x.cfg) return VARIANT_OF_CFG[x.cfg.key] || null;
      if (x.key && VARIANT_OF_CFG[x.key]) return VARIANT_OF_CFG[x.key];
      return null;
    }
    // x: a run (its own record), a cell entry ({ run }), a setup (its recorded machine or provider),
    // a deployment, or a deployment key
    function deploymentOf(x) {
      if (!x) return null;
      if (typeof x === 'string') return DEPLOYMENTS[x] || null;
      if (x.costKind && x.key && DEPLOYMENTS[x.key] === x) return x;
      if (x.run_uuid && DEPLOYMENT_OF_RUN[x.run_uuid]) return DEPLOYMENT_OF_RUN[x.run_uuid];
      if (x.run && x.run.run_uuid) return DEPLOYMENT_OF_RUN[x.run.run_uuid] || null;
      if (x.cfg) x = x.cfg;
      if (x.key && CONFIGS[x.key] === x) {
        var id = IDENT_OF_CFG[x.key] || {};
        var dep = deploymentFrom(x.local, x.hwKey, id.device, x.provider);
        if (!dep.label) dep.label = deploymentLabel(dep);
        return dep;
      }
      return null;
    }
    D.variantOf = variantOf;
    D.deploymentOf = deploymentOf;
    D.variantBySlug = function (base, slug) { return (VARIANT_SLUGS[baseOf(base)] || {})[slug] || null; };
    // Every variant of a base model (or of the bases a model key names), in setup order
    D.variantsOfBase = function (base) {
      base = baseOf(base);
      return Object.keys(VARIANTS).map(function (k) { return VARIANTS[k]; }).filter(function (v) { return v.base === base; });
    };

    // A variant's value on an answer-changing dimension, and its text
    function variantValue(v, dim) {
      if (dim === 'model') return v.base;
      if (dim === 'weights') return v.weights.key || 'unrecorded:' + v.key;
      if (dim === 'reasoning') return v.level;
      if (dim === 'harness') return v.harness;
      return null;
    }
    function variantText(v, dim) {
      if (dim === 'model') return shortName(v.base);
      if (dim === 'weights') return v.local ? v.weights.quant || 'quant not recorded' : 'provider\'s weights';
      if (dim === 'reasoning') return 'reasoning ' + v.level;
      if (dim === 'harness') return v.harness;
      return '';
    }
    D.variantValue = variantValue;
    D.variantText = variantText;
    // Chips text: "Q4_K_M · reasoning off", plus " · pi" when opts.harness (a mode with several
    // harnesses: S.variantDims(mode)). opts.model puts the model name first.
    D.variantLabel = function (v, opts) {
      v = variantOf(v);
      if (!v) return NONE;
      opts = opts || {};
      var dims = (opts.model ? ['model'] : []).concat(v.local ? ['weights'] : [], ['reasoning'], opts.harness ? ['harness'] : []);
      return dims.map(function (d) { return variantText(v, d); }).join(' · ');
    };
    // The answer-changing dimensions on which two variants differ (ids of D.DIMENSIONS)
    D.variantDiff = function (a, b) {
      a = variantOf(a); b = variantOf(b);
      if (!a || !b) return [];
      return ['model', 'weights', 'reasoning', 'harness'].filter(function (d) { return variantValue(a, d) !== variantValue(b, d); });
    };
    // "Packaged by mlx-community": the weights' packager (model.publisher), when it's recorded and
    // isn't the maker itself; '' otherwise. Never call the packager the publisher.
    D.packagerOf = function (x) {
      var v = variantOf(x);
      var p = v ? v.weights.packager : x && x.model ? x.model.publisher : null;
      return p ? String(p) : null;
    };
    D.packagedBy = function (x) {
      var p = D.packagerOf(x), v = variantOf(x);
      var maker = makerOf(v ? v.base : x);
      return p && p !== maker ? 'Packaged by ' + p : '';
    };

    // An old '&setup=<slug>' link as the model page's parameters: { variant, deployment, base, cfg }
    D.setupParams = function (slug) {
      var cfg = SLUGS[slug];
      if (!cfg) return null;
      return { variant: VARIANT_OF_CFG[cfg.key].slug, deployment: deploymentOf(cfg).key, base: cfg.base, cfg: cfg };
    };
    // The model page's route, resolved: C.parseModelId(route.id) plus { bases, variant (a variant or
    // null), deployment (a deployment or null), mode, suite }. An old &setup= maps to its variant and
    // deployment; &variant= and &deployment= win when both are given.
    D.modelRoute = function (route) {
      route = route || parseHash();
      var p = route.params || {}, out = parseModelId(route.id);
      out.bases = out.key ? D.basesOf(out.key) : [];
      out.mode = p.mode || null;
      out.suite = p.suite || null;
      var fromSetup = p.setup ? D.setupParams(p.setup) : null;
      var vSlug = p.variant || (fromSetup && fromSetup.variant), dKey = p.deployment || (fromSetup && fromSetup.deployment);
      out.variant = null;
      out.bases.some(function (b) { out.variant = vSlug ? D.variantBySlug(b, vSlug) : null; return !!out.variant; });
      out.deployment = dKey ? DEPLOYMENTS[dKey] || null : null;
      return out;
    };

    // ---- Makers and models ---------------------------------------------------

    // A run's maker is its recorded model.origin.maker (Crucible 3.5.0 on); without one it's inferred
    // from the model base. A base's maker is the one its runs recorded most, else the inferred one.
    var RECORDED = {};
    Object.keys(store.runs).forEach(function (uuid) {
      var m = store.runs[uuid].model || {}, o = m.origin;
      if (!o || !o.maker || !m.base) return;
      var c = RECORDED[m.base] = RECORDED[m.base] || {};
      c[o.maker] = (c[o.maker] || 0) + 1;
    });
    function recordedMaker(base) {
      var c = RECORDED[base];
      if (!c) return null;
      return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); })[0];
    }
    // A base model: from a run, a configuration, a row (s.cfg) or the base string itself
    function baseOf(x) {
      if (!x) return null;
      if (typeof x === 'string') return x;
      if (x.run_uuid && CONFIG_OF_RUN[x.run_uuid]) return CONFIG_OF_RUN[x.run_uuid].base;
      if (x.cfg) return x.cfg.base;
      if (x.model) { var m = x.model; return m.base || (m.variant_key ? String(m.variant_key).split('|')[0] : null) || m.id || null; }
      return x.base || null;
    }
    // { id, inferred, source }: who made the model. A run answers from its own model.origin; anything
    // else (a base, a configuration, a row) from its base's runs. id is null when nothing says.
    function makerInfo(x) {
      var o = x && x.model && x.model.origin;
      if (o && o.maker) return { id: o.maker, inferred: false, source: o.source || null };
      var base = baseOf(x);
      if (!base) return { id: null, inferred: true, source: null };
      var rec = recordedMaker(base);
      if (rec) return { id: rec, inferred: false, source: 'runs' };
      return { id: makerFromBase(base), inferred: true, source: null };
    }
    function makerOf(x) { return makerInfo(x).id; }
    // Makers are shown as recorded (the namespace the source uses, e.g. "qwen"): no label list.
    function makerLabel(id) { return id ? String(id) : 'unknown maker'; }
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
    D.makerInfo = makerInfo;
    D.makerOf = makerOf;
    D.makerLabel = makerLabel;
    D.modelKey = modelKey;
    D.modelLabel = function (base) { return shortName(base); };
    D.bases = function () { return BASES.slice(); };
    // key: "qwen/qwen3.5-9b", or "-/name" / "name" for a model with no known maker
    D.basesOf = function (key) {
      key = String(key || '').replace(/^-\//, '');
      return BASES.filter(function (b) { return modelKey(b) === key; });
    };
    D.basesByMaker = function (maker) { return BASES.filter(function (b) { return makerOf(b) === maker; }); };
    D.makers = function () {
      var out = [];
      BASES.forEach(function (b) { var m = makerOf(b); if (m && out.indexOf(m) === -1) out.push(m); });
      return out.sort();
    };
    // x: a run, setup, row or base; suite and extra as C.modelUrl's ({ variant, deployment, mode })
    D.modelUrl = function (x, suite, extra) { var base = baseOf(x); return modelUrl(makerOf(base), base, suite, extra); };

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
      // ---- Variants in this suite ----

      // The answer-changing dimensions a model's variants can differ on in a mode: weights and
      // reasoning, and the harness when the catalog gives the mode more than one
      S.variantDims = function (mode) {
        return ['weights', 'reasoning'].concat(S.modeInfo(mode).harnesses.length > 1 ? ['harness'] : []);
      };
      // A variant's cell on one task, pooled over its setups ({ all, counted, provisional }, as
      // S.cellOf's), optionally only the runs on one deployment (a key). null when there's no run.
      var pooledCache = {};
      S.variantCell = function (v, taskId, depKey) {
        v = variantOf(v);
        if (!v) return null;
        var ck = v.key + '\u0000' + taskId + '\u0000' + (depKey || '');
        if (pooledCache[ck] !== undefined) return pooledCache[ck];
        var out = { all: [], counted: [], provisional: [] };
        function keep(i) { return !depKey || DEPLOYMENT_OF_RUN[i.uuid].key === depKey; }
        v.cfgs.forEach(function (cfg) {
          var c = S.cellOf(cfg, taskId);
          if (!c) return;
          out.all = out.all.concat(c.all.filter(keep));
          out.counted = out.counted.concat(c.counted.filter(keep));
          out.provisional = out.provisional.concat(c.provisional.filter(keep));
        });
        out.all.sort(function (a, b) { return (b.run.started_at || '') < (a.run.started_at || '') ? -1 : 1; });
        return (pooledCache[ck] = out.all.length ? out : null);
      };
      // The mean of a variant's counted runs of a task, over all its deployments (its quality)
      S.variantMean = function (v, taskId) {
        var c = S.variantCell(v, taskId);
        return c && c.counted.length ? mean(c.counted.map(function (i) { return i.score; })) : null;
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
        return tierScoreBy(function (id) { return S.countedMean(cfg, id); }, tier, only);
      };
      // The same, with each task's score from meanOf(taskId) (a variant's pooled mean, say)
      function tierScoreBy(meanOf, tier, only) {
        var weights = V.taskWeights(tier);
        var total = 0, scoredWeight = 0, allWeight = 0, scores = [], n = 0;
        Object.keys(weights).forEach(function (id) {
          if (only && !only[id]) return;
          allWeight += weights[id];
          n += 1;
          var score = meanOf(id);
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

      // ---- Variants and deployments in this mode ----

      // A variant's quality, pooled over its deployments' counted runs by the same rules as a
      // setup's (V.stats): tier scores, gate verdicts, provisional scores, coverage and areas. No
      // time or cost: those belong to a deployment (V.deployments).
      var variantCache = {};
      V.variantStats = function (v) {
        v = variantOf(v);
        if (!v) return null;
        if (variantCache[v.key]) return variantCache[v.key];
        var meanOf = function (id) { return S.variantMean(v, id); };
        var active = orderedTasks.filter(function (t) { return t.status === 'active'; });
        var done = active.filter(function (t) { return meanOf(t.id) !== null; }).length;
        var progress = { done: done, total: active.length, share: active.length ? done / active.length : 0 };
        var tier = {}, verdict = {}, provisionalOf = {}, runs = 0;
        S.TIERS.forEach(function (t) {
          var result = tierScoreBy(meanOf, t.id);
          if (t.id === S.HEAD || t.role === 'gate') tier[t.id] = result;
          else {
            tier[t.id] = result.total ? result : null;
            var list = S.tasks.filter(function (x) { return inMode(x) && x.tier === t.id && x.status === 'provisional'; });
            var scores = list.map(function (x) { var val = cellValue(S.variantCell(v, x.id)); return val && val.agg ? val.agg.mean : null; });
            provisionalOf[t.id] = list.length ? { score: mean(scores), scored: scores.filter(function (s) { return s !== null; }).length, total: list.length } : null;
          }
          if (S.gateOf(t.id)) verdict[t.id] = gateVerdict(result, S.gateOf(t.id));
        });
        var ran = false;
        orderedTasks.forEach(function (t) {
          var c = S.variantCell(v, t.id);
          if (c) { ran = true; runs += c.counted.length; }
        });
        return (variantCache[v.key] = {
          variant: v, cfg: v.cfgs[0], cfgs: v.cfgs, local: v.local, ran: ran, tier: tier, verdict: verdict,
          provisional: provisionalOf, head: tier[S.HEAD], runs: runs, progress: progress,
          inProgress: !meets(progress.share, S.IN_PROGRESS_BELOW), label: rowLabel(v.cfgs[0]),
          areas: V.info.areas.map(function (a) { return V.variantAreaResult(v, a); })
        });
      };
      // A variant's result in one area: { area, tasks, n (tasks with a counted run), score (their
      // mean), coverage (n / tasks), pale (measured on fewer than half its tasks), ran (tasks with
      // any run), state: 'counted' | 'none-count' (it ran, nothing counts) | 'not-run' }
      V.variantAreaResult = function (v, area) {
        var list = orderedTasks.filter(function (t) { return t.area === area.id; });
        var means = list.map(function (t) { return S.variantMean(v, t.id); }).filter(function (x) { return x !== null; });
        var ran = list.filter(function (t) { return S.variantCell(v, t.id); }).length;
        return {
          area: area, tasks: list, n: means.length, score: mean(means), ran: ran,
          coverage: list.length ? means.length / list.length : 0, pale: means.length < list.length / 2,
          state: means.length ? 'counted' : ran ? 'none-count' : 'not-run'
        };
      };
      // Variants with a run in this mode, best first (S.betterConfig on pooled quality); `keep(v)`
      // filters them, e.g. by base: V.variants(function (v) { return v.base === base; })
      V.variants = function (keep) {
        var seen = {}, out = [];
        V.configs().forEach(function (cfg) {
          var v = VARIANT_OF_CFG[cfg.key];
          if (!v || seen[v.key] || (keep && !keep(v))) return;
          seen[v.key] = true;
          out.push(V.variantStats(v));
        });
        return out.filter(function (s) { return s.ran; }).sort(S.betterConfig);
      };
      // A model's variants in this mode (base: a base string, or a list of them)
      V.variantsOf = function (bases) {
        bases = [].concat(bases).map(baseOf);
        return V.variants(function (v) { return bases.indexOf(v.base) !== -1; });
      };

      // A variant's runs on this mode's tasks that are eligible to count (state 'counted', scored or
      // not), by task id, optionally on one deployment only
      function eligible(v, depKey) {
        var byTask = {};
        orderedTasks.forEach(function (t) {
          var c = S.variantCell(v, t.id, depKey);
          var list = c ? c.all.filter(function (i) { return i.state === 'counted'; }) : [];
          if (list.length) byTask[t.id] = list;
        });
        return byTask;
      }
      function finishedOf(list) { return list.filter(function (i) { return runOutcome(i.run) === 'finished'; }); }
      function costKindOf(dep) { return dep && dep.local ? 'electricity' : 'billed'; }

      // One deployment of a variant: { deployment, key, label, local, recorded, runs (eligible runs),
      // tasks, finished, timedOut, errors, time (median over tasks of each task's median finished
      // time), timeAll (the same over every run), cost { kind: 'electricity' | 'billed', value (mean
      // over tasks of each task's mean cost per run; null when none is known), n (runs with a cost) },
      // packager ("Packaged by …" or '') }
      V.deploymentStats = function (v, dep) {
        v = variantOf(v); dep = deploymentOf(dep);
        var byTask = eligible(v, dep.key), all = [];
        var taskTimes = [], taskTimesAll = [], taskCosts = [], costN = 0;
        Object.keys(byTask).forEach(function (id) {
          var list = byTask[id], fin = finishedOf(list);
          all = all.concat(list);
          taskTimes.push(median(fin.map(function (i) { return num(i.run.elapsed_s, null); })));
          taskTimesAll.push(median(list.map(function (i) { return num(i.run.elapsed_s, null); })));
          var costs = list.map(function (i) { return runCost(i.run); }).filter(function (c) { return c !== null; });
          costN += costs.length;
          taskCosts.push(mean(costs));
        });
        var count = function (k) { return all.filter(function (i) { return runOutcome(i.run) === k; }).length; };
        return {
          deployment: dep, key: dep.key, label: dep.label, local: dep.local, recorded: dep.recorded, variant: v,
          runs: all.length, tasks: Object.keys(byTask).length,
          finished: count('finished'), timedOut: count('timed_out'), errors: count('error'),
          time: median(taskTimes), timeAll: median(taskTimesAll),
          cost: { kind: costKindOf(dep), value: mean(taskCosts), n: costN },
          packager: D.packagedBy(v)
        };
      };
      // Every deployment a variant ran on in this mode: recorded ones first, most runs first; the
      // "machine not recorded" one last
      V.deployments = function (v) {
        v = variantOf(v);
        if (!v) return [];
        var keys = {};
        orderedTasks.forEach(function (t) {
          var c = S.variantCell(v, t.id);
          (c ? c.all : []).forEach(function (i) { if (i.state === 'counted') keys[DEPLOYMENT_OF_RUN[i.uuid].key] = true; });
        });
        return Object.keys(keys).map(function (k) { return V.deploymentStats(v, DEPLOYMENTS[k]); }).sort(function (a, b) {
          if (a.recorded !== b.recorded) return a.recorded ? -1 : 1;
          if (a.runs !== b.runs) return b.runs - a.runs;
          return a.label < b.label ? -1 : 1;
        });
      };

      // One side of a comparison: a setup (cfg, or a row/stats with .cfg) on its own recorded
      // deployment, or { variant, deployment } (objects or keys; deployment null pools every
      // recorded deployment). Runs on a deployment that isn't recorded are set aside in `unrecorded`.
      V.side = function (spec) {
        var cfg = spec && (spec.cfgs ? null : spec.cfg || (spec.key && CONFIGS[spec.key] === spec ? spec : null));
        var v = cfg ? VARIANT_OF_CFG[cfg.key] : variantOf(spec.variant);
        var dep = cfg ? deploymentOf(cfg) : spec.deployment ? deploymentOf(spec.deployment) : null;
        if (!v) return null;
        var all = {}, runs = {}, unrecorded = [];
        orderedTasks.forEach(function (t) {
          var c = cfg ? S.cellOf(cfg, t.id) : S.variantCell(v, t.id);
          (c ? c.all : []).forEach(function (i) {
            if (i.state !== 'counted') return;
            var d = DEPLOYMENT_OF_RUN[i.uuid];
            if (!d.recorded && (!dep || dep.recorded)) { unrecorded.push(i); return; }
            if (dep && d.key !== dep.key) return;
            (runs[t.id] = runs[t.id] || []).push(i);
          });
          all[t.id] = true;
        });
        return { V: V, variant: v, deployment: dep, cfg: cfg, runs: runs, unrecorded: unrecorded, label: rowLabel(v.cfgs[0]) };
      };
      V.pairedComparison = function (a, b) { return D.pairedComparison(a.V ? a : V.side(a), b.V ? b : V.side(b)); };

      // A/B candidates for a variant on one recorded deployment: the model's other variants on the
      // same deployment that differ in exactly one answer-changing setting and share a task.
      // [{ variant, dim, comparison }], fewest-dimension first in S.variantDims order.
      V.abCandidates = function (v, dep) {
        v = variantOf(v); dep = deploymentOf(dep);
        if (!v || !dep || !dep.recorded) return [];
        var dims = S.variantDims(modeId), a = V.side({ variant: v, deployment: dep });
        return V.variants(function (o) { return o.base === v.base && o !== v; }).map(function (s) {
          var diff = D.variantDiff(v, s.variant);
          if (diff.length !== 1 || dims.indexOf(diff[0]) === -1) return null;
          var cmp = D.pairedComparison(a, V.side({ variant: s.variant, deployment: dep }));
          return cmp.shared.length ? { variant: s.variant, dim: diff[0], comparison: cmp } : null;
        }).filter(Boolean).sort(function (x, y) { return dims.indexOf(x.dim) - dims.indexOf(y.dim); });
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

    // ---- Paired comparison: two sides, task by task ---------------------------

    // D.pairedComparison(a, b): two sides from V.side (the same view), compared on the tasks both
    // ran at the suite's task version (eligible runs). A run that didn't finish (timed out, harness
    // error) is reliability, not quality: it's listed in didNotFinish and left out of the task's
    // score; a task is in the score difference only when both sides have a finished, scored run of
    // it. Runs on a machine that wasn't recorded are never compared: they're listed in unrecorded.
    // The headline sentence follows rule 5 (C.MIN_PAIRED_TASKS, C.MAX_TASK_SHARE). Differences are
    // b minus a.
    D.pairedComparison = function (a, b) {
      var V = a.V, S = V.S;
      var differs = D.variantDiff(a.variant, b.variant);
      var dims = S.variantDims(V.mode);
      var sameVariant = a.variant === b.variant;
      var bothRecorded = !!(a.deployment && b.deployment && a.deployment.recorded && b.deployment.recorded);
      var sameDeployment = bothRecorded && a.deployment.key === b.deployment.key;
      var shared = [], pairs = [], dnf = { a: [], b: [] };
      function sideOf(list) {
        var fin = list.filter(function (i) { return runOutcome(i.run) === 'finished' && i.score !== null; });
        return {
          runs: list.length, finished: fin.length, entries: list,
          agg: agg(fin.map(function (i) { return i.score; })),
          score: fin.length ? mean(fin.map(function (i) { return i.score; })) : null,
          time: median(fin.map(function (i) { return num(i.run.elapsed_s, null); })),
          cost: mean(list.map(function (i) { return runCost(i.run); }))
        };
      }
      V.orderedTasks.forEach(function (t) {
        var ra = a.runs[t.id], rb = b.runs[t.id];
        if (t.status !== 'active' || !ra || !rb) return;
        shared.push(t);
        [['a', ra], ['b', rb]].forEach(function (p) {
          var bad = p[1].filter(function (i) { return runOutcome(i.run) !== 'finished'; });
          if (bad.length) dnf[p[0]].push({ task: t, k: bad.length, n: p[1].length, runs: bad });
        });
        var pa = sideOf(ra), pb = sideOf(rb);
        var counted = pa.score !== null && pb.score !== null;
        pairs.push({ task: t, a: pa, b: pb, counted: counted, diff: counted ? pb.score - pa.score : null });
      });
      var paired = pairs.filter(function (p) { return p.counted; });
      var n = paired.length, total = paired.reduce(function (s, p) { return s + p.diff; }, 0);
      var meanDiff = n ? total / n : null;
      var differing = paired.filter(function (p) { return Math.abs(p.diff) >= 0.05; });
      var driver = paired.slice().sort(function (x, y) { return Math.abs(y.diff) - Math.abs(x.diff); })[0] || null;
      var same = n > 0 && Math.abs(meanDiff) < 0.05;
      var reason = null;
      if (n < C.MIN_PAIRED_TASKS) reason = 'few-tasks';
      else if (!same && Math.abs(driver.diff) > C.MAX_TASK_SHARE * Math.abs(total)) reason = 'one-task';
      var headline = {
        allowed: !reason, reason: reason, n: n, k: differing.length, meanDiff: meanDiff, same: same,
        driver: reason === 'one-task' ? driver : null
      };

      // Speed and cost: only on the same recorded machine or provider (two variants there), or
      // between two recorded deployments of one variant; never with an unrecorded one
      var speedKind = !bothRecorded ? null : sameVariant && !sameDeployment ? 'deployments' : sameDeployment ? 'variants' : null;
      var ratios = paired.map(function (p) { return p.a.time && p.b.time ? p.b.time / p.a.time : null; });
      var speed = {
        comparable: !!speedKind, kind: speedKind,
        // local and cloud times are both wall-clock, but never on one unlabelled axis
        sameKind: bothRecorded && a.deployment.local === b.deployment.local,
        a: median(paired.map(function (p) { return p.a.time; })), b: median(paired.map(function (p) { return p.b.time; })),
        ratio: median(ratios),
        reason: speedKind ? null : !bothRecorded ? 'A machine or provider wasn\'t recorded, or a side pools several.' : 'Different variants on different deployments: a time difference can\'t be put down to either.'
      };
      var costKind = function (s) { return s.deployment ? s.deployment.costKind : null; };
      var cost = {
        a: { kind: costKind(a), value: mean(paired.map(function (p) { return p.a.cost; })) },
        b: { kind: costKind(b), value: mean(paired.map(function (p) { return p.b.cost; })) },
        sameKind: costKind(a) !== null && costKind(a) === costKind(b), comparable: !!speedKind && costKind(a) === costKind(b)
      };
      function reliability(side, key) {
        var all = [];
        pairs.forEach(function (p) { all = all.concat(p[key].entries); });
        var c = function (k) { return all.filter(function (i) { return runOutcome(i.run) === k; }).length; };
        return { runs: all.length, finished: c('finished'), timedOut: c('timed_out'), errors: c('error'), tasksNotFinished: dnf[key].length, tasks: shared.length };
      }
      function unrecordedList(side) {
        return side.unrecorded.map(function (i) {
          return {
            task: i.task, uuid: i.uuid, run: i.run, outcome: runOutcome(i.run), outcomeText: outcomeText(i.run),
            elapsed: num(i.run.elapsed_s, null), score: i.score, shared: shared.indexOf(i.task) !== -1,
            deployment: DEPLOYMENT_OF_RUN[i.uuid]
          };
        });
      }
      var labels = differs.map(function (d) { return D.dimension(d).label.toLowerCase(); });
      var out = {
        a: a, b: b, differs: differs, sameVariant: sameVariant, sameDeployment: sameDeployment,
        // Rule 2: an A/B is one answer-changing setting apart, on the same recorded deployment
        ab: differs.length === 1 && dims.indexOf(differs[0]) !== -1 && sameDeployment,
        note: differs.length > 1 ? 'These differ in ' + (labels.length > 2 ? labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1] : labels.join(' and ')) +
          ': a difference can\'t be put down to either.' : '',
        shared: shared, pairs: pairs, paired: paired, meanDiff: meanDiff, headline: headline,
        didNotFinish: dnf, reliability: { a: reliability(a, 'a'), b: reliability(b, 'b') },
        unrecorded: { a: unrecordedList(a), b: unrecordedList(b) }, speed: speed, cost: cost
      };
      // The summary sentence: a "scores X higher/lower" headline only when rule 5 allows it, else
      // "differ on k of n"; b is the subject
      out.sentence = function (nameA, nameB) {
        if (!n) return shared.length ? 'No task both finished, of the ' + shared.length + ' both ran.' : 'No task in common.';
        var on = ' on ' + n + ' shared finished task' + (n === 1 ? '' : 's');
        if (headline.allowed) {
          return same ? nameB + ' scores the same as ' + nameA + on + '.'
            : nameB + ' scores ' + Math.abs(meanDiff).toFixed(1) + (meanDiff > 0 ? ' higher' : ' lower') + ' than ' + nameA + ' on average' + on + '.';
        }
        return nameA + ' and ' + nameB + ' differ on ' + differing.length + ' of ' + n + ' shared finished task' + (n === 1 ? '' : 's') +
          (headline.driver ? ' (' + taskName(headline.driver.task) + ' accounts for most of the difference)' : '') + '.';
      };
      // "didn't finish on k of n" for side 'a' or 'b', '' when it finished every shared task
      out.dnfText = function (key) {
        var k = dnf[key].length;
        return k ? 'didn\'t finish on ' + k + ' of ' + shared.length : '';
      };
      return out;
    };

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

    // A small flag naming why a run doesn't count, its full reason as the title
    D.stateFlag = function (state) {
      var text = state === 'provisional' ? 'provisional' : state === 'older' ? 'older task version' : state === 'invalid' ? 'invalid' : 'not counted';
      return el('span', { class: 'crucible-flag', title: STATE_TEXT[state] || '' }, text);
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
        if (info.state !== 'counted') summary.appendChild(D.stateFlag(info.state));
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

    // A score record's per-check items grouped by check group (else by item): { values: group ->
    // share passed 0..1, order, titles }. index is D.loadDetails()'s; null when nothing's published.
    var groupCache = {};
    function runGroups(index, info) {
      if (!index || !info || !info.rec) return null;
      var key = scoreKey(info.uuid, info.rec.rubric_version, info.rec.method);
      if (groupCache[key] !== undefined) return groupCache[key];
      var rec = index[key];
      if (!rec || !rec.items || !rec.items.length) return (groupCache[key] = null);
      var sums = {}, order = [], titles = {};
      rec.items.forEach(function (it) {
        var k = String(it.group || it.label || it.id || '');
        if (!k) return;
        var v = typeof it.share === 'number' ? it.share : it.passed ? 1 : 0;
        if (!sums[k]) { sums[k] = []; order.push(k); titles[k] = it.label || k; }
        sums[k].push(v);
      });
      var out = { values: {}, order: order, titles: titles };
      order.forEach(function (k) { out.values[k] = mean(sums[k]); });
      return (groupCache[key] = out);
    }

    D.promptBlock = promptBlock;
    D.renderItems = renderItems;
    D.runGroups = runGroups;
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
      var b = C.scoreButton(a ? a.mean : null, s.label + ' ' + taskName(t) + ': ' + (a ? fmtScore(a.mean) + ', ' + fmtRepeat(a) : 'doesn\'t count in this suite'),
        { text: text, n: a ? a.n : 0, cls: narrowCell ? 'crucible-card-score' : '' });
      b.title = a ? fmtScore(a.mean) + ' · ' + fmtRepeat(a) : (STATE_TEXT[c.all[0].state] || '');
      if (c.all.some(function (i) { return i.run.outcome && i.run.outcome.timed_out; })) b.classList.add('is-timeout');
      return b;
    };

    // ---- Names that link: maker, model, 'maker / model' ----------------------

    // The maker of x (a run, setup, row or base) linked to its publisher page, with the inferred
    // marker when it was taken from the model name. opts: { sep: text after it, unknown: show
    // "unknown maker" when nothing says (else null) }
    D.makerNode = function (x, opts) {
      opts = opts || {};
      var info = makerInfo(x);
      if (!info.id && !opts.unknown) return null;
      var span = el('span', { class: 'crucible-maker' });
      if (info.id) span.appendChild(el('a', { href: publisherUrl(info.id), class: 'crucible-maker-link' }, makerLabel(info.id)));
      else span.appendChild(el('span', { class: 'crucible-maker-unknown' }, makerLabel(null)));
      if (info.id && info.inferred) span.appendChild(C.inferredMark());
      if (opts.sep) span.appendChild(document.createTextNode(opts.sep));
      return span;
    };
    // A row's (or setup's) model name, linked to its model page; never breaks inside the slug
    function labelOf(x) { return x.label || rowLabel(x.cfg || x); }
    D.modelLink = function (x, suffix) {
      var a = el('a', { href: D.modelUrl(x.cfg || x), class: 'crucible-model-link' });
      a.appendChild(nameNode(labelOf(x), suffix));
      return a;
    };
    // 'maker / model': nothing before the model when no maker is known
    D.modelRef = function (x, suffix) {
      var span = el('span', { class: 'crucible-model-ref' });
      var maker = D.makerNode(x.cfg || x, { sep: ' / ' });
      if (maker) span.appendChild(maker);
      span.appendChild(D.modelLink(x, suffix));
      return span;
    };
    // A card headed by a row's maker / model, where tag and setup
    D.modelCard = function (s, ul) {
      var li = ul.appendChild(el('li', { class: 'crucible-card' }));
      var title = li.appendChild(el('div', { class: 'crucible-card-title' }));
      title.appendChild(D.modelRef(s));
      title.appendChild(whereTag(s.cfg));
      li.appendChild(el('p', { class: 'crucible-config-line' }, configLabel(s.cfg)));
      return li;
    };

    // ---- Suite bar -----------------------------------------------------------

    // Fills a page's suite bar (#suite-select, #suite-select-label, #suite-line, #suite-note) for S:
    // the selector only when two or more suites are visible; the line always
    D.renderSuiteBar = function (S) {
      var select = document.getElementById('suite-select'), label = document.getElementById('suite-select-label');
      if (select) {
        select.hidden = SUITES.length < 2;
        if (label) label.hidden = SUITES.length < 2;
        fillSelect(select, SUITES.map(function (c) {
          return { value: suiteId(c), label: suiteName(c) + (c.suite.status === 'current' ? ' (current)' : '') };
        }), S.id);
      }
      var line = document.getElementById('suite-line');
      if (line) {
        line.innerHTML = '';
        var cat = S.cat, suite = cat.suite;
        var active = S.tasks.filter(function (t) { return t.status === 'active'; }).length;
        var parts = [suiteName(cat) + (suite.version ? ' (version ' + suite.version + ')' : ''), active + ' scored tasks'];
        if (suite.cut_at) parts.push('cut ' + fmtDate(suite.cut_at));
        line.appendChild(document.createTextNode(parts.join(' · ')));
        if (suite.changelog_url && /^(https?:|\/)/i.test(suite.changelog_url)) {
          line.appendChild(document.createTextNode(' · '));
          line.appendChild(el('a', { href: suite.changelog_url, rel: 'noopener' }, 'What changed'));
        }
      }
      var note = document.getElementById('suite-note');
      if (note) {
        note.textContent = S.cat.suite.status === 'current' || S.cat === D.CURRENT ? ''
          : 'A past suite: its own tasks, tiers and weights, and only the runs that count in it (a run counts in every suite that pins its task at the version it ran).';
        note.hidden = !note.textContent;
      }
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
