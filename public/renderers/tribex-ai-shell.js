// @ts-nocheck
/* TribeX AI shell — workspace/project/thread navigation frame owned by the app shell */

(function () {
  'use strict';

  var activeSession = null;

  function renderBadge(text, tone) {
    var badge = document.createElement('span');
    badge.className = 'ai-pill ai-pill-' + (tone || 'neutral');
    badge.textContent = text;
    return badge;
  }

  function clearShell() {
    var shell = document.getElementById('ai-shell');
    var mainBody = document.getElementById('main-body');
    if (!shell || !mainBody) return;
    shell.innerHTML = '';
    shell.classList.add('hidden');
    mainBody.classList.remove('ai-shell-visible');
  }

  function renderActionBar(shell, aiState) {
    var buttonRow = document.createElement('div');
    buttonRow.className = 'ai-shell-actions';

    [
      { label: 'Home', onClick: function () { aiState.openHome(activeSession && activeSession.projectId); } },
      { label: 'Setup', onClick: function () { aiState.openSetup(); } },
      { label: 'Tools', onClick: function () { aiState.openToolCatalog(); } },
    ].forEach(function (action) {
      var button = document.createElement('button');
      button.className = 'ai-shell-action-btn';
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
      buttonRow.appendChild(button);
    });

    shell.appendChild(buttonRow);
  }

  function renderWorkspaceCard(shell, snapshot) {
    var workspace = snapshot.workspace;
    var toolSummary = snapshot.toolSummary;
    var card = document.createElement('section');
    card.className = 'ai-shell-card';

    var eyebrow = document.createElement('p');
    eyebrow.className = 'ai-shell-eyebrow';
    eyebrow.textContent = snapshot.organization.name;
    card.appendChild(eyebrow);

    var title = document.createElement('h2');
    title.className = 'ai-shell-title';
    title.textContent = workspace.name;
    card.appendChild(title);

    var subline = document.createElement('p');
    subline.className = 'ai-shell-subline';
    subline.textContent = workspace.package.name + ' · ' + workspace.package.persona + ' · ' + workspace.package.version;
    card.appendChild(subline);

    var badges = document.createElement('div');
    badges.className = 'ai-shell-pill-row';
    badges.appendChild(renderBadge(workspace.provisioning.state === 'ACTIVE' ? 'Workspace ready' : 'Needs setup', workspace.provisioning.state === 'ACTIVE' ? 'success' : 'warning'));
    badges.appendChild(renderBadge(toolSummary.blocked === 0 ? 'Device ready' : toolSummary.blocked + ' tool blocked', toolSummary.blocked === 0 ? 'success' : 'warning'));
    card.appendChild(badges);

    shell.appendChild(card);
  }

  function renderProjects(shell, snapshot, aiState) {
    var section = document.createElement('section');
    section.className = 'ai-shell-section';

    var header = document.createElement('div');
    header.className = 'ai-shell-section-header';
    header.innerHTML = '<span>Projects</span><span>' + snapshot.projects.length + '</span>';
    section.appendChild(header);

    var list = document.createElement('div');
    list.className = 'ai-shell-list';

    snapshot.projects.forEach(function (project) {
      var item = document.createElement('div');
      item.className = 'ai-shell-item' + (activeSession && activeSession.projectId === project.id ? ' active' : '');

      var projectButton = document.createElement('button');
      projectButton.className = 'ai-shell-project-btn';
      projectButton.type = 'button';
      projectButton.addEventListener('click', function () {
        aiState.openProject(project.id);
      });

      var projectName = document.createElement('strong');
      projectName.textContent = project.name;
      projectButton.appendChild(projectName);

      var projectMeta = document.createElement('span');
      projectMeta.textContent = project.status + ' · ' + window.__tribexAiUtils.formatRelativeTime(project.lastActivityAt);
      projectButton.appendChild(projectMeta);

      item.appendChild(projectButton);

      var threads = aiState.getThreadsForProject(project.id).slice(0, 2);
      if (threads.length > 0) {
        var threadList = document.createElement('div');
        threadList.className = 'ai-shell-thread-list';

        threads.forEach(function (thread) {
          var threadButton = document.createElement('button');
          threadButton.className = 'ai-shell-thread-btn' + (activeSession && activeSession.threadId === thread.id ? ' active' : '');
          threadButton.type = 'button';
          threadButton.addEventListener('click', function () {
            aiState.openThread(thread.id);
          });

          var title = document.createElement('span');
          title.textContent = thread.title;
          threadButton.appendChild(title);

          var meta = document.createElement('small');
          meta.textContent = window.__tribexAiUtils.formatRelativeTime(thread.lastActivityAt);
          threadButton.appendChild(meta);

          threadList.appendChild(threadButton);
        });

        item.appendChild(threadList);
      }

      list.appendChild(item);
    });

    section.appendChild(list);
    shell.appendChild(section);
  }

  function renderRecovery(shell, snapshot) {
    if (!snapshot.alert) return;
    var card = document.createElement('section');
    card.className = 'ai-shell-recovery ai-shell-recovery-' + (snapshot.alert.tone || 'warning');

    var title = document.createElement('strong');
    title.textContent = snapshot.alert.title;
    card.appendChild(title);

    var body = document.createElement('p');
    body.textContent = snapshot.alert.body;
    card.appendChild(body);

    var button = document.createElement('button');
    button.className = 'ai-shell-recovery-btn';
    button.type = 'button';
    button.textContent = snapshot.alert.actionLabel;
    button.addEventListener('click', function () {
      if (snapshot.alert.action) snapshot.alert.action();
    });
    card.appendChild(button);

    shell.appendChild(card);
  }

  function renderShell() {
    var shell = document.getElementById('ai-shell');
    var mainBody = document.getElementById('main-body');
    var aiState = window.__tribexAiState;

    if (!shell || !mainBody || !activeSession || !aiState) {
      clearShell();
      return;
    }

    var snapshot = aiState.getSnapshot();
    shell.innerHTML = '';
    shell.classList.remove('hidden');
    mainBody.classList.add('ai-shell-visible');

    renderWorkspaceCard(shell, snapshot);
    renderActionBar(shell, aiState);
    renderProjects(shell, snapshot, aiState);
    renderRecovery(shell, snapshot);
  }

  function setActiveSession(sessionId, session) {
    if (!session || !window.__tribexAiUtils || !window.__tribexAiUtils.isAiContentType(session.contentType)) {
      activeSession = null;
      clearShell();
      return;
    }

    activeSession = {
      sessionId: sessionId,
      projectId: session.meta && session.meta.projectId ? session.meta.projectId : (session.toolArgs && session.toolArgs.projectId) || null,
      threadId: session.meta && session.meta.threadId ? session.meta.threadId : (session.toolArgs && session.toolArgs.threadId) || null,
    };

    renderShell();
  }

  window.__tribexAiShell = {
    hide: clearShell,
    render: renderShell,
    setActiveSession: setActiveSession,
  };

  if (window.__tribexAiState && typeof window.__tribexAiState.subscribe === 'function') {
    window.__tribexAiState.subscribe(function () {
      if (activeSession) renderShell();
    });
  }
})();
