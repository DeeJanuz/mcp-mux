// @ts-nocheck
/* TribeX AI state — composed from focused hosted-thread state modules */

(function () {
  'use strict';

  function createInitialState() {
    var threadEntitiesById = {};
    return {
      ui: {
        navigatorVisible: false,
        navigatorCollapsed: false,
        searchTerm: '',
        organizationMenuOpen: false,
        projectComposerOpen: false,
        threadComposerOpen: false,
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
      threadEntitiesById: threadEntitiesById,
      threadDetails: threadEntitiesById,
      threadErrors: {},
      loadingNavigator: false,
      loadingThreadIds: {},
      pendingThreadIds: {},
      companionKeys: {},
      lastCompanionSequences: {},
      streamStatuses: {},
      relayStates: {},
      organizationUiById: {},
      requestState: {
        navigatorEpoch: 0,
        threadEpochById: {},
        personaEpochByProjectId: {},
      },
      composer: {
        projectName: '',
        creatingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
        lastPersonaByProjectId: {},
      },
    };
  }

  if (
    typeof window.__createTribexAiStateCore !== 'function' ||
    typeof window.__createTribexAiStateProjection !== 'function' ||
    typeof window.__createTribexAiStateRuntime !== 'function' ||
    typeof window.__createTribexAiStateActions !== 'function'
  ) {
    throw new Error('TribeX AI state helpers must load before tribex-ai-state.js');
  }

  var context = {
    listeners: [],
    streamListenerBound: false,
    desktopRelayListenerBound: false,
    desktopPresenceListenerBound: false,
    navigatorLoad: null,
    activeSession: null,
    projectBootstrap: null,
    runtimeEventUnsubscribers: {},
    state: createInitialState(),
  };

  var api = {};
  window.__createTribexAiStateCore(context, api);
  window.__createTribexAiStateProjection(context, api);
  window.__createTribexAiStateRuntime(context, api);
  window.__createTribexAiStateActions(context, api);

  window.__tribexAiState = {
    clearConnection: api.clearConnection,
    connect: api.connect,
    createProject: api.createProject,
    createThread: api.createThread,
    getSnapshot: api.getSnapshot,
    getThread: function (threadId) { return api.clone(api.getThread(threadId)); },
    getThreadContext: api.getThreadContext,
    getThreadsForProject: function (projectId) {
      return api.clone(window.__tribexAiUtils.sortThreads(api.getAllThreads().filter(function (thread) {
        return thread.projectId === projectId;
      })));
    },
    hideNavigator: api.hideNavigator,
    onSessionClosed: api.onSessionClosed,
    openProjectComposer: api.openProjectComposer,
    openThreadComposer: api.openThreadComposer,
    openThread: api.openThread,
    openThreadArtifact: api.openThreadArtifact,
    refreshActiveThread: api.refreshActiveThread,
    refreshNavigator: api.refreshNavigator,
    runSmokeTest: api.runSmokeTest,
    sendMagicLink: api.sendMagicLink,
    selectOrganization: api.selectOrganization,
    selectProject: api.selectProject,
    selectThreadArtifact: api.selectThreadArtifact,
    selectWorkspace: api.selectWorkspace,
    setActiveSession: api.setActiveSession,
    setAuthEmail: api.setAuthEmail,
    setProjectDraftName: api.setProjectDraftName,
    setSearchTerm: api.setSearchTerm,
    setThreadDraft: api.setThreadDraft,
    setThreadDraftName: api.setThreadDraftName,
    setThreadDraftPersona: api.setThreadDraftPersona,
    setVerificationInput: api.setVerificationInput,
    submitPrompt: api.submitPrompt,
    subscribe: api.subscribe,
    submitThreadComposer: api.submitThreadComposer,
    toggleProjectExpanded: api.toggleProjectExpanded,
    closeProjectComposer: api.closeProjectComposer,
    closeThreadComposer: api.closeThreadComposer,
    toggleNavigator: api.toggleNavigator,
    toggleNavigatorCollapsed: api.toggleNavigatorCollapsed,
    verifyMagicLink: api.verifyMagicLink,
    rememberThreadScroll: api.rememberThreadScroll,
  };
})();
