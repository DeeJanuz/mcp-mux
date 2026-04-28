import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var utilsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-utils.js'), 'utf8');
var reducerCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-chat-reducer.js'), 'utf8');

function loadUtils() {
  new Function(utilsCode).call(globalThis);
}

function loadReducer() {
  new Function(reducerCode).call(globalThis);
}

function derive(threadContext) {
  return window.__tribexAiChatReducer.deriveThreadViewModel(threadContext);
}

beforeEach(function () {
  delete window.__tribexAiUtils;
  delete window.__tribexAiChatReducer;
  loadUtils();
  loadReducer();
});

afterEach(function () {
  vi.useRealTimers();
});

describe('tribex-ai-chat-reducer', function () {
  it('derives running sessions from the active operation and keeps the composer in context mode', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        title: 'New Chat 3',
        activeTurn: {
          turnId: 'turn-1',
          operationId: 'op-123456',
          status: 'running',
          presenceLabel: 'Editing files',
          lastPresenceAt: new Date().toISOString(),
          userMessage: {
            id: 'user-1',
            role: 'user',
            content: 'Rewrite the AI chat.',
            createdAt: '2026-04-24T18:00:00.000Z',
          },
        },
        messages: [],
        runs: [],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('running');
    expect(viewModel.busy).toBe(true);
    expect(viewModel.composerMode).toBe('context');
    expect(viewModel.activeOperationId).toBe('op-123456');
    expect(viewModel.sessions).toHaveLength(1);
    expect(viewModel.sessions[0].user.content).toBe('Rewrite the AI chat.');
  });

  it('lets pending review inputs dominate active runtime state', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          turnId: 'turn-1',
          operationId: 'op-review',
          status: 'running',
          lastPresenceAt: new Date().toISOString(),
        },
        pendingHumanInputs: [
          { id: 'input-1', status: 'pending', renderer: 'structured_data' },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('waiting_on_review');
    expect(viewModel.statusLabel).toBe('Waiting on review');
    expect(viewModel.pendingHumanInputs).toHaveLength(1);
  });

  it('ignores connection-only runtime presence without creating a busy session', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          status: 'running',
          userMessage: null,
          assistantMessage: null,
          presencePhase: 'connecting',
          presenceLabel: 'Waiting for runtime handshake',
          lastPresenceAt: '2026-04-27T16:51:11.824Z',
        },
        messages: [],
        runs: [],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('idle');
    expect(viewModel.busy).toBe(false);
    expect(viewModel.composerMode).toBe('prompt');
    expect(viewModel.sessions).toHaveLength(0);
  });

  it('models pause continuation as waiting on the user', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activePause: {
          id: 'pause-1',
          status: 'READY',
          title: 'Ready to continue',
        },
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('waiting_on_user');
    expect(viewModel.activePause.id).toBe('pause-1');
    expect(viewModel.busy).toBe(false);
  });

  it('models delegated work pauses as active agent waits, not user waits', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activePause: {
          id: 'pause-delegated',
          status: 'BLOCKED',
          reasonKind: 'DELEGATED_WORK',
          title: 'Waiting for 3 delegated tasks',
          detail: 'The coordinator is waiting for delegated sub-agent work to finish before continuing.',
        },
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('running');
    expect(viewModel.statusLabel).toBe('Waiting on delegated work');
    expect(viewModel.busy).toBe(true);
  });

  it('progressively recovers stale running sessions from heartbeat age', function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T18:05:30.000Z'));

    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          turnId: 'turn-stale',
          operationId: 'op-stale',
          status: 'running',
          lastPresenceAt: '2026-04-24T18:04:00.000Z',
        },
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('recovering');
    expect(viewModel.statusLabel).toBe('Checking status');
    expect(viewModel.heartbeat.stale).toBe(true);
    expect(viewModel.heartbeat.recovering).toBe(true);
  });

  it('groups activity chronologically while preserving kind labels', function () {
    var groups = window.__tribexAiChatReducer.groupActivity([
      { id: 'tool-1', toolName: 'code_search', status: 'completed' },
      {
        id: 'artifact-1',
        toolName: 'rich_content',
        artifactKey: 'artifact-1',
        resultContentType: 'rich_content',
        resultData: { title: 'Plan' },
      },
      { id: 'review-1', toolName: 'approval_gate', status: 'needs_approval' },
      { id: 'sub-1', title: 'Subagent explorer', childThreadId: 'child-1' },
    ]);

    expect(groups.map(function (group) { return group.kind; })).toEqual(['tool', 'artifact', 'review', 'subagent']);
    expect(groups.find(function (group) { return group.kind === 'artifact'; }).items[0].artifactKey).toBe('artifact-1');
  });

  it('keeps ordinary non-renderer tool results out of the artifact shelf', function () {
    var emailSearch = {
      id: 'tool-email-search-1',
      toolName: 'user_email_search',
      status: 'completed',
      resultContentType: 'user_email_search',
      resultData: {
        messages: [
          { id: 'msg-1', subject: 'Receipt', from: 'store@example.com' },
        ],
      },
    };

    var groups = window.__tribexAiChatReducer.groupActivity([emailSearch]);

    expect(groups.map(function (group) { return group.kind; })).toEqual(['tool']);
    expect(window.__tribexAiChatReducer.collectArtifacts({
      activityItems: [emailSearch],
    })).toEqual([]);
  });

  it('uses activity timestamps to order groups and items from first to last action', function () {
    var groups = window.__tribexAiChatReducer.groupActivity([
      { id: 'review-1', toolName: 'approval_gate', status: 'needs_approval', createdAt: '2026-04-24T18:04:00.000Z' },
      { id: 'tool-late', toolName: 'send_email', status: 'completed', createdAt: '2026-04-24T18:03:00.000Z' },
      { id: 'sub-1', title: 'Subagent explorer', childThreadId: 'child-1', createdAt: '2026-04-24T18:02:00.000Z' },
      {
        id: 'artifact-1',
        toolName: 'rich_content',
        artifactKey: 'artifact-1',
        resultContentType: 'rich_content',
        resultData: { title: 'Plan' },
        createdAt: '2026-04-24T18:05:00.000Z',
      },
      { id: 'tool-early', toolName: 'code_search', status: 'completed', createdAt: '2026-04-24T18:01:00.000Z' },
    ]);

    expect(groups.map(function (group) { return group.kind; })).toEqual(['tool', 'subagent', 'review', 'artifact']);
    expect(groups[0].items.map(function (item) { return item.id; })).toEqual(['tool-early', 'tool-late']);
  });

  it('surfaces workflow projection steps on the active session before child threads hydrate', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          turnId: 'turn-1',
          operationId: 'op-workflow',
          status: 'running',
          lastPresenceAt: new Date().toISOString(),
          userMessage: { id: 'user-1', role: 'user', content: 'Run delegated work.' },
        },
        workflowProjection: {
          operationId: 'op-workflow',
          status: 'running',
          updatedAt: new Date().toISOString(),
          timeline: {
            steps: [
              {
                id: 'delegate-1',
                title: 'Research inbox candidates',
                status: 'running',
                childRunRefs: ['child-run-1', 'child-run-2'],
              },
              {
                id: 'review-1',
                title: 'Prepare archive review',
                status: 'running',
                kind: 'review',
              },
            ],
          },
        },
      },
      loading: false,
      pending: false,
      error: null,
    });

    var session = viewModel.sessions[0];
    expect(session.activityGroups.map(function (group) { return group.kind; })).toEqual(['subagent', 'review']);
    expect(session.activityGroups[0].items[0].detail).toBe('Waiting on 2 delegated runs.');
    expect(session.activityGroups[1].items[0].title).toBe('Prepare archive review');
  });

  it('keeps subagent dispatch and listen events out of the artifact group', function () {
    var groups = window.__tribexAiChatReducer.groupActivity([
      {
        id: 'dispatch-1',
        toolName: 'subagent_dispatch',
        status: 'completed',
        resultData: { childThreadId: 'thread-child' },
        artifactKey: 'legacy-dispatch-artifact',
      },
      {
        id: 'listen-1',
        toolName: 'subagent_listen',
        status: 'completed',
        resultData: { childThreadId: 'thread-child', status: 'completed' },
        artifactKey: 'legacy-listen-artifact',
      },
    ]);

    expect(groups.map(function (group) { return group.kind; })).toEqual(['subagent']);
    expect(groups[0].items.map(function (item) { return item.id; })).toEqual(['dispatch-1', 'listen-1']);
  });

  it('uses tool part order when review activities share a timestamp', function () {
    var groups = window.__tribexAiChatReducer.groupActivity([
      {
        id: 'await-review',
        toolName: 'await_review',
        status: 'completed',
        createdAt: '2026-04-27T18:00:00.000Z',
        sortIndex: 4,
      },
      {
        id: 'prepare-archive',
        toolName: 'user_email_archive_review_propose',
        status: 'completed',
        createdAt: '2026-04-27T18:00:00.000Z',
        sortIndex: 3,
      },
    ]);

    var reviewGroup = groups.find(function (group) { return group.kind === 'review'; });
    expect(reviewGroup.items.map(function (item) { return item.toolName; })).toEqual([
      'user_email_archive_review_propose',
      'await_review',
    ]);
  });

  it('lets completed active turns override stale running workflow projections', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          turnId: 'turn-1',
          operationId: 'op-complete',
          status: 'completed',
          presenceLabel: 'Complete',
          lastPresenceAt: new Date().toISOString(),
          userMessage: { id: 'user-1', role: 'user', content: 'Finish the run.' },
          assistantMessage: { id: 'assistant-1', role: 'assistant', content: 'Done.' },
        },
        workflowProjection: {
          operationId: 'op-complete',
          status: 'running',
          updatedAt: new Date().toISOString(),
        },
        messages: [
          { id: 'user-1', role: 'user', content: 'Finish the run.' },
          { id: 'assistant-1', role: 'assistant', content: 'Done.' },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('complete');
    expect(viewModel.statusLabel).toBe('Complete');
    expect(viewModel.busy).toBe(false);
  });

  it('settles stale running activity items when their session is complete', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        runs: [
          {
            id: 'run-1',
            status: 'completed',
            user: { id: 'user-1', role: 'user', content: 'Finish delegated work.' },
            answer: { id: 'assistant-1', role: 'assistant', content: 'Done.' },
            workSession: {
              status: 'completed',
              items: [
                {
                  id: 'subagent-1',
                  title: 'Delegated scanner',
                  childThreadId: 'child-1',
                  status: 'running',
                },
              ],
            },
          },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('complete');
    expect(viewModel.sessions[0].activityGroups[0].items[0].status).toBe('completed');
  });

  it('labels queued context messages as queued sessions', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          turnId: 'turn-active',
          operationId: 'op-active',
          status: 'running',
          userMessage: { id: 'user-active', role: 'user', content: 'Start work.' },
        },
        messages: [
          { id: 'user-active', role: 'user', content: 'Start work.' },
          {
            id: 'user-context',
            role: 'user',
            content: 'Use this context.',
            queued: true,
          },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.sessions[1]).toMatchObject({
      lifecycle: 'queued',
      user: {
        content: 'Use this context.',
        pending: true,
        queued: true,
      },
    });
  });

  it('treats user-only follow-up sessions during busy runs as queued context', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          turnId: 'turn-active',
          operationId: 'op-active',
          status: 'running',
          userMessage: { id: 'user-active', role: 'user', content: 'Start work.' },
        },
        messages: [
          { id: 'user-active', role: 'user', content: 'Start work.' },
          {
            id: 'user-context',
            role: 'user',
            content: 'Use this context.',
          },
          {
            id: 'assistant-placeholder',
            role: 'assistant',
            content: '',
          },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.sessions[1]).toMatchObject({
      lifecycle: 'queued',
      user: {
        pending: true,
        queued: true,
      },
    });
  });

  it('keeps user-only follow-up sessions queued while a review is blocking the active run', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        activeTurn: {
          turnId: 'turn-active',
          operationId: 'op-active',
          status: 'running',
          userMessage: { id: 'user-active', role: 'user', content: 'Start work.' },
        },
        pendingHumanInputs: [
          { id: 'input-1', status: 'pending', renderer: 'structured_data' },
        ],
        messages: [
          { id: 'user-active', role: 'user', content: 'Start work.' },
          {
            id: 'user-context',
            role: 'user',
            content: 'Use this context.',
          },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.lifecycle).toBe('waiting_on_review');
    expect(viewModel.sessions[1]).toMatchObject({
      lifecycle: 'queued',
      user: {
        pending: true,
        queued: true,
      },
    });
  });

  it('attaches final assistant replies to the active session instead of queued context', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        messages: [
          { id: 'user-active', role: 'user', content: 'Start work.' },
          {
            id: 'user-context',
            role: 'user',
            content: 'Use this context.',
            queued: true,
          },
          {
            id: 'assistant-final',
            role: 'assistant',
            content: 'Done with the reviewed work.',
          },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.sessions[0]).toMatchObject({
      lifecycle: 'complete',
      answer: {
        content: 'Done with the reviewed work.',
      },
    });
    expect(viewModel.sessions[1]).toMatchObject({
      lifecycle: 'queued',
      answer: null,
      user: {
        content: 'Use this context.',
        queued: true,
      },
    });
  });

  it('keeps projected queued context runs from displaying duplicated assistant answers', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        runs: [
          {
            id: 'run-1',
            user: { id: 'user-active', role: 'user', content: 'Start work.' },
            answer: { id: 'assistant-final', role: 'assistant', content: 'Done with the reviewed work.' },
          },
          {
            id: 'run-2',
            user: {
              id: 'user-context',
              role: 'user',
              content: 'Use this context.',
              queued: true,
              status: 'queued',
            },
            answer: { id: 'assistant-duplicate', role: 'assistant', content: 'Done with the reviewed work.' },
          },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.sessions[1]).toMatchObject({
      lifecycle: 'queued',
      answer: null,
      user: {
        pending: true,
        queued: true,
      },
    });
  });

  it('suppresses duplicate assistant answers on later context-like sessions even when queue metadata is missing', function () {
    var viewModel = derive({
      thread: {
        id: 'thread-1',
        runs: [
          {
            id: 'run-1',
            user: { id: 'user-active', role: 'user', content: 'Start work.' },
            answer: { id: 'assistant-final', role: 'assistant', content: 'Done with the reviewed work.' },
          },
          {
            id: 'run-2',
            user: {
              id: 'user-context',
              role: 'user',
              content: 'Use this context.',
            },
            answer: { id: 'assistant-duplicate', role: 'assistant', content: 'Done with the reviewed work.' },
          },
        ],
      },
      loading: false,
      pending: false,
      error: null,
    });

    expect(viewModel.sessions[1]).toMatchObject({
      lifecycle: 'queued',
      answer: null,
      user: {
        pending: true,
        queued: true,
      },
    });
  });

  it('reduces runtime lifecycle events around send, review, resume, recovery, and completion', function () {
    var reduce = window.__tribexAiChatReducer.reduceThreadRuntimeState;
    var state = reduce(undefined, { type: 'send', operationId: 'op-1' });
    state = reduce(state, { type: 'queued' });
    state = reduce(state, { type: 'activity_update' });
    state = reduce(state, { type: 'review_needed' });
    state = reduce(state, { type: 'resuming' });
    state = reduce(state, { type: 'timeout' });
    state = reduce(state, { type: 'turn_finish' });

    expect(state.lifecycle).toBe('complete');
    expect(state.operationId).toBe('op-1');
    expect(state.events).toHaveLength(7);
  });
});
