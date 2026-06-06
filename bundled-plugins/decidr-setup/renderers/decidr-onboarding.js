(function () {
  'use strict';

  var COMPLETED_KEY = 'decidr-onboarding:completed-org-id';

  function invoke(command, args) {
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      return Promise.reject(new Error('DecidR Setup is only available in MCPViews desktop.'));
    }
    return window.__TAURI__.core.invoke(command, args || {});
  }

  function parseToolPayload(result) {
    if (!result) return null;
    if (result.data || result.organizations) return result;
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

  function organizationRows(payload) {
    var parsed = parseToolPayload(payload) || {};
    var data = parsed.data || parsed.organizations || parsed.result || parsed;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.organizations)) return data.organizations;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  function organizationIdFromCreate(payload) {
    var parsed = parseToolPayload(payload) || {};
    var data = parsed.data || parsed.organization || parsed.result || parsed;
    return data.id || data.organization_id || data.organizationId || null;
  }

  function getOrgName(org) {
    return org.name || org.slug || org.displayName || org.id || org.organization_id || 'Organization';
  }

  function getOrgId(org) {
    return org.id || org.organization_id || org.organizationId || null;
  }

  function callTool(name, toolArgs) {
    return invoke('call_local_mcp_tool', {
      name: name,
      arguments: toolArgs || {},
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
      '.decidr-setup-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;}',
      '.decidr-setup-button{min-height:38px;border:1px solid var(--border-color,#cbd5e1);border-radius:6px;background:var(--surface,#fff);color:var(--text-primary,#111827);font-weight:600;padding:0 14px;cursor:pointer;}',
      '.decidr-setup-button.primary{background:#1f6feb;border-color:#1f6feb;color:#fff;}',
      '.decidr-setup-button:disabled{opacity:.55;cursor:not-allowed;}',
      '.decidr-setup-input{min-height:38px;border:1px solid var(--border-color,#cbd5e1);border-radius:6px;padding:0 12px;min-width:260px;background:var(--surface,#fff);color:var(--text-primary,#111827);}',
      '.decidr-setup-orgs{display:grid;gap:8px;margin-top:16px;}',
      '.decidr-setup-org{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--border-color,#d6dbe3);border-radius:6px;padding:12px;}',
      '.decidr-setup-status{min-height:22px;margin-top:14px;font-size:13px;color:var(--text-secondary,#4b5563);}',
      '.decidr-setup-status.error{color:#b91c1c;}',
      '.decidr-setup-status.success{color:#047857;}',
      '</style>',
      '<div class="decidr-setup">',
      '<h1>DecidR Setup</h1>',
      '<p>Connect DecidR and Ludflow to the same organization for this MCPViews installation.</p>',
      '<div class="decidr-setup-panel">',
      '<ul class="decidr-setup-steps">',
      '<li class="decidr-setup-step" data-step="plugins"><span>1</span><span>Bundled plugins</span></li>',
      '<li class="decidr-setup-step" data-step="login"><span>2</span><span>DecidR login</span></li>',
      '<li class="decidr-setup-step" data-step="org"><span>3</span><span>Organization</span></li>',
      '<li class="decidr-setup-step" data-step="shared-auth"><span>4</span><span>Ludflow connection</span></li>',
      '</ul>',
      '<div data-body></div>',
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
    var missing = ['decidr', 'ludflow'].filter(function (pluginName) {
      return !state.installedPlugins[pluginName];
    });
    markStep(root, 'plugins', missing.length === 0);
    body.innerHTML = '';

    if (missing.length > 0) {
      var panel = document.createElement('div');
      panel.className = 'decidr-setup-row';
      panel.appendChild(button('Retry plugin check', 'decidr-setup-button primary', function () {
        runPluginCheck(root, state);
      }));
      body.appendChild(panel);
      setStatus(root, 'Missing bundled plugins: ' + missing.join(', ') + '.', 'error');
      return;
    }

    var actions = document.createElement('div');
    actions.className = 'decidr-setup-row';
    actions.appendChild(button('Sign in to DecidR', 'decidr-setup-button primary', function () {
      startDecidrLogin(root, state);
    }));
    body.appendChild(actions);
    setStatus(root, 'DecidR and Ludflow are installed.', 'success');
  }

  function runPluginCheck(root, state) {
    setStatus(root, 'Checking bundled plugins...');
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

  function startDecidrLogin(root, state) {
    setStatus(root, 'Opening DecidR sign in...');
    invoke('start_plugin_auth', {
      pluginName: 'decidr',
      orgId: null,
    }).then(function () {
      markStep(root, 'login', true);
      return loadOrganizations(root, state);
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function loadOrganizations(root, state) {
    setStatus(root, 'Loading DecidR organizations...');
    return callTool('decidr__list_organizations', {}).then(function (result) {
      state.organizations = organizationRows(result);
      renderOrganizationPicker(root, state);
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
      row.appendChild(button('Use organization', 'decidr-setup-button', function () {
        authenticateSharedOrg(root, state, orgId);
      }));
      orgs.appendChild(row);
    });
    body.appendChild(orgs);

    var createRow = document.createElement('div');
    createRow.className = 'decidr-setup-row';
    var input = document.createElement('input');
    input.className = 'decidr-setup-input';
    input.placeholder = 'New organization name';
    createRow.appendChild(input);
    createRow.appendChild(button('Create organization', 'decidr-setup-button primary', function () {
      var name = input.value.trim();
      if (!name) {
        setStatus(root, 'Enter an organization name.', 'error');
        return;
      }
      createOrganization(root, state, name);
    }));
    body.appendChild(createRow);

    setStatus(root, state.organizations.length > 0 ? 'Choose or create an organization.' : 'Create your first organization.');
  }

  function createOrganization(root, state, name) {
    setStatus(root, 'Creating organization...');
    callTool('decidr__create_organization', { name: name }).then(function (result) {
      var orgId = organizationIdFromCreate(result);
      if (!orgId) throw new Error('DecidR did not return an organization ID.');
      return authenticateSharedOrg(root, state, orgId);
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function authenticateSharedOrg(root, state, orgId) {
    state.organizationId = orgId;
    markStep(root, 'org', true);
    setStatus(root, 'Connecting DecidR to the selected organization...');
    invoke('start_plugin_auth', {
      pluginName: 'decidr',
      orgId: orgId,
    }).then(function () {
      setStatus(root, 'Connecting Ludflow to the same organization...');
      return invoke('start_plugin_auth', {
        pluginName: 'ludflow',
        orgId: orgId,
      });
    }).then(function () {
      return verifySharedAuth(root, state);
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function verifySharedAuth(root, state) {
    var orgId = state.organizationId;
    return Promise.all([
      invoke('list_plugin_orgs', { pluginName: 'decidr' }),
      invoke('list_plugin_orgs', { pluginName: 'ludflow' }),
    ]).then(function (results) {
      var decidrOrgs = results[0] || [];
      var ludflowOrgs = results[1] || [];
      if (decidrOrgs.indexOf(orgId) === -1 || ludflowOrgs.indexOf(orgId) === -1) {
        throw new Error('Both plugins must be authenticated to the selected organization.');
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
    setStatus(root, 'DecidR and Ludflow are connected.', 'success');
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.decidr_onboarding = function renderDecidrOnboarding(container, data) {
    var root = renderShell(container);
    var state = {
      organizationId: data && data.organization_id ? data.organization_id : null,
      installedPlugins: {},
      organizations: [],
    };
    runPluginCheck(root, state);
  };
})();
