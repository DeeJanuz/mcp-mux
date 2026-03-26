// @ts-nocheck
/* File content renderer — get_file_content */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  var STYLES = {
    summaryBar: 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:#f9fafb;border-radius:6px;',
    fileCard: 'margin:8px 0;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;',
    fileHeader: 'display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f9fafb;border-bottom:1px solid #e5e5e5;flex-wrap:wrap;',
    monoPath: 'font-family:monospace;font-size:13px;font-weight:600;color:#171717;',
    codeBlock: 'margin:0;padding:16px;background:#1e1e2e;color:#cdd6f4;font-family:monospace;font-size:12px;line-height:1.6;overflow-x:auto;',
    lineNumber: 'color:#6c7086;min-width:40px;display:inline-block;text-align:right;margin-right:12px;user-select:none;flex-shrink:0;',
  };

  /**
   * @param {HTMLElement} container
   * @param {unknown} data
   * @param {Record<string, unknown>} meta
   * @param {Record<string, unknown>} toolArgs
   * @param {boolean} reviewRequired
   * @param {(decision: string | Record<string, string>) => void} onDecision
   */
  window.__renderers.file_content = function renderFileContent(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var utils = window.__companionUtils;
    var parsed = (data && data.data) || data || {};

    // Determine single file or multiple files
    var files = [];
    if (parsed.files && Array.isArray(parsed.files)) {
      files = parsed.files;
    } else if (parsed.file) {
      files = [parsed.file];
    } else if (parsed.path || parsed.content) {
      // Direct file object
      files = [parsed];
    }

    // Summary bar
    var summary = document.createElement('div');
    summary.style.cssText = STYLES.summaryBar;
    summary.appendChild(utils.createBadge(files.length + ' file' + (files.length !== 1 ? 's' : ''), '#f3f4f6', '#171717'));
    container.appendChild(summary);

    if (files.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:#737373;text-align:center;padding:32px;';
      empty.textContent = 'No files returned';
      container.appendChild(empty);
      return;
    }

    for (var i = 0; i < files.length; i++) {
      container.appendChild(renderFileCard(files[i], utils));
    }
  };

  function renderFileCard(file, utils) {
    // Handle null/not-found entries
    if (!file) {
      var errorCard = document.createElement('div');
      errorCard.style.cssText = 'margin:8px 0;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:13px;';
      errorCard.textContent = 'File not found';
      return errorCard;
    }

    var card = document.createElement('div');
    card.style.cssText = STYLES.fileCard;

    // Header
    var header = document.createElement('div');
    header.style.cssText = STYLES.fileHeader;

    var pathEl = document.createElement('span');
    pathEl.style.cssText = STYLES.monoPath;
    pathEl.textContent = file.path || '(unknown path)';
    header.appendChild(pathEl);

    // Size badge
    if (file.size != null) {
      var sizeStr = file.size >= 1024 ? (file.size / 1024).toFixed(1) + ' KB' : file.size + ' B';
      header.appendChild(utils.createBadge(sizeStr, '#f3f4f6', '#525252'));
    }

    // Line range badge
    var returnedLines = file.returnedLines || file.returned_lines;
    var totalLines = file.totalLines || file.total_lines;
    if (returnedLines && totalLines) {
      var rangeText = 'lines ' + returnedLines.start + '-' + returnedLines.end + ' of ' + totalLines;
      header.appendChild(utils.createBadge(rangeText, '#dbeafe', '#1e40af'));
    } else if (totalLines) {
      header.appendChild(utils.createBadge(totalLines + ' lines', '#dbeafe', '#1e40af'));
    }

    // Truncated warning
    if (file.truncated) {
      header.appendChild(utils.createBadge('TRUNCATED', '#fef9c3', '#854d0e'));
    }

    card.appendChild(header);

    // Code content
    if (file.content != null) {
      var codeWrapper = document.createElement('div');
      codeWrapper.style.cssText = 'overflow-x:auto;';

      var pre = document.createElement('pre');
      pre.style.cssText = STYLES.codeBlock;

      var lines = file.content.split('\n');
      var startLine = (returnedLines && returnedLines.start) ? returnedLines.start : 1;

      var html = lines.map(function (line, li) {
        var lineNum = '<span style="' + STYLES.lineNumber + '">' + (startLine + li) + '</span>';
        return lineNum + utils.escapeHtml(line);
      }).join('\n');

      pre.innerHTML = html;
      codeWrapper.appendChild(pre);
      card.appendChild(codeWrapper);
    } else {
      var noContent = document.createElement('div');
      noContent.style.cssText = 'padding:16px;color:#737373;font-size:13px;';
      noContent.textContent = 'No content available';
      card.appendChild(noContent);
    }

    return card;
  }
})();
