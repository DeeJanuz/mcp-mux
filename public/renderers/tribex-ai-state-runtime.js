(function () {
  'use strict';

  window.__createTribexAiStateRuntime = function __createTribexAiStateRuntime(context, api) {
    var state = context.state;

    function getNestedValue(value, path) {
      var current = value;
      for (var i = 0; i < path.length; i += 1) {
        if (!current || typeof current !== 'object') return null;
        current = current[path[i]];
      }
      return current === undefined ? null : current;
    }

    function messageMatchesCandidate(message, candidate) {
      if (!message || !candidate) return false;
      if (candidate.messageId && message.messageId && candidate.messageId === message.messageId) {
        return true;
      }
      if (candidate.id && message.id && candidate.id === message.id) {
        return true;
      }
      return message.role === candidate.role && message.content === candidate.content;
    }

    function findMessageIndex(messages, candidate) {
      if (!Array.isArray(messages) || !candidate) return -1;
      for (var i = 0; i < messages.length; i += 1) {
        if (messageMatchesCandidate(messages[i], candidate)) {
          return i;
        }
      }
      return -1;
    }

    function pickLatestMessage(messages) {
      if (!Array.isArray(messages) || !messages.length) return null;
      return messages.reduce(function (latest, message) {
        if (!message) return latest;
        if (!latest) return message;
        var latestTime = api.parseActivityTimestamp(latest.createdAt);
        var messageTime = api.parseActivityTimestamp(message.createdAt);
        if (latestTime !== null && messageTime !== null && messageTime >= latestTime) {
          return message;
        }
        return latest;
      }, null);
    }

    function findUserIndexForActiveTurn(messages, activeTurn) {
      if (!Array.isArray(messages) || !activeTurn) return -1;

      if (activeTurn.turnId) {
        for (var i = 0; i < messages.length; i += 1) {
          if (messages[i] && messages[i].role === 'user' && messages[i].turnId === activeTurn.turnId) {
            return i;
          }
        }
      }

      if (activeTurn.turnOrdinal) {
        for (var ordinal = 0, j = 0; j < messages.length; j += 1) {
          if (!messages[j] || messages[j].role !== 'user') continue;
          ordinal += 1;
          if (messages[j].turnOrdinal === activeTurn.turnOrdinal || ordinal === activeTurn.turnOrdinal) {
            return j;
          }
        }
      }

      return findMessageIndex(messages, activeTurn.userMessage);
    }

    function findSettledAssistantForActiveTurn(messages, activeTurn) {
      if (!Array.isArray(messages) || !activeTurn) return null;

      var turnMatchedAssistants = messages.filter(function (message) {
        if (!message || message.role !== 'assistant') return false;
        if (activeTurn.turnId && message.turnId) return message.turnId === activeTurn.turnId;
        if (activeTurn.turnOrdinal && message.turnOrdinal) return message.turnOrdinal === activeTurn.turnOrdinal;
        return false;
      });
      if (turnMatchedAssistants.length) {
        return pickLatestMessage(turnMatchedAssistants);
      }

      var userIndex = findUserIndexForActiveTurn(messages, activeTurn);
      if (userIndex < 0) return null;
      for (var i = userIndex + 1; i < messages.length; i += 1) {
        var message = messages[i];
        if (!message) continue;
        if (message.role === 'user') break;
        if (message.role === 'assistant') {
          return message;
        }
      }

      return null;
    }

    function bindStreamListener() {
      if (context.streamListenerBound || !window.__tribexAiClient || typeof window.__tribexAiClient.listenToStreamEvents !== 'function') {
        return;
      }
      context.streamListenerBound = true;
      window.__tribexAiClient.listenToStreamEvents(handleStreamEvent).catch(function () {
        context.streamListenerBound = false;
      });
    }

    function resolveRelayUiStatus(relayState) {
      if (!relayState) return null;
      if (relayState.error) return 'error';
      if (relayState.streamStatus === 'connected' && relayState.presenceStatus === 'running') {
        return 'online';
      }
      if (
        relayState.streamStatus === 'connecting' ||
        relayState.streamStatus === 'connected' ||
        relayState.presenceStatus === 'connecting' ||
        relayState.presenceStatus === 'running'
      ) {
        return 'connecting';
      }
      return relayState.status || null;
    }

    function updateRelayState(threadId, patch) {
      if (!threadId) return null;
      var next = Object.assign({}, state.relayStates[threadId] || {}, patch || {});
      next.status = resolveRelayUiStatus(next);
      state.relayStates[threadId] = next;
      return next;
    }

    function extractLocalRelayThreadId(payload, fallbackRelayId) {
      if (!payload || typeof payload !== 'object') return fallbackRelayId || null;
      return payload.threadId
        || getNestedValue(payload, ['arguments', 'toolArgs', 'threadId'])
        || getNestedValue(payload, ['arguments', 'toolArgs', 'thread_id'])
        || getNestedValue(payload, ['arguments', 'tool_args', 'threadId'])
        || getNestedValue(payload, ['arguments', 'tool_args', 'thread_id'])
        || getNestedValue(payload, ['arguments', 'meta', 'threadId'])
        || getNestedValue(payload, ['arguments', 'meta', 'thread_id'])
        || fallbackRelayId
        || null;
    }

    function buildLocalRelayToolMessage(payload, forcedStatus) {
      if (!payload || typeof payload !== 'object' || !payload.toolName) return null;
      if (!window.__tribexAiClient || typeof window.__tribexAiClient.normalizeMessage !== 'function') {
        return null;
      }

      var argumentsData = payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {};
      var toolArgs = argumentsData.toolArgs || argumentsData.tool_args || null;
      var resultMeta = argumentsData.meta || null;
      var toolLabel = window.__tribexAiUtils && typeof window.__tribexAiUtils.titleCase === 'function'
        ? window.__tribexAiUtils.titleCase(payload.toolName)
        : String(payload.toolName || 'tool');
      var explicitDetail = payload.error || payload.detail || '';
      if (!explicitDetail && argumentsData.title) {
        explicitDetail = (forcedStatus === 'running' ? 'Preparing ' : 'Prepared ')
          + toolLabel
          + ' result: '
          + argumentsData.title
          + '.';
      }
      var normalized = window.__tribexAiClient.normalizeMessage({
        id: payload.requestId || payload.id || api.randomId('relay-tool'),
        toolName: payload.toolName,
        status: forcedStatus || (payload.success === false ? 'failed' : 'completed'),
        detail: explicitDetail,
        toolArgs: toolArgs,
        result: {
          data: argumentsData,
          meta: resultMeta,
        },
        createdAt: payload.createdAt || api.nowIso(),
      }, 0);

      if (!normalized || normalized.role !== 'tool') return null;
      normalized.status = forcedStatus || normalized.status || (payload.success === false ? 'failed' : 'completed');
      normalized.createdAt = normalized.createdAt || payload.createdAt || api.nowIso();
      if (payload.error && !normalized.detail) {
        normalized.detail = payload.error;
      }
      return normalized;
    }

    function handleLocalRelayToolEvent(event) {
      var payload = event && event.payload;
      if (!payload || typeof payload !== 'object') return false;
      if (payload.type !== 'relay.tool.request.local' && payload.type !== 'relay.tool.response.local') {
        return false;
      }

      var threadId = extractLocalRelayThreadId(payload, event.relayId);
      if (!threadId) return false;

      var record = api.ensureThreadDetailRecord(threadId);
      var normalizedMessage = buildLocalRelayToolMessage(
        payload,
        payload.type === 'relay.tool.request.local'
          ? 'running'
          : (payload.success === false ? 'failed' : 'completed')
      );
      if (!normalizedMessage) return false;

      var activityItem = buildCompanionActivityItem(normalizedMessage, record);
      if (!activityItem) return false;
      var nextItem = api.upsertActivityItem(record, activityItem);
      if (shouldAutoOpenArtifactItem(nextItem)) {
        api.openThreadArtifact(threadId, nextItem.artifactKey, {
          autoFocus: true,
        });
      }
      if (payload.success === false && payload.error) {
        state.threadErrors[threadId] = payload.error;
      }
      return true;
    }

    function bindDesktopRelayListener() {
      if (
        context.desktopRelayListenerBound ||
        !window.__tribexAiClient ||
        typeof window.__tribexAiClient.listenToDesktopRelayEvents !== 'function'
      ) {
        return;
      }
      context.desktopRelayListenerBound = true;
      window.__tribexAiClient.listenToDesktopRelayEvents(handleDesktopRelayEvent).catch(function () {
        context.desktopRelayListenerBound = false;
      });
    }

    function bindDesktopPresenceListener() {
      if (
        context.desktopPresenceListenerBound ||
        !window.__tribexAiClient ||
        typeof window.__tribexAiClient.listenToDesktopPresenceEvents !== 'function'
      ) {
        return;
      }
      context.desktopPresenceListenerBound = true;
      window.__tribexAiClient.listenToDesktopPresenceEvents(handleDesktopPresenceEvent).catch(function () {
        context.desktopPresenceListenerBound = false;
      });
    }

    function handleDesktopRelayEvent(event) {
      if (!event || !event.relayId) return;

      if (event.type === 'status') {
        updateRelayState(event.relayId, {
          streamStatus: event.status || 'idle',
          error: null,
        });
        api.notify();
        return;
      }

      if (event.type === 'error') {
        updateRelayState(event.relayId, {
          streamStatus: 'error',
          error: event.message || 'Desktop relay stream failed.',
        });
        api.notify();
        return;
      }

      if (event.type === 'data' && event.payload && typeof event.payload === 'object') {
        updateRelayState(event.relayId, {
          relaySessionId: event.payload.relaySessionId || null,
          relayDeviceId: event.payload.deviceId || null,
          lastRelayEventType: event.payload.type || null,
          error: null,
        });
        if (handleLocalRelayToolEvent(event)) {
          api.notify();
          return;
        }
        api.notify();
      }
    }

    function handleDesktopPresenceEvent(event) {
      if (!event || !event.heartbeatId) return;

      if (event.type === 'status') {
        updateRelayState(event.heartbeatId, {
          presenceStatus: event.status || 'idle',
          error: null,
        });
        api.notify();
        return;
      }

      if (event.type === 'error') {
        updateRelayState(event.heartbeatId, {
          presenceStatus: 'error',
          error: event.message || 'Desktop relay presence heartbeat failed.',
        });
        api.notify();
      }
    }

    function mergeThreadDetail(detail) {
      if (!detail || !detail.id) return null;
      var merged = api.ensureThreadDetailRecord(detail.id);

      if (detail.title) merged.title = detail.title;
      if (detail.projectId) merged.projectId = detail.projectId;
      if (detail.workspaceId) merged.workspaceId = detail.workspaceId;
      if (detail.organizationId) merged.organizationId = detail.organizationId;
      if (detail.hydrateState || detail.status) merged.hydrateState = detail.hydrateState || detail.status;
      if (detail.personaReleaseId) merged.personaReleaseId = detail.personaReleaseId;
      if (detail.persona) merged.persona = detail.persona;
      if (detail.personaRelease) merged.personaRelease = detail.personaRelease;
      if (detail.preview) merged.base.preview = detail.preview;
      if (detail.lastActivityAt) merged.base.lastActivityAt = detail.lastActivityAt;
      if (detail.rowState !== undefined) merged.rowState = detail.rowState;
      if (detail.optimistic !== undefined) merged.optimistic = !!detail.optimistic;
      if (detail.syncing !== undefined) merged.syncing = !!detail.syncing;
      if (detail.lastHydratedAt) merged.lastHydratedAt = detail.lastHydratedAt;

      if (detail.messagesSource === 'runtime') {
        merged.runtimeSnapshot = {
          rawMessages: Array.isArray(detail.rawRuntimeMessages) ? detail.rawRuntimeMessages.slice() : [],
          messages: Array.isArray(detail.runtimeMessages)
            ? detail.runtimeMessages.slice()
            : Array.isArray(detail.messages)
              ? detail.messages.slice()
              : [],
          preview: detail.preview || '',
          lastActivityAt: detail.lastActivityAt || null,
        };
        if (
          merged.activeTurn &&
          merged.activeTurn.userMessage &&
          api.containsMessage(merged.runtimeSnapshot.messages, merged.activeTurn.userMessage)
        ) {
          var settledAssistant = findSettledAssistantForActiveTurn(merged.runtimeSnapshot.messages, merged.activeTurn);
          if (settledAssistant) {
            merged.activeTurn.assistantMessage = Object.assign({}, settledAssistant, {
              turnId: merged.activeTurn.turnId || settledAssistant.turnId || null,
              turnOrdinal: merged.activeTurn.turnOrdinal || settledAssistant.turnOrdinal || null,
              isStreaming: false,
            });
            merged.activeTurn.status = 'finalized';
            api.rememberTurnHistory(merged);
          }
        }
        merged.lastTurnOrdinal = Math.max(
          merged.lastTurnOrdinal || 0,
          api.countUserMessages(merged.runtimeSnapshot.messages)
        );
        api.rebuildTurnHistory(merged);
        api.reconcileActiveTurn(merged);
        api.reconcileLiveActivity(merged);
        api.syncThreadArtifactDrawer(merged);
      } else if (Array.isArray(detail.messages)) {
        merged.base.messages = detail.messages.slice();
        api.rebuildTurnHistory(merged);
      }

      api.ensureThreadUi(detail.id);
      api.syncThreadSummaryFromRecord(merged);
      return merged;
    }

    function startActiveTurn(threadId, event) {
      var detail = api.ensureThreadDetailRecord(threadId);
      var existing = detail.activeTurn;
      var userMessage = event.message ? Object.assign({}, event.message) : null;
      var turnOrdinal = event.turnOrdinal
        || (existing && existing.turnOrdinal)
        || (userMessage && userMessage.turnOrdinal)
        || api.resolveNextTurnOrdinal(detail);

      if (
        existing &&
        existing.userMessage &&
        userMessage &&
        existing.userMessage.content === userMessage.content
      ) {
        userMessage = Object.assign({}, existing.userMessage, userMessage, {
          pending: false,
        });
      } else if (!userMessage && existing && existing.userMessage) {
        userMessage = Object.assign({}, existing.userMessage);
      }

      detail.activeTurn = {
        turnId: event.turnId || (existing && existing.turnId) || api.randomId('turn'),
        turnOrdinal: turnOrdinal,
        status: 'queued',
        userMessage: userMessage,
        assistantMessage: existing && existing.assistantMessage ? existing.assistantMessage : null,
        startedAt: event.createdAt || (existing && existing.startedAt) || api.nowIso(),
      };
      if (detail.activeTurn.userMessage) {
        detail.activeTurn.userMessage.turnId = detail.activeTurn.turnId;
        detail.activeTurn.userMessage.turnOrdinal = detail.activeTurn.turnOrdinal;
        detail.activeTurn.userMessage.pending = false;
      }
      if (detail.activeTurn.userMessage && detail.activeTurn.userMessage.content) {
        detail.base.preview = detail.activeTurn.userMessage.content;
        detail.base.lastActivityAt = detail.activeTurn.userMessage.createdAt || detail.base.lastActivityAt;
      }
      api.rememberTurnHistory(detail);
      api.syncThreadSummaryFromRecord(detail);
      return detail;
    }

    function queueLocalTurn(threadId, prompt, turnId) {
      var detail = api.ensureThreadDetailRecord(threadId);
      var createdAt = api.nowIso();
      var turnOrdinal = api.resolveNextTurnOrdinal(detail);

      detail.activeTurn = {
        turnId: turnId || api.randomId('turn'),
        turnOrdinal: turnOrdinal,
        status: 'queued',
        userMessage: {
          id: api.randomId('user'),
          role: 'user',
          content: prompt,
          createdAt: createdAt,
          pending: true,
          turnId: turnId || null,
          turnOrdinal: turnOrdinal,
        },
        assistantMessage: null,
        startedAt: createdAt,
      };
      detail.activeTurn.userMessage.turnId = detail.activeTurn.turnId;
      detail.base.preview = prompt;
      detail.base.lastActivityAt = createdAt;
      api.rememberTurnHistory(detail);
      api.syncThreadSummaryFromRecord(detail);
      return detail.activeTurn;
    }

    function appendLegacyMessage(record, message) {
      if (!record || !message) return;
      var messages = Array.isArray(record.base.messages) ? record.base.messages.slice() : [];

      if (message.role === 'assistant' && message.isStreaming && message.messageId) {
        var streamingIndex = messages.findIndex(function (candidate) {
          return candidate &&
            candidate.role === 'assistant' &&
            candidate.messageId === message.messageId;
        });

        if (streamingIndex >= 0) {
          var current = messages[streamingIndex];
          messages[streamingIndex] = Object.assign({}, current, message, {
            content: (current.content || '') + (message.content || ''),
          });
        } else {
          messages.push(Object.assign({}, message));
        }
      } else if (!api.containsMessage(messages, message)) {
        messages.push(Object.assign({}, message));
      }

      record.base.messages = messages;
      if (message.content && (message.role === 'user' || message.role === 'assistant')) {
        record.base.preview = message.content;
      }
      if (message.createdAt) {
        record.base.lastActivityAt = message.createdAt;
      }
      api.syncThreadSummaryFromRecord(record);
    }

    function buildCompanionActivityItem(message, record) {
      if (!message || message.role !== 'tool') return null;
      var previous = api.getStoredActivityItem(record, message.id || null);
      var latestTurn = api.getLatestTurnReference(record) || {};
      var resultContentType = message.resultContentType || message.contentType || message.toolName || null;
      var resultMeta = message.resultMeta || null;
      var sessionId = message.sessionId || null;
      var reviewRequired = !!(
        message.reviewRequired ||
        (resultMeta && resultMeta.reviewRequired)
      );
      var displayMode = api.resolveActivityDisplayMode(
        previous,
        resultContentType,
        reviewRequired,
        message.inlineDisplay
      );
      var inlineDisplay = displayMode === 'inline';
      return {
        id: message.id || api.randomId('activity'),
        toolCallId: message.id || null,
        sessionId: sessionId,
        toolName: message.toolName || null,
        resultContentType: resultContentType,
        title: message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'tool'),
        status: message.status || 'completed',
        detail: message.detail || '',
        resultData: message.resultData || null,
        resultMeta: resultMeta,
        reviewRequired: reviewRequired,
        displayMode: displayMode,
        inlineDisplay: inlineDisplay,
        toolArgs: message.toolArgs || null,
        turnId: message.turnId || latestTurn.turnId || null,
        turnOrdinal: message.turnOrdinal || latestTurn.turnOrdinal || null,
        createdAt: message.createdAt || api.nowIso(),
        updatedAt: message.createdAt || api.nowIso(),
      };
    }

    function shouldAutoOpenArtifactItem(item) {
      if (!item || !api.isRendererBackedActivityItem(item) || !item.artifactKey) {
        return false;
      }
      if (item.displayMode === 'inline' || item.inlineDisplay === true) {
        return false;
      }
      if (item.sessionId) {
        return false;
      }
      if (item.reviewRequired || (item.resultMeta && item.resultMeta.reviewRequired)) {
        return false;
      }
      return true;
    }

    function applySendResult(threadId, result) {
      if (!result) return result;
      if (result.done && typeof result.done.then === 'function') return result;

      var detail = null;
      if (result.messagesSource || Array.isArray(result.messages)) {
        detail = result;
      } else if (result.id || result.thread) {
        if (window.__tribexAiClient && typeof window.__tribexAiClient.normalizeThreadDetail === 'function') {
          detail = window.__tribexAiClient.normalizeThreadDetail(result);
        } else {
          detail = result.thread || result;
        }
      }

      if (detail && !detail.id) {
        detail.id = threadId;
      }

      if (detail && detail.id) {
        mergeThreadDetail(detail);
        state.threadErrors[threadId] = null;
      }

      return detail || result;
    }

    function updateActiveAssistant(threadId, updater) {
      var detail = api.ensureThreadDetailRecord(threadId);
      if (!detail.activeTurn) {
        detail.activeTurn = {
          turnId: null,
          status: 'running',
          userMessage: null,
          assistantMessage: null,
          startedAt: api.nowIso(),
        };
      }
      if (!detail.activeTurn.assistantMessage) {
        detail.activeTurn.assistantMessage = {
          id: 'runtime-assistant-' + Date.now(),
          role: 'assistant',
          content: '',
          createdAt: api.nowIso(),
          isStreaming: true,
          messageId: null,
          turnId: detail.activeTurn.turnId || null,
          turnOrdinal: detail.activeTurn.turnOrdinal || null,
        };
      }
      detail.activeTurn.assistantMessage.turnId = detail.activeTurn.turnId || detail.activeTurn.assistantMessage.turnId || null;
      detail.activeTurn.assistantMessage.turnOrdinal = detail.activeTurn.turnOrdinal || detail.activeTurn.assistantMessage.turnOrdinal || null;
      updater(detail.activeTurn.assistantMessage, detail.activeTurn);
      api.rememberTurnHistory(detail);
      api.syncThreadSummaryFromRecord(detail);
      return detail;
    }

    function postPushPreview(payload) {
      return fetch('http://localhost:4200/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(function () {});
    }

    function shouldSkipReplayEvent(threadId, payload) {
      if (!threadId || !payload || typeof payload !== 'object') return false;
      if (typeof payload.sequence !== 'number' || !Number.isFinite(payload.sequence)) return false;

      var lastSequence = state.lastCompanionSequences[threadId];
      if (typeof lastSequence === 'number' && payload.sequence <= lastSequence) {
        return true;
      }

      state.lastCompanionSequences[threadId] = payload.sequence;
      return false;
    }

    function handleStreamEvent(event) {
      if (!event || !event.threadId) return;

      if (event.type === 'status') {
        state.streamStatuses[event.threadId] = event.status || 'idle';
        api.notify();
        return;
      }

      if (event.type === 'error') {
        state.streamStatuses[event.threadId] = 'error';
        state.threadErrors[event.threadId] = event.message || 'Companion stream failed.';
        api.notify();
        return;
      }

      var payload = event.payload || {};
      if (shouldSkipReplayEvent(event.threadId, payload)) {
        return;
      }

      var existing = state.threadDetails[event.threadId];
      var runtimeDriven = !!(existing && (existing.runtimeSnapshot || existing.activeTurn));

      var normalizedMessage = window.__tribexAiClient && typeof window.__tribexAiClient.normalizeMessage === 'function'
        ? window.__tribexAiClient.normalizeMessage(payload, 0)
        : null;

      if (payload.thread || payload.messages || payload.events || payload.transcript) {
        if (!existing || (!existing.runtimeSnapshot && !existing.activeTurn)) {
          var detail = window.__tribexAiClient.normalizeThreadDetail(payload);
          if (detail && detail.id) {
            mergeThreadDetail(detail);
            state.threadErrors[event.threadId] = null;
            api.notify();
            return;
          }
        }
      }

      if (!normalizedMessage) {
        return;
      }

      var record = api.ensureThreadDetailRecord(event.threadId);
      runtimeDriven = !!(record.runtimeSnapshot || record.activeTurn);

      if (normalizedMessage.role === 'tool') {
        var activityItem = buildCompanionActivityItem(normalizedMessage, record);
        if (activityItem && activityItem.inlineDisplay) {
          api.upsertActivityItem(record, activityItem);
          state.threadErrors[event.threadId] = null;
          api.notify();
          return;
        }
        var isRendererArtifact = !!(activityItem && api.isRendererBackedActivityItem(activityItem));
        if (isRendererArtifact) {
          var storedArtifactItem = api.upsertActivityItem(record, activityItem);
          if (shouldAutoOpenArtifactItem(storedArtifactItem)) {
            api.openThreadArtifact(record.id, storedArtifactItem.artifactKey, {
              autoFocus: true,
            });
          }
          state.threadErrors[event.threadId] = null;
          api.notify();
          return;
        }

        if (runtimeDriven) {
          if (activityItem) {
            api.upsertActivityItem(record, activityItem);
            state.threadErrors[event.threadId] = null;
            api.notify();
          }
          return;
        }

        if (
          payload.toolName &&
          payload.result &&
          window.__tribexAiClient &&
          typeof window.__tribexAiClient.shouldPreviewCompanionPayload === 'function' &&
          window.__tribexAiClient.shouldPreviewCompanionPayload(payload)
        ) {
          postPushPreview(payload);
        }

        appendLegacyMessage(record, normalizedMessage);
        state.threadErrors[event.threadId] = null;
        api.notify();
        return;
      }

      if (!runtimeDriven && normalizedMessage.role === 'assistant') {
        appendLegacyMessage(record, normalizedMessage);
        state.threadErrors[event.threadId] = null;
        api.notify();
      }
    }

    function bindRuntimeBridge(threadId) {
      if (
        !threadId ||
        context.runtimeEventUnsubscribers[threadId] ||
        !window.__tribexAiClient ||
        typeof window.__tribexAiClient.listenToRuntimeEvents !== 'function'
      ) {
        return;
      }

      context.runtimeEventUnsubscribers[threadId] = window.__tribexAiClient.listenToRuntimeEvents(threadId, function (event) {
        handleRuntimeEvent(threadId, event);
      });
    }

    function unbindRuntimeBridge(threadId) {
      if (!threadId || !context.runtimeEventUnsubscribers[threadId]) return;
      try {
        context.runtimeEventUnsubscribers[threadId]();
      } catch (_error) {
        // Best-effort unsubscribe.
      }
      delete context.runtimeEventUnsubscribers[threadId];
    }

    function handleRuntimeEvent(threadId, event) {
      if (!threadId || !event) return;
      var detail = api.ensureThreadDetailRecord(threadId);

      if (event.type === 'status') {
        detail.connection.runtimeStatus = event.status || 'idle';
        api.notify();
        return;
      }

      if (event.type === 'error') {
        detail.connection.runtimeError = event.error || 'Runtime connection failed.';
        state.threadErrors[threadId] = detail.connection.runtimeError;
        delete state.pendingThreadIds[threadId];
        api.notify();
        return;
      }

      if (event.type === 'identity') {
        detail.connection.identity = {
          name: event.name || null,
          agent: event.agent || null,
        };
        api.notify();
        return;
      }

      if (event.type === 'runtime_snapshot') {
        if (window.__tribexAiClient && typeof window.__tribexAiClient.normalizeRuntimeTranscript === 'function') {
          mergeThreadDetail(window.__tribexAiClient.normalizeRuntimeTranscript(threadId, {
            messages: event.messages || [],
          }));
        }
        state.threadErrors[threadId] = null;
        api.notify();
        return;
      }

      if (event.type === 'turn_start') {
        state.threadErrors[threadId] = null;
        api.notify();
        return;
      }

      if (event.type === 'user_accepted') {
        startActiveTurn(threadId, event);
        api.notify();
        return;
      }

      if (event.type === 'assistant_start') {
        updateActiveAssistant(threadId, function (message, activeTurn) {
          message.id = event.messageId || message.id;
          message.messageId = event.messageId || message.messageId || null;
          message.createdAt = event.createdAt || message.createdAt;
          message.isStreaming = true;
          activeTurn.status = 'running';
        });
        api.notify();
        return;
      }

      if (event.type === 'assistant_delta') {
        updateActiveAssistant(threadId, function (message, activeTurn) {
          message.id = event.messageId || message.id;
          message.messageId = event.messageId || message.messageId || null;
          message.createdAt = event.createdAt || message.createdAt;
          message.content = event.content || ((message.content || '') + (event.delta || ''));
          message.isStreaming = true;
          activeTurn.status = 'running';
        });
        api.notify();
        return;
      }

      if (event.type === 'assistant_finish') {
        if (event.turnId) {
          detail.turnCompletedAtById[event.turnId] = (event.message && event.message.createdAt) || event.createdAt || api.nowIso();
        }
        updateActiveAssistant(threadId, function (message, activeTurn) {
          message.id = event.message && event.message.id ? event.message.id : message.id;
          message.messageId = event.message && event.message.messageId ? event.message.messageId : (message.messageId || null);
          message.createdAt = event.message && event.message.createdAt ? event.message.createdAt : (event.createdAt || message.createdAt);
          message.content = event.message && typeof event.message.content === 'string' ? event.message.content : message.content;
          message.isStreaming = false;
          activeTurn.status = 'finalized';
        });
        api.rememberTurnHistory(detail);
        api.notify();
        return;
      }

      if ((event.type === 'activity_update' || event.type === 'work_note_update') && event.item) {
        var normalizedActivityItem = buildCompanionActivityItem(Object.assign({
          role: 'tool',
        }, event.item), detail);
        var nextItem = api.upsertActivityItem(detail, Object.assign({}, normalizedActivityItem || event.item, {
          turnId: event.item.turnId || event.turnId || (detail.activeTurn && detail.activeTurn.turnId) || null,
          turnOrdinal: event.item.turnOrdinal || (detail.activeTurn && detail.activeTurn.turnOrdinal) || detail.lastTurnOrdinal || null,
        }));
        if (shouldAutoOpenArtifactItem(nextItem)) {
          api.openThreadArtifact(threadId, nextItem.artifactKey, {
            autoFocus: true,
          });
        }
        api.notify();
        return;
      }

      if (event.type === 'assistant_reset') {
        if (detail.activeTurn && (!detail.activeTurn.turnId || detail.activeTurn.turnId === event.turnId)) {
          detail.activeTurn.assistantMessage = null;
          api.rememberTurnHistory(detail);
        }
        api.notify();
        return;
      }

      if (event.type === 'turn_error') {
        if (event.turnId) {
          detail.turnCompletedAtById[event.turnId] = event.createdAt || api.nowIso();
        } else if (detail.activeTurn && detail.activeTurn.turnId) {
          detail.turnCompletedAtById[detail.activeTurn.turnId] = event.createdAt || api.nowIso();
        }
        if (detail.activeTurn && (!detail.activeTurn.turnId || detail.activeTurn.turnId === event.turnId)) {
          detail.lastTurnId = detail.activeTurn.turnId || detail.lastTurnId || null;
          detail.lastTurnOrdinal = detail.activeTurn.turnOrdinal || detail.lastTurnOrdinal || 0;
          detail.activeTurn.status = 'failed';
          if (detail.activeTurn.assistantMessage) {
            detail.activeTurn.assistantMessage.isStreaming = false;
          }
          api.rememberTurnHistory(detail);
        }
        detail.connection.runtimeError = event.error || 'Runtime turn failed.';
        state.threadErrors[threadId] = detail.connection.runtimeError;
        delete state.pendingThreadIds[threadId];
        api.notify();
        return;
      }

      if (event.type === 'turn_finish') {
        if (event.turnId) {
          detail.turnCompletedAtById[event.turnId] = event.createdAt || api.nowIso();
        } else if (detail.activeTurn && detail.activeTurn.turnId) {
          detail.turnCompletedAtById[detail.activeTurn.turnId] = event.createdAt || api.nowIso();
        }
        if (detail.activeTurn && (!detail.activeTurn.turnId || detail.activeTurn.turnId === event.turnId)) {
          detail.lastTurnId = detail.activeTurn.turnId || detail.lastTurnId || null;
          detail.lastTurnOrdinal = detail.activeTurn.turnOrdinal || detail.lastTurnOrdinal || 0;
          if (detail.activeTurn.assistantMessage) {
            detail.activeTurn.assistantMessage.isStreaming = false;
          }
          if (detail.activeTurn.status !== 'failed') {
            detail.activeTurn.status = 'finalized';
          }
          api.rememberTurnHistory(detail);
        }
        delete state.pendingThreadIds[threadId];
        state.threadErrors[threadId] = null;
        api.syncThreadSummaryFromRecord(detail);
        api.notify();
      }
    }

    api.bindStreamListener = bindStreamListener;
    api.resolveRelayUiStatus = resolveRelayUiStatus;
    api.updateRelayState = updateRelayState;
    api.bindDesktopRelayListener = bindDesktopRelayListener;
    api.bindDesktopPresenceListener = bindDesktopPresenceListener;
    api.handleDesktopRelayEvent = handleDesktopRelayEvent;
    api.handleDesktopPresenceEvent = handleDesktopPresenceEvent;
    api.mergeThreadDetail = mergeThreadDetail;
    api.startActiveTurn = startActiveTurn;
    api.queueLocalTurn = queueLocalTurn;
    api.appendLegacyMessage = appendLegacyMessage;
    api.buildCompanionActivityItem = buildCompanionActivityItem;
    api.applySendResult = applySendResult;
    api.updateActiveAssistant = updateActiveAssistant;
    api.postPushPreview = postPushPreview;
    api.shouldSkipReplayEvent = shouldSkipReplayEvent;
    api.handleStreamEvent = handleStreamEvent;
    api.bindRuntimeBridge = bindRuntimeBridge;
    api.unbindRuntimeBridge = unbindRuntimeBridge;
    api.handleRuntimeEvent = handleRuntimeEvent;

    return api;
  };
})();
