import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var utilsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-utils.js'), 'utf8');
var reducerCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-chat-reducer.js'), 'utf8');
var threadCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-thread.js'), 'utf8');

function loadUtils() {
  new Function(utilsCode).call(globalThis);
}

function loadReducer() {
  new Function(reducerCode).call(globalThis);
}

function loadThread() {
  new Function(threadCode).call(globalThis);
}

function renderThread(threadId) {
  window.__renderers.tribex_ai_thread(
    document.getElementById('target'),
    {},
    {},
    { threadId: threadId || 'thread-1' },
  );
}

function installBaseRenderers() {
  window.__renderers = {
    rich_content: vi.fn(function (container, data) {
      container.textContent = data && data.title ? data.title : 'Rich content preview';
    }),
    structured_data: vi.fn(function (container, data, _meta, _toolArgs, _reviewRequired, onDecision) {
      container.textContent = data && data.title ? data.title : 'Structured data preview';
      if (typeof onDecision === 'function') {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Approve table';
        button.addEventListener('click', function () {
          onDecision({ decision: 'approved', type: 'structured_data_decisions' });
        });
        container.appendChild(button);
      }
    }),
  };
}

function baseThread(overrides) {
  return Object.assign({
    id: 'thread-1',
    title: 'New Chat 3',
    lastActivityAt: '2026-04-24T18:04:12.000Z',
    messages: [],
    runs: [],
  }, overrides || {});
}

beforeEach(function () {
  document.body.innerHTML = '<div id="target"></div>';
  delete window.__MCPVIEWS_DEV__;
  delete window.__tribexAiUtils;
  delete window.__tribexAiChatReducer;
  delete window.__tribexAiState;
  window.__companionUtils = {
    renderMarkdown: vi.fn(function (content) {
      var el = document.createElement('div');
      el.className = 'md-render';
      el.textContent = content || '';
      return el;
    }),
    renderMermaidBlocks: vi.fn(),
    getActiveSession: vi.fn(function () {
      return { session: { meta: { threadId: 'thread-1' } } };
    }),
  };
  installBaseRenderers();
  window.requestAnimationFrame = function (callback) {
    callback();
    return 1;
  };
  loadUtils();
  loadReducer();
  loadThread();
});

afterEach(function () {
  vi.useRealTimers();
});

describe('tribex-ai-thread Codex-like surface', function () {
  it('renders grouped working sessions and opens artifacts in the right drawer', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'TribeX' },
          workspace: { name: 'Dev Deploy' },
          project: { name: 'AI UX Rewrite' },
          thread: baseThread({
            runs: [
              {
                id: 'run-1',
                user: {
                  id: 'u1',
                  role: 'user',
                  content: 'Rewrite the chat surface.',
                  createdAt: '2026-04-24T18:00:00.000Z',
                },
                answer: {
                  id: 'a1',
                  role: 'assistant',
                  content: 'The new surface is wired around working sessions.',
                  createdAt: '2026-04-24T18:04:12.000Z',
                },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  items: [
                    {
                      id: 'tool-1',
                      toolName: 'code_search',
                      title: 'Inspect chat state',
                      status: 'completed',
                      detail: 'Found activeTurn and pendingThreadIds drift.',
                    },
                    {
                      id: 'artifact-1',
                      toolName: 'rich_content',
                      resultContentType: 'rich_content',
                      artifactKey: 'artifact:chat-plan',
                      title: 'Chat Rewrite Plan',
                      status: 'completed',
                      resultData: { title: 'Codex-like chat plan' },
                    },
                    {
                      id: 'subagent-1',
                      kind: 'subagent',
                      title: 'Delegate renderer audit',
                      status: 'completed',
                      childThreadId: 'child-thread-1',
                    },
                  ],
                },
              },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: 'online',
        };
      }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-thread')).not.toBeNull();
    expect(document.querySelector('.ai-codex-title').textContent).toContain('New Chat 3');
    expect(document.querySelector('.ai-codex-session').textContent).toContain('Rewrite the chat surface.');
    expect(document.querySelector('.ai-codex-activity-group-tool').textContent).toContain('Inspect chat state');
    expect(document.querySelector('.ai-codex-activity-group-artifact').textContent).toContain('Chat Rewrite Plan');
    expect(document.querySelector('.ai-codex-activity-group-subagent').open).toBe(true);
    expect(document.querySelector('.ai-codex-answer-copy').textContent).toContain('working sessions');

    document.querySelector('.ai-codex-artifact-chip').click();

    expect(document.querySelector('.ai-codex-drawer')).not.toBeNull();
    expect(document.querySelector('.ai-codex-drawer-title').textContent).toContain('Chat Rewrite Plan');
    expect(window.__renderers.rich_content).toHaveBeenCalled();
  });

  it('hides synthetic review resume prompts and redacts internal IDs from the thread UI', function () {
    var syntheticPrompt = 'The user submitted a review decision for session archive_review_cmobypfhy0000l904abcd1234. Call await_review with session_id=archive_review_cmobypfhy0000l904abcd1234, inspect the accepted rows, then continue.';
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            title: 'Email Inbox Summarizer: Analyze accountId=cmobypfhy0000l904abcd1234, provider=GMAIL, emailAddress=user@example.com',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Archive one email from the review.' },
                answer: { id: 'a1', role: 'assistant', content: 'I prepared the review.' },
              },
              {
                id: 'run-2',
                user: { id: 'u2', role: 'user', content: syntheticPrompt },
                answer: { id: 'a2', role: 'assistant', content: 'Archived the Ray-Ban email after archive_review_cmobypfhy0000l904abcd1234.' },
              },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-title').textContent).toBe('Email Inbox Summarizer');
    expect(document.querySelectorAll('.ai-codex-message-user')).toHaveLength(1);
    expect(document.querySelector('.ai-codex-thread').textContent).toContain('Archive one email from the review.');
    expect(document.querySelector('.ai-codex-thread').textContent).toContain('Archived the Ray-Ban email');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('The user submitted a review decision');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('await_review');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('session_id');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('archive_review_');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('cmobypfhy0000l904abcd1234');
  });

  it('replaces delegated mailbox tool prompts with user-facing copy', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            title: 'Email Inbox Summarizer: Analyze accountId=cmobypfhy0000l904abcd1234, provider=GMAIL, emailAddress=user@example.com',
            runs: [
              {
                id: 'run-1',
                user: {
                  id: 'u1',
                  role: 'user',
                  content: 'Analyze accountId=cmobypfhy0000l904abcd1234, provider=GMAIL, emailAddress=user@example.com, receivedAfter=2026-04-26T02:19:30Z, receivedBefore=2026-04-27T02:19:30Z, inInboxOnly=true. Call user_email_search with that accountId and date range, call email item, and do not mutate email.',
                },
                answer: { id: 'a1', role: 'assistant', content: 'Found one archive candidate.' },
              },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-user-copy').textContent).toBe('Checking the connected mailbox for the requested time window. No email changes are made in this step.');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('receivedAfter');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('user_email_search');
    expect(document.querySelector('.ai-codex-thread').textContent).not.toContain('accountId');
  });

  it('keeps the composer active during runs and queues prompts as context', async function () {
    var threadContext = {
      thread: baseThread({
        activeTurn: {
          turnId: 'turn-1',
          operationId: 'op-running-1234',
          status: 'running',
          presenceLabel: 'Editing files',
          lastPresenceAt: new Date().toISOString(),
          userMessage: {
            id: 'u-active',
            role: 'user',
            content: 'Implement the rewrite.',
            createdAt: '2026-04-24T18:04:00.000Z',
          },
        },
      }),
      loading: false,
      pending: false,
      error: null,
    };
    var submitPrompt = vi.fn(function () { return Promise.resolve(true); });
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () { return threadContext; }),
      submitPrompt: submitPrompt,
      interruptThread: vi.fn(),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');
    var textarea = document.querySelector('.ai-codex-input');
    textarea.value = 'Also inspect the review resume path.';
    textarea.dispatchEvent(new Event('input'));

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-status').textContent).toContain('Editing files');
    expect(document.querySelector('.ai-codex-composer').className).toContain('is-context-mode');
    expect(document.querySelector('.ai-codex-input').value).toBe('Also inspect the review resume path.');
    expect(document.querySelector('.ai-codex-composer-footer button').textContent).toBe('Add context');

    document.querySelector('.ai-codex-composer-footer button').click();
    await Promise.resolve();

    expect(submitPrompt).toHaveBeenCalledWith('thread-1', 'Also inspect the review resume path.');
    expect(document.querySelector('.ai-codex-input').value).toBe('');
  });

  it('clears the prompt draft before a send re-render can switch into context mode', async function () {
    var notify;
    var threadContext = {
      thread: baseThread(),
      loading: false,
      pending: false,
      error: null,
    };
    var submitPrompt = vi.fn(function () {
      threadContext = {
        thread: baseThread({
          activeTurn: {
            turnId: 'turn-1',
            operationId: 'op-1',
            status: 'running',
            presenceLabel: 'Starting work',
            lastPresenceAt: new Date().toISOString(),
            userMessage: {
              id: 'u-active',
              role: 'user',
              content: 'Start delegated work.',
              createdAt: '2026-04-24T18:04:00.000Z',
            },
          },
        }),
        loading: false,
        pending: false,
        error: null,
      };
      notify();
      return Promise.resolve(true);
    });
    window.__tribexAiState = {
      subscribe: vi.fn(function (listener) {
        notify = listener;
        return vi.fn();
      }),
      getThreadContext: vi.fn(function () { return threadContext; }),
      submitPrompt: submitPrompt,
      interruptThread: vi.fn(),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');
    var textarea = document.querySelector('.ai-codex-input');
    textarea.value = 'Start delegated work.';
    textarea.dispatchEvent(new Event('input'));
    document.querySelector('.ai-codex-composer-footer button').click();

    expect(submitPrompt).toHaveBeenCalledWith('thread-1', 'Start delegated work.');
    expect(document.querySelector('.ai-codex-composer').className).toContain('is-context-mode');
    expect(document.querySelector('.ai-codex-input').value).toBe('');
  });

  it('renders inline review blockers and submits renderer decisions through the backend operation spine', async function () {
    var refreshActiveThread = vi.fn(function () { return Promise.resolve(true); });
    var submitDecision = vi.fn(function () { return Promise.resolve({ ok: true }); });
    window.__tribexAiClient = {
      submitThreadHumanInputDecision: submitDecision,
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: refreshActiveThread,
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            pendingHumanInputs: [
              {
                id: 'human-input-1',
                renderer: 'structured_data',
                title: 'Approve revised table',
                detail: 'The working session is paused at this review.',
                reviewSessionId: 'review-session-1',
                rendererPayload: {
                  data: { title: 'Revenue table' },
                  meta: {},
                  toolArgs: {
                    meta: {
                      backendCallback: { token: 'secret-token' },
                    },
                  },
                },
              },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-timeline').getAttribute('aria-label')).toBe('AI thread timeline');
    expect(document.querySelector('.ai-codex-timeline').tabIndex).toBe(0);
    expect(document.querySelector('.ai-codex-status').textContent).toContain('Waiting on review');
    expect(document.querySelector('.ai-codex-review-card').textContent).toContain('Approve revised table');
    expect(document.querySelector('.ai-codex-review-preview').getAttribute('role')).toBe('region');
    expect(document.querySelector('.ai-codex-review-preview').getAttribute('aria-label')).toBe('Approve revised table preview');
    expect(document.querySelector('.ai-codex-review-card').textContent).not.toContain('Submit reviewed decision');
    expect(window.__renderers.structured_data).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      { title: 'Revenue table' },
      expect.objectContaining({ cloudManaged: true, humanInputId: 'human-input-1' }),
      expect.objectContaining({
        meta: expect.objectContaining({
          backendCallback: expect.objectContaining({ token: '[redacted]' }),
        }),
      }),
      true,
      expect.any(Function),
    );

    document.querySelector('.ai-codex-review-preview button').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(submitDecision).toHaveBeenCalledWith(
      'thread-1',
      'human-input-1',
      expect.objectContaining({
        sessionId: 'review-session-1',
        decision: 'approved',
        type: 'structured_data_decisions',
      }),
    );
    expect(refreshActiveThread).toHaveBeenCalled();
    expect(document.querySelector('.ai-codex-review-status').textContent).toContain('Review submitted');
  });

  it('keeps submitted review cards stable while backend reconciliation is still pending', async function () {
    var notify = null;
    var refreshActiveThread = vi.fn(function () { return Promise.resolve(true); });
    var submitDecision = vi.fn(function () { return Promise.resolve({ ok: true }); });
    var threadContext = {
      thread: baseThread({
        lastActivityAt: '2026-04-24T18:04:12.000Z',
        pendingHumanInputs: [
          {
            id: 'human-input-1',
            renderer: 'structured_data',
            title: 'Approve revised table',
            reviewSessionId: 'review-session-1',
            rendererPayload: {
              data: { title: 'Revenue table' },
            },
          },
        ],
      }),
      loading: false,
      pending: false,
      error: null,
    };

    window.__tribexAiClient = {
      submitThreadHumanInputDecision: submitDecision,
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function (listener) {
        notify = listener;
        return vi.fn();
      }),
      refreshActiveThread: refreshActiveThread,
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () { return threadContext; }),
    };

    renderThread('thread-1');
    var originalCard = document.querySelector('.ai-codex-review-card');

    document.querySelector('.ai-codex-review-preview button').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(originalCard.className).toContain('is-submitted');
    expect(originalCard.textContent).toContain('Review submitted');

    threadContext.thread.lastActivityAt = '2026-04-24T18:04:20.000Z';
    notify();
    await new Promise(function (resolve) { setTimeout(resolve, 0); });

    expect(document.querySelector('.ai-codex-review-card')).toBe(originalCard);
    expect(window.__renderers.structured_data).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ai-codex-review-status').textContent).toContain('Review submitted');
  });

  it('renders blocking reviews before queued follow-up context', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            runs: [
              {
                id: 'run-1',
                user: {
                  id: 'u1',
                  role: 'user',
                  content: 'Summarize inboxes.',
                },
                workSession: {
                  id: 'work-1',
                  status: 'running',
                  items: [
                    { id: 'activity-1', kind: 'review', title: 'Prepare archive review', status: 'running' },
                  ],
                },
              },
              {
                id: 'run-2',
                user: {
                  id: 'u2',
                  role: 'user',
                  content: 'Queued context while run is live.',
                },
              },
            ],
            pendingHumanInputs: [
              {
                id: 'human-input-1',
                renderer: 'structured_data',
                title: 'Review archive candidates',
                reviewSessionId: 'review-session-1',
                rendererPayload: {
                  data: { title: 'Archive candidates' },
                },
              },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');

    var timelineChildren = Array.from(document.querySelector('.ai-codex-timeline').children);
    var blockerIndex = timelineChildren.findIndex(function (child) {
      return child.className === 'ai-codex-blockers';
    });
    var queuedIndex = timelineChildren.findIndex(function (child) {
      return child.className.indexOf('ai-codex-session-queued') !== -1;
    });

    expect(blockerIndex).toBeGreaterThan(-1);
    expect(queuedIndex).toBeGreaterThan(-1);
    expect(blockerIndex).toBeLessThan(queuedIndex);
  });

  it('labels queued context rows consistently after the active session completes', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Do the work.' },
                answer: { id: 'a1', role: 'assistant', content: 'Done.' },
              },
              {
                id: 'run-2',
                user: {
                  id: 'u2',
                  role: 'user',
                  content: 'Queued context while run is live.',
                  queued: true,
                },
              },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');

    var queuedSession = document.querySelector('.ai-codex-session-queued');
    expect(queuedSession.textContent).toContain('Queued');
    expect(queuedSession.textContent).toContain('Queued as context');
    expect(queuedSession.textContent).not.toContain('Complete');
  });

  it('skips unchanged notification renders so background state does not churn the thread DOM', function () {
    var subscription = null;
    var threadContext = {
      thread: baseThread({
        runs: [
          {
            id: 'run-1',
            user: { id: 'u1', role: 'user', content: 'Do the work.' },
            answer: { id: 'a1', role: 'assistant', content: 'Done.' },
          },
        ],
      }),
      loading: false,
      pending: false,
      error: null,
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function (listener) {
        subscription = listener;
        return vi.fn();
      }),
      getThreadContext: vi.fn(function () { return threadContext; }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');
    var root = document.querySelector('.ai-codex-thread');
    var markdownCalls = window.__companionUtils.renderMarkdown.mock.calls.length;

    threadContext.thread.lastHydratedAt = new Date().toISOString();
    subscription();
    subscription();
    subscription();

    expect(document.querySelector('.ai-codex-thread')).toBe(root);
    expect(window.__companionUtils.renderMarkdown.mock.calls.length).toBe(markdownCalls);
  });

  it('preserves user edits inside a review card when background activity changes the timeline', function () {
    var subscription = null;
    var threadContext = {
      thread: baseThread({
        pendingHumanInputs: [
          {
            id: 'human-input-1',
            renderer: 'structured_data',
            title: 'Approve revised table',
            rendererPayload: {
              data: { title: 'Revenue table', value: 'initial' },
            },
          },
        ],
      }),
      loading: false,
      pending: false,
      error: null,
    };
    window.__renderers.structured_data = vi.fn(function (container, data) {
      var input = document.createElement('input');
      input.className = 'review-editor';
      input.value = data.value;
      container.appendChild(input);
    });
    window.__tribexAiState = {
      subscribe: vi.fn(function (listener) {
        subscription = listener;
        return vi.fn();
      }),
      getThreadContext: vi.fn(function () { return threadContext; }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');
    var editor = document.querySelector('.review-editor');
    editor.value = 'user-edited value';

    threadContext.thread.lastActivityAt = '2026-04-24T18:05:00.000Z';
    subscription();

    expect(document.querySelector('.review-editor')).toBe(editor);
    expect(document.querySelector('.review-editor').value).toBe('user-edited value');
    expect(window.__renderers.structured_data).toHaveBeenCalledTimes(1);

    threadContext.thread.activeTurn = {
      turnId: 'turn-1',
      operationId: 'op-review',
      status: 'running',
      lastPresenceAt: new Date().toISOString(),
      userMessage: { id: 'u1', role: 'user', content: 'Prepare review.' },
    };
    threadContext.thread.workflowProjection = {
      operationId: 'op-review',
      status: 'running',
      updatedAt: new Date().toISOString(),
      timeline: {
        steps: [
          { id: 'step-1', title: 'Prepare review payload', status: 'running', kind: 'review' },
        ],
      },
    };
    subscription();

    expect(document.querySelector('.review-editor')).toBe(editor);
    expect(document.querySelector('.review-editor').value).toBe('user-edited value');
    expect(window.__renderers.structured_data).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ai-codex-activity-group-review').textContent).toContain('Prepare review payload');
  });

  it('keeps waiting review cards still during backend status polling', function () {
    var subscription = null;
    var pollIndex = 0;
    var threadContext = {
      thread: baseThread({
        lastActivityAt: '2026-04-24T18:04:12.000Z',
        pendingHumanInputs: [
          {
            id: 'human-input-1',
            renderer: 'structured_data',
            title: 'Approve revised table',
            rendererPayload: {
              data: { title: 'Revenue table', value: 'initial' },
            },
          },
        ],
      }),
      loading: false,
      pending: false,
      error: null,
    };
    window.__renderers.structured_data = vi.fn(function (container, data) {
      var input = document.createElement('input');
      input.className = 'review-editor';
      input.value = data.value;
      container.appendChild(input);
    });
    window.__tribexAiState = {
      subscribe: vi.fn(function (listener) {
        subscription = listener;
        return vi.fn();
      }),
      getThreadContext: vi.fn(function () { return threadContext; }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      refreshActiveThread: vi.fn(function () {
        pollIndex += 1;
        threadContext.thread.lastActivityAt = '2026-04-24T18:04:' + String(20 + pollIndex).padStart(2, '0') + '.000Z';
        threadContext.thread.lastHydratedAt = '2026-04-24T18:05:' + String(pollIndex).padStart(2, '0') + '.000Z';
        threadContext.thread.runtimeSnapshot = {
          messages: [{ id: 'runtime-poll-' + pollIndex }],
        };
        threadContext.thread.pendingThreadIds = ['thread-1'];
        if (typeof subscription === 'function') subscription();
        return Promise.resolve(true);
      }),
    };

    renderThread('thread-1');
    var root = document.querySelector('.ai-codex-thread');
    var reviewCard = document.querySelector('.ai-codex-review-card');
    var editor = document.querySelector('.review-editor');
    editor.value = 'user-edited value';

    var refreshButton = Array.from(document.querySelectorAll('.ai-codex-review-card .ai-codex-blocker-actions button')).find(function (button) {
      return button.textContent === 'Refresh';
    });
    refreshButton.click();
    refreshButton.click();
    refreshButton.click();

    expect(window.__tribexAiState.refreshActiveThread).toHaveBeenCalledTimes(3);
    expect(document.querySelector('.ai-codex-thread')).toBe(root);
    expect(document.querySelector('.ai-codex-review-card')).toBe(reviewCard);
    expect(document.querySelector('.review-editor')).toBe(editor);
    expect(document.querySelector('.review-editor').value).toBe('user-edited value');
    expect(window.__renderers.structured_data).toHaveBeenCalledTimes(1);
  });

  it('shows pause continuation controls at the blocking point', function () {
    var checkThreadPause = vi.fn();
    var continueThreadPause = vi.fn();
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            activePause: {
              id: 'pause-1',
              status: 'READY',
              title: 'Ready to continue',
              detail: 'The backend finished review reconciliation.',
              tasks: [
                { title: 'Apply review', detail: 'Decision accepted.', status: 'COMPLETED' },
              ],
            },
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
      checkThreadPause: checkThreadPause,
      continueThreadPause: continueThreadPause,
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-status').textContent).toContain('Waiting on you');
    expect(document.querySelector('.ai-codex-pause-card').textContent).toContain('Ready to continue');

    var buttons = Array.from(document.querySelectorAll('.ai-codex-pause-card button'));
    buttons.find(function (button) { return button.textContent === 'Check status'; }).click();
    buttons.find(function (button) { return button.textContent === 'Continue'; }).click();

    expect(checkThreadPause).toHaveBeenCalledWith('thread-1', 'pause-1');
    expect(continueThreadPause).toHaveBeenCalledWith('thread-1', 'pause-1');
  });

  it('surfaces stale runtime recovery and dev diagnostics without hiding the composer', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T18:05:30.000Z'));
    window.__MCPVIEWS_DEV__ = true;
    var refreshActiveThread = vi.fn();
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: refreshActiveThread,
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            activeTurn: {
              turnId: 'turn-stale',
              operationId: 'op-stale-9876',
              status: 'running',
              lastPresenceAt: '2026-04-24T18:04:00.000Z',
              userMessage: {
                id: 'u-stale',
                role: 'user',
                content: 'Why is New Chat 3 frozen?',
                createdAt: '2026-04-24T18:04:00.000Z',
              },
            },
            runtimeSnapshot: {
              messages: [{ id: 'runtime-1' }, { id: 'runtime-2' }],
            },
          }),
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'stale',
          relayStatus: 'online',
        };
      }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-thread').className).toContain('ai-codex-thread-recovering');
    expect(document.querySelector('.ai-codex-recovery').textContent).toContain('Checking status');
    expect(document.querySelector('.ai-codex-thread > .ai-codex-recovery')).toBeNull();
    expect(document.querySelector('.ai-codex-input')).not.toBeNull();

    document.querySelector('.ai-codex-header-actions button:nth-child(2)').click();

    expect(document.querySelector('.ai-codex-diagnostics').textContent).toContain('"lifecycle": "recovering"');
    expect(document.querySelector('.ai-codex-diagnostics').textContent).toContain('"activeOperationId": "op-stale-9876"');
    expect(document.querySelector('.ai-codex-diagnostics').textContent).toContain('"runtimeMessageCount": 2');

    document.querySelector('.ai-codex-recovery-actions button').click();
    expect(refreshActiveThread).toHaveBeenCalled();
  });
});
