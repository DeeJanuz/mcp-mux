(function () {
  'use strict';

  window.__createTribexAiStateActions = function __createTribexAiStateActions(context, api) {
    var state = context.state;

    function nextNavigatorEpoch() {
      state.requestState.navigatorEpoch += 1;
      return state.requestState.navigatorEpoch;
    }

    function nextThreadEpoch(threadId) {
      var current = state.requestState.threadEpochById[threadId] || 0;
      var next = current + 1;
      state.requestState.threadEpochById[threadId] = next;
      return next;
    }

    function nextPersonaEpoch(projectId) {
      var current = state.requestState.personaEpochByProjectId[projectId] || 0;
      var next = current + 1;
      state.requestState.personaEpochByProjectId[projectId] = next;
      return next;
    }

    function isThreadStale(threadId) {
      var thread = api.getThread(threadId);
      if (!thread) return true;
      if (thread.optimistic) return false;
      if (!thread.lastHydratedAt) return true;
      return Date.now() - Date.parse(thread.lastHydratedAt) > 30 * 1000;
    }

    function refreshNavigator(force) {
      if (context.navigatorLoad && !force) return context.navigatorLoad;
      api.bindStreamListener();
      api.bindDesktopRelayListener();
      api.bindDesktopPresenceListener();

      var epoch = nextNavigatorEpoch();
      state.loadingNavigator = true;
      state.integration.error = null;
      api.notify();

      context.navigatorLoad = window.__tribexAiClient.getConfig()
        .then(function (config) {
          if (epoch !== state.requestState.navigatorEpoch) return null;
          state.integration.config = config;
          if (!config || !config.configured) {
            state.integration.status = 'misconfigured';
            state.integration.session = null;
            state.packages = [];
            state.organizations = [];
            state.workspacesById = {};
            state.projects = [];
            state.threadEntitiesById = {};
            state.threadDetails = state.threadEntitiesById;
            return null;
          }
          return window.__tribexAiClient.fetchSession();
        })
        .then(function (session) {
          if (epoch !== state.requestState.navigatorEpoch) return null;
          if (session === null) {
            state.integration.session = null;
            state.integration.status = 'unauthenticated';
            state.packages = [];
            state.organizations = [];
            state.workspacesById = {};
            state.projects = [];
            state.threadEntitiesById = {};
            state.threadDetails = state.threadEntitiesById;
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
          if (!payload || epoch !== state.requestState.navigatorEpoch) return null;
          var organizations = payload[0] || [];
          var packages = payload[1] || [];
          state.packages = packages;
          state.organizations = organizations;
          state.selectedOrganizationId = state.selectedOrganizationId && organizations.some(function (organization) {
            return organization.id === state.selectedOrganizationId;
          }) ? state.selectedOrganizationId : (organizations[0] && organizations[0].id) || null;

          if (!state.selectedOrganizationId) {
            return null;
          }

          return window.__tribexAiClient.fetchWorkspaces(state.selectedOrganizationId);
        })
        .then(function (workspaces) {
          if (!workspaces || epoch !== state.requestState.navigatorEpoch) return null;

          var nextWorkspacesById = Object.assign({}, state.workspacesById);
          workspaces.forEach(function (workspace) {
            nextWorkspacesById[workspace.id] = workspace;
            api.ensureOrganizationUi(workspace.organizationId);
          });
          state.workspacesById = nextWorkspacesById;

          var selectedWorkspace = api.getSelectedWorkspace();
          state.selectedWorkspaceId = selectedWorkspace ? selectedWorkspace.id : ((workspaces[0] && workspaces[0].id) || null);

          return Promise.all((workspaces || []).map(function (workspace) {
            return window.__tribexAiClient.fetchProjects(workspace).catch(function () {
              return [];
            });
          })).then(function (projectLists) {
            return {
              workspaces: workspaces,
              projects: [].concat.apply([], projectLists || []),
            };
          });
        })
        .then(function (payload) {
          if (!payload || epoch !== state.requestState.navigatorEpoch) return null;
          state.projects = payload.projects || [];
          state.selectedProjectId = state.selectedProjectId && state.projects.some(function (project) {
            return project.id === state.selectedProjectId;
          }) ? state.selectedProjectId : api.resolveSelectedProjectId();

          return Promise.all(state.projects.map(function (project) {
            return window.__tribexAiClient.fetchThreads(project).catch(function () {
              return [];
            });
          })).then(function (threadLists) {
            return {
              projects: payload.projects,
              threads: [].concat.apply([], threadLists || []),
            };
          });
        })
        .then(function (payload) {
          if (!payload || epoch !== state.requestState.navigatorEpoch) return null;

          api.replaceThreadSummaries(payload.threads || [], state.selectedOrganizationId);

          if (!state.selectedProjectId && state.projects[0]) state.selectedProjectId = state.projects[0].id;
          if (state.selectedProjectId) api.setProjectExpanded(state.selectedProjectId, true);

          return true;
        })
        .catch(function (error) {
          if (epoch !== state.requestState.navigatorEpoch) return null;
          var message = error && error.message ? error.message : String(error);
          state.integration.error = message;
          if (/token|unauth|auth|signed in/i.test(message)) {
            state.integration.status = 'unauthenticated';
            state.integration.session = null;
          } else {
            state.integration.status = 'error';
          }
          return null;
        })
        .finally(function () {
          if (epoch === state.requestState.navigatorEpoch) {
            state.loadingNavigator = false;
            context.navigatorLoad = null;
            api.notify();
          }
        });

      return context.navigatorLoad;
    }

    function ensureCompanion(threadId) {
      var thread = api.getThread(threadId);
      if (!thread || !thread.workspaceId) return Promise.resolve(null);
      if (state.companionKeys[threadId] || state.streamStatuses[threadId] === 'connected' || state.streamStatuses[threadId] === 'connecting') {
        return Promise.resolve(state.companionKeys[threadId] || null);
      }

      return window.__tribexAiClient.createCompanionSession(thread.workspaceId, threadId)
        .then(function (session) {
          if (!session || !session.companionKey) return null;
          state.companionKeys[threadId] = session.companionKey;
          state.streamStatuses[threadId] = 'connecting';
          api.notify();
          return window.__tribexAiClient.startCompanionStream(threadId, session.companionKey).then(function () {
            return session.companionKey;
          });
        })
        .catch(function () {
          state.streamStatuses[threadId] = 'unavailable';
          api.notify();
          return null;
        });
    }

    function buildSmokeThreadTitle() {
      return 'Smoke Test ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
    }

    function ensureDesktopRelay(threadId) {
      var thread = api.getThread(threadId);
      if (!thread || !thread.workspaceId || !window.__tribexAiClient) {
        return Promise.resolve(null);
      }

      api.bindDesktopRelayListener();
      api.bindDesktopPresenceListener();

      var existing = state.relayStates[threadId];
      if (existing && (existing.status === 'online' || existing.status === 'connecting')) {
        return Promise.resolve(existing);
      }

      api.updateRelayState(threadId, {
        status: 'connecting',
        error: null,
      });
      api.notify();

      return window.__tribexAiClient.registerDesktopRelay({
        workspaceId: thread.workspaceId,
        threadId: threadId,
        deviceKey: 'mcpviews-' + thread.workspaceId,
        label: 'MCPViews Desktop',
        platform: 'tauri-desktop',
        purpose: 'mcp-proxy',
        metadata: {
          client: 'mcpviews',
          source: 'thread-runtime',
        },
      })
        .then(function (relay) {
          var next = api.updateRelayState(threadId, {
            registration: relay || null,
            relaySessionId: relay && relay.relaySession ? relay.relaySession.id || null : null,
            relayDeviceId: relay && relay.relayDeviceId ? relay.relayDeviceId : null,
            error: null,
          });
          api.notify();

          return Promise.all([
            window.__tribexAiClient.startDesktopRelayStream(
              threadId,
              '/api/desktop-relay/stream',
              { threadId: threadId }
            ),
            window.__tribexAiClient.startDesktopPresenceHeartbeat(
              threadId,
              30,
              {
                relaySessionId: next && next.relaySessionId ? next.relaySessionId : undefined,
                status: 'ONLINE',
                metadata: {
                  source: 'thread-runtime',
                  threadId: threadId,
                },
              },
              '/api/desktop-relay/presence'
            ),
          ]).then(function () {
            return next;
          });
        })
        .catch(function (error) {
          api.updateRelayState(threadId, {
            error: error && error.message ? error.message : String(error),
          });
          api.notify();
          throw error;
        });
    }

    function refreshThread(threadId, connectStream) {
      if (!threadId) return Promise.resolve(null);
      var epoch = nextThreadEpoch(threadId);
      var thread = api.getThread(threadId);
      if (thread) {
        thread.syncing = true;
      }
      state.loadingThreadIds[threadId] = true;
      api.bindRuntimeBridge(threadId);
      api.notify();

      return window.__tribexAiClient.fetchThread(threadId)
        .then(function (detail) {
          if (epoch !== state.requestState.threadEpochById[threadId]) return null;
          if (detail && detail.id) {
            var summary = api.getThread(threadId);
            if (summary) {
              detail.projectId = detail.projectId || summary.projectId;
              detail.workspaceId = detail.workspaceId || summary.workspaceId;
              detail.organizationId = detail.organizationId || summary.organizationId;
              detail.persona = detail.persona || summary.persona || null;
            }
            api.mergeThreadDetail(detail);
            var merged = api.getThread(threadId);
            if (merged) {
              merged.optimistic = false;
              merged.rowState = Object.keys(state.pendingThreadIds).indexOf(threadId) >= 0 ? 'pending' : null;
              merged.syncing = false;
              merged.lastHydratedAt = api.nowIso();
            }
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
                  if (epoch !== state.requestState.threadEpochById[threadId]) return null;
                  if (runtimeDetail && runtimeDetail.id) {
                    api.mergeThreadDetail(runtimeDetail);
                    var hydrated = api.getThread(threadId);
                    if (hydrated) hydrated.lastHydratedAt = api.nowIso();
                  }
                  return detail;
                });
            }
            return detail;
          }
          return null;
        })
        .catch(function (error) {
          if (epoch !== state.requestState.threadEpochById[threadId]) return null;
          state.threadErrors[threadId] = error && error.message ? error.message : String(error);
          var failedThread = api.getThread(threadId);
          if (failedThread) {
            failedThread.syncing = false;
            failedThread.rowState = 'error';
          }
          api.notify();
          return null;
        })
        .finally(function () {
          if (epoch === state.requestState.threadEpochById[threadId]) {
            delete state.loadingThreadIds[threadId];
            var current = api.getThread(threadId);
            if (current) current.syncing = false;
            api.notify();
          }
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

      api.unbindRuntimeBridge(threadId);

      delete state.companionKeys[threadId];
      delete state.lastCompanionSequences[threadId];
      delete state.streamStatuses[threadId];
      delete state.relayStates[threadId];
    }

    function openThread(threadId, options) {
      var thread = api.getThread(threadId);
      if (!thread) return null;
      var connectStream = !(options && options.connectStream === false);
      var previousThreadId = context.activeSession && context.activeSession.isThread ? context.activeSession.threadId : null;
      state.selectedWorkspaceId = thread.workspaceId || state.selectedWorkspaceId;
      state.selectedProjectId = thread.projectId || state.selectedProjectId;
      api.rememberOrganizationContext(thread.organizationId, thread.projectId, thread.id, thread.workspaceId);
      api.setProjectExpanded(thread.projectId, true);
      state.ui.navigatorVisible = true;

      var threadUi = api.ensureThreadUi(threadId);
      if (threadUi) {
        threadUi.lastViewedAt = api.nowIso();
      }

      if (previousThreadId && previousThreadId !== threadId) {
        teardownThreadSession(previousThreadId);
      }

      api.bindRuntimeBridge(threadId);

      var config = {
        sessionKey: 'tribex-ai-thread-' + threadId,
        toolName: 'Workspace',
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

      var sessionId = context.activeSession && context.activeSession.isThread
        ? replaceSession(context.activeSession.sessionId, config)
        : openSession(config);

      if (sessionId) {
        setActiveSession(sessionId, {
          meta: config.meta,
        });
      }

      if (!(thread.optimistic && !thread.lastHydratedAt) && (connectStream || isThreadStale(threadId))) {
        refreshThread(threadId, connectStream);
      }
      api.notify();
      return sessionId;
    }

    function loadThreadPersonas(projectId) {
      if (!projectId || !window.__tribexAiClient) {
        return Promise.resolve([]);
      }
      if (typeof window.__tribexAiClient.fetchProjectThreadPersonas !== 'function') {
        return Promise.resolve([{
          id: null,
          key: 'general',
          displayName: 'General',
          releaseVersion: null,
          agentClass: null,
        }]);
      }
      var cached = state.composer.threadPersonasByProjectId[projectId];
      if (Object.prototype.hasOwnProperty.call(state.composer.threadPersonasByProjectId, projectId)) {
        return Promise.resolve(Array.isArray(cached) ? cached : []);
      }

      var epoch = nextPersonaEpoch(projectId);
      return window.__tribexAiClient.fetchProjectThreadPersonas(projectId).then(function (personas) {
        if (epoch !== state.requestState.personaEpochByProjectId[projectId]) {
          return state.composer.threadPersonasByProjectId[projectId] || [];
        }
        state.composer.threadPersonasByProjectId[projectId] = personas || [];
        return personas || [];
      });
    }

    function submitThreadComposer() {
      var targetProjectId = state.composer.threadProjectId || api.resolveSelectedProjectId();
      var threadTitle = String(state.composer.threadTitle || 'New chat').trim() || 'New chat';
      var personaKey = String(state.composer.selectedPersonaKey || '').trim();

      if (!targetProjectId) return Promise.reject(new Error('No project is available for this thread.'));
      if (!personaKey) return Promise.reject(new Error('Select a persona before creating the thread.'));

      var project = api.getProject(targetProjectId);
      if (!project) return Promise.reject(new Error('Project not found.'));

      var personas = state.composer.threadPersonasByProjectId[targetProjectId] || [];
      var selectedPersona = personas.find(function (persona) {
        return persona.key === personaKey;
      }) || null;
      var optimisticId = api.randomId('optimistic-thread');

      state.composer.creatingThread = true;
      state.integration.error = null;

      api.mergeThreadSummary({
        id: optimisticId,
        projectId: targetProjectId,
        workspaceId: project.workspaceId || null,
        organizationId: project.organizationId || null,
        title: threadTitle,
        preview: '',
        projectName: project.name || null,
        workspaceName: project.workspaceName || null,
        hydrateState: 'READY',
        lastActivityAt: api.nowIso(),
        rowState: 'creating',
        optimistic: true,
        persona: selectedPersona ? {
          id: selectedPersona.id,
          key: selectedPersona.key,
          displayName: selectedPersona.displayName,
          releaseVersion: selectedPersona.releaseVersion,
          agentClass: selectedPersona.agentClass,
        } : null,
      });

      var optimisticThread = api.getThread(optimisticId);
      if (optimisticThread) {
        optimisticThread.base = optimisticThread.base || {
          preview: '',
          lastActivityAt: optimisticThread.lastActivityAt,
          messages: [],
        };
        optimisticThread.lastHydratedAt = null;
      }

      state.selectedProjectId = targetProjectId;
      state.selectedWorkspaceId = project.workspaceId || state.selectedWorkspaceId;
      api.rememberOrganizationContext(project.organizationId, targetProjectId, optimisticId, project.workspaceId);
      api.setProjectExpanded(targetProjectId, true);
      openThread(optimisticId, { connectStream: false });
      api.notify();

      return window.__tribexAiClient.createThread(targetProjectId, threadTitle, personaKey)
        .then(function (thread) {
          var previousThread = api.getThread(optimisticId);
          var nextId = thread && thread.id ? thread.id : optimisticId;
          var merged = Object.assign({}, previousThread || {}, thread || {}, {
            id: nextId,
            projectId: (thread && thread.projectId) || targetProjectId,
            workspaceId: (thread && thread.workspaceId) || project.workspaceId || null,
            organizationId: (thread && thread.organizationId) || project.organizationId || null,
            title: (thread && thread.title) || threadTitle,
            projectName: (thread && thread.projectName) || project.name || null,
            workspaceName: (thread && thread.workspaceName) || project.workspaceName || null,
            rowState: null,
            optimistic: false,
            persona: (thread && thread.persona) || (previousThread && previousThread.persona) || null,
          });

          if (previousThread && previousThread.ui) {
            merged.ui = previousThread.ui;
          }

          delete state.threadEntitiesById[optimisticId];
          state.threadDetails = state.threadEntitiesById;
          api.mergeThreadSummary(merged);

          state.composer.lastPersonaByProjectId[targetProjectId] = personaKey;
          state.composer.creatingThread = false;
          state.ui.threadComposerOpen = false;
          state.composer.threadProjectId = null;
          state.composer.threadTitle = '';
          state.composer.selectedPersonaKey = '';
          api.openThread(nextId, { connectStream: false });
          api.notify();
          return nextId;
        })
        .catch(function (error) {
          delete state.threadEntitiesById[optimisticId];
          state.threadDetails = state.threadEntitiesById;
          state.composer.creatingThread = false;
          state.integration.error = error && error.message ? error.message : String(error);
          api.notify();
          throw error;
        });
    }

    function createThread(_title, options) {
      var requestedProjectId = options && options.projectId ? options.projectId : null;

      function prepareComposer(targetProjectId) {
        if (!targetProjectId) {
          return Promise.reject(new Error('No project is available for this thread.'));
        }

        state.composer.threadProjectId = targetProjectId;
        state.composer.threadTitle = (_title && String(_title).trim()) || 'New chat';
        state.composer.threadPersonaError = null;
        state.composer.loadingThreadPersonas = true;
        api.notify();

        return loadThreadPersonas(targetProjectId).then(function (personas) {
          var preferredKey = state.composer.lastPersonaByProjectId[targetProjectId];
          var selectedPersona = (personas || []).find(function (persona) {
            return persona.key === preferredKey;
          }) || (personas && personas[0]) || null;
          state.composer.selectedPersonaKey = selectedPersona ? selectedPersona.key : '';
          state.composer.loadingThreadPersonas = false;
          api.notify();
          return submitThreadComposer();
        }).catch(function (error) {
          state.composer.loadingThreadPersonas = false;
          state.composer.threadPersonaError = error && error.message ? error.message : String(error);
          api.notify();
          throw error;
        });
      }

      if (requestedProjectId) {
        return prepareComposer(requestedProjectId);
      }

      return api.ensureProjectForNewThread().then(function (targetProjectId) {
        return prepareComposer(targetProjectId);
      });
    }

    function runSmokeTest() {
      return api.ensureProjectForNewThread().then(function (targetProjectId) {
        if (!targetProjectId) {
          state.integration.error = 'No project is available yet for this organization.';
          api.notify();
          return null;
        }

        var project = api.getProject(targetProjectId);
        var workspace = project && project.workspaceId ? state.workspacesById[project.workspaceId] : api.getSelectedWorkspace();
        if (!workspace || workspace.packageKey !== 'smoke') {
          state.integration.error = 'Smoke tests are only available in smoke validation workspaces.';
          api.notify();
          return null;
        }

        state.integration.error = null;
        return window.__tribexAiClient.createThread(targetProjectId, buildSmokeThreadTitle(), 'general')
          .then(function (thread) {
            api.mergeThreadSummary(Object.assign({}, thread, {
              projectId: thread.projectId || targetProjectId,
              workspaceId: thread.workspaceId || workspace.id,
              organizationId: thread.organizationId || project.organizationId || null,
              projectName: thread.projectName || (project && project.name) || null,
              workspaceName: thread.workspaceName || workspace.name || null,
            }));
            openThread(thread.id, { connectStream: false });
            api.notify();
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
                api.applySendResult(thread.id, result);
                return thread.id;
              });
          })
          .catch(function (error) {
            state.integration.error = error && error.message ? error.message : String(error);
            api.notify();
            throw error;
          });
      });
    }

    function submitPrompt(threadId, prompt) {
      var trimmed = String(prompt || '').trim();
      if (!trimmed) return Promise.resolve(false);
      var turnId = api.randomId('turn');
      var thread = api.getThread(threadId);
      if (thread) {
        thread.rowState = 'pending';
      }

      state.pendingThreadIds[threadId] = true;
      state.threadErrors[threadId] = null;
      api.bindRuntimeBridge(threadId);
      api.queueLocalTurn(threadId, trimmed, turnId);
      api.setThreadDraft(threadId, '');
      api.notify();

      return ensureDesktopRelay(threadId)
        .then(function () {
          return window.__tribexAiClient.sendMessage(threadId, trimmed, {
            turnId: turnId,
          });
        })
        .then(function (turn) {
          api.applySendResult(threadId, turn);
          if (turn && turn.done && typeof turn.done.then === 'function') {
            turn.done.catch(function (error) {
              var message = error && error.message ? error.message : String(error);
              state.threadErrors[threadId] = message;
              delete state.pendingThreadIds[threadId];
              var erroredThread = api.getThread(threadId);
              if (erroredThread) erroredThread.rowState = 'error';
              api.notify();
            });
          } else {
            delete state.pendingThreadIds[threadId];
            var currentThread = api.getThread(threadId);
            if (currentThread) currentThread.rowState = null;
            api.notify();
          }
          return true;
        })
        .catch(function (error) {
          state.threadErrors[threadId] = error && error.message ? error.message : String(error);
          delete state.pendingThreadIds[threadId];
          var failedThread = api.getThread(threadId);
          if (failedThread) failedThread.rowState = 'error';
          api.notify();
          return false;
        });
    }

    function setActiveSession(sessionId, session) {
      context.activeSession = {
        sessionId: sessionId,
        isThread: api.isThreadSession(session),
        projectId: session && session.meta ? session.meta.projectId || null : null,
        threadId: session && session.meta ? session.meta.threadId || null : null,
      };
      if (window.__companionUtils && typeof window.__companionUtils.setThreadArtifactContext === 'function') {
        window.__companionUtils.setThreadArtifactContext(
          sessionId,
          context.activeSession.isThread ? context.activeSession.threadId : null
        );
      }
      if (context.activeSession.projectId) {
        var activeProject = api.getProject(context.activeSession.projectId);
        state.selectedProjectId = context.activeSession.projectId;
        if (activeProject) {
          state.selectedWorkspaceId = activeProject.workspaceId || state.selectedWorkspaceId;
          api.rememberOrganizationContext(
            activeProject.organizationId,
            context.activeSession.projectId,
            context.activeSession.threadId,
            activeProject.workspaceId || null
          );
          api.setProjectExpanded(context.activeSession.projectId, true);
        }
      }
      api.notify();
    }

    function buildThreadArtifactSessionConfig(threadId, artifact) {
      if (!threadId || !artifact) return null;
      var thread = api.getThread(threadId);
      return {
        sessionKey: artifact.sessionKey || api.buildArtifactSessionKey(threadId, artifact.artifactKey),
        toolName: artifact.contentType || 'artifact',
        contentType: artifact.contentType || 'rich_content',
        data: artifact.data || {},
        meta: Object.assign({}, artifact.meta || {}, {
          aiView: 'thread-artifact',
          headerTitle: (artifact.meta && artifact.meta.headerTitle) || artifact.title || 'Artifact',
          projectId: thread && thread.projectId ? thread.projectId : null,
          threadId: threadId,
          artifactKey: artifact.artifactKey,
          artifactSource: 'tribex-ai-thread-result',
        }),
        toolArgs: artifact.toolArgs || {},
        reviewRequired: !!artifact.reviewRequired,
      };
    }

    function openThreadArtifact(threadId, artifactKey, options) {
      if (!threadId || !artifactKey) return null;
      var detail = state.threadDetails[threadId];
      if (!detail) return null;
      var artifact = api.normalizeArtifactItems(detail).find(function (candidate) {
        return candidate && candidate.artifactKey === artifactKey;
      });
      if (!artifact) return null;
      var sourceSessionId = artifact.sessionId
        || artifact.reviewSessionId
        || (artifact.meta && (artifact.meta.sessionId || artifact.meta.reviewSessionId))
        || null;
      if (
        sourceSessionId &&
        window.__companionUtils &&
        typeof window.__companionUtils.getSession === 'function' &&
        typeof window.__companionUtils.selectSession === 'function'
      ) {
        var sourceSession = window.__companionUtils.getSession(sourceSessionId);
        if (sourceSession) {
          window.__companionUtils.selectSession(sourceSessionId);
          setActiveSession(sourceSessionId, sourceSession);
          api.notify();
          return sourceSessionId;
        }
      }
      detail.artifactDrawer = detail.artifactDrawer || {
        drawerId: 'tribex-ai-thread-artifacts:' + threadId,
        selectedArtifactKey: null,
      };
      detail.artifactDrawer.selectedArtifactKey = artifactKey;
      var threadUi = api.ensureThreadUi(threadId);
      if (threadUi) {
        threadUi.selectedArtifactKey = artifactKey;
      }

      var config = buildThreadArtifactSessionConfig(threadId, artifact);
      var sessionId = config ? openSession(config, {
        autoFocus: !options || options.autoFocus !== false,
      }) : null;
      if (sessionId) {
        setActiveSession(sessionId, {
          meta: config.meta,
        });
      }
      api.notify();
      return sessionId || artifactKey;
    }

    function selectThreadArtifact(threadId, artifactKey, options) {
      return openThreadArtifact(threadId, artifactKey, options);
    }

    function onSessionClosed(sessionId, session) {
      if (!sessionId || !session || !api.isThreadSession(session)) return;
      var threadId = session.meta && session.meta.threadId;
      teardownThreadSession(threadId);
    }

    function createProject() {
      var workspace = api.getSelectedWorkspace();
      var name = String(state.composer.projectName || '').trim() || 'General';
      if (!workspace) return Promise.reject(new Error('No workspace is available for this organization.'));

      state.composer.creatingProject = true;
      state.integration.error = null;
      api.notify();

      return window.__tribexAiClient.createProject(workspace, name).then(function (project) {
        state.projects = state.projects
          .filter(function (candidate) { return candidate.id !== project.id; })
          .concat([project]);
        state.selectedProjectId = project.id;
        api.rememberOrganizationContext(project.organizationId, project.id, null, project.workspaceId || null);
        api.setProjectExpanded(project.id, true);
        state.ui.projectComposerOpen = false;
        state.composer.projectName = '';
        api.notify();
        return project;
      }).catch(function (error) {
        state.integration.error = error && error.message ? error.message : String(error);
        throw error;
      }).finally(function () {
        state.composer.creatingProject = false;
        api.notify();
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
      api.notify();

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
        api.notify();
      });
    }

    function verifyMagicLink() {
      var verificationInput = String(state.integration.verificationInput || '').trim();
      if (!verificationInput) return Promise.reject(new Error('Paste the magic link URL or token to finish sign-in.'));

      state.integration.error = null;
      state.integration.verifyingMagicLink = true;
      api.notify();

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
        api.notify();
      });
    }

    function clearConnection() {
      return window.__tribexAiClient.clearAuth().then(function () {
        Object.keys(context.runtimeEventUnsubscribers).forEach(function (threadId) {
          api.unbindRuntimeBridge(threadId);
        });
        state.integration.session = null;
        state.integration.status = 'unauthenticated';
        state.integration.error = null;
        state.integration.authEmail = '';
        state.integration.verificationInput = '';
        state.integration.magicLinkSentTo = null;
        state.packages = [];
        state.organizations = [];
        state.ui.projectComposerOpen = false;
        state.ui.threadComposerOpen = false;
        state.workspacesById = {};
        state.organizationUiById = {};
        state.selectedWorkspaceId = null;
        state.projects = [];
        state.selectedProjectId = null;
        state.threadEntitiesById = {};
        state.threadDetails = state.threadEntitiesById;
        state.relayStates = {};
        state.companionKeys = {};
        state.lastCompanionSequences = {};
        state.streamStatuses = {};
        state.composer.projectName = '';
        state.composer.creatingProject = false;
        state.composer.threadProjectId = null;
        state.composer.threadTitle = '';
        state.composer.threadPersonasByProjectId = {};
        state.composer.loadingThreadPersonas = false;
        state.composer.threadPersonaError = null;
        state.composer.selectedPersonaKey = '';
        state.composer.creatingThread = false;
        state.composer.lastPersonaByProjectId = {};
        api.notify();
      });
    }

    function refreshActiveThread() {
      if (!context.activeSession || !context.activeSession.threadId) return Promise.resolve(null);
      return refreshThread(context.activeSession.threadId, true);
    }

    api.refreshNavigator = refreshNavigator;
    api.ensureCompanion = ensureCompanion;
    api.buildSmokeThreadTitle = buildSmokeThreadTitle;
    api.ensureDesktopRelay = ensureDesktopRelay;
    api.refreshThread = refreshThread;
    api.pollThread = pollThread;
    api.openSession = openSession;
    api.replaceSession = replaceSession;
    api.teardownThreadSession = teardownThreadSession;
    api.openThread = openThread;
    api.loadThreadPersonas = loadThreadPersonas;
    api.createThread = createThread;
    api.submitThreadComposer = submitThreadComposer;
    api.runSmokeTest = runSmokeTest;
    api.submitPrompt = submitPrompt;
    api.setActiveSession = setActiveSession;
    api.buildThreadArtifactSessionConfig = buildThreadArtifactSessionConfig;
    api.openThreadArtifact = openThreadArtifact;
    api.selectThreadArtifact = selectThreadArtifact;
    api.onSessionClosed = onSessionClosed;
    api.createProject = createProject;
    api.connect = connect;
    api.sendMagicLink = sendMagicLink;
    api.verifyMagicLink = verifyMagicLink;
    api.clearConnection = clearConnection;
    api.refreshActiveThread = refreshActiveThread;

    return api;
  };
})();
