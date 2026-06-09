// @ts-nocheck
(function () {
  'use strict';

  var root = document.getElementById('apps-popup');

  function invoke(command, args) {
    if (!window.__TAURI__ || !window.__TAURI__.core || typeof window.__TAURI__.core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri IPC is not available.'));
    }
    return window.__TAURI__.core.invoke(command, args || {});
  }

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

  function closePopup() {
    invoke('close_apps_popup').catch(function () {});
  }

  function selectRenderer(rendererName, rendererLabel) {
    invoke('select_apps_popup_renderer', {
      selection: {
        rendererName: rendererName,
        rendererLabel: rendererLabel || rendererName,
      },
    }).catch(function (error) {
      console.error('[apps-popup] Failed to select renderer:', error);
      closePopup();
    });
  }

  function collapseAll() {
    root.querySelectorAll('.apps-plugin-header').forEach(function (header) {
      header.classList.remove('expanded');
      header.setAttribute('aria-expanded', 'false');
    });
    root.querySelectorAll('.apps-renderer-list').forEach(function (list) {
      list.classList.remove('expanded');
    });
  }

  function renderPlugins(plugins) {
    if (!Array.isArray(plugins) || plugins.length === 0) {
      root.innerHTML = '<div class="apps-empty">No apps available</div>';
      return;
    }

    root.innerHTML = '';
    plugins.forEach(function (plugin, index) {
      var pluginName = plugin.label || humanizePluginName(plugin.plugin);
      var entry = document.createElement('div');
      entry.className = 'apps-plugin-entry';

      var header = document.createElement('button');
      header.type = 'button';
      header.className = 'apps-plugin-header';
      header.setAttribute('aria-expanded', 'false');
      var chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '>';
      var label = document.createElement('span');
      label.textContent = pluginName;
      header.appendChild(chevron);
      header.appendChild(label);
      entry.appendChild(header);

      var rendererList = document.createElement('div');
      rendererList.className = 'apps-renderer-list';
      (plugin.renderers || []).forEach(function (renderer) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'apps-renderer-item';
        item.setAttribute('title', renderer.description || '');
        item.textContent = renderer.label || renderer.name;
        item.addEventListener('click', function () {
          selectRenderer(renderer.name, item.textContent.trim());
        });
        rendererList.appendChild(item);
      });
      entry.appendChild(rendererList);
      root.appendChild(entry);

      header.addEventListener('click', function () {
        var expanded = header.classList.contains('expanded');
        collapseAll();
        if (!expanded) {
          header.classList.add('expanded');
          header.setAttribute('aria-expanded', 'true');
          rendererList.classList.add('expanded');
        }
      });

      if (index === 0) {
        header.classList.add('expanded');
        header.setAttribute('aria-expanded', 'true');
        rendererList.classList.add('expanded');
      }
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopup();
    }
  });

  invoke('get_standalone_renderers')
    .then(renderPlugins)
    .catch(function (error) {
      console.error('[apps-popup] Failed to load apps:', error);
      root.innerHTML = '<div class="apps-empty">Failed to load apps</div>';
    });
})();
