#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const stageRoot = join(repoRoot, 'src-tauri', 'bundled-plugins', 'mac-dev');
const releaseBundleRoot = join(repoRoot, 'target', 'release', 'bundle');
const tauriConfig = readJson(join(repoRoot, 'src-tauri', 'tauri.conf.json'));

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function copyIfExists(source, destination) {
  if (!existsSync(source)) return;
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (path) => !path.includes(`${sepToken()}.git${sepToken()}`) && !path.endsWith('.DS_Store'),
  });
}

function sepToken() {
  return process.platform === 'win32' ? '\\' : '/';
}

function sortedFiles(root, current = root) {
  if (!existsSync(current)) return [];
  const entries = readdirSync(current).sort((a, b) => a.localeCompare(b));
  const files = [];
  for (const entry of entries) {
    if (entry === '.DS_Store' || entry === '.mcpviews-bundled-plugin-sha256') continue;
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

function writePluginHash(pluginDir) {
  const hash = createHash('sha256');
  for (const file of sortedFiles(pluginDir)) {
    hash.update(relative(pluginDir, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  writeFileSync(join(pluginDir, '.mcpviews-bundled-plugin-sha256'), `${hash.digest('hex')}\n`);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    if (result.error) {
      throw result.error;
    }

    const exitCode = result.status || 1;
    const signal = result.signal ? `, signal ${result.signal}` : '';
    const error = new Error(`Command failed (${exitCode}${signal}): ${[command, ...args].join(' ')}`);
    error.exitCode = exitCode;
    throw error;
  }
}

function assertRepoLocalPath(path) {
  const resolvedPath = resolve(path);
  const relativePath = relative(repoRoot, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sepToken()}`) || isAbsolute(relativePath)) {
    throw new Error(`Refusing to remove path outside the MCPViews repo: ${resolvedPath}`);
  }
  return resolvedPath;
}

function removeGeneratedPath(path) {
  const resolvedPath = assertRepoLocalPath(path);
  const parts = relative(repoRoot, resolvedPath).split(/[\\/]/).filter(Boolean);
  let current = repoRoot;

  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current)) {
      break;
    }
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to remove generated path through symlink: ${current}`);
    }
  }

  rmSync(resolvedPath, { recursive: true, force: true });
}

function stageDirectPlugin(sourceDir, includePaths) {
  const manifest = readJson(join(sourceDir, 'manifest.json'));
  const destination = join(stageRoot, manifest.name);
  mkdirSync(destination, { recursive: true });
  for (const includePath of includePaths) {
    copyIfExists(join(sourceDir, includePath), join(destination, includePath));
  }
  writePluginHash(destination);
  return `${manifest.name} v${manifest.version}`;
}

function stageOptionalDirectPlugin(sourceDir, includePaths) {
  if (!existsSync(join(sourceDir, 'manifest.json'))) {
    return `Skipped optional plugin at ${relative(repoRoot, sourceDir)} (manifest.json not found)`;
  }

  return stageDirectPlugin(sourceDir, includePaths);
}

function stageDecidrPlugin(sourceDir) {
  const manifest = readJson(join(sourceDir, 'manifest.json'));
  const destination = join(stageRoot, manifest.name);
  const rendererDir = join(destination, 'renderers');
  mkdirSync(rendererDir, { recursive: true });

  copyIfExists(join(sourceDir, 'manifest.json'), join(destination, 'manifest.json'));
  copyIfExists(join(sourceDir, 'prompts'), join(destination, 'prompts'));

  const sharedParts = [
    'renderers/shared/00-api-client.js',
    'renderers/shared/01-theme.js',
    'renderers/shared/02-components.js',
    'renderers/shared/03-slideouts.js',
  ].map((path) => readFileSync(join(sourceDir, path), 'utf8'));
  const sharedBundle = sharedParts.join('\n');
  const renderers = [
    ['renderers/list.js', 'decidr-list.js'],
    ['renderers/dashboard.js', 'decidr-dashboard.js'],
    ['renderers/timeline.js', 'decidr-timeline.js'],
    ['renderers/graph.js', 'decidr-graph.js'],
    ['renderers/github-auth.js', 'decidr-github-auth.js'],
  ];

  for (const [source, outputName] of renderers) {
    const renderer = readFileSync(join(sourceDir, source), 'utf8');
    writeFileSync(
      join(rendererDir, outputName),
      `/* === Bundled shared dependencies === */\n${sharedBundle}\n\n/* === Renderer: ${outputName} === */\n${renderer}`,
    );
  }

  writePluginHash(destination);
  return `${manifest.name} v${manifest.version}`;
}

function runTauriBuild() {
  const env = {
    ...process.env,
    MCPVIEWS_BUNDLE_AI_PROVIDER_BASE_URL: process.env.MCPVIEWS_BUNDLE_AI_PROVIDER_BASE_URL || 'https://dev.app.tribexai.com',
    MCPVIEWS_BUNDLE_AI_PROVIDER_RELAY_BASE_URL: process.env.MCPVIEWS_BUNDLE_AI_PROVIDER_RELAY_BASE_URL || 'https://dev.app.tribexai.com',
    MCPVIEWS_BUNDLE_AI_PROVIDER_DEVICE_BASE_URL: process.env.MCPVIEWS_BUNDLE_AI_PROVIDER_DEVICE_BASE_URL || 'https://dev.app.tribexai.com',
  };

  runChecked(
    'npx',
    [
      'tauri',
      'build',
      '--bundles',
      'app',
      '--no-sign',
      '--config',
      '{"bundle":{"createUpdaterArtifacts":false}}',
    ],
    { env },
  );
  createDevDmg();
}

function createDevDmg() {
  const productName = tauriConfig.productName || 'MCPViews';
  const version = tauriConfig.version || '0.0.0';
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
  const appPath = join(releaseBundleRoot, 'macos', `${productName}.app`);
  const dmgDir = join(releaseBundleRoot, 'dmg');
  const versionedDmgPath = join(dmgDir, `${productName}_${version}_${arch}.dmg`);
  const stableDmgPath = join(dmgDir, 'DecidR-MCPViews-macOS.dmg');

  if (!existsSync(appPath)) {
    throw new Error(`Expected app bundle was not built: ${appPath}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'mcpviews-dmg-stage-'));

  try {
    mkdirSync(dmgDir, { recursive: true });
    runChecked('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    runChecked('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
    cpSync(appPath, join(tempRoot, `${productName}.app`), { recursive: true });
    symlinkSync('/Applications', join(tempRoot, 'Applications'));

    runChecked('hdiutil', [
      'create',
      '-ov',
      '-fs',
      'APFS',
      '-format',
      'UDZO',
      '-volname',
      'DecidR MCPViews',
      '-srcfolder',
      tempRoot,
      versionedDmgPath,
    ]);
    runChecked('hdiutil', ['verify', versionedDmgPath]);
    cpSync(versionedDmgPath, stableDmgPath);
    console.log(`Built ${versionedDmgPath}`);
    console.log(`Copied stable alias ${stableDmgPath}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  removeGeneratedPath(stageRoot);
  removeGeneratedPath(join(releaseBundleRoot, 'macos'));
  removeGeneratedPath(join(releaseBundleRoot, 'dmg'));
  mkdirSync(stageRoot, { recursive: true });

  const staged = [
    stageDirectPlugin(resolve(repoRoot, 'bundled-plugins/decidr-setup'), [
      'manifest.json',
      'renderers',
    ]),
    stageOptionalDirectPlugin(resolve(repoRoot, '../tribe-x-persona-studio'), [
      'manifest.json',
      'renderers',
      'tools',
      'docs',
      'README.md',
    ]),
    stageDirectPlugin(resolve(repoRoot, '../ludflow-mcpviews'), [
      'manifest.json',
      'renderers',
      'prompts',
      'README.md',
      'RELEASE_NOTES.md',
    ]),
    stageDecidrPlugin(resolve(repoRoot, '../decidr-plugin')),
    stageOptionalDirectPlugin(resolve(repoRoot, '../mcpviews-email-deliverability-plugin'), [
      'manifest.json',
      'renderers',
      'src',
      'fixtures',
      'package.json',
      'README.md',
      'RELEASE_NOTES.md',
    ]),
  ];

  console.log(`Staged mac dev plugins in ${stageRoot}`);
  for (const plugin of staged) {
    console.log(`  - ${plugin}`);
  }

  runTauriBuild();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(error?.exitCode || 1);
}
