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

  it('groups assistant answers and pins work-session duration to work activity by turn', function () {
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
    expect(runs[0].workSession.endedAt).toBe('2026-04-16T10:01:30.000Z');
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
            displayMode: 'artifact',
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
            displayMode: 'artifact',
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

  it('keeps inline-display renderer activity in the run answer instead of the artifact drawer', function () {
    window.__renderers = {
      rich_content: function () {},
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

    var record = {
      id: 'thread-1',
      activity: {
        itemsById: {
          'inline-1': {
            id: 'inline-1',
            toolCallId: 'tool-1',
            toolName: 'rich_content',
            status: 'completed',
            inlineDisplay: true,
            resultData: { title: 'Inline summary', body: '- One\\n- Two' },
            createdAt: '2026-04-16T10:00:30.000Z',
            updatedAt: '2026-04-16T10:00:30.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
        },
        order: ['inline-1'],
      },
      base: {
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Summarize this',
            createdAt: '2026-04-16T10:00:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Inline below.',
            createdAt: '2026-04-16T10:01:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
        ],
      },
      artifactDrawer: {
        drawerId: 'tribex-ai-thread-artifacts:thread-1',
        selectedArtifactKey: null,
      },
      turnHistoryById: {},
      turnCompletedAtById: {},
    };

    var projection = api.buildThreadProjection(record);

    expect(projection.artifacts).toEqual([]);
    expect(projection.runs).toHaveLength(1);
    expect(projection.runs[0].workSession).toBeNull();
    expect(projection.runs[0].answer.inlineResults).toEqual([
      expect.objectContaining({
        id: 'inline-1',
        contentType: 'rich_content',
        inlineDisplay: true,
      }),
    ]);
  });

  it('includes legacy message-backed renderer artifacts in the shared artifact projection', function () {
    window.__renderers = {
      structured_data: function () {},
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

    var record = {
      id: 'thread-1',
      base: {
        messages: [
          {
            id: 'legacy-artifact-1',
            role: 'tool',
            toolName: 'structured_data',
            status: 'success',
            displayMode: 'artifact',
            artifactKey: 'tribex-ai-result:thread-1:legacy:artifact-0',
            resultContentType: 'structured_data',
            resultData: {
              title: 'Expense Review',
              tables: [{
                id: 'table-1',
                name: 'Expenses',
                rows: [],
              }],
            },
            resultMeta: {
              source: 'legacy-thread',
            },
            createdAt: '2026-04-16T10:05:00.000Z',
          },
        ],
      },
      activity: {
        itemsById: {},
        order: [],
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

    expect(projection.artifacts).toEqual([
      expect.objectContaining({
        artifactKey: 'tribex-ai-result:thread-1:legacy:artifact-0',
        sessionKey: 'tribex-ai-artifact:thread-1:tribex-ai-result:thread-1:legacy:artifact-0',
        contentType: 'structured_data',
        data: expect.objectContaining({
          title: 'Expense Review',
        }),
      }),
    ]);
    expect(projection.artifactDrawer).toEqual(
      expect.objectContaining({
        selectedArtifactKey: 'tribex-ai-result:thread-1:legacy:artifact-0',
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

  it('projects stale hydrated running work as completed when the turn is no longer active', function () {
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

    var runs = api.buildRunGroups(
      { turnHistoryById: {}, turnCompletedAtById: {} },
      [
        {
          id: 'u1',
          role: 'user',
          content: 'Run the old task',
          createdAt: '2026-04-20T10:00:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Done.',
          createdAt: '2026-04-20T12:00:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
          isStreaming: false,
        },
      ],
      [
        {
          id: 'activity-1',
          toolName: 'subagent_dispatch',
          status: 'running',
          title: 'Subagent Dispatch',
          createdAt: '2026-04-20T10:00:01.000Z',
          updatedAt: '2026-04-20T10:00:04.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
      ]
    );

    expect(runs[0].workSession).toMatchObject({
      status: 'completed',
      startedAt: '2026-04-20T10:00:01.000Z',
      endedAt: '2026-04-20T10:00:04.000Z',
    });
  });

  it('keeps active running work sessions live for the current turn', function () {
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

    var runs = api.buildRunGroups(
      {
        activeTurn: {
          turnId: 'turn-1',
          turnOrdinal: 1,
          status: 'running',
        },
        turnHistoryById: {},
        turnCompletedAtById: {},
      },
      [
        {
          id: 'u1',
          role: 'user',
          content: 'Run the live task',
          createdAt: '2026-04-20T10:00:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
      ],
      [
        {
          id: 'activity-1',
          toolName: 'subagent_dispatch',
          status: 'running',
          title: 'Subagent Dispatch',
          createdAt: '2026-04-20T10:00:01.000Z',
          updatedAt: '2026-04-20T10:00:01.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
      ]
    );

    expect(runs[0].workSession).toMatchObject({
      status: 'running',
      startedAt: '2026-04-20T10:00:01.000Z',
      endedAt: null,
    });
  });

  it('normalizes historical unknown tool parts to completed when the assistant message is final', function () {
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

    var record = {
      id: 'thread-1',
      activity: { itemsById: {}, order: [] },
      turnHistoryById: {},
      turnCompletedAtById: {},
      turnOrder: [],
      runtimeSnapshot: {
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'Run the old task',
            createdAt: '2026-04-20T10:00:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
          {
            id: 'a1',
            role: 'assistant',
            content: 'Done.',
            createdAt: '2026-04-20T12:00:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
            isStreaming: false,
          },
        ],
        rawMessages: [
          {
            id: 'u1',
            role: 'user',
            createdAt: '2026-04-20T10:00:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
            parts: [{ type: 'text', text: 'Run the old task' }],
          },
          {
            id: 'a1',
            role: 'assistant',
            createdAt: '2026-04-20T12:00:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
            parts: [
              {
                type: 'tool-subagent_dispatch',
                toolCallId: 'tool-1',
                toolName: 'subagent_dispatch',
                startedAt: '2026-04-20T10:00:03.000Z',
                input: { objective: 'short historical task' },
              },
              { type: 'text', text: 'Done.' },
            ],
          },
        ],
      },
    };

    var items = api.buildSnapshotActivityItems(record);

    expect(items[0]).toMatchObject({
      id: 'tool-1',
      status: 'completed',
      createdAt: '2026-04-20T10:00:03.000Z',
      updatedAt: '2026-04-20T10:00:03.000Z',
    });

    api.rebuildTurnHistory(record);
    var projection = api.buildThreadProjection(record);

    expect(projection.runs[0].workSession).toMatchObject({
      startedAt: '2026-04-20T10:00:03.000Z',
      endedAt: '2026-04-20T12:00:00.000Z',
    });
  });

  it('keeps persisted message timestamps when hydrated runtime snapshots omit them', function () {
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

    var record = {
      id: 'thread-1',
      base: {
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: 'Create an old artifact',
            createdAt: '2026-04-20T20:00:00.000Z',
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'Done.',
            createdAt: '2026-04-20T20:00:03.000Z',
            isStreaming: false,
          },
        ],
      },
      activity: {
        itemsById: {},
        order: [],
      },
      runtimeSnapshot: {
        messages: [
          {
            id: 'runtime-user-1',
            role: 'user',
            content: 'Create an old artifact',
            createdAt: null,
          },
          {
            id: 'runtime-assistant-1',
            role: 'assistant',
            content: 'Done.',
            createdAt: null,
            isStreaming: false,
          },
        ],
      },
      turnHistoryById: {},
      turnCompletedAtById: {},
    };

    api.rebuildTurnHistory(record);
    api.upsertActivityItem(record, {
      id: 'artifact-1',
      toolName: 'rich_content',
      status: 'completed',
      detail: 'Prepared Rich Content result.',
      createdAt: '2026-04-20T20:00:01.000Z',
      updatedAt: '2026-04-20T20:00:02.000Z',
      turnOrdinal: 1,
    });
    var projection = api.buildThreadProjection(record);

    expect(projection.runs[0].user.createdAt).toBe('2026-04-20T20:00:00.000Z');
    expect(projection.runs[0].answer.createdAt).toBe('2026-04-20T20:00:03.000Z');
    expect(projection.runs[0].workSession).toMatchObject({
      startedAt: '2026-04-20T20:00:01.000Z',
      endedAt: '2026-04-20T20:00:02.000Z',
    });
  });
});
