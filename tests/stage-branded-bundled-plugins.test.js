import AdmZip from 'adm-zip';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

var BUNDLED_HASH_FILE;
var stageBrandedBundledPlugins;
var stageLocalSetupPlugin;
var verifyBrandedAuthOrigins;
var verifyBrandedBundle;
var verifyLudflowIframeRenderer;
var verifySetupEmailCodeAuth;
var describeIfScriptImportSupported = process.platform === 'win32' ? describe.skip : describe;

var tempDirs = [];

function tempDir() {
  var dir = mkdtempSync(join(tmpdir(), 'mcpviews-branded-bundle-'));
  tempDirs.push(dir);
  return dir;
}

function pluginManifest(name, version) {
  return {
    name: name,
    version: version,
    renderers: {},
    renderer_definitions: [],
  };
}

function pluginManifestWithAuth(name, version, origin, codeAuth) {
  var manifest = pluginManifest(name, version);
  manifest.mcp = {
    url: 'https://example.test/api/mcp',
    auth: {
      type: 'oauth',
      client_id: 'client',
      auth_url: origin + '/oauth/authorize',
      token_url: origin + '/oauth/token',
      email_code_auth: codeAuth === false ? undefined : { enabled: true },
      scopes: ['mcp:tools'],
    },
    tool_prefix: name + '__',
  };
  if (codeAuth === false) delete manifest.mcp.auth.email_code_auth;
  return manifest;
}

function writeLocalPlugin(root, name, version) {
  var pluginDir = join(root, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(pluginManifest(name, version), null, 2));
  return pluginDir;
}

function writeSetupPlugin(root, withDuplicateEmailCodeRenderer = false, onboardingSource) {
  var pluginDir = join(root, 'decidr-setup');
  mkdirSync(join(pluginDir, 'renderers'), { recursive: true });
  var manifest = pluginManifest('decidr-setup', '0.1.0');
  manifest.renderers = { decidr_onboarding: 'renderers/decidr-onboarding.js' };
  manifest.renderer_definitions = [{ name: 'decidr_onboarding' }];
  if (withDuplicateEmailCodeRenderer) {
    manifest.renderers.plugin_email_code_auth = 'renderers/plugin-email-code-auth.js';
    manifest.renderer_definitions.push({ name: 'plugin_email_code_auth' });
    writeFileSync(join(pluginDir, 'renderers', 'plugin-email-code-auth.js'), 'window.__renderers = window.__renderers || {};');
  }
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(pluginDir, 'renderers', 'decidr-onboarding.js'),
    onboardingSource || 'send_plugin_email_code(); verify_plugin_email_code(); window.__renderers = window.__renderers || {};',
  );
  return pluginDir;
}

function zipPlugin(name, version) {
  var zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(pluginManifest(name, version), null, 2)));
  if (name === 'ludflow') {
    zip.addFile(
      'renderers/ludflow-pages.js',
      Buffer.from(
        "callTool('create_app_embed_session'); var iframe = document.createElement('iframe'); iframe.setAttribute('sandbox', 'allow-storage-access-by-user-activation');",
      ),
    );
  } else {
    zip.addFile('renderers/index.js', Buffer.from('window.__renderers = window.__renderers || {};'));
  }
  return zip.toBuffer();
}

function assetResponse(buffer) {
  return {
    ok: true,
    arrayBuffer: function () {
      return Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    },
  };
}

afterEach(function () {
  tempDirs.forEach(function (dir) {
    rmSync(dir, { recursive: true, force: true });
  });
  tempDirs = [];
});

beforeAll(async function () {
  if (process.platform === 'win32') return;
  var helpers = await import('../scripts/stage-branded-bundled-plugins.mjs');
  BUNDLED_HASH_FILE = helpers.BUNDLED_HASH_FILE;
  stageBrandedBundledPlugins = helpers.stageBrandedBundledPlugins;
  stageLocalSetupPlugin = helpers.stageLocalSetupPlugin;
  verifyBrandedAuthOrigins = helpers.verifyBrandedAuthOrigins;
  verifyBrandedBundle = helpers.verifyBrandedBundle;
  verifyLudflowIframeRenderer = helpers.verifyLudflowIframeRenderer;
  verifySetupEmailCodeAuth = helpers.verifySetupEmailCodeAuth;
});

describeIfScriptImportSupported('stage branded bundled plugins', function () {
  it('stages local setup plus latest stable DecidR and Ludflow ZIP assets', async function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    var setupPluginDir = writeSetupPlugin(root);
    var decidrZip = zipPlugin('decidr', '1.0.0');
    var ludflowZip = zipPlugin('ludflow', '2.0.0');

    var fetchImpl = vi.fn(function (url) {
      if (String(url).includes('/repos/DeeJanuz/decidr-plugin/releases')) {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([
              { draft: false, prerelease: true, tag_name: '1.1.0-rc.1', assets: [] },
              {
                draft: false,
                prerelease: false,
                tag_name: '1.0.0',
                assets: [{ name: 'decidr.zip', browser_download_url: 'https://example.test/decidr.zip' }],
              },
            ]);
          },
        });
      }
      if (String(url).includes('/repos/DeeJanuz/ludflow-mcpviews/releases')) {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([
              {
                draft: false,
                prerelease: false,
                tag_name: 'v2.0.0',
                assets: [{ name: 'ludflow-plugin.zip', browser_download_url: 'https://example.test/ludflow.zip' }],
              },
            ]);
          },
        });
      }
      if (url === 'https://example.test/decidr.zip') return Promise.resolve(assetResponse(decidrZip));
      if (url === 'https://example.test/ludflow.zip') return Promise.resolve(assetResponse(ludflowZip));
      throw new Error('Unexpected fetch URL: ' + url);
    });

    var metadata = await stageBrandedBundledPlugins({
      stageRoot: stageRoot,
      setupPluginDir: setupPluginDir,
      fetchImpl: fetchImpl,
    });

    expect(metadata.plugins.map(function (plugin) { return plugin.name; })).toEqual([
      'decidr-setup',
      'decidr',
      'ludflow',
    ]);
    expect(existsSync(join(stageRoot, 'decidr', 'manifest.json'))).toBe(true);
    expect(existsSync(join(stageRoot, 'decidr', BUNDLED_HASH_FILE))).toBe(true);
    expect(readFileSync(join(stageRoot, 'decidr', 'manifest.json'), 'utf8')).toContain('"version": "1.0.0"');
    expect(verifyBrandedBundle({ stageRoot: stageRoot })).toEqual([
      'decidr-setup v0.1.0',
      'decidr v1.0.0',
      'ludflow v2.0.0',
    ]);
    expect(function () {
      verifySetupEmailCodeAuth({ stageRoot: stageRoot });
    }).not.toThrow();
  });

  it('fails when the latest stable release is missing the expected ZIP asset', async function () {
    var root = tempDir();
    var setupPluginDir = writeSetupPlugin(root);
    var fetchImpl = vi.fn(function () {
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve([{ draft: false, prerelease: false, tag_name: '1.0.0', assets: [] }]);
        },
      });
    });

    await expect(stageBrandedBundledPlugins({
      stageRoot: join(root, 'stage'),
      setupPluginDir: setupPluginDir,
      fetchImpl: fetchImpl,
      plugins: [{ name: 'decidr', repo: 'DeeJanuz/decidr-plugin', assetName: 'decidr.zip' }],
    })).rejects.toThrow('missing decidr.zip');
  });

  it('fails branded bundle verification when DecidR setup bundles the host-owned email-code auth renderer', function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    var setupPluginDir = writeSetupPlugin(root, true);

    stageLocalSetupPlugin({ stageRoot: stageRoot, setupPluginDir: setupPluginDir });

    expect(function () {
      verifySetupEmailCodeAuth({ stageRoot: stageRoot });
    }).toThrow('host-owned plugin_email_code_auth');
  });

  it('fails branded bundle verification when DecidR setup starts browser OAuth', function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    var setupPluginDir = writeSetupPlugin(
      root,
      false,
      'send_plugin_email_code(); verify_plugin_email_code(); start_plugin_auth();',
    );

    stageLocalSetupPlugin({ stageRoot: stageRoot, setupPluginDir: setupPluginDir });

    expect(function () {
      verifySetupEmailCodeAuth({ stageRoot: stageRoot });
    }).toThrow('browser OAuth');
  });

  it('fails when bundled DecidR and Ludflow auth origins differ', function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    mkdirSync(join(stageRoot, 'decidr'), { recursive: true });
    mkdirSync(join(stageRoot, 'ludflow'), { recursive: true });
    writeFileSync(
      join(stageRoot, 'decidr', 'manifest.json'),
      JSON.stringify(pluginManifestWithAuth('decidr', '1.0.0', 'https://app.ludflow.com'), null, 2)
    );
    writeFileSync(
      join(stageRoot, 'ludflow', 'manifest.json'),
      JSON.stringify(pluginManifestWithAuth('ludflow', '1.0.0', 'https://staging.app.ludflow.com'), null, 2)
    );

    expect(function () {
      verifyBrandedAuthOrigins({ stageRoot: stageRoot });
    }).toThrow('auth origins differ');
  });

  it('fails when a bundled OAuth plugin omits email-code auth metadata', function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    mkdirSync(join(stageRoot, 'decidr'), { recursive: true });
    mkdirSync(join(stageRoot, 'ludflow'), { recursive: true });
    writeFileSync(
      join(stageRoot, 'decidr', 'manifest.json'),
      JSON.stringify(pluginManifestWithAuth('decidr', '1.0.0', 'https://app.ludflow.com', false), null, 2)
    );
    writeFileSync(
      join(stageRoot, 'ludflow', 'manifest.json'),
      JSON.stringify(pluginManifestWithAuth('ludflow', '1.0.0', 'https://app.ludflow.com'), null, 2)
    );

    expect(function () {
      verifyBrandedAuthOrigins({ stageRoot: stageRoot });
    }).toThrow('email_code_auth.enabled=true');
  });

  it('fails branded bundle verification when Ludflow renderer uses a native panel path', function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    mkdirSync(join(stageRoot, 'ludflow', 'renderers'), { recursive: true });
    writeFileSync(
      join(stageRoot, 'ludflow', 'manifest.json'),
      JSON.stringify(pluginManifestWithAuth('ludflow', '1.0.0', 'https://app.ludflow.com'), null, 2)
    );
    writeFileSync(
      join(stageRoot, 'ludflow', 'renderers', 'ludflow-pages.js'),
      "callTool('create_app_embed_session'); var iframe = document.createElement('iframe'); iframe.setAttribute('sandbox', 'allow-storage-access-by-user-activation'); window.__mcpviewsHost.mountNativeAppView({ url: 'https://app.ludflow.com' });",
    );

    expect(function () {
      verifyLudflowIframeRenderer({ stageRoot: stageRoot });
    }).toThrow('mountNativeAppView');
  });

  it('fails branded bundle verification when Ludflow renderer retains iframe priming or close sentinels', function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    mkdirSync(join(stageRoot, 'ludflow', 'renderers'), { recursive: true });
    writeFileSync(
      join(stageRoot, 'ludflow', 'manifest.json'),
      JSON.stringify(pluginManifestWithAuth('ludflow', '1.0.0', 'https://app.ludflow.com'), null, 2)
    );
    writeFileSync(
      join(stageRoot, 'ludflow', 'renderers', 'ludflow-pages.js'),
      "callTool('create_app_embed_session'); var iframe = document.createElement('iframe'); iframe.setAttribute('sandbox', 'allow-storage-access-by-user-activation'); primeMcpviewsWebSession();",
    );

    expect(function () {
      verifyLudflowIframeRenderer({ stageRoot: stageRoot });
    }).toThrow('primeMcpviewsWebSession');
  });
});
