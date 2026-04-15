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
      runSmokeTest: vi.fn(function () {
        return Promise.resolve({
          thread: {
            id: 'thread-smoke-1',
            projectId: 'project-smoke',
            workspaceId: 'workspace-smoke',
            messages: [],
          },
        });
      }),
      sendMessage: vi.fn(),
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
    expect(client.createCompanionSession).toHaveBeenCalledWith(
      'workspace-smoke',
      'thread-smoke-1',
    );
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
    expect(client.runSmokeTest).toHaveBeenCalledWith('thread-smoke-1', 'rule-skill-echo');
    expect(window.__companionUtils.openSession).toHaveBeenCalled();

    relayHandler({ relayId: 'thread-smoke-1', type: 'status', status: 'connected' });
    presenceHandler({ heartbeatId: 'thread-smoke-1', type: 'status', status: 'running' });

    expect(window.__tribexAiState.getThreadContext('thread-smoke-1').relayStatus).toBe('online');

    relayHandler({ relayId: 'thread-smoke-1', type: 'error', message: 'relay failed' });
    expect(window.__tribexAiState.getThreadContext('thread-smoke-1').relayStatus).toBe('error');
  });

  it('previews smoke rich_content companion payloads locally', async function () {
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

    streamHandler({
      threadId: 'thread-1',
      type: 'data',
      payload: {
        toolName: 'rich_content',
        result: {
          data: {
            title: 'Smoke Test Passed',
            body: 'Runtime: `ai-sdk-runner`',
          },
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4200/api/push',
      expect.objectContaining({
        method: 'POST',
      }),
    );
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
});
