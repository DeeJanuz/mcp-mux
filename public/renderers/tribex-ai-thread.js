// @ts-check
/* Codex-like hosted workspace thread renderer */

(function () {
  'use strict';

  var containerState = new WeakMap();

  function cx() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
  }

  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function createButton(className, label, onClick, options) {
    var button = createEl('button', className, label);
    button.type = 'button';
    if (options && options.title) button.title = options.title;
    if (options && options.disabled) button.disabled = true;
    if (options && options.ariaLabel) button.setAttribute('aria-label', options.ariaLabel);
    if (typeof onClick === 'function') button.addEventListener('click', onClick);
    return button;
  }

  function renderMarkdown(content, className, options) {
    var body = createEl('div', className);
    if (
      window.__companionUtils &&
      typeof window.__companionUtils.renderMarkdown === 'function'
    ) {
      var rendered = window.__companionUtils.renderMarkdown(content || '');
      if (rendered) {
        if (options && options.suppressEntryAnimation && rendered.classList) {
          rendered.classList.add('md-content-no-entry-animation');
        }
        body.appendChild(rendered);
        if (typeof window.__companionUtils.renderMermaidBlocks === 'function') {
          window.__companionUtils.renderMermaidBlocks(rendered);
        }
        return body;
      }
    }
    body.textContent = content || '';
    return body;
  }

  function formatTime(value) {
    if (!value) return '';
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.formatRelativeTime === 'function') {
      return window.__tribexAiUtils.formatRelativeTime(value);
    }
    return String(value);
  }

  function titleCase(value) {
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.titleCase === 'function') {
      return window.__tribexAiUtils.titleCase(value);
    }
    return String(value || '').replace(/[._-]+/g, ' ').replace(/\b\w/g, function (match) {
      return match.toUpperCase();
    });
  }

  function displayText(value, fallback) {
    var text = String(value || '');
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.sanitizeDisplayText === 'function') {
      text = window.__tribexAiUtils.sanitizeDisplayText(text);
    }
    return text || fallback || '';
  }

  function displayThreadTitle(value, fallback) {
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.formatThreadTitleForDisplay === 'function') {
      return window.__tribexAiUtils.formatThreadTitleForDisplay(value, fallback);
    }
    return displayText(value, fallback || 'Thread');
  }

  function displayActivityTitle(item) {
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.formatActivityTitleForDisplay === 'function') {
      return window.__tribexAiUtils.formatActivityTitleForDisplay(item);
    }
    return displayText(item && (item.title || item.summary), titleCase(item && item.kind || 'Work activity'));
  }

  function isSyntheticReviewResumeMessage(message) {
    if (!message) return false;
    if (window.__tribexAiUtils && typeof window.__tribexAiUtils.isSyntheticReviewResumeContent === 'function') {
      return window.__tribexAiUtils.isSyntheticReviewResumeContent(message.content);
    }
    return /^The user submitted a review decision for session\b/i.test(String(message.content || '').trim());
  }

  function getActiveThreadId(data, _meta, toolArgs) {
    if (toolArgs && (toolArgs.threadId || toolArgs.thread_id)) return toolArgs.threadId || toolArgs.thread_id;
    if (data && (data.threadId || data.thread_id)) return data.threadId || data.thread_id;
    if (
      window.__companionUtils &&
      typeof window.__companionUtils.getActiveSession === 'function'
    ) {
      var active = window.__companionUtils.getActiveSession();
      var session = active && active.session ? active.session : null;
      var meta = session && session.meta ? session.meta : {};
      return meta.threadId || meta.thread_id || null;
    }
    return null;
  }

  function getState(container, threadId) {
    var existing = containerState.get(container);
    if (existing) {
      if (threadId && threadId !== existing.threadId) {
        existing.expandedGroups = {};
        existing.reviewCards = {};
        existing.reviewCardCollapsed = {};
        existing.timelineScrollTop = null;
        existing.timelineWasNearBottom = false;
        existing.lastBlockerSignature = null;
        existing.lastRenderSignature = null;
      }
      existing.threadId = threadId || existing.threadId;
      return existing;
    }
    var state = {
      threadId: threadId,
      expandedGroups: {},
      drawerOpen: false,
      selectedArtifactKey: null,
      diagnosticsOpen: false,
      draftText: '',
      selectedSkill: null,
      skillValues: {},
      skillInsertIndex: 0,
      skillPickerOpen: false,
      slashQuery: null,
      variablePopover: null,
      focusEditorAfterRender: null,
      skills: [],
      skillsLoading: false,
      skillsLoadedForThreadId: null,
      emailAccounts: [],
      emailAccountsLoading: false,
      emailAccountsLoadedForThreadId: null,
      reviewCards: {},
      reviewCardCollapsed: {},
      timelineScrollTop: null,
      timelineWasNearBottom: false,
      lastBlockerSignature: null,
      renderScheduled: false,
      lastRenderSignature: null,
      unsubscribe: null,
      textarea: null,
      render: null,
    };
    containerState.set(container, state);
    return state;
  }

  function subscribe(container, state) {
    if (state.unsubscribe || !window.__tribexAiState || typeof window.__tribexAiState.subscribe !== 'function') {
      return;
    }
    state.unsubscribe = window.__tribexAiState.subscribe(function () {
      if (typeof state.render === 'function') state.render();
    });
    if (container.dataset) container.dataset.tribexAiSubscribed = 'true';
  }

  function getThreadContext(threadId) {
    if (!threadId || !window.__tribexAiState || typeof window.__tribexAiState.getThreadContext !== 'function') {
      return { thread: null, loading: false, pending: false, error: 'Thread state is unavailable.' };
    }
    return window.__tribexAiState.getThreadContext(threadId) || { thread: null };
  }

  function getViewModel(threadContext) {
    if (!window.__tribexAiChatReducer || typeof window.__tribexAiChatReducer.deriveThreadViewModel !== 'function') {
      throw new Error('tribex-ai-chat-reducer.js must load before tribex-ai-thread.js');
    }
    return window.__tribexAiChatReducer.deriveThreadViewModel(threadContext);
  }

  function stableStringify(value) {
    return JSON.stringify(value, function (_key, nested) {
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested;
      return Object.keys(nested).sort().reduce(function (sorted, key) {
        sorted[key] = nested[key];
        return sorted;
      }, {});
    });
  }

  function messageSignature(message) {
    if (!message) return null;
    return {
      id: message.id || null,
      role: message.role || null,
      content: message.content || '',
      createdAt: message.createdAt || null,
      isStreaming: !!message.isStreaming,
      pending: !!message.pending,
      skillInvocation: message.raw && message.raw.metadata ? message.raw.metadata.skillInvocation || null : null,
    };
  }

  function activityGroupSignature(group) {
    return {
      id: group.id || null,
      kind: group.kind || null,
      items: (group.items || []).map(function (item) {
        return {
          id: item.id || null,
          kind: item.kind || null,
          status: item.status || null,
          title: item.title || null,
          detail: item.detail || null,
          artifactKey: item.artifactKey || null,
          childThreadId: item.childThreadId || null,
        };
      }),
    };
  }

  function reviewInputSignature(input) {
    if (!input) return null;
    return stableStringify({
      id: input.id || null,
      status: input.status || null,
      renderer: input.renderer || null,
      title: input.title || null,
      detail: input.detail || input.description || null,
      reviewSessionId: input.reviewSessionId || input.sessionId || null,
      rendererPayload: input.rendererPayload || null,
      data: input.data || null,
    });
  }

  function viewSignature(threadContext, viewModel) {
    var thread = threadContext.thread || {};
    return stableStringify({
      thread: {
        id: thread.id || null,
        title: thread.title || null,
        lastActivityAt: viewModel.busy || viewModel.lifecycle === 'waiting_on_review' || viewModel.lifecycle === 'waiting_on_user'
          ? null
          : thread.lastActivityAt || null,
      },
      scope: {
        organization: threadContext.organization && threadContext.organization.name || null,
        workspace: threadContext.workspace && threadContext.workspace.name || null,
        project: threadContext.project && threadContext.project.name || null,
      },
      error: threadContext.error || null,
      lifecycle: viewModel.lifecycle,
      statusLabel: viewModel.statusLabel,
      statusDetail: viewModel.statusDetail,
      activeOperationId: viewModel.activeOperationId,
      sessions: (viewModel.sessions || []).map(function (session) {
        return {
          id: session.id || null,
          lifecycle: session.lifecycle || null,
          user: messageSignature(session.user),
          answer: messageSignature(session.answer),
          activityGroups: (session.activityGroups || []).map(activityGroupSignature),
        };
      }),
      artifacts: (viewModel.artifacts || []).map(function (artifact) {
        return {
          artifactKey: artifact.artifactKey || null,
          title: artifact.title || null,
          detail: artifact.detail || null,
          contentType: artifact.contentType || null,
          reviewRequired: !!artifact.reviewRequired,
        };
      }),
      pendingHumanInputs: (viewModel.pendingHumanInputs || []).map(reviewInputSignature),
      activePause: viewModel.activePause ? {
        id: viewModel.activePause.id || null,
        status: viewModel.activePause.status || null,
        title: viewModel.activePause.title || null,
        detail: viewModel.activePause.detail || viewModel.activePause.progressSummary || null,
        tasks: (viewModel.activePause.tasks || []).map(function (task) {
          return {
            id: task.id || null,
            title: task.title || null,
            detail: task.detail || null,
            status: task.status || null,
          };
        }),
      } : null,
    });
  }

  function scheduleRender(container, state, options) {
    options = options || {};
    if (options.force) {
      renderThread(container, state, options);
      return;
    }
    if (state.renderScheduled) return;
    state.renderScheduled = true;
    var run = function () {
      state.renderScheduled = false;
      renderThread(container, state, options);
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else window.setTimeout(run, 0);
  }

  function getTimelineScrollSnapshot(timeline) {
    if (!timeline) return { scrollTop: null, wasNearBottom: false };
    var remaining = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    return {
      scrollTop: timeline.scrollTop,
      wasNearBottom: remaining <= 48,
    };
  }

  function rememberTimelineScroll(state, timeline) {
    var snapshot = getTimelineScrollSnapshot(timeline);
    state.timelineScrollTop = snapshot.scrollTop;
    state.timelineWasNearBottom = snapshot.wasNearBottom;
    if (
      state.threadId &&
      window.__tribexAiState &&
      typeof window.__tribexAiState.rememberThreadScroll === 'function'
    ) {
      window.__tribexAiState.rememberThreadScroll(state.threadId, snapshot);
    }
  }

  function attachTimelineBehavior(timeline, state) {
    timeline.tabIndex = 0;
    timeline.setAttribute('role', 'region');
    timeline.setAttribute('aria-label', 'AI thread timeline');
    timeline.addEventListener('scroll', function () {
      rememberTimelineScroll(state, timeline);
    });
  }

  function getBlockerSignature(viewModel) {
    var inputs = (viewModel.pendingHumanInputs || []).map(function (input) {
      return input && input.id ? input.id : reviewInputSignature(input);
    });
    var pause = viewModel.activePause ? [viewModel.activePause.id || '', viewModel.activePause.status || ''].join(':') : '';
    return inputs.concat(pause ? ['pause:' + pause] : []).join('|');
  }

  function restoreTimelineScroll(timeline, state, viewModel, previousSnapshot) {
    var blockerSignature = getBlockerSignature(viewModel);
    var hasBlockers = !!blockerSignature;
    var shouldRevealBlocker = hasBlockers && state.lastBlockerSignature !== blockerSignature;
    state.lastBlockerSignature = blockerSignature || null;

    var run = function () {
      if (!timeline || !timeline.isConnected) return;
      if (shouldRevealBlocker) {
        var blockers = timeline.querySelector('.ai-codex-blockers');
        if (blockers) {
          timeline.scrollTop = Math.max(0, blockers.offsetTop - 12);
          rememberTimelineScroll(state, timeline);
          return;
        }
      }
      if (previousSnapshot && previousSnapshot.wasNearBottom) {
        timeline.scrollTop = timeline.scrollHeight;
        rememberTimelineScroll(state, timeline);
        return;
      }
      if (previousSnapshot && typeof previousSnapshot.scrollTop === 'number') {
        var maxScroll = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
        timeline.scrollTop = Math.min(previousSnapshot.scrollTop, maxScroll);
        rememberTimelineScroll(state, timeline);
        return;
      }
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else window.setTimeout(run, 0);
  }

  function appendStatusPill(parent, lifecycle, label) {
    var pill = createEl('span', cx('ai-codex-status', 'ai-codex-status-' + lifecycle));
    pill.appendChild(createEl('span', 'ai-codex-status-dot'));
    pill.appendChild(createEl('span', '', label || titleCase(lifecycle)));
    parent.appendChild(pill);
    return pill;
  }

  function shouldShowDiagnostics(viewModel) {
    return !!(
      window.__MCPVIEWS_DEV__ ||
      viewModel.lifecycle === 'recovering' ||
      viewModel.lifecycle === 'failed'
    );
  }

  function renderHeader(root, state, threadContext, viewModel) {
    var thread = threadContext.thread || {};
    var header = createEl('header', 'ai-codex-header');
    var titleBlock = createEl('div', 'ai-codex-title-block');
    var eyebrow = [
      threadContext.organization && threadContext.organization.name,
      threadContext.workspace && threadContext.workspace.name,
      threadContext.project && threadContext.project.name,
    ].filter(Boolean).join(' / ');
    titleBlock.appendChild(createEl('div', 'ai-codex-eyebrow', eyebrow || 'AI Workspace'));
    titleBlock.appendChild(createEl('h1', 'ai-codex-title', displayThreadTitle(thread.title, 'New chat')));
    var meta = createEl('div', 'ai-codex-meta');
    appendStatusPill(meta, viewModel.lifecycle, viewModel.statusLabel);
    if (thread.lastActivityAt) {
      meta.appendChild(createEl('span', 'ai-codex-meta-chip', formatTime(thread.lastActivityAt)));
    }
    titleBlock.appendChild(meta);
    header.appendChild(titleBlock);

    var actions = createEl('div', 'ai-codex-header-actions');
    actions.appendChild(createButton('ai-secondary-btn ai-codex-small-btn', 'Refresh', function () {
      refreshThreadFromViewState(state);
    }));
    if (shouldShowDiagnostics(viewModel)) {
      actions.appendChild(createButton('ai-secondary-btn ai-codex-small-btn', state.diagnosticsOpen ? 'Hide diagnostics' : 'Diagnostics', function () {
        state.diagnosticsOpen = !state.diagnosticsOpen;
        state.render({ force: true });
      }));
    }
    header.appendChild(actions);
    root.appendChild(header);
  }

  function refreshThreadFromViewState(state) {
    if (!window.__tribexAiState) return null;
    if (state && state.threadId && typeof window.__tribexAiState.refreshThread === 'function') {
      return window.__tribexAiState.refreshThread(state.threadId, true);
    }
    if (typeof window.__tribexAiState.refreshActiveThread === 'function') {
      return window.__tribexAiState.refreshActiveThread();
    }
    return null;
  }

  function renderRecovery(root, state, threadContext, viewModel) {
    if (
      viewModel.lifecycle !== 'recovering' &&
      !(viewModel.heartbeat && viewModel.heartbeat.stale) &&
      !threadContext.error
    ) {
      return;
    }
    var banner = createEl('section', 'ai-codex-recovery');
    var copy = createEl('div', 'ai-codex-recovery-copy');
    copy.appendChild(createEl('strong', '', threadContext.error ? 'This run needs attention' : viewModel.statusLabel));
    copy.appendChild(createEl('p', '', threadContext.error || viewModel.statusDetail || 'The frontend is checking the runtime and control plane for the latest state.'));
    banner.appendChild(copy);
    var actions = createEl('div', 'ai-codex-recovery-actions');
    actions.appendChild(createButton('ai-secondary-btn', 'Refresh thread', function () {
      refreshThreadFromViewState(state);
    }));
    if (viewModel.activePause && viewModel.activePause.id) {
      actions.appendChild(createButton('ai-secondary-btn', 'Check blocker', function () {
        if (window.__tribexAiState && typeof window.__tribexAiState.checkThreadPause === 'function') {
          window.__tribexAiState.checkThreadPause(state.threadId, viewModel.activePause.id);
        }
      }));
    }
    banner.appendChild(actions);
    root.appendChild(banner);
  }

  function renderUserPrompt(session) {
    var user = session.user;
    var prompt = createEl('article', 'ai-codex-message ai-codex-message-user');
    var header = createEl('div', 'ai-codex-message-header');
    header.appendChild(createEl('span', 'ai-codex-role', 'You'));
    if (user && user.createdAt) header.appendChild(createEl('span', 'ai-codex-time', formatTime(user.createdAt)));
    prompt.appendChild(header);
    prompt.appendChild(renderUserPromptCopy(user));
    return prompt;
  }

  function getMessageSkillInvocation(message) {
    var raw = message && message.raw ? message.raw : {};
    var metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
    return metadata.skillInvocation && metadata.skillInvocation.key ? metadata.skillInvocation : null;
  }

  function appendText(parent, text) {
    if (text) parent.appendChild(document.createTextNode(text));
  }

  function displayPromptFromSkillInvocation(content, invocation) {
    if (!invocation || !invocation.key || !invocation.display || typeof invocation.display !== 'object') return content;
    return joinPromptParts(
      invocation.display.textBefore || '',
      '/' + invocation.key,
      invocation.display.textAfter || ''
    ) || content;
  }

  function findSkillToken(content, invocation) {
    if (invocation && invocation.key) {
      var token = '/' + invocation.key;
      var index = content.indexOf(token);
      if (index >= 0) return { token: token, index: index, name: invocation.name || token };
    }
    var match = String(content || '').match(/(^|\s)(\/[A-Za-z0-9][A-Za-z0-9_-]{1,80})(?=$|\s|[.,!?;:])/);
    if (!match) return null;
    return {
      token: match[2],
      index: match.index + match[1].length,
      name: match[2],
    };
  }

  function renderUserPromptCopy(user) {
    var invocation = getMessageSkillInvocation(user);
    var content = displayPromptFromSkillInvocation(displayText(user && user.content), invocation);
    var skillToken = findSkillToken(content, invocation);
    if (!skillToken) return createEl('div', 'ai-codex-user-copy', content);
    var body = createEl('div', 'ai-codex-user-copy ai-codex-user-copy-skill');
    var token = skillToken.token;
    var index = skillToken.index;
    var before = content.slice(0, index);
    var after = content.slice(index + token.length);
    appendText(body, before);
    var chip = createEl('span', 'ai-codex-message-skill-chip', token);
    chip.title = skillToken.name || token;
    body.appendChild(chip);
    appendText(body, after);
    return body;
  }

  function renderAnswer(session, state) {
    if (!session.answer || !session.answer.content) return null;
    var answer = createEl('article', 'ai-codex-message ai-codex-message-assistant');
    var header = createEl('div', 'ai-codex-message-header');
    header.appendChild(createEl('span', 'ai-codex-role', 'Assistant'));
    if (session.answer.createdAt) header.appendChild(createEl('span', 'ai-codex-time', formatTime(session.answer.createdAt)));
    if (session.answer.isStreaming) header.appendChild(createEl('span', 'ai-codex-live-chip', 'streaming'));
    answer.appendChild(header);
    answer.appendChild(renderMarkdown(displayText(session.answer.content), 'ai-codex-answer-copy', {
      suppressEntryAnimation: !!session.answer.isStreaming || !!(state && state.hasRenderedThreadContent),
    }));
    return answer;
  }

  function renderActivityItem(item, state) {
    var row = createEl('div', cx('ai-codex-activity-item', 'ai-codex-activity-' + item.kind, 'ai-codex-activity-status-' + item.status));
    var marker = createEl('span', 'ai-codex-activity-marker');
    row.appendChild(marker);
    var copy = createEl('div', 'ai-codex-activity-copy');
    var title = createEl('div', 'ai-codex-activity-title');
    title.appendChild(createEl('strong', '', displayActivityTitle(item)));
    title.appendChild(createEl('span', 'ai-codex-activity-status', titleCase(item.status)));
    copy.appendChild(title);
    if (item.detail) copy.appendChild(createEl('p', 'ai-codex-activity-detail', displayText(item.detail)));
    if (item.childThreadId) {
      copy.appendChild(createEl('div', 'ai-codex-activity-detail', 'Delegated thread'));
    }
    row.appendChild(copy);
    if (item.artifactKey) {
      row.appendChild(createButton('ai-secondary-btn ai-codex-small-btn', 'Open', function () {
        state.drawerOpen = true;
        state.selectedArtifactKey = item.artifactKey;
        if (typeof state.render === 'function') state.render({ force: true });
      }));
    }
    return row;
  }

  function renderActivityGroups(session, state) {
    var groups = session.activityGroups || [];
    if (!groups.length) return null;
    var wrap = createEl('div', 'ai-codex-activity-groups');
    groups.forEach(function (group) {
      var key = session.id + ':' + group.id;
      var details = createEl('details', cx('ai-codex-activity-group', 'ai-codex-activity-group-' + group.kind));
      details.open = state.expandedGroups[key] !== false && (group.kind === 'review' || group.kind === 'subagent');
      details.addEventListener('toggle', function () {
        state.expandedGroups[key] = details.open;
      });
      var summary = createEl('summary', 'ai-codex-activity-summary');
      summary.appendChild(createEl('span', '', group.title));
      summary.appendChild(createEl('span', 'ai-codex-count', String(group.items.length)));
      details.appendChild(summary);
      var list = createEl('div', 'ai-codex-activity-list');
      group.items.forEach(function (item) {
        list.appendChild(renderActivityItem(item, state));
      });
      details.appendChild(list);
      wrap.appendChild(details);
    });
    return wrap;
  }

  function renderSession(session, index, state, viewModel) {
    var card = createEl('section', cx('ai-codex-session', 'ai-codex-session-' + session.lifecycle));
    card.setAttribute('data-session-id', session.id || String(index));
    var rail = createEl('div', 'ai-codex-session-rail');
    rail.appendChild(createEl('span', 'ai-codex-session-dot'));
    card.appendChild(rail);
    var body = createEl('div', 'ai-codex-session-body');
    var head = createEl('div', 'ai-codex-session-head');
    head.appendChild(createEl('span', 'ai-codex-session-index', 'Session ' + (index + 1)));
    appendStatusPill(head, session.lifecycle || viewModel.lifecycle, titleCase(session.lifecycle || viewModel.lifecycle));
    body.appendChild(head);
    if (session.user && session.user.content && !isSyntheticReviewResumeMessage(session.user)) {
      body.appendChild(renderUserPrompt(session));
    }
    var activity = renderActivityGroups(session, state);
    if (activity) body.appendChild(activity);
    var answer = renderAnswer(session, state);
    if (answer) body.appendChild(answer);
    else if (session.lifecycle !== 'complete') {
      var pending = createEl('div', 'ai-codex-pending-answer');
      pending.appendChild(createEl('span', 'ai-codex-pulse'));
      pending.appendChild(createEl('span', '', session.lifecycle === 'queued' ? 'Queued as context' : viewModel.statusLabel || 'Working'));
      body.appendChild(pending);
    }
    card.appendChild(body);
    return card;
  }

  function sanitizeReviewPayload(input) {
    var payload = input && input.rendererPayload ? input.rendererPayload : {};
    var data = payload.data || input.data || {};
    var meta = Object.assign({}, payload.meta || {}, {
      cloudManaged: true,
      humanInputId: input.id,
      reviewSessionId: input.reviewSessionId || input.sessionId || input.id,
    });
    var toolArgs = Object.assign({}, payload.toolArgs || payload.tool_args || {});
    if (toolArgs.meta && toolArgs.meta.backendCallback) {
      toolArgs.meta = Object.assign({}, toolArgs.meta, {
        backendCallback: Object.assign({}, toolArgs.meta.backendCallback, { token: '[redacted]' }),
      });
    }
    return {
      renderer: input.renderer || payload.tool_name || payload.toolName || payload.contentType || 'rich_content',
      data: data,
      meta: meta,
      toolArgs: toolArgs,
    };
  }

  function submitReviewDecision(threadId, input, decision, card, options) {
    if (!threadId || !input || !input.id || !window.__tribexAiClient || typeof window.__tribexAiClient.submitThreadHumanInputDecision !== 'function') {
      return Promise.reject(new Error('Review submission is unavailable.'));
    }
    options = options || {};
    card.classList.add('is-submitting');
    var status = card.querySelector('.ai-codex-review-status');
    if (status) status.textContent = 'Submitting review decision...';
    var decisionPayload = decision && typeof decision === 'object' ? Object.assign({}, decision) : {};
    if (typeof decision === 'string') decisionPayload.decision = decision;
    if (!decisionPayload.operationDecisions && decisionPayload.decisions) {
      decisionPayload.operationDecisions = decisionPayload.decisions;
    }
    if (!decisionPayload.suggestionDecisions && decisionPayload.suggestion_decisions) {
      decisionPayload.suggestionDecisions = decisionPayload.suggestion_decisions;
    }
    if (!decisionPayload.tableDecisions && decisionPayload.table_decisions) {
      decisionPayload.tableDecisions = decisionPayload.table_decisions;
    }
    var payload = Object.assign({}, decisionPayload, {
      sessionId: input.reviewSessionId || input.sessionId || input.id,
      decision: decisionPayload.decision || 'partial',
    });
    return window.__tribexAiClient.submitThreadHumanInputDecision(threadId, input.id, payload)
      .then(function () {
        card.classList.remove('is-submitting');
        card.classList.add('is-submitted');
        if (status) status.textContent = options.skipRefresh ? 'Review submitted.' : 'Review submitted. Refreshing thread...';
        if (options.skipRefresh) return true;
        return refreshThreadFromViewState({ threadId: threadId });
      })
      .catch(function (error) {
        card.classList.remove('is-submitting');
        card.classList.add('is-error');
        if (status) status.textContent = error && error.message ? error.message : 'Review submission failed.';
        throw error;
      });
  }

  function rendererResultProvidesDecisionSubmit(result) {
    return !!(
      result &&
      typeof result === 'object' &&
      (
        result.providesDecisionSubmit === true ||
        result.providesReviewDecisionSubmit === true
      )
    );
  }

  function rendererResultSubmitDecision(result) {
    return result && typeof result.submitDecision === 'function'
      ? result.submitDecision
      : null;
  }

  function rendererResultApplyDecision(result) {
    return result && typeof result.applyDecision === 'function'
      ? result.applyDecision
      : null;
  }

  function rendererResultGetDecisionSummary(result) {
    return result && typeof result.getDecisionSummary === 'function'
      ? result.getDecisionSummary
      : null;
  }

  function previewHasDecisionSubmit(preview, result) {
    return rendererResultProvidesDecisionSubmit(result) || !!(
      preview &&
      preview.querySelector &&
      preview.querySelector('[data-review-decision-submit="true"]')
    );
  }

  function renderReviewCard(state, input, options) {
    options = options || {};
    var bundled = !!options.bundled;
    var reviewKey = input && input.id ? input.id : 'review';
    var signature = reviewInputSignature(input) + (bundled ? ':bundled' : ':single');
    var cached = state.reviewCards && state.reviewCards[reviewKey];
    var inputStatus = String(input && input.status || 'PENDING').toUpperCase();
    if (cached && cached.card && cached.bundled === bundled && (cached.signature === signature || inputStatus === 'PENDING')) {
      cached.signature = signature;
      return cached.card;
    }
    var card = createEl('section', 'ai-codex-blocker ai-codex-review-card');
    card.setAttribute('data-review-id', reviewKey);
    card.setAttribute('data-review-collapsed', state.reviewCardCollapsed && state.reviewCardCollapsed[reviewKey] ? 'true' : 'false');
    var header = createEl('div', 'ai-codex-blocker-header');
    header.appendChild(createEl('strong', '', displayText(input.title, 'Review required')));
    var headerMeta = createEl('div', 'ai-codex-review-header-meta');
    var decisionBadge = createEl('span', 'ai-codex-blocker-badge ai-codex-review-decision-badge', 'Review pending');
    decisionBadge.setAttribute('data-decision-complete', 'false');
    headerMeta.appendChild(decisionBadge);
    headerMeta.appendChild(createEl('span', 'ai-codex-blocker-badge', 'Waiting on review'));
    var body = createEl('div', 'ai-codex-review-card-body');
    var toggleButton = createButton('ai-secondary-btn ai-codex-review-toggle', 'Hide', function () {
      setCardCollapsed(card.getAttribute('data-review-collapsed') !== 'true');
    }, { ariaLabel: 'Collapse review' });
    toggleButton.setAttribute('aria-expanded', 'true');
    headerMeta.appendChild(toggleButton);
    header.appendChild(headerMeta);
    card.appendChild(header);

    function setCardCollapsed(collapsed) {
      if (!state.reviewCardCollapsed) state.reviewCardCollapsed = {};
      state.reviewCardCollapsed[reviewKey] = !!collapsed;
      card.classList.toggle('is-collapsed', !!collapsed);
      card.setAttribute('data-review-collapsed', collapsed ? 'true' : 'false');
      body.hidden = !!collapsed;
      toggleButton.textContent = collapsed ? 'Show' : 'Hide';
      toggleButton.title = collapsed ? 'Show review' : 'Hide review';
      toggleButton.setAttribute('aria-label', collapsed ? 'Expand review' : 'Collapse review');
      toggleButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    function updateDecisionBadge(summary) {
      summary = summary && typeof summary === 'object' ? summary : {};
      var totalRows = Number(summary.totalRows || 0);
      var decidedRows = Number(summary.decidedRows || 0);
      var complete = totalRows > 0 && summary.complete === true;
      decisionBadge.classList.toggle('is-complete', complete);
      decisionBadge.setAttribute('data-decision-complete', complete ? 'true' : 'false');
      decisionBadge.setAttribute('data-decided-rows', String(decidedRows));
      decisionBadge.setAttribute('data-total-rows', String(totalRows));
      decisionBadge.textContent = totalRows > 0
        ? complete
          ? 'All rows decided'
          : String(decidedRows) + '/' + String(totalRows) + ' decided'
        : 'Review pending';
    }

    if (input.detail || input.description) {
      body.appendChild(createEl('p', 'ai-codex-blocker-detail', displayText(input.detail || input.description)));
    }
    var normalized = sanitizeReviewPayload(input);
    if (bundled) {
      normalized.meta = Object.assign({}, normalized.meta || {}, {
        bundleDecisionSubmit: true,
        externalDecisionSubmit: true,
      });
      normalized.toolArgs = Object.assign({}, normalized.toolArgs || {}, {
        bundleDecisionSubmit: true,
        externalDecisionSubmit: true,
      });
    }
    normalized.meta = Object.assign({}, normalized.meta || {}, {
      onDecisionStateChange: updateDecisionBadge,
    });
    var renderer = window.__renderers && window.__renderers[normalized.renderer];
    var previewProvidesDecisionSubmit = false;
    var previewSubmitDecision = null;
    var previewApplyDecision = null;
    var previewGetDecisionSummary = null;
    var submissionOptions = null;
    function submitDecisionFromRenderer(decision) {
      return submitReviewDecision(state.threadId, input, decision, card, submissionOptions || {});
    }
    function refreshDecisionSummary() {
      if (typeof previewGetDecisionSummary === 'function') {
        updateDecisionBadge(previewGetDecisionSummary());
      }
    }
    if (typeof renderer === 'function') {
      var preview = createEl('div', 'ai-codex-review-preview ai-codex-review-preview-full');
      preview.tabIndex = 0;
      preview.setAttribute('role', 'region');
      preview.setAttribute('aria-label', displayText(input.title, 'Review required') + ' preview');
      try {
        var renderResult = renderer(preview, normalized.data, normalized.meta, normalized.toolArgs, true, function (decision) {
          return submitDecisionFromRenderer(decision);
        });
        previewProvidesDecisionSubmit = previewHasDecisionSubmit(preview, renderResult);
        previewSubmitDecision = rendererResultSubmitDecision(renderResult);
        previewApplyDecision = rendererResultApplyDecision(renderResult);
        previewGetDecisionSummary = rendererResultGetDecisionSummary(renderResult);
        refreshDecisionSummary();
        if (previewSubmitDecision && !bundled) {
          headerMeta.appendChild(createButton('ai-primary-btn ai-codex-small-btn', 'Submit decisions', function () {
            previewSubmitDecision().catch(function () {});
          }));
        }
      } catch (error) {
          preview.textContent = error && error.message ? error.message : 'Review preview failed.';
      }
      body.appendChild(preview);
    }
    var statusEl = createEl('div', 'ai-codex-review-status', '');
    body.appendChild(statusEl);
    var actions = createEl('div', 'ai-codex-blocker-actions');
    if (!bundled && !previewSubmitDecision && !previewProvidesDecisionSubmit) {
      actions.appendChild(createButton('ai-primary-btn', 'Submit reviewed decision', function () {
        submitReviewDecision(state.threadId, input, { decision: 'approved' }, card).catch(function () {});
      }));
    }
    actions.appendChild(createButton('ai-secondary-btn', 'Refresh', function () {
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
    }));
    body.appendChild(actions);
    card.appendChild(body);
    setCardCollapsed(state.reviewCardCollapsed && state.reviewCardCollapsed[reviewKey] === true);
    function submitDecision(options) {
      submissionOptions = options || null;
      var result = null;
      try {
        result = previewSubmitDecision
          ? previewSubmitDecision()
          : submitReviewDecision(state.threadId, input, { decision: 'partial' }, card, submissionOptions || {});
      } catch (error) {
        submissionOptions = null;
        return Promise.reject(error);
      }
      return Promise.resolve(result).finally(function () {
        submissionOptions = null;
      });
    }
    state.reviewCards[reviewKey] = {
      signature: signature,
      bundled: bundled,
      card: card,
      applyDecision: previewApplyDecision,
      getDecisionSummary: previewGetDecisionSummary,
      refreshDecisionSummary: refreshDecisionSummary,
      submitDecision: submitDecision,
    };
    return card;
  }

  function getReviewCardEntry(state, input) {
    var reviewKey = input && input.id ? input.id : 'review';
    return state.reviewCards && state.reviewCards[reviewKey] ? state.reviewCards[reviewKey] : null;
  }

  function applyBundleDecision(state, inputs, decision, statusEl) {
    inputs.forEach(function (input) {
      var entry = getReviewCardEntry(state, input);
      if (entry && typeof entry.applyDecision === 'function') {
        entry.applyDecision(decision);
        if (typeof entry.refreshDecisionSummary === 'function') {
          entry.refreshDecisionSummary();
        }
      }
    });
    if (statusEl) {
      statusEl.textContent = decision === 'reject'
        ? 'All pending rows marked rejected.'
        : 'All pending rows marked approved.';
    }
  }

  function submitBundleReviewDecisions(state, inputs, card, statusEl) {
    if (!inputs.length) return Promise.resolve(null);
    card.classList.add('is-submitting');
    if (statusEl) statusEl.textContent = 'Submitting bundled review decisions...';
    var submissions = inputs.map(function (input) {
      var entry = getReviewCardEntry(state, input);
      if (entry && typeof entry.submitDecision === 'function') {
        return entry.submitDecision({ skipRefresh: true });
      }
      var placeholder = createEl('div', 'ai-codex-review-status', '');
      return submitReviewDecision(state.threadId, input, { decision: 'partial' }, placeholder, { skipRefresh: true });
    });
    return Promise.all(submissions)
      .then(function () {
        card.classList.remove('is-submitting');
        card.classList.add('is-submitted');
        if (statusEl) statusEl.textContent = 'Bundled decisions submitted. Refreshing thread...';
        return refreshThreadFromViewState({ threadId: state.threadId });
      })
      .catch(function (error) {
        card.classList.remove('is-submitting');
        card.classList.add('is-error');
        if (statusEl) statusEl.textContent = error && error.message ? error.message : 'Bundled review submission failed.';
        throw error;
      });
  }

  function renderReviewBundleControls(state, inputs) {
    var card = createEl('section', 'ai-codex-blocker ai-codex-review-bundle ai-codex-review-bundle-sticky');
    var header = createEl('div', 'ai-codex-blocker-header');
    header.appendChild(createEl('strong', '', 'Bundled decision review'));
    header.appendChild(createEl('span', 'ai-codex-blocker-badge', String(inputs.length) + ' reviews'));
    card.appendChild(header);

    var status = createEl('div', 'ai-codex-review-status', '');
    var actions = createEl('div', 'ai-codex-blocker-actions');
    actions.appendChild(createButton('ai-secondary-btn ai-codex-approve-all', 'Approve All', function () {
      applyBundleDecision(state, inputs, 'accept', status);
    }));
    actions.appendChild(createButton('ai-secondary-btn ai-codex-reject-all', 'Reject All', function () {
      applyBundleDecision(state, inputs, 'reject', status);
    }));
    var submit = createButton('ai-primary-btn', 'Submit Decisions', function () {
      submitBundleReviewDecisions(state, inputs, card, status).catch(function () {});
    });
    submit.setAttribute('data-review-bundle-submit', 'true');
    actions.appendChild(submit);
    actions.appendChild(createButton('ai-secondary-btn', 'Refresh', function () {
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
    }));
    card.appendChild(actions);
    card.appendChild(status);
    return card;
  }

  function isDelegatedPause(activePause) {
    if (!activePause) return false;
    var values = [
      activePause.reasonKind,
      activePause.reason_kind,
      activePause.kind,
      activePause.type,
      activePause.category,
    ];
    var metadata = activePause.metadata && typeof activePause.metadata === 'object'
      ? activePause.metadata
      : {};
    values.push(
      metadata.reasonKind,
      metadata.reason_kind,
      metadata.pauseKind,
      metadata.pause_kind,
      metadata.pauseType,
      metadata.pause_type,
      metadata.mode,
      metadata.waitingOn,
      metadata.waiting_on,
      metadata.source
    );
    return values.some(function (value) {
      var normalized = String(value || '').toLowerCase().replace(/[\s_]+/g, '-');
      return (
        normalized === 'delegated-work' ||
        normalized === 'delegated' ||
        normalized === 'sub-agent' ||
        normalized === 'subagent' ||
        normalized === 'listen' ||
        normalized === 'agent-listen' ||
        normalized === 'sub-agent-listen' ||
        normalized.indexOf('sub-agent') >= 0 ||
        normalized.indexOf('subagent') >= 0
      );
    });
  }

  function renderPauseCard(state, activePause) {
    if (!activePause) return null;
    var status = String(activePause.status || '').toUpperCase();
    if (isDelegatedPause(activePause) && status === 'RESUMING') return null;
    var badgeLabel = isDelegatedPause(activePause) && status === 'BLOCKED'
      ? 'Waiting'
      : titleCase(status || 'waiting');
    var card = createEl('section', 'ai-codex-blocker ai-codex-pause-card');
    var header = createEl('div', 'ai-codex-blocker-header');
    header.appendChild(createEl('strong', '', displayText(activePause.title, status === 'READY' ? 'Ready to continue' : 'Action required')));
    header.appendChild(createEl('span', 'ai-codex-blocker-badge', badgeLabel));
    card.appendChild(header);
    if (activePause.detail || activePause.progressSummary) {
      card.appendChild(createEl('p', 'ai-codex-blocker-detail', displayText(activePause.detail || activePause.progressSummary)));
    }
    var tasks = Array.isArray(activePause.tasks) ? activePause.tasks : [];
    if (tasks.length) {
      var list = createEl('div', 'ai-codex-pause-tasks');
      tasks.forEach(function (task) {
        var row = createEl('div', 'ai-codex-pause-task');
        row.appendChild(createEl('strong', '', displayText(task.title, 'Required step')));
        if (task.detail) row.appendChild(createEl('span', '', displayText(task.detail)));
        row.appendChild(createEl('span', 'ai-codex-pause-task-status', titleCase(task.status || 'pending')));
        list.appendChild(row);
      });
      card.appendChild(list);
    }
    var actions = createEl('div', 'ai-codex-blocker-actions');
    actions.appendChild(createButton('ai-secondary-btn', 'Check status', function () {
      if (window.__tribexAiState && typeof window.__tribexAiState.checkThreadPause === 'function') {
        window.__tribexAiState.checkThreadPause(state.threadId, activePause.id);
      }
    }));
    if (status === 'READY') {
      actions.appendChild(createButton('ai-primary-btn', 'Continue', function () {
        if (window.__tribexAiState && typeof window.__tribexAiState.continueThreadPause === 'function') {
          window.__tribexAiState.continueThreadPause(state.threadId, activePause.id);
        }
      }));
    }
    card.appendChild(actions);
    return card;
  }

  function renderBlockers(root, state, viewModel) {
    var inputs = viewModel.pendingHumanInputs || [];
    var pause = viewModel.activePause;
    var activeReviewIds = {};
    inputs.forEach(function (input) {
      if (input && input.id) activeReviewIds[input.id] = true;
    });
    Object.keys(state.reviewCards || {}).forEach(function (reviewId) {
      if (!activeReviewIds[reviewId]) {
        delete state.reviewCards[reviewId];
        if (state.reviewCardCollapsed) delete state.reviewCardCollapsed[reviewId];
      }
    });
    if (!inputs.length && !pause) return;
    var wrap = createEl('div', 'ai-codex-blockers');
    var bundled = inputs.length > 1;
    inputs.forEach(function (input) {
      wrap.appendChild(renderReviewCard(state, input, { bundled: bundled }));
    });
    if (bundled) {
      wrap.insertBefore(renderReviewBundleControls(state, inputs), wrap.firstChild);
    }
    if (pause && !inputs.length) {
      var card = renderPauseCard(state, pause);
      if (card) wrap.appendChild(card);
    }
    root.appendChild(wrap);
  }

  function renderArtifactCards(root, state, viewModel) {
    if (!viewModel.artifacts.length) return;
    var shelf = createEl('section', 'ai-codex-artifact-shelf');
    var header = createEl('div', 'ai-codex-shelf-header');
    header.appendChild(createEl('strong', '', 'Artifacts'));
    header.appendChild(createEl('span', 'ai-codex-count', String(viewModel.artifacts.length)));
    shelf.appendChild(header);
    var list = createEl('div', 'ai-codex-artifact-list');
    viewModel.artifacts.forEach(function (artifact) {
      var chip = createButton('ai-codex-artifact-chip', displayText(artifact.title, 'Artifact'), function () {
        state.drawerOpen = true;
        state.selectedArtifactKey = artifact.artifactKey;
        state.render({ force: true });
      });
      if (artifact.reviewRequired) chip.appendChild(createEl('span', 'ai-codex-artifact-flag', 'review'));
      list.appendChild(chip);
    });
    shelf.appendChild(list);
    root.appendChild(shelf);
  }

  function renderTimeline(root, state, threadContext, viewModel) {
    var timeline = createEl('main', 'ai-codex-timeline');
    attachTimelineBehavior(timeline, state);
    renderRecovery(timeline, state, threadContext, viewModel);
    var hasBlockers = (viewModel.pendingHumanInputs || []).length || viewModel.activePause;
    var blockersRendered = false;
    if (hasBlockers) {
      renderBlockers(timeline, state, viewModel);
      blockersRendered = true;
    }
    if (!viewModel.sessions.length) {
      var empty = createEl('section', 'ai-codex-empty');
      empty.appendChild(createEl('h2', '', 'Start a working session'));
      empty.appendChild(createEl('p', '', 'Ask the agent to do work. Progress, reviews, artifacts, and recovery will appear here.'));
      timeline.appendChild(empty);
    } else {
      viewModel.sessions.forEach(function (session, index) {
        if (hasBlockers && !blockersRendered && session.lifecycle === 'queued') {
          renderBlockers(timeline, state, viewModel);
          blockersRendered = true;
        }
        timeline.appendChild(renderSession(session, index, state, viewModel));
      });
    }
    if (hasBlockers && !blockersRendered) renderBlockers(timeline, state, viewModel);
    renderArtifactCards(timeline, state, viewModel);
    root.appendChild(timeline);
  }

  function renderArtifactDrawer(root, state, viewModel) {
    if (!state.drawerOpen && !state.diagnosticsOpen) return;
    var aside = createEl('aside', 'ai-codex-drawer');
    var tabs = createEl('div', 'ai-codex-drawer-tabs');
    if (viewModel.artifacts.length) {
      tabs.appendChild(createButton(cx('ai-codex-drawer-tab', !state.diagnosticsOpen && 'is-active'), 'Artifact', function () {
        state.diagnosticsOpen = false;
        state.drawerOpen = true;
        state.render({ force: true });
      }));
    }
    if (shouldShowDiagnostics(viewModel)) {
      tabs.appendChild(createButton(cx('ai-codex-drawer-tab', state.diagnosticsOpen && 'is-active'), 'Diagnostics', function () {
        state.diagnosticsOpen = true;
        state.drawerOpen = false;
        state.render({ force: true });
      }));
    }
    tabs.appendChild(createButton('ai-codex-drawer-close', 'Close', function () {
      state.drawerOpen = false;
      state.diagnosticsOpen = false;
      state.render({ force: true });
    }, { ariaLabel: 'Close drawer' }));
    aside.appendChild(tabs);

    if (state.diagnosticsOpen) {
      aside.appendChild(createEl('h2', 'ai-codex-drawer-title', 'Runtime diagnostics'));
      var pre = createEl('pre', 'ai-codex-diagnostics');
      pre.textContent = JSON.stringify(viewModel.diagnostics, null, 2);
      aside.appendChild(pre);
      root.appendChild(aside);
      return;
    }

    var selected = viewModel.artifacts.find(function (artifact) {
      return artifact.artifactKey === state.selectedArtifactKey;
    }) || viewModel.artifacts[viewModel.artifacts.length - 1];
    if (!selected) {
      aside.appendChild(createEl('p', 'ai-codex-muted', 'No artifact selected.'));
      root.appendChild(aside);
      return;
    }
    state.selectedArtifactKey = selected.artifactKey;
    aside.appendChild(createEl('h2', 'ai-codex-drawer-title', displayText(selected.title, 'Artifact')));
    if (selected.detail) aside.appendChild(createEl('p', 'ai-codex-muted', displayText(selected.detail)));
    var preview = createEl('div', 'ai-codex-artifact-preview');
    var renderer = selected.contentType && window.__renderers ? window.__renderers[selected.contentType] : null;
    if (typeof renderer === 'function' && selected.resultData) {
      try {
        renderer(preview, selected.resultData, selected.resultMeta || {}, selected.toolArgs || {}, !!selected.reviewRequired);
      } catch (error) {
        preview.textContent = error && error.message ? error.message : 'Artifact preview failed.';
      }
    } else if (selected.resultData) {
      var raw = createEl('pre', 'ai-codex-diagnostics');
      raw.textContent = JSON.stringify(selected.resultData, null, 2);
      preview.appendChild(raw);
    } else {
      preview.textContent = 'This artifact has no inline preview data.';
    }
    aside.appendChild(preview);
    root.appendChild(aside);
  }

  function getSkillsApi() {
    return window.__tribexAiSkills || {};
  }

  function ensureComposerResources(state) {
    var api = getSkillsApi();
    if (state.skillsLoadedForThreadId !== state.threadId && !state.skillsLoading) {
      state.skillsLoading = true;
      state.skillsLoadedForThreadId = state.threadId;
      var skillsPromise = window.__tribexAiClient && typeof window.__tribexAiClient.fetchThreadSkills === 'function'
        ? window.__tribexAiClient.fetchThreadSkills(state.threadId)
        : Promise.resolve(api.builtinSkills ? api.builtinSkills() : []);
      Promise.resolve(skillsPromise).then(function (skills) {
        state.skills = api.mergeSkillLists
          ? api.mergeSkillLists(skills || [], [])
          : (skills || []);
      }).catch(function () {
        state.skills = api.builtinSkills ? api.builtinSkills() : [];
      }).finally(function () {
        state.skillsLoading = false;
        if (typeof state.render === 'function') state.render({ force: true });
      });
    }

    if (state.emailAccountsLoadedForThreadId !== state.threadId && !state.emailAccountsLoading) {
      state.emailAccountsLoading = true;
      state.emailAccountsLoadedForThreadId = state.threadId;
      var accountsPromise = window.__tribexAiClient && typeof window.__tribexAiClient.fetchConnectedEmailAccounts === 'function'
        ? window.__tribexAiClient.fetchConnectedEmailAccounts(state.threadId)
        : Promise.resolve([]);
      Promise.resolve(accountsPromise).then(function (accounts) {
        state.emailAccounts = api.normalizeEmailAccounts ? api.normalizeEmailAccounts(accounts || []) : (accounts || []);
        if (state.selectedSkill && api.buildDefaultValues) {
          var existing = state.skillValues || {};
          var nextDefaults = api.buildDefaultValues(state.selectedSkill, state.emailAccounts, new Date());
          if (!existing.inboxes || !existing.inboxes.length) {
            state.skillValues = Object.assign({}, existing, { inboxes: nextDefaults.inboxes || [] });
          }
        }
      }).catch(function () {
        state.emailAccounts = [];
      }).finally(function () {
        state.emailAccountsLoading = false;
        if (typeof state.render === 'function') state.render({ force: true });
      });
    }
  }

  function readEditorDraft(editor) {
    if (!editor) return '';
    var text = '';
    var skillInsertIndex = null;
    var stripEditorSentinels = function (value) {
      return String(value || '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
    };
    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        text += stripEditorSentinels(node.nodeValue);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.classList && node.classList.contains('ai-codex-skill-chip')) {
        if (skillInsertIndex === null) skillInsertIndex = text.length;
        return;
      }
      if (node.tagName === 'BR') {
        text += '\n';
        return;
      }
      Array.prototype.slice.call(node.childNodes || []).forEach(walk);
      if (node !== editor && /^(DIV|P)$/.test(node.tagName)) text += '\n';
    }
    walk(editor);
    return {
      text: text,
      skillInsertIndex: skillInsertIndex === null ? text.length : skillInsertIndex,
    };
  }

  function readEditorText(editor) {
    return readEditorDraft(editor).text;
  }

  function splitDraftAroundSkill(state) {
    var draft = String(state.draftText || '');
    var index = Math.min(Math.max(state.skillInsertIndex || 0, 0), draft.length);
    return {
      before: draft.slice(0, index),
      after: draft.slice(index),
    };
  }

  function joinPromptParts(before, token, after) {
    return [before, token, after].filter(function (part) {
      return String(part || '').trim();
    }).join(' ').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function detectSlashQuery(value) {
    var api = getSkillsApi();
    return api.detectSlashSkillQuery ? api.detectSlashSkillQuery(value) : null;
  }

  function filteredSkills(state) {
    var api = getSkillsApi();
    return api.filterSkills ? api.filterSkills(state.skills || [], state.slashQuery && state.slashQuery.query) : (state.skills || []);
  }

  function selectSkill(state, skill, slashQuery) {
    var api = getSkillsApi();
    if (!skill) return;
    var draft = String(state.draftText || '');
    var insertIndex = slashQuery ? slashQuery.start : draft.length;
    if (slashQuery) {
      draft = draft.slice(0, slashQuery.start) + draft.slice(slashQuery.end);
    }
    state.draftText = draft.replace(/\s{2,}/g, ' ');
    state.selectedSkill = skill;
    state.skillInsertIndex = Math.min(insertIndex, state.draftText.length);
    state.skillValues = api.buildDefaultValues ? api.buildDefaultValues(skill, state.emailAccounts || [], new Date()) : {};
    state.skillPickerOpen = false;
    state.slashQuery = null;
    state.variablePopover = null;
    state.focusEditorAfterRender = 'after-skill';
    if (typeof state.render === 'function') state.render({ force: true });
  }

  function clearSelectedSkill(state) {
    state.selectedSkill = null;
    state.skillValues = {};
    state.variablePopover = null;
    state.slashQuery = null;
    state.focusEditorAfterRender = null;
    if (typeof state.render === 'function') state.render({ force: true });
  }

  function appendEditorText(editor, text) {
    if (!text) return;
    editor.appendChild(document.createTextNode(text));
  }

  function renderEditorValue(editor, state, placeholder) {
    editor.innerHTML = '';
    editor.setAttribute('data-placeholder', placeholder);
    if (!state.selectedSkill) {
      editor.textContent = state.draftText || '';
      return;
    }
    var draft = String(state.draftText || '');
    var insertIndex = Math.min(Math.max(state.skillInsertIndex || 0, 0), draft.length);
    appendEditorText(editor, draft.slice(0, insertIndex));
    var chip = createEl('span', 'ai-codex-skill-chip', '/' + state.selectedSkill.key);
    chip.contentEditable = 'false';
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-label', 'Selected skill ' + state.selectedSkill.name);
    chip.title = state.selectedSkill.description || state.selectedSkill.name;
    chip.addEventListener('click', function () {
      state.skillPickerOpen = true;
      state.variablePopover = null;
      if (typeof state.render === 'function') state.render({ force: true });
    });
    editor.appendChild(chip);
    editor.appendChild(document.createTextNode('\u200b'));
    appendEditorText(editor, draft.slice(insertIndex));
  }

  function focusEditorAfterSkill(editor, state) {
    if (!editor || state.focusEditorAfterRender !== 'after-skill') return;
    state.focusEditorAfterRender = null;
    window.setTimeout(function () {
      var chip = editor.querySelector('.ai-codex-skill-chip');
      if (!chip) return;
      editor.focus();
      var selection = window.getSelection && window.getSelection();
      if (!selection) return;
      var range = document.createRange();
      var anchor = chip.nextSibling;
      if (anchor && anchor.nodeType === Node.TEXT_NODE) {
        range.setStart(anchor, Math.min(1, anchor.nodeValue.length));
      } else {
        range.setStartAfter(chip);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }, 0);
  }

  function defineEditorValue(editor, state) {
    try {
      Object.defineProperty(editor, 'value', {
        configurable: true,
        get: function () {
          return state.draftText || '';
        },
        set: function (value) {
          state.draftText = String(value || '');
          renderEditorValue(editor, state, editor.getAttribute('data-placeholder') || '');
        },
      });
    } catch (_error) {
      editor.value = state.draftText || '';
    }
  }

  function localDateTimeValue(value) {
    var parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return '';
    var date = new Date(parsed);
    var offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function isoFromLocalDateTime(value) {
    if (!value) return '';
    var parsed = Date.parse(value);
    return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString();
  }

  function createSkillPickerMenu(state) {
    var shouldShow = state.skillPickerOpen || !!state.slashQuery;
    if (!shouldShow) return null;
    var menu = createEl('div', 'ai-codex-skill-menu');
    if (state.skillsLoading) {
      menu.appendChild(createEl('div', 'ai-codex-skill-empty', 'Loading skills...'));
      return menu;
    }
    var skills = filteredSkills(state);
    if (!skills.length) {
      menu.appendChild(createEl('div', 'ai-codex-skill-empty', 'No matching skills'));
      return menu;
    }
    skills.forEach(function (skill) {
      var option = createButton('ai-codex-skill-option', '', function () {
        selectSkill(state, skill, state.slashQuery);
      });
      option.appendChild(createEl('span', 'ai-codex-skill-option-key', '/' + skill.key));
      option.appendChild(createEl('span', 'ai-codex-skill-option-name', skill.name));
      if (skill.description) option.appendChild(createEl('span', 'ai-codex-skill-option-description', skill.description));
      menu.appendChild(option);
    });
    return menu;
  }

  function renderSkillPicker(composer, state, beforeNode) {
    var menu = createSkillPickerMenu(state);
    if (!menu) return;
    if (beforeNode && beforeNode.parentNode === composer) {
      composer.insertBefore(menu, beforeNode);
    } else {
      composer.appendChild(menu);
    }
  }

  function refreshSkillPickerInComposer(composer, state) {
    var existing = composer.querySelector('.ai-codex-skill-menu');
    if (existing) existing.remove();
    var footer = composer.querySelector('.ai-codex-composer-footer');
    renderSkillPicker(composer, state, footer);
  }

  function renderVariablePopover(parent, state, variable) {
    if (!variable || state.variablePopover !== variable.name) return;
    var popover = createEl('div', 'ai-codex-variable-popover');
    popover.appendChild(createEl('strong', '', variable.label));
    if (variable.type === 'email_account_multi_select') {
      var actions = createEl('div', 'ai-codex-variable-actions');
      actions.appendChild(createButton('ai-secondary-btn ai-codex-small-btn', 'Select all', function () {
        state.skillValues[variable.name] = (state.emailAccounts || []).map(function (account) { return account.id; });
        if (typeof state.render === 'function') state.render({ force: true });
      }));
      actions.appendChild(createButton('ai-secondary-btn ai-codex-small-btn', 'Clear', function () {
        state.skillValues[variable.name] = [];
        if (typeof state.render === 'function') state.render({ force: true });
      }));
      popover.appendChild(actions);
      var list = createEl('div', 'ai-codex-email-option-list');
      var selected = state.skillValues[variable.name] || [];
      (state.emailAccounts || []).forEach(function (account) {
        var label = createEl('label', 'ai-codex-email-option');
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.indexOf(account.id) >= 0;
        checkbox.addEventListener('change', function () {
          var next = (state.skillValues[variable.name] || []).slice();
          if (checkbox.checked && next.indexOf(account.id) < 0) next.push(account.id);
          if (!checkbox.checked) next = next.filter(function (id) { return id !== account.id; });
          state.skillValues[variable.name] = next;
          if (typeof state.render === 'function') state.render({ force: true });
        });
        label.appendChild(checkbox);
        label.appendChild(createEl('span', '', account.emailAddress || account.label || account.id));
        list.appendChild(label);
      });
      if (!state.emailAccounts.length) {
        list.appendChild(createEl('div', 'ai-codex-skill-empty', state.emailAccountsLoading ? 'Loading inboxes...' : 'No connected inboxes found'));
      }
      popover.appendChild(list);
    } else if (variable.type === 'datetime') {
      var input = document.createElement('input');
      input.type = 'datetime-local';
      input.className = 'ai-codex-variable-input';
      input.value = localDateTimeValue(state.skillValues[variable.name]);
      input.addEventListener('change', function () {
        state.skillValues[variable.name] = isoFromLocalDateTime(input.value);
        if (typeof state.render === 'function') state.render({ force: true });
      });
      popover.appendChild(input);
    }
    parent.appendChild(popover);
  }

  function renderSkillControls(composer, state) {
    var api = getSkillsApi();
    var wrap = createEl('div', 'ai-codex-skill-controls');
    var row = createEl('div', 'ai-codex-skill-row');
    row.appendChild(createButton('ai-secondary-btn ai-codex-small-btn', 'Skills', function () {
      state.skillPickerOpen = !state.skillPickerOpen;
      state.slashQuery = null;
      state.variablePopover = null;
      if (typeof state.render === 'function') state.render({ force: true });
    }, { title: 'Select a persona skill' }));
    if (state.selectedSkill) {
      row.appendChild(createButton('ai-codex-selected-skill', '/' + state.selectedSkill.key, function () {
        state.skillPickerOpen = !state.skillPickerOpen;
        if (typeof state.render === 'function') state.render({ force: true });
      }));
      row.appendChild(createButton('ai-codex-skill-remove', 'x', function () {
        clearSelectedSkill(state);
      }, { ariaLabel: 'Remove selected skill' }));
    } else {
      row.appendChild(createEl('span', 'ai-codex-composer-hint', 'Type / to search persona skills'));
    }
    wrap.appendChild(row);

    if (state.selectedSkill) {
      var variables = createEl('div', 'ai-codex-variable-row');
      (state.selectedSkill.variables || []).forEach(function (variable) {
        var label = variable.label + ': ' + (api.formatVariableChip ? api.formatVariableChip(variable, state.skillValues[variable.name], state.emailAccounts || []) : String(state.skillValues[variable.name] || ''));
        var chip = createButton('ai-codex-variable-chip', label, function () {
          state.variablePopover = state.variablePopover === variable.name ? null : variable.name;
          state.skillPickerOpen = false;
          if (typeof state.render === 'function') state.render({ force: true });
        });
        variables.appendChild(chip);
      });
      wrap.appendChild(variables);
      (state.selectedSkill.variables || []).forEach(function (variable) {
        renderVariablePopover(wrap, state, variable);
      });
    }
    composer.appendChild(wrap);
  }

  function buildComposerPayload(state) {
    var api = getSkillsApi();
    var userText = String(state.draftText || '').trim();
    if (!state.selectedSkill) {
      return userText ? { displayPrompt: userText, runtimePrompt: userText, skillInvocation: null } : null;
    }
    var split = splitDraftAroundSkill(state);
    var displayPrompt = joinPromptParts(split.before, '/' + state.selectedSkill.key, split.after);
    var runtimePrompt = api.buildRuntimePrompt
      ? api.buildRuntimePrompt(userText, state.selectedSkill, state.skillValues, state.emailAccounts || [])
      : displayPrompt;
    var skillInvocation = api.buildSkillInvocation
      ? api.buildSkillInvocation(state.selectedSkill, state.skillValues, state.emailAccounts || [])
      : null;
    if (skillInvocation) {
      skillInvocation.display = {
        textBefore: split.before,
        textAfter: split.after,
      };
    }
    return {
      displayPrompt: displayPrompt,
      runtimePrompt: runtimePrompt,
      skillInvocation: skillInvocation,
    };
  }

  function renderComposer(root, state, viewModel) {
    ensureComposerResources(state);
    var composer = createEl('section', cx('ai-codex-composer', viewModel.busy && 'is-context-mode'));
    if (viewModel.busy) {
      var interrupt = createButton('ai-secondary-btn ai-codex-interrupt', 'Stop after current step', function () {
        if (window.__tribexAiState && typeof window.__tribexAiState.interruptThread === 'function') {
          window.__tribexAiState.interruptThread(state.threadId);
        }
      });
      composer.appendChild(interrupt);
    }
    var textarea = createEl('div', 'ai-codex-input ai-codex-token-editor');
    textarea.contentEditable = 'true';
    textarea.setAttribute('role', 'textbox');
    textarea.setAttribute('aria-multiline', 'true');
    var placeholder = viewModel.busy
      ? 'Add context to the active working session...'
      : 'Ask the agent to do something...';
    defineEditorValue(textarea, state);
    renderEditorValue(textarea, state, placeholder);
    textarea.addEventListener('input', function () {
      var nextDraft = readEditorDraft(textarea);
      state.draftText = nextDraft.text || '';
      if (state.selectedSkill) state.skillInsertIndex = nextDraft.skillInsertIndex;
      var nextSlash = state.selectedSkill ? null : detectSlashQuery(state.draftText);
      var changed = JSON.stringify(nextSlash || null) !== JSON.stringify(state.slashQuery || null);
      state.slashQuery = nextSlash;
      if (changed) refreshSkillPickerInComposer(composer, state);
    });
    state.textarea = textarea;
    composer.appendChild(textarea);
    renderSkillControls(composer, state);
    renderSkillPicker(composer, state);
    var footer = createEl('div', 'ai-codex-composer-footer');
    footer.appendChild(createEl('span', 'ai-codex-composer-hint', viewModel.busy ? 'Queued as context for the current session' : 'Cmd/Ctrl+Enter to send'));
    var send = createButton('ai-primary-btn', viewModel.busy ? 'Add context' : 'Send', function () {
      var currentDraft = readEditorDraft(textarea);
      state.draftText = currentDraft.text || '';
      if (state.selectedSkill) state.skillInsertIndex = currentDraft.skillInsertIndex;
      var payload = buildComposerPayload(state);
      if (!state.threadId || !window.__tribexAiState || typeof window.__tribexAiState.submitPrompt !== 'function') return;
      if (!payload || !String(payload.displayPrompt || '').trim()) return;
      var prompt = payload.displayPrompt;
      var originalDraftText = state.draftText;
      var originalSkillInsertIndex = state.skillInsertIndex || 0;
      var selectedSkill = state.selectedSkill;
      var skillValues = Object.assign({}, state.skillValues || {});
      state.draftText = '';
      state.selectedSkill = null;
      state.skillValues = {};
      state.skillInsertIndex = 0;
      state.variablePopover = null;
      state.slashQuery = null;
      textarea.value = '';
      var submitResult = selectedSkill
        ? window.__tribexAiState.submitPrompt(state.threadId, prompt, payload)
        : window.__tribexAiState.submitPrompt(state.threadId, prompt);
      Promise.resolve(submitResult)
        .then(function (submitted) {
          if (!submitted) {
            state.draftText = originalDraftText;
            state.selectedSkill = selectedSkill;
            state.skillValues = skillValues;
            state.skillInsertIndex = originalSkillInsertIndex;
            if (state.textarea) state.textarea.value = originalDraftText;
          }
        })
        .catch(function () {
          state.draftText = originalDraftText;
          state.selectedSkill = selectedSkill;
          state.skillValues = skillValues;
          state.skillInsertIndex = originalSkillInsertIndex;
          if (state.textarea) state.textarea.value = originalDraftText;
        });
    }, { disabled: !(viewModel.canSend || state.threadId) });
    textarea.addEventListener('keydown', function (event) {
      if (state.slashQuery && event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        var matches = filteredSkills(state);
        if (matches.length) {
          event.preventDefault();
          selectSkill(state, matches[0], state.slashQuery);
          return;
        }
      }
      if (event.key === 'Escape' && (state.slashQuery || state.skillPickerOpen || state.variablePopover)) {
        event.preventDefault();
        state.slashQuery = null;
        state.skillPickerOpen = false;
        state.variablePopover = null;
        if (typeof state.render === 'function') state.render({ force: true });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !send.disabled) {
        event.preventDefault();
        send.click();
      }
    });
    footer.appendChild(send);
    composer.appendChild(footer);
    root.appendChild(composer);
    focusEditorAfterSkill(textarea, state);
  }

  function renderThread(container, state, options) {
    options = options || {};
    var previousTimeline = container.querySelector('.ai-codex-timeline');
    var previousSnapshot = getTimelineScrollSnapshot(previousTimeline);
    var threadContext = getThreadContext(state.threadId);
    var viewModel = getViewModel(threadContext);
    var signature = viewSignature(threadContext, viewModel);
    if (!options.force && state.lastRenderSignature === signature) {
      return;
    }
    state.lastRenderSignature = signature;
    container.innerHTML = '';
    var root = createEl('div', cx('ai-codex-thread', 'ai-codex-thread-' + viewModel.lifecycle));
    renderHeader(root, state, threadContext, viewModel);
    var layout = createEl('div', 'ai-codex-layout');
    renderTimeline(layout, state, threadContext, viewModel);
    renderArtifactDrawer(layout, state, viewModel);
    root.appendChild(layout);
    renderComposer(root, state, viewModel);
    container.appendChild(root);
    state.hasRenderedThreadContent = true;
    restoreTimelineScroll(container.querySelector('.ai-codex-timeline'), state, viewModel, previousSnapshot);
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.tribex_ai_thread = function renderTribexAiThread(container, data, meta, toolArgs) {
    var threadId = getActiveThreadId(data || {}, meta || {}, toolArgs || {});
    var state = getState(container, threadId);
    state.render = function (options) {
      scheduleRender(container, state, options || {});
    };
    subscribe(container, state);
    renderThread(container, state, {});
  };
})();
