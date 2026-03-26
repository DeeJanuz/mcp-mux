// @ts-nocheck
/* Rich content renderer — renders arbitrary markdown + mermaid + citations
 *
 * Data shape:
 * {
 *   title: "Optional Heading",        // Optional
 *   body: "## Markdown content\n\n```mermaid\ngraph LR\n  A-->B\n```\n\nMore text...",  // Required
 *   citations: { ... }                // Optional — same shape as search_results citations
 * }
 *
 * Also handles:
 * - Plain string input (treated as { body: data })
 * - Unknown data with no body/title (rendered as JSON fallback)
 */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  // ── Citation type map from legacy markers ──
  var CITE_TYPE_MAP = {
    documents: 'doc',
    code: 'code',
    dataGovernance: 'dg',
    data_governance: 'dg',
    api: 'api',
    knowledgeDex: 'kdex',
    knowledge_dex: 'kdex',
    dataLake: 'dl',
    data_lake: 'dl',
  };

  /**
   * Build a flat lookup map: { "doc:1": citationData, "code:2": citationData, ... }
   */
  function buildCitationMap(citations) {
    var map = {};
    if (!citations || typeof citations !== 'object') return map;

    Object.keys(citations).forEach(function (key) {
      var type = CITE_TYPE_MAP[key] || key;
      var items = citations[key];
      if (!Array.isArray(items)) return;
      items.forEach(function (item) {
        var idx = item.index != null ? item.index : item.number;
        if (idx != null) {
          map[type + ':' + idx] = item;
        }
      });
    });
    return map;
  }

  // ── Main renderer ──

  window.__renderers.rich_content = function renderRichContent(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';
    var utils = window.__companionUtils;

    // Normalize input: plain string → { body: data }
    if (typeof data === 'string') {
      data = { body: data };
    }

    // Fallback: if data has neither body nor title, render as JSON
    if (!data || (typeof data === 'object' && !data.body && !data.title)) {
      var pre = document.createElement('pre');
      pre.style.cssText = 'background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;font-size:13px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;';
      pre.textContent = JSON.stringify(data, null, 2);
      container.appendChild(pre);
      return;
    }

    // Title
    if (data.title) {
      var h1 = document.createElement('h1');
      h1.style.cssText = 'font-size:20px;font-weight:700;color:#171717;margin:0 0 16px 0;line-height:1.3;';
      h1.textContent = data.title;
      container.appendChild(h1);
    }

    // Body
    if (data.body) {
      var hasCitations = data.citations && typeof data.citations === 'object' && Object.keys(data.citations).length > 0;
      var contentEl;

      if (hasCitations) {
        contentEl = utils.renderMarkdownWithCitations(data.body);
      } else {
        contentEl = utils.renderMarkdown(data.body);
      }

      if (contentEl instanceof HTMLElement) {
        contentEl.style.cssText += 'padding:8px 0;line-height:1.8;';
        container.appendChild(contentEl);

        // Render mermaid diagrams
        utils.renderMermaidBlocks(contentEl);
      }

      // Wire up citation clicks
      if (hasCitations) {
        var citationMap = buildCitationMap(data.citations);

        container.addEventListener('click', function (e) {
          var citeEl = e.target.closest('[data-cite-type]');
          if (!citeEl) return;

          var type = citeEl.getAttribute('data-cite-type');
          var index = citeEl.getAttribute('data-cite-index');
          var key = type + ':' + index;
          var citationData = citationMap[key];

          if (citationData && utils.openCitationPanel) {
            e.stopPropagation();
            utils.openCitationPanel(type, citationData);
          }
        });
      }
    }
  };
})();
