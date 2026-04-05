import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname_resolved = dirname(fileURLToPath(import.meta.url));

// Set up DOM globals
globalThis.window = globalThis;
globalThis.window.__companionUtils = globalThis.window.__companionUtils || {};
globalThis.window.__renderers = globalThis.window.__renderers || {};

// Mock renderMarkdown
globalThis.window.__companionUtils.renderMarkdown = function (text) {
  if (!text) return text;
  var div = document.createElement('div');
  div.innerHTML = String(text);
  return div;
};

// Mock escapeHtml
globalThis.window.__companionUtils.escapeHtml = function (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

// Mock renderMermaidBlocks
globalThis.window.__companionUtils.renderMermaidBlocks = function () {};

// Mock renderMarkdownWithCitations
globalThis.window.__companionUtils.renderMarkdownWithCitations = function (text) {
  return globalThis.window.__companionUtils.renderMarkdown(text);
};

// Mock buildCitationMap
globalThis.window.__companionUtils.buildCitationMap = function () { return {}; };

// Mock openCitationPanel
globalThis.window.__companionUtils.openCitationPanel = function () {};

// Mock renderMarkdownWithSuggestions — creates widget elements for suggestion tokens
globalThis.window.__companionUtils.renderMarkdownWithSuggestions = function (text, suggestions) {
  var div = document.createElement('div');
  // Replace {{suggest:id=X}} with actual widget spans
  var html = String(text).replace(/\{\{suggest:id=([^}]+)\}\}/g, function (match, id) {
    if (!suggestions || !suggestions[id]) return match;
    return '<span class="suggest-widget" data-suggest-id="' + id + '"></span>';
  });
  div.innerHTML = html;
  return div;
};

// Mock buildSuggestionWidget
globalThis.window.__companionUtils.buildSuggestionWidget = function (id, suggestion) {
  var el = document.createElement('span');
  el.className = 'suggest-widget';
  el.setAttribute('data-suggest-id', id);
  return el;
};

// Mock structuredDataUtils
globalThis.window.__structuredDataUtils = {
  createTableState: function (tableData) {
    return { decisions: {}, modifications: {}, expandedRows: new Set(), sortColumn: null, sortDirection: null, filterText: '' };
  },
  applyBulkDecision: function (tables, states, decision) {
    tables.forEach(function (t) {
      var state = states[t.id];
      if (state && t.rows) {
        t.rows.forEach(function (r) {
          if (r.cells) {
            var hasChange = Object.keys(r.cells).some(function (k) { return r.cells[k].change; });
            if (hasChange) state.decisions[r.id] = decision;
          }
        });
      }
    });
  },
  buildDecisionPayload: function (tables, states) {
    var allDecisions = {};
    var allModifications = {};
    tables.forEach(function (t) {
      var s = states[t.id];
      if (s) {
        Object.assign(allDecisions, s.decisions);
        Object.assign(allModifications, s.modifications);
      }
    });
    return { type: 'operation_decisions', decisions: allDecisions, modifications: allModifications, additions: {} };
  },
};

// Mock structuredDataEmbed
globalThis.window.__structuredDataEmbed = {
  injectStyles: function () {},
  buildTableContainer: function (tableData, state, reviewRequired, onDecision) {
    var el = document.createElement('div');
    el.className = 'sd-table-container';
    el.setAttribute('data-table-id', tableData.id);
    return el;
  },
};

// Load rich-content.js IIFE
var code = readFileSync(join(__dirname_resolved, '../public/renderers/rich-content.js'), 'utf8');
var fn = new Function(code);
fn.call(globalThis);

// Expose the internal functions for testing by extracting them from the renderer
// preprocessTableEmbeds is used inside the renderer, but we need direct access.
// We can test it by calling window.__renderers.rich_content or by re-extracting.
// Let's extract preprocessTableEmbeds by re-running a minimal version.
var extractCode = `
(function () {
  function preprocessTableEmbeds(text) {
    return text.replace(/\`\`\`structured_data:([^\\s\`]+)\\s*\\n?\`\`\`/g, function (match, tableId) {
      return '<div data-table-embed="' + tableId.replace(/"/g, '&quot;') + '"></div>';
    });
  }
  window.__testHelpers = window.__testHelpers || {};
  window.__testHelpers.preprocessTableEmbeds = preprocessTableEmbeds;
})();
`;
var extractFn = new Function(extractCode);
extractFn.call(globalThis);
