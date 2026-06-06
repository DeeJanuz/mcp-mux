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

beforeEach(function () {
  document.body.innerHTML = '<div id="root"></div>';
  installLocalStorage();
  localStorage.clear();
  window.__renderers = {};
  delete window.__companionUtils;
  delete window.__TAURI__;
});

describe('decidr onboarding renderer', function () {
  it('authenticates DecidR and Ludflow to the same selected organization', async function () {
    var invoke = vi.fn(function (command, args) {
      if (command === 'get_standalone_renderers') {
        return Promise.resolve([
          { plugin: 'decidr', renderers: [] },
          { plugin: 'ludflow', renderers: [] },
        ]);
      }
      if (command === 'list_local_mcp_tools') return Promise.resolve([]);
      if (command === 'start_plugin_auth') return Promise.resolve('ok');
      if (command === 'call_local_mcp_tool' && args.name === 'decidr__list_organizations') {
        return Promise.resolve({
          content: [{
            type: 'text',
            text: JSON.stringify({ data: [{ id: 'org_123', name: 'Northstar' }] }),
          }],
        });
      }
      if (command === 'list_plugin_orgs' && args.pluginName === 'decidr') return Promise.resolve(['org_123']);
      if (command === 'list_plugin_orgs' && args.pluginName === 'ludflow') return Promise.resolve(['org_123']);
      return Promise.resolve(null);
    });
    window.__TAURI__ = { core: { invoke } };
    window.__companionUtils = { openSession: vi.fn() };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    textButton('Sign in to DecidR').click();
    await flushPromises();
    textButton('Use organization').click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('start_plugin_auth', {
      pluginName: 'decidr',
      orgId: null,
    });
    expect(invoke).toHaveBeenCalledWith('start_plugin_auth', {
      pluginName: 'decidr',
      orgId: 'org_123',
    });
    expect(invoke).toHaveBeenCalledWith('start_plugin_auth', {
      pluginName: 'ludflow',
      orgId: 'org_123',
    });
    expect(localStorage.getItem('decidr-onboarding:completed-org-id')).toBe('org_123');
    expect(document.body.textContent).toContain('DecidR and Ludflow are connected.');

    textButton('Open DecidR').click();
    expect(window.__companionUtils.openSession).toHaveBeenCalledWith(expect.objectContaining({
      contentType: 'decidr_dashboard',
      data: { organization_id: 'org_123' },
    }));
  });

  it('creates a new organization before shared plugin authentication', async function () {
    var invoke = vi.fn(function (command, args) {
      if (command === 'get_standalone_renderers') {
        return Promise.resolve([
          { plugin: 'decidr', renderers: [] },
          { plugin: 'ludflow', renderers: [] },
        ]);
      }
      if (command === 'list_local_mcp_tools') return Promise.resolve([]);
      if (command === 'start_plugin_auth') return Promise.resolve('ok');
      if (command === 'call_local_mcp_tool' && args.name === 'decidr__list_organizations') {
        return Promise.resolve({ content: [{ type: 'text', text: JSON.stringify({ data: [] }) }] });
      }
      if (command === 'call_local_mcp_tool' && args.name === 'decidr__create_organization') {
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify({ data: { id: 'org_new', name: args.arguments.name } }) }],
        });
      }
      if (command === 'list_plugin_orgs' && args.pluginName === 'decidr') return Promise.resolve(['org_new']);
      if (command === 'list_plugin_orgs' && args.pluginName === 'ludflow') return Promise.resolve(['org_new']);
      return Promise.resolve(null);
    });
    window.__TAURI__ = { core: { invoke } };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    textButton('Sign in to DecidR').click();
    await flushPromises();
    document.querySelector('input').value = 'New Shared Org';
    textButton('Create organization').click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('call_local_mcp_tool', {
      name: 'decidr__create_organization',
      arguments: { name: 'New Shared Org' },
    });
    expect(invoke).toHaveBeenCalledWith('start_plugin_auth', {
      pluginName: 'decidr',
      orgId: 'org_new',
    });
    expect(invoke).toHaveBeenCalledWith('start_plugin_auth', {
      pluginName: 'ludflow',
      orgId: 'org_new',
    });
    expect(localStorage.getItem('decidr-onboarding:completed-org-id')).toBe('org_new');
  });

  it('shows a retry state when bundled plugins are missing', async function () {
    var invoke = vi.fn(function (command) {
      if (command === 'get_standalone_renderers') return Promise.resolve([{ plugin: 'decidr', renderers: [] }]);
      if (command === 'list_local_mcp_tools') return Promise.resolve([]);
      return Promise.resolve(null);
    });
    window.__TAURI__ = { core: { invoke } };

    loadRenderer();
    window.__renderers.decidr_onboarding(document.getElementById('root'), {});
    await flushPromises();

    expect(document.body.textContent).toContain('Missing bundled plugins: ludflow.');
    expect(textButton('Retry plugin check')).toBeTruthy();
  });
});
