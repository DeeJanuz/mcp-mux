// @ts-nocheck
/* TribeX AI tool catalog renderer */

(function () {
  'use strict';

  function readinessTone(readiness) {
    if (readiness === 'ready') return 'success';
    if (readiness === 'permission_required' || readiness === 'not_authenticated') return 'warning';
    return 'danger';
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.tribex_ai_tool_catalog = function renderTribexAiToolCatalog(container) {
    var aiState = window.__tribexAiState;
    if (!aiState) {
      container.textContent = 'TribeX AI state is unavailable.';
      return;
    }

    var snapshot = aiState.getSnapshot();
    var view = document.createElement('div');
    view.className = 'ai-view';

    var hero = document.createElement('section');
    hero.className = 'ai-section ai-section-compact';
    hero.innerHTML =
      '<div class="ai-section-heading"><h1>Workspace-scoped tool expectations with per-device readiness.</h1>' +
      '<p>This surface separates what the workspace expects from what this device can currently provide, with explicit relay approval and recovery actions.</p></div>';
    view.appendChild(hero);

    var listSection = document.createElement('section');
    listSection.className = 'ai-section';
    listSection.innerHTML = '<div class="ai-section-heading"><h2>Tool bindings</h2><p>Readiness language stays consistent across setup, settings, and active threads.</p></div>';

    var list = document.createElement('div');
    list.className = 'ai-tool-list';

    snapshot.toolBindings.forEach(function (binding) {
      var card = document.createElement('article');
      card.className = 'ai-tool-card';

      var header = document.createElement('div');
      header.className = 'ai-tool-card-header';
      header.innerHTML =
        '<div><h3>' + binding.name + '</h3><p>' + binding.category + ' · ' + (binding.required ? 'Required' : 'Optional') + '</p></div>';

      var status = document.createElement('span');
      status.className = 'ai-pill ai-pill-' + readinessTone(binding.readiness);
      status.textContent = window.__tribexAiUtils.titleCase(binding.readiness);
      header.appendChild(status);
      card.appendChild(header);

      var detail = document.createElement('p');
      detail.className = 'ai-card-copy';
      detail.textContent = binding.detail;
      card.appendChild(detail);

      var meta = document.createElement('div');
      meta.className = 'ai-tool-meta-row';

      var relayPill = document.createElement('span');
      relayPill.className = 'ai-mini-pill';
      relayPill.textContent = 'Relay: ' + window.__tribexAiUtils.titleCase(binding.relayStatus);
      meta.appendChild(relayPill);

      var requiredPill = document.createElement('span');
      requiredPill.className = 'ai-mini-pill';
      requiredPill.textContent = binding.required ? 'Required binding' : 'Optional binding';
      meta.appendChild(requiredPill);

      card.appendChild(meta);

      var actionRow = document.createElement('div');
      actionRow.className = 'ai-actions-row';

      var actionButton = document.createElement('button');
      actionButton.className = binding.readiness === 'ready' ? 'ai-secondary-btn' : 'ai-primary-btn';
      actionButton.type = 'button';
      actionButton.textContent = binding.readiness === 'ready' ? 'Already ready' : binding.nextAction;
      actionButton.disabled = binding.readiness === 'ready';
      actionButton.addEventListener('click', function () {
        aiState.resolveBinding(binding.key);
      });
      actionRow.appendChild(actionButton);

      if (binding.key === 'github') {
        var threadButton = document.createElement('button');
        threadButton.className = 'ai-secondary-btn';
        threadButton.type = 'button';
        threadButton.textContent = 'Open affected thread';
        threadButton.addEventListener('click', function () {
          aiState.openThread('thread-relay');
        });
        actionRow.appendChild(threadButton);
      }

      card.appendChild(actionRow);
      list.appendChild(card);
    });

    listSection.appendChild(list);
    view.appendChild(listSection);

    container.innerHTML = '';
    container.appendChild(view);
  };
})();
