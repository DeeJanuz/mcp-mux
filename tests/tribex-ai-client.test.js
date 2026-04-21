import './tribex-ai-client-setup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

var originalFetch = globalThis.fetch;

afterEach(function () {
  if (globalThis.window && globalThis.window.__tribexAiCloudflareBridge) {
    globalThis.window.__tribexAiCloudflareBridge.disconnect('thread-123');
    globalThis.window.__tribexAiCloudflareBridge.disconnect('thread-smoke-1');
  }
  if (globalThis.window) {
    delete globalThis.window.__TAURI__;
    delete globalThis.window.__tribexAiAgentClientCtor;
  }
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createRuntimeSessionEnvelope(threadId) {
  return {
    runtimeSession: {
      provider: 'CLOUDFLARE_AGENTS',
      transport: 'DIRECT_CLIENT',
      connection: {
        transport: 'websocket',
        host: 'https://agents.dev.example.workers.dev',
        agent: 'FinanceAgent',
        name: 'thread_' + threadId,
        path: null,
        query: {
          token: 'runtime-token',
        },
      },
      expiresAt: '2099-04-15T00:00:00.000Z',
      instanceId: 'thread_' + threadId,
      metadata: {},
    },
    relay: {
      bridge: {
        relaySessionId: 'relay-session-1',
        requestUrl: 'http://127.0.0.1:3000/api/desktop-relay/tool-request',
        requestToken: 'relay-token',
        timeoutMs: 120000,
      },
      catalog: null,
    },
  };
}

function createLocalCatalogResponse(extra) {
  return Object.assign({
    connectors: [
      {
        key: 'mcpviews-core',
        label: 'MCPViews Core',
        namespaces: ['mcpviews', 'renderers'],
        capabilities: ['rich-content', 'discovery'],
        authState: 'available',
        discoveryState: 'breadcrumb',
        toolCount: 7,
        tools: [
          {
            name: 'rich_content',
            description: 'Display rich markdown content in MCPViews.',
            inputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                body: { type: 'string' },
              },
            },
          },
          {
            name: 'describe_connector',
            description: 'Describe a hosted breadcrumb connector.',
            inputSchema: {
              type: 'object',
              required: ['key'],
            },
          },
          {
            name: 'push_review',
            description: 'Display content for user review.',
            inputSchema: {
              type: 'object',
            },
          },
          {
            name: 'await_review',
            description: 'Wait for a review decision.',
            inputSchema: {
              type: 'object',
            },
          },
          {
            name: 'push_check',
            description: 'Check the current review status.',
            inputSchema: {
              type: 'object',
            },
          },
        ],
        toolGroups: [
          {
            name: 'Presentation',
            hint: 'Render content in MCPViews.',
            tools: [
              {
                name: 'rich_content',
                description: 'Display rich markdown content in MCPViews.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    body: { type: 'string' },
                  },
                },
              },
              {
                name: 'structured_data',
                description: 'Display interactive structured data in MCPViews.',
                inputSchema: {
                  type: 'object',
                  required: ['tables'],
                },
              },
            ],
          },
        ],
      },
    ],
    tools: [
      {
        name: 'init_session',
        description: 'Initializes MCPViews tool rules.',
        inputSchema: { type: 'object' },
      },
      {
        name: 'rule-skill-echo',
        description: 'Validates the loaded rule and skill bundle.',
        inputSchema: { type: 'object' },
      },
      {
        name: 'rich_content',
        description: 'Display rich markdown content in MCPViews.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
          },
        },
      },
      {
        name: 'structured_data',
        description: 'Display interactive structured data in MCPViews.',
        inputSchema: {
          type: 'object',
          required: ['tables'],
        },
      },
      {
        name: 'describe_connector',
        description: 'Describe a hosted breadcrumb connector.',
        inputSchema: {
          type: 'object',
          required: ['key'],
        },
      },
      {
        name: 'push_review',
        description: 'Display content for user review.',
        inputSchema: {
          type: 'object',
        },
      },
      {
        name: 'await_review',
        description: 'Wait for a review decision.',
        inputSchema: {
          type: 'object',
        },
      },
      {
        name: 'push_check',
        description: 'Check the current review status.',
        inputSchema: {
          type: 'object',
        },
      },
    ],
  }, extra || {});
}

function createAgentClientCtor(handlers) {
  var instances = [];

  function FakeAgentClient(options) {
    this.options = options;
    this.readyState = 1;
    this.listeners = {
      message: new Set(),
      close: new Set(),
    };
    this.sentPayloads = [];
    this.addEventListener = vi.fn(function (type, listener) {
      if (!this.listeners[type]) {
        this.listeners[type] = new Set();
      }
      this.listeners[type].add(listener);
    }.bind(this));
    this.removeEventListener = vi.fn(function (type, listener) {
      if (!this.listeners[type]) return;
      this.listeners[type].delete(listener);
    }.bind(this));
    this.emit = function (type, payload) {
      if (!this.listeners[type]) return;
      this.listeners[type].forEach(function (listener) {
        listener(payload);
      });
    }.bind(this);
    this.send = vi.fn(function (raw) {
      this.sentPayloads.push(raw);
      var payload = JSON.parse(raw);
      var handlerResult;
      if (handlers && typeof handlers.onChatRequest === 'function') {
        handlerResult = handlers.onChatRequest(payload, this);
      }
      if (handlerResult !== false && payload && payload.type === 'cf_agent_use_chat_request') {
        this.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: true,
            body: '',
          }),
        });
      }
    }.bind(this));
    this.close = vi.fn(function () {
      this.readyState = 3;
      this.emit('close', {});
      if (typeof options.onClose === 'function') {
        options.onClose();
      }
    }.bind(this));
    this.stub = {
      getMessages: vi.fn(handlers && handlers.getMessages
        ? handlers.getMessages
        : function () {
          return Promise.resolve([]);
        }),
      submitUserMessage: vi.fn(handlers && handlers.submitUserMessage
        ? handlers.submitUserMessage
        : function () {
          return Promise.resolve({ messages: [] });
        }),
    };
    this.ready = Promise.resolve().then(function () {
      if (typeof options.onOpen === 'function') {
        options.onOpen();
      }
      if (typeof options.onIdentity === 'function') {
        options.onIdentity(options.name, options.agent);
      }
    });
    instances.push(this);
  }

  FakeAgentClient.instances = instances;
  return FakeAgentClient;
}

describe('tribex-ai-client', function () {
  it('waits for a loopback runtime host to become reachable before opening the websocket client', async function () {
    vi.useFakeTimers();
    var invoke = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(undefined);
    var FakeAgentClient = createAgentClientCtor();

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var connectPromise = window.__tribexAiCloudflareBridge.connect({
      threadId: 'thread-123',
      connection: {
        transport: 'websocket',
        host: 'http://127.0.0.1:8787',
        agent: 'PersonaHarnessAgent',
        name: 'thread_thread-123',
        query: {
          token: 'runtime-token',
        },
      },
    });

    await vi.runAllTimersAsync();

    await expect(connectPromise).resolves.toBe(FakeAgentClient.instances[0]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith(
      'probe_local_runtime_host',
      expect.objectContaining({
        url: 'http://127.0.0.1:8787/__runtime-session-probe',
        token: 'runtime-token',
        timeoutMs: 1000,
      }),
    );
    expect(FakeAgentClient.instances).toHaveLength(1);
    expect(FakeAgentClient.instances[0].options).toMatchObject({
      host: '127.0.0.1:8787',
      agent: 'PersonaHarnessAgent',
      name: 'thread_thread-123',
    });
  });

  it('fails cleanly without opening a websocket when the loopback runtime host never becomes reachable', async function () {
    vi.useFakeTimers();
    var invoke = vi.fn().mockRejectedValue(new TypeError('probe failed'));
    var FakeAgentClient = createAgentClientCtor();

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var connectPromise = window.__tribexAiCloudflareBridge.connect({
      threadId: 'thread-123',
      connection: {
        transport: 'websocket',
        host: 'http://127.0.0.1:8787',
        agent: 'PersonaHarnessAgent',
        name: 'thread_thread-123',
        query: {
          token: 'runtime-token',
        },
      },
    });
    var rejection = expect(connectPromise).rejects.toThrow('Local runtime host is unavailable at 127.0.0.1:8787');

    await vi.runAllTimersAsync();

    await rejection;
    expect(invoke.mock.calls.length).toBeGreaterThan(1);
    expect(FakeAgentClient.instances).toHaveLength(0);
  });

  it('sends the project title under compatible field names when creating a project and preserves it when the immediate response is sparse', async function () {
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/workspaces/workspace-123/projects') {
        return Promise.resolve({
          id: 'project-123',
        });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };

    await expect(
      window.__tribexAiClient.createProject(
        { id: 'workspace-123', organizationId: 'org-1', name: 'Workspace 123' },
        'Finance Planning',
      ),
    ).resolves.toMatchObject({
      id: 'project-123',
      name: 'Finance Planning',
    });

    expect(invoke).toHaveBeenCalledWith('first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/workspaces/workspace-123/projects',
      body: {
        name: 'Finance Planning',
        title: 'Finance Planning',
        projectName: 'Finance Planning',
      },
    }));
  });

  it('renames a project through the hosted control plane and preserves the requested name when the response is sparse', async function () {
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/projects/project-123') {
        return Promise.resolve({
          id: 'project-123',
        });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };

    await expect(
      window.__tribexAiClient.renameProject(
        { id: 'workspace-123', organizationId: 'org-1', name: 'Workspace 123' },
        'project-123',
        'Forecasting',
      ),
    ).resolves.toMatchObject({
      id: 'project-123',
      name: 'Forecasting',
    });

    expect(invoke).toHaveBeenCalledWith('first_party_ai_request', expect.objectContaining({
      method: 'PATCH',
      path: '/projects/project-123',
      body: {
        name: 'Forecasting',
      },
    }));
  });

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

  it('treats thread-scoped rich content as a previewable artifact session', function () {
    expect(window.__tribexAiClient.shouldPreviewCompanionPayload({
      toolName: 'rich_content',
      toolArgs: { threadId: 'thread-1' },
      result: {
        data: { title: 'Smoke Test Passed', body: 'All checks passed.' },
      },
    })).toBe(true);

    expect(window.__tribexAiClient.shouldPreviewCompanionPayload({
      toolName: 'rich_content',
      toolArgs: { threadId: 'thread-1' },
      result: {
        data: { title: 'Review Needed', body: 'Open this separately.' },
        meta: { previewPane: true },
      },
    })).toBe(true);
  });

  it('times out a runtime connection that never becomes ready instead of leaving the turn pending forever', async function () {
    vi.useFakeTimers();

    function HangingAgentClient(options) {
      this.options = options;
      this.readyState = 0;
      this.listeners = {
        message: new Set(),
        close: new Set(),
      };
      this.addEventListener = vi.fn(function (type, listener) {
        if (!this.listeners[type]) this.listeners[type] = new Set();
        this.listeners[type].add(listener);
      }.bind(this));
      this.send = vi.fn();
      this.close = vi.fn(function () {
        this.readyState = 3;
        if (typeof options.onClose === 'function') {
          options.onClose();
        }
      }.bind(this));
      this.stub = {
        getMessages: vi.fn(function () {
          return Promise.resolve([]);
        }),
      };
      this.ready = new Promise(function () {});
    }

    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = HangingAgentClient;

    var sendPromise = window.__tribexAiClient.sendMessage('thread-123', 'hello').catch(function (error) {
      return error;
    });
    await vi.advanceTimersByTimeAsync(10001);

    await expect(sendPromise).resolves.toBeInstanceOf(Error);
    await expect(sendPromise).resolves.toMatchObject({
      message: 'Runtime connection timed out.',
    });
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

  it('allows queue-only sends while a runtime turn is active', async function () {
    var requests = [];
    var FakeAgentClient = createAgentClientCtor({
      onChatRequest: function (payload) {
        requests.push(payload);
        return false;
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var firstTurn = await window.__tribexAiClient.sendMessage('thread-123', 'Start the report', {
      turnId: 'turn-1',
    });
    expect(firstTurn.turnId).toBe('turn-1');
    firstTurn.done.catch(function () {});

    await expect(window.__tribexAiClient.sendMessage('thread-123', 'Use the newer revenue number.', {
      turnId: 'turn-2',
      messageId: 'user-2',
      waitForStable: false,
    })).resolves.toMatchObject({
      turnId: 'turn-2',
      messageId: 'user-2',
      queued: true,
    });

    expect(requests).toHaveLength(2);
    var queuedBody = JSON.parse(requests[1].init.body);
    expect(queuedBody).toMatchObject({
      text: 'Use the newer revenue number.',
      messageId: 'user-2',
      waitForStable: false,
    });
    expect(queuedBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'user-2', role: 'user' }),
    ]));
  });

  it('keeps waitForStable=false sends queue-only before active turn state exists', async function () {
    var requests = [];
    var FakeAgentClient = createAgentClientCtor({
      onChatRequest: function (payload) {
        requests.push(payload);
        return false;
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    await window.__tribexAiCloudflareBridge.connect({
      threadId: 'thread-123',
      connection: createRuntimeSessionEnvelope('thread-123').runtimeSession.connection,
    });

    await expect(window.__tribexAiClient.sendMessage('thread-123', 'Use the newer revenue number.', {
      turnId: 'turn-queued',
      messageId: 'user-queued',
      waitForStable: false,
    })).resolves.toMatchObject({
      turnId: 'turn-queued',
      messageId: 'user-queued',
      queued: true,
    });

    var queuedBody = JSON.parse(requests[0].init.body);
    expect(queuedBody).toMatchObject({
      text: 'Use the newer revenue number.',
      messageId: 'user-queued',
      waitForStable: false,
    });

    var activeTurn = await window.__tribexAiClient.sendMessage('thread-123', 'Start after queued context', {
      turnId: 'turn-active',
    });
    expect(activeTurn).toMatchObject({
      turnId: 'turn-active',
    });
    activeTurn.done.catch(function () {});
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
      artifactKey: null,
      inlineDisplay: true,
      resultContentType: 'rich_content',
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

  it('normalizes thread summaries from message activity instead of updatedAt', function () {
    expect(window.__tribexAiClient.normalizeThreadSummary({
      id: 'thread-1',
      title: 'Summary Thread',
      updatedAt: '2026-04-17T22:18:24.000Z',
      createdAt: '2026-04-17T22:18:00.000Z',
      latestMessageAt: '2026-04-17T22:18:22.000Z',
    }, {
      id: 'project-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
    }, 0)).toMatchObject({
      id: 'thread-1',
      messageActivityAt: '2026-04-17T22:18:22.000Z',
      lastActivityAt: '2026-04-17T22:18:22.000Z',
    });
  });

  it('falls back to thread creation time when no explicit message activity is present', function () {
    expect(window.__tribexAiClient.normalizeThreadSummary({
      id: 'thread-2',
      title: 'Fresh Thread',
      updatedAt: '2026-04-17T22:18:24.000Z',
      createdAt: '2026-04-17T22:18:00.000Z',
    }, {
      id: 'project-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
    }, 0)).toMatchObject({
      id: 'thread-2',
      messageActivityAt: '2026-04-17T22:18:00.000Z',
      lastActivityAt: '2026-04-17T22:18:00.000Z',
    });
  });

  it('normalizes thread hierarchy fields from summaries and details', function () {
    var summary = window.__tribexAiClient.normalizeThreadSummary({
      id: 'thread-parent',
      title: 'Coordinator',
      childThreads: [{
        id: 'thread-child',
        title: 'Finance delegate',
      }],
    }, {
      id: 'project-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
    }, 0);

    expect(summary.childThreads[0]).toMatchObject({
      id: 'thread-child',
      parentThreadId: 'thread-parent',
      projectId: 'project-1',
    });

    expect(window.__tribexAiClient.normalizeThreadDetail({
      thread: {
        id: 'thread-child',
        title: 'Finance delegate',
        parentThreadId: 'thread-parent',
      },
      project: {
        id: 'project-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
      },
      messages: [],
    })).toMatchObject({
      id: 'thread-child',
      parentThreadId: 'thread-parent',
    });
  });

  it('normalizes thread detail activity from explicit message timestamps instead of updatedAt', function () {
    expect(window.__tribexAiClient.normalizeThreadDetail({
      thread: {
        id: 'thread-3',
        title: 'Detail Thread',
        updatedAt: '2026-04-17T22:18:24.000Z',
        latestMessageAt: '2026-04-17T22:18:22.000Z',
      },
      project: {
        id: 'project-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
      },
      messages: [],
    })).toMatchObject({
      id: 'thread-3',
      messageActivityAt: '2026-04-17T22:18:22.000Z',
      lastActivityAt: '2026-04-17T22:18:22.000Z',
    });
  });

  it('preserves review session identity for sequenced push_review companion events', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'push_review',
      toolArgs: { threadId: 'thread-1' },
      sessionId: 'review-session-1',
      sequence: 12,
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
    }, 0)).toMatchObject({
      id: 'tool-sequence:thread-1:review-session-1:12',
      role: 'tool',
      toolName: 'structured_data',
      sessionId: 'review-session-1',
      artifactKey: 'tribex-ai-result:thread-1:sequence:12',
      resultContentType: 'structured_data',
      resultMeta: {
        reviewRequired: true,
      },
    });
  });

  it('preserves structured_data payloads and legacy artifact identity for thread-scoped tool messages', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'structured_data',
      toolArgs: { threadId: 'thread-1' },
      result: {
        data: {
          tables: [{
            id: 'table-1',
            name: 'Expenses',
            columns: [{ id: 'amount', name: 'Amount' }],
            rows: [],
          }],
        },
      },
    }, 0)).toMatchObject({
      role: 'tool',
      toolName: 'structured_data',
      resultContentType: 'structured_data',
      artifactKey: null,
      inlineDisplay: true,
      resultData: {
        tables: [{
          id: 'table-1',
          name: 'Expenses',
        }],
      },
    });
  });

  it('unwraps push_content renderer payloads into structured_data tool messages', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'push_content',
      toolArgs: { threadId: 'thread-1' },
      result: {
        data: {
          tool_name: 'structured_data',
          data: {
            title: 'Expense Review',
            tables: [{
              id: 'table-1',
              name: 'Expenses',
              columns: [{ id: 'amount', name: 'Amount' }],
              rows: [{
                id: 'row-1',
                cells: {
                  amount: { value: '$42.00' },
                },
                children: [],
              }],
            }],
          },
          meta: {
            source: 'push-content',
          },
        },
      },
    }, 0)).toMatchObject({
      role: 'tool',
      toolName: 'structured_data',
      resultContentType: 'structured_data',
      artifactKey: null,
      inlineDisplay: true,
      resultMeta: {
        source: 'push-content',
      },
      resultData: {
        title: 'Expense Review',
        tables: [{
          id: 'table-1',
          name: 'Expenses',
          rows: [{
            id: 'row-1',
          }],
        }],
      },
    });
  });

  it('normalizes assistant delta payloads as streaming assistant messages', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      type: 'assistant_delta',
      messageId: 'assistant-1',
      delta: 'Hello',
      createdAt: '2026-04-15T00:00:00.000Z',
    }, 0)).toMatchObject({
      role: 'assistant',
      content: 'Hello',
      messageId: 'assistant-1',
      isStreaming: true,
    });
  });

  it('does not fabricate current timestamps for hydrated runtime messages without createdAt', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T13:07:43.000Z'));

    expect(window.__tribexAiClient.normalizeRuntimeUiMessage({
      id: 'runtime-assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Historical answer.' }],
    }, 0)).toMatchObject({
      id: 'runtime-assistant-1',
      role: 'assistant',
      content: 'Historical answer.',
      createdAt: null,
    });

    var transcript = window.__tribexAiClient.normalizeRuntimeTranscript('thread-1', {
      messages: [{
        id: 'runtime-assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Historical answer.' }],
      }],
    });

    expect(transcript.messageActivityAt).toBeNull();
    expect(transcript.lastActivityAt).toBeNull();
  });

  it('treats assistant_delta companion events as streaming assistant messages and not previews', function () {
    expect(window.__tribexAiClient.shouldPreviewCompanionPayload({
      toolName: 'assistant_delta',
      result: {
        data: {
          type: 'assistant_delta',
          delta: 'Hello',
          messageId: 'assistant-1',
        },
      },
    })).toBe(false);

    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'assistant_delta',
      result: {
        data: {
          type: 'assistant_delta',
          delta: 'Hello',
          messageId: 'assistant-1',
        },
      },
      createdAt: '2026-04-15T00:00:00.000Z',
    }, 0)).toMatchObject({
      role: 'assistant',
      content: 'Hello',
      messageId: 'assistant-1',
      isStreaming: true,
    });
  });

  it('normalizes assistant messages containing serialized companion payloads as tool events', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      role: 'assistant',
      content: JSON.stringify({
        toolName: 'rule-skill-echo',
        toolArgs: { threadId: 'thread-1' },
        result: {
          data: {
            summary: 'Rule + skill echo',
            detail: 'mcpviews.md, smoke-validation.md, rule-skill-echo.md',
          },
        },
        reviewRequired: false,
        timeout: 120000,
      }, null, 2),
      createdAt: '2026-04-15T00:00:00.000Z',
    }, 0)).toMatchObject({
      role: 'tool',
      toolName: 'rule-skill-echo',
      toolArgs: { threadId: 'thread-1' },
      summary: 'Rule + skill echo',
      detail: 'mcpviews.md, smoke-validation.md, rule-skill-echo.md',
    });
  });

  it('uses structured result payloads as fallback tool detail when no explicit detail is present', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'rule-skill-echo',
      result: ['mcpviews.md', 'smoke-validation.md', 'rule-skill-echo.md'],
      createdAt: '2026-04-15T00:00:00.000Z',
    }, 0)).toMatchObject({
      role: 'tool',
      toolName: 'rule-skill-echo',
      detail: 'mcpviews.md\nsmoke-validation.md\nrule-skill-echo.md',
      resultData: ['mcpviews.md', 'smoke-validation.md', 'rule-skill-echo.md'],
    });
  });

  it('keeps only the assistant summary paragraph when a runtime assistant message echoes a rich_content body', function () {
    var transcript = window.__tribexAiClient.normalizeRuntimeTranscript('thread-123', {
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          createdAt: '2026-04-15T00:00:01.000Z',
          parts: [
            { type: 'step-start' },
            {
              type: 'tool-rich_content',
              toolCallId: 'tool-rich-1',
              toolName: 'rich_content',
              state: 'output-available',
              input: {
                title: 'Resource Allocation Strategy: Woodchuck Operations',
                body: '### Operational Transition Diagram\n\n```mermaid\ngraph TD\nA-->B\n```',
              },
            },
            {
              type: 'text',
              text: 'This diagram outlines the strategic realignment required to move from speculative activities to core operational strengths.\n\n### Operational Transition Diagram\n\n```mermaid\ngraph TD\nA-->B\n```\n\n*   **Next Action:** Return to burrowing.',
            },
          ],
        },
      ],
    });

    expect(transcript.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'This diagram outlines the strategic realignment required to move from speculative activities to core operational strengths.',
      }),
    ]);
    expect(transcript.preview).toBe(
      'This diagram outlines the strategic realignment required to move from speculative activities to core operational strengths.',
    );
  });

  it('preserves legitimate assistant markdown sections that do not match the rich_content payload', function () {
    var transcript = window.__tribexAiClient.normalizeRuntimeTranscript('thread-123', {
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          createdAt: '2026-04-15T00:00:01.000Z',
          parts: [
            { type: 'step-start' },
            {
              type: 'tool-rich_content',
              toolCallId: 'tool-rich-1',
              toolName: 'rich_content',
              state: 'output-available',
              input: {
                title: 'Resource Allocation Strategy: Woodchuck Operations',
                body: '### Operational Transition Diagram\n\n```mermaid\ngraph TD\nA-->B\n```',
              },
            },
            {
              type: 'text',
              text: 'This diagram outlines the strategic realignment required to move from speculative activities to core operational strengths.\n\n### Risks\n\n- Burrowing capacity remains under-allocated.\n- Tool wear will continue until reallocation completes.',
            },
          ],
        },
      ],
    });

    expect(transcript.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'This diagram outlines the strategic realignment required to move from speculative activities to core operational strengths.\n\n### Risks\n\n- Burrowing capacity remains under-allocated.\n- Tool wear will continue until reallocation completes.',
      }),
    ]);
  });

  it('uses the deployed root routes for thread detail and runtime session bootstrap', async function () {
    var runtimeMessages = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello from FinanceAgent.' }],
        createdAt: '2026-04-15T00:00:01.000Z',
      },
    ];
    var getMessagesCalls = 0;
    var FakeAgentClient = createAgentClientCtor({
      getMessages: function () {
        getMessagesCalls += 1;
        return Promise.resolve(getMessagesCalls === 1 ? [] : runtimeMessages);
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123') {
        return Promise.resolve({
          id: 'thread-123',
          title: 'Finance thread',
          messages: [],
        });
      }
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    await expect(window.__tribexAiClient.fetchThread('thread-123')).resolves.toMatchObject({
      id: 'thread-123',
      title: 'Finance thread',
    });
    var runtimeEvents = [];
    var unsubscribe = window.__tribexAiClient.listenToRuntimeEvents('thread-123', function (event) {
      runtimeEvents.push(event);
    });
    var turn = await window.__tribexAiClient.sendMessage('thread-123', 'hello', {
      validationProfile: 'rule-skill-echo',
    });
    expect(turn.turnId).toEqual(expect.any(String));
    expect(turn.done && typeof turn.done.then).toBe('function');
    await turn.done;
    await expect(window.__tribexAiCloudflareBridge.getMessages({
      threadId: 'thread-123',
      connection: createRuntimeSessionEnvelope('thread-123').runtimeSession.connection,
    })).resolves.toEqual([
        expect.objectContaining({
          id: 'user-1',
          role: 'user',
        }),
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
        }),
      ]);
    unsubscribe();

    expect(invoke).toHaveBeenNthCalledWith(1, 'first_party_ai_request', expect.objectContaining({
      method: 'GET',
      path: '/threads/thread-123',
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, 'first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/threads/thread-123/runtime-session',
    }));
    expect(invoke).toHaveBeenNthCalledWith(3, 'get_local_mcp_catalog', {});
    expect(invoke).toHaveBeenNthCalledWith(4, 'first_party_ai_relay_request', expect.objectContaining({
      method: 'POST',
      path: '/api/desktop-relay/catalog',
      body: expect.objectContaining({
        relaySessionId: 'relay-session-1',
        connectors: expect.arrayContaining([
          expect.objectContaining({
            key: 'mcpviews-core',
          }),
        ]),
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'rule-skill-echo',
          }),
          expect.objectContaining({
            name: 'rich_content',
          }),
        ]),
      }),
    }));
    expect(invoke.mock.calls[3][1].body.tools).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'init_session',
        }),
      ]),
    );

    expect(FakeAgentClient.instances).toHaveLength(1);
    expect(FakeAgentClient.instances[0].options).toMatchObject({
      host: 'agents.dev.example.workers.dev',
      agent: 'FinanceAgent',
      name: 'thread_thread-123',
      query: {
        token: 'runtime-token',
      },
    });
    expect(FakeAgentClient.instances[0].sentPayloads).toHaveLength(1);
    expect(JSON.parse(FakeAgentClient.instances[0].sentPayloads[0])).toMatchObject({
      type: 'cf_agent_use_chat_request',
      init: {
        method: 'POST',
      },
    });
    expect(JSON.parse(JSON.parse(FakeAgentClient.instances[0].sentPayloads[0]).init.body)).toMatchObject({
      trigger: 'submit-message',
      validationProfile: 'rule-skill-echo',
      relayBridge: expect.objectContaining({
        relaySessionId: 'relay-session-1',
      }),
      relayCatalog: expect.objectContaining({
        connectors: expect.arrayContaining([
          expect.objectContaining({
            key: 'mcpviews-core',
          }),
        ]),
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'rule-skill-echo',
          }),
          expect.objectContaining({
            name: 'rich_content',
          }),
        ]),
      }),
      messages: [
        expect.objectContaining({
          id: expect.any(String),
          role: 'user',
          parts: [
            expect.objectContaining({
              type: 'text',
              text: 'hello',
            }),
          ],
        }),
      ],
    });
    expect(runtimeEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status', status: 'connecting' }),
      expect.objectContaining({ type: 'user_accepted' }),
      expect.objectContaining({ type: 'turn_finish' }),
    ]));
  });

  it('keeps realtime runtime sessions off the legacy relay catalog path', async function () {
    var runtimeEnvelope = createRuntimeSessionEnvelope('thread-123');
    runtimeEnvelope.relay.realtime = {
      streamUrl: 'https://runtime.example.com/__realtime/relay/relay-session-1/stream',
      responseUrl: 'https://runtime.example.com/__realtime/relay/relay-session-1/response',
      token: 'realtime-token',
      tokenExpiresAt: 2000000000,
    };
    var FakeAgentClient = createAgentClientCtor();
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(runtimeEnvelope);
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request') {
        return Promise.reject(new Error('Legacy relay catalog should not be called in realtime mode.'));
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var turn = await window.__tribexAiClient.sendMessage('thread-123', 'hello');
    await turn.done;

    expect(invoke).toHaveBeenCalledWith('first_party_ai_request', expect.objectContaining({
      path: '/threads/thread-123/runtime-session',
    }));
    expect(invoke).toHaveBeenCalledWith('get_local_mcp_catalog', {});
    expect(invoke).not.toHaveBeenCalledWith(
      'first_party_ai_relay_request',
      expect.objectContaining({ path: '/api/desktop-relay/catalog' }),
    );
    expect(JSON.parse(JSON.parse(FakeAgentClient.instances[0].sentPayloads[0]).init.body)).toMatchObject({
      relayBridge: expect.objectContaining({
        requestToken: 'relay-token',
      }),
      relayCatalog: expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'rich_content' }),
        ]),
      }),
    });
  });

  it('uses runtime-session transcript bootstrap without opening a websocket', async function () {
    var bootstrapMessages = [
      {
        id: 'user-bootstrap-1',
        role: 'user',
        parts: [{ type: 'text', text: 'What changed in Q1?' }],
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      {
        id: 'assistant-bootstrap-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Q1 revenue improved on services mix.' }],
        createdAt: '2026-04-15T00:00:01.000Z',
      },
    ];
    var runtimeEnvelope = createRuntimeSessionEnvelope('thread-123');
    runtimeEnvelope.runtimeMessages = {
      source: 'cloudflare-agent',
      messages: bootstrapMessages,
    };
    var FakeAgentClient = createAgentClientCtor();
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(runtimeEnvelope);
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    await expect(window.__tribexAiClient.syncThreadRuntime('thread-123', {
      forceRefresh: true,
    })).resolves.toMatchObject({
      id: 'thread-123',
      messagesSource: 'runtime',
      messages: [
        expect.objectContaining({
          id: 'user-bootstrap-1',
          role: 'user',
          content: 'What changed in Q1?',
        }),
        expect.objectContaining({
          id: 'assistant-bootstrap-1',
          role: 'assistant',
          content: 'Q1 revenue improved on services mix.',
        }),
      ],
      preview: 'Q1 revenue improved on services mix.',
    });
    expect(FakeAgentClient.instances).toHaveLength(0);
  });

  it('does not let an empty live sync override a non-empty runtime-session transcript bootstrap', async function () {
    var runtimeEnvelope = createRuntimeSessionEnvelope('thread-123');
    runtimeEnvelope.runtimeMessages = {
      source: 'cloudflare-agent',
      messages: [
        {
          id: 'user-bootstrap-empty-live-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Summarize the test.' }],
          createdAt: '2026-04-15T00:00:00.000Z',
        },
        {
          id: 'assistant-bootstrap-empty-live-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The test finished successfully.' }],
          createdAt: '2026-04-15T00:00:01.000Z',
        },
      ],
    };
    var FakeAgentClient = createAgentClientCtor();
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(runtimeEnvelope);
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    await expect(window.__tribexAiClient.syncThreadRuntime('thread-123', {
      forceRefresh: true,
    })).resolves.toMatchObject({
      messages: [
        expect.objectContaining({
          id: 'user-bootstrap-empty-live-1',
          content: 'Summarize the test.',
        }),
        expect.objectContaining({
          id: 'assistant-bootstrap-empty-live-1',
          content: 'The test finished successfully.',
        }),
      ],
      preview: 'The test finished successfully.',
    });
    expect(FakeAgentClient.instances).toHaveLength(0);
  });

  it('creates titled threads and sends smoke prompts through the runtime agent bridge', async function () {
    var runtimeMessages = [
      {
        id: 'user-smoke-1',
        role: 'user',
        parts: [{ type: 'text', text: window.__tribexAiClient.buildSmokePrompt('rule-skill-echo') }],
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      {
        id: 'assistant-smoke-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Rule and skill bundle look healthy.' }],
        createdAt: '2026-04-15T00:00:01.000Z',
      },
    ];
    var getMessagesCalls = 0;
    var FakeAgentClient = createAgentClientCtor({
      getMessages: function () {
        getMessagesCalls += 1;
        return Promise.resolve(getMessagesCalls === 1 ? [] : runtimeMessages);
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/projects/project-123/threads') {
        return Promise.resolve({
          id: 'thread-123',
          title: 'Smoke Test 2026-04-14 12:00',
        });
      }
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse({
          tools: [
            {
              name: 'rule-skill-echo',
              description: 'Validates the loaded rule and skill bundle.',
              inputSchema: { type: 'object' },
            },
          ],
          connectors: [],
        }));
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    await expect(
      window.__tribexAiClient.createThread('project-123', 'Smoke Test 2026-04-14 12:00', 'general'),
    ).resolves.toMatchObject({
      id: 'thread-123',
      title: 'Smoke Test 2026-04-14 12:00',
    });
    var turn = await window.__tribexAiClient.runSmokeTest('thread-123', 'rule-skill-echo');
    expect(turn.turnId).toEqual(expect.any(String));
    await turn.done;
    await expect(window.__tribexAiCloudflareBridge.getMessages({
      threadId: 'thread-123',
      connection: createRuntimeSessionEnvelope('thread-123').runtimeSession.connection,
    })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          id: 'assistant-smoke-1',
        }),
      ]));

    var expectedPrompt = window.__tribexAiClient.buildSmokePrompt('rule-skill-echo');

    expect(invoke).toHaveBeenNthCalledWith(1, 'first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/projects/project-123/threads',
      body: { title: 'Smoke Test 2026-04-14 12:00', personaKey: 'general' },
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, 'first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/threads/thread-123/runtime-session',
    }));
    expect(invoke).toHaveBeenNthCalledWith(3, 'get_local_mcp_catalog', {});
    expect(invoke).toHaveBeenNthCalledWith(4, 'first_party_ai_relay_request', expect.objectContaining({
      method: 'POST',
      path: '/api/desktop-relay/catalog',
      body: expect.objectContaining({
        relaySessionId: 'relay-session-1',
      }),
    }));

    expect(FakeAgentClient.instances).toHaveLength(1);
    expect(FakeAgentClient.instances[0].sentPayloads).toHaveLength(1);
    expect(JSON.parse(JSON.parse(FakeAgentClient.instances[0].sentPayloads[0]).init.body)).toMatchObject({
      trigger: 'submit-message',
      validationProfile: 'rule-skill-echo',
      relayBridge: expect.objectContaining({
        requestToken: 'relay-token',
      }),
      relayCatalog: expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'rule-skill-echo',
          }),
        ],
      }),
      messages: [
        expect.objectContaining({
          id: expect.any(String),
          role: 'user',
          parts: [
            expect.objectContaining({
              type: 'text',
              text: expectedPrompt,
            }),
          ],
        }),
      ],
    });
  });

  it('renames a thread through the hosted control plane and preserves the requested title when the response is sparse', async function () {
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123') {
        return Promise.resolve({
          thread: {
            id: 'thread-123',
          },
          project: {
            id: 'project-123',
            workspaceId: 'workspace-123',
            name: 'Finance Planning',
          },
          workspace: {
            id: 'workspace-123',
            organizationId: 'org-1',
            name: 'Workspace 123',
          },
          messages: [],
        });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };

    await expect(
      window.__tribexAiClient.renameThread('thread-123', 'Quarterly review'),
    ).resolves.toMatchObject({
      id: 'thread-123',
      title: 'Quarterly review',
      projectId: 'project-123',
    });

    expect(invoke).toHaveBeenCalledWith('first_party_ai_request', expect.objectContaining({
      method: 'PATCH',
      path: '/threads/thread-123',
      body: {
        title: 'Quarterly review',
      },
    }));
  });

  it('emits a settled runtime snapshot after the turn completes', async function () {
    var staleTranscript = [
      {
        id: 'user-old-1',
        role: 'user',
        parts: [{ type: 'text', text: 'older message' }],
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      {
        id: 'assistant-old-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'older reply' }],
        createdAt: '2026-04-15T00:00:01.000Z',
      },
    ];
    var settledTranscript = staleTranscript.concat([
      {
        id: 'user-new-1',
        role: 'user',
        parts: [{ type: 'text', text: 'follow up' }],
        createdAt: '2026-04-15T00:00:02.000Z',
      },
      {
        id: 'assistant-new-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'fresh reply' }],
        createdAt: '2026-04-15T00:00:03.000Z',
      },
    ]);
    var getMessagesCalls = 0;
    var FakeAgentClient = createAgentClientCtor({
      getMessages: function () {
        getMessagesCalls += 1;
        if (getMessagesCalls === 1) return Promise.resolve(staleTranscript);
        if (getMessagesCalls === 2) return Promise.resolve(staleTranscript);
        return Promise.resolve(settledTranscript);
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse({
          tools: [],
          connectors: [],
        }));
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var turn = await window.__tribexAiClient.sendMessage('thread-123', 'follow up');
    expect(turn.turnId).toEqual(expect.any(String));
    await turn.done;
    await expect(window.__tribexAiCloudflareBridge.getMessages({
      threadId: 'thread-123',
      connection: createRuntimeSessionEnvelope('thread-123').runtimeSession.connection,
    })).resolves.toEqual([
        expect.objectContaining({ role: 'user', parts: [expect.objectContaining({ text: 'older message' })] }),
        expect.objectContaining({ role: 'assistant', parts: [expect.objectContaining({ text: 'older reply' })] }),
        expect.objectContaining({ role: 'user', parts: [expect.objectContaining({ text: 'follow up' })] }),
        expect.objectContaining({ role: 'assistant', parts: [expect.objectContaining({ text: 'fresh reply' })] }),
      ]);
    expect(getMessagesCalls).toBeGreaterThanOrEqual(3);
  });

  it('extracts renderer-backed rich_content activity from runtime tool input payloads', async function () {
    var FakeAgentClient = createAgentClientCtor({
      getMessages: function () {
        return Promise.resolve([]);
      },
      onChatRequest: function (payload, client) {
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'tool-input-available',
              toolCallId: 'tool-push-1',
              toolName: 'rich_content',
              input: {
                title: 'Example Architecture Document',
                body: '```mermaid\\ngraph TD;\\nA-->B;\\n```',
              },
            }),
          }),
        });
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'tool-output-available',
              toolCallId: 'tool-push-1',
              toolName: 'rich_content',
              output: {
                status: 'stored',
                session_id: 'result-session-1',
              },
              preliminary: false,
            }),
          }),
        });
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse({
          tools: [],
          connectors: [],
        }));
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var runtimeEvents = [];
    var unsubscribe = window.__tribexAiClient.listenToRuntimeEvents('thread-123', function (event) {
      runtimeEvents.push(event);
    });

    var turn = await window.__tribexAiClient.sendMessage('thread-123', 'push a sample document');
    await turn.done;
    unsubscribe();

    var updates = runtimeEvents.filter(function (event) {
      return event && event.type === 'activity_update';
    });
    expect(updates).toHaveLength(2);
    expect(updates[0].item).toMatchObject({
      toolName: 'rich_content',
      resultContentType: 'rich_content',
      resultData: {
        title: 'Example Architecture Document',
        body: '```mermaid\\ngraph TD;\\nA-->B;\\n```',
      },
      resultMeta: {},
    });
    expect(updates[0].item.detail).toBe('Preparing Rich Content result: Example Architecture Document.');
    expect(updates[1].item.detail).toBe('Prepared Rich Content result: Example Architecture Document.');
    expect(runtimeEvents.some(function (event) {
      return event && event.type === 'assistant_start';
    })).toBe(false);
  });

  it('reclassifies pre-tool assistant chatter into work notes and keeps only the settled answer in the final assistant message', async function () {
    var FakeAgentClient = createAgentClientCtor({
      getMessages: function () {
        return Promise.resolve([]);
      },
      onChatRequest: function (payload, client) {
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'text-delta',
              delta: 'Looking up the right renderer. ',
            }),
          }),
        });
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'tool-input-start',
              toolCallId: 'tool-discovery-1',
              toolName: 'describe_connector',
              input: { key: 'mcpviews-core' },
            }),
          }),
        });
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'tool-output-available',
              toolCallId: 'tool-discovery-1',
              toolName: 'describe_connector',
              output: { key: 'mcpviews-core' },
              preliminary: false,
            }),
          }),
        });
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'text-delta',
              delta: 'I found the right surface and opened it for you.',
            }),
          }),
        });
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse());
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var runtimeEvents = [];
    var unsubscribe = window.__tribexAiClient.listenToRuntimeEvents('thread-123', function (event) {
      runtimeEvents.push(event);
    });

    var turn = await window.__tribexAiClient.sendMessage('thread-123', 'open the renderer');
    await turn.done;
    unsubscribe();

    expect(runtimeEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'assistant_reset',
      }),
      expect.objectContaining({
        type: 'work_note_update',
        item: expect.objectContaining({
          title: 'Work note',
          detail: 'Looking up the right renderer. ',
        }),
      }),
      expect.objectContaining({
        type: 'assistant_finish',
        message: expect.objectContaining({
          content: 'I found the right surface and opened it for you.',
        }),
      }),
    ]));
  });

  it('gracefully finishes renderer-only turns when the provider errors after a successful tool result', async function () {
    var FakeAgentClient = createAgentClientCtor({
      getMessages: function () {
        return Promise.resolve([]);
      },
      onChatRequest: function (payload, client) {
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'tool-input-available',
              toolCallId: 'tool-push-1',
              toolName: 'rich_content',
              input: {
                title: 'Web App Architecture',
                body: '# Overview',
              },
            }),
          }),
        });
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            done: false,
            body: JSON.stringify({
              type: 'tool-output-available',
              toolCallId: 'tool-push-1',
              toolName: 'rich_content',
              output: {
                status: 'stored',
                session_id: 'result-session-1',
              },
              preliminary: false,
            }),
          }),
        });
        client.emit('message', {
          data: JSON.stringify({
            type: 'cf_agent_use_chat_response',
            id: payload.id,
            error: true,
            body: 'Provider returned error',
          }),
        });
      },
    });
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/threads/thread-123/runtime-session') {
        return Promise.resolve(createRuntimeSessionEnvelope('thread-123'));
      }
      if (command === 'get_local_mcp_catalog') {
        return Promise.resolve(createLocalCatalogResponse({
          tools: [],
          connectors: [],
        }));
      }
      if (command === 'first_party_ai_relay_request' && args.path === '/api/desktop-relay/catalog') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error('Unexpected call: ' + command + ' ' + JSON.stringify(args || {})));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = {
      core: {
        invoke: invoke,
      },
    };
    globalThis.window.__tribexAiAgentClientCtor = FakeAgentClient;

    var runtimeEvents = [];
    var unsubscribe = window.__tribexAiClient.listenToRuntimeEvents('thread-123', function (event) {
      runtimeEvents.push(event);
    });

    var turn = await window.__tribexAiClient.sendMessage('thread-123', 'open the renderer');
    await turn.done;
    unsubscribe();

    expect(runtimeEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'activity_update',
        item: expect.objectContaining({
          toolName: 'rich_content',
          sessionId: 'result-session-1',
        }),
      }),
      expect.objectContaining({
        type: 'assistant_finish',
        message: expect.objectContaining({
          content: 'I opened "Web App Architecture" in a background tab for you.',
        }),
      }),
      expect.objectContaining({
        type: 'turn_finish',
      }),
    ]));
    expect(runtimeEvents.some(function (event) {
      return event && event.type === 'turn_error';
    })).toBe(false);
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

  it('lists packages and creates workspaces through the hosted organization routes', async function () {
    var invoke = vi.fn(function (_command, args) {
      if (args.path === '/packages') {
        return Promise.resolve([
          { id: 'pkg-1', key: 'smoke', displayName: 'Smoke Workspace', version: '1.1.0' },
          { id: 'pkg-2', key: 'generic', displayName: 'General Workspace', version: '1.0.0' },
        ]);
      }
      if (args.path === '/organizations/org-123/workspaces') {
        return Promise.resolve({
          workspace: {
            id: 'workspace-123',
            organizationId: 'org-123',
            name: 'Design Ops',
            packageKey: 'smoke',
            packageVersion: '1.1.0',
          },
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

    await expect(window.__tribexAiClient.fetchPackages()).resolves.toMatchObject([
      { key: 'smoke', name: 'Smoke Workspace', version: '1.1.0' },
      { key: 'generic', name: 'General Workspace', version: '1.0.0' },
    ]);
    await expect(window.__tribexAiClient.createWorkspace('org-123', 'Design Ops', 'smoke')).resolves.toMatchObject({
      id: 'workspace-123',
      organizationId: 'org-123',
      name: 'Design Ops',
      packageKey: 'smoke',
    });

    expect(invoke).toHaveBeenNthCalledWith(1, 'first_party_ai_request', expect.objectContaining({
      method: 'GET',
      path: '/packages',
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, 'first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/organizations/org-123/workspaces',
      body: {
        name: 'Design Ops',
        packageKey: 'smoke',
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
    await window.__tribexAiClient.startRealtimeRelayStream('relay-rt', 'relay-session-rt', {
      streamUrl: 'https://runtime.example.com/__realtime/relay/relay-session-rt/stream',
      responseUrl: 'https://runtime.example.com/__realtime/relay/relay-session-rt/response',
      token: 'realtime-token',
      tokenExpiresAt: 2000000000,
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
    expect(invoke).toHaveBeenNthCalledWith(4, 'start_first_party_ai_realtime_relay_stream', {
      streamId: 'relay-rt',
      relaySessionId: 'relay-session-rt',
      streamUrl: 'https://runtime.example.com/__realtime/relay/relay-session-rt/stream',
      responseUrl: 'https://runtime.example.com/__realtime/relay/relay-session-rt/response',
      token: 'realtime-token',
      tokenExpiresAt: 2000000000,
    });
    expect(invoke).toHaveBeenNthCalledWith(5, 'start_first_party_ai_desktop_presence_heartbeat', {
      heartbeatId: 'heartbeat-1',
      path: '/api/desktop-relay/presence',
      intervalSecs: 30,
      body: {
        status: 'ONLINE',
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(6, 'stop_first_party_ai_desktop_relay_stream', {
      streamId: 'relay-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(7, 'stop_first_party_ai_desktop_presence_heartbeat', {
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

  it('calls workspace sandbox file routes and normalizes files', async function () {
    var invoke = vi.fn(function (command, args) {
      if (command === 'first_party_ai_request' && args.path === '/workspaces/workspace-123/user-sandbox/files' && args.method === 'GET') {
        return Promise.resolve({
          files: [{
            id: 'file-1',
            relativePath: 'reports/april.csv',
            contentType: 'text/csv',
            sizeBytes: 42,
          }],
        });
      }
      if (command === 'first_party_ai_request' && args.path === '/workspaces/workspace-123/user-sandbox/files' && args.method === 'POST') {
        return Promise.resolve({
          file: {
            id: 'file-2',
            relativePath: args.body.relativePath,
          },
          upload: { url: 'https://worker.example/__sandbox/workspace-file?token=upload' },
        });
      }
      if (command === 'first_party_ai_request' && args.path === '/workspaces/workspace-123/user-sandbox/files/file-1') {
        return Promise.resolve({
          file: { id: 'file-1', relativePath: 'reports/april.csv' },
          download: { url: 'https://worker.example/__sandbox/workspace-file?token=download' },
        });
      }
      return Promise.reject(new Error('unexpected request ' + JSON.stringify(args)));
    });

    globalThis.window = globalThis.window || {};
    globalThis.window.__TAURI__ = { core: { invoke: invoke } };

    await expect(window.__tribexAiClient.listWorkspaceFiles('workspace-123')).resolves.toMatchObject({
      files: [{ id: 'file-1', name: 'april.csv', sizeBytes: 42 }],
    });
    await expect(window.__tribexAiClient.initWorkspaceFileUpload('workspace-123', {
      relativePath: 'uploads/a.txt',
      contentType: 'text/plain',
      sizeBytes: 3,
    })).resolves.toMatchObject({
      file: { id: 'file-2', relativePath: 'uploads/a.txt' },
      upload: { url: expect.stringContaining('workspace-file') },
    });
    await expect(window.__tribexAiClient.getWorkspaceFile('workspace-123', 'file-1')).resolves.toMatchObject({
      file: { id: 'file-1' },
      download: { url: expect.stringContaining('download') },
    });

    expect(invoke).toHaveBeenCalledWith('first_party_ai_request', expect.objectContaining({
      method: 'GET',
      path: '/workspaces/workspace-123/user-sandbox/files',
    }));
    expect(invoke).toHaveBeenCalledWith('first_party_ai_request', expect.objectContaining({
      method: 'POST',
      path: '/workspaces/workspace-123/user-sandbox/files',
      body: expect.objectContaining({ relativePath: 'uploads/a.txt' }),
    }));
  });

  it('uploads and downloads through signed worker URLs', async function () {
    var uploadFetch = vi.fn(function (url, init) {
      expect(url).toContain('token=upload');
      expect(init.method).toBe('POST');
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ ok: true }); },
      });
    });
    globalThis.fetch = uploadFetch;

    await expect(window.__tribexAiClient.uploadWorkspaceFileToSignedUrl(
      { url: 'https://worker.example/__sandbox/workspace-file?token=upload' },
      new Blob(['hello'], { type: 'text/plain' }),
    )).resolves.toMatchObject({ ok: true });

    globalThis.fetch = vi.fn(function () {
      return Promise.resolve({
        ok: true,
        headers: {
          get: function (name) {
            return name === 'content-type' ? 'text/plain' : null;
          },
        },
        arrayBuffer: function () {
          return Promise.resolve(new Uint8Array([104, 105]).buffer);
        },
      });
    });

    await expect(window.__tribexAiClient.fetchSignedFileBytes({
      url: 'https://worker.example/__sandbox/workspace-file?token=download',
    })).resolves.toMatchObject({
      contentType: 'text/plain',
      bytes: new Uint8Array([104, 105]),
    });
  });
});
