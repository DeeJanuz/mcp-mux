import './decision-handlers-setup.js';
import { describe, it, expect } from 'vitest';

var DECISION_HANDLERS = globalThis.__DECISION_HANDLERS;
var PLUGIN_TYPE_TO_TOOL = globalThis.__PLUGIN_TYPE_TO_TOOL;
var resolveToolName = globalThis.__resolveToolName;

describe('DECISION_HANDLERS', function () {
  describe('review_decision', function () {
    it('returns decisionStr from decision.decision', function () {
      var result = DECISION_HANDLERS.review_decision({ decision: 'accept' });
      expect(result).toEqual({ decisionStr: 'accept' });
    });

    it('returns decisionStr for reject', function () {
      var result = DECISION_HANDLERS.review_decision({ decision: 'reject' });
      expect(result).toEqual({ decisionStr: 'reject' });
    });
  });

  describe('operation_decisions', function () {
    it('returns partial with decisions, comments, modifications, additions', function () {
      var decision = {
        type: 'operation_decisions',
        decisions: { r1: 'accept', r2: 'reject' },
        comments: { r1: 'looks good' },
        modifications: { 'r1.c1': 'new value' },
        additions: { user_edits: {} },
      };
      var result = DECISION_HANDLERS.operation_decisions(decision);
      expect(result.decisionStr).toBe('partial');
      expect(result.operationDecisions).toEqual({ r1: 'accept', r2: 'reject' });
      expect(result.comments).toEqual({ r1: 'looks good' });
      expect(result.modifications).toEqual({ 'r1.c1': 'new value' });
      expect(result.additions).toEqual({ user_edits: {} });
    });

    it('defaults optional fields to null', function () {
      var decision = {
        type: 'operation_decisions',
        decisions: { r1: 'accept' },
      };
      var result = DECISION_HANDLERS.operation_decisions(decision);
      expect(result.decisionStr).toBe('partial');
      expect(result.operationDecisions).toEqual({ r1: 'accept' });
      expect(result.comments).toBeNull();
      expect(result.modifications).toBeNull();
      expect(result.additions).toBeNull();
    });
  });

  describe('rich_content_decisions', function () {
    it('returns partial with suggestion_decisions and table_decisions', function () {
      var decision = {
        type: 'rich_content_decisions',
        suggestion_decisions: { s1: { status: 'accept', comment: null } },
        table_decisions: { t1: { decisions: { r1: 'accept' } } },
      };
      var result = DECISION_HANDLERS.rich_content_decisions(decision);
      expect(result.decisionStr).toBe('partial');
      expect(result.suggestionDecisions).toEqual({ s1: { status: 'accept', comment: null } });
      expect(result.tableDecisions).toEqual({ t1: { decisions: { r1: 'accept' } } });
    });

    it('defaults optional fields to null', function () {
      var decision = { type: 'rich_content_decisions' };
      var result = DECISION_HANDLERS.rich_content_decisions(decision);
      expect(result.decisionStr).toBe('partial');
      expect(result.suggestionDecisions).toBeNull();
      expect(result.tableDecisions).toBeNull();
    });
  });
});

describe('PLUGIN_TYPE_TO_TOOL', function () {
  it('maps code_unit to get_code_units', function () {
    expect(PLUGIN_TYPE_TO_TOOL.code_unit).toBe('get_code_units');
  });

  it('maps code_units to get_code_units', function () {
    expect(PLUGIN_TYPE_TO_TOOL.code_units).toBe('get_code_units');
  });

  it('maps data_table to get_data_schema', function () {
    expect(PLUGIN_TYPE_TO_TOOL.data_table).toBe('get_data_schema');
  });

  it('maps data_schema to get_data_schema', function () {
    expect(PLUGIN_TYPE_TO_TOOL.data_schema).toBe('get_data_schema');
  });

  it('maps column_context to get_column_context', function () {
    expect(PLUGIN_TYPE_TO_TOOL.column_context).toBe('get_column_context');
  });

  it('maps dependencies to get_dependencies', function () {
    expect(PLUGIN_TYPE_TO_TOOL.dependencies).toBe('get_dependencies');
  });

  it('maps file_content to get_file_content', function () {
    expect(PLUGIN_TYPE_TO_TOOL.file_content).toBe('get_file_content');
  });

  it('maps search_results to search_codebase', function () {
    expect(PLUGIN_TYPE_TO_TOOL.search_results).toBe('search_codebase');
  });

  it('falls back to get_ prefix for unknown types', function () {
    expect(resolveToolName('unknown_type')).toBe('get_unknown_type');
    expect(resolveToolName('custom_plugin')).toBe('get_custom_plugin');
  });

  it('uses mapped value over fallback for known types', function () {
    expect(resolveToolName('code_unit')).toBe('get_code_units');
    expect(resolveToolName('search_results')).toBe('search_codebase');
  });
});
