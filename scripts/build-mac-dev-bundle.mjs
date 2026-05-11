#!/usr/bin/env node
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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const stageRoot = join(repoRoot, 'src-tauri', 'bundled-plugins', 'mac-dev');

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

  const result = spawnSync('npx', ['tauri', 'build', '--bundles', 'app,dmg'], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

const staged = [
  stageDirectPlugin(resolve(repoRoot, '../tribe-x-ai-plugin'), [
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
];

console.log(`Staged mac dev plugins in ${stageRoot}`);
for (const plugin of staged) {
  console.log(`  - ${plugin}`);
}

runTauriBuild();
