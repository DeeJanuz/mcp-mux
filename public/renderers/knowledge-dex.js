// @ts-nocheck
/* Knowledge Dex renderer — manage_knowledge_entries (table view with per-entry accept/reject) */

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
  window.__renderers.knowledge_dex = function renderKnowledgeDex(container, data, meta, toolArgs, reviewRequired, onDecision) {
    var utils = window.__companionUtils;
    container.innerHTML = '';

    // ── Shared CSS style constants (TD-306) ──
    var STYLES = {
      oldText: 'color:#a3a3a3;text-decoration:line-through;',
      arrow: 'color:#a3a3a3;margin:0 6px;',
      newText: 'color:#171717;font-weight:700;',
      descCell: 'color:#737373;font-size:13px;max-width:300px;',
      oldDesc: 'color:#a3a3a3;text-decoration:line-through;font-size:12px;margin-bottom:2px;',
      newDesc: 'color:#737373;font-size:13px;'
    };

    // ── Diff detection / rendering helpers (TD-305) ──

    /** Check if entry.previous[field] differs from entry[field].
     *  For 'name': uses truthy check (empty previous name is not a rename).
     *  For other fields (e.g. 'description'): uses !== undefined check. */
    function isFieldChanged(entry, field) {
      if (!entry.previous) return false;
      if (field === 'name') return !!entry.previous[field] && entry.previous[field] !== entry[field];
      return entry.previous[field] !== undefined && entry.previous[field] !== entry[field];
    }

    /**
     * Render a name cell with optional rename diff and mode badge.
     * @param {HTMLElement} cell - The <td> element to populate
     * @param {string} name - Current name
     * @param {string|undefined} previousName - Previous name (from entry.previous)
     * @param {boolean} isRoot - Whether this is a root entity row
     * @param {string} mode - Entry mode ('create'|'update'|'reference')
     * @param {boolean} isRenamed - Whether the name changed
     */
    function renderNameCell(cell, name, previousName, isRoot, mode, isRenamed) {
      var prefix = isRoot ? '' : '  \u21b3 ';
      if (isRenamed) {
        var oldSpan = document.createElement('span');
        oldSpan.style.cssText = STYLES.oldText + 'font-weight:' + (isRoot ? '600' : '400') + ';';
        oldSpan.textContent = prefix + previousName;
        cell.appendChild(oldSpan);
        var arrowSpan = document.createElement('span');
        arrowSpan.style.cssText = STYLES.arrow;
        arrowSpan.textContent = '\u2192';
        cell.appendChild(arrowSpan);
        var newSpan = document.createElement('span');
        newSpan.style.cssText = STYLES.newText;
        newSpan.textContent = name || '';
        cell.appendChild(newSpan);
      } else {
        var nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color:#171717;font-weight:' + (isRoot ? '600' : '400') + ';';
        nameSpan.textContent = prefix + (name || '');
        cell.appendChild(nameSpan);
      }
      // Badge: RENAMED overrides the mode badge
      var badgeCfg = isRenamed ? modeBadges.renamed : modeBadges[mode];
      if (badgeCfg) {
        var badge = utils.createBadge(badgeCfg.text, badgeCfg.bg, badgeCfg.color);
        badge.style.marginLeft = '8px';
        cell.appendChild(badge);
      }
    }

    /**
     * Render a description cell with optional old/new diff.
     * @param {HTMLElement} cell - The <td> element to populate
     * @param {string} description - Current description
     * @param {string|undefined} previousDesc - Previous description
     * @param {number} truncateOld - Max length for old description
     * @param {number} truncateNew - Max length for new/current description
     */
    function renderDescCell(cell, description, previousDesc, truncateOld, truncateNew) {
      cell.style.cssText = STYLES.descCell;
      var changed = previousDesc !== undefined && previousDesc !== description;
      if (changed) {
        var oldDiv = document.createElement('div');
        oldDiv.style.cssText = STYLES.oldDesc;
        oldDiv.textContent = utils.truncate(previousDesc || '', truncateOld);
        cell.appendChild(oldDiv);
        var newDiv = document.createElement('div');
        newDiv.style.cssText = STYLES.newDesc;
        newDiv.textContent = utils.truncate(description || '', truncateNew);
        cell.appendChild(newDiv);
      } else {
        cell.textContent = utils.truncate(description || '', truncateNew);
      }
    }

    // Determine action and extract entries
    var action = (toolArgs && toolArgs.action) || 'list';
    var entries = [];

    if (data.entries) entries = data.entries;
    else if (data.entry) entries = [data.entry];
    else if (Array.isArray(data)) entries = data;

    // For mappings, show a different view
    if (data.mappings || action === 'get_mappings' || action === 'map' || action === 'bulk_map') {
      renderMappingsView(container, data, meta, utils);
      return;
    }

    // Determine mode
    var isReadOnly = !reviewRequired && (action === 'list' || action === 'get_mappings');

    // ── Mode detection helpers ──

    /** Derive default mode from toolArgs.action */
    function defaultModeFromAction() {
      if (action === 'bulk_create' || action === 'create') return 'create';
      if (action === 'update') return 'update';
      // bulk_upsert: entries should carry their own mode; fallback to create
      if (action === 'bulk_upsert') return 'create';
      return 'create';
    }

    /** Resolve mode for a single entry */
    function resolveMode(entry, fallback) {
      if (entry.mode === 'create' || entry.mode === 'update' || entry.mode === 'reference') return entry.mode;
      if (entry.reused) return 'reference';
      return fallback;
    }

    var actionDefault = defaultModeFromAction();

    // ── Mode maps ──
    var entryModes = {};       // key -> 'create' | 'update' | 'reference'
    var parentKeyForAttr = {}; // attrKey -> parentKey
    var childKeysForParent = {}; // parentKey -> [attrKey, ...]

    // ── Mode badge config ──
    var modeBadges = {
      create:    { text: 'NEW',      bg: '#dcfce7', color: '#166534' },
      update:    { text: 'MODIFIED', bg: '#dbeafe', color: '#1e40af' },
      reference: { text: 'REF',      bg: '#f3f4f6', color: '#737373' },
      renamed:   { text: 'RENAMED',  bg: '#fff7ed', color: '#9a3412' }
    };
    var modeBorders = {
      create:    '3px solid #22c55e',
      update:    '3px solid #3b82f6',
      reference: 'none'
    };

    // Header
    var headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';

    var titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'display:flex;align-items:center;gap:12px;';
    var title = document.createElement('h2');
    title.style.cssText = 'font-size:18px;font-weight:600;color:#171717;margin:0;';
    var hasCreate = actionDefault === 'create' || action === 'bulk_upsert';
    var hasUpdate = actionDefault === 'update' || action === 'bulk_upsert';
    title.textContent = hasCreate && !hasUpdate ? 'New Knowledge Dex Entries'
      : hasUpdate && !hasCreate ? 'Updated Entry'
      : 'Knowledge Dex Entries';
    titleDiv.appendChild(title);
    titleDiv.appendChild(utils.createBadge(entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies'), '#f3f4f6', '#171717'));
    headerDiv.appendChild(titleDiv);

    // Decision tracking
    var decisions = {};

    // Collect all decidable keys (entries + attributes) — reference entries excluded
    var allKeys = [];

    // First pass: compute modes and keys
    entries.forEach(function (entry, idx) {
      var key = entry.id || entry.name || ('entry-' + idx);
      var mode = resolveMode(entry, actionDefault);
      entryModes[key] = mode;
      childKeysForParent[key] = [];

      if (mode !== 'reference') {
        allKeys.push(key);
      }

      if (entry.attributes && entry.attributes.length > 0) {
        entry.attributes.forEach(function (attr, attrIdx) {
          var attrKey = attr.id || (key + '-attr-' + attrIdx);
          // Attribute inherits parent mode unless it has its own explicit mode
          var attrMode = resolveMode(attr, mode);
          entryModes[attrKey] = attrMode;
          parentKeyForAttr[attrKey] = key;
          childKeysForParent[key].push(attrKey);

          if (attrMode !== 'reference') {
            allKeys.push(attrKey);
          }
        });
      }
    });

    // Bulk actions (only if there are decidable entries)
    if (!isReadOnly && allKeys.length > 0) {
      var bulkDiv = document.createElement('div');
      bulkDiv.style.cssText = 'display:flex;gap:8px;';

      bulkDiv.appendChild(utils.createButton('Accept All', {
        bg: '#dcfce7', color: '#166534',
        onclick: function () {
          allKeys.forEach(function (k) { decisions[k] = 'accepted'; });
          refreshAll();
        }
      }));
      bulkDiv.appendChild(utils.createButton('Reject All', {
        bg: '#fee2e2', color: '#991b1b',
        onclick: function () {
          allKeys.forEach(function (k) { decisions[k] = 'rejected'; });
          refreshAll();
        }
      }));
      headerDiv.appendChild(bulkDiv);
    }
    container.appendChild(headerDiv);

    // Summary bar (only for actionable)
    var summaryBar = null;
    if (!isReadOnly && allKeys.length > 0) {
      summaryBar = document.createElement('div');
      summaryBar.className = 'summary-bar';
      summaryBar.style.marginBottom = '16px';
      container.appendChild(summaryBar);
    }

    // Table
    var table = document.createElement('table');
    table.className = 'kdx-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var columns = ['Name', 'Description', 'Data Sources'];
    if (!isReadOnly) columns.push('Action');
    columns.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var rowElements = {};
    var actionCells = {};
    var collapsedState = {};   // parentKey -> boolean (true = collapsed)
    var childRowsForParent = {}; // parentKey -> [tr, ...]

    entries.forEach(function (entry, idx) {
      var isRoot = !entry.parent_id && !entry.parentId;
      var key = entry.id || entry.name || ('entry-' + idx);
      var mode = entryModes[key];
      var hasChildren = entry.attributes && entry.attributes.length > 0;

      var tr = document.createElement('tr');
      tr.className = isRoot ? 'kdx-root-row' : 'kdx-attr-row';
      // Apply mode-specific left border (overrides CSS class default)
      tr.style.borderLeft = modeBorders[mode];
      if (mode === 'reference') {
        tr.style.opacity = '0.6';
      }
      rowElements[key] = tr;

      // Name cell with mode badge and rename detection
      var nameCell = document.createElement('td');
      var isRenamed = isFieldChanged(entry, 'name');

      // Add collapse toggle for root entries with children
      if (isRoot && hasChildren) {
        collapsedState[key] = true; // collapsed by default
        childRowsForParent[key] = [];
        var toggle = document.createElement('span');
        toggle.className = 'kdx-collapse-toggle';
        toggle.textContent = '\u25b6'; // right-pointing triangle (collapsed)
        toggle.style.cssText = 'cursor:pointer;margin-right:6px;font-size:11px;color:#a3a3a3;transition:transform 0.15s ease;display:inline-block;user-select:none;';
        toggle.setAttribute('data-parent-key', key);
        toggle.addEventListener('click', (function (parentKey, toggleEl) {
          return function (e) {
            e.stopPropagation();
            collapsedState[parentKey] = !collapsedState[parentKey];
            toggleEl.style.transform = collapsedState[parentKey] ? 'rotate(0deg)' : 'rotate(90deg)';
            var rows = childRowsForParent[parentKey] || [];
            rows.forEach(function (childTr) {
              childTr.style.display = collapsedState[parentKey] ? 'none' : '';
            });
          };
        })(key, toggle));
        nameCell.appendChild(toggle);
      }

      renderNameCell(nameCell, entry.name, entry.previous && entry.previous.name, isRoot, mode, isRenamed);
      tr.appendChild(nameCell);

      // Make root row with children clickable to toggle
      if (isRoot && hasChildren) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (function (parentKey) {
          return function () {
            var toggleEl = tr.querySelector('.kdx-collapse-toggle');
            if (toggleEl) toggleEl.click();
          };
        })(key));
      }

      // Description cell with change detection
      var descCell = document.createElement('td');
      renderDescCell(descCell, entry.description, isFieldChanged(entry, 'description') ? entry.previous.description : undefined, 100, 120);
      tr.appendChild(descCell);

      // Data sources cell
      var dsCell = document.createElement('td');
      if (entry.mappings && entry.mappings.length > 0) {
        entry.mappings.forEach(function (m) {
          var chip = document.createElement('span');
          chip.className = 'kdx-chip';
          var label = utils.escapeHtml(m.dataSourceName || m.data_source_name || '');
          if (m.tableName || m.table_name) label += ' &gt; ' + utils.escapeHtml(m.tableName || m.table_name);
          if (m.columnName || m.column_name) label += '.' + utils.escapeHtml(m.columnName || m.column_name);
          chip.innerHTML = label;
          dsCell.appendChild(chip);
        });
      } else {
        var empty = document.createElement('span');
        empty.style.cssText = 'color:#a3a3a3;font-size:12px;';
        empty.textContent = '\u2014';
        dsCell.appendChild(empty);
      }
      tr.appendChild(dsCell);

      // Action cell — only for decidable (non-reference) entries
      if (!isReadOnly) {
        if (mode !== 'reference') {
          tr.appendChild(createActionCell(key));
        } else {
          // Empty cell for alignment
          var emptyAction = document.createElement('td');
          tr.appendChild(emptyAction);
        }
      }

      tbody.appendChild(tr);

      // Render attributes as child rows
      if (hasChildren) {
        entry.attributes.forEach(function (attr, attrIdx) {
          var attrKey = attr.id || (key + '-attr-' + attrIdx);
          var attrMode = entryModes[attrKey];

          var attrTr = document.createElement('tr');
          attrTr.className = 'kdx-attr-row';
          attrTr.style.borderLeft = modeBorders[attrMode];
          attrTr.style.display = 'none'; // collapsed by default
          if (attrMode === 'reference') {
            attrTr.style.opacity = '0.6';
          }
          rowElements[attrKey] = attrTr;
          childRowsForParent[key].push(attrTr);

          var attrName = document.createElement('td');
          attrName.style.color = '#171717';
          var attrIsRenamed = isFieldChanged(attr, 'name');
          renderNameCell(attrName, attr.name, attr.previous && attr.previous.name, false, attrMode, attrIsRenamed);
          attrTr.appendChild(attrName);

          var attrDesc = document.createElement('td');
          renderDescCell(attrDesc, attr.description, isFieldChanged(attr, 'description') ? attr.previous.description : undefined, 80, 100);
          attrTr.appendChild(attrDesc);

          var attrDs = document.createElement('td');
          var attrDash = document.createElement('span');
          attrDash.style.cssText = 'color:#a3a3a3;font-size:12px;';
          attrDash.textContent = '\u2014';
          attrDs.appendChild(attrDash);
          attrTr.appendChild(attrDs);

          if (!isReadOnly) {
            if (attrMode !== 'reference') {
              attrTr.appendChild(createActionCell(attrKey));
            } else {
              var emptyAttrAction = document.createElement('td');
              attrTr.appendChild(emptyAttrAction);
            }
          }

          tbody.appendChild(attrTr);
        });
      }
    });

    function createActionCell(key) {
      var actionCell = document.createElement('td');
      actionCell.style.cssText = 'white-space:nowrap;';

      var acceptBtn = utils.createSmallButton('\u2713', {
        bg: '#f3f4f6', color: '#525252',
        onclick: function () {
          decisions[key] = 'accepted';
          // Cascading: accepting a create-mode attribute auto-accepts its parent
          var parentKey = parentKeyForAttr[key];
          if (parentKey && entryModes[parentKey] === 'create' && decisions[parentKey] !== 'accepted') {
            decisions[parentKey] = 'accepted';
          }
          refreshAll();
        }
      });

      var rejectBtn = utils.createSmallButton('\u2717', {
        bg: '#f3f4f6', color: '#525252',
        onclick: function () {
          decisions[key] = 'rejected';
          // Cascading: rejecting a create-mode parent auto-rejects all children
          if (entryModes[key] === 'create' && childKeysForParent[key]) {
            childKeysForParent[key].forEach(function (childKey) {
              if (entryModes[childKey] !== 'reference') {
                decisions[childKey] = 'rejected';
              }
            });
          }
          refreshAll();
        }
      });

      actionCell.appendChild(acceptBtn);
      actionCell.appendChild(document.createTextNode(' '));
      actionCell.appendChild(rejectBtn);
      actionCells[key] = { cell: actionCell, acceptBtn: acceptBtn, rejectBtn: rejectBtn };
      return actionCell;
    }

    table.appendChild(tbody);
    container.appendChild(table);

    // Initial summary render (after allKeys is populated)
    updateSummary();

    // Submit button
    var submitBtn = null;
    if (!isReadOnly && allKeys.length > 0) {
      submitBtn = utils.createButton('Submit Decisions', {
        bg: '#1d4ed8', color: '#dbeafe',
        onclick: function () {
          onDecision({ type: 'operation_decisions', decisions: decisions });
        }
      });
      submitBtn.style.cssText += 'margin-top:16px;display:none;';
      container.appendChild(submitBtn);
    }

    function updateRow(key) {
      var tr = rowElements[key];
      if (!tr) return;
      var btns = actionCells[key];
      var mode = entryModes[key];
      var borderStyle = modeBorders[mode];

      // Check if this is a create-mode child whose parent was rejected (force-rejected)
      var parentKey = parentKeyForAttr[key];
      var forceRejected = parentKey && entryModes[parentKey] === 'create' && decisions[parentKey] === 'rejected' && mode !== 'reference';

      if (decisions[key] === 'accepted') {
        tr.style.opacity = '1';
        tr.style.background = 'rgba(34, 197, 94, 0.12)';
        tr.style.textDecoration = 'none';
        tr.style.borderLeft = borderStyle;
        if (btns) {
          btns.acceptBtn.style.display = 'inline-block';
          btns.acceptBtn.style.backgroundColor = '#dcfce7';
          btns.acceptBtn.style.color = '#166534';
          btns.acceptBtn.style.pointerEvents = '';
          btns.acceptBtn.style.opacity = '1';
          btns.rejectBtn.style.display = 'inline-block';
          btns.rejectBtn.style.backgroundColor = '#f3f4f6';
          btns.rejectBtn.style.color = '#525252';
          btns.rejectBtn.style.pointerEvents = '';
          btns.rejectBtn.style.opacity = '1';
        }
      } else if (decisions[key] === 'rejected') {
        tr.style.opacity = forceRejected ? '0.4' : '0.5';
        tr.style.background = 'rgba(239, 68, 68, 0.08)';
        tr.style.textDecoration = 'line-through';
        tr.style.borderLeft = borderStyle;
        if (btns) {
          btns.acceptBtn.style.display = 'inline-block';
          btns.acceptBtn.style.backgroundColor = '#f3f4f6';
          btns.acceptBtn.style.color = '#525252';
          btns.rejectBtn.style.display = 'inline-block';
          btns.rejectBtn.style.backgroundColor = '#fee2e2';
          btns.rejectBtn.style.color = '#991b1b';
          if (forceRejected) {
            // Disable buttons on force-rejected children
            btns.acceptBtn.style.pointerEvents = 'none';
            btns.acceptBtn.style.opacity = '0.5';
            btns.rejectBtn.style.pointerEvents = 'none';
            btns.rejectBtn.style.opacity = '0.5';
          } else {
            btns.acceptBtn.style.pointerEvents = '';
            btns.acceptBtn.style.opacity = '1';
            btns.rejectBtn.style.pointerEvents = '';
            btns.rejectBtn.style.opacity = '1';
          }
        }
      } else {
        // Pending — reset to neutral
        tr.style.opacity = mode === 'reference' ? '0.6' : '1';
        tr.style.background = '';
        tr.style.textDecoration = 'none';
        tr.style.borderLeft = borderStyle;
        if (btns) {
          btns.acceptBtn.style.display = 'inline-block';
          btns.acceptBtn.style.backgroundColor = '#f3f4f6';
          btns.acceptBtn.style.color = '#525252';
          btns.acceptBtn.style.pointerEvents = '';
          btns.acceptBtn.style.opacity = '1';
          btns.rejectBtn.style.display = 'inline-block';
          btns.rejectBtn.style.backgroundColor = '#f3f4f6';
          btns.rejectBtn.style.color = '#525252';
          btns.rejectBtn.style.pointerEvents = '';
          btns.rejectBtn.style.opacity = '1';
        }
      }
    }

    function refreshAll() {
      allKeys.forEach(updateRow);
      // Also refresh reference rows (they aren't in allKeys but may need visual updates)
      Object.keys(entryModes).forEach(function (k) {
        if (entryModes[k] === 'reference' && !allKeys.includes(k)) {
          updateRow(k);
        }
      });
      updateSummary();
      updateSubmitState();
    }

    function updateSummary() {
      if (!summaryBar) return;
      var accepted = allKeys.filter(function (k) { return decisions[k] === 'accepted'; }).length;
      var rejected = allKeys.filter(function (k) { return decisions[k] === 'rejected'; }).length;
      var pending = allKeys.length - accepted - rejected;
      summaryBar.innerHTML = '<span style="color:#171717"><span class="count">' + allKeys.length + '</span> items</span>'
        + '<span class="accepted"><span class="count">' + accepted + '</span> accepted</span>'
        + '<span class="rejected"><span class="count">' + rejected + '</span> rejected</span>'
        + '<span class="pending"><span class="count">' + pending + '</span> pending</span>';
    }

    function updateSubmitState() {
      if (!submitBtn) return;
      var allDecided = allKeys.every(function (k) { return decisions[k]; });
      submitBtn.style.display = allDecided ? 'inline-block' : 'none';
    }
  };

  /* ── Mappings sub-view ── */

  function renderMappingsView(container, data, meta, utils) {
    var mappings = data.mappings || [];
    var title = document.createElement('h2');
    title.style.cssText = 'font-size:18px;font-weight:600;color:#171717;margin:0 0 16px;';
    title.textContent = 'Knowledge Dex Mappings';
    container.appendChild(title);

    if (mappings.length === 0) {
      var emptyMsg = document.createElement('p');
      emptyMsg.style.cssText = 'color:#737373;';
      emptyMsg.textContent = 'No mappings found.';
      container.appendChild(emptyMsg);
      return;
    }

    var table = document.createElement('table');
    table.className = 'kdx-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    ['Concept', 'Data Source', 'Table', 'Column'].forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    mappings.forEach(function (m) {
      var tr = document.createElement('tr');

      var conceptCell = document.createElement('td');
      conceptCell.style.color = '#171717';
      conceptCell.textContent = m.entryName || m.entry_name || '';
      tr.appendChild(conceptCell);

      var dsCell = document.createElement('td');
      dsCell.style.color = '#171717';
      dsCell.textContent = m.dataSourceName || m.data_source_name || '';
      tr.appendChild(dsCell);

      var tableCell = document.createElement('td');
      tableCell.style.color = '#171717';
      tableCell.textContent = m.tableName || m.table_name || '';
      tr.appendChild(tableCell);

      var colCell = document.createElement('td');
      colCell.style.color = '#171717';
      colCell.textContent = m.columnName || m.column_name || '';
      tr.appendChild(colCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }
})();
