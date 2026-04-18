(function () {
  'use strict';

  window.__createTribexAiStateCore = function __createTribexAiStateCore(context, api) {
    var state = context.state;

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function notify() {
      var snapshot = typeof api.getSnapshot === 'function' ? api.getSnapshot() : null;
      context.listeners.slice().forEach(function (listener) {
        listener(snapshot);
      });
      if (
        context.activeSession &&
        context.activeSession.isThread &&
        window.__companionUtils &&
        typeof window.__companionUtils.rerenderActiveSession === 'function'
      ) {
        window.__companionUtils.rerenderActiveSession();
      } else if (
        context.activeSession &&
        context.activeSession.isThread &&
        window.__companionUtils &&
        typeof window.__companionUtils.refreshActiveSession === 'function'
      ) {
        window.__companionUtils.refreshActiveSession();
      }
    }

    function subscribe(listener) {
      context.listeners.push(listener);
      return function unsubscribe() {
        context.listeners = context.listeners.filter(function (candidate) {
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

    function mergeProject(project) {
      if (!project || !project.id) return null;
      var next = Object.assign({}, getProject(project.id) || {});
      Object.keys(project || {}).forEach(function (key) {
        var value = project[key];
        if (value === undefined || value === null) return;
        next[key] = value;
      });

      var replaced = false;
      state.projects = state.projects.map(function (candidate) {
        if (!candidate || candidate.id !== next.id) return candidate;
        replaced = true;
        return next;
      });

      if (!replaced) {
        state.projects = state.projects.concat([next]);
      }

      return next;
    }

    function getAllThreads() {
      return Object.keys(state.threadEntitiesById).map(function (threadId) {
        return state.threadEntitiesById[threadId];
      }).filter(Boolean);
    }

    function getThread(threadId) {
      return threadId ? state.threadEntitiesById[threadId] || null : null;
    }

    function getOrganizationProjects(organizationId) {
      return state.projects.filter(function (project) {
        return !organizationId || project.organizationId === organizationId;
      });
    }

    function getWorkspaceProjects(workspaceId) {
      return state.projects.filter(function (project) {
        return project.workspaceId === workspaceId;
      });
    }

    function ensureOrganizationUi(organizationId) {
      if (!organizationId) return null;
      if (!state.organizationUiById[organizationId]) {
        state.organizationUiById[organizationId] = {
          lastProjectId: null,
          lastThreadId: null,
          preferredWorkspaceId: null,
          expandedProjectIds: {},
        };
      }
      return state.organizationUiById[organizationId];
    }

    function getOrganizationUi(organizationId) {
      return organizationId ? ensureOrganizationUi(organizationId) : null;
    }

    function ensureThreadUi(threadId) {
      var thread = getThread(threadId);
      if (!thread) return null;
      thread.ui = thread.ui || {
        draftText: '',
        scrollTop: null,
        wasNearBottom: true,
        selectedArtifactKey: null,
        workSessionOpen: {},
        lastViewedAt: null,
      };
      return thread.ui;
    }

    function getThreadUi(threadId) {
      var thread = getThread(threadId);
      return thread && thread.ui ? thread.ui : ensureThreadUi(threadId);
    }

    function getSelectedWorkspace() {
      if (state.selectedWorkspaceId && state.workspacesById[state.selectedWorkspaceId]) {
        return state.workspacesById[state.selectedWorkspaceId];
      }

      var selectedOrganization = getSelectedOrganization();
      var orgUi = selectedOrganization ? getOrganizationUi(selectedOrganization.id) : null;
      if (orgUi && orgUi.preferredWorkspaceId && state.workspacesById[orgUi.preferredWorkspaceId]) {
        return state.workspacesById[orgUi.preferredWorkspaceId];
      }

      var workspaceIds = Object.keys(state.workspacesById).filter(function (workspaceId) {
        var workspace = state.workspacesById[workspaceId];
        return !selectedOrganization || workspace.organizationId === selectedOrganization.id;
      });

      return workspaceIds[0] ? state.workspacesById[workspaceIds[0]] : null;
    }

    function getSelectedProject() {
      var selectedOrganization = getSelectedOrganization();
      var organizationId = selectedOrganization ? selectedOrganization.id : null;
      var organizationProjects = getOrganizationProjects(organizationId);
      var orgUi = getOrganizationUi(organizationId);

      if (orgUi && orgUi.lastProjectId) {
        var rememberedProject = getProject(orgUi.lastProjectId);
        if (rememberedProject && rememberedProject.organizationId === organizationId) {
          return rememberedProject;
        }
      }

      if (state.selectedProjectId) {
        var selectedProject = getProject(state.selectedProjectId);
        if (selectedProject && selectedProject.organizationId === organizationId) {
          return selectedProject;
        }
      }

      if (context.activeSession && context.activeSession.projectId) {
        var activeProject = getProject(context.activeSession.projectId);
        if (activeProject && activeProject.organizationId === organizationId) {
          return activeProject;
        }
      }

      return organizationProjects[0] || null;
    }

    function rememberOrganizationContext(organizationId, projectId, threadId, workspaceId) {
      var organizationUi = getOrganizationUi(organizationId);
      if (!organizationUi) return;
      if (projectId) organizationUi.lastProjectId = projectId;
      if (threadId) organizationUi.lastThreadId = threadId;
      if (workspaceId) organizationUi.preferredWorkspaceId = workspaceId;
    }

    function isProjectExpanded(projectId) {
      var project = getProject(projectId);
      if (!project || !project.organizationId) return false;
      var organizationUi = getOrganizationUi(project.organizationId);
      if (!organizationUi) return false;
      if (Object.prototype.hasOwnProperty.call(organizationUi.expandedProjectIds, projectId)) {
        return organizationUi.expandedProjectIds[projectId] !== false;
      }
      return resolveSelectedProjectId() === projectId;
    }

    function setProjectExpanded(projectId, expanded) {
      var project = getProject(projectId);
      if (!project || !project.organizationId) return;
      var organizationUi = getOrganizationUi(project.organizationId);
      if (!organizationUi) return;
      organizationUi.expandedProjectIds[projectId] = expanded !== false;
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
      return getSelectedWorkspace();
    }

    function ensureProjectForNewThread() {
      var existingProjectId = resolveSelectedProjectId();
      if (existingProjectId) return Promise.resolve(existingProjectId);

      var workspace = getSelectedWorkspace();
      if (!workspace || !window.__tribexAiClient || typeof window.__tribexAiClient.createProject !== 'function') {
        return Promise.resolve(null);
      }

      if (context.projectBootstrap) return context.projectBootstrap;

      context.projectBootstrap = window.__tribexAiClient.createProject(workspace, 'General')
        .then(function (project) {
          if (!project || !project.id) return null;
          state.projects = state.projects
            .filter(function (candidate) { return candidate.id !== project.id; })
            .concat([project]);
          state.selectedProjectId = project.id;
          state.selectedWorkspaceId = project.workspaceId || state.selectedWorkspaceId;
          rememberOrganizationContext(
            project.organizationId,
            project.id,
            null,
            project.workspaceId || null
          );
          setProjectExpanded(project.id, true);
          notify();
          return project.id;
        })
        .finally(function () {
          context.projectBootstrap = null;
        });

      return context.projectBootstrap;
    }

    function restoreOrganizationContext(organizationId) {
      var organizationUi = getOrganizationUi(organizationId);
      var organizationProjects = getOrganizationProjects(organizationId);
      if (!organizationProjects.length) {
        state.selectedProjectId = null;
        notify();
        return Promise.resolve(null);
      }

      var targetProjectId = organizationUi && organizationUi.lastProjectId && getProject(organizationUi.lastProjectId)
        ? organizationUi.lastProjectId
        : organizationProjects[0].id;
      state.selectedProjectId = targetProjectId;

      var targetProject = getProject(targetProjectId);
      if (targetProject && targetProject.workspaceId) {
        state.selectedWorkspaceId = targetProject.workspaceId;
      }
      setProjectExpanded(targetProjectId, true);
      notify();

      if (!organizationUi || !organizationUi.lastThreadId) return Promise.resolve(null);
      var rememberedThread = getThread(organizationUi.lastThreadId);
      if (!rememberedThread || rememberedThread.organizationId !== organizationId) return Promise.resolve(null);
      if (context.activeSession && context.activeSession.threadId === rememberedThread.id) return Promise.resolve(rememberedThread.id);
      api.openThread(rememberedThread.id, { connectStream: false });
      return Promise.resolve(rememberedThread.id);
    }

    function isThreadSession(session) {
      return !!(session && session.meta && session.meta.aiView === 'thread');
    }

    function mergeThreadSummary(summary) {
      if (!summary || !summary.id) return null;
      var next = Object.assign({}, getThread(summary.id) || {});
      Object.keys(summary || {}).forEach(function (key) {
        var value = summary[key];
        if (value === undefined || value === null) return;
        next[key] = value;
      });
      if (!next.ui) {
        next.ui = {
          draftText: '',
          scrollTop: null,
          wasNearBottom: true,
          selectedArtifactKey: null,
          workSessionOpen: {},
          lastViewedAt: null,
        };
      }
      state.threadEntitiesById[next.id] = next;
      state.threadDetails = state.threadEntitiesById;
      return next;
    }

    function replaceThreadSummaries(threads, organizationId) {
      var nextIds = {};
      (threads || []).forEach(function (thread) {
        var merged = mergeThreadSummary(thread);
        if (merged && merged.id) {
          nextIds[merged.id] = true;
        }
      });

      Object.keys(state.threadEntitiesById).forEach(function (threadId) {
        var thread = state.threadEntitiesById[threadId];
        if (!thread || thread.organizationId !== organizationId) return;
        if (thread.optimistic) return;
        if (!nextIds[threadId]) {
          delete state.threadEntitiesById[threadId];
        }
      });
      state.threadDetails = state.threadEntitiesById;
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

    function toggleNavigator() {
      state.ui.navigatorVisible = !state.ui.navigatorVisible;
      if (state.ui.navigatorVisible) {
        api.refreshNavigator(false);
      }
      notify();
    }

    function hideNavigator() {
      if (!state.ui.navigatorVisible) return;
      state.ui.navigatorVisible = false;
      notify();
    }

    function toggleNavigatorCollapsed() {
      if (!state.ui.navigatorVisible) return;
      state.ui.navigatorCollapsed = !state.ui.navigatorCollapsed;
      notify();
    }

    function setSearchTerm(value) {
      state.ui.searchTerm = value || '';
      notify();
    }

    function selectOrganization(organizationId) {
      if (!organizationId || organizationId === state.selectedOrganizationId) {
        notify();
        return Promise.resolve();
      }
      var currentThreadId = context.activeSession && context.activeSession.threadId ? context.activeSession.threadId : null;
      var currentProjectId = state.selectedProjectId;
      var currentOrganization = getSelectedOrganization();
      if (currentOrganization) {
        var currentProject = currentProjectId ? getProject(currentProjectId) : null;
        rememberOrganizationContext(
          currentOrganization.id,
          currentProjectId,
          currentThreadId,
          currentProject && currentProject.workspaceId ? currentProject.workspaceId : state.selectedWorkspaceId
        );
      }
      state.selectedOrganizationId = organizationId;
      notify();
      return api.refreshNavigator(true).then(function () {
        return restoreOrganizationContext(organizationId);
      });
    }

    function selectWorkspace(workspaceId) {
      state.selectedWorkspaceId = workspaceId || null;
      notify();
      return Promise.resolve();
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
      rememberOrganizationContext(
        project.organizationId,
        projectId,
        context.activeSession && context.activeSession.threadId ? context.activeSession.threadId : null,
        project.workspaceId || null
      );
      if (!options || options.expand !== false) setProjectExpanded(projectId, true);
      notify();
      return Promise.resolve();
    }

    function openProjectComposer() {
      state.ui.projectComposerOpen = true;
      state.ui.projectRenameOpen = false;
      state.ui.threadComposerOpen = false;
      state.ui.threadRenameOpen = false;
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

    function openProjectRename(projectId) {
      var targetProjectId = projectId || resolveSelectedProjectId();
      var project = getProject(targetProjectId);
      if (!project) return Promise.resolve(null);

      state.ui.projectRenameOpen = true;
      state.ui.projectComposerOpen = false;
      state.ui.threadComposerOpen = false;
      state.ui.threadRenameOpen = false;
      state.composer.projectRenameId = project.id;
      state.composer.projectRenameName = project.name || '';
      state.integration.error = null;
      notify();
      return Promise.resolve(project.id);
    }

    function closeProjectRename() {
      state.ui.projectRenameOpen = false;
      state.composer.projectRenameId = null;
      state.composer.projectRenameName = '';
      state.composer.renamingProject = false;
      state.integration.error = null;
      notify();
    }

    function setProjectRenameName(value) {
      state.composer.projectRenameName = value || '';
      notify();
    }

    function openThreadComposer(options) {
      var targetProjectId = options && options.projectId ? options.projectId : resolveSelectedProjectId();
      if (!targetProjectId) return Promise.resolve(null);

      var project = getProject(targetProjectId);
      if (!project) return Promise.resolve(null);

      state.ui.threadComposerOpen = true;
      state.ui.projectComposerOpen = false;
      state.ui.projectRenameOpen = false;
      state.ui.threadRenameOpen = false;
      state.composer.threadProjectId = targetProjectId;
      state.composer.threadTitle = state.composer.threadTitle || 'New chat';
      state.composer.threadPersonaError = null;
      state.composer.loadingThreadPersonas = true;
      notify();

      return api.loadThreadPersonas(targetProjectId).then(function (personas) {
        var preferredKey = state.composer.lastPersonaByProjectId[targetProjectId];
        var selectedPersona = (personas || []).find(function (persona) {
          return persona.key === preferredKey;
        }) || (personas && personas[0]) || null;
        state.composer.selectedPersonaKey = selectedPersona ? selectedPersona.key : '';
        state.composer.loadingThreadPersonas = false;
        notify();
        return personas;
      }).catch(function (error) {
        state.composer.loadingThreadPersonas = false;
        state.composer.threadPersonaError = error && error.message ? error.message : String(error);
        notify();
        throw error;
      });
    }

    function closeThreadComposer() {
      state.ui.threadComposerOpen = false;
      state.composer.threadProjectId = null;
      state.composer.threadTitle = '';
      state.composer.selectedPersonaKey = '';
      state.composer.loadingThreadPersonas = false;
      state.composer.threadPersonaError = null;
      state.composer.creatingThread = false;
      notify();
    }

    function setThreadDraftName(value) {
      state.composer.threadTitle = value || '';
      notify();
    }

    function openThreadRename(threadId) {
      var targetThreadId = threadId || (context.activeSession && context.activeSession.threadId) || null;
      var thread = getThread(targetThreadId);
      if (!thread) return Promise.resolve(null);

      state.ui.threadRenameOpen = true;
      state.ui.threadComposerOpen = false;
      state.ui.projectComposerOpen = false;
      state.ui.projectRenameOpen = false;
      state.composer.threadRenameId = thread.id;
      state.composer.threadRenameTitle = thread.title || '';
      state.integration.error = null;
      notify();
      return Promise.resolve(thread.id);
    }

    function closeThreadRename() {
      state.ui.threadRenameOpen = false;
      state.composer.threadRenameId = null;
      state.composer.threadRenameTitle = '';
      state.composer.renamingThread = false;
      state.integration.error = null;
      notify();
    }

    function setThreadRenameTitle(value) {
      state.composer.threadRenameTitle = value || '';
      notify();
    }

    function setThreadDraftPersona(value) {
      state.composer.selectedPersonaKey = value || '';
      notify();
    }

    function setThreadDraft(threadId, value) {
      var threadUi = getThreadUi(threadId);
      if (!threadUi) return;
      threadUi.draftText = value || '';
    }

    function rememberThreadScroll(threadId, payload) {
      var threadUi = getThreadUi(threadId);
      if (!threadUi) return;
      threadUi.scrollTop = payload && typeof payload.scrollTop === 'number' ? payload.scrollTop : threadUi.scrollTop;
      threadUi.wasNearBottom = !!(payload && payload.wasNearBottom);
      threadUi.lastViewedAt = nowIso();
    }

    function setAuthEmail(value) {
      state.integration.authEmail = value || '';
      notify();
    }

    function setVerificationInput(value) {
      state.integration.verificationInput = value || '';
      notify();
    }

    function getSnapshot() {
      var selectedOrganization = getSelectedOrganization();
      var selectedWorkspace = getSelectedWorkspace();
      var selectedProject = getSelectedProject();
      var organizationId = selectedOrganization ? selectedOrganization.id : null;
      var organizationUi = getOrganizationUi(organizationId);
      var allThreads = getAllThreads();

      return {
        integration: clone(state.integration),
        loadingNavigator: state.loadingNavigator,
        navigatorVisible: state.ui.navigatorVisible,
        navigatorCollapsed: state.ui.navigatorCollapsed,
        projectComposerOpen: state.ui.projectComposerOpen,
        projectRenameOpen: state.ui.projectRenameOpen,
        threadComposerOpen: state.ui.threadComposerOpen,
        threadRenameOpen: state.ui.threadRenameOpen,
        searchTerm: state.ui.searchTerm,
        packages: clone(state.packages),
        composer: clone(state.composer),
        organizations: clone(state.organizations),
        selectedOrganization: clone(selectedOrganization),
        selectedWorkspace: clone(selectedWorkspace),
        selectedProject: clone(selectedProject),
        projectGroups: clone(window.__tribexAiUtils.buildProjectGroups(
          getOrganizationProjects(organizationId),
          allThreads.filter(function (thread) {
            return !organizationId || thread.organizationId === organizationId;
          }),
          resolveSelectedProjectId(),
          state.ui.searchTerm
        )),
        hasProjects: getOrganizationProjects(organizationId).length > 0,
        canRunSmokeTest: !!(selectedWorkspace && selectedWorkspace.packageKey === 'smoke'),
        activeProjectId: resolveSelectedProjectId(),
        activeThreadId: context.activeSession && context.activeSession.threadId && getThread(context.activeSession.threadId)
          ? context.activeSession.threadId
          : null,
        projectExpansion: clone(organizationUi ? organizationUi.expandedProjectIds : {}),
        streamStatuses: clone(state.streamStatuses),
        relayStatuses: clone(state.relayStates),
      };
    }

    api.clone = clone;
    api.notify = notify;
    api.subscribe = subscribe;
    api.getSelectedOrganization = getSelectedOrganization;
    api.getWorkspace = getWorkspace;
    api.getProject = getProject;
    api.getThread = getThread;
    api.getAllThreads = getAllThreads;
    api.getWorkspaceProjects = getWorkspaceProjects;
    api.getOrganizationProjects = getOrganizationProjects;
    api.ensureOrganizationUi = ensureOrganizationUi;
    api.getOrganizationUi = getOrganizationUi;
    api.ensureThreadUi = ensureThreadUi;
    api.getThreadUi = getThreadUi;
    api.getSelectedWorkspace = getSelectedWorkspace;
    api.getSelectedProject = getSelectedProject;
    api.mergeProject = mergeProject;
    api.rememberOrganizationContext = rememberOrganizationContext;
    api.isProjectExpanded = isProjectExpanded;
    api.setProjectExpanded = setProjectExpanded;
    api.toggleProjectExpanded = toggleProjectExpanded;
    api.resolveSelectedProjectId = resolveSelectedProjectId;
    api.resolvePreferredWorkspace = resolvePreferredWorkspace;
    api.ensureProjectForNewThread = ensureProjectForNewThread;
    api.restoreOrganizationContext = restoreOrganizationContext;
    api.isThreadSession = isThreadSession;
    api.mergeThreadSummary = mergeThreadSummary;
    api.replaceThreadSummaries = replaceThreadSummaries;
    api.parseActivityTimestamp = parseActivityTimestamp;
    api.nowIso = nowIso;
    api.randomId = randomId;
    api.stringifyPreview = stringifyPreview;
    api.toggleNavigator = toggleNavigator;
    api.hideNavigator = hideNavigator;
    api.toggleNavigatorCollapsed = toggleNavigatorCollapsed;
    api.setSearchTerm = setSearchTerm;
    api.selectOrganization = selectOrganization;
    api.selectWorkspace = selectWorkspace;
    api.selectProject = selectProject;
    api.openProjectComposer = openProjectComposer;
    api.closeProjectComposer = closeProjectComposer;
    api.setProjectDraftName = setProjectDraftName;
    api.openProjectRename = openProjectRename;
    api.closeProjectRename = closeProjectRename;
    api.setProjectRenameName = setProjectRenameName;
    api.openThreadComposer = openThreadComposer;
    api.closeThreadComposer = closeThreadComposer;
    api.setThreadDraftName = setThreadDraftName;
    api.openThreadRename = openThreadRename;
    api.closeThreadRename = closeThreadRename;
    api.setThreadRenameTitle = setThreadRenameTitle;
    api.setThreadDraftPersona = setThreadDraftPersona;
    api.setThreadDraft = setThreadDraft;
    api.rememberThreadScroll = rememberThreadScroll;
    api.setAuthEmail = setAuthEmail;
    api.setVerificationInput = setVerificationInput;
    api.getSnapshot = getSnapshot;

    return api;
  };
})();
