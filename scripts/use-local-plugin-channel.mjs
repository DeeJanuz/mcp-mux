#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(repoRoot, '..');
const require = createRequire(import.meta.url);

export const CHANNELS = {
  production: {
    decidrOrigin: 'https://app.decidrmcp.com',
    ludflowOrigin: 'https://app.ludflow.com',
  },
  staging: {
    decidrOrigin: 'https://staging.app.decidrmcp.com',
    ludflowOrigin: 'https://staging.app.ludflow.com',
  },
};

const pluginSpecs = [
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

export const NAMED_ENVIRONMENT_CLONES = [
  {
    channel: 'staging',
    sourceName: 'decidr',
    installedName: 'decidr-staging',
    label: 'DecidR Staging',
    rendererPrefix: 'decidr_staging',
    sourceRendererPrefix: 'decidr',
    toolPrefix: 'decidr_staging__',
  },
  {
    channel: 'staging',
    sourceName: 'ludflow',
    installedName: 'ludflow-staging',
    label: 'Ludflow Staging',
    rendererPrefix: 'ludflow_staging',
    sourceRendererPrefix: 'ludflow',
    toolPrefix: 'ludflow_staging__',
  },
];

function mcpviewsHome() {
  return resolve(process.env.MCPVIEWS_HOME || join(homedir(), '.mcpviews'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function origin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch (_error) {
    return String(value).replace(/\/$/, '');
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

function copyDirectory(source, destination) {
  if (!existsSync(source)) return false;
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (path) => !path.includes('/.git/') && !path.endsWith('.DS_Store'),
  });
  return true;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function findPluginSpec(name) {
  const spec = pluginSpecs.find((item) => item.name === name);
  if (!spec) throw new Error(`Unknown plugin spec: ${name}`);
  return spec;
}

function renameRendererName(rendererName, clone) {
  if (!rendererName || !clone) return rendererName;
  const sourcePrefix = `${clone.sourceRendererPrefix}_`;
  if (!rendererName.startsWith(sourcePrefix)) return rendererName;
  return `${clone.rendererPrefix}_${rendererName.slice(sourcePrefix.length)}`;
}

function renameRendererInText(text, clone) {
  if (!clone) return text;
  const sourcePrefix = `${clone.sourceRendererPrefix}_`;
  const escapedSourcePrefix = sourcePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${escapedSourcePrefix}(?!_)`, 'g'), `${clone.rendererPrefix}_`);
}

function prefixRendererTools(tools, clone) {
  if (!Array.isArray(tools) || !clone || !clone.toolPrefix) return tools;
  return tools.map((tool) => {
    if (typeof tool !== 'string') return tool;
    if (tool.includes('__')) return tool;
    return `${clone.toolPrefix}${tool}`;
  });
}

function labelForNamedEnvironment(label, clone) {
  if (!label || !clone || !clone.label) return label;
  const envSuffix = clone.label.replace(new RegExp(`^${clone.sourceName}\\s*`, 'i'), '').trim();
  if (!envSuffix) return label;
  const suffix = ` (${envSuffix})`;
  if (label.endsWith(suffix)) return label;
  return `${label}${suffix}`;
}

export function transformManifestForNamedEnvironment(manifest, clone) {
  if (!clone) return cloneJson(manifest);
  const next = cloneJson(manifest);
  next.name = clone.installedName;
  next.standalone_group = clone.installedName;
  next.standalone_group_label = clone.label;

  if (next.mcp) {
    next.mcp.tool_prefix = clone.toolPrefix;
  }

  if (next.renderers && typeof next.renderers === 'object') {
    next.renderers = Object.fromEntries(
      Object.entries(next.renderers).map(([toolName, rendererName]) => [
        toolName,
        renameRendererName(rendererName, clone),
      ]),
    );
  }

  if (Array.isArray(next.renderer_definitions)) {
    next.renderer_definitions = next.renderer_definitions.map((renderer) => ({
      ...renderer,
      name: renameRendererName(renderer.name, clone),
      standalone_label: labelForNamedEnvironment(renderer.standalone_label, clone),
      tools: prefixRendererTools(renderer.tools, clone),
    }));
  }

  if (next.registry_index) {
    if (Array.isArray(next.registry_index.renderer_names)) {
      next.registry_index.renderer_names = next.registry_index.renderer_names.map((name) =>
        renameRendererName(name, clone),
      );
    }
    if (Array.isArray(next.registry_index.tool_groups)) {
      next.registry_index.tool_groups = next.registry_index.tool_groups.map((group) => ({
        ...group,
        tools: prefixRendererTools(group.tools, clone),
      }));
    }
  }

  // Staging clones are explicit test lanes. They should not install or update
  // durable governance startup rules, which remain owned by production DecidR.
  next.startup_rules = [];
  next.setup_questions = [];
  next.plugin_rules = [
    `${clone.label} is a staging-only MCPViews environment. Use it only when the user explicitly asks to test staging or validate pre-production behavior. Durable governance writes and ordinary project management should use the production plugin.`,
  ];
  next.plugin_rule_definitions = [];
  next.download_url = null;

  return next;
}

export function transformRendererJsForNamedEnvironment(pluginName, source, clone) {
  if (!clone) return source;
  let text = source;

  if (pluginName === 'decidr') {
    text = text
      .replaceAll('__decidrAPI', '__decidrStagingAPI')
      .replaceAll('__decidrUI', '__decidrStagingUI')
      .replaceAll('__decidrToken', '__decidrStagingToken')
      .replaceAll('__decidrSlideOutContextKey', '__decidrStagingSlideOutContextKey')
      .replaceAll('window.__mcpviews_plugins.decidr', "window.__mcpviews_plugins['decidr-staging']")
      .replaceAll("'decidr'", "'decidr-staging'")
      .replaceAll('"decidr"', '"decidr-staging"')
      .replaceAll('ludflow__', 'ludflow_staging__');
    return renameRendererInText(text, clone);
  }

  if (pluginName === 'ludflow') {
    text = renameRendererInText(text, clone)
      .replace("var PLUGIN_NAME = 'ludflow';", "var PLUGIN_NAME = 'ludflow-staging';")
      .replace("var TOOL_PREFIX = 'ludflow__';", "var TOOL_PREFIX = 'ludflow_staging__';");
    return text;
  }

  return renameRendererInText(text, clone);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    if (result.error) throw result.error;
    throw new Error(`Command failed (${result.status || 1}): ${[command, ...args].join(' ')}`);
  }
}

export function classifyManifest(pluginName, manifest) {
  const mcpOrigin = origin(manifest && manifest.mcp && manifest.mcp.url);
  const auth = manifest && manifest.mcp && manifest.mcp.auth;
  const authOrigin = origin(auth && auth.token_url);

  for (const [channel, config] of Object.entries(CHANNELS)) {
    if (pluginName === 'decidr') {
      if (mcpOrigin === config.decidrOrigin && authOrigin === config.ludflowOrigin) {
        return channel;
      }
    }
    if (pluginName === 'ludflow') {
      if (mcpOrigin === config.ludflowOrigin && authOrigin === config.ludflowOrigin) {
        return channel;
      }
    }
  }
  return 'unknown';
}

export function overallChannel(items) {
  const channels = Array.from(new Set(items.map((item) => item.channel)));
  if (channels.length === 1 && (channels[0] === 'production' || channels[0] === 'staging')) {
    return channels[0];
  }
  return 'mixed';
}

export function validateManifestForChannel(pluginName, manifest, channel) {
  if (!CHANNELS[channel]) {
    throw new Error(`Unknown channel: ${channel}`);
  }
  const actual = classifyManifest(pluginName, manifest);
  if (actual !== channel) {
    throw new Error(`Expected ${pluginName} manifest to be ${channel}, found ${actual}`);
  }

  const payload = JSON.stringify(manifest);
  const forbidden = channel === 'production' ? CHANNELS.staging : CHANNELS.production;
  const forbiddenEndpoints =
    pluginName === 'decidr'
      ? [forbidden.decidrOrigin, forbidden.ludflowOrigin]
      : [forbidden.ludflowOrigin];
  for (const endpoint of forbiddenEndpoints) {
    if (payload.includes(endpoint)) {
      throw new Error(`${pluginName} ${channel} manifest contains forbidden endpoint ${endpoint}`);
    }
  }
}

function installedPluginItem(home, pluginName, sourceName = pluginName) {
  const manifestPath = join(home, 'plugins', pluginName, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      name: pluginName,
      version: null,
      mcpUrl: null,
      authUrl: null,
      channel: 'missing',
    };
  }
  const manifest = readJson(manifestPath);
  return {
    name: pluginName,
    version: manifest.version || null,
    mcpUrl: manifest.mcp && manifest.mcp.url,
    authUrl: manifest.mcp && manifest.mcp.auth && manifest.mcp.auth.token_url,
    toolPrefix: manifest.mcp && manifest.mcp.tool_prefix,
    channel: classifyManifest(sourceName, manifest),
  };
}

function installedItems(home = mcpviewsHome()) {
  return pluginSpecs.map((spec) => installedPluginItem(home, spec.name));
}

function backupRoot(home, channel) {
  return join(home, 'channel-backups', channel);
}

function backupCurrentChannel(home, channel, items) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupChannel = channel === 'production' || channel === 'staging' ? channel : `mixed-${timestamp}`;
  const root = backupRoot(home, backupChannel);
  mkdirSync(join(root, 'plugins'), { recursive: true });
  mkdirSync(join(root, 'auth'), { recursive: true });

  for (const spec of pluginSpecs) {
    copyDirectory(join(home, 'plugins', spec.name), join(root, 'plugins', spec.name));
    copyDirectory(join(home, 'auth', spec.name), join(root, 'auth', spec.name));
  }

  writeFileSync(
    join(root, 'metadata.json'),
    `${JSON.stringify(
      {
        channel: backupChannel,
        backed_up_at: new Date().toISOString(),
        plugins: items,
      },
      null,
      2,
    )}\n`,
  );
  return backupChannel;
}

function buildPlugin(spec, channel) {
  if (!existsSync(join(spec.repoDir, 'build.sh'))) {
    throw new Error(`Missing build.sh for ${spec.name}: ${spec.repoDir}`);
  }
  runChecked('bash', ['build.sh'], {
    cwd: spec.repoDir,
    env: {
      ...process.env,
      [spec.buildEnv]: channel,
    },
  });
}

function extractBuiltPlugin(spec, channel) {
  const zipPath = join(spec.repoDir, spec.zipPath);
  if (!existsSync(zipPath)) {
    throw new Error(`Missing built ZIP for ${spec.name}: ${zipPath}`);
  }
  const extractRoot = mkdtempSync(join(tmpdir(), `mcpviews-${spec.name}-${channel}-`));
  const AdmZip = require('adm-zip');
  const archive = new AdmZip(zipPath);
  archive.extractAllTo(extractRoot, true);
  const sourceRoot = pluginSourceRoot(extractRoot);
  const manifest = readJson(join(sourceRoot, 'manifest.json'));
  if (manifest.name !== spec.name) {
    throw new Error(`Expected ${spec.name} ZIP, got ${manifest.name}`);
  }
  validateManifestForChannel(spec.name, manifest, channel);
  return { extractRoot, sourceRoot, manifest };
}

function restoreAuthForChannel(home, channel) {
  const targetBackupRoot = backupRoot(home, channel);
  for (const spec of pluginSpecs) {
    const currentAuth = join(home, 'auth', spec.name);
    rmSync(currentAuth, { recursive: true, force: true });
    copyDirectory(join(targetBackupRoot, 'auth', spec.name), currentAuth);
  }
}

function copyAuthForPlugin(home, sourceName, destinationName, preferredChannel) {
  const currentSource = join(home, 'auth', sourceName);
  const backupSource = preferredChannel
    ? join(backupRoot(home, preferredChannel), 'auth', sourceName)
    : null;
  const destination = join(home, 'auth', destinationName);
  rmSync(destination, { recursive: true, force: true });

  if (backupSource && copyDirectory(backupSource, destination)) {
    return `backup:${preferredChannel}`;
  }
  if (copyDirectory(currentSource, destination)) {
    return 'current';
  }
  return 'missing';
}

function installBuiltPlugins(home, channel) {
  for (const spec of pluginSpecs) {
    buildPlugin(spec, channel);
    const { extractRoot, sourceRoot, manifest } = extractBuiltPlugin(spec, channel);
    const destination = join(home, 'plugins', spec.name);
    const preferencesPath = join(destination, 'preferences.json');
    const preferences = existsSync(preferencesPath) ? readFileSync(preferencesPath) : null;

    copyDirectory(sourceRoot, destination);
    if (preferences) {
      writeFileSync(join(destination, 'preferences.json'), preferences);
    }
    rmSync(extractRoot, { recursive: true, force: true });
    console.log(`Installed ${spec.name} v${manifest.version} (${channel})`);
  }
}

function installBuiltPluginAs(home, spec, channel, destinationName, clone) {
  buildPlugin(spec, channel);
  const { extractRoot, sourceRoot, manifest } = extractBuiltPlugin(spec, channel);
  const destination = join(home, 'plugins', destinationName);
  const preferencesPath = join(destination, 'preferences.json');
  const preferences = existsSync(preferencesPath) ? readFileSync(preferencesPath) : null;

  copyDirectory(sourceRoot, destination);
  const manifestPath = join(destination, 'manifest.json');
  const nextManifest = clone
    ? transformManifestForNamedEnvironment(manifest, clone)
    : manifest;
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);

  if (clone) {
    const renderersDir = join(destination, 'renderers');
    for (const fileName of readdirSync(renderersDir)) {
      if (!fileName.endsWith('.js')) continue;
      const path = join(renderersDir, fileName);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, transformRendererJsForNamedEnvironment(spec.name, source, clone));
    }
  }

  if (preferences) {
    writeFileSync(join(destination, 'preferences.json'), preferences);
  }
  rmSync(extractRoot, { recursive: true, force: true });
  console.log(`Installed ${destinationName} v${nextManifest.version} (${channel})`);
  return nextManifest;
}

async function reloadMcpviews() {
  const port = process.env.MCPVIEWS_RELOAD_PORT || '4200';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/reload-plugins`, {
      method: 'POST',
      signal: controller.signal,
    });
    if (response.ok) {
      console.log(`Reloaded running MCPViews plugin registry on port ${port}`);
    } else {
      console.log(`MCPViews reload skipped on port ${port}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.log(`MCPViews reload skipped on port ${port}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function statusSnapshot(home = mcpviewsHome()) {
  const items = installedItems(home);
  return {
    home,
    items,
    channel: overallChannel(items),
    backups: {
      production: existsSync(backupRoot(home, 'production')),
      staging: existsSync(backupRoot(home, 'staging')),
    },
  };
}

function printStatus(snapshot) {
  console.log(`MCPViews home: ${snapshot.home}`);
  console.log(`Channel: ${snapshot.channel}`);
  for (const item of snapshot.items) {
    console.log(
      [
        `  - ${item.name}`,
        item.version ? `v${item.version}` : 'not installed',
        `channel=${item.channel}`,
        item.mcpUrl ? `mcp=${item.mcpUrl}` : null,
        item.authUrl ? `auth=${item.authUrl}` : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  console.log(
    `Backups: production=${snapshot.backups.production ? 'yes' : 'no'} staging=${
      snapshot.backups.staging ? 'yes' : 'no'
    }`,
  );
}

export function namedEnvironmentSnapshot(home = mcpviewsHome()) {
  const canonical = pluginSpecs.map((spec) => ({
    ...installedPluginItem(home, spec.name, spec.name),
    environment: 'production',
    canonical: true,
  }));
  const clones = NAMED_ENVIRONMENT_CLONES.map((clone) => ({
    ...installedPluginItem(home, clone.installedName, clone.sourceName),
    environment: clone.channel,
    canonical: false,
    sourceName: clone.sourceName,
  }));
  return {
    home,
    items: canonical.concat(clones),
    backups: {
      production: existsSync(backupRoot(home, 'production')),
      staging: existsSync(backupRoot(home, 'staging')),
    },
  };
}

function printNamedEnvironmentStatus(snapshot) {
  console.log(`MCPViews home: ${snapshot.home}`);
  console.log('Named environments:');
  for (const item of snapshot.items) {
    const expected = item.environment;
    const status = item.channel === expected ? 'ok' : item.channel;
    console.log(
      [
        `  - ${item.name}`,
        item.version ? `v${item.version}` : 'not installed',
        `env=${expected}`,
        `status=${status}`,
        item.toolPrefix ? `tools=${item.toolPrefix}*` : null,
        item.mcpUrl ? `mcp=${item.mcpUrl}` : null,
        item.authUrl ? `auth=${item.authUrl}` : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  console.log(
    `Backups: production=${snapshot.backups.production ? 'yes' : 'no'} staging=${
      snapshot.backups.staging ? 'yes' : 'no'
    }`,
  );
}

async function switchChannel(targetChannel, options = {}) {
  if (!CHANNELS[targetChannel]) {
    throw new Error(`Unknown channel '${targetChannel}'. Use production or staging.`);
  }

  const home = mcpviewsHome();
  mkdirSync(join(home, 'plugins'), { recursive: true });
  mkdirSync(join(home, 'auth'), { recursive: true });

  const snapshot = statusSnapshot(home);
  if (snapshot.channel === 'mixed' && !options.force) {
    printStatus(snapshot);
    throw new Error('Refusing to switch from mixed plugin state. Re-run with --force after inspecting status.');
  }

  const backedUpAs = backupCurrentChannel(home, snapshot.channel, snapshot.items);
  if (snapshot.channel === targetChannel) {
    console.log(`Already on ${targetChannel}; refreshing plugin artifacts from local source.`);
  } else {
    console.log(`Backed up current ${snapshot.channel} state as ${backedUpAs}`);
  }

  installBuiltPlugins(home, targetChannel);
  restoreAuthForChannel(home, targetChannel);
  writeFileSync(
    join(home, 'channel-backups', 'active-channel.json'),
    `${JSON.stringify({ channel: targetChannel, switched_at: new Date().toISOString() }, null, 2)}\n`,
  );
  await reloadMcpviews();

  const next = statusSnapshot(home);
  printStatus(next);
  if (next.channel !== targetChannel) {
    throw new Error(`Switch did not complete: expected ${targetChannel}, found ${next.channel}`);
  }
}

async function setupNamedEnvironments(options = {}) {
  const home = mcpviewsHome();
  mkdirSync(join(home, 'plugins'), { recursive: true });
  mkdirSync(join(home, 'auth'), { recursive: true });

  const before = statusSnapshot(home);
  const backedUpAs = backupCurrentChannel(home, before.channel, before.items);
  console.log(`Backed up current ${before.channel} canonical plugin state as ${backedUpAs}`);

  for (const spec of pluginSpecs) {
    installBuiltPluginAs(home, spec, 'production', spec.name, null);
    const authSource = copyAuthForPlugin(home, spec.name, spec.name, 'production');
    console.log(`Auth for ${spec.name}: ${authSource}`);
  }

  for (const clone of NAMED_ENVIRONMENT_CLONES) {
    const spec = findPluginSpec(clone.sourceName);
    installBuiltPluginAs(home, spec, clone.channel, clone.installedName, clone);
    const authSource = copyAuthForPlugin(home, clone.sourceName, clone.installedName, clone.channel);
    console.log(`Auth for ${clone.installedName}: ${authSource}`);
  }

  writeFileSync(
    join(home, 'channel-backups', 'active-channel.json'),
    `${JSON.stringify({ channel: 'named-environments', switched_at: new Date().toISOString() }, null, 2)}\n`,
  );
  writeFileSync(
    join(home, 'named-environments.json'),
    `${JSON.stringify(
      {
        configured_at: new Date().toISOString(),
        production: pluginSpecs.map((spec) => spec.name),
        staging: NAMED_ENVIRONMENT_CLONES.map((clone) => clone.installedName),
      },
      null,
      2,
    )}\n`,
  );

  if (options.reload !== false) {
    await reloadMcpviews();
  }

  const next = namedEnvironmentSnapshot(home);
  printNamedEnvironmentStatus(next);
  for (const item of next.items) {
    if (item.channel !== item.environment) {
      throw new Error(`Named environment mismatch for ${item.name}: expected ${item.environment}, found ${item.channel}`);
    }
  }
}

async function main() {
  const command = process.argv[2] || 'status';
  const force = process.argv.includes('--force');

  if (command === 'status') {
    printStatus(statusSnapshot());
    return;
  }

  if (command === 'envs:status' || command === 'named-envs:status') {
    printNamedEnvironmentStatus(namedEnvironmentSnapshot());
    return;
  }

  if (command === 'envs' || command === 'named-envs') {
    await setupNamedEnvironments({ force });
    return;
  }

  if (command === 'production' || command === 'staging') {
    await switchChannel(command, { force });
    return;
  }

  throw new Error(`Unknown command '${command}'. Use status, production, staging, named-envs, or named-envs:status.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
