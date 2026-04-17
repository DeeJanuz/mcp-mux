(function () {
  'use strict';

  function normalizeColumnKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function coerceCell(candidate) {
    if (candidate === undefined || candidate === null) return null;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (Object.prototype.hasOwnProperty.call(candidate, 'value') || Object.prototype.hasOwnProperty.call(candidate, 'change')) {
        return candidate;
      }
    }
    return {
      value: candidate,
      change: null,
    };
  }

  function resolveCell(row, colId, columnName) {
    if (!row || typeof row !== 'object') return null;

    if (row.cells && row.cells[colId]) {
      return coerceCell(row.cells[colId]);
    }

    var direct = coerceCell(row[colId]);
    if (direct) return direct;

    var values = row.values && typeof row.values === 'object' ? row.values : null;
    if (values && values[colId] !== undefined) {
      return coerceCell(values[colId]);
    }

    var data = row.data && typeof row.data === 'object' ? row.data : null;
    if (data && data[colId] !== undefined) {
      return coerceCell(data[colId]);
    }

    var targetKeys = {};
    targetKeys[normalizeColumnKey(colId)] = true;
    targetKeys[normalizeColumnKey(columnName)] = true;

    var containers = [row, values, data].filter(Boolean);
    for (var i = 0; i < containers.length; i += 1) {
      var container = containers[i];
      var keys = Object.keys(container);
      for (var j = 0; j < keys.length; j += 1) {
        var key = keys[j];
        if (!targetKeys[normalizeColumnKey(key)]) continue;
        var fallback = coerceCell(container[key]);
        if (fallback) return fallback;
      }
    }

    return null;
  }

  function getCellValue(row, colId, columnName) {
    var cell = resolveCell(row, colId, columnName);
    if (!cell) return '';
    return cell.value != null ? cell.value : '';
  }

  function getCellChange(row, colId, columnName) {
    var cell = resolveCell(row, colId, columnName);
    if (!cell) return null;
    return cell.change || null;
  }

  function flattenRows(rows, depth, expandedRows) {
    var result = [];
    if (!rows) return result;
    rows.forEach(function (row) {
      result.push({ row: row, depth: depth });
      if (row.children && row.children.length > 0 && expandedRows.has(row.id)) {
        var childFlat = flattenRows(row.children, depth + 1, expandedRows);
        result = result.concat(childFlat);
      }
    });
    return result;
  }

  function sortRows(rows, colId, direction) {
    if (!rows || !colId || !direction) return rows;
    var sorted = rows.slice().sort(function (a, b) {
      var va = String(getCellValue(a, colId)).toLowerCase();
      var vb = String(getCellValue(b, colId)).toLowerCase();
      if (va < vb) return direction === 'asc' ? -1 : 1;
      if (va > vb) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    sorted.forEach(function (row) {
      if (row.children && row.children.length > 0) {
        row.children = sortRows(row.children, colId, direction);
      }
    });
    return sorted;
  }

  function filterRows(rows, columns, text) {
    if (!rows || !text) return rows;
    var lower = text.toLowerCase();
    return rows.filter(function (row) {
      var match = columns.some(function (col) {
        return String(getCellValue(row, col.id, col.name)).toLowerCase().indexOf(lower) !== -1;
      });
      if (match) return true;
      if (row.children && row.children.length > 0) {
        var filteredChildren = filterRows(row.children, columns, text);
        if (filteredChildren.length > 0) {
          row = Object.assign({}, row, { children: filteredChildren });
          return true;
        }
      }
      return false;
    });
  }

  function createTableState(tableData) {
    var expanded = new Set();

    function autoExpand(rows, depth) {
      if (!rows) return;
      rows.forEach(function (r) {
        if (depth < 2) expanded.add(r.id);
        if (r.children) autoExpand(r.children, depth + 1);
      });
    }
    autoExpand(tableData.rows, 0);

    return {
      decisions: {},
      modifications: {},
      sortColumn: null,
      sortDirection: null,
      filterText: '',
      expandedRows: expanded
    };
  }

  function setAllRowDecisions(row, state, decision) {
    if (row.cells) {
      Object.keys(row.cells).forEach(function (colId) {
        if (row.cells[colId].change) {
          state.decisions[row.id] = decision;
        }
      });
    }
    if (row.children) {
      row.children.forEach(function (child) {
        setAllRowDecisions(child, state, decision);
      });
    }
  }

  function buildDecisionPayload(tables, states) {
    var decisions = {};
    var modifications = {};
    var userEdits = {};

    tables.forEach(function (tableData) {
      var st = states[tableData.id];

      Object.keys(st.decisions).forEach(function (key) {
        decisions[key] = st.decisions[key];
      });

      Object.keys(st.modifications).forEach(function (key) {
        modifications[key] = st.modifications[key];
        var parsed = JSON.parse(st.modifications[key]);
        if (parsed.user_edited) {
          userEdits[key] = parsed.value;
        }
      });
    });

    return {
      type: 'operation_decisions',
      decisions: decisions,
      modifications: modifications,
      additions: {
        user_edits: userEdits
      }
    };
  }

  function applyBulkDecision(tables, states, decision) {
    tables.forEach(function (tableData) {
      var st = states[tableData.id];
      tableData.rows.forEach(function (row) { setAllRowDecisions(row, st, decision); });
      tableData.columns.forEach(function (col) {
        if (col.change === 'add' || col.change === 'delete') st.decisions['col:' + col.id] = decision;
      });
    });
  }

  function buildCsvString(tableData, modifications) {
    var columns = tableData.columns;
    modifications = modifications || {};

    function escapeCsv(val) {
      var s = String(val == null ? '' : val);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    function collectRows(rows) {
      var result = [];
      if (!rows) return result;
      rows.forEach(function (row) {
        var cells = columns.map(function (col) {
          var modKey = row.id + '.' + col.id;
          if (modifications[modKey]) {
            return JSON.parse(modifications[modKey]).value;
          }
          return getCellValue(row, col.id, col.name);
        });
        result.push(cells);
        if (row.children && row.children.length > 0) {
          result = result.concat(collectRows(row.children));
        }
      });
      return result;
    }

    var header = columns.map(function (col) { return escapeCsv(col.name); });
    var rows = collectRows(tableData.rows);
    var lines = [header.join(',')];
    rows.forEach(function (cells) {
      lines.push(cells.map(escapeCsv).join(','));
    });
    return lines.join('\n');
  }

  window.__structuredDataUtils = {
    resolveCell: resolveCell,
    getCellValue: getCellValue,
    getCellChange: getCellChange,
    flattenRows: flattenRows,
    sortRows: sortRows,
    filterRows: filterRows,
    createTableState: createTableState,
    setAllRowDecisions: setAllRowDecisions,
    buildDecisionPayload: buildDecisionPayload,
    applyBulkDecision: applyBulkDecision,
    buildCsvString: buildCsvString
  };
})();
