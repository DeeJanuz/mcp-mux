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

function renderGraphs(graphs) {
  var container = document.createElement('div');
  renderer(container, { graphs: graphs });
  return container;
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

  it('samples axis ticks across the full category domain', function () {
    var graph = {
      id: 'sampled_ticks',
      type: 'line',
      data: {
        columns: [
          { id: 'day', name: 'Day' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: Array.from({ length: 25 }, function (_, index) {
          return { day: 'Day ' + index, value: index * 2 };
        }),
      },
      encoding: { x: 'day', y: 'value' },
    };

    var container = renderGraphs([graph]);
    var titleTexts = Array.from(container.querySelectorAll('.ug-axis-label title')).map(function (title) {
      return title.textContent;
    });
    expect(titleTexts).toContain('Day 0');
    expect(titleTexts).toContain('Day 12');
    expect(titleTexts).toContain('Day 24');
  });

  it('uses numeric x positioning for scatter and bubble charts', function () {
    var graph = {
      id: 'numeric_scatter',
      type: 'scatter',
      data: {
        columns: [
          { id: 'x', name: 'X', type: 'number' },
          { id: 'y', name: 'Y', type: 'number' },
        ],
        rows: [
          { x: 0, y: 10 },
          { x: 1, y: 20 },
          { x: 100, y: 30 },
        ],
      },
      encoding: { x: 'x', y: 'y' },
    };

    var container = renderGraphs([graph]);
    var cxs = Array.from(container.querySelectorAll('.ug-point')).map(function (circle) {
      return Number(circle.getAttribute('cx'));
    });
    expect(cxs[1] - cxs[0]).toBeLessThan(20);
    expect(cxs[2] - cxs[1]).toBeGreaterThan(650);
  });

  it('renders very dense scatter points as a compact native layer with sampled focus marks', function () {
    var graph = {
      id: 'dense_scatter',
      type: 'scatter',
      data: {
        columns: [
          { id: 'x', name: 'X', type: 'number' },
          { id: 'y', name: 'Y', type: 'number' },
        ],
        rows: Array.from({ length: 1500 }, function (_, index) {
          return { x: index, y: Math.sin(index / 30) * 50 + (index % 17) };
        }),
      },
      encoding: { x: 'x', y: 'y' },
    };

    var container = renderGraphs([graph]);
    var layer = container.querySelector('.ug-dense-point-layer');
    expect(layer).toBeTruthy();
    expect((layer.getAttribute('d').match(/M /g) || [])).toHaveLength(1500);
    expect(container.querySelectorAll('.ug-point-focus').length).toBeLessThanOrEqual(50);
    expect(container.querySelector('.ug-density-note').textContent).toContain('dense native layer');
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('uses dense native layers for bubble charts without exploding the SVG node count', function () {
    var graph = {
      id: 'dense_bubble',
      type: 'bubble',
      data: {
        columns: [
          { id: 'x', name: 'X', type: 'number' },
          { id: 'y', name: 'Y', type: 'number' },
          { id: 'size', name: 'Size', type: 'number' },
        ],
        rows: Array.from({ length: 1600 }, function (_, index) {
          return { x: index % 80, y: Math.floor(index / 80), size: (index % 25) + 1 };
        }),
      },
      encoding: { x: 'x', y: 'y', size: 'size' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('.ug-dense-point-layer')).toHaveLength(1);
    expect(container.querySelectorAll('circle.ug-point')).toHaveLength(49);
    expect(container.querySelectorAll('svg *').length).toBeLessThan(180);
  });

  it('renders dense heatmaps as compact native layers with sampled focus cells', function () {
    var graph = {
      id: 'dense_heatmap',
      type: 'heatmap',
      data: {
        columns: [
          { id: 'x', name: 'X' },
          { id: 'y', name: 'Y' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: Array.from({ length: 2000 }, function (_, index) {
          return { x: 'C' + (index % 50), y: 'R' + Math.floor(index / 50), value: index % 101 };
        }),
      },
      encoding: { x: 'x', y: 'y', value: 'value' },
    };

    var container = renderGraphs([graph]);
    var layers = container.querySelectorAll('.ug-heat-cell-layer');
    var pathMoves = Array.from(layers).reduce(function (sum, layer) {
      return sum + (layer.getAttribute('d').match(/M /g) || []).length;
    }, 0);
    expect(layers.length).toBeGreaterThan(1);
    expect(pathMoves).toBe(2000);
    expect(container.querySelectorAll('.ug-heat-focus').length).toBeLessThanOrEqual(50);
    expect(container.querySelectorAll('svg *').length).toBeLessThan(180);
    expect(container.querySelector('.ug-density-note').textContent).toContain('dense native layers');
  });

  it('summarizes dense bar categories with an Other bucket', function () {
    var graph = {
      id: 'dense_bar',
      type: 'bar',
      options: { maxVisibleItems: 5 },
      data: {
        columns: [
          { id: 'category', name: 'Category' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: Array.from({ length: 30 }, function (_, index) {
          return { category: 'Category ' + index, value: index + 1 };
        }),
      },
      encoding: { x: 'category', y: 'value' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelector('.ug-density-note').textContent).toContain('Showing top 5 of 30 categories');
    expect(container.querySelector('.ug-warning').textContent).toContain('Separated Other (25)');
    expect(container.querySelector('.ug-other-callout-title').textContent).toContain('Other (25)');
    var markTitles = Array.from(container.querySelectorAll('rect.ug-mark title')).map(function (title) { return title.textContent; });
    expect(markTitles).toHaveLength(5);
    expect(markTitles.some(function (title) { return title.indexOf('Other (25)') >= 0; })).toBe(false);
  });

  it('lays out treemap cells as native area rectangles instead of stripes', function () {
    var graph = graphFor('treemap');
    graph.data.rows = [
      { label: 'A', value: 60 },
      { label: 'B', value: 35 },
      { label: 'C', value: 20 },
      { label: 'D', value: 12 },
      { label: 'E', value: 8 },
      { label: 'F', value: 4 },
    ];

    var container = renderGraphs([graph]);
    var rects = Array.from(container.querySelectorAll('.ug-treemap-cell'));
    var widths = new Set(rects.map(function (rect) { return Math.round(Number(rect.getAttribute('width'))); }));
    var heights = new Set(rects.map(function (rect) { return Math.round(Number(rect.getAttribute('height'))); }));
    expect(rects.length).toBe(6);
    expect(widths.size).toBeGreaterThan(1);
    expect(heights.size).toBeGreaterThan(1);
  });

  it('renders hierarchy rings for sunburst graphs with parent fields', function () {
    var graph = {
      id: 'hierarchy_sunburst',
      type: 'sunburst',
      data: {
        columns: [
          { id: 'label', name: 'Label' },
          { id: 'parent', name: 'Parent' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: [
          { label: 'Root', parent: '', value: 100 },
          { label: 'Product', parent: 'Root', value: 60 },
          { label: 'Services', parent: 'Root', value: 40 },
          { label: 'Enterprise', parent: 'Product', value: 35 },
          { label: 'SMB', parent: 'Product', value: 25 },
        ],
      },
      encoding: { label: 'label', parent: 'parent', value: 'value' },
    };

    var container = renderGraphs([graph]);
    var segments = container.querySelectorAll('.ug-sunburst-segment');
    var titles = Array.from(container.querySelectorAll('.ug-sunburst-segment title')).map(function (title) {
      return title.textContent;
    });
    expect(segments.length).toBeGreaterThanOrEqual(5);
    expect(titles.some(function (title) { return title.indexOf('Enterprise') >= 0; })).toBe(true);
  });

  it('labels gauge overflow clearly', function () {
    var graph = graphFor('gauge');
    graph.max = 100;
    graph.data.rows = [{ label: 'Capacity', value: 137 }];

    var container = renderGraphs([graph]);
    expect(container.querySelector('.ug-big-number.ug-over-limit').textContent).toContain('137 / 100');
    expect(container.querySelector('.ug-density-note').textContent).toContain('Value exceeds max');
  });

  it('shows row counts and truncation notices in source data inspection', function () {
    var graph = graphFor('bar');
    graph.data.rows = Array.from({ length: 150 }, function (_, index) {
      return { month: 'Row ' + index, revenue: index, cost: index / 2, size: index + 1 };
    });

    var container = renderGraphs([graph]);
    container.querySelector('.ug-action-btn').click();

    expect(container.querySelector('.ug-source-summary').textContent).toContain('Showing first 100 of 150 rows');
    expect(container.querySelectorAll('.ug-source tbody tr')).toHaveLength(100);
  });

  it('honors showAll marks while still sampling dense axis labels', function () {
    var graph = {
      id: 'show_all_bar',
      type: 'bar',
      options: { maxVisibleItems: 5, showAll: true },
      data: {
        columns: [
          { id: 'category', name: 'Category' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: Array.from({ length: 30 }, function (_, index) {
          return { category: 'Category ' + index, value: index + 1 };
        }),
      },
      encoding: { x: 'category', y: 'value' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('rect.ug-mark')).toHaveLength(30);
    var bottomLabels = Array.from(container.querySelectorAll('.ug-axis-label')).filter(function (label) {
      return label.getAttribute('y') === '328';
    });
    expect(bottomLabels.length).toBeLessThan(30);
    expect(container.querySelector('.ug-other-callout-title')).toBeNull();
  });

  it('warns and filters invalid legacy numeric rows before rendering scatter marks', function () {
    var graph = {
      id: 'invalid_scatter',
      type: 'scatter',
      options: { xScale: 'linear' },
      data: {
        columns: [
          { id: 'x', name: 'X', type: 'number' },
          { id: 'y', name: 'Y', type: 'number' },
        ],
        rows: [
          { x: 1, y: 10 },
          { x: 'not numeric', y: 20 },
          { x: 3, y: 'nope' },
        ],
      },
      encoding: { x: 'x', y: 'y' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('.ug-point')).toHaveLength(1);
    expect(container.querySelector('.ug-warning').textContent).toContain('invalid numeric values');
  });

  it('aggregates duplicate candlestick keys with a visible warning', function () {
    var graph = graphFor('candlestick');
    graph.data.rows = [
      { day: 'Mon', open: 10, high: 14, low: 9, close: 13 },
      { day: 'Mon', open: 13, high: 20, low: 8, close: 15 },
    ];

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('rect.ug-candle-up, rect.ug-candle-down')).toHaveLength(1);
    expect(container.querySelector('rect.ug-candle-up title').textContent).toContain('open 10, close 15');
    expect(container.querySelector('.ug-warning').textContent).toContain('Aggregated 1 duplicate candlestick row');
  });

  it('renders a single labeled bin for zero-variance histograms', function () {
    var graph = graphFor('histogram');
    graph.data.rows = Array.from({ length: 8 }, function () { return { value: 7 }; });

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('rect.ug-mark')).toHaveLength(1);
    expect(container.querySelector('.ug-warning').textContent).toContain('rendered one bin for 7');
    var titles = Array.from(container.querySelectorAll('.ug-axis-label title')).map(function (title) { return title.textContent; });
    expect(titles).toContain('7');
  });

  it('uses encoded gauge min and max for under-limit states', function () {
    var graph = {
      id: 'encoded_gauge',
      type: 'gauge',
      data: {
        columns: [
          { id: 'value', name: 'Value', type: 'number' },
          { id: 'min', name: 'Min', type: 'number' },
          { id: 'max', name: 'Max', type: 'number' },
        ],
        rows: [{ value: -5, min: 0, max: 50 }],
      },
      encoding: { value: 'value', min: 'min', max: 'max' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelector('.ug-big-number.ug-under-limit').textContent).toContain('-5 / 0');
    var labelTitles = Array.from(container.querySelectorAll('.ug-axis-label title')).map(function (title) { return title.textContent; });
    expect(labelTitles).toContain('50');
    expect(container.querySelector('.ug-density-note').textContent).toContain('below min');
  });

  it('culls dense axis labels by pixel spacing while preserving full label text', function () {
    var graph = {
      id: 'dense_axis_labels',
      type: 'bar',
      options: { showAll: true },
      data: {
        columns: [
          { id: 'category', name: 'Category' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: Array.from({ length: 80 }, function (_, index) {
          return { category: 'Very Long Category Label ' + index, value: index + 1 };
        }),
      },
      encoding: { x: 'category', y: 'value' },
    };

    var container = renderGraphs([graph]);
    var bottomLabels = Array.from(container.querySelectorAll('.ug-axis-label')).filter(function (label) {
      return label.getAttribute('y') === '328';
    });
    expect(bottomLabels.length).toBeLessThan(20);
    expect(bottomLabels[0].querySelector('title').textContent).toBe('Very Long Category Label 0');
  });

  it('summarizes dense pie slices with a separate Other disclosure', function () {
    var graph = graphFor('pie');
    graph.options = { maxVisibleItems: 6 };
    graph.data.rows = Array.from({ length: 40 }, function (_, index) {
      return { label: 'Slice ' + index, value: 40 - index };
    });

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('path.ug-mark')).toHaveLength(6);
    expect(container.querySelector('.ug-density-note').textContent).toContain('Showing top 6 of 40 slices');
    expect(container.querySelector('.ug-other-callout-title').textContent).toContain('Other (34)');
  });

  it('falls back from cyclic sankey data to network rendering with a warning', function () {
    var graph = {
      id: 'cyclic_sankey',
      type: 'sankey',
      data: {
        columns: [
          { id: 'source', name: 'Source' },
          { id: 'target', name: 'Target' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: [
          { source: 'A', target: 'B', value: 4 },
          { source: 'B', target: 'A', value: 2 },
        ],
      },
      encoding: { source: 'source', target: 'target', value: 'value' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelector('.ug-warning').textContent).toContain('Sankey requires acyclic flow');
    expect(container.querySelectorAll('.ug-sankey-link')).toHaveLength(0);
    expect(container.querySelectorAll('.ug-link')).toHaveLength(2);
  });

  it('samples dense network labels without dropping graph nodes', function () {
    var graph = {
      id: 'dense_network',
      type: 'network',
      options: { showAll: true },
      data: {
        columns: [
          { id: 'source', name: 'Source' },
          { id: 'target', name: 'Target' },
        ],
        rows: Array.from({ length: 50 }, function (_, index) {
          return { source: 'Node ' + index, target: 'Node ' + (index + 1) };
        }),
      },
      encoding: { source: 'source', target: 'target' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('.ug-node')).toHaveLength(51);
    expect(container.querySelectorAll('.ug-node-label').length).toBeLessThanOrEqual(24);
    expect(container.querySelector('.ug-density-note').textContent).toContain('sampled node labels');
  });

  it('renders very dense network links and nodes as compact native layers', function () {
    var graph = {
      id: 'very_dense_network',
      type: 'network',
      options: { showAll: true },
      data: {
        columns: [
          { id: 'source', name: 'Source' },
          { id: 'target', name: 'Target' },
        ],
        rows: Array.from({ length: 900 }, function (_, index) {
          return { source: 'Node ' + index, target: 'Node ' + (index + 1) };
        }),
      },
      encoding: { source: 'source', target: 'target' },
    };

    var container = renderGraphs([graph]);
    var linkLayer = container.querySelector('.ug-link-layer');
    var nodeLayers = container.querySelectorAll('.ug-node-layer');
    expect(linkLayer).toBeTruthy();
    expect((linkLayer.getAttribute('d').match(/M /g) || [])).toHaveLength(900);
    expect(nodeLayers.length).toBeGreaterThan(1);
    expect(container.querySelectorAll('.ug-node-focus').length).toBeLessThanOrEqual(50);
    expect(container.querySelectorAll('svg *').length).toBeLessThan(260);
    expect(container.querySelector('.ug-density-note').textContent).toContain('dense native layers');
    expect(container.querySelector('.ug-warning').textContent).toContain('simplified dense network layout');
  });

  it('culls dense sunburst labels while preserving segment titles', function () {
    var graph = {
      id: 'dense_sunburst',
      type: 'sunburst',
      data: {
        columns: [
          { id: 'label', name: 'Label' },
          { id: 'parent', name: 'Parent' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: [{ label: 'Root', parent: '', value: 100 }].concat(Array.from({ length: 24 }, function (_, index) {
          return { label: 'Child ' + index, parent: 'Root', value: index + 1 };
        })),
      },
      encoding: { label: 'label', parent: 'parent', value: 'value' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('.ug-sunburst-segment')).toHaveLength(25);
    expect(container.querySelectorAll('.ug-invert-label').length).toBeLessThan(25);
    expect(container.querySelector('.ug-sunburst-segment title').textContent).toContain('Root');
  });

  it('renders very deep trees without recursive stack overflow', function () {
    var graph = {
      id: 'deep_tree',
      type: 'tree',
      data: {
        columns: [
          { id: 'label', name: 'Label' },
          { id: 'parent', name: 'Parent' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: Array.from({ length: 5000 }, function (_, index) {
          return { label: 'Node ' + index, parent: index === 0 ? '' : 'Node ' + (index - 1), value: 1 };
        }),
      },
      encoding: { label: 'label', parent: 'parent', value: 'value' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('.ug-node')).toHaveLength(40);
    expect(container.querySelector('.ug-density-note').textContent).toContain('Showing 40 of 5000 tree nodes');
    expect(container.innerHTML).not.toContain('Maximum call stack');
  });

  it('renders very deep sunbursts without recursive stack overflow', function () {
    var graph = {
      id: 'deep_sunburst',
      type: 'sunburst',
      data: {
        columns: [
          { id: 'label', name: 'Label' },
          { id: 'parent', name: 'Parent' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: Array.from({ length: 5000 }, function (_, index) {
          return { label: 'Node ' + index, parent: index === 0 ? '' : 'Node ' + (index - 1), value: 1 };
        }),
      },
      encoding: { label: 'label', parent: 'parent', value: 'value' },
    };

    var container = renderGraphs([graph]);
    expect(container.querySelectorAll('.ug-sunburst-segment')).toHaveLength(5000);
    expect(container.querySelectorAll('.ug-sunburst-segment title').length).toBeLessThanOrEqual(50);
    expect(container.querySelector('.ug-density-note').textContent).toContain('sampled tooltips');
    expect(container.querySelector('.ug-warning').textContent).toContain('Compressed a 5000-level sunburst hierarchy');
    expect(container.innerHTML).not.toContain('Maximum call stack');
  });

  it('falls back clearly for pie, donut, and treemap specs with no positive values', function () {
    var pie = graphFor('pie');
    pie.id = 'zero_pie';
    pie.data.rows = [{ label: 'A', value: 0 }, { label: 'B', value: 0 }];
    var donut = graphFor('donut');
    donut.id = 'negative_donut';
    donut.data.rows = [{ label: 'A', value: -4 }, { label: 'B', value: -8 }];
    var treemap = graphFor('treemap');
    treemap.id = 'zero_treemap';
    treemap.data.rows = [{ label: 'A', value: 0 }, { label: 'B', value: -2 }];

    var container = renderGraphs([pie, donut, treemap]);
    expect(container.textContent).toContain('No positive values to display');
    expect(container.textContent).toContain('No positive treemap values to display');
    expect(container.querySelectorAll('.ug-warning')[0].textContent).toContain('Ignored 2 non-positive slices');
    expect(container.querySelectorAll('.ug-warning')[2].textContent).toContain('Ignored 2 non-positive treemap items');
  });

  it('falls back clearly when all radar values are invalid', function () {
    var graph = graphFor('radar');
    graph.data.rows = [{ label: 'A', value: 'bad' }, { label: 'B', value: null }];

    var container = renderGraphs([graph]);
    expect(container.querySelector('.ug-warning').textContent).toContain('Dropped 2 rows with invalid numeric values');
    expect(container.textContent).toContain('No valid radar values to display');
  });

  it('prevents hierarchy cycles from crashing tree and sunburst rendering', function () {
    var base = {
      data: {
        columns: [
          { id: 'label', name: 'Label' },
          { id: 'parent', name: 'Parent' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: [
          { label: 'A', parent: 'B', value: 1 },
          { label: 'B', parent: 'A', value: 1 },
        ],
      },
      encoding: { label: 'label', parent: 'parent', value: 'value' },
    };

    var container = renderGraphs([
      Object.assign({ id: 'cycle_tree', type: 'tree' }, base),
      Object.assign({ id: 'cycle_sunburst', type: 'sunburst' }, base),
    ]);
    var warnings = Array.from(container.querySelectorAll('.ug-warning')).map(function (warning) { return warning.textContent; });
    expect(warnings.filter(function (warning) { return warning.indexOf('would create a cycle') >= 0; })).toHaveLength(2);
    expect(container.querySelectorAll('.ug-svg')).toHaveLength(2);
  });

  it('normalizes reversed legacy timeline ranges with a visible warning', function () {
    var graph = graphFor('timeline');
    graph.data.rows = [{ task: 'Backwards', start: '2026-02-10', end: '2026-01-01' }];

    var container = renderGraphs([graph]);
    expect(container.querySelector('.ug-warning').textContent).toContain('Normalized 1 timeline row');
    expect(container.querySelector('.ug-mark title').textContent).toContain('2026-01-01 to 2026-02-10');
  });

  it('drops legacy network links with missing endpoints instead of rendering null nodes', function () {
    var graph = graphFor('network');
    graph.data.rows = [
      { source: 'A', target: null },
      { source: undefined, target: 'B' },
    ];

    var container = renderGraphs([graph]);
    expect(container.querySelector('.ug-warning').textContent).toContain('Dropped 2 rows with missing text values for source/target');
    expect(container.textContent).toContain('No valid network links to display');
    expect(container.innerHTML).not.toContain('undefined');
  });

  it('shows full truncated label text in a custom hover tooltip', function () {
    var graph = {
      id: 'long_label_tooltip',
      type: 'bar',
      data: {
        columns: [
          { id: 'category', name: 'Category' },
          { id: 'value', name: 'Value', type: 'number' },
        ],
        rows: [{ category: 'Extremely Long Enterprise Segment Label For Tooltip Inspection', value: 42 }],
      },
      encoding: { x: 'category', y: 'value' },
    };

    var container = renderGraphs([graph]);
    var label = Array.from(container.querySelectorAll('.ug-axis-label')).find(function (item) {
      return item.querySelector('title') && item.querySelector('title').textContent.indexOf('Extremely Long Enterprise') >= 0;
    });
    label.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 120, clientY: 120 }));

    var tooltip = container.querySelector('.ug-tooltip');
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain('Extremely Long Enterprise Segment Label For Tooltip Inspection');
  });

  it('flips hover tooltips away from constrained viewport edges', function () {
    var originalWidth = window.innerWidth;
    var originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 260 });

    var container = renderGraphs([graphFor('bar')]);
    var card = container.querySelector('.ug-card');
    var mark = container.querySelector('rect.ug-mark');
    var tooltip = container.querySelector('.ug-tooltip');
    card.getBoundingClientRect = function () {
      return { left: 20, top: 20, right: 340, bottom: 240, width: 320, height: 220 };
    };
    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: 180 });
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 92 });

    mark.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 326, clientY: 220 }));

    expect(tooltip.hidden).toBe(false);
    expect(parseFloat(tooltip.style.left)).toBeLessThan(140);
    expect(parseFloat(tooltip.style.top)).toBeLessThan(140);
    expect(parseFloat(tooltip.style.left) + 20 + 180).toBeLessThanOrEqual(340);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  });

  it('hides hover tooltips when the pointer moves from a mark into empty graph space', function () {
    var container = renderGraphs([graphFor('bar')]);
    var card = container.querySelector('.ug-card');
    var mark = container.querySelector('rect.ug-mark');
    var svg = container.querySelector('svg.ug-svg');

    mark.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 120, clientY: 120 }));
    expect(container.querySelector('.ug-tooltip').hidden).toBe(false);
    expect(container.querySelectorAll('.ug-highlighted').length).toBeGreaterThan(0);

    svg.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 360, clientY: 180 }));

    expect(card.querySelector('.ug-tooltip').hidden).toBe(true);
    expect(container.querySelectorAll('.ug-highlighted, .ug-dimmed')).toHaveLength(0);
  });

  it('highlights only the hovered bar for grouped bar marks', function () {
    var container = renderGraphs([graphFor('grouped_bar')]);
    var marks = Array.from(container.querySelectorAll('rect.ug-mark'));

    marks[0].dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 120, clientY: 120 }));

    expect(container.querySelectorAll('.ug-highlighted')).toHaveLength(1);
    expect(container.querySelector('.ug-highlighted')).toBe(marks[0]);
    expect(container.querySelectorAll('.ug-dimmed')).toHaveLength(marks.length - 1);
  });

  it('highlights only the hovered heatmap cell and preserves full y-axis labels', function () {
    var graph = graphFor('heatmap');
    graph.data.rows = [
      { segment: 'Strategic Enterprise', month: 'Jan', score: 124 },
      { segment: 'Strategic Enterprise', month: 'Feb', score: 121 },
      { segment: 'Enterprise', month: 'Jan', score: 119 },
      { segment: 'Enterprise', month: 'Feb', score: 117 },
      { segment: 'Mid-Market', month: 'Jan', score: 111 },
      { segment: 'Mid-Market', month: 'Feb', score: 109 },
      { segment: 'SMB Self-Serve', month: 'Jan', score: 96 },
      { segment: 'SMB Self-Serve', month: 'Feb', score: 98 },
      { segment: 'Channel Partners', month: 'Jan', score: 104 },
      { segment: 'Channel Partners', month: 'Feb', score: 106 },
    ];

    var container = renderGraphs([graph]);
    var labels = Array.from(container.querySelectorAll('.ug-axis-label')).map(function (label) { return label.childNodes[0].nodeValue; });
    expect(labels).toContain('Strategic Enterprise');
    expect(labels).toContain('Channel Partners');

    var cells = Array.from(container.querySelectorAll('.ug-heat-cell[data-ug-interactive="true"]'));
    cells[0].dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 180, clientY: 120 }));

    expect(container.querySelectorAll('.ug-highlighted')).toHaveLength(1);
    expect(container.querySelector('.ug-highlighted')).toBe(cells[0]);
    expect(container.querySelectorAll('.ug-dimmed')).toHaveLength(cells.length - 1);
  });

  it('renders automatic and override axis titles with full context', function () {
    var graph = graphFor('bar');
    graph.axes = {
      x: { label: 'Customer segment', description: 'Commercial segment assigned in CRM' },
      y: { label: 'ARR movement in thousands of dollars', description: 'Monthly recurring revenue annualized as ARR' },
    };

    var container = renderGraphs([graph]);
    var axisTitles = Array.from(container.querySelectorAll('.ug-axis-title'));
    var visibleTitles = axisTitles.map(function (title) { return title.childNodes[0].nodeValue; });
    expect(visibleTitles).toContain('Customer segment');
    expect(visibleTitles).toContain('ARR movement in thousands of dollars');
    expect(axisTitles[0].querySelector('title').textContent).toContain('Commercial segment assigned in CRM');
    expect(axisTitles[1].querySelector('title').textContent).toContain('Monthly recurring revenue annualized as ARR');

    var axisContext = Array.from(container.querySelectorAll('.ug-axis-context-item'));
    expect(axisContext.map(function (item) { return item.textContent; })).toEqual([
      'XCustomer segment',
      'YARR movement in thousands of dollars',
    ]);
    expect(axisContext[0].title).toContain('Commercial segment assigned in CRM');
  });

  it('uses value-scaled funnel thickness while preserving a uniform side slope', function () {
    var graph = graphFor('funnel');
    graph.data.rows = [
      { label: 'Target accounts', value: 12500 },
      { label: 'Engaged accounts', value: 4380 },
      { label: 'Qualified opportunities', value: 1640 },
      { label: 'Security-approved evaluations', value: 730 },
      { label: 'Proposal sent', value: 382 },
      { label: 'Legal and procurement', value: 219 },
      { label: 'Closed won', value: 116 },
    ];

    var container = renderGraphs([graph]);
    var polygons = Array.from(container.querySelectorAll('polygon.ug-funnel'));
    var widths = polygons.map(function (polygon) {
      var nums = polygon.getAttribute('points').match(/-?\d+(?:\.\d+)?/g).map(Number);
      return {
        yTop: nums[1],
        yBottom: nums[5],
        top: nums[2] - nums[0],
        bottom: nums[4] - nums[6],
      };
    });
    var drops = widths.map(function (width) { return width.top - width.bottom; });
    var heights = widths.map(function (width) { return width.yBottom - width.yTop; });
    var slopes = drops.map(function (drop, index) { return drop / heights[index]; });

    slopes.forEach(function (slope) {
      expect(slope).toBeCloseTo(slopes[0], 5);
    });
    for (var i = 1; i < heights.length; i += 1) {
      expect(heights[i]).toBeLessThanOrEqual(heights[i - 1]);
    }
    expect(heights[0]).toBeGreaterThan(heights[heights.length - 1]);
  });

  it('pins rich mark details and highlights related marks', function () {
    var graph = {
      id: 'detail_marks',
      type: 'grouped_bar',
      interactions: {
        details: { titleField: 'segment', fields: ['segment', 'revenue', 'risk'] },
      },
      data: {
        columns: [
          { id: 'segment', name: 'Segment' },
          { id: 'revenue', name: 'Revenue', type: 'number' },
          { id: 'risk', name: 'Risk', type: 'number' },
        ],
        rows: [
          { segment: 'Enterprise', revenue: 120, risk: 18 },
          { segment: 'SMB', revenue: 80, risk: 29 },
        ],
      },
      encoding: { x: 'segment', y: ['revenue', 'risk'] },
    };

    var container = renderGraphs([graph]);
    var mark = container.querySelector('rect.ug-mark');
    mark.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 120, clientY: 120 }));
    expect(container.querySelector('.ug-tooltip').textContent).toContain('Enterprise');
    expect(container.querySelectorAll('.ug-highlighted')).toHaveLength(1);
    expect(container.querySelectorAll('.ug-dimmed')).toHaveLength(3);
    expect(mark.querySelector('title')).toBeNull();
    expect(mark.getAttribute('data-ug-native-title-suppressed')).toBe('true');

    mark.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    var panel = container.querySelector('.ug-detail-panel');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('Revenue');
    expect(panel.textContent).toContain('120');
  });

  it('disables transient hover details while preserving pinned mark details', function () {
    var graph = {
      id: 'no_hover_details',
      type: 'grouped_bar',
      interactions: {
        hover: 'none',
        details: { titleField: 'segment', fields: ['segment', 'revenue', 'risk'] },
      },
      data: {
        columns: [
          { id: 'segment', name: 'Segment' },
          { id: 'revenue', name: 'Revenue', type: 'number' },
          { id: 'risk', name: 'Risk', type: 'number' },
        ],
        rows: [
          { segment: 'Enterprise', revenue: 120, risk: 18 },
          { segment: 'SMB', revenue: 80, risk: 29 },
        ],
      },
      encoding: { x: 'segment', y: ['revenue', 'risk'] },
    };

    var container = renderGraphs([graph]);
    var mark = container.querySelector('rect.ug-mark');
    mark.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, clientX: 120, clientY: 120 }));

    expect(container.querySelector('.ug-tooltip').hidden).toBe(true);
    expect(container.querySelectorAll('.ug-highlighted, .ug-dimmed')).toHaveLength(0);
    expect(mark.querySelector('title')).toBeNull();
    expect(mark.getAttribute('data-ug-native-title-suppressed')).toBe('true');

    mark.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    var panel = container.querySelector('.ug-detail-panel');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('Enterprise');
    expect(panel.textContent).toContain('Revenue');
    expect(panel.textContent).toContain('120');
  });

  it('switches metrics through read-only metric controls', function () {
    var graph = graphFor('bar');
    graph.interactions = {
      metricControls: { target: 'y', fields: ['revenue', 'cost'], label: 'Measure' },
    };

    var container = renderGraphs([graph]);
    var select = container.querySelector('.ug-metric-select');
    expect(select).not.toBeNull();
    select.value = 'cost';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));

    var titles = Array.from(container.querySelectorAll('rect.ug-mark title')).map(function (title) {
      return title.textContent;
    });
    expect(titles.some(function (title) { return title.indexOf('cost') >= 0; })).toBe(true);
  });

  it('drills from a primary graph into a hidden target graph and returns with breadcrumbs', function () {
    var overview = {
      id: 'segment_overview',
      type: 'bar',
      interactions: {
        details: { titleField: 'segment', fields: ['segment', 'revenue'] },
        drilldowns: [{
          id: 'accounts',
          label: 'View accounts',
          targetGraphId: 'account_detail',
          trigger: 'mark',
          match: { source: 'segment', targetField: 'segment' },
        }],
      },
      data: {
        columns: [
          { id: 'segment', name: 'Segment' },
          { id: 'revenue', name: 'Revenue', type: 'number' },
        ],
        rows: [{ segment: 'Enterprise', revenue: 120 }, { segment: 'SMB', revenue: 80 }],
      },
      encoding: { x: 'segment', y: 'revenue' },
    };
    var detail = {
      id: 'account_detail',
      role: 'drilldown',
      type: 'bar',
      data: {
        columns: [
          { id: 'account', name: 'Account' },
          { id: 'segment', name: 'Segment' },
          { id: 'arr', name: 'ARR', type: 'number' },
        ],
        rows: [
          { account: 'Northstar', segment: 'Enterprise', arr: 75 },
          { account: 'Pine Labs', segment: 'SMB', arr: 25 },
        ],
      },
      encoding: { x: 'account', y: 'arr' },
    };

    var container = renderGraphs([overview, detail]);
    expect(container.querySelectorAll('.ug-card')).toHaveLength(1);
    container.querySelector('rect.ug-mark').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    container.querySelector('.ug-drilldown-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(container.querySelector('.ug-card').getAttribute('data-graph-id')).toBe('account_detail');
    expect(container.textContent).toContain('Drilldown');
    expect(container.textContent).toContain('Northstar');
    expect(container.textContent).not.toContain('Pine Labs');

    container.querySelector('.ug-drill-breadcrumb button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.ug-card').getAttribute('data-graph-id')).toBe('segment_overview');
  });

  it('shows a clear fallback when a drilldown has no matching target rows', function () {
    var overview = {
      id: 'empty_drill_overview',
      type: 'bar',
      interactions: {
        drilldowns: [{
          id: 'missing',
          label: 'View missing',
          targetGraphId: 'empty_target',
          trigger: 'mark',
          match: { source: 'segment', targetField: 'segment' },
        }],
      },
      data: {
        columns: [{ id: 'segment', name: 'Segment' }, { id: 'value', name: 'Value', type: 'number' }],
        rows: [{ segment: 'Enterprise', value: 10 }],
      },
      encoding: { x: 'segment', y: 'value' },
    };
    var target = {
      id: 'empty_target',
      role: 'drilldown',
      type: 'bar',
      data: {
        columns: [{ id: 'segment', name: 'Segment' }, { id: 'value', name: 'Value', type: 'number' }],
        rows: [{ segment: 'SMB', value: 2 }],
      },
      encoding: { x: 'segment', y: 'value' },
    };

    var container = renderGraphs([overview, target]);
    container.querySelector('rect.ug-mark').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    container.querySelector('.ug-drilldown-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(container.textContent).toContain('No matching rows for drilldown');
  });
});
