// @ts-nocheck
/* TribeX AI home renderer */

(function () {
  'use strict';

  function renderHero(container, snapshot) {
    var section = document.createElement('section');
    section.className = 'ai-view-hero';

    var copy = document.createElement('div');
    copy.className = 'ai-view-hero-copy';
    copy.innerHTML =
      '<p class="ai-kicker">Bundled first-party AI surface</p>' +
      '<h1>Hosted workspace context, thread recovery, and local-tool readiness in one shell.</h1>' +
      '<p class="ai-lede">This MCPViews scaffold follows the approved Tribe-X client architecture: shell entrypoint, AI home, thread-as-tab navigation, and workspace-scoped tool readiness.</p>';

    var stats = document.createElement('div');
    stats.className = 'ai-stat-row';
    [
      { label: 'Workspace', value: snapshot.workspace.name },
      { label: 'Projects', value: String(snapshot.projects.length) },
      { label: 'Recent threads', value: String(snapshot.recentThreads.length) },
      { label: 'Ready tools', value: snapshot.toolSummary.ready + '/' + snapshot.toolSummary.total },
    ].forEach(function (stat) {
      var card = document.createElement('div');
      card.className = 'ai-stat-card';
      card.innerHTML = '<span>' + stat.label + '</span><strong>' + stat.value + '</strong>';
      stats.appendChild(card);
    });

    section.appendChild(copy);
    section.appendChild(stats);
    container.appendChild(section);
  }

  function renderAlert(container, snapshot) {
    if (!snapshot.alert) return;
    var alert = document.createElement('section');
    alert.className = 'ai-inline-alert ai-inline-alert-' + (snapshot.alert.tone || 'warning');
    alert.innerHTML =
      '<div><strong>' + snapshot.alert.title + '</strong><p>' + snapshot.alert.body + '</p></div>';

    var button = document.createElement('button');
    button.className = 'ai-inline-alert-btn';
    button.type = 'button';
    button.textContent = snapshot.alert.actionLabel;
    button.addEventListener('click', function () {
      if (snapshot.alert.action) snapshot.alert.action();
    });
    alert.appendChild(button);
    container.appendChild(alert);
  }

  function renderQuickActions(container) {
    var state = window.__tribexAiState;
    var section = document.createElement('section');
    section.className = 'ai-section';
    section.innerHTML = '<div class="ai-section-heading"><h2>Quick actions</h2><p>Match the approved shell flows from the project plan.</p></div>';

    var grid = document.createElement('div');
    grid.className = 'ai-action-grid';

    [
      {
        title: 'Resume setup',
        body: 'Jump back into the in-app readiness flow for billing, provisioning, and local tool handoff.',
        action: function () { state.openSetup(); },
      },
      {
        title: 'Inspect tool catalog',
        body: 'Review workspace-approved tools, current-device readiness, and scoped relay approvals.',
        action: function () { state.openToolCatalog(); },
      },
      {
        title: 'Open active thread',
        body: 'Return to the relay recovery thread and continue the hosted conversation as a tab.',
        action: function () { state.openThread('thread-relay'); },
      },
    ].forEach(function (item) {
      var card = document.createElement('button');
      card.className = 'ai-action-card';
      card.type = 'button';
      card.innerHTML = '<strong>' + item.title + '</strong><p>' + item.body + '</p>';
      card.addEventListener('click', item.action);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  }

  function renderProjects(container, snapshot, focusProjectId) {
    var state = window.__tribexAiState;
    var section = document.createElement('section');
    section.className = 'ai-section';
    section.innerHTML = '<div class="ai-section-heading"><h2>Project discovery</h2><p>Projects stay visible even when no thread tab is currently open.</p></div>';

    var list = document.createElement('div');
    list.className = 'ai-card-grid';

    snapshot.projects.forEach(function (project) {
      var card = document.createElement('article');
      card.className = 'ai-card' + (focusProjectId === project.id ? ' ai-card-focused' : '');

      var header = document.createElement('div');
      header.className = 'ai-card-header';
      header.innerHTML =
        '<div><h3>' + project.name + '</h3><p>' + project.summary + '</p></div>' +
        '<span class="ai-mini-pill">' + project.status + '</span>';
      card.appendChild(header);

      var memory = document.createElement('p');
      memory.className = 'ai-card-copy';
      memory.textContent = project.memorySummary;
      card.appendChild(memory);

      var threads = state.getThreadsForProject(project.id).slice(0, 2);
      var threadList = document.createElement('div');
      threadList.className = 'ai-inline-list';
      threads.forEach(function (thread) {
        var button = document.createElement('button');
        button.className = 'ai-inline-list-btn';
        button.type = 'button';
        button.innerHTML = '<span>' + thread.title + '</span><small>' + window.__tribexAiUtils.formatRelativeTime(thread.lastActivityAt) + '</small>';
        button.addEventListener('click', function () {
          state.openThread(thread.id);
        });
        threadList.appendChild(button);
      });
      card.appendChild(threadList);

      var footer = document.createElement('div');
      footer.className = 'ai-card-footer';

      var openProject = document.createElement('button');
      openProject.className = 'ai-secondary-btn';
      openProject.type = 'button';
      openProject.textContent = 'Focus project';
      openProject.addEventListener('click', function () {
        state.openProject(project.id);
      });
      footer.appendChild(openProject);

      var openThread = document.createElement('button');
      openThread.className = 'ai-primary-btn';
      openThread.type = 'button';
      openThread.textContent = threads[0] ? 'Open recent thread' : 'Open home';
      openThread.addEventListener('click', function () {
        if (threads[0]) state.openThread(threads[0].id);
        else state.openHome(project.id);
      });
      footer.appendChild(openThread);

      card.appendChild(footer);
      list.appendChild(card);
    });

    section.appendChild(list);
    container.appendChild(section);
  }

  function renderRecentThreads(container, snapshot) {
    var state = window.__tribexAiState;
    var section = document.createElement('section');
    section.className = 'ai-section';
    section.innerHTML = '<div class="ai-section-heading"><h2>Recent threads</h2><p>Threads reopen as tabs without destroying the hosted work record.</p></div>';

    var list = document.createElement('div');
    list.className = 'ai-thread-list-grid';

    snapshot.recentThreads.forEach(function (thread) {
      var item = document.createElement('article');
      item.className = 'ai-thread-card';

      var title = document.createElement('div');
      title.className = 'ai-thread-card-header';
      title.innerHTML =
        '<div><h3>' + thread.title + '</h3><p>' + thread.preview + '</p></div>' +
        '<span class="ai-mini-pill">' + window.__tribexAiUtils.titleCase(thread.hydrateState) + '</span>';
      item.appendChild(title);

      var meta = document.createElement('p');
      meta.className = 'ai-thread-card-meta';
      meta.textContent = window.__tribexAiUtils.formatRelativeTime(thread.lastActivityAt);
      item.appendChild(meta);

      var button = document.createElement('button');
      button.className = 'ai-primary-btn';
      button.type = 'button';
      button.textContent = 'Open thread tab';
      button.addEventListener('click', function () {
        state.openThread(thread.id);
      });
      item.appendChild(button);

      list.appendChild(item);
    });

    section.appendChild(list);
    container.appendChild(section);
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.tribex_ai_home = function renderTribexAiHome(container, data, meta, toolArgs) {
    var state = window.__tribexAiState;
    if (!state) {
      container.textContent = 'TribeX AI state is unavailable.';
      return;
    }

    var snapshot = state.getSnapshot();
    var view = document.createElement('div');
    view.className = 'ai-view';

    renderHero(view, snapshot);
    renderAlert(view, snapshot);
    renderQuickActions(view);
    renderProjects(view, snapshot, toolArgs && toolArgs.projectId);
    renderRecentThreads(view, snapshot);

    container.innerHTML = '';
    container.appendChild(view);
  };
})();
