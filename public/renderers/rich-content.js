// @ts-nocheck
/* Rich content renderer — renders arbitrary markdown + mermaid + citations + suggestions + table embeds
 *
 * Data shape:
 * {
 *   title: "Optional Heading",        // Optional
 *   body: "Context paragraph {{suggest:id=s1}}\n\n```structured_data:t1\n```\n\nMore context",
 *   citations: { ... },               // Optional — same shape as search_results citations
 *   suggestions: {                     // Optional — inline text suggestions
 *     "s1": { "old": "existing", "new": "proposed" },
 *     "s2": { "type": "insert", "new": "new text" },
 *     "s3": { "type": "delete", "old": "remove this" }
 *   },
 *   tables: [{                         // Optional — embedded structured_data tables
 *     "id": "t1", "name": "users",
 *     "columns": [{ "id": "c1", "name": "Col", "change": null }],
 *     "rows": [{ "id": "r1", "cells": { "c1": { "value": "v", "change": null } }, "children": [] }]
 *   }]
 * }
 *
 * Also handles:
 * - Plain string input (treated as { body: data })
 * - Unknown data with no body/title (rendered as JSON fallback)
 */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  // ── Table embed helpers ──

  /**
   * Pre-process table embed fenced blocks into placeholder divs before markdown parsing.
   * Replaces ```structured_data:tableId``` blocks with <div data-table-embed="tableId"></div>
   */
  function preprocessTableEmbeds(text) {
    return text.replace(/```structured_data:([^\s`]+)\s*\n?```/g, function (match, tableId) {
      return '<div data-table-embed="' + tableId.replace(/"/g, '&quot;') + '"></div>';
    });
  }

  /**
   * Find a table by ID from the tables array.
   */
  function findTableById(tables, id) {
    if (!tables) return null;
    for (var i = 0; i < tables.length; i++) {
      if (tables[i].id === id) return tables[i];
    }
    return null;
  }

  /**
   * Hydrate table embed placeholders with actual structured_data table components.
   * Must be called after markdown rendering.
   */
  function hydrateTableEmbeds(container, tables, reviewRequired, tableStates) {
    var embed = window.__structuredDataEmbed;
    var sdu = window.__structuredDataUtils;
    if (!embed || !sdu) return;

    // Inject structured_data styles (idempotent)
    embed.injectStyles();

    var placeholders = container.querySelectorAll('[data-table-embed]');
    placeholders.forEach(function (ph) {
      var tableId = ph.getAttribute('data-table-embed');
      var tableData = findTableById(tables, tableId);
      if (!tableData) {
        ph.textContent = 'Table not found: ' + tableId;
        ph.style.cssText = 'color: var(--color-error); padding: 8px; font-style: italic;';
        return;
      }

      // Create table state if not already created
      if (!tableStates[tableId]) {
        tableStates[tableId] = sdu.createTableState(tableData);
      }

      // Build the table container (no per-table onDecision — combined submit handles it)
      var tableContainer = embed.buildTableContainer(tableData, tableStates[tableId], reviewRequired, null);
      ph.parentNode.replaceChild(tableContainer, ph);
    });
  }

  // ── Combined submit bar builder ──

  /**
   * Build the combined submit bar for review mode with suggestions and/or table embeds.
   * Returns the submit bar DOM element.
   */
  function buildCombinedSubmitBar(container, hasSuggestions, hasTables, data, tableStates, onDecision) {
    var submitBar = document.createElement('div');
    submitBar.className = 'sd-submit-bar';

    var acceptAllBtn = document.createElement('button');
    acceptAllBtn.textContent = 'Accept All';
    acceptAllBtn.style.cssText = 'padding: var(--space-2) var(--space-3); border-radius: var(--border-radius-sm); border: 1px solid var(--color-success); background: var(--color-success-bg); color: var(--color-success-text); cursor: pointer; font-size: var(--text-small);';
    acceptAllBtn.addEventListener('click', function () {
      // Accept all suggestions
      var widgets = container.querySelectorAll('.suggest-widget');
      widgets.forEach(function (w) {
        w.classList.remove('suggest-rejected');
        w.classList.add('suggest-accepted');
        w.setAttribute('data-suggest-status', 'accept');
      });
      // Accept all table rows
      if (hasTables && window.__structuredDataUtils) {
        var sdu = window.__structuredDataUtils;
        data.tables.forEach(function (t) {
          if (tableStates[t.id]) {
            sdu.applyBulkDecision([t], { [t.id]: tableStates[t.id] }, 'accept');
          }
        });
      }
    });

    var rejectAllBtn = document.createElement('button');
    rejectAllBtn.textContent = 'Reject All';
    rejectAllBtn.style.cssText = 'padding: var(--space-2) var(--space-3); border-radius: var(--border-radius-sm); border: 1px solid var(--color-error); background: var(--color-error-bg); color: var(--color-error-text); cursor: pointer; font-size: var(--text-small);';
    rejectAllBtn.addEventListener('click', function () {
      // Reject all suggestions
      var widgets = container.querySelectorAll('.suggest-widget');
      widgets.forEach(function (w) {
        w.classList.remove('suggest-accepted');
        w.classList.add('suggest-rejected');
        w.setAttribute('data-suggest-status', 'reject');
      });
      // Reject all table rows
      if (hasTables && window.__structuredDataUtils) {
        var sdu = window.__structuredDataUtils;
        data.tables.forEach(function (t) {
          if (tableStates[t.id]) {
            sdu.applyBulkDecision([t], { [t.id]: tableStates[t.id] }, 'reject');
          }
        });
      }
    });

    var submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Decisions';
    submitBtn.style.cssText = 'padding: var(--space-2) var(--space-4); border-radius: var(--border-radius-sm); border: 1px solid var(--color-info); background: var(--color-info); color: white; cursor: pointer; font-size: var(--text-small); font-weight: var(--weight-semibold);';
    submitBtn.addEventListener('click', function () {
      // Build combined payload
      var suggestionDecisions = null;
      if (hasSuggestions) {
        suggestionDecisions = {};
        var widgets = container.querySelectorAll('.suggest-widget');
        widgets.forEach(function (w) {
          var id = w.getAttribute('data-suggest-id');
          var status = w.getAttribute('data-suggest-status') || 'pending';
          var comment = w.getAttribute('data-suggest-comment') || null;
          suggestionDecisions[id] = { status: status, comment: comment };
        });
      }

      var tableDecisions = null;
      if (hasTables && window.__structuredDataUtils) {
        tableDecisions = {};
        var sdu = window.__structuredDataUtils;
        data.tables.forEach(function (t) {
          if (tableStates[t.id]) {
            var tablePayload = sdu.buildDecisionPayload([t], { [t.id]: tableStates[t.id] });
            tableDecisions[t.id] = {
              decisions: tablePayload.decisions || {},
              modifications: tablePayload.modifications || {},
              additions: tablePayload.additions || {},
            };
          }
        });
      }

      var payload = {
        type: 'rich_content_decisions',
        suggestion_decisions: suggestionDecisions,
        table_decisions: tableDecisions,
      };
      onDecision(payload);
    });

    submitBar.appendChild(acceptAllBtn);
    submitBar.appendChild(rejectAllBtn);
    submitBar.appendChild(submitBtn);
    return submitBar;
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
      pre.className = 'md-codeblock';
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.textContent = JSON.stringify(data, null, 2);
      container.appendChild(pre);
      return;
    }

    // Title + view toggle
    var headerRow = document.createElement('div');
    headerRow.className = 'rc-header';

    if (data.title) {
      var h1 = document.createElement('h1');
      h1.className = 'rc-title';
      h1.textContent = data.title;
      headerRow.appendChild(h1);
    }

    if (data.body) {
      var toggleBtn = document.createElement('button');
      toggleBtn.className = 'rc-view-toggle';
      toggleBtn.textContent = 'Markdown';
      toggleBtn.title = 'View raw markdown';
      headerRow.appendChild(toggleBtn);
    }

    container.appendChild(headerRow);

    // Body
    if (data.body) {
      var hasCitations = data.citations && typeof data.citations === 'object' && Object.keys(data.citations).length > 0;
      var hasSuggestions = data.suggestions && typeof data.suggestions === 'object' && Object.keys(data.suggestions).length > 0;
      var hasTables = data.tables && Array.isArray(data.tables) && data.tables.length > 0;
      var tableStates = {};
      var bodyText = data.body;

      // Step 1: Pre-process table embeds (before markdown parsing)
      if (hasTables) {
        bodyText = preprocessTableEmbeds(bodyText);
      }

      // Step 2: Render markdown (with suggestions or citations if present)
      var contentEl;
      if (hasSuggestions && reviewRequired) {
        contentEl = utils.renderMarkdownWithSuggestions(bodyText, data.suggestions);
      } else if (hasCitations) {
        contentEl = utils.renderMarkdownWithCitations(bodyText);
      } else {
        contentEl = utils.renderMarkdown(bodyText);
      }

      // Raw markdown view (hidden by default)
      var rawEl = document.createElement('pre');
      rawEl.className = 'rc-raw-markdown';
      rawEl.style.display = 'none';
      var rawCode = document.createElement('code');
      rawCode.textContent = data.body;
      rawEl.appendChild(rawCode);

      if (contentEl instanceof HTMLElement) {
        container.appendChild(contentEl);
        container.appendChild(rawEl);

        // Step 3: Parse citation markers if citations present
        // (already handled by renderMarkdownWithCitations)

        // Step 4: Hydrate table embeds
        if (hasTables) {
          hydrateTableEmbeds(contentEl, data.tables, reviewRequired, tableStates);
        }

        // Step 5: Render mermaid diagrams
        utils.renderMermaidBlocks(contentEl);

        // Toggle between rendered and raw
        var showingRaw = false;
        toggleBtn.addEventListener('click', function () {
          showingRaw = !showingRaw;
          if (showingRaw) {
            contentEl.style.display = 'none';
            rawEl.style.display = '';
            toggleBtn.textContent = 'Rendered';
            toggleBtn.title = 'View rendered content';
            toggleBtn.classList.add('rc-view-toggle-active');
          } else {
            contentEl.style.display = '';
            rawEl.style.display = 'none';
            toggleBtn.textContent = 'Markdown';
            toggleBtn.title = 'View raw markdown';
            toggleBtn.classList.remove('rc-view-toggle-active');
          }
        });
      }

      // Wire up citation clicks
      if (hasCitations) {
        var citationMap = utils.buildCitationMap(data.citations);

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

      // Step 6: Combined submit bar (review mode with suggestions OR tables)
      if (reviewRequired && onDecision && (hasSuggestions || hasTables)) {
        var submitBar = buildCombinedSubmitBar(container, hasSuggestions, hasTables, data, tableStates, onDecision);
        container.appendChild(submitBar);
      }
    }
  };
})();
