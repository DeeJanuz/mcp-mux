import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTribexAiState as loadState, loadTribexAiUtils as loadUtils } from './helpers/tribex-ai-state-loader.js';

beforeEach(function () {
  delete window.__tribexAiUtils;
  delete window.__tribexAiState;

  window.__companionUtils = {
    openSession: vi.fn(function () { return 'session-1'; }),
    replaceSession: vi.fn(function () { return 'session-1'; }),
    getSession: vi.fn(function () { return null; }),
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
      { validationProfile: 'rule-skill-echo' },
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

  it('turns local desktop relay tool requests into visible work-session activity and reopenable structured-data artifacts', async function () {
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
    expect(thread.runs[0].workSession).toMatchObject({
      status: 'completed',
      items: [
        expect.objectContaining({
          toolName: 'structured_data',
          status: 'completed',
        }),
      ],
    });
    expect(thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentType: 'structured_data',
          data: expect.objectContaining({
            title: 'Finance Review',
            tables: expect.any(Array),
          }),
        }),
      ]),
    );
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'structured_data',
      }),
      expect.objectContaining({
        autoFocus: true,
      }),
    );
  });

  it('routes thread-scoped rich_content companion payloads into a work session and reopenable artifact tab state', async function () {
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
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: expect.stringContaining('tribex-ai-artifact:thread-1:tribex-ai-result:thread-1'),
        contentType: 'rich_content',
        data: expect.objectContaining({
          title: 'Smoke Test Passed',
        }),
        meta: expect.objectContaining({
          aiView: 'thread-artifact',
          threadId: 'thread-1',
          artifactSource: 'tribex-ai-thread-result',
        }),
      }),
      expect.objectContaining({
        autoFocus: true,
      }),
    );
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
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.runs[0].workSession.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'rich_content',
          artifactKey: expect.stringContaining('tribex-ai-result:thread-1'),
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKey: expect.stringContaining('tribex-ai-result:thread-1'),
          contentType: 'rich_content',
          data: expect.objectContaining({
            title: 'Smoke Test Passed',
          }),
        }),
      ]),
    );
  });

  it('opens a focused artifact tab for runtime rich_content activity updates', async function () {
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

    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'tribex-ai-artifact:thread-1:tribex-ai-result:thread-1:turn-1:tool-push-1',
        contentType: 'rich_content',
        data: expect.objectContaining({
          title: 'Example Architecture Document',
        }),
        meta: expect.objectContaining({
          aiView: 'thread-artifact',
          threadId: 'thread-1',
          artifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-1',
        }),
      }),
      expect.objectContaining({
        autoFocus: true,
      }),
    );

    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'rich_content',
          artifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-1',
          resultContentType: 'rich_content',
        }),
      ]),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-1',
          sessionKey: 'tribex-ai-artifact:thread-1:tribex-ai-result:thread-1:turn-1:tool-push-1',
          contentType: 'rich_content',
        }),
      ]),
    );

    window.__companionUtils.openSession.mockClear();
    window.__tribexAiState.openThreadArtifact('thread-1', 'tribex-ai-result:thread-1:turn-1:tool-push-1');
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'tribex-ai-artifact:thread-1:tribex-ai-result:thread-1:turn-1:tool-push-1',
        contentType: 'rich_content',
        data: expect.objectContaining({
          title: 'Example Architecture Document',
        }),
      }),
      expect.objectContaining({
        autoFocus: true,
      }),
    );
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

  it('keeps multiple thread artifacts as distinct reopenable artifact tabs for the same thread', async function () {
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

    expect(window.__companionUtils.openSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionKey: 'tribex-ai-artifact:thread-1:tribex-ai-result:thread-1:turn-1:tool-push-1',
        contentType: 'rich_content',
        data: expect.objectContaining({ title: 'Architecture Overview' }),
      }),
      expect.objectContaining({ autoFocus: true }),
    );
    expect(window.__companionUtils.openSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionKey: 'tribex-ai-artifact:thread-1:tribex-ai-result:thread-1:turn-1:tool-push-2',
        contentType: 'rich_content',
        data: expect.objectContaining({ title: 'Deployment Diagram' }),
      }),
      expect.objectContaining({ autoFocus: true }),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifactDrawer).toEqual(
      expect.objectContaining({
        drawerId: 'tribex-ai-thread-artifacts:thread-1',
        selectedArtifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-2',
      }),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Architecture Overview' }),
        expect.objectContaining({ title: 'Deployment Diagram' }),
      ]),
    );
  });

  it('preserves a completed runtime artifact after the follow-up runtime snapshot', async function () {
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
    expect(thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-1',
          title: 'Runtime Architecture',
          contentType: 'rich_content',
          data: expect.objectContaining({
            title: 'Runtime Architecture',
          }),
        }),
      ]),
    );
    expect(thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool-push-1',
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

  it('keeps the completed work-session duration pinned to the turn finish time', async function () {
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
        updatedAt: '2026-04-15T10:41:01.000Z',
      },
    });
    runtimeHandler({
      type: 'assistant_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-15T10:41:03.000Z',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done.',
        createdAt: '2026-04-15T10:41:03.000Z',
      },
    });
    runtimeHandler({
      type: 'turn_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-15T10:41:09.000Z',
    });

    expect(window.__tribexAiState.getThreadContext('thread-1').thread.runs[0].workSession).toMatchObject({
      status: 'completed',
      startedAt: '2026-04-15T10:41:01.000Z',
      endedAt: '2026-04-15T10:41:09.000Z',
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

    expect(window.__companionUtils.openSession).toHaveBeenCalledTimes(1);
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKey: 'tribex-ai-result:thread-1:ordinal-0:tool-smoke-1',
          contentType: 'rich_content',
          data: expect.objectContaining({
            title: 'Smoke Test Passed',
          }),
        }),
      ]),
    );
  });

  it('opens structured_data push_content results as artifact tabs without syncing the thread drawer', async function () {
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

    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'structured_data',
        data: expect.objectContaining({
          title: 'Expense Review',
          tables: [{
            id: 'table-1',
            name: 'Expenses',
            columns: [{ id: 'amount', name: 'Amount' }],
            rows: [],
          }],
        }),
      }),
      expect.objectContaining({ autoFocus: true }),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentType: 'structured_data',
          data: expect.objectContaining({
            title: 'Expense Review',
            tables: expect.any(Array),
          }),
        }),
      ]),
    );
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
});
