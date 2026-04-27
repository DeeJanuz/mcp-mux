import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var harnessCode = readFileSync(join(__dirnameResolved, '../public/debug/tribex-ai-browser-harness.js'), 'utf8');

function loadHarnessAt(url) {
  window.history.pushState({}, '', url);
  new Function(harnessCode).call(globalThis);
}

beforeEach(function () {
  document.body.innerHTML = '';
  delete window.__TAURI__;
  delete window.__TAURI_INTERNALS__;
  delete window.__MCPVIEWS_AI_BROWSER_HARNESS__;
  delete window.__tribexAiClient;
  delete window.__tribexAiState;
  delete window.__companionUtils;
  vi.useRealTimers();
});

afterEach(function () {
  vi.useRealTimers();
});

describe('tribex ai browser harness loader', function () {
  it('does not install browser shims without the explicit harness flag', function () {
    loadHarnessAt('/');

    expect(window.__TAURI__).toBeUndefined();
    expect(window.__MCPVIEWS_AI_BROWSER_HARNESS__).toBeUndefined();
  });

  it('installs a deterministic first-party AI Tauri shim when enabled', async function () {
    loadHarnessAt('/?mcpviews_harness=ai&auto_open=0');

    expect(window.__TAURI__).toBeTruthy();
    expect(window.__MCPVIEWS_AI_BROWSER_HARNESS__).toBeTruthy();

    await expect(window.__TAURI__.core.invoke('get_first_party_ai_config')).resolves.toMatchObject({
      configured: true,
      source: 'browser-harness',
    });
    await expect(window.__TAURI__.core.invoke('get_renderer_registry')).resolves.toEqual([]);

    await expect(window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'GET',
      path: '/organizations',
    })).resolves.toMatchObject({
      organizations: [
        expect.objectContaining({
          name: 'Local Persona Lab',
        }),
      ],
    });
  });

  it('routes review submission and follow-up runtime events to newly created threads', async function () {
    vi.useFakeTimers();
    window.__tribexAiClient = {};
    window.__tribexAiState = {
      refreshNavigator: vi.fn(function () { return Promise.resolve(); }),
      openThread: vi.fn(),
      refreshActiveThread: vi.fn(function () { return Promise.resolve(); }),
    };
    window.__companionUtils = {
      openSession: vi.fn(),
    };
    loadHarnessAt('/?mcpviews_harness=ai&harness_overlay=0');
    await window.__MCPVIEWS_AI_BROWSER_HARNESS__.start();

    var created = await window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'POST',
      path: '/projects/project-browser-harness/threads',
      body: { title: 'Race condition stress thread' },
    });
    var threadId = created.thread.id;
    var newThreadEvents = [];
    var seedThreadEvents = [];
    window.__tribexAiClient.listenToRuntimeEvents(threadId, function (event) {
      newThreadEvents.push(event);
    });
    window.__tribexAiClient.listenToRuntimeEvents('thread-new-chat-3', function (event) {
      seedThreadEvents.push(event);
    });

    await window.__tribexAiClient.sendMessage(threadId, 'Stress the review flow.', {
      turnId: 'turn-new-thread',
      operationId: 'operation-new-thread',
    });
    await vi.advanceTimersByTimeAsync(2200);

    await expect(window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'GET',
      path: '/threads/' + encodeURIComponent(threadId),
    })).resolves.toMatchObject({
      pendingHumanInputs: [
        expect.objectContaining({
          threadId: threadId,
        }),
      ],
    });

    await window.__tribexAiClient.submitThreadHumanInputDecision(threadId, 'human-input-archive-review', {
      decision: 'rejected',
      decisions: { 'row-newsletter': 'reject' },
    });
    await vi.advanceTimersByTimeAsync(1200);

    var refreshed = await window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'GET',
      path: '/threads/' + encodeURIComponent(threadId),
    });
    expect(refreshed.pendingHumanInputs).toEqual([]);
    expect(refreshed.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant' }),
    ]);
    expect(window.__MCPVIEWS_AI_BROWSER_HARNESS__.snapshot()).toMatchObject({
      threadId: threadId,
      pendingHumanInputs: 0,
      lastDecision: expect.objectContaining({
        threadId: threadId,
        inputId: 'human-input-archive-review',
        decision: 'rejected',
      }),
    });
    expect(newThreadEvents.map(function (event) { return event.type; })).toEqual(expect.arrayContaining([
      'runtime_presence',
      'assistant_start',
      'assistant_delta',
      'assistant_finish',
      'turn_finish',
    ]));
    expect(seedThreadEvents).toEqual([]);
  });

  it('keeps queued context on the active thread without restarting the harness run', async function () {
    vi.useFakeTimers();
    window.__tribexAiClient = {};
    window.__tribexAiState = {
      refreshNavigator: vi.fn(function () { return Promise.resolve(); }),
      openThread: vi.fn(),
      refreshActiveThread: vi.fn(function () { return Promise.resolve(); }),
    };
    window.__companionUtils = {
      openSession: vi.fn(),
    };
    loadHarnessAt('/?mcpviews_harness=ai&harness_overlay=0');
    await window.__MCPVIEWS_AI_BROWSER_HARNESS__.start();

    var created = await window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'POST',
      path: '/projects/project-browser-harness/threads',
      body: { title: 'Queued context thread' },
    });
    var threadId = created.thread.id;
    await window.__tribexAiClient.sendMessage(threadId, 'Start work.', {
      turnId: 'turn-active',
      operationId: 'operation-active',
      messageId: 'user-active',
    });
    await window.__tribexAiClient.sendMessage(threadId, 'Use this added context.', {
      turnId: 'turn-context',
      operationId: 'operation-context',
      messageId: 'user-context',
      waitForStable: false,
    });

    var refreshed = await window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'GET',
      path: '/threads/' + encodeURIComponent(threadId),
    });
    expect(refreshed.messages).toEqual([
      expect.objectContaining({ id: 'user-active', content: 'Start work.' }),
      expect.objectContaining({
        id: 'user-context',
        content: 'Use this added context.',
        pending: true,
        queued: true,
      }),
    ]);
    expect(window.__MCPVIEWS_AI_BROWSER_HARNESS__.snapshot()).toMatchObject({
      threadId: threadId,
      stage: 'context-queued',
    });
  });

  it('can simulate realistic review latency instead of the compressed debug loop', async function () {
    vi.useFakeTimers();
    window.__tribexAiClient = {};
    window.__tribexAiState = {
      refreshNavigator: vi.fn(function () { return Promise.resolve(); }),
      openThread: vi.fn(),
      refreshActiveThread: vi.fn(function () { return Promise.resolve(); }),
    };
    window.__companionUtils = {
      openSession: vi.fn(),
    };
    loadHarnessAt('/?mcpviews_harness=ai&harness_overlay=0&latency=realistic');
    await window.__MCPVIEWS_AI_BROWSER_HARNESS__.start();

    var created = await window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'POST',
      path: '/projects/project-browser-harness/threads',
      body: { title: 'Realistic latency thread' },
    });
    var threadId = created.thread.id;

    await window.__tribexAiClient.sendMessage(threadId, 'Prepare a review slowly.', {
      turnId: 'turn-realistic',
      operationId: 'operation-realistic',
    });
    await vi.advanceTimersByTimeAsync(3000);

    await expect(window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'GET',
      path: '/threads/' + encodeURIComponent(threadId),
    })).resolves.toMatchObject({
      pendingHumanInputs: [],
    });
    expect(window.__MCPVIEWS_AI_BROWSER_HARNESS__.snapshot()).toMatchObject({
      latency: 'realistic',
      threadId: threadId,
    });

    await vi.advanceTimersByTimeAsync(56000);
    await expect(window.__TAURI__.core.invoke('first_party_ai_request', {
      method: 'GET',
      path: '/threads/' + encodeURIComponent(threadId),
    })).resolves.toMatchObject({
      pendingHumanInputs: [
        expect.objectContaining({
          threadId: threadId,
        }),
      ],
    });
    expect(window.__MCPVIEWS_AI_BROWSER_HARNESS__.snapshot().stage).toBe('waiting-on-review');
  });
});
