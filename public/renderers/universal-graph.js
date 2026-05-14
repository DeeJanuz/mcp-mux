// @ts-nocheck
/* Universal graph renderer — native, dependency-free analytical charts and graphs.
 *
 * Data shape:
 * {
 *   title: "Optional",
 *   description: "Optional context",
 *   graphs: [{
 *     id: "unique_id",
 *     title: "Graph title",
 *     type: "line|bar|scatter|pie|...",
 *     data: {
 *       columns: [{ id: "field", name: "Field", type: "number|string|date" }],
 *       rows: [{ field: "value" }]
 *     },
 *     encoding: { x: "field", y: "field", label: "field", value: "field" }
 *   }]
 * }
 */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};
  window.__universalGraphEmbed = window.__universalGraphEmbed || {};

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var WIDTH = 820;
  var HEIGHT = 360;
  var PLOT = { left: 62, right: 28, top: 28, bottom: 54 };
  var GRAPH_TYPES = {
    line: true, area: true, bar: true, stacked_bar: true, grouped_bar: true,
    scatter: true, bubble: true, combo: true, histogram: true, boxplot: true,
    heatmap: true, matrix: true, pie: true, donut: true, waterfall: true,
    funnel: true, gauge: true, radar: true, candlestick: true, timeline: true,
    gantt: true, tree: true, network: true, treemap: true, sunburst: true, sankey: true,
  };
  var PALETTE = [
    'var(--color-info)',
    'var(--color-success)',
    'var(--color-warning)',
    'var(--color-error)',
    'var(--cite-code)',
    'var(--cite-dg)',
    'var(--cite-api)',
    'var(--badge-data-schema-text)',
  ];

  function escapeHtml(value) {
    var utils = window.__companionUtils || {};
    if (typeof utils.escapeHtml === 'function') return utils.escapeHtml(value);
    var div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (key) {
      if (attrs[key] !== null && attrs[key] !== undefined) el.setAttribute(key, String(attrs[key]));
    });
    return el;
  }

  function append(parent, child) {
    parent.appendChild(child);
    return child;
  }

  function textEl(x, y, text, cls, attrs) {
    var el = svgEl('text', Object.assign({ x: x, y: y, class: cls || 'ug-svg-text' }, attrs || {}));
    el.textContent = String(text == null ? '' : text);
    return el;
  }

  function shortText(value, max) {
    var text = String(value == null ? '' : value);
    max = max || 28;
    return text.length > max ? text.slice(0, max - 1) + '...' : text;
  }

  function columnMap(graph) {
    var map = {};
    ((graph.data && graph.data.columns) || []).forEach(function (col) {
      map[col.id] = col;
    });
    return map;
  }

  function rows(graph) {
    return (graph.data && Array.isArray(graph.data.rows)) ? graph.data.rows : [];
  }

  function enc(graph, key) {
    var value = graph.encoding && graph.encoding[key];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : null;
  }

  function encList(graph, key) {
    var value = graph.encoding && graph.encoding[key];
    if (Array.isArray(value)) return value.filter(function (item) { return typeof item === 'string'; });
    return typeof value === 'string' ? [value] : [];
  }

  function cell(row, field) {
    return field ? row[field] : undefined;
  }

  function asNumber(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function asTime(value) {
    if (value instanceof Date) return value.getTime();
    var t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }

  function isDateColumn(graph, field) {
    var col = columnMap(graph)[field];
    return col && String(col.type || '').toLowerCase() === 'date';
  }

  function formatValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      if (Math.abs(value) >= 1000) return value.toLocaleString();
      return String(Math.round(value * 100) / 100);
    }
    return String(value);
  }

  function extent(values) {
    var nums = values.map(asNumber).filter(function (n) { return n !== null; });
    if (!nums.length) return [0, 1];
    var min = Math.min.apply(Math, nums);
    var max = Math.max.apply(Math, nums);
    if (min === max) {
      min = Math.min(0, min - 1);
      max = max + 1;
    }
    return [min, max];
  }

  function unique(values) {
    var seen = {};
    var out = [];
    values.forEach(function (value) {
      var key = String(value == null ? '' : value);
      if (!seen[key]) {
        seen[key] = true;
        out.push(value);
      }
    });
    return out;
  }

  function linearScale(domain, range) {
    var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
    var span = d1 - d0 || 1;
    return function (value) {
      var n = asNumber(value);
      if (n === null) n = d0;
      return r0 + ((n - d0) / span) * (r1 - r0);
    };
  }

  function categoryScale(categories, range) {
    var r0 = range[0], r1 = range[1];
    var step = categories.length ? (r1 - r0) / categories.length : 0;
    return {
      pos: function (value) {
        var idx = categories.map(String).indexOf(String(value));
        if (idx < 0) idx = 0;
        return r0 + idx * step + step / 2;
      },
      band: Math.max(2, step * 0.72),
      step: step,
    };
  }

  function color(index) {
    return PALETTE[index % PALETTE.length];
  }

  function createSvg() {
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + WIDTH + ' ' + HEIGHT,
      role: 'img',
      class: 'ug-svg',
      preserveAspectRatio: 'xMidYMid meet',
    });
    append(svg, svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, class: 'ug-svg-bg' }));
    return svg;
  }

  function drawAxes(svg, xLabels, yDomain) {
    var x0 = PLOT.left, y0 = HEIGHT - PLOT.bottom, x1 = WIDTH - PLOT.right, y1 = PLOT.top;
    append(svg, svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y0, class: 'ug-axis' }));
    append(svg, svgEl('line', { x1: x0, y1: y0, x2: x0, y2: y1, class: 'ug-axis' }));
    var ticks = 4;
    for (var i = 0; i <= ticks; i += 1) {
      var v = yDomain[0] + ((yDomain[1] - yDomain[0]) * i / ticks);
      var y = linearScale(yDomain, [y0, y1])(v);
      append(svg, svgEl('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'ug-grid' }));
      append(svg, textEl(x0 - 8, y + 4, formatValue(v), 'ug-axis-label', { 'text-anchor': 'end' }));
    }
    var scale = categoryScale(xLabels, [x0, x1]);
    xLabels.slice(0, 12).forEach(function (label) {
      append(svg, textEl(scale.pos(label), y0 + 22, shortText(label, 12), 'ug-axis-label', { 'text-anchor': 'middle' }));
    });
  }

  function addTooltipMarks(svg, marks) {
    marks.forEach(function (mark) {
      mark.el.setAttribute('tabindex', '0');
      mark.el.setAttribute('role', 'img');
      mark.el.setAttribute('aria-label', mark.label);
      mark.el.appendChild(svgEl('title', {})).textContent = mark.label;
    });
  }

  function renderCartesian(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var xField = enc(graph, 'x') || enc(graph, 'label');
    var yFields = encList(graph, 'y');
    if (!yFields.length) yFields = [enc(graph, 'value')].filter(Boolean);
    if (!rs.length || !xField || !yFields.length) return renderUnsupported(graph, 'No graph data to display');
    var xValues = unique(rs.map(function (row) { return cell(row, xField); }));
    var yValues = [];
    rs.forEach(function (row) {
      yFields.forEach(function (field) {
        var n = asNumber(cell(row, field));
        if (n !== null) yValues.push(n);
      });
    });
    if (graph.type === 'stacked_bar') {
      yValues = rs.map(function (row) {
        return yFields.reduce(function (sum, field) { return sum + (asNumber(cell(row, field)) || 0); }, 0);
      });
    }
    var yDomain = extent(yValues.concat([0]));
    drawAxes(svg, xValues, yDomain);
    var x = categoryScale(xValues, [PLOT.left, WIDTH - PLOT.right]);
    var y = linearScale(yDomain, [HEIGHT - PLOT.bottom, PLOT.top]);
    var baseline = y(0);
    var marks = [];

    yFields.forEach(function (field, seriesIndex) {
      var points = rs.map(function (row) {
        return { row: row, x: x.pos(cell(row, xField)), y: y(asNumber(cell(row, field)) || 0), value: asNumber(cell(row, field)) || 0 };
      });

      if (graph.type === 'line' || graph.type === 'area' || graph.type === 'combo') {
        var path = points.map(function (p, i) { return (i ? 'L' : 'M') + p.x + ' ' + p.y; }).join(' ');
        if (graph.type === 'area') {
          var areaPath = path + ' L ' + points[points.length - 1].x + ' ' + baseline + ' L ' + points[0].x + ' ' + baseline + ' Z';
          append(svg, svgEl('path', { d: areaPath, fill: color(seriesIndex), class: 'ug-area' }));
        }
        append(svg, svgEl('path', { d: path, fill: 'none', stroke: color(seriesIndex), class: 'ug-line' }));
        points.forEach(function (p) {
          var c = append(svg, svgEl('circle', { cx: p.x, cy: p.y, r: graph.type === 'combo' ? 4 : 3.5, fill: color(seriesIndex), class: 'ug-mark' }));
          marks.push({ el: c, label: field + ': ' + formatValue(p.value) });
        });
      } else if (graph.type === 'scatter' || graph.type === 'bubble') {
        var sizeField = enc(graph, 'size');
        points.forEach(function (p) {
          var radius = graph.type === 'bubble' ? Math.max(4, Math.min(18, Math.sqrt(asNumber(cell(p.row, sizeField)) || 16))) : 5;
          var c = append(svg, svgEl('circle', { cx: p.x, cy: p.y, r: radius, fill: color(seriesIndex), class: 'ug-mark ug-point' }));
          marks.push({ el: c, label: field + ': ' + formatValue(p.value) });
        });
      } else {
        var groupWidth = x.band;
        var barWidth = graph.type === 'grouped_bar' ? groupWidth / Math.max(1, yFields.length) : groupWidth;
        rs.forEach(function (row, rowIndex) {
          var value = asNumber(cell(row, field)) || 0;
          var xPos = x.pos(cell(row, xField)) - groupWidth / 2;
          if (graph.type === 'grouped_bar') xPos += seriesIndex * barWidth;
          var yPos = y(Math.max(0, value));
          var h = Math.abs(baseline - y(value));
          if (graph.type === 'stacked_bar') {
            var prior = 0;
            for (var pIndex = 0; pIndex < seriesIndex; pIndex += 1) prior += asNumber(cell(row, yFields[pIndex])) || 0;
            yPos = y(prior + value);
            h = Math.abs(y(prior) - y(prior + value));
          }
          var rect = append(svg, svgEl('rect', {
            x: xPos,
            y: yPos,
            width: Math.max(3, barWidth - 3),
            height: Math.max(1, h),
            fill: color(seriesIndex),
            class: 'ug-mark',
          }));
          marks.push({ el: rect, label: xValues[rowIndex] + ' ' + field + ': ' + formatValue(value) });
        });
      }
    });

    addLegend(svg, yFields);
    addTooltipMarks(svg, marks);
    return svg;
  }

  function addLegend(svg, labels) {
    labels.slice(0, 8).forEach(function (label, i) {
      var x = PLOT.left + i * 95;
      var y = 18;
      append(svg, svgEl('rect', { x: x, y: y - 9, width: 10, height: 10, fill: color(i), rx: 2 }));
      append(svg, textEl(x + 15, y, shortText(label, 13), 'ug-legend-label'));
    });
  }

  function renderHistogram(graph) {
    var field = enc(graph, 'value');
    var values = rows(graph).map(function (row) { return asNumber(cell(row, field)); }).filter(function (n) { return n !== null; });
    var domain = extent(values);
    var bins = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(values.length || 1))));
    var counts = Array.from({ length: bins }, function (_, i) { return { label: i + 1, count: 0 }; });
    values.forEach(function (value) {
      var idx = Math.min(bins - 1, Math.floor(((value - domain[0]) / ((domain[1] - domain[0]) || 1)) * bins));
      counts[idx].count += 1;
    });
    return renderCartesian({ type: 'bar', data: { columns: [{ id: 'bin' }, { id: 'count' }], rows: counts.map(function (b) { return { bin: b.label, count: b.count }; }) }, encoding: { x: 'bin', y: 'count' } });
  }

  function renderBoxplot(graph) {
    var svg = createSvg();
    var field = enc(graph, 'value');
    var values = rows(graph).map(function (row) { return asNumber(cell(row, field)); }).filter(function (n) { return n !== null; }).sort(function (a, b) { return a - b; });
    var domain = extent(values.concat([0]));
    drawAxes(svg, ['Distribution'], domain);
    var y = linearScale(domain, [HEIGHT - PLOT.bottom, PLOT.top]);
    var x = WIDTH / 2;
    function q(p) {
      if (!values.length) return 0;
      return values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
    }
    var min = q(0), q1 = q(0.25), med = q(0.5), q3 = q(0.75), max = q(1);
    append(svg, svgEl('line', { x1: x, x2: x, y1: y(min), y2: y(max), class: 'ug-line' }));
    append(svg, svgEl('rect', { x: x - 60, y: y(q3), width: 120, height: Math.max(1, y(q1) - y(q3)), fill: color(0), class: 'ug-box' }));
    append(svg, svgEl('line', { x1: x - 62, x2: x + 62, y1: y(med), y2: y(med), class: 'ug-strong-line' }));
    append(svg, svgEl('line', { x1: x - 35, x2: x + 35, y1: y(min), y2: y(min), class: 'ug-line' }));
    append(svg, svgEl('line', { x1: x - 35, x2: x + 35, y1: y(max), y2: y(max), class: 'ug-line' }));
    return svg;
  }

  function renderHeatmap(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var xField = enc(graph, 'x'), yField = enc(graph, 'y'), valueField = enc(graph, 'value');
    var xs = unique(rs.map(function (row) { return cell(row, xField); }));
    var ys = unique(rs.map(function (row) { return cell(row, yField); }));
    var domain = extent(rs.map(function (row) { return asNumber(cell(row, valueField)); }).concat([0]));
    var x = categoryScale(xs, [PLOT.left, WIDTH - PLOT.right]);
    var y = categoryScale(ys, [PLOT.top, HEIGHT - PLOT.bottom]);
    var marks = [];
    rs.forEach(function (row) {
      var value = asNumber(cell(row, valueField)) || 0;
      var intensity = (value - domain[0]) / ((domain[1] - domain[0]) || 1);
      var rect = append(svg, svgEl('rect', {
        x: x.pos(cell(row, xField)) - x.band / 2,
        y: y.pos(cell(row, yField)) - y.band / 2,
        width: x.band,
        height: y.band,
        class: 'ug-heat-cell',
        style: 'opacity:' + (0.25 + intensity * 0.75),
      }));
      marks.push({ el: rect, label: cell(row, xField) + ' / ' + cell(row, yField) + ': ' + formatValue(value) });
    });
    xs.slice(0, 14).forEach(function (label) {
      append(svg, textEl(x.pos(label), HEIGHT - PLOT.bottom + 22, shortText(label, 10), 'ug-axis-label', { 'text-anchor': 'middle' }));
    });
    ys.slice(0, 12).forEach(function (label) {
      append(svg, textEl(PLOT.left - 8, y.pos(label) + 4, shortText(label, 12), 'ug-axis-label', { 'text-anchor': 'end' }));
    });
    addTooltipMarks(svg, marks);
    return svg;
  }

  function arcPath(cx, cy, r0, r1, start, end) {
    var large = end - start > Math.PI ? 1 : 0;
    var x1 = cx + Math.cos(start) * r1, y1 = cy + Math.sin(start) * r1;
    var x2 = cx + Math.cos(end) * r1, y2 = cy + Math.sin(end) * r1;
    var x3 = cx + Math.cos(end) * r0, y3 = cy + Math.sin(end) * r0;
    var x4 = cx + Math.cos(start) * r0, y4 = cy + Math.sin(start) * r0;
    return 'M ' + x1 + ' ' + y1 + ' A ' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
      ' L ' + x3 + ' ' + y3 + ' A ' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + x4 + ' ' + y4 + ' Z';
  }

  function renderPie(graph, donut) {
    var svg = createSvg();
    var rs = rows(graph);
    var labelField = enc(graph, 'label');
    var valueField = enc(graph, 'value');
    var total = rs.reduce(function (sum, row) { return sum + Math.max(0, asNumber(cell(row, valueField)) || 0); }, 0) || 1;
    var cx = 260, cy = 175, r = 115, inner = donut ? 62 : 0;
    var angle = -Math.PI / 2;
    var marks = [];
    rs.forEach(function (row, i) {
      var value = Math.max(0, asNumber(cell(row, valueField)) || 0);
      var next = angle + (value / total) * Math.PI * 2;
      var path = append(svg, svgEl('path', { d: arcPath(cx, cy, inner, r, angle, next), fill: color(i), class: 'ug-mark' }));
      marks.push({ el: path, label: cell(row, labelField) + ': ' + formatValue(value) });
      angle = next;
    });
    addLegend(svg, rs.map(function (row) { return cell(row, labelField); }));
    addTooltipMarks(svg, marks);
    return svg;
  }

  function renderFunnel(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var labelField = enc(graph, 'label'), valueField = enc(graph, 'value');
    if (!rs.length) return renderUnsupported(graph, 'No graph data to display');
    var max = Math.max.apply(Math, rs.map(function (row) { return asNumber(cell(row, valueField)) || 0; }).concat([1]));
    var top = 58, h = 42, center = WIDTH / 2;
    rs.slice(0, 7).forEach(function (row, i) {
      var value = asNumber(cell(row, valueField)) || 0;
      var width = 120 + (value / max) * 440;
      var nextWidth = i === rs.length - 1 ? width * 0.7 : 120 + ((asNumber(cell(rs[i + 1], valueField)) || 0) / max) * 440;
      var y = top + i * (h + 4);
      append(svg, svgEl('polygon', {
        points: [
          center - width / 2, y,
          center + width / 2, y,
          center + nextWidth / 2, y + h,
          center - nextWidth / 2, y + h,
        ].join(' '),
        fill: color(i),
        class: 'ug-mark ug-funnel',
      }));
      append(svg, textEl(center, y + 26, shortText(cell(row, labelField), 24) + ' - ' + formatValue(value), 'ug-invert-label', { 'text-anchor': 'middle' }));
    });
    return svg;
  }

  function renderGauge(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var valueField = enc(graph, 'value');
    var value = asNumber(cell(rs[0] || {}, valueField)) || 0;
    var max = asNumber(graph.max) || 100;
    var pct = Math.max(0, Math.min(1, value / max));
    var cx = WIDTH / 2, cy = 235, r = 140;
    append(svg, svgEl('path', { d: arcPath(cx, cy, r - 22, r, Math.PI, Math.PI * 2), class: 'ug-gauge-bg' }));
    append(svg, svgEl('path', { d: arcPath(cx, cy, r - 22, r, Math.PI, Math.PI + pct * Math.PI), fill: color(0), class: 'ug-mark' }));
    var a = Math.PI + pct * Math.PI;
    append(svg, svgEl('line', { x1: cx, y1: cy, x2: cx + Math.cos(a) * (r - 34), y2: cy + Math.sin(a) * (r - 34), class: 'ug-strong-line' }));
    append(svg, textEl(cx, cy - 20, formatValue(value), 'ug-big-number', { 'text-anchor': 'middle' }));
    return svg;
  }

  function renderRadar(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var labelField = enc(graph, 'label'), valueField = enc(graph, 'value');
    var max = Math.max.apply(Math, rs.map(function (row) { return asNumber(cell(row, valueField)) || 0; }).concat([1]));
    var cx = WIDTH / 2, cy = HEIGHT / 2 + 10, r = 122;
    var points = [];
    rs.forEach(function (row, i) {
      var a = -Math.PI / 2 + (i / rs.length) * Math.PI * 2;
      var value = asNumber(cell(row, valueField)) || 0;
      var rr = (value / max) * r;
      append(svg, svgEl('line', { x1: cx, y1: cy, x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r, class: 'ug-grid-line' }));
      append(svg, textEl(cx + Math.cos(a) * (r + 20), cy + Math.sin(a) * (r + 20), shortText(cell(row, labelField), 12), 'ug-axis-label', { 'text-anchor': 'middle' }));
      points.push((cx + Math.cos(a) * rr) + ',' + (cy + Math.sin(a) * rr));
    });
    append(svg, svgEl('polygon', { points: points.join(' '), fill: color(0), class: 'ug-area' }));
    append(svg, svgEl('polygon', { points: points.join(' '), fill: 'none', stroke: color(0), class: 'ug-line' }));
    return svg;
  }

  function renderCandlestick(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var xField = enc(graph, 'x');
    var openField = enc(graph, 'open'), highField = enc(graph, 'high'), lowField = enc(graph, 'low'), closeField = enc(graph, 'close');
    var labels = unique(rs.map(function (row) { return cell(row, xField); }));
    var domain = extent(rs.flatMap(function (row) { return [cell(row, highField), cell(row, lowField)].map(asNumber); }).filter(function (n) { return n !== null; }));
    drawAxes(svg, labels, domain);
    var x = categoryScale(labels, [PLOT.left, WIDTH - PLOT.right]);
    var y = linearScale(domain, [HEIGHT - PLOT.bottom, PLOT.top]);
    rs.forEach(function (row) {
      var xp = x.pos(cell(row, xField));
      var open = asNumber(cell(row, openField)) || 0;
      var high = asNumber(cell(row, highField)) || open;
      var low = asNumber(cell(row, lowField)) || open;
      var close = asNumber(cell(row, closeField)) || open;
      var up = close >= open;
      append(svg, svgEl('line', { x1: xp, x2: xp, y1: y(low), y2: y(high), class: 'ug-line' }));
      append(svg, svgEl('rect', { x: xp - 6, y: Math.min(y(open), y(close)), width: 12, height: Math.max(2, Math.abs(y(open) - y(close))), class: up ? 'ug-candle-up' : 'ug-candle-down' }));
    });
    return svg;
  }

  function renderTimeline(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var labelField = enc(graph, 'label'), startField = enc(graph, 'start'), endField = enc(graph, 'end');
    var times = [];
    rs.forEach(function (row) {
      var s = asTime(cell(row, startField));
      var e = asTime(cell(row, endField));
      if (s !== null) times.push(s);
      if (e !== null) times.push(e);
    });
    var domain = extent(times);
    var x = linearScale(domain, [PLOT.left + 90, WIDTH - PLOT.right]);
    rs.slice(0, 12).forEach(function (row, i) {
      var y = PLOT.top + i * 24 + 12;
      var s = asTime(cell(row, startField)) || domain[0];
      var e = asTime(cell(row, endField)) || s;
      append(svg, textEl(PLOT.left + 78, y + 4, shortText(cell(row, labelField), 16), 'ug-axis-label', { 'text-anchor': 'end' }));
      append(svg, svgEl('rect', { x: x(s), y: y - 8, width: Math.max(4, x(e) - x(s)), height: 16, rx: 4, fill: color(i), class: 'ug-mark' }));
    });
    append(svg, svgEl('line', { x1: PLOT.left + 90, y1: HEIGHT - PLOT.bottom, x2: WIDTH - PLOT.right, y2: HEIGHT - PLOT.bottom, class: 'ug-axis' }));
    return svg;
  }

  function hierarchyRows(graph) {
    var rs = rows(graph);
    var labelField = enc(graph, 'label');
    var parentField = enc(graph, 'parent');
    var valueField = enc(graph, 'value');
    var nodes = {};
    rs.forEach(function (row) {
      var id = String(cell(row, labelField));
      nodes[id] = nodes[id] || { id: id, label: id, value: asNumber(cell(row, valueField)) || 1, children: [] };
    });
    var roots = [];
    rs.forEach(function (row) {
      var id = String(cell(row, labelField));
      var parent = parentField ? String(cell(row, parentField) || '') : '';
      if (parent && nodes[parent] && parent !== id) nodes[parent].children.push(nodes[id]);
      else roots.push(nodes[id]);
    });
    return roots.length ? roots : Object.keys(nodes).map(function (id) { return nodes[id]; });
  }

  function renderTree(graph) {
    var svg = createSvg();
    var roots = hierarchyRows(graph);
    var levels = [];
    function walk(node, depth) {
      levels[depth] = levels[depth] || [];
      levels[depth].push(node);
      (node.children || []).forEach(function (child) { walk(child, depth + 1); });
    }
    roots.forEach(function (root) { walk(root, 0); });
    var positions = {};
    levels.forEach(function (nodes, depth) {
      nodes.forEach(function (node, i) {
        positions[node.id] = {
          x: PLOT.left + depth * ((WIDTH - PLOT.left - PLOT.right) / Math.max(1, levels.length - 1)),
          y: PLOT.top + (i + 1) * ((HEIGHT - PLOT.top - PLOT.bottom) / (nodes.length + 1)),
        };
      });
    });
    Object.keys(positions).forEach(function (id) {
      var node = findNode(roots, id);
      (node.children || []).forEach(function (child) {
        append(svg, svgEl('line', { x1: positions[id].x, y1: positions[id].y, x2: positions[child.id].x, y2: positions[child.id].y, class: 'ug-link' }));
      });
    });
    Object.keys(positions).forEach(function (id, i) {
      append(svg, svgEl('circle', { cx: positions[id].x, cy: positions[id].y, r: 12, fill: color(i), class: 'ug-node' }));
      append(svg, textEl(positions[id].x + 16, positions[id].y + 4, shortText(id, 18), 'ug-node-label'));
    });
    return svg;
  }

  function findNode(nodes, id) {
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].id === id) return nodes[i];
      var found = findNode(nodes[i].children || [], id);
      if (found) return found;
    }
    return null;
  }

  function renderNetwork(graph, sankey) {
    var svg = createSvg();
    var rs = rows(graph);
    var sourceField = enc(graph, 'source'), targetField = enc(graph, 'target'), valueField = enc(graph, 'value');
    var labels = unique(rs.flatMap(function (row) { return [cell(row, sourceField), cell(row, targetField)]; }));
    var pos = {};
    labels.forEach(function (label, i) {
      if (sankey) {
        var isSource = rs.some(function (row) { return String(cell(row, sourceField)) === String(label); });
        var x = isSource ? PLOT.left + 70 : WIDTH - PLOT.right - 110;
        pos[label] = { x: x, y: PLOT.top + (i + 1) * ((HEIGHT - PLOT.top - PLOT.bottom) / (labels.length + 1)) };
      } else {
        var a = -Math.PI / 2 + (i / labels.length) * Math.PI * 2;
        pos[label] = { x: WIDTH / 2 + Math.cos(a) * 230, y: HEIGHT / 2 + Math.sin(a) * 125 };
      }
    });
    rs.forEach(function (row) {
      var s = pos[cell(row, sourceField)], t = pos[cell(row, targetField)];
      if (!s || !t) return;
      var width = sankey ? Math.max(2, Math.sqrt(asNumber(cell(row, valueField)) || 1)) : 1.5;
      var path = sankey
        ? 'M ' + s.x + ' ' + s.y + ' C ' + (s.x + 160) + ' ' + s.y + ', ' + (t.x - 160) + ' ' + t.y + ', ' + t.x + ' ' + t.y
        : 'M ' + s.x + ' ' + s.y + ' L ' + t.x + ' ' + t.y;
      append(svg, svgEl('path', { d: path, fill: 'none', 'stroke-width': width, class: sankey ? 'ug-sankey-link' : 'ug-link' }));
    });
    labels.forEach(function (label, i) {
      append(svg, svgEl('circle', { cx: pos[label].x, cy: pos[label].y, r: sankey ? 9 : 13, fill: color(i), class: 'ug-node' }));
      append(svg, textEl(pos[label].x + 14, pos[label].y + 4, shortText(label, 16), 'ug-node-label'));
    });
    return svg;
  }

  function renderTreemap(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var labelField = enc(graph, 'label'), valueField = enc(graph, 'value');
    var total = rs.reduce(function (sum, row) { return sum + Math.max(0, asNumber(cell(row, valueField)) || 0); }, 0) || 1;
    var x = PLOT.left, y = PLOT.top, w = WIDTH - PLOT.left - PLOT.right, h = HEIGHT - PLOT.top - PLOT.bottom;
    var horizontal = true;
    rs.forEach(function (row, i) {
      var share = Math.max(0, asNumber(cell(row, valueField)) || 0) / total;
      if (horizontal) {
        var rw = w * share;
        append(svg, svgEl('rect', { x: x, y: y, width: rw, height: h, fill: color(i), class: 'ug-mark ug-treemap-cell' }));
        append(svg, textEl(x + 8, y + 22, shortText(cell(row, labelField), 20), 'ug-invert-label'));
        x += rw;
      } else {
        var rh = h * share;
        append(svg, svgEl('rect', { x: x, y: y, width: w, height: rh, fill: color(i), class: 'ug-mark ug-treemap-cell' }));
        y += rh;
      }
    });
    return svg;
  }

  function renderGraphSvg(graph) {
    if (!graph || !GRAPH_TYPES[graph.type]) return renderUnsupported(graph, 'Unsupported graph type');
    if (['line', 'area', 'bar', 'stacked_bar', 'grouped_bar', 'scatter', 'bubble', 'combo', 'waterfall'].indexOf(graph.type) >= 0) {
      return renderCartesian(graph.type === 'waterfall' ? waterfallAsBar(graph) : graph);
    }
    if (graph.type === 'histogram') return renderHistogram(graph);
    if (graph.type === 'boxplot') return renderBoxplot(graph);
    if (graph.type === 'heatmap' || graph.type === 'matrix') return renderHeatmap(graph);
    if (graph.type === 'pie' || graph.type === 'donut') return renderPie(graph, graph.type === 'donut');
    if (graph.type === 'funnel') return renderFunnel(graph);
    if (graph.type === 'gauge') return renderGauge(graph);
    if (graph.type === 'radar') return renderRadar(graph);
    if (graph.type === 'candlestick') return renderCandlestick(graph);
    if (graph.type === 'timeline' || graph.type === 'gantt') return renderTimeline(graph);
    if (graph.type === 'tree') return renderTree(graph);
    if (graph.type === 'network') return renderNetwork(graph, false);
    if (graph.type === 'sankey') return renderNetwork(graph, true);
    if (graph.type === 'treemap') return renderTreemap(graph);
    if (graph.type === 'sunburst') return renderPie(graph, true);
    return renderUnsupported(graph, 'Unsupported graph type');
  }

  function waterfallAsBar(graph) {
    var labelField = enc(graph, 'label'), valueField = enc(graph, 'value');
    var running = 0;
    return {
      id: graph.id,
      title: graph.title,
      type: 'bar',
      data: {
        columns: [{ id: 'label' }, { id: 'running' }],
        rows: rows(graph).map(function (row) {
          running += asNumber(cell(row, valueField)) || 0;
          return { label: cell(row, labelField), running: running };
        }),
      },
      encoding: { x: 'label', y: 'running' },
    };
  }

  function renderUnsupported(graph, message) {
    var svg = createSvg();
    append(svg, textEl(WIDTH / 2, HEIGHT / 2, message || 'Unable to render graph', 'ug-empty-text', { 'text-anchor': 'middle' }));
    if (graph && graph.type) append(svg, textEl(WIDTH / 2, HEIGHT / 2 + 24, 'Type: ' + graph.type, 'ug-axis-label', { 'text-anchor': 'middle' }));
    return svg;
  }

  function buildSourceTable(graph) {
    var wrap = document.createElement('div');
    wrap.className = 'ug-source';
    var table = document.createElement('table');
    table.className = 'ug-source-table';
    var columns = (graph.data && graph.data.columns) || [];
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    columns.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.name || col.id;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows(graph).slice(0, 100).forEach(function (row) {
      var tr = document.createElement('tr');
      columns.forEach(function (col) {
        var td = document.createElement('td');
        td.textContent = formatValue(cell(row, col.id));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function buildGraphCard(graph) {
    var card = document.createElement('section');
    card.className = 'ug-card';
    card.setAttribute('data-graph-id', graph.id || '');
    card.setAttribute('data-graph-type', graph.type || '');

    var header = document.createElement('div');
    header.className = 'ug-card-header';
    var title = document.createElement('h3');
    title.className = 'ug-card-title';
    title.textContent = graph.title || graph.id || 'Graph';
    header.appendChild(title);
    var type = document.createElement('span');
    type.className = 'ug-type-badge';
    type.textContent = String(graph.type || 'unknown').replace(/_/g, ' ');
    header.appendChild(type);
    card.appendChild(header);

    if (graph.description || graph.subtitle) {
      var desc = document.createElement('p');
      desc.className = 'ug-card-description';
      desc.textContent = graph.description || graph.subtitle;
      card.appendChild(desc);
    }

    var stage = document.createElement('div');
    stage.className = 'ug-stage';
    stage.appendChild(renderGraphSvg(graph));
    card.appendChild(stage);

    var actions = document.createElement('div');
    actions.className = 'ug-actions';
    var dataBtn = document.createElement('button');
    dataBtn.className = 'ug-action-btn';
    dataBtn.textContent = 'Data';
    dataBtn.title = 'Show source data';
    actions.appendChild(dataBtn);
    card.appendChild(actions);

    var source = buildSourceTable(graph);
    source.hidden = true;
    card.appendChild(source);
    dataBtn.addEventListener('click', function () {
      source.hidden = !source.hidden;
      dataBtn.classList.toggle('ug-action-active', !source.hidden);
    });

    return card;
  }

  function normalizeData(data) {
    if (!data || typeof data !== 'object') return { title: '', graphs: [] };
    return {
      title: data.title || '',
      description: data.description || '',
      graphs: Array.isArray(data.graphs) ? data.graphs : [],
    };
  }

  function renderUniversalGraph(container, data) {
    var normalized = normalizeData(data);
    container.classList.add('ug-root');

    if (normalized.title || normalized.description) {
      var header = document.createElement('header');
      header.className = 'ug-header';
      if (normalized.title) {
        var h = document.createElement('h2');
        h.className = 'ug-title';
        h.textContent = normalized.title;
        header.appendChild(h);
      }
      if (normalized.description) {
        var p = document.createElement('p');
        p.className = 'ug-description';
        p.textContent = normalized.description;
        header.appendChild(p);
      }
      container.appendChild(header);
    }

    if (!normalized.graphs.length) {
      var empty = document.createElement('div');
      empty.className = 'ug-empty';
      empty.textContent = 'No graphs to display.';
      container.appendChild(empty);
      return;
    }

    var list = document.createElement('div');
    list.className = 'ug-list';
    normalized.graphs.forEach(function (graph) {
      list.appendChild(buildGraphCard(graph));
    });
    container.appendChild(list);
  }

  function injectStyles() {
    // Main styles live in src/styles.css; this exists for isolated test harnesses.
    if (document.getElementById('universal-graph-test-styles')) return;
    var style = document.createElement('style');
    style.id = 'universal-graph-test-styles';
    style.textContent = '.ug-svg{width:100%;height:auto}.ug-card{margin:8px 0}.ug-source[hidden]{display:none}';
    document.head.appendChild(style);
  }

  function findGraphById(graphs, id) {
    for (var i = 0; i < (graphs || []).length; i += 1) {
      if (graphs[i].id === id) return graphs[i];
    }
    return null;
  }

  function buildGraphContainer(graph) {
    injectStyles();
    return buildGraphCard(graph);
  }

  window.__renderers.universal_graph = function (container, data) {
    injectStyles();
    renderUniversalGraph(container, data);
  };

  window.__universalGraphEmbed.injectStyles = injectStyles;
  window.__universalGraphEmbed.buildGraphContainer = buildGraphContainer;
  window.__universalGraphEmbed.findGraphById = findGraphById;
  window.__universalGraphEmbed.renderGraphSvg = renderGraphSvg;
})();
