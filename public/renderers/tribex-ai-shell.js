// @ts-nocheck
/* TribeX AI shell — persistent slideout navigator */

(function () {
  'use strict';

  var activeSession = null;

  function clearShell() {
    var shell = document.getElementById('ai-shell');
    var mainBody = document.getElementById('main-body');
    if (!shell || !mainBody) return;
    shell.innerHTML = '';
    shell.className = 'hidden';
    mainBody.classList.remove('ai-shell-visible');
    syncChrome(null);
  }

  function syncChrome(snapshot) {
    var aiButton = document.getElementById('ai-home-button');
    var collapseButton = document.getElementById('ai-shell-toggle-button');

    if (aiButton) {
      if (snapshot && snapshot.navigatorVisible) aiButton.classList.add('active');
      else aiButton.classList.remove('active');
    }

    if (collapseButton) {
      var visible = !!(snapshot && snapshot.navigatorVisible);
      collapseButton.style.display = visible ? '' : 'none';
      collapseButton.setAttribute('title', snapshot && snapshot.navigatorCollapsed ? 'Expand AI navigator' : 'Collapse AI navigator');
      collapseButton.setAttribute('aria-label', snapshot && snapshot.navigatorCollapsed ? 'Expand AI navigator' : 'Collapse AI navigator');
      collapseButton.textContent = snapshot && snapshot.navigatorCollapsed ? '>' : '<';
    }
  }

  function renderIntegrationState(shell, snapshot, aiState) {
    var section = document.createElement('section');
    section.className = 'ai-nav-card';

    var title = document.createElement('strong');
    section.appendChild(title);

    var body = document.createElement('p');
    section.appendChild(body);

    if (!snapshot.integration.config || !snapshot.integration.config.configured) {
      title.textContent = 'ProPaasAI is not configured';
      body.textContent = 'Set `first_party_ai.base_url` in `~/.mcpviews/config.json` to load organizations, projects, and threads.';
    } else if (snapshot.integration.status === 'unauthenticated' || snapshot.integration.status === 'awaiting_verification') {
      title.textContent = 'Connect to ProPaasAI';
      body.textContent = snapshot.integration.magicLinkSentTo
        ? 'Paste the magic link URL or token after opening the email.'
        : 'Send yourself a magic link to establish a desktop session with the brokered workspace.';

      var emailInput = document.createElement('input');
      emailInput.className = 'ai-nav-search-input';
      emailInput.type = 'email';
      emailInput.placeholder = 'you@company.com';
      emailInput.value = snapshot.integration.authEmail || '';
      emailInput.addEventListener('input', function (event) {
        aiState.setAuthEmail(event.target.value);
      });
      section.appendChild(emailInput);

      var sendButton = document.createElement('button');
      sendButton.className = 'ai-nav-primary-btn';
      sendButton.type = 'button';
      sendButton.textContent = snapshot.integration.sendingMagicLink ? 'Sending…' : 'Send magic link';
      sendButton.disabled = !!snapshot.integration.sendingMagicLink;
      sendButton.addEventListener('click', function () {
        aiState.sendMagicLink().catch(function () {});
      });
      section.appendChild(sendButton);

      if (snapshot.integration.magicLinkSentTo) {
        var sent = document.createElement('p');
        sent.textContent = 'Magic link sent to ' + snapshot.integration.magicLinkSentTo + '.';
        section.appendChild(sent);
      }

      var verifyInput = document.createElement('input');
      verifyInput.className = 'ai-nav-search-input';
      verifyInput.type = 'text';
      verifyInput.placeholder = 'Paste magic link URL or token';
      verifyInput.value = snapshot.integration.verificationInput || '';
      verifyInput.addEventListener('input', function (event) {
        aiState.setVerificationInput(event.target.value);
      });
      section.appendChild(verifyInput);

      var verifyButton = document.createElement('button');
      verifyButton.className = 'ai-nav-secondary-btn';
      verifyButton.type = 'button';
      verifyButton.textContent = snapshot.integration.verifyingMagicLink ? 'Verifying…' : 'Verify link';
      verifyButton.disabled = !!snapshot.integration.verifyingMagicLink;
      verifyButton.addEventListener('click', function () {
        aiState.verifyMagicLink().catch(function () {});
      });
      section.appendChild(verifyButton);

      if (snapshot.integration.error) {
        var authError = document.createElement('p');
        authError.textContent = snapshot.integration.error;
        section.appendChild(authError);
      }
    } else if (snapshot.integration.status === 'error') {
      title.textContent = 'Unable to load the AI workspace';
      body.textContent = snapshot.integration.error || 'The hosted AI workspace could not be loaded.';
      var retry = document.createElement('button');
      retry.className = 'ai-nav-secondary-btn';
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', function () {
        aiState.refreshNavigator(true);
      });
      section.appendChild(retry);
    } else {
      title.textContent = 'Loading AI workspace';
      body.textContent = 'Fetching organizations, projects, and threads from ProPaasAI…';
    }

    shell.appendChild(section);
  }

  function renderOrgHeader(shell, snapshot, aiState) {
    var section = document.createElement('section');
    section.className = 'ai-nav-header-card';

    var org = snapshot.selectedOrganization;
    var header = document.createElement('div');
    header.className = 'ai-nav-org-row';
    header.innerHTML =
      '<div class="ai-nav-org-badge">' + window.__tribexAiUtils.initials(org && org.name) + '</div>' +
      '<div class="ai-nav-org-copy"><strong>' + ((org && org.name) || 'AI workspace') + '</strong><span>' +
      (snapshot.loadingNavigator ? 'Syncing hosted data' : 'Live thread navigator') + '</span></div>';
    section.appendChild(header);

    var actions = document.createElement('div');
    actions.className = 'ai-nav-actions';

    var newChat = document.createElement('button');
    newChat.className = 'ai-nav-primary-btn';
    newChat.type = 'button';
    newChat.textContent = 'New chat';
    newChat.disabled = !snapshot.projectGroups.length;
    newChat.addEventListener('click', function () {
      aiState.createThread();
    });
    actions.appendChild(newChat);

    var switchOrg = document.createElement('button');
    switchOrg.className = 'ai-nav-secondary-btn';
    switchOrg.type = 'button';
    switchOrg.textContent = 'Switch organization';
    switchOrg.disabled = snapshot.organizations.length <= 1;
    switchOrg.addEventListener('click', function () {
      aiState.toggleOrganizationMenu();
    });
    actions.appendChild(switchOrg);

    section.appendChild(actions);

    if (snapshot.organizationMenuOpen && snapshot.organizations.length > 1) {
      var orgList = document.createElement('div');
      orgList.className = 'ai-nav-org-list';
      snapshot.organizations.forEach(function (organization) {
        var button = document.createElement('button');
        button.className = 'ai-nav-org-item' + (snapshot.selectedOrganization && snapshot.selectedOrganization.id === organization.id ? ' active' : '');
        button.type = 'button';
        button.textContent = organization.name;
        button.addEventListener('click', function () {
          aiState.selectOrganization(organization.id);
        });
        orgList.appendChild(button);
      });
      section.appendChild(orgList);
    }

    shell.appendChild(section);
  }

  function renderSearch(shell, snapshot, aiState) {
    var section = document.createElement('section');
    section.className = 'ai-nav-search';

    var input = document.createElement('input');
    input.className = 'ai-nav-search-input';
    input.type = 'search';
    input.placeholder = 'Search threads';
    input.value = snapshot.searchTerm || '';
    input.addEventListener('input', function (event) {
      aiState.setSearchTerm(event.target.value);
    });

    section.appendChild(input);
    shell.appendChild(section);
  }

  function renderProjectGroups(shell, snapshot, aiState) {
    var list = document.createElement('div');
    list.className = 'ai-nav-project-groups';

    if (!snapshot.projectGroups.length) {
      var empty = document.createElement('section');
      empty.className = 'ai-nav-card';
      empty.innerHTML = '<strong>No threads yet</strong><p>Create the first thread once the selected organization has an active project.</p>';
      list.appendChild(empty);
      shell.appendChild(list);
      return;
    }

    snapshot.projectGroups.forEach(function (group) {
      var section = document.createElement('section');
      section.className = 'ai-nav-project-group' + (snapshot.activeProjectId === group.project.id ? ' active' : '');

      var heading = document.createElement('div');
      heading.className = 'ai-nav-project-heading';
      heading.innerHTML =
        '<strong>' + group.project.name + '</strong>' +
        '<span>' + group.threads.length + '</span>';
      section.appendChild(heading);

      if (group.project.workspaceName) {
        var meta = document.createElement('p');
        meta.className = 'ai-nav-project-meta';
        meta.textContent = group.project.workspaceName;
        section.appendChild(meta);
      }

      var threads = document.createElement('div');
      threads.className = 'ai-nav-thread-list';
      group.threads.forEach(function (thread) {
        var button = document.createElement('button');
        button.className = 'ai-nav-thread-item' + (snapshot.activeThreadId === thread.id ? ' active' : '');
        button.type = 'button';
        button.addEventListener('click', function () {
          aiState.openThread(thread.id);
        });

        var title = document.createElement('span');
        title.className = 'ai-nav-thread-title';
        title.textContent = thread.title;
        button.appendChild(title);

        var meta = document.createElement('small');
        meta.className = 'ai-nav-thread-meta';
        meta.textContent = thread.lastActivityAt
          ? window.__tribexAiUtils.formatRelativeTime(thread.lastActivityAt)
          : 'Open thread';
        button.appendChild(meta);

        threads.appendChild(button);
      });
      section.appendChild(threads);
      list.appendChild(section);
    });

    shell.appendChild(list);
  }

  function renderCollapsed(shell, snapshot, aiState) {
    var org = snapshot.selectedOrganization;

    var top = document.createElement('div');
    top.className = 'ai-nav-collapsed-top';

    var orgButton = document.createElement('button');
    orgButton.className = 'ai-nav-collapsed-icon';
    orgButton.type = 'button';
    orgButton.title = (org && org.name) || 'AI workspace';
    orgButton.textContent = window.__tribexAiUtils.initials(org && org.name);
    orgButton.addEventListener('click', function () {
      aiState.toggleOrganizationMenu();
    });
    top.appendChild(orgButton);

    var newChat = document.createElement('button');
    newChat.className = 'ai-nav-collapsed-icon';
    newChat.type = 'button';
    newChat.title = 'New chat';
    newChat.textContent = '+';
    newChat.disabled = !snapshot.projectGroups.length;
    newChat.addEventListener('click', function () {
      aiState.createThread();
    });
    top.appendChild(newChat);
    shell.appendChild(top);

    var groups = document.createElement('div');
    groups.className = 'ai-nav-collapsed-groups';
    snapshot.projectGroups.forEach(function (group) {
      var button = document.createElement('button');
      button.className = 'ai-nav-collapsed-project' + (snapshot.activeProjectId === group.project.id ? ' active' : '');
      button.type = 'button';
      button.title = group.project.name;
      button.textContent = window.__tribexAiUtils.initials(group.project.name);
      button.addEventListener('click', function () {
        if (group.threads[0]) aiState.openThread(group.threads[0].id);
      });
      groups.appendChild(button);
    });
    shell.appendChild(groups);
  }

  function renderShell() {
    var shell = document.getElementById('ai-shell');
    var mainBody = document.getElementById('main-body');
    var aiState = window.__tribexAiState;

    if (!shell || !mainBody || !aiState) {
      clearShell();
      return;
    }

    var snapshot = aiState.getSnapshot();
    syncChrome(snapshot);

    if (!snapshot.navigatorVisible) {
      clearShell();
      return;
    }

    shell.innerHTML = '';
    shell.className = snapshot.navigatorCollapsed ? 'collapsed' : '';
    mainBody.classList.add('ai-shell-visible');

    if (snapshot.navigatorCollapsed) {
      renderCollapsed(shell, snapshot, aiState);
      return;
    }

    renderOrgHeader(shell, snapshot, aiState);

    if (snapshot.integration.status === 'authenticated' || snapshot.loadingNavigator) {
      renderSearch(shell, snapshot, aiState);
    }

    if (snapshot.integration.status === 'authenticated') {
      renderProjectGroups(shell, snapshot, aiState);
    } else {
      renderIntegrationState(shell, snapshot, aiState);
    }
  }

  function setActiveSession(sessionId, session) {
    activeSession = {
      sessionId: sessionId,
      projectId: session && session.meta ? session.meta.projectId || null : null,
      threadId: session && session.meta ? session.meta.threadId || null : null,
    };

    if (window.__tribexAiState && typeof window.__tribexAiState.setActiveSession === 'function') {
      window.__tribexAiState.setActiveSession(sessionId, session);
    }
    renderShell();
  }

  window.__tribexAiShell = {
    hide: clearShell,
    render: renderShell,
    setActiveSession: setActiveSession,
    syncChrome: syncChrome,
  };

  if (window.__tribexAiState && typeof window.__tribexAiState.subscribe === 'function') {
    window.__tribexAiState.subscribe(function () {
      renderShell();
    });
  }
})();
