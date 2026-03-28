// @ts-nocheck
/* Invocation Registry — frontend cache of invocable renderer metadata */

(function () {
  'use strict';

  // Registry: { rendererName: { display_mode, invoke_schema, url_patterns, plugin } }
  window.__rendererRegistry = {};

  function populateRegistry() {
    if (!window.__TAURI__) return Promise.resolve();

    return window.__TAURI__.core
      .invoke('get_renderer_registry')
      .then(function (entries) {
        var reg = {};
        entries.forEach(function (entry) {
          reg[entry.name] = {
            display_mode: entry.display_mode || 'drawer',
            invoke_schema: entry.invoke_schema,
            url_patterns: entry.url_patterns || [],
            plugin: entry.plugin,
          };
        });
        window.__rendererRegistry = reg;
      })
      .catch(function (err) {
        console.warn('[invocation-registry] Failed to populate:', err);
      });
  }

  /**
   * Convert a glob-like pattern to a regex.
   * Supports * (any segment) and ** (any path).
   */
  function globToRegex(pattern) {
    var escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__GLOBSTAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__GLOBSTAR__/g, '.*');
    return new RegExp('^' + escaped + '$');
  }

  /**
   * Scan a container for <a> tags whose href matches any registered url_pattern.
   * Convert matching links to invocation buttons.
   */
  function autoDetectLinks(containerEl) {
    if (!containerEl) return;
    var registry = window.__rendererRegistry;
    var names = Object.keys(registry);
    if (names.length === 0) return;

    // Build pattern list: [{ regex, rendererName }]
    var patterns = [];
    names.forEach(function (name) {
      var entry = registry[name];
      if (!entry.url_patterns) return;
      entry.url_patterns.forEach(function (pat) {
        patterns.push({ regex: globToRegex(pat), rendererName: name });
      });
    });

    if (patterns.length === 0) return;

    var links = containerEl.querySelectorAll('a[href]');
    links.forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href) return;

      // Try URL pathname for matching
      var pathname = href;
      try {
        var url = new URL(href);
        pathname = url.pathname;
      } catch (e) {
        // Not a full URL, use as-is
      }

      for (var i = 0; i < patterns.length; i++) {
        if (patterns[i].regex.test(pathname) || patterns[i].regex.test(href)) {
          // Convert to invocation button
          var btn = document.createElement('button');
          btn.className = 'mcpview-invoke-btn';
          btn.textContent = link.textContent;
          btn.setAttribute('data-invoke-renderer', patterns[i].rendererName);
          btn.setAttribute('data-invoke-params', JSON.stringify({ url: href }));
          btn.setAttribute('title', 'Open in ' + patterns[i].rendererName.replace(/_/g, ' '));
          link.parentNode.replaceChild(btn, link);
          break;
        }
      }
    });
  }

  // Register utilities
  var utils = window.__companionUtils || {};
  utils.populateRendererRegistry = populateRegistry;
  utils.autoDetectLinks = autoDetectLinks;
  window.__companionUtils = utils;

  // Populate on load
  populateRegistry();
})();
