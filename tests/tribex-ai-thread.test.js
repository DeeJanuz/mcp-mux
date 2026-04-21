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

  delete window.__MCPVIEWS_DEV__;
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

  it('only shows the raw response toggle in dev mode and swaps assistant markdown for raw text', function () {
    window.__MCPVIEWS_DEV__ = true;
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Debug Thread',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Show me the raw answer', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: '**Bold** and `inline`', createdAt: '2026-04-14T20:00:01.000Z', isStreaming: false },
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

    expect(document.querySelector('.ai-thread-dev-toggle')).not.toBeNull();
    expect(document.querySelector('.ai-run-answer .md-render strong')).not.toBeNull();
    expect(document.querySelector('.ai-run-answer .rc-raw-markdown')).toBeNull();

    document.querySelector('.ai-thread-dev-toggle').click();

    var raw = document.querySelector('.ai-run-answer .rc-raw-markdown');
    expect(raw).not.toBeNull();
    expect(raw.textContent).toContain('**Bold** and `inline`');
    expect(document.querySelector('.ai-run-answer .md-render')).toBeNull();

    renderThread('thread-1');
    expect(document.querySelector('.ai-run-answer .rc-raw-markdown')).not.toBeNull();

    document.querySelector('.ai-thread-dev-toggle').click();
    expect(document.querySelector('.ai-run-answer .md-render strong')).not.toBeNull();
  });

  it('hides the raw response toggle outside dev mode', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Normal Thread',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Hello', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: 'Hi there', createdAt: '2026-04-14T20:00:01.000Z', isStreaming: false },
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

    expect(document.querySelector('.ai-thread-dev-toggle')).toBeNull();
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
    var workSession = document.querySelector('.ai-work-session');
    expect(workSession.open).toBe(false);
    workSession.open = true;
    workSession.dispatchEvent(new Event('toggle'));
    var runGroup = document.querySelector('.ai-run-group');

    vi.setSystemTime(new Date('2026-04-14T20:00:13.000Z'));
    vi.advanceTimersByTime(1000);

    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Working for 5s');
    expect(document.querySelector('.ai-work-session').open).toBe(true);
    expect(document.querySelector('.ai-run-group')).toBe(runGroup);
    vi.useRealTimers();
  });

  it('uses the assistant answer time when a completed work session end timestamp is missing', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T20:11:01.000Z'));

    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Pinned work duration',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Do the work', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: 'Done.', createdAt: '2026-04-14T20:00:30.000Z', isStreaming: false },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-14T20:00:10.000Z',
                  endedAt: null,
                  items: [{
                    id: 'activity-1',
                    toolName: 'subagent_dispatch',
                    title: 'Subagent Dispatch',
                    status: 'completed',
                    detail: 'Finished.',
                    createdAt: '2026-04-14T20:00:10.000Z',
                    updatedAt: '2026-04-14T20:00:10.000Z',
                  }],
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
    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Worked for 20s');

    vi.setSystemTime(new Date('2026-04-14T20:12:01.000Z'));
    renderThread('thread-1');
    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Worked for 20s');
    vi.useRealTimers();
  });

  it('repairs stale completed work sessions whose end timestamp equals the start timestamp', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T13:07:43.000Z'));

    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Pinned stale work duration',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Do the work', createdAt: '2026-04-20T20:00:00.000Z' },
                answer: { id: 'a1', content: 'Done.', createdAt: '2026-04-20T20:10:00.000Z', isStreaming: false },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-20T20:00:10.000Z',
                  endedAt: '2026-04-20T20:00:10.000Z',
                  items: [{
                    id: 'activity-1',
                    toolName: 'subagent_dispatch',
                    title: 'Subagent Dispatch',
                    status: 'completed',
                    detail: 'Finished.',
                    createdAt: '2026-04-20T20:00:10.000Z',
                    updatedAt: '2026-04-20T20:00:10.000Z',
                  }],
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

    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Worked for 9m 50s');
    vi.useRealTimers();
  });

  it('uses persisted completed timestamps instead of current time for hydrated work sessions', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T13:00:00.000Z'));

    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Hydrated historical thread',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Do the old work', createdAt: '2026-04-20T20:00:00.000Z' },
                answer: { id: 'a1', content: 'Done.', createdAt: '2026-04-20T20:10:00.000Z', isStreaming: false },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-20T20:00:10.000Z',
                  endedAt: '2026-04-20T20:00:13.000Z',
                  items: [{
                    id: 'activity-1',
                    toolName: 'subagent_dispatch',
                    title: 'Subagent Dispatch',
                    status: 'completed',
                    detail: 'Finished.',
                    createdAt: '2026-04-20T20:00:10.000Z',
                    updatedAt: '2026-04-20T20:00:13.000Z',
                  }],
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

    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Worked for 3s');
    vi.useRealTimers();
  });

  it('shows a hydration pulse instead of partial thread content while loading history', function () {
    var hydrated = false;
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Hydrating thread',
            runs: hydrated ? [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Hello', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: 'Ready.', createdAt: '2026-04-14T20:00:01.000Z', isStreaming: false },
                workSession: null,
              },
            ] : [],
            artifacts: [],
            messages: [],
          },
          loading: !hydrated,
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

    expect(document.querySelector('.ai-thread-hydration').hidden).toBe(false);
    expect(document.querySelector('.ai-thread-layout').hidden).toBe(true);
    expect(document.querySelector('.ai-thread-results').hidden).toBe(true);
    expect(document.querySelector('.ai-run-answer')).toBeNull();

    hydrated = true;
    renderThread('thread-1');

    expect(document.querySelector('.ai-thread-hydration').hidden).toBe(true);
    expect(document.querySelector('.ai-thread-layout').hidden).toBe(false);
    expect(document.querySelector('.ai-run-answer').textContent).toContain('Ready.');
  });

  it('keeps existing failed work content visible while a thread refresh is loading', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Failed work refresh',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Try the task', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: { id: 'a1', content: '', createdAt: null, isStreaming: false },
                workSession: {
                  id: 'work-1',
                  status: 'failed',
                  startedAt: '2026-04-14T20:00:01.000Z',
                  endedAt: '2026-04-14T20:00:04.000Z',
                  items: [
                    {
                      id: 'activity-1',
                      toolName: 'push_content',
                      title: 'Push Content',
                      status: 'failed',
                      detail: 'Tool failed.',
                      createdAt: '2026-04-14T20:00:01.000Z',
                      updatedAt: '2026-04-14T20:00:04.000Z',
                    },
                  ],
                },
              },
            ],
            artifacts: [],
            messages: [],
          },
          loading: true,
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

    expect(document.querySelector('.ai-thread-hydration').hidden).toBe(true);
    expect(document.querySelector('.ai-thread-layout').hidden).toBe(false);
    expect(document.querySelector('.ai-work-session')).not.toBeNull();
    expect(document.querySelector('.ai-work-session-summary').textContent).toContain('Failed');
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

  it('renders inline rich content review proposals with decision controls enabled', function () {
    var submittedDecision = null;
    window.__companionUtils.submitDecision = vi.fn(function (sessionId, decision) {
      submittedDecision = { sessionId: sessionId, decision: decision };
    });
    window.__renderers.rich_content = vi.fn(function (container, data, meta, toolArgs, reviewRequired, onDecision) {
      expect(reviewRequired).toBe(true);
      expect(typeof onDecision).toBe('function');
      expect(data.title).toBe('Initiative Creation Proposal');
      expect(data.suggestions).toHaveProperty('s1');
      expect(data.tables).toHaveLength(1);

      var accept = document.createElement('button');
      accept.className = 'suggest-accept-btn';
      accept.textContent = 'Accept';
      container.appendChild(accept);

      var reject = document.createElement('button');
      reject.className = 'suggest-reject-btn';
      reject.textContent = 'Reject';
      container.appendChild(reject);

      onDecision({
        type: 'rich_content_decisions',
        suggestion_decisions: { s1: { status: 'accept', comment: null } },
        table_decisions: { proposal: { decisions: { row1: 'accept' }, modifications: {}, additions: {} } },
      });
    });

    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Inline proposal review',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Create an initiative', createdAt: '2026-04-21T20:00:00.000Z' },
                answer: {
                  id: 'a1',
                  content: 'Please review the details below.',
                  createdAt: '2026-04-21T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'inline-review-1',
                    toolName: 'rich_content',
                    contentType: 'rich_content',
                    sessionId: 'review-session-1',
                    reviewRequired: true,
                    resultMeta: {
                      reviewRequired: true,
                      reviewSessionId: 'review-session-1',
                    },
                    resultData: {
                      title: 'Initiative Creation Proposal',
                      body: 'Approve this {{suggest:id=s1}}\n\n```structured_data:proposal\n```',
                      suggestions: {
                        s1: { old: 'draft', new: 'proposal' },
                      },
                      tables: [{
                        id: 'proposal',
                        name: 'Proposed Initiative',
                        columns: [{ id: 'name', name: 'Name', change: null }],
                        rows: [{
                          id: 'row1',
                          cells: { name: { value: 'Test Initiative', change: 'add' } },
                          children: [],
                        }],
                      }],
                    },
                    createdAt: '2026-04-21T20:00:04.000Z',
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

    expect(document.querySelector('.suggest-accept-btn')).not.toBeNull();
    expect(document.querySelector('.suggest-reject-btn')).not.toBeNull();
    expect(window.__companionUtils.submitDecision).toHaveBeenCalledWith(
      'review-session-1',
      expect.objectContaining({ type: 'rich_content_decisions' }),
    );
    expect(submittedDecision.decision.suggestion_decisions.s1.status).toBe('accept');
  });

  it('renders streaming assistant answers through the markdown path', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Streaming markdown',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Stream a list', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: {
                  id: 'a1',
                  content: '**Summary**\n\n- First item',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: true,
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

    expect(window.__companionUtils.renderMarkdown).toHaveBeenCalledWith('**Summary**\n\n- First item');
    expect(document.querySelector('.ai-run-answer-streaming .md-render strong').textContent).toBe('Summary');
    expect(document.querySelector('.ai-run-answer-streaming .rc-raw-markdown')).toBeNull();
  });

  it('keeps completed work sessions visible and collapsed directly above the summary and inline result', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Completed work session',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Show the plan', createdAt: '2026-04-14T20:00:00.000Z' },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-14T20:00:01.000Z',
                  endedAt: '2026-04-14T20:00:04.000Z',
                  items: [{
                    id: 'activity-1',
                    toolName: 'rich_content',
                    title: 'Prepared the diagram',
                    status: 'completed',
                    detail: 'Built the renderer payload and finalized it for the turn.',
                    createdAt: '2026-04-14T20:00:01.000Z',
                    updatedAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
                answer: {
                  id: 'a1',
                  content: 'Here is the summary.',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'inline-1',
                    artifactKey: 'artifact-inline-1',
                    toolName: 'rich_content',
                    contentType: 'rich_content',
                    inlineDisplay: true,
                    resultData: {
                      title: 'Operational plan',
                      body: 'Rendered inline',
                    },
                    createdAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
              },
            ],
            artifacts: [{
              artifactKey: 'artifact-inline-1',
              title: 'Operational plan',
              contentType: 'rich_content',
              updatedAt: '2026-04-14T20:00:04.000Z',
            }],
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

    var surface = document.querySelector('.ai-run-group-surface');
    var children = Array.from(surface.children);
    expect(children[0].classList.contains('ai-work-session')).toBe(true);
    expect(children[1].classList.contains('ai-run-answer')).toBe(true);
    expect(children[2].classList.contains('ai-inline-renderer')).toBe(true);
    expect(children[0].open).toBe(false);
    expect(children[0].textContent).toContain('Worked for 3s');
    expect(document.querySelector('.ai-thread-results').hidden).toBe(true);
  });

  it('hydrates mermaid blocks inside finalized assistant summaries', function () {
    var renderMermaidBlocks = vi.fn(function (container) {
      container.setAttribute('data-mermaid-hydrated', 'true');
    });
    window.__companionUtils.renderMarkdown = vi.fn(function () {
      var el = document.createElement('div');
      el.className = 'md-render';
      var placeholder = document.createElement('div');
      placeholder.className = 'mermaid-placeholder';
      el.appendChild(placeholder);
      return el;
    });
    window.__companionUtils.renderMermaidBlocks = renderMermaidBlocks;

    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Mermaid Thread',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Share a diagram', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: {
                  id: 'a1',
                  content: '```mermaid\ngraph TD;\nA-->B;\n```',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [],
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

    expect(renderMermaidBlocks).toHaveBeenCalled();
    expect(document.querySelector('.ai-run-answer .md-render').getAttribute('data-mermaid-hydrated')).toBe('true');
  });

  it('keeps inline renderers visible even when the thread also has reopenable stored results', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Inline And Stored',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Show me the architecture', createdAt: '2026-04-14T20:00:00.000Z' },
                answer: {
                  id: 'a1',
                  content: 'Inline below.',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'inline-1',
                    artifactKey: 'artifact-1',
                    toolName: 'rich_content',
                    contentType: 'rich_content',
                    inlineDisplay: true,
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
            artifacts: [{
              artifactKey: 'artifact-1',
              title: 'Inline summary',
              summary: 'Stored copy',
              contentType: 'rich_content',
              sessionId: 'result-session-1',
            }],
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

    expect(document.querySelector('.ai-inline-renderer')).not.toBeNull();
    expect(document.querySelector('.ai-thread-results').hidden).toBe(true);
    expect(document.querySelector('.ai-thread-result-chip')).toBeNull();
  });

  it('keeps only non-inline artifacts in the stored results shelf', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Mixed artifacts',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Show me the architecture', createdAt: '2026-04-14T20:00:00.000Z' },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-14T20:00:01.000Z',
                  endedAt: '2026-04-14T20:00:04.000Z',
                  items: [{
                    id: 'activity-1',
                    toolName: 'push_review',
                    title: 'Prepared review packet',
                    status: 'completed',
                    detail: 'Stored an approval packet in the drawer.',
                    createdAt: '2026-04-14T20:00:02.000Z',
                    updatedAt: '2026-04-14T20:00:04.000Z',
                    artifactKey: 'artifact-review',
                  }],
                },
                answer: {
                  id: 'a1',
                  content: 'Inline below, plus a separate approval packet.',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'inline-1',
                    artifactKey: 'artifact-inline',
                    toolName: 'rich_content',
                    contentType: 'rich_content',
                    inlineDisplay: true,
                    resultData: {
                      title: 'Inline summary',
                      body: 'Rendered inline',
                    },
                    createdAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
              },
            ],
            artifacts: [
              {
                artifactKey: 'artifact-inline',
                title: 'Inline summary',
                contentType: 'rich_content',
                updatedAt: '2026-04-14T20:00:04.000Z',
              },
              {
                artifactKey: 'artifact-review',
                title: 'Approval packet',
                contentType: 'structured_data',
                updatedAt: '2026-04-14T20:00:05.000Z',
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

    expect(document.querySelector('.ai-work-session')).not.toBeNull();
    expect(document.querySelector('.ai-work-session').open).toBe(false);
    expect(document.querySelector('.ai-inline-renderer')).not.toBeNull();
    expect(document.querySelector('.ai-thread-results').hidden).toBe(false);
    expect(document.querySelectorAll('.ai-thread-result-chip')).toHaveLength(1);
    expect(document.querySelector('.ai-thread-result-chip').textContent).toContain('Approval packet');
  });

  it('hides metadata-only stored artifacts after rehydration when the same result is already inline', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Rehydrated inline result',
            runs: [
              {
                id: 'run-1',
                turnId: 'turn-2',
                user: { id: 'u1', role: 'user', content: 'Show me the diagram', createdAt: '2026-04-14T20:00:00.000Z' },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-14T20:00:01.000Z',
                  endedAt: '2026-04-14T20:00:04.000Z',
                  items: [{
                    id: 'tool-push-1',
                    toolCallId: 'tool-push-1',
                    turnId: 'turn-2',
                    toolName: 'rich_content',
                    title: 'Rendered diagram',
                    status: 'completed',
                    detail: 'Prepared inline result.',
                    createdAt: '2026-04-14T20:00:01.000Z',
                    updatedAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
                answer: {
                  id: 'a1',
                  content: 'Diagram below.',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'tool-push-1',
                    toolCallId: 'tool-push-1',
                    turnId: 'turn-2',
                    toolName: 'rich_content',
                    contentType: 'rich_content',
                    inlineDisplay: true,
                    resultData: {
                      title: 'Resource Allocation Strategy: Woodchuck Operations',
                      body: '### Operational transition diagram...',
                    },
                    resultMeta: {
                      headerTitle: 'Resource Allocation Strategy: Woodchuck Operations',
                      activityId: 'tool-push-1',
                      turnId: 'turn-2',
                    },
                    createdAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
              },
            ],
            artifacts: [{
              artifactKey: 'tribex-ai-result:thread-1:turn-2:artifact-legacy',
              title: 'Resource Allocation Strategy: Woodchuck Operations',
              contentType: 'rich_content',
              meta: {
                headerTitle: 'Resource Allocation Strategy: Woodchuck Operations',
                activityId: 'tool-push-1',
                turnId: 'turn-2',
              },
              updatedAt: '2026-04-14T20:00:05.000Z',
            }],
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

    expect(document.querySelector('.ai-inline-renderer')).not.toBeNull();
    expect(document.querySelector('.ai-thread-results').hidden).toBe(true);
    expect(document.querySelector('.ai-thread-result-chip')).toBeNull();
  });

  it('hides title-only stored artifacts after rehydration when the same inline result is already visible', function () {
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Minimal artifact rehydration',
            runs: [
              {
                id: 'run-1',
                user: { id: 'u1', role: 'user', content: 'Show me the diagram', createdAt: '2026-04-14T20:00:00.000Z' },
                workSession: {
                  id: 'work-1',
                  status: 'completed',
                  startedAt: '2026-04-14T20:00:01.000Z',
                  endedAt: '2026-04-14T20:00:04.000Z',
                  items: [],
                },
                answer: {
                  id: 'a1',
                  content: 'Diagram below.',
                  createdAt: '2026-04-14T20:00:05.000Z',
                  isStreaming: false,
                  inlineResults: [{
                    id: 'tool-push-1',
                    toolName: 'rich_content',
                    contentType: 'rich_content',
                    inlineDisplay: true,
                    resultData: {
                      title: 'Resource Allocation Strategy: Woodchuck Operations',
                      body: '### Operational transition diagram...',
                    },
                    createdAt: '2026-04-14T20:00:04.000Z',
                  }],
                },
              },
            ],
            artifacts: [{
              artifactKey: 'tribex-ai-result:thread-1:rehydrated-only',
              title: 'Resource Allocation Strategy: Woodchuck Operations',
              contentType: 'rich_content',
              updatedAt: '2026-04-14T20:00:05.000Z',
            }],
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

    expect(document.querySelector('.ai-inline-renderer')).not.toBeNull();
    expect(document.querySelector('.ai-thread-results').hidden).toBe(true);
    expect(document.querySelector('.ai-thread-result-chip')).toBeNull();
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
    expect(workSession.open).toBe(false);
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

  it('keeps the composer visible and shows a floating interrupt pill while the turn is active', async function () {
    var interruptThread = vi.fn(function () { return Promise.resolve(true); });
    window.__tribexAiState = {
      getThreadContext: vi.fn(function () {
        return {
          organization: { name: 'Daenon Test' },
          workspace: { name: 'Smoke Workspace' },
          project: { name: 'Smoke Project' },
          thread: {
            id: 'thread-1',
            title: 'Active thread',
            activeTurn: {
              status: 'running',
            },
            messages: [
              { id: 'u1', role: 'user', content: 'Keep working', createdAt: '2026-04-14T20:00:00.000Z' },
            ],
          },
          loading: false,
          pending: true,
          error: null,
          streamStatus: 'connected',
          relayStatus: null,
        };
      }),
      refreshActiveThread: vi.fn(),
      submitPrompt: vi.fn(function () { return Promise.resolve(true); }),
      interruptThread: interruptThread,
    };

    loadThread();
    renderThread('thread-1');

    expect(document.querySelector('.ai-view').classList.contains('ai-thread-turn-busy')).toBe(true);
    expect(document.querySelector('.ai-composer-shell').classList.contains('is-context-mode')).toBe(true);
    expect(document.querySelector('.ai-composer-input').disabled).toBe(false);
    expect(document.querySelector('.ai-primary-btn').disabled).toBe(false);
    expect(document.querySelector('.ai-primary-btn').textContent).toBe('Add context');
    expect(document.querySelector('.ai-composer-hint').textContent).toContain('added to the chat context');
    expect(document.querySelector('.ai-interrupt-turn-dock').hidden).toBe(false);
    expect(document.querySelector('.ai-composer-shell > .ai-interrupt-turn-dock')).not.toBeNull();
    expect(document.querySelector('.ai-thread-layout > .ai-interrupt-turn-dock')).toBeNull();
    expect(document.querySelector('.ai-interrupt-turn').hidden).toBe(false);
    expect(document.querySelector('.ai-interrupt-turn').textContent).toBe('Interrupt Agent');

    document.querySelector('.ai-interrupt-turn').click();
    await Promise.resolve();

    expect(interruptThread).toHaveBeenCalledWith('thread-1');
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
