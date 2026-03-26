// @ts-nocheck
/* Dependencies renderer — get_dependencies */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  var IMPORT_TYPE_COLORS = {
    NAMED: { bg: '#dbeafe', text: '#1e40af' },
    DEFAULT: { bg: '#f3e8ff', text: '#6b21a8' },
    PACKAGE: { bg: '#dcfce7', text: '#166534' },
    NAMESPACE: { bg: '#fef9c3', text: '#854d0e' },
    SIDE_EFFECT: { bg: '#ffedd5', text: '#9a3412' },
    DYNAMIC: { bg: '#fee2e2', text: '#991b1b' },
    REEXPORT: { bg: '#e0e7ff', text: '#3730a3' },
  };

  var DEFAULT_IMPORT_COLOR = { bg: '#f3f4f6', text: '#374151' };

  var STYLES = {
    summaryBar: 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:#f9fafb;border-radius:6px;',
    depRow: 'display:flex;align-items:center;gap:6px;padding:6px 12px;flex-wrap:wrap;',
    monoTarget: 'font-family:monospace;font-size:12px;color:#60a5fa;',
    nameChip: 'display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-family:monospace;color:#737373;background:#f3f4f6;',
  };

  /**
   * @param {HTMLElement} container
   * @param {unknown} data
   * @param {Record<string, unknown>} meta
   * @param {Record<string, unknown>} toolArgs
   * @param {boolean} reviewRequired
   * @param {(decision: string | Record<string, string>) => void} onDecision
   */
  window.__renderers.dependencies = function renderDependencies(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var utils = window.__companionUtils;
    var items = (data && data.data) || data || [];
    if (!Array.isArray(items)) { items = []; }

    // Summary bar
    var summary = document.createElement('div');
    summary.style.cssText = STYLES.summaryBar;
    summary.appendChild(utils.createBadge(items.length + ' dependenc' + (items.length !== 1 ? 'ies' : 'y'), '#f3f4f6', '#171717'));
    container.appendChild(summary);

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:#737373;text-align:center;padding:32px;';
      empty.textContent = 'No dependencies found';
      container.appendChild(empty);
      return;
    }

    // Detect compact mode: no importType field
    var isCompact = !items[0].importType && !items[0].import_type;

    // Group by sourceFile
    var groups = {};
    var groupOrder = [];
    for (var i = 0; i < items.length; i++) {
      var source = items[i].sourceFile || items[i].source_file || '(unknown)';
      if (!groups[source]) {
        groups[source] = [];
        groupOrder.push(source);
      }
      groups[source].push(items[i]);
    }

    for (var g = 0; g < groupOrder.length; g++) {
      container.appendChild(renderSourceGroup(groupOrder[g], groups[groupOrder[g]], isCompact, utils));
    }
  };

  function renderSourceGroup(sourceFile, deps, isCompact, utils) {
    var section = utils.buildCollapsibleSection(sourceFile, function (body) {
      body.style.padding = '4px 0';
      for (var i = 0; i < deps.length; i++) {
        body.appendChild(renderDepRow(deps[i], isCompact, utils));
      }
    }, { expanded: true });

    // Customize: monospace title + count badge
    var header = section.firstChild;
    var titleSpan = header.children[1];
    titleSpan.style.fontFamily = 'monospace';

    header.appendChild(utils.createBadge(deps.length + '', '#f3f4f6', '#525252'));

    return section;
  }

  function renderDepRow(dep, isCompact, utils) {
    var row = document.createElement('div');
    row.style.cssText = STYLES.depRow;

    // Arrow
    var arrow = document.createElement('span');
    arrow.style.cssText = 'color:#a3a3a3;font-size:13px;flex-shrink:0;';
    arrow.textContent = '\u2192';
    row.appendChild(arrow);

    // Target file
    var target = document.createElement('span');
    target.style.cssText = STYLES.monoTarget;
    target.textContent = dep.targetFile || dep.target_file || '(unknown)';
    row.appendChild(target);

    if (!isCompact) {
      // Import type badge
      var importType = (dep.importType || dep.import_type || '').toUpperCase();
      if (importType) {
        var colors = IMPORT_TYPE_COLORS[importType] || DEFAULT_IMPORT_COLOR;
        row.appendChild(utils.createBadge(importType, colors.bg, colors.text));
      }

      // Imported names as small chips
      var names = dep.importedNames || dep.imported_names || [];
      if (names && names.length > 0) {
        var namesContainer = document.createElement('span');
        namesContainer.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';
        for (var n = 0; n < names.length; n++) {
          var chip = document.createElement('span');
          chip.style.cssText = STYLES.nameChip;
          chip.textContent = names[n];
          namesContainer.appendChild(chip);
        }
        row.appendChild(namesContainer);
      }
    }

    return row;
  }
})();
