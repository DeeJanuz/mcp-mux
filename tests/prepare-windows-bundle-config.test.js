import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  prepareWindowsBundleConfig,
  windowsBundleVersion,
} from '../scripts/prepare-windows-bundle-config.mjs';

describe('prepare Windows bundle config', function () {
  it('keeps stable semver versions unchanged', function () {
    expect(windowsBundleVersion('0.2.28')).toBe('0.2.28');
  });

  it('coerces prerelease versions to Windows MSI-compatible numeric suffixes', function () {
    expect(windowsBundleVersion('0.2.28-beta.7')).toBe('0.2.28-7');
  });

  it('rejects prerelease versions without numeric suffixes', function () {
    expect(function () {
      windowsBundleVersion('0.2.28-beta');
    }).toThrow(/must end with a numeric identifier/);
  });

  it('rejects prerelease numbers outside the MSI-supported range', function () {
    expect(function () {
      windowsBundleVersion('0.2.28-beta.70000');
    }).toThrow(/0-65535/);
  });

  it('writes the Tauri override config from the release version', function () {
    var dir = join(tmpdir(), `mcpviews-windows-config-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.2.28' }));

      var result = prepareWindowsBundleConfig({
        cwd: dir,
        releaseVersion: '0.3.0-rc.4',
      });

      expect(result.bundleVersion).toBe('0.3.0-4');
      expect(JSON.parse(readFileSync(join(dir, 'tauri.windows.release.conf.json'), 'utf8'))).toEqual({
        version: '0.3.0-4',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
