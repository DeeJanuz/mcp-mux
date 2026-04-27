import { afterEach, describe, expect, it, vi } from 'vitest';

import { createThreadDebugHarness, baseThread } from './helpers/tribex-ai-thread-debug-harness.js';

function traceSummary(trace) {
  return trace.map(function (entry) {
    return {
      label: entry.label,
      lifecycle: entry.lifecycle,
      hasReviewEditor: !!entry.reviewEditor,
      reviewValue: entry.reviewValue,
      markdownCalls: entry.markdownCalls,
      structuredRenderCalls: entry.structuredRenderCalls,
    };
  });
}

afterEach(function () {
  vi.useRealTimers();
});

describe('tribex-ai-thread automated UI debug loop', function () {
  it('records runtime churn, delegated work, review editing, and submission without destructive rerenders', async function () {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T21:00:00.000Z'));

    var harness = createThreadDebugHarness({
      thread: baseThread({
        activeTurn: {
          turnId: 'turn-debug',
          operationId: 'operation-debug',
          status: 'running',
          presenceLabel: 'Accepted by runtime',
          lastPresenceAt: '2026-04-26T21:00:00.000Z',
          userMessage: {
            id: 'user-debug',
            role: 'user',
            content: 'Summarize inboxes and propose archive candidates.',
            createdAt: '2026-04-26T21:00:00.000Z',
          },
        },
      }),
    });

    harness.render();
    harness.record('initial running');
    var initialRoot = harness.getRoot();
    var initialMarkdownCalls = harness.markdownCalls;

    for (var index = 0; index < 10; index += 1) {
      harness.notify('presence noise ' + index, function (thread) {
        thread.lastHydratedAt = new Date(1777237200000 + index).toISOString();
        thread.runtimeSnapshot = {
          messages: [{ id: 'runtime-message-' + index }],
        };
      });
      expect(harness.getRoot()).toBe(initialRoot);
    }
    expect(harness.markdownCalls).toBe(initialMarkdownCalls);

    harness.notify('workflow projection arrives', function (thread) {
      thread.workflowProjection = {
        operationId: 'operation-debug',
        status: 'running',
        updatedAt: '2026-04-26T21:00:04.000Z',
        timeline: {
          steps: [
            {
              id: 'delegate-step',
              title: 'Run delegated inbox scanners',
              status: 'running',
              childRunRefs: ['child-run-a', 'child-run-b'],
            },
            {
              id: 'review-step',
              title: 'Prepare archive review payload',
              status: 'running',
              kind: 'review',
            },
          ],
        },
      };
    });
    expect(harness.getRoot()).not.toBe(initialRoot);
    expect(document.querySelector('.ai-codex-activity-group-subagent').textContent).toContain('Run delegated inbox scanners');
    expect(document.querySelector('.ai-codex-activity-group-review').textContent).toContain('Prepare archive review payload');

    harness.notify('review payload ready', function (thread) {
      thread.pendingHumanInputs = [
        {
          id: 'human-input-debug',
          renderer: 'structured_data',
          title: 'Review archive candidates',
          reviewSessionId: 'review-session-debug',
          rendererPayload: {
            data: {
              title: 'Archive candidates',
              value: 'original review value',
            },
            meta: {},
            toolArgs: {},
          },
        },
      ];
    });
    var reviewEditor = harness.getReviewEditor();
    expect(reviewEditor).not.toBeNull();
    expect(reviewEditor.value).toBe('original review value');
    reviewEditor.value = 'user edited review value';

    var rootAfterReview = harness.getRoot();
    var structuredRenderCallsAfterReview = harness.structuredRenderCalls;
    for (var churnIndex = 0; churnIndex < 6; churnIndex += 1) {
      harness.notify('post-review churn ' + churnIndex, function (thread) {
        thread.activeTurn.presenceLabel = churnIndex % 2 === 0
          ? 'Preparing review'
          : 'Checking status';
        thread.activeTurn.lastPresenceAt = new Date(1777237205000 + churnIndex).toISOString();
        thread.lastHydratedAt = new Date(1777237210000 + churnIndex).toISOString();
      });
      expect(harness.getReviewEditor()).toBe(reviewEditor);
      expect(harness.getReviewEditor().value).toBe('user edited review value');
    }
    expect(harness.getRoot()).toBe(rootAfterReview);
    expect(harness.structuredRenderCalls).toBe(structuredRenderCallsAfterReview);

    document.querySelector('.debug-review-submit').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(window.__tribexAiClient.submitThreadHumanInputDecision).toHaveBeenCalledWith(
      'thread-debug',
      'human-input-debug',
      expect.objectContaining({
        sessionId: 'review-session-debug',
        decision: 'approved',
        modifications: {
          value: 'user edited review value',
        },
      }),
    );
    expect(window.__tribexAiState.refreshActiveThread).toHaveBeenCalledTimes(1);

    var summary = traceSummary(harness.trace);
    if (process.env.DEBUG_TRIBEX_THREAD_LOOP === '1') {
      console.info('[tribex-ai-thread-debug-loop]', JSON.stringify(summary, null, 2));
    }
    expect(summary.find(function (entry) { return entry.label === 'workflow projection arrives'; }).lifecycle).toContain('ai-codex-thread-running');
    expect(summary.find(function (entry) { return entry.label === 'review payload ready'; }).lifecycle).toContain('ai-codex-thread-waiting_on_review');
  });
});
