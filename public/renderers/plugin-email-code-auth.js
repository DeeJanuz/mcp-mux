(function () {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tauriInvoke(command, args) {
    if (!window.__TAURI__ || !window.__TAURI__.core || typeof window.__TAURI__.core.invoke !== 'function') {
      return Promise.reject(new Error('MCPViews desktop IPC is not available.'));
    }
    return window.__TAURI__.core.invoke(command, args || {});
  }

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function currentSessionId(root) {
    var session = root.closest ? root.closest('[data-session-id]') : null;
    return session ? session.getAttribute('data-session-id') : null;
  }

  function setStatus(root, message, tone) {
    var node = root.querySelector('[data-status]');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'plugin-code-auth-status' + (tone ? ' ' + tone : '');
  }

  function normalizeCode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 6);
  }

  function button(label, className, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className || 'plugin-code-auth-button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function input(type, placeholder, value) {
    var node = document.createElement('input');
    node.type = type || 'text';
    node.className = 'plugin-code-auth-input';
    node.placeholder = placeholder || '';
    node.value = value || '';
    return node;
  }

  function responseOrganizations(result) {
    var organizations = result.organizations || result.available_organizations || result.data;
    return Array.isArray(organizations) ? organizations : [];
  }

  function isAuthenticated(result) {
    return !!(
      result &&
      (result.authenticated ||
        result.status === true && result.organization_id ||
        result.organization_id && !result.requires_organization && !result.requires_organization_selection)
    );
  }

  function authenticatedOrgCount(result) {
    if (!result) return 0;
    if (typeof result.authenticated_organization_count === 'number') {
      return result.authenticated_organization_count;
    }
    if (Array.isArray(result.authenticated_organization_ids)) {
      return result.authenticated_organization_ids.length;
    }
    return result.organization_id ? 1 : 0;
  }

  function connectedStatusMessage(orgId, orgCount) {
    if (orgCount > 1) return 'Connected ' + orgCount + ' organizations.';
    return 'Connected' + (orgId ? ' to organization ' + orgId : '') + '.';
  }

  function renderShell(container, state) {
    container.innerHTML = [
      '<style>',
      '.plugin-code-auth{--pca-surface:var(--bg-surface,#fff);--pca-soft:var(--bg-surface-subtle,#f8fafc);--pca-border:var(--border-default,var(--border-color,#d6dbe3));--pca-strong:var(--border-strong,#cbd5e1);--pca-accent:var(--accent-primary,#1f6feb);--pca-error:var(--color-error-text,#b91c1c);--pca-success:var(--color-success-text,#047857);max-width:680px;margin:0 auto;padding:34px 24px;color:var(--text-primary,#111827);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;}',
      '[data-theme="dark"] .plugin-code-auth{--pca-surface:rgba(255,255,255,.055);--pca-soft:rgba(255,255,255,.04);--pca-border:rgba(255,255,255,.12);--pca-strong:rgba(255,255,255,.2);--pca-accent:#818cf8;--pca-error:#fca5a5;--pca-success:#86efac;}',
      '.plugin-code-auth h1{font-size:24px;line-height:1.2;margin:0 0 8px;font-weight:700;letter-spacing:0;}',
      '.plugin-code-auth p{margin:0;color:var(--text-secondary,#4b5563);line-height:1.55;}',
      '.plugin-code-auth-panel{margin-top:22px;border:1px solid var(--pca-border);border-radius:8px;background:var(--pca-surface);padding:20px;}',
      '.plugin-code-auth-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;}',
      '.plugin-code-auth-input{min-height:38px;border:1px solid var(--pca-strong);border-radius:6px;background:var(--pca-surface);color:var(--text-primary,#111827);font:inherit;padding:0 12px;min-width:260px;}',
      '.plugin-code-auth-code{width:150px;min-width:150px;letter-spacing:4px;text-align:center;font-weight:700;}',
      '.plugin-code-auth-button{min-height:38px;border:1px solid var(--pca-strong);border-radius:6px;background:var(--pca-surface);color:var(--text-primary,#111827);font-weight:600;padding:0 14px;cursor:pointer;}',
      '.plugin-code-auth-button.primary{background:var(--pca-accent);border-color:var(--pca-accent);color:#fff;}',
      '.plugin-code-auth-button:disabled{opacity:.55;cursor:not-allowed;}',
      '.plugin-code-auth-orgs{display:grid;gap:8px;margin-top:16px;}',
      '.plugin-code-auth-org{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--pca-border);border-radius:6px;background:var(--pca-soft);padding:12px;}',
      '.plugin-code-auth-org strong{font-size:14px;}',
      '.plugin-code-auth-org-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;}',
      '.plugin-code-auth-status{min-height:22px;margin-top:14px;font-size:13px;color:var(--text-secondary,#4b5563);}',
      '.plugin-code-auth-status.error{color:var(--pca-error);}',
      '.plugin-code-auth-status.success{color:var(--pca-success);}',
      '</style>',
      '<div class="plugin-code-auth">',
      '<h1>Sign in to ', escapeHtml(state.pluginLabel), '</h1>',
      '<p>Enter your email and six-digit code to connect this MCPViews plugin.</p>',
      '<section class="plugin-code-auth-panel">',
      '<div data-body></div>',
      '<div class="plugin-code-auth-status" data-status></div>',
      '</section>',
      '</div>',
    ].join('');
  }

  function renderEmailForm(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '';

    var row = document.createElement('div');
    row.className = 'plugin-code-auth-row';
    var email = input('email', 'you@example.com', state.email);
    var send = button('Send code', 'plugin-code-auth-button primary', function () {
      var value = email.value.trim();
      if (!value) {
        setStatus(root, 'Enter your email address.', 'error');
        return;
      }
      state.email = value;
      send.disabled = true;
      setStatus(root, 'Sending code...');
      tauriInvoke('send_plugin_email_code', {
        pluginName: state.pluginName,
        email: state.email,
      }).then(function () {
        renderCodeForm(root, state);
        setStatus(root, 'Code sent. Check your email.');
      }).catch(function (error) {
        send.disabled = false;
        setStatus(root, error.message || String(error), 'error');
      });
    });
    row.appendChild(email);
    row.appendChild(send);
    body.appendChild(row);
    setStatus(root, '');
  }

  function renderCodeForm(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '';

    var row = document.createElement('div');
    row.className = 'plugin-code-auth-row';
    var code = input('text', '000000', state.code);
    code.className += ' plugin-code-auth-code';
    code.inputMode = 'numeric';
    code.autocomplete = 'one-time-code';
    code.addEventListener('input', function () {
      code.value = normalizeCode(code.value);
    });
    var verify = button('Verify', 'plugin-code-auth-button primary', function () {
      state.code = normalizeCode(code.value);
      if (state.code.length !== 6) {
        setStatus(root, 'Enter the six-digit code.', 'error');
        return;
      }
      verifyLoginCode(root, state, {});
    });
    row.appendChild(code);
    row.appendChild(verify);
    row.appendChild(button('Use a different email', 'plugin-code-auth-button', function () {
      state.code = '';
      renderEmailForm(root, state);
    }));
    body.appendChild(row);
    setStatus(root, 'Enter the six-digit code.');
  }

  function verifyLoginCode(root, state, extra) {
    setStatus(root, 'Verifying code...');
    tauriInvoke('verify_plugin_email_code', {
      pluginName: state.pluginName,
      email: state.email,
      code: state.code,
      organizationId: extra.organizationId || state.targetOrgId || null,
      organizationName: extra.organizationName || null,
    }).then(function (result) {
      handleVerifyResult(root, state, asObject(result));
    }).catch(function (error) {
      setStatus(root, error.message || String(error), 'error');
    });
  }

  function handleVerifyResult(root, state, result) {
    if (isAuthenticated(result)) {
      var orgId = result.organization_id || state.targetOrgId || '';
      state.connectedOrgCount = authenticatedOrgCount(result);
      setStatus(root, connectedStatusMessage(orgId, state.connectedOrgCount), 'success');
      renderComplete(root, state);
      return;
    }

    if (result.requires_organization_selection || responseOrganizations(result).length) {
      state.organizations = responseOrganizations(result);
      renderOrganizationSelection(root, state);
      return;
    }

    if (result.requires_organization || result.requires_organization_creation) {
      renderNewOrganizationForm(root, state);
      return;
    }

    setStatus(root, result.message || 'Authentication did not complete. Try again.', 'error');
  }

  function renderOrganizationSelection(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '<p>Select the organization to connect.</p>';

    var list = document.createElement('div');
    list.className = 'plugin-code-auth-orgs';
    state.organizations.forEach(function (org) {
      var orgId = org.id || org.organization_id || org.organizationId;
      if (!orgId) return;
      var row = document.createElement('div');
      row.className = 'plugin-code-auth-org';
      var name = org.name || org.slug || orgId;
      row.innerHTML = '<div><strong>' + escapeHtml(name) + '</strong><p>' + escapeHtml(orgId) + '</p></div>';
      row.appendChild(button(orgId === state.targetOrgId ? 'Connect' : 'Use', 'plugin-code-auth-button primary', function () {
        verifyLoginCode(root, state, { organizationId: orgId });
      }));
      list.appendChild(row);
    });
    body.appendChild(list);
    var actions = document.createElement('div');
    actions.className = 'plugin-code-auth-org-actions';
    actions.appendChild(button('Create organization', 'plugin-code-auth-button', function () {
      renderNewOrganizationForm(root, state);
    }));
    body.appendChild(actions);
    setStatus(root, '');
  }

  function renderNewOrganizationForm(root, state) {
    var body = root.querySelector('[data-body]');
    body.innerHTML = '<p>Name the organization to connect.</p>';
    var row = document.createElement('div');
    row.className = 'plugin-code-auth-row';
    var name = input('text', 'Organization name', '');
    row.appendChild(name);
    row.appendChild(button('Create organization', 'plugin-code-auth-button primary', function () {
      var value = name.value.trim();
      if (!value) {
        setStatus(root, 'Enter an organization name.', 'error');
        return;
      }
      verifyLoginCode(root, state, { organizationName: value });
    }));
    body.appendChild(row);
    setStatus(root, '');
  }

  function renderComplete(root, state) {
    var body = root.querySelector('[data-body]');
    var message = state.pluginLabel + ' is connected in MCPViews.';
    if (state.connectedOrgCount > 1) {
      message = state.pluginLabel + ' is connected to ' + state.connectedOrgCount + ' organizations in MCPViews.';
    }
    body.innerHTML = '<p>' + escapeHtml(message) + '</p>';
    body.appendChild(button('Close', 'plugin-code-auth-button primary', function () {
      var utils = window.__companionUtils || {};
      var sessionId = currentSessionId(root);
      if (sessionId && typeof utils.closeSession === 'function') {
        utils.closeSession(sessionId);
      }
    }));
  }

  window.__renderers = window.__renderers || {};
  window.__renderers.plugin_email_code_auth = function (container, data) {
    var inputData = asObject(data);
    var state = {
      pluginName: inputData.plugin_name || inputData.pluginName || 'decidr',
      pluginLabel: inputData.plugin_label || inputData.pluginLabel || inputData.plugin_name || 'Plugin',
      targetOrgId: inputData.organization_id || inputData.organizationId || null,
      email: '',
      code: '',
      organizations: [],
      connectedOrgCount: 0,
    };
    renderShell(container, state);
    renderEmailForm(container, state);
  };
})();
