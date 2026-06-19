import './drawer-stack-setup.js';
import { describe, it, expect, beforeEach } from 'vitest';

var utils = window.__companionUtils;

describe('drawer-stack', function () {
  beforeEach(function () {
    // Close all drawers and clear body children between tests
    utils.closeAllDrawers();
    document.body._children.length = 0;
    document.body.querySelector = function() { return null; };
  });

  it('exposes invokeRenderer, closeDrawer, closeAllDrawers', function () {
    expect(typeof utils.invokeRenderer).toBe('function');
    expect(typeof utils.closeDrawer).toBe('function');
    expect(typeof utils.closeAllDrawers).toBe('function');
  });

  it('adds overlay and panel to body on invokeRenderer', function () {
    utils.invokeRenderer('test_renderer', { id: '123' });
    // Should have added 2 elements: overlay + panel
    expect(document.body._children.length).toBe(2);
    expect(document.body._children[0].className).toBe('drawer-stack-overlay');
    expect(document.body._children[1].className).toBe('drawer-stack-panel');
  });

  it('shows renderer not found message for unknown renderer', function () {
    utils.invokeRenderer('nonexistent_renderer', {});
    var panel = document.body._children[1]; // panel
    var content = panel.children[1]; // second child is content div
    expect(content.textContent).toBe('Renderer not found: nonexistent_renderer');
  });

  it('calls renderer when found', function () {
    var called = false;
    var receivedParams = null;
    var receivedContext = null;
    window.__renderers.mock_renderer = function(container, params, a, b, c, d, context) {
      called = true;
      receivedParams = params;
      receivedContext = context;
    };

    utils.invokeRenderer('mock_renderer', { id: 'test' });
    expect(called).toBe(true);
    expect(receivedParams).toEqual({ id: 'test' });
    expect(receivedContext.mode).toBe('drawer');
    expect(receivedContext.level).toBe(0);
    expect(typeof receivedContext.invoke).toBe('function');

    delete window.__renderers.mock_renderer;
  });

  it('closeDrawer removes topmost overlay and panel', function () {
    utils.invokeRenderer('test1', {});
    expect(document.body._children.length).toBe(2);

    utils.closeDrawer();
    expect(document.body._children.length).toBe(0);
  });

  it('stacks multiple drawers', function () {
    utils.invokeRenderer('first', {});
    utils.invokeRenderer('second', {});
    // 2 overlays + 2 panels = 4 children
    expect(document.body._children.length).toBe(4);
  });

  it('closeAllDrawers removes all drawers', function () {
    utils.invokeRenderer('first', {});
    utils.invokeRenderer('second', {});
    utils.invokeRenderer('third', {});
    expect(document.body._children.length).toBe(6);

    utils.closeAllDrawers();
    expect(document.body._children.length).toBe(0);
  });

  it('closeDrawer does nothing when stack is empty', function () {
    utils.closeDrawer(); // Should not throw
    expect(document.body._children.length).toBe(0);
  });

  it('layers stacked panels under their parent panels', function () {
    utils.invokeRenderer('first', {});
    utils.invokeRenderer('second', {});

    // Overlays stay behind every panel, and parent panels stay above child sidecars.
    expect(document.body._children[0].style.zIndex).toBe('150');
    expect(document.body._children[1].style.zIndex).toBe('180');
    expect(document.body._children[2].style.zIndex).toBe('150');
    expect(document.body._children[3].style.zIndex).toBe('178');
  });

  it('sets decreasing width per level', function () {
    utils.invokeRenderer('first', {});
    utils.invokeRenderer('second', {});

    // First panel width: 420px, second: 400px
    expect(document.body._children[1].style.width).toBe('420px');
    expect(document.body._children[3].style.width).toBe('400px');
  });

  it('anchors first invoked drawer to the left edge of an open right drawer', function () {
    document.body.querySelector = function(selector) {
      if (selector === '.ai-codex-drawer') {
        return {
          offsetWidth: 420,
          style: { width: '420px' },
          getBoundingClientRect: function() { return { width: 420 }; },
        };
      }
      return null;
    };

    utils.invokeRenderer('first', {});

    expect(document.body._children[1].style.right).toBe('420px');
    expect(document.body._children[1].className).toContain('drawer-stack-panel-attached');
    expect(document.body._children[1].getAttribute('data-drawer-stack-attached')).toBe('true');
  });

  it('stacks deeper invoked drawers left of the anchored sidecar', function () {
    document.body.querySelector = function(selector) {
      if (selector === '.ai-codex-drawer') {
        return {
          offsetWidth: 420,
          style: { width: '420px' },
          getBoundingClientRect: function() { return { width: 420 }; },
        };
      }
      return null;
    };

    utils.invokeRenderer('first', {});
    utils.invokeRenderer('second', {});

    expect(document.body._children[1].style.right).toBe('420px');
    expect(document.body._children[3].style.right).toBe('840px');
  });

  it('increments context level for nested invocations', function () {
    var levels = [];
    window.__renderers.level_test = function(container, params, a, b, c, d, context) {
      levels.push(context.level);
    };

    utils.invokeRenderer('level_test', {});
    utils.invokeRenderer('level_test', {});
    utils.invokeRenderer('level_test', {});

    expect(levels).toEqual([0, 1, 2]);
    delete window.__renderers.level_test;
  });

  it('does not open a drawer for thread chatOutputs', function () {
    window.__renderers.rich_content = function (container, data) {
      container.textContent = data.title;
    };

    utils.syncThreadChatOutputDrawer({
      sessionId: 'test-session',
      threadId: 'thread-1',
      drawerId: 'tribex-ai-thread-chat-outputs:thread-1',
      selectedChatOutputKey: 'chat-output-1',
      open: true,
      chatOutputs: [{
        chatOutputKey: 'chat-output-1',
        title: 'Architecture',
        contentType: 'rich_content',
        data: { title: 'Architecture' },
        meta: {},
        toolArgs: {},
      }],
    });

    expect(document.body._children.length).toBe(0);
    expect(utils.selectThreadChatOutput('test-session', 'thread-1', 'chat-output-1')).toBeNull();
    expect(document.body._children.length).toBe(0);
  });
});
