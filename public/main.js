// @ts-nocheck
/* MCPViews — Tauri WebView client
 * Multi-session tab bar with Tauri IPC events.
 */

(function () {
  'use strict';

  let activeSessionId = null;

  /** @type {Map<string, {toolName: string, contentType: string, data: unknown, meta: Record<string, unknown>, toolArgs: Record<string, unknown>, reviewRequired: boolean, timestamp: number}>} */
  const sessions = new Map();

  // DOM refs
  const contentArea = document.getElementById('content-area');
  const mainTitle = document.getElementById('main-title');
  const connectionDot = document.getElementById('connection-dot');
  const connectionText = document.getElementById('connection-text');
  const tabBar = document.getElementById('tab-bar');
  const refreshButton = document.getElementById('refresh-button');
  const aiShellToggleButton = document.getElementById('ai-shell-toggle-button');
  const aiHomeButton = document.getElementById('ai-home-button');
  const updateBanner = document.getElementById('update-banner');
  const updateBannerTitle = document.getElementById('update-banner-title');
  const updateBannerMessage = document.getElementById('update-banner-message');
  const updateInstallButton = document.getElementById('update-install-button');
  const updateChangelogButton = document.getElementById('update-changelog-button');
  const updateDismissButton = document.getElementById('update-dismiss-button');

  let aiWorkspaceAvailable = false;
  let aiWorkspaceConfig = null;
  let pendingAppUpdate = null;
  let pendingAppUpdateAction = null;
  let appUpdateCheckTimer = null;
  let dismissedAppUpdateVersionFallback = '';
  let dismissedAppUpdateFailureFallback = null;

  const UPDATE_DISMISSED_VERSION_KEY = 'mcpviews-dismissed-update-version';
  const UPDATE_DISMISSED_FAILURE_KEY = 'mcpviews-dismissed-update-check-failure';
  const UPDATE_FAILURE_DISMISS_MS = 4 * 60 * 60 * 1000;
  const DECIDR_ONBOARDING_RENDERER = 'decidr_onboarding';
  const DECIDR_ONBOARDING_COMPLETED_KEY = 'decidr-onboarding:agent-configured-org-id';
  const EXTERNAL_WEB_CONTENT_TYPE = 'external_web_page';
  const APPS_POPUP_WIDTH = 260;
  const APPS_POPUP_MAX_HEIGHT = 360;
  const APPS_POPUP_MIN_WIDTH = 180;
  const APPS_POPUP_MIN_HEIGHT = 140;
  const APPS_POPUP_MARGIN = 8;
  const NATIVE_APP_OVERLAY_BOUNDS = Object.freeze({
    x: -10000,
    y: -10000,
    width: 1,
    height: 1,
    visible: false,
  });

  function isWindowsRuntime() {
    var nav = window.navigator || {};
    var userAgent = String(nav.userAgent || '');
    var platform = String(nav.platform || '');
    return /Windows/i.test(userAgent) || /^Win/i.test(platform);
  }

  function supportsNativeAppPanels() {
    return !isWindowsRuntime();
  }

  /** @type {Map<string, HTMLElement>} Cached content containers per session */
  const contentCache = new Map();

  /** @type {Map<string, {deadline: number, intervalId: number}>} Countdown timers per review session */
  const countdownTimers = new Map();

  let nativeAppOverlayActive = false;
  const nativeAppPanels = new Map();

  // --- Heartbeat ---
  let heartbeatInterval = null;
  let lastActivity = Date.now();

  function nativeAppBounds(bounds) {
    bounds = bounds || {};
    return {
      x: Number.isFinite(bounds.x) ? bounds.x : 0,
      y: Number.isFinite(bounds.y) ? bounds.y : 0,
      width: Number.isFinite(bounds.width) ? bounds.width : 1,
      height: Number.isFinite(bounds.height) ? bounds.height : 1,
      visible: bounds.visible !== false,
    };
  }

  function nativeAppBoundsForOverlay(bounds) {
    var normalized = nativeAppBounds(bounds);
    if (nativeAppOverlayActive) return Object.assign({}, NATIVE_APP_OVERLAY_BOUNDS);
    return normalized;
  }

  function rememberNativeAppPanel(label, bounds) {
    if (!label) return;
    nativeAppPanels.set(label, { bounds: nativeAppBounds(bounds) });
  }

  function forgetNativeAppPanel(label) {
    if (!label) return;
    nativeAppPanels.delete(label);
  }

  function applyNativeAppOverlayBounds() {
    if (!window.__TAURI__ || !window.__TAURI__.core || nativeAppPanels.size === 0) {
      return Promise.resolve();
    }
    var updates = [];
    nativeAppPanels.forEach(function (record, label) {
      updates.push(window.__TAURI__.core.invoke('update_native_app_panel_bounds', {
        label: label,
        bounds: nativeAppBoundsForOverlay(record.bounds),
      }).catch(function (error) {
        console.warn('Failed to update native app panel overlay bounds:', error);
      }));
    });
    return Promise.all(updates);
  }

  function openNativeAppView(options) {
    options = options || {};
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.reject(new Error('Native app views are only available in MCPViews desktop.'));
    }
    return window.__TAURI__.core.invoke('open_native_app_view', {
      pluginName: options.pluginName || options.plugin_name || '',
      url: options.url || '',
      title: options.title || null,
      label: options.label || null,
    });
  }

  function mountNativeAppView(options) {
    options = options || {};
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.reject(new Error('Native app panels are only available in MCPViews desktop.'));
    }
    if (!supportsNativeAppPanels()) {
      return Promise.reject(new Error('Native app panels are disabled on Windows.'));
    }
    var requestedBounds = nativeAppBounds(options.bounds);
    return window.__TAURI__.core.invoke('mount_native_app_panel', {
      pluginName: options.pluginName || options.plugin_name || '',
      url: options.url || '',
      title: options.title || null,
      label: options.label || null,
      bounds: nativeAppBoundsForOverlay(requestedBounds),
    }).then(function (result) {
      rememberNativeAppPanel(result && result.label ? result.label : options.label, requestedBounds);
      return result;
    });
  }

  function mountExternalWebPanel(options) {
    options = options || {};
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.reject(new Error('External web tabs are only available in MCPViews desktop.'));
    }
    if (!supportsNativeAppPanels()) {
      return Promise.reject(new Error('External web panels are disabled on Windows.'));
    }
    var requestedBounds = nativeAppBounds(options.bounds);
    return window.__TAURI__.core.invoke('mount_external_web_panel', {
      url: options.url || '',
      title: options.title || null,
      label: options.label || null,
      sessionId: options.sessionId || options.session_id || null,
      returnOrigins: Array.isArray(options.returnOrigins) ? options.returnOrigins : [],
      bounds: nativeAppBoundsForOverlay(requestedBounds),
    }).then(function (result) {
      rememberNativeAppPanel(result && result.label ? result.label : options.label, requestedBounds);
      return result;
    });
  }

  function updateNativeAppViewBounds(options) {
    options = options || {};
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.reject(new Error('Native app panels are only available in MCPViews desktop.'));
    }
    if (!supportsNativeAppPanels()) {
      return Promise.reject(new Error('Native app panels are disabled on Windows.'));
    }
    var label = options.label || '';
    var requestedBounds = nativeAppBounds(options.bounds);
    rememberNativeAppPanel(label, requestedBounds);
    return window.__TAURI__.core.invoke('update_native_app_panel_bounds', {
      label: label,
      bounds: nativeAppBoundsForOverlay(requestedBounds),
    });
  }

  function closeNativeAppView(options) {
    options = options || {};
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.reject(new Error('Native app panels are only available in MCPViews desktop.'));
    }
    if (!supportsNativeAppPanels()) {
      return Promise.resolve({ label: options.label || '', updated: false, visible: false });
    }
    var label = options.label || '';
    forgetNativeAppPanel(label);
    return window.__TAURI__.core.invoke('close_native_app_panel', {
      label: label,
    });
  }

  function emitSessionVisibilityChanged(detail) {
    try {
      window.dispatchEvent(new CustomEvent('mcpviews:session-visibility-changed', {
        detail: Object.assign({ activeSessionId: activeSessionId }, detail || {}),
      }));
    } catch (_error) {}
  }

  function setNativeAppOverlayActive(active, reason) {
    var next = !!active;
    var changed = nativeAppOverlayActive !== next;
    nativeAppOverlayActive = next;
    document.body.classList.toggle('native-app-overlay-active', next);
    if (!changed) {
      return Promise.resolve();
    }
    if (changed) {
      try {
        window.dispatchEvent(new CustomEvent('mcpviews:native-app-overlay-changed', {
          detail: { active: next, reason: reason || null },
        }));
      } catch (_error) {}
    }
    return applyNativeAppOverlayBounds();
  }

  function appsPopupBounds(anchor) {
    var viewportWidth = Math.max(window.innerWidth || APPS_POPUP_WIDTH, APPS_POPUP_MIN_WIDTH + APPS_POPUP_MARGIN * 2);
    var viewportHeight = Math.max(window.innerHeight || APPS_POPUP_MAX_HEIGHT, APPS_POPUP_MIN_HEIGHT + APPS_POPUP_MARGIN * 2);
    var rect = anchor && typeof anchor.getBoundingClientRect === 'function'
      ? anchor.getBoundingClientRect()
      : { right: viewportWidth - APPS_POPUP_MARGIN, bottom: APPS_POPUP_MARGIN };
    var width = Math.min(APPS_POPUP_WIDTH, Math.max(APPS_POPUP_MIN_WIDTH, viewportWidth - APPS_POPUP_MARGIN * 2));
    var height = Math.min(APPS_POPUP_MAX_HEIGHT, Math.max(APPS_POPUP_MIN_HEIGHT, viewportHeight - APPS_POPUP_MARGIN * 2));
    var x = rect.right - width;
    var y = rect.bottom + APPS_POPUP_MARGIN;
    x = Math.max(APPS_POPUP_MARGIN, Math.min(x, viewportWidth - width - APPS_POPUP_MARGIN));
    if (y + height > viewportHeight - APPS_POPUP_MARGIN) {
      y = Math.max(APPS_POPUP_MARGIN, viewportHeight - height - APPS_POPUP_MARGIN);
    }
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  function openNativeAppsPopup(anchor) {
    if (!window.__TAURI__ || !window.__TAURI__.core || typeof window.__TAURI__.core.invoke !== 'function') {
      return Promise.resolve(false);
    }
    return window.__TAURI__.core.invoke('open_apps_popup', {
      bounds: appsPopupBounds(anchor),
    }).then(function (result) {
      return !!(result && result.opened === true);
    }).catch(function (error) {
      console.warn('[apps] Falling back to DOM apps dropdown:', error);
      return false;
    });
  }

  function closeNativeAppsPopup() {
    if (!window.__TAURI__ || !window.__TAURI__.core || typeof window.__TAURI__.core.invoke !== 'function') {
      return;
    }
    window.__TAURI__.core.invoke('close_apps_popup').catch(function () {});
  }

  window.__mcpviewsHost = window.__mcpviewsHost || {};
  window.__mcpviewsHost.openNativeAppView = openNativeAppView;
  window.__mcpviewsHost.openExternalUrlInTab = openExternalUrlInTab;
  window.__mcpviewsHost.supportsNativeAppPanels = supportsNativeAppPanels;
  if (supportsNativeAppPanels()) {
    window.__mcpviewsHost.mountNativeAppView = mountNativeAppView;
    window.__mcpviewsHost.updateNativeAppViewBounds = updateNativeAppViewBounds;
    window.__mcpviewsHost.closeNativeAppView = closeNativeAppView;
    window.__mcpviewsHost.mountExternalWebPanel = mountExternalWebPanel;
  }
  window.__mcpviewsHost.isNativeAppOverlayActive = function () {
    return nativeAppOverlayActive;
  };

  function isAiWorkspaceConfigured(config) {
    return !!(config && config.configured === true);
  }

  function closeAiWorkspaceIfUnavailable() {
    if (aiWorkspaceAvailable) return;
    if (
      window.__tribexAiState &&
      typeof window.__tribexAiState.getSnapshot === 'function' &&
      typeof window.__tribexAiState.toggleNavigator === 'function'
    ) {
      var snapshot = window.__tribexAiState.getSnapshot();
      if (snapshot && snapshot.navigatorVisible) {
        window.__tribexAiState.toggleNavigator();
        return;
      }
    }
    if (window.__tribexAiShell && typeof window.__tribexAiShell.hide === 'function') {
      window.__tribexAiShell.hide();
    }
  }

  function applyAiWorkspaceAvailability(config) {
    aiWorkspaceConfig = config || null;
    aiWorkspaceAvailable = isAiWorkspaceConfigured(config);

    if (aiHomeButton) {
      aiHomeButton.style.display = aiWorkspaceAvailable ? '' : 'none';
      aiHomeButton.hidden = !aiWorkspaceAvailable;
      aiHomeButton.setAttribute('aria-hidden', aiWorkspaceAvailable ? 'false' : 'true');
    }
    if (aiShellToggleButton && !aiWorkspaceAvailable) {
      aiShellToggleButton.style.display = 'none';
    }
    document.body.classList.toggle('ai-workspace-available', aiWorkspaceAvailable);

    if (!aiWorkspaceAvailable) {
      closeAiWorkspaceIfUnavailable();
    }
    if (!activeSessionId) {
      renderEmpty();
    }
    return aiWorkspaceConfig;
  }

  function refreshAiWorkspaceAvailability() {
    if (!window.__tribexAiClient || typeof window.__tribexAiClient.getConfig !== 'function') {
      return Promise.resolve(applyAiWorkspaceAvailability(null));
    }
    return window.__tribexAiClient.getConfig()
      .then(function (config) {
        return applyAiWorkspaceAvailability(config);
      })
      .catch(function () {
        return applyAiWorkspaceAvailability(null);
      });
  }

  function startHeartbeat(sessionId) {
    stopHeartbeat();
    lastActivity = Date.now();

    var heartbeatDebounceTimer = null;
    var onActivity = function () {
      lastActivity = Date.now();
      if (activeSessionId) resetCountdown(activeSessionId);
      // Send immediate debounced heartbeat to keep server deadline in sync
      if (!heartbeatDebounceTimer) {
        heartbeatDebounceTimer = setTimeout(function () {
          heartbeatDebounceTimer = null;
        }, 5000);
        fetch('http://localhost:4200/api/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        }).catch(function () {});
      }
    };
    contentArea.addEventListener('click', onActivity);
    contentArea.addEventListener('scroll', onActivity);
    contentArea.addEventListener('keydown', onActivity);
    contentArea.addEventListener('input', onActivity);

    // Store cleanup ref
    contentArea._heartbeatCleanup = function () {
      contentArea.removeEventListener('click', onActivity);
      contentArea.removeEventListener('scroll', onActivity);
      contentArea.removeEventListener('keydown', onActivity);
      contentArea.removeEventListener('input', onActivity);
    };

    heartbeatInterval = window.setInterval(function () {
      // Only send if user was active in last 60s
      if (Date.now() - lastActivity < 60000) {
        fetch('http://localhost:4200/api/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        }).catch(function () {});
      }
    }, 30000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (contentArea._heartbeatCleanup) {
      contentArea._heartbeatCleanup();
      contentArea._heartbeatCleanup = null;
    }
  }

  // --- Tab Bar ---

  function renderTabBar() {
    tabBar.innerHTML = '';
    if (sessions.size === 0) {
      tabBar.style.display = 'none';
      return;
    }
    tabBar.style.display = 'flex';

    sessions.forEach(function (session, sessionId) {
      var tab = document.createElement('div');
      tab.className = 'tab' + (sessionId === activeSessionId ? ' active' : '');
      tab.setAttribute('data-session-id', sessionId);

      if (session.reviewRequired) {
        var dot = document.createElement('span');
        dot.className = 'review-dot';
        tab.appendChild(dot);
      }

      var label = getTabLabel(session);
      var nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = label;
      nameSpan.title = label;
      tab.appendChild(nameSpan);

      if (session.reviewRequired && countdownTimers.has(sessionId)) {
        var timerSpan = document.createElement('span');
        timerSpan.className = 'tab-timer';
        tab.appendChild(timerSpan);
        // Will be updated by updateCountdownDisplay on next tick
      }

      var closeBtn = document.createElement('span');
      closeBtn.className = 'close-btn';
      closeBtn.textContent = '\u00d7';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeTab(sessionId);
      });
      tab.appendChild(closeBtn);

      tab.addEventListener('click', function () {
        selectSession(sessionId);
      });

      tabBar.appendChild(tab);
    });

    // Update countdown displays after DOM is built
    countdownTimers.forEach(function (_, sid) {
      updateCountdownDisplay(sid);
    });
  }

  function removeSession(sessionId) {
    var removedSession = sessions.get(sessionId) || null;
    emitSessionVisibilityChanged({ sessionId: sessionId, active: false, removed: true });
    // Close drawers and citation panel scoped to this session
    var utils = window.__companionUtils;
    if (utils) {
      if (utils.closeSessionDrawers) utils.closeSessionDrawers(sessionId);
      if (utils.closeSessionCitation) utils.closeSessionCitation(sessionId);
    }
    stopHeartbeat();
    stopCountdown(sessionId);
    sessions.delete(sessionId);

    // Remove cached content container
    var cached = contentCache.get(sessionId);
    if (cached && cached.parentNode) {
      cached.parentNode.removeChild(cached);
    }
    contentCache.delete(sessionId);

    if (removedSession && window.__tribexAiState && typeof window.__tribexAiState.onSessionClosed === 'function') {
      window.__tribexAiState.onSessionClosed(sessionId, removedSession);
    }

    if (sessionId === activeSessionId) {
      activeSessionId = null;
      var keys = Array.from(sessions.keys());
      if (keys.length > 0) {
        selectSession(keys[keys.length - 1]);
      } else {
        renderEmpty();
        renderTabBar();
      }
    } else {
      renderTabBar();
    }
  }

  function closeTab(sessionId) {
    // Dismiss session via Tauri IPC (handles review dismissal too)
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke('dismiss_session', {
        sessionId: sessionId,
      }).catch(function (err) {
        console.error('Failed to dismiss session:', err);
      });
    }

    removeSession(sessionId);
  }

  // --- Countdown Timer ---

  function startCountdown(sessionId, timeoutSecs) {
    stopCountdown(sessionId);
    var deadline = Date.now() + (timeoutSecs * 1000);
    var intervalId = window.setInterval(function () {
      updateCountdownDisplay(sessionId);
    }, 1000);
    countdownTimers.set(sessionId, { deadline: deadline, intervalId: intervalId });
    updateCountdownDisplay(sessionId);
  }

  function resetCountdown(sessionId) {
    var timer = countdownTimers.get(sessionId);
    if (!timer) return;
    var session = sessions.get(sessionId);
    var timeoutSecs = (session && session.timeoutSecs) || 120;
    timer.deadline = Date.now() + (timeoutSecs * 1000);
    updateCountdownDisplay(sessionId);
  }

  function stopCountdown(sessionId) {
    var timer = countdownTimers.get(sessionId);
    if (timer) {
      clearInterval(timer.intervalId);
      countdownTimers.delete(sessionId);
    }
  }

  function updateCountdownDisplay(sessionId) {
    var timer = countdownTimers.get(sessionId);
    var timerEl = tabBar.querySelector('.tab[data-session-id="' + sessionId + '"] .tab-timer');
    if (!timer || !timerEl) return;
    var remaining = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000));
    if (remaining <= 0) {
      timerEl.textContent = 'Pending';
      timerEl.classList.add('urgent');
      timerEl.classList.add('pending');
      return;
    }
    var mins = Math.floor(remaining / 60);
    var secs = remaining % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
    timerEl.classList.remove('pending');
    if (remaining <= 30) {
      timerEl.classList.add('urgent');
    } else {
      timerEl.classList.remove('urgent');
    }
  }

  // --- Tauri IPC ---

  async function initTauri() {
    // Wait for Tauri APIs to be available
    if (!window.__TAURI__) {
      // In dev mode without Tauri, fall back to polling localhost:4200
      console.log('Tauri API not available, running in standalone browser mode');
      connectionDot.classList.remove('connected');
      connectionText.textContent = 'Browser Mode';
      return;
    }

    const { listen } = window.__TAURI__.event;
    const { invoke } = window.__TAURI__.core;
    startAppUpdateChecks();

    // Listen for push events from Rust backend
    await listen('push_preview', function (event) {
      const session = event.payload;
      handlePush(session);
    });

    await listen('external_web_tab_open_requested', function (event) {
      var payload = event && event.payload ? event.payload : {};
      if (!payload.url) return;
      openExternalUrlInTab(payload.url, {
        title: payload.title || null,
        returnOrigins: Array.isArray(payload.returnOrigins) ? payload.returnOrigins : [],
      });
    });

    await listen('external_web_panel_close_requested', function (event) {
      var payload = event && event.payload ? event.payload : {};
      var sessionId = payload.sessionId || payload.session_id || null;
      if (sessionId && sessions.has(sessionId)) {
        removeSession(sessionId);
      }
    });

    // Load plugin renderers before rendering any sessions
    await loadPluginRenderers();

    // Load any existing sessions on startup (after renderers are ready)
    try {
      const existingSessions = await invoke('get_sessions');
      if (existingSessions && existingSessions.length > 0) {
        existingSessions.forEach(function (session) {
          handlePush(session, { autoFocus: false });
        });
        var preferredSession = existingSessions.slice().reverse().find(function (session) {
          return session && session.meta && session.meta.aiView === 'thread';
        }) || existingSessions[existingSessions.length - 1];
        if (preferredSession && preferredSession.sessionId) {
          selectSession(preferredSession.sessionId);
        }
      }
    } catch (e) {
      console.error('Failed to load existing sessions:', e);
    }

    maybeAutoOpenDecidrOnboarding();

    // Populate invocation registry
    if (window.__companionUtils && window.__companionUtils.populateRendererRegistry) {
      window.__companionUtils.populateRendererRegistry();
    }

    // Reload renderers when a plugin is installed
    await listen('reload_renderers', function () {
      loadPluginRenderers();
      // Populate invocation registry
      if (window.__companionUtils && window.__companionUtils.populateRendererRegistry) {
        window.__companionUtils.populateRendererRegistry();
      }
    });

    connectionDot.classList.add('connected');
    connectionText.textContent = 'Ready';
  }

  async function loadPluginRenderers() {
    if (!window.__TAURI__) return;
    try {
      var renderers = await window.__TAURI__.core.invoke('get_plugin_renderers');

      // Inject plugin config before loading any renderer scripts.
      // Renderers read window.__mcpviews_plugins[pluginName] for their MCP URL.
      window.__mcpviews_plugins = window.__mcpviews_plugins || {};
      renderers.forEach(function (renderer) {
        window.__mcpviews_plugins[renderer.plugin_name] = Object.assign(
          {},
          window.__mcpviews_plugins[renderer.plugin_name] || {},
          {
            mcp_url: renderer.mcp_url || null,
            frame_origins: renderer.frame_origins || [],
          },
        );
      });

      var loadPromises = [];
      renderers.forEach(function (renderer) {
        var rendererKey = renderer.plugin_name + '/' + renderer.file_name;
        var existing = document.querySelector('script[data-plugin-renderer="' + rendererKey + '"]');
        var existingSrc = existing ? existing.getAttribute('src') : null;
        if (existing && existingSrc === renderer.url) return;
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        var promise = new Promise(function (resolve) {
          var script = document.createElement('script');
          script.src = renderer.url;
          script.setAttribute('data-plugin-renderer', rendererKey);
          script.onload = resolve;
          script.onerror = function () {
            console.error('[mcpviews] Failed to load plugin renderer:', renderer.url);
            resolve(); // resolve anyway so other renderers aren't blocked
          };
          document.head.appendChild(script);
        });
        loadPromises.push(promise);
      });
      await Promise.all(loadPromises);
    } catch (e) {
      console.error('[mcpviews] Failed to load plugin renderers:', e);
    }
  }

  function isDecidrOnboardingCompleted() {
    try {
      return !!localStorage.getItem(DECIDR_ONBOARDING_COMPLETED_KEY);
    } catch (_error) {
      return false;
    }
  }

  function hasSessionForRenderer(rendererName) {
    var found = false;
    sessions.forEach(function (session) {
      if (found) return;
      found = !!(session && session.contentType === rendererName);
    });
    return found;
  }

  function maybeAutoOpenDecidrOnboarding() {
    var renderers = window.__renderers || {};
    if (typeof renderers[DECIDR_ONBOARDING_RENDERER] !== 'function') return;
    if (isDecidrOnboardingCompleted()) return;
    if (hasSessionForRenderer(DECIDR_ONBOARDING_RENDERER)) return;
    launchStandalone(DECIDR_ONBOARDING_RENDERER, 'DecidR Setup', {}, {
      autoOpened: true,
    });
  }

  // --- Message Handling ---

  function shouldAutoFocusPush(session, existingSession, options) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'autoFocus')) {
      return !!options.autoFocus;
    }
    if (!activeSessionId) return true;
    if (activeSessionId === session.sessionId) return true;
    if (session.reviewRequired) return true;
    if (!existingSession) return true;
    return !!(session.meta && session.meta.autoFocus === true);
  }

  function handlePush(session, options) {
    var existingSession = sessions.get(session.sessionId);
    var mergedMeta = Object.assign({}, existingSession && existingSession.meta ? existingSession.meta : {}, session.meta || {});
    var mergedToolArgs = Object.assign({}, existingSession && existingSession.toolArgs ? existingSession.toolArgs : {}, session.toolArgs || {});
    sessions.set(session.sessionId, {
      toolName: session.toolName || (existingSession && existingSession.toolName) || 'push_preview',
      contentType: session.contentType || (existingSession && existingSession.contentType) || null,
      data: session.data !== undefined ? session.data : (existingSession ? existingSession.data : {}),
      meta: mergedMeta,
      toolArgs: mergedToolArgs,
      reviewRequired: typeof session.reviewRequired === 'boolean'
        ? session.reviewRequired
        : !!(existingSession && existingSession.reviewRequired),
      timeoutSecs: session.timeoutSecs || (existingSession && existingSession.timeoutSecs) || null,
      timestamp: session.createdAt || Date.now(),
    });

    if (existingSession) {
      var cached = contentCache.get(session.sessionId);
      if (cached && cached.parentNode) {
        cached.parentNode.removeChild(cached);
      }
      contentCache.delete(session.sessionId);
    }

    // Start countdown timer for review sessions
    if (session.reviewRequired && session.timeoutSecs) {
      startCountdown(session.sessionId, session.timeoutSecs);
    }

    if (shouldAutoFocusPush(session, existingSession, options)) {
      selectSession(session.sessionId);
      return;
    }

    renderTabBar();
    if (!activeSessionId) {
      renderEmpty();
    }
  }

  function finalizeSyntheticSessionSelection(sessionId, session, existingSession, options) {
    if (!sessionId) return sessionId;
    if (activeSessionId === sessionId) {
      selectSession(sessionId);
      return sessionId;
    }
    var shouldFocus = shouldAutoFocusPush({
      sessionId: sessionId,
      reviewRequired: !!(session && session.reviewRequired),
      meta: session && session.meta ? session.meta : {},
    }, existingSession || null, options);

    if (shouldFocus) {
      selectSession(sessionId);
      return sessionId;
    }

    renderTabBar();
    if (!activeSessionId) {
      selectSession(sessionId);
    }
    return sessionId;
  }

  function openSyntheticSession(config, options) {
    config = config || {};
    var sessionKey = config.sessionKey || null;
    var existingSessionId = config.sessionId && sessions.has(config.sessionId)
      ? config.sessionId
      : null;

    if (!existingSessionId && sessionKey) {
      sessions.forEach(function (session, sessionId) {
        if (existingSessionId) return;
        if (session.meta && session.meta.syntheticKey === sessionKey) {
          existingSessionId = sessionId;
        }
      });
    }

    if (existingSessionId) {
      var existing = sessions.get(existingSessionId);
      if (existing) {
        if (config.data !== undefined) existing.data = config.data;
        if (config.meta) existing.meta = Object.assign({}, existing.meta || {}, config.meta);
        if (config.toolArgs) existing.toolArgs = Object.assign({}, existing.toolArgs || {}, config.toolArgs);
        if (config.toolName) existing.toolName = config.toolName;
        if (config.contentType) existing.contentType = config.contentType;
        existing.timestamp = Date.now();
      }

      var cached = contentCache.get(existingSessionId);
      if (cached && cached.parentNode) {
        cached.parentNode.removeChild(cached);
      }
      contentCache.delete(existingSessionId);
      return finalizeSyntheticSessionSelection(existingSessionId, existing, existing, options);
    }

    var sessionId = config.sessionId || ('synthetic-' + (config.toolName || config.contentType || 'session') + '-' + Date.now());
    var meta = Object.assign({}, config.meta || {});
    if (sessionKey) meta.syntheticKey = sessionKey;

    sessions.set(sessionId, {
      toolName: config.toolName || 'synthetic_session',
      contentType: config.contentType || 'rich_content',
      data: config.data || {},
      meta: meta,
      toolArgs: config.toolArgs || {},
      reviewRequired: !!config.reviewRequired,
      timeoutSecs: config.timeoutSecs || null,
      timestamp: Date.now(),
    });

    return finalizeSyntheticSessionSelection(sessionId, sessions.get(sessionId), null, options);
  }

  function replaceSyntheticSession(sessionId, config, options) {
    var existing = sessions.get(sessionId);
    if (!existing) return openSyntheticSession(Object.assign({}, config, { sessionId: sessionId }), options);

    var meta = Object.assign({}, existing.meta || {}, config.meta || {});
    if (config.sessionKey) {
      meta.syntheticKey = config.sessionKey;
    } else if (existing.meta && existing.meta.syntheticKey && !meta.syntheticKey) {
      meta.syntheticKey = existing.meta.syntheticKey;
    }

    sessions.set(sessionId, {
      toolName: config.toolName || existing.toolName,
      contentType: config.contentType || existing.contentType,
      data: config.data !== undefined ? config.data : existing.data,
      meta: meta,
      toolArgs: config.toolArgs
        ? Object.assign({}, existing.toolArgs || {}, config.toolArgs)
        : existing.toolArgs,
      reviewRequired: typeof config.reviewRequired === 'boolean'
        ? config.reviewRequired
        : !!existing.reviewRequired,
      timeoutSecs: config.timeoutSecs || existing.timeoutSecs || null,
      timestamp: Date.now(),
    });

    var cached = contentCache.get(sessionId);
    if (cached && cached.parentNode) {
      cached.parentNode.removeChild(cached);
    }
    contentCache.delete(sessionId);

    return finalizeSyntheticSessionSelection(sessionId, sessions.get(sessionId), existing, options);
  }

  function normalizeExternalWebUrl(url) {
    try {
      var parsed = new URL(String(url || '').trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch (_error) {
      return '';
    }
    return '';
  }

  function externalWebTitleForUrl(url, title) {
    if (title && String(title).trim()) return String(title).trim();
    try {
      var parsed = new URL(url);
      var host = parsed.hostname || '';
      if (host === 'stripe.com' || host.endsWith('.stripe.com')) {
        return 'Stripe Billing';
      }
      return host || 'External Page';
    } catch (_error) {
      return 'External Page';
    }
  }

  function openExternalUrlInTab(url, options) {
    options = options || {};
    var normalizedUrl = normalizeExternalWebUrl(url);
    if (!normalizedUrl) return null;
    var title = externalWebTitleForUrl(normalizedUrl, options.title || null);
    return openSyntheticSession({
      sessionId: options.sessionId || null,
      toolName: EXTERNAL_WEB_CONTENT_TYPE,
      contentType: EXTERNAL_WEB_CONTENT_TYPE,
      data: {
        url: normalizedUrl,
        title: title,
        returnOrigins: Array.isArray(options.returnOrigins) ? options.returnOrigins : [],
      },
      meta: {
        headerTitle: title,
        externalWeb: true,
      },
      toolArgs: {
        title: title,
      },
      reviewRequired: false,
    }, { autoFocus: true });
  }

  function getTabLabel(session) {
    // Try to extract a meaningful label from the data
    if (session.data && typeof session.data === 'object') {
      if (session.data.title && typeof session.data.title === 'string') {
        return session.data.title;
      }
      if (session.data.name && typeof session.data.name === 'string') {
        return session.data.name;
      }
    }
    // Fall back to toolArgs title if present
    if (session.toolArgs && session.toolArgs.title && typeof session.toolArgs.title === 'string') {
      return session.toolArgs.title;
    }
    // Fall back to tool name
    return session.toolName;
  }

  // --- Rendering ---

  function selectSession(sessionId) {
    var previousSessionId = activeSessionId;
    activeSessionId = sessionId;

    var utils = window.__companionUtils;
    if (utils && previousSessionId && previousSessionId !== sessionId) {
      if (utils.hideSessionDrawers) utils.hideSessionDrawers(previousSessionId);
      if (utils.hideSessionCitation) utils.hideSessionCitation(previousSessionId);
    }
    if (utils) {
      if (utils.setActiveSession) utils.setActiveSession(sessionId);
      if (utils.citationSetActiveSession) utils.citationSetActiveSession(sessionId);
      if (utils.showSessionDrawers) utils.showSessionDrawers(sessionId);
      if (utils.showSessionCitation) utils.showSessionCitation(sessionId);
    }

    var session = sessions.get(sessionId);
    if (window.__tribexAiShell && typeof window.__tribexAiShell.setActiveSession === 'function') {
      window.__tribexAiShell.setActiveSession(sessionId, session);
    }
    if (session && session.reviewRequired) {
      startHeartbeat(sessionId);
    } else {
      stopHeartbeat();
    }
    renderTabBar();
    renderContent(sessionId);
    emitSessionVisibilityChanged({
      sessionId: sessionId,
      previousSessionId: previousSessionId || null,
      active: true,
    });
  }

  function refreshCurrentSession() {
    if (!activeSessionId) return;
    var session = sessions.get(activeSessionId);
    if (!session) return;
    if (session.meta && session.meta.aiView === 'thread' &&
        window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
      window.__tribexAiState.refreshActiveThread();
    }
    // Remove cached container to force re-render
    var cached = contentCache.get(activeSessionId);
    if (cached && cached.parentNode) {
      emitSessionVisibilityChanged({ sessionId: activeSessionId, active: false, refreshing: true });
      cached.parentNode.removeChild(cached);
    }
    contentCache.delete(activeSessionId);
    renderContent(activeSessionId);
    emitSessionVisibilityChanged({ sessionId: activeSessionId, active: true, refreshed: true });
  }

  function syncSessionBusyIndicator(container, session) {
    if (!container) return;

    var busyIndicator = session && session.meta ? session.meta.busyIndicator || null : null;
    var existing = container.querySelector('.session-busy-indicator');

    if (!busyIndicator) {
      container.classList.remove('has-busy-indicator');
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      return;
    }

    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'session-busy-indicator';
      existing.setAttribute('aria-hidden', 'true');
      container.insertBefore(existing, container.firstChild || null);
    }

    existing.setAttribute('data-busy-kind', busyIndicator.kind || 'line-pulse');
    existing.setAttribute('data-busy-status', busyIndicator.status || 'busy');
    container.classList.add('has-busy-indicator');
  }

  function updateSessionMetadata(sessionId, metaPatch) {
    var session = sessions.get(sessionId);
    if (!session) return null;

    var nextMeta = Object.assign({}, session.meta || {});
    Object.keys(metaPatch || {}).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(metaPatch, key)) return;
      var value = metaPatch[key];
      if (value === undefined) return;
      if (value === null) {
        delete nextMeta[key];
        return;
      }
      nextMeta[key] = value;
    });

    session.meta = nextMeta;
    sessions.set(sessionId, session);
    renderTabBar();

    if (sessionId === activeSessionId) {
      mainTitle.textContent = (session.meta && session.meta.headerTitle) || getTabLabel(session);
    }

    var cached = contentCache.get(sessionId);
    if (cached) {
      syncSessionBusyIndicator(cached, session);
      syncSessionLayoutClasses(cached, session);
    }

    return session;
  }

  function isViewportOwnedSession(session) {
    if (!session) return false;
    if (session.contentType === EXTERNAL_WEB_CONTENT_TYPE) return true;
    if (session.contentType === 'tribex_ai_thread') return true;
    if (session.meta && session.meta.aiView === 'thread') return true;
    return /^ludflow_(app|documents_home|data_governance|knowledge_dex)$/.test(String(session.contentType || ''));
  }

  function syncSessionLayoutClasses(container, session) {
    if (!container) return;
    var viewportOwned = isViewportOwnedSession(session);
    container.classList.toggle('session-content-viewport-owned', viewportOwned);
    var scroll = container.querySelector('.session-scroll');
    if (scroll) {
      scroll.classList.toggle('session-scroll-viewport-owned', viewportOwned);
    }
  }

  function updateRenderedSession(container, sessionId) {
    var session = sessions.get(sessionId);
    if (!session || !container) return false;
    syncSessionBusyIndicator(container, session);
    syncSessionLayoutClasses(container, session);
    var scroll = container.querySelector('.session-scroll');
    if (!scroll) return false;
    var renderer = getRenderer(session.contentType);
    renderer(scroll, session.data, session.meta, session.toolArgs || {}, session.reviewRequired, function (decision) {
      onDecision(sessionId, decision);
    });
    return true;
  }

  function rerenderActiveSession() {
    if (!activeSessionId) return;
    var session = sessions.get(activeSessionId);
    if (!session) return;
    var cached = contentCache.get(activeSessionId);
    if (cached && session.meta && session.meta.aiView === 'thread') {
      updateRenderedSession(cached, activeSessionId);
      return;
    }
    if (cached && cached.parentNode) {
      cached.parentNode.removeChild(cached);
    }
    contentCache.delete(activeSessionId);
    renderContent(activeSessionId);
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', refreshCurrentSession);
  }

  function renderContent(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      renderEmpty();
      return;
    }

    mainTitle.textContent = (session.meta && session.meta.headerTitle) || getTabLabel(session);
    if (refreshButton) refreshButton.style.display = '';

    // Deactivate all cached containers
    contentCache.forEach(function (container) {
      container.classList.remove('active');
    });

    // Hide empty state if present
    var emptyState = contentArea.querySelector('.empty-state');
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    // Check if we already have a cached container for this session
    var cached = contentCache.get(sessionId);
    if (cached) {
      syncSessionBusyIndicator(cached, session);
      syncSessionLayoutClasses(cached, session);
      cached.classList.add('active');
      return;
    }

    // Create new container with inner scroll wrapper
    var container = document.createElement('div');
    container.className = 'session-content active';
    container.setAttribute('data-session-id', sessionId);

    var scroll = document.createElement('div');
    scroll.className = 'session-scroll';
    container.appendChild(scroll);
    syncSessionLayoutClasses(container, session);

    contentArea.appendChild(container);
    contentCache.set(sessionId, container);
    syncSessionBusyIndicator(container, session);

    const renderer = getRenderer(session.contentType);
    renderer(scroll, session.data, session.meta, session.toolArgs || {}, session.reviewRequired, function (decision) {
      onDecision(sessionId, decision);
    });
  }

  function renderEmpty() {
    emitSessionVisibilityChanged({ sessionId: null, active: false, empty: true });
    if (window.__tribexAiShell && typeof window.__tribexAiShell.setActiveSession === 'function') {
      window.__tribexAiShell.setActiveSession(null, null);
    }
    mainTitle.textContent = 'MCPViews';
    if (refreshButton) refreshButton.style.display = 'none';
    // Deactivate all cached containers
    contentCache.forEach(function (container) {
      container.classList.remove('active');
    });
    // Show empty state if no sessions
    var emptyState = contentArea.querySelector('.empty-state');
    if (!emptyState) {
      emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      contentArea.appendChild(emptyState);
    }
    emptyState.innerHTML = '';

    var title = document.createElement('strong');
    title.textContent = 'Waiting for preview data…';
    emptyState.appendChild(title);

    var subtitle = document.createElement('p');
    subtitle.textContent = aiWorkspaceAvailable
      ? 'Open the AI workspace to browse live projects, threads, and companion activity.'
      : 'Push content from an MCP tool or open an app renderer to preview it here.';
    emptyState.appendChild(subtitle);

    if (
      aiWorkspaceAvailable &&
      window.__tribexAiState &&
      typeof window.__tribexAiState.toggleNavigator === 'function'
    ) {
      var button = document.createElement('button');
      button.className = 'ai-primary-btn';
      button.type = 'button';
      button.textContent = 'Open AI workspace';
      button.addEventListener('click', function () {
        window.__tribexAiState.toggleNavigator();
      });
      emptyState.appendChild(button);
    }
    emptyState.style.display = '';
  }

  function getRenderer(contentType) {
    if (contentType === EXTERNAL_WEB_CONTENT_TYPE) {
      return renderExternalWebPage;
    }
    var renderers = window.__renderers || {};
    if (contentType && typeof renderers[contentType] === 'function') {
      return renderers[contentType];
    }
    return function renderError(container) {
      container.innerHTML = '<div style="color:var(--color-error);padding:32px;text-align:center;">' +
        '<h3>No renderer for content type: ' + (contentType || 'unknown') + '</h3>' +
        '<p style="color:var(--text-secondary);">This tool needs a renderer added to the UI.</p></div>';
    };
  }

  function externalWebNativeBridge() {
    if (!window.__TAURI__ || !window.__TAURI__.core) return null;
    if (!supportsNativeAppPanels()) return null;
    var host = window.__mcpviewsHost || {};
    var companion = window.__companionUtils || {};
    var mount = typeof host.mountExternalWebPanel === 'function'
      ? host.mountExternalWebPanel
      : companion.mountExternalWebPanel;
    var update = typeof host.updateNativeAppViewBounds === 'function'
      ? host.updateNativeAppViewBounds
      : companion.updateNativeAppViewBounds;
    var close = typeof host.closeNativeAppView === 'function'
      ? host.closeNativeAppView
      : companion.closeNativeAppView;
    if (typeof mount === 'function' && typeof update === 'function' && typeof close === 'function') {
      return { mount: mount, update: update, close: close };
    }
    return null;
  }

  function externalWebPanelLabel(sessionId, data) {
    var seed = sessionId || (data && data.url) || 'external';
    return 'external-web-' + String(seed)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function externalWebPanelBounds(panel) {
    var rect = panel.getBoundingClientRect();
    var root = document.documentElement;
    var sessionContent = panel.closest('.session-content');
    var style = window.getComputedStyle(panel);
    var visible = !!(
      root &&
      root.contains(panel) &&
      (!sessionContent || sessionContent.classList.contains('active')) &&
      !nativeAppOverlayActive &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width >= 2 &&
      rect.height >= 2
    );
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      visible: visible,
    };
  }

  function renderExternalWebPage(container, data, meta, toolArgs) {
    data = data && typeof data === 'object' ? data : {};
    var bridge = externalWebNativeBridge();
    var url = normalizeExternalWebUrl(data.url);
    var title = externalWebTitleForUrl(url, (data.title || (meta && meta.headerTitle) || (toolArgs && toolArgs.title) || null));
    var sessionContent = container.closest('.session-content');
    var sessionId = sessionContent ? sessionContent.getAttribute('data-session-id') : null;
    var nativeLabel = null;
    var disposed = false;
    var updateTimer = null;
    var resizeObserver = null;
    var removalObserver = null;
    var pollTimer = null;
    var lastBoundsKey = '';

    container.style.padding = '0';
    container.style.overflow = 'hidden';
    container.innerHTML = '';

    var shell = document.createElement('div');
    shell.className = 'external-web-shell';
    var panel = document.createElement('div');
    panel.className = 'external-web-panel';
    var message = document.createElement('div');
    message.className = 'external-web-panel-message';
    message.textContent = bridge ? 'Opening external billing page...' : 'External web tabs are available in MCPViews desktop.';
    panel.appendChild(message);
    shell.appendChild(panel);
    container.appendChild(shell);

    function boundsKey(bounds) {
      return [
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        bounds.visible ? '1' : '0',
      ].join(':');
    }

    function updateBounds(force) {
      if (disposed || !nativeLabel) return;
      var bounds = externalWebPanelBounds(panel);
      var nextKey = boundsKey(bounds);
      if (!force && nextKey === lastBoundsKey) return;
      lastBoundsKey = nextKey;
      Promise.resolve(bridge.update({
        label: nativeLabel,
        bounds: bounds,
      })).catch(function (error) {
        console.warn('Failed to update external web tab bounds:', error);
      });
    }

    function scheduleUpdate(force) {
      if (disposed || !bridge) return;
      if (updateTimer) window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(function () {
        updateTimer = null;
        updateBounds(force);
      }, force ? 0 : 50);
    }

    function cleanup(closePanel) {
      if (disposed) return;
      disposed = true;
      if (updateTimer) window.clearTimeout(updateTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      if (resizeObserver) resizeObserver.disconnect();
      if (removalObserver) removalObserver.disconnect();
      window.removeEventListener('resize', onVisibilityChange, true);
      window.removeEventListener('scroll', onVisibilityChange, true);
      window.removeEventListener('mcpviews:session-visibility-changed', onSessionVisibility);
      window.removeEventListener('mcpviews:native-app-overlay-changed', onVisibilityChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (nativeLabel && closePanel !== false) {
        Promise.resolve(bridge.close({ label: nativeLabel })).catch(function (error) {
          console.warn('Failed to close external web tab panel:', error);
        });
      }
    }

    function onVisibilityChange() {
      scheduleUpdate(true);
    }

    function onSessionVisibility(event) {
      var detail = event && event.detail ? event.detail : {};
      if (sessionId && detail.sessionId === sessionId && detail.removed) {
        cleanup(true);
        return;
      }
      scheduleUpdate(true);
    }

    if (!url) {
      message.textContent = 'No valid external URL was provided.';
      return;
    }
    if (!bridge) {
      if (window.open) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(function () {
        scheduleUpdate(false);
      });
      resizeObserver.observe(panel);
    }

    removalObserver = new MutationObserver(function () {
      if (!document.documentElement.contains(panel)) {
        cleanup(true);
      }
    });
    removalObserver.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('resize', onVisibilityChange, true);
    window.addEventListener('scroll', onVisibilityChange, true);
    window.addEventListener('mcpviews:session-visibility-changed', onSessionVisibility);
    window.addEventListener('mcpviews:native-app-overlay-changed', onVisibilityChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    pollTimer = window.setInterval(function () {
      scheduleUpdate(false);
    }, 750);

    Promise.resolve(bridge.mount({
      url: url,
      title: title,
      label: externalWebPanelLabel(sessionId, data),
      sessionId: sessionId,
      returnOrigins: Array.isArray(data.returnOrigins) ? data.returnOrigins : [],
      bounds: externalWebPanelBounds(panel),
    })).then(function (result) {
      if (disposed) {
        if (result && result.label) {
          Promise.resolve(bridge.close({ label: result.label })).catch(function (error) {
            console.warn('Failed to close late external web tab panel:', error);
          });
        }
        return;
      }
      nativeLabel = result && result.label ? result.label : null;
      panel.classList.add('external-web-panel-mounted');
      scheduleUpdate(true);
    }).catch(function (error) {
      console.error('Failed to mount external web tab:', error);
      message.textContent = 'Failed to open external billing page.';
      cleanup(false);
    });
  }

  window.__companionUtils = window.__companionUtils || {};
  window.__companionUtils.openSession = openSyntheticSession;
  window.__companionUtils.replaceSession = replaceSyntheticSession;
  window.__companionUtils.selectSession = selectSession;
  window.__companionUtils.closeSession = removeSession;
  window.__companionUtils.getSession = function (sessionId) {
    return sessionId ? sessions.get(sessionId) || null : null;
  };
  window.__companionUtils.updateSessionMetadata = updateSessionMetadata;
  window.__companionUtils.refreshActiveSession = refreshCurrentSession;
  window.__companionUtils.openNativeAppView = openNativeAppView;
  window.__companionUtils.openExternalUrlInTab = openExternalUrlInTab;
  window.__companionUtils.supportsNativeAppPanels = supportsNativeAppPanels;
  if (supportsNativeAppPanels()) {
    window.__companionUtils.mountNativeAppView = mountNativeAppView;
    window.__companionUtils.mountExternalWebPanel = mountExternalWebPanel;
    window.__companionUtils.updateNativeAppViewBounds = updateNativeAppViewBounds;
    window.__companionUtils.closeNativeAppView = closeNativeAppView;
  }
  window.__companionUtils.isNativeAppOverlayActive = function () {
    return nativeAppOverlayActive;
  };
  window.__companionUtils.refreshAiWorkspaceAvailability = refreshAiWorkspaceAvailability;
  window.__companionUtils.getAiWorkspaceAvailability = function () {
    return {
      available: aiWorkspaceAvailable,
      config: aiWorkspaceConfig,
    };
  };
  window.__companionUtils.rerenderActiveSession = rerenderActiveSession;
  window.__companionUtils.getActiveSession = function () {
    return activeSessionId ? {
      sessionId: activeSessionId,
      session: sessions.get(activeSessionId) || null,
    } : null;
  };

  // --- Decision ---

  var DECISION_HANDLERS = {
    review_decision: function (decision) {
      return { decisionStr: decision.decision };
    },
    operation_decisions: function (decision) {
      return {
        decisionStr: 'partial',
        operationDecisions: decision.decisions,
        comments: decision.comments || null,
        modifications: decision.modifications || null,
        additions: decision.additions || null,
      };
    },
    rich_content_decisions: function (decision) {
      return {
        decisionStr: 'partial',
        suggestionDecisions: decision.suggestion_decisions || null,
        tableDecisions: decision.table_decisions || null,
      };
    },
  };

  function onDecision(sessionId, decision) {
    // Build the decision payload for Tauri IPC
    var decisionStr = '';
    var operationDecisions = null;
    var comments = null;
    var modifications = null;
    var additions = null;
    var suggestionDecisions = null;
    var tableDecisions = null;

    if (typeof decision === 'string') {
      decisionStr = decision;
    } else if (typeof decision === 'object') {
      var handler = DECISION_HANDLERS[decision.type];
      if (handler) {
        var result = handler(decision);
        decisionStr = result.decisionStr || '';
        operationDecisions = result.operationDecisions || null;
        comments = result.comments || null;
        modifications = result.modifications || null;
        additions = result.additions || null;
        suggestionDecisions = result.suggestionDecisions || null;
        tableDecisions = result.tableDecisions || null;
      } else {
        // Fallback: plain object without a known type
        decisionStr = 'partial';
        operationDecisions = decision;
      }
    }

    // Submit via Tauri IPC
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke('submit_decision', {
        sessionId: sessionId,
        decision: decisionStr,
        operationDecisions: operationDecisions,
        comments: comments,
        modifications: modifications,
        additions: additions,
        suggestionDecisions: suggestionDecisions,
        tableDecisions: tableDecisions,
      }).catch(function (err) {
        console.error('Failed to submit decision:', err);
      });
    }

    removeSession(sessionId);
  }
  window.__companionUtils.submitDecision = onDecision;

  // --- Global citation click handler ---

  document.addEventListener('click', function (e) {
    var citeEl = e.target.closest('[data-cite-type]');
    if (!citeEl) return;

    var type = citeEl.getAttribute('data-cite-type');
    var index = parseInt(citeEl.getAttribute('data-cite-index') || '0', 10);

    var session = activeSessionId ? sessions.get(activeSessionId) : null;
    if (!session) return;

    var data = session.data;
    var citationData = null;

    if (Array.isArray(data)) {
      citationData = data[index] || data[index - 1] || null;
    } else if (data && data.results && Array.isArray(data.results)) {
      citationData = data.results[index] || data.results[index - 1] || null;
    } else if (data && typeof data === 'object') {
      if (data.entries && Array.isArray(data.entries)) {
        citationData = data.entries[index] || data.entries[index - 1] || null;
      } else {
        citationData = data;
      }
    }

    if (citationData && window.__companionUtils && window.__companionUtils.openCitationPanel) {
      window.__companionUtils.openCitationPanel(type, citationData);
    }
  });

  // --- Global mcpview:// invocation click handler ---

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-invoke-renderer]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();

    var rendererName = el.getAttribute('data-invoke-renderer');
    var paramsStr = el.getAttribute('data-invoke-params');
    var params = {};
    try { params = JSON.parse(paramsStr || '{}'); } catch (err) {}

    // Look up display mode from registry, fallback to 'drawer'
    var registry = window.__rendererRegistry || {};
    var meta = registry[rendererName];
    var displayMode = (meta && meta.display_mode) || 'drawer';

    if (window.__companionUtils && window.__companionUtils.invokeRenderer) {
      window.__companionUtils.invokeRenderer(rendererName, params, displayMode);
    }
  });

  // --- Escape key closes topmost drawer ---

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && window.__companionUtils && window.__companionUtils.closeDrawer) {
      window.__companionUtils.closeDrawer();
    }
  });

  // --- App Updates ---

  function dismissedUpdateVersion() {
    try {
      return localStorage.getItem(UPDATE_DISMISSED_VERSION_KEY) ||
        dismissedAppUpdateVersionFallback;
    } catch (err) {
      return dismissedAppUpdateVersionFallback;
    }
  }

  function setDismissedUpdateVersion(version) {
    dismissedAppUpdateVersionFallback = version || '';
    try {
      localStorage.setItem(UPDATE_DISMISSED_VERSION_KEY, version || '');
    } catch (err) {}
  }

  function dismissedUpdateFailure() {
    try {
      var raw = localStorage.getItem(UPDATE_DISMISSED_FAILURE_KEY);
      if (!raw) return dismissedAppUpdateFailureFallback;
      return JSON.parse(raw);
    } catch (err) {
      return dismissedAppUpdateFailureFallback;
    }
  }

  function setDismissedUpdateFailure(message) {
    var record = {
      message: message || '',
      dismissedAt: Date.now(),
    };
    dismissedAppUpdateFailureFallback = record;
    try {
      localStorage.setItem(UPDATE_DISMISSED_FAILURE_KEY, JSON.stringify(record));
    } catch (err) {}
  }

  function clearDismissedUpdateFailure() {
    dismissedAppUpdateFailureFallback = null;
    try {
      localStorage.removeItem(UPDATE_DISMISSED_FAILURE_KEY);
    } catch (err) {}
  }

  function shouldSuppressUpdateFailure(message) {
    var record = dismissedUpdateFailure();
    if (!record || record.message !== message || !Number.isFinite(record.dismissedAt)) {
      return false;
    }
    return Date.now() - record.dismissedAt < UPDATE_FAILURE_DISMISS_MS;
  }

  function hideUpdateBanner() {
    if (!updateBanner) return;
    updateBanner.classList.add('hidden');
    updateBanner.classList.remove('update-banner-manual');
    updateBanner.classList.remove('update-banner-warning');
    pendingAppUpdateAction = null;
  }

  function updateActionFor(update) {
    if (!update) return null;
    if (update.kind === 'failure') return 'retry';
    if (update.canInstall && update.updateJsonUrl) return 'install';
    if (update.manualDownloadUrl) return 'manual';
    if (update.releasePageUrl) return 'release';
    return null;
  }

  function updateInstallButtonState(update, isWorking) {
    if (!updateInstallButton) return;
    var action = updateActionFor(update);
    pendingAppUpdateAction = action;
    updateInstallButton.disabled = isWorking || !action;
    if (isWorking) {
      updateInstallButton.textContent = action === 'retry' ? 'Checking...' : 'Installing...';
    } else if (action === 'manual') {
      updateInstallButton.textContent = update.manualDownloadLabel || 'Download update';
    } else if (action === 'release') {
      updateInstallButton.textContent = 'Open release page';
    } else if (action === 'retry') {
      updateInstallButton.textContent = 'Try again';
    } else {
      updateInstallButton.textContent = 'Install and re-launch';
    }
    updateInstallButton.title = {
      install: 'Install this MCPViews update and restart the app',
      manual: 'Download this MCPViews installer in your browser',
      release: 'Open the MCPViews release page in your browser',
      retry: 'Check GitHub releases for MCPViews updates again',
    }[action] || 'No update action is available';
  }

  function updateChangelogButtonState(update) {
    if (!updateChangelogButton) return;
    var hasReleasePage = !!(update && update.releasePageUrl && update.kind !== 'failure');
    updateChangelogButton.hidden = !hasReleasePage;
  }

  function showUpdateBanner(update) {
    if (!updateBanner || !update) return;
    if (dismissedUpdateVersion() === update.version) {
      hideUpdateBanner();
      return;
    }

    pendingAppUpdate = update;
    updateBanner.classList.remove('update-banner-warning');
    updateBanner.classList.toggle('update-banner-manual', !(update.canInstall && update.updateJsonUrl));
    if (updateBannerTitle) {
      updateBannerTitle.textContent = 'MCPViews update available';
    }
    if (updateBannerMessage) {
      if (update.canInstall && update.updateJsonUrl) {
        updateBannerMessage.textContent = 'Version ' + update.version + ' is ready from GitHub releases.';
        updateBannerMessage.title = '';
      } else {
        updateBannerMessage.textContent = 'Version ' + update.version + ' is available, but this MCPViews build cannot install signed updates in-app. Download once to restore future self-updates.';
        updateBannerMessage.title = update.installUnavailableReason || '';
      }
    }
    updateInstallButtonState(update, false);
    updateChangelogButtonState(update);
    updateBanner.classList.remove('hidden');
  }

  function normalizeUpdateErrorMessage(err) {
    var text = String(err && err.message ? err.message : err || 'Unknown update check error');
    return text.trim() || 'Unknown update check error';
  }

  function showUpdateCheckFailure(err) {
    if (!updateBanner) return;
    var errorMessage = normalizeUpdateErrorMessage(err);
    if (shouldSuppressUpdateFailure(errorMessage)) {
      return;
    }

    pendingAppUpdate = {
      kind: 'failure',
      errorMessage: errorMessage,
    };
    updateBanner.classList.remove('update-banner-manual');
    updateBanner.classList.add('update-banner-warning');
    if (updateBannerTitle) {
      updateBannerTitle.textContent = 'Could not check for MCPViews updates';
    }
    if (updateBannerMessage) {
      updateBannerMessage.textContent = 'MCPViews could not reach GitHub releases. Try again when your connection is available.';
      updateBannerMessage.title = errorMessage;
    }
    updateInstallButtonState(pendingAppUpdate, false);
    updateChangelogButtonState(pendingAppUpdate);
    updateBanner.classList.remove('hidden');
  }

  function checkForAppUpdate() {
    if (!window.__TAURI__ || !window.__TAURI__.core) return Promise.resolve(null);
    return window.__TAURI__.core.invoke('check_app_update')
      .then(function (update) {
        clearDismissedUpdateFailure();
        if (update) {
          showUpdateBanner(update);
        } else {
          pendingAppUpdate = null;
          hideUpdateBanner();
        }
        return update;
      })
      .catch(function (err) {
        console.warn('[updates] Failed to check for MCPViews updates:', err);
        showUpdateCheckFailure(err);
        return null;
      });
  }

  function openExternalUpdateUrl(url) {
    if (!url || !window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.resolve();
    }
    return window.__TAURI__.core.invoke('open_external_url', {
      url: url,
    }).catch(function (err) {
      console.error('[updates] Failed to open MCPViews update URL:', err);
    });
  }

  function installPendingAppUpdate() {
    if (!pendingAppUpdate || !window.__TAURI__ || !window.__TAURI__.core) {
      return;
    }
    if (pendingAppUpdateAction === 'retry') {
      clearDismissedUpdateFailure();
      updateInstallButtonState(pendingAppUpdate, true);
      checkForAppUpdate();
      return;
    }
    if (pendingAppUpdateAction === 'manual') {
      openExternalUpdateUrl(pendingAppUpdate.manualDownloadUrl);
      return;
    }
    if (pendingAppUpdateAction === 'release') {
      openExternalUpdateUrl(pendingAppUpdate.releasePageUrl);
      return;
    }
    if (!pendingAppUpdate.updateJsonUrl) {
      return;
    }
    updateInstallButtonState(pendingAppUpdate, true);
    window.__TAURI__.core.invoke('install_app_update', {
      updateJsonUrl: pendingAppUpdate.updateJsonUrl,
    }).then(function (result) {
      if (result && result.relaunching === false) {
        if (updateBannerMessage) {
          updateBannerMessage.textContent = result.message || 'Development install simulated.';
        }
        updateInstallButtonState(pendingAppUpdate, false);
      }
    }).catch(function (err) {
      console.error('[updates] Failed to install MCPViews update:', err);
      if (updateBannerMessage) {
        updateBannerMessage.textContent = String(err || 'Failed to install update.');
      }
      updateInstallButtonState(pendingAppUpdate, false);
    });
  }

  function openPendingUpdateChangelog() {
    if (!pendingAppUpdate || !pendingAppUpdate.releasePageUrl || !window.__TAURI__ || !window.__TAURI__.core) {
      return;
    }
    openExternalUpdateUrl(pendingAppUpdate.releasePageUrl);
  }

  function initUpdateBanner() {
    hideUpdateBanner();
    if (updateInstallButton) {
      updateInstallButton.addEventListener('click', installPendingAppUpdate);
    }
    if (updateChangelogButton) {
      updateChangelogButton.addEventListener('click', openPendingUpdateChangelog);
    }
    if (updateDismissButton) {
      updateDismissButton.addEventListener('click', function () {
        if (pendingAppUpdate && pendingAppUpdate.version) {
          setDismissedUpdateVersion(pendingAppUpdate.version);
        } else if (pendingAppUpdate && pendingAppUpdate.kind === 'failure') {
          setDismissedUpdateFailure(pendingAppUpdate.errorMessage || '');
        }
        hideUpdateBanner();
      });
    }
  }

  function startAppUpdateChecks() {
    if (!window.__TAURI__ || !window.__TAURI__.core || appUpdateCheckTimer) {
      return;
    }
    checkForAppUpdate();
    appUpdateCheckTimer = window.setInterval(checkForAppUpdate, 4 * 60 * 60 * 1000);
  }

  // --- Apps Button ---

  function initAppsButton() {
    var appsBtn = document.getElementById('apps-button');
    var dropdown = document.getElementById('apps-dropdown');
    if (!appsBtn || !dropdown) return;
    var dropdownGeneration = 0;

    function closeDropdown() {
      dropdownGeneration += 1;
      dropdown.classList.add('hidden');
      closeNativeAppsPopup();
      setNativeAppOverlayActive(false, 'apps-dropdown');
    }

    function openDomDropdown(generation) {
      populateAppsDropdown(dropdown);
      Promise.resolve(setNativeAppOverlayActive(true, 'apps-dropdown')).then(function () {
        if (generation === dropdownGeneration) {
          dropdown.classList.remove('hidden');
        }
      }).catch(function (error) {
        console.warn('Failed to prepare native app overlay before opening apps dropdown:', error);
        if (generation === dropdownGeneration) {
          dropdown.classList.remove('hidden');
        }
      });
    }

    function openDropdown() {
      var generation = ++dropdownGeneration;
      dropdown.classList.add('hidden');
      setNativeAppOverlayActive(false, 'apps-dropdown');
      openNativeAppsPopup(appsBtn).then(function (opened) {
        if (generation !== dropdownGeneration) return;
        if (!opened) {
          openDomDropdown(generation);
        }
      });
    }

    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
      window.__TAURI__.event.listen('apps-popup-select', function (event) {
        var payload = event && event.payload ? event.payload : {};
        var rendererName = payload.rendererName || payload.renderer_name || '';
        var rendererLabel = payload.rendererLabel || payload.renderer_label || rendererName;
        if (!rendererName) return;
        dropdownGeneration += 1;
        dropdown.classList.add('hidden');
        setNativeAppOverlayActive(false, 'apps-popup-select');
        launchStandalone(rendererName, rendererLabel);
      }).catch(function (error) {
        console.warn('[apps] Failed to listen for native apps popup selections:', error);
      });
    }

    appsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (dropdown.classList.contains('hidden')) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target) && e.target !== appsBtn) {
        closeDropdown();
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDropdown();
      }
    });
  }

  function initAiButton() {
    var aiBtn = aiHomeButton || document.getElementById('ai-home-button');
    if (!aiBtn) return;
    aiBtn.style.display = 'none';
    aiBtn.hidden = true;
    aiBtn.setAttribute('aria-hidden', 'true');

    aiBtn.addEventListener('click', function () {
      if (!aiWorkspaceAvailable) return;
      if (window.__tribexAiState && typeof window.__tribexAiState.toggleNavigator === 'function') {
        window.__tribexAiState.toggleNavigator();
      }
    });

    if (aiShellToggleButton) {
      aiShellToggleButton.addEventListener('click', function () {
        if (window.__tribexAiState && typeof window.__tribexAiState.toggleNavigatorCollapsed === 'function') {
          window.__tribexAiState.toggleNavigatorCollapsed();
        }
      });
    }

    refreshAiWorkspaceAvailability();
  }

  function populateAppsDropdown(dropdown) {
    if (!window.__TAURI__) {
      if (window.__mcpviewsAppsMenu && typeof window.__mcpviewsAppsMenu.setEmpty === 'function') {
        window.__mcpviewsAppsMenu.setEmpty(dropdown, 'Not available in browser mode');
      } else {
        dropdown.innerHTML = '<div class="apps-empty">Not available in browser mode</div>';
      }
      return;
    }
    if (!window.__mcpviewsAppsMenu || typeof window.__mcpviewsAppsMenu.renderAppsMenu !== 'function') {
      dropdown.innerHTML = '<div class="apps-empty">Apps menu unavailable</div>';
      return;
    }

    window.__TAURI__.core.invoke('get_standalone_renderers')
      .then(function(plugins) {
        window.__mcpviewsAppsMenu.renderAppsMenu(dropdown, plugins, {
          headerTag: 'div',
          itemTag: 'div',
          chevronText: '\u25B6',
          emptyText: 'No apps available',
          onSelect: function (renderer, rendererLabel) {
            var rendererName = renderer && renderer.name;
            dropdown.classList.add('hidden');
            setNativeAppOverlayActive(false, 'apps-dropdown');
            launchStandalone(rendererName, rendererLabel);
          },
        });
      })
      .catch(function(err) {
        console.error('[apps] Failed to load standalone renderers:', err);
        window.__mcpviewsAppsMenu.setEmpty(dropdown, 'Failed to load apps');
      });
  }

  function launchStandalone(rendererName, rendererLabel, data, metaPatch) {
    var renderer = getRenderer(rendererName);
    if (!renderer) {
      console.error('[apps] No renderer found for:', rendererName);
      return;
    }
    var displayLabel = (rendererLabel && String(rendererLabel).trim()) || rendererName;

    // Generate a unique session ID
    var sessionId = 'standalone-' + rendererName + '-' + Date.now();

    // Create a synthetic session (matching the shape used by handlePush)
    var session = {
      toolName: 'standalone_launch',
      contentType: rendererName,
      data: data || {},  // standalone renderers fetch their own data
      meta: Object.assign({
        standalone: true,
        headerTitle: displayLabel,
        standaloneRenderer: rendererName,
      }, metaPatch || {}),
      toolArgs: { title: displayLabel },
      reviewRequired: false,
      timeoutSecs: null,
      timestamp: Date.now(),
    };

    // Store and render using existing session management
    sessions.set(sessionId, session);
    selectSession(sessionId);
  }

  // --- Init ---

  renderEmpty();
  initAiButton();
  initUpdateBanner();
  initAppsButton();
  startAppUpdateChecks();
  initTauri();
})();
