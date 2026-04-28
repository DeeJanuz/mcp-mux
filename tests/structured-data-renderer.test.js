import './structured-data-renderer-setup.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

var renderer = window.__renderers.structured_data;

function flushFrame() {
  return new Promise(function (resolve) {
    if (window.requestAnimationFrame) window.requestAnimationFrame(function () { resolve(); });
    else setTimeout(resolve, 0);
  });
}

function buildReviewData() {
  return {
    title: 'Review Changes',
    tables: [{
      id: 't1',
      name: 'Accounts',
      columns: [
        { id: 'name', name: 'Name', change: 'add' },
        { id: 'status', name: 'Status', change: null }
      ],
      rows: [{
        id: 'r1',
        cells: {
          name: { value: 'New account', change: 'add' },
          status: { value: 'Pending', change: null }
        },
        children: []
      }]
    }]
  };
}

function buildNeutralReviewData() {
  return {
    title: 'Archive Review',
    tables: [{
      id: 'archive',
      name: 'Archive Candidates',
      columns: [
        { id: 'subject', name: 'Subject', change: null },
        { id: 'account', name: 'Account', change: null }
      ],
      rows: [
        {
          id: 'r1',
          cells: {
            subject: { value: 'Promotion', change: null },
            account: { value: 'inbox@example.com', change: null }
          },
          children: []
        },
        {
          id: 'r2',
          cells: {
            subject: { value: 'Receipt', change: null },
            account: { value: 'inbox@example.com', change: null }
          },
          children: []
        }
      ]
    }]
  };
}

function buildMultiTableReviewData() {
  return {
    title: 'Multi Table Review',
    tables: [
      {
        id: 'archive',
        name: 'Archive Candidates',
        columns: [
          { id: 'subject', name: 'Subject', change: null },
          { id: 'account', name: 'Account', change: null }
        ],
        rows: [{
          id: 'archive-r1',
          cells: {
            subject: { value: 'Promotion', change: null },
            account: { value: 'inbox@example.com', change: null }
          },
          children: []
        }]
      },
      {
        id: 'move',
        name: 'Document Moves',
        columns: [
          { id: 'action', name: 'Action', change: null },
          { id: 'target', name: 'Target', change: null }
        ],
        rows: [{
          id: 'move-r1',
          cells: {
            action: { value: 'update', change: null },
            target: { value: 'MCPViews AI Streaming Scroll/Fade Test Infrastructure', change: null }
          },
          children: []
        }]
      }
    ]
  };
}

  function renderReview(onDecision) {
    var container = document.createElement('div');
    var result = renderer(container, buildReviewData(), null, null, true, onDecision || function () {});
    container.__renderResult = result;
    return container;
  }

function getToggleButtons(toggle) {
  return toggle.querySelectorAll('button');
}

describe('structured_data review decisions', function () {
  beforeEach(function () {
    document.body.innerHTML = '';
    Object.keys(window.__structuredDataReviewDrafts || {}).forEach(function (key) {
      delete window.__structuredDataReviewDrafts[key];
    });
  });

  it('renders changed rows and columns as undecided until selected', function () {
    var container = renderReview();
    var toggles = container.querySelectorAll('.sd-decision-toggle');

    expect(toggles).toHaveLength(2);
    expect(container.querySelector('.sd-review-list')).toBeNull();

    toggles.forEach(function (toggle) {
      var buttons = getToggleButtons(toggle);
      expect(toggle.getAttribute('data-decision-state')).toBe('undecided');
      expect(buttons[0].classList.contains('sd-decision-accept')).toBe(false);
      expect(buttons[1].classList.contains('sd-decision-reject')).toBe(false);
      expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
      expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('adds unique labels and decision keys to review controls for native accessibility', function () {
    var container = renderReview();

    expect(container.querySelector('button[aria-label="Reject all decisions in Review Changes"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Submit decisions for Review Changes"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Reject all rows in Accounts"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Accept row: New account"]')).not.toBeNull();

    var rowAccept = container.querySelector('tbody button[data-decision-action="accept"]');
    var rowReject = container.querySelector('tbody button[data-decision-action="reject"]');
    expect(rowAccept.getAttribute('data-decision-key')).toBe('r1');
    expect(rowAccept.getAttribute('aria-label')).toBe('Accept row: New account');
    expect(rowReject.getAttribute('aria-label')).toBe('Reject row: New account');
  });

  it('can hide review-level submit controls while keeping per-table bulk controls', function () {
    var container = document.createElement('div');
    var submitted = null;
    var result = renderer(container, buildReviewData(), {
      externalDecisionSubmit: true,
    }, null, true, function (payload) {
      submitted = payload;
    });

    expect(container.querySelector('button[aria-label="Submit decisions for Review Changes"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Accept all decisions in Review Changes"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Reject all rows in Accounts"]')).not.toBeNull();
    expect(typeof result.submitDecision).toBe('function');
    expect(typeof result.applyDecision).toBe('function');

    result.applyDecision('reject');
    result.submitDecision();

    expect(submitted.operationDecisions).toMatchObject({
      r1: 'reject',
      'col:name': 'reject',
    });
  });

  it('reports row decision completeness for external bundled submit controls', function () {
    var container = document.createElement('div');
    var onDecisionStateChange = vi.fn();
    var result = renderer(container, buildNeutralReviewData(), {
      externalDecisionSubmit: true,
      onDecisionStateChange: onDecisionStateChange,
    }, null, true, function () {});

    expect(typeof result.getDecisionSummary).toBe('function');
    expect(result.getDecisionSummary()).toMatchObject({
      totalRows: 2,
      decidedRows: 0,
      pendingRows: 2,
      complete: false,
    });

    result.applyDecision('accept');

    expect(result.getDecisionSummary()).toMatchObject({
      totalRows: 2,
      decidedRows: 2,
      pendingRows: 0,
      complete: true,
    });
    expect(onDecisionStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      totalRows: 2,
      decidedRows: 2,
      complete: true,
    }));
  });

  it('adds column width hooks and wider CSV review defaults', function () {
    var container = document.createElement('div');
    renderer(container, buildNeutralReviewData(), null, null, true, function () {});

    expect(container.querySelector('th[data-column-id="subject"]')).not.toBeNull();
    expect(container.querySelector('td[data-column-id="subject"]')).not.toBeNull();
    expect(container.querySelector('th[data-column-id="account"]')).not.toBeNull();
    expect(container.querySelector('td[data-column-id="decision"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('thead th')).map(function (th) {
      return th.getAttribute('data-column-id') || 'spacer';
    })).toEqual(['decision', 'subject', 'account']);
    expect(Array.from(container.querySelectorAll('tbody tr:first-child td')).map(function (td) {
      return td.getAttribute('data-column-id') || 'spacer';
    })).toEqual(['decision', 'subject', 'account']);
    expect(Array.from(container.querySelectorAll('colgroup col')).map(function (col) {
      return [col.getAttribute('data-column-id'), col.style.width];
    })).toEqual([
      ['decision', '82px'],
      ['subject', '260px'],
      ['account', '220px'],
    ]);
    expect(container.querySelector('.sd-table').style.width).toBe('562px');
    expect(container.querySelector('.sd-table').hasAttribute('data-has-toggle-spacer')).toBe(false);

    var styles = document.getElementById('structured-data-styles').textContent;
    expect(styles).toContain('.sd-table { width: max-content; table-layout: fixed;');
    expect(styles).toContain('.sd-th {');
    expect(styles).toContain('min-width: 180px');
    expect(styles).toContain('.sd-th[data-column-id="subject"]');
    expect(styles).toContain('.sd-th[data-column-id="summary"]');
    expect(styles).toContain('.sd-th[data-column-id="decision"]');
    expect(styles).toContain('width: 82px');
    expect(styles).toContain('padding-left: 10px; padding-right: 10px');
    expect(styles).toContain('width: 24px; min-width: 24px; height: 24px');
    expect(styles).toContain('left: 24px');
    expect(styles).toContain('.sd-table:not([data-has-toggle-spacer="true"])');
    expect(styles).toContain('.sd-th.sd-toggle-spacer, .sd-td.sd-toggle-spacer');
  });

  it('keeps the expand spacer only for hierarchical rows', function () {
    var container = document.createElement('div');
    var data = buildNeutralReviewData();
    data.tables[0].rows[0].children = [{
      id: 'r1-child',
      cells: {
        subject: { value: 'Nested child', change: null },
        account: { value: 'inbox@example.com', change: null }
      },
      children: []
    }];

    renderer(container, data, null, null, true, function () {});

    expect(container.querySelector('.sd-table').getAttribute('data-has-toggle-spacer')).toBe('true');
    expect(Array.from(container.querySelectorAll('thead th')).map(function (th) {
      return th.getAttribute('data-column-id') || 'spacer';
    })).toEqual(['spacer', 'decision', 'subject', 'account']);
    expect(Array.from(container.querySelectorAll('colgroup col')).map(function (col) {
      return [col.getAttribute('data-column-id'), col.style.width];
    })).toEqual([
      ['spacer', '24px'],
      ['decision', '82px'],
      ['subject', '260px'],
      ['account', '220px'],
    ]);
    expect(container.querySelector('.sd-table').style.width).toBe('586px');
  });

  it('can return a selected decision back to undecided', function () {
    var container = renderReview();
    var rowToggle = container.querySelector('tbody .sd-decision-toggle');
    var acceptBtn = getToggleButtons(rowToggle)[0];

    acceptBtn.click();

    rowToggle = container.querySelector('tbody .sd-decision-toggle');
    acceptBtn = getToggleButtons(rowToggle)[0];
    expect(rowToggle.getAttribute('data-decision-state')).toBe('accept');
    expect(acceptBtn.classList.contains('sd-decision-accept')).toBe(true);
    expect(acceptBtn.getAttribute('aria-pressed')).toBe('true');

    acceptBtn.click();

    rowToggle = container.querySelector('tbody .sd-decision-toggle');
    acceptBtn = getToggleButtons(rowToggle)[0];
    expect(rowToggle.getAttribute('data-decision-state')).toBe('undecided');
    expect(acceptBtn.classList.contains('sd-decision-accept')).toBe(false);
    expect(acceptBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('submits no explicit decisions when the user leaves items undecided', function () {
    var submitted = null;
    var container = renderReview(function (payload) {
      submitted = payload;
    });
    var submitBarButtons = container.querySelectorAll('.sd-submit-bar button');
    var submitBtn = submitBarButtons[submitBarButtons.length - 1];

    submitBtn.click();

    expect(submitted).not.toBeNull();
    expect(submitted.decisions).toEqual({});
  });

  it('returns an imperative review submit hook for host-level buttons', async function () {
    var submitted = null;
    var container = renderReview(function (payload) {
      submitted = payload;
      return Promise.resolve({ ok: true });
    });

    expect(container.__renderResult).toMatchObject({
      providesDecisionSubmit: true,
    });
    expect(typeof container.__renderResult.submitDecision).toBe('function');

    var rowAccept = container.querySelector('tbody button[data-decision-action="accept"]');
    rowAccept.click();
    await flushFrame();
    await container.__renderResult.submitDecision();

    expect(submitted.decisions).toMatchObject({
      r1: 'accept',
    });
    expect(container.querySelector('.sd-submit-bar').getAttribute('data-submit-state')).toBe('submitted');
  });

  it('shows decision controls for review rows even when cells have no change markers', async function () {
    var submitted = null;
    var container = document.createElement('div');
    renderer(container, buildNeutralReviewData(), null, null, true, function (payload) {
      submitted = payload;
    });

    var rowToggles = container.querySelectorAll('tbody .sd-decision-toggle');
    expect(rowToggles).toHaveLength(2);

    var acceptAllBtn = container.querySelector('.sd-submit-bar button');
    acceptAllBtn.click();
    await flushFrame();

    rowToggles = container.querySelectorAll('tbody .sd-decision-toggle');
    expect(Array.from(rowToggles).map(function (toggle) {
      return toggle.getAttribute('data-decision-state');
    })).toEqual(['accept', 'accept']);

    var submitBarButtons = container.querySelectorAll('.sd-submit-bar button');
    submitBarButtons[submitBarButtons.length - 1].click();

    expect(submitted.decisions).toMatchObject({
      r1: 'accept',
      r2: 'accept',
    });
  });

  it('renders multiple review tables as separate sections without an aggregated review list', function () {
    var container = document.createElement('div');
    renderer(container, buildMultiTableReviewData(), null, null, true, function () {});

    expect(container.querySelector('.sd-submit-bar')).not.toBeNull();
    expect(container.querySelector('.sd-review-list')).toBeNull();
    expect(container.querySelectorAll('.sd-container')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll('.sd-table-name')).map(function (heading) {
      return heading.textContent;
    })).toEqual(['Archive Candidates', 'Document Moves']);
    expect(container.textContent).not.toContain('Review items');
    expect(container.textContent).not.toContain('2 items');
  });

  it('keeps rapid bulk accept plus submit on the operation spine', function () {
    var submitted = null;
    var container = document.createElement('div');
    renderer(container, buildNeutralReviewData(), null, null, true, function (payload) {
      submitted = payload;
    });

    var submitBarButtons = container.querySelectorAll('.sd-submit-bar button');
    submitBarButtons[0].click();
    submitBarButtons[2].click();

    expect(submitted).not.toBeNull();
    expect(submitted.decisions).toMatchObject({
      r1: 'accept',
      r2: 'accept',
    });
  });

  it('supports partial approvals from table row controls', async function () {
    var submitted = null;
    var container = document.createElement('div');
    renderer(container, buildNeutralReviewData(), null, null, true, function (payload) {
      submitted = payload;
    });

    var rejectAllBtn = container.querySelector('button[aria-label="Reject all decisions in Archive Review"]');
    rejectAllBtn.click();
    await flushFrame();

    var rowAcceptButtons = container.querySelectorAll('tbody button[data-decision-action="accept"]');
    rowAcceptButtons[0].click();
    await flushFrame();

    var submitBarButtons = container.querySelectorAll('.sd-submit-bar button');
    submitBarButtons[submitBarButtons.length - 1].click();

    expect(submitted).not.toBeNull();
    expect(submitted.decisions).toMatchObject({
      r1: 'accept',
      r2: 'reject',
    });
    expect(Array.from(container.querySelectorAll('tbody .sd-decision-toggle')).map(function (toggle) {
      return toggle.getAttribute('data-decision-state');
    })).toEqual(['accept', 'reject']);
  });

  it('restores in-progress review decisions after the host rerenders the renderer container', async function () {
    var submitted = null;
    var container = document.createElement('div');
    var meta = { humanInputId: 'human-input-archive-draft', reviewSessionId: 'review-archive-draft' };
    renderer(container, buildNeutralReviewData(), meta, null, true, function (payload) {
      submitted = payload;
    });

    container.querySelector('button[aria-label="Reject all decisions in Archive Review"]').click();
    await flushFrame();
    var secondAccept = container.querySelectorAll('tbody button[data-decision-action="accept"]')[1];
    secondAccept.click();
    await flushFrame();

    renderer(container, buildNeutralReviewData(), Object.assign({}, meta, { pollVersion: 2 }), null, true, function (payload) {
      submitted = payload;
    });

    expect(Array.from(container.querySelectorAll('tbody .sd-decision-toggle')).map(function (toggle) {
      return toggle.getAttribute('data-decision-state');
    })).toEqual(['reject', 'accept']);

    container.querySelector('button[data-review-decision-submit]').click();

    expect(submitted).not.toBeNull();
    expect(submitted.decisions).toMatchObject({
      r1: 'reject',
      r2: 'accept',
    });
  });

  it('supports staged browser clicks with a status poll between bulk decision and submit', async function () {
    var submitted = null;
    var container = document.createElement('div');
    renderer(container, buildNeutralReviewData(), null, null, true, function (payload) {
      submitted = payload;
    });

    var submitBar = container.querySelector('.sd-submit-bar');
    var submitBarButtons = submitBar.querySelectorAll('button');
    var acceptAllBtn = submitBarButtons[0];
    var submitBtn = submitBarButtons[2];

    acceptAllBtn.click();
    await flushFrame();

    expect(submitted).toBeNull();
    expect(container.querySelector('.sd-submit-bar')).toBe(submitBar);
    expect(Array.from(container.querySelectorAll('tbody .sd-decision-toggle')).map(function (toggle) {
      return toggle.getAttribute('data-decision-state');
    })).toEqual(['accept', 'accept']);

    await Promise.resolve();
    expect(container.querySelector('.sd-submit-bar')).toBe(submitBar);

    submitBtn.click();

    expect(submitted).not.toBeNull();
    expect(submitted.decisions).toMatchObject({
      r1: 'accept',
      r2: 'accept',
    });
  });

  it('optimistically confirms submitted decisions and keeps failure retryable', async function () {
    var resolveSubmit;
    var rejectSubmit;
    var firstContainer = renderReview(function () {
      return new Promise(function (resolve) {
        resolveSubmit = resolve;
      });
    });
    var firstSubmit = firstContainer.querySelectorAll('.sd-submit-bar button')[2];

    firstSubmit.click();
    expect(firstContainer.querySelector('.sd-submit-bar').getAttribute('data-submit-state')).toBe('submitting');
    expect(firstContainer.textContent).toContain('Decision submitted');
    expect(firstSubmit.disabled).toBe(true);

    resolveSubmit({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(firstContainer.querySelector('.sd-submit-bar').getAttribute('data-submit-state')).toBe('submitted');
    expect(firstContainer.textContent).toContain('Decision confirmed');

    var secondContainer = renderReview(function () {
      return new Promise(function (_resolve, reject) {
        rejectSubmit = reject;
      });
    });
    var secondSubmit = secondContainer.querySelectorAll('.sd-submit-bar button')[2];

    secondSubmit.click();
    rejectSubmit(new Error('Nope'));
    await Promise.resolve();
    await Promise.resolve();

    expect(secondContainer.querySelector('.sd-submit-bar').getAttribute('data-submit-state')).toBe('error');
    expect(secondContainer.textContent).toContain('Nope');
    expect(secondSubmit.disabled).toBe(false);
  });

  it('normalizes model-style cells arrays into keyed cells before rendering', function () {
    var container = document.createElement('div');

    renderer(container, {
      title: 'Risk Review',
      tables: [{
        id: 'risk',
        name: 'Risk Items',
        columns: [
          { id: 'item', name: 'Item' },
          { id: 'risk', name: 'Risk' }
        ],
        rows: [{
          id: 'revenue-recognition',
          cells: [
            { columnId: 'item', value: 'Revenue Recognition' },
            { columnId: 'risk', value: 'High' }
          ],
          children: []
        }]
      }]
    }, null, null, true, function () {});

    expect(container.textContent).toContain('Revenue Recognition');
    expect(container.textContent).toContain('High');
  });
});
