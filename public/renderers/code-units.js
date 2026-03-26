// @ts-nocheck
/* Code units renderer — get_code_units */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  var UNIT_TYPE_COLORS = {
    function: { bg: '#dbeafe', text: '#1e40af' },
    class: { bg: '#f3e8ff', text: '#6b21a8' },
    interface: { bg: '#dcfce7', text: '#166534' },
    type: { bg: '#fef9c3', text: '#854d0e' },
    variable: { bg: '#f3f4f6', text: '#374151' },
    method: { bg: '#e0e7ff', text: '#3730a3' },
    enum: { bg: '#ffedd5', text: '#9a3412' },
  };

  var DEFAULT_COLOR = { bg: '#f3f4f6', text: '#374151' };

  /**
   * @param {HTMLElement} container
   * @param {unknown} data
   * @param {Record<string, unknown>} meta
   * @param {Record<string, unknown>} toolArgs
   * @param {boolean} reviewRequired
   * @param {(decision: string | Record<string, string>) => void} onDecision
   */
  window.__renderers.code_units = function renderCodeUnits(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var utils = window.__companionUtils;
    var items = (data && data.data) || data || [];
    if (!Array.isArray(items)) { items = []; }

    // Summary
    var summary = document.createElement('div');
    summary.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:#f9fafb;border-radius:6px;';
    summary.appendChild(utils.createBadge(items.length + ' code unit' + (items.length !== 1 ? 's' : ''), '#f3f4f6', '#171717'));
    container.appendChild(summary);

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:#737373;text-align:center;padding:32px;';
      empty.textContent = 'No code units found';
      container.appendChild(empty);
      return;
    }

    for (var i = 0; i < items.length; i++) {
      container.appendChild(renderCard(items[i], i));
    }
  };

  function renderCard(item, index) {
    var utils = window.__companionUtils;
    var card = document.createElement('div');
    card.style.cssText = 'margin:8px 0;padding:12px 16px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;';

    // Header: citation badge + name + type/exported/complexity badges
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;';

    // Citation badge
    var citeBadge = utils.renderCitationBadge('code', index);
    citeBadge.addEventListener('click', function (e) {
      e.stopPropagation();
      if (utils.openCitationPanel) {
        utils.openCitationPanel('code', item);
      }
    });
    header.appendChild(citeBadge);

    var name = document.createElement('span');
    name.style.cssText = 'font-weight:700;color:#171717;font-size:15px;';
    name.textContent = item.name || '(unnamed)';
    header.appendChild(name);

    var unitType = item.unit_type || 'other';
    var colors = UNIT_TYPE_COLORS[unitType] || DEFAULT_COLOR;
    header.appendChild(utils.createBadge(unitType.toUpperCase(), colors.bg, colors.text));

    if (item.exported) {
      header.appendChild(utils.createBadge('EXPORTED', '#dcfce7', '#166534'));
    }

    if (item.complexity != null) {
      var cxLabel, cxColor;
      if (item.complexity <= 5) {
        cxLabel = 'LOW'; cxColor = '#22c55e';
      } else if (item.complexity <= 15) {
        cxLabel = 'MEDIUM'; cxColor = '#eab308';
      } else {
        cxLabel = 'HIGH'; cxColor = '#ef4444';
      }
      header.appendChild(utils.createBadge('COMPLEXITY: ' + item.complexity + ' (' + cxLabel + ')', cxColor + '20', cxColor));
    }

    card.appendChild(header);

    // File path + line range
    if (item.file_path) {
      var fileLine = document.createElement('div');
      fileLine.style.cssText = 'font-family:monospace;font-size:12px;color:#60a5fa;margin-bottom:8px;';
      var text = item.file_path;
      if (item.line_start != null) {
        text += ':' + item.line_start;
        if (item.line_end != null) {
          text += '-' + item.line_end;
        }
      }
      fileLine.textContent = text;
      fileLine.title = text;
      card.appendChild(fileLine);
    }

    // Source code with line numbers
    if (item.source) {
      var sourceBlock = document.createElement('div');
      sourceBlock.style.cssText = 'margin:8px 0;overflow-x:auto;';

      var pre = document.createElement('pre');
      pre.className = 'md-codeblock';
      pre.style.cssText += 'font-size:12px;line-height:1.6;';

      var lines = item.source.split('\n');
      var startLine = item.line_start || 1;

      var html = lines.map(function (line, li) {
        var lineNum = '<span style="color:#6b7280;min-width:40px;display:inline-block;text-align:right;margin-right:12px;user-select:none;flex-shrink:0;">' + (startLine + li) + '</span>';
        return lineNum + utils.escapeHtml(line);
      }).join('\n');

      pre.innerHTML = html;
      sourceBlock.appendChild(pre);
      card.appendChild(sourceBlock);
    }

    // Patterns
    var patterns = item.patterns || [];
    if (patterns.length > 0) {
      var patternsDiv = document.createElement('div');
      patternsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;';

      for (var p = 0; p < patterns.length; p++) {
        var patText = typeof patterns[p] === 'string' ? patterns[p] : (patterns[p].name || String(patterns[p]));
        patternsDiv.appendChild(utils.createBadge(patText, '#f3f4f6', '#525252'));
      }

      card.appendChild(patternsDiv);
    }

    // References (collapsible)
    var references = item.references || [];
    if (references.length > 0) {
      var refsContainer = document.createElement('div');
      refsContainer.style.cssText = 'margin-top:8px;';

      var refsToggle = document.createElement('div');
      refsToggle.style.cssText = 'cursor:pointer;color:#737373;font-size:12px;user-select:none;';
      refsToggle.textContent = '\u25B6 References (' + references.length + ')';

      var refsList = document.createElement('div');
      refsList.style.cssText = 'display:none;margin-top:4px;padding-left:12px;';

      for (var r = 0; r < references.length; r++) {
        var refItem = document.createElement('div');
        refItem.style.cssText = 'font-family:monospace;font-size:11px;color:#737373;padding:1px 0;';
        var ref = references[r];
        refItem.textContent = typeof ref === 'string' ? ref : (ref.file_path || ref.name || JSON.stringify(ref));
        refsList.appendChild(refItem);
      }

      refsToggle.onclick = function () {
        var hidden = refsList.style.display === 'none';
        refsList.style.display = hidden ? 'block' : 'none';
        refsToggle.textContent = (hidden ? '\u25BC' : '\u25B6') + ' References (' + references.length + ')';
      };

      refsContainer.appendChild(refsToggle);
      refsContainer.appendChild(refsList);
      card.appendChild(refsContainer);
    }

    return card;
  }
})();
