// @ts-nocheck
/* TribeX AI setup renderer */

(function () {
  'use strict';

  function renderStage(stage, index) {
    var row = document.createElement('article');
    row.className = 'ai-stage-card ai-stage-' + stage.status;

    var badge = document.createElement('span');
    badge.className = 'ai-stage-index';
    badge.textContent = String(index + 1).padStart(2, '0');
    row.appendChild(badge);

    var copy = document.createElement('div');
    copy.className = 'ai-stage-copy';
    copy.innerHTML = '<strong>' + stage.label + '</strong><p>' + stage.detail + '</p>';
    row.appendChild(copy);

    var status = document.createElement('span');
    status.className = 'ai-mini-pill';
    status.textContent = window.__tribexAiUtils.titleCase(stage.status);
    row.appendChild(status);

    return row;
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.tribex_ai_setup = function renderTribexAiSetup(container) {
    var aiState = window.__tribexAiState;
    if (!aiState) {
      container.textContent = 'TribeX AI state is unavailable.';
      return;
    }

    var snapshot = aiState.getSnapshot();
    var stages = window.__tribexAiUtils.buildSetupStages(snapshot.workspace, snapshot.toolBindings);

    var view = document.createElement('div');
    view.className = 'ai-view';

    var hero = document.createElement('section');
    hero.className = 'ai-section ai-section-compact';
    hero.innerHTML =
      '<div class="ai-section-heading"><h1>Workspace setup is resumable and explicit.</h1>' +
      '<p>The approved onboarding flow stays in-app, keeps blocked prerequisites visible, and hands off into local tool readiness instead of hiding it behind failure states.</p></div>';
    view.appendChild(hero);

    var stageSection = document.createElement('section');
    stageSection.className = 'ai-section';
    stageSection.innerHTML = '<div class="ai-section-heading"><h2>Setup stages</h2><p>Each stage stays visible so users can recover after app restarts or tab changes.</p></div>';

    var list = document.createElement('div');
    list.className = 'ai-stage-list';
    stages.forEach(function (stage, index) {
      list.appendChild(renderStage(stage, index));
    });
    stageSection.appendChild(list);
    view.appendChild(stageSection);

    var detailGrid = document.createElement('section');
    detailGrid.className = 'ai-section';
    detailGrid.innerHTML = '<div class="ai-section-heading"><h2>Current workspace contract</h2><p>These are the frontend state contracts the project doc called out for phase-one implementation.</p></div>';

    var cards = document.createElement('div');
    cards.className = 'ai-card-grid';
    [
      {
        title: 'BillingReadinessSummary',
        body: 'Tracks whether the workspace can proceed, whether billing is satisfied, and what the next in-app or hosted action should be.',
      },
      {
        title: 'ProvisioningStatus',
        body: snapshot.workspace.provisioning.summary + ' Last updated ' + window.__tribexAiUtils.formatRelativeTime(snapshot.workspace.provisioning.lastUpdatedAt) + '.',
      },
      {
        title: 'ToolBindingIntent[]',
        body: 'Required and optional tools stay visible during handoff so users understand what the selected package expects from the local device.',
      },
    ].forEach(function (cardSpec) {
      var card = document.createElement('article');
      card.className = 'ai-card';
      card.innerHTML = '<div class="ai-card-header"><div><h3>' + cardSpec.title + '</h3></div></div><p class="ai-card-copy">' + cardSpec.body + '</p>';
      cards.appendChild(card);
    });
    detailGrid.appendChild(cards);
    view.appendChild(detailGrid);

    var footer = document.createElement('div');
    footer.className = 'ai-actions-row';

    var homeButton = document.createElement('button');
    homeButton.className = 'ai-secondary-btn';
    homeButton.type = 'button';
    homeButton.textContent = 'Return to AI home';
    homeButton.addEventListener('click', function () {
      aiState.openHome();
    });
    footer.appendChild(homeButton);

    var toolsButton = document.createElement('button');
    toolsButton.className = 'ai-primary-btn';
    toolsButton.type = 'button';
    toolsButton.textContent = 'Continue to tool readiness';
    toolsButton.addEventListener('click', function () {
      aiState.openToolCatalog();
    });
    footer.appendChild(toolsButton);

    view.appendChild(footer);

    container.innerHTML = '';
    container.appendChild(view);
  };
})();
