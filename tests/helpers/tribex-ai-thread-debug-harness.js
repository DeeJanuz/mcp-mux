import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var repoRoot = join(__dirnameResolved, '../..');
var utilsCode = readFileSync(join(repoRoot, 'public/renderers/tribex-ai-utils.js'), 'utf8');
var reducerCode = readFileSync(join(repoRoot, 'public/renderers/tribex-ai-chat-reducer.js'), 'utf8');
var threadCode = readFileSync(join(repoRoot, 'public/renderers/tribex-ai-thread.js'), 'utf8');

export function baseThread(overrides) {
  return Object.assign({
    id: 'thread-debug',
    title: 'Automated Debug Thread',
    lastActivityAt: '2026-04-26T21:00:00.000Z',
    messages: [],
    runs: [],
  }, overrides || {});
}

export function createThreadDebugHarness(options) {
  options = options || {};
  document.body.innerHTML = '<div id="target"></div>';
  delete window.__MCPVIEWS_DEV__;
  delete window.__tribexAiUtils;
  delete window.__tribexAiChatReducer;
  delete window.__tribexAiState;
  delete window.__tribexAiClient;

  var frameQueue = [];
  window.requestAnimationFrame = function (callback) {
    frameQueue.push(callback);
    return frameQueue.length;
  };

  var markdownCalls = 0;
  var structuredRenderCalls = 0;
  var trace = [];
  var subscription = null;
  var reviewDecisionPayloads = [];

  var threadContext = {
    organization: { name: 'Acme AI Harness' },
    workspace: { name: 'Debug Workspace' },
    project: { name: 'Debug Project' },
    thread: baseThread(options.thread || {}),
    loading: false,
    pending: false,
    error: null,
    streamStatus: 'connected',
    relayStatus: 'online',
  };

  window.__companionUtils = {
    renderMarkdown: vi.fn(function (content) {
      markdownCalls += 1;
      var el = document.createElement('div');
      el.className = 'md-render';
      el.textContent = content || '';
      return el;
    }),
    renderMermaidBlocks: vi.fn(),
    getActiveSession: vi.fn(function () {
      return { session: { meta: { threadId: threadContext.thread.id } } };
    }),
  };

  window.__renderers = {
    rich_content: vi.fn(function (container, data) {
      container.textContent = data && data.title ? data.title : 'Rich content preview';
    }),
    structured_data: vi.fn(function (container, data, meta, _toolArgs, _reviewRequired, onDecision) {
      structuredRenderCalls += 1;
      var input = document.createElement('input');
      input.className = 'debug-review-editor';
      input.value = data && data.value ? data.value : '';
      container.appendChild(input);
      function submitDecision() {
        if (typeof onDecision === 'function') {
          return onDecision({
            decision: 'approved',
            modifications: {
              value: input.value,
            },
          });
        }
        return null;
      }
      if (meta && meta.externalDecisionSubmit) {
        return {
          providesDecisionSubmit: true,
          submitDecision: submitDecision,
        };
      }
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'debug-review-submit';
      button.textContent = 'Submit review';
      button.addEventListener('click', function () {
        submitDecision();
      });
      container.appendChild(button);
      return undefined;
    }),
  };

  window.__tribexAiClient = {
    submitThreadHumanInputDecision: vi.fn(function (_threadId, _inputId, payload) {
      reviewDecisionPayloads.push(payload);
      return Promise.resolve({ ok: true });
    }),
  };

  window.__tribexAiState = {
    subscribe: vi.fn(function (listener) {
      subscription = listener;
      return vi.fn();
    }),
    getThreadContext: vi.fn(function () {
      return threadContext;
    }),
    refreshActiveThread: vi.fn(function () {
      return Promise.resolve(true);
    }),
    submitPrompt: vi.fn(function () {
      return Promise.resolve(true);
    }),
    interruptThread: vi.fn(),
    checkThreadPause: vi.fn(function () {
      return Promise.resolve(null);
    }),
    continueThreadPause: vi.fn(function () {
      return Promise.resolve(true);
    }),
  };

  new Function(utilsCode).call(globalThis);
  new Function(reducerCode).call(globalThis);
  new Function(threadCode).call(globalThis);

  function flushFrames() {
    var queue = frameQueue.splice(0);
    queue.forEach(function (callback) {
      callback();
    });
  }

  function render() {
    window.__renderers.tribex_ai_thread(
      document.getElementById('target'),
      {},
      {},
      { threadId: threadContext.thread.id },
    );
  }

  function notify(label, mutate) {
    if (typeof mutate === 'function') mutate(threadContext.thread, threadContext);
    if (typeof subscription === 'function') subscription();
    flushFrames();
    record(label);
  }

  function getRoot() {
    return document.querySelector('.ai-codex-thread');
  }

  function getReviewEditor() {
    return document.querySelector('.debug-review-editor');
  }

  function record(label) {
    var root = getRoot();
    var reviewEditor = getReviewEditor();
    trace.push({
      label: label,
      root: root,
      rootText: root ? root.textContent : '',
      lifecycle: root ? root.className : '',
      reviewEditor: reviewEditor,
      reviewValue: reviewEditor ? reviewEditor.value : null,
      markdownCalls: markdownCalls,
      structuredRenderCalls: structuredRenderCalls,
    });
  }

  return {
    threadContext: threadContext,
    render: render,
    notify: notify,
    record: record,
    flushFrames: flushFrames,
    getRoot: getRoot,
    getReviewEditor: getReviewEditor,
    trace: trace,
    get markdownCalls() {
      return markdownCalls;
    },
    get structuredRenderCalls() {
      return structuredRenderCalls;
    },
    reviewDecisionPayloads: reviewDecisionPayloads,
  };
}
