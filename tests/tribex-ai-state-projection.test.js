import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workflowProjectionFixtures } from './fixtures/workflow-projection-fixtures.js';
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

  it('keeps recovered turns complete when an expected tool guardrail fails', function () {
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
        turnHistoryById: {},
        turnCompletedAtById: {
          'turn-1': '2026-05-11T13:53:00.000Z',
        },
      },
      [
        {
          id: 'u1',
          role: 'user',
          content: 'Try the blocked write, then recover.',
          createdAt: '2026-05-11T13:52:35.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Blocked write reported, recovered with createIfMissing, and verified.',
          createdAt: '2026-05-11T13:53:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
          isStreaming: false,
        },
      ],
      [
        {
          id: 'activity-1',
          toolName: 'sandbox_fs_write',
          status: 'failed',
          detail: 'Cannot write guardrail.md before reading it.',
          createdAt: '2026-05-11T13:52:40.000Z',
          updatedAt: '2026-05-11T13:52:41.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        {
          id: 'activity-2',
          toolName: 'sandbox_fs_write',
          status: 'completed',
          detail: 'Created guardrail.md.',
          createdAt: '2026-05-11T13:52:42.000Z',
          updatedAt: '2026-05-11T13:52:43.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
      ]
    );

    expect(runs[0].workSession.status).toBe('completed');
    expect(runs[0].workSession.items.map(function (item) { return item.status; })).toEqual([
      'failed',
      'completed',
    ]);
  });

  it('preserves tool part order for same-timestamp review workflow activity', function () {
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
        turnHistoryById: {},
        turnCompletedAtById: {},
      },
      [
        {
          id: 'u1',
          role: 'user',
          content: 'Analyze email.',
          createdAt: '2026-04-27T18:00:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          createdAt: '2026-04-27T18:01:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
          isStreaming: false,
        },
      ],
      [
        {
          id: 'await-review',
          toolName: 'await_review',
          status: 'completed',
          createdAt: '2026-04-27T18:00:30.000Z',
          updatedAt: '2026-04-27T18:00:30.000Z',
          sortIndex: 4,
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        {
          id: 'prepare-archive',
          toolName: 'user_email_archive_review_propose',
          status: 'completed',
          createdAt: '2026-04-27T18:00:30.000Z',
          updatedAt: '2026-04-27T18:00:30.000Z',
          sortIndex: 3,
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
      ]
    );

    expect(runs[0].workSession.items.map(function (item) { return item.id; })).toEqual([
      'prepare-archive',
      'await-review',
    ]);
  });

  it('routes assistant answers around queued context run groups', function () {
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
      { turnHistoryById: {} },
      [
        {
          id: 'u1',
          role: 'user',
          content: 'Start work.',
          createdAt: '2026-04-16T10:00:00.000Z',
        },
        {
          id: 'u2',
          role: 'user',
          content: 'Queued context.',
          queued: true,
          status: 'queued',
          createdAt: '2026-04-16T10:00:01.000Z',
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Finished with queued context included.',
          createdAt: '2026-04-16T10:00:03.000Z',
        },
      ],
      []
    );

    expect(runs).toHaveLength(2);
    expect(runs[0].answer.content).toBe('Finished with queued context included.');
    expect(runs[1].user.queued).toBe(true);
    expect(runs[1].answer.content).toBe('');
  });

  it('rebuilds turn history without assigning assistant answers to queued context', function () {
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
      nowIso: function () { return '2026-04-16T10:00:04.000Z'; },
    };

    window.__createTribexAiStateProjection(context, api);

    var projection = api.buildThreadProjection({
      id: 'thread-1',
      base: {
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'Start work.',
            createdAt: '2026-04-16T10:00:00.000Z',
          },
          {
            id: 'u2',
            role: 'user',
            content: 'Queued context.',
            queued: true,
            status: 'queued',
            createdAt: '2026-04-16T10:00:01.000Z',
          },
          {
            id: 'a1',
            role: 'assistant',
            content: 'Finished with queued context included.',
            createdAt: '2026-04-16T10:00:03.000Z',
          },
        ],
      },
      turnHistoryById: {},
      turnCompletedAtById: {},
    });

    expect(projection.runs).toHaveLength(2);
    expect(projection.runs[0].answer.content).toBe('Finished with queued context included.');
    expect(projection.runs[1].user.queued).toBe(true);
    expect(projection.runs[1].answer.content).toBe('');
  });

  it('normalizes WorkflowProjection v1 into a timeline-ready view model', function () {
    var context = {
      state: {
        threadDetails: {},
        threadEntitiesById: {},
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
      nowIso: function () { return '2026-04-24T18:04:02.000Z'; },
    };

    window.__createTribexAiStateProjection(context, api);

    var raw = workflowProjectionFixtures.email_ops_happy_path;
    var normalized = api.normalizeWorkflowProjection(Object.assign({}, raw, {
      steps: [raw.steps[2], raw.steps[0], raw.steps[1]].map(function (step) {
        return Object.assign({}, step);
      }),
    }));

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      operationId: 'op-email-happy',
      workflowRef: 'email_ops_v1',
      status: 'completed',
      displayStatus: 'completed',
      heartbeat: {
        ageMs: 2000,
        stale: false,
      },
    });
    expect(normalized.timeline.steps.map(function (step) { return step.id; })).toEqual([
      'op-email-happy:email_ops_v1:accept',
      'op-email-happy:email_ops_v1:accounts',
      'op-email-happy:email_ops_v1:delegate',
    ]);
    expect(normalized.timeline.steps[2]).toMatchObject({
      kind: 'delegate',
      childRunRefs: ['subagent:gmail-primary', 'subagent:gmail-support'],
    });
  });

  it('normalizes pending approvals and review artifact links for timeline rendering', function () {
    var context = {
      state: {
        threadDetails: {},
        threadEntitiesById: {},
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
      nowIso: function () { return '2026-04-24T18:03:05.000Z'; },
    };

    window.__createTribexAiStateProjection(context, api);

    var normalized = api.normalizeWorkflowProjection(workflowProjectionFixtures.email_ops_pending_approval);
    var reviewStep = normalized.timeline.steps.find(function (step) {
      return step.id === 'op-email-pending:email_ops_v1:archive-review';
    });

    expect(normalized.status).toBe('review_needed');
    expect(reviewStep.status).toBe('review_needed');
    expect(reviewStep.approvals).toEqual([
      expect.objectContaining({
        id: 'approval:archive-review',
        status: 'pending',
        reviewSessionId: 'review-archive-pending',
      }),
    ]);
    expect(reviewStep.artifacts).toEqual([
      expect.objectContaining({
        id: 'artifact:archive-review',
        rendererArtifactKey: 'tribex-ai-result:thread-email-ops:op-email-pending:archive-review',
      }),
    ]);
  });

  it('stores the latest valid WorkflowProjection by operationId and generatedAt', function () {
    var context = {
      state: {
        threadDetails: {},
        threadEntitiesById: {},
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
      nowIso: function () { return '2026-04-24T18:04:02.000Z'; },
    };
    var record = {};

    window.__createTribexAiStateProjection(context, api);

    api.applyWorkflowProjection(record, Object.assign(
      {},
      workflowProjectionFixtures.email_ops_happy_path,
      { generatedAt: '2026-04-24T18:04:00.000Z' }
    ));
    api.applyWorkflowProjection(record, Object.assign(
      {},
      workflowProjectionFixtures.email_ops_happy_path,
      { generatedAt: '2026-04-24T18:03:00.000Z', summary: 'Older stale copy' }
    ));
    api.applyWorkflowProjection(record, Object.assign(
      {},
      workflowProjectionFixtures.email_ops_pending_approval,
      { generatedAt: '2026-04-24T18:05:00.000Z' }
    ));

    expect(record.workflowProjectionsByOperationId['op-email-happy'].summary).toBe(
      'Reviewed two inboxes, staged one draft, and archived approved messages.'
    );
    expect(record.workflowProjection).toMatchObject({
      operationId: 'op-email-pending',
      generatedAt: '2026-04-24T18:05:00.000Z',
    });
  });

  it('links repair steps to their failed parent step', function () {
    var context = {
      state: {
        threadDetails: {},
        threadEntitiesById: {},
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
      nowIso: function () { return '2026-04-24T18:06:02.000Z'; },
    };

    window.__createTribexAiStateProjection(context, api);

    var normalized = api.normalizeWorkflowProjection(workflowProjectionFixtures.email_ops_repaired_draft_validation);
    var draftStep = normalized.timeline.steps.find(function (step) {
      return step.id === 'op-email-repaired:email_ops_v1:drafts';
    });
    var repairStep = normalized.timeline.repairs[0];

    expect(repairStep).toMatchObject({
      kind: 'repair',
      repairOfStepId: 'op-email-repaired:email_ops_v1:drafts',
      repairOfTitle: 'Create user-mailbox drafts',
    });
    expect(draftStep.repairs).toEqual([
      expect.objectContaining({
        id: 'op-email-repaired:email_ops_v1:repair-drafts',
        status: 'completed',
      }),
    ]);
  });

  it('marks stale live heartbeats as degraded without discarding the projection', function () {
    var context = {
      state: {
        threadDetails: {},
        threadEntitiesById: {},
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
      nowIso: function () { return '2026-04-24T18:04:30.000Z'; },
    };

    window.__createTribexAiStateProjection(context, api);

    var normalized = api.normalizeWorkflowProjection(Object.assign(
      {},
      workflowProjectionFixtures.email_ops_pending_approval,
      { status: 'running' }
    ));

    expect(normalized.status).toBe('running');
    expect(normalized.displayStatus).toBe('degraded');
    expect(normalized.heartbeat).toMatchObject({
      ageMs: 90000,
      stale: true,
      staleAfterMs: 10000,
    });
  });

  it('keeps unknown step kinds renderable with an unknown fallback', function () {
    var context = {
      state: {
        threadDetails: {},
        threadEntitiesById: {},
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
      nowIso: function () { return '2026-04-24T18:04:02.000Z'; },
    };

    window.__createTribexAiStateProjection(context, api);

    var raw = JSON.parse(JSON.stringify(workflowProjectionFixtures.email_ops_happy_path));
    raw.steps[1].kind = 'bespoke_unmapped_kind';
    var normalized = api.normalizeWorkflowProjection(raw);

    expect(normalized.timeline.steps[1]).toMatchObject({
      kind: 'unknown',
      rawKind: 'bespoke_unmapped_kind',
    });
  });

  it('preserves runtime fallback projection when no WorkflowProjection is present', function () {
    var context = {
      state: {
        threadDetails: {},
        threadEntitiesById: {},
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
      nowIso: function () { return '2026-04-24T18:04:02.000Z'; },
    };

    window.__createTribexAiStateProjection(context, api);

    var projection = api.buildThreadProjection({
      id: 'thread-1',
      activity: {
        itemsById: {
          activity1: {
            id: 'activity1',
            toolName: 'search',
            status: 'running',
            title: 'Search',
            createdAt: '2026-04-24T18:04:00.000Z',
            updatedAt: '2026-04-24T18:04:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
        },
        order: ['activity1'],
      },
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'running',
        userMessage: {
          id: 'user-1',
          role: 'user',
          content: 'Do work',
          createdAt: '2026-04-24T18:03:59.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
      },
      turnHistoryById: {},
      turnCompletedAtById: {},
    });

    expect(projection.workflowProjection).toBeNull();
    expect(projection.workflowTimeline).toBeNull();
    expect(projection.runs[0].workSession).toMatchObject({
      status: 'running',
      items: [expect.objectContaining({ id: 'activity1' })],
    });
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

  it('inherits active turn identity for hydrated runtime snapshots without turn metadata', function () {
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
      base: { messages: [] },
      activeTurn: {
        turnId: 'turn-1',
        turnOrdinal: 1,
        status: 'finalized',
        startedAt: '2026-04-20T21:00:00.000Z',
        userMessage: {
          id: 'user-live',
          role: 'user',
          content: 'Finish smoothly',
          createdAt: '2026-04-20T21:00:00.000Z',
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
        assistantMessage: {
          id: 'assistant-live',
          role: 'assistant',
          content: 'Done.',
          createdAt: '2026-04-20T21:00:03.000Z',
          isStreaming: false,
          turnId: 'turn-1',
          turnOrdinal: 1,
        },
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
            content: 'Finish smoothly',
            createdAt: '2026-04-20T21:00:00.000Z',
          },
          {
            id: 'runtime-assistant-1',
            role: 'assistant',
            content: 'Done.',
            createdAt: '2026-04-20T21:00:03.000Z',
            isStreaming: false,
          },
        ],
      },
      turnHistoryById: {},
      turnOrder: [],
      turnCompletedAtById: {
        'turn-1': '2026-04-20T21:00:04.000Z',
      },
    };

    api.rememberTurnHistory(record);
    api.rebuildTurnHistory(record);
    var projection = api.buildThreadProjection(record);

    expect(record.runtimeSnapshot.messages[0]).toMatchObject({
      turnId: 'turn-1',
      turnOrdinal: 1,
    });
    expect(record.runtimeSnapshot.messages[1]).toMatchObject({
      turnId: 'turn-1',
      turnOrdinal: 1,
    });
    expect(projection.runs).toHaveLength(1);
    expect(projection.runs[0].id).toBe('turn-1');
    expect(projection.runs[0].answer.content).toBe('Done.');
  });

  it('keeps repeated prompt snapshots attached to their original turns', function () {
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
      base: { messages: [] },
      activeTurn: {
        turnId: 'turn-2',
        turnOrdinal: 2,
        status: 'finalized',
        startedAt: '2026-04-20T21:01:00.000Z',
        userMessage: {
          id: 'user-live-2',
          role: 'user',
          content: 'Repeat this prompt',
          createdAt: '2026-04-20T21:01:00.000Z',
          turnId: 'turn-2',
          turnOrdinal: 2,
        },
        assistantMessage: {
          id: 'assistant-live-2',
          role: 'assistant',
          content: 'Second answer.',
          createdAt: '2026-04-20T21:01:03.000Z',
          isStreaming: false,
          turnId: 'turn-2',
          turnOrdinal: 2,
        },
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
            content: 'Repeat this prompt',
            createdAt: '2026-04-20T21:00:00.000Z',
          },
          {
            id: 'runtime-assistant-1',
            role: 'assistant',
            content: 'First answer.',
            createdAt: '2026-04-20T21:00:03.000Z',
            isStreaming: false,
          },
          {
            id: 'runtime-user-2',
            role: 'user',
            content: 'Repeat this prompt',
            createdAt: '2026-04-20T21:01:00.000Z',
          },
          {
            id: 'runtime-assistant-2',
            role: 'assistant',
            content: 'Second answer.',
            createdAt: '2026-04-20T21:01:03.000Z',
            isStreaming: false,
          },
        ],
      },
      turnHistoryById: {
        'id:turn-1': {
          key: 'id:turn-1',
          turnId: 'turn-1',
          turnOrdinal: 1,
          status: 'completed',
          startedAt: '2026-04-20T21:00:00.000Z',
          endedAt: '2026-04-20T21:00:03.000Z',
          userMessage: {
            id: 'user-history-1',
            role: 'user',
            content: 'Repeat this prompt',
            createdAt: '2026-04-20T21:00:00.000Z',
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
          assistantMessage: {
            id: 'assistant-history-1',
            role: 'assistant',
            content: 'First answer.',
            createdAt: '2026-04-20T21:00:03.000Z',
            isStreaming: false,
            turnId: 'turn-1',
            turnOrdinal: 1,
          },
          activityItemsById: {},
          activityOrder: [],
          resultItemsById: {},
          resultOrder: [],
        },
      },
      turnOrder: ['id:turn-1'],
      turnCompletedAtById: {
        'turn-2': '2026-04-20T21:01:04.000Z',
      },
    };

    api.rememberTurnHistory(record);
    api.rebuildTurnHistory(record);
    var projection = api.buildThreadProjection(record);

    expect(record.runtimeSnapshot.messages[0]).toMatchObject({
      turnId: 'turn-1',
      turnOrdinal: 1,
    });
    expect(record.runtimeSnapshot.messages[1]).toMatchObject({
      turnId: 'turn-1',
      turnOrdinal: 1,
    });
    expect(record.runtimeSnapshot.messages[2]).toMatchObject({
      turnId: 'turn-2',
      turnOrdinal: 2,
    });
    expect(record.runtimeSnapshot.messages[3]).toMatchObject({
      turnId: 'turn-2',
      turnOrdinal: 2,
    });
    expect(projection.runs.map(function (run) { return [run.id, run.answer.content]; })).toEqual([
      ['turn-1', 'First answer.'],
      ['turn-2', 'Second answer.'],
    ]);
  });
});
