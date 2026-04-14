// @ts-nocheck
/* TribeX AI thread renderer */

(function () {
  'use strict';

  function createMessage(message) {
    var row = document.createElement('article');

    if (message.role === 'tool') {
      row.className = 'ai-tool-event ai-tool-event-' + (message.status || 'pending');
      row.innerHTML =
        '<div class="ai-tool-event-header"><strong>' + (message.toolName || 'tool') + '</strong><span>' + window.__tribexAiUtils.titleCase(message.status || 'pending') + '</span></div>' +
        '<p>' + (message.summary || '') + '</p>' +
        '<small>' + (message.detail || '') + '</small>';
      return row;
    }

    row.className = 'ai-chat-bubble ai-chat-bubble-' + message.role;

    var meta = document.createElement('span');
    meta.className = 'ai-chat-role';
    meta.textContent = message.role === 'assistant' ? 'Assistant' : 'You';
    row.appendChild(meta);

    var body = document.createElement('p');
    body.textContent = message.content || '';
    row.appendChild(body);

    return row;
  }

  function renderThreadHeader(view, threadContext) {
    var header = document.createElement('section');
    header.className = 'ai-thread-header';

    var copy = document.createElement('div');
    copy.className = 'ai-thread-header-copy';
    copy.innerHTML =
      '<p class="ai-kicker">' + ((threadContext.organization && threadContext.organization.name) || 'AI workspace') + '</p>' +
      '<h1>' + ((threadContext.thread && threadContext.thread.title) || 'Thread') + '</h1>' +
      '<p class="ai-lede">' + [
        threadContext.workspace && threadContext.workspace.name,
        threadContext.project && threadContext.project.name,
      ].filter(Boolean).join(' · ') + '</p>';
    header.appendChild(copy);

    var pills = document.createElement('div');
    pills.className = 'ai-thread-pill-row';

    if (threadContext.streamStatus) {
      var streamPill = document.createElement('span');
      streamPill.className = 'ai-pill ai-pill-neutral';
      streamPill.textContent = 'Stream: ' + window.__tribexAiUtils.titleCase(threadContext.streamStatus);
      pills.appendChild(streamPill);
    }

    if (threadContext.thread && threadContext.thread.lastActivityAt) {
      var timePill = document.createElement('span');
      timePill.className = 'ai-pill ai-pill-neutral';
      timePill.textContent = window.__tribexAiUtils.formatRelativeTime(threadContext.thread.lastActivityAt);
      pills.appendChild(timePill);
    }

    header.appendChild(pills);
    view.appendChild(header);

    if (threadContext.loading) {
      var loading = document.createElement('section');
      loading.className = 'ai-inline-alert ai-inline-alert-info';
      loading.innerHTML = '<div><strong>Hydrating thread</strong><p>Refreshing transcript and hosted activity for this thread.</p></div>';
      view.appendChild(loading);
    }

    if (threadContext.error) {
      var error = document.createElement('section');
      error.className = 'ai-inline-alert ai-inline-alert-warning';
      error.innerHTML = '<div><strong>Thread needs attention</strong><p>' + threadContext.error + '</p></div>';
      view.appendChild(error);
    }
  }

  function renderTranscript(view, threadContext) {
    var transcript = document.createElement('section');
    transcript.className = 'ai-chat-log ai-chat-log-standalone';

    var messages = (threadContext.thread && threadContext.thread.messages) || [];
    if (!messages.length) {
      var empty = document.createElement('div');
      empty.className = 'ai-thread-empty';
      empty.innerHTML = '<strong>No messages yet</strong><p>Start the conversation and the hosted thread will appear here.</p>';
      transcript.appendChild(empty);
    } else {
      messages.forEach(function (message) {
        transcript.appendChild(createMessage(message));
      });
    }

    view.appendChild(transcript);
  }

  function renderComposer(view, threadContext) {
    var section = document.createElement('section');
    section.className = 'ai-composer-shell';

    var textarea = document.createElement('textarea');
    textarea.className = 'ai-composer-input';
    textarea.placeholder = 'Send a message to the hosted thread…';
    textarea.disabled = !!threadContext.pending;
    section.appendChild(textarea);

    var footer = document.createElement('div');
    footer.className = 'ai-actions-row';

    var refresh = document.createElement('button');
    refresh.className = 'ai-secondary-btn';
    refresh.type = 'button';
    refresh.textContent = 'Refresh thread';
    refresh.addEventListener('click', function () {
      window.__tribexAiState.refreshActiveThread();
    });
    footer.appendChild(refresh);

    var primary = document.createElement('button');
    primary.className = 'ai-primary-btn';
    primary.type = 'button';
    primary.textContent = threadContext.pending ? 'Sending…' : 'Send';
    primary.disabled = !!threadContext.pending;
    primary.addEventListener('click', function () {
      var prompt = textarea.value;
      window.__tribexAiState.submitPrompt(threadContext.thread.id, prompt).then(function (submitted) {
        if (submitted) textarea.value = '';
      });
    });
    footer.appendChild(primary);

    textarea.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !primary.disabled) {
        primary.click();
      }
    });

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
    if (!threadContext || !threadContext.thread) {
      container.textContent = 'Unable to load the selected thread.';
      return;
    }

    var view = document.createElement('div');
    view.className = 'ai-view';

    renderThreadHeader(view, threadContext);
    renderTranscript(view, threadContext);
    renderComposer(view, threadContext);

    container.innerHTML = '';
    container.appendChild(view);
  };
})();
