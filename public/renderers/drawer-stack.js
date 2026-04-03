// @ts-nocheck
/* Drawer Stack Manager — stacking slide-out panels for cross-renderer invocation */

(function () {
  'use strict';

  var stacks = new Map();
  var currentSessionId = null;
  var BASE_Z = 150;
  var Z_INCREMENT = 2;
  var WIDTH_SHRINK = 20; // px narrower per level

  function getStack(sessionId) {
    if (sessionId == null) return [];
    if (!stacks.has(sessionId)) stacks.set(sessionId, []);
    return stacks.get(sessionId);
  }

  function setActiveSession(sessionId) {
    currentSessionId = sessionId;
  }

  function hideSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (!stack) return;
    for (var i = 0; i < stack.length; i++) {
      stack[i].overlay.style.display = 'none';
      stack[i].panel.style.display = 'none';
    }
  }

  function showSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (!stack) return;
    for (var i = 0; i < stack.length; i++) {
      stack[i].overlay.style.display = '';
      stack[i].panel.style.display = '';
    }
  }

  function closeSessionDrawers(sessionId) {
    var stack = stacks.get(sessionId);
    if (!stack) return;
    for (var i = 0; i < stack.length; i++) {
      if (stack[i].overlay.parentNode) stack[i].overlay.parentNode.removeChild(stack[i].overlay);
      if (stack[i].panel.parentNode) stack[i].panel.parentNode.removeChild(stack[i].panel);
    }
    stacks.delete(sessionId);
  }

  function createOverlay(level) {
    var overlay = document.createElement('div');
    overlay.className = 'drawer-stack-overlay';
    overlay.style.zIndex = String(BASE_Z + level * Z_INCREMENT);
    overlay.addEventListener('click', function () {
      closeDrawer();
    });
    return overlay;
  }

  function createPanel(level) {
    var panel = document.createElement('div');
    panel.className = 'drawer-stack-panel';
    panel.style.zIndex = String(BASE_Z + level * Z_INCREMENT + 1);
    panel.style.width = Math.max(320, 420 - level * WIDTH_SHRINK) + 'px';
    return panel;
  }

  function buildPanelHeader(rendererName) {
    var header = document.createElement('div');
    header.className = 'drawer-stack-header';

    var title = document.createElement('span');
    title.className = 'drawer-stack-title';
    title.textContent = rendererName.replace(/_/g, ' ');
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'drawer-stack-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.setAttribute('aria-label', 'Close drawer');
    closeBtn.addEventListener('click', function () {
      closeDrawer();
    });
    header.appendChild(closeBtn);

    return header;
  }

  function invokeRenderer(rendererName, params, displayMode) {
    var stack = getStack(currentSessionId);
    var level = stack.length;

    var overlay = createOverlay(level);
    var panel = createPanel(level);

    // Build header
    var header = buildPanelHeader(rendererName);
    panel.appendChild(header);

    // Content container for the renderer
    var content = document.createElement('div');
    content.className = 'drawer-stack-content';
    panel.appendChild(content);

    var host = (currentSessionId && document.querySelector('.session-content[data-session-id="' + currentSessionId + '"]'))
      || document.getElementById('content-area') || document.body;
    host.appendChild(overlay);
    host.appendChild(panel);

    stack.push({ overlay: overlay, panel: panel, rendererName: rendererName });

    // Trigger open animation on next frame
    requestAnimationFrame(function () {
      overlay.classList.add('open');
      panel.classList.add('open');
    });

    // Build context object for the invoked renderer
    var context = {
      mode: displayMode || 'drawer',
      params: params || {},
      level: level,
      invoke: function (name, p) {
        invokeRenderer(name, p);
      },
    };

    // Look up and call the renderer
    var renderer = window.__renderers && window.__renderers[rendererName];
    if (renderer) {
      try {
        renderer(content, params || {}, {}, {}, false, function () {}, context);
      } catch (err) {
        console.error('[drawer-stack] Renderer error:', rendererName, err);
        content.textContent = 'Failed to load renderer: ' + rendererName;
      }
    } else {
      content.textContent = 'Renderer not found: ' + rendererName;
      content.style.padding = '24px';
      content.style.color = 'var(--text-secondary, #888)';
    }
  }

  function closeDrawer() {
    var stack = getStack(currentSessionId);
    if (stack.length === 0) return;
    var entry = stack.pop();

    entry.panel.classList.remove('open');
    entry.overlay.classList.remove('open');

    // Remove after transition
    setTimeout(function () {
      if (entry.overlay.parentNode) entry.overlay.parentNode.removeChild(entry.overlay);
      if (entry.panel.parentNode) entry.panel.parentNode.removeChild(entry.panel);
    }, 300);
  }

  function closeAllDrawers() {
    var stack = getStack(currentSessionId);
    while (stack.length > 0) {
      closeDrawer();
    }
  }

  // Register on __companionUtils
  var utils = window.__companionUtils || {};
  utils.invokeRenderer = invokeRenderer;
  utils.closeDrawer = closeDrawer;
  utils.closeAllDrawers = closeAllDrawers;
  utils.setActiveSession = setActiveSession;
  utils.hideSessionDrawers = hideSessionDrawers;
  utils.showSessionDrawers = showSessionDrawers;
  utils.closeSessionDrawers = closeSessionDrawers;
  window.__companionUtils = utils;
})();
