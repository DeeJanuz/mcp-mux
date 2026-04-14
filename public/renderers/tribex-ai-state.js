// @ts-nocheck
/* TribeX AI state — local scaffold mirroring the hosted Organization -> Workspace -> Project -> Thread model */

(function () {
  'use strict';

  var listeners = [];

  var state = {
    organization: {
      id: 'org-tribe-x',
      name: 'Tribe-X',
      slug: 'tribe-x',
    },
    currentWorkspaceId: 'ws-creator-studio',
    currentProjectId: 'proj-first-party-plugin',
    workspaces: [
      {
        id: 'ws-creator-studio',
        name: 'Creator Studio',
        slug: 'creator-studio',
        package: {
          name: 'Operator Studio',
          persona: 'Operator',
          version: 'v1',
        },
        organizationReady: true,
        billing: {
          status: 'ACTIVE',
          plan: 'Founding',
        },
        provisioning: {
          state: 'ACTIVE',
          lastUpdatedAt: '2026-04-13T19:40:00Z',
          summary: 'Hosted workspace is provisioned and accepting project/thread work.',
        },
      },
    ],
    projects: [
      {
        id: 'proj-first-party-plugin',
        workspaceId: 'ws-creator-studio',
        name: 'MCPViews first-class AI plugin',
        status: 'ACTIVE',
        pinned: true,
        summary: 'Shell entrypoint, AI home, and chat-first thread surfaces for MCPViews.',
        memorySummary: 'Bundled first-party plugin, shell AI entrypoint, and thread-as-tab model.',
        lastActivityAt: '2026-04-13T19:43:00Z',
      },
      {
        id: 'proj-runtime-hydration',
        workspaceId: 'ws-creator-studio',
        name: 'Runtime hydration and relay recovery',
        status: 'ACTIVE',
        pinned: false,
        summary: 'Cached-shell-first reopen behavior, relay grants, and device-local readiness.',
        memorySummary: 'Hosted transcript is authoritative, device readiness remains local.',
        lastActivityAt: '2026-04-13T19:28:00Z',
      },
      {
        id: 'proj-onboarding',
        workspaceId: 'ws-creator-studio',
        name: 'Workspace onboarding and readiness',
        status: 'PLANNING',
        pinned: false,
        summary: 'Resumable setup, billing gates, package selection, and provisioning handoff.',
        memorySummary: 'Prerequisites stay visible, resumable, and in-app.',
        lastActivityAt: '2026-04-13T18:55:00Z',
      },
    ],
    threads: [
      {
        id: 'thread-home-nav',
        projectId: 'proj-first-party-plugin',
        title: 'AI home and shell framing',
        preview: 'Pinned the shell entrypoint, workspace framing, and recovery-oriented navigation.',
        hydrateState: 'HYDRATED',
        blockedByTool: null,
        lastActivityAt: '2026-04-13T19:43:00Z',
        messages: [
          {
            id: 'msg-home-1',
            role: 'assistant',
            content: 'The shell owns the permanent AI entrypoint and navigation frame so the workflow feels native before a workspace is fully ready.',
          },
          {
            id: 'msg-home-2',
            role: 'tool',
            toolName: 'design_check',
            status: 'success',
            summary: 'Reused existing tab, drawer, and modal primitives.',
            detail: 'No second windowing model was introduced for the AI surfaces.',
          },
          {
            id: 'msg-home-3',
            role: 'assistant',
            content: 'Next, the client needs the AI home, setup handoff, and recent-thread recovery flow anchored to the workspace state model.',
          },
        ],
      },
      {
        id: 'thread-relay',
        projectId: 'proj-runtime-hydration',
        title: 'Relay approvals and thread recovery',
        preview: 'Hydrate hosted truth after reopen and separate local relay failures from hosted continuity.',
        hydrateState: 'REHYDRATING',
        blockedByTool: 'github',
        lastActivityAt: '2026-04-13T19:28:00Z',
        messages: [
          {
            id: 'msg-relay-1',
            role: 'assistant',
            content: 'This thread restored from cached shell state immediately, and the hosted transcript is hydrating in the background.',
          },
          {
            id: 'msg-relay-2',
            role: 'tool',
            toolName: 'github_relay',
            status: 'blocked',
            summary: 'GitHub relay access still needs explicit approval on this device.',
            detail: 'Hosted execution can continue, but local GitHub actions stay blocked until the relay grant is approved.',
          },
          {
            id: 'msg-relay-3',
            role: 'assistant',
            content: 'Open the tool catalog to grant the scoped relay permission, then the composer can resume normal thread work.',
          },
        ],
      },
      {
        id: 'thread-setup',
        projectId: 'proj-onboarding',
        title: 'Setup handoff from provisioning to tools',
        preview: 'Connect package selection, provisioning, and device readiness in one resumable flow.',
        hydrateState: 'HYDRATED',
        blockedByTool: null,
        lastActivityAt: '2026-04-13T18:55:00Z',
        messages: [
          {
            id: 'msg-setup-1',
            role: 'assistant',
            content: 'Provisioning completed successfully, so the setup flow now hands off into required tool readiness instead of dropping the user into a blank success state.',
          },
        ],
      },
    ],
    toolBindings: [
      {
        key: 'notion',
        name: 'Notion',
        category: 'Documentation',
        required: true,
        readiness: 'ready',
        relayStatus: 'granted',
        nextAction: 'Open docs',
        detail: 'Installed, authenticated, and approved for relay on this device.',
      },
      {
        key: 'github',
        name: 'GitHub',
        category: 'Source control',
        required: true,
        readiness: 'permission_required',
        relayStatus: 'pending',
        nextAction: 'Approve relay',
        detail: 'Account is connected, but scoped relay approval is still required for hosted thread actions.',
      },
      {
        key: 'stripe',
        name: 'Stripe',
        category: 'Payments',
        required: false,
        readiness: 'not_authenticated',
        relayStatus: 'blocked',
        nextAction: 'Connect account',
        detail: 'The local Stripe app is installed, but this device has not authenticated it yet.',
      },
      {
        key: 'localhost_tools',
        name: 'Localhost tools',
        category: 'Development',
        required: false,
        readiness: 'unreachable',
        relayStatus: 'blocked',
        nextAction: 'Retry reachability',
        detail: 'The outbound relay cannot currently reach the expected localhost capability endpoint.',
      },
    ],
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getWorkspace() {
    return state.workspaces.find(function (workspace) {
      return workspace.id === state.currentWorkspaceId;
    }) || state.workspaces[0];
  }

  function getProject(projectId) {
    var targetId = projectId || state.currentProjectId;
    return state.projects.find(function (project) {
      return project.id === targetId;
    }) || state.projects[0];
  }

  function getThread(threadId) {
    return state.threads.find(function (thread) {
      return thread.id === threadId;
    }) || null;
  }

  function getThreadsForProject(projectId) {
    return window.__tribexAiUtils.sortThreads(
      state.threads.filter(function (thread) {
        return thread.projectId === projectId;
      }),
    );
  }

  function getRecentThreads() {
    return window.__tribexAiUtils.sortThreads(state.threads).slice(0, 6);
  }

  function getToolBinding(toolKey) {
    return state.toolBindings.find(function (binding) {
      return binding.key === toolKey;
    }) || null;
  }

  function getWorkspaceAlert(workspace, toolBindings) {
    if (!workspace) return null;

    if (workspace.provisioning.state === 'FAILED') {
      return {
        tone: 'warning',
        title: 'Provisioning needs attention',
        body: 'Hosted workspace provisioning failed previously. Resume from setup to recover without losing context.',
        actionLabel: 'Resume setup',
        action: function () {
          openSetup();
        },
      };
    }

    var readinessSummary = window.__tribexAiUtils.summarizeReadiness(toolBindings);
    if (readinessSummary.blocked > 0) {
      return {
        tone: 'warning',
        title: 'Required local tools still need attention',
        body: readinessSummary.blocked + ' required tool(s) are blocking full workspace readiness on this device.',
        actionLabel: 'Open tool catalog',
        action: function () {
          openToolCatalog();
        },
      };
    }

    return {
      tone: 'success',
      title: 'Workspace is ready for hosted work',
      body: 'Provisioning is complete and required local bindings are currently ready.',
      actionLabel: 'Open AI home',
      action: function () {
        openHome();
      },
    };
  }

  function getSnapshot() {
    var workspace = getWorkspace();
    var projects = window.__tribexAiUtils.sortProjects(
      state.projects.filter(function (project) {
        return project.workspaceId === workspace.id;
      }),
      state.currentProjectId,
    );
    var toolBindings = clone(state.toolBindings);

    return {
      organization: clone(state.organization),
      workspace: clone(workspace),
      projects: clone(projects),
      recentThreads: clone(getRecentThreads()),
      toolBindings: toolBindings,
      toolSummary: window.__tribexAiUtils.summarizeReadiness(toolBindings),
      alert: getWorkspaceAlert(workspace, toolBindings),
    };
  }

  function getThreadContext(threadId) {
    var thread = getThread(threadId);
    if (!thread) return null;
    var project = getProject(thread.projectId);
    var workspace = getWorkspace();
    var blockedBinding = thread.blockedByTool ? getToolBinding(thread.blockedByTool) : null;

    return {
      workspace: clone(workspace),
      project: clone(project),
      thread: clone(thread),
      blockedBinding: clone(blockedBinding),
      toolSummary: window.__tribexAiUtils.summarizeReadiness(state.toolBindings),
    };
  }

  function notify() {
    listeners.slice().forEach(function (listener) {
      listener(getSnapshot());
    });
    if (window.__companionUtils && typeof window.__companionUtils.refreshActiveSession === 'function') {
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

  function openSession(config) {
    if (!window.__companionUtils || typeof window.__companionUtils.openSession !== 'function') {
      return null;
    }
    return window.__companionUtils.openSession(config);
  }

  function openHome(projectId) {
    return openSession({
      sessionKey: 'tribex-ai-home',
      toolName: 'TribeX AI',
      contentType: 'tribex_ai_home',
      data: { title: 'AI Home' },
      meta: {
        aiView: 'home',
        headerTitle: 'AI Home',
        projectId: projectId || null,
      },
      toolArgs: {
        projectId: projectId || null,
      },
    });
  }

  function openProject(projectId) {
    state.currentProjectId = projectId;
    return openHome(projectId);
  }

  function openSetup() {
    return openSession({
      sessionKey: 'tribex-ai-setup',
      toolName: 'TribeX AI',
      contentType: 'tribex_ai_setup',
      data: { title: 'Workspace Setup' },
      meta: {
        aiView: 'setup',
        headerTitle: 'Workspace Setup',
      },
    });
  }

  function openToolCatalog() {
    return openSession({
      sessionKey: 'tribex-ai-tool-catalog',
      toolName: 'TribeX AI',
      contentType: 'tribex_ai_tool_catalog',
      data: { title: 'Tool Catalog' },
      meta: {
        aiView: 'tool_catalog',
        headerTitle: 'Tool Catalog',
      },
    });
  }

  function openThread(threadId) {
    var thread = getThread(threadId);
    if (!thread) return null;
    state.currentProjectId = thread.projectId;
    return openSession({
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
    });
  }

  function resolveBinding(toolKey) {
    var binding = getToolBinding(toolKey);
    if (!binding) return;

    if (binding.readiness === 'permission_required') {
      binding.readiness = 'ready';
      binding.relayStatus = 'granted';
      binding.detail = 'Relay permission approved for the current workspace scope on this device.';
      binding.nextAction = 'Approved';
    } else if (binding.readiness === 'not_authenticated') {
      binding.readiness = 'ready';
      binding.relayStatus = 'granted';
      binding.detail = 'Authentication completed and the tool is now available to hosted work.';
      binding.nextAction = 'Connected';
    } else if (binding.readiness === 'unreachable' || binding.readiness === 'not_installed') {
      binding.readiness = 'ready';
      binding.relayStatus = 'granted';
      binding.detail = 'Device reachability recovered and the binding is healthy again.';
      binding.nextAction = 'Ready';
    }

    if (toolKey === 'github') {
      var relayThread = getThread('thread-relay');
      if (relayThread) {
        relayThread.blockedByTool = null;
        relayThread.hydrateState = 'HYDRATED';
      }
    }

    notify();
  }

  function createAssistantReply() {
    return 'Captured. This scaffold keeps the thread chat-first while routing setup, tool catalog, and recovery into dedicated shell surfaces around the conversation.';
  }

  function submitPrompt(threadId, prompt) {
    var thread = getThread(threadId);
    if (!thread) return false;

    var blockedBinding = thread.blockedByTool ? getToolBinding(thread.blockedByTool) : null;
    if (blockedBinding && blockedBinding.readiness !== 'ready') {
      return false;
    }

    var trimmed = String(prompt || '').trim();
    if (!trimmed) return false;

    var now = new Date().toISOString();
    thread.lastActivityAt = now;
    thread.preview = trimmed;

    thread.messages.push({
      id: 'msg-user-' + Date.now(),
      role: 'user',
      content: trimmed,
    });

    var toolMessageId = 'msg-tool-' + Date.now();
    thread.messages.push({
      id: toolMessageId,
      role: 'tool',
      toolName: 'hosted_runtime',
      status: 'pending',
      summary: 'Queued prompt for hosted execution.',
      detail: 'The hosted runtime is reconciling thread state and local relay policy.',
    });

    notify();

    window.setTimeout(function () {
      thread.messages = thread.messages.map(function (message) {
        if (message.id !== toolMessageId) return message;
        return {
          id: toolMessageId,
          role: 'tool',
          toolName: 'hosted_runtime',
          status: 'success',
          summary: 'Hosted thread responded successfully.',
          detail: 'Cached shell state and hosted truth are now aligned again.',
        };
      });

      thread.messages.push({
        id: 'msg-assistant-' + Date.now(),
        role: 'assistant',
        content: createAssistantReply(trimmed),
      });

      notify();
    }, 650);

    return true;
  }

  window.__tribexAiState = {
    getSnapshot: getSnapshot,
    getThreadContext: getThreadContext,
    getThreadsForProject: function (projectId) {
      return clone(getThreadsForProject(projectId));
    },
    getToolBinding: function (toolKey) {
      return clone(getToolBinding(toolKey));
    },
    openHome: openHome,
    openProject: openProject,
    openSetup: openSetup,
    openThread: openThread,
    openToolCatalog: openToolCatalog,
    resolveBinding: resolveBinding,
    submitPrompt: submitPrompt,
    subscribe: subscribe,
  };
})();
