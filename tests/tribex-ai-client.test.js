import './tribex-ai-client-setup.js';
import { describe, expect, it } from 'vitest';

describe('tribex-ai-client', function () {
  it('suppresses preview panes for dotted lifecycle companion events', function () {
    expect(window.__tribexAiClient.shouldPreviewCompanionPayload({
      toolName: 'opencode.thread.execution.started',
      result: {
        data: { contentLength: 42 },
        meta: { phase: 'started' },
      },
    })).toBe(false);
  });

  it('keeps preview panes for renderer-like companion payloads', function () {
    expect(window.__tribexAiClient.shouldPreviewCompanionPayload({
      toolName: 'rich_content',
      result: {
        data: { title: 'Ready', body: 'Sandbox is ready.' },
      },
    })).toBe(true);
  });

  it('derives readable tool event copy from hosted execution lifecycle payloads', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'opencode.thread.execution.completed',
      result: {
        data: {
          assistantContentPreview: 'Drafted the finance summary.',
        },
        meta: {
          phase: 'completed',
        },
      },
    }, 0)).toMatchObject({
      role: 'tool',
      summary: 'Hosted execution completed',
      detail: 'Drafted the finance summary.',
    });
  });

  it('describes hosted execution start without sandbox language', function () {
    expect(window.__tribexAiClient.normalizeMessage({
      toolName: 'opencode.thread.execution.started',
      result: {
        data: {
          contentLength: 42,
        },
        meta: {
          phase: 'started',
        },
      },
    }, 0)).toMatchObject({
      role: 'tool',
      summary: 'Starting hosted execution',
      detail: 'Submitting 42 characters to the hosted runtime.',
    });
  });
});
