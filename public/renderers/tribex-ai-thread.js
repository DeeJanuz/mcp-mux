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

  function renderMarkdown(content, className) {
    var body = createEl('div', className);
    if (
      window.__companionUtils &&
      typeof window.__companionUtils.renderMarkdown === 'function'
    ) {
      var rendered = window.__companionUtils.renderMarkdown(content || '');
      if (rendered) {
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
      reviewCards: {},
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
      if (previousSnapshot && typeof previousSnapshot.scrollTop === 'number') {
        var maxScroll = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
        timeline.scrollTop = Math.min(previousSnapshot.scrollTop, maxScroll);
        rememberTimelineScroll(state, timeline);
        return;
      }
      if (previousSnapshot && previousSnapshot.wasNearBottom) {
        timeline.scrollTop = timeline.scrollHeight;
        rememberTimelineScroll(state, timeline);
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
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
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
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
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
    prompt.appendChild(createEl('div', 'ai-codex-user-copy', displayText(user && user.content)));
    return prompt;
  }

  function renderAnswer(session) {
    if (!session.answer || !session.answer.content) return null;
    var answer = createEl('article', 'ai-codex-message ai-codex-message-assistant');
    var header = createEl('div', 'ai-codex-message-header');
    header.appendChild(createEl('span', 'ai-codex-role', 'Assistant'));
    if (session.answer.createdAt) header.appendChild(createEl('span', 'ai-codex-time', formatTime(session.answer.createdAt)));
    if (session.answer.isStreaming) header.appendChild(createEl('span', 'ai-codex-live-chip', 'streaming'));
    answer.appendChild(header);
    answer.appendChild(renderMarkdown(displayText(session.answer.content), 'ai-codex-answer-copy'));
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
    var answer = renderAnswer(session);
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

  function submitReviewDecision(threadId, input, decision, card) {
    if (!threadId || !input || !input.id || !window.__tribexAiClient || typeof window.__tribexAiClient.submitThreadHumanInputDecision !== 'function') {
      return Promise.reject(new Error('Review submission is unavailable.'));
    }
    card.classList.add('is-submitting');
    var status = card.querySelector('.ai-codex-review-status');
    if (status) status.textContent = 'Submitting review decision...';
    var payload = Object.assign({}, decision || {}, {
      sessionId: input.reviewSessionId || input.sessionId || input.id,
      decision: (decision && decision.decision) || 'partial',
    });
    return window.__tribexAiClient.submitThreadHumanInputDecision(threadId, input.id, payload)
      .then(function () {
        card.classList.remove('is-submitting');
        card.classList.add('is-submitted');
        if (status) status.textContent = 'Review submitted. Refreshing thread...';
        if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
          return window.__tribexAiState.refreshActiveThread();
        }
        return null;
      })
      .catch(function (error) {
        card.classList.remove('is-submitting');
        card.classList.add('is-error');
        if (status) status.textContent = error && error.message ? error.message : 'Review submission failed.';
        throw error;
      });
  }

  function renderReviewCard(state, input) {
    var reviewKey = input && input.id ? input.id : 'review';
    var signature = reviewInputSignature(input);
    var cached = state.reviewCards && state.reviewCards[reviewKey];
    if (cached && cached.signature === signature && cached.card) {
      return cached.card;
    }
    var card = createEl('section', 'ai-codex-blocker ai-codex-review-card');
    card.setAttribute('data-review-id', reviewKey);
    var header = createEl('div', 'ai-codex-blocker-header');
    header.appendChild(createEl('strong', '', displayText(input.title, 'Review required')));
    header.appendChild(createEl('span', 'ai-codex-blocker-badge', 'Waiting on review'));
    card.appendChild(header);
    if (input.detail || input.description) {
      card.appendChild(createEl('p', 'ai-codex-blocker-detail', displayText(input.detail || input.description)));
    }
    var normalized = sanitizeReviewPayload(input);
    var renderer = window.__renderers && window.__renderers[normalized.renderer];
    var previewProvidesDecisionSubmit = false;
    if (typeof renderer === 'function') {
      var preview = createEl('div', 'ai-codex-review-preview');
      preview.tabIndex = 0;
      preview.setAttribute('role', 'region');
      preview.setAttribute('aria-label', displayText(input.title, 'Review required') + ' preview');
      try {
        renderer(preview, normalized.data, normalized.meta, normalized.toolArgs, true, function (decision) {
          return submitReviewDecision(state.threadId, input, decision, card);
        });
        previewProvidesDecisionSubmit = true;
      } catch (error) {
        preview.textContent = error && error.message ? error.message : 'Review preview failed.';
      }
      card.appendChild(preview);
    }
    card.appendChild(createEl('div', 'ai-codex-review-status', ''));
    var actions = createEl('div', 'ai-codex-blocker-actions');
    if (!previewProvidesDecisionSubmit) {
      actions.appendChild(createButton('ai-primary-btn', 'Submit reviewed decision', function () {
        submitReviewDecision(state.threadId, input, { decision: 'approved' }, card).catch(function () {});
      }));
    }
    actions.appendChild(createButton('ai-secondary-btn', 'Refresh', function () {
      if (window.__tribexAiState && typeof window.__tribexAiState.refreshActiveThread === 'function') {
        window.__tribexAiState.refreshActiveThread();
      }
    }));
    card.appendChild(actions);
    state.reviewCards[reviewKey] = {
      signature: signature,
      card: card,
    };
    return card;
  }

  function renderPauseCard(state, activePause) {
    if (!activePause) return null;
    var status = String(activePause.status || '').toUpperCase();
    var card = createEl('section', 'ai-codex-blocker ai-codex-pause-card');
    var header = createEl('div', 'ai-codex-blocker-header');
    header.appendChild(createEl('strong', '', displayText(activePause.title, status === 'READY' ? 'Ready to continue' : 'Action required')));
    header.appendChild(createEl('span', 'ai-codex-blocker-badge', titleCase(status || 'waiting')));
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
      if (!activeReviewIds[reviewId]) delete state.reviewCards[reviewId];
    });
    if (!inputs.length && !pause) return;
    var wrap = createEl('div', 'ai-codex-blockers');
    inputs.forEach(function (input) {
      wrap.appendChild(renderReviewCard(state, input));
    });
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

  function renderComposer(root, state, viewModel) {
    var composer = createEl('section', cx('ai-codex-composer', viewModel.busy && 'is-context-mode'));
    if (viewModel.busy) {
      var interrupt = createButton('ai-secondary-btn ai-codex-interrupt', 'Stop after current step', function () {
        if (window.__tribexAiState && typeof window.__tribexAiState.interruptThread === 'function') {
          window.__tribexAiState.interruptThread(state.threadId);
        }
      });
      composer.appendChild(interrupt);
    }
    var textarea = createEl('textarea', 'ai-codex-input');
    textarea.placeholder = viewModel.busy
      ? 'Add context to the active working session...'
      : 'Ask the agent to do something...';
    textarea.value = state.draftText || '';
    textarea.addEventListener('input', function () {
      state.draftText = textarea.value;
    });
    state.textarea = textarea;
    composer.appendChild(textarea);
    var footer = createEl('div', 'ai-codex-composer-footer');
    footer.appendChild(createEl('span', 'ai-codex-composer-hint', viewModel.busy ? 'Queued as context for the current session' : 'Cmd/Ctrl+Enter to send'));
    var send = createButton('ai-primary-btn', viewModel.busy ? 'Add context' : 'Send', function () {
      var prompt = textarea.value;
      if (!state.threadId || !window.__tribexAiState || typeof window.__tribexAiState.submitPrompt !== 'function') return;
      if (!String(prompt || '').trim()) return;
      state.draftText = '';
      textarea.value = '';
      Promise.resolve(window.__tribexAiState.submitPrompt(state.threadId, prompt))
        .then(function (submitted) {
          if (!submitted) {
            state.draftText = prompt;
            if (state.textarea) state.textarea.value = prompt;
          }
        })
        .catch(function () {
          state.draftText = prompt;
          if (state.textarea) state.textarea.value = prompt;
        });
    }, { disabled: !viewModel.canSend });
    textarea.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !send.disabled) {
        event.preventDefault();
        send.click();
      }
    });
    footer.appendChild(send);
    composer.appendChild(footer);
    root.appendChild(composer);
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
    renderThread(container, state, { force: true });
  };
})();
