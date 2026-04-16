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

  function buildLegacyBlocks(messages) {
    return (messages || []).map(function (message) {
      if (!message) return null;
      return {
        type: isRenderableArtifact(message)
          ? 'artifact'
          : message.role === 'tool'
            ? 'tool'
            : 'chat',
        message: message,
      };
    }).filter(Boolean);
  }

  function createRunGroup(userMessage, index) {
    return {
      id: userMessage.id || ('run-group-' + index),
      user: userMessage,
      repeatCount: 1,
      latestCreatedAt: userMessage.createdAt || null,
      lifecycleMessages: [],
      toolNotes: [],
      artifacts: [],
      assistantMessages: [],
    };
  }

  function buildRunGroups(messages) {
    var groups = [];
    var current = null;
    var shouldFallbackToLegacy = false;

    (messages || []).forEach(function (message, index) {
      if (!message) return;

      if (message.role === 'user') {
        if (
          current &&
          current.user &&
          current.user.content === message.content &&
          !current.lifecycleMessages.length &&
          !current.toolNotes.length &&
          !current.artifacts.length &&
          !current.assistantMessages.length
        ) {
          current.repeatCount += 1;
          current.latestCreatedAt = message.createdAt || current.latestCreatedAt;
          return;
        }

        current = createRunGroup(message, index);
        groups.push(current);
        return;
      }

      if (!current) {
        shouldFallbackToLegacy = true;
        return;
      }

      if (message.role === 'tool' && isLifecycleToolName(message.toolName)) {
        current.lifecycleMessages.push(message);
        return;
      }

      if (isRenderableArtifact(message)) {
        current.artifacts.push(message);
        return;
      }

      if (message.role === 'tool') {
        current.toolNotes.push(message);
        return;
      }

      if (message.role === 'assistant') {
        current.assistantMessages.push(message);
        return;
      }
    });

    if (!groups.length || shouldFallbackToLegacy) {
      return {
        mode: 'legacy',
        blocks: buildLegacyBlocks(messages),
      };
    }

    return {
      mode: 'groups',
      groups: groups.map(function (group, index) {
        return enrichRunGroup(group, index);
      }),
    };
  }

  function deriveTaskStatus(message) {
    var toolName = String(message.toolName || '');
    var status = String(message.status || '').toLowerCase();

    if (toolName.indexOf('.failed') >= 0 || status === 'blocked' || status === 'error') {
      return 'failed';
    }
    if (toolName.indexOf('.started') >= 0) {
      return 'running';
    }
    if (toolName.indexOf('.completed') >= 0 || toolName.indexOf('.session.created') >= 0 || toolName.indexOf('.session_created') >= 0) {
      return 'completed';
    }
    return 'completed';
  }

  function buildRunTasks(messages, answerStreaming) {
    var tasks = [];

    (messages || []).forEach(function (message, index) {
      var toolName = String(message.toolName || '');
      var status = deriveTaskStatus(message);
      var lastTask = tasks.length ? tasks[tasks.length - 1] : null;

      if (toolName.indexOf('.completed') >= 0 && lastTask && lastTask.status === 'running') {
        lastTask.status = 'completed';
        if (message.detail) {
          lastTask.detail = lastTask.detail
            ? (lastTask.detail + '\n\n' + message.detail)
            : message.detail;
        }
        lastTask.createdAt = message.createdAt || lastTask.createdAt;
        return;
      }

      if (toolName.indexOf('.failed') >= 0 && lastTask && lastTask.status === 'running') {
        lastTask.status = 'failed';
        if (message.summary) {
          lastTask.title = message.summary;
        }
        if (message.detail) {
          lastTask.detail = lastTask.detail
            ? (lastTask.detail + '\n\n' + message.detail)
            : message.detail;
        }
        lastTask.createdAt = message.createdAt || lastTask.createdAt;
        return;
      }

      tasks.push({
        id: message.id || ((message.toolName || 'task') + '-' + index),
        title: message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'task'),
        detail: message.detail || '',
        status: status,
        open: false,
        createdAt: message.createdAt || null,
      });
    });

    return tasks.map(function (task, index) {
      var isLastTask = index === tasks.length - 1;
      return {
        id: task.id,
        title: task.title,
        detail: task.detail,
        status: task.status,
        open: task.status === 'running' || task.status === 'failed' || (answerStreaming && isLastTask),
        createdAt: task.createdAt,
      };
    });
  }

  function buildRunAnswer(messages) {
    var contentParts = [];
    var latestCreatedAt = null;
    var isStreaming = false;

    (messages || []).forEach(function (message) {
      if (!message) return;
      if (message.content) contentParts.push(message.content);
      latestCreatedAt = message.createdAt || latestCreatedAt;
      if (message.isStreaming) isStreaming = true;
    });

    return {
      content: contentParts.join('\n\n'),
      createdAt: latestCreatedAt,
      isStreaming: isStreaming,
    };
  }

  function toolNoteKey(message) {
    return JSON.stringify([
      message && message.toolName,
      message && message.summary,
      message && message.detail,
      message && message.status,
    ]);
  }

  function collapseToolNotes(messages) {
    var collapsed = [];

    (messages || []).forEach(function (message) {
      if (!message) return;

      var previous = collapsed.length ? collapsed[collapsed.length - 1] : null;
      if (previous && toolNoteKey(previous) === toolNoteKey(message)) {
        collapsed[collapsed.length - 1] = Object.assign({}, previous, message, {
          createdAt: message.createdAt || previous.createdAt,
        });
        return;
      }

      collapsed.push(message);
    });

    return collapsed;
  }

  function enrichRunGroup(group, index) {
    var answer = buildRunAnswer(group.assistantMessages);
    var tasks = buildRunTasks(group.lifecycleMessages, answer.isStreaming);
    var toolNotes = collapseToolNotes(group.toolNotes);
    return {
      id: group.id || ('run-group-' + index),
      index: index,
      user: group.user,
      repeatCount: group.repeatCount,
      latestCreatedAt: group.latestCreatedAt,
      tasks: tasks,
      toolNotes: toolNotes,
      artifacts: group.artifacts,
      answer: answer,
      isStreaming: answer.isStreaming,
      signature: JSON.stringify({
        repeatCount: group.repeatCount,
        prompt: group.user && group.user.content,
        tasks: tasks.map(function (task) {
          return [task.id, task.status, task.detail, task.open];
        }),
        toolNotes: toolNotes.map(function (note) {
          return [note.id, note.summary, note.detail, note.status];
        }),
        artifacts: group.artifacts.map(function (artifact) {
          return [
            artifact.id,
            artifact.resultData && artifact.resultData.title,
            artifact.resultData && artifact.resultData.body,
          ];
        }),
        answer: [answer.content, answer.isStreaming],
      }),
    };
  }

  function createChatMessage(message, repeatCount, latestCreatedAt) {
    var row = document.createElement('article');
    row.className = 'ai-chat-bubble ai-chat-bubble-' + message.role;

    var metaRow = document.createElement('div');
    metaRow.className = 'ai-chat-meta-row';

    var role = document.createElement('span');
    role.className = 'ai-chat-role';
    role.textContent = message.role === 'assistant' ? 'Assistant' : 'You';
    metaRow.appendChild(role);

    if (latestCreatedAt) {
      var time = document.createElement('span');
      time.className = 'ai-chat-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(latestCreatedAt);
      metaRow.appendChild(time);
    }

    row.appendChild(metaRow);

    row.appendChild(createTextBody(message.content || '', 'ai-chat-body'));
    return row;
  }

  function createToolNote(message) {
    if (!message.detail) {
      var simple = document.createElement('article');
      simple.className = 'ai-tool-note';

      var simpleHeader = document.createElement('div');
      simpleHeader.className = 'ai-tool-note-header';

      var simpleTitle = document.createElement('strong');
      simpleTitle.textContent = message.summary || window.__tribexAiUtils.titleCase(message.toolName || 'tool');
      simpleHeader.appendChild(simpleTitle);

      if (message.createdAt) {
        var simpleTime = document.createElement('span');
        simpleTime.className = 'ai-tool-note-time';
        simpleTime.textContent = window.__tribexAiUtils.formatRelativeTime(message.createdAt);
        simpleHeader.appendChild(simpleTime);
      }

      simple.appendChild(simpleHeader);
      return simple;
    }

    var row = document.createElement('details');
    row.className = 'ai-tool-note';

    var header = document.createElement('summary');
    header.className = 'ai-tool-note-header ai-tool-note-summary';

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
    row.appendChild(createTextBody(message.detail, 'ai-tool-note-body'));

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

  function getTimeValue(value) {
    if (!value) return 0;
    var ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }

  function formatElapsed(startedAt, endedAt) {
    var start = getTimeValue(startedAt);
    var end = getTimeValue(endedAt) || Date.now();
    var delta = Math.max(1000, end - start);
    var totalSeconds = Math.max(1, Math.round(delta / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;

    if (minutes <= 0) return totalSeconds + 's';
    if (seconds === 0) return minutes + 'm';
    return minutes + 'm ' + seconds + 's';
  }

  function createWorkStatusLabel(status) {
    if (status === 'failed') return 'Failed';
    if (status === 'needs-approval') return 'Needs Approval';
    if (status === 'running') return 'Running';
    return 'Done';
  }

  function openResultArtifact(threadId, artifactKey) {
    if (!threadId || !artifactKey) return;
    if (window.__tribexAiState && typeof window.__tribexAiState.selectThreadArtifact === 'function') {
      window.__tribexAiState.selectThreadArtifact(threadId, artifactKey);
      return;
    }
    var activeSession = window.__companionUtils && typeof window.__companionUtils.getActiveSession === 'function'
      ? window.__companionUtils.getActiveSession()
      : null;
    if (
      activeSession &&
      activeSession.sessionId &&
      window.__companionUtils &&
      typeof window.__companionUtils.selectThreadArtifact === 'function'
    ) {
      window.__companionUtils.selectThreadArtifact(activeSession.sessionId, threadId, artifactKey);
    }
  }

  function createWorkActivityItem(item, threadId) {
    var row = document.createElement('article');
    row.className = 'ai-work-item';

    var header = document.createElement('div');
    header.className = 'ai-work-item-header';

    var copy = document.createElement('div');
    copy.className = 'ai-work-item-copy';

    var kicker = document.createElement('span');
    kicker.className = 'ai-work-item-kicker';
    kicker.textContent = item.toolName ? window.__tribexAiUtils.titleCase(item.toolName) : 'Runtime activity';
    copy.appendChild(kicker);

    var title = document.createElement('strong');
    title.textContent = item.title || 'Runtime activity';
    copy.appendChild(title);
    header.appendChild(copy);

    var meta = document.createElement('div');
    meta.className = 'ai-work-item-meta';

    var status = document.createElement('span');
    status.className = 'ai-work-item-status ai-work-item-status-' + (item.status || 'completed');
    status.textContent = createWorkStatusLabel(item.status);
    meta.appendChild(status);

    if (item.updatedAt || item.createdAt) {
      var time = document.createElement('span');
      time.className = 'ai-work-item-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(item.updatedAt || item.createdAt);
      meta.appendChild(time);
    }

    header.appendChild(meta);
    row.appendChild(header);

    if (item.detail) {
      row.appendChild(createTextBody(item.detail, 'ai-work-item-detail'));
    }

    if (item.artifactKey) {
      var resultRow = document.createElement('div');
      resultRow.className = 'ai-work-item-actions';

      var openLink = document.createElement('button');
      openLink.type = 'button';
      openLink.className = 'ai-work-item-link';
      openLink.textContent = 'Open result';
      openLink.addEventListener('click', function () {
        openResultArtifact(threadId, item.artifactKey);
      });
      resultRow.appendChild(openLink);
      row.appendChild(resultRow);
    }

    return row;
  }

  function createWorkSessionElement(workSession, groupId, threadState) {
    var block = document.createElement('details');
    block.className = 'ai-work-session';
    block.setAttribute('data-work-session-id', workSession.id || groupId);
    block.open = !!threadState.workSessionOpen[groupId];
    block.addEventListener('toggle', function () {
      threadState.workSessionOpen[groupId] = block.open;
    });

    var summary = document.createElement('summary');
    summary.className = 'ai-work-session-summary';

    var label = document.createElement('span');
    label.className = 'ai-work-session-label';
    label.textContent = (workSession.status === 'running' ? 'Working for ' : 'Worked for ')
      + formatElapsed(workSession.startedAt, workSession.endedAt);
    summary.appendChild(label);
    block.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'ai-work-session-body';
    (workSession.items || []).forEach(function (item) {
      body.appendChild(createWorkActivityItem(item, threadState.threadId));
    });
    block.appendChild(body);

    return block;
  }

  function createLegacyRunTask(task, answerStreaming) {
    var item = document.createElement('details');
    item.className = 'ai-run-task ai-run-task-' + task.status;
    if (task.open || (!answerStreaming && task.status === 'failed')) {
      item.open = true;
    }

    var summary = document.createElement('summary');
    summary.className = 'ai-run-task-summary';

    var left = document.createElement('div');
    left.className = 'ai-run-task-copy';

    var status = document.createElement('span');
    status.className = 'ai-run-task-status ai-run-task-status-' + task.status;
    status.textContent = task.status === 'running'
      ? 'Running'
      : task.status === 'failed'
        ? 'Failed'
        : 'Done';
    left.appendChild(status);

    var title = document.createElement('strong');
    title.textContent = task.title;
    left.appendChild(title);
    summary.appendChild(left);

    if (task.createdAt) {
      var time = document.createElement('span');
      time.className = 'ai-run-task-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(task.createdAt);
      summary.appendChild(time);
    }

    item.appendChild(summary);

    if (task.detail) {
      item.appendChild(createTextBody(task.detail, 'ai-run-task-body'));
    }

    return item;
  }

  function createRunAnswer(answer) {
    var section = document.createElement('section');
    section.className = 'ai-run-answer' + (answer.isStreaming ? ' ai-run-answer-streaming' : '');

    var header = document.createElement('div');
    header.className = 'ai-run-answer-header';

    var role = document.createElement('span');
    role.className = 'ai-chat-role';
    role.textContent = answer.isStreaming ? 'Assistant streaming' : 'Assistant';
    header.appendChild(role);

    if (answer.createdAt) {
      var time = document.createElement('span');
      time.className = 'ai-chat-time';
      time.textContent = window.__tribexAiUtils.formatRelativeTime(answer.createdAt);
      header.appendChild(time);
    }

    section.appendChild(header);
    section.appendChild(createTextBody(answer.content || (answer.isStreaming ? 'Waiting for response…' : ''), 'ai-chat-body ai-run-answer-body'));
    return section;
  }

  function createRunGroupElement(group, threadState) {
    var section = document.createElement('section');
    section.className = 'ai-run-group';
    section.setAttribute('data-run-id', group.id);
    section.setAttribute('data-run-signature', group.signature);

    var prompt = document.createElement('div');
    prompt.className = 'ai-run-group-prompt';
    prompt.appendChild(createChatMessage(group.user, group.repeatCount, group.latestCreatedAt));
    section.appendChild(prompt);

    var surface = document.createElement('div');
    surface.className = 'ai-run-group-surface';

    if (group.workSession && group.workSession.items && group.workSession.items.length) {
      surface.appendChild(createWorkSessionElement(group.workSession, group.id, threadState));
    } else {
      if (group.tasks && group.tasks.length) {
        var tasks = document.createElement('div');
        tasks.className = 'ai-run-tasks';
        group.tasks.forEach(function (task) {
          tasks.appendChild(createLegacyRunTask(task, group.isStreaming));
        });
        surface.appendChild(tasks);
      }

      if (group.toolNotes && group.toolNotes.length) {
        var notes = document.createElement('div');
        notes.className = 'ai-run-notes';
        group.toolNotes.forEach(function (note) {
          notes.appendChild(createToolNote(note));
        });
        surface.appendChild(notes);
      }

      if (group.artifacts && group.artifacts.length) {
        var artifacts = document.createElement('div');
        artifacts.className = 'ai-run-artifacts';
        group.artifacts.forEach(function (artifact) {
          artifacts.appendChild(createArtifactMessage(artifact));
        });
        surface.appendChild(artifacts);
      }
    }

    if (group.answer.content || group.answer.isStreaming) {
      surface.appendChild(createRunAnswer(group.answer));
    }

    section.appendChild(surface);
    return section;
  }

  function createHeaderShell() {
    var header = document.createElement('section');
    header.className = 'ai-thread-header';

    var breadcrumb = document.createElement('p');
    breadcrumb.className = 'ai-thread-breadcrumb';
    header.appendChild(breadcrumb);

    var titleRow = document.createElement('div');
    titleRow.className = 'ai-thread-title-row';

    var copy = document.createElement('div');
    copy.className = 'ai-thread-header-copy';

    var title = document.createElement('h1');
    copy.appendChild(title);

    var lede = document.createElement('p');
    lede.className = 'ai-thread-lede';
    copy.appendChild(lede);
    titleRow.appendChild(copy);

    var pills = document.createElement('div');
    pills.className = 'ai-thread-pill-row';
    titleRow.appendChild(pills);
    header.appendChild(titleRow);

    return {
      root: header,
      breadcrumb: breadcrumb,
      title: title,
      lede: lede,
      pills: pills,
    };
  }

  function updateHeader(headerState, threadContext) {
    headerState.breadcrumb.textContent = [
      threadContext.workspace && threadContext.workspace.name,
      threadContext.project && threadContext.project.name,
    ].filter(Boolean).join(' / ') || ((threadContext.organization && threadContext.organization.name) || 'Hosted workspace');

    headerState.title.textContent = ((threadContext.thread && threadContext.thread.title) || 'Thread');
    headerState.lede.textContent = 'Hosted replies, streamed artifacts, and relay activity stay attached to this thread.';

    headerState.pills.innerHTML = '';
    if (threadContext.streamStatus) {
      var streamPill = document.createElement('span');
      streamPill.className = 'ai-pill ai-pill-neutral';
      streamPill.textContent = 'Stream ' + window.__tribexAiUtils.titleCase(threadContext.streamStatus);
      headerState.pills.appendChild(streamPill);
    }

    if (threadContext.relayStatus) {
      var relayPill = document.createElement('span');
      relayPill.className = 'ai-pill ai-pill-neutral';
      relayPill.textContent = 'Relay ' + window.__tribexAiUtils.titleCase(threadContext.relayStatus);
      headerState.pills.appendChild(relayPill);
    }

    if (threadContext.thread && threadContext.thread.lastActivityAt) {
      var timePill = document.createElement('span');
      timePill.className = 'ai-pill ai-pill-neutral';
      timePill.textContent = window.__tribexAiUtils.formatRelativeTime(threadContext.thread.lastActivityAt);
      headerState.pills.appendChild(timePill);
    }
  }

  function getScrollHost(container) {
    return container.closest('.session-scroll') || container;
  }

  function isNearBottom(scrollHost) {
    var remaining = (scrollHost.scrollHeight || 0) - ((scrollHost.scrollTop || 0) + (scrollHost.clientHeight || 0));
    return remaining < 72;
  }

  function scrollToBottom(scrollHost) {
    var max = Math.max(0, (scrollHost.scrollHeight || 0) - (scrollHost.clientHeight || 0));
    if (typeof scrollHost.scrollTo === 'function') {
      scrollHost.scrollTo({ top: max, behavior: 'auto' });
    }
    scrollHost.scrollTop = max;
  }

  function updateJumpButton(state, visible) {
    if (!state.jumpButton) return;
    state.jumpButton.hidden = !visible;
    state.jumpButton.classList.toggle('is-visible', !!visible);
  }

  function clearLiveTick(state) {
    if (!state || !state.liveTickId) return;
    window.clearTimeout(state.liveTickId);
    state.liveTickId = null;
  }

  function hasLiveRunState(threadContext) {
    if (!threadContext) return false;
    if (threadContext.pending || threadContext.loading) return true;
    var runs = threadContext.thread && Array.isArray(threadContext.thread.runs)
      ? threadContext.thread.runs
      : [];
    return runs.some(function (run) {
      return !!(
        run &&
        ((run.answer && run.answer.isStreaming) ||
        (run.workSession && run.workSession.status === 'running'))
      );
    });
  }

  function scheduleLiveTick(state) {
    if (!state || state.liveTickId || !state.threadId) return;
    state.liveTickId = window.setTimeout(function () {
      state.liveTickId = null;
      if (!window.__tribexAiState || typeof window.__tribexAiState.getThreadContext !== 'function' || !state.threadId) {
        return;
      }
      var nextContext = window.__tribexAiState.getThreadContext(state.threadId);
      if (!nextContext || !nextContext.thread) {
        return;
      }
      renderThread(state, nextContext);
    }, 1000);
  }

  function ensureShell(container) {
    var state = container.__tribexAiThreadState;
    if (state) return state;

    var scrollHost = getScrollHost(container);
    var view = document.createElement('div');
    view.className = 'ai-view ai-thread-view';

    var header = createHeaderShell();
    view.appendChild(header.root);

    var alerts = document.createElement('div');
    alerts.className = 'ai-thread-alerts';
    view.appendChild(alerts);

    var layout = document.createElement('div');
    layout.className = 'ai-thread-layout';
    view.appendChild(layout);

    var transcript = document.createElement('section');
    transcript.className = 'ai-chat-log ai-chat-log-standalone ai-run-log';
    layout.appendChild(transcript);

    var jumpButton = document.createElement('button');
    jumpButton.className = 'ai-jump-latest';
    jumpButton.type = 'button';
    jumpButton.textContent = 'Jump to latest';
    jumpButton.hidden = true;
    jumpButton.addEventListener('click', function () {
      updateJumpButton(state, false);
      scrollToBottom(scrollHost);
    });
    view.appendChild(jumpButton);

    var composer = document.createElement('section');
    composer.className = 'ai-composer-shell';

    var textarea = document.createElement('textarea');
    textarea.className = 'ai-composer-input';
    textarea.placeholder = 'Ask the hosted sandbox to do something...';
    composer.appendChild(textarea);

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
    primary.addEventListener('click', function () {
      if (!state.threadId) return;
      var prompt = textarea.value;
      window.__tribexAiState.submitPrompt(state.threadId, prompt).then(function (submitted) {
        if (submitted) textarea.value = '';
      });
    });
    actions.appendChild(primary);

    footer.appendChild(actions);
    composer.appendChild(footer);
    view.appendChild(composer);

    textarea.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !primary.disabled) {
        primary.click();
      }
    });

    scrollHost.addEventListener('scroll', function () {
      if (isNearBottom(scrollHost)) {
        updateJumpButton(state, false);
      }
    });

    container.innerHTML = '';
    container.appendChild(view);

    state = {
      container: container,
      scrollHost: scrollHost,
      view: view,
      header: header,
      alerts: alerts,
      layout: layout,
      transcript: transcript,
      jumpButton: jumpButton,
      composer: composer,
      textarea: textarea,
      primary: primary,
      lastModeSignature: null,
      threadId: null,
      workSessionOpen: {},
      liveTickId: null,
    };

    container.__tribexAiThreadState = state;
    return state;
  }

  function updateAlerts(state, threadContext) {
    state.alerts.innerHTML = '';

    if (threadContext.loading) {
      var loading = document.createElement('section');
      loading.className = 'ai-inline-alert ai-inline-alert-info';
      loading.innerHTML = '<div><strong>Hydrating thread</strong><p>Refreshing transcript and hosted activity for this thread.</p></div>';
      state.alerts.appendChild(loading);
    }

    if (threadContext.error) {
      var error = document.createElement('section');
      error.className = 'ai-inline-alert ai-inline-alert-warning';
      error.innerHTML = '<div><strong>Thread needs attention</strong><p>' + threadContext.error + '</p></div>';
      state.alerts.appendChild(error);
    }
  }

  function updateLegacyTranscript(state, model) {
    var signature = JSON.stringify(model.blocks.map(function (block) {
      return [block.type, block.message && block.message.id, block.message && block.message.content, block.message && block.message.toolName];
    }));
    if (state.lastModeSignature === 'legacy:' + signature) return false;

    if (state.lastModeSignature && state.lastModeSignature.indexOf('groups:') === 0) {
      state.transcript.innerHTML = '';
    }

    state.transcript.innerHTML = '';

    if (!model.blocks.length) {
      var empty = document.createElement('div');
      empty.className = 'ai-thread-empty';
      empty.innerHTML = '<strong>No messages yet</strong><p>Start the conversation and the hosted thread will appear here.</p>';
      state.transcript.appendChild(empty);
    } else {
      model.blocks.forEach(function (block) {
        if (block.type === 'chat') {
          state.transcript.appendChild(createChatMessage(block.message, 1, block.message.createdAt || null));
          return;
        }

        if (block.type === 'artifact') {
          state.transcript.appendChild(createArtifactMessage(block.message));
          return;
        }

        state.transcript.appendChild(createToolNote(block.message));
      });
    }

    state.lastModeSignature = 'legacy:' + signature;
    return true;
  }

  function syncRunGroups(state, groups) {
    var used = {};
    var changed = false;

    if (state.lastModeSignature && state.lastModeSignature.indexOf('legacy:') === 0) {
      state.transcript.innerHTML = '';
      changed = true;
    }

    if (!groups.length) {
      if (!state.transcript.querySelector('.ai-thread-empty')) {
        state.transcript.innerHTML = '';
        var empty = document.createElement('div');
        empty.className = 'ai-thread-empty';
        empty.innerHTML = '<strong>No messages yet</strong><p>Start the conversation and the hosted thread will appear here.</p>';
        state.transcript.appendChild(empty);
        changed = true;
      }
      return changed;
    }

    var emptyState = state.transcript.querySelector('.ai-thread-empty');
    if (emptyState) {
      emptyState.parentNode.removeChild(emptyState);
      changed = true;
    }

    groups.forEach(function (group, index) {
      var selector = '.ai-run-group[data-run-id="' + group.id.replace(/"/g, '\\"') + '"]';
      var existing = state.transcript.querySelector(selector);
      var node = existing;

      if (!existing) {
        node = createRunGroupElement(group, state);
        changed = true;
      } else if (existing.getAttribute('data-run-signature') !== group.signature) {
        node = createRunGroupElement(group, state);
        state.transcript.replaceChild(node, existing);
        changed = true;
      }

      used[group.id] = true;
      if (state.transcript.children[index] !== node) {
        state.transcript.insertBefore(node, state.transcript.children[index] || null);
        changed = true;
      }
    });

    Array.from(state.transcript.querySelectorAll('.ai-run-group')).forEach(function (node) {
      var id = node.getAttribute('data-run-id');
      if (!used[id]) {
        node.parentNode.removeChild(node);
        changed = true;
      }
    });

    var modeSignature = 'groups:' + JSON.stringify(groups.map(function (group) {
      return [group.id, group.signature];
    }));
    state.lastModeSignature = modeSignature;
    return changed;
  }

  function updateTranscript(state, threadContext) {
    var runtimeRuns = threadContext.thread && Array.isArray(threadContext.thread.runs)
      ? threadContext.thread.runs
      : null;
    var model = runtimeRuns
      ? {
        mode: 'groups',
        groups: runtimeRuns.map(function (group, index) {
          return Object.assign({}, group, {
            signature: JSON.stringify({
              id: group.id,
              turnId: group.turnId,
              prompt: group.user && group.user.content,
              answer: group.answer ? [group.answer.content, group.answer.isStreaming] : null,
              workSession: group.workSession
                ? {
                  status: group.workSession.status,
                  startedAt: group.workSession.startedAt,
                  endedAt: group.workSession.endedAt,
                  liveRenderBucket: group.workSession.status === 'running'
                    ? Math.floor(Date.now() / 1000)
                    : null,
                  items: (group.workSession.items || []).map(function (item) {
                    return [
                      item.id,
                      item.title,
                      item.status,
                      item.detail,
                      item.artifactKey,
                      item.updatedAt,
                    ];
                  }),
                }
                : null,
              index: index,
            }),
          });
        }),
      }
      : buildRunGroups(
        (threadContext.thread && (threadContext.thread.displayMessages || threadContext.thread.messages)) || [],
      );
    if (model.mode === 'legacy') {
      return updateLegacyTranscript(state, model);
    }
    return syncRunGroups(state, model.groups || []);
  }

  function updateComposer(state, threadContext, threadChanged) {
    var nextThreadId = threadContext.thread && threadContext.thread.id ? threadContext.thread.id : null;
    if (threadChanged) {
      state.textarea.value = '';
    }
    state.threadId = nextThreadId;
    state.textarea.disabled = !!threadContext.pending;
    state.primary.disabled = !!threadContext.pending;
    state.primary.textContent = threadContext.pending ? 'Sending…' : 'Send';
  }

  function renderThread(state, threadContext) {
    var nextThreadId = threadContext.thread && threadContext.thread.id ? threadContext.thread.id : null;
    var threadChanged = state.threadId !== nextThreadId;
    var wasNearBottom = threadChanged ? true : isNearBottom(state.scrollHost);
    var beforeHeight = state.scrollHost.scrollHeight || 0;

    state.threadId = nextThreadId;
    updateHeader(state.header, threadContext);
    updateAlerts(state, threadContext);
    var changed = updateTranscript(state, threadContext);
    updateComposer(state, threadContext, threadChanged);

    var afterHeight = state.scrollHost.scrollHeight || beforeHeight;
    var contentGrew = afterHeight > beforeHeight || threadContext.pending || threadContext.loading;

    if (threadChanged || wasNearBottom) {
      scrollToBottom(state.scrollHost);
      updateJumpButton(state, false);
    } else if (changed && (contentGrew || !wasNearBottom)) {
      updateJumpButton(state, true);
    }

    clearLiveTick(state);
    if (hasLiveRunState(threadContext)) {
      scheduleLiveTick(state);
    }
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

    var state = ensureShell(container);
    renderThread(state, threadContext);
  };
})();
