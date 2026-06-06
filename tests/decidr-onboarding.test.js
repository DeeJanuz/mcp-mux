import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var rendererCode = readFileSync(
  join(__dirnameResolved, '../bundled-plugins/decidr-setup/renderers/decidr-onboarding.js'),
  'utf8',
).replace(/\r\n/g, '\n');

function loadRenderer() {
  new Function(rendererCode).call(globalThis);
}

async function flushPromises(count = 5) {
  for (let index = 0; index < count; index += 1) {
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
  }
}

function textButton(label) {
  return Array.from(document.querySelectorAll('button')).find(function (button) {
    return button.textContent === label;
  });
}

function inputByPlaceholder(placeholder) {
  return Array.from(document.querySelectorAll('input')).find(function (input) {
    return input.placeholder === placeholder;
  });
}

function setupCheckbox() {
  return document.querySelector('input[type="checkbox"]');
}

function installLocalStorage() {
  var values = {};
  var storage = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function (key, value) {
      values[key] = String(value);
    },
    removeItem: function (key) {
      delete values[key];
    },
    clear: function () {
      values = {};
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

function baseInvoke(overrides) {
  return vi.fn(function (command, args) {
    if (command === 'get_standalone_renderers') {
      return Promise.resolve([
        { plugin: 'decidr', renderers: [] },
        { plugin: 'ludflow', renderers: [] },
      ]);
    }
    if (command === 'list_local_mcp_tools') return Promise.resolve([]);
    if (command === 'send_plugin_email_code') return Promise.resolve({ status: true });
    if (command === 'list_plugin_orgs' && args.pluginName === 'decidr') return Promise.resolve(['org_123']);
    if (command === 'list_plugin_orgs' && args.pluginName === 'ludflow') return Promise.resolve(['org_123']);
    if (overrides && overrides[command]) return overrides[command](args);
    return Promise.resolve(null);
  });
}

async function enterEmailAndCode() {
  inputByPlaceholder('Email address').value = 'daenon@example.com';
  textButton('Send code').click();
  await flushPromises();
  inputByPlaceholder('000000').value = '123456';
  textButton('Verify code').click();
  await flushPromises();
}

beforeEach(function () {
  document.body.innerHTML = '<div id="root"></div>';
  installLocalStorage();
  localStorage.clear();
  window.__renderers = {};
  delete window.__companionUtils;
  delete window.__TAURI__;
});

describe('decidr onboarding renderer', function () {
  it('uses email-code auth and lets an existing user select the default organization', async function () {
    var verifyCount = 0;
    var invoke = baseInvoke({
      verify_plugin_email_code: function (args) {
        verifyCount += 1;
        if (verifyCount === 1) {
          expect(args).toEqual({
            pluginName: 'decidr',
            email: 'daenon@example.com',
            code: '123456',
          });
          return Promise.resolve({
            status: true,
            user_exists: true,
            requires_organization_selection: true,
            organizations: [{ id: 'org_123', name: 'Northstar' }],
          });
        }
        expect(args).toEqual({
          pluginName: 'decidr',
          email: 'daenon@example.com',
          code: '123456',
          organizationId: 'org_123',
        });
        return Promise.resolve({
          status: true,
          user_exists: true,
          organization_id: 'org_123',
          access_token: 'lf_mcp_oauth_token',
        });
      },
    });
    window.__TAURI__ = { core: { invoke } };
    window.__companionUtils = { openSession: vi.fn(), closeSession: vi.fn() };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    await enterEmailAndCode();
    textButton('Use as default').click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('send_plugin_email_code', {
      pluginName: 'decidr',
      email: 'daenon@example.com',
    });
    expect(invoke).not.toHaveBeenCalledWith('start_plugin_auth', expect.anything());
    expect(localStorage.getItem('decidr-onboarding:auth-org-id')).toBe('org_123');
    expect(localStorage.getItem('decidr-onboarding:agent-configured-org-id')).toBeNull();
    expect(document.body.textContent).toContain('Configure your AI agent');
    expect(document.body.textContent).toContain('What is MCPViews?');
    expect(document.body.textContent).not.toContain('Ludflow');

    var checkbox = setupCheckbox();
    expect(checkbox).toBeTruthy();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    textButton('Finish setup').click();
    await flushPromises();

    expect(localStorage.getItem('decidr-onboarding:agent-configured-org-id')).toBe('org_123');
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'decidr_timeline',
      data: { organization_id: 'org_123' },
    }));
    expect(document.body.textContent).not.toContain('Ludflow');
  });

  it('asks a new user to name an organization before completing setup', async function () {
    var verifyCount = 0;
    var invoke = baseInvoke({
      verify_plugin_email_code: function (args) {
        verifyCount += 1;
        if (verifyCount === 1) {
          return Promise.resolve({
            status: true,
            user_exists: false,
            requires_organization: true,
          });
        }
        expect(args).toEqual({
          pluginName: 'decidr',
          email: 'daenon@example.com',
          code: '123456',
          organizationName: 'Acme Decisions',
        });
        return Promise.resolve({
          status: true,
          user_exists: false,
          organization_id: 'org_123',
          access_token: 'lf_mcp_oauth_token',
          organizations: [{ id: 'org_123', name: 'Acme Decisions' }],
        });
      },
    });
    window.__TAURI__ = { core: { invoke } };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    await enterEmailAndCode();
    expect(document.body.textContent).toContain('Name your organization');
    inputByPlaceholder('Organization name').value = 'Acme Decisions';
    textButton('Create organization').click();
    await flushPromises();

    expect(localStorage.getItem('decidr-onboarding:auth-org-id')).toBe('org_123');
    expect(localStorage.getItem('decidr-onboarding:agent-configured-org-id')).toBeNull();
    expect(document.body.textContent).toContain('Configure your AI agent');
    expect(document.body.textContent).not.toContain('Ludflow');
  });

  it('does not complete onboarding until the user confirms agent setup steps', async function () {
    localStorage.setItem('decidr-onboarding:auth-org-id', 'org_123');
    var invoke = baseInvoke();
    window.__TAURI__ = { core: { invoke } };
    window.__companionUtils = { openSession: vi.fn(), closeSession: vi.fn() };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    expect(document.body.textContent).toContain('Configure your AI agent');
    expect(document.querySelector('.decidr-setup-prompt').value).toContain('Canonical full prompt');
    expect(textButton('Finish setup').disabled).toBe(true);

    setupCheckbox().checked = true;
    setupCheckbox().dispatchEvent(new Event('change'));
    expect(textButton('Finish setup').disabled).toBe(false);
    textButton('Finish setup').click();
    await flushPromises();

    expect(localStorage.getItem('decidr-onboarding:agent-configured-org-id')).toBe('org_123');
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'decidr_timeline',
    }));
  });

  it('warns before creating an organization that matches an existing available organization', async function () {
    var verifyCount = 0;
    var invoke = baseInvoke({
      verify_plugin_email_code: function (args) {
        verifyCount += 1;
        expect(args.organizationName).toBeUndefined();
        return Promise.resolve({
          status: true,
          user_exists: false,
          requires_organization: true,
          organizations: [{ id: 'org_existing', name: '__noop__', slug: 'noop' }],
        });
      },
    });
    window.__TAURI__ = { core: { invoke } };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    await enterEmailAndCode();
    inputByPlaceholder('Organization name').value = '__noop__';
    textButton('Create organization').click();
    await flushPromises();

    expect(verifyCount).toBe(1);
    expect(document.body.textContent).toContain('already available');
  });

  it('shows a retry state when package components are missing without naming internal dependencies', async function () {
    var invoke = vi.fn(function (command) {
      if (command === 'get_standalone_renderers') return Promise.resolve([{ plugin: 'decidr', renderers: [] }]);
      if (command === 'list_local_mcp_tools') return Promise.resolve([]);
      return Promise.resolve(null);
    });
    window.__TAURI__ = { core: { invoke } };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    expect(document.body.textContent).toContain('One or more DecidR package components are missing.');
    expect(document.body.textContent).not.toContain('Ludflow');
    expect(textButton('Retry component check')).toBeTruthy();
  });
});
