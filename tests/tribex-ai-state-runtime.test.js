import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workflowProjectionFixtures } from './fixtures/workflow-projection-fixtures.js';
import { loadTribexAiState, loadTribexAiUtils } from './helpers/tribex-ai-state-loader.js';

describe('tribex-ai-state runtime helpers', function () {
  beforeEach(function () {
    delete window.__tribexAiUtils;
    delete window.__createTribexAiStateProjection;
    delete window.__createTribexAiStateCore;
    delete window.__createTribexAiStateRuntime;
    delete window.__createTribexAiStateActions;
    delete window.__tribexAiState;
    delete window.__tribexAiClient;

    loadTribexAiUtils();
    loadTribexAiState();
  });

  it('finalizes active turns on turn_finish and clears pending state', function () {
    var detail = {
      id: 'thread-1',
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'running',
        assistantMessage: {
          id: 'assistant-1',
          content: 'Done.',
          isStreaming: true,
        },
      },
      turnCompletedAtById: {},
      lastTurnId: null,
      lastTurnOrdinal: 0,
      connection: {
        runtimeStatus: null,
        runtimeError: null,
        identity: null,
      },
    };
    var context = {
      state: {
        pendingThreadIds: { 'thread-1': true },
        threadErrors: { 'thread-1': 'stale error' },
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      rememberTurnHistory: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:02:00.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleRuntimeEvent('thread-1', {
      type: 'turn_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-16T10:02:00.000Z',
    });

    expect(detail.turnCompletedAtById['turn-1']).toBe('2026-04-16T10:02:00.000Z');
    expect(detail.lastTurnId).toBe('turn-1');
    expect(detail.lastTurnOrdinal).toBe(1);
    expect(detail.activeTurn.status).toBe('finalized');
    expect(detail.activeTurn.assistantMessage.isStreaming).toBe(false);
    expect(context.state.pendingThreadIds['thread-1']).toBeUndefined();
    expect(context.state.threadErrors['thread-1']).toBeNull();
    expect(api.rememberTurnHistory).toHaveBeenCalledWith(detail);
    expect(api.syncThreadSummaryFromRecord).toHaveBeenCalledWith(detail);
    expect(api.notify).toHaveBeenCalled();
  });

  it('finalizes the active turn when turn_finish omits a turn id', function () {
    var detail = {
      id: 'thread-1',
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'running',
        assistantMessage: {
          id: 'assistant-1',
          content: 'Done.',
          isStreaming: true,
        },
      },
      turnCompletedAtById: {},
      lastTurnId: null,
      lastTurnOrdinal: 0,
      connection: {},
    };
    var context = {
      state: {
        pendingThreadIds: { 'thread-1': true },
        pendingThreadOperations: { 'thread-1': { operationId: 'op-1' } },
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      rememberTurnHistory: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:02:00.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleRuntimeEvent('thread-1', {
      type: 'turn_finish',
      createdAt: '2026-04-16T10:02:00.000Z',
    });

    expect(detail.turnCompletedAtById['turn-1']).toBe('2026-04-16T10:02:00.000Z');
    expect(detail.activeTurn.status).toBe('finalized');
    expect(detail.activeTurn.assistantMessage.isStreaming).toBe(false);
    expect(context.state.pendingThreadIds['thread-1']).toBeUndefined();
    expect(context.state.threadErrors['thread-1']).toBeNull();
    expect(api.rememberTurnHistory).toHaveBeenCalledWith(detail);
  });

  it('keeps turn_finish busy when assistant text has not arrived yet', function () {
    var detail = {
      id: 'thread-1',
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'running',
        userMessage: { id: 'user-1', role: 'user', content: 'Summarize email' },
        assistantMessage: null,
      },
      turnCompletedAtById: {},
      lastTurnId: null,
      lastTurnOrdinal: 0,
      connection: {},
      rowState: null,
    };
    var context = {
      state: {
        pendingThreadIds: { 'thread-1': true },
        pendingThreadOperations: { 'thread-1': { operationId: 'op-1' } },
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      rememberTurnHistory: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:02:00.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleRuntimeEvent('thread-1', {
      type: 'turn_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-16T10:02:00.000Z',
    });

    expect(detail.turnCompletedAtById['turn-1']).toBeUndefined();
    expect(detail.activeTurn.status).toBe('running');
    expect(detail.activeTurn.presenceLabel).toBe('Writing response');
    expect(context.state.pendingThreadIds['thread-1']).toBe(true);
    expect(detail.rowState).toBe('pending');
    expect(api.rememberTurnHistory).toHaveBeenCalledWith(detail);
  });

  it('applies runtime presence without creating assistant prose', function () {
    var detail = {
      id: 'thread-1',
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'accepted',
        userMessage: { id: 'user-1', role: 'user', content: 'Summarize email' },
        assistantMessage: null,
        startedAt: '2026-04-16T10:00:00.000Z',
      },
      connection: {
        runtimeStatus: null,
        runtimeError: null,
        identity: null,
      },
    };
    var context = {
      state: {
        pendingThreadIds: {},
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      rememberTurnHistory: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:00:01.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleRuntimeEvent('thread-1', {
      type: 'runtime_presence',
      turnId: 'turn-1',
      phase: 'loading_context',
      label: 'Loading context',
      detail: 'Checking email tools',
      createdAt: '2026-04-16T10:00:01.000Z',
    });

    expect(detail.activeTurn.status).toBe('running');
    expect(detail.activeTurn.presenceLabel).toBe('Loading context');
    expect(detail.activeTurn.presenceDetail).toBe('Checking email tools');
    expect(detail.activeTurn.assistantMessage).toBeNull();
    expect(context.state.pendingThreadIds['thread-1']).toBe(true);
    expect(api.notify).toHaveBeenCalled();
  });

  it('renders workflow runtime presence phases as reconnect-safe status', function () {
    var detail = {
      id: 'thread-1',
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'sending',
        userMessage: { id: 'user-1', role: 'user', content: 'Run workflow' },
        assistantMessage: null,
        startedAt: '2026-04-16T10:00:00.000Z',
      },
      connection: {
        runtimeStatus: null,
        runtimeError: null,
        identity: null,
      },
    };
    var context = {
      state: {
        pendingThreadIds: {},
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      rememberTurnHistory: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:00:02.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleRuntimeEvent('thread-1', {
      type: 'runtime_presence',
      turnId: 'turn-1',
      phase: 'queued',
      label: 'Queued',
      createdAt: '2026-04-16T10:00:01.000Z',
    });
    expect(detail.activeTurn.status).toBe('queued');
    expect(detail.activeTurn.presenceLabel).toBe('Queued');

    api.handleRuntimeEvent('thread-1', {
      type: 'runtime_presence',
      turnId: 'turn-1',
      phase: 'waiting_on_agents',
      createdAt: '2026-04-16T10:00:02.000Z',
    });
    expect(detail.activeTurn.status).toBe('running');
    expect(detail.activeTurn.presenceLabel).toBe('Waiting On Agents');
    expect(context.state.pendingThreadIds['thread-1']).toBe(true);
    expect(api.notify).toHaveBeenCalled();
  });

  it('keeps assistant output completed when a late turn_error arrives', function () {
    var detail = {
      id: 'thread-1',
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'running',
        userMessage: { id: 'user-1', role: 'user', content: 'Finish' },
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Finished successfully.',
          isStreaming: true,
        },
        startedAt: '2026-04-16T10:00:00.000Z',
      },
      turnCompletedAtById: {},
      connection: {
        runtimeStatus: null,
        runtimeError: null,
        identity: null,
      },
      rowState: 'pending',
    };
    var context = {
      state: {
        pendingThreadIds: { 'thread-1': true },
        pendingThreadOperations: { 'thread-1': { operationId: 'op-1' } },
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      rememberTurnHistory: vi.fn(),
      reconcileActiveTurn: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:00:05.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleRuntimeEvent('thread-1', {
      type: 'turn_error',
      turnId: 'turn-1',
      error: 'Connection closed',
      createdAt: '2026-04-16T10:00:05.000Z',
    });

    expect(detail.activeTurn.status).toBe('finalized');
    expect(detail.activeTurn.assistantMessage.isStreaming).toBe(false);
    expect(context.state.pendingThreadIds['thread-1']).toBeUndefined();
    expect(context.state.threadErrors['thread-1']).toBeNull();
    expect(detail.rowState).toBeNull();
  });

  it('reconciles assistant_finish, turn_finish, and runtime_snapshot into one stable projected run', function () {
    var context = {
      state: {
        threadEntitiesById: {},
        threadDetails: {},
        loadingThreadIds: {},
        pendingThreadIds: { 'thread-1': true },
        threadErrors: {},
        relayStates: {},
        streamStatuses: {},
        workspacesById: {},
      },
      activeSession: null,
      runtimeEventUnsubscribers: {},
    };
    var api = {
      stringifyPreview: function (value) { return JSON.stringify(value); },
      parseActivityTimestamp: function (value) { return value ? Date.parse(value) : null; },
      mergeThreadSummary: vi.fn(function (summary) {
        context.state.threadEntitiesById[summary.id] = Object.assign(
          {},
          context.state.threadEntitiesById[summary.id] || {},
          summary,
        );
        context.state.threadDetails = context.state.threadEntitiesById;
        return context.state.threadEntitiesById[summary.id];
      }),
      clone: function (value) { return JSON.parse(JSON.stringify(value)); },
      getSelectedOrganization: function () { return null; },
      getThread: function (threadId) {
        return context.state.threadEntitiesById[threadId] || { id: threadId, title: 'Thread' };
      },
      getProject: function () { return null; },
      nowIso: function () { return '2026-04-16T10:00:05.000Z'; },
      randomId: function (prefix) { return (prefix || 'id') + '-stub'; },
      ensureThreadUi: vi.fn(),
      notify: vi.fn(),
    };
    window.__tribexAiClient = {
      normalizeRuntimeTranscript: function (threadId, runtimeMessages) {
        return {
          id: threadId,
          messagesSource: 'runtime',
          rawRuntimeMessages: runtimeMessages.messages || [],
          runtimeMessages: (runtimeMessages.messages || []).map(function (message) {
            return {
              id: message.id,
              role: message.role,
              content: (message.parts || []).map(function (part) { return part.text || ''; }).join(''),
              createdAt: message.createdAt || null,
            };
          }),
        };
      },
    };

    window.__createTribexAiStateProjection(context, api);
    window.__createTribexAiStateRuntime(context, api);

    api.handleRuntimeEvent('thread-1', {
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 1,
      message: {
        id: 'user-live',
        role: 'user',
        content: 'Finish smoothly',
        createdAt: '2026-04-16T10:00:00.000Z',
      },
      createdAt: '2026-04-16T10:00:00.000Z',
    });
    api.handleRuntimeEvent('thread-1', {
      type: 'assistant_finish',
      turnId: 'turn-1',
      message: {
        id: 'assistant-live',
        role: 'assistant',
        content: 'Done.',
        createdAt: '2026-04-16T10:00:03.000Z',
        messageId: 'assistant-live',
      },
      createdAt: '2026-04-16T10:00:03.000Z',
    });
    api.handleRuntimeEvent('thread-1', {
      type: 'turn_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-16T10:00:04.000Z',
    });
    api.handleRuntimeEvent('thread-1', {
      type: 'runtime_snapshot',
      messages: [
        {
          id: 'runtime-user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Finish smoothly' }],
          createdAt: '2026-04-16T10:00:00.000Z',
        },
        {
          id: 'runtime-assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Done.' }],
          createdAt: '2026-04-16T10:00:03.000Z',
        },
      ],
    });

    var detail = context.state.threadEntitiesById['thread-1'];
    var projection = api.buildThreadProjection(detail);

    expect(detail.activeTurn).toBeNull();
    expect(projection.runs).toHaveLength(1);
    expect(projection.runs[0].id).toBe('turn-1');
    expect(projection.runs[0].answer.content).toBe('Done.');
    expect(projection.displayMessages.filter(function (message) {
      return message.role === 'assistant' && message.content === 'Done.';
    })).toHaveLength(1);
  });

  it('does not settle an active repeated prompt from an older runtime snapshot pair', function () {
    var context = {
      state: {
        threadEntitiesById: {},
        threadDetails: {},
        loadingThreadIds: {},
        pendingThreadIds: { 'thread-1': true },
        threadErrors: {},
        relayStates: {},
        streamStatuses: {},
        workspacesById: {},
      },
      activeSession: null,
      runtimeEventUnsubscribers: {},
    };
    var api = {
      stringifyPreview: function (value) { return JSON.stringify(value); },
      parseActivityTimestamp: function (value) { return value ? Date.parse(value) : null; },
      mergeThreadSummary: vi.fn(function (summary) {
        context.state.threadEntitiesById[summary.id] = Object.assign(
          {},
          context.state.threadEntitiesById[summary.id] || {},
          summary,
        );
        context.state.threadDetails = context.state.threadEntitiesById;
        return context.state.threadEntitiesById[summary.id];
      }),
      clone: function (value) { return JSON.parse(JSON.stringify(value)); },
      getSelectedOrganization: function () { return null; },
      getThread: function (threadId) {
        return context.state.threadEntitiesById[threadId] || { id: threadId, title: 'Thread' };
      },
      getProject: function () { return null; },
      nowIso: function () { return '2026-04-16T10:01:05.000Z'; },
      randomId: function (prefix) { return (prefix || 'id') + '-stub'; },
      ensureThreadUi: vi.fn(),
      notify: vi.fn(),
    };
    window.__tribexAiClient = {
      normalizeRuntimeTranscript: function (threadId, runtimeMessages) {
        return {
          id: threadId,
          messagesSource: 'runtime',
          rawRuntimeMessages: runtimeMessages.messages || [],
          runtimeMessages: (runtimeMessages.messages || []).map(function (message) {
            return {
              id: message.id,
              role: message.role,
              content: (message.parts || []).map(function (part) { return part.text || ''; }).join(''),
              createdAt: message.createdAt || null,
            };
          }),
        };
      },
    };

    window.__createTribexAiStateProjection(context, api);
    window.__createTribexAiStateRuntime(context, api);

    api.handleRuntimeEvent('thread-1', {
      type: 'user_accepted',
      turnId: 'turn-1',
      turnOrdinal: 1,
      message: {
        id: 'user-live-1',
        role: 'user',
        content: 'Repeat this prompt',
        createdAt: '2026-04-16T10:00:00.000Z',
      },
      createdAt: '2026-04-16T10:00:00.000Z',
    });
    api.handleRuntimeEvent('thread-1', {
      type: 'assistant_finish',
      turnId: 'turn-1',
      message: {
        id: 'assistant-live-1',
        role: 'assistant',
        content: 'First answer.',
        createdAt: '2026-04-16T10:00:03.000Z',
        messageId: 'assistant-live-1',
      },
      createdAt: '2026-04-16T10:00:03.000Z',
    });
    api.handleRuntimeEvent('thread-1', {
      type: 'turn_finish',
      turnId: 'turn-1',
      createdAt: '2026-04-16T10:00:04.000Z',
    });
    api.handleRuntimeEvent('thread-1', {
      type: 'runtime_snapshot',
      messages: [
        {
          id: 'runtime-user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Repeat this prompt' }],
          createdAt: '2026-04-16T10:00:00.000Z',
        },
        {
          id: 'runtime-assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'First answer.' }],
          createdAt: '2026-04-16T10:00:03.000Z',
        },
      ],
    });

    api.handleRuntimeEvent('thread-1', {
      type: 'user_accepted',
      turnId: 'turn-2',
      turnOrdinal: 2,
      message: {
        id: 'user-live-2',
        role: 'user',
        content: 'Repeat this prompt',
        createdAt: '2026-04-16T10:01:00.000Z',
      },
      createdAt: '2026-04-16T10:01:00.000Z',
    });
    api.handleRuntimeEvent('thread-1', {
      type: 'runtime_snapshot',
      messages: [
        {
          id: 'runtime-user-1-again',
          role: 'user',
          parts: [{ type: 'text', text: 'Repeat this prompt' }],
          createdAt: '2026-04-16T10:00:00.000Z',
        },
        {
          id: 'runtime-assistant-1-again',
          role: 'assistant',
          parts: [{ type: 'text', text: 'First answer.' }],
          createdAt: '2026-04-16T10:00:03.000Z',
        },
      ],
    });

    var detail = context.state.threadEntitiesById['thread-1'];
    var projection = api.buildThreadProjection(detail);

    expect(detail.activeTurn).toMatchObject({
      turnId: 'turn-2',
      status: 'queued',
    });
    expect(detail.activeTurn.assistantMessage).toBeNull();
    expect(projection.runs.map(function (run) { return [run.id, run.answer && run.answer.content]; })).toEqual([
      ['turn-1', 'First answer.'],
      ['turn-2', ''],
    ]);
  });

  it('marks active turns failed on runtime connection errors', function () {
    var detail = {
      id: 'thread-1',
      rowState: 'pending',
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 2,
        status: 'queued',
        userMessage: {
          id: 'user-1',
          pending: true,
        },
        assistantMessage: {
          id: 'assistant-1',
          isStreaming: true,
        },
      },
      turnCompletedAtById: {},
      lastTurnId: null,
      lastTurnOrdinal: 0,
    };
    var context = {
      state: {
        threadDetails: { 'thread-1': detail },
        threadEntitiesById: { 'thread-1': detail },
        pendingThreadIds: { 'thread-1': true },
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      rememberTurnHistory: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      nowIso: function () { return '2026-04-16T10:03:00.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.failActiveTurnLocally('thread-1', 'Runtime connection timed out.');

    expect(context.state.pendingThreadIds['thread-1']).toBeUndefined();
    expect(context.state.threadErrors['thread-1']).toBe('Runtime connection timed out.');
    expect(detail.turnCompletedAtById['turn-1']).toBe('2026-04-16T10:03:00.000Z');
    expect(detail.lastTurnId).toBe('turn-1');
    expect(detail.lastTurnOrdinal).toBe(2);
    expect(detail.activeTurn.status).toBe('failed');
    expect(detail.activeTurn.userMessage.pending).toBe(false);
    expect(detail.activeTurn.assistantMessage.isStreaming).toBe(false);
    expect(detail.rowState).toBe('error');
    expect(api.rememberTurnHistory).toHaveBeenCalledWith(detail);
    expect(api.syncThreadSummaryFromRecord).toHaveBeenCalledWith(detail);
  });

  it('clears active user pending state for delegated active pauses from stream events', function () {
    var detail = {
      id: 'thread-1',
      rowState: 'pending',
      activeTurn: {
        turnId: 'turn-1',
        status: 'running',
        userMessage: {
          id: 'user-1',
          role: 'user',
          content: 'Coordinate with sub-agents',
          pending: true,
        },
      },
      connection: {},
    };
    var context = {
      state: {
        threadDetails: { 'thread-1': detail },
        threadEntitiesById: { 'thread-1': detail },
        pendingThreadIds: { 'thread-1': true },
        pendingThreadOperations: { 'thread-1': { operationId: 'op-1' } },
        threadErrors: { 'thread-1': 'stale error' },
        lastCompanionSequences: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      filterContinuedPause: function (threadId, pause) { return pause; },
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:03:00.000Z'; },
    };

    window.__tribexAiClient = {
      normalizeThreadPause: function (pause) { return pause; },
    };
    window.__createTribexAiStateRuntime(context, api);
    api.handleStreamEvent({
      threadId: 'thread-1',
      payload: {
        toolName: 'thread.pause.created',
        result: {
          data: {
            activePause: {
              id: 'pause-1',
              status: 'BLOCKED',
              reasonKind: 'DELEGATED_WORK',
              title: 'Waiting for sub-agents',
            },
          },
        },
      },
    });

    expect(detail.activePause.id).toBe('pause-1');
    expect(detail.rowState).toBe('pending');
    expect(detail.activeTurn.userMessage.pending).toBe(false);
    expect(context.state.pendingThreadIds['thread-1']).toBeUndefined();
    expect(context.state.pendingThreadOperations['thread-1']).toBeUndefined();
    expect(context.state.threadErrors['thread-1']).toBeNull();
    expect(api.notify).toHaveBeenCalled();
  });

  it('treats delegated work waiting events as active agent waits', function () {
    var detail = {
      id: 'thread-1',
      rowState: 'pending',
      activeTurn: {
        turnId: 'turn-1',
        status: 'running',
        userMessage: {
          id: 'user-1',
          role: 'user',
          content: 'Coordinate with sub-agents',
          pending: true,
        },
      },
      connection: {},
    };
    var context = {
      state: {
        threadDetails: { 'thread-1': detail },
        threadEntitiesById: { 'thread-1': detail },
        pendingThreadIds: { 'thread-1': true },
        pendingThreadOperations: { 'thread-1': { operationId: 'op-1' } },
        threadErrors: { 'thread-1': 'stale error' },
        lastCompanionSequences: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      filterContinuedPause: function (threadId, pause) { return pause; },
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:03:00.000Z'; },
    };

    window.__tribexAiClient = {
      normalizeThreadPause: function (pause) { return pause; },
    };
    window.__createTribexAiStateRuntime(context, api);
    api.handleStreamEvent({
      threadId: 'thread-1',
      payload: {
        toolName: 'thread.delegated_work.waiting',
        result: {
          data: {
            activePause: {
              id: 'pause-1',
              status: 'BLOCKED',
              reasonKind: 'DELEGATED_WORK',
              title: 'Waiting for 2 delegated tasks',
            },
          },
        },
      },
    });

    expect(detail.activePause.id).toBe('pause-1');
    expect(detail.rowState).toBe('pending');
    expect(detail.activeTurn.userMessage.pending).toBe(false);
    expect(context.state.pendingThreadIds['thread-1']).toBeUndefined();
    expect(context.state.pendingThreadOperations['thread-1']).toBeUndefined();
    expect(context.state.threadErrors['thread-1']).toBeNull();
    expect(api.notify).toHaveBeenCalled();
  });

  it('shows agent thinking when an automatic pause resume starts', function () {
    var detail = {
      id: 'thread-1',
      activePause: null,
      activeTurn: null,
      base: { messages: [] },
      connection: {},
    };
    var context = {
      state: {
        threadDetails: { 'thread-1': detail },
        threadEntitiesById: { 'thread-1': detail },
        pendingThreadIds: {},
        threadErrors: {},
        lastCompanionSequences: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var randomIds = ['resume-turn-1', 'assistant-1'];
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      filterContinuedPause: function (threadId, pause) { return pause; },
      syncThreadSummaryFromRecord: vi.fn(),
      rememberTurnHistory: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:04:00.000Z'; },
      randomId: function () { return randomIds.shift() || 'id'; },
      resolveNextTurnOrdinal: function () { return 2; },
      parseActivityTimestamp: function (value) {
        var time = Date.parse(value);
        return Number.isNaN(time) ? null : time;
      },
      containsMessage: function () { return false; },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleStreamEvent({
      threadId: 'thread-1',
      payload: {
        toolName: 'thread.pause.resuming',
        toolArgs: { threadPauseId: 'pause-1' },
        result: {
          data: {
            activePause: null,
          },
        },
      },
    });

    expect(detail.activeTurn).toMatchObject({
      turnId: 'resume-turn-1',
      status: 'running',
      presenceLabel: 'Agent thinking',
      resumePending: true,
      resumedFromPauseId: 'pause-1',
      userMessage: null,
    });
    expect(detail.activeTurn.assistantMessage).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      isStreaming: true,
    });
    expect(context.state.pendingThreadIds['thread-1']).toBe(true);
    expect(api.notify).toHaveBeenCalled();
  });

  it('creates and hydrates child thread summaries from subagent dispatch activity', function () {
    var parentDetail = {
      id: 'thread-parent',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      projectName: 'Project',
      workspaceName: 'Workspace',
      activity: {
        itemsById: {},
        order: [],
      },
    };
    var mergedSummaries = [];
    var context = {
      state: {
        pendingThreadIds: {},
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return parentDetail; },
      getStoredActivityItem: function () { return null; },
      getLatestTurnReference: function () { return {}; },
      resolveActivityDisplayMode: function () { return 'artifact'; },
      getThread: function (threadId) {
        if (threadId === 'thread-parent') return parentDetail;
        return mergedSummaries.find(function (summary) { return summary.id === threadId; }) || null;
      },
      getProject: function () {
        return {
          id: 'project-1',
          workspaceId: 'workspace-1',
          organizationId: 'org-1',
          name: 'Project',
          workspaceName: 'Workspace',
        };
      },
      upsertActivityItem: vi.fn(function (_record, item) { return item; }),
      mergeThreadSummary: vi.fn(function (summary) {
        mergedSummaries.push(summary);
        return summary;
      }),
      setProjectExpanded: vi.fn(),
      hydrateThread: vi.fn(function () { return Promise.resolve(null); }),
      isRendererBackedActivityItem: function () { return false; },
      notify: vi.fn(),
      nowIso: function () { return '2026-04-16T10:04:00.000Z'; },
    };
    window.__tribexAiClient = {
      normalizeThreadSummary: function (raw, project) {
        return {
          id: raw.id,
          title: raw.title,
          projectId: raw.projectId || project.id,
          workspaceId: raw.workspaceId || project.workspaceId,
          organizationId: raw.organizationId || project.organizationId,
        };
      },
    };

    window.__createTribexAiStateRuntime(context, api);
    api.handleRuntimeEvent('thread-parent', {
      type: 'activity_update',
      item: {
        id: 'tool-1',
        role: 'tool',
        toolName: 'subagent_dispatch',
        status: 'completed',
        rawOutput: {
          childThread: {
            id: 'thread-child',
            title: 'Finance delegate',
          },
          subAgentRun: {
            id: 'run-1',
            childThreadId: 'thread-child',
            status: 'RUNNING',
          },
        },
      },
    });

    expect(api.mergeThreadSummary).toHaveBeenCalledWith(expect.objectContaining({
      id: 'thread-child',
      title: 'Finance delegate',
      parentThreadId: 'thread-parent',
      projectId: 'project-1',
      rowState: 'syncing',
    }));
    expect(api.setProjectExpanded).toHaveBeenCalledWith('project-1', true);
    expect(api.hydrateThread).toHaveBeenCalledWith(
      'thread-child',
      expect.objectContaining({ parentThreadId: 'thread-parent' }),
    );
  });

  it('ingests WorkflowProjection payloads from runtime events and lets latest generatedAt win by operationId', function () {
    var detail = {
      id: 'thread-email-ops',
      connection: {
        runtimeStatus: null,
        runtimeError: null,
        identity: null,
      },
      activity: {
        itemsById: {},
        order: [],
      },
      turnHistoryById: {},
      turnCompletedAtById: {},
    };
    var context = {
      state: {
        pendingThreadIds: {},
        threadErrors: {},
      },
      runtimeEventUnsubscribers: {},
    };
    var api = {
      ensureThreadDetailRecord: function () { return detail; },
      normalizeWorkflowProjection: vi.fn(function (projection) {
        return Object.assign({}, projection, {
          normalized: true,
        });
      }),
      applyWorkflowProjection: vi.fn(function (record, projection) {
        var existing = record.workflowProjectionsByOperationId
          ? record.workflowProjectionsByOperationId[projection.operationId]
          : null;
        if (existing && Date.parse(existing.generatedAt) > Date.parse(projection.generatedAt)) {
          return existing;
        }
        record.workflowProjectionsByOperationId = record.workflowProjectionsByOperationId || {};
        record.workflowProjectionsByOperationId[projection.operationId] = projection;
        record.workflowProjection = projection;
        return projection;
      }),
      rememberTurnHistory: vi.fn(),
      syncThreadSummaryFromRecord: vi.fn(),
      notify: vi.fn(),
      nowIso: function () { return '2026-04-24T18:04:02.000Z'; },
    };

    window.__createTribexAiStateRuntime(context, api);

    api.handleRuntimeEvent('thread-email-ops', {
      type: 'workflow_projection',
      workflow_projection: Object.assign(
        {},
        workflowProjectionFixtures.email_ops_happy_path,
        { generatedAt: '2026-04-24T18:04:00.000Z' }
      ),
    });
    api.handleRuntimeEvent('thread-email-ops', {
      type: 'runtime_presence',
      workflowProjection: Object.assign(
        {},
        workflowProjectionFixtures.email_ops_happy_path,
        { generatedAt: '2026-04-24T18:03:00.000Z', summary: 'Older projection' }
      ),
    });

    expect(detail.workflowProjection).toMatchObject({
      operationId: 'op-email-happy',
      generatedAt: '2026-04-24T18:04:00.000Z',
    });
    expect(api.applyWorkflowProjection).toHaveBeenCalledTimes(2);
    expect(api.syncThreadSummaryFromRecord).toHaveBeenCalledWith(detail);
    expect(api.notify).toHaveBeenCalled();
  });
});
