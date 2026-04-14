// @ts-nocheck
/* TribeX AI state — live first-party navigator and thread state */

(function () {
  'use strict';

  var listeners = [];
  var streamListenerBound = false;
  var navigatorLoad = null;
  var activeSession = null;
  var projectBootstrap = null;

  var state = {
    ui: {
      navigatorVisible: false,
      navigatorCollapsed: false,
      searchTerm: '',
      organizationMenuOpen: false,
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
    organizations: [],
    selectedOrganizationId: null,
    workspacesById: {},
    projects: [],
    threads: [],
    threadDetails: {},
    threadErrors: {},
    loadingNavigator: false,
    loadingThreadIds: {},
    pendingThreadIds: {},
    companionKeys: {},
    streamStatuses: {},
    activeProjectId: null,
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

  function resolveActiveProjectId() {
    if (activeSession && activeSession.projectId) return activeSession.projectId;
    if (state.activeProjectId) return state.activeProjectId;
    return state.projects[0] ? state.projects[0].id : null;
  }

  function resolvePreferredWorkspace() {
    var activeProjectId = resolveActiveProjectId();
    var activeProject = activeProjectId ? getProject(activeProjectId) : null;
    if (activeProject && activeProject.workspaceId && state.workspacesById[activeProject.workspaceId]) {
      return state.workspacesById[activeProject.workspaceId];
    }

    var selectedOrganization = getSelectedOrganization();
    var workspaceIds = Object.keys(state.workspacesById);
    for (var i = 0; i < workspaceIds.length; i++) {
      var workspace = state.workspacesById[workspaceIds[i]];
      if (!selectedOrganization || workspace.organizationId === selectedOrganization.id) {
        return workspace;
      }
    }

    return workspaceIds[0] ? state.workspacesById[workspaceIds[0]] : null;
  }

  function ensureProjectForNewThread() {
    var existingProjectId = resolveActiveProjectId();
    if (existingProjectId) return Promise.resolve(existingProjectId);

    var workspace = resolvePreferredWorkspace();
    if (!workspace || !window.__tribexAiClient || typeof window.__tribexAiClient.createProject !== 'function') {
      return Promise.resolve(null);
    }

    if (projectBootstrap) return projectBootstrap;

    projectBootstrap = window.__tribexAiClient.createProject(workspace, 'General')
      .then(function (project) {
        if (!project || !project.id) return null;
        state.projects.push(project);
        state.activeProjectId = project.id;
        notify();
        return project.id;
      })
      .finally(function () {
        projectBootstrap = null;
      });

    return projectBootstrap;
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

  function mergeThreadSummary(summary) {
    var next = Object.assign({}, getThread(summary.id) || {}, summary);
    var replaced = false;
    state.threads = state.threads.map(function (thread) {
      if (thread.id !== next.id) return thread;
      replaced = true;
      return next;
    });
    if (!replaced) state.threads.push(next);
    return next;
  }

  function mergeThreadDetail(detail) {
    if (!detail || !detail.id) return null;
    var summary = mergeThreadSummary({
      id: detail.id,
      projectId: detail.projectId,
      workspaceId: detail.workspaceId,
      title: detail.title,
      preview: detail.preview,
      hydrateState: detail.hydrateState || detail.status,
      lastActivityAt: detail.lastActivityAt,
    });
    state.threadDetails[detail.id] = Object.assign({}, summary, state.threadDetails[detail.id] || {}, detail);
    return state.threadDetails[detail.id];
  }

  function addOptimisticUserMessage(threadId, prompt) {
    var detail = state.threadDetails[threadId] || mergeThreadDetail({
      id: threadId,
      title: getThread(threadId) && getThread(threadId).title,
      messages: [],
    });
    detail.messages = detail.messages || [];
    detail.messages.push({
      id: 'local-user-' + Date.now(),
      role: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
    });
    detail.lastActivityAt = new Date().toISOString();
    mergeThreadSummary({
      id: threadId,
      title: detail.title,
      projectId: detail.projectId,
      workspaceId: detail.workspaceId,
      preview: prompt,
      lastActivityAt: detail.lastActivityAt,
    });
  }

  function addSystemMessage(threadId, message) {
    var detail = state.threadDetails[threadId] || mergeThreadDetail({
      id: threadId,
      title: getThread(threadId) && getThread(threadId).title,
      messages: [],
    });
    detail.messages = detail.messages || [];
    detail.messages.push({
      id: 'local-system-' + Date.now(),
      role: 'tool',
      toolName: 'companion',
      status: 'blocked',
      summary: message,
      detail: '',
      createdAt: new Date().toISOString(),
    });
  }

  function postPushPreview(payload) {
    return fetch('http://localhost:4200/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(function () {});
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
    if (
      payload.toolName &&
      payload.result &&
      window.__tribexAiClient &&
      typeof window.__tribexAiClient.shouldPreviewCompanionPayload === 'function' &&
      window.__tribexAiClient.shouldPreviewCompanionPayload(payload)
    ) {
      postPushPreview(payload);
    }

    if (payload.thread || payload.messages || payload.events || payload.transcript) {
      var detail = window.__tribexAiClient.normalizeThreadDetail(payload);
      if (detail && detail.id) {
        mergeThreadDetail(detail);
        state.threadErrors[event.threadId] = null;
        notify();
        return;
      }
    }

    if (payload.message || payload.content || payload.delta || payload.toolName) {
      var detailForAppend = state.threadDetails[event.threadId] || mergeThreadDetail({
        id: event.threadId,
        title: getThread(event.threadId) && getThread(event.threadId).title,
        messages: [],
      });
      var normalizedMessage = window.__tribexAiClient.normalizeMessage(payload, detailForAppend.messages.length);
      if (!normalizedMessage) {
        return;
      }
      detailForAppend.messages = detailForAppend.messages || [];
      detailForAppend.messages.push(normalizedMessage);
      detailForAppend.lastActivityAt = new Date().toISOString();
      notify();
      return;
    }

    refreshThread(event.threadId, false);
  }

  function refreshNavigator(force) {
    if (navigatorLoad && !force) return navigatorLoad;
    bindStreamListener();

    state.loadingNavigator = true;
    state.integration.error = null;
    notify();

    navigatorLoad = window.__tribexAiClient.getConfig()
      .then(function (config) {
        state.integration.config = config;
        if (!config || !config.configured) {
          state.integration.status = 'misconfigured';
          state.integration.session = null;
          state.organizations = [];
          state.projects = [];
          state.threads = [];
          return null;
        }
        return window.__tribexAiClient.fetchSession();
      })
      .then(function (session) {
        if (session === null) {
          state.integration.session = null;
          state.integration.status = 'unauthenticated';
          state.organizations = [];
          state.projects = [];
          state.threads = [];
          return null;
        }

        if (session) {
          state.integration.session = session;
          state.integration.status = 'authenticated';
        }

        return window.__tribexAiClient.fetchOrganizations();
      })
      .then(function (organizations) {
        if (!organizations) return null;
        state.organizations = organizations;
        state.selectedOrganizationId = state.selectedOrganizationId && organizations.some(function (organization) {
          return organization.id === state.selectedOrganizationId;
        }) ? state.selectedOrganizationId : (organizations[0] && organizations[0].id) || null;

        if (!state.selectedOrganizationId) {
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
        });

        return Promise.all(workspaces.map(function (workspace) {
          return window.__tribexAiClient.fetchProjects(workspace);
        }));
      })
      .then(function (projectLists) {
        if (!projectLists) return null;
        state.projects = [].concat.apply([], projectLists || []);
        state.activeProjectId = resolveActiveProjectId();

        return Promise.all(state.projects.map(function (project) {
          return window.__tribexAiClient.fetchThreads(project).catch(function () {
            return [];
          });
        }));
      })
      .then(function (threadLists) {
        if (!threadLists) return null;
        state.threads = [].concat.apply([], threadLists || []);
        if (!state.activeProjectId && state.projects[0]) state.activeProjectId = state.projects[0].id;
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

  function refreshThread(threadId, connectStream) {
    if (!threadId) return Promise.resolve(null);
    state.loadingThreadIds[threadId] = true;
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
          if (connectStream !== false) return ensureCompanion(threadId).then(function () { return detail; });
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
    return {
      integration: clone(state.integration),
      loadingNavigator: state.loadingNavigator,
      navigatorVisible: state.ui.navigatorVisible,
      navigatorCollapsed: state.ui.navigatorCollapsed,
      organizationMenuOpen: state.ui.organizationMenuOpen,
      searchTerm: state.ui.searchTerm,
      organizations: clone(state.organizations),
      selectedOrganization: clone(selectedOrganization),
      projectGroups: clone(window.__tribexAiUtils.buildProjectGroups(
        state.projects,
        state.threads,
        resolveActiveProjectId(),
        state.ui.searchTerm,
      )),
      hasProjects: state.projects.length > 0,
      activeProjectId: resolveActiveProjectId(),
      activeThreadId: activeSession && activeSession.threadId ? activeSession.threadId : null,
      streamStatuses: clone(state.streamStatuses),
    };
  }

  function getThreadContext(threadId) {
    var summary = getThread(threadId);
    var detail = state.threadDetails[threadId] || null;
    var project = summary && summary.projectId ? getProject(summary.projectId) : null;
    var workspace = project && project.workspaceId ? state.workspacesById[project.workspaceId] : null;

    return {
      organization: clone(getSelectedOrganization()),
      workspace: clone(workspace),
      project: clone(project),
      thread: clone(detail || summary),
      loading: !!state.loadingThreadIds[threadId],
      pending: !!state.pendingThreadIds[threadId],
      error: state.threadErrors[threadId] || null,
      streamStatus: state.streamStatuses[threadId] || null,
    };
  }

  function openSession(config) {
    if (!window.__companionUtils || typeof window.__companionUtils.openSession !== 'function') {
      return null;
    }
    return window.__companionUtils.openSession(config);
  }

  function replaceSession(sessionId, config) {
    if (!window.__companionUtils || typeof window.__companionUtils.replaceSession !== 'function') {
      return openSession(config);
    }
    return window.__companionUtils.replaceSession(sessionId, config);
  }

  function openThread(threadId) {
    var thread = getThread(threadId);
    if (!thread) return null;
    state.activeProjectId = thread.projectId || state.activeProjectId;
    state.ui.navigatorVisible = true;
    state.ui.organizationMenuOpen = false;

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

    refreshThread(threadId, true);
    notify();
    return sessionId;
  }

  function createThread() {
    return ensureProjectForNewThread().then(function (targetProjectId) {
      if (!targetProjectId) {
        state.integration.error = 'No workspace project is available yet for this organization.';
        notify();
        return null;
      }

      state.integration.error = null;
      return window.__tribexAiClient.createThread(targetProjectId)
        .then(function (thread) {
          var project = getProject(targetProjectId);
          thread.projectId = thread.projectId || targetProjectId;
          thread.workspaceId = thread.workspaceId || (project && project.workspaceId) || null;
          thread.projectName = thread.projectName || (project && project.name) || null;
          thread.workspaceName = thread.workspaceName || (project && project.workspaceName) || null;
          mergeThreadSummary(thread);
          notify();
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

  function submitPrompt(threadId, prompt) {
    var trimmed = String(prompt || '').trim();
    if (!trimmed) return Promise.resolve(false);

    state.pendingThreadIds[threadId] = true;
    state.threadErrors[threadId] = null;
    addOptimisticUserMessage(threadId, trimmed);
    notify();

    return ensureCompanion(threadId)
      .then(function () {
        return window.__tribexAiClient.sendMessage(threadId, trimmed);
      })
      .then(function (raw) {
        if (raw && (raw.thread || raw.messages || raw.events || raw.transcript || raw.id)) {
          mergeThreadDetail(window.__tribexAiClient.normalizeThreadDetail(raw));
        }
        return pollThread(threadId, 3).then(function () {
          return true;
        });
      })
      .catch(function (error) {
        state.threadErrors[threadId] = error && error.message ? error.message : String(error);
        addSystemMessage(threadId, state.threadErrors[threadId]);
        return false;
      })
      .finally(function () {
        delete state.pendingThreadIds[threadId];
        notify();
      });
  }

  function setActiveSession(sessionId, session) {
    activeSession = {
      sessionId: sessionId,
      isThread: isThreadSession(session),
      projectId: session && session.meta ? session.meta.projectId || null : null,
      threadId: session && session.meta ? session.meta.threadId || null : null,
    };
    if (activeSession.projectId) state.activeProjectId = activeSession.projectId;
    notify();
  }

  function onSessionClosed(sessionId, session) {
    if (!sessionId || !session || !isThreadSession(session)) return;
    var threadId = session.meta && session.meta.threadId;
    if (threadId) {
      window.__tribexAiClient.stopCompanionStream(threadId).catch(function () {});
      delete state.companionKeys[threadId];
      delete state.streamStatuses[threadId];
    }
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
      state.integration.session = null;
      state.integration.status = 'unauthenticated';
      state.integration.error = null;
      state.integration.authEmail = '';
      state.integration.verificationInput = '';
      state.integration.magicLinkSentTo = null;
      state.organizations = [];
      state.projects = [];
      state.threads = [];
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
    createThread: createThread,
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
    openThread: openThread,
    refreshActiveThread: refreshActiveThread,
    refreshNavigator: refreshNavigator,
    sendMagicLink: sendMagicLink,
    selectOrganization: selectOrganization,
    setActiveSession: setActiveSession,
    setAuthEmail: setAuthEmail,
    setSearchTerm: setSearchTerm,
    setVerificationInput: setVerificationInput,
    submitPrompt: submitPrompt,
    subscribe: subscribe,
    toggleNavigator: toggleNavigator,
    toggleNavigatorCollapsed: toggleNavigatorCollapsed,
    toggleOrganizationMenu: toggleOrganizationMenu,
    verifyMagicLink: verifyMagicLink,
  };
})();
