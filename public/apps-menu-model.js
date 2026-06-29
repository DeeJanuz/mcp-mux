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

  function pluginRank(pluginName) {
    var ranks = {
      decidr: 10,
      ludflow: 20,
      'decidr-staging': 30,
      'ludflow-staging': 40,
      'tribe-x-persona-studio': 50,
    };
    var key = String(pluginName || '');
    return Object.prototype.hasOwnProperty.call(ranks, key) ? ranks[key] : 100;
  }

  function normalizePlugins(plugins) {
    if (!Array.isArray(plugins)) return [];
    return plugins.map(function (plugin) {
      var renderers = Array.isArray(plugin && plugin.renderers) ? plugin.renderers : [];
      var contexts = Array.isArray(plugin && plugin.contexts) ? plugin.contexts : [];
      return {
        raw: plugin,
        plugin: plugin && plugin.plugin,
        label: pluginLabel(plugin),
        contexts: contexts.map(function (context) {
          return {
            raw: context,
            contextId: context && (context.context_id || context.contextId),
            label: String((context && (context.label || context.name || context.slug || context.context_id || context.contextId)) || ''),
            status: String((context && context.status) || ''),
            usable: !!(context && context.usable),
            isProjectDefault: !!(context && (context.is_project_default || context.isProjectDefault)),
            routingArg: context && (context.routing_arg || context.routingArg),
          };
        }),
        renderers: renderers.map(function (renderer) {
          return {
            raw: renderer,
            name: renderer && renderer.name,
            label: rendererLabel(renderer),
            description: String((renderer && renderer.description) || ''),
          };
        }),
      };
    }).sort(function (a, b) {
      var rankDelta = pluginRank(a.plugin) - pluginRank(b.plugin);
      if (rankDelta !== 0) return rankDelta;
      return String(a.label || a.plugin || '').localeCompare(String(b.label || b.plugin || ''));
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

  function isValidContextAuth(context) {
    if (!context || typeof context !== 'object') return false;
    var status = String(context.status || '').toLowerCase();
    return context.usable === true && status === 'valid';
  }

  function setContextExpanded(contextBlock, expanded) {
    if (!contextBlock) return;
    contextBlock.classList.toggle('apps-context-collapsed', !expanded);
    var contextToggle = contextBlock.querySelector('.apps-context-toggle');
    if (contextToggle) {
      contextToggle.classList.toggle('expanded', !!expanded);
      contextToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
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
      function renderRendererItem(renderer, context) {
        var item = createClickable(options.itemTag || 'button');
        item.className = 'apps-renderer-item';
        item.setAttribute('data-renderer', renderer.name || '');
        item.setAttribute('data-plugin', plugin.plugin || '');
        if (context && context.contextId) item.setAttribute('data-context-id', context.contextId);
        item.setAttribute('title', renderer.description || '');
        item.textContent = renderer.label;
        item.addEventListener('click', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          if (typeof options.onSelect === 'function') {
            options.onSelect(renderer.raw, renderer.label, plugin.raw, context && context.raw);
          }
        });
        return item;
      }

      if (plugin.contexts.length > 0) {
        plugin.contexts.forEach(function (context) {
          var contextAuthValid = isValidContextAuth(context);
          var contextBlock = document.createElement('div');
          contextBlock.className = 'apps-context-block';
          var contextHeader = document.createElement('div');
          contextHeader.className = 'apps-context-header';
          var contextToggle = createClickable('button');
          contextToggle.className = 'apps-context-toggle';
          contextToggle.setAttribute('aria-expanded', contextAuthValid ? 'true' : 'false');
          var contextChevron = document.createElement('span');
          contextChevron.className = 'apps-context-chevron';
          contextChevron.textContent = options.chevronText || '>';
          contextToggle.appendChild(contextChevron);
          var contextLabel = document.createElement('span');
          contextLabel.className = 'apps-context-label';
          contextLabel.textContent = context.label || context.contextId || 'Context';
          contextToggle.appendChild(contextLabel);
          if (context.status) {
            var contextStatus = document.createElement('span');
            contextStatus.className = 'apps-context-status';
            contextStatus.textContent = context.isProjectDefault ? 'default' : context.status;
            contextToggle.appendChild(contextStatus);
          }
          contextHeader.appendChild(contextToggle);
          if (context.usable && typeof options.onSetDefault === 'function') {
            var defaultButton = createClickable('button');
            defaultButton.className = 'apps-context-default-button';
            defaultButton.textContent = context.isProjectDefault ? '★' : '☆';
            defaultButton.setAttribute('title', 'Set as project default');
            defaultButton.addEventListener('click', function (event) {
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
              options.onSetDefault(context.raw, plugin.raw);
            });
            contextHeader.appendChild(defaultButton);
          }
          contextBlock.appendChild(contextHeader);
          var contextItems = document.createElement('div');
          contextItems.className = 'apps-context-items';
          plugin.renderers.forEach(function (renderer) {
            contextItems.appendChild(renderRendererItem(renderer, context));
          });
          contextBlock.appendChild(contextItems);
          setContextExpanded(contextBlock, contextAuthValid);
          contextToggle.addEventListener('click', function (event) {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            setContextExpanded(contextBlock, contextBlock.classList.contains('apps-context-collapsed'));
          });
          rendererList.appendChild(contextBlock);
        });
      } else {
        plugin.renderers.forEach(function (renderer) {
          rendererList.appendChild(renderRendererItem(renderer, null));
        });
      }
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
    isValidContextAuth: isValidContextAuth,
    normalizePlugins: normalizePlugins,
    pluginRank: pluginRank,
    renderAppsMenu: renderAppsMenu,
    setEmpty: setEmpty,
  };
})();
