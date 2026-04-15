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

beforeEach(function () {
  document.body.innerHTML = '<div id="target"></div>';

  delete window.__tribexAiUtils;
  delete window.__tribexAiState;
  window.__renderers = {
    rich_content: vi.fn(function (container, data) {
      container.textContent = data.title;
    }),
  };

  loadUtils();
});

describe('tribex-ai-thread', function () {
  it('renders rich content inline and groups lifecycle noise into activity', function () {
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
              { id: 'u2', role: 'user', content: 'Smoke key: rule-skill-echo', createdAt: '2026-04-14T20:01:00.000Z' },
              { id: 'u3', role: 'user', content: 'Smoke key: rule-skill-echo', createdAt: '2026-04-14T20:02:00.000Z' },
              { id: 't1', role: 'tool', toolName: 'brokered.thread.execution.started', status: 'success', summary: 'Starting hosted execution', detail: 'Submitting 270 characters to the hosted runtime.' },
              { id: 't2', role: 'tool', toolName: 'brokered.thread.execution.completed', status: 'success', summary: 'Hosted execution completed', detail: 'Smoke completed.' },
              {
                id: 'r1',
                role: 'tool',
                toolName: 'rich_content',
                resultData: { title: 'Smoke Test Passed', body: 'Runtime: `ai-sdk-runner`' },
                resultMeta: { status: 'passed' },
                toolArgs: { threadId: 'thread-1' },
              },
              { id: 'a1', role: 'assistant', content: 'SMOKE KEY: rule-skill-echo', createdAt: '2026-04-14T20:03:00.000Z' },
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

    window.__renderers.tribex_ai_thread(
      document.getElementById('target'),
      {},
      {},
      { threadId: 'thread-1' },
    );

    expect(document.querySelectorAll('.ai-chat-bubble-user')).toHaveLength(1);
    expect(document.querySelector('.ai-chat-attempt-badge').textContent).toContain('3 attempts');
    expect(document.querySelector('.ai-activity-drawer')).not.toBeNull();
    expect(document.querySelector('.ai-activity-summary').textContent).toContain('2 hosted events');
    expect(window.__renderers.rich_content).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ai-artifact-card').textContent).toContain('Smoke Test Passed');
    expect(Array.from(document.querySelector('.ai-chat-log-standalone').children).some(function (node) {
      return node.className.indexOf('ai-artifact-card') >= 0;
    })).toBe(true);
    expect(document.querySelector('.ai-view').children[2].className).toContain('ai-activity-drawer');
  });
});
