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
    closeProjectComposer: vi.fn(),
    closeThreadComposer: vi.fn(),
    openProjectComposer: vi.fn(),
    openThreadComposer: vi.fn(function () { return Promise.resolve(); }),
    closeWorkspaceFileBrowser: vi.fn(),
    deleteSelectedWorkspaceFile: vi.fn(function () { return Promise.resolve(); }),
    downloadSelectedWorkspaceEntry: vi.fn(function () { return Promise.resolve(); }),
    refreshWorkspaceFiles: vi.fn(function () { return Promise.resolve(); }),
    selectWorkspaceFile: vi.fn(function () { return Promise.resolve(); }),
    selectWorkspaceFolder: vi.fn(function () { return Promise.resolve(); }),
    toggleWorkspaceFileBrowser: vi.fn(function () { return Promise.resolve(); }),
    uploadWorkspaceFiles: vi.fn(function () { return Promise.resolve(); }),
    refreshNavigator: vi.fn(),
    runSmokeTest: vi.fn(),
    openThread: vi.fn(),
    selectOrganization: vi.fn(),
    selectProject: vi.fn(),
    selectWorkspace: vi.fn(),
    setThreadDraftName: vi.fn(function (value) {
      current.composer = current.composer || {};
      current.composer.threadTitle = value;
      if (subscriber) subscriber(current);
    }),
    setThreadDraftPersona: vi.fn(function (value) {
      current.composer = current.composer || {};
      current.composer.selectedPersonaKey = value;
      if (subscriber) subscriber(current);
    }),
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
    setThreadExpanded: vi.fn(function (threadId, expanded) {
      current.threadExpansion = current.threadExpansion || {};
      current.threadExpansion[threadId] = expanded !== false;
      if (subscriber) subscriber(current);
    }),
    setVerificationInput: vi.fn(function (value) {
      current.integration.verificationInput = value;
      if (subscriber) subscriber(current);
    }),
    submitThreadComposer: vi.fn(function () { return Promise.resolve(); }),
    toggleNavigatorCollapsed: vi.fn(),
    toggleProjectExpanded: vi.fn(),
    toggleThreadExpanded: vi.fn(),
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
    '<button id="apps-button"></button>',
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
      projectComposerOpen: false,
      threadComposerOpen: false,
      searchTerm: '',
      selectedWorkspace: null,
      selectedProject: null,
      organizations: [],
      selectedOrganization: null,
      projectGroups: [],
      projectExpansion: {},
      packages: [],
      composer: {
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
      },
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

  it('renders a Codex-style left rail with toolbar actions and dense thread rows', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      projectComposerOpen: false,
      threadComposerOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      selectedWorkspace: { id: 'workspace-smoke', name: 'Smoke Workspace', packageKey: 'smoke' },
      selectedProject: { id: 'project-1', name: 'Smoke Project', workspaceId: 'workspace-smoke' },
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
      projectExpansion: {
        'project-1': true,
      },
      packages: [{ key: 'smoke', name: 'Smoke Workspace', version: '1.1.0' }],
      composer: {
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
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

    expect(document.querySelector('.ai-nav-toolbar-title').textContent).toBe('Threads');
    expect(document.querySelector('.ai-nav-toolbar-subtitle').textContent).toContain('Org 1');
    expect(document.querySelector('.ai-nav-toolbar-subtitle').textContent).toContain('smoke');
    expect(document.querySelectorAll('.ai-nav-icon-button')).toHaveLength(3);
    expect(document.querySelector('.ai-nav-footer-link').textContent).toContain('Run smoke test');
    expect(document.querySelector('.ai-nav-settings-button')).not.toBeNull();
    expect(document.querySelector('.ai-nav-group-icon')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Create workspace');
    expect(document.querySelector('.ai-nav-project-trigger.active').textContent).toContain('Smoke Project');
    expect(document.querySelector('.ai-nav-project-thread-action')).not.toBeNull();
    expect(document.querySelector('.ai-nav-thread-tree-row.active').textContent).toContain('Smoke Test 2026-04-14 20:11');
    expect(document.querySelector('.ai-nav-thread-tree-row .ai-nav-thread-row-time').textContent.length).toBeGreaterThan(0);
    expect(document.body.classList.contains('ai-mode-active')).toBe(true);
  });

  it('renders child threads as nested clickable rows', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      projectComposerOpen: false,
      threadComposerOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      selectedWorkspace: { id: 'workspace-1', name: 'Workspace', packageKey: 'generic' },
      selectedProject: { id: 'project-1', name: 'Project', workspaceId: 'workspace-1' },
      projectGroups: [{
        project: {
          id: 'project-1',
          name: 'Project',
          workspaceName: 'Workspace',
        },
        threads: [
          { id: 'thread-parent', title: 'Coordinator', lastActivityAt: '2026-04-14T20:11:00.000Z' },
          { id: 'thread-child', parentThreadId: 'thread-parent', title: 'Finance delegate', lastActivityAt: '2026-04-14T20:12:00.000Z' },
        ],
        threadTree: [{
          id: 'thread-parent',
          title: 'Coordinator',
          lastActivityAt: '2026-04-14T20:11:00.000Z',
          childThreads: [{
            id: 'thread-child',
            parentThreadId: 'thread-parent',
            title: 'Finance delegate',
            lastActivityAt: '2026-04-14T20:12:00.000Z',
          }],
        }],
      }],
      hasProjects: true,
      canRunSmokeTest: false,
      activeProjectId: 'project-1',
      activeThreadId: 'thread-child',
      projectExpansion: {
        'project-1': true,
      },
      threadExpansion: {},
      packages: [],
      composer: {
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
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

    expect(document.querySelectorAll('.ai-nav-thread-tree-row')).toHaveLength(2);
    expect(document.querySelector('.ai-nav-thread-expander').getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.ai-nav-thread-item-row.child').getAttribute('data-parent-thread-id')).toBe('thread-parent');
    expect(document.querySelector('.ai-nav-thread-item-row.child .ai-nav-thread-tree-row').textContent).toContain('Finance delegate');

    document.querySelector('.ai-nav-thread-expander').click();
    expect(state.setThreadExpanded).toHaveBeenCalledWith('thread-parent', false);
    expect(document.querySelectorAll('.ai-nav-thread-tree-row')).toHaveLength(1);

    state.updateSnapshot(Object.assign({}, snapshot, {
      threadExpansion: {
        'thread-parent': true,
      },
    }));
    document.querySelector('.ai-nav-thread-item-row.child .ai-nav-thread-tree-row').click();
    expect(state.openThread).toHaveBeenCalledWith('thread-child');
  });

  it('keeps child threads collapsed until their parent is expanded', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      projectComposerOpen: false,
      threadComposerOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      selectedWorkspace: { id: 'workspace-1', name: 'Workspace', packageKey: 'generic' },
      selectedProject: { id: 'project-1', name: 'Project', workspaceId: 'workspace-1' },
      projectGroups: [{
        project: {
          id: 'project-1',
          name: 'Project',
          workspaceName: 'Workspace',
        },
        threads: [
          { id: 'thread-parent', title: 'Coordinator', lastActivityAt: '2026-04-14T20:11:00.000Z' },
          { id: 'thread-child', parentThreadId: 'thread-parent', title: 'Finance delegate', lastActivityAt: '2026-04-14T20:12:00.000Z' },
        ],
        threadTree: [{
          id: 'thread-parent',
          title: 'Coordinator',
          lastActivityAt: '2026-04-14T20:11:00.000Z',
          childThreads: [{
            id: 'thread-child',
            parentThreadId: 'thread-parent',
            title: 'Finance delegate',
            lastActivityAt: '2026-04-14T20:12:00.000Z',
          }],
        }],
      }],
      hasProjects: true,
      canRunSmokeTest: false,
      activeProjectId: 'project-1',
      activeThreadId: null,
      projectExpansion: {
        'project-1': true,
      },
      threadExpansion: {},
      packages: [],
      composer: {
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
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

    expect(document.querySelectorAll('.ai-nav-thread-tree-row')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Finance delegate');
    expect(document.querySelector('.ai-nav-thread-expander').getAttribute('aria-expanded')).toBe('false');

    state.updateSnapshot(Object.assign({}, snapshot, {
      threadExpansion: {
        'thread-parent': true,
      },
    }));

    expect(document.querySelectorAll('.ai-nav-thread-tree-row')).toHaveLength(2);
    expect(document.body.textContent).toContain('Finance delegate');
  });

  it('renders collapsible project rows with toolbar project actions', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      projectComposerOpen: false,
      threadComposerOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      selectedWorkspace: { id: 'workspace-1', name: 'Finance', packageKey: 'generic' },
      selectedProject: { id: 'project-1', name: 'Forecasting', workspaceId: 'workspace-1' },
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
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
      },
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
    expect(document.querySelector('[title="Create folder"]')).not.toBeNull();
    expect(document.querySelector('.ai-nav-project-thread-action')).not.toBeNull();
    expect(document.body.textContent).toContain('Forecasting');
    document.querySelector('.ai-nav-project-trigger').click();
    expect(state.selectProject).toHaveBeenCalledWith('project-1', { expand: true });
    document.querySelector('.ai-nav-project-thread-action').click();
    expect(state.openThreadComposer).toHaveBeenCalledWith({ projectId: 'project-1' });
    document.querySelector('[title="Create folder"]').click();
    expect(state.openProjectComposer).toHaveBeenCalled();
    expect(document.querySelector('.ai-nav-org-switcher')).toBeNull();
  });

  it('opens a right-side workspace file browser with tree rows and actions', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      projectComposerOpen: false,
      threadComposerOpen: false,
      searchTerm: '',
      fileBrowserOpen: true,
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      selectedWorkspace: { id: 'workspace-1', name: 'Finance', packageKey: 'generic' },
      selectedProject: { id: 'project-1', name: 'Forecasting', workspaceId: 'workspace-1' },
      projectGroups: [],
      projectExpansion: {},
      packages: [],
      workspaceFiles: [
        { id: 'file-1', relativePath: 'reports/april.csv', name: 'april.csv', sizeBytes: 42, contentType: 'text/csv' },
      ],
      workspaceFileBrowser: {
        loading: false,
        error: null,
        selectedType: 'file',
        selectedFileId: 'file-1',
        selectedFolderPath: 'reports',
        preview: { status: 'ready', text: 'a,b\\n1,2', contentType: 'text/csv' },
      },
      composer: {
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
      },
      hasProjects: false,
      canRunSmokeTest: false,
      activeProjectId: null,
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

    expect(document.querySelector('#workspace-file-browser')).not.toBeNull();
    expect(document.querySelector('.workspace-file-header-copy').textContent).toContain('Finance');
    expect(Array.from(document.querySelectorAll('.workspace-file-folder')).map(function (node) {
      return node.textContent;
    }).join(' ')).toContain('reports');
    expect(document.querySelector('.workspace-file-leaf.active').textContent).toContain('april.csv');
    expect(document.querySelector('.workspace-file-preview').textContent).toContain('a,b');

    document.querySelector('.workspace-file-leaf').click();
    expect(state.selectWorkspaceFile).toHaveBeenCalledWith('file-1');
    document.querySelector('.workspace-file-close').click();
    expect(state.closeWorkspaceFileBrowser).toHaveBeenCalled();
  });

  it('shows a compact show more control for long thread lists', function () {
    var snapshot = {
      navigatorVisible: true,
      navigatorCollapsed: false,
      loadingNavigator: false,
      projectComposerOpen: false,
      threadComposerOpen: false,
      searchTerm: '',
      organizations: [{ id: 'org-1', name: 'Org 1' }],
      selectedOrganization: { id: 'org-1', name: 'Org 1' },
      selectedWorkspace: { id: 'workspace-1', name: 'Ops', packageKey: 'generic' },
      selectedProject: { id: 'project-1', name: 'Ops', workspaceId: 'workspace-1' },
      projectGroups: [{
        project: {
          id: 'project-1',
          name: 'Ops',
          workspaceName: 'Ops',
        },
        threads: [1, 2, 3, 4, 5, 6].map(function (index) {
          return {
            id: 'thread-' + index,
            title: 'Thread ' + index,
            lastActivityAt: '2026-04-15T10:0' + (index % 6) + ':00.000Z',
          };
        }),
      }],
      projectExpansion: {
        'project-1': true,
      },
      packages: [],
      composer: {
        creatingWorkspace: false,
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
      },
      hasProjects: true,
      canRunSmokeTest: false,
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

    expect(document.querySelectorAll('.ai-nav-thread-tree-row')).toHaveLength(5);
    expect(document.querySelector('.ai-nav-show-more').textContent).toContain('Show more');

    document.querySelector('.ai-nav-show-more').click();

    expect(document.querySelectorAll('.ai-nav-thread-tree-row')).toHaveLength(6);
    expect(document.querySelector('.ai-nav-show-more').textContent).toContain('Show less');
  });
});
