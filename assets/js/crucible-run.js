// Crucible runs page: show all recent runs as cards
// Each card shows: year, base model, version, reasoning, quant, inference
// Clicking a card navigates to the test detail page with that run active

(function () {
  'use strict';

  var C = window.CrucibleCore;
  if (!C || !C.boot) {
    console.error('CrucibleCore not loaded');
    return;
  }

  // Configuration
  var OUTPUTS_BASE = '/crucible-data/';
  var DETAILS_PAGE = '/crucible/task/';
  var script = document.currentScript;

  // State
  var D = null;
  var currentSuite = null;
  var currentSort = 'date-desc';
  var currentFilter = 'all';

  // DOM elements
  var statusEl, resultsEl, suiteSelect, suiteLine, suiteNote, sortSelect, filterSelect, gridEl, countEl;

  function start(D_override) {
    D = D_override;
    init();
  }

  function init() {
    statusEl = document.getElementById('crucible-status');
    resultsEl = document.getElementById('crucible-results');
    suiteSelect = document.getElementById('suite-select');
    suiteLine = document.getElementById('suite-line');
    suiteNote = document.getElementById('suite-note');
    sortSelect = document.getElementById('run-sort');
    filterSelect = document.getElementById('run-filter');
    gridEl = document.getElementById('crucible-run-grid');
    countEl = document.getElementById('run-count');

    // Initialize suite selector
    var suites = D.SUITES || [];
    var suiteOptions = suites.map(function (s) {
      return { value: D.suiteId(s), label: C.suiteName(s) };
    });
    C.fillSelect(suiteSelect, suiteOptions, D.suiteId(D.CURRENT));

    currentSuite = D.suiteId(D.CURRENT);

    suiteSelect.addEventListener('change', function () {
      currentSuite = suiteSelect.value;
      renderRuns();
    });

    sortSelect.addEventListener('change', function () {
      currentSort = sortSelect.value;
      renderRuns();
    });

    filterSelect.addEventListener('change', function () {
      currentFilter = filterSelect.value;
      renderRuns();
    });

    // Update suite line
    updateSuiteLine();

    // Show results and render runs
    statusEl.hidden = true;
    resultsEl.hidden = false;
    renderRuns();
  }

  function updateSuiteLine() {
    var suite = D.catalogById(currentSuite);
    if (suite && suite.catalog) {
      var cat = suite.catalog;
      suiteLine.textContent = D.suiteName(suite) + ': ' + (cat.description || '');
    }
  }

  function getFilteredRuns() {
    var allRuns = Object.values(D.store.runs || {});
    var suite = D.catalogById(currentSuite);
    var catalog = suite && suite.catalog;

    // Filter by suite if needed
    if (catalog) {
      var suiteTasks = new Set((catalog.tasks || []).map(function (t) { return t.id; }));
      allRuns = allRuns.filter(function (r) {
        return suiteTasks.has(r.task && r.task.id);
      });
    }

    // Apply filter
    var filtered = allRuns.filter(function (r) {
      if (currentFilter === 'all') return true;
      if (currentFilter === 'finished') {
        return r.outcome && (r.outcome.status === 'completed' || r.outcome.status === 'ok');
      }
      if (currentFilter === 'timeout') {
        return r.outcome && r.outcome.timed_out;
      }
      if (currentFilter === 'error') {
        return r.outcome && (r.outcome.status === 'error' || r.outcome.status === 'failed');
      }
      return true;
    });

    return filtered;
  }

  function sortRuns(runs) {
    var sorted = runs.slice();

    sorted.sort(function (a, b) {
      switch (currentSort) {
        case 'date-desc':
          return (b.started_at || '') > (a.started_at || '') ? 1 : -1;
        case 'date-asc':
          return (a.started_at || '') < (b.started_at || '') ? 1 : -1;
        case 'model':
          var aModel = (a.model && a.model.base) || (a.model && a.model.id) || '';
          var bModel = (b.model && b.model.base) || (b.model && b.model.id) || '';
          return aModel < bModel ? -1 : aModel > bModel ? 1 : 0;
        case 'score-desc':
          var aScore = getBestScore(a);
          var bScore = getBestScore(b);
          return (bScore !== null && aScore !== null) ? (bScore - aScore) : 
                 (bScore !== null ? 1 : aScore !== null ? -1 : 0);
        case 'score-asc':
          var aScore2 = getBestScore(a);
          var bScore2 = getBestScore(b);
          return (aScore2 !== null && bScore2 !== null) ? (aScore2 - bScore2) : 
                 (aScore2 !== null ? 1 : bScore2 !== null ? -1 : 0);
        default:
          return 0;
      }
    });

    return sorted;
  }

  function getBestScore(run) {
    // Get the best score for this run across all score records
    var scores = D.store.scoresByRun && D.store.scoresByRun[run.run_uuid];
    if (!scores) return null;
    
    var validScores = scores.filter(function (s) {
      return s.record === 'score' && typeof s.score === 'number';
    });
    if (validScores.length === 0) return null;
    return Math.max.apply(null, validScores.map(function (s) { return s.score; }));
  }

  function renderRuns() {
    var runs = getFilteredRuns();
    var sorted = sortRuns(runs);

    gridEl.innerHTML = '';

    if (sorted.length === 0) {
      gridEl.appendChild(C.el('p', { class: 'crucible-run-empty' }, 'No runs found.'));
      countEl.textContent = '';
      return;
    }

    sorted.forEach(function (run) {
      var card = createRunCard(run);
      gridEl.appendChild(card);
    });

    countEl.textContent = sorted.length + ' run' + (sorted.length === 1 ? '' : 's') + ' shown';
  }

  function createRunCard(run) {
    var model = run.model || {};
    var endpoint = run.endpoint || {};
    var outcome = run.outcome || {};
    var task = run.task || {};

    // Extract year from started_at
    var year = '';
    if (run.started_at) {
      try {
        var date = new Date(run.started_at);
        year = date.getFullYear();
      } catch (e) {
        year = run.started_at.slice(0, 4);
      }
    }

    // Base model
    var baseModel = model.base || model.id || 'Unknown';
    // Extract just the model name (after last /)
    var modelName = baseModel.split('/').pop();

    // Version (task version)
    var version = task.version !== null && task.version !== undefined ? 'v' + task.version : 'N/A';

    // Reasoning
    var reasoning = (model.reasoning && model.reasoning.requested) || 'default';
    if (model.reasoning && model.reasoning.resolved) {
      reasoning += ' (' + model.reasoning.resolved + ')';
    }

    // Quant
    var quant = model.quant || 'N/A';

    // Inference (where + provider)
    var inference = '';
    if (endpoint.where) {
      inference = C.cap(endpoint.where);
    }
    if (endpoint.provider) {
      if (inference) inference += ' / ';
      inference += endpoint.provider;
    }
    if (!inference) {
      inference = 'N/A';
    }

    // Outcome status for visual indicator
    var statusClass = 'crucible-run-status-';
    if (outcome.timed_out) {
      statusClass += 'timeout';
    } else if (outcome.status === 'completed' || outcome.status === 'ok') {
      statusClass += 'finished';
    } else if (outcome.status === 'error' || outcome.status === 'failed') {
      statusClass += 'error';
    } else if (outcome.status === 'TIMEOUT') {
      statusClass += 'timeout';
    } else {
      statusClass += 'unknown';
    }

    // Score
    var score = getBestScore(run);
    var scoreEl = score !== null ? C.el('span', { class: 'crucible-run-score' }, score.toFixed(1)) : 
                   C.el('span', { class: 'crucible-run-score crucible-run-score-none' }, '\u2014');

    // Create card
    var card = C.el('article', { class: 'crucible-run-card', 'data-run-uuid': run.run_uuid });

    // Status indicator
    var statusIndicator = C.el('div', { class: 'crucible-run-status ' + statusClass });
    card.appendChild(statusIndicator);

    // Main content
    var content = C.el('div', { class: 'crucible-run-content' });

    // Header with model and score
    var header = C.el('div', { class: 'crucible-run-header' });
    var modelSpan = C.el('span', { class: 'crucible-run-model' }, modelName);
    header.appendChild(modelSpan);
    var scoreWrap = C.el('span', { class: 'crucible-run-score-wrap' });
    scoreWrap.appendChild(scoreEl);
    header.appendChild(scoreWrap);
    content.appendChild(header);

    // Year
    var yearEl = C.el('div', { class: 'crucible-run-field' });
    yearEl.appendChild(C.el('span', { class: 'crucible-run-field-label' }, 'Year:'));
    yearEl.appendChild(C.el('span', { class: 'crucible-run-field-value' }, year));
    content.appendChild(yearEl);

    // Base model
    var baseEl = C.el('div', { class: 'crucible-run-field' });
    baseEl.appendChild(C.el('span', { class: 'crucible-run-field-label' }, 'Base:'));
    baseEl.appendChild(C.el('span', { class: 'crucible-run-field-value' }, baseModel));
    content.appendChild(baseEl);

    // Version
    var versionEl = C.el('div', { class: 'crucible-run-field' });
    versionEl.appendChild(C.el('span', { class: 'crucible-run-field-label' }, 'Version:'));
    versionEl.appendChild(C.el('span', { class: 'crucible-run-field-value' }, version));
    content.appendChild(versionEl);

    // Reasoning
    var reasoningEl = C.el('div', { class: 'crucible-run-field' });
    reasoningEl.appendChild(C.el('span', { class: 'crucible-run-field-label' }, 'Reasoning:'));
    reasoningEl.appendChild(C.el('span', { class: 'crucible-run-field-value' }, reasoning));
    content.appendChild(reasoningEl);

    // Quant
    var quantEl = C.el('div', { class: 'crucible-run-field' });
    quantEl.appendChild(C.el('span', { class: 'crucible-run-field-label' }, 'Quant:'));
    quantEl.appendChild(C.el('span', { class: 'crucible-run-field-value' }, quant));
    content.appendChild(quantEl);

    // Inference
    var inferenceEl = C.el('div', { class: 'crucible-run-field' });
    inferenceEl.appendChild(C.el('span', { class: 'crucible-run-field-label' }, 'Inference:'));
    inferenceEl.appendChild(C.el('span', { class: 'crucible-run-field-value' }, inference));
    content.appendChild(inferenceEl);

    // Task name
    var taskEl = C.el('div', { class: 'crucible-run-task' });
    taskEl.appendChild(C.el('span', { class: 'crucible-run-task-label' }, 'Task:'));
    taskEl.appendChild(C.el('span', { class: 'crucible-run-task-value' }, task.id || 'Unknown'));
    content.appendChild(taskEl);

    // Date
    var dateEl = C.el('div', { class: 'crucible-run-date' });
    if (run.started_at) {
      try {
        var date = new Date(run.started_at);
        dateEl.appendChild(document.createTextNode(C.fmtDate(date)));
      } catch (e) {
        dateEl.appendChild(document.createTextNode(run.started_at.slice(0, 10)));
      }
    }
    content.appendChild(dateEl);

    card.appendChild(content);

    // Click handler - navigate to task page
    card.addEventListener('click', function () {
      var taskId = task.id || '';
      var runUuid = run.run_uuid;
      // Navigate to task page with task ID in hash
      // The task page uses hash for task ID: /crucible/task/#<task-id>
      // We add the run UUID as a query parameter
      window.location.href = DETAILS_PAGE + '?run=' + encodeURIComponent(runUuid) + '#' + encodeURIComponent(taskId);
    });

    return card;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      C.boot({ script: script, ready: start });
    });
  } else {
    C.boot({ script: script, ready: start });
  }
})();
