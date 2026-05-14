import './universal-graph-renderer-setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

var renderer = window.__renderers.universal_graph;
var supportedTypes = [
  'line',
  'area',
  'bar',
  'stacked_bar',
  'grouped_bar',
  'scatter',
  'bubble',
  'combo',
  'histogram',
  'boxplot',
  'heatmap',
  'matrix',
  'pie',
  'donut',
  'waterfall',
  'funnel',
  'gauge',
  'radar',
  'candlestick',
  'timeline',
  'gantt',
  'tree',
  'network',
  'treemap',
  'sunburst',
  'sankey',
];

function graphFor(type) {
  if (['line', 'area', 'bar', 'stacked_bar', 'grouped_bar', 'scatter', 'bubble', 'combo'].indexOf(type) >= 0) {
    return {
      id: type + '_graph',
      title: type + ' graph',
      type: type,
      data: {
        columns: [
          { id: 'month', name: 'Month', type: 'string' },
          { id: 'revenue', name: 'Revenue', type: 'number' },
          { id: 'cost', name: 'Cost', type: 'number' },
          { id: 'size', name: 'Size', type: 'number' },
        ],
        rows: [
          { month: 'Jan', revenue: 10, cost: 4, size: 20 },
          { month: 'Feb', revenue: 18, cost: 8, size: 40 },
          { month: 'Mar', revenue: 14, cost: 7, size: 30 },
        ],
      },
      encoding: {
        x: 'month',
        y: type === 'stacked_bar' || type === 'grouped_bar' || type === 'combo' ? ['revenue', 'cost'] : 'revenue',
        size: 'size',
      },
    };
  }

  if (type === 'histogram' || type === 'boxplot') {
    return {
      id: type + '_graph',
      title: type + ' graph',
      type: type,
      data: {
        columns: [{ id: 'value', name: 'Value', type: 'number' }],
        rows: [{ value: 3 }, { value: 7 }, { value: 9 }, { value: 12 }, { value: 14 }],
      },
      encoding: { value: 'value' },
    };
  }

  if (type === 'heatmap' || type === 'matrix') {
    return {
      id: type + '_graph',
      title: type + ' graph',
      type: type,
      data: {
        columns: [
          { id: 'segment', name: 'Segment' },
          { id: 'month', name: 'Month' },
          { id: 'score', name: 'Score', type: 'number' },
        ],
        rows: [
          { segment: 'SMB', month: 'Jan', score: 4 },
          { segment: 'SMB', month: 'Feb', score: 7 },
          { segment: 'ENT', month: 'Jan', score: 8 },
        ],
      },
      encoding: { x: 'month', y: 'segment', value: 'score' },
    };
  }

  if (['pie', 'donut', 'waterfall', 'funnel', 'gauge', 'radar', 'treemap', 'sunburst'].indexOf(type) >= 0) {
    return {
      id: type + '_graph',
      title: type + ' graph',
      type: type,
      data: {
        columns: [
          { id: 'label', name: 'Label' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: [
          { label: 'Alpha', value: 30 },
          { label: 'Beta', value: 18 },
          { label: 'Gamma', value: 12 },
        ],
      },
      encoding: { label: 'label', value: 'value' },
    };
  }

  if (type === 'candlestick') {
    return {
      id: 'candlestick_graph',
      title: 'candlestick graph',
      type: type,
      data: {
        columns: [
          { id: 'day', name: 'Day' },
          { id: 'open', name: 'Open' },
          { id: 'high', name: 'High' },
          { id: 'low', name: 'Low' },
          { id: 'close', name: 'Close' },
        ],
        rows: [
          { day: 'Mon', open: 10, high: 14, low: 9, close: 13 },
          { day: 'Tue', open: 13, high: 15, low: 11, close: 12 },
        ],
      },
      encoding: { x: 'day', open: 'open', high: 'high', low: 'low', close: 'close' },
    };
  }

  if (type === 'timeline' || type === 'gantt') {
    return {
      id: type + '_graph',
      title: type + ' graph',
      type: type,
      data: {
        columns: [
          { id: 'task', name: 'Task' },
          { id: 'start', name: 'Start', type: 'date' },
          { id: 'end', name: 'End', type: 'date' },
        ],
        rows: [
          { task: 'Design', start: '2026-01-01', end: '2026-01-10' },
          { task: 'Build', start: '2026-01-11', end: '2026-01-24' },
        ],
      },
      encoding: { label: 'task', start: 'start', end: 'end' },
    };
  }

  if (type === 'tree') {
    return {
      id: 'tree_graph',
      title: 'tree graph',
      type: type,
      data: {
        columns: [
          { id: 'label', name: 'Label' },
          { id: 'parent', name: 'Parent' },
          { id: 'value', name: 'Value' },
        ],
        rows: [
          { label: 'Root', parent: '', value: 5 },
          { label: 'Child A', parent: 'Root', value: 2 },
          { label: 'Child B', parent: 'Root', value: 3 },
        ],
      },
      encoding: { label: 'label', parent: 'parent', value: 'value' },
    };
  }

  return {
    id: type + '_graph',
    title: type + ' graph',
    type: type,
    data: {
      columns: [
        { id: 'source', name: 'Source' },
        { id: 'target', name: 'Target' },
        { id: 'value', name: 'Value', type: 'number' },
      ],
      rows: [
        { source: 'A', target: 'B', value: 5 },
        { source: 'A', target: 'C', value: 3 },
        { source: 'B', target: 'D', value: 2 },
      ],
    },
    encoding: type === 'sankey' ? { source: 'source', target: 'target', value: 'value' } : { source: 'source', target: 'target' },
  };
}

describe('universal_graph renderer', function () {
  beforeEach(function () {
    document.body.innerHTML = '';
  });

  it('renders every supported V1 graph type without blank SVG output', function () {
    var container = document.createElement('div');
    renderer(container, {
      title: 'Universal Graph Pack',
      description: 'Renderer smoke test',
      graphs: supportedTypes.map(graphFor),
    });

    expect(container.querySelector('.ug-title').textContent).toBe('Universal Graph Pack');
    expect(container.querySelectorAll('.ug-card')).toHaveLength(supportedTypes.length);
    var svgs = container.querySelectorAll('svg.ug-svg');
    expect(svgs).toHaveLength(supportedTypes.length);
    svgs.forEach(function (svg) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 820 360');
      expect(svg.querySelector('path, rect, circle, polygon, line, text')).not.toBeNull();
    });
  });

  it('lets users inspect source data for a graph', function () {
    var container = document.createElement('div');
    renderer(container, {
      graphs: [graphFor('bar')],
    });

    var source = container.querySelector('.ug-source');
    var button = container.querySelector('.ug-action-btn');
    expect(source.hidden).toBe(true);
    button.click();
    expect(source.hidden).toBe(false);
    expect(button.classList.contains('ug-action-active')).toBe(true);
    expect(source.querySelector('td').textContent).toBe('Jan');
  });

  it('exposes graph embed helpers for rich_content hydration', function () {
    var graph = graphFor('line');
    var card = window.__universalGraphEmbed.buildGraphContainer(graph);
    expect(card.classList.contains('ug-card')).toBe(true);
    expect(card.getAttribute('data-graph-id')).toBe('line_graph');
    expect(window.__universalGraphEmbed.findGraphById([graph], 'line_graph')).toBe(graph);
    expect(window.__universalGraphEmbed.renderGraphSvg(graph).getAttribute('viewBox')).toBe('0 0 820 360');
  });
});
