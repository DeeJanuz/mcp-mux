// @ts-nocheck
/* Session-scoped dataset helpers for token-efficient renderer dataRef payloads. */
(function () {
  'use strict';

  var cache = {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function dataRef(value) {
    if (!value || typeof value !== 'object') return null;
    return value.dataRef || value.data_ref || null;
  }

  function refDatasetId(ref) {
    return ref && (ref.dataset_id || ref.datasetId);
  }

  function refSourceId(ref) {
    return ref && (ref.source_id || ref.sourceId);
  }

  function cacheKey(ref, overrides) {
    overrides = overrides || {};
    return JSON.stringify({
      dataset_id: refDatasetId(ref),
      source_id: refSourceId(ref),
      recipe: overrides.recipe || ref.recipe || 'select_rows',
      params: Object.assign({}, ref.params || {}, overrides.params || {}),
      limit: overrides.limit || ref.limit || ref.pageSize || ref.page_size || null,
      offset: overrides.offset || ref.offset || null,
    });
  }

  function query(ref, overrides) {
    overrides = overrides || {};
    var key = cacheKey(ref, overrides);
    if (cache[key]) return cache[key];
    var payload = {
      dataset_id: refDatasetId(ref),
      source_id: refSourceId(ref),
      recipe: overrides.recipe || ref.recipe || 'select_rows',
      params: Object.assign({}, ref.params || {}, overrides.params || {}),
    };
    var limit = overrides.limit || ref.limit || ref.pageSize || ref.page_size;
    var offset = overrides.offset || ref.offset;
    if (limit !== undefined && limit !== null) payload.limit = limit;
    if (offset !== undefined && offset !== null) payload.offset = offset;

    cache[key] = fetch('http://localhost:4200/api/datasets/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error((body && body.error) || 'Dataset query failed');
        }
        return body;
      });
    });
    return cache[key];
  }

  function firstString() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (typeof value === 'string' && value) return value;
      if (Array.isArray(value)) {
        for (var j = 0; j < value.length; j += 1) {
          if (typeof value[j] === 'string' && value[j]) return value[j];
        }
      }
    }
    return null;
  }

  function inferredGraphParams(graph, ref) {
    var encoding = graph && graph.encoding || {};
    var recipe = ref && ref.recipe || 'select_rows';
    var existing = ref && ref.params || {};
    var params = {};
    function setMissing(name, value) {
      if (existing[name] !== undefined || params[name] !== undefined || !value) return;
      params[name] = value;
    }

    if (recipe === 'heatmap_by_pair' || recipe === 'heatmapByPair') {
      setMissing('x', firstString(encoding.x));
      setMissing('y', firstString(encoding.y));
      setMissing('value', firstString(encoding.value));
    } else if (recipe === 'trend') {
      setMissing('x', firstString(encoding.x));
      setMissing('y', firstString(encoding.y, encoding.value));
    } else if (recipe === 'group_sum' || recipe === 'groupSum') {
      setMissing('groupBy', firstString(encoding.x, encoding.label));
      setMissing('value', firstString(encoding.y, encoding.value));
    } else if (recipe === 'count_by' || recipe === 'countBy') {
      setMissing('field', firstString(encoding.x, encoding.label, encoding.y));
    } else if (recipe === 'waterfall_from_deltas' || recipe === 'waterfallFromDeltas') {
      setMissing('label', firstString(encoding.x, encoding.label));
      setMissing('value', firstString(encoding.value, encoding.y));
    } else if (recipe === 'funnel_from_counts' || recipe === 'funnelFromCounts') {
      setMissing('label', firstString(encoding.label, encoding.x));
      setMissing('count', firstString(encoding.value, encoding.y));
    }

    return params;
  }

  function hasPendingTableRef(table) {
    return !!(dataRef(table) && (!Array.isArray(table.columns) || !Array.isArray(table.rows)));
  }

  function hasPendingGraphRef(graph) {
    return !!(dataRef(graph) && (!graph.data || !Array.isArray(graph.data.columns) || !Array.isArray(graph.data.rows)));
  }

  function resolveTable(table) {
    if (!hasPendingTableRef(table)) return Promise.resolve(table);
    var ref = dataRef(table);
    var recipe = ref.recipe || 'review_rows';
    return query(ref, { recipe: recipe }).then(function (result) {
      table.columns = result.columns || [];
      table.rows = result.rows || [];
      table.__dataRefResolved = true;
      table.__dataRefWarnings = result.warnings || [];
      return table;
    });
  }

  function resolveGraph(graph) {
    if (!hasPendingGraphRef(graph)) return Promise.resolve(graph);
    var ref = dataRef(graph);
    return query(ref, { recipe: ref.recipe || 'select_rows', params: inferredGraphParams(graph, ref) }).then(function (result) {
      graph.data = {
        columns: result.columns || [],
        rows: result.rows || [],
      };
      graph.__dataRefResolved = true;
      graph.__dataRefWarnings = result.warnings || [];
      return graph;
    });
  }

  function resolveTables(tables) {
    return Promise.all((tables || []).map(resolveTable));
  }

  function resolveGraphs(graphs) {
    return Promise.all((graphs || []).map(resolveGraph));
  }

  function hasPendingRefs(data) {
    if (!data || typeof data !== 'object') return false;
    return (data.tables || []).some(hasPendingTableRef) || (data.graphs || []).some(hasPendingGraphRef);
  }

  function resolveData(data) {
    data = data || {};
    return Promise.all([
      resolveTables(data.tables || []),
      resolveGraphs(data.graphs || []),
    ]).then(function () {
      return data;
    });
  }

  function renderTemplate(template) {
    if (!template || typeof template !== 'object') return '';
    var id = template.id || '';
    var vars = template.variables || {};
    if (id === 'audit_only_evidence_review_v1') {
      var ruleIds = Array.isArray(vars.ruleIds || vars.rule_ids)
        ? (vars.ruleIds || vars.rule_ids).join(', ')
        : (vars.ruleIds || vars.rule_ids || 'specified rules');
      var reviewer = vars.reviewer || 'Reviewer';
      var sla = vars.sla || vars.SLA || 'next review cycle';
      return [
        '### Audit-Only Evidence Review',
        '',
        '- Scope: verify evidence for ' + ruleIds + '.',
        '- Reviewer: ' + reviewer + '.',
        '- SLA: ' + sla + '.',
        '- Output: record evidence sufficiency, gaps, and follow-up recommendations without mutating source systems.',
      ].join('\n');
    }
    return '';
  }

  function applyInstructionTemplate(data) {
    if (!data || typeof data !== 'object' || data.__instructionTemplateApplied) return data;
    var template = data.instructionTemplate || data.instruction_template;
    var rendered = renderTemplate(template);
    if (!rendered) return data;
    var next = clone(data);
    next.__instructionTemplateApplied = true;
    next.body = [next.body || '', rendered].filter(Boolean).join('\n\n');
    return next;
  }

  window.__mcpviewsDatasetClient = {
    query: query,
    dataRef: dataRef,
    hasPendingRefs: hasPendingRefs,
    resolveData: resolveData,
    resolveTable: resolveTable,
    resolveTables: resolveTables,
    resolveGraph: resolveGraph,
    resolveGraphs: resolveGraphs,
    hasPendingTableRef: hasPendingTableRef,
    hasPendingGraphRef: hasPendingGraphRef,
    inferredGraphParams: inferredGraphParams,
    renderTemplate: renderTemplate,
    applyInstructionTemplate: applyInstructionTemplate,
  };
})();
