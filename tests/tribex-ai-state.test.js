import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var utilsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-utils.js'), 'utf8');
var stateCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-state.js'), 'utf8');

function loadUtils() {
  new Function(utilsCode).call(globalThis);
}

function loadState() {
  new Function(stateCode).call(globalThis);
}

beforeEach(function () {
  delete window.__tribexAiUtils;
  delete window.__tribexAiState;

  window.__companionUtils = {
    openSession: vi.fn(function () { return 'session-1'; }),
    replaceSession: vi.fn(function () { return 'session-1'; }),
    syncThreadArtifactDrawer: vi.fn(function (payload) { return payload && payload.drawerId ? payload.drawerId : 'drawer-1'; }),
    selectThreadArtifact: vi.fn(),
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
    expect(client.createThread).toHaveBeenCalledWith('project-1', 'New chat');
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

  it('routes runtime rich_content companion payloads into a work session and thread artifact drawer', async function () {
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
    window.__companionUtils.syncThreadArtifactDrawer.mockClear();

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
    expect(window.__companionUtils.syncThreadArtifactDrawer).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        drawerId: 'tribex-ai-thread-artifacts:thread-1',
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            artifactKey: expect.stringContaining('tribex-ai-result:thread-1'),
            contentType: 'rich_content',
            data: expect.objectContaining({
              title: 'Smoke Test Passed',
            }),
          }),
        ]),
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
          artifactDrawerId: 'tribex-ai-thread-artifacts:thread-1',
          artifactKey: expect.stringContaining('tribex-ai-result:thread-1'),
        }),
      ]),
    );
  });

  it('opens a thread artifact drawer for runtime rich_content activity updates', async function () {
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
    window.__companionUtils.syncThreadArtifactDrawer.mockClear();

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

    expect(window.__companionUtils.syncThreadArtifactDrawer).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            artifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-1',
            contentType: 'rich_content',
            data: expect.objectContaining({
              title: 'Example Architecture Document',
            }),
          }),
        ]),
      }),
    );

    expect(window.__tribexAiState.getThreadContext('thread-1').thread.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'rich_content',
          artifactDrawerId: 'tribex-ai-thread-artifacts:thread-1',
          artifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-1',
          resultContentType: 'rich_content',
        }),
      ]),
    );
  });

  it('keeps multiple thread artifacts in one drawer payload for the same thread', async function () {
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
    window.__companionUtils.syncThreadArtifactDrawer.mockClear();

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

    expect(window.__companionUtils.syncThreadArtifactDrawer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        threadId: 'thread-1',
        drawerId: 'tribex-ai-thread-artifacts:thread-1',
        artifacts: expect.arrayContaining([
          expect.objectContaining({ title: 'Architecture Overview' }),
          expect.objectContaining({ title: 'Deployment Diagram' }),
        ]),
      }),
    );
    expect(window.__tribexAiState.getThreadContext('thread-1').thread.artifactDrawer).toEqual(
      expect.objectContaining({
        drawerId: 'tribex-ai-thread-artifacts:thread-1',
        selectedArtifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-2',
      }),
    );
  });

  it('does not open a thread artifact drawer for failed runtime rich_content activity', async function () {
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
    window.__companionUtils.syncThreadArtifactDrawer.mockClear();

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

    expect(window.__companionUtils.syncThreadArtifactDrawer).not.toHaveBeenCalled();
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
      normalizeMessage: function (value) { return value; },
      shouldPreviewCompanionPayload: function (value) {
        return value && value.toolName === 'rich_content';
      },
    };

    window.__tribexAiClient = client;
    loadState();

    await window.__tribexAiState.refreshNavigator(true);
    window.__tribexAiState.openThread('thread-1', { connectStream: false });

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

    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    window.__tribexAiState.setSearchTerm('finance');

    expect(window.__companionUtils.rerenderActiveSession).toHaveBeenCalled();
    expect(window.__companionUtils.refreshActiveSession).not.toHaveBeenCalled();
  });

  it('scopes navigator projects and threads to the selected workspace', async function () {
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
    expect(firstSnapshot.projectGroups).toHaveLength(1);
    expect(firstSnapshot.projectGroups[0].project.id).toBe('project-1');

    await window.__tribexAiState.selectWorkspace('workspace-2');
    var secondSnapshot = window.__tribexAiState.getSnapshot();
    expect(secondSnapshot.selectedWorkspace).toMatchObject({ id: 'workspace-2' });
    expect(secondSnapshot.projectGroups).toHaveLength(1);
    expect(secondSnapshot.projectGroups[0].project.id).toBe('project-2');
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
    expect(client.createThread).toHaveBeenCalledWith('project-2', 'New chat');
    expect(snapshot.selectedProject).toMatchObject({ id: 'project-2' });
    expect(snapshot.projectExpansion['project-2']).toBe(true);
  });
});
