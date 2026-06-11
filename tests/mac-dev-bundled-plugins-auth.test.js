import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var macDevBundleRoot = join(__dirnameResolved, '../src-tauri/bundled-plugins/mac-dev');
var hasMacDevBundle = ['decidr', 'ludflow', 'decidr-setup'].every(function (pluginName) {
  return existsSync(join(macDevBundleRoot, pluginName, 'manifest.json'));
});
var describeMacDevBundle = hasMacDevBundle ? describe : describe.skip;

function readManifest(pluginName) {
  return JSON.parse(readFileSync(join(macDevBundleRoot, pluginName, 'manifest.json'), 'utf8'));
}

function authOrigin(manifest) {
  return new URL(manifest.mcp.auth.token_url).origin;
}

describeMacDevBundle('mac-dev bundled plugin auth contract', function () {
  it('declares email-code auth on bundled DecidR and Ludflow plugins', function () {
    var decidr = readManifest('decidr');
    var ludflow = readManifest('ludflow');

    expect(decidr.mcp.auth.email_code_auth).toEqual({ enabled: true });
    expect(ludflow.mcp.auth.email_code_auth).toEqual({ enabled: true });
  });

  it('keeps bundled DecidR and Ludflow auth on the same production origin', function () {
    var decidr = readManifest('decidr');
    var ludflow = readManifest('ludflow');

    expect(authOrigin(decidr)).toBe('https://app.ludflow.com');
    expect(authOrigin(ludflow)).toBe('https://app.ludflow.com');
    expect(ludflow.mcp.url).toBe('https://app.ludflow.com/api/mcp');
  });

  it('does not duplicate the host-owned email-code renderer in DecidR setup', function () {
    var setup = readManifest('decidr-setup');
    var rendererNames = (setup.renderer_definitions || []).map(function (definition) {
      return definition && definition.name;
    });

    expect(setup.renderers.plugin_email_code_auth).toBeUndefined();
    expect(rendererNames).not.toContain('plugin_email_code_auth');
    expect(setup.registry_index.renderer_names).not.toContain('plugin_email_code_auth');
    expect(existsSync(join(macDevBundleRoot, 'decidr-setup', 'renderers', 'plugin-email-code-auth.js'))).toBe(false);
  });

  it('uses in-app email-code auth from the DecidR setup renderer', function () {
    var setup = readManifest('decidr-setup');
    var onboardingSource = readFileSync(
      join(macDevBundleRoot, 'decidr-setup', setup.renderers.decidr_onboarding),
      'utf8',
    );

    expect(onboardingSource).toContain('send_plugin_email_code');
    expect(onboardingSource).toContain('verify_plugin_email_code');
    expect(onboardingSource).not.toContain('start_plugin_auth');
  });

  it('keeps Ludflow embedded app renderers on the authenticated iframe path', function () {
    var source = readFileSync(
      join(macDevBundleRoot, 'ludflow', 'renderers', 'ludflow-pages.js'),
      'utf8',
    );

    expect(source).toContain('create_app_embed_session');
    expect(source).toContain("document.createElement('iframe')");
    expect(source).toContain('allow-storage-access-by-user-activation');
    expect(source).not.toContain('mountNativeAppView');
    expect(source).not.toContain('mountNativePanel');
  });

  it('keeps Ludflow plugin auth separate from iframe web-session handoff', function () {
    var ludflow = readManifest('ludflow');
    var source = readFileSync(
      join(macDevBundleRoot, 'ludflow', 'renderers', 'ludflow-pages.js'),
      'utf8',
    );

    expect(ludflow.mcp.auth.email_code_auth).toEqual({ enabled: true });
    expect(source).toContain('create_app_embed_session');
    expect(source).not.toContain('better-auth.session.token');
    expect(source).not.toContain('__Secure-better-auth.session.token');
  });
});
