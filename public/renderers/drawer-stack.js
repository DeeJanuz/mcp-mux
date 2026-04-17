// @ts-nocheck
/* Drawer Stack Manager — stacking slide-out panels for cross-renderer invocation */

(function () {
  'use strict';

  var stacks = new Map();
  var threadArtifactDrawers = new Map();
  var currentSessionId = null;
  var BASE_Z = 150;
  var Z_INCREMENT = 2;
  var WIDTH_SHRINK = 20; // px narrower per level

  function getStack(sessionId) {
    if (sessionId == null) return [];
    if (!stacks.has(sessionId)) stacks.set(sessionId, []);
    return stacks.get(sessionId);
  }

  function resolveHost(sessionId) {
    return (sessionId && document.querySelector('.session-content[data-session-id="' + sessionId + '"]'))
      || document.getElementById('content-area')
      || document.body;
  }

  function setActiveSession(sessionId) {
    currentSessionId = sessionId;
  }

  function hideSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (stack) {
      for (var i = 0; i < stack.length; i++) {
        setDrawerDisplay(stack[i], false);
      }
    }

    var artifactEntry = threadArtifactDrawers.get(sessionId);
    if (!artifactEntry) return;
    setDrawerDisplay(artifactEntry, false);
  }

  function showSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (stack) {
      for (var i = 0; i < stack.length; i++) {
        setDrawerDisplay(stack[i], true);
      }
    }

    var artifactEntry = threadArtifactDrawers.get(sessionId);
    if (!artifactEntry) return;
    var artifactState = getActiveThreadArtifactState(artifactEntry);
    if (artifactState && artifactState.isOpen && artifactState.order.length) {
      openDrawerUi(artifactEntry);
      return;
    }
    setDrawerDisplay(artifactEntry, false);
  }

  function closeSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (stack) {
      for (var i = 0; i < stack.length; i++) {
        removeDrawerEntry(stack[i]);
      }
      stacks.delete(sessionId);
    }

    var artifactEntry = threadArtifactDrawers.get(sessionId);
    if (!artifactEntry) return;
    removeDrawerEntry(artifactEntry);
    threadArtifactDrawers.delete(sessionId);
  }

  function createOverlay(level) {
    var overlay = document.createElement('div');
    overlay.className = 'drawer-stack-overlay';
    overlay.style.zIndex = String(BASE_Z + level * Z_INCREMENT);
    return overlay;
  }

  function createPanel(level) {
    var panel = document.createElement('div');
    panel.className = 'drawer-stack-panel';
    panel.style.zIndex = String(BASE_Z + level * Z_INCREMENT + 1);
    panel.style.width = Math.max(320, 420 - level * WIDTH_SHRINK) + 'px';
    return panel;
  }

  function buildPanelHeader(titleText) {
    var header = document.createElement('div');
    header.className = 'drawer-stack-header';

    var title = document.createElement('span');
    title.className = 'drawer-stack-title';
    title.textContent = titleText;
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'drawer-stack-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.setAttribute('aria-label', 'Close drawer');
    header.appendChild(closeBtn);

    return {
      header: header,
      title: title,
      closeBtn: closeBtn,
    };
  }

  function formatRendererTitle(rendererName) {
    return String(rendererName || 'details').replace(/_/g, ' ');
  }

  function clearElementChildren(element) {
    if (!element) return;
    element.textContent = '';
    if (typeof element.replaceChildren === 'function') {
      element.replaceChildren();
      return;
    }
    if (Array.isArray(element.children)) {
      element.children.length = 0;
    }
    if ('innerHTML' in element) {
      element.innerHTML = '';
    }
  }

  function submitArtifactDecision(reviewSessionId, decision) {
    if (!reviewSessionId || !window.__TAURI__ || !window.__TAURI__.core) return;

    var decisionStr = '';
    var operationDecisions = null;
    var comments = null;
    var modifications = null;
    var additions = null;
    var suggestionDecisions = null;
    var tableDecisions = null;

    if (typeof decision === 'string') {
      decisionStr = decision;
    } else if (decision && typeof decision === 'object') {
      if (decision.type === 'review_decision') {
        decisionStr = decision.decision || '';
      } else if (decision.type === 'operation_decisions') {
        decisionStr = 'partial';
        operationDecisions = decision.decisions || null;
        comments = decision.comments || null;
        modifications = decision.modifications || null;
        additions = decision.additions || null;
      } else if (decision.type === 'rich_content_decisions') {
        decisionStr = 'partial';
        suggestionDecisions = decision.suggestion_decisions || null;
        tableDecisions = decision.table_decisions || null;
      } else {
        decisionStr = 'partial';
        operationDecisions = decision;
      }
    }

    window.__TAURI__.core.invoke('submit_decision', {
      sessionId: reviewSessionId,
      decision: decisionStr,
      operationDecisions: operationDecisions,
      comments: comments,
      modifications: modifications,
      additions: additions,
      suggestionDecisions: suggestionDecisions,
      tableDecisions: tableDecisions,
    }).catch(function (error) {
      console.error('[drawer-stack] Failed to submit artifact decision:', error);
    });
  }

  function setDrawerDisplay(entry, visible) {
    if (!entry) return;
    entry.overlay.style.display = visible ? '' : 'none';
    entry.panel.style.display = visible ? '' : 'none';
  }

  function openDrawerUi(entry) {
    if (!entry) return;
    setDrawerDisplay(entry, true);
    requestAnimationFrame(function () {
      entry.overlay.classList.add('open');
      entry.panel.classList.add('open');
    });
  }

  function closeDrawerUi(entry) {
    if (!entry) return;
    entry.overlay.classList.remove('open');
    entry.panel.classList.remove('open');
  }

  function removeDrawerEntry(entry) {
    if (!entry) return;
    if (entry.overlay.parentNode) entry.overlay.parentNode.removeChild(entry.overlay);
    if (entry.panel.parentNode) entry.panel.parentNode.removeChild(entry.panel);
  }

  function createDrawerEntry(sessionId, level, options) {
    options = options || {};
    var overlay = createOverlay(level);
    var panel = createPanel(level);
    if (options.overlayClassName) {
      overlay.className += ' ' + options.overlayClassName;
    }
    if (options.panelClassName) {
      panel.className += ' ' + options.panelClassName;
    }
    if (options.width) {
      panel.style.width = options.width;
    }

    var headerParts = buildPanelHeader(options.title || formatRendererTitle(options.rendererName));
    if (options.headerClassName) {
      headerParts.header.className += ' ' + options.headerClassName;
    }
    panel.appendChild(headerParts.header);

    var content = document.createElement('div');
    content.className = 'drawer-stack-content';
    if (options.contentClassName) {
      content.className += ' ' + options.contentClassName;
    }
    panel.appendChild(content);

    var entry = {
      sessionId: sessionId,
      level: level,
      rendererName: options.rendererName || null,
      displayMode: options.displayMode || 'drawer',
      overlay: overlay,
      panel: panel,
      header: headerParts.header,
      titleEl: headerParts.title,
      closeBtn: headerParts.closeBtn,
      content: content,
      onClose: typeof options.onClose === 'function' ? options.onClose : null,
    };

    overlay.addEventListener('click', function () {
      if (entry.onClose) {
        entry.onClose();
      }
    });
    headerParts.closeBtn.addEventListener('click', function (event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      if (entry.onClose) {
        entry.onClose();
      }
    });

    var host = resolveHost(sessionId);
    host.appendChild(overlay);
    host.appendChild(panel);
    return entry;
  }

  function updateDrawerTitle(entry, title) {
    if (!entry || !entry.titleEl) return;
    entry.titleEl.textContent = title || 'Details';
  }

  function renderRendererIntoEntry(entry, rendererName, params, displayMode) {
    if (!entry) return;
    clearElementChildren(entry.content);
    updateDrawerTitle(entry, formatRendererTitle(rendererName));

    var renderer = window.__renderers && window.__renderers[rendererName];
    if (typeof renderer !== 'function') {
      entry.content.textContent = 'Renderer not found: ' + rendererName;
      entry.content.style.padding = '24px';
      entry.content.style.color = 'var(--text-secondary, #888)';
      return;
    }

    var context = {
      mode: displayMode || 'drawer',
      params: params || {},
      level: entry.level,
      invoke: function (name, p) {
        invokeRenderer(name, p);
      },
    };

    try {
      renderer(entry.content, params || {}, {}, {}, false, function () {}, context);
    } catch (err) {
      console.error('[drawer-stack] Renderer error:', rendererName, err);
      entry.content.textContent = 'Failed to load renderer: ' + rendererName;
    }
  }

  function invokeRenderer(rendererName, params, displayMode) {
    var stack = getStack(currentSessionId);
    var level = stack.length;
    var entry = createDrawerEntry(currentSessionId, level, {
      rendererName: rendererName,
      title: formatRendererTitle(rendererName),
      displayMode: displayMode || 'drawer',
      onClose: function () {
        closeDrawer();
      },
    });

    stack.push(entry);
    renderRendererIntoEntry(entry, rendererName, params, displayMode || 'drawer');
    openDrawerUi(entry);
  }

  function closeDrawer() {
    var stack = getStack(currentSessionId);
    if (stack.length > 0) {
      var entry = stack.pop();
      closeDrawerUi(entry);
      setTimeout(function () {
        removeDrawerEntry(entry);
      }, 300);
      return;
    }

    closeThreadArtifactDrawer(currentSessionId);
  }

  function closeAllDrawers() {
    var stack = getStack(currentSessionId);
    while (stack.length > 0) {
      var entry = stack.pop();
      removeDrawerEntry(entry);
    }
    closeThreadArtifactDrawer(currentSessionId);
  }

  function ensureThreadArtifactEntry(sessionId) {
    if (sessionId == null) return null;
    var existing = threadArtifactDrawers.get(sessionId);
    if (existing) return existing;

    var entry = createDrawerEntry(sessionId, 0, {
      rendererName: 'thread_artifacts',
      title: 'Artifacts',
      displayMode: 'thread-artifact-drawer',
      overlayClassName: 'thread-artifact-shell-overlay',
      panelClassName: 'thread-artifact-shell-panel',
      headerClassName: 'thread-artifact-shell-header',
      contentClassName: 'thread-artifact-shell-content',
      onClose: function () {
        closeThreadArtifactDrawer(sessionId);
      },
    });

    entry.threads = new Map();
    entry.activeThreadId = null;
    threadArtifactDrawers.set(sessionId, entry);
    return entry;
  }

  function ensureThreadArtifactState(entry, threadId) {
    if (!entry || !threadId) return null;
    if (!entry.threads.has(threadId)) {
      entry.threads.set(threadId, {
        drawerId: 'tribex-ai-thread-artifacts:' + threadId,
        artifactsByKey: {},
        order: [],
        selectedArtifactKey: null,
        isOpen: false,
      });
    }
    return entry.threads.get(threadId);
  }

  function getActiveThreadArtifactState(entry) {
    if (!entry || !entry.activeThreadId) return null;
    return entry.threads.get(entry.activeThreadId) || null;
  }

  function renderThreadArtifactContent(entry) {
    if (!entry) return;
    clearElementChildren(entry.content);

    var threadState = getActiveThreadArtifactState(entry);
    if (!threadState || !threadState.order.length) {
      updateDrawerTitle(entry, 'Artifacts');
      closeDrawerUi(entry);
      return;
    }

    var selectedKey = threadState.selectedArtifactKey;
    if (!selectedKey || !threadState.artifactsByKey[selectedKey]) {
      selectedKey = threadState.order[threadState.order.length - 1];
      threadState.selectedArtifactKey = selectedKey;
    }

    var artifact = threadState.artifactsByKey[selectedKey];
    if (!artifact) {
      updateDrawerTitle(entry, 'Artifacts');
      closeDrawerUi(entry);
      return;
    }

    updateDrawerTitle(entry, artifact.title || 'Artifact');

    var body = document.createElement('div');
    body.className = 'thread-artifact-shell';
    entry.content.appendChild(body);

    if (threadState.order.length > 1) {
      var tabs = document.createElement('div');
      tabs.className = 'thread-artifact-tabs';

      threadState.order.forEach(function (artifactKey) {
        var tabArtifact = threadState.artifactsByKey[artifactKey];
        if (!tabArtifact) return;

        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'thread-artifact-tab' + (artifactKey === selectedKey ? ' is-active' : '');
        tab.addEventListener('click', function () {
          selectThreadArtifact(entry.sessionId, entry.activeThreadId, artifactKey);
        });

        var label = document.createElement('span');
        label.className = 'thread-artifact-tab-label';
        label.textContent = tabArtifact.title || 'Artifact';
        tab.appendChild(label);

        var close = document.createElement('span');
        close.className = 'thread-artifact-tab-close';
        close.textContent = '\u00D7';
        close.addEventListener('click', function (event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          closeThreadArtifact(entry.sessionId, entry.activeThreadId, artifactKey);
        });
        tab.appendChild(close);
        tabs.appendChild(tab);
      });

      body.appendChild(tabs);
    }

    var content = document.createElement('div');
    content.className = 'thread-artifact-content';
    body.appendChild(content);

    var renderer = window.__renderers && window.__renderers[artifact.contentType];
    if (typeof renderer !== 'function') {
      content.textContent = 'Renderer not found: ' + artifact.contentType;
      content.style.padding = '24px';
      content.style.color = 'var(--text-secondary, #888)';
      return;
    }

    try {
      var reviewRequired = !!(artifact.reviewRequired || (artifact.meta && artifact.meta.reviewRequired));
      var reviewSessionId = artifact.reviewSessionId || (artifact.meta && artifact.meta.reviewSessionId) || null;
      renderer(
        content,
        artifact.data || {},
        artifact.meta || {},
        artifact.toolArgs || {},
        reviewRequired,
        reviewRequired && reviewSessionId
          ? function (decision) {
              submitArtifactDecision(reviewSessionId, decision);
            }
          : null,
        {
          mode: 'thread-artifact-drawer',
          params: artifact.data || {},
          level: 0,
          invoke: function (name, p) {
            invokeRenderer(name, p);
          },
        },
      );
    } catch (error) {
      console.error('[drawer-stack] Thread artifact renderer error:', artifact.contentType, error);
      content.textContent = 'Failed to load renderer: ' + artifact.contentType;
      content.style.padding = '24px';
      content.style.color = 'var(--text-secondary, #888)';
    }
  }

  function syncThreadArtifactDrawer(payload) {
    if (!payload || !payload.sessionId || !payload.threadId) return null;
    var entry = ensureThreadArtifactEntry(payload.sessionId);
    if (!entry) return null;

    var threadState = ensureThreadArtifactState(entry, payload.threadId);
    entry.activeThreadId = payload.threadId;

    threadState.drawerId = payload.drawerId || threadState.drawerId;
    threadState.artifactsByKey = {};
    threadState.order = [];

    (payload.artifacts || []).forEach(function (artifact) {
      if (!artifact || !artifact.artifactKey) return;
      threadState.artifactsByKey[artifact.artifactKey] = Object.assign({}, artifact);
      threadState.order.push(artifact.artifactKey);
    });

    if (!threadState.order.length) {
      threadState.selectedArtifactKey = null;
      threadState.isOpen = false;
      renderThreadArtifactContent(entry);
      return threadState.drawerId;
    }

    if (payload.selectedArtifactKey && threadState.artifactsByKey[payload.selectedArtifactKey]) {
      threadState.selectedArtifactKey = payload.selectedArtifactKey;
    } else if (!threadState.selectedArtifactKey || !threadState.artifactsByKey[threadState.selectedArtifactKey]) {
      threadState.selectedArtifactKey = threadState.order[threadState.order.length - 1];
    }

    threadState.isOpen = payload.open !== false;
    renderThreadArtifactContent(entry);
    if (threadState.isOpen) {
      openDrawerUi(entry);
    } else {
      closeDrawerUi(entry);
    }
    return threadState.drawerId;
  }

  function selectThreadArtifact(sessionId, threadId, artifactKey) {
    if (!sessionId || !threadId) return null;
    var entry = ensureThreadArtifactEntry(sessionId);
    var threadState = ensureThreadArtifactState(entry, threadId);
    if (!threadState || !threadState.order.length) return null;

    entry.activeThreadId = threadId;
    if (artifactKey && threadState.artifactsByKey[artifactKey]) {
      threadState.selectedArtifactKey = artifactKey;
    } else if (!threadState.selectedArtifactKey || !threadState.artifactsByKey[threadState.selectedArtifactKey]) {
      threadState.selectedArtifactKey = threadState.order[threadState.order.length - 1];
    }
    threadState.isOpen = true;
    renderThreadArtifactContent(entry);
    openDrawerUi(entry);
    return threadState.selectedArtifactKey;
  }

  function closeThreadArtifact(sessionId, threadId, artifactKey) {
    if (!sessionId || !threadId || !artifactKey) return null;
    var entry = threadArtifactDrawers.get(sessionId);
    if (!entry) return null;
    var threadState = entry.threads.get(threadId);
    if (!threadState || !threadState.artifactsByKey[artifactKey]) return null;

    delete threadState.artifactsByKey[artifactKey];
    threadState.order = threadState.order.filter(function (candidate) {
      return candidate !== artifactKey;
    });

    if (!threadState.order.length) {
      threadState.selectedArtifactKey = null;
      threadState.isOpen = false;
    } else if (threadState.selectedArtifactKey === artifactKey) {
      threadState.selectedArtifactKey = threadState.order[threadState.order.length - 1];
    }

    renderThreadArtifactContent(entry);
    if (threadState.isOpen) {
      openDrawerUi(entry);
    } else {
      closeDrawerUi(entry);
    }
    return threadState.selectedArtifactKey;
  }

  function closeThreadArtifactDrawer(sessionId, threadId) {
    if (!sessionId) return;
    var entry = threadArtifactDrawers.get(sessionId);
    if (!entry) return;
    var targetThreadId = threadId || entry.activeThreadId;
    var threadState = targetThreadId ? entry.threads.get(targetThreadId) : null;
    if (threadState) {
      threadState.isOpen = false;
    }
    closeDrawerUi(entry);
  }

  function setThreadArtifactContext(sessionId, threadId) {
    if (!sessionId) return;
    var entry = threadArtifactDrawers.get(sessionId);
    if (!entry) return;
    entry.activeThreadId = threadId || null;
    renderThreadArtifactContent(entry);

    var threadState = getActiveThreadArtifactState(entry);
    if (threadState && threadState.isOpen && threadState.order.length) {
      openDrawerUi(entry);
    } else {
      closeDrawerUi(entry);
    }
  }

  var utils = window.__companionUtils || {};
  utils.invokeRenderer = invokeRenderer;
  utils.closeDrawer = closeDrawer;
  utils.closeAllDrawers = closeAllDrawers;
  utils.setActiveSession = setActiveSession;
  utils.hideSessionDrawers = hideSessionDrawers;
  utils.showSessionDrawers = showSessionDrawers;
  utils.closeSessionDrawers = closeSessionDrawers;
  utils.syncThreadArtifactDrawer = syncThreadArtifactDrawer;
  utils.selectThreadArtifact = selectThreadArtifact;
  utils.closeThreadArtifact = closeThreadArtifact;
  utils.closeThreadArtifactDrawer = closeThreadArtifactDrawer;
  utils.setThreadArtifactContext = setThreadArtifactContext;
  window.__companionUtils = utils;
})();
