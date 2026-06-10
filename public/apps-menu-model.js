// @ts-nocheck
(function () {
  'use strict';

  function humanizePluginName(pluginName) {
    var known = {
      decidr: 'DecidR',
      ludflow: 'Ludflow',
      tribex_ai: 'TribeX AI',
      'tribe-x-persona-studio': 'Persona Studio',
    };
    var key = String(pluginName || '');
    if (known[key]) return known[key];
    return key
      .split(/[-_]+/)
      .filter(Boolean)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  function rendererLabel(renderer) {
    if (!renderer || typeof renderer !== 'object') return '';
    var label = String(renderer.label || '').trim();
    if (label) return label;
    return String(renderer.name || '').trim();
  }

  function pluginLabel(plugin) {
    if (!plugin || typeof plugin !== 'object') return '';
    var label = String(plugin.label || '').trim();
    if (label) return label;
    return humanizePluginName(plugin.plugin);
  }

  function normalizePlugins(plugins) {
    if (!Array.isArray(plugins)) return [];
    return plugins.map(function (plugin) {
      var renderers = Array.isArray(plugin && plugin.renderers) ? plugin.renderers : [];
      return {
        raw: plugin,
        plugin: plugin && plugin.plugin,
        label: pluginLabel(plugin),
        renderers: renderers.map(function (renderer) {
          return {
            raw: renderer,
            name: renderer && renderer.name,
            label: rendererLabel(renderer),
            description: String((renderer && renderer.description) || ''),
          };
        }),
      };
    });
  }

  function collapseAll(root) {
    root.querySelectorAll('.apps-plugin-header').forEach(function (header) {
      header.classList.remove('expanded');
      header.setAttribute('aria-expanded', 'false');
    });
    root.querySelectorAll('.apps-renderer-list').forEach(function (list) {
      list.classList.remove('expanded');
    });
  }

  function createClickable(tagName) {
    var tag = tagName || 'button';
    var element = document.createElement(tag);
    if (tag.toLowerCase() === 'button') {
      element.type = 'button';
    }
    return element;
  }

  function setEmpty(root, message) {
    root.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = 'apps-empty';
    empty.textContent = message || 'No apps available';
    root.appendChild(empty);
  }

  function renderAppsMenu(root, plugins, options) {
    options = options || {};
    var normalized = normalizePlugins(plugins);
    if (!root) return normalized;
    if (normalized.length === 0) {
      setEmpty(root, options.emptyText || 'No apps available');
      return normalized;
    }

    root.innerHTML = '';
    normalized.forEach(function (plugin, index) {
      var entry = document.createElement('div');
      entry.className = 'apps-plugin-entry';

      var header = createClickable(options.headerTag || 'button');
      header.className = 'apps-plugin-header';
      header.setAttribute('data-plugin', plugin.plugin || '');
      header.setAttribute('aria-expanded', 'false');
      if ((options.headerTag || 'button').toLowerCase() !== 'button') {
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
      }

      var chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = options.chevronText || '>';
      var label = document.createElement('span');
      label.textContent = plugin.label;
      header.appendChild(chevron);
      header.appendChild(label);
      entry.appendChild(header);

      var rendererList = document.createElement('div');
      rendererList.className = 'apps-renderer-list';
      plugin.renderers.forEach(function (renderer) {
        var item = createClickable(options.itemTag || 'button');
        item.className = 'apps-renderer-item';
        item.setAttribute('data-renderer', renderer.name || '');
        item.setAttribute('data-plugin', plugin.plugin || '');
        item.setAttribute('title', renderer.description || '');
        item.textContent = renderer.label;
        item.addEventListener('click', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          if (typeof options.onSelect === 'function') {
            options.onSelect(renderer.raw, renderer.label, plugin.raw);
          }
        });
        rendererList.appendChild(item);
      });
      entry.appendChild(rendererList);
      root.appendChild(entry);

      function toggleEntry(event) {
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        var expanded = header.classList.contains('expanded');
        collapseAll(root);
        if (!expanded) {
          header.classList.add('expanded');
          header.setAttribute('aria-expanded', 'true');
          rendererList.classList.add('expanded');
        }
      }

      header.addEventListener('click', toggleEntry);
      header.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleEntry(event);
        }
      });

      if (options.autoExpandFirst !== false && index === 0) {
        header.classList.add('expanded');
        header.setAttribute('aria-expanded', 'true');
        rendererList.classList.add('expanded');
      }
    });

    return normalized;
  }

  window.__mcpviewsAppsMenu = {
    collapseAll: collapseAll,
    humanizePluginName: humanizePluginName,
    normalizePlugins: normalizePlugins,
    renderAppsMenu: renderAppsMenu,
    setEmpty: setEmpty,
  };
})();
