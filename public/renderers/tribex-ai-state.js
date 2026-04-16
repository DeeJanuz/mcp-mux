// @ts-nocheck
/* TribeX AI state — live first-party navigator and thread state */

(function () {
  'use strict';

  var listeners = [];
  var streamListenerBound = false;
  var desktopRelayListenerBound = false;
  var desktopPresenceListenerBound = false;
  var navigatorLoad = null;
  var activeSession = null;
  var projectBootstrap = null;
  var runtimeEventUnsubscribers = {};
  var state = {
    ui: {
      navigatorVisible: false,
      navigatorCollapsed: false,
      searchTerm: '',
      organizationMenuOpen: false,
      workspaceComposerOpen: false,
      projectComposerOpen: false,
    },
    integration: {
      config: null,
      status: 'idle',
      error: null,
      session: null,
      authEmail: '',
      verificationInput: '',
      magicLinkSentTo: null,
      sendingMagicLink: false,
      verifyingMagicLink: false,
    },
    packages: [],
    organizations: [],
    selectedOrganizationId: null,
    workspacesById: {},
    selectedWorkspaceId: null,
    projects: [],
    selectedProjectId: null,
    threads: [],
    threadDetails: {},
    threadErrors: {},
    loadingNavigator: false,
    loadingThreadIds: {},
    pendingThreadIds: {},
    companionKeys: {},
    lastCompanionSequences: {},
    streamStatuses: {},
    relayStates: {},
    workspaceUiById: {},
    composer: {
      workspaceName: '',
      workspacePackageKey: '',
      creatingWorkspace: false,
      projectName: '',
      creatingProject: false,
    },
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function notify() {
    listeners.slice().forEach(function (listener) {
      listener(getSnapshot());
    });
    if (window.__companionUtils && typeof window.__companionUtils.rerenderActiveSession === 'function') {
      window.__companionUtils.rerenderActiveSession();
    } else if (window.__companionUtils && typeof window.__companionUtils.refreshActiveSession === 'function') {
      window.__companionUtils.refreshActiveSession();
    }
  }

  function subscribe(listener) {
    listeners.push(listener);
    return function unsubscribe() {
      listeners = listeners.filter(function (candidate) {
        return candidate !== listener;
      });
    };
  }

  function getSelectedOrganization() {
    return state.organizations.find(function (organization) {
      return organization.id === state.selectedOrganizationId;
    }) || state.organizations[0] || null;
  }

  function getWorkspace(workspaceId) {
    return workspaceId ? state.workspacesById[workspaceId] || null : null;
  }

  function getProject(projectId) {
    return state.projects.find(function (project) {
      return project.id === projectId;
    }) || null;
  }

  function getThread(threadId) {
    return state.threads.find(function (thread) {
      return thread.id === threadId;
    }) || null;
  }

  function getWorkspaceProjects(workspaceId) {
    return state.projects.filter(function (project) {
      return project.workspaceId === workspaceId;
    });
  }

  function ensureWorkspaceUi(workspaceId) {
    if (!workspaceId) return null;
    if (!state.workspaceUiById[workspaceId]) {
      state.workspaceUiById[workspaceId] = {
        lastProjectId: null,
        lastThreadId: null,
        expandedProjectIds: {},
      };
    }
    return state.workspaceUiById[workspaceId];
  }

  function getWorkspaceUi(workspaceId) {
    return workspaceId ? ensureWorkspaceUi(workspaceId) : null;
  }

  function getSelectedWorkspace() {
    if (state.selectedWorkspaceId && state.workspacesById[state.selectedWorkspaceId]) {
      return state.workspacesById[state.selectedWorkspaceId];
    }

    var selectedOrganization = getSelectedOrganization();
    var workspaceIds = Object.keys(state.workspacesById).filter(function (workspaceId) {
      var workspace = state.workspacesById[workspaceId];
      return !selectedOrganization || workspace.organizationId === selectedOrganization.id;
    });

    return workspaceIds[0] ? state.workspacesById[workspaceIds[0]] : null;
  }

  function getSelectedProject() {
    var selectedWorkspace = getSelectedWorkspace();
    if (!selectedWorkspace) return null;

    var workspaceProjects = getWorkspaceProjects(selectedWorkspace.id);
    var workspaceUi = getWorkspaceUi(selectedWorkspace.id);
    if (workspaceUi && workspaceUi.lastProjectId) {
      var rememberedProject = getProject(workspaceUi.lastProjectId);
      if (rememberedProject && rememberedProject.workspaceId === selectedWorkspace.id) {
        return rememberedProject;
      }
    }
    if (state.selectedProjectId) {
      var selectedProject = getProject(state.selectedProjectId);
      if (selectedProject && selectedProject.workspaceId === selectedWorkspace.id) {
        return selectedProject;
      }
    }

    if (activeSession && activeSession.projectId) {
      var activeProject = getProject(activeSession.projectId);
      if (activeProject && activeProject.workspaceId === selectedWorkspace.id) {
        return activeProject;
      }
    }

    return workspaceProjects[0] || null;
  }

  function rememberWorkspaceContext(workspaceId, projectId, threadId) {
    var workspaceUi = getWorkspaceUi(workspaceId);
    if (!workspaceUi) return;
    if (projectId) workspaceUi.lastProjectId = projectId;
    if (threadId) workspaceUi.lastThreadId = threadId;
  }

  function isProjectExpanded(projectId) {
    var project = getProject(projectId);
    if (!project || !project.workspaceId) return false;
    var workspaceUi = getWorkspaceUi(project.workspaceId);
    if (!workspaceUi) return false;
    if (Object.prototype.hasOwnProperty.call(workspaceUi.expandedProjectIds, projectId)) {
      return workspaceUi.expandedProjectIds[projectId] !== false;
    }
    return resolveSelectedProjectId() === projectId;
  }

  function setProjectExpanded(projectId, expanded) {
    var project = getProject(projectId);
    if (!project || !project.workspaceId) return;
    var workspaceUi = getWorkspaceUi(project.workspaceId);
    if (!workspaceUi) return;
    workspaceUi.expandedProjectIds[projectId] = expanded !== false;
  }

  function toggleProjectExpanded(projectId) {
    setProjectExpanded(projectId, !isProjectExpanded(projectId));
    notify();
  }

  function resolveSelectedProjectId() {
    var selectedProject = getSelectedProject();
    return selectedProject ? selectedProject.id : null;
  }

  function resolvePreferredWorkspace() {
    var selectedWorkspace = getSelectedWorkspace();
    if (selectedWorkspace) return selectedWorkspace;

    var workspaceIds = Object.keys(state.workspacesById);
    for (var i = 0; i < workspaceIds.length; i++) {
      var workspace = state.workspacesById[workspaceIds[i]];
      return workspace;
    }
    return null;
  }

  function ensureProjectForNewThread() {
    var existingProjectId = resolveSelectedProjectId();
    if (existingProjectId) return Promise.resolve(existingProjectId);

    var workspace = getSelectedWorkspace();
    if (!workspace || !window.__tribexAiClient || typeof window.__tribexAiClient.createProject !== 'function') {
      return Promise.resolve(null);
    }

    if (projectBootstrap) return projectBootstrap;

    projectBootstrap = window.__tribexAiClient.createProject(workspace, 'General')
      .then(function (project) {
        if (!project || !project.id) return null;
        state.projects.push(project);
        state.selectedProjectId = project.id;
        rememberWorkspaceContext(project.workspaceId, project.id, null);
        setProjectExpanded(project.id, true);
        notify();
        return project.id;
      })
      .finally(function () {
        projectBootstrap = null;
      });

    return projectBootstrap;
  }

  function restoreWorkspaceContext(workspaceId) {
    var workspaceUi = getWorkspaceUi(workspaceId);
    var workspaceProjects = getWorkspaceProjects(workspaceId);
    if (!workspaceProjects.length) {
      state.selectedProjectId = null;
      notify();
      return Promise.resolve(null);
    }

    var targetProjectId = workspaceUi && workspaceUi.lastProjectId && getProject(workspaceUi.lastProjectId)
      ? workspaceUi.lastProjectId
      : workspaceProjects[0].id;
    state.selectedProjectId = targetProjectId;
    setProjectExpanded(targetProjectId, true);
    notify();

    if (!workspaceUi || !workspaceUi.lastThreadId) return Promise.resolve(null);
    var rememberedThread = getThread(workspaceUi.lastThreadId);
    if (!rememberedThread || rememberedThread.workspaceId !== workspaceId) return Promise.resolve(null);
    if (activeSession && activeSession.threadId === rememberedThread.id) return Promise.resolve(rememberedThread.id);
    openThread(rememberedThread.id, { connectStream: false });
    return Promise.resolve(rememberedThread.id);
  }

  function isThreadSession(session) {
    return !!(session && session.meta && session.meta.aiView === 'thread');
  }

  function bindStreamListener() {
    if (streamListenerBound || !window.__tribexAiClient || typeof window.__tribexAiClient.listenToStreamEvents !== 'function') {
      return;
    }
    streamListenerBound = true;
    window.__tribexAiClient.listenToStreamEvents(handleStreamEvent).catch(function () {
      streamListenerBound = false;
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

  function bindDesktopRelayListener() {
    if (
      desktopRelayListenerBound ||
      !window.__tribexAiClient ||
      typeof window.__tribexAiClient.listenToDesktopRelayEvents !== 'function'
    ) {
      return;
    }
    desktopRelayListenerBound = true;
    window.__tribexAiClient.listenToDesktopRelayEvents(handleDesktopRelayEvent).catch(function () {
      desktopRelayListenerBound = false;
    });
  }

  function bindDesktopPresenceListener() {
    if (
      desktopPresenceListenerBound ||
      !window.__tribexAiClient ||
      typeof window.__tribexAiClient.listenToDesktopPresenceEvents !== 'function'
    ) {
      return;
    }
    desktopPresenceListenerBound = true;
    window.__tribexAiClient.listenToDesktopPresenceEvents(handleDesktopPresenceEvent).catch(function () {
      desktopPresenceListenerBound = false;
    });
  }

  function handleDesktopRelayEvent(event) {
    if (!event || !event.relayId) return;

    if (event.type === 'status') {
      updateRelayState(event.relayId, {
        streamStatus: event.status || 'idle',
        error: null,
      });
      notify();
      return;
    }

    if (event.type === 'error') {
      updateRelayState(event.relayId, {
        streamStatus: 'error',
        error: event.message || 'Desktop relay stream failed.',
      });
      notify();
      return;
    }

    if (event.type === 'data' && event.payload && typeof event.payload === 'object') {
      updateRelayState(event.relayId, {
        relaySessionId: event.payload.relaySessionId || null,
        relayDeviceId: event.payload.deviceId || null,
        lastRelayEventType: event.payload.type || null,
        error: null,
      });
      notify();
    }
  }

  function handleDesktopPresenceEvent(event) {
    if (!event || !event.heartbeatId) return;

    if (event.type === 'status') {
      updateRelayState(event.heartbeatId, {
        presenceStatus: event.status || 'idle',
        error: null,
      });
      notify();
      return;
    }

    if (event.type === 'error') {
      updateRelayState(event.heartbeatId, {
        presenceStatus: 'error',
        error: event.message || 'Desktop relay presence heartbeat failed.',
      });
      notify();
    }
  }

  function mergeThreadSummary(summary) {
    var next = Object.assign({}, getThread(summary.id) || {});
    Object.keys(summary || {}).forEach(function (key) {
      var value = summary[key];
      if (value === undefined || value === null) return;
      next[key] = value;
    });
    var replaced = false;
    state.threads = state.threads.map(function (thread) {
      if (thread.id !== next.id) return thread;
      replaced = true;
      return next;
    });
    if (!replaced) state.threads.push(next);
    return next;
  }

  function parseActivityTimestamp(value) {
    if (!value) return null;
    var ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function randomId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return (prefix || 'id') + '-' + window.crypto.randomUUID();
    }
    return (prefix || 'id') + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
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

  function copyMessages(messages) {
    return Array.isArray(messages)
      ? messages.filter(Boolean).map(function (message) {
        return Object.assign({}, message);
      })
      : [];
  }

  function createThreadDetailRecord(threadId) {
    var summary = getThread(threadId) || {};
    return {
      id: threadId,
      title: summary.title || 'Thread',
      projectId: summary.projectId || null,
      workspaceId: summary.workspaceId || null,
      hydrateState: summary.hydrateState || summary.status || null,
      preview: summary.preview || '',
      lastActivityAt: summary.lastActivityAt || null,
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
    if (!state.threadDetails[threadId]) {
      state.threadDetails[threadId] = createThreadDetailRecord(threadId);
    }
    return state.threadDetails[threadId];
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
      isCompletedActivityStatus(item.status) &&
      item.resultData &&
      contentType &&
      window.__renderers &&
      typeof window.__renderers[contentType] === 'function'
    );
  }

  function buildActivityArtifactConfig(threadId, item) {
    var contentType = resolveActivityContentType(item);
    var title = (item.resultData && item.resultData.title)
      || item.title
      || (item.toolName && window.__tribexAiUtils.titleCase(item.toolName))
      || 'Result';
    return {
      drawerId: 'tribex-ai-thread-artifacts:' + (threadId || 'thread'),
      artifactKey: [
        'tribex-ai-result',
        threadId || 'thread',
        item.turnId || ('ordinal-' + String(item.turnOrdinal || '0')),
        item.toolCallId || item.id || contentType || 'result',
      ].join(':'),
      title: title,
      contentType: contentType || 'rich_content',
      data: item.resultData || {},
      meta: Object.assign({}, item.resultMeta || {}, {
        headerTitle: title,
        threadId: threadId || null,
        turnId: item.turnId || null,
        turnOrdinal: item.turnOrdinal || null,
        activityId: item.id || null,
        artifactSource: 'tribex-ai-thread-result',
      }),
      toolArgs: item.toolArgs || {},
    };
  }

  function normalizeArtifactItems(record) {
    if (!record) return [];
    return buildActivityItems(record)
      .filter(function (item) {
        return isRendererBackedActivityItem(item);
      })
      .map(function (item) {
        var config = buildActivityArtifactConfig(record.id, item);
        return {
          artifactKey: item.artifactKey || config.artifactKey,
          title: item.resultTitle || config.title,
          contentType: config.contentType,
          data: config.data,
          meta: config.meta,
          toolArgs: config.toolArgs,
        };
      });
  }

  function syncThreadArtifactDrawer(record) {
    if (
      !record ||
      !activeSession ||
      !activeSession.isThread ||
      activeSession.threadId !== record.id ||
      !activeSession.sessionId ||
      !window.__companionUtils ||
      typeof window.__companionUtils.syncThreadArtifactDrawer !== 'function'
    ) {
      return;
    }

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

    if (typeof window.__companionUtils.setThreadArtifactContext === 'function') {
      window.__companionUtils.setThreadArtifactContext(activeSession.sessionId, record.id);
    }

    window.__companionUtils.syncThreadArtifactDrawer({
      sessionId: activeSession.sessionId,
      threadId: record.id,
      drawerId: record.artifactDrawer.drawerId,
      selectedArtifactKey: record.artifactDrawer.selectedArtifactKey,
      artifacts: artifacts,
      open: artifacts.length > 0,
    });
  }

  function attachActivityResultDrawer(record, item) {
    if (!record || !item || !isRendererBackedActivityItem(item)) return item;
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
    if (part.output != null) return stringifyPreview(part.output);
    if (part.input != null) return stringifyPreview(part.input);
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
    if (!record || !item || !item.id) return;
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
  }

  function reconcileLiveActivity(record) {
    if (!record || !record.activity) return;
    var snapshotItems = buildSnapshotActivityItems(record);
    var snapshotIds = {};

    snapshotItems.forEach(function (item) {
      snapshotIds[item.id] = true;
    });

    record.activity.order = record.activity.order.filter(function (itemId) {
      if (!snapshotIds[itemId]) return true;
      delete record.activity.itemsById[itemId];
      return false;
    });
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
          timestamp: parseActivityTimestamp(item.updatedAt || item.createdAt),
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
          timestamp: parseActivityTimestamp(message && message.createdAt),
        };
      })
      .sort(function (left, right) {
        if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp;
        }
        if (left.timestamp === null && right.timestamp !== null) return 1;
        if (left.timestamp !== null && right.timestamp === null) return -1;
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
        var leftTime = parseActivityTimestamp(left.createdAt || left.updatedAt);
        var rightTime = parseActivityTimestamp(right.createdAt || right.updatedAt);
        if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        if (leftTime === null && rightTime !== null) return 1;
        if (leftTime !== null && rightTime === null) return -1;
        return String(left.id || '').localeCompare(String(right.id || ''));
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
        } : {
          id: 'answer-' + index,
          content: '',
          createdAt: null,
          isStreaming: false,
        },
        workSession: workSession,
      };
    });
  }

  function buildThreadProjection(record) {
    var displayMessages = buildDisplayMessages(record);
    var activityItems = buildActivityItems(record);
    var runs = buildRunGroups(record, displayMessages, activityItems);
    var latestMessage = displayMessages.length ? displayMessages[displayMessages.length - 1] : null;
    var previewSource = null;
    var lastActivityAt = latestMessage && latestMessage.createdAt
      ? latestMessage.createdAt
      : (record.runtimeSnapshot && record.runtimeSnapshot.lastActivityAt) || record.base.lastActivityAt || record.lastActivityAt || null;

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
      || record.base.preview
      || record.preview
      || '';

    return {
      displayMessages: displayMessages,
      activityItems: activityItems,
      runs: runs,
      artifactDrawer: record && record.artifactDrawer
        ? {
          drawerId: record.artifactDrawer.drawerId || null,
          selectedArtifactKey: record.artifactDrawer.selectedArtifactKey || null,
          artifactKeys: normalizeArtifactItems(record).map(function (artifact) {
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
    mergeThreadSummary({
      id: record.id,
      title: record.title,
      projectId: record.projectId,
      workspaceId: record.workspaceId,
      preview: projection.preview,
      hydrateState: record.hydrateState,
      lastActivityAt: projection.lastActivityAt,
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

  function mergeThreadDetail(detail) {
    if (!detail || !detail.id) return null;
    var merged = ensureThreadDetailRecord(detail.id);

    if (detail.title) merged.title = detail.title;
    if (detail.projectId) merged.projectId = detail.projectId;
    if (detail.workspaceId) merged.workspaceId = detail.workspaceId;
    if (detail.hydrateState || detail.status) merged.hydrateState = detail.hydrateState || detail.status;
    if (detail.preview) merged.base.preview = detail.preview;
    if (detail.lastActivityAt) merged.base.lastActivityAt = detail.lastActivityAt;

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
      merged.lastTurnOrdinal = Math.max(
        merged.lastTurnOrdinal || 0,
        countUserMessages(merged.runtimeSnapshot.messages),
      );
      reconcileActiveTurn(merged);
      reconcileLiveActivity(merged);
      syncThreadArtifactDrawer(merged);
    } else if (Array.isArray(detail.messages)) {
      merged.base.messages = detail.messages.slice();
    }

    syncThreadSummaryFromRecord(merged);
    return merged;
  }

  function startActiveTurn(threadId, event) {
    var detail = ensureThreadDetailRecord(threadId);
    var existing = detail.activeTurn;
    var userMessage = event.message ? Object.assign({}, event.message) : null;
    var turnOrdinal = event.turnOrdinal
      || (existing && existing.turnOrdinal)
      || (userMessage && userMessage.turnOrdinal)
      || resolveNextTurnOrdinal(detail);

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
      turnId: event.turnId || (existing && existing.turnId) || randomId('turn'),
      turnOrdinal: turnOrdinal,
      status: 'queued',
      userMessage: userMessage,
      assistantMessage: existing && existing.assistantMessage ? existing.assistantMessage : null,
      startedAt: event.createdAt || (existing && existing.startedAt) || nowIso(),
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
    syncThreadSummaryFromRecord(detail);
    return detail;
  }

  function queueLocalTurn(threadId, prompt, turnId) {
    var detail = ensureThreadDetailRecord(threadId);
    var createdAt = nowIso();
    var turnOrdinal = resolveNextTurnOrdinal(detail);

    detail.activeTurn = {
      turnId: turnId || randomId('turn'),
      turnOrdinal: turnOrdinal,
      status: 'queued',
      userMessage: {
        id: randomId('user'),
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
    syncThreadSummaryFromRecord(detail);
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
    } else if (!containsMessage(messages, message)) {
      messages.push(Object.assign({}, message));
    }

    record.base.messages = messages;
    if (message.content && (message.role === 'user' || message.role === 'assistant')) {
      record.base.preview = message.content;
    }
    if (message.createdAt) {
      record.base.lastActivityAt = message.createdAt;
    }
    syncThreadSummaryFromRecord(record);
  }

  function buildCompanionActivityItem(message, record) {
    if (!message || message.role !== 'tool') return null;
    var latestTurn = getLatestTurnReference(record) || {};
    return {
      id: message.id || randomId('activity'),
      toolCallId: message.id || null,
      toolName: message.toolName || null,
      resultContentType: message.toolName || null,
      title: message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'tool'),
      status: message.status || 'completed',
      detail: message.detail || '',
      resultData: message.resultData || null,
      resultMeta: message.resultMeta || null,
      toolArgs: message.toolArgs || null,
      turnId: message.turnId || latestTurn.turnId || null,
      turnOrdinal: message.turnOrdinal || latestTurn.turnOrdinal || null,
      createdAt: message.createdAt || nowIso(),
      updatedAt: message.createdAt || nowIso(),
    };
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
    var detail = ensureThreadDetailRecord(threadId);
    if (!detail.activeTurn) {
      detail.activeTurn = {
        turnId: null,
        status: 'running',
        userMessage: null,
        assistantMessage: null,
        startedAt: nowIso(),
      };
    }
    if (!detail.activeTurn.assistantMessage) {
      detail.activeTurn.assistantMessage = {
        id: 'runtime-assistant-' + Date.now(),
        role: 'assistant',
        content: '',
        createdAt: nowIso(),
        isStreaming: true,
        messageId: null,
        turnId: detail.activeTurn.turnId || null,
        turnOrdinal: detail.activeTurn.turnOrdinal || null,
      };
    }
    detail.activeTurn.assistantMessage.turnId = detail.activeTurn.turnId || detail.activeTurn.assistantMessage.turnId || null;
    detail.activeTurn.assistantMessage.turnOrdinal = detail.activeTurn.turnOrdinal || detail.activeTurn.assistantMessage.turnOrdinal || null;
    updater(detail.activeTurn.assistantMessage, detail.activeTurn);
    syncThreadSummaryFromRecord(detail);
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
      notify();
      return;
    }

    if (event.type === 'error') {
      state.streamStatuses[event.threadId] = 'error';
      state.threadErrors[event.threadId] = event.message || 'Companion stream failed.';
      notify();
      return;
    }

    var payload = event.payload || {};
    if (shouldSkipReplayEvent(event.threadId, payload)) {
      return;
    }

    var existing = state.threadDetails[event.threadId];
    var runtimeDriven = !!(existing && (existing.runtimeSnapshot || existing.activeTurn));

    if (
      !runtimeDriven &&
      payload.toolName &&
      payload.result &&
      window.__tribexAiClient &&
      typeof window.__tribexAiClient.shouldPreviewCompanionPayload === 'function' &&
      window.__tribexAiClient.shouldPreviewCompanionPayload(payload)
    ) {
      postPushPreview(payload);
    }

    var normalizedMessage = window.__tribexAiClient && typeof window.__tribexAiClient.normalizeMessage === 'function'
      ? window.__tribexAiClient.normalizeMessage(payload, 0)
      : null;

    if (payload.thread || payload.messages || payload.events || payload.transcript) {
      if (!existing || (!existing.runtimeSnapshot && !existing.activeTurn)) {
        var detail = window.__tribexAiClient.normalizeThreadDetail(payload);
        if (detail && detail.id) {
          mergeThreadDetail(detail);
          state.threadErrors[event.threadId] = null;
          notify();
          return;
        }
      }
    }

    if (!normalizedMessage) {
      return;
    }

    var record = ensureThreadDetailRecord(event.threadId);
    runtimeDriven = !!(record.runtimeSnapshot || record.activeTurn);

    if (normalizedMessage.role === 'tool') {
      if (runtimeDriven) {
        var activityItem = buildCompanionActivityItem(normalizedMessage, record);
        if (activityItem) {
          upsertActivityItem(record, activityItem);
          notify();
        }
        return;
      }

      appendLegacyMessage(record, normalizedMessage);
      state.threadErrors[event.threadId] = null;
      notify();
      return;
    }

    if (!runtimeDriven && normalizedMessage.role === 'assistant') {
      appendLegacyMessage(record, normalizedMessage);
      state.threadErrors[event.threadId] = null;
      notify();
    }
  }

  function bindRuntimeBridge(threadId) {
    if (
      !threadId ||
      runtimeEventUnsubscribers[threadId] ||
      !window.__tribexAiClient ||
      typeof window.__tribexAiClient.listenToRuntimeEvents !== 'function'
    ) {
      return;
    }

    runtimeEventUnsubscribers[threadId] = window.__tribexAiClient.listenToRuntimeEvents(threadId, function (event) {
      handleRuntimeEvent(threadId, event);
    });
  }

  function unbindRuntimeBridge(threadId) {
    if (!threadId || !runtimeEventUnsubscribers[threadId]) return;
    try {
      runtimeEventUnsubscribers[threadId]();
    } catch (_error) {
      // Best-effort unsubscribe.
    }
    delete runtimeEventUnsubscribers[threadId];
  }

  function handleRuntimeEvent(threadId, event) {
    if (!threadId || !event) return;
    var detail = ensureThreadDetailRecord(threadId);

    if (event.type === 'status') {
      detail.connection.runtimeStatus = event.status || 'idle';
      notify();
      return;
    }

    if (event.type === 'error') {
      detail.connection.runtimeError = event.error || 'Runtime connection failed.';
      state.threadErrors[threadId] = detail.connection.runtimeError;
      delete state.pendingThreadIds[threadId];
      notify();
      return;
    }

    if (event.type === 'identity') {
      detail.connection.identity = {
        name: event.name || null,
        agent: event.agent || null,
      };
      notify();
      return;
    }

    if (event.type === 'runtime_snapshot') {
      if (window.__tribexAiClient && typeof window.__tribexAiClient.normalizeRuntimeTranscript === 'function') {
        mergeThreadDetail(window.__tribexAiClient.normalizeRuntimeTranscript(threadId, {
          messages: event.messages || [],
        }));
      }
      state.threadErrors[threadId] = null;
      notify();
      return;
    }

    if (event.type === 'turn_start') {
      state.threadErrors[threadId] = null;
      notify();
      return;
    }

    if (event.type === 'user_accepted') {
      startActiveTurn(threadId, event);
      notify();
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
      notify();
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
      notify();
      return;
    }

    if (event.type === 'assistant_finish') {
      if (event.turnId) {
        detail.turnCompletedAtById[event.turnId] = (event.message && event.message.createdAt) || event.createdAt || nowIso();
      }
      updateActiveAssistant(threadId, function (message, activeTurn) {
        message.id = event.message && event.message.id ? event.message.id : message.id;
        message.messageId = event.message && event.message.messageId ? event.message.messageId : (message.messageId || null);
        message.createdAt = event.message && event.message.createdAt ? event.message.createdAt : (event.createdAt || message.createdAt);
        message.content = event.message && typeof event.message.content === 'string' ? event.message.content : message.content;
        message.isStreaming = false;
        activeTurn.status = 'finalized';
      });
      rememberTurnHistory(detail);
      notify();
      return;
    }

    if ((event.type === 'activity_update' || event.type === 'work_note_update') && event.item) {
      upsertActivityItem(detail, Object.assign({}, event.item, {
        turnId: event.item.turnId || event.turnId || (detail.activeTurn && detail.activeTurn.turnId) || null,
        turnOrdinal: event.item.turnOrdinal || (detail.activeTurn && detail.activeTurn.turnOrdinal) || detail.lastTurnOrdinal || null,
      }));
      notify();
      return;
    }

    if (event.type === 'assistant_reset') {
      if (detail.activeTurn && (!detail.activeTurn.turnId || detail.activeTurn.turnId === event.turnId)) {
        detail.activeTurn.assistantMessage = null;
      }
      notify();
      return;
    }

    if (event.type === 'turn_error') {
      if (event.turnId) {
        detail.turnCompletedAtById[event.turnId] = event.createdAt || nowIso();
      } else if (detail.activeTurn && detail.activeTurn.turnId) {
        detail.turnCompletedAtById[detail.activeTurn.turnId] = event.createdAt || nowIso();
      }
      if (detail.activeTurn && (!detail.activeTurn.turnId || detail.activeTurn.turnId === event.turnId)) {
        detail.lastTurnId = detail.activeTurn.turnId || detail.lastTurnId || null;
        detail.lastTurnOrdinal = detail.activeTurn.turnOrdinal || detail.lastTurnOrdinal || 0;
        detail.activeTurn.status = 'failed';
        if (detail.activeTurn.assistantMessage) {
          detail.activeTurn.assistantMessage.isStreaming = false;
        }
        rememberTurnHistory(detail);
      }
      detail.connection.runtimeError = event.error || 'Runtime turn failed.';
      state.threadErrors[threadId] = detail.connection.runtimeError;
      delete state.pendingThreadIds[threadId];
      notify();
      return;
    }

    if (event.type === 'turn_finish') {
      if (event.turnId) {
        detail.turnCompletedAtById[event.turnId] = event.createdAt || nowIso();
      } else if (detail.activeTurn && detail.activeTurn.turnId) {
        detail.turnCompletedAtById[detail.activeTurn.turnId] = event.createdAt || nowIso();
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
        rememberTurnHistory(detail);
      }
      delete state.pendingThreadIds[threadId];
      state.threadErrors[threadId] = null;
      syncThreadSummaryFromRecord(detail);
      notify();
    }
  }

  function refreshNavigator(force) {
    if (navigatorLoad && !force) return navigatorLoad;
    bindStreamListener();
    bindDesktopRelayListener();
    bindDesktopPresenceListener();

    state.loadingNavigator = true;
    state.integration.error = null;
    notify();

    navigatorLoad = window.__tribexAiClient.getConfig()
      .then(function (config) {
        state.integration.config = config;
        if (!config || !config.configured) {
          state.integration.status = 'misconfigured';
          state.integration.session = null;
          state.packages = [];
          state.organizations = [];
          state.workspacesById = {};
          state.selectedWorkspaceId = null;
          state.projects = [];
          state.selectedProjectId = null;
          state.threads = [];
          return null;
        }
        return window.__tribexAiClient.fetchSession();
      })
      .then(function (session) {
        if (session === null) {
          state.integration.session = null;
          state.integration.status = 'unauthenticated';
          state.packages = [];
          state.organizations = [];
          state.workspacesById = {};
          state.selectedWorkspaceId = null;
          state.projects = [];
          state.selectedProjectId = null;
          state.threads = [];
          return null;
        }

        if (session) {
          state.integration.session = session;
          state.integration.status = 'authenticated';
        }

        return Promise.all([
          window.__tribexAiClient.fetchOrganizations(),
          window.__tribexAiClient.fetchPackages ? window.__tribexAiClient.fetchPackages().catch(function () { return []; }) : Promise.resolve([]),
        ]);
      })
      .then(function (payload) {
        if (!payload) return null;
        var organizations = payload[0] || [];
        var packages = payload[1] || [];
        state.packages = packages;
        state.organizations = organizations;
        state.selectedOrganizationId = state.selectedOrganizationId && organizations.some(function (organization) {
          return organization.id === state.selectedOrganizationId;
        }) ? state.selectedOrganizationId : (organizations[0] && organizations[0].id) || null;

        if (!state.selectedOrganizationId) {
          state.workspacesById = {};
          state.selectedWorkspaceId = null;
          state.selectedProjectId = null;
          state.projects = [];
          state.threads = [];
          return null;
        }

        return window.__tribexAiClient.fetchWorkspaces(state.selectedOrganizationId);
      })
      .then(function (workspaces) {
        if (!workspaces) return null;
        state.workspacesById = {};
        workspaces.forEach(function (workspace) {
          state.workspacesById[workspace.id] = workspace;
          ensureWorkspaceUi(workspace.id);
        });
        state.selectedWorkspaceId = state.selectedWorkspaceId && state.workspacesById[state.selectedWorkspaceId]
          ? state.selectedWorkspaceId
          : (workspaces[0] && workspaces[0].id) || null;

        if (!state.selectedWorkspaceId) {
          state.selectedProjectId = null;
          state.projects = [];
          state.threads = [];
          return null;
        }

        return window.__tribexAiClient.fetchProjects(state.workspacesById[state.selectedWorkspaceId]);
      })
      .then(function (projects) {
        if (!projects) return null;
        state.projects = projects || [];
        state.selectedProjectId = state.selectedProjectId && state.projects.some(function (project) {
          return project.id === state.selectedProjectId;
        }) ? state.selectedProjectId : resolveSelectedProjectId();

        return Promise.all(state.projects.map(function (project) {
          return window.__tribexAiClient.fetchThreads(project).catch(function () {
            return [];
          });
        }));
      })
      .then(function (threadLists) {
        if (!threadLists) return null;
        state.threads = [].concat.apply([], threadLists || []);
        if (!state.selectedProjectId && state.projects[0]) state.selectedProjectId = state.projects[0].id;
        if (state.selectedProjectId) setProjectExpanded(state.selectedProjectId, true);
        return true;
      })
      .catch(function (error) {
        var message = error && error.message ? error.message : String(error);
        state.integration.error = message;
        if (/token|unauth|auth|signed in/i.test(message)) {
          state.integration.status = 'unauthenticated';
          state.integration.session = null;
        } else {
          state.integration.status = 'error';
        }
      })
      .finally(function () {
        state.loadingNavigator = false;
        navigatorLoad = null;
        notify();
      });

    return navigatorLoad;
  }

  function ensureCompanion(threadId) {
    var thread = getThread(threadId);
    if (!thread || !thread.workspaceId) return Promise.resolve(null);
    if (state.companionKeys[threadId] || state.streamStatuses[threadId] === 'connected' || state.streamStatuses[threadId] === 'connecting') {
      return Promise.resolve(state.companionKeys[threadId] || null);
    }

    return window.__tribexAiClient.createCompanionSession(thread.workspaceId, threadId)
      .then(function (session) {
        if (!session || !session.companionKey) return null;
        state.companionKeys[threadId] = session.companionKey;
        state.streamStatuses[threadId] = 'connecting';
        notify();
        return window.__tribexAiClient.startCompanionStream(threadId, session.companionKey).then(function () {
          return session.companionKey;
        });
      })
      .catch(function () {
        state.streamStatuses[threadId] = 'unavailable';
        notify();
        return null;
      });
  }

  function buildSmokeThreadTitle() {
    return 'Smoke Test ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
  }

  function ensureDesktopRelay(threadId) {
    var thread = getThread(threadId);
    if (!thread || !thread.workspaceId || !window.__tribexAiClient) {
      return Promise.resolve(null);
    }

    bindDesktopRelayListener();
    bindDesktopPresenceListener();

    var existing = state.relayStates[threadId];
    if (existing && (existing.status === 'online' || existing.status === 'connecting')) {
      return Promise.resolve(existing);
    }

    updateRelayState(threadId, {
      status: 'connecting',
      error: null,
    });
    notify();

    return window.__tribexAiClient.registerDesktopRelay({
      workspaceId: thread.workspaceId,
      threadId: threadId,
      deviceKey: 'mcpviews-' + thread.workspaceId,
      label: 'MCPViews Desktop',
      platform: 'tauri-desktop',
      purpose: 'mcp-proxy',
      metadata: {
        client: 'mcpviews',
        source: 'smoke-test',
      },
      })
      .then(function (relay) {
        var next = updateRelayState(threadId, {
          registration: relay || null,
          relaySessionId: relay && relay.relaySession ? relay.relaySession.id || null : null,
          relayDeviceId: relay && relay.relayDeviceId ? relay.relayDeviceId : null,
          error: null,
        });
        notify();

        return Promise.all([
          window.__tribexAiClient.startDesktopRelayStream(
            threadId,
            '/api/desktop-relay/stream',
            { threadId: threadId },
          ),
          window.__tribexAiClient.startDesktopPresenceHeartbeat(
            threadId,
            30,
            {
              relaySessionId: next && next.relaySessionId ? next.relaySessionId : undefined,
              status: 'ONLINE',
              metadata: {
                source: 'smoke-test',
                threadId: threadId,
              },
            },
            '/api/desktop-relay/presence',
          ),
        ]).then(function () {
          return next;
        });
      })
      .catch(function (error) {
        updateRelayState(threadId, {
          error: error && error.message ? error.message : String(error),
        });
        notify();
        throw error;
      });
  }

  function refreshThread(threadId, connectStream) {
    if (!threadId) return Promise.resolve(null);
    state.loadingThreadIds[threadId] = true;
    bindRuntimeBridge(threadId);
    notify();

    return window.__tribexAiClient.fetchThread(threadId)
      .then(function (detail) {
        if (detail && detail.id) {
          var summary = getThread(threadId);
          if (summary) {
            detail.projectId = detail.projectId || summary.projectId;
            detail.workspaceId = detail.workspaceId || summary.workspaceId;
          }
          mergeThreadDetail(detail);
          state.threadErrors[threadId] = null;
          if (connectStream !== false) {
            return ensureDesktopRelay(threadId)
              .then(function () {
                if (!window.__tribexAiClient || typeof window.__tribexAiClient.syncThreadRuntime !== 'function') {
                  return null;
                }
                return window.__tribexAiClient.syncThreadRuntime(threadId).catch(function () {
                  return null;
                });
              })
              .then(function (runtimeDetail) {
                if (runtimeDetail && runtimeDetail.id) {
                  mergeThreadDetail(runtimeDetail);
                }
                return detail;
              })
              .then(function () {
                return detail;
              });
          }
          return detail;
        }
        return null;
      })
        .catch(function (error) {
          state.threadErrors[threadId] = error && error.message ? error.message : String(error);
          notify();
          return null;
        })
      .finally(function () {
        delete state.loadingThreadIds[threadId];
        notify();
      });
  }

  function pollThread(threadId, attempts) {
    if (attempts <= 0) return Promise.resolve(null);
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        refreshThread(threadId, false).finally(function () {
          resolve(pollThread(threadId, attempts - 1));
        });
      }, 1200);
    });
  }

  function getSnapshot() {
    var selectedOrganization = getSelectedOrganization();
    var preferredWorkspace = resolvePreferredWorkspace();
    var selectedWorkspace = getSelectedWorkspace();
    var selectedProject = getSelectedProject();
    var workspaceList = Object.keys(state.workspacesById)
      .map(function (workspaceId) {
        return state.workspacesById[workspaceId];
      })
      .filter(function (workspace) {
        return !selectedOrganization || workspace.organizationId === selectedOrganization.id;
      });

    return {
      integration: clone(state.integration),
      loadingNavigator: state.loadingNavigator,
      navigatorVisible: state.ui.navigatorVisible,
      navigatorCollapsed: state.ui.navigatorCollapsed,
      organizationMenuOpen: state.ui.organizationMenuOpen,
      workspaceComposerOpen: state.ui.workspaceComposerOpen,
      projectComposerOpen: state.ui.projectComposerOpen,
      searchTerm: state.ui.searchTerm,
      packages: clone(state.packages),
      composer: clone(state.composer),
      organizations: clone(state.organizations),
      selectedOrganization: clone(selectedOrganization),
      workspaces: clone(workspaceList),
      selectedWorkspace: clone(selectedWorkspace),
      selectedProject: clone(selectedProject),
      preferredWorkspace: clone(preferredWorkspace),
      projectGroups: clone(window.__tribexAiUtils.buildProjectGroups(
        state.projects,
        state.threads,
        resolveSelectedProjectId(),
        state.ui.searchTerm,
      )),
      hasWorkspaces: workspaceList.length > 0,
      hasProjects: state.projects.length > 0,
      canRunSmokeTest: !!(selectedWorkspace && selectedWorkspace.packageKey === 'smoke'),
      activeProjectId: resolveSelectedProjectId(),
      activeThreadId: activeSession && activeSession.threadId && getThread(activeSession.threadId) &&
        getThread(activeSession.threadId).workspaceId === (selectedWorkspace && selectedWorkspace.id)
        ? activeSession.threadId
        : null,
      projectExpansion: clone(selectedWorkspace ? getWorkspaceUi(selectedWorkspace.id).expandedProjectIds : {}),
      streamStatuses: clone(state.streamStatuses),
      relayStatuses: clone(state.relayStates),
    };
  }

  function getThreadContext(threadId) {
    var summary = getThread(threadId);
    var detail = state.threadDetails[threadId] || null;
    var project = summary && summary.projectId ? getProject(summary.projectId) : null;
    var workspace = project && project.workspaceId ? state.workspacesById[project.workspaceId] : null;
    var projection = detail ? buildThreadProjection(detail) : null;
    var threadRecord = detail
      ? Object.assign({}, detail, {
        messages: projection.displayMessages,
        displayMessages: projection.displayMessages,
        activityItems: projection.activityItems,
        runs: projection.runs,
        artifactDrawer: projection.artifactDrawer,
        preview: projection.preview,
        lastActivityAt: projection.lastActivityAt,
      })
      : summary;

    return {
      organization: clone(getSelectedOrganization()),
      workspace: clone(workspace),
      project: clone(project),
      thread: clone(threadRecord),
      loading: !!state.loadingThreadIds[threadId],
      pending: !!state.pendingThreadIds[threadId],
      error: state.threadErrors[threadId] || null,
      streamStatus: detail && detail.connection ? detail.connection.runtimeStatus || null : (state.streamStatuses[threadId] || null),
      relayStatus: state.relayStates[threadId] ? state.relayStates[threadId].status || null : null,
    };
  }

  function openSession(config, options) {
    if (!window.__companionUtils || typeof window.__companionUtils.openSession !== 'function') {
      return null;
    }
    return window.__companionUtils.openSession(config, options);
  }

  function replaceSession(sessionId, config, options) {
    if (!window.__companionUtils || typeof window.__companionUtils.replaceSession !== 'function') {
      return openSession(config, options);
    }
    return window.__companionUtils.replaceSession(sessionId, config, options);
  }

  function teardownThreadSession(threadId) {
    if (!threadId) return;

    if (window.__tribexAiClient && typeof window.__tribexAiClient.stopCompanionStream === 'function') {
      window.__tribexAiClient.stopCompanionStream(threadId).catch(function () {});
    }
    if (window.__tribexAiClient && typeof window.__tribexAiClient.stopDesktopRelayStream === 'function') {
      window.__tribexAiClient.stopDesktopRelayStream(threadId).catch(function () {});
    }
    if (window.__tribexAiClient && typeof window.__tribexAiClient.stopDesktopPresenceHeartbeat === 'function') {
      window.__tribexAiClient.stopDesktopPresenceHeartbeat(threadId).catch(function () {});
    }
    if (window.__tribexAiClient && typeof window.__tribexAiClient.disconnectRuntime === 'function') {
      window.__tribexAiClient.disconnectRuntime(threadId);
    }

    unbindRuntimeBridge(threadId);

    delete state.companionKeys[threadId];
    delete state.lastCompanionSequences[threadId];
    delete state.streamStatuses[threadId];
    delete state.relayStates[threadId];
  }

  function openThread(threadId, options) {
    var thread = getThread(threadId);
    if (!thread) return null;
    var connectStream = !(options && options.connectStream === false);
    var previousThreadId = activeSession && activeSession.isThread ? activeSession.threadId : null;
    state.selectedWorkspaceId = thread.workspaceId || state.selectedWorkspaceId;
    state.selectedProjectId = thread.projectId || state.selectedProjectId;
    rememberWorkspaceContext(thread.workspaceId, thread.projectId, thread.id);
    setProjectExpanded(thread.projectId, true);
    state.ui.navigatorVisible = true;
    state.ui.organizationMenuOpen = false;

    if (previousThreadId && previousThreadId !== threadId) {
      teardownThreadSession(previousThreadId);
    }

    bindRuntimeBridge(threadId);

    var config = {
      sessionKey: 'tribex-ai-thread-' + threadId,
      toolName: 'TribeX AI',
      contentType: 'tribex_ai_thread',
      data: { title: thread.title },
      meta: {
        aiView: 'thread',
        headerTitle: thread.title,
        projectId: thread.projectId,
        threadId: threadId,
      },
      toolArgs: {
        threadId: threadId,
      },
    };

    var sessionId = activeSession && activeSession.isThread
      ? replaceSession(activeSession.sessionId, config)
      : openSession(config);

    if (sessionId) {
      setActiveSession(sessionId, {
        meta: config.meta,
      });
    }

    refreshThread(threadId, connectStream);
    notify();
    return sessionId;
  }

  function createThread(title, options) {
    var threadTitle = String(title || 'New chat').trim() || 'New chat';
    var requestedProjectId = options && options.projectId ? options.projectId : null;
    if (requestedProjectId) {
      state.selectedProjectId = requestedProjectId;
      setProjectExpanded(requestedProjectId, true);
    }

    return ensureProjectForNewThread().then(function (targetProjectId) {
      if (!targetProjectId) {
        state.integration.error = 'No workspace project is available yet for this organization.';
        notify();
        return null;
      }

      state.integration.error = null;
      return window.__tribexAiClient.createThread(targetProjectId, threadTitle)
        .then(function (thread) {
          var project = getProject(targetProjectId);
          thread.projectId = thread.projectId || targetProjectId;
          thread.workspaceId = thread.workspaceId || (project && project.workspaceId) || null;
          thread.projectName = thread.projectName || (project && project.name) || null;
          thread.workspaceName = thread.workspaceName || (project && project.workspaceName) || null;
          state.selectedProjectId = thread.projectId || state.selectedProjectId;
          state.selectedWorkspaceId = thread.workspaceId || state.selectedWorkspaceId;
          rememberWorkspaceContext(thread.workspaceId, thread.projectId, thread.id);
          setProjectExpanded(thread.projectId, true);
          mergeThreadSummary(thread);
          openThread(thread.id);
          return thread.id;
        })
        .catch(function (error) {
          state.integration.error = error && error.message ? error.message : String(error);
          notify();
          throw error;
        });
    });
  }

  function runSmokeTest() {
    return ensureProjectForNewThread().then(function (targetProjectId) {
      if (!targetProjectId) {
        state.integration.error = 'No workspace project is available yet for this organization.';
        notify();
        return null;
      }

      var project = getProject(targetProjectId);
      var workspace = project && project.workspaceId ? state.workspacesById[project.workspaceId] : getSelectedWorkspace();
      if (!workspace || workspace.packageKey !== 'smoke') {
        state.integration.error = 'Smoke tests are only available in smoke validation workspaces.';
        notify();
        return null;
      }

      state.integration.error = null;
      return window.__tribexAiClient.createThread(targetProjectId, buildSmokeThreadTitle())
        .then(function (thread) {
          thread.projectId = thread.projectId || targetProjectId;
          thread.workspaceId = thread.workspaceId || workspace.id;
          thread.projectName = thread.projectName || (project && project.name) || null;
          thread.workspaceName = thread.workspaceName || workspace.name || null;
          mergeThreadSummary(thread);
          openThread(thread.id, { connectStream: false });
          notify();
          return ensureDesktopRelay(thread.id)
            .then(function () {
              var smokeKey = 'rule-skill-echo';
              var smokePrompt = window.__tribexAiClient && typeof window.__tribexAiClient.buildSmokePrompt === 'function'
                ? window.__tribexAiClient.buildSmokePrompt(smokeKey)
                : 'Please verify that the currently loaded rule and skill bundle is wired correctly for this workspace. Use the available validation tool to confirm the exact loaded rule and skill basenames, then summarize the result briefly for the operator.';

              return window.__tribexAiClient.sendMessage(thread.id, smokePrompt, {
                validationProfile: smokeKey,
              });
            })
            .then(function (result) {
              applySendResult(thread.id, result);
              return thread.id;
            });
        })
        .catch(function (error) {
          state.integration.error = error && error.message ? error.message : String(error);
          notify();
          throw error;
        });
    });
  }

  function submitPrompt(threadId, prompt) {
    var trimmed = String(prompt || '').trim();
    if (!trimmed) return Promise.resolve(false);
    var turnId = randomId('turn');

    state.pendingThreadIds[threadId] = true;
    state.threadErrors[threadId] = null;
    bindRuntimeBridge(threadId);
    queueLocalTurn(threadId, trimmed, turnId);
    notify();

    return ensureDesktopRelay(threadId)
      .then(function () {
        return window.__tribexAiClient.sendMessage(threadId, trimmed, {
          turnId: turnId,
        });
      })
      .then(function (turn) {
        applySendResult(threadId, turn);
        if (turn && turn.done && typeof turn.done.then === 'function') {
          turn.done.catch(function (error) {
            var message = error && error.message ? error.message : String(error);
            state.threadErrors[threadId] = message;
            delete state.pendingThreadIds[threadId];
            notify();
          });
        } else {
          delete state.pendingThreadIds[threadId];
          notify();
        }
        return true;
      })
      .catch(function (error) {
        state.threadErrors[threadId] = error && error.message ? error.message : String(error);
        delete state.pendingThreadIds[threadId];
        notify();
        return false;
      });
  }

  function setActiveSession(sessionId, session) {
    activeSession = {
      sessionId: sessionId,
      isThread: isThreadSession(session),
      projectId: session && session.meta ? session.meta.projectId || null : null,
      threadId: session && session.meta ? session.meta.threadId || null : null,
    };
    if (window.__companionUtils && typeof window.__companionUtils.setThreadArtifactContext === 'function') {
      window.__companionUtils.setThreadArtifactContext(
        sessionId,
        activeSession.isThread ? activeSession.threadId : null,
      );
    }
    if (activeSession.projectId) {
      var activeProject = getProject(activeSession.projectId);
      state.selectedProjectId = activeSession.projectId;
      if (activeProject && activeProject.workspaceId) {
        state.selectedWorkspaceId = activeProject.workspaceId;
        rememberWorkspaceContext(activeProject.workspaceId, activeSession.projectId, activeSession.threadId);
        setProjectExpanded(activeSession.projectId, true);
      }
    }
    if (activeSession.isThread && activeSession.threadId && state.threadDetails[activeSession.threadId]) {
      syncThreadArtifactDrawer(state.threadDetails[activeSession.threadId]);
    }
    notify();
  }

  function selectThreadArtifact(threadId, artifactKey) {
    if (!threadId || !artifactKey) return null;
    var detail = state.threadDetails[threadId];
    if (!detail) return null;
    detail.artifactDrawer = detail.artifactDrawer || {
      drawerId: 'tribex-ai-thread-artifacts:' + threadId,
      selectedArtifactKey: null,
    };
    detail.artifactDrawer.selectedArtifactKey = artifactKey;
    if (
      activeSession &&
      activeSession.isThread &&
      activeSession.threadId === threadId &&
      activeSession.sessionId &&
      window.__companionUtils &&
      typeof window.__companionUtils.selectThreadArtifact === 'function'
    ) {
      window.__companionUtils.selectThreadArtifact(activeSession.sessionId, threadId, artifactKey);
    }
    notify();
    return artifactKey;
  }

  function onSessionClosed(sessionId, session) {
    if (!sessionId || !session || !isThreadSession(session)) return;
    var threadId = session.meta && session.meta.threadId;
    teardownThreadSession(threadId);
  }

  function toggleNavigator() {
    state.ui.navigatorVisible = !state.ui.navigatorVisible;
    if (state.ui.navigatorVisible) {
      refreshNavigator(false);
    } else {
      state.ui.organizationMenuOpen = false;
    }
    notify();
  }

  function hideNavigator() {
    if (!state.ui.navigatorVisible) return;
    state.ui.navigatorVisible = false;
    state.ui.organizationMenuOpen = false;
    notify();
  }

  function toggleNavigatorCollapsed() {
    if (!state.ui.navigatorVisible) return;
    state.ui.navigatorCollapsed = !state.ui.navigatorCollapsed;
    state.ui.organizationMenuOpen = false;
    notify();
  }

  function setSearchTerm(value) {
    state.ui.searchTerm = value || '';
    notify();
  }

  function toggleOrganizationMenu() {
    if (!state.ui.navigatorVisible) return;
    state.ui.organizationMenuOpen = !state.ui.organizationMenuOpen;
    notify();
  }

  function selectOrganization(organizationId) {
    if (!organizationId || organizationId === state.selectedOrganizationId) {
      state.ui.organizationMenuOpen = false;
      notify();
      return Promise.resolve();
    }
    state.selectedOrganizationId = organizationId;
    state.ui.organizationMenuOpen = false;
    notify();
    return refreshNavigator(true);
  }

  function selectWorkspace(workspaceId) {
    if (!workspaceId || workspaceId === state.selectedWorkspaceId) {
      return Promise.resolve();
    }

    rememberWorkspaceContext(
      state.selectedWorkspaceId,
      state.selectedProjectId,
      activeSession && activeSession.threadId ? activeSession.threadId : null,
    );
    state.selectedWorkspaceId = workspaceId;
    state.selectedProjectId = null;
    state.projects = [];
    state.threads = [];
    state.ui.organizationMenuOpen = false;
    notify();
    return refreshNavigator(true).then(function () {
      return restoreWorkspaceContext(workspaceId);
    });
  }

  function selectProject(projectId, options) {
    if (!projectId || projectId === state.selectedProjectId) {
      if (options && options.expand) {
        setProjectExpanded(projectId, true);
        notify();
      }
      return Promise.resolve();
    }

    var project = getProject(projectId);
    if (!project) return Promise.resolve();
    state.selectedProjectId = projectId;
    if (project.workspaceId) state.selectedWorkspaceId = project.workspaceId;
    rememberWorkspaceContext(project.workspaceId, projectId, activeSession && activeSession.threadId ? activeSession.threadId : null);
    if (!options || options.expand !== false) setProjectExpanded(projectId, true);
    notify();
    return Promise.resolve();
  }

  function openWorkspaceComposer() {
    state.ui.workspaceComposerOpen = true;
    state.ui.projectComposerOpen = false;
    state.composer.workspaceName = '';
    state.composer.workspacePackageKey = state.composer.workspacePackageKey || (state.packages[0] && state.packages[0].key) || '';
    state.integration.error = null;
    notify();
  }

  function closeWorkspaceComposer() {
    state.ui.workspaceComposerOpen = false;
    state.composer.workspaceName = '';
    state.composer.creatingWorkspace = false;
    state.integration.error = null;
    notify();
  }

  function setWorkspaceDraftName(value) {
    state.composer.workspaceName = value || '';
    notify();
  }

  function setWorkspaceDraftPackageKey(value) {
    state.composer.workspacePackageKey = value || '';
    notify();
  }

  function createWorkspace() {
    var organization = getSelectedOrganization();
    var name = String(state.composer.workspaceName || '').trim();
    if (!organization) return Promise.reject(new Error('Select an organization before creating a workspace.'));
    if (!name) return Promise.reject(new Error('Enter a workspace name.'));

    state.composer.creatingWorkspace = true;
    state.integration.error = null;
    notify();

    return window.__tribexAiClient.createWorkspace(
      organization.id,
      name,
      state.composer.workspacePackageKey || undefined,
    ).then(function (workspace) {
      state.workspacesById[workspace.id] = workspace;
      state.selectedWorkspaceId = workspace.id;
      state.selectedProjectId = null;
      state.ui.workspaceComposerOpen = false;
      state.composer.workspaceName = '';
      return refreshNavigator(true).then(function () {
        return workspace;
      });
    }).catch(function (error) {
      state.integration.error = error && error.message ? error.message : String(error);
      throw error;
    }).finally(function () {
      state.composer.creatingWorkspace = false;
      notify();
    });
  }

  function openProjectComposer() {
    state.ui.projectComposerOpen = true;
    state.ui.workspaceComposerOpen = false;
    state.composer.projectName = '';
    state.integration.error = null;
    notify();
  }

  function closeProjectComposer() {
    state.ui.projectComposerOpen = false;
    state.composer.projectName = '';
    state.composer.creatingProject = false;
    state.integration.error = null;
    notify();
  }

  function setProjectDraftName(value) {
    state.composer.projectName = value || '';
    notify();
  }

  function createProject() {
    var workspace = getSelectedWorkspace();
    var name = String(state.composer.projectName || '').trim() || 'General';
    if (!workspace) return Promise.reject(new Error('Select a workspace before creating a project.'));

    state.composer.creatingProject = true;
    state.integration.error = null;
    notify();

    return window.__tribexAiClient.createProject(workspace, name).then(function (project) {
      state.projects.push(project);
      state.selectedProjectId = project.id;
      rememberWorkspaceContext(project.workspaceId, project.id, null);
      setProjectExpanded(project.id, true);
      state.ui.projectComposerOpen = false;
      state.composer.projectName = '';
      notify();
      return project;
    }).catch(function (error) {
      state.integration.error = error && error.message ? error.message : String(error);
      throw error;
    }).finally(function () {
      state.composer.creatingProject = false;
      notify();
    });
  }

  function connect() {
    return sendMagicLink().then(function () {
      return true;
    });
  }

  function sendMagicLink() {
    var email = String(state.integration.authEmail || '').trim();
    if (!email) return Promise.reject(new Error('Enter your work email to send a magic link.'));

    state.integration.error = null;
    state.integration.sendingMagicLink = true;
    notify();

    return window.__tribexAiClient.sendMagicLink(email).then(function () {
      state.integration.status = 'awaiting_verification';
      state.integration.magicLinkSentTo = email;
      state.integration.verificationInput = '';
      state.integration.error = null;
    }).catch(function (error) {
      state.integration.error = error && error.message ? error.message : String(error);
      throw error;
    }).finally(function () {
      state.integration.sendingMagicLink = false;
      notify();
    });
  }

  function verifyMagicLink() {
    var verificationInput = String(state.integration.verificationInput || '').trim();
    if (!verificationInput) return Promise.reject(new Error('Paste the magic link URL or token to finish sign-in.'));

    state.integration.error = null;
    state.integration.verifyingMagicLink = true;
    notify();

    return window.__tribexAiClient.verifyMagicLink(verificationInput).then(function (session) {
      state.integration.session = session;
      state.integration.status = session ? 'authenticated' : 'unauthenticated';
      state.integration.verificationInput = '';
      state.integration.error = null;
      return refreshNavigator(true);
    }).catch(function (error) {
      state.integration.error = error && error.message ? error.message : String(error);
      throw error;
    }).finally(function () {
      state.integration.verifyingMagicLink = false;
      notify();
    });
  }

  function clearConnection() {
    return window.__tribexAiClient.clearAuth().then(function () {
      Object.keys(runtimeEventUnsubscribers).forEach(function (threadId) {
        unbindRuntimeBridge(threadId);
      });
      state.integration.session = null;
      state.integration.status = 'unauthenticated';
      state.integration.error = null;
      state.integration.authEmail = '';
      state.integration.verificationInput = '';
      state.integration.magicLinkSentTo = null;
      state.packages = [];
      state.organizations = [];
      state.ui.workspaceComposerOpen = false;
      state.ui.projectComposerOpen = false;
      state.workspacesById = {};
      state.workspaceUiById = {};
      state.selectedWorkspaceId = null;
      state.projects = [];
      state.selectedProjectId = null;
      state.threads = [];
      state.threadDetails = {};
      state.relayStates = {};
      state.companionKeys = {};
      state.lastCompanionSequences = {};
      state.streamStatuses = {};
      state.composer.workspaceName = '';
      state.composer.workspacePackageKey = '';
      state.composer.creatingWorkspace = false;
      state.composer.projectName = '';
      state.composer.creatingProject = false;
      notify();
    });
  }

  function setAuthEmail(value) {
    state.integration.authEmail = value || '';
    notify();
  }

  function setVerificationInput(value) {
    state.integration.verificationInput = value || '';
    notify();
  }

  function refreshActiveThread() {
    if (!activeSession || !activeSession.threadId) return Promise.resolve(null);
    return refreshThread(activeSession.threadId, true);
  }

  window.__tribexAiState = {
    clearConnection: clearConnection,
    connect: connect,
    createProject: createProject,
    createThread: createThread,
    createWorkspace: createWorkspace,
    getSnapshot: getSnapshot,
    getThread: function (threadId) { return clone(getThread(threadId)); },
    getThreadContext: getThreadContext,
    getThreadsForProject: function (projectId) {
      return clone(window.__tribexAiUtils.sortThreads(state.threads.filter(function (thread) {
        return thread.projectId === projectId;
      })));
    },
    hideNavigator: hideNavigator,
    onSessionClosed: onSessionClosed,
    openProjectComposer: openProjectComposer,
    openThread: openThread,
    openWorkspaceComposer: openWorkspaceComposer,
    refreshActiveThread: refreshActiveThread,
    refreshNavigator: refreshNavigator,
    runSmokeTest: runSmokeTest,
    sendMagicLink: sendMagicLink,
    selectOrganization: selectOrganization,
    selectProject: selectProject,
    selectThreadArtifact: selectThreadArtifact,
    selectWorkspace: selectWorkspace,
    setActiveSession: setActiveSession,
    setAuthEmail: setAuthEmail,
    setProjectDraftName: setProjectDraftName,
    setSearchTerm: setSearchTerm,
    setVerificationInput: setVerificationInput,
    setWorkspaceDraftName: setWorkspaceDraftName,
    setWorkspaceDraftPackageKey: setWorkspaceDraftPackageKey,
    submitPrompt: submitPrompt,
    subscribe: subscribe,
    toggleProjectExpanded: toggleProjectExpanded,
    closeProjectComposer: closeProjectComposer,
    closeWorkspaceComposer: closeWorkspaceComposer,
    toggleNavigator: toggleNavigator,
    toggleNavigatorCollapsed: toggleNavigatorCollapsed,
    toggleOrganizationMenu: toggleOrganizationMenu,
    verifyMagicLink: verifyMagicLink,
  };
})();
