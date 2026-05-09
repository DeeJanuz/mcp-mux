import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var utilsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-utils.js'), 'utf8');
var reducerCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-chat-reducer.js'), 'utf8');
var skillsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-skills.js'), 'utf8');
var threadCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-thread.js'), 'utf8');
var stylesCode = readFileSync(join(__dirnameResolved, '../src/styles.css'), 'utf8');

function loadUtils() {
  new Function(utilsCode).call(globalThis);
}

function loadReducer() {
  new Function(reducerCode).call(globalThis);
}

function loadSkills() {
  new Function(skillsCode).call(globalThis);
}

function loadThread() {
  new Function(threadCode).call(globalThis);
}

function flushPromises() {
  return Promise.resolve().then(function () {
    return Promise.resolve();
  });
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
      var submitDecision = function () {
        return typeof onDecision === 'function'
          ? onDecision({ decision: 'approved', type: 'structured_data_decisions' })
          : null;
      };
      if (typeof onDecision === 'function') {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Approve table';
        button.setAttribute('data-review-decision-submit', 'true');
        button.addEventListener('click', function () {
          submitDecision();
        });
        container.appendChild(button);
      }
      return {
        providesDecisionSubmit: true,
        submitDecision: submitDecision,
      };
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
  delete window.__tribexAiSkills;
  delete window.__tribexAiState;
  delete window.__tribexAiClient;
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
  loadSkills();
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
          organization: { name: 'Acme AI Harness' },
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

  it('renders skill user messages as handwritten text plus the skill chip', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            title: 'Email Analysis',
            messages: [
              {
                id: 'user-skill-1',
                role: 'user',
                content: 'Before /email-analysis after',
                metadata: {
                  skillInvocation: {
                    key: 'email-analysis',
                    name: 'Email Analysis',
                  },
                },
                createdAt: '2026-04-24T18:04:12.000Z',
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

    var userCopy = document.querySelector('.ai-codex-user-copy');
    expect(userCopy.textContent).toBe('Before /email-analysis after');
    expect(userCopy.querySelector('.ai-codex-message-skill-chip').textContent).toBe('/email-analysis');
    expect(userCopy.textContent).not.toContain('Inboxes:');
  });

  it('chips persisted skill display prompts even when transcript metadata is unavailable', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            title: 'Email Analysis',
            messages: [
              {
                id: 'user-skill-persisted',
                role: 'user',
                content: 'Summarize my inbox /email-analysis',
                createdAt: '2026-04-24T18:04:12.000Z',
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

    var userCopy = document.querySelector('.ai-codex-user-copy');
    expect(userCopy.textContent).toBe('Summarize my inbox /email-analysis');
    expect(userCopy.querySelector('.ai-codex-message-skill-chip').textContent).toBe('/email-analysis');
  });

  it('uses skill display metadata when runtime hydration includes the expanded prompt text', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            title: 'Email Analysis',
            messages: [
              {
                id: 'user-skill-runtime',
                role: 'user',
                content: 'Summarize my inbox\n\nUse the Email Coordinator persona.\n- personal@example.com (provider: GMAIL, account id: acct-primary)',
                metadata: {
                  skillInvocation: {
                    key: 'email-analysis',
                    name: 'Email Analysis',
                    display: {
                      textBefore: 'Summarize my inbox',
                      textAfter: '',
                    },
                  },
                },
                createdAt: '2026-04-24T18:04:12.000Z',
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

    var userCopy = document.querySelector('.ai-codex-user-copy');
    expect(userCopy.textContent).toBe('Summarize my inbox /email-analysis');
    expect(userCopy.textContent).not.toContain('account id');
    expect(userCopy.querySelector('.ai-codex-message-skill-chip').textContent).toBe('/email-analysis');
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

  it('lets the composer select email-analysis with defaults from connected inboxes', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));
    var submitPrompt = vi.fn(function () { return Promise.resolve(true); });
    window.__tribexAiClient = {
      fetchThreadSkills: vi.fn(function () {
        return Promise.resolve(window.__tribexAiSkills.builtinSkills());
      }),
      fetchConnectedEmailAccounts: vi.fn(function () {
        return Promise.resolve([
          { id: 'acct-primary', provider: 'GMAIL', emailAddress: 'primary@example.com', displayName: 'Primary' },
          { id: 'acct-work', provider: 'GMAIL', emailAddress: 'work@example.com', displayName: 'Work' },
        ]);
      }),
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: submitPrompt,
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread(),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');
    await flushPromises();

    var editor = document.querySelector('.ai-codex-input');
    editor.value = 'List archive candidates.';
    editor.dispatchEvent(new Event('input'));
    var skillsButton = Array.from(document.querySelectorAll('.ai-codex-skill-row button')).find(function (button) {
      return button.textContent === 'Skills';
    });
    skillsButton.click();
    document.querySelector('.ai-codex-skill-option').click();

    expect(document.querySelector('.ai-codex-skill-chip').textContent).toBe('/email-analysis');
    expect(document.querySelector('.ai-codex-variable-row').textContent).toContain('Inboxes: All inboxes');
    expect(document.querySelector('.ai-codex-variable-row').textContent).toContain('Start: 2026-04-26T12:00:00Z');
    expect(document.querySelector('.ai-codex-variable-row').textContent).toContain('End: 2026-04-27T12:00:00Z');

    editor = document.querySelector('.ai-codex-input');
    editor.value = 'List archive candidates. /another';
    editor.dispatchEvent(new Event('input'));
    expect(document.querySelector('.ai-codex-skill-menu')).toBeNull();

    document.querySelector('.ai-codex-composer-footer button').click();
    await flushPromises();

    expect(submitPrompt).toHaveBeenCalledTimes(1);
    var displayPrompt = submitPrompt.mock.calls[0][1];
    var payload = submitPrompt.mock.calls[0][2];
    expect(displayPrompt).toContain('/email-analysis');
    expect(displayPrompt).not.toContain('Inboxes: All inboxes');
    expect(displayPrompt).not.toContain('Use the Email Coordinator persona');
    expect(displayPrompt).not.toContain('acct-primary');
    expect(payload.runtimePrompt).toContain('Use the Email Coordinator persona');
    expect(payload.runtimePrompt).toContain('primary@example.com (provider: GMAIL, account id: acct-primary)');
    expect(payload.runtimePrompt).toContain('work@example.com (provider: GMAIL, account id: acct-work)');
    expect(payload.runtimePrompt).toContain('Start: 2026-04-26T12:00:00Z');
    expect(payload.runtimePrompt).toContain('Skill variable values (defensive JSON context');
    expect(payload.skillInvocation).toMatchObject({
      key: 'email-analysis',
      selectedAccounts: [
        { id: 'acct-primary', emailAddress: 'primary@example.com' },
        { id: 'acct-work', emailAddress: 'work@example.com' },
      ],
    });
  });

  it('allows a pushed thread renderer with a known id to send before thread cache hydration', async function () {
    var submitPrompt = vi.fn(function () { return Promise.resolve(true); });
    window.__tribexAiClient = {
      fetchThreadSkills: vi.fn(function () {
        return Promise.resolve(window.__tribexAiSkills.builtinSkills());
      }),
      fetchConnectedEmailAccounts: vi.fn(function () {
        return Promise.resolve([]);
      }),
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: submitPrompt,
      getThreadContext: vi.fn(function () {
        return {
          thread: null,
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-pushed');
    await flushPromises();

    var editor = document.querySelector('.ai-codex-input');
    editor.value = 'Summarize inboxes.';
    editor.dispatchEvent(new Event('input'));
    document.querySelector('.ai-codex-skill-row button').click();
    document.querySelector('.ai-codex-skill-option').click();

    var send = document.querySelector('.ai-codex-composer-footer button');
    expect(send.disabled).toBe(false);
    send.click();
    await flushPromises();

    expect(submitPrompt).toHaveBeenCalledWith(
      'thread-pushed',
      expect.stringContaining('/email-analysis'),
      expect.objectContaining({
        skillInvocation: expect.objectContaining({ key: 'email-analysis' }),
      }),
    );
  });

  it('keeps editable text before and after the selected skill chip', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));
    var submitPrompt = vi.fn(function () { return Promise.resolve(true); });
    window.__tribexAiClient = {
      fetchThreadSkills: vi.fn(function () {
        return Promise.resolve(window.__tribexAiSkills.builtinSkills());
      }),
      fetchConnectedEmailAccounts: vi.fn(function () {
        return Promise.resolve([
          { id: 'acct-primary', provider: 'GMAIL', emailAddress: 'primary@example.com' },
        ]);
      }),
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: submitPrompt,
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread(),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');
    await flushPromises();

    var editor = document.querySelector('.ai-codex-input');
    editor.value = 'Before ';
    editor.dispatchEvent(new Event('input'));
    document.querySelector('.ai-codex-skill-row button').click();
    document.querySelector('.ai-codex-skill-option').click();

    editor = document.querySelector('.ai-codex-input');
    var chip = editor.querySelector('.ai-codex-skill-chip');
    expect(chip.nextSibling.nodeValue).toBe('\u200b');
    chip.nextSibling.nodeValue += ' after';
    editor.dispatchEvent(new Event('input'));

    document.querySelector('.ai-codex-composer-footer button').click();
    await flushPromises();

    var displayPrompt = submitPrompt.mock.calls[0][1];
    var payload = submitPrompt.mock.calls[0][2];
    expect(displayPrompt).toBe('Before /email-analysis after');
    expect(payload.displayPrompt).toBe('Before /email-analysis after');
    expect(payload.runtimePrompt).toContain('Before  after');
    expect(payload.runtimePrompt).toContain('Use the Email Coordinator persona');
    expect(payload.skillInvocation.display).toMatchObject({
      textBefore: 'Before ',
      textAfter: ' after',
    });
  });

  it('keeps composer focus while slash filtering skills', async function () {
    window.__tribexAiClient = {
      fetchThreadSkills: vi.fn(function () {
        return Promise.resolve(window.__tribexAiSkills.builtinSkills());
      }),
      fetchConnectedEmailAccounts: vi.fn(function () {
        return Promise.resolve([]);
      }),
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread(),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');
    await flushPromises();

    var editor = document.querySelector('.ai-codex-input');
    editor.focus();
    editor.textContent = '/e';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.activeElement).toBe(editor);
    expect(document.querySelector('.ai-codex-input')).toBe(editor);
    expect(document.querySelector('.ai-codex-skill-option').textContent).toContain('/email-analysis');

    editor.textContent = '/ema';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.activeElement).toBe(editor);
    expect(document.querySelector('.ai-codex-input')).toBe(editor);
    expect(document.querySelector('.ai-codex-skill-option').textContent).toContain('/email-analysis');
  });

  it('edits email-analysis inbox variables from the compact popover', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));
    var submitPrompt = vi.fn(function () { return Promise.resolve(true); });
    window.__tribexAiClient = {
      fetchThreadSkills: vi.fn(function () {
        return Promise.resolve(window.__tribexAiSkills.builtinSkills());
      }),
      fetchConnectedEmailAccounts: vi.fn(function () {
        return Promise.resolve([
          { id: 'acct-personal', provider: 'GMAIL', emailAddress: 'personal@example.com' },
          { id: 'acct-work', provider: 'GMAIL', emailAddress: 'work@example.com' },
        ]);
      }),
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(),
      submitPrompt: submitPrompt,
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread(),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };

    renderThread('thread-1');
    await flushPromises();
    document.querySelector('.ai-codex-skill-row button').click();
    document.querySelector('.ai-codex-skill-option').click();

    var inboxChip = Array.from(document.querySelectorAll('.ai-codex-variable-chip')).find(function (button) {
      return button.textContent.indexOf('Inboxes:') === 0;
    });
    inboxChip.click();
    var secondCheckbox = document.querySelectorAll('.ai-codex-email-option input')[1];
    secondCheckbox.checked = false;
    secondCheckbox.dispatchEvent(new Event('change'));

    expect(document.querySelector('.ai-codex-variable-row').textContent).toContain('Inboxes: personal@example.com');
    document.querySelector('.ai-codex-composer-footer button').click();
    await flushPromises();

    var payload = submitPrompt.mock.calls[0][2];
    expect(payload.displayPrompt).toContain('/email-analysis');
    expect(payload.displayPrompt).not.toContain('Inboxes: personal@example.com');
    expect(payload.displayPrompt).not.toContain('acct-personal');
    expect(payload.runtimePrompt).toContain('personal@example.com (provider: GMAIL, account id: acct-personal)');
    expect(payload.runtimePrompt).not.toContain('acct-work');
    expect(payload.skillInvocation.selectedAccounts).toEqual([
      expect.objectContaining({ id: 'acct-personal', emailAddress: 'personal@example.com' }),
    ]);
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
    expect(document.querySelector('.ai-codex-blocker-header .ai-primary-btn')).toBeNull();
    expect(document.querySelector('.ai-codex-action-dock .ai-primary-btn').textContent).toBe('Submit decisions');
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

    document.querySelector('.ai-codex-action-dock .ai-primary-btn').click();
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

  it('batches multiple pending review cards behind one submit control', async function () {
    var refreshActiveThread = vi.fn(function () { return Promise.resolve(true); });
    var submitDecision = vi.fn(function () { return Promise.resolve({ ok: true }); });
    var rendererStates = {};
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
                id: 'human-input-a',
                renderer: 'structured_data',
                title: 'Archive account A',
                reviewSessionId: 'review-session-a',
                rendererPayload: { data: { title: 'Account A' } },
              },
              {
                id: 'human-input-b',
                renderer: 'structured_data',
                title: 'Archive account B',
                reviewSessionId: 'review-session-b',
                rendererPayload: { data: { title: 'Account B' } },
              },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
    };
    window.__renderers.structured_data = vi.fn(function (container, data, meta, _toolArgs, _reviewRequired, onDecision) {
      rendererStates[data.title] = { decision: null, meta: meta };
      container.appendChild(document.createTextNode(data.title));
      var tableAccept = document.createElement('button');
      tableAccept.type = 'button';
      tableAccept.textContent = 'Accept All';
      container.appendChild(tableAccept);
      if (!meta.externalDecisionSubmit) {
        var localSubmit = document.createElement('button');
        localSubmit.type = 'button';
        localSubmit.textContent = 'Submit Decisions';
        localSubmit.setAttribute('data-review-decision-submit', 'true');
        container.appendChild(localSubmit);
      }
      return {
        providesDecisionSubmit: true,
        applyDecision: function (decision) {
          rendererStates[data.title].decision = decision;
          if (typeof meta.onDecisionStateChange === 'function') {
            meta.onDecisionStateChange({
              totalRows: 1,
              decidedRows: decision === 'accept' || decision === 'reject' ? 1 : 0,
              pendingRows: decision === 'accept' || decision === 'reject' ? 0 : 1,
              complete: decision === 'accept' || decision === 'reject',
            });
          }
        },
        getDecisionSummary: function () {
          var decided = rendererStates[data.title].decision === 'accept' || rendererStates[data.title].decision === 'reject';
          return {
            totalRows: 1,
            decidedRows: decided ? 1 : 0,
            pendingRows: decided ? 0 : 1,
            complete: decided,
          };
        },
        submitDecision: function () {
          return onDecision({
            type: 'operation_decisions',
            decisions: {
              [data.title + ':row-1']: rendererStates[data.title].decision,
            },
          });
        },
      };
    });

    renderThread('thread-1');

    var submitButtons = Array.from(document.querySelectorAll('button')).filter(function (button) {
      return /submit decisions/i.test(button.textContent || '');
    });
    expect(submitButtons).toHaveLength(1);
    expect(document.querySelector('[data-review-bundle-submit="true"]')).not.toBeNull();
    expect(document.querySelector('.ai-codex-action-dock [data-review-bundle-submit="true"]')).not.toBeNull();
    expect(document.querySelector('.ai-codex-review-bundle-sticky')).toBeNull();
    expect(Array.from(document.querySelectorAll('.ai-codex-review-decision-badge')).map(function (badge) {
      return badge.textContent;
    })).toEqual(['0/1 decided', '0/1 decided']);
    expect(Array.from(document.querySelectorAll('.ai-codex-review-preview button')).map(function (button) {
      return button.textContent;
    })).toEqual(['Accept All', 'Accept All']);
    expect(window.__renderers.structured_data).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      { title: 'Account A' },
      expect.objectContaining({ externalDecisionSubmit: true, bundleDecisionSubmit: true }),
      expect.any(Object),
      true,
      expect.any(Function),
    );

    var firstCard = document.querySelector('.ai-codex-review-card');
    var firstBody = firstCard.querySelector('.ai-codex-review-card-body');
    var firstToggle = firstCard.querySelector('.ai-codex-review-toggle');
    expect(firstCard.getAttribute('data-review-collapsed')).toBe('false');
    expect(firstBody.hidden).toBe(false);
    expect(firstCard.querySelector('.ai-codex-review-preview').classList.contains('ai-codex-review-preview-full')).toBe(true);
    firstToggle.click();
    expect(firstCard.getAttribute('data-review-collapsed')).toBe('true');
    expect(firstBody.hidden).toBe(true);
    expect(firstToggle.getAttribute('aria-expanded')).toBe('false');
    firstToggle.click();
    expect(firstCard.getAttribute('data-review-collapsed')).toBe('false');
    expect(firstBody.hidden).toBe(false);

    Array.from(document.querySelectorAll('button')).find(function (button) {
      return button.textContent === 'Approve All';
    }).click();
    expect(Array.from(document.querySelectorAll('.ai-codex-review-decision-badge')).map(function (badge) {
      return [badge.textContent, badge.getAttribute('data-decision-complete')];
    })).toEqual([['All rows decided', 'true'], ['All rows decided', 'true']]);

    document.querySelector('[data-review-bundle-submit="true"]').click();
    await flushPromises();
    await flushPromises();

    expect(submitDecision).toHaveBeenCalledTimes(2);
    expect(submitDecision).toHaveBeenNthCalledWith(
      1,
      'thread-1',
      'human-input-a',
      expect.objectContaining({
        sessionId: 'review-session-a',
        decision: 'partial',
        operationDecisions: { 'Account A:row-1': 'accept' },
      }),
    );
    expect(submitDecision).toHaveBeenNthCalledWith(
      2,
      'thread-1',
      'human-input-b',
      expect.objectContaining({
        sessionId: 'review-session-b',
        decision: 'partial',
        operationDecisions: { 'Account B:row-1': 'accept' },
      }),
    );
    expect(refreshActiveThread).toHaveBeenCalledTimes(1);
  });

  it('keeps bundled review controls in the bottom action dock and removes nested review preview scrolling', function () {
    expect(stylesCode).not.toContain('.ai-codex-review-bundle-sticky');
    expect(stylesCode).not.toContain('position: sticky;\n  top: 10px;');
    expect(stylesCode).toContain('.ai-codex-action-dock');
    expect(stylesCode).toContain('grid-template-rows: auto minmax(0, 1fr) auto auto');
    expect(stylesCode).toContain('.ai-codex-session {');
    expect(stylesCode).toContain('max-width: none');
    expect(stylesCode).toContain('.ai-codex-review-bundle {');
    expect(stylesCode).toContain('padding: 8px 10px');
    expect(stylesCode).toContain('min-height: 28px');
    expect(stylesCode).toContain('border-radius: 6px');
    expect(stylesCode).toContain('.ai-codex-review-bundle .ai-codex-approve-all');
    expect(stylesCode).toContain('background: var(--color-success-bg)');
    expect(stylesCode).toContain('.ai-codex-review-bundle .ai-codex-reject-all');
    expect(stylesCode).toContain('background: var(--color-error-bg)');
    expect(stylesCode).toContain('.ai-codex-review-bundle .ai-codex-review-status:empty');
    expect(stylesCode).toContain('max-height: none');
    expect(stylesCode).toContain('overflow: visible');
  });

  it('keeps critical loading affordances animated when reduced motion is reported', function () {
    expect(stylesCode).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stylesCode).toContain('animation: ai-reduced-loading-line-pulse 1.8s ease-in-out infinite !important;');
    expect(stylesCode).toContain('animation: ai-reduced-loading-pulse 1.8s ease-in-out infinite !important;');
    expect(stylesCode).toContain('.ai-run-answer-streaming .ai-run-answer-body::after');
    expect(stylesCode).toContain('.ai-codex-status-running .ai-codex-status-dot');
    expect(stylesCode).toContain('.ai-codex-session-queued .ai-codex-session-dot');
    expect(stylesCode).toContain('.ai-codex-pulse');
    expect(stylesCode).toContain('@keyframes ai-reduced-loading-pulse');
    expect(stylesCode).toContain('@keyframes ai-reduced-loading-line-pulse');
  });

  it('maps structured-data row decisions to the control-plane review payload shape', async function () {
    var submitDecision = vi.fn(function () { return Promise.resolve({ ok: true }); });
    window.__tribexAiClient = {
      submitThreadHumanInputDecision: submitDecision,
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(function () { return Promise.resolve(true); }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            pendingHumanInputs: [
              {
                id: 'human-input-archive',
                renderer: 'structured_data',
                title: 'Archive review',
                reviewSessionId: 'archive-review-1',
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
    window.__renderers.structured_data = vi.fn(function (container, _data, _meta, _toolArgs, _reviewRequired, onDecision) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Submit partial';
      button.setAttribute('data-review-decision-submit', 'true');
      button.addEventListener('click', function () {
        onDecision({
          type: 'operation_decisions',
          decisions: {
            'archive:acct-1:ray-ban': 'accept',
            'archive:acct-1:gucci': 'reject',
          },
          modifications: {},
          additions: { user_edits: {} },
        });
      });
      container.appendChild(button);
      return {
        providesDecisionSubmit: true,
      };
    });

    renderThread('thread-1');
    document.querySelector('.ai-codex-review-preview button').click();
    await flushPromises();

    expect(submitDecision).toHaveBeenCalledWith(
      'thread-1',
      'human-input-archive',
      expect.objectContaining({
        sessionId: 'archive-review-1',
        decision: 'partial',
        operationDecisions: {
          'archive:acct-1:ray-ban': 'accept',
          'archive:acct-1:gucci': 'reject',
        },
        decisions: {
          'archive:acct-1:ray-ban': 'accept',
          'archive:acct-1:gucci': 'reject',
        },
      }),
    );
  });

  it('keeps an in-progress review card stable across pending metadata refreshes', function () {
    var version = 1;
    var submitDecision = vi.fn(function () { return Promise.resolve({ ok: true }); });
    window.__tribexAiClient = {
      submitThreadHumanInputDecision: submitDecision,
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshActiveThread: vi.fn(function () { return Promise.resolve(true); }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            pendingHumanInputs: [
              {
                id: 'human-input-stable',
                status: 'PENDING',
                renderer: 'structured_data',
                title: 'Inbox archive review',
                reviewSessionId: 'review-session-stable',
                rendererPayload: {
                  data: { title: 'Archive candidates' },
                  meta: { pollVersion: version },
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
    var firstCard = document.querySelector('.ai-codex-review-card');
    firstCard.dataset.localDecisionState = 'ray-ban-accepted';

    version = 2;
    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-review-card')).toBe(firstCard);
    expect(document.querySelector('.ai-codex-review-card').dataset.localDecisionState).toBe('ray-ban-accepted');
    expect(window.__renderers.structured_data).toHaveBeenCalledTimes(1);
  });

  it('keeps fallback review submission available for passive rich content reviews', async function () {
    var submitDecision = vi.fn(function () { return Promise.resolve({ ok: true }); });
    var refreshActiveThread = vi.fn(function () { return Promise.resolve(true); });
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
                id: 'human-input-rich',
                renderer: 'rich_content',
                title: 'Review summary',
                reviewSessionId: 'review-session-rich',
                rendererPayload: {
                  data: { title: 'Summary only', body: 'Please review this summary.' },
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

    expect(window.__renderers.rich_content).toHaveBeenCalled();
    expect(document.querySelector('.ai-codex-review-card').textContent).not.toContain('Submit reviewed decision');
    expect(document.querySelector('.ai-codex-action-dock').textContent).toContain('Submit decisions');

    var fallbackSubmit = Array.from(document.querySelectorAll('.ai-codex-action-dock button')).find(function (button) {
      return button.textContent === 'Submit decisions';
    });
    fallbackSubmit.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(submitDecision).toHaveBeenCalledWith(
      'thread-1',
      'human-input-rich',
      expect.objectContaining({
        sessionId: 'review-session-rich',
        decision: 'approved',
      }),
    );
    expect(refreshActiveThread).toHaveBeenCalled();
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

  it('renders blocking reviews after queued follow-up context', function () {
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
    expect(blockerIndex).toBeGreaterThan(queuedIndex);
    expect(document.querySelector('.ai-codex-action-dock').textContent).toContain('Review archive candidates');
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

  it('skips unchanged host renderer calls so old threads do not remount while scrolling', function () {
    var threadContext = {
      thread: baseThread({
        runs: [
          {
            id: 'run-1',
            user: { id: 'u1', role: 'user', content: 'Review the old context.' },
            answer: { id: 'a1', role: 'assistant', content: 'Historical answer.' },
          },
        ],
      }),
      loading: false,
      pending: false,
      error: null,
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () { return threadContext; }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');
    var root = document.querySelector('.ai-codex-thread');
    var timeline = document.querySelector('.ai-codex-timeline');
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 1600 });
    Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 500 });
    timeline.scrollTop = 420;
    timeline.dispatchEvent(new Event('scroll'));
    var markdownCalls = window.__companionUtils.renderMarkdown.mock.calls.length;

    renderThread('thread-1');
    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-thread')).toBe(root);
    expect(document.querySelector('.ai-codex-timeline')).toBe(timeline);
    expect(document.querySelector('.ai-codex-timeline').scrollTop).toBe(420);
    expect(window.__companionUtils.renderMarkdown.mock.calls.length).toBe(markdownCalls);
  });

  it('resets render memoization when the host switches to another thread id', function () {
    var activeThreadId = 'thread-1';
    var contexts = {
      'thread-1': {
        thread: baseThread({
          id: 'thread-1',
          title: 'First thread',
          runs: [
            {
              id: 'run-1',
              user: { id: 'u1', role: 'user', content: 'First question.' },
              answer: { id: 'a1', role: 'assistant', content: 'First answer.' },
            },
          ],
        }),
        loading: false,
        pending: false,
        error: null,
      },
      'thread-2': {
        thread: baseThread({
          id: 'thread-2',
          title: 'Second thread',
          runs: [
            {
              id: 'run-2',
              user: { id: 'u2', role: 'user', content: 'Second question.' },
              answer: { id: 'a2', role: 'assistant', content: 'Second answer.' },
            },
          ],
        }),
        loading: false,
        pending: false,
        error: null,
      },
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function (threadId) {
        return contexts[threadId || activeThreadId];
      }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');
    var firstRoot = document.querySelector('.ai-codex-thread');
    activeThreadId = 'thread-2';
    renderThread('thread-2');

    expect(document.querySelector('.ai-codex-thread')).not.toBe(firstRoot);
    expect(document.querySelector('.ai-codex-thread').textContent).toContain('Second question.');
    expect(document.querySelector('.ai-codex-thread').textContent).toContain('Second answer.');
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

  it('keeps following the bottom when timeline content grows', function () {
    var subscription = null;
    var rafCallbacks = [];
    window.requestAnimationFrame = function (callback) {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    };
    function flushNextFrame() {
      var callback = rafCallbacks.shift();
      if (callback) callback();
    }
    var threadContext = {
      thread: baseThread({
        messages: [
          { id: 'u1', role: 'user', content: 'Start work.', createdAt: '2026-04-24T18:00:00.000Z' },
          { id: 'a1', role: 'assistant', content: 'Working on it.', createdAt: '2026-04-24T18:01:00.000Z' },
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
    var initialTimeline = document.querySelector('.ai-codex-timeline');
    Object.defineProperty(initialTimeline, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(initialTimeline, 'clientHeight', { configurable: true, value: 400 });
    initialTimeline.scrollTop = 600;
    flushNextFrame();

    threadContext.thread.lastActivityAt = '2026-04-24T18:02:00.000Z';
    threadContext.thread.messages = threadContext.thread.messages.concat([
      { id: 'a2', role: 'assistant', content: 'More progress has arrived.', createdAt: '2026-04-24T18:02:00.000Z' },
    ]);
    subscription();

    flushNextFrame();
    var nextTimeline = document.querySelector('.ai-codex-timeline');
    Object.defineProperty(nextTimeline, 'scrollHeight', { configurable: true, value: 1400 });
    Object.defineProperty(nextTimeline, 'clientHeight', { configurable: true, value: 400 });
    flushNextFrame();

    expect(nextTimeline.scrollTop).toBe(1400);
  });

  it('keeps following the bottom across streamed assistant token updates', function () {
    var subscription = null;
    var rafCallbacks = [];
    window.requestAnimationFrame = function (callback) {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    };
    function flushNextFrame() {
      var callback = rafCallbacks.shift();
      if (callback) callback();
    }
    var threadContext = {
      thread: baseThread({
        messages: [
          { id: 'u1', role: 'user', content: 'Stream the answer.', createdAt: '2026-04-24T18:00:00.000Z' },
          { id: 'a1', role: 'assistant', content: 'Token 1', isStreaming: true, createdAt: '2026-04-24T18:01:00.000Z' },
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
    var initialTimeline = document.querySelector('.ai-codex-timeline');
    Object.defineProperty(initialTimeline, 'scrollHeight', { configurable: true, value: 1800 });
    Object.defineProperty(initialTimeline, 'clientHeight', { configurable: true, value: 500 });
    initialTimeline.scrollTop = 1300;
    flushNextFrame();

    for (var index = 2; index <= 4; index += 1) {
      threadContext.thread.lastActivityAt = '2026-04-24T18:0' + index + ':00.000Z';
      threadContext.thread.messages = [
        threadContext.thread.messages[0],
        Object.assign({}, threadContext.thread.messages[1], {
          content: 'Token '.repeat(index * 4).trim(),
          isStreaming: true,
          updatedAt: '2026-04-24T18:0' + index + ':00.000Z',
        }),
      ];
      subscription();
      flushNextFrame();

      var nextTimeline = document.querySelector('.ai-codex-timeline');
      Object.defineProperty(nextTimeline, 'scrollHeight', { configurable: true, value: 1800 + index * 200 });
      Object.defineProperty(nextTimeline, 'clientHeight', { configurable: true, value: 500 });
      flushNextFrame();

      expect(nextTimeline.scrollTop).toBe(nextTimeline.scrollHeight);
    }
  });

  it('preserves reading-history scroll when a new action arrives and jumps only on request', function () {
    var subscription = null;
    var rafCallbacks = [];
    window.requestAnimationFrame = function (callback) {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    };
    function flushNextFrame() {
      var callback = rafCallbacks.shift();
      if (callback) callback();
    }
    var threadContext = {
      thread: baseThread({
        runs: [
          {
            id: 'run-1',
            user: { id: 'u1', role: 'user', content: 'Review the historical context.' },
            answer: { id: 'a1', role: 'assistant', content: 'Historical answer.' },
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
    flushNextFrame();
    var initialTimeline = document.querySelector('.ai-codex-timeline');
    Object.defineProperty(initialTimeline, 'scrollHeight', { configurable: true, value: 1800 });
    Object.defineProperty(initialTimeline, 'clientHeight', { configurable: true, value: 500 });
    initialTimeline.scrollTop = 300;
    initialTimeline.dispatchEvent(new Event('scroll'));

    threadContext.thread.lastActivityAt = '2026-04-24T18:06:00.000Z';
    threadContext.thread.pendingHumanInputs = [
      {
        id: 'human-input-1',
        renderer: 'structured_data',
        title: 'Approve new action',
        reviewSessionId: 'review-session-1',
        rendererPayload: {
          data: { title: 'Action review' },
        },
      },
    ];
    subscription();
    flushNextFrame();

    var nextTimeline = document.querySelector('.ai-codex-timeline');
    Object.defineProperty(nextTimeline, 'scrollHeight', { configurable: true, value: 2200 });
    Object.defineProperty(nextTimeline, 'clientHeight', { configurable: true, value: 500 });
    var actionCard = document.querySelector('.ai-codex-review-card');
    Object.defineProperty(actionCard, 'offsetTop', { configurable: true, value: 1600 });
    flushNextFrame();

    expect(nextTimeline.scrollTop).toBe(300);
    expect(nextTimeline.getAttribute('data-scroll-mode')).toBe('reading_history');
    expect(document.querySelector('.ai-codex-action-dock').textContent).toContain('Approve new action');

    Array.from(document.querySelectorAll('.ai-codex-action-dock button')).find(function (button) {
      return button.textContent === 'Jump to action';
    }).click();

    expect(nextTimeline.scrollTop).toBe(1588);
  });

  it('suppresses markdown entry animation while assistant text is streaming', function () {
    window.__companionUtils.renderMarkdown = vi.fn(function (content) {
      var el = document.createElement('div');
      el.className = 'md-content';
      el.textContent = content || '';
      return el;
    });
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            messages: [
              { id: 'u1', role: 'user', content: 'Start streaming.', createdAt: '2026-04-24T18:00:00.000Z' },
              { id: 'a1', role: 'assistant', content: 'Streaming answer', isStreaming: true, createdAt: '2026-04-24T18:01:00.000Z' },
            ],
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-answer-copy .md-content').classList.contains('md-content-no-entry-animation')).toBe(true);
  });

  it('suppresses markdown entry animation for old answers after the first thread paint', function () {
    window.__companionUtils.renderMarkdown = vi.fn(function (content) {
      var el = document.createElement('div');
      el.className = 'md-content';
      el.textContent = content || '';
      return el;
    });
    var threadContext = {
      thread: baseThread({
        runs: [
          {
            id: 'run-1',
            user: { id: 'u1', role: 'user', content: 'Review historical context.' },
            answer: { id: 'a1', role: 'assistant', content: 'Historical answer.' },
          },
        ],
      }),
      loading: false,
      pending: false,
      error: null,
    };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () { return threadContext; }),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      refreshActiveThread: vi.fn(),
    };

    renderThread('thread-1');
    expect(document.querySelector('.ai-codex-answer-copy .md-content').classList.contains('md-content-no-entry-animation')).toBe(false);

    threadContext.thread.lastActivityAt = '2026-04-24T18:05:00.000Z';
    threadContext.thread.runs = [
      {
        id: 'run-1',
        user: { id: 'u1', role: 'user', content: 'Review historical context.' },
        answer: { id: 'a1', role: 'assistant', content: 'Historical answer with metadata refresh.' },
      },
    ];
    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-answer-copy .md-content').classList.contains('md-content-no-entry-animation')).toBe(true);
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

  it('renders generic pause task action URLs as system-browser external actions', async function () {
    var originalOpen = window.open;
    var originalTauri = window.__TAURI__;
    var invoke = vi.fn(function () { return Promise.resolve(true); });
    window.open = vi.fn(function () { return null; });
    window.__TAURI__ = { core: { invoke: invoke } };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            activePause: {
              id: 'pause-1',
              status: 'BLOCKED',
              title: 'Authenticate inbox to continue',
              detail: 'The agent needs an external sign-in step.',
              tasks: [
                {
                  title: 'Authenticate user@gmail.com',
                  detail: 'Complete Gmail sign-in.',
                  status: 'PENDING',
                  actionLabel: 'Authenticate',
                  actionUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
                },
                {
                  title: 'Ignore unsupported callback',
                  status: 'PENDING',
                  actionLabel: 'Open callback',
                  actionUrl: 'javascript:alert(1)',
                },
              ],
            },
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
      checkThreadPause: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    try {
      renderThread('thread-1');

      var card = document.querySelector('.ai-codex-pause-card');
      expect(card.textContent).toContain('Authenticate user@gmail.com');
      expect(card.textContent).not.toContain('Open callback');

      var actionButton = Array.from(card.querySelectorAll('button')).find(function (button) {
        return button.textContent === 'Authenticate';
      });
      expect(actionButton).toBeTruthy();

      actionButton.click();
      await Promise.resolve();

      expect(invoke).toHaveBeenCalledWith('open_external_url', {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
      });
      expect(window.open).not.toHaveBeenCalled();
    } finally {
      window.open = originalOpen;
      window.__TAURI__ = originalTauri;
    }
  });

  it('falls back to browser window opening when native system-browser opening fails', async function () {
    var originalOpen = window.open;
    var originalTauri = window.__TAURI__;
    var invoke = vi.fn(function () { return Promise.reject(new Error('blocked')); });
    window.open = vi.fn(function () { return null; });
    window.__TAURI__ = { core: { invoke: invoke } };
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            activePause: {
              id: 'pause-1',
              status: 'BLOCKED',
              title: 'Authenticate inbox to continue',
              tasks: [
                {
                  title: 'Authenticate user@gmail.com',
                  status: 'PENDING',
                  actionLabel: 'Authenticate',
                  actionUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
                },
              ],
            },
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
      checkThreadPause: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    try {
      renderThread('thread-1');

      var actionButton = Array.from(document.querySelectorAll('.ai-codex-pause-card button')).find(function (button) {
        return button.textContent === 'Authenticate';
      });
      expect(actionButton).toBeTruthy();

      actionButton.click();
      await new Promise(function (resolve) { setTimeout(resolve, 0); });

      expect(invoke).toHaveBeenCalledWith('open_external_url', {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
      });
      expect(window.open).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/v2/auth?state=safe',
        '_blank',
        'noopener,noreferrer'
      );
    } finally {
      window.open = originalOpen;
      window.__TAURI__ = originalTauri;
    }
  });

  it('shows delegated work pauses as agent waits instead of user waits', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            activePause: {
              id: 'pause-delegated',
              status: 'BLOCKED',
              reasonKind: 'DELEGATED_WORK',
              title: 'Waiting for 3 delegated tasks',
              detail: 'The coordinator is waiting for delegated sub-agent work to finish before continuing.',
              tasks: [
                { title: 'Sub-agent item', detail: 'Finished first inbox.', status: 'COMPLETED' },
                { title: 'Sub-agent item', detail: 'Checking the connected mailbox.', status: 'PENDING' },
              ],
            },
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
      checkThreadPause: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-status').textContent).toContain('Waiting on delegated work');
    expect(document.querySelector('.ai-codex-status').textContent).not.toContain('Waiting on you');
    expect(document.querySelector('.ai-codex-pause-card').textContent).toContain('Waiting for 3 delegated tasks');
    expect(document.querySelector('.ai-codex-blocker-badge').textContent).toBe('Waiting');
  });

  it('does not render stale delegated work cards while the coordinator is resuming', function () {
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            activePause: {
              id: 'pause-delegated',
              status: 'RESUMING',
              reasonKind: 'DELEGATED_WORK',
              title: 'Waiting for 3 delegated tasks',
              detail: 'Delegated sub-agent work is ready for the coordinator to continue.',
              tasks: [
                { title: 'Sub-agent item', detail: 'Finished first inbox.', status: 'COMPLETED' },
              ],
            },
          }),
          loading: false,
          pending: false,
          error: null,
        };
      }),
      checkThreadPause: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    renderThread('thread-1');

    expect(document.querySelector('.ai-codex-pause-card')).toBeNull();
    expect(document.body.textContent).not.toContain('Waiting for 3 delegated tasks');
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

  it('refreshes standalone pushed threads by explicit thread id', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T18:05:30.000Z'));
    var refreshThread = vi.fn(function () { return Promise.resolve(true); });
    var refreshActiveThread = vi.fn(function () { return Promise.resolve(true); });
    window.__tribexAiState = {
      subscribe: vi.fn(function () { return vi.fn(); }),
      refreshThread: refreshThread,
      refreshActiveThread: refreshActiveThread,
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      getThreadContext: vi.fn(function () {
        return {
          thread: baseThread({
            id: 'thread-standalone',
            activeTurn: {
              turnId: 'turn-stale',
              status: 'running',
              lastPresenceAt: '2026-04-24T18:04:00.000Z',
              userMessage: {
                id: 'u-stale',
                role: 'user',
                content: 'Run the inbox review.',
                createdAt: '2026-04-24T18:04:00.000Z',
              },
            },
          }),
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'stale',
        };
      }),
    };

    renderThread('thread-standalone');

    document.querySelector('.ai-codex-recovery-actions button').click();
    document.querySelector('.ai-codex-header-actions button').click();

    expect(refreshThread).toHaveBeenCalledWith('thread-standalone', true);
    expect(refreshThread).toHaveBeenCalledTimes(2);
    expect(refreshActiveThread).not.toHaveBeenCalled();
  });
});
