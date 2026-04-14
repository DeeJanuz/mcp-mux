// @ts-nocheck
/* TribeX AI thread renderer */

(function () {
  'use strict';

  function createMessage(message) {
    var row = document.createElement('article');

    if (message.role === 'tool') {
      row.className = 'ai-tool-event ai-tool-event-' + message.status;
      row.innerHTML =
        '<div class="ai-tool-event-header"><strong>' + (message.toolName || 'tool') + '</strong><span>' + window.__tribexAiUtils.titleCase(message.status) + '</span></div>' +
        '<p>' + message.summary + '</p>' +
        '<small>' + message.detail + '</small>';
      return row;
    }

    row.className = 'ai-chat-bubble ai-chat-bubble-' + message.role;

    var meta = document.createElement('span');
    meta.className = 'ai-chat-role';
    meta.textContent = message.role === 'assistant' ? 'Assistant' : 'You';
    row.appendChild(meta);

    var body = document.createElement('p');
    body.textContent = message.content;
    row.appendChild(body);

    return row;
  }

  function renderThreadBanner(view, threadContext) {
    var thread = threadContext.thread;
    var banner = document.createElement('section');
    banner.className = 'ai-thread-banner';
    banner.innerHTML =
      '<div><p class="ai-kicker">' + threadContext.workspace.name + ' · ' + threadContext.project.name + '</p>' +
      '<h1>' + thread.title + '</h1>' +
      '<p class="ai-lede">Threads open as tabs, recover cached shell state immediately, and then hydrate hosted truth without losing local readiness context.</p></div>';

    var pills = document.createElement('div');
    pills.className = 'ai-thread-pill-row';

    var hydratePill = document.createElement('span');
    hydratePill.className = 'ai-pill ai-pill-neutral';
    hydratePill.textContent = window.__tribexAiUtils.titleCase(thread.hydrateState);
    pills.appendChild(hydratePill);

    var timePill = document.createElement('span');
    timePill.className = 'ai-pill ai-pill-neutral';
    timePill.textContent = window.__tribexAiUtils.formatRelativeTime(thread.lastActivityAt);
    pills.appendChild(timePill);

    banner.appendChild(pills);
    view.appendChild(banner);

    if (thread.hydrateState === 'REHYDRATING') {
      var hydrate = document.createElement('section');
      hydrate.className = 'ai-inline-alert ai-inline-alert-info';
      hydrate.innerHTML = '<div><strong>Hydrating hosted truth</strong><p>Cached shell state is already visible while transcript history and long-running hosted work reconcile in the background.</p></div>';
      view.appendChild(hydrate);
    }

    if (threadContext.blockedBinding && threadContext.blockedBinding.readiness !== 'ready') {
      var blocked = document.createElement('section');
      blocked.className = 'ai-inline-alert ai-inline-alert-warning';
      blocked.innerHTML =
        '<div><strong>' + threadContext.blockedBinding.name + ' needs attention</strong>' +
        '<p>This thread is open and recoverable, but local ' + threadContext.blockedBinding.name + ' access is still blocked on this device.</p></div>';

      var button = document.createElement('button');
      button.className = 'ai-inline-alert-btn';
      button.type = 'button';
      button.textContent = 'Open tool catalog';
      button.addEventListener('click', function () {
        window.__tribexAiState.openToolCatalog();
      });
      blocked.appendChild(button);
      view.appendChild(blocked);
    }
  }

  function renderTranscript(view, threadContext) {
    var section = document.createElement('section');
    section.className = 'ai-thread-layout';

    var transcript = document.createElement('div');
    transcript.className = 'ai-chat-log';
    threadContext.thread.messages.forEach(function (message) {
      transcript.appendChild(createMessage(message));
    });
    section.appendChild(transcript);

    var rail = document.createElement('aside');
    rail.className = 'ai-thread-rail';
    rail.innerHTML =
      '<div class="ai-rail-card"><strong>Project memory</strong><p>' + threadContext.project.memorySummary + '</p></div>' +
      '<div class="ai-rail-card"><strong>Workspace policy</strong><p>Hosted transcript is authoritative. Device-local readiness and relay access remain local to MCPViews.</p></div>';
    section.appendChild(rail);

    view.appendChild(section);
  }

  function renderComposer(view, threadContext) {
    var section = document.createElement('section');
    section.className = 'ai-composer-shell';

    var textarea = document.createElement('textarea');
    textarea.className = 'ai-composer-input';
    textarea.placeholder = 'Ask the hosted thread to keep building the MCPViews client…';

    var blocked = threadContext.blockedBinding && threadContext.blockedBinding.readiness !== 'ready';
    if (blocked) {
      textarea.disabled = true;
      textarea.placeholder = 'Composer is blocked until ' + threadContext.blockedBinding.name + ' is ready on this device.';
    }

    section.appendChild(textarea);

    var footer = document.createElement('div');
    footer.className = 'ai-actions-row';

    var secondary = document.createElement('button');
    secondary.className = 'ai-secondary-btn';
    secondary.type = 'button';
    secondary.textContent = 'Tool catalog';
    secondary.addEventListener('click', function () {
      window.__tribexAiState.openToolCatalog();
    });
    footer.appendChild(secondary);

    var primary = document.createElement('button');
    primary.className = 'ai-primary-btn';
    primary.type = 'button';
    primary.textContent = blocked ? 'Blocked by readiness' : 'Send prompt';
    primary.disabled = blocked;
    primary.addEventListener('click', function () {
      var submitted = window.__tribexAiState.submitPrompt(threadContext.thread.id, textarea.value);
      if (submitted) {
        textarea.value = '';
      }
    });
    footer.appendChild(primary);

    section.appendChild(footer);
    view.appendChild(section);
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.tribex_ai_thread = function renderTribexAiThread(container, data, meta, toolArgs) {
    var aiState = window.__tribexAiState;
    var threadId = toolArgs && toolArgs.threadId;
    if (!aiState || !threadId) {
      container.textContent = 'Thread context is unavailable.';
      return;
    }

    var threadContext = aiState.getThreadContext(threadId);
    if (!threadContext) {
      container.textContent = 'Unable to load the selected thread.';
      return;
    }

    var view = document.createElement('div');
    view.className = 'ai-view';

    renderThreadBanner(view, threadContext);
    renderTranscript(view, threadContext);
    renderComposer(view, threadContext);

    container.innerHTML = '';
    container.appendChild(view);
  };
})();
