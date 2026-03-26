// @ts-nocheck
/* Data schema renderer — get_data_schema (table view) & manage_data_draft get_diff (draft diff) */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  /**
   * @param {HTMLElement} container
   * @param {unknown} data
   * @param {Record<string, unknown>} meta
   * @param {Record<string, unknown>} toolArgs
   * @param {boolean} reviewRequired
   * @param {(decision: string | Record<string, string>) => void} onDecision
   */
  window.__renderers.data_schema = function renderDataSchema(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var schema = (data && data.data) || data || {};

    // Data source heading
    var heading = document.createElement('h2');
    heading.className = 'dg-schema-heading';
    heading.textContent = schema.data_source || 'Data Schema';
    container.appendChild(heading);

    var tables = schema.tables || [];
    if (!Array.isArray(tables)) { tables = []; }

    if (tables.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'dg-schema-empty';
      empty.textContent = 'No tables found';
      container.appendChild(empty);
      return;
    }

    for (var t = 0; t < tables.length; t++) {
      container.appendChild(renderTableSection(tables[t]));
    }
  };

  /**
   * Draft diff renderer for manage_data_draft — grid-based layout mirroring
   * the actual data governance table. Changed cells are color-coded and
   * expand on click to show current→proposed, editable input, accept/reject.
   */
  window.__renderers.data_draft_diff = function renderDataDraftDiff(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var draft = (data && data.data) || data || {};
    var changes = draft.changes || [];
    if (!Array.isArray(changes)) { changes = []; }

    var state = createDraftState(changes);

    container.appendChild(buildDraftHeader(draft));

    if (changes.length === 0) {
      var noChanges = document.createElement('div');
      noChanges.className = 'dg-empty';
      noChanges.textContent = 'No changes in this draft';
      container.appendChild(noChanges);
      return;
    }

    var groups = groupChangesByTable(changes, draft);

    var summaryBar = buildSummaryBar(state, changes, reviewRequired, onDecision);
    container.appendChild(summaryBar);

    var tableKeys = Object.keys(groups);
    for (var g = 0; g < tableKeys.length; g++) {
      container.appendChild(buildGridGroup(tableKeys[g], groups[tableKeys[g]], state, function () {
        refreshSummaryContent(summaryBar, state, changes, reviewRequired, onDecision);
      }));
    }
  };

  // --- State factory ---

  function createDraftState(changes) {
    var decisions = {};
    var modifications = {};
    var comments = {};
    for (var i = 0; i < changes.length; i++) {
      var id = changes[i].id || 'chg-' + i;
      decisions[id] = null;
      modifications[id] = null;
      comments[id] = '';
    }
    // additions: user-added values for cells the agent didn't propose
    // keyed by "tableName|columnName|fieldName" -> { value, id }
    // cellRefreshers: array of { id, refresh } for bulk accept
    return { decisions: decisions, modifications: modifications, comments: comments, additions: {}, cellRefreshers: [] };
  }

  // --- Header ---

  function buildDraftHeader(draft) {
    var header = document.createElement('div');
    header.className = 'dg-header';

    var heading = document.createElement('h2');
    heading.className = 'dg-title';
    // Full path: DataSource.Table
    var titleParts = [];
    if (draft.data_source) titleParts.push(draft.data_source);
    if (draft.table) titleParts.push(draft.table);
    heading.textContent = (titleParts.length > 0 ? titleParts.join('.') + ' ' : '') + 'Draft';
    header.appendChild(heading);
    if (draft.draft_id) {
      var idBadge = document.createElement('span');
      idBadge.className = 'dg-badge dg-badge-id';
      idBadge.textContent = draft.draft_id;
      header.appendChild(idBadge);
    }
    if (draft.status) {
      var statusBadge = document.createElement('span');
      statusBadge.className = 'dg-badge dg-status dg-status-' + (draft.status || '').toLowerCase();
      statusBadge.textContent = draft.status;
      header.appendChild(statusBadge);
    }
    return header;
  }

  // --- Group changes by table ---

  function groupChangesByTable(changes, draft) {
    var groups = {};
    var ds = draft.data_source || '';
    for (var i = 0; i < changes.length; i++) {
      var tbl = changes[i].table_name || draft.table || 'Changes';
      // Full path: DataSource.Table
      var fullPath = ds ? ds + '.' + tbl : tbl;
      if (!groups[fullPath]) { groups[fullPath] = []; }
      groups[fullPath].push(changes[i]);
    }
    return groups;
  }

  // --- Build grid for a table group ---

  function buildGridGroup(tableName, tableChanges, state, onRefresh) {
    var section = document.createElement('div');
    section.className = 'dg-table-group';

    // Group header
    var groupHeader = document.createElement('div');
    groupHeader.className = 'dg-group-header';
    var toggle = document.createElement('span');
    toggle.className = 'dg-toggle';
    toggle.textContent = '\u25BC';
    var nameSpan = document.createElement('span');
    nameSpan.className = 'dg-group-name';
    nameSpan.textContent = tableName;
    var countSpan = document.createElement('span');
    countSpan.className = 'dg-group-count';
    countSpan.textContent = tableChanges.length + ' change' + (tableChanges.length !== 1 ? 's' : '');
    groupHeader.appendChild(toggle);
    groupHeader.appendChild(nameSpan);
    groupHeader.appendChild(countSpan);

    var body = document.createElement('div');

    // Build grid data: rows = unique columns, cols = unique metadata fields
    var columnOrder = [];
    var columnSet = {};
    var fieldOrder = [];
    var fieldSet = {};
    var changeMap = {}; // "colName|fieldName" -> change

    for (var i = 0; i < tableChanges.length; i++) {
      var c = tableChanges[i];
      var col = c.column_name || '';
      var field = c.field_name || '';
      if (!columnSet[col]) { columnSet[col] = true; columnOrder.push(col); }
      if (!fieldSet[field]) { fieldSet[field] = true; fieldOrder.push(field); }
      changeMap[col + '|' + field] = c;
    }

    // Build table
    var table = document.createElement('table');
    table.className = 'dg-grid-table';

    // Header: Column | field1 | field2 | ...
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var thCol = document.createElement('th');
    thCol.className = 'dg-grid-th dg-grid-th-col';
    thCol.textContent = 'Column';
    headerRow.appendChild(thCol);

    for (var f = 0; f < fieldOrder.length; f++) {
      var thField = document.createElement('th');
      thField.className = 'dg-grid-th';
      thField.textContent = fieldOrder[f];
      headerRow.appendChild(thField);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body: one row per column
    var tbody = document.createElement('tbody');
    for (var r = 0; r < columnOrder.length; r++) {
      var rowCol = columnOrder[r];
      var tr = document.createElement('tr');
      tr.className = 'dg-grid-row';

      // Column name cell
      var tdName = document.createElement('td');
      tdName.className = 'dg-grid-td dg-grid-col-name';
      tdName.textContent = rowCol;
      tr.appendChild(tdName);

      // One cell per metadata field
      for (var fc = 0; fc < fieldOrder.length; fc++) {
        var key = rowCol + '|' + fieldOrder[fc];
        var change = changeMap[key] || null;
        tr.appendChild(buildGridCell(change, state, onRefresh, tableName, rowCol, fieldOrder[fc]));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);

    // Toggle
    groupHeader.onclick = function () {
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '\u25BC' : '\u25B6';
    };

    section.appendChild(groupHeader);
    section.appendChild(body);
    return section;
  }

  // --- Grid cell sub-builders ---

  /** Create the compact chip view for a changed cell. */
  function buildCompactView(change) {
    var compact = document.createElement('div');
    compact.className = 'dg-cell-compact';
    compact.style.display = 'none';

    var valueChip = document.createElement('span');
    valueChip.className = 'dg-cell-chip';
    valueChip.textContent = formatValue(change.new_value);
    if (change.description) { valueChip.title = change.description; }
    compact.appendChild(valueChip);

    return { compact: compact, valueChip: valueChip };
  }

  /** Create the "Current" row showing the old value. */
  function buildCurrentValueRow(oldValue) {
    var row = document.createElement('div');
    row.className = 'dg-cell-current';
    var label = document.createElement('span');
    label.className = 'dg-cell-label';
    label.textContent = 'Current';
    var val = document.createElement('span');
    val.className = 'dg-cell-current-val';
    val.textContent = formatValue(oldValue);
    row.appendChild(label);
    row.appendChild(val);
    return row;
  }

  /** Create the "Proposed" row with an editable input bound to state.modifications. */
  function buildProposedValueRow(change, state) {
    var id = change.id || 'chg-0';
    var row = document.createElement('div');
    row.className = 'dg-cell-proposed';
    var label = document.createElement('span');
    label.className = 'dg-cell-label';
    label.textContent = 'Proposed';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dg-cell-input';
    input.value = formatValue(change.new_value);
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('input', function () {
      var original = formatValue(change.new_value);
      state.modifications[id] = input.value !== original ? input.value : null;
      input.classList.toggle('dg-value-modified', state.modifications[id] !== null);
    });
    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  /** Create a description div if the change has one, otherwise null. */
  function buildDescriptionRow(description) {
    if (!description) return null;
    var div = document.createElement('div');
    div.className = 'dg-cell-desc';
    div.textContent = description;
    return div;
  }

  /** Create accept/reject/undo buttons and decision label. Returns { actions, acceptBtn, rejectBtn, undoBtn, decisionLabel }. */
  function buildDecisionActions(id, state, onDecide) {
    var actions = document.createElement('div');
    actions.className = 'dg-cell-actions';

    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'dg-action-btn dg-action-accept';
    acceptBtn.textContent = '\u2713 Accept';
    acceptBtn.addEventListener('click', function (e) { e.stopPropagation(); state.decisions[id] = 'accepted'; onDecide(); });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'dg-action-btn dg-action-reject';
    rejectBtn.textContent = '\u2717 Reject';
    rejectBtn.addEventListener('click', function (e) { e.stopPropagation(); state.decisions[id] = 'rejected'; onDecide(); });

    var undoBtn = document.createElement('button');
    undoBtn.className = 'dg-action-btn dg-action-undo';
    undoBtn.textContent = '\u21A9 Undo';
    undoBtn.style.display = 'none';
    undoBtn.addEventListener('click', function (e) { e.stopPropagation(); state.decisions[id] = null; onDecide(); });

    var decisionLabel = document.createElement('span');
    decisionLabel.className = 'dg-decision-label';
    decisionLabel.style.display = 'none';

    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    actions.appendChild(decisionLabel);
    actions.appendChild(undoBtn);

    return { actions: actions, acceptBtn: acceptBtn, rejectBtn: rejectBtn, undoBtn: undoBtn, decisionLabel: decisionLabel };
  }

  /** Wire up click-to-toggle between expanded and compact views on a cell. */
  function attachCellToggle(td, expanded, compact) {
    td.addEventListener('click', function () {
      var isExpanded = expanded.style.display !== 'none';
      expanded.style.display = isExpanded ? 'none' : '';
      compact.style.display = isExpanded ? '' : 'none';
      td.classList.toggle('dg-grid-cell-active', !isExpanded);
    });
  }

  /** Build a refresh function that updates cell visuals based on the current decision. */
  function createCellRefresher(td, expanded, compact, valueChip, controls) {
    return function refreshCell(id, state) {
      var decision = state.decisions[id];
      td.classList.remove('dg-grid-cell-accepted', 'dg-grid-cell-rejected', 'dg-grid-cell-changed', 'dg-grid-cell-active');
      if (decision === 'accepted') {
        td.classList.add('dg-grid-cell-accepted');
        controls.acceptBtn.style.display = 'none';
        controls.rejectBtn.style.display = 'none';
        controls.undoBtn.style.display = '';
        controls.decisionLabel.textContent = 'Accepted';
        controls.decisionLabel.className = 'dg-decision-label dg-label-accepted';
        controls.decisionLabel.style.display = '';
        valueChip.className = 'dg-cell-chip dg-chip-accepted';
        expanded.style.display = 'none';
        compact.style.display = '';
      } else if (decision === 'rejected') {
        td.classList.add('dg-grid-cell-rejected');
        controls.acceptBtn.style.display = 'none';
        controls.rejectBtn.style.display = 'none';
        controls.undoBtn.style.display = '';
        controls.decisionLabel.textContent = 'Rejected';
        controls.decisionLabel.className = 'dg-decision-label dg-label-rejected';
        controls.decisionLabel.style.display = '';
        valueChip.className = 'dg-cell-chip dg-chip-rejected';
        expanded.style.display = 'none';
        compact.style.display = '';
      } else {
        td.classList.add('dg-grid-cell-changed', 'dg-grid-cell-active');
        controls.acceptBtn.style.display = '';
        controls.rejectBtn.style.display = '';
        controls.undoBtn.style.display = 'none';
        controls.decisionLabel.style.display = 'none';
        valueChip.className = 'dg-cell-chip';
        expanded.style.display = '';
        compact.style.display = 'none';
      }
    };
  }

  // --- Grid cell (composed from sub-builders) ---

  function buildGridCell(change, state, onRefresh, tableName, columnName, fieldName) {
    var td = document.createElement('td');
    td.className = 'dg-grid-td';

    if (!change) {
      return buildEmptyAddableCell(td, state, onRefresh, tableName, columnName, fieldName);
    }

    var id = change.id || 'chg-0';
    td.className += ' dg-grid-cell-changed dg-grid-cell-active';
    td.setAttribute('data-change-id', id);

    var compactView = buildCompactView(change);
    td.appendChild(compactView.compact);

    var expanded = document.createElement('div');
    expanded.className = 'dg-cell-expanded';

    expanded.appendChild(buildCurrentValueRow(change.old_value));
    expanded.appendChild(buildProposedValueRow(change, state));

    var desc = buildDescriptionRow(change.description);
    if (desc) expanded.appendChild(desc);

    var controls = buildDecisionActions(id, state, function () { refreshCell(id, state); onRefresh(); });
    expanded.appendChild(controls.actions);

    td.appendChild(expanded);

    attachCellToggle(td, expanded, compactView.compact);

    var refreshCell = createCellRefresher(td, expanded, compactView.compact, compactView.valueChip, controls);

    state.cellRefreshers.push({ id: id, refresh: function () { refreshCell(id, state); } });

    return td;
  }

  // --- Empty addable cell sub-builders ---

  /** Build the compact view for an addable cell (dash + add icon + chip preview). */
  function buildAddCompactView() {
    var compact = document.createElement('div');
    compact.className = 'dg-cell-compact dg-cell-add-compact';

    var dash = document.createElement('span');
    dash.className = 'dg-cell-empty';
    dash.textContent = '\u2014';
    compact.appendChild(dash);

    var addIcon = document.createElement('span');
    addIcon.className = 'dg-cell-add-icon';
    addIcon.textContent = '+';
    addIcon.title = 'Add a value';
    compact.appendChild(addIcon);

    var chipPreview = document.createElement('span');
    chipPreview.className = 'dg-cell-chip dg-chip-added';
    chipPreview.style.display = 'none';
    compact.appendChild(chipPreview);

    return { compact: compact, dash: dash, addIcon: addIcon, chipPreview: chipPreview };
  }

  /** Build the expanded view for an addable cell (input + confirm/clear buttons). */
  function buildAddExpandedView(td, state, onRefresh, addKey, tableName, columnName, fieldName, chipPreview, dash, addIcon, compact) {
    var expanded = document.createElement('div');
    expanded.className = 'dg-cell-expanded';
    expanded.style.display = 'none';

    var inputRow = document.createElement('div');
    inputRow.className = 'dg-cell-proposed';
    var inputLabel = document.createElement('span');
    inputLabel.className = 'dg-cell-label';
    inputLabel.textContent = 'Value';
    var addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'dg-cell-input dg-cell-input-add';
    addInput.placeholder = 'Enter value...';
    addInput.addEventListener('click', function (e) { e.stopPropagation(); });
    addInput.addEventListener('input', function () {
      var val = addInput.value.trim();
      if (val) {
        state.additions[addKey] = {
          table_name: tableName,
          column_name: columnName,
          field_name: fieldName,
          value: val
        };
        td.classList.add('dg-grid-cell-added');
        chipPreview.textContent = val;
      } else {
        delete state.additions[addKey];
        td.classList.remove('dg-grid-cell-added');
        chipPreview.textContent = '';
      }
      onRefresh();
    });
    inputRow.appendChild(inputLabel);
    inputRow.appendChild(addInput);
    expanded.appendChild(inputRow);

    var actions = document.createElement('div');
    actions.className = 'dg-cell-actions';

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'dg-action-btn dg-action-accept';
    confirmBtn.textContent = '\u2713 Confirm';
    confirmBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!addInput.value.trim()) return;
      expanded.style.display = 'none';
      compact.style.display = '';
      td.classList.remove('dg-grid-cell-active');
    });

    var clearBtn = document.createElement('button');
    clearBtn.className = 'dg-action-btn dg-action-reject';
    clearBtn.textContent = '\u2717 Clear';
    clearBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      addInput.value = '';
      delete state.additions[addKey];
      td.classList.remove('dg-grid-cell-added');
      chipPreview.textContent = '';
      dash.style.display = '';
      addIcon.style.display = '';
      chipPreview.style.display = 'none';
      expanded.style.display = 'none';
      compact.style.display = '';
      td.classList.remove('dg-grid-cell-active');
      onRefresh();
    });

    actions.appendChild(confirmBtn);
    actions.appendChild(clearBtn);
    expanded.appendChild(actions);

    // Hook compact refresh into input events
    addInput.addEventListener('input', function () {
      var hasVal = state.additions[addKey] && state.additions[addKey].value;
      dash.style.display = hasVal ? 'none' : '';
      addIcon.style.display = hasVal ? 'none' : '';
      chipPreview.style.display = hasVal ? '' : 'none';
    });

    return { expanded: expanded, addInput: addInput };
  }

  /** Restore previously-added state when the cell is re-rendered. */
  function restoreAddedState(td, addInput, chipPreview, dash, addIcon, state, addKey) {
    if (state.additions[addKey]) {
      addInput.value = state.additions[addKey].value;
      td.classList.add('dg-grid-cell-added');
      chipPreview.textContent = state.additions[addKey].value;
    }
    // Sync compact display to current state
    var hasVal = state.additions[addKey] && state.additions[addKey].value;
    dash.style.display = hasVal ? 'none' : '';
    addIcon.style.display = hasVal ? 'none' : '';
    chipPreview.style.display = hasVal ? '' : 'none';
  }

  // --- Empty addable cell (composed from sub-builders) ---

  function buildEmptyAddableCell(td, state, onRefresh, tableName, columnName, fieldName) {
    td.className += ' dg-grid-cell-addable';
    var addKey = tableName + '|' + columnName + '|' + fieldName;

    var compactView = buildAddCompactView();
    td.appendChild(compactView.compact);

    var expandedView = buildAddExpandedView(
      td, state, onRefresh, addKey, tableName, columnName, fieldName,
      compactView.chipPreview, compactView.dash, compactView.addIcon, compactView.compact
    );
    td.appendChild(expandedView.expanded);

    // Click to expand/collapse
    td.addEventListener('click', function () {
      var isExpanded = expandedView.expanded.style.display !== 'none';
      expandedView.expanded.style.display = isExpanded ? 'none' : '';
      compactView.compact.style.display = isExpanded ? '' : 'none';
      td.classList.toggle('dg-grid-cell-active', !isExpanded);
      if (!isExpanded) expandedView.addInput.focus();
    });

    restoreAddedState(td, expandedView.addInput, compactView.chipPreview, compactView.dash, compactView.addIcon, state, addKey);

    return td;
  }

  // --- Summary bar ---

  function buildSummaryBar(state, changes, reviewRequired, onDecision) {
    var bar = document.createElement('div');
    bar.className = 'dg-summary-bar';
    refreshSummaryContent(bar, state, changes, reviewRequired, onDecision);
    return bar;
  }

  function refreshSummaryContent(bar, state, changes, reviewRequired, onDecision) {
    bar.innerHTML = '';
    var accepted = 0, rejected = 0, pending = 0;
    for (var i = 0; i < changes.length; i++) {
      var id = changes[i].id || 'chg-' + i;
      var d = state.decisions[id];
      if (d === 'accepted') accepted++;
      else if (d === 'rejected') rejected++;
      else pending++;
    }

    var addedCount = Object.keys(state.additions).length;

    var countsDiv = document.createElement('div');
    countsDiv.className = 'dg-summary-counts';
    var html =
      '<span class="dg-count-accepted">' + accepted + ' accepted</span>' +
      '<span class="dg-count-sep">\u00B7</span>' +
      '<span class="dg-count-rejected">' + rejected + ' rejected</span>' +
      '<span class="dg-count-sep">\u00B7</span>' +
      '<span class="dg-count-pending">' + pending + ' pending</span>';
    if (addedCount > 0) {
      html += '<span class="dg-count-sep">\u00B7</span>' +
        '<span class="dg-count-added">' + addedCount + ' added</span>';
    }
    countsDiv.innerHTML = html;
    bar.appendChild(countsDiv);

    var btnGroup = document.createElement('div');
    btnGroup.className = 'dg-summary-buttons';

    // Accept All button (shown when there are pending changes)
    if (reviewRequired && pending > 0) {
      var acceptAllBtn = document.createElement('button');
      acceptAllBtn.className = 'dg-accept-all-btn';
      acceptAllBtn.textContent = '\u2713 Accept All';
      acceptAllBtn.onclick = function () {
        for (var k = 0; k < changes.length; k++) {
          var cid = changes[k].id || 'chg-' + k;
          if (!state.decisions[cid]) {
            state.decisions[cid] = 'accepted';
          }
        }
        // Refresh all cells
        for (var r = 0; r < state.cellRefreshers.length; r++) {
          state.cellRefreshers[r].refresh();
        }
        refreshSummaryContent(bar, state, changes, reviewRequired, onDecision);
      };
      btnGroup.appendChild(acceptAllBtn);
    }

    if (reviewRequired && pending === 0) {
      var submitBtn = document.createElement('button');
      submitBtn.className = 'dg-submit-btn';
      submitBtn.textContent = 'Submit Decisions';
      submitBtn.onclick = function () {
        var decisions = {};
        var comments = {};
        var modifications = {};
        var additions = [];
        var hasModifications = false;
        var hasComments = false;
        for (var j = 0; j < changes.length; j++) {
          var cid = changes[j].id || 'chg-' + j;
          decisions[cid] = state.decisions[cid];
          if (state.comments[cid]) { comments[cid] = state.comments[cid]; hasComments = true; }
          if (state.modifications[cid] !== null) { modifications[cid] = state.modifications[cid]; hasModifications = true; }
        }
        // Collect user additions
        var addKeys = Object.keys(state.additions);
        for (var a = 0; a < addKeys.length; a++) {
          additions.push(state.additions[addKeys[a]]);
        }
        var payload = { type: 'operation_decisions', decisions: decisions };
        if (hasComments) payload.comments = comments;
        if (hasModifications) payload.modifications = modifications;
        if (additions.length > 0) payload.additions = additions;
        onDecision(payload);
      };
      btnGroup.appendChild(submitBtn);
    }

    bar.appendChild(btnGroup);
  }

  // --- Table mode helpers ---

  function renderTableSection(table) {
    var section = document.createElement('div');
    section.className = 'dg-schema-section';

    // Collapsible header
    var sectionHeader = document.createElement('div');
    sectionHeader.className = 'dg-schema-section-header';

    var toggle = document.createElement('span');
    toggle.className = 'dg-schema-toggle';
    toggle.textContent = '\u25BC';

    var tableName = document.createElement('span');
    tableName.className = 'dg-schema-table-name';
    tableName.textContent = table.name || '(unnamed table)';

    var colCount = document.createElement('span');
    colCount.className = 'dg-schema-col-count';
    var columns = table.columns || [];
    colCount.textContent = columns.length + ' column' + (columns.length !== 1 ? 's' : '');

    sectionHeader.appendChild(toggle);
    sectionHeader.appendChild(tableName);
    sectionHeader.appendChild(colCount);

    var body = document.createElement('div');

    if (columns.length > 0) {
      body.appendChild(renderColumnsTable(columns));
    } else {
      var empty = document.createElement('div');
      empty.className = 'dg-schema-no-columns';
      empty.textContent = 'No columns';
      body.appendChild(empty);
    }

    sectionHeader.onclick = function () {
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '\u25BC' : '\u25B6';
    };

    section.appendChild(sectionHeader);
    section.appendChild(body);
    return section;
  }

  function renderColumnsTable(columns) {
    var table = document.createElement('table');
    table.className = 'dg-schema-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var headers = ['Name', 'Type', 'PK', 'Nullable', 'Description'];
    for (var h = 0; h < headers.length; h++) {
      var th = document.createElement('th');
      th.className = 'dg-schema-th';
      th.textContent = headers[h];
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < columns.length; i++) {
      var col = columns[i];
      var tr = document.createElement('tr');
      tr.className = 'dg-schema-row' + (i % 2 !== 0 ? ' dg-schema-row-alt' : '');

      // Name
      var tdName = document.createElement('td');
      tdName.className = 'dg-schema-td dg-schema-td-name';
      tdName.textContent = col.name || '';
      tr.appendChild(tdName);

      // Type
      var tdType = document.createElement('td');
      tdType.className = 'dg-schema-td dg-schema-td-type';
      tdType.textContent = col.data_type || '';
      tr.appendChild(tdType);

      // PK
      var tdPk = document.createElement('td');
      tdPk.className = 'dg-schema-td dg-schema-td-center';
      if (col.is_primary_key) {
        var keyIcon = document.createElement('span');
        keyIcon.className = 'dg-schema-pk-badge';
        keyIcon.textContent = 'PK';
        tdPk.appendChild(keyIcon);
      }
      tr.appendChild(tdPk);

      // Nullable
      var tdNull = document.createElement('td');
      tdNull.className = 'dg-schema-td dg-schema-td-center' + (col.is_nullable ? ' dg-schema-nullable' : ' dg-schema-not-nullable');
      tdNull.textContent = col.is_nullable ? '\u2611' : '\u2610';
      tr.appendChild(tdNull);

      // Description + metadata
      var tdDesc = document.createElement('td');
      tdDesc.className = 'dg-schema-td dg-schema-td-desc';
      tdDesc.textContent = col.description || '';

      // Metadata tags
      var metadata = col.metadata;
      if (metadata && typeof metadata === 'object') {
        var keys = Object.keys(metadata);
        if (keys.length > 0) {
          var tagsDiv = document.createElement('div');
          tagsDiv.className = 'dg-schema-tags';
          for (var m = 0; m < keys.length; m++) {
            var tag = document.createElement('span');
            tag.className = 'dg-schema-tag';
            tag.textContent = keys[m] + ': ' + String(metadata[keys[m]]);
            tagsDiv.appendChild(tag);
          }
          tdDesc.appendChild(tagsDiv);
        }
      }

      tr.appendChild(tdDesc);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function formatValue(val) {
    if (val === null || val === undefined) return '(empty)';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }
})();
