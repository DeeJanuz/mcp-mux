// @ts-nocheck
/* Hosted workspace shell — org-first navigator for control-plane threads */

(function () {
  'use strict';

  var activeSession = null;
  var expandedThreadLists = Object.create(null);
  var pendingFocusKey = null;
  var searchVisible = false;

  var ICONS = {
    project:
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.08c.36 0 .7.14.95.39l.58.58c.14.14.34.22.54.22h4.85a1.75 1.75 0 0 1 1.75 1.75v5.56a1.75 1.75 0 0 1-1.75 1.75H3.5A1.75 1.75 0 0 1 1.75 11.5v-6.75Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '</svg>',
    projectAdd:
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.08c.36 0 .7.14.95.39l.58.58c.14.14.34.22.54.22h4.85a1.75 1.75 0 0 1 1.75 1.75v5.56a1.75 1.75 0 0 1-1.75 1.75H3.5A1.75 1.75 0 0 1 1.75 11.5v-6.75Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M11.25 6.1v3.8M9.35 8h3.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '</svg>',
    filter:
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="M2.25 3.25h11.5L9.5 8.05v3.2l-3 1.45v-4.65L2.25 3.25Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '</svg>',
    chatAdd:
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="M3.5 3.25h9A1.25 1.25 0 0 1 13.75 4.5v5A1.25 1.25 0 0 1 12.5 10.75H7.1L4 13V10.75H3.5A1.25 1.25 0 0 1 2.25 9.5v-5A1.25 1.25 0 0 1 3.5 3.25Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M8 5.6v2.8M6.6 7h2.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '</svg>',
    settings:
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="M6.8 1.85h2.4l.35 1.4c.29.1.57.21.83.35l1.28-.7 1.7 1.7-.7 1.28c.14.27.25.55.35.83l1.4.35v2.4l-1.4.35c-.1.29-.21.57-.35.83l.7 1.28-1.7 1.7-1.28-.7c-.26.14-.54.25-.83.35l-.35 1.4H6.8l-.35-1.4a5.2 5.2 0 0 1-.83-.35l-1.28.7-1.7-1.7.7-1.28a5.2 5.2 0 0 1-.35-.83l-1.4-.35v-2.4l1.4-.35c.1-.28.21-.56.35-.83l-.7-1.28 1.7-1.7 1.28.7c.26-.14.54-.25.83-.35l.35-1.4Z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>' +
      '<circle cx="8" cy="8" r="2.15" fill="none" stroke="currentColor" stroke-width="1.15"/>' +
      '</svg>',
  };

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

  function applyPendingFocus(shell) {
    if (!shell || !pendingFocusKey) return;
    var target = shell.querySelector('[data-focus-key="' + pendingFocusKey + '"]');
    pendingFocusKey = null;
    if (!target || typeof target.focus !== 'function') return;
    target.focus({ preventScroll: true });
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
      collapseButton.setAttribute('title', snapshot && snapshot.navigatorCollapsed ? 'Expand workspace navigator' : 'Collapse workspace navigator');
      collapseButton.setAttribute('aria-label', snapshot && snapshot.navigatorCollapsed ? 'Expand workspace navigator' : 'Collapse workspace navigator');
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

  function createIconButton(className, label, iconMarkup, options) {
    var button = createButton(className, '', options);
    button.innerHTML = iconMarkup;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', (options && options.title) || label);
    if (options && Object.prototype.hasOwnProperty.call(options, 'pressed')) {
      button.setAttribute('aria-pressed', options.pressed ? 'true' : 'false');
    }
    return button;
  }

  function createFolderIcon() {
    var icon = document.createElement('span');
    icon.className = 'ai-nav-group-icon';
    icon.innerHTML = ICONS.project;
    return icon;
  }

  function getOrganizationLabel(snapshot) {
    var organization = snapshot.selectedOrganization;
    return organization && organization.name ? organization.name : 'Organization';
  }

  function getPersonaLabel(persona) {
    if (!persona) return '';
    return persona.displayName || persona.name || persona.key || '';
  }

  function getSearchEnabled(snapshot) {
    return searchVisible || !!String(snapshot && snapshot.searchTerm || '').trim();
  }

  function toggleSearch(snapshot, aiState) {
    var hasTerm = !!String(snapshot && snapshot.searchTerm || '').trim();
    if (searchVisible || hasTerm) {
      searchVisible = false;
      if (hasTerm && aiState && typeof aiState.setSearchTerm === 'function') {
        aiState.setSearchTerm('');
      } else {
        renderShell();
      }
      return;
    }

    searchVisible = true;
    pendingFocusKey = 'thread-search';
    renderShell();
  }

  function openSettingsPanel() {
    var appsButton = document.getElementById('apps-button');
    if (appsButton && typeof appsButton.click === 'function') appsButton.click();
  }

  function createThreadStateMarker(thread) {
    var state = String(thread && thread.rowState || '').toLowerCase();
    var marker = document.createElement('span');
    marker.className = 'ai-nav-thread-state-marker';

    if (thread && thread.optimistic) {
      marker.classList.add('pending');
      return marker;
    }

    if (state === 'creating' || state === 'syncing') {
      marker.classList.add('busy');
      return marker;
    }

    if (state === 'pending' || state === 'error') {
      marker.classList.add(state === 'error' ? 'error' : 'pending');
      return marker;
    }

    return null;
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
      title.textContent = 'Connect a hosted workspace';
      copy.textContent = 'Set `first_party_ai.base_url` in `~/.mcpviews/config.json` to connect a hosted control plane that provides organizations, folders, personas, and threads.';
      root.appendChild(panel);
      return;
    }

    if (snapshot.integration.status === 'error') {
      title.textContent = 'Unable to load workspace';
      copy.textContent = snapshot.integration.error || 'The workspace navigation could not be loaded right now.';
      panel.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Retry', {
        onClick: function () {
          aiState.refreshNavigator(true);
        },
      }));
      root.appendChild(panel);
      return;
    }

    title.textContent = 'Sign in to workspace';
    copy.textContent = snapshot.integration.magicLinkSentTo
      ? 'Paste the localhost verification URL or token to finish linking this desktop client.'
      : 'Send yourself a magic link so this desktop client can attach to your workspace.';

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

  function renderHeaderPanel(root, snapshot, aiState) {
    var organization = snapshot.selectedOrganization;
    var workspace = snapshot.selectedWorkspace;
    var header = document.createElement('div');
    header.className = 'ai-nav-toolbar';

    var copy = document.createElement('div');
    copy.className = 'ai-nav-toolbar-copy';

    var title = document.createElement('strong');
    title.className = 'ai-nav-toolbar-title';
    title.textContent = 'Threads';
    copy.appendChild(title);

    var subtitle = document.createElement('span');
    subtitle.className = 'ai-nav-toolbar-subtitle';
    subtitle.textContent = (organization && organization.name)
      ? organization.name + (workspace && workspace.packageKey ? ' · ' + workspace.packageKey : '')
      : 'Connected workspace';
    copy.appendChild(subtitle);
    header.appendChild(copy);

    var actions = document.createElement('div');
    actions.className = 'ai-nav-toolbar-actions';

    actions.appendChild(createIconButton('ai-nav-icon-button', 'Create folder', ICONS.projectAdd, {
      disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator || !snapshot.selectedWorkspace,
      onClick: function () {
        aiState.openProjectComposer();
      },
    }));

    actions.appendChild(createIconButton(
      'ai-nav-icon-button' + (getSearchEnabled(snapshot) ? ' active' : ''),
      getSearchEnabled(snapshot) ? 'Clear thread filter' : 'Filter threads',
      ICONS.filter,
      {
        pressed: getSearchEnabled(snapshot),
        disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator,
        onClick: function () {
          toggleSearch(snapshot, aiState);
        },
      }
    ));

    header.appendChild(actions);
    root.appendChild(header);

    if ((snapshot.organizations || []).length > 1) {
      var orgSelector = document.createElement('div');
      orgSelector.className = 'ai-nav-org-switcher';
      (snapshot.organizations || []).forEach(function (organizationItem) {
        var button = createButton(
          'ai-nav-org-chip' + (
            snapshot.selectedOrganization && snapshot.selectedOrganization.id === organizationItem.id ? ' active' : ''
          ),
          organizationItem.name,
          {
            onClick: function () {
              aiState.selectOrganization(organizationItem.id);
            },
          }
        );
        orgSelector.appendChild(button);
      });
      root.appendChild(orgSelector);
    }
  }

  function renderProjectControls(root, snapshot, aiState) {
    if (!getSearchEnabled(snapshot)) return;

    var search = document.createElement('div');
    search.className = 'ai-nav-search-row';
    var input = document.createElement('input');
    input.className = 'ai-nav-search-input';
    input.setAttribute('data-focus-key', 'thread-search');
    input.type = 'search';
    input.placeholder = 'Filter threads';
    input.value = snapshot.searchTerm || '';
    input.addEventListener('input', function (event) {
      aiState.setSearchTerm(event.target.value);
    });
    search.appendChild(input);
    root.appendChild(search);
  }

  function renderEmptyState(root, snapshot, aiState) {
    var panel = document.createElement('div');
    panel.className = 'ai-nav-list ai-nav-list-empty';

    var empty = document.createElement('div');
    empty.className = 'ai-nav-empty-state';

    var title = document.createElement('strong');
    title.textContent = snapshot.loadingNavigator
      ? 'Syncing folders'
      : String(snapshot.searchTerm || '').trim()
        ? 'No chats match this search'
        : !snapshot.selectedOrganization
          ? 'No organizations available'
          : !snapshot.hasProjects
            ? 'No folders yet'
            : 'No workspace threads yet';
    empty.appendChild(title);

    var copy = document.createElement('p');
    copy.textContent = snapshot.loadingNavigator
      ? 'Refreshing folders and workspace thread history.'
      : !snapshot.selectedOrganization
        ? 'Refresh after your workspace access is provisioned.'
        : snapshot.hasProjects
          ? 'Create a chat in the selected folder or switch to another folder to keep working.'
          : 'Create the first folder for this organization, or start a chat and MCPViews will bootstrap General once.';
    empty.appendChild(copy);

    if (!String(snapshot.searchTerm || '').trim() && !snapshot.loadingNavigator) {
      var actionRow = document.createElement('div');
      actionRow.className = 'ai-nav-empty-actions';

      if (!snapshot.selectedOrganization) {
        actionRow.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Refresh', {
          disabled: snapshot.integration.status !== 'authenticated',
          onClick: function () {
            aiState.refreshNavigator(true);
          },
        }));
      } else if (!snapshot.hasProjects) {
        actionRow.appendChild(createButton('ai-nav-action ai-nav-action-primary', 'Create first folder', {
          disabled: snapshot.integration.status !== 'authenticated',
          onClick: function () {
            aiState.openProjectComposer();
          },
        }));
        actionRow.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Create first chat', {
          disabled: snapshot.integration.status !== 'authenticated',
          onClick: function () {
            aiState.openThreadComposer().catch(function () {});
          },
        }));
      } else {
        actionRow.appendChild(createButton('ai-nav-action ai-nav-action-primary', 'Create first chat', {
          disabled: snapshot.integration.status !== 'authenticated' || !snapshot.selectedProject,
          onClick: function () {
            aiState.openThreadComposer({ projectId: snapshot.selectedProject && snapshot.selectedProject.id }).catch(function () {});
          },
        }));
      }
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
  }

  function renderProjectSections(root, snapshot, aiState) {
    var groups = snapshot.projectGroups || [];
    if (!groups.length) {
      renderEmptyState(root, snapshot, aiState);
      return;
    }

    var panel = document.createElement('div');
    panel.className = 'ai-nav-list';

    groups.forEach(function (group) {
      var expanded = !!(snapshot.projectExpansion && snapshot.projectExpansion[group.project.id] !== false && (
        snapshot.projectExpansion[group.project.id] === true || snapshot.activeProjectId === group.project.id
      ));

      var section = document.createElement('section');
      section.className = 'ai-nav-list-group' + (snapshot.activeProjectId === group.project.id ? ' active' : '');

      var row = document.createElement('div');
      row.className = 'ai-nav-project-row' + (snapshot.activeProjectId === group.project.id ? ' active' : '');

      var projectButton = document.createElement('button');
      projectButton.className = 'ai-nav-project-trigger' + (snapshot.activeProjectId === group.project.id ? ' active' : '');
      projectButton.type = 'button';
      projectButton.title = group.project.name;
      projectButton.addEventListener('click', function () {
        if (snapshot.activeProjectId === group.project.id && expanded) {
          aiState.toggleProjectExpanded(group.project.id);
          return;
        }
        aiState.selectProject(group.project.id, { expand: true });
      });
      projectButton.appendChild(createFolderIcon());

      var label = document.createElement('span');
      label.className = 'ai-nav-project-name';
      label.textContent = group.project.name;
      projectButton.appendChild(label);

      if (snapshot.activeProjectId === group.project.id) {
        var activeBadge = document.createElement('span');
        activeBadge.className = 'ai-nav-project-active-marker';
        activeBadge.textContent = 'Active';
        projectButton.appendChild(activeBadge);
      }

      row.appendChild(projectButton);

      var newThreadButton = createIconButton('ai-nav-project-thread-action', 'New chat in ' + group.project.name, ICONS.chatAdd, {
        title: 'New chat in ' + group.project.name,
        disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator,
        onClick: function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          aiState.openThreadComposer({ projectId: group.project.id }).catch(function () {});
        },
      });
      row.appendChild(newThreadButton);

      section.appendChild(row);

      if (expanded) {
        var list = document.createElement('div');
        list.className = 'ai-nav-thread-list';
        var showAll = !!expandedThreadLists[group.project.id] || !!String(snapshot.searchTerm || '').trim();
        var visibleThreads = showAll ? group.threads : group.threads.slice(0, 5);

        visibleThreads.forEach(function (thread) {
          var button = document.createElement('button');
          button.className = 'ai-nav-thread-row ai-nav-thread-tree-row' + (snapshot.activeThreadId === thread.id ? ' active' : '');
          button.type = 'button';
          button.title = thread.title;
          button.addEventListener('click', function () {
            aiState.openThread(thread.id);
          });

          var titleWrap = document.createElement('div');
          titleWrap.className = 'ai-nav-thread-title-wrap';

          var stateMarker = createThreadStateMarker(thread);
          if (stateMarker) titleWrap.appendChild(stateMarker);

          var threadTitle = document.createElement('span');
          threadTitle.className = 'ai-nav-thread-row-title';
          threadTitle.textContent = thread.title;
          titleWrap.appendChild(threadTitle);
          button.appendChild(titleWrap);

          var time = document.createElement('span');
          time.className = 'ai-nav-thread-row-time';
          time.textContent = thread.lastActivityAt
            ? window.__tribexAiUtils.formatRelativeTime(thread.lastActivityAt)
            : thread.optimistic
              ? 'Creating'
              : 'Open';
          button.appendChild(time);
          list.appendChild(button);
        });

        if (group.threads.length > 5) {
          list.appendChild(createButton('ai-nav-show-more', showAll ? 'Show less' : 'Show more', {
            onClick: function () {
              expandedThreadLists[group.project.id] = !showAll;
              renderShell();
            },
          }));
        }

        section.appendChild(list);
      }

      panel.appendChild(section);
    });

    root.appendChild(panel);
  }

  function renderFooter(root, snapshot, aiState) {
    var footer = document.createElement('div');
    footer.className = 'ai-nav-footer';

    if (snapshot.canRunSmokeTest) {
      footer.appendChild(createButton('ai-nav-footer-link', 'Run smoke test', {
        disabled: snapshot.integration.status !== 'authenticated' || snapshot.loadingNavigator || !snapshot.selectedWorkspace,
        onClick: function () {
          aiState.runSmokeTest();
        },
      }));
    }

    var settings = createButton('ai-nav-settings-button', 'Settings', {
      title: 'Open apps and settings',
      onClick: function () {
        openSettingsPanel();
      },
    });
    settings.insertAdjacentHTML('afterbegin', ICONS.settings);
    footer.appendChild(settings);
    root.appendChild(footer);
  }

  function renderProjectComposerModal(shell, snapshot, aiState) {
    if (!snapshot.projectComposerOpen) return;

    var backdrop = document.createElement('div');
    backdrop.className = 'ai-nav-modal-backdrop';

    var modal = document.createElement('section');
    modal.className = 'ai-nav-modal';

    var header = document.createElement('div');
    header.className = 'ai-nav-modal-header';

    var title = document.createElement('strong');
    title.textContent = 'Create folder';
    header.appendChild(title);
    header.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Cancel', {
      onClick: function () {
        aiState.closeProjectComposer();
      },
    }));
    modal.appendChild(header);

    var form = document.createElement('div');
    form.className = 'ai-nav-auth-form';

    var nameInput = document.createElement('input');
    nameInput.className = 'ai-nav-auth-input';
    nameInput.type = 'text';
    nameInput.setAttribute('data-focus-key', 'project-name');
    nameInput.placeholder = 'Folder name';
    nameInput.value = snapshot.composer.projectName || '';
    nameInput.addEventListener('input', function (event) {
      aiState.setProjectDraftName(event.target.value);
    });
    form.appendChild(nameInput);

    if (snapshot.integration && snapshot.integration.error) {
      var error = document.createElement('p');
      error.className = 'ai-nav-helper ai-nav-helper-error';
      error.textContent = snapshot.integration.error;
      form.appendChild(error);
    }

    var actions = document.createElement('div');
    actions.className = 'ai-nav-auth-actions';
    actions.appendChild(createButton(
      'ai-nav-action ai-nav-action-primary',
      snapshot.composer.creatingProject ? 'Creating...' : 'Create folder',
      {
        disabled: !!snapshot.composer.creatingProject,
        onClick: function () {
          aiState.createProject().catch(function () {});
        },
      }
    ));
    form.appendChild(actions);
    modal.appendChild(form);
    backdrop.appendChild(modal);
    shell.appendChild(backdrop);
  }

  function renderThreadComposerModal(shell, snapshot, aiState) {
    if (!snapshot.threadComposerOpen) return;

    var targetProjectId = snapshot.composer.threadProjectId || (snapshot.selectedProject && snapshot.selectedProject.id) || null;
    var targetProject = null;
    (snapshot.projectGroups || []).some(function (group) {
      if (group.project && group.project.id === targetProjectId) {
        targetProject = group.project;
        return true;
      }
      return false;
    });
    var personas = targetProjectId
      ? (snapshot.composer.threadPersonasByProjectId[targetProjectId] || [])
      : [];

    var backdrop = document.createElement('div');
    backdrop.className = 'ai-nav-modal-backdrop';

    var modal = document.createElement('section');
    modal.className = 'ai-nav-modal';

    var header = document.createElement('div');
    header.className = 'ai-nav-modal-header';

    var title = document.createElement('strong');
    title.textContent = 'Create chat';
    header.appendChild(title);
    header.appendChild(createButton('ai-nav-action ai-nav-action-secondary', 'Cancel', {
      onClick: function () {
        aiState.closeThreadComposer();
      },
    }));
    modal.appendChild(header);

    var form = document.createElement('div');
    form.className = 'ai-nav-auth-form';

    if (targetProject) {
      var helper = document.createElement('p');
      helper.className = 'ai-nav-helper';
      helper.textContent = 'Folder: ' + targetProject.name;
      form.appendChild(helper);
    }

    var nameInput = document.createElement('input');
    nameInput.className = 'ai-nav-auth-input';
    nameInput.type = 'text';
    nameInput.setAttribute('data-focus-key', 'thread-name');
    nameInput.placeholder = 'Chat title';
    nameInput.value = snapshot.composer.threadTitle || '';
    nameInput.addEventListener('input', function (event) {
      aiState.setThreadDraftName(event.target.value);
    });
    form.appendChild(nameInput);

    var personaLabel = document.createElement('label');
    personaLabel.className = 'ai-nav-helper';
    personaLabel.textContent = 'Persona';
    form.appendChild(personaLabel);

    if (snapshot.composer.loadingThreadPersonas) {
      var loading = document.createElement('p');
      loading.className = 'ai-nav-helper';
      loading.textContent = 'Loading personas...';
      form.appendChild(loading);
    } else {
      var select = document.createElement('select');
      select.className = 'ai-nav-auth-input';
      select.setAttribute('data-focus-key', 'thread-persona');
      select.value = snapshot.composer.selectedPersonaKey || '';
      select.addEventListener('change', function (event) {
        aiState.setThreadDraftPersona(event.target.value);
      });

      if (!personas.length) {
        var emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'No personas available';
        select.appendChild(emptyOption);
      } else {
        personas.forEach(function (persona) {
          var option = document.createElement('option');
          option.value = persona.key;
          option.textContent = getPersonaLabel(persona);
          select.appendChild(option);
        });
      }

      select.value = snapshot.composer.selectedPersonaKey || (personas[0] && personas[0].key) || '';
      form.appendChild(select);
    }

    if (snapshot.composer.threadPersonaError) {
      var personaError = document.createElement('p');
      personaError.className = 'ai-nav-helper ai-nav-helper-error';
      personaError.textContent = snapshot.composer.threadPersonaError;
      form.appendChild(personaError);
    }

    if (snapshot.integration && snapshot.integration.error) {
      var error = document.createElement('p');
      error.className = 'ai-nav-helper ai-nav-helper-error';
      error.textContent = snapshot.integration.error;
      form.appendChild(error);
    }

    var actions = document.createElement('div');
    actions.className = 'ai-nav-auth-actions';
    actions.appendChild(createButton(
      'ai-nav-action ai-nav-action-primary',
      snapshot.composer.creatingThread ? 'Creating...' : 'Create chat',
      {
        disabled: !!snapshot.composer.creatingThread || !!snapshot.composer.loadingThreadPersonas || !snapshot.composer.selectedPersonaKey,
        onClick: function () {
          aiState.submitThreadComposer().catch(function () {});
        },
      }
    ));
    form.appendChild(actions);
    modal.appendChild(form);
    backdrop.appendChild(modal);
    shell.appendChild(backdrop);
  }

  function renderCollapsed(shell, snapshot, aiState) {
    var stack = document.createElement('div');
    stack.className = 'ai-nav-collapsed-stack';

    stack.appendChild(createButton('ai-nav-collapsed-button', window.__tribexAiUtils.initials(getOrganizationLabel(snapshot)), {
      title: getOrganizationLabel(snapshot),
      onClick: function () {
        aiState.toggleNavigatorCollapsed();
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
      stack.appendChild(createButton(
        'ai-nav-collapsed-button ai-nav-collapsed-project' + (snapshot.activeProjectId === group.project.id ? ' active' : ''),
        window.__tribexAiUtils.initials(group.project.name),
        {
          title: group.project.name,
          onClick: function () {
            aiState.selectProject(group.project.id, { expand: true });
          },
        }
      ));
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
      renderProjectComposerModal(shell, snapshot, aiState);
      renderThreadComposerModal(shell, snapshot, aiState);
      restoreFocusState(shell, focusState);
      return;
    }

    var frame = document.createElement('div');
    frame.className = 'ai-nav-frame ai-nav-rail';

    renderHeaderPanel(frame, snapshot, aiState);

    if (snapshot.integration.status === 'authenticated' || snapshot.loadingNavigator) {
      renderProjectControls(frame, snapshot, aiState);
      renderProjectSections(frame, snapshot, aiState);
    } else {
      renderAuthPanel(frame, snapshot, aiState);
    }

    renderFooter(frame, snapshot, aiState);

    shell.appendChild(frame);
    renderProjectComposerModal(shell, snapshot, aiState);
    renderThreadComposerModal(shell, snapshot, aiState);
    restoreFocusState(shell, focusState);
    applyPendingFocus(shell);
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
