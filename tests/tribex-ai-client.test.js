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
});
