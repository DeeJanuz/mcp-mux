// @ts-nocheck
/* Structured data table renderer — tabular data with hierarchical rows,
 * change tracking, sort/filter, and review mode with per-row/column
 * accept/reject and cell editing.
 *
 * Data shape:
 * {
 *   title: "Optional",
 *   tables: [{
 *     id: "t1",
 *     name: "Table Name",
 *     columns: [{ id: "c1", name: "Col", change: null|"add"|"delete" }],
 *     rows: [{
 *       id: "r1",
 *       cells: { "c1": { value: "v", change: null|"add"|"delete"|"update" } },
 *       children: []
 *     }]
 *   }]
 * }
 */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  var utils = window.__companionUtils || {};
  var escapeHtml = utils.escapeHtml || function (s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  };

  var sdu = window.__structuredDataUtils || {};
  var getCellValue = sdu.getCellValue;
  var getCellChange = sdu.getCellChange;
  var flattenRows = sdu.flattenRows;
  var sortRows = sdu.sortRows;
  var filterRows = sdu.filterRows;
  var createTableState = sdu.createTableState;
  var setAllRowDecisions = sdu.setAllRowDecisions;
  var buildDecisionPayload = sdu.buildDecisionPayload;
  var applyBulkDecision = sdu.applyBulkDecision;
  var buildCsvString = sdu.buildCsvString;
  var normalizeStructuredData = sdu.normalizeStructuredData || function (value) { return value; };
  var summarizeDecisionState = sdu.summarizeDecisionState || function () {
    return { totalRows: 0, decidedRows: 0, pendingRows: 0, complete: false };
  };
  var reviewDrafts = window.__structuredDataReviewDrafts || {};
  window.__structuredDataReviewDrafts = reviewDrafts;

  // ── 1. CSS Injection ──

  function injectStyles() {
    if (document.getElementById('structured-data-styles')) return;
    var style = document.createElement('style');
    style.id = 'structured-data-styles';
    style.textContent = [
      '.sd-container { background: var(--glass-bg-heavy); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); border-radius: var(--border-radius-lg); padding: var(--space-4); margin-bottom: var(--space-4); box-shadow: var(--glass-shadow); overflow-x: auto; }',
      '.sd-title { font-family: var(--font-sans); font-size: 18px; font-weight: var(--weight-semibold); color: var(--text-primary); margin: 0 0 var(--space-3) 0; }',
      '.sd-filter { font-family: var(--font-sans); font-size: var(--text-body); color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--border-radius-sm); padding: var(--space-1) var(--space-2); margin-bottom: var(--space-3); width: 100%; box-sizing: border-box; }',
      '.sd-filter:focus { outline: none; border-color: var(--color-info); }',
      '.sd-table { width: max-content; table-layout: fixed; border-collapse: collapse; font-family: var(--font-sans); font-size: var(--text-body); }',
      '.sd-th { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 2px solid var(--border-default); color: var(--text-secondary); font-weight: var(--weight-semibold); font-size: var(--text-small); cursor: pointer; user-select: none; white-space: nowrap; min-width: 180px; max-width: 440px; }',
      '.sd-th:hover { color: var(--text-primary); }',
      '.sd-td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-subtle); color: var(--text-primary); vertical-align: top; min-width: 180px; max-width: 440px; overflow-wrap: anywhere; }',
      '.sd-th[data-column-id="subject"], .sd-td[data-column-id="subject"], .sd-th[data-column-id="title"], .sd-td[data-column-id="title"], .sd-th[data-column-id="name"], .sd-td[data-column-id="name"], .sd-th[data-column-id="target"], .sd-td[data-column-id="target"] { min-width: 260px; max-width: 520px; }',
      '.sd-th[data-column-id="summary"], .sd-td[data-column-id="summary"], .sd-th[data-column-id="description"], .sd-td[data-column-id="description"], .sd-th[data-column-id="details"], .sd-td[data-column-id="details"], .sd-th[data-column-id="reason"], .sd-td[data-column-id="reason"], .sd-th[data-column-id="rationale"], .sd-td[data-column-id="rationale"], .sd-th[data-column-id="snippet"], .sd-td[data-column-id="snippet"] { min-width: 340px; max-width: 620px; }',
      '.sd-th[data-column-id="from"], .sd-td[data-column-id="from"], .sd-th[data-column-id="sender"], .sd-td[data-column-id="sender"], .sd-th[data-column-id="account"], .sd-td[data-column-id="account"], .sd-th[data-column-id="email"], .sd-td[data-column-id="email"] { min-width: 220px; max-width: 420px; }',
      '.sd-th[data-column-id="date"], .sd-td[data-column-id="date"], .sd-th[data-column-id="received"], .sd-td[data-column-id="received"], .sd-th[data-column-id="timestamp"], .sd-td[data-column-id="timestamp"] { min-width: 190px; max-width: 280px; }',
      '.sd-th[data-column-id="decision"], .sd-td[data-column-id="decision"] { width: 82px; min-width: 82px; max-width: 82px; box-sizing: border-box; text-align: center; position: sticky; left: 24px; z-index: 2; background: var(--glass-bg-heavy); box-shadow: 1px 0 0 var(--border-subtle); }',
      '.sd-table:not([data-has-toggle-spacer="true"]) .sd-th[data-column-id="decision"], .sd-table:not([data-has-toggle-spacer="true"]) .sd-td[data-column-id="decision"] { left: 0; }',
      '.sd-th[data-column-id="decision"] { z-index: 4; }',
      '.sd-th[data-column-id="decision"], .sd-td[data-column-id="decision"] { padding-left: 10px; padding-right: 10px; }',
      '.sd-td[data-column-id="decision"] .sd-decision-toggle { gap: 4px; margin-left: 0; }',
      '.sd-td[data-column-id="decision"] .sd-decision-toggle button { width: 24px; min-width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; }',
      '.sd-cell-add { background: var(--color-success-bg); color: var(--color-success-text); }',
      '.sd-cell-delete { background: var(--color-error-bg); color: var(--color-error-text); text-decoration: line-through; }',
      '.sd-cell-update { background: var(--color-warning-bg); color: var(--color-warning-text); }',
      '.sd-cell-edited { background: var(--color-info-bg); color: var(--color-info-text); }',
      '.sd-col-add { border-bottom-color: var(--color-success) !important; color: var(--color-success-text); }',
      '.sd-col-delete { border-bottom-color: var(--color-error) !important; color: var(--color-error-text); text-decoration: line-through; }',
      '.sd-col-rejected { opacity: 0.4; }',
      '.sd-expand-toggle { cursor: pointer; border: none; background: transparent; color: var(--text-secondary); font-size: var(--text-small); padding: 0 var(--space-1); line-height: 1; }',
      '.sd-expand-toggle:hover { color: var(--text-primary); }',
      '.sd-depth-0 { padding-left: var(--space-3); }',
      '.sd-depth-1 { padding-left: calc(var(--space-3) + 16px); }',
      '.sd-depth-2 { padding-left: calc(var(--space-3) + 32px); }',
      '.sd-depth-3 { padding-left: calc(var(--space-3) + 48px); }',
      '.sd-depth-4 { padding-left: calc(var(--space-3) + 64px); }',
      '.sd-depth-5 { padding-left: calc(var(--space-3) + 80px); }',
      '.sd-sort-indicator { margin-left: var(--space-1); font-size: var(--text-xs); color: var(--text-tertiary); }',
      '.sd-decision-toggle { display: inline-flex; gap: 2px; margin-left: var(--space-2); }',
      '.sd-decision-toggle button { font-size: var(--text-xs); padding: 2px 6px; border: 1px solid var(--border-default); border-radius: var(--border-radius-sm); cursor: pointer; background: var(--bg-surface); color: var(--text-secondary); }',
      '.sd-decision-toggle[data-decision-state="undecided"] button { background: var(--bg-surface-subtle); color: var(--text-tertiary); border-color: var(--border-subtle); }',
      '.sd-decision-toggle[data-decision-state="undecided"] button:hover { color: var(--text-secondary); border-color: var(--border-default); }',
      '.sd-decision-accept { background: var(--color-success-bg) !important; color: var(--color-success-text) !important; border-color: var(--color-success) !important; }',
      '.sd-decision-reject { background: var(--color-error-bg) !important; color: var(--color-error-text) !important; border-color: var(--color-error) !important; }',
      '.sd-submit-bar { position: sticky; top: 0; z-index: var(--z-sticky); background: var(--glass-bg-heavy); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); padding: var(--space-3) var(--space-4); display: flex; gap: var(--space-2); justify-content: flex-end; align-items: center; margin: 0 0 var(--space-3); border-radius: var(--border-radius-lg); }',
      '.sd-submit-bar[data-submit-state="submitting"], .sd-submit-bar[data-submit-state="submitted"] { justify-content: space-between; }',
      '.sd-submit-status { margin-right: auto; font-family: var(--font-sans); font-size: var(--text-small); color: var(--text-secondary); }',
      '.sd-submit-bar[data-submit-state="submitted"] .sd-submit-status { color: var(--color-success-text); }',
      '.sd-submit-bar[data-submit-state="error"] .sd-submit-status { color: var(--color-error-text); }',
      '.sd-submit-bar button:disabled, .sd-container[data-review-submitted="true"] button:disabled { opacity: 0.65; cursor: default; }',
      '.sd-cell-editor { font-family: var(--font-sans); font-size: var(--text-body); line-height: 1.4; color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--color-info); border-radius: var(--border-radius-sm); padding: var(--space-2); width: 100%; min-height: 132px; max-height: 48vh; box-sizing: border-box; outline: none; resize: vertical; overflow: auto; white-space: pre-wrap; }',
      '.sd-empty { font-family: var(--font-sans); font-size: var(--text-body); color: var(--text-tertiary); padding: var(--space-6); text-align: center; }',
      '.sd-loading, .sd-efficiency-warning, .sd-dataref-warning { font-family: var(--font-sans); font-size: var(--text-small); padding: var(--space-3); border-radius: var(--border-radius-sm); margin-bottom: var(--space-3); }',
      '.sd-instruction-template { font-family: var(--font-sans); font-size: var(--text-small); color: var(--text-secondary); background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: var(--border-radius-sm); padding: var(--space-3); margin-bottom: var(--space-3); white-space: pre-wrap; }',
      '.sd-loading { color: var(--text-secondary); background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); }',
      '.sd-efficiency-warning, .sd-dataref-warning { color: var(--color-warning-text); background: var(--color-warning-bg); border: 1px solid var(--color-warning); }',
      '.sd-row-rejected { opacity: 0.4; }',
      '.sd-row-rejected .sd-td { background: var(--bg-surface-subtle); color: var(--text-tertiary); }',
      '.sd-table-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2); }',
      '.sd-table-name { font-family: var(--font-sans); font-size: var(--text-body); font-weight: var(--weight-medium); color: var(--text-secondary); margin: 0; }',
      '.sd-csv-btn { flex-shrink: 0; padding: var(--space-1) var(--space-2); font-size: var(--text-xs); font-family: var(--font-sans); color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--border-radius-sm); cursor: pointer; transition: background 0.15s, color 0.15s; }',
      '.sd-csv-btn:hover { color: var(--text-primary); background: var(--bg-surface-inset); }',
      '.sd-csv-btn-copied { background: var(--color-success-bg) !important; color: var(--color-success-text) !important; border-color: var(--color-success) !important; }',
      '.sd-toggle-spacer { width: 24px; min-width: 24px; max-width: 24px; }',
      '.sd-th.sd-toggle-spacer, .sd-td.sd-toggle-spacer { position: sticky; left: 0; z-index: 3; background: var(--glass-bg-heavy); }',
      '.sd-th.sd-toggle-spacer { z-index: 5; }',
      '.sd-legend { display: flex; gap: var(--space-4); flex-wrap: wrap; margin-bottom: var(--space-3); font-family: var(--font-sans); font-size: var(--text-xs); color: var(--text-secondary); }',
      '.sd-legend-item { display: inline-flex; align-items: center; gap: var(--space-1); }',
      '.sd-legend-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── 2. Table Builders — Read-Only ──

  function buildSortIndicator(colId, state) {
    var span = document.createElement('span');
    span.className = 'sd-sort-indicator';
    if (state.sortColumn === colId) {
      span.textContent = state.sortDirection === 'asc' ? '\u25B2' : '\u25BC';
    } else {
      span.textContent = '\u2195';
    }
    return span;
  }

  function buildExpandToggle(rowId, hasChildren, isExpanded, rerenderFn) {
    if (!hasChildren) {
      var spacer = document.createElement('span');
      spacer.className = 'sd-toggle-spacer';
      spacer.innerHTML = '&nbsp;';
      return spacer;
    }
    var btn = document.createElement('button');
    btn.className = 'sd-expand-toggle';
    btn.textContent = isExpanded ? '\u25BC' : '\u25B6';
    btn.addEventListener('click', function () {
      rerenderFn(function (state) {
        if (state.expandedRows.has(rowId)) {
          state.expandedRows.delete(rowId);
        } else {
          state.expandedRows.add(rowId);
        }
      });
    });
    return btn;
  }

  function getDecisionState(decision) {
    if (decision === 'accept' || decision === 'reject') return decision;
    return 'undecided';
  }

  function toggleDecisionState(state, key, decision) {
    if (getDecisionState(state.decisions[key]) === decision) {
      delete state.decisions[key];
      return;
    }
    state.decisions[key] = decision;
  }

  function shortLabel(value, fallback) {
    var text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) text = fallback || 'item';
    return text.length > 96 ? text.slice(0, 93) + '...' : text;
  }

  function getRowReviewLabel(row, columns) {
    if (!row || !row.cells) return 'row';
    var preferredIds = ['subject', 'title', 'name', 'summary', 'from', 'account'];
    for (var i = 0; i < preferredIds.length; i += 1) {
      var preferred = preferredIds[i];
      if (row.cells[preferred]) {
        return shortLabel(getCellValue(row, preferred, preferred), row.id || 'row');
      }
    }
    columns = columns || [];
    for (var colIndex = 0; colIndex < columns.length; colIndex += 1) {
      var col = columns[colIndex];
      var value = getCellValue(row, col.id, col.name);
      if (String(value || '').trim()) return shortLabel(value, row.id || 'row');
    }
    return shortLabel(row.id, 'row');
  }

  function getTableReviewLabel(tableData) {
    return shortLabel((tableData && (tableData.name || tableData.id)) || 'table', 'table');
  }

  function getReviewScopeLabel(tables, title) {
    if (title) return shortLabel(title, 'review');
    if (!tables || !tables.length) return 'review';
    if (tables.length === 1) return getTableReviewLabel(tables[0]);
    return shortLabel(tables.length + ' tables', 'review');
  }

  function buildDecisionToggle(key, state, rerenderFn, opts) {
    opts = opts || {};
    var wrapper = document.createElement('span');
    wrapper.className = 'sd-decision-toggle';
    var currentDecision = getDecisionState(state.decisions[key]);
    wrapper.setAttribute('data-decision-state', currentDecision);
    wrapper.setAttribute('data-decision-key', key);

    var acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.textContent = '\u2713';
    acceptBtn.title = opts.acceptTitle || 'Accept';
    acceptBtn.setAttribute('aria-label', opts.acceptAriaLabel || opts.acceptTitle || 'Accept');
    acceptBtn.setAttribute('aria-pressed', currentDecision === 'accept' ? 'true' : 'false');
    acceptBtn.setAttribute('data-decision-key', key);
    acceptBtn.setAttribute('data-decision-action', 'accept');
    if (currentDecision === 'accept') acceptBtn.classList.add('sd-decision-accept');
    acceptBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDecisionState(state, key, 'accept');
      rerenderFn();
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.textContent = '\u2717';
    rejectBtn.title = opts.rejectTitle || 'Reject';
    rejectBtn.setAttribute('aria-label', opts.rejectAriaLabel || opts.rejectTitle || 'Reject');
    rejectBtn.setAttribute('aria-pressed', currentDecision === 'reject' ? 'true' : 'false');
    rejectBtn.setAttribute('data-decision-key', key);
    rejectBtn.setAttribute('data-decision-action', 'reject');
    if (currentDecision === 'reject') rejectBtn.classList.add('sd-decision-reject');
    rejectBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDecisionState(state, key, 'reject');
      rerenderFn();
    });

    wrapper.appendChild(acceptBtn);
    wrapper.appendChild(rejectBtn);
    return wrapper;
  }

  function clonePlainObject(value) {
    var source = value && typeof value === 'object' ? value : {};
    return Object.keys(source).reduce(function (next, key) {
      next[key] = source[key];
      return next;
    }, {});
  }

  function getReviewDraftKey(data, meta, toolArgs) {
    meta = meta && typeof meta === 'object' ? meta : {};
    toolArgs = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};
    var key = meta.humanInputId ||
      meta.reviewSessionId ||
      meta.sessionId ||
      toolArgs.humanInputId ||
      toolArgs.reviewSessionId ||
      toolArgs.session_id ||
      data && (data.reviewSessionId || data.sessionId || data.session_id);
    return key ? String(key) : '';
  }

  function hydrateReviewDraft(states, draft) {
    if (!draft || !draft.tables) return;
    Object.keys(states).forEach(function (tableId) {
      var tableDraft = draft.tables[tableId];
      if (!tableDraft) return;
      states[tableId].decisions = clonePlainObject(tableDraft.decisions);
      states[tableId].modifications = clonePlainObject(tableDraft.modifications);
    });
  }

  function persistReviewDraft(key, states) {
    if (!key) return;
    var tables = {};
    Object.keys(states || {}).forEach(function (tableId) {
      tables[tableId] = {
        decisions: clonePlainObject(states[tableId].decisions),
        modifications: clonePlainObject(states[tableId].modifications),
      };
    });
    reviewDrafts[key] = {
      updatedAt: new Date().toISOString(),
      tables: tables,
    };
  }

  function clearReviewDraft(key) {
    if (key && reviewDrafts[key]) delete reviewDrafts[key];
  }

  function getColumnWidth(col) {
    var id = String((col && (col.id || col.name)) || 'column').toLowerCase();
    if (id === 'subject' || id === 'title' || id === 'name' || id === 'target') return 260;
    if (id === 'summary' || id === 'description' || id === 'details' || id === 'reason' || id === 'rationale' || id === 'snippet') return 340;
    if (id === 'from' || id === 'sender' || id === 'account' || id === 'email') return 220;
    if (id === 'date' || id === 'received' || id === 'timestamp') return 190;
    return 180;
  }

  function appendColumn(colgroup, id, width) {
    var col = document.createElement('col');
    col.setAttribute('data-column-id', id);
    col.style.width = width + 'px';
    colgroup.appendChild(col);
  }

  function hasExpandableRows(rows) {
    return (rows || []).some(function (row) {
      if (!row || !row.children || row.children.length === 0) return false;
      return true;
    });
  }

  function buildTableColGroup(columns, reviewRequired, includeToggleSpacer) {
    var colgroup = document.createElement('colgroup');
    var totalWidth = 0;
    if (includeToggleSpacer) {
      totalWidth += 24;
      appendColumn(colgroup, 'spacer', 24);
    }
    if (reviewRequired) {
      totalWidth += 82;
      appendColumn(colgroup, 'decision', 82);
    }
    columns.forEach(function (col) {
      var id = String(col.id || col.name || 'column');
      var width = getColumnWidth(col);
      totalWidth += width;
      appendColumn(colgroup, id, width);
    });
    return {
      element: colgroup,
      width: totalWidth,
    };
  }

  function buildDecisionHeader() {
    var decTh = document.createElement('th');
    decTh.className = 'sd-th';
    decTh.setAttribute('data-column-id', 'decision');
    decTh.textContent = 'Decision';
    return decTh;
  }

  function buildRowDecisionCell(row, columns, state, rerenderFn) {
    var decTd = document.createElement('td');
    decTd.className = 'sd-td';
    decTd.setAttribute('data-column-id', 'decision');
    var rowLabel = getRowReviewLabel(row, columns);
    decTd.appendChild(buildDecisionToggle(row.id, state, rerenderFn, {
      acceptTitle: 'Accept row',
      rejectTitle: 'Reject row',
      acceptAriaLabel: 'Accept row: ' + rowLabel,
      rejectAriaLabel: 'Reject row: ' + rowLabel,
    }));
    return decTd;
  }

  function buildTableHeader(columns, state, reviewRequired, includeToggleSpacer, rerenderFn) {
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');

    if (includeToggleSpacer) {
      var spacerTh = document.createElement('th');
      spacerTh.className = 'sd-th sd-toggle-spacer';
      tr.appendChild(spacerTh);
    }

    // Decision column stays on the left so row actions remain reachable in wide CSV reviews.
    if (reviewRequired) {
      tr.appendChild(buildDecisionHeader());
    }

    columns.forEach(function (col) {
      var th = document.createElement('th');
      th.className = 'sd-th';
      th.setAttribute('data-column-id', String(col.id || col.name || 'column'));

      if (reviewRequired) {
        if (col.change === 'add') th.classList.add('sd-col-add');
        if (col.change === 'delete') th.classList.add('sd-col-delete');

        // Check if column is rejected
        var colDecisionKey = 'col:' + col.id;
        if (state.decisions[colDecisionKey] === 'reject') {
          th.classList.add('sd-col-rejected');
        }
      }

      var nameSpan = document.createElement('span');
      nameSpan.textContent = col.name;
      th.appendChild(nameSpan);
      th.appendChild(buildSortIndicator(col.id, state));

      // Sort click handler
      th.addEventListener('click', function () {
        rerenderFn(function (s) {
          if (s.sortColumn === col.id) {
            if (s.sortDirection === 'asc') {
              s.sortDirection = 'desc';
            } else if (s.sortDirection === 'desc') {
              s.sortColumn = null;
              s.sortDirection = null;
            }
          } else {
            s.sortColumn = col.id;
            s.sortDirection = 'asc';
          }
        });
      });

      // Column decision toggle in review mode (for added or deleted columns)
      if (reviewRequired && (col.change === 'add' || col.change === 'delete')) {
        th.appendChild(buildDecisionToggle('col:' + col.id, state, rerenderFn, {
          acceptTitle: 'Accept column',
          rejectTitle: 'Reject column',
          acceptAriaLabel: 'Accept column: ' + shortLabel(col.name || col.id, 'column'),
          rejectAriaLabel: 'Reject column: ' + shortLabel(col.name || col.id, 'column'),
        }));
      }

      tr.appendChild(th);
    });

    thead.appendChild(tr);
    return thead;
  }

  function buildTableBody(flatRows, columns, state, reviewRequired, includeToggleSpacer, rerenderFn) {
    var tbody = document.createElement('tbody');

    flatRows.forEach(function (entry) {
      var row = entry.row;
      var depth = entry.depth;
      var tr = document.createElement('tr');

      // Check if row is rejected
      if (state.decisions[row.id] === 'reject') {
        tr.classList.add('sd-row-rejected');
      }

      var hasChildren = row.children && row.children.length > 0;
      var isExpanded = state.expandedRows.has(row.id);
      if (includeToggleSpacer) {
        var toggleTd = document.createElement('td');
        toggleTd.className = 'sd-td sd-toggle-spacer';
        toggleTd.appendChild(buildExpandToggle(row.id, hasChildren, isExpanded, rerenderFn));
        tr.appendChild(toggleTd);
      }

      if (reviewRequired) {
        tr.appendChild(buildRowDecisionCell(row, columns, state, rerenderFn));
      }

      columns.forEach(function (col, colIndex) {
        var td = document.createElement('td');
        td.className = 'sd-td';
        td.setAttribute('data-column-id', String(col.id || col.name || 'column'));

        // Depth indentation on first cell
        if (colIndex === 0) {
          var depthClass = 'sd-depth-' + Math.min(depth, 5);
          td.classList.add(depthClass);
        }

        if (reviewRequired) {
          // Cell change styling
          var change = getCellChange(row, col.id, col.name);
          if (change === 'add') td.classList.add('sd-cell-add');
          if (change === 'delete') td.classList.add('sd-cell-delete');
          if (change === 'update') td.classList.add('sd-cell-update');

          // Check for user modifications
          var modKey = row.id + '.' + col.id;
          if (state.modifications[modKey]) {
            td.classList.add('sd-cell-edited');
          }

          // Column rejected styling
          var colDecisionKey = 'col:' + col.id;
          if (state.decisions[colDecisionKey] === 'reject') {
            td.classList.add('sd-col-rejected');
          }
        }

          var value = state.modifications[modKey]
          ? JSON.parse(state.modifications[modKey]).value
          : getCellValue(row, col.id, col.name);
        td.textContent = value;

        // Cell editor on double-click (review mode only)
        if (reviewRequired) {
          td.addEventListener('dblclick', function () {
            buildCellEditor(td, row.id, col.id, value, state, rerenderFn);
          });
          td.style.cursor = 'text';
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    return tbody;
  }

  function exportTableCsv(tableData, state) {
    var csv = buildCsvString(tableData, state.modifications);
    var fileName = (tableData.name || tableData.id || 'table') + '.csv';

    // Use Tauri IPC save_file command (native save dialog)
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke('save_file', {
        filename: fileName,
        content: csv
      });
    }

    // Fallback for non-Tauri environments: blob download
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildTableContainer(tableData, state, reviewRequired, onDecision, onStateChange) {
    var container = document.createElement('div');
    container.className = 'sd-container';

    // Table header row with name and CSV download
    var tableHeader = document.createElement('div');
    tableHeader.className = 'sd-table-header';

    if (tableData.name) {
      var nameEl = document.createElement('h3');
      nameEl.className = 'sd-table-name';
      nameEl.textContent = tableData.name;
      tableHeader.appendChild(nameEl);
    }

    var csvBtn = document.createElement('button');
    csvBtn.className = 'sd-csv-btn';
    csvBtn.textContent = 'CSV';
    csvBtn.title = 'Download table as CSV';
    csvBtn.addEventListener('click', function () {
      var result = exportTableCsv(tableData, state);
      if (result && typeof result.then === 'function') {
        result.then(function (saved) {
          if (saved) {
            var orig = csvBtn.textContent;
            csvBtn.textContent = 'Saved!';
            csvBtn.classList.add('sd-csv-btn-copied');
            setTimeout(function () {
              csvBtn.textContent = orig;
              csvBtn.classList.remove('sd-csv-btn-copied');
            }, 1500);
          }
        });
      }
    });
    tableHeader.appendChild(csvBtn);

    container.appendChild(tableHeader);

    // Per-table Accept All / Reject All (review mode only)
    if (reviewRequired) {
      var tableActions = document.createElement('div');
      tableActions.style.cssText = 'display: flex; gap: var(--space-2); margin-bottom: var(--space-2);';

      var tableAcceptAll = document.createElement('button');
      tableAcceptAll.textContent = 'Accept All';
      tableAcceptAll.title = 'Accept all rows in ' + getTableReviewLabel(tableData);
      tableAcceptAll.setAttribute('aria-label', 'Accept all rows in ' + getTableReviewLabel(tableData));
      tableAcceptAll.style.cssText = 'padding: var(--space-1) var(--space-2); border-radius: var(--border-radius-sm); border: 1px solid var(--color-success); background: var(--color-success-bg); color: var(--color-success-text); cursor: pointer; font-size: var(--text-xs);';
      tableAcceptAll.addEventListener('click', function () {
        var tempStates = {};
        tempStates[tableData.id] = state;
        applyBulkDecision([tableData], tempStates, 'accept');
        if (onStateChange) onStateChange();
        renderTableContent();
      });

      var tableRejectAll = document.createElement('button');
      tableRejectAll.textContent = 'Reject All';
      tableRejectAll.title = 'Reject all rows in ' + getTableReviewLabel(tableData);
      tableRejectAll.setAttribute('aria-label', 'Reject all rows in ' + getTableReviewLabel(tableData));
      tableRejectAll.style.cssText = 'padding: var(--space-1) var(--space-2); border-radius: var(--border-radius-sm); border: 1px solid var(--color-error); background: var(--color-error-bg); color: var(--color-error-text); cursor: pointer; font-size: var(--text-xs);';
      tableRejectAll.addEventListener('click', function () {
        var tempStates = {};
        tempStates[tableData.id] = state;
        applyBulkDecision([tableData], tempStates, 'reject');
        if (onStateChange) onStateChange();
        renderTableContent();
      });

      tableActions.appendChild(tableAcceptAll);
      tableActions.appendChild(tableRejectAll);
      container.appendChild(tableActions);
    }

    // Filter input
    var filter = document.createElement('input');
    filter.className = 'sd-filter';
    filter.type = 'text';
    filter.placeholder = 'Filter rows\u2026';
    filter.value = state.filterText;
    filter.addEventListener('input', function (e) {
      state.filterText = e.target.value;
      renderTableContent();
    });
    container.appendChild(filter);

    var table = document.createElement('table');
    table.className = 'sd-table';
    var includeToggleSpacer = hasExpandableRows(tableData.rows);
    if (includeToggleSpacer) {
      table.setAttribute('data-has-toggle-spacer', 'true');
    }
    container.appendChild(table);

    function renderTableContent() {
      table.innerHTML = '';

      var rerenderFn = function (mutator) {
        if (mutator) mutator(state);
        if (onStateChange) onStateChange();
        renderTableContent();
      };

      // Process rows: filter, then sort
      var rows = tableData.rows;
      if (state.filterText) {
        rows = filterRows(JSON.parse(JSON.stringify(rows)), tableData.columns, state.filterText);
      }
      if (state.sortColumn && state.sortDirection) {
        rows = sortRows(JSON.parse(JSON.stringify(rows)), state.sortColumn, state.sortDirection);
      }

      var flatRows = flattenRows(rows, 0, state.expandedRows);

      var colGroup = buildTableColGroup(tableData.columns, reviewRequired, includeToggleSpacer);
      table.style.width = colGroup.width + 'px';
      table.appendChild(colGroup.element);
      table.appendChild(buildTableHeader(tableData.columns, state, reviewRequired, includeToggleSpacer, rerenderFn));
      table.appendChild(buildTableBody(flatRows, tableData.columns, state, reviewRequired, includeToggleSpacer, rerenderFn));
    }

    renderTableContent();

    // Expose rerender so global buttons can trigger it
    container.__rerender = renderTableContent;

    return container;
  }

  // ── 3. Table Builders — Review Mode ──

  function buildCellEditor(td, rowId, colId, currentValue, state, rerenderFn) {
    var input = document.createElement('textarea');
    input.className = 'sd-cell-editor';
    input.rows = 6;
    input.value = currentValue;
    input.setAttribute('aria-label', 'Edit cell value');
    input.title = 'Edit cell value';
    td.innerHTML = '';
    td.appendChild(input);

    function resizeEditor() {
      input.style.height = 'auto';
      var maxHeight = Math.round(window.innerHeight * 0.48);
      input.style.height = Math.min(Math.max(input.scrollHeight, 132), maxHeight) + 'px';
    }

    input.addEventListener('input', resizeEditor);
    resizeEditor();
    input.focus();
    input.select();

    function commit() {
      var newValue = input.value;
      if (newValue !== String(currentValue)) {
        var modKey = rowId + '.' + colId;
        state.modifications[modKey] = JSON.stringify({ value: newValue, user_edited: true });
      }
      rerenderFn();
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        input.blur();
      }
      if (e.key === 'Escape') {
        input.removeEventListener('blur', commit);
        rerenderFn();
      }
    });
  }

  function buildSubmitBar(tables, states, tableContainers, onDecision, reviewTitle, onStateChange, reviewDraftKey) {
    var bar = document.createElement('div');
    bar.className = 'sd-submit-bar';
    bar.setAttribute('data-submit-state', 'idle');

    var submitState = 'idle';
    var controls = [];
    var rerenderQueued = false;

    var status = document.createElement('span');
    status.className = 'sd-submit-status';
    status.textContent = '';
    bar.appendChild(status);

    function rerenderAllTables() {
      tableContainers.forEach(function (tc) {
        if (tc.__rerender) tc.__rerender();
      });
    }

    function scheduleRerenderAllTables() {
      if (rerenderQueued) return;
      rerenderQueued = true;
      var run = function () {
        rerenderQueued = false;
        rerenderAllTables();
      };
      if (window.requestAnimationFrame) window.requestAnimationFrame(run);
      else window.setTimeout(run, 0);
    }

    function setControlsDisabled(disabled) {
      controls.forEach(function (control) {
        control.disabled = !!disabled;
      });
    }

    function setTableSubmittedState(submitted) {
      tableContainers.forEach(function (tc) {
        tc.setAttribute('data-review-submitted', submitted ? 'true' : 'false');
        Array.from(tc.querySelectorAll('button')).forEach(function (button) {
          button.disabled = !!submitted;
        });
      });
    }

    function setSubmitState(nextState, message) {
      submitState = nextState;
      bar.setAttribute('data-submit-state', nextState);
      status.textContent = message || '';
      setControlsDisabled(nextState === 'submitting' || nextState === 'submitted');
      setTableSubmittedState(nextState === 'submitting' || nextState === 'submitted');
    }

    function applyDecision(decision) {
      if (submitState === 'submitting' || submitState === 'submitted') return;
      applyBulkDecision(tables, states, decision);
      if (onStateChange) onStateChange();
      scheduleRerenderAllTables();
    }

    var acceptAllBtn = document.createElement('button');
    acceptAllBtn.textContent = 'Accept All';
    acceptAllBtn.title = 'Accept all decisions in ' + getReviewScopeLabel(tables, reviewTitle);
    acceptAllBtn.setAttribute('aria-label', 'Accept all decisions in ' + getReviewScopeLabel(tables, reviewTitle));
    acceptAllBtn.style.cssText = 'padding: var(--space-2) var(--space-3); border-radius: var(--border-radius-sm); border: 1px solid var(--color-success); background: var(--color-success-bg); color: var(--color-success-text); cursor: pointer; font-size: var(--text-small);';
    acceptAllBtn.addEventListener('click', function () {
      applyDecision('accept');
    });

    var rejectAllBtn = document.createElement('button');
    rejectAllBtn.textContent = 'Reject All';
    rejectAllBtn.title = 'Reject all decisions in ' + getReviewScopeLabel(tables, reviewTitle);
    rejectAllBtn.setAttribute('aria-label', 'Reject all decisions in ' + getReviewScopeLabel(tables, reviewTitle));
    rejectAllBtn.style.cssText = 'padding: var(--space-2) var(--space-3); border-radius: var(--border-radius-sm); border: 1px solid var(--color-error); background: var(--color-error-bg); color: var(--color-error-text); cursor: pointer; font-size: var(--text-small);';
    rejectAllBtn.addEventListener('click', function () {
      applyDecision('reject');
    });

    function submitDecision() {
      if (submitState === 'submitting' || submitState === 'submitted') return Promise.resolve(null);
      var payload = buildDecisionPayload(tables, states);
      setSubmitState('submitting', 'Decision submitted. Resuming agent...');
      var result = null;
      try {
        result = onDecision ? onDecision(payload) : null;
      } catch (error) {
        setSubmitState('error', error && error.message ? error.message : 'Review submission failed.');
        return Promise.reject(error);
      }
      return Promise.resolve(result).then(function () {
        setSubmitState('submitted', 'Decision confirmed. Agent is applying changes.');
        clearReviewDraft(reviewDraftKey);
        return result;
      }).catch(function (error) {
        setSubmitState('error', error && error.message ? error.message : 'Review submission failed.');
        throw error;
      });
    }

    var submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Decisions';
    submitBtn.title = 'Submit decisions for ' + getReviewScopeLabel(tables, reviewTitle);
    submitBtn.setAttribute('aria-label', 'Submit decisions for ' + getReviewScopeLabel(tables, reviewTitle));
    submitBtn.setAttribute('data-review-decision-submit', 'true');
    submitBtn.style.cssText = 'padding: var(--space-2) var(--space-4); border-radius: var(--border-radius-sm); border: 1px solid var(--color-info); background: var(--color-info); color: white; cursor: pointer; font-size: var(--text-small); font-weight: var(--weight-semibold);';
    submitBtn.addEventListener('click', function () {
      submitDecision().catch(function () {});
    });

    controls.push(acceptAllBtn, rejectAllBtn, submitBtn);
    bar.appendChild(acceptAllBtn);
    bar.appendChild(rejectAllBtn);
    bar.appendChild(submitBtn);
    return {
      element: bar,
      applyDecision: applyDecision,
      submitDecision: submitDecision,
    };
  }

  function shouldUseExternalDecisionSubmit(meta, toolArgs) {
    var candidates = [meta, toolArgs];
    if (toolArgs && toolArgs.meta) candidates.push(toolArgs.meta);
    return candidates.some(function (candidate) {
      return !!(
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        (
          candidate.externalDecisionSubmit === true ||
          candidate.suppressDecisionSubmit === true ||
          candidate.hideDecisionSubmit === true ||
          candidate.bundleDecisionSubmit === true
        )
      );
    });
  }

  // ── 4. Legend ──

  function buildLegend(data, reviewRequired) {
    // Legend is only meaningful in review mode
    if (!reviewRequired) return null;

    // Detect which change types are present
    var hasAdd = false, hasDelete = false, hasUpdate = false;
    (data.tables || []).forEach(function (t) {
      t.columns.forEach(function (c) {
        if (c.change === 'add') hasAdd = true;
        if (c.change === 'delete') hasDelete = true;
      });
      function scanRows(rows) {
        if (!rows) return;
        rows.forEach(function (r) {
          if (r.cells) {
            Object.keys(r.cells).forEach(function (k) {
              var ch = r.cells[k].change;
              if (ch === 'add') hasAdd = true;
              if (ch === 'delete') hasDelete = true;
              if (ch === 'update') hasUpdate = true;
            });
          }
          if (r.children) scanRows(r.children);
        });
      }
      scanRows(t.rows);
    });

    // Only show legend if there are changes
    if (!hasAdd && !hasDelete && !hasUpdate && !reviewRequired) return null;

    var legend = document.createElement('div');
    legend.className = 'sd-legend';

    var items = [];
    if (hasAdd) items.push({ label: 'Added', bg: 'var(--color-success-bg)', border: 'var(--color-success)' });
    if (hasUpdate) items.push({ label: 'Modified', bg: 'var(--color-warning-bg)', border: 'var(--color-warning)' });
    if (hasDelete) items.push({ label: 'Deleted', bg: 'var(--color-error-bg)', border: 'var(--color-error)' });
    if (reviewRequired) items.push({ label: 'User edited', bg: 'var(--color-info-bg)', border: 'var(--color-info)' });

    items.forEach(function (item) {
      var el = document.createElement('span');
      el.className = 'sd-legend-item';
      var swatch = document.createElement('span');
      swatch.className = 'sd-legend-swatch';
      swatch.style.background = item.bg;
      swatch.style.border = '1px solid ' + item.border;
      el.appendChild(swatch);
      var label = document.createElement('span');
      label.textContent = item.label;
      el.appendChild(label);
      legend.appendChild(el);
    });

    return legend;
  }

  // ── 5. Orchestrator ──

  function hasPendingTableRefs(data) {
    var client = window.__mcpviewsDatasetClient;
    return !!(client && data && Array.isArray(data.tables) && data.tables.some(client.hasPendingTableRef));
  }

  function renderDataRefLoading(container) {
    var loading = document.createElement('div');
    loading.className = 'sd-loading';
    loading.textContent = 'Loading referenced table data...';
    container.appendChild(loading);
  }

  function renderDataRefError(container, error) {
    var message = document.createElement('div');
    message.className = 'sd-empty';
    message.textContent = error && error.message ? error.message : 'Referenced table data could not be loaded.';
    container.appendChild(message);
  }

  function inlineRowCount(rows) {
    return (rows || []).reduce(function (count, row) {
      return count + 1 + inlineRowCount(row && row.children);
    }, 0);
  }

  function renderEfficiencyWarnings(container, data) {
    var totalRows = (data.tables || []).reduce(function (sum, table) {
      if (table && (table.dataRef || table.data_ref)) return sum;
      return sum + inlineRowCount(table && table.rows);
    }, 0);
    if (totalRows <= 200) return;
    var warning = document.createElement('div');
    warning.className = 'sd-efficiency-warning';
    warning.textContent = 'This payload includes ' + totalRows + ' inline table rows. register_dataset plus dataRef can reduce repeated output tokens for large tables.';
    container.appendChild(warning);
  }

  function renderResolvedRefWarnings(container, data) {
    (data.tables || []).forEach(function (table) {
      (table.__dataRefWarnings || []).forEach(function (text) {
        var warning = document.createElement('div');
        warning.className = 'sd-dataref-warning';
        warning.textContent = text;
        container.appendChild(warning);
      });
    });
  }

  function renderInstructionTemplate(container, data) {
    var client = window.__mcpviewsDatasetClient;
    if (!client || typeof client.renderTemplate !== 'function') return;
    var text = client.renderTemplate(data && (data.instructionTemplate || data.instruction_template));
    if (!text) return;
    var el = document.createElement('div');
    el.className = 'sd-instruction-template';
    el.textContent = text;
    container.appendChild(el);
  }

  function renderStructuredData(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';
    injectStyles();

    if (hasPendingTableRefs(data)) {
      renderDataRefLoading(container);
      window.__mcpviewsDatasetClient.resolveTables(data.tables).then(function () {
        renderStructuredData(container, data, meta, toolArgs, reviewRequired, onDecision);
      }).catch(function (error) {
        container.innerHTML = '';
        renderDataRefError(container, error);
      });
      return;
    }

    data = normalizeStructuredData(data);

    if (!data || !data.tables || !data.tables.length) {
      var empty = document.createElement('div');
      empty.className = 'sd-empty';
      empty.textContent = 'No tables to display';
      container.appendChild(empty);
      return;
    }

    if (data.title) {
      var titleEl = document.createElement('h1');
      titleEl.className = 'sd-title';
      titleEl.textContent = data.title;
      container.appendChild(titleEl);
    }

    renderInstructionTemplate(container, data);
    renderEfficiencyWarnings(container, data);
    renderResolvedRefWarnings(container, data);

    var legend = buildLegend(data, reviewRequired);
    if (legend) container.appendChild(legend);

    var states = {};
    var tableContainers = [];
    var submitBar = null;
    var submitController = null;
    var reviewDraftKey = reviewRequired ? getReviewDraftKey(data, meta, toolArgs) : '';
    var decisionStateCallback = meta && typeof meta.onDecisionStateChange === 'function'
      ? meta.onDecisionStateChange
      : null;
    data.tables.forEach(function (tableData) {
      states[tableData.id] = createTableState(tableData);
    });
    hydrateReviewDraft(states, reviewDraftKey ? reviewDrafts[reviewDraftKey] : null);

    function getDecisionSummary() {
      return summarizeDecisionState(data.tables, states);
    }

    function notifyDecisionStateChange() {
      if (decisionStateCallback) decisionStateCallback(getDecisionSummary());
    }

    function persistCurrentReviewDraft() {
      persistReviewDraft(reviewDraftKey, states);
      notifyDecisionStateChange();
    }

    function rerenderReviewSurfaces() {
      persistCurrentReviewDraft();
      tableContainers.forEach(function (tc) {
        if (tc.__rerender) tc.__rerender();
      });
    }

    var externalDecisionSubmit = reviewRequired && onDecision
      ? shouldUseExternalDecisionSubmit(meta, toolArgs)
      : false;

    if (reviewRequired && onDecision) {
      submitController = buildSubmitBar(data.tables, states, tableContainers, onDecision, data.title, persistCurrentReviewDraft, reviewDraftKey);
      submitBar = submitController && submitController.element ? submitController.element : submitController;
      if (!externalDecisionSubmit) {
        container.appendChild(submitBar);
      }
    }

    data.tables.forEach(function (tableData) {
      var tableContainer = buildTableContainer(tableData, states[tableData.id], reviewRequired, onDecision, persistCurrentReviewDraft);
      tableContainers.push(tableContainer);
      container.appendChild(tableContainer);
    });

    notifyDecisionStateChange();

    if (submitController && submitController.submitDecision) {
      return {
        providesDecisionSubmit: true,
        applyDecision: submitController.applyDecision,
        getDecisionSummary: getDecisionSummary,
        submitDecision: submitController.submitDecision,
      };
    }
    return undefined;
  }

  window.__renderers.structured_data = renderStructuredData;

  // Expose embeddable API for rich_content table embeds
  window.__structuredDataEmbed = {
    injectStyles: injectStyles,
    buildTableContainer: buildTableContainer,
  };
})();
