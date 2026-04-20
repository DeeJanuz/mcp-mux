// @ts-nocheck
/* Hosted workspace state — composed from focused hosted-thread state modules */

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
        projectRenameOpen: false,
        threadComposerOpen: false,
        threadRenameOpen: false,
        fileBrowserOpen: false,
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
      workspaceFilesByWorkspaceId: {},
      workspaceFileBrowser: {
        loading: false,
        error: null,
        activeWorkspaceId: null,
        selectedType: null,
        selectedFileId: null,
        selectedFolderPath: '',
        preview: {
          status: 'idle',
          fileId: null,
          contentType: null,
          text: '',
          objectUrl: null,
          error: null,
        },
        uploading: false,
        uploadProgress: null,
        downloading: false,
        downloadProgress: null,
      },
      projects: [],
      selectedProjectId: null,
      threadEntitiesById: threadEntitiesById,
      threadDetails: threadEntitiesById,
      threadErrors: {},
      loadingNavigator: false,
      loadingThreadIds: {},
      pendingThreadIds: {},
      interruptedThreadIds: {},
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
        projectRenameId: null,
        projectRenameName: '',
        renamingProject: false,
        threadProjectId: null,
        threadTitle: '',
        threadPersonasByProjectId: {},
        loadingThreadPersonas: false,
        threadPersonaError: null,
        selectedPersonaKey: '',
        creatingThread: false,
        threadRenameId: null,
        threadRenameTitle: '',
        renamingThread: false,
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
    throw new Error('Hosted workspace state helpers must load before tribex-ai-state.js');
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
    hydrateThread: api.hydrateThread,
    getThreadsForProject: function (projectId) {
      return api.clone(window.__tribexAiUtils.sortThreads(api.getAllThreads().filter(function (thread) {
        return thread.projectId === projectId;
      })));
    },
    hideNavigator: api.hideNavigator,
    onSessionClosed: api.onSessionClosed,
    openProjectComposer: api.openProjectComposer,
    openProjectRename: api.openProjectRename,
    openThreadComposer: api.openThreadComposer,
    openThreadRename: api.openThreadRename,
    openThread: api.openThread,
    openThreadArtifact: api.openThreadArtifact,
    refreshActiveThread: api.refreshActiveThread,
    refreshNavigator: api.refreshNavigator,
    renameProject: api.renameProject,
    renameThread: api.renameThread,
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
    setThreadExpanded: function (threadId, expanded) {
      api.setThreadExpanded(threadId, expanded);
      api.notify();
    },
    setThreadDraft: api.setThreadDraft,
    setThreadDraftName: api.setThreadDraftName,
    setThreadDraftPersona: api.setThreadDraftPersona,
    setVerificationInput: api.setVerificationInput,
    submitPrompt: api.submitPrompt,
    interruptThread: api.interruptThread,
    subscribe: api.subscribe,
    submitThreadComposer: api.submitThreadComposer,
    toggleProjectExpanded: api.toggleProjectExpanded,
    toggleThreadExpanded: api.toggleThreadExpanded,
    closeProjectComposer: api.closeProjectComposer,
    closeProjectRename: api.closeProjectRename,
    closeThreadComposer: api.closeThreadComposer,
    closeThreadRename: api.closeThreadRename,
    closeWorkspaceFileBrowser: api.closeWorkspaceFileBrowser,
    deleteSelectedWorkspaceFile: api.deleteSelectedWorkspaceFile,
    downloadSelectedWorkspaceEntry: api.downloadSelectedWorkspaceEntry,
    openWorkspaceFileBrowser: api.openWorkspaceFileBrowser,
    refreshWorkspaceFiles: api.refreshWorkspaceFiles,
    selectWorkspaceFile: api.selectWorkspaceFile,
    selectWorkspaceFolder: api.selectWorkspaceFolder,
    toggleNavigator: api.toggleNavigator,
    toggleNavigatorCollapsed: api.toggleNavigatorCollapsed,
    toggleWorkspaceFileBrowser: api.toggleWorkspaceFileBrowser,
    uploadWorkspaceFiles: api.uploadWorkspaceFiles,
    verifyMagicLink: api.verifyMagicLink,
    rememberThreadScroll: api.rememberThreadScroll,
    setProjectRenameName: api.setProjectRenameName,
    setThreadRenameTitle: api.setThreadRenameTitle,
  };
})();
