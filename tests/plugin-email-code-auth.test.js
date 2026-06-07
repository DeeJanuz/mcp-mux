import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var rendererCode = readFileSync(
  join(__dirnameResolved, '../public/renderers/plugin-email-code-auth.js'),
  'utf8',
).replace(/\r\n/g, '\n');
var indexHtml = readFileSync(join(__dirnameResolved, '../src/index.html'), 'utf8').replace(/\r\n/g, '\n');

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

beforeEach(function () {
  document.body.innerHTML = '<div id="root" data-session-id="auth-session"></div>';
  window.__renderers = {};
  delete window.__TAURI__;
  delete window.__companionUtils;
});

describe('plugin email-code auth renderer', function () {
  it('ships as a built-in renderer', function () {
    expect(indexHtml).toContain('<script src="./renderers/plugin-email-code-auth.js"></script>');
  });

  it('sends and verifies a redacted code-auth session', async function () {
    var invoke = vi.fn(function (command, args) {
      if (command === 'send_plugin_email_code') {
        expect(args).toEqual({ pluginName: 'decidr', email: 'daenon@example.com' });
        return Promise.resolve({ status: true });
      }
      if (command === 'verify_plugin_email_code') {
        expect(args).toEqual({
          pluginName: 'decidr',
          email: 'daenon@example.com',
          code: '123456',
          organizationId: 'org_123',
          organizationName: null,
        });
        return Promise.resolve({
          status: true,
          authenticated: true,
          organization_id: 'org_123',
        });
      }
      return Promise.resolve(null);
    });
    window.__TAURI__ = { core: { invoke: invoke } };
    window.__companionUtils = { closeSession: vi.fn() };

    loadRenderer();
    window.__renderers.plugin_email_code_auth(document.getElementById('root'), {
      plugin_name: 'decidr',
      plugin_label: 'DecidR',
      organization_id: 'org_123',
    });

    inputByPlaceholder('you@example.com').value = 'daenon@example.com';
    textButton('Send code').click();
    await flushPromises();
    inputByPlaceholder('000000').value = '123456';
    textButton('Verify').click();
    await flushPromises();

    expect(document.body.textContent).toContain('DecidR is connected');
    expect(invoke).not.toHaveBeenCalledWith('start_plugin_auth', expect.anything());
  });
});
