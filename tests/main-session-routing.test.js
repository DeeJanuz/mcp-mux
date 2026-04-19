import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var mainCode = readFileSync(join(__dirnameResolved, '../public/main.js'), 'utf8');

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
});
