(function () {
  'use strict';

  var AUTH_ORG_KEY = 'decidr-onboarding:auth-org-id';
  var AGENT_CONFIGURED_KEY = 'decidr-onboarding:agent-configured-org-id';
  var LEGACY_COMPLETED_KEY = 'decidr-onboarding:completed-org-id';
  var AUTH_PLUGIN = 'decidr';
  var REQUIRED_PLUGINS = ['decidr', 'ludflow'];
  var INSTALL_PROMPT_URL = 'https://github.com/DeeJanuz/mcpviews/blob/master/docs/install-prompt.md';
  var DEFAULT_WORK_STYLE = 'simple_handoff';
  var AGENT_INSTALL_PROMPT = [
    'Register the MCPViews MCP server for me at user / global scope so it is',
    'available in every project I work on.',
    '',
    'Before doing anything, verify MCPViews is running:',
    '',
    '```bash',
    'curl -sSf http://localhost:4200/health',
    '```',
    '',
    'If that command fails or times out, stop and tell me to launch MCPViews.',
    '',
    'Detect which agent tool you are running inside, then register an MCP server',
    'named mcpviews that points to http://localhost:4200/mcp. Only modify the',
    'mcpviews entry in user / global config, and preserve every other MCP server',
    'entry exactly as it is.',
    '',
    'After writing the config, re-read it and confirm the mcpviews entry is',
    'present. Then tell me to fully quit and relaunch the agent tool so MCP',
    'servers are reloaded.',
    '',
    'Canonical full prompt:',
    INSTALL_PROMPT_URL,
  ].join('\n');

  function invoke(command, args) {
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.reject(new Error('DecidR Setup is only available in MCPViews desktop.'));
    }
    return window.__TAURI__.core.invoke(command, args || {});
  }

  function parseToolPayload(result) {
    if (!result) return null;
    if (result.data || result.organizations || result.access_token || result.accessToken) return result;
    if (Array.isArray(result.content)) {
      for (var index = 0; index < result.content.length; index += 1) {
        var item = result.content[index];
        if (item && item.type === 'text' && typeof item.text === 'string') {
          try {
            return JSON.parse(item.text);
          } catch (_error) {}
        }
      }
    }
    return result;
  }

  function payloadFlag(payload, snakeName, camelName) {
    return Boolean(payload && (payload[snakeName] || payload[camelName]));
  }

  function payloadField(payload, snakeName, camelName) {
    if (!payload) return null;
    if (payload[snakeName] !== undefined && payload[snakeName] !== null) return payload[snakeName];
    if (payload[camelName] !== undefined && payload[camelName] !== null) return payload[camelName];
    return null;
  }

  function storedValue(key) {
    try {
      return localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function storeValue(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_error) {}
  }

  function initialOrganizationId(data) {
    if (data && data.organization_id) return data.organization_id;
    if (data && data.organizationId) return data.organizationId;
    return storedValue(AUTH_ORG_KEY) || storedValue(LEGACY_COMPLETED_KEY) || null;
  }

  function organizationRows(payload) {
    var parsed = parseToolPayload(payload) || {};
    var data = parsed.data || parsed.organizations || parsed.result || parsed;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.organizations)) return data.organizations;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  function getOrgName(org) {
    return org.name || org.slug || org.displayName || org.id || org.organization_id || 'Organization';
  }

  function getOrgId(org) {
    return org.id || org.organization_id || org.organizationId || null;
  }

  function slugify(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function hasOrganizationNameConflict(state, name) {
    var targetName = normalizeName(name);
    var targetSlug = slugify(name);
    return (state.organizations || []).some(function (org) {
      return normalizeName(getOrgName(org)) === targetName || slugify(org.slug || getOrgName(org)) === targetSlug;
    });
  }

  function button(label, className, onClick) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = className || 'decidr-setup-button';
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function textInput(options) {
    var input = document.createElement('input');
    input.className = 'decidr-setup-input';
    input.type = options.type || 'text';
    input.placeholder = options.placeholder || '';
    input.autocomplete = options.autocomplete || 'off';
    input.value = options.value || '';
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.inputMode) input.inputMode = options.inputMode;
    return input;
  }

  function setStatus(root, text, tone) {
    var status = root.querySelector('[data-status]');
    if (!status) return;
    status.textContent = text || '';
    status.className = 'decidr-setup-status' + (tone ? ' ' + tone : '');
  }

  function openExternalUrl(url) {
    if (!url) return;
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('open_external_url', { url: url }).catch(function () {});
      return;
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (_error) {}
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('Clipboard is not available.'));
  }

  function renderShell(container) {
    container.innerHTML = [
      '<style>',
      '.decidr-setup{--decidr-setup-surface:var(--bg-surface,#ffffff);--decidr-setup-surface-subtle:var(--bg-surface-subtle,#f9fafb);--decidr-setup-surface-inset:var(--bg-surface-inset,#f3f4f6);--decidr-setup-border:var(--border-default,var(--border-color,#d6dbe3));--decidr-setup-border-strong:var(--border-strong,var(--border-color,#cbd5e1));--decidr-setup-accent:var(--accent-primary,#1f6feb);--decidr-setup-accent-hover:var(--accent-primary-hover,#155bd5);--decidr-setup-success-bg:var(--color-success-bg,#d1fae5);--decidr-setup-success-text:var(--color-success-text,#047857);--decidr-setup-error-text:var(--color-error-text,#b91c1c);color-scheme:light dark;max-width:920px;margin:0 auto;padding:36px 28px;color:var(--text-primary,#111827);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '[data-theme="dark"] .decidr-setup{--decidr-setup-surface:rgba(255,255,255,.055);--decidr-setup-surface-subtle:rgba(255,255,255,.04);--decidr-setup-surface-inset:rgba(255,255,255,.08);--decidr-setup-border:rgba(255,255,255,.11);--decidr-setup-border-strong:rgba(255,255,255,.2);--decidr-setup-accent:#818cf8;--decidr-setup-accent-hover:#a5b4fc;--decidr-setup-success-bg:rgba(34,197,94,.16);--decidr-setup-success-text:#86efac;--decidr-setup-error-text:#fca5a5;}',
      '.decidr-setup h1{font-size:28px;line-height:1.2;margin:0 0 8px;font-weight:700;letter-spacing:0;}',
      '.decidr-setup p{color:var(--text-secondary,#4b5563);line-height:1.55;margin:0;}',
      '.decidr-setup h2{font-size:18px;line-height:1.25;margin:0 0 8px;font-weight:700;letter-spacing:0;}',
      '.decidr-setup-panel{border:1px solid var(--decidr-setup-border);border-radius:8px;background:var(--decidr-setup-surface);padding:22px;margin-top:22px;}',
      '.decidr-setup-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:22px;}',
      '.decidr-setup-info{border:1px solid var(--decidr-setup-border);border-radius:8px;background:var(--decidr-setup-surface);padding:16px;}',
      '.decidr-setup-steps{display:grid;gap:10px;margin:20px 0 0;padding:0;list-style:none;}',
      '.decidr-setup-step{display:flex;align-items:center;gap:10px;color:var(--text-secondary,#4b5563);font-size:14px;}',
      '.decidr-setup-step span:first-child{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--decidr-setup-surface-inset);font-size:12px;font-weight:700;color:var(--text-secondary,#4b5563);}',
      '.decidr-setup-step.done span:first-child{background:var(--decidr-setup-success-bg);color:var(--decidr-setup-success-text);}',
      '.decidr-setup-body{margin-top:20px;}',
      '.decidr-setup-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;}',
      '.decidr-setup-agent-steps{display:grid;gap:14px;margin-top:16px;}',
      '.decidr-setup-agent-step{border:1px solid var(--decidr-setup-border);border-radius:8px;padding:14px;background:var(--decidr-setup-surface-subtle);}',
      '.decidr-setup-agent-step strong{display:block;margin-bottom:6px;}',
      '.decidr-setup-choice-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px;}',
      '.decidr-setup-choice{display:flex;gap:10px;border:1px solid var(--decidr-setup-border);border-radius:8px;padding:12px;background:var(--decidr-setup-surface-subtle);cursor:pointer;}',
      '.decidr-setup-choice input{margin-top:3px;accent-color:var(--decidr-setup-accent);}',
      '.decidr-setup-choice strong{display:block;font-size:13px;margin:0 0 4px;}',
      '.decidr-setup-choice span span{display:block;color:var(--text-secondary,#4b5563);font-size:12px;line-height:1.4;}',
      '.decidr-setup-prompt{display:block;width:100%;min-height:150px;margin-top:12px;border:1px solid var(--decidr-setup-border-strong);border-radius:6px;padding:10px;background:var(--decidr-setup-surface);color:var(--text-primary,#111827);font:12px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;resize:vertical;}',
      '.decidr-setup-check{display:flex;align-items:flex-start;gap:10px;margin-top:16px;color:var(--text-primary,#111827);font-size:14px;line-height:1.45;}',
      '.decidr-setup-check input{accent-color:var(--decidr-setup-accent);}',
      '.decidr-setup-check input{margin-top:2px;}',
      '.decidr-setup-button{min-height:38px;border:1px solid var(--decidr-setup-border-strong);border-radius:6px;background:var(--decidr-setup-surface);color:var(--text-primary,#111827);font-weight:600;padding:0 14px;cursor:pointer;}',
      '.decidr-setup-button:hover{background:var(--decidr-setup-surface-inset);}',
      '.decidr-setup-button.primary{background:var(--decidr-setup-accent);border-color:var(--decidr-setup-accent);color:#fff;}',
      '.decidr-setup-button.primary:hover{background:var(--decidr-setup-accent-hover);border-color:var(--decidr-setup-accent-hover);}',
      '.decidr-setup-button:disabled{opacity:.55;cursor:not-allowed;}',
      '.decidr-setup-input{min-height:38px;border:1px solid var(--decidr-setup-border-strong);border-radius:6px;padding:0 12px;min-width:260px;background:var(--decidr-setup-surface);color:var(--text-primary,#111827);font:inherit;}',
      '.decidr-setup-input::placeholder{color:var(--text-tertiary,#9ca3af);}',
      '.decidr-setup-code{width:150px;min-width:150px;letter-spacing:4px;text-align:center;font-weight:700;}',
      '.decidr-setup-orgs{display:grid;gap:8px;margin-top:16px;}',
      '.decidr-setup-org{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--decidr-setup-border);border-radius:6px;padding:12px;background:var(--decidr-setup-surface-subtle);}',
      '.decidr-setup-org strong{font-size:14px;}',
      '.decidr-setup-org-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;}',
      '.decidr-setup-status{min-height:22px;margin-top:14px;font-size:13px;color:var(--text-secondary,#4b5563);}',
      '.decidr-setup-status.error{color:var(--decidr-setup-error-text);}',
      '.decidr-setup-status.success{color:var(--decidr-setup-success-text);}',
      '@media(max-width:720px){.decidr-setup{padding:26px 18px;}.decidr-setup-info-grid,.decidr-setup-choice-grid{grid-template-columns:1fr;}}',
      '</style>',
      '<div class="decidr-setup">',
      '<h1>DecidR Setup</h1>',
      '<p>Sign in to DecidR and choose the organization this MCPViews installation should use.</p>',
      '<div class="decidr-setup-info-grid">',
      '<section class="decidr-setup-info">',
      '<h2>What is MCPViews?</h2>',
      '<p>MCPViews is the local desktop bridge between your AI agent and DecidR. It runs the MCP server your agent calls and shows DecidR dashboards, setup flows, approvals, and other interactive views here.</p>',
      '</section>',
      '<section class="decidr-setup-info">',
      '<h2>What this setup does</h2>',
      '<p>It signs you in, selects your default organization, and then helps you connect this desktop app to the AI agent you use for day-to-day work.</p>',
      '</section>',
      '</div>',
      '<div class="decidr-setup-panel">',
      '<ul class="decidr-setup-steps">',
      '<li class="decidr-setup-step" data-step="plugins"><span>1</span><span>Package components</span></li>',
      '<li class="decidr-setup-step" data-step="login"><span>2</span><span>Sign in</span></li>',
      '<li class="decidr-setup-step" data-step="org"><span>3</span><span>Organization</span></li>',
      '<li class="decidr-setup-step" data-step="agent"><span>4</span><span>Agent setup</span></li>',
      '</ul>',
      '<div class="decidr-setup-body" data-body></div>',
      '<div class="decidr-setup-status" data-status></div>',
      '</div>',
      '</div>',
    ].join('');
    return container.querySelector('.decidr-setup');
  }

  function markStep(root, step, done) {
    var el = root.querySelector('[data-step="' + step + '"]');
    if (el) el.classList.toggle('done', !!done);
  }

  function renderPluginCheck(root, state) {
    var body = root.querySelector('[data-body]');
    var missing = REQUIRED_PLUGINS.filter(function (pluginName) {
      return !state.installedPlugins[pluginName];
    });
    markStep(root, 'plugins', missing.length === 0);
    body.innerHTML = '';

    if (missing.length > 0) {
      var panel = document.createElement('div');
      panel.className = 'decidr-setup-row';
      panel.appendChild(button('Retry component check', 'decidr-setup-button primary', function () {
        runPluginCheck(root, state);
      }));
      body.appendChild(panel);
      setStatus(root, 'One or more DecidR package components are missing. Reinstall the DecidR MCPViews package, then retry.', 'error');
      return;
    }

    if (state.organizationId) {
      verifySharedAuth(root, state);
      return;
    }

    renderLoginForm(root, state);
    setStatus(root, 'DecidR package components are ready.', 'success');
  }

  function runPluginCheck(root, state) {
    setStatus(root, 'Checking DecidR package components...');
    return Promise.all([
      invoke('get_standalone_renderers').catch(function () { return []; }),
      invoke('list_local_mcp_tools').catch(function () { return []; }),
    ]).then(function (results) {
      var plugins = {};
      (results[0] || []).forEach(function (plugin) {
        if (plugin && plugin.plugin) plugins[plugin.plugin] = true;
      });
      (results[1] || []).forEach(function (tool) {
        var name = tool && tool.name ? tool.name : '';
        if (name.indexOf('decidr__') === 0) plugins.decidr = true;
        if (name.indexOf('ludflow__') === 0) plugins.ludflow = true;
      });
      state.installedPlugins = plugins;
      renderPluginCheck(root, state);
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function renderLoginForm(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '';
    markStep(root, 'login', false);

    var emailRow = document.createElement('div');
    emailRow.className = 'decidr-setup-row';
    var emailInput = textInput({
      type: 'email',
      placeholder: 'Email address',
      autocomplete: 'email',
      value: state.email,
    });
    emailRow.appendChild(emailInput);
    emailRow.appendChild(button(state.codeSent ? 'Send a new code' : 'Send code', 'decidr-setup-button primary', function () {
      var email = emailInput.value.trim();
      if (!email) {
        setStatus(root, 'Enter your email address.', 'error');
        return;
      }
      sendLoginCode(root, state, email);
    }));
    body.appendChild(emailRow);

    if (state.codeSent) {
      var codeRow = document.createElement('div');
      codeRow.className = 'decidr-setup-row';
      var codeInput = textInput({
        placeholder: '000000',
        value: state.code,
        maxLength: 6,
        inputMode: 'numeric',
      });
      codeInput.className += ' decidr-setup-code';
      codeRow.appendChild(codeInput);
      codeRow.appendChild(button('Verify code', 'decidr-setup-button primary', function () {
        var code = codeInput.value.replace(/\D/g, '').slice(0, 6);
        if (code.length !== 6) {
          setStatus(root, 'Enter the 6-digit code from your email.', 'error');
          return;
        }
        state.code = code;
        verifyLoginCode(root, state, {});
      }));
      body.appendChild(codeRow);
      setStatus(root, 'Enter the 6-digit code from your email.');
    }
  }

  function sendLoginCode(root, state, email) {
    state.email = email;
    setStatus(root, 'Sending sign-in code...');
    invoke('send_plugin_email_code', {
      pluginName: AUTH_PLUGIN,
      email: email,
    }).then(function () {
      state.codeSent = true;
      renderLoginForm(root, state);
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function verifyLoginCode(root, state, options) {
    setStatus(root, 'Verifying sign-in code...');
    var args = {
      pluginName: AUTH_PLUGIN,
      email: state.email,
      code: state.code,
    };
    if (options.organizationId) args.organizationId = options.organizationId;
    if (options.organizationName) args.organizationName = options.organizationName;

    invoke('verify_plugin_email_code', args).then(function (result) {
      var payload = parseToolPayload(result) || {};
      markStep(root, 'login', true);

      var organizations = organizationRows(payload);
      if (organizations.length) state.organizations = organizations;

      var orgId = payloadField(payload, 'organization_id', 'organizationId');
      if (orgId) {
        state.organizationId = orgId;
        markStep(root, 'org', true);
        return verifySharedAuth(root, state);
      }

      if (payloadFlag(payload, 'requires_organization', 'requiresOrganization')) {
        renderNewOrganizationForm(root, state);
        return;
      }

      if (payloadFlag(payload, 'requires_organization_selection', 'requiresOrganizationSelection')) {
        state.organizations = organizationRows(payload);
        renderOrganizationPicker(root, state);
        return;
      }

      throw new Error('DecidR did not return an organization ID.');
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function renderOrganizationPicker(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '';
    markStep(root, 'org', false);

    var orgs = document.createElement('div');
    orgs.className = 'decidr-setup-orgs';
    (state.organizations || []).forEach(function (org) {
      var orgId = getOrgId(org);
      if (!orgId) return;
      var row = document.createElement('div');
      row.className = 'decidr-setup-org';
      var name = document.createElement('strong');
      name.textContent = getOrgName(org);
      row.appendChild(name);
      row.appendChild(button('Use as default', 'decidr-setup-button', function () {
        state.organizationId = orgId;
        verifyLoginCode(root, state, { organizationId: orgId });
      }));
      orgs.appendChild(row);
    });
    body.appendChild(orgs);

    if (!orgs.children.length) {
      renderNewOrganizationForm(root, state);
      return;
    }

    var actions = document.createElement('div');
    actions.className = 'decidr-setup-org-actions';
    actions.appendChild(button('Create organization', 'decidr-setup-button', function () {
      renderNewOrganizationForm(root, state);
    }));
    body.appendChild(actions);

    setStatus(root, 'Choose the organization DecidR should use by default.');
  }

  function renderNewOrganizationForm(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '';
    markStep(root, 'org', false);

    var row = document.createElement('div');
    row.className = 'decidr-setup-row';
    var input = textInput({
      placeholder: 'Organization name',
      value: state.organizationName,
    });
    row.appendChild(input);
    row.appendChild(button('Create organization', 'decidr-setup-button primary', function () {
      var name = input.value.trim();
      if (!name) {
        setStatus(root, 'Enter an organization name.', 'error');
        return;
      }
      if (hasOrganizationNameConflict(state, name)) {
        setStatus(root, 'An organization with that name is already available for this account. Choose it from the list or use a different name.', 'error');
        return;
      }
      state.organizationName = name;
      verifyLoginCode(root, state, { organizationName: name });
    }));
    body.appendChild(row);
    setStatus(root, 'Name your organization to finish setup.');
  }

  function verifySharedAuth(root, state) {
    var orgId = state.organizationId;
    setStatus(root, 'Finishing DecidR setup...');
    return Promise.all([
      invoke('get_plugin_auth_header', { pluginName: 'decidr', orgId: orgId }),
      invoke('get_plugin_auth_header', { pluginName: 'ludflow', orgId: orgId }),
    ]).then(function (results) {
      if (!results[0] || !results[1]) {
        throw new Error('DecidR setup is not fully authenticated for the selected organization.');
      }
      return ensureDecidrOnboarding(root, results[0], orgId).then(function () {
        state.decidrAuthHeader = results[0];
        storeValue(AUTH_ORG_KEY, orgId);
        renderAgentSetup(root, state);
      });
    }).catch(function (error) {
      state.organizationId = null;
      renderLoginForm(root, state);
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function decidrApiBaseUrl() {
    if (window.__mcpviews_plugins && window.__mcpviews_plugins.decidr && window.__mcpviews_plugins.decidr.mcp_url) {
      return window.__mcpviews_plugins.decidr.mcp_url.replace(/\/api\/mcp\/?$/, '/api').replace(/\/$/, '');
    }
    return 'https://app.decidrmcp.com/api';
  }

  function parseApiError(response) {
    return response.json().then(function (payload) {
      if (payload && payload.error) return payload.error;
      return response.statusText || 'Request failed';
    }).catch(function () {
      return response.statusText || 'Request failed';
    });
  }

  function ensureDecidrOnboarding(root, authHeader, orgId) {
    setStatus(root, 'Preparing your DecidR starter workspace...');
    return fetch(decidrApiBaseUrl() + '/onboarding/ensure', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: authHeader,
        'content-type': 'application/json',
        'x-mcpviews-organization-id': orgId,
      },
      body: JSON.stringify({ organization_id: orgId }),
      cache: 'no-store',
    }).then(function (response) {
      if (!response.ok) {
        return parseApiError(response).then(function (message) {
          throw new Error(message || 'Failed to prepare DecidR onboarding.');
        });
      }
      return response.json().catch(function () {
        return { seeded: false };
      });
    });
  }

  function workStyleApiMode(value) {
    if (value === 'solo_builder') return 'SOLO_BUILDER';
    if (value === 'team_approval') return 'TEAM_APPROVAL';
    return 'SIMPLE_HANDOFF';
  }

  function saveWorkStylePreferences(root, state) {
    if (!state.decidrAuthHeader) return Promise.resolve();
    return fetch(decidrApiBaseUrl() + '/me/preferences', {
      method: 'PATCH',
      headers: {
        accept: 'application/json',
        authorization: state.decidrAuthHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workStyleMode: workStyleApiMode(state.workStyleMode),
        agentGuidanceSummary: 'Use DecidR decision breadcrumbs for discovery only; call get_decision before implementation and review-gate ambiguous DecidR writes.',
      }),
      cache: 'no-store',
    }).then(function (response) {
      if (!response.ok) {
        return parseApiError(response).then(function (message) {
          throw new Error(message || 'Failed to save DecidR work style.');
        });
      }
      return response.json().catch(function () {
        return {};
      });
    });
  }

  function renderWorkStyleChooser(state) {
    var wrapper = document.createElement('section');
    wrapper.className = 'decidr-setup-agent-step';

    var title = document.createElement('strong');
    title.textContent = '3. Choose your active-work style';
    wrapper.appendChild(title);

    var copy = document.createElement('p');
    copy.textContent = 'Agents will use this for compact handoffs, artifact refs, and review-gated DecidR logging.';
    wrapper.appendChild(copy);

    var grid = document.createElement('div');
    grid.className = 'decidr-setup-choice-grid';
    [
      ['simple_handoff', 'Simple handoff', 'Compact capture, ask before logging.'],
      ['solo_builder', 'Solo builder', 'Capture fast, review rows before writes.'],
      ['team_approval', 'Team approval', 'Capture fast, treat logging as approval-sensitive.'],
    ].forEach(function (choice) {
      var label = document.createElement('label');
      label.className = 'decidr-setup-choice';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'decidr-work-style';
      input.value = choice[0];
      input.checked = state.workStyleMode === choice[0];
      input.addEventListener('change', function () {
        if (input.checked) state.workStyleMode = input.value;
      });
      label.appendChild(input);
      var text = document.createElement('span');
      var strong = document.createElement('strong');
      strong.textContent = choice[1];
      var desc = document.createElement('span');
      desc.textContent = choice[2];
      text.appendChild(strong);
      text.appendChild(desc);
      label.appendChild(text);
      grid.appendChild(label);
    });
    wrapper.appendChild(grid);
    return wrapper;
  }

  function currentSessionId(root) {
    var session = root.closest ? root.closest('[data-session-id]') : null;
    return session ? session.getAttribute('data-session-id') : null;
  }

  function openDashboardAndCloseSetup(root, state) {
    var utils = window.__companionUtils || {};
    if (utils && typeof utils.openSession === 'function') {
      utils.openSession({
        sessionKey: 'decidr-dashboard',
        toolName: 'DecidR Dashboard',
        contentType: 'decidr_dashboard',
        data: { organization_id: state.organizationId },
        meta: { headerTitle: 'DecidR Dashboard' },
        toolArgs: { title: 'DecidR Dashboard' },
      });
    }

    var sessionId = currentSessionId(root);
    if (sessionId && utils && typeof utils.closeSession === 'function') {
      window.setTimeout(function () {
        utils.closeSession(sessionId);
      }, 0);
    }
  }

  function renderAgentSetup(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '';
    markStep(root, 'login', true);
    markStep(root, 'org', true);
    markStep(root, 'agent', false);

    var heading = document.createElement('h2');
    heading.textContent = 'Configure your AI agent';
    body.appendChild(heading);

    var intro = document.createElement('p');
    intro.textContent = 'Finish by registering MCPViews with your AI agent, then restart the agent and run setup so it saves the current MCPViews rules.';
    body.appendChild(intro);

    var steps = document.createElement('div');
    steps.className = 'decidr-setup-agent-steps';

    var installStep = document.createElement('section');
    installStep.className = 'decidr-setup-agent-step';
    var installTitle = document.createElement('strong');
    installTitle.textContent = '1. Give your agent the MCPViews install prompt';
    installStep.appendChild(installTitle);
    var installCopy = document.createElement('p');
    installCopy.textContent = 'Paste this prompt into an MCP-capable agent. The full canonical prompt lives in the MCPViews GitHub repo.';
    installStep.appendChild(installCopy);

    var prompt = document.createElement('textarea');
    prompt.className = 'decidr-setup-prompt';
    prompt.readOnly = true;
    prompt.value = AGENT_INSTALL_PROMPT;
    installStep.appendChild(prompt);

    var actions = document.createElement('div');
    actions.className = 'decidr-setup-row';
    actions.appendChild(button('Copy prompt', 'decidr-setup-button', function () {
      copyText(AGENT_INSTALL_PROMPT).then(function () {
        setStatus(root, 'Install prompt copied.');
      }).catch(function () {
        prompt.focus();
        prompt.select();
        setStatus(root, 'Copy the selected prompt text.', 'error');
      });
    }));
    actions.appendChild(button('Open full prompt', 'decidr-setup-button', function () {
      openExternalUrl(INSTALL_PROMPT_URL);
    }));
    installStep.appendChild(actions);
    steps.appendChild(installStep);

    var setupStep = document.createElement('section');
    setupStep.className = 'decidr-setup-agent-step';
    var setupTitle = document.createElement('strong');
    setupTitle.textContent = '2. Restart your agent and run setup mcpviews';
    setupStep.appendChild(setupTitle);
    var setupCopy = document.createElement('p');
    setupCopy.textContent = 'Fully quit and relaunch the agent tool so it reloads MCP servers. Then ask it to run setup mcpviews, which calls mcpviews_setup and saves the session-start rules.';
    setupStep.appendChild(setupCopy);
    steps.appendChild(setupStep);

    steps.appendChild(renderWorkStyleChooser(state));

    body.appendChild(steps);

    var checkLabel = document.createElement('label');
    checkLabel.className = 'decidr-setup-check';
    var check = document.createElement('input');
    check.type = 'checkbox';
    checkLabel.appendChild(check);
    var checkText = document.createElement('span');
    checkText.textContent = 'I installed the MCPViews MCP server in my AI agent, restarted the agent, and ran setup mcpviews.';
    checkLabel.appendChild(checkText);
    body.appendChild(checkLabel);

    var finishRow = document.createElement('div');
    finishRow.className = 'decidr-setup-row';
    var finish = button('Finish setup', 'decidr-setup-button primary', function () {
      if (!check.checked) return;
      finish.disabled = true;
      setStatus(root, 'Saving DecidR work style...');
      saveWorkStylePreferences(root, state).catch(function (error) {
        if (window.console && typeof window.console.warn === 'function') {
          window.console.warn('DecidR work style preference save failed', error);
        }
        return { preferenceSaveFailed: true };
      }).then(function (result) {
        storeValue(AGENT_CONFIGURED_KEY, state.organizationId);
        markStep(root, 'agent', true);
        setStatus(
          root,
          result && result.preferenceSaveFailed
            ? 'Opening DecidR dashboard. Work style can be saved later.'
            : 'Opening DecidR dashboard...',
          'success'
        );
        openDashboardAndCloseSetup(root, state);
      });
    });
    finish.disabled = true;
    check.addEventListener('change', function () {
      finish.disabled = !check.checked;
    });
    finishRow.appendChild(finish);
    body.appendChild(finishRow);
    setStatus(root, 'DecidR sign-in is ready. Complete the agent setup steps to finish.', 'success');
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.decidr_onboarding = function renderDecidrOnboarding(container, data) {
    var root = renderShell(container);
    var state = {
      email: '',
      code: '',
      codeSent: false,
      organizationId: initialOrganizationId(data),
      organizationName: '',
      decidrAuthHeader: null,
      workStyleMode: DEFAULT_WORK_STYLE,
      installedPlugins: {},
      organizations: [],
    };
    runPluginCheck(root, state);
  };
})();
