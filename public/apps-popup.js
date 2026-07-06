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

  function renderPlugins(plugins) {
    if (!window.__mcpviewsAppsMenu || typeof window.__mcpviewsAppsMenu.renderAppsMenu !== 'function') {
      root.innerHTML = '<div class="apps-empty">Apps menu unavailable</div>';
      return;
    }
    window.__mcpviewsAppsMenu.renderAppsMenu(root, plugins, {
      headerTag: 'button',
      itemTag: 'button',
      chevronText: '>',
      emptyText: 'No apps available',
      onSelect: function (renderer, rendererLabel) {
        selectRenderer(renderer && renderer.name, rendererLabel);
      },
      onAuthAction: function (context, plugin) {
        var contextId = context && (context.context_id || context.contextId);
        var pluginName = plugin && plugin.plugin;
        if (!contextId || !pluginName) return;
        invoke('start_plugin_auth', {
          pluginName: pluginName,
          orgId: contextId,
          authFlow: 'email_code',
        }).then(function () {
          closePopup();
        }).catch(function (error) {
          console.error('[apps-popup] Failed to open plugin auth:', error);
        });
      },
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
      if (window.__mcpviewsAppsMenu && typeof window.__mcpviewsAppsMenu.setEmpty === 'function') {
        window.__mcpviewsAppsMenu.setEmpty(root, 'Failed to load apps');
      } else {
        root.innerHTML = '<div class="apps-empty">Failed to load apps</div>';
      }
    });
})();
