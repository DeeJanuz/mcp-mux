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

  function isRendererContentType(value) {
    var normalized = String(value || '').trim();
    return normalized === 'rich_content' || normalized === 'structured_data';
  }

  function hasArtifactMetadata(item) {
    if (!item || typeof item !== 'object') return false;
    var meta = item.resultMeta || item.meta || {};
    return !!(
      meta &&
      typeof meta === 'object' &&
      !Array.isArray(meta) &&
      (
        meta.artifactSource ||
        meta.artifactId ||
        meta.artifactKey ||
        meta.reviewSessionId
      )
    );
  }

  function isArtifactLike(item) {
    if (isSubagentToolEvent(item)) return false;
    if (!item) return false;
    if (isRendererContentType(item.resultContentType || item.contentType || item.toolName)) return true;
    if (item.artifactKey && hasArtifactMetadata(item)) return true;
    return !!(
      item.artifact &&
      typeof item.artifact === 'object' &&
      !Array.isArray(item.artifact) &&
      isRendererContentType(item.artifact.contentType || item.artifact.content_type)
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
        : isArtifactLike(item)
          ? 'artifact'
          : 'tool';
    var contentType = item.resultContentType || item.contentType || item.toolName || null;
    return {
      id: item.id || item.toolCallId || item.artifactKey || ('activity-' + index),
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
      artifactKey: item.artifactKey || null,
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
      artifact: [],
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
      { id: 'artifact', title: 'Artifacts', kind: 'artifact', items: groupsByKind.artifact },
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

  function normalizeArtifact(item, index) {
    if (!item) return null;
    if (!isArtifactLike(item)) return null;
    var contentType = item.contentType || item.resultContentType || item.toolName || null;
    var artifactKey = item.artifactKey || item.id || ('artifact-' + index);
    if (!artifactKey && !item.resultData) return null;
    return {
      id: artifactKey,
      artifactKey: artifactKey,
      title: item.title || item.summary || titleCase(contentType || 'Artifact'),
      detail: item.detail || '',
      contentType: contentType,
      resultData: clone(item.resultData || item.data || null),
      resultMeta: clone(item.resultMeta || item.meta || null),
      toolArgs: clone(item.toolArgs || null),
      reviewRequired: !!(item.reviewRequired || (item.resultMeta && item.resultMeta.reviewRequired)),
      createdAt: item.createdAt || item.updatedAt || null,
      raw: clone(item),
    };
  }

  function collectArtifacts(thread) {
    var artifacts = [];
    asArray(thread && thread.artifacts).forEach(function (item, index) {
      var artifact = normalizeArtifact(item, index);
      if (artifact) artifacts.push(artifact);
    });
    asArray(thread && thread.activityItems).forEach(function (item, index) {
      if (!isArtifactLike(item)) return;
      var artifact = normalizeArtifact(item, artifacts.length + index);
      if (artifact && !artifacts.some(function (candidate) { return candidate.artifactKey === artifact.artifactKey; })) {
        artifacts.push(artifact);
      }
    });
    asArray(thread && thread.runs).forEach(function (run) {
      var items = run && run.workSession ? run.workSession.items : [];
      asArray(items).forEach(function (item, index) {
        if (!isArtifactLike(item)) return;
        var artifact = normalizeArtifact(item, artifacts.length + index);
        if (artifact && !artifacts.some(function (candidate) { return candidate.artifactKey === artifact.artifactKey; })) {
          artifacts.push(artifact);
        }
      });
    });
    return artifacts;
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
          artifacts: [],
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
          artifacts: [],
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
            artifacts: [],
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
        artifacts: asArray(items).map(normalizeArtifact).filter(Boolean),
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

  function labelForLifecycle(lifecycle, thread, heartbeat) {
    if (lifecycle === LIFECYCLE.RUNNING && isDelegatedPause(thread && thread.activePause)) {
      return 'Waiting on delegated work';
    }
    if (heartbeat && heartbeat.recovering) return 'Checking status';
    if (heartbeat && heartbeat.stale) return 'Still working';
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

  function appendActiveTurnSession(sessions, thread, lifecycle) {
    var activeTurn = thread && thread.activeTurn;
    if (!isRenderableActiveTurn(activeTurn) || lifecycle === LIFECYCLE.COMPLETE) return sessions;
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
      artifacts: [],
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
    var activeStatus = statusFromActiveTurn(thread && thread.activeTurn);
    if (activeStatus && activeStatus !== LIFECYCLE.COMPLETE) return activeStatus;
    if (activeStatus === LIFECYCLE.COMPLETE) return LIFECYCLE.COMPLETE;
    var workflowStatus = statusFromWorkflow(thread && thread.workflowProjection);
    if (workflowStatus && workflowStatus !== LIFECYCLE.COMPLETE) return workflowStatus;
    if (threadContext && threadContext.pending) return LIFECYCLE.RECOVERING;
    if (threadContext && threadContext.loading) return LIFECYCLE.QUEUED;
    var hasHistory = !!(
      thread &&
      (
        asArray(thread.runs).length ||
        asArray(thread.displayMessages || thread.messages).length ||
        asArray(thread.artifacts).length
      )
    );
    return hasHistory ? LIFECYCLE.COMPLETE : LIFECYCLE.IDLE;
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
    var artifacts = collectArtifacts(thread);
    var pendingHumanInputs = asArray(thread.pendingHumanInputs);
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
      statusDetail: heartbeat.at
        ? 'Last signal ' + formatRelative(heartbeat.at)
        : '',
      heartbeat: heartbeat,
      sessions: sessions,
      artifacts: artifacts,
      pendingHumanInputs: pendingHumanInputs,
      activePause: clone(thread.activePause || null),
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
        artifactCount: artifacts.length,
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
    collectArtifacts: collectArtifacts,
  };
})();
