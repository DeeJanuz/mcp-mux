// @ts-nocheck
/* Shared utilities for all renderers — MUST load before other renderers */

(function () {
  'use strict';

  const CITATION_COLORS = {
    doc:  { hex: '#2563eb', label: 'Document',        css: 'cite-doc' },
    code: { hex: '#7c3aed', label: 'Code',            css: 'cite-code' },
    dg:   { hex: '#059669', label: 'Data Governance',  css: 'cite-dg' },
    api:  { hex: '#d97706', label: 'API Endpoint',     css: 'cite-api' },
    kdex: { hex: '#0d9488', label: 'Knowledge Dex',    css: 'cite-kdex' },
    dl:   { hex: '#0284c7', label: 'Data Lake',        css: 'cite-dl' },
  };

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str || '';
    return str.slice(0, max) + '...';
  }

  function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked === 'undefined') return escapeHtml(text);

    var renderer = new marked.Renderer();

    // Custom link renderer for cite: URIs
    renderer.link = function({ href, title, text }) {
      if (href && href.startsWith('cite:')) {
        var parts = href.split(':');
        var type = parts[1] || 'doc';
        var index = parts[2] || '0';
        var color = CITATION_COLORS[type] || CITATION_COLORS.doc;
        return '<button class="cite-link ' + color.css + '" data-cite-type="' + type + '" data-cite-index="' + index + '" title="' + (title || color.label) + '">' + text + '</button>';
      }
      return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" class="md-link">' + text + '</a>';
    };

    // Code blocks — mermaid gets a placeholder for async rendering, others get dark theme
    renderer.code = function({ text, lang }) {
      if (lang === 'mermaid') {
        var encoded = btoa(unescape(encodeURIComponent(text)));
        return '<div class="mermaid-placeholder" data-mermaid="' + encoded + '">' +
          '<div class="mermaid-loading">Rendering diagram\u2026</div></div>';
      }
      return '<pre class="md-codeblock"><code>' + escapeHtml(text) + '</code></pre>';
    };

    // Inline code
    renderer.codespan = function({ text }) {
      return '<code class="md-inline-code">' + escapeHtml(text) + '</code>';
    };

    marked.setOptions({ renderer: renderer, breaks: true, gfm: true });

    var container = document.createElement('div');
    container.className = 'md-content';
    container.innerHTML = marked.parse(text);
    return container;
  }

  function renderCitationBadge(type, index, label) {
    var color = CITATION_COLORS[type] || CITATION_COLORS.doc;
    var sup = document.createElement('button');
    sup.className = 'cite-link ' + color.css;
    sup.setAttribute('data-cite-type', type);
    sup.setAttribute('data-cite-index', String(index));
    sup.setAttribute('role', 'button');
    sup.setAttribute('tabindex', '0');
    sup.setAttribute('aria-label', color.label + ' ' + (label || index));
    sup.textContent = label || String(index);
    return sup;
  }

  function createBadge(text, bgColor, textColor) {
    var badge = document.createElement('span');
    badge.className = 'glass-badge';
    if (bgColor) badge.style.setProperty('--badge-bg', bgColor);
    if (textColor) badge.style.setProperty('--badge-color', textColor);
    badge.textContent = text;
    return badge;
  }

  function createButton(text, opts) {
    opts = opts || {};
    var btn = document.createElement('button');
    btn.textContent = text;
    btn.className = 'glass-btn';
    if (opts.bg) btn.style.setProperty('--btn-bg', opts.bg);
    if (opts.color) btn.style.setProperty('--btn-color', opts.color);
    if (opts.borderColor) btn.style.setProperty('--btn-border', opts.borderColor);
    if (opts.onclick) btn.addEventListener('click', opts.onclick);
    return btn;
  }

  function createSmallButton(text, opts) {
    var btn = createButton(text, opts);
    btn.classList.add('glass-btn-sm');
    return btn;
  }

  function createStatusBadge(status) {
    if (status === 'PUBLISHED') return createBadge('PUBLISHED', '#dcfce7', '#166534');
    if (status === 'DRAFT') return createBadge('DRAFT', '#fef9c3', '#854d0e');
    return createBadge(status || 'UNKNOWN', '#f3f4f6', '#737373');
  }

  function createScopeBadge(scope) {
    if (scope === 'ORGANIZATIONAL') return createBadge('ORG', '#dbeafe', '#1e40af');
    return createBadge('PERSONAL', '#fef9c3', '#854d0e');
  }

  /**
   * Parse legacy citation markers in text and replace with HTML citation links.
   * Patterns: [n] = doc, (n) = code, {n} = dg, <<n>> = api
   * Also handles cite: URI markdown links (already handled by renderMarkdown).
   */
  function parseCitationMarkers(html) {
    // Legacy patterns: [n], (n), {n}, <<n>>
    var pattern = /(\[(\d+)\]|\((\d+)\)|\{(\d+)\}|<<(\d+)>>)/g;
    return html.replace(pattern, function(match, _full, docIdx, codeIdx, dgIdx, apiIdx) {
      var type, index;
      if (docIdx) { type = 'doc'; index = docIdx; }
      else if (codeIdx) { type = 'code'; index = codeIdx; }
      else if (dgIdx) { type = 'dg'; index = dgIdx; }
      else if (apiIdx) { type = 'api'; index = apiIdx; }
      else return match;

      var color = CITATION_COLORS[type] || CITATION_COLORS.doc;
      return '<button class="cite-link ' + color.css + '" data-cite-type="' + type + '" data-cite-index="' + index + '" title="' + color.label + ' ' + index + '">' + index + '</button>';
    });
  }

  /**
   * Render markdown with both modern cite: links and legacy citation markers.
   * Returns an HTMLElement.
   */
  function renderMarkdownWithCitations(text) {
    var el = renderMarkdown(text);
    if (el instanceof HTMLElement) {
      el.innerHTML = parseCitationMarkers(el.innerHTML);
    }
    return el;
  }

  // Proxy fetch utilities
  var _proxyStatus = null;
  var _proxyStatusTs = 0;
  var PROXY_STATUS_TTL = 30000; // 30s cache

  function checkProxyStatus() {
    if (_proxyStatus !== null && (Date.now() - _proxyStatusTs) < PROXY_STATUS_TTL) {
      return Promise.resolve(_proxyStatus);
    }
    return fetch('/api/proxy/status')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        _proxyStatus = data;
        _proxyStatusTs = Date.now();
        return data;
      })
      .catch(function () {
        _proxyStatus = { configured: false };
        _proxyStatusTs = Date.now();
        return _proxyStatus;
      });
  }

  function companionFetch(toolName, args) {
    return fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, args: args || {} }),
    }).then(function (res) {
      if (!res.ok) throw new Error('Proxy request failed: ' + res.status);
      return res.json();
    });
  }

  function isProxyConfigured() {
    return _proxyStatus && _proxyStatus.configured;
  }

  // HTTP method colors — shared across search results and citation panel
  var HTTP_METHOD_COLORS = {
    GET:    { bg: '#dcfce7', text: '#166534', hex: '#22c55e' },
    POST:   { bg: '#dbeafe', text: '#1e40af', hex: '#3b82f6' },
    PUT:    { bg: '#fef9c3', text: '#854d0e', hex: '#eab308' },
    PATCH:  { bg: '#ffedd5', text: '#9a3412', hex: '#f97316' },
    DELETE: { bg: '#fee2e2', text: '#991b1b', hex: '#ef4444' }
  };

  /**
   * Fetch MCP tool data via companion proxy with loading/error states.
   * Returns parsed data object from MCP response, or null on failure.
   * @param {HTMLElement} container - element to show loading/error in
   * @param {string} toolName - MCP tool name
   * @param {object} args - tool arguments
   * @param {string} loadingText - text to show while loading
   * @returns {Promise<object|null>}
   */
  function proxyFetchWithStatus(container, toolName, args, loadingText) {
    var loading = document.createElement('div');
    loading.className = 'loading-text';
    loading.textContent = loadingText || 'Loading...';
    container.appendChild(loading);

    return companionFetch(toolName, args)
      .then(function (result) {
        var parsed = null;
        if (result && result.content && result.content[0]) {
          try { parsed = JSON.parse(result.content[0].text); } catch (e) {}
        }
        if (loading.parentNode) loading.parentNode.removeChild(loading);
        return parsed;
      })
      .catch(function () {
        loading.textContent = 'Failed to load data';
        loading.className = 'loading-error';
        return null;
      });
  }

  function buildCollapsibleSection(title, renderContent, opts) {
    opts = opts || {};
    var section = document.createElement('div');
    section.className = 'collapsible-section';

    var header = document.createElement('div');
    header.className = 'collapsible-header';
    var startExpanded = opts.expanded === true;
    if (startExpanded) header.classList.add('expanded');

    var toggle = document.createElement('span');
    toggle.className = 'collapsible-toggle';
    toggle.textContent = startExpanded ? '\u25BC' : '\u25B6';

    var titleEl = document.createElement('span');
    titleEl.className = 'collapsible-title';
    titleEl.textContent = title;

    header.appendChild(toggle);
    header.appendChild(titleEl);

    var body = document.createElement('div');
    body.className = 'collapsible-body';
    if (!startExpanded) {
      body.style.display = 'none';
    }

    renderContent(body);

    header.onclick = function () {
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      header.classList.toggle('expanded', hidden);
      toggle.textContent = hidden ? '\u25BC' : '\u25B6';
    };

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  // Register globally (renderMermaidBlocks added by mermaid-renderer.js after load)
  window.__companionUtils = {
    CITATION_COLORS: CITATION_COLORS,
    HTTP_METHOD_COLORS: HTTP_METHOD_COLORS,
    escapeHtml: escapeHtml,
    truncate: truncate,
    renderMarkdown: renderMarkdown,
    renderCitationBadge: renderCitationBadge,
    createBadge: createBadge,
    createButton: createButton,
    createSmallButton: createSmallButton,
    createStatusBadge: createStatusBadge,
    createScopeBadge: createScopeBadge,
    parseCitationMarkers: parseCitationMarkers,
    renderMarkdownWithCitations: renderMarkdownWithCitations,
    buildCollapsibleSection: buildCollapsibleSection,
    checkProxyStatus: checkProxyStatus,
    companionFetch: companionFetch,
    proxyFetchWithStatus: proxyFetchWithStatus,
    isProxyConfigured: isProxyConfigured,
  };

  // Check proxy status on load
  checkProxyStatus();
})();
