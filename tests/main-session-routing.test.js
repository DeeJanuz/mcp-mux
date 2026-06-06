import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var mainCode = readFileSync(join(__dirnameResolved, '../public/main.js'), 'utf8').replace(/\r\n/g, '\n');

function loadMain() {
  var instrumented = mainCode.replace(
    /  renderEmpty\(\);\n  initAiButton\(\);\n  initUpdateBanner\(\);\n  initAppsButton\(\);\n  startAppUpdateChecks\(\);\n  initTauri\(\);\n\}\)\(\);/,
    [
      '  window.__mainTest = {',
      '    handlePush: handlePush,',
      '    getSession: function (sessionId) { return sessions.get(sessionId) || null; },',
      '    getSessionIds: function () { return Array.from(sessions.keys()); },',
      '    updateSessionMetadata: updateSessionMetadata,',
      '    loadPluginRenderers: loadPluginRenderers,',
      '    checkForAppUpdate: checkForAppUpdate,',
      '  };',
      '  renderEmpty();',
      '  initAiButton();',
      '  initUpdateBanner();',
      '  initAppsButton();',
      '  startAppUpdateChecks();',
      '  initTauri();',
      '})();',
    ].join('\n'),
  );

  new Function(instrumented).call(globalThis);
}

async function flushPromises(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
  }
}

function installLocalStorage() {
  var values = {};
  var storage = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function (key, value) {
      values[key] = String(value);
    },
    removeItem: function (key) {
      delete values[key];
    },
    clear: function () {
      values = {};
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

beforeEach(function () {
  document.body.innerHTML = [
    '<div id="main-title"></div>',
    '<div id="connection-dot"></div>',
    '<div id="connection-text"></div>',
    '<div id="tab-bar"></div>',
    '<button id="refresh-button"></button>',
    '<button id="ai-shell-toggle-button"></button>',
    '<button id="ai-home-button"></button>',
    '<div id="update-banner" class="update-banner hidden">',
    '<strong id="update-banner-title"></strong>',
    '<span id="update-banner-message"></span>',
    '<button id="update-changelog-button"></button>',
    '<button id="update-install-button"></button>',
    '<button id="update-dismiss-button"></button>',
    '</div>',
    '<button id="apps-button"></button>',
    '<div id="apps-dropdown" class="hidden"></div>',
    '<div id="content-area"></div>',
  ].join('');

  delete window.__mainTest;
  delete window.__companionUtils;
  delete window.__TAURI__;
  delete window.__tribexAiShell;
  delete window.__tribexAiState;
  delete window.__tribexAiClient;
  delete window.__rendererRegistry;
  installLocalStorage();
  if (localStorage && typeof localStorage.removeItem === 'function') {
    localStorage.removeItem('mcpviews-dismissed-update-version');
    localStorage.removeItem('mcpviews-dismissed-update-check-failure');
    localStorage.removeItem('decidr-onboarding:completed-org-id');
  }
  window.__renderers = {
    rich_content: vi.fn(),
  };
});

describe('main session routing', function () {
  it('auto-opens DecidR Setup when the bundled onboarding renderer is available', async function () {
    window.__renderers.decidr_onboarding = vi.fn(function (container) {
      container.textContent = 'setup';
    });
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') return Promise.resolve(null);
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();

    var ids = window.__mainTest.getSessionIds();
    expect(ids.length).toBe(1);
    expect(window.__mainTest.getSession(ids[0]).contentType).toBe('decidr_onboarding');
    expect(window.__mainTest.getSession(ids[0]).meta.autoOpened).toBe(true);
  });

  it('does not auto-open DecidR Setup after onboarding is completed', async function () {
    localStorage.setItem('decidr-onboarding:completed-org-id', 'org_123');
    window.__renderers.decidr_onboarding = vi.fn();
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') return Promise.resolve(null);
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();

    expect(window.__mainTest.getSessionIds()).toEqual([]);
  });

  it('shows and dismisses the GitHub release update banner', async function () {
    var update = {
      version: '0.2.5-rc.12',
      currentVersion: '0.2.5-rc.11',
      title: 'MCPViews 0.2.5-rc.12',
      releasePageUrl: 'https://github.com/DeeJanuz/mcpviews/releases/tag/v0.2.5-rc.12',
      updateJsonUrl: 'https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.5-rc.12/latest.json',
      canInstall: true,
    };
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') return Promise.resolve(update);
      if (command === 'install_app_update') return Promise.resolve();
      if (command === 'open_external_url') return Promise.resolve();
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();

    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('update-banner-message').textContent).toContain('0.2.5-rc.12');

    document.getElementById('update-dismiss-button').click();
    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(true);

    await window.__mainTest.checkForAppUpdate();
    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(true);

    update.version = '0.2.5-rc.13';
    await window.__mainTest.checkForAppUpdate();
    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('update-banner-message').textContent).toContain('0.2.5-rc.13');
  });

  it('installs the pending update from the signed release manifest', async function () {
    var update = {
      version: '0.2.5-rc.12',
      currentVersion: '0.2.5-rc.11',
      title: 'MCPViews 0.2.5-rc.12',
      releasePageUrl: 'https://github.com/DeeJanuz/mcpviews/releases/tag/v0.2.5-rc.12',
      updateJsonUrl: 'https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.5-rc.12/latest.json',
      canInstall: true,
    };
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') return Promise.resolve(update);
      if (command === 'install_app_update') return Promise.resolve();
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();
    document.getElementById('update-install-button').click();

    expect(invoke).toHaveBeenCalledWith('install_app_update', {
      updateJsonUrl: update.updateJsonUrl,
    });
    expect(document.getElementById('update-install-button').textContent).toBe('Installing...');
  });

  it('resets the install button after a development update simulation', async function () {
    var update = {
      version: '0.2.6-rc.0',
      currentVersion: '0.2.5-rc.11',
      title: 'MCPViews development update',
      releasePageUrl: 'https://github.com/DeeJanuz/mcpviews/releases',
      updateJsonUrl: 'mcpviews-dev://mock/latest.json',
      canInstall: true,
    };
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') return Promise.resolve(update);
      if (command === 'install_app_update') {
        return Promise.resolve({
          relaunching: false,
          message: 'Development update install simulated; MCPViews was not relaunched.',
        });
      }
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();
    document.getElementById('update-install-button').click();
    await flushPromises();

    expect(document.getElementById('update-banner-message').textContent).toContain('simulated');
    expect(document.getElementById('update-install-button').disabled).toBe(false);
    expect(document.getElementById('update-install-button').textContent).toBe('Install and re-launch');
  });

  it('opens the manual installer download when signed in-app install is unavailable', async function () {
    var update = {
      version: '0.2.7',
      currentVersion: '0.2.6',
      title: 'MCPViews 0.2.7',
      releasePageUrl: 'https://github.com/DeeJanuz/mcpviews/releases/tag/v0.2.7',
      updateJsonUrl: 'https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.7/latest.json',
      manualDownloadUrl: 'https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.7/MCPViews_0.2.7_aarch64.dmg',
      manualDownloadLabel: 'Download macOS installer',
      installUnavailableReason: 'MCPViews updater public key is not configured.',
      canInstall: false,
    };
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') return Promise.resolve(update);
      if (command === 'open_external_url') return Promise.resolve();
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();

    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('update-banner').classList.contains('update-banner-manual')).toBe(true);
    expect(document.getElementById('update-banner-message').textContent).toContain('cannot install signed updates in-app');
    expect(document.getElementById('update-install-button').textContent).toBe('Download macOS installer');

    document.getElementById('update-install-button').click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: update.manualDownloadUrl,
    });
  });

  it('shows a visible update-check failure and retries successfully', async function () {
    var update = {
      version: '0.2.7',
      currentVersion: '0.2.6',
      title: 'MCPViews 0.2.7',
      releasePageUrl: 'https://github.com/DeeJanuz/mcpviews/releases/tag/v0.2.7',
      updateJsonUrl: 'https://github.com/DeeJanuz/mcpviews/releases/download/v0.2.7/latest.json',
      canInstall: true,
    };
    var failuresRemaining = 1;
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          return Promise.reject(new Error('GitHub releases check returned HTTP 403'));
        }
        return Promise.resolve(update);
      }
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();

    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('update-banner').classList.contains('update-banner-warning')).toBe(true);
    expect(document.getElementById('update-banner-title').textContent).toContain('Could not check');
    expect(document.getElementById('update-install-button').textContent).toBe('Try again');

    document.getElementById('update-install-button').click();
    await flushPromises();

    expect(document.getElementById('update-banner').classList.contains('update-banner-warning')).toBe(false);
    expect(document.getElementById('update-banner-message').textContent).toContain('0.2.7');
    expect(document.getElementById('update-install-button').textContent).toBe('Install and re-launch');
  });

  it('throttles dismissed update-check failures', async function () {
    var invoke = vi.fn(function (command) {
      if (command === 'get_plugin_renderers') return Promise.resolve([]);
      if (command === 'get_sessions') return Promise.resolve([]);
      if (command === 'check_app_update') {
        return Promise.reject(new Error('GitHub releases check returned HTTP 500'));
      }
      return Promise.resolve([]);
    });
    window.__TAURI__ = {
      event: { listen: vi.fn(function () { return Promise.resolve(function () {}); }) },
      core: { invoke },
    };

    loadMain();
    await flushPromises();

    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(false);
    document.getElementById('update-dismiss-button').click();
    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(true);

    await window.__mainTest.checkForAppUpdate();
    await flushPromises();

    expect(document.getElementById('update-banner').classList.contains('hidden')).toBe(true);
  });

  it('hides AI workspace entrypoints when no hosted AI provider is configured', async function () {
    window.__tribexAiClient = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: false });
      }),
    };
    window.__tribexAiState = {
      toggleNavigator: vi.fn(),
    };

    loadMain();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('ai-home-button').hidden).toBe(true);
    expect(document.querySelector('.empty-state').textContent).not.toContain('Open AI workspace');

    document.getElementById('ai-home-button').click();
    expect(window.__tribexAiState.toggleNavigator).not.toHaveBeenCalled();
  });

  it('shows AI workspace entrypoints when a hosted AI provider is configured', async function () {
    window.__tribexAiClient = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true, baseUrl: 'https://ai.example.com' });
      }),
    };
    window.__tribexAiState = {
      toggleNavigator: vi.fn(),
    };

    loadMain();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('ai-home-button').hidden).toBe(false);
    expect(document.querySelector('.empty-state').textContent).toContain('Open AI workspace');

    document.getElementById('ai-home-button').click();
    expect(window.__tribexAiState.toggleNavigator).toHaveBeenCalledTimes(1);
  });

  it('opens standalone app sessions for thread-scoped chatOutput previews', function () {
    loadMain();

    window.__mainTest.handlePush({
      sessionId: 'session-123',
      toolName: 'rich_content',
      contentType: 'rich_content',
      data: {
        title: 'Final Result',
        body: 'Rendered in the real preview session.',
      },
      meta: {
        threadId: 'thread-1',
        chatOutputSource: 'tribex-ai-thread-result',
        drawerOnly: true,
        headerTitle: 'Final Result',
      },
      toolArgs: {
        title: 'Final Result',
        threadId: 'thread-1',
      },
      reviewRequired: false,
    }, { autoFocus: false });

    expect(window.__mainTest.getSessionIds()).toEqual(['session-123']);
    expect(window.__mainTest.getSession('session-123')).toMatchObject({
      contentType: 'rich_content',
      data: {
        title: 'Final Result',
        body: 'Rendered in the real preview session.',
      },
      meta: expect.objectContaining({
        threadId: 'thread-1',
        chatOutputSource: 'tribex-ai-thread-result',
      }),
    });
  });

  it('renders and clears the top-of-viewport busy pulse from session metadata', function () {
    loadMain();

    window.__mainTest.handlePush({
      sessionId: 'session-busy',
      toolName: 'AI Workspace',
      contentType: 'rich_content',
      data: {
        title: 'Busy Session',
      },
      meta: {
        headerTitle: 'Busy Session',
        busyIndicator: {
          kind: 'line-pulse',
          status: 'busy',
        },
      },
      toolArgs: {},
      reviewRequired: false,
    });

    expect(document.querySelector('.session-content.active .session-busy-indicator')).not.toBeNull();

    window.__mainTest.updateSessionMetadata('session-busy', {
      busyIndicator: null,
    });

    expect(document.querySelector('.session-content.active .session-busy-indicator')).toBeNull();
  });

  it('preserves cached renderer state when switching between tabs', function () {
    var renderCount = 0;
    window.__renderers.rich_content = vi.fn(function (container, data) {
      renderCount += 1;
      if (!container.querySelector('input')) {
        var input = document.createElement('input');
        input.value = data.title || '';
        container.appendChild(input);
      }
    });

    loadMain();

    window.__mainTest.handlePush({
      sessionId: 'dashboard-session',
      toolName: 'rich_content',
      contentType: 'rich_content',
      data: { title: 'DecidR Dashboard' },
      meta: { headerTitle: 'DecidR Dashboard' },
      toolArgs: {},
      reviewRequired: false,
    });
    document.querySelector('.session-content.active input').value = 'saved dashboard view';

    window.__mainTest.handlePush({
      sessionId: 'notes-session',
      toolName: 'rich_content',
      contentType: 'rich_content',
      data: { title: 'Notes' },
      meta: { headerTitle: 'Notes' },
      toolArgs: {},
      reviewRequired: false,
    }, { autoFocus: true });

    expect(renderCount).toBe(2);

    document.querySelector('.tab[data-session-id="dashboard-session"]').click();

    expect(renderCount).toBe(2);
    expect(document.querySelector('.session-content.active').getAttribute('data-session-id')).toBe('dashboard-session');
    expect(document.querySelector('.session-content.active input').value).toBe('saved dashboard view');
  });

  it('labels standalone renderer launch tabs with the renderer display name', async function () {
    window.__renderers.persona_lab = vi.fn(function (container) {
      container.textContent = 'Persona Studio';
    });
    window.__TAURI__ = {
      event: {
        listen: vi.fn(function () {
          return Promise.resolve(function () {});
        }),
      },
      core: {
        invoke: vi.fn(function (command) {
          if (command === 'get_standalone_renderers') {
            return Promise.resolve([{
              plugin: 'tribe-x-persona-studio',
              renderers: [{
                name: 'persona_lab',
                label: 'Persona Studio',
                description: 'Standalone Persona Studio',
              }],
            }]);
          }
          if (command === 'get_plugin_renderers' || command === 'get_sessions') {
            return Promise.resolve([]);
          }
          return Promise.resolve(null);
        }),
      },
    };

    loadMain();

    document.getElementById('apps-button').click();
    await Promise.resolve();

    var rendererItem = document.querySelector('.apps-renderer-item');
    expect(rendererItem).not.toBeNull();
    rendererItem.click();

    var sessionId = window.__mainTest.getSessionIds()[0];
    expect(window.__mainTest.getSession(sessionId)).toMatchObject({
      toolName: 'standalone_launch',
      contentType: 'persona_lab',
      data: {},
      meta: expect.objectContaining({
        standalone: true,
        headerTitle: 'Persona Studio',
        standaloneRenderer: 'persona_lab',
      }),
      toolArgs: {
        title: 'Persona Studio',
      },
    });
    expect(document.querySelector('.tab-name').textContent).toBe('Persona Studio');
    expect(document.getElementById('main-title').textContent).toBe('Persona Studio');
  });

  it('reloads an installed plugin renderer when its cache-busted URL changes', async function () {
    var rendererResponses = [
      [{
        plugin_name: 'tribex-crm',
        file_name: 'tribex-crm.js',
        url: 'plugin://localhost/tribex-crm/renderers/tribex-crm.js?v=1',
        mcp_url: 'http://127.0.0.1:4886/mcp',
      }],
      [{
        plugin_name: 'tribex-crm',
        file_name: 'tribex-crm.js',
        url: 'plugin://localhost/tribex-crm/renderers/tribex-crm.js?v=2',
        mcp_url: 'http://127.0.0.1:4999/mcp',
      }],
    ];
    window.__TAURI__ = {
      event: {
        listen: vi.fn(function () {
          return Promise.resolve(function () {});
        }),
      },
      core: {
        invoke: vi.fn(function (command) {
          if (command === 'get_plugin_renderers') {
            return Promise.resolve(rendererResponses.shift() || rendererResponses[0] || []);
          }
          if (command === 'get_sessions') return Promise.resolve([]);
          return Promise.resolve(null);
        }),
      },
    };
    var scriptHost = document.createElement('div');
    var querySelector = document.querySelector.bind(document);
    vi.spyOn(document, 'querySelector').mockImplementation(function (selector) {
      if (String(selector).startsWith('script[data-plugin-renderer=')) {
        return scriptHost.querySelector(selector);
      }
      return querySelector(selector);
    });
    var appendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation(function (node) {
      if (node && node.tagName === 'SCRIPT') {
        var result = scriptHost.appendChild(node);
        if (typeof node.onload === 'function') {
          queueMicrotask(function () { node.onload(); });
        }
        return result;
      }
      var result = appendChild(node);
      return result;
    });

    loadMain();
    await Promise.resolve();
    await Promise.resolve();

    var firstScript = scriptHost.querySelector('script[data-plugin-renderer="tribex-crm/tribex-crm.js"]');
    expect(firstScript).not.toBeNull();
    expect(firstScript.getAttribute('src')).toContain('v=1');

    await window.__mainTest.loadPluginRenderers();

    var scripts = scriptHost.querySelectorAll('script[data-plugin-renderer="tribex-crm/tribex-crm.js"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toContain('v=2');
    expect(window.__mcpviews_plugins['tribex-crm'].mcp_url).toBe('http://127.0.0.1:4999/mcp');
  });

  it('shows expired review timers as pending instead of 0:00', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    try {
      loadMain();

      window.__mainTest.handlePush({
        sessionId: 'review-session',
        toolName: 'structured_data',
        contentType: 'rich_content',
        data: { title: 'Review Session' },
        meta: { headerTitle: 'Review Session' },
        toolArgs: {},
        reviewRequired: true,
        timeoutSecs: 1,
      });

      expect(document.querySelector('.tab-timer').textContent).toBe('0:01');
      vi.advanceTimersByTime(1000);
      expect(document.querySelector('.tab-timer').textContent).toBe('Pending');
      expect(document.querySelector('.tab-timer').classList.contains('pending')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
