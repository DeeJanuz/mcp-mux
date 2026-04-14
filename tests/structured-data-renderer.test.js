import './structured-data-renderer-setup.js';
import { describe, it, expect, beforeEach } from 'vitest';

var renderer = window.__renderers.structured_data;

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
});
