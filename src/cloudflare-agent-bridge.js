import { AgentClient } from 'agents/client';
import { CHAT_MESSAGE_TYPES, StreamAccumulator } from 'agents/chat';

var CHAT_REQUEST_TYPE = CHAT_MESSAGE_TYPES.USE_CHAT_REQUEST;
var CHAT_RESPONSE_TYPE = CHAT_MESSAGE_TYPES.USE_CHAT_RESPONSE;
var RUNTIME_CONNECT_TIMEOUT_MS = 10000;
var LOCAL_RUNTIME_PROBE_TIMEOUT_MS = 4000;
var LOCAL_RUNTIME_PROBE_INTERVAL_MS = 250;
var LOCAL_RUNTIME_PROBE_REQUEST_TIMEOUT_MS = 1000;

function ensureWindow() {
  if (typeof window === 'undefined') {
    globalThis.window = globalThis.window || globalThis;
  }
  return globalThis.window;
}

function getTauriInvoke() {
  var targetWindow = ensureWindow();
  if (
    targetWindow.__TAURI__ &&
    targetWindow.__TAURI__.core &&
    typeof targetWindow.__TAURI__.core.invoke === 'function'
  ) {
    return targetWindow.__TAURI__.core.invoke.bind(targetWindow.__TAURI__.core);
  }
  return null;
}

function normalizeHost(value) {
  if (!value) return value;
  try {
    return new URL(value).host;
  } catch (_error) {
    return String(value).replace(/^https?:\/\//i, '').replace(/\/$/g, '');
  }
}

function parseConnectionUrl(value) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch (_error) {
    try {
      return new URL('http://' + String(value).replace(/^(ws|wss):\/\//i, ''));
    } catch (_innerError) {
      return null;
    }
  }
}

function isLoopbackRuntimeHost(value) {
  var parsed = parseConnectionUrl(value);
  if (!parsed) return false;
  var hostname = String(parsed.hostname || '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function extractConnectionProbeToken(connection) {
  if (!connection || !connection.query || typeof connection.query !== 'object') {
    return null;
  }
  var token = connection.query.token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function buildProbeUrl(connection, token) {
  var parsed = parseConnectionUrl(connection && connection.host);
  if (!parsed) return null;
  parsed.protocol = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.pathname = token ? '/__runtime-session-probe' : '/healthz';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

async function probeRuntimeHostReachable(url, token) {
  var invoke = getTauriInvoke();
  if (invoke) {
    await invoke('probe_local_runtime_host', {
      url: url,
      token: token || undefined,
      timeoutMs: LOCAL_RUNTIME_PROBE_REQUEST_TIMEOUT_MS,
    });
    return;
  }

  if (!url || typeof fetch !== 'function') return;

  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timerId = controller
    ? setTimeout(function () {
      controller.abort();
    }, LOCAL_RUNTIME_PROBE_REQUEST_TIMEOUT_MS)
    : null;

  var headers = token ? { Authorization: 'Bearer ' + token } : undefined;

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      headers: headers,
      signal: controller ? controller.signal : undefined,
    });
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

async function waitForLocalRuntimeHost(connection) {
  if (!connection || !isLoopbackRuntimeHost(connection.host)) return;

  var probeToken = extractConnectionProbeToken(connection);
  var probeUrl = buildProbeUrl(connection, probeToken);
  if (!probeUrl) return;

  var deadline = Date.now() + LOCAL_RUNTIME_PROBE_TIMEOUT_MS;
  var lastError = null;

  while (Date.now() < deadline) {
    try {
      await probeRuntimeHostReachable(probeUrl, probeToken);
      return;
    } catch (error) {
      lastError = error;
      await delay(LOCAL_RUNTIME_PROBE_INTERVAL_MS);
    }
  }

  throw new Error(
    'Local runtime host is unavailable at '
      + normalizeHost(connection.host)
      + (lastError && lastError.message ? ': ' + lastError.message : '.')
  );
}

function normalizePath(value) {
  if (!value) return undefined;
  var next = String(value || '').trim();
  if (!next) return undefined;
  return next.charAt(0) === '/' ? next.slice(1) : next;
}

function connectionKey(connection) {
  return [
    connection && connection.host,
    connection && connection.agent,
    connection && connection.name,
    connection && connection.path,
  ].join('::');
}

function resolveAgentClientCtor() {
  var targetWindow = ensureWindow();
  return targetWindow.__tribexAiAgentClientCtor || AgentClient;
}

function createEventBus() {
  var listenersByThread = new Map();

  function emit(threadId, event) {
    var listeners = listenersByThread.get(threadId);
    if (!listeners) return;
    listeners.forEach(function (listener) {
      listener(event);
    });
  }

  function subscribe(threadId, listener) {
    if (!listenersByThread.has(threadId)) {
      listenersByThread.set(threadId, new Set());
    }
    listenersByThread.get(threadId).add(listener);
    return function unsubscribe() {
      var listeners = listenersByThread.get(threadId);
      if (!listeners) return;
      listeners.delete(listener);
      if (!listeners.size) {
        listenersByThread.delete(threadId);
      }
    };
  }

  return {
    emit: emit,
    subscribe: subscribe,
  };
}

var connections = new Map();
var bus = createEventBus();

function randomRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function nowIso() {
  return new Date().toISOString();
}

function toError(error, fallback) {
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : (fallback || 'Unknown runtime error.'));
}

function withTimeout(promise, timeoutMs, onTimeout) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timerId = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (typeof onTimeout === 'function') onTimeout();
      reject(new Error('Runtime connection timed out.'));
    }, timeoutMs);

    Promise.resolve(promise).then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      reject(error);
    });
  });
}

function closeClientQuietly(client, code, reason) {
  if (!client || typeof client.close !== 'function') return;
  try {
    client.close(code, reason);
  } catch (_error) {
    // Best-effort cleanup.
  }
}

function buildChatRequestPayload(input) {
  var existingMessages = Array.isArray(input.messages) ? input.messages : [];
  return {
    messages: existingMessages.concat([
      {
        id: input.userMessageId || randomRequestId(),
        role: 'user',
        parts: [
          {
            type: 'text',
            text: String(input.prompt || ''),
          },
        ],
      },
    ]),
    trigger: 'submit-message',
    validationProfile: input.validationProfile || null,
    relayBridge: input.relayBridge || null,
    relayCatalog: input.relayCatalog || null,
  };
}

function extractMessageText(message) {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .filter(function (part) {
      return part && part.type === 'text' && typeof part.text === 'string';
    })
    .map(function (part) {
      return part.text;
    })
    .join('');
}

function titleCase(value) {
  return String(value || 'tool')
    .replace(/^tool-/, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, function (match) {
      return match.toUpperCase();
    });
}

function stringifyPreview(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    var json = JSON.stringify(value, null, 2);
    return json.length > 500 ? json.slice(0, 500) + '...' : json;
  } catch (_error) {
    return String(value);
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function maybeParseJson(value) {
  if (typeof value !== 'string') return value;
  var trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return value;
  }
}

function extractPushContentPayload(value) {
  var raw = maybeParseJson(value);
  if (!isRecord(raw)) return null;

  var contentType = raw.tool_name || raw.toolName || raw.contentType || raw.content_type || null;
  if (!contentType) return null;

  var data = maybeParseJson(raw.data);
  var meta = maybeParseJson(raw.meta);
  var toolArgs = maybeParseJson(raw.tool_args || raw.toolArgs || null);

  return {
    contentType: String(contentType),
    data: data == null ? null : data,
    meta: meta == null ? null : meta,
    toolArgs: isRecord(toolArgs) ? toolArgs : null,
  };
}

function hasRendererDataShape(contentType, value) {
  if (!isRecord(value)) return false;
  if (contentType === 'structured_data') {
    return Array.isArray(value.tables);
  }
  if (contentType === 'rich_content') {
    return (
      'body' in value ||
      'title' in value ||
      'tables' in value ||
      'suggestions' in value ||
      'citations' in value
    );
  }
  return false;
}

function buildRendererPayload(contentType, data, meta, toolArgs, reviewRequired) {
  if (!contentType || !hasRendererDataShape(contentType, data)) return null;
  var nextMeta = isRecord(meta) ? Object.assign({}, meta) : {};
  if (reviewRequired) {
    nextMeta.reviewRequired = true;
  }
  return {
    contentType: String(contentType),
    data: data,
    meta: nextMeta,
    toolArgs: isRecord(toolArgs) ? toolArgs : null,
    reviewRequired: !!reviewRequired,
  };
}

function shouldInlineRendererPayload(contentType, meta, reviewRequired, sessionId) {
  if (contentType !== 'rich_content' && contentType !== 'structured_data') {
    return false;
  }
  if (sessionId) {
    return false;
  }
  if (reviewRequired) {
    return false;
  }
  return !(isRecord(meta) && meta.reviewRequired === true);
}

function extractWrappedRendererPayload(value, reviewRequired) {
  var raw = maybeParseJson(value);
  if (!isRecord(raw)) return null;

  var contentType = raw.tool_name || raw.toolName || raw.contentType || raw.content_type || null;
  if (!contentType) return null;

  var data = maybeParseJson(raw.data);
  var meta = maybeParseJson(raw.meta);
  var toolArgs = maybeParseJson(raw.tool_args || raw.toolArgs || null);

  if (!hasRendererDataShape(contentType, data) && hasRendererDataShape(contentType, raw)) {
    data = raw;
  }

  return buildRendererPayload(
    contentType,
    data,
    meta,
    toolArgs,
    reviewRequired || raw.reviewRequired === true
  );
}

function extractRendererActivityPayload(toolName, value) {
  if (toolName === 'push_content') {
    var pushPayload = extractPushContentPayload(value);
    if (!pushPayload) return null;
    return buildRendererPayload(
      pushPayload.contentType,
      pushPayload.data,
      pushPayload.meta,
      pushPayload.toolArgs,
      false
    );
  }
  if (toolName === 'push_review') {
    return extractWrappedRendererPayload(value, true);
  }
  if (toolName !== 'rich_content' && toolName !== 'structured_data') {
    return null;
  }

  var raw = maybeParseJson(value);
  if (!isRecord(raw)) return null;
  var directPayload = buildRendererPayload(
    toolName,
    hasRendererDataShape(toolName, raw) ? raw : maybeParseJson(raw.data),
    maybeParseJson(raw.meta),
    maybeParseJson(raw.tool_args || raw.toolArgs || null),
    raw.reviewRequired === true
  );
  if (!directPayload) return null;

  return directPayload;
}

function buildPushContentDetail(payload, status) {
  if (!payload || !payload.contentType) return '';
  var action = status === 'completed' ? 'Prepared' : 'Preparing';
  var label = titleCase(payload.contentType);
  var title = isRecord(payload.data) && typeof payload.data.title === 'string'
    ? payload.data.title.trim()
    : '';
  if (title) {
    return action + ' ' + label + ' result: ' + title + '.';
  }
  return action + ' ' + label + ' result.';
}

function normalizeUiMessages(messages) {
  return Array.isArray(messages) ? messages : [];
}

function readCurrentMessages(client) {
  return client && client.stub && typeof client.stub.getMessages === 'function'
    ? client.stub.getMessages().then(normalizeUiMessages)
    : Promise.resolve([]);
}

function getRecord(threadId) {
  return connections.get(threadId) || null;
}

function emitSnapshot(threadId, record, messages) {
  record.messages = normalizeUiMessages(messages);
  bus.emit(threadId, {
    type: 'runtime_snapshot',
    messages: record.messages,
    createdAt: nowIso(),
  });
}

function buildAssistantMessage(turn, createdAtOverride) {
  if (!turn) return null;
  var content = typeof turn.finalText === 'string' ? turn.finalText : '';
  var parts = content ? [{ type: 'text', text: content }] : [];
  if (!content && turn.accumulator) {
    var fallback = turn.accumulator.toMessage();
    content = extractMessageText(fallback);
    parts = Array.isArray(fallback.parts) ? fallback.parts.slice() : parts;
  }
  if (!content) return null;
  return {
    id: turn.messageId,
    role: 'assistant',
    content: content,
    createdAt: createdAtOverride || turn.finalStartedAt || turn.startedAt || nowIso(),
    parts: parts,
    isStreaming: true,
    messageId: turn.messageId,
  };
}

function normalizeToolStatus(chunk) {
  switch (chunk.type) {
    case 'tool-input-start':
    case 'tool-input-delta':
    case 'tool-input-available':
      return 'running';
    case 'tool-output-available':
      return chunk.preliminary ? 'running' : 'completed';
    case 'tool-input-error':
    case 'tool-output-error':
    case 'tool-output-denied':
      return 'failed';
    case 'tool-approval-request':
      return 'needs-approval';
    default:
      return 'running';
  }
}

function buildToolActivityItem(chunk, previous) {
  if (!chunk || !chunk.toolCallId) return null;

  var createdAt = previous && previous.createdAt ? previous.createdAt : nowIso();
  var status = normalizeToolStatus(chunk);
  var toolName = chunk.toolName || (previous && previous.toolName) || null;
  var pushPayload = extractRendererActivityPayload(toolName, chunk.input)
    || extractRendererActivityPayload(toolName, chunk.output)
    || ((previous && previous.resultContentType)
      ? {
          contentType: previous.resultContentType,
          data: previous.resultData || null,
          meta: previous.resultMeta || null,
          toolArgs: previous.toolArgs || null,
        }
      : null);
  var detail = previous && previous.detail ? previous.detail : '';

  if (chunk.errorText) {
    detail = chunk.errorText;
  } else if (pushPayload) {
    detail = buildPushContentDetail(pushPayload, status);
  } else if (chunk.output != null) {
    detail = stringifyPreview(chunk.output);
  } else if (chunk.input != null) {
    detail = stringifyPreview(chunk.input);
  } else if (chunk.inputTextDelta) {
    detail = (detail || '') + chunk.inputTextDelta;
  }

  return {
    id: chunk.toolCallId,
    toolCallId: chunk.toolCallId,
    sessionId: (
      (chunk.output && (chunk.output.session_id || chunk.output.sessionId)) ||
      (previous && previous.sessionId) ||
      null
    ),
    toolName: toolName,
    title: chunk.title || (previous && previous.title) || titleCase(chunk.toolName || 'tool'),
    status: status,
    detail: detail,
    createdAt: createdAt,
    updatedAt: nowIso(),
    resultContentType: pushPayload ? pushPayload.contentType : ((previous && previous.resultContentType) || null),
    resultData: pushPayload ? pushPayload.data : ((previous && previous.resultData) || null),
    resultMeta: pushPayload ? pushPayload.meta : ((previous && previous.resultMeta) || null),
    toolArgs: pushPayload ? pushPayload.toolArgs : ((previous && previous.toolArgs) || null),
    reviewRequired: pushPayload ? !!pushPayload.reviewRequired : !!(previous && previous.reviewRequired),
    inlineDisplay: pushPayload
      ? shouldInlineRendererPayload(
          pushPayload.contentType,
          pushPayload.meta,
          pushPayload.reviewRequired,
          (chunk.output && (chunk.output.session_id || chunk.output.sessionId)) ||
            (previous && previous.sessionId) ||
            null
        )
      : !!(previous && previous.inlineDisplay),
  };
}

function createWorkNoteItem(turn, content, createdAt) {
  var noteIndex = (turn.workNoteCount || 0) + 1;
  turn.workNoteCount = noteIndex;
  turn.activeWorkNoteId = turn.turnId + ':work-note:' + noteIndex;
  return {
    id: turn.activeWorkNoteId,
    toolCallId: turn.activeWorkNoteId,
    toolName: '__work_note__',
    title: 'Work note',
    status: 'running',
    detail: content || '',
    createdAt: createdAt || nowIso(),
    updatedAt: createdAt || nowIso(),
    turnId: turn.turnId,
    turnOrdinal: turn.turnOrdinal || null,
  };
}

function emitWorkNote(threadId, turn, delta, createdAt) {
  if (!turn) return;
  var existing = turn.activeWorkNoteId ? turn.toolItems[turn.activeWorkNoteId] || null : null;
  var item = existing
    ? Object.assign({}, existing, {
        detail: (existing.detail || '') + (delta || ''),
        updatedAt: createdAt || nowIso(),
        status: 'running',
      })
    : createWorkNoteItem(turn, delta || '', createdAt);
  turn.toolItems[item.id] = item;
  bus.emit(threadId, {
    type: 'work_note_update',
    turnId: turn.turnId,
    item: item,
  });
}

function finalizeWorkNote(threadId, turn, createdAt) {
  if (!turn || !turn.activeWorkNoteId) return;
  var existing = turn.toolItems[turn.activeWorkNoteId];
  if (!existing) {
    turn.activeWorkNoteId = null;
    return;
  }
  var next = Object.assign({}, existing, {
    status: existing.status === 'failed' ? 'failed' : 'completed',
    updatedAt: createdAt || nowIso(),
  });
  turn.toolItems[next.id] = next;
  turn.activeWorkNoteId = null;
  bus.emit(threadId, {
    type: 'work_note_update',
    turnId: turn.turnId,
    item: next,
  });
}

function getToolItems(turn) {
  return turn && turn.toolItems
    ? Object.keys(turn.toolItems).map(function (key) { return turn.toolItems[key]; }).filter(Boolean)
    : [];
}

function latestSuccessfulRendererItem(turn) {
  return getToolItems(turn)
    .filter(function (item) {
      return item &&
        item.status === 'completed' &&
        item.resultContentType &&
        item.resultData;
    })
    .sort(function (left, right) {
      var leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
      var rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
      return rightTime - leftTime;
    })[0] || null;
}

function turnHasFailedToolItems(turn) {
  return getToolItems(turn).some(function (item) {
    return item && item.status === 'failed';
  });
}

function buildRendererCompletionSummary(turn) {
  var item = latestSuccessfulRendererItem(turn);
  if (!item) return null;
  var title = isRecord(item.resultData) && typeof item.resultData.title === 'string'
    ? item.resultData.title.trim()
    : '';
  if (item.inlineDisplay) {
    if (title) {
      return 'I added "' + title + '" inline below.';
    }
    return 'I added the result inline below.';
  }
  if (title) {
    return 'I opened "' + title + '" in a background tab for you.';
  }
  return 'I opened the result in a background tab for you.';
}

function shouldGracefullyRecoverTurn(turn) {
  if (!turn) return false;
  if (turn.finalText) return false;
  if (Object.keys(turn.pendingToolCalls || {}).length > 0) return false;
  if (turnHasFailedToolItems(turn)) return false;
  return !!latestSuccessfulRendererItem(turn);
}

function resetFinalAssistant(threadId, record, createdAt) {
  var turn = record && record.activeTurn;
  if (!turn || !turn.finalText) return;
  emitWorkNote(threadId, turn, turn.finalText, turn.finalStartedAt || createdAt);
  turn.finalText = '';
  turn.finalStartedAt = null;
  turn.assistantStarted = false;
  bus.emit(threadId, {
    type: 'assistant_reset',
    turnId: turn.turnId,
    createdAt: createdAt || nowIso(),
  });
}

function isToolChunkSettled(chunk) {
  return !!(
    chunk &&
    (
      (chunk.type === 'tool-output-available' && !chunk.preliminary) ||
      chunk.type === 'tool-input-error' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied'
    )
  );
}

function updateToolLifecycle(turn, chunk) {
  if (!turn || !chunk || !chunk.toolCallId) return;
  turn.pendingToolCalls = turn.pendingToolCalls || {};
  if (
    chunk.type === 'tool-input-start' ||
    chunk.type === 'tool-input-delta' ||
    chunk.type === 'tool-input-available' ||
    chunk.type === 'tool-approval-request'
  ) {
    turn.pendingToolCalls[chunk.toolCallId] = true;
    turn.hasToolActivity = true;
    turn.finalAnswerUnlocked = false;
    return;
  }

  if (isToolChunkSettled(chunk)) {
    delete turn.pendingToolCalls[chunk.toolCallId];
    turn.hasToolActivity = true;
    turn.finalAnswerUnlocked = Object.keys(turn.pendingToolCalls).length === 0;
  }
}

function failActiveTurn(threadId, record, error) {
  if (!record || !record.activeTurn) return;
  var turn = record.activeTurn;
  if (shouldGracefullyRecoverTurn(turn)) {
    turn.finalText = buildRendererCompletionSummary(turn) || turn.finalText;
    turn.finalStartedAt = turn.finalStartedAt || nowIso();
    turn.assistantStarted = !!turn.finalText;
    finalizeActiveTurn(threadId, record);
    return;
  }
  finalizeWorkNote(threadId, turn, nowIso());
  record.activeTurn = null;
  bus.emit(threadId, {
    type: 'turn_error',
    turnId: turn.turnId,
    error: error instanceof Error ? error.message : String(error || 'Runtime turn failed.'),
    createdAt: nowIso(),
  });
  turn.reject(error instanceof Error ? error : new Error(String(error || 'Runtime turn failed.')));
}

function syncSnapshotAfterTurn(threadId, record) {
  if (!record || !record.client) return Promise.resolve();
  return readCurrentMessages(record.client)
    .then(function (messages) {
      emitSnapshot(threadId, record, messages);
    })
    .catch(function () {
      return null;
    });
}

function finalizeActiveTurn(threadId, record) {
  if (!record || !record.activeTurn) return;
  var turn = record.activeTurn;
  finalizeWorkNote(threadId, turn, nowIso());
  var assistantMessage = buildAssistantMessage(turn, nowIso());
  record.activeTurn = null;

  if (assistantMessage && assistantMessage.content) {
    bus.emit(threadId, {
      type: 'assistant_finish',
      turnId: turn.turnId,
      message: assistantMessage,
      createdAt: assistantMessage.createdAt,
    });
  }

  bus.emit(threadId, {
    type: 'turn_finish',
    turnId: turn.turnId,
    createdAt: nowIso(),
  });
  turn.resolve({
    turnId: turn.turnId,
  });
  syncSnapshotAfterTurn(threadId, record);
}

function parseChunkBody(body) {
  if (!body || typeof body !== 'string') return null;
  try {
    return JSON.parse(body);
  } catch (_error) {
    return null;
  }
}

function processTurnChunk(threadId, record, payload, chunk) {
  var turn = record && record.activeTurn;
  if (!turn) return;

  if (!turn.accumulator) {
    turn.accumulator = new StreamAccumulator({
      messageId: turn.messageId,
    });
  }

  var chunkResult = turn.accumulator.applyChunk(chunk);

  if (
    chunk.type === 'tool-input-start' ||
    chunk.type === 'tool-input-delta' ||
    chunk.type === 'tool-input-available' ||
    chunk.type === 'tool-input-error' ||
    chunk.type === 'tool-output-available' ||
    chunk.type === 'tool-output-error' ||
    chunk.type === 'tool-output-denied' ||
    chunk.type === 'tool-approval-request'
  ) {
    updateToolLifecycle(turn, chunk);
    if (
      chunk.type === 'tool-input-start' ||
      chunk.type === 'tool-input-delta' ||
      chunk.type === 'tool-input-available' ||
      chunk.type === 'tool-approval-request'
    ) {
      resetFinalAssistant(threadId, record, nowIso());
    } else if (isToolChunkSettled(chunk)) {
      finalizeWorkNote(threadId, turn, nowIso());
    }
    var current = turn.toolItems[chunk.toolCallId] || null;
    var next = buildToolActivityItem(chunk, current);
    if (next) {
      turn.toolItems[chunk.toolCallId] = next;
      bus.emit(threadId, {
        type: 'activity_update',
        turnId: turn.turnId,
        item: next,
      });
    }
  }

  if (chunk.type === 'text-delta') {
    var createdAt = nowIso();
    var routeToWorkNote = !!(turn.hasToolActivity && !turn.finalAnswerUnlocked);
    if (routeToWorkNote) {
      emitWorkNote(threadId, turn, chunk.delta || '', createdAt);
    } else {
      if (!turn.assistantStarted) {
        turn.assistantStarted = true;
        turn.finalStartedAt = createdAt;
        bus.emit(threadId, {
          type: 'assistant_start',
          turnId: turn.turnId,
          messageId: turn.messageId,
          createdAt: createdAt,
        });
      }
      turn.finalText = (turn.finalText || '') + (chunk.delta || '');
      var assistantMessage = buildAssistantMessage(turn, createdAt);
      if (assistantMessage) {
        bus.emit(threadId, {
          type: 'assistant_delta',
          turnId: turn.turnId,
          messageId: assistantMessage.messageId,
          delta: chunk.delta || '',
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        });
      }
    }
  }

  if (chunk.type === 'error' || (chunkResult && chunkResult.action && chunkResult.action.type === 'error')) {
    failActiveTurn(threadId, record, new Error(chunk.errorText || (chunkResult.action && chunkResult.action.error) || 'Runtime stream failed.'));
    return;
  }

  if (payload.done) {
    finalizeActiveTurn(threadId, record);
  }
}

function handleClientMessage(threadId, record, event) {
  if (!event || typeof event.data !== 'string') return;

  var payload;
  try {
    payload = JSON.parse(event.data);
  } catch (_error) {
    return;
  }

  if (!payload || typeof payload !== 'object') {
    return;
  }

  if (payload.type === CHAT_MESSAGE_TYPES.CHAT_MESSAGES) {
    emitSnapshot(threadId, record, payload.messages);
    return;
  }

  if (payload.type !== CHAT_RESPONSE_TYPE) {
    return;
  }

  if (!record.activeTurn || payload.id !== record.activeTurn.requestId) {
    return;
  }

  if (payload.error) {
    failActiveTurn(threadId, record, new Error(payload.body || 'Chat request failed.'));
    return;
  }

  var chunk = parseChunkBody(payload.body);
  if (chunk) {
    processTurnChunk(threadId, record, payload, chunk);
    return;
  }

  if (payload.done) {
    finalizeActiveTurn(threadId, record);
  }
}

function attachClientListeners(threadId, record) {
  if (!record || record.listenersAttached) return;

  record.listenersAttached = true;
  record.client.addEventListener('message', function (event) {
    handleClientMessage(threadId, record, event);
  });
  record.client.addEventListener('close', function () {
    if (record.activeTurn) {
      failActiveTurn(threadId, record, new Error('Connection closed'));
    }
  });
}

async function connect(input) {
  if (!input || !input.threadId || !input.connection) {
    throw new Error('threadId and connection are required to connect to the Cloudflare runtime.');
  }

  var threadId = input.threadId;
  var nextKey = connectionKey(input.connection);
  var existing = getRecord(threadId);

  if (
    existing &&
    existing.key === nextKey &&
    existing.client &&
    existing.client.readyState !== 3 &&
    existing.connectionStatus === 'connected'
  ) {
    return existing.client;
  }

  if (existing && existing.client && typeof existing.client.close === 'function') {
    closeClientQuietly(existing.client, 1000, 'Reconnecting with updated runtime session.');
  }

  await waitForLocalRuntimeHost(input.connection);

  var ClientCtor = resolveAgentClientCtor();
  var record = null;
  var readyResolved = false;
  var resolveReady = null;
  var rejectReady = null;
  var readySignal = new Promise(function (resolve, reject) {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function settleReadyResolve() {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady();
  }

  function settleReadyReject(error) {
    if (readyResolved) return;
    readyResolved = true;
    rejectReady(toError(error, 'Runtime connection failed.'));
  }

  var client = new ClientCtor({
    agent: input.connection.agent,
    name: input.connection.name,
    host: normalizeHost(input.connection.host),
    path: normalizePath(input.connection.path),
    query: input.connection.query || {},
    onOpen: function () {
      if (record) {
        record.connectionStatus = 'connected';
        record.lastError = null;
      }
      settleReadyResolve();
      bus.emit(threadId, { type: 'status', status: 'connected' });
    },
    onClose: function () {
      if (record) {
        record.connectionStatus = 'closed';
      }
      settleReadyReject(new Error('Connection closed before the runtime became ready.'));
      bus.emit(threadId, { type: 'status', status: 'closed' });
    },
    onError: function (error) {
      var nextError = toError(error, 'Unknown runtime error.');
      if (record) {
        record.connectionStatus = 'error';
        record.lastError = nextError.message;
      }
      settleReadyReject(nextError);
      bus.emit(threadId, {
        type: 'error',
        error: nextError.message,
      });
    },
    onIdentity: function (name, agent) {
      bus.emit(threadId, {
        type: 'identity',
        name: name,
        agent: agent,
      });
    },
  });

  record = {
    key: nextKey,
    client: client,
    messages: [],
    activeTurn: null,
    listenersAttached: false,
    connectionStatus: 'connecting',
    lastError: null,
  };

  connections.set(threadId, record);
  attachClientListeners(threadId, record);
  bus.emit(threadId, { type: 'status', status: 'connecting' });

  Promise.resolve(client.ready).then(function () {
    settleReadyResolve();
  }, function (error) {
    settleReadyReject(error);
  });

  try {
    await withTimeout(readySignal, RUNTIME_CONNECT_TIMEOUT_MS, function () {
      if (record) {
        record.connectionStatus = 'error';
        record.lastError = 'Runtime connection timed out.';
      }
      bus.emit(threadId, {
        type: 'error',
        error: 'Runtime connection timed out.',
      });
      closeClientQuietly(client, 1000, 'Runtime connection timed out.');
    });
  } catch (error) {
    if (connections.get(threadId) === record) {
      connections.delete(threadId);
    }
    throw toError(error, 'Runtime connection failed.');
  }

  return client;
}

async function getMessages(input) {
  var client = await connect(input);
  var messages = await readCurrentMessages(client);
  var record = getRecord(input.threadId);
  if (record) {
    record.messages = messages;
  }
  return messages;
}

async function startTurn(input) {
  if (!input || !input.prompt) {
    throw new Error('A prompt is required to submit a runtime message.');
  }

  var client = await connect(input);
  var record = getRecord(input.threadId);
  if (!record) {
    throw new Error('Runtime connection record is unavailable.');
  }
  if (record.activeTurn) {
    throw new Error('A runtime turn is already active for this thread.');
  }

  var existingMessages = await readCurrentMessages(client);
  record.messages = existingMessages;

  var requestId = input.turnId || randomRequestId();
  var createdAt = nowIso();
  var userMessageId = randomRequestId();
  var doneResolve;
  var doneReject;
  var done = new Promise(function (resolve, reject) {
    doneResolve = resolve;
    doneReject = reject;
  });

  record.activeTurn = {
    requestId: requestId,
    turnId: requestId,
    prompt: String(input.prompt || ''),
    startedAt: createdAt,
    messageId: 'assistant-' + requestId,
    userMessageId: userMessageId,
    accumulator: null,
    assistantStarted: false,
    finalText: '',
    finalStartedAt: null,
    toolItems: {},
    pendingToolCalls: {},
    hasToolActivity: false,
    finalAnswerUnlocked: false,
    workNoteCount: 0,
    activeWorkNoteId: null,
    resolve: doneResolve,
    reject: doneReject,
  };

  bus.emit(input.threadId, {
    type: 'turn_start',
    turnId: requestId,
    prompt: String(input.prompt || ''),
    createdAt: createdAt,
  });
  bus.emit(input.threadId, {
    type: 'user_accepted',
    turnId: requestId,
    message: {
      id: userMessageId,
      role: 'user',
      content: String(input.prompt || ''),
      createdAt: createdAt,
    },
  });

  client.send(JSON.stringify({
    id: requestId,
    init: {
      method: 'POST',
      body: JSON.stringify(buildChatRequestPayload(Object.assign({}, input, {
        messages: existingMessages,
        userMessageId: userMessageId,
      }))),
    },
    type: CHAT_REQUEST_TYPE,
  }));

  return {
    turnId: requestId,
    done: done,
  };
}

async function sendMessage(input) {
  return startTurn(input);
}

async function resume(input) {
  var messages = await getMessages(input);
  var record = getRecord(input.threadId);
  if (record) {
    emitSnapshot(input.threadId, record, messages);
  }
  return messages;
}

function disconnect(threadId) {
  var record = getRecord(threadId);
  if (!record || !record.client || typeof record.client.close !== 'function') {
    return;
  }

  if (record.activeTurn) {
    failActiveTurn(threadId, record, new Error('Thread session closed.'));
  }
  record.client.close(1000, 'Thread session closed.');
  connections.delete(threadId);
}

var targetWindow = ensureWindow();
targetWindow.__tribexAiCloudflareBridge = {
  connect: connect,
  disconnect: disconnect,
  getMessages: getMessages,
  resume: resume,
  sendMessage: sendMessage,
  startTurn: startTurn,
  subscribe: bus.subscribe,
};
