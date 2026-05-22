// @ts-nocheck
/* Drawer Stack Manager — stacking slide-out panels for cross-renderer invocation */

(function () {
  'use strict';

  var stacks = new Map();
  var threadChatOutputDrawers = new Map();
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

    var chatOutputEntry = threadChatOutputDrawers.get(sessionId);
    if (!chatOutputEntry) return;
    setDrawerDisplay(chatOutputEntry, false);
  }

  function showSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (stack) {
      for (var i = 0; i < stack.length; i++) {
        setDrawerDisplay(stack[i], true);
      }
    }

    var chatOutputEntry = threadChatOutputDrawers.get(sessionId);
    if (!chatOutputEntry) return;
    var chatOutputState = getActiveThreadChatOutputState(chatOutputEntry);
    if (chatOutputState && chatOutputState.isOpen && chatOutputState.order.length) {
      openDrawerUi(chatOutputEntry);
      return;
    }
    setDrawerDisplay(chatOutputEntry, false);
  }

  function closeSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (stack) {
      for (var i = 0; i < stack.length; i++) {
        removeDrawerEntry(stack[i]);
      }
      stacks.delete(sessionId);
    }

    var chatOutputEntry = threadChatOutputDrawers.get(sessionId);
    if (!chatOutputEntry) return;
    removeDrawerEntry(chatOutputEntry);
    threadChatOutputDrawers.delete(sessionId);
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

  function submitChatOutputDecision(reviewSessionId, decision) {
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
      console.error('[drawer-stack] Failed to submit chatOutput decision:', error);
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

    closeThreadChatOutputDrawer(currentSessionId);
  }

  function closeAllDrawers() {
    var stack = getStack(currentSessionId);
    while (stack.length > 0) {
      var entry = stack.pop();
      removeDrawerEntry(entry);
    }
    closeThreadChatOutputDrawer(currentSessionId);
  }

  function ensureThreadChatOutputEntry(sessionId) {
    if (sessionId == null) return null;
    var existing = threadChatOutputDrawers.get(sessionId);
    if (existing) return existing;

    var entry = createDrawerEntry(sessionId, 0, {
      rendererName: 'thread_chatOutputs',
      title: 'Chat outputs',
      displayMode: 'thread-chat-output-drawer',
      overlayClassName: 'thread-chat-output-shell-overlay',
      panelClassName: 'thread-chat-output-shell-panel',
      headerClassName: 'thread-chat-output-shell-header',
      contentClassName: 'thread-chat-output-shell-content',
      onClose: function () {
        closeThreadChatOutputDrawer(sessionId);
      },
    });

    entry.threads = new Map();
    entry.activeThreadId = null;
    threadChatOutputDrawers.set(sessionId, entry);
    return entry;
  }

  function ensureThreadChatOutputState(entry, threadId) {
    if (!entry || !threadId) return null;
    if (!entry.threads.has(threadId)) {
      entry.threads.set(threadId, {
        drawerId: 'tribex-ai-thread-chat-outputs:' + threadId,
        chatOutputsByKey: {},
        order: [],
        selectedChatOutputKey: null,
        isOpen: false,
      });
    }
    return entry.threads.get(threadId);
  }

  function getActiveThreadChatOutputState(entry) {
    if (!entry || !entry.activeThreadId) return null;
    return entry.threads.get(entry.activeThreadId) || null;
  }

  function renderThreadChatOutputContent(entry) {
    if (!entry) return;
    clearElementChildren(entry.content);

    var threadState = getActiveThreadChatOutputState(entry);
    if (!threadState || !threadState.order.length) {
      updateDrawerTitle(entry, 'Chat outputs');
      closeDrawerUi(entry);
      return;
    }

    var selectedKey = threadState.selectedChatOutputKey;
    if (!selectedKey || !threadState.chatOutputsByKey[selectedKey]) {
      selectedKey = threadState.order[threadState.order.length - 1];
      threadState.selectedChatOutputKey = selectedKey;
    }

    var chatOutput = threadState.chatOutputsByKey[selectedKey];
    if (!chatOutput) {
      updateDrawerTitle(entry, 'Chat outputs');
      closeDrawerUi(entry);
      return;
    }

    updateDrawerTitle(entry, chatOutput.title || 'Chat output');

    var body = document.createElement('div');
    body.className = 'thread-chat-output-shell';
    entry.content.appendChild(body);

    if (threadState.order.length > 1) {
      var tabs = document.createElement('div');
      tabs.className = 'thread-chat-output-tabs';

      threadState.order.forEach(function (chatOutputKey) {
        var tabChatOutput = threadState.chatOutputsByKey[chatOutputKey];
        if (!tabChatOutput) return;

        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'thread-chat-output-tab' + (chatOutputKey === selectedKey ? ' is-active' : '');
        tab.addEventListener('click', function () {
          selectThreadChatOutput(entry.sessionId, entry.activeThreadId, chatOutputKey);
        });

        var label = document.createElement('span');
        label.className = 'thread-chat-output-tab-label';
        label.textContent = tabChatOutput.title || 'Chat output';
        tab.appendChild(label);

        var close = document.createElement('span');
        close.className = 'thread-chat-output-tab-close';
        close.textContent = '\u00D7';
        close.addEventListener('click', function (event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          closeThreadChatOutput(entry.sessionId, entry.activeThreadId, chatOutputKey);
        });
        tab.appendChild(close);
        tabs.appendChild(tab);
      });

      body.appendChild(tabs);
    }

    var content = document.createElement('div');
    content.className = 'thread-chat-output-content';
    body.appendChild(content);

    var renderer = window.__renderers && window.__renderers[chatOutput.contentType];
    if (typeof renderer !== 'function') {
      content.textContent = 'Renderer not found: ' + chatOutput.contentType;
      content.style.padding = '24px';
      content.style.color = 'var(--text-secondary, #888)';
      return;
    }

    try {
      var reviewRequired = !!(chatOutput.reviewRequired || (chatOutput.meta && chatOutput.meta.reviewRequired));
      var reviewSessionId = chatOutput.reviewSessionId || (chatOutput.meta && chatOutput.meta.reviewSessionId) || null;
      renderer(
        content,
        chatOutput.data || {},
        chatOutput.meta || {},
        chatOutput.toolArgs || {},
        reviewRequired,
        reviewRequired && reviewSessionId
          ? function (decision) {
              submitChatOutputDecision(reviewSessionId, decision);
            }
          : null,
        {
          mode: 'thread-chat-output-drawer',
          params: chatOutput.data || {},
          level: 0,
          invoke: function (name, p) {
            invokeRenderer(name, p);
          },
        },
      );
    } catch (error) {
      console.error('[drawer-stack] Thread chatOutput renderer error:', chatOutput.contentType, error);
      content.textContent = 'Failed to load renderer: ' + chatOutput.contentType;
      content.style.padding = '24px';
      content.style.color = 'var(--text-secondary, #888)';
    }
  }

  function syncThreadChatOutputDrawer(payload) {
    if (!payload || !payload.sessionId || !payload.threadId) return null;
    var entry = threadChatOutputDrawers.get(payload.sessionId);
    if (entry) {
      removeDrawerEntry(entry);
      threadChatOutputDrawers.delete(payload.sessionId);
    }
    return payload.drawerId || 'tribex-ai-thread-chat-outputs:' + payload.threadId;
  }

  function selectThreadChatOutput(sessionId, threadId, chatOutputKey) {
    if (!sessionId || !threadId) return null;
    var entry = threadChatOutputDrawers.get(sessionId);
    if (entry) {
      removeDrawerEntry(entry);
      threadChatOutputDrawers.delete(sessionId);
    }
    return null;
  }

  function closeThreadChatOutput(sessionId, threadId, chatOutputKey) {
    if (!sessionId || !threadId || !chatOutputKey) return null;
    var entry = threadChatOutputDrawers.get(sessionId);
    if (!entry) return null;
    var threadState = entry.threads.get(threadId);
    if (!threadState || !threadState.chatOutputsByKey[chatOutputKey]) return null;

    delete threadState.chatOutputsByKey[chatOutputKey];
    threadState.order = threadState.order.filter(function (candidate) {
      return candidate !== chatOutputKey;
    });

    if (!threadState.order.length) {
      threadState.selectedChatOutputKey = null;
      threadState.isOpen = false;
    } else if (threadState.selectedChatOutputKey === chatOutputKey) {
      threadState.selectedChatOutputKey = threadState.order[threadState.order.length - 1];
    }

    renderThreadChatOutputContent(entry);
    if (threadState.isOpen) {
      openDrawerUi(entry);
    } else {
      closeDrawerUi(entry);
    }
    return threadState.selectedChatOutputKey;
  }

  function closeThreadChatOutputDrawer(sessionId, threadId) {
    if (!sessionId) return;
    var entry = threadChatOutputDrawers.get(sessionId);
    if (!entry) return;
    var targetThreadId = threadId || entry.activeThreadId;
    var threadState = targetThreadId ? entry.threads.get(targetThreadId) : null;
    if (threadState) {
      threadState.isOpen = false;
    }
    closeDrawerUi(entry);
  }

  function setThreadChatOutputContext(sessionId, threadId) {
    if (!sessionId) return;
    var entry = threadChatOutputDrawers.get(sessionId);
    if (!entry) return;
    entry.activeThreadId = threadId || null;
    renderThreadChatOutputContent(entry);

    var threadState = getActiveThreadChatOutputState(entry);
    if (threadState) threadState.isOpen = false;
    closeDrawerUi(entry);
  }

  var utils = window.__companionUtils || {};
  utils.invokeRenderer = invokeRenderer;
  utils.closeDrawer = closeDrawer;
  utils.closeAllDrawers = closeAllDrawers;
  utils.setActiveSession = setActiveSession;
  utils.hideSessionDrawers = hideSessionDrawers;
  utils.showSessionDrawers = showSessionDrawers;
  utils.closeSessionDrawers = closeSessionDrawers;
  utils.syncThreadChatOutputDrawer = syncThreadChatOutputDrawer;
  utils.selectThreadChatOutput = selectThreadChatOutput;
  utils.closeThreadChatOutput = closeThreadChatOutput;
  utils.closeThreadChatOutputDrawer = closeThreadChatOutputDrawer;
  utils.setThreadChatOutputContext = setThreadChatOutputContext;
  window.__companionUtils = utils;
})();
