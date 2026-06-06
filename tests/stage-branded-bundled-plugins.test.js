import AdmZip from 'adm-zip';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED_HASH_FILE,
  stageBrandedBundledPlugins,
  verifyBrandedBundle,
} from '../scripts/stage-branded-bundled-plugins.mjs';

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

function writeLocalPlugin(root, name, version) {
  var pluginDir = join(root, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(pluginManifest(name, version), null, 2));
  return pluginDir;
}

function zipPlugin(name, version) {
  var zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(pluginManifest(name, version), null, 2)));
  zip.addFile('renderers/index.js', Buffer.from('window.__renderers = window.__renderers || {};'));
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

describe('stage branded bundled plugins', function () {
  it('stages local setup plus latest stable DecidR and Ludflow ZIP assets', async function () {
    var root = tempDir();
    var stageRoot = join(root, 'stage');
    var setupPluginDir = writeLocalPlugin(root, 'decidr-setup', '0.1.0');
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
  });

  it('fails when the latest stable release is missing the expected ZIP asset', async function () {
    var root = tempDir();
    var setupPluginDir = writeLocalPlugin(root, 'decidr-setup', '0.1.0');
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
});
