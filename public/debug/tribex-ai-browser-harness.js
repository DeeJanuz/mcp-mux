// @ts-check
/* Browser-compatible MCPViews AI harness.
 *
 * Opt in with:
 *   http://localhost:1420/?mcpviews_harness=ai
 *
 * The harness installs a Tauri-compatible browser shim and deterministic
 * hosted AI provider backend so the normal MCPViews shell can run inside the
 * Codex in-app browser.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search || '');
  var enabled = params.get('mcpviews_harness') === 'ai' || params.get('tribex_ai_harness') === '1';
  if (!enabled) return;

  var scenario = params.get('scenario') || 'review-churn';
  var latencyProfile = params.get('latency') || 'fast';
  var autoOpen = params.get('auto_open') !== '0';
  var overlayEnabled = params.get('harness_overlay') !== '0';
  var baseTime = Date.parse('2026-04-26T21:00:00.000Z');
  var eventListeners = {};
  var runtimeListenersByThread = {};
  var stage = 'booting';
  var runCounter = 0;
  var lastDecision = null;
  var activeHarnessThreadId = null;
  var activeRunByThread = {};
  var churnTimers = [];

  function jitter(min, max) {
    return Math.floor(min + Math.random() * (max - min));
  }

  function buildLatencyProfile(name) {
    if (name === 'realistic') {
      return {
        accepted: 1200,
        delegating: 8000,
        childB: 17000,
        preparingReview: 42000,
        waitingOnReview: 58000,
        reviewChurn: [4000, 12000, 22000],
        assistantStart: 4000,
        assistantFinish: 9000,
      };
    }
    if (name === 'stall') {
      return {
        accepted: 1000,
        delegating: 4500,
        childB: 9000,
        preparingReview: 52000,
        waitingOnReview: 76000,
        reviewChurn: [8000, 18000, 30000],
        assistantStart: 12000,
        assistantFinish: 24000,
      };
    }
    if (name === 'jitter') {
      return {
        accepted: jitter(250, 1800),
        delegating: jitter(2500, 12000),
        childB: jitter(6000, 24000),
        preparingReview: jitter(12000, 46000),
        waitingOnReview: jitter(22000, 70000),
        reviewChurn: [jitter(2500, 9000), jitter(9000, 19000), jitter(19000, 32000)],
        assistantStart: jitter(1200, 8000),
        assistantFinish: jitter(3500, 14000),
      };
    }
    return {
      accepted: 150,
      delegating: 650,
      childB: 1050,
      preparingReview: 1500,
      waitingOnReview: 2150,
      reviewChurn: [1100, 1700, 2300, 2900],
      assistantStart: 450,
      assistantFinish: 1100,
    };
  }

  var latency = buildLatencyProfile(latencyProfile);

  function nowIso(offsetMs) {
    return new Date(baseTime + (offsetMs || 0)).toISOString();
  }

  var ids = {
    organization: 'org-browser-harness',
    workspace: 'workspace-browser-harness',
    project: 'project-browser-harness',
    thread: 'thread-provider-contract',
    childA: 'thread-provider-contract-child-a',
    childB: 'thread-provider-contract-child-b',
  };

  var db = {
    organizations: [
      {
        id: ids.organization,
        name: 'Acme AI Harness',
        slug: 'acme-ai-harness',
        role: 'owner',
      },
    ],
    packages: [
      {
        key: 'general-ai',
        name: 'General AI Workspace',
        version: 'browser-harness',
        lifecycle: 'development',
      },
    ],
    workspaces: [
      {
        id: ids.workspace,
        organizationId: ids.organization,
        name: 'Persona Lab Workspace',
        slug: 'provider-workspace',
        packageKey: 'general-ai',
        packageName: 'General AI Workspace',
        packageVersion: 'browser-harness',
        status: 'ready',
      },
    ],
    projects: [
      {
        id: ids.project,
        workspaceId: ids.workspace,
        organizationId: ids.organization,
        name: 'Provider Contract Project',
        summary: 'Browser harness project for hosted AI provider compatibility debugging.',
        lastActivityAt: nowIso(0),
      },
    ],
    threads: {},
  };

  db.threads[ids.thread] = {
    id: ids.thread,
    projectId: ids.project,
    workspaceId: ids.workspace,
    organizationId: ids.organization,
    title: 'Provider Contract Thread',
    preview: 'Summarize inboxes from the past 24 hours.',
    messages: [],
    pendingHumanInputs: [],
    activePause: null,
    childThreads: [],
    lastActivityAt: nowIso(0),
    createdAt: nowIso(0),
  };
  db.threads[ids.childA] = {
    id: ids.childA,
    projectId: ids.project,
    workspaceId: ids.workspace,
    organizationId: ids.organization,
    parentThreadId: ids.thread,
    title: 'Inbox scanner A',
    preview: 'Scanning priority inbox.',
    messages: [],
    pendingHumanInputs: [],
    activePause: null,
    childThreads: [],
    lastActivityAt: nowIso(1200),
    createdAt: nowIso(1200),
  };
  db.threads[ids.childB] = {
    id: ids.childB,
    projectId: ids.project,
    workspaceId: ids.workspace,
    organizationId: ids.organization,
    parentThreadId: ids.thread,
    title: 'Inbox scanner B',
    preview: 'Scanning notifications inbox.',
    messages: [],
    pendingHumanInputs: [],
    activePause: null,
    childThreads: [],
    lastActivityAt: nowIso(1500),
    createdAt: nowIso(1500),
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setStage(nextStage) {
    stage = nextStage;
    updateOverlay();
    window.setTimeout(updateOverlay, 0);
    window.setTimeout(updateOverlay, 120);
    window.dispatchEvent(new CustomEvent('mcpviews:ai-harness-stage', {
      detail: snapshot(),
    }));
  }

  function emit(eventName, payload) {
    (eventListeners[eventName] || []).slice().forEach(function (listener) {
      listener({ event: eventName, payload: clone(payload || {}) });
    });
  }

  function emitRuntime(threadId, event) {
    var payload = Object.assign({
      createdAt: nowIso(2500 + runCounter * 100),
    }, event || {});
    (runtimeListenersByThread[threadId] || []).slice().forEach(function (listener) {
      listener(clone(payload));
    });
  }

  function clearChurnTimers() {
    churnTimers.forEach(function (timerId) {
      window.clearTimeout(timerId);
    });
    churnTimers = [];
  }

  function selectedProject() {
    return db.projects[0];
  }

  function selectedWorkspace() {
    return db.workspaces[0];
  }

  function selectedOrganization() {
    return db.organizations[0];
  }

  function buildThreadPayload(threadId) {
    var thread = db.threads[threadId] || db.threads[ids.thread];
    activeHarnessThreadId = thread.id;
    var payload = {
      thread: clone(thread),
      project: clone(selectedProject()),
      workspace: clone(selectedWorkspace()),
      organization: clone(selectedOrganization()),
      messages: clone(thread.messages || []),
      pendingHumanInputs: clone(thread.pendingHumanInputs || []),
      activePause: thread.activePause ? clone(thread.activePause) : null,
      childThreads: clone(thread.childThreads || []),
      messageActivityAt: thread.lastActivityAt || nowIso(0),
      lastActivityAt: thread.lastActivityAt || nowIso(0),
    };
    return payload;
  }

  function buildReviewInput(operationId, threadId) {
    return {
      id: 'human-input-archive-review',
      kind: 'review',
      status: 'PENDING',
      title: 'Review archive candidates',
      detail: 'Approve, edit, or reject the proposed archive actions.',
      threadId: threadId || ids.thread,
      reviewSessionId: 'review-session-archive-candidates',
      renderer: 'structured_data',
      rendererPayload: {
        data: {
          title: 'Archive candidates',
          tables: [
            {
              id: 'archive-candidates',
              name: 'Archive candidates',
              columns: [
                { id: 'sender', name: 'Sender', change: null },
                { id: 'subject', name: 'Subject', change: null },
                { id: 'recommendation', name: 'Recommendation', change: null },
              ],
              rows: [
                {
                  id: 'row-newsletter',
                  cells: {
                    sender: { value: 'newsletter@example.com', change: null },
                    subject: { value: 'Daily product updates', change: null },
                    recommendation: { value: 'Archive', change: 'update' },
                  },
                  children: [],
                },
                {
                  id: 'row-receipts',
                  cells: {
                    sender: { value: 'receipts@example.com', change: null },
                    subject: { value: 'Receipt for cloud tools', change: null },
                    recommendation: { value: 'Keep', change: 'update' },
                  },
                  children: [],
                },
              ],
            },
          ],
        },
        meta: {
          operationId: operationId || null,
        },
        toolArgs: {},
      },
      createdAt: nowIso(2600),
      updatedAt: nowIso(2600),
    };
  }

  function workflowProjection(operationId) {
    return {
      operationId: operationId || 'operation-browser-harness',
      status: 'running',
      updatedAt: nowIso(1800),
      timeline: {
        steps: [
          {
            id: 'delegate-inbox-scanners',
            title: 'Run delegated inbox scanners',
            detail: 'Two child runs are collecting archive candidates.',
            status: 'running',
            kind: 'subagent',
            childRunRefs: [ids.childA, ids.childB],
          },
          {
            id: 'prepare-review',
            title: 'Prepare archive review payload',
            detail: 'Normalizing candidate rows for human review.',
            status: 'running',
            kind: 'review',
          },
        ],
      },
    };
  }

  function routeFirstPartyRequest(args) {
    var method = String(args && args.method || 'GET').toUpperCase();
    var path = String(args && args.path || '/');
    var body = args && args.body ? args.body : {};

    if (method === 'GET' && path === '/organizations') {
      return Promise.resolve({ organizations: clone(db.organizations) });
    }
    if (method === 'GET' && path === '/packages') {
      return Promise.resolve({ packages: clone(db.packages) });
    }
    if (method === 'GET' && path === '/organizations/' + encodeURIComponent(ids.organization) + '/workspaces') {
      return Promise.resolve({ workspaces: clone(db.workspaces) });
    }
    if (method === 'GET' && path === '/workspaces/' + encodeURIComponent(ids.workspace) + '/projects') {
      return Promise.resolve({ projects: clone(db.projects) });
    }
    if (method === 'GET' && path === '/projects/' + encodeURIComponent(ids.project) + '/threads') {
      return Promise.resolve({
        project: clone(selectedProject()),
        threads: Object.keys(db.threads)
          .map(function (threadId) { return db.threads[threadId]; })
          .filter(function (thread) { return thread.projectId === ids.project && !thread.parentThreadId; })
          .map(clone),
      });
    }
    if (method === 'GET' && path === '/projects/' + encodeURIComponent(ids.project) + '/thread-personas') {
      return Promise.resolve({
        personas: [
          { key: 'general', displayName: 'General' },
          { key: 'research', displayName: 'Research' },
        ],
      });
    }
    if (method === 'GET' && path.indexOf('/threads/') === 0) {
      return Promise.resolve(buildThreadPayload(decodeURIComponent(path.split('/')[2] || ids.thread)));
    }
    if (method === 'POST' && /\/threads\/[^/]+\/runtime-session$/.test(path)) {
      var runtimeThreadId = decodeURIComponent(path.split('/')[2] || ids.thread);
      return Promise.resolve({
        thread: clone(db.threads[runtimeThreadId] || db.threads[ids.thread]),
        project: clone(selectedProject()),
        workspace: clone(selectedWorkspace()),
        runtimeSession: {
          id: 'runtime-browser-harness',
          connection: { mode: 'browser-harness' },
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
        runtimeMessages: { messages: [] },
        relay: {
          session: {
            id: 'relay-session-browser-harness',
            deviceId: 'relay-device-browser-harness',
          },
          bridge: {
            relaySessionId: 'relay-session-browser-harness',
          },
          realtime: {
            streamUrl: 'browser-harness://relay/stream',
            responseUrl: 'browser-harness://relay/respond',
            token: 'browser-harness-token',
            tokenExpiresAt: Math.floor(Date.now() / 1000) + 600,
          },
        },
      });
    }
    if (method === 'POST' && /\/threads\/[^/]+\/human-inputs\/[^/]+\/decision$/.test(path)) {
      var decisionParts = path.split('/');
      return submitReviewDecision(body, {
        threadId: decodeURIComponent(decisionParts[2] || ids.thread),
        inputId: decodeURIComponent(decisionParts[4] || ''),
      });
    }
    if (method === 'POST' && path === '/projects/' + encodeURIComponent(ids.project) + '/threads') {
      var newId = 'thread-browser-harness-' + Date.now();
      db.threads[newId] = {
        id: newId,
        projectId: ids.project,
        workspaceId: ids.workspace,
        organizationId: ids.organization,
        title: String(body.title || body.name || 'New chat'),
        preview: '',
        messages: [],
        pendingHumanInputs: [],
        activePause: null,
        childThreads: [],
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      return Promise.resolve({ thread: clone(db.threads[newId]) });
    }
    if (method === 'PATCH' && path.indexOf('/threads/') === 0) {
      var patchThreadId = decodeURIComponent(path.split('/')[2] || ids.thread);
      if (db.threads[patchThreadId]) {
        db.threads[patchThreadId].title = String(body.title || db.threads[patchThreadId].title);
      }
      return Promise.resolve(buildThreadPayload(patchThreadId));
    }
    if (method === 'POST' && /\/pauses\/[^/]+\/(continue|check)$/.test(path)) {
      return Promise.resolve({
        activePause: null,
        threadPause: null,
        didResume: true,
        resumeMode: 'MANUAL',
        targetThreadId: ids.thread,
      });
    }

    return Promise.reject(new Error('Browser harness has no route for ' + method + ' ' + path));
  }

  function routeInvoke(command, args) {
    if (command === 'set_native_theme') return Promise.resolve(true);
    if (command === 'get_renderer_registry') return Promise.resolve([]);
    if (command === 'get_plugin_renderers') return Promise.resolve([]);
    if (command === 'get_standalone_renderers') return Promise.resolve([]);
    if (command === 'get_sessions') return Promise.resolve([]);
    if (command === 'dismiss_session') return Promise.resolve(true);
    if (command === 'submit_decision') {
      lastDecision = clone(args || {});
      return Promise.resolve(true);
    }
    if (command === 'get_first_party_ai_config') {
      return Promise.resolve({
        configured: true,
        baseUrl: 'browser-harness://tribex-ai',
        source: 'browser-harness',
      });
    }
    if (command === 'get_first_party_ai_session') {
      return Promise.resolve({
        user: {
          id: 'user-browser-harness',
          email: 'debug@tribex.ai',
          name: 'Browser Harness',
        },
      });
    }
    if (command === 'send_first_party_ai_magic_link' || command === 'verify_first_party_ai_magic_link' || command === 'clear_first_party_ai_auth' || command === 'start_first_party_ai_auth') {
      return Promise.resolve({ ok: true });
    }
    if (command === 'first_party_ai_request') return routeFirstPartyRequest(args || {});
    if (command === 'first_party_ai_relay_request') return Promise.resolve({ ok: true });
    if (command === 'get_local_mcp_catalog') {
      return Promise.resolve({
        connectors: [],
        tools: [
          {
            name: 'debug_list_inbox_messages',
            description: 'Harness-only inbox listing tool.',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
    }
    if (command === 'list_local_mcp_tools') return Promise.resolve([]);
    if (command === 'call_local_mcp_tool') return Promise.resolve({ ok: true, result: {} });
    if (command === 'register_first_party_ai_desktop_relay') {
      return Promise.resolve({
        relayDeviceId: 'relay-device-browser-harness',
        relaySession: { id: 'relay-session-browser-harness' },
      });
    }
    if (
      command === 'refresh_first_party_ai_desktop_relay' ||
      command === 'start_first_party_ai_desktop_relay_stream' ||
      command === 'start_first_party_ai_realtime_relay_stream' ||
      command === 'start_first_party_ai_desktop_presence_heartbeat' ||
      command === 'stop_first_party_ai_desktop_relay_stream' ||
      command === 'stop_first_party_ai_desktop_presence_heartbeat' ||
      command === 'stop_first_party_ai_companion_stream'
    ) {
      return Promise.resolve(true);
    }
    if (command === 'start_first_party_ai_companion_stream') {
      var threadId = args && args.threadId ? args.threadId : ids.thread;
      window.setTimeout(function () {
        emit('first_party_ai_stream_event', {
          threadId: threadId,
          type: 'status',
          status: 'connected',
        });
      }, 25);
      return Promise.resolve(true);
    }
    if (command === 'save_binary_file') return Promise.resolve(true);
    return Promise.reject(new Error('Unhandled browser harness invoke: ' + command));
  }

  function installTauriShim() {
    window.__TAURI__ = {
      core: {
        invoke: routeInvoke,
      },
      event: {
        listen: function (eventName, listener) {
          eventListeners[eventName] = eventListeners[eventName] || [];
          eventListeners[eventName].push(listener);
          return Promise.resolve(function () {
            eventListeners[eventName] = (eventListeners[eventName] || []).filter(function (candidate) {
              return candidate !== listener;
            });
          });
        },
      },
    };
    window.__TAURI_INTERNALS__ = {
      invoke: routeInvoke,
    };
  }

  function patchClient() {
    var client = window.__tribexAiClient;
    if (!client) return false;
    if (client.__browserHarnessPatched) return true;
    client.__browserHarnessPatched = true;
    client.ensureRuntimeSession = function (threadId) {
      return routeFirstPartyRequest({
        method: 'POST',
        path: '/threads/' + encodeURIComponent(threadId || ids.thread) + '/runtime-session',
      });
    };
    client.syncThreadRuntime = function (threadId) {
      return Promise.resolve({
        id: threadId,
        messagesSource: 'runtime',
        rawRuntimeMessages: [],
        runtimeMessages: [],
        messages: [],
        preview: '',
        messageActivityAt: null,
        lastActivityAt: null,
      });
    };
    client.listenToRuntimeEvents = function (threadId, handler) {
      runtimeListenersByThread[threadId] = runtimeListenersByThread[threadId] || [];
      runtimeListenersByThread[threadId].push(handler);
      return function () {
        runtimeListenersByThread[threadId] = (runtimeListenersByThread[threadId] || []).filter(function (candidate) {
          return candidate !== handler;
        });
      };
    };
    client.registerDesktopRelay = function () {
      return Promise.resolve({
        relayDeviceId: 'relay-device-browser-harness',
        relaySession: { id: 'relay-session-browser-harness' },
      });
    };
    client.startRealtimeRelayStream = function () { return Promise.resolve(true); };
    client.startDesktopRelayStream = function () { return Promise.resolve(true); };
    client.startDesktopPresenceHeartbeat = function () { return Promise.resolve(true); };
    client.stopDesktopRelayStream = function () { return Promise.resolve(true); };
    client.stopDesktopPresenceHeartbeat = function () { return Promise.resolve(true); };
    client.startCompanionStream = function (threadId) {
      emit('first_party_ai_stream_event', {
        threadId: threadId,
        type: 'status',
        status: 'connected',
      });
      return Promise.resolve(true);
    };
    client.stopCompanionStream = function () { return Promise.resolve(true); };
    client.sendMessage = sendMessage;
    client.submitThreadHumanInputDecision = function (threadId, inputId, decision) {
      return submitReviewDecision(decision, {
        threadId: threadId,
        inputId: inputId,
      });
    };
    return true;
  }

  function sendMessage(threadId, prompt, options) {
    runCounter += 1;
    clearChurnTimers();
    var thread = db.threads[threadId] || db.threads[ids.thread];
    activeHarnessThreadId = thread.id;
    var turnId = (options && options.turnId) || 'turn-browser-harness-' + runCounter;
    var operationId = (options && options.operationId) || 'operation-browser-harness-' + runCounter;
    var userMessage = {
      id: (options && options.messageId) || 'user-browser-harness-' + runCounter,
      role: 'user',
      content: prompt,
      createdAt: nowIso(100),
      turnId: turnId,
      turnOrdinal: runCounter,
    };
    if (options && options.waitForStable === false) {
      userMessage.pending = true;
      userMessage.queued = true;
      userMessage.status = 'queued';
      userMessage.operationId = operationId;
      thread.messages = (thread.messages || []).concat([userMessage]);
      thread.lastActivityAt = nowIso(250);
      setStage('context-queued');
      emitRuntime(threadId, {
        type: 'activity_update',
        turnId: activeRunByThread[threadId] && activeRunByThread[threadId].turnId || turnId,
        operationId: activeRunByThread[threadId] && activeRunByThread[threadId].operationId || operationId,
        createdAt: nowIso(260),
        item: {
          id: 'activity-context-queued-' + runCounter,
          kind: 'tool',
          title: 'Queued user context',
          summary: 'Additional context was added to the active session.',
          status: 'queued',
        },
      });
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
      return Promise.resolve({
        turnId: turnId,
        messageId: userMessage.id,
        operationId: operationId,
        queued: true,
      });
    }
    thread.messages = [userMessage];
    thread.pendingHumanInputs = [];
    thread.childThreads = [];
    thread.lastActivityAt = nowIso(100);
    activeRunByThread[thread.id] = {
      turnId: turnId,
      operationId: operationId,
    };
    setStage('sending');

    var doneResolve;
    var done = new Promise(function (resolve) {
      doneResolve = resolve;
    });

    window.setTimeout(function () {
      setStage('accepted');
      emitRuntime(threadId, {
        type: 'turn_start',
        turnId: turnId,
        operationId: operationId,
        label: 'Accepted by runtime',
        createdAt: nowIso(300),
      });
    }, latency.accepted);

    window.setTimeout(function () {
      setStage('delegating');
      thread.childThreads = [clone(db.threads[ids.childA]), clone(db.threads[ids.childB])];
      emitRuntime(threadId, {
        type: 'workflow_projection',
        turnId: turnId,
        operationId: operationId,
        workflowProjection: workflowProjection(operationId),
        createdAt: nowIso(900),
      });
      emitRuntime(threadId, {
        type: 'activity_update',
        turnId: turnId,
        operationId: operationId,
        createdAt: nowIso(950),
        item: {
          id: 'activity-child-a',
          kind: 'subagent',
          title: 'Inbox scanner A started',
          summary: 'Delegated scanner is reading priority inbox metadata.',
          status: 'running',
          childThreadId: ids.childA,
        },
      });
    }, latency.delegating);

    window.setTimeout(function () {
      emitRuntime(threadId, {
        type: 'activity_update',
        turnId: turnId,
        operationId: operationId,
        createdAt: nowIso(1400),
        item: {
          id: 'activity-child-b',
          kind: 'subagent',
          title: 'Inbox scanner B started',
          summary: 'Delegated scanner is reading notifications inbox metadata.',
          status: 'running',
          childThreadId: ids.childB,
        },
      });
    }, latency.childB);

    window.setTimeout(function () {
      setStage('preparing-review');
      emitRuntime(threadId, {
        type: 'runtime_presence',
        turnId: turnId,
        operationId: operationId,
        phase: 'running',
        label: 'Preparing review payload',
        detail: 'Normalizing archive candidates for human review.',
        createdAt: nowIso(1900),
      });
    }, latency.preparingReview);

    window.setTimeout(function () {
      setStage('waiting-on-review');
      thread.pendingHumanInputs = [buildReviewInput(operationId, threadId)];
      thread.lastActivityAt = nowIso(2600);
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
      scheduleReviewChurn(threadId, turnId, operationId);
    }, latency.waitingOnReview);

    return Promise.resolve({
      turnId: turnId,
      operationId: operationId,
      done: done,
      __resolveDone: doneResolve,
    });
  }

  function scheduleReviewChurn(threadId, turnId, operationId) {
    if (scenario !== 'review-churn') return;
    latency.reviewChurn.forEach(function (delay, index) {
      var timerId = window.setTimeout(function () {
        setStage('review-churn-' + (index + 1));
        var offset = latency.waitingOnReview + delay;
        db.threads[threadId].lastActivityAt = nowIso(offset);
        emitRuntime(threadId, {
          type: 'runtime_presence',
          turnId: turnId,
          operationId: operationId,
          phase: 'running',
          label: index % 2 === 0 ? 'Preparing review' : 'Checking status',
          createdAt: nowIso(offset),
        });
        if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
          window.__tribexAiState.refreshActiveThread();
        }
      }, delay);
      churnTimers.push(timerId);
    });
  }

  function submitReviewDecision(decision, options) {
    var targetThreadId = options && options.threadId ? options.threadId : ids.thread;
    var targetInputId = options && options.inputId ? options.inputId : null;
    var thread = db.threads[targetThreadId] || db.threads[ids.thread];
    var activeRun = activeRunByThread[thread.id] || {};
    activeHarnessThreadId = thread.id;
    lastDecision = Object.assign({
      threadId: targetThreadId,
      inputId: targetInputId,
    }, clone(decision || {}));
    clearChurnTimers();
    thread.pendingHumanInputs = [];
    setStage('review-submitted');
    emitRuntime(targetThreadId, {
      type: 'runtime_presence',
      turnId: activeRun.turnId || null,
      operationId: activeRun.operationId || null,
      phase: 'running',
      label: 'Continuing after review',
      detail: 'Applying the reviewed archive decision.',
      createdAt: nowIso(5600),
    });
    if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
      window.__tribexAiState.refreshActiveThread();
    }

    window.setTimeout(function () {
      setStage('assistant-answering');
      emitRuntime(targetThreadId, {
        type: 'assistant_start',
        turnId: activeRun.turnId || null,
        operationId: activeRun.operationId || null,
        messageId: 'assistant-browser-harness-answer-' + runCounter,
        createdAt: nowIso(6200),
      });
      emitRuntime(targetThreadId, {
        type: 'assistant_delta',
        turnId: activeRun.turnId || null,
        operationId: activeRun.operationId || null,
        messageId: 'assistant-browser-harness-answer-' + runCounter,
        delta: 'I applied the reviewed archive plan and kept the receipt thread visible for follow-up.',
        createdAt: nowIso(6500),
      });
    }, latency.assistantStart);

    window.setTimeout(function () {
      var assistantMessage = {
        id: 'assistant-browser-harness-answer-' + runCounter,
        role: 'assistant',
        content: 'I applied the reviewed archive plan and kept the receipt thread visible for follow-up.',
        createdAt: nowIso(7200),
      };
      thread.messages = thread.messages.concat([assistantMessage]);
      thread.lastActivityAt = nowIso(7200);
      setStage('complete');
      emitRuntime(targetThreadId, {
        type: 'assistant_finish',
        turnId: activeRun.turnId || null,
        operationId: activeRun.operationId || null,
        message: assistantMessage,
        createdAt: nowIso(7200),
      });
      emitRuntime(targetThreadId, {
        type: 'turn_finish',
        turnId: activeRun.turnId || null,
        operationId: activeRun.operationId || null,
        createdAt: nowIso(7300),
      });
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
    }, latency.assistantFinish);

    return Promise.resolve({
      ok: true,
      decision: lastDecision,
    });
  }

  function waitForAppReady() {
    return new Promise(function (resolve, reject) {
      var startedAt = Date.now();
      function tick() {
        patchClient();
        updateOverlay();
        if (
          window.__tribexAiState &&
          window.__companionUtils &&
          typeof window.__companionUtils.openSession === 'function' &&
          patchClient()
        ) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > 10000) {
          reject(new Error('MCPViews AI browser harness timed out waiting for app boot.'));
          return;
        }
        window.setTimeout(tick, 25);
      }
      tick();
    });
  }

  function startAppScenario() {
    if (!autoOpen) {
      setStage('ready');
      return Promise.resolve(true);
    }
    return waitForAppReady()
      .then(function () {
        return window.__tribexAiState.refreshNavigator(true);
      })
      .then(function () {
        window.__tribexAiState.openThread(ids.thread, { connectStream: false });
        setStage('ready');
        return true;
      })
      .catch(function (error) {
        setStage('error');
        console.error('[mcpviews-ai-harness] Failed to start scenario:', error);
        return false;
      });
  }

  function snapshot() {
    var root = document.querySelector('.session-content.active .ai-codex-thread') || document.querySelector('.ai-codex-thread');
    var reviewCard = document.querySelector('.ai-codex-review-card');
    var composer = document.querySelector('.ai-codex-input');
    var client = window.__tribexAiClient;
    var activeThread = db.threads[activeHarnessThreadId] || db.threads[ids.thread];
    return {
      enabled: true,
      scenario: scenario,
      latency: latencyProfile,
      stage: stage,
      threadId: activeThread.id,
      lifecycleClass: root ? root.className : null,
      reviewVisible: !!reviewCard,
      composerValue: composer ? composer.value : null,
      pendingHumanInputs: activeThread.pendingHumanInputs.length,
      lastDecision: lastDecision,
      ready: {
        state: !!window.__tribexAiState,
        client: !!client,
        clientPatched: !!(client && client.__browserHarnessPatched),
        companionUtils: !!window.__companionUtils,
        openSession: !!(window.__companionUtils && typeof window.__companionUtils.openSession === 'function'),
      },
    };
  }

  function injectOverlay() {
    if (!overlayEnabled || document.getElementById('ai-browser-harness-overlay')) return;
    var style = document.createElement('style');
    style.textContent = '' +
      '#ai-browser-harness-overlay {' +
      'position: fixed; right: 14px; bottom: 14px; z-index: 99999;' +
      'width: min(360px, calc(100vw - 28px)); border: 1px solid var(--border-default);' +
      'border-radius: 8px; background: color-mix(in srgb, var(--bg-surface) 92%, transparent);' +
      'color: var(--text-primary); box-shadow: var(--glass-shadow-elevated);' +
      'font: 12px/1.45 var(--font-sans); padding: 10px 12px; backdrop-filter: blur(10px);' +
      'pointer-events: none;' +
      '}' +
      '#ai-browser-harness-overlay strong { display: block; margin-bottom: 6px; }' +
      '#ai-browser-harness-overlay code { color: var(--code-inline-text); }';
    document.head.appendChild(style);
    var overlay = document.createElement('div');
    overlay.id = 'ai-browser-harness-overlay';
    overlay.setAttribute('aria-live', 'polite');
    document.body.appendChild(overlay);
  }

  function updateOverlay() {
    if (!overlayEnabled) return;
    var overlay = document.getElementById('ai-browser-harness-overlay');
    if (!overlay) return;
    var current = snapshot();
    overlay.innerHTML = [
      '<strong>AI Browser Harness</strong>',
      '<div>Scenario: <code>' + current.scenario + '</code></div>',
      '<div>Latency: <code>' + current.latency + '</code></div>',
      '<div>Stage: <code>' + current.stage + '</code></div>',
      '<div>Lifecycle: <code>' + (current.lifecycleClass || 'not mounted') + '</code></div>',
      '<div>Review visible: <code>' + String(current.reviewVisible) + '</code></div>',
      '<div>Ready: <code>' + [
        current.ready.state ? 'state' : 'no-state',
        current.ready.client ? 'client' : 'no-client',
        current.ready.clientPatched ? 'patched' : 'unpatched',
        current.ready.openSession ? 'open-session' : 'no-open-session',
      ].join(' / ') + '</code></div>',
    ].join('');
  }

  installTauriShim();
  window.__MCPVIEWS_AI_BROWSER_HARNESS__ = {
    ids: clone(ids),
    snapshot: snapshot,
    emitRuntime: emitRuntime,
    refreshThread: function () {
      return window.__tribexAiState && window.__tribexAiState.refreshActiveThread
        ? window.__tribexAiState.refreshActiveThread()
        : Promise.resolve(null);
    },
    submitReviewDecision: submitReviewDecision,
    start: startAppScenario,
  };

  document.addEventListener('DOMContentLoaded', function () {
    injectOverlay();
    updateOverlay();
  });

  window.addEventListener('load', function () {
    startAppScenario();
  });
})();
