(function () {
  'use strict';

  window.__createTribexAiStateProjection = function __createTribexAiStateProjection(context, api) {
    var state = context.state;

    function copyMessages(messages) {
      return Array.isArray(messages)
        ? messages.filter(Boolean).map(function (message) {
          return Object.assign({}, message);
        })
        : [];
    }

    function createThreadDetailRecord(threadId) {
      var summary = api.getThread(threadId) || {};
      return {
        id: threadId,
        title: summary.title || 'Thread',
        projectId: summary.projectId || null,
        workspaceId: summary.workspaceId || null,
        organizationId: summary.organizationId || null,
        hydrateState: summary.hydrateState || summary.status || null,
        preview: summary.preview || '',
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
          lastActivityAt: summary.lastActivityAt || null,
          messages: [],
        },
        runtimeSnapshot: null,
        activeTurn: null,
        lastTurnId: null,
        lastTurnOrdinal: 0,
        turnCompletedAtById: {},
        turnHistoryById: {},
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
      return Math.max(snapshotCount, lastOrdinal) + 1;
    }

    function resolveActivityContentType(item) {
      if (!item) return null;
      return item.resultContentType || item.contentType || item.toolName || null;
    }

    function isCompletedActivityStatus(status) {
      var value = String(status || '').toLowerCase();
      return value === 'completed' || value === 'success' || value === 'done' || value === 'stored';
    }

    function isRendererBackedActivityItem(item) {
      var contentType = resolveActivityContentType(item);
      return !!(
        item &&
        !item.inlineDisplay &&
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
        !!item.inlineDisplay &&
        isCompletedActivityStatus(item.status) &&
        item.resultData &&
        contentType &&
        window.__renderers &&
        typeof window.__renderers[contentType] === 'function'
      );
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
          return isRendererBackedActivityItem(item);
        })
        .forEach(registerActivityItem);

      extractSnapshotMessages(record)
        .filter(function (message) {
          return message && message.role === 'tool' && isRendererBackedActivityItem(message) && !!message.artifactKey;
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
      if (!record || !item || item.inlineDisplay || !isRendererBackedActivityItem(item)) return item;
      var config = buildActivityArtifactConfig(record.id, item);
      record.artifactDrawer = record.artifactDrawer || {
        drawerId: config.drawerId,
        selectedArtifactKey: null,
      };
      record.artifactDrawer.drawerId = config.drawerId;
      record.artifactDrawer.selectedArtifactKey = config.artifactKey;
      return Object.assign({}, item, {
        artifactDrawerId: config.drawerId,
        artifactKey: config.artifactKey,
        resultContentType: config.contentType,
        resultTitle: config.title,
      });
    }

    function normalizeToolPartStatus(part) {
      if (!part) return 'running';
      if (part.state === 'output-error' || part.state === 'output-denied') return 'failed';
      if (part.state === 'approval-requested') return 'needs-approval';
      if (part.state === 'output-available') return part.preliminary ? 'running' : 'completed';
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
          var item = {
            id: part.toolCallId,
            toolCallId: part.toolCallId,
            toolName: part.toolName || (existing && existing.toolName) || null,
            title: part.title || (existing && existing.title) || window.__tribexAiUtils.titleCase(part.toolName || 'tool'),
            status: normalizeToolPartStatus(part),
            detail: buildToolPartDetail(part) || (existing && existing.detail) || '',
            createdAt: (existing && existing.createdAt) || message.createdAt || null,
            updatedAt: message.createdAt || (existing && existing.updatedAt) || null,
            turnId: part.turnId || message.turnId || (existing && existing.turnId) || null,
            turnOrdinal: part.turnOrdinal || message.turnOrdinal || (existing && existing.turnOrdinal) || (turnOrdinal || null),
            sortIndex: messageIndex * 100 + partIndex,
          };

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
          turnId: existing.turnId || item.turnId,
          turnOrdinal: existing.turnOrdinal || item.turnOrdinal,
        });
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

        var hasRunning = workItems.some(function (item) {
          return item.status === 'running' || item.status === 'needs-approval';
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
        var turnCompletedAt = record && record.turnCompletedAtById && run.turnId
          ? record.turnCompletedAtById[run.turnId] || null
          : null;
        var endedAt = turnCompletedAt
          || (assistantMessage && !assistantMessage.isStreaming ? assistantMessage.createdAt || null : null)
          || (workItems.length
            ? (workItems[workItems.length - 1].updatedAt || workItems[workItems.length - 1].createdAt || null)
            : null);
        var workSession = workItems.length
          ? {
            id: run.turnId || ('work-session-' + index),
            turnId: run.turnId || null,
            turnOrdinal: run.turnOrdinal || null,
            status: hasRunning || (assistantMessage && assistantMessage.isStreaming) ? 'running' : 'completed',
            startedAt: startedAt,
            endedAt: hasRunning || (assistantMessage && assistantMessage.isStreaming) ? null : endedAt,
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
      var latestMessage = displayMessages.length ? displayMessages[displayMessages.length - 1] : null;
      var previewSource = null;
      var lastActivityAt = latestMessage && latestMessage.createdAt
        ? latestMessage.createdAt
        : (record.runtimeSnapshot && record.runtimeSnapshot.lastActivityAt) || recordBase.lastActivityAt || record.lastActivityAt || null;

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
        lastActivityAt: lastActivityAt,
      };
    }

    function syncThreadSummaryFromRecord(record) {
      if (!record) return;
      var projection = buildThreadProjection(record);
      record.preview = projection.preview;
      record.lastActivityAt = projection.lastActivityAt;
      api.mergeThreadSummary({
        id: record.id,
        title: record.title,
        projectId: record.projectId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        preview: projection.preview,
        hydrateState: record.hydrateState,
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
      record.turnHistoryById[record.activeTurn.turnId] = {
        turnId: record.activeTurn.turnId || null,
        turnOrdinal: record.activeTurn.turnOrdinal || null,
        userMessage: record.activeTurn.userMessage ? Object.assign({}, record.activeTurn.userMessage) : null,
        assistantMessage: record.activeTurn.assistantMessage ? Object.assign({}, record.activeTurn.assistantMessage) : null,
        startedAt: record.activeTurn.startedAt || null,
        endedAt: record.turnCompletedAtById[record.activeTurn.turnId] || null,
      };
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
    api.createThreadDetailRecord = createThreadDetailRecord;
    api.ensureThreadDetailRecord = ensureThreadDetailRecord;
    api.messageMatchesCandidate = messageMatchesCandidate;
    api.containsMessage = containsMessage;
    api.extractSnapshotMessages = extractSnapshotMessages;
    api.countUserMessages = countUserMessages;
    api.getLatestTurnReference = getLatestTurnReference;
    api.resolveNextTurnOrdinal = resolveNextTurnOrdinal;
    api.resolveActivityContentType = resolveActivityContentType;
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
