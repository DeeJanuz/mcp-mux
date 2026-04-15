// @ts-nocheck
/* TribeX AI shell — Codex-style left rail for hosted chat threads */

(function () {
  'use strict';

  var activeSession = null;

  function captureFocusState(shell) {
    var active = document.activeElement;
    if (!shell || !active || !shell.contains(active) || typeof active.getAttribute !== 'function') {
      return null;
    }

    var focusKey = active.getAttribute('data-focus-key');
    if (!focusKey) return null;

    return {
      key: focusKey,
      selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
    };
  }

  function restoreFocusState(shell, focusState) {
    if (!shell || !focusState || !focusState.key) return;
    var selector = '[data-focus-key="' + focusState.key + '"]';
    var target = shell.querySelector(selector);
    if (!target || typeof target.focus !== 'function') return;

    target.focus({ preventScroll: true });
    if (
      typeof target.setSelectionRange === 'function' &&
      typeof focusState.selectionStart === 'number' &&
      typeof focusState.selectionEnd === 'number'
    ) {
      target.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
    }
  }

  function setModeClasses(aiModeActive, aiSessionActive) {
    document.body.classList.toggle('ai-mode-active', !!aiModeActive);
    document.body.classList.toggle('ai-mode-session-active', !!aiSessionActive);
  }

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
    var navigatorVisible = !!(snapshot && snapshot.navigatorVisible);
    var aiSessionActive = !!(activeSession && activeSession.isAiSession);
    var aiModeActive = navigatorVisible || aiSessionActive;

    setModeClasses(aiModeActive, aiSessionActive);

    if (aiButton) {
      if (aiModeActive) aiButton.classList.add('active');
      else aiButton.classList.remove('active');
    }

    if (collapseButton) {
      collapseButton.style.display = navigatorVisible ? '' : 'none';
      collapseButton.setAttribute('title', snapshot && snapshot.navigatorCollapsed ? 'Expand AI navigator' : 'Collapse AI navigator');
      collapseButton.setAttribute('aria-label', snapshot && snapshot.navigatorCollapsed ? 'Expand AI navigator' : 'Collapse AI navigator');
      collapseButton.textContent = snapshot && snapshot.navigatorCollapsed ? '>' : '<';
    }
  }

  function createButton(className, label, options) {
    var button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.textContent = label;
    if (options && options.title) button.title = options.title;
    if (options && options.disabled) button.disabled = true;
    if (options && typeof options.onClick === 'function') {
      button.addEventListener('click', options.onClick);
    }
    return button;
  }

  function createPillRow(values) {
    var row = document.createElement('div');
    row.className = 'ai-nav-badge-row';

    values.filter(Boolean).forEach(function (entry) {
      var badge = document.createElement('span');
      badge.className = 'ai-nav-badge' + (entry.accent ? ' ai-nav-badge-accent' : '');
      badge.textContent = entry.label;
      row.appendChild(badge);
    });

    return row;
  }

  function createFolderIcon() {
    var icon = document.createElement('span');
    icon.className = 'ai-nav-group-icon';
    icon.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.08c.36 0 .7.14.95.39l.58.58c.14.14.34.22.54.22h4.85a1.75 1.75 0 0 1 1.75 1.75v5.56a1.75 1.75 0 0 1-1.75 1.75H3.5A1.75 1.75 0 0 1 1.75 11.5v-6.75Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>' +
      '</svg>';
    return icon;
  }

  function buildGroupSubtitle(group) {
    if (!group || !group.project) return '';
    if (group.project.workspaceName && group.project.workspaceName !== group.project.name) {
      return group.project.workspaceName;
    }
    return '';
  }

  function renderAuthPanel(root, snapshot, aiState) {
    var panel = document.createElement('section');
    panel.className = 'ai-nav-auth-panel';

    var title = document.createElement('strong');
    title.className = 'ai-nav-auth-title';
    panel.appendChild(title);

    var copy = document.createElement('p');
    copy.className = 'ai-nav-auth-copy';
    panel.appendChild(copy);

    if (!snapshot.integration.config || !snapshot.integration.config.configured) {
      title.textContent = 'Connect MCPViews to ProPaasAI';
      copy.textContent = 'Set `first_party_ai.base_url` in `~/.mcpviews/config.json` to enable organizations, workspaces, and hosted threads.';
      root.appendChild(panel);
      return;
    }

    if (snapshot.integration.status === 'error') {
      title.textContent = 'Unable to load the AI workspace';
      copy.textContent = snapshot.integration.error || 'The hosted workspace could not be loaded right now.';
      panel.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Retry', {
        onClick: function () {
          aiState.refreshNavigator(true);
        },
      }));
      root.appendChild(panel);
      return;
    }

    title.textContent = 'Sign in to hosted AI';
    copy.textContent = snapshot.integration.magicLinkSentTo
      ? 'Paste the localhost verification URL or token to finish linking this desktop client.'
      : 'Send yourself a magic link so this desktop client can attach to your hosted workspace.';

    var form = document.createElement('div');
    form.className = 'ai-nav-auth-form';

    var emailInput = document.createElement('input');
    emailInput.className = 'ai-nav-auth-input';
    emailInput.setAttribute('data-focus-key', 'auth-email');
    emailInput.type = 'email';
    emailInput.placeholder = 'you@company.com';
    emailInput.value = snapshot.integration.authEmail || '';
    emailInput.addEventListener('input', function (event) {
      aiState.setAuthEmail(event.target.value);
    });
    form.appendChild(emailInput);

    var actions = document.createElement('div');
    actions.className = 'ai-nav-auth-actions';
    actions.appendChild(createButton('ai-nav-action ai-nav-action-primary', snapshot.integration.sendingMagicLink ? 'Sending...' : 'Send magic link', {
      disabled: !!snapshot.integration.sendingMagicLink,
      onClick: function () {
        aiState.sendMagicLink().catch(function () {});
      },
    }));
    form.appendChild(actions);

    if (snapshot.integration.magicLinkSentTo) {
      var sent = document.createElement('p');
      sent.className = 'ai-nav-helper';
      sent.textContent = 'Magic link sent to ' + snapshot.integration.magicLinkSentTo + '.';
      form.appendChild(sent);
    }

    var verifyInput = document.createElement('input');
    verifyInput.className = 'ai-nav-auth-input';
    verifyInput.setAttribute('data-focus-key', 'verification-input');
    verifyInput.type = 'text';
    verifyInput.placeholder = 'Paste magic link URL or token';
    verifyInput.value = snapshot.integration.verificationInput || '';
    verifyInput.addEventListener('input', function (event) {
      aiState.setVerificationInput(event.target.value);
    });
    form.appendChild(verifyInput);

    actions = document.createElement('div');
    actions.className = 'ai-nav-auth-actions';
    actions.appendChild(createButton('ai-nav-action ai-nav-action-secondary', snapshot.integration.verifyingMagicLink ? 'Verifying...' : 'Verify link', {
      disabled: !!snapshot.integration.verifyingMagicLink,
      onClick: function () {
        aiState.verifyMagicLink().catch(function () {});
      },
    }));
    form.appendChild(actions);

    if (snapshot.integration.error) {
      var error = document.createElement('p');
      error.className = 'ai-nav-helper ai-nav-helper-error';
      error.textContent = snapshot.integration.error;
      form.appendChild(error);
    }

    panel.appendChild(form);
    root.appendChild(panel);
  }

  function renderBrandPanel(root, snapshot, aiState) {
    var workspace = snapshot.preferredWorkspace;
    var organization = snapshot.selectedOrganization;
    var panel = document.createElement('section');
    panel.className = 'ai-nav-brand-panel';

    var header = document.createElement('div');
    header.className = 'ai-nav-brand-row';

    var mark = document.createElement('div');
    mark.className = 'ai-nav-brand-mark';
    mark.textContent = window.__tribexAiUtils.initials((organization && organization.name) || (workspace && workspace.name) || 'AI');
    header.appendChild(mark);

    var copy = document.createElement('div');
    copy.className = 'ai-nav-brand-copy';

    var kicker = document.createElement('span');
    kicker.className = 'ai-nav-kicker';
    kicker.textContent = 'AI mode';
    copy.appendChild(kicker);

    var title = document.createElement('strong');
    title.className = 'ai-nav-title';
    title.textContent = (workspace && workspace.name) || (organization && organization.name) || 'Hosted workspace';
    copy.appendChild(title);

    var subtitle = document.createElement('span');
    subtitle.className = 'ai-nav-subtitle';
    subtitle.textContent = (organization && organization.name)
      ? organization.name + (workspace && workspace.packageKey ? ' · ' + workspace.packageKey : '')
      : 'Hosted companion and sandbox threads';
    copy.appendChild(subtitle);
    header.appendChild(copy);

    var switchButton = createButton('ai-nav-org-switch', 'Switch', {
      disabled: snapshot.organizations.length <= 1,
      onClick: function () {
        aiState.toggleOrganizationMenu();
      },
    });
    header.appendChild(switchButton);
    panel.appendChild(header);

    panel.appendChild(createPillRow([
      snapshot.loadingNavigator ? { label: 'Syncing', accent: true } : null,
      snapshot.integration.status === 'authenticated' ? { label: 'Connected' } : { label: 'Sign in required' },
      workspace && workspace.packageKey === 'smoke' ? { label: 'Smoke workspace', accent: true } : null,
      snapshot.activeThreadId ? { label: 'Thread active' } : null,
    ]));

    if (snapshot.organizationMenuOpen && snapshot.organizations.length > 1) {
      var menu = document.createElement('div');
      menu.className = 'ai-nav-org-menu';
      snapshot.organizations.forEach(function (organizationItem) {
        var button = createButton(
          'ai-nav-action ai-nav-action-secondary ai-nav-org-item' + (
            snapshot.selectedOrganization && snapshot.selectedOrganization.id === organizationItem.id ? ' active' : ''
          ),
          organizationItem.name,
          {
            onClick: function () {
              aiState.selectOrganization(organizationItem.id);
            },
          }
        );
        menu.appendChild(button);
      });
      panel.appendChild(menu);
    }

    root.appendChild(panel);
  }

  function renderControls(root, snapshot, aiState) {
    var controls = document.createElement('section');
    controls.className = 'ai-nav-tools';

    var search = document.createElement('div');
    search.className = 'ai-nav-search-shell';
    var input = document.createElement('input');
    input.className = 'ai-nav-search-input';
    input.setAttribute('data-focus-key', 'thread-search');
    input.type = 'search';
    input.placeholder = 'Search conversations';
    input.value = snapshot.searchTerm || '';
    input.addEventListener('input', function (event) {
      aiState.setSearchTerm(event.target.value);
    });
    search.appendChild(input);
    controls.appendChild(search);

    var actions = document.createElement('div');
    actions.className = 'ai-nav-action-grid';

    actions.appendChild(createButton('ai-nav-action ai-nav-action-primary', 'New chat', {
      disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator,
      onClick: function () {
        aiState.createThread();
      },
    }));

    if (snapshot.canRunSmokeTest) {
      actions.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Run smoke test', {
        disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator,
        onClick: function () {
          aiState.runSmokeTest();
        },
      }));
    }

    actions.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Refresh', {
      disabled: snapshot.loadingNavigator,
      onClick: function () {
        aiState.refreshNavigator(true);
      },
    }));

    controls.appendChild(actions);
    root.appendChild(controls);
  }

  function renderThreadSections(root, snapshot, aiState) {
    var groups = snapshot.projectGroups || [];
    var panel = document.createElement('section');
    panel.className = 'ai-nav-thread-panel';

    if (!groups.length) {
      var empty = document.createElement('div');
      empty.className = 'ai-nav-empty-state';

      var title = document.createElement('strong');
      title.textContent = snapshot.loadingNavigator
        ? 'Syncing conversations'
        : String(snapshot.searchTerm || '').trim()
          ? 'No conversations match this search'
          : 'No hosted threads yet';
      empty.appendChild(title);

      var copy = document.createElement('p');
      copy.textContent = snapshot.loadingNavigator
        ? 'Fetching projects, workspaces, and hosted thread history from ProPaasAI.'
        : snapshot.hasProjects
          ? 'Create a chat to start a new hosted sandbox thread.'
          : 'Create a chat and MCPViews will bootstrap the first project for this organization.';
      empty.appendChild(copy);

      if (!String(snapshot.searchTerm || '').trim() && !snapshot.loadingNavigator) {
        var actionRow = document.createElement('div');
        actionRow.className = 'ai-nav-empty-actions';
        actionRow.appendChild(createButton('ai-nav-action ai-nav-action-primary', 'Create first chat', {
          disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator,
          onClick: function () {
            aiState.createThread();
          },
        }));
        empty.appendChild(actionRow);
      }

      if (snapshot.integration && snapshot.integration.error) {
        var error = document.createElement('p');
        error.className = 'ai-nav-helper ai-nav-helper-error';
        error.textContent = snapshot.integration.error;
        empty.appendChild(error);
      }

      panel.appendChild(empty);
      root.appendChild(panel);
      return;
    }

    groups.forEach(function (group) {
      var section = document.createElement('div');
      section.className = 'ai-nav-section';

      var heading = document.createElement('div');
      heading.className = 'ai-nav-section-heading';

      var row = document.createElement('div');
      row.className = 'ai-nav-group-row';
      row.appendChild(createFolderIcon());

      var copy = document.createElement('div');
      copy.className = 'ai-nav-section-copy';

      var label = document.createElement('strong');
      label.textContent = group.project.name;
      copy.appendChild(label);

      var subtitleText = buildGroupSubtitle(group);
      if (subtitleText) {
        var meta = document.createElement('span');
        meta.textContent = subtitleText;
        copy.appendChild(meta);
      }
      row.appendChild(copy);
      heading.appendChild(row);

      var count = document.createElement('span');
      count.className = 'ai-nav-section-count';
      count.textContent = String(group.threads.length);
      heading.appendChild(count);
      section.appendChild(heading);

      var list = document.createElement('div');
      list.className = 'ai-nav-section-list ai-nav-thread-tree-list';
      group.threads.forEach(function (thread) {
        var button = document.createElement('button');
        button.className = 'ai-nav-thread-row ai-nav-thread-tree-row' + (snapshot.activeThreadId === thread.id ? ' active' : '');
        button.type = 'button';
        button.title = thread.title;
        button.addEventListener('click', function () {
          aiState.openThread(thread.id);
        });

        var main = document.createElement('div');
        main.className = 'ai-nav-thread-row-main';

        var title = document.createElement('span');
        title.className = 'ai-nav-thread-row-title';
        title.textContent = thread.title;
        main.appendChild(title);

        var time = document.createElement('span');
        time.className = 'ai-nav-thread-row-time';
        time.textContent = thread.lastActivityAt
          ? window.__tribexAiUtils.formatRelativeTime(thread.lastActivityAt)
          : 'Open';
        main.appendChild(time);
        button.appendChild(main);

        list.appendChild(button);
      });
      section.appendChild(list);
      panel.appendChild(section);
    });

    root.appendChild(panel);
  }

  function renderCollapsed(shell, snapshot, aiState) {
    var stack = document.createElement('div');
    stack.className = 'ai-nav-collapsed-stack';

    stack.appendChild(createButton('ai-nav-collapsed-button', window.__tribexAiUtils.initials(
      (snapshot.selectedOrganization && snapshot.selectedOrganization.name) ||
      (snapshot.preferredWorkspace && snapshot.preferredWorkspace.name) ||
      'AI'
    ), {
      title: (snapshot.selectedOrganization && snapshot.selectedOrganization.name) || 'AI workspace',
      onClick: function () {
        aiState.toggleOrganizationMenu();
      },
    }));

    stack.appendChild(createButton('ai-nav-collapsed-button', '+', {
      title: 'New chat',
      disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator,
      onClick: function () {
        aiState.createThread();
      },
    }));

    if (snapshot.canRunSmokeTest) {
      stack.appendChild(createButton('ai-nav-collapsed-button', 'S', {
        title: 'Run smoke test',
        disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator,
        onClick: function () {
          aiState.runSmokeTest();
        },
      }));
    }

    (snapshot.projectGroups || []).slice(0, 5).forEach(function (group) {
      group.threads.slice(0, 1).forEach(function (thread) {
        stack.appendChild(createButton(
          'ai-nav-collapsed-button ai-nav-collapsed-thread' + (snapshot.activeThreadId === thread.id ? ' active' : ''),
          window.__tribexAiUtils.initials(thread.title),
          {
            title: thread.title,
            onClick: function () {
              aiState.openThread(thread.id);
            },
          }
        ));
      });
    });

    shell.appendChild(stack);
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
    var focusState = captureFocusState(shell);
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
      restoreFocusState(shell, focusState);
      return;
    }

    var frame = document.createElement('div');
    frame.className = 'ai-nav-frame';

    renderBrandPanel(frame, snapshot, aiState);

    if (snapshot.integration.status === 'authenticated' || snapshot.loadingNavigator) {
      renderControls(frame, snapshot, aiState);
      renderThreadSections(frame, snapshot, aiState);
    } else {
      renderAuthPanel(frame, snapshot, aiState);
    }

    shell.appendChild(frame);
    restoreFocusState(shell, focusState);
  }

  function setActiveSession(sessionId, session) {
    if (!sessionId || !session) {
      activeSession = null;
    } else {
      activeSession = {
        sessionId: sessionId,
        projectId: session && session.meta ? session.meta.projectId || null : null,
        threadId: session && session.meta ? session.meta.threadId || null : null,
        isAiSession: !!(
          window.__tribexAiUtils &&
          typeof window.__tribexAiUtils.isAiContentType === 'function' &&
          window.__tribexAiUtils.isAiContentType(session.contentType)
        ),
      };
    }

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
