(function () {
  'use strict';

  var COMPLETED_KEY = 'decidr-onboarding:completed-org-id';
  var AUTH_PLUGIN = 'decidr';
  var REQUIRED_PLUGINS = ['decidr', 'ludflow'];

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

  function renderShell(container) {
    container.innerHTML = [
      '<style>',
      '.decidr-setup{max-width:920px;margin:0 auto;padding:36px 28px;color:var(--text-primary,#111827);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.decidr-setup h1{font-size:28px;line-height:1.2;margin:0 0 8px;font-weight:700;letter-spacing:0;}',
      '.decidr-setup p{color:var(--text-secondary,#4b5563);line-height:1.55;margin:0;}',
      '.decidr-setup-panel{border:1px solid var(--border-color,#d6dbe3);border-radius:8px;background:var(--surface,#fff);padding:22px;margin-top:22px;}',
      '.decidr-setup-steps{display:grid;gap:10px;margin:20px 0 0;padding:0;list-style:none;}',
      '.decidr-setup-step{display:flex;align-items:center;gap:10px;color:var(--text-secondary,#4b5563);font-size:14px;}',
      '.decidr-setup-step span:first-child{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--bg-muted,#eef2f7);font-size:12px;font-weight:700;color:var(--text-secondary,#4b5563);}',
      '.decidr-setup-step.done span:first-child{background:#d1fae5;color:#047857;}',
      '.decidr-setup-body{margin-top:20px;}',
      '.decidr-setup-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;}',
      '.decidr-setup-button{min-height:38px;border:1px solid var(--border-color,#cbd5e1);border-radius:6px;background:var(--surface,#fff);color:var(--text-primary,#111827);font-weight:600;padding:0 14px;cursor:pointer;}',
      '.decidr-setup-button.primary{background:#1f6feb;border-color:#1f6feb;color:#fff;}',
      '.decidr-setup-button:disabled{opacity:.55;cursor:not-allowed;}',
      '.decidr-setup-input{min-height:38px;border:1px solid var(--border-color,#cbd5e1);border-radius:6px;padding:0 12px;min-width:260px;background:var(--surface,#fff);color:var(--text-primary,#111827);font:inherit;}',
      '.decidr-setup-code{width:150px;min-width:150px;letter-spacing:4px;text-align:center;font-weight:700;}',
      '.decidr-setup-orgs{display:grid;gap:8px;margin-top:16px;}',
      '.decidr-setup-org{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--border-color,#d6dbe3);border-radius:6px;padding:12px;}',
      '.decidr-setup-org strong{font-size:14px;}',
      '.decidr-setup-status{min-height:22px;margin-top:14px;font-size:13px;color:var(--text-secondary,#4b5563);}',
      '.decidr-setup-status.error{color:#b91c1c;}',
      '.decidr-setup-status.success{color:#047857;}',
      '</style>',
      '<div class="decidr-setup">',
      '<h1>DecidR Setup</h1>',
      '<p>Sign in to DecidR and choose the organization this MCPViews installation should use.</p>',
      '<div class="decidr-setup-panel">',
      '<ul class="decidr-setup-steps">',
      '<li class="decidr-setup-step" data-step="plugins"><span>1</span><span>Package components</span></li>',
      '<li class="decidr-setup-step" data-step="login"><span>2</span><span>Sign in</span></li>',
      '<li class="decidr-setup-step" data-step="org"><span>3</span><span>Organization</span></li>',
      '<li class="decidr-setup-step" data-step="shared-auth"><span>4</span><span>Ready</span></li>',
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

      if (payloadFlag(payload, 'requires_organization', 'requiresOrganization')) {
        renderNewOrganizationForm(root, state);
        return;
      }

      if (payloadFlag(payload, 'requires_organization_selection', 'requiresOrganizationSelection')) {
        state.organizations = organizationRows(payload);
        renderOrganizationPicker(root, state);
        return;
      }

      var orgId = payloadField(payload, 'organization_id', 'organizationId');
      if (!orgId) {
        throw new Error('DecidR did not return an organization ID.');
      }
      state.organizationId = orgId;
      markStep(root, 'org', true);
      return verifySharedAuth(root, state);
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
      invoke('list_plugin_orgs', { pluginName: 'decidr' }),
      invoke('list_plugin_orgs', { pluginName: 'ludflow' }),
    ]).then(function (results) {
      var decidrOrgs = results[0] || [];
      var companionOrgs = results[1] || [];
      if (decidrOrgs.indexOf(orgId) === -1 || companionOrgs.indexOf(orgId) === -1) {
        throw new Error('DecidR setup is not fully authenticated for the selected organization.');
      }
      markStep(root, 'shared-auth', true);
      try {
        localStorage.setItem(COMPLETED_KEY, orgId);
      } catch (_error) {}
      renderComplete(root, state);
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function renderComplete(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '';
    var actions = document.createElement('div');
    actions.className = 'decidr-setup-row';
    actions.appendChild(button('Open DecidR', 'decidr-setup-button primary', function () {
      if (window.__companionUtils && typeof window.__companionUtils.openSession === 'function') {
        window.__companionUtils.openSession({
          sessionKey: 'decidr-dashboard',
          toolName: 'DecidR',
          contentType: 'decidr_dashboard',
          data: { organization_id: state.organizationId },
          meta: { headerTitle: 'DecidR' },
          toolArgs: { title: 'DecidR' },
        });
      }
    }));
    body.appendChild(actions);
    setStatus(root, 'DecidR is ready.', 'success');
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.decidr_onboarding = function renderDecidrOnboarding(container, data) {
    var root = renderShell(container);
    var state = {
      email: '',
      code: '',
      codeSent: false,
      organizationId: data && data.organization_id ? data.organization_id : null,
      organizationName: '',
      installedPlugins: {},
      organizations: [],
    };
    runPluginCheck(root, state);
  };
})();
