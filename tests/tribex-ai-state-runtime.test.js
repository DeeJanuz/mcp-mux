import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadTribexAiState, loadTribexAiUtils } from './helpers/tribex-ai-state-loader.js';

describe('tribex-ai-state runtime helpers', function () {
  beforeEach(function () {
    delete window.__tribexAiUtils;
    delete window.__createTribexAiStateProjection;
    delete window.__createTribexAiStateCore;
    delete window.__createTribexAiStateRuntime;
    delete window.__createTribexAiStateActions;
    delete window.__tribexAiState;

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
});
