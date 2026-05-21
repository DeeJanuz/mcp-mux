#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function optionValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

const artifactRoot = optionValue('--artifact-root', process.env.ARTIFACT_ROOT || '.');
const outputPath = optionValue('--out', process.env.UPDATER_MANIFEST_PATH || 'latest.json');
const notesPath = optionValue('--notes', process.env.RELEASE_NOTES_PATH || 'release_notes.txt');
const version = optionValue('--version', process.env.VERSION || '');
const repository = optionValue('--repository', process.env.GITHUB_REPOSITORY || '');
const releaseBaseUrl = optionValue(
  '--release-base-url',
  process.env.RELEASE_BASE_URL || (repository && version
    ? `https://github.com/${repository}/releases/download/v${version}`
    : ''),
);

if (!version) {
  throw new Error('VERSION is required');
}

if (!releaseBaseUrl) {
  throw new Error('GITHUB_REPOSITORY or RELEASE_BASE_URL is required');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function firstMatching(files, predicates, label) {
  for (const predicate of predicates) {
    const match = files.find(predicate);
    if (match) return match;
  }

  const artifactList = files.map((file) => `  - ${file}`).join('\n');
  throw new Error(`Missing updater artifact for ${label}. Available artifacts:\n${artifactList}`);
}

function signatureFor(artifactPath) {
  const sigPath = `${artifactPath}.sig`;
  if (!existsSync(sigPath)) {
    throw new Error(`Missing signature for ${artifactPath}`);
  }

  const signature = readFileSync(sigPath, 'utf8').trim();
  if (!signature) {
    throw new Error(`Empty signature for ${artifactPath}`);
  }

  return signature;
}

const files = walk(artifactRoot).sort();
const macArchive = firstMatching(
  files,
  [
    (file) => file.includes('mcpviews-macos-arm64') && file.endsWith('.app.tar.gz'),
    (file) => file.endsWith('.app.tar.gz'),
  ],
  'macOS',
);
const windowsArchive = firstMatching(
  files,
  [
    (file) => file.includes('mcpviews-windows') && file.endsWith('.exe'),
    (file) => file.includes('mcpviews-windows') && file.endsWith('.msi'),
    (file) => file.includes('mcpviews-windows') && file.endsWith('.zip'),
    (file) => file.endsWith('.exe'),
    (file) => file.endsWith('.msi'),
    (file) => file.endsWith('.zip'),
  ],
  'Windows',
);

const manifest = {
  version,
  notes: existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '',
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-aarch64': {
      signature: signatureFor(macArchive),
      url: `${releaseBaseUrl}/${basename(macArchive)}`,
    },
    'windows-x86_64': {
      signature: signatureFor(windowsArchive),
      url: `${releaseBaseUrl}/${basename(windowsArchive)}`,
    },
  },
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Selected macOS updater artifact: ${macArchive}`);
console.log(`Selected Windows updater artifact: ${windowsArchive}`);
console.log(JSON.stringify(manifest, null, 2));
