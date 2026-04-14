import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
        return Promise.resolve([{ id: 'workspace-1', organizationId: 'org-1', name: 'Workspace 1' }]);
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
    expect(client.createThread).toHaveBeenCalledWith('project-1');
    expect(window.__companionUtils.openSession).toHaveBeenCalled();
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
