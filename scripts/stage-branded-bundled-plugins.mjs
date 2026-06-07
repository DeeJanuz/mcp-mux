#!/usr/bin/env node
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUNDLED_HASH_FILE = '.mcpviews-bundled-plugin-sha256';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const defaultStageRoot = join(repoRoot, 'src-tauri', 'bundled-plugins', 'release');
const defaultSetupPluginDir = join(repoRoot, 'bundled-plugins', 'decidr-setup');

export const brandedRemotePlugins = [
  {
    name: 'decidr',
    repo: 'DeeJanuz/decidr-plugin',
    assetName: 'decidr.zip',
  },
  {
    name: 'ludflow',
    repo: 'DeeJanuz/ludflow-mcpviews',
    assetName: 'ludflow-plugin.zip',
  },
];

export const requiredBrandedPlugins = ['decidr-setup', 'decidr', 'ludflow'];
export const brandedAuthOrigins = {
  production: 'https://app.ludflow.com',
  staging: 'https://staging.app.ludflow.com',
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sepToken() {
  return sep === '\\' ? '\\' : '/';
}

function copyIfExists(source, destination) {
  if (!existsSync(source)) return;
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (path) =>
      !path.includes(`${sepToken()}.git${sepToken()}`) &&
      !path.endsWith('.DS_Store') &&
      !path.endsWith(BUNDLED_HASH_FILE),
  });
}

function sortedFiles(root, current = root) {
  if (!existsSync(current)) return [];
  const entries = readdirSync(current).sort((a, b) => a.localeCompare(b));
  const files = [];
  for (const entry of entries) {
    if (entry === '.DS_Store' || entry === BUNDLED_HASH_FILE) continue;
    const path = join(current, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...sortedFiles(root, path));
    } else if (stat.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export function writePluginHash(pluginDir) {
  const hash = createHash('sha256');
  for (const file of sortedFiles(pluginDir)) {
    hash.update(relative(pluginDir, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  const digest = hash.digest('hex');
  writeFileSync(join(pluginDir, BUNDLED_HASH_FILE), `${digest}\n`);
  return digest;
}

function safeExtractZip(zipPath, destination) {
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

function normalizePluginDirectory(sourceDir, stageRoot) {
  const manifestPath = join(sourceDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin source is missing manifest.json: ${sourceDir}`);
  }

  const manifest = readJson(manifestPath);
  if (!manifest.name || !manifest.version) {
    throw new Error(`Plugin manifest must include name and version: ${manifestPath}`);
  }

  const destination = join(stageRoot, manifest.name);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  copyIfExists(sourceDir, destination);
  const sha256 = writePluginHash(destination);

  return {
    name: manifest.name,
    version: manifest.version,
    path: destination,
    sha256,
    download_url: manifest.download_url || null,
  };
}

function resolveAuthOriginOption(value) {
  const raw = value || process.env.MCPVIEWS_BRANDED_AUTH_ORIGIN || 'production';
  if (brandedAuthOrigins[raw]) return brandedAuthOrigins[raw];
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch (_error) {
    throw new Error(
      `Invalid branded auth origin '${raw}'. Use production, staging, or a full origin URL.`
    );
  }
}

function pluginAuthOrigin(manifest) {
  const auth = manifest && manifest.mcp && manifest.mcp.auth;
  if (!auth || auth.type !== 'oauth' || !auth.token_url) return null;
  return new URL(auth.token_url).origin;
}

export function verifyBrandedAuthOrigins(options = {}) {
  const stageRoot = options.stageRoot || defaultStageRoot;
  const expectedOrigin = resolveAuthOriginOption(options.authOrigin);
  const pluginNames = options.plugins || ['decidr', 'ludflow'];
  const origins = [];

  for (const pluginName of pluginNames) {
    const manifestPath = join(stageRoot, pluginName, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    const origin = pluginAuthOrigin(manifest);
    if (!origin) continue;
    origins.push({ pluginName, origin });

    const codeAuth = manifest.mcp && manifest.mcp.auth && manifest.mcp.auth.email_code_auth;
    if (!codeAuth || codeAuth.enabled !== true) {
      throw new Error(`Bundled plugin '${pluginName}' must declare email_code_auth.enabled=true`);
    }
  }

  if (origins.length < 2) return [];
  const uniqueOrigins = Array.from(new Set(origins.map((entry) => entry.origin)));
  if (uniqueOrigins.length > 1) {
    throw new Error(
      `Bundled DecidR/Ludflow auth origins differ: ${origins
        .map((entry) => `${entry.pluginName}=${entry.origin}`)
        .join(', ')}`
    );
  }
  if (uniqueOrigins[0] !== expectedOrigin) {
    throw new Error(
      `Bundled auth origin ${uniqueOrigins[0]} does not match expected ${expectedOrigin}. Set MCPVIEWS_BRANDED_AUTH_ORIGIN=staging only for staging builds.`
    );
  }
  return origins.map((entry) => `${entry.pluginName} auth ${entry.origin}`);
}

export async function fetchLatestStableRelease(repo, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = options.githubApiBase || 'https://api.github.com';
  const headers = {
    Accept: 'application/vnd.github+json',
  };
  const token = options.githubToken || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${apiBase.replace(/\/$/, '')}/repos/${repo}/releases`;
  const response = await fetchImpl(url, { headers });
  if (!response || !response.ok) {
    const status = response ? `${response.status} ${response.statusText || ''}`.trim() : 'no response';
    throw new Error(`Failed to fetch releases for ${repo}: ${status}`);
  }

  const releases = await response.json();
  if (!Array.isArray(releases)) {
    throw new Error(`GitHub releases response for ${repo} was not an array`);
  }

  const release = releases.find((candidate) => !candidate.draft && !candidate.prerelease);
  if (!release) {
    throw new Error(`No stable GitHub release found for ${repo}`);
  }
  return release;
}

async function downloadAsset(asset, destination, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = {};
  const token = options.githubToken || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(asset.browser_download_url, { headers });
  if (!response || !response.ok) {
    const status = response ? `${response.status} ${response.statusText || ''}`.trim() : 'no response';
    throw new Error(`Failed to download ${asset.name}: ${status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, bytes);
  return bytes.length;
}

export async function stageRemotePlugin(plugin, options = {}) {
  const stageRoot = options.stageRoot || defaultStageRoot;
  const workRoot = options.workRoot || join(stageRoot, '.downloads');
  mkdirSync(workRoot, { recursive: true });

  const release = await fetchLatestStableRelease(plugin.repo, options);
  const asset = (release.assets || []).find((candidate) => candidate.name === plugin.assetName);
  if (!asset || !asset.browser_download_url) {
    throw new Error(`Release ${release.tag_name || release.name} for ${plugin.repo} is missing ${plugin.assetName}`);
  }

  const zipPath = join(workRoot, plugin.assetName);
  const extractRoot = join(workRoot, `${plugin.name}-extracted`);
  rmSync(zipPath, { force: true });
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });

  const bytes = await downloadAsset(asset, zipPath, options);
  safeExtractZip(zipPath, extractRoot);

  const staged = normalizePluginDirectory(pluginSourceRoot(extractRoot), stageRoot);
  if (staged.name !== plugin.name) {
    throw new Error(`Expected ${plugin.name} package, but manifest name was ${staged.name}`);
  }

  return {
    ...staged,
    source: `${plugin.repo}@${release.tag_name || release.name}`,
    asset: plugin.assetName,
    asset_bytes: bytes,
  };
}

export function stageLocalSetupPlugin(options = {}) {
  const stageRoot = options.stageRoot || defaultStageRoot;
  const setupPluginDir = options.setupPluginDir || defaultSetupPluginDir;
  const staged = normalizePluginDirectory(setupPluginDir, stageRoot);
  if (staged.name !== 'decidr-setup') {
    throw new Error(`Expected decidr-setup local plugin, but manifest name was ${staged.name}`);
  }
  return {
    ...staged,
    source: 'local:bundled-plugins/decidr-setup',
  };
}

export function verifySetupEmailCodeRenderer(options = {}) {
  const stageRoot = options.stageRoot || defaultStageRoot;
  const setupDir = join(stageRoot, 'decidr-setup');
  const manifestPath = join(setupDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Missing decidr-setup manifest');
  }

  const manifest = readJson(manifestPath);
  const rendererPath = manifest.renderers && manifest.renderers.plugin_email_code_auth;
  if (rendererPath !== 'renderers/plugin-email-code-auth.js') {
    throw new Error('decidr-setup must declare the plugin_email_code_auth renderer');
  }

  if (!existsSync(join(setupDir, rendererPath))) {
    throw new Error('decidr-setup is missing renderers/plugin-email-code-auth.js');
  }

  const rendererNames = new Set(
    (manifest.renderer_definitions || []).map((definition) => definition && definition.name),
  );
  if (!rendererNames.has('plugin_email_code_auth')) {
    throw new Error('decidr-setup renderer_definitions must include plugin_email_code_auth');
  }

  const onboardingPath = manifest.renderers && manifest.renderers.decidr_onboarding;
  if (!onboardingPath || !existsSync(join(setupDir, onboardingPath))) {
    throw new Error('decidr-setup is missing the decidr_onboarding renderer');
  }

  const onboardingSource = readFileSync(join(setupDir, onboardingPath), 'utf8');
  if (!onboardingSource.includes('send_plugin_email_code') || !onboardingSource.includes('verify_plugin_email_code')) {
    throw new Error('decidr-setup onboarding must use the email-code auth commands');
  }
  if (onboardingSource.includes('start_plugin_auth')) {
    throw new Error('decidr-setup onboarding must not start browser OAuth authentication');
  }
}

export async function stageBrandedBundledPlugins(options = {}) {
  const stageRoot = options.stageRoot || defaultStageRoot;
  const workRoot = options.workRoot || join(stageRoot, '.downloads');

  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });

  const staged = [stageLocalSetupPlugin({ ...options, stageRoot })];
  for (const plugin of options.plugins || brandedRemotePlugins) {
    staged.push(await stageRemotePlugin(plugin, { ...options, stageRoot, workRoot }));
  }

  verifyBrandedAuthOrigins({ stageRoot, authOrigin: options.authOrigin });

  rmSync(workRoot, { recursive: true, force: true });
  const metadata = {
    generated_at: new Date().toISOString(),
    plugins: staged.map(({ name, version, source, asset, asset_bytes, sha256, download_url }) => ({
      name,
      version,
      source,
      asset: asset || null,
      asset_bytes: asset_bytes || null,
      sha256,
      download_url,
    })),
  };
  writeFileSync(join(stageRoot, 'bundled-plugin-versions.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

export function verifyBrandedBundle(options = {}) {
  const stageRoot = options.stageRoot || defaultStageRoot;
  const plugins = options.requiredPlugins || requiredBrandedPlugins;
  const missing = [];
  const found = [];

  for (const pluginName of plugins) {
    const pluginDir = join(stageRoot, pluginName);
    const manifestPath = join(pluginDir, 'manifest.json');
    const hashPath = join(pluginDir, BUNDLED_HASH_FILE);
    if (!existsSync(manifestPath) || !existsSync(hashPath)) {
      missing.push(pluginName);
      continue;
    }
    const manifest = readJson(manifestPath);
    found.push(`${manifest.name} v${manifest.version}`);
  }

  if (missing.length > 0) {
    throw new Error(`Missing bundled plugins: ${missing.join(', ')}`);
  }
  verifyBrandedAuthOrigins({
    stageRoot,
    authOrigin: options.authOrigin,
  });
  verifySetupEmailCodeRenderer({ stageRoot });
  return found;
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  const authOriginArg = process.argv.find((arg) => arg.startsWith('--auth-origin='));
  const authOrigin = authOriginArg ? authOriginArg.split('=').slice(1).join('=') : undefined;
  if (verifyOnly) {
    const found = verifyBrandedBundle({ authOrigin });
    console.log(`Verified branded bundled plugins in ${defaultStageRoot}`);
    for (const plugin of found) console.log(`  - ${plugin}`);
    return;
  }

  const metadata = await stageBrandedBundledPlugins({ authOrigin });
  console.log(`Staged branded bundled plugins in ${defaultStageRoot}`);
  for (const plugin of metadata.plugins) {
    console.log(`  - ${plugin.name} v${plugin.version} (${plugin.source})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
