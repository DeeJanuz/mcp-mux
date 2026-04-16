import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var utilsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-utils.js'), 'utf8');
var threadCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-thread.js'), 'utf8');

function loadUtils() {
  new Function(utilsCode).call(globalThis);
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

beforeEach(function () {
  document.body.innerHTML = '<div id="target"></div>';

  delete window.__tribexAiUtils;
  delete window.__tribexAiState;
  window.__companionUtils = {
    selectThreadArtifact: vi.fn(),
    getActiveSession: vi.fn(function () {
      return {
        sessionId: 'thread-session-1',
        session: {
          meta: {
            threadId: 'thread-1',
          },
        },
      };
    }),
  };
  window.__renderers = {
    rich_content: vi.fn(function (container, data) {
      container.textContent = data.title;
    }),
  };

  loadUtils();
});

describe('tribex-ai-thread', function () {
  it('renders inline work sessions between prompt and answer and links thread artifact drawers', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Smoke Test',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Push a sample architecture doc', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: 'Done. I opened the result in the artifact drawer.', createdAt: '2026-04-14T20:03:00.000Z', isStreaming: false },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-14T20:00:05.000Z',
                  endedAt: '2026-04-14T20:02:19.000Z',
                  items: [
                    {
                      id: 'activity-1',
                      toolName: 'rich_content',
                      title: 'Push Content',
                      status: 'completed',
                      detail: 'Prepared the architecture document payload.',
                      createdAt: '2026-04-14T20:00:06.000Z',
                      updatedAt: '2026-04-14T20:02:19.000Z',
                      artifactKey: 'tribex-ai-result:thread-1:turn-1:tool-push-1',
                    },
                    {
                      id: 'activity-2',
                      toolName: 'catalog_publish',
                      title: 'Publish Catalog',
                      status: 'completed',
                      detail: 'Synced the latest desktop relay catalog.',
                      createdAt: '2026-04-14T20:01:00.000Z',
                      updatedAt: '2026-04-14T20:01:20.000Z',
                    },
                  ],
                },
              },
            ],
            messages: [],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: 'online',
        };
      }),
      refreshActiveThread: vi.fn(),
      selectThreadArtifact: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelector('.ai-thread-rail')).toBeNull();
    expect(document.querySelector('.ai-work-session')).not.toBeNull();
    expect(document.querySelector('.ai-work-session').open).toBe(false);
    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Worked for');
    expect(document.querySelector('.ai-run-answer').textContent).toContain('Done. I opened the result in the artifact drawer.');

    var toggle = document.querySelector('.ai-work-session');
    toggle.open = true;
    toggle.dispatchEvent(new Event('toggle'));

    expect(document.querySelector('.ai-work-item').textContent).toContain('Push Content');
    expect(document.querySelector('.ai-work-item-link')).not.toBeNull();
    document.querySelector('.ai-work-item-link').click();
    expect(window.__tribexAiState.selectThreadArtifact).toHaveBeenCalledWith(
      'thread-1',
      'tribex-ai-result:thread-1:turn-1:tool-push-1',
    );
    expect(window.__renderers.rich_content).not.toHaveBeenCalled();
  });

  it('skips the work session block when a run has no activity', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Simple Thread',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Hello there', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: 'Hi.', createdAt: '2026-04-14T20:00:01.000Z', isStreaming: false },
                workSession: null,
              },
            ],
            messages: [],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelector('.ai-work-session')).toBeNull();
    expect(document.querySelector('.ai-run-answer').textContent).toContain('Hi.');
  });

  it('updates the working elapsed label while a work session is still running', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T20:00:10.000Z'));

    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Long running thread',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Keep working', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: '', createdAt: null, isStreaming: false },
                workSession: {
                  id: 'work-1',
                  status: 'running',
                  startedAt: '2026-04-14T20:00:09.000Z',
                  endedAt: null,
                  items: [
                    {
                      id: 'activity-1',
                      toolName: 'push_content',
                      title: 'Push Content',
                      status: 'running',
                      detail: 'Preparing a result tab.',
                      createdAt: '2026-04-14T20:00:09.000Z',
                      updatedAt: '2026-04-14T20:00:09.000Z',
                    },
                  ],
                },
              },
            ],
            messages: [],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: 'online',
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Working for 1s');

    vi.setSystemTime(new Date('2026-04-14T20:00:13.000Z'));
    vi.advanceTimersByTime(1000);

    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Working for 5s');
    vi.useRealTimers();
  });

  it('renders grouped runs with inline artifacts and assistant answers beneath tasks', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Smoke Test',
            lastActivityAt: '2026-04-14T20:11:00.000Z',
            messages: [
              { id: 'u1', role: 'user', content: 'Smoke key: rule-skill-echo', createdAt: '2026-04-14T20:00:00.000Z' },
              { id: 't1', role: 'tool', toolName: 'brokered.thread.execution.started', status: 'success', summary: 'Starting hosted execution', detail: 'Submitting 270 characters to the hosted runtime.' },
              { id: 't2', role: 'tool', toolName: 'brokered.thread.execution.session.created', status: 'success', summary: 'Execution session created', detail: 'Created runtime session.' },
              {
                id: 'r1',
                role: 'tool',
                toolName: 'rich_content',
                resultData: { title: 'Smoke Test Passed', body: 'Runtime: `ai-sdk-runner`' },
                resultMeta: { status: 'passed' },
                toolArgs: { threadId: 'thread-1' },
              },
              { id: 'a1', role: 'assistant', content: 'SMOKE KEY: rule-skill-echo', createdAt: '2026-04-14T20:03:00.000Z' },
              { id: 'u2', role: 'user', content: 'Run a second check', createdAt: '2026-04-14T20:04:00.000Z' },
              { id: 't3', role: 'tool', toolName: 'brokered.thread.execution.started', status: 'success', summary: 'Starting hosted execution', detail: 'Submitting 18 characters to the hosted runtime.' },
              { id: 'a2', role: 'assistant', content: 'Second answer', createdAt: '2026-04-14T20:05:00.000Z' },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: 'online',
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelectorAll('.ai-run-group')).toHaveLength(2);
    expect(document.querySelector('.ai-activity-drawer')).toBeNull();
    expect(document.querySelectorAll('.ai-run-group-prompt .ai-chat-bubble-user')).toHaveLength(2);
    expect(document.querySelector('.ai-run-group').textContent).toContain('Smoke key: rule-skill-echo');
    expect(document.querySelector('.ai-run-artifacts .ai-artifact-card').textContent).toContain('Smoke Test Passed');
    expect(document.querySelector('.ai-run-answer').textContent).toContain('SMOKE KEY: rule-skill-echo');
    expect(window.__renderers.rich_content).toHaveBeenCalledTimes(1);
  });

  it('keeps failed tasks open and collapses completed tasks once streaming finishes', function () {
    var streaming = true;
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Failure case',
            messages: [
              { id: 'u1', role: 'user', content: 'Try the thing', createdAt: '2026-04-14T20:00:00.000Z' },
              { id: 't1', role: 'tool', toolName: 'brokered.thread.execution.session.created', status: 'success', summary: 'Execution session created', detail: 'Session ready.' },
              { id: 't2', role: 'tool', toolName: 'brokered.thread.execution.started', status: 'success', summary: 'Starting hosted execution', detail: 'Submitting prompt.' },
              { id: 'a1', role: 'assistant', content: 'Partial answer', isStreaming: streaming, createdAt: '2026-04-14T20:01:00.000Z' },
              { id: 't3', role: 'tool', toolName: 'brokered.thread.execution.failed', status: 'error', summary: 'Hosted execution failed', detail: 'Sandbox exited unexpectedly.' },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    var tasks = document.querySelectorAll('.ai-run-task');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].open).toBe(false);
    expect(tasks[1].open).toBe(true);
    expect(document.querySelector('.ai-run-answer-streaming')).not.toBeNull();

    streaming = false;
    renderThread('thread-1');

    tasks = document.querySelectorAll('.ai-run-task');
    expect(tasks[0].open).toBe(false);
    expect(tasks[1].open).toBe(true);
    expect(document.querySelector('.ai-run-answer-streaming')).toBeNull();
  });

  it('falls back to a flat transcript for legacy message ordering', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Legacy Workspace' },
          project: { name: 'Legacy Project' },
          thread: {
            id: 'thread-1',
            title: 'Legacy transcript',
            messages: [
              { id: 't0', role: 'tool', toolName: 'brokered.thread.execution.started', summary: 'Started before prompt', detail: 'Legacy history.' },
              { id: 'u1', role: 'user', content: 'Hello', createdAt: '2026-04-14T20:00:00.000Z' },
              { id: 'a1', role: 'assistant', content: 'Hi there', createdAt: '2026-04-14T20:00:01.000Z' },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: null,
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelectorAll('.ai-run-group')).toHaveLength(0);
    expect(document.querySelectorAll('.ai-chat-bubble')).toHaveLength(2);
    expect(document.querySelector('.ai-tool-note')).not.toBeNull();
  });

  it('reuses the same view shell and shows jump-to-latest when content grows off screen', function () {
    var metrics = {
      scrollHeight: 120,
      clientHeight: 80,
      scrollTop: 40,
    };
    var target = document.getElementById('target');
    Object.defineProperty(target, 'scrollHeight', {
      configurable: true,
      get: function () { return metrics.scrollHeight; },
    });
    Object.defineProperty(target, 'clientHeight', {
      configurable: true,
      get: function () { return metrics.clientHeight; },
    });
    Object.defineProperty(target, 'scrollTop', {
      configurable: true,
      get: function () { return metrics.scrollTop; },
      set: function (value) { metrics.scrollTop = value; },
    });
    target.scrollTo = vi.fn(function (options) {
      metrics.scrollTop = options.top;
    });

    var currentAnswer = 'Short answer';
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Streaming thread',
            messages: [
              { id: 'u1', role: 'user', content: 'Do work', createdAt: '2026-04-14T20:00:00.000Z' },
              { id: 't1', role: 'tool', toolName: 'brokered.thread.execution.started', status: 'success', summary: 'Starting hosted execution', detail: 'Submitting prompt.' },
              { id: 'a1', role: 'assistant', content: currentAnswer, isStreaming: true, createdAt: '2026-04-14T20:01:00.000Z' },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    var view = document.querySelector('.ai-view');
    var composer = document.querySelector('.ai-composer-shell');
    expect(document.querySelector('.ai-jump-latest').hidden).toBe(true);

    metrics.scrollTop = 0;
    metrics.scrollHeight = 220;
    currentAnswer = 'Short answer\n\nwith more streaming content';
    renderThread('thread-1');

    expect(document.querySelector('.ai-view')).toBe(view);
    expect(document.querySelector('.ai-composer-shell')).toBe(composer);
    expect(document.querySelector('.ai-jump-latest').hidden).toBe(false);
  });

  it('clears the composer and resets jump state when switching to a different thread', function () {
    var activeThreadId = 'thread-1';
    var target = document.getElementById('target');
    Object.defineProperty(target, 'scrollHeight', {
      configurable: true,
      get: function () { return 240; },
    });
    Object.defineProperty(target, 'clientHeight', {
      configurable: true,
      get: function () { return 80; },
    });
    Object.defineProperty(target, 'scrollTop', {
      configurable: true,
      get: function () { return 0; },
      set: function () {},
    });
    target.scrollTo = vi.fn();

    window.__tribexAiState = {
      getThreadContext: vi.fn(function (threadId) {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: threadId,
            title: threadId === 'thread-1' ? 'First thread' : 'Second thread',
            messages: [
              { id: 'u1', role: 'user', content: threadId === 'thread-1' ? 'First prompt' : 'Second prompt', createdAt: '2026-04-14T20:00:00.000Z' },
              { id: 'a1', role: 'assistant', content: 'Answer', createdAt: '2026-04-14T20:01:00.000Z' },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread(activeThreadId);

    document.querySelector('.ai-composer-input').value = 'leftover draft';
    document.querySelector('.ai-jump-latest').hidden = false;
    document.querySelector('.ai-jump-latest').classList.add('is-visible');

    activeThreadId = 'thread-2';
    renderThread(activeThreadId);

    expect(document.querySelector('.ai-composer-input').value).toBe('');
    expect(document.querySelector('.ai-jump-latest').hidden).toBe(true);
  });

  it('renders non-lifecycle tool events as collapsed expandable notes', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Tool event thread',
            messages: [
              { id: 'u1', role: 'user', content: 'Test', createdAt: '2026-04-15T10:40:00.000Z' },
              {
                id: 'tool-1',
                role: 'tool',
                toolName: 'rule-skill-echo',
                summary: 'Rule Skill Echo',
                detail: 'mcpviews.md\nsmoke-validation.md\nrule-skill-echo.md',
                createdAt: '2026-04-15T10:40:01.000Z',
              },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    var note = document.querySelector('.ai-tool-note');
    expect(note).not.toBeNull();
    expect(note.tagName).toBe('DETAILS');
    expect(note.open).toBe(false);
    expect(note.textContent).toContain('Rule Skill Echo');
    note.open = true;
    expect(note.textContent).toContain('smoke-validation.md');
  });

  it('collapses duplicate consecutive prompts without showing retry badges', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Duplicate prompt thread',
            messages: [
              { id: 'u1', role: 'user', content: 'Repeat me', createdAt: '2026-04-15T10:40:00.000Z' },
              { id: 'u2', role: 'user', content: 'Repeat me', createdAt: '2026-04-15T10:40:01.000Z' },
              { id: 'a1', role: 'assistant', content: 'I saw it once.', createdAt: '2026-04-15T10:40:02.000Z' },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelectorAll('.ai-run-group')).toHaveLength(1);
    expect(document.querySelectorAll('.ai-run-group-prompt .ai-chat-bubble-user')).toHaveLength(1);
    expect(document.querySelector('.ai-chat-attempt-badge')).toBeNull();
    expect(document.querySelector('.ai-chat-retry-note')).toBeNull();
    expect(document.querySelector('.ai-run-group-prompt').textContent).toContain('Repeat me');
  });

  it('dedupes adjacent identical tool notes within a run', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Repeated issue notes',
            messages: [
              { id: 'u1', role: 'user', content: 'Test', createdAt: '2026-04-15T10:40:00.000Z' },
              { id: 'tool-1', role: 'tool', toolName: 'thread.runtime.session.issued', summary: 'Issued', detail: '', createdAt: '2026-04-15T10:40:01.000Z' },
              { id: 'tool-2', role: 'tool', toolName: 'thread.runtime.session.issued', summary: 'Issued', detail: '', createdAt: '2026-04-15T10:40:02.000Z' },
              { id: 'tool-3', role: 'tool', toolName: 'thread.runtime.session.issued', summary: 'Issued', detail: '', createdAt: '2026-04-15T10:40:03.000Z' },
              { id: 'a1', role: 'assistant', content: 'Done', createdAt: '2026-04-15T10:40:04.000Z' },
            ],
          },
          loading: false,
          pending: false,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    var notes = document.querySelectorAll('.ai-tool-note');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain('Issued');
  });
});
