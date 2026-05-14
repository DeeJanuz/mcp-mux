import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var mainCode = readFileSync(join(__dirnameResolved, '../public/main.js'), 'utf8').replace(/\r\n/g, '\n');

function loadMain() {
  var instrumented = mainCode.replace(
    /  renderEmpty\(\);\n  initAiButton\(\);\n  initAppsButton\(\);\n  initTauri\(\);\n\}\)\(\);/,
    [
      '  window.__mainTest = {',
      '    handlePush: handlePush,',
      '    getSession: function (sessionId) { return sessions.get(sessionId) || null; },',
      '    getSessionIds: function () { return Array.from(sessions.keys()); },',
      '    updateSessionMetadata: updateSessionMetadata,',
      '  };',
      '  renderEmpty();',
      '  initAiButton();',
      '  initAppsButton();',
      '  initTauri();',
      '})();',
    ].join('\n'),
  );

  new Function(instrumented).call(globalThis);
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
    '<button id="apps-button"></button>',
    '<div id="apps-dropdown" class="hidden"></div>',
    '<div id="content-area"></div>',
  ].join('');

  delete window.__mainTest;
  delete window.__companionUtils;
  delete window.__TAURI__;
  delete window.__tribexAiShell;
  delete window.__tribexAiState;
  delete window.__rendererRegistry;
  window.__renderers = {
    rich_content: vi.fn(),
  };
});

describe('main session routing', function () {
  it('opens standalone app sessions for thread-scoped artifact previews', function () {
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
        artifactSource: 'tribex-ai-thread-result',
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
        artifactSource: 'tribex-ai-thread-result',
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
              plugin: 'tribe-x-ai-plugin',
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
