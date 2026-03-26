// @ts-nocheck
/* Agent answer renderer — renders LLM answer with inline citation links + slideout panel
 *
 * Data shape (agent pushes):
 * {
 *   answer: "markdown text with [1] doc citations, (1) code citations, {1} dg citations, <<1>> api citations",
 *   citations: {
 *     documents: [{ index: 1, id, title, content?, status?, folder_name? }],
 *     code: [{ index: 1, id, name, filePath, unitType, lineStart?, lineEnd?, source?, complexity?, patterns? }],
 *     dataGovernance: [{ index: 1, id, tableName, dataSourceName, columns? }],
 *     api: [{ index: 1, id, method, path, description?, repositoryName? }],
 *     knowledgeDex: [{ index: 1, id, name, description?, scope? }],
 *     dataLake: [{ index: 1, id, connectionName, tablePath? }]
 *   }
 * }
 *
 * Also handles raw MCP search results (no answer field) as a fallback — renders
 * them in a simple grouped list.
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

  /**
   * Render a "Sources" footer listing all citations by type with colored badges.
   */
  function renderSourcesFooter(container, citations, citationMap) {
    if (!citations || Object.keys(citations).length === 0) return;

    var utils = window.__companionUtils;
    var footer = document.createElement('div');
    footer.style.cssText = 'margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;';

    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:12px;font-weight:600;color:#737373;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;';
    heading.textContent = 'Sources';
    footer.appendChild(heading);

    Object.keys(citations).forEach(function (key) {
      var type = CITE_TYPE_MAP[key] || key;
      var items = citations[key];
      if (!Array.isArray(items) || items.length === 0) return;

      var color = utils.CITATION_COLORS[type] || utils.CITATION_COLORS.doc;

      items.forEach(function (item) {
        var idx = item.index != null ? item.index : item.number;
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;margin:2px 0;border-radius:4px;cursor:pointer;transition:background 0.15s;';
        row.addEventListener('mouseenter', function () { row.style.background = '#f9fafb'; });
        row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });

        // Citation number badge
        var badge = document.createElement('span');
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;font-size:11px;font-weight:600;flex-shrink:0;';
        badge.style.backgroundColor = color.hex + '20';
        badge.style.color = color.hex;
        badge.textContent = String(idx);
        row.appendChild(badge);

        // Type icon badge
        row.appendChild(utils.createBadge(color.label, color.hex + '15', color.hex));

        // Name/title
        var name = document.createElement('span');
        name.style.cssText = 'color:#171717;font-size:13px;font-weight:500;';
        name.textContent = item.title || item.name || item.path || item.tableName || item.table_name || item.connectionName || '';
        row.appendChild(name);

        // Secondary info
        var secondary = item.filePath || item.file_path || item.dataSourceName || item.data_source_name || item.method || '';
        if (secondary) {
          var sec = document.createElement('span');
          sec.style.cssText = 'color:#737373;font-size:11px;font-family:monospace;';
          sec.textContent = secondary;
          row.appendChild(sec);
        }

        // Click to open slideout
        row.addEventListener('click', function () {
          if (utils.openCitationPanel) {
            utils.openCitationPanel(type, item);
          }
        });

        footer.appendChild(row);
      });
    });

    container.appendChild(footer);
  }

  // ── Type mapping for citation panel ──
  var TYPE_TO_CITE = {
    code_unit: 'code',
    api_endpoint: 'api',
    table: 'dg',
    concept: 'kdex'
  };

  // ── Group config: label, color key, order ──
  var GROUP_CONFIG = [
    { type: 'code_unit',    label: 'Code Units',       colorKey: 'code' },
    { type: 'api_endpoint', label: 'API Endpoints',     colorKey: 'api' },
    { type: 'table',        label: 'Data Governance',   colorKey: 'dg' },
    { type: 'concept',      label: 'Knowledge Dex',     colorKey: 'kdex' }
  ];

  // ── Row renderer map (extensible without if/else) ──
  var ROW_RENDERERS = {
    code_unit: renderCodeUnitRow,
    api_endpoint: renderApiEndpointRow,
    table: renderTableRow,
    concept: renderConceptRow
  };

  /**
   * Render a single result row for a code_unit item.
   */
  function renderCodeUnitRow(item, utils) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;margin:2px 0;border-radius:6px;cursor:pointer;transition:background 0.15s;';
    row.addEventListener('mouseenter', function () { row.style.background = '#f9fafb'; });
    row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });

    // unitType chip
    var unitType = item.unitType || 'CODE';
    row.appendChild(utils.createBadge(unitType, '#f3e8ff', '#7c3aed'));

    // name
    var nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-weight:600;color:#171717;font-size:13px;';
    nameEl.textContent = item.name || '';
    row.appendChild(nameEl);

    // filePath
    var fp = item.filePath || item.file_path || '';
    if (fp) {
      var pathEl = document.createElement('span');
      pathEl.style.cssText = 'font-family:monospace;font-size:11px;color:#737373;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      pathEl.textContent = fp;
      row.appendChild(pathEl);
    }

    return row;
  }

  /**
   * Render a single result row for an api_endpoint item.
   */
  function renderApiEndpointRow(item, utils) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;margin:2px 0;border-radius:6px;cursor:pointer;transition:background 0.15s;';
    row.addEventListener('mouseenter', function () { row.style.background = '#f9fafb'; });
    row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });

    // HTTP method chip
    var method = (item.method || 'GET').toUpperCase();
    var methodColor = utils.HTTP_METHOD_COLORS[method] || utils.HTTP_METHOD_COLORS.GET;
    row.appendChild(utils.createBadge(method, methodColor.bg, methodColor.text));

    // path
    var pathEl = document.createElement('span');
    pathEl.style.cssText = 'font-family:monospace;font-size:13px;color:#171717;font-weight:500;';
    pathEl.textContent = item.path || '';
    row.appendChild(pathEl);

    return row;
  }

  /**
   * Render a single result row for a table (data governance) item.
   */
  function renderTableRow(item, utils) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;margin:2px 0;border-radius:6px;cursor:pointer;transition:background 0.15s;';
    row.addEventListener('mouseenter', function () { row.style.background = '#f9fafb'; });
    row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });

    // DG chip
    var dgColor = utils.CITATION_COLORS.dg;
    row.appendChild(utils.createBadge(dgColor.label, dgColor.hex + '15', dgColor.hex));

    // full path: dataSourceName.tableName
    var fullPath = '';
    if (item.dataSourceName) {
      fullPath = item.dataSourceName + '.' + (item.name || '');
    } else {
      fullPath = item.name || '';
    }
    var pathEl = document.createElement('span');
    pathEl.style.cssText = 'font-family:monospace;font-size:13px;color:#171717;font-weight:500;';
    pathEl.textContent = fullPath;
    row.appendChild(pathEl);

    return row;
  }

  /**
   * Render a single result row for a concept (knowledge dex) item.
   */
  function renderConceptRow(item, utils) {
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:6px 10px;margin:2px 0;border-radius:6px;cursor:pointer;transition:background 0.15s;';
    wrapper.addEventListener('mouseenter', function () { wrapper.style.background = '#f9fafb'; });
    wrapper.addEventListener('mouseleave', function () { wrapper.style.background = 'transparent'; });

    // Top line: chip + name (with parent path)
    var topLine = document.createElement('div');
    topLine.style.cssText = 'display:flex;align-items:center;gap:6px;';

    var kdexColor = utils.CITATION_COLORS.kdex;
    topLine.appendChild(utils.createBadge(kdexColor.label, kdexColor.hex + '15', kdexColor.hex));

    var nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-weight:600;color:#171717;font-size:13px;';
    if (item.parentName) {
      nameEl.textContent = item.parentName + ' \u2192 ' + (item.name || '');
    } else {
      nameEl.textContent = item.name || '';
    }
    topLine.appendChild(nameEl);
    wrapper.appendChild(topLine);

    // Description line (truncated)
    var desc = item.description || '';
    if (desc) {
      var descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:12px;color:#737373;margin-top:2px;padding-left:2px;';
      descEl.textContent = utils.truncate(desc, 80);
      wrapper.appendChild(descEl);
    }

    return wrapper;
  }

  /**
   * Fallback: render raw MCP search results grouped by type with chips and full paths.
   */
  function renderRawResults(container, data, meta, utils) {
    var items = [];
    if (data && data.results && Array.isArray(data.results)) items = data.results;
    else if (Array.isArray(data)) items = data;

    var count = (meta && meta.result_count) || items.length;

    // Total result count badge
    container.appendChild(utils.createBadge(count + ' result' + (count !== 1 ? 's' : ''), '#f3f4f6', '#171717'));

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:#737373;text-align:center;padding:32px;';
      empty.textContent = 'No results found';
      container.appendChild(empty);
      return;
    }

    // Group items by type
    var groups = {};
    items.forEach(function (item) {
      var t = item.type || 'code_unit';
      if (!groups[t]) groups[t] = [];
      groups[t].push(item);
    });

    // Render each group in order
    GROUP_CONFIG.forEach(function (cfg) {
      var groupItems = groups[cfg.type];
      if (!groupItems || groupItems.length === 0) return;

      var color = utils.CITATION_COLORS[cfg.colorKey] || utils.CITATION_COLORS.code;

      // Group header
      var header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:8px;margin:16px 0 6px 0;padding-bottom:4px;border-bottom:1px solid ' + color.hex + '20;';
      var headerLabel = document.createElement('span');
      headerLabel.style.cssText = 'font-size:12px;font-weight:600;color:' + color.hex + ';text-transform:uppercase;letter-spacing:0.5px;';
      headerLabel.textContent = cfg.label;
      header.appendChild(headerLabel);
      var countBadge = document.createElement('span');
      countBadge.style.cssText = 'font-size:11px;font-weight:600;color:' + color.hex + ';background:' + color.hex + '15;padding:1px 6px;border-radius:8px;';
      countBadge.textContent = String(groupItems.length);
      header.appendChild(countBadge);
      container.appendChild(header);

      // Render each item via renderer map
      groupItems.forEach(function (item) {
        var renderer = ROW_RENDERERS[cfg.type];
        if (!renderer) return;
        var row = renderer(item, utils);

        // Click handler to open citation panel
        row.addEventListener('click', function () {
          if (utils.openCitationPanel) {
            var citeType = TYPE_TO_CITE[cfg.type] || 'code';
            utils.openCitationPanel(citeType, item);
          }
        });

        container.appendChild(row);
      });
    });
  }

  // ── Main renderer ──

  window.__renderers.search_results = function renderSearchResults(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';
    var utils = window.__companionUtils;

    // Check if this is an agent answer (has 'answer' field) or raw results
    if (!data || !data.answer) {
      renderRawResults(container, data, meta, utils);
      return;
    }

    // ── Agent answer mode ──
    var citationMap = buildCitationMap(data.citations);

    // Render the answer as markdown with citation links
    var answerEl = utils.renderMarkdownWithCitations(data.answer);
    if (answerEl instanceof HTMLElement) {
      answerEl.style.cssText += 'padding:8px 0;line-height:1.8;';
      container.appendChild(answerEl);
    }

    // Render mermaid diagrams in the answer
    if (answerEl instanceof HTMLElement) {
      utils.renderMermaidBlocks(answerEl);
    }

    // Wire up citation clicks in the rendered answer
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

    // Render sources footer
    renderSourcesFooter(container, data.citations, citationMap);
  };
})();
