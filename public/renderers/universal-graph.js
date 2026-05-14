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
  var SOURCE_ROW_LIMIT = 100;
  var DEFAULT_MAX_VISIBLE_ITEMS = 24;
  var DEFAULT_MAX_LINKS = 40;
  var DEFAULT_MAX_TIMELINE_ROWS = 12;
  var DEFAULT_MAX_FUNNEL_STAGES = 7;
  var MAX_MARK_POINTS = 48;
  var DENSE_POINT_PATH_THRESHOLD = 1200;
  var DENSE_HEATMAP_CELL_THRESHOLD = 1200;
  var DENSE_HEATMAP_BUCKETS = 16;
  var DENSE_NETWORK_LAYOUT_THRESHOLD = 300;
  var DENSE_LINK_PATH_THRESHOLD = 500;
  var DENSE_NODE_PATH_THRESHOLD = 800;
  var MIN_X_TICK_GAP = 66;
  var MIN_Y_TICK_GAP = 22;
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
    var nextAttrs = Object.assign({}, attrs || {});
    var fullText = nextAttrs.fullText != null ? nextAttrs.fullText : text;
    delete nextAttrs.fullText;
    var el = svgEl('text', Object.assign({ x: x, y: y, class: cls || 'ug-svg-text' }, nextAttrs));
    el.textContent = String(text == null ? '' : text);
    addSvgTitle(el, fullText);
    return el;
  }

  function addSvgTitle(el, label) {
    if (label === null || label === undefined || label === '') return el;
    el.setAttribute('aria-label', String(label));
    el.setAttribute('data-ug-tooltip-title', String(label));
    Array.prototype.slice.call(el.childNodes || []).forEach(function (child) {
      if (child.nodeName && child.nodeName.toLowerCase() === 'title') el.removeChild(child);
    });
    var title = svgEl('title', {});
    title.textContent = String(label);
    el.appendChild(title);
    return el;
  }

  function suppressNativeSvgTitle(el) {
    if (!el || !el.childNodes) return;
    Array.prototype.slice.call(el.childNodes).forEach(function (child) {
      if (child.nodeName && child.nodeName.toLowerCase() === 'title') {
        el.removeChild(child);
      }
    });
    if (el.setAttribute) el.setAttribute('data-ug-native-title-suppressed', 'true');
  }

  function shortText(value, max) {
    var text = String(value == null ? '' : value);
    max = max || 28;
    return text.length > max ? text.slice(0, max - 1) + '...' : text;
  }

  function roundCoord(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  function pointRadius(graph, row, sizeField, count) {
    if (graph.type === 'bubble') {
      return Math.max(3, Math.min(16, Math.sqrt(asNumber(cell(row, sizeField)) || 16)));
    }
    return count > 500 ? 3.2 : 5;
  }

  function pointCirclePath(x, y, radius) {
    x = roundCoord(x);
    y = roundCoord(y);
    radius = roundCoord(radius);
    return [
      'M', roundCoord(x - radius), y,
      'a', radius, radius, 0, 1, 0, roundCoord(radius * 2), 0,
      'a', radius, radius, 0, 1, 0, roundCoord(radius * -2), 0,
    ].join(' ');
  }

  function rectPath(x, y, width, height) {
    x = roundCoord(x);
    y = roundCoord(y);
    width = roundCoord(width);
    height = roundCoord(height);
    return ['M', x, y, 'h', width, 'v', height, 'h', roundCoord(width * -1), 'Z'].join(' ');
  }

  function linkPathBetween(source, target, sankey) {
    if (sankey) {
      return 'M ' + roundCoord(source.x) + ' ' + roundCoord(source.y) +
        ' C ' + roundCoord(source.x + 160) + ' ' + roundCoord(source.y) +
        ', ' + roundCoord(target.x - 160) + ' ' + roundCoord(target.y) +
        ', ' + roundCoord(target.x) + ' ' + roundCoord(target.y);
    }
    return 'M ' + roundCoord(source.x) + ' ' + roundCoord(source.y) + ' L ' + roundCoord(target.x) + ' ' + roundCoord(target.y);
  }

  function densePointPath(points, graph, sizeField) {
    return points.map(function (point) {
      return pointCirclePath(point.x, point.y, pointRadius(graph, point.row, sizeField, points.length));
    }).join(' ');
  }

  function shouldShowFocusPoint(index, count) {
    if (count <= MAX_MARK_POINTS) return true;
    var step = Math.ceil(count / MAX_MARK_POINTS);
    return index % step === 0 || index === count - 1;
  }

  function graphOptions(graph) {
    return graph && graph.options && typeof graph.options === 'object' ? graph.options : {};
  }

  function showAll(graph) {
    return graphOptions(graph).showAll === true;
  }

  function otherBucketMode(graph) {
    var mode = String(graphOptions(graph).otherBucket || 'separate').toLowerCase();
    return mode === 'inline' || mode === 'hidden' || mode === 'separate' ? mode : 'separate';
  }

  function optionInteger(graph, key, fallback, min, max) {
    var value = asNumber(graphOptions(graph)[key]);
    if (value === null) return fallback;
    value = Math.floor(value);
    if (min !== undefined) value = Math.max(min, value);
    if (max !== undefined) value = Math.min(max, value);
    return value;
  }

  function maxVisibleItems(graph, fallback) {
    var value = asNumber(graphOptions(graph).maxVisibleItems);
    if (value !== null && value > 0) return Math.max(1, Math.floor(value));
    return fallback || DEFAULT_MAX_VISIBLE_ITEMS;
  }

  function validScaleKind(value) {
    value = String(value || 'auto').toLowerCase();
    return value === 'category' || value === 'linear' || value === 'time' ? value : 'auto';
  }

  function fieldColumn(graph, field) {
    return columnMap(graph)[field] || {};
  }

  function columnType(graph, field) {
    return String(fieldColumn(graph, field).type || '').toLowerCase();
  }

  function allNumbers(values) {
    return values.length > 0 && values.every(function (value) { return asNumber(value) !== null; });
  }

  function allTimes(values) {
    return values.length > 0 && values.every(function (value) { return asTime(value) !== null; });
  }

  function sampleValues(values, max) {
    if (values.length <= max) return values.slice();
    var last = values.length - 1;
    var out = [];
    var seen = {};
    for (var i = 0; i < max; i += 1) {
      var idx = Math.round((i / Math.max(1, max - 1)) * last);
      if (!seen[idx]) {
        seen[idx] = true;
        out.push(values[idx]);
      }
    }
    return out;
  }

  function cullTicksByPosition(ticks, pos, minGap) {
    if (!ticks || ticks.length <= 2) return ticks || [];
    var sorted = ticks.slice().sort(function (a, b) { return pos(a.value) - pos(b.value); });
    var firstTick = sorted[0];
    var lastTick = sorted[sorted.length - 1];
    var centerPos = (pos(firstTick.value) + pos(lastTick.value)) / 2;
    var middleTick = sorted.reduce(function (best, tick) {
      if (tick === firstTick || tick === lastTick) return best;
      if (!best) return tick;
      return Math.abs(pos(tick.value) - centerPos) < Math.abs(pos(best.value) - centerPos) ? tick : best;
    }, null);
    var out = [];
    function pushTick(tick, important) {
      var p = pos(tick.value);
      if (!out.length) {
        out.push({ tick: tick, pos: p, important: important });
        return;
      }
      var prior = out[out.length - 1];
      if (p - prior.pos >= minGap) {
        out.push({ tick: tick, pos: p, important: important });
        return;
      }
      if (important && !prior.important) {
        out.pop();
        pushTick(tick, important);
        return;
      }
      if (important && tick === lastTick && prior.tick !== firstTick) {
        out.pop();
        pushTick(tick, important);
      }
    }
    sorted.forEach(function (tick, index) {
      var important = index === 0 || index === sorted.length - 1 || tick === middleTick;
      pushTick(tick, important);
    });
    return out.map(function (entry) { return entry.tick; });
  }

  function addDensityNote(svg, message) {
    if (!message) return;
    var noteCount = svg.querySelectorAll ? svg.querySelectorAll('.ug-density-note').length : 0;
    var note = append(svg, svgEl('text', {
      x: WIDTH - PLOT.right,
      y: HEIGHT - 12 - noteCount * 14,
      class: 'ug-density-note',
      'text-anchor': 'end',
    }));
    note.textContent = message;
    note.setAttribute('aria-label', message);
  }

  function addGraphWarning(graph, message) {
    if (!graph || !message) return;
    graph.__ugWarnings = graph.__ugWarnings || [];
    if (graph.__ugWarnings.indexOf(message) < 0) graph.__ugWarnings.push(message);
  }

  function resetGraphWarnings(graph) {
    if (graph) graph.__ugWarnings = [];
  }

  function filterRowsWithValidNumbers(graph, rs, fields, context) {
    fields = fields.filter(Boolean);
    if (!fields.length) return rs.slice();
    var dropped = 0;
    var out = rs.filter(function (row) {
      var valid = fields.every(function (field) { return asNumber(cell(row, field)) !== null; });
      if (!valid) dropped += 1;
      return valid;
    });
    if (dropped) addGraphWarning(graph, 'Dropped ' + dropped + ' row' + (dropped === 1 ? '' : 's') + ' with invalid numeric values for ' + context + '.');
    return out;
  }

  function filterRowsWithValidTimes(graph, rs, fields, context) {
    fields = fields.filter(Boolean);
    if (!fields.length) return rs.slice();
    var dropped = 0;
    var out = rs.filter(function (row) {
      var valid = fields.every(function (field) { return asTime(cell(row, field)) !== null; });
      if (!valid) dropped += 1;
      return valid;
    });
    if (dropped) addGraphWarning(graph, 'Dropped ' + dropped + ' row' + (dropped === 1 ? '' : 's') + ' with invalid time values for ' + context + '.');
    return out;
  }

  function textValue(value) {
    if (value === null || value === undefined) return null;
    var text = String(value).trim();
    return text ? text : null;
  }

  function filterRowsWithValidText(graph, rs, fields, context) {
    fields = fields.filter(Boolean);
    if (!fields.length) return rs.slice();
    var dropped = 0;
    var out = rs.filter(function (row) {
      var valid = fields.every(function (field) { return textValue(cell(row, field)) !== null; });
      if (!valid) dropped += 1;
      return valid;
    });
    if (dropped) addGraphWarning(graph, 'Dropped ' + dropped + ' row' + (dropped === 1 ? '' : 's') + ' with missing text values for ' + context + '.');
    return out;
  }

  function filterPositiveValueRows(graph, rs, valueField, context) {
    var ignored = 0;
    var out = rs.filter(function (row) {
      var value = asNumber(cell(row, valueField));
      var keep = value !== null && value > 0;
      if (!keep) ignored += 1;
      return keep;
    });
    if (ignored) addGraphWarning(graph, 'Ignored ' + ignored + ' non-positive ' + context + (ignored === 1 ? '' : 's') + '.');
    return out;
  }

  function axisRequiredKind(graph, field, axisKey, preferContinuous) {
    var optionKind = validScaleKind(graphOptions(graph)[axisKey + 'Scale']);
    var type = columnType(graph, field);
    if (optionKind === 'time' || type === 'date') return 'time';
    if (optionKind === 'linear' || (preferContinuous && type === 'number')) return 'linear';
    return null;
  }

  function formatTick(value, kind) {
    if (kind === 'time') {
      var d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return formatValue(value);
  }

  function continuousTicks(domain, kind, count) {
    var ticks = [];
    count = count || 5;
    for (var i = 0; i < count; i += 1) {
      var value = domain[0] + ((domain[1] - domain[0]) * i / Math.max(1, count - 1));
      ticks.push({ value: value, label: formatTick(value, kind), fullText: formatTick(value, kind) });
    }
    return ticks;
  }

  function makeAxisScale(graph, field, values, range, axisKey, preferContinuous) {
    var optionKind = validScaleKind(graphOptions(graph)[axisKey + 'Scale']);
    var type = columnType(graph, field);
    var kind = optionKind;
    if (kind === 'auto') {
      if (type === 'date' && allTimes(values)) kind = 'time';
      else if ((type === 'number' || preferContinuous) && allNumbers(values)) kind = 'linear';
      else kind = 'category';
    }

    if (kind === 'time' && allTimes(values)) {
      var timeDomain = extent(values.map(asTime));
      var timeScale = linearScale(timeDomain, range);
      return {
        kind: 'time',
        band: Math.max(2, Math.abs(range[1] - range[0]) / Math.max(1, values.length) * 0.65),
        pos: function (value) {
          var t = asTime(value);
          return timeScale(t === null ? timeDomain[0] : t);
        },
      ticks: continuousTicks(timeDomain, 'time', 5),
      };
    }

    if (kind === 'linear' && allNumbers(values)) {
      var numDomain = extent(values);
      var numScale = linearScale(numDomain, range);
      return {
        kind: 'linear',
        band: Math.max(2, Math.abs(range[1] - range[0]) / Math.max(1, values.length) * 0.65),
        pos: function (value) {
          var n = asNumber(value);
          return numScale(n === null ? numDomain[0] : n);
        },
      ticks: continuousTicks(numDomain, 'linear', 5),
      };
    }

    var categories = unique(values);
    var category = categoryScale(categories, range);
    var maxTicks = Math.max(2, Math.floor(Math.abs(range[1] - range[0]) / MIN_X_TICK_GAP));
    return {
      kind: 'category',
      band: category.band,
      step: category.step,
      pos: category.pos,
      ticks: sampleValues(categories, maxTicks).map(function (value) {
        return { value: value, label: shortText(value, 12), fullText: value };
      }),
      categories: categories,
    };
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

  function axisConfig(graph, axis) {
    var axes = graph && graph.axes && typeof graph.axes === 'object' ? graph.axes : {};
    if (!axes[axis] && graphOptions(graph).axes && typeof graphOptions(graph).axes === 'object') {
      axes = graphOptions(graph).axes;
    }
    var raw = axes[axis];
    if (typeof raw === 'string') return { label: raw };
    return raw && typeof raw === 'object' ? raw : {};
  }

  function axisTitleText(graph, axis, fields, fallback) {
    var config = axisConfig(graph, axis);
    if (typeof config.label === 'string' && config.label.trim()) return config.label.trim();
    if (!Array.isArray(fields)) fields = fields ? [fields] : [];
    var labels = fields.filter(Boolean).map(function (field) { return columnLabel(graph, field); });
    return labels.length ? labels.join(' / ') : fallback;
  }

  function axisTitleFullText(graph, axis, label) {
    var config = axisConfig(graph, axis);
    var description = typeof config.description === 'string' ? config.description.trim() : '';
    return description ? label + ': ' + description : label;
  }

  function axisContextEntries(graph) {
    var entries = [];
    ['x', 'y'].forEach(function (axis) {
      var config = axisConfig(graph, axis);
      var fields = encList(graph, axis);
      var label = axisTitleText(graph, axis, fields, '');
      var hasConfiguredContext = (typeof config.label === 'string' && config.label.trim())
        || (typeof config.description === 'string' && config.description.trim());
      if (!label && !hasConfiguredContext) return;
      entries.push({
        axis: axis.toUpperCase(),
        label: label || axis.toUpperCase() + ' axis',
        fullText: axisTitleFullText(graph, axis, label || axis.toUpperCase() + ' axis'),
      });
    });
    return entries;
  }

  function appendAxisContext(card, graph) {
    var entries = axisContextEntries(graph);
    if (!entries.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'ug-axis-context';
    entries.forEach(function (entry) {
      var item = document.createElement('span');
      item.className = 'ug-axis-context-item';
      item.title = entry.fullText;
      var axis = document.createElement('strong');
      axis.textContent = entry.axis;
      var label = document.createElement('span');
      label.textContent = entry.label;
      item.appendChild(axis);
      item.appendChild(label);
      wrap.appendChild(item);
    });
    card.appendChild(wrap);
  }

  function addAxisTitles(svg, graph, info) {
    info = info || {};
    var plot = info.plot || PLOT;
    var xLabel = info.xLabel || axisTitleText(graph, 'x', info.xField, '');
    var yLabel = info.yLabel || axisTitleText(graph, 'y', info.yFields, '');
    if (xLabel) {
      append(svg, textEl((plot.left + WIDTH - plot.right) / 2, HEIGHT - 12, shortText(xLabel, 52), 'ug-axis-title', {
        'text-anchor': 'middle',
        fullText: axisTitleFullText(graph, 'x', xLabel),
      }));
    }
    if (yLabel) {
      var x = 14;
      var y = (plot.top + HEIGHT - plot.bottom) / 2;
      append(svg, textEl(x, y, shortText(yLabel, 38), 'ug-axis-title', {
        'text-anchor': 'middle',
        transform: 'rotate(-90 ' + x + ' ' + y + ')',
        fullText: axisTitleFullText(graph, 'y', yLabel),
      }));
    }
  }

  function heatmapPlot(ys) {
    var longest = unique(ys || []).reduce(function (max, label) {
      return Math.max(max, String(label == null ? '' : label).length);
    }, 0);
    return {
      left: Math.max(PLOT.left, Math.min(172, 20 + Math.min(22, longest) * 7)),
      right: PLOT.right,
      top: PLOT.top,
      bottom: PLOT.bottom,
    };
  }

  function drawAxes(svg, xSpec, yDomain, graph, info) {
    info = info || {};
    var plot = info.plot || PLOT;
    var x0 = plot.left, y0 = HEIGHT - plot.bottom, x1 = WIDTH - plot.right, y1 = plot.top;
    append(svg, svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y0, class: 'ug-axis' }));
    append(svg, svgEl('line', { x1: x0, y1: y0, x2: x0, y2: y1, class: 'ug-axis' }));
    var ticks = 4;
    for (var i = 0; i <= ticks; i += 1) {
      var v = yDomain[0] + ((yDomain[1] - yDomain[0]) * i / ticks);
      var y = linearScale(yDomain, [y0, y1])(v);
      append(svg, svgEl('line', { x1: x0, y1: y, x2: x1, y2: y, class: 'ug-grid' }));
      append(svg, textEl(x0 - 8, y + 4, formatValue(v), 'ug-axis-label', { 'text-anchor': 'end' }));
    }
    var xScale = Array.isArray(xSpec)
      ? makeAxisScale({ data: { columns: [] }, encoding: {} }, '__x', xSpec, [x0, x1], 'x', false)
      : xSpec;
    cullTicksByPosition(xScale.ticks || [], xScale.pos, MIN_X_TICK_GAP).forEach(function (tick) {
      append(svg, textEl(xScale.pos(tick.value), y0 + 22, shortText(tick.label, 12), 'ug-axis-label', {
        'text-anchor': 'middle',
        fullText: tick.fullText || tick.label,
      }));
    });
    addAxisTitles(svg, graph, info);
  }

  function graphInteractions(graph) {
    return graph && graph.interactions && typeof graph.interactions === 'object' ? graph.interactions : {};
  }

  function detailConfig(graph) {
    var details = graphInteractions(graph).details;
    return details && typeof details === 'object' ? details : {};
  }

  function columnLabel(graph, field) {
    var col = fieldColumn(graph, field);
    return col.name || field;
  }

  function configuredDetailFields(graph, row) {
    var config = detailConfig(graph);
    var fields = Array.isArray(config.fields) ? config.fields : [];
    return fields.map(function (item) {
      if (typeof item === 'string') return { field: item, label: columnLabel(graph, item), value: cell(row, item) };
      if (item && typeof item === 'object' && typeof item.field === 'string') {
        return { field: item.field, label: item.label || columnLabel(graph, item.field), value: cell(row, item.field) };
      }
      return null;
    }).filter(Boolean);
  }

  function defaultDetailFields(graph, row, mark) {
    var fields = [];
    var seen = {};
    function pushField(field) {
      if (!field || seen[field]) return;
      seen[field] = true;
      fields.push({ field: field, label: columnLabel(graph, field), value: cell(row, field) });
    }
    Object.keys(graph.encoding || {}).forEach(function (key) {
      encList(graph, key).forEach(pushField);
    });
    ((graph.data && graph.data.columns) || []).forEach(function (col) {
      pushField(col.id);
    });
    if (mark && mark.extraFields) {
      mark.extraFields.forEach(function (item) {
        if (item && item.label) fields.push(item);
      });
    }
    return fields.slice(0, 12);
  }

  function markDetail(graph, mark) {
    mark = mark || {};
    var row = mark.row || null;
    var config = detailConfig(graph);
    var title = mark.title || mark.label || '';
    if (row && config.titleField && cell(row, config.titleField) !== undefined) {
      title = formatValue(cell(row, config.titleField));
    }
    var fields = mark.fields || [];
    if (!fields.length && row) fields = configuredDetailFields(graph, row);
    if (!fields.length && row) fields = defaultDetailFields(graph, row, mark);
    if (!fields.length && mark.value !== undefined) fields = [{ label: 'Value', value: mark.value }];
    return {
      title: title || 'Graph item',
      label: mark.label || title || '',
      fields: fields,
      row: row,
      series: mark.series || '',
      category: mark.category || '',
      nodeLabel: mark.nodeLabel || '',
      linkSource: mark.linkSource || '',
      linkTarget: mark.linkTarget || '',
    };
  }

  function attachInteractiveDetail(el, detail, mark) {
    el.__ugDetail = detail;
    el.setAttribute('data-ug-interactive', 'true');
    el.setAttribute('data-ug-highlight-scope', mark && mark.highlightScope ? mark.highlightScope : (detail.nodeLabel || detail.linkSource || detail.linkTarget ? 'related' : 'self'));
    if (mark && mark.series !== undefined) el.setAttribute('data-ug-series', String(mark.series));
    if (mark && mark.category !== undefined) el.setAttribute('data-ug-category', String(mark.category));
    if (detail.nodeLabel) el.setAttribute('data-ug-node-label', detail.nodeLabel);
    if (detail.linkSource) el.setAttribute('data-ug-link-source', detail.linkSource);
    if (detail.linkTarget) el.setAttribute('data-ug-link-target', detail.linkTarget);
    addSvgTitle(el, detail.label || detail.title);
  }

  function addTooltipMarks(svg, marks, graph) {
    marks.forEach(function (mark) {
      mark.el.setAttribute('tabindex', '0');
      mark.el.setAttribute('role', 'img');
      var detail = mark.detail || (graph ? markDetail(graph, mark) : { title: mark.label, label: mark.label, fields: [] });
      attachInteractiveDetail(mark.el, detail, mark);
    });
  }

  function summarizeCategoryRows(graph, rs, xField, yFields, maxItems) {
    if (showAll(graph) || rs.length <= maxItems) return { rows: rs.slice(), message: '', other: null };
    var scored = rs.map(function (row, index) {
      var total = yFields.reduce(function (sum, field) {
        return sum + Math.abs(asNumber(cell(row, field)) || 0);
      }, 0);
      return { row: row, index: index, total: total };
    }).sort(function (a, b) { return b.total - a.total; });
    var keep = scored.slice(0, maxItems).sort(function (a, b) { return a.index - b.index; });
    var hidden = scored.slice(maxItems);
    var other = {};
    other[xField] = 'Other (' + hidden.length + ')';
    yFields.forEach(function (field) {
      other[field] = hidden.reduce(function (sum, item) {
        return sum + (asNumber(cell(item.row, field)) || 0);
      }, 0);
    });
    var mode = otherBucketMode(graph);
    var otherSummary = {
      label: other[xField],
      hiddenCount: hidden.length,
      totals: yFields.map(function (field) {
        return { field: field, value: other[field] };
      }),
    };
    if (mode === 'hidden' || mode === 'separate') {
      if (mode === 'separate') addGraphWarning(graph, 'Separated ' + other[xField] + ' from the main scale so visible categories remain readable.');
      return {
        rows: keep.map(function (item) { return item.row; }),
        other: mode === 'separate' ? otherSummary : null,
        message: mode === 'separate'
          ? 'Showing top ' + maxItems + ' of ' + rs.length + ' categories; remaining total shown separately.'
          : 'Showing top ' + maxItems + ' of ' + rs.length + ' categories; remaining categories hidden from the chart.',
      };
    }
    return {
      rows: keep.map(function (item) { return item.row; }).concat([other]),
      other: null,
      message: 'Showing top ' + maxItems + ' of ' + rs.length + ' categories; remaining grouped as Other.',
    };
  }

  function addOtherBucketCallout(svg, summary) {
    if (!summary || !summary.other) return;
    var total = summary.other.totals.reduce(function (sum, item) { return sum + Math.abs(item.value || 0); }, 0);
    var label = summary.other.label + ': ' + formatValue(total);
    var x = WIDTH - PLOT.right - 244;
    var y = PLOT.top + 8;
    append(svg, svgEl('rect', { x: x, y: y, width: 236, height: 42, rx: 6, class: 'ug-other-callout-bg' }));
    append(svg, textEl(x + 12, y + 18, shortText(label, 32), 'ug-other-callout-title', { fullText: label }));
    append(svg, textEl(x + 12, y + 34, 'Inspect Data for hidden categories', 'ug-other-callout-meta'));
  }

  function renderCartesian(graph) {
    var svg = createSvg();
    var originalRows = rows(graph);
    var xField = enc(graph, 'x') || enc(graph, 'label');
    var yFields = encList(graph, 'y');
    if (!yFields.length) yFields = [enc(graph, 'value')].filter(Boolean);
    if (!originalRows.length || !xField || !yFields.length) return renderUnsupported(graph, 'No graph data to display');
    var barLike = ['bar', 'stacked_bar', 'grouped_bar'].indexOf(graph.type) >= 0;
    var preferContinuousX = ['line', 'area', 'combo', 'scatter', 'bubble'].indexOf(graph.type) >= 0;
    var requiredXKind = axisRequiredKind(graph, xField, 'x', preferContinuousX);
    originalRows = filterRowsWithValidNumbers(graph, originalRows, yFields, yFields.join(', '));
    if (requiredXKind === 'time') originalRows = filterRowsWithValidTimes(graph, originalRows, [xField], xField);
    if (requiredXKind === 'linear') originalRows = filterRowsWithValidNumbers(graph, originalRows, [xField], xField);
    if (!originalRows.length) return renderUnsupported(graph, 'No valid graph rows to display');
    var maxItems = maxVisibleItems(graph, DEFAULT_MAX_VISIBLE_ITEMS);
    var summary = barLike
      ? summarizeCategoryRows(graph, originalRows, xField, yFields, maxItems)
      : { rows: originalRows.slice(), message: '' };
    var rs = summary.rows;
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
    var x = makeAxisScale(graph, xField, xValues, [PLOT.left, WIDTH - PLOT.right], 'x', preferContinuousX);
    drawAxes(svg, x, yDomain, graph, { xField: xField, yFields: yFields });
    var y = linearScale(yDomain, [HEIGHT - PLOT.bottom, PLOT.top]);
    var baseline = y(0);
    var marks = [];
    if (!summary.message && !barLike && originalRows.length > MAX_MARK_POINTS) {
      summary.message = 'Showing all ' + originalRows.length + ' points with sampled axis labels and markers.';
    }

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
        var markerStep = points.length > MAX_MARK_POINTS ? Math.ceil(points.length / MAX_MARK_POINTS) : 1;
        points.forEach(function (p, pointIndex) {
          if (pointIndex % markerStep !== 0 && pointIndex !== points.length - 1) return;
          var c = append(svg, svgEl('circle', { cx: p.x, cy: p.y, r: graph.type === 'combo' ? 4 : 3.5, fill: color(seriesIndex), class: 'ug-mark' }));
          marks.push({
            el: c,
            row: p.row,
            label: formatValue(cell(p.row, xField)) + ' ' + field + ': ' + formatValue(p.value),
            series: field,
            category: cell(p.row, xField),
            highlightScope: 'series',
            fields: [
              { label: columnLabel(graph, xField), value: cell(p.row, xField) },
              { label: columnLabel(graph, field), value: p.value },
            ],
          });
        });
      } else if (graph.type === 'scatter' || graph.type === 'bubble') {
        var sizeField = enc(graph, 'size');
        if (points.length > DENSE_POINT_PATH_THRESHOLD) {
          append(svg, svgEl('path', {
            d: densePointPath(points, graph, sizeField),
            fill: color(seriesIndex),
            class: 'ug-dense-point-layer',
            'aria-label': 'Dense point layer with ' + points.length + ' points',
          }));
          points.forEach(function (p, pointIndex) {
            if (!shouldShowFocusPoint(pointIndex, points.length)) return;
            var focusRadius = Math.max(4, Math.min(9, pointRadius(graph, p.row, sizeField, points.length)));
            var c = append(svg, svgEl('circle', { cx: p.x, cy: p.y, r: focusRadius, fill: color(seriesIndex), class: 'ug-mark ug-point ug-point-focus' }));
            marks.push({
              el: c,
              row: p.row,
              label: formatValue(cell(p.row, xField)) + ' ' + field + ': ' + formatValue(p.value),
              series: field,
              category: cell(p.row, xField),
              fields: [
                { label: columnLabel(graph, xField), value: cell(p.row, xField) },
                { label: columnLabel(graph, field), value: p.value },
              ],
            });
          });
          summary.message = 'Rendered all ' + points.length + ' points as a dense native layer with sampled focus marks.';
        } else {
          points.forEach(function (p) {
            var radius = pointRadius(graph, p.row, sizeField, points.length);
            var c = append(svg, svgEl('circle', { cx: p.x, cy: p.y, r: radius, fill: color(seriesIndex), class: points.length > 500 ? 'ug-mark ug-point ug-point-dense' : 'ug-mark ug-point' }));
            marks.push({
              el: c,
              row: p.row,
              label: formatValue(cell(p.row, xField)) + ' ' + field + ': ' + formatValue(p.value),
              series: field,
              category: cell(p.row, xField),
              fields: [
                { label: columnLabel(graph, xField), value: cell(p.row, xField) },
                { label: columnLabel(graph, field), value: p.value },
              ],
            });
          });
        }
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
          marks.push({
            el: rect,
            row: row,
            label: xValues[rowIndex] + ' ' + field + ': ' + formatValue(value),
            series: field,
            category: cell(row, xField),
            fields: [
              { label: columnLabel(graph, xField), value: cell(row, xField) },
              { label: columnLabel(graph, field), value: value },
            ],
          });
        });
      }
    });

    addLegend(svg, yFields);
    addOtherBucketCallout(svg, summary);
    addDensityNote(svg, summary.message);
    addTooltipMarks(svg, marks, graph);
    return svg;
  }

  function addLegend(svg, labels) {
    labels.slice(0, 8).forEach(function (label, i) {
      var x = PLOT.left + i * 95;
      var y = 18;
      addSvgTitle(append(svg, svgEl('rect', { x: x, y: y - 9, width: 10, height: 10, fill: color(i), rx: 2 })), label);
      append(svg, textEl(x + 15, y, shortText(label, 13), 'ug-legend-label', { fullText: label }));
    });
    if (labels.length > 8) addDensityNote(svg, 'Legend shows 8 of ' + labels.length + ' series/categories.');
  }

  function renderHistogram(graph) {
    var field = enc(graph, 'value');
    var validRows = filterRowsWithValidNumbers(graph, rows(graph), [field], field);
    var values = validRows.map(function (row) { return asNumber(cell(row, field)); }).filter(function (n) { return n !== null; });
    if (!values.length) return renderUnsupported(graph, 'No valid numeric values to display');
    var min = Math.min.apply(Math, values);
    var max = Math.max.apply(Math, values);
    var zeroVariance = min === max;
    var domain = zeroVariance ? [min, max] : [min, max];
    var bins = zeroVariance ? 1 : optionInteger(graph, 'binCount', Math.min(12, Math.max(4, Math.ceil(Math.sqrt(values.length || 1)))), 1, 40);
    var counts = Array.from({ length: bins }, function (_, i) {
      if (zeroVariance) return { label: formatValue(min), count: 0 };
      var start = domain[0] + ((domain[1] - domain[0]) * i / bins);
      var end = domain[0] + ((domain[1] - domain[0]) * (i + 1) / bins);
      return { label: formatValue(start) + ' - ' + formatValue(end), count: 0 };
    });
    values.forEach(function (value) {
      var idx = zeroVariance ? 0 : Math.min(bins - 1, Math.floor(((value - domain[0]) / ((domain[1] - domain[0]) || 1)) * bins));
      counts[idx].count += 1;
    });
    if (zeroVariance) addGraphWarning(graph, 'All histogram values are identical; rendered one bin for ' + formatValue(min) + '.');
    return renderCartesian({
      type: 'bar',
      axes: graph.axes || { x: { label: columnLabel(graph, field) + ' range' }, y: { label: 'Count' } },
      data: { columns: [{ id: 'bin', name: columnLabel(graph, field) + ' range' }, { id: 'count', name: 'Count', type: 'number' }], rows: counts.map(function (b) { return { bin: b.label, count: b.count }; }) },
      encoding: { x: 'bin', y: 'count' },
      options: { showAll: true },
    });
  }

  function renderBoxplot(graph) {
    var svg = createSvg();
    var field = enc(graph, 'value');
    var validRows = filterRowsWithValidNumbers(graph, rows(graph), [field], field);
    var values = validRows.map(function (row) { return asNumber(cell(row, field)); }).filter(function (n) { return n !== null; }).sort(function (a, b) { return a - b; });
    if (!values.length) return renderUnsupported(graph, 'No valid numeric values to display');
    var domain = extent(values.concat([0]));
    drawAxes(svg, ['Distribution'], domain, graph, { xLabel: 'Distribution', yFields: [field] });
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
    rs = filterRowsWithValidNumbers(graph, rs, [valueField], valueField);
    if (!rs.length) return renderUnsupported(graph, 'No valid heatmap values to display');
    var xs = unique(rs.map(function (row) { return cell(row, xField); }));
    var ys = unique(rs.map(function (row) { return cell(row, yField); }));
    var domain = extent(rs.map(function (row) { return asNumber(cell(row, valueField)); }).concat([0]));
    var plot = heatmapPlot(ys);
    var x = categoryScale(xs, [plot.left, WIDTH - plot.right]);
    var y = categoryScale(ys, [plot.top, HEIGHT - plot.bottom]);
    var marks = [];
    if (rs.length > DENSE_HEATMAP_CELL_THRESHOLD) {
      var buckets = Array.from({ length: DENSE_HEATMAP_BUCKETS }, function () { return []; });
      rs.forEach(function (row) {
        var value = asNumber(cell(row, valueField)) || 0;
        var intensity = (value - domain[0]) / ((domain[1] - domain[0]) || 1);
        var bucket = Math.max(0, Math.min(DENSE_HEATMAP_BUCKETS - 1, Math.floor(intensity * DENSE_HEATMAP_BUCKETS)));
        buckets[bucket].push(rectPath(
          x.pos(cell(row, xField)) - x.band / 2,
          y.pos(cell(row, yField)) - y.band / 2,
          x.band,
          y.band
        ));
      });
      buckets.forEach(function (paths, bucketIndex) {
        if (!paths.length) return;
        append(svg, svgEl('path', {
          d: paths.join(' '),
          class: 'ug-heat-cell-layer',
          style: 'opacity:' + (0.25 + (bucketIndex / Math.max(1, DENSE_HEATMAP_BUCKETS - 1)) * 0.75),
          'aria-label': 'Dense heatmap layer with ' + paths.length + ' cells',
        }));
      });
      rs.forEach(function (row, rowIndex) {
        if (!shouldShowFocusPoint(rowIndex, rs.length)) return;
        var value = asNumber(cell(row, valueField)) || 0;
        var intensity = (value - domain[0]) / ((domain[1] - domain[0]) || 1);
        var rect = append(svg, svgEl('rect', {
          x: x.pos(cell(row, xField)) - x.band / 2,
          y: y.pos(cell(row, yField)) - y.band / 2,
          width: Math.max(1, x.band),
          height: Math.max(1, y.band),
          class: 'ug-mark ug-heat-cell ug-heat-focus',
          style: 'opacity:' + (0.35 + intensity * 0.65),
        }));
        marks.push({
          el: rect,
          row: row,
          label: cell(row, xField) + ' / ' + cell(row, yField) + ': ' + formatValue(value),
          category: cell(row, xField),
          fields: [
            { label: columnLabel(graph, xField), value: cell(row, xField) },
            { label: columnLabel(graph, yField), value: cell(row, yField) },
            { label: columnLabel(graph, valueField), value: value },
          ],
        });
      });
    } else {
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
        marks.push({
          el: rect,
          row: row,
          label: cell(row, xField) + ' / ' + cell(row, yField) + ': ' + formatValue(value),
          category: cell(row, xField),
          fields: [
            { label: columnLabel(graph, xField), value: cell(row, xField) },
            { label: columnLabel(graph, yField), value: cell(row, yField) },
            { label: columnLabel(graph, valueField), value: value },
          ],
        });
      });
    }
    sampleValues(xs, Math.max(2, Math.floor((WIDTH - plot.left - plot.right) / MIN_X_TICK_GAP))).forEach(function (label) {
      append(svg, textEl(x.pos(label), HEIGHT - plot.bottom + 22, shortText(label, 10), 'ug-axis-label', { 'text-anchor': 'middle', fullText: label }));
    });
    var yLabelMax = Math.max(12, Math.min(24, Math.floor((plot.left - 14) / 7)));
    sampleValues(ys, Math.max(2, Math.floor((HEIGHT - plot.top - plot.bottom) / MIN_Y_TICK_GAP))).forEach(function (label) {
      append(svg, textEl(plot.left - 8, y.pos(label) + 4, shortText(label, yLabelMax), 'ug-axis-label', { 'text-anchor': 'end', fullText: label }));
    });
    addAxisTitles(svg, graph, { xField: xField, yFields: [yField], plot: plot });
    if (rs.length > DENSE_HEATMAP_CELL_THRESHOLD) addDensityNote(svg, 'Rendered all ' + rs.length + ' matrix cells as dense native layers with sampled focus cells.');
    else if (rs.length > 300) addDensityNote(svg, 'Showing ' + rs.length + ' matrix cells with sampled axis labels.');
    addTooltipMarks(svg, marks, graph);
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
    rs = filterRowsWithValidNumbers(graph, rs, [valueField], valueField);
    rs = filterPositiveValueRows(graph, rs, valueField, 'slice');
    if (!rs.length) return renderUnsupported(graph, 'No positive values to display');
    var maxSlices = maxVisibleItems(graph, 12);
    var summary = summarizeCategoryRows(graph, rs, labelField, [valueField], maxSlices);
    rs = summary.rows;
    var total = rs.reduce(function (sum, row) { return sum + Math.max(0, asNumber(cell(row, valueField)) || 0); }, 0) || 1;
    var cx = 260, cy = 175, r = 115, inner = donut ? 62 : 0;
    var angle = -Math.PI / 2;
    var marks = [];
    rs.forEach(function (row, i) {
      var value = Math.max(0, asNumber(cell(row, valueField)) || 0);
      var next = angle + (value / total) * Math.PI * 2;
      var path = append(svg, svgEl('path', { d: arcPath(cx, cy, inner, r, angle, next), fill: color(i), class: 'ug-mark' }));
      marks.push({
        el: path,
        row: row,
        label: cell(row, labelField) + ': ' + formatValue(value),
        category: cell(row, labelField),
        fields: [
          { label: columnLabel(graph, labelField), value: cell(row, labelField) },
          { label: columnLabel(graph, valueField), value: value },
        ],
      });
      angle = next;
    });
    addLegend(svg, rs.map(function (row) { return cell(row, labelField); }));
    addOtherBucketCallout(svg, summary);
    if (summary.message) addDensityNote(svg, summary.message.replace('categories', 'slices'));
    else if (rs.length > 12) addDensityNote(svg, 'Showing ' + rs.length + ' slices with sampled legend labels.');
    addTooltipMarks(svg, marks, graph);
    return svg;
  }

  function renderFunnel(graph) {
    var svg = createSvg();
    var rs = filterRowsWithValidNumbers(graph, rows(graph), [enc(graph, 'value')], enc(graph, 'value'));
    var labelField = enc(graph, 'label'), valueField = enc(graph, 'value');
    if (!rs.length) return renderUnsupported(graph, 'No graph data to display');
    var maxStages = maxVisibleItems(graph, DEFAULT_MAX_FUNNEL_STAGES);
    var displayRows = showAll(graph) ? rs : rs.slice(0, maxStages);
    var top = 52, gap = 4, bottom = 24, center = WIDTH / 2;
    var topWidth = Math.min(WIDTH - 180, 560);
    var bottomWidth = Math.max(150, Math.min(240, topWidth * 0.34));
    var stageSpace = HEIGHT - top - bottom - Math.max(0, displayRows.length - 1) * gap;
    var values = displayRows.map(function (row) {
      return Math.max(0, asNumber(cell(row, valueField)) || 0);
    });
    var weights = values.map(function (value) { return Math.sqrt(value); });
    var weightTotal = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
    if (!weightTotal) weights = values.map(function () { return 1; });
    weightTotal = weights.reduce(function (sum, weight) { return sum + weight; }, 0) || 1;
    var minStageHeight = Math.min(24, Math.max(14, (stageSpace / Math.max(1, displayRows.length)) * 0.55));
    if (minStageHeight * displayRows.length >= stageSpace) minStageHeight = stageSpace / Math.max(1, displayRows.length);
    var extraStageSpace = Math.max(0, stageSpace - minStageHeight * displayRows.length);
    var stageHeights = weights.map(function (weight) {
      return minStageHeight + extraStageSpace * (weight / weightTotal);
    });
    var taperHeight = stageSpace + Math.max(0, displayRows.length - 1) * gap;
    function widthAt(yOffset) {
      var ratio = taperHeight ? Math.max(0, Math.min(1, yOffset / taperHeight)) : 0;
      return topWidth - (topWidth - bottomWidth) * ratio;
    }
    var marks = [];
    var yCursor = top;
    displayRows.forEach(function (row, i) {
      var value = asNumber(cell(row, valueField)) || 0;
      var h = stageHeights[i];
      var y = yCursor;
      var width = widthAt(y - top);
      var nextWidth = widthAt(y + h - top);
      var polygon = append(svg, svgEl('polygon', {
        points: [
          center - width / 2, y,
          center + width / 2, y,
          center + nextWidth / 2, y + h,
          center - nextWidth / 2, y + h,
        ].join(' '),
        fill: color(i),
        class: 'ug-mark ug-funnel',
      }));
      marks.push({
        el: polygon,
        row: row,
        label: cell(row, labelField) + ' - ' + formatValue(value),
        fields: [
          { label: columnLabel(graph, labelField), value: cell(row, labelField) },
          { label: columnLabel(graph, valueField), value: value },
        ],
      });
      append(svg, textEl(center, y + h / 2 + 5, shortText(cell(row, labelField), 24) + ' - ' + formatValue(value), 'ug-invert-label', {
        'text-anchor': 'middle',
        fullText: cell(row, labelField) + ' - ' + formatValue(value),
      }));
      yCursor = y + h + gap;
    });
    if (displayRows.length < rs.length) addDensityNote(svg, 'Showing ' + displayRows.length + ' of ' + rs.length + ' funnel stages.');
    addTooltipMarks(svg, marks, graph);
    return svg;
  }

  function renderGauge(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var valueField = enc(graph, 'value');
    var minField = enc(graph, 'min');
    var maxField = enc(graph, 'max');
    var value = asNumber(cell(rs[0] || {}, valueField));
    if (value === null) return renderUnsupported(graph, 'No valid gauge value to display');
    var min = minField ? asNumber(cell(rs[0] || {}, minField)) : asNumber(graph.min);
    var max = maxField ? asNumber(cell(rs[0] || {}, maxField)) : asNumber(graph.max);
    if (min === null) min = 0;
    if (max === null) max = 100;
    if (max <= min) {
      addGraphWarning(graph, 'Gauge max must be greater than min; using default 0 to 100 range.');
      min = 0;
      max = 100;
    }
    var pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
    var cx = WIDTH / 2, cy = 235, r = 140;
    append(svg, svgEl('path', { d: arcPath(cx, cy, r - 22, r, Math.PI, Math.PI * 2), class: 'ug-gauge-bg' }));
    var stateClass = value > max ? ' ug-over-limit' : (value < min ? ' ug-under-limit' : '');
    append(svg, svgEl('path', { d: arcPath(cx, cy, r - 22, r, Math.PI, Math.PI + pct * Math.PI), fill: color(0), class: 'ug-mark' + stateClass }));
    var a = Math.PI + pct * Math.PI;
    append(svg, svgEl('line', { x1: cx, y1: cy, x2: cx + Math.cos(a) * (r - 34), y2: cy + Math.sin(a) * (r - 34), class: 'ug-strong-line' }));
    append(svg, textEl(PLOT.left + 10, cy + 22, formatValue(min), 'ug-axis-label', { 'text-anchor': 'middle' }));
    append(svg, textEl(WIDTH - PLOT.right - 10, cy + 22, formatValue(max), 'ug-axis-label', { 'text-anchor': 'middle' }));
    var display = value > max ? formatValue(value) + ' / ' + formatValue(max) : (value < min ? formatValue(value) + ' / ' + formatValue(min) : formatValue(value));
    append(svg, textEl(cx, cy - 20, display, value > max ? 'ug-big-number ug-over-limit' : (value < min ? 'ug-big-number ug-under-limit' : 'ug-big-number'), { 'text-anchor': 'middle' }));
    if (value > max) addDensityNote(svg, 'Value exceeds max; gauge arc is capped at 100%.');
    if (value < min) addDensityNote(svg, 'Value is below min; gauge arc is capped at 0%.');
    return svg;
  }

  function renderRadar(graph) {
    var svg = createSvg();
    var rs = filterRowsWithValidNumbers(graph, rows(graph), [enc(graph, 'value')], enc(graph, 'value'));
    var labelField = enc(graph, 'label'), valueField = enc(graph, 'value');
    if (!rs.length) return renderUnsupported(graph, 'No valid radar values to display');
    var max = Math.max.apply(Math, rs.map(function (row) { return asNumber(cell(row, valueField)) || 0; }).concat([1]));
    var cx = WIDTH / 2, cy = HEIGHT / 2 + 10, r = 122;
    var points = [];
    rs.forEach(function (row, i) {
      var a = -Math.PI / 2 + (i / rs.length) * Math.PI * 2;
      var value = asNumber(cell(row, valueField)) || 0;
      var rr = (value / max) * r;
      append(svg, svgEl('line', { x1: cx, y1: cy, x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r, class: 'ug-grid-line' }));
      append(svg, textEl(cx + Math.cos(a) * (r + 20), cy + Math.sin(a) * (r + 20), shortText(cell(row, labelField), 12), 'ug-axis-label', { 'text-anchor': 'middle', fullText: cell(row, labelField) }));
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
    var requiredTime = axisRequiredKind(graph, xField, 'x', true) === 'time';
    rs = filterRowsWithValidNumbers(graph, rs, [openField, highField, lowField, closeField], 'open, high, low, close');
    if (requiredTime) rs = filterRowsWithValidTimes(graph, rs, [xField], xField);
    rs = aggregateCandlesticks(graph, rs, xField, openField, highField, lowField, closeField);
    if (!rs.length) return renderUnsupported(graph, 'No valid candle rows to display');
    var labels = unique(rs.map(function (row) { return cell(row, xField); }));
    var domain = extent(rs.flatMap(function (row) { return [cell(row, highField), cell(row, lowField)].map(asNumber); }).filter(function (n) { return n !== null; }));
    var x = makeAxisScale(graph, xField, labels, [PLOT.left, WIDTH - PLOT.right], 'x', true);
    drawAxes(svg, x, domain, graph, { xField: xField, yLabel: [openField, highField, lowField, closeField].map(function (field) { return columnLabel(graph, field); }).join(' / ') });
    var y = linearScale(domain, [HEIGHT - PLOT.bottom, PLOT.top]);
    var candleWidth = Math.max(2, Math.min(12, x.band || ((WIDTH - PLOT.left - PLOT.right) / Math.max(1, rs.length) * 0.6)));
    rs.forEach(function (row) {
      var xp = x.pos(cell(row, xField));
      var open = asNumber(cell(row, openField)) || 0;
      var high = asNumber(cell(row, highField)) || open;
      var low = asNumber(cell(row, lowField)) || open;
      var close = asNumber(cell(row, closeField)) || open;
      var up = close >= open;
      append(svg, svgEl('line', { x1: xp, x2: xp, y1: y(low), y2: y(high), class: 'ug-line' }));
      addSvgTitle(append(svg, svgEl('rect', { x: xp - candleWidth / 2, y: Math.min(y(open), y(close)), width: candleWidth, height: Math.max(2, Math.abs(y(open) - y(close))), class: up ? 'ug-candle-up' : 'ug-candle-down' })), cell(row, xField) + ' open ' + formatValue(open) + ', close ' + formatValue(close));
    });
    if (rs.length > MAX_MARK_POINTS) addDensityNote(svg, 'Showing all ' + rs.length + ' candles with sampled axis labels.');
    return svg;
  }

  function aggregateCandlesticks(graph, rs, xField, openField, highField, lowField, closeField) {
    var map = {};
    var out = [];
    var duplicates = 0;
    rs.forEach(function (row) {
      var key = String(cell(row, xField));
      if (!map[key]) {
        var next = Object.assign({}, row);
        next[openField] = asNumber(cell(row, openField));
        next[highField] = asNumber(cell(row, highField));
        next[lowField] = asNumber(cell(row, lowField));
        next[closeField] = asNumber(cell(row, closeField));
        next.__ugCount = 1;
        map[key] = next;
        out.push(next);
        return;
      }
      duplicates += 1;
      map[key][highField] = Math.max(map[key][highField], asNumber(cell(row, highField)));
      map[key][lowField] = Math.min(map[key][lowField], asNumber(cell(row, lowField)));
      map[key][closeField] = asNumber(cell(row, closeField));
      map[key].__ugCount += 1;
    });
    if (duplicates) addGraphWarning(graph, 'Aggregated ' + duplicates + ' duplicate candlestick row' + (duplicates === 1 ? '' : 's') + ' by x value.');
    return out;
  }

  function renderTimeline(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var labelField = enc(graph, 'label'), startField = enc(graph, 'start'), endField = enc(graph, 'end');
    rs = filterRowsWithValidTimes(graph, rs, [startField, endField], 'start/end');
    rs = normalizeTimelineRows(graph, rs, startField, endField);
    if (!rs.length) return renderUnsupported(graph, 'No valid timeline rows to display');
    var times = [];
    rs.forEach(function (row) {
      var s = asTime(cell(row, startField));
      var e = asTime(cell(row, endField));
      if (s !== null) times.push(s);
      if (e !== null) times.push(e);
    });
    var domain = extent(times);
    var x = linearScale(domain, [PLOT.left + 90, WIDTH - PLOT.right]);
    var maxRows = maxVisibleItems(graph, DEFAULT_MAX_TIMELINE_ROWS);
    var displayRows = showAll(graph) ? rs : rs.slice(0, maxRows);
    displayRows.forEach(function (row, i) {
      var y = PLOT.top + i * 24 + 12;
      var s = asTime(cell(row, startField)) || domain[0];
      var e = asTime(cell(row, endField)) || s;
      append(svg, textEl(PLOT.left + 78, y + 4, shortText(cell(row, labelField), 16), 'ug-axis-label', { 'text-anchor': 'end', fullText: cell(row, labelField) }));
      addSvgTitle(append(svg, svgEl('rect', { x: x(s), y: y - 8, width: Math.max(4, x(e) - x(s)), height: 16, rx: 4, fill: color(i), class: 'ug-mark' })), cell(row, labelField) + ': ' + formatTick(s, 'time') + ' to ' + formatTick(e, 'time'));
    });
    append(svg, svgEl('line', { x1: PLOT.left + 90, y1: HEIGHT - PLOT.bottom, x2: WIDTH - PLOT.right, y2: HEIGHT - PLOT.bottom, class: 'ug-axis' }));
    if (displayRows.length < rs.length) addDensityNote(svg, 'Showing ' + displayRows.length + ' of ' + rs.length + ' timeline rows.');
    return svg;
  }

  function normalizeTimelineRows(graph, rs, startField, endField) {
    var swapped = 0;
    var out = rs.map(function (row) {
      var start = asTime(cell(row, startField));
      var end = asTime(cell(row, endField));
      if (start !== null && end !== null && end < start) {
        swapped += 1;
        var next = Object.assign({}, row);
        next[startField] = cell(row, endField);
        next[endField] = cell(row, startField);
        return next;
      }
      return row;
    });
    if (swapped) addGraphWarning(graph, 'Normalized ' + swapped + ' timeline row' + (swapped === 1 ? '' : 's') + ' where end was before start.');
    return out;
  }

  function hierarchyRows(graph) {
    var rs = rows(graph);
    var labelField = enc(graph, 'label');
    var parentField = enc(graph, 'parent');
    var valueField = enc(graph, 'value');
    rs = filterRowsWithValidText(graph, rs, [labelField], labelField);
    var nodes = {};
    rs.forEach(function (row) {
      var id = textValue(cell(row, labelField));
      nodes[id] = nodes[id] || { id: id, label: id, value: asNumber(cell(row, valueField)) || 1, children: [] };
    });
    var parentById = {};
    var cycleLinks = 0;
    rs.forEach(function (row) {
      var id = textValue(cell(row, labelField));
      var parent = parentField ? textValue(cell(row, parentField)) : null;
      if (!id || !parent || !nodes[parent]) return;
      if (parent === id) {
        cycleLinks += 1;
        return;
      }
      parentById[id] = parent;
    });
    cycleLinks += breakHierarchyCycles(parentById);
    Object.keys(parentById).forEach(function (id) {
      var parent = parentById[id];
      if (nodes[parent] && nodes[id]) nodes[parent].children.push(nodes[id]);
    });
    var roots = Object.keys(nodes).filter(function (id) { return !parentById[id]; }).map(function (id) { return nodes[id]; });
    if (cycleLinks) addGraphWarning(graph, 'Ignored ' + cycleLinks + ' hierarchy parent link' + (cycleLinks === 1 ? '' : 's') + ' that would create a cycle.');
    if (!roots.length && Object.keys(nodes).length) roots = Object.keys(nodes).map(function (id) { return nodes[id]; });
    if (!roots.length) addGraphWarning(graph, 'No valid hierarchy nodes to display.');
    return roots;
  }

  function breakHierarchyCycles(parentById) {
    var removed = 0;
    var state = {};
    Object.keys(parentById).forEach(function (start) {
      if (state[start]) return;
      var path = [];
      var indexById = {};
      var current = start;
      while (current && parentById[current]) {
        if (indexById[current] !== undefined) {
          delete parentById[current];
          removed += 1;
          break;
        }
        if (state[current] === 2) break;
        indexById[current] = path.length;
        path.push(current);
        current = parentById[current];
      }
      path.forEach(function (id) { state[id] = 2; });
    });
    return removed;
  }

  function flattenHierarchy(roots) {
    var out = [];
    var seen = {};
    var stack = [];
    roots.slice().reverse().forEach(function (root) {
      stack.push({ node: root, depth: 0, parent: null });
    });
    while (stack.length) {
      var entry = stack.pop();
      if (!entry.node || seen[entry.node.id]) continue;
      seen[entry.node.id] = true;
      out.push(entry);
      (entry.node.children || []).slice().reverse().forEach(function (child) {
        stack.push({ node: child, depth: entry.depth + 1, parent: entry.node });
      });
    }
    return out;
  }

  function renderTree(graph) {
    var svg = createSvg();
    var roots = hierarchyRows(graph);
    var flattened = flattenHierarchy(roots);
    if (!flattened.length) return renderUnsupported(graph, 'No valid hierarchy nodes to display');
    var maxNodes = maxVisibleItems(graph, 40);
    var visible = showAll(graph) ? flattened : limitHierarchyEntries(flattened, maxNodes);
    var visibleIds = {};
    visible.forEach(function (entry) { visibleIds[entry.node.id] = true; });
    var visibleChildrenById = {};
    visible.forEach(function (entry) {
      visibleChildrenById[entry.node.id] = (entry.node.children || []).filter(function (child) { return visibleIds[child.id]; });
    });
    var positions = {};
    var maxDepth = visible.reduce(function (max, entry) { return Math.max(max, entry.depth); }, 0);
    var nextLeaf = 0;
    var leafYs = {};
    visible.slice().reverse().forEach(function (entry) {
      var children = visibleChildrenById[entry.node.id] || [];
      var childYs = children.map(function (child) { return leafYs[child.id]; }).filter(function (value) { return value !== undefined; });
      var yIndex = childYs.length
        ? childYs.reduce(function (sum, value) { return sum + value; }, 0) / childYs.length
        : nextLeaf++;
      leafYs[entry.node.id] = yIndex;
      positions[entry.node.id] = {
        x: PLOT.left + entry.depth * ((WIDTH - PLOT.left - PLOT.right) / Math.max(1, maxDepth)),
        y: 0,
      };
    });
    var leafCount = Math.max(1, nextLeaf);
    Object.keys(positions).forEach(function (id) {
      positions[id].y = PLOT.top + (leafYs[id] + 1) * ((HEIGHT - PLOT.top - PLOT.bottom) / (leafCount + 1));
    });
    Object.keys(positions).forEach(function (id) {
      (visibleChildrenById[id] || []).forEach(function (child) {
        if (!visibleIds[child.id]) return;
        append(svg, svgEl('line', { x1: positions[id].x, y1: positions[id].y, x2: positions[child.id].x, y2: positions[child.id].y, class: 'ug-link' }));
      });
    });
    var shownLabels = {};
    var culledLabels = 0;
    var marks = [];
    Object.keys(positions).forEach(function (id, i) {
      var nodeEl = append(svg, svgEl('circle', { cx: positions[id].x, cy: positions[id].y, r: 12, fill: color(i), class: 'ug-node' }));
      marks.push({
        el: nodeEl,
        label: id,
        nodeLabel: id,
        fields: [
          { label: 'Node', value: id },
          { label: 'Visible children', value: (visibleChildrenById[id] || []).length },
        ],
      });
      var nearRight = positions[id].x > WIDTH - 180;
      var labelColumn = Math.round(positions[id].x / 80);
      if (!shownLabels[labelColumn] || Math.abs(positions[id].y - shownLabels[labelColumn]) >= 17) {
        shownLabels[labelColumn] = positions[id].y;
        append(svg, textEl(positions[id].x + (nearRight ? -16 : 16), positions[id].y + 4, shortText(id, 18), 'ug-node-label', {
          'text-anchor': nearRight ? 'end' : 'start',
          fullText: id,
        }));
      } else {
        culledLabels += 1;
      }
    });
    if (visible.length < flattened.length) addDensityNote(svg, 'Showing ' + visible.length + ' of ' + flattened.length + ' tree nodes.');
    if (culledLabels) addGraphWarning(graph, 'Culled ' + culledLabels + ' tree labels to avoid overlap.');
    addTooltipMarks(svg, marks, graph);
    return svg;
  }

  function limitHierarchyEntries(flattened, maxNodes) {
    var visible = [];
    var seen = {};
    var entryById = {};
    flattened.forEach(function (entry) { entryById[entry.node.id] = entry; });
    function include(entry) {
      if (!entry || seen[entry.node.id]) return;
      var lineage = [];
      var current = entry;
      while (current && !seen[current.node.id]) {
        lineage.push(current);
        current = current.parent ? entryById[current.parent.id] : null;
      }
      while (lineage.length && visible.length < maxNodes) {
        var next = lineage.pop();
        if (seen[next.node.id]) continue;
        visible.push(next);
        seen[next.node.id] = true;
      }
    }
    flattened.forEach(function (entry) {
      if (visible.length >= maxNodes) return;
      include(entry);
    });
    return visible;
  }

  function renderNetwork(graph, sankey) {
    var svg = createSvg();
    var sourceField = enc(graph, 'source'), targetField = enc(graph, 'target'), valueField = enc(graph, 'value');
    var rs = filterRowsWithValidText(graph, rows(graph), [sourceField, targetField], 'source/target');
    if (sankey && valueField) rs = filterRowsWithValidNumbers(graph, rs, [valueField], valueField);
    rs = aggregateLinks(graph, rs, sourceField, targetField, valueField);
    if (!rs.length) return renderUnsupported(graph, 'No valid network links to display');
    if (sankey && hasCyclicLinks(rs, sourceField, targetField)) {
      addGraphWarning(graph, 'Sankey requires acyclic flow; rendered a network fallback for cyclic or self-link data.');
      return renderNetwork(Object.assign({}, graph, { type: 'network' }), false);
    }
    var maxLinks = maxVisibleItems(graph, sankey ? DEFAULT_MAX_LINKS : DEFAULT_MAX_LINKS);
    var originalLinkCount = rs.length;
    if (!showAll(graph) && rs.length > maxLinks) {
      rs = rs.slice().sort(function (a, b) {
        return (asNumber(cell(b, valueField)) || 1) - (asNumber(cell(a, valueField)) || 1);
      }).slice(0, maxLinks);
    }
    var sourceLabels = unique(rs.map(function (row) { return cell(row, sourceField); }));
    var targetLabels = unique(rs.map(function (row) { return cell(row, targetField); }));
    var labels = unique(rs.flatMap(function (row) { return [cell(row, sourceField), cell(row, targetField)]; }));
    var pos = {};
    if (sankey) {
      pos = layoutSankeyNodes(rs, labels, sourceField, targetField);
    } else {
      if (labels.length > DENSE_NETWORK_LAYOUT_THRESHOLD) {
        addGraphWarning(graph, 'Used a simplified dense network layout for ' + labels.length + ' nodes.');
      }
      pos = layoutNetworkNodes(labels, rs, sourceField, targetField);
    }
    var denseLinks = rs.length > DENSE_LINK_PATH_THRESHOLD;
    var denseLinkMessage = '';
    var marks = [];
    if (denseLinks) {
      var linkBuckets = {};
      rs.forEach(function (row) {
        var s = pos[cell(row, sourceField)], t = pos[cell(row, targetField)];
        if (!s || !t) return;
        var width = sankey ? Math.max(2, Math.sqrt(asNumber(cell(row, valueField)) || 1)) : 1.5;
        var key = sankey ? String(roundCoord(width)) : 'default';
        linkBuckets[key] = linkBuckets[key] || [];
        linkBuckets[key].push(linkPathBetween(s, t, sankey));
      });
      Object.keys(linkBuckets).forEach(function (key) {
        append(svg, svgEl('path', {
          d: linkBuckets[key].join(' '),
          fill: 'none',
          'stroke-width': key === 'default' ? 1.5 : key,
          class: sankey ? 'ug-sankey-link ug-link-layer' : 'ug-link ug-link-layer',
          'aria-label': 'Dense link layer with ' + linkBuckets[key].length + ' links',
        }));
      });
      rs.forEach(function (row, rowIndex) {
        if (!shouldShowFocusPoint(rowIndex, rs.length)) return;
        var s = pos[cell(row, sourceField)], t = pos[cell(row, targetField)];
        if (!s || !t) return;
        var width = sankey ? Math.max(2, Math.sqrt(asNumber(cell(row, valueField)) || 1)) : 1.5;
        var link = append(svg, svgEl('path', {
          d: linkPathBetween(s, t, sankey),
          fill: 'none',
          'stroke-width': width,
          class: sankey ? 'ug-mark ug-sankey-link ug-link-focus' : 'ug-mark ug-link ug-link-focus',
        }));
        marks.push({
          el: link,
          row: row,
          label: cell(row, sourceField) + ' to ' + cell(row, targetField) + (valueField ? ': ' + formatValue(cell(row, valueField)) : ''),
          linkSource: String(cell(row, sourceField)),
          linkTarget: String(cell(row, targetField)),
          fields: [
            { label: columnLabel(graph, sourceField), value: cell(row, sourceField) },
            { label: columnLabel(graph, targetField), value: cell(row, targetField) },
          ].concat(valueField ? [{ label: columnLabel(graph, valueField), value: cell(row, valueField) }] : []),
        });
      });
      denseLinkMessage = 'Rendered all ' + rs.length + ' links as dense native layers with sampled focus links.';
    } else {
      rs.forEach(function (row) {
        var s = pos[cell(row, sourceField)], t = pos[cell(row, targetField)];
        if (!s || !t) return;
        var width = sankey ? Math.max(2, Math.sqrt(asNumber(cell(row, valueField)) || 1)) : 1.5;
        var link = append(svg, svgEl('path', {
          d: linkPathBetween(s, t, sankey),
          fill: 'none',
          'stroke-width': width,
          class: sankey ? 'ug-mark ug-sankey-link' : 'ug-mark ug-link',
        }));
        marks.push({
          el: link,
          row: row,
          label: cell(row, sourceField) + ' to ' + cell(row, targetField) + (valueField ? ': ' + formatValue(cell(row, valueField)) : ''),
          linkSource: String(cell(row, sourceField)),
          linkTarget: String(cell(row, targetField)),
          fields: [
            { label: columnLabel(graph, sourceField), value: cell(row, sourceField) },
            { label: columnLabel(graph, targetField), value: cell(row, targetField) },
          ].concat(valueField ? [{ label: columnLabel(graph, valueField), value: cell(row, valueField) }] : []),
        });
      });
    }
    var labelStep = labels.length > 24 ? Math.ceil(labels.length / 24) : 1;
    var laneGap = sankey ? Math.max(7, (HEIGHT - PLOT.top - PLOT.bottom) / Math.max(sourceLabels.length, targetLabels.length, 1)) : 26;
    var nodeRadius = sankey ? Math.max(4, Math.min(9, laneGap * 0.35)) : 13;
    var denseNodes = labels.length > DENSE_NODE_PATH_THRESHOLD;
    if (denseNodes) {
      var nodeBuckets = {};
      labels.forEach(function (label, i) {
        var key = color(i);
        nodeBuckets[key] = nodeBuckets[key] || [];
        nodeBuckets[key].push(pointCirclePath(pos[label].x, pos[label].y, nodeRadius));
      });
      Object.keys(nodeBuckets).forEach(function (key) {
        append(svg, svgEl('path', {
          d: nodeBuckets[key].join(' '),
          fill: key,
          class: 'ug-node-layer',
          'aria-label': 'Dense node layer with ' + nodeBuckets[key].length + ' nodes',
        }));
      });
    }
    var labelSlots = {};
    var culled = 0;
    labels.forEach(function (label, i) {
      var nodeEl = null;
      if (denseNodes) {
        if (shouldShowFocusPoint(i, labels.length)) {
          nodeEl = append(svg, svgEl('circle', { cx: pos[label].x, cy: pos[label].y, r: nodeRadius, fill: color(i), class: 'ug-node ug-node-focus' }));
        }
      } else {
        nodeEl = append(svg, svgEl('circle', { cx: pos[label].x, cy: pos[label].y, r: nodeRadius, fill: color(i), class: 'ug-node' }));
      }
      if (nodeEl) {
        marks.push({
          el: nodeEl,
          label: String(label),
          nodeLabel: String(label),
          fields: [
            { label: 'Node', value: label },
            { label: 'Connected links', value: rs.filter(function (row) {
              return String(cell(row, sourceField)) === String(label) || String(cell(row, targetField)) === String(label);
            }).length },
          ],
        });
      }
      var labelColumn = Math.round(pos[label].x / 90);
      var canShow = i % labelStep === 0 && (!labelSlots[labelColumn] || Math.abs(pos[label].y - labelSlots[labelColumn]) >= 16);
      if (canShow) {
        labelSlots[labelColumn] = pos[label].y;
        append(svg, textEl(pos[label].x + 14, pos[label].y + 4, shortText(label, 16), 'ug-node-label', { fullText: label }));
      } else if (i % labelStep === 0) {
        culled += 1;
      }
    });
    if (denseNodes) addGraphWarning(graph, 'Rendered ' + labels.length + ' nodes as dense native layers with sampled focus nodes.');
    if (rs.length < originalLinkCount) addDensityNote(svg, 'Showing ' + rs.length + ' of ' + originalLinkCount + ' aggregated links.');
    else if (denseLinkMessage) addDensityNote(svg, denseLinkMessage);
    else if (labels.length > 24) addDensityNote(svg, 'Showing all links with sampled node labels.');
    if (culled) addGraphWarning(graph, 'Culled ' + culled + ' node labels to avoid overlap.');
    addTooltipMarks(svg, marks, graph);
    return svg;
  }

  function hasCyclicLinks(rs, sourceField, targetField) {
    var graph = {};
    rs.forEach(function (row) {
      var source = String(cell(row, sourceField));
      var target = String(cell(row, targetField));
      graph[source] = graph[source] || [];
      graph[source].push(target);
    });
    var visiting = {}, visited = {};
    function visit(node) {
      if (visiting[node]) return true;
      if (visited[node]) return false;
      visiting[node] = true;
      var targets = graph[node] || [];
      for (var i = 0; i < targets.length; i += 1) {
        if (targets[i] === node || visit(targets[i])) return true;
      }
      visiting[node] = false;
      visited[node] = true;
      return false;
    }
    return Object.keys(graph).some(visit);
  }

  function layoutSankeyNodes(rs, labels, sourceField, targetField) {
    var incoming = {}, outgoing = {};
    labels.forEach(function (label) { incoming[label] = []; outgoing[label] = []; });
    rs.forEach(function (row) {
      var source = cell(row, sourceField), target = cell(row, targetField);
      outgoing[source] = outgoing[source] || [];
      incoming[target] = incoming[target] || [];
      outgoing[source].push(target);
      incoming[target].push(source);
    });
    var depth = {};
    labels.forEach(function (label) { if (!incoming[label] || !incoming[label].length) depth[label] = 0; });
    var changed = true;
    while (changed) {
      changed = false;
      rs.forEach(function (row) {
        var source = cell(row, sourceField), target = cell(row, targetField);
        var nextDepth = (depth[source] || 0) + 1;
        if (depth[target] === undefined || nextDepth > depth[target]) {
          depth[target] = nextDepth;
          changed = true;
        }
      });
    }
    var maxDepth = Math.max.apply(Math, labels.map(function (label) { return depth[label] || 0; }).concat([1]));
    var levels = [];
    labels.forEach(function (label) {
      var d = depth[label] || 0;
      levels[d] = levels[d] || [];
      levels[d].push(label);
    });
    var pos = {};
    levels.forEach(function (level, d) {
      level.forEach(function (label, i) {
        pos[label] = {
          x: PLOT.left + 72 + d * ((WIDTH - PLOT.left - PLOT.right - 184) / Math.max(1, maxDepth)),
          y: PLOT.top + (i + 1) * ((HEIGHT - PLOT.top - PLOT.bottom) / (level.length + 1)),
        };
      });
    });
    return pos;
  }

  function layoutNetworkNodes(labels, rs, sourceField, targetField) {
    if (labels.length > DENSE_NETWORK_LAYOUT_THRESHOLD) return layoutDenseNetworkNodes(labels);
    var pos = {};
    labels.forEach(function (label, i) {
      var a = -Math.PI / 2 + (i / labels.length) * Math.PI * 2;
      pos[label] = { x: WIDTH / 2 + Math.cos(a) * 230, y: HEIGHT / 2 + Math.sin(a) * 125 };
    });
    for (var iter = 0; iter < 80; iter += 1) {
      labels.forEach(function (aLabel, i) {
        labels.slice(i + 1).forEach(function (bLabel) {
          var a = pos[aLabel], b = pos[bLabel];
          var dx = a.x - b.x, dy = a.y - b.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var force = Math.min(2.5, 180 / (dist * dist));
          a.x += (dx / dist) * force;
          a.y += (dy / dist) * force;
          b.x -= (dx / dist) * force;
          b.y -= (dy / dist) * force;
        });
      });
      rs.forEach(function (row) {
        var s = pos[cell(row, sourceField)], t = pos[cell(row, targetField)];
        if (!s || !t) return;
        var dx = t.x - s.x, dy = t.y - s.y;
        s.x += dx * 0.006;
        s.y += dy * 0.006;
        t.x -= dx * 0.006;
        t.y -= dy * 0.006;
      });
      labels.forEach(function (label) {
        pos[label].x = Math.max(PLOT.left + 24, Math.min(WIDTH - PLOT.right - 24, pos[label].x));
        pos[label].y = Math.max(PLOT.top + 24, Math.min(HEIGHT - PLOT.bottom - 24, pos[label].y));
      });
    }
    return pos;
  }

  function layoutDenseNetworkNodes(labels) {
    var pos = {};
    var golden = Math.PI * (3 - Math.sqrt(5));
    labels.forEach(function (label, i) {
      var radius = Math.sqrt((i + 0.5) / Math.max(1, labels.length));
      var angle = i * golden;
      pos[label] = {
        x: WIDTH / 2 + Math.cos(angle) * radius * 330,
        y: HEIGHT / 2 + Math.sin(angle) * radius * 140,
      };
    });
    return pos;
  }

  function aggregateLinks(graph, rs, sourceField, targetField, valueField) {
    var map = {};
    var duplicates = 0;
    rs.forEach(function (row) {
      var source = String(cell(row, sourceField));
      var target = String(cell(row, targetField));
      var key = source + '\u0000' + target;
      if (!map[key]) {
        map[key] = Object.assign({}, row);
        if (valueField) map[key][valueField] = 0;
      } else {
        duplicates += 1;
      }
      if (valueField) map[key][valueField] += asNumber(cell(row, valueField)) || 0;
    });
    if (duplicates) addGraphWarning(graph, 'Aggregated ' + duplicates + ' duplicate link' + (duplicates === 1 ? '' : 's') + ' before rendering.');
    return Object.keys(map).map(function (key) { return map[key]; });
  }

  function renderTreemap(graph) {
    var svg = createSvg();
    var rs = rows(graph);
    var labelField = enc(graph, 'label'), valueField = enc(graph, 'value');
    rs = filterRowsWithValidText(graph, rs, [labelField], labelField);
    rs = filterRowsWithValidNumbers(graph, rs, [valueField], valueField);
    var maxItems = maxVisibleItems(graph, DEFAULT_MAX_VISIBLE_ITEMS);
    var originalCount = rs.length;
    if (!showAll(graph) && rs.length > maxItems) {
      rs = rs.slice().sort(function (a, b) {
        return (asNumber(cell(b, valueField)) || 0) - (asNumber(cell(a, valueField)) || 0);
      }).slice(0, maxItems);
    }
    var items = rs.map(function (row, i) {
      return { row: row, index: i, value: Math.max(0, asNumber(cell(row, valueField)) || 0) };
    }).filter(function (item) { return item.value > 0; });
    if (items.length < rs.length) addGraphWarning(graph, 'Ignored ' + (rs.length - items.length) + ' non-positive treemap item' + (rs.length - items.length === 1 ? '' : 's') + '.');
    if (!items.length) return renderUnsupported(graph, 'No positive treemap values to display');
    var rects = treemapLayout(items, PLOT.left, PLOT.top, WIDTH - PLOT.left - PLOT.right, HEIGHT - PLOT.top - PLOT.bottom);
    var marks = [];
    rects.forEach(function (rect) {
      var label = cell(rect.item.row, labelField);
      var cellEl = append(svg, svgEl('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, fill: color(rect.item.index), class: 'ug-mark ug-treemap-cell' }));
      marks.push({
        el: cellEl,
        row: rect.item.row,
        label: label + ': ' + formatValue(rect.item.value),
        category: label,
        fields: [
          { label: columnLabel(graph, labelField), value: label },
          { label: columnLabel(graph, valueField), value: rect.item.value },
        ],
      });
      if (rect.w > 42 && rect.h > 24) {
        append(svg, textEl(rect.x + 8, rect.y + 22, shortText(label, Math.max(6, Math.floor(rect.w / 8))), 'ug-invert-label', { fullText: label }));
      }
    });
    if (rs.length < originalCount) addDensityNote(svg, 'Showing top ' + rs.length + ' of ' + originalCount + ' treemap items.');
    addTooltipMarks(svg, marks, graph);
    return svg;
  }

  function treemapLayout(items, x, y, w, h) {
    if (!items.length) return [];
    items = items.slice().sort(function (a, b) { return b.value - a.value; });
    var total = items.reduce(function (sum, item) { return sum + item.value; }, 0) || 1;
    var areaScale = (w * h) / total;
    var scaled = items.map(function (item) {
      return Object.assign({}, item, { area: item.value * areaScale });
    });
    var rects = [];
    var row = [];
    var rowArea = 0;
    var rx = x, ry = y, rw = w, rh = h;

    function worstRatio(nextRow, side) {
      if (!nextRow.length) return Infinity;
      var areas = nextRow.map(function (item) { return item.area; });
      var sum = areas.reduce(function (a, b) { return a + b; }, 0);
      var min = Math.min.apply(Math, areas);
      var max = Math.max.apply(Math, areas);
      side = Math.max(1, side);
      return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
    }

    function layoutRow() {
      if (!row.length) return;
      var horizontal = rw < rh;
      if (horizontal) {
        var rowH = rowArea / Math.max(1, rw);
        var cx = rx;
        row.forEach(function (item) {
          var cellW = item.area / Math.max(1, rowH);
          rects.push({ item: item, x: cx, y: ry, w: cellW, h: rowH });
          cx += cellW;
        });
        ry += rowH;
        rh -= rowH;
      } else {
        var rowW = rowArea / Math.max(1, rh);
        var cy = ry;
        row.forEach(function (item) {
          var cellH = item.area / Math.max(1, rowW);
          rects.push({ item: item, x: rx, y: cy, w: rowW, h: cellH });
          cy += cellH;
        });
        rx += rowW;
        rw -= rowW;
      }
      row = [];
      rowArea = 0;
    }

    scaled.forEach(function (item) {
      var side = Math.min(rw, rh);
      if (row.length && worstRatio(row.concat([item]), side) > worstRatio(row, side)) layoutRow();
      row.push(item);
      rowArea += item.area;
    });
    layoutRow();
    return rects;
  }

  function hasHierarchyParent(graph) {
    var parentField = enc(graph, 'parent');
    return !!parentField && rows(graph).some(function (row) {
      var value = cell(row, parentField);
      return value !== null && value !== undefined && String(value).trim() !== '';
    });
  }

  function computeHierarchyTotals(flattened) {
    flattened.slice().reverse().forEach(function (entry) {
      var childTotal = (entry.node.children || []).reduce(function (sum, child) {
        return sum + (asNumber(child.total) || 0);
      }, 0);
      entry.node.total = Math.max(asNumber(entry.node.value) || 0, childTotal || 0, 1);
    });
  }

  function renderSunburst(graph) {
    if (!hasHierarchyParent(graph)) return renderPie(graph, true);
    var svg = createSvg();
    var roots = hierarchyRows(graph);
    if (!roots.length) return renderUnsupported(graph, 'No valid hierarchy nodes to display');
    var flattened = flattenHierarchy(roots);
    computeHierarchyTotals(flattened);
    var maxDepth = flattened.reduce(function (max, entry) { return Math.max(max, entry.depth); }, 0);
    var total = roots.reduce(function (sum, node) { return sum + node.total; }, 0) || 1;
    var cx = 300, cy = 178, inner = 34, outer = 142;
    var ring = (outer - inner) / Math.max(1, maxDepth + 1);
    var gap = ring >= 3 ? 2 : Math.max(0.05, ring * 0.2);
    var denseSegments = flattened.length > DENSE_NODE_PATH_THRESHOLD;
    var marks = [];
    var labelAnglesByDepth = {};

    function drawNode(node, start, end, depth, index) {
      var r0 = inner + depth * ring;
      var r1 = r0 + Math.max(0.35, ring - gap);
      var path = append(svg, svgEl('path', {
        d: arcPath(cx, cy, r0, r1, start, end),
        fill: color(index),
        class: 'ug-mark ug-sunburst-segment',
      }));
      if (!denseSegments || shouldShowFocusPoint(index, flattened.length)) {
        marks.push({
          el: path,
          label: node.label + ': ' + formatValue(node.total),
          nodeLabel: node.label,
          fields: [
            { label: 'Node', value: node.label },
            { label: 'Total', value: node.total },
          ],
        });
      }

      var span = end - start;
      var midRadius = r0 + ring / 2;
      var arcLength = span * midRadius;
      var angle = start + span / 2;
      var priorAngle = labelAnglesByDepth[depth];
      var canPlaceLabel = span > 0.28 && arcLength > 46 && r1 - r0 > 16 && (priorAngle === undefined || Math.abs(angle - priorAngle) > 0.24);
      if (canPlaceLabel) {
        labelAnglesByDepth[depth] = angle;
        append(svg, textEl(
          cx + Math.cos(angle) * (r0 + ring / 2),
          cy + Math.sin(angle) * (r0 + ring / 2) + 4,
          shortText(node.label, 11),
          'ug-invert-label',
          { 'text-anchor': 'middle', fullText: node.label }
        ));
      }
    }

    var angle = -Math.PI / 2;
    var segmentIndex = 0;
    var stack = [];
    roots.forEach(function (root, i) {
      var next = angle + (root.total / total) * Math.PI * 2;
      stack.push({ node: root, start: angle, end: next, depth: 0 });
      angle = next;
    });
    while (stack.length) {
      var current = stack.pop();
      var currentIndex = segmentIndex++;
      drawNode(current.node, current.start, current.end, current.depth, currentIndex);
      var children = current.node.children || [];
      if (!children.length) continue;
      var childTotal = children.reduce(function (sum, child) { return sum + child.total; }, 0) || 1;
      var childAngle = current.start;
      var childEntries = [];
      children.forEach(function (child) {
        var next = childAngle + (child.total / childTotal) * (current.end - current.start);
        childEntries.push({ node: child, start: childAngle, end: next, depth: current.depth + 1 });
        childAngle = next;
      });
      childEntries.reverse().forEach(function (entry) { stack.push(entry); });
    }
    addLegend(svg, roots.map(function (root) { return root.label; }));
    if (denseSegments) addDensityNote(svg, 'Rendered ' + flattened.length + ' sunburst segments with sampled tooltips and labels.');
    if (maxDepth > 48) addGraphWarning(graph, 'Compressed a ' + (maxDepth + 1) + '-level sunburst hierarchy into thin rings.');
    addTooltipMarks(svg, marks, graph);
    return svg;
  }

  function renderGraphSvg(graph) {
    if (graph && graph.__ugDrillNoMatch) return renderUnsupported(graph, 'No matching rows for drilldown');
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
    if (graph.type === 'sunburst') return renderSunburst(graph);
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
      options: graph.options,
      interactions: graph.interactions,
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
    var sourceRows = rows(graph);
    var visibleRows = sourceRows.slice(0, SOURCE_ROW_LIMIT);
    var summary = document.createElement('div');
    summary.className = 'ug-source-summary';
    summary.textContent = visibleRows.length < sourceRows.length
      ? 'Showing first ' + visibleRows.length + ' of ' + sourceRows.length + ' rows. Full values are preserved in cells.'
      : 'Showing ' + sourceRows.length + ' source rows.';
    wrap.appendChild(summary);
    var table = document.createElement('table');
    table.className = 'ug-source-table';
    var columns = (graph.data && graph.data.columns) || [];
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    columns.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.name || col.id;
      th.title = col.id;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    visibleRows.forEach(function (row) {
      var tr = document.createElement('tr');
      columns.forEach(function (col) {
        var td = document.createElement('td');
        var rawValue = cell(row, col.id);
        var rendered = formatValue(rawValue);
        td.textContent = rendered;
        td.title = String(rawValue == null ? '' : rawValue);
        td.setAttribute('aria-label', String(rawValue == null ? '' : rawValue));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function cloneGraph(graph) {
    return JSON.parse(JSON.stringify(graph || {}));
  }

  function graphRegistry(graphs) {
    var map = {};
    (graphs || []).forEach(function (graph) {
      if (graph && graph.id) map[graph.id] = graph;
    });
    return { graphs: graphs || [], byId: map };
  }

  function closestTooltipTarget(target, card) {
    while (target && target !== card) {
      if (target.__ugDetail || target.getAttribute && (target.getAttribute('data-ug-tooltip-title') || target.getAttribute('aria-label'))) return target;
      target = target.parentNode;
    }
    return null;
  }

  function detailFromTarget(target) {
    if (!target) return null;
    if (target.__ugDetail) return target.__ugDetail;
    var label = target.getAttribute && (target.getAttribute('data-ug-tooltip-title') || target.getAttribute('aria-label'));
    if (!label) return null;
    return { title: label, label: label, fields: [] };
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function appendDetailFields(container, detail, maxFields) {
    var fields = (detail.fields || []).filter(function (field) {
      return field && field.value !== undefined && field.value !== null && field.value !== '';
    });
    if (!fields.length) return;
    var list = document.createElement('dl');
    list.className = 'ug-detail-fields';
    fields.slice(0, maxFields || fields.length).forEach(function (field) {
      var dt = document.createElement('dt');
      dt.textContent = field.label || field.field || 'Field';
      var dd = document.createElement('dd');
      dd.textContent = formatValue(field.value);
      dd.title = String(field.value);
      list.appendChild(dt);
      list.appendChild(dd);
    });
    container.appendChild(list);
  }

  function renderDetailContent(container, detail, compact) {
    clearNode(container);
    var title = document.createElement(compact ? 'div' : 'h4');
    title.className = compact ? 'ug-tooltip-title' : 'ug-detail-title';
    title.textContent = detail.title || detail.label || 'Graph item';
    container.appendChild(title);
    appendDetailFields(container, detail, compact ? 4 : 20);
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (!Number.isFinite(min)) min = value;
    if (!Number.isFinite(max)) max = value;
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  }

  function viewportBounds() {
    var doc = document.documentElement || {};
    return {
      left: 0,
      top: 0,
      right: window.innerWidth || doc.clientWidth || 1024,
      bottom: window.innerHeight || doc.clientHeight || 768,
    };
  }

  function positionTooltip(card, tooltip, event, target) {
    var x = event && Number.isFinite(event.clientX) ? event.clientX : 0;
    var y = event && Number.isFinite(event.clientY) ? event.clientY : 0;
    var rect = card.getBoundingClientRect ? card.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
    if ((!x && !y) && target && target.getBoundingClientRect) {
      var targetRect = target.getBoundingClientRect();
      x = targetRect.left + targetRect.width / 2;
      y = targetRect.top;
    }
    var gap = 12;
    var margin = 8;
    var viewport = viewportBounds();
    var cardRight = Number.isFinite(rect.right) && rect.right > rect.left ? rect.right : rect.left + (card.clientWidth || rect.width || 0);
    var cardBottom = Number.isFinite(rect.bottom) && rect.bottom > rect.top ? rect.bottom : rect.top + (card.clientHeight || rect.height || 0);
    var tooltipRect = tooltip.getBoundingClientRect ? tooltip.getBoundingClientRect() : { width: 0, height: 0 };
    var tooltipWidth = tooltip.offsetWidth || tooltipRect.width || 300;
    var tooltipHeight = tooltip.offsetHeight || tooltipRect.height || 120;
    var desiredLeft = x + gap;
    var desiredTop = y + gap;
    if (desiredLeft + tooltipWidth + margin > viewport.right || desiredLeft + tooltipWidth + margin > cardRight) {
      desiredLeft = x - tooltipWidth - gap;
    }
    if (desiredTop + tooltipHeight + margin > viewport.bottom || desiredTop + tooltipHeight + margin > cardBottom) {
      desiredTop = y - tooltipHeight - gap;
    }
    var minLeft = Math.max(viewport.left + margin, rect.left + margin);
    var maxLeft = Math.min(viewport.right - tooltipWidth - margin, cardRight - tooltipWidth - margin);
    var minTop = Math.max(viewport.top + margin, rect.top + margin);
    var maxTop = Math.min(viewport.bottom - tooltipHeight - margin, cardBottom - tooltipHeight - margin);
    tooltip.style.left = (clampNumber(desiredLeft, minLeft, Math.max(minLeft, maxLeft)) - rect.left) + 'px';
    tooltip.style.top = (clampNumber(desiredTop, minTop, Math.max(minTop, maxTop)) - rect.top) + 'px';
  }

  function clearHighlights(card) {
    Array.prototype.slice.call(card.querySelectorAll('.ug-dimmed, .ug-highlighted')).forEach(function (el) {
      el.classList.remove('ug-dimmed');
      el.classList.remove('ug-highlighted');
    });
  }

  function highlightRelated(card, target) {
    clearHighlights(card);
    if (!target || !target.getAttribute) return;
    var scope = target.getAttribute('data-ug-highlight-scope') || 'self';
    var series = target.getAttribute('data-ug-series');
    var category = target.getAttribute('data-ug-category');
    var node = target.getAttribute('data-ug-node-label');
    var source = target.getAttribute('data-ug-link-source');
    var targetNode = target.getAttribute('data-ug-link-target');
    var candidates = Array.prototype.slice.call(card.querySelectorAll('[data-ug-interactive="true"]'));
    candidates.forEach(function (candidate) {
      var related = candidate === target;
      if (scope === 'series') {
        if (series && candidate.getAttribute('data-ug-series') === series) related = true;
      } else if (scope === 'category') {
        if (category && candidate.getAttribute('data-ug-category') === category) related = true;
      } else if (scope === 'related') {
        if (series && candidate.getAttribute('data-ug-series') === series) related = true;
        if (category && candidate.getAttribute('data-ug-category') === category) related = true;
        var candidateNode = candidate.getAttribute('data-ug-node-label');
        var candidateSource = candidate.getAttribute('data-ug-link-source');
        var candidateTarget = candidate.getAttribute('data-ug-link-target');
        if (node && (candidateNode === node || candidateSource === node || candidateTarget === node)) related = true;
        if ((source || targetNode) && (candidateNode === source || candidateNode === targetNode)) related = true;
        if ((source || targetNode) && candidateSource === source && candidateTarget === targetNode) related = true;
      }
      candidate.classList.toggle('ug-highlighted', related);
      candidate.classList.toggle('ug-dimmed', !related);
    });
  }

  function drilldownsForDetail(graph, detail) {
    var drills = graphInteractions(graph).drilldowns;
    return Array.isArray(drills) ? drills.filter(function (drill) {
      return drill && typeof drill.targetGraphId === 'string' && drill.match && typeof drill.match === 'object';
    }) : [];
  }

  function drillSourceValue(detail, drill) {
    var source = drill.match && drill.match.source;
    if (source === 'node.label') return detail.nodeLabel || detail.title;
    if (source === 'link.source') return detail.linkSource;
    if (source === 'link.target') return detail.linkTarget;
    if (detail.row && source) return cell(detail.row, source);
    return undefined;
  }

  function filteredDrillGraph(targetGraph, sourceValue, targetField) {
    var next = cloneGraph(targetGraph);
    next.role = 'primary';
    next.data = next.data || { columns: [], rows: [] };
    var sourceText = String(sourceValue == null ? '' : sourceValue);
    var targetRows = rows(targetGraph).filter(function (row) {
      return String(cell(row, targetField)) === sourceText;
    });
    next.data.rows = targetRows;
    next.title = (targetGraph.title || targetGraph.id || 'Drilldown') + ' - ' + sourceText;
    if (!targetRows.length) next.__ugDrillNoMatch = true;
    return next;
  }

  function replaceGraphCard(card, graph, registry, stack) {
    var next = buildGraphCard(graph, registry, stack || []);
    card.parentNode.replaceChild(next, card);
    return next;
  }

  function addDrilldownButtons(panel, card, graph, detail, registry, stack) {
    var drills = drilldownsForDetail(graph, detail);
    if (!drills.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'ug-drill-actions';
    drills.forEach(function (drill) {
      var targetGraph = registry && registry.byId && registry.byId[drill.targetGraphId];
      if (!targetGraph) return;
      var sourceValue = drillSourceValue(detail, drill);
      var targetField = drill.match && drill.match.targetField;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ug-action-btn ug-drilldown-btn';
      btn.textContent = drill.label || 'Drill in';
      btn.disabled = sourceValue === undefined || sourceValue === null || !targetField;
      btn.addEventListener('click', function () {
        var nextGraph = filteredDrillGraph(targetGraph, sourceValue, targetField);
        replaceGraphCard(card, nextGraph, registry, (stack || []).concat([{ graph: graph }]));
      });
      wrap.appendChild(btn);
    });
    if (wrap.childNodes.length) panel.appendChild(wrap);
  }

  function pinDetail(card, graph, registry, stack, detail) {
    var panel = card.querySelector('.ug-detail-panel');
    if (!panel || !detail) return;
    renderDetailContent(panel, detail, false);
    addDrilldownButtons(panel, card, graph, detail, registry, stack);
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ug-detail-close';
    close.textContent = 'Close';
    close.addEventListener('click', function () { panel.hidden = true; });
    panel.appendChild(close);
    panel.hidden = false;
  }

  function activateGraphInteractions(card, graph, registry, stack) {
    var tooltip = document.createElement('div');
    tooltip.className = 'ug-tooltip';
    tooltip.hidden = true;
    card.appendChild(tooltip);
    var activeTarget = null;

    function hideHoverTooltip() {
      tooltip.hidden = true;
      activeTarget = null;
      clearHighlights(card);
    }

    function showForTarget(target, event) {
      var detail = detailFromTarget(target);
      if (!detail) return;
      activeTarget = target;
      suppressNativeSvgTitle(target);
      renderDetailContent(tooltip, detail, true);
      tooltip.hidden = false;
      positionTooltip(card, tooltip, event, target);
      highlightRelated(card, target);
    }

    card.addEventListener('pointerover', function (event) {
      var target = closestTooltipTarget(event.target, card);
      if (target) showForTarget(target, event);
    });
    card.addEventListener('pointermove', function (event) {
      var target = closestTooltipTarget(event.target, card);
      if (!target) {
        if (!tooltip.hidden) hideHoverTooltip();
        return;
      }
      if (target !== activeTarget || tooltip.hidden) showForTarget(target, event);
      else positionTooltip(card, tooltip, event, activeTarget);
    });
    card.addEventListener('pointerout', function (event) {
      if (closestTooltipTarget(event.relatedTarget, card)) return;
      hideHoverTooltip();
    });
    card.addEventListener('focusin', function (event) {
      var target = closestTooltipTarget(event.target, card);
      if (target) showForTarget(target, event);
    });
    card.addEventListener('focusout', function () {
      hideHoverTooltip();
    });
    card.addEventListener('click', function (event) {
      var target = closestTooltipTarget(event.target, card);
      var detail = detailFromTarget(target);
      if (target && target.getAttribute && target.getAttribute('data-ug-interactive') === 'true' && detail) {
        pinDetail(card, graph, registry, stack, detail);
      }
    });
    card.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var panel = card.querySelector('.ug-detail-panel');
        if (panel) panel.hidden = true;
        hideHoverTooltip();
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var target = closestTooltipTarget(event.target, card);
      var detail = detailFromTarget(target);
      if (target && target.getAttribute && target.getAttribute('data-ug-interactive') === 'true' && detail) {
        event.preventDefault();
        pinDetail(card, graph, registry, stack, detail);
      }
    });
  }

  function metricControlConfig(graph) {
    var raw = graphInteractions(graph).metricControls;
    if (!raw) return null;
    if (Array.isArray(raw)) raw = raw[0];
    if (raw === true) raw = {};
    if (!raw || typeof raw !== 'object') return null;
    var target = raw.target || (enc(graph, 'y') ? 'y' : 'value');
    if (target !== 'y' && target !== 'value') return null;
    var fields = Array.isArray(raw.fields) ? raw.fields.slice() : ((graph.data && graph.data.columns) || [])
      .filter(function (col) {
        return String(col.type || '').toLowerCase() === 'number' || rows(graph).every(function (row) { return asNumber(cell(row, col.id)) !== null; });
      })
      .map(function (col) { return col.id; });
    fields = fields.filter(function (field, index) {
      return typeof field === 'string' && fields.indexOf(field) === index && columnMap(graph)[field];
    });
    if (fields.length < 2) return null;
    return { target: target, fields: fields, label: raw.label || 'Metric' };
  }

  function appendMetricControls(card, graph, registry, stack) {
    var config = metricControlConfig(graph);
    if (!config) return;
    var wrap = document.createElement('div');
    wrap.className = 'ug-metric-controls';
    var label = document.createElement('label');
    label.textContent = config.label;
    var select = document.createElement('select');
    select.className = 'ug-metric-select';
    var current = enc(graph, config.target);
    config.fields.forEach(function (field) {
      var option = document.createElement('option');
      option.value = field;
      option.textContent = columnLabel(graph, field);
      option.selected = field === current;
      select.appendChild(option);
    });
    select.addEventListener('change', function () {
      var next = cloneGraph(graph);
      next.encoding = Object.assign({}, next.encoding || {});
      next.encoding[config.target] = select.value;
      replaceGraphCard(card, next, registry, stack || []);
    });
    label.appendChild(select);
    wrap.appendChild(label);
    card.appendChild(wrap);
  }

  function appendBreadcrumb(card, graph, registry, stack) {
    if (!stack || !stack.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'ug-drill-breadcrumb';
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'ug-action-btn';
    back.textContent = 'Back';
    back.addEventListener('click', function () {
      var previous = stack[stack.length - 1].graph;
      replaceGraphCard(card, previous, registry, stack.slice(0, -1));
    });
    var label = document.createElement('span');
    label.textContent = 'Drilldown: ' + (graph.title || graph.id || 'Graph');
    wrap.appendChild(back);
    wrap.appendChild(label);
    card.appendChild(wrap);
  }

  function buildGraphCard(graph, registry, stack) {
    registry = registry || graphRegistry([graph]);
    stack = stack || [];
    resetGraphWarnings(graph);
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

    appendBreadcrumb(card, graph, registry, stack);
    appendMetricControls(card, graph, registry, stack);
    appendAxisContext(card, graph);

    var stage = document.createElement('div');
    stage.className = 'ug-stage';
    var svg = renderGraphSvg(graph);
    var warnings = (graph.__ugWarnings || []).slice();
    if (warnings.length) {
      var warningWrap = document.createElement('div');
      warningWrap.className = 'ug-warnings';
      warnings.forEach(function (warning) {
        var item = document.createElement('div');
        item.className = 'ug-warning';
        item.textContent = warning;
        warningWrap.appendChild(item);
      });
      card.appendChild(warningWrap);
    }
    stage.appendChild(svg);
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

    var detailPanel = document.createElement('aside');
    detailPanel.className = 'ug-detail-panel';
    detailPanel.hidden = true;
    card.appendChild(detailPanel);
    activateGraphInteractions(card, graph, registry, stack);

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

    var registry = graphRegistry(normalized.graphs);
    var primaryGraphs = normalized.graphs.filter(function (graph) {
      return !graph || graph.role !== 'drilldown';
    });
    if (!primaryGraphs.length) {
      var hiddenOnly = document.createElement('div');
      hiddenOnly.className = 'ug-empty';
      hiddenOnly.textContent = 'No primary graphs to display.';
      container.appendChild(hiddenOnly);
      return;
    }

    var list = document.createElement('div');
    list.className = 'ug-list';
    primaryGraphs.forEach(function (graph) {
      list.appendChild(buildGraphCard(graph, registry, []));
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

  function buildGraphContainer(graph, graphs) {
    injectStyles();
    return buildGraphCard(graph, graphRegistry(graphs || [graph]), []);
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
