(function () {
  'use strict';

  function getCellValue(row, colId) {
    if (!row || !row.cells || !row.cells[colId]) return '';
    return row.cells[colId].value != null ? row.cells[colId].value : '';
  }

  function getCellChange(row, colId) {
    if (!row || !row.cells || !row.cells[colId]) return null;
    return row.cells[colId].change || null;
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
        return String(getCellValue(row, col.id)).toLowerCase().indexOf(lower) !== -1;
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

  window.__structuredDataUtils = {
    getCellValue: getCellValue,
    getCellChange: getCellChange,
    flattenRows: flattenRows,
    sortRows: sortRows,
    filterRows: filterRows,
    createTableState: createTableState,
    setAllRowDecisions: setAllRowDecisions,
    buildDecisionPayload: buildDecisionPayload,
    applyBulkDecision: applyBulkDecision
  };
})();
