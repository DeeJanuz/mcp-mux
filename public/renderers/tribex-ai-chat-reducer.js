// @ts-check
/* Hosted AI workspace chat lifecycle reducer and selectors */

(function () {
  'use strict';

  var LIFECYCLE = Object.freeze({
    IDLE: 'idle',
    SENDING: 'sending',
    QUEUED: 'queued',
    RUNNING: 'running',
    WAITING_ON_REVIEW: 'waiting_on_review',
    WAITING_ON_USER: 'waiting_on_user',
    RESUMING: 'resuming',
    RECOVERING: 'recovering',
    FAILED: 'failed',
    COMPLETE: 'complete',
  });

  var BUSY_STATES = [
    LIFECYCLE.SENDING,
    LIFECYCLE.QUEUED,
    LIFECYCLE.RUNNING,
    LIFECYCLE.RESUMING,
    LIFECYCLE.RECOVERING,
  ];

  var STILL_WORKING_AFTER_MS = 15000;
  var RECOVERING_AFTER_MS = 45000;

  function nowIso() {
    return new Date().toISOString();
  }

  function parseTime(value) {
    if (!value) return null;
    var parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function clone(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return value;
    }
  }

  function titleCase(value) {
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.titleCase === 'function') {
      return window.__tribexAiUtils.titleCase(value);
    }
    return String(value || '')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (match) { return match.toUpperCase(); });
  }

  function formatRelative(value) {
    if (!value) return '';
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.formatRelativeTime === 'function') {
      return window.__tribexAiUtils.formatRelativeTime(value);
    }
    return value;
  }

  function asArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function pickContent(message) {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (typeof message.text === 'string') return message.text;
    if (Array.isArray(message.parts)) {
      return message.parts.map(function (part) {
        return part && part.type === 'text' && typeof part.text === 'string' ? part.text : '';
      }).join('');
    }
    return '';
  }

  function normalizeStatus(value) {
    return String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  }

  function isReviewLike(item) {
    if (!item) return false;
    var status = normalizeStatus(item.status);
    var toolName = normalizeStatus(item.toolName || item.tool_name || item.kind || item.type);
    return !!(
      item.reviewRequired ||
      (item.resultMeta && item.resultMeta.reviewRequired) ||
      status === 'needs_approval' ||
      status === 'review_needed' ||
      toolName.indexOf('review') >= 0 ||
      toolName.indexOf('approval') >= 0
    );
  }

  function isSubagentToolEvent(item) {
    if (!item) return false;
    var key = normalizeStatus(item.toolName || item.tool_name || item.kind || item.type || item.title || '');
    return (
      key === 'subagent_dispatch' ||
      key === 'subagent_listen' ||
      key === 'sub_agent_dispatch' ||
      key === 'sub_agent_listen' ||
      key === 'agent_listen' ||
      key === 'delegated_work_dispatch' ||
      key === 'delegated_work_listen'
    );
  }

  function isDelegatedPause(activePause) {
    if (!activePause) return false;
    var values = [
      activePause.reasonKind,
      activePause.reason_kind,
      activePause.kind,
      activePause.type,
      activePause.category,
    ];
    var metadata = activePause.metadata && typeof activePause.metadata === 'object'
      ? activePause.metadata
      : {};
    values.push(
      metadata.reasonKind,
      metadata.reason_kind,
      metadata.pauseKind,
      metadata.pause_kind,
      metadata.pauseType,
      metadata.pause_type,
      metadata.mode,
      metadata.waitingOn,
      metadata.waiting_on,
      metadata.source
    );
    return values.some(function (value) {
      var normalized = String(value || '').toLowerCase().replace(/[\s_]+/g, '-');
      return (
        normalized === 'delegated-work' ||
        normalized === 'delegated' ||
        normalized === 'sub-agent' ||
        normalized === 'subagent' ||
        normalized === 'listen' ||
        normalized === 'agent-listen' ||
        normalized === 'sub-agent-listen' ||
        normalized.indexOf('sub-agent') >= 0 ||
        normalized.indexOf('subagent') >= 0
      );
    });
  }

  function isTerminalPauseTaskStatus(value) {
    var status = normalizeStatus(value);
    return (
      status === 'completed' ||
      status === 'complete' ||
      status === 'done' ||
      status === 'success' ||
      status === 'succeeded' ||
      status === 'failed' ||
      status === 'error' ||
      status === 'canceled' ||
      status === 'cancelled' ||
      status === 'skipped'
    );
  }

  function delegatedPauseTasksComplete(activePause) {
    if (!isDelegatedPause(activePause)) return false;
    var tasks = asArray(activePause.tasks);
    return tasks.length > 0 && tasks.every(function (task) {
      return isTerminalPauseTaskStatus(task && task.status);
    });
  }

  function isRendererContentType(value) {
    var normalized = String(value || '').trim();
    return normalized === 'rich_content' || normalized === 'structured_data' || normalized === 'universal_graph';
  }

  function hasChatOutputMetadata(item) {
    if (!item || typeof item !== 'object') return false;
    var meta = item.resultMeta || item.meta || {};
    return !!(
      meta &&
      typeof meta === 'object' &&
      !Array.isArray(meta) &&
      (
        meta.chatOutputSource ||
        meta.chatOutputId ||
        meta.chatOutputKey ||
        meta.reviewSessionId
      )
    );
  }

  function isChatOutputLike(item) {
    if (isSubagentToolEvent(item)) return false;
    if (!item) return false;
    if (isRendererContentType(item.resultContentType || item.contentType || item.toolName)) return true;
    if (item.chatOutputKey && hasChatOutputMetadata(item)) return true;
    return !!(
      item.chatOutput &&
      typeof item.chatOutput === 'object' &&
      !Array.isArray(item.chatOutput) &&
      isRendererContentType(item.chatOutput.contentType || item.chatOutput.content_type)
    );
  }

  function isSubagentLike(item) {
    if (!item) return false;
    if (isSubagentToolEvent(item)) return true;
    var values = [
      item.toolName,
      item.title,
      item.kind,
      item.type,
      item.detail,
    ].map(function (value) {
      return String(value || '').toLowerCase();
    }).join(' ');
    return values.indexOf('subagent') >= 0 ||
      values.indexOf('sub-agent') >= 0 ||
      values.indexOf('delegate') >= 0 ||
      values.indexOf('child thread') >= 0;
  }

  function normalizeActivityItem(item, index) {
    if (!item) return null;
    var explicitOrder = typeof item.order === 'number' && Number.isFinite(item.order)
      ? item.order
      : typeof item.sequence === 'number' && Number.isFinite(item.sequence)
        ? item.sequence
        : typeof item.sortIndex === 'number' && Number.isFinite(item.sortIndex)
          ? item.sortIndex
          : index;
    var status = normalizeStatus(item.status || 'completed');
    var kind = isReviewLike(item)
      ? 'review'
      : isSubagentLike(item)
        ? 'subagent'
        : isChatOutputLike(item)
          ? 'chat_output'
          : 'tool';
    var contentType = item.resultContentType || item.contentType || item.toolName || null;
    return {
      id: item.id || item.toolCallId || item.chatOutputKey || ('activity-' + index),
      kind: kind,
      status: status,
      title: item.title || item.summary || titleCase(item.toolName || kind),
      detail: item.detail || item.summary || '',
      toolName: item.toolName || null,
      order: explicitOrder,
      sortIndex: typeof item.sortIndex === 'number' && Number.isFinite(item.sortIndex) ? item.sortIndex : explicitOrder,
      createdAt: item.createdAt || item.startedAt || null,
      updatedAt: item.updatedAt || item.completedAt || item.createdAt || null,
      completedAt: item.completedAt || null,
      chatOutputKey: item.chatOutputKey || null,
      contentType: contentType,
      resultData: clone(item.resultData || null),
      resultMeta: clone(item.resultMeta || null),
      toolArgs: clone(item.toolArgs || null),
      reviewRequired: !!(item.reviewRequired || (item.resultMeta && item.resultMeta.reviewRequired)),
      childThreadId: item.childThreadId || item.child_thread_id || null,
      raw: clone(item),
    };
  }

  function activityTime(item) {
    var candidates = item ? [item.createdAt, item.updatedAt, item.completedAt] : [];
    for (var i = 0; i < candidates.length; i += 1) {
      var parsed = parseTime(candidates[i]);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  function activityOrder(item) {
    return item && typeof item.order === 'number' && Number.isFinite(item.order)
      ? item.order
      : Number.MAX_SAFE_INTEGER;
  }

  function compareActivityItems(a, b) {
    var aTime = activityTime(a);
    var bTime = activityTime(b);
    if (aTime !== null && bTime !== null && aTime !== bTime) return aTime - bTime;
    if (aTime !== null && bTime === null) return -1;
    if (aTime === null && bTime !== null) return 1;
    return activityOrder(a) - activityOrder(b);
  }

  function compareActivityGroups(a, b) {
    var firstA = a && a.items ? a.items[0] : null;
    var firstB = b && b.items ? b.items[0] : null;
    return compareActivityItems(firstA, firstB);
  }

  function groupActivity(items) {
    var groupsByKind = {
      review: [],
      subagent: [],
      chat_output: [],
      tool: [],
    };
    asArray(items).forEach(function (item, index) {
      var normalized = normalizeActivityItem(item, index);
      if (!normalized) return;
      groupsByKind[normalized.kind].push(normalized);
    });
    var groups = [
      { id: 'review', title: 'Reviews', kind: 'review', items: groupsByKind.review },
      { id: 'subagent', title: 'Delegated Work', kind: 'subagent', items: groupsByKind.subagent },
      { id: 'chat_output', title: 'Chat outputs', kind: 'chat_output', items: groupsByKind.chat_output },
      { id: 'tool', title: 'Work Activity', kind: 'tool', items: groupsByKind.tool },
    ].filter(function (group) { return group.items.length > 0; });
    groups.forEach(function (group) {
      group.items.sort(compareActivityItems);
    });
    groups.sort(compareActivityGroups);
    return groups;
  }

  function settleStatusForLifecycle(status, lifecycle) {
    var normalized = normalizeStatus(status);
    if (lifecycle !== LIFECYCLE.COMPLETE) return normalized;
    if (
      normalized === 'running' ||
      normalized === 'pending' ||
      normalized === 'queued' ||
      normalized === 'accepted' ||
      normalized === 'in_progress'
    ) {
      return 'completed';
    }
    return normalized;
  }

  function settleActivityGroupsForSession(session) {
    if (!session || !Array.isArray(session.activityGroups)) return session;
    var lifecycle = normalizeStatus(session.lifecycle);
    if (lifecycle !== LIFECYCLE.COMPLETE) return session;
    return Object.assign({}, session, {
      activityGroups: session.activityGroups.map(function (group) {
        return Object.assign({}, group, {
          items: asArray(group.items).map(function (item) {
            return Object.assign({}, item, {
              status: settleStatusForLifecycle(item.status, lifecycle),
            });
          }),
        });
      }),
    });
  }

  function settleTimelineEventsForLifecycle(events, lifecycle) {
    if (lifecycle !== LIFECYCLE.COMPLETE) return events;
    return asArray(events).map(function (event) {
      if (!event) return event;
      var next = event;
      if (event.kind === 'activity' || event.kind === 'status') {
        var status = settleStatusForLifecycle(event.status, lifecycle);
        if (status !== event.status) {
          next = Object.assign({}, next, { status: status });
        }
      }
      if (next.session && Array.isArray(next.session.activityGroups)) {
        var settledSession = settleActivityGroupsForSession(Object.assign({}, next.session, {
          lifecycle: next.session.lifecycle || lifecycle,
        }));
        if (settledSession !== next.session) {
          next = Object.assign({}, next, { session: settledSession });
        }
      }
      return next;
    });
  }

  function markQueuedContextSessions(sessions, lifecycle) {
    return sessions.map(function (session, index) {
      var userStatus = String((session && session.user && (session.user.status || session.user.lifecycle || session.user.state)) || '').toLowerCase();
      var userIsQueuedContext = !!(session && session.user && (session.user.queued || userStatus === 'queued'));
      var answerContent = session && session.answer && session.answer.content ? String(session.answer.content) : '';
      var duplicatesEarlierAnswer = !!(answerContent && sessions.slice(0, index).some(function (candidate) {
        return candidate && candidate.answer && candidate.answer.content === answerContent;
      }));
      if (
        index > 0 &&
        session &&
        session.user &&
        (
          userIsQueuedContext ||
          duplicatesEarlierAnswer ||
          (session.lifecycle === LIFECYCLE.COMPLETE && (!session.answer || !session.answer.content))
        )
      ) {
        return Object.assign({}, session, {
          lifecycle: LIFECYCLE.QUEUED,
          answer: null,
          user: Object.assign({}, session.user, {
            pending: true,
            queued: true,
          }),
        });
      }
      return session;
    });
  }

  function workflowItemsFromThread(thread) {
    var projection = thread && thread.workflowProjection ? thread.workflowProjection : null;
    var timeline = thread && (thread.workflowTimeline || (projection && projection.timeline));
    var steps = asArray(timeline && timeline.steps);
    var items = [];
    steps.forEach(function (step, index) {
      if (!step) return;
      var childRefs = asArray(step.childRunRefs || step.child_run_refs);
      var kind = childRefs.length || normalizeStatus(step.kind) === 'delegate'
        ? 'subagent'
        : isReviewLike(step)
          ? 'review'
          : 'tool';
      var detail = step.detail || step.summary || '';
      if (!detail && childRefs.length) {
        detail = childRefs.length === 1
          ? 'Waiting on delegated work.'
          : ('Waiting on ' + childRefs.length + ' delegated runs.');
      }
      items.push({
        id: step.id || ('workflow-step-' + index),
        kind: kind,
        type: kind,
        status: step.status || (projection && projection.status) || 'running',
        title: step.title || step.name || titleCase(kind),
        detail: detail,
        childThreadId: step.childThreadId || step.child_thread_id || null,
        childRunRefs: childRefs,
        createdAt: step.startedAt || step.createdAt || (projection && projection.startedAt) || null,
        updatedAt: step.updatedAt || step.completedAt || (projection && projection.updatedAt) || null,
      });
    });
    asArray(timeline && timeline.approvals || projection && projection.approvals).forEach(function (approval, index) {
      items.push({
        id: approval.id || ('workflow-approval-' + index),
        kind: 'review',
        type: 'review',
        status: approval.status || 'pending',
        title: approval.title || approval.name || 'Preparing review',
        detail: approval.detail || approval.summary || 'Preparing review payload.',
        createdAt: approval.createdAt || approval.startedAt || (projection && projection.updatedAt) || null,
        updatedAt: approval.updatedAt || (projection && projection.updatedAt) || null,
        reviewRequired: true,
      });
    });
    return items;
  }

  function normalizeChatOutput(item, index) {
    if (!item) return null;
    if (!isChatOutputLike(item)) return null;
    var contentType = item.contentType || item.resultContentType || item.toolName || null;
    var chatOutputKey = item.chatOutputKey || item.id || ('chat-output-' + index);
    if (!chatOutputKey && !item.resultData) return null;
    return {
      id: chatOutputKey,
      chatOutputKey: chatOutputKey,
      title: item.title || item.summary || titleCase(contentType || 'Chat output'),
      detail: item.detail || '',
      contentType: contentType,
      resultData: clone(item.resultData || item.data || null),
      resultMeta: clone(item.resultMeta || item.meta || null),
      toolArgs: clone(item.toolArgs || null),
      reviewRequired: !!(item.reviewRequired || (item.resultMeta && item.resultMeta.reviewRequired)),
      reviewSessionId: item.reviewSessionId || item.sessionId || (item.resultMeta && item.resultMeta.reviewSessionId) || null,
      createdAt: item.createdAt || item.updatedAt || null,
      raw: clone(item),
    };
  }

  function collectChatOutputs(thread) {
    var chatOutputs = [];
    asArray(thread && thread.chatOutputs).forEach(function (item, index) {
      var chatOutput = normalizeChatOutput(item, index);
      if (chatOutput) chatOutputs.push(chatOutput);
    });
    asArray(thread && thread.activityItems).forEach(function (item, index) {
      if (!isChatOutputLike(item)) return;
      var chatOutput = normalizeChatOutput(item, chatOutputs.length + index);
      if (chatOutput && !chatOutputs.some(function (candidate) { return candidate.chatOutputKey === chatOutput.chatOutputKey; })) {
        chatOutputs.push(chatOutput);
      }
    });
    asArray(thread && thread.runs).forEach(function (run) {
      var items = run && run.workSession ? run.workSession.items : [];
      asArray(items).forEach(function (item, index) {
        if (!isChatOutputLike(item)) return;
        var chatOutput = normalizeChatOutput(item, chatOutputs.length + index);
        if (chatOutput && !chatOutputs.some(function (candidate) { return candidate.chatOutputKey === chatOutput.chatOutputKey; })) {
          chatOutputs.push(chatOutput);
        }
      });
    });
    return chatOutputs;
  }

  function normalizeTranscriptStatus(value) {
    var status = normalizeStatus(value);
    if (
      status === 'pending' ||
      status === 'running' ||
      status === 'completed' ||
      status === 'failed' ||
      status === 'waiting_on_user'
    ) {
      return status;
    }
    if (status === 'complete' || status === 'done' || status === 'succeeded') return 'completed';
    if (status === 'error') return 'failed';
    if (status === 'needs_approval' || status === 'review_needed' || status === 'blocked') return 'waiting_on_user';
    return status || null;
  }

  function timelineEventTime(event) {
    var candidates = event ? [event.createdAt, event.updatedAt] : [];
    for (var i = 0; i < candidates.length; i += 1) {
      var parsed = parseTime(candidates[i]);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  function compareTimelineEvents(a, b) {
    var aTime = timelineEventTime(a);
    var bTime = timelineEventTime(b);
    if (aTime !== null && bTime !== null && aTime !== bTime) return aTime - bTime;
    if (aTime !== null && bTime === null) return -1;
    if (aTime === null && bTime !== null) return 1;
    var aOrder = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : 0;
    var bOrder = typeof b.order === 'number' && Number.isFinite(b.order) ? b.order : 0;
    return aOrder - bOrder;
  }

  function normalizeUiTranscriptEvent(event, index) {
    if (!event || typeof event !== 'object') return null;
    var kind = normalizeStatus(event.kind || 'status');
    if (kind === 'queued_context') kind = 'queued_context';
    var allowed = {
      request: true,
      assistant: true,
      activity: true,
      review: true,
      pause: true,
      artifact: true,
      decision: true,
      queued_context: true,
      status: true,
    };
    if (!allowed[kind]) kind = 'status';
    return {
      id: event.id || ('ui-transcript-' + index),
      kind: kind,
      turnId: event.turnId || null,
      operationId: event.operationId || null,
      status: normalizeTranscriptStatus(event.status),
      title: event.title || null,
      detail: event.detail || null,
      content: event.content || null,
      createdAt: event.createdAt || event.updatedAt || null,
      updatedAt: event.updatedAt || null,
      renderer: event.renderer || null,
      rendererPayload: clone(event.rendererPayload || null),
      activity: clone(event.activity || null),
      action: clone(event.action || null),
      order: index,
      source: 'uiTranscript',
      raw: clone(event),
    };
  }

  function buildTimelineEventsFromUiTranscript(thread) {
    var transcript = thread && thread.uiTranscript;
    var events = asArray(transcript && transcript.events).map(normalizeUiTranscriptEvent).filter(Boolean);
    if (!events.length) return null;
    events.sort(compareTimelineEvents);
    return events;
  }

  function timelineEventKeys(event) {
    var keys = [];
    if (!event) return keys;
    if (event.id) {
      keys.push('id:' + event.id);
      if (event.kind === 'artifact') keys.push('artifact:' + String(event.id).replace(/^artifact:/, ''));
    }
    if (event.operationId && event.kind) keys.push('operation:' + event.kind + ':' + event.operationId);
    if (event.turnId && event.kind) keys.push('turn:' + event.kind + ':' + event.turnId);
    if (event.action && event.action.inputId) keys.push('input:' + event.action.inputId);
    if (event.action && event.action.pauseId && event.kind) {
      keys.push('pause:' + event.kind + ':' + event.action.pauseId);
    }
    if (event.kind === 'artifact' && event.chatOutput) {
      var chatOutputKey = event.chatOutput.chatOutputKey || event.chatOutput.id || null;
      if (chatOutputKey) keys.push('artifact:' + chatOutputKey);
    }
    if ((event.kind === 'request' || event.kind === 'assistant') && event.content) {
      keys.push('message:' + event.kind + ':' + (event.createdAt || '') + ':' + event.content);
    }
    if (event.kind === 'artifact') {
      keys.push('artifact-signature:' + [
        event.title || '',
        event.renderer || '',
        event.createdAt || '',
      ].join('|'));
    }
    return keys;
  }

  function rememberTimelineEvent(seen, event) {
    timelineEventKeys(event).forEach(function (key) {
      seen[key] = true;
    });
  }

  function hasTimelineEvent(seen, event) {
    return timelineEventKeys(event).some(function (key) { return !!seen[key]; });
  }

  function shouldMergeLegacyTimelineEvent(event) {
    if (!event) return false;
    if (event.session && event.session.active) return true;
    if (event.kind === 'request' || event.kind === 'queued_context') return true;
    return event.kind === 'artifact' || event.kind === 'review' || event.kind === 'pause';
  }

  function mergeTimelineEvents(uiTranscriptEvents, legacyEvents) {
    var canonical = asArray(uiTranscriptEvents);
    if (!canonical.length) return asArray(legacyEvents);
    var seen = {};
    var merged = canonical.slice();
    canonical.forEach(function (event) { rememberTimelineEvent(seen, event); });
    asArray(legacyEvents).forEach(function (event) {
      if (!shouldMergeLegacyTimelineEvent(event) || hasTimelineEvent(seen, event)) return;
      merged.push(event);
      rememberTimelineEvent(seen, event);
    });
    merged.sort(compareTimelineEvents);
    return merged;
  }

  function buildTimelineEventsFromLegacy(thread, sessions, chatOutputs, pendingHumanInputs, activePause, lifecycle) {
    var events = [];
    var order = 0;
    asArray(sessions).forEach(function (session, index) {
      var base = {
        session: session,
        lifecycle: session.lifecycle || lifecycle,
        turnId: session.id || null,
      };
      if (session.user && session.user.content) {
        events.push(Object.assign({}, base, {
          id: 'request:' + (session.user.id || session.id || index),
          kind: session.user.queued || session.lifecycle === LIFECYCLE.QUEUED ? 'queued_context' : 'request',
          title: session.user.queued || session.lifecycle === LIFECYCLE.QUEUED ? 'Queued context' : 'Request',
          content: session.user.content,
          createdAt: session.user.createdAt || session.createdAt || null,
          order: order += 1,
          source: 'legacy',
        }));
      }
      if (asArray(session.activityGroups).length) {
        events.push(Object.assign({}, base, {
          id: 'activity:' + (session.id || index),
          kind: 'activity',
          title: 'Work activity',
          createdAt: session.createdAt || (session.user && session.user.createdAt) || null,
          updatedAt: session.updatedAt || null,
          order: order += 1,
          source: 'legacy',
        }));
      }
      if (session.answer && session.answer.content) {
        events.push(Object.assign({}, base, {
          id: 'assistant:' + (session.answer.id || session.id || index),
          kind: 'assistant',
          title: 'Assistant',
          content: session.answer.content,
          createdAt: session.answer.createdAt || session.updatedAt || null,
          order: order += 1,
          source: 'legacy',
        }));
      } else if (session.lifecycle !== LIFECYCLE.COMPLETE && !(session.user && session.user.queued)) {
        events.push(Object.assign({}, base, {
          id: 'status:' + (session.id || index),
          kind: 'status',
          title: session.lifecycle === LIFECYCLE.QUEUED ? 'Queued follow-up' : null,
          createdAt: session.updatedAt || session.createdAt || null,
          order: order += 1,
          source: 'legacy',
        }));
      }
    });
    asArray(chatOutputs).forEach(function (chatOutput, index) {
      events.push({
        id: 'artifact:' + (chatOutput.chatOutputKey || chatOutput.id || index),
        kind: 'artifact',
        title: chatOutput.title || 'Chat output',
        detail: chatOutput.detail || null,
        createdAt: chatOutput.createdAt || null,
        renderer: chatOutput.contentType || null,
        rendererPayload: {
          data: chatOutput.resultData || chatOutput.data || {},
          meta: chatOutput.resultMeta || chatOutput.meta || {},
          toolArgs: chatOutput.toolArgs || {},
        },
        chatOutput: chatOutput,
        order: order += 1,
        source: 'legacy',
      });
    });
    asArray(pendingHumanInputs).forEach(function (input, index) {
      events.push({
        id: 'review:' + (input.id || index),
        kind: 'review',
        status: 'waiting_on_user',
        title: input.title || 'Review required',
        detail: input.detail || input.description || null,
        createdAt: input.createdAt || input.updatedAt || null,
        renderer: input.renderer || null,
        rendererPayload: clone(input.rendererPayload || null),
        action: {
          inputId: input.id || null,
          pauseId: input.threadPauseId || null,
          submitMode: 'dock',
        },
        input: input,
        order: order += 1,
        source: 'legacy',
      });
    });
    if (activePause) {
      events.push({
        id: 'pause:' + (activePause.id || order),
        kind: 'pause',
        status: normalizeTranscriptStatus(activePause.status) || 'waiting_on_user',
        title: activePause.title || 'Action required',
        detail: activePause.detail || activePause.progressSummary || null,
        createdAt: activePause.createdAt || activePause.updatedAt || null,
        updatedAt: activePause.updatedAt || null,
        action: {
          pauseId: activePause.id || null,
          submitMode: 'dock',
        },
        pause: activePause,
        order: order += 1,
        source: 'legacy',
      });
    }
    events.sort(compareTimelineEvents);
    return events;
  }

  function normalizeMessage(message, index) {
    if (!message) return null;
    var status = normalizeStatus(message.status || message.lifecycle || message.state || '');
    return {
      id: message.id || message.messageId || ('message-' + index),
      role: message.role || 'assistant',
      content: pickContent(message),
      createdAt: message.createdAt || null,
      isStreaming: !!message.isStreaming,
      pending: !!(
        message.pending ||
        message.queued ||
        status === 'queued' ||
        status === 'pending'
      ),
      queued: !!(message.queued || status === 'queued'),
      raw: clone(message),
    };
  }

  function buildSessionsFromMessages(messages) {
    var sessions = [];
    var current = null;
    function assistantTargetSession() {
      if (!current || !(current.user && current.user.queued)) return current;
      for (var i = sessions.length - 2; i >= 0; i -= 1) {
        if (sessions[i] && !(sessions[i].user && sessions[i].user.queued) && !sessions[i].answer) {
          return sessions[i];
        }
      }
      return null;
    }
    asArray(messages).forEach(function (raw, index) {
      var message = normalizeMessage(raw, index);
      if (!message) return;
      if (message.role === 'user') {
        current = {
          id: message.id || ('session-' + sessions.length),
          lifecycle: message.pending ? LIFECYCLE.QUEUED : LIFECYCLE.COMPLETE,
          user: message,
          answer: null,
          activityGroups: [],
          chatOutputs: [],
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        };
        sessions.push(current);
        return;
      }
      if (!current) {
        current = {
          id: 'session-orphan-' + index,
          lifecycle: LIFECYCLE.COMPLETE,
          user: null,
          answer: null,
          activityGroups: [],
          chatOutputs: [],
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        };
        sessions.push(current);
      }
      if (message.role === 'assistant') {
        var target = assistantTargetSession();
        if (!target) {
          target = {
            id: 'session-orphan-' + index,
            lifecycle: LIFECYCLE.COMPLETE,
            user: null,
            answer: null,
            activityGroups: [],
            chatOutputs: [],
            createdAt: message.createdAt,
            updatedAt: message.createdAt,
          };
          sessions.push(target);
        }
        target.answer = message;
        target.lifecycle = message.isStreaming ? LIFECYCLE.RUNNING : LIFECYCLE.COMPLETE;
        target.updatedAt = message.createdAt || target.updatedAt;
        if (target === current) current = target;
      }
    });
    return sessions;
  }

  function buildSessionsFromRuns(runs) {
    return asArray(runs).map(function (run, index) {
      var user = normalizeMessage(run.user || run.userMessage || null, index);
      var answer = normalizeMessage(run.answer || run.assistantMessage || null, index);
      var items = run.workSession && Array.isArray(run.workSession.items) ? run.workSession.items : [];
      var lifecycle = normalizeStatus((run.workSession && run.workSession.status) || run.status);
      if (answer && answer.isStreaming) lifecycle = LIFECYCLE.RUNNING;
      else if (!lifecycle || lifecycle === 'completed' || lifecycle === 'done' || lifecycle === 'finalized') lifecycle = LIFECYCLE.COMPLETE;
      else if (lifecycle === 'failed' || lifecycle === 'error') lifecycle = LIFECYCLE.FAILED;
      else lifecycle = LIFECYCLE.RUNNING;
      return {
        id: run.id || (user && user.id) || ('session-' + index),
        lifecycle: lifecycle,
        user: user,
        answer: answer,
        activityGroups: groupActivity(items),
        chatOutputs: asArray(items).map(normalizeChatOutput).filter(Boolean),
        createdAt: (user && user.createdAt) || run.startedAt || null,
        updatedAt: (answer && answer.createdAt) || (run.workSession && run.workSession.endedAt) || run.updatedAt || null,
        raw: clone(run),
      };
    });
  }

  function statusFromActiveTurn(activeTurn) {
    if (!isRenderableActiveTurn(activeTurn)) return null;
    var status = normalizeStatus(activeTurn.status);
    if (status === 'sending') return LIFECYCLE.SENDING;
    if (status === 'queued' || status === 'accepted') return LIFECYCLE.QUEUED;
    if (status === 'reconnecting' || status === 'unknown_delivery' || status === 'checking_result') return LIFECYCLE.RECOVERING;
    if (status === 'failed') return LIFECYCLE.FAILED;
    if (status === 'finalized' || status === 'completed' || status === 'complete') return LIFECYCLE.COMPLETE;
    return LIFECYCLE.RUNNING;
  }

  function isRenderableActiveTurn(activeTurn) {
    return !!(
      activeTurn &&
      (
        activeTurn.userMessage ||
        activeTurn.assistantMessage ||
        activeTurn.operationId ||
        activeTurn.clientMessageId ||
        activeTurn.contentFingerprint
      )
    );
  }

  function statusFromPause(activePause, pendingHumanInputs) {
    if (asArray(pendingHumanInputs).some(function (input) {
      return normalizeStatus(input.status || 'pending') === 'pending';
    })) {
      return LIFECYCLE.WAITING_ON_REVIEW;
    }
    if (!activePause) return null;
    var status = normalizeStatus(activePause.status);
    if (status === 'resuming') return LIFECYCLE.RESUMING;
    if (status === 'ready') return LIFECYCLE.WAITING_ON_USER;
    if (isDelegatedPause(activePause)) return LIFECYCLE.RUNNING;
    if (status === 'blocked') {
      var kind = normalizeStatus(activePause.reasonKind || activePause.reason_kind || activePause.kind || '');
      return kind.indexOf('human') >= 0 ? LIFECYCLE.WAITING_ON_REVIEW : LIFECYCLE.WAITING_ON_USER;
    }
    return LIFECYCLE.WAITING_ON_USER;
  }

  function statusFromWorkflow(projection) {
    if (!projection) return null;
    var status = normalizeStatus(projection.displayStatus || projection.status);
    if (status === 'degraded') return LIFECYCLE.RECOVERING;
    if (status === 'review_needed' || status === 'needs_approval') return LIFECYCLE.WAITING_ON_REVIEW;
    if (status === 'running' || status === 'pending') return LIFECYCLE.RUNNING;
    if (status === 'failed' || status === 'error') return LIFECYCLE.FAILED;
    if (status === 'completed' || status === 'complete' || status === 'done') return LIFECYCLE.COMPLETE;
    return null;
  }

  function statusFromUiTranscript(thread) {
    var events = buildTimelineEventsFromUiTranscript(thread);
    if (!events || !events.length) return null;
    var latest = null;
    events.forEach(function (event) {
      if (event && event.status) latest = event;
    });
    if (!latest) return LIFECYCLE.COMPLETE;
    if (latest.status === 'failed') return LIFECYCLE.FAILED;
    if (latest.status === 'running') return LIFECYCLE.RUNNING;
    if (latest.status === 'pending') return LIFECYCLE.QUEUED;
    if (latest.status === 'waiting_on_user') {
      return latest.kind === 'review' ? LIFECYCLE.WAITING_ON_REVIEW : LIFECYCLE.WAITING_ON_USER;
    }
    if (latest.status === 'completed') return LIFECYCLE.COMPLETE;
    return null;
  }

  function latestCompletedAssistantTime(thread) {
    var latest = null;
    function remember(value) {
      var parsed = parseTime(value);
      if (parsed !== null && (latest === null || parsed > latest)) latest = parsed;
    }
    asArray(thread && thread.uiTranscript && thread.uiTranscript.events).forEach(function (event) {
      if (!event || normalizeStatus(event.kind) !== 'assistant') return;
      var status = normalizeTranscriptStatus(event.status);
      if (status === 'running' || status === 'pending' || status === 'waiting_on_user' || status === 'failed') return;
      if (!event.content && !event.title) return;
      remember(event.createdAt || event.updatedAt);
    });
    asArray(thread && (thread.displayMessages || thread.messages)).forEach(function (message) {
      if (!message || message.role !== 'assistant' || message.isStreaming) return;
      if (!pickContent(message)) return;
      remember(message.createdAt);
    });
    var activeTurn = thread && thread.activeTurn;
    if (activeTurn && activeTurn.assistantMessage && !activeTurn.assistantMessage.isStreaming && pickContent(activeTurn.assistantMessage)) {
      remember(activeTurn.assistantMessage.createdAt || activeTurn.lastPresenceAt || activeTurn.updatedAt);
    }
    return latest;
  }

  function latestActiveTurnTime(activeTurn) {
    var latest = null;
    [
      activeTurn && activeTurn.startedAt,
      activeTurn && activeTurn.createdAt,
      activeTurn && activeTurn.updatedAt,
      activeTurn && activeTurn.lastPresenceAt,
      activeTurn && activeTurn.userMessage && activeTurn.userMessage.createdAt,
      activeTurn && activeTurn.assistantMessage && activeTurn.assistantMessage.createdAt,
    ].forEach(function (value) {
      var parsed = parseTime(value);
      if (parsed !== null && (latest === null || parsed > latest)) latest = parsed;
    });
    return latest;
  }

  function latestWorkflowProjectionTime(projection) {
    var latest = null;
    [
      projection && projection.startedAt,
      projection && projection.createdAt,
      projection && projection.updatedAt,
      projection && projection.heartbeatAt,
      projection && projection.lastEventAt,
    ].forEach(function (value) {
      var parsed = parseTime(value);
      if (parsed !== null && (latest === null || parsed > latest)) latest = parsed;
    });
    return latest;
  }

  function hasCompletedAssistantForActiveTurn(thread, activeTurn) {
    if (!activeTurn) return false;
    var turnId = activeTurn.turnId || null;
    var operationId = activeTurn.operationId || null;
    if (!turnId && !operationId) return false;
    return asArray(thread && thread.uiTranscript && thread.uiTranscript.events).some(function (event) {
      if (!event || normalizeStatus(event.kind) !== 'assistant') return false;
      var status = normalizeTranscriptStatus(event.status);
      if (status === 'running' || status === 'pending' || status === 'waiting_on_user' || status === 'failed') return false;
      return !!(
        (turnId && event.turnId === turnId) ||
        (operationId && event.operationId === operationId)
      );
    });
  }

  function hasUnsettledActiveWorkAfterCompletion(thread, completedAt) {
    var activeTurn = thread && thread.activeTurn;
    var activeStatus = statusFromActiveTurn(activeTurn);
    var activeTurnSettled = hasCompletedAssistantForActiveTurn(thread, activeTurn);
    if (activeStatus && activeStatus !== LIFECYCLE.COMPLETE && !activeTurnSettled) {
      var activeAt = latestActiveTurnTime(activeTurn);
      if (activeAt === null || activeAt > completedAt) return true;
    }
    var workflowStatus = statusFromWorkflow(thread && thread.workflowProjection);
    if (workflowStatus && workflowStatus !== LIFECYCLE.COMPLETE) {
      if (
        activeTurnSettled &&
        activeTurn &&
        thread.workflowProjection &&
        activeTurn.operationId &&
        thread.workflowProjection.operationId === activeTurn.operationId
      ) {
        return false;
      }
      var workflowAt = latestWorkflowProjectionTime(thread.workflowProjection);
      if (workflowAt === null || workflowAt > completedAt) return true;
    }
    return false;
  }

  function latestUserRequestTime(thread) {
    var latest = null;
    function remember(value) {
      var parsed = parseTime(value);
      if (parsed !== null && (latest === null || parsed > latest)) latest = parsed;
    }
    asArray(thread && thread.uiTranscript && thread.uiTranscript.events).forEach(function (event) {
      if (!event) return;
      var kind = normalizeStatus(event.kind);
      if (kind !== 'request' && kind !== 'queued_context') return;
      remember(event.createdAt || event.updatedAt);
    });
    asArray(thread && (thread.displayMessages || thread.messages)).forEach(function (message) {
      if (!message || message.role !== 'user') return;
      remember(message.createdAt);
    });
    var activeTurn = thread && thread.activeTurn;
    if (activeTurn && activeTurn.userMessage) {
      remember(activeTurn.userMessage.createdAt || activeTurn.startedAt || activeTurn.createdAt);
    }
    return latest;
  }

  function hasHydratedCompletedTurn(thread) {
    var completedAt = latestCompletedAssistantTime(thread);
    if (completedAt === null) return false;
    if (hasUnsettledActiveWorkAfterCompletion(thread, completedAt)) return false;
    var latestRequestAt = latestUserRequestTime(thread);
    if (latestRequestAt !== null && completedAt < latestRequestAt) return false;
    var activeTurn = thread && thread.activeTurn;
    if (activeTurn && activeTurn.userMessage && !activeTurn.assistantMessage) {
      var activeRequestAt = parseTime(activeTurn.userMessage.createdAt || activeTurn.startedAt || activeTurn.createdAt);
      if (activeRequestAt === null || activeRequestAt > completedAt) return false;
    }
    return true;
  }

  function latestHeartbeat(thread, lifecycle) {
    var activeTurn = thread && thread.activeTurn;
    var projection = thread && thread.workflowProjection;
    var candidates = [
      activeTurn && activeTurn.lastPresenceAt,
      projection && projection.heartbeatAt,
      projection && projection.updatedAt,
      thread && thread.messageActivityAt,
      thread && thread.lastActivityAt,
    ].filter(Boolean);
    var latest = candidates.reduce(function (winner, candidate) {
      var winnerTime = parseTime(winner);
      var candidateTime = parseTime(candidate);
      if (winnerTime === null) return candidate;
      if (candidateTime !== null && candidateTime > winnerTime) return candidate;
      return winner;
    }, null);
    var latestTime = parseTime(latest);
    var currentTime = parseTime(nowIso());
    var ageMs = latestTime !== null && currentTime !== null ? Math.max(0, currentTime - latestTime) : null;
    var busy = BUSY_STATES.indexOf(lifecycle) >= 0;
    return {
      at: latest,
      ageMs: ageMs,
      stale: !!(busy && ageMs !== null && ageMs > STILL_WORKING_AFTER_MS),
      recovering: !!(busy && ageMs !== null && ageMs > RECOVERING_AFTER_MS),
    };
  }

  function activePresenceForLifecycle(lifecycle, thread) {
    var activeTurn = thread && thread.activeTurn;
    if (
      activeTurn &&
      activeTurn.presenceLabel &&
      (
        lifecycle === LIFECYCLE.SENDING ||
        lifecycle === LIFECYCLE.QUEUED ||
        lifecycle === LIFECYCLE.RUNNING ||
        lifecycle === LIFECYCLE.RESUMING ||
        lifecycle === LIFECYCLE.RECOVERING
      )
    ) {
      return activeTurn.presenceLabel;
    }
    return '';
  }

  function labelForLifecycle(lifecycle, thread, heartbeat) {
    if (lifecycle === LIFECYCLE.RUNNING && isDelegatedPause(thread && thread.activePause)) {
      if (delegatedPauseTasksComplete(thread && thread.activePause)) {
        return activePresenceForLifecycle(lifecycle, thread) || 'Writing response';
      }
      return 'Waiting on delegated work';
    }
    var presenceLabel = activePresenceForLifecycle(lifecycle, thread);
    if (presenceLabel) return presenceLabel;
    if (heartbeat && heartbeat.recovering) return 'Checking status';
    if (heartbeat && heartbeat.stale) return 'Still working';
    switch (lifecycle) {
      case LIFECYCLE.SENDING: return 'Sending';
      case LIFECYCLE.QUEUED: return 'Queued';
      case LIFECYCLE.RUNNING: return 'Working';
      case LIFECYCLE.WAITING_ON_REVIEW: return 'Waiting on review';
      case LIFECYCLE.WAITING_ON_USER: return 'Waiting on you';
      case LIFECYCLE.RESUMING: return 'Resuming';
      case LIFECYCLE.RECOVERING: return 'Checking status';
      case LIFECYCLE.FAILED: return 'Needs attention';
      case LIFECYCLE.COMPLETE: return 'Complete';
      default: return 'Ready';
    }
  }

  function detailForLifecycle(lifecycle, thread, heartbeat) {
    var activeTurn = thread && thread.activeTurn;
    var activePause = thread && thread.activePause;
    var detail = activeTurn && activeTurn.presenceDetail
      ? activeTurn.presenceDetail
      : '';
    if (!detail && lifecycle === LIFECYCLE.RUNNING && isDelegatedPause(activePause)) {
      detail = delegatedPauseTasksComplete(activePause)
        ? 'Delegated work is complete; composing the final answer.'
        : activePause.detail || activePause.progressSummary || '';
    }
    var signal = heartbeat && heartbeat.at ? 'Last signal ' + formatRelative(heartbeat.at) : '';
    if (heartbeat && heartbeat.recovering) {
      return [detail, signal ? signal + '; checking the run status.' : 'Checking the run status.'].filter(Boolean).join(' ');
    }
    if (heartbeat && heartbeat.stale) {
      return [detail, signal ? signal + '; still waiting on the current step.' : 'Still waiting on the current step.'].filter(Boolean).join(' ');
    }
    return [detail, signal].filter(Boolean).join(' ');
  }

  function appendActiveTurnSession(sessions, thread, lifecycle) {
    var activeTurn = thread && thread.activeTurn;
    if (!isRenderableActiveTurn(activeTurn)) return sessions;
    if (lifecycle === LIFECYCLE.COMPLETE && !(activeTurn.userMessage || activeTurn.assistantMessage)) return sessions;
    var user = activeTurn.userMessage ? normalizeMessage(activeTurn.userMessage, sessions.length) : null;
    var answer = activeTurn.assistantMessage ? normalizeMessage(activeTurn.assistantMessage, sessions.length) : null;
    var id = activeTurn.turnId || (user && user.id) || 'active-session';
    var workflowGroups = groupActivity(workflowItemsFromThread(thread));
    var existing = sessions.some(function (session) { return session.id === id || (user && session.user && session.user.id === user.id); });
    if (existing) {
      return sessions.map(function (session) {
        if (session.id === id || (user && session.user && session.user.id === user.id)) {
          return Object.assign({}, session, {
            lifecycle: lifecycle,
            answer: answer || session.answer,
            activityGroups: asArray(session.activityGroups).length ? session.activityGroups : workflowGroups,
          });
        }
        return session;
      });
    }
    return sessions.concat([{
      id: id,
      lifecycle: lifecycle,
      user: user,
      answer: answer,
      activityGroups: workflowGroups,
      chatOutputs: [],
      createdAt: activeTurn.startedAt || (user && user.createdAt) || null,
      updatedAt: activeTurn.lastPresenceAt || null,
      active: true,
    }]);
  }

  function deriveLifecycle(threadContext) {
    var thread = threadContext && threadContext.thread ? threadContext.thread : null;
    if (threadContext && threadContext.error) return LIFECYCLE.FAILED;
    var pauseStatus = statusFromPause(thread && thread.activePause, thread && thread.pendingHumanInputs);
    if (pauseStatus) return pauseStatus;
    var hydratedComplete = hasHydratedCompletedTurn(thread);
    if (hydratedComplete) return LIFECYCLE.COMPLETE;
    var activeStatus = statusFromActiveTurn(thread && thread.activeTurn);
    if (activeStatus && activeStatus !== LIFECYCLE.COMPLETE) return activeStatus;
    if (activeStatus === LIFECYCLE.COMPLETE) return LIFECYCLE.COMPLETE;
    var workflowStatus = statusFromWorkflow(thread && thread.workflowProjection);
    if (workflowStatus && workflowStatus !== LIFECYCLE.COMPLETE) return workflowStatus;
    var transcriptStatus = statusFromUiTranscript(thread);
    if (transcriptStatus && transcriptStatus !== LIFECYCLE.COMPLETE) return transcriptStatus;
    if (threadContext && threadContext.pending) return LIFECYCLE.RECOVERING;
    if (threadContext && threadContext.loading) return LIFECYCLE.QUEUED;
    var hasHistory = !!(
      thread &&
      (
        asArray(thread.runs).length ||
        asArray(thread.displayMessages || thread.messages).length ||
        asArray(thread.uiTranscript && thread.uiTranscript.events).length ||
        asArray(thread.chatOutputs).length
      )
    );
    return hasHistory ? (transcriptStatus || LIFECYCLE.COMPLETE) : LIFECYCLE.IDLE;
  }

  function deriveThreadViewModel(threadContext) {
    var thread = threadContext && threadContext.thread ? threadContext.thread : {};
    var lifecycle = deriveLifecycle(threadContext || {});
    var heartbeat = latestHeartbeat(thread, lifecycle);
    if (heartbeat.recovering && lifecycle === LIFECYCLE.RUNNING && !isDelegatedPause(thread && thread.activePause)) {
      lifecycle = LIFECYCLE.RECOVERING;
    }
    var runs = asArray(thread.runs);
    var sessions = runs.length
      ? buildSessionsFromRuns(runs)
      : buildSessionsFromMessages(thread.displayMessages || thread.messages || []);
    sessions = appendActiveTurnSession(sessions, thread, lifecycle);
    sessions = markQueuedContextSessions(sessions, lifecycle);
    sessions = sessions.map(settleActivityGroupsForSession);
    var chatOutputs = collectChatOutputs(thread);
    var pendingHumanInputs = asArray(thread.pendingHumanInputs);
    var activePause = clone(thread.activePause || null);
    var uiTranscriptEvents = buildTimelineEventsFromUiTranscript(thread);
    var legacyTimelineEvents = buildTimelineEventsFromLegacy(thread, sessions, chatOutputs, pendingHumanInputs, activePause, lifecycle);
    var timelineEvents = settleTimelineEventsForLifecycle(
      mergeTimelineEvents(uiTranscriptEvents, legacyTimelineEvents),
      lifecycle
    );
    var activeOperationId = (thread.activeTurn && thread.activeTurn.operationId)
      || (thread.workflowProjection && thread.workflowProjection.operationId)
      || null;
    var busy = BUSY_STATES.indexOf(lifecycle) >= 0;
    return {
      lifecycle: lifecycle,
      busy: busy,
      canSend: !!(thread && thread.id),
      composerMode: busy ? 'context' : 'prompt',
      statusLabel: labelForLifecycle(lifecycle, thread, heartbeat),
      statusDetail: detailForLifecycle(lifecycle, thread, heartbeat),
      heartbeat: heartbeat,
      sessions: sessions,
      chatOutputs: chatOutputs,
      timelineEvents: timelineEvents,
      pendingHumanInputs: pendingHumanInputs,
      activePause: activePause,
      workflowTimeline: clone(thread.workflowTimeline || (thread.workflowProjection && thread.workflowProjection.timeline) || null),
      activeOperationId: activeOperationId,
      diagnostics: {
        lifecycle: lifecycle,
        activeOperationId: activeOperationId,
        pendingHumanInputs: pendingHumanInputs.length,
        activePause: clone(thread.activePause || null),
        activeTurn: clone(thread.activeTurn || null),
        workflowProjection: clone(thread.workflowProjection || null),
        runtimeMessageCount: thread.runtimeSnapshot && Array.isArray(thread.runtimeSnapshot.messages)
          ? thread.runtimeSnapshot.messages.length
          : null,
        displayMessageCount: asArray(thread.displayMessages || thread.messages).length,
        chatOutputCount: chatOutputs.length,
        streamStatus: threadContext ? threadContext.streamStatus || null : null,
        relayStatus: threadContext ? threadContext.relayStatus || null : null,
        connection: clone(thread.connection || null),
        error: threadContext ? threadContext.error || null : null,
        heartbeat: heartbeat,
      },
    };
  }

  function reduceThreadRuntimeState(state, event) {
    var current = state || { lifecycle: LIFECYCLE.IDLE, events: [] };
    var next = Object.assign({}, current, {
      events: asArray(current.events).concat([clone(event)]).slice(-100),
      lastEventAt: event && event.createdAt ? event.createdAt : nowIso(),
    });
    var type = normalizeStatus(event && (event.type || event.status || event.phase));
    if (type === 'send' || type === 'sending') next.lifecycle = LIFECYCLE.SENDING;
    else if (type === 'queued' || type === 'accepted') next.lifecycle = LIFECYCLE.QUEUED;
    else if (type === 'running' || type === 'assistant_delta' || type === 'activity_update') next.lifecycle = LIFECYCLE.RUNNING;
    else if (type === 'review_needed' || type === 'needs_approval') next.lifecycle = LIFECYCLE.WAITING_ON_REVIEW;
    else if (type === 'resuming') next.lifecycle = LIFECYCLE.RESUMING;
    else if (type === 'reconnecting' || type === 'recovering' || type === 'timeout') next.lifecycle = LIFECYCLE.RECOVERING;
    else if (type === 'failed' || type === 'error') next.lifecycle = LIFECYCLE.FAILED;
    else if (type === 'completed' || type === 'complete' || type === 'turn_finish') next.lifecycle = LIFECYCLE.COMPLETE;
    if (event && event.operationId) next.operationId = event.operationId;
    return next;
  }

  window.__tribexAiChatReducer = {
    LIFECYCLE: LIFECYCLE,
    deriveThreadViewModel: deriveThreadViewModel,
    reduceThreadRuntimeState: reduceThreadRuntimeState,
    normalizeActivityItem: normalizeActivityItem,
    groupActivity: groupActivity,
    collectChatOutputs: collectChatOutputs,
    buildTimelineEventsFromLegacy: buildTimelineEventsFromLegacy,
  };
})();
