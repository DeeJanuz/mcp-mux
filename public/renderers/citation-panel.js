// @ts-nocheck
/* Citation slideout panel — shows detail for a citation */

(function () {
  'use strict';

  var panelEl = null;
  var overlayEl = null;

  function ensurePanel() {
    if (panelEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'citation-slideout-overlay';
    overlayEl.addEventListener('click', closeCitationPanel);
    document.body.appendChild(overlayEl);

    panelEl = document.createElement('div');
    panelEl.className = 'citation-slideout';
    document.body.appendChild(panelEl);
  }

  function openCitationPanel(type, data) {
    ensurePanel();
    panelEl.innerHTML = '';

    var utils = window.__companionUtils;
    var color = utils.CITATION_COLORS[type] || utils.CITATION_COLORS.doc;

    // ── Header ──
    var header = document.createElement('div');
    header.className = 'citation-slideout-header';

    var titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'font-weight:600;font-size:14px;color:#171717;display:flex;align-items:center;gap:8px;';
    titleSpan.appendChild(utils.createBadge(color.label, color.hex + '20', color.hex));

    var displayName = data.name || data.title || data.tableName || data.path || '';
    if (displayName) {
      var nameSpan = document.createElement('span');
      nameSpan.textContent = displayName;
      titleSpan.appendChild(nameSpan);
    }
    header.appendChild(titleSpan);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'background:none;border:none;color:#a3a3a3;font-size:18px;cursor:pointer;padding:4px 8px;';
    closeBtn.addEventListener('click', closeCitationPanel);
    header.appendChild(closeBtn);

    panelEl.appendChild(header);

    // ── Body ──
    var body = document.createElement('div');
    body.className = 'citation-slideout-body';

    var renderer = DETAIL_RENDERERS[type] || renderGenericDetail;
    renderer(body, data);

    panelEl.appendChild(body);

    // Show
    panelEl.classList.add('open');
    overlayEl.classList.add('open');
  }

  function closeCitationPanel() {
    if (panelEl) panelEl.classList.remove('open');
    if (overlayEl) overlayEl.classList.remove('open');
  }

  // ── Code detail ──
  function renderCodeDetail(body, data) {
    var utils = window.__companionUtils;

    // File path + line range
    var pathDiv = document.createElement('div');
    pathDiv.style.cssText = 'font-family:monospace;font-size:12px;color:#60a5fa;margin-bottom:12px;';
    pathDiv.textContent = (data.file_path || '') + (data.line_start ? ' L' + data.line_start + '-' + (data.line_end || '') : '');
    body.appendChild(pathDiv);

    // Unit type + exported + complexity badges
    var badgeRow = document.createElement('div');
    badgeRow.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;';
    if (data.unit_type) badgeRow.appendChild(utils.createBadge(data.unit_type.toUpperCase(), '#7c3aed20', '#a78bfa'));
    if (data.exported) badgeRow.appendChild(utils.createBadge('EXPORTED', '#dcfce7', '#166534'));
    if (data.complexity) {
      var level = data.complexity <= 5 ? 'LOW' : data.complexity <= 15 ? 'MEDIUM' : 'HIGH';
      var cColor = data.complexity <= 5 ? '#22c55e' : data.complexity <= 15 ? '#eab308' : '#ef4444';
      badgeRow.appendChild(utils.createBadge('COMPLEXITY: ' + data.complexity + ' (' + level + ')', cColor + '20', cColor));
    }
    body.appendChild(badgeRow);

    // Source code with line numbers
    var source = data.source || data.content || data.preview;
    if (source) {
      var pre = document.createElement('pre');
      pre.className = 'md-codeblock';
      pre.style.cssText += 'font-size:12px;line-height:1.6;';

      var lines = source.split('\n');
      var startLine = data.line_start || 1;
      var html = lines.map(function (line, i) {
        var lineNum = '<span style="color:#6b7280;min-width:40px;display:inline-block;text-align:right;margin-right:12px;user-select:none;">' + (startLine + i) + '</span>';
        return lineNum + utils.escapeHtml(line);
      }).join('\n');

      pre.innerHTML = html;
      body.appendChild(pre);
    }

    // Patterns
    if (data.patterns && data.patterns.length) {
      var patDiv = document.createElement('div');
      patDiv.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-top:12px;';
      data.patterns.forEach(function (p) {
        patDiv.appendChild(utils.createBadge(typeof p === 'string' ? p : (p.name || String(p)), '#f3f4f6', '#525252'));
      });
      body.appendChild(patDiv);
    }
  }

  // ── Document detail ──
  function renderDocDetail(body, data) {
    var utils = window.__companionUtils;

    if (data.status) {
      body.appendChild(utils.createStatusBadge(data.status));
      var spacer = document.createElement('div');
      spacer.style.height = '12px';
      body.appendChild(spacer);
    }

    if (data.content) {
      var md = utils.renderMarkdown(data.content);
      if (md instanceof HTMLElement) {
        body.appendChild(md);
      } else {
        var div = document.createElement('div');
        div.innerHTML = md;
        body.appendChild(div);
      }
    }
  }

  // ── Data governance detail ──
  function renderDgDetail(body, data) {
    var utils = window.__companionUtils;

    // Show data source name
    var dsName = data.dataSourceName || data.data_source_name || '';
    if (dsName) {
      var ds = document.createElement('div');
      ds.style.cssText = 'font-family:monospace;font-size:12px;color:#059669;margin-bottom:12px;';
      ds.textContent = dsName + '.' + (data.name || data.tableName || data.table_name || '');
      body.appendChild(ds);
    }

    // If we already have columns, render them
    if (data.columns && data.columns.length) {
      renderDgColumnsTable(body, data.columns, data.metadataColumns, utils);
      return;
    }

    // No columns — fetch on-demand via companion proxy
    if (!utils.isProxyConfigured || !utils.isProxyConfigured()) return;

    var tableName = data.name || data.tableName || data.table_name || '';
    utils.proxyFetchWithStatus(body, 'get_data_schema', { table_name: tableName, include_metadata: true }, 'Loading schema...')
      .then(function (parsed) {
        if (!parsed || !parsed.data || !parsed.data.tables || !parsed.data.tables.length) return;

        // Find matching table by id or name
        var tableData = null;
        for (var i = 0; i < parsed.data.tables.length; i++) {
          var t = parsed.data.tables[i];
          if (t.id === data.id || t.name === tableName) { tableData = t; break; }
        }
        if (!tableData) tableData = parsed.data.tables[0];

        // Full path header if missing
        if (tableData.dataSource && tableData.dataSource.name && !dsName) {
          var dsEl = document.createElement('div');
          dsEl.style.cssText = 'font-family:monospace;font-size:12px;color:#059669;margin-bottom:12px;';
          dsEl.textContent = tableData.dataSource.name + '.' + tableData.name;
          body.insertBefore(dsEl, body.firstChild);
        }

        // Source type badge
        if (tableData.dataSource && tableData.dataSource.sourceType) {
          var typeBadge = document.createElement('div');
          typeBadge.style.cssText = 'margin-bottom:12px;';
          typeBadge.appendChild(utils.createBadge(tableData.dataSource.sourceType, '#f3f4f6', '#525252'));
          body.appendChild(typeBadge);
        }

        if (tableData.columns && tableData.columns.length) {
          renderDgColumnsTable(body, tableData.columns, tableData.metadataColumns, utils);
        }
      });
  }

  // ── Render DG columns as a table with metadata column headers ──
  function renderDgColumnsTable(body, columns, metadataColumns, utils) {
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;';

    // Build header — standard columns + metadata columns
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var thStyle = 'text-align:left;padding:6px 8px;color:#737373;border-bottom:2px solid #e5e5e5;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.3px;white-space:nowrap;';

    var headers = ['Column', 'Type', 'PK', 'Description'];
    headers.forEach(function (h) {
      var th = document.createElement('th');
      th.style.cssText = thStyle;
      th.textContent = h;
      headerRow.appendChild(th);
    });

    // Add metadata column headers if present
    if (metadataColumns && metadataColumns.length) {
      metadataColumns.forEach(function (mc) {
        var th = document.createElement('th');
        th.style.cssText = thStyle + 'color:#059669;';
        th.textContent = mc.name || '';
        if (mc.isSystemColumn) {
          var sysIcon = document.createElement('span');
          sysIcon.style.cssText = 'font-size:9px;margin-left:3px;opacity:0.6;';
          sysIcon.textContent = '\u2022';
          th.appendChild(sysIcon);
        }
        headerRow.appendChild(th);
      });
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Build rows
    var tbody = document.createElement('tbody');
    var tdStyle = 'padding:5px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top;';
    columns.forEach(function (col) {
      var tr = document.createElement('tr');
      tr.style.cssText = 'transition:background 0.1s;';
      tr.addEventListener('mouseenter', function () { tr.style.background = '#f9fafb'; });
      tr.addEventListener('mouseleave', function () { tr.style.background = 'transparent'; });

      // Column name
      var tdName = document.createElement('td');
      tdName.style.cssText = tdStyle + 'color:#171717;font-weight:500;font-family:monospace;font-size:12px;white-space:nowrap;';
      tdName.textContent = col.name || '';
      tr.appendChild(tdName);

      // Data type
      var tdType = document.createElement('td');
      tdType.style.cssText = tdStyle + 'color:#737373;font-family:monospace;font-size:11px;white-space:nowrap;';
      tdType.textContent = col.originalDataType || col.dataType || col.data_type || '';
      tr.appendChild(tdType);

      // Primary key
      var tdPk = document.createElement('td');
      tdPk.style.cssText = tdStyle + 'text-align:center;';
      if (col.isPrimaryKey || col.is_primary_key) {
        tdPk.appendChild(utils.createBadge('PK', '#fef3c7', '#92400e'));
      }
      tr.appendChild(tdPk);

      // Description
      var tdDesc = document.createElement('td');
      tdDesc.style.cssText = tdStyle + 'color:#525252;font-size:12px;max-width:300px;';
      tdDesc.textContent = col.description || '';
      tr.appendChild(tdDesc);

      // Metadata value cells (empty for now — values require include_values=true)
      if (metadataColumns && metadataColumns.length) {
        metadataColumns.forEach(function () {
          var tdMeta = document.createElement('td');
          tdMeta.style.cssText = tdStyle + 'color:#a3a3a3;font-size:11px;';
          tdMeta.textContent = '\u2014';
          tr.appendChild(tdMeta);
        });
      }

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);

    // Column count footer
    var footer = document.createElement('div');
    footer.style.cssText = 'margin-top:8px;font-size:11px;color:#a3a3a3;';
    footer.textContent = columns.length + ' column' + (columns.length !== 1 ? 's' : '');
    if (metadataColumns && metadataColumns.length) {
      footer.textContent += ' \u00b7 ' + metadataColumns.length + ' metadata field' + (metadataColumns.length !== 1 ? 's' : '');
    }
    body.appendChild(footer);
  }

  // ── API endpoint detail ──
  function renderApiDetail(body, data) {
    var utils = window.__companionUtils;

    var methodRow = document.createElement('div');
    methodRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;';

    var method = (data.method || 'GET').toUpperCase();
    var mColor = utils.HTTP_METHOD_COLORS[method] || { hex: '#9ca3af', bg: '#f3f4f6', text: '#525252' };
    methodRow.appendChild(utils.createBadge(method, mColor.bg || (mColor.hex + '20'), mColor.text || mColor.hex));

    var pathSpan = document.createElement('span');
    pathSpan.style.cssText = 'font-family:monospace;font-size:13px;color:#171717;';
    pathSpan.textContent = data.path || '';
    methodRow.appendChild(pathSpan);
    body.appendChild(methodRow);

    if (data.description) {
      var desc = document.createElement('p');
      desc.style.cssText = 'color:#737373;font-size:13px;margin:8px 0;';
      desc.textContent = data.description;
      body.appendChild(desc);
    }

    if (data.repositoryName) {
      var repo = document.createElement('div');
      repo.style.cssText = 'font-size:12px;color:#737373;margin-top:8px;';
      repo.textContent = 'Repository: ' + data.repositoryName;
      body.appendChild(repo);
    }
  }

  // ── Knowledge Dex detail ──
  function renderKdexDetail(body, data) {
    var utils = window.__companionUtils;

    // Scope badge
    var scope = data.scope || '';
    if (scope) {
      var scopeColor = scope === 'ORGANIZATIONAL' ? '#059669' : '#6366f1';
      var scopeLabel = scope === 'ORGANIZATIONAL' ? 'Organization' : 'Personal';
      body.appendChild(utils.createBadge(scopeLabel, scopeColor + '20', scopeColor));
      var spacer = document.createElement('div');
      spacer.style.height = '8px';
      body.appendChild(spacer);
    }

    // Parent concept path
    if (data.parentName) {
      var parentPath = document.createElement('div');
      parentPath.style.cssText = 'font-size:12px;color:#0d9488;margin-bottom:8px;';
      parentPath.textContent = data.parentName + ' \u2192 ' + (data.name || '');
      body.appendChild(parentPath);
    }

    // Description
    if (data.description) {
      var desc = document.createElement('p');
      desc.style.cssText = 'color:#525252;font-size:13px;line-height:1.6;margin:8px 0 16px 0;';
      desc.textContent = data.description;
      body.appendChild(desc);
    }

    // If we already have attributes, render them
    if (data.attributes && data.attributes.length) {
      renderKdexAttributesTable(body, data.attributes, data.mappings, utils);
      return;
    }

    // Fetch concept with attributes on-demand via companion proxy
    if (!utils.isProxyConfigured || !utils.isProxyConfigured()) return;

    var conceptName = data.name || '';
    utils.proxyFetchWithStatus(body, 'get_business_concepts', { name_pattern: conceptName, include_mappings: true }, 'Loading attributes...')
      .then(function (parsed) {
        if (!parsed || !parsed.data || !parsed.data.concepts) return;

        // Find matching concept by id or exact name
        var concept = null;
        for (var i = 0; i < parsed.data.concepts.length; i++) {
          var c = parsed.data.concepts[i];
          if (c.id === data.id) { concept = c; break; }
          if (c.name === conceptName) { concept = c; }
        }

        if (!concept) {
          var notFound = document.createElement('div');
          notFound.style.cssText = 'color:#a3a3a3;font-size:12px;';
          notFound.textContent = 'Concept details not found';
          body.appendChild(notFound);
          return;
        }

        // Description if not already shown
        if (concept.description && !data.description) {
          var descEl = document.createElement('p');
          descEl.style.cssText = 'color:#525252;font-size:13px;line-height:1.6;margin:0 0 16px 0;';
          descEl.textContent = concept.description;
          body.appendChild(descEl);
        }

        // Attributes table
        if (concept.attributes && concept.attributes.length) {
          renderKdexAttributesTable(body, concept.attributes, concept.mappings, utils);
        } else {
          var noAttrs = document.createElement('div');
          noAttrs.style.cssText = 'color:#a3a3a3;font-size:12px;padding:8px 0;';
          noAttrs.textContent = 'No attributes defined';
          body.appendChild(noAttrs);
        }

        // Column mappings
        if (concept.mappings && concept.mappings.length) {
          renderKdexMappings(body, concept.mappings, utils);
        }
      });
  }

  // ── Render KDex attributes as a table ──
  function renderKdexAttributesTable(body, attributes, mappings, utils) {
    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:11px;font-weight:600;color:#0d9488;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
    heading.textContent = 'Attributes (' + attributes.length + ')';
    body.appendChild(heading);

    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

    var thead = document.createElement('thead');
    var thStyle = 'text-align:left;padding:6px 8px;color:#737373;border-bottom:2px solid #e5e5e5;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.3px;';
    var headerRow = document.createElement('tr');
    ['Attribute', 'Description'].forEach(function (h) {
      var th = document.createElement('th');
      th.style.cssText = thStyle;
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    attributes.forEach(function (attr) {
      var tr = document.createElement('tr');
      tr.style.cssText = 'transition:background 0.1s;';
      tr.addEventListener('mouseenter', function () { tr.style.background = '#f9fafb'; });
      tr.addEventListener('mouseleave', function () { tr.style.background = 'transparent'; });

      var tdName = document.createElement('td');
      tdName.style.cssText = 'padding:6px 8px;color:#171717;font-weight:500;border-bottom:1px solid #f3f4f6;white-space:nowrap;vertical-align:top;';
      tdName.textContent = attr.name || '';
      tr.appendChild(tdName);

      var tdDesc = document.createElement('td');
      tdDesc.style.cssText = 'padding:6px 8px;color:#525252;border-bottom:1px solid #f3f4f6;line-height:1.5;vertical-align:top;';
      tdDesc.textContent = attr.description || '';
      tr.appendChild(tdDesc);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  }

  // ── Render KDex column mappings ──
  function renderKdexMappings(body, mappings, utils) {
    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:11px;font-weight:600;color:#737373;text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 6px 0;';
    heading.textContent = 'Column Mappings';
    body.appendChild(heading);

    mappings.forEach(function (m) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;';

      var col = document.createElement('span');
      col.style.cssText = 'font-family:monospace;color:#059669;';
      col.textContent = (m.dataSourceName || '') + '.' + (m.tableName || '') + '.' + (m.columnName || m.column_name || '');
      row.appendChild(col);

      body.appendChild(row);
    });
  }

  // ── Generic / fallback detail ──
  function renderGenericDetail(body, data) {
    var pre = document.createElement('pre');
    pre.className = 'md-codeblock';
    pre.textContent = JSON.stringify(data, null, 2);
    body.appendChild(pre);
  }

  // ── Detail renderer map (extensible without if/else) ──
  var DETAIL_RENDERERS = {
    code: renderCodeDetail,
    doc: renderDocDetail,
    dg: renderDgDetail,
    api: renderApiDetail,
    kdex: renderKdexDetail
  };

  // Register on shared utils
  window.__companionUtils = window.__companionUtils || {};
  window.__companionUtils.openCitationPanel = openCitationPanel;
  window.__companionUtils.closeCitationPanel = closeCitationPanel;
})();
