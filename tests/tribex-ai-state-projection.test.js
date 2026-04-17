import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadTribexAiState, loadTribexAiUtils } from './helpers/tribex-ai-state-loader.js';

describe('tribex-ai-state projection helpers', function () {
  beforeEach(function () {
    delete window.__tribexAiUtils;
    delete window.__createTribexAiStateProjection;
    delete window.__createTribexAiStateCore;
    delete window.__createTribexAiStateRuntime;
    delete window.__createTribexAiStateActions;
    delete window.__tribexAiState;
    delete window.__renderers;
    delete window.__companionUtils;

    loadTribexAiUtils();
    loadTribexAiState();
  });

  it('groups assistant answers and work-session activity by turn', function () {
    var context = {
      state: {
        threadDetails: {},
        loadingThreadIds: {},
        pendingThreadIds: {},
        threadErrors: {},
        relayStates: {},
        streamStatuses: {},
        workspacesById: {},
      },
      activeSession: null,
    };
    var api = {
      stringifyPreview: function (value) { return JSON.stringify(value); },
      parseActivityTimestamp: function (value) { return Date.parse(value); },
      mergeThreadSummary: vi.fn(),
      clone: function (value) { return JSON.parse(JSON.stringify(value)); },
      getSelectedOrganization: function () { return null; },
      getThread: function () { return null; },
      getProject: function () { return null; },
    };

    window.__createTribexAiStateProjection(context, api);

    var runs = api.buildRunGroups(
      {
        turnHistoryById: {},
        turnCompletedAtById: {
          'turn-1': '2026-04-16T10:02:00.000Z',
        },
      },
      [
        {
          id: 'u1',
          role: 'user',
          content: 'Check the drawer',
          createdAt: '2026-04-16T10:00:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Opened it.',
          createdAt: '2026-04-16T10:02:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
          isStreaming: false,
        },
      ],
      [
        {
          id: 'activity-1',
          toolName: 'push_review',
          status: 'completed',
          detail: 'Stored artifact',
          createdAt: '2026-04-16T10:01:00.000Z',
          updatedAt: '2026-04-16T10:01:30.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
      ]
    );

    expect(runs).toHaveLength(1);
    expect(runs[0].turnId).toBe('turn-1');
    expect(runs[0].answer.content).toBe('Opened it.');
    expect(runs[0].workSession.items).toHaveLength(1);
    expect(runs[0].workSession.items[0].id).toBe('activity-1');
    expect(runs[0].workSession.endedAt).toBe('2026-04-16T10:02:00.000Z');
  });

  it('builds concrete artifact records with stable session keys and preserves the current default artifact selection', function () {
    window.__renderers = {
      rich_content: function () {},
    };
    window.__companionUtils = {
      setThreadArtifactContext: vi.fn(),
      syncThreadArtifactDrawer: vi.fn(),
    };

    var context = {
      state: {
        threadDetails: {},
        loadingThreadIds: {},
        pendingThreadIds: {},
        threadErrors: {},
        relayStates: {},
        streamStatuses: {},
        workspacesById: {},
      },
      activeSession: {
        sessionId: 'session-1',
        isThread: true,
        threadId: 'thread-1',
      },
    };
    var api = {
      stringifyPreview: function (value) { return JSON.stringify(value); },
      parseActivityTimestamp: function (value) { return Date.parse(value); },
      mergeThreadSummary: vi.fn(),
      clone: function (value) { return JSON.parse(JSON.stringify(value)); },
      getSelectedOrganization: function () { return null; },
      getThread: function () { return null; },
      getProject: function () { return null; },
    };

    window.__createTribexAiStateProjection(context, api);

    var record = {
      id: 'thread-1',
      activity: {
        itemsById: {
          'artifact-1': {
            id: 'artifact-1',
            toolCallId: 'tool-1',
            toolName: 'rich_content',
            status: 'completed',
            resultData: { title: 'First artifact', body: 'One' },
            createdAt: '2026-04-16T10:00:00.000Z',
            updatedAt: '2026-04-16T10:00:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
          'artifact-2': {
            id: 'artifact-2',
            toolCallId: 'tool-2',
            toolName: 'rich_content',
            status: 'completed',
            resultData: { title: 'Second artifact', body: 'Two' },
            createdAt: '2026-04-16T10:01:00.000Z',
            updatedAt: '2026-04-16T10:01:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
        },
        order: ['artifact-1', 'artifact-2'],
      },
      artifactDrawer: {
        drawerId: 'tribex-ai-thread-artifacts:thread-1',
        selectedArtifactKey: null,
      },
      turnHistoryById: {},
      turnCompletedAtById: {},
    };

    api.syncThreadArtifactDrawer(record);

    var projection = api.buildThreadProjection(record);

    expect(window.__companionUtils.setThreadArtifactContext).not.toHaveBeenCalled();
    expect(window.__companionUtils.syncThreadArtifactDrawer).not.toHaveBeenCalled();
    expect(projection.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKey: expect.stringContaining('tool-1'),
          sessionKey: expect.stringContaining('tribex-ai-artifact:thread-1:tribex-ai-result:thread-1'),
          title: 'First artifact',
          contentType: 'rich_content',
          data: expect.objectContaining({ title: 'First artifact' }),
        }),
        expect.objectContaining({
          artifactKey: expect.stringContaining('tool-2'),
          title: 'Second artifact',
        }),
      ]),
    );
    expect(projection.artifactDrawer).toEqual(
      expect.objectContaining({
        drawerId: 'tribex-ai-thread-artifacts:thread-1',
        selectedArtifactKey: expect.stringContaining('tool-1'),
      }),
    );
  });

  it('orders user messages ahead of assistant messages within the same turn', function () {
    var context = {
      state: {
        threadDetails: {},
        loadingThreadIds: {},
        pendingThreadIds: {},
        threadErrors: {},
        relayStates: {},
        streamStatuses: {},
        workspacesById: {},
      },
      activeSession: null,
    };
    var api = {
      stringifyPreview: function (value) { return JSON.stringify(value); },
      parseActivityTimestamp: function (value) { return value ? Date.parse(value) : null; },
      mergeThreadSummary: vi.fn(),
      clone: function (value) { return JSON.parse(JSON.stringify(value)); },
      getSelectedOrganization: function () { return null; },
      getThread: function () { return null; },
      getProject: function () { return null; },
    };

    window.__createTribexAiStateProjection(context, api);

    var messages = api.buildDisplayMessages({
      runtimeSnapshot: {
        messages: [],
      },
      base: {
        messages: [],
      },
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        userMessage: {
          id: 'user-1',
          role: 'user',
          content: 'Show me the finance review table.',
          createdAt: '2026-04-16T17:38:51.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'I pushed the review table.',
          createdAt: '2026-04-16T17:38:30.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
          isStreaming: false,
        },
      },
    });

    expect(messages.map(function (message) { return message.role; })).toEqual(['user', 'assistant']);
  });
});
