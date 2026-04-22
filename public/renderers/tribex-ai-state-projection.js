(function () {
  'use strict';

  window.__createTribexAiStateProjection = function __createTribexAiStateProjection(context, api) {
    var state = context.state;

    function maxActivityTimestamp(left, right) {
      if (typeof api.maxActivityTimestamp === 'function') {
        return api.maxActivityTimestamp(left, right);
      }
      if (!left) return right || null;
      if (!right) return left || null;
      var leftTime = api.parseActivityTimestamp(left);
      var rightTime = api.parseActivityTimestamp(right);
      if (leftTime === null || Number.isNaN(leftTime)) return right;
      if (rightTime === null || Number.isNaN(rightTime)) return left;
      return rightTime >= leftTime ? right : left;
    }

    function firstValidTimestamp(values) {
      for (var index = 0; index < values.length; index += 1) {
        var value = values[index];
        if (value && api.parseActivityTimestamp(value) !== null) return value;
      }
      return null;
    }

    function getActivityStartedAt(item, fallback) {
      return firstValidTimestamp([
        item && item.startedAt,
        item && item.startTime,
        item && item.createdAt,
        fallback,
      ]);
    }

    function getActivityEndedAt(item, fallback) {
      return firstValidTimestamp([
        item && item.completedAt,
        item && item.finishedAt,
        item && item.endedAt,
        item && item.updatedAt,
        item && item.createdAt,
        fallback,
      ]);
    }

    function hasTerminalActivityTimestamp(item) {
      return !!firstValidTimestamp([
        item && item.completedAt,
        item && item.finishedAt,
        item && item.endedAt,
        item && item.updatedAt,
      ]);
    }

    function getActivityTerminalEndedAt(item, fallback) {
      var startedAt = getActivityStartedAt(item, null);
      var startedTime = startedAt ? api.parseActivityTimestamp(startedAt) : null;
      var explicitEndedAt = firstValidTimestamp([
        item && item.completedAt,
        item && item.finishedAt,
        item && item.endedAt,
      ]);
      var explicitEndedTime = explicitEndedAt ? api.parseActivityTimestamp(explicitEndedAt) : null;
      if (
        explicitEndedAt &&
        (startedTime === null || (explicitEndedTime !== null && explicitEndedTime > startedTime))
      ) {
        return explicitEndedAt;
      }

      var updatedAt = firstValidTimestamp([item && item.updatedAt]);
      var updatedTime = updatedAt ? api.parseActivityTimestamp(updatedAt) : null;
      if (
        updatedAt &&
        (startedTime === null || (updatedTime !== null && updatedTime > startedTime))
      ) {
        return updatedAt;
      }
      return fallback || null;
    }

    function latestWorkItemTimestamp(workItems) {
      return (workItems || []).reduce(function (latest, item) {
        return maxActivityTimestamp(latest, getActivityTerminalEndedAt(item, null));
      }, null);
    }

    function resolveWorkSessionEndedAt(record, turn, assistantMessage, workItems, startedAt) {
      var workEndedAt = latestWorkItemTimestamp(workItems);
      if (workEndedAt) return workEndedAt;
      var turnCompletedAt = record && record.turnCompletedAtById && turn && turn.turnId
        ? record.turnCompletedAtById[turn.turnId] || null
        : null;
      return maxActivityTimestamp(
        maxActivityTimestamp(
          maxActivityTimestamp(turnCompletedAt, turn && turn.endedAt ? turn.endedAt : null),
          assistantMessage && !assistantMessage.isStreaming ? assistantMessage.createdAt || null : null
        ),
        latestWorkItemTimestamp(workItems)
      ) || startedAt || null;
    }

    function turnMatchesReference(turn, reference) {
      if (!turn || !reference) return false;
      if (turn.turnId && reference.turnId) return turn.turnId === reference.turnId;
      if (turn.turnOrdinal && reference.turnOrdinal) return turn.turnOrdinal === reference.turnOrdinal;
      return false;
    }

    function isActiveTurnForWorkSession(record, turn) {
      var activeTurn = record && record.activeTurn ? record.activeTurn : null;
      if (!activeTurn || !turnMatchesReference(turn, activeTurn)) return false;
      var status = String(activeTurn.status || '').toLowerCase();
      return status !== 'finalized' && status !== 'failed' && status !== 'completed';
    }

    function isRunningActivityItem(item) {
      return !!(item && (item.status === 'running' || item.status === 'needs-approval'));
    }

    function isWorkSessionLive(record, turn, assistantMessage, workItems) {
      if (assistantMessage && assistantMessage.isStreaming) return true;
      if (!isActiveTurnForWorkSession(record, turn)) return false;
      var activeStatus = String(record.activeTurn.status || '').toLowerCase();
      if (activeStatus === 'queued' || activeStatus === 'running') return true;
      return (workItems || []).some(isRunningActivityItem);
    }

    function copyMessages(messages) {
      return Array.isArray(messages)
        ? messages.filter(Boolean).map(function (message) {
          return Object.assign({}, message);
        })
        : [];
    }

    function cloneValue(value) {
      if (value === undefined || value === null) return value;
      return JSON.parse(JSON.stringify(value));
    }

    function createThreadDetailRecord(threadId) {
      var summary = api.getThread(threadId) || {};
      return {
        id: threadId,
        title: summary.title || 'Thread',
        projectId: summary.projectId || null,
        workspaceId: summary.workspaceId || null,
        organizationId: summary.organizationId || null,
        parentThreadId: summary.parentThreadId || null,
        hydrateState: summary.hydrateState || summary.status || null,
        preview: summary.preview || '',
        messageActivityAt: summary.messageActivityAt || summary.lastActivityAt || null,
        lastActivityAt: summary.lastActivityAt || null,
        personaReleaseId: summary.personaReleaseId || null,
        persona: summary.persona || null,
        personaRelease: summary.personaRelease || null,
        rowState: summary.rowState || null,
        optimistic: !!summary.optimistic,
        syncing: !!summary.syncing,
        lastHydratedAt: summary.lastHydratedAt || null,
        base: {
          preview: summary.preview || '',
          lastActivityAt: summary.messageActivityAt || summary.lastActivityAt || null,
          messages: [],
        },
        runtimeSnapshot: null,
        activeTurn: null,
        lastTurnId: null,
        lastTurnOrdinal: 0,
        turnCompletedAtById: {},
        turnHistoryById: {},
        turnOrder: [],
        activity: {
          itemsById: {},
          order: [],
        },
        artifactDrawer: {
          drawerId: 'tribex-ai-thread-artifacts:' + threadId,
          selectedArtifactKey: null,
        },
        connection: {
          runtimeStatus: null,
          runtimeError: null,
          identity: null,
        },
      };
    }

    function ensureThreadDetailRecord(threadId) {
      var existing = state.threadEntitiesById[threadId];
      if (existing && existing.base && existing.activity && existing.connection) {
        return existing;
      }

      var record = createThreadDetailRecord(threadId);
      if (existing) {
        Object.keys(existing).forEach(function (key) {
          if (key === 'base' || key === 'activity' || key === 'artifactDrawer' || key === 'connection') {
            return;
          }
          if (existing[key] !== undefined) {
            record[key] = existing[key];
          }
        });

        if (existing.base) {
          record.base = Object.assign({}, record.base, existing.base, {
            messages: Array.isArray(existing.base.messages) ? existing.base.messages.slice() : record.base.messages,
          });
        }
        if (existing.activity) {
          record.activity = Object.assign({}, record.activity, existing.activity, {
            itemsById: existing.activity.itemsById || record.activity.itemsById,
            order: Array.isArray(existing.activity.order) ? existing.activity.order.slice() : record.activity.order,
          });
        }
        if (existing.artifactDrawer) {
          record.artifactDrawer = Object.assign({}, record.artifactDrawer, existing.artifactDrawer);
        }
        if (existing.connection) {
          record.connection = Object.assign({}, record.connection, existing.connection);
        }
        if (Array.isArray(existing.turnOrder)) {
          record.turnOrder = existing.turnOrder.slice();
        }
      }

      state.threadEntitiesById[threadId] = record;
      state.threadDetails = state.threadEntitiesById;
      return record;
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

    function containsMessage(messages, candidate) {
      return (messages || []).some(function (message) {
        return messageMatchesCandidate(message, candidate);
      });
    }

    function extractSnapshotMessages(record) {
      if (record && record.runtimeSnapshot && Array.isArray(record.runtimeSnapshot.messages)) {
        return copyMessages(record.runtimeSnapshot.messages);
      }
      if (record && record.base && Array.isArray(record.base.messages)) {
        return copyMessages(record.base.messages);
      }
      return [];
    }

    function countUserMessages(messages) {
      return (messages || []).reduce(function (count, message) {
        return message && message.role === 'user' ? count + 1 : count;
      }, 0);
    }

    function getLatestTurnReference(record) {
      if (record && record.activeTurn) {
        return {
          turnId: record.activeTurn.turnId || null,
          turnOrdinal: record.activeTurn.turnOrdinal || null,
        };
      }
      if (record && (record.lastTurnId || record.lastTurnOrdinal)) {
        return {
          turnId: record.lastTurnId || null,
          turnOrdinal: record.lastTurnOrdinal || null,
        };
      }
      return null;
    }

    function resolveNextTurnOrdinal(record) {
      var snapshotCount = countUserMessages(extractSnapshotMessages(record));
      var lastOrdinal = record && record.lastTurnOrdinal ? record.lastTurnOrdinal : 0;
      var historyOrdinal = 0;
      if (record && record.turnHistoryById) {
        Object.keys(record.turnHistoryById).forEach(function (key) {
          var turn = record.turnHistoryById[key];
          if (turn && turn.turnOrdinal && turn.turnOrdinal > historyOrdinal) {
            historyOrdinal = turn.turnOrdinal;
          }
        });
      }
      return Math.max(snapshotCount, lastOrdinal, historyOrdinal) + 1;
    }

    function resolveActivityContentType(item) {
      if (!item) return null;
      return item.resultContentType || item.contentType || item.toolName || null;
    }

    function buildTurnKey(turnId, turnOrdinal) {
      if (turnId) return 'id:' + String(turnId);
      if (turnOrdinal) return 'ordinal:' + String(turnOrdinal);
      return null;
    }

    function createTurnEntry(turnId, turnOrdinal) {
      return {
        key: buildTurnKey(turnId, turnOrdinal),
        turnId: turnId || null,
        turnOrdinal: turnOrdinal || null,
        status: 'completed',
        startedAt: null,
        endedAt: null,
        userMessage: null,
        assistantMessage: null,
        activityItemsById: {},
        activityOrder: [],
        resultItemsById: {},
        resultOrder: [],
      };
    }

    function copyKnownTurns(record) {
      var turns = [];
      var seen = {};

      function remember(turn) {
        if (!turn) return;
        var key = buildTurnKey(turn.turnId, turn.turnOrdinal)
          || (turn.userMessage && (turn.userMessage.id || turn.userMessage.messageId))
          || null;
        if (key && seen[key]) return;
        if (key) seen[key] = true;
        turns.push(turn);
      }

      if (record && record.activeTurn) {
        remember(record.activeTurn);
      }

      (Array.isArray(record && record.turnOrder) ? record.turnOrder : Object.keys(record && record.turnHistoryById || {})).forEach(function (key) {
        remember(record.turnHistoryById && record.turnHistoryById[key]);
      });

      return turns;
    }

    function applyTurnReference(message, turn) {
      if (!message || !turn) return;
      if (!message.turnId && turn.turnId) message.turnId = turn.turnId;
      if (!message.turnOrdinal && turn.turnOrdinal) message.turnOrdinal = turn.turnOrdinal;
    }

    function findTurnForSnapshotUser(record, message) {
      var turns = copyKnownTurns(record);
      for (var index = 0; index < turns.length; index += 1) {
        var turn = turns[index];
        if (turn && turn.userMessage && messageMatchesCandidate(turn.userMessage, message)) {
          return turn;
        }
      }
      for (var contentIndex = 0; contentIndex < turns.length; contentIndex += 1) {
        var candidate = turns[contentIndex];
        if (
          candidate &&
          candidate.userMessage &&
          candidate.userMessage.content &&
          candidate.userMessage.content === message.content
        ) {
          return candidate;
        }
      }
      return null;
    }

    function findTurnForSnapshotAssistant(record, message, currentTurn) {
      if (currentTurn) return currentTurn;
      var turns = copyKnownTurns(record);
      for (var index = 0; index < turns.length; index += 1) {
        var turn = turns[index];
        if (turn && turn.assistantMessage && messageMatchesCandidate(turn.assistantMessage, message)) {
          return turn;
        }
      }
      for (var contentIndex = 0; contentIndex < turns.length; contentIndex += 1) {
        var candidate = turns[contentIndex];
        if (
          candidate &&
          candidate.assistantMessage &&
          candidate.assistantMessage.content &&
          candidate.assistantMessage.content === message.content
        ) {
          return candidate;
        }
      }
      return null;
    }

    function reconcileRuntimeSnapshotTurnReferences(record) {
      if (!record || !record.runtimeSnapshot || !Array.isArray(record.runtimeSnapshot.messages)) return;
      var currentTurn = null;

      record.runtimeSnapshot.messages.forEach(function (message) {
        if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;
        if (message.role === 'user') {
          currentTurn = findTurnForSnapshotUser(record, message);
          applyTurnReference(message, currentTurn);
          return;
        }

        var assistantTurn = findTurnForSnapshotAssistant(record, message, currentTurn);
        applyTurnReference(message, assistantTurn);
      });
    }

    function findTurnKeyByOrdinal(record, turnOrdinal) {
      if (!record || !turnOrdinal) return null;
      var keys = Array.isArray(record.turnOrder) ? record.turnOrder : Object.keys(record.turnHistoryById || {});
      for (var index = 0; index < keys.length; index += 1) {
        var candidate = record.turnHistoryById[keys[index]];
        if (candidate && candidate.turnOrdinal === turnOrdinal) {
          return keys[index];
        }
      }
      return null;
    }

    function ensureTurnEntry(record, turnId, turnOrdinal) {
      if (!record) return null;
      var key = buildTurnKey(turnId, turnOrdinal);
      if (!key && turnOrdinal) {
        key = findTurnKeyByOrdinal(record, turnOrdinal);
      }
      if (key && !record.turnHistoryById[key] && turnOrdinal) {
        var ordinalKey = findTurnKeyByOrdinal(record, turnOrdinal);
        if (ordinalKey) {
          key = ordinalKey;
        }
      }
      if (!key) return null;
      if (!record.turnHistoryById[key]) {
        record.turnHistoryById[key] = createTurnEntry(turnId, turnOrdinal);
      }
      var originalKey = key;
      var turn = record.turnHistoryById[key];
      if (turnId && !turn.turnId) turn.turnId = turnId;
      if (turnOrdinal && !turn.turnOrdinal) turn.turnOrdinal = turnOrdinal;
      var nextKey = buildTurnKey(turn.turnId, turn.turnOrdinal) || key;
      if (nextKey !== key && !record.turnHistoryById[nextKey]) {
        delete record.turnHistoryById[key];
        record.turnHistoryById[nextKey] = turn;
        key = nextKey;
      }
      turn.key = key;
      record.turnOrder = (record.turnOrder || []).map(function (candidate) {
        return candidate === originalKey ? key : candidate;
      });
      if (record.turnOrder.indexOf(turn.key) === -1) {
        record.turnOrder.push(turn.key);
      }
      return turn;
    }

    function getStoredActivityItem(record, itemId) {
      if (!record || !itemId) return null;
      if (record.activity && record.activity.itemsById && record.activity.itemsById[itemId]) {
        return record.activity.itemsById[itemId];
      }
      var keys = Array.isArray(record.turnOrder) ? record.turnOrder : Object.keys(record.turnHistoryById || {});
      for (var index = 0; index < keys.length; index += 1) {
        var turn = record.turnHistoryById[keys[index]];
        if (!turn || !turn.activityItemsById) continue;
        if (turn.activityItemsById[itemId]) return turn.activityItemsById[itemId];
      }
      return null;
    }

    function isInlineCapableContentType(contentType) {
      return contentType === 'rich_content' || contentType === 'structured_data';
    }

    function resolveActivityDisplayMode(previous, contentType, reviewRequired, explicitInlineDisplay) {
      if (previous && previous.displayMode) {
        return previous.displayMode;
      }
      if (previous && previous.inlineDisplay === true) {
        return 'inline';
      }
      if (explicitInlineDisplay === true) {
        return 'inline';
      }
      if (reviewRequired) {
        return 'artifact';
      }
      return isInlineCapableContentType(contentType) ? 'inline' : 'artifact';
    }

    function getCanonicalActivityDisplayMode(item) {
      if (!item) return null;
      return resolveActivityDisplayMode(
        item,
        resolveActivityContentType(item),
        !!(
          item.reviewRequired ||
          (item.resultMeta && item.resultMeta.reviewRequired)
        ),
        item.inlineDisplay === true ? true : undefined
      );
    }

    function copyActivityItem(item) {
      if (!item) return null;
      return Object.assign({}, item, {
        resultData: cloneValue(item.resultData || null),
        resultMeta: cloneValue(item.resultMeta || null),
        toolArgs: cloneValue(item.toolArgs || null),
        rawInput: cloneValue(item.rawInput || null),
        rawOutput: cloneValue(item.rawOutput || null),
      });
    }

    function isRendererResultItem(item) {
      return !!(
        item &&
        isCompletedActivityStatus(item.status) &&
        item.resultData &&
        resolveActivityContentType(item)
      );
    }

    function isReopenableRendererActivityItem(item) {
      return !!(
        item &&
        isRendererResultItem(item) &&
        getCanonicalActivityDisplayMode(item) === 'artifact'
      );
    }

    function isCompletedActivityStatus(status) {
      var value = String(status || '').toLowerCase();
      return value === 'completed' || value === 'success' || value === 'done' || value === 'stored';
    }

    function isRendererBackedActivityItem(item) {
      var contentType = resolveActivityContentType(item);
      return !!(
        item &&
        getCanonicalActivityDisplayMode(item) === 'artifact' &&
        isCompletedActivityStatus(item.status) &&
        item.resultData &&
        contentType &&
        window.__renderers &&
        typeof window.__renderers[contentType] === 'function'
      );
    }

    function isInlineRendererActivityItem(item) {
      var contentType = resolveActivityContentType(item);
      return !!(
        item &&
        getCanonicalActivityDisplayMode(item) === 'inline' &&
        isCompletedActivityStatus(item.status) &&
        item.resultData &&
        contentType &&
        window.__renderers &&
        typeof window.__renderers[contentType] === 'function'
      );
    }

    function syncActivityItemToTurn(record, item) {
      if (!record || !item) return null;
      var turn = ensureTurnEntry(record, item.turnId || null, item.turnOrdinal || null);
      if (!turn) return null;
      turn.startedAt = turn.startedAt || item.createdAt || item.updatedAt || null;
      if (item.status === 'running' || item.status === 'needs-approval') {
        turn.status = 'running';
      } else if (item.status === 'failed') {
        turn.status = 'failed';
        turn.endedAt = maxActivityTimestamp(turn.endedAt, getActivityEndedAt(item, null));
      } else if (turn.status !== 'failed') {
        turn.status = 'completed';
        turn.endedAt = maxActivityTimestamp(turn.endedAt, getActivityEndedAt(item, null));
      }
      turn.activityItemsById[item.id] = copyActivityItem(item);
      if (turn.activityOrder.indexOf(item.id) === -1) {
        turn.activityOrder.push(item.id);
      }
      if (isRendererResultItem(item)) {
        turn.resultItemsById[item.id] = copyActivityItem(item);
        if (turn.resultOrder.indexOf(item.id) === -1) {
          turn.resultOrder.push(item.id);
        }
      }
      return turn;
    }

    function mergeTurnMessage(turn, message) {
      if (!turn || !message) return;
      if (message.role === 'user') {
        var previousUserCreatedAt = turn.userMessage && turn.userMessage.createdAt ? turn.userMessage.createdAt : null;
        turn.userMessage = Object.assign({}, turn.userMessage || {}, message);
        if (!turn.userMessage.createdAt && previousUserCreatedAt) {
          turn.userMessage.createdAt = previousUserCreatedAt;
        }
        turn.startedAt = turn.startedAt || message.createdAt || null;
        return;
      }
      if (message.role === 'assistant') {
        var previousAssistantCreatedAt = turn.assistantMessage && turn.assistantMessage.createdAt ? turn.assistantMessage.createdAt : null;
        turn.assistantMessage = Object.assign({}, turn.assistantMessage || {}, message);
        if (!turn.assistantMessage.createdAt && previousAssistantCreatedAt) {
          turn.assistantMessage.createdAt = previousAssistantCreatedAt;
        }
        turn.endedAt = message.isStreaming ? null : (message.createdAt || turn.endedAt || null);
        if (message.isStreaming) {
          turn.status = 'running';
        } else if (turn.status !== 'failed') {
          turn.status = 'completed';
        }
      }
    }

    function maybeParseStructuredValue(value) {
      if (!value || typeof value !== 'string') return value;
      var trimmed = value.trim();
      if (!trimmed) return value;
      if (trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '[') return value;
      try {
        return JSON.parse(trimmed);
      } catch (_error) {
        return value;
      }
    }

    function hasRendererDataShape(contentType, data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      if (contentType === 'structured_data') {
        return Array.isArray(data.tables);
      }
      if (contentType === 'rich_content') {
        return !!(
          typeof data.body === 'string' ||
          typeof data.title === 'string' ||
          Array.isArray(data.tables) ||
          (data.citations && typeof data.citations === 'object') ||
          (data.suggestions && typeof data.suggestions === 'object')
        );
      }
      return false;
    }

    function buildRendererPayload(contentType, data, meta, toolArgs, reviewRequired) {
      if (!contentType || !hasRendererDataShape(contentType, data)) return null;
      var nextMeta = meta && typeof meta === 'object' && !Array.isArray(meta)
        ? Object.assign({}, meta)
        : {};
      if (reviewRequired) {
        nextMeta.reviewRequired = true;
      }
      return {
        contentType: contentType,
        data: cloneValue(data),
        meta: nextMeta,
        toolArgs: toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs)
          ? cloneValue(toolArgs)
          : null,
        reviewRequired: !!reviewRequired,
      };
    }

    function unwrapRendererEnvelope(value, reviewRequired) {
      var raw = maybeParseStructuredValue(value);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      var contentType = raw.tool_name || raw.toolName || raw.contentType || raw.content_type || null;
      var data = raw.data || raw.result || raw.payload || null;
      var meta = raw.meta || null;
      var toolArgs = raw.toolArgs || raw.tool_args || null;
      return buildRendererPayload(contentType, data, meta, toolArgs, reviewRequired);
    }

    function extractRendererPayloadFromToolPart(toolName, part, existing) {
      if (!part) return existing || null;
      var reviewRequired = !!(
        part.reviewRequired ||
        (part.meta && part.meta.reviewRequired) ||
        (existing && (existing.reviewRequired || (existing.resultMeta && existing.resultMeta.reviewRequired)))
      );
      var toolArgs = part.toolArgs || part.tool_args || (existing && existing.toolArgs) || null;
      var explicitContentType = part.resultContentType || part.contentType || part.content_type || null;
      var candidates = [
        part.resultData,
        part.output,
        part.input,
      ];

      if (toolName === 'push_content' || toolName === 'push_review') {
        for (var wrappedIndex = 0; wrappedIndex < candidates.length; wrappedIndex += 1) {
          var wrappedPayload = unwrapRendererEnvelope(candidates[wrappedIndex], reviewRequired);
          if (wrappedPayload) return wrappedPayload;
        }
      }

      var contentTypes = [
        explicitContentType,
        toolName === 'push_review' || toolName === 'push_content' ? null : toolName,
        existing && resolveActivityContentType(existing),
      ];

      for (var typeIndex = 0; typeIndex < contentTypes.length; typeIndex += 1) {
        var contentType = contentTypes[typeIndex];
        if (!contentType) continue;
        for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
          var payload = buildRendererPayload(
            contentType,
            maybeParseStructuredValue(candidates[candidateIndex]),
            part.resultMeta || part.meta || (existing && existing.resultMeta) || null,
            toolArgs,
            reviewRequired
          );
          if (payload) return payload;
        }
      }

      if (existing && existing.resultData) {
        return {
          contentType: resolveActivityContentType(existing),
          data: cloneValue(existing.resultData),
          meta: cloneValue(existing.resultMeta || null),
          toolArgs: cloneValue(existing.toolArgs || null),
          reviewRequired: !!reviewRequired,
        };
      }
      return null;
    }

    function buildArtifactSessionKey(threadId, artifactKey) {
      return 'tribex-ai-artifact:' + String(threadId || 'thread') + ':' + String(artifactKey || 'result');
    }

    function buildActivityArtifactConfig(threadId, item) {
      var contentType = resolveActivityContentType(item);
      var title = (item.resultData && item.resultData.title)
        || item.title
        || (item.toolName && window.__tribexAiUtils.titleCase(item.toolName))
        || 'Result';
      var reviewRequired = !!(
        item.reviewRequired ||
        (item.resultMeta && item.resultMeta.reviewRequired)
      );
      var artifactKey = [
        'tribex-ai-result',
        threadId || 'thread',
        item.turnId || ('ordinal-' + String(item.turnOrdinal || '0')),
        item.toolCallId || item.id || contentType || 'result',
      ].join(':');
      return {
        drawerId: 'tribex-ai-thread-artifacts:' + (threadId || 'thread'),
        artifactKey: artifactKey,
        sessionKey: buildArtifactSessionKey(threadId, artifactKey),
        sessionId: item.sessionId || null,
        title: title,
        contentType: contentType || 'rich_content',
        data: item.resultData || {},
        meta: Object.assign({}, item.resultMeta || {}, {
          headerTitle: title,
          reviewRequired: reviewRequired,
          reviewSessionId: item.sessionId || null,
          threadId: threadId || null,
          turnId: item.turnId || null,
          turnOrdinal: item.turnOrdinal || null,
          activityId: item.id || null,
          artifactSource: 'tribex-ai-thread-result',
          artifactKey: artifactKey,
        }),
        toolArgs: item.toolArgs || {},
        reviewRequired: reviewRequired,
        reviewSessionId: item.sessionId || null,
      };
    }

    function buildLegacyMessageArtifactConfig(threadId, message) {
      var contentType = resolveActivityContentType(message);
      var title = (message.resultData && message.resultData.title)
        || message.resultTitle
        || message.title
        || (message.toolName && window.__tribexAiUtils.titleCase(message.toolName))
        || 'Result';
      var reviewSessionId = message.sessionId
        || (message.resultMeta && (message.resultMeta.sessionId || message.resultMeta.reviewSessionId))
        || null;
      var reviewRequired = !!(
        message.reviewRequired ||
        (message.resultMeta && message.resultMeta.reviewRequired)
      );

      return {
        artifactKey: message.artifactKey,
        sessionKey: buildArtifactSessionKey(threadId, message.artifactKey),
        sessionId: reviewSessionId,
        title: title,
        contentType: contentType || 'rich_content',
        data: message.resultData || {},
        meta: Object.assign({}, message.resultMeta || {}, {
          headerTitle: title,
          reviewRequired: reviewRequired,
          reviewSessionId: reviewSessionId,
          threadId: threadId || null,
          activityId: message.id || null,
          artifactSource: 'tribex-ai-thread-result',
          artifactKey: message.artifactKey,
        }),
        toolArgs: message.toolArgs || {},
        reviewRequired: reviewRequired,
        reviewSessionId: reviewSessionId,
      };
    }

    function normalizeArtifactItems(record) {
      if (!record) return [];
      var byKey = {};

      function registerArtifact(config, item) {
        if (!config || !config.artifactKey) return;
        var artifactKey = config.artifactKey;
        if (!item) return;
        byKey[artifactKey] = {
          artifactKey: artifactKey,
          sessionKey: config.sessionKey,
          sessionId: config.sessionId,
          title: item.resultTitle || config.title,
          contentType: config.contentType,
          data: config.data,
          meta: config.meta,
          toolArgs: config.toolArgs,
          reviewRequired: config.reviewRequired,
          reviewSessionId: config.reviewSessionId,
          createdAt: item.createdAt || null,
          updatedAt: item.updatedAt || item.createdAt || null,
        };
      }

      function registerActivityItem(item) {
        if (!item) return;
        var config = buildActivityArtifactConfig(record.id, item);
        if (item.artifactKey) {
          config.artifactKey = item.artifactKey;
          config.sessionKey = buildArtifactSessionKey(record.id, item.artifactKey);
        }
        registerArtifact(config, item);
      }

      function registerLegacyMessage(message) {
        if (!message || !message.artifactKey || byKey[message.artifactKey]) return;
        registerArtifact(buildLegacyMessageArtifactConfig(record.id, message), message);
      }

      buildActivityItems(record)
        .filter(function (item) {
          return isReopenableRendererActivityItem(item);
        })
        .forEach(registerActivityItem);

      extractSnapshotMessages(record)
        .filter(function (message) {
          if (!message || message.role !== 'tool' || !message.artifactKey || !message.resultData) {
            return false;
          }
          return getCanonicalActivityDisplayMode({
            displayMode: message.displayMode,
            inlineDisplay: message.inlineDisplay,
            reviewRequired: message.reviewRequired,
            resultMeta: message.resultMeta || null,
            resultContentType: resolveActivityContentType(message),
            contentType: resolveActivityContentType(message),
            toolName: message.toolName || null,
            resultData: message.resultData || null,
            status: message.status || 'completed',
          }) === 'artifact';
        })
        .forEach(registerLegacyMessage);

      return Object.keys(byKey).map(function (artifactKey) {
        return byKey[artifactKey];
      });
    }

    function syncThreadArtifactDrawer(record) {
      if (!record) return;

      var artifacts = normalizeArtifactItems(record);
      if (!record.artifactDrawer) {
        record.artifactDrawer = {
          drawerId: 'tribex-ai-thread-artifacts:' + record.id,
          selectedArtifactKey: null,
        };
      }

      if (
        record.artifactDrawer.selectedArtifactKey &&
        !artifacts.some(function (artifact) {
          return artifact.artifactKey === record.artifactDrawer.selectedArtifactKey;
        })
      ) {
        record.artifactDrawer.selectedArtifactKey = null;
      }

      if (!record.artifactDrawer.selectedArtifactKey && artifacts.length) {
        record.artifactDrawer.selectedArtifactKey = artifacts[artifacts.length - 1].artifactKey;
      }

      if (!artifacts.length && !record.artifactDrawer.selectedArtifactKey) {
        return;
      }
    }

    function attachActivityResultDrawer(record, item) {
      if (!record || !item || !isRendererResultItem(item)) return item;
      var config = buildActivityArtifactConfig(record.id, item);
      var nextItem = Object.assign({}, item, {
        artifactKey: item.artifactKey || config.artifactKey,
        resultContentType: item.resultContentType || config.contentType,
        resultTitle: item.resultTitle || config.title,
      });

      if (nextItem.displayMode === 'inline' || nextItem.inlineDisplay === true) {
        return nextItem;
      }

      record.artifactDrawer = record.artifactDrawer || {
        drawerId: config.drawerId,
        selectedArtifactKey: null,
      };
      record.artifactDrawer.drawerId = config.drawerId;
      record.artifactDrawer.selectedArtifactKey = nextItem.artifactKey;
      nextItem.artifactDrawerId = config.drawerId;
      return nextItem;
    }

    function normalizeToolPartStatus(part, message) {
      if (!part) return 'running';
      if (part.state === 'output-error' || part.state === 'output-denied') return 'failed';
      if (part.state === 'approval-requested') return 'needs-approval';
      if (part.state === 'output-available') return part.preliminary ? 'running' : 'completed';
      if (hasTerminalActivityTimestamp(part)) return 'completed';
      if (message && message.role === 'assistant' && message.isStreaming !== true) return 'completed';
      return 'running';
    }

    function buildToolPartDetail(part) {
      if (!part) return '';
      if (part.errorText) return String(part.errorText);
      if (part.output != null) return api.stringifyPreview(part.output);
      if (part.input != null) return api.stringifyPreview(part.input);
      return '';
    }

    function buildSnapshotActivityItems(record) {
      var itemsById = {};
      var order = [];
      var rawMessages = record && record.runtimeSnapshot && Array.isArray(record.runtimeSnapshot.rawMessages)
        ? record.runtimeSnapshot.rawMessages
        : [];
      var turnOrdinal = 0;

      rawMessages.forEach(function (message, messageIndex) {
        if (message && message.role === 'user') {
          turnOrdinal += 1;
        }
        var parts = Array.isArray(message && message.parts) ? message.parts : [];
        parts.forEach(function (part, partIndex) {
          if (!part || typeof part.type !== 'string' || part.type.indexOf('tool-') !== 0 || !part.toolCallId) {
            return;
          }

          var existing = itemsById[part.toolCallId];
          var stored = getStoredActivityItem(record, part.toolCallId);
          var rendererPayload = extractRendererPayloadFromToolPart(part.toolName || (existing && existing.toolName) || null, part, stored || existing);
          var contentType = rendererPayload
            ? rendererPayload.contentType
            : (existing && existing.resultContentType) || (stored && stored.resultContentType) || null;
          var reviewRequired = !!(
            (rendererPayload && rendererPayload.reviewRequired) ||
            (stored && (stored.reviewRequired || (stored.resultMeta && stored.resultMeta.reviewRequired))) ||
            (existing && (existing.reviewRequired || (existing.resultMeta && existing.resultMeta.reviewRequired)))
          );
          var sessionId = part.sessionId
            || part.session_id
            || (part.output && (part.output.sessionId || part.output.session_id))
            || (existing && existing.sessionId)
            || (stored && stored.sessionId)
            || null;
          var displayMode = resolveActivityDisplayMode(
            stored || existing,
            contentType || part.toolName || null,
            reviewRequired,
            stored && stored.displayMode === 'inline'
              ? true
              : (stored && stored.displayMode === 'artifact' ? false : undefined)
          );
          var status = normalizeToolPartStatus(part, message);
          var createdAt = (existing && existing.createdAt) || getActivityStartedAt(part, message.createdAt || null);
          var updatedAt = firstValidTimestamp([
            part && part.completedAt,
            part && part.finishedAt,
            part && part.endedAt,
            part && part.updatedAt,
            existing && existing.completedAt,
            stored && stored.completedAt,
            existing && existing.updatedAt,
            stored && stored.updatedAt,
          ]) || createdAt;
          var explicitCompletedAt = firstValidTimestamp([
            part && part.completedAt,
            part && part.finishedAt,
            part && part.endedAt,
          ]);
          var completedAt = (isCompletedActivityStatus(status) || status === 'failed')
            ? (explicitCompletedAt || (existing && existing.completedAt) || (stored && stored.completedAt) || updatedAt)
            : ((existing && existing.completedAt) || (stored && stored.completedAt) || null);
          var item = {
            id: part.toolCallId,
            toolCallId: part.toolCallId,
            toolName: part.toolName || (existing && existing.toolName) || null,
            title: part.title || (existing && existing.title) || window.__tribexAiUtils.titleCase(part.toolName || 'tool'),
            status: status,
            detail: buildToolPartDetail(part) || (existing && existing.detail) || '',
            createdAt: createdAt,
            updatedAt: updatedAt,
            completedAt: completedAt,
            turnId: part.turnId || message.turnId || (existing && existing.turnId) || null,
            turnOrdinal: part.turnOrdinal || message.turnOrdinal || (existing && existing.turnOrdinal) || (turnOrdinal || null),
            sortIndex: messageIndex * 100 + partIndex,
            sessionId: sessionId,
            resultContentType: contentType,
            resultData: rendererPayload ? rendererPayload.data : ((existing && existing.resultData) || (stored && stored.resultData) || null),
            resultMeta: rendererPayload ? rendererPayload.meta : ((existing && existing.resultMeta) || (stored && stored.resultMeta) || null),
            toolArgs: rendererPayload ? rendererPayload.toolArgs : ((existing && existing.toolArgs) || (stored && stored.toolArgs) || null),
            reviewRequired: reviewRequired,
            displayMode: displayMode,
            inlineDisplay: displayMode === 'inline',
          };

          item = attachActivityResultDrawer(record, item);
          itemsById[item.id] = item;
          if (order.indexOf(item.id) === -1) {
            order.push(item.id);
          }
        });
      });

      return order.map(function (itemId) {
        return itemsById[itemId];
      });
    }

    function upsertActivityItem(record, item) {
      if (!record || !item || !item.id) return null;
      var existing = record.activity.itemsById[item.id] || null;
      var latestTurn = getLatestTurnReference(record) || {};
      var nextItem = Object.assign({}, existing || {}, item);
      if (!nextItem.turnId && latestTurn.turnId) {
        nextItem.turnId = latestTurn.turnId;
      }
      if (!nextItem.turnOrdinal && latestTurn.turnOrdinal) {
        nextItem.turnOrdinal = latestTurn.turnOrdinal;
      }
      nextItem = attachActivityResultDrawer(record, nextItem);
      record.activity.itemsById[item.id] = nextItem;
      if (record.activity.order.indexOf(item.id) === -1) {
        record.activity.order.push(item.id);
      }
      syncActivityItemToTurn(record, nextItem);
      syncThreadArtifactDrawer(record);
      return nextItem;
    }

    function reconcileLiveActivity(record) {
      if (!record || !record.activity) return;
      var snapshotItems = buildSnapshotActivityItems(record);
      snapshotItems.forEach(function (item) {
        if (!item || !item.id) return;
        var existing = record.activity.itemsById[item.id];
        if (!existing) return;
        if (existing.resultData) return;
        record.activity.itemsById[item.id] = Object.assign({}, existing, item, {
          resultData: existing.resultData || item.resultData || null,
          resultMeta: existing.resultMeta || item.resultMeta || null,
          toolArgs: existing.toolArgs || item.toolArgs || null,
          sessionId: existing.sessionId || item.sessionId || null,
          createdAt: existing.createdAt || item.createdAt,
          updatedAt: item.updatedAt || existing.updatedAt,
          completedAt: existing.completedAt || item.completedAt || null,
          turnId: existing.turnId || item.turnId,
          turnOrdinal: existing.turnOrdinal || item.turnOrdinal,
        });
        syncActivityItemToTurn(record, record.activity.itemsById[item.id]);
      });
      syncThreadArtifactDrawer(record);
    }

    function buildActivityItems(record) {
      var itemsById = {};
      var order = [];

      buildSnapshotActivityItems(record).forEach(function (item) {
        itemsById[item.id] = Object.assign({}, item);
        order.push(item.id);
      });

      (record && record.activity && Array.isArray(record.activity.order) ? record.activity.order : []).forEach(function (itemId) {
        var item = record.activity.itemsById[itemId];
        if (!item) return;
        itemsById[itemId] = Object.assign({}, itemsById[itemId] || {}, item);
        if (order.indexOf(itemId) === -1) {
          order.push(itemId);
        }
      });

      return order
        .map(function (itemId, index) {
          var item = itemsById[itemId];
          if (!item) return null;
          return {
            item: Object.assign({}, item),
            index: index,
            timestamp: api.parseActivityTimestamp(item.updatedAt || item.createdAt),
          };
        })
        .filter(Boolean)
        .sort(function (left, right) {
          if (left.item.status !== right.item.status) {
            if (left.item.status === 'running') return -1;
            if (right.item.status === 'running') return 1;
          }
          if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp) {
            return right.timestamp - left.timestamp;
          }
          if (left.timestamp === null && right.timestamp !== null) return 1;
          if (left.timestamp !== null && right.timestamp === null) return -1;
          return left.index - right.index;
        })
        .map(function (entry) {
          return entry.item;
        });
    }

    function buildDisplayMessages(record) {
      function roleOrder(message) {
        if (!message) return 99;
        if (message.role === 'user') return 0;
        if (message.role === 'assistant') return 1;
        if (message.role === 'tool') return 2;
        return 99;
      }

      function sameTurn(left, right) {
        if (!left || !right) return false;
        if (left.turnId && right.turnId) return left.turnId === right.turnId;
        if (left.turnOrdinal && right.turnOrdinal) return left.turnOrdinal === right.turnOrdinal;
        return false;
      }

      var messages = extractSnapshotMessages(record);
      var activeTurn = record && record.activeTurn ? record.activeTurn : null;

      if (activeTurn && activeTurn.userMessage && !containsMessage(messages, activeTurn.userMessage)) {
        messages.push(Object.assign({}, activeTurn.userMessage));
      }

      if (activeTurn && activeTurn.assistantMessage && activeTurn.assistantMessage.content && !containsMessage(messages, activeTurn.assistantMessage)) {
        messages.push(Object.assign({}, activeTurn.assistantMessage));
      }

      return messages
        .map(function (message, index) {
          return {
            message: message,
            index: index,
            timestamp: api.parseActivityTimestamp(message && message.createdAt),
          };
        })
        .sort(function (left, right) {
          if (sameTurn(left.message, right.message) && roleOrder(left.message) !== roleOrder(right.message)) {
            return roleOrder(left.message) - roleOrder(right.message);
          }
          if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp) {
            return left.timestamp - right.timestamp;
          }
          if (left.timestamp === null && right.timestamp !== null) return 1;
          if (left.timestamp !== null && right.timestamp === null) return -1;
          if (roleOrder(left.message) !== roleOrder(right.message)) {
            return roleOrder(left.message) - roleOrder(right.message);
          }
          return left.index - right.index;
        })
        .map(function (entry) {
          return entry.message;
        });
    }

    function buildRunGroups(record, displayMessages, activityItems) {
      var keys = Array.isArray(record && record.turnOrder) ? record.turnOrder : [];
      if (keys.length) {
        return keys
          .map(function (key, index) {
            var turn = record.turnHistoryById[key];
            if (!turn || !turn.userMessage) return null;

            var workItems = (turn.activityOrder || []).map(function (itemId) {
              return turn.activityItemsById[itemId] ? copyActivityItem(turn.activityItemsById[itemId]) : null;
            }).filter(Boolean);
            var inlineResults = (turn.resultOrder || []).map(function (itemId) {
              return turn.resultItemsById[itemId] ? copyActivityItem(turn.resultItemsById[itemId]) : null;
            }).filter(function (item) {
              return item && getCanonicalActivityDisplayMode(item) === 'inline';
            }).map(function (item) {
              item.contentType = resolveActivityContentType(item);
              return item;
            });
            workItems = workItems.filter(function (item) {
              return !(item && getCanonicalActivityDisplayMode(item) === 'inline' && isRendererResultItem(item));
            });

            workItems.sort(function (left, right) {
              var leftTime = api.parseActivityTimestamp(left.createdAt || left.updatedAt);
              var rightTime = api.parseActivityTimestamp(right.createdAt || right.updatedAt);
              if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
                return leftTime - rightTime;
              }
              if (leftTime === null && rightTime !== null) return 1;
              if (leftTime !== null && rightTime === null) return -1;
              return String(left.id || '').localeCompare(String(right.id || ''));
            });

            var assistantMessage = turn.assistantMessage ? Object.assign({}, turn.assistantMessage) : null;
            var hasRunning = isWorkSessionLive(record, turn, assistantMessage, workItems);
            var startedAt = workItems.length
              ? (workItems[0].createdAt || workItems[0].updatedAt || turn.startedAt || (turn.userMessage && turn.userMessage.createdAt) || null)
              : (turn.startedAt || (turn.userMessage && turn.userMessage.createdAt) || null);
            var endedAt = resolveWorkSessionEndedAt(record, turn, assistantMessage, workItems, startedAt);

            return {
              id: turn.turnId || ('turn-' + index),
              turnId: turn.turnId || null,
              turnOrdinal: turn.turnOrdinal || null,
              user: Object.assign({}, turn.userMessage),
              latestCreatedAt: (turn.userMessage && turn.userMessage.createdAt) || turn.startedAt || null,
              answer: assistantMessage ? {
                id: assistantMessage.id || ('answer-' + index),
                content: assistantMessage.content || '',
                createdAt: assistantMessage.createdAt || null,
                isStreaming: !!assistantMessage.isStreaming,
                inlineResults: inlineResults,
              } : {
                id: 'answer-' + index,
                content: '',
                createdAt: null,
                isStreaming: false,
                inlineResults: inlineResults,
              },
              workSession: workItems.length ? {
                id: turn.turnId || ('work-session-' + index),
                turnId: turn.turnId || null,
                turnOrdinal: turn.turnOrdinal || null,
                status: hasRunning ? 'running' : (turn.status === 'failed' ? 'failed' : 'completed'),
                startedAt: startedAt,
                endedAt: hasRunning ? null : endedAt,
                items: workItems,
              } : null,
            };
          })
          .filter(Boolean);
      }

      var runs = [];
      var fallbackToLegacy = false;
      var turnOrdinal = 0;
      var historyByTurnId = {};
      var historyByTurnOrdinal = {};

      if (record && record.turnHistoryById) {
        Object.keys(record.turnHistoryById).forEach(function (turnId) {
          var entry = record.turnHistoryById[turnId];
          if (!entry) return;
          if (entry.turnId) historyByTurnId[entry.turnId] = entry;
          if (entry.turnOrdinal) historyByTurnOrdinal[entry.turnOrdinal] = entry;
        });
      }

      (displayMessages || []).forEach(function (message, index) {
        if (!message) return;
        if (message.role === 'user') {
          turnOrdinal += 1;
          runs.push({
            id: message.turnId || ('run-' + (message.id || index)),
            turnId: message.turnId || null,
            turnOrdinal: message.turnOrdinal || turnOrdinal,
            userMessage: Object.assign({}, message),
            assistantMessage: null,
            workSession: null,
            latestCreatedAt: message.createdAt || null,
          });
          return;
        }

        if (message.role !== 'assistant') {
          fallbackToLegacy = true;
          return;
        }

        if (!runs.length) {
          fallbackToLegacy = true;
          return;
        }

        var current = runs[runs.length - 1];
        if (!current.assistantMessage) {
          current.assistantMessage = Object.assign({}, message);
        } else {
          current.assistantMessage = Object.assign({}, current.assistantMessage, message, {
            content: [current.assistantMessage.content, message.content].filter(Boolean).join('\n\n'),
            isStreaming: !!message.isStreaming,
            createdAt: message.createdAt || current.assistantMessage.createdAt,
          });
        }

        if (!current.turnId && message.turnId) {
          current.turnId = message.turnId;
        }
        if (!current.turnOrdinal && message.turnOrdinal) {
          current.turnOrdinal = message.turnOrdinal;
        }
      });

      if (fallbackToLegacy) return null;

      var activityByTurnId = {};
      var activityByTurnOrdinal = {};
      (activityItems || []).forEach(function (item) {
        if (!item) return;
        if (item.turnId) {
          activityByTurnId[item.turnId] = activityByTurnId[item.turnId] || [];
          activityByTurnId[item.turnId].push(Object.assign({}, item));
          return;
        }
        if (item.turnOrdinal) {
          activityByTurnOrdinal[item.turnOrdinal] = activityByTurnOrdinal[item.turnOrdinal] || [];
          activityByTurnOrdinal[item.turnOrdinal].push(Object.assign({}, item));
        }
      });

      return runs.map(function (run, index) {
        var history = (run.turnId && historyByTurnId[run.turnId])
          || (run.turnOrdinal && historyByTurnOrdinal[run.turnOrdinal])
          || null;
        var workItems = [];
        if (run.turnId && activityByTurnId[run.turnId]) {
          workItems = activityByTurnId[run.turnId].slice();
        } else if (run.turnOrdinal && activityByTurnOrdinal[run.turnOrdinal]) {
          workItems = activityByTurnOrdinal[run.turnOrdinal].slice();
        }

        workItems.sort(function (left, right) {
          var leftTime = api.parseActivityTimestamp(left.createdAt || left.updatedAt);
          var rightTime = api.parseActivityTimestamp(right.createdAt || right.updatedAt);
          if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
            return leftTime - rightTime;
          }
          if (leftTime === null && rightTime !== null) return 1;
          if (leftTime !== null && rightTime === null) return -1;
          return String(left.id || '').localeCompare(String(right.id || ''));
        });

        var inlineResults = workItems
          .filter(function (item) {
            return isInlineRendererActivityItem(item);
          })
          .map(function (item) {
            return Object.assign({}, item, {
              contentType: resolveActivityContentType(item),
            });
          });
        workItems = workItems.filter(function (item) {
          return !isInlineRendererActivityItem(item);
        });

        var startedAt = workItems.length
          ? (workItems[0].createdAt || workItems[0].updatedAt || run.userMessage.createdAt || null)
          : null;
        var assistantMessage = history
          ? (history.assistantMessage ? Object.assign({}, history.assistantMessage) : null)
          : (run.assistantMessage ? Object.assign({}, run.assistantMessage) : null);
        var userMessage = history && history.userMessage
          ? Object.assign({}, history.userMessage)
          : Object.assign({}, run.userMessage);
        var endedAt = resolveWorkSessionEndedAt(record, Object.assign({}, history || {}, {
          turnId: run.turnId || (history && history.turnId) || null,
          turnOrdinal: run.turnOrdinal || (history && history.turnOrdinal) || null,
          endedAt: history && history.endedAt ? history.endedAt : null,
        }), assistantMessage, workItems, startedAt);
        var turnReference = Object.assign({}, history || {}, {
          turnId: run.turnId || (history && history.turnId) || null,
          turnOrdinal: run.turnOrdinal || (history && history.turnOrdinal) || null,
        });
        var hasRunning = isWorkSessionLive(record, turnReference, assistantMessage, workItems);
        var workSession = workItems.length
          ? {
            id: run.turnId || ('work-session-' + index),
            turnId: run.turnId || null,
            turnOrdinal: run.turnOrdinal || null,
            status: hasRunning ? 'running' : 'completed',
            startedAt: startedAt,
            endedAt: hasRunning ? null : endedAt,
            items: workItems,
          }
          : null;

        return {
          id: run.id,
          turnId: run.turnId || null,
          turnOrdinal: run.turnOrdinal || null,
          user: userMessage,
          latestCreatedAt: run.latestCreatedAt,
          answer: assistantMessage ? {
            id: assistantMessage.id || ('answer-' + index),
            content: assistantMessage.content || '',
            createdAt: assistantMessage.createdAt || null,
            isStreaming: !!assistantMessage.isStreaming,
            inlineResults: inlineResults,
          } : {
            id: 'answer-' + index,
            content: '',
            createdAt: null,
            isStreaming: false,
            inlineResults: inlineResults,
          },
          workSession: workSession,
        };
      });
    }

    function buildThreadProjection(record) {
      var recordBase = record && record.base ? record.base : {};
      var displayMessages = buildDisplayMessages(record);
      var activityItems = buildActivityItems(record);
      var runs = buildRunGroups(record, displayMessages, activityItems);
      var artifacts = normalizeArtifactItems(record);
      var latestConversationMessage = null;
      for (var messageIndex = displayMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        var candidateMessage = displayMessages[messageIndex];
        if (!candidateMessage) continue;
        if (candidateMessage.role === 'user' || candidateMessage.role === 'assistant') {
          latestConversationMessage = candidateMessage;
          break;
        }
      }
      var previewSource = null;
      var messageActivityAt = maxActivityTimestamp(
        maxActivityTimestamp(
          record && record.messageActivityAt ? record.messageActivityAt : null,
          recordBase.lastActivityAt || null
        ),
        maxActivityTimestamp(
          record && record.lastActivityAt ? record.lastActivityAt : null,
          record && record.runtimeSnapshot ? (record.runtimeSnapshot.messageActivityAt || record.runtimeSnapshot.lastActivityAt || null) : null
        )
      );
      if (latestConversationMessage && latestConversationMessage.createdAt) {
        messageActivityAt = maxActivityTimestamp(messageActivityAt, latestConversationMessage.createdAt);
      }
      var lastActivityAt = messageActivityAt;

      if (Array.isArray(runs) && runs.length) {
        for (var runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
          var run = runs[runIndex];
          if (run && run.answer && run.answer.content) {
            previewSource = run.answer.content;
            break;
          }
          if (run && run.user && run.user.content) {
            previewSource = run.user.content;
            break;
          }
        }
      }

      if (!previewSource) {
        for (var index = displayMessages.length - 1; index >= 0; index -= 1) {
          var candidate = displayMessages[index];
          if (!candidate || !candidate.content) continue;
          if (candidate.role === 'user' || candidate.role === 'assistant') {
            previewSource = candidate.content;
            break;
          }
        }
      }

      var preview = previewSource
        || (record.runtimeSnapshot && record.runtimeSnapshot.preview)
        || recordBase.preview
        || record.preview
        || '';

      if (
        record &&
        record.activeTurn &&
        record.activeTurn.userMessage &&
        record.activeTurn.userMessage.content &&
        record.activeTurn.status !== 'finalized' &&
        record.activeTurn.status !== 'failed'
      ) {
        var activeTurnTime = api.parseActivityTimestamp(record.activeTurn.userMessage.createdAt || record.activeTurn.startedAt);
        var projectedTime = api.parseActivityTimestamp(messageActivityAt);
        if (projectedTime === null || (activeTurnTime !== null && activeTurnTime >= projectedTime)) {
          preview = record.activeTurn.userMessage.content;
        }
      }

      return {
        displayMessages: displayMessages,
        activityItems: activityItems,
        runs: runs,
        artifacts: artifacts,
        artifactDrawer: record && record.artifactDrawer
          ? {
            drawerId: record.artifactDrawer.drawerId || null,
            selectedArtifactKey: record.artifactDrawer.selectedArtifactKey || null,
            artifactKeys: artifacts.map(function (artifact) {
              return artifact.artifactKey;
            }),
          }
          : null,
        preview: preview,
        messageActivityAt: messageActivityAt,
        lastActivityAt: lastActivityAt,
      };
    }

    function syncThreadSummaryFromRecord(record) {
      if (!record) return;
      var projection = buildThreadProjection(record);
      record.preview = projection.preview;
      record.messageActivityAt = projection.messageActivityAt;
      record.lastActivityAt = projection.lastActivityAt;
      api.mergeThreadSummary({
        id: record.id,
        title: record.title,
        projectId: record.projectId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        parentThreadId: record.parentThreadId || null,
        preview: projection.preview,
        hydrateState: record.hydrateState,
        messageActivityAt: projection.messageActivityAt,
        lastActivityAt: projection.lastActivityAt,
        personaReleaseId: record.personaReleaseId,
        persona: record.persona || null,
        personaRelease: record.personaRelease || null,
        rowState: record.rowState || null,
        optimistic: !!record.optimistic,
        syncing: !!record.syncing,
        lastHydratedAt: record.lastHydratedAt || null,
      });
    }

    function rememberTurnHistory(record) {
      if (!record || !record.activeTurn || !record.activeTurn.turnId) return;
      var turn = ensureTurnEntry(record, record.activeTurn.turnId || null, record.activeTurn.turnOrdinal || null);
      if (!turn) return;
      turn.startedAt = record.activeTurn.startedAt || turn.startedAt || null;
      turn.endedAt = record.turnCompletedAtById[record.activeTurn.turnId] || turn.endedAt || null;
      turn.status = record.activeTurn.status || turn.status || 'completed';
      mergeTurnMessage(turn, record.activeTurn.userMessage ? Object.assign({}, record.activeTurn.userMessage) : null);
      if (record.activeTurn.assistantMessage) {
        mergeTurnMessage(turn, Object.assign({}, record.activeTurn.assistantMessage));
      } else if (record.activeTurn.status === 'running' || record.activeTurn.status === 'queued') {
        turn.assistantMessage = null;
      }
    }

    function rebuildTurnHistory(record) {
      if (!record) return;
      reconcileRuntimeSnapshotTurnReferences(record);
      var baseTurnOrdinal = 0;
      (record.base && Array.isArray(record.base.messages) ? record.base.messages : []).forEach(function (message, index) {
        if (!message) return;
        if (message.role === 'user') {
          baseTurnOrdinal += 1;
        }
        var fallbackOrdinal = baseTurnOrdinal || null;
        var turn = ensureTurnEntry(record, message.turnId || null, message.turnOrdinal || fallbackOrdinal);
        if (!turn) return;
        mergeTurnMessage(turn, message);
        if (message.role === 'tool') {
          syncActivityItemToTurn(record, Object.assign({
            id: message.id || ('legacy-tool-' + index),
            toolCallId: message.id || null,
            displayMode: resolveActivityDisplayMode(null, resolveActivityContentType(message), !!(message.reviewRequired || (message.resultMeta && message.resultMeta.reviewRequired)), message.inlineDisplay),
            inlineDisplay: !!message.inlineDisplay,
            resultContentType: resolveActivityContentType(message),
            resultData: cloneValue(message.resultData || null),
            resultMeta: cloneValue(message.resultMeta || null),
            toolArgs: cloneValue(message.toolArgs || null),
            reviewRequired: !!(message.reviewRequired || (message.resultMeta && message.resultMeta.reviewRequired)),
            title: message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'tool'),
            status: message.status || 'completed',
            detail: message.detail || '',
            createdAt: message.createdAt || null,
            updatedAt: message.createdAt || null,
            turnId: turn.turnId || message.turnId || null,
            turnOrdinal: turn.turnOrdinal || message.turnOrdinal || null,
            sessionId: message.sessionId || null,
            toolName: message.toolName || null,
          }, {}));
        }
      });

      buildSnapshotActivityItems(record).forEach(function (item) {
        syncActivityItemToTurn(record, item);
      });

      var snapshotTurnOrdinal = 0;
      extractSnapshotMessages(record).forEach(function (message) {
        if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;
        if (message.role === 'user') {
          snapshotTurnOrdinal += 1;
        }
        var fallbackOrdinal = snapshotTurnOrdinal || null;
        var turn = ensureTurnEntry(record, message.turnId || null, message.turnOrdinal || fallbackOrdinal);
        if (!turn) return;
        mergeTurnMessage(turn, message);
      });

      record.turnOrder = (record.turnOrder || []).filter(function (key) {
        return !!(record.turnHistoryById && record.turnHistoryById[key] && record.turnHistoryById[key].userMessage);
      }).sort(function (leftKey, rightKey) {
        var left = record.turnHistoryById[leftKey];
        var right = record.turnHistoryById[rightKey];
        if (!left || !right) return 0;
        if (left.turnOrdinal && right.turnOrdinal && left.turnOrdinal !== right.turnOrdinal) {
          return left.turnOrdinal - right.turnOrdinal;
        }
        var leftTime = api.parseActivityTimestamp((left.userMessage && left.userMessage.createdAt) || left.startedAt);
        var rightTime = api.parseActivityTimestamp((right.userMessage && right.userMessage.createdAt) || right.startedAt);
        if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return String(left.key || '').localeCompare(String(right.key || ''));
      });
    }

    function reconcileActiveTurn(record) {
      if (!record || !record.activeTurn || !record.runtimeSnapshot) return;
      var snapshotMessages = extractSnapshotMessages(record);
      var hasUser = record.activeTurn.userMessage ? containsMessage(snapshotMessages, record.activeTurn.userMessage) : true;
      var hasAssistant = record.activeTurn.assistantMessage && record.activeTurn.assistantMessage.content
        ? containsMessage(snapshotMessages, record.activeTurn.assistantMessage)
        : true;

      if (record.activeTurn.status === 'finalized' && hasUser && hasAssistant) {
        record.lastTurnId = record.activeTurn.turnId || record.lastTurnId || null;
        record.lastTurnOrdinal = record.activeTurn.turnOrdinal || record.lastTurnOrdinal || 0;
        record.activeTurn = null;
      }
    }

    function getThreadContext(threadId) {
      var summary = api.getThread(threadId);
      var detail = summary ? api.ensureThreadDetailRecord(threadId) : null;
      var project = summary && summary.projectId ? api.getProject(summary.projectId) : null;
      var workspace = project && project.workspaceId ? state.workspacesById[project.workspaceId] : null;
      var organization = summary && summary.organizationId
        ? state.organizations.find(function (candidate) { return candidate.id === summary.organizationId; }) || null
        : api.getSelectedOrganization();
      var threadUi = api.getThreadUi(threadId);
      var projection = detail ? buildThreadProjection(detail) : null;
      var threadRecord = detail
        ? Object.assign({}, detail, {
          messages: projection.displayMessages,
          displayMessages: projection.displayMessages,
          activityItems: projection.activityItems,
          runs: projection.runs,
          artifacts: projection.artifacts,
          artifactDrawer: projection.artifactDrawer,
          preview: projection.preview,
          messageActivityAt: projection.messageActivityAt,
          lastActivityAt: projection.lastActivityAt,
          ui: threadUi ? Object.assign({}, threadUi) : null,
        })
        : summary;

      return {
        organization: api.clone(organization),
        workspace: api.clone(workspace),
        project: api.clone(project),
        thread: api.clone(threadRecord),
        loading: !!state.loadingThreadIds[threadId],
        pending: !!state.pendingThreadIds[threadId],
        error: state.threadErrors[threadId] || null,
        streamStatus: detail && detail.connection ? detail.connection.runtimeStatus || null : (state.streamStatuses[threadId] || null),
        relayStatus: state.relayStates[threadId] ? state.relayStates[threadId].status || null : null,
      };
    }

    api.copyMessages = copyMessages;
    api.cloneValue = cloneValue;
    api.createThreadDetailRecord = createThreadDetailRecord;
    api.ensureThreadDetailRecord = ensureThreadDetailRecord;
    api.messageMatchesCandidate = messageMatchesCandidate;
    api.containsMessage = containsMessage;
    api.extractSnapshotMessages = extractSnapshotMessages;
    api.countUserMessages = countUserMessages;
    api.getLatestTurnReference = getLatestTurnReference;
    api.resolveNextTurnOrdinal = resolveNextTurnOrdinal;
    api.ensureTurnEntry = ensureTurnEntry;
    api.resolveActivityContentType = resolveActivityContentType;
    api.getStoredActivityItem = getStoredActivityItem;
    api.resolveActivityDisplayMode = resolveActivityDisplayMode;
    api.getCanonicalActivityDisplayMode = getCanonicalActivityDisplayMode;
    api.syncActivityItemToTurn = syncActivityItemToTurn;
    api.rebuildTurnHistory = rebuildTurnHistory;
    api.reconcileRuntimeSnapshotTurnReferences = reconcileRuntimeSnapshotTurnReferences;
    api.isCompletedActivityStatus = isCompletedActivityStatus;
    api.isRendererBackedActivityItem = isRendererBackedActivityItem;
    api.buildArtifactSessionKey = buildArtifactSessionKey;
    api.buildActivityArtifactConfig = buildActivityArtifactConfig;
    api.normalizeArtifactItems = normalizeArtifactItems;
    api.syncThreadArtifactDrawer = syncThreadArtifactDrawer;
    api.attachActivityResultDrawer = attachActivityResultDrawer;
    api.normalizeToolPartStatus = normalizeToolPartStatus;
    api.buildToolPartDetail = buildToolPartDetail;
    api.buildSnapshotActivityItems = buildSnapshotActivityItems;
    api.upsertActivityItem = upsertActivityItem;
    api.reconcileLiveActivity = reconcileLiveActivity;
    api.buildActivityItems = buildActivityItems;
    api.buildDisplayMessages = buildDisplayMessages;
    api.buildRunGroups = buildRunGroups;
    api.buildThreadProjection = buildThreadProjection;
    api.syncThreadSummaryFromRecord = syncThreadSummaryFromRecord;
    api.rememberTurnHistory = rememberTurnHistory;
    api.reconcileActiveTurn = reconcileActiveTurn;
    api.getThreadContext = getThreadContext;

    return api;
  };
})();
