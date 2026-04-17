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
    renderMarkdown: vi.fn(function (content) {
      var el = document.createElement('div');
      el.className = 'md-render';
      el.innerHTML = String(content || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return el;
    }),
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
    structured_data: vi.fn(function (container, data) {
      container.textContent = (data.tables && data.tables[0] && data.tables[0].name) || 'Table';
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
      openThreadArtifact: vi.fn(),
      selectThreadArtifact: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelector('.ai-thread-rail')).toBeNull();
    expect(document.querySelector('.ai-thread-header-minimal')).not.toBeNull();
    expect(document.querySelector('.ai-thread-title-row')).toBeNull();
    expect(document.querySelector('.ai-thread-lede')).toBeNull();
    expect(document.querySelector('.ai-thread-results')).not.toBeNull();
    expect(document.querySelector('.ai-thread-results').textContent).toContain('Stored renderer outputs');
    expect(document.querySelector('.ai-thread-result-chip')).not.toBeNull();
    expect(document.querySelector('.ai-work-session')).not.toBeNull();
    expect(document.querySelector('.ai-work-session').open).toBe(false);
    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Worked for');
    expect(document.querySelector('.ai-run-answer').textContent).toContain('Done. I opened the result in the artifact drawer.');

    var toggle = document.querySelector('.ai-work-session');
    toggle.open = true;
    toggle.dispatchEvent(new Event('toggle'));
    renderThread('thread-1');
    expect(document.querySelector('.ai-work-session').open).toBe(true);

    document.querySelector('.ai-thread-result-chip').click();
    expect(window.__tribexAiState.openThreadArtifact).toHaveBeenCalledWith(
      'thread-1',
      'tribex-ai-result:thread-1:turn-1:tool-push-1',
    );

    expect(document.querySelector('.ai-work-item').textContent).toContain('Push Content');
    expect(document.querySelector('.ai-work-item-link')).not.toBeNull();
    document.querySelector('.ai-work-item-link').click();
    expect(window.__tribexAiState.openThreadArtifact).toHaveBeenCalledWith(
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

    expect(document.querySelector('.ai-thread-results').hidden).toBe(true);
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
    expect(document.querySelector('.ai-work-session').open).toBe(true);

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
    expect(document.querySelectorAll('.ai-run-group-prompt .ai-turn-prompt')).toHaveLength(2);
    expect(document.querySelector('.ai-run-group').textContent).toContain('Smoke key: rule-skill-echo');
    expect(Array.from(document.querySelectorAll('.ai-work-session .ai-work-item')).some(function (item) {
      return item.textContent.indexOf('Smoke Test Passed') >= 0;
    })).toBe(true);
    expect(document.querySelector('.ai-run-answer').textContent).toContain('SMOKE KEY: rule-skill-echo');
    expect(window.__renderers.rich_content).not.toHaveBeenCalled();
  });

  it('renders finalized assistant answers as markdown and mounts inline rich content results in the transcript', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Inline rich content',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Summarize this', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: {
                  id: 'a1',
                  content: '**Summary**\n\n- Direct\n- Short',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'inline-1',
                    toolName: 'rich_content',
                    contentType: 'rich_content',
                    resultData: {
                      title: 'Inline summary',
                      body: 'Rendered inline',
                    },
                    createdAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
                workSession: null,
              },
            ],
            artifacts: [],
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

    expect(window.__companionUtils.renderMarkdown).toHaveBeenCalledWith('**Summary**\n\n- Direct\n- Short');
    expect(document.querySelector('.ai-run-answer-body strong').textContent).toBe('Summary');
    expect(document.querySelector('.ai-inline-renderer')).not.toBeNull();
    expect(document.querySelector('.ai-inline-renderer-title').textContent).toBe('Inline summary');
    expect(window.__renderers.rich_content).toHaveBeenCalled();
  });

  it('collapses large inline structured data results by default and keeps them out of the stored results shelf', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Inline structured data',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Show the review table', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: {
                  id: 'a1',
                  content: 'Table inline below.',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'inline-table-1',
                    toolName: 'structured_data',
                    contentType: 'structured_data',
                    resultData: {
                      title: 'Large table',
                      tables: [{
                        id: 'table-1',
                        name: 'Finance Review',
                        columns: [
                          { id: 'c1', name: 'A' },
                          { id: 'c2', name: 'B' },
                          { id: 'c3', name: 'C' },
                          { id: 'c4', name: 'D' },
                          { id: 'c5', name: 'E' },
                          { id: 'c6', name: 'F' },
                          { id: 'c7', name: 'G' },
                        ],
                        rows: [
                          { id: 'r1', cells: {}, children: [] },
                          { id: 'r2', cells: {}, children: [] },
                          { id: 'r3', cells: {}, children: [] },
                          { id: 'r4', cells: {}, children: [] },
                          { id: 'r5', cells: {}, children: [] },
                          { id: 'r6', cells: {}, children: [] },
                          { id: 'r7', cells: {}, children: [] },
                          { id: 'r8', cells: {}, children: [] },
                          { id: 'r9', cells: {}, children: [] },
                          { id: 'r10', cells: {}, children: [] },
                          { id: 'r11', cells: {}, children: [] },
                        ],
                      }],
                    },
                    createdAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
                workSession: null,
              },
            ],
            artifacts: [],
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

    expect(document.querySelector('.ai-inline-renderer').open).toBe(false);
    expect(document.querySelector('.ai-inline-renderer-meta').textContent).toContain('11 rows');
    expect(document.querySelector('.ai-thread-results').hidden).toBe(true);
    expect(window.__renderers.structured_data).toHaveBeenCalled();
  });

  it('keeps a legacy work session collapsed once a streaming run finishes', function () {
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

    var workSession = document.querySelector('.ai-work-session');
    expect(workSession).not.toBeNull();
    expect(workSession.open).toBe(true);
    expect(document.querySelector('.ai-run-answer-streaming')).not.toBeNull();

    streaming = false;
    renderThread('thread-1');

    workSession = document.querySelector('.ai-work-session');
    expect(workSession.open).toBe(false);
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
    expect(document.querySelectorAll('.ai-turn-prompt')).toHaveLength(1);
    expect(document.querySelectorAll('.ai-run-answer')).toHaveLength(1);
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

  it('renders non-lifecycle tool events inside the work session log', function () {
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

    var workSession = document.querySelector('.ai-work-session');
    expect(workSession).not.toBeNull();
    expect(workSession.open).toBe(false);
    workSession.open = true;
    workSession.dispatchEvent(new Event('toggle'));
    var note = document.querySelector('.ai-work-item');
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('Rule Skill Echo');
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
    expect(document.querySelectorAll('.ai-run-group-prompt .ai-turn-prompt')).toHaveLength(1);
    expect(document.querySelector('.ai-turn-repeat')).not.toBeNull();
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

    var items = document.querySelectorAll('.ai-work-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Issued');
  });
});
