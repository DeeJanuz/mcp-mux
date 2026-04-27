import './structured-data-renderer-setup.js';
import { describe, it, expect, beforeEach } from 'vitest';

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

function renderReview(onDecision) {
  var container = document.createElement('div');
  renderer(container, buildReviewData(), null, null, true, onDecision || function () {});
  return container;
}

function getToggleButtons(toggle) {
  return toggle.querySelectorAll('button');
}

describe('structured_data review decisions', function () {
  beforeEach(function () {
    document.body.innerHTML = '';
  });

  it('renders changed rows and columns as undecided until selected', function () {
    var container = renderReview();
    var toggles = container.querySelectorAll('.sd-decision-toggle');

    expect(toggles).toHaveLength(2);

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

    var rowAccept = container.querySelector('tbody button[data-decision-action="accept"]');
    var rowReject = container.querySelector('tbody button[data-decision-action="reject"]');
    expect(rowAccept.getAttribute('data-decision-key')).toBe('r1');
    expect(rowAccept.getAttribute('aria-label')).toBe('Accept row: New account');
    expect(rowReject.getAttribute('aria-label')).toBe('Reject row: New account');
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
