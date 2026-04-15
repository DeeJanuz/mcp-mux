import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var utilsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-utils.js'), 'utf8');
var shellCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-shell.js'), 'utf8');

function loadUtils() {
  new Function(utilsCode).call(globalThis);
}

function loadShell() {
  new Function(shellCode).call(globalThis);
}

function createState(snapshot) {
  var current = snapshot;
  var subscriber = null;

  return {
    getSnapshot: function () {
      return current;
    },
    subscribe: function (listener) {
      subscriber = listener;
      return function () {};
    },
    updateSnapshot: function (next) {
      current = next;
      if (subscriber) subscriber(current);
    },
    createThread: vi.fn(),
    refreshNavigator: vi.fn(),
    runSmokeTest: vi.fn(),
    openThread: vi.fn(),
    selectOrganization: vi.fn(),
    setAuthEmail: vi.fn(function (value) {
      current.integration.authEmail = value;
      if (subscriber) subscriber(current);
    }),
    setSearchTerm: vi.fn(function (value) {
      current.searchTerm = value;
      if (subscriber) subscriber(current);
    }),
    setVerificationInput: vi.fn(function (value) {
      current.integration.verificationInput = value;
      if (subscriber) subscriber(current);
    }),
    toggleOrganizationMenu: vi.fn(),
    verifyMagicLink: vi.fn(function () { return Promise.resolve(); }),
    sendMagicLink: vi.fn(function () { return Promise.resolve(); }),
    setActiveSession: vi.fn(),
  };
}

beforeEach(function () {
  document.body.className = '';
  document.body.innerHTML = [
    '<div id="app"></div>',
    '<button id="ai-home-button"></button>',
    '<button id="ai-shell-toggle-button"></button>',
    '<div id="main-header"></div>',
    '<div id="tab-bar"></div>',
    '<div id="main-body"></div>',
    '<div id="ai-shell"></div>',
  ].join('');

  delete window.__tribexAiUtils;
  delete window.__tribexAiShell;
  delete window.__tribexAiState;

  loadUtils();
});

describe('tribex-ai-shell', function () {
  it('keeps the auth email input focused across rerenders', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      organizationMenuOpen: false,
      searchTerm: '',
      organizations: [],
      selectedOrganization: null,
      preferredWorkspace: null,
      projectGroups: [],
      hasProjects: false,
      activeProjectId: null,
      integration: {
        config: { configured: true },
        status: 'unauthenticated',
        authEmail: 'd',
        verificationInput: '',
        magicLinkSentTo: null,
        sendingMagicLink: false,
        verifyingMagicLink: false,
        error: null,
      },
    };

    var state = createState(snapshot);
    window.__tribexAiState = state;
    loadShell();

    window.__tribexAiShell.render();

    var input = document.querySelector('[data-focus-key="auth-email"]');
    input.focus();

    state.setAuthEmail('da');

    var rerendered = document.querySelector('[data-focus-key="auth-email"]');
    expect(document.activeElement).toBe(rerendered);
    expect(rerendered.value).toBe('da');
    expect(document.body.classList.contains('ai-mode-active')).toBe(true);
  });

  it('renders a Codex-style left rail with smoke actions and thread rows', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      organizationMenuOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      preferredWorkspace: { id: 'workspace-smoke', name: 'Smoke Workspace', packageKey: 'smoke' },
      projectGroups: [{
        project: {
          id: 'project-1',
          name: 'Smoke Project',
          workspaceName: 'Smoke Workspace',
        },
        threads: [{
          id: 'thread-1',
          title: 'Smoke Test 2026-04-14 20:11',
          preview: 'Smoke Test Passed',
          lastActivityAt: '2026-04-14T20:11:00.000Z',
        }],
      }],
      hasProjects: true,
      canRunSmokeTest: true,
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      integration: {
        config: { configured: true },
        status: 'authenticated',
        authEmail: '',
        verificationInput: '',
        magicLinkSentTo: null,
        sendingMagicLink: false,
        verifyingMagicLink: false,
        error: null,
      },
    };

    var state = createState(snapshot);
    window.__tribexAiState = state;
    loadShell();

    window.__tribexAiShell.render();

    expect(document.querySelector('.ai-nav-brand-panel').textContent).toContain('Smoke Workspace');
    expect(document.querySelector('.ai-nav-action-primary').disabled).toBe(false);
    expect(document.querySelector('.ai-nav-action-grid').textContent).toContain('Run smoke test');
    expect(document.querySelector('.ai-nav-group-icon')).not.toBeNull();
    expect(document.querySelector('.ai-nav-thread-tree-row.active').textContent).toContain('Smoke Test 2026-04-14 20:11');
    expect(document.querySelector('.ai-nav-thread-tree-row .ai-nav-thread-row-time').textContent.length).toBeGreaterThan(0);
    expect(document.body.classList.contains('ai-mode-active')).toBe(true);
  });
});
