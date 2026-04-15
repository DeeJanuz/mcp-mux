import './tribex-ai-client-setup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(function () {
  vi.restoreAllMocks();
});

describe('tribex-ai-client', function () {
  it('suppresses preview panes for dotted lifecycle companion events', function () {
    expect(window.__tribexAiClient.shouldPreviewCompanionPayload({
      toolName: 'opencode.thread.execution.started',
      result: {
        data: { contentLength: 42 },
        meta: { phase: 'started' },
      },
    })).toBe(false);
  });

  it('keeps preview panes for renderer-like companion payloads', function () {
    expect(window.__tribexAiClient.shouldPreviewCompanionPayload({
      toolName: 'rich_content',
      result: {
        data: { title: 'Ready', body: 'Sandbox is ready.' },
      },
    })).toBe(true);
  });

  it('derives readable tool event copy from hosted execution lifecycle payloads', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'opencode.thread.execution.completed',
      result: {
        data: {
          assistantContentPreview: 'Drafted the finance summary.',
        },
        meta: {
          phase: 'completed',
        },
      },
    }, 0)).toMatchObject({
      role: 'tool',
      summary: 'Hosted execution completed',
      detail: 'Drafted the finance summary.',
    });
  });

  it('describes hosted execution start without sandbox language', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'opencode.thread.execution.started',
      result: {
        data: {
          contentLength: 42,
        },
        meta: {
          phase: 'started',
        },
      },
    }, 0)).toMatchObject({
      role: 'tool',
      summary: 'Starting hosted execution',
      detail: 'Submitting 42 characters to the hosted runtime.',
    });
  });

  it('preserves renderer payloads for inline rich content rendering', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'rich_content',
      toolArgs: { threadId: 'thread-1' },
      sequence: 9,
      result: {
        data: {
          title: 'Smoke Test Passed',
          body: 'Runtime: `ai-sdk-runner`',
        },
        meta: {
          status: 'passed',
        },
      },
    }, 0)).toMatchObject({
      role: 'tool',
      toolName: 'rich_content',
      toolArgs: { threadId: 'thread-1' },
      resultData: {
        title: 'Smoke Test Passed',
        body: 'Runtime: `ai-sdk-runner`',
      },
      resultMeta: {
        status: 'passed',
      },
      sequence: 9,
    });
  });

  it('uses the deployed root routes for thread detail and message requests', async function () {
    var invoke = vi.fn(function (_command, args) {
      if (args.path === '/threads/thread-123') {
        return Promise.resolve({
          id: 'thread-123',
          title: 'Finance thread',
          messages: [],
        });
      }
      if (args.path === '/threads/thread-123/messages') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected path: ' + args.path));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };

    await expect(window.__tribexAiClient.fetchThread('thread-123')).resolves.toMatchObject({
      id: 'thread-123',
      title: 'Finance thread',
    });
    await expect(window.__tribexAiClient.sendMessage('thread-123', 'hello')).resolves.toEqual({ ok: true });

    expect(invoke).toHaveBeenNthCalledWith(1, 'first_party_ai_request', expect.objectContaining({
      method: 'GET',
      path: '/threads/thread-123',
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, 'first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/threads/thread-123/messages',
      body: { content: 'hello' },
    }));
  });

  it('creates titled threads and calls the dedicated smoke endpoint', async function () {
    var invoke = vi.fn(function (_command, args) {
      if (args.path === '/projects/project-123/threads') {
        return Promise.resolve({
          id: 'thread-123',
          title: 'Smoke Test 2026-04-14 12:00',
        });
      }
      if (args.path === '/threads/thread-123/smoke') {
        return Promise.resolve({
          assistantMessage: { id: 'assistant-1' },
          smokeReport: { status: 'passed' },
        });
      }
      return Promise.reject(new Error('Unexpected path: ' + args.path));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };

    await expect(
      window.__tribexAiClient.createThread('project-123', 'Smoke Test 2026-04-14 12:00'),
    ).resolves.toMatchObject({
      id: 'thread-123',
      title: 'Smoke Test 2026-04-14 12:00',
    });
    await expect(
      window.__tribexAiClient.runSmokeTest('thread-123', 'rule-skill-echo'),
    ).resolves.toMatchObject({
      smokeReport: { status: 'passed' },
    });

    expect(invoke).toHaveBeenNthCalledWith(1, 'first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/projects/project-123/threads',
      body: { title: 'Smoke Test 2026-04-14 12:00' },
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, 'first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/threads/thread-123/smoke',
      body: { smokeKey: 'rule-skill-echo' },
    }));
  });

  it('creates thread-scoped companion sessions with the thread id in the request body', async function () {
    var invoke = vi.fn(function (_command, args) {
      if (args.path === '/workspaces/workspace-123/companion-sessions') {
        return Promise.resolve({
          id: 'companion-1',
          streamKey: 'stream-1',
        });
      }
      return Promise.reject(new Error('Unexpected path: ' + args.path));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };

    await expect(
      window.__tribexAiClient.createCompanionSession('workspace-123', 'thread-123'),
    ).resolves.toMatchObject({
      id: 'companion-1',
      companionKey: 'stream-1',
    });

    expect(invoke).toHaveBeenCalledWith('first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/workspaces/workspace-123/companion-sessions',
      body: {
        threadId: 'thread-123',
        metadata: {},
      },
    }));
  });

  it('calls the desktop relay tauri commands for registration, refresh, stream, and heartbeat', async function () {
    var invoke = vi.fn(function () {
      return Promise.resolve({ ok: true });
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };

    await window.__tribexAiClient.registerDesktopRelay({
      workspaceId: 'workspace-123',
      deviceKey: 'device-12345678',
      label: 'MacBook Pro',
      platform: 'macos',
    });
    await window.__tribexAiClient.refreshDesktopRelay({
      purpose: 'mcp-proxy',
    });
    await window.__tribexAiClient.startDesktopRelayStream('relay-1', '/api/desktop-relay/stream', {
      threadId: 'thread-123',
    });
    await window.__tribexAiClient.startDesktopPresenceHeartbeat(
      'heartbeat-1',
      30,
      { status: 'ONLINE' },
      '/api/desktop-relay/presence',
    );
    await window.__tribexAiClient.stopDesktopRelayStream('relay-1');
    await window.__tribexAiClient.stopDesktopPresenceHeartbeat('heartbeat-1');

    expect(invoke).toHaveBeenNthCalledWith(1, 'register_first_party_ai_desktop_relay', {
      body: {
        workspaceId: 'workspace-123',
        deviceKey: 'device-12345678',
        label: 'MacBook Pro',
        platform: 'macos',
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'refresh_first_party_ai_desktop_relay', {
      body: {
        purpose: 'mcp-proxy',
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'start_first_party_ai_desktop_relay_stream', {
      streamId: 'relay-1',
      path: '/api/desktop-relay/stream',
      query: {
        threadId: 'thread-123',
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, 'start_first_party_ai_desktop_presence_heartbeat', {
      heartbeatId: 'heartbeat-1',
      path: '/api/desktop-relay/presence',
      intervalSecs: 30,
      body: {
        status: 'ONLINE',
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(5, 'stop_first_party_ai_desktop_relay_stream', {
      streamId: 'relay-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(6, 'stop_first_party_ai_desktop_presence_heartbeat', {
      heartbeatId: 'heartbeat-1',
    });
  });

  it('subscribes to desktop relay and presence event channels', async function () {
    var listen = vi.fn(function (_eventName, handler) {
      handler({ payload: { ok: true } });
      return Promise.resolve(function () {});
    });
    var relayHandler = vi.fn();
    var presenceHandler = vi.fn();

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      event: {
        listen: listen,
      },
    };

    await window.__tribexAiClient.listenToDesktopRelayEvents(relayHandler);
    await window.__tribexAiClient.listenToDesktopPresenceEvents(presenceHandler);

    expect(listen).toHaveBeenNthCalledWith(
      1,
      'first_party_ai_desktop_relay_event',
      expect.any(Function),
    );
    expect(listen).toHaveBeenNthCalledWith(
      2,
      'first_party_ai_desktop_presence_event',
      expect.any(Function),
    );
    expect(relayHandler).toHaveBeenCalledWith({ ok: true });
    expect(presenceHandler).toHaveBeenCalledWith({ ok: true });
  });
});
