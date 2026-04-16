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
    createProject: vi.fn(),
    createThread: vi.fn(),
    createWorkspace: vi.fn(),
    closeProjectComposer: vi.fn(),
    closeWorkspaceComposer: vi.fn(),
    openProjectComposer: vi.fn(),
    openWorkspaceComposer: vi.fn(),
    refreshNavigator: vi.fn(),
    runSmokeTest: vi.fn(),
    openThread: vi.fn(),
    selectOrganization: vi.fn(),
    selectProject: vi.fn(),
    selectWorkspace: vi.fn(),
    setAuthEmail: vi.fn(function (value) {
      current.integration.authEmail = value;
      if (subscriber) subscriber(current);
    }),
    setProjectDraftName: vi.fn(function (value) {
      current.composer = current.composer || {};
      current.composer.projectName = value;
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
    setWorkspaceDraftName: vi.fn(function (value) {
      current.composer = current.composer || {};
      current.composer.workspaceName = value;
      if (subscriber) subscriber(current);
    }),
    setWorkspaceDraftPackageKey: vi.fn(function (value) {
      current.composer = current.composer || {};
      current.composer.workspacePackageKey = value;
      if (subscriber) subscriber(current);
    }),
    toggleOrganizationMenu: vi.fn(),
    toggleProjectExpanded: vi.fn(),
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
      workspaceComposerOpen: false,
      projectComposerOpen: false,
      searchTerm: '',
      workspaces: [],
      selectedWorkspace: null,
      selectedProject: null,
      organizations: [],
      selectedOrganization: null,
      preferredWorkspace: null,
      projectGroups: [],
      projectExpansion: {},
      packages: [],
      composer: {
        workspaceName: '',
        workspacePackageKey: '',
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
      },
      hasWorkspaces: false,
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
      workspaceComposerOpen: false,
      projectComposerOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      workspaces: [{ id: 'workspace-smoke', name: 'Smoke Workspace', packageKey: 'smoke' }],
      selectedWorkspace: { id: 'workspace-smoke', name: 'Smoke Workspace', packageKey: 'smoke' },
      selectedProject: { id: 'project-1', name: 'Smoke Project', workspaceId: 'workspace-smoke' },
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
      hasWorkspaces: true,
      canRunSmokeTest: true,
      activeProjectId: 'project-1',
      activeThreadId: 'thread-1',
      projectExpansion: {
        'project-1': true,
      },
      packages: [{ key: 'smoke', name: 'Smoke Workspace', version: '1.1.0' }],
      composer: {
        workspaceName: '',
        workspacePackageKey: 'smoke',
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
      },
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
    expect(document.querySelector('.ai-nav-tools').textContent).toContain('Projects');
    expect(document.querySelector('.ai-nav-action-primary').disabled).toBe(false);
    expect(document.querySelector('.ai-nav-action-grid').textContent).toContain('Run smoke test');
    expect(document.querySelector('.ai-nav-group-icon')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Create workspace');
    expect(document.querySelector('.ai-nav-thread-tree-row.active').textContent).toContain('Smoke Test 2026-04-14 20:11');
    expect(document.querySelector('.ai-nav-thread-tree-row .ai-nav-thread-row-time').textContent.length).toBeGreaterThan(0);
    expect(document.body.classList.contains('ai-mode-active')).toBe(true);
  });

  it('renders collapsible project rows with per-project new chat and header workspace switching', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      organizationMenuOpen: false,
      workspaceComposerOpen: false,
      projectComposerOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      workspaces: [
        { id: 'workspace-1', name: 'Finance', packageKey: 'generic' },
        { id: 'workspace-2', name: 'Smoke', packageKey: 'smoke' },
      ],
      selectedWorkspace: { id: 'workspace-1', name: 'Finance', packageKey: 'generic' },
      selectedProject: { id: 'project-1', name: 'Forecasting', workspaceId: 'workspace-1' },
      preferredWorkspace: { id: 'workspace-1', name: 'Finance', packageKey: 'generic' },
      projectGroups: [{
        project: {
          id: 'project-1',
          name: 'Forecasting',
          workspaceName: 'Finance',
        },
        threads: [{
          id: 'thread-1',
          title: 'Forecast review',
          lastActivityAt: '2026-04-15T10:00:00.000Z',
        }],
      }],
      projectExpansion: {
        'project-1': false,
      },
      packages: [],
      composer: {
        workspaceName: '',
        workspacePackageKey: 'generic',
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
      },
      hasWorkspaces: true,
      hasProjects: true,
      canRunSmokeTest: false,
      activeProjectId: 'project-1',
      activeThreadId: null,
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

    expect(document.body.textContent).not.toContain('Create workspace');
    expect(document.body.textContent).toContain('Create project');
    expect(document.body.textContent).toContain('Forecasting');
    expect(document.body.textContent).toContain('Expand');
    document.querySelector('.ai-nav-project-heading').click();
    expect(state.selectProject).toHaveBeenCalledWith('project-1', { expand: true });
    document.querySelector('.ai-nav-project-actions .ai-nav-action').click();
    expect(state.createThread).toHaveBeenCalledWith(null, { projectId: 'project-1' });
    document.querySelector('.ai-nav-org-switch').click();
    state.updateSnapshot(Object.assign({}, snapshot, { organizationMenuOpen: true }));
    document.querySelector('.ai-nav-org-item:last-child').click();
    expect(state.selectWorkspace).toHaveBeenCalledWith('workspace-2');
  });
});
