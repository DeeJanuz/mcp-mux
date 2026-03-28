import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';

var sdu = window.__structuredDataUtils;

describe('getCellValue', function () {
  it('returns cell value', function () {
    var row = { id: 'r1', cells: { c1: { value: 'hello' } } };
    expect(sdu.getCellValue(row, 'c1')).toBe('hello');
  });
  it('returns empty string for missing cells', function () {
    expect(sdu.getCellValue({ id: 'r1', cells: {} }, 'c1')).toBe('');
  });
  it('returns empty string for null value', function () {
    var row = { id: 'r1', cells: { c1: { value: null } } };
    expect(sdu.getCellValue(row, 'c1')).toBe('');
  });
  it('returns empty string for missing row', function () {
    expect(sdu.getCellValue(null, 'c1')).toBe('');
  });
  it('returns empty string when row has no cells', function () {
    expect(sdu.getCellValue({ id: 'r1' }, 'c1')).toBe('');
  });
});

describe('getCellChange', function () {
  it('returns change value', function () {
    var row = { id: 'r1', cells: { c1: { value: 'v', change: 'add' } } };
    expect(sdu.getCellChange(row, 'c1')).toBe('add');
  });
  it('returns null for missing cell', function () {
    expect(sdu.getCellChange({ id: 'r1', cells: {} }, 'c1')).toBeNull();
  });
  it('returns null for null change', function () {
    var row = { id: 'r1', cells: { c1: { value: 'v', change: null } } };
    expect(sdu.getCellChange(row, 'c1')).toBeNull();
  });
  it('returns null for missing row', function () {
    expect(sdu.getCellChange(null, 'c1')).toBeNull();
  });
});

describe('flattenRows', function () {
  it('flattens flat rows at depth 0', function () {
    var rows = [{ id: 'r1' }, { id: 'r2' }];
    var result = sdu.flattenRows(rows, 0, new Set());
    expect(result).toEqual([
      { row: { id: 'r1' }, depth: 0 },
      { row: { id: 'r2' }, depth: 0 }
    ]);
  });
  it('includes children when expanded', function () {
    var rows = [{ id: 'r1', children: [{ id: 'r1a' }] }];
    var expanded = new Set(['r1']);
    var result = sdu.flattenRows(rows, 0, expanded);
    expect(result).toHaveLength(2);
    expect(result[1].depth).toBe(1);
    expect(result[1].row.id).toBe('r1a');
  });
  it('excludes children when collapsed', function () {
    var rows = [{ id: 'r1', children: [{ id: 'r1a' }] }];
    var result = sdu.flattenRows(rows, 0, new Set());
    expect(result).toHaveLength(1);
  });
  it('returns empty array for null input', function () {
    expect(sdu.flattenRows(null, 0, new Set())).toEqual([]);
  });
});

describe('sortRows', function () {
  it('sorts ascending', function () {
    var rows = [
      { id: 'r1', cells: { c1: { value: 'banana' } } },
      { id: 'r2', cells: { c1: { value: 'apple' } } }
    ];
    var sorted = sdu.sortRows(rows, 'c1', 'asc');
    expect(sorted[0].id).toBe('r2');
    expect(sorted[1].id).toBe('r1');
  });
  it('sorts descending', function () {
    var rows = [
      { id: 'r1', cells: { c1: { value: 'apple' } } },
      { id: 'r2', cells: { c1: { value: 'banana' } } }
    ];
    var sorted = sdu.sortRows(rows, 'c1', 'desc');
    expect(sorted[0].id).toBe('r2');
  });
  it('returns rows unchanged when no colId or direction', function () {
    var rows = [{ id: 'r1' }];
    expect(sdu.sortRows(rows, null, null)).toBe(rows);
    expect(sdu.sortRows(rows, 'c1', null)).toBe(rows);
    expect(sdu.sortRows(rows, null, 'asc')).toBe(rows);
  });
  it('sorts nested children', function () {
    var rows = [{
      id: 'r1', cells: { c1: { value: 'a' } },
      children: [
        { id: 'r1b', cells: { c1: { value: 'z' } } },
        { id: 'r1a', cells: { c1: { value: 'a' } } }
      ]
    }];
    var sorted = sdu.sortRows(rows, 'c1', 'asc');
    expect(sorted[0].children[0].id).toBe('r1a');
    expect(sorted[0].children[1].id).toBe('r1b');
  });
});

describe('filterRows', function () {
  var columns = [{ id: 'c1', name: 'Name' }];

  it('filters matching rows', function () {
    var rows = [
      { id: 'r1', cells: { c1: { value: 'apple' } } },
      { id: 'r2', cells: { c1: { value: 'banana' } } }
    ];
    var filtered = sdu.filterRows(rows, columns, 'apple');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('r1');
  });
  it('returns all rows when no text', function () {
    var rows = [{ id: 'r1', cells: { c1: { value: 'x' } } }];
    expect(sdu.filterRows(rows, columns, '')).toBe(rows);
    expect(sdu.filterRows(rows, columns, null)).toBe(rows);
  });
  it('preserves parent when child matches', function () {
    var rows = [{
      id: 'r1', cells: { c1: { value: 'parent' } },
      children: [{ id: 'r1a', cells: { c1: { value: 'target' } } }]
    }];
    var filtered = sdu.filterRows(rows, columns, 'target');
    expect(filtered).toHaveLength(1);
  });
  it('is case insensitive', function () {
    var rows = [{ id: 'r1', cells: { c1: { value: 'Apple' } } }];
    expect(sdu.filterRows(rows, columns, 'apple')).toHaveLength(1);
    expect(sdu.filterRows(rows, columns, 'APPLE')).toHaveLength(1);
  });
  it('returns empty for no match', function () {
    var rows = [{ id: 'r1', cells: { c1: { value: 'apple' } } }];
    expect(sdu.filterRows(rows, columns, 'xyz')).toHaveLength(0);
  });
});

describe('createTableState', function () {
  it('auto-expands rows at depth 0 and 1', function () {
    var tableData = {
      rows: [
        { id: 'r1', children: [{ id: 'r1a', children: [{ id: 'r1a1' }] }] },
        { id: 'r2' }
      ]
    };
    var state = sdu.createTableState(tableData);
    expect(state.expandedRows.has('r1')).toBe(true);
    expect(state.expandedRows.has('r1a')).toBe(true);
    expect(state.expandedRows.has('r1a1')).toBe(false);
    expect(state.expandedRows.has('r2')).toBe(true);
  });
  it('initializes with empty decisions and modifications', function () {
    var state = sdu.createTableState({ rows: [] });
    expect(state.decisions).toEqual({});
    expect(state.modifications).toEqual({});
    expect(state.sortColumn).toBeNull();
    expect(state.sortDirection).toBeNull();
    expect(state.filterText).toBe('');
  });
});

describe('setAllRowDecisions', function () {
  it('sets decision on row with changed cells', function () {
    var state = { decisions: {} };
    var row = { id: 'r1', cells: { c1: { change: 'add' } } };
    sdu.setAllRowDecisions(row, state, 'accept');
    expect(state.decisions['r1']).toBe('accept');
  });
  it('recurses into children', function () {
    var state = { decisions: {} };
    var row = {
      id: 'r1', cells: { c1: { change: 'add' } },
      children: [{ id: 'r1a', cells: { c1: { change: 'delete' } } }]
    };
    sdu.setAllRowDecisions(row, state, 'reject');
    expect(state.decisions['r1']).toBe('reject');
    expect(state.decisions['r1a']).toBe('reject');
  });
  it('skips rows without changes', function () {
    var state = { decisions: {} };
    var row = { id: 'r1', cells: { c1: { value: 'v', change: null } } };
    sdu.setAllRowDecisions(row, state, 'accept');
    expect(state.decisions['r1']).toBeUndefined();
  });
});

describe('buildDecisionPayload', function () {
  it('merges decisions across tables', function () {
    var tables = [{ id: 't1' }, { id: 't2' }];
    var states = {
      t1: { decisions: { r1: 'accept' }, modifications: {} },
      t2: { decisions: { r2: 'reject' }, modifications: {} }
    };
    var payload = sdu.buildDecisionPayload(tables, states);
    expect(payload.decisions).toEqual({ r1: 'accept', r2: 'reject' });
    expect(payload.type).toBe('operation_decisions');
  });
  it('handles modifications and user_edits', function () {
    var tables = [{ id: 't1' }];
    var states = {
      t1: {
        decisions: {},
        modifications: { 'r1.c1': JSON.stringify({ value: 'new', user_edited: true }) }
      }
    };
    var payload = sdu.buildDecisionPayload(tables, states);
    expect(payload.additions.user_edits['r1.c1']).toBe('new');
  });
});

describe('applyBulkDecision', function () {
  it('sets decisions on all rows and changed columns', function () {
    var tables = [{
      id: 't1',
      columns: [
        { id: 'c1', change: 'add' },
        { id: 'c2', change: null }
      ],
      rows: [
        { id: 'r1', cells: { c1: { change: 'add' } } },
        { id: 'r2', cells: { c1: { change: 'delete' } } }
      ]
    }];
    var states = { t1: { decisions: {} } };
    sdu.applyBulkDecision(tables, states, 'accept');
    expect(states.t1.decisions['r1']).toBe('accept');
    expect(states.t1.decisions['r2']).toBe('accept');
    expect(states.t1.decisions['col:c1']).toBe('accept');
    expect(states.t1.decisions['col:c2']).toBeUndefined();
  });
  it('works with reject', function () {
    var tables = [{
      id: 't1',
      columns: [{ id: 'c1', change: 'delete' }],
      rows: [{ id: 'r1', cells: { c1: { change: 'delete' } } }]
    }];
    var states = { t1: { decisions: {} } };
    sdu.applyBulkDecision(tables, states, 'reject');
    expect(states.t1.decisions['r1']).toBe('reject');
    expect(states.t1.decisions['col:c1']).toBe('reject');
  });
});
