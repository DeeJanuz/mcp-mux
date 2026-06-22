import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writePluginHash } from './plugin-hash.mjs';
import { validateManifestForChannel } from './use-local-plugin-channel.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(repoRoot, '..');
const laneLockDir = join(repoRoot, '.mcpviews-lane.lock');
const require = createRequire(import.meta.url);

export const LANES = {
  production: {
    name: 'production',
    label: 'MCPViews',
    homeDirName: '.mcpviews',
    httpPort: 4200,
    tauriConfig: {},
    buildEnv: {},
    pluginChannel: 'production',
  },
  staging: {
    name: 'staging',
    label: 'MCPViews Staging',
    homeDirName: '.mcpviews-staging',
    httpPort: 4201,
    tauriConfig: {
      productName: 'MCPViews Staging',
      identifier: 'com.mcpviews.app.staging',
      bundle: {
        resources: {
          'lane-bundled-plugins/staging/': 'bundled-plugins/staging/',
        },
      },
    },
    buildEnv: {
      MCPVIEWS_BUILD_LANE: 'staging',
      MCPVIEWS_BRANDED_AUTH_ORIGIN: 'staging',
    },
    pluginChannel: 'staging',
  },
};

const PROD_FLAGS = new Set(['--prod', '--production']);
const stagingPluginSpecs = [
  {
    name: 'decidr',
    repoDir: resolve(workspaceRoot, 'decidr-plugin'),
    buildEnv: 'DECIDR_MCPVIEWS_BUILD_CHANNEL',
    zipPath: 'release/decidr.zip',
  },
  {
    name: 'ludflow',
    repoDir: resolve(workspaceRoot, 'ludflow-mcpviews'),
    buildEnv: 'LUDFLOW_MCPVIEWS_BUILD_CHANNEL',
    zipPath: 'release/ludflow-plugin.zip',
  },
];
const setupPluginSourceDir = join(repoRoot, 'bundled-plugins', 'decidr-setup');
const stagingBundleVersionsFile = 'bundled-plugin-versions.json';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

export function resolveLane(args = [], env = process.env) {
  const forbiddenFlag = args.find((arg) => PROD_FLAGS.has(arg));
  if (forbiddenFlag) {
    throw new Error(`${forbiddenFlag} is not supported. Omit lane flags for production; use --staging only for staging.`);
  }

  if (hasFlag(args, '--staging') || env.MCPVIEWS_BUILD_LANE === 'staging') {
    return LANES.staging;
  }

  return LANES.production;
}

export function laneHome(lane, home = homedir()) {
  return resolve(home, lane.homeDirName);
}

export function laneBuildEnv(lane, env = process.env) {
  if (lane.name !== 'staging') {
    return { ...env };
  }
  return {
    ...env,
    ...lane.buildEnv,
  };
}

export function laneTauriConfig(lane) {
  return {
    ...lane.tauriConfig,
  };
}

export function laneConfigPath(lane) {
  return join(repoRoot, `tauri.${lane.name}.generated.conf.json`);
}

export function laneBundledPluginsRoot(lane) {
  return join(repoRoot, 'src-tauri', 'lane-bundled-plugins', lane.name);
}

export function writeLaneTauriConfig(lane, outputPath = laneConfigPath(lane)) {
  writeFileSync(outputPath, `${JSON.stringify(laneTauriConfig(lane), null, 2)}\n`);
  return outputPath;
}

export function laneSummary(lane, home = homedir()) {
  return {
    name: lane.name,
    label: lane.label,
    home: laneHome(lane, home),
    httpPort: lane.httpPort,
    buildLaneEnv: lane.buildEnv.MCPVIEWS_BUILD_LANE || null,
    pluginChannel: lane.pluginChannel,
    tauriConfig: laneTauriConfig(lane),
  };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    if (result.error) throw result.error;
    throw new Error(`Command failed (${result.status || 1}): ${[command, ...args].join(' ')}`);
  }
}

function copyDirectory(source, destination) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (path) => !path.includes('/.git/') && !path.endsWith('.DS_Store'),
  });
}

function safeExtractZip(zipPath, destination) {
  const AdmZip = require('adm-zip');
  const archive = new AdmZip(zipPath);
  for (const entry of archive.getEntries()) {
    const entryName = String(entry.entryName || '').replace(/\\/g, '/');
    const parts = entryName.split('/').filter(Boolean);
    if (
      parts.length === 0 ||
      entryName.startsWith('/') ||
      parts.some((part) => part === '..')
    ) {
      throw new Error(`Unsafe ZIP entry path: ${entry.entryName}`);
    }

    const outputPath = join(destination, ...parts);
    if (entry.isDirectory) {
      mkdirSync(outputPath, { recursive: true });
      continue;
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, entry.getData());
  }
}

function pluginSourceRoot(extractedRoot) {
  if (existsSync(join(extractedRoot, 'manifest.json'))) {
    return extractedRoot;
  }

  const candidates = readdirSync(extractedRoot)
    .map((entry) => join(extractedRoot, entry))
    .filter((path) => statSync(path).isDirectory() && existsSync(join(path, 'manifest.json')));
  if (candidates.length !== 1) {
    throw new Error(`Expected one plugin manifest in ${extractedRoot}, found ${candidates.length}`);
  }
  return candidates[0];
}

function buildPlugin(spec, channel) {
  const buildScript = join(spec.repoDir, 'build.sh');
  if (!existsSync(buildScript)) {
    throw new Error(`Missing build.sh for ${spec.name}: ${buildScript}`);
  }
  runChecked('bash', ['build.sh'], {
    cwd: spec.repoDir,
    env: {
      ...process.env,
      [spec.buildEnv]: channel,
    },
  });
}

function stageStaticPlugin(sourceDir, stageRoot) {
  const manifestPath = join(sourceDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin source is missing manifest.json: ${sourceDir}`);
  }
  const manifest = readJson(manifestPath);
  const destination = join(stageRoot, manifest.name);
  copyDirectory(sourceDir, destination);
  const sha256 = writePluginHash(destination);
  return {
    name: manifest.name,
    version: manifest.version,
    source: `local:${sourceDir}`,
    sha256,
    download_url: manifest.download_url || null,
  };
}

function stageBuiltPlugin(spec, channel, stageRoot) {
  buildPlugin(spec, channel);
  const zipPath = join(spec.repoDir, spec.zipPath);
  if (!existsSync(zipPath)) {
    throw new Error(`Missing built ZIP for ${spec.name}: ${zipPath}`);
  }

  const extractRoot = mkdtempSync(join(tmpdir(), `mcpviews-${spec.name}-${channel}-bundle-`));
  try {
    safeExtractZip(zipPath, extractRoot);
    const sourceRoot = pluginSourceRoot(extractRoot);
    const manifest = readJson(join(sourceRoot, 'manifest.json'));
    if (manifest.name !== spec.name) {
      throw new Error(`Expected ${spec.name} ZIP, got ${manifest.name}`);
    }
    validateManifestForChannel(spec.name, manifest, channel);

    if (channel === 'staging') {
      manifest.download_url = null;
      manifest.plugin_rules = [
        `This plugin is bundled with the MCPViews Staging app and points at staging endpoints only. Use it for pre-production validation, not production governance actions.`,
        ...(manifest.plugin_rules || []),
      ];
    }

    const destination = join(stageRoot, manifest.name);
    copyDirectory(sourceRoot, destination);
    writeJson(join(destination, 'manifest.json'), manifest);
    const sha256 = writePluginHash(destination);

    return {
      name: manifest.name,
      version: manifest.version,
      source: `local:${spec.repoDir}`,
      zip: zipPath,
      sha256,
      download_url: manifest.download_url || null,
    };
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }
}

export function stageLaneBundledPlugins(lane, options = {}) {
  if (lane.name !== 'staging') {
    throw new Error('Dedicated bundled plugin staging is only supported for the --staging lane.');
  }

  const stageRoot = options.stageRoot || laneBundledPluginsRoot(lane);
  const channel = lane.pluginChannel;
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });

  const staged = [stageStaticPlugin(setupPluginSourceDir, stageRoot)];
  for (const spec of stagingPluginSpecs) {
    staged.push(stageBuiltPlugin(spec, channel, stageRoot));
  }

  const metadata = {
    lane: lane.name,
    channel,
    generated_at: new Date().toISOString(),
    resource_target: 'bundled-plugins/staging/',
    plugins: staged,
  };
  writeJson(join(stageRoot, stagingBundleVersionsFile), metadata);
  return metadata;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function withLaneLock(action) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      mkdirSync(laneLockDir);
      try {
        return await action();
      } finally {
        rmSync(laneLockDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        await sleep(200);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Timed out waiting for lane setup lock: ${laneLockDir}`);
}

function printSummary(summary) {
  console.log(`${summary.label} lane`);
  console.log(`  lane: ${summary.name}`);
  console.log(`  home: ${summary.home}`);
  console.log(`  http: ${summary.httpPort}`);
  console.log(`  plugin channel: ${summary.pluginChannel}`);
  if (summary.buildLaneEnv) {
    console.log(`  build env: MCPVIEWS_BUILD_LANE=${summary.buildLaneEnv}`);
  } else {
    console.log('  build env: none (production default)');
  }
}

function commandArgs(args) {
  const [command = 'status', ...rest] = args;
  return { command, rest };
}

function hasCanonicalPluginProfile(homePath) {
  return (
    existsSync(join(homePath, 'plugins', 'decidr', 'manifest.json')) ||
    existsSync(join(homePath, 'plugins', 'ludflow', 'manifest.json'))
  );
}

export function removeLegacyNamedEnvironmentArtifacts(homePath) {
  for (const pluginName of ['decidr-staging', 'ludflow-staging']) {
    rmSync(join(homePath, 'plugins', pluginName), { recursive: true, force: true });
  }
  rmSync(join(homePath, 'named-environments.json'), { force: true });
}

export function setupCommandForLane(lane, home = homedir(), options = {}) {
  const profileHome = laneHome(lane, home);
  const args = [join(repoRoot, 'scripts', 'use-local-plugin-channel.mjs'), lane.pluginChannel];
  if (options.force) {
    args.push('--force');
  }
  return {
    command: process.execPath,
    args,
    env: {
      ...process.env,
      MCPVIEWS_HOME: profileHome,
      MCPVIEWS_RELOAD_PORT: String(lane.httpPort),
    },
  };
}

function printInstalledStatus(lane) {
  const home = laneHome(lane);
  const markerPath = join(home, 'channel-backups', 'active-channel.json');
  printSummary(laneSummary(lane));
  if (!existsSync(markerPath)) {
    console.log('  installed channel: none');
    return;
  }
  const marker = readJson(markerPath);
  console.log(`  installed channel: ${marker.channel || 'unknown'}`);
}

function printStagedPluginMetadata(metadata) {
  console.log(`Staged ${metadata.channel} plugins for ${metadata.lane} lane`);
  console.log(`  target resource: ${metadata.resource_target}`);
  for (const plugin of metadata.plugins) {
    console.log(`  - ${plugin.name} v${plugin.version} sha256=${plugin.sha256}`);
  }
}

function builtAppPath(lane) {
  return join(repoRoot, 'target', 'release', 'bundle', 'macos', `${lane.label}.app`);
}

function installAppPath(lane) {
  return join('/Applications', `${lane.label}.app`);
}

async function buildLaneApp(lane, options = {}) {
  if (lane.name === 'staging') {
    const metadata = stageLaneBundledPlugins(lane);
    printStagedPluginMetadata(metadata);
  }
  const configPath = writeLaneTauriConfig(lane);
  const env = laneBuildEnv(lane);
  printSummary(laneSummary(lane));
  const args = ['tauri', 'build'];
  if (options.appOnly) {
    args.push('--bundles', 'app', '--no-sign');
  }
  args.push('--config', configPath);
  runChecked('npx', args, { env });
}

async function main() {
  const { command, rest } = commandArgs(process.argv.slice(2));
  const lane = resolveLane(rest);

  if (command === 'status') {
    if (rest.includes('--staging')) {
      printInstalledStatus(lane);
      return;
    }
    printInstalledStatus(LANES.production);
    printInstalledStatus(LANES.staging);
    return;
  }

  if (command === 'prepare') {
    const configPath = writeLaneTauriConfig(lane);
    printSummary(laneSummary(lane));
    console.log(`  wrote: ${configPath}`);
    return;
  }

  if (command === 'stage-plugins') {
    const metadata = stageLaneBundledPlugins(lane);
    printStagedPluginMetadata(metadata);
    return;
  }

  if (command === 'setup') {
    await withLaneLock(async () => {
      const profileHome = laneHome(lane);
      mkdirSync(profileHome, { recursive: true });
      const force = rest.includes('--force') || !hasCanonicalPluginProfile(profileHome);
      removeLegacyNamedEnvironmentArtifacts(profileHome);
      const setup = setupCommandForLane(lane, homedir(), { force });
      printSummary(laneSummary(lane));
      console.log(`  running: ${[setup.command, ...setup.args].join(' ')}`);
      runChecked(setup.command, setup.args, { env: setup.env });
    });
    return;
  }

  if (command === 'build') {
    await withLaneLock(async () => {
      await buildLaneApp(lane);
    });
    return;
  }

  if (command === 'install') {
    if (lane.name !== 'staging') {
      throw new Error('Local lane install only supports --staging. Production uses the normal release installer.');
    }
    if (process.platform !== 'darwin') {
      throw new Error('Local app install currently supports macOS only.');
    }
    await withLaneLock(async () => {
      await buildLaneApp(lane, { appOnly: true });
      const source = builtAppPath(lane);
      if (!existsSync(source)) {
        throw new Error(`Missing built app: ${source}`);
      }
      const destination = installAppPath(lane);
      rmSync(destination, { recursive: true, force: true });
      cpSync(source, destination, { recursive: true, force: true });
      console.log(`Installed ${lane.label} to ${destination}`);
    });
    return;
  }

  throw new Error(`Unknown command '${command}'. Use status, prepare, stage-plugins, setup, build, or install.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
