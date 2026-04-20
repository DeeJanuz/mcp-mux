import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTribexAiState as loadState, loadTribexAiUtils as loadUtils } from './helpers/tribex-ai-state-loader.js';

beforeEach(function () {
  delete window.__tribexAiUtils;
  delete window.__tribexAiState;

  window.__companionUtils = {
    openSession: vi.fn(function () { return 'session-1'; }),
    replaceSession: vi.fn(function () { return 'session-1'; }),
    getSession: vi.fn(function () { return null; }),
    updateSessionMetadata: vi.fn(),
    syncThreadArtifactDrawer: vi.fn(function (payload) { return payload && payload.drawerId ? payload.drawerId : 'drawer-1'; }),
    selectThreadArtifact: vi.fn(),
    selectSession: vi.fn(),
    setThreadArtifactContext: vi.fn(),
    refreshActiveSession: vi.fn(),
    rerenderActiveSession: vi.fn(),
  };

  loadUtils();
});

afterEach(function () {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe('tribex-ai-state', function () {
  it('bootstraps a default project before creating the first thread', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([]);
      }),
      createProject: vi.fn(function () {
        return Promise.resolve({
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        });
      }),
      createThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
        });
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    await window.__tribexAiState.createThread();

    expect(client.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-1' }),
      'General',
    );
    expect(client.createThread).toHaveBeenCalledWith('project-1', 'New chat', 'general');
    expect(window.__companionUtils.openSession).toHaveBeenCalled();
  });

  it('renames a project and updates project context for its threads', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', organizationId: 'org-1', title: 'Existing chat', projectName: 'General' },
        ]);
      }),
      renameProject: vi.fn(function () {
        return Promise.resolve({
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'Forecasting',
          workspaceName: 'Workspace 1',
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    await window.__tribexAiState.openProjectRename('project-1');
    window.__tribexAiState.setProjectRenameName('Forecasting');
    await window.__tribexAiState.renameProject();

    expect(client.renameProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-1' }),
      'project-1',
      'Forecasting',
    );

    expect(window.__tribexAiState.getSnapshot().selectedProject).toMatchObject({
      id: 'project-1',
      name: 'Forecasting',
    });
    expect(window.__tribexAiState.getThreadContext('thread-1').project).toMatchObject({
      id: 'project-1',
      name: 'Forecasting',
    });
  });

  it('renames a thread and updates the thread context title', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', organizationId: 'org-1', title: 'Existing chat', projectName: 'General', workspaceName: 'Workspace 1' },
        ]);
      }),
      renameThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          organizationId: 'org-1',
          title: 'Renamed chat',
          projectName: 'General',
          workspaceName: 'Workspace 1',
          messages: [],
        });
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          organizationId: 'org-1',
          title: 'Existing chat',
          projectName: 'General',
          workspaceName: 'Workspace 1',
          messages: [],
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    window.__tribexAiState.setActiveSession('session-1', {
      meta: {
        aiView: 'thread',
        projectId: 'project-1',
        threadId: 'thread-1',
      },
    });
    await window.__tribexAiState.openThreadRename('thread-1');
    window.__tribexAiState.setThreadRenameTitle('Renamed chat');
    await window.__tribexAiState.renameThread();

    expect(client.renameThread).toHaveBeenCalledWith('thread-1', 'Renamed chat');
    expect(window.__tribexAiState.getThreadContext('thread-1').thread).toMatchObject({
      id: 'thread-1',
      title: 'Renamed chat',
    });
    expect(window.__companionUtils.replaceSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        sessionKey: 'tribex-ai-thread-thread-1',
        data: expect.objectContaining({
          title: 'Renamed chat',
        }),
        meta: expect.objectContaining({
          headerTitle: 'Renamed chat',
          threadId: 'thread-1',
        }),
      }),
      undefined,
    );
  });

  it('drops stale workspaces from the active organization during navigator refresh', async function () {
    var fetchWorkspaces = vi.fn()
      .mockResolvedValueOnce([
        { id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' },
      ])
      .mockResolvedValueOnce([
        { id: 'workspace-2', organizationId: 'org-1', name: 'Workspace 2', packageKey: 'generic' },
      ]);
    var fetchProjects = vi.fn(function (workspace) {
      return Promise.resolve([{
        id: 'project-' + workspace.id,
        organizationId: 'org-1',
        workspaceId: workspace.id,
        name: 'General',
        workspaceName: workspace.name,
      }]);
    });
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: fetchWorkspaces,
      fetchProjects: fetchProjects,
      fetchThreads: vi.fn(function () {
        return Promise.resolve([]);
      }),
      createProject: vi.fn(function (workspace) {
        return Promise.resolve({
          id: 'created-project',
          organizationId: 'org-1',
          workspaceId: workspace.id,
          name: 'Created',
          workspaceName: workspace.name,
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    expect(window.__tribexAiState.getSnapshot().selectedWorkspace).toMatchObject({
      id: 'workspace-1',
    });

    await window.__tribexAiState.refreshNavigator(true);

    expect(window.__tribexAiState.getSnapshot().selectedWorkspace).toMatchObject({
      id: 'workspace-2',
    });

    await window.__tribexAiState.createProject();

    expect(client.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-2' }),
      'General',
    );
  });

  it('tears down the previous thread resources before reusing the thread session for a new chat', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'Smoke Test' },
          { id: 'thread-2', projectId: 'project-1', workspaceId: 'workspace-1', title: 'New chat' },
        ]);
      }),
      fetchThread: vi.fn(function (threadId) {
        return Promise.resolve({
          id: threadId,
          title: threadId === 'thread-1' ? 'Smoke Test' : 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    window.__tribexAiState.setActiveSession('session-1', {
      meta: {
        aiView: 'thread',
        projectId: 'project-1',
        threadId: 'thread-1',
      },
    });

    window.__tribexAiState.openThread('thread-2', { connectStream: false });

    expect(client.stopCompanionStream).toHaveBeenCalledWith('thread-1');
    expect(client.stopDesktopRelayStream).toHaveBeenCalledWith('thread-1');
    expect(client.stopDesktopPresenceHeartbeat).toHaveBeenCalledWith('thread-1');
    expect(window.__companionUtils.replaceSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        sessionKey: 'tribex-ai-thread-thread-2',
        meta: expect.objectContaining({
          threadId: 'thread-2',
        }),
      }),
      undefined,
    );
  });

  it('opens an existing thread from a summary-only record without crashing the active session rerender', async function () {
    var fetchThreadResolve;
    var fetchThreadPromise = new Promise(function (resolve) {
      fetchThreadResolve = resolve;
    });
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'Existing chat' },
        ]);
      }),
      fetchThread: vi.fn(function () {
        return fetchThreadPromise;
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);

    expect(function () {
      window.__tribexAiState.openThread('thread-1', { connectStream: false });
    }).not.toThrow();
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        toolArgs: expect.objectContaining({
          threadId: 'thread-1',
        }),
      }),
      undefined,
    );

    var pendingContext = window.__tribexAiState.getThreadContext('thread-1');
    expect(pendingContext.thread).toMatchObject({
      id: 'thread-1',
      title: 'Existing chat',
    });
    expect(pendingContext.loading).toBe(true);

    fetchThreadResolve({
      id: 'thread-1',
      title: 'Existing chat',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: 'Hydrated',
          createdAt: '2026-04-16T20:00:00.000Z',
        },
      ],
    });
    await fetchThreadPromise;
    await Promise.resolve();
    await Promise.resolve();

    var hydratedContext = window.__tribexAiState.getThreadContext('thread-1');
    expect(hydratedContext.loading).toBe(false);
    expect(hydratedContext.thread.messages).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Hydrated',
      }),
    ]);
  });

  it('loads personas for a project with an active summary-only thread session', async function () {
    var fetchThreadResolve;
    var fetchThreadPromise = new Promise(function (resolve) {
      fetchThreadResolve = resolve;
    });
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'Existing chat' },
        ]);
      }),
      fetchThread: vi.fn(function () {
        return fetchThreadPromise;
      }),
      fetchProjectThreadPersonas: vi.fn(function () {
        return Promise.resolve([
          {
            id: 'persona-1',
            key: 'general',
            displayName: 'General',
          },
        ]);
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await window.__tribexAiState.openThreadComposer({ projectId: 'project-1' });

    var snapshot = window.__tribexAiState.getSnapshot();
    expect(client.fetchProjectThreadPersonas).toHaveBeenCalledWith('project-1');
    expect(snapshot.threadComposerOpen).toBe(true);
    expect(snapshot.composer.loadingThreadPersonas).toBe(false);
    expect(snapshot.composer.selectedPersonaKey).toBe('general');

    fetchThreadResolve({
      id: 'thread-1',
      title: 'Existing chat',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      messages: [],
    });
  });

  it('runs the smoke flow end-to-end for smoke workspaces and tracks relay state', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));

    var relayHandler = null;
    var presenceHandler = null;
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-smoke', organizationId: 'org-1', name: 'Smoke Workspace', packageKey: 'smoke' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-smoke',
          organizationId: 'org-1',
          workspaceId: 'workspace-smoke',
          name: 'Validation',
          workspaceName: 'Smoke Workspace',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([]);
      }),
      createProject: vi.fn(),
      createThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-smoke-1',
          title: 'Smoke Test 2026-04-14 12:00',
        });
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-smoke-1',
          title: 'Smoke Test 2026-04-14 12:00',
          projectId: 'project-smoke',
          workspaceId: 'workspace-smoke',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-smoke-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      buildSmokePrompt: vi.fn(function (smokeKey) {
        return 'Please verify that the currently loaded rule and skill bundle is wired correctly for this workspace. Use the available validation tool to confirm the exact loaded rule and skill basenames, then summarize the result briefly for the operator.';
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        var prompt = client.buildSmokePrompt.mock.results[0] && client.buildSmokePrompt.mock.results[0].value;
        return Promise.resolve({
          thread: {
            id: 'thread-smoke-1',
            projectId: 'project-smoke',
            workspaceId: 'workspace-smoke',
            messages: prompt ? [{ id: 'message-smoke-1', role: 'user', content: prompt }] : [],
          },
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function (handler) {
        relayHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function (handler) {
        presenceHandler = handler;
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
      shouldPreviewCompanionPayload: function (value) {
        return value && value.toolName === 'rich_content';
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    var smokePromise = window.__tribexAiState.runSmokeTest();
    await vi.runAllTimersAsync();
    await smokePromise;

    expect(client.createThread).toHaveBeenCalledWith(
      'project-smoke',
      'Smoke Test 2026-04-14 12:00',
      'general',
    );
    expect(client.createCompanionSession).not.toHaveBeenCalled();
    expect(client.registerDesktopRelay).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-smoke',
      threadId: 'thread-smoke-1',
    }));
    expect(client.startDesktopRelayStream).toHaveBeenCalledWith(
      'thread-smoke-1',
      '/api/desktop-relay/stream',
      { threadId: 'thread-smoke-1' },
    );
    expect(client.startDesktopPresenceHeartbeat).toHaveBeenCalledWith(
      'thread-smoke-1',
      30,
      expect.objectContaining({
        relaySessionId: 'relay-session-1',
        status: 'ONLINE',
      }),
      '/api/desktop-relay/presence',
    );
    expect(client.buildSmokePrompt).toHaveBeenCalledWith('rule-skill-echo');
    expect(client.sendMessage).toHaveBeenCalledWith(
      'thread-smoke-1',
      client.buildSmokePrompt.mock.results[0].value,
      expect.objectContaining({ validationProfile: 'rule-skill-echo' }),
    );
    expect(window.__companionUtils.openSession).toHaveBeenCalled();

    relayHandler({ relayId: 'thread-smoke-1', type: 'status', status: 'connected' });
    presenceHandler({ heartbeatId: 'thread-smoke-1', type: 'status', status: 'running' });

    expect(window.__tribexAiState.getThreadContext('thread-smoke-1').relayStatus).toBe('online');

    relayHandler({ relayId: 'thread-smoke-1', type: 'error', message: 'relay failed' });
    expect(window.__tribexAiState.getThreadContext('thread-smoke-1').relayStatus).toBe('error');
  });

  it('ensures the desktop relay for normal thread prompts before sending the message', async function () {
    vi.useFakeTimers();
    var relayHandler = null;
    var presenceHandler = null;
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          thread: {
            id: 'thread-1',
            projectId: 'project-1',
            workspaceId: 'workspace-1',
            messages: [],
          },
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function (handler) {
        relayHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function (handler) {
        presenceHandler = handler;
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();
    var submitPromise = window.__tribexAiState.submitPrompt('thread-1', 'Push a sample architecture document.');
    await vi.runAllTimersAsync();
    await submitPromise;

    expect(client.registerDesktopRelay).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      threadId: 'thread-1',
    }));
    expect(client.startDesktopRelayStream).toHaveBeenCalledWith(
      'thread-1',
      '/api/desktop-relay/stream',
      { threadId: 'thread-1' },
    );
    expect(client.startDesktopPresenceHeartbeat).toHaveBeenCalledWith(
      'thread-1',
      30,
      expect.objectContaining({
        relaySessionId: 'relay-session-1',
        status: 'ONLINE',
      }),
      '/api/desktop-relay/presence',
    );
    expect(client.sendMessage).toHaveBeenCalledWith(
      'thread-1',
      'Push a sample architecture document.',
      expect.objectContaining({
        turnId: expect.any(String),
      }),
    );

    relayHandler({ relayId: 'thread-1', type: 'status', status: 'connected' });
    presenceHandler({ heartbeatId: 'thread-1', type: 'status', status: 'running' });
    expect(window.__tribexAiState.getThreadContext('thread-1').relayStatus).toBe('online');
  });

  it('prefers realtime relay sessions and refreshes on realtime auth expiry', async function () {
    vi.useFakeTimers();
    var relayHandler = null;
    var realtime = {
      streamUrl: 'https://runtime.example.com/__realtime/relay/relay-session-rt/stream',
      responseUrl: 'https://runtime.example.com/__realtime/relay/relay-session-rt/response',
      token: 'realtime-token',
      tokenExpiresAt: 2000000000,
    };
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-rt',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Realtime chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-rt',
          title: 'Realtime chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      ensureRuntimeSession: vi.fn(function () {
        return Promise.resolve({
          relay: {
            session: { id: 'relay-session-rt', deviceId: 'device-rt' },
            bridge: { relaySessionId: 'relay-session-rt' },
            realtime: realtime,
          },
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({ relaySession: { id: 'legacy-relay' } });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startRealtimeRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          thread: {
            id: 'thread-rt',
            projectId: 'project-1',
            workspaceId: 'workspace-1',
            messages: [],
          },
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function (handler) {
        relayHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-rt');
    await vi.runAllTimersAsync();
    var submitPromise = window.__tribexAiState.submitPrompt('thread-rt', 'Use realtime relay.');
    await vi.runAllTimersAsync();
    await submitPromise;

    expect(client.ensureRuntimeSession).toHaveBeenCalledWith('thread-rt', {
      forceRefresh: false,
    });
    expect(client.startRealtimeRelayStream).toHaveBeenCalledWith(
      'thread-rt',
      'relay-session-rt',
      realtime,
    );
    expect(client.registerDesktopRelay).not.toHaveBeenCalled();
    expect(client.startDesktopRelayStream).not.toHaveBeenCalled();
    expect(client.startDesktopPresenceHeartbeat).not.toHaveBeenCalled();

    relayHandler({
      relayId: 'thread-rt',
      type: 'data',
      mode: 'realtime',
      payload: {
        type: 'relay.connected',
        relaySessionId: 'relay-session-rt',
      },
    });
    expect(window.__tribexAiState.getThreadContext('thread-rt').relayStatus).toBe('online');

    relayHandler({
      relayId: 'thread-rt',
      type: 'auth_expired',
      mode: 'realtime',
      message: 'Realtime relay token expired.',
    });
    await vi.runAllTimersAsync();
    expect(client.ensureRuntimeSession).toHaveBeenLastCalledWith('thread-rt', {
      forceRefresh: true,
    });
    expect(client.startRealtimeRelayStream).toHaveBeenCalledTimes(2);
  });

  it('clears the busy indicator when a prompt send times out', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.reject(new Error('Runtime connection timed out.'));
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    var submitted = await window.__tribexAiState.submitPrompt('thread-1', 'This will time out');
    var threadContext = window.__tribexAiState.getThreadContext('thread-1');

    expect(submitted).toBe(false);
    expect(threadContext.pending).toBe(false);
    expect(threadContext.error).toBe('Runtime connection timed out.');
    expect(threadContext.thread.activeTurn.status).toBe('failed');
    expect(window.__companionUtils.updateSessionMetadata).toHaveBeenLastCalledWith('session-1', {
      busyIndicator: null,
    });
  });

  it('interrupts an active prompt and unlocks the thread without leaving the pulse running', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      disconnectRuntime: vi.fn(),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          turnId: 'turn-1',
          done: new Promise(function () {}),
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    await window.__tribexAiState.submitPrompt('thread-1', 'Keep working');
    expect(window.__tribexAiState.getThreadContext('thread-1').pending).toBe(true);

    await window.__tribexAiState.interruptThread('thread-1');
    var threadContext = window.__tribexAiState.getThreadContext('thread-1');

    expect(client.disconnectRuntime).toHaveBeenCalledWith('thread-1');
    expect(threadContext.pending).toBe(false);
    expect(threadContext.error).toBeNull();
    expect(threadContext.thread.activeTurn.status).toBe('failed');
    expect(window.__companionUtils.updateSessionMetadata).toHaveBeenLastCalledWith('session-1', {
      busyIndicator: null,
    });
  });

  it('ignores stale stopped-turn failures after a newer turn starts', async function () {
    var doneRejectsByTurnId = {};
    var submittedTurnIds = [];
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      disconnectRuntime: vi.fn(),
      sendMessage: vi.fn(function (_threadId, _prompt, options) {
        var turnId = options && options.turnId ? options.turnId : 'turn-' + (submittedTurnIds.length + 1);
        submittedTurnIds.push(turnId);
        return Promise.resolve({
          turnId: turnId,
          done: new Promise(function (_resolve, reject) {
            doneRejectsByTurnId[turnId] = reject;
          }),
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    await window.__tribexAiState.submitPrompt('thread-1', 'First turn');
    var stoppedTurnId = submittedTurnIds[0];
    await window.__tribexAiState.interruptThread('thread-1');
    await window.__tribexAiState.submitPrompt('thread-1', 'Second turn');
    var activeTurnId = submittedTurnIds[1];

    doneRejectsByTurnId[stoppedTurnId](new Error('Connection closed'));
    await Promise.resolve();
    await Promise.resolve();

    var threadContext = window.__tribexAiState.getThreadContext('thread-1');
    expect(threadContext.pending).toBe(true);
    expect(threadContext.error).toBeNull();
    expect(threadContext.thread.activeTurn).toMatchObject({
      turnId: activeTurnId,
      status: 'queued',
    });
    expect(threadContext.thread.activeTurn.userMessage.pending).toBe(true);
  });

  it('adds busy prompts as queued context without replacing the active turn', async function () {
    var submitted = [];
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      disconnectRuntime: vi.fn(),
      sendMessage: vi.fn(function (_threadId, prompt, options) {
        submitted.push({ prompt: prompt, options: options || {} });
        if (options && options.waitForStable === false) {
          return Promise.resolve({
            turnId: options.turnId,
            messageId: options.messageId,
            queued: true,
          });
        }
        return Promise.resolve({
          turnId: options && options.turnId ? options.turnId : 'turn-1',
          done: new Promise(function () {}),
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    await window.__tribexAiState.submitPrompt('thread-1', 'Start the report');
    var activeTurnId = submitted[0].options.turnId;
    await window.__tribexAiState.submitPrompt('thread-1', 'Use the newer revenue number.');
    await Promise.resolve();

    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toMatchObject({
      prompt: 'Use the newer revenue number.',
      options: {
        waitForStable: false,
        messageId: expect.any(String),
      },
    });
    expect(submitted[1].options.messageId).toBeTruthy();

    var threadContext = window.__tribexAiState.getThreadContext('thread-1');
    expect(threadContext.thread.activeTurn).toMatchObject({
      turnId: activeTurnId,
      status: 'queued',
      userMessage: expect.objectContaining({
        content: 'Start the report',
      }),
    });
    expect(threadContext.thread.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Start the report' }),
      expect.objectContaining({ content: 'Use the newer revenue number.' }),
    ]));
    expect(threadContext.pending).toBe(true);
  });

  it('turns local desktop relay tool requests into inline structured-data results instead of reopenable artifacts', async function () {
    vi.useFakeTimers();
    var relayHandler = null;
    window.__renderers = {
      structured_data: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'temp',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'temp',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          turnId: 'turn-runtime-1',
          done: new Promise(function () {}),
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function (handler) {
        relayHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) {
        return {
          id: value.id || 'tool-1',
          role: 'tool',
          toolName: value.toolName,
          status: value.status || 'completed',
          summary: value.toolName,
          detail: value.detail || '',
          resultData: value.result && value.result.data ? value.result.data : null,
          resultMeta: value.result && value.result.meta ? value.result.meta : null,
          toolArgs: value.toolArgs || null,
          resultContentType: value.toolName,
          createdAt: value.createdAt || null,
        };
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await vi.runAllTimersAsync();
    window.__companionUtils.openSession.mockClear();
    await window.__tribexAiState.submitPrompt('thread-1', 'Push an example finance review table.');

    relayHandler({
      relayId: 'thread-1',
      type: 'data',
      payload: {
        type: 'relay.tool.request.local',
        threadId: 'thread-1',
        requestId: 'req-1',
        toolName: 'structured_data',
        arguments: {
          title: 'Finance Review',
          tables: [{
            id: 'finance-review',
            name: 'Finance Review',
            columns: [
              { id: 'field', name: 'Field' },
              { id: 'value', name: 'Value' },
              { id: 'status', name: 'Status' },
            ],
            rows: [
              { id: 'row-1', field: 'Revenue', value: '$120,000', status: 'Pending Review' },
              { id: 'row-2', field: 'Expenses', value: '$45,000', status: 'Pending Review' },
            ],
          }],
          toolArgs: {
            threadId: 'thread-1',
          },
        },
        createdAt: '2026-04-16T17:38:30.000Z',
      },
    });

    relayHandler({
      relayId: 'thread-1',
      type: 'data',
      payload: {
        type: 'relay.tool.response.local',
        threadId: 'thread-1',
        requestId: 'req-1',
        toolName: 'structured_data',
        success: true,
        arguments: {
          title: 'Finance Review',
          tables: [{
            id: 'finance-review',
            name: 'Finance Review',
            columns: [
              { id: 'field', name: 'Field' },
              { id: 'value', name: 'Value' },
              { id: 'status', name: 'Status' },
            ],
            rows: [
              { id: 'row-1', field: 'Revenue', value: '$120,000', status: 'Pending Review' },
              { id: 'row-2', field: 'Expenses', value: '$45,000', status: 'Pending Review' },
            ],
          }],
          toolArgs: {
            threadId: 'thread-1',
          },
        },
        result: {
          content: [{
            type: 'text',
            text: '{"session_id":"preview-1","status":"stored"}',
          }],
        },
        createdAt: '2026-04-16T17:38:31.000Z',
      },
    });

    var thread = window.__tribexAiState.getThreadContext('thread-1').thread;
    expect(thread.runs).toHaveLength(1);
    expect(thread.runs[0].user.content).toBe('Push an example finance review table.');
    expect(thread.runs[0].workSession).toBeNull();
    expect(thread.runs[0].answer.inlineResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'structured_data',
          inlineDisplay: true,
          status: 'completed',
        }),
      ]),
    );
    expect(thread.artifacts).toEqual([]);
    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('routes thread-scoped rich_content companion payloads into inline transcript results instead of artifact tabs', async function () {
    var streamHandler = null;
    var fetchMock = vi.fn(function () {
      return Promise.resolve({ ok: true });
    });
    globalThis.fetch = fetchMock;
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'smoke' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Smoke Test',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Smoke Test',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messagesSource: 'runtime',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Push a sample architecture document.',
              createdAt: '2026-04-15T10:40:00.000Z',
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'Working on it.',
              createdAt: '2026-04-15T10:40:01.000Z',
            },
          ],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(),
      listenToStreamEvents: vi.fn(function (handler) {
        streamHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) {
        return {
          id: value.toolName || 'tool-1',
          role: 'tool',
          toolName: value.toolName,
          status: 'success',
          summary: value.result && value.result.data ? value.result.data.title : 'Inline artifact',
          detail: value.result && value.result.data ? value.result.data.body : '',
          resultData: value.result && value.result.data ? value.result.data : null,
          resultMeta: value.result ? value.result.meta || null : null,
          toolArgs: value.toolArgs || null,
          createdAt: null,
        };
      },
      shouldPreviewCompanionPayload: function (value) {
        return !!(value && value.toolName === 'rich_content');
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    window.__companionUtils.openSession.mockClear();
    window.__companionUtils.openSession.mockClear();

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        toolName: 'rich_content',
        toolArgs: {
          threadId: 'thread-1',
        },
        result: {
          data: {
            title: 'Smoke Test Passed',
            body: 'Runtime: `ai-sdk-runner`',
          },
        },
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Push a sample architecture document.' }),
        expect.objectContaining({ role: 'assistant', content: 'Working on it.' }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          toolName: 'rich_content',
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.runs[0].workSession).toBeNull();
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.runs[0].answer.inlineResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'rich_content',
          inlineDisplay: true,
          contentType: 'rich_content',
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual([]);
  });

  it('keeps runtime rich_content activity updates inline instead of opening artifact tabs', async function () {
    var runtimeHandler = null;
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Architecture thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Architecture thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messagesSource: 'runtime',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Push a sample architecture document.',
              createdAt: '2026-04-15T10:40:00.000Z',
            },
          ],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToRuntimeEvents: vi.fn(function (_threadId, handler) {
        runtimeHandler = handler;
        return function () {};
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    window.__companionUtils.openSession.mockClear();

    runtimeHandler({
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 2,
      createdAt: '2026-04-15T10:41:00.000Z',
      message: {
        id: 'user-2',
        role: 'user',
        content: 'Push a sample architecture document.',
        createdAt: '2026-04-15T10:41:00.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-1',
        toolCallId: 'tool-push-1',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'completed',
        detail: 'Prepared Rich Content result: Example Architecture Document.',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Example Architecture Document',
          body: 'This is a sample architecture document.',
        },
        resultMeta: {
          source: 'runtime-test',
        },
        createdAt: '2026-04-15T10:41:01.000Z',
        updatedAt: '2026-04-15T10:41:01.000Z',
      },
    });

    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();

    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'rich_content',
          resultContentType: 'rich_content',
          inlineDisplay: true,
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
          resultContentType: 'rich_content',
          inlineDisplay: true,
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual([]);
  });

  it('reopens legacy message-backed renderer artifacts for older threads', async function () {
    window.__renderers = {
      structured_data: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Legacy artifact thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Legacy artifact thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [
            {
              id: 'legacy-artifact-1',
              role: 'tool',
              toolName: 'structured_data',
              status: 'success',
              displayMode: 'artifact',
              artifactKey: 'tribex-ai-result:thread-1:legacy:artifact-0',
              resultContentType: 'structured_data',
              resultData: {
                title: 'Expense Review',
                tables: [{
                  id: 'table-1',
                  name: 'Expenses',
                  rows: [],
                }],
              },
              createdAt: '2026-04-15T11:00:00.000Z',
            },
          ],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    window.__companionUtils.openSession.mockClear();

    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKey: 'tribex-ai-result:thread-1:legacy:artifact-0',
          contentType: 'structured_data',
        }),
      ]),
    );

    window.__tribexAiState.openThreadArtifact('thread-1', 'tribex-ai-result:thread-1:legacy:artifact-0');
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'tribex-ai-artifact:thread-1:tribex-ai-result:thread-1:legacy:artifact-0',
        contentType: 'structured_data',
        data: expect.objectContaining({
          title: 'Expense Review',
        }),
        meta: expect.objectContaining({
          threadId: 'thread-1',
          artifactKey: 'tribex-ai-result:thread-1:legacy:artifact-0',
        }),
      }),
      expect.objectContaining({
        autoFocus: true,
      }),
    );
  });

  it('keeps multiple inline rich-content results distinct inside the same thread turn', async function () {
    var runtimeHandler = null;
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Architecture thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Architecture thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messagesSource: 'runtime',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToRuntimeEvents: vi.fn(function (_threadId, handler) {
        runtimeHandler = handler;
        return function () {};
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    window.__companionUtils.openSession.mockClear();

    runtimeHandler({
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 1,
      createdAt: '2026-04-15T10:41:00.000Z',
      message: {
        id: 'user-1',
        role: 'user',
        content: 'Create artifacts.',
        createdAt: '2026-04-15T10:41:00.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-1',
        toolCallId: 'tool-push-1',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'completed',
        detail: 'Prepared first result.',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Architecture Overview',
          body: 'First result.',
        },
        createdAt: '2026-04-15T10:41:01.000Z',
        updatedAt: '2026-04-15T10:41:01.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-2',
        toolCallId: 'tool-push-2',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'completed',
        detail: 'Prepared second result.',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Deployment Diagram',
          body: 'Second result.',
        },
        createdAt: '2026-04-15T10:41:02.000Z',
        updatedAt: '2026-04-15T10:41:02.000Z',
      },
    });

    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual([]);
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tool-push-1', inlineDisplay: true, resultData: expect.objectContaining({ title: 'Architecture Overview' }) }),
        expect.objectContaining({ id: 'tool-push-2', inlineDisplay: true, resultData: expect.objectContaining({ title: 'Deployment Diagram' }) }),
      ]),
    );
  });

  it('preserves a completed inline runtime result after the follow-up runtime snapshot', async function () {
    var runtimeHandler = null;
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Architecture thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Architecture thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messagesSource: 'runtime',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToRuntimeEvents: vi.fn(function (_threadId, handler) {
        runtimeHandler = handler;
        return function () {};
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    window.__companionUtils.openSession.mockClear();

    runtimeHandler({
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 1,
      createdAt: '2026-04-15T10:41:00.000Z',
      message: {
        id: 'user-1',
        role: 'user',
        content: 'Open the architecture note.',
        createdAt: '2026-04-15T10:41:00.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-1',
        toolCallId: 'tool-push-1',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'completed',
        detail: 'Prepared Rich Content result: Runtime Architecture.',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Runtime Architecture',
          body: 'Artifact body.',
        },
        resultMeta: {
          source: 'runtime-test',
        },
        createdAt: '2026-04-15T10:41:01.000Z',
        updatedAt: '2026-04-15T10:41:01.000Z',
      },
    });
    runtimeHandler({
      type: 'assistant_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-15T10:41:02.000Z',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Opened it.',
        createdAt: '2026-04-15T10:41:02.000Z',
      },
    });
    runtimeHandler({
      type: 'runtime_snapshot',
      messages: [
        {
          id: 'runtime-user-1',
          role: 'user',
          createdAt: '2026-04-15T10:41:00.000Z',
          parts: [
            {
              type: 'text',
              text: 'Open the architecture note.',
            },
          ],
        },
        {
          id: 'runtime-assistant-1',
          role: 'assistant',
          createdAt: '2026-04-15T10:41:02.000Z',
          parts: [
            {
              type: 'text',
              text: 'Opened it.',
            },
            {
              type: 'tool-rich_content',
              toolCallId: 'tool-push-1',
              toolName: 'rich_content',
              title: 'Rich Content',
              state: 'output-available',
            },
          ],
        },
      ],
    });

    var thread = window.__tribexAiState.getThreadContext('thread-1').thread;
    expect(thread.artifacts).toEqual([]);
    expect(thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
          inlineDisplay: true,
          resultData: expect.objectContaining({
            title: 'Runtime Architecture',
          }),
        }),
      ]),
    );
  });

  it('does not open an artifact tab for failed runtime rich_content activity', async function () {
    var runtimeHandler = null;
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Architecture thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Architecture thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messagesSource: 'runtime',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToRuntimeEvents: vi.fn(function (_threadId, handler) {
        runtimeHandler = handler;
        return function () {};
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    window.__companionUtils.openSession.mockClear();

    runtimeHandler({
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 1,
      createdAt: '2026-04-15T10:41:00.000Z',
      message: {
        id: 'user-1',
        role: 'user',
        content: 'Push a sample architecture document.',
        createdAt: '2026-04-15T10:41:00.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-1',
        toolCallId: 'tool-push-1',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'failed',
        detail: 'Missing required parameter: tool_name',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Example Architecture Document',
          body: 'This should not open on failure.',
        },
        createdAt: '2026-04-15T10:41:01.000Z',
        updatedAt: '2026-04-15T10:41:02.000Z',
      },
    });

    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'rich_content',
          status: 'failed',
        }),
      ]),
    );
  });

  it('keeps the completed work-session duration pinned to the completed work snapshot', async function () {
    var runtimeHandler = null;

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Architecture thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Architecture thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messagesSource: 'runtime',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToRuntimeEvents: vi.fn(function (_threadId, handler) {
        runtimeHandler = handler;
        return function () {};
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();

    runtimeHandler({
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 1,
      createdAt: '2026-04-15T10:41:00.000Z',
      message: {
        id: 'user-1',
        role: 'user',
        content: 'Push a sample architecture document.',
        createdAt: '2026-04-15T10:41:00.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-1',
        toolCallId: 'tool-push-1',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'completed',
        detail: 'Prepared Rich Content result: Example Architecture Document.',
        createdAt: '2026-04-15T10:41:01.000Z',
        updatedAt: '2026-04-15T10:41:16.000Z',
        completedAt: '2026-04-15T10:41:16.000Z',
      },
    });
    runtimeHandler({
      type: 'assistant_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-15T10:42:00.000Z',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done.',
        createdAt: '2026-04-15T10:42:00.000Z',
      },
    });
    runtimeHandler({
      type: 'turn_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-15T10:42:29.000Z',
    });

    expect(window.__tribexAiState.getThreadContext('thread-1').thread.runs[0].workSession).toMatchObject({
      status: 'completed',
      startedAt: '2026-04-15T10:41:01.000Z',
      endedAt: '2026-04-15T10:41:16.000Z',
    });
  });

  it('preserves thread metadata when runtime updates omit project and workspace ids', async function () {
    vi.useFakeTimers();

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Follow up',
              createdAt: '2026-04-15T19:00:00.000Z',
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'Runtime reply',
              createdAt: '2026-04-15T19:00:01.000Z',
            },
          ],
          preview: 'Runtime reply',
          lastActivityAt: '2026-04-15T19:00:01.000Z',
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();
    await window.__tribexAiState.submitPrompt('thread-1', 'Follow up');

    expect(window.__tribexAiState.getThreadsForProject('project-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          preview: 'Runtime reply',
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread).toMatchObject({
      id: 'thread-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'Follow up',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Runtime reply',
        }),
      ],
    });

    vi.useRealTimers();
  });

  it('preserves a newer optimistic thread state when a stale runtime transcript arrives', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T19:30:00.000Z'));

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          messages: [
            {
              id: 'user-old-1',
              role: 'user',
              content: 'older message',
              createdAt: '2026-04-15T19:20:00.000Z',
            },
            {
              id: 'assistant-old-1',
              role: 'assistant',
              content: 'older reply',
              createdAt: '2026-04-15T19:20:01.000Z',
            },
          ],
          preview: 'older reply',
          lastActivityAt: '2026-04-15T19:20:01.000Z',
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();
    await window.__tribexAiState.submitPrompt('thread-1', 'Test message');

    expect(window.__tribexAiState.getThreadContext('thread-1').thread).toMatchObject({
      id: 'thread-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      preview: 'Test message',
      lastActivityAt: '2026-04-15T19:30:00.000Z',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'older message',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'older reply',
        }),
        expect.objectContaining({
          role: 'user',
          content: 'Test message',
        }),
      ],
    });

    vi.useRealTimers();
  });

  it('preserves richer local thread history when a shorter runtime transcript arrives with a newer timestamp', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T19:40:00.000Z'));

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [
            {
              id: 'user-old-1',
              role: 'user',
              content: 'older message',
              createdAt: '2026-04-15T19:20:00.000Z',
            },
            {
              id: 'assistant-old-1',
              role: 'assistant',
              content: 'older reply',
              createdAt: '2026-04-15T19:20:01.000Z',
            },
          ],
          preview: 'older reply',
          lastActivityAt: '2026-04-15T19:20:01.000Z',
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          messages: [
            {
              id: 'user-old-1',
              role: 'user',
              content: 'older message',
              createdAt: '2026-04-15T19:20:00.000Z',
            },
            {
              id: 'assistant-old-1',
              role: 'assistant',
              content: 'older reply',
              createdAt: '2026-04-15T19:20:01.000Z',
            },
          ],
          preview: 'older reply',
          lastActivityAt: '2026-04-15T19:40:01.000Z',
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();
    await window.__tribexAiState.submitPrompt('thread-1', 'latest question');

    expect(window.__tribexAiState.getThreadContext('thread-1').thread).toMatchObject({
      id: 'thread-1',
      preview: 'latest question',
      lastActivityAt: '2026-04-15T19:40:00.000Z',
      messages: [
        expect.objectContaining({ content: 'older message' }),
        expect.objectContaining({ content: 'older reply' }),
        expect.objectContaining({ content: 'latest question' }),
      ],
    });

    vi.useRealTimers();
  });

  it('preserves optimistic user and tool notes across a plain thread refresh after runtime is active', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T19:45:00.000Z'));

    var streamHandler = null;
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'New chat',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'New chat',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
          preview: 'older reply',
          lastActivityAt: '2026-04-15T19:20:01.000Z',
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          messages: [
            {
              id: 'user-old-1',
              role: 'user',
              content: 'older message',
              createdAt: '2026-04-15T19:20:00.000Z',
            },
            {
              id: 'assistant-old-1',
              role: 'assistant',
              content: 'older reply',
              createdAt: '2026-04-15T19:20:01.000Z',
            },
          ],
          preview: 'older reply',
          lastActivityAt: '2026-04-15T19:20:01.000Z',
        });
      }),
      listenToStreamEvents: vi.fn(function (handler) {
        streamHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value.thread || value; },
      normalizeMessage: function (value) {
        if (value && value.toolName) {
          return {
            id: 'tool-note-1',
            role: 'tool',
            toolName: value.toolName,
            summary: 'Issued',
            detail: '',
            createdAt: value.createdAt,
          };
        }
        return value;
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();
    await window.__tribexAiState.submitPrompt('thread-1', 'latest question');

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        toolName: 'thread.runtime.session.issued',
        createdAt: '2026-04-15T19:45:01.000Z',
        result: { data: { ok: true } },
      },
    });

    await window.__tribexAiState.refreshActiveThread();

    expect(window.__tribexAiState.getThreadContext('thread-1').thread).toMatchObject({
      id: 'thread-1',
      preview: 'latest question',
      messages: [
        expect.objectContaining({ content: 'older message' }),
        expect.objectContaining({ content: 'older reply' }),
        expect.objectContaining({ content: 'latest question' }),
      ],
    });
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'thread.runtime.session.issued',
          title: 'Issued',
        }),
      ]),
    );

    vi.useRealTimers();
  });

  it('dedupes replayed sequenced companion rich_content events', async function () {
    var streamHandler = null;
    var fetchMock = vi.fn(function () {
      return Promise.resolve({ ok: true });
    });
    globalThis.fetch = fetchMock;

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'smoke' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Smoke Test',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Smoke Test',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(),
      listenToStreamEvents: vi.fn(function (handler) {
        streamHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) {
        if (value && value.toolName === 'rich_content' && value.result && value.result.data) {
          return {
            id: 'tool-smoke-1',
            role: 'tool',
            toolName: 'rich_content',
            status: 'completed',
            resultContentType: 'rich_content',
            resultData: value.result.data,
            resultMeta: {},
            createdAt: '2026-04-15T10:41:01.000Z',
          };
        }
        return value;
      },
      shouldPreviewCompanionPayload: function (value) {
        return value && value.toolName === 'rich_content';
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    window.__companionUtils.openSession.mockClear();

    var replayedEvent = {
      threadId: 'thread-1',
      type: 'data',
      payload: {
        sequence: 7,
        toolName: 'rich_content',
        result: {
          data: {
            title: 'Smoke Test Passed',
            body: 'Runtime: `ai-sdk-runner`',
          },
        },
      },
    };

    streamHandler(replayedEvent);
    streamHandler(replayedEvent);

    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-smoke-1',
          resultContentType: 'rich_content',
          inlineDisplay: true,
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps structured_data push_content results inline without syncing the thread drawer', async function () {
    var streamHandler = null;
    var fetchMock = vi.fn(function () {
      return Promise.resolve({ ok: true });
    });
    globalThis.fetch = fetchMock;
    window.__renderers = {
      structured_data: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'smoke' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Structured Result',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Structured Result',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(),
      listenToStreamEvents: vi.fn(function (handler) {
        streamHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) {
        return {
          id: 'tool-structured-1',
          role: 'tool',
          toolName: 'structured_data',
          status: 'completed',
          resultContentType: 'structured_data',
          resultData: value && value.result && value.result.data ? value.result.data.data : null,
          resultMeta: null,
          toolArgs: { threadId: 'thread-1' },
          createdAt: '2026-04-15T10:41:01.000Z',
        };
      },
      shouldPreviewCompanionPayload: function (value) {
        return value && value.toolName === 'push_content';
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    window.__companionUtils.openSession.mockClear();
    window.__companionUtils.syncThreadArtifactDrawer.mockClear();

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        sequence: 8,
        toolName: 'push_content',
        toolArgs: {
          threadId: 'thread-1',
        },
        result: {
          data: {
            tool_name: 'structured_data',
            data: {
              title: 'Expense Review',
              tables: [{
                id: 'table-1',
                name: 'Expenses',
                columns: [{ id: 'amount', name: 'Amount' }],
                rows: [],
              }],
            },
          },
        },
      },
    });

    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resultContentType: 'structured_data',
          inlineDisplay: true,
          resultData: expect.objectContaining({
            title: 'Expense Review',
            tables: expect.any(Array),
          }),
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual([]);
    expect(window.__companionUtils.syncThreadArtifactDrawer).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps review-mode structured_data artifacts reopenable from companion replay events', async function () {
    var streamHandler = null;
    window.__renderers = {
      structured_data: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'smoke' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Review Result',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Review Result',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(),
      listenToStreamEvents: vi.fn(function (handler) {
        streamHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) {
        return {
          id: 'tool-review-11',
          role: 'tool',
          toolName: 'structured_data',
          status: 'completed',
          resultContentType: 'structured_data',
          resultData: value && value.result && value.result.data ? value.result.data.data : null,
          resultMeta: {
            reviewRequired: true,
          },
          toolArgs: { threadId: 'thread-1' },
          sessionId: value.sessionId || null,
          createdAt: '2026-04-15T10:41:11.000Z',
        };
      },
      shouldPreviewCompanionPayload: function (value) {
        return value && value.toolName === 'push_review';
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    window.__companionUtils.openSession.mockClear();

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        sequence: 11,
        sessionId: 'review-session-1',
        toolName: 'push_review',
        toolArgs: {
          threadId: 'thread-1',
        },
        reviewRequired: true,
        result: {
          data: {
            tool_name: 'structured_data',
            data: {
              title: 'Approval Example',
              tables: [{
                id: 'table-1',
                name: 'Approval Example',
                columns: [{ id: 'action', name: 'Action' }],
                rows: [],
              }],
            },
          },
        },
      },
    });

    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'review-session-1',
          contentType: 'structured_data',
          reviewRequired: true,
          reviewSessionId: 'review-session-1',
          data: expect.objectContaining({
            title: 'Approval Example',
          }),
        }),
      ]),
    );
  });

  it('reopens review artifacts by focusing the real session instead of creating a synthetic tab', async function () {
    var streamHandler = null;
    window.__renderers = {
      structured_data: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'smoke' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Review Result',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Review Result',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(),
      listenToStreamEvents: vi.fn(function (handler) {
        streamHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) {
        return {
          id: 'tool-review-11',
          role: 'tool',
          toolName: 'structured_data',
          status: 'completed',
          resultContentType: 'structured_data',
          resultData: value && value.result && value.result.data ? value.result.data.data : null,
          resultMeta: {
            reviewRequired: true,
          },
          toolArgs: { threadId: 'thread-1' },
          sessionId: value.sessionId || null,
          createdAt: '2026-04-15T10:41:11.000Z',
        };
      },
      shouldPreviewCompanionPayload: function (value) {
        return value && value.toolName === 'push_review';
      },
    };

    window.__tribexAiClient = client;
    window.__companionUtils.getSession.mockImplementation(function (sessionId) {
      if (sessionId !== 'review-session-1') return null;
      return {
        meta: {
          headerTitle: 'Approval Example',
        },
      };
    });
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        sequence: 11,
        sessionId: 'review-session-1',
        toolName: 'push_review',
        toolArgs: {
          threadId: 'thread-1',
        },
        reviewRequired: true,
        result: {
          data: {
            tool_name: 'structured_data',
            data: {
              title: 'Approval Example',
              tables: [{
                id: 'table-1',
                name: 'Approval Example',
                columns: [{ id: 'action', name: 'Action' }],
                rows: [],
              }],
            },
          },
        },
      },
    });

    window.__companionUtils.openSession.mockClear();
    window.__companionUtils.selectSession.mockClear();
    var reviewArtifact = window.__tribexAiState.getThreadContext('thread-1').thread.artifacts[0];

    window.__tribexAiState.openThreadArtifact(
      'thread-1',
      reviewArtifact.artifactKey,
    );

    expect(window.__companionUtils.selectSession).toHaveBeenCalledWith('review-session-1');
    expect(window.__companionUtils.openSession).not.toHaveBeenCalled();
  });

  it('merges assistant token deltas into a single streaming transcript message', async function () {
    var streamHandler = null;

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Streaming Thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Streaming Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      sendMessage: vi.fn(),
      listenToStreamEvents: vi.fn(function (handler) {
        streamHandler = handler;
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value, index) {
        return {
          id: 'message-' + index,
          role: 'assistant',
          content: value.delta,
          messageId: value.messageId,
          isStreaming: true,
          createdAt: value.createdAt || null,
        };
      },
    };

    window.__tribexAiClient = Object.assign({}, window.__tribexAiClient, client);
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        sequence: 1,
        type: 'assistant_delta',
        messageId: 'assistant-1',
        delta: 'Hello',
      },
    });

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        sequence: 2,
        type: 'assistant_delta',
        messageId: 'assistant-1',
        delta: ' world',
      },
    });

    var threadContext = window.__tribexAiState.getThreadContext('thread-1');
    expect(threadContext.thread.messages).toHaveLength(1);
    expect(threadContext.thread.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Hello world',
      messageId: 'assistant-1',
      isStreaming: true,
    });
  });

  it('rerenders the active session without triggering a fetch refresh loop', function () {
    window.__tribexAiClient = {
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
    };
    loadState();
    window.__tribexAiState.setActiveSession('session-1', {
      meta: {
        aiView: 'thread',
        threadId: 'thread-1',
      },
    });
    window.__companionUtils.rerenderActiveSession.mockClear();
    window.__companionUtils.refreshActiveSession.mockClear();

    window.__tribexAiState.setSearchTerm('finance');

    expect(window.__companionUtils.rerenderActiveSession).toHaveBeenCalled();
    expect(window.__companionUtils.refreshActiveSession).not.toHaveBeenCalled();
  });

  it('opens the workspace file browser and caches active workspace files', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchPackages: vi.fn(function () {
        return Promise.resolve([]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([]);
      }),
      listWorkspaceFiles: vi.fn(function () {
        return Promise.resolve({
          files: [{
            id: 'file-1',
            relativePath: 'reports/april.csv',
            name: 'april.csv',
            sizeBytes: 42,
          }],
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    await window.__tribexAiState.openWorkspaceFileBrowser();

    var snapshot = window.__tribexAiState.getSnapshot();
    expect(snapshot.fileBrowserOpen).toBe(true);
    expect(snapshot.workspaceFiles).toMatchObject([
      { id: 'file-1', relativePath: 'reports/april.csv' },
    ]);
    expect(client.listWorkspaceFiles).toHaveBeenCalledWith('workspace-1');

    await window.__tribexAiState.selectWorkspaceFolder('reports');
    expect(window.__tribexAiState.getSnapshot().workspaceFileBrowser).toMatchObject({
      selectedType: 'folder',
      selectedFolderPath: 'reports',
    });
  });

  it('does not rerender a focused thread artifact session for background AI state changes', function () {
    window.__tribexAiClient = {
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
    };
    loadState();
    window.__tribexAiState.setActiveSession('session-1', {
      meta: {
        aiView: 'thread-artifact',
        threadId: 'thread-1',
      },
    });
    window.__companionUtils.rerenderActiveSession.mockClear();
    window.__companionUtils.refreshActiveSession.mockClear();

    window.__tribexAiState.setSearchTerm('finance');

    expect(window.__companionUtils.rerenderActiveSession).not.toHaveBeenCalled();
    expect(window.__companionUtils.refreshActiveSession).not.toHaveBeenCalled();
  });

  it('aggregates navigator projects and threads across hidden workspaces', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchPackages: vi.fn(function () {
        return Promise.resolve([{ key: 'generic', displayName: 'General Workspace', version: '1.0.0' }]);
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([
          { id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' },
          { id: 'workspace-2', organizationId: 'org-1', name: 'Workspace 2', packageKey: 'smoke' },
        ]);
      }),
      fetchProjects: vi.fn(function (workspace) {
        if (workspace.id === 'workspace-1') {
          return Promise.resolve([{ id: 'project-1', workspaceId: 'workspace-1', organizationId: 'org-1', name: 'General', workspaceName: 'Workspace 1' }]);
        }
        return Promise.resolve([{ id: 'project-2', workspaceId: 'workspace-2', organizationId: 'org-1', name: 'Ops', workspaceName: 'Workspace 2' }]);
      }),
      fetchThreads: vi.fn(function (project) {
        if (project.id === 'project-1') {
          return Promise.resolve([{ id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'General chat' }]);
        }
        return Promise.resolve([{ id: 'thread-2', projectId: 'project-2', workspaceId: 'workspace-2', title: 'Ops chat' }]);
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    var firstSnapshot = window.__tribexAiState.getSnapshot();
    expect(firstSnapshot.selectedWorkspace).toMatchObject({ id: 'workspace-1' });
    expect(firstSnapshot.projectGroups).toHaveLength(2);
    expect(firstSnapshot.projectGroups.map(function (group) { return group.project.id; })).toEqual(['project-1', 'project-2']);

    await window.__tribexAiState.selectWorkspace('workspace-2');
    var secondSnapshot = window.__tribexAiState.getSnapshot();
    expect(secondSnapshot.selectedWorkspace).toMatchObject({ id: 'workspace-2' });
    expect(secondSnapshot.projectGroups).toHaveLength(2);
    expect(secondSnapshot.projectGroups.map(function (group) { return group.project.id; })).toEqual(['project-1', 'project-2']);
    expect(client.fetchProjects).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-1' }));
    expect(client.fetchProjects).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-2' }));
  });

  it('restores the last selected project and thread when switching workspaces', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchPackages: vi.fn(function () {
        return Promise.resolve([{ key: 'generic', displayName: 'General Workspace', version: '1.0.0' }]);
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([
          { id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' },
          { id: 'workspace-2', organizationId: 'org-1', name: 'Workspace 2', packageKey: 'generic' },
        ]);
      }),
      fetchProjects: vi.fn(function (workspace) {
        if (workspace.id === 'workspace-1') {
          return Promise.resolve([{ id: 'project-1', workspaceId: 'workspace-1', organizationId: 'org-1', name: 'General', workspaceName: 'Workspace 1' }]);
        }
        return Promise.resolve([{ id: 'project-2', workspaceId: 'workspace-2', organizationId: 'org-1', name: 'Ops', workspaceName: 'Workspace 2' }]);
      }),
      fetchThreads: vi.fn(function (project) {
        if (project.id === 'project-1') {
          return Promise.resolve([{ id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'General chat' }]);
        }
        return Promise.resolve([{ id: 'thread-2', projectId: 'project-2', workspaceId: 'workspace-2', title: 'Ops chat' }]);
      }),
      fetchThread: vi.fn(function (threadId) {
        return Promise.resolve({
          id: threadId,
          title: threadId === 'thread-1' ? 'General chat' : 'Ops chat',
          projectId: threadId === 'thread-1' ? 'project-1' : 'project-2',
          workspaceId: threadId === 'thread-1' ? 'workspace-1' : 'workspace-2',
          messages: [],
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    window.__tribexAiState.setActiveSession('session-1', {
      meta: {
        aiView: 'thread',
        projectId: 'project-1',
        threadId: 'thread-1',
      },
    });
    await window.__tribexAiState.selectWorkspace('workspace-2');
    await window.__tribexAiState.selectWorkspace('workspace-1');

    var snapshot = window.__tribexAiState.getSnapshot();
    expect(snapshot.selectedWorkspace).toMatchObject({ id: 'workspace-1' });
    expect(snapshot.selectedProject).toMatchObject({ id: 'project-1' });
    expect(snapshot.activeThreadId).toBe('thread-1');
    expect(snapshot.projectExpansion['project-1']).toBe(true);
  });

  it('creates a new chat inside the requested project and expands that project', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([
          { id: 'project-1', workspaceId: 'workspace-1', organizationId: 'org-1', name: 'General', workspaceName: 'Workspace 1' },
          { id: 'project-2', workspaceId: 'workspace-1', organizationId: 'org-1', name: 'Ops', workspaceName: 'Workspace 1' },
        ]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([]);
      }),
      createThread: vi.fn(function () {
        return Promise.resolve({ id: 'thread-2', title: 'New chat' });
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-2',
          title: 'New chat',
          projectId: 'project-2',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      createCompanionSession: vi.fn(function () {
        return Promise.resolve({ companionKey: 'companion-1' });
      }),
      startCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopCompanionStream: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    await window.__tribexAiState.createThread(null, { projectId: 'project-2' });

    var snapshot = window.__tribexAiState.getSnapshot();
    expect(client.createThread).toHaveBeenCalledWith('project-2', 'New chat', 'general');
    expect(snapshot.selectedProject).toMatchObject({ id: 'project-2' });
    expect(snapshot.projectExpansion['project-2']).toBe(true);
  });

  it('keeps thread-scoped rich_content inline when a later runtime update adds a stored session id', async function () {
    var runtimeHandler = null;
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Architecture Thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Architecture Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToRuntimeEvents: vi.fn(function (_threadId, handler) {
        runtimeHandler = handler;
        return function () {};
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();

    runtimeHandler({
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 1,
      createdAt: '2026-04-17T22:00:00.000Z',
      message: {
        id: 'user-1',
        role: 'user',
        content: 'Show me the architecture.',
        createdAt: '2026-04-17T22:00:00.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-1',
        toolCallId: 'tool-push-1',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'completed',
        detail: 'Prepared Rich Content result: Architecture Overview.',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Architecture Overview',
          body: 'Rendered inline.',
        },
        createdAt: '2026-04-17T22:00:01.000Z',
        updatedAt: '2026-04-17T22:00:01.000Z',
      },
    });
    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-push-1',
        toolCallId: 'tool-push-1',
        toolName: 'rich_content',
        title: 'Rich Content',
        status: 'completed',
        detail: 'Stored Rich Content result: Architecture Overview.',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Architecture Overview',
          body: 'Rendered inline.',
        },
        sessionId: 'result-session-1',
        createdAt: '2026-04-17T22:00:01.000Z',
        updatedAt: '2026-04-17T22:00:02.000Z',
      },
    });
    runtimeHandler({
      type: 'assistant_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-17T22:00:03.000Z',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Inline below.',
        createdAt: '2026-04-17T22:00:03.000Z',
      },
    });
    runtimeHandler({
      type: 'turn_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-17T22:00:04.000Z',
    });

    var thread = window.__tribexAiState.getThreadContext('thread-1').thread;
    expect(thread.runs[0].answer.inlineResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
          artifactKey: expect.stringContaining('tool-push-1'),
          inlineDisplay: true,
          sessionId: 'result-session-1',
          resultData: expect.objectContaining({
            title: 'Architecture Overview',
          }),
        }),
      ]),
    );
    expect(thread.artifacts).toEqual(
      [],
    );
    expect(window.__companionUtils.selectSession).not.toHaveBeenCalled();
  });

  it('rebuilds inline runtime results after a cold restart using thread detail plus runtime snapshot', async function () {
    vi.useFakeTimers();
    window.__renderers = {
      rich_content: vi.fn(),
    };

    function createClient() {
      return {
        getConfig: vi.fn(function () {
          return Promise.resolve({ configured: true });
        }),
        fetchSession: vi.fn(function () {
          return Promise.resolve({ user: { id: 'user-1' } });
        }),
        fetchOrganizations: vi.fn(function () {
          return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
        }),
        fetchWorkspaces: vi.fn(function () {
          return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
        }),
        fetchProjects: vi.fn(function () {
          return Promise.resolve([{
            id: 'project-1',
            organizationId: 'org-1',
            workspaceId: 'workspace-1',
            name: 'General',
            workspaceName: 'Workspace 1',
          }]);
        }),
        fetchThreads: vi.fn(function () {
          return Promise.resolve([{
            id: 'thread-1',
            projectId: 'project-1',
            workspaceId: 'workspace-1',
            title: 'Restart Thread',
          }]);
        }),
        fetchThread: vi.fn(function () {
          return Promise.resolve({
            id: 'thread-1',
            title: 'Restart Thread',
            projectId: 'project-1',
            workspaceId: 'workspace-1',
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: 'Show me the architecture.',
                createdAt: '2026-04-17T22:10:00.000Z',
                turnId: 'turn-1',
                turnOrdinal: 1,
              },
              {
                id: 'assistant-1',
                role: 'assistant',
                content: 'Inline below.',
                createdAt: '2026-04-17T22:10:02.000Z',
                turnId: 'turn-1',
                turnOrdinal: 1,
              },
            ],
          });
        }),
        registerDesktopRelay: vi.fn(function () {
          return Promise.resolve({
            relaySession: { id: 'relay-session-1' },
            relayDeviceId: 'device-1',
          });
        }),
        startDesktopRelayStream: vi.fn(function () {
          return Promise.resolve();
        }),
        stopDesktopRelayStream: vi.fn(function () {
          return Promise.resolve();
        }),
        startDesktopPresenceHeartbeat: vi.fn(function () {
          return Promise.resolve();
        }),
        stopDesktopPresenceHeartbeat: vi.fn(function () {
          return Promise.resolve();
        }),
        listenToStreamEvents: vi.fn(function () {
          return Promise.resolve(function () {});
        }),
        listenToDesktopRelayEvents: vi.fn(function () {
          return Promise.resolve(function () {});
        }),
        listenToDesktopPresenceEvents: vi.fn(function () {
          return Promise.resolve(function () {});
        }),
        syncThreadRuntime: vi.fn(function () {
          return Promise.resolve({
            id: 'thread-1',
            messagesSource: 'runtime',
            rawRuntimeMessages: [
              {
                id: 'runtime-user-1',
                role: 'user',
                turnId: 'turn-1',
                turnOrdinal: 1,
                createdAt: '2026-04-17T22:10:00.000Z',
                parts: [{ type: 'text', text: 'Show me the architecture.' }],
              },
              {
                id: 'runtime-assistant-1',
                role: 'assistant',
                turnId: 'turn-1',
                turnOrdinal: 1,
                createdAt: '2026-04-17T22:10:02.000Z',
                parts: [
                  { type: 'text', text: 'Inline below.' },
                  {
                    type: 'tool-rich_content',
                    toolCallId: 'tool-push-1',
                    toolName: 'rich_content',
                    title: 'Rich Content',
                    state: 'output-available',
                    input: {
                      title: 'Architecture Overview',
                      body: 'Rendered inline.',
                    },
                  },
                ],
              },
            ],
            runtimeMessages: [
              {
                id: 'runtime-user-1',
                role: 'user',
                content: 'Show me the architecture.',
                createdAt: '2026-04-17T22:10:00.000Z',
                turnId: 'turn-1',
                turnOrdinal: 1,
              },
              {
                id: 'runtime-assistant-1',
                role: 'assistant',
                content: 'Inline below.',
                createdAt: '2026-04-17T22:10:02.000Z',
                turnId: 'turn-1',
                turnOrdinal: 1,
              },
            ],
            preview: 'Inline below.',
            lastActivityAt: '2026-04-17T22:10:02.000Z',
          });
        }),
        normalizeThreadDetail: function (value) { return value; },
        normalizeMessage: function (value) { return value; },
      };
    }

    window.__tribexAiClient = createClient();
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    var firstThread = window.__tribexAiState.getThreadContext('thread-1').thread;
    expect(firstThread.runs[0].answer.inlineResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
          inlineDisplay: true,
          resultData: expect.objectContaining({
            title: 'Architecture Overview',
          }),
        }),
      ]),
    );

    delete window.__tribexAiState;
    window.__tribexAiClient = createClient();
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    var rehydratedThread = window.__tribexAiState.getThreadContext('thread-1').thread;
    expect(rehydratedThread.runs[0].answer.inlineResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
          inlineDisplay: true,
          resultData: expect.objectContaining({
            title: 'Architecture Overview',
          }),
        }),
      ]),
    );
  });

  it('preserves full runtime tool details in projected work sessions', async function () {
    vi.useFakeTimers();
    var longObjective = 'Determine how much wood a woodchuck could chuck if a woodchuck could chuck wood. '.repeat(24)
      + 'Final untruncated marker.';

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Runtime detail thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Runtime detail thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      syncThreadRuntime: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          rawRuntimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              turnId: 'turn-1',
              turnOrdinal: 1,
              createdAt: '2026-04-17T22:10:00.000Z',
              parts: [{ type: 'text', text: 'Dispatch the subagent.' }],
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              turnId: 'turn-1',
              turnOrdinal: 1,
              createdAt: '2026-04-17T22:10:02.000Z',
              parts: [
                {
                  type: 'tool-subagent_dispatch',
                  toolCallId: 'tool-subagent-1',
                  toolName: 'subagent_dispatch',
                  title: 'Subagent Dispatch',
                  state: 'output-available',
                  input: {
                    objective: longObjective,
                  },
                },
              ],
            },
          ],
          runtimeMessages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Dispatch the subagent.',
              createdAt: '2026-04-17T22:10:00.000Z',
              turnId: 'turn-1',
              turnOrdinal: 1,
            },
          ],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({ relaySession: { id: 'relay-session-1' }, relayDeviceId: 'device-1' });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    var workItem = window.__tribexAiState.getThreadContext('thread-1').thread.runs[0].workSession.items[0];
    expect(workItem.detail).toContain('Final untruncated marker.');
    expect(workItem.detail).not.toContain('...');
  });

  it('projects cold runtime work durations from tool part timestamps', async function () {
    vi.useFakeTimers();

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Runtime duration thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Runtime duration thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      syncThreadRuntime: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          rawRuntimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              turnId: 'turn-1',
              turnOrdinal: 1,
              createdAt: '2026-04-17T22:10:00.000Z',
              parts: [{ type: 'text', text: 'Run a subagent.' }],
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              turnId: 'turn-1',
              turnOrdinal: 1,
              createdAt: '2026-04-17T23:23:10.000Z',
              parts: [
                {
                  type: 'tool-subagent_dispatch',
                  toolCallId: 'tool-subagent-1',
                  toolName: 'subagent_dispatch',
                  title: 'Subagent Dispatch',
                  state: 'output-available',
                  startedAt: '2026-04-17T22:10:05.000Z',
                  completedAt: '2026-04-17T22:10:20.000Z',
                  input: {
                    objective: 'Run a bounded subagent task.',
                  },
                },
                { type: 'text', text: 'Done.' },
              ],
            },
          ],
          runtimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              content: 'Run a subagent.',
              createdAt: '2026-04-17T22:10:00.000Z',
              turnId: 'turn-1',
              turnOrdinal: 1,
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              content: 'Done.',
              createdAt: '2026-04-17T23:23:10.000Z',
              turnId: 'turn-1',
              turnOrdinal: 1,
            },
          ],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({ relaySession: { id: 'relay-session-1' }, relayDeviceId: 'device-1' });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    var workSession = window.__tribexAiState.getThreadContext('thread-1').thread.runs[0].workSession;
    expect(workSession).toMatchObject({
      status: 'completed',
      startedAt: '2026-04-17T22:10:05.000Z',
      endedAt: '2026-04-17T22:10:20.000Z',
    });
    expect(workSession.items[0]).toMatchObject({
      createdAt: '2026-04-17T22:10:05.000Z',
      updatedAt: '2026-04-17T22:10:20.000Z',
      completedAt: '2026-04-17T22:10:20.000Z',
    });
  });

  it('keeps multi-turn runs paired correctly after runtime rehydration overlays a text-only snapshot', async function () {
    vi.useFakeTimers();
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Multi Turn Thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Multi Turn Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'First question',
              createdAt: '2026-04-17T22:20:00.000Z',
              turnId: 'turn-1',
              turnOrdinal: 1,
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'First answer',
              createdAt: '2026-04-17T22:20:01.000Z',
              turnId: 'turn-1',
              turnOrdinal: 1,
            },
            {
              id: 'user-2',
              role: 'user',
              content: 'Second question',
              createdAt: '2026-04-17T22:20:02.000Z',
              turnId: 'turn-2',
              turnOrdinal: 2,
            },
          ],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      syncThreadRuntime: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          rawRuntimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              createdAt: '2026-04-17T22:20:00.000Z',
              parts: [{ type: 'text', text: 'First question' }],
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              createdAt: '2026-04-17T22:20:01.000Z',
              parts: [
                { type: 'text', text: 'First answer' },
                {
                  type: 'tool-rich_content',
                  toolCallId: 'tool-push-1',
                  toolName: 'rich_content',
                  title: 'Rich Content',
                  state: 'output-available',
                  input: {
                    title: 'Architecture Overview',
                    body: 'Rendered inline.',
                  },
                },
              ],
            },
            {
              id: 'runtime-user-2',
              role: 'user',
              createdAt: '2026-04-17T22:20:02.000Z',
              parts: [{ type: 'text', text: 'Second question' }],
            },
          ],
          runtimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              content: 'First question',
              createdAt: '2026-04-17T22:20:00.000Z',
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              content: 'First answer',
              createdAt: '2026-04-17T22:20:01.000Z',
            },
            {
              id: 'runtime-user-2',
              role: 'user',
              content: 'Second question',
              createdAt: '2026-04-17T22:20:02.000Z',
            },
          ],
          preview: 'Second question',
          lastActivityAt: '2026-04-17T22:20:02.000Z',
        });
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    var runs = window.__tribexAiState.getThreadContext('thread-1').thread.runs;
    expect(runs).toHaveLength(2);
    expect(runs[0].user.content).toBe('First question');
    expect(runs[0].answer.content).toBe('First answer');
    expect(runs[0].answer.inlineResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
          inlineDisplay: true,
        }),
      ]),
    );
    expect(runs[1].user.content).toBe('Second question');
    expect(runs[1].answer.content).toBe('');
  });

  it('rehydrates assistant text onto the current turn even when runtime messages omit turn ids', async function () {
    vi.useFakeTimers();
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Rehydrate Thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Rehydrate Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'How much wood could a woodchuck chuck?',
              createdAt: '2026-04-17T22:18:19.000Z',
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'About 700 pounds in a day.',
              createdAt: '2026-04-17T22:18:20.000Z',
            },
            {
              id: 'user-2',
              role: 'user',
              content: 'Can you share a diagram?',
              createdAt: '2026-04-17T22:18:21.000Z',
            },
            {
              id: 'assistant-2',
              role: 'assistant',
              content: 'Here is the diagram and summary.',
              createdAt: '2026-04-17T22:18:22.000Z',
            },
          ],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      syncThreadRuntime: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          rawRuntimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              createdAt: '2026-04-17T22:18:19.000Z',
              parts: [{ type: 'text', text: 'How much wood could a woodchuck chuck?' }],
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              createdAt: '2026-04-17T22:18:20.000Z',
              parts: [{ type: 'text', text: 'About 700 pounds in a day.' }],
            },
            {
              id: 'runtime-user-2',
              role: 'user',
              createdAt: '2026-04-17T22:18:21.000Z',
              parts: [{ type: 'text', text: 'Can you share a diagram?' }],
            },
            {
              id: 'runtime-assistant-2',
              role: 'assistant',
              createdAt: '2026-04-17T22:18:22.000Z',
              parts: [
                { type: 'text', text: 'Here is the diagram and summary.' },
                {
                  type: 'tool-rich_content',
                  toolCallId: 'tool-push-1',
                  toolName: 'rich_content',
                  title: 'Rich Content',
                  state: 'output-available',
                  input: {
                    title: 'Resource Allocation Strategy: Woodchuck Operations',
                    body: '### Operational Transition Diagram',
                  },
                },
              ],
            },
          ],
          runtimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              content: 'How much wood could a woodchuck chuck?',
              createdAt: '2026-04-17T22:18:19.000Z',
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              content: 'About 700 pounds in a day.',
              createdAt: '2026-04-17T22:18:20.000Z',
            },
            {
              id: 'runtime-user-2',
              role: 'user',
              content: 'Can you share a diagram?',
              createdAt: '2026-04-17T22:18:21.000Z',
            },
            {
              id: 'runtime-assistant-2',
              role: 'assistant',
              content: 'Here is the diagram and summary.',
              createdAt: '2026-04-17T22:18:22.000Z',
            },
          ],
          preview: 'Here is the diagram and summary.',
          lastActivityAt: '2026-04-17T22:18:22.000Z',
        });
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    var runs = window.__tribexAiState.getThreadContext('thread-1').thread.runs;
    expect(runs).toHaveLength(2);
    expect(runs[0].answer.content).toBe('About 700 pounds in a day.');
    expect(runs[1].answer.content).toBe('Here is the diagram and summary.');
    expect(runs[1].answer.inlineResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
          inlineDisplay: true,
          resultData: expect.objectContaining({
            title: 'Resource Allocation Strategy: Woodchuck Operations',
          }),
        }),
      ]),
    );
  });

  it('binds the active turn to the first assistant reply after its user prompt during runtime rehydrate', async function () {
    vi.useFakeTimers();
    window.__renderers = {
      rich_content: vi.fn(),
    };

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Rehydrate Thread',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Rehydrate Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'First question',
              createdAt: '2026-04-17T22:18:19.000Z',
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'First answer',
              createdAt: '2026-04-17T22:18:20.000Z',
            },
            {
              id: 'user-2',
              role: 'user',
              content: 'Second question',
              createdAt: '2026-04-17T22:18:21.000Z',
            },
          ],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      syncThreadRuntime: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          rawRuntimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              createdAt: '2026-04-17T22:18:19.000Z',
              parts: [{ type: 'text', text: 'First question' }],
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              createdAt: '2026-04-17T22:18:20.000Z',
              parts: [{ type: 'text', text: 'First answer' }],
            },
            {
              id: 'runtime-user-2',
              role: 'user',
              createdAt: '2026-04-17T22:18:21.000Z',
              parts: [{ type: 'text', text: 'Second question' }],
            },
            {
              id: 'runtime-assistant-2',
              role: 'assistant',
              createdAt: '2026-04-17T22:18:22.000Z',
              parts: [{ type: 'text', text: 'Second answer' }],
            },
            {
              id: 'runtime-user-3',
              role: 'user',
              createdAt: '2026-04-17T22:18:23.000Z',
              parts: [{ type: 'text', text: 'Third question' }],
            },
            {
              id: 'runtime-assistant-3',
              role: 'assistant',
              createdAt: '2026-04-17T22:18:24.000Z',
              parts: [{ type: 'text', text: 'Third answer' }],
            },
          ],
          runtimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              content: 'First question',
              createdAt: '2026-04-17T22:18:19.000Z',
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              content: 'First answer',
              createdAt: '2026-04-17T22:18:20.000Z',
            },
            {
              id: 'runtime-user-2',
              role: 'user',
              content: 'Second question',
              createdAt: '2026-04-17T22:18:21.000Z',
            },
            {
              id: 'runtime-assistant-2',
              role: 'assistant',
              content: 'Second answer',
              createdAt: '2026-04-17T22:18:22.000Z',
            },
            {
              id: 'runtime-user-3',
              role: 'user',
              content: 'Third question',
              createdAt: '2026-04-17T22:18:23.000Z',
            },
            {
              id: 'runtime-assistant-3',
              role: 'assistant',
              content: 'Third answer',
              createdAt: '2026-04-17T22:18:24.000Z',
            },
          ],
          preview: 'Third answer',
          lastActivityAt: '2026-04-17T22:18:24.000Z',
        });
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    var runs = window.__tribexAiState.getThreadContext('thread-1').thread.runs;
    expect(runs).toHaveLength(3);
    expect(runs[0].user.content).toBe('First question');
    expect(runs[0].answer.content).toBe('First answer');
    expect(runs[1].user.content).toBe('Second question');
    expect(runs[1].answer.content).toBe('Second answer');
    expect(runs[2].user.content).toBe('Third question');
    expect(runs[2].answer.content).toBe('Third answer');
  });

  it('keeps navigator activity pinned to the latest user or assistant message instead of later tool activity', async function () {
    vi.useFakeTimers();

    var runtimeHandler = null;
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([{
          id: 'thread-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          title: 'Activity Thread',
          lastActivityAt: '2026-04-17T22:18:22.000Z',
        }]);
      }),
      fetchThread: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          title: 'Activity Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Can you share a diagram?',
              createdAt: '2026-04-17T22:18:21.000Z',
            },
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'Here is the diagram and summary.',
              createdAt: '2026-04-17T22:18:22.000Z',
            },
            {
              id: 'tool-1',
              role: 'tool',
              toolName: 'rich_content',
              status: 'completed',
              detail: 'Stored result.',
              resultContentType: 'rich_content',
              resultData: {
                title: 'Diagram',
                body: 'Stored result.',
              },
              createdAt: '2026-04-17T22:18:24.000Z',
            },
          ],
          lastActivityAt: '2026-04-17T22:18:22.000Z',
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToRuntimeEvents: vi.fn(function (_threadId, handler) {
        runtimeHandler = handler;
        return function () {};
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      stopDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      syncThreadRuntime: vi.fn(function () {
        return Promise.resolve({
          id: 'thread-1',
          messagesSource: 'runtime',
          runtimeMessages: [
            {
              id: 'runtime-user-1',
              role: 'user',
              content: 'Can you share a diagram?',
              createdAt: '2026-04-17T22:18:21.000Z',
            },
            {
              id: 'runtime-assistant-1',
              role: 'assistant',
              content: 'Here is the diagram and summary.',
              createdAt: '2026-04-17T22:18:22.000Z',
            },
          ],
          lastActivityAt: '2026-04-17T22:18:22.000Z',
        });
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1');
    await vi.runAllTimersAsync();

    expect(window.__tribexAiState.getThread('thread-1')).toMatchObject({
      lastActivityAt: '2026-04-17T22:18:22.000Z',
    });

    runtimeHandler({
      type: 'activity_update',
      turnId: 'turn-1',
      item: {
        id: 'tool-2',
        toolName: 'rich_content',
        title: 'Diagram',
        status: 'completed',
        detail: 'Stored result.',
        resultContentType: 'rich_content',
        resultData: {
          title: 'Diagram',
          body: 'Stored result.',
        },
        createdAt: '2026-04-17T22:18:25.000Z',
        updatedAt: '2026-04-17T22:18:25.000Z',
      },
    });

    expect(window.__tribexAiState.getThread('thread-1')).toMatchObject({
      lastActivityAt: '2026-04-17T22:18:22.000Z',
    });
  });

  it('does not sync active thread busy metadata for hydration alone', async function () {
    var fetchThreadResolve;
    var fetchThreadPromise = new Promise(function (resolve) {
      fetchThreadResolve = resolve;
    });

    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'Busy Thread' },
        ]);
      }),
      fetchThread: vi.fn(function () {
        return fetchThreadPromise;
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });

    expect(window.__companionUtils.updateSessionMetadata).not.toHaveBeenCalledWith('session-1', {
      busyIndicator: {
        kind: 'line-pulse',
        status: 'busy',
      },
    });

    fetchThreadResolve({
      id: 'thread-1',
      title: 'Busy Thread',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      messages: [],
    });
    await fetchThreadPromise;
    await Promise.resolve();
    await Promise.resolve();

    expect(window.__companionUtils.updateSessionMetadata).toHaveBeenLastCalledWith('session-1', {
      busyIndicator: null,
    });
  });

  it('clears the top busy metadata when switching away from a pending thread', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'Pending Thread' },
          { id: 'thread-2', projectId: 'project-1', workspaceId: 'workspace-1', title: 'Quiet Thread' },
        ]);
      }),
      fetchThread: vi.fn(function (threadId) {
        return Promise.resolve({
          id: threadId,
          title: threadId === 'thread-1' ? 'Pending Thread' : 'Quiet Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      registerDesktopRelay: vi.fn(function () {
        return Promise.resolve({
          relaySession: { id: 'relay-session-1' },
          relayDeviceId: 'device-1',
        });
      }),
      startDesktopRelayStream: vi.fn(function () {
        return Promise.resolve();
      }),
      startDesktopPresenceHeartbeat: vi.fn(function () {
        return Promise.resolve();
      }),
      disconnectRuntime: vi.fn(),
      sendMessage: vi.fn(function () {
        return Promise.resolve({
          turnId: 'turn-1',
          done: new Promise(function () {}),
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopRelayEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      listenToDesktopPresenceEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    await window.__tribexAiState.submitPrompt('thread-1', 'Keep working');

    expect(window.__companionUtils.updateSessionMetadata).toHaveBeenCalledWith('session-1', {
      busyIndicator: {
        kind: 'line-pulse',
        status: 'busy',
      },
    });

    window.__tribexAiState.openThread('thread-2', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(window.__companionUtils.updateSessionMetadata).toHaveBeenLastCalledWith('session-1', {
      busyIndicator: null,
    });
    expect(window.__tribexAiState.getThreadContext('thread-1').pending).toBe(true);
    expect(window.__tribexAiState.getThread('thread-1')).toMatchObject({
      rowState: 'pending',
    });
    expect(window.__tribexAiState.getThreadContext('thread-2').pending).toBe(false);
  });

  it('shows the top busy metadata after switching to a thread with a running active turn', async function () {
    var client = {
      getConfig: vi.fn(function () {
        return Promise.resolve({ configured: true });
      }),
      fetchSession: vi.fn(function () {
        return Promise.resolve({ user: { id: 'user-1' } });
      }),
      fetchOrganizations: vi.fn(function () {
        return Promise.resolve([{ id: 'org-1', name: 'Org 1' }]);
      }),
      fetchWorkspaces: vi.fn(function () {
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1', packageKey: 'generic' }]);
      }),
      fetchProjects: vi.fn(function () {
        return Promise.resolve([{
          id: 'project-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          name: 'General',
          workspaceName: 'Workspace 1',
        }]);
      }),
      fetchThreads: vi.fn(function () {
        return Promise.resolve([
          { id: 'thread-1', projectId: 'project-1', workspaceId: 'workspace-1', title: 'Quiet Thread' },
          {
            id: 'thread-2',
            projectId: 'project-1',
            workspaceId: 'workspace-1',
            title: 'Running Thread',
            activeTurn: {
              turnId: 'turn-2',
              status: 'running',
            },
          },
        ]);
      }),
      fetchThread: vi.fn(function (threadId) {
        return Promise.resolve({
          id: threadId,
          title: threadId === 'thread-2' ? 'Running Thread' : 'Quiet Thread',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          messages: [],
        });
      }),
      listenToStreamEvents: vi.fn(function () {
        return Promise.resolve(function () {});
      }),
      normalizeThreadDetail: function (value) { return value; },
      normalizeMessage: function (value) { return value; },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(window.__companionUtils.updateSessionMetadata).toHaveBeenLastCalledWith('session-1', {
      busyIndicator: null,
    });

    window.__tribexAiState.openThread('thread-2', { connectStream: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(window.__companionUtils.updateSessionMetadata).toHaveBeenLastCalledWith('session-1', {
      busyIndicator: {
        kind: 'line-pulse',
        status: 'busy',
      },
    });
  });
});
