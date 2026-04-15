// @ts-nocheck
/* TribeX AI thread renderer */

(function () {
  'use strict';

  function isLifecycleToolName(toolName) {
    var value = String(toolName || '');
    return /^brokered\.thread\.execution\./.test(value) || /^opencode\.thread\.execution\./.test(value);
  }

  function isRenderableArtifact(message) {
    return !!(
      message &&
      message.role === 'tool' &&
      message.toolName === 'rich_content' &&
      message.resultData &&
      window.__renderers &&
      typeof window.__renderers.rich_content === 'function'
    );
  }

  function createTextBody(content, className) {
    var body = document.createElement('div');
    body.className = className;
    body.textContent = content || '';
    return body;
  }

  function buildDisplayModel(messages) {
    var visible = [];
    var activity = [];

    (messages || []).forEach(function (message) {
      if (!message) return;

      if (message.role === 'tool' && isLifecycleToolName(message.toolName)) {
        activity.push(message);
        return;
      }

      if (
        message.role === 'user' &&
        visible.length &&
        visible[visible.length - 1].type === 'chat' &&
        visible[visible.length - 1].message.role === 'user' &&
        visible[visible.length - 1].message.content === message.content
      ) {
        visible[visible.length - 1].repeatCount += 1;
        visible[visible.length - 1].latestCreatedAt = message.createdAt || visible[visible.length - 1].latestCreatedAt;
        return;
      }

      visible.push({
        type: isRenderableArtifact(message)
          ? 'artifact'
          : message.role === 'tool'
            ? 'tool'
            : 'chat',
        message: message,
        repeatCount: 1,
        latestCreatedAt: message.createdAt || null,
      });
    });

    return {
      visible: visible,
      activity: activity,
    };
  }

  function summarizeActivity(activity) {
    var counts = {
      total: activity.length,
      completed: 0,
      failed: 0,
      started: 0,
      pending: 0,
    };

    activity.forEach(function (message) {
      var toolName = String(message.toolName || '');
      var status = String(message.status || '').toLowerCase();

      if (toolName.indexOf('.completed') >= 0) counts.completed += 1;
      else if (toolName.indexOf('.failed') >= 0 || status === 'blocked' || status === 'error') counts.failed += 1;
      else if (toolName.indexOf('.started') >= 0) counts.started += 1;
      else counts.pending += 1;
    });

    return counts;
  }

  function renderThreadHeader(view, threadContext) {
    var header = document.createElement('section');
    header.className = 'ai-thread-header';

    var breadcrumb = document.createElement('p');
    breadcrumb.className = 'ai-thread-breadcrumb';
    breadcrumb.textContent = [
      threadContext.workspace && threadContext.workspace.name,
      threadContext.project && threadContext.project.name,
    ].filter(Boolean).join(' / ') || ((threadContext.organization && threadContext.organization.name) || 'Hosted workspace');
    header.appendChild(breadcrumb);

    var titleRow = document.createElement('div');
    titleRow.className = 'ai-thread-title-row';

    var copy = document.createElement('div');
    copy.className = 'ai-thread-header-copy';

    var title = document.createElement('h1');
    title.textContent = ((threadContext.thread && threadContext.thread.title) || 'Thread');
    copy.appendChild(title);

    var lede = document.createElement('p');
    lede.className = 'ai-thread-lede';
    lede.textContent = 'Hosted replies, streamed artifacts, and relay activity stay attached to this thread.';
    copy.appendChild(lede);
    titleRow.appendChild(copy);

    var pills = document.createElement('div');
    pills.className = 'ai-thread-pill-row';

    if (threadContext.streamStatus) {
      var streamPill = document.createElement('span');
      streamPill.className = 'ai-pill ai-pill-neutral';
      streamPill.textContent = 'Stream ' + window.__tribexAiUtils.titleCase(threadContext.streamStatus);
      pills.appendChild(streamPill);
    }

    if (threadContext.relayStatus) {
      var relayPill = document.createElement('span');
      relayPill.className = 'ai-pill ai-pill-neutral';
      relayPill.textContent = 'Relay ' + window.__tribexAiUtils.titleCase(threadContext.relayStatus);
      pills.appendChild(relayPill);
    }

    if (threadContext.thread && threadContext.thread.lastActivityAt) {
      var timePill = document.createElement('span');
      timePill.className = 'ai-pill ai-pill-neutral';
      timePill.textContent = window.__tribexAiUtils.formatRelativeTime(threadContext.thread.lastActivityAt);
      pills.appendChild(timePill);
    }

    titleRow.appendChild(pills);
    header.appendChild(titleRow);
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

  function createChatMessage(block) {
    var message = block.message;
    var row = document.createElement('article');
    row.className = 'ai-chat-bubble ai-chat-bubble-' + message.role;

    var metaRow = document.createElement('div');
    metaRow.className = 'ai-chat-meta-row';

    var role = document.createElement('span');
    role.className = 'ai-chat-role';
    role.textContent = message.role === 'assistant' ? 'Assistant' : 'You';
    metaRow.appendChild(role);

    if (block.repeatCount > 1) {
      var badge = document.createElement('span');
      badge.className = 'ai-chat-attempt-badge';
      badge.textContent = block.repeatCount + ' attempts';
      metaRow.appendChild(badge);
    }

    if (block.latestCreatedAt) {
      var time = document.createElement('span');
      time.className = 'ai-chat-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(block.latestCreatedAt);
      metaRow.appendChild(time);
    }

    row.appendChild(metaRow);

    if (block.repeatCount > 1) {
      var retryNote = document.createElement('p');
      retryNote.className = 'ai-chat-retry-note';
      retryNote.textContent = 'Repeated across consecutive retries. Showing the latest prompt once.';
      row.appendChild(retryNote);
    }

    row.appendChild(createTextBody(message.content || '', 'ai-chat-body'));
    return row;
  }

  function createToolNote(message) {
    var row = document.createElement('article');
    row.className = 'ai-tool-note';

    var header = document.createElement('div');
    header.className = 'ai-tool-note-header';

    var title = document.createElement('strong');
    title.textContent = message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'tool');
    header.appendChild(title);

    if (message.createdAt) {
      var time = document.createElement('span');
      time.className = 'ai-tool-note-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(message.createdAt);
      header.appendChild(time);
    }

    row.appendChild(header);

    if (message.detail) {
      row.appendChild(createTextBody(message.detail, 'ai-tool-note-body'));
    }

    return row;
  }

  function createArtifactMessage(message) {
    var row = document.createElement('article');
    row.className = 'ai-artifact-card';

    var header = document.createElement('div');
    header.className = 'ai-artifact-header';

    var copy = document.createElement('div');
    copy.className = 'ai-artifact-copy';

    var kicker = document.createElement('span');
    kicker.className = 'ai-artifact-kicker';
    kicker.textContent = 'Artifact';
    copy.appendChild(kicker);

    var title = document.createElement('strong');
    title.textContent = (message.resultData && message.resultData.title) || 'Streamed artifact';
    copy.appendChild(title);
    header.appendChild(copy);

    if (message.createdAt) {
      var time = document.createElement('span');
      time.className = 'ai-artifact-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(message.createdAt);
      header.appendChild(time);
    }

    row.appendChild(header);

    var body = document.createElement('div');
    body.className = 'ai-artifact-body';
    row.appendChild(body);

    window.__renderers.rich_content(
      body,
      message.resultData,
      message.resultMeta || null,
      message.toolArgs || null,
      false,
      null,
    );

    return row;
  }

  function renderActivity(view, activity) {
    if (!activity.length) return;

    var summary = summarizeActivity(activity);
    var drawer = document.createElement('details');
    drawer.className = 'ai-activity-drawer';

    if (summary.failed > 0 && summary.completed === 0) {
      drawer.open = true;
    }

    var heading = document.createElement('summary');
    heading.className = 'ai-activity-summary';

    var copy = document.createElement('div');
    copy.className = 'ai-activity-copy';

    var kicker = document.createElement('span');
    kicker.className = 'ai-activity-kicker';
    kicker.textContent = 'Run activity';
    copy.appendChild(kicker);

    var title = document.createElement('strong');
    title.textContent = summary.total + ' hosted events';
    copy.appendChild(title);

    var subline = document.createElement('span');
    subline.className = 'ai-activity-subline';
    subline.textContent = [
      summary.completed ? summary.completed + ' completed' : null,
      summary.failed ? summary.failed + ' failed' : null,
      summary.started ? summary.started + ' started' : null,
      summary.pending ? summary.pending + ' updates' : null,
    ].filter(Boolean).join(' · ');
    copy.appendChild(subline);
    heading.appendChild(copy);

    var toggle = document.createElement('span');
    toggle.className = 'ai-activity-toggle';
    toggle.textContent = 'Show details';
    heading.appendChild(toggle);
    drawer.appendChild(heading);

    drawer.addEventListener('toggle', function () {
      toggle.textContent = drawer.open ? 'Hide details' : 'Show details';
    });

    var list = document.createElement('div');
    list.className = 'ai-activity-list';

    activity.forEach(function (message) {
      var item = document.createElement('article');
      item.className = 'ai-activity-item';

      var itemHeader = document.createElement('div');
      itemHeader.className = 'ai-activity-item-header';

      var title = document.createElement('strong');
      title.textContent = message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'event');
      itemHeader.appendChild(title);

      var status = document.createElement('span');
      status.className = 'ai-activity-status';
      status.textContent = window.__tribexAiUtils.titleCase(message.status || 'success');
      itemHeader.appendChild(status);
      item.appendChild(itemHeader);

      if (message.detail) {
        item.appendChild(createTextBody(message.detail, 'ai-activity-detail'));
      }

      list.appendChild(item);
    });

    drawer.appendChild(list);
    view.appendChild(drawer);
  }

  function renderTranscript(view, threadContext) {
    var transcript = document.createElement('section');
    transcript.className = 'ai-chat-log ai-chat-log-standalone';

    var model = buildDisplayModel((threadContext.thread && threadContext.thread.messages) || []);

    if (!model.visible.length) {
      var empty = document.createElement('div');
      empty.className = 'ai-thread-empty';
      empty.innerHTML = '<strong>No messages yet</strong><p>Start the conversation and the hosted thread will appear here.</p>';
      transcript.appendChild(empty);
    } else {
      model.visible.forEach(function (block) {
        if (block.type === 'chat') {
          transcript.appendChild(createChatMessage(block));
          return;
        }

        if (block.type === 'artifact') {
          transcript.appendChild(createArtifactMessage(block.message));
          return;
        }

        transcript.appendChild(createToolNote(block.message));
      });
    }

    view.appendChild(transcript);
    renderActivity(view, model.activity);
  }

  function renderComposer(view, threadContext) {
    var section = document.createElement('section');
    section.className = 'ai-composer-shell';

    var textarea = document.createElement('textarea');
    textarea.className = 'ai-composer-input';
    textarea.placeholder = 'Ask the hosted sandbox to do something...';
    textarea.disabled = !!threadContext.pending;
    section.appendChild(textarea);

    var footer = document.createElement('div');
    footer.className = 'ai-composer-footer';

    var hint = document.createElement('div');
    hint.className = 'ai-composer-hint';
    hint.textContent = 'Cmd/Ctrl+Enter to send';
    footer.appendChild(hint);

    var actions = document.createElement('div');
    actions.className = 'ai-actions-row';

    var refresh = document.createElement('button');
    refresh.className = 'ai-secondary-btn';
    refresh.type = 'button';
    refresh.textContent = 'Refresh';
    refresh.addEventListener('click', function () {
      window.__tribexAiState.refreshActiveThread();
    });
    actions.appendChild(refresh);

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
    actions.appendChild(primary);

    footer.appendChild(actions);
    section.appendChild(footer);

    textarea.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !primary.disabled) {
        primary.click();
      }
    });

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
    view.className = 'ai-view ai-thread-view';

    renderThreadHeader(view, threadContext);
    renderTranscript(view, threadContext);
    renderComposer(view, threadContext);

    container.innerHTML = '';
    container.appendChild(view);
  };
})();
