import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LANES,
  laneBuildEnv,
  laneBundledPluginsRoot,
  laneHome,
  laneSummary,
  laneTauriConfig,
  removeLegacyNamedEnvironmentArtifacts,
  resolveLane,
  setupCommandForLane,
} from '../scripts/mcpviews-lane.mjs';

function normalizePathSeparators(path) {
  return path.replace(/\\/g, '/');
}

describe('MCPViews lane config', function () {
  it('defaults to production when no staging flag is present', function () {
    var lane = resolveLane([], {});

    expect(lane.name).toBe('production');
    expect(lane.label).toBe('MCPViews');
    expect(laneTauriConfig(lane)).toEqual({});
    expect(laneBuildEnv(lane, {})).toEqual({});
  });

  it('selects staging only through the explicit staging flag', function () {
    var lane = resolveLane(['--staging'], {});
    var env = laneBuildEnv(lane, { PATH: '/bin' });

    expect(lane.name).toBe('staging');
    expect(laneTauriConfig(lane)).toEqual({
      productName: 'MCPViews Staging',
      identifier: 'com.mcpviews.app.staging',
      bundle: {
        resources: {
          'lane-bundled-plugins/staging/': 'bundled-plugins/staging/',
        },
      },
    });
    expect(env).toMatchObject({
      PATH: '/bin',
      MCPVIEWS_BUILD_LANE: 'staging',
      MCPVIEWS_BRANDED_AUTH_ORIGIN: 'staging',
    });
  });

  it('rejects explicit production flags because production is the default', function () {
    expect(function () {
      resolveLane(['--prod'], {});
    }).toThrow(/Omit lane flags for production/);
    expect(function () {
      resolveLane(['--production'], {});
    }).toThrow(/Omit lane flags for production/);
  });

  it('keeps production and staging profiles separate', function () {
    var productionHome = resolve('/Users/tester', '.mcpviews');
    var stagingHome = resolve('/Users/tester', '.mcpviews-staging');

    expect(laneHome(LANES.production, '/Users/tester')).toBe(productionHome);
    expect(laneHome(LANES.staging, '/Users/tester')).toBe(stagingHome);

    expect(laneSummary(LANES.production, '/Users/tester')).toMatchObject({
      name: 'production',
      home: productionHome,
      httpPort: 4200,
      buildLaneEnv: null,
      pluginChannel: 'production',
    });
    expect(laneSummary(LANES.staging, '/Users/tester')).toMatchObject({
      name: 'staging',
      home: stagingHome,
      httpPort: 4201,
      buildLaneEnv: 'staging',
      pluginChannel: 'staging',
    });
  });

  it('sets up the staging profile by pointing MCPVIEWS_HOME at the staging home', function () {
    var setup = setupCommandForLane(LANES.staging, '/Users/tester', { force: true });

    expect(setup.args.slice(-2)).toEqual(['staging', '--force']);
    expect(setup.env.MCPVIEWS_HOME).toBe(resolve('/Users/tester', '.mcpviews-staging'));
    expect(setup.env.MCPVIEWS_RELOAD_PORT).toBe('4201');
  });

  it('keeps generated staging app resources outside the production bundle glob', function () {
    expect(normalizePathSeparators(laneBundledPluginsRoot(LANES.staging))).toMatch(
      /src-tauri\/lane-bundled-plugins\/staging$/,
    );
    expect(JSON.stringify(laneTauriConfig(LANES.production))).not.toContain(
      'lane-bundled-plugins',
    );
    expect(JSON.stringify(laneTauriConfig(LANES.staging))).toContain(
      'bundled-plugins/staging/',
    );
  });

  it('removes old named-environment clone artifacts from a lane profile', function () {
    var home = join(tmpdir(), `mcpviews-lane-cleanup-${Date.now()}`);
    mkdirSync(join(home, 'plugins', 'decidr-staging'), { recursive: true });
    mkdirSync(join(home, 'plugins', 'ludflow-staging'), { recursive: true });
    writeFileSync(join(home, 'named-environments.json'), '{}');

    try {
      removeLegacyNamedEnvironmentArtifacts(home);

      expect(existsSync(join(home, 'plugins', 'decidr-staging'))).toBe(false);
      expect(existsSync(join(home, 'plugins', 'ludflow-staging'))).toBe(false);
      expect(existsSync(join(home, 'named-environments.json'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
