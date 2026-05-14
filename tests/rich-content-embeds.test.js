import './rich-content-embeds-setup.js';
import { describe, it, expect, beforeEach } from 'vitest';

var preprocessTableEmbeds = window.__testHelpers.preprocessTableEmbeds;
var preprocessGraphEmbeds = window.__testHelpers.preprocessGraphEmbeds;
var renderer = window.__renderers.rich_content;

describe('preprocessTableEmbeds', function () {
  it('replaces structured_data fenced block with placeholder div', function () {
    var text = 'Before\n```structured_data:t1\n```\nAfter';
    var result = preprocessTableEmbeds(text);
    expect(result).toContain('<div data-table-embed="t1"></div>');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('handles multiple table embeds', function () {
    var text = '```structured_data:t1\n```\nMiddle\n```structured_data:t2\n```';
    var result = preprocessTableEmbeds(text);
    expect(result).toContain('data-table-embed="t1"');
    expect(result).toContain('data-table-embed="t2"');
    expect(result).toContain('Middle');
  });

  it('preserves non-table fenced code blocks', function () {
    var text = '```javascript\nvar x = 1;\n```';
    var result = preprocessTableEmbeds(text);
    expect(result).toBe(text);
  });

  it('returns text unchanged if no table embeds present', function () {
    var text = 'Just some plain text with no embeds.';
    var result = preprocessTableEmbeds(text);
    expect(result).toBe(text);
  });

  it('escapes quotes in table IDs', function () {
    var text = '```structured_data:table"name\n```';
    var result = preprocessTableEmbeds(text);
    expect(result).toContain('data-table-embed="table&quot;name"');
  });
});

describe('preprocessGraphEmbeds', function () {
  it('replaces universal_graph fenced block with placeholder div', function () {
    var text = 'Before\n```universal_graph:g1\n```\nAfter';
    var result = preprocessGraphEmbeds(text);
    expect(result).toContain('<div data-graph-embed="g1"></div>');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('handles multiple graph embeds', function () {
    var text = '```universal_graph:g1\n```\nMiddle\n```universal_graph:g2\n```';
    var result = preprocessGraphEmbeds(text);
    expect(result).toContain('data-graph-embed="g1"');
    expect(result).toContain('data-graph-embed="g2"');
    expect(result).toContain('Middle');
  });

  it('preserves non-graph fenced code blocks', function () {
    var text = '```javascript\nvar x = 1;\n```';
    var result = preprocessGraphEmbeds(text);
    expect(result).toBe(text);
  });

  it('escapes quotes in graph IDs', function () {
    var text = '```universal_graph:graph"name\n```';
    var result = preprocessGraphEmbeds(text);
    expect(result).toContain('data-graph-embed="graph&quot;name"');
  });
});

describe('buildCombinedSubmitBar (via renderer)', function () {
  var container;

  beforeEach(function () {
    container = document.createElement('div');
  });

  it('renders submit bar with Accept All, Reject All, and Submit buttons', function () {
    var data = {
      body: 'Content {{suggest:id=s1}}',
      suggestions: { s1: { old: 'a', new: 'b' } },
    };
    renderer(container, data, null, null, true, function () {});

    var submitBar = container.querySelector('.sd-submit-bar');
    expect(submitBar).not.toBeNull();

    var buttons = submitBar.querySelectorAll('button');
    var texts = Array.from(buttons).map(function (b) { return b.textContent; });
    expect(texts).toContain('Accept All');
    expect(texts).toContain('Reject All');
    expect(texts).toContain('Submit Decisions');
  });

  it('Accept All sets all suggest-widget elements to accepted state', function () {
    var data = {
      body: '{{suggest:id=s1}} and {{suggest:id=s2}}',
      suggestions: { s1: { old: 'a', new: 'b' }, s2: { old: 'c', new: 'd' } },
    };
    renderer(container, data, null, null, true, function () {});

    var submitBar = container.querySelector('.sd-submit-bar');
    var acceptAllBtn = submitBar.querySelector('button');
    acceptAllBtn.click();

    var widgets = container.querySelectorAll('.suggest-widget');
    widgets.forEach(function (w) {
      expect(w.classList.contains('suggest-accepted')).toBe(true);
      expect(w.getAttribute('data-suggest-status')).toBe('accept');
    });
  });

  it('Submit click calls onDecision with rich_content_decisions payload', function () {
    var receivedPayload = null;
    var data = {
      body: '{{suggest:id=s1}}',
      suggestions: { s1: { old: 'a', new: 'b' } },
    };
    renderer(container, data, null, null, true, function (payload) {
      receivedPayload = payload;
    });

    // Accept the suggestion first
    var widget = container.querySelector('.suggest-widget');
    widget.setAttribute('data-suggest-status', 'accept');

    var submitBar = container.querySelector('.sd-submit-bar');
    var buttons = submitBar.querySelectorAll('button');
    var submitBtn = buttons[buttons.length - 1]; // Submit Decisions is last
    submitBtn.click();

    expect(receivedPayload).not.toBeNull();
    expect(receivedPayload.type).toBe('rich_content_decisions');
    expect(receivedPayload.suggestion_decisions).not.toBeNull();
    expect(receivedPayload.suggestion_decisions.s1.status).toBe('accept');
  });

  it('payload includes suggestion_decisions when hasSuggestions', function () {
    var receivedPayload = null;
    var data = {
      body: '{{suggest:id=s1}}',
      suggestions: { s1: { old: 'a', new: 'b' } },
    };
    renderer(container, data, null, null, true, function (payload) {
      receivedPayload = payload;
    });

    var submitBar = container.querySelector('.sd-submit-bar');
    var buttons = submitBar.querySelectorAll('button');
    buttons[buttons.length - 1].click();

    expect(receivedPayload.suggestion_decisions).not.toBeNull();
    expect(receivedPayload.suggestion_decisions.s1).toBeDefined();
  });

  it('payload includes table_decisions when hasTables', function () {
    var receivedPayload = null;
    var data = {
      body: 'Text\n```structured_data:t1\n```',
      tables: [{
        id: 't1',
        name: 'Test',
        columns: [{ id: 'c1', name: 'Col' }],
        rows: [{ id: 'r1', cells: { c1: { value: 'v', change: 'add' } } }],
      }],
    };
    renderer(container, data, null, null, true, function (payload) {
      receivedPayload = payload;
    });

    var submitBar = container.querySelector('.sd-submit-bar');
    var buttons = submitBar.querySelectorAll('button');
    buttons[buttons.length - 1].click();

    expect(receivedPayload.type).toBe('rich_content_decisions');
    expect(receivedPayload.table_decisions).not.toBeNull();
    expect(receivedPayload.table_decisions.t1).toBeDefined();
  });

  it('hydrates embedded universal_graph blocks through the graph embed helper', function () {
    var data = {
      body: 'Text\n```universal_graph:g1\n```',
      graphs: [{
        id: 'g1',
        title: 'Revenue by Month',
        type: 'line',
        data: {
          columns: [{ id: 'month', name: 'Month' }, { id: 'revenue', name: 'Revenue' }],
          rows: [{ month: 'Jan', revenue: 10 }],
        },
        encoding: { x: 'month', y: 'revenue' },
      }],
    };
    renderer(container, data, null, null, false, null);

    var graph = container.querySelector('.ug-card[data-graph-id="g1"]');
    expect(graph).not.toBeNull();
    expect(graph.textContent).toContain('Revenue by Month');
    expect(container.querySelector('[data-graph-embed]')).toBeNull();
  });

  it('passes the full graph registry to embedded universal_graph cards for drilldowns', function () {
    var data = {
      body: 'Text\n```universal_graph:g1\n```',
      graphs: [
        {
          id: 'g1',
          title: 'Overview',
          type: 'bar',
          data: {
            columns: [{ id: 'label', name: 'Label' }, { id: 'value', name: 'Value' }],
            rows: [{ label: 'A', value: 1 }],
          },
          encoding: { x: 'label', y: 'value' },
        },
        {
          id: 'g2',
          role: 'drilldown',
          title: 'Detail',
          type: 'bar',
          data: {
            columns: [{ id: 'label', name: 'Label' }, { id: 'value', name: 'Value' }],
            rows: [{ label: 'A', value: 1 }],
          },
          encoding: { x: 'label', y: 'value' },
        },
      ],
    };
    renderer(container, data, null, null, false, null);

    var graph = container.querySelector('.ug-card[data-graph-id="g1"]');
    expect(graph.getAttribute('data-registry-count')).toBe('2');
  });

  it('hydrates a Northstar risk-control report payload with graph embeds and review table', function () {
    var data = {
      body: [
        '# Northstar Risk Control Report',
        '```universal_graph:risk_compression_funnel\n```',
        '```universal_graph:risk_reduction_waterfall\n```',
        '```universal_graph:rule_pressure_heatmap\n```',
        '```universal_graph:exception_risk_trend\n```',
        '```universal_graph:decision_audit_lineage\n```',
        '```universal_graph:approval_status_funnel\n```',
        '```structured_data:audit_task_proposals\n```',
      ].join('\n\n'),
      graphs: [
        {
          id: 'risk_compression_funnel',
          title: 'Source Fact Compression',
          type: 'funnel',
          data: {
            columns: [{ id: 'stage', name: 'Stage' }, { id: 'count', name: 'Count', type: 'number' }],
            rows: [{ stage: 'Rule evaluations', count: 386 }, { stage: 'Recommended reviews', count: 6 }],
          },
          encoding: { label: 'stage', value: 'count' },
        },
        {
          id: 'risk_reduction_waterfall',
          title: 'Residual Risk Movement',
          type: 'waterfall',
          data: {
            columns: [{ id: 'label', name: 'Driver' }, { id: 'value', name: 'Risk Points', type: 'number' }],
            rows: [{ label: 'Opening material risk', value: 96 }, { label: 'Beta-band trim', value: -18 }],
          },
          encoding: { label: 'label', value: 'value' },
        },
        {
          id: 'rule_pressure_heatmap',
          title: 'Rule Pressure By Segment',
          type: 'heatmap',
          data: {
            columns: [{ id: 'rule', name: 'Rule' }, { id: 'segment', name: 'Segment' }, { id: 'pressure', name: 'Pressure', type: 'number' }],
            rows: [{ rule: 'NS-RO-02', segment: 'Growth Households', pressure: 9 }],
          },
          encoding: { x: 'segment', y: 'rule', value: 'pressure' },
        },
        {
          id: 'exception_risk_trend',
          title: 'Daily Exception Count And Risk Score',
          type: 'combo',
          data: {
            columns: [{ id: 'date', name: 'Date', type: 'date' }, { id: 'exceptions', name: 'Exceptions', type: 'number' }, { id: 'riskScore', name: 'Risk Score', type: 'number' }],
            rows: [{ date: '2026-04-14', exceptions: 3, riskScore: 41 }, { date: '2026-05-14', exceptions: 7, riskScore: 48 }],
          },
          encoding: { x: 'date', y: ['exceptions', 'riskScore'] },
        },
        {
          id: 'decision_audit_lineage',
          title: 'Decision To Evidence Review Lineage',
          type: 'sankey',
          data: {
            columns: [{ id: 'source', name: 'Source' }, { id: 'target', name: 'Target' }, { id: 'value', name: 'Value', type: 'number' }],
            rows: [{ source: 'NS-RO-02', target: 'Technology sector-cap exception', value: 18 }],
          },
          encoding: { source: 'source', target: 'target', value: 'value' },
        },
        {
          id: 'approval_status_funnel',
          title: 'Approval And Evidence Funnel',
          type: 'funnel',
          data: {
            columns: [{ id: 'stage', name: 'Stage' }, { id: 'count', name: 'Count', type: 'number' }],
            rows: [{ stage: 'Approval/evidence records', count: 28 }, { stage: 'Escalated', count: 2 }],
          },
          encoding: { label: 'stage', value: 'count' },
        },
      ],
      tables: [{
        id: 'audit_task_proposals',
        name: 'Recommended Evidence Reviews',
        columns: [
          { id: 'priority', name: 'Priority', change: null },
          { id: 'control_question', name: 'Control Question', change: null },
        ],
        rows: [{
          id: 'review_sector_cap_exception',
          cells: {
            priority: { value: 'P0', change: 'add' },
            control_question: { value: 'Did the Technology sector-cap exception receive required partner approval?', change: 'add' },
          },
          children: [],
        }],
      }],
    };

    renderer(container, data, null, null, true, function () {});

    expect(container.querySelectorAll('.ug-card')).toHaveLength(6);
    expect(container.querySelector('.ug-card[data-graph-id="risk_reduction_waterfall"]')).not.toBeNull();
    expect(container.querySelector('.ug-card[data-graph-id="rule_pressure_heatmap"]')).not.toBeNull();
    expect(container.querySelector('.ug-card[data-graph-id="decision_audit_lineage"]')).not.toBeNull();
    expect(container.querySelector('[data-graph-embed]')).toBeNull();
    expect(container.querySelector('[data-table-embed]')).toBeNull();
    expect(container.querySelector('.sd-submit-bar')).not.toBeNull();
  });

  it('does not render submit bar when not in review mode', function () {
    var data = {
      body: 'Simple content',
    };
    renderer(container, data, null, null, false, null);

    var submitBar = container.querySelector('.sd-submit-bar');
    expect(submitBar).toBeNull();
  });

  it('does not render a duplicate leading markdown heading when it matches the rich content title', function () {
    var title = 'Enterprise Customer Onboarding SOP';
    var data = {
      title: title,
      body: '# Enterprise Customer Onboarding SOP\n\nEnterprise onboarding coordinates legal and security work.',
    };

    renderer(container, data, null, null, false, null);

    expect(container.querySelector('.rc-title').textContent).toBe(title);
    expect(container.children[1].textContent).toBe('Enterprise onboarding coordinates legal and security work.');
    expect(container.querySelector('.rc-raw-markdown code').textContent).toBe(data.body);
  });

  it('keeps a leading markdown heading when it differs from the rich content title', function () {
    var data = {
      title: 'Enterprise Customer Onboarding SOP',
      body: '# Demo-Ready Operating View\n\nEnterprise onboarding coordinates legal and security work.',
    };

    renderer(container, data, null, null, false, null);

    expect(container.children[1].textContent).toContain('# Demo-Ready Operating View');
  });
});
