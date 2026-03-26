// @ts-nocheck
/* Module overview renderer — get_module_overview */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  var EXPORT_TYPE_COLORS = {
    function: { bg: '#dbeafe', text: '#1e40af' },
    class: { bg: '#f3e8ff', text: '#6b21a8' },
    interface: { bg: '#dcfce7', text: '#166534' },
    type: { bg: '#fef9c3', text: '#854d0e' },
    variable: { bg: '#f3f4f6', text: '#374151' },
    method: { bg: '#e0e7ff', text: '#3730a3' },
    enum: { bg: '#ffedd5', text: '#9a3412' },
  };

  var DEFAULT_EXPORT_COLOR = { bg: '#f3f4f6', text: '#374151' };

  var STYLES = {
    summaryBar: 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:#f9fafb;border-radius:6px;flex-wrap:wrap;',
    depRow: 'display:flex;align-items:center;gap:6px;padding:4px 8px;flex-wrap:wrap;',
    monoSmall: 'font-family:monospace;font-size:12px;color:#171717;',
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
  window.__renderers.module_overview = function renderModuleOverview(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var utils = window.__companionUtils;
    var overview = (data && data.data) || data || {};

    // Header: directory + repo badge
    var headerEl = document.createElement('div');
    headerEl.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;';

    var dirEl = document.createElement('span');
    dirEl.style.cssText = 'font-family:monospace;font-size:15px;font-weight:700;color:#171717;';
    dirEl.textContent = overview.directory || '(unknown directory)';
    headerEl.appendChild(dirEl);

    var repo = overview.repository;
    if (repo) {
      headerEl.appendChild(utils.createBadge(repo.name || repo.fullName || repo.full_name || '', '#dbeafe', '#1e40af'));
    }

    container.appendChild(headerEl);

    // Summary bar: 4 metric badges
    var summaryData = overview.summary || {};
    var summaryBar = document.createElement('div');
    summaryBar.style.cssText = STYLES.summaryBar;

    var metricItems = [
      { label: 'files', value: summaryData.total_files || 0 },
      { label: 'exports', value: summaryData.total_exports || 0 },
      { label: 'internal deps', value: summaryData.total_internal_deps || 0 },
      { label: 'external deps', value: summaryData.total_external_deps || 0 },
    ];

    for (var m = 0; m < metricItems.length; m++) {
      summaryBar.appendChild(utils.createBadge(metricItems[m].value + ' ' + metricItems[m].label, '#f3f4f6', '#171717'));
    }

    container.appendChild(summaryBar);

    // File Tree (collapsible)
    var fileTree = overview.file_tree || [];
    if (fileTree.length > 0) {
      container.appendChild(utils.buildCollapsibleSection('File Tree (' + fileTree.length + ')', function (body) {
        for (var i = 0; i < fileTree.length; i++) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 8px;';

          var pathSpan = document.createElement('span');
          pathSpan.style.cssText = 'font-family:monospace;font-size:12px;color:#171717;';
          pathSpan.textContent = fileTree[i].path || '';
          row.appendChild(pathSpan);

          if (fileTree[i].size != null) {
            var sizeStr = fileTree[i].size >= 1024 ? (fileTree[i].size / 1024).toFixed(1) + ' KB' : fileTree[i].size + ' B';
            row.appendChild(utils.createBadge(sizeStr, '#f3f4f6', '#a3a3a3'));
          }

          body.appendChild(row);
        }
      }));
    }

    // Exports (collapsible)
    var exports = overview.exports || [];
    if (exports.length > 0) {
      container.appendChild(utils.buildCollapsibleSection('Exports (' + exports.length + ')', function (body) {
        for (var i = 0; i < exports.length; i++) {
          body.appendChild(renderExportCard(exports[i], utils));
        }
      }));
    }

    // Internal Dependencies (collapsible)
    var internalDeps = overview.internal_dependencies || [];
    if (internalDeps.length > 0) {
      container.appendChild(utils.buildCollapsibleSection('Internal Dependencies (' + internalDeps.length + ')', function (body) {
        for (var i = 0; i < internalDeps.length; i++) {
          body.appendChild(renderDepRow(internalDeps[i], utils, true));
        }
      }));
    }

    // External Dependencies (collapsible)
    var externalDeps = overview.external_dependencies || [];
    if (externalDeps.length > 0) {
      container.appendChild(utils.buildCollapsibleSection('External Dependencies (' + externalDeps.length + ')', function (body) {
        for (var i = 0; i < externalDeps.length; i++) {
          body.appendChild(renderDepRow(externalDeps[i], utils, false));
        }
      }));
    }
  };

  function renderExportCard(exp, utils) {
    var card = document.createElement('div');
    card.style.cssText = 'padding:8px 12px;margin:4px 0;background:#ffffff;border:1px solid #f3f4f6;border-radius:6px;';

    // Top row: name + type badge
    var topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

    var nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-weight:600;color:#171717;font-size:13px;';
    nameEl.textContent = exp.name || '(unnamed)';
    topRow.appendChild(nameEl);

    var expType = (exp.type || '').toLowerCase();
    var colors = EXPORT_TYPE_COLORS[expType] || DEFAULT_EXPORT_COLOR;
    topRow.appendChild(utils.createBadge((exp.type || 'unknown').toUpperCase(), colors.bg, colors.text));

    card.appendChild(topRow);

    // File path
    if (exp.file) {
      var fileEl = document.createElement('div');
      fileEl.style.cssText = 'font-family:monospace;font-size:11px;color:#737373;margin-top:2px;';
      fileEl.textContent = exp.file;
      card.appendChild(fileEl);
    }

    // Signature
    if (exp.signature) {
      var sigEl = document.createElement('div');
      sigEl.style.cssText = 'font-family:monospace;font-size:11px;color:#a3a3a3;margin-top:4px;white-space:pre-wrap;word-break:break-all;';
      sigEl.textContent = exp.signature;
      card.appendChild(sigEl);
    }

    return card;
  }

  function renderDepRow(dep, utils, showImports) {
    var row = document.createElement('div');
    row.style.cssText = STYLES.depRow;

    var source = document.createElement('span');
    source.style.cssText = STYLES.monoSmall;
    source.textContent = dep.source || '';
    row.appendChild(source);

    var arrow = document.createElement('span');
    arrow.style.cssText = 'color:#a3a3a3;font-size:12px;';
    arrow.textContent = '\u2192';
    row.appendChild(arrow);

    var target = document.createElement('span');
    target.style.cssText = STYLES.monoTarget;
    target.textContent = dep.target || '';
    row.appendChild(target);

    // Import names (for internal deps)
    if (showImports) {
      var imports = dep.imports || [];
      if (imports.length > 0) {
        var importsContainer = document.createElement('span');
        importsContainer.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;';
        for (var n = 0; n < imports.length; n++) {
          var chip = document.createElement('span');
          chip.style.cssText = STYLES.nameChip;
          chip.textContent = imports[n];
          importsContainer.appendChild(chip);
        }
        row.appendChild(importsContainer);
      }
    }

    return row;
  }
})();
