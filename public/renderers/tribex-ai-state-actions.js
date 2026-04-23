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
      bindWindowResumeListener();

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
            state.workspaceFilesByWorkspaceId = {};
            state.projects = [];
            state.threadEntitiesById = {};
            state.threadDetails = state.threadEntitiesById;
            state.loadingThreadIds = {};
            state.pendingThreadIds = {};
            state.interruptedThreadIds = {};
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
            state.workspaceFilesByWorkspaceId = {};
            state.projects = [];
            state.threadEntitiesById = {};
            state.threadDetails = state.threadEntitiesById;
            state.loadingThreadIds = {};
            state.pendingThreadIds = {};
            state.interruptedThreadIds = {};
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

          var activeOrganizationId = state.selectedOrganizationId;
          var nextWorkspacesById = {};
          Object.keys(state.workspacesById).forEach(function (workspaceId) {
            var workspace = state.workspacesById[workspaceId];
            if (!workspace || workspace.organizationId === activeOrganizationId) return;
            nextWorkspacesById[workspaceId] = workspace;
          });
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

    function clearPausePollingTimer() {
      if (context.pausePolling && context.pausePolling.timeoutId) {
        window.clearTimeout(context.pausePolling.timeoutId);
        context.pausePolling.timeoutId = null;
      }
    }

    function clearPauseBurstTimers() {
      if (!context.pausePolling || !Array.isArray(context.pausePolling.burstTimeoutIds)) return;
      context.pausePolling.burstTimeoutIds.forEach(function (timeoutId) {
        window.clearTimeout(timeoutId);
      });
      context.pausePolling.burstTimeoutIds = [];
    }

    function stopPausePolling() {
      clearPausePollingTimer();
      clearPauseBurstTimers();
      if (!context.pausePolling) return;
      context.pausePolling.threadId = null;
      context.pausePolling.intervalMs = 0;
      context.pausePolling.attempt = 0;
    }

    function resolvePausePollDelay(attempt) {
      var delays = [4000, 6500, 10000, 15000];
      return delays[Math.min(Math.max(Number(attempt) || 0, 0), delays.length - 1)];
    }

    function refreshPausedActiveThread(options) {
      if (!context.activeSession || !context.activeSession.threadId) return Promise.resolve(null);
      var threadId = context.activeSession.threadId;
      var thread = api.getThread(threadId);
      if (!thread || !thread.activePause) return Promise.resolve(null);
      return checkThreadPause(threadId, thread.activePause.id, options).catch(function () {
        return null;
      });
    }

    function schedulePausePolling(threadId, delayMs) {
      if (!threadId || !context.pausePolling) return;
      clearPausePollingTimer();
      context.pausePolling.threadId = threadId;
      context.pausePolling.intervalMs = delayMs;
      context.pausePolling.timeoutId = window.setTimeout(function () {
        context.pausePolling.timeoutId = null;
        var thread = api.getThread(threadId);
        if (
          !thread ||
          !thread.activePause ||
          !context.activeSession ||
          context.activeSession.threadId !== threadId ||
          String(thread.activePause.status || '').toUpperCase() !== 'BLOCKED'
        ) {
          stopPausePolling();
          return;
        }
        Promise.resolve(checkThreadPause(threadId, thread.activePause.id, {
          silent: true,
          source: 'poll',
        }))
          .catch(function () {
            return null;
          })
          .finally(function () {
            var current = api.getThread(threadId);
            if (
              current &&
              current.activePause &&
              context.activeSession &&
              context.activeSession.threadId === threadId &&
              String(current.activePause.status || '').toUpperCase() === 'BLOCKED'
            ) {
              context.pausePolling.attempt += 1;
              schedulePausePolling(threadId, resolvePausePollDelay(context.pausePolling.attempt));
            } else {
              stopPausePolling();
            }
          });
      }, delayMs);
    }

    function schedulePauseCheckBurst(threadId, threadPauseId) {
      if (!threadId || !threadPauseId || !context.pausePolling) return;
      clearPauseBurstTimers();
      [1000, 2500, 5000, 9000, 14000].forEach(function (delay) {
        var timeoutId = window.setTimeout(function () {
          var thread = api.getThread(threadId);
          var pauseId = thread && thread.activePause ? thread.activePause.id : threadPauseId;
          if (api.isContinuedPause && api.isContinuedPause(threadId, { id: pauseId })) return;
          if (!pauseId) return;
          Promise.resolve(checkThreadPause(threadId, pauseId, {
            silent: true,
            source: 'burst',
          })).catch(function () {
            return null;
          });
        }, delay);
        context.pausePolling.burstTimeoutIds.push(timeoutId);
      });
    }

    function bindPauseSignalListener() {
      if (context.pauseSignalListenerBound) return;
      context.pauseSignalListenerBound = true;

      if (typeof BroadcastChannel !== 'undefined') {
        try {
          context.pauseSignalChannel = new BroadcastChannel('tribex-ai-thread-pause');
          context.pauseSignalChannel.addEventListener('message', function () {
            refreshPausedActiveThread({ silent: true, source: 'broadcast' });
          });
        } catch (error) {
          context.pauseSignalChannel = null;
        }
      }

      window.addEventListener('storage', function (event) {
        if (event && event.key === 'tribex-ai-thread-pause') {
          refreshPausedActiveThread({ silent: true, source: 'storage' });
        }
      });
    }

    function bindWindowResumeListener() {
      if (context.windowResumeListenerBound) return;
      context.windowResumeListenerBound = true;
      bindPauseSignalListener();

      window.addEventListener('focus', function () {
        refreshPausedActiveThread({ silent: true, source: 'focus' });
      });

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          refreshPausedActiveThread({ silent: true, source: 'visibility' });
        }
      });
    }

    function ensureDesktopRelay(threadId, options) {
      var thread = api.getThread(threadId);
      if (!thread || !thread.workspaceId || !window.__tribexAiClient) {
        return Promise.resolve(null);
      }

      api.bindDesktopRelayListener();
      api.bindDesktopPresenceListener();

      var existing = state.relayStates[threadId];
      var realtimeStillFresh = !existing || !existing.realtimeTokenExpiresAt
        || Date.now() / 1000 < Number(existing.realtimeTokenExpiresAt || 0);
      if (
        !(options && options.forceRefresh) &&
        existing &&
        (existing.status === 'online' || existing.status === 'connecting') &&
        realtimeStillFresh
      ) {
        return Promise.resolve(existing);
      }

      api.updateRelayState(threadId, {
        status: 'connecting',
        error: null,
      });
      api.notify();

      function startLegacyDesktopRelay() {
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
        }).then(function (relay) {
          var next = api.updateRelayState(threadId, {
            mode: 'legacy',
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
        });
      }

      function startRealtimeDesktopRelay(envelope) {
        var relay = envelope && envelope.relay ? envelope.relay : null;
        var realtime = relay && relay.realtime ? relay.realtime : null;
        if (!realtime || Date.now() / 1000 >= Number(realtime.tokenExpiresAt || 0)) {
          return Promise.resolve(null);
        }
        var relaySessionId = relay && relay.bridge && relay.bridge.relaySessionId
          ? relay.bridge.relaySessionId
          : (relay && relay.session && relay.session.id ? relay.session.id : null);
        if (!relaySessionId || typeof window.__tribexAiClient.startRealtimeRelayStream !== 'function') {
          return Promise.resolve(null);
        }

        if (typeof window.__tribexAiClient.stopDesktopPresenceHeartbeat === 'function') {
          window.__tribexAiClient.stopDesktopPresenceHeartbeat(threadId).catch(function () {});
        }

        var next = api.updateRelayState(threadId, {
          mode: 'realtime',
          relaySessionId: relaySessionId,
          relayDeviceId: relay && relay.session ? relay.session.deviceId || null : null,
          realtimeTokenExpiresAt: realtime.tokenExpiresAt,
          streamStatus: 'connecting',
          presenceStatus: null,
          error: null,
        });
        api.notify();

        return window.__tribexAiClient.startRealtimeRelayStream(
          threadId,
          relaySessionId,
          realtime
        ).then(function () {
          return next;
        });
      }

      var runtimePromise = typeof window.__tribexAiClient.ensureRuntimeSession === 'function'
        ? window.__tribexAiClient.ensureRuntimeSession(threadId, {
            forceRefresh: !!(options && options.forceRefresh),
          })
        : Promise.resolve(null);

      return runtimePromise
        .then(function (envelope) {
          return startRealtimeDesktopRelay(envelope).then(function (started) {
            if (started) return started;
            return startLegacyDesktopRelay();
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
              if (merged.activePause && api.filterContinuedPause) {
                merged.activePause = api.filterContinuedPause(threadId, merged.activePause);
              }
              merged.optimistic = false;
              if (Object.keys(state.pendingThreadIds).indexOf(threadId) >= 0) {
                merged.rowState = 'pending';
              } else if (merged.activePause) {
                if (!merged.activePause.resumeMode) {
                  merged.activePause.resumeMode = 'MANUAL';
                }
                var pauseStatus = String(merged.activePause.status || '').toUpperCase();
                merged.rowState = pauseStatus === 'READY'
                  ? 'ready-to-continue'
                  : 'waiting-on-user';
              } else {
                merged.rowState = null;
                merged.pauseCheckState = null;
              }
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
                    if (hydrated) {
                      if (hydrated.activePause && api.filterContinuedPause) {
                        hydrated.activePause = api.filterContinuedPause(threadId, hydrated.activePause);
                      }
                      if (!hydrated.activePause && (
                        hydrated.rowState === 'waiting-on-user' ||
                        hydrated.rowState === 'ready-to-continue'
                      )) {
                        hydrated.rowState = null;
                      }
                      hydrated.lastHydratedAt = api.nowIso();
                    }
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

    function hydrateThread(threadId, seed) {
      if (!threadId) return Promise.resolve(null);

      if (seed && typeof seed === 'object') {
        api.mergeThreadSummary(Object.assign({}, seed, {
          id: threadId,
          optimistic: false,
          rowState: seed.rowState === undefined ? null : seed.rowState,
        }));
      }

      return refreshThread(threadId, false).then(function (detail) {
        return detail || api.getThread(threadId) || null;
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
      if (typeof api.expandThreadAncestors === 'function') {
        api.expandThreadAncestors(thread.id);
      }
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
        toolName: 'AI Workspace',
        contentType: 'tribex_ai_thread',
        data: { title: thread.title },
        meta: {
          aiView: 'thread',
          headerTitle: thread.title,
          projectId: thread.projectId,
          threadId: threadId,
          busyIndicator: null,
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
                  forceRuntimeRefresh: false,
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

    function isThreadBusy(threadId) {
      if (!threadId) return false;
      if (state.pendingThreadIds[threadId]) return true;
      var detail = (state.threadDetails && state.threadDetails[threadId])
        || (state.threadEntitiesById && state.threadEntitiesById[threadId])
        || null;
      var activeTurnStatus = detail && detail.activeTurn
        ? String(detail.activeTurn.status || '').toLowerCase()
        : '';
      if (activeTurnStatus === 'queued' || activeTurnStatus === 'running') {
        return true;
      }

      var runs = [];
      if (detail && Array.isArray(detail.runs)) {
        runs = detail.runs;
      } else if (detail && typeof api.buildThreadProjection === 'function') {
        runs = api.buildThreadProjection(detail).runs || [];
      }

      return runs.some(function (run) {
        return !!(
          run &&
          ((run.answer && run.answer.isStreaming) ||
          (run.workSession && String(run.workSession.status || '').toLowerCase() === 'running'))
        );
      });
    }

    function submitPrompt(threadId, prompt) {
      var trimmed = String(prompt || '').trim();
      if (!trimmed) return Promise.resolve(false);
      var turnId = api.randomId('turn');
      var busy = isThreadBusy(threadId);
      var messageId = busy ? api.randomId('user') : null;
      var thread = api.getThread(threadId);
      if (thread) {
        thread.rowState = 'pending';
      }

      if (!busy) {
        state.pendingThreadIds[threadId] = true;
      }
      state.threadErrors[threadId] = null;
      api.bindRuntimeBridge(threadId);
      if (busy && typeof api.queueContextMessage === 'function') {
        api.queueContextMessage(threadId, trimmed, messageId);
      } else {
        api.queueLocalTurn(threadId, trimmed, turnId);
      }
      api.setThreadDraft(threadId, '');
      api.notify();

      return ensureDesktopRelay(threadId)
        .then(function () {
          return window.__tribexAiClient.sendMessage(threadId, trimmed, {
            turnId: turnId,
            messageId: messageId || undefined,
            waitForStable: busy ? false : undefined,
            forceRuntimeRefresh: false,
          });
        })
        .then(function (turn) {
          if (!busy) {
            api.applySendResult(threadId, turn);
          }
          if (turn && turn.done && typeof turn.done.then === 'function') {
            turn.done
              .then(function () {
                if (!busy) {
                  delete state.pendingThreadIds[threadId];
                }
                var currentThread = api.getThread(threadId);
                if (currentThread) {
                  currentThread.rowState = null;
                }
                return refreshThread(threadId, true).catch(function () {
                  return null;
                });
              })
              .catch(function (error) {
                var message = error && error.message ? error.message : String(error);
                var wasInterrupted = typeof api.shouldSilenceInterruptedFailure === 'function'
                  ? api.shouldSilenceInterruptedFailure(threadId, turn.turnId || null)
                  : !!(state.interruptedThreadIds && state.interruptedThreadIds[threadId]);
                api.failActiveTurnLocally(threadId, wasInterrupted ? 'Stopped by user.' : message, {
                  turnId: turn.turnId || turnId,
                  silent: wasInterrupted,
                });
                api.notify();
              });
          } else if (!busy) {
            delete state.pendingThreadIds[threadId];
            var currentThread = api.getThread(threadId);
            if (currentThread) currentThread.rowState = null;
            api.notify();
          } else {
            var busyThread = api.getThread(threadId);
            if (busyThread) busyThread.rowState = null;
            api.notify();
          }
          return true;
        })
        .catch(function (error) {
          var message = error && error.message ? error.message : String(error);
          if (busy) {
            state.threadErrors[threadId] = message;
            var busyThread = api.getThread(threadId);
            if (busyThread) busyThread.rowState = null;
            api.notify();
            return false;
          }
          var wasInterrupted = typeof api.shouldSilenceInterruptedFailure === 'function'
            ? api.shouldSilenceInterruptedFailure(threadId, turnId)
            : !!(state.interruptedThreadIds && state.interruptedThreadIds[threadId]);
          api.failActiveTurnLocally(threadId, wasInterrupted ? 'Stopped by user.' : message, {
            turnId: turnId,
            silent: wasInterrupted,
          });
          api.notify();
          return false;
        });
    }

    function interruptThread(threadId) {
      var targetThreadId = threadId || (context.activeSession && context.activeSession.threadId) || null;
      if (!targetThreadId) return Promise.resolve(false);

      state.interruptedThreadIds = state.interruptedThreadIds || {};
      var detail = (state.threadDetails && state.threadDetails[targetThreadId])
        || (state.threadEntitiesById && state.threadEntitiesById[targetThreadId])
        || null;
      state.interruptedThreadIds[targetThreadId] = detail && detail.activeTurn && detail.activeTurn.turnId
        ? detail.activeTurn.turnId
        : true;
      var interruptedTurnId = state.interruptedThreadIds[targetThreadId] === true
        ? null
        : state.interruptedThreadIds[targetThreadId];

      if (window.__tribexAiClient && typeof window.__tribexAiClient.disconnectRuntime === 'function') {
        window.__tribexAiClient.disconnectRuntime(targetThreadId);
      }

      api.failActiveTurnLocally(targetThreadId, 'Stopped by user.', {
        turnId: interruptedTurnId,
        silent: true,
      });
      api.notify();
      return Promise.resolve(true);
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

    function renameProject() {
      var projectId = state.composer.projectRenameId;
      var nextName = String(state.composer.projectRenameName || '').trim() || 'Project';
      var project = api.getProject(projectId);
      var workspace = project && project.workspaceId ? api.getWorkspace(project.workspaceId) : api.getSelectedWorkspace();

      if (!project || !workspace) {
        return Promise.reject(new Error('No project is available to rename.'));
      }

      state.composer.renamingProject = true;
      state.integration.error = null;
      api.notify();

      return window.__tribexAiClient.renameProject(workspace, projectId, nextName).then(function (updatedProject) {
        var merged = api.mergeProject(Object.assign({}, updatedProject || {}, {
          id: projectId,
          workspaceId: (updatedProject && updatedProject.workspaceId) || project.workspaceId || null,
          organizationId: (updatedProject && updatedProject.organizationId) || project.organizationId || null,
          name: (updatedProject && updatedProject.name) || nextName,
          workspaceName: (updatedProject && updatedProject.workspaceName) || project.workspaceName || (workspace && workspace.name) || null,
        }));

        Object.keys(state.threadEntitiesById).forEach(function (threadId) {
          var thread = state.threadEntitiesById[threadId];
          if (!thread || thread.projectId !== projectId) return;
          thread.projectName = (merged && merged.name) || nextName;
        });

        state.ui.projectRenameOpen = false;
        state.composer.projectRenameId = null;
        state.composer.projectRenameName = '';
        api.notify();
        return merged;
      }).catch(function (error) {
        state.integration.error = error && error.message ? error.message : String(error);
        throw error;
      }).finally(function () {
        state.composer.renamingProject = false;
        api.notify();
      });
    }

    function renameThread() {
      var threadId = state.composer.threadRenameId;
      var nextTitle = String(state.composer.threadRenameTitle || '').trim() || 'Thread';
      var thread = api.getThread(threadId);
      var project = thread && thread.projectId ? api.getProject(thread.projectId) : null;

      if (!thread) {
        return Promise.reject(new Error('No thread is available to rename.'));
      }

      state.composer.renamingThread = true;
      state.integration.error = null;
      api.notify();

      return window.__tribexAiClient.renameThread(threadId, nextTitle).then(function (updatedThread) {
        var merged = api.mergeThreadSummary(Object.assign({}, updatedThread || {}, {
          id: threadId,
          projectId: (updatedThread && updatedThread.projectId) || thread.projectId || null,
          workspaceId: (updatedThread && updatedThread.workspaceId) || thread.workspaceId || null,
          organizationId: (updatedThread && updatedThread.organizationId) || thread.organizationId || null,
          title: (updatedThread && updatedThread.title) || nextTitle,
          status: (updatedThread && updatedThread.status) || thread.status || null,
          projectName: (updatedThread && updatedThread.projectName) || (project && project.name) || thread.projectName || null,
          workspaceName: (updatedThread && updatedThread.workspaceName) || thread.workspaceName || null,
          personaReleaseId: (updatedThread && updatedThread.personaReleaseId) || thread.personaReleaseId || null,
          persona: (updatedThread && updatedThread.persona) || thread.persona || null,
          lastActivityAt: (updatedThread && updatedThread.lastActivityAt) || thread.lastActivityAt || api.nowIso(),
          optimistic: false,
          rowState: null,
        }));

        if (
          merged &&
          context.activeSession &&
          context.activeSession.isThread &&
          context.activeSession.threadId === threadId
        ) {
          var sessionConfig = {
            sessionKey: 'tribex-ai-thread-' + threadId,
            toolName: 'AI Workspace',
            contentType: 'tribex_ai_thread',
            data: { title: merged.title || nextTitle },
            meta: {
              aiView: 'thread',
              headerTitle: merged.title || nextTitle,
              projectId: merged.projectId || thread.projectId || null,
              threadId: threadId,
            },
            toolArgs: {
              threadId: threadId,
            },
          };
          var sessionId = replaceSession(context.activeSession.sessionId, sessionConfig);
          if (sessionId) {
            setActiveSession(sessionId, {
              meta: sessionConfig.meta,
            });
          }
        }

        state.ui.threadRenameOpen = false;
        state.composer.threadRenameId = null;
        state.composer.threadRenameTitle = '';
        api.notify();
        return merged;
      }).catch(function (error) {
        state.integration.error = error && error.message ? error.message : String(error);
        throw error;
      }).finally(function () {
        state.composer.renamingThread = false;
        api.notify();
      });
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
        state.workspaceFilesByWorkspaceId = {};
        state.workspaceFileBrowser = {
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
        };
        state.organizationUiById = {};
        state.selectedWorkspaceId = null;
        state.projects = [];
        state.selectedProjectId = null;
        state.threadEntitiesById = {};
        state.threadDetails = state.threadEntitiesById;
        state.pendingThreadIds = {};
        state.loadingThreadIds = {};
        state.interruptedThreadIds = {};
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

    function resetWorkspaceFilePreview() {
      var preview = state.workspaceFileBrowser.preview || {};
      if (preview.objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(preview.objectUrl);
      }
      state.workspaceFileBrowser.preview = {
        status: 'idle',
        fileId: null,
        contentType: null,
        text: '',
        objectUrl: null,
        error: null,
      };
    }

    function getActiveWorkspaceForFiles() {
      var workspace = api.getSelectedWorkspace();
      if (!workspace || !workspace.id) return null;
      return workspace;
    }

    function getWorkspaceFiles(workspaceId) {
      return workspaceId && state.workspaceFilesByWorkspaceId[workspaceId]
        ? state.workspaceFilesByWorkspaceId[workspaceId]
        : [];
    }

    function setWorkspaceFiles(workspaceId, files) {
      if (!workspaceId) return;
      state.workspaceFilesByWorkspaceId[workspaceId] = (files || []).slice().sort(function (left, right) {
        return String(left.relativePath || '').localeCompare(String(right.relativePath || ''));
      });
    }

    function findWorkspaceFile(workspaceId, fileId) {
      return getWorkspaceFiles(workspaceId).find(function (file) {
        return file && file.id === fileId;
      }) || null;
    }

    function openWorkspaceFileBrowser() {
      var workspace = getActiveWorkspaceForFiles();
      state.ui.fileBrowserOpen = true;
      if (workspace) state.workspaceFileBrowser.activeWorkspaceId = workspace.id;
      state.workspaceFileBrowser.error = null;
      api.notify();
      if (workspace && !getWorkspaceFiles(workspace.id).length) {
        return refreshWorkspaceFiles(false);
      }
      return Promise.resolve(null);
    }

    function closeWorkspaceFileBrowser() {
      state.ui.fileBrowserOpen = false;
      state.workspaceFileBrowser.error = null;
      api.notify();
    }

    function toggleWorkspaceFileBrowser() {
      return state.ui.fileBrowserOpen ? (closeWorkspaceFileBrowser(), Promise.resolve(null)) : openWorkspaceFileBrowser();
    }

    function refreshWorkspaceFiles(force) {
      var workspace = getActiveWorkspaceForFiles();
      if (!workspace) {
        state.workspaceFileBrowser.error = 'No workspace is selected.';
        api.notify();
        return Promise.resolve(null);
      }
      if (state.workspaceFileBrowser.loading && !force) return Promise.resolve(null);
      state.workspaceFileBrowser.loading = true;
      state.workspaceFileBrowser.error = null;
      state.workspaceFileBrowser.activeWorkspaceId = workspace.id;
      api.notify();

      return window.__tribexAiClient.listWorkspaceFiles(workspace.id)
        .then(function (result) {
          setWorkspaceFiles(workspace.id, result && result.files ? result.files : []);
          if (
            state.workspaceFileBrowser.selectedFileId &&
            !findWorkspaceFile(workspace.id, state.workspaceFileBrowser.selectedFileId)
          ) {
            state.workspaceFileBrowser.selectedType = null;
            state.workspaceFileBrowser.selectedFileId = null;
            state.workspaceFileBrowser.selectedFolderPath = '';
            resetWorkspaceFilePreview();
          }
          return result;
        })
        .catch(function (error) {
          state.workspaceFileBrowser.error = error && error.message ? error.message : String(error);
          return null;
        })
        .finally(function () {
          state.workspaceFileBrowser.loading = false;
          api.notify();
        });
    }

    function isPreviewTextType(file, contentType) {
      var type = String(contentType || file && file.contentType || '').toLowerCase();
      var path = String(file && file.relativePath || '').toLowerCase();
      return type.indexOf('text/') === 0 ||
        /json|csv|xml|yaml|markdown|javascript|typescript/.test(type) ||
        /\.(txt|md|markdown|json|csv|tsv|js|ts|tsx|jsx|css|html|xml|yaml|yml|toml|log)$/i.test(path);
    }

    function isPreviewImageType(file, contentType) {
      var type = String(contentType || file && file.contentType || '').toLowerCase();
      var path = String(file && file.relativePath || '').toLowerCase();
      return type.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
    }

    function selectWorkspaceFolder(folderPath) {
      resetWorkspaceFilePreview();
      state.workspaceFileBrowser.selectedType = 'folder';
      state.workspaceFileBrowser.selectedFileId = null;
      state.workspaceFileBrowser.selectedFolderPath = folderPath || '';
      state.workspaceFileBrowser.error = null;
      api.notify();
      return Promise.resolve(folderPath || '');
    }

    function selectWorkspaceFile(fileId) {
      var workspace = getActiveWorkspaceForFiles();
      if (!workspace) return Promise.resolve(null);
      var file = findWorkspaceFile(workspace.id, fileId);
      resetWorkspaceFilePreview();
      state.workspaceFileBrowser.selectedType = 'file';
      state.workspaceFileBrowser.selectedFileId = fileId;
      state.workspaceFileBrowser.selectedFolderPath = file && file.relativePath ? file.relativePath.split('/').slice(0, -1).join('/') : '';
      state.workspaceFileBrowser.preview = {
        status: 'loading',
        fileId: fileId,
        contentType: file && file.contentType ? file.contentType : null,
        text: '',
        objectUrl: null,
        error: null,
      };
      api.notify();

      return window.__tribexAiClient.getWorkspaceFile(workspace.id, fileId)
        .then(function (detail) {
          var detailFile = detail && detail.file ? detail.file : file;
          return window.__tribexAiClient.fetchSignedFileBytes(detail && detail.download).then(function (downloaded) {
            if (state.workspaceFileBrowser.selectedFileId !== fileId) return null;
            var contentType = downloaded.contentType || (detailFile && detailFile.contentType) || null;
            if (isPreviewTextType(detailFile, contentType)) {
              var limit = Math.min(downloaded.bytes.length, 128 * 1024);
              state.workspaceFileBrowser.preview = {
                status: 'ready',
                fileId: fileId,
                contentType: contentType,
                text: new TextDecoder('utf-8').decode(downloaded.bytes.slice(0, limit)) + (downloaded.bytes.length > limit ? '\n\n[Preview truncated]' : ''),
                objectUrl: null,
                error: null,
              };
            } else if (isPreviewImageType(detailFile, contentType)) {
              var blob = new Blob([downloaded.bytes], { type: contentType || 'application/octet-stream' });
              state.workspaceFileBrowser.preview = {
                status: 'ready',
                fileId: fileId,
                contentType: contentType,
                text: '',
                objectUrl: URL.createObjectURL(blob),
                error: null,
              };
            } else {
              state.workspaceFileBrowser.preview = {
                status: 'unsupported',
                fileId: fileId,
                contentType: contentType,
                text: '',
                objectUrl: null,
                error: null,
              };
            }
            api.notify();
            return detail;
          });
        })
        .catch(function (error) {
          if (state.workspaceFileBrowser.selectedFileId === fileId) {
            state.workspaceFileBrowser.preview = {
              status: 'error',
              fileId: fileId,
              contentType: file && file.contentType ? file.contentType : null,
              text: '',
              objectUrl: null,
              error: error && error.message ? error.message : String(error),
            };
            api.notify();
          }
          return null;
        });
    }

    function fileRelativePath(file) {
      return String((file && file.webkitRelativePath) || (file && file.name) || '').replace(/^\/+/, '');
    }

    function uploadWorkspaceFiles(fileList) {
      var workspace = getActiveWorkspaceForFiles();
      var files = Array.prototype.slice.call(fileList || []).filter(Boolean);
      if (!workspace || !files.length) return Promise.resolve(null);

      var folderMode = files.some(function (file) {
        return !!(file && file.webkitRelativePath);
      });
      state.workspaceFileBrowser.uploading = true;
      state.workspaceFileBrowser.uploadProgress = {
        total: files.length,
        completed: 0,
        label: folderMode ? 'Uploading folder' : 'Uploading files',
      };
      state.workspaceFileBrowser.error = null;
      api.notify();

      var uploadPromise = folderMode ? uploadWorkspaceFolderBatch(workspace.id, files) : uploadWorkspaceFileSet(workspace.id, files);
      return uploadPromise
        .then(function () {
          return refreshWorkspaceFiles(true);
        })
        .catch(function (error) {
          state.workspaceFileBrowser.error = error && error.message ? error.message : String(error);
          return null;
        })
        .finally(function () {
          state.workspaceFileBrowser.uploading = false;
          api.notify();
        });
    }

    function uploadWorkspaceFileSet(workspaceId, files) {
      var sequence = Promise.resolve();
      files.forEach(function (file) {
        sequence = sequence.then(function () {
          return window.__tribexAiClient.initWorkspaceFileUpload(workspaceId, {
            relativePath: fileRelativePath(file),
            contentType: file.type || null,
            sizeBytes: file.size || 0,
          }).then(function (init) {
            return window.__tribexAiClient.uploadWorkspaceFileToSignedUrl(init.upload, file);
          }).then(function () {
            state.workspaceFileBrowser.uploadProgress.completed += 1;
            api.notify();
          });
        });
      });
      return sequence;
    }

    function uploadWorkspaceFolderBatch(workspaceId, files) {
      var metadata = {
        uploadedFrom: 'mcpviews-file-browser',
        fileCount: files.length,
      };
      return window.__tribexAiClient.createWorkspaceFileBatch(workspaceId, files.map(function (file) {
        return {
          relativePath: fileRelativePath(file),
          contentType: file.type || null,
          sizeBytes: file.size || 0,
        };
      }), metadata).then(function (batch) {
        var byPath = {};
        files.forEach(function (file) {
          byPath[fileRelativePath(file)] = file;
        });
        var items = batch && batch.items ? batch.items : [];
        var index = 0;
        var workers = [0, 1, 2].map(function () {
          function next() {
            if (index >= items.length) return Promise.resolve();
            var item = items[index++];
            var file = byPath[item.relativePath];
            if (!file) return next();
            return window.__tribexAiClient.uploadWorkspaceFileToSignedUrl(item.upload, file)
              .then(function () {
                state.workspaceFileBrowser.uploadProgress.completed += 1;
                api.notify();
              })
              .then(next);
          }
          return next();
        });
        return Promise.all(workers).then(function () {
          return window.__tribexAiClient.finalizeWorkspaceFileBatch(workspaceId, batch.batch && batch.batch.id);
        });
      });
    }

    function getSelectedWorkspaceFiles() {
      var workspace = getActiveWorkspaceForFiles();
      if (!workspace) return [];
      if (state.workspaceFileBrowser.selectedType === 'file') {
        var file = findWorkspaceFile(workspace.id, state.workspaceFileBrowser.selectedFileId);
        return file ? [file] : [];
      }
      var folder = state.workspaceFileBrowser.selectedFolderPath || '';
      var prefix = folder ? folder.replace(/\/+$/g, '') + '/' : '';
      return getWorkspaceFiles(workspace.id).filter(function (file) {
        return file && (!prefix || String(file.relativePath || '').indexOf(prefix) === 0);
      });
    }

    function buildStoredZip(files) {
      var encoder = new TextEncoder();
      var localParts = [];
      var centralParts = [];
      var offset = 0;
      var centralLength = 0;

      files.forEach(function (entry) {
        var nameBytes = encoder.encode(entry.path);
        var crc = crc32(entry.bytes);
        var local = new Uint8Array(30 + nameBytes.length);
        var localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(10, 0, true);
        localView.setUint16(12, 0, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, entry.bytes.length, true);
        localView.setUint32(22, entry.bytes.length, true);
        localView.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        localParts.push(local, entry.bytes);

        var central = new Uint8Array(46 + nameBytes.length);
        var centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(12, 0, true);
        centralView.setUint16(14, 0, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, entry.bytes.length, true);
        centralView.setUint32(24, entry.bytes.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centralParts.push(central);
        centralLength += central.length;
        offset += local.length + entry.bytes.length;
      });

      var end = new Uint8Array(22);
      var endView = new DataView(end.buffer);
      endView.setUint32(0, 0x06054b50, true);
      endView.setUint16(8, files.length, true);
      endView.setUint16(10, files.length, true);
      endView.setUint32(12, centralLength, true);
      endView.setUint32(16, offset, true);
      var totalLength = offset + centralLength + end.length;
      var result = new Uint8Array(totalLength);
      var cursor = 0;
      localParts.concat(centralParts, [end]).forEach(function (part) {
        result.set(part, cursor);
        cursor += part.length;
      });
      return result;
    }

    var crcTable = null;
    function crc32(bytes) {
      if (!crcTable) {
        crcTable = [];
        for (var n = 0; n < 256; n += 1) {
          var c = n;
          for (var k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          }
          crcTable[n] = c >>> 0;
        }
      }
      var crc = 0xffffffff;
      for (var index = 0; index < bytes.length; index += 1) {
        crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    function downloadSelectedWorkspaceEntry() {
      var workspace = getActiveWorkspaceForFiles();
      var files = getSelectedWorkspaceFiles();
      if (!workspace || !files.length) return Promise.resolve(null);

      state.workspaceFileBrowser.downloading = true;
      state.workspaceFileBrowser.downloadProgress = {
        total: files.length,
        completed: 0,
        label: files.length === 1 ? 'Downloading file' : 'Building folder zip',
      };
      state.workspaceFileBrowser.error = null;
      api.notify();

      if (files.length === 1 && state.workspaceFileBrowser.selectedType === 'file') {
        var file = files[0];
        return window.__tribexAiClient.getWorkspaceFile(workspace.id, file.id)
          .then(function (detail) {
            return window.__tribexAiClient.fetchSignedFileBytes(detail && detail.download).then(function (downloaded) {
              state.workspaceFileBrowser.downloadProgress.completed = 1;
              api.notify();
              return window.__tribexAiClient.triggerByteDownload(file.name || file.relativePath, downloaded.bytes, downloaded.contentType || file.contentType);
            });
          })
          .catch(function (error) {
            state.workspaceFileBrowser.error = error && error.message ? error.message : String(error);
          })
          .finally(function () {
            state.workspaceFileBrowser.downloading = false;
            api.notify();
          });
      }

      var zipEntries = [];
      var sequence = Promise.resolve();
      files.forEach(function (file) {
        sequence = sequence.then(function () {
          return window.__tribexAiClient.getWorkspaceFile(workspace.id, file.id)
            .then(function (detail) {
              return window.__tribexAiClient.fetchSignedFileBytes(detail && detail.download);
            })
            .then(function (downloaded) {
              zipEntries.push({
                path: file.relativePath,
                bytes: downloaded.bytes,
              });
              state.workspaceFileBrowser.downloadProgress.completed += 1;
              api.notify();
            });
        });
      });

      return sequence
        .then(function () {
          var folder = state.workspaceFileBrowser.selectedFolderPath || workspace.name || 'workspace-files';
          var name = String(folder).split('/').filter(Boolean).pop() || 'workspace-files';
          return window.__tribexAiClient.triggerByteDownload(name + '.zip', buildStoredZip(zipEntries), 'application/zip');
        })
        .catch(function (error) {
          state.workspaceFileBrowser.error = error && error.message ? error.message : String(error);
        })
        .finally(function () {
          state.workspaceFileBrowser.downloading = false;
          api.notify();
        });
    }

    function deleteSelectedWorkspaceFile() {
      var workspace = getActiveWorkspaceForFiles();
      if (!workspace || state.workspaceFileBrowser.selectedType !== 'file' || !state.workspaceFileBrowser.selectedFileId) {
        return Promise.resolve(null);
      }
      var fileId = state.workspaceFileBrowser.selectedFileId;
      state.workspaceFileBrowser.error = null;
      return window.__tribexAiClient.deleteWorkspaceFile(workspace.id, fileId)
        .then(function () {
          setWorkspaceFiles(workspace.id, getWorkspaceFiles(workspace.id).filter(function (file) {
            return file && file.id !== fileId;
          }));
          state.workspaceFileBrowser.selectedType = null;
          state.workspaceFileBrowser.selectedFileId = null;
          resetWorkspaceFilePreview();
        })
        .catch(function (error) {
          state.workspaceFileBrowser.error = error && error.message ? error.message : String(error);
        })
        .finally(function () {
          api.notify();
        });
    }

    function refreshActiveThread() {
      if (!context.activeSession || !context.activeSession.threadId) return Promise.resolve(null);
      return refreshThread(context.activeSession.threadId, true);
    }

    function syncPausePolling() {
      var threadId = context.activeSession && context.activeSession.threadId
        ? context.activeSession.threadId
        : null;
      var thread = threadId ? api.getThread(threadId) : null;
      var activePause = thread && thread.activePause ? thread.activePause : null;
      if (
        !threadId ||
        !activePause ||
        String(activePause.status || '').toUpperCase() !== 'BLOCKED'
      ) {
        stopPausePolling();
        return;
      }
      if (thread.pauseCheckState === 'checking') {
        return;
      }
      if (
        context.pausePolling &&
        context.pausePolling.threadId === threadId &&
        context.pausePolling.timeoutId
      ) {
        return;
      }
      if (context.pausePolling && context.pausePolling.threadId !== threadId) {
        stopPausePolling();
      }
      schedulePausePolling(threadId, resolvePausePollDelay(context.pausePolling ? context.pausePolling.attempt : 0));
    }

    function checkThreadPause(threadId, threadPauseId, options) {
      options = options || {};
      if (!threadId || !threadPauseId || !window.__tribexAiClient || typeof window.__tribexAiClient.checkThreadPause !== 'function') {
        return Promise.resolve(null);
      }
      state.threadErrors[threadId] = null;
      var thread = api.getThread(threadId);
      if (thread) {
        if (!options.silent) {
          thread.pauseCheckState = 'checking';
        }
      }
      if (!options.silent) {
        api.notify();
      }

      return window.__tribexAiClient.checkThreadPause(threadId, threadPauseId)
        .then(function (result) {
          var currentThread = api.getThread(threadId);
          var activePause = result && result.activePause ? result.activePause : null;
          if (activePause && api.filterContinuedPause) {
            activePause = api.filterContinuedPause(threadId, activePause);
          }
          if (activePause && !activePause.resumeMode) {
            activePause.resumeMode = result && result.resumeMode ? result.resumeMode : 'MANUAL';
          }
          if (currentThread) {
            currentThread.pauseCheckState = null;
            currentThread.activePause = activePause;
            currentThread.lastHydratedAt = api.nowIso();
            if (activePause) {
              currentThread.rowState = String(activePause.status || '').toUpperCase() === 'READY'
                ? 'ready-to-continue'
                : 'waiting-on-user';
            } else if (result && result.didResume) {
              currentThread.rowState = 'pending';
            } else if (
              currentThread.rowState === 'waiting-on-user' ||
              currentThread.rowState === 'ready-to-continue'
            ) {
              currentThread.rowState = null;
            }
          }
          if (result && result.didResume) {
            stopPausePolling();
            refreshThread(threadId, true).catch(function () {
              return null;
            });
          } else if (!activePause || String(activePause.status || '').toUpperCase() !== 'BLOCKED') {
            stopPausePolling();
          } else if (!(options && options.source === 'poll') && context.pausePolling) {
            context.pausePolling.attempt = 0;
          }
          api.notify();
          return result;
        })
        .catch(function (error) {
          state.threadErrors[threadId] = error && error.message ? error.message : String(error);
          var failedThread = api.getThread(threadId);
          if (failedThread) {
            failedThread.pauseCheckState = null;
          }
          api.notify();
          throw error;
        });
    }

    function continueThreadPause(threadId, threadPauseId, note) {
      if (!threadId || !threadPauseId || !window.__tribexAiClient || typeof window.__tribexAiClient.continueThreadPause !== 'function') {
        return Promise.resolve(null);
      }
      stopPausePolling();
      state.threadErrors[threadId] = null;
      var thread = api.getThread(threadId);
      var previousPause = thread && thread.activePause ? Object.assign({}, thread.activePause) : null;
      if (api.markPauseContinued) {
        api.markPauseContinued(threadId, threadPauseId);
      }
      if (thread) {
        thread.rowState = 'pending';
        thread.pauseCheckState = null;
        thread.activePause = null;
      }
      api.notify();
      return window.__tribexAiClient.continueThreadPause(threadId, threadPauseId, note || '')
        .then(function (result) {
          var detail = (state.threadDetails && state.threadDetails[threadId])
            || (state.threadEntitiesById && state.threadEntitiesById[threadId])
            || null;
          if (detail) {
            detail.activePause = null;
          }
          var currentThread = api.getThread(threadId);
          if (currentThread) {
            currentThread.rowState = 'pending';
          }
          refreshThread(threadId, true).catch(function () {});
          api.notify();
          return result;
        })
        .catch(function (error) {
          if (api.clearPauseContinued) {
            api.clearPauseContinued(threadId, threadPauseId);
          }
          state.threadErrors[threadId] = error && error.message ? error.message : String(error);
          var failedThread = api.getThread(threadId);
          if (failedThread) {
            failedThread.activePause = previousPause;
            failedThread.rowState = 'ready-to-continue';
          }
          api.notify();
          throw error;
        });
    }

    api.refreshNavigator = refreshNavigator;
    api.ensureCompanion = ensureCompanion;
    api.buildSmokeThreadTitle = buildSmokeThreadTitle;
    api.ensureDesktopRelay = ensureDesktopRelay;
    api.refreshThread = refreshThread;
    api.hydrateThread = hydrateThread;
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
    api.interruptThread = interruptThread;
    api.setActiveSession = setActiveSession;
    api.buildThreadArtifactSessionConfig = buildThreadArtifactSessionConfig;
    api.openThreadArtifact = openThreadArtifact;
    api.selectThreadArtifact = selectThreadArtifact;
    api.onSessionClosed = onSessionClosed;
    api.renameProject = renameProject;
    api.renameThread = renameThread;
    api.createProject = createProject;
    api.connect = connect;
    api.sendMagicLink = sendMagicLink;
    api.verifyMagicLink = verifyMagicLink;
    api.clearConnection = clearConnection;
    api.checkThreadPause = checkThreadPause;
    api.refreshActiveThread = refreshActiveThread;
    api.continueThreadPause = continueThreadPause;
    api.schedulePauseCheckBurst = schedulePauseCheckBurst;
    api.syncPausePolling = syncPausePolling;
    api.openWorkspaceFileBrowser = openWorkspaceFileBrowser;
    api.closeWorkspaceFileBrowser = closeWorkspaceFileBrowser;
    api.toggleWorkspaceFileBrowser = toggleWorkspaceFileBrowser;
    api.refreshWorkspaceFiles = refreshWorkspaceFiles;
    api.selectWorkspaceFile = selectWorkspaceFile;
    api.selectWorkspaceFolder = selectWorkspaceFolder;
    api.uploadWorkspaceFiles = uploadWorkspaceFiles;
    api.downloadSelectedWorkspaceEntry = downloadSelectedWorkspaceEntry;
    api.deleteSelectedWorkspaceFile = deleteSelectedWorkspaceFile;

    return api;
  };
})();
